import {
  applyGraphCommand,
  type ArchitectureDocument,
  type GraphChangeSummary,
} from "@cloudmarkup/domain";
import type {
  ProviderConnectionCompatibilityCandidateV1,
  ProviderConnectionCompatibilityRequestV1,
  ProviderConnectionResolutionFindingV1,
  ProviderConnectionResolutionResultV1,
  ProviderConnectionRuleDescriptorV1,
} from "@cloudmarkup/provider-sdk";
import {
  serializeCanonicalJson,
  type ConfigurationValue,
  type GraphCommandActionV1,
  type GraphResourceReferenceV1,
} from "@cloudmarkup/schemas";

import {
  hasExactEditorCatalogBinding,
  resolveExactEditorCatalogService,
} from "./catalog-selection.js";
import type {
  EditorCatalog,
  EditorConnectionCategory,
  EditorCatalogEducation,
  EditorCatalogRegionAvailability,
  EditorCatalogRelationship,
} from "./editor-catalog.js";

export interface EditorConnectionEndpoint {
  readonly capability: string;
  readonly cardinality: "one" | "many";
  readonly category: EditorConnectionCategory;
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly portId: string;
  readonly portLabel: string;
  readonly serviceName: string;
  readonly serviceType: string;
}

export interface EditorConnectionCardinalityUtilization {
  readonly used: number;
  readonly maximum: number | null;
}

export interface EditorConnectionCandidateCardinality {
  readonly endpointPair: EditorConnectionCardinalityUtilization;
  readonly sourcePort: EditorConnectionCardinalityUtilization;
  readonly sourceRule: EditorConnectionCardinalityUtilization;
  readonly targetPort: EditorConnectionCardinalityUtilization;
  readonly targetRule: EditorConnectionCardinalityUtilization;
}

export interface EditorConnectionFinding {
  readonly code: string;
  readonly guidedMessage: string;
  readonly path: string;
  readonly professionalMessage: string;
  readonly severity: "error" | "warning";
}

export interface EditorConnectionCandidate {
  readonly cardinality: EditorConnectionCandidateCardinality;
  readonly findings: readonly EditorConnectionFinding[];
  readonly key: string;
  readonly relationship: EditorCatalogRelationship;
  readonly source: EditorConnectionEndpoint;
  readonly target: EditorConnectionEndpoint;
}

export type EditorConnectionStartIntent =
  | {
      readonly kind: "node-pair";
      readonly sourceNodeId: string;
      readonly targetNodeId: string;
    }
  | {
      readonly kind: "edge";
      readonly edgeId: string;
    }
  | {
      readonly kind: "edge-retarget";
      readonly edgeId: string;
      readonly retainedEndpoint: "source" | "target";
    }
  | {
      readonly kind: "endpoints";
      readonly source: {
        readonly nodeId: string;
        readonly portId: string;
      };
      readonly target: {
        readonly nodeId: string;
        readonly portId: string;
      };
    }
  | {
      readonly kind: "node";
      readonly nodeId: string;
    }
  | {
      readonly kind: "port";
      readonly direction: "input" | "output";
      readonly nodeId: string;
      readonly portId: string;
    };

export interface EditorConnectionCommandSummary {
  readonly commandId: string;
  readonly kind: string;
  readonly targetResourceIds: readonly string[];
}

export type EditorConnectionResourceLifecycle =
  | {
      readonly ownership: "adopted";
    }
  | {
      readonly dependentEdgeIds: readonly string[];
      readonly dependentNodeIds: readonly string[];
      readonly generatorId: string;
      readonly generatorVersion: string;
      readonly operationId: string;
      readonly ownership: "generated";
    }
  | {
      readonly ownership: "user";
    };

export type EditorGeneratedConnectionResource =
  | {
      readonly configuration: ArchitectureDocument["edges"][number]["semantic"]["configuration"];
      readonly id: string;
      readonly kind: "edge";
      readonly label: string;
      readonly lifecycle: EditorConnectionResourceLifecycle;
      readonly relationshipType: string;
      readonly source: {
        readonly nodeId: string;
        readonly portId: string;
      };
      readonly target: {
        readonly nodeId: string;
        readonly portId: string;
      };
    }
  | {
      readonly configuration: ArchitectureDocument["nodes"][number]["semantic"]["configuration"];
      readonly id: string;
      readonly kind: "node";
      readonly label: string;
      readonly lifecycle: EditorConnectionResourceLifecycle;
      readonly resourceType: string;
      readonly serviceType: string;
    };

export interface EditorConnectionPreview {
  readonly batchCommandId: string;
  readonly changes: readonly GraphChangeSummary[];
  readonly commands: readonly EditorConnectionCommandSummary[];
  readonly configuration: Readonly<
    Record<string, Readonly<ConfigurationValue>>
  >;
  readonly findings: readonly EditorConnectionFinding[];
  readonly generatedResources: readonly EditorGeneratedConnectionResource[];
  readonly iamEffects: EditorCatalogRelationship["iamEffects"];
  readonly iamRequirements: readonly EditorConnectionIamRequirement[];
  readonly relationship: EditorCatalogRelationship;
  readonly revisionId: string;
  readonly sourceAvailability: EditorCatalogRegionAvailability;
  readonly targetAvailability: EditorCatalogRegionAvailability;
}

export interface EditorConnectionIamRequirement {
  readonly actions: readonly string[];
  readonly effect: "allow" | "trust";
  readonly effectId: string;
  readonly principal?: string;
  readonly qualifier: {
    readonly configurationSchemaId: string;
    readonly configurationSchemaVersion: string;
    readonly edgeId: string;
  };
  readonly readiness: "preview-only";
  readonly resource:
    | {
        readonly nodeId: string;
        readonly scope: "source-node" | "target-node" | "connected-target";
      }
    | {
        readonly scope: "supporting-node";
      };
  readonly ruleId: string;
  readonly sourceEdgeId: string;
}

export interface EditorConnectionWorkflow {
  readonly candidates: readonly EditorConnectionCandidate[];
  readonly configuration: Readonly<
    Record<string, Readonly<ConfigurationValue>>
  >;
  readonly editingEdgeId: string | null;
  readonly education: EditorCatalogEducation | null;
  readonly findings: readonly EditorConnectionFinding[];
  readonly open: boolean;
  readonly preview: EditorConnectionPreview | null;
  readonly selectedCandidateKey: string | null;
}

export const CLOSED_CONNECTION_WORKFLOW: EditorConnectionWorkflow =
  Object.freeze({
    candidates: Object.freeze([]),
    configuration: Object.freeze({}),
    editingEdgeId: null,
    education: null,
    findings: Object.freeze([]),
    open: false,
    preview: null,
    selectedCandidateKey: null,
  });

export function connectionConfigurationValueText(
  value: Readonly<ConfigurationValue>,
): string {
  if ("value" in value) {
    return Array.isArray(value.value)
      ? value.value.join(", ")
      : String(value.value);
  }
  if (value.kind === "node-reference") {
    return `${value.nodeId} · ${value.attribute}`;
  }
  if (value.kind === "variable-reference") {
    return "Sensitive variable reference configured (identifier and value not shown)";
  }
  return "Secret reference configured (identifier and value not shown)";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectFinding(
  item: ProviderConnectionResolutionFindingV1,
): EditorConnectionFinding {
  return {
    code: item.code,
    guidedMessage: item.guidedMessage,
    path: item.path,
    professionalMessage: item.professionalMessage,
    severity: item.severity,
  };
}

export function projectConnectionFindings(
  findings: readonly ProviderConnectionResolutionFindingV1[],
): readonly EditorConnectionFinding[] {
  return findings.map(projectFinding);
}

function relationshipMatchesRule(
  relationship: EditorCatalogRelationship,
  rule: ProviderConnectionRuleDescriptorV1,
): boolean {
  const implementationMatches =
    relationship.implementation.status === rule.implementation.status &&
    (relationship.implementation.status !== "implemented" ||
      (rule.implementation.status === "implemented" &&
        relationship.implementation.implementationId ===
          rule.implementation.implementationId &&
        relationship.implementation.interfaceVersion ===
          rule.implementation.interfaceVersion));
  return (
    relationship.descriptorId === rule.id &&
    relationship.id === rule.relationshipType &&
    relationship.ruleVersion === rule.ruleVersion &&
    relationship.category === rule.category &&
    relationship.sourceServiceType === rule.source.serviceId &&
    relationship.sourcePortId === rule.source.portId &&
    relationship.targetServiceType === rule.target.serviceId &&
    relationship.targetPortId === rule.target.portId &&
    relationship.maximumConnectionsPerSource ===
      rule.maximumConnectionsPerSource &&
    relationship.maximumConnectionsPerTarget ===
      rule.maximumConnectionsPerTarget &&
    relationship.maximumConnectionsPerEndpointPair ===
      rule.maximumConnectionsPerEndpointPair &&
    relationship.configuration.schemaId === rule.configuration.schemaId &&
    relationship.configuration.schemaVersion ===
      rule.configuration.schemaVersion &&
    implementationMatches
  );
}

function exactRelationshipForRule(
  catalog: EditorCatalog,
  rule: ProviderConnectionRuleDescriptorV1,
): EditorCatalogRelationship | undefined {
  const matches =
    catalog.relationships?.filter((relationship) =>
      relationshipMatchesRule(relationship, rule),
    ) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

function endpoint(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  nodeId: string,
  portId: string,
  expectedServiceType: string,
  expectedDirection: "input" | "output",
): EditorConnectionEndpoint | undefined {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    return undefined;
  }
  const service = resolveExactEditorCatalogService(document, node, catalog);
  if (service?.serviceType !== expectedServiceType) {
    return undefined;
  }
  const ports = service.ports.filter(
    (candidate) =>
      candidate.id === portId && candidate.direction === expectedDirection,
  );
  const port = ports[0];
  if (ports.length !== 1 || port === undefined) {
    return undefined;
  }
  return {
    capability: port.capability,
    cardinality: port.cardinality,
    category: port.category,
    nodeId,
    nodeLabel: document.nodes.some(
      (other) =>
        other.id !== node.id &&
        other.presentation.label === node.presentation.label,
    )
      ? `${node.presentation.label} (${node.semantic.deploymentKey})`
      : node.presentation.label,
    portId,
    portLabel: port.displayName,
    serviceName: service.displayName,
    serviceType: service.serviceType,
  };
}

function candidateCardinality(
  document: ArchitectureDocument,
  relationship: EditorCatalogRelationship,
  source: EditorConnectionEndpoint,
  target: EditorConnectionEndpoint,
  excludingConnectionEdgeId: string | null,
): EditorConnectionCandidateCardinality {
  const cardinalityEdges = document.edges.filter(
    (edge) => edge.id !== excludingConnectionEdgeId,
  );
  const matchingRuleEdges = cardinalityEdges.filter((edge) => {
    const edgeSource = document.nodes.find(
      (node) => node.id === edge.semantic.source.nodeId,
    );
    const edgeTarget = document.nodes.find(
      (node) => node.id === edge.semantic.target.nodeId,
    );
    return (
      edgeSource?.semantic.serviceType === relationship.sourceServiceType &&
      edgeTarget?.semantic.serviceType === relationship.targetServiceType &&
      edge.semantic.relationshipType === relationship.id &&
      edge.semantic.source.port === relationship.sourcePortId &&
      edge.semantic.target.port === relationship.targetPortId
    );
  });
  return {
    endpointPair: {
      used: matchingRuleEdges.filter(
        (edge) =>
          edge.semantic.source.nodeId === source.nodeId &&
          edge.semantic.target.nodeId === target.nodeId,
      ).length,
      maximum: relationship.maximumConnectionsPerEndpointPair,
    },
    sourcePort: {
      used: cardinalityEdges.filter(
        (edge) =>
          edge.semantic.source.nodeId === source.nodeId &&
          edge.semantic.source.port === source.portId,
      ).length,
      maximum: source.cardinality === "one" ? 1 : null,
    },
    sourceRule: {
      used: matchingRuleEdges.filter(
        (edge) => edge.semantic.source.nodeId === source.nodeId,
      ).length,
      maximum: relationship.maximumConnectionsPerSource,
    },
    targetPort: {
      used: cardinalityEdges.filter(
        (edge) =>
          edge.semantic.target.nodeId === target.nodeId &&
          edge.semantic.target.port === target.portId,
      ).length,
      maximum: target.cardinality === "one" ? 1 : null,
    },
    targetRule: {
      used: matchingRuleEdges.filter(
        (edge) => edge.semantic.target.nodeId === target.nodeId,
      ).length,
      maximum: relationship.maximumConnectionsPerTarget,
    },
  };
}

export function connectionCandidateKey(
  ruleId: string,
  source: { readonly nodeId: string; readonly portId: string },
  target: { readonly nodeId: string; readonly portId: string },
): string {
  return [
    ruleId,
    source.nodeId,
    source.portId,
    target.nodeId,
    target.portId,
  ].join("|");
}

export function projectConnectionCandidates(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  candidates: readonly ProviderConnectionCompatibilityCandidateV1[],
  excludingConnectionEdgeId: string | null = null,
): readonly EditorConnectionCandidate[] {
  if (!hasExactEditorCatalogBinding(document, catalog)) {
    return [];
  }
  return candidates
    .flatMap((candidate): readonly EditorConnectionCandidate[] => {
      const relationship = exactRelationshipForRule(catalog, candidate.rule);
      const source = endpoint(
        document,
        catalog,
        candidate.source.nodeId,
        candidate.source.portId,
        candidate.rule.source.serviceId,
        "output",
      );
      const target = endpoint(
        document,
        catalog,
        candidate.target.nodeId,
        candidate.target.portId,
        candidate.rule.target.serviceId,
        "input",
      );
      if (
        relationship === undefined ||
        source === undefined ||
        target === undefined ||
        source.nodeId === target.nodeId ||
        candidate.source.portId !== candidate.rule.source.portId ||
        candidate.target.portId !== candidate.rule.target.portId
      ) {
        return [];
      }
      return [
        {
          cardinality: candidateCardinality(
            document,
            relationship,
            source,
            target,
            excludingConnectionEdgeId,
          ),
          findings: projectConnectionFindings(candidate.findings),
          key: connectionCandidateKey(
            relationship.descriptorId,
            candidate.source,
            candidate.target,
          ),
          relationship,
          source,
          target,
        },
      ];
    })
    .sort(
      (left, right) =>
        compareText(
          left.relationship.descriptorId,
          right.relationship.descriptorId,
        ) ||
        compareText(left.source.nodeId, right.source.nodeId) ||
        compareText(left.source.portId, right.source.portId) ||
        compareText(left.target.nodeId, right.target.nodeId) ||
        compareText(left.target.portId, right.target.portId),
    );
}

function educationForIntent(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  intent: EditorConnectionStartIntent,
): EditorCatalogEducation | null {
  const edge =
    intent.kind === "edge" || intent.kind === "edge-retarget"
      ? document.edges.find((candidate) => candidate.id === intent.edgeId)
      : undefined;
  const nodeId =
    intent.kind === "edge-retarget" && intent.retainedEndpoint === "target"
      ? edge?.semantic.target.nodeId
      : intent.kind === "edge" || intent.kind === "edge-retarget"
        ? edge?.semantic.source.nodeId
        : intent.kind === "endpoints"
          ? intent.source.nodeId
          : intent.kind === "node-pair"
            ? intent.sourceNodeId
            : intent.nodeId;
  if (!hasExactEditorCatalogBinding(document, catalog)) {
    return null;
  }
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  return node === undefined
    ? null
    : (resolveExactEditorCatalogService(document, node, catalog)?.education ??
        null);
}

export type PreparedConnectionCompatibilityRequest =
  | {
      readonly editingEdgeId: null;
      readonly preferredRuleId: null;
      readonly requiredRuleId: null;
      readonly request: ProviderConnectionCompatibilityRequestV1;
    }
  | {
      readonly editingEdgeId: string;
      readonly preferredRuleId: string;
      readonly requiredRuleId: string | null;
      readonly request: ProviderConnectionCompatibilityRequestV1;
    };

export function prepareConnectionCompatibilityRequest(
  document: ArchitectureDocument,
  intent: EditorConnectionStartIntent,
): PreparedConnectionCompatibilityRequest | undefined {
  if (intent.kind === "node-pair") {
    return {
      editingEdgeId: null,
      preferredRuleId: null,
      requiredRuleId: null,
      request: {
        anchor: { nodeId: intent.sourceNodeId },
        anchorRole: "either",
        counterpart: { nodeId: intent.targetNodeId },
        document,
      },
    };
  }
  if (intent.kind === "endpoints") {
    return {
      editingEdgeId: null,
      preferredRuleId: null,
      requiredRuleId: null,
      request: {
        anchor: intent.source,
        anchorRole: "source",
        counterpart: intent.target,
        document,
      },
    };
  }
  if (intent.kind === "node") {
    return {
      editingEdgeId: null,
      preferredRuleId: null,
      requiredRuleId: null,
      request: {
        anchor: { nodeId: intent.nodeId },
        anchorRole: "either",
        document,
      },
    };
  }
  if (intent.kind === "port") {
    return {
      editingEdgeId: null,
      preferredRuleId: null,
      requiredRuleId: null,
      request: {
        anchor: { nodeId: intent.nodeId, portId: intent.portId },
        anchorRole: intent.direction === "output" ? "source" : "target",
        document,
      },
    };
  }

  const edge = document.edges.find(
    (candidate) => candidate.id === intent.edgeId,
  );
  const lifecycle = edge?.semantic.lifecycle;
  if (
    edge === undefined ||
    lifecycle?.ownership !== "generated" ||
    lifecycle.provenance.generatorKind !== "connection-rule"
  ) {
    return undefined;
  }
  const anchorEndpoint =
    intent.kind === "edge-retarget" && intent.retainedEndpoint === "target"
      ? edge.semantic.target
      : edge.semantic.source;
  return {
    editingEdgeId: edge.id,
    preferredRuleId: lifecycle.provenance.generatorId,
    requiredRuleId:
      intent.kind === "edge-retarget" ? lifecycle.provenance.generatorId : null,
    request: {
      anchor: {
        nodeId: anchorEndpoint.nodeId,
        portId: anchorEndpoint.port,
      },
      anchorRole:
        intent.kind === "edge-retarget" && intent.retainedEndpoint === "target"
          ? "target"
          : "source",
      ...(intent.kind === "edge"
        ? {
            counterpart: {
              nodeId: edge.semantic.target.nodeId,
              portId: edge.semantic.target.port,
            },
          }
        : {}),
      document,
      excludingConnectionEdgeId: edge.id,
    },
  };
}

export function connectionEducation(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  intent: EditorConnectionStartIntent,
): EditorCatalogEducation | null {
  return educationForIntent(document, catalog, intent);
}

export function initialConnectionConfiguration(
  candidate: EditorConnectionCandidate,
  document: ArchitectureDocument,
  editingEdgeId: string | null,
): Readonly<Record<string, Readonly<ConfigurationValue>>> {
  if (editingEdgeId !== null) {
    const edge = document.edges.find((item) => item.id === editingEdgeId);
    if (
      edge?.semantic.configuration.schemaId ===
        candidate.relationship.configuration.schemaId &&
      edge.semantic.configuration.schemaVersion ===
        candidate.relationship.configuration.schemaVersion
    ) {
      return {
        ...(edge.semantic.configuration.values as Readonly<
          Record<string, Readonly<ConfigurationValue>>
        >),
      };
    }
  }
  const fieldDefaults: Record<string, Readonly<ConfigurationValue>> = {};
  for (const field of candidate.relationship.configuration.fields) {
    if (field.valueSource !== "literal" || field.schema.default === undefined) {
      continue;
    }
    switch (field.schema.kind) {
      case "string":
      case "number":
      case "integer":
      case "boolean":
        fieldDefaults[field.property] = {
          kind: field.schema.kind,
          value: field.schema.default,
        } as Readonly<ConfigurationValue>;
        break;
      case "string-list":
        fieldDefaults[field.property] = {
          kind: "string-list",
          value: [...field.schema.default],
        };
        break;
      case "number-list":
      case "integer-list":
        fieldDefaults[field.property] = {
          kind: "number-list",
          value: [...field.schema.default],
        };
        break;
    }
  }
  return candidate.relationship.configuration.defaults.kind === "ready"
    ? {
        ...fieldDefaults,
        ...candidate.relationship.configuration.defaults.values,
      }
    : fieldDefaults;
}

function generatedResource(
  document: ArchitectureDocument,
  resource: GraphResourceReferenceV1,
): EditorGeneratedConnectionResource | undefined {
  function projectLifecycle(
    lifecycle: ArchitectureDocument["nodes"][number]["semantic"]["lifecycle"],
  ): EditorConnectionResourceLifecycle {
    if (lifecycle.ownership !== "generated") {
      return { ownership: lifecycle.ownership };
    }
    return {
      dependentEdgeIds: [...lifecycle.provenance.dependentEdgeIds],
      dependentNodeIds: [...lifecycle.provenance.dependentNodeIds],
      generatorId: lifecycle.provenance.generatorId,
      generatorVersion: lifecycle.provenance.generatorVersion,
      operationId: lifecycle.provenance.operationId,
      ownership: "generated",
    };
  }

  if (resource.kind === "node") {
    const node = document.nodes.find((item) => item.id === resource.nodeId);
    if (node === undefined) {
      return undefined;
    }
    return {
      configuration: node.semantic.configuration,
      id: resource.nodeId,
      kind: "node",
      label: node.presentation.label,
      lifecycle: projectLifecycle(node.semantic.lifecycle),
      resourceType: node.semantic.resourceType,
      serviceType: node.semantic.serviceType,
    };
  }

  const edge = document.edges.find((item) => item.id === resource.edgeId);
  if (edge === undefined) {
    return undefined;
  }
  return {
    configuration: edge.semantic.configuration,
    id: resource.edgeId,
    kind: "edge",
    label: edge.semantic.relationshipType,
    lifecycle: projectLifecycle(edge.semantic.lifecycle),
    relationshipType: edge.semantic.relationshipType,
    source: {
      nodeId: edge.semantic.source.nodeId,
      portId: edge.semantic.source.port,
    },
    target: {
      nodeId: edge.semantic.target.nodeId,
      portId: edge.semantic.target.port,
    },
  };
}

function commandTargetResourceIds(
  command: GraphCommandActionV1,
): readonly string[] {
  switch (command.kind) {
    case "add-node":
      return [command.node.id];
    case "remove-node":
    case "move-node":
    case "reparent-node":
    case "update-node-configuration":
      return [command.nodeId];
    case "add-edge":
      return [command.edge.id];
    case "remove-edge":
    case "update-edge-configuration":
      return [command.edgeId];
    case "adopt-generated-resource":
    case "release-generated-resource":
      return [
        command.resource.kind === "node"
          ? command.resource.nodeId
          : command.resource.edgeId,
      ];
    case "replace-catalog-binding":
    case "replace-workload-and-application-contracts":
      return [];
  }
}

export function projectConnectionPreview(
  catalog: EditorCatalog,
  candidate: EditorConnectionCandidate,
  result: Extract<ProviderConnectionResolutionResultV1, { success: true }>,
  baseDocument: ArchitectureDocument,
): EditorConnectionPreview {
  let replay: ReturnType<typeof applyGraphCommand>;
  try {
    replay = applyGraphCommand(baseDocument, result.batch);
  } catch {
    throw new TypeError(
      "The resolver batch cannot be replayed against the current architecture.",
    );
  }
  if (
    serializeCanonicalJson(replay.document) !==
      serializeCanonicalJson(result.preview.document) ||
    serializeCanonicalJson(replay.changes) !==
      serializeCanonicalJson(result.preview.changes)
  ) {
    throw new TypeError(
      "The resolver batch does not match its deterministic connection preview.",
    );
  }

  const document = replay.document;
  if (
    !hasExactEditorCatalogBinding(baseDocument, catalog) ||
    !hasExactEditorCatalogBinding(document, catalog)
  ) {
    throw new TypeError(
      "Connection preview projection requires the document's exact editor catalog.",
    );
  }
  if (result.findings.some((finding) => finding.severity === "error")) {
    throw new TypeError(
      "A connection preview containing error findings is not confirmable.",
    );
  }

  const relationship = exactRelationshipForRule(catalog, result.rule);
  if (
    relationship === undefined ||
    !relationshipMatchesRule(candidate.relationship, result.rule) ||
    candidate.source.serviceType !== result.rule.source.serviceId ||
    candidate.source.portId !== result.rule.source.portId ||
    candidate.target.serviceType !== result.rule.target.serviceId ||
    candidate.target.portId !== result.rule.target.portId
  ) {
    throw new TypeError(
      "The resolver preview does not match the selected exact catalog relationship.",
    );
  }

  const sourceNode = document.nodes.find(
    (node) => node.id === candidate.source.nodeId,
  );
  const targetNode = document.nodes.find(
    (node) => node.id === candidate.target.nodeId,
  );
  const sourceService =
    sourceNode === undefined
      ? undefined
      : resolveExactEditorCatalogService(document, sourceNode, catalog);
  const targetService =
    targetNode === undefined
      ? undefined
      : resolveExactEditorCatalogService(document, targetNode, catalog);
  if (
    sourceService?.serviceType !== result.rule.source.serviceId ||
    !sourceService.ports.some(
      (port) =>
        port.id === result.rule.source.portId && port.direction === "output",
    ) ||
    targetService?.serviceType !== result.rule.target.serviceId ||
    !targetService.ports.some(
      (port) =>
        port.id === result.rule.target.portId && port.direction === "input",
    )
  ) {
    throw new TypeError(
      "The resolver preview endpoints are absent from the exact editor catalog.",
    );
  }

  const generatedResourceKeys = new Set<string>();
  const generatedOperationIds = new Set<string>();
  const generatedResources = result.generatedResources.map((resource) => {
    const key =
      resource.kind === "node"
        ? `node:${resource.nodeId}`
        : `edge:${resource.edgeId}`;
    const lifecycle =
      resource.kind === "node"
        ? document.nodes.find((item) => item.id === resource.nodeId)?.semantic
            .lifecycle
        : document.edges.find((item) => item.id === resource.edgeId)?.semantic
            .lifecycle;
    const projected = generatedResource(document, resource);
    if (
      generatedResourceKeys.has(key) ||
      projected === undefined ||
      lifecycle?.ownership !== "generated" ||
      lifecycle.provenance.generatorKind !== "connection-rule" ||
      projected.lifecycle.ownership !== "generated" ||
      projected.lifecycle.generatorId !== result.rule.id ||
      projected.lifecycle.generatorVersion !== result.rule.ruleVersion
    ) {
      throw new TypeError(
        "The resolver returned an incomplete generated-resource preview.",
      );
    }
    generatedResourceKeys.add(key);
    generatedOperationIds.add(projected.lifecycle.operationId);
    return projected;
  });
  if (generatedOperationIds.size !== 1) {
    throw new TypeError(
      "The resolver returned generated resources from more than one connection operation.",
    );
  }
  const operationId = [...generatedOperationIds][0];
  const completeGeneratedResourceKeys = [
    ...document.nodes.flatMap((node) => {
      const lifecycle = node.semantic.lifecycle;
      return lifecycle.ownership === "generated" &&
        lifecycle.provenance.generatorKind === "connection-rule" &&
        String(lifecycle.provenance.generatorId) === String(result.rule.id) &&
        lifecycle.provenance.generatorVersion === result.rule.ruleVersion &&
        lifecycle.provenance.operationId === operationId
        ? [`node:${node.id}`]
        : [];
    }),
    ...document.edges.flatMap((edge) => {
      const lifecycle = edge.semantic.lifecycle;
      return lifecycle.ownership === "generated" &&
        lifecycle.provenance.generatorKind === "connection-rule" &&
        String(lifecycle.provenance.generatorId) === String(result.rule.id) &&
        lifecycle.provenance.generatorVersion === result.rule.ruleVersion &&
        lifecycle.provenance.operationId === operationId
        ? [`edge:${edge.id}`]
        : [];
    }),
  ].sort(compareText);
  if (
    serializeCanonicalJson(completeGeneratedResourceKeys) !==
    serializeCanonicalJson([...generatedResourceKeys].sort(compareText))
  ) {
    throw new TypeError(
      "The resolver returned an incomplete generated-resource preview.",
    );
  }

  const directEdges = generatedResources.filter(
    (
      resource,
    ): resource is Extract<
      EditorGeneratedConnectionResource,
      { kind: "edge" }
    > =>
      resource.kind === "edge" &&
      resource.relationshipType === result.rule.relationshipType &&
      resource.configuration.schemaId === result.rule.configuration.schemaId &&
      resource.configuration.schemaVersion ===
        result.rule.configuration.schemaVersion,
  );
  const directEdge = directEdges[0];
  if (
    directEdges.length !== 1 ||
    directEdge?.source.nodeId !== candidate.source.nodeId ||
    directEdge.source.portId !== candidate.source.portId ||
    directEdge.target.nodeId !== candidate.target.nodeId ||
    directEdge.target.portId !== candidate.target.portId
  ) {
    throw new TypeError(
      "The resolver preview does not match the selected exact connection endpoints.",
    );
  }

  return {
    batchCommandId: result.batch.commandId,
    changes: [...replay.changes],
    commands: result.batch.commands.map((command) => ({
      commandId: command.commandId,
      kind: command.kind,
      targetResourceIds: commandTargetResourceIds(command),
    })),
    configuration: { ...result.configuration },
    findings: projectConnectionFindings(result.findings),
    generatedResources,
    iamEffects: result.iamEffects.map((effect) => ({
      actions: [...effect.actions],
      effect: effect.effect,
      explanation: effect.explanation,
      id: effect.id,
      ...(effect.principal === undefined
        ? {}
        : { principal: effect.principal }),
      resourceScope: effect.resourceScope,
      ...(effect.when === undefined
        ? {}
        : {
            when: {
              equals: effect.when.equals,
              property: effect.when.property,
            },
          }),
    })),
    iamRequirements: result.iamRequirements.map((requirement) => ({
      actions: [...requirement.actions],
      effect: requirement.effect,
      effectId: requirement.effectId,
      ...(requirement.principal === undefined
        ? {}
        : { principal: requirement.principal }),
      qualifier: {
        configurationSchemaId: requirement.qualifier.configurationSchemaId,
        configurationSchemaVersion:
          requirement.qualifier.configurationSchemaVersion,
        edgeId: requirement.qualifier.edgeId,
      },
      readiness: requirement.readiness,
      resource:
        requirement.resource.scope === "supporting-node"
          ? { scope: requirement.resource.scope }
          : {
              nodeId: requirement.resource.nodeId,
              scope: requirement.resource.scope,
            },
      ruleId: requirement.ruleId,
      sourceEdgeId: requirement.sourceEdgeId,
    })),
    relationship,
    revisionId: document.revision.revisionId,
    sourceAvailability: sourceService.regionAvailability,
    targetAvailability: targetService.regionAvailability,
  };
}
