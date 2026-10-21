import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { splitPostgresStatements } from "./migrations.js";
import { loadRegisteredEvaluationSuccessor } from "./model-live-registered-successor-test-helpers.js";

it("preserves all57 registered bytes and registers the exact atomic29 plus3 bodies", async () => {
  const migrations = await loadRegisteredEvaluationSuccessor();
  expect(migrations).toHaveLength(59);
  expect(
    migrations.reduce((sum, migration) => sum + migration.statements.length, 0),
  ).toBe(634);
  const proposalDirectory = new URL(
    "../../../migration-proposals/",
    import.meta.url,
  );
  const frozen = [
    [
      "model-live-sequences.sql",
      "ef8dedec5318d27c4c124dc14475b3019d02c8e1e03923eadc684b4d15e2c668",
      22,
    ],
    [
      "model-live-sequence-reservations.sql",
      "5fafa43ee97f3f6ce92073e7c76297fa2eb0c2180418b76de26071c241e3e4d1",
      7,
    ],
    [
      "0059_model_live_event_criterion_policy.sql",
      "2cf825ee763aaf2277b0b8f319cb5a5186744809b9ab58a2ee81b73fb3eaf026",
      3,
    ],
  ] as const;
  const parsed: string[][] = [];
  const stripHeader = (statement: string) =>
    statement.replace(/^(?:--[^\n]*\n|\s)+/u, "");
  for (const [file, hash, count] of frozen) {
    const bytes = await readFile(new URL(file, proposalDirectory));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    const statements = splitPostgresStatements(bytes.toString("utf8"));
    expect(statements).toHaveLength(count);
    parsed.push(statements.map(stripHeader));
  }
  const sequence = migrations.find((migration) => migration.version === "0058");
  const event = migrations.find((migration) => migration.version === "0059");
  expect(sequence?.statements.map(stripHeader)).toEqual([
    ...(parsed[0] ?? []),
    ...(parsed[1] ?? []),
  ]);
  expect(event?.statements.map(stripHeader)).toEqual(parsed[2]);
  expect(
    sequence?.statements.join("\n").match(/CREATE (?:OR REPLACE )?FUNCTION/gu),
  ).toHaveLength(12);
  expect(sequence?.statements.join("\n").match(/\$\$/gu)).toHaveLength(24);
  expect(
    event?.statements.join("\n").match(/CREATE (?:OR REPLACE )?FUNCTION/gu),
  ).toHaveLength(3);
  expect(event?.statements.join("\n").match(/\$\$/gu)).toHaveLength(6);
  const bundled = await readFile(
    new URL(
      "../../../../../infra/platform/runtime/database-migrator.ts",
      import.meta.url,
    ),
    "utf8",
  );
  expect(bundled).toContain('"0058_model_live_sequences.sql": migration0058');
  expect(bundled).toContain(
    '"0059_model_live_event_criterion_policy.sql": migration0059',
  );
});
