/** Explicit source variants of existing fixed lock operations. These do not
 * add SQL functions or grant mutations on immutable rows. The original invoker
 * SQL and its tenant/lifecycle/replay predicates remain unchanged. */
export const ordinarySharedLockReads = [
  {
    name: "billing_account",
    statement:
      "SELECT billing_account_id FROM organization_billing_accounts WHERE organization_id=$1 FOR UPDATE",
    parameterCount: 1,
    identityColumn: null,
    hosts: ["api", "proposal"],
    parameterOrder: [0],
  },
  {
    name: "ledger_replay",
    statement:
      "\n  SELECT ledger_entry_id, usage_ledger_entries.organization_id, entry_kind, reservation_id,\n         credit_grant_id, related_ledger_entry_id, acting_principal_id,\n         entitlement_policy_version, idempotency_key_sha256,\n         charging_scenario,\n         recorded_by_actor_kind, recorded_by_actor_id, project_id,\n         feature_key, request_id, job_id, plan_version_id,\n         pricing_version_id, provider_key, model_key, model_version,\n         provider_request_id, input_token_count, output_token_count,\n         cached_input_token_count, latency_milliseconds,\n         estimated_provider_cost_micros, provider_cost_currency,\n         normalized_credit_units,\n         granted_credit_units,\n         reserved_credit_units, settled_credit_units,\n         released_credit_units, expired_credit_units,\n         credit_adjustment_units, outcome, reason_code, safe_reason,\n         charging_policy_version, occurred_at\n  FROM usage_ledger_entries\n\n           WHERE organization_id = $1\n             AND (ledger_entry_id = $2 OR idempotency_key_sha256 = $3)\n           FOR UPDATE",
    parameterCount: 3,
    identityColumn: "ledger_entry_id",
    hosts: ["api", "proposal"],
    parameterOrder: [0, 1, 2],
  },
  {
    name: "ledger_replay",
    statement:
      "\n  SELECT ledger_entry_id, usage_ledger_entries.organization_id, entry_kind, reservation_id,\n         credit_grant_id, related_ledger_entry_id, acting_principal_id,\n         entitlement_policy_version, idempotency_key_sha256,\n         charging_scenario,\n         recorded_by_actor_kind, recorded_by_actor_id, project_id,\n         feature_key, request_id, job_id, plan_version_id,\n         pricing_version_id, provider_key, model_key, model_version,\n         provider_request_id, input_token_count, output_token_count,\n         cached_input_token_count, latency_milliseconds,\n         estimated_provider_cost_micros, provider_cost_currency,\n         normalized_credit_units,\n         granted_credit_units,\n         reserved_credit_units, settled_credit_units,\n         released_credit_units, expired_credit_units,\n         credit_adjustment_units, outcome, reason_code, safe_reason,\n         charging_policy_version, occurred_at\n  FROM usage_ledger_entries\n\n           WHERE organization_id = $1\n             AND (idempotency_key_sha256 = $2 OR ledger_entry_id = $3)\n           FOR UPDATE",
    parameterCount: 3,
    identityColumn: "ledger_entry_id",
    hosts: ["api"],
    parameterOrder: [0, 2, 1],
  },
  {
    name: "project_scope",
    statement:
      "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='active' FOR SHARE",
    parameterCount: 2,
    identityColumn: null,
    hosts: ["api", "export"],
    parameterOrder: [0, 1],
  },
] as const;

/** Fixed versioned reference reads; SQL remains an integrator-owned proposal. */
export const ordinaryVersionedReferenceLocks = [
  {
    name: "proposal_baseline",
    statement:
      "SELECT d.draft_id,d.draft_version::text,d.content_sha256,d.document_object_id\n        FROM projects p JOIN architecture_drafts d\n          ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id\n        WHERE p.organization_id=$1 AND p.project_id=$2 AND p.lifecycle_status='active'\n          AND d.draft_id=$3 AND d.draft_version=$4 AND d.content_sha256=$5\n          AND d.pending_draft_version IS NULL AND d.pending_document_object_id IS NULL\n        FOR SHARE OF p,d",
    parameterCount: 5,
    identityColumn: "draft_id",
    hosts: ["api", "proposal"],
    parameterOrder: [0, 1, 2, 3, 4],
  },
] as const;

/** Closed staff/account operations. Operation names and key mapping are source
 * literals; no caller SQL, relation, column, amount or lock mode enters SQL. */
export const ordinaryStaffReferenceLocks = [
  {
    name: "staff_authority",
    statement:
      "SELECT permissions FROM platform_staff_authorizations WHERE principal_id=$1 AND revoked_at IS NULL FOR SHARE",
    parameterCount: 1,
    identityColumn: null,
    hosts: ["api"],
    parameterOrder: [0],
  },
  {
    name: "staff_financial_reference",
    statement:
      "SELECT subscription_projection_id FROM organization_subscription_projections WHERE organization_id=$1 AND billing_account_id=$2 AND normalized_status='active' AND provider_environment=CASE WHEN EXISTS(SELECT 1 FROM billing_provider_cutovers) THEN 'live' ELSE 'test' END FOR SHARE",
    parameterCount: 2,
    identityColumn: "subscription_projection_id",
    hosts: ["api"],
    helperArguments: [
      {
        literal: "staff-active-plan",
      },
      {
        valueIndex: 0,
      },
      {
        valueIndex: 1,
      },
      {
        literal: null,
      },
    ],
  },
  {
    name: "staff_financial_reference",
    statement:
      "SELECT e.entitlement_snapshot_id,e.record_version::text,e.entitlement_policy_version,p.subscription_projection_id,p.plan_version_id,p.record_version::text AS source_record_version,p.normalized_status FROM organization_entitlement_snapshots e JOIN organization_subscription_projections p ON p.organization_id=e.organization_id AND p.billing_account_id=e.billing_account_id AND p.subscription_projection_id=e.subscription_projection_id WHERE e.organization_id=$1 FOR UPDATE OF e,p",
    parameterCount: 1,
    identityColumn: "entitlement_snapshot_id",
    hosts: ["api"],
    helperArguments: [
      {
        literal: "staff-paid-entitlement",
      },
      {
        valueIndex: 0,
      },
      {
        literal: null,
      },
      {
        literal: null,
      },
    ],
  },
  {
    name: "staff_financial_reference",
    statement:
      "SELECT normalized_status FROM organization_subscription_projections WHERE organization_id=$1 FOR SHARE",
    parameterCount: 1,
    identityColumn: null,
    hosts: ["api"],
    helperArguments: [
      {
        literal: "staff-trial-state",
      },
      {
        valueIndex: 0,
      },
      {
        literal: null,
      },
      {
        literal: null,
      },
    ],
  },
  {
    name: "staff_financial_reference",
    statement:
      "SELECT subscription_projection_id, organization_id,\n                  billing_account_id, billing_provider,\n                  provider_customer_reference,\n                  provider_subscription_reference,\n                  provider_product_reference, provider_price_reference,\n                  last_provider_event_reference, provider_event_position,\n                  normalized_status, plan_version_id,\n                  billable_seat_quantity, current_period_id,\n                  current_period_start, current_period_end,\n                  cancel_at_period_end, effective_at, record_version\n           FROM organization_subscription_projections\n           WHERE organization_id = $1\n             AND subscription_projection_id = $2\n           FOR UPDATE",
    parameterCount: 2,
    identityColumn: "subscription_projection_id",
    hosts: ["api"],
    helperArguments: [
      {
        literal: "entitlement-source",
      },
      {
        valueIndex: 0,
      },
      {
        literal: null,
      },
      {
        valueIndex: 1,
      },
    ],
  },
] as const;
