import { z } from "zod";

import {
  edgeIdSchema,
  namespacedIdentifierSchema,
  nodeIdSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import {
  externalResourceCandidateIdSchema,
  externalResourceIdSchema,
  externalResourceOwnershipStateV1Schema,
} from "./external-resource-reference-v1.js";
import {
  repositoryCommitShaSchema,
  repositoryParseCertaintyV1Schema,
  repositorySourceEvidenceIdSchema,
  repositorySourceLocationV1Schema,
} from "./repository-snapshot-v1.js";
import {
  repositorySnapshotIdSchema,
  observedSolutionIdSchema,
  safeRelativePathSchema,
  solutionStableIdSchema,
} from "./solution-contract-common-v1.js";
import { workloadIdSchema } from "./workload-behavior-v1.js";

const oneLineTextSchema = z.string().trim().min(1).max(512);

export const observedResourceIdSchema =
  solutionStableIdSchema.brand<"ObservedResourceId">();
export const observedConnectionIdSchema =
  solutionStableIdSchema.brand<"ObservedConnectionId">();
export const observedWorkloadIdSchema =
  solutionStableIdSchema.brand<"ObservedWorkloadId">();
export const observedGeneratedFileIdSchema =
  solutionStableIdSchema.brand<"ObservedGeneratedFileId">();

export const observedEvidenceReferenceV1Schema = z
  .object({
    sourceEvidenceId: repositorySourceEvidenceIdSchema,
    path: safeRelativePathSchema,
    fileChecksum: sha256DigestSchema,
    location: repositorySourceLocationV1Schema,
  })
  .strict();

export const observedDesignTargetV1Schema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("architecture-node"), nodeId: nodeIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("architecture-edge"), edgeId: edgeIdSchema })
    .strict(),
  z
    .object({ kind: z.literal("workload"), workloadId: workloadIdSchema })
    .strict(),
  z
    .object({
      kind: z.literal("external-resource"),
      externalResourceId: externalResourceIdSchema,
    })
    .strict(),
]);

export const observedDesignComparisonV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not-compared") }).strict(),
  z.object({ state: z.literal("no-approved-match") }).strict(),
  z
    .object({
      state: z.literal("matches-approved-design"),
      target: observedDesignTargetV1Schema,
    })
    .strict(),
  z
    .object({
      state: z.literal("conflicts-with-approved-design"),
      target: observedDesignTargetV1Schema,
      conflictKind: z.enum([
        "missing-in-design",
        "missing-in-repository",
        "type-mismatch",
        "configuration-mismatch",
        "relationship-mismatch",
        "ownership-mismatch",
        "implementation-mismatch",
      ]),
      summary: oneLineTextSchema,
    })
    .strict(),
]);

const observedRecordEvidenceShape = {
  certainty: repositoryParseCertaintyV1Schema,
  sourceEvidenceIds: z.array(repositorySourceEvidenceIdSchema).min(1).max(256),
  designComparison: observedDesignComparisonV1Schema,
} as const;

export const observedResourceV1Schema = z
  .object({
    observedResourceId: observedResourceIdSchema,
    capability: namespacedIdentifierSchema,
    resourceType: namespacedIdentifierSchema,
    providerId: namespacedIdentifierSchema.optional(),
    serviceFamily: namespacedIdentifierSchema.optional(),
    ...observedRecordEvidenceShape,
  })
  .strict();

export const observedExternalResourceV1Schema = z
  .object({
    candidateId: externalResourceCandidateIdSchema,
    capability: namespacedIdentifierSchema,
    ownershipCandidate: externalResourceOwnershipStateV1Schema,
    ...observedRecordEvidenceShape,
  })
  .strict();

export const observedConnectionEndpointV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("resource"),
      observedResourceId: observedResourceIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("external-resource"),
      candidateId: externalResourceCandidateIdSchema,
    })
    .strict(),
]);

export const observedConnectionV1Schema = z
  .object({
    observedConnectionId: observedConnectionIdSchema,
    source: observedConnectionEndpointV1Schema,
    target: observedConnectionEndpointV1Schema,
    relationshipType: namespacedIdentifierSchema,
    ...observedRecordEvidenceShape,
  })
  .strict();

export const observedWorkloadV1Schema = z
  .object({
    observedWorkloadId: observedWorkloadIdSchema,
    owningObservedResourceId: observedResourceIdSchema,
    runtimeFamily: namespacedIdentifierSchema.optional(),
    languageFamily: namespacedIdentifierSchema.optional(),
    entrypoints: z.array(safeRelativePathSchema).max(64),
    applicationRelationshipIds: z.array(observedConnectionIdSchema).max(256),
    ...observedRecordEvidenceShape,
  })
  .strict();

export const observedGeneratedFileOwnershipV1Schema = z
  .object({
    observedGeneratedFileId: observedGeneratedFileIdSchema,
    path: safeRelativePathSchema,
    checksum: sha256DigestSchema,
    ownership: z.literal("generated"),
    generatorId: namespacedIdentifierSchema.optional(),
    generatorVersion: semanticVersionSchema.optional(),
    ...observedRecordEvidenceShape,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.generatorId === undefined) !==
      (value.generatorVersion === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Generator identity and version must be supplied together.",
      });
    }
  });

function addDuplicateIssues(
  values: readonly string[],
  path: string,
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [path, index],
        message: `Duplicate stable identity ${value}.`,
      });
    }
    seen.add(value);
  });
}

export const observedSolutionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.observed-solution"),
    observedSolutionId: observedSolutionIdSchema,
    designAuthority: z.literal("none"),
    mutationPolicy: z.literal("reviewed-reconciliation-required"),
    provenance: z
      .object({
        repositorySnapshotId: repositorySnapshotIdSchema,
        repositorySnapshotDigest: sha256DigestSchema,
        commitSha: repositoryCommitShaSchema,
        importedAt: utcTimestampSchema,
        importerId: namespacedIdentifierSchema,
        importerVersion: semanticVersionSchema,
      })
      .strict(),
    evidence: z.array(observedEvidenceReferenceV1Schema).max(50_000),
    resources: z.array(observedResourceV1Schema).max(20_000),
    connections: z.array(observedConnectionV1Schema).max(20_000),
    workloads: z.array(observedWorkloadV1Schema).max(10_000),
    externalResources: z.array(observedExternalResourceV1Schema).max(10_000),
    generatedFileOwnership: z
      .array(observedGeneratedFileOwnershipV1Schema)
      .max(20_000),
    observedContentHash: sha256DigestSchema,
  })
  .strict()
  .superRefine((layer, context) => {
    addDuplicateIssues(
      layer.evidence.map((evidence) => evidence.sourceEvidenceId),
      "evidence",
      context,
    );
    addDuplicateIssues(
      layer.resources.map((resource) => resource.observedResourceId),
      "resources",
      context,
    );
    addDuplicateIssues(
      layer.connections.map((connection) => connection.observedConnectionId),
      "connections",
      context,
    );
    addDuplicateIssues(
      layer.workloads.map((workload) => workload.observedWorkloadId),
      "workloads",
      context,
    );
    addDuplicateIssues(
      layer.externalResources.map((resource) => resource.candidateId),
      "externalResources",
      context,
    );
    addDuplicateIssues(
      layer.generatedFileOwnership.map(
        (record) => record.observedGeneratedFileId,
      ),
      "generatedFileOwnership",
      context,
    );

    const evidenceIds = new Set(
      layer.evidence.map((evidence) => evidence.sourceEvidenceId),
    );
    const records = [
      ...layer.resources.map((record, index) => ({
        path: ["resources", index],
        record,
      })),
      ...layer.connections.map((record, index) => ({
        path: ["connections", index],
        record,
      })),
      ...layer.workloads.map((record, index) => ({
        path: ["workloads", index],
        record,
      })),
      ...layer.externalResources.map((record, index) => ({
        path: ["externalResources", index],
        record,
      })),
      ...layer.generatedFileOwnership.map((record, index) => ({
        path: ["generatedFileOwnership", index],
        record,
      })),
    ];
    for (const { path, record } of records) {
      record.sourceEvidenceIds.forEach((evidenceId, index) => {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: [...path, "sourceEvidenceIds", index],
            message: `Unknown source evidence ID ${evidenceId}.`,
          });
        }
      });
    }

    const resourceIds = new Set(
      layer.resources.map((resource) => resource.observedResourceId),
    );
    const externalIds = new Set(
      layer.externalResources.map((resource) => resource.candidateId),
    );
    const connectionIds = new Set(
      layer.connections.map((connection) => connection.observedConnectionId),
    );
    for (const [index, connection] of layer.connections.entries()) {
      for (const [endpointName, endpoint] of [
        ["source", connection.source],
        ["target", connection.target],
      ] as const) {
        const exists =
          endpoint.kind === "resource"
            ? resourceIds.has(endpoint.observedResourceId)
            : externalIds.has(endpoint.candidateId);
        if (!exists) {
          context.addIssue({
            code: "custom",
            path: ["connections", index, endpointName],
            message: "Observed connection endpoint does not exist.",
          });
        }
      }
    }
    for (const [index, workload] of layer.workloads.entries()) {
      if (!resourceIds.has(workload.owningObservedResourceId)) {
        context.addIssue({
          code: "custom",
          path: ["workloads", index, "owningObservedResourceId"],
          message: "Observed workload owner does not exist.",
        });
      }
      workload.applicationRelationshipIds.forEach((connectionId, refIndex) => {
        if (!connectionIds.has(connectionId)) {
          context.addIssue({
            code: "custom",
            path: ["workloads", index, "applicationRelationshipIds", refIndex],
            message: "Observed workload relationship does not exist.",
          });
        }
      });
    }
  });

export type ObservedEvidenceReferenceV1 = z.output<
  typeof observedEvidenceReferenceV1Schema
>;
export type ObservedResourceV1 = z.output<typeof observedResourceV1Schema>;
export type ObservedConnectionV1 = z.output<typeof observedConnectionV1Schema>;
export type ObservedWorkloadV1 = z.output<typeof observedWorkloadV1Schema>;
export type ObservedExternalResourceV1 = z.output<
  typeof observedExternalResourceV1Schema
>;
export type ObservedGeneratedFileOwnershipV1 = z.output<
  typeof observedGeneratedFileOwnershipV1Schema
>;
export type ObservedSolutionV1 = z.output<typeof observedSolutionV1Schema>;
