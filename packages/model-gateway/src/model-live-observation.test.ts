import { describe, expect, it } from "vitest";
import {
  modelEvaluationObservationV1Schema,
  modelEvaluationOperationalBudgetsV1,
  modelLiveEvaluationObservationV2Schema,
} from "./model-evaluation.js";
import { digestStructuredValue } from "./security.js";

// Synthetic schema checks only. These objects have no issuer, journal, ledger,
// provider execution, report or model-promotion authority.
function fixture() {
  const digest = digestStructuredValue("synthetic observation schema check");
  const operationalUsage = {
    commercialSourceAuthority: "canonical-commercial-v1" as const,
    usageSourceAuthority: "canonical-model-usage-v1" as const,
    creditUnits: 120,
    estimatedMicroUsd: 25_000,
    inputTokens: 9_000,
    outputTokens: 2_000,
    totalTokens: 11_000,
    latencyMilliseconds: 8_000,
  };
  return {
    adapterId: "cloudmarkup.synthetic-observation-schema",
    adapterVersion: "2.0.0",
    contractVersion: 2,
    executionMode: "live",
    caseId: "case.synthetic",
    caseDigest: digest,
    outputDigest: digest,
    assistancePreferenceSemantics: ["guided", "professional"].map(
      (assistancePreference) => ({
        assistancePreference,
        semanticDigest: digest,
      }),
    ),
    measurements: [
      {
        dimension: "same-ui-semantics-across-assistance-preferences",
        numerator: 1,
        denominator: 1,
        sourceAuthority: "deterministic-evaluation-v1",
        evidenceDigests: [digest],
      },
      ...(
        [
          ["credits", operationalUsage.creditUnits, "canonical-commercial-v1"],
          [
            "estimated-cost",
            operationalUsage.estimatedMicroUsd,
            "canonical-commercial-v1",
          ],
          ["tokens", operationalUsage.totalTokens, "canonical-model-usage-v1"],
          [
            "latency",
            operationalUsage.latencyMilliseconds,
            "canonical-model-usage-v1",
          ],
        ] as const
      ).map(([dimension, numerator, sourceAuthority]) => ({
        dimension,
        numerator,
        sourceAuthority,
        denominator: modelEvaluationOperationalBudgetsV1[dimension],
        evidenceDigests: [digest],
      })),
    ],
    operationalUsage,
    safeErrorCodes: [],
    noRawPromptResponseRepositoryOrCandidateContent: true,
  };
}
describe("live V2 observation metadata", () => {
  it("retains actual budget overruns without widening the V1 format or changing thresholds", () => {
    const value = fixture();
    const parsed = modelLiveEvaluationObservationV2Schema.parse(value);
    expect(parsed.operationalUsage).toEqual(value.operationalUsage);
    expect(
      parsed.measurements
        .slice(1)
        .every(
          (measurement) => measurement.numerator > measurement.denominator,
        ),
    ).toBe(true);
    expect(modelEvaluationObservationV1Schema.safeParse(value).success).toBe(
      false,
    );
    expect(
      modelEvaluationObservationV1Schema.safeParse({
        ...value,
        contractVersion: 1,
      }).success,
    ).toBe(false);
  });
  it.each([
    "changed-budget",
    "underreported-usage",
    "invented-authority",
    "missing-evidence",
    "nonoperational-overflow",
    "different-semantics",
    "duplicate-measurement",
    "unbounded-usage",
  ])("rejects %s metadata", (mutation) => {
    const value = fixture();
    const cost = value.measurements.find(
      (measurement) => measurement.dimension === "credits",
    );
    const semantic = value.measurements[0];
    const professional = value.assistancePreferenceSemantics[1];
    if (!cost || !semantic || !professional)
      throw Error("Missing synthetic schema fixture.");
    switch (mutation) {
      case "changed-budget":
        cost.denominator = 200;
        break;
      case "underreported-usage":
        cost.numerator = 1;
        break;
      case "invented-authority":
        cost.sourceAuthority = "synthetic-fake-v1";
        break;
      case "missing-evidence":
        cost.evidenceDigests = [];
        break;
      case "nonoperational-overflow":
        semantic.numerator = 2;
        break;
      case "different-semantics":
        professional.semanticDigest = digestStructuredValue(
          "different synthetic semantics",
        );
        break;
      case "duplicate-measurement":
        value.measurements.push(cost);
        break;
      case "unbounded-usage":
        value.operationalUsage.creditUnits = 1_000_000_001;
        cost.numerator = value.operationalUsage.creditUnits;
        break;
    }
    expect(
      modelLiveEvaluationObservationV2Schema.safeParse(value).success,
    ).toBe(false);
  });
});
