import {
  staffAccessResponseV1Schema,
  staffAccountListResponseV1Schema,
  staffAccountSearchV1Schema,
  staffAccountDetailResponseV1Schema,
  staffAccountActionV1Schema,
  staffActionReceiptResponseV1Schema,
  preconditionHeadersV1Schema,
  idempotencyHeadersV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { StaffAccountsApplication } from "../application/staff-accounts.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  type ApiContext,
  dataEnvelope,
  parseQuery,
  parseHeaders,
  parseJsonBody,
  validatedJsonResponse,
} from "../transport/http.js";
export interface StaffAccountsConfiguration {
  readonly application: StaffAccountsApplication;
  readonly publicOrigin: string;
  /** Trusted server composition only; requests cannot select transport mode. */
  readonly mode?: "hosted-cognito" | "local-owner";
}
export function registerStaffAccountRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: StaffAccountsConfiguration,
): void {
  if (configuration) {
    const origin = new URL(configuration.publicOrigin);
    const mode: unknown = configuration.mode;
    const localOwner = mode === "local-owner";
    if (
      (localOwner
        ? origin.hostname !== "127.0.0.1" ||
          !["http:", "https:"].includes(origin.protocol)
        : origin.protocol !== "https:") ||
      (mode !== undefined &&
        mode !== "hosted-cognito" &&
        mode !== "local-owner") ||
      origin.origin !== configuration.publicOrigin ||
      origin.username ||
      origin.password
    )
      throw new TypeError("Staff accounts require an exact HTTPS origin.");
  }
  const service = () => {
    if (!configuration)
      throw new ApplicationError(
        "service_unavailable",
        "Staff accounts are unavailable.",
      );
    return configuration.application;
  };
  const query = (context: ApiContext, search = false) => {
    const params = new URL(context.req.url).searchParams;
    if (
      [...params.keys()].some(
        (key) =>
          !search ||
          !["q", "cursor"].includes(key) ||
          params.getAll(key).length !== 1,
      )
    )
      throw new ApplicationError(
        "invalid_request",
        "The staff account request is invalid.",
      );
  };
  app.get("/v1/staff/access", async (context) => {
    query(context);
    return validatedJsonResponse(
      staffAccessResponseV1Schema,
      dataEnvelope(await service().access(context.get("principal"))),
      200,
    );
  });
  app.get("/v1/staff/accounts", async (context) => {
    query(context, true);
    return validatedJsonResponse(
      staffAccountListResponseV1Schema,
      dataEnvelope(
        await service().search(
          context.get("principal"),
          parseQuery(context, staffAccountSearchV1Schema),
        ),
      ),
      200,
    );
  });
  app.get("/v1/staff/accounts/:organizationId", async (context) => {
    query(context);
    const result = await service().get(
      context.get("principal"),
      context.req.param("organizationId"),
    );
    return validatedJsonResponse(
      staffAccountDetailResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });
  app.post("/v1/staff/accounts/:organizationId/actions", async (context) => {
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
    const precondition = parseHeaders(context, preconditionHeadersV1Schema, [
        "if-match",
      ]),
      idempotency = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
    const input = await parseJsonBody(context, staffAccountActionV1Schema);
    const receipt = await application.act(
      context.get("principal"),
      context.req.param("organizationId"),
      input,
      precondition["if-match"],
      idempotency["idempotency-key"],
    );
    return validatedJsonResponse(
      staffActionReceiptResponseV1Schema,
      dataEnvelope(receipt),
      200,
    );
  });
}
