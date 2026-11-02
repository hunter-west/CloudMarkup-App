import {
  asyncJobObjectReferenceV1Schema,
  type AsyncJobObjectReferenceV1,
} from "@cloudmarkup/schemas";
import {
  isObjectPurpose,
  type ObjectPurpose,
  type ObjectStore,
  type StoredObjectReference,
} from "../../application/persistence.js";
import {
  assertObjectReference,
  referencesMatch,
  verifiedObjectStream,
} from "./object-store-common.js";
import {
  exportRunBytes,
  exportRunSha,
  exportRunText,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import type { SolutionExportObjectAuthority } from "./solution-export-producer-objects.js";
import { sql, type SqlRow } from "./sql.js";

const MAX_JSON = 4 * 1024 * 1024;
const MAX_PREVIEW_FILE = 32 * 1024 * 1024;
const MAX_ARCHIVE = 64 * 1024 * 1024;
const PREVIEW_FILE_MEDIA = new Set([
  "application/vnd.hashicorp.terraform",
  "application/vnd.amazon.cloudformation.template+json",
  "application/yaml",
  "image/svg+xml",
  "text/markdown",
  "text/plain",
  "text/typescript",
  "text/javascript",
]);
export function solutionExportWorkflowByteLimit(
  purpose: ObjectPurpose,
  mediaType: string,
): number {
  if (mediaType === "application/json") return MAX_JSON;
  if (purpose === "export-package" && mediaType === "application/zip")
    return MAX_ARCHIVE;
  if (
    (purpose === "input-payload" || purpose === "generated-source") &&
    PREVIEW_FILE_MEDIA.has(mediaType)
  )
    return MAX_PREVIEW_FILE;
  return exportRunUnavailable();
}
const WRITE_PURPOSES = new Set<ObjectPurpose>([
  "checkpoint-state",
  "report",
  "build-output",
  "validation-report",
  "evidence",
  "artifact-manifest",
  "export-package",
  "architecture-revision",
  "solution-revision-manifest",
  "generated-source",
  "input-payload",
]);

export function exportStoredObject(row: SqlRow): StoredObjectReference {
  const provider = row["storage_provider"];
  const purpose = exportRunText(row["object_purpose"]);
  const rawSize = row["size_bytes"];
  const size =
    typeof rawSize === "string" && /^(0|[1-9][0-9]*)$/u.test(rawSize)
      ? Number(rawSize)
      : rawSize;
  if (
    !["s3", "filesystem", "memory"].includes(String(provider)) ||
    !isObjectPurpose(purpose) ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_ARCHIVE
  )
    exportRunUnavailable();
  return {
    objectId: exportRunText(row["object_id"]),
    purpose,
    owner: {
      organizationId: exportRunText(row["organization_id"]),
      projectId: exportRunText(row["project_id"]),
    },
    storageProvider: provider as StoredObjectReference["storageProvider"],
    storageKey: exportRunText(row["storage_key"]),
    objectVersion: exportRunText(row["object_version"]),
    ...(row["entity_tag"] == null
      ? {}
      : { entityTag: exportRunText(row["entity_tag"]) }),
    contentSha256: exportRunText(row["content_sha256"]),
    mediaType: exportRunText(row["media_type"]),
    sizeBytes: size,
  };
}

export function exportJobObject(
  reference: StoredObjectReference,
): AsyncJobObjectReferenceV1 {
  return asyncJobObjectReferenceV1Schema.parse({
    contractVersion: 1,
    objectId: reference.objectId,
    digest: `sha256:${reference.contentSha256}`,
    sizeBytes: reference.sizeBytes,
    mediaType: reference.mediaType,
    purpose: reference.purpose,
  });
}

/** Bounded immutable workflow bytes. Published object metadata is not public artifact availability. */
export class SolutionExportWorkflowStorage {
  readonly authority: SolutionExportObjectAuthority;
  readonly store: ObjectStore;
  constructor(authority: SolutionExportObjectAuthority, store: ObjectStore) {
    this.authority = authority;
    this.store = store;
  }
  identity(purpose: string, value: unknown): string {
    return `object.export.${exportRunSha(exportRunBytes({ contractVersion: 1, ...this.authority.ownership, purpose, value }))}`;
  }
  async metadata(
    objectId: string,
  ): Promise<{ reference: StoredObjectReference; state: string } | null> {
    if (this.authority.objectMetadata !== undefined) {
      const { row } = await this.authority.objectMetadata(objectId);
      return row === null
        ? null
        : {
            reference: exportStoredObject(row),
            state: exportRunText(row["lifecycle_state"]),
          };
    }
    const found = await this.authority.query(
      sql(
        "SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3",
        [
          this.authority.ownership.organizationId,
          this.authority.ownership.projectId,
          objectId,
        ],
      ),
    );
    const row = found.rows[0];
    return row === undefined
      ? null
      : {
          reference: exportStoredObject(row),
          state: exportRunText(row["lifecycle_state"]),
        };
  }
  async read(reference: StoredObjectReference): Promise<Uint8Array> {
    const expected = structuredClone(reference);
    if (
      expected.sizeBytes >
      solutionExportWorkflowByteLimit(expected.purpose, expected.mediaType)
    )
      exportRunUnavailable();
    const before = await this.metadata(expected.objectId);
    if (
      before?.state !== "published" ||
      !referencesMatch(before.reference, expected)
    )
      exportRunUnavailable();
    const scope = await this.authority.scope();
    assertObjectReference(scope, expected);
    if (expected.owner.projectId !== this.authority.ownership.projectId)
      exportRunUnavailable();
    const chunks: Uint8Array[] = [];
    for await (const chunk of verifiedObjectStream(
      await this.store.open(scope, expected),
      expected.sizeBytes,
      expected.contentSha256,
    ))
      chunks.push(chunk.slice());
    const after = await this.metadata(expected.objectId);
    if (
      after?.state !== "published" ||
      !referencesMatch(after.reference, expected)
    )
      exportRunUnavailable();
    return new Uint8Array(Buffer.concat(chunks));
  }
  async readJson(reference: StoredObjectReference): Promise<unknown> {
    if (reference.mediaType !== "application/json") exportRunUnavailable();
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await this.read(reference),
        ),
      ) as unknown;
    } catch {
      exportRunUnavailable();
    }
  }
  async put(
    bytesInput: Uint8Array,
    purpose: ObjectPurpose,
    mediaType: string,
    objectId?: string,
  ): Promise<StoredObjectReference> {
    const bytes = Uint8Array.from(bytesInput);
    if (
      this.authority.permission !== "exports.run" ||
      !WRITE_PURPOSES.has(purpose) ||
      bytes.length > solutionExportWorkflowByteLimit(purpose, mediaType) ||
      (purpose === "export-package" && mediaType !== "application/zip") ||
      ([
        "checkpoint-state",
        "report",
        "evidence",
        "artifact-manifest",
        "validation-report",
        "build-output",
      ].includes(purpose) &&
        mediaType !== "application/json")
    )
      exportRunUnavailable();
    const digest = exportRunSha(bytes);
    const id = objectId ?? this.identity(purpose, { digest, mediaType });
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id))
      exportRunUnavailable();
    let current = await this.metadata(id);
    if (current === null) {
      const scope = await this.authority.scope();
      const staged = await this.store.stage(scope, {
        objectId: id,
        owner: this.authority.ownership,
        purpose,
        mediaType,
        contentSha256: digest,
        sizeBytes: bytes.length,
        open: async function* () {
          yield await Promise.resolve(bytes.slice());
        },
      });
      assertObjectReference(scope, staged);
      if (
        staged.objectId !== id ||
        staged.owner.projectId !== this.authority.ownership.projectId ||
        staged.purpose !== purpose ||
        staged.mediaType !== mediaType ||
        staged.contentSha256 !== digest ||
        staged.sizeBytes !== bytes.length
      )
        exportRunUnavailable();
      await this.authority.query(
        sql(
          `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,
        object_purpose,storage_key,object_version,entity_tag,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'publication-pending',$12) ON CONFLICT DO NOTHING`,
          [
            id,
            scope.organizationId,
            this.authority.ownership.projectId,
            staged.storageProvider,
            purpose,
            staged.storageKey,
            staged.objectVersion,
            staged.entityTag ?? null,
            digest,
            bytes.length,
            mediaType,
            scope.principalId,
          ],
        ),
      );
      current = await this.metadata(id);
    }
    if (
      current?.reference.purpose !== purpose ||
      current.reference.mediaType !== mediaType ||
      current.reference.contentSha256 !== digest ||
      current.reference.sizeBytes !== bytes.length ||
      !["publication-pending", "published"].includes(current.state)
    )
      exportRunUnavailable();
    if (current.state === "publication-pending") {
      await this.store.publish(await this.authority.scope(), current.reference);
      await this.authority.query(
        sql(
          `UPDATE stored_objects SET lifecycle_state='published',published_at=COALESCE(published_at,clock_timestamp())
        WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND object_version=$4 AND content_sha256=$5 AND lifecycle_state='publication-pending'`,
          [
            this.authority.ownership.organizationId,
            this.authority.ownership.projectId,
            id,
            current.reference.objectVersion,
            digest,
          ],
        ),
      );
    }
    if (
      !Buffer.from(await this.read(current.reference)).equals(
        Buffer.from(bytes),
      )
    )
      exportRunUnavailable();
    return current.reference;
  }
}
