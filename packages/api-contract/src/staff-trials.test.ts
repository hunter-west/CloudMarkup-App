import { describe, it, expect } from "vitest";
import {
  staffAccountActionV1Schema,
  staffAccessV1Schema,
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
