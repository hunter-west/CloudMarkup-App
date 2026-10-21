import {
  continuousConformanceDiagramResponseV1Schema,
  continuousConformanceReviewActionResponseV1Schema,
  exportContinuousConformanceDiagramV1Schema,
  idempotencyHeadersV1Schema,
  reviewContinuousConformanceActionV1Schema,
  continuousConformancePathV1Schema,
  continuousConformanceResponseV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { ContinuousConformanceApplication } from "../application/continuous-conformance.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parseHeaders,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerContinuousConformanceRoutes(
  app: Hono<ApiEnvironment>,
  application: ContinuousConformanceApplication,
): void {
  app.get(
    "/v1/projects/:projectId/solution-revisions/:solutionRevisionId/environments/:environmentId/conformance",
    async (context) => {
      const path = parsePath(context, continuousConformancePathV1Schema);
      const view = await application.getView(
        context.get("principal"),
        path.projectId,
        path.solutionRevisionId,
        path.environmentId,
      );
      return validatedJsonResponse(
        continuousConformanceResponseV1Schema,
        dataEnvelope(view),
        200,
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/solution-revisions/:solutionRevisionId/environments/:environmentId/conformance/diagram-exports",
    async (context) => {
      const path = parsePath(context, continuousConformancePathV1Schema);
      const input = await parseJsonBody(
        context,
        exportContinuousConformanceDiagramV1Schema,
      );
      const result = await application.exportDiagram(
        context.get("principal"),
        path.projectId,
        path.solutionRevisionId,
        path.environmentId,
        input,
      );
      return validatedJsonResponse(
        continuousConformanceDiagramResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/solution-revisions/:solutionRevisionId/environments/:environmentId/conformance/review-actions",
    async (context) => {
      const path = parsePath(context, continuousConformancePathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      const input = await parseJsonBody(
        context,
        reviewContinuousConformanceActionV1Schema,
      );
      const result = await application.reviewAction(
        context.get("principal"),
        path.projectId,
        path.solutionRevisionId,
        path.environmentId,
        input,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        continuousConformanceReviewActionResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );
}
