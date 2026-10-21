import {
  accountWorkspaceResponseV1Schema,
  organizationPathV1Schema,
  accountWorkspaceListResponseV1Schema,
  accountWorkspaceListQueryV1Schema,
  createAccountOrganizationV1Schema,
  createPersonalWorkspaceV1Schema,
  idempotencyHeadersV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";
import type { AccountWorkspacesApplication } from "../application/account-workspaces.js";
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
export interface AccountWorkspacesConfiguration {
  readonly application: AccountWorkspacesApplication;
  readonly publicOrigin: string;
  /** Trusted server composition only; requests cannot select transport mode. */
  readonly mode?: "hosted-cognito" | "local-owner";
}
export function registerAccountWorkspaceRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: AccountWorkspacesConfiguration,
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
      throw new TypeError("Account workspaces require an exact HTTPS origin.");
  }
  function configured() {
    if (!configuration)
      throw new ApplicationError(
        "service_unavailable",
        "Account workspaces are temporarily unavailable.",
      );
    return configuration.application;
  }
  function mutation(context: ApiContext) {
    configured();
    const site = context.req.header("sec-fetch-site");
    if (
      context.req.header("origin") !== configuration?.publicOrigin ||
      (site !== undefined && site !== "same-origin")
    )
      throw new ApplicationError(
        "access_denied",
        "The request must come from this application.",
      );
  }
  app.get("/v1/account/workspaces/:organizationId", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    return validatedJsonResponse(
      accountWorkspaceResponseV1Schema,
      dataEnvelope(
        await configured().get(context.get("principal"), path.organizationId),
      ),
      200,
    );
  });
  app.get("/v1/account/workspaces", async (context) => {
    const query = parseQuery(context, accountWorkspaceListQueryV1Schema);
    const result = await configured().list(
      context.get("principal"),
      pageOptions(query),
    );
    return validatedJsonResponse(
      accountWorkspaceListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });
  app.post("/v1/account/organizations", async (context) => {
    mutation(context);
    const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
      "idempotency-key",
    ]);
    const body = await parseJsonBody(
      context,
      createAccountOrganizationV1Schema,
    );
    const result = await configured().createOrganization(
      context.get("principal"),
      body,
      headers["idempotency-key"],
    );
    return validatedJsonResponse(
      accountWorkspaceResponseV1Schema,
      dataEnvelope(result),
      201,
    );
  });
  app.post("/v1/account/personal-workspace", async (context) => {
    mutation(context);
    await parseJsonBody(context, createPersonalWorkspaceV1Schema);
    const result = await configured().createPersonal(context.get("principal"));
    return validatedJsonResponse(
      accountWorkspaceResponseV1Schema,
      dataEnvelope(result),
      200,
    );
  });
}
