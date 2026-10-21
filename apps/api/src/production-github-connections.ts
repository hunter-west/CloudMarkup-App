import { randomUUID } from "node:crypto";

import { GitHubExportError } from "@cloudmarkup/github-repository-export/errors";
import { GitHubRepositoryExportService } from "@cloudmarkup/github-repository-export/service";
import type {
  GitHubAppAdapter,
  GitHubInstallationDescriptor,
} from "@cloudmarkup/github-repository-export";

import type { GitHubInstallationLinkAdapter } from "./adapters/github-installation-link.js";
import {
  PostgresGitHubExportAuditSink,
  PostgresGitHubExportProgressSink,
  PostgresGitHubExportStore,
} from "./adapters/persistence/github-export-store.js";
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
  type OrganizationPermission,
} from "./application/authorization.js";
import { ApplicationError } from "./application/errors.js";
import type { GitHubRepositoryExportApplication } from "./application/github-exports.js";
import { requireRecentAuthentication } from "./application/identity.js";
import type { PrincipalContext } from "./application/ports.js";

type ConnectionPermission = Extract<
  OrganizationPermission,
  "integrations.read" | "integrations.manage"
>;

/** Reauthorizes under row locks in the same transaction as each metadata access. */
class AuthorizedGitHubDatabase implements SqlDatabase {
  readonly database: SqlDatabase;
  readonly principal: PrincipalContext;
  readonly organizationId: string;
  readonly permission: ConnectionPermission;
  readonly clock: () => Date;
  constructor(
    database: SqlDatabase,
    principal: PrincipalContext,
    organizationId: string,
    permission: ConnectionPermission,
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

  async authorize(transaction: SqlExecutor): Promise<void> {
    if (
      !Number.isFinite(Date.parse(this.principal.expiresAt)) ||
      Date.parse(this.principal.expiresAt) <= this.clock().getTime()
    )
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    if (this.permission === "integrations.manage")
      requireRecentAuthentication(this.principal, this.clock());
    const result = await transaction.query(
      sql(
        `SELECT m.role_key FROM memberships m
       JOIN principals u ON u.principal_id = m.principal_id AND u.lifecycle_status = 'active'
       JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'
       JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'
       WHERE m.principal_id = $1 AND m.organization_id = $2 AND m.lifecycle_status = 'active'
       FOR SHARE OF m, u, o, r`,
        [this.principal.principalId, this.organizationId],
      ),
    );
    const role = result.rows[0]?.["role_key"];
    if (
      result.rows.length !== 1 ||
      typeof role !== "string" ||
      !isOrganizationRole(role)
    )
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    if (!permissionsForRole(role).includes(this.permission))
      throw new ApplicationError(
        "access_denied",
        "The requested GitHub connection operation is not permitted.",
      );
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

  assertCurrent(): Promise<void> {
    return this.transaction(() => Promise.resolve());
  }
}

function selected(
  descriptor: GitHubInstallationDescriptor,
  installationId: number,
): void {
  if (
    descriptor.installationId !== installationId ||
    descriptor.repositorySelection !== "selected" ||
    descriptor.suspended
  )
    throw new GitHubExportError("installation-revoked");
}

function guardedApp(
  github: GitHubAppAdapter,
  database: AuthorizedGitHubDatabase,
  store: PostgresGitHubExportStore,
): GitHubAppAdapter {
  async function inspect(installationId: number) {
    await database.assertCurrent();
    const descriptor = await github.inspectInstallation(installationId);
    selected(descriptor, installationId);
    await database.assertCurrent();
    return descriptor;
  }
  async function linked(installationId: number) {
    const record = await store.getInstallationByInstallationId(installationId);
    if (
      record?.organizationId !== database.organizationId ||
      record.status !== "connected" ||
      record.repositorySelection !== "selected"
    )
      throw new GitHubExportError("integration-not-found");
    const descriptor = await inspect(installationId);
    if (
      descriptor.accountId !== record.accountId ||
      descriptor.accountType !== record.accountType
    )
      throw new GitHubExportError("installation-revoked");
  }
  return {
    inspectInstallation: inspect,
    withInstallationSession: async (input, operation) => {
      await linked(input.installationId);
      return github.withInstallationSession(input, async (session) => {
        const result = await operation(session);
        await linked(input.installationId);
        return result;
      });
    },
    withRepositoryReadSession: async (input, operation) => {
      await linked(input.installationId);
      return github.withRepositoryReadSession(input, async (session) => {
        const result = await operation(session);
        await linked(input.installationId);
        return result;
      });
    },
  };
}

function translate(error: unknown): never {
  if (error instanceof ApplicationError) throw error;
  if (error instanceof GitHubExportError) {
    const code =
      error.code === "integration-not-found" ||
      error.code === "installation-revoked" ||
      error.code === "repository-not-found"
        ? "not_found"
        : error.code === "rate-limited"
          ? "rate_limited"
          : error.code === "installation-link-expired" ||
              error.code === "installation-link-replayed"
            ? "conflict"
            : error.transient ||
                error.code === "service-unavailable" ||
                error.code === "secret-unavailable"
              ? "service_unavailable"
              : "invalid_request";
    throw new ApplicationError(code, error.message);
  }
  throw new ApplicationError(
    "service_unavailable",
    "GitHub connections are temporarily unavailable.",
  );
}

/**
 * Real PostgreSQL connection lifecycle and metadata discovery only. There is no
 * artifact/source placeholder or repository-write authority in this composition.
 * Root composition supplies the real App REST adapter and secret-backed callback.
 */
export function createProductionGitHubConnections(options: {
  readonly callback: GitHubInstallationLinkAdapter;
  readonly clock?: () => Date;
  readonly database: SqlDatabase;
  readonly github: GitHubAppAdapter;
  readonly installationSetupUrl: string;
}): GitHubRepositoryExportApplication {
  const clock = options.clock ?? (() => new Date());
  async function run<T>(
    principal: PrincipalContext,
    organizationId: string,
    permission: ConnectionPermission,
    operation: (service: GitHubRepositoryExportService) => Promise<T>,
  ): Promise<T> {
    const database = new AuthorizedGitHubDatabase(
      options.database,
      principal,
      organizationId,
      permission,
      clock,
    );
    try {
      await database.assertCurrent();
      const store = new PostgresGitHubExportStore(database);
      const service = new GitHubRepositoryExportService({
        audit: new PostgresGitHubExportAuditSink(database),
        clock,
        github: guardedApp(options.github, database, store),
        idFactory: (kind) =>
          `${kind === "integration" ? "integration" : kind === "preview" ? "githubpreview" : "githubexport"}_${randomUUID()}`,
        installationLinkCallbackVerifier: options.callback,
        installationSetupUrl: options.installationSetupUrl,
        progress: new PostgresGitHubExportProgressSink(database),
        store,
      });
      const result = await operation(service);
      await database.assertCurrent();
      return result;
    } catch (error) {
      translate(error);
    }
  }
  function unavailable(): ApplicationError {
    return new ApplicationError(
      "service_unavailable",
      "GitHub repository export is unavailable until hosted artifacts and export execution are configured.",
    );
  }
  return {
    createInstallationLinkIntent: (principal, organizationId) =>
      run(principal, organizationId, "integrations.manage", (service) =>
        service.createInstallationLinkIntent({
          correlationId: principal.correlationId,
          organizationId,
          principalId: principal.principalId,
        }),
      ),
    completeInstallationLink: (principal, organizationId, input) =>
      run(principal, organizationId, "integrations.manage", (service) =>
        service.completeInstallationLink({
          ...input,
          correlationId: principal.correlationId,
          organizationId,
          principalId: principal.principalId,
          sessionId: principal.sessionId,
        }),
      ),
    listInstallations: (principal, organizationId) =>
      run(principal, organizationId, "integrations.read", (service) =>
        service.listInstallations({ organizationId }),
      ),
    discoverRepositories: (principal, organizationId, integrationId) =>
      run(principal, organizationId, "integrations.read", (service) =>
        service.discoverRepositories({
          correlationId: principal.correlationId,
          integrationId,
          organizationId,
          principalId: principal.principalId,
        }),
      ),
    discoverBranches: (
      principal,
      organizationId,
      integrationId,
      repositoryId,
    ) =>
      run(principal, organizationId, "integrations.read", (service) =>
        service.discoverBranches({
          integrationId,
          organizationId,
          repositoryId,
        }),
      ),
    createPreview: () => Promise.reject(unavailable()),
    execute: () => Promise.reject(unavailable()),
  };
}
