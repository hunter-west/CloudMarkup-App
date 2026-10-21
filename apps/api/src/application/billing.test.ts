import { STAFF_TRIAL_PLAN_VERSION } from "@cloudmarkup/domain";
import type { CreditTopUpWebhookProcessor } from "./billing-top-ups.js";
import { describe, expect, it, vi } from "vitest";

import {
  FakeBillingProvider,
  FAKE_BILLING_WEBHOOK_SIGNATURE,
  encodeFakeBillingWebhook,
  type FakeBillingWebhookFixture,
} from "../adapters/billing/fake-billing-provider.js";
import {
  STRIPE_PRO_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_REFERENCE,
  STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_STARTER_PRODUCT_REFERENCE,
} from "../adapters/billing/environment.js";
import {
  CommercialPersistenceError,
  type CommercialEntitlementSnapshotInput,
  type CommercialEntitlementSnapshotRecord,
  type CommercialSubscriptionProjectionInput,
  type CommercialSubscriptionProjectionRecord,
  type CreateCreditGrantInput,
  type CreditGrantRecord,
  type TrustedCommercialMutationContext,
} from "./commercial-persistence.js";
import {
  BillingApplicationError,
  BillingApplicationService,
  BILLING_CREDIT_PLAN_MAPPING_VERSION,
  BILLING_EXPORT_PLAN_MAPPING_VERSION,
  BILLING_SHARING_PLAN_MAPPING_VERSION,
  createBillingConfiguration,
  type BillingCommercialPersistence,
  type BillingPersistence,
  type BillingSessionAccount,
  type BillingSubscriptionSnapshot,
  type BillingWebhookReceipt,
  type BillingWebhookTarget,
  type CompleteBillingWebhookInput,
  type RecordBillingWebhookInput,
  type ResolveBillingWebhookTargetInput,
  type VerifiedBillingWebhookEvent,
} from "./billing.js";
import type {
  AuthorizedOrganizationContext,
  OrganizationRole,
  SensitiveAuditEvent,
} from "./authorization.js";
import { ApplicationError } from "./errors.js";
import type { AuthorizedOrganizationScope } from "./persistence.js";
import type {
  BillingCheckoutAttempt,
  BillingCheckoutSession,
  ClaimBillingCheckoutInput,
} from "./billing-checkout.js";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const ORGANIZATION_ID = "organization_billing_test";
const BILLING_ACCOUNT_ID = "billing_account_test";

function configuration(planMappingVersion?: string) {
  return createBillingConfiguration({
    ...(planMappingVersion === undefined ? {} : { planMappingVersion }),
    cancelUrl: "http://localhost:4173/settings/billing?checkout=canceled",
    mode: "fake",
    portalReturnUrl: "http://localhost:4173/settings/billing",
    proPriceReference: STRIPE_PRO_PRICE_REFERENCE,
    proProductReference: STRIPE_PRO_PRODUCT_REFERENCE,
    starterPriceReference: STRIPE_STARTER_PRICE_REFERENCE,
    starterProductReference: STRIPE_STARTER_PRODUCT_REFERENCE,
    successUrl: "http://localhost:4173/settings/billing?checkout=success",
  });
}

function context(role: OrganizationRole): AuthorizedOrganizationContext {
  return {
    correlationId: "correlation_billing_test",
    membershipId: "membership_" + role,
    organizationId: ORGANIZATION_ID,
    principal: {
      authenticatedAt: "2026-08-14T11:59:00.000Z",
      authenticationSource: "test",
      expiresAt: "2026-08-14T13:00:00.000Z",
      principalId: "principal_" + role,
      sessionId: "session_" + role,
    },
    role,
  };
}

function snapshot(
  plan: "starter" | "pro",
  overrides: Partial<BillingSubscriptionSnapshot> = {},
): BillingSubscriptionSnapshot {
  return {
    billableSeatQuantity: 1,
    billingAccountId: BILLING_ACCOUNT_ID,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-09-14T00:00:00.000Z",
    currentPeriodId: "period_2026_08",
    currentPeriodStart: "2026-08-14T00:00:00.000Z",
    normalizedStatus: "active",
    organizationId: ORGANIZATION_ID,
    priceReference:
      plan === "starter"
        ? STRIPE_STARTER_PRICE_REFERENCE
        : STRIPE_PRO_PRICE_REFERENCE,
    productReference:
      plan === "starter"
        ? STRIPE_STARTER_PRODUCT_REFERENCE
        : STRIPE_PRO_PRODUCT_REFERENCE,
    providerCustomerReference: "cus_fake_primary",
    providerSubscriptionReference: "sub_fake_primary",
    ...overrides,
  };
}

function fixture(
  id: string,
  type: string,
  billingSnapshot: BillingSubscriptionSnapshot | null,
  created = 1_786_688_400,
): FakeBillingWebhookFixture {
  return {
    created,
    id: "evt_fake_" + id,
    snapshot: billingSnapshot,
    type,
  };
}

class TestAuditSink {
  readonly events: SensitiveAuditEvent[] = [];

  append(event: SensitiveAuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class CurrentReadBillingProvider extends FakeBillingProvider {
  current: BillingSubscriptionSnapshot | null = snapshot("starter");
  refreshHook:
    | ((
        event: VerifiedBillingWebhookEvent,
      ) => Promise<BillingSubscriptionSnapshot | null>)
    | undefined;

  refreshSubscriptionSnapshot(
    event: VerifiedBillingWebhookEvent,
  ): Promise<BillingSubscriptionSnapshot | null> {
    return this.refreshHook === undefined
      ? Promise.resolve(this.current)
      : this.refreshHook(event);
  }
}

class TestBillingPersistence implements BillingPersistence {
  readonly checkoutAttempts: BillingCheckoutAttempt[] = [];
  readonly upgradeGrantIds = new Set<string>();
  hasUpgradeAllowance(organizationId: string, creditGrantId: string) {
    return Promise.resolve(
      this.upgradeGrantIds.has(organizationId + ":" + creditGrantId),
    );
  }
  failNextCheckoutRecord = false;
  sessionAccountAvailable = true;
  account: BillingSessionAccount = {
    billingAccountId: BILLING_ACCOUNT_ID,
    expensiveOperationsEnabled: true,
    lifecycleStatus: "active",
    organizationId: ORGANIZATION_ID,
    providerCustomerReference: "cus_fake_primary",
  };
  readonly completed: CompleteBillingWebhookInput[] = [];
  readonly customerOwners = new Map<string, string>();
  readonly grants = new Map<string, CreateCreditGrantInput>();
  readonly receipts = new Map<string, BillingWebhookReceipt>();
  entitlement: CommercialEntitlementSnapshotRecord | null = null;
  projection: CommercialSubscriptionProjectionRecord | null = null;
  targetAvailable = true;

  completeWebhookEvent(input: CompleteBillingWebhookInput): Promise<void> {
    const existing = this.receipts.get(input.providerEventReference);
    if (existing === undefined) throw new Error("missing receipt");
    this.receipts.set(input.providerEventReference, {
      ...existing,
      lifecycleStatus: input.status,
    });
    this.completed.push(input);
    return Promise.resolve();
  }

  getCurrentEntitlement(): Promise<CommercialEntitlementSnapshotRecord | null> {
    return Promise.resolve(this.entitlement);
  }

  getCurrentProjection(): Promise<CommercialSubscriptionProjectionRecord | null> {
    return Promise.resolve(this.projection);
  }

  getSessionAccount(
    scope: AuthorizedOrganizationScope,
  ): Promise<BillingSessionAccount | null> {
    return Promise.resolve(
      this.sessionAccountAvailable && scope.organizationId === ORGANIZATION_ID
        ? this.account
        : null,
    );
  }

  claimCheckoutAttempt(
    scope: AuthorizedOrganizationScope,
    input: ClaimBillingCheckoutInput,
  ): Promise<BillingCheckoutAttempt> {
    if (
      !this.sessionAccountAvailable ||
      scope.organizationId !== this.account.organizationId
    )
      return Promise.reject(new Error("Checkout identity unavailable"));
    const existing =
      this.checkoutAttempts.find(
        (attempt) => attempt.requestKeySha256 === input.requestKeySha256,
      ) ??
      this.checkoutAttempts.find(
        (attempt) => attempt.state === "pending" || attempt.state === "created",
      );
    if (existing !== undefined) return Promise.resolve(existing);
    const attempt: BillingCheckoutAttempt = {
      ...input,
      organizationId: scope.organizationId,
      state: "pending",
      recordVersion: "1",
      retryBefore: new Date(NOW.getTime() + 23 * 3_600_000).toISOString(),
    };
    this.checkoutAttempts.push(attempt);
    return Promise.resolve(attempt);
  }

  recordCheckoutSession(
    _scope: AuthorizedOrganizationScope,
    attempt: BillingCheckoutAttempt,
    session: BillingCheckoutSession,
  ): Promise<BillingCheckoutAttempt> {
    if (this.failNextCheckoutRecord || !this.sessionAccountAvailable) {
      this.failNextCheckoutRecord = false;
      return Promise.reject(
        new Error("Synthetic Checkout persistence failure"),
      );
    }
    const updated: BillingCheckoutAttempt = {
      ...attempt,
      state: "created",
      recordVersion: "2",
      providerSessionReference: session.providerSessionReference,
      providerExpiresAt: session.expiresAt,
    };
    this.checkoutAttempts[this.checkoutAttempts.indexOf(attempt)] = updated;
    return Promise.resolve(updated);
  }

  retireCheckoutAttempt(
    _scope: AuthorizedOrganizationScope,
    attempt: BillingCheckoutAttempt,
    session: BillingCheckoutSession,
  ): Promise<void> {
    this.checkoutAttempts[this.checkoutAttempts.indexOf(attempt)] = {
      ...attempt,
      state: session.status === "expired" ? "expired" : "consumed",
      recordVersion: "3",
    };
    return Promise.resolve();
  }

  getMonthlyGrant(organizationId: string, subscriptionPeriodId: string) {
    const grant = this.grants.get(organizationId + ":" + subscriptionPeriodId);
    return Promise.resolve(
      grant?.subscriptionPeriod === undefined
        ? null
        : {
            planVersionId: grant.planVersionId ?? "",
            creditUnits: grant.creditUnits,
            startsAt: grant.subscriptionPeriod.startsAt,
            endsAt: grant.subscriptionPeriod.endsAt,
            sourceReference: grant.sourceReference ?? "",
            grantPolicyVersion: grant.grantPolicyVersion,
          },
    );
  }

  hasMonthlyGrant(
    organizationId: string,
    subscriptionPeriodId: string,
  ): Promise<boolean> {
    return Promise.resolve(
      this.grants.has(organizationId + ":" + subscriptionPeriodId),
    );
  }

  recordWebhookEvent(
    input: RecordBillingWebhookInput,
  ): Promise<BillingWebhookReceipt> {
    const existing = this.receipts.get(input.providerEventReference);
    if (existing !== undefined) return Promise.resolve(existing);
    const receipt: BillingWebhookReceipt = {
      lifecycleStatus: "received",
      payloadSha256: input.payloadSha256,
      webhookEventId: input.webhookEventId,
    };
    this.receipts.set(input.providerEventReference, receipt);
    return Promise.resolve(receipt);
  }

  resolveWebhookTarget(
    input: ResolveBillingWebhookTargetInput,
  ): Promise<BillingWebhookTarget | null> {
    const owner = this.customerOwners.get(input.providerCustomerReference);
    if (
      !this.targetAvailable ||
      input.organizationId !== ORGANIZATION_ID ||
      input.billingAccountId !== BILLING_ACCOUNT_ID ||
      (owner !== undefined && owner !== input.organizationId)
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...this.account,
      organizationState: "active",
    });
  }
}

class TestCommercialPersistence implements BillingCommercialPersistence {
  readonly billing: TestBillingPersistence;
  readonly grants: CreateCreditGrantInput[] = [];
  failNextGrant = false;

  constructor(billing: TestBillingPersistence) {
    this.billing = billing;
  }

  createCreditGrant(
    context: TrustedCommercialMutationContext,
    input: CreateCreditGrantInput,
  ): Promise<CreditGrantRecord> {
    if (this.failNextGrant) {
      this.failNextGrant = false;
      return Promise.reject(new Error("simulated database failure"));
    }
    const prior = this.grants.find(
      (grant) => grant.idempotencyKey === input.idempotencyKey,
    );
    if (prior && JSON.stringify(prior) !== JSON.stringify(input))
      return Promise.reject(new Error("Conflicting grant replay"));
    if (!prior) this.grants.push(input);
    if (
      input.grantPolicyVersion ===
      "cloudmarkup-paid-period-upgrade-allowance-v1"
    )
      this.billing.upgradeGrantIds.add(
        context.organizationId + ":" + input.creditGrantId,
      );
    if (input.subscriptionPeriod !== undefined) {
      this.billing.grants.set(
        context.organizationId + ":" + input.subscriptionPeriod.periodId,
        input,
      );
    }
    return Promise.resolve({
      billingAccountId: BILLING_ACCOUNT_ID,
      consumptionPriority: input.consumptionPriority,
      creditGrantId: input.creditGrantId,
      creditUnits: input.creditUnits,
      expirationPolicy: input.expirationPolicy,
      grantKind: input.grantKind,
      grantPolicyVersion: input.grantPolicyVersion,
      organizationId: context.organizationId,
      ...(input.planVersionId === undefined
        ? {}
        : { planVersionId: input.planVersionId }),
      ...(input.sourceReference === undefined
        ? {}
        : { sourceReference: input.sourceReference }),
      startsAt: input.startsAt,
      ...(input.subscriptionPeriod === undefined
        ? {}
        : { subscriptionPeriod: input.subscriptionPeriod }),
    });
  }

  updateEntitlementSnapshot(
    context: TrustedCommercialMutationContext,
    input: CommercialEntitlementSnapshotInput,
  ): Promise<CommercialEntitlementSnapshotRecord> {
    const currentVersion = Number(
      this.billing.entitlement?.recordVersion ?? "0",
    );
    const record: CommercialEntitlementSnapshotRecord = {
      billingAccountId: BILLING_ACCOUNT_ID,
      effectiveAt: input.effectiveAt,
      entitlementPolicyVersion: input.entitlementPolicyVersion,
      entitlementSnapshotId: input.entitlementSnapshotId,
      expensiveOperationsEnabled: input.expensiveOperationsEnabled,
      organizationId: context.organizationId,
      planVersionId: input.planVersionId,
      recordVersion: (currentVersion + 1).toString(),
      sourceRecordVersion: input.sourceRecordVersion,
      ...(input.subscriptionProjectionId === undefined
        ? {}
        : { subscriptionProjectionId: input.subscriptionProjectionId }),
    };
    this.billing.entitlement = record;
    return Promise.resolve(record);
  }

  updateSubscriptionProjection(
    context: TrustedCommercialMutationContext,
    input: CommercialSubscriptionProjectionInput,
  ): Promise<CommercialSubscriptionProjectionRecord> {
    const currentVersion = Number(
      this.billing.projection?.recordVersion ?? "0",
    );
    if (input.expectedRecordVersion !== currentVersion.toString()) {
      return Promise.reject(
        new CommercialPersistenceError(
          "version-conflict",
          "The subscription projection changed.",
        ),
      );
    }
    const record: CommercialSubscriptionProjectionRecord = {
      billableSeatQuantity: input.billableSeatQuantity,
      billingAccountId: BILLING_ACCOUNT_ID,
      billingProvider: input.billingProvider,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      ...(input.currentPeriodEnd === undefined
        ? {}
        : { currentPeriodEnd: input.currentPeriodEnd }),
      ...(input.currentPeriodId === undefined
        ? {}
        : { currentPeriodId: input.currentPeriodId }),
      ...(input.currentPeriodStart === undefined
        ? {}
        : { currentPeriodStart: input.currentPeriodStart }),
      effectiveAt: input.effectiveAt,
      ...(input.lastProviderEventReference === undefined
        ? {}
        : {
            lastProviderEventReference: input.lastProviderEventReference,
          }),
      normalizedStatus: input.normalizedStatus,
      organizationId: context.organizationId,
      planVersionId: input.planVersionId,
      providerCustomerReference: input.providerCustomerReference,
      ...(input.providerEventPosition === undefined
        ? {}
        : { providerEventPosition: input.providerEventPosition }),
      ...(input.providerPriceReference === undefined
        ? {}
        : { providerPriceReference: input.providerPriceReference }),
      ...(input.providerProductReference === undefined
        ? {}
        : { providerProductReference: input.providerProductReference }),
      providerSubscriptionReference: input.providerSubscriptionReference,
      recordVersion: (currentVersion + 1).toString(),
      subscriptionProjectionId: input.subscriptionProjectionId,
    };
    this.billing.projection = record;
    return Promise.resolve(record);
  }
}

function setup(
  provider: FakeBillingProvider = new FakeBillingProvider(),
  options: {
    readonly topUps?: CreditTopUpWebhookProcessor;
    readonly mappingVersion?: string;
    readonly now?: () => Date;
  } = {},
) {
  const persistence = new TestBillingPersistence();
  const commercial = new TestCommercialPersistence(persistence);
  const audit = new TestAuditSink();
  const service = new BillingApplicationService({
    auditSink: audit,
    commercial,
    configuration: configuration(options.mappingVersion),
    ...(options.topUps === undefined ? {} : { topUps: options.topUps }),
    now: options.now ?? (() => NOW),
    persistence,
    provider,
  });
  return { audit, commercial, persistence, provider, service };
}

async function process(
  service: BillingApplicationService,
  event: FakeBillingWebhookFixture,
  signature: string = FAKE_BILLING_WEBHOOK_SIGNATURE,
) {
  return service.processWebhook({
    rawBody: encodeFakeBillingWebhook(event),
    signatureHeader: signature,
  });
}

describe("paid-period Professional upgrade credits", () => {
  async function paidStarter() {
    const provider = new CurrentReadBillingProvider();
    const f = setup(provider);
    await process(
      f.service,
      fixture("paid_starter", "invoice.paid", provider.current),
    );
    return { ...f, provider };
  }
  it("adds exactly 800 credits without replacing the paid Starter grant, including repeated plan switches", async () => {
    const f = await paidStarter();
    const original = structuredClone(f.commercial.grants[0]);
    f.provider.current = snapshot("pro");
    const event = fixture(
      "upgrade",
      "customer.subscription.updated",
      f.provider.current,
    );
    expect((await process(f.service, event)).status).toBe("applied");
    expect((await process(f.service, event)).status).toBe("duplicate");
    f.provider.current = snapshot("starter");
    await process(
      f.service,
      fixture("downgrade", "customer.subscription.updated", f.provider.current),
    );
    f.provider.current = snapshot("pro");
    await process(
      f.service,
      fixture(
        "upgrade_again",
        "customer.subscription.updated",
        f.provider.current,
      ),
    );
    expect(f.commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
      "800",
    ]);
    expect(f.commercial.grants[0]).toEqual(original);
    expect(f.commercial.grants[1]).toMatchObject({
      grantKind: "promotional",
      reasonCode: "billing.paid-period.upgrade-allowance",
      expirationPolicy: {
        kind: "expires-at",
        expiresAt: snapshot("pro").currentPeriodEnd,
      },
    });
    expect(f.commercial.grants[1]?.subscriptionPeriod).toBeUndefined();
  });
  it("preserves the same supplement across current plan-mapping adoption", async () => {
    const observed = new Date("2026-09-09T12:00:00.000Z");
    const provider = new CurrentReadBillingProvider();
    const period = {
      currentPeriodId: "period_2026_09",
      currentPeriodStart: "2026-09-08T00:00:00.000Z",
      currentPeriodEnd: "2026-10-08T00:00:00.000Z",
    };
    provider.current = snapshot("starter", period);
    const f = setup(provider, { now: () => observed });
    await process(
      f.service,
      fixture("mapping_paid", "invoice.paid", provider.current),
    );
    provider.current = snapshot("pro", period);
    await process(
      f.service,
      fixture(
        "mapping_upgrade",
        "customer.subscription.updated",
        provider.current,
      ),
    );
    const original = structuredClone(f.commercial.grants);
    const next = new BillingApplicationService({
      auditSink: f.audit,
      commercial: f.commercial,
      persistence: f.persistence,
      provider,
      configuration: configuration(BILLING_SHARING_PLAN_MAPPING_VERSION),
      now: () => observed,
    });
    await process(
      next,
      fixture(
        "mapping_adoption",
        "customer.subscription.updated",
        provider.current,
      ),
    );
    expect(f.commercial.grants).toEqual(original);
    expect(f.commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
      "800",
    ]);
    expect(f.commercial.grants[1]?.planVersionId).toBe(
      f.commercial.grants[0]?.planVersionId,
    );
  });
  it("does not grant an allowance without a genuine paid period or from historical-only provider data", async () => {
    const provider = new CurrentReadBillingProvider();
    provider.current = snapshot("pro");
    const unpaid = setup(provider);
    await process(
      unpaid.service,
      fixture(
        "unpaid_upgrade",
        "customer.subscription.updated",
        provider.current,
      ),
    );
    expect(unpaid.commercial.grants).toHaveLength(0);
    const historical = setup();
    await process(
      historical.service,
      fixture("paid", "invoice.paid", snapshot("starter")),
    );
    await process(
      historical.service,
      fixture(
        "historical_upgrade",
        "customer.subscription.updated",
        snapshot("pro"),
      ),
    );
    expect(
      historical.commercial.grants.map((grant) => grant.creditUnits),
    ).toEqual(["200"]);
  });
  it.each([
    { normalizedStatus: "past-due" as const },
    { normalizedStatus: "canceled" as const },
    { currentPeriodId: "period_other" },
    { currentPeriodEnd: "2026-08-14T11:00:00.000Z" },
    { currentPeriodStart: "2026-08-15T00:00:00.000Z" },
  ])(
    "does not supplement a mismatched, inactive or expired period %j",
    async (overrides) => {
      const f = await paidStarter();
      f.provider.current = snapshot("pro", overrides);
      await process(
        f.service,
        fixture(
          "ineligible_upgrade",
          "customer.subscription.updated",
          f.provider.current,
        ),
      );
      expect(f.commercial.grants.map((grant) => grant.creditUnits)).toEqual([
        "200",
      ]);
    },
  );
  it.each(["sourceReference", "grantPolicyVersion", "creditUnits"] as const)(
    "requires matching original paid evidence: %s",
    async (field) => {
      const f = await paidStarter();
      const key = [...f.persistence.grants.keys()][0];
      const grant =
        key === undefined ? undefined : f.persistence.grants.get(key);
      if (key === undefined || grant === undefined)
        throw new Error("Expected paid Starter fixture.");
      f.persistence.grants.set(key, {
        ...grant,
        [field]: field === "creditUnits" ? "300" : "different",
      });
      f.provider.current = snapshot("pro");
      await process(
        f.service,
        fixture(
          "bad_evidence",
          "customer.subscription.updated",
          f.provider.current,
        ),
      );
      expect(f.commercial.grants.map((value) => value.creditUnits)).toEqual([
        "200",
      ]);
    },
  );
  it("retries a failed upgrade grant before completing its webhook receipt", async () => {
    const f = await paidStarter();
    f.provider.current = snapshot("pro");
    const event = fixture(
      "retry_upgrade",
      "customer.subscription.updated",
      f.provider.current,
    );
    const create = vi.spyOn(f.commercial, "createCreditGrant");
    create.mockRejectedValueOnce(new Error("temporary persistence failure"));
    await expect(process(f.service, event)).rejects.toThrow(
      "temporary persistence failure",
    );
    expect(
      f.persistence.receipts.get("evt_fake_retry_upgrade")?.lifecycleStatus,
    ).toBe("received");
    expect((await process(f.service, event)).status).toBe("applied");
    expect(f.commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
      "800",
    ]);
  });
});

describe("billing Checkout and Portal application boundary", () => {
  it("fails closed on unknown canonical subscription plans without replacing them", async () => {
    const provider = new CurrentReadBillingProvider();
    const f = setup(provider);
    await process(
      f.service,
      fixture(
        "known_initial",
        "customer.subscription.updated",
        provider.current,
      ),
    );
    if (f.persistence.projection === null)
      throw new Error("Expected actual fixture projection.");
    f.persistence.projection = {
      ...f.persistence.projection,
      planVersionId: "planver_unreviewed",
    };
    const before = f.persistence.projection;
    await expect(
      process(
        f.service,
        fixture(
          "unknown_current",
          "customer.subscription.updated",
          provider.current,
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
    expect(f.persistence.projection).toBe(before);
    expect(f.commercial.grants).toEqual([]);
    expect(
      f.persistence.receipts.get("evt_fake_unknown_current")?.lifecycleStatus,
    ).toBe("received");
  });
  it("does not adopt a sharing plan using an historical-only provider", async () => {
    const f = setup(new FakeBillingProvider(), {
      mappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
      now: () => new Date("2026-09-08T00:00:00.000Z"),
    });
    await expect(
      process(
        f.service,
        fixture(
          "no_current_read",
          "invoice.paid",
          snapshot("starter", {
            currentPeriodStart: "2026-09-07T14:35:22.000Z",
            currentPeriodEnd: "2026-10-07T14:35:22.000Z",
            currentPeriodId: "period_sharing",
          }),
          Date.parse("2026-09-07T15:00:00.000Z") / 1000,
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
    expect(f.persistence.projection).toBeNull();
    expect(f.persistence.entitlement).toBeNull();
    expect(f.commercial.grants).toEqual([]);
  });
  it("allows only server-selected Starter/Pro plans with stable idempotency", async () => {
    const { audit, provider, service } = setup();

    const starterCheckout = await service.createCheckoutSession({
      context: context("owner"),
      idempotencyKey: "checkout-request-0001",
      planKey: "starter",
    });
    await expect(
      service.createCheckoutSession({
        context: context("administrator"),
        idempotencyKey: "checkout-request-0002",
        planKey: "pro",
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    await service.createCheckoutSession({
      context: context("owner"),
      idempotencyKey: "checkout-request-0001",
      planKey: "starter",
    });

    expect(provider.checkoutSessions.map((session) => session.planKey)).toEqual(
      ["starter"],
    );
    expect(provider.checkoutSessions[0]?.idempotencyKey).toMatch(
      /^checkout:checkout_[a-f0-9]{32}$/u,
    );
    expect(starterCheckout.url).toBe(
      "http://127.0.0.1:4173/billing/fake/checkout?organization=organization_billing_test&account=billing_account_test&plan=starter",
    );
    await expect(
      service.createCheckoutSession({
        context: context("owner"),
        idempotencyKey: "checkout-request-0003",
        planKey: STRIPE_PRO_PRICE_REFERENCE,
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    } satisfies Partial<ApplicationError>);
    expect(
      audit.events.filter((event) => event.outcome === "succeeded"),
    ).toHaveLength(2);
    const existingSubscription = setup();
    existingSubscription.persistence.account = {
      ...existingSubscription.persistence.account,
      currentSubscriptionState: "active",
    };
    await expect(
      existingSubscription.service.createCheckoutSession({
        context: context("owner"),
        idempotencyKey: "checkout-request-existing-subscription",
        planKey: "starter",
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    } satisfies Partial<ApplicationError>);
    expect(existingSubscription.provider.checkoutSessions).toHaveLength(0);
  });

  it("resumes one known session after a browser remount without another provider POST", async () => {
    const { audit, commercial, persistence, provider, service } = setup();
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-before-remount-0001",
      planKey: "starter",
    };
    const original = await service.createCheckoutSession(request);
    const create = vi.spyOn(provider, "createCheckoutSession");
    const retrieve = vi.spyOn(provider, "getCheckoutSession");
    const resumed = await service.createCheckoutSession({
      ...request,
      context: context("administrator"),
      idempotencyKey: "checkout-after-remount-0002",
    });
    expect(resumed).toEqual(original);
    expect(create).not.toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledExactlyOnceWith({
      billingAccountId: persistence.account.billingAccountId,
      organizationId: persistence.account.organizationId,
      providerSessionReference:
        persistence.checkoutAttempts[0]?.providerSessionReference,
      expectedProviderCustomerReference:
        persistence.account.providerCustomerReference,
      expectedPlanKey: "starter",
    });
    expect(provider.checkoutSessions).toHaveLength(1);
    expect(persistence.checkoutAttempts).toHaveLength(1);
    expect(commercial.grants).toHaveLength(0);
    expect(audit.events.map((event) => event.outcome)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });

  it("does not return a known session to a new key with different customer parameters", async () => {
    const { persistence, provider, service } = setup();
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-customer-original-0001",
      planKey: "starter",
    };
    await service.createCheckoutSession(request);
    persistence.account = {
      ...persistence.account,
      providerCustomerReference: "cus_changed",
    };
    const create = vi.spyOn(provider, "createCheckoutSession");
    await expect(
      service.createCheckoutSession({
        ...request,
        idempotencyKey: "checkout-customer-new-0002",
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    expect(create).not.toHaveBeenCalled();
    expect(provider.checkoutSessions).toHaveLength(1);
    expect(persistence.checkoutAttempts).toHaveLength(1);
  });

  it("does not release a remount recovery URL after authorization was revoked during its GET", async () => {
    const { persistence, provider, service } = setup();
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-known-revocation-0001",
      planKey: "starter",
    };
    await service.createCheckoutSession(request);
    const retrieve = provider.getCheckoutSession.bind(provider);
    provider.getCheckoutSession = async (input) => {
      const session = await retrieve(input);
      persistence.sessionAccountAvailable = false;
      return session;
    };
    const create = vi.spyOn(provider, "createCheckoutSession");
    await expect(
      service.createCheckoutSession({
        ...request,
        idempotencyKey: "checkout-known-revocation-0002",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(create).not.toHaveBeenCalled();
    expect(persistence.checkoutAttempts[0]?.state).toBe("created");
  });

  it("recovers an unknown provider result only through the same durable attempt", async () => {
    const { service, persistence, provider } = setup();
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-unknown-0001",
      planKey: "starter",
    };
    persistence.failNextCheckoutRecord = true;
    await expect(service.createCheckoutSession(request)).rejects.toThrow(
      "Synthetic",
    );
    const create = vi.spyOn(provider, "createCheckoutSession");
    const recovered = await service.createCheckoutSession({
      ...request,
      idempotencyKey: "checkout-unknown-0002",
    });
    expect(recovered.url).toBeTypeOf("string");
    expect(create).toHaveBeenCalledOnce();
    const attemptId = persistence.checkoutAttempts[0]?.attemptId;
    if (attemptId === undefined) throw new Error("Missing attempt");
    expect(create.mock.calls[0]?.[0].idempotencyKey).toBe(
      "checkout:" + attemptId,
    );
    expect(persistence.checkoutAttempts[0]?.state).toBe("created");
    expect((await service.createCheckoutSession(request)).url).toBeTypeOf(
      "string",
    );
    expect(provider.checkoutSessions).toHaveLength(1);
    expect(persistence.checkoutAttempts).toHaveLength(1);
  });

  it("does not resume an unknown attempt with a different plan or customer", async () => {
    const { service, persistence, provider } = setup();
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-unknown-parameters-0001",
      planKey: "starter",
    };
    persistence.failNextCheckoutRecord = true;
    await expect(service.createCheckoutSession(request)).rejects.toThrow(
      "Synthetic",
    );
    const create = vi.spyOn(provider, "createCheckoutSession");
    await expect(
      service.createCheckoutSession({
        ...request,
        planKey: "pro",
        idempotencyKey: "checkout-unknown-plan-0002",
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    persistence.account = {
      ...persistence.account,
      providerCustomerReference: "cus_changed",
    };
    await expect(
      service.createCheckoutSession({
        ...request,
        idempotencyKey: "checkout-unknown-customer-0003",
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    expect(create).not.toHaveBeenCalled();
    expect(provider.checkoutSessions).toHaveLength(1);
    expect(persistence.checkoutAttempts[0]?.state).toBe("pending");
  });

  it("retains unknown attempts past the provider dedupe window without issuing another POST", async () => {
    const { service, persistence, provider } = setup();
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-old-0001",
      planKey: "starter",
    };
    persistence.failNextCheckoutRecord = true;
    await expect(service.createCheckoutSession(request)).rejects.toThrow();
    const attempt = persistence.checkoutAttempts[0];
    if (attempt === undefined) throw new Error("Missing attempt");
    persistence.checkoutAttempts[0] = {
      ...attempt,
      retryBefore: NOW.toISOString(),
    };
    await expect(service.createCheckoutSession(request)).rejects.toMatchObject({
      code: "provider-unavailable",
    });
    await expect(
      service.createCheckoutSession({
        ...request,
        idempotencyKey: "checkout-old-0002",
      }),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(provider.checkoutSessions).toHaveLength(1);
    expect(persistence.checkoutAttempts).toHaveLength(1);
  });

  it("allows a fresh key only after authentic expired-session evidence and never reuses the old key", async () => {
    const { service, persistence, provider } = setup();
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-expired-0001",
      planKey: "starter",
    };
    await service.createCheckoutSession(request);
    const session = [...provider.checkoutSnapshots.values()][0];
    if (session === undefined) throw new Error("Missing session");
    provider.checkoutSnapshots.set(session.providerSessionReference, {
      ...session,
      status: "expired",
      url: null,
    });
    await service.createCheckoutSession({
      ...request,
      idempotencyKey: "checkout-expired-0002",
      planKey: "pro",
    });
    expect(provider.checkoutSessions.map((entry) => entry.planKey)).toEqual([
      "starter",
      "pro",
    ]);
    expect(persistence.checkoutAttempts.map((entry) => entry.state)).toEqual([
      "expired",
      "created",
    ]);
    await expect(service.createCheckoutSession(request)).rejects.toMatchObject({
      code: "idempotency-conflict",
    });
    expect(provider.checkoutSessions).toHaveLength(2);
  });

  it("does not retire completed sessions from browser success or a different canceled subscription", async () => {
    const { service, persistence, provider, commercial } = setup();
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-complete-0001",
      planKey: "starter",
    };
    await service.createCheckoutSession(request);
    const session = [...provider.checkoutSnapshots.values()][0];
    if (session === undefined) throw new Error("Missing session");
    provider.checkoutSnapshots.set(session.providerSessionReference, {
      ...session,
      status: "complete",
      providerSubscriptionReference: "sub_exact",
      url: null,
    });
    const next = { ...request, idempotencyKey: "checkout-complete-0002" };
    await expect(service.createCheckoutSession(next)).rejects.toMatchObject({
      code: "idempotency-conflict",
    });
    persistence.account = {
      ...persistence.account,
      currentSubscriptionState: "canceled",
      currentSubscriptionReference: "sub_other",
    };
    await expect(service.createCheckoutSession(next)).rejects.toMatchObject({
      code: "idempotency-conflict",
    });
    persistence.account = {
      ...persistence.account,
      currentSubscriptionReference: "sub_exact",
    };
    await service.createCheckoutSession(next);
    expect(provider.checkoutSessions).toHaveLength(2);
    expect(commercial.grants).toHaveLength(0);
  });

  it("rechecks authorization after the provider wait and keeps the unknown attempt recoverable", async () => {
    const { service, persistence, provider } = setup();
    const create = provider.createCheckoutSession.bind(provider);
    provider.createCheckoutSession = async (input) => {
      const session = await create(input);
      persistence.sessionAccountAvailable = false;
      return session;
    };
    const request = {
      context: context("owner"),
      idempotencyKey: "checkout-revoked-0001",
      planKey: "starter",
    };
    await expect(service.createCheckoutSession(request)).rejects.toThrow(
      "Synthetic",
    );
    expect(persistence.checkoutAttempts[0]?.state).toBe("pending");
    persistence.sessionAccountAvailable = true;
    provider.createCheckoutSession = create;
    await service.createCheckoutSession(request);
    expect(provider.checkoutSessions).toHaveLength(1);
  });

  it("requires current-owner authorization and recent authentication for Portal", async () => {
    const { provider, service } = setup();

    await expect(
      service.createPortalSession({
        context: context("editor"),
        idempotencyKey: "portal-request-0001",
      }),
    ).rejects.toMatchObject({
      code: "access_denied",
    } satisfies Partial<ApplicationError>);
    const staleOwner = context("owner");
    await expect(
      service.createPortalSession({
        context: {
          ...staleOwner,
          principal: {
            ...staleOwner.principal,
            authenticatedAt: "2026-08-14T10:00:00.000Z",
          },
        },
        idempotencyKey: "portal-request-stale-auth",
      }),
    ).rejects.toMatchObject({
      code: "access_denied",
    } satisfies Partial<ApplicationError>);

    const withoutCustomer = setup();
    withoutCustomer.persistence.account = {
      billingAccountId: BILLING_ACCOUNT_ID,
      expensiveOperationsEnabled: true,
      lifecycleStatus: "active",
      organizationId: ORGANIZATION_ID,
    };
    await expect(
      withoutCustomer.service.createPortalSession({
        context: context("owner"),
        idempotencyKey: "portal-request-no-customer",
      }),
    ).rejects.toMatchObject({
      code: "subscription-required",
    } satisfies Partial<BillingApplicationError>);

    const hosted = await service.createPortalSession({
      context: context("owner"),
      idempotencyKey: "portal-request-0002",
    });
    expect(hosted.url).toBe(
      "http://127.0.0.1:4173/billing/fake/portal?organization=organization_billing_test&account=billing_account_test",
    );
    expect(provider.portalSessions).toHaveLength(1);
  });
});

describe("verified billing webhook orchestration", () => {
  it.each(["canceled", "past-due", "paused", "incomplete", "pending"] as const)(
    "keeps trial authority independent from a fresh %s paid observation",
    async (normalizedStatus) => {
      const provider = new CurrentReadBillingProvider();
      const f = setup(provider);
      const trial: CommercialEntitlementSnapshotRecord = {
        billingAccountId: BILLING_ACCOUNT_ID,
        effectiveAt: NOW.toISOString(),
        entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
        entitlementSnapshotId: "entitlement_trial_synthetic",
        expensiveOperationsEnabled: true,
        organizationId: ORGANIZATION_ID,
        planVersionId: STAFF_TRIAL_PLAN_VERSION,
        recordVersion: "1",
        sourceRecordVersion: "1",
      };
      f.persistence.entitlement = trial;
      provider.current = snapshot("pro", { normalizedStatus });
      const event = fixture(
        "trial_inactive_paid",
        "customer.subscription.updated",
        provider.current,
      );
      expect((await process(f.service, event)).status).toBe("applied");
      expect(f.persistence.projection?.normalizedStatus).toBe(normalizedStatus);
      expect(f.persistence.entitlement).toBe(trial);
      expect(f.commercial.grants).toEqual([]);

      const providerSubscriptionReference =
        normalizedStatus === "canceled"
          ? "sub_fake_trial_paid_conversion"
          : "sub_fake_primary";
      provider.current = snapshot("pro", { providerSubscriptionReference });
      await process(
        f.service,
        fixture(
          "trial_paid_conversion",
          "customer.subscription.updated",
          provider.current,
        ),
      );
      expect(f.persistence.entitlement.planVersionId).not.toBe(
        STAFF_TRIAL_PLAN_VERSION,
      );
      const paid = f.persistence.entitlement;
      provider.current = snapshot("pro", {
        normalizedStatus: "canceled",
        providerSubscriptionReference,
      });
      await process(
        f.service,
        fixture(
          "trial_paid_canceled",
          "customer.subscription.updated",
          provider.current,
        ),
      );
      expect(f.persistence.entitlement.planVersionId).toBe(paid.planVersionId);
      expect(f.persistence.entitlement.expensiveOperationsEnabled).toBe(false);
      expect(f.commercial.grants).toEqual([]);
    },
  );
  it.each(["past-due", "paused", "incomplete", "pending"] as const)(
    "applies a fresh %s state even when its same-second event ID sorts earlier",
    async (normalizedStatus) => {
      const provider = new CurrentReadBillingProvider();
      const { commercial, persistence, service } = setup(provider);
      await process(
        service,
        fixture(
          "z_active",
          "customer.subscription.updated",
          snapshot("starter"),
        ),
      );
      expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(true);
      provider.current = snapshot("starter", { normalizedStatus });
      const event = fixture(
        "a_current_state",
        "customer.subscription.updated",
        snapshot("starter"),
      );
      expect((await process(service, event)).status).toBe("applied");
      expect(persistence.projection?.normalizedStatus).toBe(normalizedStatus);
      expect(persistence.projection?.lastProviderEventReference).toBe(event.id);
      expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(false);
      expect((await process(service, event)).status).toBe("duplicate");
      expect(commercial.grants).toEqual([]);
    },
  );

  it("applies fresh upgrades, downgrades and recovery independently of historical event time", async () => {
    const provider = new CurrentReadBillingProvider();
    const { commercial, persistence, service } = setup(provider);
    await process(
      service,
      fixture(
        "z_starter",
        "customer.subscription.updated",
        snapshot("starter"),
      ),
    );
    provider.current = snapshot("pro", { normalizedStatus: "past-due" });
    await process(
      service,
      fixture(
        "b_pro",
        "customer.subscription.updated",
        snapshot("starter"),
        1_786_668_000,
      ),
    );
    expect(persistence.projection?.planVersionId).toBe(
      "planver_pro_2026_08_14_v2",
    );
    expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(false);
    expect(persistence.projection?.effectiveAt).toBe(NOW.toISOString());
    provider.current = snapshot("starter");
    await process(
      service,
      fixture(
        "a_recovered",
        "customer.subscription.updated",
        snapshot("pro"),
        1_786_667_000,
      ),
    );
    expect(persistence.projection?.planVersionId).toBe(
      "planver_starter_2026_08_14_v1",
    );
    expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(true);
    expect(commercial.grants).toEqual([]);
  });

  it("preserves identical current projections while recovering an earlier paid invoice once", async () => {
    const provider = new CurrentReadBillingProvider();
    const { commercial, persistence, service } = setup(provider);
    await process(
      service,
      fixture(
        "z_subscription",
        "customer.subscription.updated",
        snapshot("starter"),
      ),
    );
    const projection = persistence.projection;
    const entitlement = persistence.entitlement;
    const event = fixture("a_paid", "invoice.paid", snapshot("starter"));
    expect((await process(service, event)).status).toBe("applied");
    expect((await process(service, event)).status).toBe("duplicate");
    expect(persistence.projection).toBe(projection);
    expect(persistence.entitlement).toBe(entitlement);
    expect(commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
    ]);
  });

  it.each([
    { organizationId: "organization_other" },
    { billingAccountId: "billing_account_other" },
    { providerCustomerReference: "cus_other" },
    { providerSubscriptionReference: "sub_other" },
  ])(
    "rejects identity changes across the final current-state read (%j)",
    async (changes) => {
      const provider = new CurrentReadBillingProvider();
      provider.current = snapshot("pro", changes);
      const { commercial, persistence, service } = setup(provider);
      expect(
        (
          await process(
            service,
            fixture(
              "changed_identity",
              "customer.subscription.updated",
              snapshot("starter"),
            ),
          )
        ).status,
      ).toBe("rejected");
      expect(persistence.projection).toBeNull();
      expect(persistence.entitlement).toBeNull();
      expect(commercial.grants).toEqual([]);
    },
  );

  it.each(["starter", "pro"] as const)(
    "rejects an in-flight stale observation against %s by its pre-fetch version and refreshes on queue retry",
    async (initialPlan) => {
      const provider = new CurrentReadBillingProvider();
      provider.current = snapshot(initialPlan);
      const { commercial, persistence, service } = setup(provider);
      await process(
        service,
        fixture(
          "initial",
          "customer.subscription.updated",
          snapshot(initialPlan),
        ),
      );
      let releaseStale: (() => void) | undefined;
      const stalePaused = new Promise<void>((resolve) => {
        releaseStale = resolve;
      });
      let observedStale: (() => void) | undefined;
      const staleStarted = new Promise<void>((resolve) => {
        observedStale = resolve;
      });
      const stale = fixture(
        "z_stale_upgrade",
        "customer.subscription.updated",
        snapshot("pro"),
      );
      provider.refreshHook = async (event) => {
        if (event.providerEventReference === stale.id) {
          const oldObservation = snapshot("pro");
          observedStale?.();
          await stalePaused;
          return oldObservation;
        }
        return snapshot("pro", { normalizedStatus: "past-due" });
      };
      const inFlight = process(service, stale);
      await staleStarted;
      expect(
        (
          await process(
            service,
            fixture(
              "a_payment_failure",
              "customer.subscription.updated",
              snapshot("pro"),
            ),
          )
        ).status,
      ).toBe("applied");
      const currentProjection = persistence.projection;
      releaseStale?.();
      await expect(inFlight).rejects.toMatchObject({
        code: "version-conflict",
      });
      expect(persistence.projection).toBe(currentProjection);
      expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(false);
      expect(persistence.receipts.get(stale.id)?.lifecycleStatus).toBe(
        "received",
      );
      provider.refreshHook = undefined;
      provider.current = snapshot("pro", { normalizedStatus: "past-due" });
      expect((await process(service, stale)).status).toBe("applied");
      expect(persistence.projection).toBe(currentProjection);
      expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(false);
      expect(commercial.grants).toEqual([]);
    },
  );

  it("keeps cancellation terminal even for a fresh-read adapter", async () => {
    const provider = new CurrentReadBillingProvider();
    provider.current = snapshot("starter", { normalizedStatus: "canceled" });
    const { persistence, service } = setup(provider);
    await process(
      service,
      fixture("z_canceled", "customer.subscription.deleted", provider.current),
    );
    const projection = persistence.projection;
    provider.current = snapshot("starter");
    expect(
      (
        await process(
          service,
          fixture(
            "a_stale_active",
            "customer.subscription.updated",
            snapshot("starter"),
          ),
        )
      ).status,
    ).toBe("rejected");
    expect(persistence.projection).toBe(projection);
    expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(false);
  });

  it("rejects invalid signatures and unknown Product/Price mappings", async () => {
    const { persistence, service } = setup();

    await expect(
      process(
        service,
        fixture("bad_signature", "invoice.paid", snapshot("starter")),
        "wrong-signature",
      ),
    ).rejects.toBeInstanceOf(BillingApplicationError);

    const result = await process(
      service,
      fixture(
        "unknown_price",
        "invoice.paid",
        snapshot("starter", {
          priceReference: "price_unknown",
          productReference: "prod_unknown",
        }),
      ),
    );
    expect(result.status).toBe("rejected");
    expect(persistence.projection).toBeNull();
    expect(
      persistence.receipts.get("evt_fake_unknown_price")?.lifecycleStatus,
    ).toBe("failed");
  });

  it("starts an initial Pro subscription with exactly one 1,000-credit period grant", async () => {
    const { commercial, persistence, service } = setup();

    expect(
      (
        await process(
          service,
          fixture("initial_pro_paid", "invoice.paid", snapshot("pro")),
        )
      ).status,
    ).toBe("applied");
    expect(commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "1000",
    ]);
    expect(persistence.projection?.planVersionId).toBe(
      "planver_pro_2026_08_14_v2",
    );
  });

  it("deduplicates monthly Starter/Pro grants and upgrades the projection", async () => {
    const { commercial, persistence, service } = setup();
    const starterEvent = fixture(
      "starter_paid",
      "invoice.paid",
      snapshot("starter"),
    );

    expect((await process(service, starterEvent)).status).toBe("applied");
    expect((await process(service, starterEvent)).status).toBe("duplicate");
    expect(commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
    ]);

    const proEvent = fixture(
      "pro_paid",
      "invoice.paid",
      snapshot("pro", {
        currentPeriodEnd: "2026-10-14T00:00:00.000Z",
        currentPeriodId: "period_2026_09",
        currentPeriodStart: "2026-09-14T00:00:00.000Z",
      }),
      1_789_260_000,
    );
    expect((await process(service, proEvent)).status).toBe("applied");
    expect(commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
      "1000",
    ]);
    expect(persistence.projection?.planVersionId).toBe(
      "planver_pro_2026_08_14_v2",
    );
  });

  it("projects Pro-to-Starter switching without inventing proration grants", async () => {
    const { commercial, persistence, service } = setup();

    await process(
      service,
      fixture("pro_update", "customer.subscription.updated", snapshot("pro")),
    );
    const switched = await process(
      service,
      fixture(
        "starter_update",
        "customer.subscription.updated",
        snapshot("starter"),
        1_786_688_500,
      ),
    );

    expect(switched.status).toBe("applied");
    expect(persistence.projection?.planVersionId).toBe(
      "planver_starter_2026_08_14_v1",
    );
    expect(commercial.grants).toHaveLength(0);
  });

  it("projects payment failure, recovery, period-end cancellation, and deletion", async () => {
    const { commercial, persistence, service } = setup();

    await process(
      service,
      fixture(
        "payment_failed",
        "invoice.payment_failed",
        snapshot("pro", { normalizedStatus: "past-due" }),
      ),
    );
    expect(persistence.projection?.normalizedStatus).toBe("past-due");
    expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(false);

    const recovered = await process(
      service,
      fixture(
        "payment_recovered",
        "invoice.paid",
        snapshot("pro"),
        1_786_688_500,
      ),
    );
    expect(recovered.status).toBe("applied");
    expect(persistence.projection?.normalizedStatus).toBe("active");
    expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(true);
    expect(commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "1000",
    ]);

    await process(
      service,
      fixture(
        "cancel_at_period_end",
        "customer.subscription.updated",
        snapshot("pro", { cancelAtPeriodEnd: true }),
        1_786_688_600,
      ),
    );
    expect(persistence.projection?.cancelAtPeriodEnd).toBe(true);
    expect(persistence.projection?.normalizedStatus).toBe("active");

    await process(
      service,
      fixture(
        "deleted",
        "customer.subscription.deleted",
        snapshot("pro", {
          cancelAtPeriodEnd: false,
          normalizedStatus: "canceled",
        }),
        1_786_688_700,
      ),
    );
    expect(persistence.projection?.normalizedStatus).toBe("canceled");
    expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(false);
  });

  it("ignores older provider events after a newer projection", async () => {
    const { persistence, service } = setup();

    await process(
      service,
      fixture(
        "newer",
        "customer.subscription.updated",
        snapshot("pro"),
        1_786_669_000,
      ),
    );
    const priorPosition = persistence.projection?.providerEventPosition;
    const result = await process(
      service,
      fixture(
        "older",
        "customer.subscription.updated",
        snapshot("starter"),
        1_786_668_000,
      ),
    );

    expect(result.status).toBe("ignored-out-of-order");
    expect(persistence.projection?.providerEventPosition).toBe(priorPosition);
    expect(persistence.projection?.planVersionId).toBe(
      "planver_pro_2026_08_14_v2",
    );
  });

  it("applies reversed same-second cancellation and rejects stale active resurrection", async () => {
    const { commercial, persistence, service } = setup();
    await process(
      service,
      fixture("z_active", "customer.subscription.updated", snapshot("pro")),
    );
    const formerPosition = persistence.projection?.providerEventPosition;
    const cancellation = fixture(
      "a_canceled",
      "customer.subscription.deleted",
      snapshot("pro", { normalizedStatus: "canceled" }),
    );
    expect((await process(service, cancellation)).status).toBe("applied");
    expect(persistence.projection?.normalizedStatus).toBe("canceled");
    expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(false);
    expect(persistence.projection?.lastProviderEventReference).toBe(
      cancellation.id,
    );
    expect(persistence.projection?.providerEventPosition).toBe(
      "00000000001786688400:" + cancellation.id,
    );
    expect(
      formerPosition !== undefined &&
        formerPosition > (persistence.projection?.providerEventPosition ?? ""),
    ).toBe(true);
    const canceledProjection = persistence.projection;
    const canceledEntitlement = persistence.entitlement;
    expect(
      (
        await process(
          service,
          fixture(
            "zz_stale_active",
            "customer.subscription.updated",
            snapshot("pro"),
          ),
        )
      ).status,
    ).toBe("rejected");
    expect(persistence.projection).toEqual(canceledProjection);
    expect(persistence.entitlement).toEqual(canceledEntitlement);
    expect((await process(service, cancellation)).status).toBe("duplicate");
    expect(commercial.grants).toEqual([]);
  });

  it("allows a genuinely new owned subscription after cancellation even if its same-second ID sorts lower", async () => {
    const { persistence, service } = setup();
    await process(
      service,
      fixture(
        "z_canceled",
        "customer.subscription.deleted",
        snapshot("pro", { normalizedStatus: "canceled" }),
      ),
    );
    const replacement = fixture(
      "a_replacement",
      "customer.subscription.created",
      snapshot("starter", {
        providerSubscriptionReference: "sub_fake_replacement",
      }),
    );
    expect((await process(service, replacement)).status).toBe("applied");
    expect(persistence.projection?.providerSubscriptionReference).toBe(
      "sub_fake_replacement",
    );
    expect(persistence.projection?.normalizedStatus).toBe("active");
    expect(persistence.entitlement?.expensiveOperationsEnabled).toBe(true);
    expect(
      (
        await process(
          service,
          fixture(
            "zz_old_cancellation",
            "customer.subscription.deleted",
            snapshot("pro", { normalizedStatus: "canceled" }),
          ),
        )
      ).status,
    ).toBe("rejected");
    expect(persistence.projection?.providerSubscriptionReference).toBe(
      "sub_fake_replacement",
    );
  });

  it.each(["starter", "pro"] as const)(
    "grants the current %s paid period once when a newer subscription event arrived first",
    async (plan) => {
      for (const sameSecond of [false, true]) {
        const { commercial, persistence, service } = setup();
        await process(
          service,
          fixture(
            "z_newer_subscription",
            "customer.subscription.updated",
            snapshot(plan),
            sameSecond ? 1_786_688_400 : 1_786_688_500,
          ),
        );
        const projection = persistence.projection;
        const entitlement = persistence.entitlement;
        const paid = fixture("a_late_paid", "invoice.paid", snapshot(plan));
        expect((await process(service, paid)).status).toBe("applied");
        expect((await process(service, paid)).status).toBe("duplicate");
        expect(
          (
            await process(
              service,
              fixture("b_same_period_paid", "invoice.paid", snapshot(plan)),
            )
          ).status,
        ).toBe("applied");
        expect(commercial.grants).toHaveLength(1);
        expect(commercial.grants[0]).toMatchObject({
          creditUnits: plan === "starter" ? "200" : "1000",
          subscriptionPeriod: { periodId: "period_2026_08" },
        });
        expect(persistence.projection).toBe(projection);
        expect(persistence.entitlement).toBe(entitlement);
        expect(persistence.receipts.get(paid.id)?.lifecycleStatus).toBe(
          "processed",
        );
      }
    },
  );

  it.each([
    { currentPeriodId: "period_newer" },
    { currentPeriodStart: "2026-08-15T00:00:00.000Z" },
    { currentPeriodEnd: "2026-09-15T00:00:00.000Z" },
    { currentPeriodId: null, currentPeriodStart: null, currentPeriodEnd: null },
    { normalizedStatus: "canceled" as const },
    { normalizedStatus: "past-due" as const },
  ])(
    "does not grant a stale paid invoice against a different current period or inactive projection (%j)",
    async (current) => {
      const { commercial, persistence, service } = setup();
      await process(
        service,
        fixture(
          "newer_period",
          "customer.subscription.updated",
          snapshot("starter", current),
          1_786_688_500,
        ),
      );
      const projection = persistence.projection;
      const entitlement = persistence.entitlement;
      expect(
        (
          await process(
            service,
            fixture("older_paid", "invoice.paid", snapshot("starter")),
          )
        ).status,
      ).toBe("ignored-out-of-order");
      expect(commercial.grants).toHaveLength(0);
      expect(persistence.projection).toBe(projection);
      expect(persistence.entitlement).toBe(entitlement);
    },
  );

  it("does not fund a changed plan or bind a late invoice to a different provider identity", async () => {
    for (const current of [
      snapshot("pro"),
      snapshot("starter", { providerSubscriptionReference: "sub_fake_other" }),
      snapshot("starter", { providerCustomerReference: "cus_fake_other" }),
    ]) {
      const { commercial, persistence, service } = setup();
      await process(
        service,
        fixture(
          "newer_identity",
          "customer.subscription.updated",
          current,
          1_786_688_500,
        ),
      );
      const projection = persistence.projection;
      const entitlement = persistence.entitlement;
      const result = await process(
        service,
        fixture("older_paid", "invoice.paid", snapshot("starter")),
      );
      expect(["rejected", "ignored-out-of-order"]).toContain(result.status);
      expect(commercial.grants).toHaveLength(0);
      expect(persistence.projection).toBe(projection);
      expect(persistence.entitlement).toBe(entitlement);
    }
  });

  it("retries a late paid grant failure without rewriting newer projection or entitlement evidence", async () => {
    const { commercial, persistence, service } = setup();
    await process(
      service,
      fixture(
        "newer_subscription",
        "customer.subscription.updated",
        snapshot("starter"),
        1_786_688_500,
      ),
    );
    const projection = persistence.projection;
    const entitlement = persistence.entitlement;
    commercial.failNextGrant = true;
    const paid = fixture("older_paid", "invoice.paid", snapshot("starter"));
    await expect(process(service, paid)).rejects.toThrow(
      "simulated database failure",
    );
    expect(persistence.receipts.get(paid.id)?.lifecycleStatus).toBe("received");
    expect((await process(service, paid)).status).toBe("applied");
    expect((await process(service, paid)).status).toBe("duplicate");
    expect(commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
    ]);
    expect(persistence.projection).toBe(projection);
    expect(persistence.entitlement).toBe(entitlement);
  });

  it("rejects unavailable deleted or merged organizations and cross-tenant provider ownership", async () => {
    const deleted = setup();
    deleted.persistence.targetAvailable = false;
    expect(
      (
        await process(
          deleted.service,
          fixture("deleted_org", "invoice.paid", snapshot("starter")),
        )
      ).status,
    ).toBe("rejected");
    expect(deleted.commercial.grants).toHaveLength(0);

    const crossTenant = setup();
    crossTenant.persistence.customerOwners.set(
      "cus_fake_primary",
      "organization_other",
    );
    expect(
      (
        await process(
          crossTenant.service,
          fixture("cross_tenant", "invoice.paid", snapshot("starter")),
        )
      ).status,
    ).toBe("rejected");
    expect(crossTenant.persistence.projection).toBeNull();
  });

  it("retries incomplete database work without duplicating projection or grants", async () => {
    const { commercial, persistence, service } = setup();
    commercial.failNextGrant = true;
    const paid = fixture("retry_paid", "invoice.paid", snapshot("starter"));

    await expect(process(service, paid)).rejects.toThrow(
      "simulated database failure",
    );
    expect(
      persistence.receipts.get("evt_fake_retry_paid")?.lifecycleStatus,
    ).toBe("received");
    expect(persistence.projection?.recordVersion).toBe("1");

    expect((await process(service, paid)).status).toBe("applied");
    expect(persistence.projection?.recordVersion).toBe("1");
    expect(commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
    ]);
  });

  it("persists only event digests and safe evidence, never payload payment data", async () => {
    const { persistence, service } = setup();
    const event = fixture("redaction", "invoice.paid", snapshot("starter"));
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        ...event,
        card_number: "4242424242424242",
        stripe_secret_key: "sk_test_should_not_persist",
      }),
    );

    await service.processWebhook({
      rawBody,
      signatureHeader: FAKE_BILLING_WEBHOOK_SIGNATURE,
    });
    const evidence = JSON.stringify({
      completed: persistence.completed,
      receipts: [...persistence.receipts.entries()],
    });
    expect(evidence).not.toContain("4242424242424242");
    expect(evidence).not.toContain("sk_test_should_not_persist");
    expect(evidence).toContain("payloadSha256");
  });
});

describe("approved 1250-credit Pro renewals", () => {
  it("preserves an old supplement when the new mapping adopts the same paid period", async () => {
    const provider = new CurrentReadBillingProvider();
    const now = () => new Date("2026-10-01T12:00:00.000Z");
    const period = {
      currentPeriodStart: "2026-10-01T00:00:00.000Z",
      currentPeriodEnd: "2026-11-01T00:00:00.000Z",
      currentPeriodId: "period_mapping_upgrade",
    };
    provider.current = snapshot("starter", period);
    const f = setup(provider, {
      mappingVersion: BILLING_EXPORT_PLAN_MAPPING_VERSION,
      now,
    });
    await process(
      f.service,
      fixture("previous_paid_starter", "invoice.paid", provider.current),
    );
    provider.current = snapshot("pro", period);
    await process(
      f.service,
      fixture(
        "previous_supplement",
        "customer.subscription.updated",
        provider.current,
      ),
    );
    expect(f.commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
      "800",
    ]);
    const original = structuredClone(f.commercial.grants);
    const next = new BillingApplicationService({
      auditSink: f.audit,
      commercial: f.commercial,
      configuration: configuration(BILLING_CREDIT_PLAN_MAPPING_VERSION),
      now,
      persistence: f.persistence,
      provider,
    });
    await expect(
      process(
        next,
        fixture(
          "mapping_adoption",
          "customer.subscription.updated",
          provider.current,
        ),
      ),
    ).resolves.toMatchObject({ status: "applied" });
    expect(f.commercial.grants).toEqual(original);
  });
  it("preserves the previous paid period and grants the new renewal once with period-end expiry", async () => {
    const provider = new CurrentReadBillingProvider();
    let now = new Date("2026-09-30T12:00:00.000Z");
    const f = setup(provider, {
      mappingVersion: BILLING_CREDIT_PLAN_MAPPING_VERSION,
      now: () => now,
    });
    provider.current = snapshot("pro", {
      currentPeriodStart: "2026-09-20T00:00:00.000Z",
      currentPeriodEnd: "2026-10-20T00:00:00.000Z",
      currentPeriodId: "period_september",
    });
    await process(
      f.service,
      fixture(
        "credit_old_period",
        "invoice.paid",
        provider.current,
        Math.floor(now.getTime() / 1000),
      ),
    );
    expect(f.commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "1000",
    ]);
    const original = structuredClone(f.commercial.grants[0]);
    now = new Date("2026-10-20T12:00:00.000Z");
    provider.current = snapshot("pro", {
      currentPeriodStart: "2026-10-20T00:00:00.000Z",
      currentPeriodEnd: "2026-11-20T00:00:00.000Z",
      currentPeriodId: "period_october",
    });
    const event = fixture(
      "credit_renewal",
      "invoice.paid",
      provider.current,
      Math.floor(now.getTime() / 1000),
    );
    await process(f.service, event);
    await process(f.service, event);
    await process(f.service, {
      ...event,
      id: "evt_fake_credit_renewal_duplicate",
    });
    expect(f.commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "1000",
      "1250",
    ]);
    expect(f.commercial.grants[0]).toEqual(original);
    expect(f.commercial.grants[1]).toMatchObject({
      planVersionId: "planver_pro_2026_09_30_v5",
      expirationPolicy: {
        kind: "expires-at",
        expiresAt: "2026-11-20T00:00:00.000Z",
      },
    });
    expect(
      configuration(BILLING_CREDIT_PLAN_MAPPING_VERSION).plans.pro,
    ).toMatchObject({
      monthlyPriceMicros: 39_000_000,
      monthlyCreditUnits: 1250,
    });
  });
  it("adds only the paid Starter-to-Pro difference in an eligible period", async () => {
    const provider = new CurrentReadBillingProvider();
    const now = new Date("2026-10-01T12:00:00.000Z");
    const period = {
      currentPeriodStart: "2026-10-01T00:00:00.000Z",
      currentPeriodEnd: "2026-11-01T00:00:00.000Z",
      currentPeriodId: "period_credit_upgrade",
    };
    provider.current = snapshot("starter", period);
    const f = setup(provider, {
      mappingVersion: BILLING_CREDIT_PLAN_MAPPING_VERSION,
      now: () => now,
    });
    await process(
      f.service,
      fixture(
        "credit_paid_starter",
        "invoice.paid",
        provider.current,
        Math.floor(now.getTime() / 1000),
      ),
    );
    provider.current = snapshot("pro", period);
    await process(
      f.service,
      fixture(
        "credit_upgrade",
        "customer.subscription.updated",
        provider.current,
        Math.floor(now.getTime() / 1000),
      ),
    );
    expect(f.commercial.grants.map((grant) => grant.creditUnits)).toEqual([
      "200",
      "1050",
    ]);
  });
});

describe("one-time purchase webhook receipts", () => {
  it.each(["applied", "duplicate", "rejected"] as const)(
    "records %s without altering subscription allowances",
    async (status) => {
      const topUps = vi.fn<CreditTopUpWebhookProcessor>(() =>
        Promise.resolve({
          organizationId: ORGANIZATION_ID,
          billingAccountId: BILLING_ACCOUNT_ID,
          status,
        }),
      );
      const f = setup(new FakeBillingProvider(), { topUps });
      const event = fixture(
        "credit_purchase",
        "checkout.session.completed",
        null,
      );
      expect(await process(f.service, event)).toEqual({ status });
      expect(f.persistence.completed).toHaveLength(1);
      expect(f.persistence.completed[0]).toMatchObject({
        organizationId: ORGANIZATION_ID,
        billingAccountId: BILLING_ACCOUNT_ID,
        status: status === "rejected" ? "failed" : "processed",
      });
      if (status === "rejected")
        expect(f.persistence.completed[0]?.safeFailureCode).toBe(
          "credit-purchase-reconciliation-required",
        );
      expect(f.commercial.grants).toHaveLength(0);
      expect(f.persistence.projection).toBeNull();
      expect(await process(f.service, event)).toEqual({ status: "duplicate" });
      expect(topUps).toHaveBeenCalledOnce();
    },
  );
  it("never invokes fulfillment for an invalid webhook signature", async () => {
    const topUps = vi.fn<CreditTopUpWebhookProcessor>(() =>
      Promise.resolve(null),
    );
    const f = setup(new FakeBillingProvider(), { topUps });
    await expect(
      process(
        f.service,
        fixture("unverified", "checkout.session.completed", null),
        "invalid",
      ),
    ).rejects.toBeInstanceOf(BillingApplicationError);
    expect(topUps).not.toHaveBeenCalled();
    expect(f.persistence.receipts.size).toBe(0);
  });
});
