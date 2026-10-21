import {
  applyDraftCommandResponseV1Schema,
  applyDraftCommandV1Schema,
  archiveProjectV1Schema,
  consequentialMutationHeadersV1Schema,
  createProjectEnvironmentV1Schema,
  createProjectResponseV1Schema,
  createProjectV1Schema,
  draftArchitectureDocumentResponseV1Schema,
  environmentListQueryV1Schema,
  environmentPathV1Schema,
  idempotencyHeadersV1Schema,
  organizationPathV1Schema,
  preconditionHeadersV1Schema,
  projectEnvironmentListResponseV1Schema,
  projectEnvironmentResponseV1Schema,
  projectListQueryV1Schema,
  projectListResponseV1Schema,
  projectPathV1Schema,
  projectResponseV1Schema,
  renameProjectV1Schema,
  saveDraftResponseV1Schema,
  saveDraftV1Schema,
  updateProjectEnvironmentV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { CloudMarkupApplication } from "../application/ports.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  listEnvelope,
  pageOptions,
  parseHeaders,
  parseJsonBody,
  parsePath,
  parseQuery,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerProjectRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.get("/v1/organizations/:organizationId/projects", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    const query = parseQuery(context, projectListQueryV1Schema);
    const result = await application.listProjects(
      context.get("principal"),
      path.organizationId,
      pageOptions(query),
    );
    return validatedJsonResponse(
      projectListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });

  app.post("/v1/organizations/:organizationId/projects", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const input = await parseJsonBody(context, createProjectV1Schema);
    const result = await application.createProject(
      context.get("principal"),
      path.organizationId,
      input,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      createProjectResponseV1Schema,
      dataEnvelope(result),
      201,
    );
  });

  app.get("/v1/projects/:projectId", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const result = await application.getProject(
      context.get("principal"),
      path.projectId,
    );
    return validatedJsonResponse(
      projectResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.put("/v1/projects/:projectId", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(context, preconditionHeadersV1Schema, [
      "if-match",
    ]);
    const input = await parseJsonBody(context, renameProjectV1Schema);
    const result = await application.renameProject(
      context.get("principal"),
      path.projectId,
      input,
      headers["if-match"],
    );
    return validatedJsonResponse(
      projectResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.post("/v1/projects/:projectId/archive", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(
      context,
      consequentialMutationHeadersV1Schema,
      ["idempotency-key", "if-match"],
    );
    const input = await parseJsonBody(context, archiveProjectV1Schema);
    const result = await application.archiveProject(
      context.get("principal"),
      path.projectId,
      input,
      headers["if-match"],
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      projectResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.delete("/v1/projects/:projectId", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(
      context,
      consequentialMutationHeadersV1Schema,
      ["idempotency-key", "if-match"],
    );
    const result = await application.deleteProject(
      context.get("principal"),
      path.projectId,
      headers["if-match"],
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      projectResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.get("/v1/projects/:projectId/environments", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const query = parseQuery(context, environmentListQueryV1Schema);
    const result = await application.listProjectEnvironments(
      context.get("principal"),
      path.projectId,
      pageOptions(query),
    );
    return validatedJsonResponse(
      projectEnvironmentListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });

  app.post("/v1/projects/:projectId/environments", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const input = await parseJsonBody(
      context,
      createProjectEnvironmentV1Schema,
    );
    const environment = await application.createProjectEnvironment(
      context.get("principal"),
      path.projectId,
      input,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      projectEnvironmentResponseV1Schema,
      dataEnvelope(environment),
      201,
    );
  });

  app.get(
    "/v1/projects/:projectId/environments/:environmentId",
    async (context) => {
      const path = parsePath(context, environmentPathV1Schema);
      const result = await application.getProjectEnvironment(
        context.get("principal"),
        path.projectId,
        path.environmentId,
      );
      return validatedJsonResponse(
        projectEnvironmentResponseV1Schema,
        dataEnvelope(result.value),
        200,
        { ETag: result.etag },
      );
    },
  );

  app.put(
    "/v1/projects/:projectId/environments/:environmentId",
    async (context) => {
      const path = parsePath(context, environmentPathV1Schema);
      const headers = parseHeaders(context, preconditionHeadersV1Schema, [
        "if-match",
      ]);
      const input = await parseJsonBody(
        context,
        updateProjectEnvironmentV1Schema,
      );
      const result = await application.updateProjectEnvironment(
        context.get("principal"),
        path.projectId,
        path.environmentId,
        input,
        headers["if-match"],
      );
      return validatedJsonResponse(
        projectEnvironmentResponseV1Schema,
        dataEnvelope(result.value),
        200,
        { ETag: result.etag },
      );
    },
  );

  app.delete(
    "/v1/projects/:projectId/environments/:environmentId",
    async (context) => {
      const path = parsePath(context, environmentPathV1Schema);
      const headers = parseHeaders(
        context,
        consequentialMutationHeadersV1Schema,
        ["idempotency-key", "if-match"],
      );
      const result = await application.deleteProjectEnvironment(
        context.get("principal"),
        path.projectId,
        path.environmentId,
        headers["if-match"],
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        projectEnvironmentResponseV1Schema,
        dataEnvelope(result.value),
        200,
        { ETag: result.etag },
      );
    },
  );

  app.get("/v1/projects/:projectId/draft", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const result = await application.getDraft(
      context.get("principal"),
      path.projectId,
    );
    return validatedJsonResponse(
      draftArchitectureDocumentResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.put("/v1/projects/:projectId/draft", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(context, preconditionHeadersV1Schema, [
      "if-match",
    ]);
    const input = await parseJsonBody(context, saveDraftV1Schema);
    const result = await application.saveDraft(
      context.get("principal"),
      path.projectId,
      input,
      headers["if-match"],
    );
    return validatedJsonResponse(
      saveDraftResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.post("/v1/projects/:projectId/draft/commands", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(
      context,
      consequentialMutationHeadersV1Schema,
      ["idempotency-key", "if-match"],
    );
    const input = await parseJsonBody(context, applyDraftCommandV1Schema);
    const result = await application.applyDraftCommand(
      context.get("principal"),
      path.projectId,
      input,
      headers["if-match"],
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      applyDraftCommandResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });
}
