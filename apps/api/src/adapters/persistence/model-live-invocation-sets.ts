import { randomUUID } from "node:crypto";
import {
  digestCanonicalValue,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ModelLiveEvaluationPlanV2,
} from "@cloudmarkup/schemas";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import {
  ModelLiveInvocationSetError,
  modelLiveInvocationSetReferenceV2Schema,
  modelLiveInvocationSetV2Schema,
  parseModelLiveInvocationSetRow,
  requireInvocationSet,
  type ModelLiveInvocationSetReferenceV2,
} from "./model-live-invocation-set-codec.js";
import { sql, type SqlExecutor } from "./sql.js";

interface PlanReference {
  readonly definitionId: string;
  readonly planDigest: string;
}
export interface ModelLiveSelectedInvocationV2 {
  readonly caseId: string;
  readonly caseDigest: string;
  readonly invocationId: string;
}
function reference(value: PlanReference) {
  return {
    definitionId: solutionStableIdSchema.parse(value.definitionId),
    planDigest: sha256DigestSchema.parse(value.planDigest),
  };
}
async function read(tx: SqlExecutor, plan: ModelLiveEvaluationPlanV2) {
  const scope = plan.definition.scope;
  const result = await tx.query(
    sql(
      "SELECT organization_id,project_id,principal_id,plan_sha256,set_id,set_sha256,set_record FROM model_live_invocation_sets WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4 FOR SHARE",
      [
        scope.organizationId,
        scope.projectId,
        scope.userId,
        plan.planDigest.slice(7),
      ],
    ),
  );
  requireInvocationSet(result.rowCount <= 1);
  const row = result.rows[0];
  return row === undefined ? null : parseModelLiveInvocationSetRow(row, plan);
}
/** Existing authenticated plan transaction only. The caller must require current
 * approval before this read and again at commit. No nested transaction or write. */
export async function requireSelectedModelLiveInvocationInTransaction(input: {
  readonly transaction: SqlExecutor;
  readonly plan: ModelLiveEvaluationPlanV2;
  readonly reference: ModelLiveInvocationSetReferenceV2;
  readonly selected: ModelLiveSelectedInvocationV2;
}) {
  const ref = modelLiveInvocationSetReferenceV2Schema.parse(input.reference);
  const selected = {
    caseId: solutionStableIdSchema.parse(input.selected.caseId),
    caseDigest: sha256DigestSchema.parse(input.selected.caseDigest),
    invocationId: solutionStableIdSchema.parse(input.selected.invocationId),
  };
  const set = await read(input.transaction, input.plan);
  requireInvocationSet(
    set !== null && set.setId === ref.setId && set.setDigest === ref.setDigest,
  );
  const found = set.entries.find((e) => e.caseId === selected.caseId);
  requireInvocationSet(
    found?.caseDigest === selected.caseDigest &&
      found.invocationId === selected.invocationId,
  );
  return set;
}
/** Private metadata-only issuance. IDs and database time are host-owned. This
 * issues no model/report authority, reservation, usage or financial terminal. */
export class PostgresModelLiveInvocationSets {
  readonly #plans: PostgresModelLiveEvaluationPlans;
  constructor(plans: PostgresModelLiveEvaluationPlans) {
    this.#plans = plans;
  }
  async issue(input: PlanReference) {
    try {
      return await this.#plans.withIssuedMetadata(
        reference(input),
        async ({ plan, principal, transaction, requireCurrentApproval }) => {
          await requireCurrentApproval();
          requireInvocationSet(
            principal.principalId === plan.definition.scope.userId,
          );
          const existing = await read(transaction, plan);
          if (existing !== null) return existing;
          const scope = plan.definition.scope;
          const prior = await transaction.query(
            sql(
              "SELECT 1 FROM model_live_invocations WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND binding->>'liveEvaluationPlanDigest'=$4 LIMIT 1",
              [
                scope.organizationId,
                scope.projectId,
                scope.userId,
                plan.planDigest,
              ],
            ),
          );
          requireInvocationSet(prior.rowCount === 0);
          const now = await transaction.query(
            sql(
              "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
            ),
          );
          const body = {
            contractVersion: 2 as const,
            recordKind: "model-live-invocation-set" as const,
            issuerId: "cloudmarkup.model-live-invocation-set" as const,
            issuerVersion: "1.0.0" as const,
            setId: "live_set_" + randomUUID().replaceAll("-", ""),
            scope,
            definitionId: plan.definition.definitionId,
            definitionDigest: plan.definition.definitionDigest,
            planDigest: plan.planDigest,
            approvalDigest: plan.approval.approvalDigest,
            issuedAt: utcTimestampSchema.parse(now.rows[0]?.["now"]),
            entries: plan.definition.cases.map((c) => ({
              caseId: c.caseId,
              caseDigest: c.caseDigest,
              sourceInputDigest: c.sourceInputDigest,
              authorityTupleDigest: c.authorityBinding.authorityTupleDigest,
              invocationId: "invocation_" + randomUUID().replaceAll("-", ""),
            })),
          };
          const set = modelLiveInvocationSetV2Schema.parse({
            ...body,
            setDigest: digestCanonicalValue(body),
          });
          await transaction.query(
            sql(
              "INSERT INTO model_live_invocation_sets (organization_id,project_id,principal_id,plan_sha256,set_id,set_sha256,set_record,issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)",
              [
                scope.organizationId,
                scope.projectId,
                scope.userId,
                plan.planDigest.slice(7),
                set.setId,
                set.setDigest.slice(7),
                JSON.stringify(set),
                set.issuedAt,
              ],
            ),
          );
          const issued = await read(transaction, plan);
          requireInvocationSet(
            issued !== null && issued.setDigest === set.setDigest,
          );
          return issued;
        },
      );
    } catch {
      throw new ModelLiveInvocationSetError();
    }
  }
  async requireCurrent(
    input: PlanReference & {
      readonly invocationSet: ModelLiveInvocationSetReferenceV2;
      readonly selected: ModelLiveSelectedInvocationV2;
    },
  ) {
    try {
      return await this.#plans.withIssuedMetadata(
        reference(input),
        async (context) => {
          await context.requireCurrentApproval();
          return requireSelectedModelLiveInvocationInTransaction({
            transaction: context.transaction,
            plan: context.plan,
            reference: input.invocationSet,
            selected: input.selected,
          });
        },
      );
    } catch {
      throw new ModelLiveInvocationSetError();
    }
  }
}
