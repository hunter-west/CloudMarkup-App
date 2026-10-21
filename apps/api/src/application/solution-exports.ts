import { DefaultSolutionExportReadApplication } from "./solution-export-reads.js";
import {
  artifactAt,
  canonicalDigest,
  digest,
  notFound,
  publicId,
} from "./solution-export-read-projections.js";

import {
  solutionExportStagesForTargetProfile,
  solutionExportDiagramOptionsV1Schema,
  solutionExportJobV1Schema,
  type CreateSolutionExportJobV1,
  type SolutionExportArtifactDiffV1,
  type SolutionExportArtifactV1,
  type SolutionExportDiagramOptionsV1,
  type SolutionExportDownloadGrantV1,
  type SolutionExportFilePreviewV1,
  type SolutionExportJobV1,
} from "@cloudmarkup/api-contract";
import {
  namespacedIdentifierSchema,
  sha256DigestSchema,
  type Sha256Digest,
  type SolutionGenerationCoverageV1,
} from "@cloudmarkup/schemas";
import type { SolutionExportArtifactV1 as VerifiedSolutionExportArtifactV1 } from "@cloudmarkup/solution-export";
import {
  solutionExportWorkflowRequestDigest,
  solutionExportWorkflowRequestV1Schema,
  solutionExportDiagramProfileDigest,
  solutionExportWorkflowTargetSettingsDigest,
  solutionExportWorkflowTargetSettingsProjectionV1Schema,
  solutionExportWorkflowTargetSettingsV1Schema,
  type AsyncJobArtifactReferenceV1,
  type SolutionExportWorkflowRequestV1,
  type SolutionExportWorkflowTargetSettingsV1,
} from "@cloudmarkup/solution-export-workflow/contracts";

export type { SolutionExportWorkflowRequestV1 } from "@cloudmarkup/solution-export-workflow/contracts";

import type { OrganizationPermission } from "./authorization.js";
import { ApplicationError } from "./errors.js";
import type { PrincipalContext } from "./ports.js";

export const DEFAULT_SOLUTION_EXPORT_DIAGRAM_OPTIONS: SolutionExportDiagramOptionsV1 =
  solutionExportDiagramOptionsV1Schema.parse({
    background: "opaque-light",
    includeStableDeploymentIdentifiers: false,
    maxHeight: 4_096,
    maxWidth: 4_096,
    profile: "presentation",
    scale: 2,
  });

export interface SolutionExportAuthorizedProject {
  readonly organizationId: string;
  readonly projectId: string;
}

export interface SolutionExportAccessControl {
  authorizeProject(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<SolutionExportAuthorizedProject>;
}

import type { SolutionRevisionToolSelectionsV1 } from "./solution-revision-builder.js";

export interface ImmutableSolutionRevisionExportBinding {
  readonly selectedTools?: SolutionRevisionToolSelectionsV1;
  readonly applicationCodeRequired: boolean;
  readonly infrastructureOnlyDeliverySupported?: boolean;
  readonly generationCoverage: SolutionGenerationCoverageV1;
  readonly workflowSources: SolutionExportWorkflowRequestV1["sources"];
  readonly manifestDigest: Sha256Digest;
  readonly manifestRecordId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly solutionRevisionId: string;
}

export interface SolutionExportRevisionRepository {
  getImmutableBinding(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly solutionRevisionId: string;
  }): Promise<ImmutableSolutionRevisionExportBinding | null>;
}

export interface SolutionExportTargetPolicy {
  /** Pure evaluation only; quota/credit reservation belongs to durable enqueue. */
  evaluate(input: {
    readonly binding: ImmutableSolutionRevisionExportBinding;
    readonly environment: CreateSolutionExportJobV1["environment"];
    readonly organizationId: string;
    readonly principal: PrincipalContext;
    readonly targetProfileId: CreateSolutionExportJobV1["targetProfileId"];
    readonly applicationSource?: CreateSolutionExportJobV1["applicationSource"];
    readonly applicationDelivery?: SolutionExportWorkflowRequestV1["applicationDelivery"];
  }): Promise<{
    readonly entitlementDecisionReference: string;
    readonly targetSettings: SolutionExportWorkflowTargetSettingsV1;
    readonly applicationDelivery?: SolutionExportWorkflowRequestV1["applicationDelivery"];
  }>;
}

export interface SolutionExportWorkflowEnqueueV1 {
  readonly createdByPrincipalId: string;
  readonly entitlementDecisionReference: string;
  readonly jobId: string;
  readonly organizationId: string;
  readonly previousArtifactId?: string;
  readonly projectId: string;
  readonly primaryInputDigest: Sha256Digest;
  readonly request: SolutionExportWorkflowRequestV1;
  readonly requestDigest: Sha256Digest;
}

/** Durable adapter boundary implemented by the provider-neutral workflow. */
export interface SolutionExportWorkflowPort {
  ensureEnqueued(input: SolutionExportWorkflowEnqueueV1): Promise<void>;
  requestCancellation(input: {
    readonly jobId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly requestedByPrincipalId: string;
  }): Promise<void>;
}

export interface StoredSolutionExportJob {
  readonly createdByPrincipalId: string;
  readonly primaryInputDigest: Sha256Digest;
  readonly requestIntentDigest: `sha256:${string}`;
  readonly job: SolutionExportJobV1;
  readonly organizationId: string;
  readonly targetProfileId: string;
  readonly workflowSubmission: SolutionExportWorkflowEnqueueV1;
}

export interface StoredSolutionExportArtifact {
  readonly artifact: SolutionExportArtifactV1;
  readonly fileContents: ReadonlyMap<string, Uint8Array>;
  readonly organizationId: string;
  readonly targetEnvironment: CreateSolutionExportJobV1["environment"];
  readonly targetProfileId: string;
  readonly targetSettingsDigest: Sha256Digest;
  /** Complete verified package tree retained for publication-time revalidation. */
  readonly verifiedArtifact: VerifiedSolutionExportArtifactV1;
  readonly zipBytes: Uint8Array;
  readonly workflowPackage: AsyncJobArtifactReferenceV1;
}

export interface StoredSolutionExportDownloadGrant {
  readonly artifactId: string;
  readonly grant: SolutionExportDownloadGrantV1;
  readonly organizationId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly revokedAt?: string;
}

export interface SolutionExportRepository {
  findLatestArtifact(input: {
    readonly environment: CreateSolutionExportJobV1["environment"];
    readonly organizationId: string;
    readonly projectId: string;
    readonly targetProfileId: string;
    readonly targetSettingsDigest: Sha256Digest;
  }): Promise<StoredSolutionExportArtifact | null>;
  getArtifact(input: {
    readonly artifactId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredSolutionExportArtifact | null>;
  getDownloadGrant(input: {
    readonly artifactId: string;
    readonly grantId: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
  }): Promise<StoredSolutionExportDownloadGrant | null>;
  getJob(input: {
    readonly jobId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredSolutionExportJob | null>;
  compareAndSaveJob(input: {
    readonly expected: {
      readonly state: SolutionExportJobV1["state"];
      readonly updatedAt: string;
    };
    readonly record: StoredSolutionExportJob;
  }): Promise<boolean>;
  reserveCancellation(input: {
    readonly idempotencyKeyDigest: `sha256:${string}`;
    readonly job: StoredSolutionExportJob;
    readonly principalId: string;
  }): Promise<void>;
  reserveDownloadGrant(input: {
    readonly artifact: StoredSolutionExportArtifact;
    readonly grant: StoredSolutionExportDownloadGrant;
    readonly idempotencyKeyDigest: `sha256:${string}`;
  }): Promise<StoredSolutionExportDownloadGrant>;
  reserveJob(input: {
    readonly idempotencyKeyDigest: `sha256:${string}`;
    readonly record: StoredSolutionExportJob;
  }): Promise<{
    readonly created: boolean;
    readonly record: StoredSolutionExportJob;
  }>;
  saveJob(record: StoredSolutionExportJob): Promise<void>;
}

/** Optional real durable admission capability; legacy fixtures retain their original workflow. */
export interface SolutionExportDurableAdmission {
  readonly contractVersion: 1;
  findReplay(input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly requestIntentDigest: Sha256Digest;
  }): Promise<StoredSolutionExportJob | null>;
  admit(input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly record: StoredSolutionExportJob;
  }): Promise<StoredSolutionExportJob>;
  cancel(input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly record: StoredSolutionExportJob;
  }): Promise<StoredSolutionExportJob>;
}
type ApplicationReads = Pick<
  SolutionExportRepository,
  | "findLatestArtifact"
  | "getArtifact"
  | "getDownloadGrant"
  | "getJob"
  | "reserveDownloadGrant"
>;
type ApplicationMutationDependencies =
  | {
      readonly repository: SolutionExportRepository;
      readonly workflow: SolutionExportWorkflowPort;
      readonly durableAdmission?: never;
    }
  | {
      readonly repository: ApplicationReads;
      readonly durableAdmission: SolutionExportDurableAdmission;
      readonly workflow?: never;
    };

/** Worker-facing completion boundary; failed read models remain reviewable. */
export interface SolutionExportWorkflowResultStore {
  publishArtifact(input: {
    readonly artifact: StoredSolutionExportArtifact;
    readonly job: StoredSolutionExportJob;
  }): Promise<void>;
  publishFailure(job: StoredSolutionExportJob): Promise<void>;
}

export class SolutionExportPublicationError extends Error {
  readonly classification: "canceled" | "permanent" | "transient";

  constructor(classification: "canceled" | "permanent" | "transient") {
    super("The verified export could not be published.");
    this.name = "SolutionExportPublicationError";
    this.classification = classification;
  }
}

export function publicationIntegrityFailure(
  record: StoredSolutionExportJob,
): StoredSolutionExportJob {
  const completedAt = record.job.completedAt ?? record.job.updatedAt;
  return {
    ...record,
    job: solutionExportJobV1Schema.parse({
      ...record.job,
      artifact: undefined,
      completedAt,
      diagnostics: [
        ...record.job.diagnostics,
        {
          code: "EXPORT_PUBLICATION_INTEGRITY_FAILED",
          message:
            "The verified export failed a final integrity check and was not published.",
          severity: "error",
          stage: "publication",
        },
      ],
      pollAfterMilliseconds: undefined,
      progress: {
        completedStages: 7,
        message: "The export failed final publication integrity checks.",
        totalStages: 8,
      },
      stages: record.job.stages.map((stage) =>
        stage.stage === "publication"
          ? { ...stage, status: "failed" as const }
          : stage,
      ),
      state: "failed",
      updatedAt: completedAt,
    }),
  };
}

/**
 * Converts a verified but not-yet-published result into an acknowledged late
 * cancellation. The artifact remains staged and unavailable for cleanup.
 */
export function publicationCancellationAcknowledged(
  record: StoredSolutionExportJob,
): StoredSolutionExportJob {
  const completedAt = record.job.completedAt ?? record.job.updatedAt;
  return {
    ...record,
    job: solutionExportJobV1Schema.parse({
      ...record.job,
      artifact: undefined,
      cancellation: {
        requestedAt: record.job.cancellation.requestedAt ?? completedAt,
        state: "acknowledged",
      },
      completedAt,
      pollAfterMilliseconds: undefined,
      progress: {
        completedStages: 7,
        message: "The export was canceled before publication.",
        totalStages: 8,
      },
      stages: record.job.stages.map((stage) =>
        stage.stage === "publication"
          ? { ...stage, status: "canceled" as const }
          : stage,
      ),
      state: "canceled",
      updatedAt: completedAt,
    }),
  };
}

export interface SolutionExportDownloadPayload {
  readonly bytes: Uint8Array;
  readonly digest: `sha256:${string}`;
  readonly fileName: string;
  readonly mediaType: "application/zip";
}

export interface SolutionExportApplication {
  cancelJob(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
    idempotencyKey: string,
  ): Promise<SolutionExportJobV1>;
  createDownloadGrant(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
    idempotencyKey: string,
  ): Promise<SolutionExportDownloadGrantV1>;
  createJob(
    principal: PrincipalContext,
    projectId: string,
    input: CreateSolutionExportJobV1,
    idempotencyKey: string,
  ): Promise<SolutionExportJobV1>;
  download(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
    grantId: string,
  ): Promise<SolutionExportDownloadPayload>;
  getArtifact(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
  ): Promise<SolutionExportArtifactV1>;
  getArtifactDiff(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
  ): Promise<SolutionExportArtifactDiffV1>;
  getFilePreview(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
    fileId: string,
  ): Promise<SolutionExportFilePreviewV1>;
  getJob(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
  ): Promise<SolutionExportJobV1>;
}

/** Existing compact public-intent preimage; distinct from pretty immutable-object bytes. */
export function solutionExportRequestIntentDigest(input: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly request: CreateSolutionExportJobV1;
}): `sha256:${string}` {
  return digest({ contractVersion: 1, ...input });
}

export function solutionExportPrimaryInputDigest(input: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly request: SolutionExportWorkflowRequestV1;
}): Sha256Digest {
  const { previousPackage: _previousPackage, ...primaryRequest } =
    input.request;
  void _previousPackage;
  return digest({
    contractVersion: 1,
    organizationId: input.organizationId,
    projectId: input.projectId,
    request: primaryRequest,
  }) as Sha256Digest;
}

function initialWarnings(
  binding: ImmutableSolutionRevisionExportBinding,
): SolutionExportJobV1["warnings"] {
  if (binding.applicationCodeRequired) {
    return [
      {
        code: "APPLICATION_CODE_REQUIRED",
        message:
          "Infrastructure can be exported, but application code is still required.",
      },
    ];
  }
  return [];
}

function diagramSelection(
  options: SolutionExportDiagramOptionsV1,
  exportName: string,
): SolutionExportWorkflowRequestV1["diagram"] {
  return {
    layout: {
      algorithm: { id: "cloudmarkup.diagram-layout", version: "1.0.0" },
      strategy: "deterministic",
    },
    output: {
      format: "svg-and-png",
      maxHeight: options.maxHeight,
      maxWidth: options.maxWidth,
      scale: options.scale,
    },
    profile: {
      architectureTitle: "Immutable solution architecture",
      includeStableDeploymentIdentifiers:
        options.includeStableDeploymentIdentifiers,
      kind: options.profile,
      projectTitle: exportName,
    },
    theme: { background: options.background },
  };
}

export function bindDiagramTargetSettings(
  settings: SolutionExportWorkflowTargetSettingsV1,
  diagram: SolutionExportWorkflowRequestV1["diagram"],
): SolutionExportWorkflowTargetSettingsV1 {
  const { digest: _digest, ...projection } = settings;
  void _digest;
  const bound = solutionExportWorkflowTargetSettingsProjectionV1Schema.parse({
    ...projection,
    stageDescriptors: {
      ...projection.stageDescriptors,
      diagramRenderer: {
        ...projection.stageDescriptors.diagramRenderer,
        limitsDigest: canonicalDigest(diagram.output),
        profileDigest: solutionExportDiagramProfileDigest(diagram),
        profileId: namespacedIdentifierSchema.parse(
          `cloudmarkup.diagram.${diagram.profile.kind}`,
        ),
      },
    },
  });
  return solutionExportWorkflowTargetSettingsV1Schema.parse({
    ...bound,
    digest: solutionExportWorkflowTargetSettingsDigest(bound),
  });
}

function initialJob(input: {
  readonly binding: ImmutableSolutionRevisionExportBinding;
  readonly diagram: SolutionExportDiagramOptionsV1;
  readonly exportName: string;
  readonly jobId: string;
  readonly now: string;
  readonly previousArtifactId?: string;
  readonly requestDigest: Sha256Digest;
  readonly target: CreateSolutionExportJobV1;
  readonly targetSettingsDigest: Sha256Digest;
}): SolutionExportJobV1 {
  return solutionExportJobV1Schema.parse({
    cancellation: { state: "none" },
    contractVersion: 1,
    createdAt: input.now,
    diagnostics: [],
    evidence: [],
    generationCoverage: input.binding.generationCoverage,
    id: input.jobId,
    pollAfterMilliseconds: 1_000,
    ...(input.previousArtifactId === undefined
      ? {}
      : { previousArtifactId: input.previousArtifactId }),
    progress: {
      completedStages: 1,
      currentStage: "compilation",
      message: "The export is queued for deterministic generation.",
      totalStages: 8,
    },
    projectId: input.binding.projectId,
    requestDigest: input.requestDigest,
    runSequence: 1,
    solutionRevision: {
      manifestDigest: input.binding.manifestDigest,
      manifestRecordId: input.binding.manifestRecordId,
      solutionRevisionId: input.binding.solutionRevisionId,
    },
    stages: solutionExportStagesForTargetProfile(
      input.target.targetProfileId,
    ).map((stage) => ({
      ...(stage === "authorization"
        ? { completedAt: input.now, startedAt: input.now }
        : {}),
      stage,
      status: stage === "authorization" ? "succeeded" : "pending",
    })),
    state: "queued",
    target: {
      diagram: input.diagram,
      environment: input.target.environment,
      exportName: input.exportName,
      ...(input.target.applicationSource === undefined
        ? {}
        : { applicationSource: input.target.applicationSource }),
      profileId: input.target.targetProfileId,
      settingsDigest: input.targetSettingsDigest,
    },
    updatedAt: input.now,
    warnings: initialWarnings(input.binding),
  });
}

export class DefaultSolutionExportApplication
  extends DefaultSolutionExportReadApplication
  implements SolutionExportApplication
{
  readonly #access: SolutionExportAccessControl;
  readonly #clock: () => Date;
  readonly #repository: ApplicationReads;
  readonly #legacyRepository: SolutionExportRepository | undefined;
  readonly #durableAdmission: SolutionExportDurableAdmission | undefined;
  readonly #revisions: SolutionExportRevisionRepository;
  readonly #targetPolicy: SolutionExportTargetPolicy;
  readonly #workflow: SolutionExportWorkflowPort | undefined;

  constructor(
    input: {
      readonly access: SolutionExportAccessControl;
      readonly clock?: () => Date;
      readonly revisions: SolutionExportRevisionRepository;
      readonly targetPolicy: SolutionExportTargetPolicy;
    } & ApplicationMutationDependencies,
  ) {
    super(input);
    this.#access = input.access;
    this.#clock = input.clock ?? (() => new Date());
    this.#repository = input.repository;
    this.#legacyRepository =
      input.durableAdmission === undefined ? input.repository : undefined;
    this.#durableAdmission = input.durableAdmission;
    this.#revisions = input.revisions;
    this.#targetPolicy = input.targetPolicy;
    this.#workflow = input.workflow;
  }

  #legacy(): {
    repository: SolutionExportRepository;
    workflow: SolutionExportWorkflowPort;
  } {
    if (this.#legacyRepository === undefined || this.#workflow === undefined)
      throw new ApplicationError(
        "service_unavailable",
        "The export mutation workflow is unavailable.",
      );
    return { repository: this.#legacyRepository, workflow: this.#workflow };
  }

  async createJob(
    principal: PrincipalContext,
    projectId: string,
    input: CreateSolutionExportJobV1,
    idempotencyKey: string,
  ): Promise<SolutionExportJobV1> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "exports.run",
    );
    const diagramOptions = solutionExportDiagramOptionsV1Schema.parse(
      input.diagram ?? DEFAULT_SOLUTION_EXPORT_DIAGRAM_OPTIONS,
    );
    const effectiveInput: CreateSolutionExportJobV1 = {
      ...input,
      diagram: diagramOptions,
    };
    const requestIntentDigest = solutionExportRequestIntentDigest({
      organizationId: authorized.organizationId,
      projectId,
      request: effectiveInput,
    });
    if (this.#durableAdmission !== undefined) {
      const replay = await this.#durableAdmission.findReplay({
        idempotencyKeyDigest: sha256DigestSchema.parse(digest(idempotencyKey)),
        requestIntentDigest: sha256DigestSchema.parse(requestIntentDigest),
      });
      if (replay !== null) return this.jobAt(replay);
    }
    const binding = await this.#revisions.getImmutableBinding({
      organizationId: authorized.organizationId,
      projectId,
      solutionRevisionId: input.solutionRevisionId,
    });
    if (
      binding?.organizationId !== authorized.organizationId ||
      binding.projectId !== projectId
    ) {
      throw notFound();
    }
    if (binding.generationCoverage.state === "target-unsupported") {
      throw new ApplicationError(
        "invalid_request",
        "The selected target does not support this Solution Revision.",
      );
    }
    const entitlement = await this.#targetPolicy.evaluate({
      binding,
      environment: input.environment,
      organizationId: authorized.organizationId,
      principal,
      targetProfileId: input.targetProfileId,
      ...(input.applicationSource === undefined
        ? {}
        : { applicationSource: input.applicationSource }),
    });
    const workflowDiagram = diagramSelection(diagramOptions, input.exportName);
    const targetSettings = bindDiagramTargetSettings(
      entitlement.targetSettings,
      workflowDiagram,
    );
    const previousCandidate = await this.#repository.findLatestArtifact({
      environment: input.environment,
      organizationId: authorized.organizationId,
      projectId,
      targetProfileId: input.targetProfileId,
      targetSettingsDigest: targetSettings.digest,
    });
    const previous =
      previousCandidate !== null &&
      artifactAt(previousCandidate, this.#clock()).downloadAvailability
        .state === "available" &&
      previousCandidate.workflowPackage.availability.state === "available"
        ? previousCandidate
        : null;
    const workflowRequest = solutionExportWorkflowRequestV1Schema.parse({
      contractVersion: 1,
      diagram: workflowDiagram,
      environment: input.environment,
      exportName: input.exportName,
      kind: "cloudmarkup.solution-export-workflow-request",
      ...(entitlement.applicationDelivery === undefined
        ? {}
        : { applicationDelivery: entitlement.applicationDelivery }),
      ...(input.applicationSource === undefined
        ? {}
        : { applicationSource: input.applicationSource }),
      ...(previous === null
        ? {}
        : { previousPackage: previous.workflowPackage }),
      sources: binding.workflowSources,
      subject: {
        kind: "solution-revision",
        manifestDigest: binding.manifestDigest,
        manifestRecordId: binding.manifestRecordId,
        solutionRevisionId: binding.solutionRevisionId,
      },
      targetProfileId: input.targetProfileId,
      targetSettings,
    });
    const requestDigest = solutionExportWorkflowRequestDigest(workflowRequest);
    const primaryInputDigest = solutionExportPrimaryInputDigest({
      organizationId: authorized.organizationId,
      projectId,
      request: workflowRequest,
    });
    const jobId = publicId("solutionexport", primaryInputDigest);
    const workflowSubmission: SolutionExportWorkflowEnqueueV1 = {
      createdByPrincipalId: principal.principalId,
      entitlementDecisionReference: entitlement.entitlementDecisionReference,
      jobId,
      organizationId: authorized.organizationId,
      ...(previous === null
        ? {}
        : { previousArtifactId: previous.artifact.id }),
      projectId,
      primaryInputDigest,
      request: workflowRequest,
      requestDigest,
    };
    const now = this.#clock().toISOString();
    const record: StoredSolutionExportJob = {
      createdByPrincipalId: principal.principalId,
      primaryInputDigest,
      job: initialJob({
        binding,
        diagram: diagramOptions,
        exportName: input.exportName,
        jobId,
        now,
        ...(previous === null
          ? {}
          : { previousArtifactId: previous.artifact.id }),
        requestDigest,
        target: effectiveInput,
        targetSettingsDigest: targetSettings.digest,
      }),
      requestIntentDigest,
      organizationId: authorized.organizationId,
      targetProfileId: input.targetProfileId,
      workflowSubmission,
    };
    if (this.#durableAdmission !== undefined)
      return this.jobAt(
        await this.#durableAdmission.admit({
          idempotencyKeyDigest: sha256DigestSchema.parse(
            digest(idempotencyKey),
          ),
          record,
        }),
      );
    const legacy = this.#legacy();
    const reservation = await legacy.repository.reserveJob({
      idempotencyKeyDigest: digest(idempotencyKey),
      record,
    });
    const reserved = reservation.record;
    if (reserved.job.state === "queued") {
      try {
        await legacy.workflow.ensureEnqueued(reserved.workflowSubmission);
      } catch {
        throw new ApplicationError(
          "service_unavailable",
          "The export workflow could not be queued yet. Retry with the same Idempotency-Key.",
        );
      }
    }
    return this.jobAt(reserved);
  }

  async cancelJob(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
    idempotencyKey: string,
  ): Promise<SolutionExportJobV1> {
    const record = await this.authorizedJob(
      principal,
      projectId,
      jobId,
      "exports.run",
    );
    if (record.createdByPrincipalId !== principal.principalId) {
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    }
    if (this.#durableAdmission !== undefined)
      return this.jobAt(
        await this.#durableAdmission.cancel({
          idempotencyKeyDigest: sha256DigestSchema.parse(
            digest(idempotencyKey),
          ),
          record,
        }),
      );
    const legacy = this.#legacy();
    await legacy.repository.reserveCancellation({
      idempotencyKeyDigest: digest(idempotencyKey),
      job: record,
      principalId: principal.principalId,
    });
    if (["succeeded", "failed", "canceled"].includes(record.job.state)) {
      return this.jobAt(record);
    }
    if (record.job.state === "cancellation-requested") {
      await legacy.workflow.requestCancellation({
        jobId,
        organizationId: record.organizationId,
        projectId,
        requestedByPrincipalId: principal.principalId,
      });
      return this.jobAt(record);
    }
    const now = this.#clock().toISOString();
    const next: StoredSolutionExportJob = {
      ...record,
      job: solutionExportJobV1Schema.parse({
        ...record.job,
        cancellation: { requestedAt: now, state: "requested" },
        pollAfterMilliseconds: 500,
        progress: {
          ...record.job.progress,
          message: "Cancellation has been requested.",
        },
        state: "cancellation-requested",
        updatedAt: now,
      }),
    };
    await legacy.repository.saveJob(next);
    await legacy.workflow.requestCancellation({
      jobId,
      organizationId: record.organizationId,
      projectId,
      requestedByPrincipalId: principal.principalId,
    });
    return next.job;
  }
}
