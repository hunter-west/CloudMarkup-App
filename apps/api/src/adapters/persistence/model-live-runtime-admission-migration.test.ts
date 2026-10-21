import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("additive shared live runtime migration", () => {
  it("extends the actual snapshot constraint while keeping recovery separate from reacquisition and money", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0037_model_live_runtime_admissions.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(/CREATE\s+TABLE/iu);
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
    expect(source).toContain(
      "DROP CONSTRAINT model_runtime_admissions_snapshot_check1",
    );
    expect(source).not.toContain(
      "DROP CONSTRAINT model_runtime_admissions_check1",
    );
    expect(source).toContain("live evaluation reacquisition is recovery only");
  });
});
