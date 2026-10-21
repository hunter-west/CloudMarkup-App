import {
  integrationListQueryV1Schema,
  integrationListResponseV1Schema,
  organizationPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { CloudMarkupApplication } from "../application/ports.js";
import {
  type ApiEnvironment,
  listEnvelope,
  pageOptions,
  parsePath,
  parseQuery,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerIntegrationRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.get("/v1/organizations/:organizationId/integrations", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    const query = parseQuery(context, integrationListQueryV1Schema);
    const result = await application.listIntegrations(
      context.get("principal"),
      path.organizationId,
      pageOptions(query),
    );
    return validatedJsonResponse(
      integrationListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });
}
