import { readFile } from "node:fs/promises";
import { cli, fail, isMain, privateFile } from "./self-host.mjs";

const digestPattern = /^[a-f0-9]{64}$/u;
const keys = [
  "host",
  "port",
  "database",
  "user",
  "passwordFile",
  "tls",
  "canonicalManifestSha256",
  "profileManifestSha256",
  "acknowledgeInitializeLocalOwner",
  "owner",
];

/** The owner initializer is a separate, explicit operator stage after migration.
 * Configuration contains references, never a database password or AI key. */
export function parseOwnerConfiguration(value, parseSeed) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.database !== "cloudmarkup" ||
    value.user !== "cloudmarkup_admin" ||
    value.tls !== "disable" ||
    value.passwordFile !== "/run/secrets/migrator_password" ||
    value.acknowledgeInitializeLocalOwner !== true ||
    typeof value.host !== "string" ||
    !/^[a-zA-Z0-9._:-]{1,253}$/u.test(value.host) ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.canonicalManifestSha256 !== "string" ||
    !digestPattern.test(value.canonicalManifestSha256) ||
    typeof value.profileManifestSha256 !== "string" ||
    !digestPattern.test(value.profileManifestSha256) ||
    typeof parseSeed !== "function"
  )
    fail("Invalid local owner operator configuration.");
  return { ...value, owner: parseSeed(value.owner) };
}

async function approvedProfile(config, api) {
  const profile = await api.loadSelfHostMigrationProfile();
  if (
    profile.identity.canonicalManifestSha256 !==
      config.canonicalManifestSha256 ||
    profile.identity.manifestSha256 !== config.profileManifestSha256
  )
    fail("Local owner source approval is stale.");
  return profile;
}

export async function inspectOwnerConfiguration(configuration, api) {
  const config = parseOwnerConfiguration(
    configuration,
    api.parseLocalOwnerSeedInput,
  );
  const profile = await approvedProfile(config, api);
  return {
    stage: "local-owner-workspace",
    profileId: profile.identity.profileId,
    canonicalManifestSha256: profile.identity.canonicalManifestSha256,
    profileManifestSha256: profile.identity.manifestSha256,
    principalId: config.owner.principalId,
    organizationId: config.owner.organizationId,
    membershipId: config.owner.membershipId,
    databaseAccessed: false,
    changesApplied: false,
  };
}

/** The fixed public API entry supplies the real pool and initializer. An operator
 * cannot select executable module paths or substitute runtime credentials. */
export async function initializeOwner(configuration, api, password) {
  const config = parseOwnerConfiguration(
    configuration,
    api.parseLocalOwnerSeedInput,
  );
  const profile = await approvedProfile(config, api);
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > 4096 ||
    /[\r\n\0]/u.test(password)
  )
    fail("Invalid local owner operator password file.");
  const database = new api.PostgresDatabase({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    ssl: false,
    max: 1,
    application_name: "cloudmarkup-self-host-owner-initializer",
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  });
  try {
    return await api.seedLocalOwnerWorkspace(database, profile, config.owner);
  } finally {
    await database.close();
  }
}

export async function main(command = process.argv[2]) {
  if (command !== "inspect" && command !== "apply")
    fail("Use inspect or apply for local owner initialization.");
  if (command === "apply" && process.platform !== "linux")
    fail("Local owner initialization is an explicit Linux operator operation.");
  const file = await privateFile(
    process.env.CLOUDMARKUP_SELF_HOST_OWNER_CONFIGURATION_FILE,
  );
  const configuration = JSON.parse(await readFile(file, "utf8"));
  // This path is the declared @cloudmarkup/api/self-host-owner operator export.
  const api = await import("../../apps/api/dist/self-host-owner.js");
  const config = parseOwnerConfiguration(
    configuration,
    api.parseLocalOwnerSeedInput,
  );
  const receipt =
    command === "inspect"
      ? await inspectOwnerConfiguration(config, api)
      : await initializeOwner(
          config,
          api,
          await readFile(await privateFile(config.passwordFile), "utf8"),
        );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (isMain(import.meta.url)) void cli(() => main());
