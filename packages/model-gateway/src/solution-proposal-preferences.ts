import type { AssistantWorkflowRecordV1 } from "@cloudmarkup/schemas";
import {
  CollectingAssistantWorkflowProgressV1,
  InMemoryAssistantWorkflowStoreV1,
  SeamlessAssistantWorkflowCoordinatorV1,
  type AssistantWorkflowAuthorizationV1,
} from "./assistant-workflow.js";
import {
  projectModelCommercialPendingReviewV2,
  type ModelCommercialWorkflowRecordV1,
} from "./commercial-lifecycle.js";
import {
  modelEvaluationMeasurementV1Schema,
  type ModelEvaluationMeasurementV1,
  type ModelEvaluationAssistancePreferenceSemanticV1,
} from "./model-evaluation.js";
import { digestStructuredValue } from "./security.js";
import {
  assessSolutionProposalV2,
  InMemoryRestrictedInvalidSolutionProposalStoreV1,
  ReviewOnlySolutionProposalPlannerV1,
  type SolutionProposalAssessmentInputV2,
  type SolutionProposalAssessmentV2,
} from "./solution-planner.js";

export class SolutionProposalPreferenceAssessmentError extends Error {
  readonly code = "model-evaluation.preference-assessment-unavailable";
  constructor() {
    super("The exact proposal preference assessment is unavailable.");
    this.name = "SolutionProposalPreferenceAssessmentError";
  }
}
function requireAssessment(value: boolean): asserts value {
  if (!value) throw new SolutionProposalPreferenceAssessmentError();
}
function abortRequested(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);

/** Full review content remains in RAM. These actual workflow observations are
 * one deterministic dimension, never a completed case grade or issued receipt. */
export interface SolutionProposalPreferenceAssessmentV2 {
  readonly contractVersion: 2;
  readonly assessment: SolutionProposalAssessmentV2;
  readonly assistancePreferenceSemantics: readonly ModelEvaluationAssistancePreferenceSemanticV1[];
  readonly measurement: ModelEvaluationMeasurementV1;
  readonly workflows: readonly AssistantWorkflowRecordV1[];
}

function semanticProjection(record: AssistantWorkflowRecordV1) {
  return {
    progress: record.progress.map(({ sequence, stage, summary }) => ({
      sequence,
      stage,
      summary,
    })),
    review:
      record.review === null
        ? null
        : {
            activeIssues: record.review.activeIssues,
            credit: record.review.credit,
            diffs: record.review.diffs,
            evidenceIds: record.review.evidenceIds,
            modelProvenance: record.review.modelProvenance,
            operationBatch: record.review.operationBatch,
            writeAuthority: record.review.writeAuthority,
          },
    state: record.state,
    writeAuthority: record.writeAuthority,
  };
}

/** Execute both actual assistance workflows over one already completed exact
 * proposal and an independently authenticated pending canonical reservation.
 * The normal planner runs the actual rules; no provider port is available.
 * The host authenticates the input/output journal and current approval before
 * and after this RAM-only work, outside its metadata transaction. */
export async function assessSolutionProposalPreferencesV2(options: {
  readonly proposal: SolutionProposalAssessmentInputV2;
  readonly commercialWorkflow: ModelCommercialWorkflowRecordV1;
  readonly authorization: AssistantWorkflowAuthorizationV1;
  readonly signal?: AbortSignal;
}): Promise<SolutionProposalPreferenceAssessmentV2> {
  const input = structuredClone(options.proposal.input);
  const result = structuredClone(options.proposal.result);
  const commercialWorkflow = structuredClone(options.commercialWorkflow);
  const commercial = projectModelCommercialPendingReviewV2(commercialWorkflow);
  const request = commercialWorkflow.request;
  const scope = input.gatewayContext.scope;
  const descriptor = result.descriptor;
  const route = commercialWorkflow.resolvedContext?.selectedRoute;
  const planning = input.modelRequest.planningContext;
  requireAssessment(
    !abortRequested(options.signal) &&
      planning?.assistantLimits !== undefined &&
      request.feature === "operations.propose" &&
      request.organizationId === scope.organizationId &&
      request.projectId === scope.projectId &&
      request.userId === scope.userId &&
      request.jobId === scope.jobId &&
      request.reservationId === descriptor.budgetDecisionId &&
      request.promptId === descriptor.promptTemplateId &&
      request.promptVersion === descriptor.promptVersion &&
      route?.modelId === descriptor.modelId &&
      route.modelVersion === descriptor.modelVersion &&
      route.providerKey === descriptor.providerId &&
      route.inferenceProfileId === (descriptor.inferenceProfileId ?? null) &&
      (descriptor.routing === undefined ||
        route.routeId === descriptor.routing.routeId),
  );
  const proposal = {
    input,
    result,
    dependencies: options.proposal.dependencies,
  };
  // Missing/incomplete rules fail here instead of becoming a workflow rejection.
  const assessment = assessSolutionProposalV2(proposal);
  const plannerRequest = { ...input, maximumRepairAttempts: 0 as const };
  const assistantLimits = planning.assistantLimits;
  const limits = {
    maximumApplicationContracts: assistantLimits.maximumApplicationContracts,
    maximumEdges: planning.limits.maximumEdges,
    maximumExternalResources: planning.limits.maximumExternalResources,
    maximumNodes: planning.limits.maximumNodes,
    maximumOperations: assistantLimits.maximumOperations,
    maximumSourceOwnershipDeclarations:
      assistantLimits.maximumSourceOwnershipDeclarations,
    maximumTestScenarios: assistantLimits.maximumTestScenarios,
    maximumWorkloadOperations: assistantLimits.maximumWorkloadOperations,
    maximumWorkloads: assistantLimits.maximumWorkloads,
  };
  const identity = digestStructuredValue({
    commercialRequestDigest: commercialWorkflow.fingerprint,
    inputDigest: descriptor.inputDigest,
    outputDigest: digestStructuredValue(result.response),
  }).slice(7, 55);
  const workflows: AssistantWorkflowRecordV1[] = [];
  for (const assistancePreference of ["guided", "professional"] as const) {
    requireAssessment(!abortRequested(options.signal));
    let proposalReads = 0;
    let planningCalls = 0;
    const planner = new ReviewOnlySolutionProposalPlannerV1({
      ...options.proposal.dependencies,
      invalidProposalStore:
        new InMemoryRestrictedInvalidSolutionProposalStoreV1(),
      gateway: {
        proposeOperations: (actualRequest, actualContext, signal) => {
          requireAssessment(
            signal?.aborted !== true &&
              proposalReads === 0 &&
              same(actualRequest, input.modelRequest) &&
              same(actualContext, input.gatewayContext),
          );
          proposalReads++;
          return Promise.resolve(structuredClone(result));
        },
      },
    });
    const coordinator = new SeamlessAssistantWorkflowCoordinatorV1({
      authorization: options.authorization,
      candidateValidation: {
        validate: () =>
          Promise.reject(new SolutionProposalPreferenceAssessmentError()),
      },
      clock: { now: () => new Date(input.createdAt) },
      commercialPlanning: {
        execute: async (actualCommercial, actualPlanner, signal) => {
          requireAssessment(
            planningCalls === 0 &&
              same(actualCommercial, request) &&
              same(actualPlanner, plannerRequest),
          );
          planningCalls++;
          const plannerResult = await planner.propose(actualPlanner, signal);
          if (assessment.validationOutcome === "passed") {
            const { validationOutcome, ...reviewable } = assessment;
            void validationOutcome;
            requireAssessment(
              same(plannerResult, { ...reviewable, contractVersion: 1 }),
            );
          } else {
            requireAssessment(
              plannerResult.disposition === "rejected" &&
                plannerResult.attempts === 1 &&
                plannerResult.diagnostics.length === 1 &&
                plannerResult.diagnostics[0]?.code ===
                  (result.response.batches[0]?.kind === "safety-refusal"
                    ? "cloudmarkup.solution-planner.safety-refused"
                    : "cloudmarkup.solution-planner.deterministic-validation-failed"),
            );
          }
          return {
            commercial: structuredClone(commercial),
            issues: [],
            plannerResult,
          };
        },
      },
      limits,
      progress: new CollectingAssistantWorkflowProgressV1(),
      store: new InMemoryAssistantWorkflowStoreV1(),
    });
    const record = await coordinator.start(
      {
        assistancePreference,
        commercialRequest: request,
        createdAt: input.createdAt,
        idempotencyKey: "evaluation_review_" + identity,
        plannerRequest,
        requestedBy: scope.userId,
        workflowId: "evaluation_review_" + identity,
      },
      options.signal,
    );
    requireAssessment(
      !abortRequested(options.signal) &&
        proposalReads === 1 &&
        planningCalls === 1 &&
        record.assistancePreference === assistancePreference &&
        ["review-ready", "needs-user-input", "rejected"].includes(
          record.state,
        ) &&
        (record.review === null ||
          (record.review.credit.completedCreditUnits === null &&
            record.review.credit.state === "settlement-pending")),
    );
    workflows.push(record);
  }
  const assistancePreferenceSemantics = workflows.map((record) => ({
    assistancePreference: record.assistancePreference,
    semanticDigest: digestStructuredValue(semanticProjection(record)),
  }));
  const digests = [
    ...new Set(
      assistancePreferenceSemantics.map((value) => value.semanticDigest),
    ),
  ];
  return {
    contractVersion: 2,
    assessment,
    assistancePreferenceSemantics,
    measurement: modelEvaluationMeasurementV1Schema.parse({
      dimension: "same-ui-semantics-across-assistance-preferences",
      numerator: digests.length === 1 ? 1 : 0,
      denominator: 1,
      evidenceDigests: digests,
      sourceAuthority: "deterministic-evaluation-v1",
    }),
    workflows,
  };
}
