import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL(
    "../../../migration-proposals/model-live-sequence-reservations.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("integration-pending reciprocal sequence reservation proposal", () => {
  it("pins fresh read-committed snapshots and preserves organization-first exclusion", () => {
    expect(source).toContain(
      "current_setting('transaction_isolation') <> 'read committed'",
    );
    expect(source).toContain(
      "pg_advisory_xact_lock(hashtextextended('runtime-admission:'||org,0))",
    );
    expect(source).toContain("s.organization_id=NEW.organization_id");
    expect(source).not.toContain("s.project_id=NEW.project_id");
    expect(source).not.toContain("s.principal_id=NEW.principal_id");
    expect(source).not.toContain("revocations");
    expect(source).not.toContain("gateway_state");
  });
});
