import {
  digestCanonicalValue,
  modelLiveRuntimeControlPolicyV2Schema,
  modelLiveSequenceDefinitionV3Schema,
  modelLiveSequenceApprovalV3Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceDispatchV3Schema,
  modelLiveSequenceOutcomeV3Schema,
  MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3,
  type ModelLiveSequenceInputV3,
  type ModelLiveSequenceOutcomeV3,
  type ModelLiveSequenceOutcomeV4,
} from "@cloudmarkup/schemas";
import { syntheticLiveEvaluationFixtureV2 } from "./model-live-evaluation-fakes.js";

export function rehashSequenceTest<T extends object>(value: T, key: string): T {
  return {
    ...value,
    [key]: digestCanonicalValue(
      Object.fromEntries(
        Object.entries(value).filter(([name]) => name !== key),
      ),
    ),
  };
}
const d = (name: string) =>
  digestCanonicalValue({ syntheticSequenceTest: name });
/** Synthetic comparison metadata only. No record here is a host-issued receipt,
 * genuine validation, normal quality evidence, plan approval or financial fact. */
export function syntheticSequenceFixtureV3(
  input: Parameters<typeof syntheticLiveEvaluationFixtureV2>[0] & {
    readonly runtimeRepairRoute?: true;
  } = {},
) {
  const { runtimeRepairRoute, ...baseInput } = input;
  const v2 = syntheticLiveEvaluationFixtureV2({
    ...baseInput,
    fullBetaEvaluationSource: true,
  });
  const selected = v2.definition.cases.filter(
    (entry) =>
      entry.authorityBinding.authorityTuple.operation === "candidate.repair",
  );
  if (selected.length !== 2)
    throw new Error("Expected exact two frozen synthetic repair cases.");
  const policy = modelLiveRuntimeControlPolicyV2Schema.parse(
    rehashSequenceTest(
      {
        ...v2.policy,
        ...(runtimeRepairRoute
          ? {
              allowlists: {
                ...v2.policy.allowlists,
                routes: ["internal-escalation"],
              },
            }
          : {}),
        evaluationRequirement: {
          ...v2.policy.evaluationRequirement,
          datasetCaseDigests: selected.map((entry) => entry.caseDigest),
        },
      },
      "policyDigest",
    ),
  );
  const definition = modelLiveSequenceDefinitionV3Schema.parse(
    rehashSequenceTest(
      {
        ...v2.definition,
        contractVersion: 3,
        recordKind: "model-live-sequence-definition",
        policy,
        cases: selected.map((entry) => ({
          caseId: entry.caseId,
          caseDigest: entry.caseDigest,
          sourceInputDigest: entry.sourceInputDigest,
          authorityBinding: entry.authorityBinding,
          routeId: runtimeRepairRoute ? "internal-escalation" : entry.routeId,
          recipeDigest: MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3,
          seed: {
            sourceDigest: d("seed-source"),
            revisionDigest: d("revision"),
            candidateDigest: d("invalid-seed"),
            ownershipDigest: d("ownership"),
            validationReceiptDigest: d("synthetic-invalid-seed-validation"),
            validatorPolicyDigest: d("validator-policy"),
          },
        })),
      },
      "definitionDigest",
    ),
  );
  const approval = modelLiveSequenceApprovalV3Schema.parse(
    rehashSequenceTest(
      {
        ...v2.approval,
        contractVersion: 3,
        recordKind: "model-live-sequence-approval",
        definitionDigest: definition.definitionDigest,
      },
      "approvalDigest",
    ),
  );
  const plan = modelLiveSequencePlanV3Schema.parse(
    rehashSequenceTest(
      {
        ...v2.plan,
        contractVersion: 3,
        recordKind: "model-live-sequence-plan",
        definition,
        approval,
      },
      "planDigest",
    ),
  );
  const selectionBody = {
    contractVersion: 3,
    recordKind: "model-live-sequence-selection",
    issuerId: "cloudmarkup.model-live-sequence-selection",
    issuerVersion: "1.0.0",
    selectionId: `live_sequence_${"1".repeat(32)}`,
    definitionId: definition.definitionId,
    planDigest: plan.planDigest,
    approvalDigest: approval.approvalDigest,
    scope: definition.scope,
    issuedAt: plan.issuedAt,
    stages: definition.cases.flatMap((entry, caseIndex) =>
      ["repair-1", "repair-2"].map((stageKey, stageIndex) => {
        const suffix = (caseIndex * 2 + stageIndex + 1)
          .toString(16)
          .padStart(32, "0");
        return {
          caseId: entry.caseId,
          caseDigest: entry.caseDigest,
          stageKey,
          stageId: `live_stage_${suffix}`,
          invocationId: `invocation_${suffix}`,
        };
      }),
    ),
  };
  const selection = modelLiveSequenceSelectionV3Schema.parse({
    ...selectionBody,
    selectionDigest: digestCanonicalValue(selectionBody),
  });
  const at = (milliseconds: number) =>
    new Date(Date.parse(plan.issuedAt) + milliseconds).toISOString();
  const bound = (index: number) => {
    const stage = selection.stages[index];
    if (stage === undefined) throw new Error("Missing synthetic stage.");
    return {
      ...stage,
      selectionId: selection.selectionId,
      selectionDigest: selection.selectionDigest,
      planDigest: plan.planDigest,
    };
  };
  const prepare = (
    index: number,
    prior?: ModelLiveSequenceOutcomeV3 | ModelLiveSequenceOutcomeV4,
  ) => {
    const stage = bound(index);
    const c = definition.cases.find((entry) => entry.caseId === stage.caseId);
    if (c === undefined) throw new Error("Missing synthetic case.");
    const predecessor =
      prior?.status === "validated"
        ? {
            kind: "stage",
            stageId: prior.stageId,
            outcomeDigest: prior.outcomeDigest,
            outputDigest: prior.outputDigest,
            candidateDigest: prior.candidateDigest,
            validationReceiptDigest: prior.validationReceiptDigest,
          }
        : {
            kind: "seed",
            candidateDigest: c.seed.candidateDigest,
            validationReceiptDigest: c.seed.validationReceiptDigest,
          };
    const body = {
      contractVersion: 3,
      recordKind: "model-live-sequence-input",
      ...stage,
      recipeDigest: c.recipeDigest,
      authorityTupleDigest: c.authorityBinding.authorityTupleDigest,
      operationInputDigest: d(`operation-${stage.stageId}`),
      preparedPayloadDigest: d(`payload-${stage.stageId}`),
      diagnosticsDigest: d(`diagnostics-${stage.stageId}`),
      revisionDigest: c.seed.revisionDigest,
      ownershipDigest: c.seed.ownershipDigest,
      predecessor,
      issuedAt: at(stage.stageKey === "repair-1" ? 100 : 400),
    };
    return modelLiveSequenceInputV3Schema.parse({
      ...body,
      inputBindingDigest: digestCanonicalValue(body),
    });
  };
  const dispatch = (prepared: ModelLiveSequenceInputV3) => {
    const index = selection.stages.findIndex(
      (entry) => entry.stageId === prepared.stageId,
    );
    const body = {
      contractVersion: 3,
      recordKind: "model-live-sequence-dispatch",
      ...bound(index),
      inputBindingDigest: prepared.inputBindingDigest,
      descriptorDigest: d(`descriptor-${prepared.stageId}`),
      runtimeRequestDigest: d(`runtime-${prepared.stageId}`),
      canonicalAttemptDigest: d(`attempt-${prepared.stageId}`),
      platformReservationDigest: d(`platform-${prepared.stageId}`),
      dispatchedAt: at(prepared.stageKey === "repair-1" ? 200 : 500),
    };
    return modelLiveSequenceDispatchV3Schema.parse({
      ...body,
      dispatchDigest: digestCanonicalValue(body),
    });
  };
  const outcome = (
    prepared: ModelLiveSequenceInputV3,
    result:
      "valid" | "repairable" | "nonrepairable" | "unknown" | "provider-failed",
  ) => {
    const sent = dispatch(prepared);
    const index = selection.stages.findIndex(
      (entry) => entry.stageId === prepared.stageId,
    );
    const base = {
      contractVersion: 3,
      recordKind: "model-live-sequence-outcome",
      ...bound(index),
      inputBindingDigest: prepared.inputBindingDigest,
      dispatchDigest: sent.dispatchDigest,
      observedAt: at(prepared.stageKey === "repair-1" ? 300 : 600),
    };
    const known = {
      normalizedUsageDigest: d(`usage-${prepared.stageId}`),
      commercialTerminalDigest: d(`commercial-${prepared.stageId}`),
    };
    const body =
      result === "unknown"
        ? { ...base, status: "dispatch-unknown", reason: "missing-usage" }
        : result === "provider-failed"
          ? {
              ...base,
              ...known,
              status: "provider-failed",
              failure: "rejected",
            }
          : {
              ...base,
              ...known,
              status: "validated",
              outputDigest: d(`output-${prepared.stageId}`),
              candidateDigest: d(`candidate-${prepared.stageId}`),
              validationReceiptDigest: d(`validation-${prepared.stageId}`),
              validation: {
                status: result === "valid" ? "valid" : "invalid",
                repairable: result === "repairable",
              },
            };
    return modelLiveSequenceOutcomeV3Schema.parse({
      ...body,
      outcomeDigest: digestCanonicalValue(body),
    });
  };
  const unused = (
    index: number,
    reason: Extract<
      ModelLiveSequenceOutcomeV3,
      { status: "not-dispatched" }
    >["reason"],
  ) => {
    const body = {
      contractVersion: 3,
      recordKind: "model-live-sequence-outcome",
      ...bound(index),
      status: "not-dispatched",
      reason,
      noDispatchReceiptDigest: d(`synthetic-no-dispatch-${String(index)}`),
      observedAt: at(700),
    };
    return modelLiveSequenceOutcomeV3Schema.parse({
      ...body,
      outcomeDigest: digestCanonicalValue(body),
    });
  };
  return {
    v2,
    definition,
    approval,
    plan,
    policy,
    selection,
    prepare,
    dispatch,
    outcome,
    unused,
    observedAt: at(1000),
    dataset: v2.dataset,
    empty: {
      plan,
      selection,
      inputs: [],
      dispatches: [],
      outcomes: [],
      observedAt: at(1000),
    },
  };
}
