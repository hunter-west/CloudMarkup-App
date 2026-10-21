import { deterministicFakeResponseV1 } from "@cloudmarkup/model-gateway/testing";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
  reviewedModelPromptRegistry,
  getModelResponseToolV1,
  type FullBetaRepositoryCaseKind,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  modelRepositoryInterpretationResponseV1Schema,
} from "@cloudmarkup/schemas";
import { createProductionModelLiveRepositoryRequest } from "./production-model-live-repository-request.js";
import { syntheticQuestionsCase } from "./model-live-questions-test-helpers.js";
/** Synthetic provider output for local tests only. The parser is separate and real. */
export function syntheticRepositoryCase(
  caseKind: Exclude<FullBetaRepositoryCaseKind, "external-existing-resource">,
) {
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseKind === caseKind,
  );
  if (!evaluationCase) throw Error("Missing frozen repository case");
  const request = createProductionModelLiveRepositoryRequest({
    caseId: evaluationCase.caseId,
    requestedMode: "guided",
  });
  const prompt = reviewedModelPromptRegistry.get(request.operation);
  if (!prompt) throw Error("Missing repository prompt");
  const template = syntheticQuestionsCase().descriptor;
  const scope = {
    ...template.scope,
    repositorySnapshotId: request.repositorySnapshotId,
  };
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    ...template,
    scope,
    invocationId: "invocation_synthetic_repository",
    feature: request.operation,
    role: "standard-planning-generation",
    inputDigest: digestStructuredValue({ request, scope }),
    promptDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptVersion: prompt.version,
  });
  const response = modelRepositoryInterpretationResponseV1Schema.parse(
    deterministicFakeResponseV1({
      request,
      descriptor,
      prompt,
      responseTool: getModelResponseToolV1(request.operation),
      maximumOutputTokens: 8192,
      maximumOutputBytes: 500000,
      timeoutMilliseconds: 5000,
      promptCachePolicy: {
        enabled: false,
        cacheKeyRequired: false,
        maximumCheckpoints: 0,
        minimumCheckpointTokens: 0,
      },
    }),
  );
  const source = request.evidence[0];
  if (!source) throw Error("Missing repository excerpt");
  const reference = {
    kind: "repository-evidence" as const,
    referenceId: source.evidenceId,
    path: source.path,
    digest: source.fileChecksum,
    location: source.location,
  };
  const confidence = {
    basisPoints: 1000,
    rationale:
      "The source leaves deployment identity and ownership unresolved.",
    evidenceReferences: [reference],
  };
  const parsed = modelRepositoryInterpretationResponseV1Schema.parse({
    ...response,
    claims: [
      {
        claimId: "claim_synthetic_review",
        category: "diagnostic",
        confidence,
        evidenceReferences: [reference],
        summary:
          "The observed source requires review before changing a design.",
      },
    ],
    proposalContext: {
      assumptions: [],
      confidence,
      unknowns: [
        {
          unknownId: "unknown_synthetic_ownership",
          blocking: true,
          confidence,
          question:
            "Which deployment owns this source and which access rules apply?",
        },
      ],
    },
  });
  return {
    evaluationCase,
    request,
    descriptor,
    response: parsed,
    outputDigest: digestStructuredValue(parsed),
  };
}
