import type {
  AuthorizationStore,
  ChildObjectAuthorizationRecord,
  JobObjectKind,
  MembershipAuthorizationRecord,
  MembershipLifecycleState,
  OrganizationObjectAuthorizationRecord,
  PrincipalLifecycleState,
  ProjectAuthorizationRecord,
} from "../../application/object-authorization.js";
import type { SqlDatabase, SqlRow } from "../persistence/sql.js";
import { sql } from "../persistence/sql.js";

type Row = SqlRow & {
  readonly membership_id?: unknown;
  readonly object_id?: unknown;
  readonly organization_id?: unknown;
  readonly project_id?: unknown;
  readonly role_key?: unknown;
  readonly status?: unknown;
};

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function projectRecord(
  row: Row | undefined,
): ProjectAuthorizationRecord | null {
  const projectId = string(row?.project_id);
  const organizationId = string(row?.organization_id);
  return projectId === null || organizationId === null
    ? null
    : { organizationId, projectId };
}

function childRecord(
  row: Row | undefined,
): ChildObjectAuthorizationRecord | null {
  const base = projectRecord(row);
  const objectId = string(row?.object_id);
  return base === null || objectId === null ? null : { ...base, objectId };
}

function organizationRecord(
  row: Row | undefined,
): OrganizationObjectAuthorizationRecord | null {
  const objectId = string(row?.object_id);
  const organizationId = string(row?.organization_id);
  return objectId === null || organizationId === null
    ? null
    : { objectId, organizationId };
}

const jobTable: Readonly<
  Record<JobObjectKind, { readonly id: string; readonly table: string }>
> = {
  export: { id: "export_job_id", table: "export_jobs" },
  generation: { id: "generation_job_id", table: "generation_jobs" },
  validation: { id: "validation_run_id", table: "validation_runs" },
};

export class PostgresAuthorizationStore implements AuthorizationStore {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async getPrincipalState(
    principalId: string,
  ): Promise<PrincipalLifecycleState | null> {
    const result = await this.#database.query<Row>(
      sql(
        `SELECT lifecycle_status AS status
           FROM principals
          WHERE principal_id = $1
          LIMIT 1`,
        [principalId],
      ),
    );
    const status = string(result.rows[0]?.status);
    return status === "active" || status === "suspended" ? status : null;
  }

  async getMembership(
    principalId: string,
    organizationId: string,
  ): Promise<MembershipAuthorizationRecord | null> {
    const result = await this.#database.query<Row>(
      sql(
        `SELECT membership_id, role_key, lifecycle_status AS status
           FROM memberships
          WHERE principal_id = $1
            AND organization_id = $2
          LIMIT 1`,
        [principalId, organizationId],
      ),
    );
    const row = result.rows[0];
    const membershipId = string(row?.membership_id);
    const role = string(row?.role_key);
    const status = string(row?.status) as MembershipLifecycleState | null;
    return membershipId === null || role === null || status === null
      ? null
      : { membershipId, role, status };
  }

  async getProject(
    projectId: string,
  ): Promise<ProjectAuthorizationRecord | null> {
    const result = await this.#database.query<Row>(
      sql(
        `SELECT organization_id, project_id
           FROM projects
          WHERE project_id = $1
          LIMIT 1`,
        [projectId],
      ),
    );
    return projectRecord(result.rows[0]);
  }

  getRevision(
    revisionId: string,
  ): Promise<ChildObjectAuthorizationRecord | null> {
    return this.#getChild("architecture_revisions", "revision_id", revisionId);
  }

  getArtifact(
    artifactId: string,
  ): Promise<ChildObjectAuthorizationRecord | null> {
    return this.#getChild("artifacts", "artifact_id", artifactId);
  }

  async getJob(
    kind: JobObjectKind,
    jobId: string,
  ): Promise<ChildObjectAuthorizationRecord | null> {
    const descriptor = jobTable[kind];
    return this.#getChild(descriptor.table, descriptor.id, jobId);
  }

  getIntegration(
    integrationId: string,
  ): Promise<OrganizationObjectAuthorizationRecord | null> {
    return this.#getOrganizationObject(
      "project_integrations",
      "integration_id",
      integrationId,
    );
  }

  getAuditEvent(
    auditEventId: string,
  ): Promise<OrganizationObjectAuthorizationRecord | null> {
    return this.#getOrganizationObject(
      "audit_events",
      "audit_event_id",
      auditEventId,
    );
  }

  async #getChild(
    table: string,
    idColumn: string,
    objectId: string,
  ): Promise<ChildObjectAuthorizationRecord | null> {
    const result = await this.#database.query<Row>(
      sql(
        `SELECT organization_id, project_id, ${idColumn} AS object_id
           FROM ${table}
          WHERE ${idColumn} = $1
          LIMIT 1`,
        [objectId],
      ),
    );
    return childRecord(result.rows[0]);
  }

  async #getOrganizationObject(
    table: string,
    idColumn: string,
    objectId: string,
  ): Promise<OrganizationObjectAuthorizationRecord | null> {
    const result = await this.#database.query<Row>(
      sql(
        `SELECT organization_id, ${idColumn} AS object_id
           FROM ${table}
          WHERE ${idColumn} = $1
          LIMIT 1`,
        [objectId],
      ),
    );
    return organizationRecord(result.rows[0]);
  }
}
