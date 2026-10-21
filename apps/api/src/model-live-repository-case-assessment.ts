import { requireModelLiveRepositoryImporter } from "./model-live-repository-parser-authority.js";
import { z } from "zod";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
  inspectModelValueForSecretCandidatesV1,
  modelEvaluationMeasurementV1Schema,
  modelLiveIntentCaseAssessmentV2Schema,
  validateModelRequestAuthority,
  validateModelResponseAuthority,
  type ModelEvaluationMeasurementV1,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  modelRepositoryInterpretationRequestV1Schema,
  modelRepositoryInterpretationResponseV1Schema,
  projectRepositoryInterpretationReviewV1,
} from "@cloudmarkup/schemas";
import { prepareModelLiveRepositoryInput } from "./model-live-repository-input.js";
import { createProductionModelLiveRepositoryRequest } from "./production-model-live-repository-request.js";
import type { PinnedCompilerConfiguration } from "./adapters/pinned-go-executable.js";

const familyIds = {
  evaluation_case_deterministic_repository_import_full_beta_v1:
    "deterministic-repository-import",
  evaluation_case_ambiguous_source_code_inference_full_beta_v1:
    "ambiguous-source-code-inference",
  evaluation_case_designed_observed_mismatch_full_beta_v1:
    "designed-observed-mismatch",
} as const;
const common = [
  "structured-schema-validity",
  "security-policy-violations",
  "grounded-repository-evidence-rate",
  "stable-id-user-owned-file-preservation",
  "issue-clarity-correct-severity",
  "same-ui-semantics-across-assistance-preferences",
] as const;
function dimensions(
  caseId: string,
): readonly ModelEvaluationMeasurementV1["dimension"][] {
  if (!Object.hasOwn(familyIds, caseId)) return [];
  return [
    ...common,
    ...(caseId ===
    "evaluation_case_ambiguous_source_code_inference_full_beta_v1"
      ? ["unresolved-behavior-honesty" as const]
      : ["graph-workload-external-rule-violations" as const]),
    ...(caseId ===
    "evaluation_case_deterministic_repository_import_full_beta_v1"
      ? ["deterministic-compiler-preference" as const]
      : []),
  ];
}
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);
const exact = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  a.every((v) => b.includes(v));
function requireAssessment(value: boolean): asserts value {
  if (!value)
    throw Error("The exact repository case assessment is unavailable.");
}
/** Shape-only historical metadata. SQL and issued-plan readers provide authority. */
export const modelLiveRepositoryCaseAssessmentV2Schema = z
  .object({
    ...modelLiveIntentCaseAssessmentV2Schema.shape,
    recordKind: z.literal("model-live-repository-case-assessment"),
    validatorId: z.literal("cloudmarkup.live-repository-case-validator.v2"),
    validatorVersion: z.literal("2.6.0"),
    measurements: z.array(modelEvaluationMeasurementV1Schema).min(7).max(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { assessmentDigest, ...body } = value;
    const ds = [
      ...new Set(
        value.assistancePreferenceSemantics.map((s) => s.semanticDigest),
      ),
    ];
    const parity = value.measurements.find(
      (m) => m.dimension === "same-ui-semantics-across-assistance-preferences",
    );
    if (
      assessmentDigest !== digestStructuredValue(body) ||
      !exact(
        value.measurements.map((m) => m.dimension),
        dimensions(value.caseId),
      ) ||
      value.measurements.some(
        (m) =>
          m.sourceAuthority !== "deterministic-evaluation-v1" ||
          m.evidenceDigests.length === 0 ||
          (m.dimension !== "graph-workload-external-rule-violations" &&
            m.denominator !== 1) ||
          (m.dimension === "structured-schema-validity" && m.numerator !== 1),
      ) ||
      !exact(
        value.assistancePreferenceSemantics.map((s) => s.assistancePreference),
        ["guided", "professional"],
      ) ||
      parity?.numerator !== (ds.length === 1 ? 1 : 0) ||
      !exact(parity.evidenceDigests, ds)
    )
      ctx.addIssue({
        code: "custom",
        message: "Repository assessment metadata is contradictory.",
      });
  });

/** Executes actual frozen file parsing and the same read-only review used by the UI.
 * Citation coverage measures exact source linkage, never the truth of free text.
 * Existing parser warnings are retained and can fail frozen quality expectations. */
export async function assessModelLiveRepositoryCaseV2(input: {
  readonly evaluationCase: unknown;
  readonly request: unknown;
  readonly descriptor: unknown;
  readonly response: unknown;
  readonly outputDigest: string;
  readonly compiler: PinnedCompilerConfiguration;
}) {
  requireModelLiveRepositoryImporter("1.0.1");
  const request = modelRepositoryInterpretationRequestV1Schema.parse(
    input.request,
  );
  const response = modelRepositoryInterpretationResponseV1Schema.parse(
    input.response,
  );
  const descriptor = modelInvocationDescriptorV1Schema.parse(input.descriptor);
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find((c) =>
    same(c, input.evaluationCase),
  );
  requireAssessment(
    evaluationCase !== undefined &&
      Object.hasOwn(familyIds, evaluationCase.caseId),
  );
  const caseKind = familyIds[evaluationCase.caseId as keyof typeof familyIds];
  requireAssessment(
    same(
      request,
      createProductionModelLiveRepositoryRequest({
        caseId: evaluationCase.caseId,
        requestedMode: request.requestedMode,
      }),
    ) &&
      descriptor.feature === request.operation &&
      descriptor.role === "standard-planning-generation" &&
      descriptor.requestedMode === request.requestedMode &&
      descriptor.scope.repositorySnapshotId === request.repositorySnapshotId &&
      descriptor.inputDigest ===
        digestStructuredValue({ request, scope: descriptor.scope }) &&
      input.outputDigest === digestStructuredValue(response) &&
      exact(
        evaluationCase.targetDimensions.filter(
          (d) =>
            !["tokens", "credits", "estimated-cost", "latency"].includes(d),
        ),
        dimensions(evaluationCase.caseId),
      ),
  );
  validateModelRequestAuthority(request);
  validateModelResponseAuthority({
    request,
    response,
    descriptor,
    allowedApprovalPathIds: new Set(),
  });
  requireAssessment(
    inspectModelValueForSecretCandidatesV1(response).detectedValueCount === 0,
  );
  const imported = await prepareModelLiveRepositoryInput({
    caseKind,
    compiler: input.compiler,
  });
  const before = digestStructuredValue(imported.design);
  const reviews = (["guided", "professional"] as const).map(
    (requestedMode) => ({
      requestedMode,
      review: projectRepositoryInterpretationReviewV1({
        request,
        response,
        requestedMode,
        snapshot: imported.result.snapshot,
        observedSolution: imported.result.observedSolution,
      }),
    }),
  );
  const review = reviews[0];
  requireAssessment(review !== undefined);
  const result = imported.result;
  const preserved =
    before === digestStructuredValue(imported.design) &&
    same(review.review.semantic.observations, result.observedSolution) &&
    imported.design.manifest.repositoryObservations.length === 0;
  const cited = new Set<string>(
    review.review.semantic.claims.flatMap((c) =>
      c.citations.flatMap((r) =>
        r.source === null ? [] : [r.source.evidenceId],
      ),
    ),
  );
  const grounded = evaluationCase.expected.requiredEvidenceIds.every((id) =>
    cited.has(id),
  );
  const hasQuestions = response.proposalContext.unknowns.some(
    (q) => q.blocking && q.question.trim().length > 0,
  );
  const errors = result.differences.filter((d) => d.severity === "error");
  const severities = [
    ...result.differences.map((d) => d.severity),
    ...result.snapshot.parseFindings.map((f) => f.severity),
  ];
  const actualSeverity = severities.includes("error")
    ? "error"
    : severities.includes("warning") || hasQuestions
      ? "warning"
      : "none";
  const clear =
    actualSeverity === evaluationCase.expected.expectedIssueSeverity &&
    grounded &&
    ((evaluationCase.expected.disposition !== "request-clarification" &&
      evaluationCase.expected.disposition !== "retain-unresolved") ||
      hasQuestions);
  const outputDigest = digestStructuredValue(response),
    projectionDigest = digestStructuredValue(review.review.semantic);
  const semantics = reviews.map(({ requestedMode, review }) => ({
    assistancePreference: requestedMode,
    semanticDigest: digestStructuredValue(review.semantic),
  }));
  const ds = [...new Set(semantics.map((s) => s.semanticDigest))];
  const measure = (
    dimension: ModelEvaluationMeasurementV1["dimension"],
    numerator: number,
    denominator: number,
    evidenceDigests: readonly string[],
  ) =>
    modelEvaluationMeasurementV1Schema.parse({
      dimension,
      numerator,
      denominator,
      evidenceDigests,
      sourceAuthority: "deterministic-evaluation-v1",
    });
  const measurements = [
    measure("structured-schema-validity", 1, 1, [outputDigest]),
    measure("security-policy-violations", 0, 1, [outputDigest]),
    measure("grounded-repository-evidence-rate", grounded ? 1 : 0, 1, [
      outputDigest,
      result.snapshot.snapshotDigest,
    ]),
    measure("stable-id-user-owned-file-preservation", preserved ? 1 : 0, 1, [
      before,
      result.snapshot.snapshotDigest,
    ]),
    measure("issue-clarity-correct-severity", clear ? 1 : 0, 1, [
      result.resultDigest,
      projectionDigest,
    ]),
    measure(
      "same-ui-semantics-across-assistance-preferences",
      ds.length === 1 ? 1 : 0,
      1,
      ds,
    ),
  ];
  if (caseKind === "ambiguous-source-code-inference")
    measurements.push(
      measure(
        "unresolved-behavior-honesty",
        hasQuestions &&
          response.proposalContext.assumptions.length === 0 &&
          response.claims.every((c) => c.confidence.basisPoints < 10000) &&
          result.facts.length === 0 &&
          result.observedSolution.resources.length === 0 &&
          preserved
          ? 1
          : 0,
        1,
        [projectionDigest, result.resultDigest],
      ),
    );
  else
    measurements.push(
      measure(
        "graph-workload-external-rule-violations",
        errors.length,
        Math.max(1, result.differences.length),
        [result.resultDigest],
      ),
    );
  if (caseKind === "deterministic-repository-import")
    measurements.push(
      measure(
        "deterministic-compiler-preference",
        result.facts.some(
          (f) =>
            f.kind === "resource" &&
            f.resourceType === "aws.dynamodb.table" &&
            f.parser.id === "cloudmarkup.terraform-hcl-inspector" &&
            f.parser.version === "1.0.1",
        )
          ? 1
          : 0,
        1,
        [result.resultDigest],
      ),
    );
  const body = {
    contractVersion: 2 as const,
    recordKind: "model-live-repository-case-assessment" as const,
    validatorId: "cloudmarkup.live-repository-case-validator.v2" as const,
    validatorVersion: "2.6.0" as const,
    caseId: evaluationCase.caseId,
    caseDigest: evaluationCase.caseDigest,
    sourceInputDigest: digestStructuredValue(evaluationCase.input),
    inputDigest: descriptor.inputDigest,
    outputDigest,
    proposalDigest: projectionDigest,
    assistancePreferenceSemantics: semantics,
    measurements,
  };
  return modelLiveRepositoryCaseAssessmentV2Schema.parse({
    ...body,
    assessmentDigest: digestStructuredValue(body),
  });
}
