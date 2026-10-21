import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3 } from "@cloudmarkup/schemas";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";

describe("historical V3 proposal and registered successor boundary", () => {
  it("registers the atomic metadata and reciprocal guards without provider execution tables", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    const sequence = migrations.find(
      (migration) => migration.version === "0058",
    );
    expect(sequence?.file).toBe("0058_model_live_sequences.sql");
    expect(sequence?.statements).toHaveLength(29);
    const production = sequence?.statements.join("\n");
    expect(production).toContain("model_live_sequence_plans");
    expect(production).toContain("model_live_sequence_selections");
    expect(production).not.toMatch(
      /CREATE TABLE\s+model_live_sequence_(?:inputs|dispatches|outcomes|reports)/u,
    );
    expect(
      migrations.every(
        (migration) => !migration.file.includes("migration-proposals"),
      ),
    ).toBe(true);
  });
  it("keeps the proposal recipe pin exact without publishing an execution or receipt table", async () => {
    const source = await readFile(
      new URL(
        "../../../migration-proposals/model-live-sequences.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain(
      "PROSPECTIVE 0058 / INTEGRATION-PENDING PROPOSAL ONLY",
    );
    expect(source).toContain(
      `c->>'recipeDigest'='${MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3}'`,
    );
    // Guards the actual replacement-token corruption caught in source review.
    // PostgreSQL installation is still required to prove SQL syntax and behavior.
    const declarations = [
      ...source.matchAll(/^CREATE (?:FUNCTION|TRIGGER|TABLE)\s+(\w+)/gmu),
    ].map((match) => match[1]);
    expect(new Set(declarations).size).toBe(declarations.length);
    expect(source.match(/^CREATE FUNCTION/gmu)).toHaveLength(8);
    expect(source.match(/\$\$/gu)).toHaveLength(16);
    expect(source).not.toMatch(/^RETURNS .* AS \$$/mu);
    expect(source).not.toMatch(/^\$ LANGUAGE/mu);
    const statements = splitPostgresStatements(source);
    expect(
      statements.filter((statement) =>
        /CREATE TABLE\s+model_live_sequence_/u.test(statement),
      ),
    ).toHaveLength(3);
    expect(source).not.toMatch(
      /CREATE TABLE\s+model_live_sequence_(?:inputs|dispatches|outcomes|reports)/u,
    );
  });
});
