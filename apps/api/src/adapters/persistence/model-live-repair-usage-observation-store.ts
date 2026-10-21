import {
  digestStructuredValue as digest,
  type ModelCommercialVerifiedScopeV1,
  type ModelLiveSeedRuntimeExecutionInputV4,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceDispatchV4Schema,
  normalizedModelUsageV1Schema,
  modelLiveSequenceAttemptObservationV4Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  type ModelLiveSequenceInputV3,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import { modelPlatformReservationReceiptSchema } from "../model-platform-spend.js";
import { accountingRead } from "./model-commercial-accounting-codec.js";
import type { ModelSeedAccountingBinding } from "./model-live-seed-commercial-accounting-codec.js";
import { readSeedDispatchCanonicalV4 } from "./model-live-seed-dispatch-store.js";
import { prepareFinalRepairUsageObservationV4 } from "./model-live-repair-successor-usage-binding.js";
import { prepareFirstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-binding.js";
import {
  requireSequenceAuthority as requireAuthority,
  sameSequenceMetadata as same,
} from "./model-live-sequence-authority-codec.js";
import { sql, type SqlExecutor } from "./sql.js";

const hex = (value: string) => value.slice(7);
/** Actual known usage under the original authenticated tenant. Current approval
 * and a live execution lease are deliberately not required for financial truth.
 * This function cannot dispatch, accept output, settle, or reconstruct content. */
export async function repairUsageObservationV4(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  readonly accounting: ModelSeedAccountingBinding;
  readonly now: string;
  readonly successor?: {
    readonly stage: ModelLiveSequenceInputV3;
    readonly predecessor: Parameters<
      typeof prepareFinalRepairUsageObservationV4
    >[0]["predecessor"];
  };
  readonly operation:
    | { readonly kind: "record"; readonly usage: NormalizedModelUsageV1 }
    | { readonly kind: "recover" };
}) {
  const { tx, scope, execution, accounting, operation, successor } = input;
  const stage = successor?.stage ?? execution.stageInput;
  const dispatchTable = successor
    ? "model_live_repair_successor_dispatches_v4"
    : "model_live_sequence_dispatches";
  const observationTable = successor
    ? "model_live_repair_successor_observations_v4"
    : "model_live_sequence_observations";
  const workflow = await readSeedDispatchCanonicalV4({
    ...input,
    requireActive: false,
  });
  const keys = [
    scope.organizationId,
    scope.projectId,
    scope.userId,
    stage.stageId,
  ];
  const row = (
    await tx.query(
      sql(
        `SELECT d.*,p.claim_sha256,p.month_utc,
    to_char(p.reserved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS reserved_at_text,
    to_char(p.dispatch_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS dispatch_before_text
    FROM ${dispatchTable} d JOIN model_platform_spend_reservations p ON p.dispatch_id=d.platform_dispatch_id
    AND p.organization_id=d.organization_id AND p.project_id=d.project_id AND p.principal_id=d.principal_id AND p.invocation_id=d.invocation_id
    WHERE d.organization_id=$1 AND d.project_id=$2 AND d.principal_id=$3 AND d.stage_id=$4 FOR SHARE OF d,p`,
        keys,
      ),
    )
  ).rows[0];
  if (row === undefined) {
    requireAuthority(operation.kind === "recover");
    return { kind: "missing" as const };
  }
  const descriptor = (
    successor
      ? modelLiveRepairSuccessorInvocationDescriptorV4Schema
      : modelLiveSeedInvocationDescriptorV3Schema
  ).parse(accountingRead(row["descriptor"]));
  const dispatch = modelLiveSequenceDispatchV4Schema.parse(
    accountingRead(row["dispatch_record"]),
  );
  const receipt = modelPlatformReservationReceiptSchema.parse({
    kind: "reserved",
    dispatchId: row["platform_dispatch_id"],
    claimDigest: "sha256:" + String(row["claim_sha256"]),
    monthUtc: row["month_utc"],
    reservedAt: row["reserved_at_text"],
    dispatchBefore: row["dispatch_before_text"],
  });
  requireAuthority(
    row["dispatch_sha256"] === hex(dispatch.dispatchDigest) &&
      row["invocation_id"] === stage.invocationId &&
      row["workflow_scope_sha256"] === hex(scope.tenantScopeDigest) &&
      row["workflow_id"] === accounting.workflowId &&
      row["runtime_scope_sha256"] === hex(accounting.runtimeScopeDigest) &&
      dispatch.runtimeRequestDigest ===
        execution.admissionRequest.requestDigest &&
      dispatch.platformReservationDigest === digest(receipt) &&
      same(descriptor.scope, {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
        jobId: execution.commercialRequest.jobId,
      }),
  );
  const project = (usage: NormalizedModelUsageV1, observedAt: string) => {
    const args = { stage, dispatch, workflow, usage, observedAt };
    if (successor !== undefined && descriptor.contractVersion === 4)
      return prepareFinalRepairUsageObservationV4({
        ...args,
        descriptor,
        predecessor: successor.predecessor,
      });
    requireAuthority(
      successor === undefined && descriptor.contractVersion === 3,
    );
    return prepareFirstSeedUsageObservationV4({ ...args, descriptor });
  };
  const existing = (
    await tx.query(
      sql(
        `SELECT * FROM ${observationTable} WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4 FOR UPDATE`,
        keys,
      ),
    )
  ).rows[0];
  if (existing !== undefined) {
    const observation = modelLiveSequenceAttemptObservationV4Schema.parse(
      accountingRead(existing["observation_record"]),
    );
    const restored = project(
      operation.kind === "record"
        ? operation.usage
        : normalizedModelUsageV1Schema.parse(
            accountingRead(existing["normalized_usage"]),
          ),
      observation.observedAt,
    );
    requireAuthority(
      same(restored.observation, observation) &&
        same(restored.usage, accountingRead(existing["normalized_usage"])) &&
        same(restored.attempt, accountingRead(existing["canonical_attempt"])) &&
        existing["observation_sha256"] === hex(observation.observationDigest) &&
        existing["invocation_id"] === stage.invocationId &&
        existing["usage_record_id"] === restored.usage.usageRecordId &&
        Date.parse(observation.observedAt) <= Date.parse(input.now),
    );
    return {
      kind:
        operation.kind === "record"
          ? ("replayed" as const)
          : ("found" as const),
      ...restored,
    };
  }
  if (operation.kind === "recover") return { kind: "missing" as const };
  const data = project(operation.usage, input.now);
  const inserted = await tx.query(
    sql(
      `INSERT INTO ${observationTable}(organization_id,project_id,principal_id,stage_id,invocation_id,usage_record_id,normalized_usage,canonical_attempt,observation_record,observation_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
      [
        ...keys,
        data.usage.invocationId,
        data.usage.usageRecordId,
        JSON.stringify(data.usage),
        JSON.stringify(data.attempt),
        JSON.stringify(data.observation),
        hex(data.observation.observationDigest),
      ],
    ),
  );
  requireAuthority(inserted.rowCount === 1);
  return { kind: "recorded" as const, ...data };
}
