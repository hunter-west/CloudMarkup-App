import { describe, expect, it } from "vitest";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "../adapters/persistence/sql.js";
import {
  LocalOwnerBootstrapError,
  parseLocalOwnerSeedInput,
  seedLocalOwnerWorkspace,
  type LocalOwnerSeedInput,
} from "./local-owner-bootstrap.js";
import {
  loadSelfHostMigrationProfile,
  SELF_HOST_PROFILE_ID,
  type SelfHostMigrationProfile,
} from "./migration-profile.js";

const input: LocalOwnerSeedInput = {
  principalId: "principal_local_owner",
  ownerDisplayName: "Local Owner",
  organizationId: "org_local_personal",
  organizationDisplayName: "Personal",
  slug: "local-personal",
  membershipId: "membership_local_owner",
};

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

interface FixtureOptions {
  readonly existing?: string;
  readonly login?: string;
  readonly effectiveRole?: string;
  readonly posture?: Partial<SqlRow>;
  readonly installation?: Partial<SqlRow>;
  readonly staleLedger?: boolean;
  readonly failedInsert?: "principal" | "organization" | "roles" | "membership";
}

function fixture(
  profile: SelfHostMigrationProfile,
  options: FixtureOptions = {},
) {
  const statements: SqlStatement[] = [];
  const events: string[] = [];
  const history = profile.migrations.map((entry) => ({
    version: entry.version,
    checksum_sha256: entry.checksumSha256,
  }));
  if (options.staleLedger) {
    const entry = history.at(1);
    if (entry === undefined)
      throw new Error("Missing synthetic history entry.");
    history[1] = { ...entry, checksum_sha256: "f".repeat(64) };
  }

  const tx: SqlExecutor = {
    query: <TRow extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> => {
      statements.push(statement);
      const text = statement.text;
      let rows: SqlRow[];
      if (text.startsWith("SET ")) rows = [];
      else if (text.includes("pg_advisory_xact_lock"))
        rows = [{ pg_advisory_xact_lock: null }];
      else if (text.startsWith("SELECT session_user::text AS login"))
        rows = [
          {
            login: options.login ?? "cloudmarkup_admin",
            effective_role: options.effectiveRole ?? "cloudmarkup_admin",
          },
        ];
      else if (text.startsWith("SELECT pg_catalog.current_database()"))
        rows = [{ ...posture, ...options.posture }];
      else if (text.startsWith("SELECT p.*"))
        rows = [{ ...installation, ...options.installation }];
      else if (text.startsWith("SELECT version,checksum_sha256"))
        rows = history;
      else if (text.startsWith("LOCK TABLE public.principals")) rows = [];
      else if (text.includes("EXISTS(SELECT 1 FROM public.principals)"))
        rows = [
          {
            principals: options.existing === "principals",
            identity_references: options.existing === "identity_references",
            organizations: options.existing === "organizations",
            organization_roles: options.existing === "organization_roles",
            memberships: options.existing === "memberships",
          },
        ];
      else if (text.startsWith("INSERT INTO public.principals"))
        rows =
          options.failedInsert === "principal"
            ? []
            : [{ principal_id: input.principalId }];
      else if (text.startsWith("INSERT INTO public.organizations"))
        rows =
          options.failedInsert === "organization"
            ? []
            : [{ organization_id: input.organizationId }];
      else if (text.startsWith("INSERT INTO public.organization_roles"))
        rows =
          options.failedInsert === "roles"
            ? [{ role_key: "owner" }]
            : ["owner", "administrator", "editor", "viewer"].map(
                (role_key) => ({ role_key }),
              );
      else if (text.startsWith("INSERT INTO public.memberships"))
        rows =
          options.failedInsert === "membership"
            ? []
            : [{ membership_id: input.membershipId }];
      else
        return Promise.reject(
          new Error(`Unexpected synthetic operator statement: ${text}`),
        );
      return Promise.resolve({ rowCount: rows.length, rows: rows as TRow[] });
    },
  };
  const database: SqlDatabase = {
    query: () =>
      Promise.reject(
        new Error("Seed must not inspect outside its transaction."),
      ),
    close: () =>
      Promise.reject(new Error("Seed does not own the operator pool.")),
    transaction: async (work) => {
      events.push("BEGIN");
      try {
        const result = await work(tx);
        events.push("COMMIT");
        return result;
      } catch (error) {
        events.push("ROLLBACK");
        throw error;
      }
    },
  };
  return { database, events, statements };
}

describe("explicit local-owner seed", () => {
  it("validates exact canonical operator input before access to any database", async () => {
    const bad: unknown[] = [
      { ...input, principalId: "_invalid" },
      { ...input, principalId: "owner_local" },
      { ...input, principalId: 123 },
      { ...input, organizationId: "organization_local_owner" },
      { ...input, organizationId: "x".repeat(129) },
      { ...input, membershipId: "member_local_owner" },
      { ...input, membershipId: input.principalId },
      { ...input, slug: "Uppercase" },
      { ...input, ownerDisplayName: " Local Owner " },
      { ...input, organizationDisplayName: "Personal\nOther" },
      { ...input, extra: "unexpected" },
    ];
    const profile = await loadSelfHostMigrationProfile();
    for (const value of bad) {
      expect(() => parseLocalOwnerSeedInput(value)).toThrow(
        LocalOwnerBootstrapError,
      );
      const fake = fixture(profile);
      await expect(
        seedLocalOwnerWorkspace(
          fake.database,
          profile,
          value as LocalOwnerSeedInput,
        ),
      ).rejects.toBeInstanceOf(LocalOwnerBootstrapError);
      expect(fake.events).toEqual([]);
    }
    const parsed = parseLocalOwnerSeedInput(input);
    expect(parsed).toEqual(input);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("checks installed exact source and admin posture under the migration lock before atomic inserts", async () => {
    const profile = await loadSelfHostMigrationProfile();
    const fake = fixture(profile);
    await expect(
      seedLocalOwnerWorkspace(fake.database, profile, input),
    ).resolves.toEqual({
      profileId: SELF_HOST_PROFILE_ID,
      sourceManifestSha256: profile.identity.manifestSha256,
      principalId: input.principalId,
      organizationId: input.organizationId,
      membershipId: input.membershipId,
    });
    expect(fake.events).toEqual(["BEGIN", "COMMIT"]);
    expect(fake.statements[0]?.text).toBe(
      "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
    );
    const lock = fake.statements.findIndex((entry) =>
      entry.text.includes("pg_advisory_xact_lock"),
    );
    const actor = fake.statements.findIndex((entry) =>
      entry.text.startsWith("SELECT session_user::text AS login"),
    );
    const admission = fake.statements.findIndex((entry) =>
      entry.text.startsWith("SELECT pg_catalog.current_database()"),
    );
    const tableLock = fake.statements.findIndex((entry) =>
      entry.text.startsWith("LOCK TABLE public.principals"),
    );
    const emptyRead = fake.statements.findIndex((entry) =>
      entry.text.includes("EXISTS(SELECT 1 FROM public.principals)"),
    );
    const firstWrite = fake.statements.findIndex((entry) =>
      entry.text.startsWith("INSERT INTO"),
    );
    expect(fake.statements[lock]?.values).toEqual([21_000_000]);
    expect(lock).toBeGreaterThan(0);
    expect(actor).toBeGreaterThan(lock);
    expect(admission).toBeGreaterThan(actor);
    expect(tableLock).toBeGreaterThan(admission);
    expect(fake.statements[tableLock]?.text).toContain(
      "public.principal_identity_references",
    );
    expect(fake.statements[tableLock]?.text).toContain("public.organizations");
    expect(fake.statements[tableLock]?.text).toContain(
      "public.organization_roles",
    );
    expect(fake.statements[tableLock]?.text).toContain("public.memberships");
    expect(fake.statements[tableLock]?.text).toContain(
      "SHARE ROW EXCLUSIVE MODE",
    );
    expect(emptyRead).toBeGreaterThan(tableLock);
    expect(firstWrite).toBeGreaterThan(emptyRead);
    const writes = fake.statements.filter((entry) =>
      entry.text.startsWith("INSERT INTO"),
    );
    expect(writes).toHaveLength(4);
    expect(writes[0]?.values).toEqual([
      input.principalId,
      input.ownerDisplayName,
    ]);
    expect(writes[1]?.values).toEqual([
      input.organizationId,
      input.organizationDisplayName,
      input.slug,
      input.principalId,
    ]);
    expect(writes[2]?.text).toContain(
      "cloudmarkup_authorization_v2_permissions",
    );
    expect(writes[3]?.values).toEqual([
      input.membershipId,
      input.organizationId,
      input.principalId,
    ]);
    expect(writes.map((entry) => entry.text).join("\n")).not.toContain(
      "principal_identity_references",
    );
    expect(writes.map((entry) => entry.text).join("\n")).not.toContain(
      "GRANT ",
    );
  });

  it("refuses stale profile, hosted identity, incomplete history, and any pre-existing tenant state", async () => {
    const profile = await loadSelfHostMigrationProfile();
    const stale = {
      ...profile,
      identity: { ...profile.identity, manifestSha256: "f".repeat(64) },
    } as SelfHostMigrationProfile;
    const outside = fixture(profile);
    await expect(
      seedLocalOwnerWorkspace(outside.database, stale, input),
    ).rejects.toBeInstanceOf(LocalOwnerBootstrapError);
    expect(outside.events).toEqual([]);
    const sparse: unknown[] = [];
    sparse.length = profile.migrations.length;
    for (const malformed of [
      null,
      { ...profile, identity: null },
      { ...profile, migrations: sparse },
      { ...profile, migrations: profile.migrations.slice(1) },
    ]) {
      const fake = fixture(profile);
      await expect(
        seedLocalOwnerWorkspace(
          fake.database,
          malformed as SelfHostMigrationProfile,
          input,
        ),
      ).rejects.toBeInstanceOf(LocalOwnerBootstrapError);
      expect(fake.events).toEqual([]);
    }
    for (const options of [
      { posture: { server_version: 160011 } },
      { installation: { profile_id: "hosted" } },
      { staleLedger: true },
      ...[
        "principals",
        "identity_references",
        "organizations",
        "organization_roles",
        "memberships",
      ].map((existing) => ({ existing })),
    ]) {
      const fake = fixture(profile, options);
      await expect(
        seedLocalOwnerWorkspace(fake.database, profile, input),
      ).rejects.toBeInstanceOf(LocalOwnerBootstrapError);
      expect(fake.events).toEqual(["BEGIN", "ROLLBACK"]);
      expect(
        fake.statements.some((entry) => entry.text.startsWith("INSERT INTO")),
      ).toBe(false);
    }
    for (const purpose of [
      "api",
      "proposal",
      "export",
      "cleanup",
      "billing",
    ] as const) {
      const login = `cloudmarkup_beta_${purpose}_runtime`;
      // H's ordinary readiness checker accepts these logins. The seed must
      // refuse them even when session and effective role agree.
      const fake = fixture(profile, {
        login,
        effectiveRole: login,
        posture: { login, effective_role: login },
      });
      await expect(
        seedLocalOwnerWorkspace(fake.database, profile, input),
      ).rejects.toBeInstanceOf(LocalOwnerBootstrapError);
      expect(fake.events).toEqual(["BEGIN", "ROLLBACK"]);
      expect(
        fake.statements.some((entry) => entry.text.startsWith("INSERT INTO")),
      ).toBe(false);
      expect(
        fake.statements.some((entry) =>
          entry.text.startsWith("SELECT pg_catalog.current_database()"),
        ),
      ).toBe(false);
    }
  });

  it("rolls back when any insertion is incomplete", async () => {
    const profile = await loadSelfHostMigrationProfile();
    for (const failedInsert of [
      "principal",
      "organization",
      "roles",
      "membership",
    ] as const) {
      const fake = fixture(profile, { failedInsert });
      await expect(
        seedLocalOwnerWorkspace(fake.database, profile, input),
      ).rejects.toBeInstanceOf(LocalOwnerBootstrapError);
      expect(fake.events).toEqual(["BEGIN", "ROLLBACK"]);
    }
  });
});
