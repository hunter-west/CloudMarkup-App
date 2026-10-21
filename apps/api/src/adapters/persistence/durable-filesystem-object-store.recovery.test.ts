import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, parse, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AuthorizedOrganizationScope,
  StageObjectInput,
  StoredObjectReference,
} from "../../application/persistence.js";
import { DurableFilesystemObjectStore } from "./durable-filesystem-object-store.js";
import { buildStorageKey } from "./object-store-common.js";

// These fixtures simulate selected interruption points, not power loss. Windows
// cannot fsync directories with Node: only that operation is simulated here.
// The shared harness separately tests the native adapter's fail-closed behavior.
const faults = vi.hoisted(() => ({
  failInstall: false,
  failNextSync: false,
  failAfterInstall: false,
  failDirectorySyncAt: null as string | null,
  failPayloadUnlink: false,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    unlink: vi.fn(async (path: Parameters<typeof fs.unlink>[0]) => {
      if (faults.failPayloadUnlink && String(path).endsWith(".object-v2")) {
        faults.failPayloadUnlink = false;
        throw Error("synthetic payload unlink interruption");
      }
      await fs.unlink(path);
    }),
    mkdir: vi.fn(async (...args: Parameters<typeof fs.mkdir>) => {
      const path = resolve(String(args[0]));
      if (path === parse(path).root)
        throw Error("synthetic existing filesystem root cannot be created");
      return fs.mkdir(...args);
    }),
    link: vi.fn(async (from: string, to: string) => {
      if (faults.failInstall) {
        faults.failInstall = false;
        throw Error("synthetic installation interruption");
      }
      await fs.link(from, to);
      if (faults.failAfterInstall) {
        faults.failAfterInstall = false;
        faults.failNextSync = true;
      }
    }),
    open: vi.fn(async (...args: Parameters<typeof fs.open>) => {
      const directory =
        (await fs.lstat(args[0]).catch(() => null))?.isDirectory() === true;
      if (directory && String(args[0]) === faults.failDirectorySyncAt) {
        faults.failDirectorySyncAt = null;
        throw Error("synthetic unfenced ancestor sync interruption");
      }
      if (directory && process.platform === "win32") {
        return {
          sync: () => {
            if (faults.failNextSync) {
              faults.failNextSync = false;
              return Promise.reject(
                Error("synthetic directory sync interruption"),
              );
            }
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        } as Awaited<ReturnType<typeof fs.open>>;
      }
      const handle = await fs.open(...args);
      if (directory && faults.failNextSync) {
        faults.failNextSync = false;
        await handle.close();
        throw Error("synthetic directory sync interruption");
      }
      return handle;
    }),
  };
});

const scope: AuthorizedOrganizationScope = {
  capabilities: ["projects.write"],
  correlationId: "synthetic_correlation",
  membershipId: "synthetic_membership",
  organizationId: "synthetic_org",
  principalId: "synthetic_principal",
  roleKey: "test-owner",
  sessionId: "synthetic_session",
};
const directories: string[] = [];
afterEach(async () => {
  faults.failInstall = faults.failNextSync = faults.failAfterInstall = false;
  faults.failDirectorySyncAt = null;
  faults.failPayloadUnlink = false;
  vi.clearAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
function payload(): StageObjectInput {
  const bytes = Buffer.from("synthetic immutable content");
  return {
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "application/json",
    objectId: "synthetic_object",
    open: () =>
      (async function* () {
        yield bytes;
        await Promise.resolve();
      })(),
    owner: {
      organizationId: scope.organizationId,
      projectId: "synthetic_project",
    },
    purpose: "architecture-draft",
    sizeBytes: bytes.length,
  };
}
function reference(input = payload()): StoredObjectReference {
  return {
    contentSha256: input.contentSha256,
    entityTag: `"${input.contentSha256}"`,
    mediaType: input.mediaType,
    objectId: input.objectId,
    objectVersion: `sha256-${input.contentSha256}`,
    owner: input.owner,
    purpose: input.purpose,
    sizeBytes: input.sizeBytes,
    storageKey: buildStorageKey(input),
    storageProvider: "filesystem",
  };
}
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "cm-recovery-synthetic-"));
  directories.push(root);
  return {
    root,
    store: new DurableFilesystemObjectStore(root),
    path: resolve(root, reference().storageKey),
  };
}
async function body(
  store: DurableFilesystemObjectStore,
  object: StoredObjectReference,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of await store.open(scope, object)) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

describe("filesystem V2 commit protocol with synthetic interruptions", () => {
  it("proves write, file sync, hard-link installation, and directory capability before readiness", async () => {
    const f = await fixture();
    await f.store.initialize();
    expect(vi.mocked(link).mock.calls.length).toBe(1);
    expect(await readdir(f.root)).toEqual([]);
    faults.failInstall = true;
    await expect(f.store.initialize()).rejects.toMatchObject({
      code: "storage-unavailable",
    });
  });
  it("validates and syncs the filesystem root without trying to create it", async () => {
    const f = await fixture();
    await f.store.initialize();
    const root = parse(f.root).root;
    expect(
      vi
        .mocked(mkdir)
        .mock.calls.some(([path]) => resolve(String(path)) === root),
    ).toBe(false);
    expect(
      vi
        .mocked(open)
        .mock.calls.some(([path]) => resolve(String(path)) === root),
    ).toBe(true);
  });

  it.each(["stage", "publish", "discard", "delete"] as const)(
    "fences an observed ancestor before acknowledging %s",
    async (operation) => {
      const f = await fixture();
      // This observed hierarchy models another process paused after mkdir but
      // before its parent fsync. A leaf sync alone cannot fence the root entry.
      await mkdir(dirname(f.path), { recursive: true });
      if (operation !== "stage") await f.store.stage(scope, payload());
      if (operation === "delete") await f.store.publish(scope, reference());
      vi.clearAllMocks();
      faults.failDirectorySyncAt = f.root;
      const attempt =
        operation === "stage"
          ? f.store.stage(scope, payload())
          : operation === "publish"
            ? f.store.publish(scope, reference())
            : operation === "discard"
              ? f.store.discardStaged(scope, reference())
              : f.store.requestDeletion(scope, reference());
      await expect(attempt).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      expect(link).not.toHaveBeenCalled();
      if (operation !== "stage")
        expect(await f.store.head(scope, reference())).toEqual(reference());
      else expect(await f.store.stage(scope, payload())).toEqual(reference());
    },
  );

  it("restarts from one committed envelope without a metadata sidecar", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    await expect(lstat(`${f.path}.metadata.json`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const restarted = new DurableFilesystemObjectStore(f.root);
    expect(await restarted.stage(scope, payload())).toEqual(object);
    expect(await restarted.head(scope, object)).toEqual(object);
    expect(await body(restarted, object)).toBe("synthetic immutable content");
  });

  it("recovers replay after installation interrupted before directory sync", async () => {
    const f = await fixture();
    faults.failAfterInstall = true;
    await expect(f.store.stage(scope, payload())).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    expect((await lstat(`${f.path}.object-v2`)).isFile()).toBe(true);
    const restarted = new DurableFilesystemObjectStore(f.root);
    expect(await restarted.stage(scope, payload())).toEqual(reference());
    expect(await body(restarted, reference())).toBe(
      "synthetic immutable content",
    );
  });

  it.each(["publish", "discard", "delete"] as const)(
    "replays an interrupted %s decision monotonically after restart",
    async (operation) => {
      const f = await fixture();
      const object = await f.store.stage(scope, payload());
      if (operation === "delete") await f.store.publish(scope, object);
      faults.failAfterInstall = true;
      const interrupt =
        operation === "publish"
          ? f.store.publish(scope, object)
          : operation === "discard"
            ? f.store.discardStaged(scope, object)
            : f.store.requestDeletion(scope, object);
      await expect(interrupt).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      const restarted = new DurableFilesystemObjectStore(f.root);
      if (operation === "discard") {
        await restarted.discardStaged(scope, object);
        expect(await restarted.head(scope, object)).toBeNull();
        await expect(restarted.stage(scope, payload())).rejects.toMatchObject({
          code: "object-conflict",
        });
      } else {
        if (operation === "publish") await restarted.publish(scope, object);
        else await restarted.requestDeletion(scope, object);
        await restarted.discardStaged(scope, object);
        expect(await restarted.head(scope, object)).toEqual(object);
        expect(await body(restarted, object)).toBe(
          "synthetic immutable content",
        );
      }
    },
  );

  it("retries safely when installation fails before the canonical object exists", async () => {
    const f = await fixture();
    faults.failInstall = true;
    await expect(f.store.stage(scope, payload())).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    expect(await f.store.head(scope, reference())).toBeNull();
    expect(
      await new DurableFilesystemObjectStore(f.root).stage(scope, payload()),
    ).toEqual(reference());
  });

  it("never mistakes uncommitted temporary bytes for a recoverable object", async () => {
    const f = await fixture();
    await mkdir(dirname(f.path), { recursive: true });
    const orphan = `${f.path}.object-v2.pending-synthetic-interruption`;
    await writeFile(orphan, "ambiguous incomplete bytes");
    expect(await f.store.head(scope, reference())).toBeNull();
    await f.store.stage(scope, payload());
    expect(await readFile(orphan, "utf8")).toBe("ambiguous incomplete bytes");
  });

  it("binds streamed bytes to the metadata captured before a caller mutates its input", async () => {
    const f = await fixture();
    const input = { ...payload() };
    const expected = reference(input);
    input.open = () =>
      (async function* () {
        yield Buffer.from("synthetic immutable content");
        input.contentSha256 = "0".repeat(64);
        input.mediaType = "text/plain";
        await Promise.resolve();
      })();
    expect(await f.store.stage(scope, input)).toEqual(expected);
    expect(await f.store.head(scope, expected)).toEqual(expected);
  });

  it.each(["data-only", "metadata-only", "complete-v1"])(
    "refuses and preserves legacy %s state without inferring ownership",
    async (state) => {
      const f = await fixture();
      await mkdir(dirname(f.path), { recursive: true });
      if (state !== "metadata-only")
        await writeFile(f.path, "ambiguous legacy bytes");
      if (state !== "data-only")
        await writeFile(
          `${f.path}.metadata.json`,
          JSON.stringify({
            storageContractVersion: 1,
            state: "staged",
            reference: reference(),
          }),
        );
      await expect(f.store.stage(scope, payload())).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      await expect(f.store.head(scope, reference())).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      await expect(
        f.store.discardStaged(scope, reference()),
      ).rejects.toMatchObject({ code: "storage-unavailable" });
      if (state !== "metadata-only")
        expect(await readFile(f.path, "utf8")).toBe("ambiguous legacy bytes");
      if (state !== "data-only")
        expect(await readFile(`${f.path}.metadata.json`, "utf8")).toContain(
          '"storageContractVersion":1',
        );
    },
  );

  it("arbitrates same-key concurrent replay across independent instances without replacing bytes", async () => {
    const f = await fixture();
    const references = await Promise.all(
      Array.from({ length: 8 }, () =>
        new DurableFilesystemObjectStore(f.root).stage(scope, payload()),
      ),
    );
    expect(
      references.every(
        (object) => JSON.stringify(object) === JSON.stringify(reference()),
      ),
    ).toBe(true);
    const before = await readFile(`${f.path}.object-v2`);
    await expect(
      f.store.stage(scope, { ...payload(), mediaType: "text/plain" }),
    ).rejects.toMatchObject({ code: "object-conflict" });
    expect(await readFile(`${f.path}.object-v2`)).toEqual(before);
  });

  it.each(["truncated", "corrupt", "bad-header"])(
    "rejects and preserves %s committed content on replay, read, publish, and discard",
    async (fault) => {
      const f = await fixture();
      const object = await f.store.stage(scope, payload());
      const bytes = await readFile(`${f.path}.object-v2`);
      const altered =
        fault === "truncated"
          ? bytes.subarray(0, bytes.length - 1)
          : Buffer.from(bytes);
      if (fault === "corrupt")
        altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 1;
      if (fault === "bad-header") altered[0] = 0;
      await writeFile(`${f.path}.object-v2`, altered);
      const code =
        fault === "bad-header" ? "storage-unavailable" : "content-mismatch";
      for (const operation of [
        () => f.store.stage(scope, payload()),
        () => f.store.head(scope, object),
        () => f.store.open(scope, object),
        () => f.store.publish(scope, object),
        () => f.store.discardStaged(scope, object),
      ]) {
        await expect(operation()).rejects.toMatchObject({ code });
      }
      expect(await readFile(`${f.path}.object-v2`)).toEqual(altered);
    },
  );

  it("rejects a published marker whose data envelope is missing", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    await f.store.publish(scope, object);
    await unlink(`${f.path}.object-v2`);
    await expect(f.store.head(scope, object)).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    await expect(f.store.open(scope, object)).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    // Published data must never be reconstructed by a stage replay.
    await expect(f.store.stage(scope, payload())).rejects.toMatchObject({
      code: "storage-unavailable",
    });
  });

  it("retains a discard tombstone through restart and refuses resurrection", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    await f.store.discardStaged(scope, object);
    const restarted = new DurableFilesystemObjectStore(f.root);
    await restarted.discardStaged(scope, object);
    expect(await restarted.head(scope, object)).toBeNull();
    await expect(restarted.stage(scope, payload())).rejects.toMatchObject({
      code: "object-conflict",
    });
    await expect(restarted.publish(scope, object)).rejects.toMatchObject({
      code: "not-found",
    });
    expect((await lstat(`${f.path}.decision-v2`)).isFile()).toBe(true);
  });

  it("resumes positively identified discarded cleanup after interrupted unlink", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    // Keep a verified copy to recreate only the exact interrupted leftover.
    const bytes = await readFile(`${f.path}.object-v2`);
    await f.store.discardStaged(scope, object);
    await writeFile(`${f.path}.object-v2`, bytes);
    // A second process must fence an observed tombstone's durability before
    // removing the leftover envelope, even if its creator has not synced yet.
    faults.failNextSync = true;
    await expect(
      new DurableFilesystemObjectStore(f.root).discardStaged(scope, object),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
    expect(await readFile(`${f.path}.object-v2`)).toEqual(bytes);
    await new DurableFilesystemObjectStore(f.root).discardStaged(scope, object);
    await expect(lstat(`${f.path}.object-v2`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("publication and discard have one durable winner across stores", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    const publishing = new DurableFilesystemObjectStore(f.root);
    const discarding = new DurableFilesystemObjectStore(f.root);
    const outcomes = await Promise.allSettled([
      publishing.publish(scope, object),
      discarding.discardStaged(scope, object),
    ]);
    const restarted = new DurableFilesystemObjectStore(f.root);
    const found = await restarted.head(scope, object);
    if (outcomes[0].status === "fulfilled") {
      expect(found).toEqual(object);
      expect(await body(restarted, object)).toBe("synthetic immutable content");
    } else {
      expect(found).toBeNull();
      await expect(restarted.stage(scope, payload())).rejects.toMatchObject({
        code: "object-conflict",
      });
    }
  });

  it("cannot revert deletion by publishing again or discard published content", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    await f.store.publish(scope, object);
    await Promise.all([
      f.store.requestDeletion(scope, object),
      new DurableFilesystemObjectStore(f.root).publish(scope, object),
      new DurableFilesystemObjectStore(f.root).discardStaged(scope, object),
    ]);
    const marker = await readFile(`${f.path}.delete-v2`);
    await new DurableFilesystemObjectStore(f.root).publish(scope, object);
    await new DurableFilesystemObjectStore(f.root).requestDeletion(
      scope,
      object,
    );
    expect(await readFile(`${f.path}.delete-v2`)).toEqual(marker);
    expect(await f.store.head(scope, object)).toEqual(object);
    expect(await body(f.store, object)).toBe("synthetic immutable content");
  });

  it.each(["decision", "delete"] as const)(
    "preserves published content when its %s marker is malformed",
    async (marker) => {
      const f = await fixture();
      const object = await f.store.stage(scope, payload());
      await f.store.publish(scope, object);
      if (marker === "delete") await f.store.requestDeletion(scope, object);
      const content = await readFile(`${f.path}.object-v2`);
      await writeFile(`${f.path}.${marker}-v2`, "ambiguous marker");
      for (const operation of [
        () => f.store.stage(scope, payload()),
        () => f.store.head(scope, object),
        () => f.store.publish(scope, object),
        () => f.store.requestDeletion(scope, object),
      ]) {
        await expect(operation()).rejects.toMatchObject({
          code: "storage-unavailable",
        });
      }
      if (marker === "decision")
        await expect(
          f.store.discardStaged(scope, object),
        ).rejects.toMatchObject({ code: "storage-unavailable" });
      else await f.store.discardStaged(scope, object);
      expect(await readFile(`${f.path}.object-v2`)).toEqual(content);
      expect(await readFile(`${f.path}.${marker}-v2`, "utf8")).toBe(
        "ambiguous marker",
      );
    },
  );

  it("rejects wrong versions, forged keys, and cross-tenant access before touching disk", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    for (const invalid of [
      { ...object, objectVersion: "other" },
      { ...object, storageKey: "../../outside" },
      { ...object, owner: { organizationId: "synthetic_other" } },
      { ...object, storageProvider: "s3" as const },
    ]) {
      for (const operation of [
        () => f.store.head(scope, invalid),
        () => f.store.open(scope, invalid),
        () => f.store.publish(scope, invalid),
        () => f.store.discardStaged(scope, invalid),
        () => f.store.requestDeletion(scope, invalid),
      ]) {
        await expect(operation()).rejects.toMatchObject({
          code: "invalid-input",
        });
      }
    }
    const other = { ...scope, organizationId: "synthetic_other" };
    await expect(f.store.stage(other, payload())).rejects.toMatchObject({
      code: "invalid-input",
    });
    for (const operation of [
      () => f.store.head(other, object),
      () => f.store.open(other, object),
      () => f.store.publish(other, object),
      () => f.store.discardStaged(other, object),
      () => f.store.requestDeletion(other, object),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: "invalid-input",
      });
    }
    expect(await f.store.head(scope, object)).toEqual(object);
  });

  it.runIf(process.platform !== "win32")(
    "refuses symlinked object paths without reading or deleting their targets",
    async () => {
      const f = await fixture();
      await mkdir(dirname(f.path), { recursive: true });
      const outside = resolve(f.root, "synthetic-external-content");
      await writeFile(outside, "ambiguous external bytes");
      await symlink(outside, `${f.path}.object-v2`);
      await expect(f.store.head(scope, reference())).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      await expect(f.store.stage(scope, payload())).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      expect(await readFile(outside, "utf8")).toBe("ambiguous external bytes");
    },
  );

  it("does not leak filesystem paths or raw interruption errors", async () => {
    expect.assertions(5);
    const f = await fixture();
    faults.failInstall = true;
    try {
      await f.store.stage(scope, payload());
    } catch (error) {
      expect(String(error)).not.toContain(f.root);
      expect(String(error)).not.toContain("synthetic installation");
      expect(error).not.toHaveProperty("cause");
    }
    expect(vi.mocked(link).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(open).mock.calls.length).toBeGreaterThan(0);
  });
});

const deletionBinding = {
  organizationId: scope.organizationId,
  projectId: "synthetic_project",
  deletionRequestedAt: "2026-10-13T00:00:00.000Z",
  recordVersion: 2,
};
const authorized = () => Promise.resolve();

describe("filesystem project erasure under closed writer authority", () => {
  it("limits each erase page and refuses an absence acknowledgement while any orphan payload remains", async () => {
    const f = await fixture();
    for (let index = 0; index < 129; index += 1)
      await f.store.stage(scope, {
        ...payload(),
        objectId: `orphan_${String(index)}`,
      });
    expect(await f.store.eraseProjectPage(deletionBinding, authorized)).toEqual(
      { observedEmpty: false },
    );
    expect(
      await new DurableFilesystemObjectStore(f.root).eraseProjectPage(
        deletionBinding,
        authorized,
      ),
    ).toEqual({ observedEmpty: true });
  });
  it("erases retained and orphan bytes, preserves unrelated projects and tombstones, and refuses resurrection after restart", async () => {
    const f = await fixture();
    const published = await f.store.stage(scope, payload());
    await f.store.publish(scope, published);
    await f.store.requestDeletion(scope, published);
    const orphan = await f.store.stage(scope, {
      ...payload(),
      objectId: "orphan",
    });
    const unrelated = await f.store.stage(scope, {
      ...payload(),
      owner: { ...payload().owner, projectId: "unrelated" },
    });
    await f.store.assertProjectReferenceCoverage(deletionBinding, [published]);
    expect(await f.store.eraseProjectPage(deletionBinding, authorized)).toEqual(
      { observedEmpty: true },
    );
    for (const reference of [published, orphan]) {
      expect(
        await lstat(resolve(f.root, `${reference.storageKey}.object-v2`)).catch(
          () => null,
        ),
      ).toBeNull();
      expect(
        (
          await lstat(resolve(f.root, `${reference.storageKey}.decision-v2`))
        ).isFile(),
      ).toBe(true);
    }
    expect(await body(f.store, unrelated)).toBe("synthetic immutable content");
    const restarted = new DurableFilesystemObjectStore(f.root);
    expect(
      await restarted.eraseProjectPage(deletionBinding, authorized),
    ).toEqual({ observedEmpty: true });
    await restarted.assertProjectReferenceCoverage(deletionBinding, [
      published,
    ]);
    await expect(restarted.stage(scope, payload())).rejects.toMatchObject({
      code: "object-conflict",
    });
    await expect(restarted.publish(scope, published)).rejects.toMatchObject({
      code: "object-conflict",
    });
    await expect(restarted.head(scope, published)).rejects.toMatchObject({
      code: "object-conflict",
    });
    await expect(
      restarted.eraseProjectPage(
        { ...deletionBinding, recordVersion: 3 },
        authorized,
      ),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
    expect(f.store.configurationSha256).not.toBe(
      new DurableFilesystemObjectStore(resolve(f.root, "other-root"))
        .configurationSha256,
    );
  });

  it("replays an interrupted request install and payload unlink without trusting unexplained absence", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    await f.store.publish(scope, object);
    faults.failAfterInstall = true;
    await expect(
      f.store.eraseProjectPage(deletionBinding, authorized),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
    expect((await lstat(`${f.path}.object-v2`)).isFile()).toBe(true);
    faults.failPayloadUnlink = true;
    const restarted = new DurableFilesystemObjectStore(f.root);
    await expect(
      restarted.eraseProjectPage(deletionBinding, authorized),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
    expect((await lstat(`${f.path}.delete-v2`)).isFile()).toBe(true);
    expect(
      await restarted.eraseProjectPage(deletionBinding, authorized),
    ).toEqual({ observedEmpty: true });
    const ambiguous = await fixture();
    const lost = await ambiguous.store.stage(scope, payload());
    await ambiguous.store.publish(scope, lost);
    await unlink(`${ambiguous.path}.object-v2`);
    await expect(
      ambiguous.store.eraseProjectPage(deletionBinding, authorized),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
  });

  it("revalidates authority around the request and refuses stale, cross-project or missing reference coverage", async () => {
    const f = await fixture();
    const object = await f.store.stage(scope, payload());
    const project = dirname(dirname(dirname(f.path)));
    const staleAfterRequest = async () => {
      if (
        await lstat(resolve(project, ".project-erasure-request-v1")).catch(
          () => null,
        )
      )
        throw Error("synthetic stale authority");
    };
    await expect(
      f.store.eraseProjectPage(deletionBinding, staleAfterRequest),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
    expect((await lstat(`${f.path}.object-v2`)).isFile()).toBe(true);
    for (const references of [
      [{ ...object, owner: { ...object.owner, projectId: "other_project" } }],
      [
        {
          ...object,
          objectId: "missing",
          storageKey: object.storageKey.replace("synthetic_object", "missing"),
        },
      ],
    ])
      await expect(
        f.store.assertProjectReferenceCoverage(deletionBinding, references),
      ).rejects.toMatchObject({ code: "storage-unavailable" });
    await expect(
      f.store.stage({ ...scope, organizationId: "other_org" }, payload()),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(await f.store.eraseProjectPage(deletionBinding, authorized)).toEqual(
      { observedEmpty: true },
    );
  });

  it("refuses unknown, legacy, pending, probe and aliased physical state before payload erasure", async () => {
    for (const kind of [
      "unknown",
      "legacy",
      "pending",
      "probe",
      "alias",
      "marker",
    ]) {
      const f = await fixture();
      await f.store.stage(scope, payload());
      if (kind === "alias") {
        const external = await fixture();
        await link(
          `${f.path}.object-v2`,
          resolve(external.root, "external-alias"),
        );
      } else if (kind === "probe")
        await mkdir(resolve(f.root, ".capability-probe-v2-interrupted"));
      else if (kind === "marker")
        await writeFile(
          resolve(
            dirname(dirname(dirname(f.path))),
            ".project-erasure-request-v1",
          ),
          "invalid",
        );
      else
        await writeFile(
          kind === "legacy"
            ? f.path
            : kind === "pending"
              ? `${f.path}.object-v2.pending-unknown`
              : resolve(dirname(f.path), "unknown"),
          "ambiguous",
        );
      await expect(
        f.store.eraseProjectPage(deletionBinding, authorized),
      ).rejects.toMatchObject({ code: "storage-unavailable" });
      expect((await lstat(`${f.path}.object-v2`)).isFile()).toBe(true);
    }
  });

  it("refuses bytes that reappear after completion and only acknowledges fresh physical absence", async () => {
    const f = await fixture();
    await f.store.stage(scope, payload());
    const original = await readFile(`${f.path}.object-v2`);
    expect(await f.store.eraseProjectPage(deletionBinding, authorized)).toEqual(
      { observedEmpty: true },
    );
    await writeFile(`${f.path}.object-v2`, original);
    await expect(
      new DurableFilesystemObjectStore(f.root).eraseProjectPage(
        deletionBinding,
        authorized,
      ),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
    expect((await lstat(`${f.path}.object-v2`)).isFile()).toBe(true);
  });
});
