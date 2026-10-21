import {
  CommercialPersistenceError,
  type TrustedCommercialAccountingContext,
  type TrustedCommercialAdministrationContext,
} from "../../application/commercial-persistence.js";
import type {
  AppendModelUsageEventDetailInput,
  CreateCreditNormalizationPolicyVersionInput,
  CreateModelProviderPricingVersionInput,
  CreditNormalizationPolicyVersionRecord,
  ModelCommercialPersistenceRepository,
  ModelCommercialReconciliationCandidateRecord,
  ModelProviderPricingVersionRecord,
  ModelProviderSpecificUnitRateInput,
  ModelUsageEventDetailRecord,
  ModelUsageUnitsPersistenceInput,
} from "../../application/model-commercial-persistence.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type { SqlDatabase, SqlExecutor, SqlRow } from "./sql.js";
import { sql } from "./sql.js";
import { modelProviderKeyPattern } from "./model-provider-key.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const unitNamePattern = /^[a-z][a-z0-9.-]{0,63}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const currencyPattern = /^[A-Z]{3}$/u;
const validEnvironments = new Set([
  "development",
  "test",
  "staging",
  "production",
]);
const validPricingStatuses = new Set([
  "enabled",
  "disabled-pricing-unavailable",
]);
const validPolicyStatuses = new Set(["enabled", "disabled"]);
const postgresBigintMaximum = 9_223_372_036_854_775_807n;

type PricingRow = SqlRow & {
  readonly cache_read_micros_per_million_units: unknown;
  readonly cache_write_micros_per_million_units: unknown;
  readonly cost_currency: unknown;
  readonly created_at: unknown;
  readonly effective_from: unknown;
  readonly effective_until: unknown;
  readonly environment: unknown;
  readonly inference_profile_id: unknown;
  readonly input_micros_per_million_units: unknown;
  readonly model_key: unknown;
  readonly model_version: unknown;
  readonly output_micros_per_million_units: unknown;
  readonly pricing_status: unknown;
  readonly pricing_version_id: unknown;
  readonly provider_key: unknown;
  readonly provider_specific_unit_rates: unknown;
};

type PolicyRow = SqlRow & {
  readonly cost_currency: unknown;
  readonly created_at: unknown;
  readonly credit_unit_micros: unknown;
  readonly effective_from: unknown;
  readonly effective_until: unknown;
  readonly normalization_policy_version_id: unknown;
  readonly operating_buffer_basis_points: unknown;
  readonly policy_status: unknown;
};

type DetailRow = SqlRow & {
  readonly acting_principal_id: unknown;
  readonly attempts: unknown;
  readonly cache_read_units: unknown;
  readonly cache_write_units: unknown;
  readonly charged_credit_units: unknown;
  readonly compensated_credit_units: unknown;
  readonly completed_at: unknown;
  readonly environment: unknown;
  readonly estimated_provider_cost_micros: unknown;
  readonly failure_category: unknown;
  readonly feature_key: unknown;
  readonly inference_profile_id: unknown;
  readonly input_units: unknown;
  readonly job_id: unknown;
  readonly ledger_entry_id: unknown;
  readonly lifecycle_status: unknown;
  readonly model_key: unknown;
  readonly model_route: unknown;
  readonly model_route_id: unknown;
  readonly model_usage_event_id: unknown;
  readonly model_usage_idempotency_key_sha256: unknown;
  readonly model_version: unknown;
  readonly multi_call_workflow_id: unknown;
  readonly normalization_policy_version_id: unknown;
  readonly occurred_at: unknown;
  readonly organization_id: unknown;
  readonly output_units: unknown;
  readonly pricing_version_id: unknown;
  readonly project_id: unknown;
  readonly prompt_id: unknown;
  readonly prompt_version: unknown;
  readonly provider_key: unknown;
  readonly provider_specific_units: unknown;
  readonly reconciliation_state: unknown;
  readonly request_id: unknown;
  readonly reservation_id: unknown;
  readonly reserved_credit_units: unknown;
  readonly started_at: unknown;
  readonly template_id: unknown;
  readonly template_version: unknown;
  readonly total_units: unknown;
};

function fail(
  code: ConstructorParameters<typeof CommercialPersistenceError>[0],
  message: string,
): never {
  throw new CommercialPersistenceError(code, message);
}

function assertIdentifier(value: string): void {
  if (!identifierPattern.test(value)) {
    fail("invalid-input", "The model commercial identity is invalid.");
  }
}

function assertTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    fail("invalid-input", "The model commercial timestamp is invalid.");
  }
}

function unsignedInteger(value: string, positive = false): bigint {
  if (!decimalPattern.test(value)) {
    return fail("invalid-input", "The model commercial integer is invalid.");
  }
  const parsed = BigInt(value);
  if ((positive && parsed === 0n) || parsed > postgresBigintMaximum) {
    return fail("invalid-input", "The model commercial integer is invalid.");
  }
  return parsed;
}

function readString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return fail("invalid-input", "The database returned invalid model usage.");
}

function readOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : readString(value);
}

function readDecimal(value: unknown): string {
  if (
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value))
  ) {
    return BigInt(value).toString();
  }
  return fail("invalid-input", "The database returned an invalid integer.");
}

function readJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return fail("invalid-input", "The database returned invalid JSON.");
    }
  }
  return value;
}

function readUnitRates(
  value: unknown,
): readonly ModelProviderSpecificUnitRateInput[] {
  const parsed = readJson(value);
  if (!Array.isArray(parsed)) {
    return fail("invalid-input", "Provider-specific rates are invalid.");
  }
  return parsed.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("unitName" in item) ||
      !("microsPerMillionUnits" in item)
    ) {
      return fail("invalid-input", "Provider-specific rates are invalid.");
    }
    const record = item as Readonly<Record<string, unknown>>;
    return {
      microsPerMillionUnits: readString(record["microsPerMillionUnits"]),
      unitName: readString(record["unitName"]),
    };
  });
}

function assertAccountingContext(
  context: TrustedCommercialAccountingContext,
): void {
  const authority: unknown = context.authority;
  if (authority !== "internal-accounting") {
    fail("access-denied", "Commercial accounting authority is required.");
  }
  assertIdentifier(context.actorId);
  assertIdentifier(context.organizationId);
}

function assertAdministrationContext(
  context: TrustedCommercialAdministrationContext,
): void {
  const authority: unknown = context.authority;
  if (authority !== "internal-administration") {
    fail("access-denied", "Commercial administration authority is required.");
  }
  assertIdentifier(context.actorId);
  assertIdentifier(context.actorPrincipalId);
  assertIdentifier(context.organizationId);
}

function validateEffectiveRange(
  effectiveFrom: string,
  effectiveUntil?: string,
): void {
  assertTimestamp(effectiveFrom);
  if (effectiveUntil !== undefined) {
    assertTimestamp(effectiveUntil);
    if (Date.parse(effectiveUntil) <= Date.parse(effectiveFrom)) {
      fail("invalid-input", "The effective range must be non-empty.");
    }
  }
}

function validateRates(
  rates: readonly ModelProviderSpecificUnitRateInput[],
): void {
  const names = new Set<string>();
  for (const rate of rates) {
    if (!unitNamePattern.test(rate.unitName) || names.has(rate.unitName)) {
      fail("invalid-input", "Provider-specific rates are invalid.");
    }
    unsignedInteger(rate.microsPerMillionUnits);
    names.add(rate.unitName);
  }
}

function mapPricing(row: PricingRow): ModelProviderPricingVersionRecord {
  const cacheRead = readOptionalString(row.cache_read_micros_per_million_units);
  const cacheWrite = readOptionalString(
    row.cache_write_micros_per_million_units,
  );
  const effectiveUntil = readOptionalString(row.effective_until);
  const inferenceProfileId = readOptionalString(row.inference_profile_id);
  return {
    ...(cacheRead === undefined
      ? {}
      : { cacheReadMicrosPerMillionUnits: cacheRead }),
    ...(cacheWrite === undefined
      ? {}
      : { cacheWriteMicrosPerMillionUnits: cacheWrite }),
    costCurrency: readString(row.cost_currency).trim(),
    createdAt: readString(row.created_at),
    effectiveFrom: readString(row.effective_from),
    ...(effectiveUntil === undefined ? {} : { effectiveUntil }),
    environment: readString(
      row.environment,
    ) as ModelProviderPricingVersionRecord["environment"],
    ...(inferenceProfileId === undefined ? {} : { inferenceProfileId }),
    inputMicrosPerMillionUnits: readDecimal(row.input_micros_per_million_units),
    modelId: readString(row.model_key),
    modelVersion: readString(row.model_version),
    outputMicrosPerMillionUnits: readDecimal(
      row.output_micros_per_million_units,
    ),
    pricingVersionId: readString(row.pricing_version_id),
    providerKey: readString(row.provider_key),
    providerSpecificUnitRates: readUnitRates(row.provider_specific_unit_rates),
    status: readString(
      row.pricing_status,
    ) as ModelProviderPricingVersionRecord["status"],
  };
}

function mapPolicy(row: PolicyRow): CreditNormalizationPolicyVersionRecord {
  const effectiveUntil = readOptionalString(row.effective_until);
  return {
    costCurrency: readString(row.cost_currency).trim(),
    createdAt: readString(row.created_at),
    creditUnitMicros: readDecimal(row.credit_unit_micros),
    effectiveFrom: readString(row.effective_from),
    ...(effectiveUntil === undefined ? {} : { effectiveUntil }),
    normalizationPolicyVersionId: readString(
      row.normalization_policy_version_id,
    ),
    operatingBufferBasisPoints: readDecimal(row.operating_buffer_basis_points),
    status: readString(
      row.policy_status,
    ) as CreditNormalizationPolicyVersionRecord["status"],
  };
}

const pricingSelect =
  "SELECT pricing_version_id, provider_key, model_key, model_version, " +
  "inference_profile_id, environment, effective_from, effective_until, " +
  "pricing_status, cost_currency, input_micros_per_million_units, " +
  "output_micros_per_million_units, cache_read_micros_per_million_units, " +
  "cache_write_micros_per_million_units, provider_specific_unit_rates, " +
  "created_at FROM model_provider_pricing_versions";

const policySelect =
  "SELECT normalization_policy_version_id, cost_currency, effective_from, " +
  "effective_until, policy_status, operating_buffer_basis_points, " +
  "credit_unit_micros, created_at FROM credit_normalization_policy_versions";

const detailSelect =
  "SELECT detail.model_usage_event_id, " +
  "detail.model_usage_idempotency_key_sha256, detail.ledger_entry_id, " +
  "detail.model_route, detail.model_route_id, detail.inference_profile_id, " +
  "detail.prompt_id, detail.prompt_version, detail.template_id, " +
  "detail.template_version, detail.model_pricing_version_id AS pricing_version_id, " +
  "detail.normalization_policy_version_id, detail.environment, " +
  "detail.input_units, detail.output_units, detail.cache_read_units, " +
  "detail.cache_write_units, detail.total_units, detail.provider_specific_units, " +
  "detail.estimated_provider_cost_micros, detail.reserved_credit_units, " +
  "detail.charged_credit_units, detail.compensated_credit_units, " +
  "detail.started_at, detail.completed_at, detail.latency_milliseconds, " +
  "detail.lifecycle_status, detail.failure_category, detail.attempts, " +
  "detail.multi_call_workflow_id, detail.reconciliation_state, " +
  "event.organization_id, event.acting_principal_id, event.project_id, " +
  "event.job_id, event.feature_key, event.request_id, event.reservation_id, " +
  "event.provider_key, event.model_key, event.model_version, detail.occurred_at " +
  "FROM model_usage_event_details detail JOIN usage_ledger_entries event " +
  "ON event.organization_id = detail.organization_id " +
  "AND event.ledger_entry_id = detail.ledger_entry_id";

function parseUsageUnits(value: unknown): ModelUsageUnitsPersistenceInput {
  if (typeof value !== "object" || value === null) {
    return fail("invalid-input", "Persisted model usage units are invalid.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const providerUnits = record["providerSpecificUnits"];
  if (!Array.isArray(providerUnits)) {
    return fail("invalid-input", "Persisted provider units are invalid.");
  }
  return {
    cacheReadUnits: readString(record["cacheReadUnits"]),
    cacheWriteUnits: readString(record["cacheWriteUnits"]),
    inputUnits: readString(record["inputUnits"]),
    outputUnits: readString(record["outputUnits"]),
    providerSpecificUnits: providerUnits.map((unit) => {
      if (typeof unit !== "object" || unit === null) {
        return fail("invalid-input", "Persisted provider units are invalid.");
      }
      const item = unit as Readonly<Record<string, unknown>>;
      return {
        unitName: readString(item["unitName"]),
        units: readString(item["units"]),
      };
    }),
    totalUnits: readString(record["totalUnits"]),
  };
}

function mapDetail(row: DetailRow): ModelUsageEventDetailRecord {
  const attempts = readJson(row.attempts);
  const providerSpecificUnits = parseUsageUnits({
    cacheReadUnits: readDecimal(row.cache_read_units),
    cacheWriteUnits: readDecimal(row.cache_write_units),
    inputUnits: readDecimal(row.input_units),
    outputUnits: readDecimal(row.output_units),
    providerSpecificUnits: readJson(row.provider_specific_units),
    totalUnits: readDecimal(row.total_units),
  }).providerSpecificUnits;
  if (!Array.isArray(attempts)) {
    return fail("invalid-input", "Persisted model attempts are invalid.");
  }
  const optional = {
    completedAt: readOptionalString(row.completed_at),
    failureCategory: readOptionalString(row.failure_category),
    inferenceProfileId: readOptionalString(row.inference_profile_id),
    startedAt: readOptionalString(row.started_at),
    templateId: readOptionalString(row.template_id),
    templateVersion: readOptionalString(row.template_version),
  };
  return {
    attempts: attempts as ModelUsageEventDetailRecord["attempts"],
    cacheReadUnits: readDecimal(row.cache_read_units),
    cacheWriteUnits: readDecimal(row.cache_write_units),
    chargedCreditUnits: readDecimal(row.charged_credit_units),
    compensatedCreditUnits: readDecimal(row.compensated_credit_units),
    ...(optional.completedAt === undefined
      ? {}
      : { completedAt: optional.completedAt }),
    environment: readString(
      row.environment,
    ) as ModelUsageEventDetailRecord["environment"],
    estimatedProviderCostMicros: readDecimal(
      row.estimated_provider_cost_micros,
    ),
    ...(optional.failureCategory === undefined
      ? {}
      : { failureCategory: optional.failureCategory }),
    featureKey: readString(row.feature_key),
    ...(optional.inferenceProfileId === undefined
      ? {}
      : { inferenceProfileId: optional.inferenceProfileId }),
    inputUnits: readDecimal(row.input_units),
    jobId: readString(row.job_id),
    ledgerEntryId: readString(row.ledger_entry_id),
    modelId: readString(row.model_key),
    modelRoute: readString(
      row.model_route,
    ) as ModelUsageEventDetailRecord["modelRoute"],
    modelRouteId: readString(row.model_route_id),
    modelUsageEventId: readString(row.model_usage_event_id),
    modelUsageIdempotencyKeySha256: readString(
      row.model_usage_idempotency_key_sha256,
    ),
    modelVersion: readString(row.model_version),
    multiCallWorkflowId: readString(row.multi_call_workflow_id),
    normalizationPolicyVersionId: readString(
      row.normalization_policy_version_id,
    ),
    occurredAt: readString(row.occurred_at),
    organizationId: readString(row.organization_id),
    outputUnits: readDecimal(row.output_units),
    pricingVersionId: readString(row.pricing_version_id),
    projectId: readString(row.project_id),
    promptId: readString(row.prompt_id),
    promptVersion: readString(row.prompt_version),
    providerKey: readString(row.provider_key),
    providerSpecificUnits,
    reconciliationState: readString(
      row.reconciliation_state,
    ) as ModelUsageEventDetailRecord["reconciliationState"],
    requestId: readString(row.request_id),
    reservationId: readString(row.reservation_id),
    reservedCreditUnits: readDecimal(row.reserved_credit_units),
    ...(optional.startedAt === undefined
      ? {}
      : { startedAt: optional.startedAt }),
    status: readString(
      row.lifecycle_status,
    ) as ModelUsageEventDetailRecord["status"],
    ...(optional.templateId === undefined
      ? {}
      : { templateId: optional.templateId }),
    ...(optional.templateVersion === undefined
      ? {}
      : { templateVersion: optional.templateVersion }),
    totalUnits: readDecimal(row.total_units),
    userId: readString(row.acting_principal_id),
  };
}

function assertUsageDetail(input: AppendModelUsageEventDetailInput): void {
  for (const identifier of [
    input.ledgerEntryId,
    input.modelUsageEventId,
    input.modelRouteId,
    input.multiCallWorkflowId,
    input.normalizationPolicyVersionId,
    input.pricingVersionId,
    input.promptId,
    input.promptVersion,
  ]) {
    assertIdentifier(identifier);
  }
  if (!sha256Pattern.test(input.modelUsageIdempotencyKeySha256)) {
    fail("invalid-input", "The model usage idempotency identity is invalid.");
  }
  if (
    (input.templateId === undefined) !==
    (input.templateVersion === undefined)
  ) {
    fail("invalid-input", "Template identity and version are incomplete.");
  }
  if (input.templateId !== undefined) assertIdentifier(input.templateId);
  if (input.templateVersion !== undefined) {
    assertIdentifier(input.templateVersion);
  }
  for (const timestamp of [
    input.occurredAt,
    input.startedAt,
    input.completedAt,
  ]) {
    if (timestamp !== undefined) assertTimestamp(timestamp);
  }
  const inputUnits = unsignedInteger(input.inputUnits);
  const outputUnits = unsignedInteger(input.outputUnits);
  const cacheReadUnits = unsignedInteger(input.cacheReadUnits);
  const cacheWriteUnits = unsignedInteger(input.cacheWriteUnits);
  const totalUnits = unsignedInteger(input.totalUnits);
  if (
    totalUnits !==
    inputUnits + outputUnits + cacheReadUnits + cacheWriteUnits
  ) {
    fail("invalid-input", "The model usage total does not reconcile.");
  }
  for (const value of [
    input.estimatedProviderCostMicros,
    input.reservedCreditUnits,
    input.chargedCreditUnits,
    input.compensatedCreditUnits,
  ]) {
    unsignedInteger(value);
  }
  if (
    unsignedInteger(input.chargedCreditUnits) >
    unsignedInteger(input.reservedCreditUnits)
  ) {
    fail("invalid-input", "Charged credits cannot exceed reserved credits.");
  }
  const serializedAttempts = JSON.stringify(input.attempts);
  if (
    /rawPrompt|rawResponse|promptText|responseText/iu.test(serializedAttempts)
  ) {
    fail("invalid-input", "Raw model content cannot enter usage events.");
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function matchesInput(
  existing: object,
  input: object,
  omittedKeys: ReadonlySet<string>,
): boolean {
  const projected = Object.fromEntries(
    Object.entries(existing).filter(([key]) => !omittedKeys.has(key)),
  );
  return (
    JSON.stringify(canonicalize(projected)) ===
    JSON.stringify(canonicalize(input))
  );
}

const detailAuthorityKeys = new Set([
  "featureKey",
  "jobId",
  "modelId",
  "modelVersion",
  "organizationId",
  "projectId",
  "providerKey",
  "requestId",
  "reservationId",
  "userId",
]);

function sameRecord(
  existing: ModelUsageEventDetailRecord,
  input: AppendModelUsageEventDetailInput,
): boolean {
  return matchesInput(existing, input, detailAuthorityKeys);
}

export class PostgresModelCommercialPersistenceRepository implements ModelCommercialPersistenceRepository {
  readonly #database: SqlDatabase;

  public constructor(database: SqlDatabase) {
    this.#database = database;
  }

  public async createModelProviderPricingVersion(
    context: TrustedCommercialAdministrationContext,
    input: CreateModelProviderPricingVersionInput,
  ): Promise<ModelProviderPricingVersionRecord> {
    assertAdministrationContext(context);
    assertIdentifier(input.pricingVersionId);
    if (!modelProviderKeyPattern.test(input.providerKey)) {
      return fail("invalid-input", "The provider key is invalid.");
    }
    assertIdentifier(input.modelId);
    assertIdentifier(input.modelVersion);
    if (input.inferenceProfileId !== undefined) {
      assertIdentifier(input.inferenceProfileId);
    }
    if (!currencyPattern.test(input.costCurrency)) {
      fail("invalid-input", "The pricing currency is invalid.");
    }
    if (
      !validEnvironments.has(input.environment) ||
      !validPricingStatuses.has(input.status)
    ) {
      fail("invalid-input", "The pricing environment or status is invalid.");
    }
    validateEffectiveRange(input.effectiveFrom, input.effectiveUntil);
    for (const value of [
      input.inputMicrosPerMillionUnits,
      input.outputMicrosPerMillionUnits,
      input.cacheReadMicrosPerMillionUnits,
      input.cacheWriteMicrosPerMillionUnits,
    ]) {
      if (value !== undefined) unsignedInteger(value);
    }
    validateRates(input.providerSpecificUnitRates);
    return this.#database.transaction(async (transaction) => {
      await transaction.query(
        sql("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          "model-pricing-id:" + input.pricingVersionId,
        ]),
      );
      const existing = await transaction.query<PricingRow>(
        sql(pricingSelect + " WHERE pricing_version_id = $1 FOR UPDATE", [
          input.pricingVersionId,
        ]),
      );
      if (existing.rows[0] !== undefined) {
        const record = mapPricing(existing.rows[0]);
        if (matchesInput(record, input, new Set(["createdAt"]))) {
          return record;
        }
        return fail("idempotency-conflict", "The pricing identity was reused.");
      }
      const created = await transaction.query<PricingRow>(
        sql(
          "INSERT INTO model_provider_pricing_versions (" +
            "pricing_version_id, provider_key, model_key, model_version, " +
            "inference_profile_id, environment, effective_from, effective_until, " +
            "pricing_status, cost_currency, input_micros_per_million_units, " +
            "output_micros_per_million_units, cache_read_micros_per_million_units, " +
            "cache_write_micros_per_million_units, provider_specific_unit_rates" +
            ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::JSONB) " +
            "RETURNING pricing_version_id, provider_key, model_key, model_version, " +
            "inference_profile_id, environment, effective_from, effective_until, " +
            "pricing_status, cost_currency, input_micros_per_million_units, " +
            "output_micros_per_million_units, cache_read_micros_per_million_units, " +
            "cache_write_micros_per_million_units, provider_specific_unit_rates, created_at",
          [
            input.pricingVersionId,
            input.providerKey,
            input.modelId,
            input.modelVersion,
            input.inferenceProfileId ?? null,
            input.environment,
            input.effectiveFrom,
            input.effectiveUntil ?? null,
            input.status,
            input.costCurrency,
            unsignedInteger(input.inputMicrosPerMillionUnits),
            unsignedInteger(input.outputMicrosPerMillionUnits),
            input.cacheReadMicrosPerMillionUnits === undefined
              ? null
              : unsignedInteger(input.cacheReadMicrosPerMillionUnits),
            input.cacheWriteMicrosPerMillionUnits === undefined
              ? null
              : unsignedInteger(input.cacheWriteMicrosPerMillionUnits),
            JSON.stringify(input.providerSpecificUnitRates),
          ],
        ),
      );
      const row = created.rows[0];
      return row === undefined
        ? fail("version-conflict", "The pricing version was not created.")
        : mapPricing(row);
    });
  }

  public async createCreditNormalizationPolicyVersion(
    context: TrustedCommercialAdministrationContext,
    input: CreateCreditNormalizationPolicyVersionInput,
  ): Promise<CreditNormalizationPolicyVersionRecord> {
    assertAdministrationContext(context);
    assertIdentifier(input.normalizationPolicyVersionId);
    validateEffectiveRange(input.effectiveFrom, input.effectiveUntil);
    if (
      !currencyPattern.test(input.costCurrency) ||
      !validPolicyStatuses.has(input.status)
    ) {
      fail("invalid-input", "The normalization currency or status is invalid.");
    }
    unsignedInteger(input.creditUnitMicros, true);
    const operatingBufferBasisPoints = unsignedInteger(
      input.operatingBufferBasisPoints,
    );
    if (operatingBufferBasisPoints > 1_000_000n) {
      fail("invalid-input", "The operating buffer is invalid.");
    }
    return this.#database.transaction(async (transaction) => {
      await transaction.query(
        sql("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          "normalization-policy-id:" + input.normalizationPolicyVersionId,
        ]),
      );
      const existing = await transaction.query<PolicyRow>(
        sql(
          policySelect +
            " WHERE normalization_policy_version_id = $1 FOR UPDATE",
          [input.normalizationPolicyVersionId],
        ),
      );
      if (existing.rows[0] !== undefined) {
        const record = mapPolicy(existing.rows[0]);
        return matchesInput(record, input, new Set(["createdAt"]))
          ? record
          : fail("idempotency-conflict", "The policy identity was reused.");
      }
      const created = await transaction.query<PolicyRow>(
        sql(
          "INSERT INTO credit_normalization_policy_versions (" +
            "normalization_policy_version_id, cost_currency, effective_from, " +
            "effective_until, policy_status, operating_buffer_basis_points, " +
            "credit_unit_micros) VALUES ($1,$2,$3,$4,$5,$6,$7) " +
            "RETURNING normalization_policy_version_id, cost_currency, " +
            "effective_from, effective_until, policy_status, " +
            "operating_buffer_basis_points, credit_unit_micros, created_at",
          [
            input.normalizationPolicyVersionId,
            input.costCurrency,
            input.effectiveFrom,
            input.effectiveUntil ?? null,
            input.status,
            unsignedInteger(input.operatingBufferBasisPoints),
            unsignedInteger(input.creditUnitMicros, true),
          ],
        ),
      );
      const row = created.rows[0];
      return row === undefined
        ? fail("version-conflict", "The normalization policy was not created.")
        : mapPolicy(row);
    });
  }

  public async getModelProviderPricingVersion(
    context: TrustedCommercialAccountingContext,
    pricingVersionId: string,
  ): Promise<ModelProviderPricingVersionRecord | null> {
    assertAccountingContext(context);
    assertIdentifier(pricingVersionId);
    const result = await this.#database.query<PricingRow>(
      sql(pricingSelect + " WHERE pricing_version_id = $1", [pricingVersionId]),
    );
    return result.rows[0] === undefined ? null : mapPricing(result.rows[0]);
  }

  public async getCreditNormalizationPolicyVersion(
    context: TrustedCommercialAccountingContext,
    normalizationPolicyVersionId: string,
  ): Promise<CreditNormalizationPolicyVersionRecord | null> {
    assertAccountingContext(context);
    assertIdentifier(normalizationPolicyVersionId);
    const result = await this.#database.query<PolicyRow>(
      sql(policySelect + " WHERE normalization_policy_version_id = $1", [
        normalizationPolicyVersionId,
      ]),
    );
    return result.rows[0] === undefined ? null : mapPolicy(result.rows[0]);
  }

  /** Same-transaction readers for a host that already authenticated its current
   * principal/project authority. Neither method creates or changes a version. */
  public async getModelProviderPricingVersionInTransaction(
    transaction: SqlExecutor,
    context: TrustedCommercialAccountingContext,
    pricingVersionId: string,
  ): Promise<ModelProviderPricingVersionRecord | null> {
    assertAccountingContext(context);
    assertIdentifier(pricingVersionId);
    const result = await transaction.query<PricingRow>(
      sql(pricingSelect + " WHERE pricing_version_id = $1 FOR SHARE", [
        pricingVersionId,
      ]),
    );
    return result.rows[0] === undefined ? null : mapPricing(result.rows[0]);
  }

  public async getCreditNormalizationPolicyVersionInTransaction(
    transaction: SqlExecutor,
    context: TrustedCommercialAccountingContext,
    normalizationPolicyVersionId: string,
  ): Promise<CreditNormalizationPolicyVersionRecord | null> {
    assertAccountingContext(context);
    assertIdentifier(normalizationPolicyVersionId);
    const result = await transaction.query<PolicyRow>(
      sql(
        policySelect + " WHERE normalization_policy_version_id = $1 FOR SHARE",
        [normalizationPolicyVersionId],
      ),
    );
    return result.rows[0] === undefined ? null : mapPolicy(result.rows[0]);
  }

  public async appendUsageEventDetail(
    context: TrustedCommercialAccountingContext,
    input: AppendModelUsageEventDetailInput,
  ): Promise<ModelUsageEventDetailRecord> {
    return this.#appendUsageEventDetail(context, input);
  }
  /** Internal same-transaction append; the model bridge verifies the immutable
   * reservation price snapshot before supplying its captured instant. */
  public appendUsageEventDetailInTransaction(
    transaction: SqlExecutor,
    context: TrustedCommercialAccountingContext,
    input: AppendModelUsageEventDetailInput,
    capturedAt: string,
  ): Promise<ModelUsageEventDetailRecord> {
    assertTimestamp(capturedAt);
    return this.#appendUsageEventDetail(
      context,
      input,
      transaction,
      capturedAt,
    );
  }
  async #appendUsageEventDetail(
    context: TrustedCommercialAccountingContext,
    input: AppendModelUsageEventDetailInput,
    suppliedTransaction?: SqlExecutor,
    capturedAt?: string,
  ): Promise<ModelUsageEventDetailRecord> {
    assertAccountingContext(context);
    assertUsageDetail(input);
    const execute = (
      work: (transaction: SqlExecutor) => Promise<ModelUsageEventDetailRecord>,
    ) =>
      suppliedTransaction === undefined
        ? this.#database.transaction(work)
        : work(suppliedTransaction);
    return execute(async (transaction) => {
      await transaction.query(
        sql("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          "model-usage:" +
            context.organizationId +
            ":" +
            input.modelUsageEventId,
        ]),
      );
      const existing = await transaction.query<DetailRow>(
        sql(
          detailSelect +
            " WHERE detail.organization_id = $1 AND " +
            "(detail.model_usage_event_id = $2 OR " +
            "detail.model_usage_idempotency_key_sha256 = $3) FOR UPDATE",
          [
            context.organizationId,
            input.modelUsageEventId,
            input.modelUsageIdempotencyKeySha256,
          ],
        ),
      );
      if (existing.rows[0] !== undefined) {
        const record = mapDetail(existing.rows[0]);
        return sameRecord(record, input)
          ? record
          : fail(
              "idempotency-conflict",
              "The model usage identity was reused.",
            );
      }
      const authority = await transaction.query<DetailRow>(
        sql(
          "SELECT event.organization_id, event.ledger_entry_id, " +
            "event.acting_principal_id, event.project_id, event.job_id, " +
            "event.feature_key, event.request_id, event.reservation_id, " +
            "event.provider_key, event.model_key, event.model_version, " +
            "event.occurred_at FROM usage_ledger_entries event " +
            "JOIN model_provider_pricing_versions pricing " +
            "ON pricing.pricing_version_id = $3 " +
            "AND pricing.provider_key = event.provider_key " +
            "AND pricing.model_key = event.model_key " +
            "AND pricing.model_version = event.model_version " +
            "AND pricing.inference_profile_id IS NOT DISTINCT FROM $6 " +
            "AND pricing.environment = $5 " +
            "AND pricing.pricing_status = 'enabled' " +
            "AND pricing.effective_from <= $7::TIMESTAMPTZ " +
            "AND (pricing.effective_until IS NULL " +
            "OR $7::TIMESTAMPTZ < pricing.effective_until) " +
            "JOIN credit_normalization_policy_versions policy " +
            "ON policy.normalization_policy_version_id = $4 " +
            "AND policy.cost_currency = pricing.cost_currency " +
            "AND policy.policy_status = 'enabled' " +
            "AND policy.effective_from <= $7::TIMESTAMPTZ " +
            "AND (policy.effective_until IS NULL " +
            "OR $7::TIMESTAMPTZ < policy.effective_until) " +
            "WHERE event.organization_id = $1 AND event.ledger_entry_id = $2",
          [
            context.organizationId,
            input.ledgerEntryId,
            input.pricingVersionId,
            input.normalizationPolicyVersionId,
            input.environment,
            input.inferenceProfileId ?? null,
            capturedAt ?? input.startedAt ?? input.occurredAt,
          ],
        ),
      );
      if (authority.rows[0] === undefined) {
        return fail(
          "access-denied",
          "Canonical credit-ledger authority is not available.",
        );
      }
      await transaction.query(
        sql(
          "INSERT INTO model_usage_event_details (" +
            "organization_id, model_usage_event_id, " +
            "model_usage_idempotency_key_sha256, ledger_entry_id, model_route, " +
            "model_route_id, inference_profile_id, prompt_id, prompt_version, " +
            "template_id, template_version, model_pricing_version_id, " +
            "normalization_policy_version_id, environment, input_units, " +
            "output_units, cache_read_units, cache_write_units, total_units, " +
            "provider_specific_units, estimated_provider_cost_micros, " +
            "reserved_credit_units, charged_credit_units, compensated_credit_units, " +
            "occurred_at, started_at, completed_at, latency_milliseconds, lifecycle_status, " +
            "failure_category, attempts, multi_call_workflow_id, reconciliation_state" +
            ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16," +
            "$17,$18,$19,$20::JSONB,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::JSONB,$32,$33)",
          [
            context.organizationId,
            input.modelUsageEventId,
            input.modelUsageIdempotencyKeySha256,
            input.ledgerEntryId,
            input.modelRoute,
            input.modelRouteId,
            input.inferenceProfileId ?? null,
            input.promptId,
            input.promptVersion,
            input.templateId ?? null,
            input.templateVersion ?? null,
            input.pricingVersionId,
            input.normalizationPolicyVersionId,
            input.environment,
            unsignedInteger(input.inputUnits),
            unsignedInteger(input.outputUnits),
            unsignedInteger(input.cacheReadUnits),
            unsignedInteger(input.cacheWriteUnits),
            unsignedInteger(input.totalUnits),
            JSON.stringify(input.providerSpecificUnits),
            unsignedInteger(input.estimatedProviderCostMicros),
            unsignedInteger(input.reservedCreditUnits),
            unsignedInteger(input.chargedCreditUnits),
            unsignedInteger(input.compensatedCreditUnits),
            input.occurredAt,
            input.startedAt ?? null,
            input.completedAt ?? null,
            input.attempts.reduce(
              (total, attempt) =>
                total + unsignedInteger(attempt.latencyMilliseconds),
              0n,
            ),
            input.status,
            input.failureCategory ?? null,
            JSON.stringify(input.attempts),
            input.multiCallWorkflowId,
            input.reconciliationState,
          ],
        ),
      );
      const created = await transaction.query<DetailRow>(
        sql(
          detailSelect +
            " WHERE detail.organization_id = $1 " +
            "AND detail.model_usage_event_id = $2",
          [context.organizationId, input.modelUsageEventId],
        ),
      );
      const row = created.rows[0];
      return row === undefined
        ? fail("version-conflict", "The model usage detail was not created.")
        : mapDetail(row);
    });
  }

  public async getUsageEventDetail(
    scope: AuthorizedOrganizationScope,
    modelUsageEventId: string,
  ): Promise<ModelUsageEventDetailRecord | null> {
    assertIdentifier(scope.organizationId);
    assertIdentifier(scope.principalId);
    assertIdentifier(scope.membershipId);
    assertIdentifier(modelUsageEventId);
    if (!scope.capabilities.includes("usage.read-technical")) {
      return fail("access-denied", "Technical usage access is not available.");
    }
    const result = await this.#database.query<DetailRow>(
      sql(
        detailSelect +
          " JOIN memberships membership ON membership.organization_id = " +
          "detail.organization_id AND membership.membership_id = $2 " +
          "AND membership.principal_id = $3 " +
          "WHERE detail.organization_id = $1 AND " +
          "detail.model_usage_event_id = $4 AND " +
          "membership.lifecycle_status = 'active'",
        [
          scope.organizationId,
          scope.membershipId,
          scope.principalId,
          modelUsageEventId,
        ],
      ),
    );
    return result.rows[0] === undefined ? null : mapDetail(result.rows[0]);
  }

  public async listReconciliationCandidates(
    context: TrustedCommercialAccountingContext,
    asOf: string,
  ): Promise<readonly ModelCommercialReconciliationCandidateRecord[]> {
    assertAccountingContext(context);
    assertTimestamp(asOf);
    const result = await this.#database.query<
      SqlRow & {
        readonly expires_at: unknown;
        readonly ledger_entry_id: unknown;
        readonly multi_call_workflow_id: unknown;
        readonly organization_id: unknown;
        readonly reconciliation_state: unknown;
        readonly reservation_id: unknown;
      }
    >(
      sql(
        "SELECT detail.organization_id, detail.ledger_entry_id, " +
          "detail.multi_call_workflow_id, event.reservation_id, " +
          "detail.reconciliation_state, NULL::TIMESTAMPTZ AS expires_at " +
          "FROM model_usage_event_details detail JOIN usage_ledger_entries event " +
          "ON event.organization_id = detail.organization_id " +
          "AND event.ledger_entry_id = detail.ledger_entry_id " +
          "WHERE detail.organization_id = $1 AND " +
          "detail.reconciliation_state IN ('pending-missing-usage','pending-settlement') " +
          "AND NOT EXISTS(SELECT 1 FROM credit_reservations settled " +
          "WHERE settled.organization_id=event.organization_id AND settled.reservation_id=event.reservation_id " +
          "AND settled.pricing_authority='model-provider-v1' AND settled.status<>'active') " +
          "UNION ALL SELECT reservation.organization_id, NULL, " +
          "reservation.request_id, reservation.reservation_id, " +
          "'expired-open', reservation.expires_at FROM credit_reservations reservation " +
          "WHERE reservation.organization_id = $1 AND reservation.status = 'active' " +
          "AND reservation.expires_at <= $2",
        [context.organizationId, asOf],
      ),
    );
    return result.rows.map((row) => {
      const expiresAt = readOptionalString(row.expires_at);
      const ledgerEntryId = readOptionalString(row.ledger_entry_id);
      return {
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(ledgerEntryId === undefined ? {} : { ledgerEntryId }),
        multiCallWorkflowId: readString(row.multi_call_workflow_id),
        organizationId: readString(row.organization_id),
        reconciliationState: readString(
          row.reconciliation_state,
        ) as ModelCommercialReconciliationCandidateRecord["reconciliationState"],
        reservationId: readString(row.reservation_id),
      };
    });
  }
}
