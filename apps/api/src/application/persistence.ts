import type { DraftWriteLeaseContext } from "./project-editing-leases.js";

export interface VerifiedPrincipalContext {
  readonly correlationId: string;
  readonly principalId: string;
  readonly sessionId: string;
}

export interface AuthorizedOrganizationScope extends VerifiedPrincipalContext {
  readonly capabilities: readonly string[];
  readonly membershipId: string;
  readonly organizationId: string;
  readonly roleKey: string;
}

export interface PresentationPreferenceRecord {
  readonly contextualLearningEnabled: boolean;
  readonly experienceMode: "guided" | "professional";
  readonly syncVersion: number;
  readonly updatedAt: string;
}

export interface ObjectOwner {
  readonly organizationId: string;
  readonly projectId?: string;
}

export const OBJECT_PURPOSES = [
  "accepted-intent",
  "architecture-draft",
  "architecture-revision",
  "validation-report",
  "generated-code",
  "diagram",
  "report",
  "artifact-manifest",
  "combined-artifact",
  "repository-snapshot",
  "observed-solution",
  "reconciliation-proposal",
  "solution-revision-manifest",
  "ai-authored-extension",
  "active-issue",
  "evidence",
  "input-payload",
  "checkpoint-state",
  "proposal",
  "generated-source",
  "build-output",
  "export-package",
  "repository-export-receipt",
  "plan-result",
  "deployment-result",
  "smoke-integration-result",
  "drift-result",
  "billing-reconciliation-result",
] as const;

export type ObjectPurpose = (typeof OBJECT_PURPOSES)[number];

export function isObjectPurpose(value: string): value is ObjectPurpose {
  return OBJECT_PURPOSES.some((purpose) => purpose === value);
}

export type StorageProvider = "s3" | "filesystem" | "memory";

export interface ObjectPayload {
  readonly contentSha256: string;
  readonly mediaType: string;
  readonly open: () => AsyncIterable<Uint8Array>;
  readonly sizeBytes: number;
}

export interface StageObjectInput extends ObjectPayload {
  readonly objectId: string;
  readonly owner: ObjectOwner;
  readonly purpose: ObjectPurpose;
}

export interface StoredObjectReference {
  readonly contentSha256: string;
  readonly entityTag?: string;
  readonly mediaType: string;
  readonly objectId: string;
  readonly objectVersion: string;
  readonly owner: ObjectOwner;
  readonly purpose: ObjectPurpose;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly storageProvider: StorageProvider;
}

export interface StoredObjectState extends StoredObjectReference {
  readonly deleteRequestedAt?: string;
  readonly deletedAt?: string;
  readonly lifecycleState:
    "publication-pending" | "published" | "delete-pending" | "deleted";
}

export interface ObjectStore {
  discardStaged(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void>;
  head(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<StoredObjectReference | null>;
  open(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<AsyncIterable<Uint8Array>>;
  publish(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void>;
  requestDeletion(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void>;
  stage(
    scope: AuthorizedOrganizationScope,
    input: StageObjectInput,
  ): Promise<StoredObjectReference>;
}

export interface InitialDraftMetadata {
  readonly contentSha256: string;
  readonly documentSchemaVersion: number;
  readonly draftId: string;
  readonly semanticSha256: string;
  readonly visualSha256: string;
}

export interface CreateProjectWithDraftInput {
  readonly description?: string;
  readonly draft: InitialDraftMetadata;
  readonly idempotencyKey: string;
  readonly name: string;
  readonly projectId: string;
  readonly requestSha256: string;
}

export interface ProjectRecord {
  readonly createdAt: string;
  readonly currentDraftId: string;
  readonly deletionRequestedAt?: string;
  readonly description?: string;
  readonly latestRevisionId?: string;
  readonly lifecycleStatus:
    "active" | "archived" | "deletion-pending" | "deleted";
  readonly name: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly recordVersion: number;
  readonly updatedAt: string;
}

export interface ProjectEnvironmentRecord {
  readonly createdAt: string;
  readonly deletionRequestedAt?: string;
  readonly environmentId: string;
  readonly environmentType:
    | "development"
    | "test"
    | "staging"
    | "production"
    | "disaster-recovery"
    | "multi-environment";
  readonly lifecycleStatus: "active" | "deletion-pending" | "deleted";
  readonly name: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly recordVersion: number;
  readonly region?: string;
  readonly updatedAt: string;
}

export interface ProjectListInput {
  readonly cursor?: string;
  readonly limit: number;
  readonly lifecycleStatus?: ProjectRecord["lifecycleStatus"];
}

export interface ProjectListResult {
  readonly items: readonly ProjectRecord[];
  readonly nextCursor?: string;
}

export interface RenameProjectMetadataInput {
  readonly expectedRecordVersion: number;
  readonly name: string;
  readonly projectId: string;
}

export interface ProjectLifecycleMetadataInput {
  readonly expectedRecordVersion: number;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly requestSha256: string;
}

export interface CreateProjectEnvironmentMetadataInput {
  readonly environmentId: string;
  readonly environmentType: ProjectEnvironmentRecord["environmentType"];
  readonly idempotencyKey: string;
  readonly name: string;
  readonly projectId: string;
  readonly region?: string;
  readonly requestSha256: string;
}

export interface UpdateProjectEnvironmentMetadataInput {
  readonly environmentId: string;
  readonly environmentType: ProjectEnvironmentRecord["environmentType"];
  readonly expectedRecordVersion: number;
  readonly name: string;
  readonly projectId: string;
  readonly region?: string;
}

export interface DraftMetadataRecord {
  readonly contentSha256: string;
  readonly documentObjectId: string;
  readonly documentSchemaVersion: number;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly organizationId: string;
  readonly projectId: string;
  readonly semanticSha256: string;
  readonly visualSha256: string;
}

export interface DraftCommandIdentity {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly requestSha256: string;
}

export interface DraftCommandReceipt {
  readonly commandId: string;
  readonly metadata: DraftMetadataRecord;
  readonly updatedAt: string;
}

export interface UpdateDraftMetadataInput {
  readonly command?: DraftCommandIdentity;
  readonly contentSha256: string;
  readonly documentSchemaVersion: number;
  readonly draftId: string;
  readonly expectedDraftVersion: number;
  readonly projectId: string;
  readonly semanticSha256: string;
  readonly visualSha256: string;
}

export interface CreateRevisionMetadataInput {
  readonly catalogId: string;
  readonly catalogSha256: string;
  readonly catalogVersion: string;
  readonly compilerInputContractVersion: number;
  readonly contentSha256: string;
  readonly createdAt: string;
  readonly expectedDraftVersion: number;
  readonly graphSchemaVersion: number;
  readonly idempotencyKey: string;
  readonly maximumCompilerVersionExclusive?: string;
  readonly minimumCompilerVersion: string;
  readonly name: string;
  readonly previousRevisionId?: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly requestSha256: string;
  readonly semanticSha256: string;
  readonly sourceDraftContentSha256: string;
  readonly sourceDraftId: string;
  readonly sourceDraftSemanticSha256: string;
  readonly sourceDraftVisualSha256: string;
  readonly validationRunId: string;
  readonly visualSha256: string;
  readonly workloadBehaviorVersion: number;
}

export interface RevisionMetadataRecord extends Omit<
  CreateRevisionMetadataInput,
  | "createdAt"
  | "expectedDraftVersion"
  | "idempotencyKey"
  | "previousRevisionId"
  | "requestSha256"
  | "sourceDraftContentSha256"
  | "sourceDraftSemanticSha256"
  | "sourceDraftVisualSha256"
> {
  readonly createdAt: string;
  readonly documentObjectId: string;
  readonly organizationId: string;
  readonly previousRevisionId?: string;
  readonly sourceDraftVersion: number;
}

export interface CreateGenerationJobMetadataInput {
  readonly generationJobId: string;
  readonly idempotencyKey: string;
  readonly kind: "infrastructure-as-code" | "diagram" | "combined-artifact";
  readonly projectId: string;
  readonly requestSha256: string;
  readonly revisionId: string;
  readonly target: "terraform" | "svg" | "png" | "combined";
}

export interface CreateExportJobMetadataInput {
  readonly artifactId: string;
  readonly exportJobId: string;
  readonly idempotencyKey: string;
  readonly integrationId?: string;
  readonly kind: "zip" | "github";
  readonly projectId: string;
  readonly requestSha256: string;
}

export interface JobMetadataRecord {
  readonly id: string;
  readonly lifecycleStatus:
    "queued" | "running" | "succeeded" | "failed" | "canceled";
  readonly projectId: string;
}

export interface UpsertProjectIntegrationInput {
  readonly credentialSecretReference?: string;
  readonly displayName: string;
  readonly externalAccountReference?: string;
  readonly integrationId: string;
  readonly lifecycleStatus:
    "connected" | "reauthorization-required" | "disabled";
  readonly projectId: string;
}

export interface AppendAuditEventInput {
  readonly action: string;
  readonly auditEventId: string;
  readonly occurredAt: string;
  readonly outcome: "succeeded" | "denied" | "failed";
  readonly safeSummary: string;
  readonly targetId?: string;
  readonly targetKind:
    | "organization"
    | "membership"
    | "project"
    | "draft"
    | "revision"
    | "artifact"
    | "integration"
    | "job";
}

export interface CloudMarkupRepository {
  archiveProject(
    scope: AuthorizedOrganizationScope,
    input: ProjectLifecycleMetadataInput,
  ): Promise<ProjectRecord>;
  appendAuditEvent(
    scope: AuthorizedOrganizationScope,
    input: AppendAuditEventInput,
  ): Promise<void>;
  createExportJob(
    scope: AuthorizedOrganizationScope,
    input: CreateExportJobMetadataInput,
  ): Promise<JobMetadataRecord>;
  createProjectEnvironment(
    scope: AuthorizedOrganizationScope,
    input: CreateProjectEnvironmentMetadataInput,
  ): Promise<ProjectEnvironmentRecord>;
  createGenerationJob(
    scope: AuthorizedOrganizationScope,
    input: CreateGenerationJobMetadataInput,
  ): Promise<JobMetadataRecord>;
  createProjectWithInitialDraft(
    scope: AuthorizedOrganizationScope,
    input: CreateProjectWithDraftInput,
    object: StoredObjectReference,
  ): Promise<ProjectRecord>;
  createRevision(
    scope: AuthorizedOrganizationScope,
    input: CreateRevisionMetadataInput,
    object: StoredObjectReference,
  ): Promise<RevisionMetadataRecord>;
  deleteProject(
    scope: AuthorizedOrganizationScope,
    input: ProjectLifecycleMetadataInput,
  ): Promise<ProjectRecord>;
  deleteProjectEnvironment(
    scope: AuthorizedOrganizationScope,
    input: {
      readonly environmentId: string;
      readonly expectedRecordVersion: number;
      readonly idempotencyKey: string;
      readonly projectId: string;
      readonly requestSha256: string;
    },
  ): Promise<ProjectEnvironmentRecord>;
  getDraft(
    scope: AuthorizedOrganizationScope,
    projectId: string,
  ): Promise<DraftMetadataRecord | null>;
  getObject(
    scope: AuthorizedOrganizationScope,
    objectId: string,
  ): Promise<StoredObjectState | null>;
  getProject(
    scope: AuthorizedOrganizationScope,
    projectId: string,
  ): Promise<ProjectRecord | null>;
  getProjectEnvironment(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    environmentId: string,
  ): Promise<ProjectEnvironmentRecord | null>;
  getPresentationPreferences(
    principal: VerifiedPrincipalContext,
  ): Promise<PresentationPreferenceRecord | null>;
  getRevision(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    revisionId: string,
  ): Promise<RevisionMetadataRecord | null>;
  listProjectEnvironments(
    scope: AuthorizedOrganizationScope,
    projectId: string,
  ): Promise<readonly ProjectEnvironmentRecord[]>;
  listProjects(
    scope: AuthorizedOrganizationScope,
    input: ProjectListInput,
  ): Promise<ProjectListResult>;
  listRevisions(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    limit: number,
  ): Promise<readonly RevisionMetadataRecord[]>;
  markObjectPublished(
    scope: AuthorizedOrganizationScope,
    objectId: string,
    objectVersion: string,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<void>;
  renameProject(
    scope: AuthorizedOrganizationScope,
    input: RenameProjectMetadataInput,
  ): Promise<ProjectRecord>;
  requestOrganizationDeletion(
    scope: AuthorizedOrganizationScope,
    input: {
      readonly expectedRecordVersion: number;
      readonly idempotencyKey: string;
      readonly requestSha256: string;
    },
  ): Promise<{
    readonly lifecycleStatus: "deletion-pending";
    readonly recordVersion: number;
  }>;
  resolveOrganizationScope(
    principal: VerifiedPrincipalContext,
    organizationId: string,
  ): Promise<AuthorizedOrganizationScope | null>;
  updateProjectEnvironment(
    scope: AuthorizedOrganizationScope,
    input: UpdateProjectEnvironmentMetadataInput,
  ): Promise<ProjectEnvironmentRecord>;
  getDraftCommand?(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    command: DraftCommandIdentity,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<DraftCommandReceipt | null>;
  updateDraft(
    scope: AuthorizedOrganizationScope,
    input: UpdateDraftMetadataInput,
    object: StoredObjectReference,
    editingLease?: DraftWriteLeaseContext,
  ): Promise<DraftMetadataRecord>;
  updatePresentationPreferences(
    principal: VerifiedPrincipalContext,
    input: Omit<PresentationPreferenceRecord, "syncVersion" | "updatedAt">,
    expectedSyncVersion: number,
  ): Promise<PresentationPreferenceRecord>;
  upsertProjectIntegration(
    scope: AuthorizedOrganizationScope,
    input: UpsertProjectIntegrationInput,
  ): Promise<void>;
}

export type RepositoryErrorCode =
  | "not-found"
  | "access-denied"
  | "version-conflict"
  | "idempotency-conflict"
  | "invalid-input"
  | "persistence-unavailable";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, safeMessage: string) {
    super(safeMessage);
    this.code = code;
    this.name = "RepositoryError";
  }
}

export class ObjectStoreError extends Error {
  readonly code:
    | "invalid-input"
    | "not-found"
    | "content-mismatch"
    | "object-conflict"
    | "storage-unavailable";

  constructor(
    code: ObjectStoreError["code"],
    safeMessage: string,
    options?: ErrorOptions,
  ) {
    super(safeMessage, options);
    this.code = code;
    this.name = "ObjectStoreError";
  }
}
