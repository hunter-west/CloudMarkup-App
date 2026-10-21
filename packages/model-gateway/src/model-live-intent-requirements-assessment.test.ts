import {
  assessModelLiveIntentCaseV2,
  modelLiveIntentCaseAssessmentV2Schema,
} from "./model-live-intent-case-assessment.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  intentDocumentV1Schema,
  modelIntentExtractionRequestV1Schema,
  modelIntentExtractionResponseV1Schema,
  modelInvocationDescriptorV1Schema,
} from "@cloudmarkup/schemas";
import { deterministicFakeResponseV1 } from "./fakes.js";
import { frozenFullBetaEvaluationDatasetV1 } from "./full-beta-evaluation-dataset.js";
import { assessModelLiveIntentRequirementsV1 } from "./model-live-intent-requirements-assessment.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import { digestStructuredValue, sha256Text } from "./security.js";
import { getModelResponseToolV1 } from "./tools.js";

/** Synthetic responses exercise actual validation, never hosted quality. */
function fixture() {
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (entry) => entry.caseKind === "vague-conflicting-requirements",
  );
  if (!evaluationCase) throw Error("Missing frozen case");
  const request = modelIntentExtractionRequestV1Schema.parse({
    contractVersion: 1,
    operation: "intent.extract",
    requestedMode: "guided",
    source: {
      content: evaluationCase.input.requirements,
      digest: sha256Text(evaluationCase.input.requirements),
      kind: "requirements-text",
      sourceId: "requirements_intent_evaluation",
    },
  });
  const prompt = reviewedModelPromptRegistry.get(request.operation);
  if (!prompt) throw Error("Missing prompt");
  const scope = {
    jobId: "job_intent_evaluation",
    organizationId: "organization_intent_evaluation",
    projectId: "project_intent_evaluation",
    userId: "user_intent_evaluation",
  };
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    budgetDecisionId: "budget_intent_evaluation",
    complexity: "standard",
    contractVersion: 1,
    entitlementDecisionId: "entitlement_intent_evaluation",
    evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
    evaluationPolicyVersion: "1.0.0",
    feature: request.operation,
    idempotencyKeyDigest: sha256Text("synthetic-intent-assessment"),
    inputDigest: digestStructuredValue({ request, scope }),
    invocationId: "invocation_intent_evaluation",
    modelId: "cloudmarkup.fake-model",
    modelVersion: "1.0.0",
    promptDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptVersion: prompt.version,
    providerFamily: "deterministic-fake",
    providerId: "cloudmarkup.fake",
    requestedMode: request.requestedMode,
    role: "low-cost-extraction-help",
    scope,
    toolAuthority: "none",
  });
  const response = modelIntentExtractionResponseV1Schema.parse(
    deterministicFakeResponseV1({
      descriptor,
      request,
      prompt,
      maximumOutputBytes: 500000,
      maximumOutputTokens: 8192,
      promptCachePolicy: {
        cacheKeyRequired: false,
        enabled: false,
        maximumCheckpoints: 0,
        minimumCheckpointTokens: 0,
      },
      responseTool: getModelResponseToolV1(request.operation),
      timeoutMilliseconds: 5000,
    }),
  );
  const intent = intentDocumentV1Schema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../test-fixtures/fixtures/intent-document/v1/ambiguous/unknown-requirements.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  intent.metadata = response.intentDocument.metadata;
  intent.assumptions = [];
  intent.decisions = [];
  intent.alternatives = [];
  intent.application.summary = request.source.content;
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return;
    const object = value as Record<string, unknown>;
    if (object["state"] === "unknown") {
      const question = intent.unresolvedQuestions.find(
        (q) => q.id === object["questionId"],
      );
      if (!question) throw Error("Missing synthetic question");
      question.subject =
        intentDocumentV1Schema.shape.unresolvedQuestions.element.shape.subject.parse(
          "requirements." +
            path.replace("operationalOverhead", "operational-overhead"),
        );
      question.classification = "blocking";
      question.rationale = "The source does not resolve this requirement.";
      return;
    }
    for (const [key, child] of Object.entries(object))
      visit(child, path ? path + "." + key : key);
  };
  visit(intent, "");
  response.intentDocument = intent;
  return {
    evaluationCase,
    request,
    descriptor,
    response,
    outputDigest: digestStructuredValue(response),
  };
}
function run(f: ReturnType<typeof fixture>) {
  return assessModelLiveIntentRequirementsV1({
    ...f,
    outputDigest: digestStructuredValue(f.response),
  });
}
function measure(result: ReturnType<typeof run>, dimension: string) {
  const value = result.measurements.find((m) => m.dimension === dimension);
  if (!value) throw Error("Missing measurement");
  return value;
}
describe("actual structural Intent requirement assessment", () => {
  it("executes schema, domain, source and question checks while keeping incomplete case authority explicit", () => {
    const f = fixture();
    const original = structuredClone(f);
    const result = run(f);
    expect(measure(result, "capability-requirement-coverage")).toMatchObject({
      numerator: 16,
      denominator: 16,
    });
    expect(measure(result, "issue-clarity-correct-severity")).toMatchObject({
      numerator: 3,
      denominator: 3,
    });
    expect(measure(result, "unresolved-behavior-honesty").numerator).toBe(1);
    expect(measure(result, "security-policy-violations").numerator).toBe(0);
    expect(result.completeCaseAssessment).toBe(false);
    expect(result.missingDimensions).toContain(
      "same-ui-semantics-across-assistance-preferences",
    );
    expect(JSON.stringify(result)).not.toContain(f.request.source.content);
    expect(f).toEqual(original);
    expect(run(f)).toEqual(result);
  });
  it.each([
    "case",
    "request",
    "descriptor",
    "output",
    "provenance",
    "domain",
    "schema",
  ] as const)("rejects substituted %s authority or invalid content", (kind) => {
    const f = fixture();
    if (kind === "case")
      f.evaluationCase = structuredClone({
        ...f.evaluationCase,
        input: { ...f.evaluationCase.input, requirements: "different" },
      });
    if (kind === "request") f.request.source.content = "different";
    if (kind === "descriptor")
      f.descriptor.inputDigest = sha256Text("different");
    if (kind === "output") f.outputDigest = sha256Text("different");
    if (kind === "provenance")
      f.response.provenance.invocationId =
        modelInvocationDescriptorV1Schema.shape.invocationId.parse(
          "invocation_substituted",
        );
    if (kind === "domain") f.response.intentDocument.unresolvedQuestions = [];
    if (kind === "schema")
      Reflect.set(f.response.intentDocument, "deploy", true);
    if (kind !== "output") f.outputDigest = digestStructuredValue(f.response);
    expect(() => {
      assessModelLiveIntentRequirementsV1(f);
    }).toThrow();
  });
  it("scores an invented known choice negatively instead of treating schema validity as coverage", () => {
    const f = fixture();
    f.response.intentDocument.connectivity.ingress = {
      state: "none",
      rationale: "Synthetic invented decision",
    };
    const result = run(f);
    expect(measure(result, "structured-schema-validity").numerator).toBe(1);
    expect(measure(result, "capability-requirement-coverage")).toMatchObject({
      numerator: 15,
      denominator: 16,
    });
    expect(measure(result, "issue-clarity-correct-severity")).toMatchObject({
      numerator: 2,
      denominator: 3,
    });
    expect(measure(result, "unresolved-behavior-honesty").numerator).toBe(0);
  });
  it("requires linked questions to name the affected requirement and preserve blocking conflicts", () => {
    const f = fixture();
    const ingress = f.response.intentDocument.connectivity.ingress;
    if (ingress.state !== "unknown") throw Error("Missing unknown");
    const q = f.response.intentDocument.unresolvedQuestions.find(
      (q) => q.id === ingress.questionId,
    );
    if (!q) throw Error("Missing question");
    q.classification = "non-blocking";
    expect(measure(run(f), "issue-clarity-correct-severity").numerator).toBe(2);
    q.subject =
      intentDocumentV1Schema.shape.unresolvedQuestions.element.shape.subject.parse(
        "unrelated.requirement",
      );
    expect(measure(run(f), "capability-requirement-coverage").numerator).toBe(
      15,
    );
  });
  it("records a real secret inspection failure without retaining secret text", () => {
    const f = fixture();
    const secret = "AKIA" + "ABCDEFGHIJKLMNOP";
    f.response.intentDocument.application.summary = secret;
    const result = run(f);
    expect(measure(result, "security-policy-violations").numerator).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe("Intent case review semantics", () => {
  it.each([
    "coverage-denominator",
    "clarity-denominator",
    "invalid-schema",
  ] as const)(
    "rejects rehashed %s metadata inconsistent with the fixed SQL receipt contract",
    (kind) => {
      const value = assessModelLiveIntentCaseV2(fixture());
      const item = value.measurements.find(
        (m) =>
          m.dimension ===
          (kind === "coverage-denominator"
            ? "capability-requirement-coverage"
            : kind === "clarity-denominator"
              ? "issue-clarity-correct-severity"
              : "structured-schema-validity"),
      );
      if (!item) throw Error("Missing measurement");
      if (kind === "invalid-schema") item.numerator = 0;
      else {
        item.numerator = 0;
        item.denominator = 2;
      }
      const { assessmentDigest, ...body } = value;
      expect(assessmentDigest).toBeDefined();
      expect(
        modelLiveIntentCaseAssessmentV2Schema.safeParse({
          ...body,
          assessmentDigest: digestStructuredValue(body),
        }).success,
      ).toBe(false);
    },
  );
  it("executes both real review projections and rejects altered self-rehashed measurements", () => {
    const f = fixture();
    const result = assessModelLiveIntentCaseV2(f);
    expect(result.measurements).toHaveLength(6);
    expect(
      result.assistancePreferenceSemantics.map((v) => v.assistancePreference),
    ).toEqual(["guided", "professional"]);
    expect(result.assistancePreferenceSemantics[0]?.semanticDigest).toBe(
      result.assistancePreferenceSemantics[1]?.semanticDigest,
    );
    const metadata = structuredClone(result);
    metadata.measurements.pop();
    const { assessmentDigest, ...body } = metadata;
    expect(assessmentDigest).toBe(result.assessmentDigest);
    expect(
      modelLiveIntentCaseAssessmentV2Schema.safeParse({
        ...body,
        assessmentDigest: digestStructuredValue(body),
      }).success,
    ).toBe(false);
  });
});
