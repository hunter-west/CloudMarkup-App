import {
  betaInfrastructureJobCreditsResponseV1Schema,
  type BetaInfrastructureJobCreditsV1,
  cancelSolutionExportJobV1Schema,
  createSolutionExportDownloadGrantV1Schema,
  createSolutionExportJobV1Schema,
  idempotencyHeadersV1Schema,
  projectPathV1Schema,
  solutionExportArtifactDiffResponseV1Schema,
  solutionExportArtifactFilePathV1Schema,
  solutionExportArtifactPathV1Schema,
  solutionExportArtifactResponseV1Schema,
  solutionExportDownloadGrantPathV1Schema,
  solutionExportDownloadGrantResponseV1Schema,
  solutionExportDownloadResponseHeadersV1Schema,
  solutionExportFilePreviewResponseV1Schema,
  solutionExportJobPathV1Schema,
  solutionExportJobResponseV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { SolutionExportApplication } from "../application/solution-exports.js";
import type { PrincipalContext } from "../application/ports.js";
import type { SolutionExportReadApplication } from "../application/solution-export-reads.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parseHeaders,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerSolutionExportRoutes(
  app: Hono<ApiEnvironment>,
  application: SolutionExportApplication,
  reads: SolutionExportReadApplication = application,
  credits?: {
    get(
      principal: PrincipalContext,
      projectId: string,
      jobId: string,
    ): Promise<BetaInfrastructureJobCreditsV1>;
  },
): void {
  app.post("/v1/projects/:projectId/solution-export-jobs", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const input = await parseJsonBody(context, createSolutionExportJobV1Schema);
    const result = await application.createJob(
      context.get("principal"),
      path.projectId,
      input,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      solutionExportJobResponseV1Schema,
      dataEnvelope(result),
      202,
    );
  });

  app.get(
    "/v1/projects/:projectId/solution-export-jobs/:solutionExportJobId",
    async (context) => {
      const path = parsePath(context, solutionExportJobPathV1Schema);
      const result = await reads.getJob(
        context.get("principal"),
        path.projectId,
        path.solutionExportJobId,
      );
      return validatedJsonResponse(
        solutionExportJobResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );

  app.get(
    "/v1/projects/:projectId/solution-export-jobs/:solutionExportJobId/credits",
    async (context) => {
      const path = parsePath(context, solutionExportJobPathV1Schema);
      if (!credits) throw new Error("Export credit receipts are unavailable.");
      return validatedJsonResponse(
        betaInfrastructureJobCreditsResponseV1Schema,
        dataEnvelope(
          await credits.get(
            context.get("principal"),
            path.projectId,
            path.solutionExportJobId,
          ),
        ),
        200,
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/solution-export-jobs/:solutionExportJobId/cancel",
    async (context) => {
      const path = parsePath(context, solutionExportJobPathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      await parseJsonBody(context, cancelSolutionExportJobV1Schema);
      const result = await application.cancelJob(
        context.get("principal"),
        path.projectId,
        path.solutionExportJobId,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        solutionExportJobResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );

  app.get(
    "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId",
    async (context) => {
      const path = parsePath(context, solutionExportArtifactPathV1Schema);
      const result = await reads.getArtifact(
        context.get("principal"),
        path.projectId,
        path.solutionExportArtifactId,
      );
      return validatedJsonResponse(
        solutionExportArtifactResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );

  app.get(
    "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId/files/:solutionExportArtifactFileId/preview",
    async (context) => {
      const path = parsePath(context, solutionExportArtifactFilePathV1Schema);
      const result = await reads.getFilePreview(
        context.get("principal"),
        path.projectId,
        path.solutionExportArtifactId,
        path.solutionExportArtifactFileId,
      );
      return validatedJsonResponse(
        solutionExportFilePreviewResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );

  app.get(
    "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId/diff",
    async (context) => {
      const path = parsePath(context, solutionExportArtifactPathV1Schema);
      const result = await reads.getArtifactDiff(
        context.get("principal"),
        path.projectId,
        path.solutionExportArtifactId,
      );
      return validatedJsonResponse(
        solutionExportArtifactDiffResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId/download-grants",
    async (context) => {
      const path = parsePath(context, solutionExportArtifactPathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      await parseJsonBody(context, createSolutionExportDownloadGrantV1Schema);
      const result = await reads.createDownloadGrant(
        context.get("principal"),
        path.projectId,
        path.solutionExportArtifactId,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        solutionExportDownloadGrantResponseV1Schema,
        dataEnvelope(result),
        201,
      );
    },
  );

  app.get(
    "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId/download-grants/:solutionExportDownloadGrantId/content",
    async (context) => {
      const path = parsePath(context, solutionExportDownloadGrantPathV1Schema);
      const result = await reads.download(
        context.get("principal"),
        path.projectId,
        path.solutionExportArtifactId,
        path.solutionExportDownloadGrantId,
      );
      const body = new Uint8Array(result.bytes).buffer;
      const headers = solutionExportDownloadResponseHeadersV1Schema.parse({
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "content-length": String(result.bytes.byteLength),
        "content-security-policy": "sandbox",
        "content-type": result.mediaType,
        "referrer-policy": "no-referrer",
        "x-cloudmarkup-content-sha256": result.digest,
        "x-content-type-options": "nosniff",
      });
      return new Response(body, {
        headers,
        status: 200,
      });
    },
  );
}
