/** Strict versioned metadata restoration. Current source, tenant and operator
 * authority remain with the closed host; parsing grants no admission. */
import { liveRuntimeCapacityReservationSchema } from "./model-live-runtime-admission-codec.js";
import type {
  ModelLiveSeedRuntimeAdmissionClaimV3,
  ModelLiveSeedRuntimeAdmissionTerminalV3,
  ModelLiveSeedRuntimeStateSnapshotRequestV3,
  ModelLiveSeedRuntimeAdmissionClaimV4,
  ModelLiveSeedRuntimeAdmissionTerminalV4,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
  modelRuntimeStateSnapshotV1Schema,
  sha256DigestSchema,
  type ModelLiveSequenceRuntimeAdmissionRequestV3,
  type ModelLiveSequenceRuntimeAdmissionDecisionV3,
  type ModelLiveSequenceRuntimeAdmissionRequestV4,
  type ModelLiveSequenceRuntimeAdmissionDecisionV4,
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

type SeedRequest =
  | ModelLiveSequenceRuntimeAdmissionRequestV3
  | ModelLiveSequenceRuntimeAdmissionRequestV4;
type SeedDecision =
  | ModelLiveSequenceRuntimeAdmissionDecisionV3
  | ModelLiveSequenceRuntimeAdmissionDecisionV4;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const liveStateShape = {
  ...runtimeStateRequestShape,
  liveAuthorityReservation: liveRuntimeCapacityReservationSchema,
};
const liveStateSchema = z.object(liveStateShape).strict();
export function parseSeedRuntimeStateRequest(
  value: unknown,
  scope: RuntimeAdmissionScope,
): ModelLiveSeedRuntimeStateSnapshotRequestV3 {
  return admissionChecked(() => {
    const parsed = liveStateSchema.parse(value);
    const { liveAuthorityReservation, ...state } = parsed;
    parseRuntimeStateRequest(state, scope);
    admissionJson(parsed);
    return { ...state, liveAuthorityReservation };
  });
}
function assertDecisionBindings(request: SeedRequest, decision: SeedDecision) {
  admissionAssert(
    request.contractVersion === decision.contractVersion &&
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
  admissionAssert(request.stageKey === "repair-1");
  for (const key of [
    "selectionId",
    "selectionDigest",
    "stageId",
    "stageKey",
    "invocationId",
    "inputBindingDigest",
    "preparedPayloadDigest",
  ] as const)
    admissionAssert(decision[key] === request[key]);
  if (request.contractVersion === 4)
    admissionAssert(
      decision.contractVersion === 4 &&
        decision.canonicalPlannedCallsDigest ===
          request.canonicalPlannedCallsDigest,
    );
}
export function assertSeedRuntimeDecision(
  request: ModelLiveSequenceRuntimeAdmissionRequestV3,
  decision: ModelLiveSequenceRuntimeAdmissionDecisionV3,
) {
  assertDecisionBindings(request, decision);
}
export function assertSeedRuntimeDecisionV4(
  request: ModelLiveSequenceRuntimeAdmissionRequestV4,
  decision: ModelLiveSequenceRuntimeAdmissionDecisionV4,
) {
  assertDecisionBindings(request, decision);
}
function assertReservation(
  reservation: z.output<typeof liveRuntimeCapacityReservationSchema>,
  request: SeedRequest,
) {
  const invocations = request.contractVersion === 4 ? 2 : 1;
  admissionAssert(
    reservation.authorityDigest === request.liveEvaluationAuthorityDigest &&
      reservation.planned.creditUnits ===
        request.commercialEstimate.maximumCreditUnits &&
      reservation.planned.estimatedMicroUsd ===
        request.commercialEstimate.estimatedMicroUsd &&
      reservation.planned.outputTokens ===
        request.requested.outputTokens * invocations &&
      reservation.planned.invocations === invocations &&
      reservation.planned.cacheReadTokens === 0 &&
      reservation.planned.cacheWriteTokens === 0,
  );
}
const terminalFields = z
  .object({
    admission: z.unknown(),
    commercial: z.unknown(),
    output: runtimeOutputMetadataSchema.nullable(),
  })
  .strict();
const claimFields = z
  .object({
    ...liveStateShape,
    ...runtimeClaimMetadataShape,
    admissionRequest: z.unknown(),
    admissionDecision: z.unknown(),
  })
  .strict();
const recordFields = z
  .object({
    request: z.unknown(),
    decision: z.unknown(),
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
  .strict();

/** Private typed readers select one real schema version. Common lifecycle,
 * scope and clock validation never converts a historical record to a successor. */
function seedRuntimeCodec<
  Request extends SeedRequest,
  Decision extends SeedDecision,
>(schemas: {
  readonly version: 3 | 4;
  readonly request: { parse(value: unknown): Request };
  readonly decision: { parse(value: unknown): Decision };
}) {
  function terminal(value: unknown, request: Request, decision: Decision) {
    return admissionChecked(() => {
      const fields = terminalFields.parse(value);
      const raw = {
        ...fields,
        admission: schemas.decision.parse(fields.admission),
      };
      admissionAssert(request.contractVersion === schemas.version);
      assertDecisionBindings(request, decision);
      const parsed = {
        admission: raw.admission,
        ...parseRuntimeTerminalDetails(raw, request, decision),
      };
      admissionJson(parsed);
      return parsed;
    });
  }
  function claim(value: unknown, scope: RuntimeAdmissionScope) {
    return admissionChecked(() => {
      const fields = claimFields.parse(value);
      const raw = {
        ...fields,
        admissionRequest: schemas.request.parse(fields.admissionRequest),
        admissionDecision: schemas.decision.parse(fields.admissionDecision),
      };
      const state = liveStateSchema.parse(
        Object.fromEntries(
          Object.keys(liveStateShape).map((key) => [
            key,
            Reflect.get(raw, key),
          ]),
        ),
      );
      parseSeedRuntimeStateRequest(state, scope);
      const { admissionRequest: request, admissionDecision: decision } = raw;
      assertDecisionBindings(request, decision);
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
          : { deniedTerminal: terminal(deniedTerminal, request, decision) }),
      };
      admissionJson(parsed);
      return parsed;
    });
  }
  function record(value: unknown, scope: RuntimeAdmissionScope) {
    return admissionChecked(() => {
      const fields = recordFields.parse(admissionRead(value));
      const raw = {
        ...fields,
        request: schemas.request.parse(fields.request),
        decision: schemas.decision.parse(fields.decision),
      };
      assertDecisionBindings(raw.request, raw.decision);
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
            : terminal(raw.pending, raw.request, raw.decision),
        terminal:
          raw.terminal === null
            ? null
            : terminal(raw.terminal, raw.request, raw.decision),
      };
      assertRuntimeRecordLifecycle(parsed);
      admissionJson(parsed);
      return parsed;
    });
  }
  return { terminal, claim, record };
}
const historical = seedRuntimeCodec({
  version: 3,
  request: modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  decision: modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
});
const sequence = seedRuntimeCodec({
  version: 4,
  request: modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  decision: modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
});
export function parseSeedRuntimeTerminal(
  value: unknown,
  request: ModelLiveSequenceRuntimeAdmissionRequestV3,
  decision: ModelLiveSequenceRuntimeAdmissionDecisionV3,
): ModelLiveSeedRuntimeAdmissionTerminalV3 {
  return historical.terminal(value, request, decision);
}
export function parseSeedRuntimeTerminalV4(
  value: unknown,
  request: ModelLiveSequenceRuntimeAdmissionRequestV4,
  decision: ModelLiveSequenceRuntimeAdmissionDecisionV4,
): ModelLiveSeedRuntimeAdmissionTerminalV4 {
  return sequence.terminal(value, request, decision);
}
export function parseSeedRuntimeClaim(
  value: unknown,
  scope: RuntimeAdmissionScope,
): ModelLiveSeedRuntimeAdmissionClaimV3 {
  return historical.claim(value, scope);
}
export function parseSeedRuntimeClaimV4(
  value: unknown,
  scope: RuntimeAdmissionScope,
): ModelLiveSeedRuntimeAdmissionClaimV4 {
  return sequence.claim(value, scope);
}
export interface SeedRuntimeAdmissionRecordV3 extends RuntimeAdmissionRecord<
  ModelLiveSequenceRuntimeAdmissionRequestV3,
  ModelLiveSequenceRuntimeAdmissionDecisionV3,
  ModelLiveSeedRuntimeAdmissionTerminalV3
> {
  readonly liveAuthorityReservation: z.output<
    typeof liveRuntimeCapacityReservationSchema
  >;
}
export interface SeedRuntimeAdmissionRecordV4 extends RuntimeAdmissionRecord<
  ModelLiveSequenceRuntimeAdmissionRequestV4,
  ModelLiveSequenceRuntimeAdmissionDecisionV4,
  ModelLiveSeedRuntimeAdmissionTerminalV4
> {
  readonly liveAuthorityReservation: z.output<
    typeof liveRuntimeCapacityReservationSchema
  >;
}
export function parseSeedRuntimeRecord(
  value: unknown,
  scope: RuntimeAdmissionScope,
): SeedRuntimeAdmissionRecordV3 {
  return historical.record(value, scope);
}
export function parseSeedRuntimeRecordV4(
  value: unknown,
  scope: RuntimeAdmissionScope,
): SeedRuntimeAdmissionRecordV4 {
  return sequence.record(value, scope);
}
