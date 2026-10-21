import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelLiveEvaluationPlanV2Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceDefinitionV3Schema,
  modelLiveSequenceApprovalV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceDispatchV3Schema,
  modelLiveSequenceOutcomeV3Schema,
} from "@cloudmarkup/schemas";
import {
  inspectModelLiveSequenceV3,
  ModelLiveSequenceError,
  validateModelLiveSequenceDefinitionV3,
} from "./model-live-evaluation-sequence.js";
import {
  rehashSequenceTest,
  syntheticSequenceFixtureV3,
} from "./model-live-sequence-test-helpers.js";
const d = (value: string) =>
  digestCanonicalValue({ syntheticSubstitution: value });

describe("separate V3 pre-issued repair contracts", () => {
  it("compares the exact frozen repair cases without changing V2 parsing", () => {
    const f = syntheticSequenceFixtureV3();
    expect(
      validateModelLiveSequenceDefinitionV3({
        definition: f.definition,
        dataset: f.dataset,
        expectedPolicy: f.policy,
      }),
    ).toEqual(f.definition);
    expect(modelLiveEvaluationPlanV2Schema.parse(f.v2.plan)).toEqual(f.v2.plan);
    expect(modelLiveEvaluationPlanV2Schema.safeParse(f.plan).success).toBe(
      false,
    );
    expect(modelLiveSequencePlanV3Schema.safeParse(f.v2.plan).success).toBe(
      false,
    );
    expect(f.selection.stages).toHaveLength(4);
  });
  it.each(["prompt", "candidate", "approved", "capabilityActivated"])(
    "rejects persisted %s additions even with coherent rehashing",
    (field) => {
      const f = syntheticSequenceFixtureV3(),
        prepared = f.prepare(0),
        sent = f.dispatch(prepared),
        completed = f.outcome(prepared, "valid");
      const records = [
        [f.definition, "definitionDigest", modelLiveSequenceDefinitionV3Schema],
        [f.approval, "approvalDigest", modelLiveSequenceApprovalV3Schema],
        [f.plan, "planDigest", modelLiveSequencePlanV3Schema],
        [f.selection, "selectionDigest", modelLiveSequenceSelectionV3Schema],
        [prepared, "inputBindingDigest", modelLiveSequenceInputV3Schema],
        [sent, "dispatchDigest", modelLiveSequenceDispatchV3Schema],
        [completed, "outcomeDigest", modelLiveSequenceOutcomeV3Schema],
      ] as const;
      for (const [record, key, schema] of records) {
        const body = { ...record, [field]: "synthetic untrusted content" };
        const result = schema.safeParse(rehashSequenceTest(body, key));
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: "unrecognized_keys",
                keys: [field],
                path: [],
              }),
            ]),
          );
        }
      }
    },
  );
  it.each(["recipe", "case", "operation", "budget", "source"])(
    "denies substituted %s definition authority",
    (kind) => {
      const f = syntheticSequenceFixtureV3();
      const definition = structuredClone(f.definition);
      const first = definition.cases[0];
      if (first === undefined) throw new Error("Missing fixture.");
      if (kind === "recipe") first.recipeDigest = d("foreign-recipe");
      if (kind === "case") first.caseDigest = d("foreign-case");
      if (kind === "source") first.sourceInputDigest = d("foreign-source");
      if (kind === "budget") definition.limits.maximumInvocations = 3;
      if (kind === "operation") {
        first.authorityBinding.authorityTuple.operation = "operations.propose";
        first.authorityBinding.authorityTupleDigest = digestCanonicalValue(
          first.authorityBinding.authorityTuple,
        );
      }
      expect(() =>
        validateModelLiveSequenceDefinitionV3({
          definition: rehashSequenceTest(definition, "definitionDigest"),
          dataset: f.dataset,
          expectedPolicy: f.policy,
        }),
      ).toThrow(ModelLiveSequenceError);
    },
  );
  it.each([
    "duplicate-stage",
    "duplicate-invocation",
    "reordered",
    "missing-slot",
  ])("rejects %s selection", (kind) => {
    const f = syntheticSequenceFixtureV3();
    const selection = structuredClone(f.selection);
    const first = selection.stages[0],
      second = selection.stages[1];
    if (!first || !second) throw new Error("Missing fixture.");
    if (kind === "duplicate-stage") second.stageId = first.stageId;
    if (kind === "duplicate-invocation")
      second.invocationId = first.invocationId;
    if (kind === "reordered") selection.stages.reverse();
    if (kind === "missing-slot") selection.stages.pop();
    expect(
      modelLiveSequenceSelectionV3Schema.safeParse(
        rehashSequenceTest(selection, "selectionDigest"),
      ).success,
    ).toBe(false);
  });
});

describe("finite V3 sequence metadata projection", () => {
  it("separates preparation, dispatch admission and awaiting an actual outcome", () => {
    const f = syntheticSequenceFixtureV3(),
      prepared = f.prepare(0),
      sent = f.dispatch(prepared);
    expect(inspectModelLiveSequenceV3(f.empty).cases[0]?.state).toBe(
      "requires-input",
    );
    expect(
      inspectModelLiveSequenceV3({ ...f.empty, inputs: [prepared] }).cases[0]
        ?.state,
    ).toBe("requires-dispatch-admission");
    expect(
      inspectModelLiveSequenceV3({
        ...f.empty,
        inputs: [prepared],
        dispatches: [sent],
      }).cases[0]?.state,
    ).toBe("awaiting-outcome");
  });
  it("retains first-attempt success and both exhausted attempts without projecting a quality grade", () => {
    const f = syntheticSequenceFixtureV3();
    const success = f.prepare(0),
      invalid = f.prepare(2),
      prior = f.outcome(invalid, "repairable"),
      child = f.prepare(3, prior);
    const records = {
      ...f.empty,
      inputs: [success, invalid, child],
      dispatches: [success, invalid, child].map(f.dispatch),
      outcomes: [
        f.outcome(success, "valid"),
        f.unused(1, "predecessor-valid"),
        prior,
        f.outcome(child, "repairable"),
      ],
    };
    const result = inspectModelLiveSequenceV3(records);
    expect(result).toEqual({
      complete: true,
      held: false,
      cases: [
        { caseId: f.definition.cases[0]?.caseId, state: "validated" },
        { caseId: f.definition.cases[1]?.caseId, state: "exhausted" },
      ],
    });
    expect(result).not.toHaveProperty("quality");
    expect(result).not.toHaveProperty("approved");
    expect(records.outcomes).toHaveLength(4);
  });
  it("does not drop unused slots after success", () => {
    const f = syntheticSequenceFixtureV3(),
      prepared = f.prepare(0);
    const result = inspectModelLiveSequenceV3({
      ...f.empty,
      inputs: [prepared],
      dispatches: [f.dispatch(prepared)],
      outcomes: [f.outcome(prepared, "valid")],
    });
    expect(result.complete).toBe(false);
    expect(result.cases[0]).toMatchObject({
      state: "requires-unused-outcome",
      unusedReason: "predecessor-valid",
    });
  });
  it("keeps unknown dispatch held rather than reporting zero usage or successful completion", () => {
    const f = syntheticSequenceFixtureV3(),
      prepared = f.prepare(0),
      unknown = f.outcome(prepared, "unknown");
    const result = inspectModelLiveSequenceV3({
      ...f.empty,
      inputs: [prepared],
      dispatches: [f.dispatch(prepared)],
      outcomes: [
        unknown,
        f.unused(1, "predecessor-unknown"),
        f.unused(2, "current-authority-denied"),
        f.unused(3, "predecessor-not-dispatched"),
      ],
    });
    expect(result.complete).toBe(true);
    expect(result.held).toBe(true);
    expect(result.cases[0]?.state).toBe("held-unknown");
    expect(
      modelLiveSequenceOutcomeV3Schema.safeParse(
        rehashSequenceTest(
          { ...unknown, normalizedUsageDigest: d("pretend-zero-usage") },
          "outcomeDigest",
        ),
      ).success,
    ).toBe(false);
  });
  it.each(["valid", "nonrepairable", "unknown", "provider-failed"] as const)(
    "does not admit a child after predecessor %s",
    (kind) => {
      const f = syntheticSequenceFixtureV3(),
        prepared = f.prepare(0),
        prior = f.outcome(prepared, kind);
      const staleRepairable = f.outcome(prepared, "repairable"),
        child = f.prepare(1, staleRepairable);
      const unusedReason = {
        valid: "predecessor-valid",
        nonrepairable: "predecessor-nonrepairable",
        unknown: "predecessor-unknown",
        "provider-failed": "predecessor-provider-failed",
      }[kind];
      expect(
        inspectModelLiveSequenceV3({
          ...f.empty,
          inputs: [prepared],
          dispatches: [f.dispatch(prepared)],
          outcomes: [prior],
        }).cases[0],
      ).toMatchObject({ state: "requires-unused-outcome", unusedReason });
      if (child.predecessor.kind !== "stage")
        throw new Error("Missing child predecessor.");
      child.predecessor.outcomeDigest = prior.outcomeDigest;
      expect(() =>
        inspectModelLiveSequenceV3({
          ...f.empty,
          inputs: [prepared, rehashSequenceTest(child, "inputBindingDigest")],
          dispatches: [f.dispatch(prepared)],
          outcomes: [prior],
        }),
      ).toThrow(ModelLiveSequenceError);
    },
  );
  it.each([
    "outcome",
    "output",
    "candidate",
    "validation",
    "ownership",
    "revision",
    "clock",
  ])("denies a rehashed child %s substitution", (kind) => {
    const f = syntheticSequenceFixtureV3(),
      prepared = f.prepare(0),
      prior = f.outcome(prepared, "repairable"),
      child = f.prepare(1, prior);
    if (child.predecessor.kind !== "stage")
      throw new Error("Missing child predecessor.");
    if (kind === "outcome")
      child.predecessor.outcomeDigest = d("foreign-outcome");
    if (kind === "output") child.predecessor.outputDigest = d("foreign-output");
    if (kind === "candidate")
      child.predecessor.candidateDigest = d("foreign-candidate");
    if (kind === "validation")
      child.predecessor.validationReceiptDigest = d("foreign-validation");
    if (kind === "ownership") child.ownershipDigest = d("foreign-ownership");
    if (kind === "revision") child.revisionDigest = d("foreign-revision");
    if (kind === "clock") child.issuedAt = prepared.issuedAt;
    expect(() =>
      inspectModelLiveSequenceV3({
        ...f.empty,
        inputs: [prepared, rehashSequenceTest(child, "inputBindingDigest")],
        dispatches: [f.dispatch(prepared)],
        outcomes: [prior],
      }),
    ).toThrow(ModelLiveSequenceError);
  });
  it.each([
    "wrong-input",
    "missing-input",
    "duplicate-outcome",
    "denied-after-send",
  ])("rejects %s dispatch/outcome lineage", (kind) => {
    const f = syntheticSequenceFixtureV3(),
      prepared = f.prepare(0),
      sent = f.dispatch(prepared),
      done = f.outcome(prepared, "valid");
    if (kind === "wrong-input") sent.inputBindingDigest = d("foreign-input");
    const records = {
      ...f.empty,
      inputs: kind === "missing-input" ? [] : [prepared],
      dispatches: [rehashSequenceTest(sent, "dispatchDigest")],
      outcomes:
        kind === "duplicate-outcome"
          ? [done, done]
          : kind === "denied-after-send"
            ? [f.unused(0, "current-authority-denied")]
            : [done],
    };
    expect(() => inspectModelLiveSequenceV3(records)).toThrow(
      ModelLiveSequenceError,
    );
  });
  it("denies input issuance after a coherently rehashed no-dispatch closure", () => {
    const f = syntheticSequenceFixtureV3(),
      prepared = f.prepare(0),
      outcome = f.unused(0, "cancelled-before-dispatch");
    const closed = rehashSequenceTest(
      {
        ...outcome,
        observedAt: new Date(Date.parse(prepared.issuedAt) - 1).toISOString(),
      },
      "outcomeDigest",
    );
    expect(() =>
      inspectModelLiveSequenceV3({
        ...f.empty,
        inputs: [prepared],
        outcomes: [closed],
      }),
    ).toThrow(ModelLiveSequenceError);
  });
  it("preserves legitimate input issuance followed by cancellation", () => {
    const f = syntheticSequenceFixtureV3(),
      prepared = f.prepare(0),
      outcome = f.unused(0, "cancelled-before-dispatch");
    const result = inspectModelLiveSequenceV3({
      ...f.empty,
      inputs: [prepared],
      outcomes: [outcome],
    });
    expect(result.cases[0]).toMatchObject({
      state: "requires-unused-outcome",
      unusedReason: "predecessor-not-dispatched",
    });
    expect(result.complete).toBe(false);
  });
  it("preserves cancellation before any input is issued", () => {
    const f = syntheticSequenceFixtureV3();
    const result = inspectModelLiveSequenceV3({
      ...f.empty,
      outcomes: [f.unused(0, "cancelled-before-dispatch")],
    });
    expect(result.cases[0]).toMatchObject({
      state: "requires-unused-outcome",
      unusedReason: "predecessor-not-dispatched",
    });
  });
  it("rejects a coherently rehashed selection from another plan", () => {
    const f = syntheticSequenceFixtureV3();
    const selection = rehashSequenceTest(
      { ...f.selection, planDigest: d("foreign-plan") },
      "selectionDigest",
    );
    expect(() => inspectModelLiveSequenceV3({ ...f.empty, selection })).toThrow(
      ModelLiveSequenceError,
    );
  });
});
