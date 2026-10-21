import { z } from "zod";

import {
  catalogIdSchema,
  revisionIdSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import {
  repositoryPackagePathSchema,
  repositoryPathOwnershipKindV1Schema,
} from "./repository-ownership-v1.js";
import { solutionGenerationCoverageV1Schema } from "./generation-coverage-v1.js";
import {
  activeIssueIdSchema,
  aiExtensionIdSchema,
  evidenceIdSchema,
  observedSolutionIdSchema,
  repositorySnapshotIdSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  versionedToolReferenceV1Schema,
} from "./solution-contract-common-v1.js";

export const solutionContentBindingV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      contentHash: sha256DigestSchema,
      id: solutionStableIdSchema,
      state: z.literal("included"),
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      reason: z.string().min(1).max(500),
      state: z.literal("not-applicable"),
    })
    .strict(),
]);

export const solutionArchitectureBindingV1Schema = z
  .object({
    contentHash: sha256DigestSchema,
    documentHash: sha256DigestSchema,
    documentKind: z.literal("cloudmarkup.architecture-document"),
    revisionId: revisionIdSchema,
    schemaVersion: z.literal(3),
    visualHash: sha256DigestSchema,
  })
  .strict();

export const solutionWorkloadBindingV1Schema = z
  .object({
    contentHash: sha256DigestSchema,
    contractVersion: z.literal(2),
  })
  .strict();

export const solutionExternalResourceBindingV1Schema = z
  .object({
    contentHash: sha256DigestSchema,
    contractVersion: z.literal(1),
  })
  .strict();

export const solutionContractSetBindingV1Schema = z
  .object({
    contentHash: sha256DigestSchema,
    contractVersion: z.literal(1),
    recordHashes: z.array(sha256DigestSchema).max(10_000),
  })
  .strict();

export const approvedRepositoryObservationV1Schema = z
  .object({
    approvalId: solutionStableIdSchema,
    approvedAt: utcTimestampSchema,
    approvedBy: solutionStableIdSchema,
    observedContentHash: sha256DigestSchema,
    observedSolutionId: observedSolutionIdSchema,
    repositorySnapshotId: repositorySnapshotIdSchema,
    snapshotContentHash: sha256DigestSchema,
  })
  .strict();

export const optionalVersionBindingV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("pinned"),
      tool: versionedToolReferenceV1Schema,
    })
    .strict(),
  z
    .object({
      reason: z.string().min(1).max(500),
      state: z.literal("not-applicable"),
    })
    .strict(),
]);

export const solutionRevisionVersionsV1Schema = z
  .object({
    applicationGenerator: optionalVersionBindingV1Schema,
    catalog: z
      .object({
        digest: sha256DigestSchema,
        id: catalogIdSchema,
        version: semanticVersionSchema,
      })
      .strict(),
    compiler: optionalVersionBindingV1Schema,
    diagramRenderer: optionalVersionBindingV1Schema,
    importer: optionalVersionBindingV1Schema,
    modelPrompt: optionalVersionBindingV1Schema,
    policy: z.array(versionedToolReferenceV1Schema).max(64),
  })
  .strict();

export const solutionSourceOwnershipV1Schema = z
  .object({
    contentHash: sha256DigestSchema.optional(),
    conflictBehavior: z.enum([
      "fail",
      "semantic-diff-and-review",
      "preserve-user-content",
      "replace-exact-owned-content",
    ]),
    ownerId: solutionStableIdSchema,
    ownership: repositoryPathOwnershipKindV1Schema,
    path: repositoryPackagePathSchema,
  })
  .strict();

type SolutionSourceOwnershipScopeV1 = z.output<
  typeof solutionSourceOwnershipV1Schema
>;

function solutionSourceOwnershipAncestorPaths(path: string): string[] {
  const ancestors: string[] = [];
  let candidate = path;
  let separatorIndex = candidate.lastIndexOf("/");
  while (separatorIndex >= 0) {
    candidate = candidate.slice(0, separatorIndex);
    ancestors.push(candidate);
    separatorIndex = candidate.lastIndexOf("/");
  }
  return ancestors;
}

/**
 * Source Ownership v1 has no path hierarchy or override precedence. Exact and
 * ancestor/descendant entries are ambiguous even when their owner and policy
 * fields match, so immutable Solution Revisions reject them.
 */
function addSolutionSourceOwnershipPathIssues(
  ownership: readonly SolutionSourceOwnershipScopeV1[],
  context: z.RefinementCtx,
) {
  const firstIndexByPath = new Map<string, number>();
  const duplicateIndexes = new Set<number>();

  for (const [index, entry] of ownership.entries()) {
    const existingIndex = firstIndexByPath.get(entry.path);
    if (existingIndex !== undefined) {
      duplicateIndexes.add(index);
      context.addIssue({
        code: "custom",
        path: ["sourceOwnership", index, "path"],
        message:
          "Solution Revision source-ownership paths must be unique; duplicate " +
          entry.path +
          ".",
      });
      continue;
    }
    firstIndexByPath.set(entry.path, index);
  }

  for (const [index, entry] of ownership.entries()) {
    if (duplicateIndexes.has(index)) {
      continue;
    }
    for (const ancestorPath of solutionSourceOwnershipAncestorPaths(
      entry.path,
    )) {
      if (!firstIndexByPath.has(ancestorPath)) {
        continue;
      }
      context.addIssue({
        code: "custom",
        path: ["sourceOwnership", index, "path"],
        message:
          "Solution Revision source-ownership path " +
          entry.path +
          " overlaps ancestor path " +
          ancestorPath +
          "; version 1 defines no hierarchy precedence.",
      });
      break;
    }
  }
}

export const solutionRevisionManifestV1Schema = z
  .object({
    aiExtensionIds: z.array(aiExtensionIdSchema).max(1_000),
    architecture: solutionArchitectureBindingV1Schema,
    assumptions: z.array(solutionStableIdSchema).max(1_000),
    contractVersion: z.literal(1),
    contracts: solutionContractSetBindingV1Schema,
    createdAt: utcTimestampSchema,
    createdBy: solutionStableIdSchema,
    evidenceIdsAtFreeze: z.array(evidenceIdSchema).max(10_000),
    externalResources: solutionExternalResourceBindingV1Schema,
    generationCoverage: solutionGenerationCoverageV1Schema,
    intent: solutionContentBindingV1Schema,
    issueIdsAtFreeze: z.array(activeIssueIdSchema).max(10_000),
    kind: z.literal("cloudmarkup.solution-revision-manifest"),
    repositoryObservations: z
      .array(approvedRepositoryObservationV1Schema)
      .max(1_000),
    solutionRevisionId: solutionRevisionIdSchema,
    sourceOwnership: z.array(solutionSourceOwnershipV1Schema).max(10_000),
    unresolvedDecisionIds: z.array(solutionStableIdSchema).max(1_000),
    versions: solutionRevisionVersionsV1Schema,
    workload: solutionWorkloadBindingV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    addSolutionSourceOwnershipPathIssues(value.sourceOwnership, context);

    if (
      value.generationCoverage.solutionRevisionId !== value.solutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Generation coverage must bind this Solution Revision.",
        path: ["generationCoverage", "solutionRevisionId"],
      });
    }
  });

export type SolutionRevisionManifestV1 = z.output<
  typeof solutionRevisionManifestV1Schema
>;
export type SolutionSourceOwnershipV1 = z.output<
  typeof solutionSourceOwnershipV1Schema
>;
