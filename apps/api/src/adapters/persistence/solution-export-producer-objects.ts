import { sha256DigestSchema } from "@cloudmarkup/schemas";
import type {
  AuthorizedOrganizationScope,
  ObjectPurpose,
  ObjectStore,
  StoredObjectReference,
} from "../../application/persistence.js";
import type { AsyncJobPersistenceObjectPort } from "./async-job-repository.js";
import {
  assertObjectReference,
  referencesMatch,
  verifiedObjectStream,
} from "./object-store-common.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunInteger,
  exportRunSha,
  exportRunText,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

/** Every operation requires a current, exact-owner authority; this is not a bypass. */
export interface SolutionExportObjectAuthority extends SqlExecutor {
  readonly ownership: {
    readonly organizationId: string;
    readonly projectId: string;
  };
  readonly permission: "artifacts.read" | "exports.run" | "projects.mutate";
  scope(): Promise<AuthorizedOrganizationScope>;
  objectMetadata?(
    objectId: string,
  ): Promise<{ scope: AuthorizedOrganizationScope; row: SqlRow | null }>;
}

const MAX_BYTES = 4 * 1024 * 1024;
function reference(row: SqlRow): StoredObjectReference {
  const provider = row["storage_provider"];
  if (provider !== "memory" && provider !== "filesystem" && provider !== "s3")
    exportRunUnavailable();
  return {
    objectId: exportRunText(row["object_id"]),
    owner: {
      organizationId: exportRunText(row["organization_id"]),
      projectId: exportRunText(row["project_id"]),
    },
    storageProvider: provider,
    storageKey: exportRunText(row["storage_key"]),
    objectVersion: exportRunText(row["object_version"]),
    ...(row["entity_tag"] == null
      ? {}
      : { entityTag: exportRunText(row["entity_tag"]) }),
    contentSha256: exportRunText(row["content_sha256"]),
    sizeBytes: exportRunInteger(row["size_bytes"]),
    mediaType: exportRunText(row["media_type"]),
    purpose: exportRunText(row["object_purpose"]) as ObjectPurpose,
  };
}
/** Exact-owner bounded JSON publication with recoverable staged metadata; no artifact authority. */
export class SolutionExportProducerObjects<
  TAuthority extends SolutionExportObjectAuthority =
    SolutionExportObjectAuthority,
> {
  readonly authority: TAuthority;
  readonly store: ObjectStore;
  constructor(authority: TAuthority, store: ObjectStore) {
    this.authority = authority;
    this.store = store;
  }
  /** stored_objects has global identity: content equality cannot erase tenant scope. */
  identity(purpose: string, digest: string): string {
    return `object.export.${exportRunSha(exportRunBytes({ contractVersion: 1, ...this.authority.ownership, purpose, digest: sha256DigestSchema.parse(digest) }))}`;
  }
  async metadata(
    objectId: string,
  ): Promise<{ reference: StoredObjectReference; state: string } | null> {
    if (this.authority.objectMetadata !== undefined) {
      const { row } = await this.authority.objectMetadata(objectId);
      return row === null
        ? null
        : {
            reference: reference(row),
            state: exportRunText(row["lifecycle_state"]),
          };
    }
    const result = await this.authority.query(
      sql(
        "SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3",
        [
          this.authority.ownership.organizationId,
          this.authority.ownership.projectId,
          objectId,
        ],
      ),
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          reference: reference(row),
          state: exportRunText(row["lifecycle_state"]),
        };
  }
  private async scopedMetadata(objectId: string) {
    if (this.authority.objectMetadata !== undefined) {
      const { scope, row } = await this.authority.objectMetadata(objectId);
      return {
        scope,
        stored:
          row === null
            ? null
            : {
                reference: reference(row),
                state: exportRunText(row["lifecycle_state"]),
              },
      };
    }
    const scope = await this.authority.scope();
    return { scope, stored: await this.metadata(objectId) };
  }
  async read(expected: StoredObjectReference): Promise<Uint8Array> {
    if (
      expected.sizeBytes > MAX_BYTES ||
      expected.sizeBytes < 1 ||
      expected.mediaType !== "application/json"
    )
      exportRunUnavailable();
    const { scope, stored } = await this.scopedMetadata(expected.objectId);
    if (
      stored?.state !== "published" ||
      !referencesMatch(stored.reference, expected)
    )
      exportRunUnavailable();
    assertObjectReference(scope, expected);
    const chunks: Uint8Array[] = [];
    for await (const chunk of verifiedObjectStream(
      await this.store.open(scope, expected),
      expected.sizeBytes,
      expected.contentSha256,
    ))
      chunks.push(chunk);
    const final = await this.metadata(expected.objectId);
    if (
      final?.state !== "published" ||
      !referencesMatch(final.reference, expected)
    )
      exportRunUnavailable();
    return new Uint8Array(Buffer.concat(chunks));
  }
  async put(
    bytesInput: Uint8Array,
    purpose: "input-payload" | "checkpoint-state" | "report" | "proposal",
    objectId: string,
  ): Promise<StoredObjectReference> {
    if (!["exports.run", "projects.mutate"].includes(this.authority.permission))
      exportRunUnavailable();
    const bytes = Uint8Array.from(bytesInput);
    if (bytes.length < 1 || bytes.length > MAX_BYTES) exportRunUnavailable();
    const digest = exportRunSha(bytes);
    const initial = await this.scopedMetadata(objectId);
    const scope = initial.scope;
    let stored = initial.stored;
    if (stored === null) {
      const staged = await this.store.stage(scope, {
        objectId,
        owner: this.authority.ownership,
        purpose,
        contentSha256: digest,
        sizeBytes: bytes.length,
        mediaType: "application/json",
        open: async function* () {
          yield await Promise.resolve(bytes);
        },
      });
      assertObjectReference(scope, staged);
      if (
        staged.objectId !== objectId ||
        staged.owner.projectId !== this.authority.ownership.projectId ||
        staged.purpose !== purpose ||
        staged.contentSha256 !== digest ||
        staged.sizeBytes !== bytes.length ||
        staged.mediaType !== "application/json"
      )
        exportRunUnavailable();
      await this.authority.query(
        sql(
          `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,entity_tag,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'publication-pending',$12) ON CONFLICT DO NOTHING`,
          [
            staged.objectId,
            staged.owner.organizationId,
            staged.owner.projectId ?? null,
            staged.storageProvider,
            staged.purpose,
            staged.storageKey,
            staged.objectVersion,
            staged.entityTag ?? null,
            staged.contentSha256,
            staged.sizeBytes,
            staged.mediaType,
            scope.principalId,
          ],
        ),
      );
      stored = await this.metadata(objectId);
    }
    if (
      stored?.reference.purpose !== purpose ||
      stored.reference.contentSha256 !== digest ||
      stored.reference.sizeBytes !== bytes.length ||
      stored.reference.mediaType !== "application/json" ||
      !["publication-pending", "published"].includes(stored.state)
    )
      exportRunUnavailable();
    const actual = stored.reference;
    if (stored.state === "publication-pending") {
      await this.store.publish(await this.authority.scope(), actual);
      await this.authority.query(
        sql(
          "UPDATE stored_objects SET lifecycle_state='published',published_at=COALESCE(published_at,clock_timestamp()) WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND object_version=$4 AND content_sha256=$5 AND lifecycle_state='publication-pending'",
          [
            actual.owner.organizationId,
            actual.owner.projectId ?? null,
            actual.objectId,
            actual.objectVersion,
            actual.contentSha256,
          ],
        ),
      );
    }
    const read = await this.read(actual);
    if (!Buffer.from(read).equals(Buffer.from(bytes))) exportRunUnavailable();
    return actual;
  }
  jobPort(
    inputObjectId: string,
    inputDigest: string,
  ): AsyncJobPersistenceObjectPort {
    return {
      put: async (input) => {
        if (
          !exportRunEqual(input.ownership, this.authority.ownership) ||
          input.digest !== `sha256:${exportRunSha(input.bytes)}` ||
          (input.kind === "input" && input.digest !== inputDigest)
        )
          exportRunUnavailable();
        const object = await this.put(
          input.bytes,
          input.kind === "input" ? "input-payload" : "report",
          input.kind === "input"
            ? inputObjectId
            : this.identity(input.kind, input.digest),
        );
        return {
          objectId: object.objectId,
          digest: sha256DigestSchema.parse(`sha256:${object.contentSha256}`),
          sizeBytes: object.sizeBytes,
        };
      },
      get: async (input) => {
        if (!exportRunEqual(input.ownership, this.authority.ownership))
          exportRunUnavailable();
        const stored = await this.metadata(input.objectId);
        if (
          stored?.reference.contentSha256 !== input.digest.slice(7) ||
          stored.reference.sizeBytes !== input.sizeBytes ||
          stored.reference.purpose !==
            (input.kind === "input" ? "input-payload" : "report")
        )
          exportRunUnavailable();
        return this.read(stored.reference);
      },
    };
  }
}
