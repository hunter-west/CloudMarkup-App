import type {
  ModelCommercialVerifiedScopeV1,
  ModelLiveSeedRuntimeExecutionInputV4,
} from "@cloudmarkup/model-gateway";
import { utcTimestampSchema } from "@cloudmarkup/schemas";
import type { ModelSeedAccountingBinding } from "./model-live-seed-commercial-accounting-codec.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";
import { sql, type SqlExecutor } from "./sql.js";

/** Both repairs share the original runtime/workflow lease and principal expiry. */
export async function readRepairDispatchExpiryV4(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  readonly accounting: ModelSeedAccountingBinding;
  readonly principalExpiresAt: string;
  readonly now: string;
}) {
  const { tx, scope, execution, accounting } = input;
  const row = (
    await tx.query(
      sql(
        "SELECT to_char(LEAST(w.lease_expires_at,r.lease_expires_at,$6::timestamptz,$7::timestamptz,$8::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS expires_at FROM model_commercial_workflows w JOIN model_runtime_admissions r ON r.organization_id=w.organization_id AND r.project_id=w.project_id AND r.principal_id=w.principal_id WHERE w.organization_id=$1 AND w.project_id=$2 AND w.principal_id=$3 AND w.workflow_id=$4 AND r.scope_sha256=$5 AND w.scope_sha256=$9",
        [
          scope.organizationId,
          scope.projectId,
          scope.userId,
          accounting.workflowId,
          accounting.runtimeScopeDigest.slice(7),
          execution.plan.expiresAt,
          input.principalExpiresAt,
          execution.commercialRequest.expiresAt,
          scope.tenantScopeDigest.slice(7),
        ],
      ),
    )
  ).rows[0];
  const expiresAt = utcTimestampSchema.parse(row?.["expires_at"]);
  requireAuthority(Date.parse(expiresAt) > Date.parse(input.now));
  return { expiresAt };
}
