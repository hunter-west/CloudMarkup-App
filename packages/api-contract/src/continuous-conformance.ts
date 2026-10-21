import {
  conformanceViewLayerV1Schema,
  conformanceReportV1Schema,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import { createDataEnvelopeSchema } from "./common.js";
import { environmentIdSchema, projectIdSchema } from "./resources.js";

export const continuousConformancePathV1Schema = z
  .object({
    environmentId: environmentIdSchema,
    projectId: projectIdSchema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict();

export const continuousConformanceReviewActionKindV1Schema = z.enum([
  "github-issue",
  "reconciliation-pr",
]);

export const continuousConformanceAvailableReviewActionsV1Schema = z
  .array(
    z
      .object({
        actions: z
          .array(
            z
              .object({
                actionKey: solutionStableIdSchema,
                kind: continuousConformanceReviewActionKindV1Schema,
              })
              .strict(),
          )
          .max(8),
        differenceId: solutionStableIdSchema,
      })
      .strict(),
  )
  .max(10_000);

export const continuousConformanceViewV1Schema = z
  .object({
    availableReviewActions: continuousConformanceAvailableReviewActionsV1Schema,
    report: conformanceReportV1Schema,
  })
  .strict();

export const continuousConformanceResponseV1Schema = createDataEnvelopeSchema(
  continuousConformanceViewV1Schema,
);

export const exportContinuousConformanceDiagramV1Schema = z
  .object({
    contractVersion: z.literal(1),
    reportDigest: sha256DigestSchema,
    reportId: solutionStableIdSchema,
    showDifferences: z.boolean(),
    state: conformanceViewLayerV1Schema,
  })
  .strict();

export const continuousConformanceDiagramResultV1Schema = z
  .object({
    artifact: z
      .object({
        artifactId: solutionStableIdSchema,
        checksum: sha256DigestSchema,
        mediaType: z.literal("image/svg+xml"),
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(2 * 1024 * 1024),
      })
      .strict(),
    contractVersion: z.literal(1),
    reportDigest: sha256DigestSchema,
    reportId: solutionStableIdSchema,
    showDifferences: z.boolean(),
    state: conformanceViewLayerV1Schema,
    svg: z
      .string()
      .min(1)
      .max(2 * 1024 * 1024),
  })
  .strict();

export const continuousConformanceDiagramResponseV1Schema =
  createDataEnvelopeSchema(continuousConformanceDiagramResultV1Schema);

export const reviewContinuousConformanceActionV1Schema = z
  .object({
    actionKey: solutionStableIdSchema,
    contractVersion: z.literal(1),
    differenceId: solutionStableIdSchema,
    kind: continuousConformanceReviewActionKindV1Schema,
    reportDigest: sha256DigestSchema,
    reportId: solutionStableIdSchema,
  })
  .strict();

export const continuousConformanceReviewActionResultV1Schema = z
  .object({
    actionKey: solutionStableIdSchema,
    contractVersion: z.literal(1),
    differenceId: solutionStableIdSchema,
    kind: continuousConformanceReviewActionKindV1Schema,
    receipt: z
      .object({
        actionId: solutionStableIdSchema,
        createdAt: z.iso.datetime({ offset: true }),
        mergeAuthority: z.literal("none"),
        providerRecordDigest: sha256DigestSchema,
        sourceRecordDigest: sha256DigestSchema,
        remediation: z.literal("none"),
        state: z.enum(["created", "updated", "request-recorded"]),
      })
      .strict(),
    reportDigest: sha256DigestSchema,
    reportId: solutionStableIdSchema,
  })
  .strict();

export const continuousConformanceReviewActionResponseV1Schema =
  createDataEnvelopeSchema(continuousConformanceReviewActionResultV1Schema);
export type ContinuousConformanceResponseV1 = z.output<
  typeof continuousConformanceResponseV1Schema
>;

export type ContinuousConformancePathV1 = z.output<
  typeof continuousConformancePathV1Schema
>;

export type ContinuousConformanceViewV1 = z.output<
  typeof continuousConformanceViewV1Schema
>;
export type ContinuousConformanceAvailableReviewActionsV1 = z.output<
  typeof continuousConformanceAvailableReviewActionsV1Schema
>;
export type ContinuousConformanceDiagramResultV1 = z.output<
  typeof continuousConformanceDiagramResultV1Schema
>;
export type ExportContinuousConformanceDiagramV1 = z.output<
  typeof exportContinuousConformanceDiagramV1Schema
>;
export type ContinuousConformanceReviewActionResultV1 = z.output<
  typeof continuousConformanceReviewActionResultV1Schema
>;
export type ReviewContinuousConformanceActionV1 = z.output<
  typeof reviewContinuousConformanceActionV1Schema
>;
