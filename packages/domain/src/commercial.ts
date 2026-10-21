import {
  STAFF_TRIAL_PLAN_VERSION,
  STAFF_TRIAL_POLICY_VERSION,
  staffTrialState,
  type StaffTrialAccessV1,
} from "./staff-trial-policy.js";
export const COMMERCIAL_DOMAIN_VERSION = 1 as const;
export const BETA_PLAN_CONFIGURATION_VERSION =
  "cloudmarkup-beta-plans-2026-08-14-v2" as const;
export const BETA_SHARING_PLAN_CONFIGURATION_VERSION =
  "cloudmarkup-beta-sharing-plans-2026-09-07-v1" as const;
export const BETA_EXPORT_PLAN_CONFIGURATION_VERSION =
  "cloudmarkup-beta-cloudformation-plans-2026-09-12-v1" as const;
export const BETA_CREDIT_PLAN_CONFIGURATION_VERSION =
  "cloudmarkup-beta-credit-plans-2026-09-30-v1" as const;
export const ENTITLEMENT_POLICY_VERSION =
  "cloudmarkup-entitlements-v1" as const;
export const USAGE_DISPOSITION_POLICY_VERSION =
  "cloudmarkup-charging-and-failure-v1" as const;

export const TECHNICAL_USAGE_OUTCOMES = [
  "granted",
  "reserved",
  "useful-output-delivered",
  "no-useful-output",
  "released",
  "expired",
  "provider-failure",
  "internal-failure",
  "canceled",
  "compensated",
  "adjusted",
] as const;
export type TechnicalUsageOutcomeV1 = (typeof TECHNICAL_USAGE_OUTCOMES)[number];

export const COMMERCIAL_FEATURE_KEYS = [
  "manual-editing",
  "read-existing-projects",
  "existing-artifact-access",
  "data-export",
  "zip-export",
  "diagram-export",
  "github-export",
  "terraform",
  "cloudformation",
  "complete-application-generation",
  "validation-jobs",
  "plan-evidence-workflows",
  "deployment-evidence-workflows",
  "organization-roles",
  "shared-projects",
  "audit-history",
  "ai-assisted-operations",
] as const;

export type CommercialFeatureKey = (typeof COMMERCIAL_FEATURE_KEYS)[number];

export const EXPENSIVE_COMMERCIAL_FEATURE_KEYS = Object.freeze([
  "complete-application-generation",
  "validation-jobs",
  "plan-evidence-workflows",
  "deployment-evidence-workflows",
  "ai-assisted-operations",
] as const satisfies readonly CommercialFeatureKey[]);

export function isExpensiveCommercialFeature(
  feature: CommercialFeatureKey,
): boolean {
  return (
    EXPENSIVE_COMMERCIAL_FEATURE_KEYS as readonly CommercialFeatureKey[]
  ).includes(feature);
}

export const COMMERCIAL_LIMIT_KEYS = [
  "projects",
  "active-members",
  "active-owners",
  "active-administrators",
  "active-editors",
  "billable-seats",
  "viewers",
  "concurrent-ai-jobs",
  "per-user-request-count",
  "per-project-credit-cap",
] as const;

export type CommercialLimitKey = (typeof COMMERCIAL_LIMIT_KEYS)[number];
export const COMMERCIAL_LIMIT_PERIOD_KINDS = [
  "none",
  "subscription-period",
  "calendar-month",
  "rolling-day",
] as const;
export type CommercialLimitPeriodKind =
  (typeof COMMERCIAL_LIMIT_PERIOD_KINDS)[number];
export type PlanKey = "starter" | "pro";
export type OrganizationRole = "owner" | "administrator" | "editor" | "viewer";

export interface ProposedMonthlyPriceV1 {
  readonly currencyCode: "USD";
  readonly unitAmountMicros: number;
}

export interface FeatureEntitlementV1 {
  readonly enabled: boolean;
  readonly feature: CommercialFeatureKey;
}

export interface NumericLimitV1 {
  readonly key: CommercialLimitKey;
  readonly period: CommercialLimitPeriodKind;
  readonly scope: "organization" | "member" | "project";
  readonly value: number;
}

export interface IncludedCreditGrantV1 {
  readonly kind: "one-time" | "monthly";
  readonly units: number;
}

export interface FutureAdditionalEditorConceptV1 {
  readonly additionalSharedCreditUnits: number;
  readonly enabled: false;
  readonly proposedMonthlyPrice: ProposedMonthlyPriceV1;
}

export interface PlanDefinitionV1 {
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly displayName: string;
  readonly planDefinitionId: string;
  readonly planKey: PlanKey;
}

export interface PlanVersionV1 {
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly configurationVersion:
    | typeof BETA_PLAN_CONFIGURATION_VERSION
    | typeof BETA_SHARING_PLAN_CONFIGURATION_VERSION
    | typeof BETA_EXPORT_PLAN_CONFIGURATION_VERSION
    | typeof BETA_CREDIT_PLAN_CONFIGURATION_VERSION
    | typeof STAFF_TRIAL_POLICY_VERSION;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly entitlements: readonly FeatureEntitlementV1[];
  readonly futureAdditionalEditorConcept: FutureAdditionalEditorConceptV1 | null;
  readonly includedBillableSeats: number;
  readonly includedCreditGrants: readonly IncludedCreditGrantV1[];
  readonly limits: readonly NumericLimitV1[];
  readonly planDefinitionId: string;
  readonly planVersionId: string;
  readonly proposedMonthlyPrice: ProposedMonthlyPriceV1 | null;
}
type ProposedMonthlyPriceValidationInputV1 = Omit<
  ProposedMonthlyPriceV1,
  "currencyCode"
> & {
  readonly currencyCode: string;
};

type FutureAdditionalEditorConceptValidationInputV1 = Omit<
  FutureAdditionalEditorConceptV1,
  "enabled" | "proposedMonthlyPrice"
> & {
  readonly enabled: boolean;
  readonly proposedMonthlyPrice: ProposedMonthlyPriceValidationInputV1;
};

type IncludedCreditGrantValidationInputV1 = Omit<
  IncludedCreditGrantV1,
  "kind"
> & {
  readonly kind: string;
};

type PlanVersionValidationInputV1 = Omit<
  PlanVersionV1,
  | "commercialDomainVersion"
  | "configurationVersion"
  | "futureAdditionalEditorConcept"
  | "includedCreditGrants"
  | "proposedMonthlyPrice"
> & {
  readonly commercialDomainVersion: number;
  readonly configurationVersion: string;
  readonly futureAdditionalEditorConcept: FutureAdditionalEditorConceptValidationInputV1 | null;
  readonly includedCreditGrants: readonly IncludedCreditGrantValidationInputV1[];

  readonly proposedMonthlyPrice: ProposedMonthlyPriceValidationInputV1 | null;
};
const alwaysAvailableFeatures = [
  "manual-editing",
  "read-existing-projects",
  "existing-artifact-access",
  "data-export",
] as const satisfies readonly CommercialFeatureKey[];

function featureConfiguration(
  enabledFeatures: readonly CommercialFeatureKey[],
): readonly FeatureEntitlementV1[] {
  const enabled = new Set<CommercialFeatureKey>([
    ...alwaysAvailableFeatures,
    ...enabledFeatures,
  ]);
  return COMMERCIAL_FEATURE_KEYS.map((feature) => ({
    enabled: enabled.has(feature),
    feature,
  }));
}

function betaOrganizationLimits(
  limits: readonly {
    readonly key: CommercialLimitKey;
    readonly value: number;
  }[],
): readonly NumericLimitV1[] {
  return limits.map((limit) => ({
    ...limit,
    period: "none",
    scope: "organization",
  }));
}

export const BETA_PLAN_DEFINITIONS_V1: readonly PlanDefinitionV1[] = [
  {
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    displayName: "Starter",
    planDefinitionId: "plan_starter",
    planKey: "starter",
  },
  {
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    displayName: "Pro",
    planDefinitionId: "plan_pro",
    planKey: "pro",
  },
];

export const BETA_PLAN_VERSIONS_V1: readonly PlanVersionV1[] = [
  {
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    configurationVersion: BETA_PLAN_CONFIGURATION_VERSION,
    effectiveFrom: "2026-08-14T00:00:00.000Z",
    effectiveUntil: null,
    entitlements: featureConfiguration([
      "zip-export",
      "diagram-export",
      "terraform",
      "ai-assisted-operations",
    ]),
    futureAdditionalEditorConcept: null,
    includedBillableSeats: 1,
    includedCreditGrants: [{ kind: "monthly", units: 200 }],
    limits: betaOrganizationLimits([
      { key: "projects", value: 5 },
      { key: "active-members", value: 1 },
      { key: "active-owners", value: 1 },
      { key: "active-administrators", value: 1 },
      { key: "active-editors", value: 1 },
      { key: "billable-seats", value: 1 },
      { key: "viewers", value: 0 },
      { key: "concurrent-ai-jobs", value: 1 },
    ]),
    planDefinitionId: "plan_starter",
    planVersionId: "planver_starter_2026_08_14_v1",
    proposedMonthlyPrice: {
      currencyCode: "USD",
      unitAmountMicros: 9_000_000,
    },
  },
  {
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    configurationVersion: BETA_PLAN_CONFIGURATION_VERSION,
    effectiveFrom: "2026-08-14T00:00:00.000Z",
    effectiveUntil: null,
    entitlements: featureConfiguration([
      "zip-export",
      "diagram-export",
      "github-export",
      "terraform",
      "validation-jobs",
      "plan-evidence-workflows",
      "deployment-evidence-workflows",
      "ai-assisted-operations",
    ]),
    futureAdditionalEditorConcept: null,
    includedBillableSeats: 1,
    includedCreditGrants: [{ kind: "monthly", units: 1_000 }],
    limits: betaOrganizationLimits([
      { key: "projects", value: 25 },
      { key: "active-members", value: 1 },
      { key: "active-owners", value: 1 },
      { key: "active-administrators", value: 1 },
      { key: "active-editors", value: 1 },
      { key: "billable-seats", value: 1 },
      { key: "viewers", value: 0 },
      { key: "concurrent-ai-jobs", value: 2 },
    ]),
    planDefinitionId: "plan_pro",
    planVersionId: "planver_pro_2026_08_14_v2",
    proposedMonthlyPrice: {
      currencyCode: "USD",
      unitAmountMicros: 39_000_000,
    },
  },
];
export type CommercialDomainErrorCode =
  | "duplicate-identity"
  | "idempotency-conflict"
  | "insufficient-credits"
  | "invalid-input"
  | "invalid-plan-version"
  | "reservation-terminal"
  | "settlement-exceeds-reservation"
  | "unresolved-expiration-policy";

export class CommercialDomainError extends Error {
  readonly code: CommercialDomainErrorCode;

  constructor(code: CommercialDomainErrorCode, message: string) {
    super(message);
    this.name = "CommercialDomainError";
    this.code = code;
  }
}

function fail(code: CommercialDomainErrorCode, message: string): never {
  throw new CommercialDomainError(code, message);
}

function assertSafeNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("invalid-input", `${label} must be a nonnegative safe integer.`);
  }
}

function assertSafePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("invalid-input", `${label} must be a positive safe integer.`);
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  assertSafeNonnegativeInteger(left, label);
  assertSafeNonnegativeInteger(right, label);
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    fail("invalid-input", `${label} exceeds the safe integer range.`);
  }
  return result;
}

function checkedSignedAdd(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    fail("invalid-input", `${label} must use safe integers.`);
  }
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    fail("invalid-input", `${label} exceeds the safe integer range.`);
  }
  return result;
}

function parseInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    fail("invalid-input", `${label} must be an ISO-8601 instant.`);
  }
  return parsed;
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    fail("invalid-input", `${label} is invalid.`);
  }
}

function assertProviderRequestIdentifier(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
    fail("invalid-input", "providerRequestId is invalid.");
  }
}

function assertModelIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
    fail("invalid-input", `${label} is invalid.`);
  }
}

function assertProviderKey(value: string): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    fail("invalid-input", "providerKey is invalid.");
  }
}
function assertReasonCode(value: string, label: string): void {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(value)) {
    fail("invalid-input", `${label} is invalid.`);
  }
}

function compareStableIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function getBetaPlanVersion(
  planKey: PlanKey,
  at: string,
): PlanVersionV1 {
  const definition = BETA_PLAN_DEFINITIONS_V1.find(
    (candidate) => candidate.planKey === planKey,
  );
  parseInstant(at, "at");
  const version = BETA_PLAN_VERSIONS_V1.filter(
    (candidate) =>
      candidate.planDefinitionId === definition?.planDefinitionId &&
      isPlanEffectiveAt(candidate, at),
  ).sort((left, right) => {
    const effectiveDelta =
      parseInstant(right.effectiveFrom, "effectiveFrom") -
      parseInstant(left.effectiveFrom, "effectiveFrom");
    return effectiveDelta !== 0
      ? effectiveDelta
      : compareStableIdentifiers(right.planVersionId, left.planVersionId);
  })[0];
  if (version === undefined) {
    return fail("invalid-plan-version", "No beta plan version is effective.");
  }
  validatePlanVersionV1(version);
  return version;
}

export function validatePlanVersionV1(
  plan: PlanVersionValidationInputV1,
): asserts plan is PlanVersionV1 {
  if (
    plan.commercialDomainVersion !== COMMERCIAL_DOMAIN_VERSION ||
    (plan.configurationVersion !== BETA_PLAN_CONFIGURATION_VERSION &&
      plan.configurationVersion !== BETA_SHARING_PLAN_CONFIGURATION_VERSION &&
      plan.configurationVersion !== BETA_EXPORT_PLAN_CONFIGURATION_VERSION &&
      plan.configurationVersion !== BETA_CREDIT_PLAN_CONFIGURATION_VERSION &&
      plan.configurationVersion !== STAFF_TRIAL_POLICY_VERSION)
  ) {
    fail("invalid-plan-version", "The plan version is unsupported.");
  }
  if (
    plan.configurationVersion === STAFF_TRIAL_POLICY_VERSION &&
    (plan.planDefinitionId !== "plan_staff_trial" ||
      plan.planVersionId !== STAFF_TRIAL_PLAN_VERSION ||
      plan.includedCreditGrants.length !== 0 ||
      plan.proposedMonthlyPrice?.unitAmountMicros !== 0)
  ) {
    fail(
      "invalid-plan-version",
      "Trial profiles must use independent access evidence and no paid allowance.",
    );
  }
  if (
    (plan.planVersionId === STAFF_TRIAL_PLAN_VERSION) !==
    (plan.configurationVersion === STAFF_TRIAL_POLICY_VERSION)
  )
    fail("invalid-plan-version", "Trial plan identity and policy must match.");
  assertIdentifier(plan.planDefinitionId, "planDefinitionId");
  assertIdentifier(plan.planVersionId, "planVersionId");
  const effectiveFrom = parseInstant(plan.effectiveFrom, "effectiveFrom");
  if (
    plan.effectiveUntil !== null &&
    parseInstant(plan.effectiveUntil, "effectiveUntil") <= effectiveFrom
  ) {
    fail("invalid-plan-version", "The plan effective interval is invalid.");
  }
  assertSafeNonnegativeInteger(
    plan.includedBillableSeats,
    "includedBillableSeats",
  );
  if (plan.proposedMonthlyPrice !== null) {
    if (
      plan.proposedMonthlyPrice.currencyCode !== "USD" ||
      !Number.isSafeInteger(plan.proposedMonthlyPrice.unitAmountMicros) ||
      plan.proposedMonthlyPrice.unitAmountMicros < 0
    ) {
      fail(
        "invalid-plan-version",
        "The proposed price must use USD integer micros.",
      );
    }
  }
  if (plan.futureAdditionalEditorConcept !== null) {
    const concept = plan.futureAdditionalEditorConcept;
    if (
      concept.enabled ||
      concept.proposedMonthlyPrice.currencyCode !== "USD" ||
      !Number.isSafeInteger(concept.proposedMonthlyPrice.unitAmountMicros) ||
      concept.proposedMonthlyPrice.unitAmountMicros < 0
    ) {
      fail(
        "invalid-plan-version",
        "The future editor concept must remain disabled USD price metadata.",
      );
    }
    assertSafePositiveInteger(
      concept.additionalSharedCreditUnits,
      "additionalSharedCreditUnits",
    );
  }
  const featureKeys = plan.entitlements.map((entry) => entry.feature);
  const limitKeys = plan.limits.map((entry) => entry.key);
  if (
    featureKeys.some(
      (feature) =>
        !(COMMERCIAL_FEATURE_KEYS as readonly string[]).includes(feature),
    ) ||
    plan.entitlements.some((entry) => typeof entry.enabled !== "boolean") ||
    new Set(featureKeys).size !== featureKeys.length ||
    new Set(limitKeys).size !== limitKeys.length
  ) {
    fail(
      "invalid-plan-version",
      "Plan features and limits must be supported and unique.",
    );
  }
  const includedGrantKinds = new Set<string>();
  for (const grant of plan.includedCreditGrants) {
    if (
      (grant.kind !== "one-time" && grant.kind !== "monthly") ||
      includedGrantKinds.has(grant.kind)
    ) {
      fail(
        "invalid-plan-version",
        "Included credit grant kinds must be supported and unique.",
      );
    }
    includedGrantKinds.add(grant.kind);
    assertSafePositiveInteger(grant.units, "included credit units");
  }
  for (const limit of plan.limits) {
    if (!(COMMERCIAL_LIMIT_KEYS as readonly string[]).includes(limit.key)) {
      fail("invalid-plan-version", "The plan limit is unsupported.");
    }
    if (
      !(COMMERCIAL_LIMIT_PERIOD_KINDS as readonly string[]).includes(
        limit.period,
      )
    ) {
      fail("invalid-plan-version", "The plan limit period is unsupported.");
    }
    const expectedScope: NumericLimitV1["scope"] =
      limit.key === "per-user-request-count"
        ? "member"
        : limit.key === "per-project-credit-cap"
          ? "project"
          : "organization";
    if (limit.scope !== expectedScope) {
      fail("invalid-plan-version", "The plan limit scope is invalid.");
    }
    assertSafeNonnegativeInteger(limit.value, `${limit.key} limit`);
  }
  const billableSeatLimit = plan.limits.find(
    (limit) => limit.key === "billable-seats",
  );
  if (
    billableSeatLimit !== undefined &&
    plan.includedBillableSeats > billableSeatLimit.value
  ) {
    fail(
      "invalid-plan-version",
      "Included billable seats cannot exceed the billable-seat limit.",
    );
  }
  const requiredSeatLimitKeys = [
    "active-members",
    "active-owners",
    "active-administrators",
    "active-editors",
    "billable-seats",
    "viewers",
  ] as const satisfies readonly CommercialLimitKey[];
  const limitsByKey = new Map(
    plan.limits.map((limit) => [limit.key, limit.value] as const),
  );
  if (requiredSeatLimitKeys.some((key) => !limitsByKey.has(key))) {
    fail(
      "invalid-plan-version",
      "Every plan must configure aggregate, role, billable-seat, and viewer limits.",
    );
  }
  const activeMembers = limitsByKey.get("active-members") ?? 0;
  const billableSeats = limitsByKey.get("billable-seats") ?? 0;
  const viewers = limitsByKey.get("viewers") ?? 0;
  if (
    (plan.configurationVersion === BETA_SHARING_PLAN_CONFIGURATION_VERSION ||
    plan.configurationVersion === BETA_EXPORT_PLAN_CONFIGURATION_VERSION ||
    plan.configurationVersion === BETA_CREDIT_PLAN_CONFIGURATION_VERSION ||
    plan.configurationVersion === STAFF_TRIAL_POLICY_VERSION
      ? billableSeats > activeMembers || viewers > activeMembers
      : checkedAdd(billableSeats, viewers, "configured active members") >
        activeMembers) ||
    (
      ["active-owners", "active-administrators", "active-editors"] as const
    ).some((key) => (limitsByKey.get(key) ?? 0) > billableSeats)
  ) {
    fail(
      "invalid-plan-version",
      "Role, billable-seat, and viewer limits must fit the active-member limit.",
    );
  }
}

export function isPlanEffectiveAt(plan: PlanVersionV1, at: string): boolean {
  validatePlanVersionV1(plan);
  const instant = parseInstant(at, "at");
  return (
    instant >= parseInstant(plan.effectiveFrom, "effectiveFrom") &&
    (plan.effectiveUntil === null ||
      instant < parseInstant(plan.effectiveUntil, "effectiveUntil"))
  );
}

export type BillingAccountLifecycleStatusV1 = "active" | "suspended" | "closed";

export interface OrganizationBillingAccountV1 {
  readonly billingAccountId: string;
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly createdAt: string;
  readonly expensiveOperationsEnabled: boolean;
  readonly lifecycleStatus: BillingAccountLifecycleStatusV1;
  readonly organizationId: string;
  readonly recordVersion: number;
  readonly updatedAt: string;
}
type OrganizationBillingAccountValidationInputV1 = Omit<
  OrganizationBillingAccountV1,
  "commercialDomainVersion"
> & {
  readonly commercialDomainVersion: number;
};

export function validateOrganizationBillingAccountV1(
  account: OrganizationBillingAccountValidationInputV1,
): asserts account is OrganizationBillingAccountV1 {
  if (account.commercialDomainVersion !== COMMERCIAL_DOMAIN_VERSION) {
    fail("invalid-input", "The billing account version is unsupported.");
  }
  if (
    !(["active", "suspended", "closed"] as const).includes(
      account.lifecycleStatus,
    )
  ) {
    fail("invalid-input", "The billing account lifecycle status is invalid.");
  }
  assertIdentifier(account.billingAccountId, "billingAccountId");
  assertIdentifier(account.organizationId, "organizationId");
  assertSafePositiveInteger(account.recordVersion, "recordVersion");
  const createdAt = parseInstant(account.createdAt, "createdAt");
  if (parseInstant(account.updatedAt, "updatedAt") < createdAt) {
    fail("invalid-input", "Billing account updates cannot predate creation.");
  }
  if (
    account.lifecycleStatus !== "active" &&
    account.expensiveOperationsEnabled
  ) {
    fail(
      "invalid-input",
      "A suspended or closed billing account cannot enable expensive operations.",
    );
  }
}

export type LocalSubscriptionNormalizedStateV1 =
  "pending" | "active" | "past-due" | "paused" | "canceled" | "incomplete";

export interface LocalSubscriptionProjectionV1 {
  readonly billableSeatQuantity: number;
  readonly cancelAtPeriodEnd: boolean;
  readonly billingAccountId: string;
  readonly billingProviderKey: string;
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly currentPeriodEndsAt: string | null;
  readonly currentPeriodId: string | null;
  readonly currentPeriodStartsAt: string | null;
  readonly effectiveAt: string;
  readonly lastProviderEventReference: string | null;
  readonly normalizedState: LocalSubscriptionNormalizedStateV1;
  readonly organizationId: string;
  readonly planVersionId: string;
  readonly projectionVersion: number;
  readonly providerCustomerReference: string;
  readonly providerEventPosition: string | null;
  readonly providerPriceReference: string | null;
  readonly providerProductReference: string | null;
  readonly providerSubscriptionReference: string;
  readonly subscriptionProjectionId: string;
}
type LocalSubscriptionProjectionValidationInputV1 = Omit<
  LocalSubscriptionProjectionV1,
  "commercialDomainVersion"
> & {
  readonly commercialDomainVersion: number;
};

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function assertOpaqueReference(value: string, label: string): void {
  if (
    value.length < 1 ||
    value.length > 255 ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    fail("invalid-input", `${label} is invalid.`);
  }
}

export function validateLocalSubscriptionProjectionV1(
  projection: LocalSubscriptionProjectionValidationInputV1,
): asserts projection is LocalSubscriptionProjectionV1 {
  if (projection.commercialDomainVersion !== COMMERCIAL_DOMAIN_VERSION) {
    fail(
      "invalid-input",
      "The subscription projection version is unsupported.",
    );
  }
  if (
    !(
      [
        "pending",
        "active",
        "past-due",
        "paused",
        "canceled",
        "incomplete",
      ] as const
    ).includes(projection.normalizedState)
  ) {
    fail("invalid-input", "The normalized subscription state is invalid.");
  }
  for (const [label, value] of [
    ["billingAccountId", projection.billingAccountId],
    ["billingProviderKey", projection.billingProviderKey],
    ["organizationId", projection.organizationId],
    ["planVersionId", projection.planVersionId],
    ["subscriptionProjectionId", projection.subscriptionProjectionId],
  ] as const) {
    assertIdentifier(value, label);
  }
  for (const [label, value] of [
    ["providerCustomerReference", projection.providerCustomerReference],
    ["providerSubscriptionReference", projection.providerSubscriptionReference],
    ["lastProviderEventReference", projection.lastProviderEventReference],
    ["providerEventPosition", projection.providerEventPosition],
    ["providerPriceReference", projection.providerPriceReference],
    ["providerProductReference", projection.providerProductReference],
  ] as const) {
    if (value !== null) {
      assertOpaqueReference(value, label);
    }
  }
  if (typeof projection.cancelAtPeriodEnd !== "boolean") {
    fail("invalid-input", "The cancellation setting is invalid.");
  }
  assertSafeNonnegativeInteger(
    projection.billableSeatQuantity,
    "billableSeatQuantity",
  );
  assertSafePositiveInteger(projection.projectionVersion, "projectionVersion");
  parseInstant(projection.effectiveAt, "effectiveAt");
  const periodValues = [
    projection.currentPeriodId,
    projection.currentPeriodStartsAt,
    projection.currentPeriodEndsAt,
  ];
  if (
    periodValues.some((value) => value === null) &&
    periodValues.some((value) => value !== null)
  ) {
    fail(
      "invalid-input",
      "Subscription period identity and bounds must be provided together.",
    );
  }
  if (
    projection.currentPeriodId !== null &&
    projection.currentPeriodStartsAt !== null &&
    projection.currentPeriodEndsAt !== null
  ) {
    assertOpaqueReference(projection.currentPeriodId, "currentPeriodId");
    if (
      parseInstant(projection.currentPeriodEndsAt, "currentPeriodEndsAt") <=
      parseInstant(projection.currentPeriodStartsAt, "currentPeriodStartsAt")
    ) {
      fail("invalid-input", "The subscription period bounds are invalid.");
    }
  }
}

export interface BillableSeatQuantityV1 {
  readonly activeBillableSeatCandidates: number;
  readonly additionalBillableSeats: number;
  readonly includedBillableSeats: number;
  readonly includedBillableSeatsUsed: number;
}

export function deriveBillableSeatQuantityV1(
  plan: PlanVersionV1,
  memberships: readonly MembershipSeatRecordV1[],
): BillableSeatQuantityV1 {
  validatePlanVersionV1(plan);
  const activeBillableSeatCandidates =
    countSeatUsageV1(memberships).billableSeats;
  return {
    activeBillableSeatCandidates,
    additionalBillableSeats: Math.max(
      0,
      activeBillableSeatCandidates - plan.includedBillableSeats,
    ),
    includedBillableSeats: plan.includedBillableSeats,
    includedBillableSeatsUsed: Math.min(
      activeBillableSeatCandidates,
      plan.includedBillableSeats,
    ),
  };
}

export interface MembershipSeatRecordV1 {
  readonly membershipId: string;
  readonly role: OrganizationRole;
  readonly status: "active" | "pending-invitation" | "suspended" | "removed";
}

export interface SeatUsageV1 {
  readonly activeMembers: number;
  readonly activeMembersByRole: Readonly<Record<OrganizationRole, number>>;
  readonly billableSeats: number;
  readonly pendingInvitations: number;
  readonly viewers: number;
}

export function countSeatUsageV1(
  memberships: readonly MembershipSeatRecordV1[],
): SeatUsageV1 {
  const seen = new Set<string>();
  const activeMembersByRole: Record<OrganizationRole, number> = {
    administrator: 0,
    editor: 0,
    owner: 0,
    viewer: 0,
  };
  let pendingInvitations = 0;
  for (const membership of memberships) {
    assertIdentifier(membership.membershipId, "membershipId");
    if (
      !(["owner", "administrator", "editor", "viewer"] as const).includes(
        membership.role,
      ) ||
      !(
        ["active", "pending-invitation", "suspended", "removed"] as const
      ).includes(membership.status)
    ) {
      fail("invalid-input", "The membership seat record is invalid.");
    }
    if (seen.has(membership.membershipId)) {
      fail("duplicate-identity", "Membership identities must be unique.");
    }
    seen.add(membership.membershipId);
    if (membership.status === "pending-invitation") {
      pendingInvitations = checkedAdd(
        pendingInvitations,
        1,
        "pending invitations",
      );
    } else if (membership.status === "active") {
      activeMembersByRole[membership.role] = checkedAdd(
        activeMembersByRole[membership.role],
        1,
        `${membership.role} active members`,
      );
    }
  }
  const viewers = activeMembersByRole.viewer;
  const billableSeats = checkedAdd(
    checkedAdd(
      activeMembersByRole.owner,
      activeMembersByRole.administrator,
      "billable seats",
    ),
    activeMembersByRole.editor,
    "billable seats",
  );
  return {
    activeMembers: checkedAdd(billableSeats, viewers, "active members"),
    activeMembersByRole,
    billableSeats,
    pendingInvitations,
    viewers,
  };
}

export const ENTITLEMENT_DENIAL_REASONS = [
  "commercial_state_unavailable",
  "plan_not_effective",
  "feature_not_entitled",
  "feature_disabled",
  "organization_suspended",
  "subscription_inactive",
  "expensive_operations_disabled",
  "project_limit_reached",
  "member_role_limit_reached",
  "billable_seat_limit_reached",
  "viewer_limit_reached",
  "organization_limit_reached",
  "insufficient_credits",
  "concurrent_ai_job_limit_reached",
  "per_user_request_limit_reached",
  "per_project_credit_cap_reached",
  "pricing_unavailable",
] as const;

export type EntitlementDenialReason =
  (typeof ENTITLEMENT_DENIAL_REASONS)[number];

export interface ScopedLimitExtensionV1 {
  readonly authorizedByActorId: string;
  readonly authorizationReference: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly extensionPolicyVersion: string;
  readonly limitKey: CommercialLimitKey;
  readonly period: CommercialLimitPeriodKind;
  readonly planVersionId: string;
  readonly reasonCode: string;
  readonly scope: "member" | "project";
  readonly subjectId: string;
  readonly value: number;
}

export type CommercialOperationKind =
  | "read"
  | "manual-edit"
  | "data-export"
  | "project-create"
  | "member-activate"
  | "expensive";

export interface LimitUsageV1 {
  readonly currentUsage: number;
  readonly limitKey: CommercialLimitKey;
  readonly requestedUsage: number;
}

export interface EvaluatedLimitV1 extends LimitUsageV1 {
  readonly limit: number;
  readonly period: CommercialLimitPeriodKind;
  readonly scope: "organization" | "member" | "project";
}

export interface InactiveSubscriptionAccessPolicyV1 {
  readonly allowPlanExpansionDuringGrace: boolean;
  readonly graceEndsAt: string | null;
  readonly policyVersion: string;
  readonly preserveApprovedDataExport: boolean;
  readonly preserveExistingProjectAccess: boolean;
  readonly preserveManualEditing: boolean;
}

export interface EntitlementDecisionInputV1 {
  readonly at: string;
  readonly availableCreditUnits: number;
  readonly billingAccountId: string;
  readonly billingAccountRecordVersion: number;
  readonly commercialState: "active" | "unavailable";
  readonly expensiveOperationsEnabled: boolean;
  readonly feature: CommercialFeatureKey;
  readonly limitUsage: readonly LimitUsageV1[];
  readonly memberId: string | null;
  readonly operationKind: CommercialOperationKind;
  readonly organizationId: string;
  readonly organizationStatus: "active" | "suspended";
  readonly plan: PlanVersionV1;
  readonly pricingAvailable: boolean;
  readonly projectId: string | null;
  readonly requestedCreditUnits: number;
  readonly scopedLimitExtensions: readonly ScopedLimitExtensionV1[];
  readonly trialAccess?: StaffTrialAccessV1;
  readonly inactiveSubscriptionAccessPolicy?: InactiveSubscriptionAccessPolicyV1;
  readonly subscriptionProjectionVersion: number | null;
  readonly subscriptionState: "active" | "inactive" | "not-required";
  readonly targetRole: OrganizationRole | null;
}

export interface EntitlementDecisionV1 {
  readonly allowed: boolean;
  readonly billingAccountId: string;
  readonly billingAccountRecordVersion: number;
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly denialReason: EntitlementDenialReason | null;
  readonly entitlementPolicyVersion: typeof ENTITLEMENT_POLICY_VERSION;
  readonly evaluatedAt: string;
  readonly evaluatedLimits: readonly EvaluatedLimitV1[];
  readonly feature: CommercialFeatureKey;
  readonly memberId: string | null;
  readonly operationKind: CommercialOperationKind;
  readonly organizationId: string;
  readonly planVersionId: string;
  readonly projectId: string | null;
  readonly subscriptionProjectionVersion: number | null;
  readonly subscriptionState: EntitlementDecisionInputV1["subscriptionState"];
  readonly trialAccess?: StaffTrialAccessV1;
  readonly targetRole: OrganizationRole | null;
}

function denyEntitlement(
  input: EntitlementDecisionInputV1,
  denialReason: EntitlementDenialReason,
  evaluatedLimits: readonly EvaluatedLimitV1[],
): EntitlementDecisionV1 {
  return {
    allowed: false,
    billingAccountId: input.billingAccountId,
    billingAccountRecordVersion: input.billingAccountRecordVersion,
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    denialReason,
    entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION,
    evaluatedAt: input.at,
    evaluatedLimits,
    feature: input.feature,
    memberId: input.memberId,
    operationKind: input.operationKind,
    organizationId: input.organizationId,
    planVersionId: input.plan.planVersionId,
    projectId: input.projectId,
    subscriptionProjectionVersion: input.subscriptionProjectionVersion,
    subscriptionState: input.subscriptionState,
    targetRole: input.targetRole,
    ...(input.trialAccess === undefined
      ? {}
      : { trialAccess: { ...input.trialAccess } }),
  };
}

const dataExportFeatures = new Set<CommercialFeatureKey>([
  "data-export",
  "zip-export",
  "diagram-export",
  "github-export",
  "terraform",
  "cloudformation",
]);

function operationMatchesFeature(
  operationKind: CommercialOperationKind,
  feature: CommercialFeatureKey,
): boolean {
  switch (operationKind) {
    case "manual-edit":
    case "project-create":
      return feature === "manual-editing";
    case "read":
      return [
        "read-existing-projects",
        "existing-artifact-access",
        "organization-roles",
        "shared-projects",
        "audit-history",
      ].includes(feature);
    case "data-export":
      return dataExportFeatures.has(feature);
    case "member-activate":
      return feature === "organization-roles";
    case "expensive":
      return isExpensiveCommercialFeature(feature);
  }
}

function validateLimitExtension(extension: ScopedLimitExtensionV1): void {
  for (const [label, value] of [
    ["authorizedByActorId", extension.authorizedByActorId],
    ["authorizationReference", extension.authorizationReference],
    ["extensionPolicyVersion", extension.extensionPolicyVersion],
    ["planVersionId", extension.planVersionId],
    ["subjectId", extension.subjectId],
  ] as const) {
    assertIdentifier(value, label);
  }
  assertReasonCode(extension.reasonCode, "reasonCode");
  if (!(["member", "project"] as readonly string[]).includes(extension.scope)) {
    fail("invalid-input", "The scoped limit extension scope is unsupported.");
  }
  if (
    !(COMMERCIAL_LIMIT_PERIOD_KINDS as readonly string[]).includes(
      extension.period,
    )
  ) {
    fail("invalid-input", "The scoped limit period is unsupported.");
  }
  if (
    (extension.scope === "member" &&
      extension.limitKey !== "per-user-request-count") ||
    (extension.scope === "project" &&
      extension.limitKey !== "per-project-credit-cap")
  ) {
    fail(
      "invalid-input",
      "Scoped extensions may change only their matching member or project limit.",
    );
  }
  const effectiveFrom = parseInstant(extension.effectiveFrom, "effectiveFrom");
  if (
    extension.effectiveUntil !== null &&
    parseInstant(extension.effectiveUntil, "effectiveUntil") <= effectiveFrom
  ) {
    fail("invalid-input", "The limit-extension interval is invalid.");
  }
  assertSafeNonnegativeInteger(extension.value, "limit extension");
}

function effectiveLimitExtensions(
  input: EntitlementDecisionInputV1,
): readonly ScopedLimitExtensionV1[] {
  const at = parseInstant(input.at, "at");
  return input.scopedLimitExtensions.filter((extension) => {
    validateLimitExtension(extension);
    if (
      extension.planVersionId !== input.plan.planVersionId ||
      parseInstant(extension.effectiveFrom, "effectiveFrom") > at ||
      (extension.effectiveUntil !== null &&
        at >= parseInstant(extension.effectiveUntil, "effectiveUntil"))
    ) {
      return false;
    }
    return (
      (extension.scope === "member" &&
        extension.subjectId === input.memberId) ||
      (extension.scope === "project" && extension.subjectId === input.projectId)
    );
  });
}

function requiredLimitKeys(
  input: EntitlementDecisionInputV1,
  extensions: readonly ScopedLimitExtensionV1[],
): readonly CommercialLimitKey[] {
  if (input.operationKind === "project-create") {
    return ["projects"];
  }
  if (input.operationKind === "member-activate") {
    if (input.targetRole === null) {
      fail("invalid-input", "Member activation requires a target role.");
    }
    const targetRoleKey: CommercialLimitKey =
      input.targetRole === "owner"
        ? "active-owners"
        : input.targetRole === "administrator"
          ? "active-administrators"
          : input.targetRole === "editor"
            ? "active-editors"
            : "viewers";
    return [
      "active-members",
      targetRoleKey,
      ...(input.targetRole === "viewer" ? [] : (["billable-seats"] as const)),
    ];
  }
  if (input.targetRole !== null) {
    fail("invalid-input", "Only member activation may carry a target role.");
  }
  if (input.operationKind !== "expensive") {
    return [];
  }
  const keys: CommercialLimitKey[] = ["concurrent-ai-jobs"];
  for (const key of [
    "per-user-request-count",
    "per-project-credit-cap",
  ] as const) {
    if (
      input.plan.limits.some((limit) => limit.key === key) ||
      extensions.some((extension) => extension.limitKey === key)
    ) {
      keys.push(key);
    }
  }
  return keys;
}

function resolveLimit(
  input: EntitlementDecisionInputV1,
  key: CommercialLimitKey,
  extensions: readonly ScopedLimitExtensionV1[],
): {
  readonly limit: number | null;
  readonly period: CommercialLimitPeriodKind;
  readonly scope: EvaluatedLimitV1["scope"];
} {
  const matching = extensions.filter((extension) => extension.limitKey === key);
  if (matching.length > 1) {
    fail("invalid-input", "Overlapping limit extensions are not allowed.");
  }
  const planLimit = input.plan.limits.find((limit) => limit.key === key);
  const extension = matching[0];
  if (extension !== undefined) {
    if (
      planLimit !== undefined &&
      (extension.value < planLimit.value ||
        extension.period !== planLimit.period)
    ) {
      fail(
        "invalid-input",
        "A scoped extension cannot reduce a plan limit or change its period.",
      );
    }
    return {
      limit: extension.value,
      period: extension.period,
      scope: extension.scope,
    };
  }
  return {
    period: planLimit?.period ?? "none",
    limit: planLimit?.value ?? null,
    scope: planLimit?.scope ?? "organization",
  };
}

function inactiveSubscriptionAllows(
  input: EntitlementDecisionInputV1,
  policy: InactiveSubscriptionAccessPolicyV1,
): boolean {
  assertIdentifier(policy.policyVersion, "inactive subscription policyVersion");
  const now = parseInstant(input.at, "at");
  const withinGrace =
    policy.graceEndsAt !== null &&
    now < parseInstant(policy.graceEndsAt, "graceEndsAt");

  switch (input.operationKind) {
    case "read":
      return policy.preserveExistingProjectAccess;
    case "manual-edit":
      return policy.preserveManualEditing;
    case "data-export":
      return policy.preserveApprovedDataExport;
    case "project-create":
    case "member-activate":
      return withinGrace && policy.allowPlanExpansionDuringGrace;
    case "expensive":
      return false;
  }
}

function denialReasonForLimit(
  key: string,
  scope: EvaluatedLimitV1["scope"],
): EntitlementDenialReason {
  if (key === "projects") return "project_limit_reached";
  if (key === "active-members") return "member_role_limit_reached";
  if (
    key === "active-owners" ||
    key === "active-administrators" ||
    key === "active-editors"
  ) {
    return "member_role_limit_reached";
  }
  if (key === "billable-seats") return "billable_seat_limit_reached";
  if (key === "viewers") return "viewer_limit_reached";
  if (key === "concurrent-ai-jobs") {
    return "concurrent_ai_job_limit_reached";
  }
  if (key === "per-user-request-count" || scope === "member") {
    return "per_user_request_limit_reached";
  }
  if (key === "per-project-credit-cap" || scope === "project") {
    return "per_project_credit_cap_reached";
  }
  return "organization_limit_reached";
}

export function evaluateEntitlementV1(
  input: EntitlementDecisionInputV1,
): EntitlementDecisionV1 {
  validatePlanVersionV1(input.plan);
  assertIdentifier(input.billingAccountId, "billingAccountId");
  assertIdentifier(input.organizationId, "organizationId");
  assertSafePositiveInteger(
    input.billingAccountRecordVersion,
    "billingAccountRecordVersion",
  );
  if (input.subscriptionProjectionVersion !== null) {
    assertSafePositiveInteger(
      input.subscriptionProjectionVersion,
      "subscriptionProjectionVersion",
    );
  }
  if (
    (input.subscriptionState === "active" &&
      input.subscriptionProjectionVersion === null) ||
    (input.subscriptionState === "not-required" &&
      input.subscriptionProjectionVersion !== null)
  ) {
    fail(
      "invalid-input",
      "Subscription state and projection-version evidence are inconsistent.",
    );
  }
  const trial = input.trialAccess;
  if (
    (input.plan.planVersionId === STAFF_TRIAL_PLAN_VERSION) !==
    (trial !== undefined)
  ) {
    fail(
      "invalid-input",
      "Trial access evidence must match the independent trial profile.",
    );
  }
  if (trial !== undefined) {
    assertIdentifier(trial.trialId, "trialId");
    const observedTrial: { contractVersion: unknown; policyVersion: unknown } =
      trial;
    if (
      observedTrial.contractVersion !== 1 ||
      observedTrial.policyVersion !== STAFF_TRIAL_POLICY_VERSION ||
      input.subscriptionState !== "not-required" ||
      input.subscriptionProjectionVersion !== null ||
      input.inactiveSubscriptionAccessPolicy !== undefined
    ) {
      fail(
        "invalid-input",
        "Trial evidence cannot be paid subscription or grace authority.",
      );
    }
    if (staffTrialState({ ...trial, asOf: input.at }) !== "active")
      return denyEntitlement(input, "commercial_state_unavailable", []);
  }
  const inactiveSubscriptionPolicy = input.inactiveSubscriptionAccessPolicy;
  if (
    (input.subscriptionState === "inactive" &&
      inactiveSubscriptionPolicy === undefined) ||
    (input.subscriptionState !== "inactive" &&
      inactiveSubscriptionPolicy !== undefined)
  ) {
    fail("invalid-input", "Subscription-state access policy is unavailable.");
  }
  assertSafeNonnegativeInteger(
    input.availableCreditUnits,
    "availableCreditUnits",
  );
  assertSafeNonnegativeInteger(
    input.requestedCreditUnits,
    "requestedCreditUnits",
  );
  for (const [label, value] of [
    ["memberId", input.memberId],
    ["projectId", input.projectId],
  ] as const) {
    if (value !== null) {
      assertIdentifier(value, label);
    }
  }
  if (!operationMatchesFeature(input.operationKind, input.feature)) {
    fail(
      "invalid-input",
      "The commercial operation does not match its feature.",
    );
  }
  if (
    input.operationKind === "expensive" &&
    (input.memberId === null || input.projectId === null)
  ) {
    fail(
      "invalid-input",
      "Expensive operations require member and project scope.",
    );
  }
  const usageByKey = new Map<CommercialLimitKey, LimitUsageV1>();
  for (const usage of input.limitUsage) {
    if (
      !(COMMERCIAL_LIMIT_KEYS as readonly string[]).includes(usage.limitKey)
    ) {
      fail("invalid-input", "The commercial limit key is invalid.");
    }
    if (usageByKey.has(usage.limitKey)) {
      fail("invalid-input", "A commercial limit was evaluated more than once.");
    }
    assertSafeNonnegativeInteger(usage.currentUsage, "currentUsage");
    assertSafeNonnegativeInteger(usage.requestedUsage, "requestedUsage");
    usageByKey.set(usage.limitKey, usage);
  }
  if (!isPlanEffectiveAt(input.plan, input.at)) {
    return denyEntitlement(input, "plan_not_effective", []);
  }
  const entitlement = input.plan.entitlements.find(
    (candidate) => candidate.feature === input.feature,
  );
  if (entitlement === undefined) {
    return denyEntitlement(input, "feature_not_entitled", []);
  }
  if (!entitlement.enabled) {
    return denyEntitlement(input, "feature_disabled", []);
  }
  if (
    input.subscriptionState === "inactive" &&
    inactiveSubscriptionPolicy !== undefined &&
    !inactiveSubscriptionAllows(input, inactiveSubscriptionPolicy)
  ) {
    return denyEntitlement(input, "subscription_inactive", []);
  }
  const requiresCurrentCommercialAuthorization = [
    "project-create",
    "member-activate",
    "expensive",
  ].includes(input.operationKind);
  if (requiresCurrentCommercialAuthorization) {
    if (input.commercialState === "unavailable") {
      return denyEntitlement(input, "commercial_state_unavailable", []);
    }
    if (input.organizationStatus === "suspended") {
      return denyEntitlement(input, "organization_suspended", []);
    }
  }
  if (input.operationKind === "expensive") {
    if (!input.expensiveOperationsEnabled) {
      return denyEntitlement(input, "expensive_operations_disabled", []);
    }
    if (!input.pricingAvailable) {
      return denyEntitlement(input, "pricing_unavailable", []);
    }
  }

  const extensions = effectiveLimitExtensions(input);
  const requiredKeys = requiredLimitKeys(input, extensions);
  if (
    usageByKey.size !== requiredKeys.length ||
    requiredKeys.some((key) => !usageByKey.has(key))
  ) {
    fail(
      "invalid-input",
      "The operation must evaluate every applicable commercial limit exactly once.",
    );
  }
  const evaluatedLimits: EvaluatedLimitV1[] = [];
  for (const key of requiredKeys) {
    const usage = usageByKey.get(key);
    if (usage === undefined) {
      fail("invalid-input", "The applicable limit usage is unavailable.");
    }
    const resolved = resolveLimit(input, key, extensions);
    if (resolved.limit === null) {
      return denyEntitlement(
        input,
        "commercial_state_unavailable",
        evaluatedLimits,
      );
    }
    const evaluated: EvaluatedLimitV1 = {
      ...usage,
      period: resolved.period,
      limit: resolved.limit,
      scope: resolved.scope,
    };
    evaluatedLimits.push(evaluated);
    if (
      checkedAdd(usage.currentUsage, usage.requestedUsage, "limit usage") >
      resolved.limit
    ) {
      return denyEntitlement(
        input,
        denialReasonForLimit(key, resolved.scope),
        evaluatedLimits,
      );
    }
  }
  if (
    input.operationKind === "expensive" &&
    input.requestedCreditUnits > input.availableCreditUnits
  ) {
    return denyEntitlement(input, "insufficient_credits", evaluatedLimits);
  }
  return {
    allowed: true,
    billingAccountId: input.billingAccountId,
    billingAccountRecordVersion: input.billingAccountRecordVersion,
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    denialReason: null,
    entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION,
    evaluatedAt: input.at,
    evaluatedLimits,
    feature: input.feature,
    memberId: input.memberId,
    operationKind: input.operationKind,
    organizationId: input.organizationId,
    planVersionId: input.plan.planVersionId,
    projectId: input.projectId,
    subscriptionProjectionVersion: input.subscriptionProjectionVersion,
    subscriptionState: input.subscriptionState,
    targetRole: input.targetRole,
    ...(input.trialAccess === undefined
      ? {}
      : { trialAccess: { ...input.trialAccess } }),
  };
}

export type CreditGrantKind =
  "one-time" | "monthly" | "promotional" | "purchased" | "administrative";

export type GrantExpirationPolicyV1 =
  | {
      readonly kind: "expires-at";
      readonly policyVersion: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "does-not-expire";
      readonly policyVersion: string;
      readonly expiresAt: null;
    }
  | {
      readonly kind: "unresolved";
      readonly policyVersion: null;
      readonly expiresAt: null;
    };

export interface CreditGrantV1 {
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly consumptionPriority: number;
  readonly createdAt: string;
  readonly expirationPolicy: GrantExpirationPolicyV1;
  readonly grantPolicyVersion: string;
  readonly grantId: string;
  readonly grantKind: CreditGrantKind;
  readonly idempotencyKey: string;
  readonly sourcePlanVersionId: string | null;
  readonly sourceReference: string | null;
  readonly startsAt: string;
  readonly subscriptionPeriodEnd: string | null;
  readonly subscriptionPeriodId: string | null;
  readonly totalUnits: number;
}
type CreditGrantValidationInputV1 = Omit<
  CreditGrantV1,
  "commercialDomainVersion" | "grantKind"
> & {
  readonly commercialDomainVersion: number;
  readonly grantKind: string;
};

export interface CreditAllocationV1 {
  readonly grantId: string;
  readonly units: number;
}

export type CreditReservationStatus =
  "active" | "settled" | "released" | "expired";

export interface CreditReservationV1 {
  readonly actingPrincipalId: string;
  readonly allocations: readonly CreditAllocationV1[];
  readonly chargingPolicyVersion: typeof USAGE_DISPOSITION_POLICY_VERSION;
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly createdAt: string;
  readonly entitlementPolicyVersion: string;
  readonly estimatedUnits: number;
  readonly expiresAt: string;
  readonly feature: CommercialFeatureKey;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly planVersionId: string;
  readonly pricingVersionId: string;
  readonly projectId: string;
  readonly providerKey: string;
  readonly requestId: string;
  readonly reservationId: string;
  readonly status: CreditReservationStatus;
  readonly terminalAt: string | null;
  readonly terminalEventId: string | null;
}

export interface ProviderUsageMetricsV1 {
  readonly cachedInputTokens: number;
  readonly estimatedProviderCostMicros: number;
  readonly inputTokens: number;
  readonly latencyMilliseconds: number;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly outputTokens: number;
  readonly providerCostCurrency: string;
  readonly providerKey: string;
  readonly providerRequestId: string | null;
}

export type UsageEventKind =
  | "grant"
  | "reservation"
  | "settlement"
  | "release"
  | "expiration"
  | "provider-failure"
  | "adjustment";

export const USAGE_RECORDER_ACTOR_KINDS = [
  "principal",
  "internal-accounting",
  "internal-administration",
] as const;
export type UsageRecorderActorKind =
  (typeof USAGE_RECORDER_ACTOR_KINDS)[number];

export interface UsageEventV1 {
  readonly actingPrincipalId: string | null;
  readonly allocations: readonly CreditAllocationV1[];
  readonly chargingScenario: ChargingPolicyScenarioV1 | null;
  readonly chargingPolicyVersion: typeof USAGE_DISPOSITION_POLICY_VERSION;
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly customerCreditEffectUnits: number;
  readonly eventId: string;
  readonly eventKind: UsageEventKind;
  readonly feature: CommercialFeatureKey | null;
  readonly grantId: string | null;
  readonly idempotencyKey: string;
  readonly jobId: string | null;
  readonly modelId: string | null;
  readonly modelVersion: string | null;
  readonly occurredAt: string;
  readonly outcome: TechnicalUsageOutcomeV1;
  readonly planVersionId: string | null;
  readonly pricingVersionId: string | null;
  readonly projectId: string | null;
  readonly providerKey: string | null;
  readonly providerUsage: ProviderUsageMetricsV1 | null;
  readonly reasonCode: string;
  readonly recordedByActorId: string;
  readonly recordedByActorKind: UsageRecorderActorKind;
  readonly relatedUsageEventId: string | null;
  readonly requestId: string | null;
  readonly reservationId: string | null;
}

function usageEventFingerprint(event: UsageEventV1): string {
  return JSON.stringify({
    actingPrincipalId: event.actingPrincipalId,
    allocations: event.allocations.map((allocation) => ({
      grantId: allocation.grantId,
      units: allocation.units,
    })),
    chargingScenario: event.chargingScenario,
    chargingPolicyVersion: event.chargingPolicyVersion,
    commercialDomainVersion: event.commercialDomainVersion,
    customerCreditEffectUnits: event.customerCreditEffectUnits,
    eventId: event.eventId,
    eventKind: event.eventKind,
    feature: event.feature,
    grantId: event.grantId,
    idempotencyKey: event.idempotencyKey,
    jobId: event.jobId,
    modelId: event.modelId,
    modelVersion: event.modelVersion,
    occurredAt: event.occurredAt,
    outcome: event.outcome,
    planVersionId: event.planVersionId,
    pricingVersionId: event.pricingVersionId,
    projectId: event.projectId,
    providerKey: event.providerKey,
    providerUsage:
      event.providerUsage === null
        ? null
        : {
            cachedInputTokens: event.providerUsage.cachedInputTokens,
            estimatedProviderCostMicros:
              event.providerUsage.estimatedProviderCostMicros,
            inputTokens: event.providerUsage.inputTokens,
            latencyMilliseconds: event.providerUsage.latencyMilliseconds,
            modelId: event.providerUsage.modelId,
            modelVersion: event.providerUsage.modelVersion,
            outputTokens: event.providerUsage.outputTokens,
            providerCostCurrency: event.providerUsage.providerCostCurrency,
            providerKey: event.providerUsage.providerKey,
            providerRequestId: event.providerUsage.providerRequestId,
          },
    reasonCode: event.reasonCode,
    recordedByActorId: event.recordedByActorId,
    recordedByActorKind: event.recordedByActorKind,
    relatedUsageEventId: event.relatedUsageEventId,
    requestId: event.requestId,
    reservationId: event.reservationId,
  });
}

function validateUsageRecorder(
  kind: UsageRecorderActorKind,
  actorId: string,
): void {
  if (!(USAGE_RECORDER_ACTOR_KINDS as readonly string[]).includes(kind)) {
    fail("invalid-input", "The usage recorder actor kind is unsupported.");
  }
  assertIdentifier(actorId, "recordedByActorId");
}

function assertNewUsageEventIdentity(
  state: CreditAccountStateV1,
  event: UsageEventV1,
): void {
  if (
    state.usageEvents.some(
      (candidate) => candidate.idempotencyKey === event.idempotencyKey,
    )
  ) {
    fail("idempotency-conflict", "The usage idempotency key was reused.");
  }
  if (
    state.usageEvents.some((candidate) => candidate.eventId === event.eventId)
  ) {
    fail("duplicate-identity", "The usage event identity already exists.");
  }
}

export interface CreditAccountStateV1 {
  readonly commercialDomainVersion: typeof COMMERCIAL_DOMAIN_VERSION;
  readonly grants: readonly CreditGrantV1[];
  readonly organizationId: string;
  readonly reservations: readonly CreditReservationV1[];
  readonly usageEvents: readonly UsageEventV1[];
}

export function createEmptyCreditAccountV1(
  organizationId: string,
): CreditAccountStateV1 {
  assertIdentifier(organizationId, "organizationId");
  return {
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    grants: [],
    organizationId,
    reservations: [],
    usageEvents: [],
  };
}

function validateGrant(
  grant: CreditGrantValidationInputV1,
): asserts grant is CreditGrantV1 {
  if (grant.commercialDomainVersion !== COMMERCIAL_DOMAIN_VERSION) {
    fail("invalid-input", "The credit grant version is unsupported.");
  }
  if (
    !(
      [
        "one-time",
        "monthly",
        "promotional",
        "purchased",
        "administrative",
      ] as readonly string[]
    ).includes(grant.grantKind)
  ) {
    fail("invalid-input", "The credit grant kind is unsupported.");
  }
  if (
    !(["expires-at", "does-not-expire", "unresolved"] as const).includes(
      grant.expirationPolicy.kind,
    )
  ) {
    fail("invalid-input", "The credit grant expiration policy is unsupported.");
  }
  assertIdentifier(grant.grantId, "grantId");
  assertIdentifier(grant.grantPolicyVersion, "grantPolicyVersion");
  assertIdentifier(grant.idempotencyKey, "idempotencyKey");
  if (grant.sourcePlanVersionId !== null) {
    assertIdentifier(grant.sourcePlanVersionId, "sourcePlanVersionId");
  }
  if (grant.sourceReference !== null) {
    assertOpaqueReference(grant.sourceReference, "sourceReference");
  }
  if (
    (grant.grantKind === "one-time" || grant.grantKind === "monthly") &&
    grant.sourcePlanVersionId === null
  ) {
    fail(
      "invalid-input",
      "Plan-included one-time and monthly grants require a source plan version.",
    );
  }
  if (grant.expirationPolicy.kind !== "unresolved") {
    assertIdentifier(grant.expirationPolicy.policyVersion, "policyVersion");
  }
  assertSafePositiveInteger(grant.totalUnits, "grant units");
  assertSafeNonnegativeInteger(
    grant.consumptionPriority,
    "consumptionPriority",
  );
  const startsAt = parseInstant(grant.startsAt, "startsAt");
  parseInstant(grant.createdAt, "createdAt");
  const subscriptionPeriodEnd = grant.subscriptionPeriodEnd;
  if (grant.expirationPolicy.kind === "expires-at") {
    if (
      parseInstant(grant.expirationPolicy.expiresAt, "expiresAt") <= startsAt
    ) {
      fail("invalid-input", "Grant expiration must be after its start.");
    }
  } else if (grant.grantKind === "monthly") {
    fail("invalid-input", "Monthly grants must expire at period end.");
  }
  if (grant.grantKind === "monthly") {
    if (
      grant.subscriptionPeriodId === null ||
      subscriptionPeriodEnd === null ||
      grant.expirationPolicy.kind !== "expires-at" ||
      parseInstant(subscriptionPeriodEnd, "subscriptionPeriodEnd") !==
        parseInstant(grant.expirationPolicy.expiresAt, "expiresAt")
    ) {
      fail(
        "invalid-input",
        "Monthly grants require one explicit period ending at expiration.",
      );
    }
    assertIdentifier(grant.subscriptionPeriodId, "subscriptionPeriodId");
  } else if (
    grant.subscriptionPeriodId !== null ||
    subscriptionPeriodEnd !== null
  ) {
    fail(
      "invalid-input",
      "Only monthly grants may reference a subscription period.",
    );
  }
  if (
    grant.expirationPolicy.kind === "unresolved" &&
    grant.grantKind !== "purchased"
  ) {
    fail(
      "invalid-input",
      "Only purchased credits may carry an unresolved expiration policy.",
    );
  }
}
function isCreditStateRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function creditStateIdentifier(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    return fail("invalid-input", `${label} is invalid.`);
  }
  assertIdentifier(value, label);
  return value;
}

function validateCreditStateAllocations(
  value: unknown,
  knownGrantIds: ReadonlySet<string>,
  label: string,
): number {
  if (!Array.isArray(value)) {
    return fail("invalid-input", `${label} must be an array.`);
  }
  const seenGrantIds = new Set<string>();
  let totalUnits = 0;
  for (const allocationValue of value as readonly unknown[]) {
    if (!isCreditStateRecord(allocationValue)) {
      fail("invalid-input", `${label} contains an invalid allocation.`);
    }
    const grantId = creditStateIdentifier(
      allocationValue,
      "grantId",
      `${label} grantId`,
    );
    const units = allocationValue["units"];
    if (typeof units !== "number") {
      fail("invalid-input", `${label} units are invalid.`);
    }
    assertSafePositiveInteger(units, `${label} units`);
    if (!knownGrantIds.has(grantId) || seenGrantIds.has(grantId)) {
      fail(
        "invalid-input",
        `${label} must reference each known grant at most once.`,
      );
    }
    seenGrantIds.add(grantId);
    totalUnits = checkedAdd(totalUnits, units, `${label} units`);
  }
  return totalUnits;
}

export function validateCreditAccountStateV1(
  state: unknown,
): asserts state is CreditAccountStateV1 {
  if (!isCreditStateRecord(state)) {
    fail("invalid-input", "The credit account state is invalid.");
  }
  if (state["commercialDomainVersion"] !== COMMERCIAL_DOMAIN_VERSION) {
    fail("invalid-input", "The credit account state version is unsupported.");
  }
  const organizationId = state["organizationId"];
  if (typeof organizationId !== "string") {
    fail("invalid-input", "organizationId is invalid.");
  }
  assertIdentifier(organizationId, "organizationId");

  const grantValues: unknown = state["grants"];
  const reservationValues: unknown = state["reservations"];
  const usageEventValues: unknown = state["usageEvents"];
  if (
    !Array.isArray(grantValues) ||
    !Array.isArray(reservationValues) ||
    !Array.isArray(usageEventValues)
  ) {
    fail(
      "invalid-input",
      "Credit account grants, reservations, and usage events must be arrays.",
    );
  }

  const grantIds = new Set<string>();
  const grantIdempotencyKeys = new Set<string>();
  for (const grantValue of grantValues as readonly unknown[]) {
    if (
      !isCreditStateRecord(grantValue) ||
      !isCreditStateRecord(grantValue["expirationPolicy"])
    ) {
      fail("invalid-input", "The credit account contains an invalid grant.");
    }
    const grant = grantValue as unknown as CreditGrantValidationInputV1;
    validateGrant(grant);
    if (
      grantIds.has(grant.grantId) ||
      grantIdempotencyKeys.has(grant.idempotencyKey)
    ) {
      fail(
        "invalid-input",
        "The credit account contains duplicate grant identity.",
      );
    }
    grantIds.add(grant.grantId);
    grantIdempotencyKeys.add(grant.idempotencyKey);
  }

  const reservationIds = new Set<string>();
  const reservationIdempotencyKeys = new Set<string>();
  const reservationRequestIds = new Set<string>();
  for (const reservationValue of reservationValues as readonly unknown[]) {
    if (
      !isCreditStateRecord(reservationValue) ||
      reservationValue["commercialDomainVersion"] !== COMMERCIAL_DOMAIN_VERSION
    ) {
      fail(
        "invalid-input",
        "The credit account contains an unsupported reservation.",
      );
    }
    const reservationId = creditStateIdentifier(
      reservationValue,
      "reservationId",
      "reservationId",
    );
    const idempotencyKey = creditStateIdentifier(
      reservationValue,
      "idempotencyKey",
      "reservation idempotencyKey",
    );
    const requestId = creditStateIdentifier(
      reservationValue,
      "requestId",
      "requestId",
    );
    if (
      reservationIds.has(reservationId) ||
      reservationIdempotencyKeys.has(idempotencyKey) ||
      reservationRequestIds.has(requestId)
    ) {
      fail(
        "invalid-input",
        "The credit account contains duplicate reservation identity.",
      );
    }
    const estimatedUnits = reservationValue["estimatedUnits"];
    if (typeof estimatedUnits !== "number") {
      fail("invalid-input", "Reservation estimatedUnits are invalid.");
    }
    assertSafePositiveInteger(estimatedUnits, "estimatedUnits");
    if (
      validateCreditStateAllocations(
        reservationValue["allocations"],
        grantIds,
        "Reservation allocations",
      ) !== estimatedUnits
    ) {
      fail(
        "invalid-input",
        "Reservation allocations must equal the estimated units.",
      );
    }
    const status = reservationValue["status"];
    if (
      typeof status !== "string" ||
      !(
        ["active", "settled", "released", "expired"] as readonly string[]
      ).includes(status) ||
      reservationValue["chargingPolicyVersion"] !==
        USAGE_DISPOSITION_POLICY_VERSION
    ) {
      fail("invalid-input", "The reservation state is unsupported.");
    }
    reservationIds.add(reservationId);
    reservationIdempotencyKeys.add(idempotencyKey);
    reservationRequestIds.add(requestId);
  }

  const eventIds = new Set<string>();
  const eventIdempotencyKeys = new Set<string>();
  for (const eventValue of usageEventValues as readonly unknown[]) {
    if (
      !isCreditStateRecord(eventValue) ||
      eventValue["commercialDomainVersion"] !== COMMERCIAL_DOMAIN_VERSION ||
      eventValue["chargingPolicyVersion"] !== USAGE_DISPOSITION_POLICY_VERSION
    ) {
      fail(
        "invalid-input",
        "The credit account contains an unsupported usage event.",
      );
    }
    const eventId = creditStateIdentifier(eventValue, "eventId", "eventId");
    const idempotencyKey = creditStateIdentifier(
      eventValue,
      "idempotencyKey",
      "usage idempotencyKey",
    );
    if (eventIds.has(eventId) || eventIdempotencyKeys.has(idempotencyKey)) {
      fail(
        "invalid-input",
        "The credit account contains duplicate usage-event identity.",
      );
    }
    const eventKind = eventValue["eventKind"];
    if (
      typeof eventKind !== "string" ||
      !(
        [
          "grant",
          "reservation",
          "settlement",
          "release",
          "expiration",
          "provider-failure",
          "adjustment",
        ] as readonly string[]
      ).includes(eventKind)
    ) {
      fail("invalid-input", "The usage event kind is unsupported.");
    }
    const occurredAt = eventValue["occurredAt"];
    if (typeof occurredAt !== "string") {
      fail("invalid-input", "Usage event occurredAt is invalid.");
    }
    parseInstant(occurredAt, "occurredAt");
    const customerCreditEffectUnits = eventValue["customerCreditEffectUnits"];
    if (
      typeof customerCreditEffectUnits !== "number" ||
      !Number.isSafeInteger(customerCreditEffectUnits)
    ) {
      fail("invalid-input", "Usage credit effects must use safe integers.");
    }
    validateCreditStateAllocations(
      eventValue["allocations"],
      grantIds,
      "Usage event allocations",
    );
    const grantId = eventValue["grantId"];
    if (
      grantId !== null &&
      (typeof grantId !== "string" || !grantIds.has(grantId))
    ) {
      fail("invalid-input", "The usage event grant reference is invalid.");
    }
    const reservationId = eventValue["reservationId"];
    if (
      reservationId !== null &&
      (typeof reservationId !== "string" || !reservationIds.has(reservationId))
    ) {
      fail(
        "invalid-input",
        "The usage event reservation reference is invalid.",
      );
    }
    const actorKind = eventValue["recordedByActorKind"];
    const actorId = eventValue["recordedByActorId"];
    if (typeof actorKind !== "string" || typeof actorId !== "string") {
      fail("invalid-input", "The usage recorder evidence is invalid.");
    }
    validateUsageRecorder(actorKind as UsageRecorderActorKind, actorId);
    const providerUsage = eventValue["providerUsage"];
    if (providerUsage !== null) {
      if (!isCreditStateRecord(providerUsage)) {
        fail("invalid-input", "The provider usage evidence is invalid.");
      }
      validateProviderUsage(providerUsage as unknown as ProviderUsageMetricsV1);
    }
    eventIds.add(eventId);
    eventIdempotencyKeys.add(idempotencyKey);
  }
}

function grantFingerprint(grant: CreditGrantV1): string {
  return JSON.stringify({
    commercialDomainVersion: grant.commercialDomainVersion,
    consumptionPriority: grant.consumptionPriority,
    createdAt: grant.createdAt,
    expirationKind: grant.expirationPolicy.kind,
    expirationPolicyVersion: grant.expirationPolicy.policyVersion,
    expiresAt: grant.expirationPolicy.expiresAt,
    grantPolicyVersion: grant.grantPolicyVersion,
    grantId: grant.grantId,
    grantKind: grant.grantKind,
    idempotencyKey: grant.idempotencyKey,
    sourcePlanVersionId: grant.sourcePlanVersionId,
    sourceReference: grant.sourceReference,
    startsAt: grant.startsAt,
    subscriptionPeriodEnd: grant.subscriptionPeriodEnd,
    subscriptionPeriodId: grant.subscriptionPeriodId,
    totalUnits: grant.totalUnits,
  });
}

export interface GrantCreditsInputV1 {
  readonly actingAdministratorId: string | null;
  readonly eventId: string;
  readonly grant: CreditGrantValidationInputV1;
  readonly reasonCode: string;
  readonly recordedByActorId: string;
  readonly recordedByActorKind:
    "internal-accounting" | "internal-administration";
  readonly relatedUsageEventId: string | null;
}

export interface CreditTransitionResultV1 {
  readonly replayed: boolean;
  readonly state: CreditAccountStateV1;
}

function makeGrantEvent(input: GrantCreditsInputV1): UsageEventV1 {
  const isAdministrative = input.grant.grantKind === "administrative";
  return {
    actingPrincipalId: null,
    allocations: isAdministrative
      ? [{ grantId: input.grant.grantId, units: input.grant.totalUnits }]
      : [],
    chargingScenario: null,
    chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    customerCreditEffectUnits: input.grant.totalUnits,
    eventId: input.eventId,
    eventKind: isAdministrative ? "adjustment" : "grant",
    feature: null,
    grantId: isAdministrative ? null : input.grant.grantId,
    idempotencyKey: input.grant.idempotencyKey,
    jobId: null,
    modelId: null,
    modelVersion: null,
    occurredAt: input.grant.createdAt,
    outcome: isAdministrative ? "compensated" : "granted",
    planVersionId: input.grant.sourcePlanVersionId,
    pricingVersionId: null,
    projectId: null,
    providerKey: null,
    providerUsage: null,
    reasonCode: input.reasonCode,
    recordedByActorId: input.recordedByActorId,
    recordedByActorKind: input.recordedByActorKind,
    relatedUsageEventId: input.relatedUsageEventId,
    requestId: null,
    reservationId: null,
  };
}

export function grantCreditsV1(
  state: CreditAccountStateV1,
  input: GrantCreditsInputV1,
): CreditTransitionResultV1 {
  validateCreditAccountStateV1(state);
  validateGrant(input.grant);
  const acceptedGrant: CreditGrantV1 = {
    ...input.grant,
    expirationPolicy: { ...input.grant.expirationPolicy },
  };
  validateUsageRecorder(input.recordedByActorKind, input.recordedByActorId);
  assertIdentifier(input.eventId, "eventId");
  if (input.actingAdministratorId !== null) {
    assertIdentifier(input.actingAdministratorId, "actingAdministratorId");
  }
  if (input.relatedUsageEventId !== null) {
    assertIdentifier(input.relatedUsageEventId, "relatedUsageEventId");
  }
  assertReasonCode(input.reasonCode, "reasonCode");
  if (
    (input.grant.grantKind === "administrative") !==
      (input.actingAdministratorId !== null) ||
    (input.grant.grantKind === "administrative") !==
      (input.relatedUsageEventId !== null)
  ) {
    fail(
      "invalid-input",
      "Administrative grants require a trusted actor and related usage event.",
    );
  }
  const isAdministrative = input.grant.grantKind === "administrative";
  if (
    (isAdministrative &&
      (input.recordedByActorKind !== "internal-administration" ||
        input.recordedByActorId !== input.actingAdministratorId)) ||
    (!isAdministrative && input.recordedByActorKind !== "internal-accounting")
  ) {
    fail(
      "invalid-input",
      "Grant recorder evidence does not match the trusted issuance boundary.",
    );
  }
  if (
    input.relatedUsageEventId !== null &&
    !state.usageEvents.some(
      (event) => event.eventId === input.relatedUsageEventId,
    )
  ) {
    fail("invalid-input", "The related usage event does not exist.");
  }
  const candidateEvent = makeGrantEvent(input);
  const existing = state.grants.find(
    (grant) => grant.idempotencyKey === input.grant.idempotencyKey,
  );
  const periodGrant =
    input.grant.grantKind === "monthly"
      ? state.grants.find(
          (grant) =>
            grant.grantKind === "monthly" &&
            grant.subscriptionPeriodId === input.grant.subscriptionPeriodId,
        )
      : undefined;
  const sourceGrant =
    input.grant.sourceReference === null
      ? undefined
      : state.grants.find(
          (grant) =>
            grant.grantKind === input.grant.grantKind &&
            grant.sourceReference === input.grant.sourceReference,
        );
  const oneTimePlanGrant =
    input.grant.grantKind === "one-time"
      ? state.grants.find(
          (grant) =>
            grant.grantKind === "one-time" &&
            grant.sourcePlanVersionId === input.grant.sourcePlanVersionId &&
            grant.grantPolicyVersion === input.grant.grantPolicyVersion,
        )
      : undefined;
  if (existing !== undefined) {
    const existingEvent = state.usageEvents.find(
      (event) => event.idempotencyKey === input.grant.idempotencyKey,
    );
    if (
      grantFingerprint(existing) !== grantFingerprint(input.grant) ||
      existingEvent === undefined ||
      usageEventFingerprint(existingEvent) !==
        usageEventFingerprint(candidateEvent)
    ) {
      fail("idempotency-conflict", "The grant idempotency key was reused.");
    }
    return { replayed: true, state };
  }
  if (periodGrant !== undefined) {
    fail(
      "idempotency-conflict",
      "The subscription period already has a monthly grant.",
    );
  }
  if (sourceGrant !== undefined) {
    fail(
      "idempotency-conflict",
      "The grant source reference already has an issuance.",
    );
  }
  if (oneTimePlanGrant !== undefined) {
    fail(
      "idempotency-conflict",
      "The source plan and grant policy already have a one-time issuance.",
    );
  }
  assertNewUsageEventIdentity(state, candidateEvent);
  if (state.grants.some((grant) => grant.grantId === input.grant.grantId)) {
    fail("duplicate-identity", "The grant identity already exists.");
  }
  return {
    replayed: false,
    state: {
      ...state,
      grants: [...state.grants, acceptedGrant],
      usageEvents: [...state.usageEvents, candidateEvent],
    },
  };
}

function consumedUnitsByGrant(
  state: CreditAccountStateV1,
): ReadonlyMap<string, number> {
  const consumed = new Map<string, number>();
  for (const event of state.usageEvents) {
    if (
      event.eventKind !== "settlement" &&
      !(event.eventKind === "adjustment" && event.customerCreditEffectUnits < 0)
    ) {
      continue;
    }
    for (const allocation of event.allocations) {
      const prior = consumed.get(allocation.grantId) ?? 0;
      consumed.set(
        allocation.grantId,
        checkedAdd(prior, allocation.units, "consumed credit units"),
      );
    }
  }
  return consumed;
}

function reservedUnitsByGrant(
  state: CreditAccountStateV1,
): ReadonlyMap<string, number> {
  const reserved = new Map<string, number>();
  for (const reservation of state.reservations) {
    if (reservation.status !== "active") {
      continue;
    }
    for (const allocation of reservation.allocations) {
      const prior = reserved.get(allocation.grantId) ?? 0;
      reserved.set(
        allocation.grantId,
        checkedAdd(prior, allocation.units, "reserved credit units"),
      );
    }
  }
  return reserved;
}

function grantExpirationInstant(grant: CreditGrantV1): number {
  return grant.expirationPolicy.kind === "expires-at"
    ? parseInstant(grant.expirationPolicy.expiresAt, "expiresAt")
    : Number.POSITIVE_INFINITY;
}

function grantIsEligible(grant: CreditGrantV1, at: string): boolean {
  const instant = parseInstant(at, "at");
  return (
    grant.expirationPolicy.kind !== "unresolved" &&
    parseInstant(grant.startsAt, "startsAt") <= instant &&
    instant < grantExpirationInstant(grant)
  );
}

function orderedEligibleGrants(
  state: CreditAccountStateV1,
  at: string,
): readonly CreditGrantV1[] {
  return state.grants
    .filter((grant) => grantIsEligible(grant, at))
    .sort((left, right) => {
      const leftExpiration = grantExpirationInstant(left);
      const rightExpiration = grantExpirationInstant(right);
      if (leftExpiration !== rightExpiration) {
        return leftExpiration < rightExpiration ? -1 : 1;
      }
      if (left.consumptionPriority !== right.consumptionPriority) {
        return left.consumptionPriority - right.consumptionPriority;
      }
      const startDelta =
        parseInstant(left.startsAt, "startsAt") -
        parseInstant(right.startsAt, "startsAt");
      return startDelta !== 0
        ? startDelta
        : compareStableIdentifiers(left.grantId, right.grantId);
    });
}

function allocateAvailableCredits(
  state: CreditAccountStateV1,
  units: number,
  at: string,
): readonly CreditAllocationV1[] {
  assertSafePositiveInteger(units, "credit units");
  const consumed = consumedUnitsByGrant(state);
  const reserved = reservedUnitsByGrant(state);
  const allocations: CreditAllocationV1[] = [];
  let remaining = units;
  for (const grant of orderedEligibleGrants(state, at)) {
    const available = Math.max(
      0,
      grant.totalUnits -
        (consumed.get(grant.grantId) ?? 0) -
        (reserved.get(grant.grantId) ?? 0),
    );
    const allocated = Math.min(available, remaining);
    if (allocated > 0) {
      allocations.push({ grantId: grant.grantId, units: allocated });
      remaining -= allocated;
    }
    if (remaining === 0) {
      break;
    }
  }
  if (remaining !== 0) {
    fail("insufficient-credits", "The organization has insufficient credits.");
  }
  return allocations;
}

export interface CreditBalanceV1 {
  readonly activeGrantedCreditUnits: number;
  readonly activeReservedUnits: number;
  readonly availableUnits: number;
  readonly compensatedCreditUnits: number;
  readonly debitAdjustmentCreditUnits: number;
  readonly expiredUnusedUnits: number;
  readonly grantedUnits: number;
  readonly netAdjustmentCreditUnits: number;
  readonly settledUnits: number;
  readonly totalGrantedCreditUnits: number;
  readonly unresolvedUnits: number;
}

export function deriveCreditBalanceV1(
  state: CreditAccountStateV1,
  at: string,
): CreditBalanceV1 {
  validateCreditAccountStateV1(state);
  const consumed = consumedUnitsByGrant(state);
  const reserved = reservedUnitsByGrant(state);
  const instant = parseInstant(at, "at");
  let activeGrantedCreditUnits = 0;
  let availableUnits = 0;
  let expiredUnusedUnits = 0;
  let grantedUnits = 0;
  let unresolvedUnits = 0;
  let compensatedCreditUnits = 0;
  let debitAdjustmentCreditUnits = 0;
  let netAdjustmentCreditUnits = 0;
  for (const grant of state.grants) {
    if (parseInstant(grant.startsAt, "startsAt") > instant) {
      continue;
    }
    if (grant.grantKind !== "administrative") {
      grantedUnits = checkedAdd(
        grantedUnits,
        grant.totalUnits,
        "granted credit units",
      );
      if (
        grant.expirationPolicy.kind !== "unresolved" &&
        instant < grantExpirationInstant(grant)
      ) {
        activeGrantedCreditUnits = checkedAdd(
          activeGrantedCreditUnits,
          grant.totalUnits,
          "active granted credit units",
        );
      }
    }
    const unconsumed = Math.max(
      0,
      grant.totalUnits - (consumed.get(grant.grantId) ?? 0),
    );
    if (grant.expirationPolicy.kind === "unresolved") {
      unresolvedUnits = checkedAdd(
        unresolvedUnits,
        unconsumed,
        "unresolved credit units",
      );
    } else if (instant >= grantExpirationInstant(grant)) {
      expiredUnusedUnits = checkedAdd(
        expiredUnusedUnits,
        Math.max(0, unconsumed - (reserved.get(grant.grantId) ?? 0)),
        "expired unused credit units",
      );
    } else {
      availableUnits = checkedAdd(
        availableUnits,
        Math.max(0, unconsumed - (reserved.get(grant.grantId) ?? 0)),
        "available credit units",
      );
    }
  }
  for (const event of state.usageEvents) {
    if (event.eventKind === "adjustment") {
      netAdjustmentCreditUnits = checkedSignedAdd(
        netAdjustmentCreditUnits,
        event.customerCreditEffectUnits,
        "net adjustment credit units",
      );
      if (event.customerCreditEffectUnits > 0) {
        compensatedCreditUnits = checkedAdd(
          compensatedCreditUnits,
          event.customerCreditEffectUnits,
          "compensated credit units",
        );
      } else {
        debitAdjustmentCreditUnits = checkedAdd(
          debitAdjustmentCreditUnits,
          -event.customerCreditEffectUnits,
          "debit adjustment credit units",
        );
      }
    }
  }
  const settledUnits = state.usageEvents
    .filter((event) => event.eventKind === "settlement")
    .flatMap((event) => event.allocations)
    .reduce(
      (total, allocation) =>
        checkedAdd(total, allocation.units, "settled credit units"),
      0,
    );
  const activeReservedUnits = state.reservations
    .filter((reservation) => reservation.status === "active")
    .reduce(
      (total, reservation) =>
        checkedAdd(total, reservation.estimatedUnits, "active reserved units"),
      0,
    );
  return {
    activeGrantedCreditUnits,
    activeReservedUnits,
    availableUnits,
    compensatedCreditUnits,
    debitAdjustmentCreditUnits,
    expiredUnusedUnits,
    grantedUnits,
    netAdjustmentCreditUnits,
    settledUnits,
    totalGrantedCreditUnits: grantedUnits,
    unresolvedUnits,
  };
}

export interface ReserveCreditsInputV1 {
  readonly actingPrincipalId: string;
  readonly chargingPolicyVersion: string;
  readonly createdAt: string;
  readonly entitlementPolicyVersion: string;
  readonly estimatedUnits: number;
  readonly expiresAt: string;
  readonly feature: CommercialFeatureKey;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly ledgerEventId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly planVersionId: string;
  readonly pricingVersionId: string;
  readonly projectId: string;
  readonly providerKey: string;
  readonly recordedByActorId: string;
  readonly recordedByActorKind: "principal" | "internal-accounting";
  readonly requestId: string;
  readonly reservationId: string;
}

function reservationFingerprint(reservation: CreditReservationV1): string {
  return JSON.stringify({
    actingPrincipalId: reservation.actingPrincipalId,
    chargingPolicyVersion: reservation.chargingPolicyVersion,
    createdAt: reservation.createdAt,
    entitlementPolicyVersion: reservation.entitlementPolicyVersion,
    estimatedUnits: reservation.estimatedUnits,
    expiresAt: reservation.expiresAt,
    feature: reservation.feature,
    idempotencyKey: reservation.idempotencyKey,
    jobId: reservation.jobId,
    modelId: reservation.modelId,
    modelVersion: reservation.modelVersion,
    planVersionId: reservation.planVersionId,
    pricingVersionId: reservation.pricingVersionId,
    projectId: reservation.projectId,
    providerKey: reservation.providerKey,
    requestId: reservation.requestId,
    reservationId: reservation.reservationId,
  });
}

function makeReservationEvent(
  input: ReserveCreditsInputV1,
  allocations: readonly CreditAllocationV1[],
): UsageEventV1 {
  return {
    actingPrincipalId: input.actingPrincipalId,
    allocations,
    chargingScenario: null,
    chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    customerCreditEffectUnits: 0,
    eventId: input.ledgerEventId,
    eventKind: "reservation",
    feature: input.feature,
    grantId: null,
    idempotencyKey: input.idempotencyKey,
    jobId: input.jobId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    occurredAt: input.createdAt,
    outcome: "reserved",
    planVersionId: input.planVersionId,
    pricingVersionId: input.pricingVersionId,
    projectId: input.projectId,
    providerKey: input.providerKey,
    providerUsage: null,
    reasonCode: "credits.reserved",
    recordedByActorId: input.recordedByActorId,
    recordedByActorKind: input.recordedByActorKind,
    relatedUsageEventId: null,
    requestId: input.requestId,
    reservationId: input.reservationId,
  };
}

export function reserveCreditsV1(
  state: CreditAccountStateV1,
  input: ReserveCreditsInputV1,
): CreditTransitionResultV1 {
  validateCreditAccountStateV1(state);
  for (const [label, value] of [
    ["actingPrincipalId", input.actingPrincipalId],
    ["idempotencyKey", input.idempotencyKey],
    ["jobId", input.jobId],
    ["ledgerEventId", input.ledgerEventId],
    ["planVersionId", input.planVersionId],
    ["pricingVersionId", input.pricingVersionId],
    ["projectId", input.projectId],
    ["requestId", input.requestId],
    ["reservationId", input.reservationId],
  ] as const) {
    assertIdentifier(value, label);
  }
  validateUsageRecorder(input.recordedByActorKind, input.recordedByActorId);
  assertModelIdentifier(input.modelId, "modelId");
  assertModelIdentifier(input.modelVersion, "modelVersion");
  assertProviderKey(input.providerKey);
  if (
    input.recordedByActorKind === "principal" &&
    input.recordedByActorId !== input.actingPrincipalId
  ) {
    fail(
      "invalid-input",
      "A principal recorder must match the reservation acting principal.",
    );
  }
  if (input.entitlementPolicyVersion !== ENTITLEMENT_POLICY_VERSION) {
    fail(
      "invalid-input",
      "The reservation entitlement policy version is unsupported.",
    );
  }
  if (input.chargingPolicyVersion !== USAGE_DISPOSITION_POLICY_VERSION) {
    fail(
      "invalid-input",
      "The reservation charging policy version is unsupported.",
    );
  }
  assertSafePositiveInteger(input.estimatedUnits, "estimatedUnits");
  if (
    parseInstant(input.expiresAt, "expiresAt") <=
    parseInstant(input.createdAt, "createdAt")
  ) {
    fail("invalid-input", "The reservation expiration must follow creation.");
  }
  const candidateWithoutAllocations: CreditReservationV1 = {
    ...input,
    allocations: [],
    chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    status: "active",
    terminalAt: null,
    terminalEventId: null,
  };
  const existing = state.reservations.find(
    (reservation) =>
      reservation.idempotencyKey === input.idempotencyKey ||
      reservation.requestId === input.requestId,
  );
  if (existing !== undefined) {
    const existingEvent = state.usageEvents.find(
      (event) =>
        event.eventKind === "reservation" &&
        event.reservationId === existing.reservationId,
    );
    const candidateEvent = makeReservationEvent(input, existing.allocations);
    if (
      reservationFingerprint(existing) !==
        reservationFingerprint(candidateWithoutAllocations) ||
      existingEvent === undefined ||
      usageEventFingerprint(existingEvent) !==
        usageEventFingerprint(candidateEvent)
    ) {
      fail(
        "idempotency-conflict",
        "The reservation key or request identity was reused.",
      );
    }
    return { replayed: true, state };
  }
  if (
    state.reservations.some(
      (reservation) => reservation.reservationId === input.reservationId,
    )
  ) {
    fail("duplicate-identity", "The reservation identity already exists.");
  }
  assertNewUsageEventIdentity(state, makeReservationEvent(input, []));
  const allocations = allocateAvailableCredits(
    state,
    input.estimatedUnits,
    input.createdAt,
  );
  const reservation: CreditReservationV1 = {
    ...candidateWithoutAllocations,
    allocations,
  };
  const event = makeReservationEvent(input, allocations);
  return {
    replayed: false,
    state: {
      ...state,
      reservations: [...state.reservations, reservation],
      usageEvents: [...state.usageEvents, event],
    },
  };
}

function settledAllocations(
  reservation: CreditReservationV1,
  actualUnits: number,
): readonly CreditAllocationV1[] {
  const allocations: CreditAllocationV1[] = [];
  let remaining = actualUnits;
  for (const allocation of reservation.allocations) {
    const units = Math.min(allocation.units, remaining);
    if (units > 0) {
      allocations.push({ grantId: allocation.grantId, units });
      remaining -= units;
    }
  }
  if (remaining !== 0) {
    fail(
      "settlement-exceeds-reservation",
      "Settlement cannot exceed the accepted reservation in version 1.",
    );
  }
  return allocations;
}

function terminalReplay(
  state: CreditAccountStateV1,
  reservation: CreditReservationV1,
  expectedStatus: Exclude<CreditReservationStatus, "active">,
  candidateEvent: UsageEventV1,
): CreditTransitionResultV1 | null {
  if (reservation.status === "active") {
    assertNewUsageEventIdentity(state, candidateEvent);
    return null;
  }
  if (reservation.status !== expectedStatus) {
    return fail(
      "reservation-terminal",
      "The reservation already has a different terminal transition.",
    );
  }
  const existingByKey = state.usageEvents.find(
    (event) => event.idempotencyKey === candidateEvent.idempotencyKey,
  );
  if (
    existingByKey !== undefined &&
    reservation.terminalEventId === candidateEvent.eventId &&
    reservation.terminalAt === candidateEvent.occurredAt &&
    usageEventFingerprint(existingByKey) ===
      usageEventFingerprint(candidateEvent)
  ) {
    return { replayed: true, state };
  }
  if (existingByKey !== undefined) {
    return fail(
      "idempotency-conflict",
      "The terminal transition idempotency key was reused.",
    );
  }
  return fail(
    "reservation-terminal",
    "The terminal reservation state has no matching immutable usage event.",
  );
}

function terminalEvent(
  reservation: CreditReservationV1,
  input: CloseReservationInputV1 | SettleReservationInputV1,
  eventKind: "settlement" | "release" | "expiration" | "provider-failure",
  outcome: TechnicalUsageOutcomeV1,
  allocations: readonly CreditAllocationV1[],
  customerCreditEffectUnits: number,
  providerUsage: ProviderUsageMetricsV1 | null,
): UsageEventV1 {
  return {
    actingPrincipalId: reservation.actingPrincipalId,
    allocations,
    chargingScenario: input.chargingScenario,
    chargingPolicyVersion: reservation.chargingPolicyVersion,
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    customerCreditEffectUnits,
    eventId: input.eventId,
    eventKind,
    feature: reservation.feature,
    grantId: null,
    idempotencyKey: input.idempotencyKey,
    jobId: reservation.jobId,
    modelId: reservation.modelId,
    modelVersion: reservation.modelVersion,
    occurredAt: input.occurredAt,
    outcome,
    planVersionId: reservation.planVersionId,
    pricingVersionId: reservation.pricingVersionId,
    projectId: reservation.projectId,
    providerKey: reservation.providerKey,
    providerUsage: providerUsage === null ? null : { ...providerUsage },
    reasonCode: input.reasonCode,
    recordedByActorId: input.recordedByActorId,
    recordedByActorKind: input.recordedByActorKind,
    relatedUsageEventId: null,
    requestId: reservation.requestId,
    reservationId: reservation.reservationId,
  };
}

function replaceReservation(
  state: CreditAccountStateV1,
  updated: CreditReservationV1,
  event: UsageEventV1,
): CreditAccountStateV1 {
  return {
    ...state,
    reservations: state.reservations.map((reservation) =>
      reservation.reservationId === updated.reservationId
        ? updated
        : reservation,
    ),
    usageEvents: [...state.usageEvents, event],
  };
}

function findReservation(
  state: CreditAccountStateV1,
  reservationId: string,
): CreditReservationV1 {
  const reservation = state.reservations.find(
    (candidate) => candidate.reservationId === reservationId,
  );
  if (reservation === undefined) {
    return fail("invalid-input", "The reservation does not exist.");
  }
  return reservation;
}

function assertTerminalOccurrenceNotBeforeReservation(
  reservation: CreditReservationV1,
  occurredAt: string,
): void {
  if (
    parseInstant(occurredAt, "occurredAt") <
    parseInstant(reservation.createdAt, "createdAt")
  ) {
    fail(
      "invalid-input",
      "A reservation terminal event cannot predate reservation creation.",
    );
  }
}

export interface SettleReservationInputV1 {
  readonly actualNormalizedCreditUnits: number;
  readonly customerChargeCreditUnits: number;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly chargingScenario: ChargingPolicyScenarioV1;
  readonly pricingVersion: ProviderPricingVersionV1;
  readonly providerUsage: ProviderUsageMetricsV1;
  readonly reasonCode: string;
  readonly recordedByActorId: string;
  readonly recordedByActorKind: UsageRecorderActorKind;
  readonly reservationId: string;
}

function validateProviderUsage(usage: ProviderUsageMetricsV1): void {
  for (const [label, value] of [
    ["cachedInputTokens", usage.cachedInputTokens],
    ["estimatedProviderCostMicros", usage.estimatedProviderCostMicros],
    ["inputTokens", usage.inputTokens],
    ["latencyMilliseconds", usage.latencyMilliseconds],
    ["outputTokens", usage.outputTokens],
  ] as const) {
    assertSafeNonnegativeInteger(value, label);
  }
  if (!/^[A-Z]{3}$/.test(usage.providerCostCurrency)) {
    fail(
      "invalid-input",
      "The provider-cost currency must be a three-letter uppercase code.",
    );
  }
  assertModelIdentifier(usage.modelId, "modelId");
  assertModelIdentifier(usage.modelVersion, "modelVersion");
  assertProviderKey(usage.providerKey);
  if (usage.providerRequestId !== null) {
    assertProviderRequestIdentifier(usage.providerRequestId);
  }
}

function assertProviderUsageMatchesReservation(
  reservation: CreditReservationV1,
  usage: ProviderUsageMetricsV1,
): void {
  if (
    usage.modelId !== reservation.modelId ||
    usage.modelVersion !== reservation.modelVersion ||
    usage.providerKey !== reservation.providerKey
  ) {
    fail(
      "invalid-input",
      "Provider usage evidence must match the reservation provider and model.",
    );
  }
}

function normalizePinnedProviderEvidence(
  reservation: CreditReservationV1,
  usage: ProviderUsageMetricsV1,
  pricing: ProviderPricingVersionV1,
): NormalizedCreditUsageV1 {
  validateProviderUsage(usage);
  validatePricingVersion(pricing);
  assertProviderUsageMatchesReservation(reservation, usage);
  if (
    pricing.pricingVersionId !== reservation.pricingVersionId ||
    pricing.providerKey !== reservation.providerKey ||
    pricing.modelId !== reservation.modelId ||
    pricing.modelVersion !== reservation.modelVersion
  ) {
    fail(
      "invalid-input",
      "The immutable pricing version must match the captured reservation evidence.",
    );
  }
  const executionInstant = parseInstant(reservation.createdAt, "createdAt");
  if (
    executionInstant < parseInstant(pricing.effectiveFrom, "effectiveFrom") ||
    (pricing.effectiveUntil !== null &&
      executionInstant >=
        parseInstant(pricing.effectiveUntil, "effectiveUntil"))
  ) {
    fail(
      "invalid-input",
      "The pricing version was not effective at the reservation execution boundary.",
    );
  }
  const normalized = normalizeProviderUsageV1(pricing, {
    cachedInputTokens: usage.cachedInputTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  if (
    normalized.estimatedProviderCostMicros !==
      usage.estimatedProviderCostMicros ||
    normalized.providerCostCurrency !== usage.providerCostCurrency
  ) {
    fail(
      "invalid-input",
      "Provider cost and currency must match deterministic pricing normalization.",
    );
  }
  return normalized;
}

export function settleReservationV1(
  state: CreditAccountStateV1,
  input: SettleReservationInputV1,
): CreditTransitionResultV1 {
  validateCreditAccountStateV1(state);
  assertSafeNonnegativeInteger(
    input.actualNormalizedCreditUnits,
    "actualNormalizedCreditUnits",
  );
  assertSafeNonnegativeInteger(
    input.customerChargeCreditUnits,
    "customerChargeCreditUnits",
  );
  assertIdentifier(input.eventId, "eventId");
  assertIdentifier(input.idempotencyKey, "idempotencyKey");
  parseInstant(input.occurredAt, "occurredAt");
  assertReasonCode(input.reasonCode, "reasonCode");
  validateUsageRecorder(input.recordedByActorKind, input.recordedByActorId);
  if (input.recordedByActorKind !== "internal-accounting") {
    fail(
      "invalid-input",
      "Reservation settlement requires an internal-accounting recorder.",
    );
  }
  const disposition = decideUsageDispositionV1(input.chargingScenario);
  if (
    disposition.action !== "settle-actual" &&
    disposition.action !== "settle-and-compensate-to-estimate"
  ) {
    fail(
      "invalid-input",
      "Only chargeable or estimate-bounded outcomes may settle a reservation.",
    );
  }
  const reservation = findReservation(state, input.reservationId);
  assertTerminalOccurrenceNotBeforeReservation(reservation, input.occurredAt);
  const normalized = normalizePinnedProviderEvidence(
    reservation,
    input.providerUsage,
    input.pricingVersion,
  );
  if (input.actualNormalizedCreditUnits !== normalized.creditUnits) {
    fail(
      "invalid-input",
      "Actual normalized units must equal deterministic provider usage.",
    );
  }
  if (input.customerChargeCreditUnits > input.actualNormalizedCreditUnits) {
    fail(
      "invalid-input",
      "The customer charge cannot exceed normalized provider usage.",
    );
  }
  const expectedCustomerCharge =
    disposition.action === "settle-actual"
      ? input.actualNormalizedCreditUnits
      : Math.min(input.actualNormalizedCreditUnits, reservation.estimatedUnits);
  if (input.customerChargeCreditUnits !== expectedCustomerCharge) {
    fail(
      "invalid-input",
      "The customer charge does not match the typed charging disposition.",
    );
  }
  if (input.customerChargeCreditUnits > reservation.estimatedUnits) {
    fail(
      "settlement-exceeds-reservation",
      "The customer charge cannot exceed the accepted reservation.",
    );
  }
  const allocations = settledAllocations(
    reservation,
    input.customerChargeCreditUnits,
  );
  const event = terminalEvent(
    reservation,
    input,
    "settlement",
    technicalUsageOutcomeForChargingScenarioV1(input.chargingScenario) ??
      fail(
        "invalid-input",
        "The charging scenario does not produce a settlement outcome.",
      ),
    allocations,
    -input.customerChargeCreditUnits,
    input.providerUsage,
  );
  const replay = terminalReplay(state, reservation, "settled", event);
  if (replay !== null) {
    return replay;
  }
  const updated: CreditReservationV1 = {
    ...reservation,
    status: "settled",
    terminalAt: input.occurredAt,
    terminalEventId: input.eventId,
  };
  return {
    replayed: false,
    state: replaceReservation(state, updated, event),
  };
}

export interface CloseReservationInputV1 {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly chargingScenario: ChargingPolicyScenarioV1 | null;
  readonly pricingVersion: ProviderPricingVersionV1 | null;
  readonly providerUsage: ProviderUsageMetricsV1 | null;
  readonly reasonCode: string;
  readonly recordedByActorId: string;
  readonly recordedByActorKind: UsageRecorderActorKind;
  readonly reservationId: string;
}

function closeReservation(
  state: CreditAccountStateV1,
  input: CloseReservationInputV1,
  status: "released" | "expired",
): CreditTransitionResultV1 {
  assertIdentifier(input.eventId, "eventId");
  assertIdentifier(input.idempotencyKey, "idempotencyKey");
  parseInstant(input.occurredAt, "occurredAt");
  assertReasonCode(input.reasonCode, "reasonCode");
  validateUsageRecorder(input.recordedByActorKind, input.recordedByActorId);
  if (input.recordedByActorKind !== "internal-accounting") {
    fail(
      "invalid-input",
      "Reservation closure requires an internal-accounting recorder.",
    );
  }
  if ((input.providerUsage === null) !== (input.pricingVersion === null)) {
    fail(
      "invalid-input",
      "Provider usage and its immutable pricing version are an all-or-none evidence group.",
    );
  }
  const reservation = findReservation(state, input.reservationId);
  assertTerminalOccurrenceNotBeforeReservation(reservation, input.occurredAt);
  let eventKind: "expiration" | "release" | "provider-failure";
  if (status === "expired") {
    if (
      input.chargingScenario !== null ||
      input.providerUsage !== null ||
      input.pricingVersion !== null
    ) {
      fail(
        "invalid-input",
        "Reservation expiration cannot carry charging outcomes or provider evidence.",
      );
    }
    eventKind = "expiration";
  } else {
    if (input.chargingScenario === null) {
      fail("invalid-input", "Reservation release requires a typed outcome.");
    }
    const disposition = decideUsageDispositionV1(input.chargingScenario);
    if (
      disposition.action !== "release" ||
      disposition.customerNetCharge !== "zero"
    ) {
      fail(
        "invalid-input",
        "Only zero-charge release outcomes may release a reservation.",
      );
    }
    if (
      input.chargingScenario === "provider-failure-before-useful-output" &&
      input.providerUsage === null
    ) {
      fail(
        "invalid-input",
        "Provider-failure release requires provider usage evidence.",
      );
    }
    if (!disposition.preserveProviderUsage && input.providerUsage !== null) {
      fail(
        "invalid-input",
        "This zero-charge outcome cannot carry provider usage evidence.",
      );
    }
    if (input.providerUsage !== null && input.pricingVersion !== null) {
      normalizePinnedProviderEvidence(
        reservation,
        input.providerUsage,
        input.pricingVersion,
      );
    }
    eventKind =
      input.chargingScenario === "provider-failure-before-useful-output"
        ? "provider-failure"
        : "release";
  }
  let outcome: TechnicalUsageOutcomeV1;
  if (status === "expired") {
    outcome = "expired";
  } else {
    const chargingScenario = input.chargingScenario;
    if (chargingScenario === null) {
      fail(
        "invalid-input",
        "Reservation release requires a charging scenario.",
      );
    }
    outcome =
      technicalUsageOutcomeForChargingScenarioV1(chargingScenario) ??
      fail(
        "invalid-input",
        "The charging scenario does not produce a release outcome.",
      );
  }
  const event = terminalEvent(
    reservation,
    input,
    eventKind,
    outcome,
    reservation.allocations,
    0,
    input.providerUsage,
  );
  const replay = terminalReplay(state, reservation, status, event);
  if (replay !== null) {
    return replay;
  }
  const updated: CreditReservationV1 = {
    ...reservation,
    status,
    terminalAt: input.occurredAt,
    terminalEventId: input.eventId,
  };
  return {
    replayed: false,
    state: replaceReservation(state, updated, event),
  };
}

export function releaseReservationV1(
  state: CreditAccountStateV1,
  input: CloseReservationInputV1,
): CreditTransitionResultV1 {
  validateCreditAccountStateV1(state);
  return closeReservation(state, input, "released");
}

export function expireReservationV1(
  state: CreditAccountStateV1,
  input: CloseReservationInputV1,
): CreditTransitionResultV1 {
  validateCreditAccountStateV1(state);
  const reservation = findReservation(state, input.reservationId);
  if (
    parseInstant(input.occurredAt, "occurredAt") <
    parseInstant(reservation.expiresAt, "expiresAt")
  ) {
    fail("invalid-input", "An active reservation cannot expire early.");
  }
  return closeReservation(state, input, "expired");
}

export interface DebitAdjustmentInputV1 {
  readonly actingAdministratorId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly reasonCode: string;
  readonly recordedByActorId: string;
  readonly recordedByActorKind: UsageRecorderActorKind;
  readonly relatedUsageEventId: string;
  readonly units: number;
}

function makeDebitAdjustmentEvent(
  input: DebitAdjustmentInputV1,
  allocations: readonly CreditAllocationV1[],
): UsageEventV1 {
  return {
    actingPrincipalId: null,
    allocations,
    chargingScenario: null,
    chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    customerCreditEffectUnits: -input.units,
    eventId: input.eventId,
    eventKind: "adjustment",
    feature: null,
    grantId: null,
    idempotencyKey: input.idempotencyKey,
    jobId: null,
    modelId: null,
    modelVersion: null,
    occurredAt: input.occurredAt,
    outcome: "adjusted",
    planVersionId: null,
    pricingVersionId: null,
    projectId: null,
    providerKey: null,
    providerUsage: null,
    reasonCode: input.reasonCode,
    recordedByActorId: input.recordedByActorId,
    recordedByActorKind: input.recordedByActorKind,
    relatedUsageEventId: input.relatedUsageEventId,
    requestId: null,
    reservationId: null,
  };
}

export function applyDebitAdjustmentV1(
  state: CreditAccountStateV1,
  input: DebitAdjustmentInputV1,
): CreditTransitionResultV1 {
  validateCreditAccountStateV1(state);
  assertIdentifier(input.actingAdministratorId, "actingAdministratorId");
  validateUsageRecorder(input.recordedByActorKind, input.recordedByActorId);
  if (
    input.recordedByActorKind !== "internal-administration" ||
    input.recordedByActorId !== input.actingAdministratorId
  ) {
    fail(
      "invalid-input",
      "Debit adjustments require matching internal-administration recorder evidence.",
    );
  }
  assertIdentifier(input.eventId, "eventId");
  assertIdentifier(input.idempotencyKey, "idempotencyKey");
  assertIdentifier(input.relatedUsageEventId, "relatedUsageEventId");
  assertReasonCode(input.reasonCode, "reasonCode");
  assertSafePositiveInteger(input.units, "units");
  parseInstant(input.occurredAt, "occurredAt");
  if (
    !state.usageEvents.some(
      (event) => event.eventId === input.relatedUsageEventId,
    )
  ) {
    fail("invalid-input", "The related usage event does not exist.");
  }
  const existing = state.usageEvents.find(
    (event) => event.idempotencyKey === input.idempotencyKey,
  );
  if (existing !== undefined) {
    const candidate = makeDebitAdjustmentEvent(input, existing.allocations);
    if (usageEventFingerprint(existing) !== usageEventFingerprint(candidate)) {
      fail("idempotency-conflict", "The adjustment key was reused.");
    }
    return { replayed: true, state };
  }
  assertNewUsageEventIdentity(state, makeDebitAdjustmentEvent(input, []));
  const allocations = allocateAvailableCredits(
    state,
    input.units,
    input.occurredAt,
  );
  const event = makeDebitAdjustmentEvent(input, allocations);
  return {
    replayed: false,
    state: { ...state, usageEvents: [...state.usageEvents, event] },
  };
}

export interface ProviderPricingVersionV1 {
  readonly cachedInputTokenMicrosPerMillion: number | null;
  readonly commercialDomainVersion: number;
  readonly creditConversionDenominator: number;
  readonly creditConversionNumerator: number;
  readonly currencyCode: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly inputTokenMicrosPerMillion: number;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly outputTokenMicrosPerMillion: number;
  readonly pricingVersionId: string;
  readonly providerKey: string;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function safeBigIntToNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
    return fail(
      "invalid-input",
      `${label} exceeds the supported integer range.`,
    );
  }
  return Number(value);
}

function validatePricingVersion(pricing: ProviderPricingVersionV1): void {
  if (pricing.commercialDomainVersion !== COMMERCIAL_DOMAIN_VERSION) {
    fail("invalid-input", "The pricing version is unsupported.");
  }
  assertIdentifier(pricing.pricingVersionId, "pricingVersionId");
  assertModelIdentifier(pricing.modelId, "modelId");
  assertModelIdentifier(pricing.modelVersion, "modelVersion");
  assertProviderKey(pricing.providerKey);
  if (!/^[A-Z]{3}$/.test(pricing.currencyCode)) {
    fail(
      "invalid-input",
      "The pricing currency must be a three-letter uppercase code.",
    );
  }
  for (const [label, value] of [
    ["inputTokenMicrosPerMillion", pricing.inputTokenMicrosPerMillion],
    ["outputTokenMicrosPerMillion", pricing.outputTokenMicrosPerMillion],
  ] as const) {
    assertSafeNonnegativeInteger(value, label);
  }
  if (pricing.cachedInputTokenMicrosPerMillion !== null) {
    assertSafeNonnegativeInteger(
      pricing.cachedInputTokenMicrosPerMillion,
      "cachedInputTokenMicrosPerMillion",
    );
  }
  assertSafePositiveInteger(
    pricing.creditConversionNumerator,
    "creditConversionNumerator",
  );
  assertSafePositiveInteger(
    pricing.creditConversionDenominator,
    "creditConversionDenominator",
  );
  const effectiveFrom = parseInstant(pricing.effectiveFrom, "effectiveFrom");
  if (
    pricing.effectiveUntil !== null &&
    parseInstant(pricing.effectiveUntil, "effectiveUntil") <= effectiveFrom
  ) {
    fail("invalid-input", "The pricing effective interval is invalid.");
  }
}

export interface TokenUsageV1 {
  readonly cachedInputTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface NormalizedCreditUsageV1 {
  readonly creditUnits: number;
  readonly estimatedProviderCostMicros: number;
  readonly providerCostCurrency: string;
  readonly pricingVersionId: string;
}

export function normalizeProviderUsageV1(
  pricing: ProviderPricingVersionV1,
  usage: TokenUsageV1,
): NormalizedCreditUsageV1 {
  validatePricingVersion(pricing);
  for (const [label, value] of [
    ["cachedInputTokens", usage.cachedInputTokens],
    ["inputTokens", usage.inputTokens],
    ["outputTokens", usage.outputTokens],
  ] as const) {
    assertSafeNonnegativeInteger(value, label);
  }
  if (
    usage.cachedInputTokens > 0 &&
    pricing.cachedInputTokenMicrosPerMillion === null
  ) {
    fail(
      "invalid-input",
      "Cached-input usage requires an explicit cached-input price.",
    );
  }
  const tokenCostNumerator =
    BigInt(usage.inputTokens) * BigInt(pricing.inputTokenMicrosPerMillion) +
    BigInt(usage.outputTokens) * BigInt(pricing.outputTokenMicrosPerMillion) +
    BigInt(usage.cachedInputTokens) *
      BigInt(pricing.cachedInputTokenMicrosPerMillion ?? 0);
  const providerCost = ceilDivide(tokenCostNumerator, 1_000_000n);
  const credits =
    providerCost === 0n
      ? 0n
      : ceilDivide(
          providerCost * BigInt(pricing.creditConversionNumerator),
          BigInt(pricing.creditConversionDenominator),
        );
  return {
    creditUnits: safeBigIntToNumber(credits, "creditUnits"),
    estimatedProviderCostMicros: safeBigIntToNumber(
      providerCost,
      "estimatedProviderCostMicros",
    ),
    providerCostCurrency: pricing.currencyCode,
    pricingVersionId: pricing.pricingVersionId,
  };
}

export interface EstimatedCreditRangeV1 {
  readonly maximumCreditUnits: number;
  readonly minimumCreditUnits: number;
  readonly pricingVersionId: string;
}

export function estimateCreditRangeV1(
  pricing: ProviderPricingVersionV1,
  minimumUsage: TokenUsageV1,
  maximumUsage: TokenUsageV1,
): EstimatedCreditRangeV1 {
  const minimum = normalizeProviderUsageV1(pricing, minimumUsage);
  const maximum = normalizeProviderUsageV1(pricing, maximumUsage);
  if (minimum.creditUnits > maximum.creditUnits) {
    fail("invalid-input", "The estimated credit range is inverted.");
  }
  return {
    maximumCreditUnits: maximum.creditUnits,
    minimumCreditUnits: minimum.creditUnits,
    pricingVersionId: pricing.pricingVersionId,
  };
}

export const USAGE_OUTCOMES = [
  "request-rejected-before-invocation",
  "insufficient-credits",
  "user-cancelled-before-invocation",
  "provider-failure-before-useful-output",
  "cloudmarkup-internal-failure",
  "proposal-delivered-user-rejected",
  "user-requested-redesign",
  "automatic-retry",
  "system-required-repair",
] as const;

export const CHARGING_POLICY_SCENARIOS = USAGE_OUTCOMES;
export type ChargingPolicyScenarioV1 =
  (typeof CHARGING_POLICY_SCENARIOS)[number];
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

export const CHARGING_SCENARIO_TECHNICAL_OUTCOME_V1 = {
  "request-rejected-before-invocation": null,
  "insufficient-credits": null,
  "user-cancelled-before-invocation": "canceled",
  "provider-failure-before-useful-output": "provider-failure",
  "cloudmarkup-internal-failure": "internal-failure",
  "proposal-delivered-user-rejected": "useful-output-delivered",
  "user-requested-redesign": null,
  "automatic-retry": null,
  "system-required-repair": "useful-output-delivered",
} as const satisfies Readonly<
  Record<ChargingPolicyScenarioV1, TechnicalUsageOutcomeV1 | null>
>;

export function technicalUsageOutcomeForChargingScenarioV1(
  scenario: string,
): TechnicalUsageOutcomeV1 | null {
  if (!(CHARGING_POLICY_SCENARIOS as readonly string[]).includes(scenario)) {
    return fail("invalid-input", "The charging scenario is unsupported.");
  }
  const validatedScenario = scenario as ChargingPolicyScenarioV1;
  const outcome = CHARGING_SCENARIO_TECHNICAL_OUTCOME_V1[validatedScenario];
  return outcome;
}

export interface UsageDispositionV1 {
  readonly action:
    | "no-charge"
    | "release"
    | "settle-actual"
    | "settle-and-compensate-to-estimate"
    | "new-metered-operation"
    | "idempotent-replay";
  readonly customerNetCharge: "zero" | "actual" | "bounded-by-estimate";
  readonly policyVersion: typeof USAGE_DISPOSITION_POLICY_VERSION;
  readonly preserveProviderUsage: boolean;
}

type UsageDispositionRuleV1 = Omit<UsageDispositionV1, "policyVersion">;

export const USAGE_DISPOSITION_POLICY_V1: Readonly<
  Record<ChargingPolicyScenarioV1, UsageDispositionRuleV1>
> = {
  "request-rejected-before-invocation": {
    action: "no-charge",
    customerNetCharge: "zero",
    preserveProviderUsage: false,
  },
  "insufficient-credits": {
    action: "no-charge",
    customerNetCharge: "zero",
    preserveProviderUsage: false,
  },
  "user-cancelled-before-invocation": {
    action: "release",
    customerNetCharge: "zero",
    preserveProviderUsage: false,
  },
  "provider-failure-before-useful-output": {
    action: "release",
    customerNetCharge: "zero",
    preserveProviderUsage: true,
  },
  "cloudmarkup-internal-failure": {
    action: "release",
    customerNetCharge: "zero",
    preserveProviderUsage: true,
  },
  "proposal-delivered-user-rejected": {
    action: "settle-actual",
    customerNetCharge: "actual",
    preserveProviderUsage: true,
  },
  "user-requested-redesign": {
    action: "new-metered-operation",
    customerNetCharge: "actual",
    preserveProviderUsage: true,
  },
  "automatic-retry": {
    action: "idempotent-replay",
    customerNetCharge: "actual",
    preserveProviderUsage: true,
  },
  "system-required-repair": {
    action: "settle-and-compensate-to-estimate",
    customerNetCharge: "bounded-by-estimate",
    preserveProviderUsage: true,
  },
};

export function decideUsageDispositionV1(outcome: string): UsageDispositionV1 {
  if (!(CHARGING_POLICY_SCENARIOS as readonly string[]).includes(outcome)) {
    return fail("invalid-input", "The usage outcome is unsupported.");
  }
  const validatedOutcome = outcome as ChargingPolicyScenarioV1;
  const rule = USAGE_DISPOSITION_POLICY_V1[validatedOutcome];
  return {
    ...rule,
    policyVersion: USAGE_DISPOSITION_POLICY_VERSION,
  };
}

export interface UsageCreditTotalsV1 {
  readonly compensatedCreditUnits: number;
  readonly debitAdjustmentCreditUnits: number;
  readonly expiredReservationCreditUnits: number;
  readonly netAdjustmentCreditUnits: number;
  readonly releasedCreditUnits: number;
  readonly reservedCreditUnits: number;
  readonly settledCreditUnits: number;
}

export interface ProviderCostTotalV1 {
  readonly currency: string;
  readonly estimatedCostMicros: number;
}

export interface FeatureUsageSummaryV1 {
  readonly creditTotals: UsageCreditTotalsV1;
  readonly feature: CommercialFeatureKey;
  readonly requestCount: number;
}

export interface UsageSummaryV1 {
  readonly byFeature: readonly FeatureUsageSummaryV1[];
  readonly compensatedCreditUnits: number;
  readonly creditTotals: UsageCreditTotalsV1;
  readonly customerCompensatedEventCount: number;
  readonly eventCount: number;
  readonly expiredReservations: number;
  readonly providerFailureRequests: number;
  readonly providerReportedEventCount: number;
  readonly releasedReservations: number;
  readonly requestCount: number;
  readonly reservedRequests: number;
  readonly settledCreditUnits: number;
  readonly settledRequests: number;
}

interface MutableUsageCreditTotalsV1 {
  compensatedCreditUnits: number;
  debitAdjustmentCreditUnits: number;
  expiredReservationCreditUnits: number;
  netAdjustmentCreditUnits: number;
  releasedCreditUnits: number;
  reservedCreditUnits: number;
  settledCreditUnits: number;
}

function createUsageCreditTotals(): MutableUsageCreditTotalsV1 {
  return {
    compensatedCreditUnits: 0,
    debitAdjustmentCreditUnits: 0,
    expiredReservationCreditUnits: 0,
    netAdjustmentCreditUnits: 0,
    releasedCreditUnits: 0,
    reservedCreditUnits: 0,
    settledCreditUnits: 0,
  };
}

function usageEventAllocationUnits(event: UsageEventV1): number {
  return event.allocations.reduce(
    (total, allocation) =>
      checkedAdd(total, allocation.units, "usage event allocation units"),
    0,
  );
}

function accumulateUsageCreditTotals(
  totals: MutableUsageCreditTotalsV1,
  event: UsageEventV1,
  settlementReleasedUnits: number,
): void {
  const allocationUnits = usageEventAllocationUnits(event);
  switch (event.eventKind) {
    case "reservation":
      totals.reservedCreditUnits = checkedAdd(
        totals.reservedCreditUnits,
        allocationUnits,
        "reserved credit units",
      );
      break;
    case "settlement": {
      const settledUnits = -event.customerCreditEffectUnits;
      assertSafeNonnegativeInteger(settledUnits, "settled credit units");
      totals.settledCreditUnits = checkedAdd(
        totals.settledCreditUnits,
        settledUnits,
        "settled credit units",
      );
      if (settledUnits !== allocationUnits) {
        fail(
          "invalid-input",
          "Settlement allocations must match the customer charge.",
        );
      }
      totals.releasedCreditUnits = checkedAdd(
        totals.releasedCreditUnits,
        settlementReleasedUnits,
        "released credit units",
      );
      break;
    }
    case "release":
    case "provider-failure":
      totals.releasedCreditUnits = checkedAdd(
        totals.releasedCreditUnits,
        allocationUnits,
        "released credit units",
      );
      break;
    case "expiration":
      totals.expiredReservationCreditUnits = checkedAdd(
        totals.expiredReservationCreditUnits,
        allocationUnits,
        "expired reservation credit units",
      );
      break;
    case "adjustment":
      totals.netAdjustmentCreditUnits = checkedSignedAdd(
        totals.netAdjustmentCreditUnits,
        event.customerCreditEffectUnits,
        "net adjustment credit units",
      );
      if (event.customerCreditEffectUnits > 0) {
        totals.compensatedCreditUnits = checkedAdd(
          totals.compensatedCreditUnits,
          event.customerCreditEffectUnits,
          "compensated credit units",
        );
      } else {
        totals.debitAdjustmentCreditUnits = checkedAdd(
          totals.debitAdjustmentCreditUnits,
          -event.customerCreditEffectUnits,
          "debit adjustment credit units",
        );
      }
      break;
    case "grant":
      break;
  }
}

function partialSettlementReleasedUnits(
  state: CreditAccountStateV1,
  event: UsageEventV1,
): number {
  if (event.eventKind !== "settlement") {
    return 0;
  }
  const reservation = state.reservations.find(
    (candidate) => candidate.reservationId === event.reservationId,
  );
  if (reservation === undefined) {
    return fail(
      "invalid-input",
      "A settlement summary requires its immutable reservation evidence.",
    );
  }
  const reservedUnits = reservation.allocations.reduce(
    (total, allocation) =>
      checkedAdd(total, allocation.units, "reserved allocation units"),
    0,
  );
  const settledUnits = usageEventAllocationUnits(event);
  if (settledUnits > reservedUnits) {
    return fail(
      "invalid-input",
      "Settlement allocations cannot exceed reserved allocations.",
    );
  }
  return reservedUnits - settledUnits;
}

export function deriveProviderCostReconciliationV1(
  state: CreditAccountStateV1,
): readonly ProviderCostTotalV1[] {
  validateCreditAccountStateV1(state);
  const providerCosts = new Map<string, number>();
  for (const event of state.usageEvents) {
    if (event.providerUsage === null) {
      continue;
    }
    const currency = event.providerUsage.providerCostCurrency;
    providerCosts.set(
      currency,
      checkedAdd(
        providerCosts.get(currency) ?? 0,
        event.providerUsage.estimatedProviderCostMicros,
        "provider cost micros by currency",
      ),
    );
  }
  return [...providerCosts.entries()]
    .sort(([left], [right]) => compareStableIdentifiers(left, right))
    .map(([currency, estimatedCostMicros]) => ({
      currency,
      estimatedCostMicros,
    }));
}

export function deriveUsageSummaryV1(
  state: CreditAccountStateV1,
): UsageSummaryV1 {
  validateCreditAccountStateV1(state);
  const creditTotals = createUsageCreditTotals();
  const featureTotals = new Map<
    CommercialFeatureKey,
    {
      readonly requestIds: Set<string>;
      readonly totals: MutableUsageCreditTotalsV1;
    }
  >();
  const requestIds = new Set<string>();
  let customerCompensatedEventCount = 0;
  let eventCount = 0;
  let expiredReservations = 0;
  let providerFailureRequests = 0;
  let providerReportedEventCount = 0;
  let releasedReservations = 0;
  let reservedRequests = 0;
  let settledRequests = 0;
  for (const event of state.usageEvents) {
    eventCount = checkedAdd(eventCount, 1, "usage event count");
    const settlementReleasedUnits = partialSettlementReleasedUnits(
      state,
      event,
    );
    accumulateUsageCreditTotals(creditTotals, event, settlementReleasedUnits);
    if (event.requestId !== null) {
      requestIds.add(event.requestId);
    }
    if (event.feature !== null) {
      const feature = featureTotals.get(event.feature) ?? {
        requestIds: new Set<string>(),
        totals: createUsageCreditTotals(),
      };
      accumulateUsageCreditTotals(
        feature.totals,
        event,
        settlementReleasedUnits,
      );
      if (event.requestId !== null) {
        feature.requestIds.add(event.requestId);
      }
      featureTotals.set(event.feature, feature);
    }
    if (event.providerUsage !== null) {
      providerReportedEventCount = checkedAdd(
        providerReportedEventCount,
        1,
        "provider-reported event count",
      );
    }
    if (event.eventKind === "reservation") {
      reservedRequests = checkedAdd(reservedRequests, 1, "reserved requests");
    } else if (event.eventKind === "settlement") {
      settledRequests = checkedAdd(settledRequests, 1, "settled requests");
    } else if (
      event.eventKind === "release" ||
      event.eventKind === "provider-failure"
    ) {
      releasedReservations = checkedAdd(
        releasedReservations,
        1,
        "released reservations",
      );
      if (event.eventKind === "provider-failure") {
        providerFailureRequests = checkedAdd(
          providerFailureRequests,
          1,
          "provider-failure requests",
        );
      }
    } else if (event.eventKind === "expiration") {
      expiredReservations = checkedAdd(
        expiredReservations,
        1,
        "expired reservations",
      );
    } else if (
      event.eventKind === "adjustment" &&
      event.customerCreditEffectUnits > 0
    ) {
      customerCompensatedEventCount = checkedAdd(
        customerCompensatedEventCount,
        1,
        "customer-compensated event count",
      );
    }
  }
  assertSafeNonnegativeInteger(requestIds.size, "usage request count");
  const byFeature = COMMERCIAL_FEATURE_KEYS.flatMap((feature) => {
    const summary = featureTotals.get(feature);
    return summary === undefined
      ? []
      : [
          {
            creditTotals: { ...summary.totals },
            feature,
            requestCount: summary.requestIds.size,
          },
        ];
  });
  return {
    byFeature,
    compensatedCreditUnits: creditTotals.compensatedCreditUnits,
    creditTotals: { ...creditTotals },
    customerCompensatedEventCount,
    eventCount,
    expiredReservations,
    providerFailureRequests,
    providerReportedEventCount,
    releasedReservations,
    requestCount: requestIds.size,
    reservedRequests,
    settledCreditUnits: creditTotals.settledCreditUnits,
    settledRequests,
  };
}
