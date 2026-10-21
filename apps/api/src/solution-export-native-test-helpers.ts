import { readFile } from "node:fs/promises";
import { revisionV1Schema } from "@cloudmarkup/api-contract";
import { createDiagramIconSetV1 } from "@cloudmarkup/diagram-export";
import { createAwsDiagramIconRegistryTestInput } from "@cloudmarkup/provider-aws/testing/diagram-icon-registry";
import { createEventGenerationRequest } from "@cloudmarkup/application-generator/testing";
import {
  applyGraphCommand,
  getArchitectureDocumentCanonicalHash,
  getApplicationContractsContentHash,
  getApplicationContractRecordContentHash,
  getExternalResourceReferenceContentHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getWorkloadBehaviorContentHash,
  hashCanonicalValue,
  validateSolutionRevisionManifestWithEvidenceV1,
} from "@cloudmarkup/domain";
import {
  awsCatalogV1,
  AWS_CATALOG_DIGEST_V1,
} from "@cloudmarkup/provider-aws/catalog";
import {
  applicationGenerationRequestV1Schema,
  architectureDocumentV3Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobRecordV1Schema,
  solutionRevisionManifestV1Schema,
  workloadBehaviorV2Schema,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import {
  createGoCliSolutionExportCompilerPort,
  goCompilationResultV1Schema,
  solutionExportWorkflowRequestDigest,
  solutionExportWorkflowRequestV1Schema,
  solutionExportWorkflowTargetSettingsDigest,
  solutionExportWorkflowTargetSettingsProjectionV1Schema,
  solutionExportWorkflowTargetSettingsV1Schema,
  type SolutionExportWorkflowTargetSettingsV1,
} from "@cloudmarkup/solution-export-workflow";
import {
  canonicalBytes,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";
import { createPinnedSolutionExportCompilerExecutor } from "./adapters/pinned-export-compiler.js";
import { bindDiagramTargetSettings } from "./application/solution-exports.js";
import { buildSolutionRevisionV1 } from "./application/solution-revision-builder.js";
import { BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES } from "./solution-export-limits.js";

type WorkflowFixture = ReturnType<typeof workflowFixture>;
type NativeCompilerSources = Pick<
  WorkflowFixture["generationRequest"],
  "architectureDocument" | "solutionRevision" | "workloadBehavior"
>;
type NativeFixtureOptions = Parameters<
  typeof createPinnedSolutionExportCompilerExecutor
>[0] & {
  readonly target?: "terraform" | "cloudformation";
  readonly targetSettings?: SolutionExportWorkflowTargetSettingsV1;
  readonly sourceDocument?: unknown;
  readonly applicationDelivery?: "infrastructure-only-v1";
  readonly preserveWorkloadIntent?: boolean;
  readonly freezeWithProductionBuilder?: boolean;
};

/** Use current catalog identity with reviewed repository icon bytes. */
export async function createNativeExportDiagramFixture() {
  const registry = createAwsDiagramIconRegistryTestInput();
  const catalog = awsCatalogV1.artifact;
  const assetsByFile = Object.fromEntries(
    await Promise.all(
      Object.entries(registry.assetSpecifiersByFile).map(
        async ([file, specifier]) =>
          [
            file,
            await readFile(new URL(import.meta.resolve(specifier)), "utf8"),
          ] as const,
      ),
    ),
  );
  return {
    catalog,
    iconSet: createDiagramIconSetV1({
      assetsByFile,
      catalog,
      manifest: registry.manifest,
    }),
  };
}
/** Synthetic graph using reviewed catalog definitions and actual native compiler output. */
export async function createNativeInfrastructureWorkflowFixture(
  options: NativeFixtureOptions,
): Promise<WorkflowFixture & { compilerSources: NativeCompilerSources }> {
  const target = options.target ?? "cloudformation";
  const source = JSON.parse(
    await readFile(
      new URL(
        "../../../packages/architecture-cli/src/fixtures/aws-eventing/compiler-v1/sqs-consumer-dlq/source.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const original = architectureDocumentV3Schema.parse(
    options.sourceDocument ?? source["architectureDocument"],
  );
  const catalog = {
    id: awsCatalogV1.artifact.catalog.id,
    version: awsCatalogV1.artifact.catalog.version,
    digest: AWS_CATALOG_DIGEST_V1,
  };
  const document = architectureDocumentV3Schema.parse({ ...original, catalog });
  const preserveWorkloadIntent =
    options.sourceDocument !== undefined ||
    options.preserveWorkloadIntent === true;
  const workloadBehavior = !preserveWorkloadIntent
    ? workloadBehaviorV2Schema.parse({
        ...document.workloadBehavior,
        workloads: document.workloadBehavior.workloads.map((workload) => ({
          ...workload,
          implementation: { mode: "infrastructure-only" },
          triggerDispatch: { mode: "single" },
          provenance: {
            source: "manual",
            recordedAt: document.revision.createdAt,
            recordedBy: document.revision.createdBy,
          },
        })),
      })
    : document.workloadBehavior;
  const architectureDocument = !preserveWorkloadIntent
    ? architectureDocumentV3Schema.parse(
        applyGraphCommand(document, {
          schemaVersion: 1,
          commandId: "command_native_export_infrastructure_only",
          inverseCommandId: "command_native_export_infrastructure_only_inverse",
          origin: "user",
          target: {
            architectureId: document.architectureId,
            documentId: document.documentId,
            revisionId: document.revision.revisionId,
          },
          kind: "replace-workload-and-application-contracts",
          expectedWorkloadBehavior: document.workloadBehavior,
          workloadBehavior,
          expectedApplicationContracts: document.applicationContracts,
          applicationContracts: document.applicationContracts,
        }).document,
      )
    : document;
  const base = workflowFixture("infrastructure-only", target);
  const generationTemplate = createEventGenerationRequest({
    pattern: "sqs-consumer-dlq",
    catalog,
  });
  const oldManifest = solutionRevisionManifestV1Schema.parse(
    source["solutionRevision"],
  );
  if (oldManifest.versions.compiler.state !== "pinned") {
    throw new Error("Native fixture requires the reviewed compiler pin.");
  }
  const nativeCompiler = oldManifest.versions.compiler.tool;
  const solutionRevisionId = "solution_native_sqs_infrastructure_revision_1";
  // No compile/build Evidence exists at freeze time. Actual workflow stages will
  // retain their own Evidence; application completeness is never asserted here.
  const missingRequirements = [
    "structural-validity",
    "provider-architecture-validity",
    "deterministic-infrastructure-compilation",
  ];
  const { manifest: fixtureManifest } =
    validateSolutionRevisionManifestWithEvidenceV1(
      {
        ...oldManifest,
        solutionRevisionId,
        architecture: {
          ...oldManifest.architecture,
          revisionId: architectureDocument.revision.revisionId,
          contentHash: getArchitectureDocumentContentHash(architectureDocument),
          documentHash:
            getArchitectureDocumentCanonicalHash(architectureDocument),
          visualHash: getArchitectureDocumentVisualHash(architectureDocument),
        },
        workload: {
          contractVersion: workloadBehavior.contractVersion,
          contentHash: getWorkloadBehaviorContentHash(workloadBehavior),
        },
        contracts: {
          contractVersion:
            architectureDocument.applicationContracts.schemaVersion,
          contentHash: getApplicationContractsContentHash(
            architectureDocument.applicationContracts,
          ),
          recordHashes: architectureDocument.applicationContracts.contracts
            .map(getApplicationContractRecordContentHash)
            .sort(),
        },
        externalResources: {
          contractVersion: architectureDocument.externalResources.schemaVersion,
          contentHash: getExternalResourceReferenceContentHash(
            architectureDocument.externalResources,
          ),
        },
        intent: {
          state: "not-applicable",
          reason:
            "Synthetic SQS infrastructure delivery; saved workload intent is preserved, with no generated application claim.",
        },
        generationCoverage: {
          contractVersion: 1,
          solutionRevisionId,
          state: "infrastructure-only",
          evidence: [],
          missingRequirements,
          workloads: workloadBehavior.workloads.map((workload) => ({
            workloadId: workload.id,
            state: "infrastructure-only",
            evidence: [],
            missingRequirements,
            unresolvedRequirementIds: workload.unresolvedRequirementIds,
          })),
        },
        evidenceIdsAtFreeze: [],
        versions: {
          ...oldManifest.versions,
          catalog,
          compiler: {
            state: "pinned",
            tool: nativeCompiler,
          },
          diagramRenderer: {
            state: "pinned",
            tool: (options.targetSettings ?? base.request.targetSettings)
              .stageDescriptors.diagramRenderer.adapter,
          },
          applicationGenerator: {
            state: "pinned",
            tool: generationTemplate.generator,
          },
        },
      },
      { contractVersion: 1, records: [] },
    );
  const solutionRevision = options.freezeWithProductionBuilder
    ? buildSolutionRevisionV1({
        name: "Fresh SQS template revision",
        solutionRevisionId,
        selectedTools: {
          compiler: { state: "pinned", tool: nativeCompiler },
          diagramRenderer: {
            state: "pinned",
            tool: (options.targetSettings ?? base.request.targetSettings)
              .stageDescriptors.diagramRenderer.adapter,
          },
        },
        revision: revisionV1Schema.parse({
          architectureDocument,
          catalogDigest: catalog.digest,
          catalogId: catalog.id,
          catalogVersion: catalog.version,
          contentDigest:
            getArchitectureDocumentContentHash(architectureDocument),
          documentDigest:
            getArchitectureDocumentCanonicalHash(architectureDocument),
          visualDigest: getArchitectureDocumentVisualHash(architectureDocument),
          createdAt: architectureDocument.revision.createdAt,
          createdBy: {
            id: "principal_native",
            displayName: "Native fixture owner",
          },
          graphSchemaVersion: 1,
          id: architectureDocument.revision.revisionId,
          name: "Fresh SQS template architecture",
          projectId: "project_native",
          sourceDraftId: architectureDocument.revision.sourceDraftId,
          sourceDraftVersion: 1,
          storageStatus: "published",
          workloadBehaviorVersion: 2,
        }),
      }).manifest
    : fixtureManifest;
  const objects = new Map<string, Uint8Array>();
  function reference(objectId: string, value: unknown) {
    const bytes = canonicalBytes(value);
    objects.set(objectId, bytes);
    return asyncJobObjectReferenceV1Schema.parse({
      contractVersion: 1,
      digest: sha256Digest(bytes),
      mediaType: "application/json",
      objectId,
      purpose: "input-payload",
      sizeBytes: bytes.byteLength,
    });
  }
  const architectureReference = reference(
    "object.native.architecture",
    architectureDocument,
  );
  const workloadReference = reference(
    "object.native.workload",
    workloadBehavior,
  );
  const manifestReference = reference(
    "object.native.solution-revision",
    solutionRevision,
  );
  const oldSettings =
    options.targetSettings === undefined
      ? base.request.targetSettings
      : bindDiagramTargetSettings(options.targetSettings, base.request.diagram);
  if (oldSettings.target !== target)
    throw new Error("Native fixture target settings mismatch.");
  const settingsProjection =
    solutionExportWorkflowTargetSettingsProjectionV1Schema.parse({
      contractVersion: oldSettings.contractVersion,
      policyPacks: oldSettings.policyPacks,
      renderer: oldSettings.renderer,
      target: oldSettings.target,
      stageDescriptors: {
        ...oldSettings.stageDescriptors,
        compiler: {
          ...oldSettings.stageDescriptors.compiler,
          adapter: nativeCompiler,
        },
      },
      limits: {
        ...oldSettings.limits,
        maxArchiveBytes: BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES,
      },
    });
  const targetSettings = solutionExportWorkflowTargetSettingsV1Schema.parse({
    ...settingsProjection,
    digest: solutionExportWorkflowTargetSettingsDigest(settingsProjection),
  });
  const request = solutionExportWorkflowRequestV1Schema.parse({
    ...base.request,
    exportName: "SQS infrastructure export",
    ...(options.applicationDelivery === undefined
      ? {}
      : { applicationDelivery: options.applicationDelivery }),
    sources: {
      architectureDocument: architectureReference,
      workloadBehavior: workloadReference,
      solutionRevision: manifestReference,
    },
    subject: {
      ...base.request.subject,
      solutionRevisionId,
      manifestDigest: manifestReference.digest,
    },
    targetProfileId:
      target === "terraform"
        ? "cloudmarkup.export.terraform-nodejs24-v1"
        : "cloudmarkup.export.cloudformation-nodejs24-v1",
    targetSettings,
  });
  const executor = createPinnedSolutionExportCompilerExecutor(options);
  const compilation = goCompilationResultV1Schema.parse(
    await createGoCliSolutionExportCompilerPort({
      executor,
    }).compile({
      request,
      settings: request.targetSettings.stageDescriptors.compiler,
      signal: new AbortController().signal,
      sources: { architectureDocument, solutionRevision, workloadBehavior },
    }),
  );
  if (
    compilation.model === undefined ||
    compilation.artifact?.target !== target ||
    compilation.diagnostics?.some(({ severity }) => severity === "error") ===
      true
  ) {
    throw new Error(
      "Native infrastructure fixture did not compile successfully: " +
        JSON.stringify(
          compilation.diagnostics
            ?.filter((diagnostic) => diagnostic.severity === "error")
            .map(({ code, message }) => ({ code, message })),
        ),
    );
  }
  const generationRequest = applicationGenerationRequestV1Schema.parse({
    ...generationTemplate,
    architectureDocument,
    // Keep the legacy application test fixture separate from the real frozen
    // infrastructure inputs, which correctly have no application-generator pin.
    solutionRevision: options.freezeWithProductionBuilder
      ? fixtureManifest
      : solutionRevision,
    workloadBehavior,
    normalizedSolution: compilation.model,
  });
  const requestReference = reference("object.native.export-request", request);
  const input = {
    ...base.record.input,
    request: requestReference,
    subject: request.subject,
    targetProfileId: request.targetProfileId,
    targetSettingsDigest: request.targetSettings.digest,
  };
  const record = asyncJobRecordV1Schema.parse({
    ...base.record,
    input,
    inputDigest: hashCanonicalValue(input),
    inputSizeBytes: canonicalBytes(input).byteLength,
    idempotency: {
      ...base.record.idempotency,
      requestDigest: solutionExportWorkflowRequestDigest(request),
    },
  });
  return {
    compilation,
    generationRequest,
    compilerSources: {
      architectureDocument,
      solutionRevision,
      workloadBehavior,
    },
    objects,
    record,
    request,
  };
}
