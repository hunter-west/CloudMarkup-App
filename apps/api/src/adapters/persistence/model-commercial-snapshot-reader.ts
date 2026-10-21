import {
  ENTITLEMENT_POLICY_VERSION,
  type CreditNormalizationPolicyVersionV1,
  type ModelProviderPricingVersionV1,
} from "@cloudmarkup/domain";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import type { ModelInvocationDescriptorV1 } from "@cloudmarkup/schemas";
import type { PrincipalContext } from "../../application/ports.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type {
  CommercialEntitlementSnapshotRecord,
  CreditBalanceRecord,
  TrustedCommercialAccountingContext,
} from "../../application/commercial-persistence.js";
import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import { readModelCreditBalanceInTransaction } from "./commercial-repositories.js";
import { PostgresModelCommercialPersistenceRepository } from "./model-commercial-repository.js";
import {
  modelReadAssert,
  modelReadNumber,
  projectModelReadNormalization,
  projectModelReadPrice,
  type ModelCommercialReadSelectorsV1,
} from "./model-commercial-read-host-codec.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

/** Internal shared SQL algorithm. Only closed, authenticated normal/live host
 * wrappers may provide this boundary; it is not a serialized permission object
 * or a public package export. It has no mutation/reservation/provider port. */
export interface ModelCommercialSnapshotReadAuthority {
  readonly principal: PrincipalContext;
  assertCurrent(
    tx: SqlExecutor,
    scope: ModelCommercialSnapshotScope,
  ): Promise<{ readonly expiresAt: string }>;
}
type ModelCommercialPriceSelectors = Pick<
  ModelCommercialReadSelectorsV1,
  | "pricingVersionId"
  | "pricingVersionDigest"
  | "normalizationPolicyVersionId"
  | "normalizationPolicyDigest"
>;
export interface ModelCommercialSnapshotScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly userId: string;
}
/** Canonical read observation only, not admission, estimate acceptance, a
 * reservation or promotion authority. Contains no model input/output body.
 * The host still needs genuine usage bounds, consent and current route/policy/
 * evaluation authority. Canonical reserve remains the final race arbiter. */
type ModelCommercialDescriptor = Pick<
  ModelInvocationDescriptorV1,
  "providerId" | "modelId" | "modelVersion" | "inferenceProfileId"
>;
export interface ModelCommercialSnapshotData<
  Descriptor extends ModelCommercialDescriptor = ModelInvocationDescriptorV1,
> {
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly descriptor: Descriptor;
  readonly entitlement: Pick<
    CommercialEntitlementSnapshotRecord,
    | "entitlementSnapshotId"
    | "sourceRecordVersion"
    | "subscriptionProjectionId"
    | "planVersionId"
    | "entitlementPolicyVersion"
  > & {
    /** Existing model routing tier. Canonical billing/access identity remains
     * planVersionId; this key never creates a subscription or paid feature. */
    readonly planKey: string;
    readonly trial?: { readonly id: string; readonly expiresAt: string };
  };
  readonly featureEnabled: boolean;
  readonly maximumConcurrentReservations: number;
  readonly balance: CreditBalanceRecord;
  readonly price: ModelProviderPricingVersionV1;
  readonly normalization: CreditNormalizationPolicyVersionV1;
}
const rowText = (row: SqlRow, key: string): string => {
  const value = row[key];
  modelReadAssert(typeof value === "string");
  return value;
};

/** Shared with the post-admission reader. Same canonical subscription/version,
 * account, plan, period semantics, balance and price projection in one real
 * transaction. No runtime admission row is read or created by this function. */
export async function readModelCommercialSnapshotData<
  Descriptor extends ModelCommercialDescriptor,
>(input: {
  readonly database: SqlDatabase;
  readonly tx: SqlExecutor;
  readonly authority: ModelCommercialSnapshotReadAuthority;
  readonly scope: ModelCommercialSnapshotScope;
  readonly descriptor: Descriptor;
  readonly selectors: ModelCommercialPriceSelectors;
}): Promise<ModelCommercialSnapshotData<Descriptor>> {
  const { database, tx, authority, scope, descriptor, selectors } = input;
  await authority.assertCurrent(tx, scope);
  const membership = (
    await tx.query(
      sql(
        `SELECT m.membership_id,m.role_key FROM memberships m WHERE organization_id=$1 AND principal_id=$2 AND lifecycle_status='active'`,
        [scope.organizationId, scope.userId],
      ),
    )
  ).rows[0];
  modelReadAssert(membership !== undefined);
  const role = rowText(membership, "role_key");
  modelReadAssert(isOrganizationRole(role));
  const principal = authority.principal;
  const authorizedScope: AuthorizedOrganizationScope = {
    organizationId: scope.organizationId,
    principalId: principal.principalId,
    correlationId: principal.correlationId,
    sessionId: principal.sessionId,
    membershipId: rowText(membership, "membership_id"),
    roleKey: role,
    capabilities: permissionsForRole(role),
  };
  const account = await tx.query(
    sql(
      `SELECT a.billing_account_id,e.plan_version_id FROM organization_billing_accounts a LEFT JOIN organization_effective_entitlement_snapshots_v1 e ON e.organization_id=a.organization_id AND e.billing_account_id=a.billing_account_id WHERE a.organization_id=$1 FOR SHARE OF a`,
      [scope.organizationId],
    ),
  );
  modelReadAssert(account.rowCount === 1);
  const trialProfile =
    account.rows[0]?.["plan_version_id"] ===
    "planver_staff_trial_2026_10_06_v1";
  const staffCreditProfile =
    account.rows[0]?.["plan_version_id"] ===
    "planver_staff_credits_2026_10_15_v1";
  const plan = (
    await tx.query(
      sql(
        `SELECT s.entitlement_snapshot_id,s.source_record_version::text,s.subscription_projection_id,
      s.plan_version_id,s.entitlement_policy_version,s.expensive_operations_enabled AS snapshot_enabled,
      a.lifecycle_status AS account_state,a.expensive_operations_enabled AS account_enabled,
      ${trialProfile ? `t.trial_id,to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_expires_at,` : ""}
      to_char(p.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_until,d.plan_key,f.entitlement_state
     FROM organization_effective_entitlement_snapshots_v1 s
     JOIN organization_billing_accounts a ON a.organization_id=s.organization_id AND a.billing_account_id=s.billing_account_id
     ${trialProfile ? "JOIN platform_staff_trials t ON t.organization_id=s.organization_id AND t.billing_account_id=s.billing_account_id" : ""}
     ${trialProfile || staffCreditProfile ? "LEFT JOIN" : "JOIN"} organization_subscription_projections sub ON sub.organization_id=s.organization_id AND sub.subscription_projection_id=s.subscription_projection_id
       AND sub.record_version=s.source_record_version AND sub.plan_version_id=s.plan_version_id AND sub.normalized_status='active'
     JOIN commercial_plan_versions p ON p.plan_version_id=s.plan_version_id AND p.configuration_status='proposed-beta-example'
     JOIN commercial_plan_definitions d ON d.plan_id=p.plan_id
     JOIN commercial_plan_feature_entitlements f ON f.plan_version_id=s.plan_version_id AND f.feature_key='ai-assisted-operations'
     WHERE s.organization_id=$1 AND s.effective_at<=clock_timestamp() AND p.effective_from<=clock_timestamp()
       AND (p.effective_until IS NULL OR p.effective_until>clock_timestamp())
       ${trialProfile ? "AND s.subscription_projection_id IS NULL AND cloudmarkup_staff_trial_current_v1(s.organization_id,s.billing_account_id)" : ""}
       ${staffCreditProfile ? "AND s.subscription_projection_id IS NULL AND cloudmarkup_staff_credit_access_v1(s.organization_id,s.billing_account_id)" : ""}
     FOR SHARE OF s,${trialProfile || staffCreditProfile ? "" : "sub,"}p,d,f`,
        [scope.organizationId],
      ),
    )
  ).rows[0];
  modelReadAssert(plan !== undefined);
  const planVersion = rowText(plan, "plan_version_id");
  const planKey = rowText(plan, "plan_key");
  modelReadAssert(
    rowText(plan, "entitlement_policy_version") === ENTITLEMENT_POLICY_VERSION,
  );
  const limits = await tx.query(
    sql(
      `SELECT limit_key,limit_scope,period_kind,limit_value::text FROM commercial_plan_numeric_limits WHERE plan_version_id=$1 FOR SHARE`,
      [planVersion],
    ),
  );
  modelReadAssert(
    !limits.rows.some((row) =>
      ["per-user-request-count", "per-project-credit-cap"].includes(
        rowText(row, "limit_key"),
      ),
    ),
  );
  const concurrency = limits.rows.filter(
    (row) => row["limit_key"] === "concurrent-ai-jobs",
  );
  modelReadAssert(
    concurrency.length === 1 &&
      concurrency[0]?.["limit_scope"] === "organization" &&
      concurrency[0]["period_kind"] === "none",
  );
  const maximumConcurrent = modelReadNumber(concurrency[0]["limit_value"]);
  const balance = await readModelCreditBalanceInTransaction(
    tx,
    authorizedScope,
  );
  const context: TrustedCommercialAccountingContext = {
    authority: "internal-accounting",
    actorId: "model-commercial-read-v1",
    correlationId: principal.correlationId,
    organizationId: scope.organizationId,
  };
  const repository = new PostgresModelCommercialPersistenceRepository(database);
  const priceRecord =
    await repository.getModelProviderPricingVersionInTransaction(
      tx,
      context,
      selectors.pricingVersionId,
    );
  const normalizationRecord =
    await repository.getCreditNormalizationPolicyVersionInTransaction(
      tx,
      context,
      selectors.normalizationPolicyVersionId,
    );
  modelReadAssert(priceRecord !== null && normalizationRecord !== null);
  const price = projectModelReadPrice(priceRecord);
  const normalization = projectModelReadNormalization(normalizationRecord);
  modelReadAssert(
    digestStructuredValue(price) === selectors.pricingVersionDigest &&
      digestStructuredValue(normalization) ===
        selectors.normalizationPolicyDigest,
  );
  modelReadAssert(
    price.status === "enabled" &&
      normalization.status === "enabled" &&
      price.currencyCode === normalization.currencyCode,
  );
  modelReadAssert(
    price.providerKey === descriptor.providerId &&
      price.modelId === descriptor.modelId &&
      price.modelVersion === descriptor.modelVersion &&
      price.inferenceProfileId === (descriptor.inferenceProfileId ?? null),
  );
  const current = await authority.assertCurrent(tx, scope);
  const clock = (
    await tx.query(
      sql(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at`,
      ),
    )
  ).rows[0];
  modelReadAssert(clock !== undefined);
  const observedAt = rowText(clock, "observed_at");
  const now = Date.parse(observedAt);
  const ends = [Date.parse(current.expiresAt)];
  if (planKey === "staff-trial")
    ends.push(Date.parse(rowText(plan, "trial_expires_at")));
  if (plan["effective_until"] !== null)
    ends.push(Date.parse(rowText(plan, "effective_until")));
  for (const version of [price, normalization]) {
    modelReadAssert(Date.parse(version.effectiveFrom) <= now);
    if (version.effectiveUntil !== null)
      ends.push(Date.parse(version.effectiveUntil));
  }
  modelReadAssert(
    Number.isFinite(now) &&
      ends.every((end) => Number.isFinite(end) && now < end),
  );
  // Keep policy enablement distinct from a paid-operation authorization.
  const featureEnabled =
    plan["account_state"] === "active" &&
    plan["account_enabled"] === true &&
    plan["snapshot_enabled"] === true &&
    ["enabled", "limited"].includes(rowText(plan, "entitlement_state"));
  const snapshot: ModelCommercialSnapshotData<Descriptor> = {
    observedAt,
    expiresAt: new Date(Math.min(...ends)).toISOString(),
    descriptor,
    entitlement: {
      entitlementSnapshotId: rowText(plan, "entitlement_snapshot_id"),
      sourceRecordVersion: rowText(plan, "source_record_version"),
      ...(planKey === "staff-trial"
        ? {
            trial: {
              id: rowText(plan, "trial_id"),
              expiresAt: rowText(plan, "trial_expires_at"),
            },
          }
        : staffCreditProfile
          ? {}
          : {
              subscriptionProjectionId: rowText(
                plan,
                "subscription_projection_id",
              ),
            }),
      planVersionId: planVersion,
      // The closed model catalog routes standard AI as Starter and existing
      // Professional trials as Pro. Keep those reviewed routing policies while
      // retaining the exact independent funding profile/version and authority.
      planKey: staffCreditProfile ? "starter" : trialProfile ? "pro" : planKey,
      entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION,
    },
    featureEnabled,
    maximumConcurrentReservations: maximumConcurrent,
    balance,
    price,
    normalization,
  };
  return structuredClone(snapshot);
}
