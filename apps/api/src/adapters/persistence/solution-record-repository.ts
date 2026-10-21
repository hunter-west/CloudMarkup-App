import { createHash } from "node:crypto";

import type {
  AuthorizedOrganizationScope,
  StoredObjectReference,
} from "../../application/persistence.js";
import { RepositoryError } from "../../application/persistence.js";
import {
  isSolutionRecordKind,
  type CreateSolutionRecordInput,
  type ListSolutionRecordsInput,
  type SolutionRecordMetadata,
  type SolutionRecordRepository,
} from "../../application/solution-record-persistence.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";
import { parseDatabaseTimestamp } from "./database-timestamp.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const operationName = "solution-records.create";

interface SolutionRecordRow extends SqlRow {
  readonly architecture_revision_id: unknown;
  readonly content_object_id: unknown;
  readonly content_sha256: unknown;
  readonly contract_version: unknown;
  readonly created_at: unknown;
  readonly created_by_principal_id: unknown;
  readonly organization_id: unknown;
  readonly previous_solution_record_id: unknown;
  readonly project_id: unknown;
  readonly record_kind: unknown;
  readonly solution_record_id: unknown;
  readonly subject_id: unknown;
}

interface IdempotencyRow extends SqlRow {
  readonly lifecycle_status: unknown;
  readonly principal_id: unknown;
  readonly request_sha256: unknown;
  readonly resource_id: unknown;
  readonly resource_kind: unknown;
}

interface ObjectRow extends SqlRow {
  readonly content_sha256: unknown;
  readonly entity_tag: unknown;
  readonly lifecycle_state: unknown;
  readonly media_type: unknown;
  readonly object_id: unknown;
  readonly object_purpose: unknown;
  readonly object_version: unknown;
  readonly organization_id: unknown;
  readonly project_id: unknown;
  readonly size_bytes: unknown;
  readonly storage_key: unknown;
  readonly storage_provider: unknown;
}

function invalidInput(): never {
  throw new RepositoryError("invalid-input", "The request is invalid.");
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : invalidInput();
}

function readOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : readString(value);
}

function readPositiveInteger(value: unknown): number {
  const parsed =
    typeof value === "bigint" ||
    (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value))
      ? Number(value)
      : value;
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed > 0
    ? parsed
    : invalidInput();
}

function readNonNegativeInteger(value: unknown): number {
  const parsed =
    typeof value === "bigint" ||
    (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value))
      ? Number(value)
      : value;
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : invalidInput();
}

function readTimestamp(value: unknown): string {
  return parseDatabaseTimestamp(value) ?? invalidInput();
}

function assertIdentifier(value: string): void {
  if (!opaqueIdPattern.test(value)) {
    invalidInput();
  }
}

function assertSha256(value: string): void {
  if (!sha256Pattern.test(value)) {
    invalidInput();
  }
}

function assertScope(
  scope: AuthorizedOrganizationScope,
  permission: "projects.mutate" | "projects.read" | "revisions.create",
): void {
  assertIdentifier(scope.organizationId);
  assertIdentifier(scope.membershipId);
  assertIdentifier(scope.principalId);
  if (!scope.capabilities.includes(permission)) {
    throw new RepositoryError(
      "access-denied",
      "This action is not available for the current account.",
    );
  }
}

function assertCreateInput(
  scope: AuthorizedOrganizationScope,
  input: CreateSolutionRecordInput,
  object: StoredObjectReference,
): void {
  assertScope(scope, "projects.mutate");
  assertIdentifier(input.projectId);
  assertIdentifier(input.solutionRecordId);
  assertIdentifier(input.subjectId);
  assertSha256(input.contentSha256);
  assertSha256(input.requestSha256);
  if (
    !isSolutionRecordKind(input.recordKind) ||
    !Number.isSafeInteger(input.contractVersion) ||
    input.contractVersion < 1 ||
    input.idempotencyKey.length < 1 ||
    input.idempotencyKey.length > 512 ||
    object.owner.organizationId !== scope.organizationId ||
    object.owner.projectId !== input.projectId ||
    object.purpose !== input.recordKind ||
    object.contentSha256 !== input.contentSha256
  ) {
    invalidInput();
  }
  if (input.architectureRevisionId !== undefined) {
    assertIdentifier(input.architectureRevisionId);
  }
  if (input.previousSolutionRecordId !== undefined) {
    assertIdentifier(input.previousSolutionRecordId);
    if (input.previousSolutionRecordId === input.solutionRecordId) {
      invalidInput();
    }
  }
  if (
    input.recordKind === "solution-revision-manifest" &&
    (input.architectureRevisionId === undefined ||
      input.previousSolutionRecordId !== undefined)
  ) {
    invalidInput();
  }
}

function mapSolutionRecord(row: SolutionRecordRow): SolutionRecordMetadata {
  const recordKind = readString(row.record_kind);
  if (!isSolutionRecordKind(recordKind)) {
    return invalidInput();
  }
  const architectureRevisionId = readOptionalString(
    row.architecture_revision_id,
  );
  const previousSolutionRecordId = readOptionalString(
    row.previous_solution_record_id,
  );
  return {
    ...(architectureRevisionId === undefined ? {} : { architectureRevisionId }),
    contentObjectId: readString(row.content_object_id),
    contentSha256: readString(row.content_sha256),
    contractVersion: readPositiveInteger(row.contract_version),
    createdAt: readTimestamp(row.created_at),
    createdByPrincipalId: readString(row.created_by_principal_id),
    organizationId: readString(row.organization_id),
    ...(previousSolutionRecordId === undefined
      ? {}
      : { previousSolutionRecordId }),
    projectId: readString(row.project_id),
    recordKind,
    solutionRecordId: readString(row.solution_record_id),
    subjectId: readString(row.subject_id),
  };
}

async function requireActiveMembershipScope(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
): Promise<void> {
  const result = await executor.query(
    sql(
      `SELECT 1
       FROM memberships m
       WHERE m.membership_id = $1
         AND m.principal_id = $2
         AND m.organization_id = $3
         AND m.lifecycle_status = 'active'`,
      [scope.membershipId, scope.principalId, scope.organizationId],
    ),
  );
  if (result.rows[0] === undefined) {
    throw new RepositoryError(
      "not-found",
      "The requested project was not found.",
    );
  }
}

async function requireActiveProject(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  projectId: string,
): Promise<void> {
  const result = await executor.query(
    sql(
      `SELECT 1
       FROM projects p
       WHERE p.organization_id = $1
         AND p.project_id = $2
         AND p.lifecycle_status = 'active'`,
      [scope.organizationId, projectId],
    ),
  );
  if (result.rows[0] === undefined) {
    throw new RepositoryError(
      "not-found",
      "The requested project was not found.",
    );
  }
}

async function acquireIdempotency(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  input: CreateSolutionRecordInput,
): Promise<string | undefined> {
  const keySha256 = createHash("sha256")
    .update(input.idempotencyKey, "utf8")
    .digest("hex");
  const inserted = await executor.query(
    sql(
      `INSERT INTO idempotency_records (
         organization_id, operation_name, idempotency_key_sha256,
         request_sha256, principal_id, resource_kind, resource_id
       ) VALUES ($1, $2, $3, $4, $5, 'solution-record', $6)
       ON CONFLICT DO NOTHING
       RETURNING resource_id`,
      [
        scope.organizationId,
        operationName,
        keySha256,
        input.requestSha256,
        scope.principalId,
        input.solutionRecordId,
      ],
    ),
  );
  if (inserted.rows[0] !== undefined) {
    return undefined;
  }

  const existing = await executor.query<IdempotencyRow>(
    sql(
      `SELECT request_sha256, principal_id, resource_kind, resource_id,
              lifecycle_status
       FROM idempotency_records
       WHERE organization_id = $1
         AND principal_id = $2
         AND operation_name = $3
         AND idempotency_key_sha256 = $4`,
      [scope.organizationId, scope.principalId, operationName, keySha256],
    ),
  );
  const row = existing.rows[0];
  if (
    row === undefined ||
    readString(row.request_sha256) !== input.requestSha256 ||
    readString(row.principal_id) !== scope.principalId ||
    readString(row.resource_kind) !== "solution-record" ||
    readString(row.resource_id) !== input.solutionRecordId ||
    readString(row.lifecycle_status) !== "completed"
  ) {
    throw new RepositoryError(
      "idempotency-conflict",
      "The solution record request conflicts with an earlier request.",
    );
  }
  return input.solutionRecordId;
}

async function completeIdempotency(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  input: CreateSolutionRecordInput,
): Promise<void> {
  const keySha256 = createHash("sha256")
    .update(input.idempotencyKey, "utf8")
    .digest("hex");
  await executor.query(
    sql(
      `UPDATE idempotency_records
       SET lifecycle_status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1
         AND principal_id = $2
         AND operation_name = $3
         AND idempotency_key_sha256 = $4`,
      [scope.organizationId, scope.principalId, operationName, keySha256],
    ),
  );
}

async function insertPendingObject(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  object: StoredObjectReference,
): Promise<void> {
  await executor.query(
    sql(
      `INSERT INTO stored_objects (
         object_id, organization_id, project_id, storage_provider,
         object_purpose, storage_key, object_version, entity_tag,
         content_sha256, size_bytes, media_type, created_by_principal_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (object_id) DO NOTHING`,
      [
        object.objectId,
        scope.organizationId,
        object.owner.projectId ?? null,
        object.storageProvider,
        object.purpose,
        object.storageKey,
        object.objectVersion,
        object.entityTag ?? null,
        object.contentSha256,
        object.sizeBytes,
        object.mediaType,
        scope.principalId,
      ],
    ),
  );
  const existing = await executor.query<ObjectRow>(
    sql(
      `SELECT object_id, organization_id, project_id, storage_provider,
              object_purpose, storage_key, object_version, entity_tag,
              content_sha256, size_bytes, media_type, lifecycle_state
       FROM stored_objects
       WHERE organization_id = $1 AND object_id = $2`,
      [scope.organizationId, object.objectId],
    ),
  );
  const row = existing.rows[0];
  if (
    row === undefined ||
    readString(row.object_id) !== object.objectId ||
    readString(row.organization_id) !== object.owner.organizationId ||
    readOptionalString(row.project_id) !== object.owner.projectId ||
    readString(row.storage_provider) !== object.storageProvider ||
    readString(row.object_purpose) !== object.purpose ||
    readString(row.storage_key) !== object.storageKey ||
    readString(row.object_version) !== object.objectVersion ||
    readOptionalString(row.entity_tag) !== object.entityTag ||
    readString(row.content_sha256) !== object.contentSha256 ||
    readNonNegativeInteger(row.size_bytes) !== object.sizeBytes ||
    readString(row.media_type) !== object.mediaType ||
    !["publication-pending", "published"].includes(
      readString(row.lifecycle_state),
    )
  ) {
    throw new RepositoryError(
      "idempotency-conflict",
      "The stored object identity conflicts with an existing write.",
    );
  }
}

const recordColumns = `r.solution_record_id, r.organization_id, r.project_id,
  r.record_kind, r.subject_id, r.contract_version, r.content_object_id,
  r.content_sha256, r.architecture_revision_id,
  r.previous_solution_record_id, r.created_by_principal_id, r.created_at`;

export class PostgresSolutionRecordRepository implements SolutionRecordRepository {
  readonly #database: SqlDatabase;

  public constructor(database: SqlDatabase) {
    this.#database = database;
  }

  public async create(
    scope: AuthorizedOrganizationScope,
    input: CreateSolutionRecordInput,
    object: StoredObjectReference,
  ): Promise<SolutionRecordMetadata> {
    assertCreateInput(scope, input, object);
    return this.#database.transaction(async (transaction) => {
      await requireActiveMembershipScope(transaction, scope);
      const replayId = await acquireIdempotency(transaction, scope, input);
      if (replayId !== undefined) {
        const replay = await transaction.query<SolutionRecordRow>(
          sql(
            `SELECT ${recordColumns}
             FROM solution_records r
             WHERE r.organization_id = $1
               AND r.project_id = $2
               AND r.solution_record_id = $3`,
            [scope.organizationId, input.projectId, replayId],
          ),
        );
        const replayRow = replay.rows[0];
        if (replayRow === undefined) {
          throw new RepositoryError(
            "idempotency-conflict",
            "The solution record request cannot be replayed.",
          );
        }
        return mapSolutionRecord(replayRow);
      }

      await requireActiveProject(transaction, scope, input.projectId);
      await insertPendingObject(transaction, scope, object);
      const inserted = await transaction.query<SolutionRecordRow>(
        sql(
          `INSERT INTO solution_records (
             solution_record_id, organization_id, project_id, record_kind,
             subject_id, contract_version, content_object_id, content_sha256,
             architecture_revision_id, previous_solution_record_id,
             created_by_principal_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING solution_record_id, organization_id, project_id,
                     record_kind, subject_id, contract_version,
                     content_object_id, content_sha256,
                     architecture_revision_id, previous_solution_record_id,
                     created_by_principal_id, created_at`,
          [
            input.solutionRecordId,
            scope.organizationId,
            input.projectId,
            input.recordKind,
            input.subjectId,
            input.contractVersion,
            object.objectId,
            input.contentSha256,
            input.architectureRevisionId ?? null,
            input.previousSolutionRecordId ?? null,
            scope.principalId,
          ],
        ),
      );
      const row = inserted.rows[0];
      if (row === undefined) {
        throw new RepositoryError(
          "persistence-unavailable",
          "The solution record metadata could not be created.",
        );
      }
      await completeIdempotency(transaction, scope, input);
      return mapSolutionRecord(row);
    });
  }

  public async get(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    solutionRecordId: string,
  ): Promise<SolutionRecordMetadata | null> {
    assertScope(scope, "projects.read");
    assertIdentifier(projectId);
    assertIdentifier(solutionRecordId);
    const result = await this.#database.query<SolutionRecordRow>(
      sql(
        `SELECT ${recordColumns}
         FROM memberships m
         JOIN solution_records r
           ON r.organization_id = m.organization_id
          AND r.project_id = $4
         JOIN stored_objects o
           ON o.organization_id = r.organization_id
          AND o.project_id = r.project_id
          AND o.object_id = r.content_object_id
          AND o.lifecycle_state = 'published'
         WHERE m.membership_id = $1
           AND m.principal_id = $2
           AND m.organization_id = $3
           AND m.lifecycle_status = 'active'
           AND r.solution_record_id = $5`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          projectId,
          solutionRecordId,
        ],
      ),
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSolutionRecord(row);
  }

  public async getManifestForPublication(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    solutionRecordId: string,
  ): Promise<SolutionRecordMetadata | null> {
    assertScope(scope, "revisions.create");
    assertIdentifier(projectId);
    assertIdentifier(solutionRecordId);
    const result = await this.#database.query<SolutionRecordRow>(
      sql(
        `SELECT ${recordColumns}
       FROM memberships m
       JOIN solution_records r ON r.organization_id = m.organization_id AND r.project_id = $4
       JOIN stored_objects o ON o.organization_id = r.organization_id AND o.project_id = r.project_id
         AND o.object_id = r.content_object_id AND o.content_sha256 = r.content_sha256
         AND o.object_purpose = 'solution-revision-manifest'
         AND o.lifecycle_state IN ('publication-pending', 'published')
       WHERE m.membership_id = $1 AND m.principal_id = $2 AND m.organization_id = $3
         AND m.lifecycle_status = 'active' AND r.solution_record_id = $5
         AND r.created_by_principal_id = $2 AND r.record_kind = 'solution-revision-manifest'`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          projectId,
          solutionRecordId,
        ],
      ),
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSolutionRecord(row);
  }

  public async list(
    scope: AuthorizedOrganizationScope,
    input: ListSolutionRecordsInput,
  ): Promise<readonly SolutionRecordMetadata[]> {
    assertScope(scope, "projects.read");
    assertIdentifier(input.projectId);
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.recordKind !== undefined &&
        !isSolutionRecordKind(input.recordKind))
    ) {
      invalidInput();
    }
    if (input.subjectId !== undefined) {
      assertIdentifier(input.subjectId);
    }
    const result = await this.#database.query<SolutionRecordRow>(
      sql(
        `SELECT ${recordColumns}
         FROM memberships m
         JOIN solution_records r
           ON r.organization_id = m.organization_id
          AND r.project_id = $4
         JOIN stored_objects o
           ON o.organization_id = r.organization_id
          AND o.project_id = r.project_id
          AND o.object_id = r.content_object_id
          AND o.lifecycle_state = 'published'
         WHERE m.membership_id = $1
           AND m.principal_id = $2
           AND m.organization_id = $3
           AND m.lifecycle_status = 'active'
           AND ($5::varchar IS NULL OR r.record_kind = $5)
           AND ($6::varchar IS NULL OR r.subject_id = $6)
         ORDER BY r.created_at DESC, r.solution_record_id
         LIMIT $7`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          input.projectId,
          input.recordKind ?? null,
          input.subjectId ?? null,
          input.limit,
        ],
      ),
    );
    return result.rows.map(mapSolutionRecord);
  }
}
