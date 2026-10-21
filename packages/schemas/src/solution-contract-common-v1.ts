import { z } from "zod";

import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const relativePathSegmentPattern = /^(?!\.{1,2}$)[A-Za-z0-9._@()+,= -]+$/;

export const solutionStableIdSchema = z
  .string()
  .regex(stableIdPattern, "Must be a stable opaque identifier.");

export const solutionRevisionIdSchema =
  solutionStableIdSchema.brand<"SolutionRevisionId">();
export const activeIssueIdSchema =
  solutionStableIdSchema.brand<"ActiveIssueId">();
export const evidenceIdSchema = solutionStableIdSchema.brand<"EvidenceId">();
export const aiExtensionIdSchema =
  solutionStableIdSchema.brand<"AiExtensionId">();
export const repositorySnapshotIdSchema =
  solutionStableIdSchema.brand<"RepositorySnapshotId">();
export const observedSolutionIdSchema =
  solutionStableIdSchema.brand<"ObservedSolutionId">();
export const reconciliationProposalIdSchema =
  solutionStableIdSchema.brand<"ReconciliationProposalId">();
export const solutionContractRecordIdSchema =
  namespacedIdentifierSchema.brand<"SolutionContractRecordId">();

export const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, context) => {
    if (
      value.startsWith("/") ||
      value.startsWith("\\") ||
      /^[A-Za-z]:/.test(value) ||
      value.includes("\\") ||
      value.includes("\u0000")
    ) {
      context.addIssue({
        code: "custom",
        message: "Must be a portable relative path using forward slashes.",
      });
      return;
    }

    const segments = value.split("/");
    if (
      segments.some(
        (segment) =>
          segment.length === 0 || !relativePathSegmentPattern.test(segment),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Path segments must be non-empty and cannot traverse outside the package.",
      });
    }
  });

export const contentAddressV1Schema = z
  .object({
    digest: sha256DigestSchema,
    mediaType: z.string().min(1).max(128),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const versionedToolReferenceV1Schema = z
  .object({
    digest: sha256DigestSchema.optional(),
    id: namespacedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

export const sourceLocationV1Schema = z
  .object({
    endColumn: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    path: safeRelativePathSchema,
    startColumn: z.number().int().positive().optional(),
    startLine: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endLine !== undefined && value.startLine === undefined) {
      context.addIssue({
        code: "custom",
        message: "endLine requires startLine.",
        path: ["endLine"],
      });
    }
    if (
      value.endLine !== undefined &&
      value.startLine !== undefined &&
      value.endLine < value.startLine
    ) {
      context.addIssue({
        code: "custom",
        message: "endLine cannot precede startLine.",
        path: ["endLine"],
      });
    }
  });

export const provenanceActorV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      actorId: solutionStableIdSchema,
      kind: z.literal("user"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("deterministic-tool"),
      tool: versionedToolReferenceV1Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("model-assisted"),
      modelId: namespacedIdentifierSchema,
      modelVersion: z.string().min(1).max(128),
      promptVersion: semanticVersionSchema,
      providerId: namespacedIdentifierSchema,
    })
    .strict(),
  z
    .object({
      ciIdentity: z.string().min(1).max(256),
      kind: z.literal("ci"),
    })
    .strict(),
]);

export const recordProvenanceV1Schema = z
  .object({
    actor: provenanceActorV1Schema,
    createdAt: utcTimestampSchema,
    inputDigests: z.array(sha256DigestSchema).max(256),
  })
  .strict();

export const solutionLayerSchema = z.enum([
  "designed",
  "imported",
  "generated",
  "planned",
  "deployed",
]);

export type ContentAddressV1 = z.output<typeof contentAddressV1Schema>;
export type RecordProvenanceV1 = z.output<typeof recordProvenanceV1Schema>;
export type SafeRelativePath = z.output<typeof safeRelativePathSchema>;
export type SourceLocationV1 = z.output<typeof sourceLocationV1Schema>;
export type SolutionLayer = z.output<typeof solutionLayerSchema>;
export type VersionedToolReferenceV1 = z.output<
  typeof versionedToolReferenceV1Schema
>;
