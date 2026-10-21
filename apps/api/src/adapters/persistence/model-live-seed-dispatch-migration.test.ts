import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";
describe("registered SQL for historical first-dispatch journal proposal", () => {
  it("pins the exact four statements and preserves the historical migration authority", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0105_model_live_sequence_attempt_journal.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "d1799be22c112e46e5367ddaa52dfe5c89164ba36b6edb2b06469c2b88f5edd4",
    );
    expect(splitPostgresStatements(source)).toHaveLength(4);
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    expect(migrations.some((item) => item.version === "0066")).toBe(false);
    expect(
      migrations.find((item) => item.version === "0038")?.checksumSha256,
    ).toBe("645c31be59d93b0d9f849cde24cf498b6320b5ba5b4365ba0111aa46cfdae63a");
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
  });
});
