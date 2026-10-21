import { createHash } from "node:crypto";
import {
  CREDIT_TOP_UP_POLICY_VERSION,
  creditTopUpPack,
} from "@cloudmarkup/domain";
import { BillingApplicationError } from "../../application/billing-errors.js";
import type {
  CreditTopUpAttempt,
  CreditTopUpPersistence,
  CreditTopUpPurchase,
  CreditTopUpSession,
} from "../../application/billing-top-ups.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

function unavailable(): never {
  throw new BillingApplicationError(
    "provider-unavailable",
    "The credit purchase is unavailable.",
  );
}
function conflict(): never {
  throw new BillingApplicationError(
    "idempotency-conflict",
    "Credit purchase evidence conflicts with its durable attempt.",
  );
}
function string(value: unknown): string {
  if (typeof value !== "string") return unavailable();
  return value;
}
function optional(value: unknown): string | null {
  return value === null ? null : string(value);
}
const columns = `attempt_id, organization_id, billing_account_id, provider_customer_reference, pack_key, policy_version, credit_units, price_micros,
 request_key_sha256, request_sha256, lifecycle_status, provider_session_reference, provider_payment_reference, review_reason,
 to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
 to_char(retry_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS retry_before,
 to_char(provider_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS provider_expires_at`;
function map(row: SqlRow | undefined): CreditTopUpAttempt {
  if (row === undefined) return unavailable();
  const pack = creditTopUpPack(row["pack_key"]),
    state = string(row["lifecycle_status"]),
    review = optional(row["review_reason"]);
  if (
    pack === undefined ||
    row["policy_version"] !== CREDIT_TOP_UP_POLICY_VERSION ||
    String(row["credit_units"]) !== String(pack.creditUnits) ||
    String(row["price_micros"]) !== String(pack.priceMicros) ||
    !["pending", "created", "expired", "fulfilled", "review"].includes(state) ||
    (review !== null &&
      !["refund", "dispute", "account-unavailable"].includes(review))
  )
    return unavailable();
  return {
    attemptId: string(row["attempt_id"]),
    organizationId: string(row["organization_id"]),
    billingAccountId: string(row["billing_account_id"]),
    providerCustomerReference: string(row["provider_customer_reference"]),
    packKey: pack.key,
    policyVersion: CREDIT_TOP_UP_POLICY_VERSION,
    requestKeySha256: string(row["request_key_sha256"]),
    requestSha256: string(row["request_sha256"]),
    createdAt: string(row["created_at"]),
    retryBefore: string(row["retry_before"]),
    state: state as CreditTopUpAttempt["state"],
    providerSessionReference: optional(row["provider_session_reference"]),
    providerExpiresAt: optional(row["provider_expires_at"]),
    providerPaymentReference: optional(row["provider_payment_reference"]),
    reviewReason: review as CreditTopUpAttempt["reviewReason"],
  };
}
function bound(
  attempt: CreditTopUpPurchase,
  session: CreditTopUpSession,
): void {
  const other = session.purchase;
  if (
    attempt.attemptId !== other.attemptId ||
    attempt.organizationId !== other.organizationId ||
    attempt.billingAccountId !== other.billingAccountId ||
    attempt.providerCustomerReference !== other.providerCustomerReference ||
    attempt.packKey !== other.packKey ||
    attempt.policyVersion !== other.policyVersion ||
    !/^cs_(?:test|live)_[A-Za-z0-9_]{1,247}$/u.test(
      session.providerSessionReference,
    ) ||
    !Number.isFinite(Date.parse(session.expiresAt))
  )
    conflict();
}
function transactionDatabase(tx: SqlExecutor): SqlDatabase {
  return {
    query: (statement) => tx.query(statement),
    close: () => Promise.resolve(),
    transaction: (work) => work(tx),
  };
}
export class PostgresCreditTopUpPersistence implements CreditTopUpPersistence {
  readonly database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.database = database;
  }
  async #authorized<T>(
    scope: AuthorizedOrganizationScope,
    purchase: CreditTopUpPurchase,
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    if (
      scope.organizationId !== purchase.organizationId ||
      !scope.capabilities.includes("billing.manage")
    )
      return unavailable();
    return this.database.transaction(async (tx) => {
      const result = await tx.query(
        sql(
          `SELECT a.billing_account_id FROM organization_billing_accounts a
     JOIN memberships m ON m.organization_id=a.organization_id AND m.principal_id=$3 AND m.membership_id=$4 AND m.lifecycle_status='active'
     JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
     JOIN organizations o ON o.organization_id=a.organization_id AND o.lifecycle_status='active'
     JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2' AND 'billing.manage'=ANY(r.capabilities)
     WHERE a.organization_id=$1 AND a.billing_account_id=$2 AND a.lifecycle_status='active'
     FOR UPDATE OF a FOR SHARE OF m,p,o,r`,
          [
            purchase.organizationId,
            purchase.billingAccountId,
            scope.principalId,
            scope.membershipId,
          ],
        ),
      );
      if (result.rows.length !== 1) return unavailable();
      // Fresh statement after the account lock observes any committed subscription change.
      const active = await tx.query(
        sql(
          `SELECT 1 FROM organization_subscription_projections s JOIN organization_billing_accounts a
     ON a.organization_id=s.organization_id AND a.billing_account_id=s.billing_account_id
     WHERE s.organization_id=$1 AND s.billing_account_id=$2 AND s.provider_customer_reference=$3
       AND s.normalized_status='active' AND a.expensive_operations_enabled=TRUE`,
          [
            purchase.organizationId,
            purchase.billingAccountId,
            purchase.providerCustomerReference,
          ],
        ),
      );
      if (active.rows.length !== 1) return unavailable();
      return work(tx);
    });
  }
  async #get(
    tx: SqlExecutor,
    purchase: Pick<
      CreditTopUpPurchase,
      "organizationId" | "billingAccountId" | "attemptId"
    >,
  ): Promise<CreditTopUpAttempt> {
    const result = await tx.query(
      sql(
        `SELECT ${columns} FROM credit_top_up_attempts WHERE organization_id=$1 AND billing_account_id=$2 AND attempt_id=$3 FOR UPDATE`,
        [
          purchase.organizationId,
          purchase.billingAccountId,
          purchase.attemptId,
        ],
      ),
    );
    return map(result.rows[0]);
  }
  claim(
    scope: AuthorizedOrganizationScope,
    input: CreditTopUpPurchase & {
      readonly requestKeySha256: string;
      readonly requestSha256: string;
    },
  ): Promise<CreditTopUpAttempt> {
    const pack = creditTopUpPack(input.packKey);
    if (
      pack === undefined ||
      input.policyVersion !== CREDIT_TOP_UP_POLICY_VERSION ||
      !/^topup_[a-f0-9]{32}$/u.test(input.attemptId) ||
      !/^[a-f0-9]{64}$/u.test(input.requestKeySha256) ||
      !/^[a-f0-9]{64}$/u.test(input.requestSha256)
    )
      return Promise.reject(
        new BillingApplicationError(
          "invalid-provider-event",
          "The credit pack is invalid.",
        ),
      );
    return this.#authorized(scope, input, async (tx) => {
      const found = await tx.query(
        sql(
          `SELECT ${columns} FROM credit_top_up_attempts WHERE organization_id=$1 AND billing_account_id=$2
      AND (request_key_sha256=$3 OR lifecycle_status IN ('pending','created')) ORDER BY (request_key_sha256=$3) DESC LIMIT 1`,
          [
            input.organizationId,
            input.billingAccountId,
            input.requestKeySha256,
          ],
        ),
      );
      if (found.rows[0] !== undefined) return map(found.rows[0]);
      const result = await tx.query(
        sql(
          `INSERT INTO credit_top_up_attempts(attempt_id,organization_id,billing_account_id,provider_customer_reference,pack_key,policy_version,credit_units,price_micros,request_key_sha256,request_sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7::bigint,$8::bigint,$9,$10) RETURNING ${columns}`,
          [
            input.attemptId,
            input.organizationId,
            input.billingAccountId,
            input.providerCustomerReference,
            input.packKey,
            input.policyVersion,
            String(pack.creditUnits),
            String(pack.priceMicros),
            input.requestKeySha256,
            input.requestSha256,
          ],
        ),
      );
      return map(result.rows[0]);
    });
  }
  async #record(
    tx: SqlExecutor,
    current: CreditTopUpAttempt,
    session: CreditTopUpSession,
  ): Promise<CreditTopUpAttempt> {
    bound(current, session);
    if (current.providerSessionReference !== null) {
      if (
        current.providerSessionReference !== session.providerSessionReference ||
        current.providerExpiresAt !== session.expiresAt
      )
        conflict();
      return current;
    }
    if (current.state !== "pending") conflict();
    const result = await tx.query(
      sql(
        `UPDATE credit_top_up_attempts SET lifecycle_status='created',provider_session_reference=$4,provider_expires_at=$5::timestamptz,record_version=record_version+1
   WHERE organization_id=$1 AND billing_account_id=$2 AND attempt_id=$3 AND lifecycle_status='pending' RETURNING ${columns}`,
        [
          current.organizationId,
          current.billingAccountId,
          current.attemptId,
          session.providerSessionReference,
          session.expiresAt,
        ],
      ),
    );
    return map(result.rows[0]);
  }
  record(
    scope: AuthorizedOrganizationScope,
    attempt: CreditTopUpAttempt,
    session: CreditTopUpSession,
  ): Promise<CreditTopUpAttempt> {
    bound(attempt, session);
    return this.#authorized(scope, attempt, async (tx) => {
      const current = await this.#get(tx, attempt);
      if (
        current.requestKeySha256 !== attempt.requestKeySha256 ||
        current.requestSha256 !== attempt.requestSha256
      )
        conflict();
      return this.#record(tx, current, session);
    });
  }
  expire(
    scope: AuthorizedOrganizationScope,
    attempt: CreditTopUpAttempt,
    session: CreditTopUpSession,
  ): Promise<void> {
    bound(attempt, session);
    if (session.status !== "expired" || session.paymentStatus !== "unpaid")
      conflict();
    return this.#authorized(scope, attempt, async (tx) => {
      const current = await this.#get(tx, attempt);
      bound(current, session);
      if (
        current.providerSessionReference !== session.providerSessionReference ||
        current.providerExpiresAt !== session.expiresAt
      )
        conflict();
      if (current.state === "expired") return;
      if (current.state !== "created") conflict();
      await tx.query(
        sql(
          `UPDATE credit_top_up_attempts SET lifecycle_status='expired',record_version=record_version+1 WHERE organization_id=$1 AND attempt_id=$2`,
          [current.organizationId, current.attemptId],
        ),
      );
    });
  }
  /** Only trusted worker composition calls this lookup after authenticating the provider event. */
  async findForProvider(input: {
    readonly attemptId?: string;
    readonly providerPaymentReference?: string;
  }): Promise<CreditTopUpAttempt | null> {
    if (
      (input.attemptId === undefined) ===
      (input.providerPaymentReference === undefined)
    )
      return null;
    if (
      input.attemptId !== undefined &&
      !/^topup_[a-f0-9]{32}$/u.test(input.attemptId)
    )
      return null;
    if (
      input.providerPaymentReference !== undefined &&
      !/^pi_[A-Za-z0-9_]{1,252}$/u.test(input.providerPaymentReference)
    )
      return null;
    const result = await this.database.query(
      sql(
        `SELECT ${columns} FROM credit_top_up_attempts WHERE ($1::varchar IS NOT NULL AND attempt_id=$1) OR ($2::varchar IS NOT NULL AND provider_payment_reference=$2)`,
        [input.attemptId ?? null, input.providerPaymentReference ?? null],
      ),
    );
    return result.rows[0] === undefined ? null : map(result.rows[0]);
  }
  /** No browser authority. The caller supplies a freshly authenticated Stripe read.
   * Attempt locks, the canonical ledger grant and purchase receipt commit together. */
  async observeVerifiedPayment(
    attempt: CreditTopUpAttempt,
    session: CreditTopUpSession,
  ): Promise<"applied" | "duplicate" | "rejected"> {
    bound(attempt, session);
    return this.database.transaction(async (tx) => {
      const account = await tx.query(
        sql(
          `SELECT a.lifecycle_status,o.lifecycle_status AS organization_state FROM organization_billing_accounts a
     JOIN organizations o ON o.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.billing_account_id=$2 FOR UPDATE OF a FOR SHARE OF o`,
          [attempt.organizationId, attempt.billingAccountId],
        ),
      );
      if (account.rows.length !== 1) return unavailable();
      let current = await this.#get(tx, attempt);
      bound(current, session);
      current = await this.#record(tx, current, session);
      if (
        current.providerPaymentReference !== null &&
        current.providerPaymentReference !== session.providerPaymentReference
      )
        conflict();
      if (session.paymentStatus !== "paid") {
        if (session.status === "expired" && current.state === "created") {
          await tx.query(
            sql(
              `UPDATE credit_top_up_attempts SET lifecycle_status='expired',record_version=record_version+1 WHERE organization_id=$1 AND attempt_id=$2`,
              [current.organizationId, current.attemptId],
            ),
          );
        }
        return "applied";
      }
      if (
        session.status !== "complete" ||
        session.providerPaymentReference === null ||
        !/^pi_[A-Za-z0-9_]{1,252}$/u.test(session.providerPaymentReference) ||
        session.paymentReview === null
      )
        conflict();
      const review =
        session.paymentReview === "clear"
          ? account.rows[0]?.["lifecycle_status"] !== "active" ||
            account.rows[0]["organization_state"] !== "active"
            ? "account-unavailable"
            : null
          : session.paymentReview;
      if (current.reviewReason !== null) return "rejected";
      if (current.state === "expired") conflict();
      if (review !== null) {
        await tx.query(
          sql(
            `UPDATE credit_top_up_attempts SET lifecycle_status=CASE WHEN lifecycle_status='fulfilled' THEN 'fulfilled' ELSE 'review' END,
      provider_payment_reference=$3,review_reason=$4,record_version=record_version+1 WHERE organization_id=$1 AND attempt_id=$2`,
            [
              current.organizationId,
              current.attemptId,
              session.providerPaymentReference,
              review,
            ],
          ),
        );
        return "rejected";
      }
      if (current.state === "fulfilled") return "duplicate";
      const pack = creditTopUpPack(current.packKey);
      if (pack === undefined) return unavailable();
      const digest = createHash("sha256")
        .update(JSON.stringify([current.organizationId, current.attemptId]))
        .digest("hex");
      const grantId = "topup_grant_" + digest;
      await new PostgresCommercialPersistenceRepository(
        transactionDatabase(tx),
      ).createCreditGrant(
        {
          authority: "internal-accounting",
          actorId: "stripe-top-up-worker",
          correlationId: current.attemptId,
          organizationId: current.organizationId,
        },
        {
          chargingPolicyVersion: current.policyVersion,
          consumptionPriority: "200",
          creditGrantId: grantId,
          creditUnits: String(pack.creditUnits),
          expirationPolicy: {
            kind: "does-not-expire",
            policyVersion: current.policyVersion,
          },
          grantKind: "purchased",
          grantPolicyVersion: current.policyVersion,
          idempotencyKey: "stripe-top-up:" + current.attemptId,
          ledgerEntryId: "topup_ledger_" + digest,
          reasonCode: "billing.credit-top-up.paid",
          sourceReference: "stripe-top-up:" + current.attemptId,
          startsAt: current.createdAt,
        },
      );
      await tx.query(
        sql(
          `UPDATE credit_top_up_attempts SET lifecycle_status='fulfilled',provider_payment_reference=$3,credit_grant_id=$4,record_version=record_version+1
      WHERE organization_id=$1 AND attempt_id=$2`,
          [
            current.organizationId,
            current.attemptId,
            session.providerPaymentReference,
            grantId,
          ],
        ),
      );
      return "applied";
    });
  }
}
