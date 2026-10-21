import { createHash } from "node:crypto";

import {
  RepositoryError,
  type AppendAuditEventInput,
  isObjectPurpose,
  type AuthorizedOrganizationScope,
  type CloudMarkupRepository,
  type CreateExportJobMetadataInput,
  type CreateGenerationJobMetadataInput,
  type CreateProjectWithDraftInput,
  type CreateRevisionMetadataInput,
  type DraftMetadataRecord,
  type DraftCommandIdentity,
  type DraftCommandReceipt,
  type JobMetadataRecord,
  type PresentationPreferenceRecord,
  type ProjectEnvironmentRecord,
  type ProjectListInput,
  type ProjectListResult,
  type ProjectRecord,
  type RevisionMetadataRecord,
  type StoredObjectReference,
  type StoredObjectState,
  type UpdateDraftMetadataInput,
  type UpdateProjectEnvironmentMetadataInput,
  type CreateProjectEnvironmentMetadataInput,
  type ProjectLifecycleMetadataInput,
  type RenameProjectMetadataInput,
  type UpsertProjectIntegrationInput,
  type VerifiedPrincipalContext,
} from "../../application/persistence.js";
import {
  isOrganizationRole,
  permissionsForRole,
  type OrganizationPermission,
} from "../../application/authorization.js";
import { referencesMatch } from "./object-store-common.js";
import type { SqlDatabase, SqlExecutor, SqlRow } from "./sql.js";
import { sql } from "./sql.js";
import type { DraftWriteLeaseContext } from "../../application/project-editing-leases.js";
import {
  assertActiveProjectEditingLease,
  assertInitialDraftPublication,
} from "./project-editing-leases.js";
import { ApplicationError } from "../../application/errors.js";

import {
  readDraftCommandReceipt,
  insertDraftCommandReceipt,
} from "./draft-command-receipts.js";
import { parseDatabaseTimestamp } from "./database-timestamp.js";
import { PostgresCleanupAdmissionJournal } from "./project-cleanup-admission.js";
import {
  admitProjectDeletionWithCleanupWake,
  type CleanupWakeAdmissionPorts,
  type ProjectCleanupAdmissionWake,
} from "../../application/project-cleanup-wake.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

function invalidInput(): never {
  throw new RepositoryError(
    "invalid-input",
    "The persistence input is invalid.",
  );
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

function assertTimestamp(value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    invalidInput();
  }
}

function assertPrincipal(principal: VerifiedPrincipalContext): void {
  assertIdentifier(principal.principalId);
  if (
    principal.sessionId.length === 0 ||
    principal.sessionId.length > 256 ||
    principal.correlationId.length === 0 ||
    principal.correlationId.length > 128
  ) {
    invalidInput();
  }
}

function assertScope(scope: AuthorizedOrganizationScope): void {
  assertPrincipal(scope);
  assertIdentifier(scope.organizationId);
  assertIdentifier(scope.membershipId);
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(scope.roleKey) ||
    scope.capabilities.length > 128
  ) {
    invalidInput();
  }
}

function assertObject(
  scope: AuthorizedOrganizationScope,
  object: StoredObjectReference,
  purpose: StoredObjectReference["purpose"],
  projectId: string,
): void {
  assertScope(scope);
  assertIdentifier(object.objectId);
  assertIdentifier(projectId);
  assertSha256(object.contentSha256);
  if (
    object.owner.organizationId !== scope.organizationId ||
    object.owner.projectId !== projectId ||
    object.purpose !== purpose ||
    object.objectVersion.length === 0 ||
    object.storageKey.length === 0 ||
    object.sizeBytes < 0 ||
    !Number.isSafeInteger(object.sizeBytes)
  ) {
    invalidInput();
  }
}

function hashIdempotencyKey(value: string): string {
  if (value.length < 16 || value.length > 128 || /\s/.test(value)) {
    return invalidInput();
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return invalidInput();
}

function readTimestamp(value: unknown): string {
  return parseDatabaseTimestamp(value) ?? invalidInput();
}

function readNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) {
    return invalidInput();
  }
  return number;
}

function readOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : readString(value);
}

function readOptionalTimestamp(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : readTimestamp(value);
}

type MembershipRow = SqlRow & {
  readonly membership_id: unknown;
  readonly role_key: unknown;
};

type PreferenceRow = SqlRow & {
  readonly contextual_learning_enabled: unknown;
  readonly experience_mode: unknown;
  readonly sync_version: unknown;
  readonly updated_at: unknown;
};

type ProjectRow = SqlRow & {
  readonly created_at: unknown;
  readonly current_draft_id: unknown;
  readonly deletion_requested_at: unknown;
  readonly description: unknown;
  readonly latest_revision_id: unknown;
  readonly lifecycle_status: unknown;
  readonly name: unknown;
  readonly organization_id: unknown;
  readonly project_id: unknown;
  readonly record_version: unknown;
  readonly updated_at: unknown;
};

type EnvironmentRow = SqlRow & {
  readonly created_at: unknown;
  readonly deletion_requested_at: unknown;
  readonly environment_id: unknown;
  readonly environment_type: unknown;
  readonly lifecycle_status: unknown;
  readonly name: unknown;
  readonly organization_id: unknown;
  readonly project_id: unknown;
  readonly record_version: unknown;
  readonly region: unknown;
  readonly updated_at: unknown;
};

type DraftRow = SqlRow & {
  readonly content_sha256: unknown;
  readonly document_object_id: unknown;
  readonly document_schema_version: unknown;
  readonly draft_id: unknown;
  readonly draft_version: unknown;
  readonly organization_id: unknown;
  readonly project_id: unknown;
  readonly semantic_sha256: unknown;
  readonly visual_sha256: unknown;
};

type DraftWriteStateRow = DraftRow & {
  readonly pending_content_sha256: unknown;
  readonly pending_document_object_id: unknown;
  readonly pending_document_schema_version: unknown;
  readonly pending_draft_version: unknown;
  readonly pending_semantic_sha256: unknown;
  readonly pending_visual_sha256: unknown;
  readonly project_lifecycle_status: unknown;
};

type RevisionRow = SqlRow & {
  readonly catalog_id: unknown;
  readonly catalog_sha256: unknown;
  readonly catalog_version: unknown;
  readonly compiler_input_contract_version: unknown;
  readonly content_sha256: unknown;
  readonly created_at: unknown;
  readonly document_object_id: unknown;
  readonly graph_schema_version: unknown;
  readonly maximum_compiler_version_exclusive: unknown;
  readonly minimum_compiler_version: unknown;
  readonly organization_id: unknown;
  readonly previous_revision_id: unknown;
  readonly project_id: unknown;
  readonly revision_id: unknown;
  readonly revision_name: unknown;
  readonly revision_number: unknown;
  readonly semantic_sha256: unknown;
  readonly source_draft_id: unknown;
  readonly source_draft_version: unknown;
  readonly validation_run_id: unknown;
  readonly visual_sha256: unknown;
  readonly workload_behavior_version: unknown;
};

type ObjectRow = SqlRow & {
  readonly content_sha256: unknown;
  readonly delete_requested_at: unknown;
  readonly deleted_at: unknown;
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
};

type IdempotencyRow = SqlRow & {
  readonly request_sha256: unknown;
  readonly resource_id: unknown;
};

type JobRow = SqlRow & {
  readonly id: unknown;
  readonly lifecycle_status: unknown;
  readonly project_id: unknown;
};

function mapPreference(row: PreferenceRow): PresentationPreferenceRecord {
  const experienceMode = readString(row.experience_mode);
  if (experienceMode !== "guided" && experienceMode !== "professional") {
    return invalidInput();
  }
  if (typeof row.contextual_learning_enabled !== "boolean") {
    return invalidInput();
  }
  return {
    contextualLearningEnabled: row.contextual_learning_enabled,
    experienceMode,
    syncVersion: readNumber(row.sync_version),
    updatedAt: readTimestamp(row.updated_at),
  };
}

function mapProject(row: ProjectRow): ProjectRecord {
  const lifecycleStatus = readString(row.lifecycle_status);
  if (
    lifecycleStatus !== "active" &&
    lifecycleStatus !== "archived" &&
    lifecycleStatus !== "deletion-pending" &&
    lifecycleStatus !== "deleted"
  ) {
    return invalidInput();
  }
  const deletionRequestedAt = readOptionalTimestamp(row.deletion_requested_at);
  return {
    createdAt: readTimestamp(row.created_at),
    currentDraftId: readString(row.current_draft_id),
    ...(deletionRequestedAt === undefined ? {} : { deletionRequestedAt }),
    ...(readOptionalString(row.description) === undefined
      ? {}
      : { description: readString(row.description) }),
    ...(readOptionalString(row.latest_revision_id) === undefined
      ? {}
      : { latestRevisionId: readString(row.latest_revision_id) }),
    lifecycleStatus,
    name: readString(row.name),
    organizationId: readString(row.organization_id),
    projectId: readString(row.project_id),
    recordVersion: readNumber(row.record_version),
    updatedAt: readTimestamp(row.updated_at),
  };
}

function mapEnvironment(row: EnvironmentRow): ProjectEnvironmentRecord {
  const lifecycleStatus = readString(row.lifecycle_status);
  const environmentType = readString(row.environment_type);
  if (
    !["active", "deletion-pending", "deleted"].includes(lifecycleStatus) ||
    ![
      "development",
      "test",
      "staging",
      "production",
      "disaster-recovery",
      "multi-environment",
    ].includes(environmentType)
  ) {
    return invalidInput();
  }
  const deletionRequestedAt = readOptionalTimestamp(row.deletion_requested_at);
  const region = readOptionalString(row.region);
  return {
    createdAt: readTimestamp(row.created_at),
    ...(deletionRequestedAt === undefined ? {} : { deletionRequestedAt }),
    environmentId: readString(row.environment_id),
    environmentType:
      environmentType as ProjectEnvironmentRecord["environmentType"],
    lifecycleStatus:
      lifecycleStatus as ProjectEnvironmentRecord["lifecycleStatus"],
    name: readString(row.name),
    organizationId: readString(row.organization_id),
    projectId: readString(row.project_id),
    recordVersion: readNumber(row.record_version),
    ...(region === undefined ? {} : { region }),
    updatedAt: readTimestamp(row.updated_at),
  };
}

function mapDraft(row: DraftRow): DraftMetadataRecord {
  return {
    contentSha256: readString(row.content_sha256),
    documentObjectId: readString(row.document_object_id),
    documentSchemaVersion: readNumber(row.document_schema_version),
    draftId: readString(row.draft_id),
    draftVersion: readNumber(row.draft_version),
    organizationId: readString(row.organization_id),
    projectId: readString(row.project_id),
    semanticSha256: readString(row.semantic_sha256),
    visualSha256: readString(row.visual_sha256),
  };
}

function draftMetadata(
  scope: AuthorizedOrganizationScope,
  input: UpdateDraftMetadataInput,
  object: StoredObjectReference,
): DraftMetadataRecord {
  return {
    contentSha256: input.contentSha256,
    documentObjectId: object.objectId,
    documentSchemaVersion: input.documentSchemaVersion,
    draftId: input.draftId,
    draftVersion: input.expectedDraftVersion + 1,
    organizationId: scope.organizationId,
    projectId: input.projectId,
    semanticSha256: input.semanticSha256,
    visualSha256: input.visualSha256,
  };
}

function hasNoPendingDraft(row: DraftWriteStateRow): boolean {
  return (
    row.pending_content_sha256 === null &&
    row.pending_document_object_id === null &&
    row.pending_document_schema_version === null &&
    row.pending_draft_version === null &&
    row.pending_semantic_sha256 === null &&
    row.pending_visual_sha256 === null
  );
}

function isPublishedDraftReplay(
  row: DraftWriteStateRow,
  input: UpdateDraftMetadataInput,
  object: StoredObjectReference,
): boolean {
  return (
    readNumber(row.draft_version) === input.expectedDraftVersion + 1 &&
    readNumber(row.document_schema_version) === input.documentSchemaVersion &&
    readString(row.document_object_id) === object.objectId &&
    readString(row.content_sha256) === input.contentSha256 &&
    readString(row.semantic_sha256) === input.semanticSha256 &&
    readString(row.visual_sha256) === input.visualSha256
  );
}

function isPendingDraftReplay(
  row: DraftWriteStateRow,
  input: UpdateDraftMetadataInput,
  object: StoredObjectReference,
): boolean {
  return (
    readNumber(row.draft_version) === input.expectedDraftVersion &&
    row.pending_draft_version !== null &&
    readNumber(row.pending_draft_version) === input.expectedDraftVersion + 1 &&
    row.pending_document_schema_version !== null &&
    readNumber(row.pending_document_schema_version) ===
      input.documentSchemaVersion &&
    row.pending_document_object_id !== null &&
    readString(row.pending_document_object_id) === object.objectId &&
    row.pending_content_sha256 !== null &&
    readString(row.pending_content_sha256) === input.contentSha256 &&
    row.pending_semantic_sha256 !== null &&
    readString(row.pending_semantic_sha256) === input.semanticSha256 &&
    row.pending_visual_sha256 !== null &&
    readString(row.pending_visual_sha256) === input.visualSha256
  );
}

function mapRevision(row: RevisionRow): RevisionMetadataRecord {
  const previousRevisionId = readOptionalString(row.previous_revision_id);
  return {
    catalogId: readString(row.catalog_id),
    catalogSha256: readString(row.catalog_sha256),
    catalogVersion: readString(row.catalog_version),
    compilerInputContractVersion: readNumber(
      row.compiler_input_contract_version,
    ),
    contentSha256: readString(row.content_sha256),
    createdAt: readTimestamp(row.created_at),
    documentObjectId: readString(row.document_object_id),
    graphSchemaVersion: readNumber(row.graph_schema_version),
    ...(readOptionalString(row.maximum_compiler_version_exclusive) === undefined
      ? {}
      : {
          maximumCompilerVersionExclusive: readString(
            row.maximum_compiler_version_exclusive,
          ),
        }),
    minimumCompilerVersion: readString(row.minimum_compiler_version),
    name: readString(row.revision_name),
    organizationId: readString(row.organization_id),
    ...(previousRevisionId === undefined ? {} : { previousRevisionId }),
    projectId: readString(row.project_id),
    revisionId: readString(row.revision_id),
    revisionNumber: readNumber(row.revision_number),
    semanticSha256: readString(row.semantic_sha256),
    sourceDraftId: readString(row.source_draft_id),
    sourceDraftVersion: readNumber(row.source_draft_version),
    validationRunId: readString(row.validation_run_id),
    visualSha256: readString(row.visual_sha256),
    workloadBehaviorVersion: readNumber(row.workload_behavior_version),
  };
}

function mapObject(row: ObjectRow): StoredObjectState {
  const storageProvider = readString(row.storage_provider);
  const purpose = readString(row.object_purpose);
  const lifecycleState = readString(row.lifecycle_state);
  if (
    !["s3", "filesystem", "memory"].includes(storageProvider) ||
    !isObjectPurpose(purpose) ||
    !["publication-pending", "published", "delete-pending", "deleted"].includes(
      lifecycleState,
    )
  ) {
    return invalidInput();
  }
  const projectId = readOptionalString(row.project_id);
  const entityTag = readOptionalString(row.entity_tag);
  const deleteRequestedAt = readOptionalTimestamp(row.delete_requested_at);
  const deletedAt = readOptionalTimestamp(row.deleted_at);
  return {
    contentSha256: readString(row.content_sha256),
    ...(deleteRequestedAt === undefined ? {} : { deleteRequestedAt }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
    ...(entityTag === undefined ? {} : { entityTag }),
    lifecycleState: lifecycleState as StoredObjectState["lifecycleState"],
    mediaType: readString(row.media_type),
    objectId: readString(row.object_id),
    objectVersion: readString(row.object_version),
    owner: {
      organizationId: readString(row.organization_id),
      ...(projectId === undefined ? {} : { projectId }),
    },
    purpose,
    sizeBytes: readNumber(row.size_bytes),
    storageKey: readString(row.storage_key),
    storageProvider: storageProvider as StoredObjectState["storageProvider"],
  };
}

const membershipPredicate = `
  m.membership_id = $1
  AND m.principal_id = $2
  AND m.organization_id = $3
  AND m.lifecycle_status = 'active'
`;

async function requireScope(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
): Promise<void> {
  const result = await executor.query(
    sql(
      `SELECT 1
       FROM memberships m
       JOIN organizations o ON o.organization_id = m.organization_id
       WHERE ${membershipPredicate}
         AND o.lifecycle_status = 'active'`,
      [scope.membershipId, scope.principalId, scope.organizationId],
    ),
  );
  if (result.rows.length !== 1) {
    throw new RepositoryError("access-denied", "Access is not available.");
  }
}

async function requireCurrentEnvironmentMutationAuthority(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  permission: OrganizationPermission,
): Promise<void> {
  const result = await executor.query<MembershipRow>(
    sql(
      `SELECT m.membership_id, m.role_key
       FROM memberships m
       JOIN principals principal_record
         ON principal_record.principal_id = m.principal_id
        AND principal_record.lifecycle_status = 'active'
       JOIN organizations o
         ON o.organization_id = m.organization_id
        AND o.lifecycle_status = 'active'
       JOIN organization_roles r
        ON r.organization_id = m.organization_id
        AND r.role_key = m.role_key
        AND r.policy_version = 'authorization-v2'
       WHERE ${membershipPredicate}
       FOR SHARE OF m, principal_record, o, r`,
      [scope.membershipId, scope.principalId, scope.organizationId],
    ),
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) {
    throw new RepositoryError("access-denied", "Access is not available.");
  }
  const roleKey = readString(row.role_key);
  if (
    !isOrganizationRole(roleKey) ||
    !permissionsForRole(roleKey).includes(permission)
  ) {
    throw new RepositoryError("access-denied", "Access is not available.");
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
       FROM projects
       WHERE organization_id = $1
         AND project_id = $2
         AND lifecycle_status = 'active'
       FOR UPDATE`,
      [scope.organizationId, projectId],
    ),
  );
  if (result.rows.length !== 1) {
    throw new RepositoryError(
      "version-conflict",
      "The project is no longer active.",
    );
  }
}

async function requireScopeForOrganizationDeletion(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
): Promise<void> {
  const result = await executor.query(
    sql(
      `SELECT 1
       FROM memberships m
       JOIN organizations o ON o.organization_id = m.organization_id
       WHERE ${membershipPredicate}
         AND o.lifecycle_status IN ('active', 'suspended', 'deletion-pending')`,
      [scope.membershipId, scope.principalId, scope.organizationId],
    ),
  );
  if (result.rows.length !== 1) {
    throw new RepositoryError("access-denied", "Access is not available.");
  }
}

async function insertAuditEvent(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  action: string,
  targetKind: AppendAuditEventInput["targetKind"],
  targetId: string,
  safeSummary: string,
): Promise<void> {
  const auditEventId =
    "audit_" +
    createHash("sha256")
      .update(
        [
          scope.organizationId,
          scope.principalId,
          scope.correlationId,
          action,
          targetKind,
          targetId,
        ].join("\u0000"),
      )
      .digest("hex")
      .slice(0, 48);
  await executor.query(
    sql(
      `INSERT INTO audit_events (
         audit_event_id, organization_id, actor_principal_id, action,
         target_kind, target_id, outcome, safe_summary, correlation_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8)
       ON CONFLICT (audit_event_id) DO NOTHING`,
      [
        auditEventId,
        scope.organizationId,
        scope.principalId,
        action,
        targetKind,
        targetId,
        safeSummary,
        scope.correlationId,
      ],
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
         content_sha256, size_bytes, media_type, lifecycle_state,
         created_by_principal_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         'publication-pending', $12
       )
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
  await requireMatchingStoredObject(executor, scope, object, [
    "publication-pending",
    "published",
  ]);
}

async function requireMatchingStoredObject(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  object: StoredObjectReference,
  allowedLifecycleStates: readonly StoredObjectState["lifecycleState"][],
): Promise<StoredObjectState> {
  const existing = await executor.query<ObjectRow>(
    sql(
      `SELECT object_id, organization_id, project_id, storage_provider,
              object_purpose, storage_key, object_version, entity_tag,
              content_sha256, size_bytes, media_type, lifecycle_state,
              delete_requested_at, deleted_at
       FROM stored_objects
       WHERE organization_id = $1 AND object_id = $2`,
      [scope.organizationId, object.objectId],
    ),
  );
  const stored = existing.rows[0];
  if (stored === undefined) {
    throw new RepositoryError(
      "idempotency-conflict",
      "The stored object identity conflicts with an existing write.",
    );
  }
  const storedObject = mapObject(stored);
  if (
    !referencesMatch(storedObject, object) ||
    !allowedLifecycleStates.includes(storedObject.lifecycleState)
  ) {
    throw new RepositoryError(
      "idempotency-conflict",
      "The stored object identity conflicts with an existing write.",
    );
  }
  return storedObject;
}

async function acquireIdempotency(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  operationName: string,
  idempotencyKey: string,
  requestSha256: string,
  resourceKind: string,
  resourceId: string,
): Promise<{ readonly keySha256: string; readonly replayResourceId?: string }> {
  assertSha256(requestSha256);
  const keySha256 = hashIdempotencyKey(idempotencyKey);
  const existing = await executor.query<IdempotencyRow>(
    sql(
      `SELECT request_sha256, resource_id
       FROM idempotency_records
       WHERE organization_id = $1
         AND principal_id = $2
         AND operation_name = $3
         AND idempotency_key_sha256 = $4
       FOR UPDATE`,
      [scope.organizationId, scope.principalId, operationName, keySha256],
    ),
  );
  const row = existing.rows[0];
  if (row !== undefined) {
    if (readString(row.request_sha256) !== requestSha256) {
      throw new RepositoryError(
        "idempotency-conflict",
        "The idempotency key was used for a different request.",
      );
    }
    return {
      keySha256,
      replayResourceId: readString(row.resource_id),
    };
  }
  await executor.query(
    sql(
      `INSERT INTO idempotency_records (
         organization_id, operation_name, idempotency_key_sha256,
         request_sha256, principal_id, resource_kind, resource_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        scope.organizationId,
        operationName,
        keySha256,
        requestSha256,
        scope.principalId,
        resourceKind,
        resourceId,
      ],
    ),
  );
  return { keySha256 };
}

async function completeIdempotency(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  operationName: string,
  keySha256: string,
): Promise<void> {
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

export class PostgresCloudMarkupRepository implements CloudMarkupRepository {
  readonly #database: SqlDatabase;
  readonly #draftEditingLeasesRequired: boolean;
  readonly #onProjectDeletionCommitted:
    ((project: ProjectRecord) => Promise<void>) | undefined;
  readonly #cleanupWakeAdmission: CleanupWakeAdmissionPorts | undefined;
  readonly #cleanupAdmissionJournal: PostgresCleanupAdmissionJournal;

  constructor(
    database: SqlDatabase,
    options: {
      readonly draftEditingLeases?: "required" | "disabled";
      readonly onProjectDeletionCommitted?: (
        project: ProjectRecord,
      ) => Promise<void>;
      /** Production supplies this only for the admitted opt-in cleanup profile. */
      readonly cleanupWakeAdmission?: CleanupWakeAdmissionPorts;
    } = {},
  ) {
    this.#database = database;
    this.#draftEditingLeasesRequired =
      options.draftEditingLeases === "required";
    this.#onProjectDeletionCommitted = options.onProjectDeletionCommitted;
    this.#cleanupWakeAdmission = options.cleanupWakeAdmission;
    this.#cleanupAdmissionJournal = new PostgresCleanupAdmissionJournal(
      database,
    );
  }

  async resolveOrganizationScope(
    principal: VerifiedPrincipalContext,
    organizationId: string,
  ): Promise<AuthorizedOrganizationScope | null> {
    assertPrincipal(principal);
    assertIdentifier(organizationId);
    const result = await this.#database.query<MembershipRow>(
      sql(
        `SELECT m.membership_id, r.role_key
         FROM memberships m
         JOIN organization_roles r
           ON r.organization_id = m.organization_id
          AND r.role_key = m.role_key
          AND r.policy_version = 'authorization-v2'
         JOIN organizations o ON o.organization_id = m.organization_id
         JOIN principals p
           ON p.principal_id = m.principal_id
          AND p.lifecycle_status = 'active'
         WHERE m.principal_id = $1
           AND m.organization_id = $2
           AND m.lifecycle_status = 'active'
           AND o.lifecycle_status = 'active'`,
        [principal.principalId, organizationId],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    const roleKey = readString(row.role_key);
    if (!isOrganizationRole(roleKey)) {
      return invalidInput();
    }
    const capabilities = permissionsForRole(roleKey);
    return {
      ...principal,
      capabilities,
      membershipId: readString(row.membership_id),
      organizationId,
      roleKey,
    };
  }

  async getPresentationPreferences(
    principal: VerifiedPrincipalContext,
  ): Promise<PresentationPreferenceRecord | null> {
    assertPrincipal(principal);
    const result = await this.#database.query<PreferenceRow>(
      sql(
        `SELECT experience_mode, contextual_learning_enabled,
                sync_version, updated_at
         FROM user_presentation_preferences
         WHERE principal_id = $1`,
        [principal.principalId],
      ),
    );
    return result.rows[0] === undefined ? null : mapPreference(result.rows[0]);
  }

  async updatePresentationPreferences(
    principal: VerifiedPrincipalContext,
    input: Omit<PresentationPreferenceRecord, "syncVersion" | "updatedAt">,
    expectedSyncVersion: number,
  ): Promise<PresentationPreferenceRecord> {
    assertPrincipal(principal);
    if (!Number.isSafeInteger(expectedSyncVersion) || expectedSyncVersion < 0) {
      return invalidInput();
    }
    const result = await this.#database.query<PreferenceRow>(
      sql(
        `INSERT INTO user_presentation_preferences (
           principal_id, experience_mode, contextual_learning_enabled,
           sync_version, updated_at
         ) VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
         ON CONFLICT (principal_id) DO UPDATE
         SET experience_mode = EXCLUDED.experience_mode,
             contextual_learning_enabled = EXCLUDED.contextual_learning_enabled,
             sync_version = user_presentation_preferences.sync_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_presentation_preferences.sync_version = $4
         RETURNING experience_mode, contextual_learning_enabled,
                   sync_version, updated_at`,
        [
          principal.principalId,
          input.experienceMode,
          input.contextualLearningEnabled,
          expectedSyncVersion,
        ],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new RepositoryError(
        "version-conflict",
        "Presentation preferences changed on another device.",
      );
    }
    return mapPreference(row);
  }

  async listProjects(
    scope: AuthorizedOrganizationScope,
    input: ProjectListInput,
  ): Promise<ProjectListResult> {
    assertScope(scope);
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.cursor !== undefined && !opaqueIdPattern.test(input.cursor))
    ) {
      return invalidInput();
    }
    const result = await this.#database.query<ProjectRow>(
      sql(
        `SELECT p.project_id, p.organization_id, p.name, p.description,
                p.lifecycle_status, p.record_version, p.current_draft_id,
                p.latest_revision_id, p.deletion_requested_at,
                p.created_at, p.updated_at
         FROM memberships m
         JOIN projects p ON p.organization_id = m.organization_id
         WHERE ${membershipPredicate}
           AND ($4::varchar IS NULL OR p.lifecycle_status = $4)
           AND ($5::varchar IS NULL OR p.project_id > $5)
         ORDER BY p.project_id
         LIMIT $6`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          input.lifecycleStatus ?? null,
          input.cursor ?? null,
          input.limit + 1,
        ],
      ),
    );
    const rows = result.rows.slice(0, input.limit);
    return {
      items: rows.map(mapProject),
      ...(result.rows.length > input.limit && rows.at(-1) !== undefined
        ? { nextCursor: readString(rows.at(-1)?.project_id) }
        : {}),
    };
  }

  async getProject(
    scope: AuthorizedOrganizationScope,
    projectId: string,
  ): Promise<ProjectRecord | null> {
    assertScope(scope);
    assertIdentifier(projectId);
    const result = await this.#database.query<ProjectRow>(
      sql(
        `SELECT p.project_id, p.organization_id, p.name, p.description,
                p.lifecycle_status, p.record_version, p.current_draft_id,
                p.latest_revision_id, p.deletion_requested_at,
                p.created_at, p.updated_at
         FROM memberships m
         JOIN projects p
           ON p.organization_id = m.organization_id
          AND p.project_id = $4
         WHERE ${membershipPredicate}`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          projectId,
        ],
      ),
    );
    return result.rows[0] === undefined ? null : mapProject(result.rows[0]);
  }

  async renameProject(
    scope: AuthorizedOrganizationScope,
    input: RenameProjectMetadataInput,
  ): Promise<ProjectRecord> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    if (
      input.name.trim().length < 1 ||
      input.name.trim().length > 120 ||
      !Number.isSafeInteger(input.expectedRecordVersion) ||
      input.expectedRecordVersion < 1
    ) {
      return invalidInput();
    }
    return this.#database.transaction(async (transaction) => {
      await requireScope(transaction, scope);
      const result = await transaction.query<ProjectRow>(
        sql(
          `UPDATE projects
           SET name = $1, record_version = record_version + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $2 AND project_id = $3
             AND record_version = $4
             AND lifecycle_status IN ('active', 'archived')
           RETURNING project_id, organization_id, name, description,
                     lifecycle_status, record_version, current_draft_id,
                     latest_revision_id, deletion_requested_at,
                     created_at, updated_at`,
          [
            input.name,
            scope.organizationId,
            input.projectId,
            input.expectedRecordVersion,
          ],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new RepositoryError(
          "version-conflict",
          "The project changed before the rename completed.",
        );
      }
      await insertAuditEvent(
        transaction,
        scope,
        "project.renamed",
        "project",
        input.projectId,
        "The project was renamed.",
      );
      return mapProject(row);
    });
  }

  async archiveProject(
    scope: AuthorizedOrganizationScope,
    input: ProjectLifecycleMetadataInput,
  ): Promise<ProjectRecord> {
    return this.#changeProjectLifecycle(
      scope,
      input,
      "projects.archive",
      "active",
      "archived",
    );
  }

  async deleteProject(
    scope: AuthorizedOrganizationScope,
    input: ProjectLifecycleMetadataInput,
  ): Promise<ProjectRecord> {
    const deleted =
      this.#cleanupWakeAdmission === undefined
        ? await this.#changeProjectLifecycle(
            scope,
            input,
            "projects.delete",
            null,
            "deletion-pending",
          )
        : await admitProjectDeletionWithCleanupWake({
            ...this.#cleanupWakeAdmission,
            prepare: () => this.#prepareCleanupAdmission(scope, input),
            envelope: (wake) =>
              new PostgresCleanupAdmissionJournal(this.#database).envelope(
                wake,
              ),
            commit: (wake) =>
              this.#changeProjectLifecycle(
                scope,
                input,
                "projects.delete",
                null,
                "deletion-pending",
                wake,
              ),
          });
    // Observer failure cannot roll back or reinterpret a committed deletion.
    // The required minute SQL path recovers missed/uncertain publication.
    try {
      await this.#onProjectDeletionCommitted?.(deleted);
    } catch {
      // No identifiers or transport error payloads enter logs.
      console.warn(
        JSON.stringify({
          component: "project-cleanup-wake",
          outcome: "notification-unavailable",
        }),
      );
    }
    return deleted;
  }

  async requestOrganizationDeletion(
    scope: AuthorizedOrganizationScope,
    input: {
      readonly expectedRecordVersion: number;
      readonly idempotencyKey: string;
      readonly requestSha256: string;
    },
  ): Promise<{
    readonly lifecycleStatus: "deletion-pending";
    readonly recordVersion: number;
  }> {
    assertScope(scope);
    assertSha256(input.requestSha256);
    if (
      !scope.capabilities.includes("organizations.delete") ||
      !Number.isSafeInteger(input.expectedRecordVersion) ||
      input.expectedRecordVersion < 1
    ) {
      throw new RepositoryError("access-denied", "Access is not available.");
    }
    return this.#database.transaction(async (transaction) => {
      await requireScopeForOrganizationDeletion(transaction, scope);
      const idempotency = await acquireIdempotency(
        transaction,
        scope,
        "organizations.delete",
        input.idempotencyKey,
        input.requestSha256,
        "organization",
        scope.organizationId,
      );
      if (idempotency.replayResourceId === undefined) {
        const updatedOrganization = await transaction.query<{
          readonly record_version: unknown;
        }>(
          sql(
            `UPDATE organizations
             SET lifecycle_status = 'deletion-pending',
                 deletion_requested_at = CURRENT_TIMESTAMP,
                 record_version = record_version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $1 AND record_version = $2
               AND lifecycle_status IN ('active', 'suspended')
             RETURNING record_version`,
            [scope.organizationId, input.expectedRecordVersion],
          ),
        );
        if (updatedOrganization.rows[0] === undefined) {
          throw new RepositoryError(
            "version-conflict",
            "The organization changed before deletion was requested.",
          );
        }
        await completeIdempotency(
          transaction,
          scope,
          "organizations.delete",
          idempotency.keySha256,
        );
        await insertAuditEvent(
          transaction,
          scope,
          "organization.deletion-requested",
          "organization",
          scope.organizationId,
          "Organization data deletion was requested.",
        );
        return {
          lifecycleStatus: "deletion-pending" as const,
          recordVersion: readNumber(updatedOrganization.rows[0].record_version),
        };
      }
      const replay = await transaction.query<{
        readonly lifecycle_status: unknown;
        readonly record_version: unknown;
      }>(
        sql(
          `SELECT lifecycle_status, record_version
           FROM organizations
           WHERE organization_id = $1`,
          [scope.organizationId],
        ),
      );
      const row = replay.rows[0];
      if (
        row === undefined ||
        readString(row.lifecycle_status) !== "deletion-pending"
      ) {
        throw new RepositoryError(
          "idempotency-conflict",
          "The organization deletion request cannot be replayed.",
        );
      }
      return {
        lifecycleStatus: "deletion-pending" as const,
        recordVersion: readNumber(row.record_version),
      };
    });
  }

  async listProjectEnvironments(
    scope: AuthorizedOrganizationScope,
    projectId: string,
  ): Promise<readonly ProjectEnvironmentRecord[]> {
    assertScope(scope);
    assertIdentifier(projectId);
    const result = await this.#database.query<EnvironmentRow>(
      sql(
        `SELECT e.environment_id, e.organization_id, e.project_id,
                e.name, e.environment_type, e.region, e.record_version,
                e.lifecycle_status, e.deletion_requested_at,
                e.created_at, e.updated_at
         FROM memberships m
         JOIN project_environments e
           ON e.organization_id = m.organization_id
          AND e.project_id = $4
         WHERE ${membershipPredicate}
         ORDER BY e.name, e.environment_id`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          projectId,
        ],
      ),
    );
    return result.rows.map(mapEnvironment);
  }

  async getProjectEnvironment(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    environmentId: string,
  ): Promise<ProjectEnvironmentRecord | null> {
    assertScope(scope);
    assertIdentifier(projectId);
    assertIdentifier(environmentId);
    const result = await this.#database.query<EnvironmentRow>(
      sql(
        `SELECT e.environment_id, e.organization_id, e.project_id,
                e.name, e.environment_type, e.region, e.record_version,
                e.lifecycle_status, e.deletion_requested_at,
                e.created_at, e.updated_at
         FROM memberships m
         JOIN project_environments e
           ON e.organization_id = m.organization_id
          AND e.project_id = $4 AND e.environment_id = $5
         WHERE ${membershipPredicate}`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          projectId,
          environmentId,
        ],
      ),
    );
    return result.rows[0] === undefined ? null : mapEnvironment(result.rows[0]);
  }

  async createProjectEnvironment(
    scope: AuthorizedOrganizationScope,
    input: CreateProjectEnvironmentMetadataInput,
  ): Promise<ProjectEnvironmentRecord> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    assertIdentifier(input.environmentId);
    assertSha256(input.requestSha256);
    return this.#database.transaction(async (transaction) => {
      await requireCurrentEnvironmentMutationAuthority(
        transaction,
        scope,
        "environments.create",
      );
      await requireActiveProject(transaction, scope, input.projectId);
      const idempotency = await acquireIdempotency(
        transaction,
        scope,
        "environments.create",
        input.idempotencyKey,
        input.requestSha256,
        "environment",
        input.environmentId,
      );
      const environmentId = idempotency.replayResourceId ?? input.environmentId;
      if (idempotency.replayResourceId === undefined) {
        const inserted = await transaction.query(
          sql(
            `INSERT INTO project_environments (
               environment_id, organization_id, project_id, name,
               environment_type, region
             )
             SELECT $1, p.organization_id, p.project_id, $2, $3, $4
             FROM projects p
             WHERE p.organization_id = $5 AND p.project_id = $6
               AND p.lifecycle_status = 'active'`,
            [
              environmentId,
              input.name,
              input.environmentType,
              input.region ?? null,
              scope.organizationId,
              input.projectId,
            ],
          ),
        );
        if (inserted.rowCount !== 1) {
          throw new RepositoryError(
            "not-found",
            "The project is not available.",
          );
        }
        await completeIdempotency(
          transaction,
          scope,
          "environments.create",
          idempotency.keySha256,
        );
        await insertAuditEvent(
          transaction,
          scope,
          "environment.created",
          "project",
          input.projectId,
          "A project environment was created.",
        );
      }
      const result = await transaction.query<EnvironmentRow>(
        sql(
          `SELECT environment_id, organization_id, project_id, name,
                  environment_type, region, record_version, lifecycle_status,
                  deletion_requested_at, created_at, updated_at
           FROM project_environments
           WHERE organization_id = $1 AND project_id = $2
             AND environment_id = $3`,
          [scope.organizationId, input.projectId, environmentId],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new RepositoryError(
          "idempotency-conflict",
          "The environment could not be created idempotently.",
        );
      }
      return mapEnvironment(row);
    });
  }

  async updateProjectEnvironment(
    scope: AuthorizedOrganizationScope,
    input: UpdateProjectEnvironmentMetadataInput,
  ): Promise<ProjectEnvironmentRecord> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    assertIdentifier(input.environmentId);
    return this.#database.transaction(async (transaction) => {
      await requireCurrentEnvironmentMutationAuthority(
        transaction,
        scope,
        "projects.mutate",
      );
      await requireActiveProject(transaction, scope, input.projectId);
      const result = await transaction.query<EnvironmentRow>(
        sql(
          `UPDATE project_environments e
           SET name = $4, environment_type = $5, region = $6,
               record_version = record_version + 1,
               updated_at = CURRENT_TIMESTAMP
           FROM memberships m
           WHERE ${membershipPredicate}
             AND e.organization_id = m.organization_id
             AND e.project_id = $7 AND e.environment_id = $8
             AND e.record_version = $9 AND e.lifecycle_status = 'active'
           RETURNING e.environment_id, e.organization_id, e.project_id,
                     e.name, e.environment_type, e.region, e.record_version,
                     e.lifecycle_status, e.deletion_requested_at,
                     e.created_at, e.updated_at`,
          [
            scope.membershipId,
            scope.principalId,
            scope.organizationId,
            input.name,
            input.environmentType,
            input.region ?? null,
            input.projectId,
            input.environmentId,
            input.expectedRecordVersion,
          ],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new RepositoryError(
          "version-conflict",
          "The environment changed before the update completed.",
        );
      }
      await insertAuditEvent(
        transaction,
        scope,
        "environment.updated",
        "project",
        input.projectId,
        "A project environment was updated.",
      );
      return mapEnvironment(row);
    });
  }
  async deleteProjectEnvironment(
    scope: AuthorizedOrganizationScope,
    input: {
      readonly environmentId: string;
      readonly expectedRecordVersion: number;
      readonly idempotencyKey: string;
      readonly projectId: string;
      readonly requestSha256: string;
    },
  ): Promise<ProjectEnvironmentRecord> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    assertIdentifier(input.environmentId);
    assertSha256(input.requestSha256);
    return this.#database.transaction(async (transaction) => {
      await requireCurrentEnvironmentMutationAuthority(
        transaction,
        scope,
        "projects.mutate",
      );
      await requireActiveProject(transaction, scope, input.projectId);
      const idempotency = await acquireIdempotency(
        transaction,
        scope,
        "environments.delete",
        input.idempotencyKey,
        input.requestSha256,
        "environment",
        input.environmentId,
      );
      if (idempotency.replayResourceId === undefined) {
        const updatedEnvironment = await transaction.query<EnvironmentRow>(
          sql(
            `UPDATE project_environments
             SET lifecycle_status = 'deletion-pending',
                 deletion_requested_at = CURRENT_TIMESTAMP,
                 record_version = record_version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $1 AND project_id = $2
               AND environment_id = $3 AND record_version = $4
               AND lifecycle_status = 'active'
             RETURNING environment_id, organization_id, project_id, name,
                       environment_type, region, record_version,
                       lifecycle_status, deletion_requested_at,
                       created_at, updated_at`,
            [
              scope.organizationId,
              input.projectId,
              input.environmentId,
              input.expectedRecordVersion,
            ],
          ),
        );
        if (updatedEnvironment.rows[0] === undefined) {
          throw new RepositoryError(
            "version-conflict",
            "The environment changed before deletion was requested.",
          );
        }
        await completeIdempotency(
          transaction,
          scope,
          "environments.delete",
          idempotency.keySha256,
        );
        await insertAuditEvent(
          transaction,
          scope,
          "environment.deletion-requested",
          "project",
          input.projectId,
          "Project environment deletion was requested.",
        );
        return mapEnvironment(updatedEnvironment.rows[0]);
      }
      const replay = await transaction.query<EnvironmentRow>(
        sql(
          `SELECT environment_id, organization_id, project_id, name,
                  environment_type, region, record_version, lifecycle_status,
                  deletion_requested_at, created_at, updated_at
           FROM project_environments
           WHERE organization_id = $1 AND project_id = $2
             AND environment_id = $3`,
          [scope.organizationId, input.projectId, input.environmentId],
        ),
      );
      const row = replay.rows[0];
      if (row === undefined) {
        throw new RepositoryError(
          "idempotency-conflict",
          "The environment deletion request cannot be replayed.",
        );
      }
      return mapEnvironment(row);
    });
  }

  async #prepareCleanupAdmission(
    scope: AuthorizedOrganizationScope,
    input: ProjectLifecycleMetadataInput,
  ): Promise<ProjectCleanupAdmissionWake> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    assertSha256(input.requestSha256);
    if (
      !Number.isSafeInteger(input.expectedRecordVersion) ||
      input.expectedRecordVersion < 1 ||
      input.expectedRecordVersion >= Number.MAX_SAFE_INTEGER
    )
      invalidInput();
    const keySha256 = hashIdempotencyKey(input.idempotencyKey);
    return this.#database.transaction(async (tx) => {
      const project = await tx.query(
        sql(
          "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
          [scope.organizationId, input.projectId],
        ),
      );
      await requireCurrentEnvironmentMutationAuthority(
        tx,
        scope,
        "projects.delete",
      );
      if (project.rows.length !== 1)
        throw new RepositoryError(
          "version-conflict",
          "The project changed before deletion admission.",
        );
      return this.#cleanupAdmissionJournal.prepare(tx, {
        organizationId: scope.organizationId,
        projectId: input.projectId,
        principalId: scope.principalId,
        keySha256,
        requestSha256: input.requestSha256,
        expectedRecordVersion: input.expectedRecordVersion,
      });
    });
  }

  async #changeProjectLifecycle(
    scope: AuthorizedOrganizationScope,
    input: ProjectLifecycleMetadataInput,
    operation: "projects.archive" | "projects.delete",
    sourceStatus: "active" | null,
    targetStatus: "archived" | "deletion-pending",
    cleanupAdmission?: ProjectCleanupAdmissionWake,
  ): Promise<ProjectRecord> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    assertSha256(input.requestSha256);
    return this.#database.transaction(async (transaction) => {
      // Lock the exact project before current authority, including closed rows:
      // an already-completed lifecycle request must remain replayable.
      const project = await transaction.query(
        sql(
          `SELECT project_id FROM projects
           WHERE organization_id = $1 AND project_id = $2
           FOR UPDATE`,
          [scope.organizationId, input.projectId],
        ),
      );
      await requireCurrentEnvironmentMutationAuthority(
        transaction,
        scope,
        operation === "projects.archive"
          ? "projects.mutate"
          : "projects.delete",
      );
      if (project.rows.length !== 1) {
        throw new RepositoryError(
          "version-conflict",
          "The project changed before the lifecycle update completed.",
        );
      }
      let admissionState: "prepared" | "committed" | undefined;
      if (cleanupAdmission !== undefined) {
        if (
          operation !== "projects.delete" ||
          cleanupAdmission.organizationId !== scope.organizationId ||
          cleanupAdmission.projectId !== input.projectId ||
          cleanupAdmission.recordVersion !== input.expectedRecordVersion + 1
        )
          invalidInput();
        admissionState = await this.#cleanupAdmissionJournal.assertCommittable(
          transaction,
          cleanupAdmission,
        );
      }
      const idempotency = await acquireIdempotency(
        transaction,
        scope,
        operation,
        input.idempotencyKey,
        input.requestSha256,
        "project",
        input.projectId,
      );
      if (idempotency.replayResourceId === undefined) {
        if (admissionState === "committed")
          throw new RepositoryError(
            "idempotency-conflict",
            "The deletion admission cannot be replayed.",
          );
        const result = await transaction.query<ProjectRow>(
          sql(
            `UPDATE projects
             SET lifecycle_status = $1::varchar,
                 deletion_requested_at = CASE
                   WHEN $1::varchar = 'deletion-pending' THEN COALESCE($6::timestamptz,CURRENT_TIMESTAMP)
                   ELSE deletion_requested_at
                 END,
                 record_version = record_version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $2 AND project_id = $3
               AND record_version = $4
               AND ($5::varchar IS NULL
                 OR lifecycle_status = $5)
               AND lifecycle_status NOT IN ('deletion-pending', 'deleted')
             RETURNING project_id, organization_id, name, description,
                       lifecycle_status, record_version, current_draft_id,
                       latest_revision_id, deletion_requested_at,
                       created_at, updated_at`,
            [
              targetStatus,
              scope.organizationId,
              input.projectId,
              input.expectedRecordVersion,
              sourceStatus,
              cleanupAdmission?.deletionRequestedAt ?? null,
            ],
          ),
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new RepositoryError(
            "version-conflict",
            "The project changed before the lifecycle update completed.",
          );
        }
        await completeIdempotency(
          transaction,
          scope,
          operation,
          idempotency.keySha256,
        );
        await insertAuditEvent(
          transaction,
          scope,
          targetStatus === "archived"
            ? "project.archived"
            : "project.deletion-requested",
          "project",
          input.projectId,
          targetStatus === "archived"
            ? "The project was archived."
            : "Project data deletion was requested.",
        );
        const changed = mapProject(row);
        if (cleanupAdmission !== undefined) {
          if (
            changed.recordVersion !== cleanupAdmission.recordVersion ||
            changed.deletionRequestedAt !== cleanupAdmission.deletionRequestedAt
          )
            invalidInput();
          await this.#cleanupAdmissionJournal.commit(
            transaction,
            cleanupAdmission,
          );
        }
        return changed;
      }
      const replay = await transaction.query<ProjectRow>(
        sql(
          `SELECT project_id, organization_id, name, description,
                  lifecycle_status, record_version, current_draft_id,
                  latest_revision_id, deletion_requested_at,
                  created_at, updated_at
           FROM projects
           WHERE organization_id = $1 AND project_id = $2`,
          [scope.organizationId, input.projectId],
        ),
      );
      const row = replay.rows[0];
      if (
        row === undefined ||
        readString(row.lifecycle_status) !== targetStatus
      ) {
        throw new RepositoryError(
          "idempotency-conflict",
          "The project lifecycle request cannot be replayed.",
        );
      }
      const replayed = mapProject(row);
      if (
        cleanupAdmission !== undefined &&
        (admissionState !== "committed" ||
          replayed.recordVersion !== cleanupAdmission.recordVersion ||
          replayed.deletionRequestedAt !== cleanupAdmission.deletionRequestedAt)
      )
        throw new RepositoryError(
          "idempotency-conflict",
          "The deletion admission cannot be replayed.",
        );
      return replayed;
    });
  }
  async createProjectWithInitialDraft(
    scope: AuthorizedOrganizationScope,
    input: CreateProjectWithDraftInput,
    object: StoredObjectReference,
  ): Promise<ProjectRecord> {
    assertObject(scope, object, "architecture-draft", input.projectId);
    assertIdentifier(input.projectId);
    assertIdentifier(input.draft.draftId);
    assertSha256(input.requestSha256);
    assertSha256(input.draft.contentSha256);
    assertSha256(input.draft.semanticSha256);
    assertSha256(input.draft.visualSha256);
    if (input.draft.contentSha256 !== object.contentSha256) {
      return invalidInput();
    }
    return this.#database.transaction(async (transaction) => {
      await requireScope(transaction, scope);
      const idempotency = await acquireIdempotency(
        transaction,
        scope,
        "projects.create",
        input.idempotencyKey,
        input.requestSha256,
        "project",
        input.projectId,
      );
      const projectId = idempotency.replayResourceId ?? input.projectId;
      if (idempotency.replayResourceId === undefined) {
        await transaction.query(
          sql(
            `INSERT INTO projects (
               project_id, organization_id, name, description,
               created_by_principal_id
             ) VALUES ($1, $2, $3, $4, $5)`,
            [
              projectId,
              scope.organizationId,
              input.name,
              input.description ?? null,
              scope.principalId,
            ],
          ),
        );
        await insertPendingObject(transaction, scope, object);
        await transaction.query(
          sql(
            `INSERT INTO architecture_drafts (
               draft_id, organization_id, project_id, draft_version,
               document_schema_version, document_object_id, content_sha256,
               semantic_sha256, visual_sha256, updated_by_principal_id
             ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)`,
            [
              input.draft.draftId,
              scope.organizationId,
              projectId,
              input.draft.documentSchemaVersion,
              object.objectId,
              input.draft.contentSha256,
              input.draft.semanticSha256,
              input.draft.visualSha256,
              scope.principalId,
            ],
          ),
        );
        await transaction.query(
          sql(
            `UPDATE projects
             SET current_draft_id = $1, updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $2 AND project_id = $3`,
            [input.draft.draftId, scope.organizationId, projectId],
          ),
        );
        await completeIdempotency(
          transaction,
          scope,
          "projects.create",
          idempotency.keySha256,
        );
        await insertAuditEvent(
          transaction,
          scope,
          "project.created",
          "project",
          projectId,
          "The project was created.",
        );
      }
      const result = await transaction.query<ProjectRow>(
        sql(
          `SELECT project_id, organization_id, name, description,
                  lifecycle_status, record_version, current_draft_id,
                  latest_revision_id, deletion_requested_at,
                  created_at, updated_at
           FROM projects
           WHERE organization_id = $1 AND project_id = $2`,
          [scope.organizationId, projectId],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new RepositoryError("not-found", "The project is not available.");
      }
      return mapProject(row);
    });
  }

  async getDraft(
    scope: AuthorizedOrganizationScope,
    projectId: string,
  ): Promise<DraftMetadataRecord | null> {
    assertScope(scope);
    assertIdentifier(projectId);
    const result = await this.#database.query<DraftRow>(
      sql(
        `SELECT d.draft_id, d.organization_id, d.project_id,
                d.draft_version, d.document_schema_version,
                d.document_object_id, d.content_sha256,
                d.semantic_sha256, d.visual_sha256
         FROM memberships m
         JOIN projects p
           ON p.organization_id = m.organization_id
          AND p.project_id = $4
         JOIN architecture_drafts d
           ON d.organization_id = p.organization_id
          AND d.project_id = p.project_id
          AND d.draft_id = p.current_draft_id
         JOIN stored_objects o
           ON o.object_id = d.document_object_id
          AND o.lifecycle_state = 'published'
         WHERE ${membershipPredicate}
           AND p.lifecycle_status IN ('active', 'archived')`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          projectId,
        ],
      ),
    );
    return result.rows[0] === undefined ? null : mapDraft(result.rows[0]);
  }

  async getDraftCommand(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    command: DraftCommandIdentity,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<DraftCommandReceipt | null> {
    assertScope(scope);
    assertIdentifier(projectId);
    return this.#database.transaction(async (transaction) => {
      await requireCurrentEnvironmentMutationAuthority(
        transaction,
        scope,
        "projects.mutate",
      );
      if (this.#draftEditingLeasesRequired)
        await assertActiveProjectEditingLease(
          transaction,
          scope,
          projectId,
          editingLease,
        );
      const project = await transaction.query(
        sql(
          "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='active' FOR SHARE",
          [scope.organizationId, projectId],
        ),
      );
      if (project.rows.length !== 1)
        throw new RepositoryError("not-found", "The project is unavailable.");
      return readDraftCommandReceipt(transaction, scope, projectId, command);
    });
  }

  async updateDraft(
    scope: AuthorizedOrganizationScope,
    input: UpdateDraftMetadataInput,
    object: StoredObjectReference,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<DraftMetadataRecord> {
    assertObject(scope, object, "architecture-draft", input.projectId);
    assertIdentifier(input.draftId);
    assertSha256(input.contentSha256);
    assertSha256(input.semanticSha256);
    assertSha256(input.visualSha256);
    if (
      input.contentSha256 !== object.contentSha256 ||
      input.expectedDraftVersion < 1
    ) {
      return invalidInput();
    }
    return this.#database.transaction(async (transaction) => {
      await requireScope(transaction, scope);
      if (input.command !== undefined)
        await requireCurrentEnvironmentMutationAuthority(
          transaction,
          scope,
          "projects.mutate",
        );
      const leaseId = this.#draftEditingLeasesRequired
        ? await assertActiveProjectEditingLease(
            transaction,
            scope,
            input.projectId,
            editingLease,
          )
        : undefined;
      const state = await transaction.query<DraftWriteStateRow>(
        sql(
          `SELECT d.draft_id, d.organization_id, d.project_id,
                  d.draft_version, d.document_schema_version,
                  d.document_object_id, d.content_sha256,
                  d.semantic_sha256, d.visual_sha256,
                  d.pending_draft_version,
                  d.pending_document_schema_version,
                  d.pending_document_object_id,
                  d.pending_content_sha256,
                  d.pending_semantic_sha256,
                  d.pending_visual_sha256,
                  ${this.#draftEditingLeasesRequired ? "d.pending_editing_lease_id" : "NULL::TEXT"} AS pending_editing_lease_id,
                  p.lifecycle_status AS project_lifecycle_status
           FROM architecture_drafts d
           JOIN projects p
             ON p.organization_id = d.organization_id
            AND p.project_id = d.project_id
           WHERE d.organization_id = $1
             AND d.project_id = $2
             AND d.draft_id = $3
           FOR UPDATE OF d, p`,
          [scope.organizationId, input.projectId, input.draftId],
        ),
      );
      const row = state.rows[0];
      if (row === undefined) {
        throw new RepositoryError(
          "version-conflict",
          "The draft changed before this save completed.",
        );
      }
      if (input.command !== undefined) {
        if (readString(row.project_lifecycle_status) !== "active")
          throw new RepositoryError(
            "version-conflict",
            "The project is unavailable.",
          );
        const replay = await readDraftCommandReceipt(
          transaction,
          scope,
          input.projectId,
          input.command,
        );
        if (replay !== null) {
          if (
            replay.metadata.documentObjectId !== object.objectId ||
            replay.metadata.contentSha256 !== object.contentSha256
          )
            throw new RepositoryError(
              "idempotency-conflict",
              "The accepted command object does not match.",
            );
          await requireMatchingStoredObject(transaction, scope, object, [
            "publication-pending",
            "published",
          ]);
          return replay.metadata;
        }
      }
      if (isPublishedDraftReplay(row, input, object)) {
        await requireMatchingStoredObject(transaction, scope, object, [
          "published",
        ]);
        return draftMetadata(scope, input, object);
      }
      if (isPendingDraftReplay(row, input, object)) {
        if (
          this.#draftEditingLeasesRequired &&
          row["pending_editing_lease_id"] !== leaseId
        )
          throw new ApplicationError(
            "conflict",
            "The pending save belongs to another editing lease.",
          );
        await requireMatchingStoredObject(transaction, scope, object, [
          "publication-pending",
          "published",
        ]);
        return draftMetadata(scope, input, object);
      }
      if (
        readNumber(row.draft_version) !== input.expectedDraftVersion ||
        !hasNoPendingDraft(row) ||
        readString(row.project_lifecycle_status) !== "active"
      ) {
        throw new RepositoryError(
          "version-conflict",
          "The draft changed before this save completed.",
        );
      }

      await insertPendingObject(transaction, scope, object);
      const result = await transaction.query(
        sql(
          `UPDATE architecture_drafts AS d
           SET pending_draft_version = d.draft_version + 1,
               pending_document_schema_version = $1,
               pending_document_object_id = $2,
               pending_content_sha256 = $3,
               pending_semantic_sha256 = $4,
               pending_visual_sha256 = $5,
               ${this.#draftEditingLeasesRequired ? "pending_editing_lease_id = $11," : ""}
               updated_by_principal_id = $6,
               updated_at = CURRENT_TIMESTAMP
           FROM projects AS p
           WHERE d.organization_id = $7
             AND d.project_id = $8
             AND d.draft_id = $9
             AND d.draft_version = $10
             AND d.pending_document_object_id IS NULL
             AND p.organization_id = d.organization_id
             AND p.project_id = d.project_id
             AND p.lifecycle_status = 'active'`,
          [
            input.documentSchemaVersion,
            object.objectId,
            input.contentSha256,
            input.semanticSha256,
            input.visualSha256,
            scope.principalId,
            scope.organizationId,
            input.projectId,
            input.draftId,
            input.expectedDraftVersion,
            ...(leaseId === undefined ? [] : [leaseId]),
          ],
        ),
      );
      if (result.rowCount !== 1) {
        throw new RepositoryError(
          "version-conflict",
          "The draft changed before this save completed.",
        );
      }
      await insertAuditEvent(
        transaction,
        scope,
        "draft.saved",
        "draft",
        input.draftId,
        "The architecture draft was autosaved.",
      );
      const metadata = draftMetadata(scope, input, object);
      if (input.command !== undefined)
        await insertDraftCommandReceipt(
          transaction,
          scope,
          input.command,
          metadata,
        );
      return metadata;
    });
  }

  async createRevision(
    scope: AuthorizedOrganizationScope,
    input: CreateRevisionMetadataInput,
    object: StoredObjectReference,
  ): Promise<RevisionMetadataRecord> {
    assertObject(scope, object, "architecture-revision", input.projectId);
    assertIdentifier(input.revisionId);
    assertIdentifier(input.sourceDraftId);
    assertIdentifier(input.validationRunId);
    if (input.previousRevisionId !== undefined) {
      assertIdentifier(input.previousRevisionId);
    }
    assertSha256(input.contentSha256);
    assertSha256(input.semanticSha256);
    assertSha256(input.visualSha256);
    assertSha256(input.sourceDraftContentSha256);
    assertSha256(input.sourceDraftSemanticSha256);
    assertSha256(input.sourceDraftVisualSha256);
    assertSha256(input.catalogSha256);
    assertTimestamp(input.createdAt);
    assertSha256(input.requestSha256);
    if (
      input.contentSha256 !== object.contentSha256 ||
      input.name.trim().length < 1 ||
      input.name.trim().length > 120 ||
      !Number.isSafeInteger(input.expectedDraftVersion) ||
      input.expectedDraftVersion < 1 ||
      !Number.isSafeInteger(input.revisionNumber) ||
      input.revisionNumber < 1 ||
      !Number.isSafeInteger(input.graphSchemaVersion) ||
      input.graphSchemaVersion < 1 ||
      !Number.isSafeInteger(input.workloadBehaviorVersion) ||
      input.workloadBehaviorVersion < 1 ||
      !Number.isSafeInteger(input.compilerInputContractVersion) ||
      input.compilerInputContractVersion < 1 ||
      input.catalogId.trim().length < 1 ||
      input.catalogVersion.trim().length < 1 ||
      input.minimumCompilerVersion.trim().length < 1 ||
      input.minimumCompilerVersion.length > 64 ||
      (input.maximumCompilerVersionExclusive !== undefined &&
        (input.maximumCompilerVersionExclusive.trim().length < 1 ||
          input.maximumCompilerVersionExclusive.length > 64))
    ) {
      return invalidInput();
    }
    return this.#database.transaction(async (transaction) => {
      await requireScope(transaction, scope);
      const idempotency = await acquireIdempotency(
        transaction,
        scope,
        "revisions.create",
        input.idempotencyKey,
        input.requestSha256,
        "revision",
        input.revisionId,
      );
      if (idempotency.replayResourceId !== undefined) {
        const replay = await transaction.query<RevisionRow>(
          sql(
            `SELECT revision_id, organization_id, project_id,
                    document_object_id, content_sha256, semantic_sha256,
                    visual_sha256, graph_schema_version,
                    workload_behavior_version, catalog_id, catalog_version,
                    catalog_sha256, source_draft_id, source_draft_version,
                    previous_revision_id, validation_run_id, created_at,
                    revision_name, revision_number,
                    compiler_input_contract_version,
                    minimum_compiler_version,
                    maximum_compiler_version_exclusive
             FROM architecture_revisions
             WHERE organization_id = $1 AND project_id = $2
               AND revision_id = $3`,
            [
              scope.organizationId,
              input.projectId,
              idempotency.replayResourceId,
            ],
          ),
        );
        const replayRow = replay.rows[0];
        if (replayRow === undefined) {
          throw new RepositoryError(
            "idempotency-conflict",
            "The revision creation request cannot be replayed.",
          );
        }
        return mapRevision(replayRow);
      }

      await requireActiveProject(transaction, scope, input.projectId);
      const draft = await transaction.query<DraftRow>(
        sql(
          `SELECT d.draft_id, d.organization_id, d.project_id, d.draft_version,
                  d.document_schema_version, d.document_object_id,
                  d.content_sha256, d.semantic_sha256, d.visual_sha256
           FROM architecture_drafts d
           JOIN projects p
             ON p.organization_id = d.organization_id
            AND p.project_id = d.project_id
            AND p.lifecycle_status = 'active'
           JOIN validation_runs v
             ON v.organization_id = d.organization_id
            AND v.project_id = d.project_id
            AND v.validation_run_id = $5
            AND v.input_kind = 'draft'
            AND v.draft_id = d.draft_id
            AND v.draft_version = d.draft_version
            AND v.lifecycle_status = 'succeeded'
           WHERE d.organization_id = $1 AND d.project_id = $2 AND d.draft_id = $3
             AND d.draft_version = $4
             AND d.pending_document_object_id IS NULL
           FOR UPDATE`,
          [
            scope.organizationId,
            input.projectId,
            input.sourceDraftId,
            input.expectedDraftVersion,
            input.validationRunId,
          ],
        ),
      );
      const draftRow = draft.rows[0];
      if (
        draftRow === undefined ||
        readString(draftRow.content_sha256) !==
          input.sourceDraftContentSha256 ||
        readString(draftRow.semantic_sha256) !==
          input.sourceDraftSemanticSha256 ||
        readString(draftRow.visual_sha256) !== input.sourceDraftVisualSha256
      ) {
        throw new RepositoryError(
          "version-conflict",
          "The validated draft changed before the revision was created.",
        );
      }
      await insertPendingObject(transaction, scope, object);
      const result = await transaction.query<RevisionRow>(
        sql(
          `INSERT INTO architecture_revisions (
             revision_id, organization_id, project_id, document_object_id,
             content_sha256, semantic_sha256, visual_sha256,
             graph_schema_version, workload_behavior_version, catalog_id,
             catalog_version, catalog_sha256, source_draft_id,
             source_draft_version, previous_revision_id, validation_run_id,
             created_at, created_by_principal_id, revision_name,
             revision_number,
             compiler_input_contract_version, minimum_compiler_version,
             maximum_compiler_version_exclusive
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17::timestamptz, $18, $19, $20, $21, $22, $23
           )
           RETURNING revision_id, organization_id, project_id,
                     document_object_id, content_sha256, semantic_sha256,
                     visual_sha256, graph_schema_version,
                     workload_behavior_version, catalog_id, catalog_version,
                     catalog_sha256, source_draft_id, source_draft_version,
                     previous_revision_id, validation_run_id, created_at,
                     revision_name, revision_number,
                     compiler_input_contract_version,
                     minimum_compiler_version,
                     maximum_compiler_version_exclusive`,
          [
            input.revisionId,
            scope.organizationId,
            input.projectId,
            object.objectId,
            input.contentSha256,
            input.semanticSha256,
            input.visualSha256,
            input.graphSchemaVersion,
            input.workloadBehaviorVersion,
            input.catalogId,
            input.catalogVersion,
            input.catalogSha256,
            input.sourceDraftId,
            input.expectedDraftVersion,
            input.previousRevisionId ?? null,
            input.validationRunId,
            input.createdAt,
            scope.principalId,
            input.name,
            input.revisionNumber,
            input.compilerInputContractVersion,
            input.minimumCompilerVersion,
            input.maximumCompilerVersionExclusive ?? null,
          ],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new RepositoryError(
          "persistence-unavailable",
          "The revision metadata could not be created.",
        );
      }
      await completeIdempotency(
        transaction,
        scope,
        "revisions.create",
        idempotency.keySha256,
      );
      await insertAuditEvent(
        transaction,
        scope,
        "revision.created",
        "revision",
        input.revisionId,
        "An immutable architecture revision was created.",
      );
      return mapRevision(row);
    });
  }
  async listRevisions(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    limit: number,
  ): Promise<readonly RevisionMetadataRecord[]> {
    assertScope(scope);
    assertIdentifier(projectId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return invalidInput();
    }
    const result = await this.#database.query<RevisionRow>(
      sql(
        `SELECT r.revision_id, r.organization_id, r.project_id,
                r.document_object_id, r.content_sha256, r.semantic_sha256,
                r.visual_sha256, r.graph_schema_version,
                r.workload_behavior_version, r.catalog_id, r.catalog_version,
                r.catalog_sha256, r.source_draft_id, r.source_draft_version,
                r.previous_revision_id, r.validation_run_id, r.created_at,
                r.revision_name, r.revision_number,
                r.compiler_input_contract_version,
                r.minimum_compiler_version,
                r.maximum_compiler_version_exclusive
         FROM memberships m
         JOIN architecture_revisions r
           ON r.organization_id = m.organization_id
          AND r.project_id = $4
         JOIN stored_objects o
           ON o.object_id = r.document_object_id
          AND o.lifecycle_state = 'published'
         WHERE ${membershipPredicate}
         ORDER BY r.created_at DESC, r.revision_id DESC
         LIMIT $5`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          projectId,
          limit,
        ],
      ),
    );
    return result.rows.map(mapRevision);
  }
  async getRevision(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    revisionId: string,
  ): Promise<RevisionMetadataRecord | null> {
    assertScope(scope);
    assertIdentifier(projectId);
    assertIdentifier(revisionId);
    const result = await this.#database.query<RevisionRow>(
      sql(
        `SELECT r.revision_id, r.organization_id, r.project_id,
                r.document_object_id, r.content_sha256, r.semantic_sha256,
                r.visual_sha256, r.graph_schema_version,
                r.workload_behavior_version, r.catalog_id, r.catalog_version,
                r.catalog_sha256, r.source_draft_id, r.source_draft_version,
                r.previous_revision_id, r.validation_run_id, r.created_at,
                r.revision_name, r.revision_number,
                r.compiler_input_contract_version,
                r.minimum_compiler_version,
                r.maximum_compiler_version_exclusive
         FROM memberships m
         JOIN architecture_revisions r
           ON r.organization_id = m.organization_id
          AND r.project_id = $4
          AND r.revision_id = $5
         JOIN stored_objects o
           ON o.object_id = r.document_object_id
          AND o.lifecycle_state = 'published'
         WHERE ${membershipPredicate}`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          projectId,
          revisionId,
        ],
      ),
    );
    return result.rows[0] === undefined ? null : mapRevision(result.rows[0]);
  }

  async getObject(
    scope: AuthorizedOrganizationScope,
    objectId: string,
  ): Promise<StoredObjectState | null> {
    assertScope(scope);
    assertIdentifier(objectId);
    const result = await this.#database.query<ObjectRow>(
      sql(
        `SELECT o.object_id, o.organization_id, o.project_id,
                o.storage_provider, o.object_purpose, o.storage_key,
                o.object_version, o.entity_tag, o.content_sha256,
                o.size_bytes, o.media_type, o.lifecycle_state,
                o.delete_requested_at, o.deleted_at
         FROM memberships m
         JOIN stored_objects o ON o.organization_id = m.organization_id
         WHERE ${membershipPredicate}
           AND o.object_id = $4`,
        [scope.membershipId, scope.principalId, scope.organizationId, objectId],
      ),
    );
    return result.rows[0] === undefined ? null : mapObject(result.rows[0]);
  }

  async markObjectPublished(
    scope: AuthorizedOrganizationScope,
    objectId: string,
    objectVersion: string,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<void> {
    assertScope(scope);
    assertIdentifier(objectId);
    if (objectVersion.length === 0 || objectVersion.length > 1024) {
      return invalidInput();
    }
    await this.#database.transaction(async (transaction) => {
      await requireScope(transaction, scope);
      let draftLeaseId: string | undefined;
      if (this.#draftEditingLeasesRequired) {
        const selected = await transaction.query(
          sql(
            "SELECT object_purpose, project_id FROM stored_objects WHERE organization_id=$1 AND object_id=$2 AND object_version=$3",
            [scope.organizationId, objectId, objectVersion],
          ),
        );
        const object = selected.rows[0];
        if (object === undefined)
          throw new RepositoryError(
            "not-found",
            "The object is not available.",
          );
        if (object["object_purpose"] === "architecture-draft") {
          if (editingLease?.proof === undefined) {
            await assertInitialDraftPublication(
              transaction,
              scope,
              objectId,
              objectVersion,
              editingLease,
            );
          } else {
            draftLeaseId = await assertActiveProjectEditingLease(
              transaction,
              scope,
              readString(object["project_id"]),
              editingLease,
            );
            const pending = await transaction.query(
              sql(
                "SELECT pending_editing_lease_id FROM architecture_drafts WHERE organization_id=$1 AND project_id=$2 AND pending_document_object_id=$3 FOR UPDATE",
                [
                  scope.organizationId,
                  readString(object["project_id"]),
                  objectId,
                ],
              ),
            );
            if (
              pending.rows.length !== 1 ||
              pending.rows[0]?.["pending_editing_lease_id"] !== draftLeaseId
            )
              throw new ApplicationError(
                "conflict",
                "The pending save belongs to another editing lease.",
              );
          }
        }
      }
      const updated = await transaction.query(
        sql(
          `UPDATE stored_objects
           SET lifecycle_state = 'published',
               published_at = COALESCE(published_at, CURRENT_TIMESTAMP)
           WHERE organization_id = $1 AND object_id = $2
             AND object_version = $3
             AND lifecycle_state IN ('publication-pending', 'published')`,
          [scope.organizationId, objectId, objectVersion],
        ),
      );
      if (updated.rowCount !== 1) {
        throw new RepositoryError("not-found", "The object is not available.");
      }
      await transaction.query(
        sql(
          `UPDATE architecture_drafts
           SET draft_version = pending_draft_version,
               document_schema_version = pending_document_schema_version,
               document_object_id = pending_document_object_id,
               content_sha256 = pending_content_sha256,
               semantic_sha256 = pending_semantic_sha256,
               visual_sha256 = pending_visual_sha256,
               pending_draft_version = NULL,
               pending_document_schema_version = NULL,
               pending_document_object_id = NULL,
               pending_content_sha256 = NULL,
               pending_semantic_sha256 = NULL,
               pending_visual_sha256 = NULL,
               ${this.#draftEditingLeasesRequired ? "pending_editing_lease_id = NULL," : ""}
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $1 AND pending_document_object_id = $2
             ${draftLeaseId === undefined ? "" : "AND pending_editing_lease_id = $3"}`,
          [
            scope.organizationId,
            objectId,
            ...(draftLeaseId === undefined ? [] : [draftLeaseId]),
          ],
        ),
      );
      await transaction.query(
        sql(
          `UPDATE projects p
           SET latest_revision_id = r.revision_id,
               record_version = p.record_version + 1,
               updated_at = CURRENT_TIMESTAMP
           FROM architecture_revisions r
           WHERE r.organization_id = $1
             AND r.document_object_id = $2
             AND p.organization_id = r.organization_id
             AND p.project_id = r.project_id`,
          [scope.organizationId, objectId],
        ),
      );
      await transaction.query(
        sql(
          `UPDATE artifacts
           SET lifecycle_status = 'ready-to-review'
           WHERE organization_id = $1
             AND manifest_object_id = $2
             AND lifecycle_status = 'publication-pending'`,
          [scope.organizationId, objectId],
        ),
      );
    });
  }

  async createGenerationJob(
    scope: AuthorizedOrganizationScope,
    input: CreateGenerationJobMetadataInput,
  ): Promise<JobMetadataRecord> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    assertIdentifier(input.revisionId);
    assertIdentifier(input.generationJobId);
    return this.#createJob(
      scope,
      "generation.create",
      input.idempotencyKey,
      input.requestSha256,
      "generation-job",
      input.generationJobId,
      async (transaction, replayId, keySha256) => {
        if (replayId === undefined) {
          await transaction.query(
            sql(
              `INSERT INTO generation_jobs (
                 generation_job_id, organization_id, project_id, revision_id,
                 generation_kind, target, request_sha256,
                 idempotency_key_sha256, created_by_principal_id
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                input.generationJobId,
                scope.organizationId,
                input.projectId,
                input.revisionId,
                input.kind,
                input.target,
                input.requestSha256,
                keySha256,
                scope.principalId,
              ],
            ),
          );
        }
        return {
          id: replayId ?? input.generationJobId,
          table: "generation_jobs",
        };
      },
    );
  }

  async createExportJob(
    scope: AuthorizedOrganizationScope,
    input: CreateExportJobMetadataInput,
  ): Promise<JobMetadataRecord> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    assertIdentifier(input.artifactId);
    assertIdentifier(input.exportJobId);
    if (
      (input.kind === "zip" && input.integrationId !== undefined) ||
      (input.kind === "github" && input.integrationId === undefined)
    ) {
      return invalidInput();
    }
    return this.#createJob(
      scope,
      "exports.create",
      input.idempotencyKey,
      input.requestSha256,
      "export-job",
      input.exportJobId,
      async (transaction, replayId, keySha256) => {
        if (replayId === undefined) {
          await transaction.query(
            sql(
              `INSERT INTO export_jobs (
                 export_job_id, organization_id, project_id, artifact_id,
                 integration_id, export_kind, request_sha256,
                 idempotency_key_sha256, created_by_principal_id
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                input.exportJobId,
                scope.organizationId,
                input.projectId,
                input.artifactId,
                input.integrationId ?? null,
                input.kind,
                input.requestSha256,
                keySha256,
                scope.principalId,
              ],
            ),
          );
        }
        return { id: replayId ?? input.exportJobId, table: "export_jobs" };
      },
    );
  }

  async #createJob(
    scope: AuthorizedOrganizationScope,
    operationName: string,
    idempotencyKey: string,
    requestSha256: string,
    resourceKind: string,
    resourceId: string,
    insert: (
      transaction: SqlExecutor,
      replayId: string | undefined,
      keySha256: string,
    ) => Promise<{ readonly id: string; readonly table: string }>,
  ): Promise<JobMetadataRecord> {
    assertSha256(requestSha256);
    return this.#database.transaction(async (transaction) => {
      await requireScope(transaction, scope);
      const idempotency = await acquireIdempotency(
        transaction,
        scope,
        operationName,
        idempotencyKey,
        requestSha256,
        resourceKind,
        resourceId,
      );
      const inserted = await insert(
        transaction,
        idempotency.replayResourceId,
        idempotency.keySha256,
      );
      if (idempotency.replayResourceId === undefined) {
        await completeIdempotency(
          transaction,
          scope,
          operationName,
          idempotency.keySha256,
        );
      }
      const identifierColumn =
        inserted.table === "generation_jobs"
          ? "generation_job_id"
          : "export_job_id";
      const queryText =
        inserted.table === "generation_jobs"
          ? `SELECT generation_job_id AS id, project_id, lifecycle_status
             FROM generation_jobs
             WHERE organization_id = $1 AND generation_job_id = $2`
          : `SELECT export_job_id AS id, project_id, lifecycle_status
             FROM export_jobs
             WHERE organization_id = $1 AND export_job_id = $2`;
      if (identifierColumn.length === 0) {
        return invalidInput();
      }
      const result = await transaction.query<JobRow>(
        sql(queryText, [scope.organizationId, inserted.id]),
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new RepositoryError("not-found", "The job is not available.");
      }
      return {
        id: readString(row.id),
        lifecycleStatus: readString(
          row.lifecycle_status,
        ) as JobMetadataRecord["lifecycleStatus"],
        projectId: readString(row.project_id),
      };
    });
  }

  async upsertProjectIntegration(
    scope: AuthorizedOrganizationScope,
    input: UpsertProjectIntegrationInput,
  ): Promise<void> {
    assertScope(scope);
    assertIdentifier(input.projectId);
    assertIdentifier(input.integrationId);
    const result = await this.#database.query(
      sql(
        `INSERT INTO project_integrations (
           integration_id, organization_id, project_id, integration_kind,
           display_name, lifecycle_status, external_account_reference,
           credential_secret_reference, created_by_principal_id
         )
         SELECT $4, p.organization_id, p.project_id, 'github', $5, $6,
                $7, $8, $2
         FROM memberships m
         JOIN projects p
           ON p.organization_id = m.organization_id
          AND p.project_id = $9
         WHERE ${membershipPredicate}
         ON CONFLICT (integration_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             lifecycle_status = EXCLUDED.lifecycle_status,
             external_account_reference = EXCLUDED.external_account_reference,
             credential_secret_reference = EXCLUDED.credential_secret_reference,
             record_version = project_integrations.record_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE project_integrations.organization_id = EXCLUDED.organization_id
           AND project_integrations.project_id = EXCLUDED.project_id`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          input.integrationId,
          input.displayName,
          input.lifecycleStatus,
          input.externalAccountReference ?? null,
          input.credentialSecretReference ?? null,
          input.projectId,
        ],
      ),
    );
    if (result.rowCount !== 1) {
      throw new RepositoryError("access-denied", "Access is not available.");
    }
  }

  async appendAuditEvent(
    scope: AuthorizedOrganizationScope,
    input: AppendAuditEventInput,
  ): Promise<void> {
    assertScope(scope);
    assertIdentifier(input.auditEventId);
    if (input.targetId !== undefined && !opaqueIdPattern.test(input.targetId)) {
      return invalidInput();
    }
    await this.#database.transaction(async (transaction) => {
      await requireScope(transaction, scope);
      await transaction.query(
        sql(
          `INSERT INTO audit_events (
             audit_event_id, organization_id, actor_principal_id, action,
             target_kind, target_id, outcome, safe_summary, correlation_id,
             occurred_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            input.auditEventId,
            scope.organizationId,
            scope.principalId,
            input.action,
            input.targetKind,
            input.targetId ?? null,
            input.outcome,
            input.safeSummary,
            scope.correlationId,
            input.occurredAt,
          ],
        ),
      );
    });
  }
}
