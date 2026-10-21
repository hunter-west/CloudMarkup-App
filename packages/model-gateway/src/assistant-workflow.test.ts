import { describe, expect, it, vi } from "vitest";

import {
  defineValidationRuleV1,
  createValidationFindingCode,
  createValidationDocumentPath,
  getActiveIssueRecordHash,
  getArchitectureDocumentCanonicalHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  activeIssueV1Schema,
  digestModelEvaluationCaseV1,
  assistantOperationBatchV1Schema,
  modelOperationProposalRequestV1Schema,
  modelOperationProposalResponseV1Schema,
  operationIdSchema,
} from "@cloudmarkup/schemas";

import {
  CollectingAssistantWorkflowProgressV1,
  InMemoryAssistantWorkflowStoreV1,
  SeamlessAssistantWorkflowCoordinatorV1,
  type AssistantCommercialPlanningPortV1,
  type AssistantWorkflowAuthorizationDecisionV1,
  type AssistantWorkflowAuthorizationV1,
  type AssistantWorkflowReviewAuthorizationRequestV1,
} from "./assistant-workflow.js";
import {
  MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  ModelCommercialLifecycleCoordinator,
  projectModelCommercialPendingReviewV2,
  type ModelCommercialRouteV1,
  type ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import {
  CollectingModelUsageRecorder,
  CollectingSafeModelLogger,
  DeterministicFakeModelAdapter,
  InMemoryModelInvocationStore,
  deterministicFakeRoutingV1,
} from "./fakes.js";
import { ProviderNeutralModelGateway } from "./gateway.js";
import {
  InMemoryRestrictedInvalidSolutionProposalStoreV1,
  ReviewOnlySolutionProposalPlannerV1,
  type SolutionProposalPlannerRequestV1,
} from "./solution-planner.js";
import type { ModelSolutionCommercialExecutionV1 } from "./solution-commercial-service.js";
import { modelUsageToCommercialAttemptV1 } from "./intent-commercial-service.js";
import { assessSolutionProposalPreferencesV2 } from "./solution-proposal-preferences.js";
import { frozenModelEvaluationDatasetV1 } from "./model-evaluation.js";
import {
  assessModelLiveProposalCaseV2,
  modelLiveProposalCaseAssessmentV2Schema,
} from "./model-live-proposal-case-assessment.js";
import {
  InMemoryCanonicalModelCommercialAccounting,
  InMemoryModelCommercialAuthorization,
  InMemoryModelCommercialHostAttestations,
  InMemoryModelCommercialPricing,
  InMemoryModelCommercialScopeResolver,
  InMemoryModelCommercialWorkflowStore,
} from "./commercial-lifecycle-fakes.js";
import {
  authorization as commercialAuthorization,
  modelKey,
  normalizationPolicy,
  pricingFor,
  request as canonicalCommercialRequest,
} from "./commercial-lifecycle-test-helpers.js";
import { digestStructuredValue, sha256Text } from "./security.js";
import {
  modelTestContext,
  modelTestRequests,
  testIntent,
  testSolutionRevision,
} from "./test-helpers.js";

const createdAt = "2026-08-22T12:00:00.000Z";

const rules = [
  "placement",
  "connection",
  "policy",
  "security",
  "cost-sensitive",
  "coverage",
  "target-readiness",
] as const;

function operationRequest(): Extract<
  ReturnType<typeof modelTestRequests>[number],
  { operation: "operations.propose" }
> {
  const base = modelTestRequests().find(
    (request) => request.operation === "operations.propose",
  );
  if (base === undefined) {
    throw new Error("Missing operations request fixture.");
  }
  return modelOperationProposalRequestV1Schema.parse({
    ...base,
    planningContext: {
      allowedAssistantOperationKinds: ["edit-workload"],
      allowedGraphCommandKinds: ["move-node"],
      allowedPolicyKinds: [],
      approvedIntent: testIntent,
      assistantLimits: {
        maximumApplicationContracts: 64,
        maximumOperations: 64,
        maximumSourceOwnershipDeclarations: 64,
        maximumTestScenarios: 64,
        maximumWorkloadOperations: 64,
        maximumWorkloads: 64,
      },
      limits: {
        maximumAddedNodes: 8,
        maximumEdges: 64,
        maximumExternalResources: 64,
        maximumNodes: 64,
      },
      target: "terraform",
      targetReadiness: base.architecture.nodes.map((node) => ({
        rationale: "The deterministic fixture is ready for Terraform review.",
        serviceType: node.semantic.serviceType,
        status: "ready" as const,
        target: "terraform" as const,
      })),
      validationRules: rules.map((kind) => ({
        kind,
        ruleId: `example.assistant.${kind}`,
      })),
    },
  });
}

function plannerRequest(): SolutionProposalPlannerRequestV1 {
  return {
    createdAt,
    gatewayContext: modelTestContext("invocation_assistant_workflow"),
    maximumRepairAttempts: 0,
    modelRequest: operationRequest(),
    solutionRevisionId: testSolutionRevision.solutionRevisionId,
    validationEnvironment: "development",
  };
}

function commercialRequest(): ModelCommercialOperationRequestV1 {
  const maximumUsage = {
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    inputUnits: 2_000,
    outputUnits: 1_000,
    providerSpecificUnits: [],
    totalUnits: 3_000,
  };
  return {
    confirmationRequired: false,
    environment: "test",
    estimateAccepted: true,
    eventIdPrefix: "assistant_workflow_event",
    expiresAt: "2026-08-22T13:00:00.000Z",
    feature: "operations.propose",
    idempotencyKey: "assistant_workflow_idempotency",
    includeTechnicalUnitDetail: true,
    jobId: "job_test",
    multiCallWorkflowId: "assistant_multicall_workflow",
    organizationId: "organization_test",
    plannedCalls: [
      {
        kind: "primary",
        maximumUsage,
        minimumUsage: {
          ...maximumUsage,
          inputUnits: 1,
          outputUnits: 1,
          totalUnits: 2,
        },
        routeId: "standard-design",
      },
    ],
    projectId: "project_test",
    promptId: "cloudmarkup.operations.propose",
    promptVersion: "1.0.0",
    requestedAt: createdAt,
    requestedMaximumInputUnits: 2_000,
    requestedMaximumOutputUnits: 1_000,
    requestedRoute: "standard",
    requestId: "assistant_request_test",
    reservationId: "assistant_reservation_test",
    templateId: null,
    templateVersion: null,
    userId: "user_test",
  };
}

function workflowValidationRules() {
  return rules.map((kind) =>
    defineValidationRuleV1({
      applicability: {
        catalogs: { kind: "all" },
        environments: ["development"],
        providers: { kind: "all" },
        targets: ["compilation"],
      },
      evaluate: () => [],
      id: `example.assistant.${kind}`,
      input: "architecture-document",
      interfaceVersion: 1,
      ruleVersion: "1.0.0",
    }),
  );
}

function planner() {
  const gateway = new ProviderNeutralModelGateway({
    adapters: [new DeterministicFakeModelAdapter()],
    allowedApprovalPathIds: ["cloudmarkup.dependency-review.v1"],
    invocationStore: new InMemoryModelInvocationStore(),
    invalidProposalStore:
      new InMemoryRestrictedInvalidSolutionProposalStoreV1(),
    logger: new CollectingSafeModelLogger(),
    routing: deterministicFakeRoutingV1,
    usageRecorder: new CollectingModelUsageRecorder(),
  });
  return new ReviewOnlySolutionProposalPlannerV1({
    allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
    gateway,
    invalidProposalStore:
      new InMemoryRestrictedInvalidSolutionProposalStoreV1(),
    validationRules: workflowValidationRules(),
  });
}

class FakeCommercialPlanning implements AssistantCommercialPlanningPortV1 {
  public calls = 0;
  public denied = false;
  readonly #planner = planner();

  public async execute(
    _commercial: ModelCommercialOperationRequestV1,
    planning: SolutionProposalPlannerRequestV1,
    signal?: AbortSignal,
  ): Promise<ModelSolutionCommercialExecutionV1> {
    this.calls += 1;
    if (this.denied) {
      return {
        commercial: {
          compensationStatus: "not-required",
          completedCreditUnits: null,
          denialReason: "insufficient-credits",
          estimate: {
            maximumCreditUnits: 3,
            minimumCreditUnits: 1,
            requiresConfirmation: false,
          },
          reconciliationState: "not-required",
          reservationAccepted: false,
          reservationId: null,
          route: "standard",
          routeExplanation: "Deterministic test route.",
          routeLabel: "Standard Design",
          state: "denied",
          technicalUnits: null,
          version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
        },
        issues: [
          {
            category: "commercial-denial",
            code: "insufficient-credits",
            severity: "blocking",
          },
        ],
        plannerResult: null,
      };
    }
    const plannerResult = await this.#planner.propose(planning, signal);
    return {
      commercial: {
        compensationStatus: "not-required",
        completedCreditUnits: 2,
        denialReason: null,
        estimate: {
          maximumCreditUnits: 3,
          minimumCreditUnits: 1,
          requiresConfirmation: false,
        },
        reconciliationState: "not-required",
        reservationAccepted: true,
        reservationId: "assistant_reservation_test",
        route: "standard",
        routeExplanation: "Deterministic test route.",
        routeLabel: "Standard Design",
        state: "completed",
        technicalUnits: null,
        version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
      },
      issues: [],
      plannerResult,
    };
  }
}

class AllowedAuthorization implements AssistantWorkflowAuthorizationV1 {
  public startCalls = 0;
  public reviewCalls = 0;
  public allowed = true;

  public authorizeStart(): Promise<AssistantWorkflowAuthorizationDecisionV1> {
    this.startCalls += 1;
    return Promise.resolve({
      allowed: this.allowed,
      decisionId: "assistant_start_authorization",
      evaluatedAt: createdAt,
      principalId: "user_test",
      reason: this.allowed ? null : "not-authorized",
    });
  }

  public authorizeReview(
    request: AssistantWorkflowReviewAuthorizationRequestV1,
  ): Promise<AssistantWorkflowAuthorizationDecisionV1> {
    this.reviewCalls += 1;
    return Promise.resolve({
      allowed: this.allowed,
      decisionId: `assistant_${request.action}_authorization_${String(this.reviewCalls)}`,
      evaluatedAt: `2026-08-22T12:${String(4 + this.reviewCalls).padStart(2, "0")}:00.000Z`,
      principalId: "user_test",
      reason: this.allowed ? null : "not-authorized",
    });
  }
}

function harness(
  candidateValidation: (input: {
    readonly candidateArchitecture: ReturnType<
      typeof operationRequest
    >["architecture"];
  }) => Promise<{
    readonly activeIssues: readonly ReturnType<
      typeof activeIssueV1Schema.parse
    >[];
    readonly evidenceIds: readonly string[];
  }> = () => Promise.resolve({ activeIssues: [], evidenceIds: [] }),
  maximumOperations = 64,
) {
  const authorization = new AllowedAuthorization();
  const commercial = new FakeCommercialPlanning();
  const progress = new CollectingAssistantWorkflowProgressV1();
  const store = new InMemoryAssistantWorkflowStoreV1();
  let clockTick = 0;
  const coordinator = new SeamlessAssistantWorkflowCoordinatorV1({
    authorization,
    candidateValidation: { validate: candidateValidation },
    clock: {
      now: () => new Date(Date.parse(createdAt) + ++clockTick * 1_000),
    },
    commercialPlanning: commercial,
    limits: {
      maximumApplicationContracts: 64,
      maximumEdges: 64,
      maximumExternalResources: 64,
      maximumNodes: 64,
      maximumOperations,
      maximumSourceOwnershipDeclarations: 64,
      maximumTestScenarios: 64,
      maximumWorkloadOperations: 64,
      maximumWorkloads: 64,
    },
    progress,
    store,
  });
  return { authorization, commercial, coordinator, progress, store };
}

function issueEditBatch(
  candidate: ReturnType<typeof operationRequest>["architecture"],
  milliseconds: number,
  operationId: string,
) {
  return assistantOperationBatchV1Schema.parse({
    baseArchitectureDigest: getArchitectureDocumentCanonicalHash(candidate),
    contractVersion: 1,
    kind: "cloudmarkup.assistant-operation-batch",
    operations: [
      {
        expectedWorkloadContentHash: getWorkloadBehaviorContentHash(
          candidate.workloadBehavior,
        ),
        kind: "edit-workload",
        operationId,
        patch: {
          executionAssumptions: {
            retry: { kind: "bounded", maximumAttempts: 3 },
            timeout: { kind: "duration", milliseconds },
          },
        },
        rationale: "Use the reviewer-selected timeout.",
        workloadId: "workload_worker",
      },
    ],
  });
}

function blockingIssue() {
  const placeholder = activeIssueV1Schema.parse({
    affected: [
      {
        kind: "solution-revision",
        solutionRevisionId: testSolutionRevision.solutionRevisionId,
      },
    ],
    category: "configuration",
    closureRequirements: [],
    contractVersion: 1,
    currentRecordDigest: sha256Text("placeholder"),
    id: "assistant_issue_timeout_review",
    lifecycle: { state: "current" },
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: { id: "cloudmarkup.assistant-validator", version: "1.0.0" },
      },
      createdAt: "2026-08-22T12:04:00.000Z",
      inputDigests: [sha256Text("assistant-validation-input")],
    },
    recordVersion: 1,
    severity: "error",
    solutionRevisionId: testSolutionRevision.solutionRevisionId,
    source: "schema-graph-validation",
    sourceRecordId: "assistant.validation.timeout",
    summary: "Confirm the reviewed timeout.",
    technicalDetail: "The timeout requires explicit reviewer confirmation.",
  });
  return activeIssueV1Schema.parse({
    ...placeholder,
    currentRecordDigest: getActiveIssueRecordHash(placeholder),
  });
}
function startRequest(preference: "guided" | "professional" = "guided") {
  return {
    assistancePreference: preference,
    commercialRequest: commercialRequest(),
    createdAt,
    idempotencyKey: "assistant_workflow_idempotency",
    plannerRequest: plannerRequest(),
    requestedBy: "user_test",
    workflowId: "assistant_workflow_test",
  } as const;
}

describe("SeamlessAssistantWorkflowCoordinatorV1", () => {
  it.each(["missing-graph", "changed-graph", "empty"])(
    "rejects %s review coverage without exposing a partial candidate",
    async (kind) => {
      const test = harness();
      const execute = test.commercial.execute.bind(test.commercial);
      vi.spyOn(test.commercial, "execute").mockImplementation(
        async (...args) => {
          const result = await execute(...args);
          if (
            result.plannerResult === null ||
            result.plannerResult.disposition === "rejected"
          )
            throw Error("Expected the actual synthetic planner to complete.");
          return {
            ...result,
            plannerResult: {
              ...result.plannerResult,
              assistantOperations:
                kind === "empty"
                  ? []
                  : kind === "changed-graph"
                    ? result.plannerResult.assistantOperations.map(
                        (operation) =>
                          operation.kind === "graph-command"
                            ? {
                                ...operation,
                                command: {
                                  ...operation.command,
                                  commandId: operationIdSchema.parse(
                                    "changed_review_command",
                                  ),
                                },
                              }
                            : operation,
                      )
                    : result.plannerResult.assistantOperations.filter(
                        (operation) => operation.kind !== "graph-command",
                      ),
            },
          };
        },
      );
      const request = startRequest();
      const source = structuredClone(
        request.plannerRequest.modelRequest.architecture,
      );
      const result = await test.coordinator.start(request);
      expect(result.state).toBe("rejected");
      expect(result.review).toBeNull();
      expect(request.plannerRequest.modelRequest.architecture).toEqual(source);
      expect(test.authorization.reviewCalls).toBe(0);
    },
  );

  it("bounds the combined review without changing the planner's graph allowance", async () => {
    const test = harness(undefined, 1);
    const initial = startRequest();
    const planning = initial.plannerRequest.modelRequest.planningContext;
    const modelRequest = modelOperationProposalRequestV1Schema.parse({
      ...initial.plannerRequest.modelRequest,
      planningContext: {
        ...planning,
        assistantLimits: { ...planning?.assistantLimits, maximumOperations: 1 },
      },
    });
    const result = await test.coordinator.start({
      ...initial,
      plannerRequest: { ...initial.plannerRequest, modelRequest },
    });
    expect(test.commercial.calls).toBe(1);
    expect(result.state).toBe("rejected");
    expect(result.review).toBeNull();
    expect(test.authorization.reviewCalls).toBe(0);
  });

  it("runs the deterministic fake model through validation into one review-only workflow", async () => {
    const test = harness();
    const record = await test.coordinator.start(startRequest());

    expect(record.state).toBe("review-ready");
    expect(record.review?.writeAuthority).toBe("none");
    expect(record.review?.credit).toMatchObject({
      completedCreditUnits: 2,
      maximumEstimatedCreditUnits: 3,
      reservationId: "assistant_reservation_test",
    });
    expect(record.review?.diffs).toEqual([
      expect.objectContaining({ category: "architecture" }),
      expect.objectContaining({ category: "workload" }),
    ]);
    expect(record.progress.map(({ stage }) => stage)).toEqual([
      "queued",
      "commercial-check",
      "model-generation",
      "deterministic-validation",
      "review-ready",
    ]);
    const stored = await test.store.load(record.workflowId);
    expect(
      stored?.candidateArchitecture?.workloadBehavior.workloads[0]
        ?.executionAssumptions.timeout,
    ).toEqual({ kind: "duration", milliseconds: 45_000 });
    expect(test.commercial.calls).toBe(1);
    expect(test.progress.records.at(-1)).toEqual(record);

    const duplicate = await test.coordinator.start(startRequest());
    expect(duplicate).toEqual(record);
    expect(test.commercial.calls).toBe(1);
  });

  it("does not invoke a model when authorization, credits, or cancellation deny the request", async () => {
    const unauthorized = harness();
    unauthorized.authorization.allowed = false;
    expect((await unauthorized.coordinator.start(startRequest())).state).toBe(
      "rejected",
    );
    expect(unauthorized.commercial.calls).toBe(0);

    const forbidden = harness();
    const forbiddenRequest = startRequest();
    const forbiddenContext =
      forbiddenRequest.plannerRequest.modelRequest.planningContext;
    if (forbiddenContext === undefined) {
      throw new Error("Missing planning context fixture.");
    }
    await expect(
      forbidden.coordinator.start({
        ...forbiddenRequest,
        idempotencyKey: "assistant_forbidden_operation_key",
        plannerRequest: {
          ...forbiddenRequest.plannerRequest,
          modelRequest: modelOperationProposalRequestV1Schema.parse({
            ...forbiddenRequest.plannerRequest.modelRequest,
            planningContext: {
              ...forbiddenContext,
              allowedGraphCommandKinds: [
                ...forbiddenContext.allowedGraphCommandKinds,
                "replace-workload-and-application-contracts",
              ],
            },
          }),
        },
        workflowId: "assistant_workflow_forbidden_operation",
      }),
    ).rejects.toThrow("whole-document/unsupported operation");
    expect(forbidden.authorization.startCalls).toBe(0);
    expect(forbidden.commercial.calls).toBe(0);

    const mismatchedLimits = harness();
    const limitRequest = startRequest();
    const limitContext =
      limitRequest.plannerRequest.modelRequest.planningContext;
    if (limitContext?.assistantLimits === undefined) {
      throw new Error("Missing Assistant limit fixture.");
    }
    await expect(
      mismatchedLimits.coordinator.start({
        ...limitRequest,
        idempotencyKey: "assistant_mismatched_limits_key",
        plannerRequest: {
          ...limitRequest.plannerRequest,
          modelRequest: modelOperationProposalRequestV1Schema.parse({
            ...limitRequest.plannerRequest.modelRequest,
            planningContext: {
              ...limitContext,
              assistantLimits: {
                ...limitContext.assistantLimits,
                maximumOperations:
                  limitContext.assistantLimits.maximumOperations - 1,
              },
            },
          }),
        },
        workflowId: "assistant_workflow_mismatched_limits",
      }),
    ).rejects.toThrow("planning limits");
    expect(mismatchedLimits.authorization.startCalls).toBe(0);
    expect(mismatchedLimits.commercial.calls).toBe(0);

    const denied = harness();
    denied.commercial.denied = true;
    expect((await denied.coordinator.start(startRequest())).state).toBe(
      "rejected",
    );
    expect(denied.commercial.calls).toBe(1);

    const cancelled = harness();
    const controller = new AbortController();
    controller.abort();
    expect(
      (await cancelled.coordinator.start(startRequest(), controller.signal))
        .state,
    ).toBe("cancelled");
    expect(cancelled.commercial.calls).toBe(0);
  });

  it("revalidates reviewer edits and accepts only through verified review authority", async () => {
    const test = harness();
    const initial = await test.coordinator.start(startRequest("professional"));
    const stored = await test.store.load(initial.workflowId);
    const candidate = stored?.candidateArchitecture;
    if (
      initial.review === null ||
      candidate === undefined ||
      candidate === null
    ) {
      throw new Error("Missing reviewable candidate.");
    }
    const editRequest = {
      operationBatch: assistantOperationBatchV1Schema.parse({
        baseArchitectureDigest: getArchitectureDocumentCanonicalHash(candidate),
        contractVersion: 1,
        kind: "cloudmarkup.assistant-operation-batch",
        operations: [
          {
            expectedWorkloadContentHash: getWorkloadBehaviorContentHash(
              candidate.workloadBehavior,
            ),
            kind: "edit-workload",
            operationId: "assistant_reviewer_edit_timeout",
            patch: {
              executionAssumptions: {
                retry: { kind: "bounded", maximumAttempts: 3 },
                timeout: { kind: "duration", milliseconds: 50_000 },
              },
            },
            rationale: "Use the reviewer-selected timeout.",
            workloadId: "workload_worker",
          },
        ],
      }),
      requestedAt: "2026-08-22T12:04:00.000Z",
      requestedBy: "user_test",
      reviewDigest: digestStructuredValue(initial.review),
      reviewId: initial.review.reviewId,
      workflowId: initial.workflowId,
    };
    test.authorization.allowed = false;
    await expect(test.coordinator.edit(editRequest)).rejects.toThrow(
      "Assistant candidate edit was not authorized.",
    );
    test.authorization.allowed = true;
    const edited = await test.coordinator.edit(editRequest);
    expect(edited.state).toBe("review-ready");
    expect(edited.assistancePreference).toBe("professional");
    if (edited.review === null) throw new Error("Missing edited review.");
    expect(edited.review.createdAt).toBe("2026-08-22T12:06:00.000Z");
    expect(edited.review.editAuthorizationDecisionIds).toEqual([
      "assistant_edit_authorization_2",
    ]);
    expect(edited.authorizationDecisionIds).toEqual([
      "assistant_start_authorization",
      "assistant_edit_authorization_2",
    ]);

    const accepted = await test.coordinator.decide({
      decision: "accept",
      requestedBy: "user_test",
      reviewDigest: digestStructuredValue(edited.review),
      reviewId: edited.review.reviewId,
      workflowId: edited.workflowId,
    });
    expect(accepted.writeAuthority).toBe("none");
    expect(accepted.record.state).toBe("accepted");
    expect(
      accepted.candidateArchitecture?.workloadBehavior.workloads[0]
        ?.executionAssumptions.timeout,
    ).toEqual({ kind: "duration", milliseconds: 50_000 });
    expect(test.authorization.reviewCalls).toBe(3);
  });
  it("retains issue identity and marks a superseded edit issue stale instead of deleting it", async () => {
    let assessments = 0;
    const issue = blockingIssue();
    const test = harness(() => {
      assessments += 1;
      return Promise.resolve({
        activeIssues: assessments === 1 ? [issue] : [],
        evidenceIds: [],
      });
    });
    const initial = await test.coordinator.start(startRequest());
    const firstStored = await test.store.load(initial.workflowId);
    const firstCandidate = firstStored?.candidateArchitecture;
    if (
      initial.review === null ||
      firstCandidate === undefined ||
      firstCandidate === null
    ) {
      throw new Error("Missing first candidate.");
    }
    const first = await test.coordinator.edit({
      operationBatch: issueEditBatch(
        firstCandidate,
        46_000,
        "assistant_first_issue_edit",
      ),
      requestedAt: "2026-08-22T12:04:00.000Z",
      requestedBy: "user_test",
      reviewDigest: digestStructuredValue(initial.review),
      reviewId: initial.review.reviewId,
      workflowId: initial.workflowId,
    });
    expect(first.state).toBe("needs-user-input");
    expect(first.review?.activeIssues).toContainEqual(
      expect.objectContaining({
        id: issue.id,
        lifecycle: { state: "current" },
      }),
    );
    const secondStored = await test.store.load(first.workflowId);
    const secondCandidate = secondStored?.candidateArchitecture;
    if (
      first.review === null ||
      secondCandidate === undefined ||
      secondCandidate === null
    ) {
      throw new Error("Missing second candidate.");
    }
    const second = await test.coordinator.edit({
      operationBatch: issueEditBatch(
        secondCandidate,
        47_000,
        "assistant_second_issue_edit",
      ),
      requestedAt: "2026-08-22T12:05:00.000Z",
      requestedBy: "user_test",
      reviewDigest: digestStructuredValue(first.review),
      reviewId: first.review.reviewId,
      workflowId: first.workflowId,
    });
    expect(second.state).toBe("review-ready");
    const staleIssue = second.review?.activeIssues.find(
      ({ id }) => id === issue.id,
    );
    expect(staleIssue).toMatchObject({
      id: issue.id,
      lifecycle: { state: "stale" },
      previousRecordDigest: issue.currentRecordDigest,
      recordVersion: 2,
    });
  });
  it("rejects a stale concurrent edit instead of overwriting the first validated candidate", async () => {
    const releases: (() => void)[] = [];
    const test = harness(
      () =>
        new Promise((resolve) => {
          releases.push(() => {
            resolve({ activeIssues: [], evidenceIds: [] });
          });
        }),
    );
    const initial = await test.coordinator.start(startRequest());
    const stored = await test.store.load(initial.workflowId);
    const concurrentCandidate = stored?.candidateArchitecture;
    if (
      initial.review === null ||
      concurrentCandidate === undefined ||
      concurrentCandidate === null
    ) {
      throw new Error("Missing concurrent-edit candidate.");
    }
    const common = {
      requestedAt: "2026-08-22T12:04:00.000Z",
      requestedBy: "user_test",
      reviewDigest: digestStructuredValue(initial.review),
      reviewId: initial.review.reviewId,
      workflowId: initial.workflowId,
    } as const;
    const firstEdit = test.coordinator.edit({
      ...common,
      operationBatch: issueEditBatch(
        concurrentCandidate,
        46_000,
        "assistant_concurrent_edit_first",
      ),
    });
    const staleEdit = test.coordinator.edit({
      ...common,
      operationBatch: issueEditBatch(
        concurrentCandidate,
        47_000,
        "assistant_concurrent_edit_stale",
      ),
    });
    for (let attempt = 0; attempt < 20 && releases.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(releases).toHaveLength(2);
    releases[0]?.();
    await expect(firstEdit).resolves.toMatchObject({ state: "review-ready" });
    releases[1]?.();
    await expect(staleEdit).rejects.toThrow(
      "Assistant workflow storage authority failed.",
    );
    const current = await test.store.load(initial.workflowId);
    expect(
      current?.candidateArchitecture?.workloadBehavior.workloads[0]
        ?.executionAssumptions.timeout,
    ).toEqual({ kind: "duration", milliseconds: 46_000 });
  });
});

type PreferenceOptions = Parameters<
  typeof assessSolutionProposalPreferencesV2
>[0];

/** Synthetic model data and pricing through the real planner and coordinator.
 * The callback observes the actual active reservation; this is not live proof. */
async function withReservedPreferenceSource(
  work: (
    input: PreferenceOptions,
    accounting: InMemoryCanonicalModelCommercialAccounting,
  ) => Promise<void>,
) {
  const planning = plannerRequest();
  const generated = await planner().propose(planning);
  if (generated.disposition === "rejected")
    throw Error("Missing synthetic proposal.");
  const result = generated.modelResult;
  const descriptor = result.descriptor;
  const route: ModelCommercialRouteV1 = {
    explanation:
      "Synthetic canonical pricing for the actual fake model result.",
    inferenceProfileId: descriptor.inferenceProfileId ?? null,
    label: "Standard Design",
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    providerKey: descriptor.providerId,
    route: "standard",
    routeId: descriptor.routing?.routeId ?? "standard-design",
  };
  const scope = descriptor.scope;
  if (scope.projectId === undefined || scope.jobId === undefined)
    throw Error("Missing synthetic scope.");
  const attempt = modelUsageToCommercialAttemptV1(result.usage);
  if (attempt.usage === null) throw Error("Missing synthetic measured usage.");
  const operation = canonicalCommercialRequest({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    jobId: scope.jobId,
    feature: descriptor.feature,
    promptId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    reservationId: descriptor.budgetDecisionId,
    requestedAt: attempt.startedAt,
    expiresAt: new Date(Date.parse(attempt.completedAt) + 120000).toISOString(),
    plannedCalls: [
      {
        kind: "primary",
        minimumUsage: attempt.usage,
        maximumUsage: attempt.usage,
        routeId: route.routeId,
      },
    ],
  });
  const workflows = new InMemoryModelCommercialWorkflowStore();
  const accounting = new InMemoryCanonicalModelCommercialAccounting({
    [scope.organizationId]: 100,
  });
  const coordinator = new ModelCommercialLifecycleCoordinator({
    accounting,
    attestations: new InMemoryModelCommercialHostAttestations(),
    authorization: new InMemoryModelCommercialAuthorization(
      commercialAuthorization({
        organizationId: scope.organizationId,
        approvedRoutes: [route],
        allowedRouteIds: [route.routeId],
        allowedModelKeys: [modelKey(route)],
      }),
    ),
    now: () => attempt.completedAt,
    pricing: new InMemoryModelCommercialPricing({
      policies: [normalizationPolicy],
      pricing: [pricingFor(route, "pricing_preference_test")],
    }),
    scopeResolver: new InMemoryModelCommercialScopeResolver(),
    workflows,
  });
  let callbackError: unknown;
  let callbacks = 0;
  await coordinator.execute(operation, async () => {
    callbacks++;
    const commercialWorkflow = workflows.get(operation.multiCallWorkflowId);
    if (commercialWorkflow === null) throw Error("Missing actual reservation.");
    try {
      await work(
        {
          authorization: new AllowedAuthorization(),
          commercialWorkflow,
          proposal: {
            input: planning,
            result,
            dependencies: {
              allowedApprovalPathIds: new Set([
                "cloudmarkup.dependency-review.v1",
              ]),
              validationRules: workflowValidationRules(),
            },
          },
        },
        accounting,
      );
    } catch (error) {
      callbackError = error;
    }
    return {
      attempts: [attempt],
      completedAt: attempt.completedAt,
      failureCategory: null,
      resultId: "preference_test_result",
      status: "completed",
      usefulOutputDelivered: true,
    };
  });
  if (callbackError !== undefined)
    throw callbackError instanceof Error
      ? callbackError
      : new Error("Synthetic callback failed.");
  expect(callbacks).toBe(1);
}

describe("assessSolutionProposalPreferencesV2", () => {
  it("runs both real workflows over one completed result and the actual pending reservation", async () => {
    await withReservedPreferenceSource(async (input, accounting) => {
      const before = structuredClone({
        input: input.proposal.input,
        result: input.proposal.result,
        workflow: input.commercialWorkflow,
      });
      const assessed = await assessSolutionProposalPreferencesV2(input);
      expect(assessed.assessment.validationOutcome).toBe("passed");
      expect(assessed.measurement).toMatchObject({
        dimension: "same-ui-semantics-across-assistance-preferences",
        numerator: 1,
        denominator: 1,
        sourceAuthority: "deterministic-evaluation-v1",
      });
      expect(
        assessed.assistancePreferenceSemantics.map(
          (v) => v.assistancePreference,
        ),
      ).toEqual(["guided", "professional"]);
      expect(
        new Set(
          assessed.assistancePreferenceSemantics.map((v) => v.semanticDigest),
        ).size,
      ).toBe(1);
      for (const record of assessed.workflows) {
        expect(record.state).toBe("review-ready");
        expect(record.review?.credit).toMatchObject({
          completedCreditUnits: null,
          maximumEstimatedCreditUnits:
            input.commercialWorkflow.resolvedContext?.estimateResult.estimate
              .maximumCreditUnits,
          reservationId: input.commercialWorkflow.request.reservationId,
          state: "settlement-pending",
        });
        expect(record.review?.operationBatch.operations).toHaveLength(2);
        expect(record.review?.diffs).not.toHaveLength(0);
        expect(record.progress.map((p) => p.stage)).toEqual([
          "queued",
          "commercial-check",
          "model-generation",
          "deterministic-validation",
          "review-ready",
        ]);
      }
      expect(accounting.events).toHaveLength(1);
      expect({
        input: input.proposal.input,
        result: input.proposal.result,
        workflow: input.commercialWorkflow,
      }).toEqual(before);
    });
  });
  it.each([
    "reservation",
    "scope",
    "model",
    "rules",
    "unavailable-rules",
    "authorization",
    "withdrawn-authorization",
    "cancellation",
    "late-cancellation",
  ] as const)(
    "does not issue a preference measurement for unavailable %s authority",
    async (changed) => {
      await withReservedPreferenceSource(async (input, accounting) => {
        let candidate = input;
        if (changed === "reservation")
          candidate = {
            ...input,
            commercialWorkflow: {
              ...input.commercialWorkflow,
              response: {
                ...projectModelCommercialPendingReviewV2(
                  input.commercialWorkflow,
                ),
                state: "completed",
                completedCreditUnits: 2,
              },
            },
          };
        if (changed === "scope")
          candidate = {
            ...input,
            proposal: {
              ...input.proposal,
              input: {
                ...input.proposal.input,
                gatewayContext: {
                  ...input.proposal.input.gatewayContext,
                  scope: {
                    ...input.proposal.input.gatewayContext.scope,
                    organizationId: "different_organization",
                  },
                },
              },
            },
          };
        if (changed === "model")
          candidate = {
            ...input,
            proposal: {
              ...input.proposal,
              result: {
                ...input.proposal.result,
                descriptor: {
                  ...input.proposal.result.descriptor,
                  modelVersion: "different_model_version",
                },
              },
            },
          };
        if (changed === "rules")
          candidate = {
            ...input,
            proposal: {
              ...input.proposal,
              dependencies: {
                ...input.proposal.dependencies,
                validationRules: [],
              },
            },
          };
        if (changed === "unavailable-rules")
          candidate = {
            ...input,
            proposal: {
              ...input.proposal,
              dependencies: {
                ...input.proposal.dependencies,
                validationRules: workflowValidationRules().map((rule) =>
                  defineValidationRuleV1({
                    ...rule,
                    evaluate: () => {
                      throw Error("Synthetic unavailable validator.");
                    },
                  }),
                ),
              },
            },
          };
        if (
          changed === "withdrawn-authorization" ||
          changed === "late-cancellation"
        ) {
          const original = input.authorization;
          let starts = 0;
          const controller = new AbortController();
          candidate = {
            ...input,
            signal: controller.signal,
            authorization: {
              authorizeReview: (request) => original.authorizeReview(request),
              authorizeStart: async (request) => {
                const decision = await original.authorizeStart(request);
                starts++;
                if (changed === "late-cancellation") controller.abort();
                return { ...decision, allowed: starts === 1 };
              },
            },
          };
        }
        if (changed === "authorization") {
          const authorization = new AllowedAuthorization();
          authorization.allowed = false;
          candidate = { ...input, authorization };
        }
        if (changed === "cancellation")
          candidate = { ...input, signal: AbortSignal.abort() };
        await expect(
          assessSolutionProposalPreferencesV2(candidate),
        ).rejects.toThrow();
        expect(accounting.events).toHaveLength(1);
      });
    },
  );
});

function frozenSafetyCase(
  kind: "prompt-injection-and-secrets" | "direct-deployment-credential-request",
) {
  const entry = frozenModelEvaluationDatasetV1.cases.find(
    (value) => value.caseKind === kind,
  );
  if (entry === undefined) throw Error("Missing frozen safety case.");
  return entry;
}

describe("assessModelLiveProposalCaseV2", () => {
  it.each([
    "prompt-injection-and-secrets",
    "direct-deployment-credential-request",
  ] as const)(
    "measures a typed %s refusal with zero operations and no repair or retained body",
    async (kind) => {
      await withReservedPreferenceSource(async (input) => {
        const evaluationCase = frozenSafetyCase(kind);
        const { solutionProposal, ...envelope } =
          input.proposal.result.response;
        void solutionProposal;
        const response = modelOperationProposalResponseV1Schema.parse({
          ...envelope,
          batches: [
            {
              contractVersion: 1,
              kind: "safety-refusal",
              reasonCodes: evaluationCase.expected.requiredSafetyOutcomes,
              explanation:
                "I cannot follow instructions to expose secrets, take credential authority or deploy infrastructure.",
            },
          ],
        });
        const candidate = {
          ...input,
          proposal: {
            ...input.proposal,
            result: { ...input.proposal.result, response },
          },
        };
        const assessed = await assessModelLiveProposalCaseV2({
          ...candidate,
          evaluationCase,
        });
        expect(assessed.metadata.validatorVersion).toBe("2.1.0");
        expect(assessed.metadata.measurements.map((m) => m.numerator)).toEqual([
          1, 0, 1, 1,
        ]);
        expect(assessed.preferences.assessment.assistantOperations).toEqual([]);
        expect(assessed.preferences.assessment.assistantDiffs).toEqual([]);
        expect(assessed.preferences.assessment.candidateArchitecture).toEqual(
          input.proposal.input.modelRequest.architecture,
        );
        expect(
          assessed.preferences.workflows.every(
            (workflow) =>
              workflow.state === "rejected" && workflow.review === null,
          ),
        ).toBe(true);
        let reads = 0;
        const noRepair = new ReviewOnlySolutionProposalPlannerV1({
          ...input.proposal.dependencies,
          gateway: {
            proposeOperations: () => {
              reads++;
              return Promise.resolve(candidate.proposal.result);
            },
          },
          invalidProposalStore: {
            preserveRestricted: () =>
              Promise.reject(new Error("Refusals must not be retained.")),
          },
        });
        expect(
          await noRepair.propose({
            ...input.proposal.input,
            maximumRepairAttempts: 2,
          }),
        ).toMatchObject({
          disposition: "rejected",
          attempts: 1,
          diagnostics: [
            { code: "cloudmarkup.solution-planner.safety-refused" },
          ],
        });
        expect(reads).toBe(1);
        expect(
          modelOperationProposalResponseV1Schema.safeParse({
            ...response,
            solutionProposal,
          }).success,
        ).toBe(false);
        expect(
          modelOperationProposalResponseV1Schema.safeParse({
            ...response,
            batches: [...response.batches, ...envelope.batches],
          }).success,
        ).toBe(false);
        expect(
          modelOperationProposalResponseV1Schema.safeParse({
            ...response,
            batches: [
              { ...response.batches[0], reasonCodes: ["invented-authority"] },
            ],
          }).success,
        ).toBe(false);
        const mismatched = modelOperationProposalResponseV1Schema.parse({
          ...response,
          batches: [
            {
              ...response.batches[0],
              reasonCodes: ["no-deployment-authority"],
            },
          ],
        });
        const negative = await assessModelLiveProposalCaseV2({
          ...candidate,
          proposal: {
            ...candidate.proposal,
            result: { ...candidate.proposal.result, response: mismatched },
          },
          evaluationCase,
        });
        expect(negative.metadata.measurements[2]?.numerator).toBe(0);
      });
    },
  );

  it.each(["prompt-injection-and-secrets"] as const)(
    "measures actual %s output without manufacturing the expected rejection",
    async (kind) => {
      await withReservedPreferenceSource(async (input, accounting) => {
        const evaluationCase = frozenSafetyCase(kind);
        const { metadata, preferences } = await assessModelLiveProposalCaseV2({
          ...input,
          evaluationCase,
        });
        expect(metadata.caseDigest).toBe(evaluationCase.caseDigest);
        expect(metadata.sourceInputDigest).toBe(
          digestStructuredValue(evaluationCase.input),
        );
        expect(metadata.outputDigest).toBe(
          digestStructuredValue(input.proposal.result.response),
        );
        expect(metadata.measurements.map((value) => value.dimension)).toEqual([
          "structured-schema-validity",
          "security-policy-violations",
          "issue-clarity-correct-severity",
          "same-ui-semantics-across-assistance-preferences",
        ]);
        expect(metadata.measurements.map((value) => value.numerator)).toEqual([
          1, 0, 0, 1,
        ]);
        expect(
          preferences.workflows.every(
            (record) => record.state === "review-ready",
          ),
        ).toBe(true);
        expect(
          metadata.measurements.every(
            (value) => value.sourceAuthority === "deterministic-evaluation-v1",
          ),
        ).toBe(true);
        expect(JSON.stringify(metadata)).not.toContain(
          evaluationCase.input.requirements,
        );
        expect(JSON.stringify(metadata)).not.toContain("candidateArchitecture");
        expect(accounting.events).toHaveLength(1);
      });
    },
  );
  it.each(["error", "security-error"] as const)(
    "measures the actual %s finding and rejected workflow, including negative quality",
    async (severity) => {
      await withReservedPreferenceSource(async (input, accounting) => {
        const validationRules = workflowValidationRules().map((rule) =>
          rule.id.endsWith(".security")
            ? defineValidationRuleV1({
                ...rule,
                evaluate: () => [
                  {
                    code: createValidationFindingCode(
                      "example.case.failed-design",
                    ),
                    severity,
                    title: "Synthetic rule rejection",
                    beginnerExplanation:
                      "The actual test rule rejects the synthetic candidate.",
                    technicalExplanation:
                      "The candidate failed the declared deterministic rule.",
                    affected: [
                      {
                        kind: "document",
                        path: createValidationDocumentPath("$.nodes"),
                      },
                    ],
                    documentationReferences: [],
                  },
                ],
              })
            : rule,
        );
        const { metadata, preferences } = await assessModelLiveProposalCaseV2({
          ...input,
          evaluationCase: frozenSafetyCase(
            "direct-deployment-credential-request",
          ),
          proposal: {
            ...input.proposal,
            dependencies: { ...input.proposal.dependencies, validationRules },
          },
        });
        expect(preferences.assessment.validationOutcome).toBe("failed");
        expect(preferences.assessment.validationReport.evaluationStatus).toBe(
          "complete",
        );
        expect(accounting.events).toHaveLength(1);
        expect(metadata.measurements.map((value) => value.numerator)).toEqual([
          1,
          severity === "security-error" ? 1 : 0,
          0,
          1,
        ]);
        expect(
          preferences.workflows.map((record) => ({
            state: record.state,
            review: record.review,
          })),
        ).toEqual([
          { state: "rejected", review: null },
          { state: "rejected", review: null },
        ]);
      });
    },
  );
  it("denies unsupported case requirements and contradictory measurement metadata", async () => {
    await withReservedPreferenceSource(async (input) => {
      const evaluationCase = frozenSafetyCase("prompt-injection-and-secrets");
      const { caseDigest, ...caseBody } = evaluationCase;
      void caseDigest;
      for (const expected of [
        { ...caseBody.expected, disposition: "accept-proposal" as const },
        { ...caseBody.expected, requiredSafetyOutcomes: [] },
      ]) {
        const body = { ...caseBody, expected };
        await expect(
          assessModelLiveProposalCaseV2({
            ...input,
            evaluationCase: {
              ...body,
              caseDigest: digestModelEvaluationCaseV1(body),
            },
          }),
        ).rejects.toThrow();
      }
      const { metadata } = await assessModelLiveProposalCaseV2({
        ...input,
        evaluationCase,
      });
      const { assessmentDigest, ...body } = metadata;
      void assessmentDigest;
      const first = body.measurements[0];
      if (first === undefined) throw Error("Missing actual measurement.");
      const substituted = [
        {
          ...body,
          measurements: [
            { ...first, sourceAuthority: "synthetic-fake-v1" },
            ...body.measurements.slice(1),
          ],
        },
        {
          ...body,
          assistancePreferenceSemantics: [
            body.assistancePreferenceSemantics[0],
            body.assistancePreferenceSemantics[0],
          ],
        },
        {
          ...body,
          measurements: [
            ...body.measurements,
            { ...first, dimension: "credits" },
          ],
        },
      ];
      for (const value of substituted) {
        expect(
          modelLiveProposalCaseAssessmentV2Schema.safeParse({
            ...value,
            assessmentDigest: digestStructuredValue(value),
          }).success,
        ).toBe(false);
      }
    });
  });
  it("retains the exact assessed source when caller-owned data changes during authorization", async () => {
    await withReservedPreferenceSource(async (input) => {
      const outputDigest = digestStructuredValue(
        input.proposal.result.response,
      );
      const inputDigest = input.proposal.result.descriptor.inputDigest;
      const authorization = input.authorization;
      const assessed = await assessModelLiveProposalCaseV2({
        ...input,
        evaluationCase: frozenSafetyCase("prompt-injection-and-secrets"),
        authorization: {
          authorizeReview: (request) => authorization.authorizeReview(request),
          authorizeStart: async (request) => {
            const decision = await authorization.authorizeStart(request);
            Object.assign(input.proposal.result.response.provenance, {
              modelVersion: "changed_after_assessment_started",
            });
            Object.assign(input.proposal.result.descriptor, {
              inputDigest: digestStructuredValue("changed"),
            });
            return decision;
          },
        },
      });
      expect(assessed.metadata.inputDigest).toBe(inputDigest);
      expect(assessed.metadata.outputDigest).toBe(outputDigest);
      expect(digestStructuredValue(input.proposal.result.response)).not.toBe(
        outputDigest,
      );
    });
  });
});
