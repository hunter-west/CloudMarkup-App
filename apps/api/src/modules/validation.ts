import {
  createValidationRunV1Schema,
  idempotencyHeadersV1Schema,
  projectPathV1Schema,
  validationRunPathV1Schema,
  validationRunResponseV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { CloudMarkupApplication } from "../application/ports.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parseHeaders,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerValidationRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.post("/v1/projects/:projectId/validation-runs", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const input = await parseJsonBody(context, createValidationRunV1Schema);
    const validationRun = await application.createValidationRun(
      context.get("principal"),
      path.projectId,
      input,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      validationRunResponseV1Schema,
      dataEnvelope(validationRun),
      202,
    );
  });

  app.get(
    "/v1/projects/:projectId/validation-runs/:validationRunId",
    async (context) => {
      const path = parsePath(context, validationRunPathV1Schema);
      const validationRun = await application.getValidationRun(
        context.get("principal"),
        path.projectId,
        path.validationRunId,
      );
      return validatedJsonResponse(
        validationRunResponseV1Schema,
        dataEnvelope(validationRun),
        200,
      );
    },
  );
}
