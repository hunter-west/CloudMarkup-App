import { BetaCognitoPrincipalDirectory } from "../identity/beta-cognito-principal-directory.js";
import { ProductionIdentityApplication } from "../../application/production-identity-application.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAccountWorkspaces } from "./account-workspaces.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { runMigrations, splitPostgresStatements } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import type { PrincipalContext } from "../../application/ports.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const suite = configured ? describe : describe.skip;
const identifier = (prefix: string) =>
  prefix + "_" + randomUUID().replaceAll("-", "");
const schema = identifier("cm_workspace_test"),
  marker = "CloudMarkup synthetic workspace ownership";
suite(
  "personal and organization workspace ownership on local PostgreSQL",
  () => {
    let admin: PostgresDatabase | undefined,
      db: PostgresDatabase | undefined,
      typed: SqlDatabase,
      app: PostgresAccountWorkspaces;
    const now = new Date(),
      legacyActor = identifier("principal"),
      legacyOrg = identifier("org");
    beforeAll(async () => {
      const url = new URL(configured ?? "");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.search ||
        url.hash
      )
        throw Error("Synthetic loopback database required");
      admin = new PostgresDatabase({ connectionString: configured, max: 1 });
      await admin.query(sql(`CREATE SCHEMA "${schema}"`));
      await admin.query(
        sql(
          `COMMENT ON SCHEMA "${schema}" IS 'CloudMarkup synthetic workspace ownership'`,
        ),
      );
      db = new PostgresDatabase({
        connectionString: configured,
        max: 8,
        options: `-c search_path=${schema} -c timezone=UTC -c statement_timeout=5000`,
      });
      typed = withDataApiTypes(db);
      const migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      );
      await runMigrations(
        db,
        migrations.filter((m) => m.version < "0084"),
      );
      await typed.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Legacy synthetic user')",
          [legacyActor],
        ),
      );
      await typed.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Legacy beta workspace',$2)",
          [legacyOrg, legacyOrg.replaceAll("_", "-")],
        ),
      );
      const source = await readFile(
        new URL(
          "../../../migrations/0084_personal_workspace_ownership.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const candidate = [
        ...migrations.filter((m) => m.version < "0084"),
        {
          version: "0084",
          file: "0084_personal_workspace_ownership.sql",
          checksumSha256: createHash("sha256").update(source).digest("hex"),
          statements: splitPostgresStatements(source),
        },
      ];
      await runMigrations(db, candidate);
      await runMigrations(db, candidate);
      app = new PostgresAccountWorkspaces(typed, () => now);
    }, 30000);
    afterAll(async () => {
      await db?.close();
      if (admin) {
        try {
          const found = await admin.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schema],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== marker ||
            !/^cm_workspace_test_[a-f0-9]{32}$/u.test(schema)
          )
            throw Error("Refusing unverified cleanup");
          await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
        } finally {
          await admin.close();
        }
      }
    }, 30000);
    async function actor(): Promise<PrincipalContext> {
      const principalId = identifier("principal");
      await typed.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic account')",
          [principalId],
        ),
      );
      return {
        principalId,
        authenticationSource: "test",
        authenticatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 3600000).toISOString(),
        sessionId: identifier("session"),
        correlationId: identifier("correlation"),
      };
    }
    const page = { limit: 100, filters: {} };
    const orgInput = {
      contractVersion: 1 as const,
      displayName: "Synthetic organization",
    };
    it("new verified onboarding creates a personal workspace and hides sharing capabilities", async () => {
      const issuer =
        "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_workspace";
      const directory = new BetaCognitoPrincipalDirectory({
        database: typed,
        issuer,
      });
      const reference = {
        provider: "cognito" as const,
        issuer,
        subject: randomUUID(),
      };
      const first = await directory.resolveActivePrincipal(reference);
      if (first === null) throw Error("Missing principal");
      expect(await directory.resolveActivePrincipal(reference)).toEqual(first);
      const context = { ...(await actor()), principalId: first.principalId };
      const identity = await new ProductionIdentityApplication(typed, {
        organizationInvitations: true,
      }).getCurrentPrincipal(context);
      expect(identity.organizationContexts).toHaveLength(1);
      expect(identity.organizationContexts[0]?.capabilities).not.toContain(
        "memberships.manage",
      );
      const workspaces = await app.list(context, page);
      expect(workspaces.items).toHaveLength(1);
      expect(workspaces.items[0]).toMatchObject({
        kind: "personal",
        principalId: first.principalId,
      });
    });

    it("preserves legacy tenant identity and does not infer personal ownership", async () => {
      const result = await typed.query(
        sql(
          "SELECT organization_id,workspace_kind,personal_owner_principal_id,display_name FROM organizations WHERE organization_id=$1",
          [legacyOrg],
        ),
      );
      expect(result.rows).toEqual([
        {
          organization_id: legacyOrg,
          workspace_kind: "organization",
          personal_owner_principal_id: null,
          display_name: "Legacy beta workspace",
        },
      ]);
    });
    it("concurrent personal provisioning creates exactly one private workspace and owner", async () => {
      const principal = await actor();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => app.createPersonal(principal)),
      );
      expect(new Set(results.map((v) => v.id)).size).toBe(1);
      expect(results[0]).toMatchObject({
        kind: "personal",
        principalId: principal.principalId,
        role: "owner",
        displayName: "Personal",
      });
      const directory = await app.list(principal, page);
      expect(directory.items).toHaveLength(1);
      const members = await typed.query(
        sql(
          "SELECT principal_id,role_key FROM memberships WHERE organization_id=$1",
          [results[0]?.id ?? ""],
        ),
      );
      expect(members.rows).toEqual([
        { principal_id: principal.principalId, role_key: "owner" },
      ]);
    });
    it("creates separate organizations and replays the same request without cloning data or billing", async () => {
      const principal = await actor();
      const result = await Promise.all(
        Array.from({ length: 6 }, () =>
          app.createOrganization(principal, orgInput, "organization-create-01"),
        ),
      );
      expect(new Set(result.map((v) => v.id)).size).toBe(1);
      expect(result[0]).toMatchObject({ kind: "organization", role: "owner" });
      const directory = await app.list(principal, page);
      expect(directory.items.map((v) => v.kind)).toEqual([
        "personal",
        "organization",
      ]);
      const accounts = await typed.query(
        sql(
          "SELECT billing_account_id FROM organization_billing_accounts WHERE organization_id=$1",
          [result[0]?.id ?? ""],
        ),
      );
      expect(accounts.rows).toEqual([]);
      await expect(
        app.createOrganization(
          principal,
          { ...orgInput, displayName: "Changed" },
          "organization-create-01",
        ),
      ).rejects.toMatchObject({ code: "conflict" });
    });
    it("isolates directory, retries and personal identities between actors", async () => {
      const a = await actor(),
        b = await actor();
      const first = await app.createOrganization(
        a,
        orgInput,
        "same-browser-key",
      );
      const second = await app.createOrganization(
        b,
        orgInput,
        "same-browser-key",
      );
      expect(first.id).not.toBe(second.id);
      await expect(app.get(a, second.id)).rejects.toMatchObject({
        code: "not_found",
      });
      expect(await app.get(a, first.id)).toEqual(first);
      expect(
        (await app.list(a, page)).items.every(
          (v) => v.principalId === a.principalId && v.id !== second.id,
        ),
      ).toBe(true);
      expect(
        (await app.list(b, page)).items.every(
          (v) => v.principalId === b.principalId && v.id !== first.id,
        ),
      ).toBe(true);
    });
    it("denies expired sessions, stale authentication and suspended owners without writes", async () => {
      const principal = await actor();
      await expect(
        app.createPersonal({ ...principal, expiresAt: now.toISOString() }),
      ).rejects.toMatchObject({ code: "authentication_required" });
      await expect(
        app.createOrganization(
          {
            ...principal,
            authenticatedAt: new Date(now.getTime() - 660000).toISOString(),
          },
          orgInput,
          "stale-creation",
        ),
      ).rejects.toMatchObject({ code: "access_denied" });
      await typed.query(
        sql(
          "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
          [principal.principalId],
        ),
      );
      await expect(app.createPersonal(principal)).rejects.toMatchObject({
        code: "authentication_required",
      });
      await expect(app.list(principal, page)).rejects.toMatchObject({
        code: "authentication_required",
      });
      const count = await typed.query(
        sql("SELECT count(*) AS count FROM memberships WHERE principal_id=$1", [
          principal.principalId,
        ]),
      );
      expect(String(count.rows[0]?.["count"])).toBe("0");
    });
    it("SQL rejects personal sharing, role reassignment, removal and generic deletion", async () => {
      const principal = await actor(),
        other = await actor(),
        personal = await app.createPersonal(principal);
      await expect(
        typed.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'viewer')",
            [identifier("membership"), personal.id, other.principalId],
          ),
        ),
      ).rejects.toThrow();
      for (const query of [
        "UPDATE memberships SET role_key='viewer' WHERE organization_id=$1",
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1",
        "DELETE FROM memberships WHERE organization_id=$1",
        "UPDATE organizations SET lifecycle_status='suspended' WHERE organization_id=$1",
        "DELETE FROM organizations WHERE organization_id=$1",
        "UPDATE organizations SET workspace_kind='organization',personal_owner_principal_id=NULL WHERE organization_id=$1",
      ])
        await expect(typed.query(sql(query, [personal.id]))).rejects.toThrow();
      const membership = await typed.query(
        sql("SELECT membership_id FROM memberships WHERE organization_id=$1", [
          personal.id,
        ]),
      );
      await expect(
        typed.query(
          sql(
            `INSERT INTO organization_invitations(invitation_id,organization_id,issuer_principal_id,issuer_membership_id,target_role,token_sha256,request_sha256,idempotency_key_sha256,expires_at)
    VALUES($1,$2,$3,$4,'viewer',repeat('a',64),repeat('b',64),repeat('c',64),clock_timestamp()+interval '1 hour')`,
            [
              "invitation_" + randomUUID(),
              personal.id,
              principal.principalId,
              String(membership.rows[0]?.["membership_id"]),
            ],
          ),
        ),
      ).rejects.toThrow("Personal workspaces cannot be shared");
      expect((await app.list(principal, page)).items).toEqual([personal]);
    });
    it("reauthorizes receipt replay after membership loss", async () => {
      const principal = await actor(),
        workspace = await app.createOrganization(
          principal,
          orgInput,
          "replay-after-loss",
        );
      await typed.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [workspace.id, principal.principalId],
        ),
      );
      await expect(
        app.createOrganization(principal, orgInput, "replay-after-loss"),
      ).rejects.toMatchObject({ code: "not_found" });
    });
    it("rolls back ownership, roles, memberships and audit when the durable receipt fails", async () => {
      const principal = await actor();
      const failing: SqlDatabase = {
        close: () => Promise.resolve(),
        query: (statement) => typed.query(statement),
        transaction: (work) =>
          typed.transaction((tx) =>
            work({
              query: (statement) => {
                if (
                  statement.text.includes(
                    "INSERT INTO workspace_creation_receipts",
                  )
                )
                  throw Error("Synthetic receipt failure");
                return tx.query(statement);
              },
            }),
          ),
      };
      await expect(
        new PostgresAccountWorkspaces(failing, () => now).createOrganization(
          principal,
          orgInput,
          "rollback-workspace",
        ),
      ).rejects.toThrow("Synthetic receipt failure");
      expect((await app.list(principal, page)).items).toEqual([]);
      const audit = await typed.query(
        sql(
          "SELECT audit_event_id FROM audit_events WHERE actor_principal_id=$1",
          [principal.principalId],
        ),
      );
      expect(audit.rows).toEqual([]);
    });
    it("serializes concurrent creation at the principal capacity boundary", async () => {
      const principal = await actor();
      const prefix = identifier("org_capacity");
      await typed.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) SELECT $1||'_'||i,'Synthetic capacity workspace',replace($1,'_','-')||'-'||i FROM generate_series(1,98) AS i",
          [prefix],
        ),
      );
      await typed.query(
        sql(
          "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) SELECT organization_id,'owner','authorization-v2',true,cloudmarkup_authorization_v2_permissions('owner') FROM organizations WHERE organization_id LIKE $1",
          [prefix + "_%"],
        ),
      );
      await typed.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) SELECT 'membership_'||organization_id,organization_id,$1,'owner' FROM organizations WHERE organization_id LIKE $2",
          [principal.principalId, prefix + "_%"],
        ),
      );
      const result = await Promise.allSettled([
        app.createOrganization(principal, orgInput, "capacity-request-first"),
        app.createOrganization(principal, orgInput, "capacity-request-second"),
      ]);
      expect(
        result.filter((value) => value.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        result.filter((value) => value.status === "rejected"),
      ).toMatchObject([{ reason: { code: "conflict" } }]);
      const directory = await app.list(principal, page);
      expect(directory.items).toHaveLength(100);
      expect(
        directory.items.filter((value) => value.kind === "personal"),
      ).toHaveLength(1);
      await expect(
        app.createOrganization(principal, orgInput, "capacity-request-third"),
      ).rejects.toMatchObject({ code: "conflict" });
      expect((await app.createPersonal(principal)).kind).toBe("personal");
    });
    it("captures actor and name before asynchronous creation begins", async () => {
      const original = await actor(),
        other = await actor();
      const mutable = { ...original },
        input = { ...orgInput };
      const delayed = new PostgresAccountWorkspaces(
        {
          close: () => Promise.resolve(),
          query: (statement) => typed.query(statement),
          transaction: async (run) => {
            await Promise.resolve();
            return typed.transaction(run);
          },
        },
        () => now,
      );
      const creation = delayed.createOrganization(
        mutable,
        input,
        "captured-creation-request",
      );
      mutable.principalId = other.principalId;
      input.displayName = "Changed after request";
      const created = await creation;
      expect(created.principalId).toBe(original.principalId);
      expect(created.displayName).toBe(orgInput.displayName);
      expect((await app.list(other, page)).items).toEqual([]);
    });
    it.each(["read-expiry", "write-expiry", "write-reauth"])(
      "rechecks workspace authority after locking: %s",
      async (mode) => {
        const principal = await actor(),
          personal = await app.createPersonal(principal);
        let instant = now.getTime();
        const delayed = new PostgresAccountWorkspaces(
          {
            close: () => Promise.resolve(),
            query: (statement) => typed.query(statement),
            transaction: (run) =>
              typed.transaction((tx) =>
                run({
                  query: async <TRow extends SqlRow = SqlRow>(
                    statement: SqlStatement,
                  ) => {
                    const result = await tx.query<TRow>(statement);
                    if (
                      statement.text.startsWith(
                        "SELECT principal_id FROM principals",
                      )
                    )
                      instant += mode === "write-reauth" ? 660000 : 3700000;
                    return result;
                  },
                }),
              ),
          },
          () => new Date(instant),
        );
        const operation =
          mode === "read-expiry"
            ? delayed.get(principal, personal.id)
            : delayed.createOrganization(
                principal,
                orgInput,
                "delayed-authority-request",
              );
        await expect(operation).rejects.toMatchObject({
          code:
            mode === "write-reauth"
              ? "access_denied"
              : "authentication_required",
        });
        expect((await app.list(principal, page)).items).toEqual([personal]);
      },
    );
    it("paginates owned workspaces and rejects malformed cursors", async () => {
      const principal = await actor();
      await app.createOrganization(principal, orgInput, "pagination-workspace");
      const first = await app.list(principal, { ...page, limit: 1 });
      expect(first.items[0]?.kind).toBe("personal");
      expect(first.nextCursor).toBeDefined();
      if (first.nextCursor === undefined)
        throw Error("Expected another workspace page");
      const second = await app.list(principal, {
        ...page,
        limit: 1,
        cursor: first.nextCursor,
      });
      expect(second.items[0]?.kind).toBe("organization");
      expect(second.nextCursor).toBeUndefined();
      await expect(
        app.list(principal, { ...page, cursor: "foreign-cursor" }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    });
  },
);
