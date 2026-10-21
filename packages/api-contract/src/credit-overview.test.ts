import { describe, expect, it } from "vitest";
import { creditOverviewV1Schema } from "./credit-overview.js";
const overview = {
  contractVersion: 1,
  balance: {
    contractVersion: 1,
    organizationId: "org_credit",
    asOf: "2026-10-01T00:00:00.000Z",
    activeGrantedCreditUnits: 1400,
    availableCreditUnits: 1300,
    compensatedCreditUnits: 0,
    debitAdjustmentCreditUnits: 0,
    netAdjustmentCreditUnits: 0,
    exhausted: false,
    expiredCreditUnits: 50,
    reservedCreditUnits: 70,
    settledCreditUnits: 30,
    totalGrantedCreditUnits: 1450,
    unresolvedCreditUnits: 0,
  },
  availableByKind: { monthly: 1200, purchased: 100, other: 0 },
  nextExpiration: { at: "2026-11-01T00:00:00.000Z", creditUnits: 1200 },
};
describe("credit overview v1", () => {
  it("accepts reconciled available credits without confusing historical funding with spendable amounts", () => {
    expect(creditOverviewV1Schema.parse(overview)).toEqual(overview);
    expect(
      creditOverviewV1Schema.parse({ ...overview, nextExpiration: null })
        .nextExpiration,
    ).toBeNull();
  });
  it.each([
    { availableByKind: { monthly: 1250, purchased: 100, other: 0 } },
    { availableByKind: { monthly: -1, purchased: 100, other: 1201 } },
    {
      availableByKind: {
        monthly: Number.MAX_SAFE_INTEGER + 1,
        purchased: 0,
        other: 0,
      },
    },
    { nextExpiration: { at: overview.balance.asOf, creditUnits: 1200 } },
    { nextExpiration: { at: overview.nextExpiration.at, creditUnits: 0 } },
    { nextExpiration: { at: overview.nextExpiration.at, creditUnits: 1400 } },
    { providerCustomer: "private" },
    { contractVersion: 2 },
  ])("rejects inconsistent, unsafe or unknown evidence %j", (change) => {
    expect(
      creditOverviewV1Schema.safeParse({ ...overview, ...change }).success,
    ).toBe(false);
  });
});
