export const MODEL_COMMERCIAL_POLICY_VERSION = 1 as const;

export type ModelCommercialEnvironmentV1 =
  "development" | "test" | "staging" | "production";

export interface ProviderSpecificUsageUnitV1 {
  readonly unitName: string;
  readonly units: number;
}

export interface ModelUsageUnitsV1 {
  readonly cacheReadUnits: number;
  readonly cacheWriteUnits: number;
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly providerSpecificUnits: readonly ProviderSpecificUsageUnitV1[];
  readonly totalUnits: number;
}

export interface ProviderSpecificUnitRateV1 {
  readonly microsPerMillionUnits: number;
  readonly unitName: string;
}

export interface ModelProviderPricingVersionV1 {
  readonly cacheReadMicrosPerMillionUnits: number | null;
  readonly cacheWriteMicrosPerMillionUnits: number | null;
  readonly currencyCode: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly environment: ModelCommercialEnvironmentV1;
  readonly inferenceProfileId: string | null;
  readonly inputMicrosPerMillionUnits: number;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly outputMicrosPerMillionUnits: number;
  readonly pricingVersionId: string;
  readonly providerKey: string;
  readonly providerSpecificUnitRates: readonly ProviderSpecificUnitRateV1[];
  readonly status: "enabled" | "disabled-pricing-unavailable";
  readonly version: typeof MODEL_COMMERCIAL_POLICY_VERSION;
}

export interface CreditNormalizationPolicyVersionV1 {
  readonly creditUnitMicros: number;
  readonly currencyCode: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly normalizationPolicyVersionId: string;
  readonly operatingBufferBasisPoints: number;
  readonly status: "enabled" | "disabled";
  readonly version: typeof MODEL_COMMERCIAL_POLICY_VERSION;
}

export interface ModelProviderCostV1 {
  readonly currencyCode: string;
  readonly estimatedProviderCostMicros: number;
  readonly pricingVersionId: string;
  readonly usage: ModelUsageUnitsV1;
}

export interface NormalizedModelCreditUsageV1 extends ModelProviderCostV1 {
  readonly cloudMarkupCreditUnits: number;
  readonly normalizationPolicyVersionId: string;
  readonly normalizedCostMicros: number;
  readonly operatingBufferMicros: number;
}

export interface ModelCreditEstimateRangeV1 {
  readonly maximumCreditUnits: number;
  readonly minimumCreditUnits: number;
  readonly normalizationPolicyVersionId: string;
  readonly pricingVersionId: string;
}

export type ModelCommercialPolicyErrorCode =
  | "idempotency-conflict"
  | "invalid-input"
  | "normalization-policy-unavailable"
  | "overlapping-effective-range"
  | "pricing-unavailable";

export class ModelCommercialPolicyError extends Error {
  public readonly code: ModelCommercialPolicyErrorCode;

  public constructor(code: ModelCommercialPolicyErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ModelCommercialPolicyError";
  }
}

function fail(code: ModelCommercialPolicyErrorCode, message: string): never {
  throw new ModelCommercialPolicyError(code, message);
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value)) {
    fail("invalid-input", label + " must be a bounded opaque identifier.");
  }
}

function assertUnitName(value: string, label: string): void {
  if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(value)) {
    fail("invalid-input", label + " must be a bounded lowercase unit name.");
  }
}

function assertNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("invalid-input", label + " must be a nonnegative safe integer.");
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("invalid-input", label + " must be a positive safe integer.");
  }
}

function parseInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail("invalid-input", label + " must be a canonical UTC timestamp.");
  }
  return parsed;
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    fail("invalid-input", label + " exceeds the supported integer range.");
  }
  return result;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function safeBigIntToNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("invalid-input", label + " exceeds the supported integer range.");
  }
  return Number(value);
}

function validateRange(fromValue: string, untilValue: string | null): void {
  const from = parseInstant(fromValue, "effectiveFrom");
  if (
    untilValue !== null &&
    parseInstant(untilValue, "effectiveUntil") <= from
  ) {
    fail("invalid-input", "The effective range must be non-empty.");
  }
}

export function validateModelUsageUnitsV1(usage: ModelUsageUnitsV1): void {
  for (const [label, units] of [
    ["cacheReadUnits", usage.cacheReadUnits],
    ["cacheWriteUnits", usage.cacheWriteUnits],
    ["inputUnits", usage.inputUnits],
    ["outputUnits", usage.outputUnits],
    ["totalUnits", usage.totalUnits],
  ] as const) {
    assertNonnegativeInteger(units, label);
  }
  const totalUnits = [
    usage.cacheReadUnits,
    usage.cacheWriteUnits,
    usage.inputUnits,
    usage.outputUnits,
  ].reduce((total, units) => checkedAdd(total, units, "totalUnits"), 0);
  if (usage.totalUnits !== totalUnits) {
    fail(
      "invalid-input",
      "totalUnits must equal input, output, cache-read, and cache-write units.",
    );
  }
  const names = new Set<string>();
  for (const unit of usage.providerSpecificUnits) {
    assertUnitName(unit.unitName, "providerSpecificUnits.unitName");
    assertNonnegativeInteger(
      unit.units,
      "providerSpecificUnits." + unit.unitName,
    );
    if (names.has(unit.unitName)) {
      fail("invalid-input", "Provider-specific usage units must be unique.");
    }
    names.add(unit.unitName);
  }
}

export function validateModelProviderPricingVersionV1(
  pricing: ModelProviderPricingVersionV1,
): void {
  for (const [label, value] of [
    ["pricingVersionId", pricing.pricingVersionId],
    ["providerKey", pricing.providerKey],
    ["modelId", pricing.modelId],
    ["modelVersion", pricing.modelVersion],
  ] as const) {
    assertIdentifier(value, label);
  }
  if (pricing.inferenceProfileId !== null) {
    assertIdentifier(pricing.inferenceProfileId, "inferenceProfileId");
  }
  if (!/^[A-Z]{3}$/u.test(pricing.currencyCode)) {
    fail("invalid-input", "The pricing currency must use an ISO-style code.");
  }
  if (
    !(["development", "test", "staging", "production"] as const).includes(
      pricing.environment,
    )
  ) {
    fail("invalid-input", "The pricing environment is unsupported.");
  }
  if (
    !(["enabled", "disabled-pricing-unavailable"] as const).includes(
      pricing.status,
    )
  ) {
    fail("invalid-input", "The provider-pricing status is unsupported.");
  }
  assertNonnegativeInteger(
    pricing.inputMicrosPerMillionUnits,
    "inputMicrosPerMillionUnits",
  );
  assertNonnegativeInteger(
    pricing.outputMicrosPerMillionUnits,
    "outputMicrosPerMillionUnits",
  );
  for (const [label, rate] of [
    ["cacheReadMicrosPerMillionUnits", pricing.cacheReadMicrosPerMillionUnits],
    [
      "cacheWriteMicrosPerMillionUnits",
      pricing.cacheWriteMicrosPerMillionUnits,
    ],
  ] as const) {
    if (rate !== null) {
      assertNonnegativeInteger(rate, label);
    }
  }
  const names = new Set<string>();
  for (const rate of pricing.providerSpecificUnitRates) {
    assertUnitName(rate.unitName, "providerSpecificUnitRates.unitName");
    assertNonnegativeInteger(
      rate.microsPerMillionUnits,
      "providerSpecificUnitRates." + rate.unitName,
    );
    if (names.has(rate.unitName)) {
      fail("invalid-input", "Provider-specific pricing rates must be unique.");
    }
    names.add(rate.unitName);
  }
  validateRange(pricing.effectiveFrom, pricing.effectiveUntil);
}

export function validateCreditNormalizationPolicyVersionV1(
  policy: CreditNormalizationPolicyVersionV1,
): void {
  assertIdentifier(
    policy.normalizationPolicyVersionId,
    "normalizationPolicyVersionId",
  );
  if (!/^[A-Z]{3}$/u.test(policy.currencyCode)) {
    fail("invalid-input", "The normalization currency is invalid.");
  }
  assertPositiveInteger(policy.creditUnitMicros, "creditUnitMicros");
  assertNonnegativeInteger(
    policy.operatingBufferBasisPoints,
    "operatingBufferBasisPoints",
  );
  if (policy.operatingBufferBasisPoints > 1_000_000) {
    fail("invalid-input", "The operating buffer is outside the safe bound.");
  }
  validateRange(policy.effectiveFrom, policy.effectiveUntil);
}

function rangesOverlap(
  leftFrom: string,
  leftUntil: string | null,
  rightFrom: string,
  rightUntil: string | null,
): boolean {
  const leftStart = parseInstant(leftFrom, "effectiveFrom");
  const leftEnd =
    leftUntil === null
      ? Number.POSITIVE_INFINITY
      : parseInstant(leftUntil, "effectiveUntil");
  const rightStart = parseInstant(rightFrom, "effectiveFrom");
  const rightEnd =
    rightUntil === null
      ? Number.POSITIVE_INFINITY
      : parseInstant(rightUntil, "effectiveUntil");
  return leftStart < rightEnd && rightStart < leftEnd;
}

function pricingScope(pricing: ModelProviderPricingVersionV1): string {
  return JSON.stringify([
    pricing.providerKey,
    pricing.modelId,
    pricing.modelVersion,
    pricing.inferenceProfileId,
    pricing.environment,
  ]);
}

export function validateModelProviderPricingHistoryV1(
  pricingVersions: readonly ModelProviderPricingVersionV1[],
): void {
  const ids = new Set<string>();
  for (const pricing of pricingVersions) {
    validateModelProviderPricingVersionV1(pricing);
    if (ids.has(pricing.pricingVersionId)) {
      fail(
        "idempotency-conflict",
        "Provider-pricing identities must be unique.",
      );
    }
    ids.add(pricing.pricingVersionId);
  }
  for (let leftIndex = 0; leftIndex < pricingVersions.length; leftIndex += 1) {
    const left = pricingVersions[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < pricingVersions.length;
      rightIndex += 1
    ) {
      const right = pricingVersions[rightIndex];
      if (
        right !== undefined &&
        pricingScope(left) === pricingScope(right) &&
        rangesOverlap(
          left.effectiveFrom,
          left.effectiveUntil,
          right.effectiveFrom,
          right.effectiveUntil,
        )
      ) {
        fail(
          "overlapping-effective-range",
          "Provider-pricing effective ranges cannot overlap within a model scope.",
        );
      }
    }
  }
}

export function validateCreditNormalizationPolicyHistoryV1(
  policies: readonly CreditNormalizationPolicyVersionV1[],
): void {
  const ids = new Set<string>();
  for (const policy of policies) {
    validateCreditNormalizationPolicyVersionV1(policy);
    if (ids.has(policy.normalizationPolicyVersionId)) {
      fail(
        "idempotency-conflict",
        "Credit-normalization policy identities must be unique.",
      );
    }
    ids.add(policy.normalizationPolicyVersionId);
  }
  for (let leftIndex = 0; leftIndex < policies.length; leftIndex += 1) {
    const left = policies[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < policies.length;
      rightIndex += 1
    ) {
      const right = policies[rightIndex];
      if (left.currencyCode !== right?.currencyCode) continue;
      if (
        rangesOverlap(
          left.effectiveFrom,
          left.effectiveUntil,
          right.effectiveFrom,
          right.effectiveUntil,
        )
      ) {
        fail(
          "overlapping-effective-range",
          "Credit-normalization policy effective ranges cannot overlap.",
        );
      }
    }
  }
}

export interface ModelPricingSelectionV1 {
  readonly at: string;
  readonly environment: ModelCommercialEnvironmentV1;
  readonly inferenceProfileId: string | null;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly providerKey: string;
}

export function selectModelProviderPricingVersionV1(
  pricingVersions: readonly ModelProviderPricingVersionV1[],
  selection: ModelPricingSelectionV1,
): ModelProviderPricingVersionV1 {
  validateModelProviderPricingHistoryV1(pricingVersions);
  const at = parseInstant(selection.at, "at");
  const matches = pricingVersions.filter(
    (pricing) =>
      pricing.providerKey === selection.providerKey &&
      pricing.modelId === selection.modelId &&
      pricing.modelVersion === selection.modelVersion &&
      pricing.inferenceProfileId === selection.inferenceProfileId &&
      pricing.environment === selection.environment &&
      parseInstant(pricing.effectiveFrom, "effectiveFrom") <= at &&
      (pricing.effectiveUntil === null ||
        at < parseInstant(pricing.effectiveUntil, "effectiveUntil")),
  );
  if (matches.length !== 1 || matches[0]?.status !== "enabled") {
    fail(
      "pricing-unavailable",
      "Trustworthy provider pricing is unavailable for this model execution.",
    );
  }
  return matches[0];
}

export function selectCreditNormalizationPolicyVersionV1(
  policies: readonly CreditNormalizationPolicyVersionV1[],
  atValue: string,
  currencyCode: string,
): CreditNormalizationPolicyVersionV1 {
  validateCreditNormalizationPolicyHistoryV1(policies);
  const at = parseInstant(atValue, "at");
  const matches = policies.filter(
    (policy) =>
      policy.currencyCode === currencyCode &&
      parseInstant(policy.effectiveFrom, "effectiveFrom") <= at &&
      (policy.effectiveUntil === null ||
        at < parseInstant(policy.effectiveUntil, "effectiveUntil")),
  );
  if (matches.length !== 1 || matches[0]?.status !== "enabled") {
    fail(
      "normalization-policy-unavailable",
      "A trustworthy credit-normalization policy is unavailable.",
    );
  }
  return matches[0];
}

function providerSpecificRate(
  pricing: ModelProviderPricingVersionV1,
  unitName: string,
): number {
  const rate = pricing.providerSpecificUnitRates.find(
    (candidate) => candidate.unitName === unitName,
  );
  if (rate === undefined) {
    fail(
      "pricing-unavailable",
      "Provider-specific unit " + unitName + " has no trustworthy price.",
    );
  }
  return rate.microsPerMillionUnits;
}

export function calculateModelProviderCostV1(
  pricing: ModelProviderPricingVersionV1,
  usage: ModelUsageUnitsV1,
): ModelProviderCostV1 {
  validateModelProviderPricingVersionV1(pricing);
  validateModelUsageUnitsV1(usage);
  if (pricing.status !== "enabled") {
    fail("pricing-unavailable", "The selected provider pricing is disabled.");
  }
  if (
    usage.cacheReadUnits > 0 &&
    pricing.cacheReadMicrosPerMillionUnits === null
  ) {
    fail("pricing-unavailable", "Cache-read usage has no trustworthy price.");
  }
  if (
    usage.cacheWriteUnits > 0 &&
    pricing.cacheWriteMicrosPerMillionUnits === null
  ) {
    fail("pricing-unavailable", "Cache-write usage has no trustworthy price.");
  }
  let numerator =
    BigInt(usage.inputUnits) * BigInt(pricing.inputMicrosPerMillionUnits) +
    BigInt(usage.outputUnits) * BigInt(pricing.outputMicrosPerMillionUnits) +
    BigInt(usage.cacheReadUnits) *
      BigInt(pricing.cacheReadMicrosPerMillionUnits ?? 0) +
    BigInt(usage.cacheWriteUnits) *
      BigInt(pricing.cacheWriteMicrosPerMillionUnits ?? 0);
  for (const unit of usage.providerSpecificUnits) {
    numerator +=
      BigInt(unit.units) * BigInt(providerSpecificRate(pricing, unit.unitName));
  }
  return {
    currencyCode: pricing.currencyCode,
    estimatedProviderCostMicros: safeBigIntToNumber(
      numerator === 0n ? 0n : ceilDivide(numerator, 1_000_000n),
      "estimatedProviderCostMicros",
    ),
    pricingVersionId: pricing.pricingVersionId,
    usage: {
      ...usage,
      providerSpecificUnits: usage.providerSpecificUnits.map((unit) => ({
        ...unit,
      })),
    },
  };
}

export function normalizeModelProviderCostToCreditsV1(
  providerCost: ModelProviderCostV1,
  policy: CreditNormalizationPolicyVersionV1,
): NormalizedModelCreditUsageV1 {
  validateCreditNormalizationPolicyVersionV1(policy);
  if (policy.status !== "enabled") {
    fail(
      "normalization-policy-unavailable",
      "The selected credit-normalization policy is disabled.",
    );
  }
  if (providerCost.currencyCode !== policy.currencyCode) {
    fail(
      "invalid-input",
      "Provider cost and credit-normalization currencies must match.",
    );
  }
  assertNonnegativeInteger(
    providerCost.estimatedProviderCostMicros,
    "estimatedProviderCostMicros",
  );
  const providerMicros = BigInt(providerCost.estimatedProviderCostMicros);
  const bufferMicros =
    providerMicros === 0n
      ? 0n
      : ceilDivide(
          providerMicros * BigInt(policy.operatingBufferBasisPoints),
          10_000n,
        );
  const normalizedMicros = providerMicros + bufferMicros;
  const credits =
    normalizedMicros === 0n
      ? 0n
      : ceilDivide(normalizedMicros, BigInt(policy.creditUnitMicros));
  return {
    ...providerCost,
    cloudMarkupCreditUnits: safeBigIntToNumber(
      credits,
      "cloudMarkupCreditUnits",
    ),
    normalizationPolicyVersionId: policy.normalizationPolicyVersionId,
    normalizedCostMicros: safeBigIntToNumber(
      normalizedMicros,
      "normalizedCostMicros",
    ),
    operatingBufferMicros: safeBigIntToNumber(
      bufferMicros,
      "operatingBufferMicros",
    ),
  };
}

function assertUsageRange(
  minimum: ModelUsageUnitsV1,
  maximum: ModelUsageUnitsV1,
): void {
  validateModelUsageUnitsV1(minimum);
  validateModelUsageUnitsV1(maximum);
  for (const [label, minimumValue, maximumValue] of [
    ["cacheReadUnits", minimum.cacheReadUnits, maximum.cacheReadUnits],
    ["cacheWriteUnits", minimum.cacheWriteUnits, maximum.cacheWriteUnits],
    ["inputUnits", minimum.inputUnits, maximum.inputUnits],
    ["outputUnits", minimum.outputUnits, maximum.outputUnits],
    ["totalUnits", minimum.totalUnits, maximum.totalUnits],
  ] as const) {
    if (minimumValue > maximumValue) {
      fail("invalid-input", label + " has an inverted estimate range.");
    }
  }
  const maximumProviderUnits = new Map(
    maximum.providerSpecificUnits.map((unit) => [unit.unitName, unit.units]),
  );
  for (const unit of minimum.providerSpecificUnits) {
    if (unit.units > (maximumProviderUnits.get(unit.unitName) ?? -1)) {
      fail(
        "invalid-input",
        "Provider-specific unit " +
          unit.unitName +
          " has an inverted estimate range.",
      );
    }
  }
}

export function estimateModelCreditRangeV1(
  pricing: ModelProviderPricingVersionV1,
  policy: CreditNormalizationPolicyVersionV1,
  minimumUsage: ModelUsageUnitsV1,
  maximumUsage: ModelUsageUnitsV1,
): ModelCreditEstimateRangeV1 {
  assertUsageRange(minimumUsage, maximumUsage);
  const minimum = normalizeModelProviderCostToCreditsV1(
    calculateModelProviderCostV1(pricing, minimumUsage),
    policy,
  );
  const maximum = normalizeModelProviderCostToCreditsV1(
    calculateModelProviderCostV1(pricing, maximumUsage),
    policy,
  );
  if (minimum.cloudMarkupCreditUnits > maximum.cloudMarkupCreditUnits) {
    fail("invalid-input", "The calculated credit estimate range is inverted.");
  }
  return {
    maximumCreditUnits: maximum.cloudMarkupCreditUnits,
    minimumCreditUnits: minimum.cloudMarkupCreditUnits,
    normalizationPolicyVersionId: policy.normalizationPolicyVersionId,
    pricingVersionId: pricing.pricingVersionId,
  };
}

export function aggregateModelUsageUnitsV1(
  usages: readonly ModelUsageUnitsV1[],
): ModelUsageUnitsV1 {
  const providerUnits = new Map<string, number>();
  let cacheReadUnits = 0;
  let cacheWriteUnits = 0;
  let inputUnits = 0;
  let outputUnits = 0;
  for (const usage of usages) {
    validateModelUsageUnitsV1(usage);
    cacheReadUnits = checkedAdd(
      cacheReadUnits,
      usage.cacheReadUnits,
      "cacheReadUnits",
    );
    cacheWriteUnits = checkedAdd(
      cacheWriteUnits,
      usage.cacheWriteUnits,
      "cacheWriteUnits",
    );
    inputUnits = checkedAdd(inputUnits, usage.inputUnits, "inputUnits");
    outputUnits = checkedAdd(outputUnits, usage.outputUnits, "outputUnits");
    for (const unit of usage.providerSpecificUnits) {
      providerUnits.set(
        unit.unitName,
        checkedAdd(
          providerUnits.get(unit.unitName) ?? 0,
          unit.units,
          "providerSpecificUnits." + unit.unitName,
        ),
      );
    }
  }
  const totalUnits = [
    cacheReadUnits,
    cacheWriteUnits,
    inputUnits,
    outputUnits,
  ].reduce((total, units) => checkedAdd(total, units, "totalUnits"), 0);
  return {
    cacheReadUnits,
    cacheWriteUnits,
    inputUnits,
    outputUnits,
    providerSpecificUnits: [...providerUnits.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([unitName, units]) => ({ unitName, units })),
    totalUnits,
  };
}
