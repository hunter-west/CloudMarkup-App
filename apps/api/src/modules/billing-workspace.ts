import {
  billingWorkspaceResponseV1Schema,
  creditTopUpWorkspaceResponseV1Schema,
  createCreditTopUpV1Schema,
  createBillingCheckoutV1Schema,
  createBillingPortalV1Schema,
  hostedBillingSessionResponseV1Schema,
  idempotencyHeadersV1Schema,
  organizationPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { BillingWorkspaceApplication } from "../application/billing-workspace.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiEnvironment,
  type ApiContext,
  dataEnvelope,
  parseHeaders,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

export interface BillingWorkspaceConfiguration {
  readonly application: BillingWorkspaceApplication;
  readonly publicOrigin: string;
}

export function registerBillingWorkspaceRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: BillingWorkspaceConfiguration,
): void {
  if (configuration !== undefined) {
    const origin = new URL(configuration.publicOrigin);
    if (
      origin.origin !== configuration.publicOrigin ||
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password
    )
      throw new TypeError("Billing requires one exact HTTPS public origin.");
  }
  function application() {
    if (configuration === undefined)
      throw new ApplicationError(
        "service_unavailable",
        "Sandbox billing is not configured.",
      );
    return configuration.application;
  }
  function requireOrigin(context: ApiContext) {
    application();
    const site = context.req.header("sec-fetch-site");
    if (
      context.req.header("origin") !== configuration?.publicOrigin ||
      (site !== undefined && site !== "same-origin")
    )
      throw new ApplicationError(
        "access_denied",
        "Open billing from the signed-in application.",
      );
  }
  app.get("/v1/organizations/:organizationId/billing", async (context) => {
    const path = parsePath(context, organizationPathV1Schema);
    const value = await application().getWorkspace(
      context.get("principal"),
      path.organizationId,
    );
    return validatedJsonResponse(
      billingWorkspaceResponseV1Schema,
      dataEnvelope(value),
      200,
    );
  });
  app.post(
    "/v1/organizations/:organizationId/billing/checkout-sessions",
    async (context) => {
      requireOrigin(context);
      const path = parsePath(context, organizationPathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      const input = await parseJsonBody(context, createBillingCheckoutV1Schema);
      const value = await application().createCheckout(
        context.get("principal"),
        path.organizationId,
        input,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        hostedBillingSessionResponseV1Schema,
        dataEnvelope(value),
        201,
      );
    },
  );
  app.get(
    "/v1/organizations/:organizationId/billing/credit-top-ups",
    async (context) => {
      const path = parsePath(context, organizationPathV1Schema),
        billing = application();
      if (billing.getCreditTopUps === undefined)
        throw new ApplicationError(
          "service_unavailable",
          "Credit packs are unavailable.",
        );
      return validatedJsonResponse(
        creditTopUpWorkspaceResponseV1Schema,
        dataEnvelope(
          await billing.getCreditTopUps(
            context.get("principal"),
            path.organizationId,
          ),
        ),
        200,
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/billing/credit-top-ups/checkout-sessions",
    async (context) => {
      requireOrigin(context);
      const path = parsePath(context, organizationPathV1Schema),
        headers = parseHeaders(context, idempotencyHeadersV1Schema, [
          "idempotency-key",
        ]);
      const input = await parseJsonBody(context, createCreditTopUpV1Schema),
        billing = application();
      if (billing.createCreditTopUp === undefined)
        throw new ApplicationError(
          "service_unavailable",
          "Credit purchases are unavailable.",
        );
      return validatedJsonResponse(
        hostedBillingSessionResponseV1Schema,
        dataEnvelope(
          await billing.createCreditTopUp(
            context.get("principal"),
            path.organizationId,
            input,
            headers["idempotency-key"],
          ),
        ),
        201,
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/billing/portal-sessions",
    async (context) => {
      requireOrigin(context);
      const path = parsePath(context, organizationPathV1Schema);
      const headers = parseHeaders(context, idempotencyHeadersV1Schema, [
        "idempotency-key",
      ]);
      await parseJsonBody(context, createBillingPortalV1Schema);
      const value = await application().createPortal(
        context.get("principal"),
        path.organizationId,
        headers["idempotency-key"],
      );
      return validatedJsonResponse(
        hostedBillingSessionResponseV1Schema,
        dataEnvelope(value),
        201,
      );
    },
  );
}
