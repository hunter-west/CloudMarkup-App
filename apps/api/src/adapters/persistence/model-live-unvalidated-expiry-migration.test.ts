import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

describe("additive expiry of known unvalidated completion", () => {
  it("preserves every historical migration byte and the canonical financial calculation", async () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const migrations = await loadMigrations(fileURLToPath(directory));
    expect(migrations).toHaveLength(120);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(1367);
    const prior = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 44)
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
    ).toBe("7aa542bf19cdb358a9927b667db57338ae24bd6c27314f393b5db88b6999bc84");
    const addition = migrations.find((m) => m.version === "0045");
    expect(addition).toMatchObject({
      version: "0045",
      file: "0045_model_live_unvalidated_completion_expiry.sql",
      checksumSha256:
        "861026d36e00c73a474a5d45a2dbbf1da7591c9401e61bce5fd00a68182a1b59",
    });
    expect(addition?.statements).toHaveLength(2);
    const previous = await readFile(
      new URL("0044_model_live_evaluation_settlement.sql", directory),
      "utf8",
    );
    const current = await readFile(
      new URL("0045_model_live_unvalidated_completion_expiry.sql", directory),
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
