import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createDiagramIconSetV1 } from "@cloudmarkup/diagram-export";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogArtifactV1,
} from "@cloudmarkup/provider-aws";
import { createAwsDiagramIconRegistryTestInput } from "@cloudmarkup/provider-aws/testing/diagram-icon-registry";
import {
  SOLUTION_EXPORT_STAGES_V1,
  solutionExportArtifactDiffResponseV1Schema,
  solutionExportArtifactResponseV1Schema,
  solutionExportArtifactV1Schema,
  solutionExportDownloadGrantResponseV1Schema,
  solutionExportFilePreviewResponseV1Schema,
  solutionExportJobResponseV1Schema,
  type SolutionExportJobV1,
} from "@cloudmarkup/api-contract";
import { generateApplication } from "@cloudmarkup/application-generator";
import { CUSTOMER_CI_WORKFLOW_PATHS } from "@cloudmarkup/customer-ci-workflow";
import {
  CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
  createCustomerCiWorkflowTestConfigV1,
} from "@cloudmarkup/customer-ci-workflow/testing";
import { GitHubRepositoryExportService } from "@cloudmarkup/github-repository-export/service";
import {
  FakeGitHubAppAdapter,
  FakeGitHubInstallationLinkCallbackVerifier,
  InMemoryApprovedSolutionPackageRepository,
  InMemoryGitHubExportStore,
  RecordingGitHubExportAuditSink,
  RecordingGitHubExportProgressSink,
} from "@cloudmarkup/github-repository-export/testing";
import {
  architectureDocumentV3Schema,
  evidenceRecordV1Schema,
  repositoryRelativePathSchema,
  serializeCanonicalJson,
  solutionGenerationCoverageV1Schema,
  asyncJobArtifactReferenceV1Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobRecordV1Schema,
  solutionRevisionManifestV1Schema,
  type AsyncJobCheckpointV1,
  type SolutionGenerationCoverageV1,
} from "@cloudmarkup/schemas";
import {
  localSolutionExportService,
  readDeterministicZip,
  sha256Digest,
  solutionExportRequestV1Schema,
  type SolutionExportArtifactV1 as VerifiedSolutionExportArtifactV1,
} from "@cloudmarkup/solution-export";
import {
  createSolutionExportWorkflowOrchestrator,
  createSolutionExportApplicationGeneratorPort,
  createGoCliSolutionExportCompilerPort,
  goCompilationResultV1Schema,
  goTargetArtifactDigest,
  createSolutionExportApplicationBuildPort,
  createSolutionExportDiagramRendererPort,
  createSolutionExportTerraformValidationPort,
  createTimerSolutionExportWorkflowCancellationPollPort,
  solutionExportApplicationBuildBatchInputV1Schema,
  solutionExportApplicationBuildBatchResultV1Schema,
  terraformValidationRequestFromWorkflowInput,
  solutionExportWorkflowRequestV1Schema,
  solutionExportWorkflowSourceInputsV1Schema,
  projectGoCompilationResultToSolutionExportInfrastructure,
  type SolutionExportWorkflowStageDescriptorsV1,
  diagramExportForSolutionExport,
  type SolutionExportWorkflowDependencies,
} from "@cloudmarkup/solution-export-workflow";
import {
  canonicalBytes,
  evidenceReference,
  TEST_TARGET_SETTINGS,
  validationResult,
  workflowFixture,
  multiWorkloadEventWorkflowFixture,
  passingBuildResult,
} from "@cloudmarkup/solution-export-workflow/testing";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { GitHubRepositoryExportApplicationService } from "./application/github-exports.js";
import {
  DefaultSolutionExportApplication,
  type ImmutableSolutionRevisionExportBinding,
  type SolutionExportWorkflowEnqueueV1,
  type StoredSolutionExportArtifact,
  type StoredSolutionExportJob,
} from "./application/solution-exports.js";
import { createSolutionExportRunInsertionBindingV1 } from "./application/solution-export-persistence-binding.js";
import {
  createInjectedLocalSolutionExportComposition,
  projectInjectedSolutionExportProgress,
} from "./local-development/solution-export-composition.js";
import { projectInjectedSolutionExportResult } from "./application/solution-export-projection.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "./testing/in-memory-adapters.js";
import {
  InMemorySolutionExportStore,
  InMemorySolutionExportWorkflow,
  solutionExportBytesDigest,
  type InMemorySolutionExportProcessor,
} from "./testing/in-memory-solution-exports.js";

const NOW = "2026-08-18T12:00:00.000Z";
const COMPLETE = "2026-08-18T12:00:01.000Z";
const RETENTION_EXPIRES = "2026-08-18T13:00:00.000Z";
const TOKEN = "Bearer export-owner";
const VIEWER_TOKEN = "Bearer export-viewer";
const OTHER_TOKEN = "Bearer export-other";
const DIGEST = `sha256:${"a".repeat(64)}` as const;
const PROFILE = "cloudmarkup.export.terraform-nodejs24-v1" as const;

const API_WORKFLOW_ENVIRONMENT = { environmentType: "development" } as const;
const API_DIAGRAM_ICON_REGISTRY = createAwsDiagramIconRegistryTestInput();
const API_DIAGRAM_ICON_SET = createDiagramIconSetV1({
  assetsByFile: Object.fromEntries(
    Object.entries(API_DIAGRAM_ICON_REGISTRY.assetSpecifiersByFile).map(
      ([file, specifier]) => [
        file,
        readFileSync(fileURLToPath(import.meta.resolve(specifier)), "utf8"),
      ],
    ),
  ),
  catalog: API_DIAGRAM_ICON_REGISTRY.catalog,
  manifest: API_DIAGRAM_ICON_REGISTRY.manifest,
});
const API_DIAGRAM_RENDERER = createSolutionExportDiagramRendererPort({
  catalog: API_DIAGRAM_ICON_REGISTRY.catalog,
  iconSet: API_DIAGRAM_ICON_SET,
});
const API_EVENT_DIAGRAM_RENDERER = createSolutionExportDiagramRendererPort({
  catalog: awsCatalogArtifactV1,
  iconSet: API_DIAGRAM_ICON_SET,
});

function bindWorkflowFixtureRevision(
  fixture: ReturnType<typeof workflowFixture>,
  coverageState: SolutionGenerationCoverageV1["state"],
): ReturnType<typeof workflowFixture> {
  const requiredEvidence =
    coverageState === "starter-application"
      ? (["deterministic-application-generation"] as const)
      : coverageState === "complete-supported-pattern"
        ? ([
            "structural-validity",
            "provider-architecture-validity",
            "deterministic-application-generation",
            "application-build-and-tests",
            "application-security-checks",
          ] as const)
        : [];
  const evidence = requiredEvidence.map((requirement, index) => ({
    evidenceId: `evidence.coverage.${String(index + 1)}`,
    requirement,
  }));
  const generationCoverage = solutionGenerationCoverageV1Schema.parse({
    contractVersion: 1,
    evidence,
    missingRequirements:
      coverageState === "infrastructure-only"
        ? [
            "deterministic-application-generation",
            "application-build-and-tests",
            "application-security-checks",
          ]
        : [],
    solutionRevisionId:
      fixture.generationRequest.solutionRevision.solutionRevisionId,
    state: coverageState,
    workloads: [],
  });
  const solutionRevision = solutionRevisionManifestV1Schema.parse({
    ...fixture.generationRequest.solutionRevision,
    evidenceIdsAtFreeze: [
      ...fixture.generationRequest.solutionRevision.evidenceIdsAtFreeze,
      ...evidence.map(({ evidenceId }) => evidenceId),
    ],
    generationCoverage,
  });
  const generationRequest = {
    ...fixture.generationRequest,
    solutionRevision,
  };
  const solutionRevisionBytes = canonicalBytes(solutionRevision);
  const solutionRevisionReference = asyncJobObjectReferenceV1Schema.parse({
    ...fixture.request.sources.solutionRevision,
    digest: solutionExportBytesDigest(solutionRevisionBytes),
    sizeBytes: solutionRevisionBytes.byteLength,
  });
  const objects = new Map(fixture.objects);
  objects.set(solutionRevisionReference.objectId, solutionRevisionBytes);
  const buildRequests =
    fixture.applicationBuildRequests ??
    (fixture.applicationBuildRequest === undefined
      ? []
      : [fixture.applicationBuildRequest]);
  const buildReference = fixture.request.sources.applicationBuildInputs;
  if (buildRequests.length === 0 || buildReference === undefined) {
    const request = solutionExportWorkflowRequestV1Schema.parse({
      ...fixture.request,
      environment: API_WORKFLOW_ENVIRONMENT,
      sources: {
        ...fixture.request.sources,
        solutionRevision: solutionRevisionReference,
      },
      subject: {
        ...fixture.request.subject,
        manifestDigest: solutionRevisionReference.digest,
      },
    });
    return {
      ...fixture,
      generationRequest,
      objects,
      request,
    };
  }
  const generation = generateApplication(generationRequest);
  const packageManifest = generation.artifact.sourceFiles.find(
    ({ path }) => path === "application/package.json",
  );
  if (packageManifest === undefined) {
    throw new TypeError(
      "Revised workflow fixture lacks an exact build handoff.",
    );
  }
  const applicationBuildRequests = buildRequests.map((buildRequest) => {
    const source = buildRequest.source;
    if (source.kind !== "generated") {
      throw new TypeError(
        "Revised workflow fixture requires generated build sources.",
      );
    }
    const previousEnvelope =
      source.applicationGeneration.artifact.buildContracts.find(
        ({ contractDigest }) => contractDigest === source.buildContractDigest,
      );
    const envelope = generation.artifact.buildContracts.find(
      ({ contract }) =>
        contract.workloadId === previousEnvelope?.contract.workloadId,
    );
    if (envelope === undefined) {
      throw new TypeError(
        "Revised workflow fixture lost a workload build contract.",
      );
    }
    return {
      ...buildRequest,
      dependencyLock: {
        ...buildRequest.dependencyLock,
        packageManifestChecksum: packageManifest.checksum,
      },
      environment: API_WORKFLOW_ENVIRONMENT,
      solutionRevision,
      solutionRevisionDigest: solutionRevisionReference.digest,
      source: {
        applicationGeneration: generation,
        buildContractDigest: envelope.contractDigest,
        kind: "generated" as const,
      },
    };
  });
  const firstBuildRequest = applicationBuildRequests[0];
  if (firstBuildRequest === undefined) {
    throw new TypeError("Revised workflow fixture lacks a build request.");
  }
  const applicationBuildInput =
    fixture.applicationBuildRequests === undefined
      ? firstBuildRequest
      : solutionExportApplicationBuildBatchInputV1Schema.parse({
          contractVersion: 1,
          kind: "cloudmarkup.application-build-batch-input",
          requests: applicationBuildRequests,
        });
  const bytes = canonicalBytes(applicationBuildInput);
  const applicationBuildInputs = asyncJobObjectReferenceV1Schema.parse({
    ...buildReference,
    digest: solutionExportBytesDigest(bytes),
    sizeBytes: bytes.byteLength,
  });
  objects.set(applicationBuildInputs.objectId, bytes);
  const request = solutionExportWorkflowRequestV1Schema.parse({
    ...fixture.request,
    environment: API_WORKFLOW_ENVIRONMENT,
    sources: {
      ...fixture.request.sources,
      applicationBuildInputs,
      solutionRevision: solutionRevisionReference,
    },
    subject: {
      ...fixture.request.subject,
      manifestDigest: solutionRevisionReference.digest,
    },
  });
  return {
    ...fixture,
    applicationBuildRequest: firstBuildRequest,
    ...(fixture.applicationBuildRequests === undefined
      ? {}
      : {
          applicationBuildRequests,
        }),
    generationRequest,
    objects,
    request,
  };
}

const PACKAGE_FIXTURE = bindWorkflowFixtureRevision(
  workflowFixture("infrastructure-only"),
  "infrastructure-only",
);
const COMPLETE_PACKAGE_FIXTURE = bindWorkflowFixtureRevision(
  workflowFixture("complete-supported-pattern"),
  "complete-supported-pattern",
);
const STARTER_PACKAGE_FIXTURE = bindWorkflowFixtureRevision(
  workflowFixture("generated-starter"),
  "starter-application",
);
const USER_PROVIDED_FIXTURE = bindWorkflowFixtureRevision(
  workflowFixture("user-provided"),
  "custom-implementation-required",
);
const EXTERNAL_ARTIFACT_FIXTURE = bindWorkflowFixtureRevision(
  workflowFixture("external-artifact"),
  "custom-implementation-required",
);
const MULTI_EVENT_PACKAGE_FIXTURE = bindWorkflowFixtureRevision(
  multiWorkloadEventWorkflowFixture(),
  "complete-supported-pattern",
);
const SOLUTION_REVISION_ID = PACKAGE_FIXTURE.request.subject.solutionRevisionId;
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} in the integration fixture.`);
  }
  return value;
}

const WORKFLOW_SOURCES: ImmutableSolutionRevisionExportBinding["workflowSources"] =
  PACKAGE_FIXTURE.request.sources;

function coverage(
  state: SolutionGenerationCoverageV1["state"] = "complete-supported-pattern",
): SolutionGenerationCoverageV1 {
  const bound =
    state === "infrastructure-only"
      ? PACKAGE_FIXTURE
      : state === "starter-application"
        ? STARTER_PACKAGE_FIXTURE
        : state === "complete-supported-pattern"
          ? COMPLETE_PACKAGE_FIXTURE
          : state === "custom-implementation-required"
            ? USER_PROVIDED_FIXTURE
            : undefined;
  if (bound === undefined) {
    throw new TypeError(`No immutable workflow fixture covers ${state}.`);
  }
  return solutionGenerationCoverageV1Schema.parse(
    bound.generationRequest.solutionRevision.generationCoverage,
  );
}

function body(exportName = "Notes API") {
  return {
    contractVersion: 1,
    environment: { environmentType: "development" },
    exportName,
    solutionRevisionId: SOLUTION_REVISION_ID,
    targetProfileId: PROFILE,
  } as const;
}

function jsonPost(value: unknown, idempotencyKey: string): RequestInit {
  return {
    body: JSON.stringify(value),
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    method: "POST",
  };
}

function authorized(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit = {},
  token = TOKEN,
) {
  const headers = new Headers(init.headers);
  headers.set("authorization", token);
  return app.request(path, { ...init, headers });
}

function terminalStages(
  failedStage?: SolutionExportJobV1["stages"][number]["stage"],
) {
  return SOLUTION_EXPORT_STAGES_V1.map((stage) => ({
    completedAt: COMPLETE,
    stage,
    startedAt: NOW,
    status:
      failedStage === undefined
        ? ("succeeded" as const)
        : stage === failedStage
          ? ("failed" as const)
          : SOLUTION_EXPORT_STAGES_V1.indexOf(stage) <
              SOLUTION_EXPORT_STAGES_V1.findIndex(
                (candidate) => candidate === failedStage,
              )
            ? ("succeeded" as const)
            : ("skipped" as const),
  }));
}

const PREVIEW_MEDIA_TYPES = new Set([
  "application/json",
  "application/vnd.hashicorp.terraform",
  "application/yaml",
  "image/svg+xml",
  "text/markdown",
  "text/plain",
  "text/typescript",
]);

function projectVerifiedSuccess(
  submission: SolutionExportWorkflowEnqueueV1,
  stored: StoredSolutionExportJob,
  verifiedArtifact: VerifiedSolutionExportArtifactV1,
) {
  const completedAt = new Date(
    Math.max(Date.parse(COMPLETE), Date.parse(stored.job.updatedAt)),
  ).toISOString();
  const retentionExpiresAt =
    Date.parse(completedAt) < Date.parse(RETENTION_EXPIRES)
      ? RETENTION_EXPIRES
      : new Date(Date.parse(completedAt) + 3_600_000).toISOString();
  const validationEvidenceReference = evidenceReference(
    required(
      validationResult(PACKAGE_FIXTURE).evidenceRecords[0],
      "seeded Terraform validation Evidence",
    ),
    submission.request.environment,
  );
  const generatedCoverage =
    stored.job.generationCoverage.state === "starter-application" ||
    stored.job.generationCoverage.state === "complete-supported-pattern";
  const workflowProjection = {
    applicationVerification: undefined,
    diagnostics: stored.job.diagnostics,
    evidence: [
      {
        digest: verifiedArtifact.manifestDigest,
        evidenceId: "evidence.export.main",
        kind: "export-verification" as const,
        stage: "publication" as const,
        status: "passed" as const,
      },
      {
        digest: validationEvidenceReference.record.digest,
        evidenceId: validationEvidenceReference.evidenceId,
        kind: "terraform-validation" as const,
        reference: validationEvidenceReference,
        stage: "terraform-validation" as const,
        status: "passed" as const,
      },
    ],
    generationCoverage: stored.job.generationCoverage,
    stages: terminalStages().map((stage) => ({
      ...stage,
      status:
        !generatedCoverage &&
        (stage.stage === "application-generation" ||
          stage.stage === "application-build")
          ? ("skipped" as const)
          : stage.status,
    })),
    warnings: stored.job.warnings,
  };
  const artifactId = `solutionartifact_${submission.jobId.slice("solutionexport_".length)}`;
  const artifactSuffix = artifactId.slice("solutionartifact_".length);
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
  const zipBytes = verifiedArtifact.zipBytes;
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
      sizeBytes: zipBytes.byteLength,
      solutionRevisionId: submission.request.subject.solutionRevisionId,
      warnings: workflowProjection.warnings,
    }),
    fileContents,
    organizationId: submission.organizationId,
    targetEnvironment: stored.job.target.environment,
    targetProfileId: submission.request.targetProfileId,
    targetSettingsDigest: submission.request.targetSettings.digest,
    verifiedArtifact,
    workflowPackage: asyncJobArtifactReferenceV1Schema.parse({
      artifactId,
      availability: { state: "available" },
      object: {
        contractVersion: 1,
        digest: verifiedArtifact.zipDigest,
        mediaType: "application/zip",
        objectId: `object.${artifactId}`,
        purpose: "export-package",
        sizeBytes: zipBytes.byteLength,
      },
    }),
    zipBytes,
  };
  const completed: StoredSolutionExportJob = {
    ...stored,
    job: {
      ...stored.job,
      applicationVerification: workflowProjection.applicationVerification,
      diagnostics: workflowProjection.diagnostics,
      generationCoverage: workflowProjection.generationCoverage,
      artifact: {
        artifactId,
        digest: verifiedArtifact.zipDigest,
        downloadAvailability: artifact.artifact.downloadAvailability,
        fileCount: files.length,
        manifestDigest: verifiedArtifact.manifestDigest,
        sizeBytes: zipBytes.byteLength,
      },
      completedAt,
      evidence: workflowProjection.evidence,
      pollAfterMilliseconds: undefined,
      progress: {
        completedStages: 8,
        message: "The verified export is ready.",
        totalStages: 8,
      },
      stages: workflowProjection.stages,
      warnings: workflowProjection.warnings,
      state: "succeeded",
      updatedAt: completedAt,
    },
  };
  return { artifact, job: completed, state: "succeeded" as const };
}

async function processWithActualOrchestrator(
  submission: SolutionExportWorkflowEnqueueV1,
  store: InMemorySolutionExportStore,
  invocations: string[],
  actualFixture: ReturnType<typeof workflowFixture> = PACKAGE_FIXTURE,
  actualOptions: {
    readonly cancellationRequested?: () => boolean;
    readonly validationState?: "passed" | "failed" | "cancelled";
  } = {},
) {
  const stored = await store.getJob({
    jobId: submission.jobId,
    organizationId: submission.organizationId,
    projectId: submission.projectId,
  });
  if (stored === null) {
    throw new Error("The queued orchestrator job disappeared.");
  }
  const requestBytes = canonicalBytes(submission.request);
  const requestReference = asyncJobObjectReferenceV1Schema.parse({
    contractVersion: 1,
    digest: solutionExportBytesDigest(requestBytes),
    mediaType: "application/json",
    objectId: `object.solution-export-request.${submission.jobId.slice("solutionexport_".length)}`,
    purpose: "input-payload",
    sizeBytes: requestBytes.byteLength,
  });
  const boundFixture = {
    ...actualFixture,
    request: submission.request,
  };
  const input = {
    contractVersion: 1 as const,
    environment: submission.request.environment,
    family: "solution-export-orchestration" as const,
    request: requestReference,
    subject: submission.request.subject,
    targetProfileId: submission.request.targetProfileId,
    targetSettingsDigest: submission.request.targetSettings.digest,
  };
  const inputBytes = canonicalBytes(input);
  const record = asyncJobRecordV1Schema.parse({
    ...actualFixture.record,
    correlationId: `correlation.${submission.jobId}`,
    idempotency: {
      actorId: submission.createdByPrincipalId,
      keyDigest: DIGEST,
      operationId: "solution-export-jobs.create",
      requestDigest: submission.requestDigest,
    },
    input,
    inputDigest: solutionExportBytesDigest(inputBytes),
    inputSizeBytes: inputBytes.byteLength,
    jobId: submission.jobId,
    orchestration: {
      dependencyJobIds: [],
      expectedChildJobIds: [],
      failurePolicy: "fail-parent",
      rootJobId: submission.jobId,
    },
    ownership: {
      organizationId: submission.organizationId,
      projectId: submission.projectId,
    },
  });
  const objects = new Map(actualFixture.objects);
  objects.set(requestReference.objectId, requestBytes);
  const persistedEvidence: ReturnType<typeof evidenceReference>[] = [];
  let verifiedArtifact: VerifiedSolutionExportArtifactV1 | undefined;
  const dependencies: SolutionExportWorkflowDependencies = {
    applicationBuilder: {
      async build(buildInput) {
        await Promise.resolve();
        invocations.push("application-builder");
        const buildRequests = boundFixture.applicationBuildRequests;
        if (buildRequests === undefined) {
          return passingBuildResult(boundFixture, buildInput.generation);
        }
        const projection = {
          contractVersion: 1 as const,
          kind: "cloudmarkup.application-build-batch-result" as const,
          results: buildRequests.map((request) =>
            passingBuildResult(boundFixture, buildInput.generation, request),
          ),
        };
        return solutionExportApplicationBuildBatchResultV1Schema.parse({
          ...projection,
          reportDigest: sha256Digest(serializeCanonicalJson(projection)),
        });
      },
    },
    applicationGenerator: {
      async generate(generatorInput) {
        await Promise.resolve();
        invocations.push("application-generator");
        return createSolutionExportApplicationGeneratorPort().generate(
          generatorInput,
        );
      },
    },
    cancellation: createTimerSolutionExportWorkflowCancellationPollPort(1),
    clock: { now: () => new Date(NOW) },
    compiler: {
      async compile() {
        await Promise.resolve();
        invocations.push("compiler");
        return actualFixture.compilation;
      },
    },
    diagramRenderer: {
      async render(rendererInput) {
        invocations.push("diagram-renderer");
        const architectureDocument = architectureDocumentV3Schema.parse(
          rendererInput.sources.architectureDocument,
        );
        const renderer =
          architectureDocument.catalog.digest === AWS_CATALOG_DIGEST_V1
            ? API_EVENT_DIAGRAM_RENDERER
            : API_DIAGRAM_RENDERER;
        return renderer.render(rendererInput);
      },
    },
    diff: {
      async compare(diffInput) {
        await Promise.resolve();
        invocations.push("diff");
        return {
          contractVersion: 1,
          currentDigest: diffInput.current.zipDigest,
          entries: [],
          state: "no-baseline",
        };
      },
    },
    objects: {
      async load(loadInput) {
        await Promise.resolve();
        const value = objects.get(loadInput.reference.objectId);
        if (value === undefined) {
          throw new Error(
            `Missing actual orchestrator object ${loadInput.reference.objectId}.`,
          );
        }
        return value;
      },
      async persistStageReport(reportInput) {
        await Promise.resolve();
        invocations.push(`persist:${reportInput.stage}`);
        const reportBytes = canonicalBytes(reportInput.report);
        const evidenceRecords = reportInput.evidenceRecords.map((record) =>
          evidenceReference(record, submission.request.environment),
        );
        persistedEvidence.push(...evidenceRecords);
        return {
          artifact: {
            artifactId: `artifact.report.${reportInput.stage}`,
            digest: reportInput.digest,
            kind:
              reportInput.stage === "build-application"
                ? "application-build-report"
                : "terraform-validation-report",
            mediaType: "application/json",
            object: {
              contractVersion: 1,
              digest: reportInput.digest,
              mediaType: "application/json",
              objectId: `object.report.${reportInput.stage}`,
              purpose:
                reportInput.stage === "build-application"
                  ? "build-output"
                  : "validation-report",
              sizeBytes: reportBytes.byteLength,
            },
            sizeBytes: reportBytes.byteLength,
          },
          evidenceRecords,
          stage: reportInput.stage,
        };
      },
      async persistVerifiedOutput(outputInput) {
        await Promise.resolve();
        invocations.push("persist-output");
        verifiedArtifact = outputInput.artifact;
        const artifactId = `solutionartifact_${submission.jobId.slice("solutionexport_".length)}`;
        const object = {
          contractVersion: 1 as const,
          digest: outputInput.artifact.zipDigest,
          mediaType: "application/zip",
          objectId: `object.${artifactId}`,
          purpose: "export-package" as const,
          sizeBytes: outputInput.artifact.zipBytes.byteLength,
        };
        return {
          artifact: {
            archiveFileName: outputInput.artifact.archiveFileName,
            artifactId,
            digest: outputInput.artifact.zipDigest,
            kind: "export-package",
            manifestDigest: outputInput.artifact.manifestDigest,
            mediaType: object.mediaType,
            object,
            sizeBytes: object.sizeBytes,
          },
          contractVersion: 1,
          diff: outputInput.diff,
          evidenceRecords: persistedEvidence,
          verifiedPackage: {
            artifactId,
            availability: { state: "available" },
            object,
          },
        };
      },
      async saveCheckpoint(checkpointInput) {
        await Promise.resolve();
        const bytes = canonicalBytes(checkpointInput.checkpoint);
        return asyncJobObjectReferenceV1Schema.parse({
          contractVersion: 1,
          digest: solutionExportBytesDigest(bytes),
          mediaType: "application/json",
          objectId: `object.checkpoint.${submission.jobId.slice("solutionexport_".length)}`,
          purpose: "checkpoint-state",
          sizeBytes: bytes.byteLength,
        });
      },
      async saveReadModel() {
        await Promise.resolve();
        invocations.push("save-read-model");
      },
    },
    packager: {
      async package(packageInput) {
        await Promise.resolve();
        invocations.push("packager");
        return localSolutionExportService.generate(
          solutionExportRequestV1Schema.parse({
            architectureDocument: packageInput.sources.architectureDocument,
            ...(packageInput.application === undefined
              ? {}
              : { application: packageInput.application }),
            diagram: diagramExportForSolutionExport(packageInput.diagram),
            contractVersion: 1,
            existingFiles: [],
            externalStageStatus: packageInput.externalStageStatus,
            infrastructure: packageInput.infrastructure,
            solutionRevision: packageInput.sources.solutionRevision,
            supplementalFiles: packageInput.supplementalFiles,
            target: {
              exportName: packageInput.request.exportName,
              limits: packageInput.request.targetSettings.limits,
              policyPacks: packageInput.request.targetSettings.policyPacks,
              renderer: packageInput.request.targetSettings.renderer,
              target: packageInput.request.targetSettings.target,
            },
          }),
        );
      },
    },
    terraformValidator: {
      async validate() {
        await Promise.resolve();
        invocations.push("terraform-validator");
        return validationResult(boundFixture, actualOptions.validationState);
      },
    },
  };
  const context = {
    attemptNumber: 1,
    checkpoint: undefined,
    correlationId: record.correlationId,
    jobId: record.jobId,
    ownership: record.ownership,
    async heartbeat() {
      await Promise.resolve();
    },
    async isCancellationRequested() {
      await Promise.resolve();
      return actualOptions.cancellationRequested?.() ?? false;
    },
    async reportProgress() {
      await Promise.resolve();
    },
    async saveCheckpoint(checkpoint: AsyncJobCheckpointV1) {
      await Promise.resolve();
      void checkpoint;
    },
  };
  const result = await createSolutionExportWorkflowOrchestrator(
    dependencies,
  ).run(record, context);
  const publication = projectInjectedSolutionExportResult({
    material: {
      completedAt: COMPLETE,
      retentionExpiresAt: RETENTION_EXPIRES,
      stored,
      ...(verifiedArtifact === undefined ? {} : { verifiedArtifact }),
    },
    result,
    submission,
  });
  return publication.state === "succeeded"
    ? publication
    : { job: publication.job, state: "failed" as const };
}

type FailureStage =
  | "compilation"
  | "application-generation"
  | "application-build"
  | "terraform-validation";

const FAILURE_DETAILS = {
  "application-build": {
    code: "APPLICATION_TEST_FAILED",
    evidenceKind: "application-test",
  },
  "application-generation": {
    code: "APPLICATION_GENERATION_FAILED",
    evidenceKind: "application-generation",
  },
  compilation: {
    code: "IAC_COMPILATION_FAILED",
    evidenceKind: "infrastructure-compilation",
  },
  "terraform-validation": {
    code: "TERRAFORM_VALIDATE_FAILED",
    evidenceKind: "terraform-validation",
  },
} as const satisfies Readonly<
  Record<
    FailureStage,
    {
      readonly code: string;
      readonly evidenceKind: SolutionExportJobV1["evidence"][number]["kind"];
    }
  >
>;

function fixture(
  options: {
    readonly applicationCodeRequired?: boolean;
    readonly entitlementEnabled?: boolean;
    readonly failProcessorOnce?: boolean;
    readonly includeRevision?: boolean;
    readonly failureStage?: FailureStage;
    readonly generationCoverage?: SolutionGenerationCoverageV1;
    readonly publicationMutation?: (
      artifact: StoredSolutionExportArtifact,
    ) => StoredSolutionExportArtifact;
    readonly processor?: (
      submission: SolutionExportWorkflowEnqueueV1,
      store: InMemorySolutionExportStore,
      isCancellationRequested: () => boolean,
    ) => ReturnType<InMemorySolutionExportProcessor>;
    readonly revision?: ImmutableSolutionRevisionExportBinding;
    readonly targetSettings?: SolutionExportWorkflowEnqueueV1["request"]["targetSettings"];
  } = {},
) {
  let now = new Date(NOW);
  let processorAttempts = 0;
  const store = new InMemorySolutionExportStore({
    entitlements: [
      {
        decisionReference: "entitlement.export.main.v1",
        enabled: options.entitlementEnabled ?? true,
        organizationId: "org_main",
        targetProfileId: PROFILE,
        targetSettings: options.targetSettings ?? TEST_TARGET_SETTINGS,
      },
    ],
    memberships: [
      {
        organizationId: "org_main",
        principalId: "principal_owner",
        role: "owner",
        status: "active",
      },
      {
        organizationId: "org_main",
        principalId: "principal_viewer",
        role: "viewer",
        status: "active",
      },
      {
        organizationId: "org_other",
        principalId: "principal_other",
        role: "owner",
        status: "active",
      },
    ],
    principals: ["principal_owner", "principal_viewer", "principal_other"],
    projects: [
      { organizationId: "org_main", projectId: "project_main" },
      { organizationId: "org_other", projectId: "project_other" },
    ],
    revisions:
      options.includeRevision === false
        ? []
        : [
            options.revision ?? {
              applicationCodeRequired: options.applicationCodeRequired ?? true,
              generationCoverage:
                options.generationCoverage ?? coverage("infrastructure-only"),
              manifestDigest: PACKAGE_FIXTURE.request.subject.manifestDigest,
              manifestRecordId:
                PACKAGE_FIXTURE.request.subject.manifestRecordId,
              organizationId: "org_main",
              projectId: "project_main",
              solutionRevisionId: SOLUTION_REVISION_ID,
              workflowSources: WORKFLOW_SOURCES,
            },
          ],
  });

  const processor: InMemorySolutionExportProcessor = async (submission) => {
    processorAttempts += 1;
    if (options.failProcessorOnce === true && processorAttempts === 1) {
      throw new Error("Injected solution export processor failure.");
    }
    if (options.processor !== undefined) {
      return options.processor(submission, store, () =>
        workflow.isCancellationRequested(submission.jobId),
      );
    }
    const request = submission.request;
    const stored = await store.getJob({
      jobId: submission.jobId,
      organizationId: submission.organizationId,
      projectId: submission.projectId,
    });
    if (stored === null) {
      throw new Error("The queued job disappeared.");
    }
    if (options.failureStage !== undefined) {
      const failure = FAILURE_DETAILS[options.failureStage];
      const failed: StoredSolutionExportJob = {
        ...stored,
        job: {
          ...stored.job,
          completedAt: COMPLETE,
          diagnostics: [
            {
              code: failure.code,
              message: "A deterministic validation stage failed.",
              severity: "error",
              stage: options.failureStage,
            },
          ],
          evidence: [
            {
              digest: DIGEST,
              evidenceId: "evidence.failure.main",
              kind: failure.evidenceKind,
              stage: options.failureStage,
              status: "failed",
            },
          ],
          pollAfterMilliseconds: undefined,
          progress: {
            completedStages:
              SOLUTION_EXPORT_STAGES_V1.indexOf(options.failureStage) + 1,
            message: "The export failed validation and was not packaged.",
            totalStages: 8,
          },
          stages: terminalStages(options.failureStage),
          state: "failed",
          updatedAt: COMPLETE,
        },
      };
      return { job: failed, state: "failed" as const };
    }

    const packaged = localSolutionExportService.generate(
      solutionExportRequestV1Schema.parse({
        architectureDocument:
          PACKAGE_FIXTURE.generationRequest.architectureDocument,
        contractVersion: 1,
        existingFiles: [],
        infrastructure:
          projectGoCompilationResultToSolutionExportInfrastructure(
            PACKAGE_FIXTURE.compilation,
          ),
        solutionRevision: PACKAGE_FIXTURE.generationRequest.solutionRevision,
        supplementalFiles: [],
        target: {
          exportName: request.exportName,
          limits: request.targetSettings.limits,
          policyPacks: request.targetSettings.policyPacks,
          renderer: request.targetSettings.renderer,
          target: request.targetSettings.target,
        },
      }),
    );
    if (packaged.state !== "ready") {
      throw new Error(
        `The strict package fixture was blocked: ${JSON.stringify(packaged.diagnostics)}`,
      );
    }
    const verified = projectVerifiedSuccess(
      submission,
      stored,
      packaged.artifact,
    );
    return options.publicationMutation === undefined
      ? verified
      : {
          ...verified,
          artifact: options.publicationMutation(verified.artifact),
        };
  };

  const workflow: InMemorySolutionExportWorkflow =
    new InMemorySolutionExportWorkflow({
      processor,
      results: store,
    });
  const solutionExports = new DefaultSolutionExportApplication({
    access: store,
    clock: () => new Date(now),
    repository: store,
    revisions: store,
    targetPolicy: store,
    workflow,
  });
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(NOW),
    correlationIdFactory: () => "correlation-export-test",
    principalResolver: new FixedPrincipalResolver({
      [OTHER_TOKEN]: {
        authenticatedAt: NOW,
        expiresAt: RETENTION_EXPIRES,
        principalId: "principal_other",
        sessionId: "session_other",
      },
      [TOKEN]: {
        authenticatedAt: NOW,
        expiresAt: RETENTION_EXPIRES,
        principalId: "principal_owner",
        sessionId: "session_owner",
      },
      [VIEWER_TOKEN]: {
        authenticatedAt: NOW,
        expiresAt: RETENTION_EXPIRES,
        principalId: "principal_viewer",
        sessionId: "session_viewer",
      },
    }),
    solutionExports,
  });
  return {
    app,
    expireArtifact: () => {
      now = new Date(RETENTION_EXPIRES);
    },
    workflow,
    store,
  };
}

function boundValidationResultForComposition(
  request: ReturnType<typeof terraformValidationRequestFromWorkflowInput>,
  settings: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"],
) {
  const reportBytes = canonicalBytes({
    commandSummaries: [],
    diagnostics: [],
  });
  const reportDigest = sha256Digest(reportBytes);
  const common = {
    contractVersion: 1 as const,
    environment: request.environment,
    layer: "generated" as const,
    level: {
      kind: "deterministic-target-compilation" as const,
      rank: 3 as const,
    },
    models: [],
    solutionRevisionId: request.solutionRevisionId,
    staleness: { assessedAt: request.assessedAt, state: "current" as const },
  };
  const compilation = evidenceRecordV1Schema.parse({
    ...common,
    artifacts: [
      {
        digest: request.artifactDigest,
        mediaType: "application/vnd.cloudmarkup.terraform-artifact+json",
        sizeBytes: request.files.reduce(
          (sum, file) =>
            sum + new TextEncoder().encode(file.content).byteLength,
          0,
        ),
      },
    ],
    checks: [
      {
        artifactDigests: [request.artifactDigest],
        checkId:
          "cloudmarkup.evidence.deterministic-infrastructure-compilation",
        generationCoverageRequirement:
          "deterministic-infrastructure-compilation",
        issueIds: [],
        status: "passed",
        summary:
          "The exact Terraform artifact is bound to the approved deterministic compiler output.",
      },
    ],
    id: `evidence_iac_compilation_${request.artifactDigest.slice(7, 31)}`,
    provenance: {
      actor: { kind: "deterministic-tool", tool: request.compiler },
      createdAt: request.assessedAt,
      inputDigests: [request.solutionRevisionDigest, request.artifactDigest],
    },
    tools: [request.compiler],
  });
  const staticValidation = evidenceRecordV1Schema.parse({
    ...common,
    artifacts: [
      {
        digest: reportDigest,
        mediaType: "application/json",
        sizeBytes: reportBytes.byteLength,
      },
    ],
    checks: [
      {
        artifactDigests: [request.artifactDigest, reportDigest],
        checkId: "cloudmarkup.evidence.terraform-static-validation",
        issueIds: [],
        status: "passed",
        summary:
          "Offline Terraform formatting, initialization, validation, and approved policy checks passed.",
      },
    ],
    id: `evidence_terraform_static_${reportDigest.slice(7, 31)}`,
    provenance: {
      actor: { kind: "deterministic-tool", tool: settings.adapter },
      createdAt: request.assessedAt,
      inputDigests: [
        request.solutionRevisionDigest,
        request.artifactDigest,
        sha256Digest(serializeCanonicalJson(request)),
        settings.policyDigest,
      ].sort(),
    },
    tools: [settings.adapter],
  });
  return {
    commandSummaries: [],
    contractVersion: 1 as const,
    diagnostics: [],
    evidenceRecords: [compilation, staticValidation],
    reportDigest,
    state: "passed" as const,
  };
}

const CUSTOMER_CI_PROVIDER_LOCK = `provider "registry.terraform.io/hashicorp/aws" {
  version     = "6.55.0"
  constraints = ">= 6.55.0, < 7.0.0"
  hashes      = ["h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]
}
`;

function customerCiCompilation(
  fixture: typeof COMPLETE_PACKAGE_FIXTURE,
): typeof COMPLETE_PACKAGE_FIXTURE.compilation {
  const artifact = required(
    fixture.compilation.artifact,
    "customer CI compiler artifact",
  );
  const terraformFile = (
    path: string,
    content: string,
  ): NonNullable<typeof artifact.files>[number] => ({
    content,
    digest: sha256Digest(content),
    mediaType: "application/vnd.hashicorp.terraform",
    ownership: "generated",
    path: repositoryRelativePathSchema.parse(path),
  });
  const provisional = {
    ...artifact,
    files: [
      ...(artifact.files ?? []),
      terraformFile(
        "infrastructure/backend.hcl",
        CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
      ),
      terraformFile(
        "infrastructure/.terraform.lock.hcl",
        CUSTOMER_CI_PROVIDER_LOCK,
      ),
    ],
  };
  return goCompilationResultV1Schema.parse({
    ...fixture.compilation,
    artifact: {
      ...provisional,
      digest: goTargetArtifactDigest(provisional),
    },
  });
}

function customerCiConfiguration(
  fixture: typeof COMPLETE_PACKAGE_FIXTURE,
  compilation: typeof COMPLETE_PACKAGE_FIXTURE.compilation,
) {
  const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
  const infrastructure =
    projectGoCompilationResultToSolutionExportInfrastructure(compilation);
  const packageFiles = infrastructure.files
    .map(({ checksum, path }) => ({ checksum, path }))
    .filter(({ path }) => path.startsWith("infrastructure/"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  config.solutionRevision = {
    digest: fixture.request.subject.manifestDigest,
    id: fixture.request.subject.solutionRevisionId,
  };
  config.terraform = {
    ...config.terraform,
    backend: {
      ...config.terraform.backend,
      configPath: "solutions/notes/infrastructure/backend.hcl",
    },
    packageTreeDigest: sha256Digest(serializeCanonicalJson(packageFiles)),
    providerLockPath: "solutions/notes/infrastructure/.terraform.lock.hcl",
    rootDirectory: "solutions/notes/infrastructure",
  };
  return config;
}

function repositoryWorkflowReview(
  decision: "approved" | "denied",
  fixture: typeof COMPLETE_PACKAGE_FIXTURE,
  compilation: typeof COMPLETE_PACKAGE_FIXTURE.compilation,
) {
  const shared = {
    contractVersion: 1 as const,
    kind: "cloudmarkup.solution-export-repository-workflow-review" as const,
    solutionRevision: {
      digest: fixture.request.subject.manifestDigest,
      id: fixture.request.subject.solutionRevisionId,
    },
  };
  if (decision === "denied") {
    return { ...shared, decision, reason: "review-rejected" as const };
  }
  const configuration = customerCiConfiguration(fixture, compilation);
  return {
    ...shared,
    configuration,
    configurationDigest: sha256Digest(serializeCanonicalJson(configuration)),
    decision,
  };
}

function injectedLocalCompositionFixture(
  options: {
    readonly cancelDuringPersistence?: boolean;
    readonly corruptProjectionMaterial?: boolean;
    readonly corruptPreparedInputSize?: boolean;
    readonly pauseCompiler?: boolean;
    readonly repositoryWorkflowReview?:
      "approved" | "approved-cross-revision" | "denied";
    readonly transientCompilerOnce?: boolean;
    readonly transientAdapterOnce?:
      | "persist-stage-report"
      | "persist-output"
      | "save-read-model"
      | "progress";
  } = {},
) {
  const actualFixture = COMPLETE_PACKAGE_FIXTURE;
  const compilation =
    options.repositoryWorkflowReview?.startsWith("approved") === true
      ? customerCiCompilation(actualFixture)
      : actualFixture.compilation;
  const exactReview =
    options.repositoryWorkflowReview === undefined
      ? undefined
      : repositoryWorkflowReview(
          options.repositoryWorkflowReview === "denied" ? "denied" : "approved",
          actualFixture,
          compilation,
        );
  const review =
    options.repositoryWorkflowReview === "approved-cross-revision" &&
    exactReview !== undefined
      ? {
          ...exactReview,
          solutionRevision: {
            ...exactReview.solutionRevision,
            digest: sha256Digest("different-solution-revision"),
          },
        }
      : exactReview;
  const reviewBytes = review === undefined ? undefined : canonicalBytes(review);
  const reviewReference =
    reviewBytes === undefined
      ? undefined
      : solutionExportWorkflowSourceInputsV1Schema.shape.repositoryWorkflowReview
          .unwrap()
          .parse({
            contractVersion: 1,
            digest: sha256Digest(reviewBytes),
            mediaType: "application/json",
            objectId: "object.repository-workflow-review.1",
            purpose: "input-payload",
            sizeBytes: reviewBytes.byteLength,
          });
  const workflowSources = {
    ...actualFixture.request.sources,
    ...(reviewReference === undefined
      ? {}
      : { repositoryWorkflowReview: reviewReference }),
  };
  const seeded = fixture({
    revision: {
      applicationCodeRequired: false,
      generationCoverage: coverage("complete-supported-pattern"),
      manifestDigest: actualFixture.request.subject.manifestDigest,
      manifestRecordId: actualFixture.request.subject.manifestRecordId,
      organizationId: "org_main",
      projectId: "project_main",
      solutionRevisionId: actualFixture.request.subject.solutionRevisionId,
      workflowSources,
    },
  });
  const store = seeded.store;
  const objects = new Map(actualFixture.objects);
  if (reviewBytes !== undefined && reviewReference !== undefined) {
    objects.set(reviewReference.objectId, reviewBytes);
  }
  const invocations: string[] = [];
  const persistedEvidence: ReturnType<typeof evidenceReference>[] = [];
  let activeSubmission: SolutionExportWorkflowEnqueueV1 | undefined;
  let attemptNumber = 0;
  let compilerAttempt = 0;
  let verifiedArtifact: VerifiedSolutionExportArtifactV1 | undefined;
  let stagedArtifact = false;
  let transientAdapterFailed = false;
  let releaseCompiler = (): void => undefined;
  let signalCompilerStarted = (): void => undefined;
  const compilerStarted = new Promise<void>((resolve) => {
    signalCompilerStarted = resolve;
  });
  const compilerGate = options.pauseCompiler
    ? new Promise<void>((resolve) => {
        releaseCompiler = resolve;
      })
    : Promise.resolve();
  const failTransientAdapterOnce = (
    boundary: NonNullable<typeof options.transientAdapterOnce>,
  ) => {
    if (options.transientAdapterOnce === boundary && !transientAdapterFailed) {
      transientAdapterFailed = true;
      throw new Error(`Injected transient ${boundary} outage.`);
    }
  };

  const compiler = createGoCliSolutionExportCompilerPort({
    executor: {
      async execute() {
        compilerAttempt += 1;
        invocations.push("compiler-command-executor");
        signalCompilerStarted();
        await compilerGate;
        if (options.transientCompilerOnce === true && compilerAttempt === 1) {
          return {
            exitCode: null,
            stderr: "",
            stdout: "",
            termination: "unavailable" as const,
          };
        }
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify(compilation),
          termination: "completed" as const,
        };
      },
    },
  });
  const applicationBuilder = createSolutionExportApplicationBuildPort({
    approvedSettings:
      actualFixture.request.targetSettings.stageDescriptors.applicationBuild,
    runner: {
      run() {
        invocations.push("application-build-runner");
        const request = required(
          actualFixture.applicationBuildRequest,
          "complete fixture application build request",
        );
        if (request.source.kind !== "generated") {
          throw new Error(
            "The complete composition fixture requires generated source.",
          );
        }
        return Promise.resolve(
          passingBuildResult(
            actualFixture,
            request.source.applicationGeneration,
          ),
        );
      },
    },
  });
  const stageDescriptors =
    actualFixture.request.targetSettings.stageDescriptors;
  if (!("terraformValidation" in stageDescriptors)) {
    throw new TypeError("API Terraform fixture requires validation settings.");
  }
  const terraformValidationSettings = stageDescriptors.terraformValidation;
  const terraformValidator = createSolutionExportTerraformValidationPort({
    approvedSettings: terraformValidationSettings,
    runner: {
      run(input) {
        invocations.push("terraform-validation-runner");
        return Promise.resolve(
          boundValidationResultForComposition(
            input as ReturnType<
              typeof terraformValidationRequestFromWorkflowInput
            >,
            terraformValidationSettings,
          ),
        );
      },
    },
  });

  const workflow = {
    applicationBuilder,
    cancellation: createTimerSolutionExportWorkflowCancellationPollPort(1),
    clock: { now: () => new Date(NOW) },
    compiler,
    diff: {
      compare(
        input: Parameters<
          SolutionExportWorkflowDependencies["diff"]["compare"]
        >[0],
      ) {
        invocations.push("diff-adapter");
        return Promise.resolve(
          input.previous === undefined
            ? {
                contractVersion: 1 as const,
                currentDigest: input.current.zipDigest,
                entries: [],
                state: "no-baseline" as const,
              }
            : {
                baselineDigest: input.previous.object.digest,
                contractVersion: 1 as const,
                currentDigest: input.current.zipDigest,
                entries: [],
                state: "compared" as const,
              },
        );
      },
    },
    objects: {
      load(
        input: Parameters<
          SolutionExportWorkflowDependencies["objects"]["load"]
        >[0],
      ) {
        const value = objects.get(input.reference.objectId);
        if (value === undefined) {
          throw new Error(
            `Missing injected composition object ${input.reference.objectId}.`,
          );
        }
        return Promise.resolve(value);
      },
      persistStageReport(
        input: Parameters<
          SolutionExportWorkflowDependencies["objects"]["persistStageReport"]
        >[0],
      ) {
        failTransientAdapterOnce("persist-stage-report");
        invocations.push(`persist:${input.stage}`);
        const reportBytes = canonicalBytes(input.report);
        const evidenceRecords = input.evidenceRecords.map((record) =>
          evidenceReference(record, API_WORKFLOW_ENVIRONMENT),
        );
        persistedEvidence.push(...evidenceRecords);
        return Promise.resolve({
          artifact: {
            artifactId: `artifact.report.${input.stage}`,
            digest: input.digest,
            kind:
              input.stage === "build-application"
                ? "application-build-report"
                : "terraform-validation-report",
            mediaType: "application/json",
            object: {
              contractVersion: 1,
              digest: input.digest,
              mediaType: "application/json",
              objectId: `object.report.${input.stage}`,
              purpose:
                input.stage === "build-application"
                  ? "build-output"
                  : "validation-report",
              sizeBytes: reportBytes.byteLength,
            },
            sizeBytes: reportBytes.byteLength,
          },
          evidenceRecords,
          stage: input.stage,
        });
      },
      async persistVerifiedOutput(
        input: Parameters<
          SolutionExportWorkflowDependencies["objects"]["persistVerifiedOutput"]
        >[0],
      ) {
        failTransientAdapterOnce("persist-output");
        const submission = required(
          activeSubmission,
          "active workflow submission",
        );
        invocations.push("persist-output");
        stagedArtifact = true;
        verifiedArtifact = input.artifact;
        const artifactId = `solutionartifact_${submission.jobId.slice("solutionexport_".length)}`;
        const object = {
          contractVersion: 1 as const,
          digest: input.artifact.zipDigest,
          mediaType: "application/zip",
          objectId: `object.${artifactId}`,
          purpose: "export-package" as const,
          sizeBytes: input.artifact.zipBytes.byteLength,
        };
        if (options.cancelDuringPersistence === true) {
          const runningApp = required(app, "injected local API");
          const cancellation = await authorized(
            runningApp,
            `/v1/projects/project_main/solution-export-jobs/${submission.jobId}/cancel`,
            jsonPost({ contractVersion: 1 }, "injected-late-cancellation"),
          );
          if (cancellation.status !== 200) {
            throw new Error("The injected late cancellation was not accepted.");
          }
        }
        return {
          artifact: {
            archiveFileName: input.artifact.archiveFileName,
            artifactId,
            digest: input.artifact.zipDigest,
            kind: "export-package",
            manifestDigest: input.artifact.manifestDigest,
            mediaType: object.mediaType,
            object,
            sizeBytes: object.sizeBytes,
          },
          contractVersion: 1,
          diff: input.diff,
          evidenceRecords: persistedEvidence,
          verifiedPackage: {
            artifactId,
            availability: { state: "available" },
            object,
          },
        };
      },
      saveCheckpoint(
        input: Parameters<
          SolutionExportWorkflowDependencies["objects"]["saveCheckpoint"]
        >[0],
      ) {
        const submission = required(
          activeSubmission,
          "active workflow submission",
        );
        const bytes = canonicalBytes(input.checkpoint);
        return Promise.resolve(
          asyncJobObjectReferenceV1Schema.parse({
            contractVersion: 1,
            digest: solutionExportBytesDigest(bytes),
            mediaType: "application/json",
            objectId: `object.checkpoint.${submission.jobId}`,
            purpose: "checkpoint-state",
            sizeBytes: bytes.byteLength,
          }),
        );
      },
      saveReadModel() {
        failTransientAdapterOnce("save-read-model");
        invocations.push("save-read-model");
        return Promise.resolve();
      },
    },
    diagramRenderer: API_DIAGRAM_RENDERER,
    terraformValidator,
  } satisfies Omit<
    SolutionExportWorkflowDependencies,
    "applicationGenerator" | "packager"
  >;

  const composition = createInjectedLocalSolutionExportComposition({
    access: store,
    clock: () => new Date(NOW),
    execution: {
      async loadProjectionMaterial() {
        const submission = required(
          activeSubmission,
          "active workflow submission",
        );
        const stored = await store.getJob({
          jobId: submission.jobId,
          organizationId: submission.organizationId,
          projectId: submission.projectId,
        });
        if (stored === null) {
          throw new Error("The injected composition job disappeared.");
        }
        return {
          completedAt: COMPLETE,
          retentionExpiresAt: RETENTION_EXPIRES,
          stored:
            options.corruptProjectionMaterial === true
              ? {
                  ...stored,
                  primaryInputDigest: sha256Digest("substituted projection"),
                }
              : stored,
          ...(verifiedArtifact === undefined ? {} : { verifiedArtifact }),
        };
      },
      prepare({ submission }) {
        activeSubmission = submission;
        persistedEvidence.length = 0;
        verifiedArtifact = undefined;
        stagedArtifact = false;
        attemptNumber += 1;
        const binding = createSolutionExportRunInsertionBindingV1(submission);
        const requestBytes = canonicalBytes(submission.request);
        objects.set(binding.workflowRequestObjectId, requestBytes);
        const record = asyncJobRecordV1Schema.parse({
          ...actualFixture.record,
          correlationId: `correlation.${submission.jobId}`,
          idempotency: {
            actorId: submission.createdByPrincipalId,
            keyDigest: DIGEST,
            operationId: "solution-export-jobs.create",
            requestDigest: submission.requestDigest,
          },
          input: binding.orchestrationInput,
          inputDigest: binding.orchestrationInputSha256,
          inputSizeBytes: canonicalBytes(binding.orchestrationInput).byteLength,
          jobId: submission.jobId,
          orchestration: {
            dependencyJobIds: [],
            expectedChildJobIds: [],
            failurePolicy: "fail-parent",
            rootJobId: submission.jobId,
          },
          ownership: {
            organizationId: submission.organizationId,
            projectId: submission.projectId,
          },
        });
        return Promise.resolve({
          context: {
            attemptNumber,
            checkpoint: undefined,
            correlationId: record.correlationId,
            heartbeat: () => Promise.resolve(),
            isCancellationRequested: () => Promise.resolve(false),
            jobId: record.jobId,
            ownership: record.ownership,
            reportProgress() {
              failTransientAdapterOnce("progress");
              return Promise.resolve();
            },
            saveCheckpoint: () => Promise.resolve(),
          },
          record:
            options.corruptPreparedInputSize === true
              ? { ...record, inputSizeBytes: record.inputSizeBytes + 1 }
              : record,
        });
      },
    },
    repository: store,
    results: store,
    revisions: store,
    targetPolicy: store,
    workflow,
  });
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(NOW),
    correlationIdFactory: () => "correlation-injected-composition-test",
    principalResolver: new FixedPrincipalResolver({
      [TOKEN]: {
        authenticatedAt: NOW,
        expiresAt: RETENTION_EXPIRES,
        principalId: "principal_owner",
        sessionId: "session_owner",
      },
    }),
    solutionExports: composition.application,
  });
  return {
    app,
    compilerStarted,
    composition,
    invocations,
    releaseCompiler,
    stagedArtifact: () => stagedArtifact,
    store,
  };
}

async function previewAndExportReviewedCustomerCi(
  artifactId: string,
  artifact: VerifiedSolutionExportArtifactV1,
) {
  const github = new FakeGitHubAppAdapter();
  const callbackVerifier = new FakeGitHubInstallationLinkCallbackVerifier();
  github.addInstallation({
    accountId: 1_234_567,
    accountLogin: "customer-organization",
    accountType: "Organization",
    installationId: 77,
    permissions: {
      contents: "write",
      metadata: "read",
      pullRequests: "write",
      workflows: "write",
    },
    repositorySelection: "selected",
    suspended: false,
  });
  github.addRepository(
    {
      archived: false,
      defaultBranch: "main",
      disabled: false,
      installationId: 77,
      name: "customer-repository",
      nodeId: "repository-node-reviewed-ci",
      owner: "customer-organization",
      ownerId: 1_234_567,
      private: true,
      pushedAt: COMPLETE,
      repositoryId: 987_654_321,
    },
    { main: {} },
    ["main"],
  );
  const artifacts = new InMemoryApprovedSolutionPackageRepository();
  artifacts.add({
    artifact,
    artifactId,
    organizationId: "org_main",
    projectId: "project_main",
  });
  let sequence = 0;
  const service = new GitHubRepositoryExportService({
    artifactRepository: artifacts,
    audit: new RecordingGitHubExportAuditSink(),
    clock: () => new Date(COMPLETE),
    github,
    idFactory: (kind) => {
      const prefix =
        kind === "integration"
          ? "integration"
          : kind === "preview"
            ? "githubpreview"
            : "githubexport";
      return `${prefix}_reviewed-${String(++sequence)}`;
    },
    installationLinkCallbackVerifier: callbackVerifier,
    installationSetupUrl:
      "https://github.com/apps/cloudmarkup-test/installations/new",
    linkIntentIdFactory: () => "githublink_reviewed_customer_ci",
    linkStateFactory: () => `${"s".repeat(42)}1`,
    progress: new RecordingGitHubExportProgressSink(),
    store: new InMemoryGitHubExportStore(),
  });
  const intent = await service.createInstallationLinkIntent({
    correlationId: "correlation.reviewed-ci-link",
    organizationId: "org_main",
    principalId: "principal_owner",
  });
  const callbackReceipt = "callback.reviewed-customer-ci";
  callbackVerifier.addReceipt(callbackReceipt, {
    installationId: 77,
    setupAction: "install",
    state: intent.state,
  });
  const installation = await service.completeInstallationLink({
    callbackReceipt,
    correlationId: "correlation.reviewed-ci-link-complete",
    intentId: intent.intentId,
    organizationId: "org_main",
    principalId: "principal_owner",
  });
  const [repository] = await service.discoverRepositories({
    correlationId: "correlation.reviewed-ci-discover",
    integrationId: installation.integrationId,
    organizationId: "org_main",
    principalId: "principal_owner",
  });
  if (repository === undefined) {
    throw new Error("Expected the reviewed customer repository.");
  }
  const application = new GitHubRepositoryExportApplicationService({
    access: {
      authorizeOrganization: (_principal, organizationId) =>
        Promise.resolve({ organizationId }),
      authorizeProject: () => Promise.resolve({ organizationId: "org_main" }),
    },
    entitlements: { authorize: () => Promise.resolve() },
    service,
  });
  const principal = {
    authenticatedAt: COMPLETE,
    authenticationSource: "test" as const,
    correlationId: "correlation.reviewed-ci-application",
    expiresAt: "2026-08-24T20:00:00.000Z",
    principalId: "principal_owner",
    sessionId: "session_reviewed_customer_ci",
  };
  const preview = await application.createPreview(principal, "project_main", {
    artifactId,
    baseBranch: "main",
    contractVersion: 1,
    destinationFolder: "solutions/notes",
    featureBranch: "cloudmarkup/reviewed-customer-ci",
    includeWorkflows: true,
    integrationId: installation.integrationId,
    repositoryId: repository.repositoryId,
  });
  const receipt = await application.execute(
    principal,
    "project_main",
    {
      confirmedWorkflowFiles: preview.workflowFiles,
      contractVersion: 1,
      previewDigest: preview.previewDigest,
      previewId: preview.previewId,
    },
    "reviewed-customer-ci-export",
  );
  return {
    branchFiles: github.branchFiles(
      "customer-organization",
      "customer-repository",
      receipt.branch,
    ),
    preview,
    receipt,
  };
}

describe("Solution Export API integration", () => {
  it("runs the exported local composition through concrete runner adapters and publishes live progress", async () => {
    const harness = injectedLocalCompositionFixture({ pauseCompiler: true });
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(
            body("Injected complete export"),
            "injected-complete-create",
          ),
        )
      ).json(),
    );
    const runningWork = harness.composition.worker.runNext();
    await harness.compilerStarted;
    const running = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(running.data).toMatchObject({
      progress: { completedStages: 1, currentStage: "compilation" },
      state: "running",
    });
    harness.releaseCompiler();
    await expect(runningWork).resolves.toBe(true);

    const completed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(completed.data).toMatchObject({
      applicationVerification: {
        confirmedState: "complete-supported-pattern",
      },
      runSequence: 1,
      state: "succeeded",
    });
    expect(harness.invocations).toEqual(
      expect.arrayContaining([
        "compiler-command-executor",
        "application-build-runner",
        "terraform-validation-runner",
        "persist-output",
      ]),
    );
    const artifactId = required(
      completed.data.artifact?.artifactId,
      "injected composition artifact ID",
    );
    const grant = solutionExportDownloadGrantResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
          jsonPost({ contractVersion: 1 }, "injected-complete-grant"),
        )
      ).json(),
    );
    const download = await authorized(harness.app, grant.data.url);
    const paths = readDeterministicZip(
      new Uint8Array(await download.arrayBuffer()),
    ).map(({ path }) => path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "application/artifacts/workload_notes_api/function.zip",
        "application/evidence/workload_notes_api/sbom.cdx.json",
        "cloudmarkup/cloudmarkup.manifest.json",
        "infrastructure/main.tf",
      ]),
    );
  });

  it("composes an approved immutable customer workflow review into the artifact and fake GitHub preview/export", async () => {
    const harness = injectedLocalCompositionFixture({
      repositoryWorkflowReview: "approved",
    });
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(
            body("Reviewed customer CI export"),
            "reviewed-customer-ci-create",
          ),
        )
      ).json(),
    );
    await expect(harness.composition.worker.runNext()).resolves.toBe(true);
    const completed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    const artifactId = required(
      completed.data.artifact?.artifactId,
      "reviewed customer CI artifact ID",
    );
    const stored = await harness.store.getArtifact({
      artifactId,
      organizationId: "org_main",
      projectId: "project_main",
    });
    const artifact = required(stored?.verifiedArtifact, "reviewed artifact");
    const expectedPaths = Object.values(CUSTOMER_CI_WORKFLOW_PATHS).sort();

    expect(completed.data.state).toBe("succeeded");
    expect(
      artifact.manifest.repositoryWorkflows?.files
        .map(({ path }) => path)
        .sort(),
    ).toEqual(expectedPaths);
    expect(artifact.manifest.repositoryWorkflows).toMatchObject({
      repository: {
        destinationFolder: "solutions/notes",
        name: "customer-repository",
        owner: "customer-organization",
        state: "bound",
      },
      solutionRevision: {
        digest: COMPLETE_PACKAGE_FIXTURE.request.subject.manifestDigest,
        id: COMPLETE_PACKAGE_FIXTURE.request.subject.solutionRevisionId,
      },
    });

    const exported = await previewAndExportReviewedCustomerCi(
      artifactId,
      artifact,
    );
    expect(exported.preview.ready).toBe(true);
    expect(exported.preview.issues).toEqual([]);
    expect(exported.preview.repositoryWorkflows?.repository).toMatchObject({
      repositoryId: "987654321",
      repositoryOwnerId: "1234567",
    });
    expect(
      exported.preview.workflowFiles.map(({ path }) => path).sort(),
    ).toEqual(expectedPaths);
    expect(expectedPaths.every((path) => exported.branchFiles.has(path))).toBe(
      true,
    );
    expect(exported.receipt.pullRequestNumber).toBe(1);
  });

  it.each([undefined, "denied"] as const)(
    "does not compose the five-file customer workflow set when review is %s",
    async (review) => {
      const harness = injectedLocalCompositionFixture({
        ...(review === undefined ? {} : { repositoryWorkflowReview: review }),
      });
      const created = solutionExportJobResponseV1Schema.parse(
        await (
          await authorized(
            harness.app,
            "/v1/projects/project_main/solution-export-jobs",
            jsonPost(
              body(`Customer CI review ${review ?? "absent"}`),
              `customer-ci-review-${review ?? "absent"}`,
            ),
          )
        ).json(),
      );
      await expect(harness.composition.worker.runNext()).resolves.toBe(true);
      const completed = solutionExportJobResponseV1Schema.parse(
        await (
          await authorized(
            harness.app,
            `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
          )
        ).json(),
      );
      const stored = await harness.store.getArtifact({
        artifactId: required(
          completed.data.artifact?.artifactId,
          "workflowless customer CI artifact ID",
        ),
        organizationId: "org_main",
        projectId: "project_main",
      });
      const artifact = required(stored?.verifiedArtifact, "base artifact");
      expect(artifact.manifest.repositoryWorkflows).toMatchObject({
        repository: { destinationFolder: "", state: "portable-unbound" },
      });
      expect(
        artifact.manifest.repositoryWorkflows?.files.map(({ path }) => path),
      ).toEqual([CUSTOMER_CI_WORKFLOW_PATHS.validate]);
      expect(
        artifact.manifest.repositoryWorkflows?.files.filter(({ path }) =>
          new Set<string>([
            CUSTOMER_CI_WORKFLOW_PATHS.plan,
            CUSTOMER_CI_WORKFLOW_PATHS.deploy,
            CUSTOMER_CI_WORKFLOW_PATHS.smoke,
            CUSTOMER_CI_WORKFLOW_PATHS.drift,
          ]).has(path),
        ),
      ).toHaveLength(0);
    },
  );

  it("fails closed before publication when approval belongs to another Solution Revision", async () => {
    const harness = injectedLocalCompositionFixture({
      repositoryWorkflowReview: "approved-cross-revision",
    });
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(
            body("Cross-revision customer CI review"),
            "cross-revision-customer-ci-create",
          ),
        )
      ).json(),
    );

    await expect(harness.composition.worker.runNext()).resolves.toBe(true);
    const failed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(failed.data.state).toBe("failed");
    expect(
      failed.data.diagnostics.some(
        ({ severity, stage }) => severity === "error" && stage === "packaging",
      ),
    ).toBe(true);
    expect(failed.data.artifact).toBeUndefined();
    expect(harness.store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });
  });

  it("keeps the exported local composition retryable after a transient concrete compiler failure", async () => {
    const harness = injectedLocalCompositionFixture({
      transientCompilerOnce: true,
    });
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(body("Injected retry export"), "injected-retry-create"),
        )
      ).json(),
    );
    await expect(harness.composition.worker.runNext()).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(harness.composition.worker.queuedJobIds()).toEqual([
      created.data.id,
    ]);
    const retryable = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(retryable.data.state).toBe("running");
    await expect(harness.composition.worker.runNext()).resolves.toBe(true);
    expect(harness.composition.worker.queuedJobIds()).toHaveLength(0);
  });

  it.each([
    "persist-stage-report",
    "persist-output",
    "save-read-model",
    "progress",
  ] as const)(
    "keeps the actual local worker retryable after a transient %s adapter outage",
    async (boundary) => {
      const harness = injectedLocalCompositionFixture({
        transientAdapterOnce: boundary,
      });
      const created = solutionExportJobResponseV1Schema.parse(
        await (
          await authorized(
            harness.app,
            "/v1/projects/project_main/solution-export-jobs",
            jsonPost(
              body(`Injected ${boundary} retry export`),
              `injected-${boundary}-retry-create`,
            ),
          )
        ).json(),
      );

      await expect(harness.composition.worker.runNext()).rejects.toMatchObject({
        code: "service_unavailable",
      });
      expect(harness.composition.worker.queuedJobIds()).toEqual([
        created.data.id,
      ]);
      expect(harness.store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });

      await expect(harness.composition.worker.runNext()).resolves.toBe(true);
      expect(harness.composition.worker.queuedJobIds()).toEqual([]);
      const succeeded = solutionExportJobResponseV1Schema.parse(
        await (
          await authorized(
            harness.app,
            `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
          )
        ).json(),
      );
      expect(succeeded.data.state).toBe("succeeded");
      expect(succeeded.data.artifact).toBeDefined();
    },
  );

  it("publishes a visible permanent failure for substituted prepared input before invoking any runner", async () => {
    const harness = injectedLocalCompositionFixture({
      corruptPreparedInputSize: true,
    });
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(body("Injected invalid input"), "injected-invalid-create"),
        )
      ).json(),
    );
    await expect(harness.composition.worker.runNext()).resolves.toBe(true);
    expect(harness.invocations).toEqual([]);
    expect(harness.composition.worker.queuedJobIds()).toEqual([]);
    const failed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(failed.data).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "EXPORT_WORKFLOW_INPUT_BINDING_FAILED",
          severity: "error",
          stage: "compilation",
        }),
      ],
      state: "failed",
    });
    expect(failed.data.artifact).toBeUndefined();
    expect(harness.store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });
  });

  it("publishes a visible permanent failure for substituted projection lineage", async () => {
    const harness = injectedLocalCompositionFixture({
      corruptProjectionMaterial: true,
    });
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(
            body("Injected invalid projection"),
            "injected-invalid-projection-create",
          ),
        )
      ).json(),
    );
    await expect(harness.composition.worker.runNext()).resolves.toBe(true);
    const failed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(failed.data).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "EXPORT_PUBLICATION_INTEGRITY_FAILED",
          severity: "error",
          stage: "publication",
        }),
      ],
      state: "failed",
    });
    expect(failed.data.artifact).toBeUndefined();
    expect(harness.composition.worker.queuedJobIds()).toEqual([]);
    expect(harness.store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });
  });

  it("projects only applicable live application stages for infrastructure and AI-assisted coverage", () => {
    expect(
      projectInjectedSolutionExportProgress(2, "infrastructure-only"),
    ).toMatchObject({
      progress: {
        completedStages: 4,
        currentStage: "terraform-validation",
      },
      statuses: [
        "succeeded",
        "succeeded",
        "skipped",
        "skipped",
        "running",
        "pending",
        "pending",
        "pending",
      ],
    });
    expect(
      projectInjectedSolutionExportProgress(2, "ai-assisted-custom-validated"),
    ).toMatchObject({
      progress: {
        completedStages: 2,
        currentStage: "application-generation",
      },
      statuses: [
        "succeeded",
        "succeeded",
        "running",
        "pending",
        "pending",
        "pending",
        "pending",
        "pending",
      ],
    });
    expect(
      projectInjectedSolutionExportProgress(3, "ai-assisted-custom-validated"),
    ).toMatchObject({
      progress: {
        completedStages: 4,
        currentStage: "terraform-validation",
      },
      statuses: [
        "succeeded",
        "succeeded",
        "succeeded",
        "skipped",
        "running",
        "pending",
        "pending",
        "pending",
      ],
    });
  });

  it("honors API cancellation triggered during staged persistence before public commit", async () => {
    const harness = injectedLocalCompositionFixture({
      cancelDuringPersistence: true,
    });
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(
            body("Injected late cancellation"),
            "injected-cancel-create",
          ),
        )
      ).json(),
    );
    await expect(harness.composition.worker.runNext()).resolves.toBe(true);
    const canceled = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          harness.app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(canceled.data).toMatchObject({
      cancellation: { state: "acknowledged" },
      state: "canceled",
    });
    expect(canceled.data.artifact).toBeUndefined();
    expect(harness.stagedArtifact()).toBe(true);
    expect(harness.store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });
  });

  it("accepts only an authorized immutable revision binding", async () => {
    const { app, store, workflow } = fixture({ includeRevision: false });
    const { solutionRevisionId: _revision, ...mutableSelection } = body();
    void _revision;
    const mutableResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(
        { ...mutableSelection, draftId: "draft_main" },
        "mutable-draft-export",
      ),
    );
    expect(mutableResponse.status).toBe(400);

    const missingRevision = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "missing-revision-export"),
    );
    expect(missingRevision.status).toBe(404);
    expect(workflow.queuedRequests()).toHaveLength(0);
    expect(store.storedCounts()).toEqual({ artifacts: 0, jobs: 0 });
  });

  it("denies missing entitlement before reserving or enqueueing work", async () => {
    const { app, store, workflow } = fixture({ entitlementEnabled: false });
    const denied = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "missing-entitlement-export"),
    );
    expect(denied.status).toBe(403);
    expect(workflow.queuedRequests()).toHaveLength(0);
    expect(store.storedCounts()).toEqual({ artifacts: 0, jobs: 0 });
  });

  it("idempotently ensures enqueue after a transient post-reservation failure", async () => {
    const { app, workflow } = fixture();
    workflow.failNextEnqueueForTest();
    const first = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "enqueue-redelivery"),
    );
    expect(first.status).toBe(503);
    expect(workflow.queuedRequests()).toHaveLength(0);

    const retry = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "enqueue-redelivery"),
    );
    expect(retry.status).toBe(202);
    const queued = solutionExportJobResponseV1Schema.parse(await retry.json());
    expect(queued.data.state).toBe("queued");
    expect(workflow.queuedRequests()).toHaveLength(1);

    const duplicateRetry = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "enqueue-redelivery"),
    );
    expect(duplicateRetry.status).toBe(202);
    expect(workflow.queuedRequests()).toHaveLength(1);
    await workflow.runNext();
    const completed = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${queued.data.id}`,
    );
    expect(
      solutionExportJobResponseV1Schema.parse(await completed.json()).data
        .state,
    ).toBe("succeeded");
  });

  it("deduplicates the same exact primary input after success without changing its fixed baseline", async () => {
    const { app, store, workflow } = fixture();
    const selected = body("Stable primary export");
    const firstResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(selected, "stable-primary-first"),
    );
    const first = solutionExportJobResponseV1Schema.parse(
      await firstResponse.json(),
    );
    await expect(workflow.runNext()).resolves.toBe(true);
    const completedResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${first.data.id}`,
    );
    const completed = solutionExportJobResponseV1Schema.parse(
      await completedResponse.json(),
    );
    expect(completed.data.state).toBe("succeeded");
    expect(workflow.queuedRequests()).toHaveLength(0);

    const replayResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(selected, "stable-primary-replay"),
    );
    const replay = solutionExportJobResponseV1Schema.parse(
      await replayResponse.json(),
    );
    expect(replay.data.id).toBe(completed.data.id);
    expect(replay.data.requestDigest).toBe(completed.data.requestDigest);
    expect(replay.data.previousArtifactId).toBeUndefined();
    expect(replay.data.artifact).toEqual(completed.data.artifact);
    expect(replay.data.runSequence).toBe(1);
    expect(replay.data.rerunOfJobId).toBeUndefined();
    expect(workflow.queuedRequests()).toHaveLength(0);
    expect(store.storedCounts()).toEqual({ artifacts: 1, jobs: 1 });
  });

  it("runs create through the injected worker and serves review, preview, grant, and authenticated download", async () => {
    const { app, workflow } = fixture();
    const created = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "export-create-main"),
    );
    expect(created.status).toBe(202);
    const queued = solutionExportJobResponseV1Schema.parse(
      await created.json(),
    );
    expect(queued.data.state).toBe("queued");
    expect(queued.data.solutionRevision).toEqual({
      manifestDigest: PACKAGE_FIXTURE.request.subject.manifestDigest,
      manifestRecordId: PACKAGE_FIXTURE.request.subject.manifestRecordId,
      solutionRevisionId: SOLUTION_REVISION_ID,
    });
    expect(workflow.queuedRequests()).toHaveLength(1);
    const workflowRequest = workflow.queuedRequests()[0]?.request;
    expect(workflowRequest?.subject.manifestRecordId).toBe(
      PACKAGE_FIXTURE.request.subject.manifestRecordId,
    );
    expect(workflowRequest?.sources.solutionRevision.objectId).toBe(
      PACKAGE_FIXTURE.request.sources.solutionRevision.objectId,
    );
    expect(workflowRequest?.sources.solutionRevision.digest).toBe(
      workflowRequest?.subject.manifestDigest,
    );

    const retry = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "export-create-main"),
    );
    const equivalent = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "export-create-equivalent"),
    );
    expect(
      solutionExportJobResponseV1Schema.parse(await retry.json()).data.id,
    ).toBe(queued.data.id);
    expect(
      solutionExportJobResponseV1Schema.parse(await equivalent.json()).data.id,
    ).toBe(queued.data.id);
    expect(workflow.queuedRequests()).toHaveLength(1);

    await expect(workflow.runNext()).resolves.toBe(true);
    const completedResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${queued.data.id}`,
    );
    const completed = solutionExportJobResponseV1Schema.parse(
      await completedResponse.json(),
    );
    expect(completed.data.state).toBe("succeeded");
    expect(completed.data.pollAfterMilliseconds).toBeUndefined();
    const artifactId = required(
      completed.data.artifact?.artifactId,
      "artifact ID",
    );
    const lateRetryResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "export-create-main"),
    );
    const lateRetry = solutionExportJobResponseV1Schema.parse(
      await lateRetryResponse.json(),
    );
    expect(lateRetry.data.id).toBe(queued.data.id);
    expect(workflow.queuedRequests()).toHaveLength(0);

    const artifactResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}`,
    );
    const artifact = solutionExportArtifactResponseV1Schema.parse(
      await artifactResponse.json(),
    );
    expect(artifact.data.downloadAvailability.state).toBe("available");
    const fileId = required(
      artifact.data.files.find((file) => file.path === "README.md")?.id,
      "README preview file ID",
    );
    const previewResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}/files/${fileId}/preview`,
    );
    const preview = solutionExportFilePreviewResponseV1Schema.parse(
      await previewResponse.json(),
    );
    expect(preview.data.content).toContain("Notes API");

    const grantResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
      jsonPost({ contractVersion: 1 }, "download-grant-main"),
    );
    expect(grantResponse.status).toBe(201);
    const grant = solutionExportDownloadGrantResponseV1Schema.parse(
      await grantResponse.json(),
    );
    const grantRetryResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
      jsonPost({ contractVersion: 1 }, "download-grant-main"),
    );
    const grantRetry = solutionExportDownloadGrantResponseV1Schema.parse(
      await grantRetryResponse.json(),
    );
    expect(grantRetry.data.id).toBe(grant.data.id);
    const nextGrantResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
      jsonPost({ contractVersion: 1 }, "download-grant-next"),
    );
    const nextGrant = solutionExportDownloadGrantResponseV1Schema.parse(
      await nextGrantResponse.json(),
    );
    expect(nextGrant.data.id).not.toBe(grant.data.id);
    expect(grant.data.url.startsWith("/v1/")).toBe(true);
    const download = await authorized(app, grant.data.url);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="notes-api.zip"',
    );
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    const downloadedBytes = new Uint8Array(await download.arrayBuffer());
    const downloadedEntries = readDeterministicZip(downloadedBytes);
    expect(downloadedEntries.length).toBeGreaterThan(1);
    const terraformEntry = downloadedEntries.find(
      ({ path }) => path === "infrastructure/main.tf",
    );
    expect(new TextDecoder().decode(terraformEntry?.bytes)).toContain(
      "required_version",
    );
    const anotherPrincipal = await authorized(
      app,
      grant.data.url,
      {},
      VIEWER_TOKEN,
    );
    expect(anotherPrincipal.status).toBe(404);
  });
  it("runs the real workflow orchestrator from immutable API create through verified download", async () => {
    const invocations: string[] = [];
    const { app, workflow } = fixture({
      generationCoverage: coverage("infrastructure-only"),
      processor: (submission, store) =>
        processWithActualOrchestrator(submission, store, invocations),
    });
    const request = body("Orchestrated Notes API");
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(request, "actual-orchestrator-create"),
    );
    expect(createdResponse.status).toBe(202);
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );

    await expect(workflow.runNext()).resolves.toBe(true);
    expect(invocations).toEqual([
      "compiler",
      "terraform-validator",
      "persist:validate-infrastructure",
      "diagram-renderer",
      "packager",
      "diff",
      "persist-output",
      "save-read-model",
    ]);
    const completedResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
    );
    const completed = solutionExportJobResponseV1Schema.parse(
      await completedResponse.json(),
    );
    expect(completed.data).toMatchObject({
      generationCoverage: { state: "infrastructure-only" },
      state: "succeeded",
      warnings: [{ code: "APPLICATION_CODE_REQUIRED" }],
    });
    const artifactId = required(
      completed.data.artifact?.artifactId,
      "actual orchestrator artifact ID",
    );
    const artifactResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}`,
    );
    const artifact = solutionExportArtifactResponseV1Schema.parse(
      await artifactResponse.json(),
    );
    expect(artifact.data.files.map(({ path }) => path)).toContain(
      "cloudmarkup/cloudmarkup.manifest.json",
    );
    expect(artifact.data.files.map(({ path }) => path)).toContain(
      "infrastructure/main.tf",
    );
    const grantResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
      jsonPost({ contractVersion: 1 }, "actual-orchestrator-grant"),
    );
    const grant = solutionExportDownloadGrantResponseV1Schema.parse(
      await grantResponse.json(),
    );
    const download = await authorized(app, grant.data.url);
    expect(download.status).toBe(200);
    const zipEntries = readDeterministicZip(
      new Uint8Array(await download.arrayBuffer()),
    );
    expect(zipEntries.map(({ path }) => path)).toContain(
      "cloudmarkup/cloudmarkup.manifest.json",
    );
    expect(zipEntries.map(({ path }) => path)).toContain(
      "infrastructure/main.tf",
    );
  });

  it("runs complete-supported source through the real generator and packager with injected build and validation results", async () => {
    const invocations: string[] = [];
    const { app, workflow } = fixture({
      generationCoverage: coverage("complete-supported-pattern"),
      processor: (submission, store) =>
        processWithActualOrchestrator(
          submission,
          store,
          invocations,
          COMPLETE_PACKAGE_FIXTURE,
        ),
      revision: {
        applicationCodeRequired: false,
        generationCoverage: coverage("complete-supported-pattern"),
        manifestDigest: COMPLETE_PACKAGE_FIXTURE.request.subject.manifestDigest,
        manifestRecordId:
          COMPLETE_PACKAGE_FIXTURE.request.subject.manifestRecordId,
        organizationId: "org_main",
        projectId: "project_main",
        solutionRevisionId:
          COMPLETE_PACKAGE_FIXTURE.request.subject.solutionRevisionId,
        workflowSources: COMPLETE_PACKAGE_FIXTURE.request.sources,
      },
    });
    const request = {
      ...body("Complete Notes API"),
      environment: COMPLETE_PACKAGE_FIXTURE.request.environment,
    };
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(request, "actual-complete-create"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );
    await expect(workflow.runNext()).resolves.toBe(true);
    expect(invocations).toEqual([
      "compiler",
      "application-generator",
      "application-builder",
      "persist:build-application",
      "terraform-validator",
      "persist:validate-infrastructure",
      "diagram-renderer",
      "packager",
      "diff",
      "persist-output",
      "save-read-model",
    ]);
    const completedResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
    );
    const completed = solutionExportJobResponseV1Schema.parse(
      await completedResponse.json(),
    );
    expect(completed.data).toMatchObject({
      applicationVerification: {
        confirmedState: "complete-supported-pattern",
        inputState: "complete-supported-pattern",
        solutionRevisionDigest:
          COMPLETE_PACKAGE_FIXTURE.request.subject.manifestDigest,
        solutionRevisionId: SOLUTION_REVISION_ID,
      },
      generationCoverage: { state: "complete-supported-pattern" },
      state: "succeeded",
      warnings: [],
    });
    expect(completed.data.generationCoverage).toEqual(
      created.data.generationCoverage,
    );
    expect(
      completed.data.applicationVerification?.generationArtifactDigest,
    ).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(completed.data.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "application-build",
          stage: "application-build",
          status: "passed",
        }),
        expect.objectContaining({
          kind: "terraform-validation",
          stage: "terraform-validation",
          status: "passed",
        }),
      ]),
    );
    expect(
      completed.data.evidence.every(
        ({ digest, evidenceId, reference }) =>
          reference?.evidenceId === evidenceId &&
          reference.record.digest === digest &&
          reference.solutionRevisionId === SOLUTION_REVISION_ID,
      ),
    ).toBe(true);
    expect(
      completed.data.evidence.some(
        ({ evidenceId }) =>
          evidenceId === completed.data.applicationVerification?.evidenceId,
      ),
    ).toBe(true);
    const artifactId = required(
      completed.data.artifact?.artifactId,
      "complete orchestrator artifact ID",
    );
    const grantResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
      jsonPost({ contractVersion: 1 }, "actual-complete-grant"),
    );
    const grant = solutionExportDownloadGrantResponseV1Schema.parse(
      await grantResponse.json(),
    );
    const download = await authorized(app, grant.data.url);
    const paths = readDeterministicZip(
      new Uint8Array(await download.arrayBuffer()),
    ).map(({ path }) => path);
    expect(paths).toContain(
      "application/artifacts/workload_notes_api/function.zip",
    );
    expect(paths).toContain(
      "application/evidence/workload_notes_api/sbom.cdx.json",
    );
    expect(paths).toContain("cloudmarkup/cloudmarkup.manifest.json");
    expect(paths).toContain("infrastructure/main.tf");
  });
  it("publishes every canonical event-handler build and Evidence record through the public API", async () => {
    const invocations: string[] = [];
    const expectedGeneration = generateApplication(
      MULTI_EVENT_PACKAGE_FIXTURE.generationRequest,
    );
    const expectedWorkloadIds = expectedGeneration.artifact.buildContracts
      .map(({ contract }) => contract.workloadId)
      .sort();
    const expectedArtifactPaths = expectedGeneration.artifact.buildContracts
      .map(({ contract }) => contract.expectedArtifact.path)
      .sort();
    const { app, workflow } = fixture({
      generationCoverage:
        MULTI_EVENT_PACKAGE_FIXTURE.generationRequest.solutionRevision
          .generationCoverage,
      processor: (submission, store) =>
        processWithActualOrchestrator(
          submission,
          store,
          invocations,
          MULTI_EVENT_PACKAGE_FIXTURE,
        ),
      revision: {
        applicationCodeRequired: false,
        generationCoverage:
          MULTI_EVENT_PACKAGE_FIXTURE.generationRequest.solutionRevision
            .generationCoverage,
        manifestDigest:
          MULTI_EVENT_PACKAGE_FIXTURE.request.subject.manifestDigest,
        manifestRecordId:
          MULTI_EVENT_PACKAGE_FIXTURE.request.subject.manifestRecordId,
        organizationId: "org_main",
        projectId: "project_main",
        solutionRevisionId:
          MULTI_EVENT_PACKAGE_FIXTURE.request.subject.solutionRevisionId,
        workflowSources: MULTI_EVENT_PACKAGE_FIXTURE.request.sources,
      },
      targetSettings: MULTI_EVENT_PACKAGE_FIXTURE.request.targetSettings,
    });
    const request = {
      ...body("Event fan-out handlers"),
      environment: MULTI_EVENT_PACKAGE_FIXTURE.request.environment,
      solutionRevisionId:
        MULTI_EVENT_PACKAGE_FIXTURE.request.subject.solutionRevisionId,
    };
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(request, "actual-multi-event-create"),
        )
      ).json(),
    );

    await expect(workflow.runNext()).resolves.toBe(true);
    const completed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs/" + created.data.id,
        )
      ).json(),
    );
    expect(
      completed.data.state,
      JSON.stringify(completed.data.diagnostics),
    ).toBe("succeeded");
    expect(completed.data.applicationVerification).toBeUndefined();
    expect(
      completed.data.applicationVerifications?.map(
        ({ workloadId }) => workloadId,
      ),
    ).toEqual(expectedWorkloadIds);
    expect(completed.data.applicationVerifications).toHaveLength(2);
    expect(
      completed.data.applicationVerifications?.every(
        ({ confirmedState, evidenceId }) =>
          confirmedState === "complete-supported-pattern" &&
          evidenceId !== undefined &&
          completed.data.evidence.some(
            (evidence) =>
              evidence.evidenceId === evidenceId &&
              evidence.kind === "application-build" &&
              evidence.status === "passed",
          ),
      ),
    ).toBe(true);
    expect(
      invocations.filter((value) => value === "application-builder"),
    ).toEqual(["application-builder"]);

    const artifactId = required(
      completed.data.artifact?.artifactId,
      "multi-handler orchestrator artifact ID",
    );
    const grant = solutionExportDownloadGrantResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-artifacts/" +
            artifactId +
            "/download-grants",
          jsonPost({ contractVersion: 1 }, "actual-multi-event-grant"),
        )
      ).json(),
    );
    const download = await authorized(app, grant.data.url);
    const paths = readDeterministicZip(
      new Uint8Array(await download.arrayBuffer()),
    ).map(({ path }) => path);
    expect(expectedArtifactPaths).toHaveLength(2);
    expect(paths).toEqual(expect.arrayContaining(expectedArtifactPaths));
  });

  it("projects an injected Terraform failure from the actual orchestrator without an artifact", async () => {
    const invocations: string[] = [];
    const { app, store, workflow } = fixture({
      generationCoverage: coverage("infrastructure-only"),
      processor: (submission, store) =>
        processWithActualOrchestrator(
          submission,
          store,
          invocations,
          PACKAGE_FIXTURE,
          { validationState: "failed" },
        ),
    });
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("Failed validation"), "actual-validation-failure"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );

    await expect(workflow.runNext()).resolves.toBe(true);
    expect(invocations).toEqual([
      "compiler",
      "terraform-validator",
      "persist:validate-infrastructure",
      "save-read-model",
    ]);
    const failed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(failed.data.state).toBe("failed");
    expect(
      failed.data.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "terraform.validation.reviewed-check-failed" &&
          diagnostic.severity === "error" &&
          diagnostic.stage === "terraform-validation",
      ),
    ).toBe(true);
    expect(
      failed.data.evidence.some(
        (evidence) =>
          evidence.kind === "terraform-validation" &&
          evidence.stage === "terraform-validation" &&
          evidence.status === "failed",
      ),
    ).toBe(true);
    expect(failed.data.artifact).toBeUndefined();
    expect(store.storedCounts().artifacts).toBe(0);
  });

  it("propagates an API cancellation into the actual workflow context", async () => {
    const invocations: string[] = [];
    const { app, store, workflow } = fixture({
      generationCoverage: coverage("infrastructure-only"),
      processor: (submission, store, isCancellationRequested) =>
        processWithActualOrchestrator(
          submission,
          store,
          invocations,
          PACKAGE_FIXTURE,
          { cancellationRequested: isCancellationRequested },
        ),
    });
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("Canceled export"), "actual-cancel-create"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );
    const cancelResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${created.data.id}/cancel`,
      jsonPost({ contractVersion: 1 }, "actual-cancel-request"),
    );
    expect(cancelResponse.status).toBe(200);

    await expect(workflow.runNext()).resolves.toBe(true);
    expect(invocations).toEqual([]);
    expect(invocations).not.toContain("persist-output");
    const canceled = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(canceled.data).toMatchObject({
      cancellation: { state: "acknowledged" },
      state: "canceled",
    });
    expect(canceled.data.artifact).toBeUndefined();
    expect(store.storedCounts().artifacts).toBe(0);
  });

  it("projects an actual canceled workflow read model without an artifact", async () => {
    const invocations: string[] = [];
    const { app, store, workflow } = fixture({
      generationCoverage: coverage("infrastructure-only"),
      processor: (submission, store) =>
        processWithActualOrchestrator(
          submission,
          store,
          invocations,
          PACKAGE_FIXTURE,
          { validationState: "cancelled" },
        ),
    });
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("Canceled validation"), "actual-read-model-cancel"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );

    await expect(workflow.runNext()).resolves.toBe(true);
    expect(invocations).toEqual([
      "compiler",
      "terraform-validator",
      "persist:validate-infrastructure",
      "save-read-model",
    ]);
    const canceled = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(canceled.data).toMatchObject({
      cancellation: { state: "acknowledged" },
      evidence: [
        expect.objectContaining({
          kind: "terraform-validation",
          stage: "terraform-validation",
          status: "failed",
        }),
      ],
      state: "canceled",
    });
    expect(
      canceled.data.stages.some(({ status }) => status === "canceled"),
    ).toBe(true);
    expect(canceled.data.artifact).toBeUndefined();
    expect(store.storedCounts().artifacts).toBe(0);
  });

  it.each(["archive", "manifest", "inventory", "workflow-reference"] as const)(
    "rejects %s corruption before an artifact is published",
    async (corruption) => {
      const { app, store, workflow } = fixture({
        publicationMutation(artifact) {
          switch (corruption) {
            case "archive":
              return {
                ...artifact,
                zipBytes: new TextEncoder().encode("PK-tampered"),
              };
            case "manifest":
              return {
                ...artifact,
                verifiedArtifact: {
                  ...artifact.verifiedArtifact,
                  manifestDigest: artifact.verifiedArtifact.zipDigest,
                },
              };
            case "inventory": {
              const first = required(
                artifact.artifact.files[0],
                "artifact inventory file",
              );
              return {
                ...artifact,
                artifact: {
                  ...artifact.artifact,
                  files: [
                    { ...first, checksum: DIGEST },
                    ...artifact.artifact.files.slice(1),
                  ],
                },
              };
            }
            case "workflow-reference":
              return {
                ...artifact,
                workflowPackage: {
                  ...artifact.workflowPackage,
                  object: {
                    ...artifact.workflowPackage.object,
                    digest: artifact.verifiedArtifact.manifestDigest,
                  },
                },
              };
          }
        },
      });
      const createdResponse = await authorized(
        app,
        "/v1/projects/project_main/solution-export-jobs",
        jsonPost(body(), `publication-tamper-${corruption}`),
      );
      const created = solutionExportJobResponseV1Schema.parse(
        await createdResponse.json(),
      );

      await expect(workflow.runNext()).resolves.toBe(true);
      expect(store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });
      expect(workflow.queuedRequests()).toHaveLength(0);
      const jobResponse = await authorized(
        app,
        `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
      );
      const job = solutionExportJobResponseV1Schema.parse(
        await jobResponse.json(),
      );
      expect(job.data.state).toBe("failed");
      expect(
        job.data.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "EXPORT_PUBLICATION_INTEGRITY_FAILED" &&
            diagnostic.severity === "error" &&
            diagnostic.stage === "publication",
        ),
      ).toBe(true);
      expect(job.data.artifact).toBeUndefined();
    },
  );
  it("retries a dequeued work item after a processor failure", async () => {
    const { app, store, workflow } = fixture({ failProcessorOnce: true });
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "processor-retry"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );

    await expect(workflow.runNext()).rejects.toThrow(
      "Injected solution export processor failure.",
    );
    expect(workflow.queuedRequests()).toHaveLength(1);
    expect(store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });
    const retryable = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(retryable.data.state).toBe("queued");

    await expect(workflow.runNext()).resolves.toBe(true);
    expect(workflow.queuedRequests()).toHaveLength(0);
    expect(store.storedCounts()).toEqual({ artifacts: 1, jobs: 1 });
  });

  it("keeps an artifact hidden and retryable when terminal job persistence fails", async () => {
    const { app, store, workflow } = fixture();
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "publication-persistence-retry"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );
    store.failNextSaveJobForTest();

    await expect(workflow.runNext()).rejects.toThrow(
      "Injected solution export job persistence failure.",
    );
    expect(workflow.queuedRequests()).toHaveLength(1);
    expect(store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });
    const hidden = await authorized(
      app,
      "/v1/projects/project_main/solution-export-artifacts/solutionartifact_missing",
    );
    expect(hidden.status).toBe(404);
    const retryable = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(retryable.data.state).toBe("queued");
    expect(retryable.data.artifact).toBeUndefined();

    await expect(workflow.runNext()).resolves.toBe(true);
    expect(store.storedCounts()).toEqual({ artifacts: 1, jobs: 1 });
    const completed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(completed.data.state).toBe("succeeded");
  });

  it("requires an immutable succeeded owner for artifact reads, grants, and baselines", async () => {
    const { app, store, workflow } = fixture();
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("Owner-bound export"), "owner-bound-create"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );
    await workflow.runNext();
    const stored = await store.getJob({
      jobId: created.data.id,
      organizationId: "org_main",
      projectId: "project_main",
    });
    if (stored === null) throw new Error("Expected the completed owner job.");
    expect(() =>
      store.saveJob({
        ...stored,
        job: { ...stored.job, updatedAt: RETENTION_EXPIRES },
      }),
    ).toThrow("A terminal export job is immutable.");

    const artifactId = required(
      stored.job.artifact?.artifactId,
      "owner-bound artifact ID",
    );
    expect(
      (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-artifacts/${artifactId}`,
        )
      ).status,
    ).toBe(200);

    store.corruptArtifactOwnerForTest(artifactId);
    expect(
      (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-artifacts/${artifactId}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
          jsonPost({ contractVersion: 1 }, "stale-owner-grant"),
        )
      ).status,
    ).toBe(404);

    const nextResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("No stale baseline"), "no-stale-baseline-create"),
    );
    const next = solutionExportJobResponseV1Schema.parse(
      await nextResponse.json(),
    );
    expect(next.data.previousArtifactId).toBeUndefined();
    expect(store.storedCounts().artifacts).toBe(1);
  });

  it.each(["archive", "grant"] as const)(
    "fails closed when stored %s integrity metadata is corrupted",

    async (corruption) => {
      const { app, store, workflow } = fixture();
      const createdResponse = await authorized(
        app,
        "/v1/projects/project_main/solution-export-jobs",
        jsonPost(body(), `tamper-create-${corruption}`),
      );
      const created = solutionExportJobResponseV1Schema.parse(
        await createdResponse.json(),
      );
      await workflow.runNext();
      const completedResponse = await authorized(
        app,
        `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
      );
      const completed = solutionExportJobResponseV1Schema.parse(
        await completedResponse.json(),
      );
      const artifactId = completed.data.artifact?.artifactId ?? "";
      const grantResponse = await authorized(
        app,
        `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
        jsonPost({ contractVersion: 1 }, `tamper-grant-${corruption}`),
      );
      const grant = solutionExportDownloadGrantResponseV1Schema.parse(
        await grantResponse.json(),
      );
      if (corruption === "archive") {
        store.corruptArchiveForTest(
          artifactId,
          new TextEncoder().encode("PK-tampered"),
        );
      } else {
        store.corruptDownloadGrantDigestForTest(
          grant.data.id,
          `sha256:${"b".repeat(64)}`,
        );
      }

      const denied = await authorized(app, grant.data.url);
      expect(denied.status).toBe(404);
      expect(denied.headers.get("content-type")).toContain("application/json");
    },
  );

  it("fixes the previous artifact at creation and returns deterministic semantic diff", async () => {
    const { app, workflow } = fixture();
    const firstResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("Notes API"), "export-first"),
    );
    const first = solutionExportJobResponseV1Schema.parse(
      await firstResponse.json(),
    );
    await workflow.runNext();
    const secondResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("Notes API v2"), "export-second"),
    );
    const second = solutionExportJobResponseV1Schema.parse(
      await secondResponse.json(),
    );
    expect(second.data.previousArtifactId).toBe(
      `solutionartifact_${first.data.id.slice("solutionexport_".length)}`,
    );
    await workflow.runNext();
    const completedResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${second.data.id}`,
    );
    const completed = solutionExportJobResponseV1Schema.parse(
      await completedResponse.json(),
    );
    const diffResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${required(
        completed.data.artifact?.artifactId,
        "diff artifact ID",
      )}/diff`,
    );
    const diff = solutionExportArtifactDiffResponseV1Schema.parse(
      await diffResponse.json(),
    );
    expect(diff.data).toMatchObject({
      previousArtifactId: second.data.previousArtifactId,
      state: "available",
    });
    expect(
      diff.data.files.find(
        ({ path }) => path === "cloudmarkup/cloudmarkup.manifest.json",
      ),
    ).toMatchObject({
      change: "modified",
      semanticChange: "changed",
    });
    expect(
      diff.data.files.find(({ path }) => path === "infrastructure/main.tf"),
    ).toMatchObject({
      change: "unchanged",
      semanticChange: "unchanged",
    });
  });

  it("selects previous exports only from the exact target environment", async () => {
    const { app, workflow } = fixture();
    await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("Development export"), "environment-development"),
    );
    await workflow.runNext();

    const stagingInput = {
      ...body("Staging export"),
      environment: { environmentType: "staging" as const },
    };
    const stagingResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(stagingInput, "environment-staging-first"),
    );
    const staging = solutionExportJobResponseV1Schema.parse(
      await stagingResponse.json(),
    );
    expect(staging.data.previousArtifactId).toBeUndefined();
    await workflow.runNext();

    const nextStagingResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(
        { ...stagingInput, exportName: "Staging export v2" },
        "environment-staging-second",
      ),
    );
    const nextStaging = solutionExportJobResponseV1Schema.parse(
      await nextStagingResponse.json(),
    );
    expect(nextStaging.data.previousArtifactId).toBe(
      `solutionartifact_${staging.data.id.slice("solutionexport_".length)}`,
    );
  });

  it("exports generated-starter source through the actual immutable workflow", async () => {
    const invocations: string[] = [];
    const { app, workflow } = fixture({
      applicationCodeRequired: false,
      processor: (submission, store) =>
        processWithActualOrchestrator(
          submission,
          store,
          invocations,
          STARTER_PACKAGE_FIXTURE,
        ),
      revision: {
        applicationCodeRequired: false,
        generationCoverage: coverage("starter-application"),
        manifestDigest: STARTER_PACKAGE_FIXTURE.request.subject.manifestDigest,
        manifestRecordId:
          STARTER_PACKAGE_FIXTURE.request.subject.manifestRecordId,
        organizationId: "org_main",
        projectId: "project_main",
        solutionRevisionId:
          STARTER_PACKAGE_FIXTURE.request.subject.solutionRevisionId,
        workflowSources: STARTER_PACKAGE_FIXTURE.request.sources,
      },
    });
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(
        {
          ...body("Generated starter"),
          environment: STARTER_PACKAGE_FIXTURE.request.environment,
        },
        "generated-starter-success",
      ),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );
    expect(created.data.generationCoverage.state).toBe("starter-application");
    await workflow.runNext();
    const completedResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
    );
    const completed = solutionExportJobResponseV1Schema.parse(
      await completedResponse.json(),
    );
    expect(completed.data).toMatchObject({
      applicationVerification: {
        confirmedState: "starter-application",
        inputState: "starter-application",
      },
      generationCoverage: { state: "starter-application" },
      state: "succeeded",
    });
    expect(completed.data.artifact).toBeDefined();
    expect(invocations).toContain("application-generator");
    expect(invocations).toContain("application-builder");
  });

  it.each([
    ["user-provided", USER_PROVIDED_FIXTURE],
    ["external-artifact", EXTERNAL_ARTIFACT_FIXTURE],
  ] as const)(
    "does not claim application code is required for immutable %s source",
    async (mode, packageFixture) => {
      const invocations: string[] = [];
      const { app, workflow } = fixture({
        processor: (submission, store) =>
          processWithActualOrchestrator(
            submission,
            store,
            invocations,
            packageFixture,
          ),
        revision: {
          applicationCodeRequired: false,
          generationCoverage:
            packageFixture.generationRequest.solutionRevision
              .generationCoverage,
          manifestDigest: packageFixture.request.subject.manifestDigest,
          manifestRecordId: packageFixture.request.subject.manifestRecordId,
          organizationId: "org_main",
          projectId: "project_main",
          solutionRevisionId: packageFixture.request.subject.solutionRevisionId,
          workflowSources: packageFixture.request.sources,
        },
      });
      const createdResponse = await authorized(
        app,
        "/v1/projects/project_main/solution-export-jobs",
        jsonPost(body(`${mode} source`), `${mode}-source`),
      );
      const created = solutionExportJobResponseV1Schema.parse(
        await createdResponse.json(),
      );
      expect(created.data.warnings).toEqual([]);
      await expect(workflow.runNext()).resolves.toBe(true);
      const completedResponse = await authorized(
        app,
        `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
      );
      const completed = solutionExportJobResponseV1Schema.parse(
        await completedResponse.json(),
      );
      expect(completed.data.state).toBe("succeeded");
      expect(completed.data.applicationVerification).toBeUndefined();
      expect(completed.data.warnings).toEqual([]);
      expect(invocations).not.toContain("application-builder");
    },
  );

  it.each(
    Object.entries(FAILURE_DETAILS) as readonly [
      FailureStage,
      (typeof FAILURE_DETAILS)[FailureStage],
    ][],
  )(
    "keeps %s failure evidence reviewable and never publishes a ZIP or grant",
    async (failureStage, expected) => {
      const { app, store, workflow } = fixture({ failureStage });
      const createdResponse = await authorized(
        app,
        "/v1/projects/project_main/solution-export-jobs",
        jsonPost(body(), `export-failure-${failureStage}`),
      );
      const created = solutionExportJobResponseV1Schema.parse(
        await createdResponse.json(),
      );
      await workflow.runNext();
      const failedResponse = await authorized(
        app,
        `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
      );
      const failed = solutionExportJobResponseV1Schema.parse(
        await failedResponse.json(),
      );
      expect(failed.data.artifact).toBeUndefined();
      expect(failed.data).toMatchObject({
        diagnostics: [{ code: expected.code, stage: failureStage }],
        evidence: [
          {
            kind: expected.evidenceKind,
            stage: failureStage,
            status: "failed",
          },
        ],
        generationCoverage: { state: "infrastructure-only" },
        state: "failed",
      });
      expect(store.storedCounts().artifacts).toBe(0);
      const guessedGrant = await authorized(
        app,
        "/v1/projects/project_main/solution-export-artifacts/solutionartifact_missing/download-grants",
        jsonPost({ contractVersion: 1 }, `failed-grant-${failureStage}`),
      );
      expect(guessedGrant.status).toBe(404);
    },
  );

  it("scopes cancel idempotency to the principal and target job", async () => {
    const { app } = fixture();
    const firstResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("First export"), "create-first-cancel"),
    );
    const secondResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body("Second export"), "create-second-cancel"),
    );
    const first = solutionExportJobResponseV1Schema.parse(
      await firstResponse.json(),
    );
    const second = solutionExportJobResponseV1Schema.parse(
      await secondResponse.json(),
    );
    expect(first.data.id).not.toBe(second.data.id);

    const cancelPath = `/v1/projects/project_main/solution-export-jobs/${first.data.id}/cancel`;
    const canceled = await authorized(
      app,
      cancelPath,
      jsonPost({ contractVersion: 1 }, "shared-cancel-key"),
    );
    expect(canceled.status).toBe(200);
    expect(
      solutionExportJobResponseV1Schema.parse(await canceled.json()).data.state,
    ).toBe("cancellation-requested");
    const retry = await authorized(
      app,
      cancelPath,
      jsonPost({ contractVersion: 1 }, "shared-cancel-key"),
    );
    expect(retry.status).toBe(200);

    const reused = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${second.data.id}/cancel`,
      jsonPost({ contractVersion: 1 }, "shared-cancel-key"),
    );
    expect(reused.status).toBe(409);
    await expect(reused.json()).resolves.toMatchObject({
      error: { code: "idempotency_key_reused" },
    });
  });

  it("redelivers an idempotent cancellation after a transient workflow failure", async () => {
    const { app, workflow } = fixture();
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "create-cancel-redelivery"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );
    const cancelPath = `/v1/projects/project_main/solution-export-jobs/${created.data.id}/cancel`;
    workflow.failNextCancellationForTest();

    const failedDelivery = await authorized(
      app,
      cancelPath,
      jsonPost({ contractVersion: 1 }, "cancel-redelivery"),
    );
    expect(failedDelivery.status).toBe(500);
    expect(workflow.isCancellationRequested(created.data.id)).toBe(false);

    const retry = await authorized(
      app,
      cancelPath,
      jsonPost({ contractVersion: 1 }, "cancel-redelivery"),
    );
    expect(retry.status).toBe(200);
    expect(
      solutionExportJobResponseV1Schema.parse(await retry.json()).data.state,
    ).toBe("cancellation-requested");
    expect(workflow.isCancellationRequested(created.data.id)).toBe(true);
  });

  it("rejects a stale progress save after cancellation has been accepted", async () => {
    const { app, store } = fixture();
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(body("Progress cancellation race"), "progress-race-create"),
        )
      ).json(),
    );
    const stale = await store.getJob({
      jobId: created.data.id,
      organizationId: "org_main",
      projectId: "project_main",
    });
    if (stale === null)
      throw new Error("Expected the queued progress snapshot.");
    const canceled = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${created.data.id}/cancel`,
      jsonPost({ contractVersion: 1 }, "progress-race-cancel"),
    );
    expect(canceled.status).toBe(200);

    await expect(
      store.compareAndSaveJob({
        expected: {
          state: stale.job.state,
          updatedAt: stale.job.updatedAt,
        },
        record: {
          ...stale,
          job: {
            ...stale.job,
            progress: {
              completedStages: 2,
              currentStage: "application-generation",
              message: "A stale progress update.",
              totalStages: 8,
            },
            state: "running",
          },
        },
      }),
    ).resolves.toBe(false);
    const authoritative = await store.getJob({
      jobId: created.data.id,
      organizationId: "org_main",
      projectId: "project_main",
    });
    expect(authoritative?.job).toMatchObject({
      cancellation: { state: "requested" },
      state: "cancellation-requested",
    });
  });

  it("lets accepted cancellation win a race with terminal workflow failure", async () => {
    const { app, store, workflow } = fixture({ failureStage: "compilation" });
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(body("Failure cancellation race"), "failure-race-create"),
        )
      ).json(),
    );
    const cancel = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${created.data.id}/cancel`,
      jsonPost({ contractVersion: 1 }, "failure-race-cancel"),
    );
    expect(cancel.status).toBe(200);
    await expect(workflow.runNext()).resolves.toBe(true);

    const terminal = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(terminal.data).toMatchObject({
      cancellation: { state: "acknowledged" },
      state: "canceled",
    });
    expect(terminal.data.artifact).toBeUndefined();
    expect(store.storedCounts()).toEqual({ artifacts: 0, jobs: 1 });
  });

  it("deduplicates an active cancellation and versions a new-key rerun after cancellation", async () => {
    const { app, store, workflow } = fixture();
    const selected = body("Canceled then rerun");
    const created = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(selected, "cancel-version-create"),
        )
      ).json(),
    );
    await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${created.data.id}/cancel`,
      jsonPost({ contractVersion: 1 }, "cancel-version-request"),
    );

    const whileActive = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(selected, "cancel-version-active-replay"),
        )
      ).json(),
    );
    expect(whileActive.data.id).toBe(created.data.id);
    expect(whileActive.data.state).toBe("cancellation-requested");
    expect(workflow.queuedRequests()).toHaveLength(1);

    await expect(workflow.runNext()).resolves.toBe(true);
    const canceled = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
        )
      ).json(),
    );
    expect(canceled.data.state).toBe("canceled");
    expect(canceled.data.artifact).toBeUndefined();

    const sameKey = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(selected, "cancel-version-create"),
        )
      ).json(),
    );
    expect(sameKey.data.id).toBe(created.data.id);
    const rerun = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(selected, "cancel-version-rerun"),
        )
      ).json(),
    );
    expect(rerun.data).toMatchObject({
      rerunOfJobId: created.data.id,
      runSequence: 2,
      state: "queued",
    });
    expect(rerun.data.id).not.toBe(created.data.id);
    expect(workflow.queuedRequests()).toHaveLength(1);
    expect(store.storedCounts()).toEqual({ artifacts: 0, jobs: 2 });
  });

  it("versions a new-key rerun after a failed exact-input run", async () => {
    const { app, store, workflow } = fixture({ failureStage: "compilation" });
    const selected = body("Failed then rerun");
    const first = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(selected, "failed-version-create"),
        )
      ).json(),
    );
    await expect(workflow.runNext()).resolves.toBe(true);
    const failed = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${first.data.id}`,
        )
      ).json(),
    );
    expect(failed.data.state).toBe("failed");

    const sameKey = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(selected, "failed-version-create"),
        )
      ).json(),
    );
    expect(sameKey.data.id).toBe(first.data.id);
    const rerun = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(selected, "failed-version-rerun"),
        )
      ).json(),
    );
    expect(rerun.data).toMatchObject({
      rerunOfJobId: first.data.id,
      runSequence: 2,
      state: "queued",
    });
    expect(store.storedCounts()).toEqual({ artifacts: 0, jobs: 2 });
  });

  it("keeps infrastructure-only export explicit and enforces tenant/retention boundaries", async () => {
    const { app, expireArtifact, workflow } = fixture({
      generationCoverage: coverage("infrastructure-only"),
    });
    const crossTenant = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs/solutionexport_missing",
      {},
      OTHER_TOKEN,
    );
    expect(crossTenant.status).toBe(404);
    const createdResponse = await authorized(
      app,
      "/v1/projects/project_main/solution-export-jobs",
      jsonPost(body(), "infra-export"),
    );
    const created = solutionExportJobResponseV1Schema.parse(
      await createdResponse.json(),
    );
    expect(created.data).toMatchObject({
      generationCoverage: { state: "infrastructure-only" },
      warnings: [{ code: "APPLICATION_CODE_REQUIRED" }],
    });
    await workflow.runNext();
    const completedResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-jobs/${created.data.id}`,
    );
    const completed = solutionExportJobResponseV1Schema.parse(
      await completedResponse.json(),
    );
    const artifactId = completed.data.artifact?.artifactId ?? "";
    expireArtifact();
    const artifactResponse = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}`,
    );
    const artifact = solutionExportArtifactResponseV1Schema.parse(
      await artifactResponse.json(),
    );
    expect(artifact.data.downloadAvailability).toEqual({
      expiredAt: RETENTION_EXPIRES,
      state: "expired",
    });
    const deniedGrant = await authorized(
      app,
      `/v1/projects/project_main/solution-export-artifacts/${artifactId}/download-grants`,
      jsonPost({ contractVersion: 1 }, "expired-grant"),
    );
    expect(deniedGrant.status).toBe(403);

    const sameKey = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(body(), "infra-export"),
        )
      ).json(),
    );
    expect(sameKey.data.id).toBe(created.data.id);
    expect(sameKey.data.runSequence).toBe(1);

    const rerun = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          "/v1/projects/project_main/solution-export-jobs",
          jsonPost(body(), "infra-export-after-expiry"),
        )
      ).json(),
    );
    expect(rerun.data).toMatchObject({
      rerunOfJobId: created.data.id,
      runSequence: 2,
      state: "queued",
    });
    expect(rerun.data.id).not.toBe(created.data.id);
    await expect(workflow.runNext()).resolves.toBe(true);
    const republished = solutionExportJobResponseV1Schema.parse(
      await (
        await authorized(
          app,
          `/v1/projects/project_main/solution-export-jobs/${rerun.data.id}`,
        )
      ).json(),
    );
    expect(republished.data.state).toBe("succeeded");
    expect(republished.data.artifact?.digest).toBe(
      completed.data.artifact?.digest,
    );
    expect(workflow.queuedRequests()).toHaveLength(0);
  });
});
