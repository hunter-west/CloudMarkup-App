import { sql, type SqlExecutor } from "./sql.js";
/** Shared explicit columns. Both reporting and completion verification use the
 * same original-pricing and invocation/ledger evidence; no SELECT * grants. */
export const betaAiCostEvidenceQuery = `SELECT i.organization_id,i.reservation_id,i.project_id,i.job_id,i.purpose,i.request_sha256,
        i.state,i.dispatched_at,i.usage_recorded_at,i.provider_request_id,i.input_tokens,i.output_tokens,i.cached_input_tokens,
        i.usage_observed_at,i.observed_provider_request_id,i.observed_input_tokens,i.observed_output_tokens,i.observed_cached_input_tokens,
        r.project_id AS reservation_project_id,r.job_id AS reservation_job_id,r.request_sha256 AS reservation_request_sha256,
        r.request_id,r.status AS financial_status,r.pricing_version_id,r.charging_policy_version,r.provider_key,r.model_key,r.model_version,
        p.provider_key AS price_provider_key,p.model_key AS price_model_key,p.model_version AS price_model_version,p.cost_currency AS price_currency,
        p.input_micros_per_million_tokens AS price_input_rate,p.output_micros_per_million_tokens AS price_output_rate,
        p.cached_input_micros_per_million_tokens AS price_cached_rate
        FROM beta_ai_invocations i JOIN credit_reservations r ON r.organization_id=i.organization_id AND r.reservation_id=i.reservation_id
        LEFT JOIN provider_pricing_versions p ON p.pricing_version_id=r.pricing_version_id`;
export function readBetaAiLedgerEvidence(
  tx: SqlExecutor,
  organizationId: string,
  reservationId: string,
) {
  return tx.query(
    sql(
      `SELECT organization_id,reservation_id,request_id,project_id,job_id,entry_kind,
          provider_key,model_key,model_version,provider_request_id,input_token_count,output_token_count,cached_input_token_count,
          estimated_provider_cost_micros,provider_cost_currency,pricing_version_id,charging_policy_version,ledger_entry_id
          FROM usage_ledger_entries WHERE organization_id=$1 AND reservation_id=$2 ORDER BY ledger_entry_id LIMIT 26`,
      [organizationId, reservationId],
    ),
  );
}
