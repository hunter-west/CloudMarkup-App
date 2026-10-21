import { describe, expect, it } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import {
  sha256DigestSchema,
  projectBlockingQuestionsReviewV1,
} from "@cloudmarkup/schemas";
import { syntheticQuestionsCase } from "./model-live-questions-test-helpers.js";
import {
  assessModelLiveQuestionsCaseV2,
  modelLiveQuestionsCaseAssessmentV2Schema,
} from "./model-live-questions-case-assessment.js";
const measure = (
  value: ReturnType<typeof assessModelLiveQuestionsCaseV2>,
  name: string,
) => value.measurements.find((m) => m.dimension === name)?.numerator;
describe("actual frozen professional constraints clarification assessment", () => {
  it("measures all four unanswered constraints through both unchanged UI semantics", () => {
    const input = syntheticQuestionsCase(),
      before = structuredClone(input);
    const result = assessModelLiveQuestionsCaseV2(input);
    expect(measure(result, "capability-requirement-coverage")).toBe(4);
    expect(measure(result, "issue-clarity-correct-severity")).toBe(4);
    expect(measure(result, "unresolved-behavior-honesty")).toBe(1);
    expect(
      measure(result, "same-ui-semantics-across-assistance-preferences"),
    ).toBe(1);
    expect(input).toEqual(before);
    expect(JSON.stringify(result)).not.toContain(
      input.request.intentDocument.application.summary,
    );
    const guided = projectBlockingQuestionsReviewV1({
        ...input,
        requestedMode: "guided",
      }),
      professional = projectBlockingQuestionsReviewV1({
        ...input,
        requestedMode: "professional",
      });
    expect(guided.semantic).toEqual(professional.semantic);
    expect(guided.explanation).not.toBe(professional.explanation);
    expect(guided.semantic.state).toBe("needs-user-input");
    expect(guided.semantic.writeAuthority).toBe("none");
  });
  it.each(["missing", "unmatched", "assumption"])(
    "records %s without fabricating full coverage or answers",
    (variant) => {
      const input = syntheticQuestionsCase();
      if (variant === "missing") input.response.questions.pop();
      if (variant === "unmatched")
        Reflect.set(
          input.response.questions[0] ?? {},
          "questionId",
          "question_unrelated",
        );
      if (variant === "assumption")
        input.response.proposalContext.assumptions.push({
          assumptionId: "assumption_unapproved" as never,
          confidence: input.response.proposalContext.confidence,
          statement: "A spending limit has already been selected.",
        });
      input.outputDigest = digestStructuredValue(input.response);
      const result = assessModelLiveQuestionsCaseV2(input);
      expect(measure(result, "capability-requirement-coverage")).toBe(
        variant === "assumption" ? 4 : 3,
      );
      expect(measure(result, "unresolved-behavior-honesty")).toBe(
        variant === "missing" ? 1 : 0,
      );
      if (variant !== "assumption")
        expect(
          projectBlockingQuestionsReviewV1({
            ...input,
            requestedMode: "guided",
          }).semantic.missingBlockingQuestions,
        ).toHaveLength(1);
    },
  );
  it.each([
    "source",
    "mode",
    "role",
    "input-digest",
    "output-digest",
    "case",
    "duplicate",
    "too-many",
    "extra-output",
  ])("rejects substituted %s", (variant) => {
    const input = syntheticQuestionsCase();
    switch (variant) {
      case "source":
        input.request.intentDocument.application.summary = "Unrelated source";
        input.descriptor.inputDigest = sha256DigestSchema.parse(
          digestStructuredValue({
            request: input.request,
            scope: input.descriptor.scope,
          }),
        );
        input.response.provenance.inputDigest = input.descriptor.inputDigest;
        break;
      case "mode":
        input.descriptor.requestedMode = "professional";
        break;
      case "role":
        input.descriptor.role = "repair-escalation";
        break;
      case "input-digest":
        input.descriptor.inputDigest = ("sha256:" + "0".repeat(64)) as never;
        break;
      case "output-digest":
        input.outputDigest = sha256DigestSchema.parse(
          "sha256:" + "0".repeat(64),
        );
        break;
      case "case":
        Reflect.set(input.evaluationCase, "caseId", "case_other");
        break;
      case "duplicate":
        Reflect.set(
          input.response.questions[1] ?? {},
          "questionId",
          input.response.questions[0]?.questionId,
        );
        break;
      case "too-many":
        input.response.questions.push({
          ...input.response.questions[0],
          questionId: "question_extra",
        } as never);
        break;
      case "extra-output":
        Reflect.set(input.response, "accepted", true);
        break;
    }
    if (variant !== "output-digest")
      input.outputDigest = digestStructuredValue(input.response);
    expect(() => assessModelLiveQuestionsCaseV2(input)).toThrow();
  });
  it("rejects a caller-supplied grade and contradictory measurement shape", () => {
    const result = assessModelLiveQuestionsCaseV2(syntheticQuestionsCase());
    expect(() =>
      modelLiveQuestionsCaseAssessmentV2Schema.parse({
        ...result,
        passed: true,
      }),
    ).toThrow();
    const altered = structuredClone(result);
    const coverage = altered.measurements.find(
      (m) => m.dimension === "capability-requirement-coverage",
    );
    if (!coverage) throw Error("Missing coverage");
    coverage.denominator = 5;
    const { assessmentDigest, ...body } = altered;
    expect(assessmentDigest).toBeTruthy();
    expect(() =>
      modelLiveQuestionsCaseAssessmentV2Schema.parse({
        ...body,
        assessmentDigest: digestStructuredValue(body),
      }),
    ).toThrow();
  });
});
