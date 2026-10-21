import type {
  ModelCommercialVerifiedScopeV1,
  ModelLiveSeedRuntimeExecutionInputV4,
} from "@cloudmarkup/model-gateway";
import { modelLiveSequenceDispatchV4Schema } from "@cloudmarkup/schemas";
import {
  modelPlatformReservationInputSchema,
  modelPlatformReservationReceiptSchema,
  type ModelPlatformReservationInput,
  type ModelPlatformReservationReceipt,
} from "../model-platform-spend.js";
import { accountingRead } from "./model-commercial-accounting-codec.js";
import type { ModelSeedAccountingBinding } from "./model-live-seed-commercial-accounting-codec.js";
import type { prepareModelLiveRepairSuccessorStageInputV4 } from "./model-live-repair-successor-stage-input-codec.js";
import { parseModelLiveRepairSuccessorInputRowV4 } from "./model-live-repair-successor-input-store.js";
import { readSeedDispatchCanonicalV4 } from "./model-live-seed-dispatch-store.js";
import { firstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-store.js";
import { firstSeedCandidateValidationV4 } from "./model-live-seed-candidate-store.js";
import { requireActualRepairPlatformReservation } from "./model-live-repair-platform-reservation-store.js";
import { prepareFinalRepairDispatchV4 } from "./model-live-repair-successor-dispatch-binding.js";
import {
  requireSequenceAuthority as requireAuthority,
  sameSequenceMetadata as same,
} from "./model-live-sequence-authority-codec.js";
import { sql, type SqlExecutor } from "./sql.js";
const hex = (value: string) => value.slice(7);

/** Private transactional storage. The current authenticated journal must own
 * retained RAM, load current configuration and repeat authorization before commit.
 * This stores immutable metadata only and cannot call a provider. */
export async function recordFinalRepairDispatchV4(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  readonly accounting: ModelSeedAccountingBinding;
  readonly prepared: ReturnType<
    typeof prepareModelLiveRepairSuccessorStageInputV4
  >;
  readonly platformClaim: ModelPlatformReservationInput;
  readonly platformReceipt: ModelPlatformReservationReceipt;
  readonly now: string;
}) {
  const { tx, scope, execution, accounting, prepared } = input;
  const claim = modelPlatformReservationInputSchema.parse(input.platformClaim);
  const receipt = modelPlatformReservationReceiptSchema.parse(
    input.platformReceipt,
  );
  requireAuthority(
    same(prepared.plan, execution.plan) &&
      same(prepared.selection, execution.selection),
  );
  const keys = [
    scope.organizationId,
    scope.projectId,
    scope.userId,
    prepared.stage.stageId,
  ];
  const source = (
    await tx.query(
      sql(
        "SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS issued_at_text FROM model_live_repair_successor_inputs_v4 WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4 FOR SHARE",
        keys,
      ),
    )
  ).rows[0];
  requireAuthority(source !== undefined);
  const stage = parseModelLiveRepairSuccessorInputRowV4(
    source,
    prepared,
    input.now,
  );
  const workflow = await readSeedDispatchCanonicalV4({
    tx,
    scope,
    execution,
    accounting,
    requireActive: true,
  });
  const known = await firstSeedUsageObservationV4({
    tx,
    scope,
    execution,
    accounting,
    now: input.now,
    operation: { kind: "recover" },
  });
  const candidate = await firstSeedCandidateValidationV4({
    tx,
    scope,
    execution,
    accounting,
    now: input.now,
    operation: { kind: "recover" },
  });
  requireAuthority(known.kind !== "missing" && candidate.kind !== "missing");
  const descriptor = prepared.invocation.descriptor;
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
        "SELECT * FROM model_live_repair_successor_dispatches_v4 WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4 FOR UPDATE",
        keys,
      ),
    )
  ).rows[0];
  const project = (dispatchedAt: string) =>
    prepareFinalRepairDispatchV4({
      execution,
      descriptor,
      workflow,
      stage,
      preparedPayloadDigest: prepared.invocationDigest,
      predecessorObservation: known.observation,
      predecessorReceipt: candidate.receipt,
      platformClaim: claim,
      platformReceipt: receipt,
      dispatchedAt,
    });
  if (existing !== undefined) {
    const record = modelLiveSequenceDispatchV4Schema.parse(
      accountingRead(existing["dispatch_record"]),
    );
    requireAuthority(
      same(record, project(record.dispatchedAt)) &&
        same(accountingRead(existing["descriptor"]), descriptor) &&
        existing["dispatch_sha256"] === hex(record.dispatchDigest) &&
        existing["invocation_id"] === stage.invocationId &&
        existing["workflow_scope_sha256"] === hex(scope.tenantScopeDigest) &&
        existing["workflow_id"] === accounting.workflowId &&
        existing["runtime_scope_sha256"] ===
          hex(accounting.runtimeScopeDigest) &&
        existing["platform_dispatch_id"] === receipt.dispatchId,
    );
    return { kind: "duplicate" as const };
  }
  const record = project(input.now);
  const inserted = await tx.query(
    sql(
      "INSERT INTO model_live_repair_successor_dispatches_v4(organization_id,project_id,principal_id,stage_id,invocation_id,workflow_scope_sha256,workflow_id,runtime_scope_sha256,platform_dispatch_id,descriptor,dispatch_record,dispatch_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)",
      [
        ...keys,
        stage.invocationId,
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
