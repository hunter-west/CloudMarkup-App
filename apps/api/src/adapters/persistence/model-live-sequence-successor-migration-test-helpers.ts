import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { splitPostgresStatements } from "./migrations.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

import { requireRegisteredEvaluationSuccessor } from "./model-live-registered-successor-test-helpers.js";

/** Historical proposal control only; never called by current registered suites. */
export async function requireRegisteredSequencePredecessor57(
  database: SqlExecutor,
) {
  await requireRegisteredEvaluationSuccessor(database, "0057");
}

/** One disposable-schema transaction only. Both separately frozen proposal bodies
 * stay unregistered; the legacy31 metadata-only control is a distinct test. */
export async function applyProposedSequenceMigrationForRegistered57(
  database: SqlDatabase,
) {
  const [metadata, reciprocal] = await Promise.all([
    readFile(
      new URL(
        "../../../migration-proposals/model-live-sequences.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../migration-proposals/model-live-sequence-reservations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  if (
    createHash("sha256").update(metadata).digest("hex") !==
      "ef8dedec5318d27c4c124dc14475b3019d02c8e1e03923eadc684b4d15e2c668" ||
    createHash("sha256").update(reciprocal).digest("hex") !==
      "5fafa43ee97f3f6ce92073e7c76297fa2eb0c2180418b76de26071c241e3e4d1"
  )
    throw Error("Both exact prospective0058 source bodies are required.");
  const first = splitPostgresStatements(metadata),
    second = splitPostgresStatements(reciprocal);
  if (first.length !== 22 || second.length !== 7)
    throw Error("The exact29-statement prospective0058 is required.");
  await database.transaction(async (transaction) => {
    await requireRegisteredSequencePredecessor57(transaction);
    for (const statement of [...first, ...second])
      await transaction.query(sql(statement));
    // Applying a proposal must not impersonate a registered migration.
    await requireRegisteredSequencePredecessor57(transaction);
  });
}
