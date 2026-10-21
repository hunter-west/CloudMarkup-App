import {
  accountCredentialHeadersV1Schema,
  accountCredentialStateResponseV1Schema,
  accountCredentialResultResponseV1Schema,
  changeAccountCredentialsV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { AccountCredentialsApplication } from "../application/account-credentials.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  type ApiContext,
  dataEnvelope,
  parseJsonBody,
  parseHeaders,
  validatedJsonResponse,
} from "../transport/http.js";
export interface AccountCredentialsConfiguration {
  readonly application: AccountCredentialsApplication;
  readonly publicOrigin: string;
}
export function registerAccountCredentialsRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: AccountCredentialsConfiguration,
): void {
  if (configuration) {
    const origin = new URL(configuration.publicOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== configuration.publicOrigin ||
      origin.username ||
      origin.password
    )
      throw new TypeError("Account credentials require an exact HTTPS origin.");
  }
  const service = () => {
    if (!configuration)
      throw new ApplicationError(
        "service_unavailable",
        "Password and email controls are temporarily unavailable.",
      );
    return configuration.application;
  };
  const query = (context: ApiContext) => {
    if (new URL(context.req.url).search)
      throw new ApplicationError(
        "invalid_request",
        "The account security request is invalid.",
      );
  };
  const bound = (context: ApiContext, principalId: string) => {
    if (principalId !== context.get("principal").principalId)
      throw new ApplicationError(
        "service_unavailable",
        "Account security could not be confirmed.",
      );
  };
  app.get("/v1/account/credentials", async (context) => {
    query(context);
    const state = await service().read(
      context.get("principal"),
      context.req.header("authorization"),
    );
    bound(context, state.principalId);
    return validatedJsonResponse(
      accountCredentialStateResponseV1Schema,
      dataEnvelope(state),
      200,
    );
  });
  app.post("/v1/account/credential-changes", async (context) => {
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
        "The signed-in account changed. Reopen account security before trying again.",
      );
    const command = await parseJsonBody(
      context,
      changeAccountCredentialsV1Schema,
    );
    const result = await application.change(
      context.get("principal"),
      context.req.header("authorization"),
      command,
    );
    bound(context, result.principalId);
    if (
      result.attemptId !== command.attemptId ||
      result.action !== command.action
    )
      throw new ApplicationError(
        "service_unavailable",
        "The account security outcome could not be confirmed.",
      );
    return validatedJsonResponse(
      accountCredentialResultResponseV1Schema,
      dataEnvelope(result),
      200,
    );
  });
}
