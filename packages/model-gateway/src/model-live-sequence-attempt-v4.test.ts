import { describe, expect, it } from "vitest";
import {
  modelLiveSequenceDispatchV4Schema,
  modelLiveSequenceAttemptObservationV4Schema,
  modelLiveSequenceOutcomeV4Schema,
  modelLiveSequenceAttemptRecordV4Schema,
  modelLiveSequenceDispatchV3Schema,
  modelLiveSequenceOutcomeV3Schema,
  type ModelLiveSequenceInputV3,
} from "@cloudmarkup/schemas";
import { digestStructuredValue } from "./security.js";
import {
  inspectModelLiveSequenceV3,
  inspectModelLiveSequenceAttemptsV4,
} from "./model-live-evaluation-sequence.js";
import {
  syntheticSequenceFixtureV3,
  rehashSequenceTest as rehash,
} from "./model-live-sequence-test-helpers.js";
const d = (value: string) =>
  digestStructuredValue({ syntheticAttemptTest: value });
function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw Error("Missing synthetic observed-attempt fixture");
  return value;
}
/** Synthetic data conversions only; no production issuance, usage or validation. */
function fixture() {
  const legacy = syntheticSequenceFixtureV3();
  const dispatch = (input: ModelLiveSequenceInputV3) => {
    const { canonicalAttemptDigest, ...base } = legacy.dispatch(input);
    void canonicalAttemptDigest;
    return modelLiveSequenceDispatchV4Schema.parse(
      rehash(
        {
          ...base,
          contractVersion: 4,
          parentSequenceContractVersion: 3,
          canonicalWorkflowFingerprint: d("workflow-" + input.caseId),
          canonicalDispatchIntentDigest: d("intent-" + input.caseId),
          canonicalPlannedCallDigest: d("planned-" + input.stageId),
          canonicalAttemptOrdinal: input.stageKey === "repair-1" ? 1 : 2,
        },
        "dispatchDigest",
      ),
    );
  };
  const observation = (input: ModelLiveSequenceInputV3) => {
    const sent = dispatch(input);
    return modelLiveSequenceAttemptObservationV4Schema.parse(
      rehash(
        {
          contractVersion: 4,
          parentSequenceContractVersion: 3,
          recordKind: "model-live-sequence-attempt-observation",
          selectionId: input.selectionId,
          selectionDigest: input.selectionDigest,
          planDigest: input.planDigest,
          caseId: input.caseId,
          caseDigest: input.caseDigest,
          stageKey: input.stageKey,
          stageId: input.stageId,
          invocationId: input.invocationId,
          inputBindingDigest: input.inputBindingDigest,
          dispatchDigest: sent.dispatchDigest,
          canonicalWorkflowFingerprint: sent.canonicalWorkflowFingerprint,
          canonicalAttemptOrdinal: sent.canonicalAttemptOrdinal,
          canonicalAttemptDigest: d(
            "actual-completed-attempt-" + input.stageId,
          ),
          normalizedUsageDigest: d("usage-" + input.stageId),
          observedAt: new Date(
            Date.parse(sent.dispatchedAt) + 25,
          ).toISOString(),
        },
        "observationDigest",
      ),
    );
  };
  const outcome = (
    input: ModelLiveSequenceInputV3,
    result: Parameters<typeof legacy.outcome>[1],
  ) => {
    const raw = legacy.outcome(input, result);
    const base = Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== "commercialTerminalDigest"),
    );
    const known =
      result !== "unknown"
        ? {
            commercialAttemptObservationDigest:
              observation(input).observationDigest,
            normalizedUsageDigest: observation(input).normalizedUsageDigest,
          }
        : {};
    return modelLiveSequenceOutcomeV4Schema.parse(
      rehash(
        {
          ...base,
          ...known,
          contractVersion: 4,
          parentSequenceContractVersion: 3,
          dispatchDigest: dispatch(input).dispatchDigest,
        },
        "outcomeDigest",
      ),
    );
  };
  const unused = (index: number, reason: Parameters<typeof legacy.unused>[1]) =>
    modelLiveSequenceOutcomeV4Schema.parse(
      rehash(
        {
          ...legacy.unused(index, reason),
          contractVersion: 4,
          parentSequenceContractVersion: 3,
        },
        "outcomeDigest",
      ),
    );
  const first = legacy.prepare(0);
  const third = legacy.prepare(2);
  const thirdOutcome = outcome(third, "repairable");
  const fourth = legacy.prepare(3, thirdOutcome);
  const full = {
    ...legacy.empty,
    inputs: [first, third, fourth],
    dispatches: [first, third, fourth].map(dispatch),
    observations: [first, third, fourth].map(observation),
    outcomes: [
      outcome(first, "valid"),
      unused(1, "predecessor-valid"),
      thirdOutcome,
      outcome(fourth, "repairable"),
    ],
  };
  return {
    legacy,
    first,
    third,
    fourth,
    full,
    dispatch,
    observation,
    outcome,
    unused,
  };
}
type Full = ReturnType<typeof fixture>["full"];
function updateDispatch(input: Full, index: number) {
  const sent = modelLiveSequenceDispatchV4Schema.parse(
    rehash(present(input.dispatches[index]), "dispatchDigest"),
  );
  input.dispatches[index] = sent;
  const observed = present(input.observations[index]);
  input.observations[index] = modelLiveSequenceAttemptObservationV4Schema.parse(
    rehash(
      {
        ...observed,
        dispatchDigest: sent.dispatchDigest,
        canonicalWorkflowFingerprint: sent.canonicalWorkflowFingerprint,
      },
      "observationDigest",
    ),
  );
  const observedNow = present(input.observations[index]);
  const oi = input.outcomes.findIndex((o) => o.stageId === sent.stageId);
  const outcome = present(input.outcomes[oi]);
  input.outcomes[oi] = modelLiveSequenceOutcomeV4Schema.parse(
    rehash(
      {
        ...outcome,
        dispatchDigest: sent.dispatchDigest,
        commercialAttemptObservationDigest: observedNow.observationDigest,
      },
      "outcomeDigest",
    ),
  );
}
describe("V4 stage observations over unchanged V3 sequence parents", () => {
  it("closes valid and exhausted lineage without claiming financial completion", () => {
    const f = fixture();
    expect(inspectModelLiveSequenceAttemptsV4(f.full)).toEqual({
      cases: [
        { caseId: f.first.caseId, state: "validated" },
        { caseId: f.third.caseId, state: "exhausted" },
      ],
      lineageComplete: true,
      held: false,
    });
    expect(inspectModelLiveSequenceAttemptsV4(f.full)).not.toHaveProperty(
      "complete",
    );
    expect(inspectModelLiveSequenceV3(f.legacy.empty).complete).toBe(false);
  });
  it("makes the exact second input eligible after observed repairable failure while settlement is still absent", () => {
    const f = fixture();
    const failure = f.outcome(f.first, "repairable");
    const input = {
      ...f.legacy.empty,
      inputs: [f.first],
      dispatches: [f.dispatch(f.first)],
      observations: [f.observation(f.first)],
      outcomes: [failure],
    };
    expect(inspectModelLiveSequenceAttemptsV4(input).cases[0]).toMatchObject({
      state: "requires-input",
      stageId: f.legacy.selection.stages[1]?.stageId,
    });
    const second = f.legacy.prepare(1, failure);
    expect(
      inspectModelLiveSequenceAttemptsV4({
        ...input,
        inputs: [f.first, second],
      }).cases[0],
    ).toMatchObject({
      state: "requires-dispatch-admission",
      stageId: second.stageId,
    });
  });
  it("retains unknown dispatch and closes its unused successor without fabricated usage", () => {
    const f = fixture();
    const unknown = f.outcome(f.first, "unknown");
    const input = {
      ...f.legacy.empty,
      inputs: [f.first],
      dispatches: [f.dispatch(f.first)],
      observations: [],
      outcomes: [unknown, f.unused(1, "predecessor-unknown")],
    };
    expect(inspectModelLiveSequenceAttemptsV4(input)).toMatchObject({
      held: true,
      lineageComplete: false,
      cases: [
        expect.objectContaining({ state: "held-unknown" }),
        expect.anything(),
      ],
    });
    for (const key of [
      "normalizedUsageDigest",
      "commercialAttemptObservationDigest",
      "commercialTerminalDigest",
    ])
      expect(
        modelLiveSequenceOutcomeV4Schema.safeParse(
          rehash({ ...unknown, [key]: d("pretend-zero") }, "outcomeDigest"),
        ).success,
      ).toBe(false);
    expect(() =>
      inspectModelLiveSequenceAttemptsV4({
        ...input,
        inputs: [
          f.first,
          f.legacy.prepare(1, f.outcome(f.first, "repairable")),
        ],
      }),
    ).toThrow();
  });
  const denied: readonly [string, (input: Full) => void][] = [
    [
      "missing observed usage",
      (f) => {
        f.observations.shift();
      },
    ],
    [
      "observation without dispatch",
      (f) => {
        f.dispatches.shift();
      },
    ],
    [
      "duplicate observed stage",
      (f) => {
        f.observations.push(structuredClone(present(f.observations[0])));
      },
    ],
    [
      "wrong observation selection",
      (f) => {
        f.observations[0] = rehash(
          {
            ...present(f.observations[0]),
            selectionDigest: d("foreign-selection"),
          },
          "observationDigest",
        );
      },
    ],
    [
      "wrong canonical workflow",
      (f) => {
        f.observations[0] = rehash(
          {
            ...present(f.observations[0]),
            canonicalWorkflowFingerprint: d("foreign-workflow"),
          },
          "observationDigest",
        );
      },
    ],
    [
      "wrong usage outcome",
      (f) => {
        f.outcomes[0] = modelLiveSequenceOutcomeV4Schema.parse(
          rehash(
            {
              ...present(f.outcomes[0]),
              normalizedUsageDigest: d("other-usage"),
            },
            "outcomeDigest",
          ),
        );
      },
    ],
    [
      "future observation",
      (f) => {
        f.observations[0] = modelLiveSequenceAttemptObservationV4Schema.parse(
          rehash(
            {
              ...present(f.observations[0]),
              observedAt: new Date(Date.parse(f.observedAt) + 1).toISOString(),
            },
            "observationDigest",
          ),
        );
      },
    ],
    [
      "second unrelated reservation",
      (f) => {
        present(f.dispatches[2]).canonicalWorkflowFingerprint = d(
          "second-unrelated-workflow",
        );
        updateDispatch(f, 2);
      },
    ],
    [
      "second unrelated dispatch intent",
      (f) => {
        present(f.dispatches[2]).canonicalDispatchIntentDigest = d(
          "second-unrelated-intent",
        );
        updateDispatch(f, 2);
      },
    ],
    [
      "reused physical spending reservation",
      (f) => {
        present(f.dispatches[2]).platformReservationDigest = present(
          f.dispatches[1],
        ).platformReservationDigest;
        updateDispatch(f, 2);
      },
    ],
    [
      "workflow reused across cases",
      (f) => {
        present(f.dispatches[0]).canonicalWorkflowFingerprint = present(
          f.dispatches[1],
        ).canonicalWorkflowFingerprint;
        updateDispatch(f, 0);
      },
    ],
  ];
  it.each(denied)("rejects %s", (_name, change) => {
    const f = fixture();
    change(f.full);
    expect(() => inspectModelLiveSequenceAttemptsV4(f.full)).toThrow();
  });

  it.each(["canonicalAttemptDigest", "normalizedUsageDigest"] as const)(
    "rejects reusing an observed %s across exact joined outcomes",
    (key) => {
      const f = fixture();
      f.full.observations[0] =
        modelLiveSequenceAttemptObservationV4Schema.parse(
          rehash(
            {
              ...present(f.full.observations[0]),
              [key]: present(f.full.observations[1])[key],
            },
            "observationDigest",
          ),
        );
      const observation = present(f.full.observations[0]);
      f.full.outcomes[0] = modelLiveSequenceOutcomeV4Schema.parse(
        rehash(
          {
            ...present(f.full.outcomes[0]),
            commercialAttemptObservationDigest: observation.observationDigest,
            normalizedUsageDigest: observation.normalizedUsageDigest,
          },
          "outcomeDigest",
        ),
      );
      expect(() => inspectModelLiveSequenceAttemptsV4(f.full)).toThrow();
    },
  );

  it("rejects future-attempt/terminal fields, wrong ordinals and mixed versions while retaining historical readers", () => {
    const f = fixture();
    const sent = f.dispatch(f.first);
    const known = f.outcome(f.first, "valid");
    const historical = f.legacy.dispatch(f.first);
    expect(modelLiveSequenceDispatchV3Schema.parse(historical)).toEqual(
      historical,
    );
    expect(
      modelLiveSequenceOutcomeV3Schema.parse(f.legacy.outcome(f.first, "valid"))
        .contractVersion,
    ).toBe(3);
    for (const record of [
      rehash(
        { ...sent, canonicalAttemptDigest: d("future-completed-attempt") },
        "dispatchDigest",
      ),
      rehash({ ...sent, canonicalAttemptOrdinal: 2 }, "dispatchDigest"),
      rehash({ ...sent, parentSequenceContractVersion: 4 }, "dispatchDigest"),
      rehash(
        { ...known, commercialTerminalDigest: d("premature-terminal") },
        "outcomeDigest",
      ),
      historical,
      f.legacy.outcome(f.first, "valid"),
    ])
      expect(
        modelLiveSequenceAttemptRecordV4Schema.safeParse(record).success,
      ).toBe(false);
    expect(modelLiveSequenceDispatchV3Schema.safeParse(sent).success).toBe(
      false,
    );
    expect(modelLiveSequenceOutcomeV3Schema.safeParse(known).success).toBe(
      false,
    );
    expect(() => inspectModelLiveSequenceV3(f.full)).toThrow();
    expect(() =>
      inspectModelLiveSequenceAttemptsV4({
        ...f.full,
        dispatches: [historical, ...f.full.dispatches.slice(1)],
      }),
    ).toThrow();
  });
});
