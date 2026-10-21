import { getActiveIssueRecordHash } from "@cloudmarkup/domain";
import { z } from "zod";
import {
  digestStructuredValue,
  modelLiveEventCriterionV211,
  selectModelLiveEventValidatorVersion,
  modelEvaluationMeasurementV1Schema,
  type ModelEvaluationMeasurementV1,
} from "@cloudmarkup/model-gateway";
import {
  modelGatewayUnknownV1Schema,
  type ActiveIssueV1,
} from "@cloudmarkup/schemas";
type ModelGatewayUnknownV1 = z.output<typeof modelGatewayUnknownV1Schema>;
import {
  assessModelLiveEventCaseV2,
  modelLiveEventCaseAssessmentV2Schema,
} from "./model-live-event-case-assessment.js";

interface EventIssueWorkflowObservation {
  readonly assistancePreference: "guided" | "professional";
  readonly state: string;
  readonly writeAuthority: string;
  readonly review: {
    readonly writeAuthority: string;
    readonly decision: { readonly state: string };
    readonly activeIssues: readonly ActiveIssueV1[];
  } | null;
}
export interface EventIssueBindingInput {
  readonly assessmentWriteAuthority: string;
  readonly unknowns: readonly ModelGatewayUnknownV1[];
  readonly issues: readonly ActiveIssueV1[];
  readonly workflows: readonly EventIssueWorkflowObservation[];
  readonly inputDigest: string;
  readonly solutionRevisionId: string;
}
/** Deterministic metadata inspection, not a caller-authorized grade or receipt.
 * Production supplies only the actual planner and both actual workflow results. */
export function inspectModelLiveEventIssueBindings(
  input: EventIssueBindingInput,
) {
  const unknowns = input.unknowns.filter((unknown) => unknown.blocking);
  const issues = input.issues.filter(
    (issue) => issue.lifecycle.state === "current",
  );
  const bindings = unknowns.map((unknown) => {
    const matches = issues.filter(
      (issue) =>
        issue.source === "ai-generation-repair" &&
        issue.sourceRecordId === unknown.unknownId,
    );
    const issue = matches.length === 1 ? matches[0] : undefined;
    const exact =
      issue?.category === "configuration" &&
      issue.severity === "warning" &&
      issue.solutionRevisionId === input.solutionRevisionId &&
      issue.currentRecordDigest === getActiveIssueRecordHash(issue) &&
      issue.provenance.inputDigests.length === 1 &&
      issue.provenance.inputDigests[0] === input.inputDigest &&
      issue.summary === unknown.question.slice(0, 500) &&
      issue.summary.trim().length > 0 &&
      issue.technicalDetail.trim().length > 0 &&
      issue.affected.some(
        (reference) =>
          reference.kind === "solution-revision" &&
          reference.solutionRevisionId === input.solutionRevisionId,
      );
    return { unknown, issue, exact };
  });
  const workflowParity =
    input.workflows.length === 2 &&
    new Set(input.workflows.map((workflow) => workflow.assistancePreference))
      .size === 2 &&
    input.workflows.every(
      (workflow) =>
        workflow.state === "needs-user-input" &&
        workflow.writeAuthority === "none" &&
        workflow.review?.writeAuthority === "none" &&
        workflow.review.decision.state === "pending" &&
        bindings.every(
          ({ issue }) =>
            issue !== undefined &&
            workflow.review?.activeIssues.filter(
              (entry) =>
                entry.id === issue.id &&
                entry.currentRecordDigest === issue.currentRecordDigest &&
                digestStructuredValue(entry) === digestStructuredValue(issue),
            ).length === 1,
        ),
    );
  const satisfied =
    input.assessmentWriteAuthority === "none" &&
    unknowns.length > 0 &&
    new Set(unknowns.map((unknown) => unknown.unknownId)).size ===
      unknowns.length &&
    bindings.every((binding) => binding.exact) &&
    workflowParity &&
    issues.every(
      (issue) =>
        !["error", "security-error"].includes(issue.severity) &&
        issue.summary.trim().length > 0 &&
        issue.technicalDetail.trim().length > 0 &&
        issue.affected.length > 0,
    );
  return {
    satisfied,
    bindingDigest: digestStructuredValue({
      inputDigest: input.inputDigest,
      solutionRevisionId: input.solutionRevisionId,
      unknowns: bindings.map(({ unknown, issue, exact }) => ({
        sourceDigest: digestStructuredValue(unknown),
        issueDigest: issue === undefined ? null : digestStructuredValue(issue),
        exact,
      })),
      workflows: input.workflows.map((workflow) => ({
        preference: workflow.assistancePreference,
        state: workflow.state,
        writeAuthority: workflow.writeAuthority,
        reviewDigest: digestStructuredValue(workflow.review),
      })),
      satisfied,
    }),
  };
}

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
/** Additive metadata variant; historical 2.8 parser and bytes are untouched. */
export const modelLiveEventCaseAssessmentSuccessorV2Schema = z
  .object({
    ...modelLiveEventCaseAssessmentV2Schema.shape,
    validatorVersion: z.literal("2.11.0"),
  })
  .strict()
  .superRefine((value, context) => {
    const { assessmentDigest, ...body } = value;
    const semanticDigests = [
      ...new Set(
        value.assistancePreferenceSemantics.map((s) => s.semanticDigest),
      ),
    ];
    const semantic = value.measurements.find(
      (m) => m.dimension === "same-ui-semantics-across-assistance-preferences",
    );
    const clarity = value.measurements.find(
      (m) => m.dimension === "issue-clarity-correct-severity",
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
            m.denominator !== 9) ||
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
      semantic.numerator !== (semanticDigests.length === 1 ? 1 : 0) ||
      !exactSet(semantic.evidenceDigests, semanticDigests) ||
      clarity?.evidenceDigests.length !== 4 ||
      clarity.evidenceDigests[0] !== modelLiveEventCriterionV211.criterionDigest
    )
      context.addIssue({
        code: "custom",
        message: "Event successor assessment metadata is contradictory.",
      });
  });

/** Re-executes real graph validation and both review flows from source, never
 * upgrades a persisted historical receipt. Policy is chosen before inspection. */
export async function assessModelLiveEventCaseSuccessorV2(
  options: Parameters<typeof assessModelLiveEventCaseV2>[0] & {
    readonly evaluationPolicy: unknown;
  },
) {
  const { evaluationPolicy, ...source } = options;
  if (selectModelLiveEventValidatorVersion(evaluationPolicy) !== "2.11.0")
    throw new Error("The event successor requires its exact preissued policy.");
  const actual = await assessModelLiveEventCaseV2(source);
  const { assessment, workflows } = actual.preferences;
  const response = source.proposal.result.response;
  const coverage = actual.metadata.measurements.find(
    (m) => m.dimension === "capability-requirement-coverage",
  );
  const clarity = inspectModelLiveEventIssueBindings({
    assessmentWriteAuthority: assessment.writeAuthority,
    unknowns: response.proposalContext.unknowns,
    issues: assessment.activeIssues,
    workflows,
    inputDigest: source.proposal.result.descriptor.inputDigest,
    solutionRevisionId: source.proposal.input.solutionRevisionId,
  });
  const unresolved =
    response.proposalContext.unknowns.some((unknown) => unknown.blocking) &&
    response.solutionProposal?.targetReadiness.status === "blocked" &&
    assessment.candidateArchitecture.workloadBehavior.workloads.length === 0 &&
    assessment.candidateArchitecture.applicationContracts.contracts.length ===
      0;
  const measurement = modelEvaluationMeasurementV1Schema.parse({
    dimension: "issue-clarity-correct-severity",
    numerator:
      coverage?.numerator === 9 &&
      coverage.denominator === 9 &&
      assessment.validationOutcome === "passed" &&
      assessment.disposition === "needs-user-input" &&
      unresolved &&
      clarity.satisfied
        ? 1
        : 0,
    denominator: 1,
    sourceAuthority: "deterministic-evaluation-v1",
    evidenceDigests: [
      modelLiveEventCriterionV211.criterionDigest,
      clarity.bindingDigest,
      ...(coverage?.evidenceDigests ?? []),
      digestStructuredValue(assessment.validationReport),
    ],
  } satisfies ModelEvaluationMeasurementV1);
  const { assessmentDigest: historicalDigest, ...raw } = actual.metadata;
  void historicalDigest;
  const body = {
    ...raw,
    validatorVersion: "2.11.0" as const,
    measurements: raw.measurements.map((m) =>
      m.dimension === measurement.dimension ? measurement : m,
    ),
  };
  return {
    metadata: modelLiveEventCaseAssessmentSuccessorV2Schema.parse({
      ...body,
      assessmentDigest: digestStructuredValue(body),
    }),
    preferences: actual.preferences,
  };
}
