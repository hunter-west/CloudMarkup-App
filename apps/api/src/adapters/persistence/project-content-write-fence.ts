import { cleanupRequired } from "./cleanup-required.js";
import {
  cleanupHistoryId,
  confirmCleanupHistory,
  type CleanupHistoryPort,
  type CleanupHistoryEnvelope,
} from "../../application/project-cleanup-history.js";
import { randomUUID } from "node:crypto";
import type {
  AuthorizedOrganizationScope,
  ObjectStore,
  StageObjectInput,
} from "../../application/persistence.js";
import { ObjectStoreError } from "../../application/persistence.js";
import { assertStageInput } from "./object-store-common.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";
import type { ProjectErasureBinding } from "./s3-project-content-eraser.js";

function unavailable(): never {
  throw new ObjectStoreError(
    "storage-unavailable",
    "The project storage authority is unavailable.",
  );
}
async function lockScope(
  tx: SqlExecutor,
  organizationId: string,
  projectId: string,
) {
  await tx.query(
    sql(
      "INSERT INTO project_content_write_scopes(organization_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [organizationId, projectId],
    ),
  );
  const result = await tx.query(
    sql(
      "SELECT closed_at FROM project_content_write_scopes WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
      [organizationId, projectId],
    ),
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined || !("closed_at" in row))
    unavailable();
  return row;
}

/** Close admission before erasure and retain uncertain writes as blockers.
 * The original user-authorized deletion tombstone is the durable intent;
 * removal of that user's later session cannot reopen or cancel that intent. */
export async function closeProjectContentWrites(
  database: SqlDatabase,
  input: {
    readonly organizationId: string;
    readonly projectId: string;
  },
): Promise<{
  readonly binding: ProjectErasureBinding;
  readonly ready: boolean;
}> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.organizationId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.projectId) ||
    input.projectId === "organization"
  )
    unavailable();
  const scope = { ...input };
  return database.transaction(async (tx) => {
    const fence = await lockScope(tx, scope.organizationId, scope.projectId);
    const found = await tx.query(
      sql(
        `SELECT record_version,to_char(deletion_requested_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at
       FROM projects WHERE organization_id=$1 AND project_id=$2
         AND lifecycle_status='deletion-pending' AND deletion_requested_at IS NOT NULL FOR SHARE`,
        [scope.organizationId, scope.projectId],
      ),
    );
    const row = found.rows[0];
    if (
      found.rows.length !== 1 ||
      row === undefined ||
      typeof row["requested_at"] !== "string"
    )
      unavailable();
    const recordVersion = Number(row["record_version"]);
    if (!Number.isSafeInteger(recordVersion) || recordVersion < 1)
      unavailable();
    if (fence["closed_at"] === null)
      await tx.query(
        sql(
          "UPDATE project_content_write_scopes SET closed_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND closed_at IS NULL",
          [scope.organizationId, scope.projectId],
        ),
      );
    // A deleted project's proposal authority rejects new dispatch and every
    // publication. Once its last execution lease ends, an orphan queued proposal
    // cannot write again; retaining its metadata must not block content erasure.
    // Registered uncertain writes and every other work family still block cleanup.
    const pending = await tx.query(
      sql(
        `SELECT (
          EXISTS(SELECT 1 FROM project_content_writes WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status<>'completed')
          OR EXISTS(SELECT 1 FROM async_jobs j WHERE j.organization_id=$1 AND j.project_id=$2
            AND j.lifecycle_status NOT IN ('succeeded','failed','canceled','expired','superseded')
            AND (j.family<>'architecture-proposal'
              OR j.idempotency_scope IS DISTINCT FROM 'cloudmarkup.beta-infrastructure-proposals.create'
              OR j.parent_job_id IS NOT NULL OR j.root_job_id IS DISTINCT FROM j.job_id
              OR EXISTS(
              SELECT 1 FROM async_job_attempts a WHERE a.organization_id=j.organization_id
                AND a.job_id=j.job_id AND a.lifecycle_status='running'
                AND a.lease_expires_at > clock_timestamp())))
          OR EXISTS(SELECT 1 FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status NOT IN ('succeeded','failed','canceled'))
          OR EXISTS(SELECT 1 FROM credit_reservations WHERE organization_id=$1 AND project_id=$2 AND status='active')
        ) AS pending`,
        [scope.organizationId, scope.projectId],
      ),
    );
    if (typeof pending.rows[0]?.["pending"] !== "boolean") unavailable();
    return {
      binding: {
        ...scope,
        deletionRequestedAt: row["requested_at"],
        recordVersion,
      },
      ready: !pending.rows[0]["pending"],
    };
  });
}

/** Every S3 body write in the production API passes through this adapter.
 * Registration commits before external I/O. A provider or recording failure
 * remains durable and prevents an erasure receipt; elapsed time alone never
 * turns unknown completion into absence. No content enters this journal. */
export function createProjectWriteFencedObjectStore(configuration: {
  readonly database: SqlDatabase;
  readonly delegate: ObjectStore;
  readonly storageNamespace: string;
  readonly history?: CleanupHistoryPort;
}): ObjectStore {
  const { database, delegate, storageNamespace } = configuration;
  if (!/^[a-z][a-z0-9._-]{0,127}$/u.test(storageNamespace)) unavailable();
  async function begin(
    scope: AuthorizedOrganizationScope,
    value: StageObjectInput,
  ): Promise<string | null> {
    assertStageInput(scope, value);
    const projectId = value.owner.projectId;
    if (projectId === undefined) return null;
    if (projectId === "organization") unavailable();
    const writeId = "write_" + randomUUID().replaceAll("-", "");
    await database.transaction(async (tx) => {
      const fence = await lockScope(tx, scope.organizationId, projectId);
      if (fence["closed_at"] !== null) unavailable();
      const authority = await tx.query(
        sql(
          `SELECT m.membership_id FROM memberships m
        JOIN principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'
        JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
        JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
        WHERE m.organization_id=$1 AND m.principal_id=$2 AND m.membership_id=$3
          AND m.lifecycle_status='active' AND ('projects.create'=ANY(r.capabilities)
            OR 'projects.mutate'=ANY(r.capabilities) OR 'exports.run'=ANY(r.capabilities))
        FOR SHARE OF m,actor,o,r`,
          [scope.organizationId, scope.principalId, scope.membershipId],
        ),
      );
      if (authority.rows.length !== 1) unavailable();
      const project = await tx.query(
        sql(
          "SELECT organization_id,lifecycle_status FROM projects WHERE project_id=$1 FOR SHARE",
          [projectId],
        ),
      );
      // Initial draft staging precedes project creation, but its write scope is
      // already durable and will be closed by any later deletion.
      if (
        project.rows.length > 1 ||
        (project.rows.length === 1 &&
          (project.rows[0]?.["organization_id"] !== scope.organizationId ||
            project.rows[0]["lifecycle_status"] !== "active"))
      )
        unavailable();
      await tx.query(
        sql(
          `INSERT INTO project_content_writes(write_id,organization_id,project_id,storage_namespace,
          object_id,content_sha256,created_by_principal_id${configuration.history === undefined ? "" : ",history_id"}) VALUES($1,$2,$3,$4,$5,$6,$7${configuration.history === undefined ? "" : ",$8"})`,
          [
            writeId,
            scope.organizationId,
            projectId,
            storageNamespace,
            value.objectId,
            value.contentSha256,
            scope.principalId,
            ...(configuration.history === undefined
              ? []
              : [
                  cleanupHistoryId({
                    kind: "write",
                    writeId,
                    organizationId: scope.organizationId,
                    projectId,
                    objectId: value.objectId,
                    contentSha256: value.contentSha256,
                    sizeBytes: value.sizeBytes,
                    purpose: value.purpose,
                    mediaType: value.mediaType,
                    storageNamespace,
                    principalId: scope.principalId,
                  }),
                ]),
          ],
        ),
      );
    });
    return writeId;
  }
  async function finish(
    writeId: string | null,
    status: "completed" | "uncertain",
  ) {
    if (writeId === null) return;
    const updated = await database.query(
      sql(
        "UPDATE project_content_writes SET lifecycle_status=$2,finalized_at=clock_timestamp() WHERE write_id=$1 AND lifecycle_status='in-flight' RETURNING write_id",
        [writeId, status],
      ),
    );
    if (updated.rows.length !== 1) unavailable();
  }
  return {
    discardStaged: delegate.discardStaged.bind(delegate),
    head: delegate.head.bind(delegate),
    open: delegate.open.bind(delegate),
    publish: delegate.publish.bind(delegate),
    requestDeletion: delegate.requestDeletion.bind(delegate),
    async stage(scope, raw) {
      const value = { ...raw, owner: { ...raw.owner } };
      const writeId = await begin(scope, value);
      const envelope: CleanupHistoryEnvelope | undefined =
        writeId === null
          ? undefined
          : {
              kind: "write",
              writeId,
              organizationId: scope.organizationId,
              projectId: cleanupRequired(value.owner.projectId),
              objectId: value.objectId,
              contentSha256: value.contentSha256,
              sizeBytes: value.sizeBytes,
              purpose: value.purpose,
              mediaType: value.mediaType,
              storageNamespace,
              principalId: scope.principalId,
            };
      try {
        if (configuration.history !== undefined && envelope !== undefined) {
          await configuration.history.prepare(envelope);
          await confirmCleanupHistory({
            history: configuration.history,
            envelope,
            state: "prepared",
          });
          await configuration.history.transition(
            envelope,
            "prepared",
            "issued",
          );
          await confirmCleanupHistory({
            history: configuration.history,
            envelope,
            state: "issued",
          });
        }
        const object = await delegate.stage(scope, value);
        if (
          object.owner.organizationId !== value.owner.organizationId ||
          object.owner.projectId !== value.owner.projectId ||
          object.objectId !== value.objectId ||
          object.contentSha256 !== value.contentSha256 ||
          object.sizeBytes !== value.sizeBytes ||
          object.mediaType !== value.mediaType ||
          object.purpose !== value.purpose
        )
          unavailable();
        if (configuration.history !== undefined && envelope !== undefined) {
          await configuration.history.transition(
            envelope,
            "issued",
            "completed",
            {
              objectVersion: object.objectVersion,
              ...(object.entityTag === undefined
                ? {}
                : { entityTag: object.entityTag }),
            },
          );
          await confirmCleanupHistory({
            history: configuration.history,
            envelope,
            state: "completed",
          });
        }
        await finish(writeId, "completed");
        return object;
      } catch {
        // If this write outcome cannot be recorded, its in-flight row also
        // blocks cleanup. Never erase that evidence or assume no write occurred.
        try {
          await finish(writeId, "uncertain");
        } catch {
          /* durable row remains */
        }
        return unavailable();
      }
    },
  };
}

export async function assertProjectContentErasureAuthority(
  database: SqlDatabase,
  binding: ProjectErasureBinding,
): Promise<void> {
  const current = await closeProjectContentWrites(database, binding);
  if (
    !current.ready ||
    current.binding.organizationId !== binding.organizationId ||
    current.binding.projectId !== binding.projectId ||
    current.binding.recordVersion !== binding.recordVersion ||
    current.binding.deletionRequestedAt !== binding.deletionRequestedAt
  )
    unavailable();
}
