import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("additive live invocation metadata migration", () => {
  it("adds one invocation journal without changing the canonical financial rows", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0039_model_live_invocation_journal.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source.match(/CREATE\s+TABLE/giu)).toHaveLength(1);
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
  });
});
