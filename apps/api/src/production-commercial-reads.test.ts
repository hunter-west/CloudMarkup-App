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
import { createProductionCommercialReads } from "./production-commercial-reads.js";

const now = "2026-09-05T12:00:00.000Z";
const principal: PrincipalContext = {
  authenticatedAt: "2026-09-05T08:00:00.000Z",
  authenticationSource: "test",
  expiresAt: "2026-09-05T13:00:00.000Z",
  principalId: "principal_credit",
  sessionId: "session_credit",
  correlationId: "correlation_credit",
};
class CreditDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  role: OrganizationRole | null = "owner";
  corruptPolicy = false;
  hasAccount: unknown = false;
  revokeAfterRead = false;
  inTransaction = false;
  balance: SqlRow = {
    eligible_organization_id: "org_credit",
    as_of: now,
    active_granted: "200",
    available: "170",
    monthly_available: "120",
    purchased_available: "50",
    other_available: "0",
    next_expiration_at: "2026-10-01T00:00:00.000Z",
    next_expiration_units: "120",
    compensated: "0",
    debit_adjustments: "0",
    net_adjustments: "0",
    expired: "0",
    reserved: "20",
    settled: "10",
    total_granted: "200",
    unresolved: "0",
    ledger_through_event_id: null,
  };
  close() {
    return Promise.resolve();
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>) {
    this.inTransaction = true;
    try {
      return await work(this);
    } finally {
      this.inTransaction = false;
    }
  }
  query<T extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<T>> {
    if (statement.text.includes("FROM beta_ai_invocations")) {
      expect(statement.values[0]).toBe("org_credit");
      this.statements.push(statement);
      return Promise.resolve({ rowCount: 0, rows: [] } as SqlResult<T>);
    }
    expect(this.inTransaction).toBe(true);
    this.statements.push(statement);
    let rows: SqlRow[];
    if (statement.text.includes("capabilities_json")) {
      rows =
        this.role !== null &&
        statement.values[0] === principal.principalId &&
        statement.values[1] === "org_credit"
          ? [
              {
                membership_id: "membership_credit",
                role_key: this.role,
                capabilities_json: JSON.stringify(
                  this.corruptPolicy ? [] : permissionsForRole(this.role),
                ),
              },
            ]
          : [];
    } else if (statement.text.includes("AS has_account")) {
      expect(statement.values).toEqual(["org_credit"]);
      expect(statement.text).toContain("AT TIME ZONE 'UTC'");
      rows = [{ has_account: this.hasAccount, as_of: now }];
      if (this.revokeAfterRead) this.role = null;
    } else if (statement.text.includes("WITH eligible_account")) {
      expect(statement.text).toContain("AT TIME ZONE 'UTC'");
      expect(statement.values).toEqual([
        "org_credit",
        "membership_credit",
        principal.principalId,
      ]);
      rows = [this.balance];
      if (this.revokeAfterRead) this.role = null;
    } else if (
      statement.text.includes("SELECT 1") &&
      statement.text.includes("FROM memberships m")
    ) {
      expect(statement.values).toEqual([
        "membership_credit",
        principal.principalId,
        "org_credit",
        "commercial.summary.read",
      ]);
      rows = [{ allowed: 1 }];
    } else throw new Error("Unexpected SQL");
    return Promise.resolve({ rowCount: rows.length, rows } as SqlResult<T>);
  }
}
function fixture() {
  const database = new CreditDatabase();
  return {
    database,
    app: createProductionCommercialReads({
      database,
      clock: () => new Date(now),
    }),
  };
}

describe("production credit summary", () => {
  it("returns a single reconciled funding snapshot and an available-only next expiration", async () => {
    const f = fixture();
    f.database.hasAccount = true;
    const overview = await f.app.getCreditOverview(principal, "org_credit");
    expect(overview).toMatchObject({
      contractVersion: 1,
      balance: {
        availableCreditUnits: 170,
        reservedCreditUnits: 20,
        settledCreditUnits: 10,
      },
      availableByKind: { monthly: 120, purchased: 50, other: 0 },
      nextExpiration: { at: "2026-10-01T00:00:00.000Z", creditUnits: 120 },
    });
    expect(
      f.database.statements.filter((s) =>
        s.text.includes("WITH eligible_account"),
      ),
    ).toHaveLength(1);
  });
  it.each([
    { monthly_available: "121" },
    { purchased_available: "1e2" },
    { next_expiration_at: null },
    { next_expiration_units: "0" },
    { next_expiration_at: now },
    { next_expiration_units: "171" },
  ])("rejects contradictory funding evidence %j", async (change) => {
    const f = fixture();
    f.database.hasAccount = true;
    f.database.balance = { ...f.database.balance, ...change };
    await expect(
      f.app.getCreditOverview(principal, "org_credit"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it.each(["owner", "administrator", "editor", "viewer"] as const)(
    "returns positively authorized zero for a %s without provisioning an account",
    async (role) => {
      const f = fixture();
      f.database.role = role;
      const value = await f.app.getCreditBalance(principal, "org_credit");
      expect(value).toMatchObject({
        organizationId: "org_credit",
        contractVersion: 1,
        asOf: now,
        availableCreditUnits: 0,
        totalGrantedCreditUnits: 0,
        reservedCreditUnits: 0,
        settledCreditUnits: 0,
        exhausted: true,
      });
      expect(value).not.toHaveProperty("plan");
      expect(
        f.database.statements.every((s) =>
          s.text.trimStart().startsWith("SELECT"),
        ),
      ).toBe(true);
      expect(
        f.database.statements.some((s) =>
          s.text.includes("WITH eligible_account"),
        ),
      ).toBe(false);
    },
  );
  it("maps actual grant/reservation/settlement facts with checked public integers and UTC evidence", async () => {
    const f = fixture();
    f.database.hasAccount = true;
    expect(await f.app.getCreditBalance(principal, "org_credit")).toMatchObject(
      {
        availableCreditUnits: 170,
        reservedCreditUnits: 20,
        settledCreditUnits: 10,
        totalGrantedCreditUnits: 200,
        exhausted: false,
        asOf: now,
      },
    );
    expect(
      f.database.statements.every((s) =>
        /^(?:SELECT|WITH)\b/u.test(s.text.trimStart()),
      ),
    ).toBe(true);
  });
  it.each([
    `ledger.beta-ai.${"a".repeat(64)}`,
    `ledger.release.beta-ai.${"b".repeat(64)}`,
    `ledger_cutover_${"c".repeat(40)}`,
    `ledger_staff_${"d".repeat(32)}`,
    `topup_ledger_${"e".repeat(64)}`,
    `ledger_${"f".repeat(48)}`,
    `model_terminal_${"1".repeat(64)}`,
  ])(
    "omits known internal cursor %s without changing either credit response",
    async (ledgerId) => {
      const f = fixture();
      f.database.hasAccount = true;
      f.database.balance = {
        ...f.database.balance,
        ledger_through_event_id: ledgerId,
      };
      const value = await f.app.getCreditBalance(principal, "org_credit");
      expect(value).toMatchObject({
        availableCreditUnits: 170,
        reservedCreditUnits: 20,
        settledCreditUnits: 10,
      });
      expect(value).not.toHaveProperty("ledgerThroughEventId");
      const overview = await f.app.getCreditOverview(principal, "org_credit");
      expect(overview.balance).toEqual(value);
      expect(overview.availableByKind).toEqual({
        monthly: 120,
        purchased: 50,
        other: 0,
      });
    },
  );
  it.each([
    `model_reservation_${"a".repeat(64)}`,
    `ledger_staff_${"a".repeat(32)}\n`,
  ])(
    "rejects malformed or unknown internal cursor %j in both reads",
    async (ledgerId) => {
      const f = fixture();
      f.database.hasAccount = true;
      f.database.balance = {
        ...f.database.balance,
        ledger_through_event_id: ledgerId,
      };
      for (const read of [f.app.getCreditBalance, f.app.getCreditOverview]) {
        await expect(read(principal, "org_credit")).rejects.toMatchObject({
          code: "service_unavailable",
          message: "The organization credit summary is unavailable.",
        });
      }
    },
  );
  it.each(["usage_credit_test", `usage_grant_${"a".repeat(48)}`])(
    "preserves canonical public cursor %s",
    async (ledgerId) => {
      const f = fixture();
      f.database.hasAccount = true;
      f.database.balance = {
        ...f.database.balance,
        ledger_through_event_id: ledgerId,
      };
      await expect(
        f.app.getCreditBalance(principal, "org_credit"),
      ).resolves.toMatchObject({
        ledgerThroughEventId: ledgerId,
      });
    },
  );
  it.each(["org_other", "org_missing"])(
    "never substitutes zero for denied tenant %s",
    async (organizationId) => {
      const f = fixture();
      await expect(
        f.app.getCreditBalance(principal, organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(f.database.statements).toHaveLength(1);
    },
  );
  it.each([now, "not-a-time"])(
    "denies expired or invalid authentication before SQL (%s)",
    async (expiresAt) => {
      const f = fixture();
      await expect(
        f.app.getCreditBalance({ ...principal, expiresAt }, "org_credit"),
      ).rejects.toMatchObject({ code: "authentication_required" });
      expect(f.database.statements).toHaveLength(0);
    },
  );
  it("does not trust noncanonical stored capability arrays", async () => {
    const f = fixture();
    f.database.corruptPolicy = true;
    await expect(
      f.app.getCreditBalance(principal, "org_credit"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it("rechecks authorization after positively proving account absence", async () => {
    const f = fixture();
    f.database.revokeAfterRead = true;
    await expect(
      f.app.getCreditBalance(principal, "org_credit"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it.each([
    { available: "9007199254740992" },
    { net_adjustments: "-9007199254740992" },
    { available: "1e2" },
    { as_of: "2026-09-05 12:00:00" },
    { eligible_organization_id: "org_other" },
    { ledger_through_event_id: "ledger.unexpected" },
  ])(
    "fails closed on unrepresentable or unbound persistence evidence %j",
    async (change) => {
      const f = fixture();
      f.database.hasAccount = true;
      f.database.balance = { ...f.database.balance, ...change };
      await expect(
        f.app.getCreditBalance(principal, "org_credit"),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    },
  );
  it("does not interpret malformed presence evidence as an absent account", async () => {
    const f = fixture();
    f.database.hasAccount = "false";
    await expect(
      f.app.getCreditBalance(principal, "org_credit"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
});
