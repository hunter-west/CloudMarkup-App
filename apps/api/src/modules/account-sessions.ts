import {
  accountSessionListResponseV1Schema,
  accountSessionListQueryV1Schema,
  changeAccountSessionsV1Schema,
  accountSessionChangeResponseV1Schema,
  idempotencyHeadersV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { AccountSessionsApplication } from "../application/account-sessions.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  type ApiContext,
  dataEnvelope,
  listEnvelope,
  pageOptions,
  parseQuery,
  parseHeaders,
  parseJsonBody,
  validatedJsonResponse,
} from "../transport/http.js";
export interface AccountSessionsConfiguration {
  readonly application: AccountSessionsApplication;
  readonly publicOrigin: string;
  /** Hosted remains HTTPS by default; local owner permits exact loopback. */
  readonly mode?: "hosted-cognito" | "local-owner";
}
export function registerAccountSessionsRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: AccountSessionsConfiguration,
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
      origin.origin !== configuration.publicOrigin ||
      origin.username ||
      origin.password ||
      (mode !== undefined &&
        mode !== "hosted-cognito" &&
        mode !== "local-owner")
    )
      throw new TypeError(
        localOwner
          ? "Account sessions require an exact loopback origin."
          : "Account sessions require an exact HTTPS origin.",
      );
  }
  const service = () => {
    if (!configuration)
      throw new ApplicationError(
        "service_unavailable",
        "Session management is temporarily unavailable.",
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
        "The session request is invalid.",
      );
  };
  app.get("/v1/account/sessions", async (context) => {
    query(context, true);
    const result = await service().list(
      context.get("principal"),
      pageOptions(parseQuery(context, accountSessionListQueryV1Schema)),
    );
    return validatedJsonResponse(
      accountSessionListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });
  app.post("/v1/account/session-changes", async (context) => {
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
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const input = await parseJsonBody(context, changeAccountSessionsV1Schema);
    const receipt = await application.change(
      context.get("principal"),
      input,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      accountSessionChangeResponseV1Schema,
      dataEnvelope(receipt),
      200,
    );
  });
}
