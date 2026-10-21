import { createHash } from "node:crypto";

import {
  applyDraftCommandV1Schema,
  draftArchitectureDocumentV1Schema,
  type ApplyDraftCommandV1,
  type ApplyDraftCommandResultV1,
  projectV1Schema,
  type ArchiveProjectV1,
  type CreateProjectResultV1,
  type CreateProjectV1,
  type DraftArchitectureDocumentV1,
  type PresentationPreferencesV1,
  type ProjectSummaryV1,
  type ProjectV1,
  type RenameProjectV1,
  type SaveDraftV1,
  type UpdatePresentationPreferencesV1,
} from "@cloudmarkup/api-contract";
import { migrateCloudMarkupDocument } from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";

import type { OrganizationPermission } from "./authorization.js";
import { hasMatchingDraftDocumentIdentity } from "./draft-document-identity.js";
import { ApplicationError } from "./errors.js";
import { applyBoundDraftCommand } from "./apply-draft-command.js";
import { requireRecentAuthentication } from "./identity.js";
import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  DraftMetadataRecord,
  ObjectStore,
  ProjectRecord,
  RepositoryErrorCode,
  StoredObjectState,
} from "./persistence.js";
import { ObjectStoreError, RepositoryError } from "./persistence.js";
import type {
  CloudMarkupApplication,
  PageOptions,
  PageResult,
  PrincipalContext,
  VersionedResult,
} from "./ports.js";
import {
  createRepositoryBackedSolutionApplicationOverrides,
  digest,
  etag,
  sha256,
  stableSuffix,
  type RepositoryBackedSolutionApplicationOptions,
} from "./repository-backed-solution-application.js";
import { ObjectPublicationCoordinator } from "../adapters/persistence/publication.js";
import type { DraftWriteLeaseContext } from "./project-editing-leases.js";
import {
  createDocumentStageInput,
  createInitialArchitectureDocument,
  getArchitectureDocumentStorage,
  rebindArchitectureDocumentCopy,
  type ArchitectureDocumentIdentity,
} from "./architecture-document-storage.js";

const DOCUMENT_IDEMPOTENCY_TIME = "2026-08-15T00:00:00.000Z";
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

type RepositoryBackedApplicationOverrides = Pick<
  CloudMarkupApplication,
  | "applyDraftCommand"
  | "archiveProject"
  | "createProject"
  | "deleteProject"
  | "getDraft"
  | "getPresentationPreferences"
  | "getProject"
  | "listProjects"
  | "renameProject"
  | "saveDraft"
  | "updatePresentationPreferences"
>;

function mapRepositoryError(error: unknown): never {
  if (error instanceof ApplicationError) {
    throw error;
  }
  if (error instanceof RepositoryError) {
    const codeByRepositoryCode: Readonly<
      Record<
        RepositoryErrorCode,
        ConstructorParameters<typeof ApplicationError>[0]
      >
    > = {
      "access-denied": "access_denied",
      "idempotency-conflict": "idempotency_key_reused",
      "invalid-input": "invalid_request",
      "not-found": "not_found",
      "persistence-unavailable": "service_unavailable",
      "version-conflict": "precondition_failed",
    };
    throw new ApplicationError(
      codeByRepositoryCode[error.code],
      error.code === "persistence-unavailable"
        ? "Persistence is temporarily unavailable."
        : error.message,
    );
  }
  if (error instanceof ObjectStoreError) {
    throw new ApplicationError(
      error.code === "invalid-input" || error.code === "content-mismatch"
        ? "invalid_request"
        : error.code === "not-found"
          ? "not_found"
          : "service_unavailable",
      error.code === "invalid-input" || error.code === "content-mismatch"
        ? "The Architecture Document could not be stored."
        : "Object storage is temporarily unavailable.",
    );
  }
  if (
    error instanceof Error &&
    (error.name === "ZodError" ||
      error.name === "ArchitectureDocumentSchemaError" ||
      error.name === "ArchitectureDocumentSemanticError")
  ) {
    throw new ApplicationError(
      "invalid_request",
      "The Architecture Document is invalid.",
    );
  }
  throw new ApplicationError(
    "internal_error",
    "The API could not complete the request.",
  );
}

function projectLifecycleFilter(
  value: string | undefined,
): ProjectRecord["lifecycleStatus"] | undefined {
  return value === "active" ||
    value === "archived" ||
    value === "deletion-pending" ||
    value === "deleted"
    ? value
    : undefined;
}

export interface RepositoryBackedApplicationOptions {
  readonly draftEditingLeases?: "required" | "disabled";
  readonly createInitialDocument?: typeof createInitialArchitectureDocument;
  readonly additionalOverrides?: Partial<CloudMarkupApplication>;
  readonly clock?: () => Date;
  readonly fallback: CloudMarkupApplication;
  readonly identifierNamespace: string;
  readonly objectStore: ObjectStore;
  readonly organizationForProject: (
    principal: PrincipalContext,
    projectId: string,
  ) => Promise<string | null> | string | null;
  readonly organizationForRequestedScope: (
    principal: PrincipalContext,
    organizationId: string,
  ) => Promise<string | null> | string | null;
  readonly repository: CloudMarkupRepository;
  readonly solutionRevisions?: Pick<
    RepositoryBackedSolutionApplicationOptions,
    | "selectToolsForFreeze"
    | "principalDisplayName"
    | "solutionRecords"
    | "validation"
    | "acceptedIntents"
  >;
}

class RepositoryBackedApplication implements RepositoryBackedApplicationOverrides {
  readonly #clock: () => Date;
  readonly #identifierNamespace: string;
  readonly #objectStore: ObjectStore;
  readonly #organizationForProject: RepositoryBackedApplicationOptions["organizationForProject"];
  readonly #organizationForRequestedScope: RepositoryBackedApplicationOptions["organizationForRequestedScope"];
  readonly #publication: ObjectPublicationCoordinator;
  readonly #repository: CloudMarkupRepository;
  readonly #draftEditingLeasesRequired: boolean;
  readonly #createInitialDocument: typeof createInitialArchitectureDocument;

  constructor(options: RepositoryBackedApplicationOptions) {
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(options.identifierNamespace)) {
      throw new TypeError("The application identifier namespace is invalid.");
    }
    this.#clock = options.clock ?? (() => new Date());
    this.#createInitialDocument =
      options.createInitialDocument ?? createInitialArchitectureDocument;
    this.#identifierNamespace = options.identifierNamespace;
    this.#objectStore = options.objectStore;
    this.#organizationForProject = options.organizationForProject;
    this.#organizationForRequestedScope = options.organizationForRequestedScope;
    this.#publication = new ObjectPublicationCoordinator(
      options.repository,
      options.objectStore,
    );
    this.#repository = options.repository;
    this.#draftEditingLeasesRequired =
      options.draftEditingLeases === "required";
  }

  async getPresentationPreferences(
    principal: PrincipalContext,
  ): Promise<VersionedResult<PresentationPreferencesV1>> {
    try {
      const found =
        await this.#repository.getPresentationPreferences(principal);
      const value = found ?? {
        contextualLearningEnabled: true,
        experienceMode: "guided" as const,
        syncVersion: 1,
        updatedAt: this.#clock().toISOString(),
      };
      return {
        etag: etag("preferences", principal.principalId, value.syncVersion),
        value: { contractVersion: 1, ...value },
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async updatePresentationPreferences(
    principal: PrincipalContext,
    input: UpdatePresentationPreferencesV1,
    expectedEtag: string,
  ): Promise<VersionedResult<PresentationPreferencesV1>> {
    try {
      const current =
        await this.#repository.getPresentationPreferences(principal);
      const expectedVersion = current?.syncVersion ?? 0;
      const currentEtag = etag(
        "preferences",
        principal.principalId,
        current?.syncVersion ?? 1,
      );
      if (expectedEtag !== currentEtag) {
        throw new ApplicationError(
          "precondition_failed",
          "Presentation preferences changed on another device.",
        );
      }
      const updated = await this.#repository.updatePresentationPreferences(
        principal,
        {
          contextualLearningEnabled: input.contextualLearningEnabled,
          experienceMode: input.experienceMode,
        },
        expectedVersion,
      );
      return {
        etag: etag("preferences", principal.principalId, updated.syncVersion),
        value: { contractVersion: 1, ...updated },
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async listProjects(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<ProjectSummaryV1>> {
    try {
      const scope = await this.#requireOrganizationScope(
        principal,
        organizationId,
        "projects.read",
      );
      const lifecycleStatus = projectLifecycleFilter(options.filters["status"]);
      const result = await this.#repository.listProjects(scope, {
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(lifecycleStatus === undefined ? {} : { lifecycleStatus }),
        limit: options.limit,
      });
      const items = await Promise.all(
        result.items.map(async (record) => {
          const project = await this.#mapProject(scope, record);
          const { description, environmentCount, ...summary } = project;
          void description;
          void environmentCount;
          return summary;
        }),
      );
      items.sort((left, right) =>
        options.sort?.includes("name") === true
          ? left.name.localeCompare(right.name)
          : left.updatedAt.localeCompare(right.updatedAt),
      );
      if (options.sort?.startsWith("-") === true) {
        items.reverse();
      }
      return {
        items,
        ...(result.nextCursor === undefined
          ? {}
          : { nextCursor: result.nextCursor }),
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async createProject(
    principal: PrincipalContext,
    organizationId: string,
    input: CreateProjectV1,
    idempotencyKey: string,
  ): Promise<CreateProjectResultV1> {
    try {
      const scope = await this.#requireOrganizationScope(
        principal,
        organizationId,
        "projects.create",
      );
      const suffix = stableSuffix(
        organizationId,
        principal.principalId,
        idempotencyKey,
      );
      const projectId = `project_${this.#identifierNamespace}_${suffix}`;
      const draftId = `draft_${this.#identifierNamespace}_${suffix}`;
      const requestSha256 = sha256({ input, organizationId });
      const identity: ArchitectureDocumentIdentity = {
        architectureId: `architecture_${this.#identifierNamespace}_${suffix}`,
        documentId: `document_${this.#identifierNamespace}_${suffix}`,
        draftId,
        principalId: principal.principalId,
        revisionId: `document_revision_${this.#identifierNamespace}_${suffix}`,
      };
      const initialInput = {
        blank: true,
        createdAt: DOCUMENT_IDEMPOTENCY_TIME,
        identity,
        infrastructureOnly: true,
      };
      let document =
        input.creationMode === "draft-copy"
          ? rebindArchitectureDocumentCopy({
              architectureDocument: input.architectureDocument,
              createdAt: DOCUMENT_IDEMPOTENCY_TIME,
              identity,
            })
          : this.#createInitialDocument(initialInput);
      if (
        input.creationMode !== "draft-copy" &&
        this.#createInitialDocument !== createInitialArchitectureDocument
      ) {
        // Preserve an already committed example-catalog creation on exact-key replay.
        // The normal publication and request-hash checks still verify its original bytes.
        const prior = await this.#repository.getObject(
          scope,
          `object_${this.#identifierNamespace}_${suffix}_draft_v1`,
        );
        if (prior !== null) {
          const legacy = createInitialArchitectureDocument(initialInput);
          if (
            prior.contentSha256 ===
            getArchitectureDocumentStorage(legacy).contentSha256
          )
            document = legacy;
        }
      }
      const storage = getArchitectureDocumentStorage(document);
      const project = await this.#publication.publish(
        scope,
        createDocumentStageInput({
          document,
          objectId: `object_${this.#identifierNamespace}_${suffix}_draft_v1`,
          organizationId,
          projectId,
        }),
        (object) =>
          this.#repository.createProjectWithInitialDraft(
            scope,
            {
              ...(input.description === undefined
                ? {}
                : { description: input.description }),
              draft: {
                contentSha256: storage.contentSha256,
                documentSchemaVersion: 3,
                draftId,
                semanticSha256: storage.semanticSha256,
                visualSha256: storage.visualSha256,
              },
              idempotencyKey,
              name: input.name,
              projectId,
              requestSha256,
            },
            object,
          ),
        { principal: structuredClone(principal) },
      );
      return {
        draft: { id: draftId, version: 1 },
        project: await this.#mapProject(scope, project, 1),
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async getProject(
    principal: PrincipalContext,
    projectId: string,
  ): Promise<VersionedResult<ProjectV1>> {
    try {
      const { project, scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.read",
      );
      return {
        etag: etag("project", projectId, project.recordVersion),
        value: await this.#mapProject(scope, project),
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async renameProject(
    principal: PrincipalContext,
    projectId: string,
    input: RenameProjectV1,
    expectedEtag: string,
  ): Promise<VersionedResult<ProjectV1>> {
    try {
      const { project, scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.mutate",
      );
      this.#requireProjectEtag(project, expectedEtag);
      const renamed = await this.#repository.renameProject(scope, {
        expectedRecordVersion: project.recordVersion,
        name: input.name,
        projectId,
      });
      return {
        etag: etag("project", projectId, renamed.recordVersion),
        value: await this.#mapProject(scope, renamed),
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async archiveProject(
    principal: PrincipalContext,
    projectId: string,
    input: ArchiveProjectV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ProjectV1>> {
    try {
      const { project, scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.mutate",
      );
      this.#requireProjectEtag(project, expectedEtag);
      const draft = await this.#requireDraftMetadata(scope, projectId);
      const archived = await this.#repository.archiveProject(scope, {
        expectedRecordVersion: project.recordVersion,
        idempotencyKey,
        projectId,
        requestSha256: sha256({ expectedEtag, input, projectId }),
      });
      return {
        etag: etag("project", projectId, archived.recordVersion),
        value: await this.#mapProject(scope, archived, draft.draftVersion),
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async deleteProject(
    principal: PrincipalContext,
    projectId: string,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ProjectV1>> {
    try {
      const { project, scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.delete",
      );
      requireRecentAuthentication(principal, this.#clock());
      this.#requireProjectEtag(project, expectedEtag);
      const draft = await this.#requireDraftMetadata(scope, projectId);
      const deleted = await this.#repository.deleteProject(scope, {
        expectedRecordVersion: project.recordVersion,
        idempotencyKey,
        projectId,
        requestSha256: sha256({ expectedEtag, projectId }),
      });
      return {
        etag: etag("project", projectId, deleted.recordVersion),
        value: await this.#mapProject(scope, deleted, draft.draftVersion),
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async getDraft(
    principal: PrincipalContext,
    projectId: string,
  ): Promise<VersionedResult<DraftArchitectureDocumentV1>> {
    try {
      const { project, scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.read",
      );
      const metadata = await this.#requireDraftMetadata(scope, projectId);
      return {
        etag: etag("draft", metadata.draftId, metadata.draftVersion),
        value: await this.#readDraft(scope, metadata, project.updatedAt),
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async applyDraftCommand(
    principal: PrincipalContext,
    projectId: string,
    raw: ApplyDraftCommandV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ApplyDraftCommandResultV1>> {
    try {
      const input = applyDraftCommandV1Schema.parse(raw);
      const editingLease: DraftWriteLeaseContext = {
        principal: structuredClone(principal),
        ...(input.editingLease === undefined
          ? {}
          : { proof: structuredClone(input.editingLease) }),
      };
      if (this.#draftEditingLeasesRequired && editingLease.proof === undefined)
        throw new ApplicationError(
          "precondition_required",
          "Acquire this project's editing lease before accepting changes.",
        );
      const lookup = this.#repository.getDraftCommand?.bind(this.#repository);
      if (lookup === undefined)
        throw new ApplicationError(
          "service_unavailable",
          "Durable command acceptance is unavailable.",
        );
      const { scope, project } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.mutate",
      );
      if (project.lifecycleStatus !== "active")
        throw new ApplicationError(
          "conflict",
          "Only an active project draft can be changed.",
        );
      // Authentication/lease proofs are current authority, not request content.
      const command = {
        commandId: input.command.commandId,
        idempotencyKey,
        requestSha256: createHash("sha256")
          .update(
            serializeCanonicalJson({
              contractVersion: input.contractVersion,
              command: input.command,
              ...(input.contentBinding === undefined
                ? {}
                : { contentBinding: input.contentBinding }),
              expectedEtag,
            }),
          )
          .digest("hex"),
      };
      let receipt = await lookup(scope, projectId, command, editingLease);
      if (receipt === null) {
        const current = await this.#requireDraftMetadata(scope, projectId);
        await this.#requireDraftEtag(scope, project, current, expectedEtag);
        const baseline = await this.#readDraft(
          scope,
          current,
          project.updatedAt,
        );
        const document = applyBoundDraftCommand(
          baseline.architectureDocument,
          input,
        ).document;
        const storage = getArchitectureDocumentStorage(document);
        const objectId = `object_${this.#identifierNamespace}_command_${stableSuffix(
          scope.organizationId,
          projectId,
          principal.principalId,
          idempotencyKey,
          command.requestSha256,
        )}`;
        await this.#publication.publish(
          scope,
          createDocumentStageInput({
            document,
            objectId,
            organizationId: scope.organizationId,
            projectId,
          }),
          (object) =>
            this.#repository.updateDraft(
              scope,
              {
                command,
                contentSha256: storage.contentSha256,
                documentSchemaVersion: 3,
                draftId: current.draftId,
                expectedDraftVersion: current.draftVersion,
                projectId,
                semanticSha256: storage.semanticSha256,
                visualSha256: storage.visualSha256,
              },
              object,
              editingLease,
            ),
          editingLease,
        );
        receipt = await lookup(scope, projectId, command, editingLease);
      }
      if (receipt === null)
        throw new ApplicationError(
          "service_unavailable",
          "The accepted command is unavailable.",
        );
      const object = await this.#repository.getObject(
        scope,
        receipt.metadata.documentObjectId,
      );
      if (object === null)
        throw new ApplicationError(
          "service_unavailable",
          "The accepted command is unavailable.",
        );
      await this.#publication.recover(scope, object, editingLease);
      // Recovery may have supplied the first publication timestamp. Recheck
      // current authority after storage I/O and return the exact retained version.
      receipt = await lookup(scope, projectId, command, editingLease);
      if (receipt === null)
        throw new ApplicationError(
          "service_unavailable",
          "The accepted command is unavailable.",
        );
      const draft = await this.#readDraft(
        scope,
        receipt.metadata,
        receipt.updatedAt,
      );
      await lookup(scope, projectId, command, editingLease);
      return {
        etag: etag("draft", draft.id, draft.version),
        value: { appliedCommandId: receipt.commandId, draft },
      };
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async saveDraft(
    principal: PrincipalContext,
    projectId: string,
    input: SaveDraftV1,
    expectedEtag: string,
  ): Promise<VersionedResult<DraftArchitectureDocumentV1>> {
    const editingLease: DraftWriteLeaseContext = {
      principal: structuredClone(principal),
      ...(input.editingLease === undefined
        ? {}
        : { proof: structuredClone(input.editingLease) }),
    };
    if (this.#draftEditingLeasesRequired && editingLease.proof === undefined)
      throw new ApplicationError(
        "precondition_required",
        "Acquire this project's editing lease before saving.",
      );
    let scope: AuthorizedOrganizationScope | undefined;
    try {
      const found = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.mutate",
      );
      const authorizedScope = found.scope;
      scope = authorizedScope;
      if (found.project.lifecycleStatus !== "active") {
        throw new ApplicationError(
          "conflict",
          "Only an active project draft can be saved.",
        );
      }
      const current = await this.#requireDraftMetadata(scope, projectId);
      await this.#requireDraftEtag(scope, found.project, current, expectedEtag);
      const migration = migrateCloudMarkupDocument(input.architectureDocument);
      if (!migration.ok) {
        throw new ApplicationError(
          migration.classification === "unsupported-future"
            ? "unsupported_version"
            : "invalid_request",
          migration.classification === "unsupported-future"
            ? "This Architecture Document version is not supported."
            : "The Architecture Document is invalid.",
        );
      }
      if (migration.schemaType !== "cloudmarkup.architecture-document") {
        throw new ApplicationError(
          "invalid_request",
          "The request must contain an Architecture Document.",
        );
      }
      const document = architectureDocumentV3Schema.parse(migration.document);
      const currentDocument = architectureDocumentV3Schema.parse(
        (await this.#readDraft(scope, current, found.project.updatedAt))
          .architectureDocument,
      );
      if (
        !hasMatchingDraftDocumentIdentity({
          candidate: document,
          current: currentDocument,
          currentDraftId: current.draftId,
        })
      ) {
        throw new ApplicationError(
          "invalid_request",
          "Draft identity cannot change during save. Create a project copy instead.",
        );
      }
      const storage = getArchitectureDocumentStorage(document);
      const objectId = `object_${this.#identifierNamespace}_draft_${stableSuffix(
        current.draftId,
        String(current.draftVersion + 1),
        storage.contentSha256,
        ...(this.#draftEditingLeasesRequired && editingLease.proof !== undefined
          ? [editingLease.proof.leaseId]
          : []),
      )}`;
      await this.#publication.publish(
        scope,
        createDocumentStageInput({
          document,
          objectId,
          organizationId: scope.organizationId,
          projectId,
        }),
        (object) =>
          this.#repository.updateDraft(
            authorizedScope,
            {
              contentSha256: storage.contentSha256,
              documentSchemaVersion: 3,
              draftId: current.draftId,
              expectedDraftVersion: current.draftVersion,
              projectId,
              semanticSha256: storage.semanticSha256,
              visualSha256: storage.visualSha256,
            },
            object,
            editingLease,
          ),
        editingLease,
      );
      const updated = await this.#requireDraftMetadata(scope, projectId);
      return {
        etag: etag("draft", updated.draftId, updated.draftVersion),
        value: await this.#readDraft(
          scope,
          updated,
          this.#clock().toISOString(),
        ),
      };
    } catch (error) {
      if (
        scope !== undefined &&
        error instanceof RepositoryError &&
        error.code === "version-conflict"
      ) {
        const project = await this.#repository.getProject(scope, projectId);
        const current = await this.#repository.getDraft(scope, projectId);
        if (project !== null && current !== null) {
          throw this.#draftConflict(current, project.updatedAt);
        }
      }
      return mapRepositoryError(error);
    }
  }

  async #requireOrganizationScope(
    principal: PrincipalContext,
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<AuthorizedOrganizationScope> {
    if (
      (await this.#organizationForRequestedScope(principal, organizationId)) !==
      organizationId
    ) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    const scope = await this.#repository.resolveOrganizationScope(
      principal,
      organizationId,
    );
    if (scope === null) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    if (!scope.capabilities.includes(permission)) {
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    }
    return scope;
  }

  async #requireProjectScope(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<{
    readonly project: ProjectRecord;
    readonly scope: AuthorizedOrganizationScope;
  }> {
    const organizationId = await this.#organizationForProject(
      principal,
      projectId,
    );
    if (organizationId === null) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    const scope = await this.#repository.resolveOrganizationScope(
      principal,
      organizationId,
    );
    if (scope === null) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    if (!scope.capabilities.includes(permission)) {
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    }
    const project = await this.#repository.getProject(scope, projectId);
    if (project === null) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    return { project, scope };
  }

  async #requireDraftMetadata(
    scope: AuthorizedOrganizationScope,
    projectId: string,
  ): Promise<DraftMetadataRecord> {
    const draft = await this.#repository.getDraft(scope, projectId);
    if (draft === null) {
      throw new RepositoryError("not-found", "The draft is not available.");
    }
    return draft;
  }

  async #requireObject(
    scope: AuthorizedOrganizationScope,
    objectId: string,
  ): Promise<StoredObjectState> {
    const object = await this.#repository.getObject(scope, objectId);
    if (object?.lifecycleState !== "published") {
      throw new RepositoryError("not-found", "The object is not available.");
    }
    return object;
  }

  async #readDraft(
    scope: AuthorizedOrganizationScope,
    metadata: DraftMetadataRecord,
    updatedAt: string,
  ): Promise<DraftArchitectureDocumentV1> {
    const object = await this.#requireObject(scope, metadata.documentObjectId);
    const body = await this.#objectStore.open(scope, object);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > MAX_DOCUMENT_BYTES) {
        throw new ApplicationError(
          "payload_too_large",
          "The stored Architecture Document exceeds the API limit.",
        );
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ApplicationError(
        "service_unavailable",
        "The stored Architecture Document is unavailable.",
      );
    }
    let architectureDocument;
    try {
      architectureDocument = architectureDocumentV3Schema.parse(decoded);
    } catch {
      throw new ApplicationError(
        "service_unavailable",
        "The stored Architecture Document is unavailable.",
      );
    }
    return draftArchitectureDocumentV1Schema.parse({
      architectureDocument,
      contentDigest: digest(metadata.semanticSha256),
      documentDigest: digest(metadata.contentSha256),
      id: metadata.draftId,
      projectId: metadata.projectId,
      semanticDigest: digest(metadata.semanticSha256),
      storageStatus: "published",
      updatedAt,
      version: metadata.draftVersion,
      visualDigest: digest(metadata.visualSha256),
    });
  }

  async #mapProject(
    scope: AuthorizedOrganizationScope,
    record: ProjectRecord,
    knownDraftVersion?: number,
  ): Promise<ProjectV1> {
    const draftVersion =
      knownDraftVersion ??
      (await this.#repository.getDraft(scope, record.projectId))
        ?.draftVersion ??
      1;
    const environments = await this.#repository.listProjectEnvironments(
      scope,
      record.projectId,
    );
    return projectV1Schema.parse({
      createdAt: record.createdAt,
      currentDraft: { id: record.currentDraftId, version: draftVersion },
      ...(record.description === undefined
        ? {}
        : { description: record.description }),
      environmentCount: environments.filter(
        (environment) => environment.lifecycleStatus === "active",
      ).length,
      id: record.projectId,
      ...(record.latestRevisionId === undefined
        ? {}
        : { latestRevisionId: record.latestRevisionId }),
      lifecycleStatus: record.lifecycleStatus,
      name: record.name,
      organizationId: record.organizationId,
      ...(record.deletionRequestedAt === undefined
        ? {}
        : { tombstoneRequestedAt: record.deletionRequestedAt }),
      updatedAt: record.updatedAt,
      version: record.recordVersion,
    });
  }

  #requireProjectEtag(project: ProjectRecord, expectedEtag: string): void {
    if (
      expectedEtag !== etag("project", project.projectId, project.recordVersion)
    ) {
      throw new ApplicationError(
        "precondition_failed",
        "The project changed. Refresh and try again.",
      );
    }
  }

  async #requireDraftEtag(
    scope: AuthorizedOrganizationScope,
    project: ProjectRecord,
    draft: DraftMetadataRecord,
    expectedEtag: string,
  ): Promise<void> {
    if (expectedEtag !== etag("draft", draft.draftId, draft.draftVersion)) {
      const current = await this.#repository.getDraft(scope, project.projectId);
      throw this.#draftConflict(current ?? draft, project.updatedAt);
    }
  }

  #draftConflict(
    draft: DraftMetadataRecord,
    updatedAt: string,
  ): ApplicationError {
    const currentEtag = etag("draft", draft.draftId, draft.draftVersion);
    return new ApplicationError(
      "precondition_failed",
      "The draft changed. Reload, compare metadata, or save your work as a copy.",
      {
        conflict: {
          current: {
            contentDigest: digest(draft.contentSha256),
            etag: currentEtag,
            semanticDigest: digest(draft.semanticSha256),
            updatedAt,
            version: draft.draftVersion,
            visualDigest: digest(draft.visualSha256),
          },
          recovery: { canCompare: true, canCopy: true, canReload: true },
          resourceId: draft.draftId,
          resourceKind: "draft",
        },
      },
    );
  }
}

/** Durable project and draft composition over an authorized repository/store. */
export function createRepositoryBackedApplication(
  options: RepositoryBackedApplicationOptions,
): CloudMarkupApplication {
  const durable = new RepositoryBackedApplication(options);
  const solutionRevisionOverrides =
    options.solutionRevisions === undefined
      ? undefined
      : createRepositoryBackedSolutionApplicationOverrides({
          identifierNamespace: options.identifierNamespace,
          objectStore: options.objectStore,
          organizationForProject: options.organizationForProject,
          repository: options.repository,
          ...options.solutionRevisions,
        });
  const overrides: Partial<CloudMarkupApplication> = {
    applyDraftCommand: durable.applyDraftCommand.bind(durable),
    archiveProject: durable.archiveProject.bind(durable),
    createProject: durable.createProject.bind(durable),
    deleteProject: durable.deleteProject.bind(durable),
    getDraft: durable.getDraft.bind(durable),
    getPresentationPreferences:
      durable.getPresentationPreferences.bind(durable),
    getProject: durable.getProject.bind(durable),
    listProjects: durable.listProjects.bind(durable),
    renameProject: durable.renameProject.bind(durable),
    saveDraft: durable.saveDraft.bind(durable),
    updatePresentationPreferences:
      durable.updatePresentationPreferences.bind(durable),
    ...solutionRevisionOverrides,
    ...options.additionalOverrides,
  };
  return new Proxy(options.fallback, {
    get(target, property, receiver): unknown {
      if (typeof property === "string" && property in overrides) {
        const override = overrides[property as keyof CloudMarkupApplication];
        return typeof override === "function"
          ? override.bind(durable)
          : override;
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function"
        ? (value.bind(target) as unknown)
        : value;
    },
  });
}
