import { randomUUID } from "node:crypto";

import { z } from "zod";

import { canonicalDigest } from "@cloudmarkup/github-repository-export";
import {
  GITHUB_REPOSITORY_EXPORT_LIMITS,
  gitHubExportPreviewSchema,
  gitHubExportReceiptSchema,
  gitHubShaSchema,
  gitHubInstallationRecordSchema,
  gitHubInstallationLinkIntentSchema,
  gitHubPreviousExportAuthorityV1Schema,
  gitHubRepositoryRecordSchema,
  type GitHubInstallationRecord,
  type GitHubInstallationLinkIntent,
  type GitHubPreviousExportAuthorityV1,
  type GitHubRepositoryRecord,
} from "@cloudmarkup/github-repository-export/contracts";
import { GITHUB_EXPORT_ERROR_CODES } from "@cloudmarkup/github-repository-export/errors";
import type {
  GitHubExportAuditEvent,
  GitHubExportAuditSink,
  GitHubExportProgressEvent,
  GitHubExportProgressSink,
  GitHubExportStore,
  GitHubPreviousExportAuthorityTarget,
  GitHubWebhookDeliveryRecord,
  StoredGitHubExportExecution,
  StoredGitHubExportPreview,
} from "@cloudmarkup/github-repository-export/ports";
import { sha256DigestSchema } from "@cloudmarkup/schemas";

import { RepositoryError } from "../../application/persistence.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const requestSchema = z
  .object({
    artifactId: opaqueIdSchema,
    baseBranch: z.string().min(1).max(255),
    destinationFolder: z.string().max(240),
    featureBranch: z.string().min(1).max(255),
    includeWorkflows: z.boolean(),
    integrationId: opaqueIdSchema,
    repositoryId: z.number().int().positive(),
  })
  .strict();
const executionStateSchema = z.enum([
  "running",
  "succeeded",
  "failed-transient",
  "failed-permanent",
]);
const executionFailureCodeSchema = z.enum(GITHUB_EXPORT_ERROR_CODES);
const webhookStateSchema = z.enum([
  "received",
  "processed",
  "ignored",
  "failed",
]);

interface InstallationRow extends SqlRow {
  readonly account_id: unknown;
  readonly account_login: unknown;
  readonly account_type: unknown;
  readonly contents_permission: unknown;
  readonly created_at: unknown;
  readonly installation_id: unknown;
  readonly integration_id: unknown;
  readonly lifecycle_status: unknown;
  readonly metadata_permission: unknown;
  readonly organization_id: unknown;
  readonly pull_requests_permission: unknown;
  readonly repository_selection: unknown;
  readonly updated_at: unknown;
  readonly workflows_permission: unknown;
}

interface InstallationLinkIntentRow extends SqlRow {
  readonly completed_installation_id: unknown;
  readonly completed_integration_id: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly intent_id: unknown;
  readonly lifecycle_status: unknown;
  readonly organization_id: unknown;
  readonly principal_id: unknown;
  readonly state_sha256: unknown;
}

interface RepositoryRow extends SqlRow {
  readonly default_branch: unknown;
  readonly installation_id: unknown;
  readonly integration_id: unknown;
  readonly is_archived: unknown;
  readonly is_disabled: unknown;
  readonly is_private: unknown;
  readonly node_id: unknown;
  readonly organization_id: unknown;
  readonly owner_login: unknown;
  readonly pushed_at: unknown;
  readonly repository_id: unknown;
  readonly repository_name: unknown;
  readonly updated_at: unknown;
}

interface PreviewRow extends SqlRow {
  readonly created_by_principal_id: unknown;
  readonly preview_json: unknown;
  readonly request_json: unknown;
}

interface ExecutionRow extends SqlRow {
  readonly authority_json: unknown;
  readonly artifact_sha256: unknown;
  readonly branch_created: unknown;
  readonly commit_sha: unknown;
  readonly created_by_principal_id: unknown;
  readonly execution_attempt_id: unknown;
  readonly execution_id: unknown;
  readonly failure_code: unknown;
  readonly idempotency_key_sha256: unknown;
  readonly lifecycle_status: unknown;
  readonly organization_id: unknown;
  readonly preview_id: unknown;
  readonly preview_sha256: unknown;
  readonly project_id: unknown;
  readonly record_version: unknown;
  readonly receipt_json: unknown;
  readonly updated_at: unknown;
}

interface WebhookRow extends SqlRow {
  readonly delivery_id: unknown;
  readonly event_name: unknown;
  readonly lifecycle_status: unknown;
  readonly payload_sha256: unknown;
  readonly processed_at: unknown;
  readonly received_at: unknown;
}

function persistenceInvalid(): never {
  throw new RepositoryError(
    "persistence-unavailable",
    "The GitHub export record could not be read safely.",
  );
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : persistenceInvalid();
}

function readOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : readString(value);
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

function readBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : persistenceInvalid();
}

function readOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return readInteger(value);
}

function readTimestamp(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : readString(value);
  const dataApi = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(
    text,
  );
  const parsed = new Date(dataApi ? `${text.replace(" ", "T")}Z` : text);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : persistenceInvalid();
}

function readOptionalTimestamp(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : readTimestamp(value);
}

function readJson<T>(value: unknown, schema: z.ZodType<T>): T {
  try {
    return schema.parse(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return persistenceInvalid();
  }
}

function assertId(value: string): void {
  opaqueIdSchema.parse(value);
}

function mapInstallation(row: InstallationRow): GitHubInstallationRecord {
  return gitHubInstallationRecordSchema.parse({
    accountId: readInteger(row.account_id),
    accountLogin: readString(row.account_login),
    accountType: readString(row.account_type),
    createdAt: readTimestamp(row.created_at),
    installationId: readInteger(row.installation_id),
    integrationId: readString(row.integration_id),
    organizationId: readString(row.organization_id),
    permissions: {
      contents: readString(row.contents_permission),
      metadata: readString(row.metadata_permission),
      pullRequests: readString(row.pull_requests_permission),
      workflows: readString(row.workflows_permission),
    },
    repositorySelection: readString(row.repository_selection),
    status: readString(row.lifecycle_status),
    updatedAt: readTimestamp(row.updated_at),
  });
}

function mapRepository(row: RepositoryRow): GitHubRepositoryRecord {
  return gitHubRepositoryRecordSchema.parse({
    archived: readBoolean(row.is_archived),
    defaultBranch: readString(row.default_branch),
    disabled: readBoolean(row.is_disabled),
    installationId: readInteger(row.installation_id),
    integrationId: readString(row.integration_id),
    name: readString(row.repository_name),
    nodeId: readString(row.node_id),
    organizationId: readString(row.organization_id),
    owner: readString(row.owner_login),
    private: readBoolean(row.is_private),
    pushedAt: readOptionalTimestamp(row.pushed_at) ?? null,
    repositoryId: readInteger(row.repository_id),
    updatedAt: readTimestamp(row.updated_at),
  });
}

function mapInstallationLinkIntent(
  row: InstallationLinkIntentRow,
): GitHubInstallationLinkIntent {
  const completedInstallationId = readOptionalInteger(
    row.completed_installation_id,
  );
  const completedIntegrationId = readOptionalString(
    row.completed_integration_id,
  );
  return gitHubInstallationLinkIntentSchema.parse({
    ...(completedInstallationId === undefined
      ? {}
      : { completedInstallationId }),
    ...(completedIntegrationId === undefined ? {} : { completedIntegrationId }),
    createdAt: readTimestamp(row.created_at),
    expiresAt: readTimestamp(row.expires_at),
    intentId: readString(row.intent_id),
    organizationId: readString(row.organization_id),
    principalId: readString(row.principal_id),
    state: readString(row.lifecycle_status),
    stateDigest: sha256DigestSchema.parse(readString(row.state_sha256)),
  });
}

function validateExecutionBindings(
  record: StoredGitHubExportExecution,
): StoredGitHubExportExecution {
  const succeeded = record.state === "succeeded";
  const failed =
    record.state === "failed-transient" || record.state === "failed-permanent";
  if (
    succeeded !== (record.receipt !== undefined) ||
    succeeded !== (record.authority !== undefined) ||
    failed !== (record.failureCode !== undefined) ||
    (succeeded && !record.branchCreated)
  ) {
    return persistenceInvalid();
  }
  if (
    record.receipt !== undefined &&
    (record.receipt.executionId !== record.executionId ||
      record.receipt.organizationId !== record.organizationId ||
      record.receipt.projectId !== record.projectId ||
      record.receipt.previewDigest !== record.previewDigest ||
      record.receipt.commitSha !== record.commitSha ||
      record.receipt.completedAt !== record.updatedAt)
  ) {
    return persistenceInvalid();
  }
  if (record.authority !== undefined) {
    const { authorityDigest, ...authorityPayload } = record.authority;
    const receipt = record.receipt;
    if (
      receipt === undefined ||
      record.authority.inventoryDigest !==
        canonicalDigest(record.authority.files) ||
      authorityDigest !== canonicalDigest(authorityPayload) ||
      record.authority.executionId !== record.executionId ||
      record.authority.organizationId !== record.organizationId ||
      record.authority.projectId !== record.projectId ||
      record.authority.previewDigest !== record.previewDigest ||
      record.authority.artifactDigest !== record.artifactDigest ||
      record.authority.commitSha !== record.commitSha ||
      record.authority.completedAt !== receipt.completedAt ||
      record.authority.pullRequestNumber !== receipt.pullRequestNumber ||
      record.authority.pullRequestUrl !== receipt.pullRequestUrl ||
      record.authority.repositoryId !== receipt.repositoryId ||
      record.authority.featureBranch !== receipt.branch
    ) {
      return persistenceInvalid();
    }
  }
  return record;
}

function validateExecutionRecord(
  record: StoredGitHubExportExecution,
): StoredGitHubExportExecution {
  assertId(record.createdByPrincipalId);
  assertId(record.executionId);
  assertId(record.organizationId);
  assertId(record.previewId);
  assertId(record.projectId);
  sha256DigestSchema.parse(record.artifactDigest);
  sha256DigestSchema.parse(record.idempotencyKeyDigest);
  sha256DigestSchema.parse(record.previewDigest);
  executionStateSchema.parse(record.state);
  if (!Number.isSafeInteger(record.recordVersion) || record.recordVersion < 1) {
    return persistenceInvalid();
  }
  readTimestamp(record.updatedAt);
  if (record.commitSha !== undefined) gitHubShaSchema.parse(record.commitSha);
  if (record.failureCode !== undefined) {
    executionFailureCodeSchema.parse(record.failureCode);
  }
  const receipt =
    record.receipt === undefined
      ? undefined
      : gitHubExportReceiptSchema.parse(record.receipt);
  const authority =
    record.authority === undefined
      ? undefined
      : gitHubPreviousExportAuthorityV1Schema.parse(record.authority);
  return validateExecutionBindings({
    ...record,
    ...(authority === undefined ? {} : { authority }),
    ...(receipt === undefined ? {} : { receipt }),
  });
}

function mapExecutionWithAttempt(row: ExecutionRow): {
  readonly attemptId: string;
  readonly record: StoredGitHubExportExecution;
} {
  const receipt =
    row.receipt_json === null || row.receipt_json === undefined
      ? undefined
      : readJson(row.receipt_json, gitHubExportReceiptSchema);
  const authority =
    row.authority_json === null || row.authority_json === undefined
      ? undefined
      : readJson(row.authority_json, gitHubPreviousExportAuthorityV1Schema);
  const failureCode =
    row.failure_code === null || row.failure_code === undefined
      ? undefined
      : executionFailureCodeSchema.parse(readString(row.failure_code));
  const commitSha = readOptionalString(row.commit_sha);
  const record = validateExecutionBindings({
    ...(authority === undefined ? {} : { authority }),
    artifactDigest: sha256DigestSchema.parse(readString(row.artifact_sha256)),
    branchCreated: readBoolean(row.branch_created),
    ...(commitSha === undefined ? {} : { commitSha }),
    createdByPrincipalId: readString(row.created_by_principal_id),
    executionId: readString(row.execution_id),
    ...(failureCode === undefined ? {} : { failureCode }),
    idempotencyKeyDigest: sha256DigestSchema.parse(
      readString(row.idempotency_key_sha256),
    ),
    organizationId: readString(row.organization_id),
    previewDigest: sha256DigestSchema.parse(readString(row.preview_sha256)),
    previewId: readString(row.preview_id),
    projectId: readString(row.project_id),
    ...(receipt === undefined ? {} : { receipt }),
    recordVersion: readInteger(row.record_version),
    state: executionStateSchema.parse(readString(row.lifecycle_status)),
    updatedAt: readTimestamp(row.updated_at),
  });
  return {
    attemptId: opaqueIdSchema.parse(readString(row.execution_attempt_id)),
    record,
  };
}

function mapExecution(row: ExecutionRow): StoredGitHubExportExecution {
  return mapExecutionWithAttempt(row).record;
}

function mapWebhook(row: WebhookRow): GitHubWebhookDeliveryRecord {
  const processedAt = readOptionalTimestamp(row.processed_at);
  return {
    deliveryId: readString(row.delivery_id),
    event: readString(row.event_name),
    payloadDigest: sha256DigestSchema.parse(readString(row.payload_sha256)),
    ...(processedAt === undefined ? {} : { processedAt }),
    receivedAt: readTimestamp(row.received_at),
    state: webhookStateSchema.parse(readString(row.lifecycle_status)),
  };
}

const installationColumns = `
  integration_id, organization_id, installation_id, account_id, account_login,
  account_type, repository_selection, contents_permission, metadata_permission,
  pull_requests_permission, workflows_permission, lifecycle_status, created_at,
  updated_at`;
const executionColumns = `
  execution_id, organization_id, project_id, preview_id,
  idempotency_key_sha256, artifact_sha256, preview_sha256,
  execution_attempt_id, record_version, lifecycle_status, failure_code,
  branch_created, commit_sha, receipt_json, authority_json,
  created_by_principal_id, updated_at`;
const installationLinkIntentColumns = `
  intent_id, organization_id, principal_id, state_sha256, lifecycle_status,
  completed_integration_id, completed_installation_id, created_at, expires_at`;

function installationUpsertStatement(
  record: GitHubInstallationRecord,
): SqlStatement {
  return sql(
    `INSERT INTO github_app_installations (
       integration_id, organization_id, installation_id, account_id,
       account_login, account_type, repository_selection,
       contents_permission, metadata_permission, pull_requests_permission,
       workflows_permission, lifecycle_status, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (integration_id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       account_login = EXCLUDED.account_login,
       account_type = EXCLUDED.account_type,
       repository_selection = EXCLUDED.repository_selection,
       contents_permission = EXCLUDED.contents_permission,
       metadata_permission = EXCLUDED.metadata_permission,
       pull_requests_permission = EXCLUDED.pull_requests_permission,
       workflows_permission = EXCLUDED.workflows_permission,
       lifecycle_status = EXCLUDED.lifecycle_status,
       updated_at = EXCLUDED.updated_at,
       record_version = github_app_installations.record_version + 1
     WHERE github_app_installations.organization_id = EXCLUDED.organization_id
       AND github_app_installations.installation_id = EXCLUDED.installation_id`,
    [
      record.integrationId,
      record.organizationId,
      record.installationId,
      record.accountId,
      record.accountLogin,
      record.accountType,
      record.repositorySelection,
      record.permissions.contents,
      record.permissions.metadata,
      record.permissions.pullRequests,
      record.permissions.workflows,
      record.status,
      record.createdAt,
      record.updatedAt,
    ],
  );
}

export class PostgresGitHubExportStore implements GitHubExportStore {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async getExecutionByIdempotency(input: {
    readonly idempotencyKeyDigest: StoredGitHubExportExecution["idempotencyKeyDigest"];
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubExportExecution | null> {
    const result = await this.#database.query<ExecutionRow>(
      sql(
        `SELECT ${executionColumns}
           FROM github_repository_export_executions
          WHERE organization_id = $1 AND project_id = $2
            AND idempotency_key_sha256 = $3`,
        [input.organizationId, input.projectId, input.idempotencyKeyDigest],
      ),
    );
    return result.rows[0] === undefined ? null : mapExecution(result.rows[0]);
  }

  async finalizeInstallationLink(input: {
    readonly installation: GitHubInstallationRecord;
    readonly intentId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: GitHubInstallationLinkIntent["stateDigest"];
  }): Promise<void> {
    const installation = gitHubInstallationRecordSchema.parse(
      input.installation,
    );
    if (installation.organizationId !== input.organizationId) {
      persistenceInvalid();
    }
    await this.#database.transaction(async (transaction) => {
      const locked = await transaction.query<InstallationLinkIntentRow>(
        sql(
          `SELECT ${installationLinkIntentColumns}
             FROM github_app_installation_link_intents
            WHERE intent_id = $1 AND organization_id = $2
              AND principal_id = $3 AND state_sha256 = $4
              AND lifecycle_status = 'consumed' AND expires_at > $5
            FOR UPDATE`,
          [
            input.intentId,
            input.organizationId,
            input.principalId,
            input.stateDigest,
            input.now,
          ],
        ),
      );
      if (locked.rowCount !== 1 || locked.rows[0] === undefined) {
        persistenceInvalid();
      }
      const saved = await transaction.query(
        installationUpsertStatement(installation),
      );
      if (saved.rowCount !== 1) persistenceInvalid();
      const completed = await transaction.query(
        sql(
          `UPDATE github_app_installation_link_intents
              SET lifecycle_status = 'completed',
                  completed_integration_id = $6,
                  completed_installation_id = $7,
                  completed_at = $5
            WHERE intent_id = $1 AND organization_id = $2
              AND principal_id = $3 AND state_sha256 = $4
              AND lifecycle_status = 'consumed' AND expires_at > $5
              AND completed_integration_id IS NULL
              AND completed_installation_id IS NULL`,
          [
            input.intentId,
            input.organizationId,
            input.principalId,
            input.stateDigest,
            input.now,
            installation.integrationId,
            installation.installationId,
          ],
        ),
      );
      if (completed.rowCount !== 1) persistenceInvalid();
    });
  }

  async consumeInstallationLinkIntent(input: {
    readonly intentId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: GitHubInstallationLinkIntent["stateDigest"];
  }): Promise<
    | {
        readonly outcome: "consumed";
        readonly record: GitHubInstallationLinkIntent;
      }
    | {
        readonly outcome: "completed";
        readonly record: GitHubInstallationLinkIntent;
      }
    | { readonly outcome: "expired" | "invalid" | "replayed" }
  > {
    return this.#database.transaction(async (transaction) => {
      const claimed = await transaction.query<InstallationLinkIntentRow>(
        sql(
          `UPDATE github_app_installation_link_intents
              SET lifecycle_status = 'consumed', consumed_at = $6
            WHERE intent_id = $1 AND organization_id = $2 AND principal_id = $3
              AND state_sha256 = $4 AND lifecycle_status = 'pending'
              AND expires_at > $5
            RETURNING ${installationLinkIntentColumns}`,
          [
            input.intentId,
            input.organizationId,
            input.principalId,
            input.stateDigest,
            input.now,
            input.now,
          ],
        ),
      );
      if (claimed.rows[0] !== undefined) {
        return {
          outcome: "consumed" as const,
          record: mapInstallationLinkIntent(claimed.rows[0]),
        };
      }
      const existing = await transaction.query<InstallationLinkIntentRow>(
        sql(
          `SELECT ${installationLinkIntentColumns}
             FROM github_app_installation_link_intents
            WHERE intent_id = $1
            FOR UPDATE`,
          [input.intentId],
        ),
      );
      const row = existing.rows[0];
      if (row === undefined) return { outcome: "invalid" as const };
      const record = mapInstallationLinkIntent(row);
      if (
        record.organizationId !== input.organizationId ||
        record.principalId !== input.principalId ||
        record.stateDigest !== input.stateDigest
      ) {
        return { outcome: "invalid" as const };
      }
      if (record.state === "completed") {
        return { outcome: "completed" as const, record };
      }
      if (
        record.state === "pending" &&
        Date.parse(record.expiresAt) <= Date.parse(input.now)
      ) {
        return { outcome: "expired" as const };
      }
      return { outcome: "replayed" as const };
    });
  }

  async releaseInstallationLinkIntent(input: {
    readonly intentId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: GitHubInstallationLinkIntent["stateDigest"];
  }): Promise<"completed" | "expired" | "invalid" | "released"> {
    return this.#database.transaction(async (transaction) => {
      const released = await transaction.query<InstallationLinkIntentRow>(
        sql(
          `UPDATE github_app_installation_link_intents
              SET lifecycle_status = 'pending', consumed_at = NULL
            WHERE intent_id = $1 AND organization_id = $2
              AND principal_id = $3 AND state_sha256 = $4
              AND lifecycle_status = 'consumed' AND expires_at > $5
            RETURNING ${installationLinkIntentColumns}`,
          [
            input.intentId,
            input.organizationId,
            input.principalId,
            input.stateDigest,
            input.now,
          ],
        ),
      );
      if (released.rows[0] !== undefined) return "released" as const;
      const existing = await transaction.query<InstallationLinkIntentRow>(
        sql(
          `SELECT ${installationLinkIntentColumns}
             FROM github_app_installation_link_intents
            WHERE intent_id = $1
            FOR UPDATE`,
          [input.intentId],
        ),
      );
      const row = existing.rows[0];
      if (row === undefined) return "invalid" as const;
      const record = mapInstallationLinkIntent(row);
      if (
        record.organizationId !== input.organizationId ||
        record.principalId !== input.principalId ||
        record.stateDigest !== input.stateDigest
      ) {
        return "invalid" as const;
      }
      if (record.state === "completed") return "completed" as const;
      if (Date.parse(record.expiresAt) <= Date.parse(input.now)) {
        return "expired" as const;
      }
      return record.state === "pending"
        ? ("released" as const)
        : ("invalid" as const);
    });
  }

  async reserveInstallationLinkIntent(
    record: GitHubInstallationLinkIntent,
  ): Promise<{
    readonly created: boolean;
    readonly record: GitHubInstallationLinkIntent;
  }> {
    const validated = gitHubInstallationLinkIntentSchema.parse(record);
    if (validated.state !== "pending") persistenceInvalid();
    const inserted = await this.#database.query<InstallationLinkIntentRow>(
      sql(
        `INSERT INTO github_app_installation_link_intents (
           intent_id, organization_id, principal_id, state_sha256,
           lifecycle_status, created_at, expires_at
         ) VALUES ($1,$2,$3,$4,'pending',$5,$6)
         ON CONFLICT DO NOTHING
         RETURNING ${installationLinkIntentColumns}`,
        [
          validated.intentId,
          validated.organizationId,
          validated.principalId,
          validated.stateDigest,
          validated.createdAt,
          validated.expiresAt,
        ],
      ),
    );
    const row = inserted.rows[0];
    return row === undefined
      ? { created: false, record: validated }
      : { created: true, record: mapInstallationLinkIntent(row) };
  }

  async getInstallation(input: {
    readonly integrationId: string;
    readonly organizationId: string;
  }): Promise<GitHubInstallationRecord | null> {
    const result = await this.#database.query<InstallationRow>(
      sql(
        `SELECT ${installationColumns}
           FROM github_app_installations
          WHERE organization_id = $1 AND integration_id = $2`,
        [input.organizationId, input.integrationId],
      ),
    );
    return result.rows[0] === undefined
      ? null
      : mapInstallation(result.rows[0]);
  }

  async getInstallationByInstallationId(
    installationId: number,
  ): Promise<GitHubInstallationRecord | null> {
    const result = await this.#database.query<InstallationRow>(
      sql(
        `SELECT ${installationColumns}
           FROM github_app_installations
          WHERE installation_id = $1`,
        [installationId],
      ),
    );
    return result.rows[0] === undefined
      ? null
      : mapInstallation(result.rows[0]);
  }

  async listInstallations(input: {
    readonly organizationId: string;
  }): Promise<readonly GitHubInstallationRecord[]> {
    const result = await this.#database.query<InstallationRow>(
      sql(
        `SELECT ${installationColumns}
           FROM github_app_installations
          WHERE organization_id = $1
          ORDER BY account_login ASC, integration_id ASC`,
        [input.organizationId],
      ),
    );
    return result.rows.map(mapInstallation);
  }

  async getPreview(input: {
    readonly organizationId: string;
    readonly previewId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubExportPreview | null> {
    const result = await this.#database.query<PreviewRow>(
      sql(
        `SELECT request_json, preview_json, created_by_principal_id
           FROM github_repository_export_previews
          WHERE organization_id = $1 AND project_id = $2 AND preview_id = $3`,
        [input.organizationId, input.projectId, input.previewId],
      ),
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          createdByPrincipalId: readString(row.created_by_principal_id),
          preview: readJson(row.preview_json, gitHubExportPreviewSchema),
          request: readJson(row.request_json, requestSchema),
        };
  }

  async getRepository(input: {
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<GitHubRepositoryRecord | null> {
    const result = await this.#database.query<RepositoryRow>(
      sql(
        `SELECT organization_id, integration_id, installation_id, repository_id,
                node_id, owner_login, repository_name, default_branch, is_private,
                is_archived, is_disabled, pushed_at, updated_at
           FROM github_app_repositories
          WHERE organization_id = $1 AND integration_id = $2 AND repository_id = $3
            AND lifecycle_status = 'active'`,
        [input.organizationId, input.integrationId, input.repositoryId],
      ),
    );
    return result.rows[0] === undefined ? null : mapRepository(result.rows[0]);
  }

  async findLatestPreviousExportAuthority(
    input: GitHubPreviousExportAuthorityTarget,
  ): Promise<GitHubPreviousExportAuthorityV1 | null> {
    const result = await this.#database.query<ExecutionRow>(
      sql(
        `SELECT ${executionColumns}
           FROM github_repository_export_executions
          WHERE organization_id = $1 AND project_id = $2
            AND lifecycle_status = 'succeeded'
            AND receipt_json IS NOT NULL AND authority_json IS NOT NULL
            AND authority_json ->> 'organizationId' = $1
            AND authority_json ->> 'projectId' = $2
            AND authority_json ->> 'integrationId' = $3
            AND authority_json ->> 'installationId' = $4
            AND authority_json ->> 'repositoryId' = $5
            AND authority_json ->> 'repositoryOwnerId' = $6
            AND authority_json ->> 'baseBranch' = $7
            AND authority_json ->> 'destinationFolder' = $8
          ORDER BY authority_json ->> 'completedAt' DESC, execution_id DESC
          LIMIT 1`,
        [
          input.organizationId,
          input.projectId,
          input.integrationId,
          String(input.installationId),
          String(input.repositoryId),
          String(input.repositoryOwnerId),
          input.baseBranch,
          input.destinationFolder,
        ],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const authority = mapExecution(row).authority;
    return authority ?? persistenceInvalid();
  }

  async getPreviousExportAuthority(input: {
    readonly authorityId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<GitHubPreviousExportAuthorityV1 | null> {
    const result = await this.#database.query<ExecutionRow>(
      sql(
        `SELECT ${executionColumns}
           FROM github_repository_export_executions
          WHERE organization_id = $1 AND project_id = $2
            AND execution_id = $3 AND lifecycle_status = 'succeeded'
            AND receipt_json IS NOT NULL AND authority_json IS NOT NULL`,
        [input.organizationId, input.projectId, input.authorityId],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const authority = mapExecution(row).authority;
    return authority ?? persistenceInvalid();
  }

  async reserveExecution(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubExportExecution;
  }): ReturnType<GitHubExportStore["reserveExecution"]> {
    const record = validateExecutionRecord(input.record);
    const attemptId = opaqueIdSchema.parse(input.attemptId);
    if (record.state !== "running" || record.recordVersion !== 1) {
      return persistenceInvalid();
    }
    return this.#database.transaction(async (transaction) => {
      const inserted = await transaction.query<ExecutionRow>(
        sql(
          `INSERT INTO github_repository_export_executions (
             execution_id, organization_id, project_id, preview_id,
             idempotency_key_sha256, artifact_sha256, preview_sha256,
             execution_attempt_id, record_version, lifecycle_status,
             failure_code, branch_created, commit_sha, receipt_json,
             authority_json, created_by_principal_id, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (organization_id, project_id, idempotency_key_sha256)
           DO NOTHING
           RETURNING ${executionColumns}`,
          [
            record.executionId,
            record.organizationId,
            record.projectId,
            record.previewId,
            record.idempotencyKeyDigest,
            record.artifactDigest,
            record.previewDigest,
            attemptId,
            record.recordVersion,
            record.state,
            null,
            record.branchCreated,
            record.commitSha ?? null,
            null,
            null,
            record.createdByPrincipalId,
            record.updatedAt,
          ],
        ),
      );
      if (inserted.rows[0] !== undefined) {
        return {
          outcome: "acquired" as const,
          record: mapExecution(inserted.rows[0]),
        };
      }
      const existing = await transaction.query<ExecutionRow>(
        sql(
          `SELECT ${executionColumns}
             FROM github_repository_export_executions
            WHERE organization_id = $1 AND project_id = $2
              AND idempotency_key_sha256 = $3
            FOR UPDATE`,
          [
            record.organizationId,
            record.projectId,
            record.idempotencyKeyDigest,
          ],
        ),
      );
      const replay = existing.rows[0];
      if (replay === undefined) persistenceInvalid();
      const canonical = mapExecutionWithAttempt(replay);
      if (
        canonical.record.previewId !== record.previewId ||
        canonical.record.previewDigest !== record.previewDigest ||
        canonical.record.artifactDigest !== record.artifactDigest ||
        canonical.record.createdByPrincipalId !== record.createdByPrincipalId
      ) {
        return { outcome: "conflict" as const, record: canonical.record };
      }
      if (canonical.record.state === "running") {
        return { outcome: "in-progress" as const, record: canonical.record };
      }
      if (
        canonical.record.state === "succeeded" ||
        canonical.record.state === "failed-permanent"
      ) {
        return { outcome: "terminal" as const, record: canonical.record };
      }
      if (canonical.attemptId === attemptId) {
        return { outcome: "conflict" as const, record: canonical.record };
      }
      const reclaimed = await transaction.query<ExecutionRow>(
        sql(
          `UPDATE github_repository_export_executions
              SET execution_attempt_id = $4,
                  record_version = record_version + 1,
                  lifecycle_status = 'running', failure_code = NULL,
                  receipt_json = NULL, authority_json = NULL, updated_at = $5
            WHERE organization_id = $1 AND project_id = $2
              AND idempotency_key_sha256 = $3
              AND execution_id = $6 AND execution_attempt_id = $7
              AND record_version = $8
              AND lifecycle_status = 'failed-transient'
            RETURNING ${executionColumns}`,
          [
            record.organizationId,
            record.projectId,
            record.idempotencyKeyDigest,
            attemptId,
            record.updatedAt,
            canonical.record.executionId,
            canonical.attemptId,
            canonical.record.recordVersion,
          ],
        ),
      );
      const claimed = reclaimed.rows[0];
      if (claimed === undefined || reclaimed.rowCount !== 1) {
        return persistenceInvalid();
      }
      return { outcome: "acquired" as const, record: mapExecution(claimed) };
    });
  }

  async reserveWebhookDelivery(record: GitHubWebhookDeliveryRecord): Promise<{
    readonly created: boolean;
    readonly record: GitHubWebhookDeliveryRecord;
  }> {
    return this.#database.transaction(async (transaction) => {
      const replayExpiresAt = new Date(
        Date.parse(record.receivedAt) +
          GITHUB_REPOSITORY_EXPORT_LIMITS.webhookReplaySeconds * 1_000,
      ).toISOString();
      const inserted = await transaction.query<WebhookRow>(
        sql(
          `INSERT INTO github_webhook_deliveries (
             delivery_id, event_name, payload_sha256, lifecycle_status,
             received_at, processed_at, replay_expires_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (delivery_id) DO NOTHING
           RETURNING delivery_id, event_name, payload_sha256, lifecycle_status,
                     received_at, processed_at`,
          [
            record.deliveryId,
            record.event,
            record.payloadDigest,
            record.state,
            record.receivedAt,
            record.processedAt ?? null,
            replayExpiresAt,
          ],
        ),
      );
      if (inserted.rows[0] !== undefined) {
        return { created: true, record: mapWebhook(inserted.rows[0]) };
      }
      const existing = await transaction.query<WebhookRow>(
        sql(
          `SELECT delivery_id, event_name, payload_sha256, lifecycle_status,
                  received_at, processed_at
             FROM github_webhook_deliveries
            WHERE delivery_id = $1
            FOR UPDATE`,
          [record.deliveryId],
        ),
      );
      const replay = existing.rows[0];
      if (replay === undefined) persistenceInvalid();
      const mapped = mapWebhook(replay);
      if (
        mapped.state === "failed" &&
        mapped.event === record.event &&
        mapped.payloadDigest === record.payloadDigest
      ) {
        const reclaimed = await transaction.query<WebhookRow>(
          sql(
            `UPDATE github_webhook_deliveries
                SET lifecycle_status = 'received', processed_at = NULL
              WHERE delivery_id = $1 AND event_name = $2
                AND payload_sha256 = $3 AND lifecycle_status = 'failed'
              RETURNING delivery_id, event_name, payload_sha256,
                        lifecycle_status, received_at, processed_at`,
            [record.deliveryId, record.event, record.payloadDigest],
          ),
        );
        const claimed = reclaimed.rows[0];
        if (claimed === undefined || reclaimed.rowCount !== 1) {
          persistenceInvalid();
        }
        return { created: true, record: mapWebhook(claimed) };
      }
      return { created: false, record: mapped };
    });
  }

  async saveExecution(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubExportExecution;
  }): ReturnType<GitHubExportStore["saveExecution"]> {
    const record = validateExecutionRecord(input.record);
    const attemptId = opaqueIdSchema.parse(input.attemptId);
    return this.#database.transaction(async (transaction) => {
      const saved = await transaction.query<ExecutionRow>(
        sql(
          `UPDATE github_repository_export_executions
              SET lifecycle_status = $4, failure_code = $5,
                  branch_created = $6, commit_sha = $7, receipt_json = $8,
                  authority_json = $9, updated_at = $10,
                  record_version = record_version + 1
            WHERE organization_id = $1 AND project_id = $2 AND execution_id = $3
              AND preview_id = $11 AND idempotency_key_sha256 = $12
              AND artifact_sha256 = $13 AND preview_sha256 = $14
              AND created_by_principal_id = $15
              AND execution_attempt_id = $16 AND record_version = $17
              AND lifecycle_status = 'running'
            RETURNING ${executionColumns}`,
          [
            record.organizationId,
            record.projectId,
            record.executionId,
            record.state,
            record.failureCode ?? null,
            record.branchCreated,
            record.commitSha ?? null,
            record.receipt === undefined
              ? null
              : JSON.stringify(record.receipt),
            record.authority === undefined
              ? null
              : JSON.stringify(record.authority),
            record.updatedAt,
            record.previewId,
            record.idempotencyKeyDigest,
            record.artifactDigest,
            record.previewDigest,
            record.createdByPrincipalId,
            attemptId,
            record.recordVersion,
          ],
        ),
      );
      const updated = saved.rows[0];
      if (updated !== undefined && saved.rowCount === 1) {
        return { outcome: "saved" as const, record: mapExecution(updated) };
      }
      const existing = await transaction.query<ExecutionRow>(
        sql(
          `SELECT ${executionColumns}
             FROM github_repository_export_executions
            WHERE organization_id = $1 AND project_id = $2
              AND idempotency_key_sha256 = $3`,
          [
            record.organizationId,
            record.projectId,
            record.idempotencyKeyDigest,
          ],
        ),
      );
      const canonical = existing.rows[0];
      if (canonical === undefined) return persistenceInvalid();
      return { outcome: "stale" as const, record: mapExecution(canonical) };
    });
  }

  async saveInstallation(record: GitHubInstallationRecord): Promise<void> {
    const validated = gitHubInstallationRecordSchema.parse(record);
    const result = await this.#database.query(
      installationUpsertStatement(validated),
    );
    if (result.rowCount !== 1) persistenceInvalid();
  }

  async savePreview(record: StoredGitHubExportPreview): Promise<void> {
    const preview = gitHubExportPreviewSchema.parse(record.preview);
    requestSchema.parse(record.request);
    const result = await this.#database.query(
      sql(
        `INSERT INTO github_repository_export_previews (
           preview_id, organization_id, project_id, integration_id,
           repository_id, solution_export_artifact_id, artifact_sha256,
           base_commit_sha, snapshot_sha256, preview_sha256, request_json,
           preview_json, created_by_principal_id, created_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (preview_id) DO NOTHING`,
        [
          preview.previewId,
          preview.organizationId,
          preview.projectId,
          preview.integrationId,
          preview.repositoryId,
          preview.artifactId,
          preview.artifactDigest,
          preview.baseCommitSha,
          preview.snapshotDigest,
          preview.previewDigest,
          JSON.stringify(record.request),
          JSON.stringify(preview),
          record.createdByPrincipalId,
          preview.createdAt,
          preview.expiresAt,
        ],
      ),
    );
    if (result.rowCount !== 1) persistenceInvalid();
  }

  async saveRepositories(input: {
    readonly integrationId: string;
    readonly installationId: number;
    readonly organizationId: string;
    readonly repositories: readonly GitHubRepositoryRecord[];
  }): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      for (const candidate of input.repositories) {
        const repository = gitHubRepositoryRecordSchema.parse(candidate);
        if (
          repository.organizationId !== input.organizationId ||
          repository.integrationId !== input.integrationId ||
          repository.installationId !== input.installationId
        ) {
          persistenceInvalid();
        }
        await transaction.query(
          sql(
            `INSERT INTO github_app_repositories (
               organization_id, integration_id, installation_id, repository_id,
               node_id, owner_login, repository_name, default_branch, is_private,
               is_archived, is_disabled, lifecycle_status, pushed_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13)
             ON CONFLICT (organization_id, integration_id, repository_id)
             DO UPDATE SET
               installation_id = EXCLUDED.installation_id,
               node_id = EXCLUDED.node_id,
               owner_login = EXCLUDED.owner_login,
               repository_name = EXCLUDED.repository_name,
               default_branch = EXCLUDED.default_branch,
               is_private = EXCLUDED.is_private,
               is_archived = EXCLUDED.is_archived,
               is_disabled = EXCLUDED.is_disabled,
               lifecycle_status = 'active',
               pushed_at = EXCLUDED.pushed_at,
               updated_at = EXCLUDED.updated_at`,
            [
              repository.organizationId,
              repository.integrationId,
              repository.installationId,
              repository.repositoryId,
              repository.nodeId,
              repository.owner,
              repository.name,
              repository.defaultBranch,
              repository.private,
              repository.archived,
              repository.disabled,
              repository.pushedAt,
              repository.updatedAt,
            ],
          ),
        );
      }
    });
  }

  async updateInstallationStatus(input: {
    readonly installationId: number;
    readonly status: GitHubInstallationRecord["status"];
    readonly updatedAt: string;
  }): Promise<void> {
    await this.#database.query(
      sql(
        `UPDATE github_app_installations
            SET lifecycle_status = $2, updated_at = $3,
                record_version = record_version + 1
          WHERE installation_id = $1`,
        [input.installationId, input.status, input.updatedAt],
      ),
    );
  }

  async updateRepositoryLifecycle(input: {
    readonly installationId: number;
    readonly repositoryId: number;
    readonly state: "deleted" | "transferred";
    readonly updatedAt: string;
  }): Promise<void> {
    await this.#database.query(
      sql(
        `UPDATE github_app_repositories
            SET lifecycle_status = $3, is_disabled = TRUE, updated_at = $4
          WHERE installation_id = $1 AND repository_id = $2`,
        [
          input.installationId,
          input.repositoryId,
          input.state,
          input.updatedAt,
        ],
      ),
    );
  }

  async updateWebhookDelivery(
    record: GitHubWebhookDeliveryRecord,
  ): Promise<void> {
    const result = await this.#database.query(
      sql(
        `UPDATE github_webhook_deliveries
            SET lifecycle_status = $2, processed_at = $3
          WHERE delivery_id = $1 AND event_name = $4 AND payload_sha256 = $5`,
        [
          record.deliveryId,
          record.state,
          record.processedAt ?? null,
          record.event,
          record.payloadDigest,
        ],
      ),
    );
    if (result.rowCount !== 1) persistenceInvalid();
  }
}

export class PostgresGitHubExportAuditSink implements GitHubExportAuditSink {
  readonly #database: SqlDatabase;
  readonly #idFactory: () => string;

  constructor(
    database: SqlDatabase,
    idFactory = () => `audit_${randomUUID()}`,
  ) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  async record(event: GitHubExportAuditEvent): Promise<void> {
    if (event.organizationId === undefined) return;
    assertId(event.organizationId);
    await this.#database.query(
      sql(
        `INSERT INTO audit_events (
           audit_event_id, organization_id, actor_principal_id, action,
           target_kind, target_id, outcome, safe_summary, correlation_id,
           occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          this.#idFactory(),
          event.organizationId,
          event.principalId ?? null,
          event.action,
          event.targetKind,
          event.targetId ?? null,
          event.outcome,
          event.summary,
          event.correlationId,
          event.occurredAt,
        ],
      ),
    );
  }
}

export class PostgresGitHubExportProgressSink implements GitHubExportProgressSink {
  readonly #database: SqlDatabase;
  readonly #idFactory: () => string;

  constructor(
    database: SqlDatabase,
    idFactory = () => `progress_${randomUUID()}`,
  ) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  async record(event: GitHubExportProgressEvent): Promise<void> {
    await this.#database.query(
      sql(
        `INSERT INTO github_repository_export_progress_events (
           progress_event_id, organization_id, project_id, execution_id,
           stage, lifecycle_status, safe_message, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          this.#idFactory(),
          event.organizationId,
          event.projectId ?? null,
          event.executionId ?? null,
          event.stage,
          event.state,
          event.message,
          event.at,
        ],
      ),
    );
  }
}
