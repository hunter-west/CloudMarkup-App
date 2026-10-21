import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  GitHubInstallationLinkIntent,
  GitHubInstallationRecord,
} from "@cloudmarkup/github-repository-export";
import { describe, expect, it } from "vitest";
import { sha256DigestSchema } from "@cloudmarkup/schemas";

import { PostgresGitHubExportStore } from "./github-export-store.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const migrationUrl = new URL(
  "../../../migrations/0015_github_app_installation_link_intents.sql",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../migrations/manifest.json",
  import.meta.url,
);
const createdAt = "2026-08-24T12:00:00.000Z";
const expiresAt = "2026-08-24T12:10:00.000Z";
const stateDigest = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);

class ScriptedDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  transactions = 0;
  readonly #results: SqlResult[];

  constructor(results: readonly SqlResult[]) {
    this.#results = [...results];
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const result = this.#results.shift();
    if (result === undefined) throw new Error("Missing scripted SQL result.");
    return Promise.resolve(result as SqlResult<TRow>);
  }

  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    this.transactions += 1;
    return work(this);
  }
}

function result(
  rows: readonly SqlRow[] = [],
  rowCount = rows.length,
): SqlResult {
  return { rowCount, rows };
}

function intentRow(overrides: Partial<SqlRow> = {}): SqlRow {
  return {
    completed_installation_id: null,
    completed_integration_id: null,
    created_at: createdAt,
    expires_at: expiresAt,
    intent_id: "githublink_store",
    lifecycle_status: "pending",
    organization_id: "organization.store",
    principal_id: "principal.store",
    state_sha256: stateDigest,
    ...overrides,
  };
}

const intent: GitHubInstallationLinkIntent = {
  createdAt,
  expiresAt,
  intentId: "githublink_store",
  organizationId: "organization.store",
  principalId: "principal.store",
  state: "pending",
  stateDigest,
};

const installation: GitHubInstallationRecord = {
  accountId: 501,
  accountLogin: "customer-org",
  accountType: "Organization",
  createdAt,
  installationId: 77,
  integrationId: "integration.store",
  organizationId: intent.organizationId,
  permissions: {
    contents: "write",
    metadata: "read",
    pullRequests: "write",
    workflows: "none",
  },
  repositorySelection: "selected",
  status: "connected",
  updatedAt: "2026-08-24T12:01:00.000Z",
};

describe("GitHub installation link persistence", () => {
  it("pins a forward-only digest-only migration after Prompt 39 storage", async () => {
    const [migration, manifestText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(manifestUrl, "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      readonly migrations: readonly {
        readonly checksumSha256: string;
        readonly file: string;
        readonly version: string;
      }[];
    };

    expect(
      manifest.migrations.find(({ version }) => version === "0015"),
    ).toEqual({
      checksumSha256: createHash("sha256").update(migration).digest("hex"),
      file: "0015_github_app_installation_link_intents.sql",
      version: "0015",
    });
    expect(migration).toContain(
      "CREATE TABLE github_app_installation_link_intents",
    );
    expect(migration).toContain("state_sha256 VARCHAR(71) NOT NULL UNIQUE");
    expect(migration).toContain(
      "principal_id VARCHAR(128) NOT NULL REFERENCES principals",
    );
    expect(migration).not.toMatch(
      /callback_receipt|raw_state|installation_token/iu,
    );
  });

  it("reserves only the state digest and tenant/principal binding", async () => {
    const database = new ScriptedDatabase([result([intentRow()])]);
    const store = new PostgresGitHubExportStore(database);

    const reserved = await store.reserveInstallationLinkIntent(intent);

    expect(reserved).toEqual({ created: true, record: intent });
    expect(database.statements[0]?.text).toContain("ON CONFLICT DO NOTHING");
    expect(database.statements[0]?.values).toEqual([
      intent.intentId,
      intent.organizationId,
      intent.principalId,
      intent.stateDigest,
      intent.createdAt,
      intent.expiresAt,
    ]);
    expect(JSON.stringify(database.statements)).not.toMatch(
      /callback\.receipt|installation[_-]?token/iu,
    );
  });

  it("atomically consumes an exact unexpired tenant/principal/state tuple", async () => {
    const database = new ScriptedDatabase([
      result([intentRow({ lifecycle_status: "consumed" })]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    const consumed = await store.consumeInstallationLinkIntent({
      intentId: intent.intentId,
      now: "2026-08-24T12:01:00.000Z",
      organizationId: intent.organizationId,
      principalId: intent.principalId,
      stateDigest: intent.stateDigest,
    });

    expect(consumed).toMatchObject({ outcome: "consumed" });
    expect(database.statements[0]?.text).toContain(
      "lifecycle_status = 'pending'",
    );
    expect(database.statements[0]?.text).toContain("expires_at > $5");
    expect(database.statements[0]?.values.slice(0, 4)).toEqual([
      intent.intentId,
      intent.organizationId,
      intent.principalId,
      intent.stateDigest,
    ]);
  });

  it("returns an exact completed replay but rejects a cross-tenant binding", async () => {
    const completedRow = intentRow({
      completed_installation_id: "77",
      completed_integration_id: "integration.store",
      lifecycle_status: "completed",
    });
    const replayDatabase = new ScriptedDatabase([
      result([], 0),
      result([completedRow]),
    ]);
    const replayStore = new PostgresGitHubExportStore(replayDatabase);

    await expect(
      replayStore.consumeInstallationLinkIntent({
        intentId: intent.intentId,
        now: "2026-08-24T12:01:00.000Z",
        organizationId: intent.organizationId,
        principalId: intent.principalId,
        stateDigest: intent.stateDigest,
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      record: { completedInstallationId: 77 },
    });

    const crossTenantDatabase = new ScriptedDatabase([
      result([], 0),
      result([intentRow()]),
    ]);
    const crossTenantStore = new PostgresGitHubExportStore(crossTenantDatabase);
    await expect(
      crossTenantStore.consumeInstallationLinkIntent({
        intentId: intent.intentId,
        now: "2026-08-24T12:01:00.000Z",
        organizationId: "organization.other",
        principalId: intent.principalId,
        stateDigest: intent.stateDigest,
      }),
    ).resolves.toEqual({ outcome: "invalid" });
  });

  it("atomically saves the installation and completes only the exact unexpired consumed binding", async () => {
    const database = new ScriptedDatabase([
      result([intentRow({ lifecycle_status: "consumed" })]),
      result([], 1),
      result([], 1),
    ]);
    const store = new PostgresGitHubExportStore(database);

    await store.finalizeInstallationLink({
      installation,
      intentId: intent.intentId,
      now: installation.updatedAt,
      organizationId: intent.organizationId,
      principalId: intent.principalId,
      stateDigest: intent.stateDigest,
    });

    expect(database.transactions).toBe(1);
    expect(database.statements).toHaveLength(3);
    expect(database.statements[0]?.text).toContain("FOR UPDATE");
    expect(database.statements[0]?.text).toContain(
      "lifecycle_status = 'consumed'",
    );
    expect(database.statements[0]?.text).toContain("expires_at > $5");
    expect(database.statements[1]?.text).toContain(
      "INSERT INTO github_app_installations",
    );
    expect(database.statements[1]?.text).toContain(
      "github_app_installations.organization_id = EXCLUDED.organization_id",
    );
    expect(database.statements[2]?.text).toContain(
      "lifecycle_status = 'completed'",
    );
    expect(database.statements[2]?.values).toEqual([
      intent.intentId,
      intent.organizationId,
      intent.principalId,
      intent.stateDigest,
      installation.updatedAt,
      "integration.store",
      77,
    ]);
  });

  it("rejects a foreign installation record before starting finalization", async () => {
    const database = new ScriptedDatabase([]);
    const store = new PostgresGitHubExportStore(database);

    await expect(
      store.finalizeInstallationLink({
        installation: {
          ...installation,
          organizationId: "organization.other",
        },
        intentId: intent.intentId,
        now: installation.updatedAt,
        organizationId: intent.organizationId,
        principalId: intent.principalId,
        stateDigest: intent.stateDigest,
      }),
    ).rejects.toThrow();
    expect(database.transactions).toBe(0);
    expect(database.statements).toHaveLength(0);
  });

  it("releases only the exact unexpired consumed binding in one transaction", async () => {
    const database = new ScriptedDatabase([result([intentRow()])]);
    const store = new PostgresGitHubExportStore(database);

    await expect(
      store.releaseInstallationLinkIntent({
        intentId: intent.intentId,
        now: "2026-08-24T12:01:00.000Z",
        organizationId: intent.organizationId,
        principalId: intent.principalId,
        stateDigest: intent.stateDigest,
      }),
    ).resolves.toBe("released");
    expect(database.transactions).toBe(1);
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]?.text).toContain(
      "lifecycle_status = 'consumed'",
    );
    expect(database.statements[0]?.text).toContain("expires_at > $5");
    expect(database.statements[0]?.values).toEqual([
      intent.intentId,
      intent.organizationId,
      intent.principalId,
      intent.stateDigest,
      "2026-08-24T12:01:00.000Z",
    ]);
  });

  it("treats pending and completed release as no-ops and denies foreign or expired release", async () => {
    const pendingDatabase = new ScriptedDatabase([
      result([], 0),
      result([intentRow()]),
    ]);
    const pendingStore = new PostgresGitHubExportStore(pendingDatabase);
    await expect(
      pendingStore.releaseInstallationLinkIntent({
        intentId: intent.intentId,
        now: "2026-08-24T12:01:00.000Z",
        organizationId: intent.organizationId,
        principalId: intent.principalId,
        stateDigest: intent.stateDigest,
      }),
    ).resolves.toBe("released");

    const completedDatabase = new ScriptedDatabase([
      result([], 0),
      result([
        intentRow({
          completed_installation_id: "77",
          completed_integration_id: "integration.store",
          lifecycle_status: "completed",
        }),
      ]),
    ]);
    const completedStore = new PostgresGitHubExportStore(completedDatabase);
    await expect(
      completedStore.releaseInstallationLinkIntent({
        intentId: intent.intentId,
        now: "2026-08-24T12:01:00.000Z",
        organizationId: intent.organizationId,
        principalId: intent.principalId,
        stateDigest: intent.stateDigest,
      }),
    ).resolves.toBe("completed");

    const foreignDatabase = new ScriptedDatabase([
      result([], 0),
      result([intentRow({ lifecycle_status: "consumed" })]),
    ]);
    const foreignStore = new PostgresGitHubExportStore(foreignDatabase);
    await expect(
      foreignStore.releaseInstallationLinkIntent({
        intentId: intent.intentId,
        now: "2026-08-24T12:01:00.000Z",
        organizationId: "organization.other",
        principalId: intent.principalId,
        stateDigest: intent.stateDigest,
      }),
    ).resolves.toBe("invalid");

    const expiredDatabase = new ScriptedDatabase([
      result([], 0),
      result([intentRow({ lifecycle_status: "consumed" })]),
    ]);
    const expiredStore = new PostgresGitHubExportStore(expiredDatabase);
    await expect(
      expiredStore.releaseInstallationLinkIntent({
        intentId: intent.intentId,
        now: "2026-08-24T12:11:00.000Z",
        organizationId: intent.organizationId,
        principalId: intent.principalId,
        stateDigest: intent.stateDigest,
      }),
    ).resolves.toBe("expired");
  });
});
