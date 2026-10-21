import type { DiagramExportResultV1 } from "@cloudmarkup/diagram-export";
import type { ApplicationBuildResultV1 } from "@cloudmarkup/application-build-runner";
import type { JobHandlerContextV1 } from "@cloudmarkup/job-framework";
import type {
  ApplicationGenerationResultV1,
  AsyncJobArtifactReferenceV1,
  EvidenceRecordV1,
  AsyncJobHandlerOutcomeV1,
  AsyncJobObjectReferenceV1,
  AsyncJobRecordV1,
  Sha256Digest,
} from "@cloudmarkup/schemas";
import type {
  SolutionExportArtifactV1,
  SolutionExportExternalStageStatusV1,
  SolutionExportInfrastructureArtifactV1,
  SolutionExportResultV1,
  SolutionExportSupplementalFileV1,
} from "@cloudmarkup/solution-export";
import type { TerraformValidationResultV1 } from "@cloudmarkup/terraform-validation-runner";

import type { GoCompilationResultV1 } from "./compiler-projection.js";
import type { CloudFormationValidationResultV1 } from "./infrastructure-validation.js";
import type {
  SolutionExportWorkflowCheckpointV1,
  SolutionExportWorkflowFileDiffV1,
  SolutionExportWorkflowPersistedOutputV1,
  SolutionExportWorkflowReadModelV1,
  SolutionExportWorkflowRequestV1,
  SolutionExportWorkflowStageIdV1,
  SolutionExportWorkflowStageDescriptorsV1,
} from "./contracts.js";

export type SolutionExportInfrastructureValidationResultV1 =
  TerraformValidationResultV1 | CloudFormationValidationResultV1;

export interface SolutionExportWorkflowTrustedScopeV1 {
  readonly jobId: AsyncJobRecordV1["jobId"];
  readonly ownership: AsyncJobRecordV1["ownership"];
}

export interface SolutionExportWorkflowResolvedSourcesV1 {
  readonly applicationBuildInputs?: unknown;
  readonly architectureDocument: unknown;
  readonly existingFiles?: unknown;
  readonly repositoryWorkflowReview?: unknown;
  readonly solutionRevision: unknown;
  readonly workloadBehavior: unknown;
}

export interface SolutionExportCompilerPort {
  compile(input: {
    readonly request: SolutionExportWorkflowRequestV1;
    readonly signal: AbortSignal;
    readonly settings: SolutionExportWorkflowStageDescriptorsV1["compiler"];
    readonly sources: SolutionExportWorkflowResolvedSourcesV1;
  }): Promise<unknown>;
}

export interface SolutionExportApplicationGeneratorPort {
  generate(input: {
    readonly compilation: GoCompilationResultV1;
    readonly infrastructure: SolutionExportInfrastructureArtifactV1;
    readonly request: SolutionExportWorkflowRequestV1;
    readonly signal: AbortSignal;
    readonly settings: SolutionExportWorkflowStageDescriptorsV1["applicationGenerator"];
    readonly sources: SolutionExportWorkflowResolvedSourcesV1;
  }): Promise<unknown>;
}

export interface SolutionExportApplicationBuildPort {
  build(input: {
    readonly generation: ApplicationGenerationResultV1;
    readonly request: SolutionExportWorkflowRequestV1;
    readonly signal: AbortSignal;
    readonly settings: SolutionExportWorkflowStageDescriptorsV1["applicationBuild"];
    readonly sources: SolutionExportWorkflowResolvedSourcesV1;
  }): Promise<unknown>;
}

export interface SolutionExportTerraformValidationPort {
  validate(input: {
    readonly infrastructure: SolutionExportInfrastructureArtifactV1;
    readonly request: SolutionExportWorkflowRequestV1;
    readonly signal: AbortSignal;
    readonly settings: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"];
    readonly sources: SolutionExportWorkflowResolvedSourcesV1;
  }): Promise<unknown>;
}

export interface SolutionExportDiagramRendererPort {
  render(input: {
    readonly request: SolutionExportWorkflowRequestV1;
    readonly signal: AbortSignal;
    readonly settings: SolutionExportWorkflowStageDescriptorsV1["diagramRenderer"];
    readonly sources: SolutionExportWorkflowResolvedSourcesV1;
  }): Promise<unknown>;
}

export interface SolutionExportPackagerPort {
  package(input: {
    readonly application: ApplicationGenerationResultV1 | undefined;
    readonly build: ApplicationBuildResultV1 | undefined;
    readonly builds: readonly ApplicationBuildResultV1[];
    readonly externalStageStatus: SolutionExportExternalStageStatusV1;
    readonly diagram: DiagramExportResultV1;
    readonly infrastructure: SolutionExportInfrastructureArtifactV1;
    readonly request: SolutionExportWorkflowRequestV1;
    readonly signal: AbortSignal;
    readonly sources: SolutionExportWorkflowResolvedSourcesV1;
    readonly settings: SolutionExportWorkflowStageDescriptorsV1["exporter"];
    readonly supplementalFiles: readonly SolutionExportSupplementalFileV1[];
    readonly validation: SolutionExportInfrastructureValidationResultV1;
  }): Promise<SolutionExportResultV1>;
}

export interface SolutionExportWorkflowObjectPort {
  load(input: {
    readonly reference: AsyncJobObjectReferenceV1;
    readonly scope: SolutionExportWorkflowTrustedScopeV1;
  }): Promise<Uint8Array>;
  persistVerifiedOutput(input: {
    readonly artifact: SolutionExportArtifactV1;
    readonly build: ApplicationBuildResultV1 | undefined;
    readonly builds: readonly ApplicationBuildResultV1[];
    readonly checkpointIdentity: string;
    readonly diff: SolutionExportWorkflowFileDiffV1;
    readonly request: SolutionExportWorkflowRequestV1;
    readonly scope: SolutionExportWorkflowTrustedScopeV1;
    readonly validation: SolutionExportInfrastructureValidationResultV1;
  }): Promise<unknown>;
  persistStageReport(input: {
    readonly digest: Sha256Digest;
    readonly evidenceRecords: readonly EvidenceRecordV1[];
    readonly report: unknown;
    readonly scope: SolutionExportWorkflowTrustedScopeV1;
    readonly stage: Extract<
      SolutionExportWorkflowStageIdV1,
      "build-application" | "validate-infrastructure"
    >;
  }): Promise<unknown>;
  saveCheckpoint(input: {
    readonly checkpoint: SolutionExportWorkflowCheckpointV1;
    readonly scope: SolutionExportWorkflowTrustedScopeV1;
  }): Promise<AsyncJobObjectReferenceV1>;
  saveReadModel(input: {
    readonly readModel: SolutionExportWorkflowReadModelV1;
    readonly scope: SolutionExportWorkflowTrustedScopeV1;
  }): Promise<void>;
}

export interface SolutionExportWorkflowDiffPort {
  compare(input: {
    readonly current: SolutionExportArtifactV1;
    readonly previous: AsyncJobArtifactReferenceV1 | undefined;
    readonly request: SolutionExportWorkflowRequestV1;
    readonly signal: AbortSignal;
    readonly scope: SolutionExportWorkflowTrustedScopeV1;
  }): Promise<unknown>;
}

export interface SolutionExportWorkflowClock {
  now(): Date;
}

/**
 * Waits until the next trusted cancellation poll is due. Implementations must
 * resolve promptly when `signal` is aborted so a completed stage never leaves
 * a polling task behind.
 */
export interface SolutionExportWorkflowCancellationPollPort {
  wait(input: { readonly signal: AbortSignal }): Promise<void>;
}

/**
 * The executor is the only process boundary. Implementations must not invoke a
 * shell and must treat `executable`, `args`, and file names as trusted adapter
 * constants rather than request data.
 */
export interface SolutionExportCompilerCommandExecutor {
  execute(input: {
    readonly args: readonly string[];
    readonly executable: "cloudmarkup-iac";
    readonly files: Readonly<
      Record<
        "architecture.json" | "solution-revision.json" | "workload.json",
        string
      >
    >;
    readonly limits: {
      readonly maxOutputBytes: number;
      readonly timeoutMilliseconds: number;
    };
    readonly signal: AbortSignal;
  }): Promise<{
    readonly exitCode: number | null;
    readonly stderr: string;
    readonly stdout: string;
    readonly termination:
      "completed" | "timeout" | "cancelled" | "output-limit" | "unavailable";
  }>;
}

export interface SolutionExportWorkflowDependencies {
  readonly applicationSourceDraft?: {
    generate(input: {
      readonly request: SolutionExportWorkflowRequestV1;
      readonly sources: SolutionExportWorkflowResolvedSourcesV1;
      readonly signal: AbortSignal;
    }): Promise<readonly SolutionExportSupplementalFileV1[]>;
  };
  readonly applicationBuilder: SolutionExportApplicationBuildPort;
  readonly applicationGenerator: SolutionExportApplicationGeneratorPort;
  readonly cancellation: SolutionExportWorkflowCancellationPollPort;
  readonly clock: SolutionExportWorkflowClock;
  readonly compiler: SolutionExportCompilerPort;
  readonly diff: SolutionExportWorkflowDiffPort;
  readonly diagramRenderer: SolutionExportDiagramRendererPort;
  readonly objects: SolutionExportWorkflowObjectPort;
  readonly packager: SolutionExportPackagerPort;
  readonly terraformValidator: SolutionExportTerraformValidationPort;
}

export interface SolutionExportWorkflowOrchestrator {
  run(
    record: AsyncJobRecordV1,
    context: JobHandlerContextV1,
  ): Promise<{
    readonly outcome: AsyncJobHandlerOutcomeV1;
    readonly persistedOutput?: SolutionExportWorkflowPersistedOutputV1;
    readonly readModel?: SolutionExportWorkflowReadModelV1;
  }>;
}
