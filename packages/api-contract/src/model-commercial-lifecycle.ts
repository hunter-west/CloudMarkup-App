import { z } from "zod";

import {
  organizationIdSchema,
  principalIdSchema,
  projectIdSchema,
} from "./resources.js";
import { utcTimestampSchema } from "./common.js";
import {
  commercialFeatureKeySchema,
  commercialJobIdSchema,
  commercialModelIdentifierV1Schema,
  commercialProviderKeyV1Schema,
  commercialReasonCodeV1Schema,
  creditReservationIdSchema,
  creditUnitsSchema,
  monetaryMicrosSchema,
  providerPricingVersionIdSchema,
  safeIntegerSchema,
  usageEventIdSchema,
} from "./commercial.js";

const boundedLifecycleIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);

const boundedSafeExplanationSchema = z.string().min(1).max(1_000);
const providerUnitNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9.-]*$/u);

export const modelCommercialLifecycleContractVersionV1Schema = z.literal(1);
export const modelCommercialEnvironmentV1Schema = z.enum([
  "development",
  "test",
  "staging",
  "production",
]);
export const modelCommercialRouteV1Schema = z.enum(["standard", "deep"]);
export const modelCommercialRouteLabelV1Schema = z.enum([
  "Standard Design",
  "Deep Design",
]);
export const modelCommercialDenialReasonV1Schema = z.enum([
  "commercial-state-unavailable",
  "organization-suspended",
  "plan-not-entitled",
  "route-not-allowed",
  "model-not-allowed",
  "pricing-unavailable",
  "confirmation-required",
  "insufficient-credits",
  "per-user-request-limit-reached",
  "organization-concurrent-reservation-limit-reached",
  "feature-limit-reached",
  "maximum-input-exceeded",
  "maximum-output-exceeded",
  "reservation-denied",
  "cross-tenant-denied",
]);

export const modelCommercialProviderSpecificUnitsV1Schema = z
  .array(
    z
      .object({
        unitName: providerUnitNameSchema,
        units: creditUnitsSchema,
      })
      .strict(),
  )
  .max(64)
  .superRefine((units, context) => {
    const names = new Set<string>();
    for (const unit of units) {
      if (names.has(unit.unitName)) {
        context.addIssue({
          code: "custom",
          message: "Provider-specific unit names must be unique.",
        });
      }
      names.add(unit.unitName);
    }
  });

export const modelCommercialTechnicalUnitsV1Schema = z
  .object({
    cacheReadUnits: creditUnitsSchema,
    cacheWriteUnits: creditUnitsSchema,
    inputUnits: creditUnitsSchema,
    outputUnits: creditUnitsSchema,
    providerSpecificUnits: modelCommercialProviderSpecificUnitsV1Schema,
    totalUnits: creditUnitsSchema,
  })
  .strict()
  .superRefine((usage, context) => {
    const total =
      usage.cacheReadUnits +
      usage.cacheWriteUnits +
      usage.inputUnits +
      usage.outputUnits;
    if (!Number.isSafeInteger(total) || total !== usage.totalUnits) {
      context.addIssue({
        code: "custom",
        message:
          "Total units must equal input, output, cache-read, and cache-write units.",
        path: ["totalUnits"],
      });
    }
  });

export const modelCommercialCreditEstimateV1Schema = z
  .object({
    maximumCreditUnits: creditUnitsSchema.positive(),
    minimumCreditUnits: creditUnitsSchema,
    requiresConfirmation: z.boolean(),
  })
  .strict()
  .refine(
    (estimate) => estimate.minimumCreditUnits <= estimate.maximumCreditUnits,
    {
      message: "The credit estimate range cannot be inverted.",
      path: ["minimumCreditUnits"],
    },
  );

export const modelCommercialRoutePresentationV1Schema = z
  .object({
    explanation: boundedSafeExplanationSchema,
    label: modelCommercialRouteLabelV1Schema,
    route: modelCommercialRouteV1Schema,
  })
  .strict()
  .superRefine((route, context) => {
    if (
      (route.route === "standard" && route.label !== "Standard Design") ||
      (route.route === "deep" && route.label !== "Deep Design")
    ) {
      context.addIssue({
        code: "custom",
        message: "The route label must match the stable route.",
        path: ["label"],
      });
    }
  });

export const modelCommercialCompensationStatusV1Schema = z.enum([
  "not-required",
  "pending",
  "applied",
  "failed",
]);
export const modelUsageReconciliationStateV1Schema = z.enum([
  "not-required",
  "pending-missing-usage",
  "pending-settlement",
  "reconciled",
]);
export const modelCommercialLifecycleStateV1Schema = z.enum([
  "denied",
  "estimate-confirmation-required",
  "reservation-denied",
  "completed",
  "released",
  "compensated",
  "settlement-pending",
  "reconciliation-required",
]);

export const modelCommercialLifecycleResponseV1Schema = z
  .object({
    compensationStatus: modelCommercialCompensationStatusV1Schema,
    completedCreditUnits: creditUnitsSchema.nullable(),
    contractVersion: modelCommercialLifecycleContractVersionV1Schema,
    denialReason: modelCommercialDenialReasonV1Schema.nullable(),
    estimate: modelCommercialCreditEstimateV1Schema.nullable(),
    reconciliationState: modelUsageReconciliationStateV1Schema,
    reservation: z.discriminatedUnion("status", [
      z
        .object({
          reservationId: creditReservationIdSchema,
          status: z.literal("accepted"),
        })
        .strict(),
      z
        .object({
          reason: modelCommercialDenialReasonV1Schema,
          status: z.literal("denied"),
        })
        .strict(),
      z.object({ status: z.literal("not-requested") }).strict(),
    ]),
    route: modelCommercialRoutePresentationV1Schema.nullable(),
    state: modelCommercialLifecycleStateV1Schema,
    technicalUnits: modelCommercialTechnicalUnitsV1Schema.nullable(),
  })
  .strict()
  .superRefine((response, context) => {
    const denied = [
      "denied",
      "estimate-confirmation-required",
      "reservation-denied",
    ].includes(response.state);
    if (denied !== (response.denialReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Denied lifecycle states require one stable denial reason.",
        path: ["denialReason"],
      });
    }
    if (
      response.state === "estimate-confirmation-required" &&
      !response.estimate?.requiresConfirmation
    ) {
      context.addIssue({
        code: "custom",
        message: "Confirmation state requires a confirmation-bearing estimate.",
        path: ["estimate"],
      });
    }
    if (
      denied &&
      response.state !== "reservation-denied" &&
      response.reservation.status === "accepted"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Pre-reservation denial cannot report an accepted reservation.",
        path: ["reservation"],
      });
    }
    if (
      response.compensationStatus === "applied" &&
      response.state !== "compensated"
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied compensation requires the compensated state.",
        path: ["compensationStatus"],
      });
    }
  });

export const modelCommercialAttemptKindV1Schema = z.enum([
  "primary",
  "automatic-retry",
  "system-escalation",
  "repair",
]);
export const modelCommercialAttemptStatusV1Schema = z.enum([
  "succeeded",
  "provider-failure",
  "timed-out",
  "cancelled",
  "internal-failure",
]);

export const modelCommercialUsageAttemptV1Schema = z
  .object({
    attemptId: boundedLifecycleIdentifierSchema,
    attemptKind: modelCommercialAttemptKindV1Schema,
    attemptNumber: safeIntegerSchema.positive().max(100),
    callId: boundedLifecycleIdentifierSchema,
    completedAt: utcTimestampSchema,
    estimatedProviderCostMicros: monetaryMicrosSchema,
    failureCategory: commercialReasonCodeV1Schema.nullable(),
    inferenceProfileId: boundedLifecycleIdentifierSchema.nullable(),
    invocationId: boundedLifecycleIdentifierSchema,
    latencyMilliseconds: creditUnitsSchema,
    mayHaveBeenProcessed: z.boolean(),
    modelId: commercialModelIdentifierV1Schema,
    modelVersion: commercialModelIdentifierV1Schema,
    normalizationPolicyVersionId: boundedLifecycleIdentifierSchema,
    pricingVersionId: providerPricingVersionIdSchema,
    promptId: boundedLifecycleIdentifierSchema,
    promptVersion: boundedLifecycleIdentifierSchema,
    providerKey: commercialProviderKeyV1Schema,
    providerRequestId: boundedLifecycleIdentifierSchema.nullable(),
    retryOfAttemptId: boundedLifecycleIdentifierSchema.nullable(),
    routeId: boundedLifecycleIdentifierSchema,
    startedAt: utcTimestampSchema,
    status: modelCommercialAttemptStatusV1Schema,
    usage: modelCommercialTechnicalUnitsV1Schema,
    usageRecordId: boundedLifecycleIdentifierSchema,
  })
  .strict()
  .refine(
    (attempt) =>
      Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt),
    {
      message: "An attempt cannot complete before it starts.",
      path: ["completedAt"],
    },
  );

export const canonicalModelCommercialUsageEventV1Schema = z
  .object({
    attempts: z.array(modelCommercialUsageAttemptV1Schema).max(100),
    chargedCreditUnits: creditUnitsSchema,
    compensatedCreditUnits: creditUnitsSchema,
    completedAt: utcTimestampSchema.nullable(),
    contractVersion: modelCommercialLifecycleContractVersionV1Schema,
    environment: modelCommercialEnvironmentV1Schema,
    estimatedProviderCostMicros: monetaryMicrosSchema,
    eventId: usageEventIdSchema,
    failureCategory: commercialReasonCodeV1Schema.nullable(),
    feature: commercialFeatureKeySchema,
    idempotencyKey: boundedLifecycleIdentifierSchema,
    inferenceProfileId: boundedLifecycleIdentifierSchema.nullable(),
    jobId: commercialJobIdSchema,
    modelId: commercialModelIdentifierV1Schema,
    modelVersion: commercialModelIdentifierV1Schema,
    multiCallWorkflowId: boundedLifecycleIdentifierSchema,
    normalizationPolicyVersionId: boundedLifecycleIdentifierSchema,
    occurredAt: utcTimestampSchema,
    organizationId: organizationIdSchema,
    pricingVersionId: providerPricingVersionIdSchema,
    projectId: projectIdSchema,
    promptId: boundedLifecycleIdentifierSchema,
    promptVersion: boundedLifecycleIdentifierSchema,
    providerKey: commercialProviderKeyV1Schema,
    reconciliationState: modelUsageReconciliationStateV1Schema,
    requestId: boundedLifecycleIdentifierSchema,
    reservationId: creditReservationIdSchema,
    reservedCreditUnits: creditUnitsSchema,
    route: modelCommercialRouteV1Schema,
    routeId: boundedLifecycleIdentifierSchema,
    status: z.enum([
      "reserved",
      "completed",
      "released",
      "provider-failure",
      "cancelled",
      "internal-failure",
      "reconciliation-required",
      "compensated",
    ]),
    templateId: boundedLifecycleIdentifierSchema.nullable(),
    templateVersion: boundedLifecycleIdentifierSchema.nullable(),
    technicalUnits: modelCommercialTechnicalUnitsV1Schema,
    userId: principalIdSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if ((event.templateId === null) !== (event.templateVersion === null)) {
      context.addIssue({
        code: "custom",
        message: "Template identity and version are an all-or-none group.",
        path: ["templateId"],
      });
    }
    const attemptIds = new Set<string>();
    const usageRecordIds = new Set<string>();
    for (const attempt of event.attempts) {
      if (
        attemptIds.has(attempt.attemptId) ||
        usageRecordIds.has(attempt.usageRecordId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Attempt and usage-record identities must be unique.",
          path: ["attempts"],
        });
      }
      attemptIds.add(attempt.attemptId);
      usageRecordIds.add(attempt.usageRecordId);
    }
  });

export const modelProviderPricingVersionV1Schema = z
  .object({
    cacheReadMicrosPerMillionUnits: monetaryMicrosSchema.nullable(),
    cacheWriteMicrosPerMillionUnits: monetaryMicrosSchema.nullable(),
    contractVersion: modelCommercialLifecycleContractVersionV1Schema,
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
    effectiveFrom: utcTimestampSchema,
    effectiveUntil: utcTimestampSchema.nullable(),
    environment: modelCommercialEnvironmentV1Schema,
    inferenceProfileId: boundedLifecycleIdentifierSchema.nullable(),
    inputMicrosPerMillionUnits: monetaryMicrosSchema,
    modelId: commercialModelIdentifierV1Schema,
    modelVersion: commercialModelIdentifierV1Schema,
    outputMicrosPerMillionUnits: monetaryMicrosSchema,
    pricingVersionId: providerPricingVersionIdSchema,
    providerKey: commercialProviderKeyV1Schema,
    providerSpecificUnitRates: z
      .array(
        z
          .object({
            microsPerMillionUnits: monetaryMicrosSchema,
            unitName: providerUnitNameSchema,
          })
          .strict(),
      )
      .max(64),
    status: z.enum(["enabled", "disabled-pricing-unavailable"]),
  })
  .strict()
  .refine(
    (pricing) =>
      pricing.effectiveUntil === null ||
      Date.parse(pricing.effectiveUntil) > Date.parse(pricing.effectiveFrom),
    {
      message: "The provider-pricing effective range must be non-empty.",
      path: ["effectiveUntil"],
    },
  );

export const creditNormalizationPolicyVersionV1Schema = z
  .object({
    contractVersion: modelCommercialLifecycleContractVersionV1Schema,
    creditUnitMicros: monetaryMicrosSchema.refine(
      (value) => BigInt(value) > 0n,
      {
        message: "A credit unit must use positive integer monetary micros.",
      },
    ),
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
    effectiveFrom: utcTimestampSchema,
    effectiveUntil: utcTimestampSchema.nullable(),
    normalizationPolicyVersionId: boundedLifecycleIdentifierSchema,
    operatingBufferBasisPoints: safeIntegerSchema.nonnegative().max(1_000_000),
    status: z.enum(["enabled", "disabled"]),
  })
  .strict()
  .refine(
    (policy) =>
      policy.effectiveUntil === null ||
      Date.parse(policy.effectiveUntil) > Date.parse(policy.effectiveFrom),
    {
      message: "The normalization-policy effective range must be non-empty.",
      path: ["effectiveUntil"],
    },
  );

export const modelUsageSummaryRowV1Schema = z
  .object({
    chargedCreditUnits: creditUnitsSchema,
    compensatedCreditUnits: creditUnitsSchema,
    environment: modelCommercialEnvironmentV1Schema,
    eventCount: creditUnitsSchema,
    feature: commercialFeatureKeySchema,
    modelId: commercialModelIdentifierV1Schema.optional(),
    providerKey: commercialProviderKeyV1Schema.optional(),
    requestCount: creditUnitsSchema,
    route: modelCommercialRouteV1Schema,
  })
  .strict();

export const modelUsageSummaryV1Schema = z
  .object({
    asOf: utcTimestampSchema,
    contractVersion: modelCommercialLifecycleContractVersionV1Schema,
    organizationId: organizationIdSchema,
    periodEndsAt: utcTimestampSchema,
    periodStartsAt: utcTimestampSchema,
    rows: z.array(modelUsageSummaryRowV1Schema).max(10_000),
  })
  .strict()
  .refine(
    (summary) =>
      Date.parse(summary.periodEndsAt) > Date.parse(summary.periodStartsAt),
    {
      message: "The usage-summary period must be non-empty.",
      path: ["periodEndsAt"],
    },
  );

export type ModelCommercialLifecycleResponseV1 = z.output<
  typeof modelCommercialLifecycleResponseV1Schema
>;
export type CanonicalModelCommercialUsageEventV1 = z.output<
  typeof canonicalModelCommercialUsageEventV1Schema
>;
export type ModelProviderPricingVersionV1 = z.output<
  typeof modelProviderPricingVersionV1Schema
>;
export type CreditNormalizationPolicyVersionV1 = z.output<
  typeof creditNormalizationPolicyVersionV1Schema
>;
export type ModelUsageSummaryV1 = z.output<typeof modelUsageSummaryV1Schema>;
