import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("additive V2 host evidence migration", () => {
  it("adds host evidence metadata without changing invocation, runtime or financial rows", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0041_model_live_runtime_host_evidence.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows|model_runtime_admissions|model_live_invocations)\b/iu,
    );
  });
});
