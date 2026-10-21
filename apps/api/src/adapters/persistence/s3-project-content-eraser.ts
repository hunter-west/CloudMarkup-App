import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type ListObjectVersionsCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3";
import { ObjectStoreError } from "../../application/persistence.js";

export interface ProjectErasureBinding {
  readonly organizationId: string;
  readonly projectId: string;
  readonly deletionRequestedAt: string;
  readonly recordVersion: number;
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function unavailable(): never {
  throw new ObjectStoreError(
    "storage-unavailable",
    "Project content erasure could not be verified.",
  );
}
function validBinding(value: ProjectErasureBinding): void {
  if (
    !identifier.test(value.organizationId) ||
    !identifier.test(value.projectId) ||
    value.projectId === "organization" ||
    !Number.isSafeInteger(value.recordVersion) ||
    value.recordVersion < 1 ||
    !Number.isFinite(Date.parse(value.deletionRequestedAt))
  )
    unavailable();
}

/** Host-only erasure of one authorized project prefix, including historical
 * versions and delete markers. The host must close and drain write authority
 * before calling this port. An empty observation is not a project completion
 * receipt: SQL content/metadata cleanup and final write fencing remain separate.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html
 */
export function createS3ProjectContentEraser(input: {
  readonly bucket: string;
  readonly expectedBucketOwner: string;
  readonly keyPrefix: string;
  readonly binding: ProjectErasureBinding;
  readonly client: S3Client;
  /** Revalidate the exact durable deletion request before and after each I/O.
   * No caller-supplied flag or object key grants deletion authority. */
  readonly assertCurrentAuthority: (
    binding: ProjectErasureBinding,
  ) => Promise<void>;
}) {
  validBinding(input.binding);
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(input.bucket) ||
    !/^\d{12}$/u.test(input.expectedBucketOwner) ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(input.keyPrefix)
  )
    unavailable();
  const binding = Object.freeze({ ...input.binding });
  const client = input.client;
  const authorize = input.assertCurrentAuthority;
  const bucket = input.bucket,
    owner = input.expectedBucketOwner;
  const prefix =
    input.keyPrefix +
    "/v1/organizations/" +
    binding.organizationId +
    "/projects/" +
    binding.projectId +
    "/";
  const common = { Bucket: bucket, ExpectedBucketOwner: owner };
  function versions(value: ListObjectVersionsCommandOutput) {
    if (
      value.Name !== bucket ||
      value.Prefix !== prefix ||
      value.Delimiter !== undefined ||
      (value.CommonPrefixes?.length ?? 0) !== 0 ||
      typeof value.IsTruncated !== "boolean" ||
      value.EncodingType !== undefined
    )
      unavailable();
    const entries = [...(value.Versions ?? []), ...(value.DeleteMarkers ?? [])];
    if (entries.length > 1000 || (entries.length === 0 && value.IsTruncated))
      unavailable();
    const identities = new Set<string>();
    return entries.map(({ Key, VersionId }) => {
      if (
        typeof Key !== "string" ||
        !Key.startsWith(prefix) ||
        Key.length === prefix.length ||
        Buffer.byteLength(Key, "utf8") > 1024 ||
        typeof VersionId !== "string" ||
        VersionId.length < 1 ||
        VersionId.length > 1024 ||
        Array.from(VersionId).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        unavailable();
      const identity = JSON.stringify([Key, VersionId]);
      if (identities.has(identity)) unavailable();
      identities.add(identity);
      return { Key, VersionId };
    });
  }
  return {
    /** One bounded drain page, followed by fresh absence verification. Repeated
     * calls start from the first remaining version, avoiding pagination skips
     * caused by deleting the previous page. All failures remain retryable by
     * the durable host; no missing response is interpreted as successful erase. */
    async erasePage(): Promise<{
      readonly observedEmpty: boolean;
      readonly deletedVersionCount: number;
    }> {
      try {
        await authorize(binding);
        const page = await client.send(
          new ListObjectVersionsCommand({
            ...common,
            Prefix: prefix,
            MaxKeys: 1000,
          }),
        );
        await authorize(binding);
        const objects = versions(page);
        if (objects.length === 0)
          return { observedEmpty: true, deletedVersionCount: 0 };
        await authorize(binding);
        const result = await client.send(
          new DeleteObjectsCommand({
            ...common,
            Delete: { Objects: objects, Quiet: false },
          }),
        );
        await authorize(binding);
        if (
          (result.Errors?.length ?? 0) !== 0 ||
          result.Deleted?.length !== objects.length
        )
          unavailable();
        const expected = new Set(
          objects.map((value) => JSON.stringify([value.Key, value.VersionId])),
        );
        for (const deleted of result.Deleted) {
          if (
            !expected.delete(JSON.stringify([deleted.Key, deleted.VersionId]))
          )
            unavailable();
        }
        if (expected.size !== 0) unavailable();
        await authorize(binding);
        const remaining = await client.send(
          new ListObjectVersionsCommand({
            ...common,
            Prefix: prefix,
            MaxKeys: 1000,
          }),
        );
        await authorize(binding);
        return {
          observedEmpty: versions(remaining).length === 0,
          deletedVersionCount: objects.length,
        };
      } catch {
        // SDK errors can contain bucket names, keys and response content.
        return unavailable();
      }
    },
  };
}
