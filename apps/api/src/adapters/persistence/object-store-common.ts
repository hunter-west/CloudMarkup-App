import { createHash } from "node:crypto";

import {
  ObjectStoreError,
  type AuthorizedOrganizationScope,
  type ObjectOwner,
  type StageObjectInput,
  type StoredObjectReference,
} from "../../application/persistence.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export function assertObjectOwner(
  scope: AuthorizedOrganizationScope,
  owner: ObjectOwner,
): void {
  if (
    !opaqueIdPattern.test(scope.principalId) ||
    !opaqueIdPattern.test(scope.membershipId) ||
    !opaqueIdPattern.test(scope.organizationId) ||
    owner.organizationId !== scope.organizationId ||
    (owner.projectId !== undefined && !opaqueIdPattern.test(owner.projectId))
  ) {
    throw new ObjectStoreError("invalid-input", "The object owner is invalid.");
  }
}

export function assertStageInput(
  scope: AuthorizedOrganizationScope,
  input: StageObjectInput,
): void {
  assertObjectOwner(scope, input.owner);
  if (
    !opaqueIdPattern.test(input.objectId) ||
    !sha256Pattern.test(input.contentSha256) ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 0 ||
    input.mediaType.length < 1 ||
    input.mediaType.length > 128
  ) {
    throw new ObjectStoreError(
      "invalid-input",
      "The object metadata is invalid.",
    );
  }
}

export function assertObjectReference(
  scope: AuthorizedOrganizationScope,
  object: StoredObjectReference,
): void {
  assertObjectOwner(scope, object.owner);
  if (
    !opaqueIdPattern.test(object.objectId) ||
    !sha256Pattern.test(object.contentSha256) ||
    object.storageKey.length === 0 ||
    object.storageKey.length > 1024 ||
    object.objectVersion.length === 0 ||
    object.objectVersion.length > 1024
  ) {
    throw new ObjectStoreError(
      "invalid-input",
      "The object reference is invalid.",
    );
  }
}

export function buildStorageKey(input: StageObjectInput): string {
  const project = input.owner.projectId ?? "organization";
  return [
    "v1",
    "organizations",
    input.owner.organizationId,
    "projects",
    project,
    input.purpose,
    input.objectId,
    input.contentSha256,
  ].join("/");
}

export async function collectAndVerify(
  input: StageObjectInput,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of input.open()) {
    if (!(chunk instanceof Uint8Array)) {
      throw new ObjectStoreError(
        "invalid-input",
        "The object body is invalid.",
      );
    }
    size += chunk.byteLength;
    if (size > input.sizeBytes) {
      throw new ObjectStoreError(
        "content-mismatch",
        "The object size does not match its metadata.",
      );
    }
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (size !== input.sizeBytes || hash.digest("hex") !== input.contentSha256) {
    throw new ObjectStoreError(
      "content-mismatch",
      "The object content does not match its digest.",
    );
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function* verifiedObjectStream(
  body: AsyncIterable<Uint8Array>,
  expectedSize: number,
  expectedSha256: string,
): AsyncIterable<Uint8Array> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > expectedSize) {
      throw new ObjectStoreError(
        "content-mismatch",
        "The object size does not match its metadata.",
      );
    }
    hash.update(chunk);
    yield chunk;
  }
  if (size !== expectedSize || hash.digest("hex") !== expectedSha256) {
    throw new ObjectStoreError(
      "content-mismatch",
      "The object content does not match its digest.",
    );
  }
}

export function referencesMatch(
  expected: StoredObjectReference,
  actual: StoredObjectReference,
): boolean {
  return (
    expected.contentSha256 === actual.contentSha256 &&
    expected.entityTag === actual.entityTag &&
    expected.mediaType === actual.mediaType &&
    expected.objectId === actual.objectId &&
    expected.objectVersion === actual.objectVersion &&
    expected.owner.organizationId === actual.owner.organizationId &&
    expected.owner.projectId === actual.owner.projectId &&
    expected.purpose === actual.purpose &&
    expected.sizeBytes === actual.sizeBytes &&
    expected.storageKey === actual.storageKey &&
    expected.storageProvider === actual.storageProvider
  );
}
