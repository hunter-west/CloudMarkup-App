import { z } from "zod";

import {
  namespacedIdentifierSchema,
  nodeIdSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { workloadIdSchema } from "./workload-behavior-v1.js";
import {
  activeIssueIdSchema,
  aiExtensionIdSchema,
  evidenceIdSchema,
  safeRelativePathSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
} from "./solution-contract-common-v1.js";

export const aiExtensionTargetV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      fileType: namespacedIdentifierSchema,
      kind: z.literal("application"),
      language: namespacedIdentifierSchema,
      workloadId: workloadIdSchema,
    })
    .strict(),
  z
    .object({
      extensionSlotId: solutionStableIdSchema.optional(),
      fileType: namespacedIdentifierSchema,
      kind: z.literal("iac-extension"),
      language: namespacedIdentifierSchema,
      targetFormat: z.enum(["terraform", "cloudformation"]),
    })
    .strict(),
]);

export const aiExtensionOwnedPathV1Schema = z
  .object({
    conflictPolicy: z.enum(["fail", "propose-patch"]),
    path: safeRelativePathSchema,
    priorDigest: sha256DigestSchema.optional(),
  })
  .strict();

export const aiExtensionSourceReferenceV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("architecture-node"),
      nodeId: nodeIdSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("workload"), workloadId: workloadIdSchema })
    .strict(),
  z
    .object({
      contractId: namespacedIdentifierSchema,
      contractVersion: semanticVersionSchema,
      digest: sha256DigestSchema,
      kind: z.literal("solution-contract"),
    })
    .strict(),
  z
    .object({
      externalResourceId: solutionStableIdSchema,
      kind: z.literal("external-resource"),
    })
    .strict(),
]);

export const structuredExtensionRequestV1Schema = z
  .object({
    acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1).max(64),
    capabilityIds: z.array(namespacedIdentifierSchema).max(64),
    constraints: z.array(z.string().min(1).max(500)).max(64),
    objective: z.string().min(1).max(1_000),
    prohibitedCapabilities: z.array(namespacedIdentifierSchema).max(64),
  })
  .strict();

export const aiExtensionModelProvenanceV1Schema = z
  .object({
    modelId: namespacedIdentifierSchema,
    modelVersion: z.string().min(1).max(128),
    outputDigest: sha256DigestSchema,
    promptDigest: sha256DigestSchema,
    promptVersion: semanticVersionSchema,
    providerId: namespacedIdentifierSchema,
    reservationId: solutionStableIdSchema,
    usageEventIds: z.array(solutionStableIdSchema).max(64),
  })
  .strict();

export const aiExtensionOutputV1Schema = z
  .object({
    digest: sha256DigestSchema,
    kind: z.enum(["file", "patch"]),
    path: safeRelativePathSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const aiExtensionDependencyRequestV1Schema = z
  .object({
    ecosystem: namespacedIdentifierSchema,
    name: z.string().min(1).max(214),
    reason: z.string().min(1).max(500),
    requestedVersion: z.string().min(1).max(128),
    reviewState: z.enum(["requested", "approved", "rejected"]),
  })
  .strict();

export const aiExtensionValidationCheckV1Schema = z
  .object({
    checkId: namespacedIdentifierSchema,
    kind: z.enum([
      "parse",
      "format",
      "static-analysis",
      "build",
      "unit-test",
      "contract-test",
      "integration-test",
      "security",
    ]),
    required: z.boolean(),
    result: z.enum(["not-run", "passed", "failed", "error"]),
    toolVersion: z.string().min(1).max(128).optional(),
  })
  .strict();

export const aiExtensionAcceptanceV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }).strict(),
  z
    .object({
      acceptedAt: utcTimestampSchema,
      acceptedBy: solutionStableIdSchema,
      state: z.literal("accepted"),
    })
    .strict(),
  z
    .object({
      reason: z.string().min(1).max(1_000),
      rejectedAt: utcTimestampSchema,
      rejectedBy: solutionStableIdSchema,
      state: z.literal("rejected"),
    })
    .strict(),
]);

export const aiExtensionExportSafetyV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      missingEvidenceKinds: z.array(namespacedIdentifierSchema).min(1).max(64),
      state: z.literal("not-safe"),
    })
    .strict(),
  z
    .object({
      evidenceIds: z.array(evidenceIdSchema).min(1).max(64),
      state: z.literal("safe-to-export"),
    })
    .strict(),
]);

export const aiAuthoredExtensionV1Schema = z
  .object({
    acceptance: aiExtensionAcceptanceV1Schema,
    contractVersion: z.literal(1),
    dependencies: z.array(aiExtensionDependencyRequestV1Schema).max(256),
    exportSafety: aiExtensionExportSafetyV1Schema,
    id: aiExtensionIdSchema,
    issueIds: z.array(activeIssueIdSchema).max(256),
    model: aiExtensionModelProvenanceV1Schema,
    outputs: z.array(aiExtensionOutputV1Schema).min(1).max(1_000),
    ownedPaths: z.array(aiExtensionOwnedPathV1Schema).min(1).max(1_000),
    regenerationPolicy: z.enum([
      "replace-owned-exact",
      "propose-patch",
      "manual-only",
    ]),
    request: structuredExtensionRequestV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
    sourceReferences: z
      .array(aiExtensionSourceReferenceV1Schema)
      .min(1)
      .max(256),
    target: aiExtensionTargetV1Schema,
    validation: z.array(aiExtensionValidationCheckV1Schema).min(1).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    const ownedPaths = new Set(value.ownedPaths.map((entry) => entry.path));
    value.outputs.forEach((output, index) => {
      if (!ownedPaths.has(output.path)) {
        context.addIssue({
          code: "custom",
          message: "Every generated file or patch must target an owned path.",
          path: ["outputs", index, "path"],
        });
      }
    });

    if (
      value.exportSafety.state === "safe-to-export" &&
      value.acceptance.state !== "accepted"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a user-accepted extension may be safe to export.",
        path: ["exportSafety", "state"],
      });
    }

    if (
      value.exportSafety.state === "safe-to-export" &&
      value.validation.some(
        (check) => check.required && check.result !== "passed",
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "All required validation checks must pass before export.",
        path: ["validation"],
      });
    }
  });

export const aiAuthoredExtensionCollectionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    extensions: z.array(aiAuthoredExtensionV1Schema).max(10_000),
  })
  .strict();

export type AiAuthoredExtensionCollectionV1 = z.output<
  typeof aiAuthoredExtensionCollectionV1Schema
>;
export type AiAuthoredExtensionV1 = z.output<
  typeof aiAuthoredExtensionV1Schema
>;
