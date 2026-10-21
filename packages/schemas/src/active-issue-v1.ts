import { z } from "zod";

import {
  edgeIdSchema,
  namespacedIdentifierSchema,
  nodeIdSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { evidenceLevelSchema } from "./evidence-v1.js";
import { graphCommandBatchV1Schema } from "./graph-command-v1.js";
import { workloadIdSchema } from "./workload-behavior-v1.js";
import {
  activeIssueIdSchema,
  aiExtensionIdSchema,
  evidenceIdSchema,
  recordProvenanceV1Schema,
  solutionContractRecordIdSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  sourceLocationV1Schema,
} from "./solution-contract-common-v1.js";

export const ACTIVE_ISSUE_V1_LIMITS = Object.freeze({
  affectedReferences: 1_024,
} as const);

export const activeIssueSourceSchema = z.enum([
  "schema-graph-validation",
  "provider-architecture-validation",
  "configuration-policy-validation",
  "compiler-parser-diagnostic",
  "application-build-test-security",
  "ai-generation-repair",
  "repository-import-mismatch",
  "cloud-plan-change-set",
  "deployment-smoke-integration",
  "deployed-drift",
]);

export const activeIssueSeveritySchema = z.enum([
  "security-error",
  "error",
  "cost-warning",
  "warning",
  "recommendation",
  "educational-note",
]);

export const activeIssueCategorySchema = z.enum([
  "structure",
  "provider",
  "configuration",
  "security",
  "cost",
  "reliability",
  "compatibility",
  "source-ownership",
  "repository-conformance",
  "generation",
  "verification",
  "deployment",
  "drift",
]);

export const activeIssueAffectedReferenceV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("solution-revision"),
        solutionRevisionId: solutionRevisionIdSchema,
      })
      .strict(),
    z
      .object({ kind: z.literal("architecture-node"), nodeId: nodeIdSchema })
      .strict(),
    z
      .object({ edgeId: edgeIdSchema, kind: z.literal("architecture-edge") })
      .strict(),
    z
      .object({ kind: z.literal("workload"), workloadId: workloadIdSchema })
      .strict(),
    z
      .object({
        externalResourceId: solutionStableIdSchema,
        kind: z.literal("external-resource"),
      })
      .strict(),
    z
      .object({
        contractId: solutionContractRecordIdSchema,
        kind: z.literal("solution-contract"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("repository-location"),
        location: sourceLocationV1Schema,
      })
      .strict(),
    z
      .object({ evidenceId: evidenceIdSchema, kind: z.literal("evidence") })
      .strict(),
    z
      .object({
        artifactId: solutionStableIdSchema,
        kind: z.literal("artifact"),
      })
      .strict(),
    z
      .object({
        environmentId: solutionStableIdSchema,
        kind: z.literal("environment"),
      })
      .strict(),
  ],
);

export const deterministicIssueFixV1Schema = z
  .object({
    description: z.string().min(1).max(500),
    graphCommand: graphCommandBatchV1Schema,
    resultingContentHash: sha256DigestSchema,
    resultingVisualHash: sha256DigestSchema,
  })
  .strict();

export const aiProposedIssueFixV1Schema = z
  .object({
    description: z.string().min(1).max(500),
    extensionId: aiExtensionIdSchema,
    proposedPatchDigest: sha256DigestSchema,
    validationStatus: z.enum([
      "not-validated",
      "validation-pending",
      "rejected",
      "validated-for-review",
      "accepted",
    ]),
  })
  .strict();

export const issueClosureRequirementV1Schema = z
  .object({
    description: z.string().min(1).max(500),
    evidenceCheckId: namespacedIdentifierSchema,
    evidenceLevel: evidenceLevelSchema,
  })
  .strict();

export const activeIssueLifecycleV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("current") }).strict(),
  z
    .object({
      reason: z.string().min(1).max(1_000),
      staleAt: utcTimestampSchema,
      state: z.literal("stale"),
    })
    .strict(),
  z
    .object({
      evidenceIds: z.array(evidenceIdSchema).min(1).max(256),
      reason: z.string().min(1).max(1_000),
      resolvedAt: utcTimestampSchema,
      resolvedBy: solutionStableIdSchema,
      state: z.literal("resolved"),
    })
    .strict(),
  z
    .object({
      acceptedAt: utcTimestampSchema,
      acceptedBy: solutionStableIdSchema,
      expiresAt: utcTimestampSchema.optional(),
      reason: z.string().min(1).max(1_000),
      state: z.literal("accepted"),
    })
    .strict(),
  z
    .object({
      deferredAt: utcTimestampSchema,
      deferredBy: solutionStableIdSchema,
      expiresAt: utcTimestampSchema,
      reason: z.string().min(1).max(1_000),
      state: z.literal("deferred"),
    })
    .strict(),
]);

export const activeIssueV1Schema = z
  .object({
    affected: z
      .array(activeIssueAffectedReferenceV1Schema)
      .min(1)
      .max(ACTIVE_ISSUE_V1_LIMITS.affectedReferences),
    aiProposedFix: aiProposedIssueFixV1Schema.optional(),
    category: activeIssueCategorySchema,
    closureRequirements: z.array(issueClosureRequirementV1Schema).max(64),
    contractVersion: z.literal(1),
    currentRecordDigest: sha256DigestSchema,
    deterministicFix: deterministicIssueFixV1Schema.optional(),
    id: activeIssueIdSchema,
    lifecycle: activeIssueLifecycleV1Schema,
    previousRecordDigest: sha256DigestSchema.optional(),
    provenance: recordProvenanceV1Schema,
    recordVersion: z.number().int().positive(),
    severity: activeIssueSeveritySchema,
    solutionRevisionId: solutionRevisionIdSchema,
    source: activeIssueSourceSchema,
    sourceRecordId: solutionStableIdSchema,
    summary: z.string().min(1).max(500),
    technicalDetail: z.string().min(1).max(4_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.recordVersion === 1 && value.previousRecordDigest !== undefined) {
      context.addIssue({
        code: "custom",
        message: "The first issue record cannot name a previous digest.",
        path: ["previousRecordDigest"],
      });
    }
    if (value.recordVersion > 1 && value.previousRecordDigest === undefined) {
      context.addIssue({
        code: "custom",
        message: "Later issue records must name the previous immutable digest.",
        path: ["previousRecordDigest"],
      });
    }
  });

export const activeIssueCollectionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    issues: z.array(activeIssueV1Schema).max(10_000),
  })
  .strict();

export type ActiveIssueAffectedReferenceV1 = z.output<
  typeof activeIssueAffectedReferenceV1Schema
>;
export type ActiveIssueCollectionV1 = z.output<
  typeof activeIssueCollectionV1Schema
>;
export type ActiveIssueLifecycleV1 = z.output<
  typeof activeIssueLifecycleV1Schema
>;
export type ActiveIssueV1 = z.output<typeof activeIssueV1Schema>;
