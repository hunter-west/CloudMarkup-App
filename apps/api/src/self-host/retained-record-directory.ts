import { constants } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  link,
  unlink,
  rename,
} from "node:fs/promises";
import { isAbsolute, parse, resolve, dirname } from "node:path";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
const keyPattern = /^[a-f0-9]{64}\.[a-z][a-z0-9.-]{0,120}\.json$/u;
const identityPattern = /^[a-f0-9]{64}$/u;
const maximumRecords = 10000;
const maximumBytes = 16 * 1024 * 1024;
function unavailable(): never {
  throw Error("The retained dispatch journal is unavailable.");
}
function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function canonical(value: unknown) {
  return serializeCanonicalJson(value);
}
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
/** Retain the original directory and its complete inventory independently of
 * SQL/object backups. Missing, replaced, aliased, partially installed or locked
 * history refuses; runtime never provisions a replacement or steals a lock. */
export class DurableRecordDirectory {
  readonly root: string;
  readonly identity: string;
  #closed = false;
  readonly #active = new Set<Promise<unknown>>();
  #serial: Promise<unknown> = Promise.resolve();
  constructor(root: string, identity: string) {
    if (
      !isAbsolute(root) ||
      resolve(root) === parse(resolve(root)).root ||
      !identityPattern.test(identity)
    )
      unavailable();
    this.root = resolve(root);
    this.identity = identity;
  }
  async #ancestry() {
    let current = this.root;
    for (;;) {
      const s = await lstat(current);
      if (!s.isDirectory() || s.isSymbolicLink()) unavailable();
      if (
        current === this.root &&
        process.platform !== "win32" &&
        (s.mode & 0o077) !== 0
      )
        unavailable();
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  async #sync() {
    const handle = await open(this.root, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async #regular(name: string, allowPair = false): Promise<string | null> {
    const target = resolve(this.root, name);
    if (dirname(target) !== this.root) unavailable();
    const stat = await lstat(target, { bigint: true }).catch(
      (error: unknown) => {
        if (missing(error)) return null;
        throw error;
      },
    );
    if (stat === null) return null;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink < 1n ||
      stat.nlink > (allowPair ? 2n : 1n) ||
      stat.size > BigInt(maximumBytes) ||
      (process.platform !== "win32" && (stat.mode & 0o077n) !== 0n)
    )
      unavailable();
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat({ bigint: true });
      if (
        !opened.isFile() ||
        opened.dev !== stat.dev ||
        opened.ino !== stat.ino ||
        opened.size > BigInt(maximumBytes) ||
        opened.nlink !== stat.nlink
      )
        unavailable();
      const bytes = await handle.readFile();
      if (bytes.length > maximumBytes) unavailable();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const value: unknown = JSON.parse(text);
      if (canonical(value) !== text) unavailable();
      return text;
    } finally {
      await handle.close();
    }
  }
  async #incarnation() {
    await this.#ancestry();
    const text = await this.#regular(".journal-incarnation-v1.json");
    if (text === null) unavailable();
    const marker: unknown = JSON.parse(text);
    const stat = await lstat(this.root, { bigint: true });
    if (
      !exact(marker, [
        "contractVersion",
        "identity",
        "root",
        "device",
        "inode",
      ]) ||
      marker["contractVersion"] !== 1 ||
      marker["identity"] !== this.identity ||
      marker["root"] !== this.root ||
      marker["device"] !== stat.dev.toString() ||
      marker["inode"] !== stat.ino.toString()
    )
      unavailable();
  }
  async #catalog() {
    const text = await this.#regular(".journal-catalog-v1.json");
    if (text === null) unavailable();
    const value: unknown = JSON.parse(text);
    if (
      !exact(value, ["contractVersion", "identity", "records"]) ||
      value["contractVersion"] !== 1 ||
      value["identity"] !== this.identity ||
      !Array.isArray(value["records"]) ||
      value["records"].length > maximumRecords * 3
    )
      unavailable();
    const records = new Map<string, string>();
    for (const entry of value["records"]) {
      if (
        !exact(entry, ["key", "sha256"]) ||
        typeof entry["key"] !== "string" ||
        !keyPattern.test(entry["key"]) ||
        typeof entry["sha256"] !== "string" ||
        !identityPattern.test(entry["sha256"]) ||
        records.has(entry["key"])
      )
        unavailable();
      records.set(entry["key"], entry["sha256"]);
    }
    return records;
  }
  async #catalogRecord(key: string, text: string) {
    const records = await this.#catalog(),
      sha256 = createHash("sha256").update(text).digest("hex");
    const existing = records.get(key);
    if (existing !== undefined) {
      if (existing !== sha256) unavailable();
      return;
    }
    records.set(key, sha256);
    if (records.size > maximumRecords * 3) unavailable();
    const pending = resolve(this.root, ".journal-catalog-v1.pending");
    const handle = await open(pending, "wx", 0o600);
    try {
      await handle.writeFile(
        canonical({
          contractVersion: 1,
          identity: this.identity,
          records: [...records]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, sha256]) => ({ key, sha256 })),
        }),
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(pending, resolve(this.root, ".journal-catalog-v1.json"));
    await this.#sync();
  }
  async #install(name: string, text: string) {
    const target = resolve(this.root, name);
    const temporary = target + ".pending-" + randomUUID();
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
    } catch (error) {
      let matches = false;
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        matches = (await this.#regular(name, true)) === text;
      if (!matches) {
        await unlink(temporary);
        await this.#sync();
        throw error;
      }
    }
    await this.#sync();
    await unlink(temporary).catch(async (error: unknown) => {
      if (!missing(error) || (await this.#regular(name)) !== text) throw error;
    });
    await this.#sync();
  }
  async #inventory() {
    await this.#incarnation();
    const names = await readdir(this.root);
    if (names.length > maximumRecords * 3 + 3) unavailable();
    if (names.includes(".journal-catalog-v1.pending")) unavailable();
    for (const name of names.filter((name) => name.includes(".pending-"))) {
      const split = name.lastIndexOf(".pending-");
      const committed = name.slice(0, split);
      if (
        !keyPattern.test(committed) ||
        !/^[a-f0-9-]{36}$/u.test(name.slice(split + 9))
      )
        unavailable();
      const pending = await this.#regular(name, true),
        final = await this.#regular(committed, true);
      if (pending === null && final !== null) continue;
      if (pending === null || final !== pending) unavailable();
      const p = await lstat(resolve(this.root, name), { bigint: true }),
        f = await lstat(resolve(this.root, committed), { bigint: true });
      // Only our exact installed hard-link pair can be resumed. Uninstalled or
      // unexplained staging remains quarantined; it cannot be swept by age.
      if (
        p.dev !== f.dev ||
        p.ino !== f.ino ||
        p.nlink !== 2n ||
        f.nlink !== 2n
      )
        unavailable();
      await this.#sync();
      await unlink(resolve(this.root, name)).catch((error: unknown) => {
        if (!missing(error)) throw error;
      });
      await this.#sync();
      await this.#catalogRecord(committed, final);
    }
    const catalogue = await this.#catalog();
    const entries: { key: string; value: unknown }[] = [];
    for (const name of await readdir(this.root)) {
      if (
        [
          ".journal-incarnation-v1.json",
          ".journal-catalog-v1.json",
          ".journal-operation-v1.lock",
        ].includes(name)
      )
        continue;
      if (!keyPattern.test(name)) unavailable();
      const text = await this.#regular(name);
      if (text === null) unavailable();
      const record: unknown = JSON.parse(text);
      if (
        !exact(record, ["contractVersion", "identity", "key", "value"]) ||
        record["contractVersion"] !== 1 ||
        record["identity"] !== this.identity ||
        record["key"] !== name
      )
        unavailable();
      if (
        catalogue.get(name) !== createHash("sha256").update(text).digest("hex")
      )
        unavailable();
      entries.push({ key: name, value: record["value"] });
    }
    if (entries.length !== catalogue.size) unavailable();
    await this.#incarnation();
    return entries.sort((a, b) => a.key.localeCompare(b.key));
  }
  #operation<T>(work: () => Promise<T>, provisioning = false): Promise<T> {
    if (this.#closed)
      return Promise.reject(
        Error("The durable server journal is unavailable."),
      );
    const result = this.#serial
      .then(async () => {
        if (provisioning) return work();
        await this.#ancestry();
        // Exclusive cross-process admission has no lease or age-based takeover.
        // A process killed while admitted leaves a quarantine marker; offline
        // recovery must establish completeness before that marker can be removed.
        const lock = resolve(this.root, ".journal-operation-v1.lock"),
          handle = await open(lock, "wx", 0o600);
        const admitted = await handle.stat({ bigint: true });
        try {
          await handle.sync();
          await this.#sync();
          return await work();
        } finally {
          const current = await lstat(lock, { bigint: true }).finally(() =>
            handle.close(),
          );
          if (
            current.dev !== admitted.dev ||
            current.ino !== admitted.ino ||
            current.nlink !== 1n
          )
            unavailable();
          await unlink(lock);
          await this.#sync();
        }
      })
      .catch(() => unavailable());
    this.#serial = result.catch(() => undefined);
    this.#active.add(result);
    void result.then(
      () => this.#active.delete(result),
      () => this.#active.delete(result),
    );
    return result;
  }
  /** Must be called separately by an authorized offline initializer. Missing
   * runtime history never silently becomes an empty replacement journal. */
  provision(): Promise<void> {
    return this.#operation(async () => {
      await mkdir(this.root, { mode: 0o700 });
      await this.#ancestry();
      const stat = await lstat(this.root, { bigint: true });
      const handle = await open(
        resolve(this.root, ".journal-incarnation-v1.json"),
        "wx",
        0o600,
      );
      try {
        await handle.writeFile(
          canonical({
            contractVersion: 1,
            identity: this.identity,
            root: this.root,
            device: stat.dev.toString(),
            inode: stat.ino.toString(),
          }),
          "utf8",
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      const catalogue = await open(
        resolve(this.root, ".journal-catalog-v1.json"),
        "wx",
        0o600,
      );
      try {
        await catalogue.writeFile(
          canonical({
            contractVersion: 1,
            identity: this.identity,
            records: [],
          }),
          "utf8",
        );
        await catalogue.sync();
      } finally {
        await catalogue.close();
      }
      await this.#sync();
      const parent = await open(dirname(this.root), constants.O_RDONLY);
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      await this.#incarnation();
    }, true);
  }
  assertReady(): Promise<void> {
    return this.#operation(async () => {
      await this.#inventory();
    });
  }
  entries(): Promise<
    readonly { readonly key: string; readonly value: unknown }[]
  > {
    return this.#operation(() => this.#inventory());
  }
  put(key: string, value: unknown): Promise<void> {
    return this.#operation(async () => {
      if (!keyPattern.test(key)) unavailable();
      await this.#inventory();
      const text = canonical({
        contractVersion: 1,
        identity: this.identity,
        key,
        value,
      });
      if (Buffer.byteLength(text) > maximumBytes) unavailable();
      await this.#install(key, text);
      await this.#catalogRecord(key, text);
      await this.#incarnation();
    });
  }
  /** A retained dispatch decision is never reopened, even for identical bytes. */
  createOnce(key: string, value: unknown): Promise<boolean> {
    return this.#operation(async () => {
      if (!keyPattern.test(key)) unavailable();
      const entries = await this.#inventory();
      const existing = entries.find((entry) => entry.key === key);
      if (existing !== undefined) {
        if (canonical(existing.value) !== canonical(value)) unavailable();
        return false;
      }
      const text = canonical({
        contractVersion: 1,
        identity: this.identity,
        key,
        value,
      });
      if (Buffer.byteLength(text) > maximumBytes) unavailable();
      await this.#install(key, text);
      await this.#catalogRecord(key, text);
      await this.#incarnation();
      return true;
    });
  }
  async close() {
    this.#closed = true;
    await Promise.allSettled([...this.#active]);
  }
}
