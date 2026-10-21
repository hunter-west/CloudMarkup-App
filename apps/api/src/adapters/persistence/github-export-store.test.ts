import { describe, expect, it } from "vitest";

import { canonicalDigest } from "@cloudmarkup/github-repository-export";
import type {
  GitHubInstallationRecord,
  GitHubPreviousExportAuthorityV1,
  StoredGitHubExportExecution,
} from "@cloudmarkup/github-repository-export";
import { sha256DigestSchema } from "@cloudmarkup/schemas";

import {
  PostgresGitHubExportAuditSink,
  PostgresGitHubExportProgressSink,
  PostgresGitHubExportStore,
} from "./github-export-store.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

class ScriptedDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
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
    return work(this);
  }
}

function result(
  rows: readonly SqlRow[] = [],
  rowCount = rows.length,
): SqlResult {
  return { rowCount, rows };
}

const timestamp = "2026-08-23T20:00:00.000Z";
const digest = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const previewDigest = sha256DigestSchema.parse(`sha256:${"b".repeat(64)}`);
const commitSha = "c".repeat(40);
const attemptId = "attempt_github_test";

const installation: GitHubInstallationRecord = {
  accountId: 22,
  accountLogin: "cloudmarkup-test",
  accountType: "Organization",
  createdAt: timestamp,
  installationId: 11,
  integrationId: "integration_github_test",
  organizationId: "organization_github_test",
  permissions: {
    contents: "write",
    metadata: "read",
    pullRequests: "write",
    workflows: "none",
  },
  repositorySelection: "selected",
  status: "connected",
  updatedAt: timestamp,
};

const authorityPayload = {
  artifactDigest: digest,
  artifactId: "solutionartifact_github_test",
  baseBranch: "main",
  commitSha,
  completedAt: timestamp,
  contractVersion: 1,
  destinationFolder: "cloudmarkup",
  executionId: "execution_github_test",
  featureBranch: "cloudmarkup/export-test",
  files: [],
  installationId: installation.installationId,
  integrationId: installation.integrationId,
  inventoryDigest: canonicalDigest([]),
  kind: "github-previous-export-authority",
  organizationId: installation.organizationId,
  previewDigest,
  projectId: "project_github_test",
  pullRequestNumber: 7,
  pullRequestUrl: "https://github.com/cloudmarkup-test/cloudmarkup/pull/7",
  repositoryId: 900,
  repositoryName: "cloudmarkup",
  repositoryOwner: installation.accountLogin,
  repositoryOwnerId: installation.accountId,
} satisfies Omit<GitHubPreviousExportAuthorityV1, "authorityDigest">;

const authority: GitHubPreviousExportAuthorityV1 = {
  ...authorityPayload,
  authorityDigest: canonicalDigest(authorityPayload),
};

function resealAuthority(
  overrides: Partial<GitHubPreviousExportAuthorityV1>,
): GitHubPreviousExportAuthorityV1 {
  const merged = { ...authority, ...overrides };
  const { authorityDigest: previousAuthorityDigest, ...payload } = merged;
  void previousAuthorityDigest;
  return {
    ...payload,
    authorityDigest: canonicalDigest(payload),
  };
}

const receipt = {
  branch: authority.featureBranch,
  commitSha,
  completedAt: timestamp,
  executionId: authority.executionId,
  organizationId: authority.organizationId,
  previewDigest,
  projectId: authority.projectId,
  pullRequestNumber: authority.pullRequestNumber,
  pullRequestUrl: authority.pullRequestUrl,
  repositoryId: authority.repositoryId,
} as const;

function executionRecord(
  overrides: Partial<StoredGitHubExportExecution> = {},
): StoredGitHubExportExecution {
  return Object.assign(
    {
      artifactDigest: digest,
      branchCreated: false,
      createdByPrincipalId: "principal_github_test",
      executionId: "execution_new_attempt",
      idempotencyKeyDigest: digest,
      organizationId: "organization_github_test",
      previewDigest,
      previewId: "preview_github_test",
      projectId: "project_github_test",
      recordVersion: 1,
      state: "running" as const,
      updatedAt: timestamp,
    },
    overrides,
  );
}

function executionRow(
  overrides: Readonly<Record<string, unknown>> = {},
): SqlRow {
  return {
    authority_json: null,
    artifact_sha256: digest,
    branch_created: false,
    commit_sha: null,
    created_by_principal_id: "principal_github_test",
    execution_attempt_id: attemptId,
    execution_id: "execution_github_test",
    failure_code: null,
    idempotency_key_sha256: digest,
    lifecycle_status: "running",
    organization_id: "organization_github_test",
    preview_id: "preview_github_test",
    preview_sha256: previewDigest,
    project_id: "project_github_test",
    record_version: "1",
    receipt_json: null,
    updated_at: timestamp,
    ...overrides,
  };
}

function succeededExecutionRow(
  overrides: Readonly<Record<string, unknown>> = {},
): SqlRow {
  return executionRow({
    authority_json: authority,
    branch_created: true,
    commit_sha: commitSha,
    lifecycle_status: "succeeded",
    receipt_json: receipt,
    record_version: "2",
    ...overrides,
  });
}

describe("PostgresGitHubExportStore", () => {
  it("stores only GitHub App installation metadata and tenant-scopes reads", async () => {
    const database = new ScriptedDatabase([
      result([], 1),
      result([
        {
          account_id: "22",
          account_login: installation.accountLogin,
          account_type: installation.accountType,
          contents_permission: "write",
          created_at: timestamp,
          installation_id: "11",
          integration_id: installation.integrationId,
          lifecycle_status: "connected",
          metadata_permission: "read",
          organization_id: installation.organizationId,
          pull_requests_permission: "write",
          repository_selection: "selected",
          updated_at: timestamp,
          workflows_permission: "none",
        },
      ]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    await store.saveInstallation(installation);
    const loaded = await store.getInstallation({
      integrationId: installation.integrationId,
      organizationId: installation.organizationId,
    });

    expect(loaded).toEqual(installation);
    expect(database.statements[1]?.text).toContain("organization_id = $1");
    const serialized = JSON.stringify(database.statements);
    expect(serialized).not.toMatch(
      /installation[_-]?token|private[_-]?key|webhook[_-]?secret|credential/i,
    );
  });

  it("lists installation metadata in a tenant-scoped stable order", async () => {
    const database = new ScriptedDatabase([
      result([
        {
          account_id: "22",
          account_login: installation.accountLogin,
          account_type: installation.accountType,
          contents_permission: "write",
          created_at: timestamp,
          installation_id: "11",
          integration_id: installation.integrationId,
          lifecycle_status: "connected",
          metadata_permission: "read",
          organization_id: installation.organizationId,
          pull_requests_permission: "write",
          repository_selection: "selected",
          updated_at: timestamp,
          workflows_permission: "none",
        },
      ]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    const listed = await store.listInstallations({
      organizationId: installation.organizationId,
    });

    expect(listed).toEqual([installation]);
    expect(database.statements[0]?.text).toContain("organization_id = $1");
    expect(database.statements[0]?.text).toContain("ORDER BY account_login");
    expect(database.statements[0]?.values).toEqual([
      installation.organizationId,
    ]);
  });

  it("atomically inserts and acquires a new execution claim", async () => {
    const database = new ScriptedDatabase([result([executionRow()])]);
    const store = new PostgresGitHubExportStore(database);
    const record = executionRecord();

    const reserved = await store.reserveExecution({ attemptId, record });

    expect(reserved).toMatchObject({
      outcome: "acquired",
      record: { executionId: "execution_github_test", recordVersion: 1 },
    });
    expect(database.statements[0]?.text).toContain("ON CONFLICT");
    expect(database.statements[0]?.text).toContain("execution_attempt_id");
    expect(database.statements[0]?.values).toContain(attemptId);
  });

  it("returns in-progress for the same running principal and binding", async () => {
    const database = new ScriptedDatabase([
      result([], 0),
      result([executionRow()]),
    ]);
    const store = new PostgresGitHubExportStore(database);
    const record = executionRecord();

    const reserved = await store.reserveExecution({
      attemptId: "attempt_duplicate",
      record,
    });

    expect(reserved.outcome).toBe("in-progress");
    expect(reserved.record.executionId).toBe("execution_github_test");
    expect(database.statements[1]?.text).toContain("FOR UPDATE");
    expect(database.statements[1]?.values).toEqual([
      record.organizationId,
      record.projectId,
      record.idempotencyKeyDigest,
    ]);
  });

  it("returns conflict when the same key is bound to another preview", async () => {
    const database = new ScriptedDatabase([
      result([], 0),
      result([executionRow()]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    const reserved = await store.reserveExecution({
      attemptId: "attempt_other_preview",
      record: executionRecord({ previewId: "preview_other" }),
    });

    expect(reserved.outcome).toBe("conflict");
    expect(database.statements).toHaveLength(2);
  });

  it("returns conflict when the same key belongs to another principal", async () => {
    const database = new ScriptedDatabase([
      result([], 0),
      result([executionRow()]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    const reserved = await store.reserveExecution({
      attemptId: "attempt_other_principal",
      record: executionRecord({
        createdByPrincipalId: "principal_github_other",
      }),
    });

    expect(reserved.outcome).toBe("conflict");
    expect(database.statements).toHaveLength(2);
  });

  it("returns terminal for succeeded and permanent-failure executions", async () => {
    const permanentFailure = executionRow({
      failure_code: "path-conflict",
      lifecycle_status: "failed-permanent",
      record_version: "2",
    });
    for (const row of [succeededExecutionRow(), permanentFailure]) {
      const database = new ScriptedDatabase([result([], 0), result([row])]);
      const store = new PostgresGitHubExportStore(database);

      const reserved = await store.reserveExecution({
        attemptId: "attempt_terminal_retry",
        record: executionRecord(),
      });

      expect(reserved.outcome).toBe("terminal");
      expect(database.statements).toHaveLength(2);
    }
  });

  it("CAS-reclaims a transient failure with a new attempt and version", async () => {
    const failed = executionRow({
      branch_created: true,
      commit_sha: commitSha,
      failure_code: "rate-limited",
      lifecycle_status: "failed-transient",
      record_version: "2",
    });
    const reclaimed = executionRow({
      branch_created: true,
      commit_sha: commitSha,
      execution_attempt_id: "attempt_retry",
      record_version: "3",
    });
    const database = new ScriptedDatabase([
      result([], 0),
      result([failed]),
      result([reclaimed]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    const reserved = await store.reserveExecution({
      attemptId: "attempt_retry",
      record: executionRecord(),
    });

    expect(reserved).toMatchObject({
      outcome: "acquired",
      record: {
        branchCreated: true,
        commitSha,
        recordVersion: 3,
        state: "running",
      },
    });
    expect(database.statements[2]?.text).toContain(
      "record_version = record_version + 1",
    );
    expect(database.statements[2]?.text).toContain(
      "lifecycle_status = 'failed-transient'",
    );
    expect(database.statements[2]?.values).toEqual([
      "organization_github_test",
      "project_github_test",
      digest,
      "attempt_retry",
      timestamp,
      "execution_github_test",
      attemptId,
      2,
    ]);
  });

  it("reads only exact successful previous-export authority in deterministic order", async () => {
    const database = new ScriptedDatabase([
      result([succeededExecutionRow()]),
      result([succeededExecutionRow()]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    const latest = await store.findLatestPreviousExportAuthority({
      baseBranch: authority.baseBranch,
      destinationFolder: authority.destinationFolder,
      installationId: authority.installationId,
      integrationId: authority.integrationId,
      organizationId: authority.organizationId,
      projectId: authority.projectId,
      repositoryId: authority.repositoryId,
      repositoryOwnerId: authority.repositoryOwnerId,
    });
    const exact = await store.getPreviousExportAuthority({
      authorityId: authority.executionId,
      organizationId: authority.organizationId,
      projectId: authority.projectId,
    });

    expect(latest).toEqual(authority);
    expect(exact).toEqual(authority);
    expect(database.statements[0]?.text).toContain(
      "lifecycle_status = 'succeeded'",
    );
    expect(database.statements[0]?.text).toContain(
      "ORDER BY authority_json ->> 'completedAt' DESC, execution_id DESC",
    );
    expect(database.statements[0]?.values).toEqual([
      authority.organizationId,
      authority.projectId,
      authority.integrationId,
      String(authority.installationId),
      String(authority.repositoryId),
      String(authority.repositoryOwnerId),
      authority.baseBranch,
      authority.destinationFolder,
    ]);
    expect(database.statements[1]?.values).toEqual([
      authority.organizationId,
      authority.projectId,
      authority.executionId,
    ]);
  });

  it("CAS-saves the exact running attempt and returns the incremented record", async () => {
    const database = new ScriptedDatabase([result([succeededExecutionRow()])]);
    const store = new PostgresGitHubExportStore(database);
    const record = executionRecord({
      authority,
      branchCreated: true,
      commitSha,
      executionId: authority.executionId,
      receipt,
      state: "succeeded",
    });

    const saved = await store.saveExecution({ attemptId, record });

    expect(saved).toMatchObject({
      outcome: "saved",
      record: {
        authority,
        receipt,
        recordVersion: 2,
        state: "succeeded",
      },
    });
    expect(database.statements[0]?.text).toContain(
      "execution_attempt_id = $16 AND record_version = $17",
    );
    expect(database.statements[0]?.text).toContain(
      "AND lifecycle_status = 'running'",
    );
    expect(database.statements[0]?.values.slice(10)).toEqual([
      record.previewId,
      record.idempotencyKeyDigest,
      record.artifactDigest,
      record.previewDigest,
      record.createdByPrincipalId,
      attemptId,
      1,
    ]);
  });

  it("returns stale canonical success without overwriting its receipt", async () => {
    const canonical = succeededExecutionRow();
    const database = new ScriptedDatabase([result([], 0), result([canonical])]);
    const store = new PostgresGitHubExportStore(database);
    const staleUpdate = executionRecord({
      branchCreated: true,
      commitSha,
      executionId: authority.executionId,
    });

    const saved = await store.saveExecution({
      attemptId: "attempt_stale_writer",
      record: staleUpdate,
    });

    expect(saved).toMatchObject({
      outcome: "stale",
      record: {
        authority,
        receipt,
        recordVersion: 2,
        state: "succeeded",
      },
    });
    expect(database.statements).toHaveLength(2);
    expect(database.statements[0]?.text).toContain(
      "AND lifecycle_status = 'running'",
    );
    expect(database.statements[1]?.text).toContain(
      "idempotency_key_sha256 = $3",
    );
  });

  it("rejects unknown failure codes and malformed stored authority", async () => {
    const unknownFailureDatabase = new ScriptedDatabase([
      result([
        executionRow({
          failure_code: "credential-leak",
          lifecycle_status: "failed-permanent",
          record_version: "2",
        }),
      ]),
    ]);
    const unknownFailureStore = new PostgresGitHubExportStore(
      unknownFailureDatabase,
    );

    await expect(
      unknownFailureStore.getExecutionByIdempotency({
        idempotencyKeyDigest: digest,
        organizationId: authority.organizationId,
        projectId: authority.projectId,
      }),
    ).rejects.toThrow();

    const malformedAuthorityDatabase = new ScriptedDatabase([
      result([
        succeededExecutionRow({
          authority_json: { ...authority, contractVersion: 2 },
        }),
      ]),
    ]);
    const malformedAuthorityStore = new PostgresGitHubExportStore(
      malformedAuthorityDatabase,
    );

    await expect(
      malformedAuthorityStore.getPreviousExportAuthority({
        authorityId: authority.executionId,
        organizationId: authority.organizationId,
        projectId: authority.projectId,
      }),
    ).rejects.toThrow();
  });

  it("rejects unsealed or internally inconsistent successful authority rows", async () => {
    const rows = [
      succeededExecutionRow({ branch_created: false }),
      succeededExecutionRow({ updated_at: "2026-08-23T20:00:01.000Z" }),
      succeededExecutionRow({
        authority_json: resealAuthority({ featureBranch: "cloudmarkup/other" }),
      }),
      succeededExecutionRow({
        authority_json: { ...authority, inventoryDigest: digest },
      }),
      succeededExecutionRow({
        authority_json: { ...authority, authorityDigest: digest },
      }),
    ];

    for (const row of rows) {
      const database = new ScriptedDatabase([result([row])]);
      const store = new PostgresGitHubExportStore(database);

      await expect(
        store.getPreviousExportAuthority({
          authorityId: authority.executionId,
          organizationId: authority.organizationId,
          projectId: authority.projectId,
        }),
      ).rejects.toThrow();
    }
  });

  it("makes deleted or transferred repositories unusable in the read model", async () => {
    const database = new ScriptedDatabase([result([], 1)]);
    const store = new PostgresGitHubExportStore(database);

    await store.updateRepositoryLifecycle({
      installationId: installation.installationId,
      repositoryId: 900,
      state: "transferred",
      updatedAt: timestamp,
    });

    expect(database.statements[0]?.text).toContain("is_disabled = TRUE");
    expect(database.statements[0]?.values).toEqual([
      installation.installationId,
      900,
      "transferred",
      timestamp,
    ]);
  });
  it("persists webhook replay evidence without raw payload or signature data", async () => {
    const database = new ScriptedDatabase([
      result([
        {
          delivery_id: "delivery-1",
          event_name: "installation",
          lifecycle_status: "received",
          payload_sha256: digest,
          processed_at: null,
          received_at: timestamp,
        },
      ]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    const reserved = await store.reserveWebhookDelivery({
      deliveryId: "delivery-1",
      event: "installation",
      payloadDigest: digest,
      receivedAt: timestamp,
      state: "received",
    });

    expect(reserved.created).toBe(true);
    expect(database.statements[0]?.text).toContain("payload_sha256");
    expect(JSON.stringify(database.statements[0])).not.toMatch(
      /raw[_-]?body|signature|secret|token/i,
    );
  });

  it("atomically reclaims an identical failed webhook delivery", async () => {
    const failedRow = {
      delivery_id: "delivery-retry",
      event_name: "installation",
      lifecycle_status: "failed",
      payload_sha256: digest,
      processed_at: null,
      received_at: timestamp,
    };
    const database = new ScriptedDatabase([
      result([], 0),
      result([failedRow]),
      result([{ ...failedRow, lifecycle_status: "received" }]),
    ]);
    const store = new PostgresGitHubExportStore(database);

    const reclaimed = await store.reserveWebhookDelivery({
      deliveryId: "delivery-retry",
      event: "installation",
      payloadDigest: digest,
      receivedAt: timestamp,
      state: "received",
    });

    expect(reclaimed).toMatchObject({
      created: true,
      record: { state: "received" },
    });
    expect(database.statements[1]?.text).toContain("FOR UPDATE");
    expect(database.statements[2]?.text).toContain(
      "lifecycle_status = 'failed'",
    );
  });
  it("writes safe organization audit and immutable progress events", async () => {
    const database = new ScriptedDatabase([result([], 1), result([], 1)]);
    const audit = new PostgresGitHubExportAuditSink(
      database,
      () => "audit_github_test",
    );
    const progress = new PostgresGitHubExportProgressSink(
      database,
      () => "progress_github_test",
    );

    await audit.record({
      action: "github.export.completed",
      correlationId: "correlation_github_test",
      occurredAt: timestamp,
      organizationId: "organization_github_test",
      outcome: "succeeded",
      principalId: "principal_github_test",
      summary: "Feature branch and pull request created.",
      targetId: "execution_github_test",
      targetKind: "export",
    });
    await progress.record({
      at: timestamp,
      executionId: "execution_github_test",
      message: "Pull request created.",
      organizationId: "organization_github_test",
      projectId: "project_github_test",
      stage: "complete",
      state: "succeeded",
    });

    expect(database.statements[0]?.text).toContain("INSERT INTO audit_events");
    expect(database.statements[1]?.text).toContain(
      "INSERT INTO github_repository_export_progress_events",
    );
  });
});
