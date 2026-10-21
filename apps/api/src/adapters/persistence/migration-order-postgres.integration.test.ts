import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepositoryError } from "../../application/persistence.js";
import {
  loadMigrations,
  runMigrations,
  type LoadedMigration,
} from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql, type SqlDatabase, type SqlRow } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

suite("forward migration admission on genuine isolated PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let peer: PostgresDatabase;
  const opened = new Set<PostgresDatabase>();
  let schema: string;
  let marker: string;
  let created = false;

  beforeEach(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
    )
      throw Error("An explicit loopback PostgreSQL fixture is required");
    const nonce = randomUUID().replaceAll("-", "");
    schema = "cm_migration_order_it_" + nonce;
    marker = "CloudMarkup synthetic migration order " + nonce;
    created = false;
    admin = new PostgresDatabase({
      connectionString: configured,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql('CREATE SCHEMA "' + schema + '"'));
      await tx.query(
        sql('COMMENT ON SCHEMA "' + schema + '" IS ' + "'" + marker + "'"),
      );
    });
    created = true;
    const settings = {
      connectionString: configured,
      max: 1,
      connectionTimeoutMillis: 5000,
      options: "-c search_path=" + schema + " -c statement_timeout=10000",
    };
    database = new PostgresDatabase(settings);
    opened.add(database);
    peer = new PostgresDatabase(settings);
    opened.add(peer);
  });

  afterEach(async () => {
    try {
      for (const connection of opened) await connection.close();
      opened.clear();
      if (created && admin !== undefined) {
        const proof = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          ),
        );
        if (
          !/^cm_migration_order_it_[a-f0-9]{32}$/u.test(schema) ||
          proof.rows[0]?.["marker"] !== marker
        )
          throw Error("Unsafe migration test schema cleanup");
        await admin.query(sql('DROP SCHEMA "' + schema + '" CASCADE'));
      }
    } finally {
      await admin?.close();
    }
  }, 30000);

  const toy = (): readonly LoadedMigration[] =>
    ["0093", "0094", "0095"].map((version) => {
      const statement = `CREATE TABLE order_${version} (id integer PRIMARY KEY)`;
      return {
        version,
        file: `${version}_order_test.sql`,
        checksumSha256: digest(statement),
        statements: [statement],
      };
    });

  it("upgrades the admitted 75-file predecessor through exact 0094-0098 and additive 0138 with concurrent replay", async () => {
    const all = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    expect(all).toHaveLength(81);
    const original = all.filter((migration) => migration.version <= "0093");
    expect(original).toHaveLength(75);
    await runMigrations(database, original);
    await Promise.all([runMigrations(database, all), runMigrations(peer, all)]);
    const ledger = await database.query(
      sql(
        "SELECT version,checksum_sha256 FROM cloudmarkup_schema_migrations ORDER BY version",
      ),
    );
    expect(ledger.rows).toEqual(
      all.map((migration) => ({
        version: migration.version,
        checksum_sha256: migration.checksumSha256,
      })),
    );
    const dormant = await database.query(
      sql(
        "SELECT to_regclass('hosted_terraform_validation_submissions')::text AS hosted, to_regclass('bitbucket_oauth_connections')::text AS bitbucket, admission_required FROM project_cleanup_controls WHERE control_id='beta'",
      ),
    );
    expect(dormant.rows[0]).toEqual({
      hosted: "hosted_terraform_validation_submissions",
      bitbucket: "bitbucket_oauth_connections",
      admission_required: false,
    });
    await expect(runMigrations(database, original)).rejects.toBeInstanceOf(
      RepositoryError,
    );
  }, 60000);

  it("preserves committed photo and trial migrations after a later failure and rejects a 0096 rollback runner", async () => {
    const all = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    expect(all).toHaveLength(81);
    await runMigrations(database, all);
    const ledgerQuery = sql(
      "SELECT version,checksum_sha256 FROM cloudmarkup_schema_migrations ORDER BY version",
    );
    const committed = await database.query(ledgerQuery);
    expect(committed.rows.slice(-2)).toEqual(
      all.slice(-2).map(({ version, checksumSha256 }) => ({
        version,
        checksum_sha256: checksumSha256,
      })),
    );
    await expect(
      runMigrations(
        database,
        all.filter(({ version }) => version <= "0096"),
      ),
    ).rejects.toBeInstanceOf(RepositoryError);
    const failedSuccessor: LoadedMigration = {
      version: "0139",
      file: "0139_synthetic_later_failure.sql",
      checksumSha256: digest("synthetic later failure"),
      statements: [
        "CREATE TABLE synthetic_later_failure (id integer PRIMARY KEY)",
        "SELECT missing_column FROM synthetic_later_failure",
      ],
    };
    await expect(
      runMigrations(database, [...all, failedSuccessor]),
    ).rejects.toThrow();
    expect((await database.query(ledgerQuery)).rows).toEqual(committed.rows);
    const retained = await database.query(
      sql(
        "SELECT to_regclass('principal_account_photos')::text AS photos, to_regclass('principal_account_photo_events')::text AS photo_events, to_regclass('platform_staff_trials')::text AS trials, to_regclass('synthetic_later_failure')::text AS failed_stage, EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='principal_account_photo_events_immutable' AND NOT tgisinternal) AS photo_audit_guard, to_regprocedure('cloudmarkup_staff_trial_current_v1(character varying,character varying)') IS NOT NULL AS trial_guard",
      ),
    );
    expect(retained.rows[0]).toEqual({
      photos: "principal_account_photos",
      photo_events: "principal_account_photo_events",
      trials: "platform_staff_trials",
      failed_stage: null,
      photo_audit_guard: true,
      trial_guard: true,
    });
    await runMigrations(database, all);
    expect((await database.query(ledgerQuery)).rows).toEqual(committed.rows);
  }, 30000);

  it("refuses a missing older ledger entry before running its SQL", async () => {
    const migrations = toy();
    await runMigrations(database, migrations);
    await database.query(
      sql("DELETE FROM cloudmarkup_schema_migrations WHERE version='0094'"),
    );
    await expect(runMigrations(database, migrations)).rejects.toBeInstanceOf(
      RepositoryError,
    );
    const rows = await database.query(
      sql("SELECT version FROM cloudmarkup_schema_migrations ORDER BY version"),
    );
    expect(rows.rows).toEqual([{ version: "0093" }, { version: "0095" }]);
  });

  it("detects an applied successor committed after the first ledger snapshot", async () => {
    const migrations = toy();
    const first = migrations[0],
      successor = migrations[2];
    if (!first || !successor) throw Error("Missing synthetic migrations");
    await runMigrations(database, [first]);
    let release: (() => void) | undefined;
    let observed: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshot = new Promise<void>((resolve) => {
      observed = resolve;
    });
    let held = false;
    const guarded: SqlDatabase = {
      close: () => Promise.resolve(),
      transaction: (work) => database.transaction(work),
      query: async <T extends SqlRow>(
        statement: Parameters<SqlDatabase["query"]>[0],
      ) => {
        const result = await database.query<T>(statement);
        if (
          !held &&
          statement.text ===
            "SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations"
        ) {
          held = true;
          observed?.();
          await hold;
        }
        return result;
      },
    };
    const upgrading = runMigrations(guarded, migrations);
    const rejected = expect(upgrading).rejects.toBeInstanceOf(RepositoryError);
    let snapshotTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        snapshot,
        new Promise<never>((_, reject) => {
          snapshotTimeout = setTimeout(() => {
            reject(Error("The ledger snapshot was not observed"));
          }, 10000);
        }),
      ]);
      await peer.transaction(async (tx) => {
        await tx.query(sql("SELECT pg_advisory_xact_lock(21000000)"));
        for (const text of successor.statements) await tx.query(sql(text));
        await tx.query(
          sql(
            "INSERT INTO cloudmarkup_schema_migrations(version,checksum_sha256) VALUES($1,$2)",
            [successor.version, successor.checksumSha256],
          ),
        );
      });
    } finally {
      if (snapshotTimeout !== undefined) clearTimeout(snapshotTimeout);
      release?.();
    }
    await rejected;
    const tables = await database.query(
      sql(
        "SELECT to_regclass('order_0094')::text AS older, to_regclass('order_0095')::text AS successor",
      ),
    );
    expect(tables.rows[0]).toEqual({ older: null, successor: "order_0095" });
  }, 30000);

  it("rolls a failed forward migration back and permits a complete retry", async () => {
    const migrations = toy();
    await runMigrations(database, migrations);
    const forward: LoadedMigration = {
      version: "0096",
      file: "0096_rollback_test.sql",
      checksumSha256: digest("rollback"),
      statements: [
        "CREATE TABLE rollback_order (id integer PRIMARY KEY)",
        "SELECT missing_rollback_column FROM rollback_order",
      ],
    };
    await expect(
      runMigrations(database, [...migrations, forward]),
    ).rejects.toThrow();
    const state = await database.query(
      sql(
        "SELECT to_regclass('rollback_order')::text AS table_name, EXISTS(SELECT 1 FROM cloudmarkup_schema_migrations WHERE version='0096') AS recorded",
      ),
    );
    expect(state.rows[0]).toEqual({ table_name: null, recorded: false });
    await runMigrations(database, [
      ...migrations,
      { ...forward, statements: forward.statements.slice(0, 1) },
    ]);
    await runMigrations(database, [
      ...migrations,
      { ...forward, statements: forward.statements.slice(0, 1) },
    ]);
    const replay = await database.query(
      sql("SELECT version FROM cloudmarkup_schema_migrations ORDER BY version"),
    );
    expect(replay.rows.at(-1)?.["version"]).toBe("0096");
  });

  it("admits the provider-direct policy only with both roles and otherwise denies rows", async () => {
    const registered = await loadMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    const policyStatements = registered
      .find((entry) => entry.version === "0137")
      ?.statements.filter((statement) =>
        statement.includes("DO $provider_direct_policy$"),
      );
    expect(policyStatements).toHaveLength(1);
    const policy = policyStatements?.[0];
    if (!policy) throw Error("The registered 0137 policy guard is required");

    const probe = `"${schema}"."provider_direct_policy_probe"`;
    const absentProposal = "cm_policy_missing_proposal";
    const absentExport = "cm_policy_missing_export";
    const roles = await database.query(
      sql(
        "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('pg_read_all_data','pg_monitor')",
      ),
    );
    expect(roles.rows).toHaveLength(2);
    expect(
      roles.rows.every((role) => !role["rolsuper"] && !role["rolbypassrls"]),
    ).toBe(true);
    for (const name of [absentProposal, absentExport]) {
      const candidate = await database.query(
        sql("SELECT to_regrole($1)::text AS role_name", [name]),
      );
      expect(candidate.rows[0]?.["role_name"]).toBe(null);
    }

    await database.query(
      sql(`CREATE TABLE ${probe} (organization_id text, principal_id text)`),
    );
    await database.query(
      sql(
        `INSERT INTO ${probe} (organization_id,principal_id) VALUES ('org-allowed','principal'),('org-other','principal')`,
      ),
    );
    await database.query(sql(`ALTER TABLE ${probe} ENABLE ROW LEVEL SECURITY`));
    await database.query(sql(`ALTER TABLE ${probe} FORCE ROW LEVEL SECURITY`));

    const visibleAsReader = (organizationId: string) =>
      database.transaction(async (transaction) => {
        await transaction.query(
          sql("SELECT set_config('cloudmarkup.organization_id',$1,true)", [
            organizationId,
          ]),
        );
        await transaction.query(sql("SET LOCAL ROLE pg_read_all_data"));
        const result = await transaction.query(
          sql(`SELECT count(*)::integer AS visible FROM ${probe}`),
        );
        return result.rows[0]?.["visible"];
      });

    for (const scenario of [
      { proposal: absentProposal, export: absentExport, expected: 0 },
      { proposal: "pg_read_all_data", export: absentExport, expected: 0 },
      { proposal: absentProposal, export: "pg_monitor", expected: 0 },
      { proposal: "pg_read_all_data", export: "pg_monitor", expected: 1 },
    ]) {
      const statement = policy
        .replaceAll("public.provider_direct_invocations_v1", probe)
        .replaceAll("cloudmarkup_beta_proposal_runtime", scenario.proposal)
        .replaceAll("cloudmarkup_beta_export_runtime", scenario.export);
      await database.query(sql(statement));
      const policies = await database.query(
        sql(
          "SELECT policyname, cardinality(roles)::integer AS role_count, 'pg_read_all_data'::name=ANY(roles) AS reader_role, 'pg_monitor'::name=ANY(roles) AS monitor_role FROM pg_policies WHERE schemaname=$1 AND tablename='provider_direct_policy_probe'",
          [schema],
        ),
      );
      expect(policies.rows).toHaveLength(scenario.expected);
      if (scenario.expected === 1) {
        expect(policies.rows[0]?.["policyname"]).toBe(
          "provider_direct_scope_v1",
        );
        expect(policies.rows[0]?.["role_count"]).toBe(2);
        expect(policies.rows[0]?.["reader_role"]).toBe(true);
        expect(policies.rows[0]?.["monitor_role"]).toBe(true);
      }
      expect(await visibleAsReader("org-allowed")).toBe(scenario.expected);
      expect(await visibleAsReader("org-unknown")).toBe(0);
    }
  }, 30000);
});
