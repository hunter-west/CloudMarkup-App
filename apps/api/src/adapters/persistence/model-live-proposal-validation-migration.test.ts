import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("additive deterministic live case receipt migration", () => {
  it("stores validation receipts without altering dispatch or financial authority", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0043_model_live_proposal_validation_receipts.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows|model_runtime_admissions|model_live_invocations)\b/iu,
    );
  });
});
