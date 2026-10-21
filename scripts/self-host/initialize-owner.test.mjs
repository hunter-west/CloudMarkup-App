import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initializeOwner,
  inspectOwnerConfiguration,
  parseOwnerConfiguration,
} from "./initialize-owner.mjs";

const owner = {
  principalId: "principal_local_owner",
  ownerDisplayName: "Local owner",
  organizationId: "org_local_owner",
  organizationDisplayName: "Personal",
  slug: "local-owner",
  membershipId: "membership_local_owner",
};
const configuration = {
  host: "postgres",
  port: 5432,
  database: "cloudmarkup",
  user: "cloudmarkup_admin",
  passwordFile: "/run/secrets/migrator_password",
  tls: "disable",
  canonicalManifestSha256: "a".repeat(64),
  profileManifestSha256: "b".repeat(64),
  acknowledgeInitializeLocalOwner: true,
  owner,
};
const profile = {
  identity: {
    profileId: "cloudmarkup-standalone-pg17-v1",
    canonicalManifestSha256: configuration.canonicalManifestSha256,
    manifestSha256: configuration.profileManifestSha256,
  },
};
function entry({ stale = false, seedFailure = false } = {}) {
  const calls = { pools: 0, closed: 0, seeds: 0 };
  const api = {
    parseLocalOwnerSeedInput: (value) => value,
    loadSelfHostMigrationProfile: async () =>
      stale
        ? { identity: { ...profile.identity, manifestSha256: "c".repeat(64) } }
        : profile,
    PostgresDatabase: class {
      constructor(settings) {
        calls.pools++;
        assert.equal(settings.user, "cloudmarkup_admin");
        assert.equal(settings.max, 1);
      }
      async close() {
        calls.closed++;
      }
    },
    seedLocalOwnerWorkspace: async (database, approved, seed) => {
      assert.equal(approved, profile);
      assert.deepEqual(seed, owner);
      assert.ok(database);
      calls.seeds++;
      if (seedFailure) throw Error("Synthetic seed refusal");
      return {
        profileId: profile.identity.profileId,
        principalId: seed.principalId,
      };
    },
  };
  return { api, calls };
}

test("owner operator configuration refuses ambient/runtime identity and unknown input", () => {
  for (const change of [
    { user: "cloudmarkup_beta_api_runtime" },
    { tls: "require" },
    { acknowledgeInitializeLocalOwner: false },
    { port: 0 },
    { host: "postgres?password=hidden" },
    { passwordFile: "/tmp/password" },
    { providerApiKey: "synthetic-never-read" },
  ])
    assert.throws(() =>
      parseOwnerConfiguration(
        { ...configuration, ...change },
        (value) => value,
      ),
    );
  assert.deepEqual(
    parseOwnerConfiguration(configuration, (value) => value),
    configuration,
  );
});

test("inspection binds source without connecting to a database or applying seed", async () => {
  const { api, calls } = entry();
  const receipt = await inspectOwnerConfiguration(configuration, api);
  assert.equal(receipt.databaseAccessed, false);
  assert.equal(receipt.changesApplied, false);
  assert.equal(receipt.principalId, owner.principalId);
  assert.equal(calls.pools, 0);
  assert.equal(calls.seeds, 0);
  assert.equal("passwordFile" in receipt, false);
});

test("stale approved source or malformed password creates no operator pool", async () => {
  const stale = entry({ stale: true });
  await assert.rejects(
    initializeOwner(configuration, stale.api, "synthetic-password"),
  );
  assert.equal(stale.calls.pools, 0);
  const invalid = entry();
  await assert.rejects(
    initializeOwner(configuration, invalid.api, "synthetic-password\n"),
  );
  assert.equal(invalid.calls.pools, 0);
});

test("the explicit initializer closes its one pool after success and refusal", async () => {
  const success = entry();
  assert.equal(
    (await initializeOwner(configuration, success.api, "synthetic-password"))
      .principalId,
    owner.principalId,
  );
  assert.deepEqual(success.calls, { pools: 1, closed: 1, seeds: 1 });
  const refused = entry({ seedFailure: true });
  await assert.rejects(
    initializeOwner(configuration, refused.api, "synthetic-password"),
  );
  assert.deepEqual(refused.calls, { pools: 1, closed: 1, seeds: 1 });
});
