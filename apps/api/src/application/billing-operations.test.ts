import { describe, expect, it, vi } from "vitest";

import {
  BillingOperationsError,
  BillingReconciliationCoordinator,
  ControlledBetaBillingOperations,
  reconcileBillingUsageV1,
  type BillingOperationsAuditSink,
  type BillingOperationsPort,
  type BillingReconciliationSnapshot,
  type BillingReconciliationSnapshotPort,
  type BillingSupportActor,
  type SafeBillingProjectionView,
  type SafeBillingUsageView,
} from "./billing-operations.js";

function snapshot(
  overrides: Partial<BillingReconciliationSnapshot> = {},
): BillingReconciliationSnapshot {
  return {
    asOf: "2026-08-28T12:00:00.000Z",
    balances: {
      adjustmentCreditUnits: 0,
      availableCreditUnits: -1,
      grantedCreditUnits: 100,
      reservedCreditUnits: 50,
      settledCreditUnits: 101,
    },
    configuredRoutes: [
      {
        maximumBasisPoints: 10_000,
        minimumBasisPoints: 5_000,
        route: "standard",
      },
    ],
    grants: [],
    organizationId: "organization_beta",
    planMapping: {
      actualMonthlyCreditUnits: 999,
      expectedMonthlyCreditUnits: 200,
      planKey: "starter",
      planMappingVersion: "starter-pro-mapping-v1",
    },
    providerAggregate: {
      confidence: "aggregate",
      estimatedCostMicros: 999,
      periodEndsAt: "2026-09-01T00:00:00.000Z",
      periodStartsAt: "2026-08-01T00:00:00.000Z",
      providerKey: "amazon-bedrock",
      sourceReference: "aws-aggregate-2026-08",
    },
    reservations: [
      {
        expiresAt: "2026-08-28T11:00:00.000Z",
        reservationId: "reservation_expired",
        status: "active",
      },
      {
        expiresAt: "2026-08-28T13:00:00.000Z",
        reservationId: "reservation_open",
        status: "active",
      },
    ],
    subscriptionPeriod: {
      endsAt: "2026-09-01T00:00:00.000Z",
      periodId: "period_august",
      startsAt: "2026-08-01T00:00:00.000Z",
    },
    thresholds: {
      maximumProviderCostMicrosPerRequest: 100,
      maximumRepairCostMicrosPerRequest: 50,
    },
    usage: [
      {
        attemptKind: "repair",
        compensationState: "not-required",
        providerCostMicros: 200,
        providerRequestId: "provider_request_duplicate",
        reservationId: "reservation_expired",
        route: "repair",
        settlementState: "settled",
        usageRecordId: "usage_one",
      },
      {
        attemptKind: "automatic-retry",
        compensationState: "pending",
        providerCostMicros: 100,
        providerRequestId: "provider_request_duplicate",
        reservationId: "reservation_open",
        route: "deep",
        settlementState: "open",
        usageRecordId: "usage_two",
      },
      {
        attemptKind: "primary",
        compensationState: "not-required",
        providerCostMicros: 0,
        providerRequestId: null,
        reservationId: "reservation_missing_usage",
        route: "low-cost",
        settlementState: "settled",
        usageRecordId: "usage_three",
      },
    ],
    ...overrides,
  };
}

describe("controlled-beta billing reconciliation", () => {
  it.each([
    ["planver_pro_2026_09_12_v4", 1000, false],
    ["planver_pro_2026_09_30_v5", 1250, false],
    ["planver_unknown", 1250, true],
  ] as const)(
    "reconciles canonical period plan %s after configuration advances",
    (planVersionId, units, mismatch) => {
      const report = reconcileBillingUsageV1(
        snapshot({
          planMapping: {
            planMappingVersion:
              "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4",
            planVersionId,
            planKey: "pro",
            actualMonthlyCreditUnits: units,
            expectedMonthlyCreditUnits: units,
          },
        }),
      );
      expect(
        report.findings.some(
          (finding) => finding.code === "starter-pro-mapping-mismatch",
        ),
      ).toBe(mismatch);
    },
  );

  it.each([
    ["cloudmarkup-starter-pro-export-mapping-2026-09-12-v3", 1000],
    ["cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4", 1250],
  ] as const)(
    "reconciles the approved Pro allowance for %s",
    (planMappingVersion, units) => {
      const report = reconcileBillingUsageV1(
        snapshot({
          planMapping: {
            planMappingVersion,
            planKey: "pro",
            actualMonthlyCreditUnits: units,
            expectedMonthlyCreditUnits: units,
          },
        }),
      );
      expect(
        report.findings.some(
          (finding) => finding.code === "starter-pro-mapping-mismatch",
        ),
      ).toBe(false);
    },
  );
  it.each([
    "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
    "cloudmarkup-starter-pro-sharing-mapping-2026-09-07-v2",
  ])(
    "recognizes reviewed unchanged credit allocation for %s",
    (planMappingVersion) => {
      const report = reconcileBillingUsageV1(
        snapshot({
          planMapping: {
            planMappingVersion,
            planKey: "starter",
            actualMonthlyCreditUnits: 200,
            expectedMonthlyCreditUnits: 200,
          },
        }),
      );
      expect(
        report.findings.some(
          (finding) => finding.code === "starter-pro-mapping-mismatch",
        ),
      ).toBe(false);
    },
  );
  it("reports negative or impossible balances and every unsafe mapping, aggregate, route, repair, grant, and reservation state with source confidence", () => {
    const first = reconcileBillingUsageV1(snapshot());
    const second = reconcileBillingUsageV1(snapshot());
    const codes = new Set(first.findings.map((finding) => finding.code));

    expect(codes).toEqual(
      new Set([
        "open-reservation",
        "expired-open-reservation",
        "duplicate-usage",
        "missing-usage",
        "provider-usage-without-settlement",
        "provider-aggregate-ledger-mismatch",
        "missing-monthly-grant",
        "negative-or-impossible-balance",
        "outlier-usage",
        "starter-pro-mapping-mismatch",
        "pending-compensation",
        "route-distribution-outlier",
        "repair-cost-outlier",
      ]),
    );
    expect(first).toEqual(second);
    for (const balances of [
      {
        availableCreditUnits: -1,
        reservedCreditUnits: 0,
        settledCreditUnits: 0,
        grantedCreditUnits: 100,
        adjustmentCreditUnits: 0,
      },
      {
        availableCreditUnits: 100,
        reservedCreditUnits: 1,
        settledCreditUnits: 0,
        grantedCreditUnits: 100,
        adjustmentCreditUnits: 0,
      },
      {
        availableCreditUnits: 0,
        reservedCreditUnits: 0,
        settledCreditUnits: 101,
        grantedCreditUnits: 100,
        adjustmentCreditUnits: 0,
      },
      {
        availableCreditUnits: 0,
        reservedCreditUnits: 0,
        settledCreditUnits: 0,
        grantedCreditUnits: Number.MAX_SAFE_INTEGER,
        adjustmentCreditUnits: 1,
      },
    ]) {
      expect(
        reconcileBillingUsageV1(snapshot({ balances })).findings.some(
          (finding) => finding.code === "negative-or-impossible-balance",
        ),
      ).toBe(true);
    }
    expect(() =>
      reconcileBillingUsageV1(
        snapshot({
          balances: {
            availableCreditUnits: 0.5,
            reservedCreditUnits: 0,
            settledCreditUnits: 0,
            grantedCreditUnits: 100,
            adjustmentCreditUnits: 0,
          },
        }),
      ),
    ).toThrow(/^availableCreditUnits must be a safe integer\.$/u);
    expect(
      first.findings.find(
        (finding) => finding.code === "provider-aggregate-ledger-mismatch",
      ),
    ).toMatchObject({ confidence: "aggregate", source: "provider-aggregate" });
    expect(JSON.stringify(first)).toContain(
      "not exact per-request provider reconciliation",
    );
  });

  it("detects subscription-period and grant-mapping drift separately from a missing monthly grant", () => {
    const report = reconcileBillingUsageV1(
      snapshot({
        balances: {
          adjustmentCreditUnits: 0,
          availableCreditUnits: 200,
          grantedCreditUnits: 200,
          reservedCreditUnits: 0,
          settledCreditUnits: 0,
        },
        configuredRoutes: [],
        grants: [
          {
            creditUnits: 1000,
            endsAt: "2026-09-02T00:00:00.000Z",
            grantId: "grant_august",
            periodId: "period_august",
            planKey: "pro",
            startsAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        planMapping: {
          actualMonthlyCreditUnits: 200,
          expectedMonthlyCreditUnits: 200,
          planKey: "starter",
          planMappingVersion: "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
        },
        providerAggregate: null,
        reservations: [],
        usage: [],
      }),
    );

    expect(new Set(report.findings.map((finding) => finding.code))).toEqual(
      new Set([
        "subscription-period-boundary-mismatch",
        "starter-pro-mapping-mismatch",
      ]),
    );
    expect(
      report.findings.find(
        (finding) => finding.code === "starter-pro-mapping-mismatch",
      )?.evidenceReferences,
    ).toContain("grant_august");
  });
});

describe("controlled-beta support and operator boundary", () => {
  const actor: BillingSupportActor = {
    actorId: "support_operator_beta",
    actorPrincipalId: "principal_support_beta",
    authorizedOrganizationIds: ["organization_beta"],
    permissions: [
      "commercial-projection.read",
      "commercial-usage.read",
      "billing-event.replay",
      "credit-adjustment.issue",
      "expensive-operations.suspend",
      "billing-reconciliation.run",
    ],
  };

  it("returns only allow-listed support fields and audits replay, adjustment, and suspension without secrets or payloads", async () => {
    const audits: unknown[] = [];
    const replayed = new Set<string>();
    const projection = {
      billingAccountId: "billing_beta",
      cardData: "must-not-escape",
      expensiveOperationsEnabled: true,
      lastProviderEventReference: "evt_known",
      organizationId: "organization_beta",
      planKey: "pro",
      privateRepositoryContent: "must-not-escape",
      projectionUpdatedAt: "2026-08-28T12:00:00.000Z",
      rawPrompt: "must-not-escape",
      secret: "must-not-escape",
      subscriptionState: "active",
    } as SafeBillingProjectionView & Record<string, unknown>;
    const usage = {
      availableCreditUnits: 900,
      organizationId: "organization_beta",
      periodEndsAt: "2026-09-01T00:00:00.000Z",
      periodStartsAt: "2026-08-01T00:00:00.000Z",
      providerApiResponse: "must-not-escape",
      reservedCreditUnits: 50,
      settledCreditUnits: 50,
    } as SafeBillingUsageView & Record<string, unknown>;
    const port: BillingOperationsPort = {
      appendCreditAdjustment: vi.fn().mockResolvedValue({
        adjustmentId: "adjustment_beta",
      }),
      getProjection: vi.fn().mockResolvedValue(projection),
      getUsage: vi.fn().mockResolvedValue(usage),
      replayKnownEvent: vi
        .fn()
        .mockImplementation(
          (input: Parameters<BillingOperationsPort["replayKnownEvent"]>[0]) => {
            const prior = replayed.has(input.idempotencyKey);
            replayed.add(input.idempotencyKey);
            return Promise.resolve({ status: prior ? "duplicate" : "applied" });
          },
        ),
      setExpensiveOperationsSuspended: vi.fn().mockResolvedValue(undefined),
    };
    const audit: BillingOperationsAuditSink = {
      append: (event) => {
        audits.push(event);
        return Promise.resolve();
      },
    };
    const service = new ControlledBetaBillingOperations({ audit, port });

    const safeProjection = await service.viewProjection(
      actor,
      "organization_beta",
    );
    const safeUsage = await service.viewUsage(actor, "organization_beta");
    expect(JSON.stringify({ safeProjection, safeUsage })).not.toMatch(
      /must-not-escape/u,
    );

    const replayInput = {
      expectedPayloadSha256: "a".repeat(64),
      idempotencyKey: "billing_replay_known_event_001",
      organizationId: "organization_beta",
      providerEventReference: "evt_known",
    } as const;
    await expect(service.replayKnownEvent(actor, replayInput)).resolves.toEqual(
      {
        status: "applied",
      },
    );
    await expect(service.replayKnownEvent(actor, replayInput)).resolves.toEqual(
      {
        status: "duplicate",
      },
    );
    await service.issueCreditAdjustment(actor, {
      creditUnits: 25,
      idempotencyKey: "billing_adjustment_support_001",
      organizationId: "organization_beta",
      reasonCode: "customer-support",
      relatedReference: "usage_known",
    });
    await service.setExpensiveOperationsSuspended(actor, {
      organizationId: "organization_beta",
      reasonCode: "ai-cost-spike",
      suspended: true,
    });

    expect(JSON.stringify(audits)).not.toMatch(
      /billing_replay_known_event_001|must-not-escape/u,
    );
    expect(audits).toHaveLength(6);
  });

  it("denies unpermissioned support mutations before adapter access", async () => {
    const appendCreditAdjustment = vi.fn();
    const service = new ControlledBetaBillingOperations({
      audit: { append: vi.fn() },
      port: {
        appendCreditAdjustment,
        getProjection: vi.fn(),
        getUsage: vi.fn(),
        replayKnownEvent: vi.fn(),
        setExpensiveOperationsSuspended: vi.fn(),
      },
    });

    await expect(
      service.issueCreditAdjustment(
        { ...actor, permissions: ["commercial-projection.read"] },
        {
          creditUnits: 10,
          idempotencyKey: "billing_adjustment_denied_001",
          organizationId: "organization_beta",
          reasonCode: "customer-support",
          relatedReference: "usage_known",
        },
      ),
    ).rejects.toMatchObject({ code: "access-denied" });
    expect(appendCreditAdjustment).not.toHaveBeenCalled();
  });

  it("denies cross-organization support access before adapter access", async () => {
    const getProjection = vi.fn();
    const appendCreditAdjustment = vi.fn();
    const service = new ControlledBetaBillingOperations({
      audit: { append: vi.fn() },
      port: {
        appendCreditAdjustment,
        getProjection,
        getUsage: vi.fn(),
        replayKnownEvent: vi.fn(),
        setExpensiveOperationsSuspended: vi.fn(),
      },
    });

    await expect(
      service.viewProjection(actor, "organization_other"),
    ).rejects.toMatchObject({ code: "access-denied" });
    await expect(
      service.issueCreditAdjustment(actor, {
        creditUnits: 10,
        idempotencyKey: "billing_adjustment_cross_tenant_001",
        organizationId: "organization_other",
        reasonCode: "customer-support",
        relatedReference: "usage_known",
      }),
    ).rejects.toMatchObject({ code: "access-denied" });
    expect(getProjection).not.toHaveBeenCalled();
    expect(appendCreditAdjustment).not.toHaveBeenCalled();
  });

  it("runs deterministic scheduled and explicitly authorized operator reconciliation without mutating accounting", async () => {
    const recorded: string[] = [];
    const port: BillingReconciliationSnapshotPort = {
      listOrganizationIds: vi
        .fn()
        .mockResolvedValue(["organization_beta", "organization_beta"]),
      loadSnapshot: vi.fn().mockResolvedValue(
        snapshot({
          balances: {
            adjustmentCreditUnits: 0,
            availableCreditUnits: 200,
            grantedCreditUnits: 200,
            reservedCreditUnits: 0,
            settledCreditUnits: 0,
          },
          configuredRoutes: [],
          grants: [],
          planMapping: {
            actualMonthlyCreditUnits: 200,
            expectedMonthlyCreditUnits: 200,
            planKey: "starter",
            planMappingVersion: "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
          },
          providerAggregate: null,
          reservations: [],
          subscriptionPeriod: null,
          usage: [],
        }),
      ),
      recordReport: (report) => {
        recorded.push(report.organizationId);
        return Promise.resolve();
      },
    };
    const reconciliationAudit: BillingOperationsAuditSink = {
      append: vi.fn().mockResolvedValue(undefined),
    };
    const coordinator = new BillingReconciliationCoordinator(
      port,
      reconciliationAudit,
    );

    await expect(
      coordinator.runScheduled("2026-08-28T12:00:00.000Z"),
    ).resolves.toHaveLength(1);
    await expect(
      coordinator.runForOrganization(
        { ...actor, permissions: [] },
        "organization_beta",
        "2026-08-28T12:00:00.000Z",
      ),
    ).rejects.toBeInstanceOf(BillingOperationsError);
    await expect(
      coordinator.runForOrganization(
        actor,
        "organization_beta",
        "2026-08-28T12:00:00.000Z",
      ),
    ).resolves.toMatchObject({ organizationId: "organization_beta" });
    vi.mocked(port.loadSnapshot).mockResolvedValueOnce(
      snapshot({ organizationId: "organization_other" }),
    );
    await expect(
      coordinator.runForOrganization(
        actor,
        "organization_beta",
        "2026-08-28T12:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(recorded).toEqual(["organization_beta", "organization_beta"]);
    expect(reconciliationAudit.append).toHaveBeenCalledTimes(1);
  });
});
