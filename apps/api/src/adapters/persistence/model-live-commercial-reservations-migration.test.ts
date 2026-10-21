import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("additive canonical live reservation mapping", () => {
  it("adds reservation metadata without a parallel ledger or financial writes", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0038_model_live_commercial_reservations.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /CREATE\s+TABLE|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
  });
});
