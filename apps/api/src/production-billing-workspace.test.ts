import { describe, expect, it } from "vitest";
import {
  permissionsForRole,
  type OrganizationRole,
} from "./application/authorization.js";
import type { PrincipalContext } from "./application/ports.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./adapters/persistence/sql.js";
import { createBillingConfiguration } from "./application/billing.js";
import { createProductionBillingWorkspace } from "./production-billing-workspace.js";

const now = "2026-09-05T12:00:00.000Z";
const principal: PrincipalContext = {
  authenticatedAt: now,
  authenticationSource: "test",
  expiresAt: "2026-09-05T13:00:00.000Z",
  principalId: "principal_test",
  sessionId: "session_test",
  correlationId: "correlation_test",
};
class BillingDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  role: OrganizationRole | null = "owner";
  account: SqlRow | null = null;
  corruptedPolicy = false;
  inTransaction = false;
  close() {
    return Promise.resolve();
  }
  async transaction<T>(
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    this.inTransaction = true;
    try {
      return await work(this);
    } finally {
      this.inTransaction = false;
    }
  }
  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    let rows: SqlRow[] = [];
    if (statement.text.includes("FROM memberships m")) {
      expect(this.inTransaction).toBe(true);
      expect(statement.text).toContain("FOR SHARE OF m, p, o, r");
      if (
        this.role !== null &&
        statement.values[0] === "principal_test" &&
        statement.values[1] === "org_test"
      )
        rows = [
          {
            membership_id: "membership_test",
            role_key: this.role,
            capabilities_json: JSON.stringify(
              this.corruptedPolicy ? [] : permissionsForRole(this.role),
            ),
          },
        ];
    } else if (
      statement.text.includes("FROM organization_billing_accounts a")
    ) {
      expect(this.inTransaction).toBe(true);
      if (this.account) rows = [this.account];
    } else throw new Error("Unexpected SQL: " + statement.text);
    return Promise.resolve({ rowCount: rows.length, rows } as SqlResult<TRow>);
  }
}
function fixture() {
  const database = new BillingDatabase();
  return {
    database,
    app: createProductionBillingWorkspace({
      database,
      clock: () => new Date(now),
    }),
  };
}

describe("production billing workspace", () => {
  it.each([
    ["cloudmarkup-starter-pro-export-mapping-2026-09-12-v3", 1000],
    ["cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4", 1250],
  ] as const)(
    "advertises the exact configured allowance for %s",
    async (planMappingVersion, credits) => {
      const database = new BillingDatabase();
      const configuration = createBillingConfiguration({
        mode: "stripe-sandbox",
        stripeEnvironment: "test",
        portalConfigurationReference: "bpc_synthetic_workspace",
        planMappingVersion,
        cancelUrl: "https://beta.example.test/billing?canceled",
        successUrl: "https://beta.example.test/billing?returned",
        portalReturnUrl: "https://beta.example.test/billing",
        starterPriceReference: "price_synthetic_starter",
        starterProductReference: "prod_synthetic_starter",
        proPriceReference: "price_synthetic_pro",
        proProductReference: "prod_synthetic_pro",
      });
      const app = createProductionBillingWorkspace({
        database,
        clock: () => new Date(now),
        sessions: {
          configuration,
          createProvider: () => {
            throw new Error("A plan read must not contact the provider.");
          },
        },
      });
      const value = await app.getWorkspace(principal, "org_test");
      expect(value.plans.find((plan) => plan.key === "pro")).toMatchObject({
        monthlyCreditUnits: credits,
        monthlyPriceMicros: "39000000",
      });
    },
  );

  it.each([
    ["planver_starter_2026_08_14_v1", "starter"],
    ["planver_pro_2026_08_14_v2", "pro"],
    ["planver_starter_2026_09_07_v2", "starter"],
    ["planver_pro_2026_09_07_v3", "pro"],
    ["planver_pro_2026_09_12_v4", "pro"],
    ["planver_pro_2026_09_30_v5", "pro"],
  ])(
    "recognizes canonical plan %s without subscription writes",
    async (version, key) => {
      const f = fixture();
      f.database.account = {
        account_state: "active",
        subscription_state: "active",
        plan_version_id: version,
      };
      expect(
        (await f.app.getWorkspace(principal, "org_test")).currentPlanKey,
      ).toBe(key);
      expect(
        f.database.statements.every((statement) =>
          statement.text.trimStart().startsWith("SELECT"),
        ),
      ).toBe(true);
    },
  );
  it("does not substitute a known paid plan for an unknown current plan", async () => {
    const f = fixture();
    f.database.account = {
      account_state: "active",
      subscription_state: "active",
      plan_version_id: "planver_unknown",
    };
    await expect(
      f.app.getWorkspace(principal, "org_test"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it("reads a truthful unsubscribed workspace without provisioning or paid entitlements", async () => {
    const f = fixture();
    const value = await f.app.getWorkspace(principal, "org_test");
    expect(value).toMatchObject({
      subscriptionState: "not-subscribed",
      currentPlanKey: null,
      accountState: "unprovisioned",
      mode: "disabled",
      canCheckout: false,
      canManage: false,
    });
    expect(value.plans.map((p) => p.monthlyCreditUnits)).toEqual([200, 1250]);
    expect(
      f.database.statements.every((s) =>
        s.text.trimStart().startsWith("SELECT"),
      ),
    ).toBe(true);
  });
  it.each(["owner", "administrator", "editor", "viewer"] as const)(
    "permits canonical %s summary reads",
    async (role) => {
      const f = fixture();
      f.database.role = role;
      expect(
        (await f.app.getWorkspace(principal, "org_test")).canCheckout,
      ).toBe(false);
    },
  );
  it("uses verified subscription facts rather than a fallback paid plan", async () => {
    const f = fixture();
    f.database.account = {
      account_state: "active",
      subscription_state: "active",
      plan_version_id: "planver_pro_2026_08_14_v2",
      provider_customer_reference: "cus_test",
    };
    expect(await f.app.getWorkspace(principal, "org_test")).toMatchObject({
      currentPlanKey: "pro",
      subscriptionState: "active",
      canManage: false,
    });
  });
  it.each(["org_other", "org_missing"])(
    "does not disclose tenant %s",
    async (organizationId) => {
      const f = fixture();
      await expect(
        f.app.getWorkspace(principal, organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(f.database.statements).toHaveLength(1);
    },
  );
  it("denies expired sessions, removed memberships and corrupted policies", async () => {
    const f = fixture();
    await expect(
      f.app.getWorkspace({ ...principal, expiresAt: now }, "org_test"),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(f.database.statements).toHaveLength(0);
    f.database.role = null;
    await expect(
      f.app.getWorkspace(principal, "org_test"),
    ).rejects.toMatchObject({ code: "not_found" });
    f.database.role = "owner";
    f.database.corruptedPolicy = true;
    await expect(
      f.app.getWorkspace(principal, "org_test"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it("does not provision accounts or call providers while sessions are disabled", async () => {
    const f = fixture();
    await expect(
      f.app.createCheckout(
        principal,
        "org_test",
        { contractVersion: 1, planKey: "starter" },
        "attempt-test",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.database.statements).toHaveLength(1);
    expect(f.database.statements[0]?.text).not.toContain("INSERT");
  });
  it("requires current privileged membership and recent authentication before session creation", async () => {
    const f = fixture();
    f.database.role = "viewer";
    await expect(
      f.app.createPortal(principal, "org_test", "attempt-test"),
    ).rejects.toMatchObject({ code: "access_denied" });
    f.database.role = "owner";
    await expect(
      f.app.createCheckout(
        { ...principal, authenticatedAt: "2026-09-05T11:00:00.000Z" },
        "org_test",
        { contractVersion: 1, planKey: "starter" },
        "attempt-test",
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
  it("rejects unknown subscription plans instead of guessing", async () => {
    const f = fixture();
    f.database.account = {
      account_state: "active",
      subscription_state: "active",
      plan_version_id: "unreviewed_plan",
    };
    await expect(
      f.app.getWorkspace(principal, "org_test"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
});
