import {
  currentPrincipalResponseV1Schema,
  preconditionHeadersV1Schema,
  presentationPreferencesResponseV1Schema,
  updatePresentationPreferencesV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { CloudMarkupApplication } from "../application/ports.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parseHeaders,
  parseJsonBody,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerIdentityRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.get("/v1/me", async (context) => {
    const principal = await application.getCurrentPrincipal(
      context.get("principal"),
    );
    return validatedJsonResponse(
      currentPrincipalResponseV1Schema,
      dataEnvelope(principal),
      200,
    );
  });

  app.get("/v1/me/presentation-preferences", async (context) => {
    const result = await application.getPresentationPreferences(
      context.get("principal"),
    );
    return validatedJsonResponse(
      presentationPreferencesResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.put("/v1/me/presentation-preferences", async (context) => {
    const headers = parseHeaders(context, preconditionHeadersV1Schema, [
      "if-match",
    ]);
    const input = await parseJsonBody(
      context,
      updatePresentationPreferencesV1Schema,
    );
    const result = await application.updatePresentationPreferences(
      context.get("principal"),
      input,
      headers["if-match"],
    );
    return validatedJsonResponse(
      presentationPreferencesResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });
}
