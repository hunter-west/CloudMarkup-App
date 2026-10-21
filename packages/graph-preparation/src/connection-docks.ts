import type { ArchitectureDocument } from "@cloudmarkup/domain";
import type { ProviderConnectionResolverV1 } from "@cloudmarkup/provider-sdk";

import { resolveExactEditorCatalogService } from "./catalog-selection.js";
import {
  prepareConnectionCompatibilityRequest,
  projectConnectionCandidates,
  projectConnectionFindings,
  type EditorConnectionFinding,
} from "./connection-workflow.js";
import {
  type EditorCatalog,
  EDITOR_CONNECTION_CATEGORY_ORDER,
  type EditorCatalogPort,
  type EditorCatalogService,
  type EditorConnectionCategory,
  type EditorConnectionDockSide,
  type EditorConnectionGroup,
  type EditorConnectionGroupDirection,
  type EditorConnectionGroupCategory,
  type EditorPortDirection,
} from "./editor-catalog.js";

export interface EditorConnectionDockMessage {
  readonly guided: string;
  readonly professional: string;
}

export interface EditorConnectionDockChoice {
  readonly available: boolean;
  readonly direction: "incoming" | "outgoing";
  readonly findings: readonly EditorConnectionFinding[];
  readonly recommendation: EditorConnectionDockMessage | null;
  readonly relationshipLabel: string;
  readonly relationshipType: string;
  readonly remoteNodeId: string;
  readonly remoteNodeLabel: string;
  readonly remoteServiceName: string;
  readonly ruleId: string;
  readonly source: {
    readonly nodeId: string;
    readonly portId: string;
  };
  readonly target: {
    readonly nodeId: string;
    readonly portId: string;
  };
  readonly unavailableReason: EditorConnectionDockMessage | null;
}

export interface EditorConnectionDockPurpose {
  readonly choices: readonly EditorConnectionDockChoice[];
  readonly description: string;
  readonly direction: EditorPortDirection;
  readonly displayName: string;
  readonly portId: string;
  readonly unavailableReason: EditorConnectionDockMessage | null;
}

export interface EditorConnectionDockInspection {
  readonly purposes: readonly EditorConnectionDockPurpose[];
  readonly unavailableReason: EditorConnectionDockMessage | null;
}

interface ConnectionGroupPresentation {
  readonly description: string;
  readonly guidedAssistance: string;
  readonly label: string;
  readonly professionalMetadata: string;
}

const PRESENTATION_BY_CATEGORY: Readonly<
  Record<EditorConnectionCategory, ConnectionGroupPresentation>
> = {
  "receives-events-from": {
    label: "Triggers",
    description: "Requests, events, and other work that start this service.",
    guidedAssistance:
      "Connect something that should start or trigger this service.",
    professionalMetadata: "Inbound trigger and event-source capabilities.",
  },
  "reads-or-writes-data": {
    label: "Data",
    description: "Data stores and resources this service reads or changes.",
    guidedAssistance:
      "Connect the information this service needs to read or update.",
    professionalMetadata: "Typed read, write, and data-resource capabilities.",
  },
  "sends-messages-or-events": {
    label: "Messages",
    description:
      "Messages, events, and failure destinations used by this service.",
    guidedAssistance:
      "Connect where this service should send messages or events.",
    professionalMetadata:
      "Messaging, event publication, and destination capabilities.",
  },
  "invokes-another-workload": {
    label: "Invocations",
    description: "Other workloads this service invokes or is invoked by.",
    guidedAssistance:
      "Connect another service that should run as part of this work.",
    professionalMetadata:
      "Synchronous and asynchronous workload invocation capabilities.",
  },
  "uses-secrets-or-configuration": {
    label: "Configuration",
    description: "Secrets and configuration this service is allowed to read.",
    guidedAssistance: "Connect configuration or secrets this service needs.",
    professionalMetadata: "Secret and configuration reference capabilities.",
  },
  "network-and-security": {
    label: "Identity & network",
    description:
      "Identity, permission, and network associations for this service.",
    guidedAssistance:
      "Review who this service acts as and where it can communicate.",
    professionalMetadata:
      "Identity, permission, and network association capabilities.",
  },
  observability: {
    label: "Observability",
    description:
      "Logs, metrics, traces, and monitoring associated with this service.",
    guidedAssistance:
      "Connect logging or monitoring so this service can be understood.",
    professionalMetadata:
      "Logging, metrics, tracing, and monitoring capabilities.",
  },
  other: {
    label: "Other",
    description: "Additional catalog-declared capabilities for this service.",
    guidedAssistance: "Review additional ways this service can connect.",
    professionalMetadata: "Other exact catalog-declared capabilities.",
  },
};

function groupCategoryForSemanticCategory(
  category: EditorConnectionCategory,
): EditorConnectionGroupCategory {
  switch (category) {
    case "receives-events-from":
      return "triggers";
    case "reads-or-writes-data":
      return "data";
    case "sends-messages-or-events":
      return "messaging";
    case "invokes-another-workload":
      return "invocation";
    case "network-and-security":
      return "networking";
    case "observability":
      return "observability";
    case "uses-secrets-or-configuration":
    case "other":
      return "other";
  }
}

const CONNECTION_GROUP_CATEGORIES: readonly EditorConnectionGroupCategory[] = [
  "triggers",
  "data",
  "messaging",
  "invocation",
  "identity",
  "networking",
  "observability",
  "other",
];

const STABLE_GROUP_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function directionForPorts(
  ports: readonly EditorCatalogPort[],
): EditorConnectionGroupDirection {
  const directions = new Set(ports.map((port) => port.direction));
  if (directions.size !== 1) {
    return "mixed";
  }
  return ports[0]?.direction ?? "mixed";
}

export function editorConnectionDockSide(
  direction: EditorPortDirection,
): Extract<EditorConnectionDockSide, "left" | "right"> {
  return direction === "input" ? "left" : "right";
}

function sideForGroup(
  direction: EditorConnectionGroupDirection,
): EditorConnectionDockSide {
  return direction === "mixed" ? "bottom" : editorConnectionDockSide(direction);
}

export function deriveEditorConnectionGroups(
  ports: readonly EditorCatalogPort[],
): readonly EditorConnectionGroup[] {
  return EDITOR_CONNECTION_CATEGORY_ORDER.flatMap((category, order) => {
    const members = ports
      .filter((port) => port.category === category)
      .sort((left, right) => compareText(left.id, right.id));
    if (members.length === 0) {
      return [];
    }
    const direction = directionForPorts(members);
    const presentation = PRESENTATION_BY_CATEGORY[category];
    const allowsMultipleEdges =
      members.length > 1 || members.some((port) => port.cardinality === "many");
    const exclusivePortIds = members
      .filter((port) => port.cardinality === "one")
      .map((port) => port.id);
    return [
      Object.freeze({
        allowsMultipleEdges,
        cardinality: Object.freeze({
          enforcement: "semantic-port" as const,
          maximum: allowsMultipleEdges ? ("many" as const) : (1 as const),
          minimum: members.some((port) => port.required)
            ? (1 as const)
            : (0 as const),
        }),
        category: groupCategoryForSemanticCategory(category),
        containsExclusiveRelationships: exclusivePortIds.length > 0,
        description: presentation.description,
        direction,
        exclusivePortIds: Object.freeze(exclusivePortIds),
        guidedAssistance: presentation.guidedAssistance,
        id: category,
        label: presentation.label,
        order,
        portIds: Object.freeze(members.map((port) => port.id)),
        professionalMetadata: presentation.professionalMetadata,
        side: sideForGroup(direction),
      }),
    ];
  });
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function hasValidCardinality(group: EditorConnectionGroup): boolean {
  const cardinality: unknown = group.cardinality;
  if (!isRecord(cardinality)) {
    return false;
  }
  const enforcement = cardinality["enforcement"];
  const maximum = cardinality["maximum"];
  const minimum = cardinality["minimum"];
  return (
    (minimum === 0 || minimum === 1) &&
    (maximum === 1 || maximum === "many") &&
    (enforcement === "semantic-port" || enforcement === "provider-rule") &&
    group.allowsMultipleEdges === (maximum === "many")
  );
}

export function validateEditorConnectionGroups(
  ports: readonly EditorCatalogPort[],
  groups: readonly EditorConnectionGroup[],
): readonly EditorConnectionGroup[] | null {
  const portById = new Map(ports.map((port) => [port.id, port]));
  const seenGroupIds = new Set<string>();
  const seenSideOrders = new Set<string>();
  const assignedPortIds = new Set<string>();
  const normalized: EditorConnectionGroup[] = [];

  for (const group of groups) {
    if (
      !STABLE_GROUP_ID.test(group.id) ||
      seenGroupIds.has(group.id) ||
      !Number.isSafeInteger(group.order) ||
      group.order < 0 ||
      seenSideOrders.has(`${group.side}:${String(group.order)}`) ||
      !isNonEmpty(group.label) ||
      !isNonEmpty(group.description) ||
      !isNonEmpty(group.guidedAssistance) ||
      !isNonEmpty(group.professionalMetadata) ||
      !CONNECTION_GROUP_CATEGORIES.includes(group.category) ||
      !["bottom", "left", "right", "top"].includes(group.side) ||
      typeof group.containsExclusiveRelationships !== "boolean" ||
      group.portIds.length === 0 ||
      !hasValidCardinality(group)
    ) {
      return null;
    }

    const groupPortIds = [...group.portIds];
    if (new Set(groupPortIds).size !== groupPortIds.length) {
      return null;
    }
    const groupPorts = groupPortIds.map((portId) => portById.get(portId));
    if (
      groupPorts.some((port) => port === undefined) ||
      groupPortIds.some((portId) => assignedPortIds.has(portId))
    ) {
      return null;
    }
    const exactPorts = groupPorts.filter(
      (port): port is EditorCatalogPort => port !== undefined,
    );
    const expectedDirection = directionForPorts(exactPorts);
    const expectedExclusivePortIds = exactPorts
      .filter((port) => port.cardinality === "one")
      .map((port) => port.id);
    if (group.direction !== expectedDirection) {
      return null;
    }

    seenGroupIds.add(group.id);
    seenSideOrders.add(`${group.side}:${String(group.order)}`);
    for (const portId of groupPortIds) {
      assignedPortIds.add(portId);
    }
    normalized.push(
      Object.freeze({
        ...group,
        exclusivePortIds: Object.freeze(expectedExclusivePortIds),
        portIds: Object.freeze(groupPortIds),
      }),
    );
  }

  if (assignedPortIds.size !== ports.length) {
    return null;
  }

  return Object.freeze(
    normalized.sort(
      (left, right) =>
        left.order - right.order || compareText(left.id, right.id),
    ),
  );
}

export function resolveEditorConnectionGroups(
  service: Pick<EditorCatalogService, "connectionGroups" | "ports">,
): readonly EditorConnectionGroup[] {
  if (service.connectionGroups === undefined) {
    return deriveEditorConnectionGroups(service.ports);
  }
  return (
    validateEditorConnectionGroups(service.ports, service.connectionGroups) ??
    []
  );
}

export function editorConnectionGroupForPort(
  service: Pick<EditorCatalogService, "connectionGroups" | "ports">,
  portId: string,
): EditorConnectionGroup | undefined {
  return resolveEditorConnectionGroups(service).find((group) =>
    group.portIds.includes(portId),
  );
}

export function editorDockHandleId(
  groupId: string,
  direction: EditorPortDirection,
): string {
  return ["dock", groupId, direction].join(":");
}

function dockMessage(
  guided: string,
  professional: string,
): EditorConnectionDockMessage {
  return Object.freeze({ guided, professional });
}

function findingMessage(
  finding: EditorConnectionFinding | undefined,
  fallback: EditorConnectionDockMessage,
): EditorConnectionDockMessage {
  return finding === undefined
    ? fallback
    : dockMessage(finding.guidedMessage, finding.professionalMessage);
}

function unavailablePurpose(
  port: EditorCatalogPort,
  reason: EditorConnectionDockMessage,
): EditorConnectionDockPurpose {
  return Object.freeze({
    choices: Object.freeze([]),
    description: port.description,
    direction: port.direction,
    displayName: port.displayName,
    portId: port.id,
    unavailableReason: reason,
  });
}

function inspectPurpose(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  resolver: ProviderConnectionResolverV1 | undefined,
  nodeId: string,
  port: EditorCatalogPort,
): EditorConnectionDockPurpose {
  if (port.connectionSupport !== "supported") {
    return unavailablePurpose(
      port,
      dockMessage(
        "This catalog version does not yet provide an implemented connection for this capability.",
        `Semantic port ${port.id} has no implemented relationship in the exact bound catalog.`,
      ),
    );
  }
  if (resolver === undefined) {
    return unavailablePurpose(
      port,
      dockMessage(
        "Compatible resources cannot be listed because the version-bound connection engine is unavailable.",
        "No ProviderConnectionResolver v1 is bound to this editor session.",
      ),
    );
  }

  const intent = {
    direction: port.direction,
    kind: "port",
    nodeId,
    portId: port.id,
  } as const;
  const prepared = prepareConnectionCompatibilityRequest(document, intent);
  if (prepared === undefined) {
    return unavailablePurpose(
      port,
      dockMessage(
        "This exact connection purpose cannot be inspected safely.",
        `A compatibility request could not be prepared for semantic port ${port.id}.`,
      ),
    );
  }

  try {
    const result = resolver.listCompatible(prepared.request);
    const requestFindings = projectConnectionFindings(result.findings);
    const candidates = projectConnectionCandidates(
      document,
      catalog,
      result.candidates,
      prepared.editingEdgeId,
    );
    const initialChoices = candidates.flatMap(
      (candidate): readonly EditorConnectionDockChoice[] => {
        const anchoredAtSource =
          candidate.source.nodeId === nodeId &&
          candidate.source.portId === port.id;
        const anchoredAtTarget =
          candidate.target.nodeId === nodeId &&
          candidate.target.portId === port.id;
        if (anchoredAtSource === anchoredAtTarget) {
          return [];
        }
        const remote = anchoredAtSource ? candidate.target : candidate.source;
        const blockingFinding = candidate.findings.find(
          (finding) => finding.severity === "error",
        );
        const available = blockingFinding === undefined;
        return [
          Object.freeze({
            available,
            direction: anchoredAtSource
              ? ("outgoing" as const)
              : ("incoming" as const),
            findings: Object.freeze([...candidate.findings]),
            recommendation: null,
            relationshipLabel:
              candidate.relationship.presentationLabel ??
              candidate.relationship.displayName,
            relationshipType: candidate.relationship.id,
            remoteNodeId: remote.nodeId,
            remoteNodeLabel: remote.nodeLabel,
            remoteServiceName: remote.serviceName,
            ruleId: candidate.relationship.descriptorId,
            source: Object.freeze({
              nodeId: candidate.source.nodeId,
              portId: candidate.source.portId,
            }),
            target: Object.freeze({
              nodeId: candidate.target.nodeId,
              portId: candidate.target.portId,
            }),
            unavailableReason: available
              ? null
              : findingMessage(
                  blockingFinding,
                  dockMessage(
                    "This compatible resource is currently unavailable.",
                    "The exact resolver candidate has a blocking compatibility finding.",
                  ),
                ),
          }),
        ];
      },
    );
    const safeChoices = initialChoices.filter(
      (choice) =>
        choice.available &&
        choice.findings.length === 0 &&
        candidates.find(
          (candidate) =>
            candidate.relationship.descriptorId === choice.ruleId &&
            candidate.source.nodeId === choice.source.nodeId &&
            candidate.source.portId === choice.source.portId &&
            candidate.target.nodeId === choice.target.nodeId &&
            candidate.target.portId === choice.target.portId,
        )?.relationship.implementation.status === "implemented",
    );
    const recommended = safeChoices.length === 1 ? safeChoices[0] : undefined;
    const choices = Object.freeze(
      initialChoices.map((choice) =>
        choice === recommended
          ? Object.freeze({
              ...choice,
              recommendation: dockMessage(
                "Recommended because this is the only compatible resource in the architecture and the connection engine found no issues.",
                "Sole exact implemented resolver candidate for this semantic port with no compatibility findings.",
              ),
            })
          : choice,
      ),
    );
    const unavailableReason =
      choices.length > 0
        ? null
        : findingMessage(
            requestFindings[0],
            dockMessage(
              "No compatible resources in this architecture can use this connection purpose.",
              `The bound resolver returned no exact candidate for semantic port ${port.id}.`,
            ),
          );
    return Object.freeze({
      choices,
      description: port.description,
      direction: port.direction,
      displayName: port.displayName,
      portId: port.id,
      unavailableReason,
    });
  } catch {
    return unavailablePurpose(
      port,
      dockMessage(
        "Compatible resources could not be inspected safely.",
        `Provider connection compatibility discovery failed closed for semantic port ${port.id}.`,
      ),
    );
  }
}

/**
 * Projects one dock's exact semantic ports through the bound compatibility
 * resolver without opening a workflow or mutating the Architecture Document.
 */
export function inspectEditorConnectionDock(
  document: ArchitectureDocument | null,
  catalog: EditorCatalog,
  resolver: ProviderConnectionResolverV1 | undefined,
  nodeId: string,
  portIds: readonly string[],
): EditorConnectionDockInspection {
  if (document === null) {
    return Object.freeze({
      purposes: Object.freeze([]),
      unavailableReason: dockMessage(
        "Connection choices cannot be listed because no valid architecture is loaded.",
        "Dock inspection requires a valid exact-catalog-bound Architecture Document.",
      ),
    });
  }

  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  const service =
    node === undefined
      ? undefined
      : resolveExactEditorCatalogService(document, node, catalog);
  const requestedPorts =
    service === undefined
      ? []
      : portIds.flatMap((portId) => {
          const matches = service.ports.filter((port) => port.id === portId);
          return matches.length === 1 && matches[0] !== undefined
            ? [matches[0]]
            : [];
        });
  if (
    service === undefined ||
    new Set(portIds).size !== portIds.length ||
    requestedPorts.length !== portIds.length
  ) {
    return Object.freeze({
      purposes: Object.freeze([]),
      unavailableReason: dockMessage(
        "Connection choices cannot be listed because this dock is not bound to exact catalog capabilities.",
        "Dock inspection failed closed because its node or semantic-port binding is missing, duplicated, or stale.",
      ),
    });
  }

  return Object.freeze({
    purposes: Object.freeze(
      requestedPorts.map((port) =>
        inspectPurpose(document, catalog, resolver, nodeId, port),
      ),
    ),
    unavailableReason: null,
  });
}
