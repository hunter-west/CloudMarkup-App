import {
  createExportJobV1Schema,
  createGenerationJobV1Schema,
  exportJobPathV1Schema,
  exportJobResponseV1Schema,
  generationJobPathV1Schema,
  generationJobResponseV1Schema,
  idempotencyHeadersV1Schema,
  projectPathV1Schema,
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

export function registerJobRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.post("/v1/projects/:projectId/generation-jobs", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const input = await parseJsonBody(context, createGenerationJobV1Schema);
    const job = await application.createGenerationJob(
      context.get("principal"),
      path.projectId,
      input,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      generationJobResponseV1Schema,
      dataEnvelope(job),
      202,
    );
  });

  app.get(
    "/v1/projects/:projectId/generation-jobs/:generationJobId",
    async (context) => {
      const path = parsePath(context, generationJobPathV1Schema);
      const job = await application.getGenerationJob(
        context.get("principal"),
        path.projectId,
        path.generationJobId,
      );
      return validatedJsonResponse(
        generationJobResponseV1Schema,
        dataEnvelope(job),
        200,
      );
    },
  );

  app.post("/v1/projects/:projectId/export-jobs", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const input = await parseJsonBody(context, createExportJobV1Schema);
    const job = await application.createExportJob(
      context.get("principal"),
      path.projectId,
      input,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      exportJobResponseV1Schema,
      dataEnvelope(job),
      202,
    );
  });

  app.get(
    "/v1/projects/:projectId/export-jobs/:exportJobId",
    async (context) => {
      const path = parsePath(context, exportJobPathV1Schema);
      const job = await application.getExportJob(
        context.get("principal"),
        path.projectId,
        path.exportJobId,
      );
      return validatedJsonResponse(
        exportJobResponseV1Schema,
        dataEnvelope(job),
        200,
      );
    },
  );
}
