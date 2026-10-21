import {
  solutionExportStagesForTargetProfile,
  solutionExportArtifactV1Schema,
  solutionExportJobV1Schema,
  type SolutionExportJobV1,
} from "@cloudmarkup/api-contract";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import type { SolutionExportArtifactV1 as VerifiedSolutionExportArtifactV1 } from "@cloudmarkup/solution-export";
import type {
  SolutionExportWorkflowOrchestrator,
  SolutionExportWorkflowReadModelV1,
} from "@cloudmarkup/solution-export-workflow";

import { ApplicationError } from "./errors.js";
import type {
  SolutionExportWorkflowEnqueueV1,
  StoredSolutionExportArtifact,
  StoredSolutionExportJob,
} from "./solution-exports.js";

type WorkflowRunResult = Awaited<
  ReturnType<SolutionExportWorkflowOrchestrator["run"]>
>;

const MAX_ARTIFACT_RETENTION_MS = 31 * 24 * 60 * 60 * 1_000;

const PREVIEW_MEDIA_TYPES = new Set([
  "application/json",
  "application/vnd.hashicorp.terraform",
  "application/vnd.amazon.cloudformation.template+json",
  "application/yaml",
  "image/svg+xml",
  "text/markdown",
  "text/plain",
  "text/typescript",
  "text/javascript",
]);

export interface InjectedSolutionExportProjectionMaterialV1 {
  readonly completedAt: string;
  readonly retentionExpiresAt: string;
  readonly stored: StoredSolutionExportJob;
  readonly verifiedArtifact?: VerifiedSolutionExportArtifactV1;
}

export type InjectedSolutionExportPublicationV1 =
  | {
      readonly artifact: StoredSolutionExportArtifact;
      readonly job: StoredSolutionExportJob;
      readonly state: "succeeded";
    }
  | {
      readonly job: StoredSolutionExportJob;
      readonly state: "terminal";
    };

function conflict(message: string): never {
  throw new ApplicationError("conflict", message);
}

function publicStageForWorkflowStage(
  stage: SolutionExportWorkflowReadModelV1["stages"][number]["stage"],
  targetProfileId = "cloudmarkup.export.terraform-nodejs24-v1",
): SolutionExportJobV1["stages"][number]["stage"] {
  switch (stage) {
    case "resolve-request":
      return "authorization";
    case "compile-infrastructure":
      return "compilation";
    case "generate-application":
      return "application-generation";
    case "build-application":
      return "application-build";
    case "validate-infrastructure":
      return solutionExportStagesForTargetProfile(targetProfileId)[4];
    case "render-diagram":
      return "diagram-rendering";
    case "persist-output":
      return "publication";
    default:
      return "packaging";
  }
}

function publicStatusForWorkflowStates(
  states: readonly SolutionExportWorkflowReadModelV1["stages"][number]["state"][],
): SolutionExportJobV1["stages"][number]["status"] {
  for (const state of ["failed", "canceled", "running", "pending"] as const) {
    if (states.includes(state)) return state;
  }
  return states.every((state) => state === "skipped") ? "skipped" : "succeeded";
}

function publicWarning(
  code: SolutionExportWorkflowReadModelV1["warnings"][number],
): SolutionExportJobV1["warnings"][number] {
  switch (code) {
    case "cloudmarkup.diagram.detail-reduced":
      return {
        code,
        message:
          "Diagram detail was reduced to remain within the approved readable export bounds.",
      };
    case "cloudmarkup.diagram.icon-unavailable":
      return {
        code,
        message:
          "A reviewed provider icon was unavailable in the pinned icon set.",
      };
    case "cloudmarkup.diagram.label-truncated":
      return {
        code,
        message: "One or more diagram labels were shortened for readability.",
      };
    case "cloudmarkup.diagram.minimum-label-scale":
      return {
        code,
        message:
          "The diagram reached the approved minimum readable label scale.",
      };
    default:
      return {
        code: "APPLICATION_CODE_REQUIRED",
        message:
          "Infrastructure is generated, but application code must be supplied before deployment.",
      };
  }
}

export function projectSolutionExportWorkflowEvidence(
  readModel: Pick<
    SolutionExportWorkflowReadModelV1,
    "evidenceRecords" | "evidenceSemantics" | "stageReports"
  >,
) {
  return readModel.evidenceRecords.map((reference) => {
    const report = readModel.stageReports.find((candidate) =>
      candidate.evidenceRecords.some(
        ({ evidenceId }) => evidenceId === reference.evidenceId,
      ),
    );
    const semantics = readModel.evidenceSemantics.find(
      ({ evidenceId }) => evidenceId === reference.evidenceId,
    );
    if (report === undefined || semantics === undefined) {
      conflict(
        "Workflow Evidence is not bound to a persisted report and canonical check semantics.",
      );
    }
    if (
      (report.stage === "build-application" &&
        semantics.kind !== "application-build") ||
      (report.stage === "validate-infrastructure" &&
        semantics.kind === "application-build")
    ) {
      conflict(
        "Workflow Evidence semantics do not match their persisted stage.",
      );
    }
    return {
      digest: reference.record.digest,
      evidenceId: reference.evidenceId,
      kind: semantics.kind,
      reference,
      stage:
        semantics.kind === "application-build"
          ? ("application-build" as const)
          : semantics.kind === "infrastructure-compilation"
            ? ("compilation" as const)
            : semantics.kind === "cloudformation-validation"
              ? ("cloudformation-validation" as const)
              : ("terraform-validation" as const),
      status: semantics.status,
    };
  });
}

function publicCompilerDiagnosticMessage(code: string): string | undefined {
  switch (code) {
    case "COMPAT_SOLUTION_COMPILER_MISMATCH":
      return "This revision uses a different compiler version. Save a new revision to use the current export version.";
    case "CLOUDFORMATION_LAMBDA_WORKLOAD_REQUIRED":
    case "TARGET_LAMBDA_WORKLOAD_REQUIRED":
      return "Add workload settings for this Lambda, then save a new revision before exporting.";
    case "CLOUDFORMATION_NETWORK_PARENT_EDGE_INVALID":
    case "TARGET_NETWORK_PARENT_EDGE_INVALID":
      return "Review this resource's region or VPC placement. Its saved parent needs one matching connection. Save a new revision after correcting it.";
    case "CLOUDFORMATION_LAMBDA_ROLE_REQUIRED":
    case "TARGET_LAMBDA_ROLE_REQUIRED":
      return "Connect an IAM execution role to this Lambda, then save a new revision before exporting.";
    case "APPLICATION_CODE_REQUIRED":
      return "This export contains infrastructure. Supply and validate the application package before deploying it.";
    default:
      return undefined;
  }
}

const diagnosticActions: Readonly<
  Record<
    SolutionExportWorkflowReadModelV1["diagnostics"][number]["origin"],
    string
  >
> = {
  compiler:
    "Infrastructure checks need review. Check the affected items and recorded checks, then save a corrected revision before exporting again.",
  "application-generator":
    "Application generation needs review. Check the affected workload and recorded checks before exporting again.",
  "cloudformation-validation":
    "Infrastructure validation needs review. Check the affected items and recorded checks before exporting again.",
  "terraform-validation":
    "Infrastructure validation needs review. Check the affected items and recorded checks before exporting again.",
  "application-build":
    "The application build needs review. Check its recorded results and supply a corrected application before exporting again.",
  "diagram-renderer":
    "The diagram needs review. Check its affected items and recorded checks before exporting again.",
  packager:
    "The export package needs review. Check its recorded results before trying again.",
  workflow:
    "This export step needs review. Check the affected items and recorded checks before trying again.",
};

export function projectSolutionExportWorkflowDiagnostics(
  diagnostics: SolutionExportWorkflowReadModelV1["diagnostics"],
  targetProfileId = "cloudmarkup.export.terraform-nodejs24-v1",
) {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    ...(diagnostic.recoveryReferences === undefined
      ? {}
      : { recoveryReferences: diagnostic.recoveryReferences }),
    ...(diagnostic.edgeId === undefined ? {} : { edgeId: diagnostic.edgeId }),
    message:
      (diagnostic.origin === "compiler"
        ? publicCompilerDiagnosticMessage(diagnostic.code)
        : undefined) ?? diagnosticActions[diagnostic.origin],
    ...(diagnostic.nodeId === undefined ? {} : { nodeId: diagnostic.nodeId }),
    ...(diagnostic.ownedPolicyId === undefined
      ? {}
      : { ownedPolicyId: diagnostic.ownedPolicyId }),
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    severity: diagnostic.severity,
    stage: publicStageForWorkflowStage(diagnostic.stage, targetProfileId),
    ...(diagnostic.workloadId === undefined
      ? {}
      : { workloadId: diagnostic.workloadId }),
  }));
}

function projectReview(
  submission: SolutionExportWorkflowEnqueueV1,
  stored: StoredSolutionExportJob,
  readModel: SolutionExportWorkflowReadModelV1,
) {
  if (
    readModel.jobId !== submission.jobId ||
    readModel.requestDigest !== submission.requestDigest ||
    readModel.subject.solutionRevisionId !==
      submission.request.subject.solutionRevisionId ||
    readModel.subject.manifestDigest !==
      submission.request.subject.manifestDigest ||
    readModel.subject.manifestRecordId !==
      submission.request.subject.manifestRecordId ||
    readModel.targetProfileId !== submission.request.targetProfileId ||
    readModel.targetSettingsDigest !== submission.request.targetSettings.digest
  ) {
    conflict("The workflow read model does not match its immutable API job.");
  }
  const warnings = readModel.warnings.map(publicWarning);
  const stages = solutionExportStagesForTargetProfile(
    submission.request.targetProfileId,
  ).map((stage) => {
    const states = readModel.stages
      .filter(
        (workflowStage) =>
          publicStageForWorkflowStage(
            workflowStage.stage,
            submission.request.targetProfileId,
          ) === stage,
      )
      .map(({ state }) => state);
    return {
      stage,
      status:
        states.length === 0
          ? ("skipped" as const)
          : publicStatusForWorkflowStates(states),
    };
  });
  const evidence = projectSolutionExportWorkflowEvidence(readModel);
  const diagnostics = projectSolutionExportWorkflowDiagnostics(
    readModel.diagnostics,
    submission.request.targetProfileId,
  );
  return {
    applicationVerification: readModel.applicationVerification,
    applicationVerifications: readModel.applicationVerifications,
    diagnostics,
    evidence,
    generationCoverage: stored.job.generationCoverage,
    stages,
    warnings,
  };
}

function projectEarlyCancellation(
  stored: StoredSolutionExportJob,
  completedAt: string,
): InjectedSolutionExportPublicationV1 {
  return {
    job: {
      ...stored,
      job: solutionExportJobV1Schema.parse({
        ...stored.job,
        artifact: undefined,
        cancellation: {
          requestedAt:
            stored.job.cancellation.requestedAt ?? stored.job.updatedAt,
          state: "acknowledged",
        },
        completedAt,
        diagnostics: [],
        evidence: [],
        pollAfterMilliseconds: undefined,
        progress: {
          completedStages: 2,
          message: "The export was canceled without publishing an artifact.",
          totalStages: 8,
        },
        stages: solutionExportStagesForTargetProfile(
          stored.targetProfileId,
        ).map((stage, index) => ({
          stage,
          status:
            index === 0
              ? ("succeeded" as const)
              : index === 1
                ? ("canceled" as const)
                : ("skipped" as const),
        })),
        state: "canceled",
        updatedAt: completedAt,
      }),
    },
    state: "terminal",
  };
}

function projectTerminal(
  submission: SolutionExportWorkflowEnqueueV1,
  stored: StoredSolutionExportJob,
  readModel: SolutionExportWorkflowReadModelV1,
  completedAt: string,
): InjectedSolutionExportPublicationV1 {
  if (
    (readModel.state !== "failed" && readModel.state !== "canceled") ||
    readModel.artifact !== undefined ||
    readModel.downloadPolicy.state !== "blocked"
  ) {
    conflict("The workflow terminal result is not safe to publish.");
  }
  const projection = projectReview(submission, stored, readModel);
  const canceled = readModel.state === "canceled";
  return {
    job: {
      ...stored,
      job: solutionExportJobV1Schema.parse({
        ...stored.job,
        applicationVerification: projection.applicationVerification,
        applicationVerifications: projection.applicationVerifications,
        artifact: undefined,
        cancellation: canceled
          ? {
              requestedAt:
                stored.job.cancellation.requestedAt ?? stored.job.updatedAt,
              state: "acknowledged",
            }
          : stored.job.cancellation,
        completedAt,
        diagnostics: projection.diagnostics,
        evidence: projection.evidence,
        generationCoverage: projection.generationCoverage,
        pollAfterMilliseconds: undefined,
        progress: {
          completedStages: 7,
          message: canceled
            ? "The export was canceled without publishing an artifact."
            : "The export failed validation and did not publish an artifact.",
          totalStages: 8,
        },
        stages: projection.stages,
        state: readModel.state,
        updatedAt: completedAt,
        warnings: projection.warnings,
      }),
    },
    state: "terminal",
  };
}

function projectSuccess(
  submission: SolutionExportWorkflowEnqueueV1,
  stored: StoredSolutionExportJob,
  result: WorkflowRunResult,
  verifiedArtifact: VerifiedSolutionExportArtifactV1,
  completedAt: string,
  retentionExpiresAt: string,
): InjectedSolutionExportPublicationV1 {
  const readModel = result.readModel;
  const persisted = result.persistedOutput;
  if (
    result.outcome.outcome !== "succeeded" ||
    readModel?.state !== "succeeded" ||
    persisted === undefined ||
    readModel.artifact?.digest !== verifiedArtifact.zipDigest ||
    persisted.artifact.digest !== verifiedArtifact.zipDigest ||
    persisted.verifiedPackage.object.digest !== verifiedArtifact.zipDigest ||
    persisted.artifact.artifactId !== persisted.verifiedPackage.artifactId ||
    persisted.verifiedPackage.object.sizeBytes !==
      verifiedArtifact.zipBytes.byteLength ||
    serializeCanonicalJson(
      verifiedArtifact.manifest.generationCoverage.revision,
    ) !== serializeCanonicalJson(stored.job.generationCoverage)
  ) {
    conflict("The workflow success does not bind the verified package bytes.");
  }
  const projection = projectReview(submission, stored, readModel);
  const artifactId = persisted.verifiedPackage.artifactId;
  const artifactSuffix = artifactId.startsWith("solutionartifact_")
    ? artifactId.slice("solutionartifact_".length)
    : artifactId;
  const verifiedByPath = new Map(
    verifiedArtifact.files.map((file) => [file.path, file] as const),
  );
  const files = verifiedArtifact.files.map((file, index) => ({
    checksum: file.checksum,
    id: `solutionfile_${artifactSuffix}_${index.toString().padStart(4, "0")}`,
    mediaType: file.mediaType,
    ownership: file.ownership,
    path: file.path,
    previewAvailable: PREVIEW_MEDIA_TYPES.has(file.mediaType),
    semanticChecksum: file.semanticChecksum,
    sizeBytes: file.bytes.byteLength,
  }));
  const fileContents = new Map(
    files.flatMap((file) => {
      const verifiedFile = verifiedByPath.get(file.path);
      return file.previewAvailable && verifiedFile !== undefined
        ? [[file.id, verifiedFile.bytes] as const]
        : [];
    }),
  );
  const artifact: StoredSolutionExportArtifact = {
    artifact: solutionExportArtifactV1Schema.parse({
      archiveFileName: verifiedArtifact.archiveFileName,
      contractVersion: 1,
      createdAt: completedAt,
      digest: verifiedArtifact.zipDigest,
      downloadAvailability: {
        expiresAt: retentionExpiresAt,
        state: "available",
      },
      fileCount: files.length,
      files,
      id: artifactId,
      jobId: submission.jobId,
      manifestDigest: verifiedArtifact.manifestDigest,
      ...(submission.previousArtifactId === undefined
        ? {}
        : { previousArtifactId: submission.previousArtifactId }),
      projectId: submission.projectId,
      sizeBytes: verifiedArtifact.zipBytes.byteLength,
      solutionRevisionId: submission.request.subject.solutionRevisionId,
      warnings: projection.warnings,
    }),
    fileContents,
    organizationId: submission.organizationId,
    targetEnvironment: stored.job.target.environment,
    targetProfileId: submission.request.targetProfileId,
    targetSettingsDigest: submission.request.targetSettings.digest,
    verifiedArtifact,
    workflowPackage: persisted.verifiedPackage,
    zipBytes: verifiedArtifact.zipBytes,
  };
  const job: StoredSolutionExportJob = {
    ...stored,
    job: solutionExportJobV1Schema.parse({
      ...stored.job,
      applicationVerification: projection.applicationVerification,
      applicationVerifications: projection.applicationVerifications,
      artifact: {
        artifactId,
        digest: verifiedArtifact.zipDigest,
        downloadAvailability: artifact.artifact.downloadAvailability,
        fileCount: files.length,
        manifestDigest: verifiedArtifact.manifestDigest,
        sizeBytes: verifiedArtifact.zipBytes.byteLength,
      },
      completedAt,
      diagnostics: projection.diagnostics,
      evidence: projection.evidence,
      generationCoverage: projection.generationCoverage,
      pollAfterMilliseconds: undefined,
      progress: {
        completedStages: 8,
        message: "The verified export is ready.",
        totalStages: 8,
      },
      stages: projection.stages,
      state: "succeeded",
      updatedAt: completedAt,
      warnings: projection.warnings,
    }),
  };
  return { artifact, job, state: "succeeded" };
}

/** Project only a verified workflow result; injected adapters cannot author public semantics. */
export function projectInjectedSolutionExportResult(input: {
  readonly material: InjectedSolutionExportProjectionMaterialV1;
  readonly result: WorkflowRunResult;
  readonly submission: SolutionExportWorkflowEnqueueV1;
}): InjectedSolutionExportPublicationV1 {
  const { material, result, submission } = input;
  const createdAt = Date.parse(material.stored.job.createdAt);
  const updatedAt = Date.parse(material.stored.job.updatedAt);
  const completedAt = Date.parse(material.completedAt);
  const retentionExpiresAt = Date.parse(material.retentionExpiresAt);
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !Number.isFinite(completedAt) ||
    !Number.isFinite(retentionExpiresAt) ||
    completedAt < createdAt ||
    completedAt < updatedAt ||
    retentionExpiresAt <= completedAt ||
    retentionExpiresAt - completedAt > MAX_ARTIFACT_RETENTION_MS
  ) {
    conflict(
      "The workflow publication timestamps exceed the approved retention boundary.",
    );
  }
  if (material.stored.primaryInputDigest !== submission.primaryInputDigest) {
    conflict(
      "The stored job does not match the canonical primary export input.",
    );
  }
  if (result.outcome.outcome === "canceled" && result.readModel === undefined) {
    return projectEarlyCancellation(material.stored, material.completedAt);
  }
  if (result.outcome.outcome !== "succeeded") {
    if (
      result.readModel === undefined ||
      (result.outcome.outcome === "failed" &&
        result.readModel.state !== "failed") ||
      (result.outcome.outcome === "canceled" &&
        result.readModel.state !== "canceled")
    ) {
      conflict("The workflow terminal result is internally inconsistent.");
    }
    return projectTerminal(
      submission,
      material.stored,
      result.readModel,
      material.completedAt,
    );
  }
  if (material.verifiedArtifact === undefined) {
    conflict("A successful workflow is missing verified package bytes.");
  }
  return projectSuccess(
    submission,
    material.stored,
    result,
    material.verifiedArtifact,
    material.completedAt,
    material.retentionExpiresAt,
  );
}
