import { runProvisioning } from "./self-host/bootstrap.mjs";

export const localMigrationProfile = "cloudmarkup-standalone-pg17-v1";
export const localComposeProject = "cloudmarkup-local-pg17-v1";
const purposes = ["api", "proposal", "export", "cleanup", "billing"];
const bootstrapUser = "cloudmarkup_owner";
const migratorUser = "cloudmarkup_admin";
const runtimeUser = "cloudmarkup_beta_api_runtime";

function url(user, password, port) {
  return `postgresql://${user}:${password}@127.0.0.1:${port}/cloudmarkup`;
}
function checkedUrl(value, user, port) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid local database configuration.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== port ||
    parsed.username !== user ||
    parsed.pathname !== "/cloudmarkup" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  )
    throw new Error(
      "Local database configuration requires the exact loopback target and purpose login.",
    );
  const password = decodeURIComponent(parsed.password);
  if (!/^[!-~]{24,256}$/u.test(password))
    throw new Error(
      "Local database passwords require 24-256 printable non-whitespace characters.",
    );
  return { value, password };
}

/** Contributor-only synthetic defaults. No production or remote database route. */
export function localDatabaseConfiguration(environment, port) {
  if (
    environment.CLOUDMARKUP_LOCAL_MIGRATION_PROFILE !== undefined &&
    environment.CLOUDMARKUP_LOCAL_MIGRATION_PROFILE !== localMigrationProfile
  )
    throw new Error("Unknown contributor migration profile.");
  const runtime = checkedUrl(
    environment.CLOUDMARKUP_DATABASE_URL ??
      url(runtimeUser, "cloudmarkup-local-api-runtime-only", port),
    runtimeUser,
    port,
  );
  const migrator = checkedUrl(
    environment.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL ??
      url(migratorUser, "cloudmarkup-local-migrator-only", port),
    migratorUser,
    port,
  );
  const bootstrap = checkedUrl(
    environment.CLOUDMARKUP_LOCAL_BOOTSTRAP_DATABASE_URL ??
      url(bootstrapUser, "cloudmarkup-local-bootstrap-only", port),
    bootstrapUser,
    port,
  );
  const passwords = Object.fromEntries(
    purposes.map((purpose) => [
      `/run/cloudmarkup/secrets/database/${purpose}.password`,
      purpose === "api"
        ? runtime.password
        : `cloudmarkup-local-${purpose}-runtime-only`,
    ]),
  );
  passwords["/run/secrets/postgres_owner_password"] = bootstrap.password;
  passwords["/run/secrets/migrator_password"] = migrator.password;
  if (new Set(Object.values(passwords)).size !== 7)
    throw new Error("The seven local database credentials must differ.");
  return { runtime, migrator, bootstrap, passwords, port };
}

/** Never forward owner/migrator URLs to the browser or API process. */
export function localDatabaseEnvironment(
  environment,
  configuration,
  migration,
) {
  const result = { ...environment };
  delete result.CLOUDMARKUP_LOCAL_BOOTSTRAP_DATABASE_URL;
  delete result.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL;
  delete result.CLOUDMARKUP_LOCAL_BOOTSTRAP_PASSWORD;
  result.CLOUDMARKUP_DATABASE_URL = configuration.runtime.value;
  result.CLOUDMARKUP_LOCAL_MIGRATION_PROFILE = localMigrationProfile;
  if (migration)
    result.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL =
      configuration.migrator.value;
  return result;
}

/** Explicit operator command only. The shared implementation owns all SQL,
 * source checks, role posture and transactional activation. */
export async function provisionLocalDatabase(
  stage,
  configuration,
  api,
  provision = runProvisioning,
) {
  if (!["admin", "roles", "acl", "check"].includes(stage))
    throw new Error("Unknown local provisioning stage.");
  const profile = await api.loadSelfHostMigrationProfile();
  const acl = await api.loadSelfHostCoreRuntimeAclProposal();
  return provision(
    stage,
    {
      host: "127.0.0.1",
      port: Number(configuration.port),
      database: "cloudmarkup",
      tls: "disable",
      migrationProfile: localMigrationProfile,
      canonicalManifestSha256: profile.identity.canonicalManifestSha256,
      profileManifestSha256: profile.identity.manifestSha256,
      aclManifestSha256: acl.manifestSha256,
      capabilityProfile: "local-editor-core-v1",
      acknowledge: stage,
    },
    api,
    {
      readSecret: async (file) => {
        const password = configuration.passwords[file];
        if (password === undefined)
          throw new Error("Unknown local secret reference.");
        return password;
      },
    },
  );
}
