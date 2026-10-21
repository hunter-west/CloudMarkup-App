import {
  applicationBuildProfileV1Schema,
  applicationBuildRequestDigest,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  type ApplicationBuildRequestV1,
  type ApplicationBuildResultV1,
} from "@cloudmarkup/application-build-runner";
import {
  APPLICATION_GENERATOR_DIGEST,
  APPLICATION_GENERATOR_ID,
  APPLICATION_GENERATOR_VERSION,
  CURRENT_APPLICATION_CATALOG,
  generateApplication,
} from "@cloudmarkup/application-generator";
import {
  createEventGenerationRequest,
  createMultiWorkloadEventGenerationRequest,
  createNotesGenerationRequest,
  type EventFixturePattern,
} from "@cloudmarkup/application-generator/testing";
import {
  diagramExportSelectionV1Schema,
  diagramRendererV1Pin,
} from "@cloudmarkup/diagram-export";
import {
  applicationGenerationRequestV1Schema,
  asyncJobRecordV1Schema,
  evidenceRecordV1Schema,
  repositoryRelativePathSchema,
  semanticVersionSchema,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
  type ApplicationGenerationRequestV1,
  type AsyncJobEnvironmentV1,
  type AsyncJobEvidenceReferenceV1,
  type AsyncJobObjectReferenceV1,
  type AsyncJobRecordV1,
  type EvidenceRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  exactToolPinV1Schema,
  sha256Digest,
  type ExactToolPinV1,
} from "@cloudmarkup/solution-export";
import {
  terraformValidationResultV1Schema,
  type TerraformValidationResultV1,
} from "@cloudmarkup/terraform-validation-runner";

import {
  goCompilationResultV1Schema,
  goTargetArtifactDigest,
  goTargetArtifactV1Schema,
  type GoCompilationResultV1,
  type GoTargetArtifactV1,
} from "./compiler-projection.js";
import { solutionExportDiagramProfileDigest } from "./diagram-renderer-adapter.js";
import {
  solutionExportApplicationBuildBatchInputV1Schema,
  solutionExportWorkflowRequestDigest,
  solutionExportWorkflowRequestV1Schema,
  solutionExportWorkflowTargetSettingsDigest,
  solutionExportWorkflowTargetSettingsProjectionV1Schema,
  solutionExportWorkflowTargetSettingsV1Schema,
  type SolutionExportWorkflowRequestV1,
  type SolutionExportWorkflowTargetSettingsV1,
} from "./contracts.js";

const AT = "2026-08-18T12:00:00.000Z";
const encoder = new TextEncoder();

export const TEST_ENVIRONMENT: AsyncJobEnvironmentV1 = {
  environmentId: "environment.development",
  environmentType: "development",
};

export const TEST_COMPILER = exactToolPinV1Schema.parse({
  digest: sha256Digest(
    serializeCanonicalJson({
      id: "cloudmarkup.iac-compiler",
      version: "1.1.0",
    }),
  ),
  id: "cloudmarkup.iac-compiler",
  version: "1.1.0",
});

export const TEST_RENDERER = exactToolPinV1Schema.parse({
  digest: sha256Digest(
    serializeCanonicalJson({
      id: "cloudmarkup.terraform-renderer",
      version: "1.1.0",
    }),
  ),
  id: "cloudmarkup.terraform-renderer",
  version: "1.1.0",
});

export const TEST_DIAGRAM_SELECTION = diagramExportSelectionV1Schema.parse({
  layout: {
    algorithm: {
      id: "cloudmarkup.diagram-layout",
      version: "1.0.0",
    },
    strategy: "deterministic",
  },
  output: {
    format: "svg-and-png",
    maxHeight: 4_096,
    maxWidth: 4_096,
    scale: 2,
  },
  profile: {
    architectureTitle: "Authenticated notes API",
    includeStableDeploymentIdentifiers: false,
    kind: "presentation",
    projectTitle: "CloudMarkup Notes",
  },
  theme: { background: "opaque-light" },
});

export const TEST_DIAGRAM_RENDERER =
  exactToolPinV1Schema.parse(diagramRendererV1Pin);

const TEST_BUILD_TOOL = exactToolPinV1Schema.parse({
  digest: sha256Digest(
    serializeCanonicalJson({
      id: "cloudmarkup.application-builder",
      version: "1.0.0",
    }),
  ),
  id: "cloudmarkup.application-builder",
  version: "1.0.0",
});

const TEST_GENERATOR = exactToolPinV1Schema.parse({
  digest: APPLICATION_GENERATOR_DIGEST,
  id: APPLICATION_GENERATOR_ID,
  version: APPLICATION_GENERATOR_VERSION,
});
const TEST_VALIDATOR = exactToolPinV1Schema.parse({
  digest: sha256Digest("cloudmarkup.terraform-validation-runner@1.0.0"),
  id: "cloudmarkup.terraform-validation-runner",
  version: "1.0.0",
});
const TEST_EXPORTER = exactToolPinV1Schema.parse({
  digest: sha256Digest("cloudmarkup.solution-export@1.0.0"),
  id: "cloudmarkup.solution-export",
  version: "1.0.0",
});

const APPROVED_GENERATION_PROFILE = createNotesGenerationRequest();

const TEST_BUILD_LIMITS = {
  cpuSeconds: 120,
  maxArtifactBytes: 8 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 2_048,
  maxOutputBytes: 256 * 1024,
  maxProcesses: 32,
  maxTotalFileBytes: 16 * 1024 * 1024,
  memoryMiB: 1_024,
  wallTimeMilliseconds: 120_000,
} as const;

const TEST_BUILD_PROFILE_DESCRIPTOR = {
  id: "cloudmarkup.application-build.generated-nodejs24" as const,
  sourcePolicy: "generated-only" as const,
  version: "1.0.0" as const,
};
const TEST_BUILD_PROFILE = applicationBuildProfileV1Schema.parse({
  ...TEST_BUILD_PROFILE_DESCRIPTOR,
  digest: sha256Digest(serializeCanonicalJson(TEST_BUILD_PROFILE_DESCRIPTOR)),
});

const APPROVED_BUILD_GENERATION = generateApplication(
  APPROVED_GENERATION_PROFILE,
);
const APPROVED_BUILD_ENVELOPE =
  APPROVED_BUILD_GENERATION.artifact.buildContracts[0];
if (APPROVED_BUILD_ENVELOPE === undefined) {
  throw new TypeError("Workflow fixture requires one approved build envelope.");
}

export function applicationBuildRequestForGeneration(
  generationRequest: ApplicationGenerationRequestV1,
  generation: ReturnType<typeof generateApplication>,
  environment: AsyncJobEnvironmentV1,
  buildContractDigest?: Sha256Digest,
): ApplicationBuildRequestV1 {
  const envelope =
    buildContractDigest === undefined
      ? generation.artifact.buildContracts[0]
      : generation.artifact.buildContracts.find(
          ({ contractDigest }) => contractDigest === buildContractDigest,
        );
  const packageManifest = generation.artifact.sourceFiles.find(
    ({ path }) => path === "application/package.json",
  );
  const packageManager = envelope?.contract.toolchain.find(
    ({ role }) => role === "package-manager",
  );
  if (
    envelope === undefined ||
    packageManifest === undefined ||
    packageManager === undefined
  ) {
    throw new TypeError(
      "Generated workflow application must carry one exact build handoff.",
    );
  }
  const lockfileContent = "lockfileVersion: '9.0'\n";
  return applicationBuildRequestV1Schema.parse({
    assessedAt: generationRequest.solutionRevision.createdAt,
    contractVersion: 1,
    dependencyLock: {
      cache: {
        digest: sha256Digest("approved-offline-application-store"),
        kind: "prepackaged-content-addressed",
        network: "deny",
      },
      contractVersion: 1,
      lifecycleScripts: "deny",
      lockfileChecksum: sha256Digest(lockfileContent),
      lockfileContent,
      lockfilePath: "application/pnpm-lock.yaml",
      packageManager: {
        digest: packageManager.digest,
        id: packageManager.id,
        version: packageManager.version,
      },
      packageManifestChecksum: packageManifest.checksum,
      packages: envelope.contract.dependencies
        .map(({ kind, name, version }) => ({
          integrity: `sha512-${"A".repeat(86)}==`,
          kind,
          name,
          tarballDigest: sha256Digest(`${name}@${version}:tarball`),
          version,
        }))
        .sort((left, right) => {
          const leftKey = `${left.name}\u0000${left.version}`;
          const rightKey = `${right.name}\u0000${right.version}`;
          return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
        }),
    },
    environment,
    limits: TEST_BUILD_LIMITS,
    profile: TEST_BUILD_PROFILE,
    solutionRevision: generationRequest.solutionRevision,
    solutionRevisionDigest: sha256Digest(
      serializeCanonicalJson(generationRequest.solutionRevision),
    ),
    source: {
      applicationGeneration: generation,
      buildContractDigest: envelope.contractDigest,
      kind: "generated",
    },
  });
}

export function eventApplicationFixtureForGenerationRequest(
  generationRequest: ApplicationGenerationRequestV1,
) {
  const generation = generateApplication(generationRequest);
  const applicationBuildRequests = [...generation.artifact.buildContracts]
    .sort((left, right) => {
      const leftKey = `${left.contract.workloadId}\u0000${left.contractDigest}`;
      const rightKey = `${right.contract.workloadId}\u0000${right.contractDigest}`;
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    })
    .map(({ contractDigest }) =>
      applicationBuildRequestForGeneration(
        generationRequest,
        generation,
        TEST_ENVIRONMENT,
        contractDigest,
      ),
    );
  return { applicationBuildRequests, generation, generationRequest };
}

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(serializeCanonicalJson(value));
}

export function durableJsonReference(
  objectId: string,
  value: unknown,
): AsyncJobObjectReferenceV1 {
  const bytes = canonicalBytes(value);
  return {
    contractVersion: 1,
    digest: sha256Digest(bytes),
    mediaType: "application/json",
    objectId,
    purpose: "input-payload",
    sizeBytes: bytes.byteLength,
  };
}

function pinCompiler(
  request: ApplicationGenerationRequestV1,
): ApplicationGenerationRequestV1 {
  const solutionRevision = solutionRevisionManifestV1Schema.parse({
    ...request.solutionRevision,
    versions: {
      ...request.solutionRevision.versions,
      compiler: { state: "pinned", tool: TEST_COMPILER },
      diagramRenderer: { state: "pinned", tool: TEST_DIAGRAM_RENDERER },
    },
  });
  return applicationGenerationRequestV1Schema.parse({
    ...request,
    solutionRevision,
  });
}

export function curatedEventApplicationFixture(pattern: EventFixturePattern) {
  const generationRequest = pinCompiler(
    createEventGenerationRequest({ pattern }),
  );
  const generation = generateApplication(generationRequest);
  const applicationBuildRequest = applicationBuildRequestForGeneration(
    generationRequest,
    generation,
    TEST_ENVIRONMENT,
  );
  return {
    applicationBuildRequest,
    generation,
    generationRequest,
  };
}
export function queueConsumerEventApplicationFixture() {
  return curatedEventApplicationFixture("sqs-consumer-dlq");
}

export function multiWorkloadEventApplicationFixture() {
  const generationRequest = pinCompiler(
    createMultiWorkloadEventGenerationRequest(),
  );
  const generation = generateApplication(generationRequest);
  const applicationBuildRequests = [...generation.artifact.buildContracts]
    .sort((left, right) => {
      const leftKey = `${left.contract.workloadId}\u0000${left.contractDigest}`;
      const rightKey = `${right.contract.workloadId}\u0000${right.contractDigest}`;
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    })
    .map(({ contractDigest }) =>
      applicationBuildRequestForGeneration(
        generationRequest,
        generation,
        TEST_ENVIRONMENT,
        contractDigest,
      ),
    );
  if (applicationBuildRequests.length !== 2) {
    throw new TypeError(
      "Multi-workload event application fixture requires exactly two builds.",
    );
  }
  return { applicationBuildRequests, generation, generationRequest };
}

export type CompilerFixtureMode =
  | "infrastructure-only"
  | "generated-starter"
  | "complete-supported-pattern"
  | "ai-assisted-custom"
  | "user-provided"
  | "external-artifact";

export type CompilerFixtureTarget = "cloudformation" | "terraform";

export function compilerFixture(
  mode: CompilerFixtureMode,
  target: CompilerFixtureTarget = "terraform",
): {
  readonly compilation: GoCompilationResultV1;
  readonly generationRequest: ApplicationGenerationRequestV1;
} {
  const baseGenerationRequest = pinCompiler(
    createNotesGenerationRequest({
      ...(target === "cloudformation"
        ? { catalog: CURRENT_APPLICATION_CATALOG }
        : {}),
      mode,
      operations: ["create", "read", "update", "delete"],
    }),
  );
  const generationRequest =
    target === "terraform"
      ? baseGenerationRequest
      : applicationGenerationRequestV1Schema.parse({
          ...baseGenerationRequest,
          normalizedSolution: {
            ...baseGenerationRequest.normalizedSolution,
            target: {
              ...baseGenerationRequest.normalizedSolution.target,
              target: "cloudformation",
            },
          },
        });
  const content =
    target === "terraform"
      ? 'terraform {\n  required_version = ">= 1.5.0, < 2.0.0"\n}\n'
      : '{\n  "AWSTemplateFormatVersion": "2010-09-09",\n  "Resources": {}\n}\n';
  const externalInputs =
    mode === "external-artifact"
      ? [
          {
            artifactId: "artifact.external.notes",
            digest: sha256Digest("reviewed-external-notes-package"),
            kind: "application-zip",
            ownership: "external",
            workloadId: "workload_notes_api",
          },
        ]
      : [];
  const targetArtifact =
    target === "terraform"
      ? {
          files: [
            {
              content,
              digest: sha256Digest(content),
              mediaType: "application/vnd.hashicorp.terraform" as const,
              ownership: "generated" as const,
              path: repositoryRelativePathSchema.parse(
                "infrastructure/main.tf",
              ),
            },
          ],
          metadata: {
            formatVersion: semanticVersionSchema.parse("1.0.0"),
            providers: [
              {
                source: "hashicorp/aws",
                version: ">= 6.55.0, < 7.0.0",
              },
            ],
            requiredTerraformVersion: ">= 1.5.0, < 2.0.0",
          },
          target: "terraform" as const,
        }
      : {
          files: [
            {
              content,
              digest: sha256Digest(content),
              mediaType:
                "application/vnd.amazon.cloudformation.template+json" as const,
              ownership: "generated" as const,
              path: repositoryRelativePathSchema.parse(
                "infrastructure/template.json",
              ),
            },
          ],
          metadata: {
            formatVersion: semanticVersionSchema.parse("1.0.0"),
            localValidation: "cloudmarkup-structured-template-v1",
            templateFormat: "json" as const,
            templateSpecificationVersion: "2010-09-09" as const,
          },
          target: "cloudformation" as const,
        };
  const provisional = {
    applicationArtifacts: [
      {
        codeRequired: true,
        contractVersion: 1,
        delivery: "source-reference",
        generationCoverage: "application-code-required",
        implementationMode: mode,
        inputs: externalInputs,
        variables: [],
        workloadId: "workload_notes_api",
      },
    ],
    contractVersion: 1,
    digest: sha256Digest("provisional-go-artifact"),
    files: targetArtifact.files,
    formatVersion: semanticVersionSchema.parse("1.0.0"),
    metadata: targetArtifact.metadata,
    policyArtifacts: [],
    provenance: generationRequest.normalizedSolution.provenance,
    target: targetArtifact.target,
  } as GoTargetArtifactV1;
  const artifact = goTargetArtifactV1Schema.parse({
    ...provisional,
    digest: goTargetArtifactDigest(provisional),
  });
  const compilation = goCompilationResultV1Schema.parse({
    artifact,
    compiler: TEST_COMPILER,
    contractVersion: 1,
    diagnostics: [],
    model: generationRequest.normalizedSolution,
  });
  return { compilation, generationRequest };
}

export interface WorkflowFixture {
  readonly compilation: GoCompilationResultV1;
  readonly generationRequest: ApplicationGenerationRequestV1;
  readonly applicationBuildRequest?: ApplicationBuildRequestV1;
  readonly applicationBuildRequests?: readonly ApplicationBuildRequestV1[];
  readonly objects: ReadonlyMap<string, Uint8Array>;
  readonly record: AsyncJobRecordV1;
  readonly request: SolutionExportWorkflowRequestV1;
}

const TEST_TARGET_SETTINGS_PROJECTION =
  solutionExportWorkflowTargetSettingsProjectionV1Schema.parse({
    contractVersion: 1,
    limits: {
      maxArchiveBytes: 8 * 1024 * 1024,
      maxDecompressedBytes: 8 * 1024 * 1024,
      maxFileBytes: 2 * 1024 * 1024,
      maxFiles: 512,
      maxPathBytes: 200,
    },
    policyPacks: [],
    renderer: TEST_RENDERER,
    stageDescriptors: {
      applicationBuild: {
        adapter: TEST_BUILD_TOOL,
        dependencyContractDigest: sha256Digest(
          serializeCanonicalJson(APPROVED_BUILD_ENVELOPE.contract.dependencies),
        ),
        limitsDigest: sha256Digest(serializeCanonicalJson(TEST_BUILD_LIMITS)),
        profileDigest: TEST_BUILD_PROFILE.digest,
        profileId: TEST_BUILD_PROFILE.id,
        toolchainDigest: sha256Digest(
          serializeCanonicalJson(APPROVED_BUILD_ENVELOPE.contract.toolchain),
        ),
      },
      applicationGenerator: {
        adapter: TEST_GENERATOR,
        limitsDigest: sha256Digest("reviewed-application-generation-limits-v1"),
        profileDigest: sha256Digest(
          serializeCanonicalJson({
            adapter: TEST_GENERATOR,
            pattern: APPROVED_GENERATION_PROFILE.pattern,
            runtime: APPROVED_GENERATION_PROFILE.runtime,
            template: APPROVED_GENERATION_PROFILE.template,
          }),
        ),
        profileId: "cloudmarkup.generator.application",
        pattern: APPROVED_GENERATION_PROFILE.pattern,
        runtime: APPROVED_GENERATION_PROFILE.runtime,
        template: APPROVED_GENERATION_PROFILE.template,
      },
      compiler: {
        adapter: TEST_COMPILER,
        limitsDigest: sha256Digest("reviewed-compiler-limits-v1"),
        profileDigest: sha256Digest("reviewed-terraform-compiler-profile-v1"),
        profileId: "cloudmarkup.compiler.terraform",
      },
      diagramRenderer: {
        adapter: TEST_DIAGRAM_RENDERER,
        limitsDigest: sha256Digest(
          serializeCanonicalJson(TEST_DIAGRAM_SELECTION.output),
        ),
        profileDigest: solutionExportDiagramProfileDigest(
          TEST_DIAGRAM_SELECTION,
        ),
        profileId: "cloudmarkup.diagram.presentation",
      },
      exporter: {
        adapter: TEST_EXPORTER,
        limitsDigest: sha256Digest("reviewed-export-limits-v1"),
        profileDigest: sha256Digest("reviewed-export-profile-v1"),
        profileId: "cloudmarkup.export.terraform",
      },
      terraformValidation: {
        adapter: TEST_VALIDATOR,
        limitsDigest: sha256Digest("reviewed-terraform-validation-limits-v1"),
        policyDigest: sha256Digest("reviewed-terraform-validation-policy-v1"),
        profileDigest: sha256Digest("reviewed-terraform-validation-profile-v1"),
        profileId: "cloudmarkup.validation.terraform",
      },
    },
    target: "terraform",
  });

export const TEST_TARGET_SETTINGS =
  solutionExportWorkflowTargetSettingsV1Schema.parse({
    ...TEST_TARGET_SETTINGS_PROJECTION,
    digest: solutionExportWorkflowTargetSettingsDigest(
      TEST_TARGET_SETTINGS_PROJECTION,
    ),
  });

export function workflowTargetSettings(
  target: CompilerFixtureTarget,
): SolutionExportWorkflowTargetSettingsV1 {
  if (
    !("terraformValidation" in TEST_TARGET_SETTINGS_PROJECTION.stageDescriptors)
  ) {
    throw new TypeError(
      "Terraform fixture settings require a Terraform validation descriptor.",
    );
  }
  if (target === "terraform") return TEST_TARGET_SETTINGS;
  const { terraformValidation, ...commonStageDescriptors } =
    TEST_TARGET_SETTINGS_PROJECTION.stageDescriptors;
  const projection =
    solutionExportWorkflowTargetSettingsProjectionV1Schema.parse({
      ...TEST_TARGET_SETTINGS_PROJECTION,
      stageDescriptors: {
        ...commonStageDescriptors,
        cloudFormationValidation: {
          adapter: terraformValidation.adapter,
          limitsDigest: sha256Digest(
            "reviewed-cloudformation-validation-limits-v1",
          ),
          profileDigest: sha256Digest(
            "reviewed-cloudformation-validation-profile-v1",
          ),
          profileId: "cloudmarkup.validation.cloudformation",
        },
        compiler: {
          ...commonStageDescriptors.compiler,
          profileDigest: sha256Digest(
            "reviewed-cloudformation-compiler-profile-v1",
          ),
          profileId: "cloudmarkup.compiler.cloudformation",
        },
        exporter: {
          ...commonStageDescriptors.exporter,
          profileDigest: sha256Digest(
            "reviewed-cloudformation-export-profile-v1",
          ),
          profileId: "cloudmarkup.export.cloudformation",
        },
      },
      target: "cloudformation",
    });
  return solutionExportWorkflowTargetSettingsV1Schema.parse({
    ...projection,
    digest: solutionExportWorkflowTargetSettingsDigest(projection),
  });
}

export function workflowFixture(
  mode: CompilerFixtureMode = "infrastructure-only",
  target: CompilerFixtureTarget = "terraform",
  applicationSource?: "ai-source-draft-v1",
): WorkflowFixture {
  const { compilation, generationRequest } = compilerFixture(mode, target);
  const targetSettings = workflowTargetSettings(target);
  const generatedApplication =
    mode === "generated-starter" || mode === "complete-supported-pattern"
      ? generateApplication(generationRequest)
      : undefined;
  const applicationBuildRequest =
    generatedApplication === undefined
      ? undefined
      : applicationBuildRequestForGeneration(
          generationRequest,
          generatedApplication,
          TEST_ENVIRONMENT,
        );
  const applicationBuildInputs =
    applicationBuildRequest === undefined
      ? undefined
      : durableJsonReference(
          "object.application-build-inputs.1",
          applicationBuildRequest,
        );
  const architectureDocument = durableJsonReference(
    "object.architecture.1",
    generationRequest.architectureDocument,
  );
  const workloadBehavior = durableJsonReference(
    "object.workload.1",
    generationRequest.workloadBehavior,
  );
  const solutionRevision = durableJsonReference(
    "object.solution-revision-content.1",
    generationRequest.solutionRevision,
  );
  const subject = {
    kind: "solution-revision" as const,
    manifestDigest: solutionRevision.digest,
    manifestRecordId: "record.solution-revision.1",
    solutionRevisionId: generationRequest.solutionRevision.solutionRevisionId,
  };
  const request = solutionExportWorkflowRequestV1Schema.parse({
    contractVersion: 1,
    diagram: TEST_DIAGRAM_SELECTION,
    environment: TEST_ENVIRONMENT,
    exportName: "Notes API Export",
    ...(applicationSource === undefined ? {} : { applicationSource }),
    kind: "cloudmarkup.solution-export-workflow-request",
    sources: {
      ...(applicationBuildInputs === undefined
        ? {}
        : { applicationBuildInputs }),
      architectureDocument,
      solutionRevision,
      workloadBehavior,
    },
    subject,
    targetProfileId:
      target === "terraform"
        ? "cloudmarkup.export.terraform"
        : "cloudmarkup.export.cloudformation-nodejs24-v1",
    targetSettings,
  });
  const requestReference = durableJsonReference(
    "object.solution-export-request.1",
    request,
  );
  const input = {
    contractVersion: 1 as const,
    environment: TEST_ENVIRONMENT,
    family: "solution-export-orchestration" as const,
    request: requestReference,
    subject,
    targetProfileId: request.targetProfileId,
    targetSettingsDigest: request.targetSettings.digest,
  };
  const record = asyncJobRecordV1Schema.parse({
    attempts: [],
    cancellation: { state: "none" },
    checkpoints: [],
    contractVersion: 1,
    correlationId: "correlation.solution-export.1",
    createdAt: AT,
    family: "solution-export-orchestration",
    idempotency: {
      actorId: "actor.solution-export.1",
      keyDigest: sha256Digest("solution-export-idempotency-key"),
      operationId: "solution-export.create",
      requestDigest: solutionExportWorkflowRequestDigest(request),
    },
    input,
    inputDigest: sha256Digest(serializeCanonicalJson(input)),
    inputSizeBytes: canonicalBytes(input).byteLength,
    interaction: { state: "none" },
    jobId: "job.solution-export.1",
    limits: {
      artifactCount: 16,
      attemptCount: 3,
      checkpointBytes: 1_048_576,
      checkpointCount: 1,
      contractVersion: 1,
      inlineInputBytes: 65_536,
      outputBytes: 64 * 1024 * 1024,
      referencedInputBytes: 64 * 1024 * 1024,
      runtimeSeconds: 300,
    },
    orchestration: {
      dependencyJobIds: [],
      expectedChildJobIds: [],
      failurePolicy: "fail-parent",
      rootJobId: "job.solution-export.1",
    },
    ownership: {
      organizationId: "organization.1",
      projectId: "project.1",
    },
    queuedAt: AT,
    recordVersion: 1,
    reservation: { state: "none" },
    state: "queued",
    updatedAt: AT,
  });
  return {
    ...(applicationBuildRequest === undefined
      ? {}
      : { applicationBuildRequest }),
    compilation,
    generationRequest,
    objects: new Map([
      [
        architectureDocument.objectId,
        canonicalBytes(generationRequest.architectureDocument),
      ],
      [requestReference.objectId, canonicalBytes(request)],
      ...(applicationBuildInputs === undefined ||
      applicationBuildRequest === undefined
        ? []
        : [
            [
              applicationBuildInputs.objectId,
              canonicalBytes(applicationBuildRequest),
            ] as const,
          ]),
      [
        solutionRevision.objectId,
        canonicalBytes(generationRequest.solutionRevision),
      ],
      [
        workloadBehavior.objectId,
        canonicalBytes(generationRequest.workloadBehavior),
      ],
    ]),
    record,
    request,
  };
}

export function multiWorkloadEventWorkflowFixture(): WorkflowFixture {
  const base = workflowFixture("complete-supported-pattern");
  const generationRequest = pinCompiler(
    createMultiWorkloadEventGenerationRequest({
      catalog: CURRENT_APPLICATION_CATALOG,
    }),
  );
  const generation = generateApplication(generationRequest);
  const envelopes = [...generation.artifact.buildContracts].sort(
    (left, right) => {
      const leftKey = `${left.contract.workloadId}\u0000${left.contractDigest}`;
      const rightKey = `${right.contract.workloadId}\u0000${right.contractDigest}`;
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    },
  );
  if (envelopes.length !== 2) {
    throw new TypeError("Multi-workload fixture requires exactly two builds.");
  }
  const applicationBuildRequests = envelopes.map(({ contractDigest }) =>
    applicationBuildRequestForGeneration(
      generationRequest,
      generation,
      TEST_ENVIRONMENT,
      contractDigest,
    ),
  );
  const applicationBuildInput =
    solutionExportApplicationBuildBatchInputV1Schema.parse({
      contractVersion: 1,
      kind: "cloudmarkup.application-build-batch-input",
      requests: applicationBuildRequests,
    });
  const firstEnvelope = envelopes[0];
  if (firstEnvelope === undefined) {
    throw new TypeError("Multi-workload fixture requires a build envelope.");
  }
  const generationCoverageByWorkload = new Map(
    generation.artifact.coverage.workloads.map((coverage) => [
      coverage.workloadId,
      coverage.state,
    ]),
  );
  const dependencyContractDigest = sha256Digest(
    serializeCanonicalJson(firstEnvelope.contract.dependencies),
  );
  const toolchainDigest = sha256Digest(
    serializeCanonicalJson(firstEnvelope.contract.toolchain),
  );
  if (
    envelopes.some(
      ({ contract }) =>
        sha256Digest(serializeCanonicalJson(contract.dependencies)) !==
          dependencyContractDigest ||
        sha256Digest(serializeCanonicalJson(contract.toolchain)) !==
          toolchainDigest,
    )
  ) {
    throw new TypeError(
      "Multi-workload fixture requires one reviewed build profile.",
    );
  }
  const targetSettingsProjection =
    solutionExportWorkflowTargetSettingsProjectionV1Schema.parse({
      ...TEST_TARGET_SETTINGS_PROJECTION,
      limits: {
        ...TEST_TARGET_SETTINGS_PROJECTION.limits,
        maxPathBytes: 240,
      },
      stageDescriptors: {
        ...TEST_TARGET_SETTINGS_PROJECTION.stageDescriptors,
        applicationBuild: {
          ...TEST_TARGET_SETTINGS_PROJECTION.stageDescriptors.applicationBuild,
          dependencyContractDigest,
          toolchainDigest,
        },
        applicationGenerator: {
          ...TEST_TARGET_SETTINGS_PROJECTION.stageDescriptors
            .applicationGenerator,
          adapter: generationRequest.generator,
          pattern: generationRequest.pattern,
          profileDigest: sha256Digest(
            serializeCanonicalJson({
              adapter: generationRequest.generator,
              pattern: generationRequest.pattern,
              runtime: generationRequest.runtime,
              template: generationRequest.template,
            }),
          ),
          runtime: generationRequest.runtime,
          template: generationRequest.template,
        },
      },
    });
  const targetSettings = solutionExportWorkflowTargetSettingsV1Schema.parse({
    ...targetSettingsProjection,
    digest: solutionExportWorkflowTargetSettingsDigest(
      targetSettingsProjection,
    ),
  });

  const baseArtifact = base.compilation.artifact;
  const baseApplicationArtifact = baseArtifact?.applicationArtifacts?.[0];
  if (baseArtifact === undefined || baseApplicationArtifact === undefined) {
    throw new TypeError("Multi-workload fixture requires compiler output.");
  }
  const provisionalArtifact = {
    ...baseArtifact,
    applicationArtifacts: envelopes.map(({ contract }) => ({
      ...baseApplicationArtifact,
      artifactReadiness: "application-artifact-ready",
      codeRequired: false,
      contractVersion: 2 as const,
      delivery: "deterministic-relative-package",
      expectedArtifact: {
        ...contract.expectedArtifact,
        runtime: contract.runtime,
      },
      generationCoverage:
        generationCoverageByWorkload.get(contract.workloadId) ??
        "custom-implementation-required",
      implementationMode: "complete-supported-pattern",
      inputs: [],
      relativePackagePath: `../${contract.expectedArtifact.path}`,
      variables: null,
      workloadId: contract.workloadId,
    })),
    digest: sha256Digest("provisional-multi-workload-artifact"),
    provenance: generationRequest.normalizedSolution.provenance,
  };
  const artifact = goTargetArtifactV1Schema.parse({
    ...provisionalArtifact,
    digest: goTargetArtifactDigest(
      provisionalArtifact as unknown as GoTargetArtifactV1,
    ),
  });
  const compilation = goCompilationResultV1Schema.parse({
    ...base.compilation,
    artifact,
    model: generationRequest.normalizedSolution,
  });

  const architectureDocument = durableJsonReference(
    "object.architecture.event-multi.1",
    generationRequest.architectureDocument,
  );
  const workloadBehavior = durableJsonReference(
    "object.workload.event-multi.1",
    generationRequest.workloadBehavior,
  );
  const solutionRevision = durableJsonReference(
    "object.solution-revision-content.event-multi.1",
    generationRequest.solutionRevision,
  );
  const applicationBuildInputs = durableJsonReference(
    "object.application-build-inputs.event-multi.1",
    applicationBuildInput,
  );
  const subject = {
    kind: "solution-revision" as const,
    manifestDigest: solutionRevision.digest,
    manifestRecordId: "record.solution-revision.event-multi.1",
    solutionRevisionId: generationRequest.solutionRevision.solutionRevisionId,
  };
  const request = solutionExportWorkflowRequestV1Schema.parse({
    ...base.request,
    exportName: "Event fan-out export",
    sources: {
      applicationBuildInputs,
      architectureDocument,
      solutionRevision,
      workloadBehavior,
    },
    subject,
    targetSettings,
  });
  const requestReference = durableJsonReference(
    "object.solution-export-request.event-multi.1",
    request,
  );
  const input = {
    ...base.record.input,
    request: requestReference,
    subject,
    targetSettingsDigest: targetSettings.digest,
  };
  const record = asyncJobRecordV1Schema.parse({
    ...base.record,
    idempotency: {
      ...base.record.idempotency,
      requestDigest: solutionExportWorkflowRequestDigest(request),
    },
    input,
    inputDigest: sha256Digest(serializeCanonicalJson(input)),
    inputSizeBytes: canonicalBytes(input).byteLength,
  });
  const reconstructedGeneration =
    applicationGenerationRequestV1Schema.safeParse({
      architectureDocument: generationRequest.architectureDocument,
      contractVersion: 1,
      existingFiles: [],
      generator: targetSettings.stageDescriptors.applicationGenerator.adapter,
      normalizedSolution: compilation.model,
      pattern: targetSettings.stageDescriptors.applicationGenerator.pattern,
      runtime: targetSettings.stageDescriptors.applicationGenerator.runtime,
      solutionRevision: generationRequest.solutionRevision,
      template: targetSettings.stageDescriptors.applicationGenerator.template,
      workloadBehavior: generationRequest.workloadBehavior,
    });
  if (!reconstructedGeneration.success) {
    throw new TypeError(
      `Multi-workload generation handoff is invalid: ${JSON.stringify(
        reconstructedGeneration.error.issues,
      )}`,
    );
  }
  const firstBuildRequest = applicationBuildRequests[0];
  if (firstBuildRequest === undefined) {
    throw new TypeError("Multi-workload fixture requires a build request.");
  }
  return {
    applicationBuildRequest: firstBuildRequest,
    applicationBuildRequests,
    compilation,
    generationRequest,
    objects: new Map([
      [
        architectureDocument.objectId,
        canonicalBytes(generationRequest.architectureDocument),
      ],
      [applicationBuildInputs.objectId, canonicalBytes(applicationBuildInput)],
      [requestReference.objectId, canonicalBytes(request)],
      [
        solutionRevision.objectId,
        canonicalBytes(generationRequest.solutionRevision),
      ],
      [
        workloadBehavior.objectId,
        canonicalBytes(generationRequest.workloadBehavior),
      ],
    ]),
    record,
    request,
  };
}
function evidence(input: {
  readonly artifactDigest?: Sha256Digest;
  readonly environment: AsyncJobEnvironmentV1;
  readonly id: string;
  readonly inputDigests?: readonly Sha256Digest[];
  readonly level:
    | { readonly kind: "deterministic-target-compilation"; readonly rank: 3 }
    | { readonly kind: "application-build-and-tests"; readonly rank: 5 };
  readonly requirement?:
    "application-build-and-tests" | "application-security-checks";
  readonly solutionRevisionId: string;
  readonly status: "passed" | "failed" | "error";
  readonly tool: ExactToolPinV1;
}): EvidenceRecordV1 {
  return evidenceRecordV1Schema.parse({
    artifacts:
      input.artifactDigest === undefined
        ? []
        : [
            {
              digest: input.artifactDigest,
              mediaType: "application/json",
              sizeBytes: 1,
            },
          ],
    checks: [
      {
        artifactDigests:
          input.artifactDigest === undefined ? [] : [input.artifactDigest],
        checkId:
          input.level.rank === 5
            ? "cloudmarkup.evidence.application-build-and-tests"
            : "cloudmarkup.evidence.terraform-static-validation",
        ...(input.requirement === undefined
          ? {}
          : { generationCoverageRequirement: input.requirement }),
        issueIds: [],
        ...(input.status === "passed"
          ? {}
          : { redactedFailure: "The isolated check did not pass." }),
        status: input.status,
        summary:
          input.level.rank === 5
            ? "Application build and isolated tests were evaluated."
            : "Offline Terraform validation was evaluated.",
      },
    ],
    contractVersion: 1,
    environment: input.environment,
    id: input.id,
    layer: "generated",
    level: input.level,
    models: [],
    provenance: {
      actor: { kind: "deterministic-tool", tool: input.tool },
      createdAt: AT,
      inputDigests: [
        ...new Set([
          ...(input.artifactDigest === undefined ? [] : [input.artifactDigest]),
          ...(input.inputDigests ?? []),
        ]),
      ].sort(),
    },
    solutionRevisionId: input.solutionRevisionId,
    staleness: { assessedAt: AT, state: "current" },
    tools: [input.tool],
  });
}

export function failedBuildResult(
  fixture: WorkflowFixture,
  testKind: "unit" | "contract",
): ApplicationBuildResultV1 {
  const buildRequest = fixture.applicationBuildRequest;
  if (buildRequest?.source.kind !== "generated") {
    throw new TypeError(
      "Failed build fixture requires exact generated inputs.",
    );
  }
  const buildRequestDigest = applicationBuildRequestDigest(buildRequest);
  const generationArtifactDigest =
    buildRequest.source.applicationGeneration.artifactDigest;
  const workloadCoverage =
    buildRequest.source.applicationGeneration.artifact.coverage.workloads.find(
      ({ workloadId }) => workloadId === "workload_notes_api",
    );
  if (workloadCoverage === undefined) {
    throw new TypeError("Failed build fixture requires workload coverage.");
  }
  const buildEvidence = evidence({
    environment: fixture.request.environment,
    id: `evidence_build_${testKind}_failed_1`,
    inputDigests: [
      buildRequestDigest,
      buildRequest.solutionRevisionDigest,
      generationArtifactDigest,
    ],
    level: { kind: "application-build-and-tests", rank: 5 },
    requirement: "application-build-and-tests",
    solutionRevisionId: fixture.request.subject.solutionRevisionId,
    status: "failed",
    tool: TEST_BUILD_TOOL,
  });
  const projection = {
    artifacts: [],
    contractVersion: 1 as const,
    coverage: {
      buildRequestDigest,
      confirmedState: "custom-implementation-required" as const,
      downgradeReason: `${testKind === "unit" ? "Unit" : "Contract"} tests did not pass.`,
      generationArtifactDigest,
      inputState: workloadCoverage.state,
      solutionRevisionDigest: buildRequest.solutionRevisionDigest,
      solutionRevisionId: buildRequest.solutionRevision.solutionRevisionId,
      workloadId: "workload_notes_api",
    },
    diagnostics: [
      {
        code: `application.build.${testKind}-tests-failed`,
        detail:
          "C:\\private\\operator\\source.ts failed and was sanitized upstream.",
        references: {
          contractIds: [],
          operationIds: [],
          path: "application/src/index.ts",
          solutionRevisionId: fixture.request.subject.solutionRevisionId,
          workloadId: "workload_notes_api",
        },
        severity: "error" as const,
        source: `${testKind}-tests` as const,
        summary: `${testKind === "unit" ? "Unit" : "Contract"} tests failed.`,
      },
    ],
    evidence: buildEvidence,
    findings: [],
    state: "failed" as const,
    steps: [],
    tests: [
      {
        failed: 1,
        kind: testKind,
        passed: 3,
        skipped: 0,
        state: "failed" as const,
      },
    ],
  };
  return applicationBuildResultV1Schema.parse({
    ...projection,
    reportDigest: sha256Digest(serializeCanonicalJson(projection)),
  });
}

export function cancelledBuildResult(
  fixture: WorkflowFixture,
): ApplicationBuildResultV1 {
  const failed = failedBuildResult(fixture, "unit");
  const { reportDigest, ...failedProjection } = failed;
  if (reportDigest !== sha256Digest(serializeCanonicalJson(failedProjection))) {
    throw new TypeError(
      "Canceled build fixture requires a canonical failed report.",
    );
  }
  const projection = { ...failedProjection, state: "cancelled" as const };
  return applicationBuildResultV1Schema.parse({
    ...projection,
    reportDigest: sha256Digest(serializeCanonicalJson(projection)),
  });
}

export function validationResult(
  fixture: WorkflowFixture,
  state: "passed" | "failed" | "cancelled" = "passed",
): TerraformValidationResultV1 {
  const diagnostics =
    state === "passed"
      ? []
      : [
          {
            code:
              state === "cancelled"
                ? "terraform.validation.command-cancelled"
                : "terraform.validation.reviewed-check-failed",
            detail:
              "C:\\private\\terraform\\main.tf included secret diagnostic detail.",
            path: "infrastructure/main.tf",
            references: {
              edgeIds: ["edge_notes_table"],
              nodeIds: ["node_notes_lambda"],
              ownedPolicyIds: ["policy_notes_read"],
              solutionRevisionId: fixture.request.subject.solutionRevisionId,
            },
            severity: "error" as const,
            source: "terraform-validate" as const,
            summary:
              state === "cancelled"
                ? "Offline Terraform validation was cancelled."
                : "Offline Terraform validation failed.",
          },
        ];
  const commandSummaries =
    state === "passed"
      ? []
      : [
          {
            executable: "terraform" as const,
            outputBytes: 32,
            state,
            step: "validate" as const,
          },
        ];
  const reportDigest = sha256Digest(
    serializeCanonicalJson({ commandSummaries, diagnostics }),
  );
  const evidenceRecords = [
    evidence({
      artifactDigest: reportDigest,
      environment: fixture.request.environment,
      id: `evidence_terraform_validation_${state}_1`,
      level: { kind: "deterministic-target-compilation", rank: 3 },
      solutionRevisionId: fixture.request.subject.solutionRevisionId,
      status:
        state === "passed" ? "passed" : state === "failed" ? "failed" : "error",
      tool: TEST_VALIDATOR,
    }),
  ];
  return terraformValidationResultV1Schema.parse({
    commandSummaries,
    contractVersion: 1,
    diagnostics,
    evidenceRecords,
    reportDigest,
    state,
  });
}

export function evidenceReference(
  record: EvidenceRecordV1,
  environment: AsyncJobEnvironmentV1,
): AsyncJobEvidenceReferenceV1 {
  const bytes = canonicalBytes(record);
  return {
    environment,
    evidenceId: record.id,
    record: {
      contractVersion: 1,
      digest: sha256Digest(bytes),
      mediaType: "application/json",
      objectId: `object.${record.id}`,
      purpose: "evidence",
      sizeBytes: bytes.byteLength,
    },
    solutionRevisionId: record.solutionRevisionId,
  };
}
