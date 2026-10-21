import { STAFF_TRIAL_PLAN_VERSION } from "@cloudmarkup/domain";
import { createHash } from "node:crypto";

import {
  sharingPlanConfigurationVersionV1,
  includedMembersForSharingPlanV1,
  isExpensiveCommercialFeature,
  type CommercialFeatureKey,
} from "@cloudmarkup/domain";

import {
  CommercialPersistenceError,
  type AppendCreditAdjustmentInput,
  type ChargingScenario,
  type CommercialBillingAccountRecord,
  type CommercialEntitlementSnapshotInput,
  type CommercialEntitlementSnapshotRecord,
  type CommercialPersistenceRepository,
  type CommercialSubscriptionProjectionInput,
  type CommercialSubscriptionProjectionRecord,
  type CreateCommercialBillingAccountInput,
  type CreateCreditGrantInput,
  type CreditBalanceRecord,
  type CreditGrantSummaryRecord,
  type CreditOverviewRecord,
  type CreditGrantExpirationSummaryRecord,
  type CreditGrantRecord,
  type CreditReservationAllocationRecord,
  type CreditReservationRecord,
  type CurrentPlanEntitlementsRecord,
  type ExpireCreditReservationInput,
  type ProviderPricingVersionInput,
  type ProviderPricingVersionRecord,
  type ProviderUsageMetricsInput,
  type ReleaseCreditReservationInput,
  type ReserveCreditsInput,
  type SeatUsageRecord,
  type SettleCreditReservationInput,
  type TrustedCommercialAccountingContext,
  type TrustedCommercialAdministrationContext,
  type TrustedCommercialReservationContext,
  type TrustedCommercialMutationContext,
  type UpdateCommercialBillingAccountInput,
  type UsageLedgerAllocationRecord,
  type UsageLedgerEntryRecord,
  type UsageSummaryRecord,
} from "../../application/commercial-persistence.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type { SqlDatabase, SqlExecutor, SqlRow } from "./sql.js";
import { sql } from "./sql.js";
import { modelProviderKeyPattern } from "./model-provider-key.js";
import { parseDatabaseTimestamp } from "./database-timestamp.js";

/** Internal transaction seam. Only the model accounting adapter supplies this
 * after authenticating its immutable workflow, runtime window and price pins. */
export interface ModelReservationTransactionAuthority {
  readonly capturedAt: string;
  readonly environment: string;
  readonly inferenceProfileId: string | null;
  readonly normalizationPolicyVersionId: string;
  readonly perUserMaximum: number;
  readonly assertCurrent: (transaction: SqlExecutor) => Promise<void>;
}

export type ModelTerminalSettlementInput = Omit<
  SettleCreditReservationInput,
  "chargingScenario"
> & {
  readonly chargingScenario:
    "model-preview-delivered-v1" | "model-evaluation-recorded-v2";
};
export interface ModelTerminalTransactionAuthority {
  readonly actualCreditUnits: string;
  readonly assertCurrent: (transaction: SqlExecutor) => Promise<void>;
}
type TerminalInput =
  | SettleCreditReservationInput
  | ModelTerminalSettlementInput
  | ReleaseCreditReservationInput
  | ExpireCreditReservationInput;

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const featureKeyPattern = /^[a-z][a-z0-9-]{0,127}$/;
const reasonCodePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const providerKeyPattern = /^[a-z][a-z0-9-]{0,63}$/;
const modelIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const signedDecimalIntegerPattern = /^-?(?:0|[1-9][0-9]*)$/;
const postgresBigintMaximum = 9_223_372_036_854_775_807n;
const postgresBigintMinimum = -9_223_372_036_854_775_808n;

type BillingAccountRow = SqlRow & {
  readonly billing_account_id: unknown;
  readonly expensive_operations_enabled: unknown;
  readonly lifecycle_status: unknown;
  readonly organization_id: unknown;
  readonly record_version: unknown;
};

type SubscriptionRow = SqlRow & {
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

type GrantRow = SqlRow & {
  readonly billing_account_id: unknown;
  readonly consumption_priority: unknown;
  readonly credit_grant_id: unknown;
  readonly credit_units: unknown;
  readonly expires_at: unknown;
  readonly expiration_policy_kind: unknown;
  readonly expiration_policy_version: unknown;
  readonly grant_kind: unknown;
  readonly grant_policy_version: unknown;
  readonly organization_id: unknown;
  readonly plan_version_id: unknown;
  readonly source_reference: unknown;
  readonly starts_at: unknown;
  readonly subscription_period_end: unknown;
  readonly subscription_period_id: unknown;
  readonly subscription_period_start: unknown;
};

type AvailableGrantRow = GrantRow & {
  readonly available_credit_units: unknown;
};

type ReservationRow = SqlRow & {
  readonly acting_principal_id: unknown;
  readonly billing_account_id: unknown;
  readonly charging_policy_version: unknown;
  readonly created_at: unknown;
  readonly entitlement_policy_version: unknown;
  readonly entitlement_snapshot_id: unknown;
  readonly expires_at: unknown;
  readonly feature_key: unknown;
  readonly idempotency_key_sha256: unknown;
  readonly is_expired?: unknown;
  readonly job_id: unknown;
  readonly model_key: unknown;
  readonly model_version: unknown;
  readonly organization_id: unknown;
  readonly plan_version_id: unknown;
  readonly pricing_version_id: unknown;
  readonly project_id: unknown;
  readonly provider_key: unknown;
  readonly record_version: unknown;
  readonly request_id: unknown;
  readonly request_sha256: unknown;
  readonly requested_credit_units: unknown;
  readonly reservation_id: unknown;
  readonly reserved_credit_units: unknown;
  readonly status: unknown;
  readonly terminal_at: unknown;
  readonly terminal_idempotency_key_sha256: unknown;
  readonly terminal_ledger_entry_id: unknown;
  readonly terminal_payload_sha256: unknown;
  readonly terminal_request_sha256: unknown;
};

type ProviderPricingRow = SqlRow & {
  readonly cached_input_micros_per_million_tokens: unknown;
  readonly cost_currency: unknown;
  readonly created_at: unknown;
  readonly credit_conversion_denominator: unknown;
  readonly credit_conversion_numerator: unknown;
  readonly effective_from: unknown;
  readonly effective_until: unknown;
  readonly input_micros_per_million_tokens: unknown;
  readonly model_key: unknown;
  readonly model_version: unknown;
  readonly output_micros_per_million_tokens: unknown;
  readonly pricing_version_id: unknown;
  readonly provider_key: unknown;
};

type AllocationRow = SqlRow & {
  readonly allocation_sequence: unknown;
  readonly credit_grant_id: unknown;
  readonly reserved_credit_units: unknown;
  readonly settled_credit_units: unknown;
};
type UsageAllocationRow = SqlRow & {
  readonly allocation_sequence: unknown;
  readonly credit_adjustment_units: unknown;
  readonly credit_grant_id: unknown;
  readonly expired_credit_units: unknown;
  readonly released_credit_units: unknown;
  readonly reserved_credit_units: unknown;
  readonly settled_credit_units: unknown;
};

type UsageRow = SqlRow & {
  readonly acting_principal_id: unknown;
  readonly cached_input_token_count: unknown;
  readonly charging_scenario: unknown;
  readonly charging_policy_version: unknown;
  readonly credit_adjustment_units: unknown;
  readonly credit_grant_id: unknown;
  readonly entitlement_policy_version: unknown;
  readonly entry_kind: unknown;
  readonly estimated_provider_cost_micros: unknown;
  readonly expired_credit_units: unknown;
  readonly feature_key: unknown;
  readonly granted_credit_units: unknown;
  readonly idempotency_key_sha256: unknown;
  readonly input_token_count: unknown;
  readonly job_id: unknown;
  readonly latency_milliseconds: unknown;
  readonly ledger_entry_id: unknown;
  readonly normalized_credit_units: unknown;
  readonly occurred_at: unknown;
  readonly organization_id: unknown;
  readonly outcome: unknown;
  readonly output_token_count: unknown;
  readonly model_key: unknown;
  readonly model_version: unknown;
  readonly plan_version_id: unknown;
  readonly pricing_version_id: unknown;
  readonly project_id: unknown;
  readonly provider_cost_currency: unknown;
  readonly provider_key: unknown;
  readonly provider_request_id: unknown;
  readonly reason_code: unknown;
  readonly recorded_by_actor_id: unknown;
  readonly recorded_by_actor_kind: unknown;
  readonly related_ledger_entry_id: unknown;
  readonly released_credit_units: unknown;
  readonly request_id: unknown;
  readonly reservation_id: unknown;
  readonly reserved_credit_units: unknown;
  readonly safe_reason: unknown;
  readonly settled_credit_units: unknown;
};

const reservationSelect = `
  SELECT reservation_id, organization_id, billing_account_id,
         entitlement_snapshot_id, entitlement_policy_version,
         plan_version_id, pricing_version_id, charging_policy_version,
         acting_principal_id, project_id, feature_key, request_id, job_id,
         provider_key, model_key, model_version, requested_credit_units,
         reserved_credit_units, status, request_sha256,
         idempotency_key_sha256, terminal_request_sha256,
         terminal_idempotency_key_sha256, terminal_ledger_entry_id,
         terminal_payload_sha256, record_version, created_at, expires_at,
         terminal_at, to_jsonb(credit_reservations)->>'pricing_authority' AS pricing_authority,
         expires_at <= CURRENT_TIMESTAMP AS is_expired
  FROM credit_reservations
`;

const usageSelect = `
  SELECT ledger_entry_id, usage_ledger_entries.organization_id, entry_kind, reservation_id,
         credit_grant_id, related_ledger_entry_id, acting_principal_id,
         entitlement_policy_version, idempotency_key_sha256,
         charging_scenario,
         recorded_by_actor_kind, recorded_by_actor_id, project_id,
         feature_key, request_id, job_id, plan_version_id,
         pricing_version_id, provider_key, model_key, model_version,
         provider_request_id, input_token_count, output_token_count,
         cached_input_token_count, latency_milliseconds,
         estimated_provider_cost_micros, provider_cost_currency,
         normalized_credit_units,
         granted_credit_units,
         reserved_credit_units, settled_credit_units,
         released_credit_units, expired_credit_units,
         credit_adjustment_units, outcome, reason_code, safe_reason,
         charging_policy_version, occurred_at
  FROM usage_ledger_entries
`;

function fail(
  code: ConstructorParameters<typeof CommercialPersistenceError>[0],
  message: string,
): never {
  throw new CommercialPersistenceError(code, message);
}

function assertIdentifier(value: string): void {
  if (!opaqueIdPattern.test(value)) {
    fail("invalid-input", "The commercial persistence input is invalid.");
  }
}

function assertBounded(value: string, maximum: number): void {
  if (
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    Array.from(value).some((character) => {
      const codeUnit = character.charCodeAt(0);
      return codeUnit <= 0x1f || codeUnit === 0x7f;
    })
  ) {
    fail("invalid-input", "The commercial persistence input is invalid.");
  }
}

function assertTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    fail("invalid-input", "The commercial persistence input is invalid.");
  }
}

function assertSha256(value: string): void {
  if (!sha256Pattern.test(value)) {
    fail("invalid-input", "The commercial persistence input is invalid.");
  }
}

function optionalInstantMatches(
  persisted: unknown,
  expected: string | undefined,
): boolean {
  const actual = readOptionalTimestamp(persisted);
  if (actual === undefined || expected === undefined) {
    return actual === expected;
  }
  return Date.parse(actual) === Date.parse(expected);
}

function unsignedInteger(value: string, positive = false): bigint {
  if (!decimalIntegerPattern.test(value)) {
    return fail("invalid-input", "The commercial integer value is invalid.");
  }
  const parsed = BigInt(value);
  if ((positive && parsed === 0n) || parsed > postgresBigintMaximum) {
    return fail("invalid-input", "The commercial integer value is invalid.");
  }
  return parsed;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    return fail(
      "invalid-input",
      "The commercial normalization ratio is invalid.",
    );
  }
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function signedInteger(value: string, nonzero = false): bigint {
  if (!signedDecimalIntegerPattern.test(value)) {
    return fail("invalid-input", "The commercial integer value is invalid.");
  }
  const parsed = BigInt(value);
  if (
    (nonzero && parsed === 0n) ||
    parsed < postgresBigintMinimum ||
    parsed > postgresBigintMaximum
  ) {
    return fail("invalid-input", "The commercial integer value is invalid.");
  }
  return parsed;
}

function readString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return fail(
    "invalid-input",
    "The database returned invalid commercial data.",
  );
}

function readTimestamp(value: unknown): string {
  return (
    parseDatabaseTimestamp(value) ??
    fail("invalid-input", "The database returned invalid commercial data.")
  );
}

function readOptionalTimestamp(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : readTimestamp(value);
}

function readOptionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : readString(value);
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return fail(
      "invalid-input",
      "The database returned invalid commercial data.",
    );
  }
  const items: readonly unknown[] = value;
  return items.map((item) =>
    typeof item === "string"
      ? item
      : fail("invalid-input", "The database returned invalid commercial data."),
  );
}

function readCommercialState<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
): TValue {
  const state = readString(value);
  return allowed.includes(state as TValue)
    ? (state as TValue)
    : fail("invalid-input", "The database returned invalid commercial data.");
}

function readOptionalDecimal(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : readDecimal(value);
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    return fail(
      "invalid-input",
      "The database returned invalid commercial data.",
    );
  }
  return value;
}

function readInteger(value: unknown): bigint {
  const parsed =
    typeof value === "bigint"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === "string" && signedDecimalIntegerPattern.test(value)
          ? BigInt(value)
          : undefined;
  if (
    parsed === undefined ||
    parsed < postgresBigintMinimum ||
    parsed > postgresBigintMaximum
  ) {
    return fail(
      "invalid-input",
      "The database returned invalid commercial data.",
    );
  }
  return parsed;
}

function readDecimal(value: unknown): string {
  return readInteger(value).toString();
}

function assertPolicyVersion(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)) {
    fail("invalid-input", "The commercial policy version is invalid.");
  }
}

function hashIdempotencyKey(value: string): string {
  if (value.length < 16 || value.length > 128 || /\s/.test(value)) {
    return fail("invalid-input", "The Idempotency-Key is invalid.");
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicLedgerIdentity(
  kind: string,
  reservationId: string,
): {
  readonly id: string;
  readonly idempotencySha256: string;
} {
  const digest = createHash("sha256")
    .update(["commercial-ledger-v1", kind, reservationId].join("\u0000"))
    .digest("hex");
  return {
    id: `ledger_${digest.slice(0, 48)}`,
    idempotencySha256: digest,
  };
}

async function lockUsageLedgerIdentity(
  executor: SqlExecutor,
  organizationId: string,
  ledgerEntryId: string,
  idempotencyKeySha256: string,
): Promise<void> {
  await executor.query(
    sql(
      `SELECT pg_advisory_xact_lock(hashtextextended(lock_key, 0))
       FROM (VALUES ($1), ($2)) identity(lock_key)
       ORDER BY lock_key`,
      [
        `commercial-ledger-id:${organizationId}:${ledgerEntryId}`,
        `commercial-ledger-key:${organizationId}:${idempotencyKeySha256}`,
      ],
    ),
  );
}

function deterministicAdjustmentGrantIdentity(ledgerEntryId: string): {
  readonly grantId: string;
  readonly idempotencySha256: string;
} {
  const digest = createHash("sha256")
    .update(["commercial-adjustment-grant-v1", ledgerEntryId].join("\u0000"))
    .digest("hex");
  return {
    grantId: `grant_adjustment_${digest.slice(0, 48)}`,
    idempotencySha256: digest,
  };
}

type TerminalTransition =
  | {
      readonly customerChargeCreditUnits: bigint;
      readonly kind: "settlement";
      readonly normalizedCreditUnits: bigint;
    }
  | { readonly kind: "release" }
  | { readonly kind: "expiration" };

function chargingScenarioForTerminal(
  input: TerminalInput,
  transition: TerminalTransition,
): ChargingScenario | "beta-ai-output-delivered-v1" | null {
  if (transition.kind === "expiration") return null;
  const supplied =
    "chargingScenario" in input ? input.chargingScenario : undefined;
  if (supplied === undefined) {
    return fail("invalid-input", "A terminal charging scenario is required.");
  }
  if (transition.kind === "settlement") {
    if (
      ![
        "proposal-delivered-user-rejected",
        "system-required-repair",
        "beta-ai-output-delivered-v1",
        "model-preview-delivered-v1",
        "model-evaluation-recorded-v2",
      ].includes(supplied)
    ) {
      return fail(
        "invalid-input",
        "Only chargeable typed outcomes may settle a reservation.",
      );
    }
    return supplied;
  }
  return supplied;
}

function terminalPayloadSha256(
  input: TerminalInput,
  transition: TerminalTransition,
  chargingScenario: ChargingScenario | "beta-ai-output-delivered-v1" | null,
): string {
  const metrics = input as ProviderUsageMetricsInput;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "commercial-terminal-v1",
        transition.kind,
        transition.kind === "settlement"
          ? transition.normalizedCreditUnits.toString()
          : null,
        transition.kind === "settlement"
          ? transition.customerChargeCreditUnits.toString()
          : null,
        "reasonCode" in input ? input.reasonCode : null,
        "safeReason" in input ? input.safeReason : null,
        "requestId" in input ? input.requestId : null,
        "pricingVersionId" in input ? (input.pricingVersionId ?? null) : null,
        chargingScenario ?? null,
        metrics.providerKey ?? null,
        metrics.modelId ?? null,
        metrics.modelVersion ?? null,
        metrics.providerRequestId ?? null,
        metrics.inputTokenCount ?? null,
        metrics.outputTokenCount ?? null,
        metrics.cachedInputTokenCount ?? null,
        metrics.latencyMilliseconds ?? null,
        metrics.estimatedProviderCostMicros ?? null,
        metrics.providerCostCurrency ?? null,
      ]),
      "utf8",
    )
    .digest("hex");
}

function assertHumanScope(scope: AuthorizedOrganizationScope): void {
  assertIdentifier(scope.principalId);
  assertIdentifier(scope.membershipId);
  assertIdentifier(scope.organizationId);
  assertBounded(scope.correlationId, 128);
  assertBounded(scope.sessionId, 256);
}

function assertAccountingContext(
  context: TrustedCommercialMutationContext,
): void {
  if (context.authority !== "internal-accounting") {
    fail("access-denied", "Commercial accounting authority is required.");
  }
  assertIdentifier(context.actorId);
  assertIdentifier(context.organizationId);
  assertBounded(context.correlationId, 128);
}

function assertAdministrationContext(
  context: TrustedCommercialMutationContext,
): void {
  if (context.authority !== "internal-administration") {
    fail("access-denied", "Commercial administration authority is required.");
  }
  assertIdentifier(context.actorId);
  assertIdentifier(context.actorPrincipalId);
  assertIdentifier(context.organizationId);
  assertBounded(context.correlationId, 128);
}

function assertMutationContext(
  context: TrustedCommercialMutationContext,
): void {
  if (context.authority === "internal-accounting") {
    assertAccountingContext(context);
  } else {
    assertAdministrationContext(context);
  }
}

function requireScopePermission(
  scope: AuthorizedOrganizationScope,
  permission:
    | "commercial.summary.read"
    | "commercial.expensive.use"
    | "usage.read-technical",
): void {
  if (!scope.capabilities.includes(permission)) {
    fail("access-denied", "Access is not available.");
  }
}

async function requireHumanScope(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  permission:
    | "commercial.summary.read"
    | "commercial.expensive.use"
    | "usage.read-technical",
  allowSuspendedOrganization = false,
): Promise<void> {
  const result = await executor.query(
    sql(
      `SELECT 1
       FROM memberships m
       JOIN principals p ON p.principal_id = m.principal_id
       JOIN organizations o ON o.organization_id = m.organization_id
       JOIN organization_roles role
         ON role.organization_id = m.organization_id
        AND role.role_key = m.role_key
       WHERE m.membership_id = $1
         AND m.principal_id = $2
         AND m.organization_id = $3
         AND m.lifecycle_status = 'active'
         AND p.lifecycle_status = 'active'
         AND o.lifecycle_status ${
           allowSuspendedOrganization
             ? "IN ('active', 'suspended')"
             : "= 'active'"
         }
         AND role.policy_version = 'authorization-v2'
         AND $4 = ANY(role.capabilities)`,
      [scope.membershipId, scope.principalId, scope.organizationId, permission],
    ),
  );
  if (result.rows.length !== 1) {
    fail("access-denied", "Access is not available.");
  }
}

async function requireActingPrincipalPermission(
  executor: SqlExecutor,
  context: TrustedCommercialReservationContext,
): Promise<void> {
  const result = await executor.query(
    sql(
      `SELECT 1
       FROM memberships membership
       JOIN principals principal
         ON principal.principal_id = membership.principal_id
       JOIN organizations organization
         ON organization.organization_id = membership.organization_id
       JOIN organization_roles role
         ON role.organization_id = membership.organization_id
        AND role.role_key = membership.role_key
       WHERE membership.organization_id = $1
         AND membership.principal_id = $2
         AND membership.lifecycle_status = 'active'
         AND principal.lifecycle_status = 'active'
         AND organization.lifecycle_status = 'active'
         AND role.policy_version = 'authorization-v2'
         AND 'commercial.expensive.use' = ANY(role.capabilities)`,
      [context.organizationId, context.actingPrincipalId],
    ),
  );
  if (result.rows.length !== 1) {
    fail("access-denied", "Access is not available.");
  }
}

async function lockBillingAccount(
  executor: SqlExecutor,
  organizationId: string,
): Promise<BillingAccountRow> {
  const result = await executor.query<BillingAccountRow>(
    sql(
      `SELECT billing_account_id, organization_id, lifecycle_status,
              expensive_operations_enabled, record_version
       FROM organization_billing_accounts
       WHERE organization_id = $1
       FOR UPDATE`,
      [organizationId],
    ),
  );
  const row = result.rows[0];
  if (row === undefined) {
    return fail("not-found", "The billing account is not available.");
  }
  return row;
}

function mapBillingAccount(
  row: BillingAccountRow,
): CommercialBillingAccountRecord {
  const lifecycleStatus = readString(row.lifecycle_status);
  if (!["active", "suspended", "closed"].includes(lifecycleStatus)) {
    return fail(
      "invalid-input",
      "The database returned invalid commercial data.",
    );
  }
  return {
    billingAccountId: readString(row.billing_account_id),
    expensiveOperationsEnabled: readBoolean(row.expensive_operations_enabled),
    lifecycleStatus:
      lifecycleStatus as CommercialBillingAccountRecord["lifecycleStatus"],
    organizationId: readString(row.organization_id),
    recordVersion: readDecimal(row.record_version),
  };
}

function mapProviderPricing(
  row: ProviderPricingRow,
): ProviderPricingVersionRecord {
  const cachedRate = readOptionalDecimal(
    row.cached_input_micros_per_million_tokens,
  );
  const effectiveUntil = readOptionalString(row.effective_until);
  return {
    ...(cachedRate === undefined
      ? {}
      : { cachedInputMicrosPerMillionTokens: cachedRate }),
    costCurrency: readString(row.cost_currency).trim(),
    createdAt: readString(row.created_at),
    creditConversionDenominator: readDecimal(row.credit_conversion_denominator),
    creditConversionNumerator: readDecimal(row.credit_conversion_numerator),
    effectiveFrom: readString(row.effective_from),
    ...(effectiveUntil === undefined ? {} : { effectiveUntil }),
    inputMicrosPerMillionTokens: readDecimal(
      row.input_micros_per_million_tokens,
    ),
    modelId: readString(row.model_key),
    modelVersion: readString(row.model_version),
    outputMicrosPerMillionTokens: readDecimal(
      row.output_micros_per_million_tokens,
    ),
    pricingVersionId: readString(row.pricing_version_id),
    providerKey: readString(row.provider_key),
  };
}

function mapSubscription(
  row: SubscriptionRow,
): CommercialSubscriptionProjectionRecord {
  const optional = {
    currentPeriodEnd: readOptionalTimestamp(row.current_period_end),
    currentPeriodId: readOptionalString(row.current_period_id),
    currentPeriodStart: readOptionalTimestamp(row.current_period_start),
    lastProviderEventReference: readOptionalString(
      row.last_provider_event_reference,
    ),
    providerEventPosition: readOptionalString(row.provider_event_position),
    providerPriceReference: readOptionalString(row.provider_price_reference),
    providerProductReference: readOptionalString(
      row.provider_product_reference,
    ),
  };
  return {
    billableSeatQuantity: readDecimal(row.billable_seat_quantity),
    billingAccountId: readString(row.billing_account_id),
    billingProvider: readString(row.billing_provider),
    ...(row["provider_environment"] === "live"
      ? { providerEnvironment: "live" as const }
      : {}),
    cancelAtPeriodEnd: readBoolean(row.cancel_at_period_end),
    ...(optional.currentPeriodEnd === undefined
      ? {}
      : { currentPeriodEnd: optional.currentPeriodEnd }),
    ...(optional.currentPeriodId === undefined
      ? {}
      : { currentPeriodId: optional.currentPeriodId }),
    ...(optional.currentPeriodStart === undefined
      ? {}
      : { currentPeriodStart: optional.currentPeriodStart }),
    effectiveAt: readTimestamp(row.effective_at),
    ...(optional.lastProviderEventReference === undefined
      ? {}
      : { lastProviderEventReference: optional.lastProviderEventReference }),
    normalizedStatus: readString(
      row.normalized_status,
    ) as CommercialSubscriptionProjectionRecord["normalizedStatus"],
    organizationId: readString(row.organization_id),
    planVersionId: readString(row.plan_version_id),
    providerCustomerReference: readString(row.provider_customer_reference),
    ...(optional.providerEventPosition === undefined
      ? {}
      : { providerEventPosition: optional.providerEventPosition }),
    ...(optional.providerPriceReference === undefined
      ? {}
      : { providerPriceReference: optional.providerPriceReference }),
    ...(optional.providerProductReference === undefined
      ? {}
      : { providerProductReference: optional.providerProductReference }),
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

function mapGrant(row: GrantRow): CreditGrantRecord {
  const expiresAt = readOptionalTimestamp(row.expires_at);
  const expirationPolicyKind = readString(row.expiration_policy_kind);
  const expirationPolicyVersion = readOptionalString(
    row.expiration_policy_version,
  );
  const planVersionId = readOptionalString(row.plan_version_id);
  const sourceReference = readOptionalString(row.source_reference);
  const subscriptionPeriodId = readOptionalString(row.subscription_period_id);
  const subscriptionPeriodStart = readOptionalTimestamp(
    row.subscription_period_start,
  );
  const subscriptionPeriodEnd = readOptionalTimestamp(
    row.subscription_period_end,
  );
  const expirationPolicy: CreditGrantRecord["expirationPolicy"] =
    expirationPolicyKind === "expires-at" &&
    expiresAt !== undefined &&
    expirationPolicyVersion !== undefined
      ? {
          expiresAt,
          kind: "expires-at",
          policyVersion: expirationPolicyVersion,
        }
      : expirationPolicyKind === "does-not-expire" &&
          expirationPolicyVersion !== undefined
        ? {
            kind: "does-not-expire",
            policyVersion: expirationPolicyVersion,
          }
        : expirationPolicyKind === "unresolved"
          ? { kind: "unresolved" }
          : fail(
              "invalid-input",
              "The database returned invalid commercial data.",
            );
  const subscriptionPeriod =
    subscriptionPeriodId !== undefined &&
    subscriptionPeriodStart !== undefined &&
    subscriptionPeriodEnd !== undefined
      ? {
          endsAt: subscriptionPeriodEnd,
          periodId: subscriptionPeriodId,
          startsAt: subscriptionPeriodStart,
        }
      : undefined;
  return {
    billingAccountId: readString(row.billing_account_id),
    consumptionPriority: readDecimal(row.consumption_priority),
    creditGrantId: readString(row.credit_grant_id),
    creditUnits: readDecimal(row.credit_units),
    expirationPolicy,
    grantKind: readString(row.grant_kind) as CreditGrantRecord["grantKind"],
    grantPolicyVersion: readString(row.grant_policy_version),
    organizationId: readString(row.organization_id),
    ...(planVersionId === undefined ? {} : { planVersionId }),
    ...(sourceReference === undefined ? {} : { sourceReference }),
    startsAt: readTimestamp(row.starts_at),
    ...(subscriptionPeriod === undefined ? {} : { subscriptionPeriod }),
  };
}

function mapAllocation(row: AllocationRow): CreditReservationAllocationRecord {
  return {
    allocationSequence: readDecimal(row.allocation_sequence),
    creditGrantId: readString(row.credit_grant_id),
    reservedCreditUnits: readDecimal(row.reserved_credit_units),
    settledCreditUnits: readDecimal(row.settled_credit_units),
  };
}

async function loadAllocations(
  executor: SqlExecutor,
  organizationId: string,
  reservationId: string,
): Promise<readonly CreditReservationAllocationRecord[]> {
  const result = await executor.query<AllocationRow>(
    sql(
      `SELECT a.credit_grant_id, a.allocation_sequence,
              a.reserved_credit_units, a.settled_credit_units
       FROM credit_reservation_allocations a
       WHERE a.organization_id = $1 AND a.reservation_id = $2
       ORDER BY a.allocation_sequence`,
      [organizationId, reservationId],
    ),
  );
  return result.rows.map(mapAllocation);
}

async function mapReservation(
  executor: SqlExecutor,
  row: ReservationRow,
): Promise<CreditReservationRecord> {
  const organizationId = readString(row.organization_id);
  const reservationId = readString(row.reservation_id);
  const terminalAt = readOptionalString(row.terminal_at);
  const terminalLedgerEntryId = readOptionalString(
    row.terminal_ledger_entry_id,
  );
  return {
    actingPrincipalId: readString(row.acting_principal_id),
    allocations: await loadAllocations(executor, organizationId, reservationId),
    billingAccountId: readString(row.billing_account_id),
    chargingPolicyVersion: readString(row.charging_policy_version),
    createdAt: readString(row.created_at),
    entitlementPolicyVersion: readString(row.entitlement_policy_version),
    entitlementSnapshotId: readString(row.entitlement_snapshot_id),
    expiresAt: readString(row.expires_at),
    featureKey: readString(row.feature_key),
    jobId: readString(row.job_id),
    modelId: readString(row.model_key),
    modelVersion: readString(row.model_version),
    organizationId,
    planVersionId: readString(row.plan_version_id),
    pricingVersionId: readString(row.pricing_version_id),
    projectId: readString(row.project_id),
    providerKey: readString(row.provider_key),
    recordVersion: readDecimal(row.record_version),
    requestId: readString(row.request_id),
    requestedCreditUnits: readDecimal(row.requested_credit_units),
    reservationId,
    reservedCreditUnits: readDecimal(row.reserved_credit_units),
    status: readString(row.status) as CreditReservationRecord["status"],
    ...(terminalAt === undefined ? {} : { terminalAt }),
    ...(terminalLedgerEntryId === undefined ? {} : { terminalLedgerEntryId }),
  };
}

function mapUsage(row: UsageRow): UsageLedgerEntryRecord {
  const entryKind = readString(
    row.entry_kind,
  ) as UsageLedgerEntryRecord["entryKind"];

  const optional = {
    actingPrincipalId: readOptionalString(row.acting_principal_id),
    cachedInputTokenCount: readOptionalDecimal(row.cached_input_token_count),
    chargingScenario: readOptionalString(row.charging_scenario),
    creditGrantId: readOptionalString(row.credit_grant_id),
    entitlementPolicyVersion: readOptionalString(
      row.entitlement_policy_version,
    ),
    estimatedProviderCostMicros: readOptionalDecimal(
      row.estimated_provider_cost_micros,
    ),
    featureKey: readOptionalString(row.feature_key),
    inputTokenCount: readOptionalDecimal(row.input_token_count),
    jobId: readOptionalString(row.job_id),
    latencyMilliseconds: readOptionalDecimal(row.latency_milliseconds),
    normalizedCreditUnits: readOptionalDecimal(row.normalized_credit_units),
    outputTokenCount: readOptionalDecimal(row.output_token_count),
    planVersionId: readOptionalString(row.plan_version_id),
    pricingVersionId: readOptionalString(row.pricing_version_id),
    projectId: readOptionalString(row.project_id),
    providerCostCurrency: readOptionalString(row.provider_cost_currency),
    modelId: readOptionalString(row.model_key),
    modelVersion: readOptionalString(row.model_version),
    providerKey: readOptionalString(row.provider_key),
    providerRequestId: readOptionalString(row.provider_request_id),
    reasonCode: readString(row.reason_code),
    relatedLedgerEntryId: readOptionalString(row.related_ledger_entry_id),
    requestId: readOptionalString(row.request_id),
    reservationId: readOptionalString(row.reservation_id),
    safeReason: readOptionalString(row.safe_reason),
  };
  return {
    ...(optional.actingPrincipalId === undefined
      ? {}
      : { actingPrincipalId: optional.actingPrincipalId }),
    chargingPolicyVersion: readString(row.charging_policy_version),
    ...(optional.cachedInputTokenCount === undefined
      ? {}
      : { cachedInputTokenCount: readDecimal(optional.cachedInputTokenCount) }),
    chargingScenario:
      optional.chargingScenario === undefined
        ? null
        : (optional.chargingScenario as
            ChargingScenario | "beta-ai-output-delivered-v1"),
    creditAdjustmentUnits: readDecimal(row.credit_adjustment_units),
    ...(entryKind === "grant" && optional.creditGrantId !== undefined
      ? { creditGrantId: optional.creditGrantId }
      : {}),
    entryKind,
    ...(optional.entitlementPolicyVersion === undefined
      ? {}
      : { entitlementPolicyVersion: optional.entitlementPolicyVersion }),
    ...(optional.estimatedProviderCostMicros === undefined
      ? {}
      : {
          estimatedProviderCostMicros: readDecimal(
            optional.estimatedProviderCostMicros,
          ),
        }),
    expiredCreditUnits: readDecimal(row.expired_credit_units),
    ...(optional.featureKey === undefined
      ? {}
      : { featureKey: optional.featureKey }),
    grantedCreditUnits: readDecimal(row.granted_credit_units),
    idempotencyKeySha256: readString(row.idempotency_key_sha256),
    ...(optional.inputTokenCount === undefined
      ? {}
      : { inputTokenCount: readDecimal(optional.inputTokenCount) }),
    ...(optional.jobId === undefined ? {} : { jobId: optional.jobId }),
    ...(optional.modelId === undefined ? {} : { modelId: optional.modelId }),
    ...(optional.modelVersion === undefined
      ? {}
      : { modelVersion: optional.modelVersion }),
    ...(optional.normalizedCreditUnits === undefined
      ? {}
      : { normalizedCreditUnits: optional.normalizedCreditUnits }),
    ledgerEntryId: readString(row.ledger_entry_id),
    ...(optional.latencyMilliseconds === undefined
      ? {}
      : { latencyMilliseconds: readDecimal(optional.latencyMilliseconds) }),
    occurredAt: readString(row.occurred_at),
    organizationId: readString(row.organization_id),
    outcome: readString(row.outcome) as UsageLedgerEntryRecord["outcome"],
    ...(optional.outputTokenCount === undefined
      ? {}
      : { outputTokenCount: readDecimal(optional.outputTokenCount) }),
    ...(optional.planVersionId === undefined
      ? {}
      : { planVersionId: optional.planVersionId }),
    ...(optional.pricingVersionId === undefined
      ? {}
      : { pricingVersionId: optional.pricingVersionId }),
    ...(optional.projectId === undefined
      ? {}
      : { projectId: optional.projectId }),
    ...(optional.providerCostCurrency === undefined
      ? {}
      : { providerCostCurrency: optional.providerCostCurrency }),
    reasonCode: optional.reasonCode,
    ...(optional.safeReason === undefined
      ? {}
      : { safeReason: optional.safeReason }),
    recordedByActorId: readString(row.recorded_by_actor_id),
    ...(optional.providerKey === undefined
      ? {}
      : { providerKey: optional.providerKey }),
    ...(optional.providerRequestId === undefined
      ? {}
      : { providerRequestId: optional.providerRequestId }),
    recordedByActorKind: readString(
      row.recorded_by_actor_kind,
    ) as UsageLedgerEntryRecord["recordedByActorKind"],
    ...(optional.relatedLedgerEntryId === undefined
      ? {}
      : { relatedLedgerEntryId: optional.relatedLedgerEntryId }),
    releasedCreditUnits: readDecimal(row.released_credit_units),
    ...(optional.requestId === undefined
      ? {}
      : { requestId: optional.requestId }),
    ...(optional.reservationId === undefined
      ? {}
      : { reservationId: optional.reservationId }),
    reservedCreditUnits: readDecimal(row.reserved_credit_units),
    settledCreditUnits: readDecimal(row.settled_credit_units),
  };
}
async function loadUsageAllocations(
  executor: SqlExecutor,
  organizationId: string,
  ledgerEntryId: string,
): Promise<readonly UsageLedgerAllocationRecord[]> {
  const result = await executor.query<UsageAllocationRow>(
    sql(
      `SELECT allocation_sequence, credit_grant_id,
              credit_adjustment_units, reserved_credit_units,
              settled_credit_units, released_credit_units,
              expired_credit_units
       FROM usage_ledger_entry_allocations
       WHERE organization_id = $1 AND ledger_entry_id = $2
       ORDER BY allocation_sequence`,
      [organizationId, ledgerEntryId],
    ),
  );
  return result.rows.map((row) => ({
    allocationSequence: readDecimal(row.allocation_sequence),
    creditAdjustmentUnits: readDecimal(row.credit_adjustment_units),
    creditGrantId: readString(row.credit_grant_id),
    expiredCreditUnits: readDecimal(row.expired_credit_units),
    releasedCreditUnits: readDecimal(row.released_credit_units),
    reservedCreditUnits: readDecimal(row.reserved_credit_units),
    settledCreditUnits: readDecimal(row.settled_credit_units),
  }));
}

function assertModelIdentifier(value: string): void {
  if (!modelIdentifierPattern.test(value)) {
    fail("invalid-input", "The model identity is invalid.");
  }
}

function assertMetrics(
  metrics: ProviderUsageMetricsInput,
  requireProviderEvidence = false,
  modelPricing = false,
): void {
  for (const value of [
    metrics.cachedInputTokenCount,
    metrics.estimatedProviderCostMicros,
    metrics.inputTokenCount,
    metrics.latencyMilliseconds,
    metrics.outputTokenCount,
  ]) {
    if (value !== undefined) {
      unsignedInteger(value);
    }
  }
  if (
    (metrics.estimatedProviderCostMicros === undefined) !==
    (metrics.providerCostCurrency === undefined)
  ) {
    fail("invalid-input", "Provider cost metadata is incomplete.");
  }
  if (
    metrics.providerCostCurrency !== undefined &&
    !/^[A-Z]{3}$/.test(metrics.providerCostCurrency)
  ) {
    fail("invalid-input", "Provider cost metadata is invalid.");
  }
  if (metrics.providerRequestId !== undefined) {
    assertBounded(metrics.providerRequestId, 128);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(metrics.providerRequestId)
    ) {
      fail("invalid-input", "The provider request identity is invalid.");
    }
  }
  const providerEvidence = [
    metrics.modelId,
    metrics.modelVersion,
    metrics.providerKey,
  ];
  if (
    providerEvidence.some((value) => value === undefined) &&
    providerEvidence.some((value) => value !== undefined)
  ) {
    fail("invalid-input", "Provider usage evidence is incomplete.");
  }
  if (requireProviderEvidence && providerEvidence[0] === undefined) {
    fail(
      "invalid-input",
      "Provider usage evidence is required for settlement.",
    );
  }
  if (
    metrics.modelId !== undefined &&
    metrics.modelVersion !== undefined &&
    metrics.providerKey !== undefined
  ) {
    assertModelIdentifier(metrics.modelId);
    assertModelIdentifier(metrics.modelVersion);
    if (
      !(modelPricing ? modelProviderKeyPattern : providerKeyPattern).test(
        metrics.providerKey,
      )
    ) {
      fail("invalid-input", "Provider usage evidence is invalid.");
    }
  }
}

async function selectReservationForUpdate(
  executor: SqlExecutor,
  organizationId: string,
  reservationId: string,
): Promise<ReservationRow> {
  const result = await executor.query<ReservationRow>(
    sql(
      `${reservationSelect}
       WHERE organization_id = $1 AND reservation_id = $2
       FOR UPDATE`,
      [organizationId, reservationId],
    ),
  );
  const row = result.rows[0];
  if (row === undefined) {
    return fail("not-found", "The credit reservation is not available.");
  }
  return row;
}

async function currentCreditRow(
  executor: SqlExecutor,
  organizationId: string,
  requireMembership?: AuthorizedOrganizationScope,
): Promise<SqlRow> {
  const membershipJoin =
    requireMembership === undefined
      ? ""
      : `JOIN memberships m ON m.organization_id = a.organization_id
         JOIN principals p ON p.principal_id = m.principal_id
         JOIN organizations o ON o.organization_id = m.organization_id
         JOIN organization_roles role
           ON role.organization_id = m.organization_id
          AND role.role_key = m.role_key`;
  const membershipWhere =
    requireMembership === undefined
      ? ""
      : `AND m.membership_id = $2 AND m.principal_id = $3
         AND m.lifecycle_status = 'active'
         AND p.lifecycle_status = 'active'
         AND o.lifecycle_status IN ('active', 'suspended')
         AND role.policy_version = 'authorization-v2'
         AND 'commercial.summary.read' = ANY(role.capabilities)`;
  const values =
    requireMembership === undefined
      ? [organizationId]
      : [
          organizationId,
          requireMembership.membershipId,
          requireMembership.principalId,
        ];
  const result = await executor.query<
    SqlRow & {
      readonly active_granted: unknown;
      readonly compensated: unknown;
      readonly debit_adjustments: unknown;
      readonly net_adjustments: unknown;
      readonly as_of: unknown;
      readonly available: unknown;
      readonly eligible_organization_id: unknown;
      readonly expired: unknown;
      readonly ledger_through_event_id: unknown;
      readonly reserved: unknown;
      readonly settled: unknown;
      readonly total_granted: unknown;
      readonly unresolved: unknown;
    }
  >(
    sql(
      `WITH eligible_account AS (
         SELECT a.organization_id
         FROM organization_billing_accounts a
         ${membershipJoin}
         WHERE a.organization_id = $1 ${membershipWhere}
       ),
       event_effects AS (
         SELECT allocation.credit_grant_id,
                COALESCE(SUM(CASE WHEN allocation.credit_adjustment_units > 0
                  THEN allocation.credit_adjustment_units ELSE 0 END), 0)
                  AS compensated,
                COALESCE(SUM(CASE WHEN allocation.credit_adjustment_units < 0
                  THEN -allocation.credit_adjustment_units ELSE 0 END), 0)
                  AS debit_adjustments,
                COALESCE(SUM(allocation.credit_adjustment_units), 0)
                  AS net_adjustments,
                COALESCE(SUM(allocation.settled_credit_units), 0) AS settled
         FROM usage_ledger_entry_allocations allocation
         JOIN eligible_account account
           ON account.organization_id = allocation.organization_id
         GROUP BY allocation.credit_grant_id
       ),
       active_reservations AS (
         SELECT allocation.credit_grant_id,
                COALESCE(SUM(allocation.reserved_credit_units), 0) AS reserved
         FROM credit_reservation_allocations allocation
         JOIN credit_reservations reservation
           ON reservation.organization_id = allocation.organization_id
          AND reservation.reservation_id = allocation.reservation_id
         JOIN eligible_account account
           ON account.organization_id = allocation.organization_id
         WHERE reservation.status = 'active'
         GROUP BY allocation.credit_grant_id
       ),
       grant_effects AS (
         SELECT grant_row.credit_grant_id, grant_row.credit_units,
                grant_row.expiration_policy_kind, grant_row.expires_at,
                ((grant_row.grant_policy_version <> 'cloudmarkup-staff-trial-v1' AND (grant_row.grant_policy_version='cloudmarkup-staff-credits-v1' OR NOT EXISTS(SELECT 1 FROM organization_entitlement_snapshots trial_snapshot WHERE trial_snapshot.organization_id=grant_row.organization_id AND trial_snapshot.plan_version_id='planver_staff_trial_2026_10_06_v1')))
                OR (grant_row.grant_policy_version='cloudmarkup-staff-trial-v1' AND grant_row.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM organization_entitlement_snapshots trial_snapshot WHERE trial_snapshot.organization_id=grant_row.organization_id AND trial_snapshot.plan_version_id='planver_staff_trial_2026_10_06_v1' AND trial_snapshot.subscription_projection_id IS NULL AND trial_snapshot.expensive_operations_enabled AND trial_snapshot.effective_at<=clock_timestamp()))) AS grant_admitted,
                grant_row.grant_kind,
                COALESCE(event_effects.compensated, 0) AS compensated,
                COALESCE(event_effects.debit_adjustments, 0)
                  AS debit_adjustments,
                COALESCE(event_effects.net_adjustments, 0) AS net_adjustments,
                COALESCE(event_effects.settled, 0) AS settled,
                COALESCE(active_reservations.reserved, 0) AS reserved,
                (CASE WHEN grant_row.grant_kind = 'administrative'
                  THEN 0 ELSE grant_row.credit_units END
                  + COALESCE(event_effects.net_adjustments, 0)) AS funding
         FROM credit_grants grant_row
         JOIN eligible_account account
           ON account.organization_id = grant_row.organization_id
         LEFT JOIN event_effects
           ON event_effects.credit_grant_id = grant_row.credit_grant_id
         LEFT JOIN active_reservations
           ON active_reservations.credit_grant_id = grant_row.credit_grant_id
         WHERE grant_row.starts_at <= CURRENT_TIMESTAMP
       ), available_grants AS (
         SELECT grant_effects.*, CASE
           WHEN grant_admitted AND expiration_policy_kind <> 'unresolved'
            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
           THEN GREATEST(funding - settled - reserved, 0)
           ELSE 0 END AS available_units
         FROM grant_effects
       ), next_expiration AS (
         SELECT MIN(expires_at) AS expires_at FROM available_grants
         WHERE available_units > 0 AND expires_at > CURRENT_TIMESTAMP
       )
       SELECT MAX(account.organization_id) AS eligible_organization_id,
              to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS as_of,
              (SELECT ledger_entry_id FROM usage_ledger_entries event
               WHERE event.organization_id = $1
               ORDER BY event.occurred_at DESC, event.ledger_entry_id DESC
               LIMIT 1) AS ledger_through_event_id,
              COALESCE(SUM(CASE
                WHEN grant_row.grant_kind <> 'administrative'
                 AND grant_row.grant_admitted AND grant_row.expiration_policy_kind <> 'unresolved'
                 AND (grant_row.expires_at IS NULL
                   OR grant_row.expires_at > CURRENT_TIMESTAMP)
                  THEN grant_row.credit_units
                ELSE 0 END), 0) AS active_granted,
              COALESCE(SUM(CASE
                WHEN grant_row.grant_kind <> 'administrative'
                  THEN grant_row.credit_units ELSE 0 END), 0) AS total_granted,
              COALESCE(SUM(grant_row.compensated), 0) AS compensated,
              COALESCE(SUM(grant_row.debit_adjustments), 0) AS debit_adjustments,
              COALESCE(SUM(grant_row.net_adjustments), 0) AS net_adjustments,
              COALESCE(SUM(grant_row.settled), 0) AS settled,
              COALESCE(SUM(grant_row.reserved), 0) AS reserved,
              COALESCE(SUM(grant_row.available_units), 0) AS available,
              COALESCE(SUM(grant_row.available_units) FILTER (WHERE grant_row.grant_kind = 'monthly'), 0) AS monthly_available,
              COALESCE(SUM(grant_row.available_units) FILTER (WHERE grant_row.grant_kind = 'purchased'), 0) AS purchased_available,
              COALESCE(SUM(grant_row.available_units) FILTER (WHERE grant_row.grant_kind NOT IN ('monthly', 'purchased')), 0) AS other_available,
              (SELECT to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM next_expiration) AS next_expiration_at,
              COALESCE(SUM(grant_row.available_units) FILTER (WHERE grant_row.expires_at = (SELECT expires_at FROM next_expiration)), 0) AS next_expiration_units,
              COALESCE(SUM(CASE
                WHEN grant_row.expiration_policy_kind <> 'unresolved'
                 AND grant_row.expires_at <= CURRENT_TIMESTAMP
                  THEN GREATEST(
                    grant_row.funding - grant_row.settled - grant_row.reserved, 0
                  ) ELSE 0 END), 0) AS expired,
              COALESCE(SUM(CASE
                WHEN grant_row.expiration_policy_kind = 'unresolved'
                  THEN GREATEST(
                    grant_row.funding - grant_row.settled - grant_row.reserved, 0
                  ) ELSE 0 END), 0) AS unresolved
       FROM eligible_account account
       LEFT JOIN available_grants grant_row ON TRUE`,
      values,
    ),
  );
  const row = result.rows[0];
  if (
    row === undefined ||
    readOptionalString(row.eligible_organization_id) !== organizationId
  ) {
    return fail("access-denied", "Access is not available.");
  }
  return row;
}

function mapCreditBalanceRow(
  row: SqlRow,
  organizationId: string,
): CreditBalanceRecord {
  const availableCreditUnits = readDecimal(row["available"]);
  const ledgerThroughEventId = readOptionalString(
    row["ledger_through_event_id"],
  );
  return {
    asOf: readString(row["as_of"]),
    activeGrantedCreditUnits: readDecimal(row["active_granted"]),
    availableCreditUnits,
    compensatedCreditUnits: readDecimal(row["compensated"]),
    debitAdjustmentCreditUnits: readDecimal(row["debit_adjustments"]),
    netAdjustmentCreditUnits: readDecimal(row["net_adjustments"]),
    exhausted: availableCreditUnits === "0",
    expiredCreditUnits: readDecimal(row["expired"]),
    ...(ledgerThroughEventId === undefined ? {} : { ledgerThroughEventId }),
    organizationId,
    reservedCreditUnits: readDecimal(row["reserved"]),
    settledCreditUnits: readDecimal(row["settled"]),
    totalGrantedCreditUnits: readDecimal(row["total_granted"]),
    unresolvedCreditUnits: readDecimal(row["unresolved"]),
  };
}

async function currentBalance(
  executor: SqlExecutor,
  organizationId: string,
  requireMembership?: AuthorizedOrganizationScope,
): Promise<CreditBalanceRecord> {
  return mapCreditBalanceRow(
    await currentCreditRow(executor, organizationId, requireMembership),
    organizationId,
  );
}

/** Internal read-only seam for the authenticated model host. Reuses canonical
 * allocation/grant arithmetic without treating summary-read as expensive-use
 * authority. The enclosing host transaction owns current session/project/lease
 * checks; this seam independently rechecks the exact membership permission. */
export async function readModelCreditBalanceInTransaction(
  transaction: SqlExecutor,
  scope: AuthorizedOrganizationScope,
): Promise<CreditBalanceRecord> {
  assertHumanScope(scope);
  requireScopePermission(scope, "commercial.expensive.use");
  await requireHumanScope(transaction, scope, "commercial.expensive.use");
  return currentBalance(transaction, scope.organizationId);
}

/** Internal staff seam; callers hold staff and session authorization in this transaction. */
export async function readStaffCreditBalanceInTransaction(
  transaction: SqlExecutor,
  context: TrustedCommercialAdministrationContext,
): Promise<CreditBalanceRecord> {
  assertAdministrationContext(context);
  return currentBalance(transaction, context.organizationId);
}

export class PostgresCommercialPersistenceRepository implements CommercialPersistenceRepository {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async createBillingAccount(
    context: TrustedCommercialAdministrationContext,
    input: CreateCommercialBillingAccountInput,
  ): Promise<CommercialBillingAccountRecord> {
    assertAdministrationContext(context);
    assertIdentifier(input.billingAccountId);
    return this.#database.transaction(async (transaction) => {
      const organization = await transaction.query(
        sql(
          `SELECT 1 FROM organizations
           WHERE organization_id = $1
             AND lifecycle_status IN ('active', 'suspended')
           FOR UPDATE`,
          [context.organizationId],
        ),
      );
      if (organization.rows.length !== 1) {
        return fail("not-found", "The organization is not available.");
      }
      await transaction.query(
        sql(
          `INSERT INTO organization_billing_accounts (
             billing_account_id, organization_id
           ) VALUES ($1, $2)
           ON CONFLICT (organization_id) DO NOTHING`,
          [input.billingAccountId, context.organizationId],
        ),
      );
      const result = await transaction.query<BillingAccountRow>(
        sql(
          `SELECT billing_account_id, organization_id, lifecycle_status,
                  expensive_operations_enabled, record_version
           FROM organization_billing_accounts
           WHERE organization_id = $1`,
          [context.organizationId],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        return fail("not-found", "The billing account is not available.");
      }
      if (readString(row.billing_account_id) !== input.billingAccountId) {
        return fail(
          "idempotency-conflict",
          "The organization already has a different billing account.",
        );
      }
      return mapBillingAccount(row);
    });
  }

  async updateBillingAccount(
    context: TrustedCommercialAdministrationContext,
    input: UpdateCommercialBillingAccountInput,
  ): Promise<CommercialBillingAccountRecord> {
    assertAdministrationContext(context);
    const expectedVersion = unsignedInteger(input.expectedRecordVersion, true);
    if (
      input.lifecycleStatus !== "active" &&
      input.expensiveOperationsEnabled
    ) {
      return fail(
        "invalid-input",
        "Suspended and closed billing accounts cannot enable expensive operations.",
      );
    }
    return this.#database.transaction(async (transaction) => {
      const current = await lockBillingAccount(
        transaction,
        context.organizationId,
      );
      if (readInteger(current.record_version) !== expectedVersion) {
        return fail(
          "version-conflict",
          "The billing account changed before the update completed.",
        );
      }
      if (readString(current.lifecycle_status) === "closed") {
        return fail(
          "version-conflict",
          "A closed billing account cannot be changed.",
        );
      }
      const result = await transaction.query<BillingAccountRow>(
        sql(
          `UPDATE organization_billing_accounts
           SET lifecycle_status = $1,
               expensive_operations_enabled = $2,
               record_version = record_version + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $3 AND record_version = $4
             AND lifecycle_status <> 'closed'
           RETURNING billing_account_id, organization_id, lifecycle_status,
                     expensive_operations_enabled, record_version`,
          [
            input.lifecycleStatus,
            input.expensiveOperationsEnabled,
            context.organizationId,
            expectedVersion,
          ],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        return fail(
          "version-conflict",
          "The billing account changed before the update completed.",
        );
      }
      return mapBillingAccount(row);
    });
  }

  async createProviderPricingVersion(
    context: TrustedCommercialAdministrationContext,
    input: ProviderPricingVersionInput,
  ): Promise<ProviderPricingVersionRecord> {
    assertAdministrationContext(context);
    assertIdentifier(input.pricingVersionId);
    if (!providerKeyPattern.test(input.providerKey)) {
      return fail("invalid-input", "The model provider key is invalid.");
    }
    assertModelIdentifier(input.modelId);
    assertModelIdentifier(input.modelVersion);
    assertTimestamp(input.effectiveFrom);
    if (input.effectiveUntil !== undefined) {
      assertTimestamp(input.effectiveUntil);
      if (Date.parse(input.effectiveUntil) <= Date.parse(input.effectiveFrom)) {
        return fail("invalid-input", "The pricing window is invalid.");
      }
    }
    if (!/^[A-Z]{3}$/.test(input.costCurrency)) {
      return fail("invalid-input", "The provider cost currency is invalid.");
    }
    const inputRate = unsignedInteger(input.inputMicrosPerMillionTokens);
    const outputRate = unsignedInteger(input.outputMicrosPerMillionTokens);
    const cachedRate =
      input.cachedInputMicrosPerMillionTokens === undefined
        ? undefined
        : unsignedInteger(input.cachedInputMicrosPerMillionTokens);
    const numerator = unsignedInteger(input.creditConversionNumerator, true);
    const denominator = unsignedInteger(
      input.creditConversionDenominator,
      true,
    );
    const pricingIdentity = createHash("sha256")
      .update(
        [
          "commercial-pricing-window-v1",
          input.providerKey,
          input.modelId,
          input.modelVersion,
        ].join("\u0000"),
      )
      .digest("hex");

    return this.#database.transaction(async (transaction) => {
      await transaction.query(
        sql(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          pricingIdentity,
        ]),
      );
      const existing = await transaction.query<ProviderPricingRow>(
        sql(
          `SELECT pricing_version_id, provider_key, model_key, model_version,
                  effective_from, effective_until, cost_currency,
                  input_micros_per_million_tokens,
                  output_micros_per_million_tokens,
                  cached_input_micros_per_million_tokens,
                  credit_conversion_numerator,
                  credit_conversion_denominator, created_at
           FROM provider_pricing_versions
           WHERE pricing_version_id = $1
           FOR UPDATE`,
          [input.pricingVersionId],
        ),
      );
      const replay = existing.rows[0];
      if (replay !== undefined) {
        const mapped = mapProviderPricing(replay);
        if (
          mapped.providerKey !== input.providerKey ||
          mapped.modelId !== input.modelId ||
          mapped.modelVersion !== input.modelVersion ||
          Date.parse(mapped.effectiveFrom) !==
            Date.parse(input.effectiveFrom) ||
          (mapped.effectiveUntil === undefined) !==
            (input.effectiveUntil === undefined) ||
          (mapped.effectiveUntil !== undefined &&
            input.effectiveUntil !== undefined &&
            Date.parse(mapped.effectiveUntil) !==
              Date.parse(input.effectiveUntil)) ||
          mapped.costCurrency !== input.costCurrency ||
          mapped.inputMicrosPerMillionTokens !== inputRate.toString() ||
          mapped.outputMicrosPerMillionTokens !== outputRate.toString() ||
          mapped.cachedInputMicrosPerMillionTokens !== cachedRate?.toString() ||
          mapped.creditConversionNumerator !== numerator.toString() ||
          mapped.creditConversionDenominator !== denominator.toString()
        ) {
          return fail(
            "idempotency-conflict",
            "The pricing version identity was reused.",
          );
        }
        return mapped;
      }
      const tupleVersions = await transaction.query<
        SqlRow & {
          readonly effective_from: unknown;
          readonly effective_until: unknown;
          readonly pricing_version_id: unknown;
        }
      >(
        sql(
          `SELECT pricing_version_id, effective_from, effective_until
           FROM provider_pricing_versions
           WHERE provider_key = $1 AND model_key = $2 AND model_version = $3
           ORDER BY effective_from DESC, pricing_version_id DESC
           FOR UPDATE`,
          [input.providerKey, input.modelId, input.modelVersion],
        ),
      );
      if (tupleVersions.rows.length > 0) {
        const boundary = await transaction.query<
          SqlRow & { readonly is_current_or_future: unknown }
        >(
          sql(
            `SELECT $1::timestamptz >= CURRENT_TIMESTAMP
                    AS is_current_or_future`,
            [input.effectiveFrom],
          ),
        );
        if (!readBoolean(boundary.rows[0]?.is_current_or_future)) {
          return fail(
            "invalid-input",
            "A successor pricing boundary cannot reinterpret historical usage.",
          );
        }
      }
      const openPredecessor = tupleVersions.rows.find(
        (row) => readOptionalString(row.effective_until) === undefined,
      );
      if (openPredecessor !== undefined) {
        if (
          Date.parse(input.effectiveFrom) <=
          Date.parse(readString(openPredecessor.effective_from))
        ) {
          return fail(
            "idempotency-conflict",
            "The provider pricing window overlaps.",
          );
        }
        const closed = await transaction.query(
          sql(
            `UPDATE provider_pricing_versions
             SET effective_until = $1
             WHERE pricing_version_id = $2
               AND provider_key = $3 AND model_key = $4 AND model_version = $5
               AND effective_until IS NULL`,
            [
              input.effectiveFrom,
              readString(openPredecessor.pricing_version_id),
              input.providerKey,
              input.modelId,
              input.modelVersion,
            ],
          ),
        );
        if (closed.rowCount !== 1) {
          return fail(
            "version-conflict",
            "The provider pricing window changed.",
          );
        }
      }
      const overlap = await transaction.query(
        sql(
          `SELECT 1
           FROM provider_pricing_versions
           WHERE provider_key = $1 AND model_key = $2 AND model_version = $3
             AND tstzrange(effective_from, effective_until, '[)') &&
                 tstzrange($4::timestamptz, $5::timestamptz, '[)')
           LIMIT 1
           FOR UPDATE`,
          [
            input.providerKey,
            input.modelId,
            input.modelVersion,
            input.effectiveFrom,
            input.effectiveUntil ?? null,
          ],
        ),
      );
      if (overlap.rows.length !== 0) {
        return fail(
          "idempotency-conflict",
          "The provider pricing window overlaps.",
        );
      }
      const created = await transaction.query<ProviderPricingRow>(
        sql(
          `INSERT INTO provider_pricing_versions (
             pricing_version_id, provider_key, model_key, model_version,
             effective_from, effective_until, cost_currency,
             input_micros_per_million_tokens,
             output_micros_per_million_tokens,
             cached_input_micros_per_million_tokens,
             credit_conversion_numerator, credit_conversion_denominator
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING pricing_version_id, provider_key, model_key, model_version,
                     effective_from, effective_until, cost_currency,
                     input_micros_per_million_tokens,
                     output_micros_per_million_tokens,
                     cached_input_micros_per_million_tokens,
                     credit_conversion_numerator,
                     credit_conversion_denominator, created_at`,
          [
            input.pricingVersionId,
            input.providerKey,
            input.modelId,
            input.modelVersion,
            input.effectiveFrom,
            input.effectiveUntil ?? null,
            input.costCurrency,
            inputRate,
            outputRate,
            cachedRate ?? null,
            numerator,
            denominator,
          ],
        ),
      );
      const row = created.rows[0];
      return row === undefined
        ? fail(
            "not-found",
            "The provider pricing version could not be created.",
          )
        : mapProviderPricing(row);
    });
  }

  async getProviderPricingVersion(
    context: TrustedCommercialAdministrationContext,
    pricingVersionId: string,
  ): Promise<ProviderPricingVersionRecord | null> {
    assertAdministrationContext(context);
    assertIdentifier(pricingVersionId);
    const result = await this.#database.query<ProviderPricingRow>(
      sql(
        `SELECT pricing_version_id, provider_key, model_key, model_version,
                effective_from, effective_until, cost_currency,
                input_micros_per_million_tokens,
                output_micros_per_million_tokens,
                cached_input_micros_per_million_tokens,
                credit_conversion_numerator,
                credit_conversion_denominator, created_at
         FROM provider_pricing_versions
         WHERE pricing_version_id = $1`,
        [pricingVersionId],
      ),
    );
    return result.rows[0] === undefined
      ? null
      : mapProviderPricing(result.rows[0]);
  }

  async updateSubscriptionProjection(
    context: TrustedCommercialMutationContext,
    input: CommercialSubscriptionProjectionInput,
  ): Promise<CommercialSubscriptionProjectionRecord> {
    assertMutationContext(context);
    assertIdentifier(input.subscriptionProjectionId);
    assertIdentifier(input.planVersionId);
    if (!providerKeyPattern.test(input.billingProvider)) {
      return fail("invalid-input", "The billing provider is invalid.");
    }
    assertBounded(input.providerCustomerReference, 255);
    assertBounded(input.providerSubscriptionReference, 255);
    assertTimestamp(input.effectiveAt);
    const expectedVersion = unsignedInteger(input.expectedRecordVersion);
    const seats = unsignedInteger(input.billableSeatQuantity);
    const periodValues = [
      input.currentPeriodId,
      input.currentPeriodStart,
      input.currentPeriodEnd,
    ];
    if (
      periodValues.some((value) => value === undefined) &&
      periodValues.some((value) => value !== undefined)
    ) {
      return fail("invalid-input", "The subscription period is incomplete.");
    }
    if (
      input.currentPeriodId !== undefined &&
      input.currentPeriodStart !== undefined &&
      input.currentPeriodEnd !== undefined
    ) {
      assertIdentifier(input.currentPeriodId);
      assertTimestamp(input.currentPeriodStart);
      assertTimestamp(input.currentPeriodEnd);
      if (
        Date.parse(input.currentPeriodEnd) <=
        Date.parse(input.currentPeriodStart)
      ) {
        return fail(
          "invalid-input",
          "The subscription period bounds are invalid.",
        );
      }
    }

    return this.#database.transaction(async (transaction) => {
      const account = await lockBillingAccount(
        transaction,
        context.organizationId,
      );
      const planResult = await transaction.query<
        SqlRow & {
          readonly included_billable_seats: unknown;
          readonly maximum_billable_seats: unknown;
          readonly configuration_version: unknown;
          readonly additional_seat_enabled: unknown;
        }
      >(
        sql(
          `SELECT seats.included_billable_seats, seats.maximum_billable_seats,
                  version.configuration_version, seats.additional_seat_enabled
           FROM commercial_plan_versions version
           JOIN commercial_plan_seat_rules seats
             ON seats.plan_version_id = version.plan_version_id
           WHERE version.plan_version_id = $1
             AND version.configuration_status = 'proposed-beta-example'
             AND version.effective_from <= $2::timestamptz
             AND (version.effective_until IS NULL
               OR version.effective_until > $2::timestamptz)
           FOR SHARE`,
          [input.planVersionId, input.effectiveAt],
        ),
      );
      const plan = planResult.rows[0];
      if (plan === undefined) {
        return fail("invalid-input", "The subscription plan is not effective.");
      }
      const includedSeats = readInteger(plan.included_billable_seats);
      const maximumSeats = readInteger(plan.maximum_billable_seats);
      const sharingMembers = includedMembersForSharingPlanV1(
        input.planVersionId,
      );
      const invalidQuantity =
        sharingMembers === null
          ? seats < includedSeats || seats > maximumSeats
          : seats !== 1n ||
            includedSeats !== BigInt(sharingMembers) ||
            maximumSeats !== BigInt(sharingMembers) ||
            plan.configuration_version !==
              sharingPlanConfigurationVersionV1(input.planVersionId) ||
            plan.additional_seat_enabled !== false;
      // Fixed organization quantity is not the number of included human members.
      if (invalidQuantity) {
        return fail(
          "invalid-input",
          "The subscription seat quantity is outside the plan bounds.",
        );
      }
      let result;
      if (expectedVersion === 0n) {
        result = await transaction.query<SubscriptionRow>(
          sql(
            `INSERT INTO organization_subscription_projections (
               subscription_projection_id, organization_id,
               billing_account_id, billing_provider,
               provider_customer_reference, provider_subscription_reference,
               provider_product_reference, provider_price_reference,
               last_provider_event_reference, provider_event_position,
               normalized_status, plan_version_id, billable_seat_quantity,
               current_period_id, current_period_start, current_period_end,
               cancel_at_period_end, effective_at${input.providerEnvironment === undefined ? "" : ", provider_environment"}
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $14, $15::timestamptz, $16::timestamptz, $17, $18::timestamptz${input.providerEnvironment === undefined ? "" : ", $19"}
             )
             ON CONFLICT (billing_account_id) DO NOTHING
             RETURNING *`,
            [
              input.subscriptionProjectionId,
              context.organizationId,
              readString(account.billing_account_id),
              input.billingProvider,
              input.providerCustomerReference,
              input.providerSubscriptionReference,
              input.providerProductReference ?? null,
              input.providerPriceReference ?? null,
              input.lastProviderEventReference ?? null,
              input.providerEventPosition ?? null,
              input.normalizedStatus,
              input.planVersionId,
              seats,
              input.currentPeriodId ?? null,
              input.currentPeriodStart ?? null,
              input.currentPeriodEnd ?? null,
              input.cancelAtPeriodEnd,
              input.effectiveAt,
              ...(input.providerEnvironment === undefined
                ? []
                : [input.providerEnvironment]),
            ],
          ),
        );
      } else {
        result = await transaction.query<SubscriptionRow>(
          sql(
            `UPDATE organization_subscription_projections
             SET ${input.providerEnvironment === undefined ? "" : "provider_environment = $19, "}provider_customer_reference = $1,
                 provider_subscription_reference = $2,
                 provider_product_reference = $3,
                 provider_price_reference = $4,
                 last_provider_event_reference = $5,
                 provider_event_position = $6,
                 normalized_status = $7,
                 plan_version_id = $8,
                 billable_seat_quantity = $9,
                 current_period_id = $10,
                 current_period_start = $11::timestamptz,
                 current_period_end = $12::timestamptz,
                 cancel_at_period_end = $13,
                 effective_at = $14::timestamptz,
                 record_version = record_version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $15
               AND subscription_projection_id = $16
               AND billing_provider = $17
               AND record_version = $18
               ${input.providerEnvironment === undefined ? "AND COALESCE(to_jsonb(organization_subscription_projections)->>'provider_environment','test')='test'" : ""}
             RETURNING *`,
            [
              input.providerCustomerReference,
              input.providerSubscriptionReference,
              input.providerProductReference ?? null,
              input.providerPriceReference ?? null,
              input.lastProviderEventReference ?? null,
              input.providerEventPosition ?? null,
              input.normalizedStatus,
              input.planVersionId,
              seats,
              input.currentPeriodId ?? null,
              input.currentPeriodStart ?? null,
              input.currentPeriodEnd ?? null,
              input.cancelAtPeriodEnd,
              input.effectiveAt,
              context.organizationId,
              input.subscriptionProjectionId,
              input.billingProvider,
              expectedVersion,
              ...(input.providerEnvironment === undefined
                ? []
                : [input.providerEnvironment]),
            ],
          ),
        );
      }
      let row = result.rows[0];
      if (row === undefined && expectedVersion === 0n) {
        const replay = await transaction.query<SubscriptionRow>(
          sql(
            `SELECT * FROM organization_subscription_projections
             WHERE organization_id = $1 AND billing_account_id = $2`,
            [context.organizationId, readString(account.billing_account_id)],
          ),
        );
        row = replay.rows[0];
        if (
          row === undefined ||
          readString(row.subscription_projection_id) !==
            input.subscriptionProjectionId ||
          readString(row.billing_provider) !== input.billingProvider ||
          (row["provider_environment"] ?? "test") !==
            (input.providerEnvironment ?? "test") ||
          readString(row.provider_customer_reference) !==
            input.providerCustomerReference ||
          readString(row.provider_subscription_reference) !==
            input.providerSubscriptionReference ||
          readOptionalString(row.provider_product_reference) !==
            input.providerProductReference ||
          readOptionalString(row.provider_price_reference) !==
            input.providerPriceReference ||
          readOptionalString(row.last_provider_event_reference) !==
            input.lastProviderEventReference ||
          readOptionalString(row.provider_event_position) !==
            input.providerEventPosition ||
          readBoolean(row.cancel_at_period_end) !== input.cancelAtPeriodEnd ||
          readString(row.normalized_status) !== input.normalizedStatus ||
          readString(row.plan_version_id) !== input.planVersionId ||
          readDecimal(row.billable_seat_quantity) !== seats.toString() ||
          readOptionalString(row.current_period_id) !== input.currentPeriodId ||
          !optionalInstantMatches(
            row.current_period_start,
            input.currentPeriodStart,
          ) ||
          !optionalInstantMatches(
            row.current_period_end,
            input.currentPeriodEnd,
          ) ||
          Date.parse(readTimestamp(row.effective_at)) !==
            Date.parse(input.effectiveAt) ||
          readInteger(row.record_version) !== 1n
        ) {
          return fail(
            "idempotency-conflict",
            "The subscription projection identity conflicts.",
          );
        }
      }
      if (row === undefined) {
        return fail(
          "version-conflict",
          "The subscription projection changed before the update completed.",
        );
      }
      return mapSubscription(row);
    });
  }

  async updateEntitlementSnapshot(
    context: TrustedCommercialMutationContext,
    input: CommercialEntitlementSnapshotInput,
  ): Promise<CommercialEntitlementSnapshotRecord> {
    assertMutationContext(context);
    assertIdentifier(input.entitlementSnapshotId);
    assertIdentifier(input.planVersionId);
    if (input.subscriptionProjectionId !== undefined) {
      assertIdentifier(input.subscriptionProjectionId);
    }
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.entitlementPolicyVersion)
    ) {
      return fail(
        "invalid-input",
        "The entitlement policy version is invalid.",
      );
    }
    assertTimestamp(input.effectiveAt);
    const expectedVersion = unsignedInteger(input.expectedRecordVersion);
    const sourceVersion = unsignedInteger(input.sourceRecordVersion, true);

    return this.#database.transaction(async (transaction) => {
      const account = await lockBillingAccount(
        transaction,
        context.organizationId,
      );
      if (input.subscriptionProjectionId === undefined) {
        return fail(
          "invalid-input",
          "Paid beta entitlements require a verified subscription projection.",
        );
      }
      const projection = await transaction.query<SubscriptionRow>(
        sql(
          `SELECT subscription_projection_id, organization_id,
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
           WHERE organization_id = $1
             AND subscription_projection_id = $2
           FOR UPDATE`,
          [context.organizationId, input.subscriptionProjectionId],
        ),
      );
      const projectionRow = projection.rows[0];
      if (projectionRow === undefined) {
        return fail(
          "not-found",
          "The subscription projection is not available.",
        );
      }
      const subscriptionIsActive =
        readString(projectionRow.normalized_status) === "active";
      if (
        readInteger(projectionRow.record_version) !== sourceVersion ||
        readString(projectionRow.plan_version_id) !== input.planVersionId ||
        readString(projectionRow.billing_account_id) !==
          readString(account.billing_account_id)
      ) {
        return fail(
          "version-conflict",
          "The entitlement subscription evidence is not current.",
        );
      }
      const expectedExpensiveOperationsEnabled =
        readString(account.lifecycle_status) === "active" &&
        readBoolean(account.expensive_operations_enabled) &&
        subscriptionIsActive;
      if (
        input.expensiveOperationsEnabled !== expectedExpensiveOperationsEnabled
      ) {
        return fail(
          "invalid-input",
          "The entitlement kill-switch evidence is not current.",
        );
      }
      let result;
      if (expectedVersion === 0n) {
        result = await transaction.query<EntitlementRow>(
          sql(
            `INSERT INTO organization_entitlement_snapshots (
               organization_id, entitlement_snapshot_id, billing_account_id,
               subscription_projection_id, plan_version_id,
               entitlement_policy_version, source_record_version,
               expensive_operations_enabled, effective_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
             ON CONFLICT (organization_id) DO NOTHING
             RETURNING *`,
            [
              context.organizationId,
              input.entitlementSnapshotId,
              readString(account.billing_account_id),
              input.subscriptionProjectionId ?? null,
              input.planVersionId,
              input.entitlementPolicyVersion,
              sourceVersion,
              input.expensiveOperationsEnabled,
              input.effectiveAt,
            ],
          ),
        );
      } else {
        result = await transaction.query<EntitlementRow>(
          sql(
            `UPDATE organization_entitlement_snapshots
             SET subscription_projection_id = $1,
                 plan_version_id = $2,
                 entitlement_policy_version = $3,
                 source_record_version = $4,
                 expensive_operations_enabled = $5,
                 effective_at = $6::timestamptz,
                 record_version = record_version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $7
               AND entitlement_snapshot_id = $8
               AND record_version = $9
             RETURNING *`,
            [
              input.subscriptionProjectionId ?? null,
              input.planVersionId,
              input.entitlementPolicyVersion,
              sourceVersion,
              input.expensiveOperationsEnabled,
              input.effectiveAt,
              context.organizationId,
              input.entitlementSnapshotId,
              expectedVersion,
            ],
          ),
        );
      }
      let row = result.rows[0];
      if (row === undefined && expectedVersion === 0n) {
        const replay = await transaction.query<EntitlementRow>(
          sql(
            `SELECT * FROM organization_entitlement_snapshots
             WHERE organization_id = $1`,
            [context.organizationId],
          ),
        );
        row = replay.rows[0];
        if (
          row === undefined ||
          readString(row.entitlement_snapshot_id) !==
            input.entitlementSnapshotId ||
          readString(row.billing_account_id) !==
            readString(account.billing_account_id) ||
          readOptionalString(row.subscription_projection_id) !==
            input.subscriptionProjectionId ||
          readString(row.plan_version_id) !== input.planVersionId ||
          readString(row.entitlement_policy_version) !==
            input.entitlementPolicyVersion ||
          readInteger(row.source_record_version) !== sourceVersion ||
          readBoolean(row.expensive_operations_enabled) !==
            input.expensiveOperationsEnabled ||
          Date.parse(readTimestamp(row.effective_at)) !==
            Date.parse(input.effectiveAt) ||
          readDecimal(row.record_version) !== "1"
        ) {
          return fail(
            "idempotency-conflict",
            "The entitlement snapshot identity conflicts.",
          );
        }
      }
      if (row === undefined) {
        return fail(
          "version-conflict",
          "The entitlement snapshot changed before the update completed.",
        );
      }
      return mapEntitlement(row);
    });
  }

  async createCreditGrant(
    context: TrustedCommercialMutationContext,
    input: CreateCreditGrantInput,
  ): Promise<CreditGrantRecord> {
    assertMutationContext(context);
    assertPolicyVersion(input.chargingPolicyVersion);
    assertIdentifier(input.ledgerEntryId);
    if (!reasonCodePattern.test(input.reasonCode)) {
      return fail("invalid-input", "The grant reason code is invalid.");
    }
    if (input.relatedLedgerEntryId !== undefined) {
      assertIdentifier(input.relatedLedgerEntryId);
    }
    if (input.safeReason !== undefined) {
      assertBounded(input.safeReason, 300);
    }
    if (
      input.grantKind === "administrative" &&
      (context.authority !== "internal-administration" ||
        input.relatedLedgerEntryId === undefined ||
        input.safeReason === undefined)
    ) {
      return fail(
        "access-denied",
        "Administrative grant evidence is required.",
      );
    }
    if (
      input.grantKind !== "administrative" &&
      context.authority !== "internal-accounting"
    ) {
      return fail(
        "access-denied",
        "Ordinary grant issuance requires accounting authority.",
      );
    }
    if (
      ["one-time", "monthly"].includes(input.grantKind) &&
      input.planVersionId === undefined
    ) {
      return fail(
        "invalid-input",
        "Included grants require a source plan version.",
      );
    }
    assertIdentifier(input.creditGrantId);
    if (input.planVersionId !== undefined) {
      assertIdentifier(input.planVersionId);
    }
    assertPolicyVersion(input.grantPolicyVersion);
    assertTimestamp(input.startsAt);
    if (input.sourceReference !== undefined) {
      assertBounded(input.sourceReference, 255);
    }

    const expirationPolicyKind = input.expirationPolicy.kind;
    const expirationPolicyVersion =
      input.expirationPolicy.kind === "unresolved"
        ? undefined
        : input.expirationPolicy.policyVersion;
    const expiresAt =
      input.expirationPolicy.kind === "expires-at"
        ? input.expirationPolicy.expiresAt
        : undefined;
    if (expirationPolicyVersion !== undefined) {
      assertPolicyVersion(expirationPolicyVersion);
    }
    if (expiresAt !== undefined) {
      assertTimestamp(expiresAt);
      if (Date.parse(expiresAt) <= Date.parse(input.startsAt)) {
        return fail("invalid-input", "The grant expiration is invalid.");
      }
    }
    if (
      expirationPolicyKind === "unresolved" &&
      input.grantKind !== "purchased"
    ) {
      return fail(
        "invalid-input",
        "Only purchased credits may await an expiration policy.",
      );
    }

    const subscriptionPeriod = input.subscriptionPeriod;
    if (input.grantKind === "monthly") {
      if (
        subscriptionPeriod === undefined ||
        expirationPolicyKind !== "expires-at" ||
        expiresAt === undefined
      ) {
        return fail(
          "invalid-input",
          "Monthly grants require an explicit subscription period.",
        );
      }
      assertIdentifier(subscriptionPeriod.periodId);
      assertTimestamp(subscriptionPeriod.startsAt);
      assertTimestamp(subscriptionPeriod.endsAt);
      if (
        Date.parse(subscriptionPeriod.endsAt) <=
          Date.parse(subscriptionPeriod.startsAt) ||
        Date.parse(input.startsAt) < Date.parse(subscriptionPeriod.startsAt) ||
        Date.parse(input.startsAt) >= Date.parse(subscriptionPeriod.endsAt) ||
        Date.parse(expiresAt) !== Date.parse(subscriptionPeriod.endsAt)
      ) {
        return fail("invalid-input", "The monthly grant period is invalid.");
      }
    } else if (subscriptionPeriod !== undefined) {
      return fail(
        "invalid-input",
        "Only monthly grants use a subscription period.",
      );
    }

    const creditUnits = unsignedInteger(input.creditUnits, true);
    const priority = unsignedInteger(input.consumptionPriority);
    if (priority > 2_147_483_647n) {
      return fail(
        "invalid-input",
        "The grant consumption priority is invalid.",
      );
    }
    const keySha256 = hashIdempotencyKey(input.idempotencyKey);
    const createdByPrincipalId =
      context.authority === "internal-administration"
        ? context.actorPrincipalId
        : null;
    const administrativeGrant = input.grantKind === "administrative";

    return this.#database.transaction(async (transaction) => {
      const account = await lockBillingAccount(
        transaction,
        context.organizationId,
      );
      await lockUsageLedgerIdentity(
        transaction,
        context.organizationId,
        input.ledgerEntryId,
        keySha256,
      );
      const existing = await transaction.query<GrantRow>(
        sql(
          `SELECT credit_grant_id, organization_id, billing_account_id,
                  plan_version_id, grant_kind, credit_units, starts_at,
                  expires_at, expiration_policy_kind,
                  expiration_policy_version, subscription_period_id,
                  subscription_period_start, subscription_period_end,
                  consumption_priority, source_reference,
                  grant_policy_version
           FROM credit_grants
           WHERE organization_id = $1
             AND (
               idempotency_key_sha256 = $2
               OR ($3::VARCHAR IS NOT NULL
                 AND grant_kind = $5
                 AND source_reference = $3)
               OR ($4::VARCHAR IS NOT NULL AND subscription_period_id = $4)
               OR (
                 $5 = 'one-time' AND grant_kind = 'one-time'
                 AND plan_version_id = $6
                 AND grant_policy_version = $7
               )
             )
           FOR UPDATE`,
          [
            context.organizationId,
            keySha256,
            input.sourceReference ?? null,
            subscriptionPeriod?.periodId ?? null,
            input.grantKind,
            input.planVersionId ?? null,
            input.grantPolicyVersion,
          ],
        ),
      );
      const replay = existing.rows[0];
      if (replay !== undefined) {
        if (
          readString(replay.credit_grant_id) !== input.creditGrantId ||
          readDecimal(replay.credit_units) !== creditUnits.toString() ||
          readString(replay.grant_kind) !== input.grantKind ||
          readOptionalString(replay.plan_version_id) !== input.planVersionId ||
          readString(replay.grant_policy_version) !==
            input.grantPolicyVersion ||
          readString(replay.expiration_policy_kind) !== expirationPolicyKind ||
          readOptionalString(replay.expiration_policy_version) !==
            expirationPolicyVersion ||
          readOptionalString(replay.subscription_period_id) !==
            subscriptionPeriod?.periodId ||
          readDecimal(replay.consumption_priority) !== priority.toString() ||
          readOptionalString(replay.source_reference) !==
            input.sourceReference ||
          Date.parse(readTimestamp(replay.starts_at)) !==
            Date.parse(input.startsAt) ||
          (readOptionalString(replay.expires_at) === undefined) !==
            (expiresAt === undefined) ||
          (expiresAt !== undefined &&
            Date.parse(readTimestamp(replay.expires_at)) !==
              Date.parse(expiresAt))
        ) {
          return fail(
            "idempotency-conflict",
            "The credit grant idempotency key was reused.",
          );
        }
        const replayEvent = await transaction.query<
          SqlRow & {
            readonly acting_principal_id: unknown;
            readonly charging_policy_version: unknown;
            readonly credit_adjustment_units: unknown;
            readonly credit_grant_id: unknown;
            readonly entry_kind: unknown;
            readonly granted_credit_units: unknown;
            readonly ledger_entry_id: unknown;
            readonly plan_version_id: unknown;
            readonly reason_code: unknown;
            readonly recorded_by_actor_id: unknown;
            readonly recorded_by_actor_kind: unknown;
            readonly related_ledger_entry_id: unknown;
            readonly safe_reason: unknown;
          }
        >(
          sql(
            `SELECT ledger_entry_id, entry_kind, credit_grant_id,
                    acting_principal_id, recorded_by_actor_kind,
                    recorded_by_actor_id, plan_version_id,
                    granted_credit_units, credit_adjustment_units, outcome,
                    charging_policy_version, reason_code, safe_reason,
                    related_ledger_entry_id
             FROM usage_ledger_entries
             WHERE organization_id = $1
               AND (ledger_entry_id = $2 OR idempotency_key_sha256 = $3)
             FOR UPDATE`,
            [context.organizationId, input.ledgerEntryId, keySha256],
          ),
        );
        const eventRow = replayEvent.rows[0];
        const replayAllocations =
          administrativeGrant && eventRow !== undefined
            ? await loadUsageAllocations(
                transaction,
                context.organizationId,
                input.ledgerEntryId,
              )
            : [];
        const administrativeAllocationConflict =
          administrativeGrant &&
          (replayAllocations.length !== 1 ||
            replayAllocations[0]?.creditGrantId !== input.creditGrantId ||
            replayAllocations[0].creditAdjustmentUnits !==
              creditUnits.toString());
        if (
          eventRow === undefined ||
          readString(eventRow.ledger_entry_id) !== input.ledgerEntryId ||
          readString(eventRow.entry_kind) !==
            (administrativeGrant ? "adjustment" : "grant") ||
          readOptionalString(eventRow.credit_grant_id) !==
            (administrativeGrant ? undefined : input.creditGrantId) ||
          readDecimal(eventRow.granted_credit_units) !==
            (administrativeGrant ? "0" : creditUnits.toString()) ||
          readDecimal(eventRow.credit_adjustment_units) !==
            (administrativeGrant ? creditUnits.toString() : "0") ||
          readOptionalString(eventRow.acting_principal_id) !== undefined ||
          readString(eventRow.recorded_by_actor_kind) !== context.authority ||
          readString(eventRow.recorded_by_actor_id) !== context.actorId ||
          readOptionalString(eventRow.plan_version_id) !==
            (administrativeGrant ? undefined : input.planVersionId) ||
          readString(eventRow["outcome"]) !==
            (administrativeGrant ? "compensated" : "granted") ||
          readString(eventRow.charging_policy_version) !==
            input.chargingPolicyVersion ||
          readString(eventRow.reason_code) !== input.reasonCode ||
          readOptionalString(eventRow.safe_reason) !== input.safeReason ||
          readOptionalString(eventRow.related_ledger_entry_id) !==
            input.relatedLedgerEntryId ||
          administrativeAllocationConflict
        ) {
          return fail(
            "idempotency-conflict",
            "The grant ledger event conflicts.",
          );
        }
        return mapGrant(replay);
      }
      if (input.grantKind === "one-time" || input.grantKind === "monthly") {
        const configuredGrant = await transaction.query<
          SqlRow & { readonly credit_units: unknown }
        >(
          input.planVersionId === undefined
            ? fail("invalid-input", "Included grants require a source plan.")
            : sql(
                `SELECT included.credit_units
             FROM commercial_plan_included_credit_grants included
             JOIN commercial_plan_versions version
               ON version.plan_version_id = included.plan_version_id
             WHERE included.plan_version_id = $1
               AND included.grant_kind = $2
               AND version.configuration_status = 'proposed-beta-example'
               AND version.effective_from <= $3::timestamptz
               AND (version.effective_until IS NULL
                 OR version.effective_until > $3::timestamptz)
             FOR SHARE OF included, version`,
                [input.planVersionId, input.grantKind, input.startsAt],
              ),
        );
        const configuredRow = configuredGrant.rows[0];
        if (
          configuredRow === undefined ||
          readInteger(configuredRow.credit_units) !== creditUnits
        ) {
          return fail(
            "invalid-input",
            "The included credit grant does not match its immutable plan source.",
          );
        }
        const subscription = await transaction.query<SubscriptionRow>(
          sql(
            `SELECT subscription_projection_id, organization_id,
                    billing_account_id, billing_provider,
                    provider_customer_reference,
                    provider_subscription_reference,
                    provider_product_reference, provider_price_reference,
                    last_provider_event_reference, provider_event_position,
                    normalized_status, plan_version_id,
                    billable_seat_quantity, current_period_id,
                    current_period_start, current_period_end, effective_at,
                    record_version
             FROM organization_subscription_projections
             WHERE organization_id = $1 AND billing_account_id = $2
             FOR UPDATE`,
            [context.organizationId, readString(account.billing_account_id)],
          ),
        );
        const subscriptionRow = subscription.rows[0];
        if (
          subscriptionRow === undefined ||
          readString(subscriptionRow.normalized_status) !== "active" ||
          readString(subscriptionRow.plan_version_id) !== input.planVersionId ||
          (input.grantKind === "one-time" &&
            Date.parse(readTimestamp(subscriptionRow.effective_at)) >
              Date.parse(input.startsAt))
        ) {
          return fail(
            "invalid-input",
            "The included credit grant subscription source is not current.",
          );
        }
        if (input.grantKind === "monthly") {
          // Projection effective_at records the accepted provider event, which
          // may arrive after the service period begins. The exact current
          // subscription period, not that event time, authorizes monthly credits.
          if (
            subscriptionPeriod === undefined ||
            readOptionalString(subscriptionRow.current_period_id) !==
              subscriptionPeriod.periodId ||
            !optionalInstantMatches(
              subscriptionRow.current_period_start,
              subscriptionPeriod.startsAt,
            ) ||
            !optionalInstantMatches(
              subscriptionRow.current_period_end,
              subscriptionPeriod.endsAt,
            )
          ) {
            return fail(
              "invalid-input",
              "The monthly grant does not match the current subscription period.",
            );
          }
        }
      }
      const result = await transaction.query<GrantRow>(
        sql(
          `INSERT INTO credit_grants (
             credit_grant_id, organization_id, billing_account_id,
             plan_version_id, grant_kind, credit_units, starts_at,
             expires_at, expiration_policy_kind,
             expiration_policy_version, subscription_period_id,
             subscription_period_start, subscription_period_end,
             consumption_priority, source_reference, grant_policy_version,
             idempotency_key_sha256, created_by_actor_kind,
             created_by_actor_id, created_by_principal_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10,
             $11, $12::timestamptz, $13::timestamptz, $14, $15, $16, $17, $18, $19, $20
           )
           RETURNING credit_grant_id, organization_id, billing_account_id,
                     plan_version_id, grant_kind, credit_units, starts_at,
                     expires_at, expiration_policy_kind,
                     expiration_policy_version, subscription_period_id,
                     subscription_period_start, subscription_period_end,
                     consumption_priority, source_reference,
                     grant_policy_version`,
          [
            input.creditGrantId,
            context.organizationId,
            readString(account.billing_account_id),
            input.planVersionId ?? null,
            input.grantKind,
            creditUnits,
            input.startsAt,
            expiresAt ?? null,
            expirationPolicyKind,
            expirationPolicyVersion ?? null,
            subscriptionPeriod?.periodId ?? null,
            subscriptionPeriod?.startsAt ?? null,
            subscriptionPeriod?.endsAt ?? null,
            priority,
            input.sourceReference ?? null,
            input.grantPolicyVersion,
            keySha256,
            context.authority,
            context.actorId,
            createdByPrincipalId,
          ],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        return fail("not-found", "The credit grant could not be created.");
      }
      if (input.relatedLedgerEntryId !== undefined) {
        const related = await transaction.query(
          sql(
            `SELECT 1 FROM usage_ledger_entries
             WHERE organization_id = $1 AND ledger_entry_id = $2`,
            [context.organizationId, input.relatedLedgerEntryId],
          ),
        );
        if (related.rows.length !== 1) {
          return fail("not-found", "The related grant event is not available.");
        }
      }
      const eventInsert = await transaction.query(
        sql(
          `INSERT INTO usage_ledger_entries (
             organization_id, ledger_entry_id, idempotency_key_sha256,
             entry_kind, billing_account_id, credit_grant_id,
             related_ledger_entry_id, acting_principal_id,
             recorded_by_actor_kind, recorded_by_actor_id, plan_version_id,
             granted_credit_units, credit_adjustment_units, outcome,
             reason_code, safe_reason, charging_policy_version,
             correlation_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18
           )
           RETURNING ledger_entry_id`,
          [
            context.organizationId,
            input.ledgerEntryId,
            keySha256,
            administrativeGrant ? "adjustment" : "grant",
            readString(account.billing_account_id),
            administrativeGrant ? null : input.creditGrantId,
            input.relatedLedgerEntryId ?? null,
            null,
            context.authority,
            context.actorId,
            administrativeGrant ? null : (input.planVersionId ?? null),
            administrativeGrant ? 0n : creditUnits,
            administrativeGrant ? creditUnits : 0n,
            administrativeGrant ? "compensated" : "granted",
            input.reasonCode,
            input.safeReason ?? null,
            input.chargingPolicyVersion,
            context.correlationId,
          ],
        ),
      );
      if (eventInsert.rows.length !== 1) {
        return fail(
          "not-found",
          "The grant ledger event could not be created.",
        );
      }
      if (administrativeGrant) {
        await transaction.query(
          sql(
            `INSERT INTO usage_ledger_entry_allocations (
               organization_id, ledger_entry_id, allocation_sequence,
               credit_grant_id, credit_adjustment_units
             ) VALUES ($1, $2, 1, $3, $4)`,
            [
              context.organizationId,
              input.ledgerEntryId,
              input.creditGrantId,
              creditUnits,
            ],
          ),
        );
      }
      return mapGrant(row);
    });
  }

  async reserveCredits(
    context: AuthorizedOrganizationScope | TrustedCommercialReservationContext,
    input: ReserveCreditsInput,
  ): Promise<CreditReservationRecord> {
    return this.#reserveCredits(context, input, (work) =>
      this.#database.transaction(work),
    );
  }

  /** Keeps an application-specific invocation journal and the canonical
   * grant allocation in one transaction. Authorization is rechecked here. */
  async reserveCreditsInTransaction(
    transaction: SqlExecutor,
    context: AuthorizedOrganizationScope,
    input: ReserveCreditsInput,
  ): Promise<CreditReservationRecord> {
    return this.#reserveCredits(context, input, (work) => work(transaction));
  }

  /** Uses the caller's real SQL transaction: the model decision, canonical
   * grant allocation and ledger event must commit or roll back together. */
  async reserveModelCreditsInTransaction(
    transaction: SqlExecutor,
    context: TrustedCommercialReservationContext,
    input: ReserveCreditsInput,
    authority: ModelReservationTransactionAuthority,
  ): Promise<CreditReservationRecord> {
    assertTimestamp(authority.capturedAt);
    assertIdentifier(authority.normalizationPolicyVersionId);
    return this.#reserveCredits(
      context,
      input,
      (work) => work(transaction),
      authority,
    );
  }

  async #reserveCredits(
    context: AuthorizedOrganizationScope | TrustedCommercialReservationContext,
    input: ReserveCreditsInput,
    execute: (
      work: (transaction: SqlExecutor) => Promise<CreditReservationRecord>,
    ) => Promise<CreditReservationRecord>,
    modelAuthority?: ModelReservationTransactionAuthority,
  ): Promise<CreditReservationRecord> {
    const trustedReservation = "authority" in context;
    if (trustedReservation) {
      assertAccountingContext(context);
      assertIdentifier(context.actingPrincipalId);
    } else {
      assertHumanScope(context);
      requireScopePermission(context, "commercial.expensive.use");
    }
    const organizationId = context.organizationId;
    const actingPrincipalId = trustedReservation
      ? context.actingPrincipalId
      : context.principalId;
    const recordedByActorKind = trustedReservation
      ? ("internal-accounting" as const)
      : ("principal" as const);
    const recordedByActorId = trustedReservation
      ? context.actorId
      : context.principalId;
    assertPolicyVersion(input.chargingPolicyVersion);
    assertPolicyVersion(input.entitlementPolicyVersion);
    assertIdentifier(input.planVersionId);
    assertIdentifier(input.reservationId);
    assertIdentifier(input.requestId);
    assertIdentifier(input.projectId);
    assertIdentifier(input.jobId);
    assertIdentifier(input.pricingVersionId);
    if (!featureKeyPattern.test(input.featureKey)) {
      return fail("invalid-input", "The commercial feature key is invalid.");
    }
    if (
      !(
        modelAuthority === undefined
          ? providerKeyPattern
          : modelProviderKeyPattern
      ).test(input.providerKey)
    ) {
      return fail("invalid-input", "The model provider key is invalid.");
    }
    assertModelIdentifier(input.modelId);
    assertModelIdentifier(input.modelVersion);
    assertTimestamp(input.expiresAt);
    assertSha256(input.requestSha256);
    const requested = unsignedInteger(input.requestedCreditUnits, true);
    const keySha256 = hashIdempotencyKey(input.idempotencyKey);
    const ledger = deterministicLedgerIdentity(
      "reservation",
      input.reservationId,
    );

    return execute(async (transaction) => {
      if (trustedReservation) {
        await requireActingPrincipalPermission(transaction, context);
      } else {
        await requireHumanScope(
          transaction,
          context,
          "commercial.expensive.use",
        );
      }
      const account = await lockBillingAccount(transaction, organizationId);
      await lockUsageLedgerIdentity(
        transaction,
        organizationId,
        ledger.id,
        ledger.idempotencySha256,
      );
      const existing = await transaction.query<ReservationRow>(
        sql(
          `${reservationSelect}
           WHERE organization_id = $1
             AND (idempotency_key_sha256 = $2 OR request_id = $3)
           FOR UPDATE`,
          [organizationId, keySha256, input.requestId],
        ),
      );
      const replay = existing.rows[0];
      if (replay !== undefined) {
        if (
          readString(replay.reservation_id) !== input.reservationId ||
          readString(replay.acting_principal_id) !== actingPrincipalId ||
          readString(replay.project_id) !== input.projectId ||
          readString(replay.job_id) !== input.jobId ||
          readString(replay.feature_key) !== input.featureKey ||
          Date.parse(readTimestamp(replay.expires_at)) !==
            Date.parse(input.expiresAt) ||
          readString(replay.request_sha256) !== input.requestSha256 ||
          readString(replay.request_id) !== input.requestId ||
          readDecimal(replay.requested_credit_units) !== requested.toString() ||
          readString(replay.charging_policy_version) !==
            input.chargingPolicyVersion ||
          readString(replay.entitlement_policy_version) !==
            input.entitlementPolicyVersion ||
          readString(replay.plan_version_id) !== input.planVersionId ||
          readString(replay.pricing_version_id) !== input.pricingVersionId ||
          readString(replay.provider_key) !== input.providerKey ||
          readString(replay.model_key) !== input.modelId ||
          readString(replay.model_version) !== input.modelVersion
        ) {
          return fail(
            "idempotency-conflict",
            "The credit reservation identity was reused.",
          );
        }
        const replayLedger = await transaction.query<UsageRow>(
          sql(
            `${usageSelect}
             WHERE organization_id = $1
               AND (ledger_entry_id = $2 OR idempotency_key_sha256 = $3)`,
            [organizationId, ledger.id, ledger.idempotencySha256],
          ),
        );
        const replayEvent = replayLedger.rows[0];
        if (
          replayEvent === undefined ||
          readString(replayEvent.ledger_entry_id) !== ledger.id ||
          readString(replayEvent.idempotency_key_sha256) !==
            ledger.idempotencySha256 ||
          readString(replayEvent.entry_kind) !== "reservation" ||
          readOptionalString(replayEvent.reservation_id) !==
            input.reservationId ||
          readDecimal(replayEvent.reserved_credit_units) !==
            requested.toString()
        ) {
          return fail(
            "idempotency-conflict",
            "The reservation ledger evidence conflicts.",
          );
        }
        return mapReservation(transaction, replay);
      }
      const ledgerCollision = await transaction.query<UsageRow>(
        sql(
          `${usageSelect}
           WHERE organization_id = $1
             AND (ledger_entry_id = $2 OR idempotency_key_sha256 = $3)
           FOR UPDATE`,
          [organizationId, ledger.id, ledger.idempotencySha256],
        ),
      );
      if (ledgerCollision.rows.length !== 0) {
        return fail(
          "idempotency-conflict",
          "The reservation ledger identity conflicts.",
        );
      }
      if (
        readString(account.lifecycle_status) !== "active" ||
        !readBoolean(account.expensive_operations_enabled)
      ) {
        return fail(
          "entitlement-denied",
          "New expensive operations are not available for this organization.",
        );
      }

      const entitlement = await transaction.query<
        EntitlementRow & { readonly entitlement_state: unknown }
      >(
        sql(
          `SELECT s.organization_id, s.entitlement_snapshot_id,
                  s.billing_account_id, s.subscription_projection_id,
                  s.plan_version_id, s.entitlement_policy_version,
                  s.source_record_version, s.expensive_operations_enabled,
                  s.record_version, s.effective_at,
                  f.entitlement_state
           FROM ${input.planVersionId === "planver_staff_credits_2026_10_15_v1" ? "organization_effective_entitlement_snapshots_v1" : "organization_entitlement_snapshots"} s
           JOIN commercial_plan_versions current_plan
             ON current_plan.plan_version_id = s.plan_version_id
            AND current_plan.configuration_status = 'proposed-beta-example'
            AND current_plan.effective_from <= CURRENT_TIMESTAMP
            AND (current_plan.effective_until IS NULL
              OR current_plan.effective_until > CURRENT_TIMESTAMP)
           JOIN organization_billing_accounts current_account
             ON current_account.organization_id = s.organization_id
            AND current_account.billing_account_id = s.billing_account_id
           LEFT JOIN organization_subscription_projections current_subscription
             ON current_subscription.organization_id = s.organization_id
            AND current_subscription.subscription_projection_id =
                s.subscription_projection_id
           JOIN commercial_plan_feature_entitlements f
             ON f.plan_version_id = s.plan_version_id
            AND f.feature_key = $2
           WHERE s.organization_id = $1
             AND current_account.lifecycle_status = 'active'
             AND current_account.expensive_operations_enabled = TRUE
             AND s.effective_at <= CURRENT_TIMESTAMP
             AND ((s.subscription_projection_id IS NOT NULL
             AND s.source_record_version = current_subscription.record_version
             AND s.plan_version_id = current_subscription.plan_version_id
             AND current_subscription.normalized_status = 'active')
             ${input.planVersionId === "planver_staff_trial_2026_10_06_v1" ? "OR (s.subscription_projection_id IS NULL AND cloudmarkup_staff_trial_current_v1(s.organization_id,s.billing_account_id))" : ""}
             ${input.planVersionId === "planver_staff_credits_2026_10_15_v1" ? "OR (s.subscription_projection_id IS NULL AND s.plan_version_id='planver_staff_credits_2026_10_15_v1' AND cloudmarkup_staff_credit_access_v1(s.organization_id,s.billing_account_id))" : ""})`,
          [organizationId, input.featureKey],
        ),
      );
      const entitlementRow = entitlement.rows[0];
      if (
        entitlementRow === undefined ||
        readString(entitlementRow.entitlement_policy_version) !==
          input.entitlementPolicyVersion ||
        readString(entitlementRow.plan_version_id) !== input.planVersionId ||
        !readBoolean(entitlementRow.expensive_operations_enabled) ||
        !["enabled", "limited"].includes(
          readString(entitlementRow.entitlement_state),
        )
      ) {
        return fail(
          "entitlement-denied",
          "The requested commercial feature is not entitled.",
        );
      }

      const pricing = await transaction.query<
        SqlRow & { readonly pricing_version_id: unknown }
      >(
        sql(
          modelAuthority === undefined
            ? `SELECT pricing_version_id FROM provider_pricing_versions
           WHERE provider_key = $1
             AND model_key = $2
             AND model_version = $3
             AND effective_from <= CURRENT_TIMESTAMP
             AND (effective_until IS NULL OR effective_until > CURRENT_TIMESTAMP)
           ORDER BY effective_from DESC, pricing_version_id DESC
           LIMIT 1`
            : `SELECT pricing.pricing_version_id FROM model_provider_pricing_versions pricing
           JOIN credit_normalization_policy_versions policy ON policy.normalization_policy_version_id=$5
             AND policy.cost_currency=pricing.cost_currency AND policy.policy_status='enabled'
             AND policy.effective_from <= $6::timestamptz
             AND (policy.effective_until IS NULL OR policy.effective_until > clock_timestamp())
           WHERE pricing.provider_key=$1 AND pricing.model_key=$2 AND pricing.model_version=$3
             AND pricing.pricing_version_id=$4 AND pricing.environment=$7
             AND pricing.inference_profile_id IS NOT DISTINCT FROM $8::varchar
             AND pricing.pricing_status='enabled' AND pricing.effective_from <= $6::timestamptz
             AND $6::timestamptz <= clock_timestamp()
             AND (pricing.effective_until IS NULL OR pricing.effective_until > clock_timestamp())`,
          modelAuthority === undefined
            ? [input.providerKey, input.modelId, input.modelVersion]
            : [
                input.providerKey,
                input.modelId,
                input.modelVersion,
                input.pricingVersionId,
                modelAuthority.normalizationPolicyVersionId,
                modelAuthority.capturedAt,
                modelAuthority.environment,
                modelAuthority.inferenceProfileId,
              ],
        ),
      );
      if (
        pricing.rows[0] === undefined ||
        readString(pricing.rows[0].pricing_version_id) !==
          input.pricingVersionId
      ) {
        return fail(
          "entitlement-denied",
          "The requested model pricing version is not active.",
        );
      }

      const unevaluatedScopedLimit = await transaction.query(
        sql(
          `SELECT 1
           FROM commercial_plan_numeric_limits
           WHERE plan_version_id = $1
             AND (
               (limit_key = 'per-user-request-count' AND limit_scope = 'member'
                 AND ($2::bigint IS NULL OR limit_value < $2::bigint))
               OR
               (limit_key = 'per-project-credit-cap' AND limit_scope = 'project')
             )
           LIMIT 1`,
          [
            readString(entitlementRow.plan_version_id),
            modelAuthority?.perUserMaximum ?? null,
          ],
        ),
      );
      if (unevaluatedScopedLimit.rows.length !== 0) {
        return fail(
          "entitlement-denied",
          "Configured scoped limits require a trusted entitlement decision.",
        );
      }

      const concurrentLimit = await transaction.query<
        SqlRow & {
          readonly active_count: unknown;
          readonly limit_value: unknown;
        }
      >(
        sql(
          `SELECT l.limit_value,
                  (SELECT COUNT(*)
                   FROM credit_reservations r
                   WHERE r.organization_id = $1 AND r.status = 'active')
                    AS active_count
           FROM commercial_plan_numeric_limits l
           WHERE l.plan_version_id = $2
             AND l.limit_key = 'concurrent-ai-jobs'
             AND l.limit_scope = 'organization'`,
          [organizationId, readString(entitlementRow.plan_version_id)],
        ),
      );
      const concurrentRow = concurrentLimit.rows[0];
      if (
        concurrentRow === undefined ||
        readInteger(concurrentRow.active_count) >=
          readInteger(concurrentRow.limit_value)
      ) {
        return fail(
          "entitlement-denied",
          "The concurrent AI job limit has been reached.",
        );
      }

      const grants = await transaction.query<AvailableGrantRow>(
        sql(
          `SELECT g.credit_grant_id, g.organization_id, g.billing_account_id,
                  g.plan_version_id, g.grant_kind, g.credit_units,
                  g.starts_at, g.expires_at, g.consumption_priority,
                  g.source_reference,
                  (CASE WHEN g.grant_kind = 'administrative'
                    THEN 0 ELSE g.credit_units END)
                    - COALESCE((
                        SELECT SUM(a.settled_credit_units)
                        FROM credit_reservation_allocations a
                        JOIN credit_reservations r
                          ON r.organization_id = a.organization_id
                         AND r.reservation_id = a.reservation_id
                        WHERE a.organization_id = g.organization_id
                          AND a.credit_grant_id = g.credit_grant_id
                          AND r.status = 'settled'
                      ), 0)
                    - COALESCE((
                        SELECT SUM(a.reserved_credit_units)
                        FROM credit_reservation_allocations a
                        JOIN credit_reservations r
                          ON r.organization_id = a.organization_id
                         AND r.reservation_id = a.reservation_id
                        WHERE a.organization_id = g.organization_id
                          AND a.credit_grant_id = g.credit_grant_id
                          AND r.status = 'active'
                      ), 0)
                    + COALESCE((
                        SELECT SUM(allocation.credit_adjustment_units)
                        FROM usage_ledger_entry_allocations allocation
                        JOIN usage_ledger_entries event
                          ON event.organization_id = allocation.organization_id
                         AND event.ledger_entry_id = allocation.ledger_entry_id
                        WHERE allocation.organization_id = g.organization_id
                          AND allocation.credit_grant_id = g.credit_grant_id
                          AND event.entry_kind = 'adjustment'
                      ), 0) AS available_credit_units
           FROM credit_grants g
           WHERE g.organization_id = $1
             AND g.starts_at <= CURRENT_TIMESTAMP
             AND g.expiration_policy_kind <> 'unresolved'
             AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
             ${input.planVersionId === "planver_staff_trial_2026_10_06_v1" ? "AND cloudmarkup_staff_trial_grant_available_v1(g.organization_id,g.credit_grant_id)" : ""}
             AND (((g.grant_policy_version = 'cloudmarkup-staff-trial-v1') = ($2 = 'planver_staff_trial_2026_10_06_v1'))
               OR ($2 = 'planver_staff_trial_2026_10_06_v1' AND g.grant_policy_version='cloudmarkup-staff-credits-v1'))
             AND (g.grant_policy_version IN ('cloudmarkup-staff-trial-v1','cloudmarkup-staff-credits-v1') OR NOT EXISTS(SELECT 1 FROM organization_entitlement_snapshots trial_snapshot WHERE trial_snapshot.organization_id=g.organization_id AND trial_snapshot.plan_version_id='planver_staff_trial_2026_10_06_v1'))
           ORDER BY g.expires_at NULLS LAST, g.consumption_priority,
                    g.starts_at, g.credit_grant_id
           FOR UPDATE OF g`,
          [organizationId, input.planVersionId],
        ),
      );

      let remaining = requested;
      const allocations: {
        readonly amount: bigint;
        readonly grantId: string;
      }[] = [];
      for (const grant of grants.rows) {
        const available = readInteger(grant.available_credit_units);
        if (available <= 0n) {
          continue;
        }
        const amount = available < remaining ? available : remaining;
        allocations.push({
          amount,
          grantId: readString(grant.credit_grant_id),
        });
        remaining -= amount;
        if (remaining === 0n) {
          break;
        }
      }
      if (remaining !== 0n) {
        return fail(
          "insufficient-credits",
          "The organization does not have enough available credits.",
        );
      }

      await modelAuthority?.assertCurrent(transaction);

      await transaction.query(
        sql(
          `INSERT INTO credit_reservations (
             reservation_id, organization_id, billing_account_id,
             entitlement_snapshot_id, entitlement_policy_version,
             plan_version_id, pricing_version_id, charging_policy_version,
             acting_principal_id, project_id, feature_key, request_id, job_id,
             provider_key, model_key, model_version,
             requested_credit_units, reserved_credit_units,
             request_sha256, idempotency_key_sha256, expires_at${modelAuthority === undefined ? "" : ", pricing_authority"}
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
             $21::timestamptz${modelAuthority === undefined ? "" : ", $22"}
           )`,
          [
            input.reservationId,
            organizationId,
            readString(account.billing_account_id),
            readString(entitlementRow.entitlement_snapshot_id),
            readString(entitlementRow.entitlement_policy_version),
            readString(entitlementRow.plan_version_id),
            input.pricingVersionId,
            input.chargingPolicyVersion,
            actingPrincipalId,
            input.projectId,
            input.featureKey,
            input.requestId,
            input.jobId,
            input.providerKey,
            input.modelId,
            input.modelVersion,
            requested,
            requested,
            input.requestSha256,
            keySha256,
            input.expiresAt,
            ...(modelAuthority === undefined ? [] : ["model-provider-v1"]),
          ],
        ),
      );
      for (const [index, allocation] of allocations.entries()) {
        await transaction.query(
          sql(
            `INSERT INTO credit_reservation_allocations (
               organization_id, reservation_id, credit_grant_id,
               allocation_sequence, reserved_credit_units
             ) VALUES ($1, $2, $3, $4, $5)`,
            [
              organizationId,
              input.reservationId,
              allocation.grantId,
              index + 1,
              allocation.amount,
            ],
          ),
        );
      }

      await transaction.query(
        sql(
          `INSERT INTO usage_ledger_entries (
             organization_id, ledger_entry_id, idempotency_key_sha256,
             entry_kind, billing_account_id, reservation_id,
             acting_principal_id, recorded_by_actor_kind,
             recorded_by_actor_id, project_id, feature_key, request_id,
             job_id, plan_version_id, pricing_version_id, provider_key,
             model_key, model_version, reserved_credit_units,
             entitlement_policy_version, reason_code,
             charging_policy_version, outcome, correlation_id${modelAuthority === undefined ? "" : ", pricing_authority"}
           ) VALUES (
             $1, $2, $3, 'reservation', $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, 'credit.reserved', $20, 'reserved', $21${modelAuthority === undefined ? "" : ", $22"}
           )`,
          [
            organizationId,
            ledger.id,
            ledger.idempotencySha256,
            readString(account.billing_account_id),
            input.reservationId,
            actingPrincipalId,
            recordedByActorKind,
            recordedByActorId,
            input.projectId,
            input.featureKey,
            input.requestId,
            input.jobId,
            readString(entitlementRow.plan_version_id),
            input.pricingVersionId,
            input.providerKey,
            input.modelId,
            input.modelVersion,
            requested,
            readString(entitlementRow.entitlement_policy_version),
            input.chargingPolicyVersion,
            context.correlationId,
            ...(modelAuthority === undefined ? [] : ["model-provider-v1"]),
          ],
        ),
      );
      for (const [index, allocation] of allocations.entries()) {
        await transaction.query(
          sql(
            `INSERT INTO usage_ledger_entry_allocations (
               organization_id, ledger_entry_id, allocation_sequence,
               credit_grant_id, reserved_credit_units
             ) VALUES ($1, $2, $3, $4, $5)`,
            [
              organizationId,
              ledger.id,
              index + 1,
              allocation.grantId,
              allocation.amount,
            ],
          ),
        );
      }

      const created = await selectReservationForUpdate(
        transaction,
        organizationId,
        input.reservationId,
      );
      await modelAuthority?.assertCurrent(transaction);
      return mapReservation(transaction, created);
    });
  }

  settleReservation(
    context: TrustedCommercialAccountingContext,
    input: SettleCreditReservationInput,
  ): Promise<CreditReservationRecord> {
    assertMetrics(input, true);
    assertPolicyVersion(input.chargingPolicyVersion);
    assertIdentifier(input.pricingVersionId);
    assertIdentifier(input.requestId);
    if (!reasonCodePattern.test(input.reasonCode)) {
      return Promise.reject(
        new CommercialPersistenceError(
          "invalid-input",
          "The settlement reason code is invalid.",
        ),
      );
    }
    const normalized = unsignedInteger(input.actualNormalizedCreditUnits);
    const customerCharge = unsignedInteger(input.customerChargeCreditUnits);
    if (customerCharge > normalized) {
      return Promise.reject(
        new CommercialPersistenceError(
          "invalid-input",
          "Customer charge cannot exceed normalized provider usage.",
        ),
      );
    }
    return this.#terminalTransition(context, input, {
      customerChargeCreditUnits: customerCharge,
      kind: "settlement",
      normalizedCreditUnits: normalized,
    });
  }

  releaseReservation(
    context: TrustedCommercialAccountingContext,
    input: ReleaseCreditReservationInput,
  ): Promise<CreditReservationRecord> {
    assertMetrics(input);
    assertPolicyVersion(input.chargingPolicyVersion);
    assertIdentifier(input.requestId);
    if (!reasonCodePattern.test(input.reasonCode)) {
      return Promise.reject(
        new CommercialPersistenceError(
          "invalid-input",
          "The release reason code is invalid.",
        ),
      );
    }
    const evidenceValues = [
      input.modelId,
      input.modelVersion,
      input.providerKey,
      input.providerRequestId,
      input.inputTokenCount,
      input.outputTokenCount,
      input.cachedInputTokenCount,
      input.latencyMilliseconds,
      input.estimatedProviderCostMicros,
      input.providerCostCurrency,
    ];
    const hasAnyProviderEvidence = evidenceValues.some(
      (value) => value !== undefined,
    );
    const hasProviderIdentity = input.modelId !== undefined;
    if (hasAnyProviderEvidence && !hasProviderIdentity) {
      return Promise.reject(
        new CommercialPersistenceError(
          "invalid-input",
          "Provider identity evidence is incomplete.",
        ),
      );
    }
    if (hasAnyProviderEvidence !== (input.pricingVersionId !== undefined)) {
      return Promise.reject(
        new CommercialPersistenceError(
          "invalid-input",
          "Provider pricing evidence is incomplete.",
        ),
      );
    }
    if (input.pricingVersionId !== undefined) {
      assertIdentifier(input.pricingVersionId);
    }
    if (
      input.chargingScenario === "provider-failure-before-useful-output" &&
      (!hasProviderIdentity ||
        input.estimatedProviderCostMicros === undefined ||
        input.providerCostCurrency === undefined)
    ) {
      return Promise.reject(
        new CommercialPersistenceError(
          "invalid-input",
          "Provider failure evidence is required.",
        ),
      );
    }
    if (
      input.chargingScenario === "user-cancelled-before-invocation" &&
      hasAnyProviderEvidence
    ) {
      return Promise.reject(
        new CommercialPersistenceError(
          "invalid-input",
          "Pre-invocation releases cannot contain provider evidence.",
        ),
      );
    }
    if (input.safeReason !== undefined) {
      assertBounded(input.safeReason, 300);
    }
    return this.#terminalTransition(context, input, { kind: "release" });
  }

  expireReservation(
    context: TrustedCommercialAccountingContext,
    input: ExpireCreditReservationInput,
  ): Promise<CreditReservationRecord> {
    assertPolicyVersion(input.chargingPolicyVersion);
    return this.#terminalTransition(context, input, { kind: "expiration" });
  }

  /** Joins the existing canonical allocation/ledger algorithm to the verified
   * model terminal journal in the caller's same real SQL transaction. */
  terminalModelReservationInTransaction(
    transaction: SqlExecutor,
    context: TrustedCommercialAccountingContext,
    input: ModelTerminalSettlementInput | ReleaseCreditReservationInput,
    authority: ModelTerminalTransactionAuthority,
  ): Promise<CreditReservationRecord> {
    const transition: TerminalTransition =
      input.chargingScenario === "model-preview-delivered-v1" ||
      input.chargingScenario === "model-evaluation-recorded-v2"
        ? {
            kind: "settlement",
            customerChargeCreditUnits: unsignedInteger(
              input.customerChargeCreditUnits,
            ),
            normalizedCreditUnits: unsignedInteger(
              input.actualNormalizedCreditUnits,
            ),
          }
        : { kind: "release" };
    assertMetrics(input, transition.kind === "settlement", true);
    assertPolicyVersion(input.chargingPolicyVersion);
    assertIdentifier(input.requestId);
    if (!reasonCodePattern.test(input.reasonCode))
      return fail("invalid-input", "The model terminal reason is invalid.");
    return this.#terminalTransition(
      context,
      input,
      transition,
      transaction,
      authority,
    );
  }

  async #terminalTransition(
    context: TrustedCommercialAccountingContext,
    input: TerminalInput,
    transition: TerminalTransition,
    suppliedTransaction?: SqlExecutor,
    modelAuthority?: ModelTerminalTransactionAuthority,
  ): Promise<CreditReservationRecord> {
    assertAccountingContext(context);
    assertIdentifier(input.reservationId);
    assertIdentifier(input.ledgerEntryId);
    assertSha256(input.requestSha256);
    const keySha256 = hashIdempotencyKey(input.idempotencyKey);
    const metrics = input as ProviderUsageMetricsInput;
    const chargingScenario = chargingScenarioForTerminal(input, transition);
    const payloadSha256 = terminalPayloadSha256(
      input,
      transition,
      chargingScenario,
    );
    const targetStatus =
      transition.kind === "settlement"
        ? "settled"
        : transition.kind === "release"
          ? "released"
          : "expired";

    const execute = (
      work: (transaction: SqlExecutor) => Promise<CreditReservationRecord>,
    ) =>
      suppliedTransaction === undefined
        ? this.#database.transaction(work)
        : work(suppliedTransaction);
    return execute(async (transaction) => {
      const account = await lockBillingAccount(
        transaction,
        context.organizationId,
      );
      await lockUsageLedgerIdentity(
        transaction,
        context.organizationId,
        input.ledgerEntryId,
        keySha256,
      );
      const reservation = await selectReservationForUpdate(
        transaction,
        context.organizationId,
        input.reservationId,
      );
      if (
        (reservation["pricing_authority"] === "model-provider-v1") !==
          (modelAuthority !== undefined) ||
        (modelAuthority === undefined &&
          (chargingScenario === "model-preview-delivered-v1" ||
            chargingScenario === "model-evaluation-recorded-v2"))
      ) {
        return fail(
          "access-denied",
          "Model reservations require verified model terminal accounting.",
        );
      }
      if (
        readString(reservation.charging_policy_version) !==
        input.chargingPolicyVersion
      ) {
        return fail(
          "invalid-input",
          "The charging policy does not match the reservation.",
        );
      }
      if (
        "requestId" in input &&
        readString(reservation.request_id) !== input.requestId
      ) {
        return fail(
          "invalid-input",
          "The request does not match the reservation.",
        );
      }
      if (
        metrics.modelId !== undefined &&
        (readString(reservation.model_key) !== metrics.modelId ||
          readString(reservation.model_version) !== metrics.modelVersion ||
          readString(reservation.provider_key) !== metrics.providerKey)
      ) {
        return fail(
          "invalid-input",
          "Provider usage evidence does not match the reservation.",
        );
      }
      if (
        "pricingVersionId" in input &&
        readString(reservation.pricing_version_id) !== input.pricingVersionId
      ) {
        return fail(
          "invalid-input",
          "The pricing version does not match the reservation.",
        );
      }
      let normalizedProviderCredits: bigint | undefined;
      const hasProviderEvidence = metrics.modelId !== undefined;
      if (modelAuthority !== undefined) {
        await modelAuthority.assertCurrent(transaction);
        const actual = unsignedInteger(modelAuthority.actualCreditUnits);
        normalizedProviderCredits =
          hasProviderEvidence || transition.kind === "settlement"
            ? actual
            : undefined;
        if (
          transition.kind === "expiration" ||
          (!hasProviderEvidence &&
            transition.kind !== "settlement" &&
            actual !== 0n) ||
          (transition.kind === "settlement" &&
            transition.normalizedCreditUnits !== actual)
        )
          return fail(
            "invalid-input",
            "The model terminal normalization is contradictory.",
          );
      } else if (transition.kind === "settlement" || hasProviderEvidence) {
        const pricing = await transaction.query<
          SqlRow & {
            readonly cached_input_micros_per_million_tokens: unknown;
            readonly cost_currency: unknown;
            readonly credit_conversion_denominator: unknown;
            readonly credit_conversion_numerator: unknown;
            readonly input_micros_per_million_tokens: unknown;
            readonly output_micros_per_million_tokens: unknown;
          }
        >(
          sql(
            `SELECT cost_currency, input_micros_per_million_tokens,
                    output_micros_per_million_tokens,
                    cached_input_micros_per_million_tokens,
                    credit_conversion_numerator,
                    credit_conversion_denominator
             FROM provider_pricing_versions
             WHERE pricing_version_id = $1
               AND provider_key = $2
               AND model_key = $3
               AND model_version = $4
               AND effective_from <= $5::timestamptz
               AND (effective_until IS NULL OR effective_until > $5::timestamptz)`,
            [
              readString(reservation.pricing_version_id),
              readString(reservation.provider_key),
              readString(reservation.model_key),
              readString(reservation.model_version),
              readString(reservation.created_at),
            ],
          ),
        );
        const pricingRow = pricing.rows[0];
        if (pricingRow === undefined) {
          return fail(
            "invalid-input",
            "The captured pricing version was not effective for the reservation.",
          );
        }
        const inputTokens = unsignedInteger(metrics.inputTokenCount ?? "0");
        const outputTokens = unsignedInteger(metrics.outputTokenCount ?? "0");
        const cachedTokens = unsignedInteger(
          metrics.cachedInputTokenCount ?? "0",
        );
        const cachedRate =
          pricingRow.cached_input_micros_per_million_tokens === null ||
          pricingRow.cached_input_micros_per_million_tokens === undefined
            ? undefined
            : readInteger(pricingRow.cached_input_micros_per_million_tokens);
        if (cachedTokens > 0n && cachedRate === undefined) {
          return fail("invalid-input", "Cached input usage is not priced.");
        }
        const costNumerator =
          inputTokens *
            readInteger(pricingRow.input_micros_per_million_tokens) +
          outputTokens *
            readInteger(pricingRow.output_micros_per_million_tokens) +
          cachedTokens * (cachedRate ?? 0n);
        const providerCost = ceilDivide(costNumerator, 1_000_000n);
        const normalizedCredits =
          providerCost === 0n
            ? 0n
            : ceilDivide(
                providerCost *
                  readInteger(pricingRow.credit_conversion_numerator),
                readInteger(pricingRow.credit_conversion_denominator),
              );
        normalizedProviderCredits = normalizedCredits;
        if (
          providerCost > postgresBigintMaximum ||
          normalizedCredits > postgresBigintMaximum ||
          metrics.estimatedProviderCostMicros === undefined ||
          unsignedInteger(metrics.estimatedProviderCostMicros) !==
            providerCost ||
          metrics.providerCostCurrency !==
            readString(pricingRow.cost_currency).trim() ||
          (transition.kind === "settlement" &&
            transition.normalizedCreditUnits !== normalizedCredits)
        ) {
          return fail(
            "invalid-input",
            "Settlement does not match deterministic pricing normalization.",
          );
        }
      }
      const ledgerIdentity = await transaction.query<UsageRow>(
        sql(
          `${usageSelect}
           WHERE organization_id = $1
             AND (ledger_entry_id = $2 OR idempotency_key_sha256 = $3)
           FOR UPDATE`,
          [context.organizationId, input.ledgerEntryId, keySha256],
        ),
      );
      const existingLedger = ledgerIdentity.rows[0];
      if (
        existingLedger !== undefined &&
        (readString(existingLedger.ledger_entry_id) !== input.ledgerEntryId ||
          readString(existingLedger.idempotency_key_sha256) !== keySha256 ||
          readOptionalString(existingLedger.reservation_id) !==
            input.reservationId)
      ) {
        return fail(
          "idempotency-conflict",
          "The terminal ledger identity conflicts with an existing event.",
        );
      }
      const currentStatus = readString(reservation.status);
      if (currentStatus !== "active") {
        if (
          currentStatus === targetStatus &&
          readOptionalString(reservation.terminal_request_sha256) ===
            input.requestSha256 &&
          readOptionalString(reservation.terminal_idempotency_key_sha256) ===
            keySha256 &&
          readOptionalString(reservation.terminal_ledger_entry_id) ===
            input.ledgerEntryId &&
          readOptionalString(reservation.terminal_payload_sha256) ===
            payloadSha256
        ) {
          if (existingLedger === undefined) {
            return fail(
              "idempotency-conflict",
              "The terminal ledger evidence is missing.",
            );
          }
          return mapReservation(transaction, reservation);
        }
        return fail(
          "reservation-terminal",
          "The credit reservation already has a terminal outcome.",
        );
      }
      if (transition.kind === "expiration" && reservation.is_expired !== true) {
        return fail(
          "version-conflict",
          "The credit reservation has not reached its expiration time.",
        );
      }
      if (existingLedger !== undefined) {
        return fail(
          "idempotency-conflict",
          "The terminal ledger identity conflicts with an active reservation.",
        );
      }

      const reserved = readInteger(reservation.reserved_credit_units);
      const settled =
        transition.kind === "settlement"
          ? transition.customerChargeCreditUnits
          : 0n;
      if (settled > reserved) {
        return fail(
          "invalid-input",
          "Settlement cannot exceed the accepted reservation.",
        );
      }
      if (transition.kind === "settlement") {
        const settlementInput = input as SettleCreditReservationInput;
        const expectedCharge =
          settlementInput.chargingScenario === "beta-ai-output-delivered-v1" ||
          settlementInput.chargingScenario ===
            "proposal-delivered-user-rejected"
            ? transition.normalizedCreditUnits
            : transition.normalizedCreditUnits < reserved
              ? transition.normalizedCreditUnits
              : reserved;
        if (settled !== expectedCharge) {
          return fail(
            "invalid-input",
            "The customer charge does not match the typed charging scenario.",
          );
        }
      }

      const allocations = await transaction.query<AllocationRow>(
        sql(
          `SELECT a.credit_grant_id, a.allocation_sequence,
                  a.reserved_credit_units, a.settled_credit_units
           FROM credit_reservation_allocations a
           WHERE a.organization_id = $1 AND a.reservation_id = $2
           ORDER BY a.allocation_sequence
           FOR UPDATE`,
          [context.organizationId, input.reservationId],
        ),
      );
      if (transition.kind === "settlement") {
        let remaining = settled;
        for (const allocation of allocations.rows) {
          const reservedForGrant = readInteger(
            allocation.reserved_credit_units,
          );
          const settledForGrant =
            remaining < reservedForGrant ? remaining : reservedForGrant;
          await transaction.query(
            sql(
              `UPDATE credit_reservation_allocations
               SET settled_credit_units = $1
               WHERE organization_id = $2 AND reservation_id = $3
                 AND credit_grant_id = $4 AND settled_credit_units = 0`,
              [
                settledForGrant,
                context.organizationId,
                input.reservationId,
                readString(allocation.credit_grant_id),
              ],
            ),
          );
          remaining -= settledForGrant;
        }
        if (remaining !== 0n) {
          return fail(
            "version-conflict",
            "The reservation allocations do not match the reservation.",
          );
        }
      }

      const released =
        transition.kind === "settlement"
          ? reserved - settled
          : transition.kind === "release"
            ? reserved
            : 0n;
      const expired = transition.kind === "expiration" ? reserved : 0n;
      const releaseInput =
        transition.kind === "release"
          ? (input as ReleaseCreditReservationInput)
          : undefined;
      const providerFailure =
        releaseInput?.chargingScenario ===
        "provider-failure-before-useful-output";
      const internalFailure =
        releaseInput?.chargingScenario === "cloudmarkup-internal-failure";
      const entryKind = providerFailure
        ? "provider-failure"
        : internalFailure
          ? "release"
          : transition.kind;
      const outcome =
        transition.kind === "settlement"
          ? "useful-output-delivered"
          : providerFailure
            ? "provider-failure"
            : internalFailure
              ? "internal-failure"
              : transition.kind === "release"
                ? "canceled"
                : "expired";
      const reasonCode =
        transition.kind === "expiration"
          ? "reservation.expired"
          : (
              input as
                SettleCreditReservationInput | ReleaseCreditReservationInput
            ).reasonCode;
      const safeReason = releaseInput?.safeReason ?? null;

      await transaction.query(
        sql(
          `INSERT INTO usage_ledger_entries (
             organization_id, ledger_entry_id, idempotency_key_sha256,
             entry_kind, billing_account_id, reservation_id,
             acting_principal_id, recorded_by_actor_kind,
             recorded_by_actor_id, project_id, feature_key, request_id,
             job_id, plan_version_id, pricing_version_id, provider_key,
             model_key, model_version, provider_request_id, input_token_count,
             output_token_count, cached_input_token_count,
             latency_milliseconds, estimated_provider_cost_micros,
             provider_cost_currency, normalized_credit_units,
             settled_credit_units,
             released_credit_units, expired_credit_units, outcome,
             reason_code, safe_reason, charging_scenario, entitlement_policy_version,
             charging_policy_version, correlation_id${modelAuthority === undefined ? "" : ", pricing_authority"}
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, 'internal-accounting',
             $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
             $28, $29, $30, $31, $32, $33, $34, $35${modelAuthority === undefined ? "" : ", $36"}
           )`,
          [
            context.organizationId,
            input.ledgerEntryId,
            keySha256,
            entryKind,
            readString(account.billing_account_id),
            input.reservationId,
            readString(reservation.acting_principal_id),
            context.actorId,
            readOptionalString(reservation.project_id) ?? null,
            readString(reservation.feature_key),
            readString(reservation.request_id),
            readOptionalString(reservation.job_id) ?? null,
            readString(reservation.plan_version_id),
            readString(reservation.pricing_version_id),
            readString(reservation.provider_key),
            readString(reservation.model_key),
            readString(reservation.model_version),
            metrics.providerRequestId ?? null,
            metrics.inputTokenCount === undefined
              ? null
              : unsignedInteger(metrics.inputTokenCount),
            metrics.outputTokenCount === undefined
              ? null
              : unsignedInteger(metrics.outputTokenCount),
            metrics.cachedInputTokenCount === undefined
              ? null
              : unsignedInteger(metrics.cachedInputTokenCount),
            metrics.latencyMilliseconds === undefined
              ? null
              : unsignedInteger(metrics.latencyMilliseconds),
            metrics.estimatedProviderCostMicros === undefined
              ? null
              : unsignedInteger(metrics.estimatedProviderCostMicros),
            metrics.providerCostCurrency ?? null,
            normalizedProviderCredits ?? null,
            settled,
            released,
            expired,
            outcome,
            reasonCode,
            safeReason,
            chargingScenario ?? null,
            readString(reservation.entitlement_policy_version),
            readString(reservation.charging_policy_version),
            context.correlationId,
            ...(modelAuthority === undefined ? [] : ["model-provider-v1"]),
          ],
        ),
      );
      let remainingSettlement = settled;
      for (const allocation of allocations.rows) {
        const reservedForGrant = readInteger(allocation.reserved_credit_units);
        const settledForGrant =
          transition.kind === "settlement"
            ? remainingSettlement < reservedForGrant
              ? remainingSettlement
              : reservedForGrant
            : 0n;
        if (transition.kind === "settlement") {
          remainingSettlement -= settledForGrant;
        }
        const releasedForGrant =
          transition.kind === "settlement"
            ? reservedForGrant - settledForGrant
            : transition.kind === "release"
              ? reservedForGrant
              : 0n;
        const expiredForGrant =
          transition.kind === "expiration" ? reservedForGrant : 0n;
        await transaction.query(
          sql(
            `INSERT INTO usage_ledger_entry_allocations (
               organization_id, ledger_entry_id, allocation_sequence,
               credit_grant_id, settled_credit_units,
               released_credit_units, expired_credit_units
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              context.organizationId,
              input.ledgerEntryId,
              readInteger(allocation.allocation_sequence),
              readString(allocation.credit_grant_id),
              settledForGrant,
              releasedForGrant,
              expiredForGrant,
            ],
          ),
        );
      }

      await modelAuthority?.assertCurrent(transaction);
      const updated = await transaction.query<ReservationRow>(
        sql(
          `UPDATE credit_reservations
           SET status = $1, terminal_request_sha256 = $2,
               terminal_idempotency_key_sha256 = $3,
               terminal_ledger_entry_id = $4,
               terminal_payload_sha256 = $7,
               terminal_at = CURRENT_TIMESTAMP,
               record_version = record_version + 1
           WHERE organization_id = $5 AND reservation_id = $6
             AND status = 'active'
           RETURNING reservation_id, organization_id, billing_account_id,
                     entitlement_snapshot_id, entitlement_policy_version,
                     plan_version_id, pricing_version_id,
                     charging_policy_version, acting_principal_id, project_id,
                     feature_key, request_id, job_id, provider_key, model_key,
                     model_version, requested_credit_units,
                     reserved_credit_units, status, request_sha256,
                     idempotency_key_sha256, terminal_request_sha256,
                     terminal_idempotency_key_sha256,
                     terminal_ledger_entry_id, terminal_payload_sha256,
                     record_version, created_at,
                     expires_at, terminal_at`,
          [
            targetStatus,
            input.requestSha256,
            keySha256,
            input.ledgerEntryId,
            context.organizationId,
            input.reservationId,
            payloadSha256,
          ],
        ),
      );
      const row = updated.rows[0];
      if (row === undefined) {
        return fail(
          "version-conflict",
          "The reservation changed before the terminal transition completed.",
        );
      }
      return mapReservation(transaction, row);
    });
  }

  async appendCompensatingAdjustment(
    context: TrustedCommercialAdministrationContext,
    input: AppendCreditAdjustmentInput,
  ): Promise<UsageLedgerEntryRecord> {
    assertAdministrationContext(context);
    assertPolicyVersion(input.chargingPolicyVersion);
    assertIdentifier(input.ledgerEntryId);
    assertIdentifier(input.relatedLedgerEntryId);
    if (!reasonCodePattern.test(input.reasonCode)) {
      return fail("invalid-input", "The adjustment reason code is invalid.");
    }
    assertBounded(input.safeReason, 300);
    const adjustment = signedInteger(input.adjustmentCreditUnits, true);
    if (input.creditGrantId !== undefined) {
      assertIdentifier(input.creditGrantId);
      if (adjustment > 0n)
        return fail("invalid-input", "Only a debit can select a grant.");
    }
    const keySha256 = hashIdempotencyKey(input.idempotencyKey);

    return this.#database.transaction(async (transaction) => {
      const account = await lockBillingAccount(
        transaction,
        context.organizationId,
      );
      await lockUsageLedgerIdentity(
        transaction,
        context.organizationId,
        input.ledgerEntryId,
        keySha256,
      );
      const existing = await transaction.query<UsageRow>(
        sql(
          `${usageSelect}
           WHERE organization_id = $1
             AND (idempotency_key_sha256 = $2 OR ledger_entry_id = $3)
           FOR UPDATE`,
          [context.organizationId, keySha256, input.ledgerEntryId],
        ),
      );
      const replay = existing.rows[0];
      if (replay !== undefined) {
        const replayAllocations = await loadUsageAllocations(
          transaction,
          context.organizationId,
          input.ledgerEntryId,
        );
        const positiveGrant = deterministicAdjustmentGrantIdentity(
          input.ledgerEntryId,
        );
        const replayTotal = replayAllocations.reduce(
          (total, allocation) =>
            total + signedInteger(allocation.creditAdjustmentUnits, true),
          0n,
        );
        const allocationConflict =
          (input.creditGrantId !== undefined &&
            replayAllocations.some(
              (allocation) => allocation.creditGrantId !== input.creditGrantId,
            )) ||
          replayAllocations.length < 1 ||
          replayTotal !== adjustment ||
          replayAllocations.some(
            (allocation, index) =>
              allocation.allocationSequence !== (index + 1).toString() ||
              signedInteger(allocation.creditAdjustmentUnits, true) > 0n !==
                adjustment > 0n,
          ) ||
          (adjustment > 0n &&
            (replayAllocations.length !== 1 ||
              replayAllocations[0]?.creditGrantId !== positiveGrant.grantId));
        if (
          readString(replay.ledger_entry_id) !== input.ledgerEntryId ||
          readOptionalString(replay.related_ledger_entry_id) !==
            input.relatedLedgerEntryId ||
          readOptionalString(replay.credit_grant_id) !== undefined ||
          readOptionalString(replay.acting_principal_id) !== undefined ||
          readString(replay.entry_kind) !== "adjustment" ||
          readString(replay.recorded_by_actor_kind) !==
            "internal-administration" ||
          readString(replay.recorded_by_actor_id) !== context.actorId ||
          readDecimal(replay.credit_adjustment_units) !==
            adjustment.toString() ||
          readString(replay.outcome) !==
            (adjustment > 0n ? "compensated" : "adjusted") ||
          readString(replay.charging_policy_version) !==
            input.chargingPolicyVersion ||
          readString(replay.reason_code) !== input.reasonCode ||
          readString(replay.safe_reason) !== input.safeReason ||
          allocationConflict
        ) {
          return fail(
            "idempotency-conflict",
            "The adjustment idempotency key was reused.",
          );
        }
        return { ...mapUsage(replay), allocations: replayAllocations };
      }

      const related = await transaction.query<UsageRow>(
        sql(
          `${usageSelect}
           WHERE organization_id = $1 AND ledger_entry_id = $2`,
          [context.organizationId, input.relatedLedgerEntryId],
        ),
      );
      const relatedRow = related.rows[0];
      if (relatedRow === undefined) {
        return fail("not-found", "The adjustment source is not available.");
      }
      const allocations: {
        readonly adjustmentCreditUnits: string;
        readonly creditGrantId: string;
      }[] = [];
      if (adjustment > 0n) {
        const grant = deterministicAdjustmentGrantIdentity(input.ledgerEntryId);
        const createdGrant = await transaction.query(
          sql(
            `INSERT INTO credit_grants (
               credit_grant_id, organization_id, billing_account_id,
               grant_kind, credit_units, starts_at, expiration_policy_kind,
               expiration_policy_version, consumption_priority,
               source_reference, grant_policy_version,
               idempotency_key_sha256, created_by_actor_kind,
               created_by_actor_id, created_by_principal_id
             ) VALUES (
               $1, $2, $3, 'administrative', $4, CURRENT_TIMESTAMP,
               'does-not-expire', 'cloudmarkup-administrative-expiration-v1',
               2147483647, $5, 'cloudmarkup-administrative-adjustments-v1',
               $6, 'internal-administration', $7, $8
             )
             RETURNING credit_grant_id`,
            [
              grant.grantId,
              context.organizationId,
              readString(account.billing_account_id),
              adjustment,
              input.ledgerEntryId,
              grant.idempotencySha256,
              context.actorId,
              context.actorPrincipalId,
            ],
          ),
        );
        if (createdGrant.rows.length !== 1) {
          return fail(
            "idempotency-conflict",
            "The adjustment grant conflicts.",
          );
        }
        allocations.push({
          adjustmentCreditUnits: adjustment.toString(),
          creditGrantId: grant.grantId,
        });
      } else {
        const grants = await transaction.query<AvailableGrantRow>(
          sql(
            `SELECT g.credit_grant_id, g.organization_id, g.billing_account_id,
                    g.plan_version_id, g.grant_kind, g.credit_units,
                    g.starts_at, g.expires_at, g.consumption_priority,
                    g.source_reference,
                    (CASE WHEN g.grant_kind = 'administrative'
                      THEN 0 ELSE g.credit_units END)
                      - COALESCE((
                          SELECT SUM(a.settled_credit_units)
                          FROM credit_reservation_allocations a
                          JOIN credit_reservations r
                            ON r.organization_id = a.organization_id
                           AND r.reservation_id = a.reservation_id
                          WHERE a.organization_id = g.organization_id
                            AND a.credit_grant_id = g.credit_grant_id
                            AND r.status = 'settled'
                        ), 0)
                      - COALESCE((
                          SELECT SUM(a.reserved_credit_units)
                          FROM credit_reservation_allocations a
                          JOIN credit_reservations r
                            ON r.organization_id = a.organization_id
                           AND r.reservation_id = a.reservation_id
                          WHERE a.organization_id = g.organization_id
                            AND a.credit_grant_id = g.credit_grant_id
                            AND r.status = 'active'
                        ), 0)
                      + COALESCE((
                          SELECT SUM(allocation.credit_adjustment_units)
                          FROM usage_ledger_entry_allocations allocation
                          WHERE allocation.organization_id = g.organization_id
                            AND allocation.credit_grant_id = g.credit_grant_id
                        ), 0) AS available_credit_units
             FROM credit_grants g
             WHERE g.organization_id = $1
               AND ($2::text IS NULL OR g.credit_grant_id = $2)
               AND g.starts_at <= CURRENT_TIMESTAMP
               AND g.expiration_policy_kind <> 'unresolved'
               AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
             ORDER BY g.expires_at NULLS LAST, g.consumption_priority,
                      g.starts_at, g.credit_grant_id
             FOR UPDATE OF g`,
            [context.organizationId, input.creditGrantId ?? null],
          ),
        );
        let remaining = -adjustment;
        for (const grant of grants.rows) {
          const available = readInteger(grant.available_credit_units);
          if (available <= 0n) continue;
          const units = available < remaining ? available : remaining;
          allocations.push({
            adjustmentCreditUnits: (-units).toString(),
            creditGrantId: readString(grant.credit_grant_id),
          });
          remaining -= units;
          if (remaining === 0n) break;
        }
        if (remaining !== 0n) {
          return fail(
            "insufficient-credits",
            "The negative adjustment exceeds eligible available credits.",
          );
        }
      }

      const result = await transaction.query<UsageRow>(
        sql(
          `INSERT INTO usage_ledger_entries (
             organization_id, ledger_entry_id, idempotency_key_sha256,
             entry_kind, billing_account_id, related_ledger_entry_id,
             recorded_by_actor_kind, recorded_by_actor_id,
             credit_adjustment_units, charging_policy_version, outcome,
             reason_code, safe_reason, correlation_id
           ) VALUES (
             $1, $2, $3, 'adjustment', $4, $5,
             'internal-administration', $6, $7, $8, $9, $10, $11, $12
           )
           RETURNING *`,
          [
            context.organizationId,
            input.ledgerEntryId,
            keySha256,
            readString(account.billing_account_id),
            input.relatedLedgerEntryId,
            context.actorId,
            adjustment,
            input.chargingPolicyVersion,
            adjustment > 0n ? "compensated" : "adjusted",
            input.reasonCode,
            input.safeReason,
            context.correlationId,
          ],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        return fail("not-found", "The adjustment could not be recorded.");
      }
      const persistedAllocations: UsageLedgerAllocationRecord[] = [];
      for (const [index, allocation] of allocations.entries()) {
        const allocationSequence = index + 1;
        await transaction.query(
          sql(
            `INSERT INTO usage_ledger_entry_allocations (
               organization_id, ledger_entry_id, allocation_sequence,
               credit_grant_id, credit_adjustment_units
             ) VALUES ($1, $2, $3, $4, $5)`,
            [
              context.organizationId,
              input.ledgerEntryId,
              allocationSequence,
              allocation.creditGrantId,
              signedInteger(allocation.adjustmentCreditUnits, true),
            ],
          ),
        );
        persistedAllocations.push({
          allocationSequence: allocationSequence.toString(),
          creditAdjustmentUnits: allocation.adjustmentCreditUnits,
          creditGrantId: allocation.creditGrantId,
          expiredCreditUnits: "0",
          releasedCreditUnits: "0",
          reservedCreditUnits: "0",
          settledCreditUnits: "0",
        });
      }
      return { ...mapUsage(row), allocations: persistedAllocations };
    });
  }

  async getCreditBalance(
    scope: AuthorizedOrganizationScope,
  ): Promise<CreditBalanceRecord> {
    assertHumanScope(scope);
    requireScopePermission(scope, "commercial.summary.read");
    await requireHumanScope(
      this.#database,
      scope,
      "commercial.summary.read",
      true,
    );
    return currentBalance(this.#database, scope.organizationId, scope);
  }

  async getCreditOverview(
    scope: AuthorizedOrganizationScope,
  ): Promise<CreditOverviewRecord> {
    assertHumanScope(scope);
    requireScopePermission(scope, "commercial.summary.read");
    await requireHumanScope(
      this.#database,
      scope,
      "commercial.summary.read",
      true,
    );
    const row = await currentCreditRow(
      this.#database,
      scope.organizationId,
      scope,
    );
    const at = readOptionalString(row["next_expiration_at"]);
    const units = readDecimal(row["next_expiration_units"]);
    if ((at === undefined) !== (units === "0"))
      return fail("invalid-input", "The expiration evidence is invalid.");
    return {
      balance: mapCreditBalanceRow(row, scope.organizationId),
      availableByKind: {
        monthly: readDecimal(row["monthly_available"]),
        purchased: readDecimal(row["purchased_available"]),
        other: readDecimal(row["other_available"]),
      },
      nextExpiration: at === undefined ? null : { at, creditUnits: units },
    };
  }

  async getCurrentPlanEntitlements(
    scope: AuthorizedOrganizationScope,
  ): Promise<CurrentPlanEntitlementsRecord> {
    assertHumanScope(scope);
    requireScopePermission(scope, "commercial.summary.read");
    return this.#database.transaction(async (transaction) => {
      await transaction.query(
        sql("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"),
      );
      await requireHumanScope(
        transaction,
        scope,
        "commercial.summary.read",
        true,
      );
      const main = await transaction.query<
        SqlRow & {
          readonly account_expensive_operations_enabled: unknown;
          readonly as_of: unknown;
          readonly billing_account_state: unknown;
          readonly cancel_at_period_end: unknown;
          readonly current_period_end: unknown;
          readonly current_period_start: unknown;
          readonly display_name: unknown;
          readonly effective_from: unknown;
          readonly effective_until: unknown;
          readonly normalized_status: unknown;
          readonly organization_id: unknown;
          readonly organization_state: unknown;
          readonly plan_id: unknown;
          readonly plan_key: unknown;
          readonly plan_version_id: unknown;
          readonly price_currency: unknown;
          readonly proposed_monthly_price_micros: unknown;
          readonly snapshot_expensive_operations_enabled: unknown;
          readonly subscription_projection_id: unknown;
          readonly subscription_record_version: unknown;
          readonly version_number: unknown;
        }
      >(
        sql(
          `SELECT CURRENT_TIMESTAMP AS as_of,
                  organization.organization_id,
                  organization.lifecycle_status AS organization_state,
                  account.lifecycle_status AS billing_account_state,
                  account.expensive_operations_enabled
                    AS account_expensive_operations_enabled,
                  snapshot.expensive_operations_enabled
                    AS snapshot_expensive_operations_enabled,
                  definition.plan_id, definition.plan_key,
                  definition.display_name, version.plan_version_id,
                  version.version_number, version.effective_from,
                  version.effective_until,
                  version.proposed_monthly_price_micros,
                  version.price_currency,
                  subscription.subscription_projection_id,
                  subscription.cancel_at_period_end,
                  subscription.normalized_status,
                  subscription.current_period_start,
                  subscription.current_period_end,
                  subscription.record_version AS subscription_record_version,
                  cloudmarkup_staff_credit_access_v1(account.organization_id,account.billing_account_id) AS staff_credit_current
           FROM memberships requester
           JOIN principals principal
             ON principal.principal_id = requester.principal_id
           JOIN organizations organization
             ON organization.organization_id = requester.organization_id
           JOIN organization_billing_accounts account
             ON account.organization_id = requester.organization_id
           JOIN organization_effective_entitlement_snapshots_v1 snapshot
             ON snapshot.organization_id = requester.organization_id
            AND snapshot.billing_account_id = account.billing_account_id
           LEFT JOIN organization_subscription_projections subscription
             ON subscription.organization_id = snapshot.organization_id
            AND subscription.subscription_projection_id =
                snapshot.subscription_projection_id
           JOIN commercial_plan_versions version
             ON version.plan_version_id = snapshot.plan_version_id
           JOIN commercial_plan_definitions definition
             ON definition.plan_id = version.plan_id
           WHERE requester.membership_id = $1
             AND requester.principal_id = $2
             AND requester.organization_id = $3
             AND requester.lifecycle_status = 'active'
             AND principal.lifecycle_status = 'active'
             AND organization.lifecycle_status IN ('active', 'suspended')
             AND version.configuration_status = 'proposed-beta-example'
             AND snapshot.effective_at <= CURRENT_TIMESTAMP
             AND version.effective_from <= CURRENT_TIMESTAMP
             AND (version.effective_until IS NULL
               OR version.effective_until > CURRENT_TIMESTAMP)
             AND ((snapshot.subscription_projection_id IS NOT NULL
             AND snapshot.source_record_version = subscription.record_version
             AND snapshot.plan_version_id = subscription.plan_version_id)
             OR (snapshot.subscription_projection_id IS NULL AND snapshot.plan_version_id IN ('planver_staff_trial_2026_10_06_v1','planver_staff_credits_2026_10_15_v1')))`,
          [scope.membershipId, scope.principalId, scope.organizationId],
        ),
      );
      const row = main.rows[0];
      if (row === undefined) {
        return fail("access-denied", "Access is not available.");
      }
      const planVersionId = readString(row.plan_version_id);
      const subscriptionProjectionId = readOptionalString(
        row.subscription_projection_id,
      );
      const accountState = readCommercialState(row.billing_account_state, [
        "active",
        "suspended",
        "closed",
      ] as const);
      const organizationState = readCommercialState(row.organization_state, [
        "active",
        "suspended",
      ] as const);
      const trial =
        planVersionId === STAFF_TRIAL_PLAN_VERSION
          ? (
              await transaction.query(
                sql(
                  "SELECT trial_id,expires_at,revoked_action_id,cloudmarkup_staff_trial_current_v1(organization_id,billing_account_id) AS trial_current FROM platform_staff_trials WHERE organization_id=$1",
                  [scope.organizationId],
                ),
              )
            ).rows[0]
          : undefined;
      if (planVersionId === STAFF_TRIAL_PLAN_VERSION && trial === undefined)
        return fail(
          "access-denied",
          "Independent trial authority is unavailable.",
        );
      const accessIsActive =
        (subscriptionProjectionId !== undefined &&
          readString(row.normalized_status) === "active") ||
        (planVersionId === STAFF_TRIAL_PLAN_VERSION &&
          trial?.["trial_current"] === true) ||
        (planVersionId === "planver_staff_credits_2026_10_15_v1" &&
          row["staff_credit_current"] === true);
      const expensiveOperationsEnabled =
        organizationState === "active" &&
        accountState === "active" &&
        accessIsActive &&
        readBoolean(row.account_expensive_operations_enabled) &&
        readBoolean(row.snapshot_expensive_operations_enabled);
      const features = await transaction.query<
        SqlRow & {
          readonly entitlement_state: unknown;
          readonly feature_key: unknown;
        }
      >(
        sql(
          `SELECT feature_key, entitlement_state
           FROM commercial_plan_feature_entitlements
           WHERE plan_version_id = $1 ORDER BY feature_key`,
          [planVersionId],
        ),
      );
      const entitlements = features.rows.map((feature) => {
        const featureKey = readString(feature.feature_key);
        const configuredEnabled = ["enabled", "limited"].includes(
          readString(feature.entitlement_state),
        );
        const killed =
          configuredEnabled &&
          isExpensiveCommercialFeature(featureKey as CommercialFeatureKey) &&
          !expensiveOperationsEnabled;
        return {
          enabled: configuredEnabled && !killed,
          feature: featureKey,
          source: killed ? ("kill-switch" as const) : ("plan" as const),
        };
      });
      const limitsResult = await transaction.query<
        SqlRow & {
          readonly limit_key: unknown;
          readonly limit_scope: unknown;
          readonly limit_value: unknown;
          readonly period_kind: unknown;
        }
      >(
        sql(
          `SELECT limit_key, limit_scope, period_kind, limit_value
           FROM commercial_plan_numeric_limits
           WHERE plan_version_id = $1 ORDER BY limit_scope, limit_key`,
          [planVersionId],
        ),
      );
      const limits = limitsResult.rows.map((limit) => {
        const key = readString(limit.limit_key);
        return {
          key,
          maximum: readDecimal(limit.limit_value),
          period: readCommercialState(limit.period_kind, [
            "none",
            "subscription-period",
            "calendar-month",
            "rolling-day",
          ] as const),
          scope: readCommercialState(limit.limit_scope, [
            "organization",
            "member",
            "project",
          ] as const),
          unit:
            key === "billable-seats" || key === "viewers"
              ? ("seats" as const)
              : key === "concurrent-ai-jobs"
                ? ("jobs" as const)
                : key === "per-user-request-count"
                  ? ("requests" as const)
                  : key === "per-project-credit-cap"
                    ? ("credits" as const)
                    : ("count" as const),
        };
      });
      const effectiveUntil = readOptionalTimestamp(row.effective_until);
      const subscription =
        subscriptionProjectionId === undefined
          ? ({ state: "not-subscribed" } as const)
          : {
              cancelAtPeriodEnd: readBoolean(row.cancel_at_period_end),
              ...(readOptionalTimestamp(row.current_period_end) === undefined
                ? {}
                : {
                    currentPeriodEndsAt: readTimestamp(row.current_period_end),
                    currentPeriodStartsAt: readTimestamp(
                      row.current_period_start,
                    ),
                  }),
              projectionVersion: readDecimal(row.subscription_record_version),
              state: readCommercialState(row.normalized_status, [
                "pending",
                "active",
                "past-due",
                "paused",
                "canceled",
                "incomplete",
              ] as const),
            };
      return {
        ...(trial
          ? {
              trial: {
                id: readString(trial["trial_id"]),
                expiresAt: readTimestamp(trial["expires_at"]),
                state:
                  trial["revoked_action_id"] !== null
                    ? ("revoked" as const)
                    : trial["trial_current"] === true
                      ? ("active" as const)
                      : ("expired" as const),
              },
            }
          : {}),
        asOf: readTimestamp(row.as_of),
        billingAccountState: accountState,
        entitlements,
        expensiveOperationsEnabled,
        limits,
        organizationId: readString(row.organization_id),
        organizationState,
        plan: {
          commercialStatus: "proposed",
          displayName: readString(row.display_name),
          effectiveFrom: readTimestamp(row.effective_from),
          ...(effectiveUntil === undefined ? {} : { effectiveUntil }),
          id: readString(row.plan_id),
          key: readString(row.plan_key),
          price: {
            amountMicros: readDecimal(row.proposed_monthly_price_micros),
            billingInterval: "month",
            currency: readString(row.price_currency).trim(),
            status: "proposed",
          },
          version: readDecimal(row.version_number),
          versionId: planVersionId,
        },
        subscription,
      };
    });
  }

  async getCreditGrantExpirationSummary(
    scope: AuthorizedOrganizationScope,
    windowEndsAt: string,
  ): Promise<CreditGrantExpirationSummaryRecord> {
    assertHumanScope(scope);
    requireScopePermission(scope, "commercial.summary.read");
    assertTimestamp(windowEndsAt);
    return this.#database.transaction(async (transaction) => {
      await transaction.query(
        sql("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"),
      );
      await requireHumanScope(
        transaction,
        scope,
        "commercial.summary.read",
        true,
      );
      const access = await transaction.query<
        SqlRow & { readonly as_of: unknown }
      >(
        sql(
          `SELECT CURRENT_TIMESTAMP AS as_of
           FROM memberships membership
           JOIN principals principal ON principal.principal_id = membership.principal_id
           JOIN organizations organization
             ON organization.organization_id = membership.organization_id
           WHERE membership.membership_id = $1
             AND membership.principal_id = $2
             AND membership.organization_id = $3
             AND membership.lifecycle_status = 'active'
             AND principal.lifecycle_status = 'active'
             AND organization.lifecycle_status IN ('active', 'suspended')`,
          [scope.membershipId, scope.principalId, scope.organizationId],
        ),
      );
      const accessRow = access.rows[0];
      if (accessRow === undefined)
        return fail("access-denied", "Access is not available.");
      const asOf = readString(accessRow.as_of);
      if (Date.parse(windowEndsAt) <= Date.parse(asOf)) {
        return fail(
          "invalid-input",
          "The expiration summary window is invalid.",
        );
      }
      const result = await transaction.query<
        GrantRow & {
          readonly active_reserved: unknown;
          readonly adjustments: unknown;
          readonly settled: unknown;
        }
      >(
        sql(
          `WITH event_effects AS (
             SELECT allocation.credit_grant_id,
                    COALESCE(SUM(allocation.credit_adjustment_units), 0)
                      AS adjustments,
                    COALESCE(SUM(allocation.settled_credit_units), 0) AS settled
             FROM usage_ledger_entry_allocations allocation
             JOIN usage_ledger_entries event
               ON event.organization_id = allocation.organization_id
              AND event.ledger_entry_id = allocation.ledger_entry_id
             WHERE allocation.organization_id = $1
               AND event.occurred_at <= $2
             GROUP BY allocation.credit_grant_id
           ), active_reservations AS (
             SELECT allocation.credit_grant_id,
                    COALESCE(SUM(allocation.reserved_credit_units), 0) AS active_reserved
             FROM credit_reservation_allocations allocation
             JOIN credit_reservations reservation
               ON reservation.organization_id = allocation.organization_id
              AND reservation.reservation_id = allocation.reservation_id
             WHERE allocation.organization_id = $1
               AND reservation.created_at <= $2
               AND (reservation.terminal_at IS NULL
                 OR reservation.terminal_at > $2)
             GROUP BY allocation.credit_grant_id
           )
           SELECT ((grant_row.grant_policy_version <> 'cloudmarkup-staff-trial-v1' AND (grant_row.grant_policy_version='cloudmarkup-staff-credits-v1' OR NOT EXISTS(SELECT 1 FROM organization_entitlement_snapshots trial_snapshot WHERE trial_snapshot.organization_id=grant_row.organization_id AND trial_snapshot.plan_version_id='planver_staff_trial_2026_10_06_v1')))
                OR (grant_row.grant_policy_version='cloudmarkup-staff-trial-v1' AND grant_row.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM organization_entitlement_snapshots trial_snapshot WHERE trial_snapshot.organization_id=grant_row.organization_id AND trial_snapshot.plan_version_id='planver_staff_trial_2026_10_06_v1' AND trial_snapshot.subscription_projection_id IS NULL AND trial_snapshot.expensive_operations_enabled AND trial_snapshot.effective_at<=clock_timestamp()))) AS trial_grant_admitted, grant_row.credit_grant_id, grant_row.organization_id,
                  grant_row.billing_account_id, grant_row.plan_version_id,
                  grant_row.grant_kind, grant_row.credit_units,
                  grant_row.starts_at, grant_row.expires_at,
                  grant_row.expiration_policy_kind, grant_row.expiration_policy_version,
                  grant_row.subscription_period_id, grant_row.subscription_period_start,
                  grant_row.subscription_period_end, grant_row.consumption_priority,
                  grant_row.source_reference, grant_row.grant_policy_version,
                  COALESCE(event_effects.adjustments, 0) AS adjustments,
                  COALESCE(event_effects.settled, 0) AS settled,
                  COALESCE(active_reservations.active_reserved, 0) AS active_reserved
           FROM credit_grants grant_row
           LEFT JOIN event_effects USING (credit_grant_id)
           LEFT JOIN active_reservations USING (credit_grant_id)
           WHERE grant_row.organization_id = $1
             AND grant_row.created_at <= $2
           ORDER BY grant_row.expires_at NULLS LAST,
                    grant_row.starts_at, grant_row.credit_grant_id LIMIT 1000`,
          [scope.organizationId, asOf],
        ),
      );
      let expiring = 0n;
      let nextExpirationAt: string | undefined;
      const grants = result.rows.map((grant) => {
        const kind = readString(
          grant.grant_kind,
        ) as CreditGrantSummaryRecord["kind"];
        const adjustment = readInteger(grant.adjustments);
        const expirationKind = readString(grant.expiration_policy_kind);
        const expiresAt = readOptionalString(grant.expires_at);
        const startsAt = readString(grant.starts_at);
        const settled = readInteger(grant.settled);
        const reserved = readInteger(grant.active_reserved);
        const granted = readInteger(grant.credit_units);
        const baseGranted = kind === "administrative" ? 0n : granted;
        const funding = baseGranted + adjustment;
        const started = Date.parse(startsAt) <= Date.parse(asOf);
        const expired =
          expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(asOf);
        const unresolved = expirationKind === "unresolved";
        const remaining = funding - settled - reserved;
        const available =
          started &&
          !expired &&
          !unresolved &&
          grant["trial_grant_admitted"] === true &&
          remaining > 0n
            ? remaining
            : 0n;
        const expiredUnits =
          expired && !unresolved && remaining > 0n ? remaining : 0n;
        if (
          expiresAt !== undefined &&
          Date.parse(expiresAt) > Date.parse(asOf) &&
          Date.parse(expiresAt) <= Date.parse(windowEndsAt)
        ) {
          expiring += available;
          nextExpirationAt =
            nextExpirationAt === undefined ||
            Date.parse(expiresAt) < Date.parse(nextExpirationAt)
              ? expiresAt
              : nextExpirationAt;
        }
        if (expiring > postgresBigintMaximum) {
          return fail(
            "invalid-input",
            "The expiration summary exceeds storage bounds.",
          );
        }
        const expirationPolicyVersion = readOptionalString(
          grant.expiration_policy_version,
        );
        const planVersionId = readOptionalString(grant.plan_version_id);
        return {
          availableCreditUnits: available.toString(),
          adjustmentCreditUnits: adjustment.toString(),
          consumedCreditUnits: settled.toString(),
          consumptionPriority: readDecimal(grant.consumption_priority),
          expirationPolicy:
            expirationKind === "expires-at"
              ? ("fixed" as const)
              : expirationKind === "does-not-expire"
                ? ("none" as const)
                : ("undecided" as const),
          ...(expirationPolicyVersion === undefined
            ? {}
            : { expirationPolicyVersion }),
          ...(expiresAt === undefined ? {} : { expiresAt }),
          expiredCreditUnits: expiredUnits.toString(),
          fundingCreditUnits: funding.toString(),
          grantedCreditUnits: baseGranted.toString(),
          grantPolicyVersion: readString(grant.grant_policy_version),
          id: readString(grant.credit_grant_id),
          kind,
          ...(planVersionId === undefined ? {} : { planVersionId }),
          reservedCreditUnits: reserved.toString(),
          startsAt,
          status:
            unresolved || !started
              ? ("scheduled" as const)
              : expired
                ? ("expired" as const)
                : available === 0n && reserved === 0n
                  ? ("exhausted" as const)
                  : ("active" as const),
        };
      });
      return {
        asOf,
        expiringCreditUnits: expiring.toString(),
        grants,
        ...(nextExpirationAt === undefined ? {} : { nextExpirationAt }),
        organizationId: scope.organizationId,
        windowEndsAt,
      };
    });
  }
  async getSeatUsage(
    scope: AuthorizedOrganizationScope,
  ): Promise<SeatUsageRecord> {
    assertHumanScope(scope);
    requireScopePermission(scope, "commercial.summary.read");
    await requireHumanScope(
      this.#database,
      scope,
      "commercial.summary.read",
      true,
    );
    const result = await this.#database.query<
      SqlRow & {
        readonly administrator_count: unknown;
        readonly as_of: unknown;
        readonly billable_role_keys: unknown;
        readonly editor_count: unknown;
        readonly included_billable_seats: unknown;
        readonly maximum_billable_seats: unknown;
        readonly maximum_nonbillable_viewers: unknown;
        readonly organization_id: unknown;
        readonly owner_count: unknown;
        readonly plan_version_id: unknown;
        readonly viewer_count: unknown;
      }
    >(
      sql(
        `SELECT
           CURRENT_TIMESTAMP AS as_of,
           requester.organization_id,
           COUNT(counted.membership_id) FILTER (
             WHERE counted.lifecycle_status = 'active'
               AND counted.role_key = 'owner'
           ) AS owner_count,
           COUNT(counted.membership_id) FILTER (
             WHERE counted.lifecycle_status = 'active'
               AND counted.role_key = 'administrator'
           ) AS administrator_count,
           COUNT(counted.membership_id) FILTER (
             WHERE counted.lifecycle_status = 'active'
               AND counted.role_key = 'editor'
           ) AS editor_count,
           COUNT(counted.membership_id) FILTER (
             WHERE counted.lifecycle_status = 'active'
               AND counted.role_key = 'viewer'
           ) AS viewer_count,
           seats.billable_role_keys,
           seats.included_billable_seats,
           seats.maximum_billable_seats,
           seats.maximum_nonbillable_viewers,
           entitlement.plan_version_id
         FROM memberships requester
         JOIN principals principal
           ON principal.principal_id = requester.principal_id
         JOIN organizations organization
           ON organization.organization_id = requester.organization_id
         JOIN organization_billing_accounts account
           ON account.organization_id = requester.organization_id
         JOIN organization_effective_entitlement_snapshots_v1 entitlement
           ON entitlement.organization_id = requester.organization_id
          AND entitlement.billing_account_id = account.billing_account_id
         LEFT JOIN organization_subscription_projections subscription
           ON subscription.organization_id = entitlement.organization_id
          AND subscription.subscription_projection_id =
              entitlement.subscription_projection_id
         JOIN commercial_plan_seat_rules seats
           ON seats.plan_version_id = entitlement.plan_version_id
         JOIN commercial_plan_versions version
           ON version.plan_version_id = entitlement.plan_version_id
         LEFT JOIN memberships counted
           ON counted.organization_id = requester.organization_id
         WHERE requester.membership_id = $1
           AND requester.principal_id = $2
           AND requester.organization_id = $3
           AND requester.lifecycle_status = 'active'
           AND principal.lifecycle_status = 'active'
           AND organization.lifecycle_status IN ('active', 'suspended')
           AND version.configuration_status = 'proposed-beta-example'
           AND entitlement.effective_at <= CURRENT_TIMESTAMP
           AND version.effective_from <= CURRENT_TIMESTAMP
           AND (version.effective_until IS NULL
             OR version.effective_until > CURRENT_TIMESTAMP)
           AND (
             (entitlement.subscription_projection_id IS NULL
               AND ((entitlement.plan_version_id<>'planver_staff_trial_2026_10_06_v1' AND entitlement.source_record_version = account.record_version)
                 OR entitlement.plan_version_id IN ('planver_staff_trial_2026_10_06_v1','planver_staff_credits_2026_10_15_v1')))
             OR
             (entitlement.subscription_projection_id IS NOT NULL
               AND entitlement.source_record_version = subscription.record_version
               AND entitlement.plan_version_id = subscription.plan_version_id)
           )
         GROUP BY requester.organization_id, seats.plan_version_id,
                  seats.billable_role_keys, seats.included_billable_seats,
                  seats.maximum_billable_seats,
                  seats.maximum_nonbillable_viewers,
                  entitlement.plan_version_id`,
        [scope.membershipId, scope.principalId, scope.organizationId],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) {
      return fail("access-denied", "Access is not available.");
    }
    if (readString(row.plan_version_id) === STAFF_TRIAL_PLAN_VERSION) {
      const trial = await this.#database.query(
        sql(
          "SELECT cloudmarkup_staff_trial_current_v1(organization_id,billing_account_id) AS admitted FROM organization_billing_accounts WHERE organization_id=$1",
          [scope.organizationId],
        ),
      );
      if (trial.rows[0]?.["admitted"] !== true)
        return fail(
          "access-denied",
          "Independent trial authority is unavailable.",
        );
    }
    const billableCandidateRoles = readStringArray(row.billable_role_keys);
    if (
      JSON.stringify(billableCandidateRoles) !==
      JSON.stringify(["owner", "administrator", "editor"])
    ) {
      return fail(
        "invalid-input",
        "The database returned invalid commercial data.",
      );
    }
    const activeMembersByRole = {
      administrator: readDecimal(row.administrator_count),
      editor: readDecimal(row.editor_count),
      owner: readDecimal(row.owner_count),
      viewer: readDecimal(row.viewer_count),
    };
    const typedBillableCandidateRoles =
      billableCandidateRoles as SeatUsageRecord["billableCandidateRoles"];
    const billableSeatQuantity = typedBillableCandidateRoles
      .reduce((total, role) => total + BigInt(activeMembersByRole[role]), 0n)
      .toString();
    const billableSeatLimit = readDecimal(row.maximum_billable_seats);
    return {
      activeMembersByRole,
      asOf: readString(row.as_of),
      billableCandidateRoles: typedBillableCandidateRoles,
      billableSeatLimit,
      billableSeatQuantity,
      includedBillableSeatQuantity: readDecimal(row.included_billable_seats),
      organizationId: readString(row.organization_id),
      overBillableSeatLimit:
        BigInt(billableSeatQuantity) > BigInt(billableSeatLimit),
      pendingInvitationQuantityExcluded: "0",
      planVersionId: readString(row.plan_version_id),
      viewerLimit: readDecimal(row.maximum_nonbillable_viewers),
      viewerQuantity: activeMembersByRole.viewer,
    };
  }

  async getUsageEntry(
    scope: AuthorizedOrganizationScope,
    ledgerEntryId: string,
  ): Promise<UsageLedgerEntryRecord | null> {
    assertHumanScope(scope);
    requireScopePermission(scope, "usage.read-technical");
    assertIdentifier(ledgerEntryId);
    await requireHumanScope(
      this.#database,
      scope,
      "usage.read-technical",
      true,
    );
    const result = await this.#database.query<UsageRow>(
      sql(
        `${usageSelect}
         JOIN memberships m ON m.organization_id = usage_ledger_entries.organization_id
         JOIN principals p ON p.principal_id = m.principal_id
         JOIN organizations o ON o.organization_id = m.organization_id
         WHERE m.membership_id = $1 AND m.principal_id = $2
           AND m.organization_id = $3 AND m.lifecycle_status = 'active'
           AND p.lifecycle_status = 'active' AND o.lifecycle_status IN ('active', 'suspended')
           AND usage_ledger_entries.ledger_entry_id = $4`,
        [
          scope.membershipId,
          scope.principalId,
          scope.organizationId,
          ledgerEntryId,
        ],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      ...mapUsage(row),
      allocations: await loadUsageAllocations(
        this.#database,
        scope.organizationId,
        ledgerEntryId,
      ),
    };
  }

  async getUsageSummary(
    scope: AuthorizedOrganizationScope,
    from: string,
    until: string,
  ): Promise<UsageSummaryRecord> {
    assertHumanScope(scope);
    requireScopePermission(scope, "commercial.summary.read");
    assertTimestamp(from);
    assertTimestamp(until);
    if (Date.parse(until) <= Date.parse(from)) {
      return fail("invalid-input", "The usage summary interval is invalid.");
    }
    return this.#database.transaction(async (transaction) => {
      await transaction.query(
        sql("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"),
      );
      await requireHumanScope(
        transaction,
        scope,
        "commercial.summary.read",
        true,
      );
      const result = await transaction.query<
        SqlRow & {
          readonly as_of: unknown;
          readonly compensated: unknown;
          readonly compensated_events: unknown;
          readonly debit_adjustments: unknown;
          readonly net_adjustments: unknown;
          readonly event_count: unknown;
          readonly expired: unknown;
          readonly organization_id: unknown;
          readonly provider_events: unknown;
          readonly released: unknown;
          readonly request_count: unknown;
          readonly reserved: unknown;
          readonly settled: unknown;
        }
      >(
        sql(
          `SELECT CURRENT_TIMESTAMP AS as_of, membership.organization_id,
                  COUNT(event.ledger_entry_id) AS event_count,
                  COUNT(DISTINCT event.request_id) AS request_count,
                  COUNT(event.ledger_entry_id) FILTER (
                    WHERE event.provider_key IS NOT NULL
                      AND event.model_key IS NOT NULL
                      AND event.model_version IS NOT NULL
                      AND event.estimated_provider_cost_micros IS NOT NULL
                      AND event.provider_cost_currency IS NOT NULL
                  ) AS provider_events,
                  COUNT(event.ledger_entry_id) FILTER (
                    WHERE event.entry_kind = 'adjustment'
                      AND event.credit_adjustment_units > 0
                  ) AS compensated_events,
                  COALESCE(SUM(event.reserved_credit_units), 0) AS reserved,
                  COALESCE(SUM(event.settled_credit_units), 0) AS settled,
                  COALESCE(SUM(event.released_credit_units), 0) AS released,
                  COALESCE(SUM(event.expired_credit_units), 0) AS expired,
                  COALESCE(SUM(CASE WHEN event.credit_adjustment_units > 0
                    THEN event.credit_adjustment_units ELSE 0 END), 0)
                    AS compensated
                  ,COALESCE(SUM(CASE WHEN event.credit_adjustment_units < 0
                    THEN -event.credit_adjustment_units ELSE 0 END), 0)
                    AS debit_adjustments
                  ,COALESCE(SUM(event.credit_adjustment_units), 0)
                    AS net_adjustments
           FROM memberships membership
           JOIN principals principal
             ON principal.principal_id = membership.principal_id
           JOIN organizations organization
             ON organization.organization_id = membership.organization_id
           LEFT JOIN usage_ledger_entries event
             ON event.organization_id = membership.organization_id
            AND event.occurred_at >= $4 AND event.occurred_at < $5
            AND event.occurred_at <= CURRENT_TIMESTAMP
           WHERE membership.membership_id = $1
             AND membership.principal_id = $2
             AND membership.organization_id = $3
             AND membership.lifecycle_status = 'active'
             AND principal.lifecycle_status = 'active'
             AND organization.lifecycle_status IN ('active', 'suspended')
           GROUP BY membership.organization_id`,
          [
            scope.membershipId,
            scope.principalId,
            scope.organizationId,
            from,
            until,
          ],
        ),
      );
      const row = result.rows[0];
      if (row === undefined) {
        return fail("access-denied", "Access is not available.");
      }
      const asOf = readString(row.as_of);
      const featureResult = await transaction.query<
        SqlRow & {
          readonly compensated: unknown;
          readonly debit_adjustments: unknown;
          readonly net_adjustments: unknown;
          readonly expired: unknown;
          readonly feature_key: unknown;
          readonly released: unknown;
          readonly request_count: unknown;
          readonly reserved: unknown;
          readonly settled: unknown;
        }
      >(
        sql(
          `SELECT feature_key, COUNT(DISTINCT request_id) AS request_count,
                  COALESCE(SUM(reserved_credit_units), 0) AS reserved,
                  COALESCE(SUM(settled_credit_units), 0) AS settled,
                  COALESCE(SUM(released_credit_units), 0) AS released,
                  COALESCE(SUM(expired_credit_units), 0) AS expired,
                  COALESCE(SUM(CASE WHEN credit_adjustment_units > 0
                    THEN credit_adjustment_units ELSE 0 END), 0) AS compensated,
                  COALESCE(SUM(CASE WHEN credit_adjustment_units < 0
                    THEN -credit_adjustment_units ELSE 0 END), 0)
                    AS debit_adjustments,
                  COALESCE(SUM(credit_adjustment_units), 0)
                    AS net_adjustments
           FROM usage_ledger_entries
           WHERE organization_id = $1 AND occurred_at >= $2 AND occurred_at < $3
             AND occurred_at <= $4
             AND feature_key IS NOT NULL
           GROUP BY feature_key
           ORDER BY feature_key`,
          [scope.organizationId, from, until, asOf],
        ),
      );
      const creditTotals = {
        compensatedCreditUnits: readDecimal(row.compensated),
        debitAdjustmentCreditUnits: readDecimal(row.debit_adjustments),
        expiredReservationCreditUnits: readDecimal(row.expired),
        netAdjustmentCreditUnits: readDecimal(row.net_adjustments),
        releasedCreditUnits: readDecimal(row.released),
        reservedCreditUnits: readDecimal(row.reserved),
        settledCreditUnits: readDecimal(row.settled),
      };
      return {
        asOf,
        byFeature: featureResult.rows.map((feature) => ({
          creditTotals: {
            compensatedCreditUnits: readDecimal(feature.compensated),
            debitAdjustmentCreditUnits: readDecimal(feature.debit_adjustments),
            expiredReservationCreditUnits: readDecimal(feature.expired),
            netAdjustmentCreditUnits: readDecimal(feature.net_adjustments),
            releasedCreditUnits: readDecimal(feature.released),
            reservedCreditUnits: readDecimal(feature.reserved),
            settledCreditUnits: readDecimal(feature.settled),
          },
          feature: readString(feature.feature_key),
          requestCount: readDecimal(feature.request_count),
        })),
        creditTotals,
        customerCompensatedEventCount: readDecimal(row.compensated_events),
        eventCount: readDecimal(row.event_count),
        organizationId: readString(row.organization_id),
        periodEndsAt: until,
        periodStartsAt: from,
        providerReportedEventCount: readDecimal(row.provider_events),
        requestCount: readDecimal(row.request_count),
      };
    });
  }
}
