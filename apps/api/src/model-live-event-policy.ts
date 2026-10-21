import { selectModelLiveEventValidatorVersion } from "@cloudmarkup/model-gateway";

const eventCaseId =
  "evaluation_case_event_driven_image_processing_full_beta_v1";
/** The stored plan is pre-result authority. This guard is shared by issuance and
 * historical reads, including usage settlement after an execution expires. */
export function requireModelLiveEventPolicyParity(input: {
  readonly evaluationPolicy: unknown;
  readonly assessment: {
    readonly caseId: string;
    readonly recordKind: string;
    readonly validatorId: string;
    readonly validatorVersion: string;
  };
}): void {
  const a = input.assessment;
  if (a.caseId !== eventCaseId) {
    if (a.validatorVersion === "2.11.0")
      throw new Error("Event successor receipt policy binding is unavailable.");
    return;
  }
  const selected = selectModelLiveEventValidatorVersion(input.evaluationPolicy);
  if (
    selected === "2.11.0"
      ? a.recordKind !== "model-live-event-case-assessment" ||
        a.validatorId !== "cloudmarkup.live-event-case-validator.v2" ||
        a.validatorVersion !== selected
      : a.validatorVersion === "2.11.0"
  )
    throw new Error("Event successor receipt policy binding is unavailable.");
}
