import { randomUUID } from "node:crypto";
import {
  applyDraftCommandV1Schema,
  discoverGithubRepositoryV1Schema,
  reviewGithubRepositoryImportV1Schema,
  type ReviewGithubRepositoryImportV1,
} from "@cloudmarkup/api-contract";
import { awsCatalogV1, AWS_CATALOG_DIGEST_V1 } from "@cloudmarkup/provider-aws";
import { GitHubExportError } from "@cloudmarkup/github-repository-export/errors";
import type { GitHubAppAdapter } from "@cloudmarkup/github-repository-export/ports";
import {
  createGitHubRepositoryImportService,
  type GitHubRepositoryImportContextPort,
} from "@cloudmarkup/github-repository-export/repository-import";
import { createMaterializedRepositoryImportRunner } from "@cloudmarkup/github-repository-export/repository-import-runner";
import {
  createRepositoryImportService,
  type TerraformHCLInspectorPort,
} from "@cloudmarkup/repository-importer";
import { ApplicationError } from "./application/errors.js";
import {
  GitHubRepositoryImportApplicationService,
  type GitHubRepositoryImportApplication,
} from "./application/github-imports.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
} from "./application/ports.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { ProjectRequestAuthority } from "./adapters/persistence/solution-export-authority.js";
import {
  PostgresGitHubExportAuditSink,
  PostgresGitHubExportStore,
} from "./adapters/persistence/github-export-store.js";
import {
  PostgresGitHubRepositoryImportProgressSink,
  PostgresGitHubRepositoryImportStore,
} from "./adapters/persistence/github-import-store.js";

export function createProductionGitHubImports(options: {
  readonly database: SqlDatabase;
  readonly application: Pick<
    CloudMarkupApplication,
    "listSolutionRevisions" | "getSolutionRevision" | "applyDraftCommand"
  >;
  readonly organizationForProject: (
    principal: PrincipalContext,
    projectId: string,
  ) => Promise<string | null>;
  readonly createGitHub: (
    authorizeBeforeRequest: () => Promise<void>,
  ) => GitHubAppAdapter;
  readonly hclInspector: TerraformHCLInspectorPort;
  readonly clock?: () => Date;
}): GitHubRepositoryImportApplication {
  const clock = options.clock ?? (() => new Date());
  const importer = createMaterializedRepositoryImportRunner(
    createRepositoryImportService({
      hclInspector: options.hclInspector,
    }),
  );
  async function run<T>(
    supplied: PrincipalContext,
    projectId: string,
    permission: "projects.read" | "projects.mutate",
    work: (
      application: GitHubRepositoryImportApplication,
      principal: PrincipalContext,
    ) => Promise<T>,
    prepareImport = false,
    draftAcceptance?: ReviewGithubRepositoryImportV1["draftAcceptance"],
  ): Promise<T> {
    const acceptance =
      draftAcceptance === undefined
        ? undefined
        : structuredClone(draftAcceptance);
    const principal = Object.freeze(structuredClone(supplied));
    const organizationId = await options.organizationForProject(
      principal,
      projectId,
    );
    if (organizationId === null)
      throw new ApplicationError("not_found", "Project not found.");
    const database = new ProjectRequestAuthority(
      options.database,
      principal,
      { organizationId, projectId },
      permission,
      clock,
    );
    await database.scope();
    const directory = new PostgresGitHubExportStore(database);
    let installationId: number | undefined;
    async function authorizeCurrent() {
      const scope = await database.scope();
      if (installationId !== undefined) {
        if (!scope.capabilities.includes("integrations.read"))
          throw new ApplicationError(
            "access_denied",
            "Repository access is unavailable.",
          );
        const installation =
          await directory.getInstallationByInstallationId(installationId);
        if (
          installation?.organizationId !== organizationId ||
          installation.status !== "connected" ||
          installation.repositorySelection !== "selected" ||
          installation.permissions.contents === "none" ||
          installation.permissions.metadata === "none"
        )
          throw new GitHubExportError("installation-revoked");
      }
      await database.scope();
    }
    const github = options.createGitHub(authorizeCurrent);
    let capturedContext:
      | Awaited<ReturnType<GitHubRepositoryImportContextPort["load"]>>
      | undefined;
    const context: GitHubRepositoryImportContextPort = {
      async load(scope) {
        if (
          scope.organizationId !== organizationId ||
          scope.projectId !== projectId
        )
          throw new ApplicationError("not_found", "Project not found.");
        await database.scope();
        if (capturedContext !== undefined) return capturedContext;
        const revisions = await options.application.listSolutionRevisions(
          principal,
          projectId,
          {
            filters: {},
            limit: 1,
          },
        );
        const latest = revisions.items[0];
        if (latest === undefined)
          throw new ApplicationError(
            "conflict",
            "Create a solution revision in the editor before importing repository code.",
          );
        const revision = await options.application.getSolutionRevision(
          principal,
          projectId,
          latest.solutionRevisionId,
        );
        const document = revision.revision.architectureDocument;
        if (
          revision.summary.projectId !== projectId ||
          revision.summary.solutionRevisionId !== latest.solutionRevisionId ||
          document.provider.id !== awsCatalogV1.artifact.provider.id ||
          document.catalog.id !== awsCatalogV1.artifact.catalog.id ||
          document.catalog.version !== awsCatalogV1.artifact.catalog.version ||
          document.catalog.digest !== AWS_CATALOG_DIGEST_V1
        )
          throw new ApplicationError(
            "conflict",
            "The saved revision uses an unavailable provider catalog.",
          );
        await database.scope();
        capturedContext = {
          contractVersion: 1,
          approvedArchitecture: document,
          solutionRevision: revision.manifest,
          catalog: awsCatalogV1.artifact,
        };
        return capturedContext;
      },
    };
    const service = createGitHubRepositoryImportService({
      audit: new PostgresGitHubExportAuditSink(database),
      clock,
      directory,
      context,
      github: {
        inspectInstallation: (id) => github.inspectInstallation(id),
        withInstallationSession: () =>
          Promise.reject(new GitHubExportError("invalid-request")),
        async withRepositoryReadSession(input, operation) {
          installationId = input.installationId;
          await authorizeCurrent();
          const descriptor = await github.inspectInstallation(installationId);
          const installation =
            await directory.getInstallationByInstallationId(installationId);
          if (
            descriptor.installationId !== installationId ||
            descriptor.suspended ||
            descriptor.permissions.contents === "none" ||
            descriptor.permissions.metadata === "none" ||
            descriptor.repositorySelection !== "selected" ||
            descriptor.accountId !== installation?.accountId ||
            descriptor.accountType !== installation.accountType
          )
            throw new GitHubExportError("installation-revoked");
          const result = await github.withRepositoryReadSession(
            input,
            operation,
          );
          await authorizeCurrent();
          return result;
        },
      },
      importer,
      progress: new PostgresGitHubRepositoryImportProgressSink(database),
      store: new PostgresGitHubRepositoryImportStore(database),
      reconciler: {
        async review(input) {
          await database.scope();
          if (
            input.decision === "accept-into-design" &&
            input.operation.kind === "accept-observed-graph-change"
          ) {
            if (acceptance === undefined)
              throw new ApplicationError(
                "precondition_required",
                "Save the draft and acquire editing access before accepting repository changes.",
              );
            const applied = await options.application.applyDraftCommand(
              principal,
              projectId,
              applyDraftCommandV1Schema.parse({
                contractVersion: 1,
                command: input.operation.graphCommands,
                contentBinding: {
                  expectedContentDigest:
                    input.operation.expectedArchitectureContentHash,
                  resultingContentDigest:
                    input.operation.resultingArchitectureContentHash,
                },
                editingLease: acceptance.editingLease,
              }),
              acceptance.expectedDraftEtag,
              `repository-accept:${input.idempotencyDigest.slice(7)}`,
            );
            await database.scope();
            return {
              designChanged: true,
              receiptId: `repository-command.${applied.value.appliedCommandId}`,
            };
          }
          if (
            input.decision !== "keep-observed" &&
            input.decision !== "reject" &&
            input.decision !== "ignore"
          )
            throw new ApplicationError(
              "service_unavailable",
              "Applying repository changes requires a reviewed editor command.",
            );
          return {
            designChanged: false,
            receiptId: `repository-review.${randomUUID()}`,
          };
        },
      },
      regeneration: {
        createExportPreview: () =>
          Promise.reject(
            new ApplicationError(
              "service_unavailable",
              "Create an export from the saved solution revision.",
            ),
          ),
      },
    });
    const application = new GitHubRepositoryImportApplicationService({
      imports: service,
      access: {
        async authorizeProject(actor, selectedProjectId, requestedPermission) {
          if (
            actor !== principal ||
            selectedProjectId !== projectId ||
            requestedPermission !== permission
          )
            throw new ApplicationError("not_found", "Project not found.");
          await database.scope();
          return { organizationId };
        },
      },
      subscriptions: {
        configure: () =>
          Promise.reject(
            new ApplicationError(
              "service_unavailable",
              "Automatic repository refresh is not configured. Import the latest commit manually.",
            ),
          ),
      },
    });
    if (prepareImport) await context.load({ organizationId, projectId });
    const result = await work(application, principal);
    await authorizeCurrent();
    return result;
  }
  return {
    discoverRepository: (principal, projectId, raw) => {
      const input = discoverGithubRepositoryV1Schema.parse(raw);
      return run(principal, projectId, "projects.read", (application, actor) =>
        application.discoverRepository(actor, projectId, input),
      );
    },
    createImport: (principal, projectId, input, key) =>
      run(
        principal,
        projectId,
        "projects.mutate",
        (application, actor) =>
          application.createImport(actor, projectId, input, key),
        true,
      ),
    listImports: (principal, projectId, repositoryId) =>
      run(principal, projectId, "projects.read", (application, actor) =>
        application.listImports(actor, projectId, repositoryId),
      ),
    review: (principal, projectId, importId, raw, key) => {
      const input = reviewGithubRepositoryImportV1Schema.parse(raw);
      return run(
        principal,
        projectId,
        "projects.mutate",
        (application, actor) =>
          application.review(actor, projectId, importId, input, key),
        false,
        input.draftAcceptance,
      );
    },
    configureRefresh: (principal, projectId, input, key) =>
      run(principal, projectId, "projects.mutate", (application, actor) =>
        application.configureRefresh(actor, projectId, input, key),
      ),
  };
}
