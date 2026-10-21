import {
  requireCutoverStaff,
  validateTerminalTestCheckouts,
  type TerminalTestCheckout,
} from "./terminal-test-checkouts.js";
export { inspectTerminalTestCheckouts } from "./terminal-test-checkouts.js";
export { StripeBillingProvider } from "../billing/stripe-billing-provider.js";
export { decodeStripeSandboxApiKey } from "../billing/stripe-sandbox-secret.js";
import { createHash, randomUUID } from "node:crypto";
import {
  staffPermissionV1Schema,
  type StaffPermissionV1,
} from "@cloudmarkup/api-contract";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { lockAccountSessions } from "./account-sessions.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";
export { RdsDataApiDatabase } from "./rds-data-driver.js";
const fail = (): never => {
  throw Error("Operator preconditions changed or are not satisfied.");
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const bounded = (value: string) =>
  value.length >= 5 &&
  value.length <= 300 &&
  Array.from(value).every(
    (character) =>
      character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );
export interface StaffOperatorInput {
  readonly issuer: string;
  readonly subject: string;
  readonly principalId: string;
  readonly operatorReference: string;
  readonly reason: string;
  readonly permissions: readonly StaffPermissionV1[];
  readonly action: "authorized" | "revoked";
}
/** Operator-only entry point. Identity is resolved with verified Cognito state by
 * the CLI, then matched to the immutable database mapping. Never exposed in HTTP. */
export async function prepareStaffAuthorization(
  tx: SqlExecutor,
  input: StaffOperatorInput,
) {
  if (
    !id(input.principalId) ||
    !bounded(input.operatorReference) ||
    !bounded(input.reason) ||
    !/^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/u.test(
      input.issuer,
    ) ||
    !input.subject ||
    input.subject.length > 255 ||
    !["authorized", "revoked"].includes(input.action) ||
    input.permissions.length < 1 ||
    input.permissions.length > 6 ||
    new Set(input.permissions).size !== input.permissions.length ||
    !input.permissions.every(
      (p) => staffPermissionV1Schema.safeParse(p).success,
    )
  )
    fail();
  const found = await tx.query(
    sql(
      "SELECT p.principal_id,p.lifecycle_status FROM principal_identity_references i JOIN principals p ON p.principal_id=i.principal_id WHERE i.identity_provider='cognito' AND i.issuer=$1 AND i.subject_reference=$2 AND p.principal_id=$3",
      [input.issuer, input.subject, input.principalId],
    ),
  );
  if (
    found.rows.length !== 1 ||
    (input.action !== "revoked" &&
      found.rows[0]?.["lifecycle_status"] !== "active")
  )
    fail();
  const previous =
    (
      await tx.query(
        sql(
          "SELECT permissions,record_version::text,revoked_at IS NOT NULL AS revoked FROM platform_staff_authorizations WHERE principal_id=$1",
          [input.principalId],
        ),
      )
    ).rows[0] ?? null;
  const preview = {
    principalId: input.principalId,
    permissions: [...input.permissions].sort(),
    action: input.action,
    previous,
    operatorReference: input.operatorReference,
    reason: input.reason,
  };
  return { ...preview, digest: hash({ input, previous }) };
}
export async function applyStaffAuthorization(
  database: SqlDatabase,
  input: StaffOperatorInput,
  confirmation: string,
) {
  return database.transaction(async (tx) => {
    await lockAccountSessions(tx, input.principalId);
    const preview = await prepareStaffAuthorization(tx, input);
    if (preview.digest !== confirmation) fail();
    if (input.action === "revoked" && preview.previous === null) fail();
    await tx.query(
      sql(
        `INSERT INTO platform_staff_authorizations(principal_id,permissions,revoked_at) VALUES($1,ARRAY(SELECT jsonb_array_elements_text($2::jsonb)),CASE WHEN $3='revoked' THEN clock_timestamp() ELSE NULL END)
   ON CONFLICT(principal_id) DO UPDATE SET permissions=EXCLUDED.permissions,revoked_at=EXCLUDED.revoked_at,record_version=platform_staff_authorizations.record_version+1`,
        [input.principalId, JSON.stringify(preview.permissions), input.action],
      ),
    );
    const eventId = "staff_authority_" + randomUUID().replaceAll("-", "");
    await tx.query(
      sql(
        "INSERT INTO platform_staff_authorization_events(event_id,principal_id,permissions,action,operator_reference,reason) VALUES($1,$2,ARRAY(SELECT jsonb_array_elements_text($3::jsonb)),$4,$5,$6)",
        [
          eventId,
          input.principalId,
          JSON.stringify(preview.permissions),
          input.action,
          input.operatorReference,
          input.reason,
        ],
      ),
    );
    return {
      eventId,
      principalId: input.principalId,
      action: input.action,
      permissions: preview.permissions,
    };
  });
}
const cutoverId = "stripe-test-to-live-v1";
/** Safe metadata only. No mutation and no payment-provider calls. */
export async function prepareLiveBillingCutover(
  tx: SqlExecutor,
  actorPrincipalId: string,
  terminalCheckouts: readonly TerminalTestCheckout[] = [],
) {
  if (!id(actorPrincipalId)) fail();
  await requireCutoverStaff(tx, actorPrincipalId);
  const completed = (
    await tx.query(
      sql(
        "SELECT receipt_json FROM billing_provider_cutovers WHERE cutover_id=$1",
        [cutoverId],
      ),
    )
  ).rows[0];
  if (completed)
    return {
      alreadyCompleted: true as const,
      receipt: completed["receipt_json"],
    };
  const checkouts = await validateTerminalTestCheckouts(tx, terminalCheckouts);
  const state = (
    await tx.query(
      sql(`SELECT (SELECT count(*)::text FROM credit_reservations WHERE status='active') AS reservations,
 (SELECT count(*)::text FROM credit_top_up_attempts WHERE lifecycle_status IN ('pending','created','review')) AS topups,
 (SELECT count(*)::text FROM billing_webhook_events WHERE lifecycle_status='received') AS events,
 (SELECT count(*)::text FROM organization_subscription_projections WHERE provider_environment='live') AS live_projections`),
    )
  ).rows[0];
  if (!state || Object.values(state).some((value) => value !== "0")) fail();
  const projections = (
    await tx.query(
      sql(
        "SELECT s.organization_id,s.billing_account_id,s.subscription_projection_id,s.record_version::text,s.provider_customer_reference,s.provider_subscription_reference,s.provider_environment,s.normalized_status,a.record_version::text AS account_version FROM organization_subscription_projections s JOIN organization_billing_accounts a ON a.organization_id=s.organization_id ORDER BY s.organization_id LIMIT 5001",
      ),
    )
  ).rows;
  const grants = (
    await tx.query(
      sql(`SELECT g.organization_id,g.credit_grant_id,g.credit_units::text,g.grant_policy_version,(SELECT l.ledger_entry_id FROM usage_ledger_entries l WHERE l.organization_id=g.organization_id AND ((l.credit_grant_id=g.credit_grant_id AND l.entry_kind='grant') OR EXISTS(SELECT 1 FROM usage_ledger_entry_allocations a WHERE a.organization_id=l.organization_id AND a.ledger_entry_id=l.ledger_entry_id AND a.credit_grant_id=g.credit_grant_id AND a.credit_adjustment_units>0)) ORDER BY l.ledger_entry_id LIMIT 1) AS source_ledger_id,g.starts_at>clock_timestamp() AS future,g.expires_at IS NOT NULL AND g.expires_at<=clock_timestamp() AS expired,
 ((CASE WHEN g.grant_kind='administrative' THEN 0 ELSE g.credit_units END)-COALESCE((SELECT sum(a.settled_credit_units)-sum(a.credit_adjustment_units) FROM usage_ledger_entry_allocations a WHERE a.organization_id=g.organization_id AND a.credit_grant_id=g.credit_grant_id),0))::text AS remaining
 FROM credit_grants g WHERE g.grant_policy_version NOT IN ('cloudmarkup-staff-credits-v1','cloudmarkup-staff-trial-v1') ORDER BY g.organization_id,g.credit_grant_id LIMIT 5001`),
    )
  ).rows;
  if (
    projections.length > 5000 ||
    grants.length > 5000 ||
    grants.some((g) => g["future"] === true && g["remaining"] !== "0")
  )
    fail();
  const value = { cutoverId, actorPrincipalId, projections, grants, checkouts };
  return { alreadyCompleted: false as const, ...value, digest: hash(value) };
}
/** One-way operator transaction. Stops if any payment/usage work is unresolved.
 * Preserve provider facts in an immutable archive and remove unused test credits
 * through the same append-only debit accounting used by staff revocation. */
export async function applyLiveBillingCutover(
  database: SqlDatabase,
  actorPrincipalId: string,
  confirmation: string,
  terminalCheckouts: readonly TerminalTestCheckout[] = [],
) {
  return database.transaction(async (tx) => {
    await tx.query(
      sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [cutoverId]),
    );
    await lockAccountSessions(tx, actorPrincipalId);
    await tx.query(
      sql(
        "SELECT principal_id FROM platform_staff_authorizations WHERE principal_id=$1 FOR SHARE",
        [actorPrincipalId],
      ),
    );
    await tx.query(
      sql(
        "LOCK TABLE organization_billing_accounts, organization_subscription_projections, organization_entitlement_snapshots, credit_grants, credit_reservations, billing_checkout_attempts, credit_top_up_attempts, billing_webhook_events IN SHARE ROW EXCLUSIVE MODE",
      ),
    );
    await tx.query(
      sql(
        "SELECT billing_account_id FROM organization_billing_accounts ORDER BY organization_id FOR UPDATE",
      ),
    );
    const preview = await prepareLiveBillingCutover(
      tx,
      actorPrincipalId,
      terminalCheckouts,
    );
    if (preview.alreadyCompleted) return preview.receipt;
    if (preview.digest !== confirmation) fail();
    for (const proof of preview.checkouts) {
      let recordVersion = proof.recordVersion;
      if (proof.pendingRequestEvidence !== undefined) {
        const evidence = proof.pendingRequestEvidence;
        const recorded = await tx.query(
          sql(
            "UPDATE billing_checkout_attempts SET lifecycle_status='created',provider_session_reference=$3,provider_expires_at=$4::timestamptz,record_version=record_version+1 WHERE attempt_id=$1 AND record_version=$2::bigint AND organization_id=$5 AND billing_account_id=$6 AND lifecycle_status='pending' AND provider_session_reference IS NULL AND request_sha256=$7 AND request_key_sha256=$8 AND retry_before<=clock_timestamp()",
            [
              proof.attemptId,
              recordVersion,
              proof.session.providerSessionReference,
              proof.session.expiresAt,
              proof.session.organizationId,
              proof.session.billingAccountId,
              evidence.originalRequestSha256,
              evidence.originalRequestKeySha256,
            ],
          ),
        );
        if (recorded.rowCount !== 1) fail();
        recordVersion = (BigInt(recordVersion) + 1n).toString();
      }
      const result = await tx.query(
        sql(
          "UPDATE billing_checkout_attempts SET lifecycle_status=$4,retired_at=clock_timestamp(),record_version=record_version+1 WHERE attempt_id=$1 AND record_version=$2::bigint AND provider_session_reference=$3 AND organization_id=$5 AND billing_account_id=$6 AND lifecycle_status='created'",
          [
            proof.attemptId,
            recordVersion,
            proof.session.providerSessionReference,
            proof.session.status === "expired" ? "expired" : "consumed",
            proof.session.organizationId,
            proof.session.billingAccountId,
          ],
        ),
      );
      if (result.rowCount !== 1) fail();
    }
    const bound: SqlDatabase = {
      query: (statement) => tx.query(statement),
      transaction: (work) => work(tx),
      close: () => Promise.resolve(),
    };
    const commercial = new PostgresCommercialPersistenceRepository(bound);
    let removed = 0n;
    for (const grant of preview.grants) {
      const remaining = BigInt(String(grant["remaining"]));
      if (remaining <= 0n || grant["expired"] === true) continue;
      const organizationId = String(grant["organization_id"]),
        creditGrantId = String(grant["credit_grant_id"]);
      const token = hash({ cutoverId, organizationId, creditGrantId }).slice(
        0,
        40,
      );
      const sourceLedger = grant["source_ledger_id"];
      if (typeof sourceLedger !== "string") return fail();
      await commercial.appendCompensatingAdjustment(
        {
          authority: "internal-administration",
          actorId: actorPrincipalId,
          actorPrincipalId,
          organizationId,
          correlationId: cutoverId,
        },
        {
          creditGrantId,
          relatedLedgerEntryId: sourceLedger,
          adjustmentCreditUnits: (-remaining).toString(),
          ledgerEntryId: "ledger_cutover_" + token,
          idempotencyKey: "cutover_" + token,
          chargingPolicyVersion: cutoverId,
          reasonCode: "billing.test-mode-retired",
          safeReason:
            "Retired unused test-mode credits during reviewed live billing cutover.",
        },
      );
      removed += remaining;
    }
    await tx.query(
      sql(
        "INSERT INTO billing_cutover_projection_history(organization_id,projection_json,entitlement_json) SELECT s.organization_id,to_jsonb(s),to_jsonb(e) FROM organization_subscription_projections s LEFT JOIN organization_entitlement_snapshots e ON e.organization_id=s.organization_id WHERE s.provider_environment='test'",
      ),
    );
    await tx.query(
      sql(
        "UPDATE organization_subscription_projections SET normalized_status='canceled',cancel_at_period_end=false,record_version=record_version+1,updated_at=clock_timestamp() WHERE provider_environment='test'",
      ),
    );
    await tx.query(
      sql(
        "UPDATE organization_entitlement_snapshots e SET expensive_operations_enabled=false,source_record_version=s.record_version,record_version=e.record_version+1,updated_at=clock_timestamp() FROM organization_subscription_projections s WHERE s.organization_id=e.organization_id AND s.provider_environment='test'",
      ),
    );
    const receipt = {
      cutoverId,
      actorPrincipalId,
      previewDigest: preview.digest,
      archivedProjections: preview.projections.length,
      retiredTestCheckouts: preview.checkouts.length,
      checkoutEvidence: preview.checkouts,
      removedTestCreditUnits: removed.toString(),
    };
    await tx.query(
      sql(
        "INSERT INTO billing_provider_cutovers(cutover_id,actor_principal_id,receipt_json) VALUES($1,$2,$3::jsonb)",
        [cutoverId, actorPrincipalId, JSON.stringify(receipt)],
      ),
    );
    return receipt;
  });
}
