import { z } from "zod";

import {
  namespacedIdentifierSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { environmentTypeSchema } from "./intent-document-v1.js";
import {
  generationCoverageRequirementSchema,
  type GenerationCoverageRequirement,
} from "./generation-coverage-v1.js";
import {
  activeIssueIdSchema,
  contentAddressV1Schema,
  evidenceIdSchema,
  recordProvenanceV1Schema,
  solutionLayerSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  versionedToolReferenceV1Schema,
} from "./solution-contract-common-v1.js";

export const evidenceLevelSchema = z.discriminatedUnion("rank", [
  z
    .object({ rank: z.literal(1), kind: z.literal("structural-validity") })
    .strict(),
  z
    .object({
      rank: z.literal(2),
      kind: z.literal("provider-architecture-validity"),
    })
    .strict(),
  z
    .object({
      rank: z.literal(3),
      kind: z.literal("deterministic-target-compilation"),
    })
    .strict(),
  z
    .object({
      rank: z.literal(4),
      kind: z.literal("ai-extension-parse-static-validity"),
    })
    .strict(),
  z
    .object({
      rank: z.literal(5),
      kind: z.literal("application-build-and-tests"),
    })
    .strict(),
  z
    .object({ rank: z.literal(6), kind: z.literal("cloud-plan-change-set") })
    .strict(),
  z
    .object({
      rank: z.literal(7),
      kind: z.literal("deployment-smoke-integration"),
    })
    .strict(),
  z
    .object({ rank: z.literal(8), kind: z.literal("repository-conformance") })
    .strict(),
  z.object({ rank: z.literal(9), kind: z.literal("deployed-drift") }).strict(),
]);

export const generationCoverageEvidenceLevelByRequirement = Object.freeze({
  "structural-validity": {
    kind: "structural-validity",
    rank: 1,
  },
  "provider-architecture-validity": {
    kind: "provider-architecture-validity",
    rank: 2,
  },
  "deterministic-infrastructure-compilation": {
    kind: "deterministic-target-compilation",
    rank: 3,
  },
  "deterministic-application-generation": {
    kind: "deterministic-target-compilation",
    rank: 3,
  },
  "ai-extension-parse-static-validity": {
    kind: "ai-extension-parse-static-validity",
    rank: 4,
  },
  "application-build-and-tests": {
    kind: "application-build-and-tests",
    rank: 5,
  },
  "application-security-checks": {
    kind: "application-build-and-tests",
    rank: 5,
  },
} as const satisfies Readonly<
  Record<GenerationCoverageRequirement, z.output<typeof evidenceLevelSchema>>
>);

export const evidenceEnvironmentV1Schema = z
  .object({
    environmentId: solutionStableIdSchema.optional(),
    environmentType: z.union([environmentTypeSchema, z.literal("unknown")]),
    providerEnvironmentReference: z.string().min(1).max(256).optional(),
  })
  .strict();

export const evidenceStalenessV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      assessedAt: utcTimestampSchema,
      state: z.literal("current"),
      validUntil: utcTimestampSchema.optional(),
    })
    .strict(),
  z
    .object({
      assessedAt: utcTimestampSchema,
      reason: z.string().min(1).max(500),
      staleAt: utcTimestampSchema,
      state: z.literal("stale"),
    })
    .strict(),
]);

export const evidenceCheckV1Schema = z
  .object({
    artifactDigests: z.array(sha256DigestSchema).max(256),
    checkId: namespacedIdentifierSchema,
    generationCoverageRequirement:
      generationCoverageRequirementSchema.optional(),
    issueIds: z.array(activeIssueIdSchema).max(256),
    redactedFailure: z.string().min(1).max(2_000).optional(),
    status: z.enum(["passed", "failed", "skipped", "error"]),
    summary: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.redactedFailure !== undefined &&
      value.status !== "failed" &&
      value.status !== "error"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only failed or error checks may include a redacted failure.",
        path: ["redactedFailure"],
      });
    }
  });

export const evidenceModelReferenceV1Schema = z
  .object({
    modelId: namespacedIdentifierSchema,
    modelVersion: z.string().min(1).max(128),
    promptVersion: z.string().min(1).max(128),
    providerId: namespacedIdentifierSchema,
  })
  .strict();

export const evidenceRecordV1Schema = z
  .object({
    artifacts: z.array(contentAddressV1Schema).max(1_000),
    checks: z.array(evidenceCheckV1Schema).min(1).max(1_000),
    ciIdentity: z.string().min(1).max(256).optional(),
    contractVersion: z.literal(1),
    environment: evidenceEnvironmentV1Schema,
    id: evidenceIdSchema,
    layer: solutionLayerSchema,
    level: evidenceLevelSchema,
    models: z.array(evidenceModelReferenceV1Schema).max(32),
    provenance: recordProvenanceV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
    staleness: evidenceStalenessV1Schema,
    tools: z.array(versionedToolReferenceV1Schema).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    const checkIds = new Set<string>();
    value.checks.forEach((check, index) => {
      if (checkIds.has(check.checkId)) {
        context.addIssue({
          code: "custom",
          message: `Evidence check ID ${check.checkId} must be unique within one record.`,
          path: ["checks", index, "checkId"],
        });
      }
      checkIds.add(check.checkId);

      if (check.generationCoverageRequirement !== undefined) {
        const requiredLevel =
          generationCoverageEvidenceLevelByRequirement[
            check.generationCoverageRequirement
          ];
        if (
          value.level.kind !== requiredLevel.kind ||
          value.level.rank !== requiredLevel.rank
        ) {
          context.addIssue({
            code: "custom",
            message: `Generation coverage requirement ${check.generationCoverageRequirement} belongs to exact Evidence level ${String(requiredLevel.rank)} (${requiredLevel.kind}).`,
            path: ["checks", index, "generationCoverageRequirement"],
          });
        }
      }
    });

    const requiredLayer =
      value.level.rank === 6
        ? "planned"
        : value.level.rank === 7 || value.level.rank === 9
          ? "deployed"
          : value.level.rank === 8
            ? "imported"
            : value.level.rank === 3 ||
                value.level.rank === 4 ||
                value.level.rank === 5
              ? "generated"
              : "designed";

    if (value.layer !== requiredLayer) {
      context.addIssue({
        code: "custom",
        message: `Evidence level ${String(value.level.rank)} belongs to the ${requiredLayer} layer.`,
        path: ["layer"],
      });
    }
  });

export const evidenceCollectionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    records: z.array(evidenceRecordV1Schema).max(10_000),
  })
  .strict();

export type EvidenceCheckV1 = z.output<typeof evidenceCheckV1Schema>;
export type EvidenceCollectionV1 = z.output<typeof evidenceCollectionV1Schema>;
export type EvidenceLevel = z.output<typeof evidenceLevelSchema>;
export type EvidenceRecordV1 = z.output<typeof evidenceRecordV1Schema>;
