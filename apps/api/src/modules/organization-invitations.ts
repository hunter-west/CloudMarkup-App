import {
  acceptOrganizationInvitationV1Schema,
  acceptedOrganizationInvitationResponseV1Schema,
  createOrganizationInvitationV1Schema,
  idempotencyHeadersV1Schema,
  organizationInvitationManagementPathV1Schema,
  organizationInvitationPathV1Schema,
  organizationInvitationResponseV1Schema,
  organizationPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import { ApplicationError } from "../application/errors.js";
import type { OrganizationInvitationApplication } from "../application/organization-invitations.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parseHeaders,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

export type OrganizationInvitationPort = Pick<
  OrganizationInvitationApplication,
  "create" | "revoke" | "accept"
>;

function invalid(): never {
  throw new ApplicationError(
    "invalid_request",
    "The invitation request is invalid.",
  );
}

export function registerOrganizationInvitationRoutes(
  app: Hono<ApiEnvironment>,
  application?: OrganizationInvitationPort,
): void {
  const configured = (): OrganizationInvitationPort => {
    if (application === undefined)
      throw new ApplicationError(
        "service_unavailable",
        "Organization invitations are not configured.",
      );
    return application;
  };
  // No query keys (even malformed secret-bearing names) enter diagnostics.
  const checkQuery = (url: string) => {
    if (new URL(url).search !== "") invalid();
  };
  app.post("/v1/organizations/:organizationId/invitations", async (context) => {
    checkQuery(context.req.url);
    const path = parsePath(context, organizationPathV1Schema);
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const input = await parseJsonBody(
      context,
      createOrganizationInvitationV1Schema,
    );
    const result = await configured().create(
      context.get("principal"),
      path.organizationId,
      input,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      organizationInvitationResponseV1Schema,
      dataEnvelope(result),
      201,
    );
  });
  app.delete(
    "/v1/organizations/:organizationId/invitations/:invitationId",
    async (context) => {
      checkQuery(context.req.url);
      if (context.req.raw.body !== null) invalid();
      const path = parsePath(
        context,
        organizationInvitationManagementPathV1Schema,
      );
      const result = await configured().revoke(
        context.get("principal"),
        path.organizationId,
        path.invitationId,
      );
      return validatedJsonResponse(
        organizationInvitationResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );
  app.post(
    "/v1/organization-invitations/:invitationId/accept",
    async (context) => {
      checkQuery(context.req.url);
      const path = parsePath(context, organizationInvitationPathV1Schema);
      const input = await parseJsonBody(
        context,
        acceptOrganizationInvitationV1Schema,
      );
      const result = await configured().accept(
        context.get("principal"),
        path.invitationId,
        input,
      );
      return validatedJsonResponse(
        acceptedOrganizationInvitationResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );
}
