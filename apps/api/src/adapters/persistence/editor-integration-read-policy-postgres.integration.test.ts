import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  ORGANIZATION_ROLES,
  permissionsForRole,
  requireOrganizationPermission,
} from "../../application/authorization.js";
import type { PrincipalContext } from "../../application/ports.js";
import { AuthorizedCommercialRequestDatabase } from "../../production-commercial-authorization.js";
import { runMigrations, type LoadedMigration } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const canonicalCheckName =
  "organization_roles_authorization_v2_canonical_check";
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
const clock = () => new Date("2026-09-05T09:00:00.000Z");

function loopbackUrl(): string {
  if (configuredUrl === undefined || configuredUrl === "")
    throw new Error("Explicit loopback PostgreSQL URL required.");
  const parsed = new URL(configuredUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Editor policy tests require an explicit loopback database without overrides.",
    );
  return configuredUrl;
}

function deferred() {
  let resolve: () => void = () => {
    throw new Error("Uninitialized test signal.");
  };
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve: () => {
      resolve();
    },
  };
}

async function removeSyntheticSchema(
  administration: SqlDatabase,
  schemaName: string,
  marker: string,
) {
  const found = await administration.query(
    sql(
      "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
      [schemaName],
    ),
  );
  if (
    found.rows[0]?.["marker"] !== marker ||
    !/^cm_editor_policy_it_[a-f0-9]{32}$/u.test(schemaName)
  )
    throw new Error("Refusing to remove an unverified synthetic schema.");
  await administration.transaction((tx) =>
    tx.query(sql('DROP SCHEMA "' + schemaName + '" CASCADE')),
  );
}

integrationDescribe(
  "editor policy upgrade on isolated loopback PostgreSQL",
  () => {
    let migrations: readonly LoadedMigration[];
    beforeAll(async () => {
      migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      );
    });
    async function isolated(
      work: (database: PostgresDatabase) => Promise<void>,
    ) {
      const schemaName =
        "cm_editor_policy_it_" + randomUUID().replaceAll("-", "");
      const marker = "CloudMarkup synthetic editor policy " + schemaName;
      const connectionString = loopbackUrl();
      const administration = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      let opened: PostgresDatabase | undefined;
      let created = false;
      try {
        if (!/^cm_editor_policy_it_[a-f0-9]{32}$/u.test(schemaName))
          throw new Error("Unsafe synthetic schema.");
        await administration.transaction(async (tx) => {
          await tx.query(sql('CREATE SCHEMA "' + schemaName + '"'));
          await tx.query(
            sql('COMMENT ON SCHEMA "' + schemaName + "\" IS '" + marker + "'"),
          );
        });
        created = true;
        opened = new PostgresDatabase({
          connectionString,
          max: 4,
          connectionTimeoutMillis: 5000,
          options:
            "-c search_path=" +
            schemaName +
            " -c timezone=UTC -c statement_timeout=5000",
        });
        await runMigrations(
          opened,
          migrations.filter(({ version }) => version <= "0022"),
        );
        await work(opened);
      } finally {
        try {
          await opened?.close();
          if (created)
            await removeSyntheticSchema(administration, schemaName, marker);
        } finally {
          await administration.close();
        }
      }
    }

    async function fixture(database: SqlDatabase) {
      const organizations = [id("org"), id("org")];
      let editor: PrincipalContext | undefined;
      await database.transaction(async (tx) => {
        for (const organizationId of organizations) {
          await tx.query(
            sql(
              "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic editor policy',$2)",
              [organizationId, organizationId.replaceAll("_", "-")],
            ),
          );
          for (const role of [...ORGANIZATION_ROLES, "legacy-reviewer"]) {
            const principalId = id("principal");
            await tx.query(
              sql(
                "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic editor policy')",
                [principalId],
              ),
            );
            await tx.query(
              sql(
                "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities,created_at,updated_at) " +
                  "VALUES ($1,$2::text,CASE WHEN $2::text='legacy-reviewer' THEN 'legacy-v1' ELSE 'authorization-v2' END,$2::text='owner'," +
                  "CASE WHEN $2::text='legacy-reviewer' THEN ARRAY['legacy.read']::text[] ELSE cloudmarkup_authorization_v2_permissions($2::text) END," +
                  "'2000-01-01T00:00:00Z'::timestamptz,'2000-01-01T00:00:00Z'::timestamptz)",
                [organizationId, role],
              ),
            );
            await tx.query(
              sql(
                "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,$4)",
                [id("membership"), organizationId, principalId, role],
              ),
            );
            if (role === "editor" && organizationId === organizations[0])
              editor = {
                principalId,
                sessionId: id("session"),
                correlationId: id("correlation"),
                authenticationSource: "test",
                authenticatedAt: "2026-09-05T08:55:00.000Z",
                expiresAt: "2026-09-05T10:00:00.000Z",
              };
          }
        }
      });
      if (
        editor === undefined ||
        organizations[0] === undefined ||
        organizations[1] === undefined
      )
        throw new Error("Missing synthetic editor fixture.");
      return {
        editor,
        organizationId: organizations[0],
        otherOrganizationId: organizations[1],
      };
    }

    async function snapshot(database: SqlExecutor) {
      const roles = await database.query(
        sql(
          "SELECT organization_id,role_key,row_to_json(r)::text AS snapshot FROM organization_roles r ORDER BY organization_id,role_key",
        ),
      );
      const principals = await database.query(
        sql(
          "SELECT row_to_json(p)::text AS snapshot FROM principals p ORDER BY principal_id",
        ),
      );
      const memberships = await database.query(
        sql(
          "SELECT row_to_json(m)::text AS snapshot FROM memberships m ORDER BY membership_id",
        ),
      );
      const organizations = await database.query(
        sql(
          "SELECT row_to_json(o)::text AS snapshot FROM organizations o ORDER BY organization_id",
        ),
      );
      const constraint = await database.query(
        sql(
          "SELECT convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='organization_roles'::regclass AND conname=$1",
          [canonicalCheckName],
        ),
      );
      const editorPermissions = await database.query(
        sql(
          "SELECT to_json(cloudmarkup_authorization_v2_permissions('editor'))::text AS permissions",
        ),
      );
      const ledger = await database.query(
        sql(
          "SELECT version,checksum_sha256 FROM cloudmarkup_schema_migrations ORDER BY version",
        ),
      );
      return {
        roles: roles.rows,
        principals: principals.rows,
        memberships: memberships.rows,
        organizations: organizations.rows,
        constraint: constraint.rows,
        editorPermissions: editorPermissions.rows,
        ledger: ledger.rows,
      };
    }

    it("upgrades every preexisting canonical role, preserves non-editor metadata and memberships, and replays once", async () => {
      await isolated(async (database) => {
        await fixture(database);
        const before = await snapshot(database);
        await runMigrations(database, migrations);
        const after = await snapshot(database);
        const decoded = (
          rows: readonly SqlRow[],
          defaults: Record<string, unknown> = {},
        ) =>
          rows.map((row) => ({
            ...(JSON.parse(String(row["snapshot"])) as Record<string, unknown>),
            ...defaults,
          }));
        expect(decoded(after.principals)).toEqual(
          decoded(before.principals, {
            public_username: null,
            profile_record_version: 1,
          }),
        );
        expect(decoded(after.memberships)).toEqual(
          decoded(before.memberships, {
            ended_at: null,
            end_reason: null,
          }),
        );
        expect(decoded(after.organizations)).toEqual(
          decoded(before.organizations, {
            workspace_kind: "organization",
            personal_owner_principal_id: null,
          }),
        );
        for (const [index, row] of after.roles.entries()) {
          const prior = before.roles[index];
          if (row["role_key"] !== "editor") expect(row).toEqual(prior);
          else {
            const currentData = JSON.parse(String(row["snapshot"])) as Record<
              string,
              unknown
            >;
            const priorData = JSON.parse(String(prior?.["snapshot"])) as Record<
              string,
              unknown
            >;
            expect(currentData["capabilities"]).toEqual(
              permissionsForRole("editor"),
            );
            expect(currentData["updated_at"]).not.toBe(priorData["updated_at"]);
            expect({
              ...currentData,
              capabilities: priorData["capabilities"],
              updated_at: priorData["updated_at"],
            }).toEqual(priorData);
          }
        }
        for (const role of ORGANIZATION_ROLES) {
          const found = await database.query(
            sql(
              "SELECT to_json(cloudmarkup_authorization_v2_permissions($1::text))::text AS permissions",
              [role],
            ),
          );
          const actual: unknown = JSON.parse(
            String(found.rows[0]?.["permissions"]),
          );
          expect(Array.isArray(actual)).toBe(true);
          if (!Array.isArray(actual))
            throw new Error("Missing SQL role permissions.");
          const strings = actual.filter(
            (value: unknown): value is string => typeof value === "string",
          );
          expect(strings).toHaveLength(actual.length);
          expect([...strings].sort()).toEqual(
            [...permissionsForRole(role)].sort(),
          );
        }
        expect(after.constraint).toEqual([
          {
            convalidated: true,
            definition: before.constraint[0]?.["definition"],
          },
        ]);
        expect(after.ledger.filter((row) => row["version"] === "0023")).toEqual(
          [
            {
              version: "0023",
              checksum_sha256: migrations.find(
                (migration) => migration.version === "0023",
              )?.checksumSha256,
            },
          ],
        );
        const unknown = await database.query(
          sql(
            "SELECT cloudmarkup_authorization_v2_permissions('legacy-reviewer') IS NULL AS unknown_role,cloudmarkup_authorization_v2_permissions(NULL::text) IS NULL AS null_role",
          ),
        );
        expect(unknown.rows).toEqual([{ unknown_role: true, null_role: true }]);
        await runMigrations(database, migrations);
        expect(await snapshot(database)).toEqual(after);
      });
    }, 30000);

    it("restores editor reads without granting management, crossing tenants, or accepting changed permissions", async () => {
      await isolated(async (database) => {
        const f = await fixture(database);
        const request = (
          principal = f.editor,
          organizationId = f.organizationId,
        ) =>
          new AuthorizedCommercialRequestDatabase(
            database,
            principal,
            organizationId,
            "commercial.summary.read",
            clock,
          );
        await expect(request().context()).rejects.toMatchObject({
          code: "service_unavailable",
        });
        await runMigrations(database, migrations);
        const context = await request().context();
        expect(context.role).toBe("editor");
        expect(() => {
          requireOrganizationPermission(context.role, "integrations.read");
        }).not.toThrow();
        for (const permission of [
          "integrations.manage",
          "billing.manage",
          "memberships.read",
          "memberships.manage",
          "memberships.assign-owner",
          "projects.delete",
          "organizations.delete",
          "audit.read",
        ] as const)
          expect(() => {
            requireOrganizationPermission(context.role, permission);
          }).toThrow();
        await expect(
          new AuthorizedCommercialRequestDatabase(
            database,
            f.editor,
            f.organizationId,
            "billing.manage",
            clock,
          ).context(),
        ).rejects.toMatchObject({ code: "access_denied" });
        await expect(
          request(f.editor, f.otherOrganizationId).context(),
        ).rejects.toMatchObject({ code: "not_found" });
        await expect(
          request({ ...f.editor, expiresAt: clock().toISOString() }).context(),
        ).rejects.toMatchObject({ code: "authentication_required" });
        for (const expression of [
          "array_append(capabilities,'integrations.manage')",
          "array_append(capabilities,'billing.manage')",
          "array_remove(capabilities,'integrations.read')",
        ]) {
          await expect(
            database.query(
              sql(
                "UPDATE organization_roles SET capabilities=" +
                  expression +
                  " WHERE organization_id=$1 AND role_key='editor'",
                [f.organizationId],
              ),
            ),
          ).rejects.toMatchObject({ code: "23514" });
        }
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
            [f.organizationId, f.editor.principalId],
          ),
        );
        await expect(request().context()).rejects.toMatchObject({
          code: "not_found",
        });
      });
    }, 30000);

    it.each([
      ["editor", "capabilities=array_append(capabilities,'billing.manage')"],
      ["editor", "policy_version='authorization-v1'"],
      ["editor", "is_owner=TRUE"],
      ["viewer", "capabilities=array_append(capabilities,'integrations.read')"],
    ])(
      "refuses unexpected stored %s metadata (%s) without normalization",
      async (role, assignment) => {
        await isolated(async (database) => {
          await fixture(database);
          await database.transaction(async (tx) => {
            await tx.query(
              sql(
                "ALTER TABLE organization_roles DROP CONSTRAINT " +
                  canonicalCheckName,
              ),
            );
            await tx.query(
              sql(
                "UPDATE organization_roles SET " +
                  assignment +
                  " WHERE role_key=$1",
                [role],
              ),
            );
            await tx.query(
              sql(
                "ALTER TABLE organization_roles ADD CONSTRAINT " +
                  canonicalCheckName +
                  " CHECK (TRUE)",
              ),
            );
          });
          const before = await snapshot(database);
          await expect(
            runMigrations(database, migrations),
          ).rejects.toMatchObject({ code: "55000" });
          expect(await snapshot(database)).toEqual(before);
        });
      },
      30000,
    );

    it("refuses an unexpectedly changed mirror function without overwriting it", async () => {
      await isolated(async (database) => {
        await fixture(database);
        const priorFunction = migrations
          .find(({ version }) => version === "0007")
          ?.statements.find((statement) =>
            statement.includes(
              "CREATE FUNCTION cloudmarkup_authorization_v2_permissions",
            ),
          );
        if (priorFunction === undefined)
          throw new Error("Missing prior SQL policy.");
        await database.query(
          sql(
            priorFunction
              .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
              .replace(
                "'exports.run', 'commercial.expensive.use'",
                "'exports.run', 'integrations.manage', 'commercial.expensive.use'",
              ),
          ),
        );
        const before = await snapshot(database);
        await expect(runMigrations(database, migrations)).rejects.toMatchObject(
          { code: "55000" },
        );
        expect(await snapshot(database)).toEqual(before);
      });
    }, 30000);

    it("refuses a missing or unvalidated canonical constraint", async () => {
      await isolated(async (database) => {
        await fixture(database);
        await database.query(
          sql(
            "ALTER TABLE organization_roles DROP CONSTRAINT " +
              canonicalCheckName,
          ),
        );
        const before = await snapshot(database);
        await expect(runMigrations(database, migrations)).rejects.toMatchObject(
          { code: "55000" },
        );
        expect(await snapshot(database)).toEqual(before);
        await database.query(
          sql(
            "ALTER TABLE organization_roles ADD CONSTRAINT " +
              canonicalCheckName +
              " CHECK (TRUE) NOT VALID",
          ),
        );
        const unvalidated = await snapshot(database);
        await expect(runMigrations(database, migrations)).rejects.toMatchObject(
          { code: "55000" },
        );
        expect(await snapshot(database)).toEqual(unvalidated);
      });
    }, 30000);

    it("rolls back function, role metadata, constraint and ledger together after an injected failure and then recovers", async () => {
      await isolated(async (database) => {
        await fixture(database);
        const before = await snapshot(database);
        const injected = new Error("Synthetic failure after editor update.");
        const failing: SqlDatabase = {
          close: () => Promise.resolve(),
          query: (statement) => database.query(statement),
          transaction: (work) =>
            database.transaction((tx) =>
              work({
                query: async <TRow extends SqlRow = SqlRow>(
                  statement: SqlStatement,
                ) => {
                  const result = await tx.query<TRow>(statement);
                  if (
                    statement.text.startsWith(
                      "UPDATE organization_roles\nSET capabilities",
                    )
                  )
                    throw injected;
                  return result;
                },
              }),
            ),
        };
        await expect(runMigrations(failing, migrations)).rejects.toBe(injected);
        expect(await snapshot(database)).toEqual(before);
        await runMigrations(database, migrations);
        expect((await snapshot(database)).ledger.at(-1)?.["version"]).toBe(
          "0138",
        );
      });
    }, 30000);

    it("cannot replace policy while another transaction holds a role read lock, and safely retries after timeout", async () => {
      await isolated(async (database) => {
        await fixture(database);
        const before = await snapshot(database);
        const acquired = deferred();
        const release = deferred();
        const reader = database.transaction(async (tx) => {
          await tx.query(
            sql("SELECT role_key FROM organization_roles FOR SHARE"),
          );
          acquired.resolve();
          await release.promise;
        });
        await Promise.race([acquired.promise, reader]);
        try {
          let attemptedRoleLock = false;
          const bounded: SqlDatabase = {
            close: () => Promise.resolve(),
            query: (statement) => database.query(statement),
            transaction: (work) =>
              database.transaction((tx) =>
                work({
                  query: async <TRow extends SqlRow = SqlRow>(
                    statement: SqlStatement,
                  ) => {
                    if (
                      statement.text.endsWith(
                        "LOCK TABLE organization_roles IN ACCESS EXCLUSIVE MODE",
                      )
                    ) {
                      attemptedRoleLock = true;
                      await tx.query(sql("SET LOCAL lock_timeout = '100ms'"));
                    }
                    return tx.query<TRow>(statement);
                  },
                }),
              ),
          };
          await expect(
            runMigrations(bounded, migrations),
          ).rejects.toMatchObject({ code: "55P03" });
          expect(attemptedRoleLock).toBe(true);
        } finally {
          release.resolve();
          await reader;
        }
        expect(await snapshot(database)).toEqual(before);
        await runMigrations(database, migrations);
        expect((await snapshot(database)).ledger.at(-1)?.["version"]).toBe(
          "0138",
        );
      });
    }, 30000);
  },
);
