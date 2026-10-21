import {
  acceptedOrganizationInvitationResponseV1Schema,
  createRecipientOrganizationInvitationV1Schema,
  recipientOrganizationInvitationResponseV1Schema,
  recipientOrganizationInvitationListResponseV1Schema,
  recipientOrganizationInvitationListQueryV1Schema,
  decideRecipientOrganizationInvitationV1Schema,
  organizationInvitationPathV1Schema,
  organizationPathV1Schema,
  idempotencyHeadersV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { RecipientOrganizationInvitationApplication } from "../application/recipient-organization-invitations.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  type ApiContext,
  dataEnvelope,
  listEnvelope,
  pageOptions,
  parseQuery,
  parsePath,
  parseHeaders,
  parseJsonBody,
  validatedJsonResponse,
} from "../transport/http.js";
export interface RecipientOrganizationInvitationConfiguration {
  readonly application: RecipientOrganizationInvitationApplication;
  readonly publicOrigin: string;
  /** Trusted server composition only; requests cannot select transport mode. */
  readonly mode?: "hosted-cognito" | "local-owner";
}
export function registerRecipientOrganizationInvitationRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: RecipientOrganizationInvitationConfiguration,
): void {
  if (configuration) {
    const url = new URL(configuration.publicOrigin);
    const mode: unknown = configuration.mode;
    const localOwner = mode === "local-owner";
    if (
      (localOwner
        ? url.hostname !== "127.0.0.1" ||
          !["http:", "https:"].includes(url.protocol)
        : url.protocol !== "https:") ||
      (mode !== undefined &&
        mode !== "hosted-cognito" &&
        mode !== "local-owner") ||
      url.origin !== configuration.publicOrigin ||
      url.username ||
      url.password
    )
      throw new TypeError(
        "Recipient invitations require an exact HTTPS origin.",
      );
  }
  const configured = () => {
    if (!configuration)
      throw new ApplicationError(
        "service_unavailable",
        "Organization invitations are temporarily unavailable.",
      );
    return configuration.application;
  };
  const query = (context: ApiContext, paginated = false) => {
    const params = new URL(context.req.url).searchParams;
    if (
      [...params.keys()].some(
        (key) =>
          !paginated ||
          !["page[cursor]", "page[limit]"].includes(key) ||
          params.getAll(key).length !== 1,
      )
    )
      throw new ApplicationError(
        "invalid_request",
        "The invitation request is invalid.",
      );
  };
  const mutation = (context: ApiContext) => {
    configured();
    query(context);
    const site = context.req.header("sec-fetch-site");
    if (
      context.req.header("origin") !== configuration?.publicOrigin ||
      (site !== undefined && site !== "same-origin")
    )
      throw new ApplicationError(
        "access_denied",
        "The request must come from this application.",
      );
  };
  app.get(
    "/v1/organizations/:organizationId/member-invitations",
    async (context) => {
      query(context, true);
      const path = parsePath(context, organizationPathV1Schema),
        input = parseQuery(
          context,
          recipientOrganizationInvitationListQueryV1Schema,
        );
      const result = await configured().listForOrganization(
        context.get("principal"),
        path.organizationId,
        pageOptions(input),
      );
      return validatedJsonResponse(
        recipientOrganizationInvitationListResponseV1Schema,
        listEnvelope(result.items, result.nextCursor),
        200,
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/member-invitations",
    async (context) => {
      mutation(context);
      const path = parsePath(context, organizationPathV1Schema),
        headers = parseHeaders(context, idempotencyHeadersV1Schema, [
          "idempotency-key",
        ]),
        input = await parseJsonBody(
          context,
          createRecipientOrganizationInvitationV1Schema,
        );
      const result = await configured().createForRecipient(
        context.get("principal"),
        path.organizationId,
        input,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        recipientOrganizationInvitationResponseV1Schema,
        dataEnvelope(result),
        201,
      );
    },
  );
  app.get("/v1/account/invitations", async (context) => {
    query(context, true);
    const input = parseQuery(
      context,
      recipientOrganizationInvitationListQueryV1Schema,
    );
    const result = await configured().listForRecipient(
      context.get("principal"),
      pageOptions(input),
    );
    return validatedJsonResponse(
      recipientOrganizationInvitationListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });
  app.post("/v1/account/invitations/:invitationId/accept", async (context) => {
    mutation(context);
    const path = parsePath(context, organizationInvitationPathV1Schema);
    await parseJsonBody(context, decideRecipientOrganizationInvitationV1Schema);
    const result = await configured().acceptForRecipient(
      context.get("principal"),
      path.invitationId,
    );
    return validatedJsonResponse(
      acceptedOrganizationInvitationResponseV1Schema,
      dataEnvelope(result),
      200,
    );
  });
  app.post("/v1/account/invitations/:invitationId/decline", async (context) => {
    mutation(context);
    const path = parsePath(context, organizationInvitationPathV1Schema);
    await parseJsonBody(context, decideRecipientOrganizationInvitationV1Schema);
    const result = await configured().declineForRecipient(
      context.get("principal"),
      path.invitationId,
    );
    return validatedJsonResponse(
      recipientOrganizationInvitationResponseV1Schema,
      dataEnvelope(result),
      200,
    );
  });
}
