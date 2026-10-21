import {
  applicationBuildRequestDigest,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  type ApplicationBuildRequestV1,
  type ApplicationBuildResultV1,
} from "@cloudmarkup/application-build-runner";
import {
  diagramExportResultV1Schema,
  type DiagramExportResultV1,
} from "@cloudmarkup/diagram-export";
import type { JobHandlerV1 } from "@cloudmarkup/job-framework";
import {
  applicationGenerationResultV1Schema,
  asyncJobCheckpointV1Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobRecordV1Schema,
  namespacedIdentifierSchema,
  serializeCanonicalJson,
  solutionExportOrchestrationJobInputV1Schema,
  solutionExportOrchestrationJobOutputV1Schema,
  type ApplicationGenerationResultV1,
  type AsyncJobCheckpointV1,
  type AsyncJobEvidenceReferenceV1,
  type AsyncJobObjectReferenceV1,
  type AsyncJobFailureV1,
  type AsyncJobHandlerOutcomeV1,
  type AsyncJobRecordV1,
  type EvidenceRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  applicationBuildSupplementalFiles,
  solutionExportSupplementalFileV1Schema,
  type SolutionExportSupplementalFileV1,
  sha256Digest,
  solutionExportExternalStageStatusV1Schema,
  verifySolutionExportArtifact,
  type SolutionExportArtifactV1,
  type SolutionExportInfrastructureArtifactV1,
  type SolutionExportExternalStageStatusV1,
} from "@cloudmarkup/solution-export";
import { terraformValidationResultV1Schema } from "@cloudmarkup/terraform-validation-runner";

import {
  goCompilationResultV1Schema,
  projectGoCompilationResultToSolutionExportInfrastructure,
  type GoCompilationResultV1,
} from "./compiler-projection.js";
import {
  infrastructureOnlyDeliveryFiles,
  infrastructureOnlyDeliveryInputsMatch,
} from "./infrastructure-delivery.js";
import {
  cloudFormationValidationReportDigest,
  cloudFormationValidationResultV1Schema,
  validateCloudFormationInfrastructure,
} from "./infrastructure-validation.js";
import {
  SOLUTION_EXPORT_WORKFLOW_STAGE_ORDER,
  solutionExportApplicationBuildBatchInputV1Schema,
  solutionExportApplicationBuildBatchResultV1Schema,
  solutionExportApplicationBuildBatchReportDigest,
  solutionExportWorkflowArtifactV1Schema,
  solutionExportWorkflowCheckpointIdentity,
  solutionExportWorkflowCheckpointV1Schema,
  solutionExportWorkflowFailureV1Schema,
  solutionExportWorkflowFileDiffV1Schema,
  solutionExportWorkflowPersistedOutputV1Schema,
  solutionExportWorkflowReadModelV1Schema,
  solutionExportWorkflowStageReportV1Schema,
  solutionExportWorkflowWarningV1Schema,
  solutionExportWorkflowRequestDigest,
  solutionExportWorkflowRequestV1Schema,
  type SolutionExportWorkflowArtifactV1,
  type SolutionExportApplicationBuildBatchResultV1,
  type SolutionExportWorkflowDiagnosticV1,
  type SolutionExportWorkflowEvidenceSemanticsV1,
  type SolutionExportWorkflowFailureV1,
  type SolutionExportWorkflowPersistedOutputV1,
  type SolutionExportWorkflowReadModelV1,
  type SolutionExportWorkflowRequestV1,
  type SolutionExportWorkflowStageIdV1,
  type SolutionExportWorkflowStageReportV1,
  type SolutionExportWorkflowStageV1,
  type SolutionExportWorkflowWarningV1,
} from "./contracts.js";
import {
  diagnosticSourceReferences,
  mergeSanitizedWorkflowDiagnostics,
} from "./diagnostics.js";
import {
  solutionExportWorkflowEvidenceSemantics,
  sortSolutionExportWorkflowEvidenceSemantics,
} from "./evidence-semantics.js";
import type {
  SolutionExportWorkflowDependencies,
  SolutionExportWorkflowOrchestrator,
  SolutionExportWorkflowResolvedSourcesV1,
  SolutionExportInfrastructureValidationResultV1,
  SolutionExportWorkflowTrustedScopeV1,
} from "./ports.js";
import {
  cloudFormationValidationEvidenceSupplementalFiles,
  terraformValidationEvidenceSupplementalFiles,
} from "./validation-evidence.js";

const HANDLER_ID = "cloudmarkup.solution-export.workflow";
const HANDLER_VERSION = "1.0.0";
const ACTIVE_STAGE_HEARTBEAT_POLL_COUNT = 20;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

export class SolutionExportWorkflowFailureError extends Error {
  public readonly failure: SolutionExportWorkflowFailureV1;

  public constructor(failure: SolutionExportWorkflowFailureV1) {
    super("Solution export workflow stage failed.");
    this.name = "SolutionExportWorkflowFailureError";
    this.failure = solutionExportWorkflowFailureV1Schema.parse(failure);
  }
}

class SolutionExportWorkflowCanceledError extends Error {
  public readonly stage: SolutionExportWorkflowStageIdV1;

  public constructor(stage: SolutionExportWorkflowStageIdV1) {
    super("Solution export workflow was canceled.");
    this.name = "SolutionExportWorkflowCanceledError";
    this.stage = stage;
  }
}

function errorSignalsCancellation(error: unknown): boolean {
  return (
    error instanceof SolutionExportWorkflowCanceledError ||
    (error instanceof SolutionExportWorkflowFailureError &&
      error.failure.code === "cloudmarkup.export.compiler-canceled") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function signalIsAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function failure(
  stage: SolutionExportWorkflowStageIdV1,
  code: string,
  publicMessage: SolutionExportWorkflowFailureV1["publicMessage"],
  classification: SolutionExportWorkflowFailureV1["classification"] = "permanent",
  retryAfterSeconds?: number,
): SolutionExportWorkflowFailureV1 {
  return solutionExportWorkflowFailureV1Schema.parse({
    classification,
    code,
    publicMessage,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    stage,
  });
}

function fail(
  stage: SolutionExportWorkflowStageIdV1,
  code: string,
  publicMessage: SolutionExportWorkflowFailureV1["publicMessage"],
  classification?: SolutionExportWorkflowFailureV1["classification"],
  retryAfterSeconds?: number,
): never {
  throw new SolutionExportWorkflowFailureError(
    failure(stage, code, publicMessage, classification, retryAfterSeconds),
  );
}

function publicJobFailure(
  workflowFailure: SolutionExportWorkflowFailureV1,
): AsyncJobFailureV1 {
  const publicMessage: AsyncJobFailureV1["publicMessage"] =
    workflowFailure.classification === "transient"
      ? "job-temporarily-unavailable"
      : workflowFailure.publicMessage === "export-input-invalid"
        ? "job-input-invalid"
        : workflowFailure.publicMessage === "export-not-supported"
          ? "job-not-supported"
          : "job-internal-error";
  return {
    classification: workflowFailure.classification,
    code: workflowFailure.code,
    publicMessage,
    ...(workflowFailure.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: workflowFailure.retryAfterSeconds }),
  };
}

function canonicalSize(value: unknown): number {
  return utf8Encoder.encode(serializeCanonicalJson(value)).byteLength;
}

function stageArtifact(input: SolutionExportWorkflowArtifactV1) {
  return solutionExportWorkflowArtifactV1Schema.parse(input);
}

function blockedDownloadPolicy(
  reason:
    | "not-complete"
    | "stage-failed"
    | "canceled"
    | "integrity-unverified"
    | "artifact-unavailable",
) {
  return { reason, state: "blocked" as const };
}

function validationReportDigest(
  result: SolutionExportInfrastructureValidationResultV1,
): Sha256Digest {
  if ("target" in result) {
    return cloudFormationValidationReportDigest(result);
  }
  return sha256Digest(
    serializeCanonicalJson({
      commandSummaries: result.commandSummaries,
      diagnostics: result.diagnostics,
    }),
  );
}

function exactJsonFromReference(
  reference: AsyncJobObjectReferenceV1,
  bytes: Uint8Array,
  stage: SolutionExportWorkflowStageIdV1,
): unknown {
  if (
    reference.mediaType !== "application/json" ||
    reference.expiresAt !== undefined ||
    bytes.byteLength !== reference.sizeBytes ||
    sha256Digest(bytes) !== reference.digest
  ) {
    fail(
      stage,
      "cloudmarkup.export.object-binding-invalid",
      "export-input-invalid",
    );
  }
  try {
    return JSON.parse(utf8Decoder.decode(bytes)) as unknown;
  } catch {
    fail(
      stage,
      "cloudmarkup.export.object-json-invalid",
      "export-input-invalid",
    );
  }
}

function requestBindingsMatch(
  request: SolutionExportWorkflowRequestV1,
  record: AsyncJobRecordV1,
): boolean {
  const input = solutionExportOrchestrationJobInputV1Schema.parse(record.input);
  return (
    serializeCanonicalJson(request.environment) ===
      serializeCanonicalJson(input.environment) &&
    serializeCanonicalJson(request.subject) ===
      serializeCanonicalJson(input.subject) &&
    request.targetProfileId === input.targetProfileId &&
    request.targetSettings.digest === input.targetSettingsDigest &&
    solutionExportWorkflowRequestDigest(request) === input.request.digest
  );
}

function shouldGenerateApplication(
  compilation: GoCompilationResultV1,
): boolean {
  return (
    compilation.artifact?.applicationArtifacts?.some((artifact) =>
      [
        "generated-starter",
        "complete-supported-pattern",
        "ai-assisted-custom",
      ].includes(artifact.implementationMode),
    ) === true
  );
}

function infrastructureApplicationCodeRequired(
  compilation: GoCompilationResultV1,
): boolean {
  return (
    compilation.artifact?.applicationArtifacts?.some(
      (artifact) =>
        artifact.implementationMode === "infrastructure-only" &&
        artifact.codeRequired,
    ) === true
  );
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function generationHasBlockingFailure(
  application: ApplicationGenerationResultV1,
): boolean {
  return (
    application.artifact.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    ) ||
    application.artifact.diff.files.some(
      (file) => file.change === "conflict",
    ) ||
    application.artifact.workloadContracts.some(
      (workload) =>
        (workload.implementationMode === "generated-starter" ||
          workload.implementationMode === "complete-supported-pattern") &&
        workload.readiness === "generation-blocked",
    )
  );
}

function applicationIsBuildEligible(
  application: ApplicationGenerationResultV1,
): boolean {
  if (
    application.artifact.buildContracts.length === 0 ||
    application.artifact.diff.files.some((file) => file.change === "conflict")
  ) {
    return false;
  }
  const workloadById = new Map(
    application.artifact.workloadContracts.map(
      (workload) => [workload.workloadId, workload] as const,
    ),
  );
  return application.artifact.buildContracts.every((contract) => {
    const workload = workloadById.get(contract.contract.workloadId);
    return (
      workload !== undefined &&
      (workload.implementationMode === "generated-starter" ||
        workload.implementationMode === "complete-supported-pattern") &&
      workload.readiness !== "generation-blocked"
    );
  });
}

function applicationArtifactBindingsMatch(
  application: ApplicationGenerationResultV1,
  infrastructure: SolutionExportInfrastructureArtifactV1,
): boolean {
  const generatedByWorkload = new Map(
    application.artifact.buildContracts.map(
      (envelope) => [envelope.contract.workloadId, envelope] as const,
    ),
  );
  const compiledByWorkload = new Map<
    string,
    (typeof infrastructure.applicationArtifacts)[number]
  >();
  for (const artifact of infrastructure.applicationArtifacts) {
    if (compiledByWorkload.has(artifact.workloadId)) return false;
    compiledByWorkload.set(artifact.workloadId, artifact);
  }
  for (const [workloadId, envelope] of generatedByWorkload) {
    const compiled = compiledByWorkload.get(workloadId);
    if (compiled === undefined) return false;
    if (
      compiled.contractVersion === 2 &&
      compiled.expectedArtifact !== undefined
    ) {
      const expected = {
        ...envelope.contract.expectedArtifact,
        runtime: envelope.contract.runtime,
      };
      if (
        serializeCanonicalJson(compiled.expectedArtifact) !==
        serializeCanonicalJson(expected)
      ) {
        return false;
      }
    } else if (compiled.artifactReadiness === "application-artifact-ready") {
      return false;
    }
  }
  for (const compiled of infrastructure.applicationArtifacts) {
    if (
      compiled.contractVersion === 2 &&
      compiled.artifactReadiness === "application-artifact-ready" &&
      !generatedByWorkload.has(compiled.workloadId)
    ) {
      return false;
    }
  }
  return true;
}

interface BoundApplicationBuildInput {
  readonly buildContractDigest: Sha256Digest;
  readonly digest: Sha256Digest;
  readonly generationArtifactDigest: Sha256Digest;
  readonly inputState: ApplicationBuildResultV1["coverage"]["inputState"];
  readonly request: ApplicationBuildRequestV1;
  readonly workloadId: string;
}
function expectedApplicationBuildInputState(
  envelope: ApplicationGenerationResultV1["artifact"]["buildContracts"][number],
  state:
    | "starter-application"
    | "complete-supported-pattern"
    | "custom-implementation-required",
): ApplicationBuildResultV1["coverage"]["inputState"] {
  if (
    state === "complete-supported-pattern" ||
    (state === "starter-application" &&
      envelope.contract.implementationMode === "complete-supported-pattern")
  ) {
    return "complete-supported-pattern";
  }
  return state;
}

function bindApplicationBuildInput(
  application: ApplicationGenerationResultV1,
  request: SolutionExportWorkflowRequestV1,
  sources: SolutionExportWorkflowResolvedSourcesV1,
): readonly BoundApplicationBuildInput[] {
  const parsedBatch =
    solutionExportApplicationBuildBatchInputV1Schema.safeParse(
      sources.applicationBuildInputs,
    );
  const parsedSingle = applicationBuildRequestV1Schema.safeParse(
    sources.applicationBuildInputs,
  );
  if (!parsedBatch.success && !parsedSingle.success) {
    fail(
      "build-application",
      "cloudmarkup.export.build-input-invalid",
      "export-build-failed",
    );
  }
  const buildRequests: readonly ApplicationBuildRequestV1[] =
    parsedBatch.success
      ? parsedBatch.data.requests
      : parsedSingle.success
        ? [parsedSingle.data]
        : [];
  const settings = request.targetSettings.stageDescriptors.applicationBuild;
  const bound = buildRequests.map(
    (buildRequest): BoundApplicationBuildInput => {
      const source = buildRequest.source;
      if (source.kind !== "generated") {
        fail(
          "build-application",
          "cloudmarkup.export.build-input-binding-invalid",
          "export-build-failed",
        );
      }
      const envelope = application.artifact.buildContracts.find(
        ({ contractDigest }) => contractDigest === source.buildContractDigest,
      );
      if (envelope === undefined) {
        fail(
          "build-application",
          "cloudmarkup.export.build-input-binding-invalid",
          "export-build-failed",
        );
      }
      const workloadId = envelope.contract.workloadId;
      const workloadCoverage = application.artifact.coverage.workloads.find(
        (coverage) => coverage.workloadId === workloadId,
      );
      if (
        workloadCoverage === undefined ||
        (workloadCoverage.state !== "starter-application" &&
          workloadCoverage.state !== "complete-supported-pattern" &&
          workloadCoverage.state !== "custom-implementation-required")
      ) {
        fail(
          "build-application",
          "cloudmarkup.export.build-input-binding-invalid",
          "export-build-failed",
        );
      }
      if (
        serializeCanonicalJson(source.applicationGeneration) !==
          serializeCanonicalJson(application) ||
        serializeCanonicalJson(buildRequest.solutionRevision) !==
          serializeCanonicalJson(sources.solutionRevision) ||
        serializeCanonicalJson(buildRequest.environment) !==
          serializeCanonicalJson(request.environment) ||
        buildRequest.solutionRevision.solutionRevisionId !==
          request.subject.solutionRevisionId ||
        buildRequest.solutionRevisionDigest !==
          request.subject.manifestDigest ||
        source.applicationGeneration.artifactDigest !==
          application.artifactDigest ||
        settings.profileId !== buildRequest.profile.id ||
        settings.profileDigest !== buildRequest.profile.digest ||
        settings.limitsDigest !==
          sha256Digest(serializeCanonicalJson(buildRequest.limits)) ||
        settings.dependencyContractDigest !==
          sha256Digest(
            serializeCanonicalJson(envelope.contract.dependencies),
          ) ||
        settings.toolchainDigest !==
          sha256Digest(serializeCanonicalJson(envelope.contract.toolchain))
      ) {
        fail(
          "build-application",
          "cloudmarkup.export.build-input-binding-invalid",
          "export-build-failed",
        );
      }
      return {
        buildContractDigest: envelope.contractDigest,
        digest: applicationBuildRequestDigest(buildRequest),
        generationArtifactDigest: application.artifactDigest,
        inputState: expectedApplicationBuildInputState(
          envelope,
          workloadCoverage.state,
        ),
        request: buildRequest,
        workloadId,
      };
    },
  );
  const expectedDigests = application.artifact.buildContracts
    .map(({ contractDigest }) => contractDigest)
    .sort(compareUtf16);
  const actualDigests = bound
    .map(({ buildContractDigest }) => buildContractDigest)
    .sort(compareUtf16);
  if (
    expectedDigests.length !== actualDigests.length ||
    expectedDigests.some((digest, index) => digest !== actualDigests[index])
  ) {
    fail(
      "build-application",
      "cloudmarkup.export.build-input-coverage-invalid",
      "export-build-failed",
    );
  }
  return bound;
}

function externalStageStatus(
  request: SolutionExportWorkflowRequestV1,
  builds: readonly ApplicationBuildResultV1[],
  validation: SolutionExportInfrastructureValidationResultV1,
): SolutionExportExternalStageStatusV1 {
  const evidenceReference = (record: EvidenceRecordV1) => ({
    evidenceId: record.id,
    recordDigest: sha256Digest(serializeCanonicalJson(record)),
  });
  const validationEvidence = validation.evidenceRecords
    .map(evidenceReference)
    .sort((left, right) => compareUtf16(left.evidenceId, right.evidenceId));
  const validationStage = {
    evidenceRecords: validationEvidence,
    reportDigest: validation.reportDigest,
    state: "passed-before-export" as const,
  };
  const validationField =
    "target" in validation
      ? { cloudFormationValidation: validationStage }
      : { terraformValidation: validationStage };
  const firstBuild = builds[0];
  return solutionExportExternalStageStatusV1Schema.parse({
    ...(builds.length === 0
      ? {}
      : {
          applicationBuild: {
            evidenceRecords: builds
              .map(({ evidence }) => evidenceReference(evidence))
              .sort((left, right) =>
                compareUtf16(left.evidenceId, right.evidenceId),
              ),
            reportDigest:
              builds.length === 1 && firstBuild !== undefined
                ? firstBuild.reportDigest
                : solutionExportApplicationBuildBatchReportDigest(builds),
            state: "passed-before-export",
          },
        }),
    environment: request.environment,
    targetSettingsDigest: request.targetSettings.digest,
    ...validationField,
    workflowRequestDigest: solutionExportWorkflowRequestDigest(request),
  });
}

function sortEvidence(
  values: readonly AsyncJobEvidenceReferenceV1[],
): AsyncJobEvidenceReferenceV1[] {
  const byId = new Map(
    values.map((value) => [value.evidenceId, value] as const),
  );
  return [...byId.values()].sort((left, right) =>
    compareUtf16(left.evidenceId, right.evidenceId),
  );
}

function persistenceIdentity(
  record: AsyncJobRecordV1,
  request: SolutionExportWorkflowRequestV1,
  stages: readonly SolutionExportWorkflowStageV1[],
  warnings: readonly SolutionExportWorkflowWarningV1[],
): Sha256Digest {
  return solutionExportWorkflowCheckpointIdentity({
    completedStage: stages.at(-1)?.stage,
    contractVersion: 1,
    environment: request.environment,
    inputDigest: record.inputDigest,
    kind: "cloudmarkup.solution-export-workflow-checkpoint",
    requestDigest: solutionExportWorkflowRequestDigest(request),
    stages: [...stages],
    subject: request.subject,
    targetProfileId: request.targetProfileId,
    targetSettingsDigest: request.targetSettings.digest,
    warnings: [...warnings],
  });
}

function applicationVerificationProjection(
  values: readonly ApplicationBuildResultV1["coverage"][],
):
  | Record<string, never>
  | { readonly applicationVerification: ApplicationBuildResultV1["coverage"] }
  | {
      readonly applicationVerifications: readonly ApplicationBuildResultV1["coverage"][];
    } {
  const sorted = [...values].sort((left, right) =>
    compareUtf16(
      `${left.workloadId}\u0000${left.buildRequestDigest}`,
      `${right.workloadId}\u0000${right.buildRequestDigest}`,
    ),
  );
  const only = sorted[0];
  if (only === undefined) return {};
  return sorted.length === 1
    ? { applicationVerification: only }
    : { applicationVerifications: sorted };
}

function failureReadModel(
  record: AsyncJobRecordV1,
  request: SolutionExportWorkflowRequestV1,
  stages: readonly SolutionExportWorkflowStageV1[],
  warnings: readonly SolutionExportWorkflowWarningV1[],
  workflowFailure: SolutionExportWorkflowFailureV1,
  diagnostics: readonly SolutionExportWorkflowDiagnosticV1[],
  evidenceRecords: readonly AsyncJobEvidenceReferenceV1[],
  evidenceSemantics: readonly SolutionExportWorkflowEvidenceSemanticsV1[],
  stageReports: readonly SolutionExportWorkflowStageReportV1[],
  applicationVerifications: readonly ApplicationBuildResultV1["coverage"][],
): SolutionExportWorkflowReadModelV1 {
  return solutionExportWorkflowReadModelV1Schema.parse({
    contractVersion: 1,
    ...applicationVerificationProjection(applicationVerifications),
    diagnostics,
    downloadPolicy: blockedDownloadPolicy("stage-failed"),
    environment: request.environment,
    evidenceRecords,
    evidenceSemantics,
    failure: workflowFailure,
    jobId: record.jobId,
    requestDigest: solutionExportWorkflowRequestDigest(request),
    stageReports,
    stages,
    state: "failed",
    subject: request.subject,
    targetProfileId: request.targetProfileId,
    targetSettingsDigest: request.targetSettings.digest,
    warnings,
  });
}

function canceledReadModel(
  record: AsyncJobRecordV1,
  request: SolutionExportWorkflowRequestV1,
  stages: readonly SolutionExportWorkflowStageV1[],
  warnings: readonly SolutionExportWorkflowWarningV1[],
  diagnostics: readonly SolutionExportWorkflowDiagnosticV1[],
  evidenceRecords: readonly AsyncJobEvidenceReferenceV1[],
  evidenceSemantics: readonly SolutionExportWorkflowEvidenceSemanticsV1[],
  stageReports: readonly SolutionExportWorkflowStageReportV1[],
  applicationVerifications: readonly ApplicationBuildResultV1["coverage"][],
): SolutionExportWorkflowReadModelV1 {
  return solutionExportWorkflowReadModelV1Schema.parse({
    contractVersion: 1,
    ...applicationVerificationProjection(applicationVerifications),
    diagnostics,
    downloadPolicy: blockedDownloadPolicy("canceled"),
    environment: request.environment,
    evidenceRecords,
    evidenceSemantics,
    jobId: record.jobId,
    requestDigest: solutionExportWorkflowRequestDigest(request),
    stageReports,
    stages,
    state: "canceled",
    subject: request.subject,
    targetProfileId: request.targetProfileId,
    targetSettingsDigest: request.targetSettings.digest,
    warnings,
  });
}

export function createSolutionExportWorkflowOrchestrator(
  dependencies: SolutionExportWorkflowDependencies,
): SolutionExportWorkflowOrchestrator {
  return {
    async run(recordInput, context) {
      const record = asyncJobRecordV1Schema.parse(recordInput);
      if (
        record.family !== "solution-export-orchestration" ||
        record.input.family !== "solution-export-orchestration"
      ) {
        const workflowFailure = failure(
          "resolve-request",
          "cloudmarkup.export.job-family-invalid",
          "export-input-invalid",
        );
        return {
          outcome: {
            failure: publicJobFailure(workflowFailure),
            outcome: "failed",
          },
        };
      }

      const input = solutionExportOrchestrationJobInputV1Schema.parse(
        record.input,
      );
      let request: SolutionExportWorkflowRequestV1 | undefined;
      let applicationVerifications: ApplicationBuildResultV1["coverage"][] = [];
      let currentStage: SolutionExportWorkflowStageIdV1 = "resolve-request";
      const diagnostics: SolutionExportWorkflowDiagnosticV1[] = [];
      const evidenceRecords: AsyncJobEvidenceReferenceV1[] = [];
      const evidenceSemantics: SolutionExportWorkflowEvidenceSemanticsV1[] = [];
      const stageReports: SolutionExportWorkflowStageReportV1[] = [];
      const stages: SolutionExportWorkflowStageV1[] = [];
      const warnings: SolutionExportWorkflowWarningV1[] = [];
      const scope: SolutionExportWorkflowTrustedScopeV1 = {
        jobId: record.jobId,
        ownership: record.ownership,
      };
      let savedCheckpoint: AsyncJobCheckpointV1 | undefined;
      let checkpointCount = 0;
      let progressSequence = record.progress?.sequence ?? 0;
      let progressCompleted = record.progress?.completedUnits ?? 0;
      const abortController = new AbortController();

      const cancelBefore = async (
        stage: SolutionExportWorkflowStageIdV1,
      ): Promise<void> => {
        currentStage = stage;
        if (await context.isCancellationRequested()) {
          abortController.abort();
          throw new SolutionExportWorkflowCanceledError(stage);
        }
        await context.heartbeat();
      };

      const runActiveStage = async <Value>(
        stage: SolutionExportWorkflowStageIdV1,
        operation: (signal: AbortSignal) => Promise<Value>,
      ): Promise<Value> => {
        currentStage = stage;
        let heartbeatPollCount = 0;
        let monitorFailure: SolutionExportWorkflowFailureError | undefined;
        const monitorController = new AbortController();
        const monitorWork = async () => {
          while (!monitorController.signal.aborted) {
            if (await context.isCancellationRequested()) {
              abortController.abort();
              return;
            }
            await dependencies.cancellation.wait({
              signal: monitorController.signal,
            });
            if (signalIsAborted(monitorController.signal)) return;
            heartbeatPollCount += 1;
            if (heartbeatPollCount === ACTIVE_STAGE_HEARTBEAT_POLL_COUNT) {
              await context.heartbeat();
              heartbeatPollCount = 0;
            }
          }
        };
        const monitor = monitorWork().catch(() => {
          monitorFailure = new SolutionExportWorkflowFailureError(
            failure(
              stage,
              "cloudmarkup.export.active-stage-monitor-unavailable",
              "export-temporarily-unavailable",
              "transient",
              30,
            ),
          );
          abortController.abort();
        });
        try {
          const value = await operation(abortController.signal);
          if (monitorFailure !== undefined) throw monitorFailure;
          if (signalIsAborted(abortController.signal)) {
            throw new SolutionExportWorkflowCanceledError(stage);
          }
          return value;
        } catch (error) {
          if (monitorFailure !== undefined) throw monitorFailure;
          if (
            signalIsAborted(abortController.signal) ||
            errorSignalsCancellation(error)
          ) {
            abortController.abort();
            throw new SolutionExportWorkflowCanceledError(stage);
          }
          throw error;
        } finally {
          monitorController.abort();
          await monitor;
        }
      };

      const checkpointAfter = async (
        completedStage: SolutionExportWorkflowStageIdV1,
      ): Promise<void> => {
        if (
          request === undefined ||
          record.checkpoints.length + checkpointCount >=
            record.limits.checkpointCount
        ) {
          return;
        }
        const projection = {
          completedStage,
          contractVersion: 1 as const,
          environment: request.environment,
          inputDigest: record.inputDigest,
          kind: "cloudmarkup.solution-export-workflow-checkpoint" as const,
          requestDigest: solutionExportWorkflowRequestDigest(request),
          stages: [...stages],
          subject: request.subject,
          targetProfileId: request.targetProfileId,
          targetSettingsDigest: request.targetSettings.digest,
          warnings: [...warnings],
        };
        const workflowCheckpoint =
          solutionExportWorkflowCheckpointV1Schema.parse({
            ...projection,
            checkpointIdentity:
              solutionExportWorkflowCheckpointIdentity(projection),
          });
        const state = asyncJobObjectReferenceV1Schema.parse(
          await dependencies.objects.saveCheckpoint({
            checkpoint: workflowCheckpoint,
            scope,
          }),
        );
        const checkpointBytes = utf8Encoder.encode(
          serializeCanonicalJson(workflowCheckpoint),
        );
        if (
          state.purpose !== "checkpoint-state" ||
          state.expiresAt !== undefined ||
          state.mediaType !== "application/json" ||
          state.digest !== sha256Digest(checkpointBytes) ||
          state.sizeBytes !== checkpointBytes.byteLength
        ) {
          fail(
            completedStage,
            "cloudmarkup.export.checkpoint-binding-invalid",
            "export-integrity-failed",
          );
        }
        checkpointCount += 1;
        const sequence = record.checkpoints.length + checkpointCount;
        savedCheckpoint = asyncJobCheckpointV1Schema.parse({
          attemptNumber: context.attemptNumber,
          checkpointId: `export.checkpoint.${String(context.attemptNumber)}.${String(sequence)}.${workflowCheckpoint.checkpointIdentity.slice(7, 19)}`,
          createdAt: dependencies.clock.now().toISOString(),
          handlerId: HANDLER_ID,
          handlerVersion: HANDLER_VERSION,
          inputDigest: record.inputDigest,
          sequence,
          state,
        });
        await context.saveCheckpoint(savedCheckpoint);
      };

      const completeStage = async (
        stage: SolutionExportWorkflowStageIdV1,
        state: "succeeded" | "skipped",
        artifact?: SolutionExportWorkflowArtifactV1,
      ): Promise<void> => {
        stages.push({
          ...(artifact === undefined ? {} : { artifact }),
          stage,
          state,
        });
        await checkpointAfter(stage);
        if (progressCompleted < SOLUTION_EXPORT_WORKFLOW_STAGE_ORDER.length) {
          progressCompleted += 1;
          progressSequence += 1;
          await context.reportProgress({
            completedUnits: progressCompleted,
            phase: namespacedIdentifierSchema.parse(
              "cloudmarkup.solution-export.running",
            ),
            sequence: progressSequence,
            totalUnits: SOLUTION_EXPORT_WORKFLOW_STAGE_ORDER.length,
          });
        }
      };

      const persistStageReport = async (input: {
        readonly digest: Sha256Digest;
        readonly evidence: readonly EvidenceRecordV1[];
        readonly report:
          | ApplicationBuildResultV1
          | SolutionExportApplicationBuildBatchResultV1
          | SolutionExportInfrastructureValidationResultV1;
        readonly stage: "build-application" | "validate-infrastructure";
      }): Promise<SolutionExportWorkflowStageReportV1> => {
        const evidenceRequest = request;
        if (evidenceRequest === undefined) {
          fail(
            input.stage,
            "cloudmarkup.export.evidence-input-binding-invalid",
            "export-integrity-failed",
          );
        }
        if (
          input.evidence.some(
            (record) =>
              record.solutionRevisionId !==
                evidenceRequest.subject.solutionRevisionId ||
              serializeCanonicalJson(record.environment) !==
                serializeCanonicalJson(evidenceRequest.environment),
          )
        ) {
          fail(
            input.stage,
            "cloudmarkup.export.evidence-input-binding-invalid",
            "export-integrity-failed",
          );
        }
        const rawReport = await dependencies.objects.persistStageReport({
          digest: input.digest,
          evidenceRecords: input.evidence,
          report: input.report,
          scope,
          stage: input.stage,
        });
        const parsed =
          solutionExportWorkflowStageReportV1Schema.safeParse(rawReport);
        const expectedEvidence = new Map(
          input.evidence.map((record) => [record.id, record] as const),
        );
        const evidenceMatches =
          parsed.success &&
          parsed.data.evidenceRecords.length === expectedEvidence.size &&
          parsed.data.evidenceRecords.every((reference) => {
            const record = expectedEvidence.get(reference.evidenceId);
            if (record === undefined) return false;
            const bytes = utf8Encoder.encode(serializeCanonicalJson(record));
            return (
              reference.solutionRevisionId === record.solutionRevisionId &&
              serializeCanonicalJson(reference.environment) ===
                serializeCanonicalJson(request?.environment) &&
              reference.record.expiresAt === undefined &&
              reference.record.purpose === "evidence" &&
              reference.record.mediaType === "application/json" &&
              reference.record.digest === sha256Digest(bytes) &&
              reference.record.sizeBytes === bytes.byteLength
            );
          });
        if (
          !parsed.success ||
          parsed.data.artifact.digest !== input.digest ||
          !evidenceMatches
        ) {
          fail(
            input.stage,
            "cloudmarkup.export.stage-report-binding-invalid",
            "export-integrity-failed",
          );
        }
        let derivedSemantics: SolutionExportWorkflowEvidenceSemanticsV1[];
        try {
          derivedSemantics = input.evidence.map((record) =>
            solutionExportWorkflowEvidenceSemantics(record),
          );
        } catch {
          fail(
            input.stage,
            "cloudmarkup.export.evidence-semantics-invalid",
            "export-integrity-failed",
          );
        }
        for (const semantics of derivedSemantics) {
          const existing = evidenceSemantics.find(
            ({ evidenceId }) => evidenceId === semantics.evidenceId,
          );
          if (
            existing !== undefined &&
            serializeCanonicalJson(existing) !==
              serializeCanonicalJson(semantics)
          ) {
            fail(
              input.stage,
              "cloudmarkup.export.evidence-semantics-conflict",
              "export-integrity-failed",
            );
          }
          if (existing === undefined) evidenceSemantics.push(semantics);
        }
        evidenceSemantics.splice(
          0,
          evidenceSemantics.length,
          ...sortSolutionExportWorkflowEvidenceSemantics(evidenceSemantics),
        );
        stageReports.push(parsed.data);
        for (const evidence of parsed.data.evidenceRecords) {
          const existing = evidenceRecords.find(
            (candidate) => candidate.evidenceId === evidence.evidenceId,
          );
          if (
            existing !== undefined &&
            serializeCanonicalJson(existing) !==
              serializeCanonicalJson(evidence)
          ) {
            fail(
              input.stage,
              "cloudmarkup.export.evidence-binding-conflict",
              "export-integrity-failed",
            );
          }
          if (existing === undefined) evidenceRecords.push(evidence);
        }
        evidenceRecords.splice(
          0,
          evidenceRecords.length,
          ...sortEvidence(evidenceRecords),
        );
        return parsed.data;
      };

      try {
        await cancelBefore("resolve-request");
        const requestBytes = await dependencies.objects.load({
          reference: input.request,
          scope,
        });
        const requestValue = exactJsonFromReference(
          input.request,
          requestBytes,
          "resolve-request",
        );
        const parsedRequest =
          solutionExportWorkflowRequestV1Schema.safeParse(requestValue);
        if (!parsedRequest.success) {
          fail(
            "resolve-request",
            "cloudmarkup.export.request-invalid",
            "export-input-invalid",
          );
        }
        const boundRequest = parsedRequest.data;
        request = boundRequest;
        if (!requestBindingsMatch(boundRequest, record)) {
          fail(
            "resolve-request",
            "cloudmarkup.export.request-binding-invalid",
            "export-input-invalid",
          );
        }

        const resolved: {
          applicationBuildInputs?: unknown;
          architectureDocument?: unknown;
          existingFiles?: unknown;
          repositoryWorkflowReview?: unknown;
          solutionRevision?: unknown;
          workloadBehavior?: unknown;
        } = {};
        for (const key of [
          "architectureDocument",
          "workloadBehavior",
          "solutionRevision",
          "applicationBuildInputs",
          "existingFiles",
          "repositoryWorkflowReview",
        ] as const) {
          const reference = request.sources[key];
          if (reference === undefined) continue;
          const bytes = await dependencies.objects.load({
            reference,
            scope,
          });
          resolved[key] = exactJsonFromReference(
            reference,
            bytes,
            "resolve-request",
          );
        }
        const sources = resolved as SolutionExportWorkflowResolvedSourcesV1;
        await completeStage("resolve-request", "succeeded");

        await cancelBefore("compile-infrastructure");
        if (
          boundRequest.applicationDelivery !== undefined &&
          !infrastructureOnlyDeliveryInputsMatch({
            request: boundRequest,
            sources,
            settings: boundRequest.targetSettings.stageDescriptors.compiler,
            signal: new AbortController().signal,
          })
        )
          fail(
            "compile-infrastructure",
            "cloudmarkup.export.infrastructure-delivery-invalid",
            "export-input-invalid",
          );
        const rawCompilation = await runActiveStage(
          "compile-infrastructure",
          (signal) =>
            dependencies.compiler.compile({
              request: boundRequest,
              settings: boundRequest.targetSettings.stageDescriptors.compiler,
              signal,
              sources,
            }),
        );
        const parsedCompilation =
          goCompilationResultV1Schema.safeParse(rawCompilation);
        if (!parsedCompilation.success) {
          fail(
            "compile-infrastructure",
            "cloudmarkup.export.compiler-result-invalid",
            "export-compile-failed",
          );
        }
        const compilation = parsedCompilation.data;
        mergeSanitizedWorkflowDiagnostics(
          diagnostics,
          "compile-infrastructure",
          "compiler",
          (compilation.diagnostics ?? []).map((diagnostic) => ({
            code: diagnostic.code,
            references: [
              diagnostic.source,
              ...(diagnostic.related ?? []),
            ].flatMap(diagnosticSourceReferences),
            ...(diagnostic.source.edgeId === undefined
              ? {}
              : { edgeId: diagnostic.source.edgeId }),
            ...(diagnostic.source.nodeId === undefined
              ? {}
              : { nodeId: diagnostic.source.nodeId }),
            severity: diagnostic.severity,
            ...(diagnostic.source.workloadId === undefined
              ? {}
              : { workloadId: diagnostic.source.workloadId }),
          })),
        );
        if (
          compilation.artifact === undefined ||
          compilation.model === undefined ||
          compilation.diagnostics?.some(
            ({ severity }) => severity === "error",
          ) === true
        ) {
          fail(
            "compile-infrastructure",
            "cloudmarkup.export.compile-failed",
            "export-compile-failed",
          );
        }
        let infrastructure;
        try {
          infrastructure =
            projectGoCompilationResultToSolutionExportInfrastructure(
              compilation,
            );
        } catch {
          fail(
            "compile-infrastructure",
            "cloudmarkup.export.compiler-binding-invalid",
            "export-compile-failed",
          );
        }
        await completeStage(
          "compile-infrastructure",
          "succeeded",
          stageArtifact({
            digest: compilation.artifact.digest,
            kind: "compiler-result",
            mediaType: "application/json",
            sizeBytes: canonicalSize(compilation),
          }),
        );

        let application: ApplicationGenerationResultV1 | undefined;
        let sourceDraftFiles: readonly SolutionExportSupplementalFileV1[] = [];
        let builds: ApplicationBuildResultV1[] = [];
        await cancelBefore("generate-application");
        if (boundRequest.applicationDelivery === "infrastructure-only-v1") {
          const deliveryInput = {
            request: boundRequest,
            sources,
            settings: boundRequest.targetSettings.stageDescriptors.compiler,
            signal: new AbortController().signal,
          };
          if (
            !infrastructureOnlyDeliveryInputsMatch(deliveryInput) ||
            compilation.artifact.applicationArtifacts?.some(
              (artifact) =>
                artifact.implementationMode !== "infrastructure-only" &&
                artifact.implementationMode !== "complete-supported-pattern",
            )
          )
            fail(
              "generate-application",
              "cloudmarkup.export.infrastructure-delivery-invalid",
              "export-input-invalid",
            );
          sourceDraftFiles = infrastructureOnlyDeliveryFiles(deliveryInput);
          if ((compilation.artifact.applicationArtifacts?.length ?? 0) > 0)
            warnings.push("application-code-required");
          await completeStage("generate-application", "skipped");
        } else if (boundRequest.applicationSource !== undefined) {
          const applicationSourceDraft = dependencies.applicationSourceDraft;
          if (
            shouldGenerateApplication(compilation) ||
            applicationSourceDraft === undefined
          )
            fail(
              "generate-application",
              "cloudmarkup.export.ai-source-unavailable",
              "export-generation-failed",
            );
          const files = await runActiveStage("generate-application", (signal) =>
            applicationSourceDraft.generate({
              request: boundRequest,
              sources,
              signal,
            }),
          );
          sourceDraftFiles = solutionExportSupplementalFileV1Schema
            .array()
            .min(4)
            .max(25)
            .parse(files);
          if (
            sourceDraftFiles.some(
              (file) =>
                file.ownership !== "ai-generated-review-required" ||
                !file.path.startsWith("application/ai-drafts/") ||
                file.kind !== "regular-file" ||
                file.provenance.solutionRevisionId !==
                  boundRequest.subject.solutionRevisionId,
            )
          )
            fail(
              "generate-application",
              "cloudmarkup.export.ai-source-binding-invalid",
              "export-generation-failed",
            );
          await completeStage(
            "generate-application",
            "succeeded",
            stageArtifact({
              digest: sha256Digest(serializeCanonicalJson(sourceDraftFiles)),
              kind: "application-source",
              mediaType: "application/json",
              sizeBytes: canonicalSize(sourceDraftFiles),
            }),
          );
        } else if (shouldGenerateApplication(compilation)) {
          const generated = await runActiveStage(
            "generate-application",
            (signal) =>
              dependencies.applicationGenerator.generate({
                compilation,
                infrastructure,
                request: boundRequest,
                settings:
                  boundRequest.targetSettings.stageDescriptors
                    .applicationGenerator,
                signal,
                sources,
              }),
          );
          const parsedGeneration =
            applicationGenerationResultV1Schema.safeParse(generated);
          if (!parsedGeneration.success) {
            fail(
              "generate-application",
              "cloudmarkup.export.generation-result-invalid",
              "export-generation-failed",
            );
          }
          application = parsedGeneration.data;
          mergeSanitizedWorkflowDiagnostics(
            diagnostics,
            "generate-application",
            "application-generator",
            application.artifact.diagnostics.map((diagnostic) => ({
              code: diagnostic.code,
              references: [diagnostic.source, ...diagnostic.related].flatMap(
                diagnosticSourceReferences,
              ),
              ...(diagnostic.source.edgeId === undefined
                ? {}
                : { edgeId: diagnostic.source.edgeId }),
              ...(diagnostic.source.nodeId === undefined
                ? {}
                : { nodeId: diagnostic.source.nodeId }),
              ...(diagnostic.source.document !== "repository" ||
              diagnostic.source.path === undefined
                ? {}
                : { path: diagnostic.source.path }),
              severity: diagnostic.severity,
              ...(diagnostic.source.workloadId === undefined
                ? {}
                : { workloadId: diagnostic.source.workloadId }),
            })),
          );
          if (generationHasBlockingFailure(application)) {
            fail(
              "generate-application",
              "cloudmarkup.export.generation-failed",
              "export-generation-failed",
            );
          }
          if (!applicationArtifactBindingsMatch(application, infrastructure)) {
            fail(
              "generate-application",
              "cloudmarkup.export.application-artifact-binding-mismatch",
              "export-generation-failed",
            );
          }
          await completeStage(
            "generate-application",
            "succeeded",
            stageArtifact({
              digest: application.artifactDigest,
              kind: "application-source",
              mediaType: "application/json",
              sizeBytes: canonicalSize(application),
            }),
          );
        } else {
          if (infrastructureApplicationCodeRequired(compilation)) {
            warnings.push("application-code-required");
          }
          await completeStage("generate-application", "skipped");
        }

        await cancelBefore("build-application");
        if (
          application === undefined ||
          !applicationIsBuildEligible(application)
        ) {
          if (
            infrastructureApplicationCodeRequired(compilation) &&
            !warnings.includes("application-code-required")
          )
            warnings.push("application-code-required");
          await completeStage("build-application", "skipped");
        } else {
          const buildInput = bindApplicationBuildInput(
            application,
            boundRequest,
            sources,
          );
          const built = await runActiveStage("build-application", (signal) =>
            dependencies.applicationBuilder.build({
              generation: application,
              request: boundRequest,
              settings:
                boundRequest.targetSettings.stageDescriptors.applicationBuild,
              signal,
              sources,
            }),
          );
          const parsedSingleBuild =
            applicationBuildResultV1Schema.safeParse(built);
          const parsedBatchBuild =
            solutionExportApplicationBuildBatchResultV1Schema.safeParse(built);
          if (!parsedSingleBuild.success && !parsedBatchBuild.success) {
            fail(
              "build-application",
              "cloudmarkup.export.build-result-invalid",
              "export-build-failed",
            );
          }
          const parsedBuilds: readonly ApplicationBuildResultV1[] =
            parsedBatchBuild.success
              ? parsedBatchBuild.data.results
              : parsedSingleBuild.success
                ? [parsedSingleBuild.data]
                : [];
          if (parsedBuilds.length !== buildInput.length) {
            fail(
              "build-application",
              "cloudmarkup.export.build-result-binding-invalid",
              "export-integrity-failed",
            );
          }
          for (const parsedBuild of parsedBuilds) {
            const coverage = parsedBuild.coverage;
            const boundInput = buildInput.find(
              ({ workloadId }) => workloadId === coverage.workloadId,
            );
            if (
              coverage.buildRequestDigest !== boundInput?.digest ||
              coverage.generationArtifactDigest !==
                boundInput.generationArtifactDigest ||
              coverage.solutionRevisionId !==
                boundRequest.subject.solutionRevisionId ||
              coverage.solutionRevisionDigest !==
                boundRequest.subject.manifestDigest ||
              coverage.inputState !== boundInput.inputState
            ) {
              fail(
                "build-application",
                "cloudmarkup.export.build-result-binding-invalid",
                "export-integrity-failed",
              );
            }
          }
          mergeSanitizedWorkflowDiagnostics(
            diagnostics,
            "build-application",
            "application-build",
            parsedBuilds.flatMap(({ diagnostics: buildDiagnostics }) =>
              buildDiagnostics.map((diagnostic) => ({
                code: diagnostic.code,
                ...(diagnostic.references.path === undefined
                  ? {}
                  : { path: diagnostic.references.path }),
                severity: diagnostic.severity,
                ...(diagnostic.references.workloadId === undefined
                  ? {}
                  : { workloadId: diagnostic.references.workloadId }),
              })),
            ),
          );
          const firstParsedBuild = parsedBuilds[0];
          if (firstParsedBuild === undefined) {
            fail(
              "build-application",
              "cloudmarkup.export.build-result-invalid",
              "export-build-failed",
            );
          }
          const batchReport = parsedBatchBuild.success
            ? parsedBatchBuild.data
            : undefined;
          const buildReport = await persistStageReport({
            digest: batchReport?.reportDigest ?? firstParsedBuild.reportDigest,
            evidence: parsedBuilds.map(({ evidence }) => evidence),
            report: batchReport ?? firstParsedBuild,
            stage: "build-application",
          });
          applicationVerifications = parsedBuilds.map(
            ({ coverage }) => coverage,
          );
          if (parsedBuilds.some(({ state }) => state === "cancelled")) {
            throw new SolutionExportWorkflowCanceledError("build-application");
          }
          if (parsedBuilds.some(({ state }) => state !== "passed")) {
            fail(
              "build-application",
              "cloudmarkup.export.build-failed",
              "export-build-failed",
            );
          }
          builds = [...parsedBuilds];
          await completeStage(
            "build-application",
            "succeeded",
            buildReport.artifact,
          );
        }

        await cancelBefore("validate-infrastructure");
        let validation: SolutionExportInfrastructureValidationResultV1;
        if (boundRequest.targetSettings.target === "cloudformation") {
          const stageDescriptors = boundRequest.targetSettings.stageDescriptors;
          if (!("cloudFormationValidation" in stageDescriptors)) {
            fail(
              "validate-infrastructure",
              "cloudmarkup.export.cloudformation-validation-settings-invalid",
              "export-integrity-failed",
            );
          }
          let rawValidation: unknown;
          try {
            rawValidation = await runActiveStage(
              "validate-infrastructure",
              () =>
                Promise.resolve(
                  validateCloudFormationInfrastructure({
                    infrastructure,
                    now: dependencies.clock.now().toISOString(),
                    request: boundRequest,
                    settings: stageDescriptors.cloudFormationValidation,
                  }),
                ),
            );
          } catch (error) {
            if (errorSignalsCancellation(error)) throw error;
            fail(
              "validate-infrastructure",
              "cloudmarkup.export.cloudformation-validation-failed",
              "export-validation-failed",
            );
          }
          const parsedValidation =
            cloudFormationValidationResultV1Schema.safeParse(rawValidation);
          if (!parsedValidation.success) {
            fail(
              "validate-infrastructure",
              "cloudmarkup.export.cloudformation-validation-result-invalid",
              "export-validation-failed",
            );
          }
          validation = parsedValidation.data;
        } else {
          const stageDescriptors = boundRequest.targetSettings.stageDescriptors;
          if (!("terraformValidation" in stageDescriptors)) {
            fail(
              "validate-infrastructure",
              "cloudmarkup.export.terraform-validation-settings-invalid",
              "export-integrity-failed",
            );
          }
          const rawValidation = await runActiveStage(
            "validate-infrastructure",
            (signal) =>
              dependencies.terraformValidator.validate({
                infrastructure,
                request: boundRequest,
                settings: stageDescriptors.terraformValidation,
                signal,
                sources,
              }),
          );
          const parsedValidation =
            terraformValidationResultV1Schema.safeParse(rawValidation);
          if (!parsedValidation.success) {
            fail(
              "validate-infrastructure",
              "cloudmarkup.export.validation-result-invalid",
              "export-validation-failed",
            );
          }
          validation = parsedValidation.data;
          mergeSanitizedWorkflowDiagnostics(
            diagnostics,
            "validate-infrastructure",
            "terraform-validation",
            validation.diagnostics.map((diagnostic) => ({
              code: diagnostic.code,
              edgeIds: diagnostic.references.edgeIds,
              nodeIds: diagnostic.references.nodeIds,
              ownedPolicyIds: diagnostic.references.ownedPolicyIds,
              ...(diagnostic.path === undefined
                ? {}
                : { path: diagnostic.path }),
              severity: diagnostic.severity,
            })),
          );
        }
        if (validation.reportDigest !== validationReportDigest(validation)) {
          fail(
            "validate-infrastructure",
            "cloudmarkup.export.validation-report-digest-invalid",
            "export-integrity-failed",
          );
        }
        const validationReport = await persistStageReport({
          digest: validation.reportDigest,
          evidence: validation.evidenceRecords,
          report: validation,
          stage: "validate-infrastructure",
        });
        if (
          "commandSummaries" in validation &&
          validation.state === "cancelled"
        ) {
          throw new SolutionExportWorkflowCanceledError(
            "validate-infrastructure",
          );
        }
        if (validation.state !== "passed") {
          fail(
            "validate-infrastructure",
            "cloudmarkup.export.validation-failed",
            "export-validation-failed",
          );
        }
        await completeStage(
          "validate-infrastructure",
          "succeeded",
          validationReport.artifact,
        );

        await cancelBefore("render-diagram");
        let rawDiagram: unknown;
        try {
          rawDiagram = await runActiveStage("render-diagram", (signal) =>
            dependencies.diagramRenderer.render({
              request: boundRequest,
              settings:
                boundRequest.targetSettings.stageDescriptors.diagramRenderer,
              signal,
              sources,
            }),
          );
        } catch (error) {
          if (errorSignalsCancellation(error)) throw error;
          fail(
            "render-diagram",
            "cloudmarkup.export.diagram-render-failed",
            "export-diagram-failed",
          );
        }
        const parsedDiagram = diagramExportResultV1Schema.safeParse(rawDiagram);
        if (!parsedDiagram.success) {
          fail(
            "render-diagram",
            "cloudmarkup.export.diagram-result-invalid",
            "export-diagram-failed",
          );
        }
        const diagram: DiagramExportResultV1 = parsedDiagram.data;
        const diagramSettings =
          boundRequest.targetSettings.stageDescriptors.diagramRenderer;
        if (
          diagram.artifact.solutionRevision.id !==
            boundRequest.subject.solutionRevisionId ||
          diagram.artifact.solutionRevision.digest !==
            boundRequest.subject.manifestDigest ||
          diagram.artifact.renderer.id !== diagramSettings.adapter.id ||
          diagram.artifact.renderer.version !==
            diagramSettings.adapter.version ||
          diagram.artifact.renderer.digest !== diagramSettings.adapter.digest ||
          serializeCanonicalJson(diagram.artifact.profile) !==
            serializeCanonicalJson(boundRequest.diagram.profile) ||
          serializeCanonicalJson(diagram.artifact.layout) !==
            serializeCanonicalJson(boundRequest.diagram.layout) ||
          serializeCanonicalJson(diagram.artifact.theme) !==
            serializeCanonicalJson(boundRequest.diagram.theme)
        ) {
          fail(
            "render-diagram",
            "cloudmarkup.export.diagram-binding-invalid",
            "export-integrity-failed",
          );
        }
        for (const item of diagram.artifact.warnings) {
          const parsedWarning = solutionExportWorkflowWarningV1Schema.safeParse(
            item.code,
          );
          if (parsedWarning.success && !warnings.includes(parsedWarning.data)) {
            warnings.push(parsedWarning.data);
          }
        }
        await completeStage(
          "render-diagram",
          "succeeded",
          stageArtifact({
            digest: diagram.artifact.artifactDigest,
            kind: "diagram-render",
            mediaType: "application/json",
            sizeBytes: canonicalSize(diagram.artifact),
          }),
        );

        const stageStatus = externalStageStatus(
          boundRequest,
          builds,
          validation,
        );
        await cancelBefore("package-export");
        let supplementalFiles;
        try {
          supplementalFiles = [
            ...sourceDraftFiles,
            ...builds.flatMap((build) =>
              applicationBuildSupplementalFiles(build),
            ),
            ...("target" in validation
              ? cloudFormationValidationEvidenceSupplementalFiles(
                  validation.evidenceRecords,
                )
              : terraformValidationEvidenceSupplementalFiles(
                  validation.evidenceRecords,
                )),
          ];
        } catch {
          fail(
            "package-export",
            "cloudmarkup.export.build-supplemental-invalid",
            "export-integrity-failed",
          );
        }
        const packaged = await runActiveStage("package-export", (signal) =>
          dependencies.packager.package({
            application,
            build: builds.length === 1 ? builds[0] : undefined,
            builds,
            diagram,
            externalStageStatus: stageStatus,
            infrastructure,
            request: boundRequest,
            settings: boundRequest.targetSettings.stageDescriptors.exporter,
            signal,
            sources,
            supplementalFiles,
            validation,
          }),
        );
        mergeSanitizedWorkflowDiagnostics(
          diagnostics,
          "package-export",
          "packager",
          packaged.diagnostics,
        );
        if (packaged.state !== "ready") {
          fail(
            "package-export",
            "cloudmarkup.export.packaging-blocked",
            "export-packaging-failed",
          );
        }
        const artifact: SolutionExportArtifactV1 = packaged.artifact;
        const packageStageArtifact = stageArtifact({
          archiveFileName: artifact.archiveFileName,
          digest: artifact.zipDigest,
          kind: "export-package",
          manifestDigest: artifact.manifestDigest,
          mediaType: "application/zip",
          sizeBytes: artifact.zipBytes.byteLength,
        });
        await completeStage(
          "package-export",
          "succeeded",
          packageStageArtifact,
        );

        await cancelBefore("verify-export");
        const verificationDiagnostics = verifySolutionExportArtifact(artifact);
        mergeSanitizedWorkflowDiagnostics(
          diagnostics,
          "verify-export",
          "packager",
          verificationDiagnostics,
        );
        if (verificationDiagnostics.length > 0) {
          fail(
            "verify-export",
            "cloudmarkup.export.integrity-failed",
            "export-integrity-failed",
          );
        }
        await completeStage("verify-export", "succeeded", packageStageArtifact);

        await cancelBefore("compare-export");
        const rawDiff = await runActiveStage("compare-export", (signal) =>
          dependencies.diff.compare({
            current: artifact,
            previous: boundRequest.previousPackage,
            request: boundRequest,
            signal,
            scope,
          }),
        );
        const parsedDiff =
          solutionExportWorkflowFileDiffV1Schema.safeParse(rawDiff);
        if (
          !parsedDiff.success ||
          parsedDiff.data.currentDigest !== artifact.zipDigest ||
          (request.previousPackage === undefined
            ? parsedDiff.data.state !== "no-baseline" ||
              parsedDiff.data.baselineDigest !== undefined
            : parsedDiff.data.state !== "compared" ||
              parsedDiff.data.baselineDigest !==
                request.previousPackage.object.digest)
        ) {
          fail(
            "compare-export",
            "cloudmarkup.export.diff-binding-invalid",
            "export-integrity-failed",
          );
        }
        const diff = parsedDiff.data;
        await completeStage("compare-export", "succeeded");

        await cancelBefore("persist-output");
        const checkpointIdentity = persistenceIdentity(
          record,
          request,
          [...stages, { stage: "persist-output", state: "running" }],
          warnings,
        );
        const rawPersisted = await dependencies.objects.persistVerifiedOutput({
          artifact,
          build: builds.length === 1 ? builds[0] : undefined,
          builds,
          checkpointIdentity,
          diff,
          request,
          scope,
          validation,
        });
        const persisted =
          solutionExportWorkflowPersistedOutputV1Schema.safeParse(rawPersisted);
        if (
          !persisted.success ||
          persisted.data.artifact.digest !== artifact.zipDigest ||
          persisted.data.artifact.sizeBytes !== artifact.zipBytes.byteLength ||
          persisted.data.artifact.archiveFileName !==
            artifact.archiveFileName ||
          persisted.data.artifact.manifestDigest !== artifact.manifestDigest ||
          persisted.data.diff.currentDigest !== artifact.zipDigest
        ) {
          fail(
            "persist-output",
            "cloudmarkup.export.persisted-binding-invalid",
            "export-integrity-failed",
          );
        }
        const persistedOutput: SolutionExportWorkflowPersistedOutputV1 =
          persisted.data;
        const finalEvidence = sortEvidence(persistedOutput.evidenceRecords);
        if (
          serializeCanonicalJson(finalEvidence) !==
          serializeCanonicalJson(evidenceRecords)
        ) {
          fail(
            "persist-output",
            "cloudmarkup.export.final-evidence-binding-invalid",
            "export-integrity-failed",
          );
        }
        await cancelBefore("persist-output");
        await completeStage(
          "persist-output",
          "succeeded",
          persistedOutput.artifact,
        );

        const readModel = solutionExportWorkflowReadModelV1Schema.parse({
          artifact: persistedOutput.artifact,
          contractVersion: 1,
          ...applicationVerificationProjection(applicationVerifications),
          diagnostics,
          diff,
          downloadPolicy: {
            artifactId: persistedOutput.verifiedPackage.artifactId,
            digest: persistedOutput.verifiedPackage.object.digest,
            maxGrantSeconds: 300,
            state: "eligible",
          },
          environment: request.environment,
          evidenceRecords: finalEvidence,
          evidenceSemantics,
          jobId: record.jobId,
          requestDigest: solutionExportWorkflowRequestDigest(request),
          stageReports,
          stages,
          state: "succeeded",
          subject: request.subject,
          targetProfileId: request.targetProfileId,
          targetSettingsDigest: request.targetSettings.digest,
          warnings,
        });
        await dependencies.objects.saveReadModel({ readModel, scope });

        const output = solutionExportOrchestrationJobOutputV1Schema.parse({
          contractVersion: 1,
          evidenceRecords: finalEvidence,
          family: "solution-export-orchestration",
          verifiedPackage: persistedOutput.verifiedPackage,
        });
        const outputSizeBytes =
          persistedOutput.verifiedPackage.object.sizeBytes +
          finalEvidence.reduce(
            (total, evidence) => total + evidence.record.sizeBytes,
            0,
          );
        const outcome: AsyncJobHandlerOutcomeV1 = {
          outcome: "succeeded",
          output,
          outputSizeBytes,
        };
        return { outcome, persistedOutput, readModel };
      } catch (error) {
        if (error instanceof SolutionExportWorkflowCanceledError) {
          if (stages.at(-1)?.stage !== error.stage) {
            stages.push({ stage: error.stage, state: "canceled" });
          }
          const readModel =
            request === undefined
              ? undefined
              : canceledReadModel(
                  record,
                  request,
                  stages,
                  warnings,
                  diagnostics,
                  sortEvidence(evidenceRecords),
                  sortSolutionExportWorkflowEvidenceSemantics(
                    evidenceSemantics,
                  ),
                  stageReports,
                  applicationVerifications,
                );
          if (readModel !== undefined) {
            try {
              await dependencies.objects.saveReadModel({ readModel, scope });
            } catch {
              // Cancellation remains authoritative when its read-model adapter is unavailable.
            }
          }
          return {
            outcome: { outcome: "canceled" },
            ...(readModel === undefined ? {} : { readModel }),
          };
        }

        const workflowFailure =
          error instanceof SolutionExportWorkflowFailureError
            ? error.failure
            : failure(
                currentStage,
                "cloudmarkup.export.dependency-temporarily-unavailable",
                "export-temporarily-unavailable",
                "transient",
                30,
              );
        const failedStage: SolutionExportWorkflowStageV1 = {
          failure: workflowFailure,
          stage: workflowFailure.stage,
          state: "failed",
        };
        if (stages.at(-1)?.stage === workflowFailure.stage) {
          stages[stages.length - 1] = failedStage;
        } else {
          stages.push(failedStage);
        }
        mergeSanitizedWorkflowDiagnostics(
          diagnostics,
          workflowFailure.stage,
          "workflow",
          [
            {
              code: workflowFailure.code,
              severity: "error",
            },
          ],
        );
        const readModel =
          request === undefined
            ? undefined
            : failureReadModel(
                record,
                request,
                stages,
                warnings,
                workflowFailure,
                diagnostics,
                sortEvidence(evidenceRecords),
                sortSolutionExportWorkflowEvidenceSemantics(evidenceSemantics),
                stageReports,
                applicationVerifications,
              );
        if (readModel !== undefined) {
          try {
            await dependencies.objects.saveReadModel({ readModel, scope });
          } catch {
            // The public handler failure remains sanitized and retry policy stays explicit.
          }
        }
        const outcome: AsyncJobHandlerOutcomeV1 = {
          ...(savedCheckpoint === undefined
            ? {}
            : { checkpoint: savedCheckpoint }),
          failure: publicJobFailure(workflowFailure),
          outcome: "failed",
        };
        return {
          outcome,
          ...(readModel === undefined ? {} : { readModel }),
        };
      }
    },
  };
}

export function createSolutionExportWorkflowJobHandler(
  dependencies: SolutionExportWorkflowDependencies,
): JobHandlerV1 {
  const orchestrator = createSolutionExportWorkflowOrchestrator(dependencies);
  return {
    family: "solution-export-orchestration",
    handlerId: HANDLER_ID,
    handlerVersion: HANDLER_VERSION,
    resumePolicy: "restart-from-input",
    async execute(record, context): Promise<AsyncJobHandlerOutcomeV1> {
      return (await orchestrator.run(record, context)).outcome;
    },
  };
}
