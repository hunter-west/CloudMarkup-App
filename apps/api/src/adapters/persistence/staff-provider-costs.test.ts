import { describe, expect, it } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { BETA_AI_PRICING_V1 } from "../../application/beta-ai-pricing.js";
import { PostgresStaffProviderCosts } from "./staff-provider-costs.js";
import { betaAiReservationId } from "./beta-ai-credit-meter.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const from = "2026-11-01T00:00:00.000Z",
  until = "2026-11-02T00:00:00.000Z";
const actor: PrincipalContext = {
  principalId: "principal_cost_staff",
  sessionId: "session_cost_staff",
  correlationId: "correlation_cost_staff",
  authenticatedAt: from,
  expiresAt: until,
  authenticationSource: "cognito",
};
function usageRow(index: number): SqlRow {
  const identity = {
    organizationId: "org_cost",
    projectId: "project_cost",
    jobId: "job_cost_" + String(index),
    purpose: "proposal" as const,
    requestSha256: "a".repeat(64),
  };
  const reservationId = betaAiReservationId(identity),
    p = BETA_AI_PRICING_V1;
  return {
    organization_id: identity.organizationId,
    project_id: identity.projectId,
    job_id: identity.jobId,
    purpose: identity.purpose,
    request_sha256: identity.requestSha256,
    reservation_id: reservationId,
    request_id: reservationId,
    reservation_project_id: identity.projectId,
    reservation_job_id: identity.jobId,
    reservation_request_sha256: identity.requestSha256,
    state: "released",
    financial_status: "released",
    dispatched_at: from,
    usage_observed_at: from,
    observed_provider_request_id: "synthetic-private-provider-id",
    observed_input_tokens: 1200,
    observed_output_tokens: 300,
    observed_cached_input_tokens: 0,
    provider_key: p.providerKey,
    model_key: p.modelId,
    model_version: p.modelVersion,
    pricing_version_id: p.pricingVersionId,
    charging_policy_version: p.chargingPolicyVersion,
    price_provider_key: p.providerKey,
    price_model_key: p.modelId,
    price_model_version: p.modelVersion,
    price_currency: "USD",
    price_input_rate: p.inputMicrosPerMillionTokens.toString(),
    price_output_rate: p.outputMicrosPerMillionTokens.toString(),
    price_cached_rate: p.cachedInputMicrosPerMillionTokens.toString(),
  };
}
class ReportDatabase implements SqlDatabase {
  permissions = ["provider-costs.read"];
  sessionActive = true;
  scopeActive = true;
  organizationActive = true;
  staffVersion = "1";
  scopeVersion = "1";
  boundStaffVersion = "1";
  readonly statements: SqlStatement[] = [];
  readonly transactions: string[][] = [];
  readonly rows: SqlRow[] = Array.from({ length: 25 }, (_, i) =>
    usageRow(i),
  ).sort((a, b) =>
    String(a["reservation_id"]).localeCompare(String(b["reservation_id"])),
  );
  afterPage: (() => void) | undefined;
  close() {
    return Promise.resolve();
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const trace: string[] = [];
    this.transactions.push(trace);
    const value = await work({
      query: <R extends SqlRow>(statement: SqlStatement) => {
        trace.push(statement.text);
        return this.query<R>(statement);
      },
    });
    if (trace[0]?.startsWith("SET TRANSACTION")) this.afterPage?.();
    return value;
  }
  query<T extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<T>> {
    this.statements.push(statement);
    const t = statement.text;
    let rows: SqlRow[] = [];
    if (t.includes("pg_advisory_xact_lock")) rows = [];
    else if (t.includes("FROM principals WHERE"))
      rows = [{ principal_id: actor.principalId }];
    else if (t.includes("cloudmarkup_account_session_allowed_v1"))
      rows = [{ allowed: this.sessionActive }];
    else if (t.startsWith("SELECT permissions FROM"))
      rows = [{ permissions: this.permissions }];
    else if (t.includes("FROM platform_staff_provider_cost_authorizations")) {
      expect(statement.values).toEqual([
        actor.principalId,
        statement.values[1],
      ]);
      expect(t).toContain("g.staff_authorization_version=s.record_version");
      expect(t).toContain("'provider-costs.read'=ANY(s.permissions)");
      expect(t).not.toMatch(/FOR (SHARE|UPDATE)/u);
      rows =
        this.scopeActive &&
        this.permissions.includes("provider-costs.read") &&
        this.organizationActive &&
        this.staffVersion === this.boundStaffVersion &&
        statement.values[1] === "org_cost"
          ? [
              {
                organization_id: "org_cost",
                scope_version: this.scopeVersion,
                staff_version: this.staffVersion,
              },
            ]
          : [];
    } else if (
      t.startsWith("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
    )
      rows = [];
    else if (t.includes("transaction_timestamp()")) rows = [{ as_of: from }];
    else if (t.includes("FROM beta_ai_invocations")) {
      expect(statement.values.slice(0, 3)).toEqual(["org_cost", from, until]);
      expect(t).toContain("LIMIT 25");
      rows = statement.values[3] === null ? this.rows : [];
    } else if (t.includes("FROM usage_ledger_entries")) {
      expect(statement.values[0]).toBe("org_cost");
      rows = [];
    } else throw Error("Unexpected SQL in content-free report fixture");
    return Promise.resolve({ rows, rowCount: rows.length } as SqlResult<T>);
  }
}
describe("organization-authorized staff provider costs", () => {
  it("reads original-price evidence once, binds continuation and keeps locking authorization outside a read-only page", async () => {
    const db = new ReportDatabase(),
      service = new PostgresStaffProviderCosts(db);
    const report = await service.read(actor, "org_cost", { from, until });
    expect(report.knownProviderCostMicros).toBe("202500");
    expect(report.records[0]).toMatchObject({
      accountingStatus: "known",
      providerCostMicros: "8100",
      pricingVersionId: BETA_AI_PRICING_V1.pricingVersionId,
    });
    expect(JSON.stringify(report)).not.toContain(
      "synthetic-private-provider-id",
    );
    expect(db.transactions).toHaveLength(3);
    expect(
      db.statements
        .filter((s) => s.text.startsWith("SELECT permissions FROM"))
        .every((s) => !s.text.includes("FOR SHARE")),
    ).toBe(true);
    expect(db.transactions[1]?.[0]).toBe(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    expect(
      db.transactions[1]?.some((t) => /FOR SHARE|advisory_xact_lock/u.test(t)),
    ).toBe(false);
    expect(db.statements.every((s) => /^(SELECT|SET)\b/u.test(s.text))).toBe(
      true,
    );
    const cursor = report.nextCursor;
    if (cursor === null) throw Error("Expected bounded continuation");
    const next = await service.read(actor, "org_cost", { from, until, cursor });
    expect(next.knownProviderCostMicros).toBeNull();
    expect(next.pointInTimeCohortComplete).toBe(false);
    const before = db.statements.length;
    await expect(
      service.read(actor, "org_other", { from, until, cursor }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.read(actor, "org_cost", {
        from: "2026-10-01T00:00:00.000Z",
        until,
        cursor,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(db.statements).toHaveLength(before);
  });
  it.each([
    "customer-owner",
    "accounts-read-only",
    "session-revoked",
    "scope-revoked",
    "organization-closed",
    "global-regranted",
    "foreign-organization",
  ] as const)("denies %s before cost reads", async (mode) => {
    const db = new ReportDatabase();
    if (mode === "customer-owner") db.permissions = [];
    if (mode === "accounts-read-only") db.permissions = ["accounts.read"];
    if (mode === "session-revoked") db.sessionActive = false;
    if (mode === "scope-revoked") db.scopeActive = false;
    if (mode === "organization-closed") db.organizationActive = false;
    if (mode === "global-regranted") db.staffVersion = "2";
    await expect(
      new PostgresStaffProviderCosts(db).read(
        actor,
        mode === "foreign-organization" ? "org_other" : "org_cost",
        { from, until },
      ),
    ).rejects.toMatchObject({
      code:
        mode === "session-revoked"
          ? "authentication_required"
          : "access_denied",
    });
    expect(
      db.statements.some((s) => s.text.includes("FROM beta_ai_invocations")),
    ).toBe(false);
  });
  it.each(["session", "permission", "scope-version"] as const)(
    "discards the page when %s changes during the read",
    async (mode) => {
      const db = new ReportDatabase();
      db.afterPage = () => {
        if (mode === "session") db.sessionActive = false;
        else if (mode === "permission") db.permissions = [];
        else db.scopeVersion = "2";
      };
      await expect(
        new PostgresStaffProviderCosts(db).read(actor, "org_cost", {
          from,
          until,
        }),
      ).rejects.toMatchObject({
        code: mode === "session" ? "authentication_required" : "access_denied",
      });
      expect(db.transactions).toHaveLength(3);
      expect(db.statements.every((s) => /^(SELECT|SET)\b/u.test(s.text))).toBe(
        true,
      );
    },
  );
  it("rejects forged authentication, malformed cohorts and foreign returned rows", async () => {
    const db = new ReportDatabase(),
      service = new PostgresStaffProviderCosts(db);
    await expect(
      service.read({ ...actor, authenticationSource: "test" }, "org_cost", {
        from,
        until,
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      service.read(actor, "org_cost", { from: until, until: from }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    db.rows[0] = { ...db.rows[0], organization_id: "org_other" };
    await expect(
      service.read(actor, "org_cost", { from, until }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
});
