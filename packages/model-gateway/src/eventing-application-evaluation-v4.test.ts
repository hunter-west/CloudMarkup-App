import { describe, expect, it } from "vitest";

import {
  eventingApplicationEvaluationFindingCodesV4,
  frozenEventingApplicationEvaluationDatasetV4,
  runFrozenEventingApplicationEvaluationV4,
} from "./eventing-application-evaluation-v4.js";

describe("frozen eventing application evaluation v4", () => {
  it("covers all six generated application patterns and requested invalid cases", () => {
    const dataset = frozenEventingApplicationEvaluationDatasetV4;
    const report = runFrozenEventingApplicationEvaluationV4();

    expect(dataset.cases).toHaveLength(12);
    expect(
      dataset.cases.filter(({ expected }) => expected.accepted),
    ).toHaveLength(6);
    expect(
      report.results
        .flatMap(({ findingCode }) =>
          findingCode === undefined ? [] : [findingCode],
        )
        .sort(),
    ).toEqual(
      Object.values(eventingApplicationEvaluationFindingCodesV4).sort(),
    );
    expect(report).toMatchObject({
      datasetDigest: dataset.datasetDigest,
      executionMode: "deterministic",
      deterministicPassed: true,
    });
  });

  it("keeps deterministic source generation outside model authority", () => {
    const serialized = JSON.stringify(
      frozenEventingApplicationEvaluationDatasetV4,
    );

    expect(serialized).toContain("workload-and-event-contracts");
    expect(serialized).toContain("explicit");
    expect(serialized).not.toContain("exports.handler");
    expect(serialized).not.toContain("async function handler");
    expect(serialized).not.toContain("AWS_ACCESS_KEY_ID");
  });
});
