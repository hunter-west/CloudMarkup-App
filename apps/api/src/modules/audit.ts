import {
  auditEventListQueryV1Schema,
  auditEventSummaryListResponseV1Schema,
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

export function registerAuditRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.get("/v1/organizations/:organizationId/audit-events", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    const query = parseQuery(context, auditEventListQueryV1Schema);
    const result = await application.listAuditEvents(
      context.get("principal"),
      path.organizationId,
      pageOptions(query),
    );
    return validatedJsonResponse(
      auditEventSummaryListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });
}
