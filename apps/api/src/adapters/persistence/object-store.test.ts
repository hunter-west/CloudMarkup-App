import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ObjectStoreError,
  type AuthorizedOrganizationScope,
  type ObjectStore,
  type StageObjectInput,
} from "../../application/persistence.js";
import { FilesystemObjectStore } from "./filesystem-object-store.js";
import { InMemoryObjectStore } from "./memory-object-store.js";

const scope: AuthorizedOrganizationScope = {
  capabilities: ["projects.write"],
  correlationId: "correlation_object_test",
  membershipId: "membership_object_test",
  organizationId: "organization_object_test",
  principalId: "principal_object_test",
  roleKey: "test-owner",
  sessionId: "session_object_test",
};

const otherScope: AuthorizedOrganizationScope = {
  ...scope,
  membershipId: "membership_other",
  organizationId: "organization_other",
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function inputFor(bytes: Uint8Array): StageObjectInput {
  return {
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "application/vnd.cloudmarkup.architecture+json",
    objectId: "object_architecture_test",
    open: () =>
      (async function* body() {
        yield bytes;
        await Promise.resolve();
      })(),
    owner: {
      organizationId: scope.organizationId,
      projectId: "project_object_test",
    },
    purpose: "architecture-draft",
    sizeBytes: bytes.byteLength,
  };
}

async function readAll(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function contract(name: string, createStore: () => Promise<ObjectStore>): void {
  describe(name, () => {
    it("stages, replays, publishes, and verifies immutable content", async () => {
      const store = await createStore();
      const bytes = new TextEncoder().encode('{"contractVersion":2}\n');
      const input = inputFor(bytes);

      const staged = await store.stage(scope, input);
      const replayed = await store.stage(scope, input);
      expect(replayed).toEqual(staged);
      await store.publish(scope, staged);

      expect(await store.head(scope, staged)).toEqual(staged);
      expect(await readAll(await store.open(scope, staged))).toEqual(bytes);
      await store.discardStaged(scope, staged);
      expect(await store.head(scope, staged)).toEqual(staged);
    });

    it("rejects cross-tenant object access without revealing content", async () => {
      const store = await createStore();
      const staged = await store.stage(
        scope,
        inputFor(new TextEncoder().encode("tenant-bound")),
      );

      await expect(store.open(otherScope, staged)).rejects.toMatchObject({
        code: "invalid-input",
      } satisfies Partial<ObjectStoreError>);
    });

    it("rejects a declared digest that does not match the body", async () => {
      const store = await createStore();
      const input = inputFor(new TextEncoder().encode("expected"));
      const invalid = {
        ...input,
        open: () =>
          (async function* body() {
            yield new TextEncoder().encode("tampered");
            await Promise.resolve();
          })(),
      };

      await expect(store.stage(scope, invalid)).rejects.toMatchObject({
        code: "content-mismatch",
      } satisfies Partial<ObjectStoreError>);
    });
    it("rejects deletion before an exact object version is published", async () => {
      const store = await createStore();
      const staged = await store.stage(
        scope,
        inputFor(new TextEncoder().encode("staged-only")),
      );

      await expect(store.requestDeletion(scope, staged)).rejects.toMatchObject({
        code: "object-conflict",
      } satisfies Partial<ObjectStoreError>);
    });
    it("keeps immutable revision object identities distinct and tracks deletion", async () => {
      const store = await createStore();
      const bytes = new TextEncoder().encode('{"immutableRevision":true}\n');
      const firstInput = {
        ...inputFor(bytes),
        objectId: "object_revision_first",
        purpose: "architecture-revision" as const,
      };
      const secondInput = {
        ...firstInput,
        objectId: "object_revision_second",
      };

      const first = await store.stage(scope, firstInput);
      const second = await store.stage(scope, secondInput);
      expect(second).not.toEqual(first);
      expect(first.storageKey).toContain(
        `/organizations/${scope.organizationId}/projects/project_object_test/architecture-revision/${first.objectId}/${first.contentSha256}`,
      );
      expect(second.storageKey).toContain(
        `/architecture-revision/${second.objectId}/${second.contentSha256}`,
      );

      await store.publish(scope, first);
      await store.requestDeletion(scope, first);
      await store.requestDeletion(scope, first);
      expect(await readAll(await store.open(scope, first))).toEqual(bytes);
    });
  });
}

contract("in-memory object store", () =>
  Promise.resolve(new InMemoryObjectStore()),
);

contract("filesystem object store", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cloudmarkup-objects-"));
  temporaryDirectories.push(directory);
  return new FilesystemObjectStore(directory);
});
