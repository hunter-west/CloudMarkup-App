import { randomUUID } from "node:crypto";
import { GitLabRepositoryAdapter } from "./adapters/gitlab-repository.js";
import { GitLabConnectionAuthority } from "./adapters/persistence/gitlab-connection-authority.js";
import { PostgresGitLabProjectSelections } from "./adapters/persistence/gitlab-project-selections.js";
import { PostgresGitLabExportReviews } from "./adapters/persistence/gitlab-export-reviews.js";
import { PostgresApprovedSolutionPackageRepository } from "./adapters/persistence/solution-export-approved-package-repository.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import type { ObjectStore } from "./application/persistence.js";
import type { PrincipalContext } from "./application/ports.js";
import type { RepositoryExportEntitlementPolicy } from "./application/repository-export-entitlements.js";
import { GitLabReviewedExportWorkflow } from "./application/gitlab-exports.js";
import { ApplicationError } from "./application/errors.js";
import type { createProductionGitLabConnections } from "./production-gitlab-connections.js";

export interface ProductionGitLabExportOptions {
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly applicationId: string;
  readonly connections: Pick<
    ReturnType<typeof createProductionGitLabConnections>,
    "withAccess"
  >;
  readonly entitlements: RepositoryExportEntitlementPolicy;
  readonly organizationForProject: (
    principal: PrincipalContext,
    projectId: string,
  ) => Promise<string | null>;
  readonly clock?: () => Date;
  readonly fetch?: typeof globalThis.fetch;
}
/** Composition only. Calling this factory does not enable routes, grant export capability or resolve a credential. */
export function createProductionGitLabExportWorkflow(
  options: ProductionGitLabExportOptions,
) {
  options = Object.freeze({ ...options });
  return async (
    principalInput: PrincipalContext,
    projectId: string,
  ): Promise<GitLabReviewedExportWorkflow> => {
    const signal = AbortSignal.timeout(20_000);
    const assertDeadline = () => {
      if (signal.aborted)
        throw new ApplicationError(
          "service_unavailable",
          "The GitLab export step timed out. Reload its status before continuing.",
        );
    };

    const principal = Object.freeze(structuredClone(principalInput));
    const organizationId = await options.organizationForProject(
      principal,
      projectId,
    );
    if (organizationId === null)
      throw new ApplicationError("not_found", "Project not found.");
    const scope = { organizationId, projectId };
    const authority = new GitLabConnectionAuthority(
      options.database,
      principal,
      organizationId,
      options.clock,
    );
    await authority.assertCurrent("integrations.read");
    const selections = new PostgresGitLabProjectSelections(
      authority,
      options.applicationId,
    );
    const artifacts = new PostgresApprovedSolutionPackageRepository({
      database: options.database,
      objectStore: options.objectStore,
      principal,
      ...(options.clock ? { clock: options.clock } : {}),
    });
    return new GitLabReviewedExportWorkflow({
      scope: {
        ...scope,
        principalId: principal.principalId,
        applicationId: options.applicationId,
      },
      store: new PostgresGitLabExportReviews(
        authority,
        options.applicationId,
        projectId,
      ),
      newReviewId: () => "gitlabreview_" + randomUUID().replaceAll("-", ""),
      assertAuthorized: async (destination) => {
        assertDeadline();
        await authority.assertCurrent("exports.run");
        await artifacts.withAuthorizedProject(scope, () => Promise.resolve());
        await options.entitlements.authorize({ ...scope, principal });
        await selections.assertSelected(
          destination.connectionId,
          destination.providerProjectId,
          destination.selectionVersion,
        );
      },
      readArtifact: async (artifactId) => {
        assertDeadline();
        await authority.assertCurrent("exports.run");
        const value = await artifacts.getApprovedPackage({
          ...scope,
          artifactId,
        });
        if (
          value?.organizationId !== organizationId ||
          value.projectId !== projectId ||
          value.artifactId !== artifactId
        )
          throw new ApplicationError(
            "not_found",
            "The approved export artifact is unavailable.",
          );
        await authority.assertCurrent("exports.run");
        return value.artifact;
      },
      assertArtifactAvailable: (artifactId, zipDigest) =>
        artifacts.assertAvailable({ ...scope, artifactId }, zipDigest),
      withRepository: (connectionId, admission, work) => {
        return options.connections.withAccess(
          principal,
          organizationId,
          connectionId,
          async (access) => {
            const assertCurrentAdmission = async () => {
              assertDeadline();
              await access.assertCurrentAdmission();
              await admission();
              assertDeadline();
            };
            await assertCurrentAdmission();
            const repository = new GitLabRepositoryAdapter({
              readAccessToken: () =>
                Promise.resolve(Uint8Array.from(access.accessToken)),
              assertCurrentAdmission,
              signal,
              ...(options.fetch ? { fetch: options.fetch } : {}),
            });
            return work(repository);
          },
        );
      },
    });
  };
}
