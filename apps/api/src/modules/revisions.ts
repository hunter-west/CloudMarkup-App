import {
  consequentialMutationHeadersV1Schema,
  createRevisionV1Schema,
  projectPathV1Schema,
  revisionListQueryV1Schema,
  revisionListResponseV1Schema,
  revisionPathV1Schema,
  revisionResponseV1Schema,
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

export function registerRevisionRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.post("/v1/projects/:projectId/revisions", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(
      context,
      consequentialMutationHeadersV1Schema,
      ["idempotency-key", "if-match"],
    );
    const input = await parseJsonBody(context, createRevisionV1Schema);
    const revision = await application.createRevision(
      context.get("principal"),
      path.projectId,
      input,
      headers["if-match"],
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      revisionResponseV1Schema,
      dataEnvelope(revision),
      201,
    );
  });

  app.get("/v1/projects/:projectId/revisions", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const query = parseQuery(context, revisionListQueryV1Schema);
    const result = await application.listRevisions(
      context.get("principal"),
      path.projectId,
      pageOptions(query),
    );
    return validatedJsonResponse(
      revisionListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });

  app.get("/v1/projects/:projectId/revisions/:revisionId", async (context) => {
    const path = parsePath(context, revisionPathV1Schema);
    const revision = await application.getRevision(
      context.get("principal"),
      path.projectId,
      path.revisionId,
    );
    return validatedJsonResponse(
      revisionResponseV1Schema,
      dataEnvelope(revision),
      200,
    );
  });
}
