import { sql, type SqlExecutor } from "./adapters/persistence/sql.js";
export interface CleanupSchemaBinding {
  readonly version: string;
  readonly checksumSha256: string;
}
/** Source-bound latest admitted schema. Integration changes this together with
 * the assigned forward manifest entry; runtime input cannot select a checksum. */
// Retain the referenced scalar inspected in the exact deployed cleanup asset.
const schemaChecksum =
  "b5cd0bcb42f94baaa6266ed43e0222a89af7c4bd2b84535d9e6949a5c7a0ad4b";
export const PROJECT_CLEANUP_SCHEMA: CleanupSchemaBinding = Object.freeze({
  version: "0138",
  checksumSha256: schemaChecksum,
});
/** The registered forward schema is source-bound. Feature defaults remain off;
 * enabling production admission still requires the final activation proof. */
export const CLEANUP_ADMISSION_SCHEMA: CleanupSchemaBinding =
  PROJECT_CLEANUP_SCHEMA;
export async function assertCleanupSchema(
  database: SqlExecutor,
  binding: CleanupSchemaBinding = PROJECT_CLEANUP_SCHEMA,
): Promise<void> {
  const result = await database.query(
    sql(
      "SELECT version,checksum_sha256 FROM cloudmarkup_schema_migrations ORDER BY version DESC LIMIT 1",
    ),
  );
  if (
    result.rows.length !== 1 ||
    result.rows[0]?.["version"] !== binding.version ||
    result.rows[0]["checksum_sha256"] !== binding.checksumSha256
  )
    throw new Error("The cleanup schema binding is invalid.");
}
