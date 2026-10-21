import {
  parseModelLiveSeedRuntimeExecutionV3,
  parseModelLiveSeedRuntimeExecutionV4,
  type ModelLiveSeedRuntimeExecutionInputV4,
  type ModelLiveSeedRuntimeExecutionInputV3,
} from "./model-live-seed-runtime-execution.js";
import type { ModelLiveSeedRuntimeAdmissionStoreV3 } from "./model-live-seed-runtime-admission.js";
import {
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
  modelRuntimeStateSnapshotV1Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import type { ModelLiveRuntimeAdmissionStoreV2 } from "./model-live-runtime-admission.js";
import {
  parseLiveRuntimeExecutionInput,
  type ModelLiveRuntimeControlExecutionInputV2,
} from "./model-live-runtime-execution-metadata.js";
import {
  assertDecisionMatches,
  plannedMaximums,
  tenantScopeDigest,
} from "./model-runtime-execution-bindings.js";
import {
  expectedRuntimeDenialReasons,
  expectedSharedStaticDenialReasons,
} from "./model-runtime-shared-controls.js";
import {
  ModelRuntimeControlError,
  orderedReasons,
} from "./model-runtime-errors.js";
import { digestStructuredValue } from "./security.js";

type LivePreparationMetadata = Omit<
  ModelLiveRuntimeControlExecutionInputV2,
  "admissionDecision"
>;
type SeedPreparationMetadata = Omit<
  ModelLiveSeedRuntimeExecutionInputV3,
  "admissionDecision"
>;
type SeedSequencePreparationMetadata = Omit<
  ModelLiveSeedRuntimeExecutionInputV4,
  "admissionDecision"
>;
interface PreparationInput<M> {
  readonly metadata: M;
  readonly store:
    | Pick<ModelLiveRuntimeAdmissionStoreV2, "inspect">
    | Pick<ModelLiveSeedRuntimeAdmissionStoreV3, "inspect">;
  readonly decisionId: string;
  readonly concurrencyLeaseId: string;
  readonly observedAt: string;
}
/** Prepare one fresh decision using the same controls as execution. The host
 * must supply authenticated plan/input/routing and canonical counted commercial
 * metadata. Only the read-only store inspection is used here; no lease, credits,
 * provider call, promotion or durable admission is created. Existing executions
 * must replay their original metadata, never be rebuilt from a new snapshot. */
export function prepareModelLiveRuntimeExecutionV2(
  input: PreparationInput<LivePreparationMetadata>,
): Promise<ModelLiveRuntimeControlExecutionInputV2> {
  return prepareRuntimeExecution(input, 2);
}
/** Strict V3 metadata preparation using the shared quota and aggregate capacity
 * calculation. The host must authenticate actual issued input before inspect;
 * this function cannot claim capacity, reserve credits, or invoke a model. */
export function prepareModelLiveSeedRuntimeExecutionV3(
  input: PreparationInput<SeedPreparationMetadata>,
): Promise<ModelLiveSeedRuntimeExecutionInputV3> {
  return prepareRuntimeExecution(input, 3);
}
/** Inspect aggregate capacity for both pre-issued slots without acquiring a
 * lease, credits or inference authority. Physical-send routing stays bounded. */
export function prepareModelLiveSeedRuntimeExecutionV4(
  input: PreparationInput<SeedSequencePreparationMetadata>,
): Promise<ModelLiveSeedRuntimeExecutionInputV4> {
  return prepareRuntimeExecution(input, 4);
}
function prepareRuntimeExecution(
  input: PreparationInput<LivePreparationMetadata>,
  version: 2,
): Promise<ModelLiveRuntimeControlExecutionInputV2>;
function prepareRuntimeExecution(
  input: PreparationInput<SeedPreparationMetadata>,
  version: 3,
): Promise<ModelLiveSeedRuntimeExecutionInputV3>;
function prepareRuntimeExecution(
  input: PreparationInput<SeedSequencePreparationMetadata>,
  version: 4,
): Promise<ModelLiveSeedRuntimeExecutionInputV4>;
async function prepareRuntimeExecution(
  input: PreparationInput<
    | LivePreparationMetadata
    | SeedPreparationMetadata
    | SeedSequencePreparationMetadata
  >,
  version: 2 | 3 | 4,
): Promise<
  | ModelLiveRuntimeControlExecutionInputV2
  | ModelLiveSeedRuntimeExecutionInputV3
  | ModelLiveSeedRuntimeExecutionInputV4
> {
  const metadata = structuredClone(input.metadata);
  const {
    admissionRequest: request,
    commercialRequest,
    plan,
    routingRequest,
  } = metadata;
  const policy = plan.definition.policy;
  const observedAt = utcTimestampSchema.parse(input.observedAt);
  const expiresAt = utcTimestampSchema.parse(commercialRequest.expiresAt);
  if (Date.parse(observedAt) >= Date.parse(expiresAt))
    throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
  const liveAuthorityReservation = {
    authorityDigest: plan.approval.approvalDigest,
    limits: plan.definition.limits,
    planned: {
      ...plannedMaximums(commercialRequest),
      creditUnits: request.commercialEstimate.maximumCreditUnits,
      estimatedMicroUsd: request.commercialEstimate.estimatedMicroUsd,
    },
  };
  const snapshot = modelRuntimeStateSnapshotV1Schema.parse(
    await input.store.inspect({
      decidedAt: observedAt,
      idempotencyKeyDigest: request.idempotencyKeyDigest,
      liveAuthorityReservation,
      organizationId: request.organizationId,
      organizationWindowSeconds:
        policy.requestWindows.organization.windowSeconds,
      projectId: request.projectId,
      requestDigest: request.requestDigest,
      runtimePolicyDigest: policy.policyDigest,
      tenantScopeDigest: tenantScopeDigest(request),
      userId: request.userId,
      userWindowSeconds: policy.requestWindows.user.windowSeconds,
    }),
  );
  if (
    snapshot.organizationId !== request.organizationId ||
    snapshot.projectId !== request.projectId ||
    snapshot.userId !== request.userId ||
    snapshot.requestDigest !== request.requestDigest ||
    snapshot.policyDigest !== policy.policyDigest ||
    snapshot.capturedAt !== observedAt ||
    snapshot.idempotencyReplay
  )
    throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
  const reasons = orderedReasons(
    new Set([
      ...expectedSharedStaticDenialReasons({ ...metadata, policy }),
      ...expectedRuntimeDenialReasons({
        liveAuthorityReservation,
        policy,
        runtimeState: snapshot,
        replayDenialReasons: [],
      }),
    ]),
  );
  const firstReason = reasons[0];
  const allowed = firstReason === undefined;
  const body = {
    accountingAuthority: "canonical-commercial-v1",
    authorization: allowed
      ? {
          commercialReservationDecisionId: commercialRequest.reservationId,
          concurrencyLeaseId: input.concurrencyLeaseId,
          entitlementDecisionId: routingRequest.plan.entitlementDecisionId,
        }
      : {},
    commercialEstimateDigest: request.commercialEstimate.estimateDigest,
    contractVersion: version,
    ...(request.contractVersion === 4
      ? {
          parentSequenceContractVersion: 3,
          canonicalPlannedCallsDigest: request.canonicalPlannedCallsDigest,
        }
      : {}),
    decisionId: input.decisionId,
    decidedAt: observedAt,
    denialReasons: reasons,
    evaluationAuthorityTupleDigest: request.evaluationAuthorityTupleDigest,
    evaluationCaseDigest: request.evaluationCaseDigest,
    evaluationCaseId: request.evaluationCaseId,
    executionClass: "live-evaluation",
    ...(allowed ? { expiresAt } : {}),
    invokeModel: allowed,
    liveEvaluationAuthorityDigest: request.liveEvaluationAuthorityDigest,
    liveEvaluationPlanDigest: request.liveEvaluationPlanDigest,
    outcome: allowed ? "allowed" : "denied",
    recordKind:
      version === 2
        ? "model-live-runtime-admission-decision"
        : "model-live-sequence-runtime-admission-decision",
    ...("stageInput" in metadata
      ? {
          selectionId: metadata.selection.selectionId,
          selectionDigest: metadata.selection.selectionDigest,
          stageId: metadata.stageInput.stageId,
          stageKey: metadata.stageInput.stageKey,
          invocationId: metadata.stageInput.invocationId,
          inputBindingDigest: metadata.stageInput.inputBindingDigest,
          preparedPayloadDigest: metadata.stageInput.preparedPayloadDigest,
        }
      : {}),
    requestDigest: request.requestDigest,
    routingDecisionDigest: request.routingDecisionDigest,
    runtimePolicyDigest: policy.policyDigest,
    ...(firstReason === undefined
      ? {}
      : {
          safeError: {
            code: firstReason,
            messageKey: "model-runtime.request-denied",
            noRawSensitiveValues: true,
          },
        }),
    writeAuthority: {
      compiler: false,
      deployment: false,
      github: false,
      payment: false,
      repository: false,
    },
  };
  if (
    version === 4 &&
    "stageInput" in metadata &&
    request.contractVersion === 4
  ) {
    const decision = modelLiveSequenceRuntimeAdmissionDecisionV4Schema.parse({
      ...body,
      decisionDigest: digestStructuredValue(body),
    });
    const result = {
      ...metadata,
      admissionRequest: request,
      admissionDecision: decision,
    };
    const parsed = parseModelLiveSeedRuntimeExecutionV4(result);
    assertDecisionMatches(decision, reasons, observedAt, {
      ...parsed,
      runtimeState: snapshot,
    });
    return result;
  }
  if (
    version === 3 &&
    "stageInput" in metadata &&
    request.contractVersion === 3
  ) {
    const decision = modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse({
      ...body,
      decisionDigest: digestStructuredValue(body),
    });
    const result = {
      ...metadata,
      admissionRequest: request,
      admissionDecision: decision,
    };
    const parsed = parseModelLiveSeedRuntimeExecutionV3(result);
    assertDecisionMatches(decision, reasons, observedAt, {
      ...parsed,
      runtimeState: snapshot,
    });
    return result;
  }
  if (
    version === 2 &&
    "inputEvidence" in metadata &&
    request.contractVersion === 2
  ) {
    const decision = modelLiveRuntimeAdmissionDecisionV2Schema.parse({
      ...body,
      decisionDigest: digestStructuredValue(body),
    });
    const result = {
      ...metadata,
      admissionRequest: request,
      admissionDecision: decision,
    };
    const parsed = parseLiveRuntimeExecutionInput(result);
    assertDecisionMatches(decision, reasons, observedAt, {
      ...parsed,
      runtimeState: snapshot,
    });
    return result;
  }
  throw new ModelRuntimeControlError("routing-authority-mismatch");
}
