import {
  digestCanonicalValue,
  digestModelEvaluationAuthorityRequirementV1,
  digestModelEvaluationCaseV1,
  digestModelEvaluationDatasetV1,
  modelEvaluationCaseV1Schema,
  modelEvaluationDatasetV1Schema,
  semanticVersionSchema,
} from "@cloudmarkup/schemas";
import { frozenAuthenticatedFullBetaEvaluationDatasetV1 } from "./authenticated-full-beta-evaluation-dataset.js";
import { fullBetaEvaluationCatalogV1 } from "./full-beta-evaluation-dataset.js";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const { datasetDigest: previousDigest, ...previous } =
  frozenAuthenticatedFullBetaEvaluationDatasetV1;
if (digestModelEvaluationDatasetV1(previous) !== previousDigest)
  throw Error("The authenticated predecessor evaluation dataset is invalid.");

const body = {
  ...previous,
  datasetVersion: semanticVersionSchema.parse("1.7.0"),
  cases: previous.cases.map((source) => {
    if (
      source.caseKind !== "simple-serverless-api" &&
      source.caseKind !== "authenticated-notes-application"
    )
      return source;
    const { caseDigest: previousCaseDigest, ...previousCase } = source;
    if (digestModelEvaluationCaseV1(previousCase) !== previousCaseDigest)
      throw Error("The predecessor evaluation case is invalid.");
    const authorityRequirement = {
      ...previousCase.expected.authorityRequirement,
      operation: "operations.propose" as const,
    };
    const successor = {
      ...previousCase,
      expected: {
        ...previousCase.expected,
        authorityRequirement,
        authorityRequirementDigest:
          digestModelEvaluationAuthorityRequirementV1(authorityRequirement),
      },
    };
    return modelEvaluationCaseV1Schema.parse({
      ...successor,
      caseDigest: digestModelEvaluationCaseV1(successor),
    });
  }),
};

/** Separately governed typed-command evaluation source. It changes no current
 * policy or historical result and grants no execution, report or promotion authority. */
export const frozenTypedPlanningFullBetaEvaluationDatasetV1 = freeze(
  modelEvaluationDatasetV1Schema.parse({
    ...body,
    datasetDigest: digestModelEvaluationDatasetV1(body),
  }),
);
export const typedPlanningFullBetaEvaluationSourceDigestV1 =
  digestCanonicalValue({
    dataset: frozenTypedPlanningFullBetaEvaluationDatasetV1,
    catalog: fullBetaEvaluationCatalogV1,
  });
