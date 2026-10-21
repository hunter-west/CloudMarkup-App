import type { SqlDatabase } from "./sql.js";
import { requireRegisteredEvaluationSuccessor } from "./model-live-registered-successor-test-helpers.js";
/** Current registered event tests verify real migration admission; no overlay DDL. */
export async function requireRegisteredEventSuccessorMigration(
  database: SqlDatabase,
) {
  await requireRegisteredEvaluationSuccessor(database);
}
