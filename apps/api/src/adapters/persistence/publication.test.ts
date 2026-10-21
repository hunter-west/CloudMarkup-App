import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  ObjectStore,
  StageObjectInput,
  StoredObjectReference,
  StoredObjectState,
} from "../../application/persistence.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import {
  ObjectPublicationCoordinator,
  ObjectPublicationPendingError,
} from "./publication.js";

const scope: AuthorizedOrganizationScope = {
  capabilities: ["projects.write"],
  correlationId: "correlation_publication_test",
  membershipId: "membership_publication_test",
  organizationId: "organization_publication_test",
  principalId: "principal_publication_test",
  roleKey: "test-owner",
  sessionId: "session_publication_test",
};

function objectInput(): StageObjectInput {
  const bytes = new TextEncoder().encode("immutable architecture");
  return {
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "application/vnd.cloudmarkup.architecture+json",
    objectId: "object_publication_test",
    open: () =>
      (async function* body() {
        yield bytes;
        await Promise.resolve();
      })(),
    owner: {
      organizationId: scope.organizationId,
      projectId: "project_publication_test",
    },
    purpose: "architecture-draft",
    sizeBytes: bytes.byteLength,
  };
}

describe("object publication coordination", () => {
  it("retains an unconfirmed staged object when persistence fails", async () => {
    const objectStore = new InMemoryObjectStore();
    const repository = {
      getObject: () => Promise.resolve(null),
    } as unknown as CloudMarkupRepository;
    const coordinator = new ObjectPublicationCoordinator(
      repository,
      objectStore,
    );
    let staged: StoredObjectReference | undefined;

    await expect(
      coordinator.publish(scope, objectInput(), (object) => {
        staged = object;
        return Promise.reject(new Error("controlled relational failure"));
      }),
    ).rejects.toThrow("controlled relational failure");

    if (staged === undefined) {
      throw new Error("Expected an object to be staged.");
    }
    expect(await objectStore.head(scope, staged)).toEqual(staged);
  });

  it("recovers an exact pending object before replaying persistence", async () => {
    const backingStore = new InMemoryObjectStore();
    const object = await backingStore.stage(scope, objectInput());
    let stored: StoredObjectState = {
      ...object,
      lifecycleState: "publication-pending",
    };
    let callbackCalls = 0;
    const objectStore: ObjectStore = {
      discardStaged: (authorizedScope, reference) =>
        backingStore.discardStaged(authorizedScope, reference),
      head: (authorizedScope, reference) =>
        backingStore.head(authorizedScope, reference),
      open: (authorizedScope, reference) =>
        backingStore.open(authorizedScope, reference),
      publish: (authorizedScope, reference) =>
        backingStore.publish(authorizedScope, reference),
      requestDeletion: (authorizedScope, reference) =>
        backingStore.requestDeletion(authorizedScope, reference),
      stage: () => Promise.reject(new Error("must not restage")),
    };
    const repository = {
      getObject: () => Promise.resolve(stored),
      markObjectPublished: () => {
        stored = { ...stored, lifecycleState: "published" };
        return Promise.resolve();
      },
    } as unknown as CloudMarkupRepository;
    const coordinator = new ObjectPublicationCoordinator(
      repository,
      objectStore,
    );

    await expect(
      coordinator.publish(scope, objectInput(), () => {
        callbackCalls += 1;
        return Promise.resolve("replayed");
      }),
    ).resolves.toBe("replayed");
    expect(stored.lifecycleState).toBe("published");
    expect(callbackCalls).toBe(1);
  });

  it("recovers an ambiguous committed write and replays persistence once", async () => {
    const objectStore = new InMemoryObjectStore();
    let stored: StoredObjectState | null = null;
    let callbackCalls = 0;
    const repository = {
      getObject: () => Promise.resolve(stored),
      markObjectPublished: () => {
        if (stored !== null) {
          stored = { ...stored, lifecycleState: "published" };
        }
        return Promise.resolve();
      },
    } as unknown as CloudMarkupRepository;
    const coordinator = new ObjectPublicationCoordinator(
      repository,
      objectStore,
    );

    await expect(
      coordinator.publish(scope, objectInput(), (object) => {
        callbackCalls += 1;
        if (callbackCalls === 1) {
          stored = { ...object, lifecycleState: "publication-pending" };
          return Promise.reject(new Error("ambiguous commit response"));
        }
        return Promise.resolve("recovered");
      }),
    ).resolves.toBe("recovered");
    expect(callbackCalls).toBe(2);
    expect((stored as StoredObjectState | null)?.lifecycleState).toBe(
      "published",
    );
  });

  it("fails closed before replay when stored metadata does not match", async () => {
    const objectStore = new InMemoryObjectStore();
    const object = await objectStore.stage(scope, objectInput());
    const stored: StoredObjectState = {
      ...object,
      lifecycleState: "publication-pending",
      mediaType: "application/json",
    };
    let callbackCalled = false;
    const repository = {
      getObject: () => Promise.resolve(stored),
    } as unknown as CloudMarkupRepository;
    const coordinator = new ObjectPublicationCoordinator(
      repository,
      objectStore,
    );

    await expect(
      coordinator.publish(scope, objectInput(), () => {
        callbackCalled = true;
        return Promise.resolve();
      }),
    ).rejects.toMatchObject({ code: "object-conflict" });
    expect(callbackCalled).toBe(false);
  });

  it("fails closed when published database metadata has no physical object", async () => {
    const objectStore = new InMemoryObjectStore();
    const input = objectInput();
    const stored: StoredObjectState = {
      contentSha256: input.contentSha256,
      mediaType: input.mediaType,
      objectId: input.objectId,
      objectVersion: "missing-version",
      owner: input.owner,
      purpose: input.purpose,
      sizeBytes: input.sizeBytes,
      storageKey: "missing/object",
      storageProvider: "memory",
      lifecycleState: "published",
    };
    let callbackCalled = false;
    const repository = {
      getObject: () => Promise.resolve(stored),
    } as unknown as CloudMarkupRepository;
    const coordinator = new ObjectPublicationCoordinator(
      repository,
      objectStore,
    );

    await expect(
      coordinator.publish(scope, input, () => {
        callbackCalled = true;
        return Promise.resolve();
      }),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(callbackCalled).toBe(false);
  });

  it("leaves a recoverable pending reference after a post-commit failure", async () => {
    const objectStore = new InMemoryObjectStore();
    let stored: StoredObjectState | null = null;
    let markAttempts = 0;
    const repository = {
      getObject: () => Promise.resolve(stored),
      markObjectPublished: (
        _scope: AuthorizedOrganizationScope,
        objectId: string,
      ) => {
        markAttempts += 1;
        if (markAttempts === 1) {
          return Promise.reject(new Error("controlled finalize failure"));
        }
        if (stored !== null && stored.objectId === objectId) {
          stored = { ...stored, lifecycleState: "published" };
        }
        return Promise.resolve();
      },
    } as unknown as CloudMarkupRepository;
    const coordinator = new ObjectPublicationCoordinator(
      repository,
      objectStore,
    );

    let pending: ObjectPublicationPendingError | undefined;
    try {
      await coordinator.publish(scope, objectInput(), (object) => {
        stored = { ...object, lifecycleState: "publication-pending" };
        return Promise.resolve("committed");
      });
    } catch (error) {
      if (error instanceof ObjectPublicationPendingError) {
        pending = error;
      } else {
        throw error;
      }
    }

    expect(pending?.message).toBe(
      "The object publication is pending recovery.",
    );
    expect((stored as StoredObjectState | null)?.lifecycleState).toBe(
      "publication-pending",
    );
    if (pending === undefined) {
      throw new Error("Expected a recoverable pending publication.");
    }
    await coordinator.recover(scope, pending.object);
    expect((stored as StoredObjectState | null)?.lifecycleState).toBe(
      "published",
    );
    expect(markAttempts).toBe(2);
  });
  it("retains prepared metadata when object publication fails and recovers", async () => {
    const backingStore = new InMemoryObjectStore();
    let failPublication = true;
    const objectStore: ObjectStore = {
      discardStaged: (authorizedScope, object) =>
        backingStore.discardStaged(authorizedScope, object),
      head: (authorizedScope, object) =>
        backingStore.head(authorizedScope, object),
      open: (authorizedScope, object) =>
        backingStore.open(authorizedScope, object),
      publish: async (authorizedScope, object) => {
        if (failPublication) {
          throw new Error("controlled object publication failure");
        }
        await backingStore.publish(authorizedScope, object);
      },
      requestDeletion: (authorizedScope, object) =>
        backingStore.requestDeletion(authorizedScope, object),
      stage: (authorizedScope, input) =>
        backingStore.stage(authorizedScope, input),
    };
    let stored: StoredObjectState | null = null;
    const repository = {
      getObject: () => Promise.resolve(stored),
      markObjectPublished: (
        _scope: AuthorizedOrganizationScope,
        objectId: string,
      ) => {
        if (stored !== null && stored.objectId === objectId) {
          stored = { ...stored, lifecycleState: "published" };
        }
        return Promise.resolve();
      },
    } as unknown as CloudMarkupRepository;
    const coordinator = new ObjectPublicationCoordinator(
      repository,
      objectStore,
    );

    let pending: ObjectPublicationPendingError | undefined;
    try {
      await coordinator.publish(scope, objectInput(), (object) => {
        stored = { ...object, lifecycleState: "publication-pending" };
        return Promise.resolve();
      });
    } catch (error) {
      if (error instanceof ObjectPublicationPendingError) {
        pending = error;
      } else {
        throw error;
      }
    }

    expect(pending).toBeInstanceOf(ObjectPublicationPendingError);
    expect((stored as StoredObjectState | null)?.lifecycleState).toBe(
      "publication-pending",
    );
    if (pending === undefined) {
      throw new Error("Expected object publication to require recovery.");
    }
    failPublication = false;
    await coordinator.recover(scope, pending.object);
    expect((stored as StoredObjectState | null)?.lifecycleState).toBe(
      "published",
    );
  });
});
