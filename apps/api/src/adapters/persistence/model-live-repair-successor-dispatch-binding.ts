import { parseModelLiveSeedRuntimeExecutionV4 } from "@cloudmarkup/model-gateway";
import {
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceAttemptObservationV4Schema,
  type ModelLiveRepairSuccessorInvocationDescriptorV4,
} from "@cloudmarkup/schemas";
import { prepareBoundRepairDispatchV4 } from "./model-live-repair-dispatch-platform-binding.js";
import { projectFirstSeedCandidateOutcomeV4 } from "./model-live-seed-candidate-codec.js";
import {
  requireSequenceAuthority as requireAuthority,
  sameSequenceMetadata as same,
} from "./model-live-sequence-authority-codec.js";

/** Final-stage metadata only. The journal must load the actual issued second input,
 * original reservation, first usage/validation and platform reservation under
 * current authority. No parsing result authorizes counting, sending or settlement. */
export function prepareFinalRepairDispatchV4(
  input: Omit<
    Parameters<typeof prepareBoundRepairDispatchV4>[0],
    "ordinal" | "descriptor"
  > & {
    readonly descriptor: ModelLiveRepairSuccessorInvocationDescriptorV4;
    readonly predecessorObservation: unknown;
    readonly predecessorReceipt: unknown;
  },
) {
  const execution = parseModelLiveSeedRuntimeExecutionV4(input.execution);
  const stage = modelLiveSequenceInputV3Schema.parse(input.stage);
  const descriptor = modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse(
    input.descriptor,
  );
  const prior = modelLiveSequenceAttemptObservationV4Schema.parse(
    input.predecessorObservation,
  );
  const outcome = projectFirstSeedCandidateOutcomeV4(
    execution.stageInput,
    prior,
    input.predecessorReceipt,
  );
  requireAuthority(
    stage.stageKey === "repair-2" &&
      stage.predecessor.kind === "stage" &&
      outcome.status === "validated" &&
      outcome.validation.status === "invalid" &&
      outcome.validation.repairable &&
      prior.canonicalAttemptOrdinal === 1 &&
      prior.canonicalWorkflowFingerprint === input.workflow.fingerprint &&
      prior.inputBindingDigest === execution.stageInput.inputBindingDigest &&
      same(stage.predecessor, {
        kind: "stage",
        stageId: outcome.stageId,
        outcomeDigest: outcome.outcomeDigest,
        outputDigest: outcome.outputDigest,
        candidateDigest: outcome.candidateDigest,
        validationReceiptDigest: outcome.validationReceiptDigest,
      }) &&
      Date.parse(stage.issuedAt) >= Date.parse(outcome.observedAt) &&
      Date.parse(input.dispatchedAt) >= Date.parse(stage.issuedAt) &&
      stage.invocationId !== execution.stageInput.invocationId,
  );
  for (const key of [
    "selectionId",
    "selectionDigest",
    "planDigest",
    "caseId",
    "caseDigest",
    "recipeDigest",
    "authorityTupleDigest",
    "revisionDigest",
    "ownershipDigest",
  ] as const)
    requireAuthority(stage[key] === execution.stageInput[key]);
  const selected = execution.selection.stages.find(
    (item) => item.stageId === stage.stageId,
  );
  requireAuthority(
    selected?.stageKey === "repair-2" &&
      selected.caseId === stage.caseId &&
      selected.caseDigest === stage.caseDigest &&
      selected.invocationId === stage.invocationId &&
      stage.planDigest === execution.plan.planDigest,
  );
  return prepareBoundRepairDispatchV4({
    ...input,
    execution,
    stage,
    descriptor,
    ordinal: 2,
  });
}
