import { describe, expect, it } from "vitest";

import {
  CHARGING_AND_FAILURE_POLICY_VERSION_V1,
  COMMERCIAL_FEATURE_KEYS,
  COMMERCIAL_LIMIT_KEYS,
  ENTITLEMENT_POLICY_VERSION_V1,
  administrativeCreditAdjustmentInputV1Schema,
  creditBalanceV1Schema,
  creditGrantExpirationSummaryV1Schema,
  commercialFeatureKeySchema,
  commercialLimitKeySchema,
  currentPlanEntitlementsV1Schema,
  entitlementDecisionV1Schema,
  estimatedCreditRangeV1Schema,
  expireCreditReservationWorkerInputV1Schema,
  localSubscriptionSummaryV1Schema,
  monetaryMicrosSchema,
  numericLimitV1Schema,
  releaseCreditReservationWorkerInputV1Schema,
  reserveCreditsWorkerInputV1Schema,
  seatUsageV1Schema,
  settleCreditReservationWorkerInputV1Schema,
  technicalUsageDetailV1Schema,
  technicalUsageEventTypeV1Schema,
  usageSummaryV1Schema,
} from "./commercial.js";

const NOW = "2026-08-03T12:00:00.000Z";
const LATER = "2026-09-03T12:00:00.000Z";

const estimatedCreditRange = {
  contractVersion: 1,
  maximumCreditUnits: 40,
  minimumCreditUnits: 20,
  pricingVersionId: "pricing_beta-1",
} as const;

describe("commercial contract v1", () => {
  it("accepts only the exact canonical feature and limit vocabularies", () => {
    for (const feature of COMMERCIAL_FEATURE_KEYS) {
      expect(commercialFeatureKeySchema.safeParse(feature).success).toBe(true);
    }
    for (const limit of COMMERCIAL_LIMIT_KEYS) {
      expect(commercialLimitKeySchema.safeParse(limit).success).toBe(true);
    }
    expect(COMMERCIAL_LIMIT_KEYS).toEqual(
      expect.arrayContaining([
        "active-owners",
        "active-administrators",
        "active-editors",
      ]),
    );
    for (const period of [
      "none",
      "subscription-period",
      "calendar-month",
      "rolling-day",
    ] as const) {
      expect(
        numericLimitV1Schema.safeParse({
          key: "projects",
          maximum: 25,
          period,
          scope: "organization",
          unit: "count",
        }).success,
      ).toBe(true);
    }
    expect(
      numericLimitV1Schema.safeParse({
        key: "projects",
        maximum: 25,
        period: "month",
        scope: "organization",
        unit: "count",
      }).success,
    ).toBe(false);
    expect(
      numericLimitV1Schema.safeParse({
        key: "projects",
        maximum: 25,
        period: "none",
        scope: "project",
        unit: "count",
      }).success,
    ).toBe(false);
    expect(
      numericLimitV1Schema.safeParse({
        key: "projects",
        maximum: 25,
        period: "none",
        scope: "organization",
        unit: "seats",
      }).success,
    ).toBe(false);
    expect(
      numericLimitV1Schema.safeParse({
        key: "per-user-request-count",
        maximum: 25,
        period: "rolling-day",
        scope: "member",
        unit: "requests",
      }).success,
    ).toBe(true);
    expect(
      numericLimitV1Schema.safeParse({
        key: "per-project-credit-cap",
        maximum: 500,
        period: "subscription-period",
        scope: "project",
        unit: "count",
      }).success,
    ).toBe(false);
    expect(
      commercialFeatureKeySchema.safeParse("unknown-feature").success,
    ).toBe(false);
    expect(
      commercialFeatureKeySchema.safeParse("export.terraform").success,
    ).toBe(false);
    expect(commercialLimitKeySchema.safeParse("unknown-limit").success).toBe(
      false,
    );
    expect(commercialLimitKeySchema.safeParse("projects.maximum").success).toBe(
      false,
    );
  });

  it("represents a versioned current plan without floating-point price metadata", () => {
    const parsed = currentPlanEntitlementsV1Schema.parse({
      asOf: NOW,
      billingAccountState: "active",
      contractVersion: 1,
      entitlements: [
        {
          enabled: true,
          feature: "terraform",
          source: "plan",
        },
      ],
      expensiveOperationsEnabled: true,
      limits: [
        {
          key: "projects",
          maximum: 25,
          period: "none",
          scope: "organization",
          unit: "count",
        },
      ],
      organizationId: "org_contract-test",
      organizationState: "active",
      plan: {
        commercialStatus: "proposed",
        displayName: "Pro",
        effectiveFrom: NOW,
        id: "plan_pro",
        key: "pro",
        price: {
          amountMicros: "39000000",
          billingInterval: "month",
          currency: "USD",
          status: "proposed",
        },
        version: 1,
        versionId: "planver_pro-1",
      },
      subscription: {
        currentPeriodEndsAt: LATER,
        currentPeriodStartsAt: NOW,
        projectionVersion: 1,
        state: "active",
      },
    });

    expect(parsed.plan.price.amountMicros).toBe("39000000");
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        billingAccountState: "closed",
        expensiveOperationsEnabled: true,
      }).success,
    ).toBe(false);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        billingAccountState: "closed",
        expensiveOperationsEnabled: false,
      }).success,
    ).toBe(true);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        plan: {
          ...parsed.plan,
          price: { ...parsed.plan.price, amountMicros: 39 },
        },
      }).success,
    ).toBe(false);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        contractVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        entitlements: [...parsed.entitlements, parsed.entitlements[0]],
      }).success,
    ).toBe(false);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        limits: [...parsed.limits, parsed.limits[0]],
      }).success,
    ).toBe(false);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        plan: { ...parsed.plan, effectiveUntil: NOW },
      }).success,
    ).toBe(false);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        plan: { ...parsed.plan, effectiveFrom: LATER },
      }).success,
    ).toBe(false);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        asOf: LATER,
        plan: { ...parsed.plan, effectiveUntil: LATER },
      }).success,
    ).toBe(false);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        asOf: LATER,
        plan: { ...parsed.plan, effectiveUntil: "2026-09-04T12:00:00.000Z" },
      }).success,
    ).toBe(true);
    expect(
      currentPlanEntitlementsV1Schema.safeParse({
        ...parsed,
        subscription: {
          ...parsed.subscription,
          currentPeriodEndsAt: NOW,
        },
      }).success,
    ).toBe(false);
  });

  it("keeps projection-free organizations distinct from projected subscriptions", () => {
    expect(
      localSubscriptionSummaryV1Schema.parse({ state: "not-subscribed" }),
    ).toEqual({ state: "not-subscribed" });
    for (const projectionOnlyField of [
      { projectionVersion: 1 },
      { currentPeriodStartsAt: NOW },
      { currentPeriodEndsAt: LATER },
      { currentPeriodStartsAt: NOW, currentPeriodEndsAt: LATER },
    ]) {
      expect(
        localSubscriptionSummaryV1Schema.safeParse({
          state: "not-subscribed",
          ...projectionOnlyField,
        }).success,
      ).toBe(false);
    }

    for (const state of [
      "pending",
      "active",
      "past-due",
      "paused",
      "canceled",
      "incomplete",
    ] as const) {
      expect(
        localSubscriptionSummaryV1Schema.safeParse({
          projectionVersion: 1,
          state,
        }).success,
      ).toBe(true);
      expect(
        localSubscriptionSummaryV1Schema.safeParse({ state }).success,
      ).toBe(false);
    }

    for (const state of ["trialing", "unknown"] as const) {
      expect(
        localSubscriptionSummaryV1Schema.safeParse({
          projectionVersion: 1,
          state,
        }).success,
      ).toBe(false);
    }

    expect(
      localSubscriptionSummaryV1Schema.safeParse({
        currentPeriodStartsAt: NOW,
        projectionVersion: 1,
        state: "active",
      }).success,
    ).toBe(false);
    expect(
      localSubscriptionSummaryV1Schema.safeParse({
        currentPeriodEndsAt: LATER,
        projectionVersion: 1,
        state: "active",
      }).success,
    ).toBe(false);
    expect(
      localSubscriptionSummaryV1Schema.safeParse({
        currentPeriodEndsAt: NOW,
        currentPeriodStartsAt: NOW,
        projectionVersion: 1,
        state: "active",
      }).success,
    ).toBe(false);
    expect(
      localSubscriptionSummaryV1Schema.safeParse({
        currentPeriodEndsAt: LATER,
        currentPeriodStartsAt: NOW,
        projectionVersion: 1,
        state: "active",
      }).success,
    ).toBe(true);
    expect(
      localSubscriptionSummaryV1Schema.safeParse({
        projectionVersion: 0,
        state: "active",
      }).success,
    ).toBe(false);
  });
  it("uses safe integer credits and consistent credit totals", () => {
    expect(monetaryMicrosSchema.safeParse("0").success).toBe(true);
    expect(monetaryMicrosSchema.safeParse("9223372036854775807").success).toBe(
      true,
    );
    expect(monetaryMicrosSchema.safeParse("9223372036854775808").success).toBe(
      false,
    );
    expect(monetaryMicrosSchema.safeParse("1.5").success).toBe(false);

    const balance = creditBalanceV1Schema.parse({
      activeGrantedCreditUnits: 100,
      asOf: NOW,
      availableCreditUnits: 60,
      compensatedCreditUnits: 0,
      contractVersion: 1,
      debitAdjustmentCreditUnits: 0,
      exhausted: false,
      expiredCreditUnits: 5,
      netAdjustmentCreditUnits: 0,
      organizationId: "org_contract-test",
      reservedCreditUnits: 10,
      settledCreditUnits: 25,
      totalGrantedCreditUnits: 150,
      unresolvedCreditUnits: 50,
    });
    expect(balance.availableCreditUnits).toBe(60);
    expect(balance.unresolvedCreditUnits).toBe(50);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        availableCreditUnits: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        activeGrantedCreditUnits: 101,
      }).success,
    ).toBe(false);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        availableCreditUnits: 61,
      }).success,
    ).toBe(false);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        exhausted: true,
      }).success,
    ).toBe(false);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        availableCreditUnits: 50,
        compensatedCreditUnits: 10,
        debitAdjustmentCreditUnits: 20,
        netAdjustmentCreditUnits: -10,
      }).success,
    ).toBe(true);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        availableCreditUnits: 50,
        compensatedCreditUnits: 10,
        debitAdjustmentCreditUnits: 20,
        netAdjustmentCreditUnits: 0,
      }).success,
    ).toBe(false);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        compensatingAdjustmentCreditUnits: -10,
      }).success,
    ).toBe(false);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        netAdjustmentCreditUnits: undefined,
      }).success,
    ).toBe(false);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        activeGrantedCreditUnits: 0,
        availableCreditUnits: 0,
        compensatedCreditUnits: 0,
        debitAdjustmentCreditUnits: 100,
        exhausted: true,
        expiredCreditUnits: 0,
        netAdjustmentCreditUnits: -100,
        reservedCreditUnits: 0,
        settledCreditUnits: 0,
        totalGrantedCreditUnits: 100,
        unresolvedCreditUnits: 0,
      }).success,
    ).toBe(true);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        totalGrantedCreditUnits: 100,
        unresolvedCreditUnits: 1,
      }).success,
    ).toBe(false);
    expect(
      creditBalanceV1Schema.safeParse({
        ...balance,
        unresolvedCreditUnits: undefined,
      }).success,
    ).toBe(false);
  });
  it("keeps scoped stable denials and estimates free of provider-margin fields", () => {
    const deniedDecision = {
      allowed: false,
      billingAccountId: "billing_contract-test",
      billingAccountRecordVersion: 3,
      contractVersion: 1,
      denialReason: "insufficient_credits",
      entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION_V1,
      evaluatedAt: NOW,
      evaluatedLimits: [
        {
          currentUsage: 1,
          limit: 2,
          limitKey: "concurrent-ai-jobs",
          period: "none",
          requestedUsage: 1,
          scope: "organization",
        },
        {
          currentUsage: 5,
          limit: 100,
          limitKey: "per-user-request-count",
          period: "rolling-day",
          requestedUsage: 1,
          scope: "member",
        },
        {
          currentUsage: 20,
          limit: 100,
          limitKey: "per-project-credit-cap",
          period: "subscription-period",
          requestedUsage: 40,
          scope: "project",
        },
      ],
      feature: "ai-assisted-operations",
      memberId: "principal_contract-test",
      operationKind: "expensive",
      organizationId: "org_contract-test",
      planVersionId: "planver_pro-1",
      projectId: "project_contract-test",
      subscriptionProjectionVersion: 3,
      subscriptionState: "active",
      targetRole: null,
    } as const;
    expect(entitlementDecisionV1Schema.parse(deniedDecision).denialReason).toBe(
      "insufficient_credits",
    );
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...deniedDecision,
        denialReason: "concurrent_ai_job_limit_reached",
        evaluatedLimits: [
          {
            ...deniedDecision.evaluatedLimits[0],
            currentUsage: 2,
          },
          ...deniedDecision.evaluatedLimits.slice(1),
        ],
      }).success,
    ).toBe(true);

    const roleDecision = {
      allowed: true,
      billingAccountId: "billing_contract-test",
      billingAccountRecordVersion: 7,
      contractVersion: 1,
      denialReason: null,
      entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION_V1,
      evaluatedAt: NOW,
      evaluatedLimits: [
        {
          currentUsage: 4,
          limit: 5,
          limitKey: "active-members",
          period: "none",
          requestedUsage: 1,
          scope: "organization",
        },
        {
          currentUsage: 2,
          limit: 3,
          limitKey: "active-editors",
          period: "none",
          requestedUsage: 1,
          scope: "organization",
        },
      ],
      feature: "organization-roles",
      memberId: "principal_invited-member",
      operationKind: "member-activate",
      organizationId: "org_contract-test",
      planVersionId: "planver_team-1",
      projectId: null,
      subscriptionProjectionVersion: 7,
      subscriptionState: "active",
      targetRole: "editor",
    } as const;
    expect(entitlementDecisionV1Schema.safeParse(roleDecision).success).toBe(
      true,
    );
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        evaluatedLimits: [
          {
            ...roleDecision.evaluatedLimits[0],
            currentUsage: 5,
          },
          roleDecision.evaluatedLimits[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        evaluatedLimits: [
          {
            ...roleDecision.evaluatedLimits[0],
            period: undefined,
          },
          roleDecision.evaluatedLimits[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        evaluatedLimits: [
          {
            ...roleDecision.evaluatedLimits[0],
            period: "month",
          },
          roleDecision.evaluatedLimits[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        denialReason: "feature_not_entitled",
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        denialReason: undefined,
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        billingAccountId: "account_malformed",
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        billingAccountRecordVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        targetRole: null,
      }).success,
    ).toBe(false);

    const nonSubscribedDecision = {
      allowed: false,
      billingAccountId: "billing_contract-test",
      billingAccountRecordVersion: 9,
      contractVersion: 1,
      denialReason: "commercial_state_unavailable",
      entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION_V1,
      evaluatedAt: NOW,
      evaluatedLimits: [],
      feature: "read-existing-projects",
      memberId: null,
      operationKind: "read",
      organizationId: "org_contract-test",
      planVersionId: "planver_pro-1",
      projectId: null,
      subscriptionProjectionVersion: null,
      subscriptionState: "inactive",
      targetRole: null,
    } as const;
    expect(
      entitlementDecisionV1Schema.safeParse(nonSubscribedDecision).success,
    ).toBe(true);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...nonSubscribedDecision,
        denialReason: "subscription_inactive",
      }).success,
    ).toBe(true);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...nonSubscribedDecision,
        feature: "terraform",
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...nonSubscribedDecision,
        billingAccountId: "billing",
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...nonSubscribedDecision,
        billingAccountRecordVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...nonSubscribedDecision,
        targetRole: "viewer",
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...nonSubscribedDecision,
        subscriptionProjectionVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...nonSubscribedDecision,
        subscriptionProjectionVersion: undefined,
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...deniedDecision,
        subscriptionProjectionVersion: null,
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...nonSubscribedDecision,
        subscriptionProjectionVersion: 1,
        subscriptionState: "not-required",
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...deniedDecision,
        evaluatedLimits: [
          ...deniedDecision.evaluatedLimits,
          deniedDecision.evaluatedLimits[0],
        ],
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...deniedDecision,
        memberId: null,
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...deniedDecision,
        projectId: null,
      }).success,
    ).toBe(false);
    expect(
      entitlementDecisionV1Schema.safeParse({
        ...roleDecision,
        evaluatedLimits: [
          {
            ...roleDecision.evaluatedLimits[0],
            scope: "member",
          },
        ],
      }).success,
    ).toBe(false);
    expect(estimatedCreditRangeV1Schema.parse(estimatedCreditRange)).toEqual(
      estimatedCreditRange,
    );
    expect(
      estimatedCreditRangeV1Schema.safeParse({
        ...estimatedCreditRange,
        estimatedProviderCostMicros: "1000",
        providerMarginMicros: "500",
      }).success,
    ).toBe(false);
    expect(
      estimatedCreditRangeV1Schema.safeParse({
        ...estimatedCreditRange,
        maximumCreditUnits: 19,
      }).success,
    ).toBe(false);
  });
  it("reports internally consistent seat totals and exclusions", () => {
    const seats = seatUsageV1Schema.parse({
      activeMembersByRole: {
        administrator: 1,
        editor: 3,
        owner: 1,
        viewer: 8,
      },
      asOf: NOW,
      billableCandidateRoles: ["owner", "administrator", "editor"],
      billableSeatLimit: 5,
      billableSeatQuantity: 5,
      contractVersion: 1,
      includedBillableSeatQuantity: 5,
      organizationId: "org_contract-test",
      overBillableSeatLimit: false,
      pendingInvitationQuantityExcluded: 2,
      planVersionId: "planver_team-1",
      viewerLimit: 20,
      viewerQuantity: 8,
    });

    expect(seats.pendingInvitationQuantityExcluded).toBe(2);
    expect(
      seatUsageV1Schema.safeParse({ ...seats, billableSeatQuantity: 4 })
        .success,
    ).toBe(false);
    expect(
      seatUsageV1Schema.safeParse({ ...seats, viewerQuantity: 7 }).success,
    ).toBe(false);
    expect(
      seatUsageV1Schema.safeParse({ ...seats, overBillableSeatLimit: true })
        .success,
    ).toBe(false);
    expect(
      seatUsageV1Schema.safeParse({
        ...seats,
        billableCandidateRoles: [...seats.billableCandidateRoles, "viewer"],
        billableSeatQuantity: 13,
      }).success,
    ).toBe(false);
    expect(
      seatUsageV1Schema.safeParse({
        ...seats,
        billableCandidateRoles: ["owner", "administrator"],
        billableSeatQuantity: 2,
      }).success,
    ).toBe(false);
    expect(
      seatUsageV1Schema.safeParse({
        ...seats,
        billableCandidateRoles: ["administrator", "owner", "editor"],
      }).success,
    ).toBe(false);
    expect(
      seatUsageV1Schema.safeParse({
        ...seats,
        billableCandidateRoles: ["owner", "administrator", "editor", "viewer"],
      }).success,
    ).toBe(false);
  });

  it("preserves an undecided purchased-credit expiration policy", () => {
    const summary = creditGrantExpirationSummaryV1Schema.parse({
      asOf: NOW,
      contractVersion: 1,
      expiringCreditUnits: 0,
      grants: [
        {
          adjustmentCreditUnits: 0,
          availableCreditUnits: 0,
          consumedCreditUnits: 0,
          consumptionPriority: 10,
          expirationPolicy: "undecided",
          expiredCreditUnits: 0,
          fundingCreditUnits: 500,
          grantedCreditUnits: 500,
          id: "grant_purchased-1",
          kind: "purchased",
          reservedCreditUnits: 0,
          startsAt: NOW,
          grantPolicyVersion: "purchased-credits-v1",
          status: "scheduled",
        },
      ],
      organizationId: "org_contract-test",
      windowEndsAt: LATER,
    });

    expect(summary.grants[0]?.expirationPolicy).toBe("undecided");
    expect(summary.grants[0]?.expiresAt).toBeUndefined();
    expect(summary.grants[0]?.status).toBe("scheduled");
    expect(summary.grants[0]?.availableCreditUnits).toBe(0);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [{ ...summary.grants[0], status: "active" }],
      }).success,
    ).toBe(false);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [
          {
            ...summary.grants[0],
            expirationPolicyVersion: "purchased-expiration-v1",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [{ ...summary.grants[0], grantPolicyVersion: undefined }],
      }).success,
    ).toBe(false);

    const fixedGrant = {
      ...summary.grants[0],
      availableCreditUnits: 500,
      expirationPolicy: "fixed",
      expirationPolicyVersion: "monthly-expiration-v1",
      expiresAt: LATER,
      kind: "monthly",
      planVersionId: "planver_pro-1",
      status: "active",
    } as const;
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        expiringCreditUnits: 500,
        grants: [{ ...fixedGrant, expirationPolicyVersion: undefined }],
        nextExpirationAt: LATER,
      }).success,
    ).toBe(false);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        expiringCreditUnits: 500,
        grants: [fixedGrant],
        nextExpirationAt: LATER,
      }).success,
    ).toBe(true);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [{ ...fixedGrant, planVersionId: undefined }],
      }).success,
    ).toBe(false);

    const positivelyAdjustedGrant = {
      ...fixedGrant,
      adjustmentCreditUnits: 100,
      availableCreditUnits: 600,
      fundingCreditUnits: 600,
    } as const;
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        expiringCreditUnits: 600,
        grants: [positivelyAdjustedGrant],
        nextExpirationAt: LATER,
      }).success,
    ).toBe(true);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [
          {
            ...positivelyAdjustedGrant,
            availableCreditUnits: 601,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [
          {
            ...positivelyAdjustedGrant,
            fundingCreditUnits: 599,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        expiringCreditUnits: 400,
        grants: [
          {
            ...fixedGrant,
            adjustmentCreditUnits: -100,
            availableCreditUnits: 400,
            fundingCreditUnits: 400,
          },
        ],
        nextExpirationAt: LATER,
      }).success,
    ).toBe(true);

    const oneTimeGrant = {
      ...fixedGrant,
      id: "grant_one-time-1",
      kind: "one-time",
    } as const;
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [oneTimeGrant, { ...oneTimeGrant, id: "grant_one-time-2" }],
      }).success,
    ).toBe(false);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [fixedGrant, fixedGrant],
      }).success,
    ).toBe(false);

    const nonexpiringGrant = {
      ...fixedGrant,
      expirationPolicy: "none",
      expirationPolicyVersion: "nonexpiring-credits-v1",
      expiresAt: undefined,
      kind: "promotional",
      planVersionId: undefined,
    } as const;
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [{ ...nonexpiringGrant, expirationPolicyVersion: undefined }],
      }).success,
    ).toBe(false);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [nonexpiringGrant],
      }).success,
    ).toBe(true);

    const administrativeGrant = {
      ...nonexpiringGrant,
      adjustmentCreditUnits: 200,
      availableCreditUnits: 200,
      fundingCreditUnits: 200,
      grantedCreditUnits: 0,
      id: "grant_administrative-1",
      kind: "administrative",
    } as const;
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [administrativeGrant],
      }).success,
    ).toBe(true);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [
          {
            ...administrativeGrant,
            adjustmentCreditUnits: 0,
            grantedCreditUnits: 200,
          },
        ],
      }).success,
    ).toBe(false);

    for (const total of [
      "availableCreditUnits",
      "consumedCreditUnits",
      "expiredCreditUnits",
      "reservedCreditUnits",
    ] as const) {
      expect(
        creditGrantExpirationSummaryV1Schema.safeParse({
          ...summary,
          grants: [{ ...summary.grants[0], [total]: 1 }],
        }).success,
      ).toBe(false);
    }
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [{ ...summary.grants[0], kind: "promotional" }],
      }).success,
    ).toBe(false);
    expect(
      creditGrantExpirationSummaryV1Schema.safeParse({
        ...summary,
        grants: [{ ...summary.grants[0], grantedCreditUnits: 0 }],
      }).success,
    ).toBe(false);
    for (const requiredFundingField of [
      "adjustmentCreditUnits",
      "fundingCreditUnits",
    ] as const) {
      expect(
        creditGrantExpirationSummaryV1Schema.safeParse({
          ...summary,
          grants: [{ ...summary.grants[0], [requiredFundingField]: undefined }],
        }).success,
      ).toBe(false);
    }
  });

  it("omits caller-supplied tenant and actor authority from worker mutations", () => {
    const reserve = {
      chargingPolicyVersion: CHARGING_AND_FAILURE_POLICY_VERSION_V1,
      contractVersion: 1,
      entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION_V1,
      estimatedCreditRange,
      expiresAt: LATER,
      feature: "ai-assisted-operations",
      idempotencyKey: "commercial-request-0001",
      jobId: "job_proposal-1",
      model: "claude.example",
      modelVersion: "v1",
      planVersionId: "planver_pro-1",
      projectId: "project_contract-test",
      provider: "provider-example",
      requestId: "request_contract-test",
      reservationId: "reservation_contract-test",
      reserveCreditUnits: 40,
    } as const;
    const settle = {
      actualNormalizedCreditUnits: 31,
      chargingPolicyVersion: CHARGING_AND_FAILURE_POLICY_VERSION_V1,
      chargingScenario: "proposal-delivered-user-rejected",
      contractVersion: 1,
      customerChargeCreditUnits: 31,
      idempotencyKey: "commercial-request-0002",
      model: "claude.example",
      modelVersion: "v1",
      pricingVersionId: "pricing_beta-1",
      provider: "provider-example",
      providerUsage: {
        cachedInputTokenCount: 10,
        currency: "USD",
        estimatedCostMicros: "2500",
        inputTokenCount: 100,
        latencyMilliseconds: 500,
        outputTokenCount: 25,
        providerRequestId: "provider-request-1",
      },
      reasonCode: "useful-output-delivered",
      requestId: "request_contract-test",
      reservationId: "reservation_contract-test",
    } as const;
    const release = {
      chargingPolicyVersion: CHARGING_AND_FAILURE_POLICY_VERSION_V1,
      chargingScenario: "user-cancelled-before-invocation",
      contractVersion: 1,
      idempotencyKey: "commercial-request-0003",
      reasonCode: "canceled-before-invocation",
      requestId: "request_contract-test",
      reservationId: "reservation_contract-test",
    } as const;
    const providerFailureRelease = {
      ...release,
      chargingScenario: "provider-failure-before-useful-output",
      idempotencyKey: "commercial-request-0006",
      model: "claude.example",
      modelVersion: "v1",
      pricingVersionId: "pricing_beta-1",
      provider: "provider-example",
      providerUsage: {
        cachedInputTokenCount: 10,
        currency: "USD",
        estimatedCostMicros: "2500",
        inputTokenCount: 100,
        latencyMilliseconds: 500,
        outputTokenCount: 25,
        providerRequestId: "provider-request-1",
      },
      reasonCode: "provider-failure-before-useful-output",
    } as const;
    const expire = {
      chargingPolicyVersion: CHARGING_AND_FAILURE_POLICY_VERSION_V1,
      contractVersion: 1,
      idempotencyKey: "commercial-request-0004",
      reservationId: "reservation_contract-test",
    } as const;
    const adjustment = {
      adjustmentId: "adjustment_contract-test",
      contractVersion: 1,
      creditDelta: 25,
      idempotencyKey: "commercial-request-0005",
      reason: "system-defect",
      reasonDetail: "Reviewed repair compensation.",
      relatedUsageEventId: "usage_contract-test",
    } as const;

    const cases = [
      [reserveCreditsWorkerInputV1Schema, reserve],
      [settleCreditReservationWorkerInputV1Schema, settle],
      [releaseCreditReservationWorkerInputV1Schema, release],
      [releaseCreditReservationWorkerInputV1Schema, providerFailureRelease],
      [expireCreditReservationWorkerInputV1Schema, expire],
      [administrativeCreditAdjustmentInputV1Schema, adjustment],
    ] as const;
    for (const [schema, input] of cases) {
      expect(schema.safeParse(input).success).toBe(true);
      expect(
        schema.safeParse({
          ...input,
          actingPrincipalId: "principal_forged",
          organizationId: "org_forged",
        }).success,
      ).toBe(false);
    }

    const parsedReserve = reserveCreditsWorkerInputV1Schema.parse(reserve);
    expect(parsedReserve).toMatchObject({
      chargingPolicyVersion: CHARGING_AND_FAILURE_POLICY_VERSION_V1,
      entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION_V1,
      model: "claude.example",
      modelVersion: "v1",
      planVersionId: "planver_pro-1",
      provider: "provider-example",
    });
    expect(parsedReserve.estimatedCreditRange.pricingVersionId).toBe(
      "pricing_beta-1",
    );
    for (const evidence of [
      "chargingPolicyVersion",
      "entitlementPolicyVersion",
      "provider",
      "model",
      "modelVersion",
    ] as const) {
      expect(
        reserveCreditsWorkerInputV1Schema.safeParse({
          ...reserve,
          [evidence]: undefined,
        }).success,
      ).toBe(false);
    }
    expect(
      reserveCreditsWorkerInputV1Schema.safeParse({
        ...reserve,
        chargingPolicyVersion: "unversioned-policy",
      }).success,
    ).toBe(false);
    expect(
      reserveCreditsWorkerInputV1Schema.safeParse({
        ...reserve,
        entitlementPolicyVersion: "unversioned-policy",
      }).success,
    ).toBe(false);
    expect(
      reserveCreditsWorkerInputV1Schema.safeParse({
        ...reserve,
        modelResponse: "sensitive response",
        rawPrompt: "sensitive prompt",
      }).success,
    ).toBe(false);
    expect(
      reserveCreditsWorkerInputV1Schema.safeParse({
        ...reserve,
        estimatedCreditRange: {
          ...estimatedCreditRange,
          maximumCreditUnits: 0,
          minimumCreditUnits: 0,
        },
        reserveCreditUnits: 0,
      }).success,
    ).toBe(false);
    expect(
      settleCreditReservationWorkerInputV1Schema.safeParse({
        ...settle,
        chargingPolicyVersion: "unversioned-policy",
      }).success,
    ).toBe(false);
    expect(
      settleCreditReservationWorkerInputV1Schema.safeParse({
        ...settle,
        customerChargeCreditUnits: 32,
      }).success,
    ).toBe(false);
    expect(
      settleCreditReservationWorkerInputV1Schema.safeParse({
        ...settle,
        customerChargeCreditUnits: 20,
        chargingScenario: "system-required-repair",
      }).success,
    ).toBe(true);
    expect(
      settleCreditReservationWorkerInputV1Schema.safeParse({
        ...settle,
        customerChargeCreditUnits: 0,
        chargingScenario: "system-required-repair",
      }).success,
    ).toBe(false);
    for (const chargingScenario of [
      "provider-failure-before-useful-output",
      "cloudmarkup-internal-failure",
      "user-cancelled-before-invocation",
    ] as const) {
      expect(
        settleCreditReservationWorkerInputV1Schema.safeParse({
          ...settle,
          chargingScenario,
        }).success,
      ).toBe(false);
    }
    expect(
      settleCreditReservationWorkerInputV1Schema.safeParse({
        ...settle,
        reasonCode: undefined,
      }).success,
    ).toBe(false);
    expect(
      settleCreditReservationWorkerInputV1Schema.safeParse({
        ...settle,
        result: "useful-output-delivered",
      }).success,
    ).toBe(false);
    expect(
      settleCreditReservationWorkerInputV1Schema.safeParse({
        ...settle,
        providerUsage: {
          ...settle.providerUsage,
          cacheReadTokenCount: 10,
        },
      }).success,
    ).toBe(false);
    for (const forbiddenProviderField of [
      "rawPrompt",
      "rawResponse",
      "providerRegion",
    ] as const) {
      expect(
        settleCreditReservationWorkerInputV1Schema.safeParse({
          ...settle,
          providerUsage: {
            ...settle.providerUsage,
            [forbiddenProviderField]: "sensitive-or-unsupported",
          },
        }).success,
      ).toBe(false);
    }
    expect(
      settleCreditReservationWorkerInputV1Schema.safeParse({
        ...settle,
        providerUsage: {
          ...settle.providerUsage,
          providerRequestId: "contains spaces",
        },
      }).success,
    ).toBe(false);
    expect(
      expireCreditReservationWorkerInputV1Schema.safeParse({
        ...expire,
        expiredAt: LATER,
      }).success,
    ).toBe(false);
    expect(
      administrativeCreditAdjustmentInputV1Schema.safeParse({
        ...adjustment,
        relatedUsageEventId: undefined,
      }).success,
    ).toBe(false);
    expect(
      administrativeCreditAdjustmentInputV1Schema.safeParse({
        ...adjustment,
        relatedReservationId: "reservation_contract-test",
        relatedUsageEventId: undefined,
      }).success,
    ).toBe(true);
    expect(
      administrativeCreditAdjustmentInputV1Schema.safeParse({
        ...adjustment,
        reasonDetail: "a".repeat(300),
      }).success,
    ).toBe(true);
    expect(
      administrativeCreditAdjustmentInputV1Schema.safeParse({
        ...adjustment,
        reasonDetail: "a".repeat(301),
      }).success,
    ).toBe(false);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...providerFailureRelease,
        providerUsage: undefined,
      }).success,
    ).toBe(false);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...release,
        chargingScenario: "provider-failure-before-useful-output",
      }).success,
    ).toBe(false);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...providerFailureRelease,
        idempotencyKey: "commercial-request-0007",
        chargingScenario: "user-cancelled-before-invocation",
      }).success,
    ).toBe(false);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...release,
        chargingScenario: "cloudmarkup-internal-failure",
      }).success,
    ).toBe(true);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...providerFailureRelease,
        chargingScenario: "cloudmarkup-internal-failure",
      }).success,
    ).toBe(true);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...release,
        model: "claude.example",
      }).success,
    ).toBe(false);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...release,
        reason: "canceled-before-invocation",
      }).success,
    ).toBe(false);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...release,
        chargingScenario: undefined,
      }).success,
    ).toBe(false);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...release,
        reasonCode: undefined,
      }).success,
    ).toBe(false);
    expect(
      releaseCreditReservationWorkerInputV1Schema.safeParse({
        ...providerFailureRelease,
        modelResponse: "sensitive response",
        rawPrompt: "sensitive prompt",
      }).success,
    ).toBe(false);
  });

  it("requires immutable, fully evidenced, allocation-backed usage events", () => {
    const emptyCreditEffect = {
      adjustmentCreditUnits: 0,
      compensatedCreditUnits: 0,
      expiredReservationCreditUnits: 0,
      grantedCreditUnits: 0,
      releasedCreditUnits: 0,
      reservedCreditUnits: 0,
      settledCreditUnits: 0,
    } as const;
    const providerUsage = {
      cachedInputTokenCount: 10,
      currency: "USD",
      estimatedCostMicros: "2500",
      inputTokenCount: 100,
      latencyMilliseconds: 500,
      outputTokenCount: 25,
      providerRequestId: "provider-request-1",
    } as const;
    const eventBase = {
      chargingScenario: null,
      contractVersion: 1,
      occurredAt: NOW,
      recordedByActorId: "worker_commercial-accounting",
      recordedByActorKind: "internal-accounting",
    } as const;
    const lifecycleEvidence = {
      actingPrincipalId: "principal_contract-test",
      chargingPolicyVersion: CHARGING_AND_FAILURE_POLICY_VERSION_V1,
      entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION_V1,
      feature: "ai-assisted-operations",
      jobId: "job_contract-test",
      model: "claude.example",
      modelVersion: "v1",
      planVersionId: "planver_pro-1",
      pricingVersionId: "pricing_beta-1",
      projectId: "project_contract-test",
      provider: "provider-example",
      providerUsage: null,
      requestId: "request_contract-test",
      reservationId: "reservation_contract-test",
    } as const;
    const grantEvent = {
      ...eventBase,
      allocations: [],
      chargingPolicyVersion: CHARGING_AND_FAILURE_POLICY_VERSION_V1,
      creditEffect: { ...emptyCreditEffect, grantedCreditUnits: 500 },
      eventType: "grant",
      grantId: "grant_contract-test",
      id: "usage_grant-1",
      idempotencyFingerprint: `sha256:${"a".repeat(64)}`,
      outcome: "granted",
      planVersionId: "planver_pro-1",
      reasonCode: "monthly-plan-grant",
    } as const;
    const reservationEvent = {
      ...eventBase,
      ...lifecycleEvidence,
      allocations: [
        {
          creditEffect: { ...emptyCreditEffect, reservedCreditUnits: 40 },
          grantId: "grant_contract-test",
        },
      ],
      creditEffect: { ...emptyCreditEffect, reservedCreditUnits: 40 },
      eventType: "reservation",
      id: "usage_reservation-1",
      idempotencyFingerprint: `sha256:${"b".repeat(64)}`,
      outcome: "reserved",
      reasonCode: "expensive-operation-reserved",
    } as const;
    const settlementEvent = {
      ...eventBase,
      ...lifecycleEvidence,
      chargingScenario: "proposal-delivered-user-rejected",
      allocations: [
        {
          creditEffect: {
            ...emptyCreditEffect,
            releasedCreditUnits: 9,
            settledCreditUnits: 31,
          },
          grantId: "grant_contract-test",
        },
      ],
      creditEffect: {
        ...emptyCreditEffect,
        releasedCreditUnits: 9,
        settledCreditUnits: 31,
      },
      eventType: "settlement",
      id: "usage_settlement-1",
      idempotencyFingerprint: `sha256:${"c".repeat(64)}`,
      outcome: "useful-output-delivered",
      providerUsage,
      reasonCode: "useful-output-delivered",
    } as const;
    const zeroCostSettlementEvent = {
      ...settlementEvent,
      allocations: [
        {
          creditEffect: {
            ...emptyCreditEffect,
            releasedCreditUnits: 40,
          },
          grantId: "grant_contract-test",
        },
      ],
      creditEffect: {
        ...emptyCreditEffect,
        releasedCreditUnits: 40,
      },
      id: "usage_settlement-zero-price-1",
      idempotencyFingerprint: `sha256:${"5".repeat(64)}`,
      providerUsage: {
        ...providerUsage,
        cachedInputTokenCount: 0,
        estimatedCostMicros: "0",
        inputTokenCount: 0,
        outputTokenCount: 0,
      },
    } as const;
    expect(
      technicalUsageDetailV1Schema.safeParse(zeroCostSettlementEvent).success,
    ).toBe(true);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...zeroCostSettlementEvent,
        allocations: [
          { creditEffect: emptyCreditEffect, grantId: "grant_contract-test" },
        ],
        creditEffect: emptyCreditEffect,
      }).success,
    ).toBe(false);
    const releaseBeforeInvocationEvent = {
      ...eventBase,
      ...lifecycleEvidence,
      chargingScenario: "user-cancelled-before-invocation",
      allocations: [
        {
          creditEffect: { ...emptyCreditEffect, releasedCreditUnits: 40 },
          grantId: "grant_contract-test",
        },
      ],
      creditEffect: { ...emptyCreditEffect, releasedCreditUnits: 40 },
      eventType: "release",
      id: "usage_release-1",
      idempotencyFingerprint: `sha256:${"d".repeat(64)}`,
      outcome: "canceled",
      reasonCode: "canceled-before-invocation",
    } as const;
    const expirationEvent = {
      ...eventBase,
      ...lifecycleEvidence,
      allocations: [
        {
          creditEffect: {
            ...emptyCreditEffect,
            expiredReservationCreditUnits: 40,
          },
          grantId: "grant_contract-test",
        },
      ],
      creditEffect: {
        ...emptyCreditEffect,
        expiredReservationCreditUnits: 40,
      },
      eventType: "expiration",
      id: "usage_expiration-1",
      idempotencyFingerprint: `sha256:${"e".repeat(64)}`,
      outcome: "expired",
      reasonCode: "reservation-expired",
    } as const;
    const providerFailureEvent = {
      ...eventBase,
      ...lifecycleEvidence,
      chargingScenario: "provider-failure-before-useful-output",
      allocations: [
        {
          creditEffect: { ...emptyCreditEffect, releasedCreditUnits: 40 },
          grantId: "grant_contract-test",
        },
      ],
      creditEffect: { ...emptyCreditEffect, releasedCreditUnits: 40 },
      eventType: "provider-failure",
      id: "usage_provider-failure-1",
      idempotencyFingerprint: `sha256:${"f".repeat(64)}`,
      outcome: "provider-failure",
      providerUsage,
      reasonCode: "provider-failure-before-useful-output",
    } as const;
    const adjustmentEvent = {
      ...eventBase,
      allocations: [
        {
          creditEffect: { ...emptyCreditEffect, adjustmentCreditUnits: -15 },
          grantId: "grant_contract-test",
        },
        {
          creditEffect: { ...emptyCreditEffect, adjustmentCreditUnits: -10 },
          grantId: "grant_secondary-test",
        },
      ],
      chargingPolicyVersion: CHARGING_AND_FAILURE_POLICY_VERSION_V1,
      creditEffect: { ...emptyCreditEffect, adjustmentCreditUnits: -25 },
      eventType: "adjustment",
      id: "usage_adjustment-1",
      idempotencyFingerprint: `sha256:${"1".repeat(64)}`,
      outcome: "adjusted",
      reasonCode: "reviewed-reconciliation",
      reasonDetail: "Reviewed debit correction.",
      recordedByActorId: "worker_commercial-administration",
      recordedByActorKind: "internal-administration",
      relatedEventId: "usage_settlement-1",
    } as const;
    const noUsefulOutputEvent = {
      ...settlementEvent,
      chargingScenario: null,
      allocations: [
        {
          creditEffect: { ...emptyCreditEffect, releasedCreditUnits: 40 },
          grantId: "grant_contract-test",
        },
      ],
      creditEffect: { ...emptyCreditEffect, releasedCreditUnits: 40 },
      id: "usage_settlement-no-output-1",
      idempotencyFingerprint: `sha256:${"2".repeat(64)}`,
      outcome: "no-useful-output",
      reasonCode: "no-useful-output",
    } as const;
    const compensatedEvent = {
      ...adjustmentEvent,
      allocations: [
        {
          creditEffect: {
            ...emptyCreditEffect,
            adjustmentCreditUnits: 25,
            compensatedCreditUnits: 25,
          },
          grantId: "grant_contract-test",
        },
      ],
      creditEffect: {
        ...emptyCreditEffect,
        adjustmentCreditUnits: 25,
        compensatedCreditUnits: 25,
      },
      id: "usage_compensation-1",
      idempotencyFingerprint: `sha256:${"3".repeat(64)}`,
      outcome: "compensated",
      reasonCode: "system-defect-compensation",
    } as const;

    for (const eventType of [
      "grant",
      "reservation",
      "settlement",
      "release",
      "expiration",
      "provider-failure",
      "adjustment",
    ] as const) {
      expect(technicalUsageEventTypeV1Schema.safeParse(eventType).success).toBe(
        true,
      );
    }
    expect(
      technicalUsageEventTypeV1Schema.safeParse("compensating-adjustment")
        .success,
    ).toBe(false);

    const canonicalEvents = [
      grantEvent,
      reservationEvent,
      settlementEvent,
      releaseBeforeInvocationEvent,
      expirationEvent,
      providerFailureEvent,
      adjustmentEvent,
    ] as const;
    for (const event of [
      ...canonicalEvents,
      compensatedEvent,
      {
        ...releaseBeforeInvocationEvent,
        chargingScenario: "cloudmarkup-internal-failure",
        id: "usage_internal-failure-1",
        idempotencyFingerprint: `sha256:${"4".repeat(64)}`,
        outcome: "internal-failure",
        reasonCode: "internal-failure",
      } as const,
    ]) {
      const result = technicalUsageDetailV1Schema.safeParse(event);
      expect(
        result.success,
        result.success
          ? undefined
          : `${event.eventType}: ${JSON.stringify(result.error.issues)}`,
      ).toBe(true);
    }

    const pinnedRelease = technicalUsageDetailV1Schema.parse(
      releaseBeforeInvocationEvent,
    );
    expect(pinnedRelease.model).toBe("claude.example");
    expect(pinnedRelease.projectId).toBe("project_contract-test");
    expect(pinnedRelease.providerUsage).toBeNull();
    const negativeAdjustment =
      technicalUsageDetailV1Schema.parse(adjustmentEvent);
    expect(negativeAdjustment.creditEffect.adjustmentCreditUnits).toBe(-25);
    expect(negativeAdjustment.grantId).toBeUndefined();
    expect(
      technicalUsageDetailV1Schema.parse(settlementEvent).providerUsage
        ?.providerRequestId,
    ).toBe("provider-request-1");
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        model: "model/example",
      }).success,
    ).toBe(true);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        provider: "provider/example",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        recordedByActorId: "worker/accounting",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        reasonCode: "settled",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse(noUsefulOutputEvent).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...reservationEvent,
        chargingScenario: "proposal-delivered-user-rejected",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...releaseBeforeInvocationEvent,
        chargingScenario: "provider-failure-before-useful-output",
        outcome: "provider-failure",
        providerUsage,
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...providerFailureEvent,
        chargingScenario: "cloudmarkup-internal-failure",
        eventType: "release",
        outcome: "internal-failure",
      }).success,
    ).toBe(true);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...releaseBeforeInvocationEvent,
        providerUsage,
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        providerUsage: {
          ...providerUsage,
          cacheWriteTokenCount: 10,
        },
      }).success,
    ).toBe(false);

    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...adjustmentEvent,
        allocations: [
          {
            creditEffect: {
              ...emptyCreditEffect,
              adjustmentCreditUnits: 25,
            },
            grantId: "grant_contract-test",
          },
        ],
        creditEffect: {
          ...adjustmentEvent.creditEffect,
          adjustmentCreditUnits: 25,
        },
      }).success,
    ).toBe(true);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...adjustmentEvent,
        allocations: [],
        creditEffect: {
          ...adjustmentEvent.creditEffect,
          adjustmentCreditUnits: 0,
        },
      }).success,
    ).toBe(false);

    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        idempotencyFingerprint: undefined,
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        chargingScenario: undefined,
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        chargingScenario: null,
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        chargingScenario: "system-required-repair",
      }).success,
    ).toBe(true);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        chargingScenario: "provider-failure-before-useful-output",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        chargingScenario: "automatic-retry",
      }).success,
    ).toBe(false);

    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        idempotencyFingerprint: "sha256:not-a-digest",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...grantEvent,
        reasonCode: undefined,
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...grantEvent,
        chargingPolicyVersion: undefined,
      }).success,
    ).toBe(false);

    for (const providerField of [
      "model",
      "modelVersion",
      "pricingVersionId",
      "provider",
      "providerUsage",
    ] as const) {
      expect(
        technicalUsageDetailV1Schema.safeParse({
          ...settlementEvent,
          [providerField]: undefined,
        }).success,
      ).toBe(false);
    }
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        providerUsage: null,
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...reservationEvent,
        providerUsage,
      }).success,
    ).toBe(false);
    for (const lifecycleField of [
      "actingPrincipalId",
      "chargingPolicyVersion",
      "entitlementPolicyVersion",
      "feature",
      "jobId",
      "planVersionId",
      "projectId",
      "requestId",
      "reservationId",
    ] as const) {
      expect(
        technicalUsageDetailV1Schema.safeParse({
          ...releaseBeforeInvocationEvent,
          [lifecycleField]: undefined,
        }).success,
      ).toBe(false);
    }

    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        allocations: [],
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        allocations: [
          {
            ...settlementEvent.allocations[0],
            creditEffect: {
              ...settlementEvent.allocations[0].creditEffect,
              settledCreditUnits: 30,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        allocations: [
          {
            creditEffect: {
              ...emptyCreditEffect,
              releasedCreditUnits: 4,
              settledCreditUnits: 15,
            },
            grantId: "grant_contract-test",
          },
          {
            creditEffect: {
              ...emptyCreditEffect,
              releasedCreditUnits: 5,
              settledCreditUnits: 16,
            },
            grantId: "grant_contract-test",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...grantEvent,
        allocations: [
          {
            creditEffect: {
              ...emptyCreditEffect,
              grantedCreditUnits: 500,
            },
            grantId: "grant_contract-test",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...reservationEvent,
        grantId: "grant_contract-test",
      }).success,
    ).toBe(false);

    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...grantEvent,
        projectId: "project_fabricated",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...grantEvent,
        model: lifecycleEvidence.model,
        modelVersion: lifecycleEvidence.modelVersion,
        pricingVersionId: lifecycleEvidence.pricingVersionId,
        provider: lifecycleEvidence.provider,
        providerUsage: null,
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...adjustmentEvent,
        projectId: "project_fabricated",
      }).success,
    ).toBe(false);

    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...grantEvent,
        recordedByActorId: "principal_contract-test",
        recordedByActorKind: "principal",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...reservationEvent,
        recordedByActorId: reservationEvent.actingPrincipalId,
        recordedByActorKind: "principal",
      }).success,
    ).toBe(true);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...reservationEvent,
        recordedByActorId: "principal_different",
        recordedByActorKind: "principal",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...reservationEvent,
        recordedByActorId: "worker_commercial-administration",
        recordedByActorKind: "internal-administration",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        recordedByActorId: "worker_commercial-administration",
        recordedByActorKind: "internal-administration",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...adjustmentEvent,
        recordedByActorId: "worker_commercial-accounting",
        recordedByActorKind: "internal-accounting",
      }).success,
    ).toBe(false);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...adjustmentEvent,
        reasonDetail: "a".repeat(300),
      }).success,
    ).toBe(true);
    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...adjustmentEvent,
        reasonDetail: "a".repeat(301),
      }).success,
    ).toBe(false);

    const invalidOutcome = {
      adjustment: "granted",
      expiration: "released",
      grant: "reserved",
      "provider-failure": "internal-failure",
      release: "expired",
      reservation: "granted",
      settlement: "released",
    } as const;
    const forbiddenEffectKey = {
      adjustment: "grantedCreditUnits",
      expiration: "releasedCreditUnits",
      grant: "reservedCreditUnits",
      "provider-failure": "settledCreditUnits",
      release: "settledCreditUnits",
      reservation: "settledCreditUnits",
      settlement: "grantedCreditUnits",
    } as const;
    for (const event of canonicalEvents) {
      expect(
        technicalUsageDetailV1Schema.safeParse({
          ...event,
          outcome: invalidOutcome[event.eventType],
        }).success,
      ).toBe(false);
      expect(
        technicalUsageDetailV1Schema.safeParse({
          ...event,
          creditEffect: {
            ...event.creditEffect,
            [forbiddenEffectKey[event.eventType]]: 1,
          },
        }).success,
      ).toBe(false);
    }

    expect(
      technicalUsageDetailV1Schema.safeParse({
        ...settlementEvent,
        modelResponse: "sensitive response",
        rawPrompt: "sensitive prompt",
      }).success,
    ).toBe(false);
  });
  it("keeps credit compensation separate from provider-cost totals", () => {
    const summary = usageSummaryV1Schema.parse({
      asOf: LATER,
      byFeature: [
        {
          creditTotals: {
            compensatedCreditUnits: 31,
            debitAdjustmentCreditUnits: 40,
            expiredReservationCreditUnits: 0,
            netAdjustmentCreditUnits: -9,
            releasedCreditUnits: 9,
            reservedCreditUnits: 40,
            settledCreditUnits: 31,
          },
          feature: "ai-assisted-operations",
          requestCount: 1,
        },
      ],
      contractVersion: 1,
      creditTotals: {
        compensatedCreditUnits: 31,
        debitAdjustmentCreditUnits: 40,
        expiredReservationCreditUnits: 0,
        netAdjustmentCreditUnits: -9,
        releasedCreditUnits: 9,
        reservedCreditUnits: 40,
        settledCreditUnits: 31,
      },
      customerCompensatedEventCount: 1,
      eventCount: 3,
      organizationId: "org_contract-test",
      periodEndsAt: LATER,
      periodStartsAt: NOW,
      providerReportedEventCount: 1,
      requestCount: 1,
    });

    expect(summary.creditTotals.compensatedCreditUnits).toBe(31);
    expect(summary.creditTotals.netAdjustmentCreditUnits).toBe(-9);
    expect(
      usageSummaryV1Schema.safeParse({
        ...summary,
        providerCostTotals: [{ currency: "USD", estimatedCostMicros: "2500" }],
      }).success,
    ).toBe(false);
    expect(
      usageSummaryV1Schema.safeParse({
        ...summary,
        periodEndsAt: summary.periodStartsAt,
      }).success,
    ).toBe(false);
    expect(
      usageSummaryV1Schema.safeParse({
        ...summary,
        creditTotals: {
          ...summary.creditTotals,
          netAdjustmentCreditUnits: -8,
        },
      }).success,
    ).toBe(false);
    expect(
      usageSummaryV1Schema.safeParse({
        ...summary,
        byFeature: [...summary.byFeature, summary.byFeature[0]],
      }).success,
    ).toBe(false);
  });
});
