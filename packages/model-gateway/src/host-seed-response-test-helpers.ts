import {
  modelHostSeedPatchResponseV2Schema,
  modelCandidateRepairResponseV1Schema,
  modelHostSeedRepairRequestV2Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
} from "@cloudmarkup/schemas";
import { reviewedHostSeedPatchRepairPromptV3 } from "./prompts/host-seed-patch-repair.js";
import {
  getModelHostSeedPatchResponseToolV2,
  getModelResponseToolV1,
} from "./tools.js";
import { createHostSeedRepairTestRequest } from "./host-seed-test-helpers.js";
import { reviewedHostSeedRepairPromptV2 } from "./prompts/host-seed-repair.js";
import {
  digestStructuredValue,
  serializedByteLength,
  sha256Text,
} from "./security.js";
import { TEST_DIGEST } from "./test-helpers.js";
function present<T>(v: T | undefined): T {
  if (v === undefined) throw Error("Missing synthetic response fixture");
  return v;
}
/** Only synthetic request/response data; no issued seed or validator receipt. */
export function createHostSeedResponseFixtureV3(
  mode: "guided" | "professional" = "guided",
) {
  const request = modelHostSeedRepairRequestV2Schema.parse({
    ...createHostSeedRepairTestRequest(),
    requestedMode: mode,
  });
  const scope = {
    organizationId: "organization_seed_response",
    projectId: "project_seed_response",
    userId: "user_seed_response",
    jobId: "job_seed_response",
  };
  const prompt = reviewedHostSeedRepairPromptV2;
  const descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse({
    budgetDecisionId: "budget_seed_response",
    complexity: "standard",
    contractVersion: 3,
    recordKind: "model-live-seed-invocation-descriptor",
    entitlementDecisionId: "entitlement_seed_response",
    evaluationPolicyId: "cloudmarkup.evaluation.synthetic",
    evaluationPolicyVersion: "1.0.0",
    feature: "candidate.repair",
    idempotencyKeyDigest: TEST_DIGEST,
    inferenceProfileId: "profile.synthetic",
    inputDigest: digestStructuredValue({ request, scope }),
    invocationId: "invocation_seed_response",
    modelId: "model.synthetic",
    modelVersion: "1",
    promptDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptVersion: prompt.version,
    providerFamily: "amazon-bedrock",
    providerId: "provider.synthetic",
    requestedMode: mode,
    role: "repair-escalation",
    scope,
    toolAuthority: "none",
    routing: {
      capabilityRegistryDigest: TEST_DIGEST,
      capabilityRegistryId: "cloudmarkup.synthetic.capabilities",
      capabilityRegistryVersion: "1.0.0",
      capabilityVersion: "1.0.0",
      effort: "high",
      evaluationPolicyId: "cloudmarkup.evaluation.synthetic",
      evaluationPolicyVersion: "1.0.0",
      modelCapabilityDigest: TEST_DIGEST,
      modelConfigurationReference: "cloudmarkup.synthetic.model",
      modelFamily: "cloudmarkup.synthetic.family",
      pricingVersionReference: "cloudmarkup.synthetic.prices",
      routeId: "internal-escalation",
      routeDefinitionDigest: TEST_DIGEST,
      routeRegistryDigest: TEST_DIGEST,
      routeRegistryId: "cloudmarkup.synthetic.routes",
      routeRegistryVersion: "1.0.0",
      routingConfigurationDigest: TEST_DIGEST,
    },
  });
  const source = present(request.failedCandidates[0]);
  const provenance = {
    contractVersion: 1,
    gatewayId: "cloudmarkup.model-gateway",
    ownership: "untrusted-proposal",
    inferenceProfileId: descriptor.inferenceProfileId,
    inputDigest: descriptor.inputDigest,
    invocationId: descriptor.invocationId,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    promptDigest: descriptor.promptDigest,
    promptTemplateId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    providerId: descriptor.providerId,
  };
  const reference = {
    kind: "candidate-artifact",
    digest: request.failedOutputDigest,
    referenceId: source.candidateId,
  };
  const response = modelCandidateRepairResponseV1Schema.parse({
    contractVersion: 1,
    operation: "candidate.repair",
    provenance,
    proposalContext: {
      assumptions: [],
      unknowns: [],
      confidence: {
        basisPoints: 8000,
        rationale: "Synthetic bounded patch.",
        evidenceReferences: [reference],
      },
    },
    candidateBundle: {
      provenance,
      boundary: request.boundary,
      dependencies: [],
      candidates: [
        {
          candidateId: "candidate_seed_patch",
          kind: "patch",
          ownership: "ai-authored-candidate",
          path: source.path,
          baseDigest: source.contentDigest,
          proposedResultDigest: sha256Text("export const repaired = true;\n"),
          unifiedDiff:
            "--- a/" +
            source.path +
            "\n+++ b/" +
            source.path +
            "\n@@ -1 +1 @@\n-" +
            source.content.trimEnd() +
            "\n+export const repaired = true;\n",
        },
      ],
      generationPlan: {
        planId: "plan_seed_patch",
        objective: "Propose one bounded repair.",
        steps: [
          {
            stepId: "step_seed_patch",
            action: "propose-patch",
            targetPath: source.path,
            rationale: "Repair the exact diagnosed source.",
            sourceReferences: [reference],
          },
        ],
      },
      validationExpectations: request.validationExpectations,
    },
    repairedFromDigest: request.failedOutputDigest,
    resolvedDiagnosticIds: request.diagnostics.map((d) => d.diagnosticId),
  });
  const content = {
    kind: "tool-use" as const,
    toolName: getModelResponseToolV1("candidate.repair").toolName,
    input: response,
  };
  const input = {
    descriptor,
    request,
    content,
    maximumOutputBytes: serializedByteLength(content),
    allowedApprovalPathIds: new Set<string>(),
  };
  return { input, response, source };
}

export function createHostSeedPatchResponseFixtureV2(
  mode: "guided" | "professional" = "guided",
) {
  const f = createHostSeedResponseFixtureV3(mode);
  const prompt = reviewedHostSeedPatchRepairPromptV3;
  const fields = {
    promptDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptVersion: prompt.version,
  };
  Object.assign(f.input.descriptor, fields);
  const response = modelHostSeedPatchResponseV2Schema.parse({
    ...f.response,
    contractVersion: 2,
    resultDigestAuthority: "deterministic-host",
    provenance: { ...f.response.provenance, ...fields },
    candidateBundle: {
      ...f.response.candidateBundle,
      provenance: { ...f.response.candidateBundle.provenance, ...fields },
      candidates: f.response.candidateBundle.candidates.map((candidate) => {
        if (candidate.kind !== "patch") throw Error("Synthetic patch required");
        const { proposedResultDigest, ...patch } = candidate;
        void proposedResultDigest;
        return patch;
      }),
    },
  });
  const content = {
    kind: "tool-use" as const,
    toolName: getModelHostSeedPatchResponseToolV2().toolName,
    input: response,
  };
  return {
    ...f,
    response,
    input: {
      ...f.input,
      content,
      maximumOutputBytes: serializedByteLength(content) + 1000,
    },
  };
}
