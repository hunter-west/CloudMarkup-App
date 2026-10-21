import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { initializeProviderDispatchHistory } from "./models-history.mjs";
import { join } from "node:path";
import test from "node:test";
import {
  applyStandalone,
  applyStandaloneFromPublicEntry,
  inspectMigrations,
  inspectStandaloneProfile,
  parseOperatorConfiguration,
  parseProvisioningConfiguration,
  runProvisioning,
  runtimePurposes,
  scramVerifier,
  matchesScramVerifier,
  migrationDirectory,
  validateProvisioningPassword,
} from "./bootstrap.mjs";

const digest = "a".repeat(64);
const operator = {
  host: "postgres",
  port: 5432,
  database: "cloudmarkup",
  user: "cloudmarkup_admin",
  passwordFile: "/run/secrets/migrator_password",
  tls: "disable",
  manifestSha256: digest,
  acknowledgeCanonicalMigrations: true,
  migrationProfile: "cloudmarkup-standalone-pg17-v1",
  profileManifestSha256: digest,
  acknowledgeStandaloneProfile: true,
};
for (const migrationFails of [false, true])
  test(`declared persistence entry delegates the exact profile and closes its pool on ${migrationFails ? "failure" : "success"}`, async () => {
    const calls = [];
    const profile = Object.freeze({
      identity: { profileId: operator.migrationProfile },
      migrations: [],
    });
    const ownedPools = [];
    class PostgresDatabase {
      constructor(settings) {
        assert.equal(settings.user, "cloudmarkup_admin");
        assert.equal(settings.host, "postgres");
        ownedPools.push(this);
        calls.push("pool");
      }
      async close() {
        calls.push("close");
      }
    }
    const publicEntry = {
      PostgresDatabase,
      loadSelfHostMigrationProfile: async () => {
        calls.push("public-profile-loader");
        return profile;
      },
      applySelfHostMigrationProfile: async (database, loadedProfile) => {
        assert.equal(database, ownedPools[0]);
        assert.equal(loadedProfile, profile);
        calls.push("public-operator-runner");
        if (migrationFails) throw new Error("Synthetic migration refusal.");
      },
      // A proposal export is present but the operator caller must not consume it.
      loadSelfHostCoreRuntimeAclProposal: async () => {
        throw new Error("ACL activation is outside bootstrap.");
      },
    };
    const operation = applyStandaloneFromPublicEntry(operator, publicEntry, {
      password: "synthetic",
      inspect: async () => ({
        manifestSha256: digest,
        canonicalManifestSha256: digest,
      }),
    });
    if (migrationFails)
      await assert.rejects(operation, /Synthetic migration refusal/);
    else await operation;
    assert.deepEqual(calls, [
      "public-profile-loader",
      "pool",
      "public-operator-runner",
      "close",
    ]);
  });
test("public-entry caller rejects a missing operator host before consuming exports", async () => {
  const { host, ...missingHost } = operator;
  void host;
  const unexpected = () => {
    throw new Error("Public export must not be called.");
  };
  await assert.rejects(
    applyStandaloneFromPublicEntry(
      missingHost,
      {
        PostgresDatabase: unexpected,
        loadSelfHostMigrationProfile: unexpected,
        applySelfHostMigrationProfile: unexpected,
      },
      {
        inspect: async () => ({
          manifestSha256: digest,
          canonicalManifestSha256: digest,
        }),
      },
    ),
    {
      message: "Invalid operator configuration.",
    },
  );
});
test("source receipt checks all 120 current canonical entries through 0138", async () => {
  const receipt = await inspectMigrations();
  assert.equal(receipt.count, 120);
  assert.equal(receipt.lastVersion, "0138");
  assert.equal(
    receipt.manifestSha256,
    "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16",
  );
});
test("tampered and unregistered SQL cannot reach a database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-migration-test-"));
  try {
    const sql = "SELECT 1;\n",
      file = "0001_synthetic.sql";
    await writeFile(join(directory, file), sql);
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        storageContractVersion: 1,
        migrations: [
          {
            file,
            version: "0001",
            checksumSha256: createHash("sha256").update(sql).digest("hex"),
          },
        ],
      }),
    );
    assert.equal((await inspectMigrations(directory)).count, 1);
    await writeFile(join(directory, "0002_unregistered.sql"), sql);
    await assert.rejects(inspectMigrations(directory), /Unregistered/);
    await rm(join(directory, "0002_unregistered.sql"));
    await writeFile(join(directory, file), "SELECT 2;\n");
    await assert.rejects(inspectMigrations(directory), /checksum/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
for (const change of [
  { user: "cloudmarkup_beta_api_runtime" },
  { database: "other" },
  { passwordFile: "/run/secrets/provider_key" },
  { acknowledgeCanonicalMigrations: false },
  { tls: "trust" },
  { grantRuntime: true },
  { port: 0 },
  { host: undefined },
  { host: null },
  { host: 5432 },
  { host: true },
  { user: "cloudmarkup_owner" },
  { migrationProfile: "hosted" },
  { profileManifestSha256: "invalid" },
  { acknowledgeStandaloneProfile: false },
])
  test(`operator boundary refuses ${JSON.stringify(change)}`, () => {
    assert.throws(() => parseOperatorConfiguration({ ...operator, ...change }));
  });
test("standalone inspection binds the canonical source and its two portable files", async () => {
  const receipt = await inspectStandaloneProfile();
  assert.equal(receipt.profileId, "cloudmarkup-standalone-pg17-v1");
  assert.equal(receipt.engineMajor, 17);
  assert.equal(receipt.owner, "cloudmarkup_admin");
  assert.equal(
    receipt.canonicalManifestSha256,
    "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16",
  );
});

test("missing operator host fails before owner pool construction", async () => {
  const { host, ...missingHost } = operator;
  void host;
  let constructed = false;
  const options = {
    password: "synthetic",
    inspect: async () => ({
      manifestSha256: digest,
      canonicalManifestSha256: digest,
    }),
    load: async () => [],
    createDatabase: () => {
      constructed = true;
      return { close: () => Promise.resolve() };
    },
    migrate: () => Promise.resolve(),
  };
  await assert.rejects(applyStandalone(missingHost, options), {
    message: "Invalid operator configuration.",
  });
  assert.equal(constructed, false);
  // Prove that the injected downstream path succeeds and constructs its pool.
  // Missing load/migrate/close stubs must not mask a missing-host regression.
  await applyStandalone(operator, options);
  assert.equal(constructed, true);
});
test("stale canonical approval fails before database construction", async () => {
  let constructed = false;
  await assert.rejects(
    applyStandalone(operator, {
      inspect: async () => ({ manifestSha256: "b".repeat(64) }),
      createDatabase: () => {
        constructed = true;
      },
    }),
    /stale/,
  );
  assert.equal(constructed, false);
});
for (const throws of [false, true])
  test(`canonical public runner owns transaction/retry behavior; closes owner on ${throws ? "failure" : "success"}`, async () => {
    const sequence = [];
    const options = {
      password: "synthetic",
      inspect: async () => ({
        manifestSha256: digest,
        canonicalManifestSha256: digest,
      }),
      load: async () => {
        sequence.push("canonical-loader");
        return ["synthetic migration"];
      },
      createDatabase: (config) => {
        assert.equal(config.user, "cloudmarkup_admin");
        assert.equal(config.max, 1);
        sequence.push("owner-pool");
        return { close: async () => sequence.push("close") };
      },
      migrate: async (_database, migrations) => {
        sequence.push("canonical-runner");
        assert.deepEqual(migrations, ["synthetic migration"]);
        if (throws) throw Error("synthetic failure");
      },
    };
    if (throws) await assert.rejects(applyStandalone(operator, options));
    else await applyStandalone(operator, options);
    assert.deepEqual(sequence, [
      "canonical-loader",
      "owner-pool",
      "canonical-runner",
      "close",
    ]);
  });

const provisioning = {
  host: "postgres",
  port: 5432,
  database: "cloudmarkup",
  tls: "disable",
  migrationProfile: "cloudmarkup-standalone-pg17-v1",
  canonicalManifestSha256: digest,
  profileManifestSha256: digest,
  aclManifestSha256: digest,
  capabilityProfile: "local-editor-core-v1",
  acknowledge: "admin",
};
const fixturePassword = (name) => `synthetic-password-${name}-only-123456`;
test("offline dispatch initialization requires exact acknowledgement and never resolves model or database credentials", async () => {
  const calls = [];
  const api = {
    provisionSelfHostProviderDispatchHistory: async (input) => {
      calls.push(input);
      return { state: "new-directory-provisioned" };
    },
  };
  for (const configuration of [
    null,
    {},
    { acknowledge: true },
    { acknowledge: "restore" },
  ])
    await assert.rejects(
      initializeProviderDispatchHistory({ configuration, api }),
      /explicit offline acknowledgement/,
    );
  assert.equal(calls.length, 0);
  const configuration = { acknowledge: "new-independent-provider-dispatch-v1" };
  assert.deepEqual(
    await initializeProviderDispatchHistory({ configuration, api }),
    { state: "new-directory-provisioned" },
  );
  assert.deepEqual(calls, [configuration]);
});
function provisioningFixture({
  queryOverride,
  readinessFails = false,
  aclFails = false,
  restoreRoles,
} = {}) {
  const calls = [],
    reads = [];
  const profile = {
    identity: { manifestSha256: digest, canonicalManifestSha256: digest },
    migrations: [
      { version: "0000", checksumSha256: digest, statements: [] },
      ...(restoreRoles
        ? [{ version: "0127", statements: [restoreRoles.source] }]
        : []),
    ],
  };
  const identity = {
    singleton: true,
    profile_id: provisioning.migrationProfile,
    profile_version: 1,
    engine_major: 17,
    schema_owner: "cloudmarkup_admin",
    bootstrap_grantor: "cloudmarkup_owner",
    actual_owner: "cloudmarkup_admin",
  };
  class PostgresDatabase {
    constructor(settings) {
      this.user = settings.user;
      calls.push(["pool", this.user]);
    }
    async close() {
      calls.push(["close", this.user]);
    }
    async transaction(work) {
      calls.push(["transaction", this.user]);
      try {
        const result = await work(this);
        calls.push(["commit", this.user]);
        return result;
      } catch (error) {
        calls.push(["rollback", this.user]);
        throw error;
      }
    }
    async query(statement) {
      calls.push(["query", this.user, statement.text, statement.values]);
      const overridden = queryOverride?.(statement, this.user);
      if (overridden !== undefined) return overridden;
      let rows = [];
      if (restoreRoles && statement.text.startsWith("SELECT r.rolname,"))
        rows = [...restoreRoles.roles.values()];
      else if (
        restoreRoles &&
        statement.text.startsWith("SELECT r.rolname AS role_name")
      )
        rows = [...restoreRoles.edges.values()];
      else if (restoreRoles && statement.text.startsWith("CREATE ROLE")) {
        const name = statement.text.split(" ")[2];
        restoreRoles.roles.set(name, privateRoleRow(name));
      } else if (restoreRoles && statement.text.startsWith("GRANT")) {
        const name = statement.text.split(" ")[1];
        const edge = restoreRoles.edges.get(name) ?? {
          role_name: name,
          member_name: "cloudmarkup_admin",
          grantor_name: "cloudmarkup_owner",
          admin_option: false,
          inherit_option: false,
          set_option: true,
        };
        if (statement.text.includes("WITH ADMIN TRUE"))
          edge.admin_option = true;
        if (statement.text.includes("WITH SET FALSE")) edge.set_option = false;
        restoreRoles.edges.set(name, edge);
      } else if (statement.text.includes("AS actual_superuser"))
        rows = [
          {
            database_name: "cloudmarkup",
            login: this.user,
            effective_role: this.user,
            server_version: 170011,
            replication_role: "origin",
            self_grant: "",
            actual_superuser: true,
            standalone: true,
          },
        ];
      else if (statement.text.includes("AS database_owner"))
        rows = [
          {
            database_owner: restoreRoles
              ? "cloudmarkup_admin"
              : "cloudmarkup_owner",
            empty: true,
          },
        ];
      else if (statement.text.startsWith("SELECT p.*")) rows = [identity];
      else if (statement.text.startsWith("SELECT version,checksum_sha256"))
        rows = [{ version: "0000", checksum_sha256: digest }];
      else if (statement.text.includes("AS local_session_permissions"))
        rows = [{ local_session_permissions: true }];
      else if (
        statement.text.includes("AS owns_nothing") &&
        !statement.text.includes("pg_authid")
      )
        rows = [
          { owns_nothing: true, login: this.user, effective_role: this.user },
        ];
      return { rowCount: rows.length, rows };
    }
  }
  const api = {
    sql: (text, values = []) => ({ text, values }),
    PostgresDatabase,
    loadSelfHostMigrationProfile: async () => {
      if (restoreRoles)
        profile.migrations[1].statements = restoreRoles.source.split(";");
      return profile;
    },
    loadSelfHostCoreRuntimeAclProposal: async () => ({
      manifestSha256: digest,
      state: "REVIEW_ONLY_UNARMED",
    }),
    assertSelfHostMigrationProfileReady: async (database, given) => {
      assert.equal(given, profile);
      calls.push(["readiness", database.user]);
      if (readinessFails) throw Error("synthetic readiness failure");
    },
    applySelfHostCoreRuntimeAcl: async (database, approval) => {
      calls.push(["acl", database.user, approval]);
      if (aclFails) throw Error("synthetic ACL failure");
    },
  };
  const readSecret = async (file) => {
    reads.push(file);
    return fixturePassword(file);
  };
  return { calls, reads, api, readSecret };
}
for (const change of [
  { host: null },
  { port: 0 },
  { tls: "trust" },
  { migrationProfile: "hosted" },
  { acknowledge: "roles" },
  { password: "do-not-accept-credentials" },
  { aclManifestSha256: "invalid" },
  { capabilityProfile: undefined },
  { capabilityProfile: "provider-direct-unreviewed-v2" },
])
  test(`provisioning configuration refuses ${JSON.stringify(change)} before secrets/pools`, async () => {
    const fixture = provisioningFixture();
    assert.throws(() =>
      parseProvisioningConfiguration({ ...provisioning, ...change }, "admin"),
    );
    await assert.rejects(
      runProvisioning(
        "admin",
        { ...provisioning, ...change },
        fixture.api,
        fixture,
      ),
    );
    assert.deepEqual(fixture.reads, []);
    assert.deepEqual(fixture.calls, []);
  });
test("stale ACL approval refuses even admin provisioning before a secret/pool", async () => {
  const fixture = provisioningFixture();
  await assert.rejects(
    runProvisioning(
      "admin",
      { ...provisioning, aclManifestSha256: "b".repeat(64) },
      fixture.api,
      fixture,
    ),
    /stale/,
  );
  assert.deepEqual(fixture.reads, []);
  assert.deepEqual(fixture.calls, []);
});
test("password/verifier policy rejects short/normalized/line-terminated secrets and verifies salted credentials", () => {
  for (const password of [
    "short",
    "x".repeat(24) + "\n",
    "é".repeat(24),
    " " + "x".repeat(24),
  ])
    assert.throws(() => validateProvisioningPassword(password));
  const password = fixturePassword("scram"),
    verifier = scramVerifier(password, Buffer.alloc(16, 7));
  assert.equal(matchesScramVerifier(password, verifier), true);
  assert.equal(matchesScramVerifier(fixturePassword("other"), verifier), false);
  for (const invalid of [
    null,
    "md5abcdef",
    verifier.replace("4096", "1"),
    verifier + "x",
  ])
    assert.equal(matchesScramVerifier(password, invalid), false);
  assert.equal(verifier.includes(password), false);
});
test("empty admin bootstrap creates exact migrator and isolated policy-target logins without plaintext SQL or runtime grants", async () => {
  const fixture = provisioningFixture();
  const receipt = await runProvisioning(
    "admin",
    provisioning,
    fixture.api,
    fixture,
  );
  const statements = fixture.calls
    .filter(([kind]) => kind === "query")
    .map((entry) => entry[2]);
  assert.equal(
    statements.filter((statement) => statement.startsWith("CREATE ROLE"))
      .length,
    6,
  );
  assert.match(
    statements.find((statement) => statement.startsWith("CREATE ROLE")),
    /^CREATE ROLE cloudmarkup_admin LOGIN NOSUPERUSER CREATEROLE NOINHERIT NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD 'SCRAM-SHA-256\$/,
  );
  const runtimeRoles = statements.filter((statement) =>
    statement.startsWith("CREATE ROLE cloudmarkup_beta_"),
  );
  assert.equal(runtimeRoles.length, 5);
  for (const [index, purpose] of runtimePurposes.entries())
    assert.match(
      runtimeRoles[index],
      new RegExp(
        `^CREATE ROLE cloudmarkup_beta_${purpose}_runtime LOGIN NOSUPERUSER NOCREATEROLE NOINHERIT NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD 'SCRAM-SHA-256\\$`,
      ),
    );
  assert.equal(
    statements.some((statement) => /^GRANT|SET ROLE/u.test(statement)),
    false,
  );
  assert.equal(fixture.reads.length, 7);
  for (const reference of fixture.reads)
    assert.equal(
      statements.some((statement) =>
        statement.includes(fixturePassword(reference)),
      ),
      false,
    );
  assert.deepEqual(
    fixture.calls.filter(([kind]) => kind === "pool" || kind === "close"),
    [
      ["pool", "cloudmarkup_owner"],
      ["close", "cloudmarkup_owner"],
    ],
  );
  assert.equal(receipt.applicationReadinessQualified, false);
  assert.equal(JSON.stringify(receipt).includes("password"), false);
  for (const readSecret of [
    async () => fixturePassword("same"),
    async (file) =>
      file.endsWith("cleanup.password") ? "short" : fixturePassword(file),
  ]) {
    const rejected = provisioningFixture();
    await assert.rejects(
      runProvisioning("admin", provisioning, rejected.api, { readSecret }),
    );
    assert.deepEqual(rejected.calls, []);
  }
});
for (const row of [
  { database_owner: "foreign", empty: true },
  { database_owner: "cloudmarkup_owner", empty: false },
])
  test(`admin refuses a foreign/nonempty database ${JSON.stringify(row)} and closes`, async () => {
    const fixture = provisioningFixture({
      queryOverride: (statement) =>
        statement.text.includes("AS database_owner")
          ? { rowCount: 1, rows: [row] }
          : undefined,
    });
    await assert.rejects(
      runProvisioning("admin", provisioning, fixture.api, fixture),
      /dedicated empty/,
    );
    assert.equal(
      fixture.calls.some((entry) => entry[2]?.startsWith("CREATE ROLE")),
      false,
    );
    assert.deepEqual(fixture.calls.at(-1), ["close", "cloudmarkup_owner"]);
  });
test("bootstrap refuses a role masquerading as superuser before any role write", async () => {
  const fixture = provisioningFixture({
    queryOverride: (statement) =>
      statement.text.includes("AS actual_superuser")
        ? {
            rowCount: 1,
            rows: [
              {
                database_name: "cloudmarkup",
                login: "cloudmarkup_owner",
                effective_role: "cloudmarkup_owner",
                server_version: 170011,
                actual_superuser: false,
                standalone: true,
                self_grant: "",
                replication_role: "origin",
              },
            ],
          }
        : undefined,
  });
  await assert.rejects(
    runProvisioning("admin", provisioning, fixture.api, fixture),
    /grantor posture/,
  );
  assert.equal(
    fixture.calls.some((entry) => entry[2]?.startsWith("CREATE ROLE")),
    false,
  );
  assert.deepEqual(fixture.calls.at(-1), ["close", "cloudmarkup_owner"]);
});
test("runtime roles require completed schema checks before opening the privileged grantor", async () => {
  const fixture = provisioningFixture({ readinessFails: true });
  await assert.rejects(
    runProvisioning(
      "roles",
      { ...provisioning, acknowledge: "roles" },
      fixture.api,
      fixture,
    ),
    /readiness/,
  );
  assert.deepEqual(
    fixture.calls.filter(([kind]) => kind === "pool" || kind === "close"),
    [
      ["pool", "cloudmarkup_admin"],
      ["close", "cloudmarkup_admin"],
    ],
  );
});
test("runtime provisioning uses the actual bootstrap grantor for five isolated logins after complete history", async () => {
  const fixture = provisioningFixture();
  await runProvisioning(
    "roles",
    { ...provisioning, acknowledge: "roles" },
    fixture.api,
    fixture,
  );
  const roleCalls = fixture.calls.filter((entry) =>
    entry[2]?.startsWith("CREATE ROLE"),
  );
  assert.equal(roleCalls.length, 5);
  for (const [index, purpose] of runtimePurposes.entries()) {
    assert.equal(roleCalls[index][1], "cloudmarkup_owner");
    assert.match(
      roleCalls[index][2],
      new RegExp(
        `^CREATE ROLE cloudmarkup_beta_${purpose}_runtime LOGIN NOSUPERUSER NOCREATEROLE NOINHERIT`,
      ),
    );
  }
  assert.equal(
    fixture.calls.findIndex((entry) =>
      entry[2]?.includes("SELECT version,checksum_sha256"),
    ) < fixture.calls.findIndex((entry) => entry[2]?.startsWith("CREATE ROLE")),
    true,
  );
  assert.equal(
    fixture.calls.some(([kind]) => kind === "acl"),
    false,
  );
  assert.deepEqual(fixture.calls.at(-1), ["close", "cloudmarkup_owner"]);
});
test("changed installed ledger refuses runtime role creation despite earlier schema receipt", async () => {
  const fixture = provisioningFixture({
    queryOverride: (statement) =>
      statement.text.startsWith("SELECT version,checksum_sha256")
        ? {
            rowCount: 1,
            rows: [{ version: "0000", checksum_sha256: "b".repeat(64) }],
          }
        : undefined,
  });
  await assert.rejects(
    runProvisioning(
      "roles",
      { ...provisioning, acknowledge: "roles" },
      fixture.api,
      fixture,
    ),
    /history/,
  );
  assert.equal(
    fixture.calls.some((entry) => entry[2]?.startsWith("CREATE ROLE")),
    false,
  );
  assert.deepEqual(fixture.calls.at(-1), ["close", "cloudmarkup_owner"]);
});
test("duplicate credentials refuse before constructing any pool", async () => {
  const fixture = provisioningFixture();
  await assert.rejects(
    runProvisioning(
      "roles",
      { ...provisioning, acknowledge: "roles" },
      fixture.api,
      { readSecret: async () => fixturePassword("same") },
    ),
    /must differ/,
  );
  assert.deepEqual(fixture.calls, []);
});
for (const aclFails of [false, true])
  test(`ACL stage mounts/uses only the migrator credential and closes on ${aclFails ? "failure" : "success"}`, async () => {
    const fixture = provisioningFixture({ aclFails });
    const action = runProvisioning(
      "acl",
      { ...provisioning, acknowledge: "acl" },
      fixture.api,
      fixture,
    );
    if (aclFails) await assert.rejects(action, /synthetic ACL/);
    else await action;
    assert.deepEqual(fixture.reads, ["/run/secrets/migrator_password"]);
    assert.deepEqual(
      fixture.calls.filter(([kind]) => kind === "pool" || kind === "close"),
      [
        ["pool", "cloudmarkup_admin"],
        ["close", "cloudmarkup_admin"],
      ],
    );
    assert.deepEqual(fixture.calls.find(([kind]) => kind === "acl")[2], {
      acknowledgeRuntimeAcl: true,
      capabilityProfile: "local-editor-core-v1",
      profileManifestSha256: digest,
      aclManifestSha256: digest,
    });
  });
test("explicit full provider ACL selection requires its own reviewed manifest and cannot silently select the core recipe", async () => {
  const fixture = provisioningFixture();
  const fullDigest = "b".repeat(64);
  fixture.api.loadSelfHostRuntimeAclProposal = async () => ({
    manifestSha256: fullDigest,
    state: "REVIEW_ONLY_UNARMED",
  });
  fixture.api.applySelfHostRuntimeAcl = async (database, approval) =>
    fixture.calls.push(["provider-acl", database.user, approval]);
  const configuration = {
    ...provisioning,
    acknowledge: "acl",
    capabilityProfile: "provider-direct-v1",
  };
  await assert.rejects(
    runProvisioning("acl", configuration, fixture.api, fixture),
    /approval is stale/,
  );
  assert.equal(fixture.reads.length, 0);
  await runProvisioning(
    "acl",
    { ...configuration, aclManifestSha256: fullDigest },
    fixture.api,
    fixture,
  );
  assert.equal(fixture.calls.filter(([kind]) => kind === "acl").length, 0);
  assert.deepEqual(
    fixture.calls.find(([kind]) => kind === "provider-acl"),
    [
      "provider-acl",
      "cloudmarkup_admin",
      {
        acknowledgeRuntimeAcl: true,
        profileManifestSha256: digest,
        aclManifestSha256: fullDigest,
      },
    ],
  );
});
test("runtime check proves five actual caller logins without privileged credentials or readiness claims", async () => {
  const fixture = provisioningFixture();
  const receipt = await runProvisioning(
    "check",
    { ...provisioning, acknowledge: "check" },
    fixture.api,
    fixture,
  );
  assert.equal(receipt.databasePreflightOnly, true);
  assert.equal(receipt.applicationReadinessQualified, false);
  assert.deepEqual(
    fixture.calls.filter(([kind]) => kind === "pool").map((entry) => entry[1]),
    runtimePurposes.map((purpose) => `cloudmarkup_beta_${purpose}_runtime`),
  );
  assert.equal(
    fixture.reads.every((file) =>
      file.startsWith("/run/cloudmarkup/secrets/database/"),
    ),
    true,
  );
  assert.equal(fixture.calls.filter(([kind]) => kind === "close").length, 5);
  assert.equal(
    fixture.calls.some(([kind]) => kind === "acl"),
    false,
  );
});
test("missing local-session grants refuses runtime preflight and disposes its pool", async () => {
  const fixture = provisioningFixture({
    queryOverride: (statement) =>
      statement.text.includes("AS local_session_permissions")
        ? { rowCount: 1, rows: [{ local_session_permissions: false }] }
        : undefined,
  });
  await assert.rejects(
    runProvisioning(
      "check",
      { ...provisioning, acknowledge: "check" },
      fixture.api,
      fixture,
    ),
    /Local session permissions/,
  );
  assert.deepEqual(fixture.calls.at(-1), [
    "close",
    "cloudmarkup_beta_api_runtime",
  ]);
});

for (const change of [
  { isolated: false },
  { rolpassword: null },
  { rolsuper: true },
])
  test(`existing runtime role refuses unsafe posture or unknown credentials ${JSON.stringify(change)}`, async () => {
    const fixture = provisioningFixture({
      queryOverride: (statement) =>
        statement.text.includes("FROM pg_catalog.pg_authid")
          ? {
              rowCount: 1,
              rows: [
                {
                  rolcanlogin: true,
                  rolsuper: false,
                  rolinherit: false,
                  rolcreaterole: false,
                  rolcreatedb: false,
                  rolreplication: false,
                  rolbypassrls: false,
                  rolvaliduntil: null,
                  isolated: true,
                  owns_nothing: true,
                  rolpassword: scramVerifier(
                    fixturePassword(
                      "/run/cloudmarkup/secrets/database/api.password",
                    ),
                    Buffer.alloc(16, 7),
                  ),
                  ...change,
                },
              ],
            }
          : undefined,
    });
    await assert.rejects(
      runProvisioning(
        "roles",
        { ...provisioning, acknowledge: "roles" },
        fixture.api,
        fixture,
      ),
      /automatic adoption\/rotation refused/,
    );
    assert.equal(
      fixture.calls.some(
        (entry) =>
          entry[2]?.startsWith("CREATE ROLE") ||
          entry[2]?.startsWith("ALTER ROLE"),
      ),
      false,
    );
    assert.deepEqual(fixture.calls.at(-1), ["close", "cloudmarkup_owner"]);
  });

test("runtime check refuses a different purpose login even after general profile readiness", async () => {
  const fixture = provisioningFixture({
    queryOverride: (statement) =>
      statement.text.includes("AS owns_nothing")
        ? {
            rowCount: 1,
            rows: [
              {
                owns_nothing: true,
                login: "cloudmarkup_beta_billing_runtime",
                effective_role: "cloudmarkup_beta_billing_runtime",
              },
            ],
          }
        : undefined,
  });
  await assert.rejects(
    runProvisioning(
      "check",
      { ...provisioning, acknowledge: "check" },
      fixture.api,
      fixture,
    ),
    /Runtime ownership refused/,
  );
  assert.deepEqual(fixture.calls.at(-1), [
    "close",
    "cloudmarkup_beta_api_runtime",
  ]);
});

const restoreNames = [
  "cloudmarkup_notes_native_lock_owner",
  "cloudmarkup_notes_publication_authority",
  "cloudmarkup_notes_shared_native_producer",
  "cloudmarkup_gpt6_private_receipt_issuer",
];
function privateRoleRow(rolname) {
  const administrator = rolname === "cloudmarkup_admin";
  return {
    rolname,
    rolcanlogin: administrator,
    rolsuper: false,
    rolinherit: false,
    rolcreaterole: administrator,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconnlimit: -1,
    rolvaliduntil: null,
    has_password: administrator,
    no_settings: true,
    no_dependencies: !administrator,
  };
}
async function restoreFixture({ complete = false, queryOverride } = {}) {
  const restoreRoles = {
    source: await readFile(
      join(
        migrationDirectory,
        "0127_private_notes_and_gpt6_receipt_authorities.sql",
      ),
      "utf8",
    ),
    roles: new Map([
      ["cloudmarkup_admin", privateRoleRow("cloudmarkup_admin")],
    ]),
    edges: new Map(),
  };
  if (complete)
    for (const name of restoreNames) {
      restoreRoles.roles.set(name, privateRoleRow(name));
      restoreRoles.edges.set(name, {
        role_name: name,
        member_name: "cloudmarkup_admin",
        grantor_name: "cloudmarkup_owner",
        admin_option: true,
        inherit_option: false,
        set_option: false,
      });
    }
  const fixture = provisioningFixture({ restoreRoles, queryOverride });
  return {
    ...fixture,
    restoreRoles,
    run: () =>
      runProvisioning(
        "restore-roles",
        { ...provisioning, acknowledge: "restore-roles" },
        fixture.api,
        fixture,
      ),
  };
}
const roleWrites = (fixture) =>
  fixture.calls.filter(
    ([kind, , statement]) =>
      kind === "query" &&
      /^(?:CREATE ROLE|GRANT|ALTER|REVOKE)/u.test(statement),
  );
test("restore dependencies use the real 0127 declarations, existing bootstrap secret and exact four private creator edges", async () => {
  const fixture = await restoreFixture();
  const receipt = await fixture.run();
  const edgeReads = fixture.calls.filter(
    ([kind, , statement]) =>
      kind === "query" &&
      statement?.startsWith("SELECT r.rolname AS role_name"),
  );
  assert.equal(edgeReads.length, 2);
  for (const [, , statement] of edgeReads) {
    assert.match(
      statement,
      /WHERE r\.rolname=ANY\(\$1::text\[\]\) OR a\.rolname=ANY\(\$1::text\[\]\)/u,
    );
    assert.match(statement, /OR g\.rolname=ANY/u);
  }
  assert.deepEqual(fixture.reads, ["/run/secrets/postgres_owner_password"]);
  const writes = roleWrites(fixture).map((entry) => entry[2]);
  assert.equal(writes.length, 16);
  for (const [index, name] of restoreNames.entries()) {
    assert.equal(
      writes[index * 4],
      `CREATE ROLE ${name} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    assert.deepEqual(
      writes.slice(index * 4 + 1, index * 4 + 4),
      ["ADMIN TRUE", "INHERIT FALSE", "SET FALSE"].map(
        (option) =>
          `GRANT ${name} TO cloudmarkup_admin WITH ${option} GRANTED BY cloudmarkup_owner`,
      ),
    );
  }
  assert.equal(
    writes.some((statement) =>
      /PASSWORD|ON (?:TABLE|SCHEMA|DATABASE)|SET ROLE|cloudmarkup_beta_/u.test(
        statement,
      ),
    ),
    false,
  );
  assert.equal(receipt.stage, "restore-roles");
  assert.equal(receipt.applicationReadinessQualified, false);
  assert.deepEqual(fixture.calls.slice(-2), [
    ["commit", "cloudmarkup_owner"],
    ["close", "cloudmarkup_owner"],
  ]);
});
test("restore dependency retry reads the complete exact graph without role mutations", async () => {
  const fixture = await restoreFixture({ complete: true });
  await fixture.run();
  assert.deepEqual(roleWrites(fixture), []);
  assert.equal(
    fixture.calls.filter((entry) => entry[2]?.startsWith("SELECT r.rolname,"))
      .length,
    2,
  );
});
test("restore dependency source expansion, missing role and changed posture refuse before credentials or pools", async () => {
  for (const change of [
    (source) => source.replace("CREATE ROLE", "-- removed declaration\nSELECT"),
    (source) => source.replace("NOLOGIN", "LOGIN"),
    (source) => `${source}\nCREATE ROLE foreign_role NOLOGIN;`,
  ]) {
    const fixture = await restoreFixture();
    fixture.restoreRoles.source = change(fixture.restoreRoles.source);
    await assert.rejects(fixture.run(), /declarations differ/);
    assert.deepEqual(fixture.reads, []);
    assert.deepEqual(fixture.calls, []);
  }
});
test("restore dependency admission refuses nonempty/unprepared targets and every foreign role or membership before DDL", async () => {
  for (const change of [
    { database_owner: "cloudmarkup_owner", empty: true },
    { database_owner: "cloudmarkup_admin", empty: false },
  ]) {
    const fixture = await restoreFixture({
      queryOverride: (statement) =>
        statement.text.includes("AS database_owner")
          ? { rowCount: 1, rows: [change] }
          : undefined,
    });
    await assert.rejects(fixture.run(), /empty target/);
    assert.deepEqual(roleWrites(fixture), []);
    assert.deepEqual(fixture.calls.at(-1), ["close", "cloudmarkup_owner"]);
  }
  const partial = await restoreFixture({ complete: true });
  partial.restoreRoles.roles.delete(restoreNames[0]);
  partial.restoreRoles.edges.delete(restoreNames[0]);
  await assert.rejects(partial.run(), /posture\/dependencies/);
  assert.deepEqual(roleWrites(partial), []);
  for (const change of [
    { rolcanlogin: true },
    { rolsuper: true },
    { rolcreaterole: true },
    { rolinherit: true },
    { rolconnlimit: 2 },
    { has_password: true },
    { no_settings: false },
    { no_dependencies: false },
  ]) {
    const fixture = await restoreFixture({ complete: true });
    Object.assign(fixture.restoreRoles.roles.get(restoreNames[3]), change);
    await assert.rejects(fixture.run(), /posture\/dependencies/);
    assert.deepEqual(roleWrites(fixture), []);
  }
  for (const change of [
    { grantor_name: "cloudmarkup_admin" },
    { member_name: "foreign_member" },
    { admin_option: false },
    { inherit_option: true },
    { set_option: true },
  ]) {
    const fixture = await restoreFixture({ complete: true });
    Object.assign(fixture.restoreRoles.edges.get(restoreNames[3]), change);
    await assert.rejects(fixture.run(), /membership graph/);
    assert.deepEqual(roleWrites(fixture), []);
  }
});
test("restore role write failure and contradictory postimage reject the transaction and dispose the bootstrap pool", async () => {
  for (const failure of ["grant", "postimage"]) {
    let reads = 0;
    const fixture = await restoreFixture({
      queryOverride: (statement) => {
        if (failure === "grant" && statement.text.startsWith("GRANT"))
          throw Error("synthetic grant failure");
        if (
          failure === "postimage" &&
          statement.text.startsWith("SELECT r.rolname,") &&
          ++reads === 2
        )
          return { rowCount: 0, rows: [] };
        return undefined;
      },
    });
    await assert.rejects(fixture.run());
    assert.deepEqual(fixture.calls.slice(-2), [
      ["rollback", "cloudmarkup_owner"],
      ["close", "cloudmarkup_owner"],
    ]);
    assert.equal(
      fixture.calls.some(([kind]) => kind === "commit"),
      false,
    );
  }
});
