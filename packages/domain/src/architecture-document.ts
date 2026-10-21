import {
  parseArchitectureDocumentV1,
  parseArchitectureDocumentV2,
  parseArchitectureDocumentV3,
  workloadBehaviorV2Schema,
  type ArchitectureDocumentV2,
  type ArchitectureDocumentV3,
  type ArchitectureEdgeV1,
  type ArchitectureNodeV1,
  type ConfigurationValue,
  type EdgeId,
  type NodeId,
  type ServiceConfigurationRecord,
  type VariableId,
  type VersionedArchitectureDocument,
  type WorkloadBehaviorV1,
  type WorkloadBehaviorV2,
} from "@cloudmarkup/schemas";

import {
  ArchitectureDocumentSemanticError,
  validateArchitectureDocumentSemantics,
} from "./semantic-validation.js";

export type ArchitectureDocument = ArchitectureDocumentV3;
export type ArchitectureNode = ArchitectureNodeV1;
export type ArchitectureEdge = ArchitectureEdgeV1;
export type ArchitectureConfiguration = ServiceConfigurationRecord;
export type ArchitectureConfigurationValue = ConfigurationValue;
export type ArchitectureNodeId = NodeId;
export type ArchitectureEdgeId = EdgeId;
export type ArchitectureVariableId = VariableId;

function validateArchitectureDocument<
  TDocument extends ArchitectureDocumentV2 | ArchitectureDocumentV3,
>(document: TDocument): TDocument {
  const issues = validateArchitectureDocumentSemantics(document);

  if (issues.length > 0) {
    throw new ArchitectureDocumentSemanticError(issues);
  }

  return document;
}

export function migrateArchitectureDocumentV1ToV2(
  input: unknown,
): ArchitectureDocumentV2 {
  const source = parseArchitectureDocumentV1(input);
  const migrated = parseArchitectureDocumentV2({
    ...source,
    schemaVersion: 2,
    workloadBehavior: {
      contractVersion: 1,
      workloads: [],
    },
  });

  return validateArchitectureDocument(migrated);
}

export function migrateWorkloadBehaviorV1ToV2(
  source: WorkloadBehaviorV1,
): WorkloadBehaviorV2 {
  return workloadBehaviorV2Schema.parse({
    contractVersion: 2,
    workloads: source.workloads.map((workload) => ({
      ...workload,
      behaviorContracts: [],
      entrypoints: [],
      httpRoutes: [],
      eventBindings: [],
      schedules: [],
      dataBindings: [],
      authorization: [],
      idempotency: [],
      observability: {
        signals: [],
        healthChecks: [],
        smokeTests: [],
      },
      tests: [],
      sourceOwnership: [],
      extensionPoints: [],
      extensions: [],
      implementationRequirements: [],
      compatibility: {
        applicationGenerators: [],
        modelGateways: [],
      },
      provenance: {
        source: "deterministic-migration",
        migrationId: "cloudmarkup.workload.v1-to-v2",
        migrationVersion: "1.0.0",
      },
    })),
  });
}

export function migrateArchitectureDocumentV2ToV3(
  input: unknown,
): ArchitectureDocumentV3 {
  const source = parseArchitectureDocumentV2(input);
  const nestedRevision = {
    revisionId: source.revision.revisionId,
    revisionNumber: source.revision.revisionNumber,
    createdAt: source.revision.createdAt,
    createdBy: source.revision.createdBy,
    ...(source.revision.previousRevisionId === undefined
      ? {}
      : { previousRevisionId: source.revision.previousRevisionId }),
  };

  const migrated = parseArchitectureDocumentV3({
    ...source,
    schemaVersion: 3,
    applicationContracts: {
      kind: "cloudmarkup.application-contracts",
      schemaVersion: 1,
      contractSetId: source.architectureId,
      documentId: source.documentId,
      revision: nestedRevision,
      contracts: [],
    },
    externalResources: {
      kind: "cloudmarkup.external-resource-reference-document",
      schemaVersion: 1,
      documentId: source.documentId,
      architectureId: source.architectureId,
      revision: nestedRevision,
      resources: [],
    },
    workloadBehavior: migrateWorkloadBehaviorV1ToV2(source.workloadBehavior),
  });

  return validateArchitectureDocument(migrated);
}

export function parseArchitectureDocument(
  input: unknown,
): ArchitectureDocument {
  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Readonly<Record<string, unknown>>)["schemaVersion"] === 1
  ) {
    return migrateArchitectureDocumentV2ToV3(
      migrateArchitectureDocumentV1ToV2(input),
    );
  }

  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Readonly<Record<string, unknown>>)["schemaVersion"] === 2
  ) {
    return migrateArchitectureDocumentV2ToV3(input);
  }

  return validateArchitectureDocument(parseArchitectureDocumentV3(input));
}

export type { VersionedArchitectureDocument };
