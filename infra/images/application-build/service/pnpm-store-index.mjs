import { DatabaseSync } from "node:sqlite";
import {
  chmod,
  link,
  lstat,
  readFile,
  realpath,
  rm,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CANONICAL_PNPM_STORE_INDEX_PATH = "v11/index-v1.json";
export const PNPM_STORE_INDEX_DATABASE_PATH = "v11/index.db";

const INDEX_KIND = "cloudmarkup.pnpm-store-index";
const MAXIMUM_INDEX_BYTES = 4 * 1024 * 1024;
const MAXIMUM_ENTRIES = 4_096;
const MAXIMUM_KEY_BYTES = 512;
const MAXIMUM_PACKAGE_IDENTIFIER_BYTES = 256;
const MAXIMUM_VALUE_BYTES = 2 * 1024 * 1024;
const PACKAGE_INDEX_SCHEMA = `CREATE TABLE package_index (
          key TEXT PRIMARY KEY,
          data BLOB NOT NULL
        ) WITHOUT ROWID`;
let restoreSequence = 0;

function fail(message) {
  throw new Error(`PNPM_STORE_INDEX_INVALID: ${message}`);
}

function plain(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value, expected) {
  if (!plain(value)) fail("expected an object");
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("object keys differ from the canonical schema");
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!plain(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return Buffer.from(
    `${JSON.stringify(canonicalize(value), null, 2)}\n`,
    "utf8",
  );
}

function compareKeys(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizedSql(value) {
  return String(value).replace(/\s+/gu, " ").trim().toLowerCase();
}

function assertDatabaseSchema(database) {
  const rows = database
    .prepare(
      "SELECT name, type, tbl_name AS tableName, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  if (
    rows.length !== 1 ||
    rows[0]?.name !== "package_index" ||
    rows[0]?.type !== "table" ||
    rows[0]?.tableName !== "package_index" ||
    normalizedSql(rows[0]?.sql) !== normalizedSql(PACKAGE_INDEX_SCHEMA)
  ) {
    fail("SQLite schema differs from pnpm 11 package_index");
  }
  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || Object.values(integrity[0] ?? {})[0] !== "ok") {
    fail("SQLite integrity check failed");
  }
}

function immutableDatabaseUrl(databasePath) {
  const url = pathToFileURL(databasePath);
  url.searchParams.set("immutable", "1");
  return url.href;
}

function comparablePath(path) {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

async function assertRealDirectory(path, expected) {
  const [metadata, canonicalPath] = await Promise.all([
    lstat(path).catch(() => undefined),
    realpath(path).catch(() => undefined),
  ]);
  if (
    metadata === undefined ||
    canonicalPath === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    comparablePath(canonicalPath) !== comparablePath(path) ||
    (expected !== undefined &&
      (metadata.dev !== expected.dev || metadata.ino !== expected.ino))
  ) {
    fail("store root must contain only stable real directories");
  }
  return { dev: metadata.dev, ino: metadata.ino, path };
}

async function resolveStoreLayout(storeRootInput) {
  const storeRoot = resolve(storeRootInput);
  const versionRoot = resolve(storeRoot, "v11");
  if (dirname(versionRoot) !== storeRoot) {
    fail("store version path escapes its root");
  }
  return {
    store: await assertRealDirectory(storeRoot),
    storeRoot,
    version: await assertRealDirectory(versionRoot),
    versionRoot,
  };
}

async function recheckStoreLayout(layout) {
  await assertRealDirectory(layout.storeRoot, layout.store);
  await assertRealDirectory(layout.versionRoot, layout.version);
}

async function assertSingleFile(path, maximumBytes) {
  const metadata = await lstat(path).catch(() => undefined);
  if (
    metadata === undefined ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size <= 0 ||
    metadata.size > maximumBytes
  ) {
    fail("index authority must be one bounded regular file");
  }
  return metadata;
}

async function assertNoDatabaseSidecars(databasePath) {
  for (const suffix of ["-journal", "-shm", "-wal"]) {
    if (
      (await lstat(`${databasePath}${suffix}`).catch(() => undefined)) !==
      undefined
    ) {
      fail("SQLite sidecars are forbidden");
    }
  }
}

async function removeDatabaseArtifacts(databasePath) {
  const failures = [];
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    try {
      await rm(`${databasePath}${suffix}`, { force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "PNPM_STORE_INDEX_INVALID: rejected SQLite artifacts could not be removed",
    );
  }
}

function canonicalEntry(key, data) {
  const keyParts = typeof key === "string" ? key.split("\t") : [];
  const integrity = keyParts[0]?.match(/^sha512-([A-Za-z0-9+/]{86}==)$/u);
  const packageIdentifier = keyParts[1];
  if (
    typeof key !== "string" ||
    keyParts.length !== 2 ||
    integrity === null ||
    packageIdentifier === undefined ||
    !/^[\x21-\x7e]+$/u.test(packageIdentifier) ||
    Buffer.byteLength(packageIdentifier, "ascii") >
      MAXIMUM_PACKAGE_IDENTIFIER_BYTES ||
    key !== key.normalize("NFC") ||
    Buffer.byteLength(key, "utf8") > MAXIMUM_KEY_BYTES
  ) {
    fail("package index key is invalid or unbounded");
  }
  const integrityBytes = Buffer.from(integrity[1], "base64");
  if (
    integrityBytes.byteLength !== 64 ||
    integrityBytes.toString("base64") !== integrity[1]
  ) {
    fail("package index integrity key is not canonical SHA-512 base64");
  }
  const bytes = Buffer.from(data);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_VALUE_BYTES) {
    fail("package index value is empty or unbounded");
  }
  return { dataBase64: bytes.toString("base64"), key };
}

function validateCanonicalIndex(value, bytes) {
  exactKeys(value, ["entries", "kind", "schemaVersion"]);
  if (
    value.schemaVersion !== 1 ||
    value.kind !== INDEX_KIND ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0 ||
    value.entries.length > MAXIMUM_ENTRIES
  ) {
    fail("canonical index identity or entry count differs");
  }
  let previous;
  let totalValueBytes = 0;
  const entries = value.entries.map((entry) => {
    exactKeys(entry, ["dataBase64", "key"]);
    if (typeof entry.dataBase64 !== "string") {
      fail("package index value is not canonical base64");
    }
    const data = Buffer.from(entry.dataBase64, "base64");
    const canonical = canonicalEntry(entry.key, data);
    if (canonical.dataBase64 !== entry.dataBase64) {
      fail("package index value is not canonical base64");
    }
    if (previous !== undefined && compareKeys(previous, entry.key) >= 0) {
      fail("package index keys are not strictly byte-sorted and unique");
    }
    previous = entry.key;
    totalValueBytes += data.byteLength;
    if (totalValueBytes > MAXIMUM_INDEX_BYTES) {
      fail("package index values exceed the aggregate bound");
    }
    return { data, key: entry.key };
  });
  if (!canonicalJson(value).equals(bytes)) {
    fail("canonical index JSON bytes differ");
  }
  return entries;
}

export async function exportCanonicalPnpmStoreIndex(storeRootInput) {
  const layout = await resolveStoreLayout(storeRootInput);
  const { storeRoot } = layout;
  const databasePath = resolve(
    storeRoot,
    ...PNPM_STORE_INDEX_DATABASE_PATH.split("/"),
  );
  const outputPath = resolve(
    storeRoot,
    ...CANONICAL_PNPM_STORE_INDEX_PATH.split("/"),
  );
  const before = await assertSingleFile(databasePath, MAXIMUM_INDEX_BYTES);
  await assertNoDatabaseSidecars(databasePath);
  if ((await lstat(outputPath).catch(() => undefined)) !== undefined) {
    fail("canonical index output already exists");
  }
  const database = new DatabaseSync(immutableDatabaseUrl(databasePath), {
    readOnly: true,
  });
  let entries;
  try {
    assertDatabaseSchema(database);
    entries = database
      .prepare(
        "SELECT key, data, typeof(key) AS keyType, typeof(data) AS dataType FROM package_index ORDER BY key COLLATE BINARY",
      )
      .all()
      .map((row) => {
        if (row.keyType !== "text" || row.dataType !== "blob") {
          fail("package index key/data storage classes differ");
        }
        return canonicalEntry(row.key, row.data);
      });
  } finally {
    database.close();
  }
  await assertNoDatabaseSidecars(databasePath);
  if (entries.length === 0 || entries.length > MAXIMUM_ENTRIES) {
    fail("package index entry count is empty or unbounded");
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (compareKeys(entries[index - 1].key, entries[index].key) >= 0) {
      fail("SQLite package index ordering is not canonical");
    }
  }
  const after = await assertSingleFile(databasePath, MAXIMUM_INDEX_BYTES);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    fail("SQLite package index changed while it was read");
  }
  const bytes = canonicalJson({
    entries,
    kind: INDEX_KIND,
    schemaVersion: 1,
  });
  if (bytes.byteLength > MAXIMUM_INDEX_BYTES) {
    fail("canonical package index exceeds its byte bound");
  }
  await recheckStoreLayout(layout);
  await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
  await recheckStoreLayout(layout);
  try {
    await unlink(databasePath);
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }
  await recheckStoreLayout(layout);
  return {
    entryCount: entries.length,
    path: CANONICAL_PNPM_STORE_INDEX_PATH,
    sizeBytes: bytes.byteLength,
  };
}

async function readCanonicalPnpmStoreIndex(storeRoot) {
  const path = resolve(
    storeRoot,
    ...CANONICAL_PNPM_STORE_INDEX_PATH.split("/"),
  );
  const before = await assertSingleFile(path, MAXIMUM_INDEX_BYTES);
  const bytes = await readFile(path);
  const after = await assertSingleFile(path, MAXIMUM_INDEX_BYTES);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    bytes.byteLength !== after.size
  ) {
    fail("canonical package index changed while it was read");
  }
  if (bytes.includes(0)) fail("canonical package index contains NUL bytes");
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("canonical package index JSON cannot be parsed");
  }
  return { entries: validateCanonicalIndex(value, bytes), path };
}

export async function restoreCanonicalPnpmStoreIndex(storeRootInput) {
  const layout = await resolveStoreLayout(storeRootInput);
  const { storeRoot, versionRoot } = layout;
  const databasePath = resolve(
    storeRoot,
    ...PNPM_STORE_INDEX_DATABASE_PATH.split("/"),
  );
  if ((await lstat(databasePath).catch(() => undefined)) !== undefined) {
    fail("SQLite package index already exists");
  }
  await assertNoDatabaseSidecars(databasePath);
  const { entries } = await readCanonicalPnpmStoreIndex(storeRoot);
  restoreSequence += 1;
  const temporaryPath = resolve(
    versionRoot,
    `.index.db.restore-${String(process.pid)}-${String(restoreSequence)}`,
  );
  if ((await lstat(temporaryPath).catch(() => undefined)) !== undefined) {
    fail("temporary SQLite package index already exists");
  }
  let database;
  let verification;
  let published = false;
  try {
    database = new DatabaseSync(temporaryPath);
    database.exec("PRAGMA page_size=4096");
    database.exec("PRAGMA journal_mode=OFF");
    database.exec("PRAGMA synchronous=OFF");
    database.exec("PRAGMA temp_store=MEMORY");
    database.exec(PACKAGE_INDEX_SCHEMA);
    const insert = database.prepare(
      "INSERT INTO package_index (key, data) VALUES (?, ?)",
    );
    database.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      for (const entry of entries) insert.run(entry.key, entry.data);
      database.exec("COMMIT");
      committed = true;
    } finally {
      if (!committed) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Preserve the original deterministic restoration error.
        }
      }
    }
    database.exec("VACUUM");
    assertDatabaseSchema(database);
    database.close();
    database = undefined;
    verification = new DatabaseSync(immutableDatabaseUrl(temporaryPath), {
      readOnly: true,
    });
    assertDatabaseSchema(verification);
    const rows = verification
      .prepare(
        "SELECT key, data, typeof(key) AS keyType, typeof(data) AS dataType FROM package_index ORDER BY key COLLATE BINARY",
      )
      .all();
    if (rows.length !== entries.length) {
      fail("restored package index entry count differs");
    }
    for (const [index, row] of rows.entries()) {
      if (
        row.key !== entries[index].key ||
        row.keyType !== "text" ||
        row.dataType !== "blob" ||
        !Buffer.from(row.data).equals(entries[index].data)
      ) {
        fail("restored package index row differs");
      }
    }
    verification.close();
    verification = undefined;
    await assertNoDatabaseSidecars(temporaryPath);
    await assertSingleFile(temporaryPath, MAXIMUM_INDEX_BYTES);
    await utimes(temporaryPath, 0, 0);
    await chmod(temporaryPath, 0o444);
    await recheckStoreLayout(layout);
    await link(temporaryPath, databasePath);
    published = true;
    await unlink(temporaryPath);
    await recheckStoreLayout(layout);
    await assertSingleFile(databasePath, MAXIMUM_INDEX_BYTES);
    verification = new DatabaseSync(immutableDatabaseUrl(databasePath), {
      readOnly: true,
    });
    assertDatabaseSchema(verification);
    const publishedRows = verification
      .prepare(
        "SELECT key, data FROM package_index ORDER BY key COLLATE BINARY",
      )
      .all();
    if (
      publishedRows.length !== entries.length ||
      publishedRows.some(
        (row, index) =>
          row.key !== entries[index].key ||
          !Buffer.from(row.data).equals(entries[index].data),
      )
    ) {
      fail("published package index differs from canonical authority");
    }
    verification.close();
    verification = undefined;
    await assertNoDatabaseSidecars(databasePath);
    await utimes(databasePath, 0, 0);
    await chmod(databasePath, 0o444);
    return { entryCount: entries.length, path: databasePath };
  } catch (error) {
    for (const handle of [verification, database]) {
      try {
        handle?.close();
      } catch {
        // Exact artifact cleanup below remains mandatory.
      }
    }
    try {
      await removeDatabaseArtifacts(temporaryPath);
      if (published) await removeDatabaseArtifacts(databasePath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "PNPM_STORE_INDEX_INVALID: restoration and cleanup failed",
      );
    }
    throw error;
  }
}

async function runCli(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "restore") {
    throw new Error("Usage: node pnpm-store-index.mjs restore <store-root>");
  }
  await restoreCanonicalPnpmStoreIndex(arguments_[1]);
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(resolve(entry)).href
) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "pnpm store index restoration failed"}\n`,
    );
    process.exitCode = 1;
  }
}
