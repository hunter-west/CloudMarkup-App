import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { RepositoryError } from "../../application/persistence.js";
import type { SqlDatabase, SqlExecutor, SqlRow } from "./sql.js";
import { sql } from "./sql.js";

interface MigrationManifestEntry {
  readonly checksumSha256: string;
  readonly file: string;
  readonly version: string;
}

interface MigrationManifest {
  readonly migrations: readonly MigrationManifestEntry[];
  readonly storageContractVersion: 1;
}

export interface LoadedMigration extends MigrationManifestEntry {
  readonly statements: readonly string[];
}

const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

function failInvalidMigration(): never {
  throw new RepositoryError(
    "invalid-input",
    "The database migration set is invalid.",
  );
}

function parseManifest(value: unknown): MigrationManifest {
  if (typeof value !== "object" || value === null) {
    return failInvalidMigration();
  }
  const manifestRecord = value as Readonly<Record<string, unknown>>;
  const entries = manifestRecord["migrations"];
  if (
    manifestRecord["storageContractVersion"] !== 1 ||
    !Array.isArray(entries)
  ) {
    return failInvalidMigration();
  }

  const migrations: MigrationManifestEntry[] = [];
  for (const valueEntry of entries as readonly unknown[]) {
    if (typeof valueEntry !== "object" || valueEntry === null) {
      return failInvalidMigration();
    }
    const entry = valueEntry as Readonly<Record<string, unknown>>;
    const version = entry["version"];
    const file = entry["file"];
    const checksumSha256 = entry["checksumSha256"];
    if (
      typeof version !== "string" ||
      typeof file !== "string" ||
      typeof checksumSha256 !== "string" ||
      !migrationFilePattern.test(file) ||
      version !== file.slice(0, 4) ||
      !sha256Pattern.test(checksumSha256)
    ) {
      return failInvalidMigration();
    }
    migrations.push({ checksumSha256, file, version });
  }

  const ordered = [...migrations].sort((left, right) =>
    left.version.localeCompare(right.version),
  );
  if (
    new Set(ordered.map((entry) => entry.version)).size !== ordered.length ||
    ordered.some((entry, index) => entry.version !== migrations[index]?.version)
  ) {
    return failInvalidMigration();
  }

  return { migrations, storageContractVersion: 1 };
}

export function splitPostgresStatements(source: string): readonly string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarTag: string | undefined;

  while (index < source.length) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
      }
      index += 1;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 2;
      } else if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (dollarTag !== undefined) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = undefined;
      } else {
        index += 1;
      }
      continue;
    }
    if (singleQuoted) {
      if (current === "'" && next === "'") {
        index += 2;
      } else {
        if (current === "'") {
          singleQuoted = false;
        }
        index += 1;
      }
      continue;
    }
    if (doubleQuoted) {
      if (current === '"' && next === '"') {
        index += 2;
      } else {
        if (current === '"') {
          doubleQuoted = false;
        }
        index += 1;
      }
      continue;
    }

    if (current === "-" && next === "-") {
      lineComment = true;
      index += 2;
      continue;
    }
    if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (current === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (current === '"') {
      doubleQuoted = true;
      index += 1;
      continue;
    }
    if (current === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
        source.slice(index),
      );
      if (match?.[0] !== undefined) {
        dollarTag = match[0];
        index += dollarTag.length;
        continue;
      }
    }
    if (current === ";") {
      const statement = source.slice(start, index).trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      start = index + 1;
    }
    index += 1;
  }

  if (
    singleQuoted ||
    doubleQuoted ||
    blockCommentDepth > 0 ||
    dollarTag !== undefined
  ) {
    return failInvalidMigration();
  }
  const trailing = source.slice(start).trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }
  return statements;
}

export async function loadMigrations(
  migrationsDirectory: string,
): Promise<readonly LoadedMigration[]> {
  const manifestValue: unknown = JSON.parse(
    await readFile(join(migrationsDirectory, "manifest.json"), "utf8"),
  );
  const manifest = parseManifest(manifestValue);
  const presentFiles = (await readdir(migrationsDirectory))
    .filter((file) => migrationFilePattern.test(file))
    .sort();
  if (
    presentFiles.length !== manifest.migrations.length ||
    presentFiles.some(
      (file, index) => file !== manifest.migrations[index]?.file,
    )
  ) {
    return failInvalidMigration();
  }

  return Promise.all(
    manifest.migrations.map(async (entry) => {
      const source = await readFile(join(migrationsDirectory, entry.file));
      const checksumSha256 = createHash("sha256").update(source).digest("hex");
      if (checksumSha256 !== entry.checksumSha256) {
        return failInvalidMigration();
      }
      return {
        ...entry,
        statements: splitPostgresStatements(source.toString("utf8")),
      };
    }),
  );
}

type AppliedMigrationRow = SqlRow & {
  readonly checksum_sha256: string;
  readonly version: string;
};

const createMigrationTable = sql(`
  CREATE TABLE IF NOT EXISTS cloudmarkup_schema_migrations (
    version VARCHAR(128) PRIMARY KEY,
    checksum_sha256 CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')
  )
`);

async function getAppliedMigration(
  executor: SqlExecutor,
  version: string,
): Promise<AppliedMigrationRow | null> {
  const result = await executor.query<AppliedMigrationRow>(
    sql(
      `SELECT version, checksum_sha256
       FROM cloudmarkup_schema_migrations
       WHERE version = $1`,
      [version],
    ),
  );
  return result.rows[0] ?? null;
}

export async function runMigrations(
  database: SqlDatabase,
  migrations: readonly LoadedMigration[],
): Promise<void> {
  await database.query(createMigrationTable);
  const knownVersions = new Set(
    migrations.map((migration) => migration.version),
  );
  const applied = await database.query<AppliedMigrationRow>(
    sql("SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations"),
  );
  for (const row of applied.rows) {
    if (!knownVersions.has(row.version)) {
      return failInvalidMigration();
    }
    const expected = migrations.find(
      (migration) => migration.version === row.version,
    );
    if (expected?.checksumSha256 !== row.checksum_sha256.trim()) {
      return failInvalidMigration();
    }
  }

  for (const migration of migrations) {
    await database.transaction(async (transaction) => {
      await transaction.query(
        sql("SELECT pg_advisory_xact_lock($1)", [21_000_000]),
      );
      const existing = await getAppliedMigration(
        transaction,
        migration.version,
      );
      if (existing !== null) {
        if (existing.checksum_sha256.trim() !== migration.checksumSha256) {
          return failInvalidMigration();
        }
        return;
      }
      const laterApplied = await transaction.query<AppliedMigrationRow>(
        sql(
          "SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations WHERE version > $1",
          [migration.version],
        ),
      );
      if (laterApplied.rows.length > 0) {
        return failInvalidMigration();
      }
      for (const statement of migration.statements) {
        await transaction.query(sql(statement));
      }
      await transaction.query(
        sql(
          `INSERT INTO cloudmarkup_schema_migrations (version, checksum_sha256)
           VALUES ($1, $2)`,
          [migration.version, migration.checksumSha256],
        ),
      );
    });
  }
}

export async function runSeedFile(
  database: SqlDatabase,
  seedFile: string,
): Promise<void> {
  const source = await readFile(seedFile, "utf8");
  const statements = splitPostgresStatements(source);
  await database.transaction(async (transaction) => {
    for (const statement of statements) {
      await transaction.query(sql(statement));
    }
  });
}
