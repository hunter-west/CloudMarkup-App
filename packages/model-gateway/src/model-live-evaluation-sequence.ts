import {
  digestCanonicalValue,
  modelEvaluationDatasetV1Schema,
  modelLiveRuntimeControlPolicyV2Schema,
  modelLiveSequenceDefinitionV3Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceDispatchV3Schema,
  modelLiveSequenceOutcomeV3Schema,
  modelLiveSequenceDispatchV4Schema,
  modelLiveSequenceAttemptObservationV4Schema,
  modelLiveSequenceOutcomeV4Schema,
  type ModelLiveSequenceDispatchV3,
  type ModelLiveSequenceDispatchV4,
  type ModelLiveSequenceOutcomeV4,
  utcTimestampSchema,
  type ModelLiveSequenceInputV3,
  type ModelLiveSequenceOutcomeV3,
  type ModelLiveSequenceSelectionV3,
} from "@cloudmarkup/schemas";
import { inspectModelValueForSecretCandidatesV1 } from "./security.js";

export class ModelLiveSequenceError extends Error {
  readonly code = "model-live.sequence-unavailable";
  constructor() {
    super("The exact bounded evaluation sequence metadata is unavailable.");
    this.name = "ModelLiveSequenceError";
  }
}
function requireSequence(value: boolean): asserts value {
  if (!value) throw new ModelLiveSequenceError();
}
const same = (left: unknown, right: unknown) =>
  digestCanonicalValue(left) === digestCanonicalValue(right);
function checked<T>(work: () => T): T {
  try {
    return work();
  } catch {
    throw new ModelLiveSequenceError();
  }
}

/** Pure comparison with the actual frozen source and independently configured
 * policy. It neither authenticates an operator nor proves seed validation. */
export function validateModelLiveSequenceDefinitionV3(input: {
  readonly definition: unknown;
  readonly dataset: unknown;
  readonly expectedPolicy: unknown;
}) {
  return checked(() => {
    const definition = modelLiveSequenceDefinitionV3Schema.parse(
      input.definition,
    );
    const dataset = modelEvaluationDatasetV1Schema.parse(input.dataset);
    const policy = modelLiveRuntimeControlPolicyV2Schema.parse(
      input.expectedPolicy,
    );
    const requirement = policy.evaluationRequirement;
    requireSequence(
      same(definition.policy, policy) &&
        dataset.datasetId === requirement.datasetId &&
        dataset.datasetVersion === requirement.datasetVersion &&
        dataset.datasetDigest === requirement.datasetDigest &&
        inspectModelValueForSecretCandidatesV1(definition)
          .detectedValueCount === 0 &&
        inspectModelValueForSecretCandidatesV1(dataset).detectedValueCount ===
          0,
    );
    const selected = dataset.cases.filter((entry) =>
      requirement.datasetCaseDigests.includes(entry.caseDigest),
    );
    requireSequence(
      same(
        selected.map((entry) => entry.caseDigest),
        requirement.datasetCaseDigests,
      ) && selected.length === definition.cases.length,
    );
    for (const [index, binding] of definition.cases.entries()) {
      const frozen = selected[index];
      requireSequence(
        frozen?.caseId === binding.caseId &&
          frozen.caseDigest === binding.caseDigest &&
          digestCanonicalValue(frozen.input) === binding.sourceInputDigest &&
          frozen.expected.authorityRequirement.operation ===
            binding.authorityBinding.authorityTuple.operation &&
          frozen.expected.authorityRequirement.role ===
            binding.authorityBinding.authorityTuple.role,
      );
    }
    return definition;
  });
}

type Stage = ModelLiveSequenceSelectionV3["stages"][number];
function exactStage(
  record: {
    readonly selectionId: string;
    readonly selectionDigest: string;
    readonly planDigest: string;
    readonly caseId: string;
    readonly caseDigest: string;
    readonly stageKey: string;
    readonly stageId: string;
    readonly invocationId: string;
  },
  selection: ModelLiveSequenceSelectionV3,
): Stage {
  const stage = selection.stages.find(
    (entry) => entry.stageId === record.stageId,
  );
  requireSequence(
    stage !== undefined &&
      record.selectionId === selection.selectionId &&
      record.selectionDigest === selection.selectionDigest &&
      record.planDigest === selection.planDigest &&
      record.caseId === stage.caseId &&
      record.caseDigest === stage.caseDigest &&
      record.stageKey === stage.stageKey &&
      record.invocationId === stage.invocationId,
  );
  return stage;
}
function unique<T extends { readonly stageId: string }>(
  records: readonly T[],
): Map<string, T> {
  requireSequence(
    records.length <= 4 &&
      new Set(records.map((record) => record.stageId)).size === records.length,
  );
  return new Map(records.map((record) => [record.stageId, record]));
}
type NoDispatchReason = Extract<
  ModelLiveSequenceOutcomeV3,
  { status: "not-dispatched" }
>["reason"];
function stoppedBy(
  predecessor: ModelLiveSequenceOutcomeV3 | ModelLiveSequenceOutcomeV4,
): NoDispatchReason | undefined {
  switch (predecessor.status) {
    case "not-dispatched":
      return "predecessor-not-dispatched";
    case "dispatch-unknown":
      return "predecessor-unknown";
    case "provider-failed":
      return "predecessor-provider-failed";
    case "validated":
      return predecessor.validation.status === "valid"
        ? "predecessor-valid"
        : predecessor.validation.repairable
          ? undefined
          : "predecessor-nonrepairable";
  }
}
function exactPredecessor(
  input: ModelLiveSequenceInputV3,
  prior: ModelLiveSequenceOutcomeV3 | ModelLiveSequenceOutcomeV4,
) {
  requireSequence(
    prior.status === "validated" &&
      prior.validation.status === "invalid" &&
      prior.validation.repairable &&
      input.predecessor.kind === "stage" &&
      input.predecessor.stageId === prior.stageId &&
      input.predecessor.outcomeDigest === prior.outcomeDigest &&
      input.predecessor.outputDigest === prior.outputDigest &&
      input.predecessor.candidateDigest === prior.candidateDigest &&
      input.predecessor.validationReceiptDigest ===
        prior.validationReceiptDigest &&
      Date.parse(input.issuedAt) >= Date.parse(prior.observedAt),
  );
}
export interface ModelLiveSequenceCaseProjectionV3 {
  readonly caseId: Stage["caseId"];
  readonly state:
    | "requires-input"
    | "requires-dispatch-admission"
    | "awaiting-outcome"
    | "requires-unused-outcome"
    | "validated"
    | "exhausted"
    | "stopped"
    | "held-unknown";
  readonly stageId?: string;
  readonly unusedReason?: NoDispatchReason;
}

/** Finite metadata projection only. Every digest still requires its actual
 * issued receipt/row verifier; no result grants model, policy or financial
 * authority. Terminal unknowns stay held and are not coerced to zero usage. */
interface SequenceInspectionInput {
  readonly plan: unknown;
  readonly selection: unknown;
  readonly inputs: readonly unknown[];
  readonly dispatches: readonly unknown[];
  readonly outcomes: readonly unknown[];
  readonly observedAt: string;
}
interface SequenceInspectionResult {
  readonly cases: readonly ModelLiveSequenceCaseProjectionV3[];
  readonly complete: boolean;
  readonly held: boolean;
}

/** Historical V3 comparison reader, unchanged. */
export function inspectModelLiveSequenceV3(
  input: SequenceInspectionInput,
): SequenceInspectionResult {
  return inspectSequence(input, 3, []);
}

/** Explicit V4 observed-attempt reader over unchanged issued V3 parent records.
 * This checks lineage only. Even lineageComplete never proves canonical final
 * settlement or grants authority to dispatch, apply a patch or issue a report. */
export function inspectModelLiveSequenceAttemptsV4(
  input: SequenceInspectionInput & {
    readonly observations: readonly unknown[];
  },
): {
  readonly cases: readonly ModelLiveSequenceCaseProjectionV3[];
  readonly lineageComplete: boolean;
  readonly held: boolean;
} {
  const result = inspectSequence(input, 4, input.observations);
  return {
    cases: result.cases,
    lineageComplete: result.complete,
    held: result.held,
  };
}
function inspectSequence(
  input: SequenceInspectionInput,
  version: 3 | 4,
  observations: readonly unknown[],
): SequenceInspectionResult {
  return checked(() => {
    const plan = modelLiveSequencePlanV3Schema.parse(input.plan);
    const selection = modelLiveSequenceSelectionV3Schema.parse(input.selection);
    const now = Date.parse(utcTimestampSchema.parse(input.observedAt));
    requireSequence(
      selection.definitionId === plan.definition.definitionId &&
        selection.planDigest === plan.planDigest &&
        selection.approvalDigest === plan.approval.approvalDigest &&
        same(selection.scope, plan.definition.scope) &&
        Date.parse(selection.issuedAt) >= Date.parse(plan.issuedAt) &&
        Date.parse(selection.issuedAt) < Date.parse(plan.expiresAt) &&
        now >= Date.parse(selection.issuedAt),
    );
    const expected = plan.definition.cases.flatMap((entry) =>
      ["repair-1", "repair-2"].map((stageKey) => ({
        caseId: entry.caseId,
        caseDigest: entry.caseDigest,
        stageKey,
      })),
    );
    requireSequence(
      same(
        selection.stages.map(({ caseId, caseDigest, stageKey }) => ({
          caseId,
          caseDigest,
          stageKey,
        })),
        expected,
      ),
    );
    const inputs = unique(
      input.inputs.map((record) =>
        modelLiveSequenceInputV3Schema.parse(record),
      ),
    );
    const dispatches = unique(
      input.dispatches.map((record) =>
        version === 3
          ? modelLiveSequenceDispatchV3Schema.parse(record)
          : modelLiveSequenceDispatchV4Schema.parse(record),
      ),
    );
    const outcomes = unique(
      input.outcomes.map((record) =>
        version === 3
          ? modelLiveSequenceOutcomeV3Schema.parse(record)
          : modelLiveSequenceOutcomeV4Schema.parse(record),
      ),
    );
    if (version === 4)
      assertObservedAttempts(
        selection,
        dispatches,
        outcomes,
        observations,
        now,
      );
    for (const record of [
      ...inputs.values(),
      ...dispatches.values(),
      ...outcomes.values(),
    ])
      exactStage(record, selection);
    for (const record of inputs.values()) {
      const definition = plan.definition.cases.find(
        (entry) => entry.caseId === record.caseId,
      );
      requireSequence(
        record.recipeDigest === definition?.recipeDigest &&
          record.authorityTupleDigest ===
            definition.authorityBinding.authorityTupleDigest &&
          record.revisionDigest === definition.seed.revisionDigest &&
          record.ownershipDigest === definition.seed.ownershipDigest &&
          Date.parse(record.issuedAt) >= Date.parse(selection.issuedAt) &&
          Date.parse(record.issuedAt) < Date.parse(plan.expiresAt) &&
          Date.parse(record.issuedAt) <= now,
      );
      if (record.stageKey === "repair-1") {
        requireSequence(
          record.predecessor.kind === "seed" &&
            record.predecessor.candidateDigest ===
              definition.seed.candidateDigest &&
            record.predecessor.validationReceiptDigest ===
              definition.seed.validationReceiptDigest,
        );
      } else {
        const priorStage = selection.stages.find(
          (entry) =>
            entry.caseId === record.caseId && entry.stageKey === "repair-1",
        );
        const prior =
          priorStage === undefined
            ? undefined
            : outcomes.get(priorStage.stageId);
        requireSequence(prior !== undefined);
        exactPredecessor(record, prior);
      }
    }
    for (const dispatch of dispatches.values()) {
      const prepared = inputs.get(dispatch.stageId);
      requireSequence(
        prepared?.inputBindingDigest === dispatch.inputBindingDigest &&
          Date.parse(dispatch.dispatchedAt) >= Date.parse(prepared.issuedAt) &&
          Date.parse(dispatch.dispatchedAt) < Date.parse(plan.expiresAt) &&
          Date.parse(dispatch.dispatchedAt) <= now,
      );
    }
    for (const outcome of outcomes.values()) {
      requireSequence(
        Date.parse(outcome.observedAt) >= Date.parse(selection.issuedAt) &&
          Date.parse(outcome.observedAt) <= now,
      );
      const dispatch = dispatches.get(outcome.stageId);
      if (outcome.status === "not-dispatched") {
        const prepared = inputs.get(outcome.stageId);
        requireSequence(
          dispatch === undefined &&
            (prepared === undefined ||
              Date.parse(prepared.issuedAt) <= Date.parse(outcome.observedAt)),
        );
      } else
        requireSequence(
          outcome.dispatchDigest === dispatch?.dispatchDigest &&
            outcome.inputBindingDigest === dispatch.inputBindingDigest &&
            Date.parse(outcome.observedAt) >= Date.parse(dispatch.dispatchedAt),
        );
    }
    const cases: ModelLiveSequenceCaseProjectionV3[] = [];
    for (const definition of plan.definition.cases) {
      const pair = selection.stages.filter(
        (entry) => entry.caseId === definition.caseId,
      );
      const first = pair[0],
        second = pair[1];
      requireSequence(first !== undefined && second !== undefined);
      const firstOutcome = outcomes.get(first.stageId),
        secondOutcome = outcomes.get(second.stageId);
      if (firstOutcome === undefined) {
        requireSequence(
          !inputs.has(second.stageId) &&
            !dispatches.has(second.stageId) &&
            secondOutcome === undefined,
        );
        cases.push({
          caseId: definition.caseId,
          stageId: first.stageId,
          state: dispatches.has(first.stageId)
            ? "awaiting-outcome"
            : inputs.has(first.stageId)
              ? "requires-dispatch-admission"
              : "requires-input",
        });
        continue;
      }
      if (firstOutcome.status === "not-dispatched")
        requireSequence(
          [
            "current-authority-denied",
            "cancelled-before-dispatch",
            "ram-unavailable",
          ].includes(firstOutcome.reason),
        );
      const stop = stoppedBy(firstOutcome);
      if (stop !== undefined) {
        requireSequence(
          !inputs.has(second.stageId) && !dispatches.has(second.stageId),
        );
        if (secondOutcome === undefined) {
          cases.push({
            caseId: definition.caseId,
            state: "requires-unused-outcome",
            stageId: second.stageId,
            unusedReason: stop,
          });
          continue;
        }
        requireSequence(
          secondOutcome.status === "not-dispatched" &&
            secondOutcome.reason === stop &&
            Date.parse(secondOutcome.observedAt) >=
              Date.parse(firstOutcome.observedAt),
        );
      } else if (secondOutcome === undefined) {
        cases.push({
          caseId: definition.caseId,
          stageId: second.stageId,
          state: dispatches.has(second.stageId)
            ? "awaiting-outcome"
            : inputs.has(second.stageId)
              ? "requires-dispatch-admission"
              : "requires-input",
        });
        continue;
      } else if (secondOutcome.status === "not-dispatched") {
        requireSequence(
          [
            "current-authority-denied",
            "cancelled-before-dispatch",
            "ram-unavailable",
          ].includes(secondOutcome.reason) &&
            Date.parse(secondOutcome.observedAt) >=
              Date.parse(firstOutcome.observedAt),
        );
      }
      const state =
        firstOutcome.status === "dispatch-unknown" ||
        secondOutcome.status === "dispatch-unknown"
          ? "held-unknown"
          : [firstOutcome, secondOutcome].some(
                (outcome) =>
                  outcome.status === "validated" &&
                  outcome.validation.status === "valid",
              )
            ? "validated"
            : secondOutcome.status === "validated" &&
                secondOutcome.validation.status === "invalid"
              ? "exhausted"
              : "stopped";
      cases.push({ caseId: definition.caseId, state });
    }
    const terminal = new Set([
      "validated",
      "exhausted",
      "stopped",
      "held-unknown",
    ]);
    return {
      cases,
      complete: cases.every((entry) => terminal.has(entry.state)),
      held: [...outcomes.values()].some(
        (entry) => entry.status === "dispatch-unknown",
      ),
    };
  });
}

function assertObservedAttempts(
  selection: ModelLiveSequenceSelectionV3,
  dispatches: ReadonlyMap<
    string,
    ModelLiveSequenceDispatchV3 | ModelLiveSequenceDispatchV4
  >,
  outcomes: ReadonlyMap<
    string,
    ModelLiveSequenceOutcomeV3 | ModelLiveSequenceOutcomeV4
  >,
  raw: readonly unknown[],
  now: number,
): void {
  const observations = unique(
    raw.map((value) =>
      modelLiveSequenceAttemptObservationV4Schema.parse(value),
    ),
  );
  const workflows = new Map<string, { workflow: string; intent: string }>();
  const workflowCases = new Set<string>();
  const intentCases = new Set<string>();
  const attempts = new Set<string>();
  const usageRecords = new Set<string>();
  const platformReservations = new Set<string>();
  for (const dispatch of dispatches.values()) {
    requireSequence(dispatch.contractVersion === 4);
    const pair = {
      workflow: dispatch.canonicalWorkflowFingerprint,
      intent: dispatch.canonicalDispatchIntentDigest,
    };
    const prior = workflows.get(dispatch.caseId);
    if (prior === undefined) {
      requireSequence(
        !workflowCases.has(pair.workflow) && !intentCases.has(pair.intent),
      );
      intentCases.add(pair.intent);
      workflowCases.add(pair.workflow);
      workflows.set(dispatch.caseId, pair);
    } else requireSequence(same(pair, prior));
    requireSequence(
      !platformReservations.has(dispatch.platformReservationDigest),
    );
    platformReservations.add(dispatch.platformReservationDigest);
  }
  for (const observation of observations.values()) {
    exactStage(observation, selection);
    requireSequence(
      !attempts.has(observation.canonicalAttemptDigest) &&
        !usageRecords.has(observation.normalizedUsageDigest),
    );
    attempts.add(observation.canonicalAttemptDigest);
    usageRecords.add(observation.normalizedUsageDigest);
    const dispatch = dispatches.get(observation.stageId);
    requireSequence(dispatch?.contractVersion === 4);
    requireSequence(
      observation.dispatchDigest === dispatch.dispatchDigest &&
        observation.inputBindingDigest === dispatch.inputBindingDigest &&
        observation.canonicalWorkflowFingerprint ===
          dispatch.canonicalWorkflowFingerprint &&
        observation.canonicalAttemptOrdinal ===
          dispatch.canonicalAttemptOrdinal &&
        Date.parse(observation.observedAt) >=
          Date.parse(dispatch.dispatchedAt) &&
        Date.parse(observation.observedAt) <= now,
    );
  }
  for (const outcome of outcomes.values()) {
    requireSequence(outcome.contractVersion === 4);
    if (
      outcome.status === "validated" ||
      outcome.status === "provider-failed"
    ) {
      const observation = observations.get(outcome.stageId);
      requireSequence(
        outcome.commercialAttemptObservationDigest ===
          observation?.observationDigest &&
          outcome.dispatchDigest === observation.dispatchDigest &&
          outcome.inputBindingDigest === observation.inputBindingDigest &&
          outcome.normalizedUsageDigest === observation.normalizedUsageDigest &&
          Date.parse(outcome.observedAt) >= Date.parse(observation.observedAt),
      );
    }
  }
}
