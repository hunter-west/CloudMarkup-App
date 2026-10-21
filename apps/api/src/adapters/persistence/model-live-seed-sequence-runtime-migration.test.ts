import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";
describe("registered SQL for historical two-slot runtime proposal", () => {
  it("pins V4 while preserving historical registration and excluding financial mutations", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0103_model_live_seed_sequence_runtime.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "70c6aeb1c7d3c68fd3bb9aa38188175c058ab9d88bfe3fa71e84fa9ca2902df6",
    );
    expect(splitPostgresStatements(source)).toHaveLength(8);
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    expect(migrations.some((item) => item.version === "0064")).toBe(false);
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
  });
});
