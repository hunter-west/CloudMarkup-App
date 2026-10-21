import { RepositoryError } from "../../application/persistence.js";
import {
  sql,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import type { OrdinaryRuntimeHost } from "./ordinary-runtime-database.js";
import { tryExecuteOrdinaryAuthorizationStatement } from "./ordinary-runtime-authorization.js";
import {
  ordinarySharedLockReads,
  ordinaryStaffReferenceLocks,
  ordinaryVersionedReferenceLocks,
} from "./ordinary-runtime-shared-locks.js";

/** Closed source statements only. Corresponding protected-migrator-owned helpers
 * are source proposals until registered by the migration owner. No caller SQL,
 * relation selector or amount reaches a helper. Returned data is read again by
 * the ordinary invoker so its normal column privileges and RLS remain applied. */
export const ordinaryFinancialLocks = [
  {
    name: "billing_account",
    statement:
      "SELECT billing_account_id, organization_id, lifecycle_status,\n              expensive_operations_enabled, record_version\n       FROM organization_billing_accounts\n       WHERE organization_id = $1\n       FOR UPDATE",
    parameterCount: 1,
    identityColumn: null,
    hosts: ["api", "proposal", "export", "billing"],
    parameterTypes: {},
  },
  {
    name: "subscription_plan",
    statement:
      "SELECT seats.included_billable_seats, seats.maximum_billable_seats,\n                  version.configuration_version, seats.additional_seat_enabled\n           FROM commercial_plan_versions version\n           JOIN commercial_plan_seat_rules seats\n             ON seats.plan_version_id = version.plan_version_id\n           WHERE version.plan_version_id = $1\n             AND version.configuration_status = 'proposed-beta-example'\n             AND version.effective_from <= $2::timestamptz\n             AND (version.effective_until IS NULL\n               OR version.effective_until > $2::timestamptz)\n           FOR SHARE",
    parameterCount: 2,
    identityColumn: null,
    hosts: ["billing"],
    parameterTypes: {},
  },
  {
    name: "credit_grant_replay",
    statement:
      "SELECT credit_grant_id, organization_id, billing_account_id,\n                  plan_version_id, grant_kind, credit_units, starts_at,\n                  expires_at, expiration_policy_kind,\n                  expiration_policy_version, subscription_period_id,\n                  subscription_period_start, subscription_period_end,\n                  consumption_priority, source_reference,\n                  grant_policy_version\n           FROM credit_grants\n           WHERE organization_id = $1\n             AND (\n               idempotency_key_sha256 = $2\n               OR ($3::VARCHAR IS NOT NULL\n                 AND grant_kind = $5\n                 AND source_reference = $3)\n               OR ($4::VARCHAR IS NOT NULL AND subscription_period_id = $4)\n               OR (\n                 $5 = 'one-time' AND grant_kind = 'one-time'\n                 AND plan_version_id = $6\n                 AND grant_policy_version = $7\n               )\n             )\n           FOR UPDATE",
    parameterCount: 7,
    identityColumn: "credit_grant_id",
    hosts: ["api", "billing"],
    parameterTypes: {},
  },
  {
    name: "ledger_replay",
    statement:
      "SELECT ledger_entry_id, entry_kind, credit_grant_id,\n                    acting_principal_id, recorded_by_actor_kind,\n                    recorded_by_actor_id, plan_version_id,\n                    granted_credit_units, credit_adjustment_units, outcome,\n                    charging_policy_version, reason_code, safe_reason,\n                    related_ledger_entry_id\n             FROM usage_ledger_entries\n             WHERE organization_id = $1\n               AND (ledger_entry_id = $2 OR idempotency_key_sha256 = $3)\n             FOR UPDATE",
    parameterCount: 3,
    identityColumn: "ledger_entry_id",
    hosts: ["api", "proposal", "billing"],
    parameterTypes: {},
  },
  {
    name: "included_grant_plan",
    statement:
      "SELECT included.credit_units\n             FROM commercial_plan_included_credit_grants included\n             JOIN commercial_plan_versions version\n               ON version.plan_version_id = included.plan_version_id\n             WHERE included.plan_version_id = $1\n               AND included.grant_kind = $2\n               AND version.configuration_status = 'proposed-beta-example'\n               AND version.effective_from <= $3::timestamptz\n               AND (version.effective_until IS NULL\n                 OR version.effective_until > $3::timestamptz)\n             FOR SHARE OF included, version",
    parameterCount: 3,
    identityColumn: null,
    hosts: ["billing"],
    parameterTypes: {},
  },
  {
    name: "top_up_account",
    statement:
      "SELECT a.lifecycle_status,o.lifecycle_status AS organization_state FROM organization_billing_accounts a\n     JOIN organizations o ON o.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.billing_account_id=$2 FOR UPDATE OF a FOR SHARE OF o",
    parameterCount: 2,
    identityColumn: null,
    hosts: ["billing"],
    parameterTypes: {},
  },
  {
    name: "proposal_job_authority",
    statement:
      "SELECT j.created_by_principal_id,j.correlation_id,m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json\n    FROM async_jobs j\n    JOIN projects p ON p.organization_id=j.organization_id AND p.project_id=j.project_id AND p.lifecycle_status='active'\n    JOIN principals actor ON actor.principal_id=j.created_by_principal_id AND actor.lifecycle_status='active'\n    JOIN memberships m ON m.organization_id=j.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'\n    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n    WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3 AND j.family='architecture-proposal'\n      AND j.input_sha256=$4 AND j.correlation_id=$5 AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL\n      AND j.idempotency_actor_id=j.created_by_principal_id AND j.idempotency_scope='cloudmarkup.beta-infrastructure-proposals.create'\n    FOR SHARE OF p,actor,m,o,r",
    parameterCount: 5,
    identityColumn: "membership_id",
    hosts: ["proposal"],
    parameterTypes: {},
  },
  {
    name: "export_worker_authority",
    statement:
      "SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json,\n      j.correlation_id,j.lifecycle_status AS root_state,a.lifecycle_status AS attempt_state,\n      a.lease_expires_at > clock_timestamp() AS lease_current,\n      (j.expires_at IS NULL OR j.expires_at > clock_timestamp()) AS job_current,\n      j.cancellation_requested_at IS NOT NULL AS cancellation_requested\n      FROM solution_export_runs x\n      JOIN async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id AND j.job_id=x.root_job_id\n      JOIN async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id\n      JOIN projects p ON p.organization_id=x.organization_id AND p.project_id=x.project_id AND p.lifecycle_status='active'\n      JOIN principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'\n      JOIN memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'\n      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n      WHERE x.organization_id=$1 AND x.project_id=$2 AND x.solution_export_run_id=$3\n        AND x.created_by_principal_id=$4 AND j.created_by_principal_id=$4 AND j.idempotency_actor_id=$4\n        AND j.family='solution-export-orchestration' AND j.input_sha256=$5\n        AND j.solution_revision_id=x.solution_revision_id AND j.solution_manifest_sha256=x.solution_manifest_sha256\n        AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256\n        AND a.attempt_id=$6 AND a.attempt_number=$7 AND a.worker_reference=$8\n        AND a.attempt_number=(SELECT max(current_attempt.attempt_number) FROM async_job_attempts current_attempt\n          WHERE current_attempt.organization_id=j.organization_id AND current_attempt.job_id=j.job_id)\n      FOR SHARE OF p,actor,m,o,r",
    parameterCount: 8,
    identityColumn: "membership_id",
    hosts: ["export"],
    parameterTypes: {
      "7": "integer",
    },
  },
  {
    name: "request_membership",
    statement:
      "SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json FROM memberships m\n      JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n      WHERE m.principal_id=$1 AND m.organization_id=$2 AND m.lifecycle_status='active' FOR SHARE OF m,p,o,r",
    parameterCount: 2,
    identityColumn: "membership_id",
    hosts: ["api", "proposal", "export"],
    parameterTypes: {},
  },
] as const;
/** Fixed point locks shared with the proposed invoker trigger successors. */
export const ordinaryProjectLocks = [
  {
    name: "writer_scope",
    statement:
      "SELECT closed_at FROM project_content_write_scopes WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
    parameterCount: 2,
    identityColumn: null,
    hosts: ["api", "proposal", "export", "cleanup"],
    parameterTypes: {},
  },
  {
    name: "project_scope",
    statement:
      "SELECT p.lifecycle_status,p.record_version,to_char(p.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS requested_at,\n          r.deletion_record_version,to_char(r.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS receipt_requested_at\n          FROM projects p LEFT JOIN project_content_erasure_receipts r USING(organization_id,project_id)\n          WHERE p.organization_id=$1 AND p.project_id=$2 FOR SHARE OF p",
    parameterCount: 2,
    identityColumn: null,
    hosts: ["api", "proposal", "export", "cleanup", "billing"],
    parameterTypes: {},
  },
  {
    name: "staging_membership",
    statement:
      "SELECT m.membership_id FROM memberships m\n        JOIN principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'\n        JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n        JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n          AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n        WHERE m.organization_id=$1 AND m.principal_id=$2 AND m.membership_id=$3\n          AND m.lifecycle_status='active' AND ('projects.create'=ANY(r.capabilities)\n            OR 'projects.mutate'=ANY(r.capabilities) OR 'exports.run'=ANY(r.capabilities))\n        FOR SHARE OF m,actor,o,r",
    parameterCount: 3,
    identityColumn: "membership_id",
    hosts: ["api", "proposal", "export"],
    parameterTypes: {},
  },
  {
    name: "staging_project",
    statement:
      "SELECT organization_id,lifecycle_status FROM projects WHERE project_id=$1 FOR SHARE",
    parameterCount: 1,
    identityColumn: "organization_id",
    hosts: ["api", "proposal", "export"],
    parameterTypes: {},
  },
  {
    name: "cleanup_control",
    statement:
      "SELECT history_required,restore_status FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE",
    parameterCount: 0,
    identityColumn: null,
    hosts: ["api", "proposal", "export", "cleanup", "billing"],
    parameterTypes: {},
  },
] as const;

function unavailable(): never {
  throw new RepositoryError(
    "persistence-unavailable",
    "The ordinary database lock authority is unavailable.",
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((key: unknown) => typeof key === "string")
  );
}

export async function executeOrdinaryRuntimeStatement<TRow extends SqlRow>(
  executor: SqlExecutor,
  host: OrdinaryRuntimeHost,
  statement: SqlStatement,
): Promise<SqlResult<TRow>> {
  // Authorization operations own fixed rereads with explicit tuple receipts and
  // nullable diagnostic anchors. Keep them out of the generic lock-strip path.
  const authorization = await tryExecuteOrdinaryAuthorizationStatement<TRow>(
    executor,
    host,
    statement,
  );
  if (authorization !== undefined) return authorization;
  const binding = [
    ...ordinaryFinancialLocks,
    ...ordinaryProjectLocks,
    ...ordinarySharedLockReads,
    ...ordinaryStaffReferenceLocks,
    ...ordinaryVersionedReferenceLocks,
  ].find((entry) => entry.statement === statement.text);
  if (binding === undefined) return executor.query<TRow>(statement);
  if (
    !(binding.hosts as readonly string[]).includes(host) ||
    statement.values.length !== binding.parameterCount
  )
    unavailable();
  // Every mapping is declared in source. In particular, adjustment replay uses
  // [organization,key,id] while the shared helper accepts [organization,id,key].
  const helperValues =
    "helperArguments" in binding
      ? binding.helperArguments.map((argument) => {
          if ("literal" in argument) return argument.literal;
          const value = statement.values[argument.valueIndex];
          if (value === undefined) unavailable();
          return value;
        })
      : "parameterOrder" in binding
        ? binding.parameterOrder.map((index) => {
            const value = statement.values[index];
            if (value === undefined) unavailable();
            return value;
          })
        : statement.values;
  const locked = await executor.query(
    sql(
      "SELECT locked_keys_json FROM cloudmarkup_ordinary_private.lock_" +
        binding.name +
        "(" +
        helperValues
          .map((_value, index) => "$" + String(index + 1) + "::text")
          .join(",") +
        ")",
      helperValues,
    ),
  );
  if (
    locked.rowCount !== 1 ||
    locked.rows.length !== 1 ||
    typeof locked.rows[0]?.["locked_keys_json"] !== "string"
  )
    unavailable();
  let keys: unknown;
  try {
    keys = JSON.parse(locked.rows[0]["locked_keys_json"]);
  } catch {
    unavailable();
  }
  if (!isStringArray(keys)) unavailable();
  const read = await executor.query<TRow>(
    sql(
      statement.text.replace(
        /\bFOR\s+(?:UPDATE|SHARE)(?:\s+OF\s+[a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)?/giu,
        "",
      ),
      statement.values,
    ),
  );
  if (read.rowCount !== read.rows.length) unavailable();
  const observed = read.rows.map((row) =>
    binding.identityColumn === null ? "fixed" : row[binding.identityColumn],
  );
  if (
    observed.some((key) => typeof key !== "string") ||
    JSON.stringify([...observed].sort()) !== JSON.stringify([...keys].sort())
  )
    unavailable();
  return read;
}
