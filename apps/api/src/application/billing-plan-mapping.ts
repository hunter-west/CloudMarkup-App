import {
  BETA_CREDIT_EFFECTIVE_FROM,
  BETA_CREDIT_PRO_PLAN_ID,
  BETA_EXPORT_EFFECTIVE_FROM,
  BETA_EXPORT_PRO_PLAN_ID,
  BETA_SHARING_EFFECTIVE_FROM,
  BETA_SHARING_PLAN_IDS,
} from "@cloudmarkup/domain";

export const BILLING_PLAN_MAPPING_VERSION =
  "cloudmarkup-starter-pro-mapping-2026-08-28-v1" as const;
export const BILLING_SHARING_PLAN_MAPPING_VERSION =
  "cloudmarkup-starter-pro-sharing-mapping-2026-09-07-v2" as const;

export const BILLING_EXPORT_PLAN_MAPPING_VERSION =
  "cloudmarkup-starter-pro-export-mapping-2026-09-12-v3" as const;

export const BILLING_CREDIT_PLAN_MAPPING_VERSION =
  "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4" as const;

export type BillingPlanMappingVersion =
  | typeof BILLING_PLAN_MAPPING_VERSION
  | typeof BILLING_SHARING_PLAN_MAPPING_VERSION
  | typeof BILLING_EXPORT_PLAN_MAPPING_VERSION
  | typeof BILLING_CREDIT_PLAN_MAPPING_VERSION;
export type BillingMappedPlanKey = "starter" | "pro";

const legacyPlans = Object.freeze({
  starter: "planver_starter_2026_08_14_v1",
  pro: "planver_pro_2026_08_14_v2",
} as const);

export type BillingMappedPlanVersionId =
  | (typeof legacyPlans)[BillingMappedPlanKey]
  | (typeof BETA_SHARING_PLAN_IDS)[BillingMappedPlanKey]
  | typeof BETA_EXPORT_PRO_PLAN_ID
  | typeof BETA_CREDIT_PRO_PLAN_ID;

export function isBillingPlanMappingVersion(
  value: unknown,
): value is BillingPlanMappingVersion {
  return (
    value === BILLING_PLAN_MAPPING_VERSION ||
    value === BILLING_SHARING_PLAN_MAPPING_VERSION ||
    value === BILLING_EXPORT_PLAN_MAPPING_VERSION ||
    value === BILLING_CREDIT_PLAN_MAPPING_VERSION
  );
}

export function billingPlanKeyForVersion(
  value: unknown,
): BillingMappedPlanKey | undefined {
  if (value === legacyPlans.starter || value === BETA_SHARING_PLAN_IDS.starter)
    return "starter";
  if (
    value === legacyPlans.pro ||
    value === BETA_SHARING_PLAN_IDS.pro ||
    value === BETA_EXPORT_PRO_PLAN_ID ||
    value === BETA_CREDIT_PRO_PLAN_ID
  )
    return "pro";
  return undefined;
}

export function isBillingMappedPlanVersionId(
  value: unknown,
): value is BillingMappedPlanVersionId {
  return billingPlanKeyForVersion(value) !== undefined;
}

export function billingPlanVersionForMapping(
  version: BillingPlanMappingVersion,
  key: BillingMappedPlanKey,
): BillingMappedPlanVersionId {
  if (version === BILLING_CREDIT_PLAN_MAPPING_VERSION)
    return key === "pro"
      ? BETA_CREDIT_PRO_PLAN_ID
      : BETA_SHARING_PLAN_IDS.starter;
  if (version === BILLING_EXPORT_PLAN_MAPPING_VERSION)
    return key === "pro"
      ? BETA_EXPORT_PRO_PLAN_ID
      : BETA_SHARING_PLAN_IDS.starter;
  return version === BILLING_SHARING_PLAN_MAPPING_VERSION
    ? BETA_SHARING_PLAN_IDS[key]
    : legacyPlans[key];
}

/** Selection evidence is the current provider observation and canonical plan,
 * never an old envelope's mapping label. No price or grant policy is changed. */
interface BillingSubscriptionSelection {
  readonly configuredVersion: BillingPlanMappingVersion;
  readonly planKey: BillingMappedPlanKey;
  readonly currentPlanVersionId: string | null;
  readonly currentPeriodStart: string | null;
  readonly currentStateRead: boolean;
  readonly observedAt: string;
}

function selectLegacyOrSharingSubscriptionPlan(
  input: BillingSubscriptionSelection,
): BillingMappedPlanVersionId | null {
  if (
    !isBillingPlanMappingVersion(input.configuredVersion) ||
    (input.currentPlanVersionId !== null &&
      billingPlanKeyForVersion(input.currentPlanVersionId) === undefined)
  )
    return null;
  const alreadySharing =
    input.currentPlanVersionId === BETA_SHARING_PLAN_IDS.starter ||
    input.currentPlanVersionId === BETA_SHARING_PLAN_IDS.pro;
  if (
    !alreadySharing &&
    input.configuredVersion === BILLING_PLAN_MAPPING_VERSION
  )
    return legacyPlans[input.planKey];
  const effective = Date.parse(BETA_SHARING_EFFECTIVE_FROM);
  const observed = Date.parse(input.observedAt);
  const start =
    input.currentPeriodStart === null
      ? null
      : Date.parse(input.currentPeriodStart);
  if (
    !Number.isFinite(observed) ||
    (start !== null && (!Number.isFinite(start) || start > observed))
  )
    return null;
  if (alreadySharing) {
    if (
      !input.currentStateRead ||
      observed < effective ||
      (start !== null && start < effective)
    )
      return null;
    return BETA_SHARING_PLAN_IDS[input.planKey];
  }
  if (start === null || start < effective || observed < effective)
    return legacyPlans[input.planKey];
  return input.currentStateRead ? BETA_SHARING_PLAN_IDS[input.planKey] : null;
}

/** Old deliveries may reach a newer worker, but a newer mapping never enters an older one. */
export function supportsBillingDeliveryMapping(
  delivery: unknown,
  configured: unknown,
): boolean {
  const versions: readonly unknown[] = [
    BILLING_PLAN_MAPPING_VERSION,
    BILLING_SHARING_PLAN_MAPPING_VERSION,
    BILLING_EXPORT_PLAN_MAPPING_VERSION,
    BILLING_CREDIT_PLAN_MAPPING_VERSION,
  ];
  const deliveryIndex = versions.indexOf(delivery);
  const configuredIndex = versions.indexOf(configured);
  return deliveryIndex >= 0 && configuredIndex >= deliveryIndex;
}

function selectExportSubscriptionPlan(
  input: BillingSubscriptionSelection,
): BillingMappedPlanVersionId | null {
  if (!isBillingPlanMappingVersion(input.configuredVersion)) return null;
  const alreadyExport = input.currentPlanVersionId === BETA_EXPORT_PRO_PLAN_ID;
  if (
    !alreadyExport &&
    input.configuredVersion !== BILLING_EXPORT_PLAN_MAPPING_VERSION
  )
    return selectLegacyOrSharingSubscriptionPlan(input);
  const observed = Date.parse(input.observedAt);
  const start =
    input.currentPeriodStart === null
      ? null
      : Date.parse(input.currentPeriodStart);
  const effective = Date.parse(BETA_EXPORT_EFFECTIVE_FROM);
  if (
    !Number.isFinite(observed) ||
    (start !== null && (!Number.isFinite(start) || start > observed))
  )
    return null;
  if (alreadyExport) {
    if (
      !input.currentStateRead ||
      observed < effective ||
      (start !== null && start < effective)
    )
      return null;
    return input.planKey === "pro"
      ? BETA_EXPORT_PRO_PLAN_ID
      : BETA_SHARING_PLAN_IDS.starter;
  }
  const prior = selectLegacyOrSharingSubscriptionPlan({
    ...input,
    configuredVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
  });
  if (
    prior === null ||
    input.planKey !== "pro" ||
    start === null ||
    start < effective ||
    observed < effective
  )
    return prior;
  return input.currentStateRead ? BETA_EXPORT_PRO_PLAN_ID : null;
}

/** Allowances follow the selected immutable plan, never a newer worker's defaults. */
export function billingMonthlyCreditsForPlanVersion(
  planVersionId: BillingMappedPlanVersionId,
): 200 | 1000 | 1250 {
  if (planVersionId === BETA_CREDIT_PRO_PLAN_ID) return 1250;
  return billingPlanKeyForVersion(planVersionId) === "starter" ? 200 : 1000;
}

export function selectBillingSubscriptionPlan(
  input: BillingSubscriptionSelection,
): BillingMappedPlanVersionId | null {
  if (!isBillingPlanMappingVersion(input.configuredVersion)) return null;
  const alreadyCredit = input.currentPlanVersionId === BETA_CREDIT_PRO_PLAN_ID;
  if (
    !alreadyCredit &&
    input.configuredVersion !== BILLING_CREDIT_PLAN_MAPPING_VERSION
  )
    return selectExportSubscriptionPlan(input);
  const observed = Date.parse(input.observedAt);
  const start =
    input.currentPeriodStart === null
      ? null
      : Date.parse(input.currentPeriodStart);
  const effective = Date.parse(BETA_CREDIT_EFFECTIVE_FROM);
  if (
    !Number.isFinite(observed) ||
    (start !== null && (!Number.isFinite(start) || start > observed))
  )
    return null;
  if (alreadyCredit) {
    if (
      !input.currentStateRead ||
      observed < effective ||
      start === null ||
      start < effective
    )
      return null;
    return input.planKey === "pro"
      ? BETA_CREDIT_PRO_PLAN_ID
      : BETA_SHARING_PLAN_IDS.starter;
  }
  const prior = selectExportSubscriptionPlan({
    ...input,
    configuredVersion: BILLING_EXPORT_PLAN_MAPPING_VERSION,
  });
  if (
    prior === null ||
    input.planKey !== "pro" ||
    start === null ||
    start < effective ||
    observed < effective
  )
    return prior;
  return input.currentStateRead ? BETA_CREDIT_PRO_PLAN_ID : null;
}
