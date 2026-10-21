import {
  applyAssistantOperationBatchV1,
  getActiveIssueRecordHash,
  getArchitectureDocumentCanonicalHash,
  validateActiveIssueTransitionV1,
  type AssistantOperationLimitsV1,
} from "@cloudmarkup/domain";
import {
  activeIssueV1Schema,
  actorIdSchema,
  architectureDocumentV3Schema,
  assistantOperationBatchV1Schema,
  assistantProgressEventV1Schema,
  assistantReviewIdSchema,
  assistantReviewRecordV1Schema,
  assistantWorkflowIdSchema,
  assistantWorkflowRecordV1Schema,
  serializeCanonicalJson,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ActiveIssueV1,
  type ArchitectureDocumentV3,
  type AssistantOperationBatchV1,
  type AssistantReviewRecordV1,
  type AssistantWorkflowRecordV1,
} from "@cloudmarkup/schemas";

import type { ModelCommercialOperationRequestV1 } from "./commercial-lifecycle.js";
import { digestStructuredValue, sha256Text } from "./security.js";
import type { ModelSolutionCommercialExecutionV1 } from "./solution-commercial-service.js";
import {
  normalizePlanningResponseIdentities,
  type SolutionProposalPlannerRequestV1,
  type SolutionProposalPlannerResultV1,
} from "./solution-planner.js";

export interface AssistantWorkflowStartAuthorizationRequestV1 {
  readonly organizationId: string;
  readonly projectId: string;
  readonly requestedBy: string;
  readonly solutionRevisionId: string;
  readonly workflowId: string;
  readonly workflowRequestDigest: string;
}

export interface AssistantWorkflowReviewAuthorizationRequestV1 {
  readonly action: "accept" | "edit" | "reject";
  readonly baseArchitectureDigest: string;
  readonly candidateArchitectureDigest: string;
  readonly operationBatchDigest?: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly requestedBy: string;
  readonly reviewDigest: string;
  readonly reviewId: string;
  readonly workflowId: string;
}

export interface AssistantWorkflowAuthorizationDecisionV1 {
  readonly allowed: boolean;
  readonly decisionId: string;
  readonly evaluatedAt: string;
  readonly principalId: string;
  readonly reason: string | null;
}

export interface AssistantWorkflowAuthorizationV1 {
  authorizeReview(
    request: AssistantWorkflowReviewAuthorizationRequestV1,
  ): Promise<AssistantWorkflowAuthorizationDecisionV1>;
  authorizeStart(
    request: AssistantWorkflowStartAuthorizationRequestV1,
  ): Promise<AssistantWorkflowAuthorizationDecisionV1>;
}

export interface AssistantWorkflowProgressPortV1 {
  publish(record: AssistantWorkflowRecordV1): Promise<void>;
}

export interface AssistantWorkflowCandidateValidationV1 {
  validate(input: {
    readonly candidateArchitecture: ArchitectureDocumentV3;
    readonly organizationId: string;
    readonly projectId: string;
    readonly solutionRevisionId: string;
  }): Promise<{
    readonly activeIssues: readonly ActiveIssueV1[];
    readonly evidenceIds: readonly string[];
  }>;
}

export interface StoredAssistantWorkflowV1 {
  readonly candidateArchitecture: ArchitectureDocumentV3 | null;
  readonly fingerprint: string;
  readonly record: AssistantWorkflowRecordV1;
  readonly sourceArchitecture: ArchitectureDocumentV3;
}

export interface AssistantWorkflowStoreV1 {
  claim(input: {
    readonly fingerprint: string;
    readonly initial: StoredAssistantWorkflowV1;
  }): Promise<
    | { readonly kind: "claimed"; readonly stored: StoredAssistantWorkflowV1 }
    | { readonly kind: "duplicate"; readonly stored: StoredAssistantWorkflowV1 }
    | { readonly kind: "conflict" }
  >;
  load(workflowId: string): Promise<StoredAssistantWorkflowV1 | null>;
  save(input: {
    readonly expectedFingerprint: string;
    readonly expectedRecordDigest: string;
    readonly stored: StoredAssistantWorkflowV1;
  }): Promise<void>;
}

export interface AssistantWorkflowStartRequestV1 {
  readonly assistancePreference: "guided" | "professional";
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly createdAt: string;
  readonly idempotencyKey: string;
  readonly plannerRequest: SolutionProposalPlannerRequestV1;
  readonly requestedBy: string;
  readonly workflowId: string;
}

export interface AssistantWorkflowEditRequestV1 {
  readonly operationBatch: AssistantOperationBatchV1;
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly reviewDigest: string;
  readonly reviewId: string;
  readonly workflowId: string;
}

export interface AssistantWorkflowDecisionRequestV1 {
  readonly decision: "accept" | "reject";
  readonly reason?: string;
  readonly requestedBy: string;
  readonly reviewDigest: string;
  readonly reviewId: string;
  readonly workflowId: string;
}

export interface AssistantWorkflowDecisionResultV1 {
  readonly candidateArchitecture: ArchitectureDocumentV3 | null;
  readonly record: AssistantWorkflowRecordV1;
  readonly writeAuthority: "none";
}

export interface AssistantCommercialPlanningPortV1 {
  execute(
    commercialRequest: ModelCommercialOperationRequestV1,
    plannerRequest: SolutionProposalPlannerRequestV1,
    signal?: AbortSignal,
  ): Promise<ModelSolutionCommercialExecutionV1>;
}

export interface SeamlessAssistantWorkflowDependenciesV1 {
  readonly authorization: AssistantWorkflowAuthorizationV1;
  readonly candidateValidation: AssistantWorkflowCandidateValidationV1;
  readonly clock?: { now(): Date };
  readonly commercialPlanning: AssistantCommercialPlanningPortV1;
  readonly limits: AssistantOperationLimitsV1;
  readonly progress: AssistantWorkflowProgressPortV1;
  readonly store: AssistantWorkflowStoreV1;
}

function abortRequested(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function reconcileActiveIssueAssessment(input: {
  readonly assessedAt: string;
  readonly candidateDigest: string;
  readonly current: readonly ActiveIssueV1[];
  readonly previous: readonly ActiveIssueV1[];
}): ActiveIssueV1[] {
  const current = new Map(
    input.current.map((issue) => [issue.id, activeIssueV1Schema.parse(issue)]),
  );
  if (current.size !== input.current.length) {
    throw new Error("Active Issue assessment contains duplicate identities.");
  }
  const latest: ActiveIssueV1[] = [];
  for (const previousInput of input.previous) {
    const previous = activeIssueV1Schema.parse(previousInput);
    const replacement = current.get(previous.id);
    if (replacement !== undefined) {
      if (
        replacement.currentRecordDigest !== previous.currentRecordDigest &&
        replacement.recordVersion <= previous.recordVersion
      ) {
        throw new Error(
          "Active Issue updates must retain or extend immutable history.",
        );
      }
      latest.push(replacement);
      current.delete(previous.id);
      continue;
    }
    if (previous.lifecycle.state !== "current") {
      latest.push(previous);
      continue;
    }
    const placeholder = activeIssueV1Schema.parse({
      ...previous,
      currentRecordDigest: input.candidateDigest,
      lifecycle: {
        reason:
          "A complete deterministic reassessment no longer reported this issue.",
        staleAt: input.assessedAt,
        state: "stale",
      },
      previousRecordDigest: previous.currentRecordDigest,
      provenance: {
        actor: {
          kind: "deterministic-tool",
          tool: {
            id: "cloudmarkup.assistant-workflow",
            version: "1.0.0",
          },
        },
        createdAt: input.assessedAt,
        inputDigests: [input.candidateDigest],
      },
      recordVersion: previous.recordVersion + 1,
    });
    const stale = activeIssueV1Schema.parse({
      ...placeholder,
      currentRecordDigest: getActiveIssueRecordHash(placeholder),
    });
    latest.push(
      validateActiveIssueTransitionV1(previous, stale, {
        contractVersion: 1,
        records: [],
      }),
    );
  }
  latest.push(...current.values());
  return latest.sort((left, right) => left.id.localeCompare(right.id));
}

function exactScope(input: AssistantWorkflowStartRequestV1): {
  readonly jobId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly solutionRevisionId: string;
} {
  const scope = input.plannerRequest.gatewayContext.scope;
  if (
    input.commercialRequest.jobId !== scope.jobId ||
    input.commercialRequest.organizationId !== scope.organizationId ||
    input.commercialRequest.projectId !== scope.projectId ||
    input.commercialRequest.userId !== scope.userId
  ) {
    throw new Error(
      "Commercial and assistant workflow scope must match exactly.",
    );
  }
  return {
    jobId: scope.jobId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    solutionRevisionId: input.plannerRequest.solutionRevisionId,
  };
}

function sourceArchitecture(
  plannerRequest: SolutionProposalPlannerRequestV1,
): ArchitectureDocumentV3 {
  const context = plannerRequest.modelRequest.planningContext;
  if (context === undefined) {
    throw new Error("Assistant planning requires exact deterministic context.");
  }
  return architectureDocumentV3Schema.parse(
    plannerRequest.modelRequest.architecture,
  );
}

function workflowFingerprint(input: AssistantWorkflowStartRequestV1): string {
  return digestStructuredValue({
    assistancePreference: input.assistancePreference,
    commercialRequest: input.commercialRequest,
    createdAt: input.createdAt,
    idempotencyKey: input.idempotencyKey,
    plannerRequest: input.plannerRequest,
    requestedBy: input.requestedBy,
    workflowId: input.workflowId,
  });
}

function reviewDigest(review: AssistantReviewRecordV1): string {
  return digestStructuredValue(review);
}

function progressEvent(input: {
  readonly occurredAt: string;
  readonly sequence: number;
  readonly stage: AssistantWorkflowRecordV1["progress"][number]["stage"];
  readonly summary: string;
}): AssistantWorkflowRecordV1["progress"][number] {
  return assistantProgressEventV1Schema.parse(input);
}

function operationBatchFor(
  plannerResult: Exclude<
    SolutionProposalPlannerResultV1,
    { readonly disposition: "rejected" }
  >,
  source: ArchitectureDocumentV3,
): AssistantOperationBatchV1 {
  if (plannerResult.assistantOperations.length === 0) {
    throw new Error(
      "Prompt 37 review requires at least one granular assistant operation.",
    );
  }
  return assistantOperationBatchV1Schema.parse({
    baseArchitectureDigest: getArchitectureDocumentCanonicalHash(source),
    contractVersion: 1,
    kind: "cloudmarkup.assistant-operation-batch",
    operations: plannerResult.assistantOperations,
  });
}

function creditSummary(
  execution: ModelSolutionCommercialExecutionV1,
): AssistantReviewRecordV1["credit"] {
  const estimate = execution.commercial.estimate;
  return {
    completedCreditUnits: execution.commercial.completedCreditUnits,
    maximumEstimatedCreditUnits: estimate?.maximumCreditUnits ?? null,
    minimumEstimatedCreditUnits: estimate?.minimumCreditUnits ?? null,
    reservationId: execution.commercial.reservationId,
    state: execution.commercial.state,
  };
}

function reviewFor(input: {
  readonly createdAt: string;
  readonly execution: ModelSolutionCommercialExecutionV1;
  readonly operationBatch: AssistantOperationBatchV1;
  readonly organizationId: string;
  readonly plannerResult: Exclude<
    SolutionProposalPlannerResultV1,
    { readonly disposition: "rejected" }
  >;
  readonly projectId: string;
  readonly solutionRevisionId: string;
  readonly source: ArchitectureDocumentV3;
}): AssistantReviewRecordV1 {
  const descriptor = input.plannerResult.modelResult.descriptor;
  const usage = input.plannerResult.modelResult.usage;
  const issueIds = uniqueSorted(
    input.plannerResult.activeIssues.map(({ id }) => id),
  );
  const candidateArchitectureDigest = getArchitectureDocumentCanonicalHash(
    input.plannerResult.candidateArchitecture,
  );
  const reviewId = assistantReviewIdSchema.parse(
    "assistant_review_" +
      sha256Text(
        serializeCanonicalJson({
          candidateArchitectureDigest,
          proposalDigest: input.plannerResult.proposalDigest,
          solutionRevisionId: input.solutionRevisionId,
        }),
      ).slice(7, 31),
  );
  return assistantReviewRecordV1Schema.parse({
    activeIssues: input.plannerResult.activeIssues,
    editAuthorizationDecisionIds: [],
    baseArchitectureDigest: getArchitectureDocumentCanonicalHash(input.source),
    candidateArchitectureDigest,
    contractVersion: 1,
    createdAt: input.createdAt,
    credit: creditSummary(input.execution),
    decision: { state: "pending" },
    diffs: input.plannerResult.assistantDiffs,
    evidenceIds: uniqueSorted(
      input.plannerResult.activeIssues
        .flatMap((issue) =>
          issue.closureRequirements.flatMap((requirement) =>
            "evidenceIds" in requirement ? requirement.evidenceIds : [],
          ),
        )
        .filter((id): id is string => typeof id === "string"),
    ),
    issueIds,
    modelProvenance: {
      inputDigest: descriptor.inputDigest,
      invocationId: descriptor.invocationId,
      modelId: descriptor.modelId,
      modelVersion: descriptor.modelVersion,
      outputDigest: digestStructuredValue(
        input.plannerResult.modelResult.response,
      ),
      promptDigest: descriptor.promptDigest,
      promptId: descriptor.promptTemplateId,
      promptVersion: descriptor.promptVersion,
      providerId: descriptor.providerId,
      reservationId: input.execution.commercial.reservationId,
      usageEventIds: [usage.usageRecordId],
    },
    operationBatch: input.operationBatch,
    organizationId: input.organizationId,
    projectId: input.projectId,
    reviewId,
    solutionRevisionId: input.solutionRevisionId,
    writeAuthority: "none",
  });
}

function initialRecord(input: {
  readonly assistancePreference: "guided" | "professional";
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly scope: ReturnType<typeof exactScope>;
  readonly workflowId: string;
}): AssistantWorkflowRecordV1 {
  return assistantWorkflowRecordV1Schema.parse({
    assistancePreference: input.assistancePreference,
    authorizationDecisionIds: [],
    contractVersion: 1,
    createdAt: input.createdAt,
    jobId: input.scope.jobId,
    organizationId: input.scope.organizationId,
    progress: [
      progressEvent({
        occurredAt: input.createdAt,
        sequence: 0,
        stage: "queued",
        summary: "Assistant request queued for deterministic authority checks.",
      }),
    ],
    projectId: input.scope.projectId,
    review: null,
    solutionRevisionId: input.scope.solutionRevisionId,
    state: "queued",
    updatedAt: input.createdAt,
    workflowId: assistantWorkflowIdSchema.parse(input.workflowId),
    workflowRequestDigest: input.fingerprint,
    writeAuthority: "none",
  });
}

function assertCurrentReview(input: {
  readonly record: AssistantWorkflowRecordV1;
  readonly reviewDigest: string;
  readonly reviewId: string;
}): AssistantReviewRecordV1 {
  const review = input.record.review;
  if (
    review?.reviewId !== input.reviewId ||
    reviewDigest(review) !== input.reviewDigest ||
    review.decision.state !== "pending" ||
    !["review-ready", "needs-user-input"].includes(input.record.state)
  ) {
    throw new Error(
      "Assistant review authority is missing, stale, or decided.",
    );
  }
  return review;
}

const prompt37ModelGraphCommandKinds = new Set([
  "add-edge",
  "add-node",
  "adopt-generated-resource",
  "move-node",
  "remove-edge",
  "remove-node",
  "reparent-node",
  "update-edge-configuration",
  "update-node-configuration",
]);

const prompt37ModelAssistantOperationKinds = new Set([
  "add-external-resource",
  "add-workload-operation",
  "edit-application-contract",
  "edit-external-resource",
  "edit-test-scenario",
  "edit-workload",
  "edit-workload-operation",
  "request-clarification",
  "review-repository-difference",
  "set-source-ownership",
  "upsert-ai-extension-request",
]);
export class SeamlessAssistantWorkflowCoordinatorV1 {
  readonly #authorization: AssistantWorkflowAuthorizationV1;
  readonly #candidateValidation: AssistantWorkflowCandidateValidationV1;
  readonly #clock: { now(): Date };
  readonly #commercialPlanning: AssistantCommercialPlanningPortV1;
  readonly #limits: AssistantOperationLimitsV1;
  readonly #progress: AssistantWorkflowProgressPortV1;
  readonly #store: AssistantWorkflowStoreV1;

  public constructor(dependencies: SeamlessAssistantWorkflowDependenciesV1) {
    this.#authorization = dependencies.authorization;
    this.#candidateValidation = dependencies.candidateValidation;
    this.#clock = dependencies.clock ?? { now: () => new Date() };
    this.#commercialPlanning = dependencies.commercialPlanning;
    this.#limits = dependencies.limits;
    this.#progress = dependencies.progress;
    this.#store = dependencies.store;
  }

  public async start(
    request: AssistantWorkflowStartRequestV1,
    signal?: AbortSignal,
  ): Promise<AssistantWorkflowRecordV1> {
    const scope = exactScope(request);
    const source = sourceArchitecture(request.plannerRequest);
    const planningContext = request.plannerRequest.modelRequest.planningContext;
    if (
      planningContext?.assistantLimits === undefined ||
      planningContext.allowedAssistantOperationKinds === undefined ||
      planningContext.allowedAssistantOperationKinds.some(
        (kind) => !prompt37ModelAssistantOperationKinds.has(kind),
      ) ||
      planningContext.allowedGraphCommandKinds.some(
        (kind) => !prompt37ModelGraphCommandKinds.has(kind),
      )
    ) {
      throw new Error(
        "Prompt 37 planning authority is missing or contains a whole-document/unsupported operation.",
      );
    }
    const exactLimits = {
      maximumApplicationContracts:
        planningContext.assistantLimits.maximumApplicationContracts,
      maximumEdges: planningContext.limits.maximumEdges,
      maximumExternalResources: planningContext.limits.maximumExternalResources,
      maximumNodes: planningContext.limits.maximumNodes,
      maximumOperations: planningContext.assistantLimits.maximumOperations,
      maximumSourceOwnershipDeclarations:
        planningContext.assistantLimits.maximumSourceOwnershipDeclarations,
      maximumTestScenarios:
        planningContext.assistantLimits.maximumTestScenarios,
      maximumWorkloadOperations:
        planningContext.assistantLimits.maximumWorkloadOperations,
      maximumWorkloads: planningContext.assistantLimits.maximumWorkloads,
    };
    if (
      digestStructuredValue(exactLimits) !== digestStructuredValue(this.#limits)
    ) {
      throw new Error(
        "Prompt 37 planning limits do not match trusted workflow limits.",
      );
    }
    const fingerprint = workflowFingerprint(request);
    const workflowId = assistantWorkflowIdSchema.parse(request.workflowId);
    const requestedBy = actorIdSchema.parse(request.requestedBy);
    const createdAt = utcTimestampSchema.parse(request.createdAt);
    const initial = initialRecord({
      assistancePreference: request.assistancePreference,
      createdAt,
      fingerprint,
      scope,
      workflowId,
    });
    const claim = await this.#store.claim({
      fingerprint,
      initial: {
        candidateArchitecture: null,
        fingerprint,
        record: initial,
        sourceArchitecture: source,
      },
    });
    if (claim.kind === "conflict") {
      throw new Error("Assistant workflow identity was reused with new input.");
    }
    if (claim.kind === "duplicate") return claim.stored.record;
    await this.#progress.publish(initial);
    const startAuthorization = await this.#authorization.authorizeStart({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      requestedBy,
      solutionRevisionId: scope.solutionRevisionId,
      workflowId,
      workflowRequestDigest: fingerprint,
    });
    const authorizedInitial = assistantWorkflowRecordV1Schema.parse({
      ...initial,
      authorizationDecisionIds: [
        solutionStableIdSchema.parse(startAuthorization.decisionId),
      ],
    });
    if (
      !startAuthorization.allowed ||
      startAuthorization.principalId !== requestedBy
    ) {
      return this.#finishWithoutReview({
        expectedRecord: initial,
        fingerprint,
        initial: authorizedInitial,
        source,
        stage: "rejected",
        summary:
          startAuthorization.reason ?? "Assistant request was not authorized.",
      });
    }
    if (signal?.aborted === true) {
      return this.#finishWithoutReview({
        expectedRecord: initial,
        fingerprint,
        initial: authorizedInitial,
        source,
        stage: "cancelled",
        summary: "Assistant request was cancelled before model invocation.",
      });
    }
    let record = await this.#advance({
      expectedRecord: initial,
      fingerprint,
      record: authorizedInitial,
      source,
      stage: "commercial-check",
      state: "running",
      summary: "Checking entitlement, estimate, and credit reservation.",
    });
    const execution = await this.#commercialPlanning.execute(
      request.commercialRequest,
      request.plannerRequest,
      signal,
    );
    if (abortRequested(signal)) {
      return this.#finishWithoutReview({
        fingerprint,
        initial: record,
        source,
        stage: "cancelled",
        summary: "Assistant generation was cancelled safely.",
      });
    }
    if (execution.plannerResult === null) {
      return this.#finishWithoutReview({
        fingerprint,
        initial: record,
        source,
        stage: "rejected",
        summary:
          execution.issues[0]?.code ??
          "Assistant generation stopped before a reviewable proposal.",
      });
    }
    record = await this.#advance({
      fingerprint,
      record,
      source,
      stage: "model-generation",
      state: "running",
      summary: "Model proposal received; no changes have been applied.",
    });
    if (execution.plannerResult.disposition === "rejected") {
      return this.#finishWithoutReview({
        fingerprint,
        initial: record,
        source,
        stage: "rejected",
        summary:
          execution.plannerResult.diagnostics[0]?.message ??
          "The model proposal did not pass deterministic validation.",
      });
    }
    record = await this.#advance({
      fingerprint,
      record,
      source,
      stage: "deterministic-validation",
      state: "running",
      summary: "Validated every operation and the final atomic candidate.",
    });
    const graphCommands = normalizePlanningResponseIdentities({
      request: request.plannerRequest.modelRequest,
      response: execution.plannerResult.modelResult.response,
    }).batches.flatMap((batch) =>
      batch.kind === "graph"
        ? batch.batch.commands
        : batch.kind === "assistant"
          ? batch.batch.operations.flatMap((operation) =>
              operation.kind === "graph-command" ? [operation.command] : [],
            )
          : [],
    );
    if (
      execution.plannerResult.assistantOperations.length === 0 ||
      execution.plannerResult.assistantOperations.length >
        this.#limits.maximumOperations ||
      execution.plannerResult.modelResult.response.batches.some(
        (batch) => batch.kind !== "graph" && batch.kind !== "assistant",
      ) ||
      digestStructuredValue(graphCommands) !==
        digestStructuredValue(
          execution.plannerResult.assistantOperations.flatMap((operation) =>
            operation.kind === "graph-command" ? [operation.command] : [],
          ),
        )
    ) {
      return this.#finishWithoutReview({
        fingerprint,
        initial: record,
        source,
        stage: "rejected",
        summary:
          "The complete graph proposal cannot be represented in this review.",
      });
    }
    const operationBatch = operationBatchFor(execution.plannerResult, source);
    const review = reviewFor({
      createdAt: utcTimestampSchema.parse(this.#clock.now().toISOString()),
      execution,
      operationBatch,
      organizationId: scope.organizationId,
      plannerResult: execution.plannerResult,
      projectId: scope.projectId,
      solutionRevisionId: scope.solutionRevisionId,
      source,
    });
    const terminalStage =
      execution.plannerResult.disposition === "needs-user-input"
        ? "needs-user-input"
        : "review-ready";
    return this.#save({
      candidateArchitecture: execution.plannerResult.candidateArchitecture,
      expectedRecord: record,
      fingerprint,
      record: assistantWorkflowRecordV1Schema.parse({
        ...record,
        progress: [
          ...record.progress,
          progressEvent({
            occurredAt: review.createdAt,
            sequence: record.progress.length,
            stage: terminalStage,
            summary:
              terminalStage === "needs-user-input"
                ? "Review the proposal and answer the remaining clarification."
                : "Review the validated proposal; acceptance will not deploy it.",
          }),
        ],
        review,
        state: terminalStage,
        updatedAt: review.createdAt,
      }),
      source,
    });
  }

  public async edit(
    request: AssistantWorkflowEditRequestV1,
  ): Promise<AssistantWorkflowRecordV1> {
    const stored = await this.#requireStored(request.workflowId);
    const review = assertCurrentReview({
      record: stored.record,
      reviewDigest: request.reviewDigest,
      reviewId: request.reviewId,
    });
    if (stored.candidateArchitecture === null) {
      throw new Error("Assistant candidate content is unavailable.");
    }
    const operationBatch = assistantOperationBatchV1Schema.parse(
      request.operationBatch,
    );
    if (
      operationBatch.baseArchitectureDigest !==
      getArchitectureDocumentCanonicalHash(stored.candidateArchitecture)
    ) {
      throw new Error("Assistant edit does not target the current candidate.");
    }
    const editAuthorization = await this.#authorization.authorizeReview({
      action: "edit",
      baseArchitectureDigest: review.baseArchitectureDigest,
      candidateArchitectureDigest: review.candidateArchitectureDigest,
      operationBatchDigest: digestStructuredValue(operationBatch),
      organizationId: review.organizationId,
      projectId: review.projectId,
      requestedBy: request.requestedBy,
      reviewDigest: request.reviewDigest,
      reviewId: review.reviewId,
      workflowId: stored.record.workflowId,
    });
    if (
      !editAuthorization.allowed ||
      editAuthorization.principalId !== request.requestedBy
    ) {
      throw new Error("Assistant candidate edit was not authorized.");
    }
    const createdAt = utcTimestampSchema.parse(editAuthorization.evaluatedAt);
    const editedBy = actorIdSchema.parse(editAuthorization.principalId);
    const editAuthorizationDecisionId = solutionStableIdSchema.parse(
      editAuthorization.decisionId,
    );
    const applied = applyAssistantOperationBatchV1({
      batch: operationBatch,
      document: stored.candidateArchitecture,
      limits: this.#limits,
      provenance: {
        applicationContract: {
          recordedAt: createdAt,
          recordedBy: editedBy,
          source: "designed",
          sourceReferenceIds: operationBatch.operations
            .map(({ operationId }) => operationId)
            .slice(0, 64),
        },
        workload: {
          recordedAt: createdAt,
          recordedBy: editedBy,
          source: "manual",
        },
      },
    });
    const validation = await this.#candidateValidation.validate({
      candidateArchitecture: applied.candidate,
      organizationId: stored.record.organizationId,
      projectId: stored.record.projectId,
      solutionRevisionId: stored.record.solutionRevisionId,
    });
    const activeIssues = reconcileActiveIssueAssessment({
      assessedAt: createdAt,
      candidateDigest: getArchitectureDocumentCanonicalHash(applied.candidate),
      current: validation.activeIssues,
      previous: review.activeIssues,
    });
    const nextReview = assistantReviewRecordV1Schema.parse({
      ...review,
      activeIssues,
      baseArchitectureDigest: getArchitectureDocumentCanonicalHash(
        stored.candidateArchitecture,
      ),
      candidateArchitectureDigest: getArchitectureDocumentCanonicalHash(
        applied.candidate,
      ),
      createdAt,
      decision: { state: "pending" },
      diffs: applied.diffs,
      editAuthorizationDecisionIds: [
        ...review.editAuthorizationDecisionIds,
        editAuthorizationDecisionId,
      ],
      evidenceIds: uniqueSorted(validation.evidenceIds),
      issueIds: uniqueSorted(activeIssues.map(({ id }) => id)),
      modelProvenance: null,
      operationBatch,
      reviewId: assistantReviewIdSchema.parse(
        "assistant_review_" +
          sha256Text(
            serializeCanonicalJson({
              candidate: getArchitectureDocumentCanonicalHash(
                applied.candidate,
              ),
              priorReview: review.reviewId,
              requestedAt: createdAt,
            }),
          ).slice(7, 31),
      ),
    });
    const state = activeIssues.some(
      ({ lifecycle, severity }) =>
        lifecycle.state === "current" &&
        ["security-error", "error"].includes(severity),
    )
      ? "needs-user-input"
      : "review-ready";
    return this.#save({
      candidateArchitecture: applied.candidate,
      expectedRecord: stored.record,
      fingerprint: stored.fingerprint,
      record: assistantWorkflowRecordV1Schema.parse({
        ...stored.record,
        authorizationDecisionIds: [
          ...stored.record.authorizationDecisionIds,
          editAuthorizationDecisionId,
        ],
        progress: [
          ...stored.record.progress,
          progressEvent({
            occurredAt: createdAt,
            sequence: stored.record.progress.length,
            stage: state,
            summary:
              state === "review-ready"
                ? "Edited operations were revalidated and are ready for review."
                : "Edited operations were validated; blocking issues remain.",
          }),
        ],
        review: nextReview,
        state,
        updatedAt: createdAt,
      }),
      source: stored.sourceArchitecture,
    });
  }

  public async decide(
    request: AssistantWorkflowDecisionRequestV1,
  ): Promise<AssistantWorkflowDecisionResultV1> {
    const stored = await this.#requireStored(request.workflowId);
    const review = assertCurrentReview({
      record: stored.record,
      reviewDigest: request.reviewDigest,
      reviewId: request.reviewId,
    });
    if (
      request.decision === "accept" &&
      stored.record.state !== "review-ready"
    ) {
      throw new Error("A candidate with unresolved input cannot be accepted.");
    }
    const authorization = await this.#authorization.authorizeReview({
      action: request.decision,
      baseArchitectureDigest: review.baseArchitectureDigest,
      candidateArchitectureDigest: review.candidateArchitectureDigest,
      organizationId: review.organizationId,
      projectId: review.projectId,
      requestedBy: request.requestedBy,
      reviewDigest: request.reviewDigest,
      reviewId: review.reviewId,
      workflowId: stored.record.workflowId,
    });
    if (
      !authorization.allowed ||
      authorization.principalId !== request.requestedBy
    ) {
      throw new Error("Assistant review decision was not authorized.");
    }
    const decidedAt = utcTimestampSchema.parse(authorization.evaluatedAt);
    const decidedBy = actorIdSchema.parse(authorization.principalId);
    const authorizationDecisionId = solutionStableIdSchema.parse(
      authorization.decisionId,
    );
    const decision =
      request.decision === "accept"
        ? {
            authorizationDecisionId,
            decidedAt,
            decidedBy,
            state: "accepted" as const,
          }
        : {
            authorizationDecisionId,
            decidedAt,
            decidedBy,
            reason: request.reason ?? "Reviewer rejected the candidate.",
            state: "rejected" as const,
          };
    const stage = request.decision === "accept" ? "accepted" : "rejected";
    const record = await this.#save({
      candidateArchitecture: stored.candidateArchitecture,
      expectedRecord: stored.record,
      fingerprint: stored.fingerprint,
      record: assistantWorkflowRecordV1Schema.parse({
        ...stored.record,
        authorizationDecisionIds: [
          ...stored.record.authorizationDecisionIds,
          authorizationDecisionId,
        ],
        progress: [
          ...stored.record.progress,
          progressEvent({
            occurredAt: decidedAt,
            sequence: stored.record.progress.length,
            stage,
            summary:
              request.decision === "accept"
                ? "Candidate accepted for an explicit downstream design mutation."
                : "Candidate rejected; no canonical design was changed.",
          }),
        ],
        review: assistantReviewRecordV1Schema.parse({ ...review, decision }),
        state: stage,
        updatedAt: decidedAt,
      }),
      source: stored.sourceArchitecture,
    });
    return {
      candidateArchitecture:
        request.decision === "accept" ? stored.candidateArchitecture : null,
      record,
      writeAuthority: "none",
    };
  }

  async #advance(input: {
    readonly expectedRecord?: AssistantWorkflowRecordV1;
    readonly fingerprint: string;
    readonly record: AssistantWorkflowRecordV1;
    readonly source: ArchitectureDocumentV3;
    readonly stage: AssistantWorkflowRecordV1["progress"][number]["stage"];
    readonly state: AssistantWorkflowRecordV1["state"];
    readonly summary: string;
  }): Promise<AssistantWorkflowRecordV1> {
    const occurredAt = utcTimestampSchema.parse(
      this.#clock.now().toISOString(),
    );
    return this.#save({
      candidateArchitecture: null,
      expectedRecord: input.expectedRecord ?? input.record,
      fingerprint: input.fingerprint,
      record: assistantWorkflowRecordV1Schema.parse({
        ...input.record,
        progress: [
          ...input.record.progress,
          progressEvent({
            occurredAt,
            sequence: input.record.progress.length,
            stage: input.stage,
            summary: input.summary,
          }),
        ],
        state: input.state,
        updatedAt: occurredAt,
      }),
      source: input.source,
    });
  }

  async #finishWithoutReview(input: {
    readonly expectedRecord?: AssistantWorkflowRecordV1;
    readonly fingerprint: string;
    readonly initial: AssistantWorkflowRecordV1;
    readonly source: ArchitectureDocumentV3;
    readonly stage: "cancelled" | "rejected";
    readonly summary: string;
  }): Promise<AssistantWorkflowRecordV1> {
    const occurredAt = utcTimestampSchema.parse(
      this.#clock.now().toISOString(),
    );
    return this.#save({
      candidateArchitecture: null,
      expectedRecord: input.expectedRecord ?? input.initial,
      fingerprint: input.fingerprint,
      record: assistantWorkflowRecordV1Schema.parse({
        ...input.initial,
        progress: [
          ...input.initial.progress,
          progressEvent({
            occurredAt,
            sequence: input.initial.progress.length,
            stage: input.stage,
            summary: input.summary,
          }),
        ],
        state: input.stage,
        updatedAt: occurredAt,
      }),
      source: input.source,
    });
  }

  async #requireStored(workflowId: string): Promise<StoredAssistantWorkflowV1> {
    const parsedWorkflowId = assistantWorkflowIdSchema.parse(workflowId);
    const stored = await this.#store.load(parsedWorkflowId);
    if (stored === null) throw new Error("Assistant workflow was not found.");
    return stored;
  }

  async #save(input: {
    readonly candidateArchitecture: ArchitectureDocumentV3 | null;
    readonly expectedRecord: AssistantWorkflowRecordV1;
    readonly fingerprint: string;
    readonly record: AssistantWorkflowRecordV1;
    readonly source: ArchitectureDocumentV3;
  }): Promise<AssistantWorkflowRecordV1> {
    const stored = {
      candidateArchitecture: input.candidateArchitecture,
      fingerprint: input.fingerprint,
      record: assistantWorkflowRecordV1Schema.parse(input.record),
      sourceArchitecture: input.source,
    } satisfies StoredAssistantWorkflowV1;
    await this.#store.save({
      expectedFingerprint: input.fingerprint,
      expectedRecordDigest: digestStructuredValue(input.expectedRecord),
      stored,
    });
    await this.#progress.publish(stored.record);
    return stored.record;
  }
}

export class InMemoryAssistantWorkflowStoreV1 implements AssistantWorkflowStoreV1 {
  readonly #records = new Map<string, StoredAssistantWorkflowV1>();

  public claim(input: {
    readonly fingerprint: string;
    readonly initial: StoredAssistantWorkflowV1;
  }): Promise<
    | { readonly kind: "claimed"; readonly stored: StoredAssistantWorkflowV1 }
    | { readonly kind: "duplicate"; readonly stored: StoredAssistantWorkflowV1 }
    | { readonly kind: "conflict" }
  > {
    const workflowId = input.initial.record.workflowId;
    const existing = this.#records.get(workflowId);
    if (existing !== undefined) {
      return Promise.resolve(
        existing.fingerprint === input.fingerprint
          ? { kind: "duplicate", stored: structuredClone(existing) }
          : { kind: "conflict" },
      );
    }
    const stored = structuredClone(input.initial);
    this.#records.set(workflowId, stored);
    return Promise.resolve({
      kind: "claimed",
      stored: structuredClone(stored),
    });
  }

  public load(workflowId: string): Promise<StoredAssistantWorkflowV1 | null> {
    const stored = this.#records.get(workflowId);
    return Promise.resolve(
      stored === undefined ? null : structuredClone(stored),
    );
  }

  public save(input: {
    readonly expectedFingerprint: string;
    readonly expectedRecordDigest: string;
    readonly stored: StoredAssistantWorkflowV1;
  }): Promise<void> {
    const existing = this.#records.get(input.stored.record.workflowId);
    if (
      existing?.fingerprint !== input.expectedFingerprint ||
      input.stored.fingerprint !== input.expectedFingerprint ||
      digestStructuredValue(existing.record) !== input.expectedRecordDigest
    ) {
      return Promise.reject(
        new Error("Assistant workflow storage authority failed."),
      );
    }
    this.#records.set(
      input.stored.record.workflowId,
      structuredClone(input.stored),
    );
    return Promise.resolve();
  }
}

export class CollectingAssistantWorkflowProgressV1 implements AssistantWorkflowProgressPortV1 {
  public readonly records: AssistantWorkflowRecordV1[] = [];

  public publish(record: AssistantWorkflowRecordV1): Promise<void> {
    this.records.push(assistantWorkflowRecordV1Schema.parse(record));
    return Promise.resolve();
  }
}
