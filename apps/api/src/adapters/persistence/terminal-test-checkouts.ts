import type { BillingProvider } from "../../application/billing.js";
import type { BillingCheckoutSession } from "../../application/billing-checkout.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";
const fail = (): never => {
  throw Error("Test Checkout requires verified terminal reconciliation.");
};
export async function requireCutoverStaff(
  tx: SqlExecutor,
  principalId: string,
) {
  const result = await tx.query(
    sql(
      "SELECT a.principal_id FROM platform_staff_authorizations a JOIN principals p ON p.principal_id=a.principal_id WHERE a.principal_id=$1 AND a.revoked_at IS NULL AND p.lifecycle_status='active' AND 'operations.manage'=ANY(a.permissions)",
      [principalId],
    ),
  );
  if (result.rows.length !== 1) fail();
}
/** Privileged operator attestation from an exact Stripe request log, not a
 * provider-verified request/session linkage or a customer-supplied claim. */
export interface PendingTestCheckoutEvidence {
  readonly attemptId: string;
  readonly providerRequestId: string;
  readonly providerSessionReference: string;
  readonly operatorReference: string;
  readonly reason: string;
}
interface PendingRequestEvidence extends PendingTestCheckoutEvidence {
  readonly source: "operator-reviewed-stripe-request-log-v1";
  readonly providerIdempotencyKey: string;
  readonly originalRequestKeySha256: string;
  readonly originalRequestSha256: string;
}
export interface TerminalTestCheckout {
  readonly attemptId: string;
  readonly recordVersion: string;
  readonly session: BillingCheckoutSession;
  readonly pendingRequestEvidence?: PendingRequestEvidence;
}
const field = (row: SqlRow, key: string): string => {
  const value = row[key];
  return typeof value === "string" ? value : fail();
};
const bounded = (value: string) =>
  typeof value === "string" &&
  value.length >= 5 &&
  value.length <= 300 &&
  Array.from(value).every(
    (character) =>
      character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );
const reviewedRequestSource = (value: unknown) =>
  value === "operator-reviewed-stripe-request-log-v1";
function validEvidence(input: PendingTestCheckoutEvidence) {
  return (
    /^checkout_[a-f0-9]{32}$/u.test(input.attemptId) &&
    /^req_[A-Za-z0-9_]{1,250}$/u.test(input.providerRequestId) &&
    /^cs_test_[A-Za-z0-9_]{1,247}$/u.test(input.providerSessionReference) &&
    bounded(input.operatorReference) &&
    bounded(input.reason)
  );
}
async function openCheckouts(tx: SqlExecutor) {
  const result = await tx.query(
    sql(
      `SELECT attempt_id,organization_id,billing_account_id,lifecycle_status,provider_session_reference,record_version::text,request_key_sha256,request_sha256,retry_before<=clock_timestamp() AS retry_expired,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,to_char(provider_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at FROM billing_checkout_attempts WHERE lifecycle_status IN ('pending','created') ORDER BY organization_id,attempt_id LIMIT 101`,
    ),
  );
  if (result.rows.length > 100) fail();
  return result.rows;
}
function validate(
  row: SqlRow,
  proof: TerminalTestCheckout,
): TerminalTestCheckout {
  const session = proof.session,
    evidence = proof.pendingRequestEvidence;
  const pending = row["lifecycle_status"] === "pending";
  if (pending) {
    if (
      !evidence ||
      !validEvidence(evidence) ||
      !reviewedRequestSource(evidence.source) ||
      evidence.attemptId !== row["attempt_id"] ||
      evidence.providerIdempotencyKey !== "checkout:" + row["attempt_id"] ||
      evidence.providerSessionReference !== session.providerSessionReference ||
      evidence.originalRequestKeySha256 !== row["request_key_sha256"] ||
      evidence.originalRequestSha256 !== row["request_sha256"] ||
      row["provider_session_reference"] !== null ||
      row["expires_at"] !== null ||
      row["retry_expired"] !== true ||
      !(Date.parse(session.expiresAt) > Date.parse(field(row, "created_at")))
    )
      fail();
  } else if (
    row["lifecycle_status"] !== "created" ||
    evidence !== undefined ||
    session.providerSessionReference !== row["provider_session_reference"] ||
    session.expiresAt !== row["expires_at"]
  )
    fail();
  if (
    proof.attemptId !== row["attempt_id"] ||
    proof.recordVersion !== row["record_version"] ||
    !/^cs_test_[A-Za-z0-9_]{1,247}$/u.test(session.providerSessionReference) ||
    session.organizationId !== row["organization_id"] ||
    session.billingAccountId !== row["billing_account_id"] ||
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    session.url !== null ||
    !(
      (session.status === "expired" &&
        session.providerSubscriptionReference === null) ||
      (session.status === "complete" &&
        typeof session.providerSubscriptionReference === "string" &&
        /^sub_[A-Za-z0-9_]+$/u.test(session.providerSubscriptionReference))
    )
  )
    fail();
  return {
    attemptId: proof.attemptId,
    recordVersion: proof.recordVersion,
    ...(evidence === undefined
      ? {}
      : {
          pendingRequestEvidence: {
            source: evidence.source,
            attemptId: evidence.attemptId,
            providerRequestId: evidence.providerRequestId,
            providerSessionReference: evidence.providerSessionReference,
            providerIdempotencyKey: evidence.providerIdempotencyKey,
            originalRequestKeySha256: evidence.originalRequestKeySha256,
            originalRequestSha256: evidence.originalRequestSha256,
            operatorReference: evidence.operatorReference,
            reason: evidence.reason,
          },
        }),
    session: {
      organizationId: session.organizationId,
      billingAccountId: session.billingAccountId,
      providerSessionReference: session.providerSessionReference,
      providerSubscriptionReference: session.providerSubscriptionReference,
      expiresAt: session.expiresAt,
      status: session.status,
      url: null,
    },
  };
}
/** Fresh GET-only reads; operator attestation handles only expired-retry pending
 * attempts and never authorizes a new provider request or payment. */
export async function inspectTerminalTestCheckouts(
  tx: SqlExecutor,
  principalId: string,
  providerFactory: () => Promise<Pick<BillingProvider, "getCheckoutSession">>,
  pendingEvidence: readonly PendingTestCheckoutEvidence[] = [],
): Promise<readonly TerminalTestCheckout[]> {
  await requireCutoverStaff(tx, principalId);
  if (
    pendingEvidence.length > 100 ||
    pendingEvidence.some((e) => !validEvidence(e)) ||
    new Set(pendingEvidence.map((e) => e.attemptId)).size !==
      pendingEvidence.length ||
    new Set(pendingEvidence.map((e) => e.providerRequestId)).size !==
      pendingEvidence.length ||
    new Set(pendingEvidence.map((e) => e.providerSessionReference)).size !==
      pendingEvidence.length
  )
    fail();
  const completed = await tx.query(
    sql(
      "SELECT cutover_id FROM billing_provider_cutovers WHERE cutover_id='stripe-test-to-live-v1'",
    ),
  );
  if (completed.rows.length) return [];
  const rows = await openCheckouts(tx);
  if (
    pendingEvidence.some(
      (e) =>
        !rows.some(
          (row) =>
            row["attempt_id"] === e.attemptId &&
            row["lifecycle_status"] === "pending" &&
            row["retry_expired"] === true,
        ),
    )
  )
    fail();
  const assigned = rows.map((row) => {
    const evidence = pendingEvidence.find(
      (e) => e.attemptId === row["attempt_id"],
    );
    if (row["lifecycle_status"] === "pending") {
      if (
        !evidence ||
        row["retry_expired"] !== true ||
        row["provider_session_reference"] !== null ||
        row["expires_at"] !== null
      )
        return fail();
      return { row, reference: evidence.providerSessionReference, evidence };
    }
    const reference = field(row, "provider_session_reference");
    if (
      row["lifecycle_status"] !== "created" ||
      evidence ||
      !/^cs_test_[A-Za-z0-9_]{1,247}$/u.test(reference)
    )
      return fail();
    return { row, reference };
  });
  if (new Set(assigned.map((a) => a.reference)).size !== assigned.length)
    fail();
  if (!assigned.length) return [];
  const provider = await providerFactory(),
    proofs: TerminalTestCheckout[] = [];
  for (const { row, reference, evidence } of assigned) {
    const session = await provider.getCheckoutSession({
      organizationId: field(row, "organization_id"),
      billingAccountId: field(row, "billing_account_id"),
      providerSessionReference: reference,
    });
    if (session.providerSessionReference !== reference) fail();
    proofs.push(
      validate(row, {
        attemptId: field(row, "attempt_id"),
        recordVersion: field(row, "record_version"),
        session,
        ...(evidence === undefined
          ? {}
          : {
              pendingRequestEvidence: {
                ...evidence,
                source: "operator-reviewed-stripe-request-log-v1" as const,
                providerIdempotencyKey: "checkout:" + evidence.attemptId,
                originalRequestKeySha256: field(row, "request_key_sha256"),
                originalRequestSha256: field(row, "request_sha256"),
              },
            }),
      }),
    );
  }
  return proofs;
}
export async function validateTerminalTestCheckouts(
  tx: SqlExecutor,
  proofs: readonly TerminalTestCheckout[],
) {
  const rows = await openCheckouts(tx);
  if (
    rows.length !== proofs.length ||
    new Set(proofs.map((p) => p.attemptId)).size !== proofs.length ||
    new Set(proofs.map((p) => p.session.providerSessionReference)).size !==
      proofs.length
  )
    fail();
  return rows.map((row) => {
    const proof = proofs.find((p) => p.attemptId === row["attempt_id"]);
    return proof ? validate(row, proof) : fail();
  });
}
