import {
  ObjectStoreError,
  type AuthorizedOrganizationScope,
  type CloudMarkupRepository,
  type ObjectStore,
  type StageObjectInput,
  type StoredObjectReference,
  type StoredObjectState,
} from "../../application/persistence.js";
import { referencesMatch } from "./object-store-common.js";
import { ApplicationError } from "../../application/errors.js";
import type { DraftWriteLeaseContext } from "../../application/project-editing-leases.js";

function stageInputMatchesStored(
  input: StageObjectInput,
  stored: StoredObjectState,
): boolean {
  return (
    stored.objectId === input.objectId &&
    stored.owner.organizationId === input.owner.organizationId &&
    stored.owner.projectId === input.owner.projectId &&
    stored.purpose === input.purpose &&
    stored.mediaType === input.mediaType &&
    stored.contentSha256 === input.contentSha256 &&
    stored.sizeBytes === input.sizeBytes
  );
}

function objectConflict(message: string): ObjectStoreError {
  return new ObjectStoreError("object-conflict", message);
}

export class ObjectPublicationPendingError extends ObjectStoreError {
  readonly object: StoredObjectReference;

  constructor(object: StoredObjectReference, options?: ErrorOptions) {
    super(
      "storage-unavailable",
      "The object publication is pending recovery.",
      options,
    );
    this.name = "ObjectPublicationPendingError";
    this.object = object;
  }
}

export class ObjectPublicationCoordinator {
  readonly #objectStore: ObjectStore;
  readonly #repository: CloudMarkupRepository;

  constructor(repository: CloudMarkupRepository, objectStore: ObjectStore) {
    this.#repository = repository;
    this.#objectStore = objectStore;
  }

  async publish<TResult>(
    scope: AuthorizedOrganizationScope,
    input: StageObjectInput,
    persistPending: (object: StoredObjectReference) => Promise<TResult>,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<TResult> {
    const existing = await this.#repository.getObject(scope, input.objectId);
    if (existing !== null) {
      await this.#prepareExisting(scope, input, existing, editingLease);
      return persistPending(existing);
    }

    const object = await this.#objectStore.stage(scope, input);
    let result: TResult;
    try {
      result = await persistPending(object);
    } catch (error) {
      return this.#recoverAmbiguousPersistence(
        scope,
        input,
        object,
        persistPending,
        error,
        editingLease,
      );
    }

    try {
      await this.#publishAndMark(scope, object, editingLease);
      return result;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ObjectPublicationPendingError(object, { cause: error });
    }
  }

  async recover(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<void> {
    const stored = await this.#repository.getObject(scope, object.objectId);
    if (stored === null || !referencesMatch(stored, object)) {
      throw objectConflict("The pending object metadata does not match.");
    }
    if (stored.lifecycleState === "publication-pending") {
      await this.#publishAndMark(scope, stored, editingLease);
      return;
    }
    if (stored.lifecycleState !== "published") {
      throw objectConflict("The object is not recoverable.");
    }
    await this.#requireAvailable(scope, stored);
  }

  async #prepareExisting(
    scope: AuthorizedOrganizationScope,
    input: StageObjectInput,
    stored: StoredObjectState,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<void> {
    if (!stageInputMatchesStored(input, stored)) {
      throw objectConflict("The stored object conflicts with this request.");
    }
    if (stored.lifecycleState === "publication-pending") {
      await this.#publishAndMark(scope, stored, editingLease);
      return;
    }
    if (stored.lifecycleState !== "published") {
      throw objectConflict("The object is not available for publication.");
    }
    await this.#requireAvailable(scope, stored);
  }

  async #recoverAmbiguousPersistence<TResult>(
    scope: AuthorizedOrganizationScope,
    input: StageObjectInput,
    object: StoredObjectReference,
    persistPending: (object: StoredObjectReference) => Promise<TResult>,
    originalError: unknown,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<TResult> {
    let stored: StoredObjectState | null;
    try {
      stored = await this.#repository.getObject(scope, object.objectId);
    } catch {
      throw new ObjectPublicationPendingError(object, {
        cause: originalError,
      });
    }
    if (stored === null) {
      throw originalError;
    }
    if (!referencesMatch(stored, object)) {
      throw objectConflict(
        "The committed object metadata conflicts with the staged object.",
      );
    }
    await this.#prepareExisting(scope, input, stored, editingLease);
    return persistPending(stored);
  }

  async #requireAvailable(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    const available = await this.#objectStore.head(scope, object);
    if (available === null) {
      throw new ObjectStoreError("not-found", "The object is not available.");
    }
  }

  async #publishAndMark(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<void> {
    await this.#objectStore.publish(scope, object);
    if (editingLease === undefined)
      await this.#repository.markObjectPublished(
        scope,
        object.objectId,
        object.objectVersion,
      );
    else
      await this.#repository.markObjectPublished(
        scope,
        object.objectId,
        object.objectVersion,
        editingLease,
      );
  }
}
