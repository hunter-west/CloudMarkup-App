import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  generateActiveIssueV1JsonSchema,
  generateAiAuthoredExtensionV1JsonSchema,
  generateApplicationGenerationRequestV1JsonSchema,
  generateApplicationGenerationResultV1JsonSchema,
  generateAsyncJobV1JsonSchema,
  generateAssistantWorkflowV1JsonSchema,
  generateApplicationContractsV1JsonSchema,
  generateArchitectureDocumentV1JsonSchema,
  generateArchitectureDocumentV2JsonSchema,
  generateArchitectureDocumentV3JsonSchema,
  generateCloudMarkupRepositoryLockV1JsonSchema,
  generateCloudMarkupRepositoryManifestV1JsonSchema,
  generateConformanceReportV1JsonSchema,
  generateEvidenceRecordV1JsonSchema,
  generateExternalResourceReferenceDocumentV1JsonSchema,
  generateGraphCommandV1JsonSchema,
  generateIntentDocumentV1JsonSchema,
  generateModelEvaluationV1JsonSchema,
  generateModelLiveEvaluationSequenceV3JsonSchema,
  generateModelLiveSequenceAttemptV4JsonSchema,
  generateModelLiveSequenceRuntimeV4JsonSchema,
  generateModelGatewayRequestV1JsonSchema,
  generateModelHostRepairSuccessorRequestV3JsonSchema,
  generateModelHostSeedRepairRequestV2JsonSchema,
  generateModelHostSeedPatchResponseV2JsonSchema,
  generateModelGatewayResponseV1JsonSchema,
  generateModelCacheKeyInputV1JsonSchema,
  generateModelCapabilityRegistryV1JsonSchema,
  generateModelInvocationDescriptorV1JsonSchema,
  generateModelRouteEstimateInputV1JsonSchema,
  generateModelRouteRegistryV1JsonSchema,
  generateModelRoutingDecisionV1JsonSchema,
  generateModelRoutingRequestV1JsonSchema,
  generateModelRoutingUiStateV1JsonSchema,
  generateNormalizedModelUsageV1JsonSchema,
  generateObservedSolutionV1JsonSchema,
  generateReconciliationProposalV1JsonSchema,
  generateRepositorySnapshotV1JsonSchema,
  generateSolutionGenerationCoverageV1JsonSchema,
  generateSolutionRevisionManifestV1JsonSchema,
  generateWorkloadBehaviorV2JsonSchema,
  parseArchitectureDocumentV1Json,
  parseArchitectureDocumentV2Json,
  parseArchitectureDocumentV3Json,
  parseIntentDocumentV1Json,
  serializeArchitectureDocumentV1,
  serializeArchitectureDocumentV2,
  serializeArchitectureDocumentV3,
  serializeCanonicalJson,
  serializeIntentDocumentV1,
} from "../dist/index.js";

const mode = process.argv[2];
const architectureFixture = parseArchitectureDocumentV1Json(
  await readFile(
    new URL(
      "../../test-fixtures/fixtures/architecture-document/v1/valid/representative.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const architectureV2Fixture = parseArchitectureDocumentV2Json(
  await readFile(
    new URL(
      "../../test-fixtures/fixtures/architecture-document/v2/valid/representative.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const architectureV3Fixture = parseArchitectureDocumentV3Json(
  await readFile(
    new URL(
      "../../test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const intentFixture = parseIntentDocumentV1Json(
  await readFile(
    new URL(
      "../../test-fixtures/fixtures/intent-document/v1/valid/representative.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

// Compact generated schema storage only. Persisted document canonicalization and
// its versioned bytes remain owned by serializeCanonicalJson.
function serializeSchemaArtifact(schema) {
  return JSON.stringify(JSON.parse(serializeCanonicalJson(schema))) + "\n";
}

function jsonSchemaArtifact(label, fileName, generate) {
  return {
    label,
    url: new URL("../json-schema/" + fileName, import.meta.url),
    expected: serializeSchemaArtifact(generate()),
  };
}

const artifacts = [
  jsonSchemaArtifact(
    "Live Sequence Runtime Metadata v4",
    "model-live-sequence-runtime-v4.schema.json",
    generateModelLiveSequenceRuntimeV4JsonSchema,
  ),
  jsonSchemaArtifact(
    "Live Sequence Attempt Metadata v4",
    "model-live-sequence-attempt-v4.schema.json",
    generateModelLiveSequenceAttemptV4JsonSchema,
  ),
  jsonSchemaArtifact(
    "Live Evaluation Sequence Metadata v3",
    "model-live-evaluation-sequence-v3.schema.json",
    generateModelLiveEvaluationSequenceV3JsonSchema,
  ),
  jsonSchemaArtifact(
    "Application Generation Request v1",
    "application-generation-request-v1.schema.json",
    generateApplicationGenerationRequestV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Application Generation Result v1",
    "application-generation-result-v1.schema.json",
    generateApplicationGenerationResultV1JsonSchema,
  ),
  {
    label: "Architecture Document v1",
    url: new URL(
      "../json-schema/architecture-document-v1.schema.json",
      import.meta.url,
    ),
    expected: serializeSchemaArtifact(
      generateArchitectureDocumentV1JsonSchema(),
    ),
  },
  {
    label: "Architecture Document v2",
    url: new URL(
      "../json-schema/architecture-document-v2.schema.json",
      import.meta.url,
    ),
    expected: serializeSchemaArtifact(
      generateArchitectureDocumentV2JsonSchema(),
    ),
  },
  jsonSchemaArtifact(
    "Async Job v1",
    "async-job-v1.schema.json",
    generateAsyncJobV1JsonSchema,
    generateAssistantWorkflowV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Assistant Workflow v1",
    "assistant-workflow-v1.schema.json",
    generateAssistantWorkflowV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Architecture Document v3",
    "architecture-document-v3.schema.json",
    generateArchitectureDocumentV3JsonSchema,
  ),
  jsonSchemaArtifact(
    "Application Contracts v1",
    "application-contracts-v1.schema.json",
    generateApplicationContractsV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Workload Behavior v2",
    "workload-behavior-v2.schema.json",
    generateWorkloadBehaviorV2JsonSchema,
  ),
  jsonSchemaArtifact(
    "External Resource Reference Document v1",
    "external-resource-reference-document-v1.schema.json",
    generateExternalResourceReferenceDocumentV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Repository Snapshot v1",
    "repository-snapshot-v1.schema.json",
    generateRepositorySnapshotV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Observed Solution v1",
    "observed-solution-v1.schema.json",
    generateObservedSolutionV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Reconciliation Proposal v1",
    "reconciliation-proposal-v1.schema.json",
    generateReconciliationProposalV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Cloud Markup Repository Lock v1",
    "cloudmarkup-repository-lock-v1.schema.json",
    generateCloudMarkupRepositoryLockV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Cloud Markup Repository Manifest v1",
    "cloudmarkup-repository-manifest-v1.schema.json",
    generateCloudMarkupRepositoryManifestV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Continuous Conformance Report v1",
    "conformance-report-v1.schema.json",
    generateConformanceReportV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Solution Revision Manifest v1",
    "solution-revision-manifest-v1.schema.json",
    generateSolutionRevisionManifestV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "AI-authored Extension v1",
    "ai-authored-extension-v1.schema.json",
    generateAiAuthoredExtensionV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Solution Generation Coverage v1",
    "solution-generation-coverage-v1.schema.json",
    generateSolutionGenerationCoverageV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Active Issue v1",
    "active-issue-v1.schema.json",
    generateActiveIssueV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Evidence Record v1",
    "evidence-record-v1.schema.json",
    generateEvidenceRecordV1JsonSchema,
  ),
  {
    label: "Graph Command v1",
    url: new URL(
      "../json-schema/graph-command-v1.schema.json",
      import.meta.url,
    ),
    expected: serializeSchemaArtifact(generateGraphCommandV1JsonSchema()),
  },
  {
    label: "Intent Document v1",
    url: new URL(
      "../json-schema/intent-document-v1.schema.json",
      import.meta.url,
    ),
    expected: serializeSchemaArtifact(generateIntentDocumentV1JsonSchema()),
  },
  jsonSchemaArtifact(
    "Model Evaluation and Runtime Controls v1",
    "model-evaluation-v1.schema.json",
    generateModelEvaluationV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "ModelGateway Request v1",
    "model-gateway-request-v1.schema.json",
    generateModelGatewayRequestV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Host Seed Patch Response v2",
    "model-host-seed-patch-response-v2.schema.json",
    generateModelHostSeedPatchResponseV2JsonSchema,
  ),
  jsonSchemaArtifact(
    "Host Repair Successor Request v3",
    "model-host-repair-successor-request-v3.schema.json",
    generateModelHostRepairSuccessorRequestV3JsonSchema,
  ),
  jsonSchemaArtifact(
    "Host Seed Repair Request v2",
    "model-host-seed-repair-request-v2.schema.json",
    generateModelHostSeedRepairRequestV2JsonSchema,
  ),
  jsonSchemaArtifact(
    "ModelGateway Response v1",
    "model-gateway-response-v1.schema.json",
    generateModelGatewayResponseV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Model Invocation Descriptor v1",
    "model-invocation-descriptor-v1.schema.json",
    generateModelInvocationDescriptorV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Normalized Model Usage v1",
    "normalized-model-usage-v1.schema.json",
    generateNormalizedModelUsageV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Model Capability Registry v1",
    "model-capability-registry-v1.schema.json",
    generateModelCapabilityRegistryV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Model Route Registry v1",
    "model-route-registry-v1.schema.json",
    generateModelRouteRegistryV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Model Routing Request v1",
    "model-routing-request-v1.schema.json",
    generateModelRoutingRequestV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Model Routing Decision v1",
    "model-routing-decision-v1.schema.json",
    generateModelRoutingDecisionV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Model Cache Key Input v1",
    "model-cache-key-input-v1.schema.json",
    generateModelCacheKeyInputV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Model Route Estimate Input v1",
    "model-route-estimate-input-v1.schema.json",
    generateModelRouteEstimateInputV1JsonSchema,
  ),
  jsonSchemaArtifact(
    "Model Routing UI State v1",
    "model-routing-ui-state-v1.schema.json",
    generateModelRoutingUiStateV1JsonSchema,
  ),
  {
    label: "Architecture Document v1 canonical fixture snapshot",
    url: new URL(
      "../../test-fixtures/fixtures/document-versioning/snapshots/architecture-document-v1.canonical.json",
      import.meta.url,
    ),
    expected: serializeArchitectureDocumentV1(architectureFixture),
  },
  {
    label: "Architecture Document v2 canonical fixture snapshot",
    url: new URL(
      "../../test-fixtures/fixtures/document-versioning/snapshots/architecture-document-v2.canonical.json",
      import.meta.url,
    ),
    expected: serializeArchitectureDocumentV2(architectureV2Fixture),
  },
  {
    label: "Architecture Document v3 canonical fixture snapshot",
    url: new URL(
      "../../test-fixtures/fixtures/document-versioning/snapshots/architecture-document-v3.canonical.json",
      import.meta.url,
    ),
    expected: serializeArchitectureDocumentV3(architectureV3Fixture),
  },
  {
    label: "Intent Document v1 canonical fixture snapshot",
    url: new URL(
      "../../test-fixtures/fixtures/document-versioning/snapshots/intent-document-v1.canonical.json",
      import.meta.url,
    ),
    expected: serializeIntentDocumentV1(intentFixture),
  },
];

if (mode === "--write") {
  for (const artifact of artifacts) {
    await mkdir(fileURLToPath(new URL(".", artifact.url)), { recursive: true });
    await writeFile(artifact.url, artifact.expected, "utf8");
  }
} else if (mode === "--check") {
  for (const artifact of artifacts) {
    let actual;

    try {
      actual = await readFile(artifact.url, "utf8");
    } catch {
      throw new Error(
        `${artifact.label} artifact is missing. Run pnpm generate:artifacts.`,
      );
    }

    if (actual !== artifact.expected) {
      throw new Error(
        `${artifact.label} artifact is stale. Run pnpm generate:artifacts.`,
      );
    }
  }
} else {
  throw new Error("Expected --write or --check.");
}
