import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  GitHubRepositoryImportArtifactSet,
  GitHubRepositoryImportProgressEvent,
  GitHubRepositoryImportProgressSink,
  GitHubRepositoryImportStore,
  GitHubRepositoryReconciliationReview,
  StoredGitHubRepositoryImport,
} from "@cloudmarkup/github-repository-export/repository-import";
import type {
  GitHubRepositoryRefreshReceipt,
  GitHubRepositoryRefreshStore,
  GitHubRepositoryRefreshSubscription,
} from "@cloudmarkup/github-repository-export/repository-refresh";
import { gitHubRepositoryImportPathSchema } from "@cloudmarkup/github-repository-export";
import { repositoryImportResultV1Schema } from "@cloudmarkup/repository-importer";
import {
  repositoryCommitShaSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";

import { RepositoryError } from "../../application/persistence.js";
import { sql, type SqlDatabase, type SqlRow } from "./sql.js";
import { parseDatabaseTimestamp } from "./database-timestamp.js";

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const stateSchema = z.enum([
  "running",
  "succeeded",
  "failed-transient",
  "failed-permanent",
]);
const failureCodeSchema = z.enum([
  "authorization-denied",
  "github-permission-denied",
  "import-blocked",
  "import-in-progress",
  "installation-revoked",
  "integration-not-found",
  "invalid-request",
  "rate-limited",
  "repository-changed",
  "repository-not-found",
  "service-unavailable",
  "ungrounded-claim",
]);
const artifactSchema = z
  .object({
    branchChangedSinceSelection: z.boolean(),
    fileDifferences: z.array(
      z
        .object({
          action: z.enum(["added", "modified", "removed", "unchanged"]),
          currentDigest: sha256DigestSchema.optional(),
          path: gitHubRepositoryImportPathSchema,
          previousDigest: sha256DigestSchema.optional(),
        })
        .strict(),
    ),
    files: z.array(
      z
        .object({
          digest: sha256DigestSchema,
          path: gitHubRepositoryImportPathSchema,
          sizeBytes: z
            .number()
            .int()
            .nonnegative()
            .max(8 * 1024 * 1024),
        })
        .strict(),
    ),
    ignoredFiles: z.array(
      z
        .object({
          path: gitHubRepositoryImportPathSchema,
          reason: z.enum([
            "explicitly-ignored",
            "sensitive-path",
            "unsupported-file-type",
          ]),
        })
        .strict(),
    ),
    importResult: repositoryImportResultV1Schema,
    inferenceClaims: z.array(
      z
        .object({
          category: z.enum([
            "resource",
            "connection",
            "workload",
            "external-resource",
            "source-ownership",
            "workflow",
            "diagnostic",
          ]),
          claimId: opaqueIdSchema,
          confidenceBasisPoints: z.number().int().min(0).max(10_000),
          evidenceIds: z.array(opaqueIdSchema).min(1).max(256),
          summary: z.string().min(1).max(500),
        })
        .strict(),
    ),
    inferenceIssues: z.array(
      z
        .object({
          claimId: opaqueIdSchema,
          confidenceBasisPoints: z.number().int().min(0).max(10_000),
          evidenceIds: z.array(opaqueIdSchema).min(1).max(256),
          issueId: opaqueIdSchema,
          lifecycle: z.literal("current"),
          source: z.literal("repository-import-mismatch"),
          summary: z.string().min(1).max(500),
        })
        .strict(),
    ),
  })
  .strict();

function mapArtifact(value: unknown): GitHubRepositoryImportArtifactSet {
  const parsed = artifactSchema.parse(readJson(value));
  return {
    ...parsed,
    fileDifferences: parsed.fileDifferences.map((difference) => ({
      action: difference.action,
      ...(difference.currentDigest === undefined
        ? {}
        : { currentDigest: difference.currentDigest }),
      path: difference.path,
      ...(difference.previousDigest === undefined
        ? {}
        : { previousDigest: difference.previousDigest }),
    })),
  };
}

interface ImportRow extends SqlRow {
  readonly branch_head_sha: unknown;
  readonly branch_name: unknown;
  readonly commit_sha: unknown;
  readonly completed_at: unknown;
  readonly created_at: unknown;
  readonly created_by_principal_id: unknown;
  readonly failure_code: unknown;
  readonly idempotency_key_sha256: unknown;
  readonly ignored_paths_json: unknown;
  readonly import_attempt_id: unknown;
  readonly import_id: unknown;
  readonly integration_id: unknown;
  readonly lifecycle_status: unknown;
  readonly organization_id: unknown;
  readonly previous_import_id: unknown;
  readonly project_id: unknown;
  readonly record_version: unknown;
  readonly repository_id: unknown;
  readonly repository_name: unknown;
  readonly repository_owner: unknown;
  readonly safe_result_json: unknown;
  readonly selected_paths_json: unknown;
  readonly snapshot_id: unknown;
  readonly snapshot_sha256: unknown;
  readonly trigger_kind: unknown;
  readonly updated_at: unknown;
}

interface ReviewRow extends SqlRow {
  readonly decision: unknown;
  readonly design_changed: unknown;
  readonly idempotency_key_sha256: unknown;
  readonly import_id: unknown;
  readonly operation_id: unknown;
  readonly organization_id: unknown;
  readonly project_id: unknown;
  readonly reason: unknown;
  readonly receipt_id: unknown;
  readonly reviewed_at: unknown;
  readonly reviewed_by_principal_id: unknown;
  readonly review_id: unknown;
  readonly snapshot_sha256: unknown;
}

interface RefreshSubscriptionRow extends SqlRow {
  readonly branch_name: unknown;
  readonly created_at: unknown;
  readonly created_by_principal_id: unknown;
  readonly enabled: unknown;
  readonly event_name: unknown;
  readonly idempotency_key_sha256: unknown;
  readonly ignored_paths_json: unknown;
  readonly integration_id: unknown;
  readonly organization_id: unknown;
  readonly project_id: unknown;
  readonly repository_id: unknown;
  readonly selected_paths_json: unknown;
  readonly subscription_id: unknown;
}

function persistenceInvalid(): never {
  throw new RepositoryError(
    "persistence-unavailable",
    "The GitHub repository import record could not be read safely.",
  );
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : persistenceInvalid();
}

function readOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : readString(value);
}

function readBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : persistenceInvalid();
}

function readInteger(value: unknown): number {
  const parsed =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "string"
        ? Number(value)
        : value;
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed > 0
    ? parsed
    : persistenceInvalid();
}

function readTimestamp(value: unknown): string {
  return parseDatabaseTimestamp(value) ?? persistenceInvalid();
}

function readJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return persistenceInvalid();
  }
}

function readPaths(value: unknown): readonly string[] {
  return z
    .array(gitHubRepositoryImportPathSchema)
    .max(128)
    .parse(readJson(value));
}

const importColumns = `
  import_id, organization_id, project_id, integration_id, repository_id,
  repository_owner, repository_name, previous_import_id, trigger_kind,
  branch_name, commit_sha, branch_head_sha, snapshot_id, snapshot_sha256,
  idempotency_key_sha256, selected_paths_json, ignored_paths_json,
  safe_result_json, import_attempt_id, lifecycle_status, failure_code,
  record_version, created_by_principal_id, created_at, updated_at, completed_at`;

function mapImportWithAttempt(row: ImportRow): {
  readonly attemptId: string;
  readonly record: StoredGitHubRepositoryImport;
} {
  const state = stateSchema.parse(row.lifecycle_status);
  const resultValue =
    row.safe_result_json === null || row.safe_result_json === undefined
      ? undefined
      : mapArtifact(row.safe_result_json);
  const snapshotDigestValue = readOptionalString(row.snapshot_sha256);
  const completedAt =
    row.completed_at === null || row.completed_at === undefined
      ? undefined
      : readTimestamp(row.completed_at);
  const failureCodeValue = readOptionalString(row.failure_code);
  const record: StoredGitHubRepositoryImport = {
    branch: readString(row.branch_name),
    branchHeadSha: repositoryCommitShaSchema.parse(row.branch_head_sha),
    commitSha: repositoryCommitShaSchema.parse(row.commit_sha),
    ...(completedAt === undefined ? {} : { completedAt }),
    createdAt: readTimestamp(row.created_at),
    createdByPrincipalId: opaqueIdSchema.parse(row.created_by_principal_id),
    ...(failureCodeValue === undefined
      ? {}
      : { failureCode: failureCodeSchema.parse(failureCodeValue) }),
    idempotencyDigest: sha256DigestSchema.parse(row.idempotency_key_sha256),
    ignoredPaths: readPaths(row.ignored_paths_json),
    importId: opaqueIdSchema.parse(row.import_id),
    integrationId: opaqueIdSchema.parse(row.integration_id),
    organizationId: opaqueIdSchema.parse(row.organization_id),
    ...(readOptionalString(row.previous_import_id) === undefined
      ? {}
      : { previousImportId: opaqueIdSchema.parse(row.previous_import_id) }),
    projectId: opaqueIdSchema.parse(row.project_id),
    recordVersion: readInteger(row.record_version),
    repositoryId: readInteger(row.repository_id),
    repositoryName: z.string().min(1).max(100).parse(row.repository_name),
    repositoryOwner: z.string().min(1).max(100).parse(row.repository_owner),
    ...(resultValue === undefined ? {} : { result: resultValue }),
    selectedPaths: readPaths(row.selected_paths_json),
    ...(snapshotDigestValue === undefined
      ? {}
      : { snapshotDigest: sha256DigestSchema.parse(snapshotDigestValue) }),
    snapshotId: opaqueIdSchema.parse(row.snapshot_id),
    state,
    trigger: z.enum(["manual", "webhook"]).parse(row.trigger_kind),
    updatedAt: readTimestamp(row.updated_at),
  };
  if (
    (state === "succeeded") !==
      (record.result !== undefined && record.snapshotDigest !== undefined) ||
    (state === "succeeded") !== (record.completedAt !== undefined) ||
    state.startsWith("failed-") !== (record.failureCode !== undefined)
  ) {
    return persistenceInvalid();
  }
  return {
    attemptId: opaqueIdSchema.parse(row.import_attempt_id),
    record,
  };
}

function mapImport(row: ImportRow): StoredGitHubRepositoryImport {
  return mapImportWithAttempt(row).record;
}

const reviewDecisionSchema = z.enum([
  "accept-into-design",
  "keep-observed",
  "mark-external",
  "regenerate",
  "ignore",
  "reject",
]);

const reviewColumns = `
  review_id, organization_id, project_id, import_id, operation_id,
  decision, snapshot_sha256, reason, receipt_id, design_changed,
  idempotency_key_sha256, reviewed_by_principal_id, reviewed_at`;

function mapReview(row: ReviewRow): GitHubRepositoryReconciliationReview {
  opaqueIdSchema.parse(row.review_id);
  const decision = reviewDecisionSchema.parse(row.decision);
  const designChanged = readBoolean(row.design_changed);
  const reason = readOptionalString(row.reason);
  const review: GitHubRepositoryReconciliationReview = {
    decision,
    designChanged,
    idempotencyDigest: sha256DigestSchema.parse(row.idempotency_key_sha256),
    importId: opaqueIdSchema.parse(row.import_id),
    operationId: opaqueIdSchema.parse(row.operation_id),
    organizationId: opaqueIdSchema.parse(row.organization_id),
    projectId: opaqueIdSchema.parse(row.project_id),
    ...(reason === undefined ? {} : { reason }),
    receiptId: opaqueIdSchema.parse(row.receipt_id),
    reviewedAt: readTimestamp(row.reviewed_at),
    reviewedByPrincipalId: opaqueIdSchema.parse(row.reviewed_by_principal_id),
    snapshotDigest: sha256DigestSchema.parse(row.snapshot_sha256),
  };
  if (
    designChanged !== (decision === "accept-into-design") ||
    (decision === "ignore" && reason === undefined)
  ) {
    return persistenceInvalid();
  }
  return review;
}

function sameReviewBinding(
  left: GitHubRepositoryReconciliationReview,
  right: GitHubRepositoryReconciliationReview,
): boolean {
  return (
    left.idempotencyDigest === right.idempotencyDigest &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.importId === right.importId &&
    left.operationId === right.operationId &&
    left.decision === right.decision &&
    left.snapshotDigest === right.snapshotDigest &&
    left.reviewedByPrincipalId === right.reviewedByPrincipalId &&
    left.reason === right.reason &&
    left.receiptId === right.receiptId &&
    left.designChanged === right.designChanged
  );
}

function validateNewRecord(record: StoredGitHubRepositoryImport): void {
  opaqueIdSchema.parse(record.importId);
  opaqueIdSchema.parse(record.organizationId);
  opaqueIdSchema.parse(record.projectId);
  opaqueIdSchema.parse(record.integrationId);
  opaqueIdSchema.parse(record.snapshotId);
  repositoryCommitShaSchema.parse(record.commitSha);
  repositoryCommitShaSchema.parse(record.branchHeadSha);
  sha256DigestSchema.parse(record.idempotencyDigest);
  readPaths(record.selectedPaths);
  readPaths(record.ignoredPaths);
}

export class PostgresGitHubRepositoryImportStore implements GitHubRepositoryImportStore {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async getImport(input: {
    readonly importId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubRepositoryImport | null> {
    const result = await this.#database.query<ImportRow>(
      sql(
        `SELECT ${importColumns}
           FROM github_repository_imports
          WHERE organization_id = $1 AND project_id = $2 AND import_id = $3`,
        [input.organizationId, input.projectId, input.importId],
      ),
    );
    return result.rows[0] === undefined ? null : mapImport(result.rows[0]);
  }

  async getReviewByIdempotency(input: {
    readonly idempotencyDigest: GitHubRepositoryReconciliationReview["idempotencyDigest"];
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<GitHubRepositoryReconciliationReview | null> {
    const result = await this.#database.query<ReviewRow>(
      sql(
        `SELECT ${reviewColumns}
           FROM github_repository_import_reviews
          WHERE organization_id = $1 AND project_id = $2
            AND idempotency_key_sha256 = $3`,
        [input.organizationId, input.projectId, input.idempotencyDigest],
      ),
    );
    return result.rows[0] === undefined ? null : mapReview(result.rows[0]);
  }

  async listImports(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly repositoryId?: number;
  }): Promise<readonly StoredGitHubRepositoryImport[]> {
    const result = await this.#database.query<ImportRow>(
      sql(
        `SELECT ${importColumns}
           FROM github_repository_imports
          WHERE organization_id = $1 AND project_id = $2
            AND ($3::BIGINT IS NULL OR repository_id = $3)
          ORDER BY created_at DESC, import_id DESC`,
        [input.organizationId, input.projectId, input.repositoryId ?? null],
      ),
    );
    return result.rows.map(mapImport);
  }

  reserveImport(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubRepositoryImport;
  }): ReturnType<GitHubRepositoryImportStore["reserveImport"]> {
    const { record } = input;
    validateNewRecord(record);
    const attemptId = opaqueIdSchema.parse(input.attemptId);
    if (
      record.state !== "running" ||
      record.recordVersion !== 1 ||
      record.result !== undefined ||
      record.failureCode !== undefined
    ) {
      return persistenceInvalid();
    }
    return this.#database.transaction(async (transaction) => {
      const inserted = await transaction.query<ImportRow>(
        sql(
          `INSERT INTO github_repository_imports (
             import_id, organization_id, project_id, integration_id,
             repository_id, repository_owner, repository_name,
             previous_import_id, trigger_kind, branch_name, commit_sha,
             branch_head_sha, snapshot_id, snapshot_sha256,
             idempotency_key_sha256, selected_paths_json, ignored_paths_json,
             safe_result_json, import_attempt_id, lifecycle_status,
             failure_code, record_version, created_by_principal_id,
             created_at, updated_at, completed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,$14,$15,$16,NULL,$17,$18,NULL,$19,$20,$21,$22,NULL)
           ON CONFLICT (organization_id, project_id, idempotency_key_sha256)
           DO NOTHING
           RETURNING ${importColumns}`,
          [
            record.importId,
            record.organizationId,
            record.projectId,
            record.integrationId,
            record.repositoryId,
            record.repositoryOwner,
            record.repositoryName,
            record.previousImportId ?? null,
            record.trigger,
            record.branch,
            record.commitSha,
            record.branchHeadSha,
            record.snapshotId,
            record.idempotencyDigest,
            JSON.stringify(record.selectedPaths),
            JSON.stringify(record.ignoredPaths),
            attemptId,
            record.state,
            record.recordVersion,
            record.createdByPrincipalId,
            record.createdAt,
            record.updatedAt,
          ],
        ),
      );
      if (inserted.rows[0] !== undefined) {
        return {
          outcome: "acquired" as const,
          record: mapImport(inserted.rows[0]),
        };
      }
      const selected = await transaction.query<ImportRow>(
        sql(
          `SELECT ${importColumns}
             FROM github_repository_imports
            WHERE organization_id = $1 AND project_id = $2
              AND idempotency_key_sha256 = $3
            FOR UPDATE`,
          [record.organizationId, record.projectId, record.idempotencyDigest],
        ),
      );
      const row = selected.rows[0];
      if (row === undefined) return persistenceInvalid();
      const existing = mapImportWithAttempt(row);
      if (
        existing.record.commitSha !== record.commitSha ||
        existing.record.integrationId !== record.integrationId ||
        existing.record.repositoryId !== record.repositoryId ||
        existing.record.createdByPrincipalId !== record.createdByPrincipalId
      ) {
        return persistenceInvalid();
      }
      if (existing.record.state === "running") {
        return { outcome: "in-progress" as const, record: existing.record };
      }
      if (
        existing.record.state === "succeeded" ||
        existing.record.state === "failed-permanent"
      ) {
        return { outcome: "terminal" as const, record: existing.record };
      }
      const reclaimed = await transaction.query<ImportRow>(
        sql(
          `UPDATE github_repository_imports
              SET import_attempt_id = $4, lifecycle_status = 'running',
                  failure_code = NULL, safe_result_json = NULL,
                  snapshot_sha256 = NULL, completed_at = NULL,
                  branch_head_sha = $5, record_version = record_version + 1,
                  updated_at = $6
            WHERE organization_id = $1 AND project_id = $2
              AND idempotency_key_sha256 = $3
              AND import_id = $7 AND import_attempt_id = $8
              AND record_version = $9 AND lifecycle_status = 'failed-transient'
            RETURNING ${importColumns}`,
          [
            record.organizationId,
            record.projectId,
            record.idempotencyDigest,
            attemptId,
            record.branchHeadSha,
            record.updatedAt,
            existing.record.importId,
            existing.attemptId,
            existing.record.recordVersion,
          ],
        ),
      );
      const claimed = reclaimed.rows[0];
      return claimed === undefined
        ? persistenceInvalid()
        : { outcome: "acquired" as const, record: mapImport(claimed) };
    });
  }

  async saveImport(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubRepositoryImport;
  }): Promise<"saved" | "stale"> {
    const { record } = input;
    validateNewRecord(record);
    if (record.state === "running") return persistenceInvalid();
    const result = await this.#database.query<ImportRow>(
      sql(
        `UPDATE github_repository_imports
            SET branch_head_sha = $5, snapshot_sha256 = $6,
                safe_result_json = $7, lifecycle_status = $8,
                failure_code = $9, record_version = $10,
                updated_at = $11, completed_at = $12
          WHERE organization_id = $1 AND project_id = $2 AND import_id = $3
            AND import_attempt_id = $4 AND lifecycle_status = 'running'
            AND record_version = $13
          RETURNING ${importColumns}`,
        [
          record.organizationId,
          record.projectId,
          record.importId,
          opaqueIdSchema.parse(input.attemptId),
          record.branchHeadSha,
          record.snapshotDigest ?? null,
          record.result === undefined
            ? null
            : JSON.stringify(artifactSchema.parse(record.result)),
          record.state,
          record.failureCode ?? null,
          record.recordVersion,
          record.updatedAt,
          record.completedAt ?? null,
          record.recordVersion - 1,
        ],
      ),
    );
    return result.rowCount === 1 ? "saved" : "stale";
  }

  async saveReview(
    record: GitHubRepositoryReconciliationReview,
  ): Promise<GitHubRepositoryReconciliationReview> {
    const inserted = await this.#database.query<ReviewRow>(
      sql(
        `INSERT INTO github_repository_import_reviews (
           review_id, organization_id, project_id, import_id, operation_id,
           decision, snapshot_sha256, reason, receipt_id, design_changed,
           idempotency_key_sha256, reviewed_by_principal_id, reviewed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (organization_id, project_id, idempotency_key_sha256)
         DO NOTHING
         RETURNING ${reviewColumns}`,
        [
          `githubreview_${randomUUID()}`,
          record.organizationId,
          record.projectId,
          record.importId,
          record.operationId,
          record.decision,
          record.snapshotDigest,
          record.reason ?? null,
          record.receiptId,
          record.designChanged,
          record.idempotencyDigest,
          record.reviewedByPrincipalId,
          record.reviewedAt,
        ],
      ),
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow !== undefined) return mapReview(insertedRow);
    const existing = await this.getReviewByIdempotency({
      idempotencyDigest: record.idempotencyDigest,
      organizationId: record.organizationId,
      projectId: record.projectId,
    });
    if (existing === null || !sameReviewBinding(existing, record)) {
      return persistenceInvalid();
    }
    return existing;
  }
}

export class PostgresGitHubRepositoryImportProgressSink implements GitHubRepositoryImportProgressSink {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async record(event: GitHubRepositoryImportProgressEvent): Promise<void> {
    await this.#database.query(
      sql(
        `INSERT INTO github_repository_import_progress_events (
           progress_event_id, organization_id, project_id, import_id,
           stage, lifecycle_status, safe_message, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `githubimportprogress_${randomUUID()}`,
          event.organizationId,
          event.projectId,
          event.importId,
          event.stage,
          event.state,
          event.message,
          event.at,
        ],
      ),
    );
  }
}

function mapSubscription(
  row: RefreshSubscriptionRow,
): GitHubRepositoryRefreshSubscription {
  return {
    branch: readString(row.branch_name),
    createdAt: readTimestamp(row.created_at),
    createdByPrincipalId: opaqueIdSchema.parse(row.created_by_principal_id),
    enabled: readBoolean(row.enabled),
    event: z.literal("push").parse(row.event_name),
    idempotencyDigest: sha256DigestSchema.parse(row.idempotency_key_sha256),
    ignoredPaths: readPaths(row.ignored_paths_json),
    integrationId: opaqueIdSchema.parse(row.integration_id),
    organizationId: opaqueIdSchema.parse(row.organization_id),
    projectId: opaqueIdSchema.parse(row.project_id),
    repositoryId: readInteger(row.repository_id),
    selectedPaths: readPaths(row.selected_paths_json),
    subscriptionId: opaqueIdSchema.parse(row.subscription_id),
  };
}

const subscriptionColumns = `
  subscription_id, organization_id, project_id, integration_id,
  repository_id, branch_name, event_name, selected_paths_json,
  ignored_paths_json, enabled, idempotency_key_sha256,
  created_by_principal_id, created_at`;

export class PostgresGitHubRepositoryRefreshStore implements GitHubRepositoryRefreshStore {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async findActive(input: {
    readonly branch: string;
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<readonly GitHubRepositoryRefreshSubscription[]> {
    const result = await this.#database.query<RefreshSubscriptionRow>(
      sql(
        `SELECT ${subscriptionColumns}
           FROM (
             SELECT DISTINCT ON (organization_id, project_id, integration_id,
                                  repository_id, branch_name, event_name)
                    ${subscriptionColumns}
               FROM github_repository_import_refresh_subscriptions
              WHERE organization_id = $1 AND integration_id = $2
                AND repository_id = $3 AND branch_name = $4
                AND event_name = 'push'
              ORDER BY organization_id, project_id, integration_id,
                       repository_id, branch_name, event_name,
                       created_at DESC, subscription_id DESC
           ) latest
          WHERE enabled = TRUE`,
        [
          input.organizationId,
          input.integrationId,
          input.repositoryId,
          input.branch,
        ],
      ),
    );
    return result.rows.map(mapSubscription);
  }

  async reserve(subscription: GitHubRepositoryRefreshSubscription) {
    const result = await this.#database.query<RefreshSubscriptionRow>(
      sql(
        `INSERT INTO github_repository_import_refresh_subscriptions (
           subscription_id, organization_id, project_id, integration_id,
           repository_id, branch_name, event_name, selected_paths_json,
           ignored_paths_json, enabled, idempotency_key_sha256,
           created_by_principal_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (organization_id, project_id, idempotency_key_sha256)
         DO NOTHING
         RETURNING ${subscriptionColumns}`,
        [
          subscription.subscriptionId,
          subscription.organizationId,
          subscription.projectId,
          subscription.integrationId,
          subscription.repositoryId,
          subscription.branch,
          subscription.event,
          JSON.stringify(subscription.selectedPaths),
          JSON.stringify(subscription.ignoredPaths),
          subscription.enabled,
          subscription.idempotencyDigest,
          subscription.createdByPrincipalId,
          subscription.createdAt,
        ],
      ),
    );
    if (result.rows[0] !== undefined) {
      return { created: true, record: mapSubscription(result.rows[0]) };
    }
    const existing = await this.#database.query<RefreshSubscriptionRow>(
      sql(
        `SELECT ${subscriptionColumns}
           FROM github_repository_import_refresh_subscriptions
          WHERE organization_id = $1 AND project_id = $2
            AND idempotency_key_sha256 = $3`,
        [
          subscription.organizationId,
          subscription.projectId,
          subscription.idempotencyDigest,
        ],
      ),
    );
    const row = existing.rows[0];
    return row === undefined
      ? persistenceInvalid()
      : { created: false, record: mapSubscription(row) };
  }

  async saveReceipt(receipt: GitHubRepositoryRefreshReceipt): Promise<void> {
    await this.#database.query(
      sql(
        `INSERT INTO github_repository_import_webhook_receipts (
           delivery_id, organization_id, project_id, subscription_id,
           import_id, commit_sha, lifecycle_status, recorded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (delivery_id, subscription_id) DO NOTHING`,
        [
          receipt.deliveryId,
          receipt.organizationId,
          receipt.projectId,
          receipt.subscriptionId,
          receipt.importId ?? null,
          receipt.commitSha,
          receipt.state,
          receipt.recordedAt,
        ],
      ),
    );
  }
}
