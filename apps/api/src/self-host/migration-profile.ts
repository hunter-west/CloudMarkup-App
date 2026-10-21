import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadMigrations,
  runMigrations,
  splitPostgresStatements,
  type LoadedMigration,
} from "../adapters/persistence/migrations.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "../adapters/persistence/sql.js";

export const SELF_HOST_PROFILE_ID = "cloudmarkup-standalone-pg17-v1";
export const SELF_HOST_PROFILE_VERSION = 1;
export const SELF_HOST_SCHEMA_OWNER = "cloudmarkup_admin";
export const SELF_HOST_BOOTSTRAP_GRANTOR = "cloudmarkup_owner";
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const canonicalDirectory = join(apiDirectory, "migrations");
const profileDirectory = join(apiDirectory, "self-host-migrations");
const privateFile = "0127_private_notes_and_gpt6_receipt_authorities.sql";
const privateTags = [
  "cm_private_bootstrap_admission",
  "cm_private_bootstrap_owner_edge",
  "cm_private_bootstrap_final",
] as const;
const shaPattern = /^[a-f0-9]{64}$/u;

export class SelfHostMigrationProfileError extends Error {
  readonly code = "self-host-migration-profile-unavailable";
  constructor() {
    super("The standalone migration profile is unavailable.");
  }
}
function refuse(): never {
  throw new SelfHostMigrationProfileError();
}
function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
async function source(
  directory: string,
  file: string,
  expected: string,
): Promise<string> {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/u.test(file) || !shaPattern.test(expected))
    refuse();
  const path = join(directory, file);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) refuse();
  const bytes = await readFile(path);
  if (digest(bytes) !== expected) refuse();
  return bytes.toString("utf8");
}
function block(text: string, tag: string): string {
  const matches = text.match(
    new RegExp(`DO \\$${tag}\\$[\\s\\S]*?\\$${tag}\\$;`, "gu"),
  );
  if (matches?.length !== 1) refuse();
  return matches[0];
}
export interface SelfHostMigrationProfileIdentity {
  readonly profileId: typeof SELF_HOST_PROFILE_ID;
  readonly profileVersion: 1;
  readonly engineMajor: 17;
  readonly owner: typeof SELF_HOST_SCHEMA_OWNER;
  readonly bootstrapGrantor: typeof SELF_HOST_BOOTSTRAP_GRANTOR;
  readonly manifestSha256: string;
  readonly canonicalManifestSha256: string;
  readonly identityChecksumSha256: string;
  readonly privateReceiptChecksumSha256: string;
}
export interface SelfHostMigrationProfile {
  readonly identity: SelfHostMigrationProfileIdentity;
  readonly migrations: readonly LoadedMigration[];
}

/** Reuse every canonical statement except the three exact 0127 operational
 * blocks. Canonical bytes/registry stay unchanged, including protected RDS
 * admission; callers cannot supply SQL, owner aliases or a replacement recipe. */
export async function loadSelfHostMigrationProfile(
  directories: {
    readonly canonicalDirectory?: string;
    readonly profileDirectory?: string;
  } = {},
): Promise<SelfHostMigrationProfile> {
  const canonical = directories.canonicalDirectory ?? canonicalDirectory;
  const portable = directories.profileDirectory ?? profileDirectory;
  const manifestBytes = await readFile(join(portable, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    profileId: string;
    profileVersion: number;
    engineMajor: number;
    owner: string;
    bootstrapGrantor: string;
    canonicalManifestSha256: string;
    identityMigration: {
      file: string;
      version: string;
      checksumSha256: string;
    };
    privateReceiptReplacement: {
      file: string;
      version: string;
      canonicalFile: string;
      canonicalChecksumSha256: string;
      checksumSha256: string;
      assembledChecksumSha256: string;
    };
  };
  if (
    manifest.profileId !== SELF_HOST_PROFILE_ID ||
    manifest.profileVersion !== 1 ||
    manifest.engineMajor !== 17 ||
    manifest.owner !== SELF_HOST_SCHEMA_OWNER ||
    manifest.bootstrapGrantor !== SELF_HOST_BOOTSTRAP_GRANTOR ||
    !shaPattern.test(manifest.canonicalManifestSha256)
  )
    refuse();
  if (
    digest(await readFile(join(canonical, "manifest.json"))) !==
    manifest.canonicalManifestSha256
  )
    refuse();
  const identity = manifest.identityMigration,
    replacement = manifest.privateReceiptReplacement;
  if (
    identity.version !== "0000" ||
    identity.file !== "0000_self_host_profile_identity.sql" ||
    replacement.version !== "0127" ||
    replacement.canonicalFile !== privateFile ||
    replacement.file !== "0127_self_host_private_receipt_definitions.sql" ||
    !shaPattern.test(replacement.assembledChecksumSha256)
  )
    refuse();
  const present = (await readdir(portable))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (
    JSON.stringify(present) !==
    JSON.stringify([identity.file, replacement.file])
  )
    refuse();
  const identitySource = await source(
    portable,
    identity.file,
    identity.checksumSha256,
  );
  const replacements = await source(
    portable,
    replacement.file,
    replacement.checksumSha256,
  );
  let assembled = await source(
    canonical,
    privateFile,
    replacement.canonicalChecksumSha256,
  );
  for (const tag of privateTags)
    assembled = assembled.replace(
      block(assembled, tag),
      block(replacements, tag),
    );
  if (
    splitPostgresStatements(replacements).length !== 3 ||
    digest(assembled) !== replacement.assembledChecksumSha256
  )
    refuse();
  const common = await loadMigrations(canonical);
  if (
    common.some((migration) => migration.version === "0000") ||
    common.filter(
      (migration) =>
        migration.version === "0127" &&
        migration.checksumSha256 === replacement.canonicalChecksumSha256,
    ).length !== 1
  )
    refuse();
  const migrations = [
    { ...identity, statements: splitPostgresStatements(identitySource) },
    ...common.map((migration) =>
      migration.version === "0127"
        ? {
            version: "0127",
            file: replacement.file,
            checksumSha256: replacement.assembledChecksumSha256,
            statements: splitPostgresStatements(assembled),
          }
        : migration,
    ),
  ].map((migration) =>
    Object.freeze({
      ...migration,
      statements: Object.freeze([...migration.statements]),
    }),
  );
  return Object.freeze({
    identity: Object.freeze({
      profileId: SELF_HOST_PROFILE_ID,
      profileVersion: 1,
      engineMajor: 17,
      owner: SELF_HOST_SCHEMA_OWNER,
      bootstrapGrantor: SELF_HOST_BOOTSTRAP_GRANTOR,
      manifestSha256: digest(manifestBytes),
      canonicalManifestSha256: manifest.canonicalManifestSha256,
      identityChecksumSha256: identity.checksumSha256,
      privateReceiptChecksumSha256: replacement.assembledChecksumSha256,
    }),
    migrations: Object.freeze(migrations),
  });
}

const postureSql =
  sql(`SELECT pg_catalog.current_database() AS database_name,session_user::text AS login,current_user::text AS effective_role,
  pg_catalog.current_setting('server_version_num')::integer AS server_version,pg_catalog.current_setting('session_replication_role') AS replication_role,
  pg_catalog.current_setting('createrole_self_grant') AS self_grant,
  NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('rdsadmin','rds_superuser')) AS standalone,
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_owner' AND rolsuper AND rolcanlogin) AS bootstrap_owner,
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_database d ON d.datdba=r.oid
    WHERE r.rolname='cloudmarkup_admin' AND d.datname=pg_catalog.current_database() AND r.rolcanlogin AND r.rolcreaterole
      AND NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolbypassrls AND NOT r.rolreplication AND NOT r.rolcreatedb
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles target ON target.oid=m.roleid
        JOIN pg_catalog.pg_roles grantor ON grantor.oid=m.grantor WHERE m.member=r.oid AND NOT
          (target.rolname IN ('cloudmarkup_notes_native_lock_owner','cloudmarkup_notes_publication_authority','cloudmarkup_notes_shared_native_producer','cloudmarkup_gpt6_private_receipt_issuer')
            AND grantor.rolname='cloudmarkup_owner' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option))) AS safe_owner,
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
    AND NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolbypassrls AND NOT r.rolreplication AND NOT r.rolcreatedb
    AND ((r.rolname='cloudmarkup_admin' AND r.rolcreaterole) OR (r.rolname IN
      ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime','cloudmarkup_beta_billing_runtime')
      AND NOT r.rolcreaterole AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
      AND NOT pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CREATE, TEMP')
      AND NOT pg_catalog.has_schema_privilege(r.oid,'public','CREATE')
      AND NOT pg_catalog.has_parameter_privilege(r.oid,'session_replication_role','SET, ALTER SYSTEM')))) AS safe_caller,
  pg_catalog.to_regclass('public.cloudmarkup_installation_profile') IS NOT NULL AS has_profile,
  pg_catalog.to_regclass('public.cloudmarkup_schema_migrations') IS NOT NULL AS has_ledger,
  EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','S','f')
      AND c.oid IS DISTINCT FROM pg_catalog.to_regclass('public.cloudmarkup_schema_migrations')) AS has_unmarked_objects,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') AS has_unmarked_functions`);
export function assertSelfHostProfilePosture(
  row: SqlRow | undefined,
  operator = false,
): void {
  const version = row?.["server_version"];
  const permitted = [
    SELF_HOST_SCHEMA_OWNER,
    "cloudmarkup_beta_api_runtime",
    "cloudmarkup_beta_proposal_runtime",
    "cloudmarkup_beta_export_runtime",
    "cloudmarkup_beta_cleanup_runtime",
    "cloudmarkup_beta_billing_runtime",
  ];
  if (
    row?.["database_name"] !== "cloudmarkup" ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 170000 ||
    version >= 180000 ||
    row["replication_role"] !== "origin" ||
    row["self_grant"] !== "" ||
    row["standalone"] !== true ||
    row["bootstrap_owner"] !== true ||
    row["safe_owner"] !== true ||
    row["safe_caller"] !== true ||
    typeof row["login"] !== "string" ||
    !permitted.includes(row["login"]) ||
    row["login"] !== row["effective_role"] ||
    (operator && row["login"] !== SELF_HOST_SCHEMA_OWNER)
  )
    refuse();
}
async function posture(
  database: SqlExecutor,
  operator = false,
): Promise<SqlRow> {
  const result = await database.query(postureSql);
  const row = result.rows[0];
  if (result.rows.length !== 1 || result.rowCount !== 1 || !row) refuse();
  assertSelfHostProfilePosture(row, operator);
  return row;
}
async function installedIdentity(database: SqlExecutor): Promise<void> {
  const result = await database.query(
    sql(`SELECT p.*,owner.rolname AS actual_owner FROM public.cloudmarkup_installation_profile p
    JOIN pg_catalog.pg_class c ON c.oid='public.cloudmarkup_installation_profile'::regclass
    JOIN pg_catalog.pg_roles owner ON owner.oid=c.relowner`),
  );
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    result.rows.length !== 1 ||
    row?.["singleton"] !== true ||
    row["profile_id"] !== SELF_HOST_PROFILE_ID ||
    row["profile_version"] !== 1 ||
    row["engine_major"] !== 17 ||
    row["schema_owner"] !== SELF_HOST_SCHEMA_OWNER ||
    row["bootstrap_grantor"] !== SELF_HOST_BOOTSTRAP_GRANTOR ||
    row["actual_owner"] !== SELF_HOST_SCHEMA_OWNER
  )
    refuse();
}
/** Operator-only preflight, followed by the existing immutable history runner.
 * No proposal ACL or role-login activation is loaded or performed here. */
export async function applySelfHostMigrationProfile(
  database: SqlDatabase,
  profile: SelfHostMigrationProfile,
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.query(sql("SELECT pg_advisory_xact_lock($1)", [21_000_000]));
    const row = await posture(tx, true);
    if (row["has_profile"] === true) {
      if (row["has_ledger"] !== true) refuse();
      await installedIdentity(tx);
    } else if (
      row["has_unmarked_objects"] === true ||
      row["has_unmarked_functions"] === true
    )
      refuse();
    else if (row["has_ledger"] === true) {
      const ledger = await tx.query(
        sql("SELECT version FROM public.cloudmarkup_schema_migrations LIMIT 1"),
      );
      if (ledger.rows.length !== 0) refuse();
    }
  });
  const scoped: SqlDatabase = {
    close: () => Promise.resolve(), // Borrowed; the explicit operator owns disposal.
    query: <TRow extends SqlRow = SqlRow>(statement: SqlStatement) =>
      database.transaction(async (tx) => {
        await tx.query(
          sql("SET LOCAL search_path TO public, pg_catalog, pg_temp"),
        );
        return tx.query<TRow>(statement);
      }),
    transaction: (work) =>
      database.transaction(async (tx) => {
        await tx.query(
          sql("SET LOCAL search_path TO public, pg_catalog, pg_temp"),
        );
        return work(tx);
      }),
  };
  await runMigrations(scoped, profile.migrations);
  await assertSelfHostMigrationProfileReady(database, profile);
}

export interface SelfHostRuntimeAclProposal {
  readonly state: "REVIEW_ONLY_UNARMED";
  readonly statements: readonly string[];
  readonly manifestSha256: string;
}
/** Source assembly only. Explicit operator activation is a separate call. The
 * legacy task-local PG16 marker/history block is replaced by the new explicit
 * profile/catalog admission, while its fixed column/function GRANTs are reused.
 * All provider-direct definition/RLS/role guards stay in the complete C input. */
export async function loadSelfHostRuntimeAclProposal(
  directory = join(apiDirectory, "authorization-proposals"),
): Promise<SelfHostRuntimeAclProposal> {
  return loadRuntimeAclProposal(directory, "provider-direct-v1");
}

export interface SelfHostCoreRuntimeAclProposal extends SelfHostRuntimeAclProposal {
  readonly capabilityProfile: "local-editor-core-v1";
}

/** A distinct closed core contract. Never remove the provider-direct input from
 * the full v1 policy or silently downgrade an existing installation. */
export async function loadSelfHostCoreRuntimeAclProposal(
  directory = join(apiDirectory, "authorization-proposals"),
): Promise<SelfHostCoreRuntimeAclProposal> {
  const proposal = await loadRuntimeAclProposal(
    directory,
    "local-editor-core-v1",
  );
  return Object.freeze({
    ...proposal,
    capabilityProfile: "local-editor-core-v1",
  });
}

async function loadRuntimeAclProposal(
  directory: string,
  capabilityProfile: "provider-direct-v1" | "local-editor-core-v1",
): Promise<SelfHostRuntimeAclProposal> {
  const core = capabilityProfile === "local-editor-core-v1";
  const bytes = await readFile(
    join(
      directory,
      core
        ? "self-host-core-runtime-acl-v2.json"
        : "self-host-runtime-acl-v1.json",
    ),
  );
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    proposalContractVersion: number;
    profileId: string;
    state: string;
    automaticBootstrap: unknown;
    runtimeActivation: unknown;
    capabilityProfile?: unknown;
    installedProfileManifestSha256?: unknown;
    qualificationRequired?: unknown;
    inputs: unknown[];
  };
  if (
    manifest.proposalContractVersion !== (core ? 2 : 1) ||
    manifest.profileId !== SELF_HOST_PROFILE_ID ||
    manifest.state !== "REVIEW_ONLY_UNARMED" ||
    manifest.automaticBootstrap !== false ||
    manifest.runtimeActivation !== false ||
    !Array.isArray(manifest.inputs) ||
    manifest.inputs.length !== (core ? 2 : 3)
  )
    refuse();
  if (core) {
    const allowed = [
      "proposalContractVersion",
      "profileId",
      "capabilityProfile",
      "installedProfileManifestSha256",
      "state",
      "automaticBootstrap",
      "runtimeActivation",
      "inputs",
      "qualificationRequired",
    ];
    const profile = await loadSelfHostMigrationProfile();
    if (
      Object.keys(manifest).length !== allowed.length ||
      Object.keys(manifest).some((key) => !allowed.includes(key)) ||
      manifest.capabilityProfile !== "local-editor-core-v1" ||
      !Array.isArray(manifest.qualificationRequired) ||
      manifest.qualificationRequired.some((item) => typeof item !== "string") ||
      manifest.installedProfileManifestSha256 !==
        profile.identity.manifestSha256
    )
      refuse();
  }
  const expected = [
    "self-host-runtime-acl-v1.sql",
    "ordinary-local-business-acl.sql",
    "provider-direct-usage-journal-acl-v1.sql",
  ];
  const statements: string[] = [];
  for (const [index, rawInput] of manifest.inputs.entries()) {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput))
      refuse();
    const input = rawInput as {
      file: string;
      checksumSha256: string;
      selection: string;
    };
    if (
      core &&
      (Object.keys(input).length !== 3 ||
        Object.keys(input).some(
          (key) => !["file", "checksumSha256", "selection"].includes(key),
        ))
    )
      refuse();
    if (
      input.file !== expected[index] ||
      !shaPattern.test(input.checksumSha256)
    )
      refuse();
    const path = join(directory, input.file),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) refuse();
    const contents = await readFile(path);
    if (digest(contents) !== input.checksumSha256) refuse();
    const parts = splitPostgresStatements(contents.toString("utf8"));
    if (index === 1) {
      if (
        input.selection !== "grants-after-single-local-target-admission" ||
        !parts[0]?.includes("DO $target$") ||
        parts.length !== 462 ||
        parts
          .slice(1)
          .some(
            (part) =>
              !part
                .replace(/^\s*(?:--[^\n]*(?:\n|$)\s*)*/u, "")
                .startsWith("GRANT "),
          )
      )
        refuse();
      statements.push(...parts.slice(1));
    } else {
      if (input.selection !== "complete") refuse();
      statements.push(...parts);
    }
  }
  return Object.freeze({
    state: "REVIEW_ONLY_UNARMED",
    statements: Object.freeze(statements),
    manifestSha256: digest(bytes),
  });
}
/** Privileged, explicitly acknowledged operator operation; never called by
 * migration or runtime startup. Re-loads both pinned inputs before any write.
 * Native permissions/RLS/business qualification remains a separate check. */
export async function applySelfHostRuntimeAcl(
  database: SqlDatabase,
  approval: unknown,
): Promise<void> {
  // Public JavaScript callers are not constrained by a literal-true TypeScript
  // annotation. Keep strict runtime admission at this operator boundary.
  if (!approval || typeof approval !== "object" || Array.isArray(approval))
    refuse();
  const approved = approval as Readonly<Record<string, unknown>>;
  const profile = await loadSelfHostMigrationProfile();
  const proposal = await loadSelfHostRuntimeAclProposal();
  await activateRuntimeAcl(database, approved, profile, proposal);
}

/** Explicit core-only operator action. Startup cannot activate this recipe;
 * callers acknowledge both exact source manifests and the capability profile. */
export async function applySelfHostCoreRuntimeAcl(
  database: SqlDatabase,
  approval: unknown,
): Promise<void> {
  if (!approval || typeof approval !== "object" || Array.isArray(approval))
    refuse();
  const approved = approval as Readonly<Record<string, unknown>>;
  const fields = [
    "acknowledgeRuntimeAcl",
    "profileManifestSha256",
    "aclManifestSha256",
    "capabilityProfile",
  ];
  if (
    approved["capabilityProfile"] !== "local-editor-core-v1" ||
    Object.keys(approved).length !== fields.length ||
    Object.keys(approved).some((key) => !fields.includes(key))
  )
    refuse();
  const profile = await loadSelfHostMigrationProfile();
  const proposal = await loadSelfHostCoreRuntimeAclProposal();
  await activateRuntimeAcl(database, approved, profile, proposal);
}

async function activateRuntimeAcl(
  database: SqlDatabase,
  approved: Readonly<Record<string, unknown>>,
  profile: SelfHostMigrationProfile,
  proposal: SelfHostRuntimeAclProposal,
): Promise<void> {
  if (
    approved["acknowledgeRuntimeAcl"] !== true ||
    approved["profileManifestSha256"] !== profile.identity.manifestSha256 ||
    approved["aclManifestSha256"] !== proposal.manifestSha256
  )
    refuse();
  await database.transaction(async (tx) => {
    await tx.query(sql("SELECT pg_advisory_xact_lock($1)", [21_000_000]));
    await posture(tx, true);
    // Borrow the already locked transaction, never start a nested pool tx.
    const borrowed: SqlDatabase = {
      query: <TRow extends SqlRow = SqlRow>(statement: SqlStatement) =>
        tx.query<TRow>(statement),
      transaction: async (work) => work(tx),
      close: () => Promise.resolve(), // The caller owns this borrowed pool.
    };
    await assertSelfHostMigrationProfileReady(borrowed, profile);
    await tx.query(sql("SET LOCAL search_path TO public, pg_catalog, pg_temp"));
    for (const statement of proposal.statements) await tx.query(sql(statement));
  });
}
/** G calls this on its actual guarded handle before ordinary/business and
 * provider-direct RLS/column/trigger/EXECUTE checks. This proves profile/history,
 * never that the separate unarmed runtime permission proposal was activated. */
export async function assertSelfHostMigrationProfileReady(
  database: SqlDatabase,
  profile: SelfHostMigrationProfile,
): Promise<void> {
  const row = await posture(database);
  if (row["has_profile"] !== true || row["has_ledger"] !== true) refuse();
  await installedIdentity(database);
  const ledger = await database.query(
    sql(
      "SELECT version,checksum_sha256 FROM public.cloudmarkup_schema_migrations ORDER BY version",
    ),
  );
  if (
    ledger.rows.length !== profile.migrations.length ||
    ledger.rowCount !== profile.migrations.length ||
    ledger.rows.some(
      (entry, index) =>
        entry["version"] !== profile.migrations[index]?.version ||
        typeof entry["checksum_sha256"] !== "string" ||
        entry["checksum_sha256"].trim() !==
          profile.migrations[index]?.checksumSha256,
    )
  )
    refuse();
}
