import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("registered hosted CloudFormation Pro plan", () => {
  it("extends only CloudFormation plan definitions without rewriting existing accounts or money", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0055_cloudformation_export_pro_plan.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("planver_pro_2026_09_07_v3");
    expect(source).toContain("planver_pro_2026_09_12_v4");
    expect(source).toContain(
      "CASE WHEN feature_key='cloudformation' THEN 'enabled' ELSE entitlement_state END",
    );
    expect(source).not.toMatch(
      /(?:UPDATE|DELETE FROM|ALTER TABLE|DROP TABLE|DISABLE TRIGGER|GRANT)\s/iu,
    );
    expect(source).not.toMatch(
      /INSERT INTO\s+(?:organization_subscription_projections|organization_entitlement_snapshots|credit_grants|usage_ledger_entries)/iu,
    );
    expect(source).toContain(
      "CREATE OR REPLACE FUNCTION validate_organization_invitation_acceptance_v1",
    );
  });
});
