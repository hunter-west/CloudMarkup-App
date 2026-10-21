import { describe, expect, it } from "vitest";
import { digestCanonicalValue, sha256Text } from "@cloudmarkup/schemas";
import { fullBetaModelEvaluationPolicyV2 } from "./model-live-evaluation-report.js";
import {
  fullBetaEventEvaluationPolicyV2,
  historicalFullBetaEvaluationPolicyIdentityV2,
  modelLiveEventCriterionV211,
  resolveFullBetaEvaluationPolicyV2,
  selectModelLiveEventValidatorVersion,
} from "./model-live-event-evaluation-policy.js";

describe("pre-result event criterion policy identity", () => {
  it("preserves historical identity and pins the exact successor criterion transitively", () => {
    expect(historicalFullBetaEvaluationPolicyIdentityV2).toEqual(
      fullBetaModelEvaluationPolicyV2,
    );
    expect(modelLiveEventCriterionV211.criterionDigest).toBe(
      "sha256:855f22b966662528e5e0830488b8a37cfe6ae0f6f9287ef7fb0c15c47f73fc53",
    );
    expect(fullBetaEventEvaluationPolicyV2.evaluationPolicyDigest).toBe(
      "sha256:e686ddb39694c15fe892b1903153087607c428604c7b51458744206b4e8b2243",
    );
    const { criterionDigest, ...body } = modelLiveEventCriterionV211;
    expect(criterionDigest).toBe(digestCanonicalValue(body));
    expect(Object.isFrozen(modelLiveEventCriterionV211.issue)).toBe(true);
    expect(Object.isFrozen(modelLiveEventCriterionV211.workflows)).toBe(true);
    expect(
      selectModelLiveEventValidatorVersion(fullBetaModelEvaluationPolicyV2),
    ).toBe("2.8.0");
    expect(
      selectModelLiveEventValidatorVersion(fullBetaEventEvaluationPolicyV2),
    ).toBe("2.11.0");
    expect(
      resolveFullBetaEvaluationPolicyV2(fullBetaModelEvaluationPolicyV2),
    ).toEqual(fullBetaModelEvaluationPolicyV2);
    expect(
      resolveFullBetaEvaluationPolicyV2(fullBetaEventEvaluationPolicyV2),
    ).toEqual(fullBetaEventEvaluationPolicyV2);
  });
  it.each([
    "evaluationPolicyId",
    "evaluationPolicyVersion",
    "evaluationPolicyDigest",
  ] as const)(
    "rejects partial successor %s claims before output inspection",
    (key) => {
      const altered = {
        ...fullBetaEventEvaluationPolicyV2,
        [key]:
          key === "evaluationPolicyId"
            ? "cloudmarkup.other-policy"
            : key === "evaluationPolicyVersion"
              ? "2.4.0"
              : sha256Text("wrong-policy"),
      };
      expect(() => selectModelLiveEventValidatorVersion(altered)).toThrow();
      expect(() => resolveFullBetaEvaluationPolicyV2(altered)).toThrow();
    },
  );
  it("does not retrofit legacy unrelated policies or admit them as full-beta report authority", () => {
    const legacy = {
      evaluationPolicyId: "cloudmarkup.synthetic.policy",
      evaluationPolicyVersion: "1.0.0",
      evaluationPolicyDigest: sha256Text("legacy"),
    };
    expect(selectModelLiveEventValidatorVersion(legacy)).toBe("2.8.0");
    expect(() => resolveFullBetaEvaluationPolicyV2(legacy)).toThrow();
    expect(
      selectModelLiveEventValidatorVersion({
        ...legacy,
        evaluationPolicyId: fullBetaModelEvaluationPolicyV2.evaluationPolicyId,
        evaluationPolicyVersion: "2.3.0",
      }),
    ).toBe("2.8.0");
    expect(
      selectModelLiveEventValidatorVersion({
        ...legacy,
        evaluationPolicyVersion: "2.5.0",
      }),
    ).toBe("2.8.0");
  });
});
