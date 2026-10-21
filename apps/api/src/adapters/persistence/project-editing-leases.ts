import { createHash, randomUUID } from "node:crypto";

import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type { PrincipalContext } from "../../application/ports.js";
import type {
  DraftWriteLeaseContext,
  ProjectEditingLeasePort,
  ProjectEditingLeaseProof,
  ProjectEditingLeaseState,
} from "../../application/project-editing-leases.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const leaseIdentifier =
  /^projectlease_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "Project editing is temporarily unavailable.",
  );
}
function lost(): never {
  throw new ApplicationError(
    "conflict",
    "This tab does not hold the active project editing lease.",
  );
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) unavailable();
  return value;
}
function hashToken(value: string): string {
  if (
    !/^[A-Za-z0-9_-]{43}$/u.test(value) ||
    Buffer.from(value, "base64url").byteLength !== 32 ||
    Buffer.from(value, "base64url").toString("base64url") !== value
  )
    throw new ApplicationError(
      "invalid_request",
      "The editing lease proof is invalid.",
    );
  return createHash("sha256").update(value).digest("hex");
}
function proofDigest(proof: ProjectEditingLeaseProof): string {
  if (!leaseIdentifier.test(proof.leaseId))
    throw new ApplicationError(
      "invalid_request",
      "The editing lease proof is invalid.",
    );
  return hashToken(proof.token);
}
function actor(
  principal: PrincipalContext,
  projectId: string,
): PrincipalContext {
  const cloned = structuredClone(principal);
  if (
    !identifier.test(projectId) ||
    !identifier.test(cloned.principalId) ||
    cloned.sessionId.length < 1 ||
    cloned.sessionId.length > 256 ||
    !Number.isFinite(Date.parse(cloned.expiresAt))
  )
    throw new ApplicationError(
      "invalid_request",
      "The project editing request is invalid.",
    );
  return cloned;
}

/** Locks the project first; all lease and draft writes use this same order. */
async function authority(
  tx: SqlExecutor,
  principal: PrincipalContext,
  projectId: string,
  permission: "projects.read" | "projects.mutate",
) {
  const result = await tx.query(
    sql(
      `SELECT project.organization_id, project.current_draft_id, m.membership_id, m.role_key,
    to_json(r.capabilities)::text AS capabilities_json
    FROM projects project
    JOIN organizations o ON o.organization_id=project.organization_id AND o.lifecycle_status='active'
    JOIN memberships m ON m.organization_id=o.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'
    JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
    WHERE project.project_id=$2 AND project.lifecycle_status='active'
    FOR UPDATE OF project FOR SHARE OF m,p,o,r`,
      [principal.principalId, projectId],
    ),
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined)
    throw new ApplicationError("not_found", "The project is unavailable.");
  const role = row["role_key"];
  if (typeof role !== "string" || !isOrganizationRole(role)) unavailable();
  let capabilities: unknown;
  try {
    capabilities = JSON.parse(text(row["capabilities_json"])) as unknown;
  } catch {
    unavailable();
  }
  if (
    !Array.isArray(capabilities) ||
    capabilities.some((entry: unknown) => typeof entry !== "string") ||
    JSON.stringify((capabilities as unknown[]).map(String).sort()) !==
      JSON.stringify([...permissionsForRole(role)].sort())
  )
    unavailable();
  if (!permissionsForRole(role).includes(permission))
    throw new ApplicationError(
      "access_denied",
      "This account cannot edit this project.",
    );
  await currentAuthentication(tx, principal);
  return {
    organizationId: text(row["organization_id"]),
    draftId: text(row["current_draft_id"]),
    membershipId: text(row["membership_id"]),
  };
}
async function currentAuthentication(
  tx: SqlExecutor,
  principal: PrincipalContext,
) {
  const result = await tx.query(
    sql("SELECT $1::timestamptz > clock_timestamp() AS authenticated", [
      principal.expiresAt,
    ]),
  );
  if (result.rows[0]?.["authenticated"] !== true)
    throw new ApplicationError(
      "authentication_required",
      "Authentication is required.",
    );
}
async function lease(
  tx: SqlExecutor,
  organizationId: string,
  projectId: string,
) {
  const result = await tx.query(
    sql(
      `SELECT lease_id, principal_id, session_id, token_sha256, released_at,
    ${utc("expires_at")} AS expires_at,
    (released_at IS NULL AND expires_at > clock_timestamp() AND authentication_expires_at > clock_timestamp()) AS live
    FROM project_editing_leases WHERE organization_id=$1 AND project_id=$2 FOR UPDATE`,
      [organizationId, projectId],
    ),
  );
  if (result.rows.length > 1) unavailable();
  return result.rows[0];
}
function matches(
  row: SqlRow | undefined,
  principal: PrincipalContext,
  digest: string,
  leaseId?: string,
): row is SqlRow {
  return (
    row?.["principal_id"] === principal.principalId &&
    row["session_id"] === principal.sessionId &&
    row["token_sha256"] === digest &&
    (leaseId === undefined || row["lease_id"] === leaseId)
  );
}
function available(projectId: string): ProjectEditingLeaseState {
  return { contractVersion: 1, projectId, state: "available" };
}
function held(projectId: string, row: SqlRow): ProjectEditingLeaseState {
  return {
    contractVersion: 1,
    projectId,
    state: "held",
    expiresAt: text(row["expires_at"]),
  };
}
function owned(projectId: string, row: SqlRow): ProjectEditingLeaseState {
  return {
    contractVersion: 1,
    projectId,
    state: "owned",
    expiresAt: text(row["expires_at"]),
    leaseId: text(row["lease_id"]),
  };
}

async function abandonPreviousPending(
  tx: SqlExecutor,
  organizationId: string,
  projectId: string,
  prior: SqlRow | undefined,
): Promise<void> {
  const result = await tx.query(
    sql(
      "SELECT pending_document_object_id,pending_editing_lease_id FROM architecture_drafts WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
      [organizationId, projectId],
    ),
  );
  const pending = result.rows.filter(
    (row) => row["pending_document_object_id"] !== null,
  );
  if (pending.length > 1) unavailable();
  if (pending.length === 0) return;
  if (
    prior === undefined ||
    pending[0]?.["pending_editing_lease_id"] !== prior["lease_id"]
  )
    lost();
  const updated = await tx.query(
    sql(
      `UPDATE architecture_drafts SET pending_draft_version=NULL,pending_document_schema_version=NULL,
    pending_document_object_id=NULL,pending_content_sha256=NULL,pending_semantic_sha256=NULL,pending_visual_sha256=NULL,pending_editing_lease_id=NULL
    WHERE organization_id=$1 AND project_id=$2 AND pending_editing_lease_id=$3 AND pending_document_object_id=$4`,
      [
        organizationId,
        projectId,
        text(prior["lease_id"]),
        text(pending[0]?.["pending_document_object_id"]),
      ],
    ),
  );
  if (updated.rowCount !== 1) lost();
  // Keep the published draft and exact staged object metadata/content. No deletion or promotion.
}

/** Mandatory production fence; caller must use the same transaction for the draft commit. */
export async function assertActiveProjectEditingLease(
  tx: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  projectId: string,
  context: DraftWriteLeaseContext | undefined,
): Promise<string> {
  if (context?.proof === undefined) lost();
  const principal = actor(context.principal, projectId);
  if (
    principal.principalId !== scope.principalId ||
    principal.sessionId !== scope.sessionId
  )
    lost();
  const digest = proofDigest(context.proof);
  const authorized = await authority(
    tx,
    principal,
    projectId,
    "projects.mutate",
  );
  if (
    authorized.organizationId !== scope.organizationId ||
    authorized.membershipId !== scope.membershipId
  )
    lost();
  const current = await lease(tx, scope.organizationId, projectId);
  if (
    !matches(current, principal, digest, context.proof.leaseId) ||
    current["live"] !== true
  )
    lost();
  await currentAuthentication(tx, principal);
  return text(current["lease_id"]);
}

/** No existing-draft promotion may use this narrowly scoped creation exception. */
export async function assertInitialDraftPublication(
  tx: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  objectId: string,
  objectVersion: string,
  context: DraftWriteLeaseContext | undefined,
): Promise<void> {
  if (
    context?.principal.principalId !== scope.principalId ||
    context.principal.sessionId !== scope.sessionId
  )
    lost();
  const object = await tx.query(
    sql(
      "SELECT project_id FROM stored_objects WHERE organization_id=$1 AND object_id=$2 AND object_version=$3 AND object_purpose='architecture-draft'",
      [scope.organizationId, objectId, objectVersion],
    ),
  );
  const projectId = text(object.rows[0]?.["project_id"]);
  const principal = actor(context.principal, projectId);
  const authorized = await authority(
    tx,
    principal,
    projectId,
    "projects.mutate",
  );
  if (
    authorized.organizationId !== scope.organizationId ||
    authorized.membershipId !== scope.membershipId
  )
    lost();
  const result = await tx.query(
    sql(
      `SELECT 1 FROM projects p JOIN architecture_drafts d ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id
    JOIN stored_objects o ON o.organization_id=d.organization_id AND o.project_id=d.project_id AND o.object_id=d.document_object_id
    WHERE p.organization_id=$1 AND p.project_id=$2 AND p.created_by_principal_id=$3
      AND d.draft_version=1 AND d.pending_document_object_id IS NULL AND d.pending_editing_lease_id IS NULL
      AND o.object_id=$4 AND o.object_version=$5 AND o.created_by_principal_id=$3 AND o.lifecycle_state='publication-pending'
      AND NOT EXISTS(SELECT 1 FROM project_editing_leases l WHERE l.organization_id=p.organization_id AND l.project_id=p.project_id)
    FOR UPDATE OF d`,
      [
        scope.organizationId,
        projectId,
        scope.principalId,
        objectId,
        objectVersion,
      ],
    ),
  );
  if (result.rows.length !== 1) lost();
  await currentAuthentication(tx, principal);
}

export class PostgresProjectEditingLeases implements ProjectEditingLeasePort {
  readonly #database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async get(
    principalInput: PrincipalContext,
    projectId: string,
  ): Promise<Exclude<ProjectEditingLeaseState, { state: "owned" }>> {
    const principal = actor(principalInput, projectId);
    return this.#database.transaction(async (tx) => {
      const authorized = await authority(
        tx,
        principal,
        projectId,
        "projects.read",
      );
      const current = await lease(tx, authorized.organizationId, projectId);
      await currentAuthentication(tx, principal);
      return current?.["live"] === true
        ? {
            contractVersion: 1,
            projectId,
            state: "held",
            expiresAt: text(current["expires_at"]),
          }
        : { contractVersion: 1, projectId, state: "available" };
    });
  }
  async acquire(
    principalInput: PrincipalContext,
    projectId: string,
    input: Readonly<{ token: string }>,
  ): Promise<ProjectEditingLeaseState> {
    const principal = actor(principalInput, projectId);
    const digest = hashToken(input.token);
    return this.#database.transaction(async (tx) => {
      const authorized = await authority(
        tx,
        principal,
        projectId,
        "projects.mutate",
      );
      const published = await tx.query(
        sql(
          `SELECT 1 FROM architecture_drafts d JOIN stored_objects o ON o.organization_id=d.organization_id AND o.project_id=d.project_id AND o.object_id=d.document_object_id AND o.lifecycle_state='published' WHERE d.organization_id=$1 AND d.project_id=$2 AND d.draft_id=$3`,
          [authorized.organizationId, projectId, authorized.draftId],
        ),
      );
      if (published.rows.length !== 1) lost();
      const current = await lease(tx, authorized.organizationId, projectId);
      await currentAuthentication(tx, principal);
      if (current?.["live"] === true)
        return matches(current, principal, digest)
          ? owned(projectId, current)
          : held(projectId, current);
      await abandonPreviousPending(
        tx,
        authorized.organizationId,
        projectId,
        current,
      );
      await currentAuthentication(tx, principal);
      const result = await tx.query(
        sql(
          `WITH lease_time AS MATERIALIZED(SELECT clock_timestamp() AS at)
        INSERT INTO project_editing_leases(organization_id,project_id,lease_id,principal_id,session_id,token_sha256,acquired_at,updated_at,expires_at,authentication_expires_at)
        SELECT $1,$2,$3,$4,$5,$6,at,at,LEAST(at+INTERVAL '60 seconds',$7::timestamptz),$7::timestamptz FROM lease_time
        ON CONFLICT(organization_id,project_id) DO UPDATE SET lease_id=EXCLUDED.lease_id,principal_id=EXCLUDED.principal_id,session_id=EXCLUDED.session_id,token_sha256=EXCLUDED.token_sha256,acquired_at=EXCLUDED.acquired_at,updated_at=EXCLUDED.updated_at,expires_at=EXCLUDED.expires_at,authentication_expires_at=EXCLUDED.authentication_expires_at,released_at=NULL
        RETURNING lease_id,${utc("expires_at")} AS expires_at`,
          [
            authorized.organizationId,
            projectId,
            `projectlease_${randomUUID()}`,
            principal.principalId,
            principal.sessionId,
            digest,
            principal.expiresAt,
          ],
        ),
      );
      if (result.rows[0] === undefined) unavailable();
      await currentAuthentication(tx, principal);
      return owned(projectId, result.rows[0]);
    });
  }
  async renew(
    principalInput: PrincipalContext,
    projectId: string,
    proof: ProjectEditingLeaseProof,
  ): Promise<ProjectEditingLeaseState> {
    const principal = actor(principalInput, projectId);
    const digest = proofDigest(proof);
    return this.#database.transaction(async (tx) => {
      const authorized = await authority(
        tx,
        principal,
        projectId,
        "projects.mutate",
      );
      const current = await lease(tx, authorized.organizationId, projectId);
      if (
        !matches(current, principal, digest, proof.leaseId) ||
        current["live"] !== true
      )
        lost();
      const result = await tx.query(
        sql(
          `WITH lease_time AS MATERIALIZED(SELECT clock_timestamp() AS at)
        UPDATE project_editing_leases SET updated_at=lease_time.at,expires_at=LEAST(lease_time.at+INTERVAL '60 seconds',$4::timestamptz),authentication_expires_at=$4::timestamptz FROM lease_time
        WHERE organization_id=$1 AND project_id=$2 AND lease_id=$3 AND released_at IS NULL AND expires_at>clock_timestamp() AND $4::timestamptz>clock_timestamp()
        RETURNING lease_id,${utc("expires_at")} AS expires_at`,
          [
            authorized.organizationId,
            projectId,
            proof.leaseId,
            principal.expiresAt,
          ],
        ),
      );
      if (result.rows[0] === undefined) lost();
      await currentAuthentication(tx, principal);
      return owned(projectId, result.rows[0]);
    });
  }
  async release(
    principalInput: PrincipalContext,
    projectId: string,
    proof: ProjectEditingLeaseProof,
  ): Promise<ProjectEditingLeaseState> {
    const principal = actor(principalInput, projectId);
    const digest = proofDigest(proof);
    return this.#database.transaction(async (tx) => {
      const authorized = await authority(
        tx,
        principal,
        projectId,
        "projects.mutate",
      );
      const current = await lease(tx, authorized.organizationId, projectId);
      if (!matches(current, principal, digest, proof.leaseId)) lost();
      await currentAuthentication(tx, principal);
      if (current["released_at"] !== null) return available(projectId);
      if (current["live"] !== true) lost();
      await abandonPreviousPending(
        tx,
        authorized.organizationId,
        projectId,
        current,
      );
      await tx.query(
        sql(
          "UPDATE project_editing_leases SET released_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND lease_id=$3",
          [authorized.organizationId, projectId, proof.leaseId],
        ),
      );
      await currentAuthentication(tx, principal);
      return available(projectId);
    });
  }
}
