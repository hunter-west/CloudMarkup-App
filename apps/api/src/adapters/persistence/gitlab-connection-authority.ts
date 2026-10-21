import { z } from "zod";
import { ApplicationError } from "../../application/errors.js";
import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import { requireRecentAuthentication } from "../../application/identity.js";
import type { PrincipalContext } from "../../application/ports.js";
import {
  accountSessionAllowed,
  lockAccountSessions,
} from "./account-sessions.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const context = z
  .object({
    principalId: identifier,
    sessionId: z.string().min(1).max(256),
    authenticatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    authenticationSource: z.literal("cognito"),
    correlationId: z.string().min(1).max(128),
  })
  .strict();
type Permission = "integrations.read" | "integrations.manage" | "exports.run";
function authenticationRequired(): never {
  throw new ApplicationError(
    "authentication_required",
    "Sign in again to continue.",
  );
}

/** A request-scoped snapshot of verified identity; caller-selected workspace IDs confer no authority. */
export class GitLabConnectionAuthority {
  readonly principal: PrincipalContext;
  readonly organizationId: string;
  readonly #database: SqlDatabase;
  readonly #clock: () => Date;
  constructor(
    database: SqlDatabase,
    principal: PrincipalContext,
    organizationId: string,
    clock: () => Date = () => new Date(),
  ) {
    const actor = context.safeParse(principal);
    if (!actor.success) authenticationRequired();
    if (!identifier.safeParse(organizationId).success)
      throw new ApplicationError(
        "invalid_request",
        "The workspace request is invalid.",
      );
    this.principal = Object.freeze(actor.data);
    this.organizationId = organizationId;
    this.#database = database;
    this.#clock = clock;
  }
  async #authorize(tx: SqlExecutor, permission: Permission): Promise<void> {
    const now = this.#clock();
    if (Date.parse(this.principal.expiresAt) <= now.getTime())
      authenticationRequired();
    if (permission === "integrations.manage")
      requireRecentAuthentication(this.principal, now);
    if (!(await accountSessionAllowed(tx, this.principal)))
      authenticationRequired();
    const result = await tx.query(
      sql(
        `SELECT m.role_key FROM memberships m
       JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
       JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
       JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
       WHERE m.principal_id=$1 AND m.organization_id=$2 AND m.lifecycle_status='active'
       AND (o.workspace_kind='organization' OR o.personal_owner_principal_id=$1)
       FOR SHARE OF m,p,o,r`,
        [this.principal.principalId, this.organizationId],
      ),
    );
    const role = result.rows[0]?.["role_key"];
    if (
      result.rows.length !== 1 ||
      typeof role !== "string" ||
      !isOrganizationRole(role)
    )
      throw new ApplicationError("not_found", "The workspace is unavailable.");
    if (!permissionsForRole(role).includes(permission))
      throw new ApplicationError(
        "access_denied",
        "This GitLab connection action is not permitted.",
      );
  }
  async transaction<T>(
    permission: Permission,
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#database.transaction(async (tx) => {
        await lockAccountSessions(tx, this.principal.principalId);
        await this.#authorize(tx, permission);
        const result = await work(tx);
        // Locks serialize revocation and membership changes; expiry can still elapse while SQL runs.
        await this.#authorize(tx, permission);
        return result;
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "GitLab connections are temporarily unavailable.",
      );
    }
  }
  assertCurrent(permission: Permission = "integrations.read"): Promise<void> {
    return this.transaction(permission, () => Promise.resolve());
  }
}
