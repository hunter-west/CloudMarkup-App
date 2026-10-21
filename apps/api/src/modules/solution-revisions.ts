import {
  consequentialMutationHeadersV1Schema,
  createSolutionRevisionV1Schema,
  projectPathV1Schema,
  solutionRevisionListQueryV1Schema,
  solutionRevisionListResponseV1Schema,
  solutionRevisionPathV1Schema,
  solutionRevisionResponseV1Schema,
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

export function registerSolutionRevisionRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.post("/v1/projects/:projectId/solution-revisions", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(
      context,
      consequentialMutationHeadersV1Schema,
      ["idempotency-key", "if-match"],
    );
    const input = await parseJsonBody(context, createSolutionRevisionV1Schema);
    const result = await application.createSolutionRevision(
      context.get("principal"),
      path.projectId,
      input,
      headers["if-match"],
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      solutionRevisionResponseV1Schema,
      dataEnvelope(result),
      201,
    );
  });

  app.get("/v1/projects/:projectId/solution-revisions", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const query = parseQuery(context, solutionRevisionListQueryV1Schema);
    const result = await application.listSolutionRevisions(
      context.get("principal"),
      path.projectId,
      pageOptions(query),
    );
    return validatedJsonResponse(
      solutionRevisionListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });

  app.get(
    "/v1/projects/:projectId/solution-revisions/:solutionRevisionId",
    async (context) => {
      const path = parsePath(context, solutionRevisionPathV1Schema);
      const result = await application.getSolutionRevision(
        context.get("principal"),
        path.projectId,
        path.solutionRevisionId,
      );
      return validatedJsonResponse(
        solutionRevisionResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );
}
