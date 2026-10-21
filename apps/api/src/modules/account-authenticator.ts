import {
  accountCredentialHeadersV1Schema,
  accountAuthenticatorStateResponseV1Schema,
  accountAuthenticatorStartResponseV1Schema,
  accountAuthenticatorChangeResponseV1Schema,
  startAccountAuthenticatorV1Schema,
  changeAccountAuthenticatorV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { AccountAuthenticatorApplication } from "../application/account-authenticator.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  type ApiContext,
  dataEnvelope,
  parseJsonBody,
  parseHeaders,
  validatedJsonResponse,
} from "../transport/http.js";
export interface AccountAuthenticatorConfiguration {
  readonly application: AccountAuthenticatorApplication;
  readonly publicOrigin: string;
}
export function registerAccountAuthenticatorRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: AccountAuthenticatorConfiguration,
): void {
  if (configuration) {
    const origin = new URL(configuration.publicOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== configuration.publicOrigin ||
      origin.username ||
      origin.password
    )
      throw new TypeError(
        "Authenticator controls require an exact HTTPS origin.",
      );
  }
  function service() {
    if (!configuration)
      throw new ApplicationError(
        "service_unavailable",
        "Authenticator controls are temporarily unavailable.",
      );
    return configuration.application;
  }
  function query(context: ApiContext) {
    if (new URL(context.req.url).search)
      throw new ApplicationError(
        "invalid_request",
        "The authenticator request is invalid.",
      );
  }
  function bound(context: ApiContext, id: string) {
    if (id !== context.get("principal").principalId)
      throw new ApplicationError(
        "service_unavailable",
        "Authenticator settings could not be confirmed.",
      );
  }
  function admitChange(context: ApiContext) {
    query(context);
    const application = service(),
      site = context.req.header("sec-fetch-site");
    if (
      context.req.header("origin") !== configuration?.publicOrigin ||
      (site !== undefined && site !== "same-origin")
    )
      throw new ApplicationError(
        "access_denied",
        "The request must come from this application.",
      );
    const headers = parseHeaders(context, accountCredentialHeadersV1Schema, [
      "x-cloudmarkup-account",
    ]);
    if (
      headers["x-cloudmarkup-account"] !== context.get("principal").principalId
    )
      throw new ApplicationError(
        "access_denied",
        "The signed-in account changed. Reopen Security before trying again.",
      );
    return application;
  }
  app.get("/v1/account/authenticator", async (context) => {
    query(context);
    const state = await service().read(
      context.get("principal"),
      context.req.header("authorization"),
    );
    bound(context, state.principalId);
    return validatedJsonResponse(
      accountAuthenticatorStateResponseV1Schema,
      dataEnvelope(state),
      200,
    );
  });
  app.post("/v1/account/authenticator-enrollments", async (context) => {
    const application = admitChange(context),
      input = await parseJsonBody(context, startAccountAuthenticatorV1Schema);
    const result = await application.start(
      context.get("principal"),
      context.req.header("authorization"),
      input,
    );
    bound(context, result.principalId);
    if (result.attemptId !== input.attemptId)
      throw new ApplicationError(
        "service_unavailable",
        "The authenticator setup could not be confirmed.",
      );
    return validatedJsonResponse(
      accountAuthenticatorStartResponseV1Schema,
      dataEnvelope(result),
      200,
    );
  });
  app.post("/v1/account/authenticator-changes", async (context) => {
    const application = admitChange(context),
      input = await parseJsonBody(context, changeAccountAuthenticatorV1Schema);
    const result = await application.change(
      context.get("principal"),
      context.req.header("authorization"),
      input,
    );
    bound(context, result.principalId);
    if (result.attemptId !== input.attemptId || result.action !== input.action)
      throw new ApplicationError(
        "service_unavailable",
        "The authenticator change could not be confirmed.",
      );
    return validatedJsonResponse(
      accountAuthenticatorChangeResponseV1Schema,
      dataEnvelope(result),
      200,
    );
  });
}
