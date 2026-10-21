import { createHash } from "node:crypto";

import {
  BILLING_WEBHOOK_EVENT_TYPES,
  BillingApplicationError,
  type BillingPlanKey,
  type BillingProjectionState,
  type BillingProvider,
  type BillingSubscriptionSnapshot,
  type CreateHostedCheckoutInput,
  type CreateHostedPortalInput,
  type HostedBillingSession,
  type VerifiedBillingWebhookEvent,
} from "../../application/billing.js";
import type { BillingCheckoutSession } from "../../application/billing-checkout.js";

export const FAKE_BILLING_WEBHOOK_SIGNATURE =
  "cloudmarkup-fake-billing-signature-v1" as const;

export interface FakeBillingWebhookFixture {
  readonly created: number;
  readonly id: string;
  readonly snapshot?: BillingSubscriptionSnapshot | null;
  readonly type: string;
}

export interface FakeBillingSessionRecord {
  readonly billingAccountId: string;
  readonly idempotencyKey: string;
  readonly organizationId: string;
  readonly planKey?: BillingPlanKey;
  readonly providerCustomerReference?: string;
}

function invalidEvent(): never {
  throw new BillingApplicationError(
    "invalid-provider-event",
    "The fake billing event is invalid.",
  );
}

function optionalIdentifier(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
  );
}

function dateOrNull(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)))
  );
}

function validSnapshot(value: unknown): value is BillingSubscriptionSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const states: readonly BillingProjectionState[] = [
    "pending",
    "active",
    "past-due",
    "paused",
    "canceled",
    "incomplete",
  ];
  const state = record["normalizedStatus"];
  const periodId = record["currentPeriodId"];
  const periodStart = record["currentPeriodStart"];
  const periodEnd = record["currentPeriodEnd"];
  const periodShape =
    (periodId === null && periodStart === null && periodEnd === null) ||
    (typeof periodId === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(periodId) &&
      typeof periodStart === "string" &&
      typeof periodEnd === "string" &&
      Number.isFinite(Date.parse(periodStart)) &&
      Number.isFinite(Date.parse(periodEnd)) &&
      Date.parse(periodEnd) > Date.parse(periodStart));
  return (
    optionalIdentifier(record["organizationId"]) &&
    optionalIdentifier(record["billingAccountId"]) &&
    record["billableSeatQuantity"] === 1 &&
    typeof record["cancelAtPeriodEnd"] === "boolean" &&
    dateOrNull(periodStart) &&
    dateOrNull(periodEnd) &&
    periodShape &&
    typeof state === "string" &&
    states.includes(state as BillingProjectionState) &&
    typeof record["priceReference"] === "string" &&
    /^price_[A-Za-z0-9_]+$/.test(record["priceReference"]) &&
    typeof record["productReference"] === "string" &&
    /^prod_[A-Za-z0-9_]+$/.test(record["productReference"]) &&
    typeof record["providerCustomerReference"] === "string" &&
    /^cus_fake_[A-Za-z0-9_]+$/.test(record["providerCustomerReference"]) &&
    typeof record["providerSubscriptionReference"] === "string" &&
    /^sub_fake_[A-Za-z0-9_]+$/.test(record["providerSubscriptionReference"])
  );
}

function safeFixture(value: unknown): FakeBillingWebhookFixture {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidEvent();
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record["id"] !== "string" ||
    !/^evt_fake_[A-Za-z0-9_]+$/.test(record["id"]) ||
    typeof record["type"] !== "string" ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(record["type"]) ||
    typeof record["created"] !== "number" ||
    !Number.isSafeInteger(record["created"]) ||
    record["created"] < 0
  ) {
    return invalidEvent();
  }
  const snapshot = record["snapshot"];
  if (snapshot !== undefined && snapshot !== null && !validSnapshot(snapshot)) {
    return invalidEvent();
  }
  return {
    created: record["created"],
    id: record["id"],
    ...(snapshot === undefined
      ? {}
      : {
          snapshot: snapshot ?? null,
        }),
    type: record["type"],
  };
}

function supported(value: string): boolean {
  return (BILLING_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export function encodeFakeBillingWebhook(
  fixture: FakeBillingWebhookFixture,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(fixture));
}

export class FakeBillingProvider implements BillingProvider {
  readonly checkoutSessions: FakeBillingSessionRecord[] = [];
  readonly checkoutSnapshots = new Map<string, BillingCheckoutSession>();
  readonly portalSessions: FakeBillingSessionRecord[] = [];

  createCheckoutSession(
    input: CreateHostedCheckoutInput,
  ): Promise<BillingCheckoutSession> {
    const reference =
      "cs_test_" +
      createHash("sha256").update(input.idempotencyKey).digest("hex");
    const existing = this.checkoutSnapshots.get(reference);
    if (existing !== undefined) return Promise.resolve(existing);
    this.checkoutSessions.push({
      billingAccountId: input.billingAccountId,
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      planKey: input.plan.planKey,
    });
    const url = new URL("http://127.0.0.1:4173/billing/fake/checkout");
    url.searchParams.set("organization", input.organizationId);
    url.searchParams.set("account", input.billingAccountId);
    url.searchParams.set("plan", input.plan.planKey);
    const session: BillingCheckoutSession = {
      billingAccountId: input.billingAccountId,
      expiresAt: new Date(
        Date.parse(input.retryBefore ?? "2026-08-15T11:00:00.000Z") + 3_600_000,
      ).toISOString(),
      organizationId: input.organizationId,
      providerSessionReference: reference,
      providerSubscriptionReference: null,
      status: "open",
      url: url.toString(),
    };
    this.checkoutSnapshots.set(reference, session);
    return Promise.resolve(session);
  }

  getCheckoutSession(input: {
    readonly billingAccountId: string;
    readonly organizationId: string;
    readonly providerSessionReference: string;
  }): Promise<BillingCheckoutSession> {
    const session = this.checkoutSnapshots.get(input.providerSessionReference);
    if (
      session?.billingAccountId !== input.billingAccountId ||
      session.organizationId !== input.organizationId
    )
      return Promise.reject(
        new BillingApplicationError(
          "invalid-provider-event",
          "The fake Checkout session is unavailable.",
        ),
      );
    return Promise.resolve(session);
  }

  createPortalSession(
    input: CreateHostedPortalInput,
  ): Promise<HostedBillingSession> {
    this.portalSessions.push({
      billingAccountId: input.billingAccountId,
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      providerCustomerReference: input.providerCustomerReference,
    });
    const url = new URL("http://127.0.0.1:4173/billing/fake/portal");
    url.searchParams.set("organization", input.organizationId);
    url.searchParams.set("account", input.billingAccountId);
    return Promise.resolve({ url: url.toString() });
  }

  verifyWebhook(input: {
    readonly now: Date;
    readonly rawBody: Uint8Array;
    readonly signatureHeader: string | undefined;
  }): Promise<VerifiedBillingWebhookEvent> {
    if (input.signatureHeader !== FAKE_BILLING_WEBHOOK_SIGNATURE) {
      return Promise.reject(
        new BillingApplicationError(
          "invalid-provider-event",
          "The fake billing event signature is invalid.",
        ),
      );
    }
    try {
      const fixture = safeFixture(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody),
        ) as unknown,
      );
      const occurredAt = new Date(fixture.created * 1000);
      if (!Number.isFinite(occurredAt.getTime())) return invalidEvent();
      return Promise.resolve({
        eventPosition:
          fixture.created.toString().padStart(20, "0") + ":" + fixture.id,
        eventType: fixture.type,
        occurredAt: occurredAt.toISOString(),
        payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
        providerEventData: fixture,
        providerEventReference: fixture.id,
        supported: supported(fixture.type),
      });
    } catch (error) {
      return Promise.reject(
        error instanceof BillingApplicationError
          ? error
          : new BillingApplicationError(
              "invalid-provider-event",
              "The fake billing event is invalid.",
            ),
      );
    }
  }

  resolveSubscriptionSnapshot(
    event: VerifiedBillingWebhookEvent,
  ): Promise<BillingSubscriptionSnapshot | null> {
    const fixture = safeFixture(event.providerEventData);
    return Promise.resolve(fixture.snapshot ?? null);
  }
}
