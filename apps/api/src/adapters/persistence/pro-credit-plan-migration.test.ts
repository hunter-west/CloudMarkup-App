import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Pro allowance migration", () => {
  it("extends the exact Pro allowance and invitation admission without rewriting historical finance", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0081_pro_monthly_credits.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain(
      "CASE WHEN grant_kind='monthly' THEN 1250 ELSE credit_units END",
    );
    expect(source).toContain(
      "plan.plan_version_id='planver_pro_2026_09_30_v5' AND limits.limit_value=10",
    );
    expect(source).not.toMatch(
      /(?:UPDATE|DELETE FROM|DROP TABLE|DISABLE TRIGGER)\s/iu,
    );
    expect(source).not.toMatch(
      /INSERT INTO\s+(?:organization_subscription_projections|credit_grants|usage_ledger_entries)/iu,
    );
  });
});
