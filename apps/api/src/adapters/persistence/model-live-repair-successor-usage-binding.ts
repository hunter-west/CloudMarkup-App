import {
  digestStructuredValue as digest,
  type ModelCommercialInvocationAttemptV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  modelLiveSequenceAttemptObservationV4Schema,
  type ModelLiveRepairSuccessorInvocationDescriptorV4,
  type ModelLiveSequenceInputV3,
} from "@cloudmarkup/schemas";
import { prepareRepairUsageObservationV4 } from "./model-live-repair-usage-observation-binding.js";
import { projectFirstSeedCandidateOutcomeV4 } from "./model-live-seed-candidate-codec.js";
import {
  requireSequenceAuthority as requireAuthority,
  sameSequenceMetadata as same,
} from "./model-live-sequence-authority-codec.js";

/** Known second physical send under the same original workflow. Requires actual
 * first usage and validation loaded by the private persistence host; metadata
 * cannot grant response acceptance, another send or settlement. */
export function prepareFinalRepairUsageObservationV4(
  input: Omit<
    Parameters<typeof prepareRepairUsageObservationV4>[0],
    "descriptor" | "ordinal" | "predecessor"
  > & {
    readonly descriptor: ModelLiveRepairSuccessorInvocationDescriptorV4;
    readonly predecessor: {
      readonly stage: ModelLiveSequenceInputV3;
      readonly attempt: ModelCommercialInvocationAttemptV1;
      readonly observation: unknown;
      readonly receipt: unknown;
    };
  },
) {
  const prior = input.predecessor;
  const observation = modelLiveSequenceAttemptObservationV4Schema.parse(
    prior.observation,
  );
  const outcome = projectFirstSeedCandidateOutcomeV4(
    prior.stage,
    observation,
    prior.receipt,
  );
  requireAuthority(
    observation.canonicalWorkflowFingerprint === input.workflow.fingerprint &&
      observation.canonicalAttemptOrdinal === 1 &&
      observation.canonicalAttemptDigest === digest(prior.attempt) &&
      outcome.status === "validated" &&
      outcome.validation.status === "invalid" &&
      outcome.validation.repairable &&
      same(input.stage.predecessor, {
        kind: "stage",
        stageId: outcome.stageId,
        outcomeDigest: outcome.outcomeDigest,
        outputDigest: outcome.outputDigest,
        candidateDigest: outcome.candidateDigest,
        validationReceiptDigest: outcome.validationReceiptDigest,
      }) &&
      Date.parse(input.usage.startedAt) >= Date.parse(outcome.observedAt) &&
      Date.parse(input.usage.startedAt) >=
        Date.parse(input.dispatch.dispatchedAt) &&
      Date.parse(input.observedAt) >= Date.parse(input.usage.completedAt),
  );
  return prepareRepairUsageObservationV4({
    ...input,
    descriptor: modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse(
      input.descriptor,
    ),
    ordinal: 2,
    predecessor: prior,
  });
}
