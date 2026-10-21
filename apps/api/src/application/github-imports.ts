import type {
  CreateGithubRepositoryImportV1,
  DiscoverGithubRepositoryV1,
  GithubRepositoryDiscoveryV1,
  CreateGithubRepositoryRefreshSubscriptionV1,
  GithubRepositoryImportV1,
  GithubRepositoryReconciliationReviewV1,
  GithubRepositoryRefreshSubscriptionV1,
  ReviewGithubRepositoryImportV1,
} from "@cloudmarkup/api-contract";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import type {
  GitHubRepositoryImportService,
  StoredGitHubRepositoryImport,
} from "@cloudmarkup/github-repository-export/repository-import";

import type { OrganizationPermission } from "./authorization.js";
import { ApplicationError } from "./errors.js";
import type { ObjectAuthorizationService } from "./object-authorization.js";
import type { PrincipalContext } from "./ports.js";

export interface GitHubRepositoryImportAuthorizedScope {
  readonly organizationId: string;
}

export interface GitHubRepositoryImportAccessControl {
  authorizeProject(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<GitHubRepositoryImportAuthorizedScope>;
}

export class ObjectAuthorizationGitHubRepositoryImportAccessControl implements GitHubRepositoryImportAccessControl {
  readonly #authorization: ObjectAuthorizationService;

  constructor(authorization: ObjectAuthorizationService) {
    this.#authorization = authorization;
  }

  async authorizeProject(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<GitHubRepositoryImportAuthorizedScope> {
    const authorized = await this.#authorization.authorizeProject(
      principal,
      principal.correlationId,
      projectId,
      permission,
    );
    return { organizationId: authorized.organizationId };
  }
}

export interface GitHubRepositoryRefreshSubscriptionApplicationPort {
  configure(input: {
    readonly branch: string;
    readonly enabled: boolean;
    readonly events: readonly "push"[];
    readonly idempotencyKey: string;
    readonly ignoredPaths: readonly string[];
    readonly integrationId: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
    readonly repositoryId: number;
    readonly selectedPaths: readonly string[];
  }): Promise<GithubRepositoryRefreshSubscriptionV1>;
}

export interface GitHubRepositoryImportApplication {
  discoverRepository(
    principal: PrincipalContext,
    projectId: string,
    input: DiscoverGithubRepositoryV1,
  ): Promise<GithubRepositoryDiscoveryV1>;
  configureRefresh(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGithubRepositoryRefreshSubscriptionV1,
    idempotencyKey: string,
  ): Promise<GithubRepositoryRefreshSubscriptionV1>;
  createImport(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGithubRepositoryImportV1,
    idempotencyKey: string,
  ): Promise<GithubRepositoryImportV1>;
  listImports(
    principal: PrincipalContext,
    projectId: string,
    repositoryId?: number,
  ): Promise<readonly GithubRepositoryImportV1[]>;
  review(
    principal: PrincipalContext,
    projectId: string,
    importId: string,
    input: ReviewGithubRepositoryImportV1,
    idempotencyKey: string,
  ): Promise<GithubRepositoryReconciliationReviewV1>;
}

function applicationError(error: unknown): never {
  if (error instanceof ApplicationError) throw error;
  if (!(error instanceof Error) || !("code" in error)) throw error;
  const code = String((error as { readonly code: unknown }).code);
  throw new ApplicationError(
    code === "rate-limited"
      ? "rate_limited"
      : code === "service-unavailable"
        ? "service_unavailable"
        : code === "authorization-denied"
          ? "access_denied"
          : code === "integration-not-found" ||
              code === "repository-not-found" ||
              code === "installation-revoked"
            ? "not_found"
            : code === "repository-changed" ||
                code === "import-in-progress" ||
                code === "github-permission-denied"
              ? "conflict"
              : "invalid_request",
    error.message,
  );
}

function publicImport(
  record: StoredGitHubRepositoryImport,
): GithubRepositoryImportV1 {
  const result = record.result;
  const evidenceConfidence = new Map<string, "confirmed" | "unresolved">();
  for (const fact of result?.importResult.facts ?? []) {
    const evidenceId = fact.source.evidenceId;
    if (
      fact.confidence === "unresolved" ||
      evidenceConfidence.get(evidenceId) === undefined
    ) {
      evidenceConfidence.set(evidenceId, fact.confidence);
    }
  }
  const deterministicIssues = (result?.importResult.issues ?? []).map(
    (issue) => ({
      evidenceIds:
        result?.importResult.differences
          .filter(({ differenceId }) => issue.sourceRecordId === differenceId)
          .flatMap(({ evidenceIds }) => evidenceIds) ?? [],
      issueId: issue.id,
      lifecycle: "current" as const,
      severity: issue.severity,
      source: "repository-import-mismatch" as const,
      summary: issue.summary,
    }),
  );
  const inferenceIssues = (result?.inferenceIssues ?? []).map((issue) => ({
    evidenceIds: [...issue.evidenceIds],
    issueId: issue.issueId,
    lifecycle: "current" as const,
    severity: "warning" as const,
    source: issue.source,
    summary: issue.summary,
  }));
  return {
    branch: record.branch,
    ...(result === undefined
      ? {}
      : {
          branchChangedSinceSelection: result.branchChangedSinceSelection,
        }),
    branchHeadSha: record.branchHeadSha,
    commitSha: record.commitSha,
    ...(record.completedAt === undefined
      ? {}
      : { completedAt: record.completedAt }),
    createdAt: record.createdAt,
    fileDifferences: [...(result?.fileDifferences ?? [])],
    files: [...(result?.files ?? [])],
    ignoredFiles: [...(result?.ignoredFiles ?? [])],
    ignoredPaths: [...record.ignoredPaths],
    importId: record.importId,
    inferenceClaims: (result?.inferenceClaims ?? []).map((claim) => ({
      ...claim,
      evidenceIds: [...claim.evidenceIds],
      observedOnly: true as const,
    })),
    issues: [...deterministicIssues, ...inferenceIssues],
    ...(result === undefined
      ? {}
      : {
          observedSolution: result.importResult.observedSolution,
          comparisonSolutionRevisionId:
            result.importResult.evidence.solutionRevisionId,
        }),
    ...(record.previousImportId === undefined
      ? {}
      : { previousImportId: record.previousImportId }),
    projectId: record.projectId,
    recordVersion: record.recordVersion,
    repositoryId: record.repositoryId,
    repositoryName: record.repositoryName,
    repositoryOwner: record.repositoryOwner,
    selectedPaths: [...record.selectedPaths],
    semanticDifferences: (result?.importResult.differences ?? []).map(
      (difference) => {
        const observedIds = new Set(
          difference.observedFactIds.map((factId) => `observed.${factId}`),
        );
        const operation = result?.importResult.proposal?.operations.find(
          ({ target }) => {
            const observedId =
              target.kind === "resource"
                ? target.observedResourceId
                : target.kind === "connection"
                  ? target.observedConnectionId
                  : target.kind === "generated-file"
                    ? target.observedGeneratedFileId
                    : undefined;
            return observedId !== undefined && observedIds.has(observedId);
          },
        );
        return {
          ...(difference.designTargetId === undefined
            ? {}
            : { designTargetId: difference.designTargetId }),
          differenceId: difference.differenceId,
          digest: difference.digest,
          evidenceIds: [...difference.evidenceIds],
          kind: difference.kind,
          observedFactIds: [...difference.observedFactIds],
          ...(operation === undefined
            ? {}
            : {
                operationId: operation.operationId,
                operationKind: operation.kind,
              }),
          severity: difference.severity,
          summary: difference.summary,
        };
      },
    ),
    ...(record.snapshotDigest === undefined
      ? {}
      : { snapshotDigest: record.snapshotDigest }),
    snapshotId: record.snapshotId,
    sourceEvidence: (result?.importResult.observedSolution.evidence ?? []).map(
      (evidence) => ({
        confidence:
          evidenceConfidence.get(evidence.sourceEvidenceId) ?? "confirmed",
        evidenceId: evidence.sourceEvidenceId,
        fileDigest: evidence.fileChecksum,
        path: evidence.path,
        startLine: evidence.location.startLine,
      }),
    ),
    state: record.state,
    trigger: record.trigger,
    updatedAt: record.updatedAt,
  };
}

export class GitHubRepositoryImportApplicationService implements GitHubRepositoryImportApplication {
  readonly #access: GitHubRepositoryImportAccessControl;
  readonly #imports: GitHubRepositoryImportService;
  readonly #subscriptions: GitHubRepositoryRefreshSubscriptionApplicationPort;

  constructor(options: {
    readonly access: GitHubRepositoryImportAccessControl;
    readonly imports: GitHubRepositoryImportService;
    readonly subscriptions: GitHubRepositoryRefreshSubscriptionApplicationPort;
  }) {
    this.#access = options.access;
    this.#imports = options.imports;
    this.#subscriptions = options.subscriptions;
  }

  async createImport(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGithubRepositoryImportV1,
    idempotencyKey: string,
  ): Promise<GithubRepositoryImportV1> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "projects.mutate",
    );
    try {
      return publicImport(
        await this.#imports.importRepository({
          branch: input.branch,
          commitSha: input.commitSha,
          correlationId: principal.correlationId,
          idempotencyKey,
          ignoredPaths: input.ignoredPaths,
          integrationId: input.integrationId,
          organizationId: authorized.organizationId,
          ...(input.previousImportId === undefined
            ? {}
            : { previousImportId: input.previousImportId }),
          principalId: principal.principalId,
          projectId,
          repositoryId: input.repositoryId,
          requestedMode: input.requestedMode,
          selectedPaths: input.selectedPaths,
          trigger: "manual",
        }),
      );
    } catch (error) {
      applicationError(error);
    }
  }

  async discoverRepository(
    suppliedPrincipal: PrincipalContext,
    projectId: string,
    suppliedInput: DiscoverGithubRepositoryV1,
  ): Promise<GithubRepositoryDiscoveryV1> {
    const principal = suppliedPrincipal;
    const input = structuredClone(suppliedInput);
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "projects.read",
    );
    try {
      const discovery = await this.#imports.discoverRepository({
        ...input,
        organizationId: authorized.organizationId,
      });
      const current = await this.#access.authorizeProject(
        principal,
        projectId,
        "projects.read",
      );
      if (current.organizationId !== authorized.organizationId)
        throw new ApplicationError(
          "access_denied",
          "Repository access is no longer available.",
        );
      return {
        ...discovery,
        files: discovery.files.map((file) => ({ ...file })),
        contractVersion: 1,
        integrationId: input.integrationId,
        projectId,
        branchChangedSinceSelection:
          discovery.branchHeadSha !== discovery.commitSha,
      };
    } catch (error) {
      applicationError(error);
    }
  }

  async listImports(
    principal: PrincipalContext,
    projectId: string,
    repositoryId?: number,
  ): Promise<readonly GithubRepositoryImportV1[]> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "projects.read",
    );
    return (
      await this.#imports.listImports({
        organizationId: authorized.organizationId,
        projectId,
        ...(repositoryId === undefined ? {} : { repositoryId }),
      })
    ).map(publicImport);
  }

  async review(
    principal: PrincipalContext,
    projectId: string,
    importId: string,
    input: ReviewGithubRepositoryImportV1,
    idempotencyKey: string,
  ): Promise<GithubRepositoryReconciliationReviewV1> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "projects.mutate",
    );
    try {
      const review = await this.#imports.review({
        correlationId: principal.correlationId,
        decision: input.decision,
        expectedSnapshotDigest: sha256DigestSchema.parse(
          input.expectedSnapshotDigest,
        ),
        idempotencyKey,
        importId,
        operationId: input.operationId,
        organizationId: authorized.organizationId,
        principalId: principal.principalId,
        projectId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      });
      return {
        decision: review.decision,
        designChanged: review.designChanged,
        importId: review.importId,
        operationId: review.operationId,
        receiptId: review.receiptId,
        reviewedAt: review.reviewedAt,
        snapshotDigest: review.snapshotDigest,
      };
    } catch (error) {
      applicationError(error);
    }
  }

  async configureRefresh(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGithubRepositoryRefreshSubscriptionV1,
    idempotencyKey: string,
  ): Promise<GithubRepositoryRefreshSubscriptionV1> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "projects.mutate",
    );
    return this.#subscriptions.configure({
      branch: input.branch,
      enabled: input.enabled,
      events: input.events,
      idempotencyKey,
      ignoredPaths: input.ignoredPaths,
      integrationId: input.integrationId,
      organizationId: authorized.organizationId,
      principalId: principal.principalId,
      projectId,
      repositoryId: input.repositoryId,
      selectedPaths: input.selectedPaths,
    });
  }
}
