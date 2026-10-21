import {
  parseGraphCommandV1,
  serializeCanonicalJson,
  type AddEdgeCommandV1,
  type AddNodeCommandV1,
  type AdoptGeneratedResourceCommandV1,
  type ArchitectureEdgeV1,
  type ArchitectureNodeV1,
  type ElementLifecycle,
  type GeneratedDependencyReferenceV1,
  type GeneratedElementLifecycle,
  type GraphCommandActionV1,
  type GraphCommandBatchV1,
  type GraphCommandV1,
  type GraphResourceReferenceV1,
  type MoveNodeCommandV1,
  type ReleaseGeneratedResourceCommandV1,
  type RemoveEdgeCommandV1,
  type RemoveNodeCommandV1,
  type ReparentNodeCommandV1,
  type ReplaceWorkloadAndApplicationContractsCommandV1,
  type ReplaceCatalogBindingCommandV1,
  type UpdateEdgeConfigurationCommandV1,
  type UpdateNodeConfigurationCommandV1,
  type VersionedArchitectureDocument,
} from "@cloudmarkup/schemas";

import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "./architecture-document.js";
import {
  validateArchitectureDocumentSemantics,
  type ArchitectureDocumentSemanticIssue,
} from "./semantic-validation.js";

export type GraphCommandApplicationIssueCode =
  | "command_identity_conflict"
  | "document_precondition_failed"
  | "duplicate_batch_command_identity"
  | "duplicate_release_dependency"
  | "generated_dependency_not_found"
  | "generated_resource_requires_adoption"
  | "generated_resource_requires_release"
  | "invalid_new_resource_ownership"
  | "precondition_failed"
  | "resource_already_exists"
  | "resource_has_dependents"
  | "resource_not_found"
  | "resource_not_generated"
  | "semantic_invariant_violation";

export interface GraphCommandApplicationIssue {
  readonly code: GraphCommandApplicationIssueCode;
  readonly message: string;
  readonly path: string;
  readonly semanticCode?: ArchitectureDocumentSemanticIssue["code"];
}

export type GraphCommandNonInvertibleReasonCode =
  | "adoption_requires_explicit_policy"
  | "batch_contains_non_invertible_command"
  | "generated_provenance_changed"
  | "generated_resource_retained";

export interface GraphCommandNonInvertibleReason {
  readonly code: GraphCommandNonInvertibleReasonCode;
  readonly message: string;
}

export type GraphCommandInversion =
  | {
      readonly kind: "available";
      readonly command: GraphCommandV1;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: GraphCommandNonInvertibleReason;
    };

interface ChangeBase {
  readonly commandId: string;
}

export type GraphChangeSummary =
  | (ChangeBase & {
      readonly kind: "catalog-binding-replaced";
      readonly previousCatalog: ArchitectureDocument["catalog"];
      readonly catalog: ArchitectureDocument["catalog"];
    })
  | (ChangeBase & {
      readonly kind: "node-added" | "node-removed";
      readonly nodeId: string;
    })
  | (ChangeBase & {
      readonly kind: "node-configuration-updated";
      readonly nodeId: string;
    })
  | (ChangeBase & {
      readonly kind: "node-moved";
      readonly nodeId: string;
      readonly from: { readonly x: number; readonly y: number };
      readonly to: { readonly x: number; readonly y: number };
    })
  | (ChangeBase & {
      readonly kind: "node-reparented";
      readonly nodeId: string;
      readonly fromParentId: string | null;
      readonly toParentId: string | null;
    })
  | (ChangeBase & {
      readonly kind: "edge-added" | "edge-removed";
      readonly edgeId: string;
    })
  | (ChangeBase & {
      readonly kind: "edge-configuration-updated";
      readonly edgeId: string;
    })
  | (ChangeBase & {
      readonly kind: "workload-and-application-contracts-replaced";
      readonly previousWorkloadCount: number;
      readonly workloadCount: number;
      readonly previousApplicationContractCount: number;
      readonly applicationContractCount: number;
    })
  | (ChangeBase & {
      readonly kind: "generated-resource-adopted";
      readonly resource: GraphResourceReferenceV1;
    })
  | (ChangeBase & {
      readonly kind: "generated-resource-released";
      readonly resource: GraphResourceReferenceV1;
      readonly disposition: "removed" | "retained";
      readonly provenanceReferenceCount: number;
      readonly graphReferenceCount: number;
    })
  | (ChangeBase & {
      readonly kind: "batch-applied";
      readonly commandCount: number;
    });

export interface GraphCommandApplicationResult {
  readonly document: ArchitectureDocument;
  readonly changes: readonly GraphChangeSummary[];
  readonly inversion: GraphCommandInversion;
}

interface ActionApplicationResult {
  readonly document: ArchitectureDocument;
  readonly changes: readonly GraphChangeSummary[];
  readonly inversion: GraphCommandInversion;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export function formatGraphCommandApplicationIssues(
  issues: readonly GraphCommandApplicationIssue[],
): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message} [${issue.code}]`)
    .join("\n");
}

export class GraphCommandApplicationError extends Error {
  public readonly issues: readonly GraphCommandApplicationIssue[];

  public constructor(issues: readonly GraphCommandApplicationIssue[]) {
    const sorted = [...issues].sort(
      (left, right) =>
        compareUtf16(left.path, right.path) ||
        compareUtf16(left.code, right.code) ||
        compareUtf16(left.message, right.message),
    );
    super(formatGraphCommandApplicationIssues(sorted));
    this.name = "GraphCommandApplicationError";
    this.issues = sorted;
  }
}

function fail(
  code: GraphCommandApplicationIssueCode,
  path: string,
  message: string,
): never {
  throw new GraphCommandApplicationError([{ code, message, path }]);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function equalJson(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function unavailable(
  code: GraphCommandNonInvertibleReasonCode,
  message: string,
): GraphCommandInversion {
  return {
    kind: "unavailable",
    reason: { code, message },
  };
}

function assertCommandIdentity(command: GraphCommandV1, path = "$"): void {
  if (command.commandId === command.inverseCommandId) {
    fail(
      "command_identity_conflict",
      `${path}.inverseCommandId`,
      "Command and inverse command IDs must be distinct.",
    );
  }
}

function assertDocumentTarget(
  document: ArchitectureDocument,
  command: GraphCommandV1,
  path = "$.target",
): void {
  if (
    document.documentId !== command.target.documentId ||
    document.architectureId !== command.target.architectureId ||
    document.revision.revisionId !== command.target.revisionId
  ) {
    fail(
      "document_precondition_failed",
      path,
      "Command target does not match the Architecture Document identity.",
    );
  }
}

function findNode(
  document: ArchitectureDocument,
  nodeId: string,
  path: string,
): { readonly node: ArchitectureNodeV1; readonly index: number } {
  const index = document.nodes.findIndex((node) => node.id === nodeId);
  const node = document.nodes[index];
  if (node === undefined) {
    fail("resource_not_found", path, "Target node does not exist.");
  }

  return { node, index };
}

function findEdge(
  document: ArchitectureDocument,
  edgeId: string,
  path: string,
): { readonly edge: ArchitectureEdgeV1; readonly index: number } {
  const index = document.edges.findIndex((edge) => edge.id === edgeId);
  const edge = document.edges[index];
  if (edge === undefined) {
    fail("resource_not_found", path, "Target edge does not exist.");
  }

  return { edge, index };
}

function lifecycleOf(
  document: ArchitectureDocument,
  resource: GraphResourceReferenceV1,
): ElementLifecycle {
  return resource.kind === "node"
    ? findNode(document, resource.nodeId, "$.resource.nodeId").node.semantic
        .lifecycle
    : findEdge(document, resource.edgeId, "$.resource.edgeId").edge.semantic
        .lifecycle;
}

function countConfigurationNodeReferences(
  document: ArchitectureDocument,
  nodeId: string,
): number {
  const externalElements = [
    ...document.nodes.filter((node) => node.id !== nodeId),
    ...document.edges,
  ];

  return externalElements.reduce(
    (total, element) =>
      total +
      Object.values(element.semantic.configuration.values).filter(
        (value) => value.kind === "node-reference" && value.nodeId === nodeId,
      ).length,
    0,
  );
}

function countProvenanceReferences(
  document: ArchitectureDocument,
  resource: GraphResourceReferenceV1,
): number {
  return [...document.nodes, ...document.edges].reduce((total, element) => {
    const lifecycle = element.semantic.lifecycle;
    if (lifecycle.ownership === "user") {
      return total;
    }

    const references =
      resource.kind === "node"
        ? lifecycle.provenance.dependentNodeIds.filter(
            (nodeId) => nodeId === resource.nodeId,
          ).length
        : lifecycle.provenance.dependentEdgeIds.filter(
            (edgeId) => edgeId === resource.edgeId,
          ).length;

    return total + references;
  }, 0);
}

function countWorkloadEdgeReferences(
  document: ArchitectureDocument,
  edgeId: string,
): number {
  return document.workloadBehavior.workloads.reduce(
    (total, workload) =>
      total +
      workload.triggers.filter((trigger) => trigger.edgeId === edgeId).length +
      workload.downstreamActions.filter((action) => action.edgeId === edgeId)
        .length,
    0,
  );
}

function countWorkloadNodeReferences(
  document: ArchitectureDocument,
  nodeId: string,
): number {
  return document.workloadBehavior.workloads.reduce(
    (total, workload) =>
      total +
      Number(workload.owningNodeId === nodeId) +
      workload.environment.filter(
        (binding) =>
          binding.value.kind === "node-attribute-reference" &&
          binding.value.nodeId === nodeId,
      ).length,
    0,
  );
}

function countGraphReferences(
  document: ArchitectureDocument,
  resource: GraphResourceReferenceV1,
): number {
  if (resource.kind === "edge") {
    return (
      countProvenanceReferences(document, resource) +
      countWorkloadEdgeReferences(document, resource.edgeId)
    );
  }

  const nodeId = resource.nodeId;
  const parentReferences = document.nodes.filter(
    (node) => node.semantic.parent?.nodeId === nodeId,
  ).length;
  const edgeEndpointReferences = document.edges.reduce(
    (total, edge) =>
      total +
      Number(edge.semantic.source.nodeId === nodeId) +
      Number(edge.semantic.target.nodeId === nodeId),
    0,
  );
  const outputReferences = document.outputs.filter(
    (output) =>
      output.source.kind === "node-attribute" &&
      output.source.nodeId === nodeId,
  ).length;

  return (
    parentReferences +
    edgeEndpointReferences +
    outputReferences +
    countConfigurationNodeReferences(document, nodeId) +
    countProvenanceReferences(document, resource) +
    countWorkloadNodeReferences(document, nodeId)
  );
}

function countLifecycleDependencies(
  document: ArchitectureDocument,
  lifecycle: ElementLifecycle,
): number {
  if (lifecycle.ownership === "user") {
    return 0;
  }

  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const edgeIds = new Set(document.edges.map((edge) => edge.id));

  return (
    lifecycle.provenance.dependentNodeIds.filter((nodeId) =>
      nodeIds.has(nodeId),
    ).length +
    lifecycle.provenance.dependentEdgeIds.filter((edgeId) =>
      edgeIds.has(edgeId),
    ).length
  );
}

function assertNoDependents(
  document: ArchitectureDocument,
  resource: GraphResourceReferenceV1,
  lifecycle: ElementLifecycle,
  path: string,
): void {
  const graphReferenceCount = countGraphReferences(document, resource);
  const lifecycleDependencyCount = countLifecycleDependencies(
    document,
    lifecycle,
  );
  if (graphReferenceCount + lifecycleDependencyCount > 0) {
    fail(
      "resource_has_dependents",
      path,
      "Resource cannot be removed while graph or provenance dependents remain.",
    );
  }
}

function removeDependency(
  lifecycle: GeneratedElementLifecycle,
  dependency: GeneratedDependencyReferenceV1,
): GeneratedElementLifecycle {
  if (dependency.kind === "node") {
    if (!lifecycle.provenance.dependentNodeIds.includes(dependency.nodeId)) {
      fail(
        "generated_dependency_not_found",
        "$.dependencies",
        "Released node dependency is not present in generated provenance.",
      );
    }

    return {
      ...lifecycle,
      provenance: {
        ...lifecycle.provenance,
        dependentNodeIds: lifecycle.provenance.dependentNodeIds.filter(
          (nodeId) => nodeId !== dependency.nodeId,
        ),
      },
    };
  }

  if (!lifecycle.provenance.dependentEdgeIds.includes(dependency.edgeId)) {
    fail(
      "generated_dependency_not_found",
      "$.dependencies",
      "Released edge dependency is not present in generated provenance.",
    );
  }

  return {
    ...lifecycle,
    provenance: {
      ...lifecycle.provenance,
      dependentEdgeIds: lifecycle.provenance.dependentEdgeIds.filter(
        (edgeId) => edgeId !== dependency.edgeId,
      ),
    },
  };
}

function assertUniqueReleaseDependencies(
  dependencies: readonly GeneratedDependencyReferenceV1[],
): void {
  const seen = new Set<string>();
  dependencies.forEach((dependency, index) => {
    const key =
      dependency.kind === "node"
        ? `node:${dependency.nodeId}`
        : `edge:${dependency.edgeId}`;
    if (seen.has(key)) {
      fail(
        "duplicate_release_dependency",
        `$.dependencies[${String(index)}]`,
        "Release dependencies must be unique.",
      );
    }
    seen.add(key);
  });
}

function applyAddNode(
  document: ArchitectureDocument,
  command: AddNodeCommandV1,
): ActionApplicationResult {
  if (document.nodes.some((node) => node.id === command.node.id)) {
    fail(
      "resource_already_exists",
      "$.node.id",
      "A node with this stable ID already exists.",
    );
  }
  if (
    document.nodes.some(
      (node) =>
        node.semantic.deploymentKey === command.node.semantic.deploymentKey,
    )
  ) {
    fail(
      "resource_already_exists",
      "$.node.semantic.deploymentKey",
      "A node with this stable deployment key already exists.",
    );
  }
  if (command.node.semantic.lifecycle.ownership === "adopted") {
    fail(
      "invalid_new_resource_ownership",
      "$.node.semantic.lifecycle.ownership",
      "New resources cannot begin with adopted ownership.",
    );
  }

  const node = cloneJson(command.node);
  const nextDocument = {
    ...document,
    nodes: [...document.nodes, node],
  };
  let inverse: GraphCommandV1;

  if (node.semantic.lifecycle.ownership === "generated") {
    const dependencies: GeneratedDependencyReferenceV1[] = [
      ...node.semantic.lifecycle.provenance.dependentNodeIds.map((nodeId) => ({
        kind: "node" as const,
        nodeId,
      })),
      ...node.semantic.lifecycle.provenance.dependentEdgeIds.map((edgeId) => ({
        kind: "edge" as const,
        edgeId,
      })),
    ];
    inverse = {
      schemaVersion: 1,
      commandId: command.inverseCommandId,
      inverseCommandId: command.commandId,
      origin: command.origin,
      target: command.target,
      kind: "release-generated-resource",
      resource: { kind: "node", nodeId: node.id },
      expectedLifecycle: cloneJson(node.semantic.lifecycle),
      dependencies,
      requiredDisposition: "removed",
    };
  } else {
    inverse = {
      schemaVersion: 1,
      commandId: command.inverseCommandId,
      inverseCommandId: command.commandId,
      origin: command.origin,
      target: command.target,
      kind: "remove-node",
      nodeId: node.id,
      expectedNode: cloneJson(node),
    };
  }

  return {
    document: nextDocument,
    changes: [
      {
        kind: "node-added",
        commandId: command.commandId,
        nodeId: node.id,
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applyRemoveNode(
  document: ArchitectureDocument,
  command: RemoveNodeCommandV1,
): ActionApplicationResult {
  const { node, index } = findNode(document, command.nodeId, "$.nodeId");
  if (!equalJson(node, command.expectedNode)) {
    fail(
      "precondition_failed",
      "$.expectedNode",
      "Node no longer matches the expected snapshot.",
    );
  }
  if (node.semantic.lifecycle.ownership === "generated") {
    fail(
      "generated_resource_requires_release",
      "$.nodeId",
      "Generated nodes must be removed through the release command.",
    );
  }
  assertNoDependents(
    document,
    { kind: "node", nodeId: node.id },
    node.semantic.lifecycle,
    "$.nodeId",
  );

  const nextDocument = {
    ...document,
    nodes: document.nodes.filter((_, nodeIndex) => nodeIndex !== index),
  };
  const inverse: AddNodeCommandV1 = {
    schemaVersion: 1,
    commandId: command.inverseCommandId,
    inverseCommandId: command.commandId,
    origin: command.origin,
    target: command.target,
    kind: "add-node",
    node: cloneJson(node),
  };

  return {
    document: nextDocument,
    changes: [
      {
        kind: "node-removed",
        commandId: command.commandId,
        nodeId: node.id,
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applyUpdateNodeConfiguration(
  document: ArchitectureDocument,
  command: UpdateNodeConfigurationCommandV1,
): ActionApplicationResult {
  const { node, index } = findNode(document, command.nodeId, "$.nodeId");
  if (!equalJson(node.semantic.configuration, command.expectedConfiguration)) {
    fail(
      "precondition_failed",
      "$.expectedConfiguration",
      "Node configuration no longer matches the expected value.",
    );
  }
  if (node.semantic.lifecycle.ownership === "generated") {
    fail(
      "generated_resource_requires_adoption",
      "$.nodeId",
      "Generated nodes must be adopted before semantic customization.",
    );
  }

  const configuration = cloneJson(command.configuration);
  const nextNode = {
    ...node,
    semantic: {
      ...node.semantic,
      configuration,
    },
  };
  const nextNodes = [...document.nodes];
  nextNodes[index] = nextNode;
  const inverse: UpdateNodeConfigurationCommandV1 = {
    ...command,
    commandId: command.inverseCommandId,
    inverseCommandId: command.commandId,
    expectedConfiguration: cloneJson(configuration),
    configuration: cloneJson(node.semantic.configuration),
  };

  return {
    document: { ...document, nodes: nextNodes },
    changes: [
      {
        kind: "node-configuration-updated",
        commandId: command.commandId,
        nodeId: node.id,
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applyMoveNode(
  document: ArchitectureDocument,
  command: MoveNodeCommandV1,
): ActionApplicationResult {
  const { node, index } = findNode(document, command.nodeId, "$.nodeId");
  if (!equalJson(node.presentation.position, command.expectedPosition)) {
    fail(
      "precondition_failed",
      "$.expectedPosition",
      "Node position no longer matches the expected value.",
    );
  }

  const position = cloneJson(command.position);
  const nextNode = {
    ...node,
    presentation: {
      ...node.presentation,
      position,
    },
  };
  const nextNodes = [...document.nodes];
  nextNodes[index] = nextNode;
  const inverse: MoveNodeCommandV1 = {
    ...command,
    commandId: command.inverseCommandId,
    inverseCommandId: command.commandId,
    expectedPosition: cloneJson(position),
    position: cloneJson(node.presentation.position),
  };

  return {
    document: { ...document, nodes: nextNodes },
    changes: [
      {
        kind: "node-moved",
        commandId: command.commandId,
        nodeId: node.id,
        from: cloneJson(node.presentation.position),
        to: cloneJson(position),
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applyReparentNode(
  document: ArchitectureDocument,
  command: ReparentNodeCommandV1,
): ActionApplicationResult {
  const { node, index } = findNode(document, command.nodeId, "$.nodeId");
  if (!equalJson(node.semantic.parent ?? null, command.expectedParent)) {
    fail(
      "precondition_failed",
      "$.expectedParent",
      "Node parent no longer matches the expected value.",
    );
  }
  if (node.semantic.lifecycle.ownership === "generated") {
    fail(
      "generated_resource_requires_adoption",
      "$.nodeId",
      "Generated nodes must be adopted before containment customization.",
    );
  }

  const semantic = { ...node.semantic };
  if (command.parent === null) {
    delete semantic.parent;
  } else {
    semantic.parent = cloneJson(command.parent);
  }
  const nextNode = { ...node, semantic };
  const nextNodes = [...document.nodes];
  nextNodes[index] = nextNode;
  const inverse: ReparentNodeCommandV1 = {
    ...command,
    commandId: command.inverseCommandId,
    inverseCommandId: command.commandId,
    expectedParent: cloneJson(command.parent),
    parent: cloneJson(node.semantic.parent ?? null),
  };

  return {
    document: { ...document, nodes: nextNodes },
    changes: [
      {
        kind: "node-reparented",
        commandId: command.commandId,
        nodeId: node.id,
        fromParentId: node.semantic.parent?.nodeId ?? null,
        toParentId: command.parent?.nodeId ?? null,
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applyAddEdge(
  document: ArchitectureDocument,
  command: AddEdgeCommandV1,
): ActionApplicationResult {
  if (document.edges.some((edge) => edge.id === command.edge.id)) {
    fail(
      "resource_already_exists",
      "$.edge.id",
      "An edge with this stable ID already exists.",
    );
  }
  if (command.edge.semantic.lifecycle.ownership === "adopted") {
    fail(
      "invalid_new_resource_ownership",
      "$.edge.semantic.lifecycle.ownership",
      "New resources cannot begin with adopted ownership.",
    );
  }

  const edge = cloneJson(command.edge);
  const nextDocument = {
    ...document,
    edges: [...document.edges, edge],
  };
  let inverse: GraphCommandV1;

  if (edge.semantic.lifecycle.ownership === "generated") {
    const dependencies: GeneratedDependencyReferenceV1[] = [
      ...edge.semantic.lifecycle.provenance.dependentNodeIds.map((nodeId) => ({
        kind: "node" as const,
        nodeId,
      })),
      ...edge.semantic.lifecycle.provenance.dependentEdgeIds.map((edgeId) => ({
        kind: "edge" as const,
        edgeId,
      })),
    ];
    inverse = {
      schemaVersion: 1,
      commandId: command.inverseCommandId,
      inverseCommandId: command.commandId,
      origin: command.origin,
      target: command.target,
      kind: "release-generated-resource",
      resource: { kind: "edge", edgeId: edge.id },
      expectedLifecycle: cloneJson(edge.semantic.lifecycle),
      dependencies,
      requiredDisposition: "removed",
    };
  } else {
    inverse = {
      schemaVersion: 1,
      commandId: command.inverseCommandId,
      inverseCommandId: command.commandId,
      origin: command.origin,
      target: command.target,
      kind: "remove-edge",
      edgeId: edge.id,
      expectedEdge: cloneJson(edge),
    };
  }

  return {
    document: nextDocument,
    changes: [
      {
        kind: "edge-added",
        commandId: command.commandId,
        edgeId: edge.id,
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applyRemoveEdge(
  document: ArchitectureDocument,
  command: RemoveEdgeCommandV1,
): ActionApplicationResult {
  const { edge, index } = findEdge(document, command.edgeId, "$.edgeId");
  if (!equalJson(edge, command.expectedEdge)) {
    fail(
      "precondition_failed",
      "$.expectedEdge",
      "Edge no longer matches the expected snapshot.",
    );
  }
  if (edge.semantic.lifecycle.ownership === "generated") {
    fail(
      "generated_resource_requires_release",
      "$.edgeId",
      "Generated edges must be removed through the release command.",
    );
  }
  assertNoDependents(
    document,
    { kind: "edge", edgeId: edge.id },
    edge.semantic.lifecycle,
    "$.edgeId",
  );

  const nextDocument = {
    ...document,
    edges: document.edges.filter((_, edgeIndex) => edgeIndex !== index),
  };
  const inverse: AddEdgeCommandV1 = {
    schemaVersion: 1,
    commandId: command.inverseCommandId,
    inverseCommandId: command.commandId,
    origin: command.origin,
    target: command.target,
    kind: "add-edge",
    edge: cloneJson(edge),
  };

  return {
    document: nextDocument,
    changes: [
      {
        kind: "edge-removed",
        commandId: command.commandId,
        edgeId: edge.id,
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applyUpdateEdgeConfiguration(
  document: ArchitectureDocument,
  command: UpdateEdgeConfigurationCommandV1,
): ActionApplicationResult {
  const { edge, index } = findEdge(document, command.edgeId, "$.edgeId");
  if (!equalJson(edge.semantic.configuration, command.expectedConfiguration)) {
    fail(
      "precondition_failed",
      "$.expectedConfiguration",
      "Edge configuration no longer matches the expected value.",
    );
  }
  if (edge.semantic.lifecycle.ownership === "generated") {
    fail(
      "generated_resource_requires_adoption",
      "$.edgeId",
      "Generated edges must be adopted before semantic customization.",
    );
  }

  const configuration = cloneJson(command.configuration);
  const nextEdge = {
    ...edge,
    semantic: {
      ...edge.semantic,
      configuration,
    },
  };
  const nextEdges = [...document.edges];
  nextEdges[index] = nextEdge;
  const inverse: UpdateEdgeConfigurationCommandV1 = {
    ...command,
    commandId: command.inverseCommandId,
    inverseCommandId: command.commandId,
    expectedConfiguration: cloneJson(configuration),
    configuration: cloneJson(edge.semantic.configuration),
  };

  return {
    document: { ...document, edges: nextEdges },
    changes: [
      {
        kind: "edge-configuration-updated",
        commandId: command.commandId,
        edgeId: edge.id,
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applicationContractRevisionMatchesDocument(
  revision: ArchitectureDocument["applicationContracts"]["revision"],
  documentRevision: ArchitectureDocument["revision"],
): boolean {
  return (
    revision.revisionId === documentRevision.revisionId &&
    revision.revisionNumber === documentRevision.revisionNumber &&
    revision.createdAt === documentRevision.createdAt &&
    revision.createdBy === documentRevision.createdBy &&
    revision.previousRevisionId === documentRevision.previousRevisionId
  );
}

function applyReplaceCatalogBinding(
  document: ArchitectureDocument,
  command: ReplaceCatalogBindingCommandV1,
): ActionApplicationResult {
  if (!equalJson(document.catalog, command.expectedCatalog)) {
    fail(
      "precondition_failed",
      "$.expectedCatalog",
      "The provider catalog no longer matches the reviewed binding.",
    );
  }
  if (command.catalog.id !== document.catalog.id) {
    fail(
      "precondition_failed",
      "$.catalog.id",
      "A catalog upgrade must retain the provider catalog identity.",
    );
  }
  const catalog = cloneJson(command.catalog);
  return {
    document: { ...document, catalog },
    changes: [
      {
        kind: "catalog-binding-replaced",
        commandId: command.commandId,
        previousCatalog: cloneJson(document.catalog),
        catalog,
      },
    ],
    inversion: {
      kind: "available",
      command: {
        ...command,
        commandId: command.inverseCommandId,
        inverseCommandId: command.commandId,
        expectedCatalog: catalog,
        catalog: cloneJson(document.catalog),
      },
    },
  };
}

function applyReplaceWorkloadAndApplicationContracts(
  document: ArchitectureDocument,
  command: ReplaceWorkloadAndApplicationContractsCommandV1,
): ActionApplicationResult {
  if (!equalJson(document.workloadBehavior, command.expectedWorkloadBehavior)) {
    fail(
      "precondition_failed",
      "$.expectedWorkloadBehavior",
      "Workload Behavior no longer matches the expected snapshot.",
    );
  }
  if (
    !equalJson(
      document.applicationContracts,
      command.expectedApplicationContracts,
    )
  ) {
    fail(
      "precondition_failed",
      "$.expectedApplicationContracts",
      "Application Contracts no longer match the expected snapshot.",
    );
  }
  if (command.applicationContracts.documentId !== document.documentId) {
    fail(
      "precondition_failed",
      "$.applicationContracts.documentId",
      "Application Contracts must retain the containing document identity.",
    );
  }
  if (
    !applicationContractRevisionMatchesDocument(
      command.applicationContracts.revision,
      document.revision,
    )
  ) {
    fail(
      "precondition_failed",
      "$.applicationContracts.revision",
      "Application Contracts must retain the containing revision identity.",
    );
  }
  if (
    command.applicationContracts.contractSetId !==
    document.applicationContracts.contractSetId
  ) {
    fail(
      "precondition_failed",
      "$.applicationContracts.contractSetId",
      "Application Contract set identity cannot change through a behavior replacement.",
    );
  }

  const workloadBehavior = cloneJson(command.workloadBehavior);
  const applicationContracts = cloneJson(command.applicationContracts);
  const inverse: ReplaceWorkloadAndApplicationContractsCommandV1 = {
    ...command,
    commandId: command.inverseCommandId,
    inverseCommandId: command.commandId,
    expectedWorkloadBehavior: cloneJson(workloadBehavior),
    workloadBehavior: cloneJson(document.workloadBehavior),
    expectedApplicationContracts: cloneJson(applicationContracts),
    applicationContracts: cloneJson(document.applicationContracts),
  };

  return {
    document: {
      ...document,
      workloadBehavior,
      applicationContracts,
    },
    changes: [
      {
        kind: "workload-and-application-contracts-replaced",
        commandId: command.commandId,
        previousWorkloadCount: document.workloadBehavior.workloads.length,
        workloadCount: workloadBehavior.workloads.length,
        previousApplicationContractCount:
          document.applicationContracts.contracts.length,
        applicationContractCount: applicationContracts.contracts.length,
      },
    ],
    inversion: { kind: "available", command: inverse },
  };
}

function applyAdoptGeneratedResource(
  document: ArchitectureDocument,
  command: AdoptGeneratedResourceCommandV1,
): ActionApplicationResult {
  const lifecycle = lifecycleOf(document, command.resource);
  if (lifecycle.ownership !== "generated") {
    fail(
      "resource_not_generated",
      "$.resource",
      "Only an unadopted generated resource can be adopted.",
    );
  }
  if (!equalJson(lifecycle, command.expectedLifecycle)) {
    fail(
      "precondition_failed",
      "$.expectedLifecycle",
      "Generated lifecycle no longer matches the expected value.",
    );
  }

  const adoptedLifecycle = {
    ownership: "adopted" as const,
    origin: lifecycle.origin,
    provenance: cloneJson(lifecycle.provenance),
    adoptedBy: command.adoptedBy,
    adoptedAt: command.adoptedAt,
  };
  let nextDocument: ArchitectureDocument;

  if (command.resource.kind === "node") {
    const { node, index } = findNode(
      document,
      command.resource.nodeId,
      "$.resource.nodeId",
    );
    const nodes = [...document.nodes];
    nodes[index] = {
      ...node,
      semantic: {
        ...node.semantic,
        lifecycle: adoptedLifecycle,
      },
    };
    nextDocument = { ...document, nodes };
  } else {
    const { edge, index } = findEdge(
      document,
      command.resource.edgeId,
      "$.resource.edgeId",
    );
    const edges = [...document.edges];
    edges[index] = {
      ...edge,
      semantic: {
        ...edge.semantic,
        lifecycle: adoptedLifecycle,
      },
    };
    nextDocument = { ...document, edges };
  }

  return {
    document: nextDocument,
    changes: [
      {
        kind: "generated-resource-adopted",
        commandId: command.commandId,
        resource: cloneJson(command.resource),
      },
    ],
    inversion: unavailable(
      "adoption_requires_explicit_policy",
      "Adoption adds ownership metadata and may permit later customization; it is not automatically reversible.",
    ),
  };
}

function applyReleaseGeneratedResource(
  document: ArchitectureDocument,
  command: ReleaseGeneratedResourceCommandV1,
): ActionApplicationResult {
  const lifecycle = lifecycleOf(document, command.resource);
  if (lifecycle.ownership !== "generated") {
    fail(
      "resource_not_generated",
      "$.resource",
      "Only an unadopted generated resource can be released.",
    );
  }
  if (!equalJson(lifecycle, command.expectedLifecycle)) {
    fail(
      "precondition_failed",
      "$.expectedLifecycle",
      "Generated lifecycle no longer matches the expected value.",
    );
  }
  assertUniqueReleaseDependencies(command.dependencies);

  const releasedLifecycle = command.dependencies.reduce(
    (current, dependency) => removeDependency(current, dependency),
    cloneJson(lifecycle),
  );
  const provenanceReferenceCount =
    releasedLifecycle.provenance.dependentNodeIds.length +
    releasedLifecycle.provenance.dependentEdgeIds.length;
  const graphReferenceCount = countGraphReferences(document, command.resource);
  const remove = provenanceReferenceCount === 0 && graphReferenceCount === 0;
  const disposition = remove ? "removed" : "retained";
  if (disposition !== command.requiredDisposition) {
    fail(
      "precondition_failed",
      "$.requiredDisposition",
      "Generated resource release disposition no longer matches the required value.",
    );
  }
  let nextDocument: ArchitectureDocument;
  let inverse: GraphCommandInversion;

  if (command.resource.kind === "node") {
    const { node, index } = findNode(
      document,
      command.resource.nodeId,
      "$.resource.nodeId",
    );
    const nodes = [...document.nodes];
    if (remove) {
      nodes.splice(index, 1);
      const inverseCommand: AddNodeCommandV1 = {
        schemaVersion: 1,
        commandId: command.inverseCommandId,
        inverseCommandId: command.commandId,
        origin: command.origin,
        target: command.target,
        kind: "add-node",
        node: cloneJson(node),
      };
      inverse = { kind: "available", command: inverseCommand };
    } else {
      nodes[index] = {
        ...node,
        semantic: {
          ...node.semantic,
          lifecycle: releasedLifecycle,
        },
      };
      inverse = unavailable(
        command.dependencies.length > 0
          ? "generated_provenance_changed"
          : "generated_resource_retained",
        command.dependencies.length > 0
          ? "Release changed generated provenance while the resource remained referenced."
          : "Release retained the generated resource because live references remain.",
      );
    }
    nextDocument = { ...document, nodes };
  } else {
    const { edge, index } = findEdge(
      document,
      command.resource.edgeId,
      "$.resource.edgeId",
    );
    const edges = [...document.edges];
    if (remove) {
      edges.splice(index, 1);
      const inverseCommand: AddEdgeCommandV1 = {
        schemaVersion: 1,
        commandId: command.inverseCommandId,
        inverseCommandId: command.commandId,
        origin: command.origin,
        target: command.target,
        kind: "add-edge",
        edge: cloneJson(edge),
      };
      inverse = { kind: "available", command: inverseCommand };
    } else {
      edges[index] = {
        ...edge,
        semantic: {
          ...edge.semantic,
          lifecycle: releasedLifecycle,
        },
      };
      inverse = unavailable(
        command.dependencies.length > 0
          ? "generated_provenance_changed"
          : "generated_resource_retained",
        command.dependencies.length > 0
          ? "Release changed generated provenance while the resource remained referenced."
          : "Release retained the generated resource because live references remain.",
      );
    }
    nextDocument = { ...document, edges };
  }

  return {
    document: nextDocument,
    changes: [
      {
        kind: "generated-resource-released",
        commandId: command.commandId,
        resource: cloneJson(command.resource),
        disposition,
        provenanceReferenceCount,
        graphReferenceCount,
      },
    ],
    inversion: inverse,
  };
}

function applyAction(
  document: ArchitectureDocument,
  command: GraphCommandActionV1,
): ActionApplicationResult {
  assertCommandIdentity(command);
  assertDocumentTarget(document, command);

  switch (command.kind) {
    case "add-node":
      return applyAddNode(document, command);
    case "remove-node":
      return applyRemoveNode(document, command);
    case "update-node-configuration":
      return applyUpdateNodeConfiguration(document, command);
    case "move-node":
      return applyMoveNode(document, command);
    case "reparent-node":
      return applyReparentNode(document, command);
    case "add-edge":
      return applyAddEdge(document, command);
    case "remove-edge":
      return applyRemoveEdge(document, command);
    case "update-edge-configuration":
      return applyUpdateEdgeConfiguration(document, command);
    case "replace-catalog-binding":
      return applyReplaceCatalogBinding(document, command);
    case "replace-workload-and-application-contracts":
      return applyReplaceWorkloadAndApplicationContracts(document, command);
    case "adopt-generated-resource":
      return applyAdoptGeneratedResource(document, command);
    case "release-generated-resource":
      return applyReleaseGeneratedResource(document, command);
  }
}

function validateBatchIdentities(command: GraphCommandBatchV1): void {
  const identities = [
    command.commandId,
    command.inverseCommandId,
    ...command.commands.flatMap((nested) => [
      nested.commandId,
      nested.inverseCommandId,
    ]),
  ];
  const firstIndexByIdentity = new Map<string, number>();

  identities.forEach((identity, index) => {
    const firstIndex = firstIndexByIdentity.get(identity);
    if (firstIndex !== undefined) {
      fail(
        "duplicate_batch_command_identity",
        "$.commands",
        "Batch command and inverse identities must be unique.",
      );
    }
    firstIndexByIdentity.set(identity, index);
  });
}

function prefixBatchIssues(
  issues: readonly GraphCommandApplicationIssue[],
  index: number,
): readonly GraphCommandApplicationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: `$.commands[${String(index)}]${
      issue.path === "$" ? "" : issue.path.slice(1)
    }`,
  }));
}

function semanticIssues(
  issues: readonly ArchitectureDocumentSemanticIssue[],
): readonly GraphCommandApplicationIssue[] {
  return issues.map((issue) => ({
    code: "semantic_invariant_violation",
    message: issue.message,
    path: `$.document${issue.path.slice(1)}`,
    semanticCode: issue.code,
  }));
}

function applyBatch(
  document: ArchitectureDocument,
  command: GraphCommandBatchV1,
): GraphCommandApplicationResult {
  validateBatchIdentities(command);
  let nextDocument = document;
  const changes: GraphChangeSummary[] = [];
  const inversions: GraphCommandInversion[] = [];

  command.commands.forEach((nested, index) => {
    try {
      const result = applyAction(nextDocument, nested);
      nextDocument = result.document;
      changes.push(...result.changes);
      inversions.push(result.inversion);
    } catch (error) {
      if (error instanceof GraphCommandApplicationError) {
        throw new GraphCommandApplicationError(
          prefixBatchIssues(error.issues, index),
        );
      }
      throw error;
    }
  });

  const finalIssues = validateArchitectureDocumentSemantics(nextDocument);
  if (finalIssues.length > 0) {
    throw new GraphCommandApplicationError(semanticIssues(finalIssues));
  }

  changes.push({
    kind: "batch-applied",
    commandId: command.commandId,
    commandCount: command.commands.length,
  });
  const firstUnavailableIndex = inversions.findIndex(
    (inversion) => inversion.kind === "unavailable",
  );
  if (firstUnavailableIndex !== -1) {
    return {
      document: nextDocument,
      changes,
      inversion: unavailable(
        "batch_contains_non_invertible_command",
        `Batch command at index ${String(firstUnavailableIndex)} is not safely invertible.`,
      ),
    };
  }

  const inverseCommands = [...inversions].reverse().map((inversion) => {
    if (inversion.kind !== "available" || inversion.command.kind === "batch") {
      throw new Error("Expected an available non-batch inverse command.");
    }
    return inversion.command;
  });
  const inverse: GraphCommandBatchV1 = {
    schemaVersion: 1,
    commandId: command.inverseCommandId,
    inverseCommandId: command.commandId,
    origin: command.origin,
    target: command.target,
    kind: "batch",
    commands: inverseCommands,
  };

  return {
    document: nextDocument,
    changes,
    inversion: { kind: "available", command: inverse },
  };
}

export function applyGraphCommand(
  document: VersionedArchitectureDocument,
  input: unknown,
): GraphCommandApplicationResult {
  const validatedDocument = parseArchitectureDocument(document);
  const command = parseGraphCommandV1(input);
  assertCommandIdentity(command);
  assertDocumentTarget(validatedDocument, command);

  if (command.kind === "batch") {
    return applyBatch(validatedDocument, command);
  }

  const result = applyAction(validatedDocument, command);
  const finalIssues = validateArchitectureDocumentSemantics(result.document);
  if (finalIssues.length > 0) {
    throw new GraphCommandApplicationError(semanticIssues(finalIssues));
  }

  return result;
}
