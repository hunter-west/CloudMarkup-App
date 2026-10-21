import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

describe("additive receipt-backed live evaluation settlement", () => {
  it("preserves every historical migration byte and the canonical financial calculation", async () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const migrations = await loadMigrations(fileURLToPath(directory));
    expect(migrations).toHaveLength(120);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(1367);
    const prior = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 43)
        .map(({ version, file, checksumSha256 }) => ({
          version,
          file,
          checksumSha256,
        })),
    };
    expect(
      createHash("sha256")
        .update(JSON.stringify(prior, null, 2) + "\n")
        .digest("hex"),
    ).toBe("5a6620c52644d1011d6d23522f931755d7c9b13809372eb53c3ada630890a685");
    const addition = migrations.find(
      (migration) => migration.version === "0044",
    );
    expect(addition).toMatchObject({
      version: "0044",
      file: "0044_model_live_evaluation_settlement.sql",
      checksumSha256:
        "afa6518c2ecdf9b5c7a1eb7c8682e5a6e7b6b9709cdd4b7762aeadd41a37efbf",
    });
    expect(addition?.statements).toHaveLength(5);
    const previous = await readFile(
      new URL("0042_model_live_no_dispatch_expiry.sql", directory),
      "utf8",
    );
    const current = await readFile(
      new URL("0044_model_live_evaluation_settlement.sql", directory),
      "utf8",
    );
    const financial = (sql: string) => {
      const start = sql.indexOf("  pin:=w#>");
      return sql
        .slice(start, sql.indexOf("\n$$;", start))
        .replaceAll("\r\n", "\n");
    };
    expect(financial(current)).toBe(financial(previous));
    expect(addition?.statements.join("\n")).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows|model_runtime_admissions|model_live_invocations)\b/iu,
    );
  });
});
