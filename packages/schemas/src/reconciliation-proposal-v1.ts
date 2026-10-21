import { z } from "zod";

import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { externalResourceCandidateIdSchema } from "./external-resource-reference-v1.js";
import { graphCommandBatchV1Schema } from "./graph-command-v1.js";
import {
  observedConnectionIdSchema,
  observedDesignTargetV1Schema,
  observedGeneratedFileIdSchema,
  observedResourceIdSchema,
  observedWorkloadIdSchema,
} from "./observed-solution-v1.js";
import { repositorySourceEvidenceIdSchema } from "./repository-snapshot-v1.js";
import {
  recordProvenanceV1Schema,
  observedSolutionIdSchema,
  repositorySnapshotIdSchema,
  reconciliationProposalIdSchema,
  solutionStableIdSchema,
  versionedToolReferenceV1Schema,
} from "./solution-contract-common-v1.js";

const reasonSchema = z.string().trim().min(1).max(1_000);

export const reconciliationOperationIdSchema =
  solutionStableIdSchema.brand<"ReconciliationOperationId">();
export const reconciliationMappingIdSchema =
  solutionStableIdSchema.brand<"ReconciliationMappingId">();

export const reconciliationObservedTargetV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("resource"),
        observedResourceId: observedResourceIdSchema,
        recordDigest: sha256DigestSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("connection"),
        observedConnectionId: observedConnectionIdSchema,
        recordDigest: sha256DigestSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("workload"),
        observedWorkloadId: observedWorkloadIdSchema,
        recordDigest: sha256DigestSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("external-resource"),
        candidateId: externalResourceCandidateIdSchema,
        recordDigest: sha256DigestSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("generated-file"),
        observedGeneratedFileId: observedGeneratedFileIdSchema,
        recordDigest: sha256DigestSchema,
      })
      .strict(),
  ],
);

export const deterministicDomainOperationReferenceV1Schema = z
  .object({
    contractId: namespacedIdentifierSchema,
    contractVersion: semanticVersionSchema,
    operationId: solutionStableIdSchema,
    operationDigest: sha256DigestSchema,
    expectedInputDigest: sha256DigestSchema,
    expectedDesignDigest: sha256DigestSchema,
    resultingDesignDigest: sha256DigestSchema,
  })
  .strict();

const reconciliationOperationShape = {
  operationId: reconciliationOperationIdSchema,
  target: reconciliationObservedTargetV1Schema,
  rationale: reasonSchema,
} as const;

export const acceptObservedGraphChangeV1Schema = z
  .object({
    ...reconciliationOperationShape,
    kind: z.literal("accept-observed-graph-change"),
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("resource"),
          observedResourceId: observedResourceIdSchema,
          recordDigest: sha256DigestSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("connection"),
          observedConnectionId: observedConnectionIdSchema,
          recordDigest: sha256DigestSchema,
        })
        .strict(),
    ]),
    expectedArchitectureContentHash: sha256DigestSchema,
    resultingArchitectureContentHash: sha256DigestSchema,
    graphCommands: graphCommandBatchV1Schema,
  })
  .strict();

export const acceptObservedDomainChangeV1Schema = z
  .object({
    ...reconciliationOperationShape,
    kind: z.literal("accept-observed-domain-change"),
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("workload"),
          observedWorkloadId: observedWorkloadIdSchema,
          recordDigest: sha256DigestSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("external-resource"),
          candidateId: externalResourceCandidateIdSchema,
          recordDigest: sha256DigestSchema,
        })
        .strict(),
    ]),
    domainOperation: deterministicDomainOperationReferenceV1Schema,
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      operation.domainOperation.expectedInputDigest !==
      operation.target.recordDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["domainOperation", "expectedInputDigest"],
        message: "Domain operation must bind the exact observed record digest.",
      });
    }
  });

export const keepObservedOnlyV1Schema = z
  .object({
    ...reconciliationOperationShape,
    kind: z.literal("keep-observed-only"),
  })
  .strict();

export const markIntentionallyExternalV1Schema = z
  .object({
    ...reconciliationOperationShape,
    kind: z.literal("mark-intentionally-external"),
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("resource"),
          observedResourceId: observedResourceIdSchema,
          recordDigest: sha256DigestSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("external-resource"),
          candidateId: externalResourceCandidateIdSchema,
          recordDigest: sha256DigestSchema,
        })
        .strict(),
    ]),
    ownershipState: z.enum([
      "existing-cloud-managed-elsewhere",
      "third-party-service-api",
      "on-premises-network-endpoint",
      "repository-defined-external-dependency",
      "unknown-unresolved",
    ]),
    domainOperation: deterministicDomainOperationReferenceV1Schema,
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      operation.domainOperation.expectedInputDigest !==
      operation.target.recordDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["domainOperation", "expectedInputDigest"],
        message: "Domain operation must bind the exact observed record digest.",
      });
    }
  });

export const updateGeneratedOutputToDesignV1Schema = z
  .object({
    ...reconciliationOperationShape,
    kind: z.literal("update-generated-output-to-design"),
    action: z.literal("regenerate-from-approved-design"),
    expectedDesignDigest: sha256DigestSchema,
    expectedRepositoryManifestDigest: sha256DigestSchema,
    generator: versionedToolReferenceV1Schema,
  })
  .strict();

export const ignoreObservationV1Schema = z
  .object({
    ...reconciliationOperationShape,
    kind: z.literal("ignore-observation"),
    expiresAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const reconciliationMappingCandidateV1Schema = z
  .object({
    mappingId: reconciliationMappingIdSchema,
    observedTarget: reconciliationObservedTargetV1Schema,
    designTarget: observedDesignTargetV1Schema,
    confidenceBasisPoints: z.number().int().min(0).max(10_000),
    evidenceIds: z.array(repositorySourceEvidenceIdSchema).min(1).max(256),
  })
  .strict();

export const resolveAmbiguousMappingV1Schema = z
  .object({
    ...reconciliationOperationShape,
    kind: z.literal("resolve-ambiguous-mapping"),
    candidates: z.array(reconciliationMappingCandidateV1Schema).min(2).max(64),
    selectedMappingId: reconciliationMappingIdSchema,
    domainOperation: deterministicDomainOperationReferenceV1Schema,
  })
  .strict()
  .superRefine((operation, context) => {
    const selected = operation.candidates.find(
      (candidate) => candidate.mappingId === operation.selectedMappingId,
    );
    if (selected === undefined) {
      context.addIssue({
        code: "custom",
        path: ["selectedMappingId"],
        message: "Selected mapping must be one of the bounded candidates.",
      });
    } else if (
      operation.domainOperation.expectedInputDigest !==
      selected.observedTarget.recordDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["domainOperation", "expectedInputDigest"],
        message: "Mapping operation must bind the selected observation digest.",
      });
    }
  });

export const removeStaleImportedEvidenceV1Schema = z
  .object({
    ...reconciliationOperationShape,
    kind: z.literal("remove-stale-imported-evidence"),
    staleEvidenceIds: z
      .array(repositorySourceEvidenceIdSchema)
      .min(1)
      .max(1_000),
    staleSince: utcTimestampSchema,
    expectedObservedContentHash: sha256DigestSchema,
    resultingObservedContentHash: sha256DigestSchema,
    domainOperation: deterministicDomainOperationReferenceV1Schema,
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      operation.domainOperation.expectedInputDigest !==
      operation.expectedObservedContentHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["domainOperation", "expectedInputDigest"],
        message: "Evidence removal must bind the exact observed-layer hash.",
      });
    }
    if (
      operation.domainOperation.resultingDesignDigest !==
      operation.resultingObservedContentHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["domainOperation", "resultingDesignDigest"],
        message:
          "Evidence removal must bind its resulting observed-layer hash.",
      });
    }
  });

export const reconciliationOperationV1Schema = z.discriminatedUnion("kind", [
  acceptObservedGraphChangeV1Schema,
  acceptObservedDomainChangeV1Schema,
  keepObservedOnlyV1Schema,
  markIntentionallyExternalV1Schema,
  updateGeneratedOutputToDesignV1Schema,
  ignoreObservationV1Schema,
  resolveAmbiguousMappingV1Schema,
  removeStaleImportedEvidenceV1Schema,
]);

export const reconciliationProposalReviewV1Schema = z.discriminatedUnion(
  "state",
  [
    z.object({ state: z.literal("pending-review") }).strict(),
    z
      .object({
        state: z.literal("accepted"),
        reviewedBy: solutionStableIdSchema,
        reviewedAt: utcTimestampSchema,
        acceptedOperationIds: z
          .array(reconciliationOperationIdSchema)
          .min(1)
          .max(256),
      })
      .strict(),
    z
      .object({
        state: z.literal("partially-accepted"),
        reviewedBy: solutionStableIdSchema,
        reviewedAt: utcTimestampSchema,
        acceptedOperationIds: z
          .array(reconciliationOperationIdSchema)
          .min(1)
          .max(256),
        rejectedOperationIds: z
          .array(reconciliationOperationIdSchema)
          .min(1)
          .max(256),
        reason: reasonSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("rejected"),
        reviewedBy: solutionStableIdSchema,
        reviewedAt: utcTimestampSchema,
        reason: reasonSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("superseded"),
        supersededBy: reconciliationProposalIdSchema,
        supersededAt: utcTimestampSchema,
      })
      .strict(),
  ],
);

export const reconciliationProposalV1Schema = z
  .object({
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.reconciliation-proposal"),
    proposalId: reconciliationProposalIdSchema,
    authority: z.literal("proposal-only"),
    applyPolicy: z.literal("explicit-review-and-deterministic-operation"),
    repositorySnapshotId: repositorySnapshotIdSchema,
    repositorySnapshotDigest: sha256DigestSchema,
    observedSolutionId: observedSolutionIdSchema,
    observedContentHash: sha256DigestSchema,
    provenance: recordProvenanceV1Schema,
    operations: z.array(reconciliationOperationV1Schema).min(1).max(256),
    review: reconciliationProposalReviewV1Schema,
  })
  .strict()
  .superRefine((proposal, context) => {
    const operationIds = new Set<string>();
    proposal.operations.forEach((operation, index) => {
      if (operationIds.has(operation.operationId)) {
        context.addIssue({
          code: "custom",
          path: ["operations", index, "operationId"],
          message: `Duplicate reconciliation operation ${operation.operationId}.`,
        });
      }
      operationIds.add(operation.operationId);
    });

    if (
      proposal.review.state === "accepted" ||
      proposal.review.state === "partially-accepted"
    ) {
      const acceptedOperationIds = new Set<string>();
      proposal.review.acceptedOperationIds.forEach((operationId, index) => {
        if (acceptedOperationIds.has(operationId)) {
          context.addIssue({
            code: "custom",
            path: ["review", "acceptedOperationIds", index],
            message: `Duplicate accepted operation ${operationId}.`,
          });
        }
        acceptedOperationIds.add(operationId);
        if (!operationIds.has(operationId)) {
          context.addIssue({
            code: "custom",
            path: ["review", "acceptedOperationIds", index],
            message: `Unknown accepted operation ${operationId}.`,
          });
        }
      });

      if (proposal.review.state === "accepted") {
        proposal.operations.forEach((operation) => {
          if (!acceptedOperationIds.has(operation.operationId)) {
            context.addIssue({
              code: "custom",
              path: ["review", "acceptedOperationIds"],
              message: `Accepted review must include operation ${operation.operationId}.`,
            });
          }
        });
        return;
      }

      const rejectedOperationIds = new Set<string>();
      proposal.review.rejectedOperationIds.forEach((operationId, index) => {
        if (rejectedOperationIds.has(operationId)) {
          context.addIssue({
            code: "custom",
            path: ["review", "rejectedOperationIds", index],
            message: `Duplicate rejected operation ${operationId}.`,
          });
        }
        rejectedOperationIds.add(operationId);
        if (!operationIds.has(operationId)) {
          context.addIssue({
            code: "custom",
            path: ["review", "rejectedOperationIds", index],
            message: `Unknown rejected operation ${operationId}.`,
          });
        }
        if (acceptedOperationIds.has(operationId)) {
          context.addIssue({
            code: "custom",
            path: ["review", "rejectedOperationIds", index],
            message: `Operation ${operationId} cannot be both accepted and rejected.`,
          });
        }
      });
      proposal.operations.forEach((operation) => {
        if (
          !acceptedOperationIds.has(operation.operationId) &&
          !rejectedOperationIds.has(operation.operationId)
        ) {
          context.addIssue({
            code: "custom",
            path: ["review"],
            message: `Partially accepted review must decide operation ${operation.operationId}.`,
          });
        }
      });
    }
  });

export type DeterministicDomainOperationReferenceV1 = z.output<
  typeof deterministicDomainOperationReferenceV1Schema
>;
export type ReconciliationObservedTargetV1 = z.output<
  typeof reconciliationObservedTargetV1Schema
>;
export type ReconciliationOperationV1 = z.output<
  typeof reconciliationOperationV1Schema
>;
export type ReconciliationProposalReviewV1 = z.output<
  typeof reconciliationProposalReviewV1Schema
>;
export type ReconciliationProposalV1 = z.output<
  typeof reconciliationProposalV1Schema
>;
