import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadMigrations,
  runMigrations,
} from "../adapters/persistence/migrations.js";
import {
  applySelfHostMigrationProfile as publicApplyProfile,
  applySelfHostRuntimeAcl as publicApplyAcl,
  assertSelfHostMigrationProfileReady as publicProfileReadiness,
  loadSelfHostMigrationProfile as publicLoadProfile,
  loadSelfHostRuntimeAclProposal as publicLoadAclProposal,
  loadSelfHostCoreRuntimeAclProposal as publicLoadCoreAclProposal,
  applySelfHostCoreRuntimeAcl as publicApplyCoreAcl,
  type SelfHostMigrationProfile as PublicProfile,
  type SelfHostMigrationProfileIdentity as PublicProfileIdentity,
  type SelfHostRuntimeAclProposal as PublicAclProposal,
} from "../persistence.js";
import type {
  SqlDatabase,
  SqlRow,
  SqlStatement,
  SqlResult,
} from "../adapters/persistence/sql.js";
import {
  applySelfHostMigrationProfile,
  applySelfHostRuntimeAcl,
  assertSelfHostMigrationProfileReady,
  assertSelfHostProfilePosture,
  loadSelfHostMigrationProfile,
  loadSelfHostRuntimeAclProposal,
  loadSelfHostCoreRuntimeAclProposal,
  applySelfHostCoreRuntimeAcl,
  SELF_HOST_PROFILE_ID,
  SelfHostMigrationProfileError,
  type SelfHostMigrationProfile,
} from "./migration-profile.js";

const api = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const canonical = join(api, "migrations"),
  portable = join(api, "self-host-migrations");
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const posture: SqlRow = {
  database_name: "cloudmarkup",
  login: "cloudmarkup_admin",
  effective_role: "cloudmarkup_admin",
  server_version: 170011,
  replication_role: "origin",
  self_grant: "",
  standalone: true,
  bootstrap_owner: true,
  safe_owner: true,
  safe_caller: true,
  has_profile: true,
  has_ledger: true,
};
const installation: SqlRow = {
  singleton: true,
  profile_id: SELF_HOST_PROFILE_ID,
  profile_version: 1,
  engine_major: 17,
  schema_owner: "cloudmarkup_admin",
  bootstrap_grantor: "cloudmarkup_owner",
  actual_owner: "cloudmarkup_admin",
};
function database(
  profile: SelfHostMigrationProfile,
  options: {
    posture?: Partial<SqlRow>;
    identity?: Partial<SqlRow>;
    wrongChecksum?: boolean;
    unmarked?: boolean;
    aclStatements?: readonly string[];
  } = {},
) {
  const commands: string[] = [];
  const history = profile.migrations.map((entry) => ({
    version: entry.version,
    checksum_sha256: entry.checksumSha256,
  }));
  if (options.wrongChecksum) {
    const entry = history[1];
    if (!entry) throw new Error("Missing synthetic history entry.");
    history[1] = { ...entry, checksum_sha256: "f".repeat(64) };
  }
  const db: SqlDatabase = {
    close: () => {
      commands.push("closed");
      return Promise.resolve();
    },
    transaction: async (work) => work(db),
    query: <TRow extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> => {
      commands.push(statement.text);
      let rows: SqlRow[];
      if (statement.text.startsWith("SELECT pg_catalog.current_database()"))
        rows = [
          {
            ...posture,
            ...options.posture,
            ...(options.unmarked ? { has_profile: false } : {}),
          },
        ];
      else if (statement.text.startsWith("SELECT p.*"))
        rows = [{ ...installation, ...options.identity }];
      else if (
        statement.text.includes(
          "SELECT version FROM public.cloudmarkup_schema_migrations LIMIT",
        )
      )
        rows = [{ version: "0001" }];
      else if (statement.text.includes("WHERE version = $1"))
        rows = history.filter((entry) => entry.version === statement.values[0]);
      else if (
        statement.text.includes("SELECT version,checksum_sha256") ||
        statement.text.includes("SELECT version, checksum_sha256")
      )
        rows = history;
      else if (
        statement.text.includes("pg_advisory_xact_lock") ||
        statement.text.startsWith("SET LOCAL") ||
        statement.text.includes(
          "CREATE TABLE IF NOT EXISTS cloudmarkup_schema_migrations",
        )
      )
        rows = [];
      else if (options.aclStatements?.includes(statement.text)) rows = [];
      else
        return Promise.reject(
          new Error("Unexpected synthetic operator statement."),
        );
      return Promise.resolve({ rowCount: rows.length, rows: rows as TRow[] });
    },
  };
  return { db, commands };
}

describe("explicit standalone schema profile", () => {
  it("declared persistence entry exposes the operator, unarmed proposal and profile types", async () => {
    expect(publicApplyProfile).toBe(applySelfHostMigrationProfile);
    expect(publicApplyAcl).toBe(applySelfHostRuntimeAcl);
    expect(publicProfileReadiness).toBe(assertSelfHostMigrationProfileReady);
    expect(publicLoadProfile).toBe(loadSelfHostMigrationProfile);
    expect(publicLoadAclProposal).toBe(loadSelfHostRuntimeAclProposal);
    expect(publicLoadCoreAclProposal).toBe(loadSelfHostCoreRuntimeAclProposal);
    expect(publicApplyCoreAcl).toBe(applySelfHostCoreRuntimeAcl);
    const profile: PublicProfile = await publicLoadProfile();
    const identity: PublicProfileIdentity = profile.identity;
    const proposal: PublicAclProposal = await publicLoadAclProposal();
    expect(identity.profileId).toBe(SELF_HOST_PROFILE_ID);
    expect(proposal.state).toBe("REVIEW_ONLY_UNARMED");
  });
  it("reuses all common migrations and all nonoperational 0127 statements without hosted changes", async () => {
    const before = await readFile(join(canonical, "manifest.json"));
    const common = await loadMigrations(canonical),
      profile = await loadSelfHostMigrationProfile();
    expect(profile.migrations).toHaveLength(common.length + 1);
    expect(profile.migrations[0]?.version).toBe("0000");
    expect(profile.identity.profileId).toBe(SELF_HOST_PROFILE_ID);
    for (const entry of common.filter((entry) => entry.version !== "0127"))
      expect(
        profile.migrations.find((part) => part.version === entry.version),
      ).toEqual(entry);
    const original = common.find((entry) => entry.version === "0127"),
      replacement = profile.migrations.find(
        (entry) => entry.version === "0127",
      );
    if (!original || !replacement)
      throw new Error("Missing private-receipt source fixture.");
    const operational = (statement: string) =>
      /DO \$cm_private_bootstrap_(admission|owner_edge|final)\$/u.test(
        statement,
      );
    expect(
      replacement.statements.filter((statement) => !operational(statement)),
    ).toEqual(
      original.statements.filter((statement) => !operational(statement)),
    );
    expect(replacement.checksumSha256).not.toBe(original.checksumSha256);
    expect(replacement.statements.join("\n")).toContain("cloudmarkup_owner");
    expect(profile.migrations.at(-1)?.version).toBe("0138");
    expect(hash(await readFile(join(canonical, "manifest.json")))).toBe(
      hash(before),
    );
  });
  for (const change of [
    { profileId: "hosted" },
    { profileVersion: 2 },
    { engineMajor: 16 },
    { owner: "cloudmarkup_owner" },
    { bootstrapGrantor: "rdsadmin" },
  ])
    it(`refuses a different profile/version/engine/owner: ${JSON.stringify(change)}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "cm-profile-source-"));
      try {
        await cp(portable, directory, { recursive: true });
        const value: unknown = JSON.parse(
          await readFile(join(directory, "manifest.json"), "utf8"),
        );
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Invalid synthetic profile manifest.");
        await writeFile(
          join(directory, "manifest.json"),
          JSON.stringify({ ...value, ...change }),
        );
        await expect(
          loadSelfHostMigrationProfile({ profileDirectory: directory }),
        ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  it("refuses tampered or extra unregistered portable SQL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cm-profile-source-"));
    try {
      await cp(portable, directory, { recursive: true });
      await writeFile(join(directory, "0999_unregistered.sql"), "SELECT 1;");
      await expect(
        loadSelfHostMigrationProfile({ profileDirectory: directory }),
      ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
      await rm(join(directory, "0999_unregistered.sql"));
      await writeFile(
        join(directory, "0000_self_host_profile_identity.sql"),
        "SELECT 1;",
      );
      await expect(
        loadSelfHostMigrationProfile({ profileDirectory: directory }),
      ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  for (const change of [
    { server_version: 160011 },
    { server_version: 180000 },
    { server_version: 170000.5 },
    { database_name: "other" },
    { standalone: false },
    { bootstrap_owner: false },
    { safe_owner: false },
    { safe_caller: false },
    { self_grant: "set,inherit" },
    { replication_role: "replica" },
    { login: "cloudmarkup_owner", effective_role: "cloudmarkup_owner" },
    { effective_role: "cloudmarkup_beta_api_runtime" },
  ])
    it(`fails closed on actual catalog posture ${JSON.stringify(change)}`, () => {
      expect(() => {
        assertSelfHostProfilePosture({ ...posture, ...change }, true);
      }).toThrow(SelfHostMigrationProfileError);
    });
  it("allows only the explicit operator at apply, while guarded purpose readers can inspect readiness", () => {
    const row = {
      ...posture,
      login: "cloudmarkup_beta_proposal_runtime",
      effective_role: "cloudmarkup_beta_proposal_runtime",
    };
    expect(() => {
      assertSelfHostProfilePosture(row);
    }).not.toThrow();
    expect(() => {
      assertSelfHostProfilePosture(row, true);
    }).toThrow(SelfHostMigrationProfileError);
  });
  it("refuses an unmarked canonical/legacy installation before the migration runner", async () => {
    const profile = await loadSelfHostMigrationProfile(),
      fake = database(profile, { unmarked: true });
    await expect(
      applySelfHostMigrationProfile(fake.db, profile),
    ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
    expect(
      fake.commands.some((command) => command.includes("CREATE TABLE")),
    ).toBe(false);
  });
  it("refuses an unmarked database with preexisting schema functions before writing a profile", async () => {
    const profile = await loadSelfHostMigrationProfile();
    const fake = database(profile, {
      posture: {
        has_profile: false,
        has_ledger: false,
        has_unmarked_functions: true,
      },
    });
    await expect(
      applySelfHostMigrationProfile(fake.db, profile),
    ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
    expect(
      fake.commands.some((command) => command.includes("CREATE TABLE")),
    ).toBe(false);
  });
  it("makes the untouched hosted runner refuse the standalone 0000 history", async () => {
    const profile = await loadSelfHostMigrationProfile(),
      fake = database(profile);
    await expect(
      runMigrations(fake.db, await loadMigrations(canonical)),
    ).rejects.toThrow();
    expect(
      fake.commands.some((command) =>
        command.includes("INSERT INTO cloudmarkup_schema_migrations"),
      ),
    ).toBe(false);
  });
  for (const options of [
    { posture: { has_profile: false } },
    { identity: { profile_version: 2 } },
    { identity: { actual_owner: "cloudmarkup_owner" } },
    { wrongChecksum: true },
  ])
    it(`readiness rejects missing/mixed/foreign-owned/checksum state ${JSON.stringify(options)}`, async () => {
      const profile = await loadSelfHostMigrationProfile(),
        fake = database(profile, options);
      await expect(
        assertSelfHostMigrationProfileReady(fake.db, profile),
      ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
    });
  it("repeats registered history checks using the canonical transaction/lock runner without ACL activation", async () => {
    const profile = await loadSelfHostMigrationProfile(),
      fake = database(profile);
    await applySelfHostMigrationProfile(fake.db, profile);
    await applySelfHostMigrationProfile(fake.db, profile);
    expect(
      fake.commands.some((command) =>
        command.includes("pg_advisory_xact_lock"),
      ),
    ).toBe(true);
    expect(fake.commands.some((command) => command.startsWith("GRANT "))).toBe(
      false,
    );
    expect(fake.commands).not.toContain("closed");
  });
  it("assembles a separate unarmed ACL proposal preserving fixed columns and journal guards", async () => {
    const proposal = await loadSelfHostRuntimeAclProposal();
    const core = await loadSelfHostCoreRuntimeAclProposal();
    expect(core.capabilityProfile).toBe("local-editor-core-v1");
    expect(core.statements.join(";\n")).not.toContain(
      "DO $provider_direct_acl$",
    );
    expect(core.statements.length).toBeLessThan(proposal.statements.length);
    const directory = await mkdtemp(join(tmpdir(), "cm-core-acl-source-"));
    try {
      await cp(join(api, "authorization-proposals"), directory, {
        recursive: true,
      });
      const manifestPath = join(
        directory,
        "self-host-core-runtime-acl-v2.json",
      );
      const manifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as Record<string, unknown> & { inputs: Record<string, unknown>[] };
      for (const change of [
        { proposalContractVersion: 1 },
        { capabilityProfile: "provider-direct-v1" },
        { installedProfileManifestSha256: "f".repeat(64) },
        { runtimeActivation: true },
        { arbitrarySelection: true },
        { qualificationRequired: true },
        { inputs: [null, null] },
        {
          inputs: manifest.inputs.map((input, index) =>
            index === 0 ? { ...input, unreviewed: true } : input,
          ),
        },
        {
          inputs: [
            {
              file: "provider-direct-usage-journal-acl-v1.sql",
              checksumSha256: "f".repeat(64),
              selection: "complete",
            },
          ],
        },
      ]) {
        await writeFile(
          manifestPath,
          JSON.stringify({ ...manifest, ...change }),
        );
        await expect(
          loadSelfHostCoreRuntimeAclProposal(directory),
        ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(proposal.state).toBe("REVIEW_ONLY_UNARMED");
    const sql = proposal.statements.join(";\n");
    expect(sql).toContain("DO $self_host_runtime_acl_admission$");
    expect(sql).toContain("DO $provider_direct_acl$");
    expect(sql).toContain("GRANT UPDATE(state,usage_metadata");
    expect(sql).not.toContain("CloudMarkup task-6 PG16 approval bundle");
    expect(sql).not.toMatch(
      /CREATE ROLE|GRANT cloudmarkup_.* TO cloudmarkup_beta/u,
    );
    expect(sql).toContain(
      "GRANT INSERT (session_sha256,lifecycle_status,principal_id,provider_session_sha256,authenticated_at,expires_at)",
    );
    expect(sql).toContain(
      "cloudmarkup_account_session_allowed_v1(text,text,timestamptz,timestamptz)",
    );
    // PostgreSQL also requires SELECT for target columns read via EXCLUDED.
    // Compare real lease SQL with effective proposal columns, not a copied query.
    const leaseSource = await readFile(
      new URL(
        "../adapters/persistence/project-editing-leases.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const baseline = JSON.parse(
      await readFile(
        new URL(
          "../../authorization-proposals/ordinary-local-business-acl.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      consumers: {
        api: {
          tables: {
            project_editing_leases: { SELECT: string[] };
            architecture_drafts: { UPDATE: string[] };
          };
        };
      };
    };
    const excludedReads = [
      ...leaseSource.matchAll(/EXCLUDED\.([a-z_][a-z0-9_]*)/gu),
    ].map((match) => match[1]);
    const effectiveSelect = [
      ...sql.matchAll(
        /GRANT SELECT \(([^)]+)\) ON TABLE public\.project_editing_leases TO cloudmarkup_beta_api_runtime;/gu,
      ),
    ].flatMap((match) => (match[1] ?? "").split(","));
    expect([...new Set(effectiveSelect)].sort()).toEqual(
      [
        ...new Set([
          ...baseline.consumers.api.tables.project_editing_leases.SELECT,
          ...excludedReads,
        ]),
      ].sort(),
    );
    expect(sql).not.toMatch(
      /GRANT SELECT ON TABLE public\.project_editing_leases/u,
    );
    // Real autosave writes must be admitted by the exact column UPDATE grants.
    const draftSource = await readFile(
      new URL("../adapters/persistence/repositories.ts", import.meta.url),
      "utf8",
    );
    const draftSet =
      /`UPDATE architecture_drafts AS d\s+SET([\s\S]*?)\s+FROM projects AS p/u.exec(
        draftSource,
      );
    expect(draftSet).not.toBeNull();
    const writtenColumns = [
      ...(draftSet?.[1] ?? "").matchAll(/\b([a-z_][a-z0-9_]*)\s*=/gu),
    ].map((match) => match[1]);
    expect(writtenColumns.length).toBeGreaterThan(0);
    const effectiveUpdate = [
      ...sql.matchAll(
        /GRANT UPDATE \(([^)]+)\) ON TABLE public\.architecture_drafts TO cloudmarkup_beta_api_runtime;/gu,
      ),
    ].flatMap((match) => (match[1] ?? "").split(","));
    expect([...new Set(effectiveUpdate)].sort()).toEqual(
      [
        ...new Set([
          ...baseline.consumers.api.tables.architecture_drafts.UPDATE,
          ...writtenColumns,
        ]),
      ].sort(),
    );
    expect(sql).not.toMatch(
      /GRANT UPDATE ON TABLE public\.architecture_drafts/u,
    );
  });
  it("explicit ACL activation refuses stale acknowledgement before any transaction or grant", async () => {
    const profile = await loadSelfHostMigrationProfile(),
      fake = database(profile);
    await expect(
      publicApplyAcl(fake.db, {
        acknowledgeRuntimeAcl: true,
        profileManifestSha256: profile.identity.manifestSha256,
        aclManifestSha256: "f".repeat(64),
      }),
    ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
    await expect(
      publicApplyCoreAcl(fake.db, {
        acknowledgeRuntimeAcl: true,
        capabilityProfile: "provider-direct-v1",
        profileManifestSha256: profile.identity.manifestSha256,
        aclManifestSha256: "f".repeat(64),
      }),
    ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
    expect(fake.commands).toEqual([]);
  });
  it("explicit ACL approval refuses non-true JavaScript acknowledgement before any transaction", async () => {
    const profile = await loadSelfHostMigrationProfile(),
      proposal = await loadSelfHostRuntimeAclProposal();
    for (const acknowledgement of [false, 1, "true", null, undefined]) {
      const fake = database(profile);
      await expect(
        publicApplyAcl(fake.db, {
          acknowledgeRuntimeAcl: acknowledgement,
          profileManifestSha256: profile.identity.manifestSha256,
          aclManifestSha256: proposal.manifestSha256,
        }),
      ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
      const core = await loadSelfHostCoreRuntimeAclProposal();
      await expect(
        publicApplyCoreAcl(fake.db, {
          acknowledgeRuntimeAcl: acknowledgement,
          capabilityProfile: "local-editor-core-v1",
          profileManifestSha256: profile.identity.manifestSha256,
          aclManifestSha256: core.manifestSha256,
        }),
      ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
      expect(fake.commands).toEqual([]);
    }
  });
  it("explicit ACL activation rejects a nonoperator actual caller before any grant", async () => {
    const profile = await loadSelfHostMigrationProfile(),
      proposal = await loadSelfHostRuntimeAclProposal();
    const fake = database(profile, {
      posture: {
        login: "cloudmarkup_beta_api_runtime",
        effective_role: "cloudmarkup_beta_api_runtime",
      },
    });
    await expect(
      publicApplyAcl(fake.db, {
        acknowledgeRuntimeAcl: true,
        profileManifestSha256: profile.identity.manifestSha256,
        aclManifestSha256: proposal.manifestSha256,
      }),
    ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
    const core = await loadSelfHostCoreRuntimeAclProposal();
    await expect(
      publicApplyCoreAcl(fake.db, {
        acknowledgeRuntimeAcl: true,
        capabilityProfile: "local-editor-core-v1",
        profileManifestSha256: profile.identity.manifestSha256,
        aclManifestSha256: core.manifestSha256,
      }),
    ).rejects.toBeInstanceOf(SelfHostMigrationProfileError);
    expect(
      fake.commands.some((statement) => statement.startsWith("GRANT ")),
    ).toBe(false);
    const allowed = database(profile, { aclStatements: core.statements });
    await publicApplyCoreAcl(allowed.db, {
      acknowledgeRuntimeAcl: true,
      capabilityProfile: "local-editor-core-v1",
      profileManifestSha256: profile.identity.manifestSha256,
      aclManifestSha256: core.manifestSha256,
    });
    expect(
      core.statements.every((statement) =>
        allowed.commands.includes(statement),
      ),
    ).toBe(true);
    expect(allowed.commands).not.toContain("closed");
  });
});
