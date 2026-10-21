import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("registered organization sharing migration", () => {
  it("adds deferred invitation metadata without rewriting subscription, entitlement or money", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0032_organization_invitations_and_sharing_plans.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("CREATE TABLE organization_invitations");
    expect(source).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:organization_subscription_projections|organization_entitlement_snapshots|credit_grants|usage_ledger_entries)\b/iu,
    );
  });
});
