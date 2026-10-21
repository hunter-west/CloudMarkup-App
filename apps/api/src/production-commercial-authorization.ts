import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./adapters/persistence/sql.js";
import {
  isOrganizationRole,
  permissionsForRole,
  type AuthorizedOrganizationContext,
} from "./application/authorization.js";
import { ApplicationError } from "./application/errors.js";
import { requireRecentAuthentication } from "./application/identity.js";
import type { PrincipalContext } from "./application/ports.js";

export type CommercialRequestPermission =
  "commercial.summary.read" | "billing.manage";

/** Each SQL boundary rechecks the actor under short locks; no provider await runs inside them. */
export class AuthorizedCommercialRequestDatabase implements SqlDatabase {
  readonly database: SqlDatabase;
  readonly principal: PrincipalContext;
  readonly organizationId: string;
  readonly permission: CommercialRequestPermission;
  readonly clock: () => Date;
  constructor(
    database: SqlDatabase,
    principal: PrincipalContext,
    organizationId: string,
    permission: CommercialRequestPermission,
    clock: () => Date,
  ) {
    this.database = database;
    this.principal = principal;
    this.organizationId = organizationId;
    this.permission = permission;
    this.clock = clock;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  async authorize(
    transaction: SqlExecutor,
  ): Promise<AuthorizedOrganizationContext> {
    const now = this.clock();
    if (
      !Number.isFinite(Date.parse(this.principal.expiresAt)) ||
      Date.parse(this.principal.expiresAt) <= now.getTime()
    )
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    const result = await transaction.query(
      sql(
        `SELECT m.membership_id, m.role_key, to_json(r.capabilities)::text AS capabilities_json FROM memberships m
       JOIN principals p ON p.principal_id = m.principal_id AND p.lifecycle_status = 'active'
       JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'
       JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'
       WHERE m.principal_id = $1 AND m.organization_id = $2 AND m.lifecycle_status = 'active'
       FOR SHARE OF m, p, o, r`,
        [this.principal.principalId, this.organizationId],
      ),
    );
    const row = result.rows[0];
    const role = row?.["role_key"];
    const membershipId = row?.["membership_id"];
    if (
      result.rows.length !== 1 ||
      typeof role !== "string" ||
      !isOrganizationRole(role) ||
      typeof membershipId !== "string"
    )
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    const serializedCapabilities = row?.["capabilities_json"];
    const capabilities: unknown =
      typeof serializedCapabilities === "string"
        ? JSON.parse(serializedCapabilities)
        : null;
    const stringCapabilities = Array.isArray(capabilities)
      ? capabilities.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];
    if (
      !Array.isArray(capabilities) ||
      capabilities.length !== stringCapabilities.length ||
      JSON.stringify([...stringCapabilities].sort()) !==
        JSON.stringify([...permissionsForRole(role)].sort())
    )
      throw new ApplicationError(
        "service_unavailable",
        "The authorization policy is unavailable.",
      );
    if (!permissionsForRole(role).includes(this.permission))
      throw new ApplicationError(
        "access_denied",
        "You cannot manage billing for this organization.",
      );
    if (this.permission === "billing.manage")
      requireRecentAuthentication(this.principal, now);
    return {
      correlationId: this.principal.correlationId,
      membershipId,
      organizationId: this.organizationId,
      principal: this.principal,
      role,
    };
  }

  transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await this.authorize(transaction);
      return work(transaction);
    });
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    return this.transaction((transaction) =>
      transaction.query<TRow>(statement),
    );
  }

  context(): Promise<AuthorizedOrganizationContext> {
    return this.database.transaction((transaction) =>
      this.authorize(transaction),
    );
  }
}
