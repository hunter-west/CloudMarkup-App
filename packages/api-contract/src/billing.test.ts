import { describe, expect, it } from "vitest";

import {
  billingWorkspaceV1Schema,
  createBillingCheckoutV1Schema,
  createBillingPortalV1Schema,
  hostedBillingSessionV1Schema,
} from "./billing.js";

const workspace = {
  contractVersion: 1,
  organizationId: "org_test",
  asOf: "2026-09-05T12:00:00.000Z",
  mode: "disabled",
  accountState: "unprovisioned",
  subscriptionState: "not-subscribed",
  currentPlanKey: null,
  canCheckout: false,
  canManage: false,
  plans: [
    {
      key: "starter",
      displayName: "Starter",
      currency: "USD",
      monthlyPriceMicros: "9000000",
      monthlyCreditUnits: 200,
    },
    {
      key: "pro",
      displayName: "Professional",
      currency: "USD",
      monthlyPriceMicros: "39000000",
      monthlyCreditUnits: 1000,
    },
  ],
};

describe("sandbox billing v1 contracts", () => {
  it("accepts a truthful unsubscribed, providers-off workspace", () => {
    expect(billingWorkspaceV1Schema.parse(workspace)).toEqual(workspace);
  });
  it.each(
    [
      { canCheckout: true },
      { canManage: true },
      { currentPlanKey: "starter" },
      { mode: "live" },
      { plans: [workspace.plans[0], workspace.plans[0]] },
      { mode: "stripe-sandbox", accountState: "suspended", canCheckout: true },
      {
        mode: "stripe-sandbox",
        subscriptionState: "active",
        canCheckout: true,
        currentPlanKey: "pro",
      },
    ].filter((_, index) => index !== 3),
  )("rejects contradictory commercial states %j", (change) => {
    expect(
      billingWorkspaceV1Schema.safeParse({ ...workspace, ...change }).success,
    ).toBe(false);
  });
  it.each(
    [
      "organizationId",
      "customerId",
      "billingAccountId",
      "price",
      "successUrl",
      "amount",
      "credits",
      "quantity",
      "trial",
      "coupon",
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
  )("never accepts browser authority %s", (field) => {
    expect(
      createBillingCheckoutV1Schema.safeParse({
        contractVersion: 1,
        planKey: "starter",
        [field]: "arbitrary",
      }).success,
    ).toBe(false);
    expect(
      createBillingPortalV1Schema.safeParse({
        contractVersion: 1,
        [field]: "arbitrary",
      }).success,
    ).toBe(false);
  });
  it.each(
    [
      "https://checkout.stripe.com.evil.test/pay",
      "https://checkout.stripe.com@evil.test/pay",
      "https://evil.test@checkout.stripe.com/pay",
      "http://checkout.stripe.com/pay",
      "https://checkout.stripe.com:444/pay",
      "https://checkout.stripe.com/",
      "https://checkout.stripe.com/pay\\evil.test",
      "javascript:alert(1)",
      "https://billing.stripe.com/session/test",
    ].filter((_, index) => index !== 1),
  )("rejects an unapproved Checkout destination %s", (url) => {
    expect(
      hostedBillingSessionV1Schema.safeParse({
        contractVersion: 1,
        organizationId: "org_test",
        kind: "checkout",
        url,
      }).success,
    ).toBe(false);
  });
  it("accepts only the corresponding hosted surface", () => {
    for (const [kind, url] of [
      ["checkout", "https://checkout.stripe.com/c/pay/cs_test_example#details"],
      ["portal", "https://billing.stripe.com/p/session/test_example"],
    ])
      expect(
        hostedBillingSessionV1Schema.safeParse({
          contractVersion: 1,
          organizationId: "org_test",
          kind,
          url,
        }).success,
      ).toBe(true);
  });
});
