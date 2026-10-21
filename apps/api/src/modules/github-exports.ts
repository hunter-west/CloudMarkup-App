import {
  completeGithubAppInstallationLinkV1Schema,
  createGithubAppInstallationLinkIntentV1Schema,
  createGithubExportPreviewV1Schema,
  executeGithubExportV1Schema,
  githubBranchListResponseV1Schema,
  githubExportPreviewResponseV1Schema,
  githubExportReceiptResponseV1Schema,
  githubInstallationListResponseV1Schema,
  githubInstallationLinkIntentResponseV1Schema,
  githubInstallationPathV1Schema,
  githubInstallationResponseV1Schema,
  githubIntegrationPathV1Schema,
  githubRepositoryListResponseV1Schema,
  githubRepositoryPathV1Schema,
  idempotencyHeadersV1Schema,
  projectPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { GitHubRepositoryExportApplication } from "../application/github-exports.js";
import {
  bindGitHubBrowserSession,
  requireGitHubBrowserOrigin,
  type GitHubInstallationCallbackConfiguration,
} from "./github-installation-callback.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  listEnvelope,
  parseHeaders,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerGitHubExportRoutes(
  app: Hono<ApiEnvironment>,
  application: GitHubRepositoryExportApplication,
  callback?: GitHubInstallationCallbackConfiguration,
): void {
  app.get(
    "/v1/organizations/:organizationId/github-app-installations",
    async (context) => {
      const path = parsePath(context, githubInstallationPathV1Schema);
      const result = await application.listInstallations(
        context.get("principal"),
        path.organizationId,
      );
      return validatedJsonResponse(
        githubInstallationListResponseV1Schema,
        listEnvelope(result, undefined),
        200,
      );
    },
  );

  app.post(
    "/v1/organizations/:organizationId/github-app-installation-link-intents",
    async (context) => {
      if (callback !== undefined) requireGitHubBrowserOrigin(context, callback);
      const path = parsePath(context, githubInstallationPathV1Schema);
      const input = await parseJsonBody(
        context,
        createGithubAppInstallationLinkIntentV1Schema,
      );
      const result = await application.createInstallationLinkIntent(
        context.get("principal"),
        path.organizationId,
        input,
      );
      context.res = validatedJsonResponse(
        githubInstallationLinkIntentResponseV1Schema,
        dataEnvelope(result),
        201,
      );
      if (callback !== undefined)
        await bindGitHubBrowserSession(
          context,
          callback,
          path.organizationId,
          result,
        );
      return context.res;
    },
  );

  app.post(
    "/v1/organizations/:organizationId/github-app-installation-link-completions",
    async (context) => {
      if (callback !== undefined) requireGitHubBrowserOrigin(context, callback);
      const path = parsePath(context, githubInstallationPathV1Schema);
      const input = await parseJsonBody(
        context,
        completeGithubAppInstallationLinkV1Schema,
      );
      const result = await application.completeInstallationLink(
        context.get("principal"),
        path.organizationId,
        input,
      );
      return validatedJsonResponse(
        githubInstallationResponseV1Schema,
        dataEnvelope(result),
        201,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/github-app-installations/:integrationId/repositories",
    async (context) => {
      const path = parsePath(context, githubIntegrationPathV1Schema);
      const result = await application.discoverRepositories(
        context.get("principal"),
        path.organizationId,
        path.integrationId,
      );
      return validatedJsonResponse(
        githubRepositoryListResponseV1Schema,
        listEnvelope(result, undefined),
        200,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/github-app-installations/:integrationId/repositories/:repositoryId/branches",
    async (context) => {
      const path = parsePath(context, githubRepositoryPathV1Schema);
      const result = await application.discoverBranches(
        context.get("principal"),
        path.organizationId,
        path.integrationId,
        path.repositoryId,
      );
      return validatedJsonResponse(
        githubBranchListResponseV1Schema,
        listEnvelope(result, undefined),
        200,
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/github-repository-export-previews",
    async (context) => {
      const path = parsePath(context, projectPathV1Schema);
      const input = await parseJsonBody(
        context,
        createGithubExportPreviewV1Schema,
      );
      const result = await application.createPreview(
        context.get("principal"),
        path.projectId,
        input,
      );
      return validatedJsonResponse(
        githubExportPreviewResponseV1Schema,
        dataEnvelope(result),
        201,
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/github-repository-exports",
    async (context) => {
      const path = parsePath(context, projectPathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      const input = await parseJsonBody(context, executeGithubExportV1Schema);
      const result = await application.execute(
        context.get("principal"),
        path.projectId,
        input,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        githubExportReceiptResponseV1Schema,
        dataEnvelope(result),
        201,
      );
    },
  );
}
