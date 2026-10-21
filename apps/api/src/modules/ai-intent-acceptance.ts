import {
  acceptAiIntentPreviewV1Schema,
  acceptedIntentPathV1Schema,
  acceptedIntentResponseV1Schema,
  aiIntentPreviewAcceptanceHeadersV1Schema,
  projectPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { AiIntentAcceptancePortV1 } from "../application/ai-intent-acceptance.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiContext,
  type ApiEnvironment,
  dataEnvelope,
  parseHeaders,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

function requireNoQuery(context: ApiContext): void {
  if (new URL(context.req.url).search !== "")
    throw new ApplicationError(
      "invalid_request",
      "The Intent request is invalid.",
    );
}
function requirePort(
  port?: AiIntentAcceptancePortV1,
): AiIntentAcceptancePortV1 {
  if (port === undefined)
    throw new ApplicationError(
      "service_unavailable",
      "Accepted requirements are unavailable.",
    );
  return port;
}

export function registerAiIntentAcceptanceRoutes(
  app: Hono<ApiEnvironment>,
  port?: AiIntentAcceptancePortV1,
): void {
  app.post(
    "/v1/projects/:projectId/ai-intent-previews/acceptance",
    async (context) => {
      const path = parsePath(context, projectPathV1Schema);
      requireNoQuery(context);
      const headers = parseHeaders(
        context,
        aiIntentPreviewAcceptanceHeadersV1Schema,
        ["if-match", "idempotency-key"],
      );
      const input = await parseJsonBody(context, acceptAiIntentPreviewV1Schema);
      const accepted = await requirePort(port).accept(
        context.get("principal"),
        path.projectId,
        input,
        headers["if-match"],
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        acceptedIntentResponseV1Schema,
        dataEnvelope(accepted),
        200,
      );
    },
  );
  app.get(
    "/v1/projects/:projectId/accepted-intents/:acceptedIntentId",
    async (context) => {
      const path = parsePath(context, acceptedIntentPathV1Schema);
      requireNoQuery(context);
      const accepted = await requirePort(port).get(
        context.get("principal"),
        path.projectId,
        path.acceptedIntentId,
      );
      return validatedJsonResponse(
        acceptedIntentResponseV1Schema,
        dataEnvelope(accepted),
        200,
      );
    },
  );
}
