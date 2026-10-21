import {
  digestStructuredValue,
  projectModelCommercialReservationV1,
  sha256Text,
  type ModelCommercialAccountingPort,
  type ModelCommercialWorkflowRecordV1,
} from "@cloudmarkup/model-gateway";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { z } from "zod";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import {
  workflowIdSchema,
  workflowJson,
} from "./model-commercial-workflow-codec.js";
import type { RuntimeAdmissionRecord } from "./model-runtime-admission-codec.js";
import type { LiveRuntimeAdmissionRecord } from "./model-live-runtime-admission-codec.js";
import type {
  SeedRuntimeAdmissionRecordV3,
  SeedRuntimeAdmissionRecordV4,
} from "./model-live-seed-runtime-admission-codec.js";

export const MODEL_ACCOUNTING_WINDOW_MAPPING =
  "intent-extract-runtime-windows-v1";
export const MODEL_ACCOUNTING_FEATURE = "ai-assisted-operations";
export type ModelReservationInput = Parameters<
  ModelCommercialAccountingPort["reserve"]
>[0];
export const modelAccountingBindingSchema = z
  .object({
    workflowId: workflowIdSchema,
    workflowFingerprint: sha256DigestSchema,
    runtimeScopeDigest: sha256DigestSchema,
    runtimeFingerprint: sha256DigestSchema,
  })
  .strict();
export type ModelAccountingBinding = z.output<
  typeof modelAccountingBindingSchema
>;
export function accountingFail(): never {
  throw new CommercialPersistenceError(
    "access-denied",
    "Model accounting authority is unavailable or contradictory.",
  );
}
export function accountingAssert(value: boolean): asserts value {
  if (!value) accountingFail();
}
export function accountingRead(value: unknown): unknown {
  try {
    return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  } catch {
    return accountingFail();
  }
}
export function accountingNumber(value: unknown): number {
  accountingAssert(
    typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint",
  );
  const converted = Number(value);
  accountingAssert(
    Number.isSafeInteger(converted) &&
      converted >= 0 &&
      /^(0|[1-9][0-9]*)$/u.test(String(value)),
  );
  return converted;
}
export function accountingInstant(value: unknown): string {
  accountingAssert(
    typeof value === "string" && Number.isFinite(Date.parse(value)),
  );
  return new Date(value).toISOString();
}
export function modelAccountingPhysicalId(
  kind: "reservation" | "request",
  record: ModelCommercialWorkflowRecordV1,
): string {
  return `model_${kind}_${digestStructuredValue({
    kind,
    organizationId: record.request.organizationId,
    projectId: record.request.projectId,
    userId: record.request.userId,
    id:
      kind === "reservation"
        ? record.request.reservationId
        : record.request.requestId,
  }).slice(7)}`;
}
/** Complete payload equality, not a trusted event ID or a caller-supplied amount. */
export function verifyModelReservationInput(
  input: ModelReservationInput,
  workflow: ModelCommercialWorkflowRecordV1,
): ModelReservationInput {
  const expected = projectModelCommercialReservationV1(workflow);
  workflowJson(input);
  accountingAssert(
    digestStructuredValue(input) === digestStructuredValue(expected),
  );
  accountingAssert(expected.requestedCreditUnits > 0);
  return expected;
}
/** Common immutable request/estimate join after version-specific runtime parsing. */
export function verifyModelAccountingCommonBinding(
  workflow: ModelCommercialWorkflowRecordV1,
  runtime:
    | RuntimeAdmissionRecord
    | LiveRuntimeAdmissionRecord
    | SeedRuntimeAdmissionRecordV3
    | SeedRuntimeAdmissionRecordV4,
  binding: ModelAccountingBinding,
): void {
  const request = workflow.request;
  const estimate = workflow.resolvedContext?.estimateResult;
  accountingAssert(
    workflow.fingerprint === binding.workflowFingerprint &&
      request.multiCallWorkflowId === binding.workflowId &&
      runtime.fingerprint === binding.runtimeFingerprint &&
      runtime.tenantScopeDigest === binding.runtimeScopeDigest &&
      request.feature === runtime.request.operation &&
      request.organizationId === runtime.request.organizationId &&
      request.projectId === runtime.request.projectId &&
      request.userId === runtime.request.userId &&
      sha256Text(request.idempotencyKey) ===
        runtime.request.idempotencyKeyDigest &&
      request.reservationId ===
        runtime.decision.authorization.commercialReservationDecisionId &&
      request.expiresAt === runtime.commercialExpiresAt &&
      request.requestedAt === runtime.decision.decidedAt &&
      request.requestedMaximumOutputUnits ===
        runtime.request.requested.outputTokens *
          (runtime.request.contractVersion === 4 ? 2 : 1) &&
      estimate?.estimate.maximumCreditUnits ===
        runtime.request.commercialEstimate.maximumCreditUnits &&
      estimate.primaryPricingVersionId ===
        runtime.request.commercialEstimate.pricingVersionReference &&
      estimate.maximumEstimatedProviderCostMicros ===
        runtime.request.commercialEstimate.estimatedMicroUsd,
  );
}
export function verifyModelAccountingRuntime(
  workflow: ModelCommercialWorkflowRecordV1,
  runtime: RuntimeAdmissionRecord,
  binding: ModelAccountingBinding,
): void {
  accountingAssert(
    workflow.request.feature === "intent.extract" &&
      workflow.request.requestedRoute === "standard" &&
      runtime.request.executionClass === "normal",
  );
  verifyModelAccountingCommonBinding(workflow, runtime, binding);
}
