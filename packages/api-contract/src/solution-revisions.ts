import {
  solutionGenerationCoverageV1Schema,
  solutionRevisionIdSchema,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import { acceptedIntentIdV1Schema } from "./ai-intent-preview-acceptance.js";

import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
  paginationQueryShape,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./common.js";
import {
  draftIdSchema,
  principalSummaryV1Schema,
  projectIdSchema,
  revisionIdSchema,
  revisionV1Schema,
} from "./resources.js";

/**
 * Freeze input identifies only the exact persisted draft and the user-facing
 * immutable name. Architecture, Workload, External Resource, Application
 * Contract, assumption, unresolved-decision, version, and coverage bindings
 * are derived and validated by the server from that exact document. The
 * browser cannot supply hashes or tenant authority.
 */
export const createSolutionRevisionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    draftId: draftIdSchema,
    draftVersion: z.number().int().positive(),
    acceptedIntentId: acceptedIntentIdV1Schema.optional(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const solutionRevisionPathV1Schema = z
  .object({
    projectId: projectIdSchema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict();

export const solutionRevisionListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    sort: z.enum(["createdAt", "-createdAt"]).optional(),
  })
  .strict();

export const solutionRevisionSummaryV1Schema = z
  .object({
    architectureRevisionId: revisionIdSchema,
    contentDigest: sha256DigestSchema,
    createdAt: utcTimestampSchema,
    createdBy: principalSummaryV1Schema,
    documentDigest: sha256DigestSchema,
    generationCoverage: solutionGenerationCoverageV1Schema,
    name: z.string().trim().min(1).max(120),
    projectId: projectIdSchema,
    semanticDigest: sha256DigestSchema,
    solutionRevisionId: solutionRevisionIdSchema,
    sourceDraftId: draftIdSchema,
    sourceDraftVersion: z.number().int().positive(),
    visualDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.generationCoverage.solutionRevisionId !== value.solutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Generation coverage must bind this Solution Revision.",
        path: ["generationCoverage", "solutionRevisionId"],
      });
    }
    if (value.contentDigest !== value.semanticDigest) {
      context.addIssue({
        code: "custom",
        message:
          "The compatibility content digest must match the semantic digest.",
        path: ["contentDigest"],
      });
    }
  });

export const solutionRevisionV1Schema = z
  .object({
    manifest: solutionRevisionManifestV1Schema,
    revision: revisionV1Schema,
    summary: solutionRevisionSummaryV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedBindings = [
      [
        value.manifest.solutionRevisionId,
        value.summary.solutionRevisionId,
        ["summary", "solutionRevisionId"],
        "Solution Revision identity",
      ],
      [
        value.manifest.architecture.revisionId,
        value.revision.id,
        ["revision", "id"],
        "Architecture Revision identity",
      ],
      [
        value.summary.architectureRevisionId,
        value.revision.id,
        ["summary", "architectureRevisionId"],
        "summary Architecture Revision identity",
      ],
      [
        value.summary.projectId,
        value.revision.projectId,
        ["summary", "projectId"],
        "project identity",
      ],
      [
        value.summary.sourceDraftId,
        value.revision.sourceDraftId,
        ["summary", "sourceDraftId"],
        "source draft identity",
      ],
      [
        value.summary.sourceDraftVersion,
        value.revision.sourceDraftVersion,
        ["summary", "sourceDraftVersion"],
        "source draft version",
      ],
      [
        value.summary.documentDigest,
        value.manifest.architecture.documentHash,
        ["summary", "documentDigest"],
        "Architecture document digest",
      ],
      [
        value.summary.semanticDigest,
        value.manifest.architecture.contentHash,
        ["summary", "semanticDigest"],
        "Architecture semantic digest",
      ],
      [
        value.summary.visualDigest,
        value.manifest.architecture.visualHash,
        ["summary", "visualDigest"],
        "Architecture visual digest",
      ],
    ] as const;

    for (const [actual, expected, path, label] of expectedBindings) {
      if (actual !== expected) {
        context.addIssue({
          code: "custom",
          message: `The ${label} does not match the immutable revision.`,
          path: [...path],
        });
      }
    }

    if (
      value.summary.generationCoverage.solutionRevisionId !==
      value.manifest.solutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Summary coverage must match the immutable manifest.",
        path: ["summary", "generationCoverage"],
      });
    }
  });

export const solutionRevisionResponseV1Schema = createDataEnvelopeSchema(
  solutionRevisionV1Schema,
);
export const solutionRevisionListResponseV1Schema = createListEnvelopeSchema(
  solutionRevisionSummaryV1Schema,
);

export type CreateSolutionRevisionV1 = z.output<
  typeof createSolutionRevisionV1Schema
>;
export type SolutionRevisionSummaryV1 = z.output<
  typeof solutionRevisionSummaryV1Schema
>;
export type SolutionRevisionV1 = z.output<typeof solutionRevisionV1Schema>;
