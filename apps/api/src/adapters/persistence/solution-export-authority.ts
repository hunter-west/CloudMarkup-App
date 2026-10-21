import {
  isOrganizationRole,
  permissionsForRole,
  type OrganizationPermission,
} from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import type { PrincipalContext } from "../../application/ports.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import {
  exportRunEqual,
  exportRunText,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

/** Request-bound project authorization repeated at every SQL boundary. */
export class ProjectRequestAuthority<
  Permission extends OrganizationPermission,
> implements SqlDatabase {
  readonly principal: PrincipalContext;
  readonly database: SqlDatabase;
  readonly ownership: {
    readonly organizationId: string;
    readonly projectId: string;
  };
  readonly permission: Permission;
  readonly clock: () => Date;
  constructor(
    database: SqlDatabase,
    principal: PrincipalContext,
    ownership: { readonly organizationId: string; readonly projectId: string },
    permission: Permission,
    clock: () => Date = () => new Date(),
  ) {
    this.database = database;
    this.permission = permission;
    this.clock = clock;
    this.principal = structuredClone(principal);
    this.ownership = structuredClone(ownership);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  async currentAuthentication(tx: SqlExecutor): Promise<void> {
    const now = this.clock().getTime();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(Date.parse(this.principal.expiresAt)) ||
      Date.parse(this.principal.expiresAt) <= now
    )
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    const result = await tx.query(
      sql("SELECT $1::timestamptz > clock_timestamp() AS authenticated", [
        this.principal.expiresAt,
      ]),
    );
    if (result.rows[0]?.["authenticated"] !== true)
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
  }
  async authorize(tx: SqlExecutor): Promise<AuthorizedOrganizationScope> {
    await this.currentAuthentication(tx);
    if (
      ![
        this.ownership.organizationId,
        this.ownership.projectId,
        this.principal.principalId,
      ].every((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    )
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    const project = await tx.query(
      sql(
        `SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND ${this.permission === "projects.read" ? "lifecycle_status IN ('active','archived')" : "lifecycle_status='active'"} FOR SHARE`,
        [this.ownership.organizationId, this.ownership.projectId],
      ),
    );
    if (project.rows.length !== 1)
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    const found = await tx.query(
      sql(
        `SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json FROM memberships m
      JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
      WHERE m.principal_id=$1 AND m.organization_id=$2 AND m.lifecycle_status='active' FOR SHARE OF m,p,o,r`,
        [this.principal.principalId, this.ownership.organizationId],
      ),
    );
    return this.scopeFromMembership(found.rows);
  }
  protected scopeFromMembership(
    rows: readonly SqlRow[],
  ): AuthorizedOrganizationScope {
    const row = rows[0];
    const role = row?.["role_key"];
    if (
      rows.length !== 1 ||
      typeof role !== "string" ||
      !isOrganizationRole(role)
    )
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    let capabilities: unknown;
    try {
      capabilities = JSON.parse(
        exportRunText(row?.["capabilities_json"]),
      ) as unknown;
    } catch {
      exportRunUnavailable();
    }
    if (
      !Array.isArray(capabilities) ||
      capabilities.some((value: unknown) => typeof value !== "string") ||
      !exportRunEqual(
        capabilities.map((value: unknown) => exportRunText(value)).sort(),
        [...permissionsForRole(role)].sort(),
      )
    )
      exportRunUnavailable();
    if (!permissionsForRole(role).includes(this.permission))
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    return {
      organizationId: this.ownership.organizationId,
      principalId: this.principal.principalId,
      sessionId: this.principal.sessionId,
      correlationId: this.principal.correlationId,
      membershipId: exportRunText(row?.["membership_id"]),
      roleKey: role,
      capabilities: permissionsForRole(role),
    };
  }
  withScope<T>(
    work: (tx: SqlExecutor, scope: AuthorizedOrganizationScope) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (tx) => {
      const scope = await this.authorize(tx);
      const result = await work(tx, scope);
      await this.currentAuthentication(tx);
      return result;
    });
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.withScope(work);
  }
  query<T extends SqlRow = SqlRow>(statement: SqlStatement) {
    return this.transaction((tx) => tx.query<T>(statement));
  }
  scope(): Promise<AuthorizedOrganizationScope> {
    return this.withScope((_tx, scope) => Promise.resolve(scope));
  }
}

/** Current active-project authorization and exact-owner metadata in one query. */
export class ActiveProjectRequestAuthority<
  Permission extends "artifacts.read" | "exports.run" | "projects.mutate",
> extends ProjectRequestAuthority<Permission> {
  /** Scope-only checks contain no dependent work: the single fixed SELECT is
   * already an implicit PostgreSQL transaction. Read/mutation query wrappers
   * still use explicit transactions and the final database expiry check. */
  override async scope(): Promise<AuthorizedOrganizationScope> {
    const scope = await this.authorize(this.database);
    if (Date.parse(this.principal.expiresAt) <= this.clock().getTime())
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    return scope;
  }
  /** Fixed authorization query; the surrounding transaction, project-first share
   * locks and final database-time expiry check in withScope remain unchanged. */
  override async authorize(
    tx: SqlExecutor,
  ): Promise<AuthorizedOrganizationScope> {
    return (await this.lookup(tx)).scope;
  }
  /** Exact-owner object metadata and its current authorization are read together
   * in one fixed SELECT, with no dynamic/caller SQL or cached access decision. */
  async objectMetadata(objectId: string): Promise<{
    scope: AuthorizedOrganizationScope;
    row: SqlRow | null;
  }> {
    return this.lookup(this.database, objectId);
  }
  private async lookup(
    tx: SqlExecutor,
    objectId?: string,
  ): Promise<{
    scope: AuthorizedOrganizationScope;
    row: SqlRow | null;
  }> {
    const now = this.clock().getTime();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(Date.parse(this.principal.expiresAt)) ||
      Date.parse(this.principal.expiresAt) <= now
    )
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    if (
      ![
        this.ownership.organizationId,
        this.ownership.projectId,
        this.principal.principalId,
      ].every((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    )
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    const found = await tx.query(
      sql(
        `
      WITH authorized_project AS MATERIALIZED (
        SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2
          AND lifecycle_status='active' FOR SHARE
      ), authorized_membership AS MATERIALIZED (
        SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json
        FROM authorized_project project
        JOIN memberships m ON m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
        JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
        JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
        JOIN organization_roles r ON r.organization_id=m.organization_id
          AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
        FOR SHARE OF m,p,o,r
      )
      SELECT $4::timestamptz > clock_timestamp() AS authenticated,
        m.membership_id,m.role_key,m.capabilities_json${objectId === undefined ? "" : ", CASE WHEN s.object_id IS NULL THEN NULL ELSE row_to_json(s)::text END AS object_json"}
      FROM (SELECT 1) anchor LEFT JOIN authorized_membership m ON TRUE
      ${objectId === undefined ? "" : "LEFT JOIN stored_objects s ON m.membership_id IS NOT NULL AND s.organization_id=$1 AND s.project_id=$2 AND s.object_id=$5"}`,
        [
          this.ownership.organizationId,
          this.ownership.projectId,
          this.principal.principalId,
          this.principal.expiresAt,
          ...(objectId === undefined ? [] : [objectId]),
        ],
      ),
    );
    if (found.rows[0]?.["authenticated"] !== true)
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    const scope = this.scopeFromMembership(found.rows);
    if (Date.parse(this.principal.expiresAt) <= this.clock().getTime())
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    let object: unknown = null;
    try {
      const json = found.rows[0]["object_json"];
      if (objectId !== undefined && json != null)
        object = JSON.parse(exportRunText(json)) as unknown;
    } catch {
      return exportRunUnavailable();
    }
    if (
      object !== null &&
      (typeof object !== "object" || Array.isArray(object))
    )
      return exportRunUnavailable();
    return { scope, row: object as SqlRow | null };
  }
}

/** Export callers retain their narrower permission contract. */
export class SolutionExportRequestAuthority extends ActiveProjectRequestAuthority<
  "artifacts.read" | "exports.run"
> {}
