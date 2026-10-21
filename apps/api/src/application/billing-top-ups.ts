import { createHash, randomUUID } from "node:crypto";
import {
  CREDIT_TOP_UP_POLICY_VERSION,
  creditTopUpPack,
} from "@cloudmarkup/domain";
import type { AuthorizedOrganizationScope } from "./persistence.js";
import type {
  BillingSessionAccount,
  VerifiedBillingWebhookEvent,
} from "./billing.js";
import { BillingApplicationError } from "./billing-errors.js";
import type { CreditTopUpPackKey } from "@cloudmarkup/domain";

/** An immutable server-created purchase; browser input selects only a pack key. */
export interface CreditTopUpPurchase {
  readonly attemptId: string;
  readonly organizationId: string;
  readonly billingAccountId: string;
  readonly providerCustomerReference: string;
  readonly packKey: CreditTopUpPackKey;
  readonly policyVersion: string;
}
export interface CreditTopUpSession {
  readonly purchase: CreditTopUpPurchase;
  readonly providerSessionReference: string;
  readonly expiresAt: string;
  readonly status: "open" | "complete" | "expired";
  readonly paymentStatus: "paid" | "unpaid";
  readonly providerPaymentReference: string | null;
  readonly url: string | null;
  readonly paymentReview: "clear" | "refund" | "dispute" | null;
}
export interface CreateCreditTopUpSessionInput {
  readonly purchase: CreditTopUpPurchase;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly retryBefore: string;
}
export interface CreditTopUpProvider {
  createCreditTopUpSession(
    input: CreateCreditTopUpSessionInput,
  ): Promise<CreditTopUpSession>;
  getCreditTopUpSession(input: {
    readonly purchase: CreditTopUpPurchase;
    readonly providerSessionReference: string;
  }): Promise<CreditTopUpSession>;
}

export interface CreditTopUpAttempt extends CreditTopUpPurchase {
  readonly requestKeySha256: string;
  readonly requestSha256: string;
  readonly retryBefore: string;
  readonly createdAt: string;
  readonly state: "pending" | "created" | "expired" | "fulfilled" | "review";
  readonly providerSessionReference: string | null;
  readonly providerExpiresAt: string | null;
  readonly providerPaymentReference: string | null;
  readonly reviewReason: "refund" | "dispute" | "account-unavailable" | null;
}
export interface CreditTopUpPersistence {
  claim(
    scope: AuthorizedOrganizationScope,
    input: CreditTopUpPurchase & {
      readonly requestKeySha256: string;
      readonly requestSha256: string;
    },
  ): Promise<CreditTopUpAttempt>;
  record(
    scope: AuthorizedOrganizationScope,
    attempt: CreditTopUpAttempt,
    session: CreditTopUpSession,
  ): Promise<CreditTopUpAttempt>;
  expire(
    scope: AuthorizedOrganizationScope,
    attempt: CreditTopUpAttempt,
    session: CreditTopUpSession,
  ): Promise<void>;
}
export function topUpAccountEligible(
  account: BillingSessionAccount | null,
): account is BillingSessionAccount & {
  readonly providerCustomerReference: string;
} {
  return (
    account !== null &&
    account.lifecycleStatus === "active" &&
    account.currentSubscriptionState === "active" &&
    account.expensiveOperationsEnabled &&
    typeof account.providerCustomerReference === "string" &&
    /^cus_[A-Za-z0-9_]{1,250}$/u.test(account.providerCustomerReference)
  );
}
function conflict(): never {
  throw new BillingApplicationError(
    "idempotency-conflict",
    "Resume the existing credit purchase or wait for its verified payment or expiration.",
  );
}
export async function createGuardedCreditTopUp(input: {
  readonly scope: AuthorizedOrganizationScope;
  readonly packKey: CreditTopUpPackKey;
  readonly idempotencyKey: string;
  readonly provider: CreditTopUpProvider;
  readonly persistence: CreditTopUpPersistence;
  readonly getAccount: () => Promise<BillingSessionAccount | null>;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly now: () => Date;
}): Promise<{ readonly url: string }> {
  const account = await input.getAccount();
  if (
    !topUpAccountEligible(account) ||
    account.organizationId !== input.scope.organizationId
  ) {
    throw new BillingApplicationError(
      "subscription-required",
      "An active subscription is required for a credit purchase.",
    );
  }
  if (
    creditTopUpPack(input.packKey) === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey)
  )
    conflict();
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const purchase = {
    organizationId: input.scope.organizationId,
    billingAccountId: account.billingAccountId,
    providerCustomerReference: account.providerCustomerReference,
    packKey: input.packKey,
    policyVersion: CREDIT_TOP_UP_POLICY_VERSION,
  };
  const requestSha256 = sha(
    JSON.stringify({
      purchase,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    }),
  );
  const requestKeySha256 = sha(input.idempotencyKey);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    let attempt = await input.persistence.claim(input.scope, {
      ...purchase,
      attemptId: "topup_" + randomUUID().replaceAll("-", ""),
      requestSha256,
      requestKeySha256,
    });
    if (!["pending", "created"].includes(attempt.state)) conflict();
    const same = attempt.requestSha256 === requestSha256;
    let session: CreditTopUpSession;
    if (attempt.providerSessionReference === null) {
      if (
        !same ||
        !Number.isFinite(Date.parse(attempt.retryBefore)) ||
        input.now().getTime() >= Date.parse(attempt.retryBefore)
      )
        conflict();
      session = await input.provider.createCreditTopUpSession({
        purchase: attempt,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        retryBefore: attempt.retryBefore,
      });
      attempt = await input.persistence.record(input.scope, attempt, session);
    } else {
      session = await input.provider.getCreditTopUpSession({
        purchase: attempt,
        providerSessionReference: attempt.providerSessionReference,
      });
    }
    if (
      session.providerSessionReference !== attempt.providerSessionReference ||
      session.expiresAt !== attempt.providerExpiresAt
    )
      conflict();
    const current = await input.getAccount();
    if (
      !topUpAccountEligible(current) ||
      current.organizationId !== purchase.organizationId ||
      current.billingAccountId !== purchase.billingAccountId ||
      current.providerCustomerReference !== purchase.providerCustomerReference
    )
      conflict();
    if (session.status === "expired" && session.paymentStatus === "unpaid") {
      await input.persistence.expire(input.scope, attempt, session);
      if (attempt.requestKeySha256 === requestKeySha256) conflict();
      continue;
    }
    if (
      !same ||
      session.status !== "open" ||
      session.url === null ||
      attempt.state !== "created"
    )
      conflict();
    return { url: session.url };
  }
  return conflict();
}

export type CreditTopUpWebhookProcessor = (
  event: VerifiedBillingWebhookEvent,
) => Promise<{
  readonly organizationId: string;
  readonly billingAccountId: string;
  readonly status: "applied" | "duplicate" | "rejected";
} | null>;
