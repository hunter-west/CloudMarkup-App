import { describe, expect, it } from "vitest";

import {
  BETA_PLAN_VERSIONS_V1,
  CHARGING_POLICY_SCENARIOS,
  CHARGING_SCENARIO_TECHNICAL_OUTCOME_V1,
  COMMERCIAL_DOMAIN_VERSION,
  COMMERCIAL_FEATURE_KEYS,
  EXPENSIVE_COMMERCIAL_FEATURE_KEYS,
  TECHNICAL_USAGE_OUTCOMES,
  USAGE_DISPOSITION_POLICY_V1,
  USAGE_DISPOSITION_POLICY_VERSION,
  USAGE_OUTCOMES,
  CommercialDomainError,
  applyDebitAdjustmentV1,
  countSeatUsageV1,
  createEmptyCreditAccountV1,
  decideUsageDispositionV1,
  deriveBillableSeatQuantityV1,
  deriveCreditBalanceV1,
  deriveProviderCostReconciliationV1,
  deriveUsageSummaryV1,
  estimateCreditRangeV1,
  evaluateEntitlementV1,
  expireReservationV1,
  getBetaPlanVersion,
  grantCreditsV1,
  isExpensiveCommercialFeature,
  normalizeProviderUsageV1,
  releaseReservationV1,
  reserveCreditsV1,
  settleReservationV1,
  technicalUsageOutcomeForChargingScenarioV1,
  validateLocalSubscriptionProjectionV1,
  validateOrganizationBillingAccountV1,
  type CloseReservationInputV1,
  type CommercialFeatureKey,
  type CreditAccountStateV1,
  type CreditGrantV1,
  type EntitlementDecisionInputV1,
  type LocalSubscriptionProjectionV1,
  type OrganizationBillingAccountV1,
  type PlanVersionV1,
  type ProviderPricingVersionV1,
  type ProviderUsageMetricsV1,
  type ReserveCreditsInputV1,
  type ScopedLimitExtensionV1,
  type SettleReservationInputV1,
} from "./commercial.js";

const now = "2026-08-03T12:00:00.000Z";
const planNow = "2026-08-14T12:00:00.000Z";
const accountingRecorder = {
  recordedByActorId: "worker_commercial_accounting",
  recordedByActorKind: "internal-accounting",
} as const;

const later = "2026-08-03T13:00:00.000Z";

function creditGrant(
  grantId: string,
  totalUnits: number,
  options: Partial<CreditGrantV1> = {},
): CreditGrantV1 {
  return {
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    consumptionPriority: 100,
    createdAt: now,
    expirationPolicy: {
      expiresAt: null,
      kind: "does-not-expire",
      policyVersion: "beta-grants-v1",
    },
    grantPolicyVersion: "cloudmarkup-credit-grants-v1",
    grantId,
    grantKind: "one-time",
    idempotencyKey: `idem_${grantId}`,
    sourcePlanVersionId: "planver_free_trial_2026_08_03_v1",
    sourceReference: null,
    startsAt: now,
    subscriptionPeriodEnd: null,
    subscriptionPeriodId: null,
    totalUnits,
    ...options,
  };
}

function addGrant(
  state: CreditAccountStateV1,
  grant: CreditGrantV1,
  actor: string | null = null,
  relatedUsageEventId: string | null = null,
): CreditAccountStateV1 {
  return grantCreditsV1(state, {
    actingAdministratorId: actor,
    eventId: `ledger_${grant.grantId}`,
    grant,
    reasonCode:
      grant.grantKind === "administrative"
        ? "adjustment.compensation"
        : "plan.credit-grant",
    recordedByActorId: actor ?? accountingRecorder.recordedByActorId,
    recordedByActorKind:
      actor === null ? "internal-accounting" : "internal-administration",
    relatedUsageEventId,
  }).state;
}

function reservationInput(
  overrides: Partial<ReserveCreditsInputV1> = {},
): ReserveCreditsInputV1 {
  return {
    actingPrincipalId: "principal_editor",
    chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
    createdAt: now,
    entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
    estimatedUnits: 60,
    expiresAt: later,
    feature: "ai-assisted-operations",
    idempotencyKey: "idem_reservation_1",
    jobId: "job_ai_1",
    ledgerEventId: "ledger_reservation_1",
    modelId: "model_example_1",
    modelVersion: "2026-08-01",
    planVersionId: "planver_pro_2026_08_03_v1",
    pricingVersionId: "pricing_example_1",
    projectId: "project_example_1",
    providerKey: "example-provider",
    requestId: "request_example_1",
    ...accountingRecorder,
    reservationId: "reservation_example_1",
    ...overrides,
  };
}

const providerUsage: ProviderUsageMetricsV1 = {
  cachedInputTokens: 25,
  estimatedProviderCostMicros: 120_000,
  inputTokens: 1_000,
  latencyMilliseconds: 850,
  modelId: "model_example_1",
  modelVersion: "2026-08-01",
  outputTokens: 250,
  providerCostCurrency: "USD",
  providerKey: "example-provider",
  providerRequestId: "provider_request_1",
};

const settlementPricing: ProviderPricingVersionV1 = {
  cachedInputTokenMicrosPerMillion: 0,
  commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
  creditConversionDenominator: 3_000,
  creditConversionNumerator: 1,
  currencyCode: "USD",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveUntil: null,
  inputTokenMicrosPerMillion: 60_000_000,
  modelId: "model_example_1",
  modelVersion: "2026-08-01",
  outputTokenMicrosPerMillion: 240_000_000,
  pricingVersionId: "pricing_example_1",
  providerKey: "example-provider",
};

function expectDomainError(
  operation: () => unknown,
  code: CommercialDomainError["code"],
): CommercialDomainError {
  try {
    operation();
    throw new Error("Expected a commercial domain error.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CommercialDomainError);
    expect((error as CommercialDomainError).code).toBe(code);
    return error as CommercialDomainError;
  }
}

describe("commercial feature classification", () => {
  it("exports one immutable provider-neutral expensive-feature classification", () => {
    const expected = [
      "complete-application-generation",
      "validation-jobs",
      "plan-evidence-workflows",
      "deployment-evidence-workflows",
      "ai-assisted-operations",
    ] as const satisfies readonly CommercialFeatureKey[];
    const expectedSet = new Set<CommercialFeatureKey>(expected);

    expect(Object.isFrozen(EXPENSIVE_COMMERCIAL_FEATURE_KEYS)).toBe(true);
    expect(EXPENSIVE_COMMERCIAL_FEATURE_KEYS).toEqual(expected);
    expect(new Set(EXPENSIVE_COMMERCIAL_FEATURE_KEYS).size).toBe(
      EXPENSIVE_COMMERCIAL_FEATURE_KEYS.length,
    );

    for (const feature of COMMERCIAL_FEATURE_KEYS) {
      expect(isExpensiveCommercialFeature(feature)).toBe(
        expectedSet.has(feature),
      );
    }
  });
});

describe("commercial beta plan configuration", () => {
  it("keeps only the fixed paid Starter and Pro beta plans active", () => {
    const starter = getBetaPlanVersion("starter", planNow);
    const pro = getBetaPlanVersion("pro", planNow);

    expect(BETA_PLAN_VERSIONS_V1.map((plan) => plan.planDefinitionId)).toEqual([
      "plan_starter",
      "plan_pro",
    ]);
    expect(starter.proposedMonthlyPrice?.unitAmountMicros).toBe(9_000_000);
    expect(starter.includedCreditGrants).toEqual([
      { kind: "monthly", units: 200 },
    ]);
    expect(
      starter.entitlements.find(
        (entitlement) => entitlement.feature === "terraform",
      )?.enabled,
    ).toBe(true);
    expect(
      starter.entitlements.find(
        (entitlement) => entitlement.feature === "cloudformation",
      )?.enabled,
    ).toBe(false);
    expect(
      starter.entitlements.find(
        (entitlement) => entitlement.feature === "github-export",
      )?.enabled,
    ).toBe(false);
    expect(
      starter.limits.find((limit) => limit.key === "projects")?.value,
    ).toBe(5);

    expect(pro.proposedMonthlyPrice?.unitAmountMicros).toBe(39_000_000);
    expect(pro.includedCreditGrants).toEqual([
      { kind: "monthly", units: 1_000 },
    ]);
    expect(
      pro.limits.find((limit) => limit.key === "concurrent-ai-jobs")?.value,
    ).toBe(2);
    expect(
      pro.entitlements.find(
        (entitlement) => entitlement.feature === "github-export",
      )?.enabled,
    ).toBe(true);
    expect(
      pro.entitlements.find(
        (entitlement) => entitlement.feature === "cloudformation",
      )?.enabled,
    ).toBe(false);
    expect(pro.futureAdditionalEditorConcept).toBeNull();
  });
  it("selects the latest effective plan version and rejects gaps", () => {
    const currentPro = getBetaPlanVersion("pro", planNow);
    const futurePro: PlanVersionV1 = {
      ...currentPro,
      effectiveFrom: "2026-09-01T00:00:00.000Z",
      planVersionId: "planver_pro_2026_09_01_v2",
    };
    const versions = BETA_PLAN_VERSIONS_V1 as unknown as PlanVersionV1[];
    const initialLength = versions.length;
    versions.push(futurePro);
    try {
      expect(
        getBetaPlanVersion("pro", "2026-08-31T23:59:59.999Z").planVersionId,
      ).toBe(currentPro.planVersionId);
      expect(
        getBetaPlanVersion("pro", "2026-09-01T00:00:00.000Z").planVersionId,
      ).toBe(futurePro.planVersionId);
      expectDomainError(
        () => getBetaPlanVersion("pro", "2026-08-13T23:59:59.999Z"),
        "invalid-plan-version",
      );
    } finally {
      versions.splice(initialLength);
    }
  });

  it("validates provider-neutral billing accounts and local subscription periods", () => {
    const account: OrganizationBillingAccountV1 = {
      billingAccountId: "billing_account_example_1",
      commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
      createdAt: now,
      expensiveOperationsEnabled: true,
      lifecycleStatus: "active",
      organizationId: "organization_example_1",
      recordVersion: 1,
      updatedAt: later,
    };
    const projection: LocalSubscriptionProjectionV1 = {
      billableSeatQuantity: 5,
      billingAccountId: account.billingAccountId,
      billingProviderKey: "billing-provider-example",
      cancelAtPeriodEnd: false,
      commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
      currentPeriodEndsAt: "2026-09-03T12:00:00.000Z",
      currentPeriodId: "period_example_1",
      currentPeriodStartsAt: now,
      effectiveAt: now,
      lastProviderEventReference: "event/example/1",
      normalizedState: "active",
      organizationId: account.organizationId,
      planVersionId: "planver_team_2026_08_03_v1",
      projectionVersion: 1,
      providerCustomerReference: "customer/example/1",
      providerEventPosition: "42",
      providerPriceReference: "price/example/1",
      providerProductReference: "product/example/1",
      providerSubscriptionReference: "subscription/example/1",
      subscriptionProjectionId: "subscription_projection_example_1",
    };

    expect(() => {
      validateOrganizationBillingAccountV1(account);
    }).not.toThrow();
    expect(() => {
      validateLocalSubscriptionProjectionV1(projection);
    }).not.toThrow();
    expectDomainError(() => {
      validateOrganizationBillingAccountV1({
        ...account,
        lifecycleStatus: "suspended",
      });
    }, "invalid-input");
    expectDomainError(() => {
      validateLocalSubscriptionProjectionV1({
        ...projection,
        currentPeriodEndsAt: null,
      });
    }, "invalid-input");
    expectDomainError(() => {
      validateLocalSubscriptionProjectionV1({
        ...projection,
        currentPeriodEndsAt: projection.currentPeriodStartsAt,
      });
    }, "invalid-input");
  });

  it("counts only active billable candidates and excludes invitations", () => {
    expect(
      countSeatUsageV1([
        { membershipId: "membership_owner", role: "owner", status: "active" },
        {
          membershipId: "membership_admin",
          role: "administrator",
          status: "active",
        },
        { membershipId: "membership_editor", role: "editor", status: "active" },
        { membershipId: "membership_viewer", role: "viewer", status: "active" },
        {
          membershipId: "membership_pending",
          role: "editor",
          status: "pending-invitation",
        },
        {
          membershipId: "membership_suspended",
          role: "administrator",
          status: "suspended",
        },
      ]),
    ).toEqual({
      activeMembers: 4,
      activeMembersByRole: {
        administrator: 1,
        editor: 1,
        owner: 1,
        viewer: 1,
      },
      billableSeats: 3,
      pendingInvitations: 1,
      viewers: 1,
    });
  });

  it("derives included and additional seats from active billable roles only", () => {
    expect(
      deriveBillableSeatQuantityV1(getBetaPlanVersion("pro", planNow), [
        { membershipId: "membership_owner", role: "owner", status: "active" },
        {
          membershipId: "membership_admin_1",
          role: "administrator",
          status: "active",
        },
        {
          membershipId: "membership_admin_2",
          role: "administrator",
          status: "active",
        },
        {
          membershipId: "membership_editor_1",
          role: "editor",
          status: "active",
        },
        {
          membershipId: "membership_editor_2",
          role: "editor",
          status: "active",
        },
        {
          membershipId: "membership_editor_3",
          role: "editor",
          status: "active",
        },
        { membershipId: "membership_viewer", role: "viewer", status: "active" },
        {
          membershipId: "membership_pending",
          role: "editor",
          status: "pending-invitation",
        },
        {
          membershipId: "membership_suspended",
          role: "administrator",
          status: "suspended",
        },
      ]),
    ).toEqual({
      activeBillableSeatCandidates: 6,
      additionalBillableSeats: 5,
      includedBillableSeats: 1,
      includedBillableSeatsUsed: 1,
    });
  });
});

describe("commercial entitlement decisions", () => {
  function decisionInput(
    overrides: Partial<EntitlementDecisionInputV1> = {},
  ): EntitlementDecisionInputV1 {
    return {
      at: planNow,
      availableCreditUnits: 0,
      billingAccountId: "billing_org-example",
      billingAccountRecordVersion: 1,
      commercialState: "active",
      expensiveOperationsEnabled: true,
      feature: "manual-editing",
      limitUsage: [],
      memberId: "principal_editor",
      operationKind: "manual-edit",
      organizationId: "org_example",
      organizationStatus: "active",
      plan: getBetaPlanVersion("pro", planNow),
      pricingAvailable: true,
      projectId: "project_example_1",
      requestedCreditUnits: 0,
      scopedLimitExtensions: [],
      subscriptionProjectionVersion: 1,
      subscriptionState: "active",
      targetRole: null,
      ...overrides,
    };
  }

  function expensiveDecisionInput(
    overrides: Partial<EntitlementDecisionInputV1> = {},
  ): EntitlementDecisionInputV1 {
    return decisionInput({
      availableCreditUnits: 100,
      feature: "ai-assisted-operations",
      limitUsage: [
        {
          currentUsage: 0,
          limitKey: "concurrent-ai-jobs",
          requestedUsage: 1,
        },
      ],
      operationKind: "expensive",
      requestedCreditUnits: 1,
      ...overrides,
    });
  }

  function collaborationPlan(): PlanVersionV1 {
    const pro = getBetaPlanVersion("pro", planNow);
    return {
      ...pro,
      entitlements: pro.entitlements.map((entitlement) =>
        entitlement.feature === "organization-roles"
          ? { ...entitlement, enabled: true }
          : entitlement,
      ),
      limits: pro.limits.map((limit) =>
        [
          "active-members",
          "active-owners",
          "active-administrators",
          "active-editors",
          "billable-seats",
        ].includes(limit.key)
          ? {
              ...limit,
              value: limit.key === "active-members" ? 25 : 5,
            }
          : limit,
      ),
      planVersionId: "planver_test_collaboration_v1",
    };
  }
  function scopedExtension(
    overrides: Partial<ScopedLimitExtensionV1> = {},
  ): ScopedLimitExtensionV1 {
    return {
      authorizedByActorId: "principal_commercial-admin",
      authorizationReference: "audit_limit-extension-1",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveUntil: "2026-09-01T00:00:00.000Z",
      extensionPolicyVersion: "limit-extensions-v1",
      limitKey: "per-user-request-count",
      period: "rolling-day",
      planVersionId: "planver_pro_2026_08_14_v2",
      reasonCode: "limits.approved",
      scope: "member",
      subjectId: "principal_editor",
      value: 10,
      ...overrides,
    };
  }

  it("preserves manual, read, and export access during suspension but denies expensive AI", () => {
    expect(
      evaluateEntitlementV1(
        expensiveDecisionInput({ organizationStatus: "suspended" }),
      ).denialReason,
    ).toBe("organization_suspended");
    expect(
      evaluateEntitlementV1(
        expensiveDecisionInput({
          availableCreditUnits: 0,
          requestedCreditUnits: 1,
        }),
      ).denialReason,
    ).toBe("insufficient_credits");
    expect(
      evaluateEntitlementV1(
        decisionInput({ expensiveOperationsEnabled: false }),
      ).allowed,
    ).toBe(true);
    expect(
      evaluateEntitlementV1(
        expensiveDecisionInput({ expensiveOperationsEnabled: false }),
      ).denialReason,
    ).toBe("expensive_operations_disabled");
  });

  it("fails closed when subscription-state access policy is unavailable", () => {
    for (const input of [
      decisionInput({ subscriptionState: "inactive" }),
      expensiveDecisionInput({ subscriptionState: "inactive" }),
    ]) {
      expect(
        expectDomainError(() => evaluateEntitlementV1(input), "invalid-input")
          .message,
      ).toBe("Subscription-state access policy is unavailable.");
    }
  });

  it("uses explicit inactive-subscription policy to preserve existing work, bound grace, and block paid AI", () => {
    const policy = {
      allowPlanExpansionDuringGrace: false,
      graceEndsAt: "2026-08-15T00:00:00.000Z",
      policyVersion: "controlled-beta-grace-v1",
      preserveApprovedDataExport: true,
      preserveExistingProjectAccess: true,
      preserveManualEditing: true,
    } as const;

    for (const preserved of [
      decisionInput({
        inactiveSubscriptionAccessPolicy: policy,
        subscriptionState: "inactive",
      }),
      decisionInput({
        feature: "read-existing-projects",
        inactiveSubscriptionAccessPolicy: policy,
        operationKind: "read",
        subscriptionState: "inactive",
      }),
      decisionInput({
        feature: "data-export",
        inactiveSubscriptionAccessPolicy: policy,
        operationKind: "data-export",
        subscriptionState: "inactive",
      }),
    ]) {
      expect(evaluateEntitlementV1(preserved).allowed).toBe(true);
    }

    expect(
      evaluateEntitlementV1(
        expensiveDecisionInput({
          inactiveSubscriptionAccessPolicy: policy,
          subscriptionState: "inactive",
        }),
      ).denialReason,
    ).toBe("subscription_inactive");

    expect(
      evaluateEntitlementV1(
        decisionInput({
          inactiveSubscriptionAccessPolicy: policy,
          limitUsage: [
            { currentUsage: 1, limitKey: "projects", requestedUsage: 1 },
          ],
          operationKind: "project-create",
          subscriptionState: "inactive",
        }),
      ).denialReason,
    ).toBe("subscription_inactive");

    expect(
      evaluateEntitlementV1(
        decisionInput({
          inactiveSubscriptionAccessPolicy: {
            ...policy,
            allowPlanExpansionDuringGrace: true,
            graceEndsAt: "2026-08-15T00:00:00.000Z",
          },
          limitUsage: [
            { currentUsage: 1, limitKey: "projects", requestedUsage: 1 },
          ],
          operationKind: "project-create",
          subscriptionState: "inactive",
        }),
      ).allowed,
    ).toBe(true);

    expect(
      evaluateEntitlementV1(
        decisionInput({
          at: "2026-08-16T00:00:00.000Z",
          inactiveSubscriptionAccessPolicy: {
            ...policy,
            allowPlanExpansionDuringGrace: true,
          },
          limitUsage: [
            { currentUsage: 1, limitKey: "projects", requestedUsage: 1 },
          ],
          operationKind: "project-create",
          subscriptionState: "inactive",
        }),
      ).denialReason,
    ).toBe("subscription_inactive");
  });
  it("fails closed for plan-expanding writes while preserving existing work", () => {
    const unavailableStates = [
      {
        overrides: { commercialState: "unavailable" as const },
        reason: "commercial_state_unavailable",
      },
      {
        overrides: { organizationStatus: "suspended" as const },
        reason: "organization_suspended",
      },
    ] as const;

    for (const { overrides, reason } of unavailableStates) {
      for (const preserved of [
        decisionInput(overrides),
        decisionInput({
          ...overrides,
          feature: "read-existing-projects",
          operationKind: "read",
        }),
        decisionInput({
          ...overrides,
          feature: "data-export",
          operationKind: "data-export",
        }),
      ]) {
        expect(evaluateEntitlementV1(preserved).allowed).toBe(true);
      }

      expect(
        evaluateEntitlementV1(
          decisionInput({
            ...overrides,
            operationKind: "project-create",
          }),
        ).denialReason,
      ).toBe(reason);
      expect(
        evaluateEntitlementV1(
          decisionInput({
            ...overrides,
            feature: "organization-roles",
            memberId: "principal_invited-member",
            operationKind: "member-activate",
            plan: collaborationPlan(),
            projectId: null,
            targetRole: "editor",
          }),
        ).denialReason,
      ).toBe(reason);
    }
  });

  it("fails closed for misclassified expensive features and missing limit usage", () => {
    expectDomainError(
      () =>
        evaluateEntitlementV1(
          decisionInput({
            feature: "ai-assisted-operations",
            operationKind: "read",
          }),
        ),
      "invalid-input",
    );
    expectDomainError(
      () => evaluateEntitlementV1(expensiveDecisionInput({ limitUsage: [] })),
      "invalid-input",
    );
    expectDomainError(
      () =>
        evaluateEntitlementV1(
          expensiveDecisionInput({
            limitUsage: [
              {
                currentUsage: 0,
                limitKey: "concurrent-ai-jobs",
                requestedUsage: 1,
              },
              { currentUsage: 0, limitKey: "projects", requestedUsage: 0 },
            ],
          }),
        ),
      "invalid-input",
    );

    const memberExtension = scopedExtension();
    expectDomainError(
      () =>
        evaluateEntitlementV1(
          expensiveDecisionInput({
            scopedLimitExtensions: [memberExtension],
          }),
        ),
      "invalid-input",
    );
  });

  it("distinguishes configured-disabled features from absent entitlements", () => {
    expect(
      evaluateEntitlementV1(
        expensiveDecisionInput({
          feature: "complete-application-generation",
          plan: collaborationPlan(),
        }),
      ).denialReason,
    ).toBe("feature_disabled");

    const pro = getBetaPlanVersion("pro", planNow);
    const withoutManualEditing: PlanVersionV1 = {
      ...pro,
      entitlements: pro.entitlements.filter(
        (entitlement) => entitlement.feature !== "manual-editing",
      ),
    };
    expect(
      evaluateEntitlementV1(decisionInput({ plan: withoutManualEditing }))
        .denialReason,
    ).toBe("feature_not_entitled");
  });

  it("evaluates organization, member, and project limits with trusted extension evidence and periods", () => {
    const organizationDecision = evaluateEntitlementV1(
      decisionInput({
        feature: "manual-editing",
        limitUsage: [
          { currentUsage: 25, limitKey: "projects", requestedUsage: 1 },
        ],
        operationKind: "project-create",
      }),
    );
    expect(organizationDecision).toMatchObject({
      allowed: false,
      denialReason: "project_limit_reached",
      evaluatedLimits: [
        {
          currentUsage: 25,
          limit: 25,
          limitKey: "projects",
          requestedUsage: 1,
          scope: "organization",
        },
      ],
    });

    const memberExtension = scopedExtension();
    const projectExtension = scopedExtension({
      authorizationReference: "audit_limit-extension-2",
      limitKey: "per-project-credit-cap",
      scope: "project",
      subjectId: "project_example_1",
      value: 100,
    });
    const extendedDecision = evaluateEntitlementV1(
      expensiveDecisionInput({
        limitUsage: [
          {
            currentUsage: 1,
            limitKey: "concurrent-ai-jobs",
            requestedUsage: 1,
          },
          {
            currentUsage: 9,
            limitKey: "per-user-request-count",
            requestedUsage: 1,
          },
          {
            currentUsage: 90,
            limitKey: "per-project-credit-cap",
            requestedUsage: 10,
          },
        ],
        requestedCreditUnits: 10,
        scopedLimitExtensions: [memberExtension, projectExtension],
      }),
    );
    expect(extendedDecision).toMatchObject({
      allowed: true,
      evaluatedLimits: [
        { limit: 2, limitKey: "concurrent-ai-jobs", scope: "organization" },
        { limit: 10, limitKey: "per-user-request-count", scope: "member" },
        {
          limit: 100,
          limitKey: "per-project-credit-cap",
          scope: "project",
        },
      ],
    });

    expectDomainError(
      () =>
        evaluateEntitlementV1(
          expensiveDecisionInput({
            scopedLimitExtensions: [
              scopedExtension({
                authorizationReference: "audit_invalid-concurrency-extension",
                limitKey: "concurrent-ai-jobs",
                scope: "member",
                value: 10,
              }),
            ],
          }),
        ),
      "invalid-input",
    );

    expectDomainError(
      () =>
        evaluateEntitlementV1(
          expensiveDecisionInput({
            scopedLimitExtensions: [
              scopedExtension({
                authorizationReference: "audit_invalid-scope-extension",
                scope:
                  "organization" as unknown as ScopedLimitExtensionV1["scope"],
              }),
            ],
          }),
        ),
      "invalid-input",
    );

    const expiredExtension = scopedExtension({
      effectiveUntil: now,
    });
    expect(
      evaluateEntitlementV1(
        expensiveDecisionInput({
          scopedLimitExtensions: [expiredExtension],
        }),
      ).evaluatedLimits,
    ).toEqual([
      {
        currentUsage: 0,
        limit: 2,
        limitKey: "concurrent-ai-jobs",
        period: "none",
        requestedUsage: 1,
        scope: "organization",
      },
    ]);

    expectDomainError(
      () =>
        evaluateEntitlementV1(
          expensiveDecisionInput({
            limitUsage: [
              {
                currentUsage: 0,
                limitKey: "concurrent-ai-jobs",
                requestedUsage: 1,
              },
              {
                currentUsage: 0,
                limitKey: "per-user-request-count",
                requestedUsage: 1,
              },
            ],
            scopedLimitExtensions: [
              scopedExtension({ authorizedByActorId: "invalid actor" }),
            ],
          }),
        ),
      "invalid-input",
    );
    expectDomainError(
      () =>
        evaluateEntitlementV1(
          expensiveDecisionInput({
            limitUsage: [
              {
                currentUsage: 0,
                limitKey: "concurrent-ai-jobs",
                requestedUsage: 1,
              },
              {
                currentUsage: 0,
                limitKey: "per-user-request-count",
                requestedUsage: 1,
              },
            ],
            scopedLimitExtensions: [
              memberExtension,
              scopedExtension({ authorizationReference: "audit_overlap-2" }),
            ],
          }),
        ),
      "invalid-input",
    );
  });

  it("evaluates the target active-role limit and retains decision evidence", () => {
    const decision = evaluateEntitlementV1(
      decisionInput({
        feature: "organization-roles",
        limitUsage: [
          {
            currentUsage: 4,
            limitKey: "active-members",
            requestedUsage: 1,
          },
          {
            currentUsage: 5,
            limitKey: "active-editors",
            requestedUsage: 1,
          },
          {
            currentUsage: 4,
            limitKey: "billable-seats",
            requestedUsage: 1,
          },
        ],
        operationKind: "member-activate",
        plan: collaborationPlan(),
        targetRole: "editor",
      }),
    );

    expect(decision).toMatchObject({
      allowed: false,
      denialReason: "member_role_limit_reached",
      evaluatedAt: planNow,
      evaluatedLimits: [
        { limitKey: "active-members" },
        { limitKey: "active-editors" },
      ],
      memberId: "principal_editor",
      operationKind: "member-activate",
      projectId: "project_example_1",
      targetRole: "editor",
    });
    expect(collaborationPlan().limits.map((limit) => limit.key)).toEqual(
      expect.arrayContaining([
        "active-owners",
        "active-administrators",
        "active-editors",
      ]),
    );
  });
});
describe("grant-backed credit accounting", () => {
  it("rejects unsupported credit-state versions at every public state boundary", () => {
    let state = addGrant(
      createEmptyCreditAccountV1("organization_state-version"),
      creditGrant("grant_state-version", 100),
    );
    state = reserveCreditsV1(state, reservationInput()).state;
    const unsupportedState = {
      ...state,
      commercialDomainVersion: 2,
    } as unknown as CreditAccountStateV1;
    const settlementInput: SettleReservationInputV1 = {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 40,
      customerChargeCreditUnits: 40,
      eventId: "ledger_state-version-settlement",
      idempotencyKey: "idem_state-version-settlement",
      occurredAt: later,
      chargingScenario: "proposal-delivered-user-rejected",
      pricingVersion: settlementPricing,
      providerUsage,
      reasonCode: "usage.proposal-delivered",
      reservationId: "reservation_example_1",
    };
    const closeInput: CloseReservationInputV1 = {
      ...accountingRecorder,
      eventId: "ledger_state-version-close",
      idempotencyKey: "idem_state-version-close",
      occurredAt: later,
      chargingScenario: "user-cancelled-before-invocation",
      pricingVersion: null,
      providerUsage: null,
      reasonCode: "usage.user-cancelled",
      reservationId: "reservation_example_1",
    };
    const consumers: readonly (() => unknown)[] = [
      () =>
        grantCreditsV1(unsupportedState, {
          actingAdministratorId: null,
          ...accountingRecorder,
          eventId: "ledger_state-version-grant",
          grant: creditGrant("grant_state-version-next", 1),
          reasonCode: "plan.credit-grant",
          relatedUsageEventId: null,
        }),
      () => deriveCreditBalanceV1(unsupportedState, now),
      () => reserveCreditsV1(unsupportedState, reservationInput()),
      () => settleReservationV1(unsupportedState, settlementInput),
      () => releaseReservationV1(unsupportedState, closeInput),
      () => expireReservationV1(unsupportedState, closeInput),
      () =>
        applyDebitAdjustmentV1(unsupportedState, {
          actingAdministratorId: "principal_platform_admin",
          eventId: "ledger_state-version-adjustment",
          idempotencyKey: "idem_state-version-adjustment",
          occurredAt: later,
          reasonCode: "adjustment.operator-correction",
          recordedByActorId: "principal_platform_admin",
          recordedByActorKind: "internal-administration",
          relatedUsageEventId: "ledger_reservation_1",
          units: 1,
        }),
      () => deriveProviderCostReconciliationV1(unsupportedState),
      () => deriveUsageSummaryV1(unsupportedState),
    ];

    expect(consumers).toHaveLength(9);
    for (const consume of consumers) {
      expectDomainError(consume, "invalid-input");
    }
  });

  it("rejects malformed state envelopes, nested versions, duplicate identities, and unknown allocations", () => {
    const state = addGrant(
      createEmptyCreditAccountV1("organization_state-validation"),
      creditGrant("grant_state-validation", 100),
    );
    const [grant] = state.grants;
    if (grant === undefined) {
      throw new Error("Expected the test grant.");
    }

    for (const malformed of [
      {
        ...state,
        organizationId: "invalid organization",
      },
      {
        ...state,
        grants: null,
      },
      {
        ...state,
        grants: [{ ...grant, commercialDomainVersion: 2 }],
      },
      {
        ...state,
        grants: [grant, { ...grant }],
      },
    ]) {
      expectDomainError(
        () =>
          deriveCreditBalanceV1(
            malformed as unknown as CreditAccountStateV1,
            now,
          ),
        "invalid-input",
      );
    }

    const reserved = reserveCreditsV1(state, reservationInput()).state;
    const [reservation] = reserved.reservations;
    if (reservation === undefined) {
      throw new Error("Expected the test reservation.");
    }
    const unknownAllocationState = {
      ...reserved,
      reservations: [
        {
          ...reservation,
          allocations: [{ grantId: "grant_missing", units: 60 }],
        },
      ],
    } as CreditAccountStateV1;
    expectDomainError(
      () => deriveUsageSummaryV1(unknownAllocationState),
      "invalid-input",
    );

    const duplicateRequestState = {
      ...reserved,
      reservations: [
        reservation,
        {
          ...reservation,
          reservationId: "reservation_duplicate_request",
          idempotencyKey: "idempotency_duplicate_request",
        },
      ],
    } as CreditAccountStateV1;
    expectDomainError(
      () => deriveUsageSummaryV1(duplicateRequestState),
      "invalid-input",
    );
  });

  it("clones mutable grant and provider-usage inputs before appending history", () => {
    const expirationPolicy: {
      expiresAt: string;
      kind: "expires-at";
      policyVersion: string;
    } = {
      expiresAt: "2026-09-01T00:00:00.000Z",
      kind: "expires-at",
      policyVersion: "promotion-v1",
    };
    const mutableGrant = {
      ...creditGrant("grant_input-alias", 100, {
        grantKind: "promotional",
        sourcePlanVersionId: null,
      }),
      expirationPolicy,
    };
    const issued = grantCreditsV1(
      createEmptyCreditAccountV1("organization_input-alias"),
      {
        actingAdministratorId: null,
        ...accountingRecorder,
        eventId: "ledger_input-alias-grant",
        grant: mutableGrant,
        reasonCode: "promotion.credit-grant",
        relatedUsageEventId: null,
      },
    );

    mutableGrant.totalUnits = 999;
    expirationPolicy.expiresAt = "2026-10-01T00:00:00.000Z";
    expect(issued.state.grants[0]).toMatchObject({
      expirationPolicy: { expiresAt: "2026-09-01T00:00:00.000Z" },
      totalUnits: 100,
    });

    let state = reserveCreditsV1(issued.state, reservationInput()).state;
    const mutableProviderUsage = { ...providerUsage };
    state = settleReservationV1(state, {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 40,
      customerChargeCreditUnits: 40,
      eventId: "ledger_input-alias-settlement",
      idempotencyKey: "idem_input-alias-settlement",
      occurredAt: later,
      chargingScenario: "proposal-delivered-user-rejected",
      pricingVersion: settlementPricing,
      providerUsage: mutableProviderUsage,
      reasonCode: "usage.proposal-delivered",
      reservationId: "reservation_example_1",
    }).state;

    mutableProviderUsage.estimatedProviderCostMicros = 999;
    mutableProviderUsage.providerCostCurrency = "EUR";
    expect(
      state.usageEvents.find(
        (event) => event.eventId === "ledger_input-alias-settlement",
      )?.providerUsage,
    ).toMatchObject({
      estimatedProviderCostMicros: 120_000,
      providerCostCurrency: "USD",
    });
    expect(deriveProviderCostReconciliationV1(state)).toEqual([
      { currency: "USD", estimatedCostMicros: 120_000 },
    ]);
  });

  it("issues welcome/monthly grants idempotently and keeps unresolved purchased credits unavailable", () => {
    let state = createEmptyCreditAccountV1("organization_example_1");
    const welcome = creditGrant("grant_welcome", 150);
    const issued = grantCreditsV1(state, {
      actingAdministratorId: null,
      ...accountingRecorder,
      eventId: "ledger_grant_welcome",
      grant: welcome,
      reasonCode: "plan.welcome",
      relatedUsageEventId: null,
    });
    state = issued.state;
    expect(issued.replayed).toBe(false);
    expect(state.usageEvents[0]).toMatchObject({
      chargingScenario: null,
      eventKind: "grant",
      outcome: "granted",
    });
    expect(
      grantCreditsV1(state, {
        actingAdministratorId: null,
        ...accountingRecorder,
        eventId: "ledger_grant_welcome",
        grant: welcome,
        reasonCode: "plan.welcome",
        relatedUsageEventId: null,
      }).replayed,
    ).toBe(true);

    state = addGrant(
      state,
      creditGrant("grant_monthly_august", 1_000, {
        expirationPolicy: {
          expiresAt: "2026-09-01T00:00:00.000Z",
          kind: "expires-at",
          policyVersion: "monthly-period-v1",
        },
        grantKind: "monthly",
        idempotencyKey: "idem_monthly_period_august",
        sourcePlanVersionId: "planver_pro_2026_08_03_v1",
        subscriptionPeriodEnd: "2026-09-01T00:00:00.000Z",
        subscriptionPeriodId: "period_2026_08",
      }),
    );
    expect(deriveCreditBalanceV1(state, now).availableUnits).toBe(1_150);
    expect(
      state.grants.find((grant) => grant.grantId === "grant_monthly_august")
        ?.subscriptionPeriodEnd,
    ).toBe("2026-09-01T00:00:00.000Z");

    expectDomainError(
      () =>
        addGrant(
          state,
          creditGrant("grant_monthly_august_collision", 1_000, {
            expirationPolicy: {
              expiresAt: "2026-09-01T00:00:00.000Z",
              kind: "expires-at",
              policyVersion: "monthly-period-v1",
            },
            grantKind: "monthly",
            idempotencyKey: "idem_monthly_period_august_collision",
            subscriptionPeriodEnd: "2026-09-01T00:00:00.000Z",
            subscriptionPeriodId: "period_2026_08",
          }),
        ),
      "idempotency-conflict",
    );
    expectDomainError(
      () =>
        addGrant(
          state,
          creditGrant("grant_monthly_bad_end", 1_000, {
            expirationPolicy: {
              expiresAt: "2026-10-01T00:00:00.000Z",
              kind: "expires-at",
              policyVersion: "monthly-period-v1",
            },
            grantKind: "monthly",
            idempotencyKey: "idem_monthly_bad_end",
            startsAt: "2026-09-01T00:00:00.000Z",
            subscriptionPeriodEnd: "2026-10-02T00:00:00.000Z",
            subscriptionPeriodId: "period_2026_09",
          }),
        ),
      "invalid-input",
    );

    state = addGrant(
      state,
      creditGrant("grant_purchased", 50, {
        expirationPolicy: {
          expiresAt: null,
          kind: "unresolved",
          policyVersion: null,
        },
        grantKind: "purchased",
      }),
    );
    expect(deriveCreditBalanceV1(state, now)).toMatchObject({
      availableUnits: 1_150,
      unresolvedUnits: 50,
    });
  });

  it("separates one-time grant policy identity from expiration and source evidence", () => {
    let state = createEmptyCreditAccountV1("organization_grant-policy");
    state = addGrant(
      state,
      creditGrant("grant_welcome_policy-v1", 150, {
        grantPolicyVersion: "welcome-issuance-v1",
      }),
    );

    expectDomainError(
      () =>
        addGrant(
          state,
          creditGrant("grant_welcome_same-policy", 150, {
            expirationPolicy: {
              expiresAt: "2026-09-01T00:00:00.000Z",
              kind: "expires-at",
              policyVersion: "different-expiration-policy-v2",
            },
            grantPolicyVersion: "welcome-issuance-v1",
          }),
        ),
      "idempotency-conflict",
    );

    state = addGrant(
      state,
      creditGrant("grant_welcome_policy-v2", 150, {
        grantPolicyVersion: "welcome-issuance-v2",
      }),
    );
    expect(state.grants.map((grant) => grant.grantPolicyVersion)).toEqual([
      "welcome-issuance-v1",
      "welcome-issuance-v2",
    ]);

    state = addGrant(
      state,
      creditGrant("grant_promotion_source-v1", 25, {
        grantKind: "promotional",
        grantPolicyVersion: "promotion-issuance-v1",
        sourcePlanVersionId: null,
        sourceReference: "campaign_launch-2026",
      }),
    );
    expectDomainError(
      () =>
        addGrant(
          state,
          creditGrant("grant_promotion_source-v2", 25, {
            grantKind: "promotional",
            grantPolicyVersion: "promotion-issuance-v2",
            sourcePlanVersionId: null,
            sourceReference: "campaign_launch-2026",
          }),
        ),
      "idempotency-conflict",
    );

    expectDomainError(
      () =>
        addGrant(
          state,
          creditGrant("grant_invalid-policy", 1, {
            grantKind: "promotional",
            grantPolicyVersion: "invalid policy version",
            sourcePlanVersionId: null,
          }),
        ),
      "invalid-input",
    );
    expectDomainError(
      () =>
        addGrant(
          state,
          creditGrant("grant_invalid-source", 1, {
            grantKind: "promotional",
            sourcePlanVersionId: null,
            sourceReference: " invalid-source ",
          }),
        ),
      "invalid-input",
    );
  });

  it("reserves the earliest-expiring grants first and rejects sequential overspend", () => {
    let state = createEmptyCreditAccountV1("organization_example_1");
    state = addGrant(state, creditGrant("grant_nonexpiring", 100));
    state = addGrant(
      state,
      creditGrant("grant_expiring", 50, {
        expirationPolicy: {
          expiresAt: "2026-08-04T00:00:00.000Z",
          kind: "expires-at",
          policyVersion: "promotion-v1",
        },
        grantKind: "promotional",
      }),
    );

    const reserved = reserveCreditsV1(state, reservationInput());
    expect(reserved.state.reservations[0]?.allocations).toEqual([
      { grantId: "grant_expiring", units: 50 },
      { grantId: "grant_nonexpiring", units: 10 },
    ]);
    expect(reserveCreditsV1(reserved.state, reservationInput()).replayed).toBe(
      true,
    );
    expect(deriveCreditBalanceV1(reserved.state, now).availableUnits).toBe(90);

    expectDomainError(
      () =>
        reserveCreditsV1(
          reserved.state,
          reservationInput({
            estimatedUnits: 91,
            idempotencyKey: "idem_reservation_2",
            ledgerEventId: "ledger_reservation_2",
            requestId: "request_example_2",
            reservationId: "reservation_example_2",
          }),
        ),
      "insufficient-credits",
    );
  });

  it("treats request IDs as reservation replay identities", () => {
    let state = createEmptyCreditAccountV1("organization_request-replay");
    state = addGrant(state, creditGrant("grant_request-replay", 100));
    const reserved = reserveCreditsV1(state, reservationInput());

    expect(reserveCreditsV1(reserved.state, reservationInput()).replayed).toBe(
      true,
    );
    expectDomainError(
      () =>
        reserveCreditsV1(
          reserved.state,
          reservationInput({
            idempotencyKey: "idem_same-request-new-key",
            ledgerEventId: "ledger_same-request-new-key",
            reservationId: "reservation_same-request-new-key",
          }),
        ),
      "idempotency-conflict",
    );
    expect(deriveCreditBalanceV1(reserved.state, now).availableUnits).toBe(40);
  });

  it("uses one explicit organization shared-credit pool across members and projects", () => {
    let organizationState = createEmptyCreditAccountV1(
      "organization_shared-pool",
    );
    organizationState = addGrant(
      organizationState,
      creditGrant("grant_shared-pool", 100),
    );
    organizationState = reserveCreditsV1(
      organizationState,
      reservationInput({
        actingPrincipalId: "principal_alice",
        estimatedUnits: 60,
        projectId: "project_alpha",
      }),
    ).state;
    organizationState = reserveCreditsV1(
      organizationState,
      reservationInput({
        actingPrincipalId: "principal_bob",
        estimatedUnits: 40,
        idempotencyKey: "idem_reservation_bob",
        jobId: "job_ai_bob",
        ledgerEventId: "ledger_reservation_bob",
        projectId: "project_beta",
        requestId: "request_bob",
        reservationId: "reservation_bob",
      }),
    ).state;

    expect(organizationState.organizationId).toBe("organization_shared-pool");
    expect(
      organizationState.reservations.map((reservation) => ({
        actingPrincipalId: reservation.actingPrincipalId,
        allocations: reservation.allocations,
        projectId: reservation.projectId,
      })),
    ).toEqual([
      {
        actingPrincipalId: "principal_alice",
        allocations: [{ grantId: "grant_shared-pool", units: 60 }],
        projectId: "project_alpha",
      },
      {
        actingPrincipalId: "principal_bob",
        allocations: [{ grantId: "grant_shared-pool", units: 40 }],
        projectId: "project_beta",
      },
    ]);
    expect(deriveCreditBalanceV1(organizationState, now)).toMatchObject({
      activeReservedUnits: 100,
      availableUnits: 0,
    });
    expectDomainError(
      () =>
        reserveCreditsV1(
          organizationState,
          reservationInput({
            actingPrincipalId: "principal_charlie",
            estimatedUnits: 1,
            idempotencyKey: "idem_reservation_charlie",
            ledgerEventId: "ledger_reservation_charlie",
            projectId: "project_gamma",
            requestId: "request_charlie",
            reservationId: "reservation_charlie",
          }),
        ),
      "insufficient-credits",
    );

    const otherOrganization = addGrant(
      createEmptyCreditAccountV1("organization_other"),
      creditGrant("grant_shared-pool", 100),
    );
    expect(deriveCreditBalanceV1(otherOrganization, now).availableUnits).toBe(
      100,
    );
  });

  it("orders expiring and nonexpiring grants by expiration, priority, start, and ID", () => {
    const expiring = (
      grantId: string,
      consumptionPriority: number,
      startsAt: string,
    ): CreditGrantV1 =>
      creditGrant(grantId, 10, {
        consumptionPriority,
        expirationPolicy: {
          expiresAt: "2026-08-04T00:00:00.000Z",
          kind: "expires-at",
          policyVersion: "promotion-v1",
        },
        grantKind: "promotional",
        startsAt,
      });
    const nonexpiring = (
      grantId: string,
      consumptionPriority: number,
      startsAt: string,
    ): CreditGrantV1 =>
      creditGrant(grantId, 10, {
        consumptionPriority,
        grantKind: "promotional",
        sourcePlanVersionId: null,
        startsAt,
      });

    let state = createEmptyCreditAccountV1("organization_ordering");
    for (const grant of [
      nonexpiring("grant_nonexpiring_b", 10, now),
      expiring("grant_expiring_b", 10, now),
      nonexpiring("grant_nonexpiring_priority", 5, now),
      expiring("grant_expiring_early", 10, "2026-08-01T00:00:00.000Z"),
      nonexpiring("grant_nonexpiring_a", 10, now),
      expiring("grant_expiring_priority", 5, now),
      nonexpiring("grant_nonexpiring_early", 10, "2026-08-01T00:00:00.000Z"),
      expiring("grant_expiring_a", 10, now),
    ]) {
      state = addGrant(state, grant);
    }

    const reserved = reserveCreditsV1(
      state,
      reservationInput({ estimatedUnits: 80 }),
    );
    expect(reserved.state.reservations[0]?.allocations).toEqual([
      { grantId: "grant_expiring_priority", units: 10 },
      { grantId: "grant_expiring_early", units: 10 },
      { grantId: "grant_expiring_a", units: 10 },
      { grantId: "grant_expiring_b", units: 10 },
      { grantId: "grant_nonexpiring_priority", units: 10 },
      { grantId: "grant_nonexpiring_early", units: 10 },
      { grantId: "grant_nonexpiring_a", units: 10 },
      { grantId: "grant_nonexpiring_b", units: 10 },
    ]);
  });

  it("partially settles against captured plan/pricing/grants and releases unused units", () => {
    let state = createEmptyCreditAccountV1("organization_example_1");
    state = addGrant(
      state,
      creditGrant("grant_monthly", 100, {
        expirationPolicy: {
          expiresAt: "2026-09-01T00:00:00.000Z",
          kind: "expires-at",
          policyVersion: "monthly-period-v1",
        },
        grantKind: "monthly",
        sourcePlanVersionId: "planver_pro_2026_08_03_v1",
        subscriptionPeriodEnd: "2026-09-01T00:00:00.000Z",
        subscriptionPeriodId: "period_2026_08",
      }),
    );
    state = reserveCreditsV1(state, reservationInput()).state;

    const settlementInput: SettleReservationInputV1 = {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 40,
      customerChargeCreditUnits: 40,
      eventId: "ledger_settlement_1",
      idempotencyKey: "idem_settlement_1",
      occurredAt: later,
      chargingScenario: "proposal-delivered-user-rejected",
      pricingVersion: settlementPricing,
      providerUsage,
      reasonCode: "usage.proposal-delivered",
      reservationId: "reservation_example_1",
    };
    const settled = settleReservationV1(state, settlementInput);
    state = settled.state;
    expect(state.reservations[0]).toMatchObject({
      planVersionId: "planver_pro_2026_08_03_v1",
      pricingVersionId: "pricing_example_1",
      status: "settled",
    });
    expect(
      state.usageEvents.find(
        (event) => event.eventId === "ledger_settlement_1",
      ),
    ).toMatchObject({
      chargingScenario: "proposal-delivered-user-rejected",
      eventKind: "settlement",
      outcome: "useful-output-delivered",
    });
    expect(deriveCreditBalanceV1(state, later)).toMatchObject({
      activeReservedUnits: 0,
      availableUnits: 60,
      settledUnits: 40,
    });
    expect(deriveUsageSummaryV1(state)).toMatchObject({
      byFeature: [
        {
          creditTotals: {
            releasedCreditUnits: 20,
            reservedCreditUnits: 60,
            settledCreditUnits: 40,
          },
          feature: "ai-assisted-operations",
        },
      ],
      creditTotals: {
        releasedCreditUnits: 20,
        reservedCreditUnits: 60,
        settledCreditUnits: 40,
      },
    });
    expect(settleReservationV1(state, settlementInput).replayed).toBe(true);
    expectDomainError(
      () =>
        settleReservationV1(state, {
          ...accountingRecorder,
          ...settlementInput,
          reasonCode: "usage.proposal-replayed",
        }),
      "idempotency-conflict",
    );
  });

  it("rejects settlement and release events before reservation creation", () => {
    let state = createEmptyCreditAccountV1("organization_terminal-ordering");
    state = addGrant(state, creditGrant("grant_terminal-ordering", 100));
    state = reserveCreditsV1(state, reservationInput()).state;
    const beforeReservation = "2026-08-03T11:59:59.999Z";

    expectDomainError(
      () =>
        settleReservationV1(state, {
          ...accountingRecorder,
          actualNormalizedCreditUnits: 40,
          customerChargeCreditUnits: 40,
          eventId: "ledger_settlement_before-reservation",
          idempotencyKey: "idem_settlement_before-reservation",
          occurredAt: beforeReservation,
          chargingScenario: "proposal-delivered-user-rejected",
          pricingVersion: settlementPricing,
          providerUsage,
          reasonCode: "usage.proposal-delivered",
          reservationId: "reservation_example_1",
        }),
      "invalid-input",
    );
    expectDomainError(
      () =>
        releaseReservationV1(state, {
          ...accountingRecorder,
          eventId: "ledger_release_before-reservation",
          idempotencyKey: "idem_release_before-reservation",
          occurredAt: beforeReservation,
          chargingScenario: "user-cancelled-before-invocation",
          pricingVersion: null,
          providerUsage: null,
          reasonCode: "usage.user-cancelled",
          reservationId: "reservation_example_1",
        }),
      "invalid-input",
    );
    expect(state.reservations[0]?.status).toBe("active");
    expect(state.usageEvents).toHaveLength(2);
  });

  it("uses the API technical-identifier boundary for provider request IDs", () => {
    let state = createEmptyCreditAccountV1("organization_provider_request_id");
    state = addGrant(state, creditGrant("grant_provider_request_id", 100));
    state = reserveCreditsV1(
      state,
      reservationInput({
        idempotencyKey: "idem_provider_request_id",
        ledgerEventId: "ledger_provider_request_id_reservation",
        reservationId: "reservation_provider_request_id",
      }),
    ).state;

    const providerRequestId = `provider/${"a".repeat(119)}`;
    expect(providerRequestId).toHaveLength(128);
    const settlementInput: SettleReservationInputV1 = {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 40,
      customerChargeCreditUnits: 40,
      eventId: "ledger_provider_request_id_settlement",
      idempotencyKey: "idem_provider_request_id_settlement",
      occurredAt: later,
      chargingScenario: "proposal-delivered-user-rejected",
      pricingVersion: settlementPricing,
      providerUsage: { ...providerUsage, providerRequestId },
      reasonCode: "usage.proposal-delivered",
      reservationId: "reservation_provider_request_id",
    };
    const settled = settleReservationV1(state, settlementInput);
    expect(
      settled.state.usageEvents.find(
        (event) => event.eventId === settlementInput.eventId,
      )?.providerUsage?.providerRequestId,
    ).toBe(providerRequestId);

    for (const [suffix, invalidProviderRequestId] of [
      ["overlong", "p".repeat(129)],
      ["invalid-character", "provider request"],
    ] as const) {
      expectDomainError(
        () =>
          settleReservationV1(state, {
            ...settlementInput,
            eventId: `ledger_provider_request_id_${suffix}`,
            idempotencyKey: `idem_provider_request_id_${suffix}`,
            providerUsage: {
              ...providerUsage,
              providerRequestId: invalidProviderRequestId,
            },
          }),
        "invalid-input",
      );
    }
  });

  it("uses distinct provider-key and model-identifier boundaries", () => {
    const modelId = `model/${"m".repeat(122)}`;
    const modelVersion = "release/2026-08-03";
    const providerKey = "provider-example";
    expect(modelId).toHaveLength(128);

    let state = createEmptyCreditAccountV1("organization_model_identifiers");
    state = addGrant(state, creditGrant("grant_model_identifiers", 100));
    const fundedState = state;
    state = reserveCreditsV1(
      state,
      reservationInput({
        idempotencyKey: "idem_model_identifiers",
        ledgerEventId: "ledger_model_identifiers_reservation",
        modelId,
        modelVersion,
        providerKey,
        reservationId: "reservation_model_identifiers",
      }),
    ).state;

    const settled = settleReservationV1(state, {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 40,
      customerChargeCreditUnits: 40,
      eventId: "ledger_model_identifiers_settlement",
      idempotencyKey: "idem_model_identifiers_settlement",
      occurredAt: later,
      chargingScenario: "proposal-delivered-user-rejected",
      pricingVersion: {
        ...settlementPricing,
        modelId,
        modelVersion,
        providerKey,
      },
      providerUsage: {
        ...providerUsage,
        modelId,
        modelVersion,
        providerKey,
      },
      reasonCode: "usage.proposal-delivered",
      reservationId: "reservation_model_identifiers",
    });
    expect(settled.state.reservations[0]).toMatchObject({
      modelId,
      modelVersion,
      providerKey,
      status: "settled",
    });

    for (const [suffix, overrides] of [
      ["model-overlong", { modelId: "m".repeat(129) }],
      ["model-space", { modelId: "model name" }],
      ["provider-uppercase", { providerKey: "Provider-example" }],
      ["provider-slash", { providerKey: "provider/example" }],
    ] as const) {
      expectDomainError(
        () =>
          reserveCreditsV1(
            fundedState,
            reservationInput({
              idempotencyKey: `idem_${suffix}`,
              ledgerEventId: `ledger_${suffix}`,
              requestId: `request_${suffix}`,
              reservationId: `reservation_${suffix}`,
              ...overrides,
            }),
          ),
        "invalid-input",
      );
    }
  });

  it("rejects terminal provider usage that differs from reservation evidence", () => {
    let state = createEmptyCreditAccountV1("organization_provider_evidence");
    state = addGrant(state, creditGrant("grant_provider_evidence", 100));
    state = reserveCreditsV1(
      state,
      reservationInput({
        idempotencyKey: "idem_provider_evidence",
        ledgerEventId: "ledger_provider_evidence_reservation",
        reservationId: "reservation_provider_evidence",
      }),
    ).state;

    expectDomainError(
      () =>
        settleReservationV1(state, {
          ...accountingRecorder,
          actualNormalizedCreditUnits: 40,
          customerChargeCreditUnits: 40,
          eventId: "ledger_provider_evidence_settlement",
          idempotencyKey: "idem_provider_evidence_settlement",
          occurredAt: later,
          chargingScenario: "proposal-delivered-user-rejected",
          pricingVersion: settlementPricing,
          providerUsage: {
            ...providerUsage,
            modelVersion: "2026-08-02",
          },
          reasonCode: "usage.proposal-delivered",
          reservationId: "reservation_provider_evidence",
        }),
      "invalid-input",
    );
    expectDomainError(
      () =>
        releaseReservationV1(state, {
          ...accountingRecorder,
          eventId: "ledger_provider_evidence_release",
          idempotencyKey: "idem_provider_evidence_release",
          occurredAt: later,
          chargingScenario: "provider-failure-before-useful-output",
          pricingVersion: settlementPricing,
          providerUsage: {
            ...providerUsage,
            providerKey: "different-provider",
          },
          reasonCode: "provider.failure",
          reservationId: "reservation_provider_evidence",
        }),
      "invalid-input",
    );
  });

  it("keeps an active reservation valid across plan change and grant expiry", () => {
    const planChangeNow = "2026-08-14T12:00:00.000Z";
    const planChangeLater = "2026-08-14T13:00:00.000Z";
    const priorPlan = getBetaPlanVersion("pro", planChangeNow);
    const replacementPlan: PlanVersionV1 = {
      ...priorPlan,
      effectiveFrom: "2026-08-14T12:30:00.000Z",
      planVersionId: "planver_pro_2026_08_14_v3",
    };
    const versions = BETA_PLAN_VERSIONS_V1 as unknown as PlanVersionV1[];
    const initialLength = versions.length;
    versions.push(replacementPlan);
    try {
      let state = createEmptyCreditAccountV1("organization_plan-change");
      state = addGrant(
        state,
        creditGrant("grant_expiring_during-work", 100, {
          expirationPolicy: {
            expiresAt: "2026-08-14T12:30:00.000Z",
            kind: "expires-at",
            policyVersion: "promotion-v1",
          },
          createdAt: planChangeNow,
          grantKind: "promotional",
          startsAt: planChangeNow,
        }),
      );
      state = reserveCreditsV1(
        state,
        reservationInput({
          createdAt: planChangeNow,
          estimatedUnits: 60,
          expiresAt: "2026-08-14T14:00:00.000Z",
          planVersionId: priorPlan.planVersionId,
        }),
      ).state;

      expect(getBetaPlanVersion("pro", planChangeLater).planVersionId).toBe(
        replacementPlan.planVersionId,
      );
      expect(deriveCreditBalanceV1(state, planChangeLater)).toMatchObject({
        activeReservedUnits: 60,
        availableUnits: 0,
        expiredUnusedUnits: 40,
      });

      state = settleReservationV1(state, {
        ...accountingRecorder,
        actualNormalizedCreditUnits: 40,
        customerChargeCreditUnits: 40,
        eventId: "ledger_settlement_after-change",
        idempotencyKey: "idem_settlement_after-change",
        occurredAt: planChangeLater,
        chargingScenario: "proposal-delivered-user-rejected",
        pricingVersion: settlementPricing,
        providerUsage,
        reasonCode: "usage.proposal-delivered",
        reservationId: "reservation_example_1",
      }).state;
      expect(state.reservations[0]).toMatchObject({
        planVersionId: priorPlan.planVersionId,
        status: "settled",
      });
      expect(
        state.usageEvents.find(
          (event) => event.eventId === "ledger_settlement_after-change",
        )?.planVersionId,
      ).toBe(priorPlan.planVersionId);
      expect(deriveCreditBalanceV1(state, planChangeLater)).toMatchObject({
        activeReservedUnits: 0,
        expiredUnusedUnits: 60,
        settledUnits: 40,
      });
    } finally {
      versions.splice(initialLength);
    }
  });

  it("releases and expires reservations without consuming grants", () => {
    let state = createEmptyCreditAccountV1("organization_example_1");
    state = addGrant(state, creditGrant("grant_available", 100));
    state = reserveCreditsV1(state, reservationInput()).state;
    const releaseInput: CloseReservationInputV1 = {
      ...accountingRecorder,
      eventId: "ledger_release_1",
      idempotencyKey: "idem_release_1",
      occurredAt: later,
      chargingScenario: "provider-failure-before-useful-output",
      pricingVersion: settlementPricing,
      providerUsage,
      reasonCode: "provider.failure-before-useful-output",
      reservationId: "reservation_example_1",
    };
    state = releaseReservationV1(state, releaseInput).state;
    expect(deriveCreditBalanceV1(state, later).availableUnits).toBe(100);
    const usageSummary = deriveUsageSummaryV1(state);
    expect(usageSummary.providerFailureRequests).toBe(1);
    expect(usageSummary.releasedReservations).toBe(1);

    state = reserveCreditsV1(
      state,
      reservationInput({
        estimatedUnits: 25,
        expiresAt: "2026-08-03T14:00:00.000Z",
        idempotencyKey: "idem_reservation_2",
        ledgerEventId: "ledger_reservation_2",
        requestId: "request_example_2",
        reservationId: "reservation_example_2",
      }),
    ).state;
    expectDomainError(
      () =>
        expireReservationV1(state, {
          ...accountingRecorder,
          eventId: "ledger_expire_early",
          idempotencyKey: "idem_expire_early",
          occurredAt: later,
          chargingScenario: null,
          pricingVersion: null,
          providerUsage: null,
          reasonCode: "reservation.expired",
          reservationId: "reservation_example_2",
        }),
      "invalid-input",
    );
    state = expireReservationV1(state, {
      ...accountingRecorder,
      eventId: "ledger_expire_2",
      idempotencyKey: "idem_expire_2",
      occurredAt: "2026-08-03T14:00:00.000Z",
      chargingScenario: null,
      pricingVersion: null,
      providerUsage: null,
      reasonCode: "reservation.expired",
      reservationId: "reservation_example_2",
    }).state;
    expect(
      state.usageEvents.find((event) => event.eventId === "ledger_expire_2"),
    ).toMatchObject({
      chargingScenario: null,
      eventKind: "expiration",
      outcome: "expired",
    });
    expect(
      deriveCreditBalanceV1(state, "2026-08-03T14:00:00.000Z").availableUnits,
    ).toBe(100);
  });

  it("rejects duplicate usage-event identities across terminal transitions", () => {
    let state = createEmptyCreditAccountV1("organization_duplicate-events");
    state = addGrant(state, creditGrant("grant_duplicate-events", 200));
    state = reserveCreditsV1(
      state,
      reservationInput({ estimatedUnits: 50 }),
    ).state;
    state = reserveCreditsV1(
      state,
      reservationInput({
        estimatedUnits: 50,
        idempotencyKey: "idem_reservation_2",
        ledgerEventId: "ledger_reservation_2",
        requestId: "request_example_2",
        reservationId: "reservation_example_2",
      }),
    ).state;
    state = settleReservationV1(state, {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 40,
      customerChargeCreditUnits: 40,
      eventId: "ledger_terminal_shared",
      idempotencyKey: "idem_settlement_1",
      occurredAt: later,
      chargingScenario: "proposal-delivered-user-rejected",
      pricingVersion: settlementPricing,
      providerUsage,
      reasonCode: "usage.proposal-delivered",
      reservationId: "reservation_example_1",
    }).state;

    expectDomainError(
      () =>
        settleReservationV1(state, {
          ...accountingRecorder,
          actualNormalizedCreditUnits: 40,
          customerChargeCreditUnits: 40,
          eventId: "ledger_terminal_shared",
          idempotencyKey: "idem_settlement_2",
          occurredAt: later,
          chargingScenario: "proposal-delivered-user-rejected",
          pricingVersion: settlementPricing,
          providerUsage,
          reasonCode: "usage.proposal-delivered",
          reservationId: "reservation_example_2",
        }),
      "duplicate-identity",
    );
  });

  it("models a monthly reset as a new expiring grant instead of a mutable balance", () => {
    let state = createEmptyCreditAccountV1("organization_example_1");
    state = addGrant(
      state,
      creditGrant("grant_august", 1_000, {
        expirationPolicy: {
          expiresAt: "2026-09-01T00:00:00.000Z",
          kind: "expires-at",
          policyVersion: "monthly-period-v1",
        },
        grantKind: "monthly",
        idempotencyKey: "idem_period_august",
        subscriptionPeriodEnd: "2026-09-01T00:00:00.000Z",
        subscriptionPeriodId: "period_august",
      }),
    );
    state = addGrant(
      state,
      creditGrant("grant_september", 1_000, {
        createdAt: "2026-09-01T00:00:00.000Z",
        expirationPolicy: {
          expiresAt: "2026-10-01T00:00:00.000Z",
          kind: "expires-at",
          policyVersion: "monthly-period-v1",
        },
        grantKind: "monthly",
        idempotencyKey: "idem_period_september",
        startsAt: "2026-09-01T00:00:00.000Z",
        subscriptionPeriodEnd: "2026-10-01T00:00:00.000Z",
        subscriptionPeriodId: "period_september",
      }),
    );
    expect(
      deriveCreditBalanceV1(state, "2026-09-01T00:00:00.000Z"),
    ).toMatchObject({ availableUnits: 1_000, expiredUnusedUnits: 1_000 });
  });

  it("rejects aggregate balance and usage totals outside the safe integer range", () => {
    let balanceState = createEmptyCreditAccountV1("organization_overflow");
    balanceState = addGrant(
      balanceState,
      creditGrant("grant_max-safe", Number.MAX_SAFE_INTEGER),
    );
    balanceState = addGrant(
      balanceState,
      creditGrant("grant_overflow-one", 1, {
        grantKind: "promotional",
        sourcePlanVersionId: null,
      }),
    );
    expectDomainError(
      () => deriveCreditBalanceV1(balanceState, now),
      "invalid-input",
    );

    let usageState = createEmptyCreditAccountV1("organization_usage-overflow");
    const overflowPricing = {
      ...settlementPricing,
      cachedInputTokenMicrosPerMillion: 0,
      inputTokenMicrosPerMillion: Number.MAX_SAFE_INTEGER,
      outputTokenMicrosPerMillion: 0,
      pricingVersionId: "pricing_overflow_1",
    } satisfies ProviderPricingVersionV1;
    const unitPricing = {
      ...settlementPricing,
      cachedInputTokenMicrosPerMillion: 0,
      inputTokenMicrosPerMillion: 1,
      outputTokenMicrosPerMillion: 0,
      pricingVersionId: "pricing_overflow_2",
    } satisfies ProviderPricingVersionV1;
    usageState = addGrant(
      usageState,
      creditGrant("grant_usage-overflow", Number.MAX_SAFE_INTEGER),
    );
    usageState = reserveCreditsV1(
      usageState,
      reservationInput({
        estimatedUnits: 1,
        pricingVersionId: overflowPricing.pricingVersionId,
      }),
    ).state;
    usageState = reserveCreditsV1(
      usageState,
      reservationInput({
        estimatedUnits: 1,
        idempotencyKey: "idem_reservation_overflow_2",
        ledgerEventId: "ledger_reservation_overflow_2",
        pricingVersionId: unitPricing.pricingVersionId,
        requestId: "request_overflow_2",
        reservationId: "reservation_overflow_2",
      }),
    ).state;
    usageState = releaseReservationV1(usageState, {
      ...accountingRecorder,
      eventId: "ledger_release_overflow_1",
      idempotencyKey: "idem_release_overflow_1",
      occurredAt: later,
      chargingScenario: "provider-failure-before-useful-output",
      pricingVersion: overflowPricing,
      providerUsage: {
        ...providerUsage,
        cachedInputTokens: 0,
        estimatedProviderCostMicros: Number.MAX_SAFE_INTEGER,
        inputTokens: 1_000_000,
        outputTokens: 0,
        providerRequestId: "provider_request_overflow_1",
      },
      reasonCode: "provider.failure-before-useful-output",
      reservationId: "reservation_example_1",
    }).state;
    usageState = releaseReservationV1(usageState, {
      ...accountingRecorder,
      eventId: "ledger_release_overflow_2",
      idempotencyKey: "idem_release_overflow_2",
      occurredAt: later,
      chargingScenario: "provider-failure-before-useful-output",
      pricingVersion: unitPricing,
      providerUsage: {
        ...providerUsage,
        cachedInputTokens: 0,
        estimatedProviderCostMicros: 1,
        inputTokens: 1_000_000,
        outputTokens: 0,
        providerRequestId: "provider_request_overflow_2",
      },
      reasonCode: "provider.failure-before-useful-output",
      reservationId: "reservation_overflow_2",
    }).state;
    expectDomainError(
      () => deriveProviderCostReconciliationV1(usageState),
      "invalid-input",
    );
  });

  it("uses append-only administrative grants/debits for compensation and preserves provider cost", () => {
    let state = createEmptyCreditAccountV1("organization_example_1");
    state = addGrant(state, creditGrant("grant_original", 100));
    state = reserveCreditsV1(
      state,
      reservationInput({ estimatedUnits: 40 }),
    ).state;
    state = settleReservationV1(state, {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 40,
      customerChargeCreditUnits: 40,
      eventId: "ledger_settlement_1",
      idempotencyKey: "idem_settlement_1",
      occurredAt: later,
      chargingScenario: "system-required-repair",
      pricingVersion: settlementPricing,
      providerUsage,
      reasonCode: "usage.internal-failure-reconciled",
      reservationId: "reservation_example_1",
    }).state;
    state = addGrant(
      state,
      creditGrant("grant_compensation", 40, {
        grantKind: "administrative",
        idempotencyKey: "idem_compensation_1",
        sourcePlanVersionId: null,
      }),
      "principal_platform_admin",
      "ledger_settlement_1",
    );
    expect(deriveCreditBalanceV1(state, later)).toMatchObject({
      availableUnits: 100,
      compensatedCreditUnits: 40,
      debitAdjustmentCreditUnits: 0,
      netAdjustmentCreditUnits: 40,
    });
    expect(deriveUsageSummaryV1(state)).toMatchObject({
      compensatedCreditUnits: 40,
      creditTotals: {
        compensatedCreditUnits: 40,
        debitAdjustmentCreditUnits: 0,
        netAdjustmentCreditUnits: 40,
        settledCreditUnits: 40,
      },
      releasedReservations: 0,
      settledCreditUnits: 40,
      settledRequests: 1,
    });
    expect(
      state.usageEvents.find(
        (event) =>
          event.eventKind === "adjustment" &&
          event.customerCreditEffectUnits > 0,
      ),
    ).toMatchObject({
      actingPrincipalId: null,
      allocations: [{ grantId: "grant_compensation", units: 40 }],
      chargingScenario: null,
      grantId: null,
      outcome: "compensated",
      recordedByActorId: "principal_platform_admin",
      recordedByActorKind: "internal-administration",
    });

    const debited = applyDebitAdjustmentV1(state, {
      actingAdministratorId: "principal_platform_admin",
      eventId: "ledger_adjustment_debit_1",
      idempotencyKey: "idem_adjustment_debit_1",
      occurredAt: later,
      reasonCode: "adjustment.operator-correction",
      recordedByActorId: "principal_platform_admin",
      recordedByActorKind: "internal-administration",
      relatedUsageEventId: "ledger_settlement_1",
      units: 10,
    });
    expect(deriveCreditBalanceV1(debited.state, later)).toMatchObject({
      availableUnits: 90,
      compensatedCreditUnits: 40,
      debitAdjustmentCreditUnits: 10,
      netAdjustmentCreditUnits: 30,
      settledUnits: 40,
    });
    expect(deriveUsageSummaryV1(debited.state)).toMatchObject({
      compensatedCreditUnits: 40,
      creditTotals: {
        debitAdjustmentCreditUnits: 10,
        netAdjustmentCreditUnits: 30,
      },
      settledCreditUnits: 40,
      settledRequests: 1,
    });
    expect(
      debited.state.usageEvents.find(
        (event) =>
          event.eventKind === "adjustment" &&
          event.customerCreditEffectUnits < 0,
      ),
    ).toMatchObject({
      chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
      outcome: "adjusted",
      relatedUsageEventId: "ledger_settlement_1",
    });
    expect(
      applyDebitAdjustmentV1(debited.state, {
        actingAdministratorId: "principal_platform_admin",
        eventId: "ledger_adjustment_debit_1",
        idempotencyKey: "idem_adjustment_debit_1",
        occurredAt: later,
        reasonCode: "adjustment.operator-correction",
        recordedByActorId: "principal_platform_admin",
        recordedByActorKind: "internal-administration",
        relatedUsageEventId: "ledger_settlement_1",
        units: 10,
      }).replayed,
    ).toBe(true);
    expect(
      debited.state.usageEvents.find(
        (event) => event.eventId === "ledger_settlement_1",
      )?.providerUsage,
    ).toEqual(providerUsage);
  });

  it("pins charging policy and trusted recorder evidence across replay", () => {
    let state = addGrant(
      createEmptyCreditAccountV1("organization_policy-pin"),
      creditGrant("grant_policy-pin", 100),
    );
    expectDomainError(
      () =>
        reserveCreditsV1(
          state,
          reservationInput({
            chargingPolicyVersion: "cloudmarkup-charging-and-failure-v2",
          }),
        ),
      "invalid-input",
    );
    expectDomainError(
      () =>
        reserveCreditsV1(
          state,
          reservationInput({
            recordedByActorId: "principal_someone-else",
            recordedByActorKind: "principal",
          }),
        ),
      "invalid-input",
    );

    state = reserveCreditsV1(state, reservationInput()).state;
    expect(state.reservations[0]).toMatchObject({
      chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
    });
    expect(
      state.usageEvents.find((event) => event.eventKind === "reservation"),
    ).toMatchObject({
      chargingScenario: null,
      chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
      outcome: "reserved",
      recordedByActorId: accountingRecorder.recordedByActorId,
      recordedByActorKind: accountingRecorder.recordedByActorKind,
    });
    expectDomainError(
      () =>
        reserveCreditsV1(
          state,
          reservationInput({ recordedByActorId: "worker_other-accounting" }),
        ),
      "idempotency-conflict",
    );
  });

  it("uses typed outcomes and effective immutable pricing to govern terminal transitions", () => {
    let state = addGrant(
      createEmptyCreditAccountV1("organization_terminal-policy"),
      creditGrant("grant_terminal-policy", 100),
    );
    state = reserveCreditsV1(state, reservationInput()).state;
    const settlement: SettleReservationInputV1 = {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 40,
      customerChargeCreditUnits: 40,
      eventId: "ledger_terminal-policy-settlement",
      idempotencyKey: "idem_terminal-policy-settlement",
      occurredAt: later,
      chargingScenario: "proposal-delivered-user-rejected",
      pricingVersion: settlementPricing,
      providerUsage,
      reasonCode: "usage.proposal-delivered",
      reservationId: "reservation_example_1",
    };

    expectDomainError(
      () =>
        settleReservationV1(state, {
          ...settlement,
          chargingScenario: "provider-failure-before-useful-output",
        }),
      "invalid-input",
    );
    expectDomainError(
      () =>
        settleReservationV1(state, {
          ...settlement,
          pricingVersion: {
            ...settlementPricing,
            pricingVersionId: "pricing_mismatch",
          },
        }),
      "invalid-input",
    );
    expectDomainError(
      () =>
        settleReservationV1(state, {
          ...settlement,
          pricingVersion: {
            ...settlementPricing,
            effectiveFrom: later,
          },
        }),
      "invalid-input",
    );
    expect(
      expectDomainError(
        () =>
          settleReservationV1(state, {
            ...settlement,
            actualNormalizedCreditUnits: 39,
            customerChargeCreditUnits: 39,
          }),
        "invalid-input",
      ).message,
    ).toBe("Actual normalized units must equal deterministic provider usage.");
    expectDomainError(
      () =>
        releaseReservationV1(state, {
          ...accountingRecorder,
          eventId: "ledger_provider-failure-without-evidence",
          idempotencyKey: "idem_provider-failure-without-evidence",
          occurredAt: later,
          chargingScenario: "provider-failure-before-useful-output",
          pricingVersion: null,
          providerUsage: null,
          reasonCode: "provider.failure-before-useful-output",
          reservationId: "reservation_example_1",
        }),
      "invalid-input",
    );
    expectDomainError(
      () =>
        releaseReservationV1(state, {
          ...accountingRecorder,
          eventId: "ledger_chargeable-release",
          idempotencyKey: "idem_chargeable-release",
          occurredAt: later,
          chargingScenario: "proposal-delivered-user-rejected",
          pricingVersion: settlementPricing,
          providerUsage,
          reasonCode: "usage.proposal-delivered",
          reservationId: "reservation_example_1",
        }),
      "invalid-input",
    );

    const failureInput: CloseReservationInputV1 = {
      ...accountingRecorder,
      eventId: "ledger_terminal-provider-failure",
      idempotencyKey: "idem_terminal-provider-failure",
      occurredAt: later,
      chargingScenario: "provider-failure-before-useful-output",
      pricingVersion: settlementPricing,
      providerUsage,
      reasonCode: "provider.failure-before-useful-output",
      reservationId: "reservation_example_1",
    };
    state = releaseReservationV1(state, failureInput).state;
    expect(releaseReservationV1(state, failureInput).replayed).toBe(true);
    expect(
      state.usageEvents.find((event) => event.eventId === failureInput.eventId),
    ).toMatchObject({
      chargingScenario: "provider-failure-before-useful-output",
      eventKind: "provider-failure",
      outcome: "provider-failure",
    });
  });

  it("bounds system-repair customer charge while preserving higher provider usage", () => {
    let state = addGrant(
      createEmptyCreditAccountV1("organization_bounded-repair"),
      creditGrant("grant_bounded-repair", 100),
    );
    state = reserveCreditsV1(state, reservationInput()).state;
    const higherProviderUsage: ProviderUsageMetricsV1 = {
      ...providerUsage,
      cachedInputTokens: 50,
      estimatedProviderCostMicros: 240_000,
      inputTokens: 2_000,
      outputTokens: 500,
      providerRequestId: "provider_request_bounded-repair",
    };
    state = settleReservationV1(state, {
      ...accountingRecorder,
      actualNormalizedCreditUnits: 80,
      customerChargeCreditUnits: 60,
      eventId: "ledger_bounded-repair",
      idempotencyKey: "idem_bounded-repair",
      occurredAt: later,
      chargingScenario: "system-required-repair",
      pricingVersion: settlementPricing,
      providerUsage: higherProviderUsage,
      reasonCode: "usage.system-required-repair",
      reservationId: "reservation_example_1",
    }).state;

    expect(deriveCreditBalanceV1(state, later)).toMatchObject({
      availableUnits: 40,
      settledUnits: 60,
    });
    expect(deriveUsageSummaryV1(state)).toMatchObject({
      creditTotals: {
        releasedCreditUnits: 0,
        settledCreditUnits: 60,
      },
    });
    expect(
      state.usageEvents.find(
        (event) => event.eventId === "ledger_bounded-repair",
      )?.providerUsage,
    ).toEqual(higherProviderUsage);
  });

  it("releases after grant expiry without reviving availability", () => {
    let state = addGrant(
      createEmptyCreditAccountV1("organization_late-release"),
      creditGrant("grant_late-release", 100, {
        expirationPolicy: {
          expiresAt: "2026-08-03T12:30:00.000Z",
          kind: "expires-at",
          policyVersion: "promotion-v1",
        },
        grantKind: "promotional",
        sourcePlanVersionId: null,
      }),
    );
    state = reserveCreditsV1(state, reservationInput()).state;
    state = releaseReservationV1(state, {
      ...accountingRecorder,
      eventId: "ledger_late-release",
      idempotencyKey: "idem_late-release",
      occurredAt: later,
      chargingScenario: "user-cancelled-before-invocation",
      pricingVersion: null,
      providerUsage: null,
      reasonCode: "usage.user-cancelled",
      reservationId: "reservation_example_1",
    }).state;
    expect(
      state.usageEvents.find(
        (event) => event.eventId === "ledger_late-release",
      ),
    ).toMatchObject({
      chargingScenario: "user-cancelled-before-invocation",
      eventKind: "release",
      outcome: "canceled",
    });

    expect(deriveCreditBalanceV1(state, later)).toMatchObject({
      availableUnits: 0,
      expiredUnusedUnits: 100,
    });
  });

  it("keeps provider cost on technical events and out of aggregate summaries", () => {
    let state = addGrant(
      createEmptyCreditAccountV1("organization_multi-currency"),
      creditGrant("grant_multi-currency", 200),
    );
    state = reserveCreditsV1(state, reservationInput()).state;
    state = releaseReservationV1(state, {
      ...accountingRecorder,
      eventId: "ledger_currency-usd",
      idempotencyKey: "idem_currency-usd",
      occurredAt: later,
      chargingScenario: "provider-failure-before-useful-output",
      pricingVersion: settlementPricing,
      providerUsage,
      reasonCode: "provider.failure-before-useful-output",
      reservationId: "reservation_example_1",
    }).state;
    const euroPricing: ProviderPricingVersionV1 = {
      ...settlementPricing,
      currencyCode: "EUR",
      pricingVersionId: "pricing_example_eur",
    };
    state = reserveCreditsV1(
      state,
      reservationInput({
        idempotencyKey: "idem_currency-eur-reservation",
        ledgerEventId: "ledger_currency-eur-reservation",
        pricingVersionId: euroPricing.pricingVersionId,
        requestId: "request_currency-eur",
        reservationId: "reservation_currency-eur",
      }),
    ).state;
    state = releaseReservationV1(state, {
      ...accountingRecorder,
      eventId: "ledger_currency-eur",
      idempotencyKey: "idem_currency-eur",
      occurredAt: later,
      chargingScenario: "provider-failure-before-useful-output",
      pricingVersion: euroPricing,
      providerUsage: { ...providerUsage, providerCostCurrency: "EUR" },
      reasonCode: "provider.failure-before-useful-output",
      reservationId: "reservation_currency-eur",
    }).state;

    expect(deriveProviderCostReconciliationV1(state)).toEqual([
      { currency: "EUR", estimatedCostMicros: 120_000 },
      { currency: "USD", estimatedCostMicros: 120_000 },
    ]);
    expect(deriveUsageSummaryV1(state)).not.toHaveProperty(
      "providerCostTotals",
    );
  });
});

describe("pricing and failure policy", () => {
  const pricing: ProviderPricingVersionV1 = {
    cachedInputTokenMicrosPerMillion: 500_000,
    commercialDomainVersion: COMMERCIAL_DOMAIN_VERSION,
    creditConversionDenominator: 100_000,
    creditConversionNumerator: 1,
    currencyCode: "USD",
    effectiveFrom: now,
    effectiveUntil: null,
    inputTokenMicrosPerMillion: 2_000_000,
    modelId: "model_example_1",
    modelVersion: "2026-08-01",
    outputTokenMicrosPerMillion: 4_000_000,
    pricingVersionId: "pricing_example_1",
    providerKey: "example-provider",
  };

  it("normalizes provider metrics using integer micros and exposes only credit ranges", () => {
    expect(
      normalizeProviderUsageV1(pricing, {
        cachedInputTokens: 0,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toEqual({
      creditUnits: 60,
      estimatedProviderCostMicros: 6_000_000,
      providerCostCurrency: "USD",
      pricingVersionId: "pricing_example_1",
    });
    expect(
      estimateCreditRangeV1(
        pricing,
        { cachedInputTokens: 0, inputTokens: 10, outputTokens: 10 },
        { cachedInputTokens: 0, inputTokens: 1_000, outputTokens: 1_000 },
      ),
    ).toEqual({
      maximumCreditUnits: 1,
      minimumCreditUnits: 1,
      pricingVersionId: "pricing_example_1",
    });
  });

  it("maps every charging scenario to a separate technical ledger outcome", () => {
    expect(CHARGING_POLICY_SCENARIOS).toBe(USAGE_OUTCOMES);
    expect(Object.keys(CHARGING_SCENARIO_TECHNICAL_OUTCOME_V1).sort()).toEqual(
      [...USAGE_OUTCOMES].sort(),
    );
    expect(CHARGING_SCENARIO_TECHNICAL_OUTCOME_V1).toEqual({
      "automatic-retry": null,
      "cloudmarkup-internal-failure": "internal-failure",
      "insufficient-credits": null,
      "proposal-delivered-user-rejected": "useful-output-delivered",
      "provider-failure-before-useful-output": "provider-failure",
      "request-rejected-before-invocation": null,
      "system-required-repair": "useful-output-delivered",
      "user-cancelled-before-invocation": "canceled",
      "user-requested-redesign": null,
    });
    for (const scenario of CHARGING_POLICY_SCENARIOS) {
      expect(technicalUsageOutcomeForChargingScenarioV1(scenario)).toBe(
        CHARGING_SCENARIO_TECHNICAL_OUTCOME_V1[scenario],
      );
    }
    expect(TECHNICAL_USAGE_OUTCOMES).toEqual([
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
    expectDomainError(
      () => technicalUsageOutcomeForChargingScenarioV1("unsupported"),
      "invalid-input",
    );
  });

  it("classifies every outcome through one immutable versioned charging policy", () => {
    expect(Object.keys(USAGE_DISPOSITION_POLICY_V1).sort()).toEqual(
      [...USAGE_OUTCOMES].sort(),
    );
    for (const outcome of USAGE_OUTCOMES) {
      expect(decideUsageDispositionV1(outcome).policyVersion).toBe(
        USAGE_DISPOSITION_POLICY_VERSION,
      );
    }
    expect(
      decideUsageDispositionV1("request-rejected-before-invocation"),
    ).toMatchObject({
      action: "no-charge",
      customerNetCharge: "zero",
      policyVersion: USAGE_DISPOSITION_POLICY_VERSION,
    });
    expect(
      decideUsageDispositionV1("provider-failure-before-useful-output"),
    ).toEqual({
      action: "release",
      customerNetCharge: "zero",
      policyVersion: USAGE_DISPOSITION_POLICY_VERSION,
      preserveProviderUsage: true,
    });
    expect(
      decideUsageDispositionV1("proposal-delivered-user-rejected"),
    ).toMatchObject({ action: "settle-actual", customerNetCharge: "actual" });
    expect(decideUsageDispositionV1("user-requested-redesign").action).toBe(
      "new-metered-operation",
    );
    expect(decideUsageDispositionV1("automatic-retry").action).toBe(
      "idempotent-replay",
    );
    expect(decideUsageDispositionV1("system-required-repair")).toEqual({
      action: "settle-and-compensate-to-estimate",
      customerNetCharge: "bounded-by-estimate",
      policyVersion: USAGE_DISPOSITION_POLICY_VERSION,
      preserveProviderUsage: true,
    });
  });
});
