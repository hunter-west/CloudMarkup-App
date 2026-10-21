import type {
  GitHubRepositoryReconciliationReview,
  StoredGitHubRepositoryImport,
} from "@cloudmarkup/github-repository-export/repository-import";
import type { GitHubRepositoryRefreshSubscription } from "@cloudmarkup/github-repository-export/repository-refresh";
import {
  repositoryCommitShaSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  PostgresGitHubRepositoryImportProgressSink,
  PostgresGitHubRepositoryImportStore,
  PostgresGitHubRepositoryRefreshStore,
} from "./github-import-store.js";
import type { SqlDatabase, SqlResult, SqlRow, SqlStatement } from "./sql.js";
import { createDataApiJsonDatabase } from "./data-api-json-test-helpers.js";

const at = "2026-08-25T12:00:00.000Z";
const commitSha = repositoryCommitShaSchema.parse("a".repeat(40));
const digest = sha256DigestSchema.parse(`sha256:${"b".repeat(64)}`);

class ScriptedDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  readonly rows: SqlRow[][] = [];

  close(): Promise<void> {
    return Promise.resolve();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const rows = this.rows.shift() ?? [];
    return Promise.resolve({
      rowCount: rows.length,
      rows: rows as readonly TRow[],
    });
  }

  transaction<TResult>(
    work: (transaction: ScriptedDatabase) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this);
  }
}

const running: StoredGitHubRepositoryImport = {
  branch: "main",
  branchHeadSha: commitSha,
  commitSha,
  createdAt: at,
  createdByPrincipalId: "principal_test",
  idempotencyDigest: digest,
  ignoredPaths: [".env"],
  importId: "githubimport_store-test",
  integrationId: "integration_test",
  organizationId: "organization_test",
  projectId: "project_test",
  recordVersion: 1,
  repositoryId: 42,
  repositoryName: "customer-repository",
  repositoryOwner: "example-org",
  selectedPaths: ["application"],
  snapshotId: "repository_snapshot_store_test",
  state: "running",
  trigger: "manual",
  updatedAt: at,
};

const runningRow = {
  branch_head_sha: commitSha,
  branch_name: "main",
  commit_sha: commitSha,
  completed_at: null,
  created_at: at,
  created_by_principal_id: "principal_test",
  failure_code: null,
  idempotency_key_sha256: digest,
  ignored_paths_json: [".env"],
  import_attempt_id: "attempt_test",
  import_id: running.importId,
  integration_id: running.integrationId,
  lifecycle_status: "running",
  organization_id: running.organizationId,
  previous_import_id: null,
  project_id: running.projectId,
  record_version: 1,
  repository_id: "42",
  repository_name: running.repositoryName,
  repository_owner: running.repositoryOwner,
  safe_result_json: null,
  selected_paths_json: ["application"],
  snapshot_id: running.snapshotId,
  snapshot_sha256: null,
  trigger_kind: "manual",
  updated_at: at,
} satisfies SqlRow;

const review: GitHubRepositoryReconciliationReview = {
  decision: "keep-observed",
  designChanged: false,
  idempotencyDigest: digest,
  importId: running.importId,
  operationId: "operation.keep",
  organizationId: running.organizationId,
  projectId: running.projectId,
  receiptId: "review.receipt.1",
  reviewedAt: at,
  reviewedByPrincipalId: running.createdByPrincipalId,
  snapshotDigest: digest,
};

const reviewRow = {
  decision: review.decision,
  design_changed: review.designChanged,
  idempotency_key_sha256: review.idempotencyDigest,
  import_id: review.importId,
  operation_id: review.operationId,
  organization_id: review.organizationId,
  project_id: review.projectId,
  reason: null,
  receipt_id: review.receiptId,
  reviewed_at: review.reviewedAt,
  reviewed_by_principal_id: review.reviewedByPrincipalId,
  review_id: "githubreview_store-test",
  snapshot_sha256: review.snapshotDigest,
} satisfies SqlRow;

describe("Postgres GitHub repository import persistence", () => {
  it("reads actual Data API import timestamps without changing scope", async () => {
    const { database, commands } = createDataApiJsonDatabase([
      [
        {
          ...runningRow,
          created_at: "2026-08-25 12:00:00.000000",
          updated_at: "2026-08-25 12:00:00",
        },
      ],
    ]);
    const store = new PostgresGitHubRepositoryImportStore(database);
    await expect(
      store.getImport({
        importId: running.importId,
        organizationId: running.organizationId,
        projectId: running.projectId,
      }),
    ).resolves.toEqual(running);
    expect(commands[0]?.input.formatRecordsAs).toBe("JSON");
    expect(
      commands[0]?.input.parameters?.map((item) => item.value?.stringValue),
    ).toEqual([running.organizationId, running.projectId, running.importId]);
  });

  it("claims an exact tenant-scoped import without storing tokens or raw repository bytes", async () => {
    const database = new ScriptedDatabase();
    database.rows.push([runningRow]);
    const store = new PostgresGitHubRepositoryImportStore(database);
    await expect(
      store.reserveImport({ attemptId: "attempt_test", record: running }),
    ).resolves.toMatchObject({ outcome: "acquired", record: running });
    const statement = database.statements[0];
    if (statement === undefined)
      throw new Error("Import INSERT was not issued.");
    expect(statement.text).toContain(
      "ON CONFLICT (organization_id, project_id, idempotency_key_sha256)",
    );
    expect(statement.text).toContain("safe_result_json");
    const serialized = JSON.stringify(statement.values);
    expect(serialized).not.toMatch(/installation.?token/iu);
    expect(serialized).not.toContain("private source");
  });

  it("binds reads and append-only progress to organization, project, and import", async () => {
    const database = new ScriptedDatabase();
    database.rows.push([runningRow], []);
    const store = new PostgresGitHubRepositoryImportStore(database);
    await expect(
      store.getImport({
        importId: running.importId,
        organizationId: running.organizationId,
        projectId: running.projectId,
      }),
    ).resolves.toMatchObject(running);
    const progress = new PostgresGitHubRepositoryImportProgressSink(database);
    await progress.record({
      at,
      importId: running.importId,
      message: "Repository import acquisition running.",
      organizationId: running.organizationId,
      projectId: running.projectId,
      stage: "acquisition",
      state: "running",
    });
    expect(database.statements[0]?.text).toContain(
      "WHERE organization_id = $1 AND project_id = $2 AND import_id = $3",
    );
    expect(database.statements[1]?.text).toContain(
      "github_repository_import_progress_events",
    );
  });

  it("returns the immutable review for a tenant-scoped idempotent replay", async () => {
    const database = new ScriptedDatabase();
    database.rows.push([reviewRow], [], [reviewRow]);
    const store = new PostgresGitHubRepositoryImportStore(database);
    await expect(
      store.getReviewByIdempotency({
        idempotencyDigest: review.idempotencyDigest,
        organizationId: review.organizationId,
        projectId: review.projectId,
      }),
    ).resolves.toEqual(review);
    await expect(store.saveReview(review)).resolves.toEqual(review);
    expect(database.statements[0]?.text).toContain(
      "WHERE organization_id = $1 AND project_id = $2",
    );
    expect(database.statements[0]?.text).toContain(
      "AND idempotency_key_sha256 = $3",
    );
    expect(database.statements[1]?.text).toContain(
      "ON CONFLICT (organization_id, project_id, idempotency_key_sha256)",
    );
    expect(database.statements[1]?.text).toContain("RETURNING");
    expect(database.statements[2]?.text).toContain(
      "AND idempotency_key_sha256 = $3",
    );
  });
  it("loads only the latest enabled immutable push subscription and deduplicates receipts", async () => {
    const database = new ScriptedDatabase();
    const subscription: GitHubRepositoryRefreshSubscription = {
      branch: "main",
      createdAt: at,
      createdByPrincipalId: "principal_test",
      enabled: true,
      event: "push",
      idempotencyDigest: digest,
      ignoredPaths: [".env"],
      integrationId: "integration_test",
      organizationId: "organization_test",
      projectId: "project_test",
      repositoryId: 42,
      selectedPaths: ["application"],
      subscriptionId: "githubrefresh_store-test",
    };
    const row = {
      branch_name: subscription.branch,
      created_at: at,
      created_by_principal_id: subscription.createdByPrincipalId,
      enabled: true,
      event_name: "push",
      idempotency_key_sha256: digest,
      ignored_paths_json: subscription.ignoredPaths,
      integration_id: subscription.integrationId,
      organization_id: subscription.organizationId,
      project_id: subscription.projectId,
      repository_id: "42",
      selected_paths_json: subscription.selectedPaths,
      subscription_id: subscription.subscriptionId,
    } satisfies SqlRow;
    database.rows.push([row], [row], []);
    const store = new PostgresGitHubRepositoryRefreshStore(database);
    await expect(store.reserve(subscription)).resolves.toEqual({
      created: true,
      record: subscription,
    });
    await expect(
      store.findActive({
        branch: "main",
        integrationId: subscription.integrationId,
        organizationId: subscription.organizationId,
        repositoryId: 42,
      }),
    ).resolves.toEqual([subscription]);
    await store.saveReceipt({
      commitSha,
      deliveryId: "delivery-store-test",
      importId: running.importId,
      organizationId: subscription.organizationId,
      projectId: subscription.projectId,
      recordedAt: at,
      state: "processed",
      subscriptionId: subscription.subscriptionId,
    });
    expect(database.statements[1]?.text).toContain("SELECT DISTINCT ON");
    expect(database.statements[1]?.text).toContain("WHERE enabled = TRUE");
    expect(database.statements[2]?.text).toContain(
      "ON CONFLICT (delivery_id, subscription_id) DO NOTHING",
    );
  });
});
