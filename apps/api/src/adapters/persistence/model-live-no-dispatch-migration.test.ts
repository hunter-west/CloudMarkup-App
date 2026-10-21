import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

describe("additive live no-dispatch expiry migration", () => {
  it("preserves all historical bytes and the entire shared financial projection", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    expect(migrations).toHaveLength(120);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(1367);
    const previous = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 41)
        .map(({ version, file, checksumSha256 }) => ({
          version,
          file,
          checksumSha256,
        })),
    };
    expect(
      createHash("sha256")
        .update(JSON.stringify(previous, null, 2) + "\n")
        .digest("hex"),
    ).toBe("896622c11be243b9bc49b63a3d9d61b3a52b26e85e2f65673db60f61b6a6d1bc");
    const addition = migrations.find(
      (migration) => migration.version === "0042",
    );
    expect(addition).toMatchObject({
      version: "0042",
      file: "0042_model_live_no_dispatch_expiry.sql",
      checksumSha256:
        "c002d77ed254f4f8ca08534bcf2ece8f21fcee51c68b13108ce4d1ebe89e1bf1",
    });
    expect(addition?.statements).toHaveLength(1);
    const original =
      migrations
        .find((m) => m.version === "0040")
        ?.statements.find((s) =>
          s.includes("FUNCTION validate_model_commercial_accounting_outcome()"),
        ) ?? "";
    const current = addition?.statements[0] ?? "";
    const marker = "  e:=NEW.outcome";
    expect(original.indexOf(marker)).toBeGreaterThan(0);
    expect(current.slice(current.indexOf(marker))).toBe(
      original.slice(original.indexOf(marker)),
    );
    expect(current).toContain("NEW.source_kind='workflow-receipt' AND EXISTS");
    expect(current).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
  });
});
