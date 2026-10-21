import { createProductionCreditTopUps } from "./production-credit-top-ups.js";
import { createHash, randomUUID } from "node:crypto";

import {
  billingWorkspaceV1Schema,
  hostedBillingSessionV1Schema,
} from "@cloudmarkup/api-contract";

import { PostgresBillingPersistence } from "./adapters/persistence/billing-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./adapters/persistence/commercial-repositories.js";
import { sql, type SqlDatabase } from "./adapters/persistence/sql.js";
import {
  permissionsForRole,
  type SensitiveAuditSink,
} from "./application/authorization.js";
import {
  BillingApplicationError,
  BillingApplicationService,
  type BillingConfiguration,
  type BillingProvider,
} from "./application/billing.js";
import type { BillingWorkspaceApplication } from "./application/billing-workspace.js";
import { billingPlanKeyForVersion } from "./application/billing-plan-mapping.js";
import { ApplicationError } from "./application/errors.js";
import type { PrincipalContext } from "./application/ports.js";

import {
  AuthorizedCommercialRequestDatabase as BillingRequestDatabase,
  type CommercialRequestPermission as Permission,
} from "./production-commercial-authorization.js";
function translate(error: unknown): never {
  if (error instanceof ApplicationError) throw error;
  if (error instanceof BillingApplicationError) {
    throw new ApplicationError(
      error.code === "idempotency-conflict"
        ? "conflict"
        : error.code === "subscription-required"
          ? "invalid_request"
          : "service_unavailable",
      error.code === "idempotency-conflict"
        ? "A Checkout attempt already exists. Resume it or wait for its verified expiration."
        : error.code === "subscription-required"
          ? "No billing customer is available to manage."
          : "Billing is temporarily unavailable.",
    );
  }
  throw new ApplicationError(
    "service_unavailable",
    "Billing is temporarily unavailable.",
  );
}

const plans = [
  {
    key: "starter",
    displayName: "Starter",
    currency: "USD",
    monthlyPriceMicros: "9000000",
    monthlyCreditUnits: 200,
  },
  {
    key: "pro",
    displayName: "Professional",
    currency: "USD",
    monthlyPriceMicros: "39000000",
    monthlyCreditUnits: 1250,
  },
] as const;

/** Real tenant metadata and hosted sessions; no webhook or credit-grant authority is exposed by HTTP. */
export function createProductionBillingWorkspace(options: {
  readonly database: SqlDatabase;
  readonly clock?: () => Date;
  readonly sessions?: {
    readonly configuration: BillingConfiguration;
    readonly topUpsEnabled?: boolean;
    readonly createProvider: (
      authorizeBeforeRequest: () => Promise<void>,
    ) => BillingProvider;
  };
}): BillingWorkspaceApplication {
  const clock = options.clock ?? (() => new Date());
  if (
    options.sessions !== undefined &&
    !(
      (options.sessions.configuration.mode === "stripe-sandbox" &&
        options.sessions.configuration.stripeEnvironment === "test") ||
      (options.sessions.configuration.mode === "stripe-live" &&
        options.sessions.configuration.stripeEnvironment === "live")
    )
  )
    throw new TypeError(
      "The production billing workspace requires mode-matched Stripe sessions.",
    );

  function request(
    principal: PrincipalContext,
    organizationId: string,
    permission: Permission,
  ) {
    return new BillingRequestDatabase(
      options.database,
      principal,
      organizationId,
      permission,
      clock,
    );
  }

  function audit(database: BillingRequestDatabase): SensitiveAuditSink {
    return {
      append: async (event) => {
        if (
          event.organizationId !== database.organizationId ||
          event.actorPrincipalId !== database.principal.principalId ||
          event.correlationId !== database.principal.correlationId ||
          event.family !== "billing" ||
          event.targetKind !== "billing-account" ||
          !["billing.checkout.create", "billing.portal.create"].includes(
            event.action,
          )
        )
          throw new ApplicationError(
            "service_unavailable",
            "The billing audit binding is invalid.",
          );
        // Audit is still written if the actor was revoked during a provider wait.
        await options.database.query(
          sql(
            `INSERT INTO audit_events (audit_event_id, organization_id, actor_principal_id, action,
         target_kind, target_id, outcome, safe_summary, correlation_id, occurred_at)
         VALUES ($1, $2, $3, $4, 'billing-account', NULL, $5, $6, $7, $8::timestamptz)`,
            [
              `audit_${randomUUID()}`,
              event.organizationId,
              event.actorPrincipalId,
              event.action,
              event.outcome,
              event.safeSummary,
              event.correlationId,
              event.occurredAt,
            ],
          ),
        );
      },
    };
  }

  function service(
    database: BillingRequestDatabase,
  ): BillingApplicationService {
    const sessions = options.sessions;
    if (sessions === undefined)
      throw new ApplicationError(
        "service_unavailable",
        "Checkout and billing management are not enabled yet.",
      );
    const createProvider = sessions.createProvider;
    const stripeEnvironment = sessions.configuration.stripeEnvironment;
    // Bind current actor AND account/customer before the actual HTTP request
    // (after secret resolution), then recheck before releasing a hosted URL.
    async function runProvider<T>(
      expected: {
        readonly billingAccountId: string;
        readonly organizationId: string;
        readonly customer: string | undefined;
      },
      operation: (provider: BillingProvider) => Promise<T>,
    ): Promise<T> {
      async function authorize() {
        const context = await database.context();
        const account = await new PostgresBillingPersistence(
          database,
          stripeEnvironment,
        ).getSessionAccount({
          capabilities: permissionsForRole(context.role),
          correlationId: context.correlationId,
          membershipId: context.membershipId,
          organizationId: context.organizationId,
          principalId: context.principal.principalId,
          roleKey: context.role,
          sessionId: context.principal.sessionId,
        });
        if (
          expected.organizationId !== database.organizationId ||
          account?.organizationId !== database.organizationId ||
          account.billingAccountId !== expected.billingAccountId ||
          account.lifecycleStatus !== "active" ||
          account.providerCustomerReference !== expected.customer
        )
          throw new ApplicationError(
            "not_found",
            "The billing account is unavailable.",
          );
      }
      await authorize();
      const result = await operation(createProvider(authorize));
      await authorize();
      return result;
    }
    const eventUnavailable = () =>
      Promise.reject(
        new ApplicationError(
          "service_unavailable",
          "Subscription processing is not exposed by billing sessions.",
        ),
      );
    const provider: BillingProvider = {
      createCheckoutSession: (input) =>
        runProvider(
          { ...input, customer: input.existingProviderCustomerReference },
          (provider) => provider.createCheckoutSession(input),
        ),
      getCheckoutSession: (input) =>
        runProvider(
          { ...input, customer: input.expectedProviderCustomerReference },
          (provider) => provider.getCheckoutSession(input),
        ),
      createPortalSession: (input) =>
        runProvider(
          { ...input, customer: input.providerCustomerReference },
          (provider) => provider.createPortalSession(input),
        ),
      resolveSubscriptionSnapshot: eventUnavailable,
      verifyWebhook: eventUnavailable,
    };
    return new BillingApplicationService({
      auditSink: audit(database),
      commercial: new PostgresCommercialPersistenceRepository(database),
      configuration: {
        ...sessions.configuration,
        // Derive return navigation from verified tenant scope, never the browser body.
        cancelUrl: new URL(
          `/organizations/${encodeURIComponent(database.organizationId)}/billing?checkout=canceled`,
          sessions.configuration.cancelUrl,
        ).href,
        successUrl: new URL(
          `/organizations/${encodeURIComponent(database.organizationId)}/billing?checkout=returned`,
          sessions.configuration.successUrl,
        ).href,
        portalReturnUrl: new URL(
          `/organizations/${encodeURIComponent(database.organizationId)}/billing`,
          sessions.configuration.portalReturnUrl,
        ).href,
      },
      now: clock,
      persistence: new PostgresBillingPersistence(
        database,
        sessions.configuration.stripeEnvironment,
      ),
      provider,
    });
  }

  async function ensureAccount(database: BillingRequestDatabase) {
    await database.transaction(async (transaction) => {
      await transaction.query(
        sql(
          `INSERT INTO organization_billing_accounts (billing_account_id, organization_id)
         VALUES ($1, $2) ON CONFLICT (organization_id) DO NOTHING`,
          [
            "billing_" +
              createHash("sha256")
                .update("billing-account-v1\u0000" + database.organizationId)
                .digest("hex"),
            database.organizationId,
          ],
        ),
      );
      // No subscription, entitlement snapshot, grant, usage entry or trial is created here.
    });
  }

  return {
    ...createProductionCreditTopUps(options),
    async getWorkspace(principal, organizationId) {
      try {
        const database = request(
          principal,
          organizationId,
          "commercial.summary.read",
        );
        const value = await options.database.transaction(
          async (transaction) => {
            const actor = await database.authorize(transaction);
            const result = await transaction.query(
              sql(
                `SELECT a.lifecycle_status AS account_state, s.normalized_status AS subscription_state,
               s.plan_version_id, s.provider_customer_reference
             FROM organization_billing_accounts a
             LEFT JOIN organization_subscription_projections s
               ON s.organization_id = a.organization_id AND s.billing_account_id = a.billing_account_id AND s.provider_environment=$2
             WHERE a.organization_id = $1`,
                [
                  organizationId,
                  options.sessions?.configuration.stripeEnvironment ?? "test",
                ],
              ),
            );
            if (result.rows.length > 1)
              throw new Error("Ambiguous billing account.");
            const row = result.rows[0];
            const accountState = row?.["account_state"] ?? "unprovisioned";
            const subscriptionState =
              row?.["subscription_state"] ?? "not-subscribed";
            const version = row?.["plan_version_id"];
            const currentPlanKey =
              version === null || version === undefined
                ? null
                : billingPlanKeyForVersion(version);
            const manages =
              permissionsForRole(actor.role).includes("billing.manage") &&
              options.sessions !== undefined &&
              (accountState === "active" || accountState === "unprovisioned");
            return billingWorkspaceV1Schema.parse({
              contractVersion: 1,
              organizationId,
              asOf: clock().toISOString(),
              mode: options.sessions?.configuration.mode ?? "disabled",
              accountState,
              subscriptionState,
              currentPlanKey,
              canCheckout:
                manages &&
                (subscriptionState === "not-subscribed" ||
                  subscriptionState === "canceled"),
              canManage:
                manages &&
                typeof row?.["provider_customer_reference"] === "string",
              plans: plans.map((plan) => ({
                ...plan,
                displayName:
                  options.sessions?.configuration.mode === "stripe-live" &&
                  plan.key === "starter"
                    ? "Standard"
                    : plan.displayName,
                monthlyCreditUnits:
                  options.sessions?.configuration.plans[plan.key]
                    .monthlyCreditUnits ?? plan.monthlyCreditUnits,
              })),
            });
          },
        );
        return value;
      } catch (error) {
        return translate(error);
      }
    },
    async createCheckout(principal, organizationId, input, idempotencyKey) {
      try {
        const database = request(principal, organizationId, "billing.manage");
        const context = await database.context();
        const billing = service(database);
        await ensureAccount(database);
        const result = await billing.createCheckoutSession({
          context,
          idempotencyKey,
          planKey: input.planKey,
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
    async createPortal(principal, organizationId, idempotencyKey) {
      try {
        const database = request(principal, organizationId, "billing.manage");
        const context = await database.context();
        const result = await service(database).createPortalSession({
          context,
          idempotencyKey,
        });
        await database.context();
        return hostedBillingSessionV1Schema.parse({
          contractVersion: 1,
          organizationId,
          kind: "portal",
          url: result.url,
        });
      } catch (error) {
        return translate(error);
      }
    },
  };
}
