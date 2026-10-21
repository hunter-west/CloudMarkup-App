import { createHash } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { ObjectStoreError } from "../../application/persistence.js";
import {
  closeProjectContentWrites,
  assertProjectContentErasureAuthority,
} from "./project-content-write-fence.js";
import {
  createS3ProjectContentEraser,
  type ProjectErasureBinding,
} from "./s3-project-content-eraser.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";
import {
  projectCleanupWake,
  parseProjectCleanupWake,
  type ProjectCleanupWake,
} from "../../application/project-cleanup-wake.js";

const names = ["documents", "artifacts", "evidence"] as const;
function unavailable(): never {
  throw new ObjectStoreError(
    "storage-unavailable",
    "Project content cleanup is unavailable.",
  );
}
function count(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value))
    unavailable();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) unavailable();
  return number;
}
export type ProjectContentCleanupResult =
  | { readonly state: "completed" }
  | {
      readonly state: "pending";
      readonly reason: "work" | "storage" | "remaining-content";
    };

/** Trusted observed persistence capability, never executable operator settings.
 * Coverage must inspect every retained reference for the exact provider/root.
 * Erasure must inventory unreferenced/staged bytes too, retain deletion controls,
 * refuse ambiguous/link/legacy state and observe absence under the supplied
 * current closed-writer authority before acknowledging completion. */
export interface ProjectContentStoragePolicy {
  readonly storageProvider: "filesystem";
  readonly configurationSha256: string;
  assertReferenceCoverage(
    tx: SqlExecutor,
    binding: ProjectErasureBinding,
  ): Promise<void>;
  erasePage(
    binding: ProjectErasureBinding,
    assertCurrentAuthority: () => Promise<void>,
  ): Promise<{ readonly observedEmpty: boolean }>;
}
type StorageConfiguration =
  | {
      readonly client: S3Client;
      readonly bucket: string;
      readonly expectedBucketOwner: string;
      readonly prefixes: Readonly<Record<(typeof names)[number], string>>;
      readonly storagePolicy?: never;
    }
  | {
      readonly storagePolicy: ProjectContentStoragePolicy;
      readonly client?: never;
      readonly bucket?: never;
      readonly expectedBucketOwner?: never;
      readonly prefixes?: never;
    };

/** Resumable active-storage cleanup of a previously authorized project deletion.
 * This erases project object bytes, clears mutable project labels and records
 * exact absence verification. Immutable billing/security/provenance metadata and
 * existing backups remain under their established retention. It never mutates a
 * customer cloud deployment or a separately exported GitHub repository. */
export function createProjectContentCleanup(
  configuration: {
    readonly database: SqlDatabase;
    readonly deletionRecovery?: {
      readonly drain: (binding: ProjectErasureBinding) => Promise<boolean>;
      readonly assertSealed: (binding: ProjectErasureBinding) => Promise<void>;
    };
  } & StorageConfiguration,
) {
  const { database, bucket, expectedBucketOwner } = configuration;
  const configuredPolicy = configuration.storagePolicy;
  if (
    configuredPolicy !== undefined &&
    (Object.keys(configuration).some((key) =>
      ["client", "bucket", "expectedBucketOwner", "prefixes"].includes(key),
    ) ||
      !["filesystem"].includes(configuredPolicy.storageProvider) ||
      !/^[a-f0-9]{64}$/u.test(configuredPolicy.configurationSha256) ||
      typeof configuredPolicy.assertReferenceCoverage !== "function" ||
      typeof configuredPolicy.erasePage !== "function")
  )
    unavailable();
  const storagePolicy =
    configuredPolicy === undefined
      ? undefined
      : Object.freeze({
          storageProvider: configuredPolicy.storageProvider,
          configurationSha256: configuredPolicy.configurationSha256,
          assertReferenceCoverage:
            configuredPolicy.assertReferenceCoverage.bind(configuredPolicy),
          erasePage: configuredPolicy.erasePage.bind(configuredPolicy),
        });
  const prefixes =
    storagePolicy === undefined
      ? names.map((name) => {
          const prefix = configuration.prefixes?.[name];
          if (typeof prefix !== "string") unavailable();
          return { name, prefix: prefix.replace(/^\/+|\/+$/gu, "") };
        })
      : [];
  if (
    (storagePolicy === undefined &&
      new Set(prefixes.map(({ prefix }) => prefix)).size !== names.length) ||
    prefixes.some(
      ({ prefix }) => !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(prefix),
    )
  )
    unavailable();
  const configurationDigest =
    storagePolicy?.configurationSha256 ??
    createHash("sha256")
      .update(
        JSON.stringify({
          policyVersion: 1,
          bucket,
          expectedBucketOwner,
          prefixes,
        }),
      )
      .digest("hex");
  function keys(
    binding: Pick<ProjectErasureBinding, "organizationId" | "projectId">,
  ) {
    return prefixes.map(
      ({ prefix }) =>
        prefix +
        "/v1/organizations/" +
        binding.organizationId +
        "/projects/" +
        binding.projectId +
        "/",
    );
  }
  function s3Options() {
    if (configuration.storagePolicy !== undefined) unavailable();
    return {
      client: configuration.client,
      bucket: configuration.bucket,
      expectedBucketOwner: configuration.expectedBucketOwner,
    };
  }
  async function footprint(tx: SqlExecutor, binding: ProjectErasureBinding) {
    if (storagePolicy !== undefined) {
      const observed = await tx.query(
        sql(
          `SELECT count(*)::text AS object_count,
        count(*) FILTER (WHERE storage_provider<>$3)::text AS unsupported
        FROM stored_objects WHERE organization_id=$1 AND project_id=$2`,
          [
            binding.organizationId,
            binding.projectId,
            storagePolicy.storageProvider,
          ],
        ),
      );
      if (
        observed.rows.length !== 1 ||
        count(observed.rows[0]?.["unsupported"]) !== 0
      )
        unavailable();
      await storagePolicy.assertReferenceCoverage(tx, binding);
      return count(observed.rows[0]?.["object_count"]);
    }
    const result = await tx.query(
      sql(
        `SELECT count(*)::text AS object_count,
        count(*) FILTER (WHERE storage_provider<>'s3' OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text($3::jsonb) prefix
          WHERE starts_with(o.storage_key,prefix)))::text AS unsupported
        FROM stored_objects o WHERE organization_id=$1 AND project_id=$2`,
        [
          binding.organizationId,
          binding.projectId,
          JSON.stringify(keys(binding)),
        ],
      ),
    );
    if (
      result.rows.length !== 1 ||
      count(result.rows[0]?.["unsupported"]) !== 0
    )
      unavailable();
    return count(result.rows[0]?.["object_count"]);
  }
  async function replay(input: {
    readonly organizationId: string;
    readonly projectId: string;
  }) {
    const found = await database.query(
      sql(
        `SELECT p.lifecycle_status,r.storage_configuration_sha256
        FROM projects p LEFT JOIN project_content_erasure_receipts r
          ON r.organization_id=p.organization_id AND r.project_id=p.project_id
        WHERE p.organization_id=$1 AND p.project_id=$2`,
        [input.organizationId, input.projectId],
      ),
    );
    if (found.rows[0]?.["lifecycle_status"] !== "deleted") return false;
    if (found.rows[0]["storage_configuration_sha256"] !== configurationDigest)
      unavailable();
    return true;
  }
  return {
    /** Shadow metadata read: no keys, bodies or erasure authority are published. */
    async wakeBinding(input: {
      readonly organizationId: string;
      readonly projectId: string;
    }) {
      const found = await database.query(
        sql(
          `SELECT record_version,to_char(deletion_requested_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at
         FROM projects WHERE organization_id=$1 AND project_id=$2
         AND lifecycle_status='deletion-pending' AND deletion_requested_at IS NOT NULL`,
          [input.organizationId, input.projectId],
        ),
      );
      if (found.rows.length === 0) return null;
      const row = found.rows[0];
      if (found.rows.length !== 1 || typeof row?.["requested_at"] !== "string")
        unavailable();
      return projectCleanupWake({
        ...input,
        lifecycleStatus: "deletion-pending",
        recordVersion: Number(row["record_version"]),
        deletionRequestedAt: row["requested_at"],
      });
    },
    /** Only the exact canonical deletion binding and storage receipt can clear a wake. */
    async inspectWake(
      wake: ProjectCleanupWake,
    ): Promise<"pending" | "completed" | "unconfirmed"> {
      const found = await database.query(
        sql(
          `SELECT p.lifecycle_status,p.record_version,to_char(p.deletion_requested_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at,
          r.deletion_record_version,to_char(r.deletion_requested_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS receipt_requested_at,r.storage_configuration_sha256
         FROM projects p LEFT JOIN project_content_erasure_receipts r
           ON r.organization_id=p.organization_id AND r.project_id=p.project_id
         WHERE p.organization_id=$1 AND p.project_id=$2`,
          [wake.organizationId, wake.projectId],
        ),
      );
      const row = found.rows[0];
      if (found.rows.length !== 1 || row === undefined) return "unconfirmed";
      if (
        row["lifecycle_status"] === "deleted" &&
        Number(row["deletion_record_version"]) === wake.recordVersion &&
        row["receipt_requested_at"] === wake.deletionRequestedAt &&
        row["storage_configuration_sha256"] === configurationDigest
      )
        return "completed";
      if (
        row["lifecycle_status"] === "deletion-pending" &&
        Number(row["record_version"]) === wake.recordVersion &&
        row["requested_at"] === wake.deletionRequestedAt
      )
        return "pending";
      return "unconfirmed";
    },
    /** Host-only inventory. Each candidate must independently close and verify
     * its persisted deletion intent; listing is not deletion authority. */
    async listPending(limit = 10) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25)
        unavailable();
      const result = await database.query(
        sql(
          `SELECT organization_id,project_id FROM projects WHERE lifecycle_status='deletion-pending'
          AND deletion_requested_at IS NOT NULL
          ORDER BY content_cleanup_attempted_at NULLS FIRST,deletion_requested_at,project_id LIMIT $1`,
          [limit],
        ),
      );
      return result.rows.map((row) => {
        const organizationId = row["organization_id"],
          projectId = row["project_id"];
        if (typeof organizationId !== "string" || typeof projectId !== "string")
          unavailable();
        return { organizationId, projectId };
      });
    },
    async process(input: {
      readonly organizationId: string;
      readonly projectId: string;
      readonly deletionBinding?: ProjectCleanupWake;
    }): Promise<ProjectContentCleanupResult> {
      const expected =
        input.deletionBinding === undefined
          ? undefined
          : parseProjectCleanupWake(input.deletionBinding);
      if (
        expected !== undefined &&
        (expected.organizationId !== input.organizationId ||
          expected.projectId !== input.projectId)
      )
        unavailable();
      if (await replay(input)) return { state: "completed" };
      let admission: Awaited<ReturnType<typeof closeProjectContentWrites>>;
      try {
        await database.query(
          sql(
            "UPDATE projects SET content_cleanup_attempted_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='deletion-pending'",
            [input.organizationId, input.projectId],
          ),
        );
        admission = await closeProjectContentWrites(database, {
          organizationId: input.organizationId,
          projectId: input.projectId,
        });
        if (
          expected !== undefined &&
          (admission.binding.recordVersion !== expected.recordVersion ||
            admission.binding.deletionRequestedAt !==
              expected.deletionRequestedAt)
        )
          unavailable();
        if (admission.ready) await footprint(database, admission.binding);
      } catch (error) {
        // Another worker can finish after our initial replay read and before
        // admission closes. Only its exact immutable receipt proves completion.
        if (await replay(input)) return { state: "completed" };
        throw error;
      }
      const { binding, ready } = admission;
      if (configuration.deletionRecovery !== undefined) {
        try {
          if (!(await configuration.deletionRecovery.drain(binding)))
            return { state: "pending", reason: "work" };
        } catch {
          if (await replay(input)) return { state: "completed" };
          return { state: "pending", reason: "work" };
        }
      }
      if (!ready && configuration.deletionRecovery === undefined)
        return { state: "pending", reason: "work" };
      const assertCurrentAuthority = async () => {
        await configuration.deletionRecovery?.assertSealed(binding);
        await assertProjectContentErasureAuthority(database, binding);
      };
      const erasers =
        storagePolicy === undefined
          ? prefixes.map(({ prefix }) => {
              return createS3ProjectContentEraser({
                ...s3Options(),
                keyPrefix: prefix,
                binding,
                assertCurrentAuthority: async (current) => {
                  await configuration.deletionRecovery?.assertSealed(current);
                  await assertProjectContentErasureAuthority(database, current);
                },
              });
            })
          : [
              {
                erasePage: async () => {
                  await assertCurrentAuthority();
                  const result = await storagePolicy.erasePage(
                    binding,
                    assertCurrentAuthority,
                  );
                  await assertCurrentAuthority();
                  return result;
                },
              },
            ];
      for (const eraser of erasers) {
        try {
          const result = await eraser.erasePage();
          if (!result.observedEmpty)
            return { state: "pending", reason: "remaining-content" };
        } catch {
          if (await replay(input)) return { state: "completed" };
          return { state: "pending", reason: "storage" };
        }
      }
      try {
        await configuration.deletionRecovery?.assertSealed(binding);
        await assertProjectContentErasureAuthority(database, binding);
        await database.transaction(async (tx) => {
          // The persistent fence is already closed. Take the project lock before
          // object metadata so any pre-existing metadata writer drains first.
          const project = await tx.query(
            sql(
              `SELECT record_version FROM projects WHERE organization_id=$1 AND project_id=$2
            AND lifecycle_status='deletion-pending' AND record_version=$3 FOR UPDATE`,
              [
                binding.organizationId,
                binding.projectId,
                binding.recordVersion,
              ],
            ),
          );
          if (project.rows.length !== 1) unavailable();
          const objectCount = await footprint(tx, binding);
          await tx.query(
            sql(
              `UPDATE stored_objects SET lifecycle_state='deleted',
            delete_requested_at=COALESCE(delete_requested_at,clock_timestamp()),deleted_at=clock_timestamp()
            WHERE organization_id=$1 AND project_id=$2 AND lifecycle_state<>'deleted'`,
              [binding.organizationId, binding.projectId],
            ),
          );
          await tx.query(
            sql(
              `INSERT INTO project_content_erasure_receipts(organization_id,project_id,deletion_record_version,
            deletion_requested_at,write_scope_closed_at,storage_configuration_sha256,object_metadata_count)
            SELECT p.organization_id,p.project_id,p.record_version,p.deletion_requested_at,s.closed_at,$3,$4
            FROM projects p JOIN project_content_write_scopes s
              ON s.organization_id=p.organization_id AND s.project_id=p.project_id
            WHERE p.organization_id=$1 AND p.project_id=$2`,
              [
                binding.organizationId,
                binding.projectId,
                configurationDigest,
                objectCount,
              ],
            ),
          );
          await tx.query(
            sql(
              `UPDATE project_environments SET lifecycle_status='deleted',
            name='Deleted environment ' || md5(environment_id),region=NULL,
            deletion_requested_at=COALESCE(deletion_requested_at,clock_timestamp()),
            deleted_at=clock_timestamp(),updated_at=clock_timestamp(),record_version=record_version+1
            WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status<>'deleted'`,
              [binding.organizationId, binding.projectId],
            ),
          );
          await tx.query(
            sql(
              `UPDATE projects SET lifecycle_status='deleted',name='Deleted project',description=NULL,
            deleted_at=clock_timestamp(),updated_at=clock_timestamp(),record_version=record_version+1
            WHERE organization_id=$1 AND project_id=$2 AND record_version=$3`,
              [
                binding.organizationId,
                binding.projectId,
                binding.recordVersion,
              ],
            ),
          );
        });
      } catch {
        if (await replay(input)) return { state: "completed" };
        return { state: "pending", reason: "storage" };
      }
      return { state: "completed" };
    },
  };
}
