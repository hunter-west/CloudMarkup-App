import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve, sep } from "node:path";

import {
  isObjectPurpose,
  ObjectStoreError,
  type AuthorizedOrganizationScope,
  type ObjectStore,
  type StageObjectInput,
  type StoredObjectReference,
} from "../../application/persistence.js";
import {
  assertObjectReference,
  assertStageInput,
  buildStorageKey,
  collectAndVerify,
  referencesMatch,
  verifiedObjectStream,
} from "./object-store-common.js";
import type { ProjectErasureBinding } from "./s3-project-content-eraser.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const inventoryLimit = 100_000;
const pageSize = 128;
const requestName = ".project-erasure-request-v1";
const completeName = ".project-erasure-complete-v1";
interface ProjectInventoryObject {
  readonly path: string;
  readonly reference: StoredObjectReference;
  readonly payload: boolean;
  readonly decision: "published" | "discarded" | undefined;
  readonly deletion: boolean;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => actual.includes(key))
  );
}

function validateBinding(binding: ProjectErasureBinding): void {
  if (
    !exactKeys(binding, [
      "organizationId",
      "projectId",
      "deletionRequestedAt",
      "recordVersion",
    ]) ||
    typeof binding.organizationId !== "string" ||
    !identifier.test(binding.organizationId) ||
    typeof binding.projectId !== "string" ||
    !identifier.test(binding.projectId) ||
    binding.projectId === "organization" ||
    typeof binding.deletionRequestedAt !== "string" ||
    !Number.isFinite(Date.parse(binding.deletionRequestedAt)) ||
    !Number.isSafeInteger(binding.recordVersion) ||
    binding.recordVersion < 1
  )
    unavailable();
}

const magic = Buffer.from("CloudMarkupObject2\n");
interface RecordHeader {
  readonly storageContractVersion: 2;
  readonly reference: StoredObjectReference;
  readonly state: "staged" | "published" | "discarded" | "delete-pending";
}

function nodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
function unavailable(): never {
  // OS errors can contain server paths or object contents.
  throw new ObjectStoreError(
    "storage-unavailable",
    "The local object storage is unavailable.",
  );
}
function conflict(): never {
  throw new ObjectStoreError(
    "object-conflict",
    "The local object conflicts with existing state.",
  );
}

/** V2 installs one fsynced, self-identifying envelope by a no-replace hard link.
 * An immutable decision file arbitrates publish versus discard across processes.
 * Deletion is monotonic; retained tombstones prevent resurrection. There are no
 * locks for a crash to strand. V1 split files are deliberately refused: their
 * migration needs separately verified ownership. The operator must protect the
 * root from external writes. Atomic hard links and directory fsync are required;
 * unsupported filesystems fail closed, including Windows Node directory opens.
 * Staging retains the existing caller-bounded buffering; reads verify in chunks.
 */
export class DurableFilesystemObjectStore implements ObjectStore {
  readonly #root: string;
  readonly configurationSha256: string;

  constructor(root: string) {
    if (!isAbsolute(root) || resolve(root) === parse(resolve(root)).root) {
      throw new ObjectStoreError(
        "invalid-input",
        "The local storage root is invalid.",
      );
    }
    this.#root = resolve(root);
    this.configurationSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          policyVersion: 1,
          root: this.#root,
          inventoryLimit,
          pageSize,
          codec: "CloudMarkupObject2",
          requestName,
          completeName,
        }),
      )
      .digest("hex");
  }

  async initialize(): Promise<void> {
    await this.#operation(async () => {
      await this.#directory(this.#root);
      // An existing readable root is not proof of write or hard-link capability.
      // This exclusive directory belongs only to this invocation. Interrupted
      // probes are left for operator inspection, never swept by inference.
      const probe = resolve(this.#root, `.capability-probe-v2-${randomUUID()}`);
      await mkdir(probe, { mode: 0o700 });
      await this.#syncDirectory(this.#root);
      const path = resolve(probe, "probe");
      await this.#commit(
        path,
        Buffer.from("CloudMarkup filesystem capability probe v2\n"),
      );
      await unlink(path);
      await this.#syncDirectory(probe);
      await rmdir(probe);
      await this.#syncDirectory(this.#root);
    });
  }

  async stage(
    scope: AuthorizedOrganizationScope,
    input: StageObjectInput,
  ): Promise<StoredObjectReference> {
    try {
      assertStageInput(scope, input);
    } catch {
      throw new ObjectStoreError(
        "invalid-input",
        "The local object metadata is invalid.",
      );
    }
    const reference: StoredObjectReference = {
      contentSha256: input.contentSha256,
      entityTag: `"${input.contentSha256}"`,
      mediaType: input.mediaType,
      objectId: input.objectId,
      objectVersion: `sha256-${input.contentSha256}`,
      owner: { ...input.owner },
      purpose: input.purpose,
      sizeBytes: input.sizeBytes,
      storageKey: buildStorageKey(input),
      storageProvider: "filesystem",
    };
    this.#validate(scope, reference);
    const bytes = await this.#operation(() =>
      collectAndVerify({ ...input, ...reference }),
    );
    return this.#operation(async () => {
      await this.#assertProjectOpen(reference);
      const path = this.#path(reference);
      await this.#directory(dirname(path));
      await this.#rejectLegacy(path);
      const decision = await this.#record(
        `${path}.decision-v2`,
        scope,
        reference,
      );
      if (decision?.header.state === "discarded") conflict();
      if (decision?.header.state === "published") {
        // A committed publication cannot be repaired from caller-supplied bytes.
        await this.#requireObject(path, scope, reference);
      }
      await this.#commit(
        `${path}.object-v2`,
        this.#encode(reference, "staged", bytes),
      );
      const stored = await this.#record(`${path}.object-v2`, scope, reference);
      if (stored?.header.state !== "staged") unavailable();
      const winner = await this.#record(
        `${path}.decision-v2`,
        scope,
        reference,
      );
      if (winner?.header.state === "discarded") {
        await this.#removeDiscarded(path, scope, reference);
        conflict();
      }
      await this.#validateDeletion(path, scope, reference, winner);
      await this.#assertProjectOpen(reference);
      return stored.header.reference;
    });
  }

  async publish(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    this.#validate(scope, object);
    await this.#operation(async () => {
      await this.#assertProjectOpen(object);
      const path = this.#path(object);
      await this.#requireObject(path, scope, object);
      await this.#commit(
        `${path}.decision-v2`,
        this.#encode(object, "published"),
      );
      const decision = await this.#record(`${path}.decision-v2`, scope, object);
      if (decision?.header.state !== "published") conflict();
      await this.#assertProjectOpen(object);
    });
  }

  async requestDeletion(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    this.#validate(scope, object);
    await this.#operation(async () => {
      await this.#assertProjectOpen(object);
      const path = this.#path(object);
      await this.#requireObject(path, scope, object);
      const decision = await this.#record(`${path}.decision-v2`, scope, object);
      if (decision?.header.state !== "published") conflict();
      await this.#commit(
        `${path}.delete-v2`,
        this.#encode(object, "delete-pending"),
      );
      const deletion = await this.#record(`${path}.delete-v2`, scope, object);
      if (deletion?.header.state !== "delete-pending") unavailable();
    });
  }

  async discardStaged(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    this.#validate(scope, object);
    await this.#operation(async () => {
      await this.#assertProjectOpen(object);
      const path = this.#path(object);
      await this.#rejectLegacy(path);
      const existing = await this.#record(`${path}.decision-v2`, scope, object);
      if (existing?.header.state === "published") return;
      if (existing === null) {
        await this.#requireObject(path, scope, object);
        await this.#commit(
          `${path}.decision-v2`,
          this.#encode(object, "discarded"),
        );
      }
      const decision = await this.#record(`${path}.decision-v2`, scope, object);
      if (decision?.header.state === "discarded")
        await this.#removeDiscarded(path, scope, object);
      else if (decision?.header.state !== "published") unavailable();
    });
  }

  async head(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<StoredObjectReference | null> {
    this.#validate(scope, object);
    return this.#operation(async () => {
      await this.#assertProjectOpen(object);
      const path = this.#path(object);
      await this.#rejectLegacy(path);
      const decision = await this.#record(`${path}.decision-v2`, scope, object);
      if (decision?.header.state === "discarded") return null;
      const stored = await this.#record(`${path}.object-v2`, scope, object);
      if (stored === null && decision !== null) unavailable();
      await this.#validateDeletion(path, scope, object, decision);
      return stored?.header.reference ?? null;
    });
  }

  async open(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<AsyncIterable<Uint8Array>> {
    this.#validate(scope, object);
    const stored = await this.#operation(() =>
      this.#requireObject(this.#path(object), scope, object),
    );
    await this.#operation(() => this.#assertProjectOpen(object));
    const path = `${this.#path(object)}.object-v2`;
    const assertOpen = () => this.#assertProjectOpen(object);
    return verifiedObjectStream(
      (async function* () {
        // The adapter never replaces an envelope; a concurrent staged discard can
        // make this open fail, but can never redirect it to different content.
        try {
          for await (const chunk of createReadStream(path, {
            start: stored.bodyOffset,
          })) {
            if (!(chunk instanceof Uint8Array)) unavailable();
            await assertOpen();
            yield chunk;
          }
        } catch {
          unavailable();
        }
      })(),
      object.sizeBytes,
      object.contentSha256,
    );
  }

  #validate(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): void {
    try {
      assertObjectReference(scope, object);
      this.#validateMetadata(object);
    } catch {
      throw new ObjectStoreError(
        "invalid-input",
        "The local object reference is invalid.",
      );
    }
  }

  #validateMetadata(object: StoredObjectReference): void {
    if (
      typeof object.objectId !== "string" ||
      !identifier.test(object.objectId) ||
      typeof object.contentSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(object.contentSha256) ||
      typeof object.owner.organizationId !== "string" ||
      !identifier.test(object.owner.organizationId) ||
      (object.owner.projectId !== undefined &&
        (typeof object.owner.projectId !== "string" ||
          !identifier.test(object.owner.projectId)))
    )
      unavailable();
    const expectedKey = buildStorageKey({
      ...object,
      // Key construction consumes metadata only; this empty iterable is
      // never opened and carries no staged content.
      open: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () =>
            Promise.resolve({ done: true as const, value: undefined }),
        }),
      }),
    });
    if (
      !isObjectPurpose(object.purpose) ||
      !Number.isSafeInteger(object.sizeBytes) ||
      object.sizeBytes < 0 ||
      typeof object.mediaType !== "string" ||
      object.mediaType.length < 1 ||
      object.mediaType.length > 128 ||
      object.storageProvider !== "filesystem" ||
      object.storageKey !== expectedKey ||
      object.objectVersion !== `sha256-${object.contentSha256}` ||
      object.entityTag !== `"${object.contentSha256}"`
    )
      throw Error("Invalid reference");
  }

  #path(object: StoredObjectReference): string {
    const path = resolve(this.#root, ...object.storageKey.split("/"));
    if (!path.startsWith(`${this.#root}${sep}`)) {
      throw new ObjectStoreError(
        "invalid-input",
        "The local object path is invalid.",
      );
    }
    return path;
  }

  #encode(
    reference: StoredObjectReference,
    state: RecordHeader["state"],
    body: Uint8Array = new Uint8Array(),
  ): Buffer {
    const header = Buffer.from(
      JSON.stringify({
        reference,
        state,
        storageContractVersion: 2,
      } satisfies RecordHeader),
    );
    const size = Buffer.alloc(4);
    size.writeUInt32BE(header.length);
    return Buffer.concat([magic, size, header, body]);
  }

  async #record(
    path: string,
    scope: AuthorizedOrganizationScope,
    expected: StoredObjectReference,
  ): Promise<{ header: RecordHeader; bodyOffset: number } | null> {
    return this.#readEnvelope(path, (header) => {
      try {
        this.#validate(scope, header.reference);
      } catch {
        unavailable();
      }
      if (!referencesMatch(expected, header.reference)) conflict();
    });
  }

  async #readEnvelope(
    path: string,
    validate: (header: RecordHeader) => void,
    authorize?: () => Promise<void>,
  ): Promise<{ header: RecordHeader; bodyOffset: number } | null> {
    let handle: FileHandle;
    try {
      await this.#safePath(path);
      handle = await open(path, "r");
    } catch (error) {
      if (nodeError(error, "ENOENT")) return null;
      throw error;
    }
    try {
      const prefix = await this.#read(handle, magic.length + 4, 0);
      if (!prefix.subarray(0, magic.length).equals(magic)) unavailable();
      const size = prefix.readUInt32BE(magic.length);
      const offset = magic.length + 4 + size;
      if (size > 8192) unavailable();
      const value: unknown = JSON.parse(
        (await this.#read(handle, size, magic.length + 4)).toString("utf8"),
      );
      if (
        typeof value !== "object" ||
        value === null ||
        !("storageContractVersion" in value) ||
        value.storageContractVersion !== 2 ||
        !("state" in value) ||
        !["staged", "published", "discarded", "delete-pending"].includes(
          String(value.state),
        ) ||
        !("reference" in value) ||
        typeof value.reference !== "object" ||
        value.reference === null
      )
        unavailable();
      const header = value as RecordHeader;
      validate(header);
      const stat = await handle.stat();
      if (!stat.isFile() || (authorize !== undefined && stat.nlink !== 1))
        unavailable();
      const expected = header.reference;
      if (header.state === "staged") {
        const hash = createHash("sha256");
        let length = 0;
        for await (const chunk of handle.createReadStream({
          start: offset,
          autoClose: false,
        })) {
          await authorize?.();
          if (!(chunk instanceof Uint8Array)) unavailable();
          length += chunk.length;
          hash.update(chunk);
        }
        if (
          length !== expected.sizeBytes ||
          stat.size !== offset + expected.sizeBytes ||
          hash.digest("hex") !== expected.contentSha256
        ) {
          throw new ObjectStoreError(
            "content-mismatch",
            "The local object content does not match its metadata.",
          );
        }
      } else if (stat.size !== offset) unavailable();
      const states = path.endsWith(".object-v2")
        ? ["staged"]
        : path.endsWith(".decision-v2")
          ? ["published", "discarded"]
          : ["delete-pending"];
      if (!states.includes(header.state)) unavailable();
      return { header, bodyOffset: offset };
    } finally {
      await handle.close();
    }
  }

  async #read(
    handle: FileHandle,
    length: number,
    position: number,
  ): Promise<Buffer> {
    const bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const read = await handle.read(
        bytes,
        offset,
        length - offset,
        position + offset,
      );
      if (read.bytesRead === 0) unavailable();
      offset += read.bytesRead;
    }
    return bytes;
  }

  async #requireObject(
    path: string,
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ) {
    await this.#rejectLegacy(path);
    const decision = await this.#record(`${path}.decision-v2`, scope, object);
    if (decision?.header.state === "discarded")
      throw new ObjectStoreError("not-found", "The object is not available.");
    const stored = await this.#record(`${path}.object-v2`, scope, object);
    if (stored === null) {
      if (decision !== null) unavailable();
      throw new ObjectStoreError("not-found", "The object is not available.");
    }
    await this.#validateDeletion(path, scope, object, decision);
    return stored;
  }

  async #validateDeletion(
    path: string,
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
    decision: { header: RecordHeader } | null,
  ): Promise<void> {
    const deletion = await this.#record(`${path}.delete-v2`, scope, object);
    if (deletion === null) return;
    // Re-read if publication happened concurrently with the first snapshot.
    const published =
      decision ?? (await this.#record(`${path}.decision-v2`, scope, object));
    if (published?.header.state !== "published") unavailable();
  }

  async #removeDiscarded(
    path: string,
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    // Verify owned content even with a durable tombstone; ambiguous state stays.
    const decision = await this.#record(`${path}.decision-v2`, scope, object);
    if (decision?.header.state !== "discarded") unavailable();
    // Another process may have installed the decision but not synced it yet.
    // Fence its durability before any unlink, including on replay.
    await this.#syncDirectory(dirname(path));
    const stored = await this.#record(`${path}.object-v2`, scope, object);
    if (stored !== null) {
      try {
        await unlink(`${path}.object-v2`);
      } catch (error) {
        if (!nodeError(error, "ENOENT")) throw error;
      }
      await this.#syncDirectory(dirname(path));
    }
  }

  async #commit(path: string, bytes: Uint8Array): Promise<void> {
    // A visible object/decision may belong to a concurrent unacknowledged stage.
    // Fence the entire directory chain before acknowledging any new commit.
    await this.#directory(dirname(path));
    const temporary = `${path}.pending-${randomUUID()}`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, path);
      } catch (error) {
        if (!nodeError(error, "EEXIST")) throw error;
      }
      await this.#syncDirectory(dirname(path));
    } finally {
      await unlink(temporary);
    }
  }

  async #rejectLegacy(path: string): Promise<void> {
    for (const legacy of [path, `${path}.metadata.json`]) {
      try {
        await lstat(legacy);
        unavailable();
      } catch (error) {
        if (!nodeError(error, "ENOENT")) throw error;
      }
    }
  }

  async #safePath(path: string): Promise<void> {
    let cursor = this.#root;
    const root = await lstat(cursor);
    if (!root.isDirectory() || root.isSymbolicLink()) unavailable();
    for (const part of path.slice(this.#root.length + 1).split(sep)) {
      cursor = resolve(cursor, part);
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) unavailable();
    }
  }

  async #directory(path: string): Promise<void> {
    const parent = dirname(path);
    // Another process can expose a directory before syncing its parent entry.
    // Existing ancestors need the same durability fence as newly created ones.
    if (parent !== path) {
      await this.#directory(parent);
      await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
        if (!nodeError(error, "EEXIST")) throw error;
      });
    }
    // A filesystem root already exists. mkdir(root) fails on Windows, but
    // validation and directory fsync still apply to the complete ancestry.
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) unavailable();
    await this.#syncDirectory(path);
    if (parent !== path) await this.#syncDirectory(parent);
  }

  async #syncDirectory(path: string): Promise<void> {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #operation<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ObjectStoreError) throw error;
      unavailable();
    }
  }

  #projectPath(owner: {
    readonly organizationId: string;
    readonly projectId?: string;
  }): string {
    return resolve(
      this.#root,
      "v1",
      "organizations",
      owner.organizationId,
      "projects",
      owner.projectId ?? "organization",
    );
  }

  async #assertProjectOpen(object: StoredObjectReference): Promise<void> {
    // The authenticated object methods keep their existing scope validation.
    // This durable gate also applies after a process restart.
    for (const name of [requestName, completeName]) {
      try {
        await this.#safePath(resolve(this.#projectPath(object.owner), name));
        conflict();
      } catch (error) {
        if (!nodeError(error, "ENOENT")) throw error;
      }
    }
  }

  #markerBytes(
    binding: ProjectErasureBinding,
    state: "requested" | "complete",
  ): Buffer {
    return Buffer.from(
      JSON.stringify({
        storageErasureVersion: 1,
        state,
        configurationSha256: this.configurationSha256,
        binding: {
          organizationId: binding.organizationId,
          projectId: binding.projectId,
          deletionRequestedAt: binding.deletionRequestedAt,
          recordVersion: binding.recordVersion,
        },
      }) + "\n",
    );
  }

  async #marker(
    binding: ProjectErasureBinding,
    state: "requested" | "complete",
  ): Promise<boolean> {
    const path = resolve(
      this.#projectPath(binding),
      state === "requested" ? requestName : completeName,
    );
    let handle: FileHandle;
    try {
      await this.#safePath(path);
      handle = await open(path, "r");
    } catch (error) {
      if (nodeError(error, "ENOENT")) return false;
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) unavailable();
      const bytes = await this.#read(handle, stat.size, 0);
      // Exact canonical bytes reject unknown fields, incarnations and root pins.
      if (!bytes.equals(this.#markerBytes(binding, state))) unavailable();
      return true;
    } finally {
      await handle.close();
    }
  }

  async #authorityIo<T>(
    authorize: () => Promise<void>,
    work: () => Promise<T>,
  ): Promise<T> {
    await authorize();
    const value = await work();
    await authorize();
    return value;
  }

  async #inventory(
    binding: ProjectErasureBinding,
    authorize: () => Promise<void>,
  ) {
    validateBinding(binding);
    let entries = 0;
    const io = <T>(work: () => Promise<T>) =>
      this.#authorityIo(authorize, work);
    const list = async (path: string): Promise<string[]> =>
      io(async () => {
        try {
          await this.#safePath(path);
        } catch (error) {
          if (nodeError(error, "ENOENT")) return [];
          throw error;
        }
        const stat = await lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) unavailable();
        const result: string[] = [];
        // Streaming enumeration bounds memory before accepting an empty result.
        for await (const entry of await opendir(path)) {
          await authorize();
          if (++entries > inventoryLimit) unavailable();
          result.push(entry.name);
        }
        return result.sort();
      });
    const directory = async (path: string) =>
      io(async () => {
        await this.#safePath(path);
        const stat = await lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) unavailable();
      });
    for (const name of await list(this.#root)) {
      if (name !== "v1") unavailable();
      await directory(resolve(this.#root, name));
    }
    const requested = await io(() => this.#marker(binding, "requested"));
    const complete = await io(() => this.#marker(binding, "complete"));
    if (complete && !requested) unavailable();
    const project = this.#projectPath(binding);
    const objects: ProjectInventoryObject[] = [];
    for (const purpose of await list(project)) {
      if (purpose === requestName || purpose === completeName) continue;
      if (!isObjectPurpose(purpose)) unavailable();
      const purposePath = resolve(project, purpose);
      await directory(purposePath);
      for (const objectId of await list(purposePath)) {
        if (!identifier.test(objectId)) unavailable();
        const objectPath = resolve(purposePath, objectId);
        await directory(objectPath);
        const groups = new Map<string, Map<string, RecordHeader>>();
        for (const name of await list(objectPath)) {
          const match = /^([a-f0-9]{64})\.(object|decision|delete)-v2$/u.exec(
            name,
          );
          if (match === null) unavailable();
          const digest = match[1],
            kind = match[2];
          if (digest === undefined || kind === undefined) unavailable();
          const path = resolve(objectPath, name);
          const decoded = await io(() =>
            this.#readEnvelope(
              path,
              (header) => {
                const reference = header.reference;
                if (
                  !exactKeys(header, [
                    "reference",
                    "state",
                    "storageContractVersion",
                  ]) ||
                  !exactKeys(reference, [
                    "contentSha256",
                    "entityTag",
                    "mediaType",
                    "objectId",
                    "objectVersion",
                    "owner",
                    "purpose",
                    "sizeBytes",
                    "storageKey",
                    "storageProvider",
                  ]) ||
                  !exactKeys(reference.owner, ["organizationId", "projectId"])
                )
                  unavailable();
                this.#validateMetadata(reference);
                if (
                  reference.owner.organizationId !== binding.organizationId ||
                  reference.owner.projectId !== binding.projectId ||
                  reference.objectId !== objectId ||
                  reference.purpose !== purpose ||
                  reference.contentSha256 !== digest ||
                  this.#path(reference) !== resolve(objectPath, digest)
                )
                  unavailable();
              },
              authorize,
            ),
          );
          if (decoded === null) unavailable();
          const group = groups.get(digest) ?? new Map<string, RecordHeader>();
          group.set(kind, decoded.header);
          groups.set(digest, group);
        }
        for (const [digest, group] of groups) {
          const payload = group.get("object"),
            decision = group.get("decision"),
            deletion = group.get("delete");
          const first = payload ?? decision ?? deletion;
          if (
            first === undefined ||
            [...group.values()].some(
              (entry) => !referencesMatch(first.reference, entry.reference),
            )
          )
            unavailable();
          if (deletion !== undefined && decision?.state !== "published")
            unavailable();
          if (
            payload === undefined &&
            decision?.state !== "discarded" &&
            !(
              requested &&
              decision?.state === "published" &&
              deletion?.state === "delete-pending"
            )
          )
            unavailable();
          if (complete && payload !== undefined) unavailable();
          const decisionState = decision?.state;
          if (
            decisionState !== undefined &&
            decisionState !== "published" &&
            decisionState !== "discarded"
          )
            unavailable();
          objects.push({
            path: resolve(objectPath, digest),
            reference: first.reference,
            payload: payload !== undefined,
            decision: decisionState,
            deletion: deletion !== undefined,
          });
        }
      }
    }
    await authorize();
    return { objects, requested, complete };
  }

  /** Host-only coverage uses trusted deletion identity, never a fabricated scope.
   * SQL references and orphan physical envelopes are both inventoried. */
  async assertProjectReferenceCoverage(
    binding: ProjectErasureBinding,
    references: readonly StoredObjectReference[],
  ): Promise<void> {
    await this.#operation(async () => {
      if (references.length > inventoryLimit) unavailable();
      const inventory = await this.#inventory(binding, () => Promise.resolve());
      const actual = new Map(
        inventory.objects.map((entry) => [
          entry.reference.storageKey,
          entry.reference,
        ]),
      );
      const seen = new Set<string>();
      for (const reference of references) {
        this.#validateMetadata(reference);
        if (
          reference.owner.organizationId !== binding.organizationId ||
          reference.owner.projectId !== binding.projectId ||
          seen.has(reference.storageKey)
        )
          unavailable();
        seen.add(reference.storageKey);
        const observed = actual.get(reference.storageKey);
        if (observed === undefined || !referencesMatch(reference, observed))
          unavailable();
      }
    });
  }

  /** Requires closed, drained durable writer authority supplied by the host.
   * This proves active-root absence only; backups and SQL completion are separate. */
  async eraseProjectPage(
    binding: ProjectErasureBinding,
    authorize: () => Promise<void>,
  ): Promise<{ readonly observedEmpty: boolean }> {
    return this.#operation(async () => {
      if (typeof authorize !== "function") unavailable();
      const inventory = await this.#inventory(binding, authorize);
      const project = this.#projectPath(binding);
      const io = <T>(work: () => Promise<T>) =>
        this.#authorityIo(authorize, work);
      if (!inventory.requested) {
        await io(() =>
          this.#commit(
            resolve(project, requestName),
            this.#markerBytes(binding, "requested"),
          ),
        );
        if (!(await io(() => this.#marker(binding, "requested"))))
          unavailable();
      }
      // A replay may observe a request installed before its parent's fsync.
      await io(() => this.#directory(project));
      for (const entry of inventory.objects
        .filter((object) => object.payload)
        .slice(0, pageSize)) {
        if (entry.decision === "published") {
          await io(() =>
            this.#commit(
              `${entry.path}.delete-v2`,
              this.#encode(entry.reference, "delete-pending"),
            ),
          );
        } else if (entry.decision === undefined) {
          await io(() =>
            this.#commit(
              `${entry.path}.decision-v2`,
              this.#encode(entry.reference, "discarded"),
            ),
          );
        }
        const verify = (header: RecordHeader) => {
          this.#validateMetadata(header.reference);
          if (!referencesMatch(entry.reference, header.reference))
            unavailable();
        };
        const decision = await io(() =>
          this.#readEnvelope(`${entry.path}.decision-v2`, verify, authorize),
        );
        if (
          decision?.header.state !==
          (entry.decision === "published" ? "published" : "discarded")
        )
          unavailable();
        const deletion = await io(() =>
          this.#readEnvelope(`${entry.path}.delete-v2`, verify, authorize),
        );
        if (
          entry.decision === "published"
            ? deletion?.header.state !== "delete-pending"
            : deletion !== null
        )
          unavailable();
        // Install controls and fence their durability before touching payloads.
        await io(() => this.#syncDirectory(dirname(entry.path)));
        await io(async () => {
          await this.#safePath(`${entry.path}.object-v2`);
          const stat = await lstat(`${entry.path}.object-v2`);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
            unavailable();
          await authorize();
          await unlink(`${entry.path}.object-v2`);
          await this.#syncDirectory(dirname(entry.path));
        });
      }
      const after = await this.#inventory(binding, authorize);
      const observedEmpty = after.objects.every((object) => !object.payload);
      if (observedEmpty && !after.complete) {
        await io(() =>
          this.#commit(
            resolve(project, completeName),
            this.#markerBytes(binding, "complete"),
          ),
        );
        if (!(await io(() => this.#marker(binding, "complete")))) unavailable();
      }
      await authorize();
      return { observedEmpty };
    });
  }
}
