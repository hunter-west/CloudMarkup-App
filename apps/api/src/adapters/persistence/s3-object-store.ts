import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import {
  ObjectStoreError,
  isObjectPurpose,
  type AuthorizedOrganizationScope,
  type ObjectStore,
  type StageObjectInput,
  type StoredObjectReference,
} from "../../application/persistence.js";
import {
  assertObjectReference,
  assertStageInput,
  buildStorageKey,
  referencesMatch,
  verifiedObjectStream,
} from "./object-store-common.js";

export interface S3ObjectStoreConfig {
  readonly bucket: string;
  readonly client?: S3Client;
  readonly keyPrefix?: string;
  /** Retained write history requires one definitive conditional PUT outcome. */
  readonly requireDefinitiveStage?: boolean;
}

function isAwsStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata &&
    error.$metadata.httpStatusCode === status
  );
}

function requiredMetadata(
  metadata: Readonly<Record<string, string | undefined>> | undefined,
  key: string,
): string {
  const value = metadata?.[key];
  if (value === undefined || value.length === 0) {
    throw new ObjectStoreError(
      "storage-unavailable",
      "The stored object metadata is incomplete.",
    );
  }
  return value;
}

export class S3ObjectStore implements ObjectStore {
  readonly #bucket: string;
  readonly #client: S3Client;
  readonly #prefix: string;
  readonly #requireDefinitiveStage: boolean;

  constructor(config: S3ObjectStoreConfig) {
    if (config.bucket.length === 0) {
      throw new ObjectStoreError("invalid-input", "The S3 bucket is invalid.");
    }
    const prefix = config.keyPrefix?.replace(/^\/+|\/+$/g, "") ?? "";
    if (prefix.split("/").some((part) => part === ".." || part === ".")) {
      throw new ObjectStoreError("invalid-input", "The S3 prefix is invalid.");
    }
    this.#bucket = config.bucket;
    this.#client = config.client ?? new S3Client({});
    this.#prefix = prefix;
    this.#requireDefinitiveStage = config.requireDefinitiveStage ?? false;
  }

  async stage(
    scope: AuthorizedOrganizationScope,
    input: StageObjectInput,
  ): Promise<StoredObjectReference> {
    assertStageInput(scope, input);
    if (
      this.#requireDefinitiveStage &&
      (await this.#client.config.maxAttempts()) !== 1
    ) {
      throw new ObjectStoreError(
        "storage-unavailable",
        "Retained history requires a single S3 write attempt.",
      );
    }
    const baseKey = buildStorageKey(input);
    const storageKey =
      this.#prefix.length === 0 ? baseKey : `${this.#prefix}/${baseKey}`;
    const stream = verifiedObjectStream(
      input.open(),
      input.sizeBytes,
      input.contentSha256,
    );
    try {
      const result = await this.#client.send(
        new PutObjectCommand({
          Body: Readable.from(stream),
          Bucket: this.#bucket,
          ChecksumAlgorithm: "SHA256",
          ChecksumSHA256: Buffer.from(input.contentSha256, "hex").toString(
            "base64",
          ),
          ContentLength: input.sizeBytes,
          ContentType: input.mediaType,
          IfNoneMatch: "*",
          Key: storageKey,
          Metadata: {
            "content-sha256": input.contentSha256,
            "media-type": input.mediaType,
            "object-id": input.objectId,
            "organization-id": input.owner.organizationId,
            "project-id": input.owner.projectId ?? "",
            purpose: input.purpose,
            "size-bytes": String(input.sizeBytes),
          },
          Tagging: "cloudmarkup-state=staged",
        }),
      );
      if (result.VersionId === undefined) {
        throw new ObjectStoreError(
          "storage-unavailable",
          "S3 object versioning is required.",
        );
      }
      return {
        contentSha256: input.contentSha256,
        ...(result.ETag === undefined ? {} : { entityTag: result.ETag }),
        mediaType: input.mediaType,
        objectId: input.objectId,
        objectVersion: result.VersionId,
        owner: input.owner,
        purpose: input.purpose,
        sizeBytes: input.sizeBytes,
        storageKey,
        storageProvider: "s3",
      };
    } catch (error) {
      const definiteConflict = this.#requireDefinitiveStage
        ? error instanceof S3ServiceException && isAwsStatus(error, 412)
        : isAwsStatus(error, 409) || isAwsStatus(error, 412);
      if (!definiteConflict) {
        if (error instanceof ObjectStoreError) {
          throw error;
        }
        throw new ObjectStoreError(
          "storage-unavailable",
          "The S3 object could not be staged.",
          { cause: error },
        );
      }
      const existing = await this.#headByKey(storageKey);
      if (
        existing?.contentSha256 !== input.contentSha256 ||
        existing.mediaType !== input.mediaType ||
        existing.objectId !== input.objectId ||
        existing.owner.organizationId !== input.owner.organizationId ||
        existing.owner.projectId !== input.owner.projectId ||
        existing.purpose !== input.purpose ||
        existing.sizeBytes !== input.sizeBytes
      ) {
        throw new ObjectStoreError(
          "object-conflict",
          "The S3 object conflicts with existing content.",
        );
      }
      return existing;
    }
  }

  async publish(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    await this.#requireMatchingHead(scope, object);
    try {
      await this.#client.send(
        new PutObjectTaggingCommand({
          Bucket: this.#bucket,
          Key: object.storageKey,
          Tagging: {
            TagSet: [{ Key: "cloudmarkup-state", Value: "published" }],
          },
          VersionId: object.objectVersion,
        }),
      );
    } catch (error) {
      throw new ObjectStoreError(
        "storage-unavailable",
        "The S3 object could not be published.",
        { cause: error },
      );
    }
  }

  async requestDeletion(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    await this.#requireMatchingHead(scope, object);
    try {
      const tags = await this.#client.send(
        new GetObjectTaggingCommand({
          Bucket: this.#bucket,
          Key: object.storageKey,
          VersionId: object.objectVersion,
        }),
      );
      const state = tags.TagSet?.find(
        (tag) => tag.Key === "cloudmarkup-state",
      )?.Value;
      if (state === "delete-pending") {
        return;
      }
      if (state !== "published") {
        throw new ObjectStoreError(
          "object-conflict",
          "Only a published object can enter deletion.",
        );
      }
      await this.#client.send(
        new PutObjectTaggingCommand({
          Bucket: this.#bucket,
          Key: object.storageKey,
          Tagging: {
            TagSet: [{ Key: "cloudmarkup-state", Value: "delete-pending" }],
          },
          VersionId: object.objectVersion,
        }),
      );
    } catch (error) {
      if (error instanceof ObjectStoreError) {
        throw error;
      }
      throw new ObjectStoreError(
        "storage-unavailable",
        "The S3 object could not enter deletion.",
        { cause: error },
      );
    }
  }
  async discardStaged(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    await this.#requireMatchingHead(scope, object);
    try {
      const tags = await this.#client.send(
        new GetObjectTaggingCommand({
          Bucket: this.#bucket,
          Key: object.storageKey,
          VersionId: object.objectVersion,
        }),
      );
      const state = tags.TagSet?.find(
        (tag) => tag.Key === "cloudmarkup-state",
      )?.Value;
      if (state !== "staged") {
        return;
      }
      await this.#client.send(
        new DeleteObjectCommand({
          Bucket: this.#bucket,
          Key: object.storageKey,
          VersionId: object.objectVersion,
        }),
      );
    } catch (error) {
      if (!isAwsStatus(error, 404)) {
        throw new ObjectStoreError(
          "storage-unavailable",
          "The staged S3 object could not be discarded.",
          { cause: error },
        );
      }
    }
  }

  async head(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<StoredObjectReference | null> {
    assertObjectReference(scope, object);
    const found = await this.#headByKey(
      object.storageKey,
      object.objectVersion,
    );
    if (found === null) {
      return null;
    }
    if (!referencesMatch(object, found)) {
      throw new ObjectStoreError(
        "object-conflict",
        "The S3 object reference does not match stored metadata.",
      );
    }
    return found;
  }

  async open(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<AsyncIterable<Uint8Array>> {
    await this.#requireMatchingHead(scope, object);
    try {
      const response = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: object.storageKey,
          VersionId: object.objectVersion,
        }),
      );
      const body = response.Body;
      if (body === undefined || !(Symbol.asyncIterator in body)) {
        throw new ObjectStoreError(
          "storage-unavailable",
          "The S3 object body is unavailable.",
        );
      }
      return verifiedObjectStream(
        (async function* bytes(): AsyncIterable<Uint8Array> {
          for await (const chunk of body) {
            if (!(chunk instanceof Uint8Array)) {
              throw new ObjectStoreError(
                "storage-unavailable",
                "The S3 object body is invalid.",
              );
            }
            yield chunk;
          }
        })(),
        object.sizeBytes,
        object.contentSha256,
      );
    } catch (error) {
      if (error instanceof ObjectStoreError) {
        throw error;
      }
      throw new ObjectStoreError(
        "storage-unavailable",
        "The S3 object could not be read.",
        { cause: error },
      );
    }
  }

  async #requireMatchingHead(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    const found = await this.head(scope, object);
    if (found === null) {
      throw new ObjectStoreError("not-found", "The object is not available.");
    }
  }

  async #headByKey(
    storageKey: string,
    versionId?: string,
  ): Promise<StoredObjectReference | null> {
    try {
      const result = await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.#bucket,
          Key: storageKey,
          ...(versionId === undefined ? {} : { VersionId: versionId }),
        }),
      );
      if (result.VersionId === undefined) {
        throw new ObjectStoreError(
          "storage-unavailable",
          "S3 object versioning is required.",
        );
      }
      const projectId = result.Metadata?.["project-id"];
      const purpose = requiredMetadata(result.Metadata, "purpose");
      if (!isObjectPurpose(purpose)) {
        throw new ObjectStoreError(
          "storage-unavailable",
          "The stored object purpose is invalid.",
        );
      }
      return {
        contentSha256: requiredMetadata(result.Metadata, "content-sha256"),
        ...(result.ETag === undefined ? {} : { entityTag: result.ETag }),
        mediaType:
          result.ContentType ?? requiredMetadata(result.Metadata, "media-type"),
        objectId: requiredMetadata(result.Metadata, "object-id"),
        objectVersion: result.VersionId,
        owner: {
          organizationId: requiredMetadata(result.Metadata, "organization-id"),
          ...(projectId === undefined || projectId.length === 0
            ? {}
            : { projectId }),
        },
        purpose: purpose,
        sizeBytes:
          result.ContentLength ??
          Number(requiredMetadata(result.Metadata, "size-bytes")),
        storageKey,
        storageProvider: "s3",
      };
    } catch (error) {
      if (isAwsStatus(error, 404)) {
        return null;
      }
      if (error instanceof ObjectStoreError) {
        throw error;
      }
      throw new ObjectStoreError(
        "storage-unavailable",
        "The S3 object metadata could not be read.",
        { cause: error },
      );
    }
  }
}
