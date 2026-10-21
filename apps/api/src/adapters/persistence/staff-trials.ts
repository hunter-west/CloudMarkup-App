import {
  STAFF_TRIAL_PLAN_VERSION,
  STAFF_TRIAL_POLICY_VERSION,
  ENTITLEMENT_POLICY_VERSION,
  staffTrialState,
} from "@cloudmarkup/domain";
import {
  staffTrialV1Schema,
  type StaffAccountActionV1,
  type StaffAccountV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "../../application/ports.js";
import { ApplicationError } from "../../application/errors.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { parseDatabaseTimestamp } from "./database-timestamp.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";
const conflict = (message: string): never => {
  throw new ApplicationError("conflict", message);
};
export async function readStaffTrial(tx: SqlExecutor, organizationId: string) {
  const row = (
    await tx.query(
      sql(
        `SELECT t.*,clock_timestamp() AS as_of,
      e.plan_version_id IS DISTINCT FROM $2 AS superseded,
      COALESCE(a.reserved,0)::text AS reserved,
      GREATEST(0,t.credit_units-COALESCE(l.settled,0)+COALESCE(l.adjustments,0)-COALESCE(a.reserved,0))::text AS available
    FROM platform_staff_trials t LEFT JOIN organization_entitlement_snapshots e ON e.organization_id=t.organization_id
    LEFT JOIN LATERAL(SELECT sum(settled_credit_units) AS settled,sum(credit_adjustment_units) AS adjustments FROM usage_ledger_entry_allocations WHERE organization_id=t.organization_id AND credit_grant_id=t.credit_grant_id)l ON true
    LEFT JOIN LATERAL(SELECT sum(a.reserved_credit_units) AS reserved FROM credit_reservation_allocations a JOIN credit_reservations r ON r.organization_id=a.organization_id AND r.reservation_id=a.reservation_id WHERE a.organization_id=t.organization_id AND a.credit_grant_id=t.credit_grant_id AND r.status='active')a ON true
    WHERE t.organization_id=$1`,
        [organizationId, STAFF_TRIAL_PLAN_VERSION],
      ),
    )
  ).rows[0];
  if (!row) return undefined;
  const timestamp = (value: unknown) => {
    const date = parseDatabaseTimestamp(value);
    if (!date) throw Error("Invalid trial clock");
    return date;
  };
  const startsAt = timestamp(row["starts_at"]),
    expiresAt = timestamp(row["expires_at"]);
  const state = staffTrialState({
    startsAt,
    expiresAt,
    asOf: timestamp(row["as_of"]),
    revoked: row["revoked_action_id"] !== null,
    superseded: row["superseded"] === true,
  });
  return staffTrialV1Schema.parse({
    contractVersion: 1,
    id: row["trial_id"],
    creditGrantId: row["credit_grant_id"],
    startsAt,
    expiresAt,
    state,
    creditUnits: String(row["credit_units"]),
    availableCreditUnits: state === "active" ? String(row["available"]) : "0",
    reservedCreditUnits: String(row["reserved"]),
  });
}
/** Caller holds canonical staff/session and billing-account locks. All effects and receipt share that transaction. */
export async function applyStaffTrial(
  tx: SqlExecutor,
  actor: PrincipalContext,
  target: StaffAccountV1,
  value: Extract<
    StaffAccountActionV1,
    { action: "grant-trial" | "revoke-trial" }
  >,
  clock: string,
  actionId: string,
) {
  const context = {
    authority: "internal-administration" as const,
    actorId: actor.principalId,
    actorPrincipalId: actor.principalId,
    organizationId: target.organizationId,
    correlationId: actor.correlationId,
  };
  const bound: SqlDatabase = {
    query: (statement) => tx.query(statement),
    transaction: (work) => work(tx),
    close: () => Promise.resolve(),
  };
  const commercial = new PostgresCommercialPersistenceRepository(bound);
  const ledgerId = "ledger_" + actionId;
  if (value.action === "grant-trial") {
    if (!target.expensiveOperationsEnabled)
      conflict("Resolve the operations pause before granting a trial.");
    const subscription = (
      await tx.query(
        sql(
          "SELECT normalized_status FROM organization_subscription_projections WHERE organization_id=$1 FOR SHARE",
          [target.organizationId],
        ),
      )
    ).rows[0];
    if (
      subscription?.["normalized_status"] !== undefined &&
      subscription["normalized_status"] !== "canceled"
    )
      conflict("A trial requires an unsubscribed or canceled account.");
    if (
      (
        await tx.query(
          sql(
            "SELECT trial_id FROM platform_staff_trials WHERE organization_id=$1",
            [target.organizationId],
          ),
        )
      ).rows.length
    )
      conflict("This account has already received its trial.");
    if (
      (
        await tx.query(
          sql(
            "SELECT 1 FROM credit_reservations WHERE organization_id=$1 AND status='active' LIMIT 1",
            [target.organizationId],
          ),
        )
      ).rows.length
    )
      conflict("Resolve outstanding reservations before granting a trial.");
    const trialId = "trial_" + actionId,
      grantId = "grant_" + actionId;
    const expiresAt = new Date(
      Date.parse(clock) + value.expiresInDays * 86400000,
    ).toISOString();
    await commercial.createCreditGrant(
      { ...context, authority: "internal-accounting" },
      {
        creditGrantId: grantId,
        ledgerEntryId: ledgerId,
        creditUnits: String(value.creditUnits),
        grantKind: "promotional",
        startsAt: clock,
        expirationPolicy: {
          kind: "expires-at",
          expiresAt,
          policyVersion: STAFF_TRIAL_POLICY_VERSION,
        },
        grantPolicyVersion: STAFF_TRIAL_POLICY_VERSION,
        chargingPolicyVersion: STAFF_TRIAL_POLICY_VERSION,
        consumptionPriority: "10",
        idempotencyKey: actionId,
        reasonCode: "staff.trial-grant",
        safeReason: value.reason,
        sourceReference: "staff-trial:" + trialId,
      },
    );
    await tx.query(
      sql(
        `INSERT INTO platform_staff_trials(trial_id,organization_id,billing_account_id,credit_grant_id,granted_action_id,starts_at,expires_at,credit_units) VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8)`,
        [
          trialId,
          target.organizationId,
          target.billingAccountId,
          grantId,
          actionId,
          clock,
          expiresAt,
          value.creditUnits,
        ],
      ),
    );
    // This is an effective access projection, never payment/subscription evidence.
    await tx.query(
      sql(
        `INSERT INTO organization_entitlement_snapshots(organization_id,entitlement_snapshot_id,billing_account_id,subscription_projection_id,plan_version_id,entitlement_policy_version,source_record_version,expensive_operations_enabled,effective_at)
    VALUES($1,$2,$3,NULL,$4,$5,$6,true,$7::timestamptz)
    ON CONFLICT(organization_id) DO UPDATE SET subscription_projection_id=NULL,plan_version_id=EXCLUDED.plan_version_id,entitlement_policy_version=EXCLUDED.entitlement_policy_version,source_record_version=EXCLUDED.source_record_version,expensive_operations_enabled=true,effective_at=EXCLUDED.effective_at,record_version=organization_entitlement_snapshots.record_version+1,updated_at=clock_timestamp()`,
        [
          target.organizationId,
          "entitlement_" + actionId,
          target.billingAccountId,
          STAFF_TRIAL_PLAN_VERSION,
          ENTITLEMENT_POLICY_VERSION,
          target.version + 1,
          clock,
        ],
      ),
    );
    return {
      trialId,
      trialExpiresAt: expiresAt,
      creditGrantId: grantId,
      creditUnits: String(value.creditUnits),
      ledgerEntryId: ledgerId,
    };
  }
  const trial = await readStaffTrial(tx, target.organizationId);
  if (trial?.id !== value.trialId)
    throw new ApplicationError(
      "not_found",
      "This trial is unavailable on this account.",
    );
  if (trial.state === "revoked")
    conflict("This trial has already been revoked.");
  const grant = (
    await tx.query(
      sql(
        "SELECT ledger_entry_id FROM platform_staff_account_actions WHERE organization_id=$1 AND action='grant-trial' AND credit_grant_id=$2",
        [target.organizationId, trial.creditGrantId],
      ),
    )
  ).rows[0];
  if (typeof grant?.["ledger_entry_id"] !== "string")
    throw Error("Trial audit evidence unavailable");
  // Debit only currently available credit. Released held credit stays ineligible by trial state.
  if (BigInt(trial.availableCreditUnits) > 0n)
    await commercial.appendCompensatingAdjustment(context, {
      creditGrantId: trial.creditGrantId,
      adjustmentCreditUnits: String(-BigInt(trial.availableCreditUnits)),
      ledgerEntryId: ledgerId,
      relatedLedgerEntryId: grant["ledger_entry_id"],
      chargingPolicyVersion: STAFF_TRIAL_POLICY_VERSION,
      idempotencyKey: actionId,
      reasonCode: "staff.trial-revocation",
      safeReason: value.reason,
    });
  // Projection marker fences released credits for paid-only readers and old runtimes.
  // Restrict this write to the trial projection; converted paid access is preserved.
  await tx.query(
    sql(
      "UPDATE organization_entitlement_snapshots SET expensive_operations_enabled=false,record_version=record_version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND plan_version_id=$2 AND subscription_projection_id IS NULL",
      [target.organizationId, STAFF_TRIAL_PLAN_VERSION],
    ),
  );
  await tx.query(
    sql(
      "UPDATE platform_staff_trials SET revoked_action_id=$2 WHERE organization_id=$1 AND trial_id=$3 AND revoked_action_id IS NULL",
      [target.organizationId, actionId, trial.id],
    ),
  );
  return {
    trialId: trial.id,
    trialExpiresAt: trial.expiresAt,
    creditGrantId: trial.creditGrantId,
    creditUnits: trial.availableCreditUnits,
    ledgerEntryId: BigInt(trial.availableCreditUnits) > 0n ? ledgerId : null,
  };
}
