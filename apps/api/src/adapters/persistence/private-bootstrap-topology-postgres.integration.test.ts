import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadMigrations,
  runMigrations,
  type LoadedMigration,
} from "./migrations.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql } from "./sql.js";

// These fixed database/role names require a separately owned disposable server.
// The ordinary shared PostgreSQL integration URL is deliberately not used.
const adminUrl = process.env["CLOUDMARKUP_TEST_PRIVATE_BOOTSTRAP_ADMIN_URL"];
const bootstrapUrl = process.env["CLOUDMARKUP_TEST_PRIVATE_BOOTSTRAP_ROOT_URL"];
const suite = adminUrl && bootstrapUrl ? describe : describe.skip;
const privateRoles = [
  "cloudmarkup_notes_native_lock_owner",
  "cloudmarkup_notes_publication_authority",
  "cloudmarkup_notes_shared_native_producer",
  "cloudmarkup_gpt6_private_receipt_issuer",
];
const helper =
  "cloudmarkup_notes_native_private.lock_current_authorization(text,text,text,boolean)";

suite(
  "private bootstrap on an owned PostgreSQL16 server",
  { concurrent: false },
  () => {
    let admin: PostgresDatabase;
    let bootstrap: PostgresDatabase;
    let migrations: readonly LoadedMigration[];
    let initialGuard: string;
    let finalGuard: string;
    const opened = new Set<PostgresDatabase>();

    beforeAll(async () => {
      for (const [value, username] of [
        [adminUrl, "cloudmarkup_admin"],
        [bootstrapUrl, "rdsadmin"],
      ]) {
        const url = new URL(value ?? "");
        if (
          url.protocol !== "postgresql:" ||
          url.hostname !== "127.0.0.1" ||
          url.username !== username ||
          url.password !== "" ||
          url.pathname !== "/cloudmarkup" ||
          url.search !== "" ||
          url.hash !== ""
        )
          throw Error("Explicit owned loopback bootstrap fixture required");
      }
      admin = new PostgresDatabase({ connectionString: adminUrl, max: 1 });
      opened.add(admin);
      bootstrap = new PostgresDatabase({
        connectionString: bootstrapUrl,
        max: 1,
      });
      opened.add(bootstrap);
      migrations = await loadMigrations(
        fileURLToPath(new URL("../../../migrations/", import.meta.url)),
      );
      const migration = migrations.find(({ version }) => version === "0127");
      const start = migration?.statements.find((statement) =>
        statement.includes("DO $cm_private_bootstrap_owner_edge$"),
      );
      const end = migration?.statements.find((statement) =>
        statement.includes("DO $cm_private_bootstrap_final$"),
      );
      if (!start || !end)
        throw Error("Exact private bootstrap assertions missing");
      initialGuard = start;
      finalGuard = end;
      const prefix = {
        storageContractVersion: 1,
        migrations: migrations
          .slice(0, 108)
          .map(({ version, file, checksumSha256 }) => ({
            version,
            file,
            checksumSha256,
          })),
      };
      expect(
        createHash("sha256")
          .update(JSON.stringify(prefix, null, 2) + "\n")
          .digest("hex"),
      ).toBe(
        "02fb2157a5db9e59fa0aed95314e7ef1d4a42779866ed9f0288752f60357b83d",
      );
      await runMigrations(admin, migrations.slice(0, 108));
    }, 120_000);

    afterAll(async () => {
      for (const connection of opened) await connection.close();
      opened.clear();
    });

    const graphCount = async () => {
      const result = await admin.query(
        sql(
          "SELECT count(*)::integer AS count FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname=ANY(string_to_array($1,',')))",
          [privateRoles.join(",")],
        ),
      );
      return result.rows[0]?.["count"];
    };

    const finalTrial = async (changes: readonly string[], expected: RegExp) => {
      await expect(
        bootstrap.transaction(async (tx) => {
          for (const change of changes) await tx.query(sql(change));
          await tx.query(sql("SET LOCAL ROLE cloudmarkup_admin"));
          await tx.query(sql(finalGuard));
          throw Error("Successful fixture check rolled back");
        }),
      ).rejects.toThrow(expected);
      expect(await graphCount()).toBe(4);
    };

    it("rolls back the complete 0127 transaction when owner transfer is denied", async () => {
      const migration = migrations.find(({ version }) => version === "0127");
      if (!migration) throw Error("Migration 0127 missing");
      let deniedTransferReached = false;
      await expect(
        admin.transaction(async (tx) => {
          for (const statement of migration.statements) {
            if (
              statement.includes("ALTER FUNCTION") &&
              statement.includes("OWNER TO")
            ) {
              await tx.query(
                sql(
                  "REVOKE CREATE ON SCHEMA cloudmarkup_notes_native_private FROM cloudmarkup_notes_native_lock_owner",
                ),
              );
              deniedTransferReached = true;
            }
            await tx.query(sql(statement));
          }
        }),
      ).rejects.toThrow(/permission denied/u);
      expect(deniedTransferReached).toBe(true);
      const ledger = await admin.query(
        sql(
          "SELECT count(*)::integer AS count,max(version) AS version FROM cloudmarkup_schema_migrations",
        ),
      );
      expect(ledger.rows).toEqual([{ count: 108, version: "0126" }]);
      const retained = await admin.query(
        sql(
          "SELECT (SELECT count(*)::integer FROM pg_roles WHERE rolname=ANY(string_to_array($1,','))) AS roles,(SELECT count(*)::integer FROM pg_namespace WHERE nspname='cloudmarkup_notes_native_private') AS schemas",
          [privateRoles.join(",")],
        ),
      );
      expect(retained.rows).toEqual([{ roles: 0, schemas: 0 }]);
    });

    it("upgrades 108 to all 120 migrations and verifies every helper owner and ACL", async () => {
      await runMigrations(admin, migrations);
      await runMigrations(admin, migrations);
      const ledger = await admin.query(
        sql(
          "SELECT version,checksum_sha256 FROM cloudmarkup_schema_migrations ORDER BY version",
        ),
      );
      expect(ledger.rows).toHaveLength(120);
      expect(
        ledger.rows.map((row) => String(row["checksum_sha256"]).trim()),
      ).toEqual(migrations.map(({ checksumSha256 }) => checksumSha256));
      expect(await graphCount()).toBe(4);
      await admin.query(sql(finalGuard));
    }, 120_000);

    it("admits the exact zero initial graph while stock PostgreSQL still denies its self-grant", async () => {
      let acceptedZero = false;
      await expect(
        bootstrap.transaction(async (tx) => {
          await tx.query(
            sql("CREATE ROLE cm_bootstrap_zero NOLOGIN NOINHERIT"),
          );
          await tx.query(sql("SET LOCAL ROLE cloudmarkup_admin"));
          await tx.query(
            sql(
              initialGuard.replaceAll(
                privateRoles[0] ?? "",
                "cm_bootstrap_zero",
              ),
            ),
          );
          acceptedZero = true;
          await tx.query(
            sql(
              "GRANT cm_bootstrap_zero TO cloudmarkup_admin WITH ADMIN FALSE GRANTED BY cloudmarkup_admin",
            ),
          );
        }),
      ).rejects.toThrow(/permission denied to grant role/u);
      expect(acceptedZero).toBe(true);
      const retained = await admin.query(
        sql(
          "SELECT count(*)::integer AS count FROM pg_roles WHERE rolname='cm_bootstrap_zero'",
        ),
      );
      expect(retained.rows).toEqual([{ count: 0 }]);
    });

    it("rejects an unexpected initial member and grantor", async () => {
      await expect(
        bootstrap.transaction(async (tx) => {
          await tx.query(
            sql("CREATE ROLE cm_bootstrap_wrong NOLOGIN NOINHERIT"),
          );
          await tx.query(
            sql("CREATE ROLE cm_bootstrap_other NOLOGIN NOINHERIT"),
          );
          await tx.query(
            sql(
              "GRANT cm_bootstrap_wrong TO cm_bootstrap_other WITH ADMIN FALSE",
            ),
          );
          await tx.query(sql("SET LOCAL ROLE cloudmarkup_admin"));
          await tx.query(
            sql(
              initialGuard.replaceAll(
                privateRoles[0] ?? "",
                "cm_bootstrap_wrong",
              ),
            ),
          );
        }),
      ).rejects.toThrow(
        /Exact or zero private helper bootstrap edge required/u,
      );
    });

    it("accepts the zero final graph with all twelve fixed helper contracts intact", async () => {
      await finalTrial(
        privateRoles.map(
          (role) =>
            `REVOKE ${role} FROM cloudmarkup_admin GRANTED BY rdsadmin RESTRICT`,
        ),
        /Successful fixture check rolled back/u,
      );
    });

    it("rejects mixed creator topologies", async () => {
      await finalTrial(
        [
          "REVOKE cloudmarkup_notes_publication_authority FROM cloudmarkup_admin GRANTED BY rdsadmin RESTRICT",
        ],
        /Exact final private bootstrap graph required/u,
      );
    });

    it("rejects a misflagged creator membership", async () => {
      await finalTrial(
        [
          "GRANT cloudmarkup_notes_native_lock_owner TO cloudmarkup_admin WITH INHERIT TRUE GRANTED BY rdsadmin",
        ],
        /Exact final private bootstrap graph required/u,
      );
    });

    it("rejects retained schema CREATE privilege", async () => {
      await finalTrial(
        [
          "GRANT CREATE ON SCHEMA cloudmarkup_notes_native_private TO cloudmarkup_notes_native_lock_owner",
        ],
        /Private helper schema CREATE must be absent/u,
      );
    });

    it("rejects helper ownership drift", async () => {
      await finalTrial(
        [`ALTER FUNCTION ${helper} OWNER TO cloudmarkup_admin`],
        /Exact private fixed helper ownership required/u,
      );
    });

    it("rejects PUBLIC helper execution", async () => {
      await finalTrial(
        [`GRANT EXECUTE ON FUNCTION ${helper} TO PUBLIC`],
        /Exact private helper EXECUTE ACL required/u,
      );
    });
  },
);
