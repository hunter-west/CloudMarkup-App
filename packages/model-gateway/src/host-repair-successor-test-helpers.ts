import { createHostSeedPatchResponseFixtureV2 } from "./host-seed-response-test-helpers.js";
import { reviewedHostSeedPatchRepairPromptV3 } from "./prompts/host-seed-patch-repair.js";
import {
  modelHostRepairSuccessorRequestV3Schema,
  modelHostSeedPatchResponseV2Schema,
  type ModelHostSeedRepairRequestV2,
  type Sha256Digest,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
} from "@cloudmarkup/schemas";
import type {
  ModelProviderHostSeedInvocationV3,
  ModelProviderHostRepairSuccessorInvocationV4,
} from "./ports.js";
import { reviewedHostBoundedRepairPromptV4 } from "./prompts/host-bounded-repair.js";
import { digestStructuredValue, sha256Text } from "./security.js";
import { getModelHostSeedPatchResponseToolV2 } from "./tools.js";

/** Synthetic transport data only; no issued first outcome or second-stage authority. */
export function createHostRepairSuccessorTestInvocationV4(
  first: ModelProviderHostSeedInvocationV3,
): ModelProviderHostRepairSuccessorInvocationV4 {
  const request = createHostRepairSuccessorTestRequestV3(
    first.request,
    first.descriptor.inputDigest,
  );
  const prompt = reviewedHostBoundedRepairPromptV4;
  return {
    ...structuredClone(first),
    request,
    prompt,
    responseTool: getModelHostSeedPatchResponseToolV2(),
    descriptor: modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse({
      ...first.descriptor,
      contractVersion: 4,
      recordKind: "model-live-repair-successor-invocation-descriptor",
      invocationId: first.descriptor.invocationId + "_successor",
      inputDigest: digestStructuredValue({
        request,
        scope: first.descriptor.scope,
      }),
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
    }),
  };
}

/** Synthetic request metadata only, with no issued predecessor authority. */
export function createHostRepairSuccessorTestRequestV3(
  first: ModelHostSeedRepairRequestV2,
  inputDigest: Sha256Digest = digestStructuredValue("synthetic-first-input"),
) {
  const original = first.failedCandidates[0];
  if (!original) throw Error("Missing synthetic prior candidate");
  const content = original.content + "// prior unaccepted repair\n";
  const file = {
    ...original,
    content,
    contentDigest: sha256Text(content),
    ownership: "user-owned-preserved",
    sourceAuthority: "unaccepted-model-repair",
  };
  return modelHostRepairSuccessorRequestV3Schema.parse({
    ...first,
    contractVersion: 3,
    currentAttempt: 2,
    failedCandidates: [file],
    failedOutputDigest: digestStructuredValue([file]),
    failedCandidatesCanonicalization:
      "cloudmarkup.model-host-repair-successor-files.canonical-json.v3",
    predecessor: {
      stageId: "live_stage_" + "1".repeat(32),
      invocationId: "invocation_" + "2".repeat(32),
      inputDigest: inputDigest,
      responseDigest: digestStructuredValue("synthetic-first-response"),
      sourceTreeDigest: digestStructuredValue("synthetic-first-source"),
      contentDigest: file.contentDigest,
      validationReceiptDigest: digestStructuredValue(
        "synthetic-first-validation",
      ),
      outcomeDigest: digestStructuredValue("synthetic-first-outcome"),
    },
  });
}

export function createHostRepairSuccessorResponseFixtureV4() {
  const first = createHostSeedPatchResponseFixtureV2();
  const invocation = createHostRepairSuccessorTestInvocationV4({
    descriptor: first.input.descriptor,
    request: first.input.request,
    prompt: reviewedHostSeedPatchRepairPromptV3,
    responseTool: getModelHostSeedPatchResponseToolV2(),
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
    maximumOutputBytes: 100_000,
    maximumOutputTokens: 8192,
    timeoutMilliseconds: 5000,
  });
  const response = modelHostSeedPatchResponseV2Schema.parse(
    JSON.parse(
      JSON.stringify(first.response).replaceAll(
        first.input.request.failedOutputDigest,
        invocation.request.failedOutputDigest,
      ),
    ),
  );
  const provenance = {
    ...response.provenance,
    invocationId: invocation.descriptor.invocationId,
    inputDigest: invocation.descriptor.inputDigest,
    promptDigest: invocation.prompt.digest,
    promptTemplateId: invocation.descriptor.promptTemplateId,
    promptVersion: invocation.prompt.version,
  };
  response.provenance = provenance;
  response.candidateBundle.provenance = provenance;
  const file = invocation.request.failedCandidates[0];
  const patch = response.candidateBundle.candidates[0];
  if (!file || !patch) throw Error("Missing synthetic final repair");
  patch.baseDigest = file.contentDigest;
  patch.unifiedDiff =
    patch.unifiedDiff.replace("@@ -1 +1 @@", "@@ -1,2 +1,2 @@") +
    " // prior unaccepted repair\n";
  const input = {
    descriptor: invocation.descriptor,
    request: invocation.request,
    content: {
      kind: "tool-use" as const,
      toolName: invocation.responseTool.toolName,
      input: response,
    },
    allowedApprovalPathIds: new Set<string>(),
    maximumOutputBytes: 100_000,
  };
  return { first, invocation, response, input, patch };
}
