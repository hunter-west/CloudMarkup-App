import { randomUUID } from "node:crypto";
import { CREDIT_TOP_UP_PACKS_V1 } from "@cloudmarkup/domain";
import {
  creditTopUpWorkspaceV1Schema,
  hostedBillingSessionV1Schema,
  type CreditTopUpWorkspaceV1,
  type CreateCreditTopUpV1,
  type HostedBillingSessionV1,
} from "@cloudmarkup/api-contract";
import type {
  BillingConfiguration,
  BillingProvider,
} from "./application/billing.js";
import { BillingApplicationError } from "./application/billing-errors.js";
import {
  createGuardedCreditTopUp,
  topUpAccountEligible,
  type CreditTopUpProvider,
  type CreditTopUpPurchase,
} from "./application/billing-top-ups.js";
import {
  permissionsForRole,
  runSensitiveAction,
} from "./application/authorization.js";
import type { AuthorizedOrganizationScope } from "./application/persistence.js";
import type { PrincipalContext } from "./application/ports.js";
import { ApplicationError } from "./application/errors.js";
import { AuthorizedCommercialRequestDatabase } from "./production-commercial-authorization.js";
import { PostgresBillingPersistence } from "./adapters/persistence/billing-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./adapters/persistence/commercial-repositories.js";
import { PostgresCreditTopUpPersistence } from "./adapters/persistence/credit-top-up-persistence.js";
import { sql, type SqlDatabase } from "./adapters/persistence/sql.js";

interface TopUpWorkspaceOptions {
  readonly database: SqlDatabase;
  readonly clock?: () => Date;
  readonly sessions?: {
    readonly configuration: BillingConfiguration;
    readonly topUpsEnabled?: boolean;
    readonly createProvider: (
      authorizeBeforeRequest: () => Promise<void>,
    ) => BillingProvider;
  };
}
function translate(error: unknown): never {
  if (error instanceof ApplicationError) throw error;
  if (
    error instanceof BillingApplicationError &&
    error.code === "idempotency-conflict"
  )
    throw new ApplicationError(
      "conflict",
      "Resume the pending credit purchase or refresh its payment status.",
    );
  if (
    error instanceof BillingApplicationError &&
    error.code === "subscription-required"
  )
    throw new ApplicationError(
      "invalid_request",
      "An active subscription is required for credit top-ups.",
    );
  throw new ApplicationError(
    "service_unavailable",
    "Credit purchases are temporarily unavailable.",
  );
}
export function createProductionCreditTopUps(options: TopUpWorkspaceOptions): {
  getCreditTopUps(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<CreditTopUpWorkspaceV1>;
  createCreditTopUp(
    principal: PrincipalContext,
    organizationId: string,
    input: CreateCreditTopUpV1,
    idempotencyKey: string,
  ): Promise<HostedBillingSessionV1>;
} {
  const clock = options.clock ?? (() => new Date());
  const enabled =
    options.sessions?.topUpsEnabled === true &&
    ((options.sessions.configuration.mode === "stripe-sandbox" &&
      options.sessions.configuration.stripeEnvironment === "test") ||
      (options.sessions.configuration.mode === "stripe-live" &&
        options.sessions.configuration.stripeEnvironment === "live"));
  async function scope(
    database: AuthorizedCommercialRequestDatabase,
  ): Promise<AuthorizedOrganizationScope> {
    const context = await database.context();
    return {
      organizationId: context.organizationId,
      principalId: context.principal.principalId,
      membershipId: context.membershipId,
      sessionId: context.principal.sessionId,
      correlationId: context.correlationId,
      roleKey: context.role,
      capabilities: permissionsForRole(context.role),
    };
  }
  return {
    async getCreditTopUps(principal, organizationId) {
      try {
        const database = new AuthorizedCommercialRequestDatabase(
          options.database,
          principal,
          organizationId,
          "commercial.summary.read",
          clock,
        );
        const currentScope = await scope(database);
        const accounts = await database.query(
          sql(
            `SELECT a.billing_account_id,a.lifecycle_status,a.expensive_operations_enabled,s.normalized_status,s.provider_customer_reference
      FROM organization_billing_accounts a LEFT JOIN organization_subscription_projections s ON s.organization_id=a.organization_id AND s.billing_account_id=a.billing_account_id AND s.provider_environment=$2 WHERE a.organization_id=$1`,
            [
              organizationId,
              options.sessions?.configuration.stripeEnvironment ?? "test",
            ],
          ),
        );
        if (accounts.rows.length > 1) throw Error("Ambiguous billing account");
        const account = accounts.rows[0];
        const balance =
          account === undefined
            ? null
            : await new PostgresCommercialPersistenceRepository(
                database,
              ).getCreditBalance(currentScope);
        const purchases = await database.query(
          sql(
            `SELECT attempt_id,pack_key,lifecycle_status,review_reason FROM credit_top_up_attempts WHERE organization_id=$1 ORDER BY created_at DESC,attempt_id DESC LIMIT 1`,
            [organizationId],
          ),
        );
        const latest = purchases.rows[0];
        return creditTopUpWorkspaceV1Schema.parse({
          contractVersion: 1,
          organizationId,
          asOf: clock().toISOString(),
          mode: enabled ? options.sessions.configuration.mode : "disabled",
          canPurchase:
            enabled &&
            currentScope.capabilities.includes("billing.manage") &&
            account?.["lifecycle_status"] === "active" &&
            account["expensive_operations_enabled"] === true &&
            account["normalized_status"] === "active" &&
            typeof account["provider_customer_reference"] === "string",
          availableCreditUnits: balance?.availableCreditUnits ?? "0",
          packs: CREDIT_TOP_UP_PACKS_V1.map((pack) => ({
            ...pack,
            priceMicros: String(pack.priceMicros),
            expiration: "never",
          })),
          latestPurchase:
            latest === undefined
              ? null
              : {
                  id: latest["attempt_id"],
                  packKey: latest["pack_key"],
                  state: latest["lifecycle_status"],
                  needsReview: latest["review_reason"] !== null,
                },
        });
      } catch (error) {
        return translate(error);
      }
    },
    async createCreditTopUp(principal, organizationId, input, idempotencyKey) {
      try {
        const database = new AuthorizedCommercialRequestDatabase(
          options.database,
          principal,
          organizationId,
          "billing.manage",
          clock,
        );
        const context = await database.context(),
          currentScope = await scope(database),
          sessions = options.sessions;
        if (!enabled || sessions === undefined)
          throw new ApplicationError(
            "service_unavailable",
            "Credit purchases are not enabled yet.",
          );
        const persistence = new PostgresBillingPersistence(
          database,
          sessions.configuration.stripeEnvironment,
        );
        async function authorizePurchase(purchase: CreditTopUpPurchase) {
          await database.context();
          const account = await persistence.getSessionAccount(currentScope);
          if (
            !topUpAccountEligible(account) ||
            account.organizationId !== purchase.organizationId ||
            account.billingAccountId !== purchase.billingAccountId ||
            account.providerCustomerReference !==
              purchase.providerCustomerReference
          ) {
            throw new ApplicationError(
              "access_denied",
              "The credit purchase account is no longer available.",
            );
          }
        }
        const provider: CreditTopUpProvider = {
          createCreditTopUpSession: async (request) => {
            await authorizePurchase(request.purchase);
            const adapter = sessions.createProvider(() =>
              authorizePurchase(request.purchase),
            );
            if (adapter.createCreditTopUpSession === undefined)
              throw Error("Top-up provider unavailable");
            const result = await adapter.createCreditTopUpSession(request);
            await authorizePurchase(request.purchase);
            return result;
          },
          getCreditTopUpSession: async (request) => {
            await authorizePurchase(request.purchase);
            const adapter = sessions.createProvider(() =>
              authorizePurchase(request.purchase),
            );
            if (adapter.getCreditTopUpSession === undefined)
              throw Error("Top-up provider unavailable");
            const result = await adapter.getCreditTopUpSession(request);
            await authorizePurchase(request.purchase);
            return result;
          },
        };
        const result = await runSensitiveAction({
          action: "billing.top-ups.checkout.create",
          family: "billing",
          context,
          now: clock,
          permission: "billing.manage",
          targetKind: "billing-account",
          safeSummary: "Created a hosted credit purchase session.",
          auditSink: {
            append: async (event) => {
              await options.database.query(
                sql(
                  `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id,occurred_at)
        VALUES($1,$2,$3,'billing.top-ups.checkout.create','billing-account',NULL,$4,'Created a hosted credit purchase session.',$5,$6::timestamptz)`,
                  [
                    "audit_" + randomUUID(),
                    organizationId,
                    principal.principalId,
                    event.outcome,
                    principal.correlationId,
                    event.occurredAt,
                  ],
                ),
              );
            },
          },
          operation: () =>
            createGuardedCreditTopUp({
              scope: currentScope,
              packKey: input.packKey,
              idempotencyKey,
              provider,
              persistence: new PostgresCreditTopUpPersistence(database),
              getAccount: () => persistence.getSessionAccount(currentScope),
              now: clock,
              successUrl: new URL(
                `/organizations/${encodeURIComponent(organizationId)}/billing?topup=returned`,
                sessions.configuration.successUrl,
              ).href,
              cancelUrl: new URL(
                `/organizations/${encodeURIComponent(organizationId)}/billing?topup=canceled`,
                sessions.configuration.cancelUrl,
              ).href,
            }),
        });
        await database.context();
        return hostedBillingSessionV1Schema.parse({
          contractVersion: 1,
          organizationId,
          kind: "checkout",
          url: result.url,
        });
      } catch (error) {
        return translate(error);
      }
    },
  };
}
