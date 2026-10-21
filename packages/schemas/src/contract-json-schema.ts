import { modelHostSeedPatchResponseV2Schema } from "./model-host-seed-patch-response-v2.js";
import { modelLiveSequenceRuntimeRecordV4Schema } from "./model-live-sequence-runtime-v4.js";
import { modelLiveSequenceAttemptRecordV4Schema } from "./model-live-sequence-attempt-v4.js";
import { z } from "zod";
import { modelHostRepairSuccessorRequestV3Schema } from "./model-host-repair-successor-v3.js";
import { modelHostSeedRepairRequestV2Schema } from "./model-host-seed-repair-v2.js";

import { activeIssueV1Schema } from "./active-issue-v1.js";
import { aiAuthoredExtensionV1Schema } from "./ai-authored-extension-v1.js";
import {
  applicationGenerationRequestV1Schema,
  applicationGenerationResultV1Schema,
} from "./application-generation-v1.js";
import { conformanceReportV1Schema } from "./conformance-v1.js";
import { evidenceRecordV1Schema } from "./evidence-v1.js";
import { solutionGenerationCoverageV1Schema } from "./generation-coverage-v1.js";
import {
  modelGatewayRequestV1Schema,
  modelGatewayResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
} from "./model-gateway-v1.js";
import {
  modelCacheKeyInputV1Schema,
  modelCapabilityRegistryV1Schema,
  modelRouteEstimateInputV1Schema,
  modelRouteRegistryV1Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingFeatureAuthorityV1,
  modelRoutingRequestV1Schema,
  modelRoutingUiStateV1Schema,
} from "./model-routing-v1.js";
import { modelLiveEvaluationSequenceRecordV3Schema } from "./model-live-evaluation-sequence-v3.js";
import { observedSolutionV1Schema } from "./observed-solution-v1.js";
import { reconciliationProposalV1Schema } from "./reconciliation-proposal-v1.js";
import {
  cloudMarkupRepositoryLockV1Schema,
  cloudMarkupRepositoryManifestV1Schema,
} from "./repository-ownership-v1.js";
import { repositorySnapshotV1Schema } from "./repository-snapshot-v1.js";
import { solutionRevisionManifestV1Schema } from "./solution-revision-v1.js";

function generateJsonSchema(
  schema: z.ZodType,
  id: string,
  title: string,
  reused: "inline" | "ref" = "inline",
): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    io: "input",
    target: "draft-2020-12",
    reused,
  });

  return { ...generated, $id: id, title };
}

export function generateApplicationGenerationRequestV1JsonSchema() {
  return generateJsonSchema(
    applicationGenerationRequestV1Schema,
    "https://schemas.cloudmarkup.com/application-generation-request/v1.schema.json",
    "Cloud Markup Application Generation Request v1",
  );
}

export function generateApplicationGenerationResultV1JsonSchema() {
  return generateJsonSchema(
    applicationGenerationResultV1Schema,
    "https://schemas.cloudmarkup.com/application-generation-result/v1.schema.json",
    "Cloud Markup Application Generation Result v1",
  );
}

export function generateRepositorySnapshotV1JsonSchema() {
  return generateJsonSchema(
    repositorySnapshotV1Schema,
    "https://schemas.cloudmarkup.com/repository-snapshot/v1.schema.json",
    "Cloud Markup Repository Snapshot v1",
  );
}

export function generateObservedSolutionV1JsonSchema() {
  return generateJsonSchema(
    observedSolutionV1Schema,
    "https://schemas.cloudmarkup.com/observed-solution/v1.schema.json",
    "Cloud Markup Observed Solution v1",
  );
}

export function generateReconciliationProposalV1JsonSchema() {
  return generateJsonSchema(
    reconciliationProposalV1Schema,
    "https://schemas.cloudmarkup.com/reconciliation-proposal/v1.schema.json",
    "Cloud Markup Reconciliation Proposal v1",
  );
}

export function generateCloudMarkupRepositoryLockV1JsonSchema() {
  return generateJsonSchema(
    cloudMarkupRepositoryLockV1Schema,
    "https://schemas.cloudmarkup.com/cloudmarkup-repository-lock/v1.schema.json",
    "Cloud Markup Repository Lock v1",
  );
}

export function generateCloudMarkupRepositoryManifestV1JsonSchema() {
  return generateJsonSchema(
    cloudMarkupRepositoryManifestV1Schema,
    "https://schemas.cloudmarkup.com/cloudmarkup-repository-manifest/v1.schema.json",
    "Cloud Markup Repository Manifest v1",
  );
}

export function generateSolutionRevisionManifestV1JsonSchema() {
  return generateJsonSchema(
    solutionRevisionManifestV1Schema,
    "https://schemas.cloudmarkup.com/solution-revision-manifest/v1.schema.json",
    "Cloud Markup Solution Revision Manifest v1",
  );
}

export function generateAiAuthoredExtensionV1JsonSchema() {
  return generateJsonSchema(
    aiAuthoredExtensionV1Schema,
    "https://schemas.cloudmarkup.com/ai-authored-extension/v1.schema.json",
    "Cloud Markup AI-authored Extension v1",
  );
}

export function generateSolutionGenerationCoverageV1JsonSchema() {
  return generateJsonSchema(
    solutionGenerationCoverageV1Schema,
    "https://schemas.cloudmarkup.com/solution-generation-coverage/v1.schema.json",
    "Cloud Markup Solution Generation Coverage v1",
  );
}

export function generateActiveIssueV1JsonSchema() {
  return generateJsonSchema(
    activeIssueV1Schema,
    "https://schemas.cloudmarkup.com/active-issue/v1.schema.json",
    "Cloud Markup Active Issue v1",
  );
}

export function generateEvidenceRecordV1JsonSchema() {
  return generateJsonSchema(
    evidenceRecordV1Schema,
    "https://schemas.cloudmarkup.com/evidence-record/v1.schema.json",
    "Cloud Markup Evidence Record v1",
  );
}

export function generateConformanceReportV1JsonSchema() {
  return generateJsonSchema(
    conformanceReportV1Schema,
    "https://schemas.cloudmarkup.com/conformance-report/v1.schema.json",
    "Cloud Markup Continuous Conformance Report v1",
  );
}

export function generateModelGatewayRequestV1JsonSchema() {
  return generateJsonSchema(
    modelGatewayRequestV1Schema,
    "https://schemas.cloudmarkup.com/model-gateway-request/v1.schema.json",
    "Cloud Markup ModelGateway Request v1",
    "ref",
  );
}

export function generateModelHostRepairSuccessorRequestV3JsonSchema() {
  return generateJsonSchema(
    modelHostRepairSuccessorRequestV3Schema,
    "https://schemas.cloudmarkup.com/model-host-repair-successor-request/v3.schema.json",
    "Cloud Markup Host Repair Successor Request v3",
  );
}

export function generateModelHostSeedRepairRequestV2JsonSchema() {
  return generateJsonSchema(
    modelHostSeedRepairRequestV2Schema,
    "https://schemas.cloudmarkup.com/model-host-seed-repair-request/v2.schema.json",
    "Cloud Markup Host Seed Repair Request v2",
  );
}

export function generateModelGatewayResponseV1JsonSchema() {
  return generateJsonSchema(
    modelGatewayResponseV1Schema,
    "https://schemas.cloudmarkup.com/model-gateway-response/v1.schema.json",
    "Cloud Markup ModelGateway Response v1",
    "ref",
  );
}

export function generateModelInvocationDescriptorV1JsonSchema() {
  return generateJsonSchema(
    modelInvocationDescriptorV1Schema,
    "https://schemas.cloudmarkup.com/model-invocation-descriptor/v1.schema.json",
    "Cloud Markup Model Invocation Descriptor v1",
  );
}

export function generateNormalizedModelUsageV1JsonSchema() {
  return generateJsonSchema(
    normalizedModelUsageV1Schema,
    "https://schemas.cloudmarkup.com/normalized-model-usage/v1.schema.json",
    "Cloud Markup Normalized Model Usage v1",
  );
}

export function generateModelCapabilityRegistryV1JsonSchema() {
  return generateJsonSchema(
    modelCapabilityRegistryV1Schema,
    "https://schemas.cloudmarkup.com/model-capability-registry/v1.schema.json",
    "Cloud Markup Model Capability Registry v1",
  );
}

export function generateModelRouteRegistryV1JsonSchema() {
  return generateJsonSchema(
    modelRouteRegistryV1Schema,
    "https://schemas.cloudmarkup.com/model-route-registry/v1.schema.json",
    "Cloud Markup Model Route Registry v1",
  );
}

export function generateModelRoutingRequestV1JsonSchema() {
  const generated = generateJsonSchema(
    modelRoutingRequestV1Schema,
    "https://schemas.cloudmarkup.com/model-routing-request/v1.schema.json",
    "Cloud Markup Model Routing Request v1",
  );
  return {
    ...generated,
    allOf: [
      ...((generated["allOf"] as readonly unknown[] | undefined) ?? []),
      {
        oneOf: Object.entries(modelRoutingFeatureAuthorityV1).map(
          ([feature, authority]) => ({
            properties: {
              expectedOutputClass: {
                const: authority.expectedOutputClass,
              },
              feature: { const: feature },
              operationClass: { const: authority.operationClass },
            },
            required: ["expectedOutputClass", "feature", "operationClass"],
          }),
        ),
      },
    ],
  };
}

export function generateModelRoutingDecisionV1JsonSchema() {
  return generateJsonSchema(
    modelRoutingDecisionV1Schema,
    "https://schemas.cloudmarkup.com/model-routing-decision/v1.schema.json",
    "Cloud Markup Model Routing Decision v1",
  );
}

export function generateModelCacheKeyInputV1JsonSchema() {
  return generateJsonSchema(
    modelCacheKeyInputV1Schema,
    "https://schemas.cloudmarkup.com/model-cache-key-input/v1.schema.json",
    "Cloud Markup Model Cache Key Input v1",
  );
}

export function generateModelRouteEstimateInputV1JsonSchema() {
  return generateJsonSchema(
    modelRouteEstimateInputV1Schema,
    "https://schemas.cloudmarkup.com/model-route-estimate-input/v1.schema.json",
    "Cloud Markup Model Route Estimate Input v1",
  );
}

export function generateModelRoutingUiStateV1JsonSchema() {
  return generateJsonSchema(
    modelRoutingUiStateV1Schema,
    "https://schemas.cloudmarkup.com/model-routing-ui-state/v1.schema.json",
    "Cloud Markup Model Routing UI State v1",
  );
}

export function generateModelLiveEvaluationSequenceV3JsonSchema() {
  return generateJsonSchema(
    modelLiveEvaluationSequenceRecordV3Schema,
    "https://schemas.cloudmarkup.com/model-live-evaluation-sequence/v3.schema.json",
    "Cloud Markup Live Evaluation Sequence Metadata v3",
  );
}

export function generateModelLiveSequenceAttemptV4JsonSchema() {
  return generateJsonSchema(
    modelLiveSequenceAttemptRecordV4Schema,
    "https://schemas.cloudmarkup.com/model-live-sequence-attempt/v4.schema.json",
    "Cloud Markup Live Sequence Attempt Metadata v4",
  );
}

export function generateModelLiveSequenceRuntimeV4JsonSchema() {
  return generateJsonSchema(
    modelLiveSequenceRuntimeRecordV4Schema,
    "https://schemas.cloudmarkup.com/model-live-sequence-runtime/v4.schema.json",
    "Cloud Markup Live Sequence Runtime Metadata v4",
  );
}

export function generateModelHostSeedPatchResponseV2JsonSchema() {
  return generateJsonSchema(
    modelHostSeedPatchResponseV2Schema,
    "https://schemas.cloudmarkup.com/model-host-seed-patch-response/v2.schema.json",
    "Cloud Markup Host Seed Patch Response v2",
  );
}
