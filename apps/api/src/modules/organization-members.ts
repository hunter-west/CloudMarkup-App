import {
  organizationMemberResponseV1Schema,
  organizationMemberListResponseV1Schema,
  organizationMemberListQueryV1Schema,
  changeOrganizationMembershipV1Schema,
  organizationMembershipReceiptResponseV1Schema,
  organizationPathV1Schema,
  consequentialMutationHeadersV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { OrganizationMembersApplication } from "../application/organization-members.js";
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
export interface OrganizationMembersConfiguration {
  readonly application: OrganizationMembersApplication;
  readonly publicOrigin: string;
  /** Trusted server composition only; requests cannot select transport mode. */
  readonly mode?: "hosted-cognito" | "local-owner";
}
export function registerOrganizationMembersRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: OrganizationMembersConfiguration,
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
      throw new TypeError("Member changes require an exact HTTPS origin.");
  }
  const service = () => {
    if (!configuration)
      throw new ApplicationError(
        "service_unavailable",
        "Member management is temporarily unavailable.",
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
        "The membership request is invalid.",
      );
  };
  app.get("/v1/organizations/:organizationId/members", async (context) => {
    query(context, true);
    const path = parsePath(context, organizationPathV1Schema);
    const page = parseQuery(context, organizationMemberListQueryV1Schema);
    const result = await service().list(
      context.get("principal"),
      path.organizationId,
      pageOptions(page),
    );
    return validatedJsonResponse(
      organizationMemberListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });
  app.get(
    "/v1/account/workspaces/:organizationId/membership",
    async (context) => {
      query(context);
      const path = parsePath(context, organizationPathV1Schema);
      const result = await service().own(
        context.get("principal"),
        path.organizationId,
      );
      return validatedJsonResponse(
        organizationMemberResponseV1Schema,
        dataEnvelope(result.value),
        200,
        { ETag: result.etag },
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/membership-changes",
    async (context) => {
      const application = service();
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
      const path = parsePath(context, organizationPathV1Schema),
        headers = parseHeaders(context, consequentialMutationHeadersV1Schema, [
          "idempotency-key",
          "if-match",
        ]);
      const input = await parseJsonBody(
        context,
        changeOrganizationMembershipV1Schema,
      );
      const result = await application.change(
        context.get("principal"),
        path.organizationId,
        input,
        headers["if-match"],
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        organizationMembershipReceiptResponseV1Schema,
        dataEnvelope(result),
        200,
      );
    },
  );
}
