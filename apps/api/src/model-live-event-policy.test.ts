import { describe, expect, it } from "vitest";
import {
  fullBetaEventEvaluationPolicyV2,
  fullBetaModelEvaluationPolicyV2,
} from "@cloudmarkup/model-gateway";
import { requireModelLiveEventPolicyParity } from "./model-live-event-policy.js";
const assessment = {
  caseId: "evaluation_case_event_driven_image_processing_full_beta_v1",
  recordKind: "model-live-event-case-assessment",
  validatorId: "cloudmarkup.live-event-case-validator.v2",
  validatorVersion: "2.11.0",
};
describe("event issue/read shared pre-result policy parity", () => {
  it("admits only the selected version and preserves old receipt identity", () => {
    expect(() => {
      requireModelLiveEventPolicyParity({
        evaluationPolicy: fullBetaEventEvaluationPolicyV2,
        assessment,
      });
    }).not.toThrow();
    expect(() => {
      requireModelLiveEventPolicyParity({
        evaluationPolicy: fullBetaModelEvaluationPolicyV2,
        assessment: { ...assessment, validatorVersion: "2.8.0" },
      });
    }).not.toThrow();
    expect(() => {
      requireModelLiveEventPolicyParity({
        evaluationPolicy: fullBetaModelEvaluationPolicyV2,
        assessment,
      });
    }).toThrow();
    expect(() => {
      requireModelLiveEventPolicyParity({
        evaluationPolicy: fullBetaEventEvaluationPolicyV2,
        assessment: { ...assessment, validatorVersion: "2.8.0" },
      });
    }).toThrow();
  });
  it.each(["recordKind", "validatorId", "caseId"] as const)(
    "denies coherently relabeled successor %s",
    (field) => {
      expect(() => {
        requireModelLiveEventPolicyParity({
          evaluationPolicy: fullBetaEventEvaluationPolicyV2,
          assessment: { ...assessment, [field]: "unrelated" },
        });
      }).toThrow();
    },
  );
  it("keeps previously admitted generic event receipts historical only", () => {
    const generic = {
      ...assessment,
      recordKind: "model-live-proposal-case-assessment",
      validatorId: "cloudmarkup.live-proposal-case-validator.v2",
      validatorVersion: "2.1.0",
    };
    expect(() => {
      requireModelLiveEventPolicyParity({
        evaluationPolicy: fullBetaModelEvaluationPolicyV2,
        assessment: generic,
      });
    }).not.toThrow();
    expect(() => {
      requireModelLiveEventPolicyParity({
        evaluationPolicy: fullBetaEventEvaluationPolicyV2,
        assessment: generic,
      });
    }).toThrow();
  });
});
