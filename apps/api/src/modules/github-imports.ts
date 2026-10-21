import {
  createGithubRepositoryImportV1Schema,
  discoverGithubRepositoryV1Schema,
  githubRepositoryDiscoveryResponseV1Schema,
  createGithubRepositoryRefreshSubscriptionV1Schema,
  githubRepositoryImportListQueryV1Schema,
  githubRepositoryImportListResponseV1Schema,
  githubRepositoryImportPathV1Schema,
  githubRepositoryImportResponseV1Schema,
  githubRepositoryReconciliationReviewResponseV1Schema,
  githubRepositoryRefreshSubscriptionResponseV1Schema,
  idempotencyHeadersV1Schema,
  projectPathV1Schema,
  reviewGithubRepositoryImportV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { GitHubRepositoryImportApplication } from "../application/github-imports.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  listEnvelope,
  parseHeaders,
  parseJsonBody,
  parsePath,
  parseQuery,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerGitHubImportRoutes(
  app: Hono<ApiEnvironment>,
  application: GitHubRepositoryImportApplication,
): void {
  app.post(
    "/v1/projects/:projectId/github-repository-discovery",
    async (context) => {
      const path = parsePath(context, projectPathV1Schema);
      const input = await parseJsonBody(
        context,
        discoverGithubRepositoryV1Schema,
      );
      const result = await application.discoverRepository(
        context.get("principal"),
        path.projectId,
        input,
      );
      return validatedJsonResponse(
        githubRepositoryDiscoveryResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );
  app.post(
    "/v1/projects/:projectId/github-repository-imports",
    async (context) => {
      const path = parsePath(context, projectPathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      const input = await parseJsonBody(
        context,
        createGithubRepositoryImportV1Schema,
      );
      const result = await application.createImport(
        context.get("principal"),
        path.projectId,
        input,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        githubRepositoryImportResponseV1Schema,
        dataEnvelope(result),
        201,
      );
    },
  );

  app.get(
    "/v1/projects/:projectId/github-repository-imports",
    async (context) => {
      const path = parsePath(context, projectPathV1Schema);
      const query = parseQuery(
        context,
        githubRepositoryImportListQueryV1Schema,
      );
      const result = await application.listImports(
        context.get("principal"),
        path.projectId,
        query.repositoryId === undefined
          ? undefined
          : Number(query.repositoryId),
      );
      return validatedJsonResponse(
        githubRepositoryImportListResponseV1Schema,
        listEnvelope(result, undefined),
        200,
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/github-repository-imports/:importId/reviews",
    async (context) => {
      const path = parsePath(context, githubRepositoryImportPathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      const input = await parseJsonBody(
        context,
        reviewGithubRepositoryImportV1Schema,
      );
      const result = await application.review(
        context.get("principal"),
        path.projectId,
        path.importId,
        input,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        githubRepositoryReconciliationReviewResponseV1Schema,
        dataEnvelope(result),
        201,
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/github-repository-import-refresh-subscriptions",
    async (context) => {
      const path = parsePath(context, projectPathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      const input = await parseJsonBody(
        context,
        createGithubRepositoryRefreshSubscriptionV1Schema,
      );
      const result = await application.configureRefresh(
        context.get("principal"),
        path.projectId,
        input,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        githubRepositoryRefreshSubscriptionResponseV1Schema,
        dataEnvelope(result),
        201,
      );
    },
  );
}
