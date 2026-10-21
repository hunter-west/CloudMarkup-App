import { randomUUID } from "node:crypto";

import { GitHubExportError } from "@cloudmarkup/github-repository-export/errors";
import type { GitHubAppAdapter } from "@cloudmarkup/github-repository-export/ports";
import { GitHubRepositoryExportService } from "@cloudmarkup/github-repository-export/service";

import {
  PostgresGitHubExportAuditSink,
  PostgresGitHubExportProgressSink,
  PostgresGitHubExportStore,
} from "./adapters/persistence/github-export-store.js";
import { PostgresApprovedSolutionPackageRepository } from "./adapters/persistence/solution-export-approved-package-repository.js";
import type {
  SqlDatabase,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./adapters/persistence/sql.js";
import { ApplicationError } from "./application/errors.js";
import {
  GitHubRepositoryExportApplicationService,
  type GitHubExportEntitlementPolicy,
  type GitHubRepositoryExportApplication,
} from "./application/github-exports.js";
import type { ObjectStore } from "./application/persistence.js";
import type { PrincipalContext } from "./application/ports.js";

export interface ProductionGitHubExportOptions {
  readonly clock?: () => Date;
  /** Must bind this callback to the real adapter's final HTTP request hook. */
  readonly createGitHub: (
    authorizeBeforeRequest: () => Promise<void>,
  ) => GitHubAppAdapter;
  readonly database: SqlDatabase;
  readonly entitlements: GitHubExportEntitlementPolicy;
  readonly objectStore: ObjectStore;
  readonly organizationForProject: (
    principal: PrincipalContext,
    projectId: string,
  ) => Promise<string>;
}

/** Retained artifacts → reviewed create-only branch/PR. No generation or activation fallback. */
export function createProductionGitHubExports(
  options: ProductionGitHubExportOptions,
): Pick<GitHubRepositoryExportApplication, "createPreview" | "execute"> {
  const clock = options.clock ?? (() => new Date());
  async function run<T>(
    principalInput: PrincipalContext,
    projectId: string,
    operation: (
      application: GitHubRepositoryExportApplicationService,
      principal: PrincipalContext,
    ) => Promise<T>,
  ): Promise<T> {
    const principal = structuredClone(principalInput);
    const organizationId = await options.organizationForProject(
      principal,
      projectId,
    );
    const scope = { organizationId, projectId };
    const artifacts = new PostgresApprovedSolutionPackageRepository({
      database: options.database,
      objectStore: options.objectStore,
      principal,
      clock,
    });
    const database: SqlDatabase = {
      close: () => Promise.resolve(),
      transaction: (work) => artifacts.withAuthorizedProject(scope, work),
      query: <TRow extends SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<TRow>> =>
        artifacts.withAuthorizedProject(scope, (tx) =>
          tx.query<TRow>(statement),
        ),
    };
    const store = new PostgresGitHubExportStore(database);
    let activeArtifact:
      { readonly artifactId: string; readonly digest: string } | undefined;
    let activeInstallationId: number | undefined;
    const authorizeCurrent = async () => {
      await artifacts.withAuthorizedProject(scope, () => Promise.resolve());
      await options.entitlements.authorize({ ...scope, principal });
      if (activeArtifact !== undefined)
        await artifacts.assertAvailable(
          { ...scope, artifactId: activeArtifact.artifactId },
          activeArtifact.digest,
        );
      if (activeInstallationId !== undefined) {
        const installation =
          await store.getInstallationByInstallationId(activeInstallationId);
        if (
          installation?.organizationId !== organizationId ||
          installation.status !== "connected" ||
          installation.repositorySelection !== "selected"
        )
          throw new GitHubExportError("installation-revoked");
      }
      // Entitlement reads and metadata I/O can themselves race expiry/revocation.
      await artifacts.withAuthorizedProject(scope, () => Promise.resolve());
    };
    const github = options.createGitHub(authorizeCurrent);
    const inspect = async (installationId: number) => {
      if (
        activeInstallationId !== undefined &&
        activeInstallationId !== installationId
      )
        throw new GitHubExportError("integration-not-found");
      activeInstallationId = installationId;
      await authorizeCurrent();
      const descriptor = await github.inspectInstallation(installationId);
      const installation =
        await store.getInstallationByInstallationId(installationId);
      if (
        descriptor.installationId !== installationId ||
        descriptor.repositorySelection !== "selected" ||
        descriptor.suspended ||
        descriptor.accountId !== installation?.accountId ||
        descriptor.accountType !== installation.accountType
      )
        throw new GitHubExportError("installation-revoked");
      await authorizeCurrent();
      return descriptor;
    };
    const guarded: GitHubAppAdapter = {
      inspectInstallation: inspect,
      withInstallationSession: async (input, work) => {
        await inspect(input.installationId);
        return github.withInstallationSession(input, async (session) => {
          const result = await work(session);
          await authorizeCurrent();
          return result;
        });
      },
      withRepositoryReadSession: async (input, work) => {
        await inspect(input.installationId);
        return github.withRepositoryReadSession(input, async (session) => {
          const result = await work(session);
          await authorizeCurrent();
          return result;
        });
      },
    };
    const service = new GitHubRepositoryExportService({
      artifactRepository: {
        getApprovedPackage: async (input) => {
          if (
            input.organizationId !== organizationId ||
            input.projectId !== projectId
          )
            throw new ApplicationError(
              "not_found",
              "The requested resource is unavailable.",
            );
          const record = await artifacts.getApprovedPackage(input);
          if (record !== null)
            activeArtifact = {
              artifactId: record.artifactId,
              digest: record.artifact.zipDigest,
            };
          return record;
        },
      },
      audit: new PostgresGitHubExportAuditSink(database),
      clock,
      github: guarded,
      idFactory: (kind) =>
        `${kind === "preview" ? "githubpreview" : kind === "execution" ? "githubexport" : "integration"}_${randomUUID()}`,
      progress: new PostgresGitHubExportProgressSink(database),
      store,
    });
    const application = new GitHubRepositoryExportApplicationService({
      service,
      entitlements: options.entitlements,
      access: {
        authorizeProject: async (
          _principal,
          requestedProjectId,
          permission,
        ) => {
          if (requestedProjectId !== projectId || permission !== "exports.run")
            throw new ApplicationError(
              "not_found",
              "The requested resource is unavailable.",
            );
          await artifacts.withAuthorizedProject(scope, () => Promise.resolve());
          return { organizationId };
        },
        authorizeOrganization: () =>
          Promise.reject(
            new ApplicationError(
              "service_unavailable",
              "Use the separately configured GitHub connection service.",
            ),
          ),
      },
    });
    const result = await operation(application, principal);
    await authorizeCurrent();
    return result;
  }
  return {
    createPreview: (principal, projectId, input) =>
      run(principal, projectId, (application, actor) =>
        application.createPreview(actor, projectId, input),
      ),
    execute: (principal, projectId, input, key) =>
      run(principal, projectId, (application, actor) =>
        application.execute(actor, projectId, input, key),
      ),
  };
}
