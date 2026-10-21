import {
  gitlabProjectDiscoveryV1Schema,
  updateGitlabProjectSelectionV1Schema,
  type GitlabProjectV1,
} from "@cloudmarkup/api-contract";
import {
  GitLabRepositoryAdapter,
  type GitLabProject,
} from "./adapters/gitlab-repository.js";
import { GitLabConnectionAuthority } from "./adapters/persistence/gitlab-connection-authority.js";
import { PostgresGitLabProjectSelections } from "./adapters/persistence/gitlab-project-selections.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import type { GitLabProjectsApplication } from "./application/gitlab-projects.js";
import type { PrincipalContext } from "./application/ports.js";
import { ApplicationError } from "./application/errors.js";
import type { createProductionGitLabConnections } from "./production-gitlab-connections.js";

function projection(project: GitLabProject): GitlabProjectV1 {
  return {
    projectId: project.projectId,
    pathWithNamespace: project.pathWithNamespace,
    defaultBranch: project.defaultBranch,
    url: project.url,
    eligibility: project.archived
      ? "archived"
      : project.empty || project.defaultBranch === null
        ? "empty"
        : project.accessLevel < 30
          ? "insufficient-access"
          : "eligible",
  };
}
export function createProductionGitLabProjects(options: {
  readonly database: SqlDatabase;
  readonly applicationId: string;
  readonly connections: ReturnType<typeof createProductionGitLabConnections>;
  readonly clock?: () => Date;
  readonly fetch?: typeof globalThis.fetch;
}): GitLabProjectsApplication {
  options = Object.freeze({ ...options });
  function scoped(principal: PrincipalContext, organizationId: string) {
    const authority = new GitLabConnectionAuthority(
      options.database,
      principal,
      organizationId,
      options.clock,
    );
    return {
      authority,
      store: new PostgresGitLabProjectSelections(
        authority,
        options.applicationId,
      ),
    };
  }
  function repository(input: {
    readonly accessToken: Uint8Array;
    readonly assertCurrentAdmission: () => Promise<void>;
  }) {
    return new GitLabRepositoryAdapter({
      // Each adapter operation clears its owned copy; the surrounding token scope clears the original.
      readAccessToken: () =>
        Promise.resolve(Uint8Array.from(input.accessToken)),
      assertCurrentAdmission: input.assertCurrentAdmission,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }
  return {
    discover: (principal, organizationId, connectionId, page) =>
      options.connections.withAccess(
        principal,
        organizationId,
        connectionId,
        async (input) => {
          const result = await repository(input).listProjects(page);
          return gitlabProjectDiscoveryV1Schema.parse({
            contractVersion: 1,
            organizationId,
            principalId: principal.principalId,
            connectionId,
            projects: result.projects.map(projection),
            nextPage: result.nextPage,
          });
        },
      ),
    selections: (principal, organizationId, connectionId, limit, cursor) =>
      scoped(principal, organizationId).store.list(connectionId, limit, cursor),
    update: (principal, organizationId, connectionId, projectId, input) => {
      const parsed = updateGitlabProjectSelectionV1Schema.safeParse(input);
      if (!parsed.success)
        throw new ApplicationError(
          "invalid_request",
          "The GitLab project selection is invalid.",
        );
      const snapshot = parsed.data;
      const { authority, store } = scoped(principal, organizationId);
      if (!snapshot.enabled)
        return store.update(connectionId, projectId, snapshot);
      return options.connections.withAccess(
        principal,
        organizationId,
        connectionId,
        async (input) => {
          await authority.assertCurrent("integrations.manage");
          const project = await repository(input).readProject(projectId);
          if (projection(project).eligibility !== "eligible")
            throw new ApplicationError(
              "access_denied",
              "Choose a non-archived GitLab project with a default branch and Developer access or higher.",
            );
          return store.update(
            connectionId,
            projectId,
            snapshot,
            input.grantVersion,
          );
        },
      );
    },
  };
}
