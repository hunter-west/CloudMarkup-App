import { prepareInfrastructureWorkloadCommand } from "./infrastructure-workload-command.js";
import {
  ParentConnectionError,
  prepareParentConnectionActions,
} from "./parent-connection-command.js";
import {
  applyGraphCommand,
  type ArchitectureDocument,
  type ArchitectureNode,
  type GraphCommandApplicationResult,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  type GraphCommandV1,
  type GraphCommandActionV1,
} from "@cloudmarkup/schemas";

import {
  absoluteEditorNodePosition,
  BOUNDARY_CONTENT_BOTTOM,
  BOUNDARY_CONTENT_LEFT,
  BOUNDARY_CONTENT_RIGHT,
  BOUNDARY_CONTENT_TOP,
  BOUNDARY_MAXIMUM_HEIGHT,
  BOUNDARY_MAXIMUM_WIDTH,
  canonicalServiceNodeSize,
  deriveArchitectureGeometry,
  EditorGeometryError,
  relativeEditorPosition,
  snapEditorPoint,
  type EditorSize,
} from "./architecture-geometry.js";
import { normallyVisibleArchitectureNodes } from "./catalog-selection.js";
import type { EditorCatalog, EditorCatalogService } from "./editor-catalog.js";
import {
  exactVisualBoundaryNodeId,
  resolveServiceCreationAvailability,
  type ServiceCreationFailureCode,
  type ServiceCreationOptions,
  visualBoundaryParentId,
} from "./placement-rules.js";

export {
  resolveServiceCreationAvailability,
  type ServiceCreationAvailability,
  type ServiceCreationFailureCode,
} from "./placement-rules.js";

export interface AddServicePosition {
  readonly x: number;
  readonly y: number;
}

export interface AddServiceCommandInput extends ServiceCreationOptions {
  readonly catalog: EditorCatalog;
  readonly createId: () => string;
  readonly document: ArchitectureDocument;
  readonly position?: AddServicePosition;
  readonly serviceId: string;
}

export interface StableServiceNodeIdentity {
  readonly deploymentKey: string;
  readonly nodeId: string;
  readonly ordinal: number;
}

export interface PreparedAddServiceCommand {
  readonly command: GraphCommandV1;
  readonly node: ArchitectureNode;
  readonly deploymentKey: string;
  readonly nodeId: ArchitectureNode["id"];
  readonly position: AddServicePosition;
}

export interface AddServiceCommandDispatchResult extends GraphCommandApplicationResult {
  readonly command: GraphCommandV1;
  readonly node: ArchitectureNode;
  readonly deploymentKey: string;
  readonly nodeId: ArchitectureNode["id"];
}

export class AddServiceCommandCreationError extends Error {
  public readonly code:
    | ServiceCreationFailureCode
    | "duplicate-command-identity"
    | "invalid-position"
    | "stable-identity-exhausted";

  public constructor(
    code: AddServiceCommandCreationError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "AddServiceCommandCreationError";
  }
}

function identityBase(serviceType: string): string {
  const segments = serviceType.split(".");
  const providerNeutralSegments =
    segments.length > 1 ? segments.slice(1) : segments;
  let base = providerNeutralSegments
    .join("_")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (!/^[a-z]/u.test(base)) {
    base = `resource_${base}`;
  }
  return base.slice(0, 48).replace(/_+$/gu, "") || "resource";
}

export function createStableServiceNodeIdentity(
  document: ArchitectureDocument,
  serviceType: string,
): StableServiceNodeIdentity {
  const base = identityBase(serviceType);
  const usedNodeIds = new Set(document.nodes.map((node) => String(node.id)));
  const usedDeploymentKeys = new Set(
    document.nodes.map((node) => String(node.semantic.deploymentKey)),
  );

  for (let ordinal = 1; ordinal <= 10_000; ordinal += 1) {
    const suffix = ordinal === 1 ? "" : `_${String(ordinal)}`;
    const deploymentKey = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    const nodeId = `node_${deploymentKey}`;
    if (!usedNodeIds.has(nodeId) && !usedDeploymentKeys.has(deploymentKey)) {
      return { deploymentKey, nodeId, ordinal };
    }
  }

  throw new AddServiceCommandCreationError(
    "stable-identity-exhausted",
    "No stable service identity is available.",
  );
}

interface PlacementFootprint {
  readonly height: number;
  readonly width: number;
}

const PLACEMENT_GUTTER = 32;
const ROOT_PLACEMENT_COLUMNS = 4;
const ROOT_PLACEMENT_HORIZONTAL_STEP = 288;
const ROOT_PLACEMENT_VERTICAL_STEP = 208;
const ROOT_PLACEMENT_ORIGIN = 80;

function placementFootprint(
  size: EditorSize,
  isBoundary: boolean,
): PlacementFootprint {
  return {
    height: size.height + PLACEMENT_GUTTER,
    width: size.width + (isBoundary ? PLACEMENT_GUTTER : 0),
  };
}

function footprintsOverlap(
  leftPosition: AddServicePosition,
  leftFootprint: PlacementFootprint,
  rightPosition: AddServicePosition,
  rightFootprint: PlacementFootprint,
): boolean {
  return (
    leftPosition.x < rightPosition.x + rightFootprint.width &&
    rightPosition.x < leftPosition.x + leftFootprint.width &&
    leftPosition.y < rightPosition.y + rightFootprint.height &&
    rightPosition.y < leftPosition.y + leftFootprint.height
  );
}

function nextDefaultPosition(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  service: EditorCatalogService,
  visualParentNodeId: ArchitectureNode["id"] | null,
): AddServicePosition {
  const geometry = deriveArchitectureGeometry(document, catalog);
  if (geometry.overflows.length > 0) {
    throw new AddServiceCommandCreationError(
      "invalid-position",
      "A deterministic position is unavailable while an existing boundary exceeds its supported dimensions.",
    );
  }
  const candidateSize = canonicalServiceNodeSize(service, service.serviceType);
  const candidateFootprint = placementFootprint(
    candidateSize,
    service.nodeKind === "boundary",
  );
  const existing = normallyVisibleArchitectureNodes(document, catalog).map(
    (node) => {
      const size = geometry.sizes.get(node.id);
      if (size === undefined) {
        throw new AddServiceCommandCreationError(
          "invalid-position",
          `No deterministic geometry is available for ${node.presentation.label}.`,
        );
      }
      return {
        footprint: placementFootprint(
          size,
          exactVisualBoundaryNodeId(document, catalog, node.id) !== null,
        ),
        node,
      };
    },
  );

  if (visualParentNodeId !== null) {
    const maximumContentWidth =
      BOUNDARY_MAXIMUM_WIDTH - BOUNDARY_CONTENT_LEFT - BOUNDARY_CONTENT_RIGHT;
    const columnCount = Math.max(
      1,
      Math.floor(maximumContentWidth / candidateFootprint.width),
    );
    const parentAbsolute = absoluteEditorNodePosition(
      document,
      catalog,
      visualParentNodeId,
    );

    for (let index = 0; index < 10_000; index += 1) {
      const candidate = {
        x:
          BOUNDARY_CONTENT_LEFT +
          (index % columnCount) * candidateFootprint.width,
        y:
          BOUNDARY_CONTENT_TOP +
          Math.floor(index / columnCount) * candidateFootprint.height,
      };
      if (
        candidate.x + candidateSize.width + BOUNDARY_CONTENT_RIGHT >
          BOUNDARY_MAXIMUM_WIDTH ||
        candidate.y + candidateSize.height + BOUNDARY_CONTENT_BOTTOM >
          BOUNDARY_MAXIMUM_HEIGHT
      ) {
        break;
      }
      if (
        !existing.some(
          ({ footprint, node }) =>
            visualBoundaryParentId(document, catalog, node) ===
              visualParentNodeId &&
            footprintsOverlap(
              candidate,
              candidateFootprint,
              node.presentation.position,
              footprint,
            ),
        )
      ) {
        return {
          x: parentAbsolute.x + candidate.x,
          y: parentAbsolute.y + candidate.y,
        };
      }
    }
    throw new AddServiceCommandCreationError(
      "invalid-position",
      "No deterministic position is available inside the selected boundary.",
    );
  }

  for (let index = 0; index < 10_000; index += 1) {
    const candidate = {
      x:
        ROOT_PLACEMENT_ORIGIN +
        (index % ROOT_PLACEMENT_COLUMNS) * ROOT_PLACEMENT_HORIZONTAL_STEP,
      y:
        ROOT_PLACEMENT_ORIGIN +
        Math.floor(index / ROOT_PLACEMENT_COLUMNS) *
          ROOT_PLACEMENT_VERTICAL_STEP,
    };
    if (
      !existing.some(
        ({ footprint, node }) =>
          visualBoundaryParentId(document, catalog, node) === null &&
          footprintsOverlap(
            candidate,
            candidateFootprint,
            absoluteEditorNodePosition(document, catalog, node.id),
            footprint,
          ),
      )
    ) {
      return candidate;
    }
  }
  throw new AddServiceCommandCreationError(
    "invalid-position",
    "No deterministic visual position is available.",
  );
}

function normalizePosition(
  position: AddServicePosition | undefined,
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  service: EditorCatalogService,
  visualParentNodeId: ArchitectureNode["id"] | null,
): AddServicePosition {
  try {
    const absolute = snapEditorPoint(
      position ??
        nextDefaultPosition(document, catalog, service, visualParentNodeId),
    );
    return snapEditorPoint(
      relativeEditorPosition(document, catalog, absolute, visualParentNodeId),
    );
  } catch (error) {
    if (
      error instanceof AddServiceCommandCreationError ||
      !(error instanceof EditorGeometryError)
    ) {
      throw error;
    }
    throw new AddServiceCommandCreationError("invalid-position", error.message);
  }
}

export function createAddServiceCommand(
  input: AddServiceCommandInput,
): PreparedAddServiceCommand {
  const availability = resolveServiceCreationAvailability(
    input.document,
    input.catalog,
    input.serviceId,
    input,
  );
  if (!availability.enabled) {
    throw new AddServiceCommandCreationError(
      availability.code,
      availability.reason,
    );
  }

  const identity = createStableServiceNodeIdentity(
    input.document,
    availability.service.serviceType,
  );
  const visualParentNodeId =
    availability.parent === null
      ? null
      : exactVisualBoundaryNodeId(
          input.document,
          input.catalog,
          availability.parent.nodeId,
        );
  const position = normalizePosition(
    input.position,
    input.document,
    input.catalog,
    availability.service,
    visualParentNodeId,
  );
  const commandId = input.createId();
  const inverseCommandId = input.createId();
  if (commandId === inverseCommandId) {
    throw new AddServiceCommandCreationError(
      "duplicate-command-identity",
      "Add command and inverse command IDs must be distinct.",
    );
  }

  const command = parseGraphCommandV1({
    schemaVersion: 1,
    commandId,
    inverseCommandId,
    origin: "user",
    target: {
      documentId: input.document.documentId,
      architectureId: input.document.architectureId,
      revisionId: input.document.revision.revisionId,
    },
    kind: "add-node",
    node: {
      id: identity.nodeId,
      semantic: {
        deploymentKey: identity.deploymentKey,
        serviceType: availability.service.serviceType,
        resourceType: availability.service.resourceType,
        configuration: {
          schemaId: availability.service.configuration.schemaId,
          schemaVersion: availability.service.configuration.schemaVersion,
          values: structuredClone(availability.configurationValues),
        },
        ...(availability.parent === null
          ? {}
          : {
              parent: {
                nodeId: availability.parent.nodeId,
                relationshipType: availability.parent.relationshipType,
              },
            }),
        lifecycle: {
          ownership: "user",
          origin: "user",
        },
      },
      presentation: {
        label:
          identity.ordinal === 1
            ? availability.service.displayName
            : `${availability.service.displayName} ${String(identity.ordinal)}`,
        position,
      },
    },
  });
  if (command.kind !== "add-node") {
    throw new AddServiceCommandCreationError(
      "service-unavailable",
      "Expected an add-node Graph Command.",
    );
  }
  const actions: GraphCommandActionV1[] = [command];
  let preview = applyGraphCommand(input.document, command);
  try {
    const parentActions = prepareParentConnectionActions({
      catalog: input.catalog,
      document: preview.document,
      node: command.node,
      parent: command.node.semantic.parent ?? null,
      createId: input.createId,
    });
    for (const action of parentActions) {
      actions.push(action);
      preview = applyGraphCommand(preview.document, action);
    }
  } catch (error) {
    if (error instanceof ParentConnectionError)
      throw new AddServiceCommandCreationError(
        "parent-unavailable",
        error.message,
      );
    throw error;
  }
  if (availability.service.defaultWorkload === "infrastructure-only") {
    const workloadCommand = prepareInfrastructureWorkloadCommand({
      catalog: input.catalog,
      document: preview.document,
      nodeId: command.node.id,
      createId: input.createId,
    });
    actions.push(workloadCommand);
    preview = applyGraphCommand(preview.document, workloadCommand);
  }
  const completeCommand =
    actions.length === 1
      ? command
      : parseGraphCommandV1({
          schemaVersion: 1,
          commandId: input.createId(),
          inverseCommandId: input.createId(),
          origin: "user",
          target: command.target,
          kind: "batch",
          commands: actions,
        });
  // Reapply the entire proposal atomically before presenting a creation result.
  preview = applyGraphCommand(input.document, completeCommand);
  const geometry = (() => {
    try {
      return deriveArchitectureGeometry(preview.document, input.catalog);
    } catch (error) {
      if (!(error instanceof EditorGeometryError)) {
        throw error;
      }
      throw new AddServiceCommandCreationError(
        "invalid-position",
        error.message,
      );
    }
  })();
  if (geometry.overflows.length > 0) {
    throw new AddServiceCommandCreationError(
      "invalid-position",
      geometry.overflows[0]?.message ??
        "The service position exceeds the selected boundary.",
    );
  }

  return {
    command: completeCommand,
    node: command.node,
    deploymentKey: identity.deploymentKey,
    nodeId: command.node.id,
    position,
  };
}

export function dispatchAddServiceCommand(
  input: AddServiceCommandInput,
): AddServiceCommandDispatchResult {
  const prepared = createAddServiceCommand(input);
  const result = applyGraphCommand(input.document, prepared.command);
  return {
    ...result,
    command: prepared.command,
    node: prepared.node,
    deploymentKey: prepared.deploymentKey,
    nodeId: prepared.nodeId,
  };
}
