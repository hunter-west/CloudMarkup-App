import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("changes pricing definitions without rewriting recorded customer financial rows", async () => {
  const source = await readFile(
    new URL(
      "../../../migrations/0082_beta_ai_credit_conversion.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(source).not.toMatch(
    /(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:credit_reservations|usage_ledger_entries|credit_grants|beta_ai_invocations)\b/iu,
  );
});
