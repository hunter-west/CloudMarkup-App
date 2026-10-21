import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";
describe("registered SQL for historical first-seed canonical reservation proposal", () => {
  it("pins the exact four statements and preserves the historical migration authority", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0102_model_live_seed_commercial_reservations.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "5a2911d166649ae66f5f1bb6fce2641d239f52252de0fd1d3cc05d29030a9369",
    );
    expect(splitPostgresStatements(source)).toHaveLength(4);
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    expect(migrations.some((item) => item.version === "0063")).toBe(false);
    expect(
      migrations.find((item) => item.version === "0038")?.checksumSha256,
    ).toBe("645c31be59d93b0d9f849cde24cf498b6320b5ba5b4365ba0111aa46cfdae63a");
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
  });
});
