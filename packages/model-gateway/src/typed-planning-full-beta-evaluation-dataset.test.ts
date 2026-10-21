import {
  digestCanonicalValue,
  modelEvaluationDatasetV1Schema,
} from "@cloudmarkup/schemas";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  fullBetaEvaluationCatalogV1 as catalog,
  frozenTypedPlanningFullBetaEvaluationDatasetV1 as current,
  fullBetaModelEvaluationPolicyV2,
  frozenFullBetaEvaluationDatasetV1 as historical,
  frozenAuthenticatedFullBetaEvaluationDatasetV1 as previous,
  typedPlanningFullBetaEvaluationSourceDigestV1 as sourceDigest,
} from "./index.js";

it("preserves case dataset versions and the evaluation policy", () => {
  expect(historical.datasetVersion).toBe("1.5.0");
  expect(previous.datasetVersion).toBe("1.6.0");
  expect(fullBetaModelEvaluationPolicyV2.evaluationPolicyDigest).toBe(
    "sha256:d1e2fdd91f64626630efc49f9bc562d06f80395eaee4fb2699d083ab55b257a6",
  );
});

it("changes exactly the two planning authorities while preserving every product and score requirement", () => {
  expect(current.datasetVersion).toBe("1.7.0");
  expect(current.datasetDigest).not.toBe(previous.datasetDigest);
  expect(current.cases).toHaveLength(21);
  const changed: string[] = [];
  for (const before of previous.cases) {
    const after = current.cases.find((c) => c.caseId === before.caseId);
    if (!after) throw Error("Missing predecessor case");
    if (
      !["simple-serverless-api", "authenticated-notes-application"].includes(
        before.caseKind,
      )
    ) {
      expect(after).toEqual(before);
      continue;
    }
    changed.push(before.caseKind);
    expect(after.expected.authorityRequirement).toEqual({
      ...before.expected.authorityRequirement,
      operation: "operations.propose",
    });
    expect(after.expected.authorityRequirementDigest).not.toBe(
      before.expected.authorityRequirementDigest,
    );
    expect(after.caseDigest).not.toBe(before.caseDigest);
    expect({
      ...after,
      caseDigest: before.caseDigest,
      expected: {
        ...after.expected,
        authorityRequirement: before.expected.authorityRequirement,
        authorityRequirementDigest: before.expected.authorityRequirementDigest,
      },
    }).toEqual(before);
  }
  expect(changed).toEqual([
    "simple-serverless-api",
    "authenticated-notes-application",
  ]);
  expect({
    ...current,
    cases: previous.cases,
    datasetVersion: previous.datasetVersion,
    datasetDigest: previous.datasetDigest,
  }).toEqual(previous);
});

it("retains a strict immutable dataset and exact independently named mirror", () => {
  expect(modelEvaluationDatasetV1Schema.parse(current)).toEqual(current);
  for (const c of current.cases) {
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.expected.authorityRequirement)).toBe(true);
    expect(Object.isFrozen(c.input)).toBe(true);
  }
  const expected = { sourceDigest, catalog, dataset: current };
  expect(sourceDigest).toBe(
    digestCanonicalValue({ catalog, dataset: current }),
  );
  expect(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../evals/datasets-full-beta-v1/typed-planning-full-beta-evaluation-source-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
  ).toEqual(expected);
});
