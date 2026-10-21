// Synthetic response/session fixtures only; never provider or native execution proof.
import {
  sha256Text,
  resolveReviewedHostPatchRepairPromptV3,
  type ModelProviderHostSeedInvocationV3,
  type ModelProviderHostRepairSuccessorInvocationV4,
} from "@cloudmarkup/model-gateway";
import {
  createHostSeedResponseFixtureV3,
  createHostSeedPatchResponseFixtureV2,
} from "@cloudmarkup/model-gateway/testing";
import {
  applicationHostRepairCandidatePolicyV1Schema,
  createApplicationHostRepairCandidateProfileV1,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import { hostExecutionFixture } from "./production-model-live-repair-seed-execution-fixture.js";
import {
  createHostExecutionHarness,
  type Hooks,
} from "./production-model-live-host-runner-test-helpers.js";

export function seedCandidateExecutionFixture(
  invocation:
    | ModelProviderHostSeedInvocationV3
    | ModelProviderHostRepairSuccessorInvocationV4,
  hooks: Hooks = {},
  repairable = false,
) {
  const { request, descriptor } = invocation;
  const source = request.failedCandidates[0];
  if (source === undefined) throw Error("Missing restored source.");
  const repaired = repairable
    ? source.content + "// synthetic repair retains the witnessed defect\n"
    : source.content.replace(
        'repairSeedTypeWitness: number = "invalid"',
        'repairSeedTypeWitness: number = Number("1")',
      );
  const before = source.content.trimEnd().split("\n"),
    after = repaired.trimEnd().split("\n");
  const f =
    descriptor.contractVersion === 4 ||
    resolveReviewedHostPatchRepairPromptV3(descriptor) !== null
      ? createHostSeedPatchResponseFixtureV2(request.requestedMode)
      : createHostSeedResponseFixtureV3(request.requestedMode);
  const response = f.response;
  const provenance = {
    ...response.provenance,
    inferenceProfileId: descriptor.inferenceProfileId,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    promptDigest: descriptor.promptDigest,
    promptTemplateId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    providerId: descriptor.providerId,
    inputDigest: descriptor.inputDigest,
    invocationId: descriptor.invocationId,
  };
  const reference = {
    kind: "candidate-artifact" as const,
    digest: request.failedOutputDigest,
    referenceId: source.candidateId,
  };
  response.provenance = provenance;
  response.proposalContext.confidence.evidenceReferences = [reference];
  response.candidateBundle.provenance = provenance;
  response.candidateBundle.boundary = request.boundary;
  response.candidateBundle.validationExpectations =
    request.validationExpectations;
  const patch = response.candidateBundle.candidates[0];
  if (patch?.kind !== "patch") throw Error("Missing synthetic patch.");
  Object.assign(patch, {
    path: source.path,
    baseDigest: source.contentDigest,
    ...("proposedResultDigest" in patch
      ? { proposedResultDigest: sha256Text(repaired) }
      : {}),
    unifiedDiff:
      "--- a/" +
      source.path +
      "\n+++ b/" +
      source.path +
      "\n@@ -1," +
      String(before.length) +
      " +1," +
      String(after.length) +
      " @@\n" +
      before.map((line) => "-" + line).join("\n") +
      "\n" +
      after.map((line) => "+" + line).join("\n") +
      "\n",
  });
  const step = response.candidateBundle.generationPlan.steps[0];
  if (step === undefined) throw Error("Missing patch plan.");
  step.targetPath = source.path;
  step.sourceReferences = [reference];
  response.repairedFromDigest = request.failedOutputDigest;
  response.resolvedDiagnosticIds = request.diagnostics.map(
    (d) => d.diagnosticId,
  );
  const providerResult = {
    content: { ...f.input.content, input: response },
    usage: {
      inputUnits: "100",
      outputUnits: "40",
      thinkingUnits: "0",
      cacheReadUnits: "0",
      cacheWriteUnits: "0",
      providerRequestId: "synthetic-provider-request",
    },
  };
  const base = hostExecutionFixture(true);
  const files = base.request.source.files.map((file) =>
    file.path === source.path
      ? { ...file, content: repaired, checksum: sha256Text(repaired) }
      : file,
  );
  const h = createHostExecutionHarness(
    {
      envelope: base.envelope,
      request: { ...base.request, source: { files } },
    },
    hooks,
  );
  const policy = applicationHostRepairCandidatePolicyV1Schema.parse({
    ...base.config.policy,
    profile: createApplicationHostRepairCandidateProfileV1(),
  });
  return { providerResult, patch, repaired, h, policy };
}
