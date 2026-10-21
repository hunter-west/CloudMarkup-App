import { requireActualRepairPlatformReservation } from "./model-live-repair-platform-reservation-store.js";
import {
  digestStructuredValue as digest,
  type ModelLiveSeedRuntimeExecutionInputV4,
  type ModelCommercialVerifiedScopeV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceDispatchV4Schema,
  type ModelLiveSeedInvocationDescriptorV3,
} from "@cloudmarkup/schemas";
import {
  modelPlatformReservationInputSchema,
  modelPlatformReservationReceiptSchema,
  type ModelPlatformReservationInput,
  type ModelPlatformReservationReceipt,
} from "../model-platform-spend.js";
import { accountingRead } from "./model-commercial-accounting-codec.js";
import { parseWorkflowRecord } from "./model-commercial-workflow-codec.js";
import { parseSeedRuntimeRecordV4 } from "./model-live-seed-runtime-admission-codec.js";
import {
  MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
  verifyModelSeedSequenceAccountingRuntimeV4,
  type ModelSeedAccountingBinding,
} from "./model-live-seed-commercial-accounting-codec.js";
import {
  requireSequenceAuthority as requireAuthority,
  sameSequenceMetadata as same,
} from "./model-live-sequence-authority-codec.js";
import { prepareFirstSeedDispatchV4 } from "./model-live-seed-dispatch-binding.js";
import { sql, type SqlExecutor } from "./sql.js";

const hex = (value: string) => value.slice(7);
/** Private persistence implementation. Only the authenticated sequence factory
 * supplies this transaction after loading the exact issued source and checking
 * current authority. No provider operation or raw source/output is stored. */
export async function recordFirstSeedDispatchV4(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  readonly accounting: ModelSeedAccountingBinding;
  readonly descriptor: ModelLiveSeedInvocationDescriptorV3;
  readonly platformClaim: ModelPlatformReservationInput;
  readonly platformReceipt: ModelPlatformReservationReceipt;
  readonly now: string;
}) {
  const { tx, scope, execution, accounting, descriptor } = input;
  const claim = modelPlatformReservationInputSchema.parse(input.platformClaim);
  const receipt = modelPlatformReservationReceiptSchema.parse(
    input.platformReceipt,
  );
  const keys = [scope.organizationId, scope.projectId, scope.userId];
  const workflow = await readSeedDispatchCanonicalV4({
    ...input,
    requireActive: true,
  });
  await requireActualRepairPlatformReservation({
    tx,
    scope,
    descriptorScope: descriptor.scope,
    claim,
    receipt,
  });
  const existing = (
    await tx.query(
      sql(
        "SELECT * FROM model_live_sequence_dispatches WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4 FOR UPDATE",
        [...keys, execution.stageInput.stageId],
      ),
    )
  ).rows[0];
  if (existing !== undefined) {
    const record = modelLiveSequenceDispatchV4Schema.parse(
      accountingRead(existing["dispatch_record"]),
    );
    const expected = prepareFirstSeedDispatchV4({
      execution,
      descriptor,
      workflow,
      platformClaim: claim,
      platformReceipt: receipt,
      preparedPayloadDigest: execution.stageInput.preparedPayloadDigest,
      dispatchedAt: record.dispatchedAt,
    });
    requireAuthority(
      same(record, expected) &&
        same(accountingRead(existing["descriptor"]), descriptor) &&
        existing["dispatch_sha256"] === hex(record.dispatchDigest) &&
        existing["invocation_id"] === execution.stageInput.invocationId &&
        existing["workflow_scope_sha256"] === hex(scope.tenantScopeDigest) &&
        existing["workflow_id"] === accounting.workflowId &&
        existing["runtime_scope_sha256"] ===
          hex(accounting.runtimeScopeDigest) &&
        existing["platform_dispatch_id"] === receipt.dispatchId,
    );
    return { kind: "duplicate" as const };
  }
  const record = prepareFirstSeedDispatchV4({
    execution,
    descriptor,
    workflow,
    platformClaim: claim,
    platformReceipt: receipt,
    preparedPayloadDigest: execution.stageInput.preparedPayloadDigest,
    dispatchedAt: input.now,
  });
  const inserted = await tx.query(
    sql(
      `INSERT INTO model_live_sequence_dispatches(organization_id,project_id,principal_id,stage_id,invocation_id,workflow_scope_sha256,workflow_id,runtime_scope_sha256,platform_dispatch_id,descriptor,dispatch_record,dispatch_sha256)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
      [
        ...keys,
        record.stageId,
        record.invocationId,
        hex(scope.tenantScopeDigest),
        accounting.workflowId,
        hex(accounting.runtimeScopeDigest),
        receipt.dispatchId,
        JSON.stringify(descriptor),
        JSON.stringify(record),
        hex(record.dispatchDigest),
      ],
    ),
  );
  requireAuthority(inserted.rowCount === 1);
  return { kind: "recorded" as const, record };
}

/** Shared actual canonical-row reader. Recovery records financial metadata
 * under original tenant authorization without granting a fresh dispatch. */
export async function readSeedDispatchCanonicalV4(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  readonly accounting: ModelSeedAccountingBinding;
  readonly requireActive: boolean;
}) {
  const { tx, scope, execution, accounting } = input;
  const keys = [scope.organizationId, scope.projectId, scope.userId];
  const workflowRow = (
    await tx.query(
      sql(
        "SELECT snapshot,snapshot_sha256,lease_expires_at>clock_timestamp() AS active FROM model_commercial_workflows WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND scope_sha256=$4 AND workflow_id=$5 FOR SHARE",
        [
          ...keys,
          hex(scope.tenantScopeDigest),
          execution.commercialRequest.multiCallWorkflowId,
        ],
      ),
    )
  ).rows[0];
  const runtimeRow = (
    await tx.query(
      sql(
        "SELECT snapshot,snapshot_sha256,lease_expires_at>clock_timestamp() AS active FROM model_runtime_admissions WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND scope_sha256=$4 FOR SHARE",
        [...keys, hex(accounting.runtimeScopeDigest)],
      ),
    )
  ).rows[0];
  requireAuthority(workflowRow !== undefined && runtimeRow !== undefined);
  const workflow = parseWorkflowRecord(
    accountingRead(workflowRow["snapshot"]),
    scope,
  );
  const runtime = parseSeedRuntimeRecordV4(
    accountingRead(runtimeRow["snapshot"]),
    scope,
  );
  verifyModelSeedSequenceAccountingRuntimeV4(
    workflow,
    runtime,
    accounting,
    execution.plan,
    execution.selection,
    execution.stageInput,
  );
  requireAuthority(
    workflowRow["snapshot_sha256"] === hex(digest(workflow)) &&
      runtimeRow["snapshot_sha256"] === hex(digest(runtime)) &&
      same(workflow.request, execution.commercialRequest) &&
      same(runtime.request, execution.admissionRequest) &&
      workflow.reservationReceipt?.result.accepted === true &&
      workflow.dispatchIntent !== null,
  );
  const decision = (
    await tx.query(
      sql(
        "SELECT live_binding,live_binding_sha256,accepted,runtime_scope_sha256 FROM model_commercial_reservation_decisions WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND scope_sha256=$4 AND workflow_id=$5 AND mapping_version=$6 FOR SHARE",
        [
          ...keys,
          hex(scope.tenantScopeDigest),
          accounting.workflowId,
          MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
        ],
      ),
    )
  ).rows[0];
  requireAuthority(
    decision !== undefined &&
      same(accountingRead(decision["live_binding"]), accounting) &&
      decision["live_binding_sha256"] === hex(digest(accounting)) &&
      decision["runtime_scope_sha256"] === hex(accounting.runtimeScopeDigest) &&
      decision["accepted"] === true,
  );
  if (input.requireActive)
    requireAuthority(
      workflowRow["active"] === true &&
        runtimeRow["active"] === true &&
        runtime.executionLease?.recoveryOnly === false &&
        !runtime.recoveryRequired &&
        runtime.terminal === null &&
        workflow.invocationReceipt === null,
    );
  return workflow;
}
