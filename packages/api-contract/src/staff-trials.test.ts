import { describe, it, expect } from "vitest";
import {
  staffAccountActionV1Schema,
  staffAccessV1Schema,
  staffAccountV1Schema,
  staffAccountListV1Schema,
  staffAccountListSchema,
  staffAccountDetailV1Schema,
  staffAccountDetailSchema,
} from "./staff-accounts.js";
const grant = {
  contractVersion: 1,
  action: "grant-trial",
  creditUnits: 100,
  expiresInDays: 14,
  confirmBillingAccountId: "billing_synthetic",
  reason: "Synthetic evaluation",
};
describe("staff trial command v1", () => {
  it("adds separately authorized bounded trials while preserving paid credit command semantics", () => {
    expect(staffAccountActionV1Schema.parse(grant)).toEqual(grant);
    expect(
      staffAccountActionV1Schema.safeParse({
        ...grant,
        action: "grant-credits",
        creditUnits: 100000,
        expiresInDays: 365,
      }).success,
    ).toBe(true);
    expect(
      staffAccessV1Schema.parse({
        contractVersion: 1,
        permissions: ["accounts.read", "trials.grant", "trials.revoke"],
      }),
    ).toMatchObject({
      permissions: ["accounts.read", "trials.grant", "trials.revoke"],
    });
  });
  it.each(
    [
      { creditUnits: 0 },
      { creditUnits: 1001 },
      { creditUnits: 1.1 },
      { expiresInDays: 0 },
      { expiresInDays: 31 },
      { contractVersion: 2 },
      { permissions: ["trials.grant"] },
      { actorPrincipalId: "principal_forged" },
      { reason: "bad\nreason" },
    ].filter((_, index) => index !== 6),
  )("rejects invalid or forged command %j", (change) => {
    expect(
      staffAccountActionV1Schema.safeParse({ ...grant, ...change }).success,
    ).toBe(false);
  });
  it("revokes the exact selected trial without supplying a replacement balance or allowance", () => {
    const revoke = {
      contractVersion: 1,
      action: "revoke-trial",
      trialId: "trial_synthetic",
      confirmBillingAccountId: grant.confirmBillingAccountId,
      reason: grant.reason,
    };
    expect(staffAccountActionV1Schema.parse(revoke)).toEqual(revoke);
    expect(
      staffAccountActionV1Schema.safeParse({ ...revoke, creditUnits: 100 })
        .success,
    ).toBe(false);
  });
});

describe("versioned unprovisioned staff account preview", () => {
  const preview = {
    contractVersion: 2,
    organizationId: "org_fresh",
    billingAccountId: "billing_fresh",
    displayName: "Fresh workspace",
    kind: "personal",
    organizationState: "active",
    billingState: "unprovisioned",
    subscriptionState: "not-subscribed",
    planDisplayName: null,
    expensiveOperationsEnabled: false,
    version: 0,
    organizationVersion: 1,
  };
  const detail = {
    contractVersion: 2,
    account: preview,
    availableCreditUnits: "0",
    reservedCreditUnits: "0",
    grants: [],
    history: [],
  };
  it("preserves existing v1 reads and explicitly versions the fundless preview", () => {
    const existing = {
      ...preview,
      contractVersion: 1,
      billingState: "active",
      expensiveOperationsEnabled: true,
      version: 1,
    };
    delete (existing as Partial<typeof existing>).organizationVersion;
    const legacy = staffAccountV1Schema.parse(existing);
    expect(
      staffAccountListSchema.parse({ contractVersion: 1, items: [legacy] }),
    ).toEqual({ contractVersion: 1, items: [legacy] });
    expect(
      staffAccountListSchema.parse({
        contractVersion: 2,
        items: [legacy, preview],
      }).items,
    ).toHaveLength(2);
    expect(staffAccountDetailSchema.parse(detail)).toEqual(detail);
    expect(staffAccountV1Schema.safeParse(preview).success).toBe(false);
    expect(
      staffAccountListV1Schema.safeParse({
        contractVersion: 2,
        items: [preview],
      }).success,
    ).toBe(false);
    expect(staffAccountDetailV1Schema.safeParse(detail).success).toBe(false);
  });
  it("cannot advertise spendable funds or existing authority in an unprovisioned preview", () => {
    for (const changed of [
      { availableCreditUnits: "1" },
      { reservedCreditUnits: "1" },
      { account: { ...preview, expensiveOperationsEnabled: true } },
      { account: { ...preview, subscriptionState: "active" } },
      { account: { ...preview, version: 1 } },
      { account: { ...preview, organizationVersion: 0 } },
      { trial: { state: "active" } },
      { history: [{}] },
      { grants: [{}] },
    ])
      expect(
        staffAccountDetailSchema.safeParse({ ...detail, ...changed }).success,
      ).toBe(false);
  });
});
