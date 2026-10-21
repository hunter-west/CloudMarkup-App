import type {
  CreditTopUpProvider,
  CreditTopUpWebhookProcessor,
} from "./billing-top-ups.js";
import { createHash } from "node:crypto";

import {
  ENTITLEMENT_POLICY_VERSION,
  STAFF_TRIAL_PLAN_VERSION,
  USAGE_DISPOSITION_POLICY_VERSION,
} from "@cloudmarkup/domain";

import {
  permissionsForRole,
  runSensitiveAction,
  type AuthorizedOrganizationContext,
  type SensitiveAuditSink,
} from "./authorization.js";
import {
  CommercialPersistenceError,
  type CommercialEntitlementSnapshotRecord,
  type CommercialPersistenceRepository,
  type CommercialSubscriptionProjectionRecord,
  type TrustedCommercialAccountingContext,
} from "./commercial-persistence.js";
import { ApplicationError } from "./errors.js";
import type { AuthorizedOrganizationScope } from "./persistence.js";
import {
  BILLING_PLAN_MAPPING_VERSION,
  supportsBillingDeliveryMapping,
  billingPlanVersionForMapping,
  billingMonthlyCreditsForPlanVersion,
  billingPlanKeyForVersion,
  isBillingPlanMappingVersion,
  selectBillingSubscriptionPlan,
  type BillingMappedPlanVersionId,
  type BillingPlanMappingVersion,
} from "./billing-plan-mapping.js";
export {
  BILLING_CREDIT_PLAN_MAPPING_VERSION,
  BILLING_EXPORT_PLAN_MAPPING_VERSION,
  BILLING_PLAN_MAPPING_VERSION,
  BILLING_SHARING_PLAN_MAPPING_VERSION,
} from "./billing-plan-mapping.js";
import {
  createGuardedCheckoutSession,
  type BillingCheckoutPersistence,
  type BillingCheckoutSession,
} from "./billing-checkout.js";
import {
  BillingApplicationError,
  type BillingApplicationErrorCode,
} from "./billing-errors.js";

export {
  BillingApplicationError,
  type BillingApplicationErrorCode,
} from "./billing-errors.js";

export const BILLING_CONFIGURATION_VERSION =
  "cloudmarkup-billing-controlled-beta-2026-08-28-v2" as const;
export const BILLING_WEBHOOK_ENDPOINT_VERSION =
  "cloudmarkup-stripe-webhook-2026-08-28-v1" as const;
export const BILLING_PROVIDER_KEY = "stripe" as const;
export const BILLING_MONTHLY_GRANT_POLICY_VERSION =
  "cloudmarkup-stripe-monthly-grants-v1" as const;
export const BILLING_UPGRADE_GRANT_POLICY_VERSION =
  "cloudmarkup-paid-period-upgrade-allowance-v1" as const;
export const BILLING_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const BILLING_WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
] as const;

export type BillingWebhookEventType =
  (typeof BILLING_WEBHOOK_EVENT_TYPES)[number];
export type BillingPlanKey = "starter" | "pro";
export type BillingRuntimeMode =
  "disabled" | "fake" | "stripe-sandbox" | "stripe-live";
export type StripeEnvironment = "test" | "live";

export interface BillingPlanMapping {
  readonly currency: "USD";
  readonly monthlyCreditUnits: 200 | 1000 | 1250;
  readonly monthlyPriceMicros: 9_000_000 | 39_000_000;
  readonly planKey: BillingPlanKey;
  readonly planVersionId: BillingMappedPlanVersionId;
  readonly priceReference: string;
  readonly productReference: string;
}

export interface BillingConfiguration {
  readonly cancelUrl: string;
  readonly cancellationPolicy: Readonly<{
    readonly defaultTiming: "period-end";
    readonly immediateCancellation: "explicit-operator-approval-required";
    readonly prorationPolicy: "business-decision-required";
  }>;
  readonly configurationVersion: typeof BILLING_CONFIGURATION_VERSION;
  readonly currency: "USD";
  readonly gracePolicy: Readonly<{
    readonly durationHours: number;
    readonly expensiveOperationsEnabled: false;
    readonly policyVersion: string;
  }>;
  readonly mode: BillingRuntimeMode;
  readonly planMappingVersion: BillingPlanMappingVersion;
  readonly plans: Readonly<Record<BillingPlanKey, BillingPlanMapping>>;
  readonly portalConfigurationReference?: string;
  readonly portalReturnUrl: string;
  readonly publishableKeyIdentifier: null;
  readonly secretReferences: Readonly<{
    readonly apiKey: string;
    readonly previousWebhookSigningSecret?: string;
    readonly webhookSigningSecret: string;
  }>;
  readonly stripeEnvironment: StripeEnvironment;
  readonly successUrl: string;
  readonly trialPolicy: "no-trial";
  readonly webhookEndpointVersion: typeof BILLING_WEBHOOK_ENDPOINT_VERSION;
  readonly webhookSignatureToleranceSeconds: number;
}

export interface CreateBillingConfigurationInput {
  readonly cancelUrl: string;
  readonly graceDurationHours?: number;
  readonly mode: string;
  readonly planMappingVersion?: string;
  readonly previousWebhookSigningSecretReference?: string;
  readonly portalConfigurationReference?: string;
  readonly portalReturnUrl: string;
  readonly proPriceReference: string;
  readonly proProductReference: string;
  readonly starterPriceReference: string;
  readonly starterProductReference: string;
  readonly stripeApiKeySecretReference?: string;
  readonly stripeEnvironment?: string;
  readonly successUrl: string;
  readonly webhookSigningSecretReference?: string;
  readonly webhookSignatureToleranceSeconds?: number;
}

export interface HostedBillingSession {
  readonly url: string;
}

export interface CreateHostedCheckoutInput {
  readonly billingAccountId: string;
  readonly cancelUrl: string;
  readonly existingProviderCustomerReference?: string;
  readonly idempotencyKey: string;
  readonly organizationId: string;
  readonly retryBefore?: string;
  readonly plan: BillingPlanMapping;
  readonly successUrl: string;
}

export interface CreateHostedPortalInput {
  readonly billingAccountId: string;
  readonly idempotencyKey: string;
  readonly organizationId: string;
  readonly portalConfigurationReference?: string;
  readonly providerCustomerReference: string;
  readonly returnUrl: string;
}

export interface VerifiedBillingWebhookEvent {
  readonly eventPosition: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payloadSha256: string;
  readonly providerEventData: unknown;
  readonly providerEventReference: string;
  readonly signatureSecretVersion?: "current" | "previous";
  readonly supported: boolean;
}

/** Versioned, reference-only delivery from the signature-verifying ingress. */
export interface BillingWebhookDeliveryV1 {
  readonly contractVersion: 1;
  readonly created: number;
  readonly eventPosition: string;
  readonly eventType: string;
  readonly objectReference: string;
  readonly payloadSha256: string;
  readonly planMappingVersion: string;
  readonly providerApiVersion: string;
  readonly providerEventReference: string;
  readonly signatureSecretVersion: "current" | "previous";
  readonly webhookEndpointVersion: string;
}

export function parseBillingWebhookDeliveryV1(
  value: unknown,
): BillingWebhookDeliveryV1 {
  const keys = [
    "contractVersion",
    "created",
    "eventPosition",
    "eventType",
    "objectReference",
    "payloadSha256",
    "planMappingVersion",
    "providerApiVersion",
    "providerEventReference",
    "signatureSecretVersion",
    "webhookEndpointVersion",
  ];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid-provider-event", "The billing delivery is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key)) ||
    record["contractVersion"] !== 1 ||
    !Number.isSafeInteger(record["created"]) ||
    typeof record["created"] !== "number" ||
    record["created"] < 0 ||
    !Number.isFinite(new Date(record["created"] * 1000).getTime()) ||
    typeof record["providerEventReference"] !== "string" ||
    !/^evt_[A-Za-z0-9_]{1,250}$/u.test(record["providerEventReference"]) ||
    record["eventPosition"] !==
      record["created"].toString().padStart(20, "0") +
        ":" +
        record["providerEventReference"] ||
    typeof record["eventType"] !== "string" ||
    !isSupportedEventType(record["eventType"]) ||
    typeof record["objectReference"] !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(record["objectReference"]) ||
    typeof record["payloadSha256"] !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record["payloadSha256"]) ||
    !isBillingPlanMappingVersion(record["planMappingVersion"]) ||
    record["webhookEndpointVersion"] !== BILLING_WEBHOOK_ENDPOINT_VERSION ||
    typeof record["providerApiVersion"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}\.[a-z]+$/u.test(record["providerApiVersion"]) ||
    (record["signatureSecretVersion"] !== "current" &&
      record["signatureSecretVersion"] !== "previous")
  ) {
    fail("invalid-provider-event", "The billing delivery is invalid.");
  }
  return Object.freeze({ ...record }) as unknown as BillingWebhookDeliveryV1;
}

/** V1 remains immutable test-mode evidence. V2 makes provider mode explicit. */
export interface BillingWebhookDeliveryV2 extends Omit<
  BillingWebhookDeliveryV1,
  "contractVersion"
> {
  readonly contractVersion: 2;
  readonly stripeEnvironment: StripeEnvironment;
}
export type BillingWebhookDelivery =
  BillingWebhookDeliveryV1 | BillingWebhookDeliveryV2;
export function billingDeliveryEnvironment(
  delivery: BillingWebhookDelivery,
): StripeEnvironment {
  return delivery.contractVersion === 1 ? "test" : delivery.stripeEnvironment;
}
export function parseBillingWebhookDelivery(
  value: unknown,
): BillingWebhookDelivery {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("invalid-provider-event", "The billing delivery is invalid.");
  const record = value as Record<string, unknown>;
  if (record["contractVersion"] === 1)
    return parseBillingWebhookDeliveryV1(record);
  if (
    record["contractVersion"] !== 2 ||
    (record["stripeEnvironment"] !== "test" &&
      record["stripeEnvironment"] !== "live")
  )
    fail("invalid-provider-event", "The billing delivery is invalid.");
  const { stripeEnvironment, ...legacy } = record;
  const parsed = parseBillingWebhookDeliveryV1({
    ...legacy,
    contractVersion: 1,
  });
  return Object.freeze({
    ...parsed,
    contractVersion: 2,
    stripeEnvironment,
  });
}

export type BillingProjectionState =
  "pending" | "active" | "past-due" | "paused" | "canceled" | "incomplete";

export interface BillingSubscriptionSnapshot {
  readonly billingAccountId: string | null;
  readonly billableSeatQuantity: 1;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd: string | null;
  readonly currentPeriodId: string | null;
  readonly currentPeriodStart: string | null;
  readonly normalizedStatus: BillingProjectionState;
  readonly organizationId: string | null;
  readonly priceReference: string;
  readonly productReference: string;
  readonly providerCustomerReference: string;
  readonly providerSubscriptionReference: string;
}

export interface BillingProvider extends Partial<CreditTopUpProvider> {
  /** Authenticated provider read; a queued reference is never event authority. */
  retrieveQueuedWebhook?(
    delivery: BillingWebhookDelivery,
  ): Promise<VerifiedBillingWebhookEvent>;
  createCheckoutSession(
    input: CreateHostedCheckoutInput,
  ): Promise<BillingCheckoutSession>;
  getCheckoutSession(input: {
    readonly billingAccountId: string;
    readonly expectedPlanKey?: BillingPlanKey;
    readonly expectedProviderCustomerReference?: string;
    readonly organizationId: string;
    readonly providerSessionReference: string;
  }): Promise<BillingCheckoutSession>;
  createPortalSession(
    input: CreateHostedPortalInput,
  ): Promise<HostedBillingSession>;
  resolveSubscriptionSnapshot(
    event: VerifiedBillingWebhookEvent,
  ): Promise<BillingSubscriptionSnapshot | null>;
  /**
   * Optional authenticated current-state read, never a historical event snapshot.
   * The application calls this after reading the expected projection version.
   */
  refreshSubscriptionSnapshot?(
    event: VerifiedBillingWebhookEvent,
  ): Promise<BillingSubscriptionSnapshot | null>;
  verifyWebhook(input: {
    readonly now: Date;
    readonly rawBody: Uint8Array;
    readonly signatureHeader: string | undefined;
  }): Promise<VerifiedBillingWebhookEvent>;
}

export interface BillingSessionAccount {
  readonly billingAccountId: string;
  readonly expensiveOperationsEnabled: boolean;
  readonly currentSubscriptionState?: BillingProjectionState;
  readonly currentSubscriptionReference?: string;
  readonly lifecycleStatus: "active" | "suspended" | "closed";
  readonly organizationId: string;
  readonly providerCustomerReference?: string;
}

export interface BillingWebhookTarget extends BillingSessionAccount {
  readonly organizationState: "active" | "suspended";
}

export type BillingWebhookLifecycleStatus =
  "received" | "processed" | "failed" | "unsupported";

export interface BillingWebhookReceipt {
  readonly lifecycleStatus: BillingWebhookLifecycleStatus;
  readonly payloadSha256: string;
  readonly webhookEventId: string;
}

export interface RecordBillingWebhookInput {
  readonly eventPosition: string;
  readonly eventType: string;
  readonly payloadSha256: string;
  readonly providerEventReference: string;
  readonly receivedAt: string;
  readonly webhookEventId: string;
}

export interface CompleteBillingWebhookInput {
  readonly billingAccountId?: string;
  readonly eventPosition: string;
  readonly eventType: string;
  readonly organizationId?: string;
  readonly processedAt: string;
  readonly providerEventReference: string;
  readonly safeFailureCode?: string;
  readonly status: Exclude<BillingWebhookLifecycleStatus, "received">;
  readonly webhookEventId: string;
}

export interface ResolveBillingWebhookTargetInput {
  readonly billingAccountId: string;
  readonly organizationId: string;
  readonly providerCustomerReference: string;
  readonly providerSubscriptionReference: string;
}

export type BillingCommercialPersistence = Pick<
  CommercialPersistenceRepository,
  | "createCreditGrant"
  | "updateEntitlementSnapshot"
  | "updateSubscriptionProjection"
>;

export interface BillingPaidPeriodGrant {
  readonly planVersionId: string;
  readonly creditUnits: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly sourceReference: string;
  readonly grantPolicyVersion: string;
}
export interface BillingPersistence extends BillingCheckoutPersistence {
  hasUpgradeAllowance(
    organizationId: string,
    creditGrantId: string,
  ): Promise<boolean>;
  getMonthlyGrant(
    organizationId: string,
    subscriptionPeriodId: string,
  ): Promise<BillingPaidPeriodGrant | null>;
  completeWebhookEvent(input: CompleteBillingWebhookInput): Promise<void>;
  getCurrentEntitlement(
    organizationId: string,
  ): Promise<CommercialEntitlementSnapshotRecord | null>;
  getCurrentProjection(
    organizationId: string,
  ): Promise<CommercialSubscriptionProjectionRecord | null>;
  getSessionAccount(
    scope: AuthorizedOrganizationScope,
  ): Promise<BillingSessionAccount | null>;
  hasMonthlyGrant(
    organizationId: string,
    subscriptionPeriodId: string,
  ): Promise<boolean>;
  recordWebhookEvent(
    input: RecordBillingWebhookInput,
  ): Promise<BillingWebhookReceipt>;
  resolveWebhookTarget(
    input: ResolveBillingWebhookTargetInput,
  ): Promise<BillingWebhookTarget | null>;
}

export type BillingWebhookProcessingStatus =
  "applied" | "duplicate" | "ignored-out-of-order" | "rejected" | "unsupported";

export interface BillingWebhookProcessingResult {
  readonly status: BillingWebhookProcessingStatus;
}

function fail(code: BillingApplicationErrorCode, message: string): never {
  throw new BillingApplicationError(code, message);
}

function assertProviderReference(
  value: string,
  prefix: "price_" | "prod_",
  label: string,
): void {
  if (
    value.length > 255 ||
    !value.startsWith(prefix) ||
    !/^[A-Za-z0-9_]+$/.test(value)
  ) {
    fail("invalid-billing-configuration", label + " is invalid.");
  }
}

function assertLogicalSecretReference(value: string, label: string): void {
  if (
    !/^cloudmarkup\/(beta|dev|staging|prod)\/stripe\/(?:live\/)?[a-z0-9][a-z0-9-]{1,80}$/u.test(
      value,
    ) ||
    /(?:sk_(?:test|live)|whsec_)/u.test(value)
  ) {
    fail(
      "invalid-billing-configuration",
      label + " must be an environment-scoped logical secret reference.",
    );
  }
}

function assertApprovedUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("invalid-billing-configuration", label + " is invalid.");
  }
  const localHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.protocol !== "https:" && !localHttp)
  ) {
    fail(
      "invalid-billing-configuration",
      label + " must use HTTPS except for loopback development.",
    );
  }
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
function assertOpaqueIdentifier(value: string, label: string): void {
  if (
    value.length < 1 ||
    value.length > 255 ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    fail("invalid-provider-event", label + " is invalid.");
  }
}

function assertIdempotencyKey(value: string): void {
  if (
    value.length < 16 ||
    value.length > 128 ||
    value.trim() !== value ||
    /\s/.test(value)
  ) {
    throw new ApplicationError(
      "invalid_request",
      "A valid billing idempotency key is required.",
    );
  }
}

function isPlanKey(value: string): value is BillingPlanKey {
  return value === "starter" || value === "pro";
}

function isSupportedEventType(value: string): value is BillingWebhookEventType {
  return (BILLING_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

function stableIdentifier(prefix: string, parts: readonly string[]): string {
  return (
    prefix +
    "_" +
    createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 48)
  );
}

function toAuthorizedScope(
  context: AuthorizedOrganizationContext,
): AuthorizedOrganizationScope {
  return {
    capabilities: permissionsForRole(context.role),
    correlationId: context.correlationId,
    membershipId: context.membershipId,
    organizationId: context.organizationId,
    principalId: context.principal.principalId,
    roleKey: context.role,
    sessionId: context.principal.sessionId,
  };
}

function subscriptionStateMatches(
  projection: CommercialSubscriptionProjectionRecord,
  snapshot: BillingSubscriptionSnapshot,
  mapping: BillingPlanMapping,
): boolean {
  return (
    projection.billingProvider === BILLING_PROVIDER_KEY &&
    projection.cancelAtPeriodEnd === snapshot.cancelAtPeriodEnd &&
    projection.currentPeriodEnd === (snapshot.currentPeriodEnd ?? undefined) &&
    projection.currentPeriodId === (snapshot.currentPeriodId ?? undefined) &&
    projection.currentPeriodStart ===
      (snapshot.currentPeriodStart ?? undefined) &&
    projection.normalizedStatus === snapshot.normalizedStatus &&
    projection.planVersionId === mapping.planVersionId &&
    projection.providerCustomerReference ===
      snapshot.providerCustomerReference &&
    projection.providerPriceReference === snapshot.priceReference &&
    projection.providerProductReference === snapshot.productReference &&
    projection.providerSubscriptionReference ===
      snapshot.providerSubscriptionReference
  );
}

function snapshotsMatch(
  projection: CommercialSubscriptionProjectionRecord,
  snapshot: BillingSubscriptionSnapshot,
  event: VerifiedBillingWebhookEvent,
  mapping: BillingPlanMapping,
): boolean {
  return (
    subscriptionStateMatches(projection, snapshot, mapping) &&
    projection.effectiveAt === event.occurredAt &&
    projection.lastProviderEventReference === event.providerEventReference &&
    projection.providerEventPosition === event.eventPosition
  );
}

function paidPeriodMatchesCurrentProjection(
  projection: CommercialSubscriptionProjectionRecord,
  snapshot: BillingSubscriptionSnapshot,
  mapping: BillingPlanMapping,
): boolean {
  return (
    projection.billingProvider === BILLING_PROVIDER_KEY &&
    projection.organizationId === snapshot.organizationId &&
    projection.billingAccountId === snapshot.billingAccountId &&
    projection.normalizedStatus === "active" &&
    snapshot.normalizedStatus === "active" &&
    projection.planVersionId === mapping.planVersionId &&
    projection.providerCustomerReference ===
      snapshot.providerCustomerReference &&
    projection.providerSubscriptionReference ===
      snapshot.providerSubscriptionReference &&
    projection.providerPriceReference === snapshot.priceReference &&
    projection.providerProductReference === snapshot.productReference &&
    snapshot.currentPeriodId !== null &&
    snapshot.currentPeriodStart !== null &&
    snapshot.currentPeriodEnd !== null &&
    projection.currentPeriodId === snapshot.currentPeriodId &&
    projection.currentPeriodStart === snapshot.currentPeriodStart &&
    projection.currentPeriodEnd === snapshot.currentPeriodEnd
  );
}

export function createBillingConfiguration(
  input: CreateBillingConfigurationInput,
): BillingConfiguration {
  const planMappingVersion =
    input.planMappingVersion ?? BILLING_PLAN_MAPPING_VERSION;
  if (!isBillingPlanMappingVersion(planMappingVersion)) {
    fail(
      "invalid-billing-configuration",
      "The billing plan mapping is invalid.",
    );
  }
  if (
    input.mode !== "disabled" &&
    input.mode !== "fake" &&
    input.mode !== "stripe-sandbox" &&
    input.mode !== "stripe-live"
  ) {
    fail("invalid-billing-configuration", "The billing mode is invalid.");
  }
  const stripeEnvironment = input.stripeEnvironment ?? "test";
  if (stripeEnvironment !== "test" && stripeEnvironment !== "live") {
    fail("invalid-billing-configuration", "The Stripe environment is invalid.");
  }
  if ((input.mode === "stripe-live") !== (stripeEnvironment === "live")) {
    fail(
      "invalid-billing-configuration",
      "The billing runtime and Stripe environment must match.",
    );
  }
  if (
    stripeEnvironment === "live" &&
    (input.stripeApiKeySecretReference === undefined ||
      input.webhookSigningSecretReference === undefined ||
      ![input.successUrl, input.cancelUrl, input.portalReturnUrl].every(
        (value) => value.startsWith("https://"),
      ))
  )
    fail(
      "invalid-billing-configuration",
      "Live billing requires explicit secrets and HTTPS return URLs.",
    );
  assertApprovedUrl(input.successUrl, "The Checkout success URL");
  assertApprovedUrl(input.cancelUrl, "The Checkout cancel URL");
  assertApprovedUrl(input.portalReturnUrl, "The Portal return URL");
  assertProviderReference(
    input.starterProductReference,
    "prod_",
    "The Starter Product reference",
  );
  assertProviderReference(
    input.starterPriceReference,
    "price_",
    "The Starter Price reference",
  );
  assertProviderReference(
    input.proProductReference,
    "prod_",
    "The Pro Product reference",
  );
  assertProviderReference(
    input.proPriceReference,
    "price_",
    "The Pro Price reference",
  );
  if (
    input.starterProductReference === input.proProductReference ||
    input.starterPriceReference === input.proPriceReference
  ) {
    fail(
      "invalid-billing-configuration",
      "Starter and Pro require distinct Product and Price references.",
    );
  }
  const apiKeySecretReference =
    input.stripeApiKeySecretReference ?? "cloudmarkup/dev/stripe/api-key";
  const webhookSigningSecretReference =
    input.webhookSigningSecretReference ??
    "cloudmarkup/dev/stripe/webhook-signing-secret";
  assertLogicalSecretReference(
    apiKeySecretReference,
    "The Stripe API key secret reference",
  );
  assertLogicalSecretReference(
    webhookSigningSecretReference,
    "The Stripe webhook secret reference",
  );
  if (input.previousWebhookSigningSecretReference !== undefined) {
    assertLogicalSecretReference(
      input.previousWebhookSigningSecretReference,
      "The previous Stripe webhook secret reference",
    );
    if (
      input.previousWebhookSigningSecretReference ===
      webhookSigningSecretReference
    ) {
      fail(
        "invalid-billing-configuration",
        "Current and previous Stripe webhook secret references must differ.",
      );
    }
  }
  const tolerance = input.webhookSignatureToleranceSeconds ?? 300;
  if (!Number.isInteger(tolerance) || tolerance < 60 || tolerance > 900) {
    fail(
      "invalid-billing-configuration",
      "The webhook signature tolerance must be between 60 and 900 seconds.",
    );
  }
  const graceDurationHours = input.graceDurationHours ?? 0;
  if (
    !Number.isInteger(graceDurationHours) ||
    graceDurationHours < 0 ||
    graceDurationHours > 24 * 30
  ) {
    fail(
      "invalid-billing-configuration",
      "The commercial grace duration must be between zero and 720 hours.",
    );
  }
  if (
    (input.mode === "stripe-sandbox" || input.mode === "stripe-live") &&
    input.portalConfigurationReference === undefined
  ) {
    fail(
      "invalid-billing-configuration",
      "Stripe billing requires a reviewed Portal configuration.",
    );
  }
  if (
    input.portalConfigurationReference !== undefined &&
    !/^bpc_[A-Za-z0-9_]+$/.test(input.portalConfigurationReference)
  ) {
    fail(
      "invalid-billing-configuration",
      "The Portal configuration reference is invalid.",
    );
  }

  return Object.freeze({
    cancelUrl: input.cancelUrl,
    cancellationPolicy: Object.freeze({
      defaultTiming: "period-end" as const,
      immediateCancellation: "explicit-operator-approval-required" as const,
      prorationPolicy: "business-decision-required" as const,
    }),
    configurationVersion: BILLING_CONFIGURATION_VERSION,
    currency: "USD" as const,
    gracePolicy: Object.freeze({
      durationHours: graceDurationHours,
      expensiveOperationsEnabled: false as const,
      policyVersion: "cloudmarkup-controlled-beta-grace-2026-08-28-v1",
    }),
    mode: input.mode,
    planMappingVersion,
    plans: Object.freeze({
      pro: Object.freeze({
        currency: "USD",
        monthlyCreditUnits: billingMonthlyCreditsForPlanVersion(
          billingPlanVersionForMapping(planMappingVersion, "pro"),
        ),
        monthlyPriceMicros: 39_000_000,
        planKey: "pro",
        planVersionId: billingPlanVersionForMapping(planMappingVersion, "pro"),
        priceReference: input.proPriceReference,
        productReference: input.proProductReference,
      }),
      starter: Object.freeze({
        currency: "USD",
        monthlyCreditUnits: 200,
        monthlyPriceMicros: 9_000_000,
        planKey: "starter",
        planVersionId: billingPlanVersionForMapping(
          planMappingVersion,
          "starter",
        ),
        priceReference: input.starterPriceReference,
        productReference: input.starterProductReference,
      }),
    }),
    ...(input.portalConfigurationReference === undefined
      ? {}
      : {
          portalConfigurationReference: input.portalConfigurationReference,
        }),
    portalReturnUrl: input.portalReturnUrl,
    publishableKeyIdentifier: null,
    secretReferences: Object.freeze({
      apiKey: apiKeySecretReference,
      ...(input.previousWebhookSigningSecretReference === undefined
        ? {}
        : {
            previousWebhookSigningSecret:
              input.previousWebhookSigningSecretReference,
          }),
      webhookSigningSecret: webhookSigningSecretReference,
    }),
    stripeEnvironment,
    successUrl: input.successUrl,
    trialPolicy: "no-trial" as const,
    webhookEndpointVersion: BILLING_WEBHOOK_ENDPOINT_VERSION,
    webhookSignatureToleranceSeconds: tolerance,
  });
}

export class BillingApplicationService {
  readonly #auditSink: SensitiveAuditSink | null;
  readonly #commercial: BillingCommercialPersistence;
  readonly #configuration: BillingConfiguration;
  readonly #now: () => Date;
  readonly #persistence: BillingPersistence;
  readonly #provider: BillingProvider;
  readonly #topUps: CreditTopUpWebhookProcessor | undefined;

  constructor(input: {
    /** null composes webhook processing only; session creation fails closed. */
    readonly auditSink: SensitiveAuditSink | null;
    readonly commercial: BillingCommercialPersistence;
    readonly configuration: BillingConfiguration;
    readonly now?: () => Date;
    readonly persistence: BillingPersistence;
    readonly provider: BillingProvider;
    readonly topUps?: CreditTopUpWebhookProcessor;
  }) {
    this.#auditSink = input.auditSink;
    this.#commercial = input.commercial;
    this.#configuration = input.configuration;
    this.#now = input.now ?? (() => new Date());
    this.#persistence = input.persistence;
    this.#provider = input.provider;
    this.#topUps = input.topUps;
  }

  #sessionAuditSink(): SensitiveAuditSink {
    if (this.#auditSink === null) {
      return fail(
        "billing-disabled",
        "Hosted billing sessions are not enabled in this runtime.",
      );
    }
    return this.#auditSink;
  }

  async createCheckoutSession(input: {
    readonly context: AuthorizedOrganizationContext;
    readonly idempotencyKey: string;
    readonly planKey: string;
  }): Promise<HostedBillingSession> {
    assertIdempotencyKey(input.idempotencyKey);
    if (!isPlanKey(input.planKey)) {
      throw new ApplicationError(
        "invalid_request",
        "The requested billing plan is unavailable.",
      );
    }
    if (this.#configuration.mode === "disabled") {
      fail("billing-disabled", "Billing is disabled in this environment.");
    }
    const planKey = input.planKey;

    return runSensitiveAction({
      action: "billing.checkout.create",
      auditSink: this.#sessionAuditSink(),
      context: input.context,
      family: "billing",
      now: this.#now,
      operation: () =>
        createGuardedCheckoutSession({
          configuration: this.#configuration,
          idempotencyKey: input.idempotencyKey,
          now: this.#now,
          persistence: this.#persistence,
          planKey,
          provider: this.#provider,
          scope: toAuthorizedScope(input.context),
        }),
      permission: "billing.manage",
      safeSummary: "Created a hosted subscription Checkout session.",
      targetKind: "billing-account",
    });
  }

  async createPortalSession(input: {
    readonly context: AuthorizedOrganizationContext;
    readonly idempotencyKey: string;
  }): Promise<HostedBillingSession> {
    assertIdempotencyKey(input.idempotencyKey);
    if (this.#configuration.mode === "disabled") {
      fail("billing-disabled", "Billing is disabled in this environment.");
    }

    return runSensitiveAction({
      action: "billing.portal.create",
      auditSink: this.#sessionAuditSink(),
      context: input.context,
      family: "billing",
      now: this.#now,
      operation: async () => {
        const account = await this.#persistence.getSessionAccount(
          toAuthorizedScope(input.context),
        );
        if (
          account?.organizationId !== input.context.organizationId ||
          account.lifecycleStatus !== "active" ||
          account.providerCustomerReference === undefined
        ) {
          fail(
            "subscription-required",
            "An active provider customer is required for billing management.",
          );
        }
        return this.#provider.createPortalSession({
          billingAccountId: account.billingAccountId,
          idempotencyKey:
            "portal:" +
            input.context.organizationId +
            ":" +
            input.idempotencyKey,
          organizationId: input.context.organizationId,
          ...(this.#configuration.portalConfigurationReference === undefined
            ? {}
            : {
                portalConfigurationReference:
                  this.#configuration.portalConfigurationReference,
              }),
          providerCustomerReference: account.providerCustomerReference,
          returnUrl: this.#configuration.portalReturnUrl,
        });
      },
      permission: "billing.manage",
      safeSummary: "Created a short-lived hosted billing Portal session.",
      targetKind: "billing-account",
    });
  }

  async #completeRejected(
    event: VerifiedBillingWebhookEvent,
    receipt: BillingWebhookReceipt,
    safeFailureCode: string,
    target?: {
      readonly billingAccountId: string;
      readonly organizationId: string;
    },
  ): Promise<BillingWebhookProcessingResult> {
    await this.#persistence.completeWebhookEvent({
      ...(target === undefined
        ? {}
        : {
            billingAccountId: target.billingAccountId,
            organizationId: target.organizationId,
          }),
      eventPosition: event.eventPosition,
      eventType: event.eventType,
      processedAt: this.#now().toISOString(),
      providerEventReference: event.providerEventReference,
      safeFailureCode,
      status: "failed",
      webhookEventId: receipt.webhookEventId,
    });
    return { status: "rejected" };
  }

  async #grantMonthlyCredits(
    accounting: TrustedCommercialAccountingContext,
    mapping: BillingPlanMapping,
    snapshot: BillingSubscriptionSnapshot,
  ): Promise<void> {
    if (
      snapshot.currentPeriodId === null ||
      snapshot.currentPeriodStart === null ||
      snapshot.currentPeriodEnd === null ||
      (await this.#persistence.hasMonthlyGrant(
        accounting.organizationId,
        snapshot.currentPeriodId,
      ))
    )
      return;
    const grantIdentity = [
      accounting.organizationId,
      snapshot.providerSubscriptionReference,
      snapshot.currentPeriodId,
    ];
    await this.#commercial.createCreditGrant(accounting, {
      chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
      consumptionPriority: "100",
      creditGrantId: stableIdentifier("credit_grant", grantIdentity),
      creditUnits: mapping.monthlyCreditUnits.toString(),
      expirationPolicy: {
        expiresAt: snapshot.currentPeriodEnd,
        kind: "expires-at",
        policyVersion: BILLING_MONTHLY_GRANT_POLICY_VERSION,
      },
      grantKind: "monthly",
      grantPolicyVersion: BILLING_MONTHLY_GRANT_POLICY_VERSION,
      idempotencyKey: stableIdentifier(
        "monthly_grant_idempotency",
        grantIdentity,
      ),
      ledgerEntryId: stableIdentifier("usage_grant", grantIdentity),
      planVersionId: mapping.planVersionId,
      reasonCode: "billing.subscription-period.grant",
      sourceReference:
        snapshot.providerSubscriptionReference + ":" + snapshot.currentPeriodId,
      startsAt: snapshot.currentPeriodStart,
      subscriptionPeriod: {
        endsAt: snapshot.currentPeriodEnd,
        periodId: snapshot.currentPeriodId,
        startsAt: snapshot.currentPeriodStart,
      },
    });
  }

  /** A once-per-paid-period upgrade allowance. The original paid invoice grant
   * is immutable evidence; this additional expiring grant never fabricates
   * payment, resets consumption or grants credits for an unpaid/new period. */
  async #grantUpgradeAllowance(
    accounting: TrustedCommercialAccountingContext,
    mapping: BillingPlanMapping,
    snapshot: BillingSubscriptionSnapshot,
  ): Promise<void> {
    if (
      mapping.planKey !== "pro" ||
      snapshot.normalizedStatus !== "active" ||
      snapshot.currentPeriodId === null ||
      snapshot.currentPeriodStart === null ||
      snapshot.currentPeriodEnd === null ||
      Date.parse(snapshot.currentPeriodStart) > this.#now().getTime() ||
      Date.parse(snapshot.currentPeriodEnd) <= this.#now().getTime()
    )
      return;
    const paid = await this.#persistence.getMonthlyGrant(
      accounting.organizationId,
      snapshot.currentPeriodId,
    );
    const source =
      snapshot.providerSubscriptionReference + ":" + snapshot.currentPeriodId;
    if (
      paid === null ||
      billingPlanKeyForVersion(paid.planVersionId) !== "starter" ||
      paid.grantPolicyVersion !== BILLING_MONTHLY_GRANT_POLICY_VERSION ||
      paid.sourceReference !== source ||
      paid.startsAt !== snapshot.currentPeriodStart ||
      paid.endsAt !== snapshot.currentPeriodEnd ||
      paid.creditUnits !==
        String(this.#configuration.plans.starter.monthlyCreditUnits)
    )
      return;
    const difference = mapping.monthlyCreditUnits - Number(paid.creditUnits);
    if (!Number.isSafeInteger(difference) || difference <= 0) return;
    const identity = [
      accounting.organizationId,
      snapshot.providerSubscriptionReference,
      snapshot.currentPeriodId,
      BILLING_UPGRADE_GRANT_POLICY_VERSION,
    ];
    const creditGrantId = stableIdentifier("credit_grant", identity);
    // Preserve a supplement issued by a prior plan mapping. A concurrent first
    // issuance still uses the ledger's atomic idempotency check; retry observes it.
    if (
      await this.#persistence.hasUpgradeAllowance(
        accounting.organizationId,
        creditGrantId,
      )
    )
      return;
    await this.#commercial.createCreditGrant(accounting, {
      chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
      consumptionPriority: "100",
      creditGrantId,
      creditUnits: String(difference),
      expirationPolicy: {
        expiresAt: snapshot.currentPeriodEnd,
        kind: "expires-at",
        policyVersion: BILLING_UPGRADE_GRANT_POLICY_VERSION,
      },
      grantKind: "promotional",
      grantPolicyVersion: BILLING_UPGRADE_GRANT_POLICY_VERSION,
      idempotencyKey: stableIdentifier(
        "upgrade_allowance_idempotency",
        identity,
      ),
      ledgerEntryId: stableIdentifier("usage_grant", identity),
      // Pin the original paid source plan so a later mapping adoption cannot
      // change the immutable identity/payload of this period allowance.
      planVersionId: paid.planVersionId,
      reasonCode: "billing.paid-period.upgrade-allowance",
      sourceReference: source + ":pro-upgrade",
      startsAt: snapshot.currentPeriodStart,
    });
  }

  async processWebhook(input: {
    readonly rawBody: Uint8Array;
    readonly signatureHeader: string | undefined;
  }): Promise<BillingWebhookProcessingResult> {
    if (input.rawBody.byteLength > BILLING_WEBHOOK_MAX_BODY_BYTES) {
      fail("invalid-provider-event", "The billing event body is too large.");
    }
    if (this.#configuration.mode === "disabled") {
      fail("billing-disabled", "Billing is disabled in this environment.");
    }

    const event = await this.#provider.verifyWebhook({
      now: this.#now(),
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
    });
    return this.#processVerifiedWebhook(event);
  }

  async processQueuedWebhook(
    input: unknown,
  ): Promise<BillingWebhookProcessingResult> {
    if (
      (this.#configuration.mode !== "stripe-sandbox" &&
        this.#configuration.mode !== "stripe-live") ||
      this.#provider.retrieveQueuedWebhook === undefined
    ) {
      fail("billing-disabled", "Durable billing processing is disabled.");
    }
    const delivery = parseBillingWebhookDelivery(input);
    if (
      billingDeliveryEnvironment(delivery) !==
      this.#configuration.stripeEnvironment
    )
      fail(
        "invalid-provider-event",
        "The billing delivery mode does not match.",
      );
    if (
      !supportsBillingDeliveryMapping(
        delivery.planMappingVersion,
        this.#configuration.planMappingVersion,
      )
    ) {
      fail(
        "invalid-billing-configuration",
        "The billing worker does not select this delivery mapping.",
      );
    }
    const event = await this.#provider.retrieveQueuedWebhook(delivery);
    if (
      event.providerEventReference !== delivery.providerEventReference ||
      event.eventType !== delivery.eventType ||
      event.eventPosition !== delivery.eventPosition ||
      event.payloadSha256 !== delivery.payloadSha256 ||
      event.occurredAt !== new Date(delivery.created * 1000).toISOString() ||
      event.signatureSecretVersion !== delivery.signatureSecretVersion ||
      !event.supported
    ) {
      fail(
        "invalid-provider-event",
        "The verified billing delivery does not match.",
      );
    }
    return this.#processVerifiedWebhook(event);
  }

  async #processVerifiedWebhook(
    event: VerifiedBillingWebhookEvent,
  ): Promise<BillingWebhookProcessingResult> {
    assertOpaqueIdentifier(
      event.providerEventReference,
      "The provider event reference",
    );
    const receipt = await this.#persistence.recordWebhookEvent({
      eventPosition: event.eventPosition,
      eventType: event.eventType,
      payloadSha256: event.payloadSha256,
      providerEventReference: event.providerEventReference,
      receivedAt: this.#now().toISOString(),
      webhookEventId: stableIdentifier("billing_webhook", [
        BILLING_PROVIDER_KEY,
        event.providerEventReference,
      ]),
    });
    if (receipt.payloadSha256 !== event.payloadSha256) {
      fail(
        "idempotency-conflict",
        "The provider event identity conflicts with prior payload evidence.",
      );
    }
    if (receipt.lifecycleStatus !== "received") {
      return { status: "duplicate" };
    }
    if (!event.supported || !isSupportedEventType(event.eventType)) {
      await this.#persistence.completeWebhookEvent({
        eventPosition: event.eventPosition,
        eventType: event.eventType,
        processedAt: this.#now().toISOString(),
        providerEventReference: event.providerEventReference,
        safeFailureCode: "unsupported-event-type",
        status: "unsupported",
        webhookEventId: receipt.webhookEventId,
      });
      return { status: "unsupported" };
    }

    const topUp = await this.#topUps?.(event);
    if (topUp !== undefined && topUp !== null) {
      await this.#persistence.completeWebhookEvent({
        billingAccountId: topUp.billingAccountId,
        organizationId: topUp.organizationId,
        eventPosition: event.eventPosition,
        eventType: event.eventType,
        processedAt: this.#now().toISOString(),
        providerEventReference: event.providerEventReference,
        webhookEventId: receipt.webhookEventId,
        status: topUp.status === "rejected" ? "failed" : "processed",
        ...(topUp.status === "rejected"
          ? { safeFailureCode: "credit-purchase-reconciliation-required" }
          : {}),
      });
      return { status: topUp.status };
    }

    let snapshot = await this.#provider.resolveSubscriptionSnapshot(event);
    if (snapshot === null) {
      return this.#completeRejected(
        event,
        receipt,
        "invalid-or-unowned-subscription",
      );
    }
    if (
      snapshot.organizationId === null ||
      snapshot.billingAccountId === null
    ) {
      return this.#completeRejected(
        event,
        receipt,
        "invalid-or-unowned-subscription",
      );
    }
    const target = await this.#persistence.resolveWebhookTarget({
      billingAccountId: snapshot.billingAccountId,
      organizationId: snapshot.organizationId,
      providerCustomerReference: snapshot.providerCustomerReference,
      providerSubscriptionReference: snapshot.providerSubscriptionReference,
    });
    if (target === null) {
      return this.#completeRejected(
        event,
        receipt,
        "organization-account-or-provider-ownership-unavailable",
      );
    }
    const targetEvidence = {
      billingAccountId: target.billingAccountId,
      organizationId: target.organizationId,
    } as const;
    const currentProjection = await this.#persistence.getCurrentProjection(
      target.organizationId,
    );
    const currentStateRead =
      this.#provider.refreshSubscriptionSnapshot !== undefined;
    let effectiveAt = event.occurredAt;
    if (this.#provider.refreshSubscriptionSnapshot !== undefined) {
      // Read the expected record version before the provider await. If another
      // observation commits while this request is in flight, the existing CAS
      // fails and queue retry must obtain a new current-state observation.
      const refreshed = await this.#provider.refreshSubscriptionSnapshot(event);
      if (
        refreshed?.organizationId !== snapshot.organizationId ||
        refreshed.billingAccountId !== snapshot.billingAccountId ||
        refreshed.providerCustomerReference !==
          snapshot.providerCustomerReference ||
        refreshed.providerSubscriptionReference !==
          snapshot.providerSubscriptionReference
      ) {
        return this.#completeRejected(
          event,
          receipt,
          "invalid-or-unowned-subscription",
          targetEvidence,
        );
      }
      snapshot = refreshed;
      // This is current provider state, not state as of the triggering event.
      effectiveAt = this.#now().toISOString();
    }
    const configuredMapping = Object.values(this.#configuration.plans).find(
      (candidate) =>
        candidate.priceReference === snapshot.priceReference &&
        candidate.productReference === snapshot.productReference,
    );
    if (configuredMapping === undefined) {
      return this.#completeRejected(event, receipt, "unknown-product-price");
    }
    const planVersionId = selectBillingSubscriptionPlan({
      configuredVersion: this.#configuration.planMappingVersion,
      planKey: configuredMapping.planKey,
      currentPlanVersionId: currentProjection?.planVersionId ?? null,
      currentPeriodStart: snapshot.currentPeriodStart,
      currentStateRead,
      observedAt: effectiveAt,
    });
    if (planVersionId === null) {
      // Retain the received receipt for a fresh compatible observation; never
      // reinterpret an unknown/newer canonical plan or downgrade it on retry.
      fail(
        "invalid-provider-event",
        "The subscription plan mapping is unavailable.",
      );
    }
    const mapping: BillingPlanMapping = {
      ...configuredMapping,
      planVersionId,
      monthlyCreditUnits: billingMonthlyCreditsForPlanVersion(planVersionId),
    };
    if (
      currentProjection !== null &&
      currentProjection.providerCustomerReference !==
        snapshot.providerCustomerReference &&
      !(
        this.#configuration.stripeEnvironment === "live" &&
        (currentProjection.providerEnvironment ?? "test") === "test" &&
        currentProjection.normalizedStatus === "canceled"
      )
    ) {
      return this.#completeRejected(
        event,
        receipt,
        "provider-customer-ownership-conflict",
        targetEvidence,
      );
    }
    if (
      currentProjection !== null &&
      currentProjection.providerSubscriptionReference !==
        snapshot.providerSubscriptionReference &&
      currentProjection.normalizedStatus !== "canceled"
    ) {
      return this.#completeRejected(
        event,
        receipt,
        "active-subscription-conflict",
        targetEvidence,
      );
    }
    const accounting: TrustedCommercialAccountingContext = {
      actorId: "billing-webhook-stripe",
      authority: "internal-accounting",
      correlationId: event.providerEventReference,
      organizationId: target.organizationId,
    };
    const sameSubscription =
      currentProjection?.providerSubscriptionReference ===
      snapshot.providerSubscriptionReference;
    const currentCancellation =
      sameSubscription &&
      snapshot.normalizedStatus === "canceled" &&
      currentProjection.normalizedStatus !== "canceled";
    const replacesCanceledSubscription =
      currentProjection?.normalizedStatus === "canceled" && !sameSubscription;
    if (
      currentProjection?.providerEventPosition !== undefined &&
      currentProjection.providerEventPosition > event.eventPosition &&
      !currentStateRead &&
      !currentCancellation &&
      !replacesCanceledSubscription
    ) {
      // Historical-only providers retain their ordering fence. Authenticated
      // current observations are not ordered by arbitrary Stripe event IDs.
      if (
        event.eventType === "invoice.paid" &&
        paidPeriodMatchesCurrentProjection(currentProjection, snapshot, mapping)
      ) {
        await this.#grantMonthlyCredits(accounting, mapping, snapshot);
        await this.#persistence.completeWebhookEvent({
          ...targetEvidence,
          eventPosition: event.eventPosition,
          eventType: event.eventType,
          processedAt: this.#now().toISOString(),
          providerEventReference: event.providerEventReference,
          status: "processed",
          webhookEventId: receipt.webhookEventId,
        });
        return { status: "applied" };
      }
      await this.#persistence.completeWebhookEvent({
        ...targetEvidence,
        eventPosition: event.eventPosition,
        eventType: event.eventType,
        processedAt: this.#now().toISOString(),
        providerEventReference: event.providerEventReference,
        safeFailureCode: "ignored-out-of-order",
        status: "processed",
        webhookEventId: receipt.webhookEventId,
      });
      return { status: "ignored-out-of-order" };
    }

    // Cancellation is terminal for one Stripe subscription ID. Older no-op
    // events retain their existing ignored outcome; no newer lexical ID can
    // revive the same canceled ID or enable its expensive operations.
    if (
      sameSubscription &&
      currentProjection.normalizedStatus === "canceled" &&
      snapshot.normalizedStatus !== "canceled"
    ) {
      return this.#completeRejected(
        event,
        receipt,
        "terminal-subscription-conflict",
        targetEvidence,
      );
    }
    let projection = currentProjection;
    const projectionChanged = currentStateRead
      ? projection === null ||
        !subscriptionStateMatches(projection, snapshot, mapping)
      : projection?.providerEventPosition !== event.eventPosition ||
        currentCancellation ||
        replacesCanceledSubscription;
    if (currentStateRead && !projectionChanged) {
      const afterObservation = await this.#persistence.getCurrentProjection(
        target.organizationId,
      );
      if (
        afterObservation?.recordVersion !== projection?.recordVersion ||
        afterObservation?.subscriptionProjectionId !==
          projection?.subscriptionProjectionId
      ) {
        throw new CommercialPersistenceError(
          "version-conflict",
          "The subscription projection changed during its provider observation.",
        );
      }
    }
    if (projectionChanged) {
      projection = await this.#commercial.updateSubscriptionProjection(
        accounting,
        {
          billableSeatQuantity: "1",
          billingProvider: BILLING_PROVIDER_KEY,
          ...(this.#configuration.stripeEnvironment === "live"
            ? { providerEnvironment: "live" as const }
            : {}),
          cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
          ...(snapshot.currentPeriodEnd === null
            ? {}
            : { currentPeriodEnd: snapshot.currentPeriodEnd }),
          ...(snapshot.currentPeriodId === null
            ? {}
            : { currentPeriodId: snapshot.currentPeriodId }),
          ...(snapshot.currentPeriodStart === null
            ? {}
            : { currentPeriodStart: snapshot.currentPeriodStart }),
          effectiveAt,
          expectedRecordVersion: projection?.recordVersion ?? "0",
          lastProviderEventReference: event.providerEventReference,
          normalizedStatus: snapshot.normalizedStatus,
          planVersionId: mapping.planVersionId,
          providerCustomerReference: snapshot.providerCustomerReference,
          providerEventPosition: event.eventPosition,
          providerPriceReference: snapshot.priceReference,
          providerProductReference: snapshot.productReference,
          providerSubscriptionReference: snapshot.providerSubscriptionReference,
          subscriptionProjectionId:
            projection?.subscriptionProjectionId ??
            stableIdentifier("subscription_projection", [
              target.organizationId,
              snapshot.providerSubscriptionReference,
            ]),
        },
      );
    } else if (
      projection === null ||
      (!currentStateRead &&
        !snapshotsMatch(projection, snapshot, event, mapping))
    ) {
      return this.#completeRejected(
        event,
        receipt,
        "provider-event-replay-conflict",
        targetEvidence,
      );
    }

    const entitlement = await this.#persistence.getCurrentEntitlement(
      target.organizationId,
    );
    const expensiveOperationsEnabled =
      target.organizationState === "active" &&
      target.lifecycleStatus === "active" &&
      target.expensiveOperationsEnabled &&
      projection.normalizedStatus === "active";
    // Nonactive subscription observations cannot replace independently granted trial access.
    const preserveTrial =
      entitlement?.planVersionId === STAFF_TRIAL_PLAN_VERSION &&
      projection.normalizedStatus !== "active";
    if (
      !preserveTrial &&
      (entitlement?.planVersionId !== projection.planVersionId ||
        entitlement.sourceRecordVersion !== projection.recordVersion ||
        entitlement.expensiveOperationsEnabled !== expensiveOperationsEnabled ||
        entitlement.subscriptionProjectionId !==
          projection.subscriptionProjectionId)
    ) {
      await this.#commercial.updateEntitlementSnapshot(accounting, {
        effectiveAt,
        entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION,
        entitlementSnapshotId:
          entitlement?.entitlementSnapshotId ??
          stableIdentifier("entitlement_snapshot", [
            target.organizationId,
            target.billingAccountId,
          ]),
        expensiveOperationsEnabled,
        expectedRecordVersion: entitlement?.recordVersion ?? "0",
        planVersionId: projection.planVersionId,
        sourceRecordVersion: projection.recordVersion,
        subscriptionProjectionId: projection.subscriptionProjectionId,
      });
    }

    if (
      event.eventType === "invoice.paid" &&
      projection.normalizedStatus === "active"
    ) {
      await this.#grantMonthlyCredits(accounting, mapping, snapshot);
    }

    if (currentStateRead && expensiveOperationsEnabled)
      await this.#grantUpgradeAllowance(accounting, mapping, snapshot);

    await this.#persistence.completeWebhookEvent({
      ...targetEvidence,
      eventPosition: event.eventPosition,
      eventType: event.eventType,
      processedAt: this.#now().toISOString(),
      providerEventReference: event.providerEventReference,
      status: "processed",
      webhookEventId: receipt.webhookEventId,
    });
    return { status: "applied" };
  }
}
