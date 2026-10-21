import type { CreditBalanceV1 } from "@cloudmarkup/api-contract";
import type { InMemorySeed } from "../testing/in-memory-adapters.js";
import { localPermissionsForRole } from "./local-application.js";

const NOW = "2026-08-15T00:00:00.000Z";

const principals = [
  {
    displayName: "Local CloudMarkup Owner",
    email: "owner@example.test",
    id: "principal_local_owner",
  },
  {
    displayName: "Local Team Owner",
    email: "team-owner@example.test",
    id: "principal_local_team_owner",
  },
  {
    displayName: "Local Team Administrator",
    email: "team-administrator@example.test",
    id: "principal_local_team_administrator",
  },
  {
    displayName: "Local Team Editor",
    email: "team-editor@example.test",
    id: "principal_local_team_editor",
  },
  {
    displayName: "Local Team Viewer",
    email: "team-viewer@example.test",
    id: "principal_local_team_viewer",
  },
] as const;

const creditBalances: readonly CreditBalanceV1[] = [
  {
    activeGrantedCreditUnits: 200,
    asOf: NOW,
    availableCreditUnits: 200,
    compensatedCreditUnits: 0,
    contractVersion: 1,
    debitAdjustmentCreditUnits: 0,
    exhausted: false,
    expiredCreditUnits: 0,
    netAdjustmentCreditUnits: 0,
    organizationId: "org_local",
    reservedCreditUnits: 0,
    settledCreditUnits: 0,
    totalGrantedCreditUnits: 200,
    unresolvedCreditUnits: 0,
  },
  {
    activeGrantedCreditUnits: 1_000,
    asOf: NOW,
    availableCreditUnits: 1_000,
    compensatedCreditUnits: 0,
    contractVersion: 1,
    debitAdjustmentCreditUnits: 0,
    exhausted: false,
    expiredCreditUnits: 0,
    netAdjustmentCreditUnits: 0,
    organizationId: "org_local_team",
    reservedCreditUnits: 0,
    settledCreditUnits: 0,
    totalGrantedCreditUnits: 1_000,
    unresolvedCreditUnits: 0,
  },
];

export function createLocalInMemorySeed(): InMemorySeed {
  return {
    creditBalances,
    creditOverviews: creditBalances.map((balance) => ({
      contractVersion: 1,
      balance,
      // Explicit synthetic monthly funding for the historical local preview.
      availableByKind: {
        monthly: balance.availableCreditUnits,
        purchased: 0,
        other: 0,
      },
      nextExpiration: {
        at: "2026-09-15T00:00:00.000Z",
        creditUnits: balance.availableCreditUnits,
      },
    })),
    currentPlanEntitlements: [
      {
        asOf: NOW,
        billingAccountState: "active",
        contractVersion: 1,
        entitlements: [
          { enabled: true, feature: "manual-editing", source: "plan" },
        ],
        expensiveOperationsEnabled: true,
        limits: [],
        organizationId: "org_local",
        organizationState: "active",
        plan: {
          commercialStatus: "beta-example",
          displayName: "Starter",
          effectiveFrom: NOW,
          id: "plan_starter",
          key: "starter",
          price: {
            amountMicros: "9000000",
            billingInterval: "month",
            currency: "USD",
            status: "beta-example",
          },
          version: 1,
          versionId: "planver_starter_2026_08_14_v1",
        },
        subscription: { projectionVersion: 1, state: "active" },
      },
      {
        asOf: NOW,
        billingAccountState: "active",
        contractVersion: 1,
        entitlements: [
          { enabled: true, feature: "manual-editing", source: "plan" },
          { enabled: true, feature: "terraform", source: "plan" },
        ],
        expensiveOperationsEnabled: true,
        limits: [],
        organizationId: "org_local_team",
        organizationState: "active",
        plan: {
          commercialStatus: "beta-example",
          displayName: "Pro",
          effectiveFrom: NOW,
          id: "plan_pro",
          key: "pro",
          price: {
            amountMicros: "39000000",
            billingInterval: "month",
            currency: "USD",
            status: "beta-example",
          },
          version: 2,
          versionId: "planver_pro_2026_08_14_v2",
        },
        subscription: { projectionVersion: 1, state: "active" },
      },
    ],
    memberships: [
      {
        capabilities: [...localPermissionsForRole("owner")],
        id: "membership_local_owner",
        isOwner: true,
        joinedAt: NOW,
        organizationId: "org_local",
        principal: {
          displayName: principals[0].displayName,
          id: principals[0].id,
        },
        role: "owner",
        status: "active",
      },
      ...(
        [
          ["owner", 1],
          ["administrator", 2],
          ["editor", 3],
          ["viewer", 4],
        ] as const
      ).map(([role, index]) => ({
        capabilities: [...localPermissionsForRole(role)],
        id: `membership_local_team_${role}`,
        isOwner: role === "owner",
        joinedAt: NOW,
        organizationId: "org_local_team",
        principal: {
          displayName: principals[index].displayName,
          id: principals[index].id,
        },
        role,
        status: "active" as const,
      })),
    ],
    organizations: [
      {
        createdAt: NOW,
        displayName: "Local Individual Organization",
        id: "org_local",
        lifecycleStatus: "active",
        slug: "local-cloudmarkup",
        version: 1,
      },
      {
        createdAt: NOW,
        displayName: "Local Team Organization",
        id: "org_local_team",
        lifecycleStatus: "active",
        slug: "local-cloudmarkup-team",
        version: 1,
      },
    ],
    principals,
  };
}
