import {
  acknowledgeAiIntentPreviewV1Schema,
  aiIntentPreviewAcknowledgementResponseV1Schema,
  projectPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { AiIntentPreviewAcknowledgementPortV1 } from "../application/ai-intent-preview-acknowledgements.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerAiIntentPreviewAcknowledgementRoutes(
  app: Hono<ApiEnvironment>,
  port?: AiIntentPreviewAcknowledgementPortV1,
): void {
  app.post(
    "/v1/projects/:projectId/ai-intent-previews/acknowledgement",
    async (context) => {
      const path = parsePath(context, projectPathV1Schema);
      // Do not use the shared duplicate-query diagnostic here: a malformed
      // client can put a delivery/tab proof in a parameter NAME, which that
      // diagnostic would echo. This body-only protocol has no query fields.
      if (new URL(context.req.url).search !== "")
        throw new ApplicationError(
          "invalid_request",
          "The preview acknowledgement request is invalid.",
        );
      const input = await parseJsonBody(
        context,
        acknowledgeAiIntentPreviewV1Schema,
      );
      if (port === undefined)
        throw new ApplicationError(
          "service_unavailable",
          "AI preview acknowledgements are not configured.",
        );
      const receipt = await port.acknowledge(
        context.get("principal"),
        path.projectId,
        input,
      );
      return validatedJsonResponse(
        aiIntentPreviewAcknowledgementResponseV1Schema,
        dataEnvelope(receipt),
        200,
      );
    },
  );
}
