import type { CurrentPlanEntitlementsV1 } from "@cloudmarkup/api-contract";
import { describe, expect, it, vi } from "vitest";

import { CurrentPlanGitHubExportEntitlementPolicy } from "./github-exports.js";
import { ApplicationError } from "./errors.js";
import { CurrentPlanRepositoryExportEntitlementPolicy } from "./repository-export-entitlements.js";
import type { PrincipalContext } from "./ports.js";

const now = "2026-08-24T12:00:00.000Z";
const later = "2026-09-24T12:00:00.000Z";
const principal: PrincipalContext = {
  authenticatedAt: now,
  authenticationSource: "test",
  correlationId: "correlation.github-export-entitlement",
  expiresAt: later,
  principalId: "principal.github-export-entitlement",
  sessionId: "session.github-export-entitlement",
};

function summary(
  overrides: Partial<CurrentPlanEntitlementsV1> = {},
): CurrentPlanEntitlementsV1 {
  return {
    asOf: now,
    billingAccountState: "active",
    contractVersion: 1,
    entitlements: [{ enabled: true, feature: "github-export", source: "plan" }],
    expensiveOperationsEnabled: true,
    limits: [],
    organizationId: "organization.github-export-entitlement",
    organizationState: "active",
    plan: {
      commercialStatus: "proposed",
      displayName: "Pro",
      effectiveFrom: now,
      id: "plan.github-export",
      key: "pro",
      price: {
        amountMicros: "39000000",
        billingInterval: "month",
        currency: "USD",
        status: "proposed",
      },
      version: 1,
      versionId: "planver.github-export-1",
    },
    subscription: {
      currentPeriodEndsAt: later,
      currentPeriodStartsAt: now,
      projectionVersion: 1,
      state: "active",
    },
    ...overrides,
  };
}

describe("GitHub export commercial admission", () => {
  it("admits an active organization with the canonical GitHub export entitlement", async () => {
    const getCurrentPlanEntitlements = vi.fn(() => Promise.resolve(summary()));
    const policy = new CurrentPlanGitHubExportEntitlementPolicy({
      getCurrentPlanEntitlements,
    });

    await expect(
      policy.authorize({
        organizationId: "organization.github-export-entitlement",
        principal,
        projectId: "project.github-export-entitlement",
      }),
    ).resolves.toBeUndefined();
    expect(getCurrentPlanEntitlements).toHaveBeenCalledWith(
      principal,
      "organization.github-export-entitlement",
    );
  });

  const denialCases: readonly (readonly [
    string,
    Partial<CurrentPlanEntitlementsV1>,
  ])[] = [
    [
      "disabled feature",
      {
        entitlements: [
          { enabled: false, feature: "github-export", source: "plan" },
        ],
      },
    ],
    [
      "inactive billing account",
      { billingAccountState: "suspended", expensiveOperationsEnabled: false },
    ],
    ["suspended organization", { organizationState: "suspended" }],
  ];

  it.each(denialCases)(
    "denies %s before repository authority is used",
    async (_name, overrides) => {
      const policy = new CurrentPlanGitHubExportEntitlementPolicy({
        getCurrentPlanEntitlements: () => Promise.resolve(summary(overrides)),
      });

      await expect(
        policy.authorize({
          organizationId: "organization.github-export-entitlement",
          principal,
          projectId: "project.github-export-entitlement",
        }),
      ).rejects.toMatchObject({ code: "access_denied" });
    },
  );

  it("fails closed on a mismatched tenant summary or unavailable commercial authority", async () => {
    const mismatched = new CurrentPlanGitHubExportEntitlementPolicy({
      getCurrentPlanEntitlements: () =>
        Promise.resolve(summary({ organizationId: "organization.other" })),
    });
    const unavailable = new CurrentPlanGitHubExportEntitlementPolicy({
      getCurrentPlanEntitlements: () =>
        Promise.reject(new Error("sensitive upstream failure")),
    });
    const input = {
      organizationId: "organization.github-export-entitlement",
      principal,
      projectId: "project.github-export-entitlement",
    } as const;

    await expect(mismatched.authorize(input)).rejects.toMatchObject({
      code: "service_unavailable",
      message: "The current export entitlement could not be verified.",
    });
    await expect(unavailable.authorize(input)).rejects.toMatchObject({
      code: "service_unavailable",
      message: "The current export entitlement could not be verified.",
    });
  });
});

describe.each(["GitHub", "GitLab"] as const)(
  "%s repository-export alias v1",
  (provider) => {
    const input = {
      organizationId: "organization.github-export-entitlement",
      principal,
      projectId: "project.github-export-entitlement",
    };
    function policy(value: CurrentPlanEntitlementsV1) {
      return new CurrentPlanRepositoryExportEntitlementPolicy(
        { getCurrentPlanEntitlements: () => Promise.resolve(value) },
        provider,
      );
    }
    it("uses current evaluated eligibility, independently of plan display names", async () => {
      const value = summary();
      await expect(
        policy({
          ...value,
          plan: { ...value.plan, displayName: "Renamed paid plan" },
        }).authorize(input),
      ).resolves.toBeUndefined();
    });
    it.each([
      [
        "Standard plan with staff credits",
        {
          entitlements: [
            { feature: "github-export", enabled: false, source: "plan" },
          ],
          expensiveOperationsEnabled: true,
        },
      ],
      ["missing feature", { entitlements: [] }],
      ["operator kill switch", { expensiveOperationsEnabled: false }],
      ["suspended billing", { billingAccountState: "suspended" }],
      ["closed billing", { billingAccountState: "closed" }],
      ["suspended workspace", { organizationState: "suspended" }],
      [
        "inactive subscription",
        { subscription: { ...summary().subscription, state: "canceled" } },
      ],
    ] as readonly (readonly [string, Partial<CurrentPlanEntitlementsV1>])[])(
      "denies %s",
      async (_label, override) => {
        await expect(
          policy(summary(override)).authorize(input),
        ).rejects.toMatchObject({ code: "access_denied" });
      },
    );
    it("rejects a foreign or ambiguous commercial projection", async () => {
      await expect(
        policy(summary({ organizationId: "organization.other" })).authorize(
          input,
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      await expect(
        policy(
          summary({
            entitlements: [
              ...summary().entitlements,
              ...summary().entitlements,
            ],
          }),
        ).authorize(input),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });
    it("preserves current authorization denial without exposing unexpected upstream details", async () => {
      const denied = new ApplicationError(
        "access_denied",
        "Access is not available.",
      );
      const service = new CurrentPlanRepositoryExportEntitlementPolicy(
        { getCurrentPlanEntitlements: () => Promise.reject(denied) },
        provider,
      );
      await expect(service.authorize(input)).rejects.toBe(denied);
      const unavailable = new CurrentPlanRepositoryExportEntitlementPolicy(
        {
          getCurrentPlanEntitlements: () =>
            Promise.reject(new Error("synthetic private upstream detail")),
        },
        provider,
      );
      await expect(unavailable.authorize(input)).rejects.toMatchObject({
        code: "service_unavailable",
        message: "The current export entitlement could not be verified.",
      });
    });
  },
);
