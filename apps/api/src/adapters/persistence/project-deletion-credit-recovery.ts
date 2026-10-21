import {
  digestModelCommercialVerifiedScopeV1,
  digestStructuredValue,
  type ModelCommercialVerifiedScopeV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveEvaluationPlanV2Schema,
  modelLiveSequencePlanV3Schema,
} from "@cloudmarkup/schemas";
import {
  PostgresModelCommercialAccountingEngine,
  type ModelAccountingTransactionPort,
} from "./model-commercial-accounting-engine.js";
import {
  MODEL_ACCOUNTING_WINDOW_MAPPING,
  modelAccountingBindingSchema,
  verifyModelAccountingRuntime,
  verifyModelAccountingCommonBinding,
  accountingRead,
  accountingAssert,
} from "./model-commercial-accounting-codec.js";
import {
  parseRuntimeRecord,
  type RuntimeAdmissionRecord,
} from "./model-runtime-admission-codec.js";
import {
  parseLiveRuntimeRecord,
  type LiveRuntimeAdmissionRecord,
} from "./model-live-runtime-admission-codec.js";
import {
  parseSeedRuntimeRecordV4,
  type SeedRuntimeAdmissionRecordV4,
} from "./model-live-seed-runtime-admission-codec.js";
import {
  modelLiveAccountingBindingSchema,
  MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING,
  verifyModelLiveAccountingRuntime,
} from "./model-live-commercial-accounting-codec.js";
import {
  modelSeedAccountingBindingSchema,
  MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
  verifyModelSeedSequenceAccountingRuntimeV4,
} from "./model-live-seed-commercial-accounting-codec.js";
import {
  parseIssuedModelLiveSequencePlanRow,
  parseModelLiveSequenceSelectionRow,
} from "./model-live-sequence-authority-codec.js";
import { parseWorkflowRecord } from "./model-commercial-workflow-codec.js";
import { parseIssuedModelLiveSeedStageInputRow } from "./model-live-seed-stage-input-codec.js";
import { ProjectDeletionRecoveryAuthority } from "./project-deletion-recovery-authority.js";
import { sql, type SqlExecutor } from "./sql.js";
import { cleanupRequired } from "./cleanup-required.js";
/** Financial replay only. The existing engine must establish exact pricing,
 * actual terminal/no-dispatch evidence and immutable ledger projection. No
 * tombstone, timeout, canceled job or caller amount creates an outcome. */
export async function recoverOneProjectDeletionCredit(
  authority: ProjectDeletionRecoveryAuthority,
) {
  const b = authority.binding;
  const found = await authority.query(
    sql(
      `SELECT d.*,w.snapshot AS workflow_snapshot,w.snapshot_sha256 AS workflow_sha256
    FROM credit_reservations c JOIN model_commercial_reservation_decisions d ON d.organization_id=c.organization_id AND d.canonical_reservation_id=c.reservation_id
    JOIN model_commercial_workflows w ON w.organization_id=d.organization_id AND w.scope_sha256=d.scope_sha256 AND w.workflow_id=d.workflow_id
      AND w.project_id=d.project_id AND w.principal_id=d.principal_id
    WHERE c.organization_id=$1 AND c.project_id=$2 AND c.status='active' AND d.accepted ORDER BY c.created_at,c.reservation_id LIMIT 1`,
      [b.organizationId, b.projectId],
    ),
  );
  const row = found.rows[0];
  if (row === undefined) return { state: "idle" as const };
  const identity = {
    authority: "verified-principal-scope-v1" as const,
    organizationId: b.organizationId,
    projectId: b.projectId,
    userId: String(row["principal_id"]),
  };
  const scope: ModelCommercialVerifiedScopeV1 = {
    ...identity,
    tenantScopeDigest: digestModelCommercialVerifiedScopeV1(identity),
  };
  accountingAssert(
    scope.tenantScopeDigest === `sha256:${String(row["scope_sha256"])}`,
  );
  const workflow = parseWorkflowRecord(
    accountingRead(row["workflow_snapshot"]),
    scope,
  );
  accountingAssert(
    digestStructuredValue(workflow) ===
      `sha256:${String(row["workflow_sha256"])}`,
  );
  const common = modelAccountingBindingSchema.parse({
    workflowId: row["workflow_id"],
    workflowFingerprint: workflow.fingerprint,
    runtimeScopeDigest: `sha256:${String(row["runtime_scope_sha256"])}`,
    runtimeFingerprint: `sha256:${String(row["runtime_fingerprint_sha256"])}`,
  });
  const request = {
    request: workflow.request,
    requestDigest: workflow.fingerprint,
  };
  const terminalPort = <
    R extends
      | RuntimeAdmissionRecord
      | LiveRuntimeAdmissionRecord
      | SeedRuntimeAdmissionRecordV4,
  >(
    bind: (
      tx: SqlExecutor,
      workflow: Parameters<typeof verifyModelAccountingRuntime>[0],
      runtime: R,
    ) => Promise<void>,
  ): ModelAccountingTransactionPort<R> => ({
    run: (work) =>
      authority.transaction(async (tx) => {
        return work(tx, {
          requireCurrent: () => authority.authorize(tx),
          bind: (w, r) => bind(tx, w, r),
        });
      }),
  });
  if (row["mapping_version"] === MODEL_ACCOUNTING_WINDOW_MAPPING) {
    const engine = new PostgresModelCommercialAccountingEngine({
      database: authority.database,
      scope,
      binding: common,
      mapping: MODEL_ACCOUNTING_WINDOW_MAPPING,
      parseRuntime: parseRuntimeRecord,
      verifyRuntime: verifyModelAccountingRuntime,
      deletionTerminalTransactions: terminalPort(
        (_tx, w, r: RuntimeAdmissionRecord) => {
          verifyModelAccountingRuntime(w, r, common);
          return Promise.resolve();
        },
      ),
    });
    const result = await engine.recoverVerified(request);
    return {
      state:
        result.kind === "verified" ? ("recovered" as const) : ("held" as const),
    };
  }
  if (row["mapping_version"] === MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING) {
    const binding = modelLiveAccountingBindingSchema.parse(
      accountingRead(row["live_binding"]),
    );
    accountingAssert(
      digestStructuredValue(binding) ===
        `sha256:${String(row["live_binding_sha256"])}`,
    );
    let admission: LiveRuntimeAdmissionRecord["request"] | undefined;
    const engine = new PostgresModelCommercialAccountingEngine({
      database: authority.database,
      scope,
      binding: common,
      liveBinding: binding,
      mapping: MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING,
      parseRuntime: parseLiveRuntimeRecord,
      verifyRuntime: verifyModelAccountingCommonBinding,
      deletionTerminalTransactions: terminalPort(
        async (tx, w, r: LiveRuntimeAdmissionRecord) => {
          admission = r.request;
          const plans = await tx.query(
            sql(
              "SELECT * FROM model_live_evaluation_plans WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4 FOR SHARE",
              [
                b.organizationId,
                b.projectId,
                scope.userId,
                r.request.liveEvaluationPlanDigest.slice(7),
              ],
            ),
          );
          accountingAssert(plans.rows.length === 1);
          const p = cleanupRequired(plans.rows[0]),
            plan = modelLiveEvaluationPlanV2Schema.parse(
              accountingRead(p["plan_record"]),
            );
          accountingAssert(
            p["definition_id"] === plan.definition.definitionId &&
              p["definition_sha256"] ===
                plan.definition.definitionDigest.slice(7) &&
              p["approval_sha256"] === plan.approval.approvalDigest.slice(7) &&
              p["operator_principal_id"] === plan.approval.operatorUserId &&
              p["plan_id"] === plan.planId &&
              p["plan_sha256"] === plan.planDigest.slice(7),
          );
          verifyModelLiveAccountingRuntime(w, r, binding, plan);
        },
      ),
    });
    // Canonical runtime request is read independently before invoking the engine;
    // its transaction revalidates its exact snapshot and issued plan.
    const runtime = await authority.query(
      sql(
        "SELECT snapshot FROM model_runtime_admissions WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4",
        [
          b.organizationId,
          common.runtimeScopeDigest.slice(7),
          b.projectId,
          scope.userId,
        ],
      ),
    );
    accountingAssert(runtime.rows.length === 1);
    admission = parseLiveRuntimeRecord(
      accountingRead(cleanupRequired(runtime.rows[0])["snapshot"]),
      scope,
    ).request;
    const result = await engine.recoverLiveVerified({
      ...request,
      admissionRequest: admission,
    });
    return {
      state:
        result.kind === "verified" ? ("recovered" as const) : ("held" as const),
    };
  }
  if (
    row["mapping_version"] === MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING
  ) {
    const binding = modelSeedAccountingBindingSchema.parse(
      accountingRead(row["live_binding"]),
    );
    accountingAssert(
      digestStructuredValue(binding) ===
        `sha256:${String(row["live_binding_sha256"])}`,
    );
    const engine = new PostgresModelCommercialAccountingEngine({
      database: authority.database,
      scope,
      binding: common,
      seedBinding: binding,
      mapping: MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
      parseRuntime: parseSeedRuntimeRecordV4,
      verifyRuntime: verifyModelAccountingCommonBinding,
      deletionTerminalTransactions: terminalPort(
        async (tx, w, r: SeedRuntimeAdmissionRecordV4) => {
          const plans = await tx.query(
            sql(
              `SELECT p.*,false AS revoked,to_char(p.issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at_text,to_char(p.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at_text FROM model_live_sequence_plans p WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4 FOR SHARE`,
              [
                b.organizationId,
                b.projectId,
                scope.userId,
                r.request.liveEvaluationPlanDigest.slice(7),
              ],
            ),
          );
          accountingAssert(plans.rows.length === 1);
          const rawPlan = modelLiveSequencePlanV3Schema.parse(
            accountingRead(cleanupRequired(plans.rows[0])["plan_record"]),
          );
          const plan = parseIssuedModelLiveSequencePlanRow(
            cleanupRequired(plans.rows[0]),
            rawPlan.definition.scope,
          ).plan;
          const selections = await tx.query(
            sql(
              `SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at_text FROM model_live_sequence_selections WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND selection_id=$4 FOR SHARE`,
              [
                b.organizationId,
                b.projectId,
                scope.userId,
                r.request.selectionId,
              ],
            ),
          );
          accountingAssert(selections.rows.length === 1);
          const selection = parseModelLiveSequenceSelectionRow(
            cleanupRequired(selections.rows[0]),
            plan,
          );
          const inputs = await tx.query(
            sql(
              "SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS issued_at_text FROM model_live_sequence_inputs WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4 FOR SHARE",
              [b.organizationId, b.projectId, scope.userId, r.request.stageId],
            ),
          );
          accountingAssert(inputs.rows.length === 1);
          const stage = parseIssuedModelLiveSeedStageInputRow(
            cleanupRequired(inputs.rows[0]),
            plan,
            selection,
            w.request.requestedAt,
          ).record;
          verifyModelSeedSequenceAccountingRuntimeV4(
            w,
            r,
            binding,
            plan,
            selection,
            stage,
          );
        },
      ),
    });
    const result = await engine.recoverRecordedRepairV4();
    return {
      state:
        result.kind === "pending" ? ("held" as const) : ("recovered" as const),
    };
  }
  // Reservation-only V3 and unknown mappings have no terminal evidence bridge.
  return { state: "held" as const };
}
