import {
  activeIssueSeveritySchema,
  conformanceDifferenceKindV1Schema,
  conformanceEvidenceCompletenessV1Schema,
  conformanceEvidenceFreshnessV1Schema,
  conformanceLayerAvailabilityV1Schema,
  CONFORMANCE_V1_LIMITS,
  conformanceViewLayerV1Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export const architectureCliConformanceSummaryV1Schema = z
  .object({
    contractVersion: z.literal(1),
    counts: z
      .object({
        byKind: z
          .array(
            z
              .object({
                count: z
                  .number()
                  .int()
                  .nonnegative()
                  .max(CONFORMANCE_V1_LIMITS.reportEntries),
                kind: conformanceDifferenceKindV1Schema,
              })
              .strict(),
          )
          .max(conformanceDifferenceKindV1Schema.options.length),
        byLayer: z
          .array(
            z
              .object({
                count: z
                  .number()
                  .int()
                  .nonnegative()
                  .max(CONFORMANCE_V1_LIMITS.reportEntries),
                layer: conformanceViewLayerV1Schema,
              })
              .strict(),
          )
          .length(6),
        bySeverity: z
          .array(
            z
              .object({
                count: z
                  .number()
                  .int()
                  .nonnegative()
                  .max(CONFORMANCE_V1_LIMITS.reportEntries),
                severity: activeIssueSeveritySchema,
              })
              .strict(),
          )
          .max(activeIssueSeveritySchema.options.length),
      })
      .strict(),
    differenceIds: z
      .array(solutionStableIdSchema)
      .max(CONFORMANCE_V1_LIMITS.reportEntries),
    evaluatedAt: utcTimestampSchema,
    issueIds: z
      .array(solutionStableIdSchema)
      .max(CONFORMANCE_V1_LIMITS.reportEntries),
    layers: z
      .array(
        z
          .object({
            availability: conformanceLayerAvailabilityV1Schema,
            completeness: conformanceEvidenceCompletenessV1Schema,
            freshness: conformanceEvidenceFreshnessV1Schema,
            layer: conformanceViewLayerV1Schema,
          })
          .strict(),
      )
      .length(6),
    mutationPolicy: z.literal("review-only-no-auto-remediation"),
    reportDigest: sha256DigestSchema,
    reportId: solutionStableIdSchema,
  })
  .strict();

export type ArchitectureCliConformanceSummaryV1 = z.output<
  typeof architectureCliConformanceSummaryV1Schema
>;
