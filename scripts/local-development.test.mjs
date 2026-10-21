import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalWebEnvironment,
  LOCAL_IDENTITY_TOKENS,
  LOCAL_WEB_PNPM_ARGUMENTS,
  resolveCommandInvocation,
} from "./local-development.mjs";
import {
  localComposeProject,
  localDatabaseConfiguration,
  localDatabaseEnvironment,
  localMigrationProfile,
  provisionLocalDatabase,
} from "./local-persistence.mjs";

const localApiBaseUrl = "http://127.0.0.1:8787";
const localWebOrigin = "http://127.0.0.1:4173";
const expectedIdentityTokens = [
  "local-owner",
  "local-team-owner",
  "local-team-administrator",
  "local-team-editor",
  "local-team-viewer",
];

test("local web environment injects the loopback API and default identity", () => {
  const environment = createLocalWebEnvironment({ PRESERVED: "value" });

  assert.equal(environment.PRESERVED, "value");
  assert.equal(environment.CLOUDMARKUP_LOCAL_IDENTITY_TOKEN, "local-owner");
  assert.equal(environment.VITE_CLOUDMARKUP_API_BASE_URL, localApiBaseUrl);
  assert.equal(
    environment.VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN,
    "local-owner",
  );
  assert.equal(
    environment.CLOUDMARKUP_BILLING_CANCEL_URL,
    localWebOrigin + "/settings/billing?checkout=canceled",
  );
  assert.equal(
    environment.CLOUDMARKUP_BILLING_PORTAL_RETURN_URL,
    localWebOrigin + "/settings/billing",
  );
  assert.equal(
    environment.CLOUDMARKUP_BILLING_SUCCESS_URL,
    localWebOrigin + "/settings/billing?checkout=success",
  );
});

test("local web environment accepts every seeded local identity", () => {
  assert.deepEqual(LOCAL_IDENTITY_TOKENS, expectedIdentityTokens);

  for (const token of LOCAL_IDENTITY_TOKENS) {
    const environment = createLocalWebEnvironment({
      CLOUDMARKUP_LOCAL_IDENTITY_TOKEN: token,
    });

    assert.equal(environment.CLOUDMARKUP_LOCAL_IDENTITY_TOKEN, token);
    assert.equal(environment.VITE_CLOUDMARKUP_API_BASE_URL, localApiBaseUrl);
    assert.equal(environment.VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN, token);
  }
});

test("local web environment rejects unsupported identities", () => {
  assert.throws(
    () =>
      createLocalWebEnvironment({
        CLOUDMARKUP_LOCAL_IDENTITY_TOKEN: "customer-supplied-token",
      }),
    /must name one supported seeded local identity/,
  );
});

test("local web environment rejects conflicting browser configuration", () => {
  assert.throws(
    () =>
      createLocalWebEnvironment({
        VITE_CLOUDMARKUP_API_BASE_URL: "http://127.0.0.1:4173",
      }),
    /must target http:\/\/127\.0\.0\.1:8787/,
  );
  assert.throws(
    () =>
      createLocalWebEnvironment({
        CLOUDMARKUP_LOCAL_IDENTITY_TOKEN: "local-team-viewer",
        VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN: "local-owner",
      }),
    /must match CLOUDMARKUP_LOCAL_IDENTITY_TOKEN/,
  );
  assert.throws(
    () =>
      createLocalWebEnvironment({
        CLOUDMARKUP_BILLING_SUCCESS_URL:
          "http://localhost:4173/settings/billing?checkout=success",
      }),
    /CLOUDMARKUP_BILLING_SUCCESS_URL must target http:\/\/127\.0\.0\.1:4173/,
  );
});

test("local web invocation binds the documented strict loopback endpoint", () => {
  assert.deepEqual(LOCAL_WEB_PNPM_ARGUMENTS, [
    "--filter",
    "@cloudmarkup/web",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ]);
  assert.equal(LOCAL_WEB_PNPM_ARGUMENTS.includes("--"), false);
});

test("Windows pnpm execution uses the absolute command processor", () => {
  assert.deepEqual(
    resolveCommandInvocation(
      "pnpm",
      ["--filter", "@cloudmarkup/api", "migrate:local"],
      { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      "win32",
    ),
    {
      args: [
        "/d",
        "/s",
        "/c",
        "pnpm",
        "--filter",
        "@cloudmarkup/api",
        "migrate:local",
      ],
      command: "C:\\Windows\\System32\\cmd.exe",
    },
  );
});

test("Windows pnpm execution fails closed for unsafe shell inputs", () => {
  assert.throws(
    () =>
      resolveCommandInvocation(
        "pnpm",
        ["--filter", "@cloudmarkup/api", "migrate:local & whoami"],
        { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
        "win32",
      ),
    /only fixed shell-safe arguments/,
  );
  assert.throws(
    () =>
      resolveCommandInvocation(
        "pnpm",
        ["--version"],
        { ComSpec: "cmd.exe" },
        "win32",
      ),
    /absolute ComSpec path to cmd\.exe/,
  );
  assert.throws(
    () =>
      resolveCommandInvocation(
        "pnpm",
        ["--version"],
        { ComSpec: "/usr/bin/cmd.exe" },
        "win32",
      ),
    /absolute ComSpec path to cmd\.exe/,
  );
  assert.throws(
    () =>
      resolveCommandInvocation(
        "pnpm",
        ["--version"],
        {
          ComSpec:
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        },
        "win32",
      ),
    /absolute ComSpec path to cmd\.exe/,
  );
});

test("non-Windows and non-pnpm commands remain direct invocations", () => {
  assert.deepEqual(
    resolveCommandInvocation("pnpm", ["--version"], {}, "linux"),
    { args: ["--version"], command: "pnpm" },
  );
  assert.deepEqual(
    resolveCommandInvocation(
      "docker",
      ["compose", "version"],
      { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      "win32",
    ),
    { args: ["compose", "version"], command: "docker" },
  );
});

test("PG17 contributor purpose credentials stay on one target and privileged URLs never reach API/web", () => {
  const configuration = localDatabaseConfiguration({}, "55432");
  assert.equal(localComposeProject, "cloudmarkup-local-pg17-v1");
  assert.equal(
    new URL(configuration.runtime.value).username,
    "cloudmarkup_beta_api_runtime",
  );
  assert.equal(
    new URL(configuration.migrator.value).username,
    "cloudmarkup_admin",
  );
  assert.equal(
    new URL(configuration.bootstrap.value).username,
    "cloudmarkup_owner",
  );
  assert.equal(new Set(Object.values(configuration.passwords)).size, 7);
  const parent = {
    CLOUDMARKUP_LOCAL_BOOTSTRAP_DATABASE_URL: configuration.bootstrap.value,
    CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL: configuration.migrator.value,
    CLOUDMARKUP_LOCAL_BOOTSTRAP_PASSWORD: configuration.bootstrap.password,
  };
  const runtime = localDatabaseEnvironment(parent, configuration, false);
  assert.equal(runtime.CLOUDMARKUP_DATABASE_URL, configuration.runtime.value);
  assert.equal(
    runtime.CLOUDMARKUP_LOCAL_MIGRATION_PROFILE,
    localMigrationProfile,
  );
  assert.equal(runtime.CLOUDMARKUP_LOCAL_BOOTSTRAP_DATABASE_URL, undefined);
  assert.equal(runtime.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL, undefined);
  assert.equal(runtime.CLOUDMARKUP_LOCAL_BOOTSTRAP_PASSWORD, undefined);
  const migration = localDatabaseEnvironment(parent, configuration, true);
  assert.equal(
    migration.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL,
    configuration.migrator.value,
  );
  assert.equal(migration.CLOUDMARKUP_LOCAL_BOOTSTRAP_DATABASE_URL, undefined);
  const browser = createLocalWebEnvironment({
    ...parent,
    CLOUDMARKUP_DATABASE_URL: configuration.runtime.value,
  });
  assert.equal(browser.CLOUDMARKUP_DATABASE_URL, undefined);
  assert.equal(browser.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL, undefined);
  assert.equal(browser.CLOUDMARKUP_LOCAL_BOOTSTRAP_DATABASE_URL, undefined);
  assert.equal(browser.CLOUDMARKUP_LOCAL_BOOTSTRAP_PASSWORD, undefined);
});

test("contributor configuration refuses remote, query-redirected, mismatched purpose/profile targets", () => {
  const defaults = localDatabaseConfiguration({}, "55432");
  for (const invalid of [
    defaults.runtime.value.replace("127.0.0.1", "database.example.test"),
    defaults.runtime.value + "?host=database.example.test",
    defaults.runtime.value.replace(
      "cloudmarkup_beta_api_runtime",
      "cloudmarkup_admin",
    ),
    defaults.runtime.value.replace(":55432/", ":55433/"),
  ])
    assert.throws(() =>
      localDatabaseConfiguration(
        { CLOUDMARKUP_DATABASE_URL: invalid },
        "55432",
      ),
    );
  assert.throws(() =>
    localDatabaseConfiguration(
      { CLOUDMARKUP_LOCAL_MIGRATION_PROFILE: "hosted" },
      "55432",
    ),
  );
});

test("explicit contributor provisioning binds the shared PG17/core policy without executing SQL in this test", async () => {
  const configuration = localDatabaseConfiguration({}, "55432");
  const api = {
    loadSelfHostMigrationProfile: async () => ({
      identity: {
        canonicalManifestSha256: "a".repeat(64),
        manifestSha256: "b".repeat(64),
      },
    }),
    loadSelfHostCoreRuntimeAclProposal: async () => ({
      manifestSha256: "c".repeat(64),
    }),
  };
  const calls = [];
  for (const stage of ["admin", "roles", "acl", "check"])
    await provisionLocalDatabase(
      stage,
      configuration,
      api,
      async (selected, config, suppliedApi, options) => {
        calls.push(selected);
        assert.equal(config.acknowledge, selected);
        assert.equal(config.host, "127.0.0.1");
        assert.equal(config.port, 55432);
        assert.equal(config.migrationProfile, localMigrationProfile);
        assert.equal(config.capabilityProfile, "local-editor-core-v1");
        assert.equal(config.profileManifestSha256, "b".repeat(64));
        assert.equal(config.aclManifestSha256, "c".repeat(64));
        assert.equal(suppliedApi, api);
        assert.equal(
          await options.readSecret("/run/secrets/migrator_password"),
          configuration.migrator.password,
        );
        await assert.rejects(options.readSecret("/arbitrary/file"));
      },
    );
  assert.deepEqual(calls, ["admin", "roles", "acl", "check"]);
  await assert.rejects(
    provisionLocalDatabase("restore-roles", configuration, api),
  );
});
