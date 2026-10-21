import type { BetaInfrastructureJobs } from "../application/beta-infrastructure-jobs.js";
import { createBetaInfrastructureProposalV1Schema } from "@cloudmarkup/schemas";
import {
  projectPathV1Schema,
  betaInfrastructureJobPathV1Schema,
  betaInfrastructureJobResponseV1Schema,
  betaInfrastructureJobCreditsResponseV1Schema,
  consequentialMutationHeadersV1Schema,
  preconditionHeadersV1Schema,
  betaInfrastructureProposalResponseV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { BetaInfrastructureApplication } from "../application/beta-infrastructure.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  parsePath,
  parseHeaders,
  parseJsonBody,
  validatedJsonResponse,
  dataEnvelope,
} from "../transport/http.js";
export function registerBetaInfrastructureRoutes(
  app: Hono<ApiEnvironment>,
  application?: Pick<BetaInfrastructureApplication, "propose">,
  jobs?: BetaInfrastructureJobs,
) {
  const requireJobs = () => {
    if (!jobs)
      throw new ApplicationError(
        "service_unavailable",
        "Background AI proposals are not enabled.",
      );
    return jobs;
  };
  app.post(
    "/v1/projects/:projectId/beta-infrastructure-jobs",
    async (context) => {
      const { projectId } = parsePath(context, projectPathV1Schema);
      const headers = parseHeaders(
        context,
        consequentialMutationHeadersV1Schema,
        ["if-match", "idempotency-key"],
      );
      const request = await parseJsonBody(
        context,
        createBetaInfrastructureProposalV1Schema,
      );
      return validatedJsonResponse(
        betaInfrastructureJobResponseV1Schema,
        dataEnvelope(
          await requireJobs().create(
            context.get("principal"),
            projectId,
            request,
            headers["if-match"],
            headers["idempotency-key"],
          ),
        ),
        202,
      );
    },
  );
  app.get(
    "/v1/projects/:projectId/beta-infrastructure-jobs/:jobId",
    async (context) => {
      const { projectId, jobId } = parsePath(
        context,
        betaInfrastructureJobPathV1Schema,
      );
      return validatedJsonResponse(
        betaInfrastructureJobResponseV1Schema,
        dataEnvelope(
          await requireJobs().get(context.get("principal"), projectId, jobId),
        ),
        200,
      );
    },
  );
  app.get(
    "/v1/projects/:projectId/beta-infrastructure-jobs/:jobId/credits",
    async (context) => {
      const { projectId, jobId } = parsePath(
        context,
        betaInfrastructureJobPathV1Schema,
      );
      return validatedJsonResponse(
        betaInfrastructureJobCreditsResponseV1Schema,
        dataEnvelope(
          await requireJobs().credits(
            context.get("principal"),
            projectId,
            jobId,
          ),
        ),
        200,
      );
    },
  );
  app.delete(
    "/v1/projects/:projectId/beta-infrastructure-jobs/:jobId",
    async (context) => {
      const { projectId, jobId } = parsePath(
        context,
        betaInfrastructureJobPathV1Schema,
      );
      return validatedJsonResponse(
        betaInfrastructureJobResponseV1Schema,
        dataEnvelope(
          await requireJobs().cancel(
            context.get("principal"),
            projectId,
            jobId,
          ),
        ),
        200,
      );
    },
  );
  app.post(
    "/v1/projects/:projectId/beta-infrastructure-proposals",
    async (context) => {
      if (application === undefined)
        throw new ApplicationError(
          "service_unavailable",
          "AI diagram proposals are not enabled.",
        );
      const { projectId } = parsePath(context, projectPathV1Schema);
      const headers = parseHeaders(context, preconditionHeadersV1Schema, [
        "if-match",
      ]);
      const request = await parseJsonBody(
        context,
        createBetaInfrastructureProposalV1Schema,
      );
      const result = await application.propose(
        context.get("principal"),
        projectId,
        request,
        headers["if-match"],
        context.req.raw.signal,
      );
      return validatedJsonResponse(
        betaInfrastructureProposalResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );
}
