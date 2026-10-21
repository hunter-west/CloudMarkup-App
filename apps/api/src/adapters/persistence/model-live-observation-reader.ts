import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import {
  sha256DigestSchema,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";
import { readModelLiveObservationV2 } from "../../model-live-observation.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import {
  MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING,
  modelLiveAccountingBindingSchema,
  verifyModelLiveAccountingRuntime,
} from "./model-live-commercial-accounting-codec.js";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { PostgresModelLiveInvocationJournal } from "./model-live-invocation-journal.js";
import {
  liveJournalBindingSchema,
  liveJournalRead,
  liveJournalScope,
} from "./model-live-invocation-journal-codec.js";
import { parseLiveRuntimeRecord } from "./model-live-runtime-admission-codec.js";
import { parseWorkflowRecord } from "./model-commercial-workflow-codec.js";
import { sql, type SqlDatabase } from "./sql.js";

export class ModelLiveStoredObservationError extends Error {
  readonly code = "model-live.stored-observation-unavailable";
  constructor() {
    super("The exact existing settled evaluation observation is unavailable.");
    this.name = "ModelLiveStoredObservationError";
  }
}
function requireStored(value: boolean): asserts value {
  if (!value) throw new ModelLiveStoredObservationError();
}

/** Private authenticated metadata restoration. Reference fields select records;
 * they provide no tenant, approval, execution, usage or quality authority.
 * Missing canonical settlement is denied, never reconciled by this reader.
 * No prompt/response, provider setup, fresh commercial preflight or model call
 * is needed. This is one observation, never a report or promotion. */
export async function readStoredModelLiveObservationV2(input: {
  readonly database: SqlDatabase;
  readonly plans: PostgresModelLiveEvaluationPlans;
  readonly definitionId: string;
  readonly planDigest: string;
  readonly invocationId: string;
}) {
  try {
    const reference = {
      definitionId: solutionStableIdSchema.parse(input.definitionId),
      planDigest: sha256DigestSchema.parse(input.planDigest),
    };
    const invocationId = solutionStableIdSchema.parse(input.invocationId);
    const restore = () =>
      input.plans.withIssuedMetadata(
        reference,
        async ({ plan, principal, transaction, requireCurrentApproval }) => {
          await requireCurrentApproval();
          const scope = plan.definition.scope;
          requireStored(principal.principalId === scope.userId);
          const found = await transaction.query(
            sql(
              `SELECT j.binding AS journal_binding,j.binding_sha256 AS journal_sha256,
                j.gateway_state,j.workflow_id,j.reservation_id,j.dispatch_intent_id,
                w.snapshot AS workflow_snapshot,w.snapshot_sha256 AS workflow_sha256,
                d.live_binding,d.live_binding_sha256,d.accepted,d.mapping_version,
                r.snapshot AS runtime_snapshot,r.snapshot_sha256 AS runtime_sha256
              FROM model_live_invocations j
              JOIN model_commercial_workflows w
                ON w.organization_id=j.organization_id AND w.project_id=j.project_id
                AND w.principal_id=j.principal_id AND w.scope_sha256=j.scope_sha256
                AND w.workflow_id=j.workflow_id
              JOIN model_commercial_reservation_decisions d
                ON d.organization_id=j.organization_id AND d.project_id=j.project_id
                AND d.principal_id=j.principal_id AND d.scope_sha256=j.scope_sha256
                AND d.workflow_id=j.workflow_id
              JOIN model_runtime_admissions r
                ON r.organization_id=j.organization_id AND r.project_id=j.project_id
                AND r.principal_id=j.principal_id AND r.scope_sha256=d.runtime_scope_sha256
              WHERE j.organization_id=$1 AND j.project_id=$2 AND j.principal_id=$3
                AND j.invocation_id=$4`,
              [
                scope.organizationId,
                scope.projectId,
                scope.userId,
                invocationId,
              ],
            ),
          );
          const row = found.rows[0];
          requireStored(found.rowCount === 1 && row !== undefined);
          const binding = liveJournalBindingSchema.parse(
            liveJournalRead(row["journal_binding"]),
          );
          requireStored(
            binding.scope.organizationId === scope.organizationId &&
              binding.scope.projectId === scope.projectId &&
              binding.scope.userId === scope.userId &&
              binding.invocationId === invocationId &&
              binding.liveEvaluationPlanDigest === plan.planDigest &&
              binding.liveEvaluationAuthorityDigest ===
                plan.approval.approvalDigest &&
              row["gateway_state"] === "complete" &&
              row["journal_sha256"] === digestStructuredValue(binding).slice(7),
          );
          const verifiedScope = liveJournalScope(binding);
          const workflow = parseWorkflowRecord(
            liveJournalRead(row["workflow_snapshot"]),
            verifiedScope,
          );
          const runtime = parseLiveRuntimeRecord(
            liveJournalRead(row["runtime_snapshot"]),
            verifiedScope,
          );
          const accountingBinding = modelLiveAccountingBindingSchema.parse(
            liveJournalRead(row["live_binding"]),
          );
          verifyModelLiveAccountingRuntime(
            workflow,
            runtime,
            accountingBinding,
            plan,
          );
          requireStored(
            row["workflow_sha256"] ===
              digestStructuredValue(workflow).slice(7) &&
              row["runtime_sha256"] ===
                digestStructuredValue(runtime).slice(7) &&
              row["live_binding_sha256"] ===
                digestStructuredValue(accountingBinding).slice(7) &&
              row["accepted"] === true &&
              row["mapping_version"] === MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING &&
              row["workflow_id"] === workflow.request.multiCallWorkflowId &&
              row["reservation_id"] === workflow.request.reservationId &&
              row["dispatch_intent_id"] ===
                workflow.dispatchIntent?.dispatchIntentId,
          );
          return {
            binding,
            scope: verifiedScope,
            request: workflow.request,
            admissionRequest: runtime.request,
            accountingBinding,
          };
        },
      );
    const restored = await restore();
    const journal = new PostgresModelLiveInvocationJournal({
      binding: restored.binding,
      request: restored.request,
      admissionRequest: restored.admissionRequest,
      accountingBinding: restored.accountingBinding,
      plans: input.plans,
      definitionId: reference.definitionId,
    });
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: input.database,
      plans: input.plans,
      scope: restored.scope,
      binding: restored.accountingBinding,
      ...reference,
    });
    const observed = await readModelLiveObservationV2({
      journal,
      accounting,
      request: restored.request,
      admissionRequest: restored.admissionRequest,
      terminalMode: "existing-only",
      authorize: async () => {
        await input.plans.requireCurrent(reference);
      },
    });
    requireStored(
      digestStructuredValue(await restore()) ===
        digestStructuredValue(restored),
    );
    return {
      ...observed,
      invocationId,
      journalBindingDigest: digestStructuredValue(restored.binding),
      runtimeRequestDigest: restored.admissionRequest.requestDigest,
    };
  } catch {
    throw new ModelLiveStoredObservationError();
  }
}
