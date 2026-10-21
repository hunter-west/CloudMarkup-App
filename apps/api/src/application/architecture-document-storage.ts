import { createHash } from "node:crypto";

import {
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  serializeArchitectureDocumentV3,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";

import type { StageObjectInput } from "./persistence.js";

const CREATED_AT = "2026-08-15T00:00:00.000Z";
const CATALOG_DIGEST = `sha256:${"0".repeat(64)}` as const;

export interface ArchitectureDocumentIdentity {
  readonly architectureId: string;
  readonly documentId: string;
  readonly draftId: string;
  readonly principalId: string;
  readonly revisionId: string;
}

export interface ArchitectureDocumentStorage {
  readonly bytes: Uint8Array;
  readonly contentSha256: string;
  readonly document: ArchitectureDocumentV3;
  readonly semanticSha256: string;
  readonly visualSha256: string;
}

function revision(identity: ArchitectureDocumentIdentity, createdAt: string) {
  return {
    createdAt,
    createdBy: identity.principalId,
    revisionId: identity.revisionId,
    revisionNumber: 1,
    sourceDraftId: identity.draftId,
  } as const;
}
function embeddedRevision(
  identity: ArchitectureDocumentIdentity,
  createdAt: string,
) {
  const { sourceDraftId, ...embedded } = revision(identity, createdAt);
  void sourceDraftId;
  return embedded;
}

/**
 * Builds a credentialless initial document from provider-neutral example
 * service identifiers. It exercises v3's Workload, External Resource, and
 * Application Contract boundaries without claiming provider support.
 */
export function createInitialArchitectureDocument(input: {
  readonly identity: ArchitectureDocumentIdentity;
  readonly infrastructureOnly: boolean;
  readonly blank?: boolean;
  readonly createdAt?: string;
}): ArchitectureDocumentV3 {
  const createdAt = input.createdAt ?? CREATED_AT;
  const documentRevision = revision(input.identity, createdAt);
  const nestedRevision = embeddedRevision(input.identity, createdAt);
  const nodes = [
    {
      id: "node_api",
      semantic: {
        configuration: {
          schemaId: "example.http.api-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        deploymentKey: "api",
        lifecycle: { origin: "user", ownership: "user" },
        resourceType: "example.http.api",
        serviceType: "example.http",
      },
      presentation: {
        label: "Notes API",
        position: { x: 40, y: 80 },
      },
    },
    {
      id: "node_handler",
      semantic: {
        configuration: {
          schemaId: "example.compute.function-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        deploymentKey: "handler",
        lifecycle: { origin: "user", ownership: "user" },
        resourceType: "example.compute.function",
        serviceType: "example.compute",
      },
      presentation: {
        label: "Notes handler",
        position: { x: 260, y: 80 },
      },
    },
    {
      id: "node_store",
      semantic: {
        configuration: {
          schemaId: "example.data.table-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        deploymentKey: "store",
        lifecycle: { origin: "user", ownership: "user" },
        resourceType: "example.data.table",
        serviceType: "example.data",
      },
      presentation: {
        label: "Notes store",
        position: { x: 480, y: 80 },
      },
    },
  ] as const;
  const edges = [
    {
      id: "edge_api_handler",
      semantic: {
        configuration: {
          schemaId: "example.relationship.invokes-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        lifecycle: { origin: "user", ownership: "user" },
        relationshipType: "example.relationship.invokes",
        source: { nodeId: "node_api", port: "example.port.request" },
        target: { nodeId: "node_handler", port: "example.port.invocation" },
      },
    },
    {
      id: "edge_handler_store",
      semantic: {
        configuration: {
          schemaId: "example.relationship.writes-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        lifecycle: { origin: "user", ownership: "user" },
        relationshipType: "example.relationship.writes",
        source: { nodeId: "node_handler", port: "example.port.data-write" },
        target: { nodeId: "node_store", port: "example.port.data" },
      },
    },
  ] as const;

  return parseArchitectureDocument({
    applicationContracts: {
      contractSetId: input.identity.architectureId,
      contracts: [],
      documentId: input.identity.documentId,
      kind: "cloudmarkup.application-contracts",
      revision: nestedRevision,
      schemaVersion: 1,
    },
    architectureId: input.identity.architectureId,
    assumptions:
      input.infrastructureOnly && input.blank !== true
        ? [
            {
              id: "assumption_infrastructure_only",
              origin: "user",
              statement:
                "This project intentionally has no application workload.",
              status: "accepted",
            },
          ]
        : [],
    catalog: {
      digest: CATALOG_DIGEST,
      id: "example.cloud.catalog",
      version: "1.0.0",
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      maximumCompilerVersionExclusive: "2.0.0",
      minimumCompilerVersion: "1.0.0",
    },
    documentId: input.identity.documentId,
    edges: input.blank === true ? [] : edges,
    externalResources: {
      architectureId: input.identity.architectureId,
      documentId: input.identity.documentId,
      kind: "cloudmarkup.external-resource-reference-document",
      resources: [],
      revision: nestedRevision,
      schemaVersion: 1,
    },
    kind: "cloudmarkup.architecture-document",
    metadata: {
      serialization: {
        canonicalization: "cloudmarkup.canonical-json.v1",
        encoding: "utf-8",
        mediaType: "application/json",
      },
      source: "user",
    },
    nodes: input.blank === true ? [] : nodes,
    outputs: [],
    provider: { id: "example.cloud", region: "example-region-1" },
    revision: documentRevision,
    schemaVersion: 3,
    unresolvedRequirements: [],
    variables: [],
    workloadBehavior: {
      contractVersion: 2,
      workloads: input.infrastructureOnly
        ? []
        : [
            {
              authorization: [],
              behaviorContracts: [],
              compatibility: {
                applicationGenerators: [],
                modelGateways: [],
              },
              dataBindings: [],
              downstreamActions: [
                {
                  edgeId: "edge_handler_store",
                  id: "workload_action_store",
                  sourceOperationId: "workload_operation_request",
                },
              ],
              entrypoints: [],
              environment: [],
              errorBehavior: { mode: "fail-invocation" },
              eventBindings: [],
              executionAssumptions: {
                retry: { kind: "bounded", maximumAttempts: 3 },
                timeout: { kind: "duration", milliseconds: 30_000 },
              },
              extensionPoints: [],
              extensions: [],
              httpRoutes: [],
              id: "workload_notes_handler",
              idempotency: [],
              implementation: {
                handler: "src/handler.main",
                mode: "user-provided",
                runtimeFamily: "example.runtime.nodejs",
                sourceOwnership: "user",
              },
              implementationRequirements: [],
              observability: {
                healthChecks: [],
                signals: [],
                smokeTests: [],
              },
              operations: [
                {
                  capability: "example.workload.handle-request",
                  id: "workload_operation_request",
                  inputContract: { kind: "none" },
                  outputContract: { kind: "none" },
                },
              ],
              owningNodeId: "node_handler",
              provenance: {
                recordedAt: createdAt,
                recordedBy: input.identity.principalId,
                source: "manual",
              },
              schedules: [],
              sourceOwnership: [],
              tests: [],
              triggerDispatch: { mode: "single" },
              triggers: [
                {
                  edgeId: "edge_api_handler",
                  id: "workload_trigger_api",
                  targetOperationId: "workload_operation_request",
                },
              ],
              unresolvedRequirementIds: [],
            },
          ],
    },
  });
}

export function rebindArchitectureDocumentCopy(input: {
  readonly architectureDocument: unknown;
  readonly identity: ArchitectureDocumentIdentity;
  readonly createdAt: string;
}): ArchitectureDocumentV3 {
  const source = architectureDocumentV3Schema.parse(input.architectureDocument);
  const nextRevision = revision(input.identity, input.createdAt);
  const nextNestedRevision = embeddedRevision(input.identity, input.createdAt);
  return parseArchitectureDocument({
    ...source,
    applicationContracts: {
      ...source.applicationContracts,
      contractSetId: input.identity.architectureId,
      documentId: input.identity.documentId,
      revision: nextNestedRevision,
    },
    architectureId: input.identity.architectureId,
    documentId: input.identity.documentId,
    externalResources: {
      ...source.externalResources,
      architectureId: input.identity.architectureId,
      documentId: input.identity.documentId,
      revision: nextNestedRevision,
    },
    revision: nextRevision,
  });
}

export function rebindImmutableArchitectureRevision(input: {
  readonly architectureDocument: unknown;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly previousRevisionId?: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly sourceDraftId: string;
}): ArchitectureDocumentV3 {
  const source = architectureDocumentV3Schema.parse(input.architectureDocument);
  const nestedRevision = {
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    ...(input.previousRevisionId === undefined
      ? {}
      : { previousRevisionId: input.previousRevisionId }),
    revisionId: input.revisionId,
    revisionNumber: input.revisionNumber,
  };
  return parseArchitectureDocument({
    ...source,
    applicationContracts: {
      ...source.applicationContracts,
      revision: nestedRevision,
    },
    externalResources: {
      ...source.externalResources,
      revision: nestedRevision,
    },
    revision: {
      ...nestedRevision,
      sourceDraftId: input.sourceDraftId,
    },
  });
}

export function getArchitectureDocumentStorage(
  document: ArchitectureDocumentV3,
): ArchitectureDocumentStorage {
  const serialized = serializeArchitectureDocumentV3(document);
  const bytes = new TextEncoder().encode(serialized);
  return {
    bytes,
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    document,
    semanticSha256: getArchitectureDocumentContentHash(document).slice(7),
    visualSha256: getArchitectureDocumentVisualHash(document).slice(7),
  };
}

export function createDocumentStageInput(input: {
  readonly document: ArchitectureDocumentV3;
  readonly objectId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly purpose?: "architecture-draft" | "architecture-revision";
}): StageObjectInput {
  const storage = getArchitectureDocumentStorage(input.document);
  return {
    contentSha256: storage.contentSha256,
    mediaType: "application/json",
    objectId: input.objectId,
    open: async function* open(): AsyncIterable<Uint8Array> {
      yield storage.bytes;
      await Promise.resolve();
    },
    owner: {
      organizationId: input.organizationId,
      projectId: input.projectId,
    },
    purpose: input.purpose ?? "architecture-draft",
    sizeBytes: storage.bytes.byteLength,
  };
}
