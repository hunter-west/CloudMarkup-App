import {
  digestCanonicalValue,
  modelEvaluationDatasetV1Schema,
} from "@cloudmarkup/schemas";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  authenticatedFullBetaEvaluationSourceDigestV1,
  frozenAuthenticatedFullBetaEvaluationDatasetV1,
  frozenFullBetaEvaluationDatasetV1,
  fullBetaEvaluationCatalogV1,
  fullBetaModelEvaluationPolicyV2,
} from "./index.js";

it("binds current catalog metadata while keeping case definitions and report policy unchanged", () => {
  const bytes = readFileSync(
    new URL(
      "../../../evals/datasets-full-beta-v1/full-beta-evaluation-source-v1.json",
      import.meta.url,
    ),
  );
  const archived = JSON.parse(bytes.toString("utf8")) as {
    dataset: unknown;
    catalog: unknown;
  };
  expect(modelEvaluationDatasetV1Schema.parse(archived.dataset)).toEqual(
    frozenFullBetaEvaluationDatasetV1,
  );
  expect(archived.catalog).toEqual(fullBetaEvaluationCatalogV1);
  expect(frozenFullBetaEvaluationDatasetV1.datasetVersion).toBe("1.5.0");
  expect(fullBetaModelEvaluationPolicyV2.evaluationPolicyDigest).toBe(
    "sha256:d1e2fdd91f64626630efc49f9bc562d06f80395eaee4fb2699d083ab55b257a6",
  );
});

it("changes only the basic API authentication input and its versioned commitments", () => {
  const previous = frozenFullBetaEvaluationDatasetV1;
  const current = frozenAuthenticatedFullBetaEvaluationDatasetV1;
  expect(current.datasetVersion).toBe("1.6.0");
  expect(current.datasetDigest).not.toBe(previous.datasetDigest);
  expect(current.cases).toHaveLength(21);
  let changedCases = 0;
  for (const before of previous.cases) {
    const after = current.cases.find((entry) => entry.caseId === before.caseId);
    if (!after) throw Error("Historical case missing");
    if (before.caseKind !== "simple-serverless-api") {
      expect(after).toEqual(before);
      continue;
    }
    changedCases += 1;
    expect(before.input.requirements).toContain("no authentication");
    expect(after.input.requirements).toContain(
      "Require JWT authorization on every route",
    );
    expect(after.input.requirements).toContain(
      "missing, invalid, or expired tokens",
    );
    expect(after.caseDigest).not.toBe(before.caseDigest);
    expect({
      ...after,
      caseDigest: before.caseDigest,
      input: { ...after.input, requirements: before.input.requirements },
    }).toEqual(before);
  }
  expect(changedCases).toBe(1);
  expect({
    ...current,
    datasetVersion: previous.datasetVersion,
    datasetDigest: previous.datasetDigest,
    cases: previous.cases,
  }).toEqual(previous);
  expect(Object.isFrozen(current.cases[0]?.input)).toBe(true);
});

it("matches the separately named authenticated source mirror", () => {
  const expected = {
    sourceDigest: authenticatedFullBetaEvaluationSourceDigestV1,
    catalog: fullBetaEvaluationCatalogV1,
    dataset: frozenAuthenticatedFullBetaEvaluationDatasetV1,
  };
  expect(authenticatedFullBetaEvaluationSourceDigestV1).toBe(
    digestCanonicalValue({
      catalog: expected.catalog,
      dataset: expected.dataset,
    }),
  );
  expect(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../evals/datasets-full-beta-v1/authenticated-full-beta-evaluation-source-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  ).toEqual(expected);
});
