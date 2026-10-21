import { FakeGitHubAppAdapter } from "@cloudmarkup/github-repository-export/testing";
import { describe, expect, it } from "vitest";

import { GitHubInstallationLinkAdapter } from "./adapters/github-installation-link.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./adapters/persistence/sql.js";
import type { PrincipalContext } from "./application/ports.js";
import { createProductionGitHubConnections } from "./production-github-connections.js";

const now = "2026-09-05T12:00:00.000Z";
const principal: PrincipalContext = {
  authenticatedAt: now,
  authenticationSource: "test",
  correlationId: "correlation_test",
  expiresAt: "2026-09-05T13:00:00.000Z",
  principalId: "principal_test",
  sessionId: "session_test",
};
const installation = {
  accountId: 31,
  accountLogin: "synthetic-user",
  accountType: "User" as const,
  installationId: 71,
  permissions: {
    contents: "write" as const,
    metadata: "read" as const,
    pullRequests: "write" as const,
    workflows: "none" as const,
  },
  repositorySelection: "selected" as const,
  suspended: false,
};
const installationRow = {
  account_id: 31,
  account_login: "synthetic-user",
  account_type: "User",
  contents_permission: "write",
  created_at: "2026-09-05 12:00:00",
  installation_id: 71,
  integration_id: "integration_test",
  lifecycle_status: "connected",
  metadata_permission: "read",
  organization_id: "org_test",
  pull_requests_permission: "write",
  repository_selection: "selected",
  updated_at: "2026-09-05 12:00:00.000000",
  workflows_permission: "none",
};

class ConnectionDatabase implements SqlDatabase {
  readonly statements: { statement: SqlStatement; transaction: number }[] = [];
  role: string | null = "owner";
  missingAfterAuthorization: number | undefined;
  authorizationCount = 0;
  transactionId = 0;
  readonly close = () => Promise.resolve();
  async transaction<T>(
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    this.transactionId += 1;
    return work(this);
  }
  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push({ statement, transaction: this.transactionId });
    let rows: SqlRow[] = [];
    if (statement.text.includes("FROM memberships m")) {
      this.authorizationCount += 1;
      if (
        this.role !== null &&
        statement.values[0] === principal.principalId &&
        statement.values[1] === "org_test" &&
        (this.missingAfterAuthorization === undefined ||
          this.authorizationCount < this.missingAfterAuthorization)
      )
        rows = [{ role_key: this.role }];
    } else if (statement.text.includes("FROM github_app_installations")) {
      rows = [installationRow];
    } else if (
      statement.text.includes(
        "INSERT INTO github_app_installation_link_intents",
      )
    ) {
      rows = [
        {
          intent_id: statement.values[0],
          organization_id: statement.values[1],
          principal_id: statement.values[2],
          state_sha256: statement.values[3],
          created_at: statement.values[4],
          expires_at: statement.values[5],
          lifecycle_status: "pending",
          completed_installation_id: null,
          completed_integration_id: null,
        },
      ];
    }
    return Promise.resolve({
      rowCount:
        rows.length === 0 && statement.text.includes("INSERT INTO")
          ? 1
          : rows.length,
      rows,
    } as SqlResult<TRow>);
  }
}

function fixture() {
  const database = new ConnectionDatabase();
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
        Promise.resolve(Buffer.from("synthetic-client-secret-for-local-tests")),
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
  return { application, database, github };
}

describe("production GitHub connections-only composition", () => {
  it("uses real SQL metadata and canonicalizes UTC Data API timestamps", async () => {
    const { application, database } = fixture();
    const result = await application.listInstallations(principal, "org_test");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      createdAt: now,
      updatedAt: now,
      organizationId: "org_test",
    });
    for (const record of database.statements.filter(
      ({ statement }) => !statement.text.includes("FROM memberships m"),
    )) {
      const first = database.statements.find(
        (entry) => entry.transaction === record.transaction,
      );
      expect(first?.statement.text).toContain("FOR SHARE OF m, u, o, r");
      expect(first?.statement.text).toContain("authorization-v2");
      expect(first?.statement.values).toEqual([
        principal.principalId,
        "org_test",
      ]);
    }
    expect(database.authorizationCount).toBe(3);
  });

  it("persists the real digest-only intent and audit behind separate current locked authority checks", async () => {
    const { application, database, github } = fixture();
    const result = await application.createInstallationLinkIntent(
      principal,
      "org_test",
      { contractVersion: 1 },
    );
    expect(result.intentId).toMatch(/^githublink_/);
    expect(result.expiresAt).toBe("2026-09-05T12:10:00.000Z");
    const writes = database.statements.filter(({ statement }) =>
      statement.text.includes("INSERT INTO"),
    );
    expect(writes).toHaveLength(2);
    expect(JSON.stringify(writes)).not.toContain(result.state);
    for (const record of writes)
      expect(
        database.statements.find(
          (entry) => entry.transaction === record.transaction,
        )?.statement.text,
      ).toContain("FOR SHARE OF m, u, o, r");
    expect(github.sessionsOpened).toBe(0);
  });

  it.each(["viewer", "editor", "unknown-role", null])(
    "denies non-administrator canonical role %s before connection management",
    async (role) => {
      const { application, database } = fixture();
      database.role = role;
      await expect(
        application.createInstallationLinkIntent(principal, "org_test", {
          contractVersion: 1,
        }),
      ).rejects.toMatchObject({
        code:
          role === null || role === "unknown-role"
            ? "not_found"
            : "access_denied",
      });
      expect(database.statements).toHaveLength(1);
    },
  );

  it("hides cross-tenant and no-longer-active principal scopes", async () => {
    const { application } = fixture();
    await expect(
      application.listInstallations(principal, "org_other"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      application.listInstallations(
        { ...principal, principalId: "principal_other" },
        "org_test",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("reauthorizes after a read and blocks stale membership from publishing its result", async () => {
    const { application, database } = fixture();
    database.missingAfterAuthorization = 3;
    await expect(
      application.listInstallations(principal, "org_test"),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(database.authorizationCount).toBe(3);
  });

  it("refreshes selected installation authority before and after metadata-only discovery", async () => {
    const { application, github } = fixture();
    await expect(
      application.discoverRepositories(
        principal,
        "org_test",
        "integration_test",
      ),
    ).resolves.toEqual([]);
    expect(github.sessionsOpened).toBe(1);
    expect(github.sessionsClosed).toBe(1);
    expect(github.requestedSessions[0]?.permissions).toEqual({
      contents: "read",
      metadata: "read",
      pullRequests: "none",
      workflows: "none",
    });
    github.addInstallation({ ...installation, repositorySelection: "all" });
    await expect(
      application.discoverRepositories(
        principal,
        "org_test",
        "integration_test",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(github.sessionsOpened).toBe(1);
  });

  it("discards discovery if installation authority changes while the provider session runs", async () => {
    const { application, github } = fixture();
    const entered = github.holdNextInstallationSession();
    const discovery = application.discoverRepositories(
      principal,
      "org_test",
      "integration_test",
    );
    await entered;
    github.addInstallation({ ...installation, repositorySelection: "all" });
    github.releaseHeldInstallationSession();
    await expect(discovery).rejects.toMatchObject({ code: "not_found" });
    expect(github.sessionsClosed).toBe(1);
  });

  it("keeps generation and repository writes explicitly unavailable without an artifact authority", async () => {
    const { application, database, github } = fixture();
    await expect(
      application.createPreview(principal, "project_test", {
        artifactId: "solutionartifact_test",
        baseBranch: "main",
        contractVersion: 1,
        destinationFolder: "generated",
        featureBranch: "cloudmarkup/export",
        includeWorkflows: false,
        integrationId: "integration_test",
        repositoryId: 1,
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(database.statements).toHaveLength(0);
    expect(github.sessionsOpened).toBe(0);
  });
});
