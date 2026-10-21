import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { FakeGitHubAppAdapter } from "@cloudmarkup/github-repository-export/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitHubInstallationLinkAdapter } from "./adapters/github-installation-link.js";
import { runMigrations } from "./adapters/persistence/migrations.js";
import { loadHistoricalBetaMigrations } from "./adapters/persistence/historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./adapters/persistence/postgres-driver.js";
import { sql } from "./adapters/persistence/sql.js";
import type { PrincipalContext } from "./application/ports.js";
import { createProductionGitHubConnections } from "./production-github-connections.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = `cm_github_connections_it_${runId}`;
const schemaMarker = `CloudMarkup synthetic GitHub connections integration ${runId}`;
const now = "2026-09-05T12:00:00.000Z";
const id = (prefix: string): string =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;

function loopbackUrl(): string {
  if (configuredUrl === undefined || configuredUrl === "")
    throw new Error("Explicit loopback PostgreSQL URL required.");
  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error("Invalid PostgreSQL integration URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  ) {
    throw new Error(
      "GitHub integration accepts only an explicit loopback database without query or fragment overrides.",
    );
  }
  return configuredUrl;
}

// Only provider transport is synthetic. Production factory, SQL adapter,
// canonical authorization, row locks, foreign keys and one-time claims are real.
integrationDescribe(
  "production GitHub connections on isolated loopback PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_github_connections_it_[a-f0-9]{32}$/u.test(schemaName))
        throw new Error("Unsafe synthetic schema.");
      administration = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      await administration.transaction(async (tx) => {
        await tx.query(sql(`CREATE SCHEMA "${schemaName}"`));
        await tx.query(
          sql(`COMMENT ON SCHEMA "${schemaName}" IS '${schemaMarker}'`),
        );
      });
      createdSchema = true;
      database = new PostgresDatabase({
        connectionString,
        max: 3,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schemaName} -c timezone=UTC`,
      });
      opened = database;
      const migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../migrations", import.meta.url)),
      );
      await runMigrations(database, migrations);
      await runMigrations(database, migrations);
    }, 60000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (createdSchema && administration !== undefined) {
          const found = await administration.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schemaName],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== schemaMarker ||
            !/^cm_github_connections_it_[a-f0-9]{32}$/u.test(schemaName)
          )
            throw new Error(
              "Refusing to remove an unverified synthetic schema.",
            );
          await administration.transaction(async (tx) => {
            await tx.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
          });
        }
      } finally {
        await administration?.close();
      }
    }, 30000);

    async function fixture() {
      const organizationId = id("organization");
      const principal: PrincipalContext = {
        principalId: id("principal"),
        sessionId: id("session"),
        correlationId: id("correlation"),
        authenticatedAt: now,
        expiresAt: "2026-09-05T13:00:00.000Z",
        authenticationSource: "test",
      };
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic GitHub integration')",
            [principal.principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic GitHub integration',$2)",
            [organizationId, organizationId.replaceAll("_", "-")],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES ($1,'owner','authorization-v2',TRUE,cloudmarkup_authorization_v2_permissions('owner'))",
            [organizationId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,'owner')",
            [id("membership"), organizationId, principal.principalId],
          ),
        );
      });
      const installation = {
        accountId: 31,
        accountLogin: "synthetic-user",
        accountType: "User" as const,
        installationId:
          Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 11), 16) +
          1,
        permissions: {
          contents: "write" as const,
          metadata: "read" as const,
          pullRequests: "write" as const,
          workflows: "none" as const,
        },
        repositorySelection: "selected" as const,
        suspended: false,
      };
      const github = new FakeGitHubAppAdapter();
      github.addInstallation(installation);
      const callback = new GitHubInstallationLinkAdapter({
        appId: 99,
        appSlug: "cloudmarkup-test",
        callbackUrl: "https://beta.example.test/api/github/callback",
        clientId: "Iv1syntheticexample",
        clientSecretReference: "synthetic-secret",
        clock: () => new Date(now),
        secrets: {
          resolveSecret: () =>
            Promise.resolve(
              Buffer.from("synthetic-client-secret-for-local-tests"),
            ),
        },
        fetch: (url) => {
          const target = String(url);
          if (target === "https://github.com/login/oauth/access_token")
            return Promise.resolve(
              Response.json({
                access_token: "ghu_" + "synthetic".repeat(5),
                scope: "",
                token_type: "bearer",
              }),
            );
          if (target === "https://api.github.com/user")
            return Promise.resolve(Response.json({ id: 31, type: "User" }));
          if (target.startsWith("https://api.github.com/user/installations?"))
            return Promise.resolve(
              Response.json({
                installations: [
                  {
                    id: installation.installationId,
                    app_id: 99,
                    account: { id: 31, type: "User" },
                    permissions: {
                      contents: "write",
                      metadata: "read",
                      pull_requests: "write",
                    },
                    repository_selection: "selected",
                    suspended_at: null,
                  },
                ],
                total_count: 1,
              }),
            );
          throw new Error("Unexpected synthetic provider request.");
        },
      });
      const application = createProductionGitHubConnections({
        callback,
        clock: () => new Date(now),
        database,
        github,
        installationSetupUrl:
          "https://github.com/apps/cloudmarkup-test/installations/new",
      });
      const intent = await application.createInstallationLinkIntent(
        principal,
        organizationId,
        { contractVersion: 1 },
      );
      const state =
        new URL(intent.installationUrl).searchParams.get("state") ?? "";
      const start = await callback.createBrowserSession({
        intentId: intent.intentId,
        organizationId,
        principalId: principal.principalId,
        sessionId: principal.sessionId,
        state,
        expiresAt: intent.expiresAt,
        returnPath: `/organizations/${organizationId}/settings/integrations`,
      });
      const setup = await callback.continueInstallationSetup({
        cookie: start.cookie,
        installationId: installation.installationId,
        setupAction: "install",
        state,
      });
      const proof = await callback.completeAuthorization({
        cookie: setup.cookie,
        code: "synthetic-code",
        state: new URL(setup.authorizationUrl).searchParams.get("state") ?? "",
      });
      const input = {
        contractVersion: 1 as const,
        intentId: intent.intentId,
        callbackReceipt: proof.callbackReceipt,
      };
      return {
        application,
        principal,
        organizationId,
        installation,
        github,
        intent,
        input,
        state,
      };
    }

    it("persists only digest state and atomically completes once under concurrent session-bound receipts", async () => {
      const f = await fixture();
      const pending = await database.query(
        sql(
          "SELECT * FROM github_app_installation_link_intents WHERE intent_id=$1",
          [f.intent.intentId],
        ),
      );
      expect(pending.rows[0]).toMatchObject({
        lifecycle_status: "pending",
        organization_id: f.organizationId,
        principal_id: f.principal.principalId,
      });
      expect(pending.rows[0]?.["state_sha256"]).toMatch(
        /^sha256:[0-9a-f]{64}$/u,
      );
      expect(JSON.stringify(pending.rows)).not.toContain(f.state);
      expect(JSON.stringify(pending.rows)).not.toContain(
        f.input.callbackReceipt,
      );
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          f.application.completeInstallationLink(
            f.principal,
            f.organizationId,
            f.input,
          ),
        ),
      );
      expect(attempts.some(({ status }) => status === "fulfilled")).toBe(true);
      const replay = await f.application.completeInstallationLink(
        f.principal,
        f.organizationId,
        f.input,
      );
      expect(replay.installationId).toBe(f.installation.installationId);
      const links = await database.query(
        sql(
          "SELECT integration_id FROM github_app_installations WHERE organization_id=$1",
          [f.organizationId],
        ),
      );
      expect(links.rows).toEqual([{ integration_id: replay.integrationId }]);
      const completed = await database.query(
        sql(
          "SELECT lifecycle_status,completed_integration_id,completed_installation_id FROM github_app_installation_link_intents WHERE intent_id=$1",
          [f.intent.intentId],
        ),
      );
      expect(completed.rows[0]).toMatchObject({
        lifecycle_status: "completed",
        completed_integration_id: replay.integrationId,
      });
      expect(Number(completed.rows[0]?.["completed_installation_id"])).toBe(
        f.installation.installationId,
      );
      expect(
        await f.application.listInstallations(f.principal, f.organizationId),
      ).toHaveLength(1);
    }, 15000);

    it("rejects receipt replay under another session or organization without consuming the intent", async () => {
      const f = await fixture();
      await expect(
        f.application.completeInstallationLink(
          { ...f.principal, sessionId: id("other_session") },
          f.organizationId,
          f.input,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
      const other = await fixture();
      await expect(
        other.application.completeInstallationLink(
          other.principal,
          other.organizationId,
          f.input,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
      const current = await database.query(
        sql(
          "SELECT lifecycle_status FROM github_app_installation_link_intents WHERE intent_id=$1",
          [f.intent.intentId],
        ),
      );
      expect(current.rows[0]?.["lifecycle_status"]).toBe("pending");
      expect(
        await f.application.listInstallations(f.principal, f.organizationId),
      ).toEqual([]);
    });

    it("reauthorizes a revoked membership before final installation writes", async () => {
      const f = await fixture();
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.organizationId, f.principal.principalId],
        ),
      );
      await expect(
        f.application.completeInstallationLink(
          f.principal,
          f.organizationId,
          f.input,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      const current = await database.query(
        sql(
          "SELECT lifecycle_status FROM github_app_installation_link_intents WHERE intent_id=$1",
          [f.intent.intentId],
        ),
      );
      expect(current.rows[0]?.["lifecycle_status"]).toBe("pending");
      const links = await database.query(
        sql(
          "SELECT integration_id FROM github_app_installations WHERE organization_id=$1",
          [f.organizationId],
        ),
      );
      expect(links.rows).toEqual([]);
    });

    it("does not hold SQL locks across provider discovery and rejects authority revoked during the request", async () => {
      const f = await fixture();
      const link = await f.application.completeInstallationLink(
        f.principal,
        f.organizationId,
        f.input,
      );
      const entered = f.github.holdNextInstallationSession();
      const discovery = f.application.discoverRepositories(
        f.principal,
        f.organizationId,
        link.integrationId,
      );
      await entered;
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.organizationId, f.principal.principalId],
        ),
      );
      f.github.releaseHeldInstallationSession();
      await expect(discovery).rejects.toMatchObject({ code: "not_found" });
      expect(f.github.sessionsClosed).toBe(1);
      const repositories = await database.query(
        sql(
          "SELECT repository_id FROM github_app_repositories WHERE organization_id=$1",
          [f.organizationId],
        ),
      );
      expect(repositories.rows).toEqual([]);
    }, 15000);
  },
);
