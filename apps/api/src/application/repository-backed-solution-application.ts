import { createHash } from "node:crypto";

import {
  revisionV1Schema,
  type CreateRevisionV1,
  type CreateSolutionRevisionV1,
  type RevisionSummaryV1,
  type RevisionV1,
  type SolutionRevisionSummaryV1,
  type SolutionRevisionV1,
} from "@cloudmarkup/api-contract";
import {
  getDocumentCompatibilityMetadata,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";

import type { AiIntentAcceptancePortV1 } from "./ai-intent-acceptance.js";
import { ApplicationError } from "./errors.js";
import {
  ObjectStoreError,
  RepositoryError,
  type AuthorizedOrganizationScope,
  type CloudMarkupRepository,
  type DraftMetadataRecord,
  type ObjectStore,
  type ProjectRecord,
  type RepositoryErrorCode,
  type RevisionMetadataRecord,
  type StoredObjectState,
} from "./persistence.js";
import type {
  CloudMarkupApplication,
  PageOptions,
  PageResult,
  PrincipalContext,
} from "./ports.js";
import type { RevisionValidation } from "./revision-validation.js";
import {
  buildSolutionRevisionV1,
  solutionRevisionToolSelectionsV1Schema,
  type SolutionRevisionToolSelectionsV1,
} from "./solution-revision-builder.js";
import type {
  SolutionRecordMetadata,
  SolutionRecordRepository,
} from "./solution-record-persistence.js";
import { ObjectPublicationCoordinator } from "../adapters/persistence/publication.js";
import {
  createDocumentStageInput,
  getArchitectureDocumentStorage,
  rebindImmutableArchitectureRevision,
} from "./architecture-document-storage.js";

const MAX_OBJECT_BYTES = 4 * 1024 * 1024;

export type RepositoryBackedSolutionApplicationOverrides = Pick<
  CloudMarkupApplication,
  | "createRevision"
  | "createSolutionRevision"
  | "getRevision"
  | "getSolutionRevision"
  | "listRevisions"
  | "listSolutionRevisions"
>;

export interface RepositoryBackedSolutionApplicationOptions {
  readonly acceptedIntents?: Pick<AiIntentAcceptancePortV1, "get">;
  readonly identifierNamespace: string;
  readonly objectStore: ObjectStore;
  readonly organizationForProject: (
    principal: PrincipalContext,
    projectId: string,
  ) => Promise<string | null> | string | null;
  readonly principalDisplayName?: (
    principalId: string,
  ) => Promise<string | null> | string | null;
  readonly repository: CloudMarkupRepository;
  /** Trusted server selection only; selected tools are not execution evidence. */
  readonly selectToolsForFreeze?: () => Promise<SolutionRevisionToolSelectionsV1>;
  readonly solutionRecords: SolutionRecordRepository;
  readonly validation: RevisionValidation;
}

interface RevisionPublicationInput {
  readonly draftId: string;
  readonly draftVersion: number;
  readonly expectedEtag: string;
  readonly idempotencyKey: string;
  readonly name: string;
  readonly revisionId: string;
  readonly suffix: string;
  readonly validationRunId: string;
}

type ExactDraftSelector = Pick<
  CreateRevisionV1,
  "draftId" | "draftVersion" | "name"
>;

export function etag(kind: string, id: string, version: number): string {
  return `"${kind}:${id}:v${String(version)}"`;
}

export function digest(rawSha256: string): `sha256:${string}` {
  return `sha256:${rawSha256}`;
}

export function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export function stableSuffix(...parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.join("\u0000"), "utf8")
    .digest("hex")
    .slice(0, 24);
}

export function deriveInternalValidationRunId(input: {
  readonly callerValidationRunId: string;
  readonly identifierNamespace: string;
  readonly organizationId: string;
  readonly projectId: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        "cloudmarkup.validation-run.internal.v1",
        input.identifierNamespace,
        input.organizationId,
        input.projectId,
        input.callerValidationRunId,
      ].join("\u0000"),
      "utf8",
    )
    .digest("hex");
  return `validation_${input.identifierNamespace}_${digest}`;
}

function mapPersistenceError(error: unknown): never {
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
      error.code === "not-found" ? "not_found" : "service_unavailable",
      "Immutable object storage is temporarily unavailable.",
    );
  }
  if (
    error instanceof Error &&
    (error.name === "ArchitectureDocumentSchemaError" ||
      error.name === "ArchitectureDocumentSemanticError")
  ) {
    throw new ApplicationError(
      "invalid_request",
      "The Architecture Document is not valid for an immutable Solution Revision.",
    );
  }
  throw new ApplicationError(
    "internal_error",
    "The immutable revision request could not be completed.",
  );
}

class RepositoryBackedSolutionApplication implements RepositoryBackedSolutionApplicationOverrides {
  readonly #identifierNamespace: string;
  readonly #objectStore: ObjectStore;
  readonly #organizationForProject: RepositoryBackedSolutionApplicationOptions["organizationForProject"];
  readonly #principalDisplayName: NonNullable<
    RepositoryBackedSolutionApplicationOptions["principalDisplayName"]
  >;
  readonly #publication: ObjectPublicationCoordinator;
  readonly #repository: CloudMarkupRepository;
  readonly #solutionRecords: SolutionRecordRepository;
  readonly #validation: RevisionValidation;
  readonly #selectToolsForFreeze: RepositoryBackedSolutionApplicationOptions["selectToolsForFreeze"];
  readonly #acceptedIntents: RepositoryBackedSolutionApplicationOptions["acceptedIntents"];

  constructor(options: RepositoryBackedSolutionApplicationOptions) {
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(options.identifierNamespace)) {
      throw new TypeError("The revision identifier namespace is invalid.");
    }
    if (
      options.selectToolsForFreeze !== undefined &&
      options.solutionRecords.getManifestForPublication === undefined
    ) {
      throw new TypeError(
        "Selected revision tools require interrupted-publication recovery.",
      );
    }
    this.#identifierNamespace = options.identifierNamespace;
    this.#objectStore = options.objectStore;
    this.#organizationForProject = options.organizationForProject;
    this.#principalDisplayName =
      options.principalDisplayName ?? (() => "Cloud Markup user");
    this.#publication = new ObjectPublicationCoordinator(
      options.repository,
      options.objectStore,
    );
    this.#repository = options.repository;
    this.#solutionRecords = options.solutionRecords;
    this.#validation = options.validation;
    this.#selectToolsForFreeze = options.selectToolsForFreeze;
    this.#acceptedIntents = options.acceptedIntents;
  }

  async createRevision(
    principal: PrincipalContext,
    projectId: string,
    input: CreateRevisionV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<RevisionV1> {
    try {
      const { project, scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "revisions.create",
      );
      const suffix = stableSuffix(
        "revisions.create",
        scope.organizationId,
        principal.principalId,
        projectId,
        idempotencyKey,
      );
      const revisionId = `revision_${this.#identifierNamespace}_${suffix}`;
      const validationRunId = deriveInternalValidationRunId({
        callerValidationRunId: input.validationRunId,
        identifierNamespace: this.#identifierNamespace,
        organizationId: scope.organizationId,
        projectId,
      });
      const existing = await this.#repository.getRevision(
        scope,
        projectId,
        revisionId,
      );
      if (existing !== null) {
        this.#requireIdempotentRevisionInput(existing, {
          ...input,
          validationRunId,
        });
        return await this.#readRevision(scope, existing);
      }
      const draft = await this.#requireDraft(scope, projectId);
      this.#requireExactDraft(project, draft, input, expectedEtag);
      await this.#validation.ensureComplete(scope, {
        contentSha256: draft.contentSha256,
        draftId: draft.draftId,
        draftVersion: draft.draftVersion,
        projectId,
        semanticSha256: draft.semanticSha256,
        validationRunId,
        visualSha256: draft.visualSha256,
      });
      const revision = await this.#publishRevision(scope, project, {
        draftId: input.draftId,
        draftVersion: input.draftVersion,
        expectedEtag,
        idempotencyKey,
        name: input.name,
        revisionId,
        suffix,
        validationRunId,
      });
      return await this.#readRevision(scope, revision, principal.principalId);
    } catch (error) {
      return mapPersistenceError(error);
    }
  }

  async createSolutionRevision(
    principal: PrincipalContext,
    projectId: string,
    input: CreateSolutionRevisionV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<SolutionRevisionV1> {
    try {
      const { project, scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "revisions.create",
      );
      const suffix = stableSuffix(
        "solution-revisions.create",
        scope.organizationId,
        principal.principalId,
        projectId,
        idempotencyKey,
      );
      const revisionId = `revision_${this.#identifierNamespace}_${suffix}`;
      const solutionRevisionId = `solution_revision_${this.#identifierNamespace}_${suffix}`;
      const validationRunId = deriveInternalValidationRunId({
        callerValidationRunId: `validation_${this.#identifierNamespace}_${suffix}`,
        identifierNamespace: this.#identifierNamespace,
        organizationId: scope.organizationId,
        projectId,
      });

      const existingSolutionRecord = await this.#solutionRecords.get(
        scope,
        projectId,
        solutionRevisionId,
      );
      if (existingSolutionRecord !== null) {
        const existingSolution = await this.#readSolutionRevision(
          scope,
          existingSolutionRecord,
          principal,
        );
        this.#requireIdempotentSolutionInput(existingSolution, input);
        return existingSolution;
      }

      const pending = await this.#solutionRecords.getManifestForPublication?.(
        scope,
        projectId,
        solutionRevisionId,
      );
      if (pending !== undefined && pending !== null) {
        if (
          pending.organizationId !== scope.organizationId ||
          pending.projectId !== projectId ||
          pending.createdByPrincipalId !== principal.principalId ||
          pending.solutionRecordId !== solutionRevisionId ||
          pending.subjectId !== solutionRevisionId ||
          pending.architectureRevisionId !== revisionId ||
          pending.contentObjectId !==
            `object_${this.#identifierNamespace}_solution_${suffix}` ||
          pending.contractVersion !== 1 ||
          pending.previousSolutionRecordId !== undefined
        ) {
          throw new RepositoryError(
            "persistence-unavailable",
            "The interrupted revision does not match this publication.",
          );
        }
        const frozen = await this.#readSolutionRevision(
          scope,
          pending,
          principal,
          true,
        );
        this.#requireIdempotentSolutionInput(frozen, input);
        const object = await this.#repository.getObject(
          scope,
          pending.contentObjectId,
        );
        if (
          object?.contentSha256 !== pending.contentSha256 ||
          object.owner.organizationId !== scope.organizationId ||
          object.owner.projectId !== projectId ||
          object.purpose !== "solution-revision-manifest" ||
          object.mediaType !== "application/json"
        )
          throw new RepositoryError(
            "persistence-unavailable",
            "The interrupted revision object is unavailable.",
          );
        await this.#publication.recover(scope, object);
        return await this.#readSolutionRevision(scope, pending, principal);
      }

      const acceptedIntent =
        input.acceptedIntentId === undefined
          ? undefined
          : await this.#requireAcceptedIntent(
              principal,
              projectId,
              input.acceptedIntentId,
            );
      if (
        acceptedIntent !== undefined &&
        (acceptedIntent.sourceDraftId !== input.draftId ||
          acceptedIntent.sourceDraftVersion > input.draftVersion)
      )
        throw new ApplicationError(
          "conflict",
          "The accepted requirements do not match this saved draft.",
        );
      // Resolve and clone the current trusted selection before any new immutable
      // publication. Existing manifest replay above never loads current tools.
      const selectedTools =
        this.#selectToolsForFreeze === undefined
          ? undefined
          : solutionRevisionToolSelectionsV1Schema.parse(
              await this.#selectToolsForFreeze(),
            );
      let revisionMetadata = await this.#repository.getRevision(
        scope,
        projectId,
        revisionId,
      );
      if (revisionMetadata !== null) {
        this.#requireIdempotentRevisionInput(revisionMetadata, {
          ...input,
          validationRunId,
        });
      } else {
        const draft = await this.#requireDraft(scope, projectId);
        this.#requireExactDraft(project, draft, input, expectedEtag);
        await this.#validation.ensureComplete(scope, {
          contentSha256: draft.contentSha256,
          draftId: draft.draftId,
          draftVersion: draft.draftVersion,
          projectId,
          semanticSha256: draft.semanticSha256,
          validationRunId,
          visualSha256: draft.visualSha256,
        });
        revisionMetadata = await this.#publishRevision(scope, project, {
          draftId: input.draftId,
          draftVersion: input.draftVersion,
          expectedEtag,
          idempotencyKey: `${this.#identifierNamespace}-revision-${suffix}`,
          name: input.name,
          revisionId,
          suffix,
          validationRunId,
        });
      }

      const revision = await this.#readRevision(
        scope,
        revisionMetadata,
        principal.principalId,
      );
      const solution = buildSolutionRevisionV1({
        ...(acceptedIntent === undefined ? {} : { acceptedIntent }),
        ...(selectedTools === undefined ? {} : { selectedTools }),
        name: revisionMetadata.name,
        revision,
        solutionRevisionId,
      });
      const manifestBytes = new TextEncoder().encode(
        serializeCanonicalJson(solution.manifest),
      );
      const manifestSha256 = createHash("sha256")
        .update(manifestBytes)
        .digest("hex");
      await this.#publication.publish(
        scope,
        {
          contentSha256: manifestSha256,
          mediaType: "application/json",
          objectId: `object_${this.#identifierNamespace}_solution_${suffix}`,
          open: async function* open(): AsyncIterable<Uint8Array> {
            yield manifestBytes;
            await Promise.resolve();
          },
          owner: { organizationId: scope.organizationId, projectId },
          purpose: "solution-revision-manifest",
          sizeBytes: manifestBytes.byteLength,
        },
        (object) =>
          this.#solutionRecords.create(
            scope,
            {
              architectureRevisionId: revision.id,
              contentSha256: manifestSha256,
              contractVersion: 1,
              idempotencyKey: `${this.#identifierNamespace}-solution-${suffix}`,
              projectId,
              recordKind: "solution-revision-manifest",
              requestSha256: sha256({
                architectureRevisionId: revision.id,
                manifestSha256,
                name: input.name,
                solutionRevisionId,
              }),
              solutionRecordId: solutionRevisionId,
              subjectId: solutionRevisionId,
            },
            object,
          ),
      );
      return solution;
    } catch (error) {
      return mapPersistenceError(error);
    }
  }
  async listRevisions(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<RevisionSummaryV1>> {
    try {
      const { scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.read",
      );
      const records = await this.#repository.listRevisions(
        scope,
        projectId,
        options.limit,
      );
      const revisions = await Promise.all(
        records.map((record) => this.#readRevision(scope, record)),
      );
      if (options.sort === "createdAt") {
        revisions.reverse();
      }
      return {
        items: revisions.map(({ architectureDocument, ...summary }) => {
          void architectureDocument;
          return summary;
        }),
      };
    } catch (error) {
      return mapPersistenceError(error);
    }
  }

  async getRevision(
    principal: PrincipalContext,
    projectId: string,
    revisionId: string,
  ): Promise<RevisionV1> {
    try {
      const { scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.read",
      );
      const record = await this.#repository.getRevision(
        scope,
        projectId,
        revisionId,
      );
      if (record === null) {
        throw new RepositoryError(
          "not-found",
          "The revision is not available.",
        );
      }
      return await this.#readRevision(scope, record);
    } catch (error) {
      return mapPersistenceError(error);
    }
  }

  async listSolutionRevisions(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<SolutionRevisionSummaryV1>> {
    try {
      const { scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.read",
      );
      const records = await this.#solutionRecords.list(scope, {
        limit: options.limit,
        projectId,
        recordKind: "solution-revision-manifest",
      });
      const solutions = await Promise.all(
        records.map((record) =>
          this.#readSolutionRevision(scope, record, principal),
        ),
      );
      if (options.sort === "createdAt") {
        solutions.reverse();
      }
      return { items: solutions.map((solution) => solution.summary) };
    } catch (error) {
      return mapPersistenceError(error);
    }
  }

  async getSolutionRevision(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
  ): Promise<SolutionRevisionV1> {
    try {
      const { scope } = await this.#requireProjectScope(
        principal,
        projectId,
        "projects.read",
      );
      const record = await this.#solutionRecords.get(
        scope,
        projectId,
        solutionRevisionId,
      );
      if (record === null) {
        throw new RepositoryError(
          "not-found",
          "The Solution Revision is not available.",
        );
      }
      return await this.#readSolutionRevision(scope, record, principal);
    } catch (error) {
      return mapPersistenceError(error);
    }
  }

  async #publishRevision(
    scope: AuthorizedOrganizationScope,
    project: ProjectRecord,
    input: RevisionPublicationInput,
  ): Promise<RevisionMetadataRecord> {
    if (project.lifecycleStatus !== "active") {
      throw new ApplicationError(
        "conflict",
        "Only an active project can create an immutable revision.",
      );
    }
    const draft = await this.#requireDraft(scope, project.projectId);
    this.#requireExactDraft(project, draft, input, input.expectedEtag);
    const sourceArchitectureDocument = parseArchitectureDocument(
      await this.#readJsonObject(scope, draft.documentObjectId),
    );
    const revisions = await this.#repository.listRevisions(
      scope,
      project.projectId,
      100,
    );
    const revisionNumber =
      Math.max(0, ...revisions.map((revision) => revision.revisionNumber)) + 1;
    const architectureDocument = rebindImmutableArchitectureRevision({
      architectureDocument: sourceArchitectureDocument,
      createdAt: project.updatedAt,
      createdBy: scope.principalId,
      ...(project.latestRevisionId === undefined
        ? {}
        : { previousRevisionId: project.latestRevisionId }),
      revisionId: input.revisionId,
      revisionNumber,
      sourceDraftId: draft.draftId,
    });
    const storage = getArchitectureDocumentStorage(architectureDocument);
    return this.#publication.publish(
      scope,
      createDocumentStageInput({
        document: architectureDocument,
        objectId: `object_${this.#identifierNamespace}_revision_${input.suffix}`,
        organizationId: scope.organizationId,
        projectId: project.projectId,
        purpose: "architecture-revision",
      }),
      (object) =>
        this.#repository.createRevision(
          scope,
          {
            catalogId: architectureDocument.catalog.id,
            catalogSha256: architectureDocument.catalog.digest.slice(7),
            catalogVersion: architectureDocument.catalog.version,
            compilerInputContractVersion:
              architectureDocument.compilerCompatibility.inputContractVersion,
            contentSha256: storage.contentSha256,
            createdAt: architectureDocument.revision.createdAt,
            expectedDraftVersion: draft.draftVersion,
            graphSchemaVersion: architectureDocument.schemaVersion,
            idempotencyKey: input.idempotencyKey,
            ...(architectureDocument.compilerCompatibility
              .maximumCompilerVersionExclusive === undefined
              ? {}
              : {
                  maximumCompilerVersionExclusive:
                    architectureDocument.compilerCompatibility
                      .maximumCompilerVersionExclusive,
                }),
            minimumCompilerVersion:
              architectureDocument.compilerCompatibility.minimumCompilerVersion,
            name: input.name,
            ...(project.latestRevisionId === undefined
              ? {}
              : { previousRevisionId: project.latestRevisionId }),
            projectId: project.projectId,
            revisionId: input.revisionId,
            revisionNumber,
            requestSha256: sha256({
              draftId: input.draftId,
              draftVersion: input.draftVersion,
              name: input.name,
              projectId: project.projectId,
              validationRunId: input.validationRunId,
            }),
            semanticSha256: storage.semanticSha256,
            sourceDraftContentSha256: draft.contentSha256,
            sourceDraftId: draft.draftId,
            sourceDraftSemanticSha256: draft.semanticSha256,
            sourceDraftVisualSha256: draft.visualSha256,
            validationRunId: input.validationRunId,
            visualSha256: storage.visualSha256,
            workloadBehaviorVersion:
              architectureDocument.workloadBehavior.contractVersion,
          },
          object,
        ),
    );
  }

  async #requireProjectScope(
    principal: PrincipalContext,
    projectId: string,
    permission: "projects.read" | "revisions.create",
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

  async #requireDraft(
    scope: AuthorizedOrganizationScope,
    projectId: string,
  ): Promise<DraftMetadataRecord> {
    const draft = await this.#repository.getDraft(scope, projectId);
    if (draft === null) {
      throw new RepositoryError("not-found", "The draft is not available.");
    }
    return draft;
  }

  #requireIdempotentRevisionInput(
    revision: RevisionMetadataRecord,
    input: ExactDraftSelector & { readonly validationRunId?: string },
  ): void {
    if (
      revision.name === input.name &&
      revision.sourceDraftId === input.draftId &&
      revision.sourceDraftVersion === input.draftVersion &&
      (input.validationRunId === undefined ||
        revision.validationRunId === input.validationRunId)
    ) {
      return;
    }
    throw new RepositoryError(
      "idempotency-conflict",
      "The revision idempotency key was reused for different input.",
    );
  }

  #requireIdempotentSolutionInput(
    solution: SolutionRevisionV1,
    input: CreateSolutionRevisionV1,
  ): void {
    if (
      (solution.manifest.intent.state === "included"
        ? solution.manifest.intent.id === input.acceptedIntentId
        : input.acceptedIntentId === undefined) &&
      solution.revision.name === input.name &&
      solution.summary.sourceDraftId === input.draftId &&
      solution.summary.sourceDraftVersion === input.draftVersion
    ) {
      return;
    }
    throw new RepositoryError(
      "idempotency-conflict",
      "The Solution Revision idempotency key was reused for different input.",
    );
  }

  #requireExactDraft(
    project: ProjectRecord,
    draft: DraftMetadataRecord,
    input: ExactDraftSelector,
    expectedEtag: string,
  ): void {
    const currentEtag = etag("draft", draft.draftId, draft.draftVersion);
    if (
      expectedEtag === currentEtag &&
      input.draftId === draft.draftId &&
      input.draftVersion === draft.draftVersion
    ) {
      return;
    }
    throw new ApplicationError(
      "precondition_failed",
      "The draft changed. Reload and validate the exact version before creating an immutable revision.",
      {
        conflict: {
          current: {
            contentDigest: digest(draft.contentSha256),
            etag: currentEtag,
            semanticDigest: digest(draft.semanticSha256),
            updatedAt: project.updatedAt,
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

  async #readRevision(
    scope: AuthorizedOrganizationScope,
    record: RevisionMetadataRecord,
    createdByPrincipalId?: string,
  ): Promise<RevisionV1> {
    const architectureDocument = architectureDocumentV3Schema.parse(
      await this.#readJsonObject(scope, record.documentObjectId),
    );
    const storage = getArchitectureDocumentStorage(architectureDocument);
    if (
      architectureDocument.revision.revisionId !== record.revisionId ||
      architectureDocument.revision.revisionNumber !== record.revisionNumber ||
      architectureDocument.revision.createdAt !== record.createdAt ||
      architectureDocument.revision.sourceDraftId !== record.sourceDraftId ||
      architectureDocument.revision.previousRevisionId !==
        record.previousRevisionId ||
      storage.contentSha256 !== record.contentSha256 ||
      storage.semanticSha256 !== record.semanticSha256 ||
      storage.visualSha256 !== record.visualSha256
    ) {
      throw new RepositoryError(
        "persistence-unavailable",
        "The immutable Architecture Revision metadata does not match its document.",
      );
    }
    const compatibility =
      getDocumentCompatibilityMetadata(architectureDocument);
    if (compatibility.schemaType !== "cloudmarkup.architecture-document") {
      throw new RepositoryError(
        "invalid-input",
        "The revision document version is unsupported.",
      );
    }
    const createdById =
      createdByPrincipalId ?? architectureDocument.revision.createdBy;
    const createdByDisplayName =
      (await this.#principalDisplayName(createdById)) ?? "Cloud Markup user";
    return revisionV1Schema.parse({
      architectureDocument,
      catalogDigest: digest(record.catalogSha256),
      catalogId: record.catalogId,
      catalogVersion: record.catalogVersion,
      compatibility: {
        catalog: {
          digest: compatibility.catalog.digest,
          id: compatibility.catalog.id,
          version: compatibility.catalog.version,
        },
        compiler: {
          inputContractVersion: record.compilerInputContractVersion,
          ...(record.maximumCompilerVersionExclusive === undefined
            ? {}
            : {
                maximumVersionExclusive: record.maximumCompilerVersionExclusive,
              }),
          minimumVersion: record.minimumCompilerVersion,
        },
        documentSchema: {
          kind: compatibility.schemaType,
          version: record.graphSchemaVersion,
        },
      },
      contentDigest: digest(record.semanticSha256),
      createdAt: record.createdAt,
      createdBy: {
        displayName: createdByDisplayName,
        id: createdById,
      },
      documentDigest: digest(record.contentSha256),
      graphSchemaVersion: record.graphSchemaVersion,
      id: record.revisionId,
      name: record.name,
      projectId: record.projectId,
      revisionNumber: record.revisionNumber,
      semanticDigest: digest(record.semanticSha256),
      sourceDraftId: record.sourceDraftId,
      sourceDraftVersion: record.sourceDraftVersion,
      storageStatus: "published",
      visualDigest: digest(record.visualSha256),
      workloadBehaviorVersion: record.workloadBehaviorVersion,
    });
  }

  async #requireAcceptedIntent(
    principal: PrincipalContext,
    projectId: string,
    acceptedIntentId: string,
  ) {
    if (this.#acceptedIntents === undefined)
      throw new ApplicationError(
        "service_unavailable",
        "Accepted requirements are unavailable.",
      );
    const record = await this.#acceptedIntents.get(
      principal,
      projectId,
      acceptedIntentId,
    );
    if (
      record.projectId !== projectId ||
      record.acceptedIntentId !== acceptedIntentId
    )
      throw new ApplicationError(
        "conflict",
        "Accepted requirements do not match this project.",
      );
    return record;
  }

  async #readSolutionRevision(
    scope: AuthorizedOrganizationScope,
    record: SolutionRecordMetadata,
    principal: PrincipalContext,
    allowPendingPublication = false,
  ): Promise<SolutionRevisionV1> {
    if (
      record.recordKind !== "solution-revision-manifest" ||
      record.architectureRevisionId === undefined
    ) {
      throw new RepositoryError(
        "invalid-input",
        "The Solution Revision record is invalid.",
      );
    }
    const revisionRecord = await this.#repository.getRevision(
      scope,
      record.projectId,
      record.architectureRevisionId,
    );
    if (revisionRecord === null) {
      throw new RepositoryError(
        "persistence-unavailable",
        "The immutable architecture revision is unavailable.",
      );
    }
    const revision = await this.#readRevision(
      scope,
      revisionRecord,
      record.createdByPrincipalId,
    );
    const storedManifest = solutionRevisionManifestV1Schema.parse(
      await this.#readJsonObject(
        scope,
        record.contentObjectId,
        record.contentSha256,
        allowPendingPublication,
      ),
    );
    const acceptedIntent =
      storedManifest.intent.state === "included"
        ? await this.#requireAcceptedIntent(
            principal,
            record.projectId,
            storedManifest.intent.id,
          )
        : undefined;
    const solution = buildSolutionRevisionV1({
      ...(acceptedIntent === undefined ? {} : { acceptedIntent }),
      name: revisionRecord.name,
      revision,
      solutionRevisionId: record.subjectId,
      selectedTools: {
        compiler: storedManifest.versions.compiler,
        diagramRenderer: storedManifest.versions.diagramRenderer,
      },
    });
    if (
      serializeCanonicalJson(storedManifest) !==
      serializeCanonicalJson(solution.manifest)
    ) {
      throw new RepositoryError(
        "persistence-unavailable",
        "The immutable Solution Revision manifest does not match its revision.",
      );
    }
    return solution;
  }

  async #readJsonObject(
    scope: AuthorizedOrganizationScope,
    objectId: string,
    expectedContentSha256?: string,
    allowPendingPublication = false,
  ): Promise<unknown> {
    const object = await this.#repository.getObject(scope, objectId);
    if (
      object === null ||
      (object.lifecycleState !== "published" &&
        !(
          allowPendingPublication &&
          object.lifecycleState === "publication-pending"
        ))
    ) {
      throw new RepositoryError("not-found", "The object is not available.");
    }
    if (
      expectedContentSha256 !== undefined &&
      object.contentSha256 !== expectedContentSha256
    ) {
      throw new RepositoryError(
        "persistence-unavailable",
        "The immutable manifest digest does not match its record.",
      );
    }
    return this.#parseJson(scope, object);
  }

  async #parseJson(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectState,
  ): Promise<unknown> {
    const stream = await this.#objectStore.open(scope, object);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.byteLength;
      if (size > MAX_OBJECT_BYTES) {
        throw new RepositoryError(
          "persistence-unavailable",
          "The immutable object is too large.",
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
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new RepositoryError(
        "persistence-unavailable",
        "The immutable object is invalid.",
      );
    }
  }
}

export function createRepositoryBackedSolutionApplicationOverrides(
  options: RepositoryBackedSolutionApplicationOptions,
): RepositoryBackedSolutionApplicationOverrides {
  const application = new RepositoryBackedSolutionApplication(options);
  return {
    createRevision: application.createRevision.bind(application),
    createSolutionRevision:
      application.createSolutionRevision.bind(application),
    getRevision: application.getRevision.bind(application),
    getSolutionRevision: application.getSolutionRevision.bind(application),
    listRevisions: application.listRevisions.bind(application),
    listSolutionRevisions: application.listSolutionRevisions.bind(application),
  };
}
