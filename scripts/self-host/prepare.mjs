import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectBootstrap } from "./bootstrap.mjs";
import { cli, fail, isMain, outsideRepository, root } from "./self-host.mjs";

/** Prepare non-secret configuration for review. This cannot provision a role,
 * generate a credential, acknowledge an operation, or start a service. */
export async function prepareSelfHostConfiguration(
  directory,
  { exportsEnabled = false } = {},
) {
  if (
    typeof directory !== "string" ||
    /[\r\n"']/u.test(directory) ||
    typeof exportsEnabled !== "boolean"
  )
    fail("Use a new absolute private directory without quotes or newlines.");
  directory = await outsideRepository(directory);
  const inspected = await inspectBootstrap();
  const runtime = JSON.parse(
    await readFile(
      join(root, "scripts/self-host/runtime.example.json"),
      "utf8",
    ),
  );
  runtime.persistence.expectedSchemaVersion = inspected.canonical.lastVersion;
  if (exportsEnabled) {
    runtime.adapters.solutionExports = {
      adapterReference: "self-host.solution-exports-v1",
      configurationReference: "operator.exports",
      credentialReferences: [],
    };
    runtime.credentialSources["operator.exports"] = {
      kind: "file",
      path: "/opt/cloudmarkup/export/native-export-settings.json",
    };
  }
  const database = {
    host: "postgres",
    port: 5432,
    database: "cloudmarkup",
    tls: "disable",
  };
  const source = {
    canonicalManifestSha256: inspected.canonical.manifestSha256,
    profileManifestSha256: inspected.installationProfile.manifestSha256,
  };
  const migrator = {
    user: "cloudmarkup_admin",
    passwordFile: "/run/secrets/migrator_password",
  };
  const documents = {
    "runtime.json": runtime,
    "operator.json": {
      ...database,
      ...migrator,
      manifestSha256: source.canonicalManifestSha256,
      migrationProfile: inspected.installationProfile.profileId,
      profileManifestSha256: source.profileManifestSha256,
      acknowledgeCanonicalMigrations: false,
      acknowledgeStandaloneProfile: false,
    },
    "provisioning.json": {
      ...database,
      ...source,
      migrationProfile: inspected.installationProfile.profileId,
      aclManifestSha256: inspected.runtimeAclManifestSha256,
      capabilityProfile: "local-editor-core-v1",
      acknowledge: "review-required",
    },
    "owner.json": {
      ...database,
      ...migrator,
      ...source,
      acknowledgeInitializeLocalOwner: false,
      owner: {
        principalId: runtime.identity.ownerPrincipalId,
        ownerDisplayName: "Local owner",
        organizationId: "org_local_owner",
        organizationDisplayName: "Personal",
        slug: "local-owner",
        membershipId: "membership_local_owner",
      },
    },
  };
  const paths = {
    CLOUDMARKUP_SELF_HOST_CONFIGURATION_SOURCE: "runtime.json",
    CLOUDMARKUP_RUNTIME_SECRETS_DIRECTORY: "runtime-secrets",
    CLOUDMARKUP_POSTGRES_OWNER_PASSWORD_FILE: "postgres-owner.txt",
    CLOUDMARKUP_MIGRATOR_PASSWORD_FILE: "migrator.txt",
    CLOUDMARKUP_OPERATOR_CONFIGURATION_SOURCE: "operator.json",
    CLOUDMARKUP_PROVISIONING_CONFIGURATION_SOURCE: "provisioning.json",
    CLOUDMARKUP_OWNER_CONFIGURATION_SOURCE: "owner.json",
    CLOUDMARKUP_DATABASE_SECRETS_DIRECTORY: "runtime-secrets/database",
  };
  const example = await readFile(
    join(root, "scripts/self-host/.env.example"),
    "utf8",
  );
  const environment = example.replace(/^([A-Z_]+)=.*$/gmu, (line, key) =>
    paths[key]
      ? `${key}=${JSON.stringify(join(directory, paths[key]).replaceAll("\\", "/"))}`
      : line,
  );
  // Exclusive directory creation prevents overwriting an existing installation
  // or backup. Leave incomplete output in place if a write fails.
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, "runtime-secrets/database"), {
    recursive: true,
    mode: 0o700,
  });
  for (const [name, value] of Object.entries(documents))
    await writeFile(
      join(directory, name),
      JSON.stringify(value, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  await writeFile(join(directory, "self-host.env"), environment, {
    flag: "wx",
    mode: 0o600,
  });
  return {
    ...inspected,
    exportsEnabled,
    credentialsCreated: false,
    operationsAcknowledged: false,
  };
}

if (isMain(import.meta.url))
  void cli(async () => {
    const [directory, option, ...extra] = process.argv.slice(2);
    if (
      !directory ||
      extra.length ||
      (option !== undefined && option !== "--exports")
    )
      fail(
        "Usage: node scripts/self-host/prepare.mjs <new-absolute-private-directory> [--exports]",
      );
    const receipt = await prepareSelfHostConfiguration(directory, {
      exportsEnabled: option === "--exports",
    });
    process.stdout.write(
      JSON.stringify(receipt, null, 2) +
        "\nReview the generated documents and complete the self-host guide's explicit operator stages. No credentials or services were created.\n",
    );
  });
