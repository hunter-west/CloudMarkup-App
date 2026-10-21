import type {
  ModelLiveRuntimeAdmissionClaimV2,
  ModelLiveRuntimeAdmissionTerminalV2,
  ModelLiveRuntimeStateSnapshotRequestV2,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveEvaluationAuthorityV1Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelRuntimeStateSnapshotV1Schema,
  sha256DigestSchema,
  type ModelLiveRuntimeAdmissionRequestV2,
  type ModelLiveRuntimeAdmissionDecisionV2,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  admissionAssert,
  admissionChecked,
  admissionJson,
  admissionRead,
  admissionScopeDigest,
  assertRuntimeRecordLifecycle,
  bindRuntimeOutbox,
  parseRuntimeOutbox,
  parseRuntimeStateRequest,
  parseRuntimeTerminalDetails,
  runtimeClaimMetadataShape,
  runtimeExecutionLeaseSchema,
  runtimeOutputMetadataSchema,
  runtimeStateRequestShape,
  type RuntimeAdmissionRecord,
  type RuntimeAdmissionScope,
} from "./model-runtime-admission-codec.js";
import {
  workflowIdSchema,
  workflowInstantSchema,
} from "./model-commercial-workflow-codec.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const liveRuntimeCapacityReservationSchema = z
  .object({
    authorityDigest: sha256DigestSchema,
    limits: modelLiveEvaluationAuthorityV1Schema.shape.limits,
    planned: z
      .object({
        cacheReadTokens: count,
        cacheWriteTokens: count,
        creditUnits: count,
        estimatedMicroUsd: count,
        inputTokens: count,
        invocations: count.min(1),
        outputTokens: count,
        totalTokens: count,
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ planned }) =>
      Number.isSafeInteger(
        planned.inputTokens +
          planned.outputTokens +
          planned.cacheReadTokens +
          planned.cacheWriteTokens,
      ) &&
      planned.totalTokens ===
        planned.inputTokens +
          planned.outputTokens +
          planned.cacheReadTokens +
          planned.cacheWriteTokens,
  );

const liveStateShape = {
  ...runtimeStateRequestShape,
  liveAuthorityReservation: liveRuntimeCapacityReservationSchema,
};
const liveStateSchema = z.object(liveStateShape).strict();
export function parseLiveRuntimeStateRequest(
  value: unknown,
  scope: RuntimeAdmissionScope,
): ModelLiveRuntimeStateSnapshotRequestV2 {
  return admissionChecked(() => {
    const parsed = liveStateSchema.parse(value);
    const { liveAuthorityReservation, ...state } = parsed;
    parseRuntimeStateRequest(state, scope);
    admissionJson(parsed);
    return { ...state, liveAuthorityReservation };
  });
}

export function assertLiveRuntimeDecision(
  request: ModelLiveRuntimeAdmissionRequestV2,
  decision: ModelLiveRuntimeAdmissionDecisionV2,
) {
  admissionAssert(
    decision.requestDigest === request.requestDigest &&
      decision.routingDecisionDigest === request.routingDecisionDigest &&
      decision.runtimePolicyDigest === request.runtimePolicyDigest &&
      decision.commercialEstimateDigest ===
        request.commercialEstimate.estimateDigest &&
      decision.evaluationAuthorityTupleDigest ===
        request.evaluationAuthorityTupleDigest &&
      decision.evaluationCaseId === request.evaluationCaseId &&
      decision.evaluationCaseDigest === request.evaluationCaseDigest &&
      decision.liveEvaluationAuthorityDigest ===
        request.liveEvaluationAuthorityDigest &&
      decision.liveEvaluationPlanDigest === request.liveEvaluationPlanDigest,
  );
}
function assertReservation(
  reservation: z.output<typeof liveRuntimeCapacityReservationSchema>,
  request: ModelLiveRuntimeAdmissionRequestV2,
) {
  admissionAssert(
    reservation.authorityDigest === request.liveEvaluationAuthorityDigest &&
      reservation.planned.creditUnits ===
        request.commercialEstimate.maximumCreditUnits &&
      reservation.planned.estimatedMicroUsd ===
        request.commercialEstimate.estimatedMicroUsd &&
      reservation.planned.outputTokens >= request.requested.outputTokens,
  );
}
export function parseLiveRuntimeTerminal(
  value: unknown,
  request: ModelLiveRuntimeAdmissionRequestV2,
  decision: ModelLiveRuntimeAdmissionDecisionV2,
): ModelLiveRuntimeAdmissionTerminalV2 {
  return admissionChecked(() => {
    const raw = z
      .object({
        admission: modelLiveRuntimeAdmissionDecisionV2Schema,
        commercial: z.unknown(),
        output: runtimeOutputMetadataSchema.nullable(),
      })
      .strict()
      .parse(value);
    assertLiveRuntimeDecision(request, decision);
    const parsed = {
      admission: raw.admission,
      ...parseRuntimeTerminalDetails(raw, request, decision),
    };
    admissionJson(parsed);
    return parsed;
  });
}
export function parseLiveRuntimeClaim(
  value: unknown,
  scope: RuntimeAdmissionScope,
): ModelLiveRuntimeAdmissionClaimV2 {
  return admissionChecked(() => {
    const raw = z
      .object({
        ...liveStateShape,
        ...runtimeClaimMetadataShape,
        admissionRequest: modelLiveRuntimeAdmissionRequestV2Schema,
        admissionDecision: modelLiveRuntimeAdmissionDecisionV2Schema,
      })
      .strict()
      .parse(value);
    const state = liveStateSchema.parse(
      Object.fromEntries(
        Object.keys(liveStateShape).map((key) => [key, Reflect.get(raw, key)]),
      ),
    );
    parseLiveRuntimeStateRequest(state, scope);
    const { admissionRequest: request, admissionDecision: decision } = raw;
    assertLiveRuntimeDecision(request, decision);
    assertReservation(raw.liveAuthorityReservation, request);
    admissionAssert(
      request.organizationId === raw.organizationId &&
        request.projectId === raw.projectId &&
        request.userId === raw.userId &&
        request.idempotencyKeyDigest === raw.idempotencyKeyDigest &&
        request.requestDigest === raw.requestDigest &&
        request.runtimePolicyDigest === raw.runtimePolicyDigest &&
        raw.acquire === (decision.outcome === "allowed") &&
        raw.leaseId === decision.authorization.concurrencyLeaseId &&
        raw.acquire === (raw.deniedTerminal === undefined) &&
        Date.parse(raw.executionLeaseExpiresAt) > Date.parse(raw.decidedAt) &&
        Date.parse(raw.executionLeaseExpiresAt) - Date.parse(raw.decidedAt) <=
          300000,
    );
    const { deniedTerminal, leaseId, ...rest } = raw;
    const parsed = {
      ...rest,
      claimOutbox: raw.claimOutbox.map((entry) =>
        bindRuntimeOutbox(parseRuntimeOutbox(entry), request, decision),
      ),
      ...(leaseId === undefined ? {} : { leaseId }),
      ...(deniedTerminal === undefined
        ? {}
        : {
            deniedTerminal: parseLiveRuntimeTerminal(
              deniedTerminal,
              request,
              decision,
            ),
          }),
    };
    admissionJson(parsed);
    return parsed;
  });
}
export interface LiveRuntimeAdmissionRecord extends RuntimeAdmissionRecord<
  ModelLiveRuntimeAdmissionRequestV2,
  ModelLiveRuntimeAdmissionDecisionV2,
  ModelLiveRuntimeAdmissionTerminalV2
> {
  readonly liveAuthorityReservation: z.output<
    typeof liveRuntimeCapacityReservationSchema
  >;
}
export function parseLiveRuntimeRecord(
  value: unknown,
  scope: RuntimeAdmissionScope,
): LiveRuntimeAdmissionRecord {
  return admissionChecked(() => {
    const raw = z
      .object({
        request: modelLiveRuntimeAdmissionRequestV2Schema,
        decision: modelLiveRuntimeAdmissionDecisionV2Schema,
        originalSnapshot: modelRuntimeStateSnapshotV1Schema,
        liveAuthorityReservation: liveRuntimeCapacityReservationSchema,
        fingerprint: sha256DigestSchema,
        tenantScopeDigest: sha256DigestSchema,
        commercialExpiresAt: workflowInstantSchema,
        concurrencyLeaseId: workflowIdSchema.nullable(),
        revision: count,
        recoveryRequired: z.boolean(),
        executionLease: runtimeExecutionLeaseSchema.nullable(),
        pending: z.unknown(),
        terminal: z.unknown(),
      })
      .strict()
      .parse(admissionRead(value));
    assertLiveRuntimeDecision(raw.request, raw.decision);
    assertReservation(raw.liveAuthorityReservation, raw.request);
    const snapshot = raw.originalSnapshot;
    admissionAssert(
      snapshot.organizationId === raw.request.organizationId &&
        snapshot.projectId === raw.request.projectId &&
        snapshot.userId === raw.request.userId &&
        snapshot.requestDigest === raw.request.requestDigest &&
        snapshot.policyDigest === raw.request.runtimePolicyDigest &&
        snapshot.liveAuthorityUsage?.authorityDigest ===
          raw.liveAuthorityReservation.authorityDigest &&
        raw.request.organizationId === scope.organizationId &&
        raw.request.projectId === scope.projectId &&
        raw.request.userId === scope.userId &&
        raw.tenantScopeDigest === admissionScopeDigest(raw.request) &&
        raw.concurrencyLeaseId ===
          (raw.decision.authorization.concurrencyLeaseId ?? null),
    );
    const parsed = {
      ...raw,
      pending:
        raw.pending === null
          ? null
          : parseLiveRuntimeTerminal(raw.pending, raw.request, raw.decision),
      terminal:
        raw.terminal === null
          ? null
          : parseLiveRuntimeTerminal(raw.terminal, raw.request, raw.decision),
    };
    assertRuntimeRecordLifecycle(parsed);
    admissionJson(parsed);
    return parsed;
  });
}
