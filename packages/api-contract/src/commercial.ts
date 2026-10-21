import { z } from "zod";

import {
  createDataEnvelopeSchema,
  createOpaqueIdentifierSchema,
  idempotencyKeySchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./common.js";
import {
  organizationIdSchema,
  organizationRoleV1Schema,
  principalIdSchema,
  projectIdSchema,
} from "./resources.js";

const MAX_POSTGRES_BIGINT_TEXT = "9223372036854775807";

export const ENTITLEMENT_POLICY_VERSION_V1 =
  "cloudmarkup-entitlements-v1" as const;
export const CHARGING_AND_FAILURE_POLICY_VERSION_V1 =
  "cloudmarkup-charging-and-failure-v1" as const;

const boundedTechnicalIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

export const commercialModelIdentifierV1Schema =
  boundedTechnicalIdentifierSchema;
export const commercialProviderKeyV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
export const commercialRecorderActorIdV1Schema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const commercialReasonCodeV1Schema = z
  .string()
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/);
export const commercialContractVersionV1Schema = z.literal(1);
export const entitlementPolicyVersionV1Schema = z.literal(
  ENTITLEMENT_POLICY_VERSION_V1,
);
export const chargingAndFailurePolicyVersionV1Schema = z.literal(
  CHARGING_AND_FAILURE_POLICY_VERSION_V1,
);
export const commercialPolicyVersionV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const safeIntegerSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

export const creditUnitsSchema = safeIntegerSchema.nonnegative();
export const signedCreditUnitsSchema = safeIntegerSchema;

export const monetaryMicrosSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,18})$/)
  .refine(
    (value) =>
      value.length < MAX_POSTGRES_BIGINT_TEXT.length ||
      (value.length === MAX_POSTGRES_BIGINT_TEXT.length &&
        value <= MAX_POSTGRES_BIGINT_TEXT),
    {
      message: "Monetary micros must fit in a signed 64-bit integer.",
    },
  );

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

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

export const commercialFeatureKeySchema = z.enum(COMMERCIAL_FEATURE_KEYS);
export const commercialLimitKeySchema = z.enum(COMMERCIAL_LIMIT_KEYS);
export const commercialLimitPeriodV1Schema = z.enum([
  "none",
  "subscription-period",
  "calendar-month",
  "rolling-day",
]);

export const billingAccountIdSchema = createOpaqueIdentifierSchema("billing");
export const planIdSchema = createOpaqueIdentifierSchema("plan");
export const planVersionIdSchema = createOpaqueIdentifierSchema("planver");
export const creditGrantIdSchema = createOpaqueIdentifierSchema("grant");
export const creditReservationIdSchema =
  createOpaqueIdentifierSchema("reservation");
export const usageEventIdSchema = createOpaqueIdentifierSchema("usage");
export const providerPricingVersionIdSchema =
  createOpaqueIdentifierSchema("pricing");
export const commercialRequestIdSchema =
  createOpaqueIdentifierSchema("request");
export const commercialJobIdSchema = createOpaqueIdentifierSchema("job");
export const creditAdjustmentIdSchema =
  createOpaqueIdentifierSchema("adjustment");

export const entitlementDenialReasonV1Schema = z.enum([
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
]);

export const commercialOperationKindV1Schema = z.enum([
  "read",
  "manual-edit",
  "data-export",
  "project-create",
  "member-activate",
  "expensive",
]);

const EXPENSIVE_COMMERCIAL_FEATURE_KEYS_V1 = [
  "ai-assisted-operations",
  "complete-application-generation",
  "deployment-evidence-workflows",
  "plan-evidence-workflows",
  "validation-jobs",
] as const satisfies readonly (typeof COMMERCIAL_FEATURE_KEYS)[number][];

const DATA_EXPORT_COMMERCIAL_FEATURE_KEYS_V1 = [
  "data-export",
  "zip-export",
  "diagram-export",
  "github-export",
  "terraform",
  "cloudformation",
] as const satisfies readonly (typeof COMMERCIAL_FEATURE_KEYS)[number][];

const operationMatchesFeature = (
  operationKind: z.output<typeof commercialOperationKindV1Schema>,
  feature: z.output<typeof commercialFeatureKeySchema>,
): boolean => {
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
      return (
        DATA_EXPORT_COMMERCIAL_FEATURE_KEYS_V1 as readonly string[]
      ).includes(feature);
    case "member-activate":
      return feature === "organization-roles";
    case "expensive":
      return (
        EXPENSIVE_COMMERCIAL_FEATURE_KEYS_V1 as readonly string[]
      ).includes(feature);
  }
};

const expectedLimitUnit = (
  limitKey: z.output<typeof commercialLimitKeySchema>,
) => {
  if (limitKey === "billable-seats" || limitKey === "viewers") {
    return "seats" as const;
  }
  if (limitKey === "concurrent-ai-jobs") {
    return "jobs" as const;
  }
  if (limitKey === "per-user-request-count") {
    return "requests" as const;
  }
  if (limitKey === "per-project-credit-cap") {
    return "credits" as const;
  }
  return "count" as const;
};

export const entitlementSubscriptionStateV1Schema = z.enum([
  "active",
  "inactive",
  "not-required",
]);

const expectedLimitScope = (
  limitKey: z.output<typeof commercialLimitKeySchema>,
) => {
  if (limitKey === "per-user-request-count") {
    return "member" as const;
  }
  if (limitKey === "per-project-credit-cap") {
    return "project" as const;
  }
  return "organization" as const;
};

export const evaluatedLimitV1Schema = z
  .object({
    currentUsage: creditUnitsSchema,
    limit: creditUnitsSchema,
    limitKey: commercialLimitKeySchema,
    period: commercialLimitPeriodV1Schema,
    requestedUsage: creditUnitsSchema,
    scope: z.enum(["organization", "member", "project"]),
  })
  .strict()
  .superRefine((evaluatedLimit, context) => {
    if (evaluatedLimit.scope !== expectedLimitScope(evaluatedLimit.limitKey)) {
      context.addIssue({
        code: "custom",
        message: "The evaluated limit scope must match the limit key.",
        path: ["scope"],
      });
    }
  });

const entitlementDecisionBaseV1Shape = {
  billingAccountId: billingAccountIdSchema,
  billingAccountRecordVersion: safeIntegerSchema.positive(),
  contractVersion: commercialContractVersionV1Schema,
  entitlementPolicyVersion: entitlementPolicyVersionV1Schema,
  evaluatedAt: utcTimestampSchema,
  evaluatedLimits: z.array(evaluatedLimitV1Schema).max(256),
  feature: commercialFeatureKeySchema,
  memberId: principalIdSchema.nullable(),
  operationKind: commercialOperationKindV1Schema,
  organizationId: organizationIdSchema,
  planVersionId: planVersionIdSchema,
  projectId: projectIdSchema.nullable(),
  subscriptionState: entitlementSubscriptionStateV1Schema,
  subscriptionProjectionVersion: z.number().int().positive().nullable(),
  targetRole: organizationRoleV1Schema.nullable(),
} as const;

export const entitlementDecisionV1Schema = z
  .discriminatedUnion("allowed", [
    z
      .object({
        ...entitlementDecisionBaseV1Shape,
        allowed: z.literal(true),
        denialReason: z.null(),
      })
      .strict(),
    z
      .object({
        ...entitlementDecisionBaseV1Shape,
        allowed: z.literal(false),
        denialReason: entitlementDenialReasonV1Schema,
      })
      .strict(),
  ])
  .superRefine((decision, context) => {
    if (!operationMatchesFeature(decision.operationKind, decision.feature)) {
      context.addIssue({
        code: "custom",
        message: "The commercial operation must match the evaluated feature.",
        path: ["feature"],
      });
    }

    const limitKeys = decision.evaluatedLimits.map(
      (evaluatedLimit) => evaluatedLimit.limitKey,
    );
    if (new Set(limitKeys).size !== limitKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Evaluated limit keys must be unique.",
        path: ["evaluatedLimits"],
      });
    }
    if (decision.allowed) {
      for (const [
        index,
        evaluatedLimit,
      ] of decision.evaluatedLimits.entries()) {
        if (
          BigInt(evaluatedLimit.currentUsage) +
            BigInt(evaluatedLimit.requestedUsage) >
          BigInt(evaluatedLimit.limit)
        ) {
          context.addIssue({
            code: "custom",
            message: "Allowed decisions cannot exceed an evaluated limit.",
            path: ["evaluatedLimits", index, "requestedUsage"],
          });
        }
      }
    }
    if (
      decision.evaluatedLimits.some((limit) => limit.scope === "member") &&
      decision.memberId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Member-scoped limits require member evidence.",
        path: ["memberId"],
      });
    }
    if (
      decision.evaluatedLimits.some((limit) => limit.scope === "project") &&
      decision.projectId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Project-scoped limits require project evidence.",
        path: ["projectId"],
      });
    }
    if (
      decision.operationKind === "expensive" &&
      (decision.memberId === null || decision.projectId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Expensive operations require member and project evidence.",
        path: [decision.memberId === null ? "memberId" : "projectId"],
      });
    }
    if (
      decision.operationKind === "member-activate" &&
      decision.targetRole === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Member activation requires target-role evidence.",
        path: ["targetRole"],
      });
    }
    if (
      decision.operationKind !== "member-activate" &&
      decision.targetRole !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Only member activation may carry target-role evidence.",
        path: ["targetRole"],
      });
    }
    if (
      decision.subscriptionState === "active" &&
      decision.subscriptionProjectionVersion === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Active subscription decisions require projection evidence.",
        path: ["subscriptionProjectionVersion"],
      });
    }
    if (
      decision.subscriptionState === "not-required" &&
      decision.subscriptionProjectionVersion !== null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Subscription-independent decisions cannot carry projection evidence.",
        path: ["subscriptionProjectionVersion"],
      });
    }
  });

export const estimatedCreditRangeV1Schema = z
  .object({
    contractVersion: commercialContractVersionV1Schema,
    maximumCreditUnits: creditUnitsSchema,
    minimumCreditUnits: creditUnitsSchema,
    pricingVersionId: providerPricingVersionIdSchema,
  })
  .strict()
  .refine((range) => range.minimumCreditUnits <= range.maximumCreditUnits, {
    message: "Maximum credits must not be below minimum credits.",
    path: ["maximumCreditUnits"],
  });

export const planPriceMetadataV1Schema = z
  .object({
    amountMicros: monetaryMicrosSchema,
    billingInterval: z.literal("month"),
    currency: currencyCodeSchema,
    status: z.enum(["beta-example", "proposed"]),
  })
  .strict();

export const currentPlanV1Schema = z
  .object({
    commercialStatus: z.enum(["beta-example", "proposed"]),
    displayName: z.string().trim().min(1).max(120),
    effectiveFrom: utcTimestampSchema,
    effectiveUntil: utcTimestampSchema.optional(),
    id: planIdSchema,
    key: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    price: planPriceMetadataV1Schema,
    version: z.number().int().positive(),
    versionId: planVersionIdSchema,
  })
  .strict()
  .refine(
    (plan) =>
      plan.effectiveUntil === undefined ||
      Date.parse(plan.effectiveUntil) > Date.parse(plan.effectiveFrom),
    {
      message: "Plan effective end must be after its start.",
      path: ["effectiveUntil"],
    },
  );

export const featureEntitlementV1Schema = z
  .object({
    enabled: z.boolean(),
    feature: commercialFeatureKeySchema,
    source: z.enum([
      "plan",
      "subscription",
      "promotion",
      "administrative",
      "kill-switch",
    ]),
  })
  .strict();

export const numericLimitV1Schema = z
  .object({
    key: commercialLimitKeySchema,
    maximum: creditUnitsSchema,
    period: commercialLimitPeriodV1Schema,
    scope: z.enum(["organization", "member", "project"]),
    unit: z.enum(["count", "credits", "jobs", "requests", "seats"]),
  })
  .strict()
  .superRefine((limit, context) => {
    if (limit.scope !== expectedLimitScope(limit.key)) {
      context.addIssue({
        code: "custom",
        message: "The numeric limit scope must match the limit key.",
        path: ["scope"],
      });
    }
    if (limit.unit !== expectedLimitUnit(limit.key)) {
      context.addIssue({
        code: "custom",
        message: "The numeric limit unit must match the limit key.",
        path: ["unit"],
      });
    }
  });

const projectedSubscriptionStateV1Schema = z.enum([
  "pending",
  "active",
  "past-due",
  "paused",
  "canceled",
  "incomplete",
]);

export const localSubscriptionSummaryV1Schema = z
  .discriminatedUnion("state", [
    z
      .object({
        state: z.literal("not-subscribed"),
      })
      .strict(),
    z
      .object({
        cancelAtPeriodEnd: z.boolean().optional(),
        currentPeriodEndsAt: utcTimestampSchema.optional(),
        currentPeriodStartsAt: utcTimestampSchema.optional(),
        projectionVersion: safeIntegerSchema.positive(),
        state: projectedSubscriptionStateV1Schema,
      })
      .strict(),
  ])
  .superRefine((subscription, context) => {
    if (subscription.state === "not-subscribed") {
      return;
    }
    const hasStart = subscription.currentPeriodStartsAt !== undefined;
    const hasEnd = subscription.currentPeriodEndsAt !== undefined;
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: "custom",
        message: "Subscription period start and end must be provided together.",
        path: [hasStart ? "currentPeriodEndsAt" : "currentPeriodStartsAt"],
      });
      return;
    }
    if (
      subscription.currentPeriodStartsAt !== undefined &&
      subscription.currentPeriodEndsAt !== undefined &&
      Date.parse(subscription.currentPeriodEndsAt) <=
        Date.parse(subscription.currentPeriodStartsAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Subscription period end must be after its start.",
        path: ["currentPeriodEndsAt"],
      });
    }
  });

export const currentPlanEntitlementsV1Schema = z
  .object({
    trial: z
      .object({
        id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
        expiresAt: utcTimestampSchema,
        state: z.enum(["active", "expired", "revoked"]),
      })
      .strict()
      .optional(),
    asOf: utcTimestampSchema,
    billingAccountState: z.enum(["active", "suspended", "closed"]),
    contractVersion: commercialContractVersionV1Schema,
    entitlements: z.array(featureEntitlementV1Schema).max(256),
    expensiveOperationsEnabled: z.boolean(),
    limits: z.array(numericLimitV1Schema).max(256),
    organizationId: organizationIdSchema,
    organizationState: z.enum(["active", "suspended"]),
    plan: currentPlanV1Schema,
    subscription: localSubscriptionSummaryV1Schema,
  })
  .strict()
  .superRefine((summary, context) => {
    if ((summary.plan.key === "staff-trial") !== (summary.trial !== undefined))
      context.addIssue({
        code: "custom",
        message: "Trial plans require explicit independent trial authority.",
        path: ["trial"],
      });
    if (
      summary.trial &&
      (summary.plan.key !== "staff-trial" ||
        summary.plan.id !== "plan_staff_trial" ||
        summary.plan.versionId !== "planver_staff_trial_2026_10_06_v1" ||
        summary.subscription.state !== "not-subscribed" ||
        (summary.trial.state !== "active" &&
          summary.expensiveOperationsEnabled) ||
        (summary.trial.state === "active" &&
          Date.parse(summary.trial.expiresAt) <= Date.parse(summary.asOf)))
    )
      context.addIssue({
        code: "custom",
        message:
          "Trial authority is separate from paid subscriptions and expires at its recorded boundary.",
        path: ["trial"],
      });
    if (Date.parse(summary.asOf) < Date.parse(summary.plan.effectiveFrom)) {
      context.addIssue({
        code: "custom",
        message: "The current plan must be effective as of the summary time.",
        path: ["plan", "effectiveFrom"],
      });
    }
    if (
      summary.plan.effectiveUntil !== undefined &&
      Date.parse(summary.asOf) >= Date.parse(summary.plan.effectiveUntil)
    ) {
      context.addIssue({
        code: "custom",
        message: "The current plan must not be expired as of the summary time.",
        path: ["plan", "effectiveUntil"],
      });
    }

    if (
      summary.billingAccountState !== "active" &&
      summary.expensiveOperationsEnabled
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A non-active billing account cannot enable expensive operations.",
        path: ["expensiveOperationsEnabled"],
      });
    }

    const featureKeys = summary.entitlements.map(
      (entitlement) => entitlement.feature,
    );
    if (new Set(featureKeys).size !== featureKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Feature entitlement keys must be unique.",
        path: ["entitlements"],
      });
    }
    const limitKeys = summary.limits.map(
      (limit) => `${limit.scope}:${limit.key}`,
    );
    if (new Set(limitKeys).size !== limitKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Limit keys must be unique within each scope.",
        path: ["limits"],
      });
    }
  });

export const currentPlanEntitlementsResponseV1Schema = createDataEnvelopeSchema(
  currentPlanEntitlementsV1Schema,
);

export const activeMemberCountsByRoleV1Schema = z
  .object({
    administrator: creditUnitsSchema,
    editor: creditUnitsSchema,
    owner: creditUnitsSchema,
    viewer: creditUnitsSchema,
  })
  .strict();

export const BILLABLE_SEAT_CANDIDATE_ROLES_V1 = [
  "owner",
  "administrator",
  "editor",
] as const;

export const seatUsageV1Schema = z
  .object({
    activeMembersByRole: activeMemberCountsByRoleV1Schema,
    asOf: utcTimestampSchema,
    billableCandidateRoles: z.tuple([
      z.literal(BILLABLE_SEAT_CANDIDATE_ROLES_V1[0]),
      z.literal(BILLABLE_SEAT_CANDIDATE_ROLES_V1[1]),
      z.literal(BILLABLE_SEAT_CANDIDATE_ROLES_V1[2]),
    ]),
    billableSeatLimit: creditUnitsSchema,
    billableSeatQuantity: creditUnitsSchema,
    contractVersion: commercialContractVersionV1Schema,
    includedBillableSeatQuantity: creditUnitsSchema,
    organizationId: organizationIdSchema,
    overBillableSeatLimit: z.boolean(),
    pendingInvitationQuantityExcluded: creditUnitsSchema,
    planVersionId: planVersionIdSchema,
    viewerLimit: creditUnitsSchema,
    viewerQuantity: creditUnitsSchema,
  })
  .strict()
  .superRefine((usage, context) => {
    const derivedBillableQuantity = usage.billableCandidateRoles.reduce(
      (total, role) => total + usage.activeMembersByRole[role],
      0,
    );
    if (usage.billableSeatQuantity !== derivedBillableQuantity) {
      context.addIssue({
        code: "custom",
        message: "Billable seat quantity must match active candidate roles.",
        path: ["billableSeatQuantity"],
      });
    }
    if (usage.viewerQuantity !== usage.activeMembersByRole.viewer) {
      context.addIssue({
        code: "custom",
        message: "Viewer quantity must match active viewer membership count.",
        path: ["viewerQuantity"],
      });
    }
    if (usage.includedBillableSeatQuantity > usage.billableSeatLimit) {
      context.addIssue({
        code: "custom",
        message: "Included billable seats cannot exceed the seat limit.",
        path: ["includedBillableSeatQuantity"],
      });
    }
    if (
      usage.overBillableSeatLimit !==
      usage.billableSeatQuantity > usage.billableSeatLimit
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Seat-limit status must match the reported quantity and limit.",
        path: ["overBillableSeatLimit"],
      });
    }
  });

export const seatUsageResponseV1Schema =
  createDataEnvelopeSchema(seatUsageV1Schema);

export const creditBalanceV1Schema = z
  .object({
    activeGrantedCreditUnits: creditUnitsSchema,
    asOf: utcTimestampSchema,
    availableCreditUnits: creditUnitsSchema,
    compensatedCreditUnits: creditUnitsSchema,
    contractVersion: commercialContractVersionV1Schema,
    debitAdjustmentCreditUnits: creditUnitsSchema,
    exhausted: z.boolean(),
    expiredCreditUnits: creditUnitsSchema,
    ledgerThroughEventId: usageEventIdSchema.optional(),
    netAdjustmentCreditUnits: signedCreditUnitsSchema,
    organizationId: organizationIdSchema,
    reservedCreditUnits: creditUnitsSchema,
    settledCreditUnits: creditUnitsSchema,
    totalGrantedCreditUnits: creditUnitsSchema,
    unresolvedCreditUnits: creditUnitsSchema,
  })
  .strict()
  .superRefine((balance, context) => {
    if (
      BigInt(balance.activeGrantedCreditUnits) +
        BigInt(balance.unresolvedCreditUnits) >
      BigInt(balance.totalGrantedCreditUnits)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Active and unresolved granted credits cannot exceed total granted credits.",
        path: ["unresolvedCreditUnits"],
      });
    }
    const expectedNetAdjustment =
      BigInt(balance.compensatedCreditUnits) -
      BigInt(balance.debitAdjustmentCreditUnits);
    if (BigInt(balance.netAdjustmentCreditUnits) !== expectedNetAdjustment) {
      context.addIssue({
        code: "custom",
        message:
          "Net adjustment credits must reconcile compensation and debit evidence.",
        path: ["netAdjustmentCreditUnits"],
      });
    }
    const totalFunding =
      BigInt(balance.totalGrantedCreditUnits) + expectedNetAdjustment;
    if (totalFunding < 0n) {
      context.addIssue({
        code: "custom",
        message: "Adjustments cannot create negative credit funding.",
        path: ["netAdjustmentCreditUnits"],
      });
    }
    const classifiedCredits =
      BigInt(balance.availableCreditUnits) +
      BigInt(balance.reservedCreditUnits) +
      BigInt(balance.settledCreditUnits) +
      BigInt(balance.expiredCreditUnits) +
      BigInt(balance.unresolvedCreditUnits);
    if (classifiedCredits > totalFunding) {
      context.addIssue({
        code: "custom",
        message: "Classified credit totals exceed their funding evidence.",
        path: ["totalGrantedCreditUnits"],
      });
    }
    if (balance.exhausted !== (balance.availableCreditUnits === 0)) {
      context.addIssue({
        code: "custom",
        message: "Exhaustion status must match available credits.",
        path: ["exhausted"],
      });
    }
  });

export const creditBalanceResponseV1Schema = createDataEnvelopeSchema(
  creditBalanceV1Schema,
);

export const creditGrantKindV1Schema = z.enum([
  "one-time",
  "monthly",
  "promotional",
  "purchased",
  "administrative",
]);

export const creditGrantSummaryV1Schema = z
  .object({
    adjustmentCreditUnits: signedCreditUnitsSchema,
    availableCreditUnits: creditUnitsSchema,
    consumedCreditUnits: creditUnitsSchema,
    consumptionPriority: creditUnitsSchema,
    expirationPolicy: z.enum(["fixed", "none", "undecided"]),
    expirationPolicyVersion: commercialPolicyVersionV1Schema.optional(),
    expiresAt: utcTimestampSchema.optional(),
    expiredCreditUnits: creditUnitsSchema,
    fundingCreditUnits: creditUnitsSchema,
    grantedCreditUnits: creditUnitsSchema,
    id: creditGrantIdSchema,
    kind: creditGrantKindV1Schema,
    grantPolicyVersion: commercialPolicyVersionV1Schema,
    planVersionId: planVersionIdSchema.optional(),
    reservedCreditUnits: creditUnitsSchema,
    startsAt: utcTimestampSchema,
    status: z.enum(["scheduled", "active", "exhausted", "expired"]),
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.kind === "administrative") {
      if (grant.grantedCreditUnits !== 0) {
        context.addIssue({
          code: "custom",
          message:
            "Administrative grant funding must be classified as an adjustment.",
          path: ["grantedCreditUnits"],
        });
      }
    } else if (grant.grantedCreditUnits === 0) {
      context.addIssue({
        code: "custom",
        message: "Non-administrative grants require raw issuance evidence.",
        path: ["grantedCreditUnits"],
      });
    }
    if (
      (grant.kind === "one-time" || grant.kind === "monthly") &&
      grant.planVersionId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Plan-included grants require a plan-version identity.",
        path: ["planVersionId"],
      });
    }

    const expectedFunding =
      BigInt(grant.grantedCreditUnits) + BigInt(grant.adjustmentCreditUnits);
    if (
      expectedFunding < 0n ||
      expectedFunding !== BigInt(grant.fundingCreditUnits)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Grant funding must exactly reconcile raw issuance and signed adjustments without becoming negative.",
        path: ["fundingCreditUnits"],
      });
    }

    if (
      (grant.expirationPolicy === "fixed" ||
        grant.expirationPolicy === "none") &&
      grant.expirationPolicyVersion === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "A decided expiration policy requires a policy version.",
        path: ["expirationPolicyVersion"],
      });
    }
    if (
      grant.expirationPolicy === "undecided" &&
      grant.expirationPolicyVersion !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "An undecided expiration policy cannot have a policy version.",
        path: ["expirationPolicyVersion"],
      });
    }

    const classifiedUnits =
      BigInt(grant.availableCreditUnits) +
      BigInt(grant.consumedCreditUnits) +
      BigInt(grant.expiredCreditUnits) +
      BigInt(grant.reservedCreditUnits);
    if (classifiedUnits > BigInt(grant.fundingCreditUnits)) {
      context.addIssue({
        code: "custom",
        message: "Grant credit totals cannot exceed effective funding.",
        path: ["fundingCreditUnits"],
      });
    }
    if (grant.expirationPolicy === "fixed") {
      if (grant.expiresAt === undefined) {
        context.addIssue({
          code: "custom",
          message: "A fixed expiration policy requires an expiration time.",
          path: ["expiresAt"],
        });
      } else if (Date.parse(grant.expiresAt) <= Date.parse(grant.startsAt)) {
        context.addIssue({
          code: "custom",
          message: "Grant expiration must be after its start.",
          path: ["expiresAt"],
        });
      }
    } else if (grant.expiresAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only a fixed expiration policy may carry an expiration time.",
        path: ["expiresAt"],
      });
    }
    if (grant.expirationPolicy === "undecided" && grant.kind !== "purchased") {
      context.addIssue({
        code: "custom",
        message: "Only purchased grants may have undecided expiration.",
        path: ["expirationPolicy"],
      });
    }
    if (grant.kind === "purchased" && grant.expirationPolicy === "undecided") {
      if (grant.status !== "scheduled") {
        context.addIssue({
          code: "custom",
          message:
            "Purchased grants with undecided expiration must stay scheduled.",
          path: ["status"],
        });
      }
      if (
        grant.availableCreditUnits !== 0 ||
        grant.consumedCreditUnits !== 0 ||
        grant.expiredCreditUnits !== 0 ||
        grant.reservedCreditUnits !== 0
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Purchased grants with undecided expiration cannot affect credit totals.",
          path: ["availableCreditUnits"],
        });
      }
    }
  });

export const creditGrantExpirationSummaryV1Schema = z
  .object({
    asOf: utcTimestampSchema,
    contractVersion: commercialContractVersionV1Schema,
    expiringCreditUnits: creditUnitsSchema,
    grants: z.array(creditGrantSummaryV1Schema).max(1_000),
    nextExpirationAt: utcTimestampSchema.optional(),
    organizationId: organizationIdSchema,
    windowEndsAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((summary, context) => {
    const grantIds = summary.grants.map((grant) => grant.id);
    if (new Set(grantIds).size !== grantIds.length) {
      context.addIssue({
        code: "custom",
        message: "Grant identifiers must be unique within the summary.",
        path: ["grants"],
      });
    }
    const oneTimeIdentities = summary.grants.flatMap((grant) => {
      if (grant.kind !== "one-time" || grant.planVersionId === undefined) {
        return [];
      }
      return [`${grant.planVersionId}:${grant.grantPolicyVersion}`];
    });
    if (new Set(oneTimeIdentities).size !== oneTimeIdentities.length) {
      context.addIssue({
        code: "custom",
        message:
          "One-time grants must be unique by plan version and grant policy.",
        path: ["grants"],
      });
    }

    if (Date.parse(summary.windowEndsAt) <= Date.parse(summary.asOf)) {
      context.addIssue({
        code: "custom",
        message: "Expiration window end must be after its start.",
        path: ["windowEndsAt"],
      });
    }
    if (
      summary.nextExpirationAt !== undefined &&
      (Date.parse(summary.nextExpirationAt) <= Date.parse(summary.asOf) ||
        Date.parse(summary.nextExpirationAt) > Date.parse(summary.windowEndsAt))
    ) {
      context.addIssue({
        code: "custom",
        message: "Next expiration must fall inside the summary window.",
        path: ["nextExpirationAt"],
      });
    }
    const visibleAvailableCredits = summary.grants.reduce(
      (total, grant) => total + BigInt(grant.availableCreditUnits),
      0n,
    );
    if (BigInt(summary.expiringCreditUnits) > visibleAvailableCredits) {
      context.addIssue({
        code: "custom",
        message: "Expiring credits exceed available grant evidence.",
        path: ["expiringCreditUnits"],
      });
    }
  });

export const creditGrantExpirationSummaryResponseV1Schema =
  createDataEnvelopeSchema(creditGrantExpirationSummaryV1Schema);

export const usageCreditTotalsV1Schema = z
  .object({
    compensatedCreditUnits: creditUnitsSchema,
    debitAdjustmentCreditUnits: creditUnitsSchema,
    expiredReservationCreditUnits: creditUnitsSchema,
    netAdjustmentCreditUnits: signedCreditUnitsSchema,
    releasedCreditUnits: creditUnitsSchema,
    reservedCreditUnits: creditUnitsSchema,
    settledCreditUnits: creditUnitsSchema,
  })
  .strict()
  .superRefine((totals, context) => {
    if (
      BigInt(totals.netAdjustmentCreditUnits) !==
      BigInt(totals.compensatedCreditUnits) -
        BigInt(totals.debitAdjustmentCreditUnits)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Net adjustment credits must reconcile compensation and debit evidence.",
        path: ["netAdjustmentCreditUnits"],
      });
    }
  });

export const featureUsageSummaryV1Schema = z
  .object({
    creditTotals: usageCreditTotalsV1Schema,
    feature: commercialFeatureKeySchema,
    requestCount: creditUnitsSchema,
  })
  .strict();

export const usageSummaryV1Schema = z
  .object({
    asOf: utcTimestampSchema,
    byFeature: z.array(featureUsageSummaryV1Schema).max(256),
    contractVersion: commercialContractVersionV1Schema,
    creditTotals: usageCreditTotalsV1Schema,
    customerCompensatedEventCount: creditUnitsSchema,
    eventCount: creditUnitsSchema,
    organizationId: organizationIdSchema,
    periodEndsAt: utcTimestampSchema,
    periodStartsAt: utcTimestampSchema,
    providerReportedEventCount: creditUnitsSchema,
    requestCount: creditUnitsSchema,
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      Date.parse(summary.periodEndsAt) <= Date.parse(summary.periodStartsAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Usage period end must be after its start.",
        path: ["periodEndsAt"],
      });
    }
    const featureKeys = summary.byFeature.map((entry) => entry.feature);
    if (new Set(featureKeys).size !== featureKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Usage feature keys must be unique.",
        path: ["byFeature"],
      });
    }
    if (
      summary.customerCompensatedEventCount > summary.eventCount ||
      summary.providerReportedEventCount > summary.eventCount ||
      summary.requestCount > summary.eventCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Usage sub-counts cannot exceed total events.",
        path: ["eventCount"],
      });
    }
  });

export const usageSummaryResponseV1Schema =
  createDataEnvelopeSchema(usageSummaryV1Schema);

export const providerUsageMetricsV1Schema = z
  .object({
    cachedInputTokenCount: creditUnitsSchema.optional(),
    currency: currencyCodeSchema,
    estimatedCostMicros: monetaryMicrosSchema,
    inputTokenCount: creditUnitsSchema.optional(),
    latencyMilliseconds: creditUnitsSchema.optional(),
    outputTokenCount: creditUnitsSchema.optional(),
    providerRequestId: boundedTechnicalIdentifierSchema.optional(),
  })
  .strict();

export const technicalUsageCreditEffectV1Schema = z
  .object({
    adjustmentCreditUnits: signedCreditUnitsSchema,
    compensatedCreditUnits: creditUnitsSchema,
    expiredReservationCreditUnits: creditUnitsSchema,
    grantedCreditUnits: creditUnitsSchema,
    releasedCreditUnits: creditUnitsSchema,
    reservedCreditUnits: creditUnitsSchema,
    settledCreditUnits: creditUnitsSchema,
  })
  .strict();

const technicalUsageCreditEffectKeys = [
  "adjustmentCreditUnits",
  "compensatedCreditUnits",
  "expiredReservationCreditUnits",
  "grantedCreditUnits",
  "releasedCreditUnits",
  "reservedCreditUnits",
  "settledCreditUnits",
] as const;

export const technicalUsageAllocationV1Schema = z
  .object({
    creditEffect: technicalUsageCreditEffectV1Schema,
    grantId: creditGrantIdSchema,
  })
  .strict()
  .refine(
    (allocation) =>
      technicalUsageCreditEffectKeys.some(
        (key) => allocation.creditEffect[key] !== 0,
      ),
    {
      message: "An allocation must carry a non-zero credit effect.",
      path: ["creditEffect"],
    },
  );

export const technicalUsageEventTypeV1Schema = z.enum([
  "grant",
  "reservation",
  "settlement",
  "release",
  "expiration",
  "provider-failure",
  "adjustment",
]);

export const technicalUsageOutcomeV1Schema = z.enum([
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
]);
export const COMMERCIAL_CHARGING_SCENARIOS_V1 = [
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
export const commercialChargingScenarioV1Schema = z.enum(
  COMMERCIAL_CHARGING_SCENARIOS_V1,
);
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
  Record<
    z.output<typeof commercialChargingScenarioV1Schema>,
    z.output<typeof technicalUsageOutcomeV1Schema> | null
  >
>;

export const recordedCommercialActorKindV1Schema = z.enum([
  "principal",
  "internal-accounting",
  "internal-administration",
]);

const allowedTechnicalUsageOutcomes = {
  adjustment: ["adjusted", "compensated"],
  expiration: ["expired"],
  grant: ["granted"],
  "provider-failure": ["provider-failure"],
  release: ["internal-failure", "canceled"],
  reservation: ["reserved"],
  settlement: ["useful-output-delivered"],
} as const satisfies Record<
  z.output<typeof technicalUsageEventTypeV1Schema>,
  readonly z.output<typeof technicalUsageOutcomeV1Schema>[]
>;

type TechnicalUsageCreditEffectV1 = z.output<
  typeof technicalUsageCreditEffectV1Schema
>;
type TechnicalUsageEventTypeV1 = z.output<
  typeof technicalUsageEventTypeV1Schema
>;
type TechnicalUsageOutcomeV1 = z.output<typeof technicalUsageOutcomeV1Schema>;

const chargingScenarioMatchesEventType = (
  eventType: TechnicalUsageEventTypeV1,
  chargingScenario: z.output<typeof commercialChargingScenarioV1Schema> | null,
): boolean => {
  switch (eventType) {
    case "settlement":
      return (
        chargingScenario === "proposal-delivered-user-rejected" ||
        chargingScenario === "system-required-repair"
      );
    case "release":
      return (
        chargingScenario === "user-cancelled-before-invocation" ||
        chargingScenario === "cloudmarkup-internal-failure"
      );
    case "provider-failure":
      return chargingScenario === "provider-failure-before-useful-output";
    case "grant":
    case "reservation":
    case "expiration":
    case "adjustment":
      return chargingScenario === null;
  }
};

const allowedCreditEffectKeys = (
  eventType: TechnicalUsageEventTypeV1,
  outcome: TechnicalUsageOutcomeV1,
): readonly (keyof TechnicalUsageCreditEffectV1)[] => {
  switch (eventType) {
    case "grant":
      return ["grantedCreditUnits"];
    case "reservation":
      return ["reservedCreditUnits"];
    case "settlement":
      return outcome === "useful-output-delivered"
        ? ["releasedCreditUnits", "settledCreditUnits"]
        : ["releasedCreditUnits"];
    case "release":
    case "provider-failure":
      return ["releasedCreditUnits"];
    case "expiration":
      return ["expiredReservationCreditUnits"];
    case "adjustment":
      return outcome === "compensated"
        ? ["adjustmentCreditUnits", "compensatedCreditUnits"]
        : ["adjustmentCreditUnits"];
  }
};

const creditEffectUsesOnly = (
  effect: TechnicalUsageCreditEffectV1,
  allowedKeys: readonly (keyof TechnicalUsageCreditEffectV1)[],
) =>
  technicalUsageCreditEffectKeys.every(
    (key) => allowedKeys.includes(key) || effect[key] === 0,
  );

const creditEffectMatchesEvent = (
  eventType: TechnicalUsageEventTypeV1,
  outcome: TechnicalUsageOutcomeV1,
  effect: TechnicalUsageCreditEffectV1,
) => {
  if (
    !creditEffectUsesOnly(effect, allowedCreditEffectKeys(eventType, outcome))
  ) {
    return false;
  }
  switch (eventType) {
    case "grant":
      return effect.grantedCreditUnits > 0;
    case "reservation":
      return effect.reservedCreditUnits > 0;
    case "settlement":
      return outcome === "useful-output-delivered"
        ? effect.settledCreditUnits > 0 || effect.releasedCreditUnits > 0
        : effect.releasedCreditUnits > 0;
    case "release":
    case "provider-failure":
      return effect.releasedCreditUnits > 0;
    case "expiration":
      return effect.expiredReservationCreditUnits > 0;
    case "adjustment":
      return outcome === "compensated"
        ? effect.adjustmentCreditUnits > 0 &&
            effect.compensatedCreditUnits === effect.adjustmentCreditUnits
        : effect.adjustmentCreditUnits !== 0;
  }
};

const allocationEffectMatchesEvent = (
  eventType: Exclude<TechnicalUsageEventTypeV1, "grant">,
  outcome: TechnicalUsageOutcomeV1,
  eventAdjustment: number,
  effect: TechnicalUsageCreditEffectV1,
) => {
  if (
    !creditEffectUsesOnly(effect, allowedCreditEffectKeys(eventType, outcome))
  ) {
    return false;
  }
  if (eventType !== "adjustment") {
    return true;
  }
  if (
    effect.adjustmentCreditUnits === 0 ||
    Math.sign(effect.adjustmentCreditUnits) !== Math.sign(eventAdjustment)
  ) {
    return false;
  }
  return outcome === "compensated"
    ? effect.adjustmentCreditUnits > 0 &&
        effect.compensatedCreditUnits === effect.adjustmentCreditUnits
    : effect.compensatedCreditUnits === 0;
};

export const technicalUsageDetailV1Schema = z
  .object({
    actingPrincipalId: principalIdSchema.optional(),
    allocations: z.array(technicalUsageAllocationV1Schema).max(1_000),
    chargingScenario: commercialChargingScenarioV1Schema.nullable(),
    chargingPolicyVersion: chargingAndFailurePolicyVersionV1Schema,
    contractVersion: commercialContractVersionV1Schema,
    creditEffect: technicalUsageCreditEffectV1Schema,
    entitlementPolicyVersion: entitlementPolicyVersionV1Schema.optional(),
    eventType: technicalUsageEventTypeV1Schema,
    feature: commercialFeatureKeySchema.optional(),
    grantId: creditGrantIdSchema.optional(),
    id: usageEventIdSchema,
    idempotencyFingerprint: sha256DigestSchema,
    jobId: commercialJobIdSchema.optional(),
    model: commercialModelIdentifierV1Schema.optional(),
    modelVersion: commercialModelIdentifierV1Schema.optional(),
    occurredAt: utcTimestampSchema,
    outcome: technicalUsageOutcomeV1Schema,
    planVersionId: planVersionIdSchema.optional(),
    pricingVersionId: providerPricingVersionIdSchema.optional(),
    projectId: projectIdSchema.optional(),
    provider: commercialProviderKeyV1Schema.optional(),
    providerUsage: providerUsageMetricsV1Schema.nullable().optional(),
    recordedByActorId: commercialRecorderActorIdV1Schema,
    recordedByActorKind: recordedCommercialActorKindV1Schema,
    reasonCode: commercialReasonCodeV1Schema,
    reasonDetail: z.string().trim().min(1).max(300).optional(),
    relatedEventId: usageEventIdSchema.optional(),
    requestId: commercialRequestIdSchema.optional(),
    reservationId: creditReservationIdSchema.optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (
      !chargingScenarioMatchesEventType(event.eventType, event.chargingScenario)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The charging scenario must match the terminal event type and cannot appear on non-terminal events.",
        path: ["chargingScenario"],
      });
    }

    if (event.chargingScenario !== null) {
      const expectedOutcome =
        CHARGING_SCENARIO_TECHNICAL_OUTCOME_V1[event.chargingScenario];
      if (expectedOutcome === null || expectedOutcome !== event.outcome) {
        context.addIssue({
          code: "custom",
          message:
            "The charging scenario must identify an emitted technical outcome.",
          path: ["chargingScenario"],
        });
      }
    }

    const allowedOutcomes = allowedTechnicalUsageOutcomes[event.eventType];
    if (!(allowedOutcomes as readonly string[]).includes(event.outcome)) {
      context.addIssue({
        code: "custom",
        message: "The event outcome does not match the event type.",
        path: ["outcome"],
      });
    }

    if (
      !creditEffectMatchesEvent(
        event.eventType,
        event.outcome,
        event.creditEffect,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The credit effect does not match the event type and outcome.",
        path: ["creditEffect"],
      });
    }

    const grantIds = event.allocations.map((allocation) => allocation.grantId);
    if (new Set(grantIds).size !== grantIds.length) {
      context.addIssue({
        code: "custom",
        message: "Allocation grant identifiers must be unique.",
        path: ["allocations"],
      });
    }

    if (event.eventType === "grant") {
      if (event.grantId === undefined) {
        context.addIssue({
          code: "custom",
          message: "Grant events require grant evidence.",
          path: ["grantId"],
        });
      }
      if (event.allocations.length !== 0) {
        context.addIssue({
          code: "custom",
          message: "Grant events cannot fabricate consumption allocations.",
          path: ["allocations"],
        });
      }
    } else {
      if (event.grantId !== undefined) {
        context.addIssue({
          code: "custom",
          message: "Non-grant events use scoped allocation evidence.",
          path: ["grantId"],
        });
      }
      if (event.allocations.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Ledger events require per-grant allocation evidence.",
          path: ["allocations"],
        });
      }
      for (const [index, allocation] of event.allocations.entries()) {
        if (
          !allocationEffectMatchesEvent(
            event.eventType,
            event.outcome,
            event.creditEffect.adjustmentCreditUnits,
            allocation.creditEffect,
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "The allocation effect does not match the event type and outcome.",
            path: ["allocations", index, "creditEffect"],
          });
        }
      }
      for (const effectKey of technicalUsageCreditEffectKeys) {
        const allocatedTotal = event.allocations.reduce(
          (total, allocation) =>
            total + BigInt(allocation.creditEffect[effectKey]),
          0n,
        );
        if (allocatedTotal !== BigInt(event.creditEffect[effectKey])) {
          context.addIssue({
            code: "custom",
            message: "Allocation effects must exactly reconcile to the event.",
            path: ["allocations"],
          });
          break;
        }
      }
    }

    const lifecycleEvent = [
      "reservation",
      "settlement",
      "release",
      "expiration",
      "provider-failure",
    ].includes(event.eventType);
    const lifecycleEvidence = [
      ["actingPrincipalId", event.actingPrincipalId],
      ["chargingPolicyVersion", event.chargingPolicyVersion],
      ["entitlementPolicyVersion", event.entitlementPolicyVersion],
      ["feature", event.feature],
      ["jobId", event.jobId],
      ["planVersionId", event.planVersionId],
      ["projectId", event.projectId],
      ["requestId", event.requestId],
      ["reservationId", event.reservationId],
    ] as const;
    if (lifecycleEvent) {
      for (const [field, value] of lifecycleEvidence) {
        if (value === undefined) {
          context.addIssue({
            code: "custom",
            message:
              "Reservation lifecycle events require complete execution evidence.",
            path: [field],
          });
        }
      }
    }

    const providerEvidence = [
      event.model,
      event.modelVersion,
      event.pricingVersionId,
      event.provider,
      event.providerUsage,
    ];
    const hasAnyProviderEvidence = providerEvidence.some(
      (value) => value !== undefined,
    );
    const hasCompleteProviderEvidence = providerEvidence.every(
      (value) => value !== undefined,
    );
    if (hasAnyProviderEvidence && !hasCompleteProviderEvidence) {
      context.addIssue({
        code: "custom",
        message:
          "Provider evidence must include provider, model, model version, pricing version, and usage together.",
        path: ["providerUsage"],
      });
    }
    if (lifecycleEvent && !hasCompleteProviderEvidence) {
      context.addIssue({
        code: "custom",
        message:
          "Reservation lifecycle events require complete provider evidence.",
        path: ["providerUsage"],
      });
    }
    if (!lifecycleEvent && hasAnyProviderEvidence) {
      context.addIssue({
        code: "custom",
        message:
          "Grant and adjustment events cannot fabricate provider evidence.",
        path: ["providerUsage"],
      });
    }
    if (event.eventType === "reservation" && event.providerUsage !== null) {
      context.addIssue({
        code: "custom",
        message:
          "Reservation events pin provider metadata before usage is reported.",
        path: ["providerUsage"],
      });
    }
    if (
      ["settlement", "provider-failure"].includes(event.eventType) &&
      (event.providerUsage === null || event.providerUsage === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Terminal provider events require reported provider usage.",
        path: ["providerUsage"],
      });
    }
    if (
      event.eventType === "release" &&
      event.chargingScenario === "user-cancelled-before-invocation" &&
      event.providerUsage !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Pre-invocation cancellation cannot report provider usage.",
        path: ["providerUsage"],
      });
    }

    if (event.eventType === "grant") {
      for (const [field, value] of [
        ["actingPrincipalId", event.actingPrincipalId],
        ["entitlementPolicyVersion", event.entitlementPolicyVersion],
        ["feature", event.feature],
        ["jobId", event.jobId],
        ["projectId", event.projectId],
        ["relatedEventId", event.relatedEventId],
        ["requestId", event.requestId],
        ["reservationId", event.reservationId],
      ] as const) {
        if (value !== undefined) {
          context.addIssue({
            code: "custom",
            message: "Grant events cannot fabricate operation evidence.",
            path: [field],
          });
        }
      }
    }
    if (event.eventType === "adjustment") {
      for (const [field, value] of [
        ["actingPrincipalId", event.actingPrincipalId],
        ["entitlementPolicyVersion", event.entitlementPolicyVersion],
        ["feature", event.feature],
        ["jobId", event.jobId],
        ["planVersionId", event.planVersionId],
        ["projectId", event.projectId],
        ["requestId", event.requestId],
      ] as const) {
        if (value !== undefined) {
          context.addIssue({
            code: "custom",
            message: "Adjustment events cannot fabricate operation evidence.",
            path: [field],
          });
        }
      }
      if (
        event.relatedEventId === undefined &&
        event.reservationId === undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Adjustment events require a related usage event or reservation.",
          path: ["relatedEventId"],
        });
      }
    }

    const recorderMatchesEvent =
      (event.eventType === "grant" &&
        event.recordedByActorKind === "internal-accounting") ||
      (event.eventType === "reservation" &&
        (event.recordedByActorKind === "principal" ||
          event.recordedByActorKind === "internal-accounting")) ||
      (["settlement", "release", "expiration", "provider-failure"].includes(
        event.eventType,
      ) &&
        event.recordedByActorKind === "internal-accounting") ||
      (event.eventType === "adjustment" &&
        event.recordedByActorKind === "internal-administration");
    if (!recorderMatchesEvent) {
      context.addIssue({
        code: "custom",
        message: "Recorder kind must match the trusted event boundary.",
        path: ["recordedByActorKind"],
      });
    }
    if (
      event.eventType === "reservation" &&
      event.recordedByActorKind === "principal" &&
      event.recordedByActorId !== event.actingPrincipalId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A principal reservation recorder must match the acting principal.",
        path: ["recordedByActorId"],
      });
    }

    if (
      event.recordedByActorKind === "principal" &&
      !principalIdSchema.safeParse(event.recordedByActorId).success
    ) {
      context.addIssue({
        code: "custom",
        message: "A principal recorder must use a principal identifier.",
        path: ["recordedByActorId"],
      });
    }
    if (event.relatedEventId === event.id) {
      context.addIssue({
        code: "custom",
        message: "An event cannot be related to itself.",
        path: ["relatedEventId"],
      });
    }
  });

export const technicalUsageDetailResponseV1Schema = createDataEnvelopeSchema(
  technicalUsageDetailV1Schema,
);
export const reserveCreditsWorkerInputV1Schema = z
  .object({
    chargingPolicyVersion: chargingAndFailurePolicyVersionV1Schema,
    contractVersion: commercialContractVersionV1Schema,
    entitlementPolicyVersion: entitlementPolicyVersionV1Schema,
    estimatedCreditRange: estimatedCreditRangeV1Schema,
    expiresAt: utcTimestampSchema,
    feature: commercialFeatureKeySchema,
    idempotencyKey: idempotencyKeySchema,
    jobId: commercialJobIdSchema,
    model: commercialModelIdentifierV1Schema,
    modelVersion: commercialModelIdentifierV1Schema,
    planVersionId: planVersionIdSchema,
    projectId: projectIdSchema,
    provider: commercialProviderKeyV1Schema,
    requestId: commercialRequestIdSchema,
    reservationId: creditReservationIdSchema,
    reserveCreditUnits: creditUnitsSchema.positive(),
  })
  .strict()
  .refine(
    (input) =>
      input.reserveCreditUnits >=
        input.estimatedCreditRange.minimumCreditUnits &&
      input.reserveCreditUnits <= input.estimatedCreditRange.maximumCreditUnits,
    {
      message: "Reserved credits must be within the estimated range.",
      path: ["reserveCreditUnits"],
    },
  );

export const settlementChargingScenarioV1Schema = z.enum([
  "proposal-delivered-user-rejected",
  "system-required-repair",
]);

export const releaseChargingScenarioV1Schema = z.enum([
  "user-cancelled-before-invocation",
  "provider-failure-before-useful-output",
  "cloudmarkup-internal-failure",
]);

export const settleCreditReservationWorkerInputV1Schema = z
  .object({
    actualNormalizedCreditUnits: creditUnitsSchema,
    chargingPolicyVersion: chargingAndFailurePolicyVersionV1Schema,
    chargingScenario: settlementChargingScenarioV1Schema,
    contractVersion: commercialContractVersionV1Schema,
    customerChargeCreditUnits: creditUnitsSchema,
    idempotencyKey: idempotencyKeySchema,
    model: commercialModelIdentifierV1Schema,
    modelVersion: commercialModelIdentifierV1Schema,
    pricingVersionId: providerPricingVersionIdSchema,
    provider: commercialProviderKeyV1Schema,
    providerUsage: providerUsageMetricsV1Schema,
    reasonCode: commercialReasonCodeV1Schema,
    requestId: commercialRequestIdSchema,
    reservationId: creditReservationIdSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.customerChargeCreditUnits > input.actualNormalizedCreditUnits) {
      context.addIssue({
        code: "custom",
        message: "Customer charge cannot exceed normalized usage.",
        path: ["customerChargeCreditUnits"],
      });
    }
    if (
      input.chargingScenario === "proposal-delivered-user-rejected" &&
      input.customerChargeCreditUnits !== input.actualNormalizedCreditUnits
    ) {
      context.addIssue({
        code: "custom",
        message: "Proposal delivery must settle the actual normalized usage.",
        path: ["customerChargeCreditUnits"],
      });
    }
    if (
      input.chargingScenario === "system-required-repair" &&
      input.actualNormalizedCreditUnits > 0 &&
      input.customerChargeCreditUnits === 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Estimate-bounded repair settlement must charge positive usage when actual usage is positive.",
        path: ["customerChargeCreditUnits"],
      });
    }
  });

export const releaseCreditReservationWorkerInputV1Schema = z
  .object({
    chargingPolicyVersion: chargingAndFailurePolicyVersionV1Schema,
    chargingScenario: releaseChargingScenarioV1Schema,
    contractVersion: commercialContractVersionV1Schema,
    idempotencyKey: idempotencyKeySchema,
    model: commercialModelIdentifierV1Schema.optional(),
    modelVersion: commercialModelIdentifierV1Schema.optional(),
    pricingVersionId: providerPricingVersionIdSchema.optional(),
    provider: commercialProviderKeyV1Schema.optional(),
    providerUsage: providerUsageMetricsV1Schema.optional(),
    reasonCode: commercialReasonCodeV1Schema,
    requestId: commercialRequestIdSchema,
    reservationId: creditReservationIdSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const providerEvidence = [
      input.model,
      input.modelVersion,
      input.pricingVersionId,
      input.provider,
      input.providerUsage,
    ];
    const hasAnyProviderEvidence = providerEvidence.some(
      (value) => value !== undefined,
    );
    const hasCompleteProviderEvidence = providerEvidence.every(
      (value) => value !== undefined,
    );

    if (hasAnyProviderEvidence && !hasCompleteProviderEvidence) {
      context.addIssue({
        code: "custom",
        message:
          "Provider evidence must include provider, model, model version, pricing version, and usage together.",
        path: ["providerUsage"],
      });
    }
    if (
      input.chargingScenario === "provider-failure-before-useful-output" &&
      !hasCompleteProviderEvidence
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Provider failure releases require complete provider evidence.",
        path: ["providerUsage"],
      });
    }
    if (
      input.chargingScenario === "user-cancelled-before-invocation" &&
      hasAnyProviderEvidence
    ) {
      context.addIssue({
        code: "custom",
        message: "Pre-invocation cancellation cannot carry provider evidence.",
        path: ["providerUsage"],
      });
    }
  });

export const expireCreditReservationWorkerInputV1Schema = z
  .object({
    chargingPolicyVersion: chargingAndFailurePolicyVersionV1Schema,
    contractVersion: commercialContractVersionV1Schema,
    idempotencyKey: idempotencyKeySchema,
    reservationId: creditReservationIdSchema,
  })
  .strict();

export const administrativeAdjustmentReasonV1Schema = z.enum([
  "customer-support",
  "system-defect",
  "provider-failure",
  "internal-failure",
  "reconciliation",
  "promotion-correction",
  "reviewed-other",
]);

export const administrativeCreditAdjustmentInputV1Schema = z
  .object({
    adjustmentId: creditAdjustmentIdSchema,
    contractVersion: commercialContractVersionV1Schema,
    creditDelta: signedCreditUnitsSchema.refine((value) => value !== 0, {
      message: "An administrative adjustment must not be zero.",
    }),
    idempotencyKey: idempotencyKeySchema,
    reason: administrativeAdjustmentReasonV1Schema,
    reasonDetail: z.string().trim().min(1).max(300),
    relatedReservationId: creditReservationIdSchema.optional(),
    relatedUsageEventId: usageEventIdSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.relatedReservationId !== undefined ||
      input.relatedUsageEventId !== undefined,
    {
      message:
        "An administrative adjustment requires a related reservation or usage event.",
      path: ["relatedUsageEventId"],
    },
  );

export type EntitlementDenialReasonV1 = z.output<
  typeof entitlementDenialReasonV1Schema
>;
export type EntitlementDecisionV1 = z.output<
  typeof entitlementDecisionV1Schema
>;
export type EvaluatedLimitV1 = z.output<typeof evaluatedLimitV1Schema>;
export type EstimatedCreditRangeV1 = z.output<
  typeof estimatedCreditRangeV1Schema
>;
export type CurrentPlanV1 = z.output<typeof currentPlanV1Schema>;
export type FeatureEntitlementV1 = z.output<typeof featureEntitlementV1Schema>;
export type NumericLimitV1 = z.output<typeof numericLimitV1Schema>;
export type CurrentPlanEntitlementsV1 = z.output<
  typeof currentPlanEntitlementsV1Schema
>;
export type SeatUsageV1 = z.output<typeof seatUsageV1Schema>;
export type CreditBalanceV1 = z.output<typeof creditBalanceV1Schema>;
export type CreditGrantKindV1 = z.output<typeof creditGrantKindV1Schema>;
export type CreditGrantSummaryV1 = z.output<typeof creditGrantSummaryV1Schema>;
export type CreditGrantExpirationSummaryV1 = z.output<
  typeof creditGrantExpirationSummaryV1Schema
>;
export type UsageSummaryV1 = z.output<typeof usageSummaryV1Schema>;
export type TechnicalUsageAllocationV1 = z.output<
  typeof technicalUsageAllocationV1Schema
>;
export type CommercialChargingScenarioV1 = z.output<
  typeof commercialChargingScenarioV1Schema
>;
export type TechnicalUsageDetailV1 = z.output<
  typeof technicalUsageDetailV1Schema
>;
export type ReserveCreditsWorkerInputV1 = z.output<
  typeof reserveCreditsWorkerInputV1Schema
>;
export type SettleCreditReservationWorkerInputV1 = z.output<
  typeof settleCreditReservationWorkerInputV1Schema
>;
export type ReleaseCreditReservationWorkerInputV1 = z.output<
  typeof releaseCreditReservationWorkerInputV1Schema
>;
export type ExpireCreditReservationWorkerInputV1 = z.output<
  typeof expireCreditReservationWorkerInputV1Schema
>;
export type AdministrativeCreditAdjustmentInputV1 = z.output<
  typeof administrativeCreditAdjustmentInputV1Schema
>;
