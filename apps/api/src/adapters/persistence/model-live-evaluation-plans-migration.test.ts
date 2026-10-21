import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("additive live evaluation approval migration", () => {
  it("keeps approval metadata separate from runtime capacity and customer money", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0036_model_live_evaluation_plans.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:model_runtime_admissions|model_commercial_workflows|credit_grants|usage_ledger_entries)\b/iu,
    );
  });
});
