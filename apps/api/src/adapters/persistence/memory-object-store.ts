import {
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

interface MemoryObjectRecord {
  readonly bytes: Uint8Array;
  readonly reference: StoredObjectReference;
  state: "staged" | "published" | "delete-pending";
}

export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, MemoryObjectRecord>();

  async stage(
    scope: AuthorizedOrganizationScope,
    input: StageObjectInput,
  ): Promise<StoredObjectReference> {
    assertStageInput(scope, input);
    const storageKey = buildStorageKey(input);
    const objectVersion = `sha256-${input.contentSha256}`;
    const reference: StoredObjectReference = {
      contentSha256: input.contentSha256,
      entityTag: `"${input.contentSha256}"`,
      mediaType: input.mediaType,
      objectId: input.objectId,
      objectVersion,
      owner: input.owner,
      purpose: input.purpose,
      sizeBytes: input.sizeBytes,
      storageKey,
      storageProvider: "memory",
    };
    const existing = this.#objects.get(storageKey);
    if (existing !== undefined) {
      if (!referencesMatch(reference, existing.reference)) {
        throw new ObjectStoreError(
          "object-conflict",
          "The object identity conflicts with existing content.",
        );
      }
      return existing.reference;
    }
    const bytes = await collectAndVerify(input);
    this.#objects.set(storageKey, { bytes, reference, state: "staged" });
    return reference;
  }

  publish(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    const record = this.#get(scope, object);
    record.state = "published";
    return Promise.resolve();
  }

  requestDeletion(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    const record = this.#get(scope, object);
    if (record.state === "delete-pending") {
      return Promise.resolve();
    }
    if (record.state !== "published") {
      return Promise.reject(
        new ObjectStoreError(
          "object-conflict",
          "Only a published object can enter deletion.",
        ),
      );
    }
    record.state = "delete-pending";
    return Promise.resolve();
  }

  discardStaged(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    const record = this.#get(scope, object);
    if (record.state === "staged") {
      this.#objects.delete(object.storageKey);
    }
    return Promise.resolve();
  }

  head(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<StoredObjectReference | null> {
    assertObjectReference(scope, object);
    const record = this.#objects.get(object.storageKey);
    if (record === undefined) {
      return Promise.resolve(null);
    }
    if (!referencesMatch(object, record.reference)) {
      throw new ObjectStoreError(
        "object-conflict",
        "The object reference does not match stored metadata.",
      );
    }
    return Promise.resolve(record.reference);
  }

  async open(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<AsyncIterable<Uint8Array>> {
    await Promise.resolve();
    const record = this.#get(scope, object);
    const bytes = record.bytes.slice();
    return verifiedObjectStream(
      (async function* stream(): AsyncIterable<Uint8Array> {
        await Promise.resolve();
        yield bytes;
      })(),
      object.sizeBytes,
      object.contentSha256,
    );
  }

  #get(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): MemoryObjectRecord {
    assertObjectReference(scope, object);
    const record = this.#objects.get(object.storageKey);
    if (record === undefined) {
      throw new ObjectStoreError("not-found", "The object is not available.");
    }
    if (!referencesMatch(object, record.reference)) {
      throw new ObjectStoreError(
        "object-conflict",
        "The object reference does not match stored metadata.",
      );
    }
    return record;
  }
}
