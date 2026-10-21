import { expect, it, vi } from "vitest";
import { getWorkloadBehaviorContentHash } from "@cloudmarkup/domain";
import sqsEventTemplate from "@cloudmarkup/provider-aws/testing/sqs-event-template-v1.json" with { type: "json" };
import {
  createGoCliSolutionExportCompilerPort,
  createSolutionExportDiagramRendererPort,
  createSolutionExportWorkflowOrchestrator,
  createTimerSolutionExportWorkflowCancellationPollPort,
  cloudFormationValidationResultV1Schema,
  supportsInfrastructureOnlyDelivery,
  type SolutionExportWorkflowDependencies,
} from "@cloudmarkup/solution-export-workflow";
import {
  canonicalBytes,
  evidenceReference,
} from "@cloudmarkup/solution-export-workflow/testing";
import {
  asyncJobObjectReferenceV1Schema,
  asyncJobRecordV1Schema,
  serializeCanonicalJson,
  workloadBehaviorV2Schema,
} from "@cloudmarkup/schemas";
import {
  decodeUtf8,
  readDeterministicZip,
  sha256Digest,
  type SolutionExportArtifactV1,
} from "@cloudmarkup/solution-export";
import {
  createNativeInfrastructureWorkflowFixture,
  createNativeExportDiagramFixture,
} from "./solution-export-native-test-helpers.js";
import { createPinnedSolutionExportCompilerExecutor } from "./adapters/pinned-export-compiler.js";
import {
  assertBufferedSolutionExportArchiveFitsDownload,
  assertCloudFormationInfrastructureOnly,
} from "./solution-export-execution-profile.js";
import { createSolutionExportPackager } from "./application/solution-export-packager.js";
import { selectProductionApplicationDelivery } from "./production-solution-export-host.js";
import {
  DefaultSolutionExportApplication,
  type ImmutableSolutionRevisionExportBinding,
  type StoredSolutionExportJob,
} from "./application/solution-exports.js";
import { exportPrincipal } from "./adapters/persistence/solution-export-artifact-test-helpers.js";
import { createSolutionExportRunInsertionBindingV1 } from "./application/solution-export-persistence-binding.js";
import { createSolutionExportJobV1Schema } from "@cloudmarkup/api-contract";

const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];

it.skipIf(executablePath === undefined || executableSha256 === undefined)(
  "rejects a fresh SQS graph with its canonical generated policies removed",
  async () => {
    const missingPolicies = {
      ...sqsEventTemplate,
      nodes: sqsEventTemplate.nodes.filter(
        ({ semantic }) => semantic.lifecycle.ownership === "user",
      ),
      edges: sqsEventTemplate.edges.filter(({ id }) =>
        id.endsWith(".edge.connection"),
      ),
    };
    await expect(
      createNativeInfrastructureWorkflowFixture({
        executablePath: executablePath ?? "",
        executableSha256: executableSha256 ?? "",
        sourceDocument: missingPolicies,
        applicationDelivery: "infrastructure-only-v1",
        freezeWithProductionBuilder: true,
      }),
    ).rejects.toThrow("TARGET_GENERATED_POLICY_COVERAGE_MISSING");
  },
  60_000,
);

it
  .skipIf(executablePath === undefined || executableSha256 === undefined)
  .each(["terraform", "cloudformation"] as const)(
  "compiles the exact fresh built-in SQS template with production-frozen coverage for %s",
  async (target) => {
    const f = await createNativeInfrastructureWorkflowFixture({
      executablePath: executablePath ?? "",
      executableSha256: executableSha256 ?? "",
      sourceDocument: sqsEventTemplate,
      target,
      freezeWithProductionBuilder: true,
    });
    expect(f.compilerSources.architectureDocument).toEqual(sqsEventTemplate);
    expect(f.compilerSources.solutionRevision.generationCoverage.state).toBe(
      "custom-implementation-required",
    );
    expect(
      f.compilerSources.solutionRevision.versions.applicationGenerator.state,
    ).toBe("not-applicable");
    expect(f.request.targetSettings.target).toBe(target);
  },
  60_000,
);

it.skipIf(executablePath === undefined || executableSha256 === undefined)(
  "admits the actual fresh SQS template with production-frozen coverage and produces a reproducible complete infrastructure ZIP through the guarded native worker workflow",
  async () => {
    const compilerOptions = {
      executablePath: executablePath ?? "",
      executableSha256: executableSha256 ?? "",
    };
    const f = await createNativeInfrastructureWorkflowFixture({
      ...compilerOptions,
      sourceDocument: sqsEventTemplate,
      freezeWithProductionBuilder: true,
      applicationDelivery: "infrastructure-only-v1",
    });
    expect(f.compilerSources.architectureDocument).toEqual(sqsEventTemplate);
    expect(f.compilerSources.solutionRevision.generationCoverage.state).toBe(
      "custom-implementation-required",
    );
    const before = serializeCanonicalJson(f.compilerSources);
    expect(
      f.compilerSources.workloadBehavior.workloads[0]?.implementation.mode,
    ).toBe("complete-supported-pattern");
    const principal = exportPrincipal();
    const binding: ImmutableSolutionRevisionExportBinding = {
      organizationId: "org_template",
      projectId: "project_template",
      solutionRevisionId: f.request.subject.solutionRevisionId,
      manifestRecordId: f.request.subject.manifestRecordId,
      manifestDigest: f.request.subject.manifestDigest,
      generationCoverage: f.compilerSources.solutionRevision.generationCoverage,
      workflowSources: f.request.sources,
      applicationCodeRequired: true,
      infrastructureOnlyDeliverySupported: supportsInfrastructureOnlyDelivery(
        f.compilerSources.architectureDocument,
      ),
    };
    let admitted: StoredSolutionExportJob | undefined;
    const admit = vi.fn(({ record }: { record: StoredSolutionExportJob }) => {
      admitted = structuredClone(record);
      return Promise.resolve(record);
    });
    const application = new DefaultSolutionExportApplication({
      access: {
        authorizeProject: () =>
          Promise.resolve({
            organizationId: binding.organizationId,
            projectId: binding.projectId,
          }),
      },
      clock: () => new Date("2026-08-18T12:00:00.000Z"),
      revisions: { getImmutableBinding: () => Promise.resolve(binding) },
      targetPolicy: {
        evaluate: (input) =>
          Promise.resolve({
            entitlementDecisionReference:
              "export-decision.synthetic-infrastructure",
            targetSettings: f.request.targetSettings,
            applicationDelivery: selectProductionApplicationDelivery(
              input.binding,
              input.applicationSource,
            ),
          }),
      },
      repository: {
        findLatestArtifact: () => Promise.resolve(null),
        getArtifact: () => Promise.resolve(null),
        getDownloadGrant: () => Promise.resolve(null),
        reserveDownloadGrant: () =>
          Promise.reject(new Error("No download admission in this test.")),
        getJob: () => Promise.resolve(admitted ?? null),
      },
      durableAdmission: {
        contractVersion: 1,
        findReplay: () => Promise.resolve(null),
        admit,
        cancel: () =>
          Promise.reject(new Error("No cancellation in this test.")),
      },
    });
    await application.createJob(
      principal,
      binding.projectId,
      createSolutionExportJobV1Schema.parse({
        contractVersion: 1,
        solutionRevisionId: binding.solutionRevisionId,
        environment: { environmentType: "development" },
        exportName: f.request.exportName,
        targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
      }),
      "template-infrastructure-export",
    );
    expect(admit).toHaveBeenCalledOnce();
    expect(admitted?.workflowSubmission.request.applicationDelivery).toBe(
      "infrastructure-only-v1",
    );
    expect(admitted?.workflowSubmission.request.sources).toEqual(
      f.request.sources,
    );
    expect(binding.applicationCodeRequired).toBe(true);
    if (admitted === undefined)
      throw new Error("Expected synthetic durable admission.");
    const accepted = admitted.workflowSubmission.request;
    const insertion = createSolutionExportRunInsertionBindingV1(
      admitted.workflowSubmission,
    );
    const objects = new Map(f.objects);
    objects.set(insertion.workflowRequestObjectId, canonicalBytes(accepted));
    const workerRecord = asyncJobRecordV1Schema.parse({
      ...f.record,
      jobId: admitted.job.id,
      orchestration: { ...f.record.orchestration, rootJobId: admitted.job.id },
      ownership: {
        organizationId: binding.organizationId,
        projectId: binding.projectId,
      },
      input: insertion.orchestrationInput,
      inputDigest: insertion.orchestrationInputSha256,
      inputSizeBytes: canonicalBytes(insertion.orchestrationInput).byteLength,
      idempotency: {
        ...f.record.idempotency,
        requestDigest: insertion.requestSha256,
      },
    });

    const diagram = createSolutionExportDiagramRendererPort(
      await createNativeExportDiagramFixture(),
    );
    const compiler = createGoCliSolutionExportCompilerPort({
      executor: createPinnedSolutionExportCompilerExecutor(compilerOptions),
    });
    const generator = vi.fn(() =>
      Promise.reject(new Error("Application generation is forbidden.")),
    );
    const builder = vi.fn(() =>
      Promise.reject(new Error("Application builds are forbidden.")),
    );
    const ai = vi.fn(() =>
      Promise.reject(new Error("AI source is forbidden.")),
    );
    const terraform = vi.fn(() =>
      Promise.reject(new Error("Terraform is forbidden.")),
    );
    const packager = createSolutionExportPackager();
    const artifacts: SolutionExportArtifactV1[] = [];
    const reports: ReturnType<typeof evidenceReference>[] = [];
    const ref = (
      id: string,
      bytes: Uint8Array,
      purpose: "input-payload" | "checkpoint-state" | "export-package",
      mediaType = "application/json",
    ) =>
      asyncJobObjectReferenceV1Schema.parse({
        contractVersion: 1,
        objectId: id,
        digest: sha256Digest(bytes),
        sizeBytes: bytes.length,
        purpose,
        mediaType,
      });
    const dependencies: SolutionExportWorkflowDependencies = {
      cancellation: createTimerSolutionExportWorkflowCancellationPollPort(10),
      applicationGenerator: { generate: generator },
      applicationBuilder: { build: builder },
      applicationSourceDraft: { generate: ai },
      terraformValidator: { validate: terraform },
      clock: { now: () => new Date("2026-08-18T12:00:00.000Z") },
      compiler: {
        compile: (input) => {
          assertCloudFormationInfrastructureOnly(input);
          return compiler.compile(input);
        },
      },
      diagramRenderer: diagram,
      diff: {
        compare: ({ current }) =>
          Promise.resolve({
            contractVersion: 1,
            currentDigest: current.zipDigest,
            entries: [],
            state: "no-baseline",
          }),
      },
      packager: {
        package: async (input) => {
          expect(input.application).toBeUndefined();
          expect(input.builds).toEqual([]);
          const result = await packager.package(input);
          if (result.state === "ready")
            assertBufferedSolutionExportArchiveFitsDownload(
              result.artifact.zipBytes,
            );
          return result;
        },
      },
      objects: {
        load: ({ reference }) => {
          const bytes = objects.get(reference.objectId);
          if (!bytes) throw new Error("Missing synthetic input.");
          return Promise.resolve(bytes);
        },
        persistStageReport: ({ report, digest, evidenceRecords, stage }) => {
          const references = evidenceRecords.map((record) =>
            evidenceReference(record, accepted.environment),
          );
          reports.push(...references);
          const parsedReport =
            cloudFormationValidationResultV1Schema.parse(report);
          const bytes = canonicalBytes({
            diagnostics: parsedReport.diagnostics,
            target: parsedReport.target,
            validation: parsedReport.validation,
          });
          expect(sha256Digest(bytes)).toBe(digest);
          return Promise.resolve({
            stage,
            evidenceRecords: references,
            artifact: {
              artifactId: "artifact.template-validation",
              kind: "cloudformation-validation-report",
              digest,
              mediaType: "application/json",
              sizeBytes: bytes.length,
              object: {
                ...ref("object.template-validation", bytes, "input-payload"),
                purpose: "validation-report",
              },
            },
          });
        },
        persistVerifiedOutput: ({ artifact, diff }) => {
          artifacts.push(artifact);
          const object = ref(
            "object.template-package",
            artifact.zipBytes,
            "export-package",
            "application/zip",
          );
          return Promise.resolve({
            contractVersion: 1,
            diff,
            evidenceRecords: reports,
            artifact: {
              artifactId: "artifact.template-package",
              kind: "export-package",
              digest: artifact.zipDigest,
              archiveFileName: artifact.archiveFileName,
              manifestDigest: artifact.manifestDigest,
              mediaType: "application/zip",
              sizeBytes: artifact.zipBytes.length,
              object,
            },
            verifiedPackage: {
              artifactId: "artifact.template-package",
              availability: { state: "available" },
              object,
            },
          });
        },
        saveCheckpoint: ({ checkpoint }) =>
          Promise.resolve(
            ref(
              "object.template-checkpoint",
              canonicalBytes(checkpoint),
              "checkpoint-state",
            ),
          ),
        saveReadModel: () => Promise.resolve(),
      },
    };
    const context = {
      attemptNumber: 1,
      checkpoint: undefined,
      correlationId: workerRecord.correlationId,
      jobId: workerRecord.jobId,
      ownership: workerRecord.ownership,
      heartbeat: () => Promise.resolve(),
      isCancellationRequested: () => Promise.resolve(false),
      reportProgress: () => Promise.resolve(),
      saveCheckpoint: () => Promise.resolve(),
    };
    for (let i = 0; i < 2; i++) {
      reports.length = 0;
      const result = await createSolutionExportWorkflowOrchestrator(
        dependencies,
      ).run(workerRecord, context);
      expect(
        result.outcome.outcome,
        JSON.stringify(result.readModel?.failure),
      ).toBe("succeeded");
      expect(
        result.readModel?.stages.find(
          ({ stage }) => stage === "generate-application",
        )?.state,
      ).toBe("skipped");
      expect(
        result.readModel?.stages.find(
          ({ stage }) => stage === "build-application",
        )?.state,
      ).toBe("skipped");
      expect(result.readModel?.warnings).toContain("application-code-required");
      expect(result.readModel?.downloadPolicy.state).toBe("eligible");
    }
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]?.zipDigest).toBe(artifacts[1]?.zipDigest);
    const entries = readDeterministicZip(
      artifacts[0]?.zipBytes ?? new Uint8Array(),
    );
    const files = new Map(
      entries
        .filter(({ path }) => path.endsWith(".json") || path.endsWith(".md"))
        .map((entry) => [entry.path, decodeUtf8(entry.bytes)]),
    );
    expect(files.get("README.md")).toContain(
      "Application source generation and builds were omitted",
    );
    expect(files.get("cloudmarkup/INFRASTRUCTURE_EXPORT.md")).toContain(
      "Lambda application code is still required",
    );
    // The archive canonicalizes set-like arrays; compare the authoritative
    // semantic digest while retaining the original resolved bytes below.
    const packagedWorkload = workloadBehaviorV2Schema.parse(
      JSON.parse(files.get("cloudmarkup/workloads.json") ?? "null"),
    );
    expect(getWorkloadBehaviorContentHash(packagedWorkload)).toBe(
      getWorkloadBehaviorContentHash(f.compilerSources.workloadBehavior),
    );
    expect(packagedWorkload.workloads[0]?.implementation).toEqual(
      f.compilerSources.workloadBehavior.workloads[0]?.implementation,
    );
    expect(
      JSON.parse(files.get("cloudmarkup/solution.json") ?? "null"),
    ).toEqual(f.compilerSources.solutionRevision);
    expect(files.get("infrastructure/template.json")).toContain(
      "AWS::SQS::Queue",
    );
    for (const permission of [
      "lambda.amazonaws.com",
      "sts:AssumeRole",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
    ])
      expect(files.get("infrastructure/template.json")).toContain(permission);
    expect(entries.some(({ path }) => path.startsWith("application/"))).toBe(
      false,
    );
    for (const forbidden of [generator, builder, ai, terraform])
      expect(forbidden).not.toHaveBeenCalled();
    expect(serializeCanonicalJson(f.compilerSources)).toBe(before);
  },
  60_000,
);
