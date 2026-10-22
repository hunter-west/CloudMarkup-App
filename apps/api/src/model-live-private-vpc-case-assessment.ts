import { z } from "zod";
import {
  assessSolutionProposalPreferencesV2,
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
  fullBetaEvaluationCatalogV1,
  modelLiveIntentCaseAssessmentV2Schema,
  modelEvaluationMeasurementV1Schema,
  type ModelEvaluationMeasurementV1,
} from "@cloudmarkup/model-gateway";
import { resolveAwsModelCatalogV1 } from "@cloudmarkup/provider-aws";
import { createAwsFrozenModelEvaluationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import { modelEvaluationCaseV1Schema } from "@cloudmarkup/schemas";
import { inspectModelLivePrivateVpcCoverage } from "./model-live-private-vpc-coverage.js";
import { requireProductionModelLiveCaseSource } from "./production-model-live-case-source.js";
import { createProductionAiCatalogGrounding } from "./production-ai-catalog.js";
import { productionAiPlanningCatalogAuthority } from "./production-ai-planning-request.js";

const dimensions = [
  "structured-schema-validity",
  "capability-requirement-coverage",
  "unsupported-service-field-rate",
  "graph-workload-external-rule-violations",
  "security-policy-violations",
  "issue-clarity-correct-severity",
  "unresolved-behavior-honesty",
  "same-ui-semantics-across-assistance-preferences",
] as const;
const exactSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  a.every((v) => b.includes(v));
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);

/** Bounded metadata, never caller-granted execution or promotion authority. */
export const modelLivePrivateVpcCaseAssessmentV2Schema = z
  .object({
    ...modelLiveIntentCaseAssessmentV2Schema.shape,
    recordKind: z.literal("model-live-private-vpc-case-assessment"),
    validatorId: z.literal("cloudmarkup.live-private-vpc-case-validator.v2"),
    validatorVersion: z.literal("2.3.0"),
    measurements: z
      .array(modelEvaluationMeasurementV1Schema)
      .length(dimensions.length),
  })
  .strict()
  .superRefine((value, context) => {
    const { assessmentDigest, ...body } = value;
    const digests = [
      ...new Set(
        value.assistancePreferenceSemantics.map((s) => s.semanticDigest),
      ),
    ];
    const semantic = value.measurements.find(
      (m) => m.dimension === "same-ui-semantics-across-assistance-preferences",
    );
    if (
      assessmentDigest !== digestStructuredValue(body) ||
      !exactSet(
        value.measurements.map((m) => m.dimension),
        dimensions,
      ) ||
      value.measurements.some(
        (m) =>
          m.sourceAuthority !== "deterministic-evaluation-v1" ||
          m.evidenceDigests.length === 0 ||
          (m.dimension === "capability-requirement-coverage" &&
            m.denominator !== 13) ||
          (m.dimension === "structured-schema-validity" &&
            (m.numerator !== 1 || m.denominator !== 1)) ||
          ([
            "issue-clarity-correct-severity",
            "unresolved-behavior-honesty",
          ].includes(m.dimension) &&
            m.denominator !== 1),
      ) ||
      !exactSet(
        value.assistancePreferenceSemantics.map((s) => s.assistancePreference),
        ["guided", "professional"],
      ) ||
      semantic?.denominator !== 1 ||
      semantic.numerator !== (digests.length === 1 ? 1 : 0) ||
      !exactSet(semantic.evidenceDigests, digests)
    )
      context.addIssue({
        code: "custom",
        message: "Private-network assessment metadata is contradictory.",
      });
  });
function measure(
  dimension: ModelEvaluationMeasurementV1["dimension"],
  numerator: number,
  denominator: number,
  evidenceDigests: readonly string[],
) {
  return modelEvaluationMeasurementV1Schema.parse({
    dimension,
    numerator,
    denominator,
    evidenceDigests,
    sourceAuthority: "deterministic-evaluation-v1",
  });
}

/** Execute the fixed current private-network case through real graph command
 * preview, installed AWS rules and both actual review flows. Only temporary
 * graph/response content is inspected; durable output contains counts/digests.
 * Valid schema, settled usage or a safe refusal cannot establish requirement
 * coverage. This function provides no compiler, receipt or promotion authority. */
export async function assessModelLivePrivateVpcCaseV2(
  options: Parameters<typeof assessSolutionProposalPreferencesV2>[0] & {
    readonly evaluationCase: unknown;
  },
) {
  const evaluationCase = modelEvaluationCaseV1Schema.parse(
    options.evaluationCase,
  );
  const frozen = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseKind === "private-vpc-application",
  );
  const request = options.proposal.input.modelRequest;
  const planning = request.planningContext;
  if (
    !same(frozen, evaluationCase) ||
    !planning ||
    options.proposal.input.validationEnvironment !== "production" ||
    !exactSet(
      evaluationCase.targetDimensions.filter(
        (d) => !["tokens", "credits", "estimated-cost", "latency"].includes(d),
      ),
      dimensions,
    ) ||
    !same(
      request.catalogGrounding,
      createProductionAiCatalogGrounding(fullBetaEvaluationCatalogV1),
    ) ||
    !same(
      planning.validationRules,
      productionAiPlanningCatalogAuthority(
        planning.target,
        fullBetaEvaluationCatalogV1,
      ).validationRules,
    ) ||
    !same(
      planning.targetReadiness,
      productionAiPlanningCatalogAuthority(
        planning.target,
        fullBetaEvaluationCatalogV1,
      ).targetReadiness,
    )
  )
    throw Error("The complete current private-network case is unavailable.");
  requireProductionModelLiveCaseSource({
    evaluationCase,
    invocation: { request, descriptor: options.proposal.result.descriptor },
  });
  const evaluationCatalog = resolveAwsModelCatalogV1(
    fullBetaEvaluationCatalogV1,
  ).catalog;
  const preferences = await assessSolutionProposalPreferencesV2({
    ...options,
    proposal: {
      ...options.proposal,
      dependencies: {
        ...options.proposal.dependencies,
        validationRules: createAwsFrozenModelEvaluationRulesV1(),
      },
    },
  });
  const assessment = preferences.assessment;
  const candidate = assessment.candidateArchitecture;
  const coverage = inspectModelLivePrivateVpcCoverage(candidate);
  const findings = assessment.validationReport.findings;
  const issues = assessment.activeIssues.filter(
    (i) => i.lifecycle.state === "current",
  );
  const unsupported: boolean[] = [];
  for (const node of candidate.nodes) {
    const service = evaluationCatalog.getService(node.semantic.serviceType);
    unsupported.push(
      service?.configuration.schemaId !==
        node.semantic.configuration.schemaId ||
        service.configuration.schemaVersion !==
          node.semantic.configuration.schemaVersion,
    );
    const keys = Object.keys(
      service?.configuration.jsonSchema.properties ?? {},
    );
    unsupported.push(
      ...Object.keys(node.semantic.configuration.values).map(
        (key) => !keys.includes(key),
      ),
    );
  }
  for (const edge of candidate.edges) {
    const rule = evaluationCatalog
      .listConnectionRules()
      .find((r) => r.relationshipType === edge.semantic.relationshipType);
    unsupported.push(
      rule?.configuration.schemaId !== edge.semantic.configuration.schemaId ||
        rule.configuration.schemaVersion !==
          edge.semantic.configuration.schemaVersion,
    );
    const keys = Object.keys(rule?.configuration.jsonSchema.properties ?? {});
    unsupported.push(
      ...Object.keys(edge.semantic.configuration.values).map(
        (key) => !keys.includes(key),
      ),
    );
  }
  const outputDigest = digestStructuredValue(options.proposal.result.response);
  const reportDigest = digestStructuredValue(assessment.validationReport);
  const body = {
    contractVersion: 2 as const,
    recordKind: "model-live-private-vpc-case-assessment" as const,
    validatorId: "cloudmarkup.live-private-vpc-case-validator.v2" as const,
    validatorVersion: "2.3.0" as const,
    caseId: evaluationCase.caseId,
    caseDigest: evaluationCase.caseDigest,
    sourceInputDigest: digestStructuredValue(evaluationCase.input),
    inputDigest: options.proposal.result.descriptor.inputDigest,
    outputDigest,
    proposalDigest: assessment.proposalDigest,
    measurements: [
      measure("structured-schema-validity", 1, 1, [
        outputDigest,
        assessment.proposalDigest,
      ]),
      measure(
        "capability-requirement-coverage",
        coverage.numerator,
        coverage.denominator,
        [coverage.inspectionDigest],
      ),
      measure(
        "unsupported-service-field-rate",
        unsupported.filter(Boolean).length,
        Math.max(1, unsupported.length),
        [coverage.architectureContentDigest],
      ),
      measure(
        "graph-workload-external-rule-violations",
        findings.filter((f) => ["error", "security-error"].includes(f.severity))
          .length,
        Math.max(1, findings.length),
        [reportDigest],
      ),
      measure(
        "security-policy-violations",
        findings.filter((f) => f.severity === "security-error").length,
        Math.max(1, findings.length),
        [reportDigest],
      ),
      measure(
        "issue-clarity-correct-severity",
        coverage.numerator === coverage.denominator &&
          assessment.validationOutcome === "passed" &&
          issues.length > 0 &&
          issues.every(
            (issue) =>
              issue.severity === "warning" &&
              issue.summary.trim().length > 0 &&
              issue.technicalDetail.trim().length > 0 &&
              issue.affected.length > 0,
          ) &&
          preferences.workflows.every((w) => w.state === "review-ready")
          ? 1
          : 0,
        1,
        [
          reportDigest,
          digestStructuredValue(issues),
          coverage.inspectionDigest,
        ],
      ),
      measure(
        "unresolved-behavior-honesty",
        candidate.workloadBehavior.workloads.length === 0 &&
          candidate.applicationContracts.contracts.length === 0
          ? 1
          : 0,
        1,
        [coverage.architectureContentDigest],
      ),
      preferences.measurement,
    ],
    assistancePreferenceSemantics: preferences.assistancePreferenceSemantics,
  };
  return {
    metadata: modelLivePrivateVpcCaseAssessmentV2Schema.parse({
      ...body,
      assessmentDigest: digestStructuredValue(body),
    }),
    preferences,
  };
}
