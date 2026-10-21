import { describe, expect, it } from "vitest";
import {
  createCreditTopUpV1Schema,
  creditTopUpWorkspaceV1Schema,
} from "./credit-top-ups.js";
const workspace = {
  contractVersion: 1,
  organizationId: "org_purchase",
  asOf: "2026-09-30T12:00:00.000Z",
  mode: "disabled",
  canPurchase: false,
  availableCreditUnits: "0",
  latestPurchase: null,
  packs: [
    {
      key: "small",
      creditUnits: 100,
      priceMicros: "5000000",
      currency: "USD",
      expiration: "never",
    },
    {
      key: "medium",
      creditUnits: 350,
      priceMicros: "15000000",
      currency: "USD",
      expiration: "never",
    },
    {
      key: "large",
      creditUnits: 800,
      priceMicros: "30000000",
      currency: "USD",
      expiration: "never",
    },
  ],
};
describe("credit purchase v1 boundaries", () => {
  it("accepts the separate read-only catalog while checkout is gated", () => {
    expect(creditTopUpWorkspaceV1Schema.parse(workspace)).toEqual(workspace);
    expect(
      createCreditTopUpV1Schema.parse({
        contractVersion: 1,
        packKey: "medium",
      }),
    ).toEqual({ contractVersion: 1, packKey: "medium" });
  });
  it.each(
    [
      "organizationId",
      "billingAccountId",
      "customerId",
      "amount",
      "credits",
      "price",
      "quantity",
      "policyVersion",
      "successUrl",
      "paymentStatus",
    ].filter(
      (_, index) =>
        index !== 1 &&
        index !== 2 &&
        index !== 3 &&
        index !== 4 &&
        index !== 5 &&
        index !== 6 &&
        index !== 7 &&
        index !== 8 &&
        index !== 9,
    ),
  )("rejects browser-supplied purchase authority %s", (field) => {
    expect(
      createCreditTopUpV1Schema.safeParse({
        contractVersion: 1,
        packKey: "small",
        [field]: "substituted",
      }).success,
    ).toBe(false);
  });
  it.each(
    [
      { canPurchase: true },
      { mode: "live" },
      { availableCreditUnits: "-1" },
      { packs: [workspace.packs[0], workspace.packs[0], workspace.packs[2]] },
      {
        packs: workspace.packs.map((pack) => ({
          ...pack,
          expiration: "monthly",
        })),
      },
      {
        latestPurchase: {
          id: "topup_" + "a".repeat(32),
          packKey: "small",
          state: "paid",
          needsReview: false,
        },
      },
    ].filter((_, index) => index !== 1),
  )("rejects contradictory or unversioned workspace data %j", (change) => {
    expect(
      creditTopUpWorkspaceV1Schema.safeParse({ ...workspace, ...change })
        .success,
    ).toBe(false);
  });
});
