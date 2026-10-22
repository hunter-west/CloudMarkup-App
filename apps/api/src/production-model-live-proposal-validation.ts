import { issueModelLiveParserInputReceipt } from "./adapters/persistence/model-live-parser-input.js";
import { createProductionModelLiveCaseRequest } from "./production-model-live-case-request.js";
import { createProductionModelLiveRepositoryRequest } from "./production-model-live-repository-request.js";
import type { PinnedCompilerConfiguration } from "./adapters/pinned-go-executable.js";
import {
  digestStructuredValue,
  selectModelLiveEventValidatorVersion,
  frozenFullBetaEvaluationDatasetV1,
  fullBetaRepositorySourcesV1,
  type ModelGatewayResultV1,
  type ModelGatewayInvocationContextV1,
  type ModelLiveRuntimeControlExecutionInputV2,
  type ModelProviderInvocationV1,
} from "@cloudmarkup/model-gateway";
import {
  awsValidationRulesV1,
  createAwsFrozenModelEvaluationRulesV1,
} from "@cloudmarkup/provider-aws/validation";
import {
  modelOperationProposalResponseV1Schema,
  modelIntentExtractionResponseV1Schema,
  modelBlockingQuestionsResponseV1Schema,
  modelRepositoryInterpretationResponseV1Schema,
} from "@cloudmarkup/schemas";
import { createProductionAiCatalogGrounding } from "./production-ai-catalog.js";
import { productionAiPlanningCatalogAuthority } from "./production-ai-planning-request.js";
import { PostgresModelLiveProposalCaseValidator } from "./adapters/persistence/model-live-proposal-validation.js";
import type { PostgresModelLiveEvaluationPlans } from "./adapters/persistence/model-live-evaluation-plans.js";
import type { PostgresModelLiveInvocationJournal } from "./adapters/persistence/model-live-invocation-journal.js";
import type { PostgresModelLiveRuntimeHostEvidence } from "./adapters/persistence/model-live-runtime-host-evidence.js";

const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);
function requireProposal(value: boolean): asserts value {
  if (!value)
    throw new Error("Current production proposal validation is unavailable.");
}

/** Fixed host composition over the installed catalog and actual provider rules.
 * No caller-supplied rules, scores or validator callbacks. The prepared input is
 * already bound to an issued plan; every later check uses that exact RAM copy. */
export async function prepareProductionModelLiveProposalValidation(input: {
  readonly plans?: PostgresModelLiveEvaluationPlans;
  readonly repositoryCompiler?: PinnedCompilerConfiguration;
  readonly invocation: ModelProviderInvocationV1;
  readonly context: ModelGatewayInvocationContextV1;
  readonly execution: ModelLiveRuntimeControlExecutionInputV2;
  readonly allowedApprovalPathIds: readonly string[];
}) {
  const { invocation, context, execution } = structuredClone({
    invocation: input.invocation,
    context: input.context,
    execution: input.execution,
  });
  const request = invocation.request;
  if (request.operation === "repository.interpret") {
    const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseId === execution.admissionRequest.evaluationCaseId,
    );
    const source = fullBetaRepositorySourcesV1.find(
      (s) => s.caseKind === evaluationCase?.caseKind,
    );
    const compiler = input.repositoryCompiler;
    requireProposal(
      compiler !== undefined &&
        evaluationCase !== undefined &&
        source !== undefined &&
        same(
          request,
          createProductionModelLiveRepositoryRequest({
            caseId: evaluationCase.caseId,
            requestedMode: request.requestedMode,
          }),
        ),
    );
    // Execute the actual deterministic parser before inference, then reauthenticate
    // its exact source again when issuing the response assessment.
    requireProposal(input.plans !== undefined);
    await issueModelLiveParserInputReceipt({
      plans: input.plans,
      definitionId: execution.plan.definition.definitionId,
      invocation,
      admission: execution.admissionRequest,
      compiler,
    });
    return {
      async issue(host: {
        readonly plans: PostgresModelLiveEvaluationPlans;
        readonly evidence: PostgresModelLiveRuntimeHostEvidence;
        readonly journal: PostgresModelLiveInvocationJournal;
        readonly result: ModelGatewayResultV1;
        readonly signal: AbortSignal;
        readonly authorize: () => Promise<void>;
      }) {
        await host.authorize();
        requireProposal(
          !host.signal.aborted &&
            same(host.result.descriptor, invocation.descriptor),
        );
        const validator = new PostgresModelLiveProposalCaseValidator({
          plans: host.plans,
          evidence: host.evidence,
          definitionId: execution.plan.definition.definitionId,
          repositoryCompiler: compiler,
        });
        const receipt = await validator.issue({
          invocation,
          journal: host.journal,
          signal: host.signal,
          repository: {
            ...host.result,
            response: modelRepositoryInterpretationResponseV1Schema.parse(
              host.result.response,
            ),
          },
        });
        await host.authorize();
        requireProposal(!host.signal.aborted);
        return receipt;
      },
    };
  }
  if (
    request.operation === "intent.extract" ||
    request.operation === "requirements.blocking-questions"
  )
    return {
      async issue(host: {
        readonly plans: PostgresModelLiveEvaluationPlans;
        readonly evidence: PostgresModelLiveRuntimeHostEvidence;
        readonly journal: PostgresModelLiveInvocationJournal;
        readonly result: ModelGatewayResultV1;
        readonly signal: AbortSignal;
        readonly authorize: () => Promise<void>;
      }) {
        await host.authorize();
        requireProposal(
          !host.signal.aborted &&
            same(host.result.descriptor, invocation.descriptor),
        );
        const validator = new PostgresModelLiveProposalCaseValidator({
          plans: host.plans,
          evidence: host.evidence,
          definitionId: execution.plan.definition.definitionId,
        });
        const receipt = await validator.issue({
          invocation,
          journal: host.journal,
          signal: host.signal,
          ...(request.operation === "intent.extract"
            ? {
                intent: {
                  ...host.result,
                  response: modelIntentExtractionResponseV1Schema.parse(
                    host.result.response,
                  ),
                },
              }
            : {
                questions: {
                  ...host.result,
                  response: modelBlockingQuestionsResponseV1Schema.parse(
                    host.result.response,
                  ),
                },
              }),
        });
        await host.authorize();
        requireProposal(!host.signal.aborted);
        return receipt;
      },
    };

  // Other operation families need their own actual validators. They cannot
  // obtain an operations receipt or a completed quality result here.
  if (
    request.operation !== "operations.propose" ||
    request.planningContext === undefined
  )
    return null;
  const revisionId = context.scope.solutionRevisionId;
  requireProposal(
    revisionId !== undefined &&
      same(
        request.catalogGrounding,
        createProductionAiCatalogGrounding(request.catalogGrounding.catalog),
      ) &&
      same(request.architecture.catalog, request.catalogGrounding.catalog),
  );
  const installed = productionAiPlanningCatalogAuthority(
    request.planningContext.target,
    request.catalogGrounding.catalog,
  );
  requireProposal(
    same(request.planningContext.validationRules, installed.validationRules) &&
      same(
        request.planningContext.targetReadiness,
        installed.targetReadiness,
      ) &&
      request.planningContext.allowedPolicyKinds.every((kind) =>
        installed.allowedPolicyKinds.some(
          (installedKind) => String(installedKind) === kind,
        ),
      ),
  );
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseId === execution.admissionRequest.evaluationCaseId,
  );
  // The immutable evaluation input is assessed with its own exact catalog
  // rules. Other requests continue to use the installed current rules.
  const validationRules =
    evaluationCase !== undefined &&
    same(
      request,
      createProductionModelLiveCaseRequest({
        caseId: evaluationCase.caseId,
        requestedMode: request.requestedMode,
      }),
    )
      ? createAwsFrozenModelEvaluationRulesV1()
      : awsValidationRulesV1;
  if (evaluationCase?.caseKind === "event-driven-image-processing")
    selectModelLiveEventValidatorVersion(
      execution.plan.definition.policy.evaluationRequirement,
    );
  const repositoryCompiler = input.repositoryCompiler;
  if (evaluationCase?.caseKind === "external-existing-resource") {
    const evidence = request.planningContext.approvedRepositoryEvidence;
    requireProposal(
      repositoryCompiler !== undefined &&
        evidence !== undefined &&
        context.scope.repositorySnapshotId === evidence.repositorySnapshotId &&
        same(
          request,
          createProductionModelLiveCaseRequest({
            caseId: evaluationCase.caseId,
            requestedMode: request.requestedMode,
          }),
        ),
    );
    requireProposal(input.plans !== undefined);
    await issueModelLiveParserInputReceipt({
      plans: input.plans,
      definitionId: execution.plan.definition.definitionId,
      invocation,
      admission: execution.admissionRequest,
      compiler: repositoryCompiler,
    });
  }
  const allowedApprovalPathIds = new Set(input.allowedApprovalPathIds);
  return {
    async issue(host: {
      readonly plans: PostgresModelLiveEvaluationPlans;
      readonly evidence: PostgresModelLiveRuntimeHostEvidence;
      readonly journal: PostgresModelLiveInvocationJournal;
      readonly result: ModelGatewayResultV1;
      readonly signal: AbortSignal;
      readonly authorize: () => Promise<void>;
    }) {
      await host.authorize();
      const validator = new PostgresModelLiveProposalCaseValidator({
        plans: host.plans,
        evidence: host.evidence,
        definitionId: execution.plan.definition.definitionId,
        ...(repositoryCompiler === undefined ? {} : { repositoryCompiler }),
        dependencies: {
          allowedApprovalPathIds,
          validationRules,
        },
        authorization: {
          authorizeStart: async (candidate) => {
            await host.authorize();
            requireProposal(
              candidate.organizationId === context.scope.organizationId &&
                candidate.projectId === context.scope.projectId &&
                candidate.requestedBy === context.scope.userId &&
                candidate.solutionRevisionId === revisionId &&
                !host.signal.aborted,
            );
            return {
              allowed: true,
              decisionId: execution.plan.planDigest,
              evaluatedAt: execution.plan.issuedAt,
              principalId: context.scope.userId,
              reason: null,
            };
          },
          // Evaluation executes the normal review projection only. It never
          // authorizes acceptance, editing or any saved graph mutation.
          authorizeReview: () =>
            Promise.reject(new Error("Evaluation cannot apply a review.")),
        },
      });
      const receipt = await validator.issue({
        invocation,
        journal: host.journal,
        signal: host.signal,
        proposal: {
          input: {
            createdAt: execution.plan.issuedAt,
            gatewayContext: context,
            modelRequest: request,
            solutionRevisionId: revisionId,
            validationEnvironment: "production",
          },
          result: {
            ...host.result,
            response: modelOperationProposalResponseV1Schema.parse(
              host.result.response,
            ),
          },
        },
      });
      await host.authorize();
      requireProposal(!host.signal.aborted);
      return receipt;
    },
  };
}
