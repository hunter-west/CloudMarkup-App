import {
  digestCanonicalValue,
  digestModelEvaluationCaseV1,
  digestModelEvaluationDatasetV1,
  modelEvaluationCaseV1Schema,
  modelEvaluationDatasetV1Schema,
  semanticVersionSchema,
} from "@cloudmarkup/schemas";
import {
  frozenFullBetaEvaluationDatasetV1,
  fullBetaEvaluationCatalogV1,
} from "./full-beta-evaluation-dataset.js";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const { datasetDigest: previousDigest, ...previous } =
  frozenFullBetaEvaluationDatasetV1;
if (digestModelEvaluationDatasetV1(previous) !== previousDigest)
  throw Error("The historical evaluation dataset is invalid.");

const body = {
  ...previous,
  datasetVersion: semanticVersionSchema.parse("1.6.0"),
  cases: previous.cases.map((source) => {
    if (source.caseKind !== "simple-serverless-api") return source;
    const { caseDigest: previousCaseDigest, ...previousCase } = source;
    if (digestModelEvaluationCaseV1(previousCase) !== previousCaseDigest)
      throw Error("The historical evaluation case is invalid.");
    const successor = {
      ...previousCase,
      input: {
        ...previousCase.input,
        requirements:
          "Propose a minimal serverless HTTP API with no persistent application data. Require JWT authorization on every route through a managed authorizer; reject missing, invalid, or expired tokens. Keep the architecture small and cost efficient.",
      },
    };
    return modelEvaluationCaseV1Schema.parse({
      ...successor,
      caseDigest: digestModelEvaluationCaseV1(successor),
    });
  }),
};

/** Frozen input successor only. Historical policies keep their original source
 * binding; this export grants no report, invocation or promotion authority. */
export const frozenAuthenticatedFullBetaEvaluationDatasetV1 = freeze(
  modelEvaluationDatasetV1Schema.parse({
    ...body,
    datasetDigest: digestModelEvaluationDatasetV1(body),
  }),
);
export const authenticatedFullBetaEvaluationSourceDigestV1 =
  digestCanonicalValue({
    dataset: frozenAuthenticatedFullBetaEvaluationDatasetV1,
    catalog: fullBetaEvaluationCatalogV1,
  });
