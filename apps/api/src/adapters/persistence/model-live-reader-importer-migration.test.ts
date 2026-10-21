import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

/** Registered bytes, not a second proposal loader or permission to execute AI. */
describe("registered evaluation invocation and parser metadata migrations", () => {
  it("retains all55 historical migrations and appends only the reviewed15 statements", async () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const migrations = (await loadMigrations(fileURLToPath(directory))).filter(
      ({ version }) => version <= "0057",
    );
    expect(migrations).toHaveLength(57);
    expect(
      migrations.reduce((sum, entry) => sum + entry.statements.length, 0),
    ).toBe(602);
    const prefix = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 55)
        .map(({ version, file, checksumSha256 }) => ({
          version,
          file,
          checksumSha256,
        })),
    };
    const digest = (value: string | Uint8Array) =>
      createHash("sha256").update(value).digest("hex");
    expect(digest(JSON.stringify(prefix, null, 2) + "\n")).toBe(
      "86653055e5aa6ed0ec5a022dfb7d056ccf986da11ea706494aa9657e338b82ab",
    );
    expect(
      digest(
        JSON.stringify(
          {
            storageContractVersion: 1,
            migrations: migrations.map(({ version, file, checksumSha256 }) => ({
              version,
              file,
              checksumSha256,
            })),
          },
          null,
          2,
        ) + "\n",
      ),
    ).toBe("5946daa4042a113b67ad011d942a32cb219e1474d03c3734da3a9724d90f6399");
    const entries = migrations.slice(55);
    expect(
      entries.map(({ version, file, checksumSha256 }) => ({
        version,
        file,
        checksumSha256,
      })),
    ).toEqual([
      {
        version: "0056",
        file: "0056_model_live_invocation_sets.sql",
        checksumSha256:
          "6b753f02718875609a1c39b526569bb385901372ffbc6ae26c402a5ce98371a2",
      },
      {
        version: "0057",
        file: "0057_model_live_parser_input_receipts.sql",
        checksumSha256:
          "67b5381a6e46f30d3b71635d7fddd6d047a73c66e808106a21e685697a656184",
      },
    ]);
    expect(entries.map(({ statements }) => statements.length)).toEqual([6, 9]);
    for (const entry of entries) {
      const source = await readFile(new URL(entry.file, directory), "utf8");
      expect(digest(source)).toBe(entry.checksumSha256);
      expect(source).not.toContain("INTEGRATION PROPOSAL ONLY");
      expect(source).not.toMatch(/(?:DROP TABLE|DISABLE TRIGGER|GRANT)\s/iu);
      expect(source).not.toMatch(
        /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:usage_ledger_entries|credit_grants|organization_subscription_projections|solution_export_artifacts)\b/iu,
      );
    }
  });
});
