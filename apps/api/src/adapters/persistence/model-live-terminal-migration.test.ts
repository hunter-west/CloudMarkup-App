import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";
describe("additive V2 failure-only terminal migration", () => {
  it("preserves 39 historical migrations and the shared financial algorithm", async () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const migrations = await loadMigrations(fileURLToPath(directory));
    expect(migrations).toHaveLength(120);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(1367);
    const addition = migrations.find((m) => m.version === "0040");
    expect(addition).toMatchObject({
      version: "0040",
      file: "0040_model_live_terminal_failures.sql",
      checksumSha256:
        "69d09aa4098aa4d18f6f2ef90c764c93cdfcb3812bc837c1f8ead6ba00d39d27",
    });
    expect(addition?.statements).toHaveLength(4);
    const previous = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 39)
        .map(({ version, file, checksumSha256 }) => ({
          version,
          file,
          checksumSha256,
        })),
    };
    const hash = (s: string | Uint8Array) =>
      createHash("sha256").update(s).digest("hex");
    expect(hash(JSON.stringify(previous, null, 2) + "\n")).toBe(
      "84ddd5433d66f39471a3b0651f8ed1a704c5636e7ae159039870abe712f7b414",
    );
    expect(hash(await readFile(new URL("manifest.json", directory)))).toBe(
      "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16",
    );
    const original =
      migrations
        .find((m) => m.version === "0029")
        ?.statements.find((s) =>
          s.includes("FUNCTION validate_model_commercial_accounting_outcome()"),
        ) ?? "";
    const current =
      addition?.statements.find((s) =>
        s.includes("FUNCTION validate_model_commercial_accounting_outcome()"),
      ) ?? "";
    const marker = "  pin:=w#>";
    expect(original.indexOf(marker)).toBeGreaterThan(0);
    expect(current.slice(current.indexOf(marker))).toBe(
      original.slice(original.indexOf(marker)),
    );
    expect(addition?.statements.join("\n")).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:credit_grants|usage_ledger_entries|credit_reservations|model_commercial_workflows)\b/iu,
    );
  });
});
