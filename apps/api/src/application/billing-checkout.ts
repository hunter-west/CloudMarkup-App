import { createHash, randomUUID } from "node:crypto";

import type {
  BillingConfiguration,
  BillingPersistence,
  BillingPlanKey,
  BillingProvider,
  BillingSessionAccount,
  HostedBillingSession,
} from "./billing.js";
import { BillingApplicationError } from "./billing-errors.js";
import { ApplicationError } from "./errors.js";
import type { AuthorizedOrganizationScope } from "./persistence.js";

export interface BillingCheckoutSession {
  readonly billingAccountId: string;
  readonly expiresAt: string;
  readonly organizationId: string;
  readonly providerSessionReference: string;
  readonly providerSubscriptionReference: string | null;
  readonly status: "open" | "complete" | "expired";
  readonly url: string | null;
}

export interface BillingCheckoutAttempt {
  readonly attemptId: string;
  readonly billingAccountId: string;
  readonly organizationId: string;
  readonly providerSessionReference?: string;
  readonly providerExpiresAt?: string;
  readonly recordVersion: string;
  readonly requestKeySha256: string;
  readonly requestSha256: string;
  readonly retryBefore: string;
  readonly state: "pending" | "created" | "expired" | "consumed";
}

export interface ClaimBillingCheckoutInput {
  readonly attemptId: string;
  readonly billingAccountId: string;
  readonly requestKeySha256: string;
  readonly requestSha256: string;
}

export interface BillingCheckoutPersistence {
  claimCheckoutAttempt(
    scope: AuthorizedOrganizationScope,
    input: ClaimBillingCheckoutInput,
  ): Promise<BillingCheckoutAttempt>;
  recordCheckoutSession(
    scope: AuthorizedOrganizationScope,
    attempt: BillingCheckoutAttempt,
    session: BillingCheckoutSession,
  ): Promise<BillingCheckoutAttempt>;
  retireCheckoutAttempt(
    scope: AuthorizedOrganizationScope,
    attempt: BillingCheckoutAttempt,
    session: BillingCheckoutSession,
  ): Promise<void>;
}

function conflict(): never {
  throw new BillingApplicationError(
    "idempotency-conflict",
    "A previous Checkout attempt must be resumed or reconciled before starting another.",
  );
}

function unavailable(): never {
  throw new BillingApplicationError(
    "provider-unavailable",
    "The previous Checkout attempt requires billing reconciliation.",
  );
}

function requireAccount(
  account: BillingSessionAccount | null,
  scope: AuthorizedOrganizationScope,
): BillingSessionAccount {
  if (
    account?.organizationId !== scope.organizationId ||
    account.lifecycleStatus !== "active"
  )
    throw new ApplicationError(
      "not_found",
      "The billing account is unavailable.",
    );
  if (
    account.currentSubscriptionState !== undefined &&
    account.currentSubscriptionState !== "canceled"
  )
    throw new ApplicationError(
      "invalid_request",
      "The existing subscription must be managed through the billing Portal.",
    );
  return account;
}

/** A browser key never becomes the account-level external-effect lock. */
export async function createGuardedCheckoutSession(input: {
  readonly configuration: BillingConfiguration;
  readonly idempotencyKey: string;
  readonly now: () => Date;
  readonly persistence: BillingPersistence;
  readonly planKey: BillingPlanKey;
  readonly provider: BillingProvider;
  readonly scope: AuthorizedOrganizationScope;
}): Promise<HostedBillingSession> {
  const account = requireAccount(
    await input.persistence.getSessionAccount(input.scope),
    input.scope,
  );
  const providerInput = {
    billingAccountId: account.billingAccountId,
    cancelUrl: input.configuration.cancelUrl,
    ...(account.providerCustomerReference === undefined
      ? {}
      : {
          existingProviderCustomerReference: account.providerCustomerReference,
        }),
    organizationId: input.scope.organizationId,
    plan: input.configuration.plans[input.planKey],
    successUrl: input.configuration.successUrl,
  };
  const digest = (value: string): string =>
    createHash("sha256").update(value).digest("hex");
  const requestKeySha256 = digest(input.idempotencyKey);
  const requestSha256 = digest(JSON.stringify(providerInput));

  // One verified terminal session can be retired, then one new attempt claimed.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    let attempt = await input.persistence.claimCheckoutAttempt(input.scope, {
      attemptId: "checkout_" + randomUUID().replaceAll("-", ""),
      billingAccountId: account.billingAccountId,
      requestKeySha256,
      requestSha256,
    });
    const sameParameters = attempt.requestSha256 === requestSha256;
    const sameRequest =
      attempt.requestKeySha256 === requestKeySha256 && sameParameters;
    if (attempt.state === "expired" || attempt.state === "consumed") conflict();
    let session: BillingCheckoutSession;
    if (attempt.providerSessionReference === undefined) {
      if (!sameParameters) conflict();
      // A new authorized browser may replay the same durable provider identity
      // only with identical server-owned parameters. It cannot create a second
      // attempt. Stripe may prune idempotency after 24h. SQL grants a 23h retry
      // window. An unknown result is never unlocked by a timer or browser key.
      const retryBefore = Date.parse(attempt.retryBefore);
      if (!Number.isFinite(retryBefore) || input.now().getTime() >= retryBefore)
        unavailable();
      session = await input.provider.createCheckoutSession({
        ...providerInput,
        idempotencyKey: "checkout:" + attempt.attemptId,
        retryBefore: attempt.retryBefore,
      });
      attempt = await input.persistence.recordCheckoutSession(
        input.scope,
        attempt,
        session,
      );
    } else {
      session = await input.provider.getCheckoutSession({
        billingAccountId: account.billingAccountId,
        ...(sameParameters ? { expectedPlanKey: input.planKey } : {}),
        ...(account.providerCustomerReference === undefined
          ? {}
          : {
              expectedProviderCustomerReference:
                account.providerCustomerReference,
            }),
        organizationId: input.scope.organizationId,
        providerSessionReference: attempt.providerSessionReference,
      });
    }
    if (
      session.organizationId !== input.scope.organizationId ||
      session.billingAccountId !== account.billingAccountId ||
      session.providerSessionReference !== attempt.providerSessionReference ||
      session.expiresAt !== attempt.providerExpiresAt
    )
      unavailable();
    const current = requireAccount(
      await input.persistence.getSessionAccount(input.scope),
      input.scope,
    );
    if (current.billingAccountId !== account.billingAccountId) unavailable();
    if (
      session.status === "expired" &&
      session.providerSubscriptionReference === null
    ) {
      await input.persistence.retireCheckoutAttempt(
        input.scope,
        attempt,
        session,
      );
      if (sameRequest) conflict();
      continue;
    }
    if (
      session.status === "complete" &&
      session.providerSubscriptionReference !== null &&
      current.currentSubscriptionState === "canceled" &&
      current.currentSubscriptionReference ===
        session.providerSubscriptionReference
    ) {
      await input.persistence.retireCheckoutAttempt(
        input.scope,
        attempt,
        session,
      );
      if (sameRequest) conflict();
      continue;
    }
    // Release only a recorded, freshly verified session with identical
    // server-owned parameters. The browser never supplies a provider session
    // ID or changes the account's durable provider idempotency identity.
    if (!sameParameters || session.status !== "open" || session.url === null)
      conflict();
    return { url: session.url };
  }
  return conflict();
}
