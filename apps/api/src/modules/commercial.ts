import {
  creditBalanceResponseV1Schema,
  creditOverviewResponseV1Schema,
  creditOverviewQueryV1Schema,
  currentPlanEntitlementsResponseV1Schema,
  organizationPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import { ApplicationError } from "../application/errors.js";
import type { CloudMarkupApplication } from "../application/ports.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parsePath,
  parseQuery,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerCommercialRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.get(
    "/v1/organizations/:organizationId/commercial/current-plan",
    async (context) => {
      const path = parsePath(context, organizationPathV1Schema);
      const summary = await application.getCurrentPlanEntitlements(
        context.get("principal"),
        path.organizationId,
      );
      return validatedJsonResponse(
        currentPlanEntitlementsResponseV1Schema,
        dataEnvelope(summary),
        200,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/commercial/credit-overview",
    async (context) => {
      const path = parsePath(context, organizationPathV1Schema);
      parseQuery(context, creditOverviewQueryV1Schema);
      const summary = await application.getCreditOverview(
        context.get("principal"),
        path.organizationId,
      );
      if (summary.balance.organizationId !== path.organizationId)
        throw new ApplicationError(
          "service_unavailable",
          "The credit summary is unavailable.",
        );
      return validatedJsonResponse(
        creditOverviewResponseV1Schema,
        dataEnvelope(summary),
        200,
      );
    },
  );
  app.get(
    "/v1/organizations/:organizationId/commercial/credit-balance",
    async (context) => {
      const path = parsePath(context, organizationPathV1Schema);
      const summary = await application.getCreditBalance(
        context.get("principal"),
        path.organizationId,
      );
      return validatedJsonResponse(
        creditBalanceResponseV1Schema,
        dataEnvelope(summary),
        200,
      );
    },
  );
}
