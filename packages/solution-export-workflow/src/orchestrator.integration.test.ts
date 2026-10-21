import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { applicationBuildResultV1Schema } from "@cloudmarkup/application-build-runner";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogArtifactV1,
} from "@cloudmarkup/provider-aws";
import { createDiagramIconSetV1 } from "@cloudmarkup/diagram-export";
import { createAwsDiagramIconRegistryTestInput } from "@cloudmarkup/provider-aws/testing/diagram-icon-registry";
import { generateApplication } from "@cloudmarkup/application-generator";
import {
  applicationGenerationResultV1Schema,
  applicationGenerationRequestV1Schema,
  architectureDocumentV3Schema,
  asyncJobRecordV1Schema,
  asyncJobObjectReferenceV1Schema,
  existingApplicationFileV1Schema,
  repositoryRelativePathSchema,
  serializeCanonicalJson,
  type AsyncJobCheckpointV1,
  type AsyncJobEvidenceReferenceV1,
  type EvidenceRecordV1,
} from "@cloudmarkup/schemas";
import {
  applicationBuildSupplementalFiles,
  decodeUtf8,
  localSolutionExportService,
  readDeterministicZip,
  solutionExportTerraformApplicationPackagePathV1Schema,
  sha256Digest,
  solutionExportRequestV1Schema,
  solutionExportSupplementalFileV1Schema,
  type SolutionExportExternalStageStatusV1,
} from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import { createSolutionExportApplicationGeneratorPort } from "./application-generator-adapter.js";
import {
  createSolutionExportDiagramRendererPort,
  diagramExportForSolutionExport,
} from "./diagram-renderer-adapter.js";
import {
  goCompilationResultV1Schema,
  goTargetArtifactDigest,
  goTargetArtifactV1Schema,
} from "./compiler-projection.js";
import { createTimerSolutionExportWorkflowCancellationPollPort } from "./cancellation.js";
import {
  solutionExportApplicationBuildBatchReportDigest,
  solutionExportApplicationBuildBatchResultV1Schema,
  solutionExportWorkflowFailureV1Schema,
  type SolutionExportApplicationBuildBatchResultV1,
} from "./contracts.js";
import {
  SolutionExportWorkflowFailureError,
  createSolutionExportWorkflowOrchestrator,
} from "./orchestrator.js";
import { passingBuildResult } from "./passing-build.test-support.js";
import type {
  SolutionExportWorkflowDependencies,
  SolutionExportWorkflowTrustedScopeV1,
} from "./ports.js";
import { terraformValidationEvidenceSupplementalFiles } from "./validation-evidence.js";
import {
  canonicalBytes,
  cancelledBuildResult,
  evidenceReference,
  multiWorkloadEventWorkflowFixture,
  failedBuildResult,
  validationResult,
  workflowFixture,
  type WorkflowFixture,
} from "./workflow.test-support.js";

const diagramIconRegistry = createAwsDiagramIconRegistryTestInput();
const diagramIconSet = createDiagramIconSetV1({
  assetsByFile: Object.fromEntries(
    Object.entries(diagramIconRegistry.assetSpecifiersByFile).map(
      ([file, specifier]) => [
        file,
        readFileSync(fileURLToPath(import.meta.resolve(specifier)), "utf8"),
      ],
    ),
  ),
  catalog: diagramIconRegistry.catalog,
  manifest: diagramIconRegistry.manifest,
});
const diagramRenderer = createSolutionExportDiagramRendererPort({
  catalog: diagramIconRegistry.catalog,
  iconSet: diagramIconSet,
});

const eventDiagramRenderer = createSolutionExportDiagramRendererPort({
  catalog: awsCatalogArtifactV1,
  iconSet: diagramIconSet,
});
interface HarnessOptions {
  readonly sourceDraft?: boolean;
  readonly buildBatchMutation?: (
    result: SolutionExportApplicationBuildBatchResultV1,
  ) => unknown;
  readonly buildFailure?: "unit" | "contract";
  readonly buildSuccess?: boolean;
  readonly buildCancelled?: boolean;
  readonly compilerCancelled?: boolean;
  readonly compilationMutation?: (
    compilation: WorkflowFixture["compilation"],
  ) => unknown;
  readonly corruptStageEvidence?: boolean;
  readonly latePersistenceCancellation?: boolean;
  readonly liveCompilerCancellation?: boolean;
  readonly longCompilerHeartbeat?: boolean;
  readonly noCheckpointExpected?: boolean;
  readonly fixture?: WorkflowFixture;
  readonly generatedOverride?: ReturnType<typeof generateApplication>;
  readonly substituteFinalEvidenceReference?: boolean;
  readonly validationEvidenceMismatch?: "environment" | "revision";
  readonly validationState?: "passed" | "failed" | "cancelled";
}

interface HarnessResult {
  readonly checkpointIdentities: readonly string[];
  readonly heartbeatCalls: number;
  readonly invocations: readonly string[];
  readonly orchestratorResult: Awaited<
    ReturnType<
      ReturnType<typeof createSolutionExportWorkflowOrchestrator>["run"]
    >
  >;
  readonly scopes: readonly SolutionExportWorkflowTrustedScopeV1[];
  readonly handoff: {
    readonly buildGenerationArtifactDigest?: string;
    readonly generatedApplicationArtifactDigest?: string;
    readonly packagedApplicationArtifactDigest?: string;
    readonly packagedBuildReportDigest?: string;
    readonly packagedDiagram?: unknown;
    readonly packagedExternalStageStatus?: SolutionExportExternalStageStatusV1;
    readonly packagedInfrastructureDigest?: string;
    readonly packagedSupplementalPaths?: readonly string[];
    readonly packagedValidationDigest?: string;
    readonly runnerSignalAborted?: boolean;
    readonly validationInfrastructureDigest?: string;
    readonly verifiedDiagram?: unknown;
    readonly verifiedRootReadme?: string;
    readonly verifiedManifestChecksums?: readonly string[];
    readonly verifiedExternalStageStatus?: SolutionExportExternalStageStatusV1;
    readonly verifiedManifestPaths?: readonly string[];
    readonly verifiedZipPaths?: readonly string[];
  };
}

function expectedExternalStageStatus(
  fixture: WorkflowFixture,
  validation: ReturnType<typeof validationResult>,
  build?:
    | ReturnType<typeof passingBuildResult>
    | readonly ReturnType<typeof passingBuildResult>[],
): SolutionExportExternalStageStatusV1 {
  const builds = applicationBuildResultV1Schema
    .array()
    .parse(build === undefined ? [] : Array.isArray(build) ? build : [build]);
  const singularBuild = builds.length === 1 ? builds[0] : undefined;
  const evidenceReference = (record: EvidenceRecordV1) => ({
    evidenceId: record.id,
    recordDigest: sha256Digest(serializeCanonicalJson(record)),
  });
  return {
    ...(builds.length === 0
      ? {}
      : {
          applicationBuild: {
            evidenceRecords: builds
              .map(({ evidence }) => evidenceReference(evidence))
              .sort((left, right) =>
                left.evidenceId < right.evidenceId
                  ? -1
                  : left.evidenceId > right.evidenceId
                    ? 1
                    : 0,
              ),
            reportDigest:
              singularBuild?.reportDigest ??
              solutionExportApplicationBuildBatchReportDigest(builds),
            state: "passed-before-export" as const,
          },
        }),
    environment: fixture.request.environment,
    targetSettingsDigest: fixture.request.targetSettings.digest,
    terraformValidation: {
      evidenceRecords: validation.evidenceRecords
        .map(evidenceReference)
        .sort((left, right) =>
          left.evidenceId < right.evidenceId
            ? -1
            : left.evidenceId > right.evidenceId
              ? 1
              : 0,
        ),
      reportDigest: validation.reportDigest,
      state: "passed-before-export",
    },
    workflowRequestDigest: sha256Digest(
      serializeCanonicalJson(fixture.request),
    ),
  };
}

async function runHarness(
  options: HarnessOptions = {},
): Promise<HarnessResult> {
  const fixture = options.fixture ?? workflowFixture();
  const invocations: string[] = [];
  const scopes: SolutionExportWorkflowTrustedScopeV1[] = [];
  const checkpointIdentities: string[] = [];
  const persistedEvidence: AsyncJobEvidenceReferenceV1[] = [];
  const handoff: {
    packagedInfrastructureDigest?: string;
    buildGenerationArtifactDigest?: string;
    generatedApplicationArtifactDigest?: string;
    packagedApplicationArtifactDigest?: string;
    packagedBuildReportDigest?: string;
    packagedDiagram?: unknown;
    packagedExternalStageStatus?: SolutionExportExternalStageStatusV1;
    packagedValidationDigest?: string;
    packagedSupplementalPaths?: readonly string[];
    runnerSignalAborted?: boolean;
    validationInfrastructureDigest?: string;
    verifiedManifestChecksums?: readonly string[];
    verifiedExternalStageStatus?: SolutionExportExternalStageStatusV1;
    verifiedManifestPaths?: readonly string[];
    verifiedDiagram?: unknown;
    verifiedRootReadme?: string;
    verifiedZipPaths?: readonly string[];
  } = {};
  let heartbeatCalls = 0;
  let compilerIsActive = false;
  let outputPersisted = false;
  let releaseLongCompiler: (() => void) | undefined;
  const applicationGenerator = createSolutionExportApplicationGeneratorPort();

  const dependencies: SolutionExportWorkflowDependencies = {
    ...(options.sourceDraft
      ? {
          applicationSourceDraft: {
            async generate(input) {
              await Promise.resolve();
              invocations.push("source-draft");
              return [
                "README.md",
                "workload/index.mjs",
                "workload/index.test.mjs",
                "workload/README.md",
              ].map((path) => {
                const content =
                  "Review-required synthetic source fixture: " + path;
                return solutionExportSupplementalFileV1Schema.parse({
                  path: "application/ai-drafts/" + path,
                  content: { encoding: "utf8", value: content },
                  checksum: sha256Digest(content),
                  semanticChecksum: sha256Digest(content),
                  kind: "regular-file",
                  mediaType: path.endsWith(".md")
                    ? "text/markdown"
                    : "text/javascript",
                  ownership: "ai-generated-review-required",
                  provenance: {
                    producer: {
                      id: "cloudmarkup.test.source-draft",
                      version: "1.0.0",
                      digest: sha256Digest("synthetic"),
                    },
                    solutionRevisionId:
                      input.request.subject.solutionRevisionId,
                    sourceReferences: [
                      {
                        kind: "solution-revision",
                        id: input.request.subject.solutionRevisionId,
                      },
                    ],
                  },
                });
              });
            },
          },
        }
      : {}),
    applicationBuilder: {
      async build(input) {
        await Promise.resolve();
        invocations.push("application-builder");
        expect(input.settings).toEqual(
          fixture.request.targetSettings.stageDescriptors.applicationBuild,
        );
        handoff.buildGenerationArtifactDigest = input.generation.artifactDigest;
        if (options.buildCancelled === true) {
          return cancelledBuildResult(fixture);
        }
        if (options.buildFailure !== undefined) {
          return failedBuildResult(fixture, options.buildFailure);
        }
        if (options.buildSuccess === true) {
          const requests = fixture.applicationBuildRequests;
          if (requests !== undefined && requests.length > 1) {
            const results = requests.map((request) =>
              passingBuildResult(fixture, input.generation, request),
            );
            const batch =
              solutionExportApplicationBuildBatchResultV1Schema.parse({
                contractVersion: 1,
                kind: "cloudmarkup.application-build-batch-result",
                reportDigest:
                  solutionExportApplicationBuildBatchReportDigest(results),
                results,
              });
            return options.buildBatchMutation?.(batch) ?? batch;
          }
          return passingBuildResult(fixture, input.generation, requests?.[0]);
        }
        throw new Error("Unexpected build invocation in this fixture.");
      },
    },
    applicationGenerator: {
      async generate(input) {
        await Promise.resolve();
        invocations.push("application-generator");
        expect(input.settings).toEqual(
          fixture.request.targetSettings.stageDescriptors.applicationGenerator,
        );
        const generatedFromHandoff = await applicationGenerator.generate(input);
        const generated = applicationGenerationResultV1Schema.parse(
          options.generatedOverride ?? generatedFromHandoff,
        );
        handoff.generatedApplicationArtifactDigest = generated.artifactDigest;
        return generated;
      },
    },
    cancellation: createTimerSolutionExportWorkflowCancellationPollPort(1),
    clock: { now: () => new Date("2026-08-18T12:00:00.000Z") },
    compiler: {
      async compile(input) {
        await Promise.resolve();
        invocations.push("compiler");
        expect(input.request).toEqual(fixture.request);
        expect(input.settings).toEqual(
          fixture.request.targetSettings.stageDescriptors.compiler,
        );
        if (options.compilerCancelled === true) {
          throw new SolutionExportWorkflowFailureError(
            solutionExportWorkflowFailureV1Schema.parse({
              classification: "permanent",
              code: "cloudmarkup.export.compiler-canceled",
              publicMessage: "export-compile-failed",
              stage: "compile-infrastructure",
            }),
          );
        }
        if (options.liveCompilerCancellation === true) {
          compilerIsActive = true;
          return new Promise((_resolve, reject) => {
            input.signal.addEventListener(
              "abort",
              () => {
                handoff.runnerSignalAborted = true;
                const error = new Error("compiler canceled");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          });
        }
        expect(input.sources.architectureDocument).toEqual(
          fixture.generationRequest.architectureDocument,
        );
        expect(input.sources.solutionRevision).toEqual(
          fixture.generationRequest.solutionRevision,
        );
        expect(input.sources.workloadBehavior).toEqual(
          fixture.generationRequest.workloadBehavior,
        );
        if (options.longCompilerHeartbeat === true) {
          return new Promise((resolve) => {
            releaseLongCompiler = () => {
              releaseLongCompiler = undefined;
              resolve(fixture.compilation);
            };
          });
        }
        return (
          options.compilationMutation?.(fixture.compilation) ??
          fixture.compilation
        );
      },
    },
    diagramRenderer: {
      async render(input) {
        invocations.push("diagram-renderer");
        expect(input.settings).toEqual(
          fixture.request.targetSettings.stageDescriptors.diagramRenderer,
        );
        const architectureDocument = architectureDocumentV3Schema.parse(
          input.sources.architectureDocument,
        );
        const renderer =
          architectureDocument.catalog.digest === AWS_CATALOG_DIGEST_V1
            ? eventDiagramRenderer
            : diagramRenderer;
        return renderer.render(input);
      },
    },
    diff: {
      async compare(input) {
        await Promise.resolve();
        invocations.push("diff");
        scopes.push(input.scope);
        return {
          contractVersion: 1,
          currentDigest: input.current.zipDigest,
          entries: [],
          state: "no-baseline",
        };
      },
    },
    objects: {
      async load(input) {
        await Promise.resolve();
        scopes.push(input.scope);
        const value = fixture.objects.get(input.reference.objectId);
        if (value === undefined) {
          throw new Error(
            `Missing object fixture ${input.reference.objectId}.`,
          );
        }
        return value;
      },
      async persistStageReport(input) {
        await Promise.resolve();
        invocations.push(`persist:${input.stage}`);
        scopes.push(input.scope);
        const bytes = canonicalBytes(input.report);
        const isBuild = input.stage === "build-application";
        const isCloudFormationValidation =
          !isBuild &&
          typeof input.report === "object" &&
          input.report !== null &&
          "target" in input.report &&
          input.report.target === "cloudformation";
        let references = input.evidenceRecords.map((record) =>
          evidenceReference(record, fixture.request.environment),
        );
        if (
          options.corruptStageEvidence === true &&
          references[0] !== undefined
        ) {
          references = [
            {
              ...references[0],
              record: {
                ...references[0].record,
                digest: sha256Digest("forged-evidence-record"),
              },
            },
          ];
        }
        persistedEvidence.push(...references);
        return {
          artifact: {
            artifactId: `artifact.report.${input.stage}`,
            digest: input.digest,
            kind: isBuild
              ? "application-build-report"
              : isCloudFormationValidation
                ? "cloudformation-validation-report"
                : "terraform-validation-report",
            mediaType: "application/json",
            object: {
              contractVersion: 1,
              digest: input.digest,
              mediaType: "application/json",
              objectId: `object.report.${input.stage}`,
              purpose: isBuild ? "build-output" : "validation-report",
              sizeBytes: bytes.byteLength,
            },
            sizeBytes: bytes.byteLength,
          },
          evidenceRecords: references,
          stage: input.stage,
        };
      },
      async persistVerifiedOutput(input) {
        await Promise.resolve();
        invocations.push("persist-output");
        scopes.push(input.scope);
        checkpointIdentities.push(input.checkpointIdentity);
        const verifiedExternalStageStatus =
          input.artifact.manifest.status.externalStages;
        if (verifiedExternalStageStatus !== undefined) {
          handoff.verifiedExternalStageStatus = verifiedExternalStageStatus;
        }
        handoff.verifiedManifestChecksums = input.artifact.manifest.files.map(
          ({ checksum }) => checksum,
        );
        handoff.verifiedManifestPaths = input.artifact.manifest.files.map(
          ({ path }) => path,
        );
        handoff.verifiedDiagram = input.artifact.manifest.diagram;
        const zipEntries = readDeterministicZip(input.artifact.zipBytes);
        handoff.verifiedZipPaths = zipEntries.map(({ path }) => path);
        const rootReadme = zipEntries.find(({ path }) => path === "README.md");
        if (rootReadme !== undefined) {
          handoff.verifiedRootReadme = decodeUtf8(rootReadme.bytes);
        }
        const object = {
          contractVersion: 1 as const,
          digest: input.artifact.zipDigest,
          mediaType: "application/zip",
          objectId: "object.export-package.1",
          purpose: "export-package" as const,
          sizeBytes: input.artifact.zipBytes.byteLength,
        };
        const artifactId = "artifact.export-package.1";
        const finalEvidence = persistedEvidence.map((reference, index) =>
          options.substituteFinalEvidenceReference === true && index === 0
            ? {
                ...reference,
                record: {
                  ...reference.record,
                  objectId: "object.substituted-evidence-record",
                },
              }
            : reference,
        );
        outputPersisted = true;
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
          evidenceRecords: finalEvidence,
          verifiedPackage: {
            artifactId,
            availability: { state: "available" },
            object,
          },
        };
      },
      async saveCheckpoint(input) {
        await Promise.resolve();
        scopes.push(input.scope);
        const bytes = canonicalBytes(input.checkpoint);
        return asyncJobObjectReferenceV1Schema.parse({
          contractVersion: 1,
          digest: sha256Digest(bytes),
          mediaType: "application/json",
          objectId: `object.checkpoint.${input.checkpoint.checkpointIdentity.slice(7, 19)}`,
          purpose: "checkpoint-state",
          sizeBytes: bytes.byteLength,
        });
      },
      async saveReadModel(input) {
        await Promise.resolve();
        invocations.push("save-read-model");
        scopes.push(input.scope);
      },
    },
    packager: {
      async package(input) {
        await Promise.resolve();
        invocations.push("packager");
        expect(input.settings).toEqual(
          fixture.request.targetSettings.stageDescriptors.exporter,
        );
        if (input.application !== undefined) {
          handoff.packagedApplicationArtifactDigest =
            input.application.artifactDigest;
        }
        if (input.build !== undefined) {
          handoff.packagedBuildReportDigest = input.build.reportDigest;
        } else if (input.builds.length > 1) {
          const reportDigest =
            input.externalStageStatus.applicationBuild?.reportDigest;
          if (reportDigest === undefined) {
            throw new TypeError(
              "Multi-build packaging requires an aggregate build report.",
            );
          }
          handoff.packagedBuildReportDigest = reportDigest;
        }
        handoff.packagedDiagram = input.diagram.artifact;
        handoff.packagedExternalStageStatus = input.externalStageStatus;
        handoff.packagedInfrastructureDigest =
          input.infrastructure.artifactDigest;
        handoff.packagedSupplementalPaths = input.supplementalFiles.map(
          ({ path }) => path,
        );
        handoff.packagedValidationDigest = input.validation.reportDigest;
        const packaged = localSolutionExportService.generate(
          solutionExportRequestV1Schema.parse({
            ...(input.application === undefined
              ? {}
              : { application: input.application }),
            architectureDocument: input.sources.architectureDocument,
            contractVersion: 1,
            existingFiles: [],
            externalStageStatus: input.externalStageStatus,
            infrastructure: input.infrastructure,
            diagram: diagramExportForSolutionExport(input.diagram),
            solutionRevision: input.sources.solutionRevision,
            supplementalFiles: input.supplementalFiles,
            target: {
              exportName: input.request.exportName,
              limits: input.request.targetSettings.limits,
              policyPacks: input.request.targetSettings.policyPacks,
              renderer: input.request.targetSettings.renderer,
              target: input.request.targetSettings.target,
            },
          }),
        );
        return packaged;
      },
    },
    terraformValidator: {
      async validate(input) {
        await Promise.resolve();
        invocations.push("terraform-validator");
        if (fixture.request.targetSettings.target !== "terraform") {
          throw new TypeError(
            "CloudFormation validation must not invoke the Terraform validator.",
          );
        }
        expect(input.settings).toEqual(
          fixture.request.targetSettings.stageDescriptors.terraformValidation,
        );
        handoff.validationInfrastructureDigest =
          input.infrastructure.artifactDigest;
        const validation = validationResult(
          fixture,
          options.validationState ?? "passed",
        );
        const evidence = validation.evidenceRecords[0];
        if (
          options.validationEvidenceMismatch === undefined ||
          evidence === undefined
        ) {
          return validation;
        }
        return {
          ...validation,
          evidenceRecords: [
            {
              ...evidence,
              ...(options.validationEvidenceMismatch === "revision"
                ? { solutionRevisionId: "solution-revision.foreign" }
                : {
                    environment: {
                      ...evidence.environment,
                      environmentType: "staging" as const,
                    },
                  }),
            },
          ],
        };
      },
    },
  };
  const contextSavedCheckpoints: AsyncJobCheckpointV1[] = [];
  const context = {
    attemptNumber: 1,
    checkpoint: undefined,
    correlationId: fixture.record.correlationId,
    jobId: fixture.record.jobId,
    ownership: fixture.record.ownership,
    async heartbeat() {
      await Promise.resolve();
      heartbeatCalls += 1;
      if (heartbeatCalls >= 3) releaseLongCompiler?.();
    },
    async isCancellationRequested() {
      await Promise.resolve();
      return (
        (options.liveCompilerCancellation === true && compilerIsActive) ||
        (options.latePersistenceCancellation === true && outputPersisted)
      );
    },
    async reportProgress() {
      await Promise.resolve();
    },
    async saveCheckpoint(checkpoint: AsyncJobCheckpointV1) {
      await Promise.resolve();
      contextSavedCheckpoints.push(checkpoint);
    },
  };
  const orchestratorResult = await createSolutionExportWorkflowOrchestrator(
    dependencies,
  ).run(fixture.record, context);
  expect(contextSavedCheckpoints).toHaveLength(
    options.noCheckpointExpected === true ? 0 : 1,
  );
  return {
    checkpointIdentities,
    handoff,
    heartbeatCalls,
    invocations,
    orchestratorResult,
    scopes,
  };
}

describe("solution export workflow orchestration", () => {
  it("runs an infrastructure-only export in exact order with exact handoffs", async () => {
    const fixture = workflowFixture();
    const expectedValidation = validationResult(fixture);
    const expectedValidationFiles =
      terraformValidationEvidenceSupplementalFiles(
        expectedValidation.evidenceRecords,
      );
    const expectedValidationPaths = expectedValidationFiles.map(
      ({ path }) => path,
    );
    const result = await runHarness({ fixture });
    const expectedScope = {
      jobId: fixture.record.jobId,
      ownership: fixture.record.ownership,
    };

    expect(result.orchestratorResult.outcome.outcome).toBe("succeeded");
    expect(result.invocations).toEqual([
      "compiler",
      "terraform-validator",
      "persist:validate-infrastructure",
      "diagram-renderer",
      "packager",
      "diff",
      "persist-output",
      "save-read-model",
    ]);
    expect(result.handoff.validationInfrastructureDigest).toBe(
      result.handoff.packagedInfrastructureDigest,
    );
    expect(result.handoff.packagedValidationDigest).toBe(
      expectedValidation.reportDigest,
    );
    const expectedStatus = expectedExternalStageStatus(
      fixture,
      expectedValidation,
    );
    expect(result.handoff.packagedExternalStageStatus).toEqual(expectedStatus);
    expect(result.handoff.verifiedExternalStageStatus).toEqual(expectedStatus);
    expect(result.handoff.verifiedManifestPaths).toEqual(
      expect.arrayContaining([
        "cloudmarkup/validation/status.json",
        "evidence/status.json",
      ]),
    );
    expect(result.handoff.packagedSupplementalPaths).toEqual(
      expectedValidationPaths,
    );
    expect(result.handoff.verifiedManifestPaths).toEqual(
      expect.arrayContaining(expectedValidationPaths),
    );
    expect(result.handoff.verifiedZipPaths).toEqual(
      expect.arrayContaining(expectedValidationPaths),
    );
    expect(result.handoff.verifiedZipPaths).toEqual(
      expect.arrayContaining([
        "diagram/README.md",
        "diagram/architecture.png",
        "diagram/architecture.svg",
      ]),
    );
    expect(result.handoff.verifiedDiagram).toEqual(
      result.handoff.packagedDiagram,
    );
    expect(result.handoff.verifiedRootReadme).toContain(
      "![Immutable architecture diagram](diagram/architecture.svg)",
    );
    expect(result.handoff.verifiedRootReadme).not.toMatch(
      /(?:[A-Za-z]:\\|file:\/\/|https?:\/\/)/iu,
    );
    expect(result.handoff.verifiedManifestChecksums).toEqual(
      expect.arrayContaining(
        expectedValidation.evidenceRecords.map((record) =>
          sha256Digest(serializeCanonicalJson(record)),
        ),
      ),
    );
    expect(result.scopes.length).toBeGreaterThan(0);
    expect(
      result.scopes.every(
        (scope) =>
          serializeCanonicalJson(scope) ===
          serializeCanonicalJson(expectedScope),
      ),
    ).toBe(true);
    expect(result.orchestratorResult.readModel).not.toHaveProperty(
      "applicationVerification",
    );
    expect(result.orchestratorResult.readModel).toMatchObject({
      downloadPolicy: { state: "eligible" },
      state: "succeeded",
      warnings: ["application-code-required"],
    });
  });

  it("rejects a job target-settings digest that does not bind the durable request", async () => {
    const fixture = workflowFixture();
    const input = {
      ...fixture.record.input,
      targetSettingsDigest: sha256Digest("foreign-approved-settings"),
    };
    const record = asyncJobRecordV1Schema.parse({
      ...fixture.record,
      input,
      inputDigest: sha256Digest(serializeCanonicalJson(input)),
      inputSizeBytes: canonicalBytes(input).byteLength,
    });

    const result = await runHarness({
      fixture: { ...fixture, record },
      noCheckpointExpected: true,
    });

    expect(result.orchestratorResult.outcome.outcome).toBe("failed");
    expect(result.invocations).toEqual(["save-read-model"]);
    expect(result.orchestratorResult.readModel).toMatchObject({
      downloadPolicy: { reason: "stage-failed", state: "blocked" },
      failure: {
        code: "cloudmarkup.export.request-binding-invalid",
        stage: "resolve-request",
      },
      state: "failed",
      targetSettingsDigest: fixture.request.targetSettings.digest,
    });
    expect(result.orchestratorResult.persistedOutput).toBeUndefined();
  });

  it("runs the complete supported path through isolated build and verified publication", async () => {
    const fixture = workflowFixture("complete-supported-pattern");
    const expectedGeneration = generateApplication(fixture.generationRequest);
    const expectedBuild = passingBuildResult(fixture, expectedGeneration);
    const expectedValidation = validationResult(fixture);
    const expectedSupplementalFiles = [
      ...applicationBuildSupplementalFiles(expectedBuild),
      ...terraformValidationEvidenceSupplementalFiles(
        expectedValidation.evidenceRecords,
      ),
    ];
    const expectedSupplementalPaths = expectedSupplementalFiles.map(
      ({ path }) => path,
    );
    const expectedEvidenceRecords = [
      expectedBuild.evidence,
      ...expectedValidation.evidenceRecords,
    ];
    const result = await runHarness({ buildSuccess: true, fixture });

    expect(
      fixture.compilation.artifact?.applicationArtifacts?.map(
        ({ implementationMode }) => implementationMode,
      ),
    ).toEqual(["complete-supported-pattern"]);
    expect(result.orchestratorResult.outcome.outcome).toBe("succeeded");
    expect(result.invocations).toEqual([
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
    expect(result.handoff.generatedApplicationArtifactDigest).toBe(
      expectedGeneration.artifactDigest,
    );
    expect(result.handoff.buildGenerationArtifactDigest).toBe(
      expectedGeneration.artifactDigest,
    );
    expect(result.handoff.packagedApplicationArtifactDigest).toBe(
      expectedGeneration.artifactDigest,
    );
    expect(result.handoff.packagedBuildReportDigest).toBe(
      expectedBuild.reportDigest,
    );
    const expectedStatus = expectedExternalStageStatus(
      fixture,
      expectedValidation,
      expectedBuild,
    );
    expect(result.handoff.packagedExternalStageStatus).toEqual(expectedStatus);
    expect(result.handoff.verifiedExternalStageStatus).toEqual(expectedStatus);
    expect(result.handoff.verifiedManifestPaths).toEqual(
      expect.arrayContaining([
        "cloudmarkup/application-build/status.json",
        "cloudmarkup/validation/status.json",
        "evidence/status.json",
      ]),
    );
    expect(result.handoff.packagedSupplementalPaths).toEqual(
      expectedSupplementalPaths,
    );
    expect(result.handoff.verifiedManifestPaths).toEqual(
      expect.arrayContaining(expectedSupplementalPaths),
    );
    expect(result.handoff.verifiedManifestChecksums).toEqual(
      expect.arrayContaining(
        expectedEvidenceRecords.map((record) =>
          sha256Digest(serializeCanonicalJson(record)),
        ),
      ),
    );
    expect(result.handoff.verifiedZipPaths).toEqual(
      expect.arrayContaining(expectedSupplementalPaths),
    );
    expect(result.handoff.validationInfrastructureDigest).toBe(
      result.handoff.packagedInfrastructureDigest,
    );
    expect(result.handoff.packagedValidationDigest).toBe(
      expectedValidation.reportDigest,
    );
    const readModel = result.orchestratorResult.readModel;
    expect(readModel?.applicationVerification).toEqual(expectedBuild.coverage);
    expect(
      readModel?.evidenceRecords.map(({ evidenceId }) => evidenceId),
    ).toEqual(expectedEvidenceRecords.map(({ id }) => id));
    expect(readModel?.stageReports.map(({ stage }) => stage)).toEqual([
      "build-application",
      "validate-infrastructure",
    ]);
    expect(
      readModel?.stages.map(({ stage, state }) => ({ stage, state })),
    ).toEqual([
      { stage: "resolve-request", state: "succeeded" },
      { stage: "compile-infrastructure", state: "succeeded" },
      { stage: "generate-application", state: "succeeded" },
      { stage: "build-application", state: "succeeded" },
      { stage: "validate-infrastructure", state: "succeeded" },
      { stage: "render-diagram", state: "succeeded" },
      { stage: "package-export", state: "succeeded" },
      { stage: "verify-export", state: "succeeded" },
      { stage: "compare-export", state: "succeeded" },
      { stage: "persist-output", state: "succeeded" },
    ]);
    expect(readModel?.downloadPolicy.state).toBe("eligible");
    expect(readModel?.artifact?.kind).toBe("export-package");
    expect(readModel?.warnings).toEqual([]);
  });

  it("validates CloudFormation structurally without invoking Terraform", async () => {
    const fixture = workflowFixture("infrastructure-only", "cloudformation");
    const result = await runHarness({ fixture });

    expect(result.orchestratorResult.outcome.outcome).toBe("succeeded");
    expect(result.invocations).toEqual([
      "compiler",
      "persist:validate-infrastructure",
      "diagram-renderer",
      "packager",
      "diff",
      "persist-output",
      "save-read-model",
    ]);
    expect(result.handoff.validationInfrastructureDigest).toBeUndefined();
    expect(result.handoff.packagedExternalStageStatus).toHaveProperty(
      "cloudFormationValidation",
    );
    expect(result.handoff.packagedExternalStageStatus).not.toHaveProperty(
      "terraformValidation",
    );
    expect(result.handoff.verifiedExternalStageStatus).toEqual(
      result.handoff.packagedExternalStageStatus,
    );
    expect(result.handoff.packagedSupplementalPaths).toEqual([
      expect.stringMatching(
        /^evidence\/cloudformation-validation\/evidence-.+\.json$/u,
      ),
    ]);
    expect(result.handoff.verifiedManifestPaths).toEqual(
      expect.arrayContaining([
        "infrastructure/template.json",
        "cloudmarkup/validation/status.json",
        ...(result.handoff.packagedSupplementalPaths ?? []),
      ]),
    );
    expect(
      result.orchestratorResult.readModel?.evidenceSemantics.map(
        ({ kind }) => kind,
      ),
    ).toEqual(["cloudformation-validation"]);
    expect(
      result.orchestratorResult.readModel?.stageReports[0]?.artifact.kind,
    ).toBe("cloudformation-validation-report");
  });
  it("runs a generated starter through its exact admitted build request", async () => {
    const fixture = workflowFixture("generated-starter");
    const expectedGeneration = generateApplication(fixture.generationRequest);
    const expectedBuild = passingBuildResult(fixture, expectedGeneration);
    const result = await runHarness({ buildSuccess: true, fixture });

    expect(result.orchestratorResult.outcome.outcome).toBe("succeeded");
    expect(result.invocations).toEqual([
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
    expect(
      result.orchestratorResult.readModel?.applicationVerification,
    ).toEqual(expectedBuild.coverage);
    expect(
      result.orchestratorResult.readModel?.applicationVerification,
    ).toMatchObject({
      confirmedState: "starter-application",
      inputState: "starter-application",
    });
    expect(result.orchestratorResult.readModel?.warnings).toEqual([]);
  });

  it("publishes the canonical two-workload build batch with every artifact, Evidence record, and verification", async () => {
    const fixture = multiWorkloadEventWorkflowFixture();
    const generation = generateApplication(fixture.generationRequest);
    const requests = fixture.applicationBuildRequests;
    if (requests?.length !== 2) {
      throw new TypeError("Multi-workload integration requires two requests.");
    }
    const builds = requests.map((request) =>
      passingBuildResult(fixture, generation, request),
    );
    const validation = validationResult(fixture);
    const expectedSupplementalPaths = [
      ...builds.flatMap((build) => applicationBuildSupplementalFiles(build)),
      ...terraformValidationEvidenceSupplementalFiles(
        validation.evidenceRecords,
      ),
    ].map(({ path }) => path);
    const expectedEvidenceIds = [
      ...builds.map(({ evidence }) => evidence.id),
      ...validation.evidenceRecords.map(({ id }) => id),
    ].sort();

    const result = await runHarness({ buildSuccess: true, fixture });
    expect(result.orchestratorResult.readModel?.failure).toBeUndefined();

    expect(result.orchestratorResult.outcome.outcome).toBe("succeeded");
    expect(result.invocations).toEqual([
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
    expect(result.handoff.packagedBuildReportDigest).toBe(
      solutionExportApplicationBuildBatchReportDigest(builds),
    );
    expect(result.handoff.packagedSupplementalPaths).toEqual(
      expectedSupplementalPaths,
    );
    expect(result.handoff.verifiedZipPaths).toEqual(
      expect.arrayContaining(expectedSupplementalPaths),
    );
    const expectedStatus = expectedExternalStageStatus(
      fixture,
      validation,
      builds,
    );
    expect(result.handoff.packagedExternalStageStatus).toEqual(expectedStatus);
    expect(result.handoff.verifiedExternalStageStatus).toEqual(expectedStatus);
    const readModel = result.orchestratorResult.readModel;
    expect(readModel?.applicationVerification).toBeUndefined();
    expect(readModel?.applicationVerifications).toEqual(
      builds.map(({ coverage }) => coverage),
    );
    expect(
      readModel?.evidenceRecords.map(({ evidenceId }) => evidenceId),
    ).toEqual(expectedEvidenceIds);
    expect(
      readModel?.stageReports
        .find(({ stage }) => stage === "build-application")
        ?.evidenceRecords.map(({ evidenceId }) => evidenceId),
    ).toEqual(builds.map(({ evidence }) => evidence.id));
    expect(result.orchestratorResult.persistedOutput).toBeDefined();
    expect(readModel?.downloadPolicy.state).toBe("eligible");
  });

  it("fails atomically when compiler target metadata references a different generated ZIP", async () => {
    const fixture = multiWorkloadEventWorkflowFixture();
    const result = await runHarness({
      buildSuccess: true,
      compilationMutation(compilation) {
        const artifact = compilation.artifact;
        const applicationArtifacts = artifact?.applicationArtifacts;
        const first = applicationArtifacts?.[0];
        if (
          artifact === undefined ||
          applicationArtifacts === null ||
          applicationArtifacts === undefined ||
          first?.contractVersion !== 2
        ) {
          throw new TypeError(
            "Artifact-binding mismatch test requires v2 compiler metadata.",
          );
        }
        const alternateWorkloadId = "workload_attacker";
        const alternateArtifactPath = `application/artifacts/${alternateWorkloadId}/function.zip`;
        const mutatedApplications = applicationArtifacts.map(
          (application, index) =>
            index === 0 && application.contractVersion === 2
              ? {
                  ...application,
                  expectedArtifact: {
                    ...application.expectedArtifact,
                    artifactId: `artifact_${alternateWorkloadId}`,
                    path: repositoryRelativePathSchema.parse(
                      alternateArtifactPath,
                    ),
                  },
                  relativePackagePath:
                    solutionExportTerraformApplicationPackagePathV1Schema.parse(
                      `../${alternateArtifactPath}`,
                    ),
                  workloadId: alternateWorkloadId,
                }
              : application,
        );
        const provisional = {
          ...artifact,
          applicationArtifacts: mutatedApplications,
          digest: sha256Digest("provisional-mismatched-application-artifact"),
        };
        const mutatedArtifact = goTargetArtifactV1Schema.parse({
          ...provisional,
          digest: goTargetArtifactDigest(provisional),
        });
        return goCompilationResultV1Schema.parse({
          ...compilation,
          artifact: mutatedArtifact,
        });
      },
      fixture,
    });

    expect(result.orchestratorResult.outcome.outcome).toBe("failed");
    expect(result.orchestratorResult.readModel?.failure).toMatchObject({
      code: "cloudmarkup.export.application-artifact-binding-mismatch",
      stage: "generate-application",
    });
    expect(result.invocations).toEqual([
      "compiler",
      "application-generator",
      "save-read-model",
    ]);
    expect(result.orchestratorResult.persistedOutput).toBeUndefined();
  });

  it.each([
    {
      expectedCode: "cloudmarkup.export.build-result-binding-invalid",
      name: "missing result",
      mutate: (batch: SolutionExportApplicationBuildBatchResultV1) => {
        const results = batch.results.slice(0, 1);
        return {
          ...batch,
          reportDigest:
            solutionExportApplicationBuildBatchReportDigest(results),
          results,
        };
      },
    },
    {
      expectedCode: "cloudmarkup.export.build-result-invalid",
      name: "reordered results",
      mutate: (batch: SolutionExportApplicationBuildBatchResultV1) => {
        const results = [...batch.results].reverse();
        return {
          ...batch,
          reportDigest:
            solutionExportApplicationBuildBatchReportDigest(results),
          results,
        };
      },
    },
    {
      expectedCode: "cloudmarkup.export.build-result-invalid",
      name: "duplicate workload, Evidence, and artifact collision",
      mutate: (batch: SolutionExportApplicationBuildBatchResultV1) => {
        const first = batch.results[0];
        const results = first === undefined ? [] : [first, first];
        return {
          ...batch,
          reportDigest:
            solutionExportApplicationBuildBatchReportDigest(results),
          results,
        };
      },
    },
  ])(
    "fails the whole build stage for a $name",
    async ({ expectedCode, mutate }) => {
      const fixture = multiWorkloadEventWorkflowFixture();
      const result = await runHarness({
        buildBatchMutation: mutate,
        buildSuccess: true,
        fixture,
      });

      expect(result.orchestratorResult.outcome.outcome).toBe("failed");
      expect(result.invocations).toEqual([
        "compiler",
        "application-generator",
        "application-builder",
        "save-read-model",
      ]);
      expect(result.orchestratorResult.readModel?.failure).toMatchObject({
        code: expectedCode,
        stage: "build-application",
      });
      expect(result.orchestratorResult.readModel?.evidenceRecords).toEqual([]);
      expect(result.orchestratorResult.persistedOutput).toBeUndefined();
    },
  );

  it("is reproducible across retries that restart from immutable input", async () => {
    const first = await runHarness();
    const retry = await runHarness();

    expect(retry.orchestratorResult.persistedOutput).toEqual(
      first.orchestratorResult.persistedOutput,
    );
    expect(retry.orchestratorResult.readModel).toEqual(
      first.orchestratorResult.readModel,
    );
    expect(retry.checkpointIdentities).toEqual(first.checkpointIdentities);
  });

  it.each(["unit", "contract"] as const)(
    "retains failed %s-test Evidence and explicit coverage downgrade while blocking download",
    async (testKind) => {
      const fixture = workflowFixture("complete-supported-pattern");
      const result = await runHarness({ buildFailure: testKind, fixture });
      const serialized = JSON.stringify(result.orchestratorResult.readModel);

      expect(result.orchestratorResult.outcome.outcome).toBe("failed");
      expect(result.invocations).toEqual([
        "compiler",
        "application-generator",
        "application-builder",
        "persist:build-application",
        "save-read-model",
      ]);
      const readModel = result.orchestratorResult.readModel;
      expect(readModel?.applicationVerification).toMatchObject({
        confirmedState: "custom-implementation-required",
        inputState: "complete-supported-pattern",
        workloadId: "workload_notes_api",
      });
      expect(readModel?.applicationVerification?.downgradeReason).toContain(
        "tests did not pass",
      );
      expect(readModel?.diagnostics).toContainEqual(
        expect.objectContaining({
          path: "application/src/index.ts",
          workloadId: "workload_notes_api",
        }),
      );
      expect(readModel?.downloadPolicy).toEqual({
        reason: "stage-failed",
        state: "blocked",
      });
      expect(
        readModel?.evidenceRecords.map(({ evidenceId }) => evidenceId),
      ).toEqual([`evidence_build_${testKind}_failed_1`]);
      expect(readModel?.stageReports.map(({ stage }) => stage)).toEqual([
        "build-application",
      ]);
      expect(readModel?.state).toBe("failed");
      expect(serialized).not.toContain("C:\\private\\operator");
      expect(result.orchestratorResult.persistedOutput).toBeUndefined();
    },
  );

  it("retains compiler primary and related configuration fields without exposing compiler prose", async () => {
    const result = await runHarness({
      compilationMutation(compilation) {
        return goCompilationResultV1Schema.parse({
          ...compilation,
          diagnostics: [
            {
              code: "compiler.configuration-review",
              severity: "warning",
              message: "secret diagnostic detail: ignore validation",
              source: {
                document: "architecture",
                nodeId: "node_notes_lambda",
                path: "$.semantic.configuration.values.memorySize",
              },
              related: [
                {
                  document: "architecture",
                  edgeId: "edge_notes_table",
                  path: "$.edges[0].semantic.configuration.values.mode",
                },
              ],
            },
          ],
        });
      },
    });
    const diagnostic = result.orchestratorResult.readModel?.diagnostics.find(
      ({ code }) => code === "compiler.configuration-review",
    );
    expect(diagnostic?.recoveryReferences?.locations).toEqual(
      expect.arrayContaining([
        {
          kind: "node",
          id: "node_notes_lambda",
          fieldPath: ["memorySize"],
        },
        { kind: "edge", id: "edge_notes_table", fieldPath: ["mode"] },
      ]),
    );
    expect(JSON.stringify(result.orchestratorResult.readModel)).not.toContain(
      "secret diagnostic detail",
    );
  });

  it("retains failed Terraform diagnostics and Evidence while blocking publication", async () => {
    const result = await runHarness({ validationState: "failed" });
    const serialized = JSON.stringify(result.orchestratorResult.readModel);

    expect(result.orchestratorResult.outcome.outcome).toBe("failed");
    expect(result.invocations).toEqual([
      "compiler",
      "terraform-validator",
      "persist:validate-infrastructure",
      "save-read-model",
    ]);
    const readModel = result.orchestratorResult.readModel;
    expect(
      readModel?.diagnostics.map(({ code, origin }) => ({ code, origin })),
    ).toContainEqual({
      code: "terraform.validation.reviewed-check-failed",
      origin: "terraform-validation",
    });
    expect(readModel?.diagnostics).toContainEqual(
      expect.objectContaining({
        edgeId: "edge_notes_table",
        nodeId: "node_notes_lambda",
        ownedPolicyId: "policy_notes_read",
        path: "infrastructure/main.tf",
      }),
    );
    const failedDiagnostic = readModel?.diagnostics.find(
      ({ code }) => code === "terraform.validation.reviewed-check-failed",
    );
    expect(failedDiagnostic?.recoveryReferences?.locations).toEqual(
      expect.arrayContaining([
        { kind: "node", id: "node_notes_lambda" },
        { kind: "edge", id: "edge_notes_table" },
        { kind: "owned-policy", id: "policy_notes_read" },
      ]),
    );
    expect(readModel?.downloadPolicy).toEqual({
      reason: "stage-failed",
      state: "blocked",
    });
    expect(
      readModel?.evidenceRecords.map(({ evidenceId }) => evidenceId),
    ).toEqual(["evidence_terraform_validation_failed_1"]);
    expect(readModel?.stageReports.map(({ stage }) => stage)).toEqual([
      "validate-infrastructure",
    ]);
    expect(readModel?.state).toBe("failed");
    expect(serialized).not.toContain("secret diagnostic detail");
    expect(result.orchestratorResult.persistedOutput).toBeUndefined();
  });

  it.each(["environment", "revision"] as const)(
    "rejects foreign validation Evidence %s before object persistence",
    async (validationEvidenceMismatch) => {
      const result = await runHarness({ validationEvidenceMismatch });

      expect(result.orchestratorResult.outcome.outcome).toBe("failed");
      expect(result.invocations).toEqual([
        "compiler",
        "terraform-validator",
        "save-read-model",
      ]);
      expect(result.orchestratorResult.readModel).toMatchObject({
        evidenceRecords: [],
        failure: {
          code: "cloudmarkup.export.evidence-input-binding-invalid",
          stage: "validate-infrastructure",
        },
        stageReports: [],
      });
      expect(result.orchestratorResult.persistedOutput).toBeUndefined();
    },
  );

  it("propagates live cancellation into an active compiler runner", async () => {
    const result = await runHarness({ liveCompilerCancellation: true });

    expect(result.orchestratorResult.outcome).toEqual({ outcome: "canceled" });
    expect(result.handoff.runnerSignalAborted).toBe(true);
    expect(result.invocations).toEqual(["compiler", "save-read-model"]);
    expect(result.orchestratorResult.readModel).toMatchObject({
      downloadPolicy: { reason: "canceled", state: "blocked" },
      state: "canceled",
    });
    expect(
      result.orchestratorResult.readModel?.stages.some(
        ({ stage, state }) =>
          stage === "compile-infrastructure" && state === "canceled",
      ),
    ).toBe(true);
  });

  it("honors cancellation after verified persistence before publication", async () => {
    const result = await runHarness({ latePersistenceCancellation: true });

    expect(result.orchestratorResult.outcome).toEqual({ outcome: "canceled" });
    expect(result.orchestratorResult.persistedOutput).toBeUndefined();
    expect(result.orchestratorResult.readModel).toMatchObject({
      downloadPolicy: { reason: "canceled", state: "blocked" },
      state: "canceled",
    });
    expect(result.orchestratorResult.readModel).not.toHaveProperty("artifact");
    expect(result.orchestratorResult.readModel?.stages).toContainEqual({
      stage: "persist-output",
      state: "canceled",
    });
    expect(result.invocations).toEqual([
      "compiler",
      "terraform-validator",
      "persist:validate-infrastructure",
      "diagram-renderer",
      "packager",
      "diff",
      "persist-output",
      "save-read-model",
    ]);
  });

  it("maps a typed compiler cancellation to a canceled job", async () => {
    const result = await runHarness({ compilerCancelled: true });

    expect(result.orchestratorResult.outcome).toEqual({ outcome: "canceled" });
    expect(result.orchestratorResult.readModel?.state).toBe("canceled");
    expect(result.orchestratorResult.persistedOutput).toBeUndefined();
  });

  it("maps a canceled application build to a canceled job while retaining Evidence", async () => {
    const fixture = workflowFixture("complete-supported-pattern");
    const result = await runHarness({ buildCancelled: true, fixture });

    expect(result.orchestratorResult.outcome).toEqual({ outcome: "canceled" });
    expect(result.invocations).toEqual([
      "compiler",
      "application-generator",
      "application-builder",
      "persist:build-application",
      "save-read-model",
    ]);
    expect(result.orchestratorResult.readModel).toMatchObject({
      downloadPolicy: { reason: "canceled", state: "blocked" },
      state: "canceled",
    });
    expect(result.orchestratorResult.readModel?.evidenceRecords).toHaveLength(
      1,
    );
  });

  it("maps canceled Terraform validation to a canceled job while retaining Evidence", async () => {
    const result = await runHarness({ validationState: "cancelled" });

    expect(result.orchestratorResult.outcome).toEqual({ outcome: "canceled" });
    expect(result.invocations).toEqual([
      "compiler",
      "terraform-validator",
      "persist:validate-infrastructure",
      "save-read-model",
    ]);
    expect(result.orchestratorResult.readModel).toMatchObject({
      downloadPolicy: { reason: "canceled", state: "blocked" },
      state: "canceled",
    });
    expect(result.orchestratorResult.readModel?.evidenceRecords).toHaveLength(
      1,
    );
  });

  it("heartbeats during a long active compiler stage", async () => {
    const result = await runHarness({ longCompilerHeartbeat: true });

    expect(result.orchestratorResult.outcome.outcome).toBe("succeeded");
    expect(result.heartbeatCalls).toBeGreaterThanOrEqual(3);
  });

  it("rejects a persisted Evidence digest that does not match its canonical record", async () => {
    const fixture = workflowFixture("complete-supported-pattern");
    const result = await runHarness({
      buildFailure: "unit",
      corruptStageEvidence: true,
      fixture,
    });

    expect(result.orchestratorResult.outcome.outcome).toBe("failed");
    expect(result.orchestratorResult.readModel).toMatchObject({
      failure: {
        code: "cloudmarkup.export.stage-report-binding-invalid",
        stage: "build-application",
      },
    });
  });

  it("rejects final Evidence substitution even when the Evidence ID is unchanged", async () => {
    const fixture = workflowFixture("complete-supported-pattern");
    const result = await runHarness({
      buildSuccess: true,
      fixture,
      substituteFinalEvidenceReference: true,
    });

    expect(result.orchestratorResult.outcome.outcome).toBe("failed");
    expect(result.orchestratorResult.readModel).toMatchObject({
      failure: {
        code: "cloudmarkup.export.final-evidence-binding-invalid",
        stage: "persist-output",
      },
      downloadPolicy: { reason: "stage-failed", state: "blocked" },
    });
  });

  it.each(["user-provided", "external-artifact"] as const)(
    "does not claim application code is required for %s references",
    async (mode) => {
      const result = await runHarness({ fixture: workflowFixture(mode) });

      expect(result.orchestratorResult.outcome.outcome).toBe("succeeded");
      expect(result.orchestratorResult.readModel?.warnings).toEqual([]);
      expect(result.invocations).not.toContain("application-generator");
      expect(result.invocations).not.toContain("application-builder");
    },
  );

  it("blocks user-owned generation conflicts before build, validation, or publication", async () => {
    const fixture = workflowFixture("complete-supported-pattern");
    const conflictPath = "application/src/functions/notes_handler/index.ts";
    const existing = existingApplicationFileV1Schema.parse({
      currentChecksum: sha256Digest("user-owned current source"),
      mediaType: "text/typescript",
      ownership: "user-owned",
      path: conflictPath,
      semanticChecksum: sha256Digest("user-owned semantic source"),
      sizeBytes: 25,
    });
    const requestWithConflict = applicationGenerationRequestV1Schema.parse({
      ...fixture.generationRequest,
      existingFiles: [existing],
    });
    const generatedOverride = generateApplication(requestWithConflict);
    expect(generatedOverride.artifact.diff.files).toContainEqual(
      expect.objectContaining({ change: "conflict", path: conflictPath }),
    );

    const result = await runHarness({ fixture, generatedOverride });

    expect(result.orchestratorResult.outcome.outcome).toBe("failed");
    expect(result.invocations).toEqual([
      "compiler",
      "application-generator",
      "save-read-model",
    ]);
    expect(result.orchestratorResult.readModel).toMatchObject({
      downloadPolicy: { reason: "stage-failed", state: "blocked" },
      failure: { stage: "generate-application" },
      state: "failed",
    });
    expect(result.orchestratorResult.persistedOutput).toBeUndefined();
  });
});

it("packages explicit AI source drafts without claiming an application build", async () => {
  const result = await runHarness({
    fixture: workflowFixture(
      "infrastructure-only",
      "cloudformation",
      "ai-source-draft-v1",
    ),
    sourceDraft: true,
  });
  expect(
    result.orchestratorResult.outcome.outcome,
    JSON.stringify({
      failure: result.orchestratorResult.readModel?.failure,
      diagnostics: result.orchestratorResult.readModel?.diagnostics,
    }),
  ).toBe("succeeded");
  expect(result.invocations).toContain("source-draft");
  expect(result.invocations).not.toContain("application-builder");
  expect(result.handoff.verifiedZipPaths).toEqual(
    expect.arrayContaining([
      "application/ai-drafts/workload/index.mjs",
      "application/ai-drafts/workload/index.test.mjs",
      "application/ai-drafts/README.md",
    ]),
  );
  expect(
    result.orchestratorResult.readModel?.stages.find(
      (s) => s.stage === "generate-application",
    )?.state,
  ).toBe("succeeded");
  expect(
    result.orchestratorResult.readModel?.stages.find(
      (s) => s.stage === "build-application",
    )?.state,
  ).toBe("skipped");
  expect(
    result.orchestratorResult.readModel?.applicationVerifications ?? [],
  ).toEqual([]);
});
it("fails explicit source generation when the host has no model port", async () => {
  const result = await runHarness({
    fixture: workflowFixture(
      "infrastructure-only",
      "cloudformation",
      "ai-source-draft-v1",
    ),
  });
  expect(result.orchestratorResult.outcome.outcome).toBe("failed");
  expect(result.orchestratorResult.readModel?.failure?.code).toBe(
    "cloudmarkup.export.ai-source-unavailable",
  );
});
