import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";
describe("registered SQL for historical first-seed runtime proposal", () => {
  it("pins the exact seven statements and preserves the historical migration authority", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0101_model_live_seed_runtime_admissions.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "7e6cc4dad77b980ad4da45f27668ac67b5feb64aeec53b5c14aac24aafe23fc3",
    );
    expect(splitPostgresStatements(source)).toHaveLength(7);
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    expect(migrations.some((item) => item.version === "0062")).toBe(false);
    expect(
      migrations.find((item) => item.version === "0037")?.checksumSha256,
    ).toBe("e7c152430e8554568ebd5a2e9f3885d5ba40be5b29f590b8a6443f44a18a45ed");
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
  });
});
