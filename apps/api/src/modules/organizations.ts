import {
  consequentialMutationHeadersV1Schema,
  membershipListQueryV1Schema,
  membershipListResponseV1Schema,
  organizationListQueryV1Schema,
  organizationListResponseV1Schema,
  organizationPathV1Schema,
  organizationResponseV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { CloudMarkupApplication } from "../application/ports.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  listEnvelope,
  pageOptions,
  parseHeaders,
  parsePath,
  parseQuery,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerOrganizationRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.get("/v1/organizations", async (context) => {
    const query = parseQuery(context, organizationListQueryV1Schema);
    const result = await application.listOrganizations(
      context.get("principal"),
      pageOptions(query),
    );
    return validatedJsonResponse(
      organizationListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });

  app.get("/v1/organizations/:organizationId", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    const result = await application.getOrganization(
      context.get("principal"),
      path.organizationId,
    );
    return validatedJsonResponse(
      organizationResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.delete("/v1/organizations/:organizationId", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    const headers = parseHeaders(
      context,
      consequentialMutationHeadersV1Schema,
      ["idempotency-key", "if-match"],
    );
    const result = await application.deleteOrganization(
      context.get("principal"),
      path.organizationId,
      headers["if-match"],
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      organizationResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });

  app.get("/v1/organizations/:organizationId/memberships", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    const query = parseQuery(context, membershipListQueryV1Schema);
    const result = await application.listMemberships(
      context.get("principal"),
      path.organizationId,
      pageOptions(query),
    );
    return validatedJsonResponse(
      membershipListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });
}
