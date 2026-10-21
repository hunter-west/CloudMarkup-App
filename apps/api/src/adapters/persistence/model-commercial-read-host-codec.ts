import {
  validateCreditNormalizationPolicyVersionV1,
  validateModelProviderPricingVersionV1,
  type CreditNormalizationPolicyVersionV1,
  type ModelProviderPricingVersionV1,
} from "@cloudmarkup/domain";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import type {
  CreditNormalizationPolicyVersionRecord,
  ModelProviderPricingVersionRecord,
} from "../../application/model-commercial-persistence.js";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import {
  parseRuntimeRecord,
  type RuntimeAdmissionScope,
  type RuntimeAdmissionRecord,
} from "./model-runtime-admission-codec.js";
import {
  parseLiveRuntimeRecord,
  type LiveRuntimeAdmissionRecord,
} from "./model-live-runtime-admission-codec.js";
import {
  parseSeedRuntimeRecordV4,
  type SeedRuntimeAdmissionRecordV4,
} from "./model-live-seed-runtime-admission-codec.js";
import type { SqlRow } from "./sql.js";

/** Same strict metadata/ownership parity as the durable admission store's row
 * reader, plus the selected database expiry. SQL constraints remain unchanged. */
export function parseModelReadRuntimeRow(
  row: SqlRow,
  scope: RuntimeAdmissionScope,
): RuntimeAdmissionRecord {
  const record = parseRuntimeRecord(row["snapshot"], scope);
  assertModelReadRuntimeRow(row, record);
  return record;
}
export function parseModelLiveReadRuntimeRow(
  row: SqlRow,
  scope: RuntimeAdmissionScope,
): LiveRuntimeAdmissionRecord {
  const record = parseLiveRuntimeRecord(row["snapshot"], scope);
  assertModelReadRuntimeRow(row, record);
  return record;
}
export function parseModelSeedSequenceReadRuntimeRowV4(
  row: SqlRow,
  scope: RuntimeAdmissionScope,
): SeedRuntimeAdmissionRecordV4 {
  const record = parseSeedRuntimeRecordV4(row["snapshot"], scope);
  assertModelReadRuntimeRow(row, record);
  return record;
}
function assertModelReadRuntimeRow(
  row: SqlRow,
  record:
    | RuntimeAdmissionRecord
    | LiveRuntimeAdmissionRecord
    | SeedRuntimeAdmissionRecordV4,
): void {
  modelReadAssert(
    row["scope_sha256"] === record.tenantScopeDigest.slice(7) &&
      row["snapshot_sha256"] === digestStructuredValue(record).slice(7) &&
      row["organization_id"] === record.request.organizationId &&
      row["project_id"] === record.request.projectId &&
      row["principal_id"] === record.request.userId &&
      modelReadNumber(row["revision"]) === record.revision &&
      row["active_concurrency_lease_id"] ===
        (record.executionLease === null ? null : record.concurrencyLeaseId) &&
      (record.executionLease === null
        ? row["lease_expires_at"] === null
        : typeof row["lease_expires_at"] === "string" &&
          Date.parse(row["lease_expires_at"]) ===
            Date.parse(record.executionLease.expiresAt)),
  );
}

export function modelReadAssert(condition: boolean): asserts condition {
  if (!condition)
    throw new CommercialPersistenceError(
      "access-denied",
      "Current model commercial authority is unavailable.",
    );
}
export function modelReadNumber(value: unknown): number {
  modelReadAssert(
    typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value),
  );
  const parsed = Number(value);
  modelReadAssert(Number.isSafeInteger(parsed) && parsed >= 0);
  return parsed;
}
const modelReadInstant = (value: string): string => {
  const instant = Date.parse(value);
  modelReadAssert(Number.isFinite(instant));
  return new Date(instant).toISOString();
};
const selectorsSchema = z
  .object({
    contractVersion: z.literal(1),
    pricingVersionId: namespacedIdentifierSchema,
    pricingVersionDigest: sha256DigestSchema,
    normalizationPolicyVersionId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u),
    normalizationPolicyDigest: sha256DigestSchema,
    runtimePolicyId: namespacedIdentifierSchema,
    runtimePolicyVersion: semanticVersionSchema,
    runtimePolicyDigest: sha256DigestSchema,
    routeId: z.literal("standard-design"),
    routeDefinitionDigest: sha256DigestSchema,
    modelConfigurationReference: namespacedIdentifierSchema,
  })
  .strict();
export type ModelCommercialReadSelectorsV1 = z.output<typeof selectorsSchema>;

/** Closed host selectors, not a permission object. IDs/digests identify exact
 * existing rows; they never supply prices, limits, credit or activation. */
export function parseModelCommercialReadSelectors(
  value: unknown,
): ModelCommercialReadSelectorsV1 {
  assertSelectorRecord(value);
  const parsed = selectorsSchema.safeParse(value);
  modelReadAssert(parsed.success);
  return parsed.data;
}

const liveSelectorsSchema = selectorsSchema
  .extend({
    contractVersion: z.literal(2),
    executionClass: z.literal("live-evaluation"),
    routeId: z.enum(["standard-design", "deep-design"]),
  })
  .strict();
export type ModelLiveCommercialReadSelectorsV2 = z.output<
  typeof liveSelectorsSchema
>;
export function parseModelLiveCommercialReadSelectors(
  value: unknown,
): ModelLiveCommercialReadSelectorsV2 {
  assertSelectorRecord(value);
  const parsed = liveSelectorsSchema.safeParse(value);
  modelReadAssert(parsed.success);
  return parsed.data;
}
/** Explicit V3 repair selectors. V1/V2 entry points remain unchanged. */
const sequenceSelectorsSchema = liveSelectorsSchema
  .extend({
    contractVersion: z.literal(3),
    routeId: z.literal("internal-escalation"),
  })
  .strict();
export type ModelLiveSequenceCommercialReadSelectorsV3 = z.output<
  typeof sequenceSelectorsSchema
>;
export function parseModelLiveSequenceCommercialReadSelectorsV3(
  value: unknown,
): ModelLiveSequenceCommercialReadSelectorsV3 {
  assertSelectorRecord(value);
  const parsed = sequenceSelectorsSchema.safeParse(value);
  modelReadAssert(parsed.success);
  return parsed.data;
}

function assertSelectorRecord(value: unknown): void {
  modelReadAssert(
    value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    modelReadAssert(
      typeof key === "string" &&
        descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true,
    );
  }
}

export function projectModelReadPrice(
  record: ModelProviderPricingVersionRecord,
): ModelProviderPricingVersionV1 {
  const price: ModelProviderPricingVersionV1 = {
    version: 1,
    pricingVersionId: record.pricingVersionId,
    providerKey: record.providerKey,
    modelId: record.modelId,
    modelVersion: record.modelVersion,
    inferenceProfileId: record.inferenceProfileId ?? null,
    environment: record.environment,
    currencyCode: record.costCurrency,
    effectiveFrom: modelReadInstant(record.effectiveFrom),
    effectiveUntil:
      record.effectiveUntil === undefined
        ? null
        : modelReadInstant(record.effectiveUntil),
    status: record.status,
    inputMicrosPerMillionUnits: modelReadNumber(
      record.inputMicrosPerMillionUnits,
    ),
    outputMicrosPerMillionUnits: modelReadNumber(
      record.outputMicrosPerMillionUnits,
    ),
    cacheReadMicrosPerMillionUnits:
      record.cacheReadMicrosPerMillionUnits === undefined
        ? null
        : modelReadNumber(record.cacheReadMicrosPerMillionUnits),
    cacheWriteMicrosPerMillionUnits:
      record.cacheWriteMicrosPerMillionUnits === undefined
        ? null
        : modelReadNumber(record.cacheWriteMicrosPerMillionUnits),
    providerSpecificUnitRates: record.providerSpecificUnitRates.map(
      (entry) => ({
        unitName: entry.unitName,
        microsPerMillionUnits: modelReadNumber(entry.microsPerMillionUnits),
      }),
    ),
  };
  validateModelProviderPricingVersionV1(price);
  return price;
}
export function projectModelReadNormalization(
  record: CreditNormalizationPolicyVersionRecord,
): CreditNormalizationPolicyVersionV1 {
  const policy: CreditNormalizationPolicyVersionV1 = {
    version: 1,
    normalizationPolicyVersionId: record.normalizationPolicyVersionId,
    currencyCode: record.costCurrency,
    effectiveFrom: modelReadInstant(record.effectiveFrom),
    effectiveUntil:
      record.effectiveUntil === undefined
        ? null
        : modelReadInstant(record.effectiveUntil),
    status: record.status,
    creditUnitMicros: modelReadNumber(record.creditUnitMicros),
    operatingBufferBasisPoints: modelReadNumber(
      record.operatingBufferBasisPoints,
    ),
  };
  validateCreditNormalizationPolicyVersionV1(policy);
  return policy;
}
export const sameModelReadValue = (left: unknown, right: unknown): boolean =>
  digestStructuredValue(left) === digestStructuredValue(right);
