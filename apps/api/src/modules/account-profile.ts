import {
  accountProfileResponseV1Schema,
  updateAccountProfileV1Schema,
  preconditionHeadersV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { AccountProfileApplication } from "../application/account-profile.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parseHeaders,
  parseJsonBody,
  validatedJsonResponse,
} from "../transport/http.js";
export interface AccountProfileConfiguration {
  readonly application: AccountProfileApplication;
  readonly publicOrigin: string;
  /** Trusted server composition only; requests cannot select transport mode. */
  readonly mode?: "hosted-cognito" | "local-owner";
}
export function registerAccountProfileRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: AccountProfileConfiguration,
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
      throw new TypeError("Account profiles require an exact HTTPS origin.");
  }
  function service() {
    if (!configuration)
      throw new ApplicationError(
        "service_unavailable",
        "Account profiles are temporarily unavailable.",
      );
    return configuration.application;
  }
  app.get("/v1/account/profile", async (context) => {
    const result = await service().get(context.get("principal"));
    return validatedJsonResponse(
      accountProfileResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });
  app.put("/v1/account/profile", async (context) => {
    const application = service();
    const site = context.req.header("sec-fetch-site");
    if (
      context.req.header("origin") !== configuration?.publicOrigin ||
      (site !== undefined && site !== "same-origin")
    )
      throw new ApplicationError(
        "access_denied",
        "The request must come from this application.",
      );
    const headers = parseHeaders(context, preconditionHeadersV1Schema, [
      "if-match",
    ]);
    const input = await parseJsonBody(context, updateAccountProfileV1Schema);
    const result = await application.update(
      context.get("principal"),
      input,
      headers["if-match"],
    );
    return validatedJsonResponse(
      accountProfileResponseV1Schema,
      dataEnvelope(result.value),
      200,
      { ETag: result.etag },
    );
  });
}
