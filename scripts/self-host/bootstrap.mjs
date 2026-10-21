import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cli, fail, isMain, privateFile, root } from "./self-host.mjs";

export const migrationDirectory = join(root, "apps/api/migrations");
export const profileDirectory = join(root, "apps/api/self-host-migrations");
export const standaloneProfileId = "cloudmarkup-standalone-pg17-v1";
const digestPattern = /^[a-f0-9]{64}$/;
export async function inspectMigrations(directory = migrationDirectory) {
  const bytes = await readFile(join(directory, "manifest.json"));
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (
    manifest.storageContractVersion !== 1 ||
    !Array.isArray(manifest.migrations) ||
    !manifest.migrations.length
  )
    fail("Invalid canonical manifest.");
  let previous = "";
  const files = [];
  for (const entry of manifest.migrations) {
    if (
      !/^\d{4}_[a-z0-9_]+\.sql$/.test(entry.file) ||
      entry.version !== entry.file.slice(0, 4) ||
      entry.version <= previous ||
      !digestPattern.test(entry.checksumSha256)
    )
      fail("Invalid migration identity.");
    const source = await readFile(
      await privateFile(join(directory, entry.file)),
    );
    if (
      createHash("sha256").update(source).digest("hex") !== entry.checksumSha256
    )
      fail("Migration checksum mismatch.");
    files.push(entry.file);
    previous = entry.version;
  }
  const present = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (JSON.stringify(present) !== JSON.stringify([...files].sort()))
    fail("Unregistered SQL is refused.");
  return {
    storageContractVersion: 1,
    count: files.length,
    lastVersion: previous,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export function parseOperatorConfiguration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Invalid operator configuration.");
  const expected = [
    "host",
    "port",
    "database",
    "user",
    "passwordFile",
    "tls",
    "manifestSha256",
    "acknowledgeCanonicalMigrations",
    "migrationProfile",
    "profileManifestSha256",
    "acknowledgeStandaloneProfile",
  ];
  if (
    Object.keys(value).some((key) => !expected.includes(key)) ||
    value.database !== "cloudmarkup" ||
    value.user !== "cloudmarkup_admin" ||
    value.tls !== "disable" ||
    value.acknowledgeCanonicalMigrations !== true ||
    value.acknowledgeStandaloneProfile !== true ||
    value.migrationProfile !== standaloneProfileId ||
    typeof value.profileManifestSha256 !== "string" ||
    !digestPattern.test(value.profileManifestSha256) ||
    !digestPattern.test(value.manifestSha256) ||
    typeof value.host !== "string" ||
    !/^[a-zA-Z0-9._:-]{1,253}$/.test(value.host) ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    value.passwordFile !== "/run/secrets/migrator_password"
  )
    fail("Invalid operator configuration.");
  return { ...value };
}
export async function inspectStandaloneProfile(
  directory = profileDirectory,
  canonical = migrationDirectory,
) {
  const bytes = await readFile(
    await privateFile(join(directory, "manifest.json")),
  );
  const value = JSON.parse(bytes.toString("utf8"));
  const history = await inspectMigrations(canonical);
  if (
    value.profileId !== standaloneProfileId ||
    value.profileVersion !== 1 ||
    value.engineMajor !== 17 ||
    value.owner !== "cloudmarkup_admin" ||
    value.bootstrapGrantor !== "cloudmarkup_owner" ||
    value.canonicalManifestSha256 !== history.manifestSha256
  )
    fail("Invalid standalone installation profile.");
  const identity = value.identityMigration,
    replacement = value.privateReceiptReplacement;
  if (
    identity.version !== "0000" ||
    identity.file !== "0000_self_host_profile_identity.sql" ||
    replacement.version !== "0127" ||
    replacement.file !== "0127_self_host_private_receipt_definitions.sql" ||
    replacement.canonicalFile !==
      "0127_private_notes_and_gpt6_receipt_authorities.sql"
  )
    fail("Invalid standalone profile source.");
  const present = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (
    JSON.stringify(present) !==
    JSON.stringify([identity.file, replacement.file])
  )
    fail("Unregistered profile SQL is refused.");
  const hash = (source) => createHash("sha256").update(source).digest("hex");
  const identityBytes = await readFile(
    await privateFile(join(directory, identity.file)),
  );
  const portableBytes = await readFile(
    await privateFile(join(directory, replacement.file)),
  );
  const canonicalBytes = await readFile(
    await privateFile(join(canonical, replacement.canonicalFile)),
  );
  if (
    hash(identityBytes) !== identity.checksumSha256 ||
    hash(portableBytes) !== replacement.checksumSha256 ||
    hash(canonicalBytes) !== replacement.canonicalChecksumSha256
  )
    fail("Standalone source checksum mismatch.");
  let assembled = canonicalBytes.toString("utf8");
  for (const tag of [
    "cm_private_bootstrap_admission",
    "cm_private_bootstrap_owner_edge",
    "cm_private_bootstrap_final",
  ]) {
    const pattern = new RegExp(`DO \\$${tag}\\$[\\s\\S]*?\\$${tag}\\$;`, "gu");
    const before = assembled.match(pattern),
      after = portableBytes.toString("utf8").match(pattern);
    if (before?.length !== 1 || after?.length !== 1)
      fail("Invalid fixed portable replacement.");
    assembled = assembled.replace(before[0], after[0]);
  }
  if (hash(assembled) !== replacement.assembledChecksumSha256)
    fail("Standalone assembly checksum mismatch.");
  return {
    profileId: standaloneProfileId,
    profileVersion: 1,
    engineMajor: 17,
    owner: "cloudmarkup_admin",
    bootstrapGrantor: "cloudmarkup_owner",
    manifestSha256: hash(bytes),
    canonicalManifestSha256: history.manifestSha256,
    identityChecksumSha256: identity.checksumSha256,
    privateReceiptChecksumSha256: replacement.assembledChecksumSha256,
  };
}
export async function applyStandalone(
  configuration,
  {
    inspect = inspectStandaloneProfile,
    load,
    createDatabase,
    migrate,
    password,
  } = {},
) {
  const config = parseOperatorConfiguration(configuration);
  const receipt = await inspect();
  if (
    config.manifestSha256 !== receipt.canonicalManifestSha256 ||
    config.profileManifestSha256 !== receipt.manifestSha256
  )
    fail("Operator manifest approval is stale.");
  // Fixed profile assembly reuses the immutable canonical loader/runner and
  // refuses protected/unmarked/mixed ledgers; it never arms the ACL proposal.
  const profile = await load();
  const database = createDatabase({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    ssl: false,
    max: 1,
    application_name: "cloudmarkup-self-host-operator",
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  });
  try {
    await migrate(database, profile);
    return receipt;
  } finally {
    await database.close();
  }
}
export async function main(command = process.argv[2]) {
  if (command === "inspect") {
    process.stdout.write(
      `${JSON.stringify(
        {
          canonical: await inspectMigrations(),
          installationProfile: await inspectStandaloneProfile(),
          runtimeAclManifestSha256: createHash("sha256")
            .update(
              await readFile(
                join(
                  root,
                  "apps/api/authorization-proposals/self-host-core-runtime-acl-v2.json",
                ),
              ),
            )
            .digest("hex"),
          providerDirectAclManifestSha256: createHash("sha256")
            .update(
              await readFile(
                join(
                  root,
                  "apps/api/authorization-proposals/self-host-runtime-acl-v1.json",
                ),
              ),
            )
            .digest("hex"),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (["admin", "restore-roles", "roles", "acl", "check"].includes(command)) {
    if (process.platform !== "linux")
      fail("Provisioning requires the explicit Linux operator container.");
    const configuration = JSON.parse(
      await readFile(
        await privateFile(
          process.env.CLOUDMARKUP_SELF_HOST_PROVISIONING_CONFIGURATION_FILE,
        ),
        "utf8",
      ),
    );
    const persistenceApi = await import("../../apps/api/dist/persistence.js");
    const modelApi =
      configuration?.capabilityProfile === "provider-direct-v1"
        ? await import("../../apps/api/dist/self-host-model-history.js")
        : {};
    const api = { ...persistenceApi, ...modelApi };
    const receipt = await runProvisioning(command, configuration, api);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  if (command !== "apply" || process.platform !== "linux")
    fail("Apply is an explicit Linux privileged operator operation.");
  const file = await privateFile(
    process.env.CLOUDMARKUP_SELF_HOST_OPERATOR_CONFIGURATION_FILE,
  );
  const config = parseOperatorConfiguration(
    JSON.parse(await readFile(file, "utf8")),
  );
  const password = await readFile(
    await privateFile(config.passwordFile),
    "utf8",
  );
  if (!password || password.length > 4096 || /[\r\n\0]/.test(password))
    fail("Invalid owner secret file.");
  // This file is the declared @cloudmarkup/api/persistence public export.
  const api = await import("../../apps/api/dist/persistence.js");
  const receipt = await applyStandaloneFromPublicEntry(config, api, {
    password,
  });
  process.stdout.write(
    `${JSON.stringify({ standaloneProfileApplied: true, ...receipt, additionalPermissionScriptsApplied: false })}\n`,
  );
}

/** The CLI and its caller fixture use the same declared persistence entry.
 * The API namespace is trusted server composition, never an operator module
 * path or HTTP input. Pool ownership/disposal stays with applyStandalone. */
export function applyStandaloneFromPublicEntry(
  configuration,
  api,
  { inspect, password } = {},
) {
  return applyStandalone(configuration, {
    inspect,
    password,
    load: api.loadSelfHostMigrationProfile,
    migrate: api.applySelfHostMigrationProfile,
    createDatabase: (settings) => new api.PostgresDatabase(settings),
  });
}

export const runtimePurposes = Object.freeze([
  "api",
  "proposal",
  "export",
  "cleanup",
  "billing",
]);
const runtimeRole = (purpose) => `cloudmarkup_beta_${purpose}_runtime`;
const runtimePasswordFile = (purpose) =>
  `/run/cloudmarkup/secrets/database/${purpose}.password`;
/** No passwords or arbitrary SQL/module paths in an operator configuration.
 * Acknowledgement is stage-specific, so ordinary startup cannot grant roles. */
export function parseProvisioningConfiguration(value, stage) {
  const keys = [
    "host",
    "port",
    "database",
    "tls",
    "migrationProfile",
    "canonicalManifestSha256",
    "profileManifestSha256",
    "aclManifestSha256",
    "capabilityProfile",
    "acknowledge",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    !["admin", "restore-roles", "roles", "acl", "check"].includes(stage) ||
    value.acknowledge !== stage ||
    !["local-editor-core-v1", "provider-direct-v1"].includes(
      value.capabilityProfile,
    ) ||
    value.database !== "cloudmarkup" ||
    value.tls !== "disable" ||
    value.migrationProfile !== standaloneProfileId ||
    typeof value.host !== "string" ||
    !/^[a-zA-Z0-9._:-]{1,253}$/.test(value.host) ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    [
      "canonicalManifestSha256",
      "profileManifestSha256",
      "aclManifestSha256",
    ].some(
      (key) =>
        typeof value[key] !== "string" || !digestPattern.test(value[key]),
    )
  )
    fail("Invalid stage-specific provisioning configuration.");
  return { ...value };
}
export function validateProvisioningPassword(password) {
  // Printable ASCII excludes SASLprep normalization ambiguity. The documented
  // file contains no newline; all seven independent secrets must differ.
  if (typeof password !== "string" || !/^[!-~]{24,256}$/.test(password))
    fail(
      "Provisioning needs a distinct 24–256 character printable ASCII password without whitespace.",
    );
  return password;
}
/** PostgreSQL's documented SCRAM-SHA-256 verifier. Plaintext never appears in
 * CREATE ROLE, SQL text, argv, receipts or diagnostics. Verifiers are secrets
 * too and are never printed. Restricting ASCII makes SASLprep an identity. */
export function scramVerifier(password, salt = randomBytes(16)) {
  validateProvisioningPassword(password);
  if (!Buffer.isBuffer(salt) || salt.length < 16 || salt.length > 64)
    fail("Invalid SCRAM salt.");
  const salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const stored = createHash("sha256")
    .update(createHmac("sha256", salted).update("Client Key").digest())
    .digest("base64");
  const server = createHmac("sha256", salted)
    .update("Server Key")
    .digest("base64");
  return `SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored}:${server}`;
}
export function matchesScramVerifier(password, verifier) {
  validateProvisioningPassword(password);
  if (typeof verifier !== "string") return false;
  const match =
    /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]{43}=):([A-Za-z0-9+/]{43}=)$/u.exec(
      verifier,
    );
  if (!match) return false;
  const salt = Buffer.from(match[1], "base64");
  if (
    salt.length < 16 ||
    salt.length > 64 ||
    salt.toString("base64") !== match[1]
  )
    return false;
  const expected = Buffer.from(scramVerifier(password, salt)),
    actual = Buffer.from(verifier);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
const bootstrapAdmission = `SELECT pg_catalog.current_database() AS database_name,session_user::text AS login,current_user::text AS effective_role,
 pg_catalog.current_setting('server_version_num')::integer AS server_version,
 pg_catalog.current_setting('session_replication_role') AS replication_role,pg_catalog.current_setting('createrole_self_grant') AS self_grant,
 EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin) AS actual_superuser,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('rdsadmin','rds_superuser')) AS standalone`;
async function admitBootstrap(tx, sql) {
  const result = await tx.query(sql(bootstrapAdmission));
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    result.rowCount !== 1 ||
    row?.database_name !== "cloudmarkup" ||
    row.login !== "cloudmarkup_owner" ||
    row.effective_role !== row.login ||
    !Number.isSafeInteger(row.server_version) ||
    row.server_version < 170000 ||
    row.server_version >= 180000 ||
    row.replication_role !== "origin" ||
    row.self_grant !== "" ||
    row.actual_superuser !== true ||
    row.standalone !== true
  )
    fail("Standalone bootstrap grantor posture refused.");
}
async function provisionRole(tx, api, name, password, administrator) {
  // name is selected exclusively by this module, not configuration or HTTP.
  const result = await tx.query(
    api.sql(
      `SELECT r.rolcanlogin,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,r.rolpassword,r.rolvaliduntil,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS isolated,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner=r.oid) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE proowner=r.oid) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=r.oid) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datdba=r.oid) AS owns_nothing
 FROM pg_catalog.pg_authid r WHERE r.rolname=$1`,
      [name],
    ),
  );
  if (result.rows.length > 1 || result.rowCount !== result.rows.length)
    fail("Role catalog refused.");
  const row = result.rows[0];
  if (row) {
    if (
      row.rolcanlogin !== true ||
      row.rolsuper !== false ||
      row.rolinherit !== false ||
      row.rolcreaterole !== administrator ||
      row.rolcreatedb !== false ||
      row.rolreplication !== false ||
      row.rolbypassrls !== false ||
      row.rolvaliduntil !== null ||
      row.isolated !== true ||
      (!administrator && row.owns_nothing !== true) ||
      !matchesScramVerifier(password, row.rolpassword)
    )
      fail(
        "Existing role or credential differs; automatic adoption/rotation refused.",
      );
    return;
  }
  const verifier = scramVerifier(password); // fixed alphabet, never plaintext
  await tx.query(
    api.sql(
      `CREATE ROLE ${name} LOGIN NOSUPERUSER ${administrator ? "CREATEROLE" : "NOCREATEROLE"} NOINHERIT NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`,
    ),
  );
}
const privateRoleNames = Object.freeze([
  "cloudmarkup_notes_native_lock_owner",
  "cloudmarkup_notes_publication_authority",
  "cloudmarkup_notes_shared_native_producer",
  "cloudmarkup_gpt6_private_receipt_issuer",
]);
const privateRoleAttributes =
  "NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS";
function restoreRoleDefinitions(profile) {
  // The public loader has already verified/assembled the complete profile.
  // Compare its declarations to a closed contract; never execute extracted SQL.
  const declarations = profile.migrations.flatMap((migration) =>
    migration.statements.flatMap((statement) =>
      [...statement.matchAll(/\bCREATE\s+ROLE\s+([^;]+?)(?:;|$)/gu)].map(
        ([, definition]) => ({
          version: migration.version,
          definition: definition.replace(/\s+/gu, " ").trim(),
        }),
      ),
    ),
  );
  if (
    declarations.length !== privateRoleNames.length ||
    declarations.some(
      (entry, index) =>
        entry.version !== "0127" ||
        entry.definition !==
          `${privateRoleNames[index]} ${privateRoleAttributes}`,
    )
  )
    fail("Restore role declarations differ from the reviewed profile.");
}
async function restoreRoleCatalog(tx, api, { complete }) {
  const names = [...privateRoleNames, "cloudmarkup_admin", "cloudmarkup_owner"];
  const roles = await tx.query(
    api.sql(
      `SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,r.rolconnlimit,r.rolvaliduntil,
 r.rolpassword IS NOT NULL AS has_password,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole=r.oid) AS no_settings,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid='pg_catalog.pg_authid'::regclass AND d.refobjid=r.oid AND d.classid<>'pg_catalog.pg_auth_members'::regclass) AS no_dependencies
 FROM pg_catalog.pg_authid r WHERE r.rolname=ANY($1::text[])`,
      [names.slice(0, -1)],
    ),
  );
  const byName = new Map(roles.rows.map((row) => [row.rolname, row]));
  if (
    roles.rowCount !== roles.rows.length ||
    byName.size !== roles.rows.length ||
    !byName.has("cloudmarkup_admin") ||
    ![1, privateRoleNames.length + 1].includes(byName.size) ||
    (complete && byName.size !== privateRoleNames.length + 1) ||
    roles.rows.some((row) => {
      const administrator = row.rolname === "cloudmarkup_admin";
      return (
        (!administrator && !privateRoleNames.includes(row.rolname)) ||
        row.rolcanlogin !== administrator ||
        row.rolsuper !== false ||
        row.rolinherit !== false ||
        row.rolcreaterole !== administrator ||
        row.rolcreatedb !== false ||
        row.rolreplication !== false ||
        row.rolbypassrls !== false ||
        row.rolconnlimit !== -1 ||
        row.rolvaliduntil !== null ||
        row.has_password !== administrator ||
        row.no_settings !== true ||
        (!administrator && row.no_dependencies !== true)
      );
    })
  )
    fail("Restore role posture/dependencies refused; no automatic adoption.");
  const edges = await tx.query(
    api.sql(
      `SELECT r.rolname AS role_name,a.rolname AS member_name,g.rolname AS grantor_name,m.admin_option,m.inherit_option,m.set_option
 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
 JOIN pg_catalog.pg_roles a ON a.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
 WHERE r.rolname=ANY($1::text[]) OR a.rolname=ANY($1::text[]) OR g.rolname=ANY($1::text[])`,
      [names],
    ),
  );
  const existing = privateRoleNames.filter((name) => byName.has(name));
  if (
    edges.rowCount !== edges.rows.length ||
    edges.rows.length !== existing.length ||
    new Set(edges.rows.map((edge) => edge.role_name)).size !==
      existing.length ||
    edges.rows.some(
      (edge) =>
        !existing.includes(edge.role_name) ||
        edge.member_name !== "cloudmarkup_admin" ||
        edge.grantor_name !== "cloudmarkup_owner" ||
        edge.admin_option !== true ||
        edge.inherit_option !== false ||
        edge.set_option !== false,
    )
  )
    fail("Restore role membership graph refused; no automatic repair.");
  return privateRoleNames.filter((name) => !byName.has(name));
}
async function prepareRestoreRoles(tx, api) {
  await tx.query(api.sql("SELECT pg_advisory_xact_lock($1)", [21_000_000]));
  await admitBootstrap(tx, api.sql);
  const target = await tx.query(
    api.sql(`SELECT owner.rolname AS database_owner,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN('public','information_schema'))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname<>'plpgsql')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_largeobject_metadata)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_event_trigger)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_publication)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_subscription)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_foreign_data_wrapper)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_foreign_server) AS empty
 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles owner ON owner.oid=d.datdba WHERE d.datname=pg_catalog.current_database()`),
  );
  if (
    target.rowCount !== 1 ||
    target.rows.length !== 1 ||
    target.rows[0]?.database_owner !== "cloudmarkup_admin" ||
    target.rows[0]?.empty !== true
  )
    fail("Restore roles require the separately provisioned empty target.");
  // Inspect every role/edge before DDL. Transaction ownership provides rollback;
  // a final readback refuses unexpected concurrent changes by another operator.
  const missing = await restoreRoleCatalog(tx, api, { complete: false });
  for (const name of missing) {
    await tx.query(api.sql(`CREATE ROLE ${name} ${privateRoleAttributes}`));
    for (const option of ["ADMIN TRUE", "INHERIT FALSE", "SET FALSE"])
      await tx.query(
        api.sql(
          `GRANT ${name} TO cloudmarkup_admin WITH ${option} GRANTED BY cloudmarkup_owner`,
        ),
      );
  }
  await restoreRoleCatalog(tx, api, { complete: true });
}
/** Trusted CLI composition with injected dependencies for credential-free
 * caller tests. Every owned pool closes on success/failure. */
export async function runProvisioning(
  stage,
  configuration,
  api,
  {
    readSecret = async (file) => readFile(await privateFile(file), "utf8"),
  } = {},
) {
  const config = parseProvisioningConfiguration(configuration, stage);
  const profile = await api.loadSelfHostMigrationProfile();
  const proposal = await (config.capabilityProfile === "local-editor-core-v1"
    ? api.loadSelfHostCoreRuntimeAclProposal()
    : api.loadSelfHostRuntimeAclProposal());
  if (
    config.canonicalManifestSha256 !==
      profile.identity.canonicalManifestSha256 ||
    config.profileManifestSha256 !== profile.identity.manifestSha256 ||
    config.aclManifestSha256 !== proposal.manifestSha256
  )
    fail("Provisioning source approval is stale.");
  if (stage === "restore-roles") restoreRoleDefinitions(profile);
  const open = async (user, password, work) => {
    const database = new api.PostgresDatabase({
      host: config.host,
      port: config.port,
      database: config.database,
      user,
      password,
      ssl: false,
      max: 1,
      application_name: "cloudmarkup-self-host-provisioning",
      connectionTimeoutMillis: 10000,
      statement_timeout: 120000,
    });
    try {
      return await work(database);
    } finally {
      await database.close();
    }
  };
  const secret = async (file) =>
    validateProvisioningPassword(await readSecret(file));
  if (stage === "admin") {
    const ownerPassword = await secret("/run/secrets/postgres_owner_password"),
      adminPassword = await secret("/run/secrets/migrator_password");
    const passwords = await Promise.all(
      runtimePurposes.map((purpose) => secret(runtimePasswordFile(purpose))),
    );
    if (new Set([ownerPassword, adminPassword, ...passwords]).size !== 7)
      fail("All seven database credentials must differ.");
    await open("cloudmarkup_owner", ownerPassword, (database) =>
      database.transaction(async (tx) => {
        await tx.query(
          api.sql("SELECT pg_advisory_xact_lock($1)", [21_000_000]),
        );
        await admitBootstrap(tx, api.sql);
        const result = await tx.query(
          api.sql(`SELECT owner.rolname AS database_owner,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') AS empty
 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles owner ON owner.oid=d.datdba WHERE d.datname=pg_catalog.current_database()`),
        );
        const row = result.rows[0];
        if (
          result.rowCount !== 1 ||
          result.rows.length !== 1 ||
          row?.empty !== true ||
          !["cloudmarkup_owner", "cloudmarkup_admin"].includes(
            row.database_owner,
          )
        )
          fail(
            "Admin provisioning requires a dedicated empty standalone database.",
          );
        await provisionRole(tx, api, "cloudmarkup_admin", adminPassword, true);
        // Provision the five exact core purpose identities before migration,
        // without table/function grants or elevated posture.
        // The same empty-database/bootstrap admission owns this transaction;
        // roles/acl/check still independently admit the complete installed profile.
        for (const [index, purpose] of runtimePurposes.entries())
          await provisionRole(
            tx,
            api,
            runtimeRole(purpose),
            passwords[index],
            false,
          );
        await tx.query(
          api.sql("ALTER DATABASE cloudmarkup OWNER TO cloudmarkup_admin"),
        );
        await tx.query(
          api.sql(
            "REVOKE CREATE, TEMPORARY ON DATABASE cloudmarkup FROM PUBLIC",
          ),
        );
        await tx.query(api.sql("REVOKE CREATE ON SCHEMA public FROM PUBLIC"));
      }),
    );
  } else if (stage === "restore-roles") {
    const password = await secret("/run/secrets/postgres_owner_password");
    await open("cloudmarkup_owner", password, (database) =>
      database.transaction((tx) => prepareRestoreRoles(tx, api)),
    );
  } else if (stage === "roles") {
    const ownerPassword = await secret("/run/secrets/postgres_owner_password"),
      adminPassword = await secret("/run/secrets/migrator_password");
    const passwords = await Promise.all(
      runtimePurposes.map((purpose) => secret(runtimePasswordFile(purpose))),
    );
    if (new Set([ownerPassword, adminPassword, ...passwords]).size !== 7)
      fail("All seven database credentials must differ.");
    await open("cloudmarkup_admin", adminPassword, (database) =>
      api.assertSelfHostMigrationProfileReady(database, profile),
    );
    await open("cloudmarkup_owner", ownerPassword, (database) =>
      database.transaction(async (tx) => {
        await tx.query(
          api.sql("SELECT pg_advisory_xact_lock($1)", [21_000_000]),
        );
        await admitBootstrap(tx, api.sql);
        // Superuser creation avoids PG17's implicit nonsuperuser creator edges.
        // Recheck exact installed identity/history while holding the same lock as
        // migrations and seeding; the earlier admin connection proves posture.
        await tx.query(
          api.sql(
            "LOCK TABLE public.cloudmarkup_installation_profile,public.cloudmarkup_schema_migrations IN SHARE MODE",
          ),
        );
        const identity = await tx.query(
          api.sql(`SELECT p.*,owner.rolname AS actual_owner FROM public.cloudmarkup_installation_profile p
 JOIN pg_catalog.pg_class c ON c.oid='public.cloudmarkup_installation_profile'::regclass JOIN pg_catalog.pg_roles owner ON owner.oid=c.relowner`),
        );
        const row = identity.rows[0];
        if (
          identity.rowCount !== 1 ||
          identity.rows.length !== 1 ||
          row?.singleton !== true ||
          row.profile_id !== standaloneProfileId ||
          row.profile_version !== 1 ||
          row.engine_major !== 17 ||
          row.schema_owner !== "cloudmarkup_admin" ||
          row.bootstrap_grantor !== "cloudmarkup_owner" ||
          row.actual_owner !== "cloudmarkup_admin"
        )
          fail("Installed profile identity refused.");
        const ledger = await tx.query(
          api.sql(
            "SELECT version,checksum_sha256 FROM public.cloudmarkup_schema_migrations ORDER BY version",
          ),
        );
        if (
          ledger.rowCount !== profile.migrations.length ||
          ledger.rows.length !== profile.migrations.length ||
          ledger.rows.some(
            (entry, index) =>
              entry.version !== profile.migrations[index].version ||
              typeof entry.checksum_sha256 !== "string" ||
              entry.checksum_sha256.trim() !==
                profile.migrations[index].checksumSha256,
          )
        )
          fail("Installed profile history refused.");
        for (const [index, purpose] of runtimePurposes.entries())
          await provisionRole(
            tx,
            api,
            runtimeRole(purpose),
            passwords[index],
            false,
          );
        await tx.query(
          api.sql(
            "REVOKE CREATE, TEMPORARY ON DATABASE cloudmarkup FROM PUBLIC",
          ),
        );
        await tx.query(api.sql("REVOKE CREATE ON SCHEMA public FROM PUBLIC"));
      }),
    );
  } else if (stage === "acl") {
    const password = await secret("/run/secrets/migrator_password");
    await open("cloudmarkup_admin", password, (database) =>
      (config.capabilityProfile === "local-editor-core-v1"
        ? api.applySelfHostCoreRuntimeAcl
        : api.applySelfHostRuntimeAcl)(database, {
        acknowledgeRuntimeAcl: true,
        ...(config.capabilityProfile === "local-editor-core-v1"
          ? { capabilityProfile: config.capabilityProfile }
          : {}),
        profileManifestSha256: config.profileManifestSha256,
        aclManifestSha256: config.aclManifestSha256,
      }),
    );
  } else {
    const passwords = await Promise.all(
      runtimePurposes.map((purpose) => secret(runtimePasswordFile(purpose))),
    );
    if (new Set(passwords).size !== 5)
      fail("Runtime database credentials must differ.");
    for (const [index, purpose] of runtimePurposes.entries())
      await open(runtimeRole(purpose), passwords[index], async (database) => {
        await api.assertSelfHostMigrationProfileReady(database, profile);
        const result = await database.query(
          api.sql(`SELECT session_user::text AS login,current_user::text AS effective_role,
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS owns_nothing`),
        );
        if (
          result.rowCount !== 1 ||
          result.rows[0]?.owns_nothing !== true ||
          result.rows[0]?.login !== runtimeRole(purpose) ||
          result.rows[0]?.effective_role !== runtimeRole(purpose)
        )
          fail("Runtime ownership refused.");
        if (purpose === "api") {
          const allowed = await database.query(
            api.sql(`SELECT pg_catalog.has_column_privilege(current_user,'public.browser_refresh_sessions','principal_id','INSERT')
 AND pg_catalog.has_column_privilege(current_user,'public.browser_refresh_sessions','provider_session_sha256','INSERT')
 AND pg_catalog.has_column_privilege(current_user,'public.browser_refresh_sessions','authenticated_at','INSERT')
 AND pg_catalog.has_column_privilege(current_user,'public.account_revoked_session_families','revoked_at','INSERT')
 AND pg_catalog.has_function_privilege(current_user,'public.cloudmarkup_account_session_allowed_v1(text,text,timestamptz,timestamptz)','EXECUTE') AS local_session_permissions`),
          );
          if (
            allowed.rowCount !== 1 ||
            allowed.rows[0]?.local_session_permissions !== true
          )
            fail("Local session permissions unavailable.");
        }
        if (
          config.capabilityProfile === "provider-direct-v1" &&
          ["proposal", "export"].includes(purpose)
        ) {
          if (typeof api.assertSelfHostProviderDirectSchema !== "function")
            fail("Provider-direct schema admission is unavailable.");
          await api.assertSelfHostProviderDirectSchema(database);
        }
      });
  }
  return {
    stage,
    installationProfile: standaloneProfileId,
    capabilityProfile: config.capabilityProfile,
    profileManifestSha256: config.profileManifestSha256,
    aclManifestSha256: config.aclManifestSha256,
    databasePreflightOnly: stage === "check",
    applicationReadinessQualified: false,
  };
}
if (isMain(import.meta.url)) void cli(() => main());
