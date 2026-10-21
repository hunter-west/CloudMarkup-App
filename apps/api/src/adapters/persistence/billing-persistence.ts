import { createHash } from "node:crypto";

import {
  BILLING_PROVIDER_KEY,
  BILLING_UPGRADE_GRANT_POLICY_VERSION,
  BillingApplicationError,
  type BillingPersistence,
  type BillingPaidPeriodGrant,
  type BillingProjectionState,
  type BillingSessionAccount,
  type BillingWebhookReceipt,
  type BillingWebhookTarget,
  type CompleteBillingWebhookInput,
  type RecordBillingWebhookInput,
  type ResolveBillingWebhookTargetInput,
} from "../../application/billing.js";
import type {
  CommercialEntitlementSnapshotRecord,
  CommercialSubscriptionProjectionRecord,
} from "../../application/commercial-persistence.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type {
  BillingCheckoutAttempt,
  BillingCheckoutSession,
  ClaimBillingCheckoutInput,
} from "../../application/billing-checkout.js";
import type { SqlDatabase, SqlExecutor, SqlRow } from "./sql.js";
import { sql } from "./sql.js";
import { parseDatabaseTimestamp } from "./database-timestamp.js";

type AccountRow = SqlRow & {
  readonly billing_account_id: unknown;
  readonly current_subscription_state?: unknown;
  readonly current_subscription_reference?: unknown;
  readonly expensive_operations_enabled: unknown;
  readonly lifecycle_status: unknown;
  readonly organization_id: unknown;
  readonly organization_state?: unknown;
  readonly provider_customer_reference?: unknown;
};

type ProjectionRow = SqlRow & {
  readonly billable_seat_quantity: unknown;
  readonly billing_account_id: unknown;
  readonly billing_provider: unknown;
  readonly cancel_at_period_end: unknown;
  readonly current_period_end: unknown;
  readonly current_period_id: unknown;
  readonly current_period_start: unknown;
  readonly effective_at: unknown;
  readonly last_provider_event_reference: unknown;
  readonly normalized_status: unknown;
  readonly organization_id: unknown;
  readonly plan_version_id: unknown;
  readonly provider_customer_reference: unknown;
  readonly provider_event_position: unknown;
  readonly provider_price_reference: unknown;
  readonly provider_product_reference: unknown;
  readonly provider_subscription_reference: unknown;
  readonly record_version: unknown;
  readonly subscription_projection_id: unknown;
};

type EntitlementRow = SqlRow & {
  readonly billing_account_id: unknown;
  readonly effective_at: unknown;
  readonly entitlement_policy_version: unknown;
  readonly entitlement_snapshot_id: unknown;
  readonly expensive_operations_enabled: unknown;
  readonly organization_id: unknown;
  readonly plan_version_id: unknown;
  readonly record_version: unknown;
  readonly source_record_version: unknown;
  readonly subscription_projection_id: unknown;
};

type WebhookRow = SqlRow & {
  readonly billing_provider: unknown;
  readonly event_type: unknown;
  readonly lifecycle_status: unknown;
  readonly organization_id: unknown;
  readonly payload_sha256: unknown;
  readonly processed_at: unknown;
  readonly provider_event_position: unknown;
  readonly provider_event_reference: unknown;
  readonly safe_failure_code: unknown;
  readonly webhook_event_id: unknown;
};

function persistenceFailure(): never {
  throw new BillingApplicationError(
    "provider-unavailable",
    "Billing persistence is unavailable.",
  );
}

function conflict(): never {
  throw new BillingApplicationError(
    "idempotency-conflict",
    "Billing event identity conflicts with persisted evidence.",
  );
}

function readString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return persistenceFailure();
}

function readTimestamp(value: unknown): string {
  return parseDatabaseTimestamp(value) ?? persistenceFailure();
}

function readOptionalTimestamp(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : readTimestamp(value);
}

function readOptionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : readString(value);
}

function readBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : persistenceFailure();
}

function readDecimal(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value.toString();
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    return value;
  }
  return persistenceFailure();
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
function bounded(value: string, maximum: number): void {
  if (
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    persistenceFailure();
  }
}

function assertRecordInput(input: RecordBillingWebhookInput): void {
  bounded(input.webhookEventId, 128);
  bounded(input.providerEventReference, 255);
  bounded(input.eventType, 128);
  bounded(input.eventPosition, 255);
  if (!/^[0-9a-f]{64}$/.test(input.payloadSha256)) persistenceFailure();
  if (!Number.isFinite(Date.parse(input.receivedAt))) persistenceFailure();
}

function mapProjection(
  row: ProjectionRow,
): CommercialSubscriptionProjectionRecord {
  const currentPeriodEnd = readOptionalTimestamp(row.current_period_end);
  const currentPeriodId = readOptionalString(row.current_period_id);
  const currentPeriodStart = readOptionalTimestamp(row.current_period_start);
  const lastProviderEventReference = readOptionalString(
    row.last_provider_event_reference,
  );
  const providerEventPosition = readOptionalString(row.provider_event_position);
  const providerPriceReference = readOptionalString(
    row.provider_price_reference,
  );
  const providerProductReference = readOptionalString(
    row.provider_product_reference,
  );
  const normalizedStatus = readString(row.normalized_status);
  if (
    ![
      "pending",
      "active",
      "past-due",
      "paused",
      "canceled",
      "incomplete",
    ].includes(normalizedStatus)
  ) {
    return persistenceFailure();
  }
  return {
    billableSeatQuantity: readDecimal(row.billable_seat_quantity),
    billingAccountId: readString(row.billing_account_id),
    billingProvider: readString(row.billing_provider),
    ...(row["provider_environment"] === "live"
      ? { providerEnvironment: "live" as const }
      : {}),
    cancelAtPeriodEnd: readBoolean(row.cancel_at_period_end),
    ...(currentPeriodEnd === undefined ? {} : { currentPeriodEnd }),
    ...(currentPeriodId === undefined ? {} : { currentPeriodId }),
    ...(currentPeriodStart === undefined ? {} : { currentPeriodStart }),
    effectiveAt: readTimestamp(row.effective_at),
    ...(lastProviderEventReference === undefined
      ? {}
      : { lastProviderEventReference }),
    normalizedStatus:
      normalizedStatus as CommercialSubscriptionProjectionRecord["normalizedStatus"],
    organizationId: readString(row.organization_id),
    planVersionId: readString(row.plan_version_id),
    providerCustomerReference: readString(row.provider_customer_reference),
    ...(providerEventPosition === undefined ? {} : { providerEventPosition }),
    ...(providerPriceReference === undefined ? {} : { providerPriceReference }),
    ...(providerProductReference === undefined
      ? {}
      : { providerProductReference }),
    providerSubscriptionReference: readString(
      row.provider_subscription_reference,
    ),
    recordVersion: readDecimal(row.record_version),
    subscriptionProjectionId: readString(row.subscription_projection_id),
  };
}

function mapEntitlement(
  row: EntitlementRow,
): CommercialEntitlementSnapshotRecord {
  const subscriptionProjectionId = readOptionalString(
    row.subscription_projection_id,
  );
  return {
    billingAccountId: readString(row.billing_account_id),
    effectiveAt: readTimestamp(row.effective_at),
    entitlementPolicyVersion: readString(row.entitlement_policy_version),
    entitlementSnapshotId: readString(row.entitlement_snapshot_id),
    expensiveOperationsEnabled: readBoolean(row.expensive_operations_enabled),

    organizationId: readString(row.organization_id),
    planVersionId: readString(row.plan_version_id),
    recordVersion: readDecimal(row.record_version),
    sourceRecordVersion: readDecimal(row.source_record_version),
    ...(subscriptionProjectionId === undefined
      ? {}
      : { subscriptionProjectionId }),
  };
}

function lifecycle(value: unknown): BillingWebhookReceipt["lifecycleStatus"] {
  const result = readString(value);
  if (
    result !== "received" &&
    result !== "processed" &&
    result !== "failed" &&
    result !== "unsupported"
  ) {
    return persistenceFailure();
  }
  return result;
}

function accountLifecycle(
  value: unknown,
): BillingSessionAccount["lifecycleStatus"] {
  const result = readString(value);
  if (result !== "active" && result !== "suspended" && result !== "closed") {
    return persistenceFailure();
  }
  return result;
}

function sessionAccount(row: AccountRow): BillingSessionAccount {
  const providerCustomerReference = readOptionalString(
    row.provider_customer_reference,
  );
  const currentSubscriptionState = readOptionalString(
    row.current_subscription_state,
  );
  if (
    currentSubscriptionState !== undefined &&
    ![
      "pending",
      "active",
      "past-due",
      "paused",
      "canceled",
      "incomplete",
    ].includes(currentSubscriptionState)
  ) {
    return persistenceFailure();
  }
  return {
    billingAccountId: readString(row.billing_account_id),
    ...(row.current_subscription_reference === undefined ||
    row.current_subscription_reference === null
      ? {}
      : {
          currentSubscriptionReference: readString(
            row.current_subscription_reference,
          ),
        }),
    ...(currentSubscriptionState === undefined
      ? {}
      : {
          currentSubscriptionState:
            currentSubscriptionState as BillingProjectionState,
        }),
    expensiveOperationsEnabled: readBoolean(row.expensive_operations_enabled),
    lifecycleStatus: accountLifecycle(row.lifecycle_status),
    organizationId: readString(row.organization_id),
    ...(providerCustomerReference === undefined
      ? {}
      : { providerCustomerReference }),
  };
}

const checkoutColumns = `attempt_id, billing_account_id, organization_id,
  request_key_sha256, request_sha256, lifecycle_status, record_version,
  provider_session_reference,
  to_char(provider_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS provider_expires_at,
  to_char(retry_before AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS retry_before`;

function checkoutAttempt(row: SqlRow | undefined): BillingCheckoutAttempt {
  if (row === undefined) return persistenceFailure();
  const state = readString(row["lifecycle_status"]);
  if (!["pending", "created", "expired", "consumed"].includes(state))
    return persistenceFailure();
  const providerSessionReference = readOptionalString(
    row["provider_session_reference"],
  );
  const providerExpiresAt = readOptionalString(row["provider_expires_at"]);
  return {
    attemptId: readString(row["attempt_id"]),
    billingAccountId: readString(row["billing_account_id"]),
    organizationId: readString(row["organization_id"]),
    recordVersion: readDecimal(row["record_version"]),
    requestKeySha256: readString(row["request_key_sha256"]),
    requestSha256: readString(row["request_sha256"]),
    retryBefore: readString(row["retry_before"]),
    state: state as BillingCheckoutAttempt["state"],
    ...(providerSessionReference === undefined
      ? {}
      : { providerSessionReference }),
    ...(providerExpiresAt === undefined ? {} : { providerExpiresAt }),
  };
}

export class PostgresBillingPersistence implements BillingPersistence {
  readonly #database: SqlDatabase;
  readonly #environment: "test" | "live";

  constructor(database: SqlDatabase, environment: "test" | "live" = "test") {
    this.#database = database;
    this.#environment = environment;
  }
  async assertProviderMode(
    database: SqlExecutor = this.#database,
  ): Promise<void> {
    const cutover = await database.query(
      sql(
        "SELECT cutover_id FROM billing_provider_cutovers WHERE cutover_id='stripe-test-to-live-v1'",
      ),
    );
    if ((cutover.rows.length === 1) !== (this.#environment === "live"))
      throw new BillingApplicationError(
        "billing-disabled",
        "Billing is awaiting its reviewed mode transition.",
      );
  }

  async getSessionAccount(
    scope: AuthorizedOrganizationScope,
  ): Promise<BillingSessionAccount | null> {
    return this.#readSessionAccount(this.#database, scope);
  }

  async #readSessionAccount(
    database: SqlExecutor,
    scope: AuthorizedOrganizationScope,
    lock = false,
  ): Promise<BillingSessionAccount | null> {
    if (!scope.capabilities.includes("billing.manage")) return null;
    await this.assertProviderMode(database);
    const result = await database.query<AccountRow>(
      sql(
        `SELECT account.billing_account_id, account.organization_id,
                account.lifecycle_status,
                account.expensive_operations_enabled,
                subscription.provider_customer_reference,
                subscription.provider_subscription_reference AS current_subscription_reference,
                subscription.normalized_status AS current_subscription_state
         FROM memberships membership
         JOIN principals principal
           ON principal.principal_id = membership.principal_id
         JOIN organizations organization
           ON organization.organization_id = membership.organization_id
         JOIN organization_roles role
           ON role.organization_id = membership.organization_id
          AND role.role_key = membership.role_key
         JOIN organization_billing_accounts account
           ON account.organization_id = membership.organization_id
         LEFT JOIN organization_subscription_projections subscription
           ON subscription.organization_id = account.organization_id
          AND subscription.billing_account_id = account.billing_account_id
          AND subscription.provider_environment = $4
         WHERE membership.membership_id = $1
           AND membership.principal_id = $2
           AND membership.organization_id = $3
           AND membership.lifecycle_status = 'active'
           AND principal.lifecycle_status = 'active'
           AND organization.lifecycle_status = 'active'
           AND role.policy_version = 'authorization-v2'
           AND 'billing.manage' = ANY(role.capabilities)
         ${lock ? "FOR UPDATE OF account FOR SHARE OF membership, principal, organization, role" : ""}`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          this.#environment,
        ],
      ),
    );
    const row = result.rows[0];
    return row === undefined ? null : sessionAccount(row);
  }

  async #checkoutTransaction<T>(
    scope: AuthorizedOrganizationScope,
    billingAccountId: string,
    work: (
      transaction: SqlExecutor,
      account: BillingSessionAccount,
    ) => Promise<T>,
  ): Promise<T> {
    return this.#database.transaction(async (transaction) => {
      // Serialize the account and hold current identity rows only inside this
      // SQL transaction. No provider call is reachable from this callback.
      const locked = await this.#readSessionAccount(transaction, scope, true);
      if (
        locked?.billingAccountId !== billingAccountId ||
        locked.lifecycleStatus !== "active"
      )
        return persistenceFailure();
      // A new statement after the account lock observes any projection update
      // that committed while the lock was being acquired.
      const current = await this.#readSessionAccount(transaction, scope);
      if (
        current?.billingAccountId !== billingAccountId ||
        current.lifecycleStatus !== "active"
      )
        return persistenceFailure();
      return work(transaction, current);
    });
  }

  async claimCheckoutAttempt(
    scope: AuthorizedOrganizationScope,
    input: ClaimBillingCheckoutInput,
  ): Promise<BillingCheckoutAttempt> {
    if (
      !/^checkout_[a-f0-9]{32}$/u.test(input.attemptId) ||
      !/^[a-f0-9]{64}$/u.test(input.requestKeySha256) ||
      !/^[a-f0-9]{64}$/u.test(input.requestSha256)
    )
      return persistenceFailure();
    return this.#checkoutTransaction(
      scope,
      input.billingAccountId,
      async (transaction, account) => {
        if (
          account.currentSubscriptionState !== undefined &&
          account.currentSubscriptionState !== "canceled"
        )
          return conflict();
        const existing = await transaction.query(
          sql(
            `SELECT ${checkoutColumns} FROM billing_checkout_attempts
         WHERE organization_id=$1 AND billing_account_id=$2
           AND (request_key_sha256=$3 OR lifecycle_status IN ('pending','created'))
         ORDER BY (request_key_sha256=$3) DESC LIMIT 1`,
            [
              scope.organizationId,
              input.billingAccountId,
              input.requestKeySha256,
            ],
          ),
        );
        if (existing.rows[0] !== undefined)
          return checkoutAttempt(existing.rows[0]);
        const result = await transaction.query(
          sql(
            `INSERT INTO billing_checkout_attempts
           (attempt_id, organization_id, billing_account_id, request_key_sha256, request_sha256)
         VALUES ($1,$2,$3,$4,$5) RETURNING ${checkoutColumns}`,
            [
              input.attemptId,
              scope.organizationId,
              input.billingAccountId,
              input.requestKeySha256,
              input.requestSha256,
            ],
          ),
        );
        return checkoutAttempt(result.rows[0]);
      },
    );
  }

  async recordCheckoutSession(
    scope: AuthorizedOrganizationScope,
    attempt: BillingCheckoutAttempt,
    session: BillingCheckoutSession,
  ): Promise<BillingCheckoutAttempt> {
    if (
      attempt.organizationId !== scope.organizationId ||
      session.organizationId !== scope.organizationId ||
      session.billingAccountId !== attempt.billingAccountId ||
      !/^cs_[A-Za-z0-9_]{1,250}$/u.test(session.providerSessionReference) ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      session.status !== "open" ||
      session.providerSubscriptionReference !== null
    )
      return persistenceFailure();
    return this.#checkoutTransaction(
      scope,
      attempt.billingAccountId,
      async (transaction) => {
        const result = await transaction.query(
          sql(
            `SELECT ${checkoutColumns} FROM billing_checkout_attempts
         WHERE organization_id=$1 AND billing_account_id=$2 AND attempt_id=$3`,
            [scope.organizationId, attempt.billingAccountId, attempt.attemptId],
          ),
        );
        const current = checkoutAttempt(result.rows[0]);
        if (
          current.requestKeySha256 !== attempt.requestKeySha256 ||
          current.requestSha256 !== attempt.requestSha256
        )
          return conflict();
        if (
          current.state === "created" &&
          current.providerSessionReference ===
            session.providerSessionReference &&
          current.providerExpiresAt === session.expiresAt
        )
          return current;
        if (
          current.state !== "pending" ||
          current.recordVersion !== attempt.recordVersion
        )
          return conflict();
        const updated = await transaction.query(
          sql(
            `UPDATE billing_checkout_attempts SET lifecycle_status='created',
           provider_session_reference=$4, provider_expires_at=$5::timestamptz,
           record_version=record_version+1
         WHERE organization_id=$1 AND billing_account_id=$2 AND attempt_id=$3
           AND record_version=$6::bigint AND lifecycle_status='pending'
         RETURNING ${checkoutColumns}`,
            [
              scope.organizationId,
              attempt.billingAccountId,
              attempt.attemptId,
              session.providerSessionReference,
              session.expiresAt,
              attempt.recordVersion,
            ],
          ),
        );
        return checkoutAttempt(updated.rows[0]);
      },
    );
  }

  async retireCheckoutAttempt(
    scope: AuthorizedOrganizationScope,
    attempt: BillingCheckoutAttempt,
    session: BillingCheckoutSession,
  ): Promise<void> {
    if (
      attempt.organizationId !== scope.organizationId ||
      session.organizationId !== scope.organizationId ||
      session.billingAccountId !== attempt.billingAccountId ||
      session.providerSessionReference !== attempt.providerSessionReference ||
      session.expiresAt !== attempt.providerExpiresAt
    )
      return conflict();
    return this.#checkoutTransaction(
      scope,
      attempt.billingAccountId,
      async (transaction, account) => {
        const expired =
          session.status === "expired" &&
          session.providerSubscriptionReference === null;
        const canceled =
          session.status === "complete" &&
          session.providerSubscriptionReference !== null &&
          account.currentSubscriptionState === "canceled" &&
          account.currentSubscriptionReference ===
            session.providerSubscriptionReference;
        if (!expired && !canceled) return conflict();
        const updated = await transaction.query(
          sql(
            `UPDATE billing_checkout_attempts
         SET lifecycle_status=$4, retired_at=clock_timestamp(), record_version=record_version+1
         WHERE organization_id=$1 AND billing_account_id=$2 AND attempt_id=$3
           AND record_version=$5::bigint AND lifecycle_status='created'
           AND provider_session_reference=$6 AND provider_expires_at=$7::timestamptz`,
            [
              scope.organizationId,
              attempt.billingAccountId,
              attempt.attemptId,
              expired ? "expired" : "consumed",
              attempt.recordVersion,
              session.providerSessionReference,
              session.expiresAt,
            ],
          ),
        );
        if (updated.rowCount !== 1) return conflict();
      },
    );
  }

  async resolveWebhookTarget(
    input: ResolveBillingWebhookTargetInput,
  ): Promise<BillingWebhookTarget | null> {
    await this.assertProviderMode();
    const result = await this.#database.query<AccountRow>(
      sql(
        `SELECT account.billing_account_id, account.organization_id,
                account.lifecycle_status,
                account.expensive_operations_enabled,
                organization.lifecycle_status AS organization_state
         FROM organization_billing_accounts account
         JOIN organizations organization
           ON organization.organization_id = account.organization_id
         WHERE account.organization_id = $1
           AND account.billing_account_id = $2
           AND account.lifecycle_status IN ('active', 'suspended')
           AND organization.lifecycle_status IN ('active', 'suspended')
           AND NOT EXISTS (
             SELECT 1
             FROM organization_subscription_projections foreign_projection
             WHERE foreign_projection.organization_id <> $1
               AND (
                 foreign_projection.provider_customer_reference = $3
                 OR foreign_projection.provider_subscription_reference = $4
               )
           )`,
        [
          input.organizationId,
          input.billingAccountId,
          input.providerCustomerReference,
          input.providerSubscriptionReference,
        ],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const organizationState = readString(row.organization_state);
    if (organizationState !== "active" && organizationState !== "suspended") {
      return persistenceFailure();
    }
    return {
      ...sessionAccount(row),
      organizationState,
    };
  }

  async getCurrentProjection(
    organizationId: string,
  ): Promise<CommercialSubscriptionProjectionRecord | null> {
    const result = await this.#database.query<ProjectionRow>(
      sql(
        `SELECT provider_environment, subscription_projection_id, organization_id,
                billing_account_id, billing_provider,
                provider_customer_reference,
                provider_subscription_reference,
                provider_product_reference, provider_price_reference,
                last_provider_event_reference, provider_event_position,
                normalized_status, plan_version_id,
                billable_seat_quantity, current_period_id,
                current_period_start, current_period_end,
                cancel_at_period_end, effective_at, record_version
         FROM organization_subscription_projections
         WHERE organization_id = $1`,
        [organizationId],
      ),
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjection(row);
  }

  async getCurrentEntitlement(
    organizationId: string,
  ): Promise<CommercialEntitlementSnapshotRecord | null> {
    const result = await this.#database.query<EntitlementRow>(
      sql(
        `SELECT organization_id, entitlement_snapshot_id,
                billing_account_id, subscription_projection_id,
                plan_version_id, entitlement_policy_version,
                source_record_version, expensive_operations_enabled,
                record_version, effective_at
         FROM organization_entitlement_snapshots
         WHERE organization_id = $1`,
        [organizationId],
      ),
    );
    const row = result.rows[0];
    return row === undefined ? null : mapEntitlement(row);
  }

  async hasUpgradeAllowance(
    organizationId: string,
    creditGrantId: string,
  ): Promise<boolean> {
    const result = await this.#database.query(
      sql(
        "SELECT 1 FROM credit_grants WHERE organization_id=$1 AND credit_grant_id=$2 AND grant_kind='promotional' AND grant_policy_version=$3",
        [organizationId, creditGrantId, BILLING_UPGRADE_GRANT_POLICY_VERSION],
      ),
    );
    return result.rows.length > 0;
  }

  async getMonthlyGrant(
    organizationId: string,
    subscriptionPeriodId: string,
  ): Promise<BillingPaidPeriodGrant | null> {
    const result = await this.#database.query(
      sql(
        "SELECT plan_version_id,credit_units,subscription_period_start,subscription_period_end,source_reference,grant_policy_version FROM credit_grants WHERE organization_id=$1 AND grant_kind='monthly' AND subscription_period_id=$2",
        [organizationId, subscriptionPeriodId],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    if (result.rows.length !== 1) persistenceFailure();
    return {
      planVersionId: readString(row["plan_version_id"]),
      creditUnits: readDecimal(row["credit_units"]),
      startsAt: readTimestamp(row["subscription_period_start"]),
      endsAt: readTimestamp(row["subscription_period_end"]),
      sourceReference: readString(row["source_reference"]),
      grantPolicyVersion: readString(row["grant_policy_version"]),
    };
  }

  async hasMonthlyGrant(
    organizationId: string,
    subscriptionPeriodId: string,
  ): Promise<boolean> {
    const result = await this.#database.query(
      sql(
        `SELECT 1
         FROM credit_grants
         WHERE organization_id = $1
           AND grant_kind = 'monthly'
           AND subscription_period_id = $2`,
        [organizationId, subscriptionPeriodId],
      ),
    );
    return result.rows.length > 0;
  }

  async recordWebhookEvent(
    input: RecordBillingWebhookInput,
  ): Promise<BillingWebhookReceipt> {
    assertRecordInput(input);
    return this.#database.transaction(async (transaction) => {
      await this.assertProviderMode(transaction);
      const inserted = await transaction.query(
        sql(
          `INSERT INTO billing_webhook_events (
             webhook_event_id, billing_provider, provider_event_reference,
             event_type, payload_sha256, lifecycle_status,
             provider_event_position, attempt_count, last_attempted_at,
             received_at, provider_environment
           ) VALUES ($1, $2, $3, $4, $5, 'received', $6, 1, $7::timestamptz, $7::timestamptz, $8)
           ON CONFLICT (billing_provider, provider_event_reference)
             DO NOTHING`,
          [
            input.webhookEventId,
            BILLING_PROVIDER_KEY,
            input.providerEventReference,
            input.eventType,
            input.payloadSha256,
            input.eventPosition,
            input.receivedAt,
            this.#environment,
          ],
        ),
      );
      const selected = await transaction.query<WebhookRow>(
        sql(
          `SELECT provider_environment, webhook_event_id, billing_provider,
                  provider_event_reference, event_type, payload_sha256,
                  lifecycle_status, organization_id, processed_at,
                  safe_failure_code, provider_event_position
           FROM billing_webhook_events
           WHERE billing_provider = $1
             AND provider_event_reference = $2
           FOR UPDATE`,
          [BILLING_PROVIDER_KEY, input.providerEventReference],
        ),
      );
      const row = selected.rows[0];
      if (
        row === undefined ||
        (row["provider_environment"] ?? "test") !== this.#environment ||
        readString(row.webhook_event_id) !== input.webhookEventId ||
        readString(row.billing_provider) !== BILLING_PROVIDER_KEY ||
        readString(row.provider_event_reference) !==
          input.providerEventReference ||
        readString(row.event_type) !== input.eventType ||
        readString(row.payload_sha256) !== input.payloadSha256 ||
        readOptionalString(row.provider_event_position) !== input.eventPosition
      ) {
        return conflict();
      }
      if (
        inserted.rowCount === 0 &&
        readString(row.lifecycle_status) === "received"
      ) {
        await transaction.query(
          sql(
            `UPDATE billing_webhook_events
             SET attempt_count = attempt_count + 1,
                 last_attempted_at = $1::timestamptz
             WHERE webhook_event_id = $2
               AND lifecycle_status = 'received'`,
            [input.receivedAt, input.webhookEventId],
          ),
        );
      }
      return {
        lifecycleStatus: lifecycle(row.lifecycle_status),
        payloadSha256: readString(row.payload_sha256),
        webhookEventId: readString(row.webhook_event_id),
      };
    });
  }

  async completeWebhookEvent(
    input: CompleteBillingWebhookInput,
  ): Promise<void> {
    bounded(input.webhookEventId, 128);
    bounded(input.providerEventReference, 255);
    bounded(input.eventType, 128);
    bounded(input.eventPosition, 255);
    if (!Number.isFinite(Date.parse(input.processedAt))) persistenceFailure();
    if (
      input.safeFailureCode !== undefined &&
      !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(input.safeFailureCode)
    ) {
      persistenceFailure();
    }
    await this.#database.transaction(async (transaction) => {
      const updated = await transaction.query(
        sql(
          `UPDATE billing_webhook_events
           SET lifecycle_status = $1,
               organization_id = $2,
               processed_at = $3::timestamptz,
               safe_failure_code = $4
           WHERE webhook_event_id = $5
             AND billing_provider = $6
             AND provider_event_reference = $7
             AND event_type = $8
             AND provider_event_position = $9
             AND lifecycle_status = 'received'`,
          [
            input.status,
            input.organizationId ?? null,
            input.processedAt,
            input.safeFailureCode ?? null,
            input.webhookEventId,
            BILLING_PROVIDER_KEY,
            input.providerEventReference,
            input.eventType,
            input.eventPosition,
          ],
        ),
      );
      if (updated.rowCount === 0) {
        const selected = await transaction.query<WebhookRow>(
          sql(
            `SELECT webhook_event_id, billing_provider,
                    provider_event_reference, event_type, payload_sha256,
                    lifecycle_status, organization_id, processed_at,
                    safe_failure_code, provider_event_position
             FROM billing_webhook_events
             WHERE webhook_event_id = $1
             FOR UPDATE`,
            [input.webhookEventId],
          ),
        );
        const row = selected.rows[0];
        if (
          row === undefined ||
          readString(row.billing_provider) !== BILLING_PROVIDER_KEY ||
          readString(row.provider_event_reference) !==
            input.providerEventReference ||
          readString(row.event_type) !== input.eventType ||
          readOptionalString(row.provider_event_position) !==
            input.eventPosition ||
          lifecycle(row.lifecycle_status) !== input.status ||
          readOptionalString(row.organization_id) !== input.organizationId ||
          readOptionalString(row.safe_failure_code) !== input.safeFailureCode
        ) {
          return conflict();
        }
        return;
      }

      if (
        input.organizationId !== undefined &&
        input.billingAccountId !== undefined
      ) {
        const outcome = input.status === "processed" ? "succeeded" : "failed";
        const safeSummary =
          input.status === "processed"
            ? "Processed a verified billing provider event."
            : input.status === "unsupported"
              ? "Ignored an unsupported verified billing provider event."
              : "Rejected a verified billing provider event.";
        await transaction.query(
          sql(
            `INSERT INTO audit_events (
               audit_event_id, organization_id, actor_principal_id,
               action, target_kind, target_id, outcome, safe_summary,
               correlation_id, occurred_at
             ) VALUES (
               $1, $2, NULL, 'billing.webhook.process',
               'billing-account', $3, $4, $5, $6, $7::timestamptz
             )
             ON CONFLICT (audit_event_id) DO NOTHING`,
            [
              "audit_billing_" +
                createHash("sha256")
                  .update(input.webhookEventId)
                  .digest("hex")
                  .slice(0, 48),
              input.organizationId,
              input.billingAccountId,
              outcome,
              safeSummary,
              input.webhookEventId,
              input.processedAt,
            ],
          ),
        );
      }
    });
  }
}
