import type {
  CompleteGithubAppInstallationLinkV1,
  CreateGithubAppInstallationLinkIntentV1,
  CreateGithubExportPreviewV1,
  ExecuteGithubExportV1,
  GithubBranchV1,
  GithubExportPreviewV1,
  GithubExportReceiptV1,
  GithubInstallationLinkIntentV1,
  GithubInstallationV1,
  GithubRepositoryV1,
} from "@cloudmarkup/api-contract";
import { githubExportPreviewV1Schema } from "@cloudmarkup/api-contract";
import { GitHubExportError } from "@cloudmarkup/github-repository-export/errors";
import type { GitHubRepositoryExportService } from "@cloudmarkup/github-repository-export/service";

import { sha256DigestSchema } from "@cloudmarkup/schemas";

import {
  CurrentPlanRepositoryExportEntitlementPolicy,
  type RepositoryExportEntitlementPolicy,
} from "./repository-export-entitlements.js";

import type { OrganizationPermission } from "./authorization.js";
import { ApplicationError } from "./errors.js";
import type { ObjectAuthorizationService } from "./object-authorization.js";
import type { CloudMarkupApplication, PrincipalContext } from "./ports.js";

export interface GitHubExportAuthorizedScope {
  readonly organizationId: string;
}

export interface GitHubExportAccessControl {
  authorizeOrganization(
    principal: PrincipalContext,
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<GitHubExportAuthorizedScope>;
  authorizeProject(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<GitHubExportAuthorizedScope>;
}

export type GitHubExportEntitlementPolicy = RepositoryExportEntitlementPolicy;

export class CurrentPlanGitHubExportEntitlementPolicy extends CurrentPlanRepositoryExportEntitlementPolicy {
  constructor(
    commercial: Pick<CloudMarkupApplication, "getCurrentPlanEntitlements">,
  ) {
    super(commercial, "GitHub");
  }
}

export class ObjectAuthorizationGitHubExportAccessControl implements GitHubExportAccessControl {
  readonly #authorization: ObjectAuthorizationService;

  constructor(authorization: ObjectAuthorizationService) {
    this.#authorization = authorization;
  }

  async authorizeOrganization(
    principal: PrincipalContext,
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<GitHubExportAuthorizedScope> {
    const authorized = await this.#authorization.authorizeOrganization(
      principal,
      principal.correlationId,
      organizationId,
      permission,
    );
    return { organizationId: authorized.organizationId };
  }

  async authorizeProject(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<GitHubExportAuthorizedScope> {
    const authorized = await this.#authorization.authorizeProject(
      principal,
      principal.correlationId,
      projectId,
      permission,
    );
    return { organizationId: authorized.organizationId };
  }
}
function applicationError(error: unknown): never {
  if (!(error instanceof GitHubExportError)) throw error;
  const code =
    error.code === "rate-limited"
      ? "rate_limited"
      : error.code === "service-unavailable" ||
          error.code === "secret-unavailable"
        ? "service_unavailable"
        : error.code === "authorization-denied"
          ? "access_denied"
          : error.code === "integration-not-found" ||
              error.code === "repository-not-found" ||
              error.code === "installation-revoked"
            ? "not_found"
            : error.code === "repository-changed" ||
                error.code === "installation-link-expired" ||
                error.code === "installation-link-replayed" ||
                error.code === "export-in-progress" ||
                error.code === "branch-conflict" ||
                error.code === "path-conflict" ||
                error.code === "preview-blocked" ||
                error.code === "preview-expired" ||
                error.code === "workflow-confirmation-required" ||
                error.code === "github-permission-denied"
              ? "conflict"
              : "invalid_request";
  throw new ApplicationError(code, error.message);
}

export interface GitHubRepositoryExportApplication {
  createPreview(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGithubExportPreviewV1,
  ): Promise<GithubExportPreviewV1>;
  discoverBranches(
    principal: PrincipalContext,
    organizationId: string,
    integrationId: string,
    repositoryId: number,
  ): Promise<readonly GithubBranchV1[]>;
  discoverRepositories(
    principal: PrincipalContext,
    organizationId: string,
    integrationId: string,
  ): Promise<readonly GithubRepositoryV1[]>;
  execute(
    principal: PrincipalContext,
    projectId: string,
    input: ExecuteGithubExportV1,
    idempotencyKey: string,
  ): Promise<GithubExportReceiptV1>;
  completeInstallationLink(
    principal: PrincipalContext,
    organizationId: string,
    input: CompleteGithubAppInstallationLinkV1,
  ): Promise<GithubInstallationV1>;
  createInstallationLinkIntent(
    principal: PrincipalContext,
    organizationId: string,
    input: CreateGithubAppInstallationLinkIntentV1,
  ): Promise<GithubInstallationLinkIntentV1>;
  listInstallations(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<readonly GithubInstallationV1[]>;
}

export class GitHubRepositoryExportApplicationService implements GitHubRepositoryExportApplication {
  readonly #access: GitHubExportAccessControl;
  readonly #entitlements: GitHubExportEntitlementPolicy;
  readonly #service: GitHubRepositoryExportService;

  constructor(options: {
    readonly access: GitHubExportAccessControl;
    readonly entitlements: GitHubExportEntitlementPolicy;
    readonly service: GitHubRepositoryExportService;
  }) {
    this.#access = options.access;
    this.#entitlements = options.entitlements;
    this.#service = options.service;
  }

  async listInstallations(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<readonly GithubInstallationV1[]> {
    const authorized = await this.#access.authorizeOrganization(
      principal,
      organizationId,
      "integrations.read",
    );
    return this.#service.listInstallations({
      organizationId: authorized.organizationId,
    });
  }

  async createInstallationLinkIntent(
    principal: PrincipalContext,
    organizationId: string,
    _input: CreateGithubAppInstallationLinkIntentV1,
  ): Promise<GithubInstallationLinkIntentV1> {
    void _input;
    const authorized = await this.#access.authorizeOrganization(
      principal,
      organizationId,
      "integrations.manage",
    );
    try {
      return await this.#service.createInstallationLinkIntent({
        correlationId: principal.correlationId,
        organizationId: authorized.organizationId,
        principalId: principal.principalId,
      });
    } catch (error) {
      applicationError(error);
    }
  }

  async completeInstallationLink(
    principal: PrincipalContext,
    organizationId: string,
    input: CompleteGithubAppInstallationLinkV1,
  ): Promise<GithubInstallationV1> {
    const authorized = await this.#access.authorizeOrganization(
      principal,
      organizationId,
      "integrations.manage",
    );
    try {
      return await this.#service.completeInstallationLink({
        callbackReceipt: input.callbackReceipt,
        correlationId: principal.correlationId,
        intentId: input.intentId,
        organizationId: authorized.organizationId,
        principalId: principal.principalId,
        sessionId: principal.sessionId,
      });
    } catch (error) {
      applicationError(error);
    }
  }
  async discoverRepositories(
    principal: PrincipalContext,
    organizationId: string,
    integrationId: string,
  ): Promise<readonly GithubRepositoryV1[]> {
    const authorized = await this.#access.authorizeOrganization(
      principal,
      organizationId,
      "integrations.read",
    );
    try {
      return await this.#service.discoverRepositories({
        correlationId: principal.correlationId,
        integrationId,
        organizationId: authorized.organizationId,
        principalId: principal.principalId,
      });
    } catch (error) {
      applicationError(error);
    }
  }

  async discoverBranches(
    principal: PrincipalContext,
    organizationId: string,
    integrationId: string,
    repositoryId: number,
  ): Promise<readonly GithubBranchV1[]> {
    const authorized = await this.#access.authorizeOrganization(
      principal,
      organizationId,
      "integrations.read",
    );
    try {
      return await this.#service.discoverBranches({
        integrationId,
        organizationId: authorized.organizationId,
        repositoryId,
      });
    } catch (error) {
      applicationError(error);
    }
  }

  async createPreview(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGithubExportPreviewV1,
  ): Promise<GithubExportPreviewV1> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "exports.run",
    );
    await this.#entitlements.authorize({
      organizationId: authorized.organizationId,
      principal,
      projectId,
    });
    try {
      const preview = await this.#service.createPreview({
        ...input,
        correlationId: principal.correlationId,
        organizationId: authorized.organizationId,
        principalId: principal.principalId,
        projectId,
      });
      return githubExportPreviewV1Schema.parse(preview);
    } catch (error) {
      applicationError(error);
    }
  }

  async execute(
    principal: PrincipalContext,
    projectId: string,
    input: ExecuteGithubExportV1,
    idempotencyKey: string,
  ): Promise<GithubExportReceiptV1> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "exports.run",
    );
    await this.#entitlements.authorize({
      organizationId: authorized.organizationId,
      principal,
      projectId,
    });
    try {
      return await this.#service.execute({
        confirmedWorkflowFiles: input.confirmedWorkflowFiles.map(
          ({ digest, path }) => ({
            digest: sha256DigestSchema.parse(digest),
            path,
          }),
        ),
        correlationId: principal.correlationId,
        idempotencyKey,
        organizationId: authorized.organizationId,
        previewDigest: sha256DigestSchema.parse(input.previewDigest),
        previewId: input.previewId,
        principalId: principal.principalId,
        projectId,
      });
    } catch (error) {
      applicationError(error);
    }
  }
}
