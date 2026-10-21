import { readFileSync } from "node:fs";

import {
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  normalizeArchitectureDocumentV3,
  repositoryRelativePathSchema,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import {
  SOLUTION_EXPORT_MANIFEST_PATH,
  applicationBuildSupplementalFiles,
  localSolutionExportService,
  SOLUTION_EXPORT_V1_MAXIMA,
  SOLUTION_EXPORT_ZIP_EPOCH,
  exactToolPinV1Schema,
  canonicalSemanticDigest,
  createDeterministicZip,
  encodeUtf8,
  sha256Digest,
  solutionExportManifestV1Schema,
  solutionExportRequestV1Schema,
  type SolutionExportArtifactV1,
  type SolutionExportFileV1,
  type SolutionExportManifestFileV1,
} from "@cloudmarkup/solution-export";
import {
  goCompilationResultV1Schema,
  projectGoCompilationResultToSolutionExportInfrastructure,
} from "@cloudmarkup/solution-export-workflow";
import {
  TEST_RENDERER,
  passingBuildResult,
  eventApplicationFixtureForGenerationRequest,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";

import {
  architectureCliSemanticSnapshotV1Schema,
  type ArchitectureCliSemanticSnapshotV1,
} from "./contracts.js";
import { semanticSnapshotDigest } from "./semantic-diff.js";
import {
  architectureCliFixtureSnapshot,
  architectureCliNetworkingFixtureArtifact,
} from "./test-fixtures.js";
import {
  architectureCliEventGenerationRequestFromCompilerBundle,
  type ArchitectureCliGeneratedEventCase,
} from "./event-compiler-fixture-source.js";

export {
  architectureCliGeneratedEventCases,
  type ArchitectureCliGeneratedEventCase,
} from "./event-compiler-fixture-source.js";

const EVENT_CATALOG = exactToolPinV1Schema.parse({
  digest:
    "sha256:5cdfca9761d0d6875eef22abd51f94a7cc7109f065f92f9b454e4585f9cfb410",
  id: "aws.cloudmarkup.notes-api-catalog",
  version: "0.12.0",
});
const producer = exactToolPinV1Schema.parse({
  digest: sha256Digest("cloudmarkup.solution-exporter@1.0.0"),
  id: "cloudmarkup.solution-exporter",
  version: "1.0.0",
});
const terraformPath = new URL(
  "./fixtures/aws-eventing/queue-consumer.tf",
  import.meta.url,
);

type CuratedEventPattern =
  | Exclude<ArchitectureCliGeneratedEventCase, "sns-fanout-multi">
  | "sns-fanout-consumer";

function generatedEventFixture(eventCase: ArchitectureCliGeneratedEventCase) {
  const fixtureRoot = `./fixtures/aws-eventing/compiler-v1/${eventCase}`;
  const source: unknown = JSON.parse(
    readFileSync(
      new URL(`${fixtureRoot}/source.json`, import.meta.url),
      "utf8",
    ),
  );
  const compilation = goCompilationResultV1Schema.parse(
    JSON.parse(
      readFileSync(
        new URL(`${fixtureRoot}/compilation.json`, import.meta.url),
        "utf8",
      ),
    ),
  );
  if (compilation.model === undefined || compilation.artifact === undefined) {
    throw new TypeError(
      `Event compiler fixture is incomplete for ${eventCase}.`,
    );
  }
  const generationRequest =
    architectureCliEventGenerationRequestFromCompilerBundle(
      eventCase,
      source,
      compilation.model,
    );
  return {
    ...eventApplicationFixtureForGenerationRequest(generationRequest),
    compilation,
  };
}

function eventPattern(
  eventCase: ArchitectureCliGeneratedEventCase,
): CuratedEventPattern {
  return eventCase === "sns-fanout-multi" ? "sns-fanout-consumer" : eventCase;
}
function textFile(
  path: string,
  content: string,
  mediaType: SolutionExportFileV1["mediaType"],
  solutionRevisionId: string,
  ownership: SolutionExportFileV1["ownership"] = "generated-replaceable",
): SolutionExportFileV1 {
  const bytes = encodeUtf8(content);
  return {
    bytes,
    checksum: sha256Digest(bytes),
    mediaType,
    ownership,
    path,
    provenance: {
      producer,
      solutionRevisionId,
      sourceReferences: [{ id: solutionRevisionId, kind: "solution-revision" }],
    },
    semanticChecksum: canonicalSemanticDigest(mediaType, bytes),
  };
}

function manifestFile(
  file: SolutionExportFileV1,
): SolutionExportManifestFileV1 {
  return {
    checksum: file.checksum,
    mediaType: file.mediaType,
    ownership: file.ownership,
    path: repositoryRelativePathSchema.parse(file.path),
    provenance: file.provenance,
    semanticChecksum: file.semanticChecksum,
    sizeBytes: file.bytes.byteLength,
  };
}

function jsonFile(
  artifact: SolutionExportArtifactV1,
  path: string,
): Record<string, unknown> {
  const output = artifact.files.find((candidate) => candidate.path === path);
  if (output === undefined) {
    throw new TypeError(`Event fixture base is missing ${path}.`);
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(output.bytes));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`Event fixture base ${path} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function eventNode(
  id: string,
  deploymentKey: string,
  serviceType: string,
  label: string,
  x: number,
  y: number,
  values: Readonly<Record<string, unknown>>,
) {
  return {
    id,
    semantic: {
      deploymentKey,
      serviceType,
      resourceType: serviceType,
      configuration: {
        schemaId: `${serviceType}.configuration`,
        schemaVersion: "1.0.0",
        values,
      },
      lifecycle: { ownership: "user" as const, origin: "template" as const },
    },
    presentation: { label, position: { x, y } },
  };
}

function eventEdge(
  id: string,
  relationshipType: string,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
  values: Readonly<Record<string, unknown>>,
) {
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: sourcePort },
      target: { nodeId: targetNodeId, port: targetPort },
      relationshipType,
      configuration: {
        schemaId: `${relationshipType}.connection`,
        schemaVersion: "1.0.0",
        values,
      },
      lifecycle: { ownership: "user" as const, origin: "template" as const },
    },
  };
}

function eventArchitecture(baseArtifact: SolutionExportArtifactV1) {
  const architecture = jsonFile(baseArtifact, "cloudmarkup/architecture.json");
  const workloadBehavior = jsonFile(baseArtifact, "cloudmarkup/workloads.json");
  const externalResources = jsonFile(
    baseArtifact,
    "cloudmarkup/external-resources.json",
  );
  const applicationContracts = jsonFile(
    baseArtifact,
    "cloudmarkup/contracts/application-contracts.json",
  );
  const base = normalizeArchitectureDocumentV3(
    architectureDocumentV3Schema.parse({
      ...architecture,
      workloadBehavior,
      externalResources,
      applicationContracts,
    }),
  );
  const revision = {
    revisionId: "revision_event_queue_consumer_0001",
    revisionNumber: 1,
    createdAt: base.revision.createdAt,
    createdBy: base.revision.createdBy,
    sourceDraftId: "draft_event_queue_consumer_0001",
  };
  const boundRevision = {
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
  };
  const templateWorkload = base.workloadBehavior.workloads[0];
  if (templateWorkload === undefined) {
    throw new TypeError(
      "Event fixture requires one schema-valid workload template.",
    );
  }
  const queue = eventNode(
    "node_event_queue",
    "event_queue",
    "aws.sqs.queue",
    "Event queue",
    80,
    640,
    {
      queueType: { kind: "string", value: "STANDARD" },
      visibilityTimeoutSeconds: { kind: "integer", value: 60 },
      messageRetentionSeconds: { kind: "integer", value: 345600 },
      receiveWaitTimeSeconds: { kind: "integer", value: 20 },
      encryptionMode: { kind: "string", value: "SQS_MANAGED" },
    },
  );
  const dlq = eventNode(
    "node_event_dlq",
    "event_dlq",
    "aws.sqs.queue",
    "Event DLQ",
    80,
    880,
    {
      queueType: { kind: "string", value: "STANDARD" },
      visibilityTimeoutSeconds: { kind: "integer", value: 30 },
      messageRetentionSeconds: { kind: "integer", value: 1209600 },
      receiveWaitTimeSeconds: { kind: "integer", value: 20 },
      encryptionMode: { kind: "string", value: "SQS_MANAGED" },
    },
  );
  const consumer = eventNode(
    "node_event_consumer",
    "event_consumer",
    "aws.lambda.function",
    "Event consumer",
    440,
    640,
    {
      functionName: { kind: "string", value: "event-consumer" },
      runtime: { kind: "string", value: "nodejs24.x" },
      handler: { kind: "string", value: "index.handler" },
      memorySize: { kind: "integer", value: 256 },
      timeoutSeconds: { kind: "integer", value: 30 },
    },
  );
  const role = eventNode(
    "node_event_consumer_role",
    "event_consumer_role",
    "aws.iam.role",
    "Event consumer role",
    440,
    880,
    { roleName: { kind: "string", value: "event-consumer-role" } },
  );
  const consumerEdge = eventEdge(
    "edge_event_queue_consumer",
    "aws.sqs.triggers-lambda",
    queue.id,
    "aws.sqs.queue.event-source",
    consumer.id,
    "aws.lambda.function.event-source",
    {
      batchSize: { kind: "integer", value: 10 },
      batchingWindowSeconds: { kind: "integer", value: 5 },
      maximumConcurrency: { kind: "integer", value: 10 },
      partialBatchResponse: { kind: "boolean", value: true },
      deliverySemantics: { kind: "string", value: "AT_LEAST_ONCE" },
    },
  );
  const redriveEdge = eventEdge(
    "edge_event_queue_dlq",
    "aws.sqs.uses-dead-letter-queue",
    queue.id,
    "aws.sqs.queue.redrive",
    dlq.id,
    "aws.sqs.queue.dead-letter-target",
    {
      maxReceiveCount: { kind: "integer", value: 5 },
      replayPolicy: { kind: "string", value: "MANUAL" },
    },
  );
  const roleEdge = eventEdge(
    "edge_event_consumer_role",
    "aws.iam.role-assumed-by-lambda",
    role.id,
    "aws.iam.role.assumable-role",
    consumer.id,
    "aws.lambda.function.execution-role",
    {},
  );

  return normalizeArchitectureDocumentV3(
    architectureDocumentV3Schema.parse({
      ...base,
      documentId: "doc_event_queue_consumer_fixture",
      architectureId: "architecture_event_queue_consumer_fixture",
      revision,
      catalog: EVENT_CATALOG,
      nodes: [...base.nodes, queue, dlq, consumer, role],
      edges: [...base.edges, consumerEdge, redriveEdge, roleEdge],
      applicationContracts: {
        ...base.applicationContracts,
        documentId: "doc_event_queue_consumer_fixture",
        revision: boundRevision,
      },
      externalResources: {
        ...base.externalResources,
        documentId: "doc_event_queue_consumer_fixture",
        architectureId: "architecture_event_queue_consumer_fixture",
        revision: boundRevision,
      },
      workloadBehavior: {
        contractVersion: 2,
        workloads: [
          ...base.workloadBehavior.workloads,
          {
            ...templateWorkload,
            id: "workload_event_consumer",
            owningNodeId: consumer.id,
            implementation: {
              mode: "user-provided",
              runtimeFamily: "aws.lambda.runtime-family.nodejs24",
              handler: "application/queue-consumer/index.handler",
              sourceOwnership: "user",
            },
            operations: [
              {
                id: "operation_consume_event",
                capability: "cloudmarkup.workload.consume-event",
                inputContract: { kind: "none" },
                outputContract: { kind: "none" },
              },
            ],
            triggers: [
              {
                id: "trigger_event_queue",
                edgeId: consumerEdge.id,
                targetOperationId: "operation_consume_event",
              },
            ],
            downstreamActions: [],
            behaviorContracts: [],
            environment: [],
            entrypoints: [],
            httpRoutes: [],
            eventBindings: [],
            schedules: [],
            dataBindings: [],
            authorization: [],
            idempotency: [],
            tests: [],
            sourceOwnership: [],
            extensionPoints: [],
            extensions: [],
            implementationRequirements: [
              {
                implementationRequirementId:
                  "implementation_event_handler_prompt_45a",
                summary:
                  "Application handler generation is pending until Prompt 45A.",
                blocking: false,
                affectedContractReferences: [],
              },
            ],
            compatibility: { applicationGenerators: [], modelGateways: [] },
            unresolvedRequirementIds: [],
          },
        ],
      },
    }),
  );
}

export function architectureCliEventFixtureSnapshot(
  changed = false,
): ArchitectureCliSemanticSnapshotV1 {
  const base = architectureCliFixtureSnapshot();
  const candidate = {
    ...base,
    contracts: [
      {
        contractKind: "event",
        digest: sha256Digest(
          changed ? "event-contract-v2" : "event-contract-v1",
        ),
        id: "contract_event_queue_work_item",
        version: changed ? "2.0.0" : "1.0.0",
      },
    ],
    eventPolicies: [
      {
        digest: sha256Digest(changed ? "batch-20" : "batch-10"),
        eventId: "event_queue_work_item",
        id: "policy_batch",
        policyKind: "batch",
        workloadId: "workload_event_consumer",
      },
      {
        digest: sha256Digest(changed ? "dlq-8" : "dlq-5"),
        eventId: "event_queue_work_item",
        id: "policy_dlq",
        policyKind: "dlq",
        workloadId: "workload_event_consumer",
      },
      {
        digest: sha256Digest(changed ? "filter-v2" : "filter-v1"),
        eventId: "event_queue_work_item",
        id: "policy_filter",
        policyKind: "filter",
        workloadId: "workload_event_consumer",
      },
      {
        digest: sha256Digest(changed ? "retry-v2" : "retry-v1"),
        eventId: "event_queue_work_item",
        id: "policy_retry",
        policyKind: "retry",
        workloadId: "workload_event_consumer",
      },
    ],
    events: [
      {
        contractId: "contract_event_queue_work_item",
        digest: sha256Digest(changed ? "event-v2" : "event-v1"),
        eventType: "aws.sqs.message",
        id: "event_queue_work_item",
        workloadId: "workload_event_consumer",
      },
    ],
    handlers: [
      {
        digest: sha256Digest(changed ? "handler-v2" : "handler-v1"),
        handlerKind: "aws.lambda.sqs-batch",
        id: "handler_event_consumer",
        workloadId: "workload_event_consumer",
      },
    ],
  };
  const projection = architectureCliSemanticSnapshotV1Schema
    .omit({ snapshotDigest: true })
    .parse(
      Object.fromEntries(
        Object.entries(candidate).filter(([key]) => key !== "snapshotDigest"),
      ),
    );
  return architectureCliSemanticSnapshotV1Schema.parse({
    ...projection,
    snapshotDigest: semanticSnapshotDigest(projection),
  });
}

export function architectureCliEventFixtureArtifact(): SolutionExportArtifactV1 {
  const baseArtifact = architectureCliNetworkingFixtureArtifact();
  const document = eventArchitecture(baseArtifact);
  const baseRevision = solutionRevisionManifestV1Schema.parse(
    jsonFile(baseArtifact, "cloudmarkup/solution.json"),
  );
  const solutionRevisionId = "solution_event_queue_consumer_revision_1";
  const revision = solutionRevisionManifestV1Schema.parse({
    ...baseRevision,
    solutionRevisionId,
    architecture: {
      ...baseRevision.architecture,
      revisionId: document.revision.revisionId,
      contentHash: getArchitectureDocumentContentHash(document),
      documentHash: getArchitectureDocumentCanonicalHash(document),
      visualHash: getArchitectureDocumentVisualHash(document),
    },
    workload: {
      ...baseRevision.workload,
      contentHash: getWorkloadBehaviorContentHash(document.workloadBehavior),
    },
    contracts: {
      ...baseRevision.contracts,
      contentHash: getApplicationContractsContentHash(
        document.applicationContracts,
      ),
    },
    externalResources: {
      ...baseRevision.externalResources,
      contentHash: getExternalResourceReferenceContentHash(
        document.externalResources,
      ),
    },
    generationCoverage: {
      ...baseRevision.generationCoverage,
      solutionRevisionId,
    },
    versions: { ...baseRevision.versions, catalog: EVENT_CATALOG },
  });
  const revisionDigest = sha256Digest(serializeCanonicalJson(revision));
  const {
    applicationContracts,
    externalResources,
    workloadBehavior,
    ...architecture
  } = document;
  const tools = {
    ...baseArtifact.manifest.tools,
    catalog: EVENT_CATALOG,
    generator: null,
  };
  const lock = {
    contractVersion: 1,
    inputs: {
      applicationContracts: revision.contracts.contentHash,
      architecture: revision.architecture.documentHash,
      externalResources: revision.externalResources.contentHash,
      workload: revision.workload.contentHash,
    },
    kind: "cloudmarkup.solution-export-lock",
    solutionRevision: { digest: revisionDigest, id: solutionRevisionId },
    tools,
  } as const;
  const infrastructure = textFile(
    "infrastructure/eventing.tf",
    readFileSync(terraformPath, "utf8"),
    "application/vnd.hashicorp.terraform",
    solutionRevisionId,
  );
  const pendingContracts = {
    contractVersion: 1,
    kind: "cloudmarkup.event-contract-placeholders",
    solutionRevisionId,
    state: "application-generation-pending-prompt-45a",
    contracts: [
      {
        id: "event.queue.work-item.v1",
        direction: "inbound",
        delivery: "at-least-once",
        duplicates: "possible",
        ordering: "not-guaranteed",
        payload: "pending-prompt-45a",
      },
    ],
  };
  const repositorySnapshot = {
    contractVersion: 1,
    kind: "cloudmarkup.repository-snapshot-fixture",
    solutionRevisionId,
    sourceOfTruth: [
      "cloudmarkup/architecture.json",
      "cloudmarkup/workloads.json",
      "cloudmarkup/contracts/application-contracts.json",
      "cloudmarkup/solution.json",
    ],
    generated: ["infrastructure/eventing.tf"],
    planned: ["evidence/sanitized-plan-diff.json"],
    deployed: [],
  };
  const sanitizedPlanDiff = {
    contractVersion: 1,
    kind: "cloudmarkup.sanitized-plan-diff-fixture",
    credentials: false,
    changes: [
      { address: "aws_sqs_queue.work", action: "create" },
      { address: "aws_sqs_queue.work_dlq", action: "create" },
      { address: "aws_lambda_event_source_mapping.work", action: "create" },
    ],
    redactions: ["account-id", "artifact-path"],
  };
  const payload = [
    textFile(
      "README.md",
      "# Event queue consumer architecture\n",
      "text/markdown",
      solutionRevisionId,
    ),
    textFile(
      "cloudmarkup/architecture.json",
      serializeCanonicalJson(architecture),
      "application/json",
      solutionRevisionId,
      "architecture-as-code-source",
    ),
    textFile(
      "cloudmarkup/workloads.json",
      serializeCanonicalJson(workloadBehavior),
      "application/json",
      solutionRevisionId,
      "architecture-as-code-source",
    ),
    textFile(
      "cloudmarkup/external-resources.json",
      serializeCanonicalJson(externalResources),
      "application/json",
      solutionRevisionId,
      "architecture-as-code-source",
    ),
    textFile(
      "cloudmarkup/contracts/application-contracts.json",
      serializeCanonicalJson(applicationContracts),
      "application/json",
      solutionRevisionId,
      "architecture-as-code-source",
    ),
    textFile(
      "cloudmarkup/contracts/event-contracts.pending.json",
      serializeCanonicalJson(pendingContracts),
      "application/json",
      solutionRevisionId,
      "evidence-artifact",
    ),
    textFile(
      "cloudmarkup/repository-snapshot.json",
      serializeCanonicalJson(repositorySnapshot),
      "application/json",
      solutionRevisionId,
      "evidence-artifact",
    ),
    textFile(
      "cloudmarkup/solution.json",
      serializeCanonicalJson(revision),
      "application/json",
      solutionRevisionId,
      "architecture-as-code-source",
    ),
    textFile(
      "cloudmarkup/cloudmarkup.lock.json",
      serializeCanonicalJson(lock),
      "application/json",
      solutionRevisionId,
    ),
    infrastructure,
    textFile(
      "evidence/sanitized-plan-diff.json",
      serializeCanonicalJson(sanitizedPlanDiff),
      "application/json",
      solutionRevisionId,
      "evidence-artifact",
    ),
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const manifest = solutionExportManifestV1Schema.parse({
    ...baseArtifact.manifest,
    files: payload.map(manifestFile),
    generationCoverage: { revision: revision.generationCoverage },
    infrastructure: { artifactDigest: sha256Digest(infrastructure.bytes) },
    inputs: {
      applicationContracts: revision.contracts.contentHash,
      architectureContent: revision.architecture.contentHash,
      architectureDocument: revision.architecture.documentHash,
      architectureVisual: revision.architecture.visualHash,
      externalResources: revision.externalResources.contentHash,
      workload: revision.workload.contentHash,
    },
    limits: {
      maxArchiveBytes: SOLUTION_EXPORT_V1_MAXIMA.archiveBytes,
      maxDecompressedBytes: SOLUTION_EXPORT_V1_MAXIMA.decompressedBytes,
      maxFileBytes: SOLUTION_EXPORT_V1_MAXIMA.fileBytes,
      maxFiles: SOLUTION_EXPORT_V1_MAXIMA.files,
      maxPathBytes: SOLUTION_EXPORT_V1_MAXIMA.pathBytes,
    },
    ownership: payload.map((entry) => ({
      conflictBehavior:
        entry.ownership === "generated-replaceable"
          ? "replace-only-when-baseline-matches"
          : "fail-closed",
      ownership: entry.ownership,
      path: repositoryRelativePathSchema.parse(entry.path),
      regeneration:
        entry.ownership === "generated-replaceable"
          ? "verified-replacement"
          : "never",
    })),
    package: {
      archiveFileName: "event-queue-consumer-architecture.zip",
      displayName: "Event queue consumer architecture",
    },
    solutionRevision: { digest: revisionDigest, id: solutionRevisionId },
    tools,
    archive: {
      compression: "store",
      ordering: "utf16-code-unit",
      timestamp: SOLUTION_EXPORT_ZIP_EPOCH,
    },
  });
  const manifestOutput = textFile(
    SOLUTION_EXPORT_MANIFEST_PATH,
    serializeCanonicalJson(manifest),
    "application/json",
    solutionRevisionId,
  );
  const files = [...payload, manifestOutput].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const zipBytes = createDeterministicZip(files);
  return {
    archiveFileName: manifest.package.archiveFileName,
    files,
    manifest,
    manifestDigest: manifestOutput.checksum,
    zipBytes,
    zipDigest: sha256Digest(zipBytes),
  };
}

function generatedEventInfrastructure(
  eventCase: ArchitectureCliGeneratedEventCase,
) {
  const fixture = generatedEventFixture(eventCase);
  const rawApplicationArtifacts =
    fixture.compilation.artifact?.applicationArtifacts ?? [];
  const expectedApplications = eventCase === "sns-fanout-multi" ? 2 : 1;
  if (
    rawApplicationArtifacts.length !== expectedApplications ||
    rawApplicationArtifacts.some(
      (application) =>
        application.contractVersion !== 2 ||
        application.artifactReadiness !==
          "application-artifact-evidence-incomplete",
    )
  ) {
    throw new TypeError(
      `Raw compiler application Evidence is not truthfully incomplete for ${eventCase}.`,
    );
  }
  const infrastructure =
    projectGoCompilationResultToSolutionExportInfrastructure(
      fixture.compilation,
    );
  if (
    infrastructure.resources.length === 0 ||
    infrastructure.policyArtifacts.length === 0 ||
    infrastructure.applicationArtifacts.length !== expectedApplications ||
    infrastructure.applicationArtifacts.some(
      ({ artifactReadiness, expectedArtifact, relativePackagePath }) =>
        artifactReadiness !== "application-artifact-evidence-incomplete" ||
        expectedArtifact === undefined ||
        relativePackagePath !== `../${expectedArtifact.path}`,
    )
  ) {
    throw new TypeError(
      `Compiler infrastructure projection is incomplete for ${eventCase}.`,
    );
  }
  return { fixture, infrastructure };
}

function generatedEventApplicationArtifact(
  eventCase: ArchitectureCliGeneratedEventCase,
): SolutionExportArtifactV1 {
  const { fixture, infrastructure } = generatedEventInfrastructure(eventCase);
  const builds = fixture.applicationBuildRequests.map((request) =>
    passingBuildResult(workflowFixture(), fixture.generation, request),
  );
  const result = localSolutionExportService.generate(
    solutionExportRequestV1Schema.parse({
      application: fixture.generation,
      architectureDocument: fixture.generationRequest.architectureDocument,
      contractVersion: 1,
      existingFiles: [],
      infrastructure,
      solutionRevision: fixture.generationRequest.solutionRevision,
      supplementalFiles: builds.flatMap((build) =>
        applicationBuildSupplementalFiles(build),
      ),
      target: {
        exportName:
          "Generated " + eventPattern(eventCase) + " repository fixture",
        limits: {
          maxArchiveBytes: SOLUTION_EXPORT_V1_MAXIMA.archiveBytes,
          maxDecompressedBytes: SOLUTION_EXPORT_V1_MAXIMA.decompressedBytes,
          maxFileBytes: SOLUTION_EXPORT_V1_MAXIMA.fileBytes,
          maxFiles: SOLUTION_EXPORT_V1_MAXIMA.files,
          maxPathBytes: SOLUTION_EXPORT_V1_MAXIMA.pathBytes,
        },
        policyPacks: [],
        renderer: TEST_RENDERER,
        target: "terraform",
      },
    }),
  );
  if (result.state !== "ready") {
    throw new TypeError(
      `Generated event package is blocked: ${JSON.stringify({ export: result.diagnostics, generation: fixture.generation.artifact.diagnostics })}`,
    );
  }
  return result.artifact;
}

export function architectureCliGeneratedEventFixtureArtifact(
  eventCase: ArchitectureCliGeneratedEventCase = "sqs-consumer-dlq",
): SolutionExportArtifactV1 {
  return generatedEventApplicationArtifact(eventCase);
}

export function architectureCliGeneratedEventInfrastructureProjection(
  eventCase: ArchitectureCliGeneratedEventCase = "sqs-consumer-dlq",
) {
  return generatedEventInfrastructure(eventCase).infrastructure;
}

type EventPolicyKind = "batch" | "dlq" | "filter" | "retry";

function generatedEventSnapshotDescriptor(pattern: CuratedEventPattern): {
  readonly eventType: string;
  readonly handlerKind: string;
  readonly policyKinds: readonly EventPolicyKind[];
} {
  switch (pattern) {
    case "s3-image-metadata":
      return {
        eventType: "aws.s3.object-created",
        handlerKind: "aws.lambda.s3-object-created",
        policyKinds: ["filter", "retry"],
      };
    case "sqs-consumer-dlq":
      return {
        eventType: "aws.sqs.message",
        handlerKind: "aws.lambda.sqs-batch",
        policyKinds: ["batch", "dlq", "filter", "retry"],
      };
    case "sns-fanout-consumer":
      return {
        eventType: "aws.sns.notification",
        handlerKind: "aws.lambda.sns-notification",
        policyKinds: ["retry"],
      };
    case "eventbridge-scheduled":
      return {
        eventType: "aws.eventbridge.scheduled-event",
        handlerKind: "aws.lambda.eventbridge-scheduled",
        policyKinds: ["retry"],
      };
    case "eventbridge-target":
      return {
        eventType: "aws.eventbridge.event",
        handlerKind: "aws.lambda.eventbridge-event",
        policyKinds: ["filter", "retry"],
      };
    case "step-functions-task":
      return {
        eventType: "aws.stepfunctions.task",
        handlerKind: "aws.lambda.step-functions-task",
        policyKinds: ["retry"],
      };
  }
}

function additionalGeneratedEventSnapshot(
  eventCase: Exclude<ArchitectureCliGeneratedEventCase, "sqs-consumer-dlq">,
): ArchitectureCliSemanticSnapshotV1 {
  const fixture = generatedEventFixture(eventCase);
  const base = architectureCliFixtureSnapshot();
  const envelopes = [...fixture.generation.artifact.buildContracts].sort(
    (left, right) => {
      const leftKey = left.contract.workloadId;
      const rightKey = right.contract.workloadId;
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    },
  );
  const expectedBuilds = eventCase === "sns-fanout-multi" ? 2 : 1;
  if (envelopes.length !== expectedBuilds) {
    throw new TypeError(
      "Generated event snapshot requires exact workload contracts.",
    );
  }
  const descriptor = generatedEventSnapshotDescriptor(eventPattern(eventCase));
  const workloads =
    fixture.generationRequest.architectureDocument.workloadBehavior.workloads;
  const facts = envelopes.map((envelope) => {
    const workloadId = envelope.contract.workloadId;
    const workload = workloads.find(({ id }) => id === workloadId);
    const binding = workload?.eventBindings[0];
    if (workload?.eventBindings.length !== 1 || binding === undefined) {
      throw new TypeError(
        "Generated event snapshot requires one explicit typed event binding.",
      );
    }
    const suffix = workloadId.startsWith("workload_")
      ? workloadId.slice("workload_".length)
      : workloadId;
    return {
      binding,
      contractId: binding.contract.contractId,
      eventId: binding.bindingId,
      handlerId: "handler_" + suffix,
      handlerDigest: sha256Digest(serializeCanonicalJson(envelope.contract)),
      workloadId,
    };
  });
  const { snapshotDigest: _snapshotDigest, ...baseProjection } = base;
  void _snapshotDigest;
  const projection = architectureCliSemanticSnapshotV1Schema
    .omit({ snapshotDigest: true })
    .parse({
      ...baseProjection,
      contracts: facts.map(({ binding, contractId }) => ({
        contractKind: "event",
        digest: binding.contract.digest,
        id: contractId,
        version: binding.contract.contractVersion,
      })),
      coverage: {
        evidenceIds:
          fixture.generationRequest.solutionRevision.generationCoverage.evidence.map(
            ({ evidenceId }) => evidenceId,
          ),
        missingRequirements:
          fixture.generation.artifact.coverage.missingRequirements,
        state: fixture.generation.artifact.coverage.state,
        unresolvedRequirementIds: [],
      },
      eventPolicies: facts.flatMap(({ binding, eventId, workloadId }) =>
        descriptor.policyKinds.map((policyKind) => ({
          digest: sha256Digest(policyKind + ":" + binding.contract.digest),
          eventId,
          id: "policy_" + policyKind + "_" + eventId,
          policyKind,
          workloadId,
        })),
      ),
      events: facts.map(({ binding, contractId, eventId, workloadId }) => ({
        contractId,
        digest: binding.contract.digest,
        eventType: descriptor.eventType,
        id: eventId,
        workloadId,
      })),
      handlers: facts.map(({ handlerDigest, handlerId, workloadId }) => ({
        digest: handlerDigest,
        handlerKind: descriptor.handlerKind,
        id: handlerId,
        workloadId,
      })),
      readiness: { reasons: [], state: "ready" },
      solutionRevision: {
        digest: sha256Digest(
          serializeCanonicalJson(fixture.generationRequest.solutionRevision),
        ),
        id: fixture.generationRequest.solutionRevision.solutionRevisionId,
      },
      unresolvedRequirements: [],
    });
  return architectureCliSemanticSnapshotV1Schema.parse({
    ...projection,
    snapshotDigest: semanticSnapshotDigest(projection),
  });
}

export function architectureCliGeneratedEventFixtureSnapshot(
  eventCase: ArchitectureCliGeneratedEventCase = "sqs-consumer-dlq",
): ArchitectureCliSemanticSnapshotV1 {
  if (eventCase !== "sqs-consumer-dlq") {
    return additionalGeneratedEventSnapshot(eventCase);
  }
  const fixture = generatedEventFixture("sqs-consumer-dlq");
  const base = architectureCliFixtureSnapshot();
  const envelope = fixture.generation.artifact.buildContracts[0];
  const workload = fixture.generation.artifact.workloadContracts[0];
  if (envelope === undefined || workload === undefined) {
    throw new TypeError(
      "Generated event snapshot requires one exact workload contract.",
    );
  }
  const workloadId = envelope.contract.workloadId;
  const workloadCoverage = fixture.generation.artifact.coverage.workloads.find(
    (coverage) => coverage.workloadId === workloadId,
  );
  if (workloadCoverage === undefined) {
    throw new TypeError(
      "Generated event snapshot requires exact workload coverage.",
    );
  }
  const { snapshotDigest: _snapshotDigest, ...baseProjection } = base;
  void _snapshotDigest;
  const eventDigest = sha256Digest(
    serializeCanonicalJson({
      applicationContracts:
        fixture.generationRequest.architectureDocument.applicationContracts,
      workload:
        fixture.generationRequest.architectureDocument.workloadBehavior
          .workloads[0],
    }),
  );
  const projection = architectureCliSemanticSnapshotV1Schema
    .omit({ snapshotDigest: true })
    .parse({
      ...baseProjection,
      contracts: [
        {
          contractKind: "event",
          digest: eventDigest,
          id: "contract_event_sqs_consumer_dlq",
          version: "1.0.0",
        },
      ],
      coverage: {
        evidenceIds:
          fixture.generationRequest.solutionRevision.generationCoverage.evidence.map(
            ({ evidenceId }) => evidenceId,
          ),
        missingRequirements:
          fixture.generation.artifact.coverage.missingRequirements,
        state: fixture.generation.artifact.coverage.state,
        unresolvedRequirementIds: [],
      },
      eventPolicies: ["batch", "dlq", "filter", "retry"].map((policyKind) => ({
        digest: sha256Digest(policyKind + ":" + eventDigest),
        eventId: "event_sqs_consumer_dlq",
        id: "policy_" + policyKind + "_event_sqs_consumer_dlq",
        policyKind,
        workloadId,
      })),
      events: [
        {
          contractId: "contract_event_sqs_consumer_dlq",
          digest: eventDigest,
          eventType: "aws.sqs.message",
          id: "event_sqs_consumer_dlq",
          workloadId,
        },
      ],
      handlers: [
        {
          digest: sha256Digest(serializeCanonicalJson(envelope.contract)),
          handlerKind: "aws.lambda.sqs-batch",
          id: "handler_event_sqs_consumer_dlq",
          workloadId,
        },
      ],
      readiness: { reasons: [], state: "ready" },
      solutionRevision: {
        digest: sha256Digest(
          serializeCanonicalJson(fixture.generationRequest.solutionRevision),
        ),
        id: fixture.generationRequest.solutionRevision.solutionRevisionId,
      },
      unresolvedRequirements: [],
    });
  return architectureCliSemanticSnapshotV1Schema.parse({
    ...projection,
    snapshotDigest: semanticSnapshotDigest(projection),
  });
}
