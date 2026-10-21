import {
  digestCanonicalValue as digest,
  modelLiveSequenceOutcomeV4Schema,
  type ModelLiveSequenceInputV3,
  type ModelLiveSequenceAttemptObservationV4,
} from "@cloudmarkup/schemas";
import type { ModelLiveSeedCandidateReceiptV1 } from "./model-live-seed-candidate-codec.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
/** Shared deterministic fields, called only after strict stage-specific validation. */
export function projectRepairCandidateOutcomeV4(
  stage: ModelLiveSequenceInputV3,
  attempt: ModelLiveSequenceAttemptObservationV4,
  receipt: Pick<
    ModelLiveSeedCandidateReceiptV1,
    "issuedAt" | "lineage" | "bindings" | "receiptDigest" | "disposition"
  >,
) {
  const bound = Object.fromEntries(
    (
      [
        "selectionId",
        "selectionDigest",
        "planDigest",
        "caseId",
        "caseDigest",
        "stageKey",
        "stageId",
        "invocationId",
      ] as const
    ).map((key) => {
      requireAuthority(same(stage[key], attempt[key]));
      return [key, stage[key]];
    }),
  );
  const body = {
    ...bound,
    contractVersion: 4,
    parentSequenceContractVersion: 3,
    recordKind: "model-live-sequence-outcome",
    observedAt: receipt.issuedAt,
    status: "validated",
    inputBindingDigest: stage.inputBindingDigest,
    dispatchDigest: attempt.dispatchDigest,
    normalizedUsageDigest: attempt.normalizedUsageDigest,
    commercialAttemptObservationDigest: attempt.observationDigest,
    outputDigest: receipt.lineage.responseDigest,
    candidateDigest: receipt.bindings.sourceTreeDigest,
    validationReceiptDigest: receipt.receiptDigest,
    validation: {
      status: receipt.disposition === "valid" ? "valid" : "invalid",
      repairable: receipt.disposition === "invalid-repairable",
    },
  };
  return modelLiveSequenceOutcomeV4Schema.parse({
    ...body,
    outcomeDigest: digest(body),
  });
}
