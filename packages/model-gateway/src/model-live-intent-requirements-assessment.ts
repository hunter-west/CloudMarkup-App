import { parseIntentDocument } from "@cloudmarkup/domain";
import {
  modelIntentExtractionRequestV1Schema,
  modelIntentExtractionResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  type IntentDocumentV1,
} from "@cloudmarkup/schemas";
import { frozenFullBetaEvaluationDatasetV1 } from "./full-beta-evaluation-dataset.js";
import { modelEvaluationMeasurementV1Schema } from "./model-evaluation.js";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  validateModelRequestAuthority,
  validateModelResponseAuthority,
} from "./security.js";

const validatorId = "cloudmarkup.live-intent-requirements-validator.v1";
const validatorVersion = "1.0.0";
const requiredCase = frozenFullBetaEvaluationDatasetV1.cases.find(
  (entry) => entry.caseKind === "vague-conflicting-requirements",
);
/** Frozen structural expectations for the intentionally incomplete source.
 * No deployment/application choice has been provided. A missing requirement
 * cannot become 'none', 'not-required', a concrete value or a user decision. */
function requirements(document: IntentDocumentV1) {
  return [
    ["application.capabilities", document.application.capabilities],
    ["connectivity.ingress", document.connectivity.ingress],
    ["connectivity.egress", document.connectivity.egress],
    ["identity.authentication", document.identity.authentication],
    ["identity.authorization", document.identity.authorization],
    ["data", document.data],
    ["workflows", document.workflows],
    ["quality.availability", document.quality.availability],
    ["quality.durability", document.quality.durability],
    ["quality.recovery", document.quality.recovery],
    ["quality.latency", document.quality.latency],
    ["quality.scale", document.quality.scale],
    ["environment", document.environment],
    [
      "preferences.operational-overhead",
      document.preferences.operationalOverhead,
    ],
    ["preferences.cost", document.preferences.cost],
    ["compliance", document.compliance],
  ] as const;
}
const conflicts = new Set([
  "connectivity.ingress",
  "quality.scale",
  "preferences.cost",
]);
function requireAssessment(value: boolean): asserts value {
  if (!value)
    throw Error("The exact Intent requirements assessment is unavailable.");
}

/** Execute the strict schema, domain semantics, source/provenance and five
 * structural quality dimensions over actual RAM response bytes. This is NOT a
 * complete case assessment: UI parity, durable receipt issuance and operational
 * measurements require their own actual execution. No provider, journal,
 * accounting, promotion, persistence or arbitrary scoring callback is exposed.
 * Readable question text is structurally checked; linguistic quality is not
 * claimed by this deterministic validator. */
export function assessModelLiveIntentRequirementsV1(input: {
  readonly evaluationCase: unknown;
  readonly request: unknown;
  readonly descriptor: unknown;
  readonly response: unknown;
  readonly outputDigest: string;
}) {
  requireAssessment(requiredCase !== undefined);
  requireAssessment(
    digestStructuredValue(input.evaluationCase) ===
      digestStructuredValue(requiredCase),
  );
  const request = modelIntentExtractionRequestV1Schema.parse(input.request);
  const descriptor = modelInvocationDescriptorV1Schema.parse(input.descriptor);
  const response = modelIntentExtractionResponseV1Schema.parse(input.response);
  requireAssessment(
    request.source.content === requiredCase.input.requirements &&
      descriptor.feature === "intent.extract" &&
      descriptor.role === "low-cost-extraction-help" &&
      descriptor.requestedMode === request.requestedMode &&
      descriptor.inputDigest ===
        digestStructuredValue({ request, scope: descriptor.scope }) &&
      input.outputDigest === digestStructuredValue(response),
  );
  validateModelRequestAuthority(request);
  validateModelResponseAuthority({
    request,
    descriptor,
    response,
    allowedApprovalPathIds: new Set(),
  });
  const intent = parseIntentDocument(response.intentDocument);
  const prompt = intent.metadata.provenance.prompt;
  requireAssessment(
    intent.metadata.source === "prompt-assisted" &&
      prompt.kind === "prompt-reference" &&
      String(prompt.interactionId) === String(descriptor.invocationId) &&
      prompt.inputDigest === descriptor.inputDigest &&
      prompt.templateId === descriptor.promptTemplateId &&
      prompt.templateVersion === descriptor.promptVersion,
  );
  const questions = new Map(
    intent.unresolvedQuestions.map((q) => [String(q.id), q]),
  );
  const observations = requirements(intent).map(([path, value]) => {
    const question =
      value.state === "unknown" ? questions.get(value.questionId) : undefined;
    const subject = question?.subject.replace(/^requirements\./u, "");
    const linked = value.state === "unknown" && subject === path;
    const blocking = linked && question?.classification === "blocking";
    return {
      path,
      unknown: value.state === "unknown",
      linked,
      blocking,
      readable:
        question !== undefined &&
        question.question.trim().length > 0 &&
        (question.rationale?.trim().length ?? 0) > 0,
      conflict: conflicts.has(path),
    };
  });
  const coverage = observations.filter((entry) => entry.linked).length;
  const conflictObservations = observations.filter((entry) => entry.conflict);
  const clearConflicts = conflictObservations.filter(
    (entry) => entry.blocking && entry.readable,
  ).length;
  const inventedAuthority =
    intent.decisions.length > 0 ||
    intent.alternatives.some(
      (alternative) => alternative.status === "selected",
    ) ||
    intent.assumptions.some(
      (assumption) =>
        assumption.status === "confirmed" || assumption.origin === "user",
    );
  const secret = inspectModelValueForSecretCandidatesV1(response);
  const structuralDigest = digestStructuredValue({
    observations,
    inventedAuthority,
  });
  const intentDigest = digestStructuredValue(intent);
  const securityDigest = digestStructuredValue({
    outputDigest: input.outputDigest,
    ...secret,
  });
  const measurements = [
    ["structured-schema-validity", 1, 1, [intentDigest, input.outputDigest]],
    [
      "security-policy-violations",
      secret.detectedValueCount === 0 ? 0 : 1,
      1,
      [securityDigest],
    ],
    [
      "capability-requirement-coverage",
      coverage,
      observations.length,
      [structuralDigest],
    ],
    [
      "issue-clarity-correct-severity",
      clearConflicts,
      conflictObservations.length,
      [structuralDigest],
    ],
    [
      "unresolved-behavior-honesty",
      coverage === observations.length && !inventedAuthority ? 1 : 0,
      1,
      [structuralDigest],
    ],
  ].map(([dimension, numerator, denominator, evidenceDigests]) =>
    modelEvaluationMeasurementV1Schema.parse({
      dimension,
      numerator,
      denominator,
      evidenceDigests,
      sourceAuthority: "deterministic-evaluation-v1",
    }),
  );
  const body = {
    contractVersion: 1 as const,
    recordKind: "model-live-intent-requirements-assessment" as const,
    validatorId,
    validatorVersion,
    caseId: requiredCase.caseId,
    caseDigest: requiredCase.caseDigest,
    sourceInputDigest: digestStructuredValue(requiredCase.input),
    inputDigest: descriptor.inputDigest,
    outputDigest: input.outputDigest,
    intentDigest,
    structuralDigest,
    measurements,
    completeCaseAssessment: false as const,
    missingDimensions: [
      "same-ui-semantics-across-assistance-preferences",
      "latency",
      "tokens",
      "credits",
      "estimated-cost",
    ] as const,
  };
  return { ...body, assessmentDigest: digestStructuredValue(body) };
}
