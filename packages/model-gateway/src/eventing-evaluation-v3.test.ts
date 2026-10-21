import { describe, expect, it } from "vitest";

import {
  eventingEvaluationFindingCodesV3,
  frozenEventingEvaluationDatasetV3,
  runFrozenEventingEvaluationV3,
} from "./eventing-evaluation-v3.js";

describe("frozen eventing evaluation v3", () => {
  it("covers four valid templates and all six requested invalid cases", () => {
    const dataset = frozenEventingEvaluationDatasetV3;
    const report = runFrozenEventingEvaluationV3();

    expect(dataset.cases).toHaveLength(10);
    expect(
      dataset.cases.filter(({ expected }) => expected.accepted),
    ).toHaveLength(4);
    expect(
      report.results
        .flatMap(({ findingCode }) =>
          findingCode === undefined ? [] : [findingCode],
        )
        .sort(),
    ).toEqual(Object.values(eventingEvaluationFindingCodesV3).sort());
    expect(report).toMatchObject({
      datasetDigest: dataset.datasetDigest,
      executionMode: "deterministic",
      deterministicPassed: true,
    });
    expect(report.results.every(({ passed }) => passed)).toBe(true);
  });

  it("keeps handler source outside the Prompt 45 dataset", () => {
    const serialized = JSON.stringify(frozenEventingEvaluationDatasetV3);

    expect(serialized).toContain("Prompt 45A");
    expect(serialized).not.toContain("exports.handler");
    expect(serialized).not.toContain("async function handler");
  });
});
