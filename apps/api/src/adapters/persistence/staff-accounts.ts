import { applyStaffTrial, readStaffTrial } from "./staff-trials.js";
import { createHash, randomUUID } from "node:crypto";
import {
  staffAccessV1Schema,
  staffAccountV1Schema,
  staffUnprovisionedAccountV2Schema,
  staffAccountListSchema,
  staffAccountDetailV1Schema,
  staffAccountDetailV2Schema,
  staffAccountActionV1Schema,
  staffAccountSearchV1Schema,
  staffActionReceiptV1Schema,
  idempotencyHeadersV1Schema,
  organizationIdSchema,
  type StaffPermissionV1,
  type StaffAccountSummary,
} from "@cloudmarkup/api-contract";
import type { StaffAccountsApplication } from "../../application/staff-accounts.js";
import type { PrincipalContext } from "../../application/ports.js";
import { ApplicationError } from "../../application/errors.js";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import { requireRecentAuthentication } from "../../application/identity.js";
import {
  accountSessionAllowed,
  lockAccountSessions,
} from "./account-sessions.js";
import {
  PostgresCommercialPersistenceRepository,
  readStaffCreditBalanceInTransaction,
} from "./commercial-repositories.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";
import { billingAccountIdForOrganization } from "./billing-account-identity.js";
const policy = "cloudmarkup-staff-credits-v1";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const denied = (): never => {
  throw new ApplicationError(
    "access_denied",
    "Platform staff access is required.",
  );
};
const invalid = (): never => {
  throw new ApplicationError(
    "invalid_request",
    "The staff account request is invalid.",
  );
};
const utc = (column: string) =>
  "to_char(" +
  column +
  " AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
function readActionReceipt(value: unknown) {
  const receipt: unknown =
    typeof value === "string" ? JSON.parse(value) : value;
  return staffActionReceiptV1Schema.parse(receipt);
}
function etag(account: StaffAccountSummary) {
  return (
    '"staff-account:' +
    account.billingAccountId +
    ":" +
    (account.contractVersion === 2
      ? "unprovisioned:" + String(account.organizationVersion)
      : String(account.version)) +
    '"'
  );
}
function account(row: SqlRow): StaffAccountSummary {
  if (row["billing_account_id"] === null) {
    return staffUnprovisionedAccountV2Schema.parse({
      contractVersion: 2,
      organizationId: row["organization_id"],
      billingAccountId: billingAccountIdForOrganization(
        String(row["organization_id"]),
      ),
      displayName: row["display_name"],
      kind: row["workspace_kind"],
      organizationState: row["organization_state"],
      billingState: "unprovisioned",
      subscriptionState: "not-subscribed",
      planDisplayName: null,
      expensiveOperationsEnabled: false,
      version: 0,
      organizationVersion: Number(row["organization_version"]),
    });
  }
  return staffAccountV1Schema.parse({
    contractVersion: 1,
    organizationId: row["organization_id"],
    billingAccountId: row["billing_account_id"],
    displayName: row["display_name"],
    kind: row["workspace_kind"],
    organizationState: row["organization_state"],
    billingState: row["lifecycle_status"],
    subscriptionState: row["subscription_state"] ?? "not-subscribed",
    planDisplayName: row["plan_display_name"] ?? null,
    expensiveOperationsEnabled: row["expensive_operations_enabled"],
    version: Number(row["record_version"]),
  });
}
const accountSelect = `SELECT a.billing_account_id,a.organization_id,a.lifecycle_status,a.expensive_operations_enabled,a.record_version,o.display_name,o.workspace_kind,o.lifecycle_status AS organization_state,s.normalized_status AS subscription_state,CASE WHEN d.plan_key='starter' AND s.provider_environment='live' THEN 'Standard' WHEN d.plan_key='pro' THEN 'Professional' ELSE d.display_name END AS plan_display_name FROM organization_billing_accounts a JOIN organizations o ON o.organization_id=a.organization_id LEFT JOIN organization_subscription_projections s ON s.organization_id=a.organization_id AND s.billing_account_id=a.billing_account_id LEFT JOIN commercial_plan_versions v ON v.plan_version_id=s.plan_version_id LEFT JOIN commercial_plan_definitions d ON d.plan_id=v.plan_id`;
const searchableWorkspaceSelect = `SELECT a.billing_account_id,o.organization_id,a.lifecycle_status,a.expensive_operations_enabled,a.record_version,o.record_version AS organization_version,o.display_name,o.workspace_kind,o.lifecycle_status AS organization_state,s.normalized_status AS subscription_state,CASE WHEN d.plan_key='starter' AND s.provider_environment='live' THEN 'Standard' WHEN d.plan_key='pro' THEN 'Professional' ELSE d.display_name END AS plan_display_name FROM organizations o LEFT JOIN organization_billing_accounts a ON a.organization_id=o.organization_id LEFT JOIN organization_subscription_projections s ON s.organization_id=a.organization_id AND s.billing_account_id=a.billing_account_id LEFT JOIN commercial_plan_versions v ON v.plan_version_id=s.plan_version_id LEFT JOIN commercial_plan_definitions d ON d.plan_id=v.plan_id`;
/** No browser role, email or organization membership can create platform authority. */
export class PostgresStaffAccounts implements StaffAccountsApplication {
  readonly database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.database = database;
  }
  async #authorize(
    tx: SqlExecutor,
    principal: PrincipalContext,
    permission?: StaffPermissionV1,
    write = false,
  ) {
    await lockAccountSessions(tx, principal.principalId);
    if (!(await accountSessionAllowed(tx, principal)))
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
    if (write) requireRecentAuthentication(principal, new Date());
    const rows = await tx.query(
      sql(
        "SELECT permissions FROM platform_staff_authorizations WHERE principal_id=$1 AND revoked_at IS NULL FOR SHARE",
        [principal.principalId],
      ),
    );
    const permissions = staffAccessV1Schema.parse({
      contractVersion: 1,
      permissions: rows.rows[0]?.["permissions"] ?? [],
    }).permissions;
    if (permission && !permissions.includes(permission)) denied();
    return { contractVersion: 1 as const, permissions };
  }
  async #transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction(work);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error instanceof CommercialPersistenceError)
        throw new ApplicationError(
          "conflict",
          "The account balance changed. Reload before making another adjustment.",
        );
      throw new ApplicationError(
        "service_unavailable",
        "Staff accounts are temporarily unavailable. Retry the same attempt.",
      );
    }
  }
  access: StaffAccountsApplication["access"] = (principal) => {
    const actor = Object.freeze({ ...principal });
    return this.#transaction((tx) => this.#authorize(tx, actor));
  };
  search: StaffAccountsApplication["search"] = (
    principal,
    input,
    previewVersion,
  ) => {
    const actor = Object.freeze({ ...principal });
    const parsed = staffAccountSearchV1Schema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "Enter an account name, account ID, username or exact email.",
        ),
      );
    const value = parsed.data;
    return this.#transaction(async (tx) => {
      await this.#authorize(tx, actor, "accounts.read");
      const result = await tx.query(
        sql(
          searchableWorkspaceSelect +
            ` WHERE o.organization_id>$2 AND o.lifecycle_status IN ('active','suspended') AND ($3::boolean OR a.billing_account_id IS NOT NULL) AND (o.organization_id=$1 OR a.billing_account_id=$1 OR position(lower($1) in lower(o.display_name))>0 OR EXISTS(SELECT 1 FROM memberships m JOIN principals p ON p.principal_id=m.principal_id WHERE m.organization_id=o.organization_id AND m.lifecycle_status='active' AND (lower(p.email)=lower($1) OR p.principal_id=$1 OR p.public_username=lower($1)))) ORDER BY o.organization_id LIMIT 51`,
          [value.q, value.cursor ?? "", previewVersion === "2"],
        ),
      );
      const items = result.rows.slice(0, 50).map(account),
        nextCursor = items.at(-1)?.organizationId;
      await this.#authorize(tx, actor, "accounts.read");
      return staffAccountListSchema.parse({
        contractVersion: items.some((item) => item.contractVersion === 2)
          ? 2
          : 1,
        items,
        ...(result.rows.length > 50 && nextCursor ? { nextCursor } : {}),
      });
    });
  };
  async #account(tx: SqlExecutor, organizationId: string) {
    if (!organizationIdSchema.safeParse(organizationId).success) invalid();
    const rows = await tx.query(
      sql(
        accountSelect +
          " WHERE a.organization_id=$1 FOR UPDATE OF a FOR SHARE OF o",
        [organizationId],
      ),
    );
    const row = rows.rows[0];
    if (row) return account(row);
    // The read proves a workspace exists but does not initialize billing.
    const workspace = (
      await tx.query(
        sql(
          "SELECT organization_id,display_name,workspace_kind,lifecycle_status AS organization_state,record_version AS organization_version FROM organizations WHERE organization_id=$1 AND lifecycle_status IN ('active','suspended') FOR SHARE",
          [organizationId],
        ),
      )
    ).rows[0];
    if (!workspace)
      throw new ApplicationError(
        "not_found",
        "This billing account is unavailable.",
      );
    return account({ ...workspace, billing_account_id: null });
  }
  get: StaffAccountsApplication["get"] = (
    principal,
    organizationId,
    previewVersion,
  ) => {
    const actor = Object.freeze({ ...principal });
    return this.#transaction(async (tx) => {
      await this.#authorize(tx, actor, "accounts.read");
      const target = await this.#account(tx, organizationId);
      if (target.contractVersion === 2) {
        if (previewVersion !== "2")
          throw new ApplicationError(
            "not_found",
            "This billing account is unavailable.",
          );
        await this.#authorize(tx, actor, "accounts.read");
        return {
          value: staffAccountDetailV2Schema.parse({
            contractVersion: 2,
            account: target,
            availableCreditUnits: "0",
            reservedCreditUnits: "0",
            grants: [],
            history: [],
          }),
          etag: etag(target),
        };
      }
      const balance = await readStaffCreditBalanceInTransaction(tx, {
        authority: "internal-administration",
        actorId: actor.principalId,
        actorPrincipalId: actor.principalId,
        organizationId,
        correlationId: actor.correlationId,
      });
      const grants = await tx.query(
        sql(
          `SELECT g.credit_grant_id,g.credit_units::text,
    GREATEST(0,CASE WHEN g.expires_at<=clock_timestamp() THEN 0 ELSE g.credit_units-COALESCE(e.settled,0)+COALESCE(e.adjustments,0)-COALESCE(r.reserved,0) END)::text AS available,
    COALESCE(r.reserved,0)::text AS reserved,COALESCE(e.settled,0)::text AS consumed,
    ${utc("g.expires_at")} AS expires_at,${utc("s.occurred_at")} AS created_at,s.principal_id,s.receipt_json->>'reason' AS reason
    FROM platform_staff_account_actions s JOIN credit_grants g ON g.organization_id=s.organization_id AND g.credit_grant_id=s.credit_grant_id
    LEFT JOIN LATERAL(SELECT sum(settled_credit_units) AS settled,sum(credit_adjustment_units) AS adjustments FROM usage_ledger_entry_allocations WHERE organization_id=g.organization_id AND credit_grant_id=g.credit_grant_id)e ON true
    LEFT JOIN LATERAL(SELECT sum(a.reserved_credit_units) AS reserved FROM credit_reservation_allocations a JOIN credit_reservations r ON r.organization_id=a.organization_id AND r.reservation_id=a.reservation_id WHERE a.organization_id=g.organization_id AND a.credit_grant_id=g.credit_grant_id AND r.status='active')r ON true
    WHERE s.organization_id=$1 AND s.action='grant-credits' ORDER BY s.occurred_at DESC,s.action_id DESC LIMIT 100`,
          [organizationId],
        ),
      );
      const history = await tx.query(
        sql(
          "SELECT receipt_json FROM platform_staff_account_actions WHERE organization_id=$1 ORDER BY occurred_at DESC,action_id DESC LIMIT 100",
          [organizationId],
        ),
      );
      const value = staffAccountDetailV1Schema.parse({
        contractVersion: 1,
        account: target,
        trial: await readStaffTrial(tx, organizationId),
        availableCreditUnits: balance.availableCreditUnits,
        reservedCreditUnits: balance.reservedCreditUnits,
        grants: grants.rows.map((g) => ({
          id: g["credit_grant_id"],
          creditUnits: g["credit_units"],
          availableCreditUnits: g["available"],
          reservedCreditUnits: g["reserved"],
          consumedCreditUnits: g["consumed"],
          expiresAt: g["expires_at"],
          createdAt: g["created_at"],
          actorPrincipalId: g["principal_id"],
          reason: g["reason"],
        })),
        history: history.rows.map((row) =>
          readActionReceipt(row["receipt_json"]),
        ),
      });
      await this.#authorize(tx, actor, "accounts.read");
      return { value, etag: etag(target) };
    });
  };
  act: StaffAccountsApplication["act"] = (
    principal,
    organizationId,
    input,
    expectedEtag,
    idempotencyKey,
  ) => {
    const actor = Object.freeze({ ...principal }),
      parsed = staffAccountActionV1Schema.safeParse(input);
    if (
      !parsed.success ||
      !organizationIdSchema.safeParse(organizationId).success ||
      !idempotencyHeadersV1Schema.safeParse({
        "idempotency-key": idempotencyKey,
      }).success
    )
      return Promise.reject(
        new ApplicationError("invalid_request", "The staff action is invalid."),
      );
    const value = parsed.data,
      permission =
        value.action === "grant-credits"
          ? "credits.grant"
          : value.action === "revoke-credits"
            ? "credits.revoke"
            : value.action === "grant-trial"
              ? "trials.grant"
              : value.action === "revoke-trial"
                ? "trials.revoke"
                : "operations.manage";
    const key = digest(idempotencyKey),
      request = digest(
        JSON.stringify({ organizationId, input: value, expectedEtag }),
      );
    return this.#transaction(async (tx) => {
      await this.#authorize(tx, actor, permission, true);
      await tx.query(
        sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "staff-action:" + actor.principalId + ":" + key,
        ]),
      );
      let target = await this.#account(tx, organizationId);
      let currentPrecondition = expectedEtag;
      if (target.contractVersion === 2) {
        if (value.action !== "grant-credits" && value.action !== "grant-trial")
          throw new ApplicationError(
            "conflict",
            "Initialize this account with a reviewed grant or trial first.",
          );
        if (value.confirmBillingAccountId !== target.billingAccountId)
          invalid();
        if (etag(target) !== expectedEtag)
          throw new ApplicationError(
            "precondition_failed",
            "The workspace changed. Reload it before applying this action.",
          );
        if (target.organizationState !== "active")
          throw new ApplicationError(
            "conflict",
            "This workspace cannot receive credit changes in its current state.",
          );
        // Existing grant authority is checked above. Materialization and the
        // grant/trial receipt share this transaction; reads never create it.
        const created = await tx.query(
          sql(
            "INSERT INTO organization_billing_accounts(billing_account_id,organization_id) VALUES($1,$2) ON CONFLICT(organization_id) DO NOTHING RETURNING billing_account_id",
            [target.billingAccountId, organizationId],
          ),
        );
        target = await this.#account(tx, organizationId);
        if (target.contractVersion !== 1)
          throw Error("Billing initialization unavailable");
        if (created.rows.length === 1) currentPrecondition = etag(target);
      }
      const replay = (
        await tx.query(
          sql(
            "SELECT request_sha256,receipt_json FROM platform_staff_account_actions WHERE principal_id=$1 AND idempotency_key_sha256=$2",
            [actor.principalId, key],
          ),
        )
      ).rows[0];
      if (replay) {
        if (replay["request_sha256"] !== request)
          throw new ApplicationError(
            "idempotency_key_reused",
            "This attempt was already used for a different action.",
          );
        await this.#authorize(tx, actor, permission, true);
        return readActionReceipt(replay["receipt_json"]);
      }
      if (value.confirmBillingAccountId !== target.billingAccountId) invalid();
      if (etag(target) !== currentPrecondition)
        throw new ApplicationError(
          "precondition_failed",
          "The account changed. Reload it before applying this action.",
        );
      if (
        target.billingState === "closed" ||
        (value.action !== "set-operations" &&
          (target.billingState !== "active" ||
            target.organizationState !== "active"))
      )
        throw new ApplicationError(
          "conflict",
          "This account cannot receive credit changes in its current state.",
        );
      if (
        value.action === "set-operations" &&
        value.enabled &&
        (target.billingState !== "active" ||
          target.organizationState !== "active")
      )
        throw new ApplicationError(
          "conflict",
          "Resolve the account suspension before enabling operations.",
        );
      const clock = (
        await tx.query(sql("SELECT " + utc("clock_timestamp()") + " AS now"))
      ).rows[0]?.["now"];
      if (typeof clock !== "string") throw Error("Clock unavailable");
      const actionId = "staff_" + randomUUID().replaceAll("-", ""),
        ledgerId = "ledger_" + actionId;
      const grantId =
        value.action === "grant-credits"
          ? "grant_" + actionId
          : value.action === "revoke-credits"
            ? value.creditGrantId
            : null;
      const context = {
        authority: "internal-administration" as const,
        actorId: actor.principalId,
        actorPrincipalId: actor.principalId,
        organizationId,
        correlationId: actor.correlationId,
      };
      const bound: SqlDatabase = {
        query: (statement) => tx.query(statement),
        transaction: (work) => work(tx),
        close: () => Promise.resolve(),
      };
      const commercial = new PostgresCommercialPersistenceRepository(bound);
      const trial =
        value.action === "grant-trial" || value.action === "revoke-trial"
          ? await applyStaffTrial(tx, actor, target, value, clock, actionId)
          : undefined;
      if (value.action === "grant-credits") {
        if (grantId === null) return invalid();
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
              expiresAt: new Date(
                Date.parse(clock) + value.expiresInDays * 86400000,
              ).toISOString(),
              policyVersion: policy,
            },
            grantPolicyVersion: policy,
            chargingPolicyVersion: policy,
            consumptionPriority: "20",
            idempotencyKey: actionId,
            reasonCode: "staff.credit-grant",
            safeReason: value.reason,
            sourceReference: "staff-action:" + actionId,
          },
        );
        // Supply the real tenant snapshot identity required by reservations.
        // Existing paid/trial projections and their history remain intact; the
        // effective read selects Credits only when those authorities are absent.
        await tx.query(
          sql(
            `INSERT INTO organization_entitlement_snapshots(organization_id,entitlement_snapshot_id,billing_account_id,subscription_projection_id,plan_version_id,entitlement_policy_version,source_record_version,expensive_operations_enabled,effective_at)
             VALUES($1,$2,$3,NULL,'planver_staff_credits_2026_10_15_v1','cloudmarkup-entitlements-v1',$4,true,$5::timestamptz)
             ON CONFLICT(organization_id) DO NOTHING`,
            [
              organizationId,
              "entitlement_" + actionId,
              target.billingAccountId,
              target.version + 1,
              clock,
            ],
          ),
        );
      } else if (value.action === "revoke-credits") {
        const grant = (
          await tx.query(
            sql(
              "SELECT ledger_entry_id FROM platform_staff_account_actions WHERE organization_id=$1 AND billing_account_id=$2 AND action='grant-credits' AND credit_grant_id=$3",
              [organizationId, target.billingAccountId, value.creditGrantId],
            ),
          )
        ).rows[0];
        if (typeof grant?.["ledger_entry_id"] !== "string")
          throw new ApplicationError(
            "not_found",
            "Only a complimentary grant on this account can be revoked.",
          );
        await commercial.appendCompensatingAdjustment(context, {
          creditGrantId: value.creditGrantId,
          adjustmentCreditUnits: String(-value.creditUnits),
          ledgerEntryId: ledgerId,
          relatedLedgerEntryId: grant["ledger_entry_id"],
          chargingPolicyVersion: policy,
          idempotencyKey: actionId,
          reasonCode: "staff.credit-revocation",
          safeReason: value.reason,
        });
      }
      await tx.query(
        sql(
          "UPDATE organization_billing_accounts SET record_version=record_version+1,updated_at=clock_timestamp(),expensive_operations_enabled=COALESCE($2,expensive_operations_enabled) WHERE organization_id=$1",
          [
            organizationId,
            value.action === "set-operations" ? value.enabled : null,
          ],
        ),
      );
      if (value.action === "set-operations") {
        const current = (
          await tx.query(
            sql(
              "SELECT e.entitlement_snapshot_id,e.record_version::text,e.entitlement_policy_version,p.subscription_projection_id,p.plan_version_id,p.record_version::text AS source_record_version,p.normalized_status FROM organization_entitlement_snapshots e JOIN organization_subscription_projections p ON p.organization_id=e.organization_id AND p.billing_account_id=e.billing_account_id AND p.subscription_projection_id=e.subscription_projection_id WHERE e.organization_id=$1 FOR UPDATE OF e,p",
              [organizationId],
            ),
          )
        ).rows[0];
        if (current) {
          const read = (key: string) => {
            const field = current[key];
            if (typeof field !== "string")
              throw Error("Invalid entitlement metadata");
            return field;
          };
          await commercial.updateEntitlementSnapshot(context, {
            entitlementSnapshotId: read("entitlement_snapshot_id"),
            expectedRecordVersion: read("record_version"),
            entitlementPolicyVersion: read("entitlement_policy_version"),
            subscriptionProjectionId: read("subscription_projection_id"),
            planVersionId: read("plan_version_id"),
            sourceRecordVersion: read("source_record_version"),
            expensiveOperationsEnabled:
              value.enabled && current["normalized_status"] === "active",
            effectiveAt: clock,
          });
        }
      }
      const receipt = staffActionReceiptV1Schema.parse({
        contractVersion: 1,
        actionId,
        organizationId,
        billingAccountId: target.billingAccountId,
        actorPrincipalId: actor.principalId,
        action: value.action,
        creditUnits:
          trial?.creditUnits ??
          (value.action === "grant-credits" || value.action === "revoke-credits"
            ? String(value.creditUnits)
            : null),
        ...(trial
          ? { trialId: trial.trialId, trialExpiresAt: trial.trialExpiresAt }
          : {}),
        creditGrantId: trial?.creditGrantId ?? grantId,
        expensiveOperationsEnabled:
          value.action === "set-operations" ? value.enabled : null,
        reason: value.reason,
        occurredAt: clock,
        accountVersion: target.version + 1,
      });
      await tx.query(
        sql(
          "INSERT INTO platform_staff_account_actions(action_id,principal_id,organization_id,billing_account_id,idempotency_key_sha256,request_sha256,action,credit_grant_id,ledger_entry_id,receipt_json,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz)",
          [
            actionId,
            actor.principalId,
            organizationId,
            target.billingAccountId,
            key,
            request,
            value.action,
            trial?.creditGrantId ?? grantId,
            trial
              ? trial.ledgerEntryId
              : value.action === "set-operations"
                ? null
                : ledgerId,
            JSON.stringify(receipt),
            clock,
          ],
        ),
      );
      await this.#authorize(tx, actor, permission, true);
      return receipt;
    });
  };
}
