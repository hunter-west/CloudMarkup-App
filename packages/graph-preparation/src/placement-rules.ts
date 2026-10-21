import type {
  ArchitectureDocument,
  ArchitectureNode,
} from "@cloudmarkup/domain";

import {
  hasExactEditorCatalogBinding,
  resolveExactEditorCatalogService,
} from "./catalog-selection.js";
import type { EditorCatalog, EditorCatalogService } from "./editor-catalog.js";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { isCredentialLiteralProperty } from "./configuration-command.js";

export interface ServiceCreationOptions {
  readonly configurationValues?: Readonly<
    Record<string, Readonly<ConfigurationValue>>
  >;
  readonly parentNodeId?: string | null;
}

export function serviceCreationDefaults(
  document: ArchitectureDocument,
  service: EditorCatalogService,
): Readonly<Record<string, Readonly<ConfigurationValue>>> {
  const defaults = service.configuration.defaults;
  const property = service.configuration.documentRegionProperty;
  return {
    ...(defaults.kind === "ready" ? defaults.values : {}),
    ...(property === undefined
      ? {}
      : {
          [property]: {
            kind: "string" as const,
            value: document.provider.region,
          },
        }),
  };
}

export type EditorPlacementFailureCode =
  | "catalog-mismatch"
  | "cycle"
  | "depth-exceeded"
  | "generated-requires-adoption"
  | "parent-ambiguous"
  | "parent-not-boundary"
  | "parent-unavailable"
  | "provider-placement-unavailable"
  | "root-forbidden"
  | "root-required"
  | "service-unavailable"
  | "unknown-node";

export interface EditorPlacementFailure {
  readonly code: EditorPlacementFailureCode;
  readonly message: string;
  readonly success: false;
}

export interface EditorPlacementSuccess {
  readonly parent: {
    readonly nodeId: ArchitectureNode["id"];
    readonly relationshipType: string;
  } | null;
  readonly success: true;
}

export type EditorPlacementValidation =
  EditorPlacementFailure | EditorPlacementSuccess;

export interface EditorPlacementOption {
  readonly label: string;
  readonly parentNodeId: ArchitectureNode["id"] | null;
  readonly relationshipType: string | null;
  readonly technicalLabel: string;
}

export type ServiceCreationFailureCode =
  | "catalog-mismatch"
  | "configuration-unavailable"
  | "parent-ambiguous"
  | "parent-unavailable"
  | "service-unavailable"
  | "unknown-service";

export type ServiceCreationAvailability =
  | {
      readonly enabled: true;
      readonly configurationValues: Readonly<
        Record<string, Readonly<ConfigurationValue>>
      >;
      readonly parent: {
        readonly nodeId: ArchitectureNode["id"];
        readonly relationshipType: string;
      } | null;
      readonly service: EditorCatalogService;
    }
  | {
      readonly code: ServiceCreationFailureCode;
      readonly enabled: false;
      readonly reason: string;
    };

type CatalogPlacementTargetValidation =
  | {
      readonly code:
        | "depth-exceeded"
        | "parent-ambiguous"
        | "parent-not-boundary"
        | "parent-unavailable"
        | "provider-placement-unavailable"
        | "root-forbidden"
        | "root-required";
      readonly message: string;
      readonly success: false;
    }
  | {
      readonly parent: {
        readonly nodeId: ArchitectureNode["id"];
        readonly relationshipType: string;
      } | null;
      readonly success: true;
    };

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function failure(
  code: EditorPlacementFailureCode,
  message: string,
): EditorPlacementFailure {
  return { code, message, success: false };
}

function exactAvailableService(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  node: ArchitectureNode,
): EditorCatalogService | undefined {
  const service = resolveExactEditorCatalogService(document, node, catalog);
  return service?.supportState === "available" ? service : undefined;
}

export function exactVisualBoundaryNodeId(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  nodeId: ArchitectureNode["id"],
): ArchitectureNode["id"] | null {
  const node = nodeById(document, nodeId);
  if (node === undefined) {
    return null;
  }
  const service = exactAvailableService(document, catalog, node);
  return service?.nodeKind === "boundary" ? node.id : null;
}

function nodeById(
  document: ArchitectureDocument,
  nodeId: string,
): ArchitectureNode | undefined {
  return document.nodes.find((node) => node.id === nodeId);
}

function nodeDepth(
  document: ArchitectureDocument,
  nodeId: ArchitectureNode["id"],
): number | null {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const seen = new Set<ArchitectureNode["id"]>();
  let depth = 1;
  let current: ArchitectureNode["id"] | undefined = nodeId;

  while (current !== undefined) {
    if (seen.has(current)) {
      return null;
    }
    seen.add(current);
    const node = nodes.get(current);
    if (node === undefined) {
      return null;
    }
    current = node.semantic.parent?.nodeId;
    if (current !== undefined) {
      depth += 1;
    }
  }

  return depth;
}

function validateCatalogPlacementTarget(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  service: EditorCatalogService,
  targetParentId: string | null,
  options: {
    readonly currentRelationshipType?: string;
    readonly requireVisualBoundary: boolean;
  },
): CatalogPlacementTargetValidation {
  if (service.placement.regionConstraint === "provider-defined") {
    return {
      code: "provider-placement-unavailable",
      message:
        "This service needs provider placement behavior that this editor cannot evaluate safely.",
      success: false,
    };
  }

  if (targetParentId === null) {
    if (service.placement.rootPlacement === "forbidden") {
      return {
        code: "root-forbidden",
        message: `${service.displayName} must remain inside an allowed boundary.`,
        success: false,
      };
    }
    if (
      service.placement.maximumDepth !== undefined &&
      service.placement.maximumDepth < 1
    ) {
      return {
        code: "depth-exceeded",
        message: `${service.displayName} cannot be placed deeper than level ${String(
          service.placement.maximumDepth,
        )}.`,
        success: false,
      };
    }
    return { parent: null, success: true };
  }

  if (service.placement.rootPlacement === "required") {
    return {
      code: "root-required",
      message: `${service.displayName} must remain at the architecture root.`,
      success: false,
    };
  }

  const parentNode = nodeById(document, targetParentId);
  if (parentNode === undefined) {
    return {
      code: "parent-unavailable",
      message: "The selected boundary no longer exists.",
      success: false,
    };
  }
  const parentService = exactAvailableService(document, catalog, parentNode);
  if (parentService === undefined) {
    return {
      code: "parent-unavailable",
      message:
        "The selected boundary is not uniquely available in the exact bound catalog.",
      success: false,
    };
  }
  if (
    options.requireVisualBoundary &&
    exactVisualBoundaryNodeId(document, catalog, parentNode.id) === null
  ) {
    return {
      code: "parent-not-boundary",
      message: `${parentService.displayName} is an association target, not a visual boundary.`,
      success: false,
    };
  }

  const relationshipTypes = [
    ...new Set(
      service.placement.allowedParents
        .filter(
          (allowedParent) =>
            allowedParent.serviceType === parentService.serviceType,
        )
        .map((allowedParent) => allowedParent.relationshipType),
    ),
  ].sort(compareText);
  if (relationshipTypes.length === 0) {
    return {
      code: "parent-unavailable",
      message: `${service.displayName} cannot be placed inside ${parentService.displayName}.`,
      success: false,
    };
  }

  if (
    options.currentRelationshipType !== undefined &&
    !relationshipTypes.includes(options.currentRelationshipType)
  ) {
    return {
      code: "parent-unavailable",
      message: `${service.displayName}'s current parent relationship is not allowed by the exact bound catalog.`,
      success: false,
    };
  }

  const relationshipType =
    options.currentRelationshipType ??
    (relationshipTypes.length === 1 ? relationshipTypes[0] : undefined);
  if (relationshipType === undefined) {
    return {
      code: "parent-ambiguous",
      message:
        "More than one catalog relationship can place this node in that boundary.",
      success: false,
    };
  }

  const parentDepth = nodeDepth(document, parentNode.id);
  if (parentDepth === null) {
    return {
      code: "parent-unavailable",
      message: "The selected boundary has an invalid parent hierarchy.",
      success: false,
    };
  }
  if (
    service.placement.maximumDepth !== undefined &&
    parentDepth + 1 > service.placement.maximumDepth
  ) {
    return {
      code: "depth-exceeded",
      message: `${service.displayName} cannot be placed deeper than level ${String(
        service.placement.maximumDepth,
      )}.`,
      success: false,
    };
  }

  return {
    parent: {
      nodeId: parentNode.id,
      relationshipType,
    },
    success: true,
  };
}

function isDescendantOf(
  document: ArchitectureDocument,
  candidateId: ArchitectureNode["id"],
  ancestorId: ArchitectureNode["id"],
): boolean {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const seen = new Set<ArchitectureNode["id"]>();
  let current: ArchitectureNode["id"] | undefined = candidateId;

  while (current !== undefined) {
    if (current === ancestorId) {
      return true;
    }
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    current = nodes.get(current)?.semantic.parent?.nodeId;
  }

  return false;
}

function depthAfterPlacement(
  document: ArchitectureDocument,
  nodeId: ArchitectureNode["id"],
  movedNodeId: ArchitectureNode["id"],
  targetParentId: ArchitectureNode["id"] | null,
): number | null {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const seen = new Set<ArchitectureNode["id"]>();
  let depth = 1;
  let current = nodeId;

  for (;;) {
    if (seen.has(current)) {
      return null;
    }
    seen.add(current);
    const parentId =
      current === movedNodeId
        ? targetParentId
        : (nodes.get(current)?.semantic.parent?.nodeId ?? null);
    if (parentId === null) {
      return depth;
    }
    if (!nodes.has(parentId)) {
      return null;
    }
    depth += 1;
    current = parentId;
  }
}

function validateSubtreeDepths(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  movedNodeId: ArchitectureNode["id"],
  targetParentId: ArchitectureNode["id"] | null,
): EditorPlacementFailure | null {
  for (const node of document.nodes) {
    if (!isDescendantOf(document, node.id, movedNodeId)) {
      continue;
    }
    const service = exactAvailableService(document, catalog, node);
    if (service === undefined) {
      return failure(
        "service-unavailable",
        "Every moved boundary descendant must resolve uniquely in the exact bound catalog.",
      );
    }
    const depth = depthAfterPlacement(
      document,
      node.id,
      movedNodeId,
      targetParentId,
    );
    if (depth === null) {
      return failure(
        "cycle",
        "This boundary choice would create an invalid parent cycle.",
      );
    }
    if (
      service.placement.maximumDepth !== undefined &&
      depth > service.placement.maximumDepth
    ) {
      return failure(
        "depth-exceeded",
        `${service.displayName} cannot be placed deeper than level ${String(
          service.placement.maximumDepth,
        )}.`,
      );
    }
  }

  return null;
}

export function validateEditorNodePlacement(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  nodeId: ArchitectureNode["id"],
  targetParentId: ArchitectureNode["id"] | null,
  options: {
    readonly allowExistingGeneratedPlacement?: boolean;
  } = {},
): EditorPlacementValidation {
  if (!hasExactEditorCatalogBinding(document, catalog)) {
    return failure(
      "catalog-mismatch",
      "Boundary placement requires the document's exact bound catalog.",
    );
  }

  const node = nodeById(document, nodeId);
  if (node === undefined) {
    return failure("unknown-node", "The selected node no longer exists.");
  }
  const service = exactAvailableService(document, catalog, node);
  if (service === undefined) {
    return failure(
      "service-unavailable",
      "The selected node is not uniquely available in the exact bound catalog.",
    );
  }

  const currentParentId = node.semantic.parent?.nodeId ?? null;
  const mayRetainExistingGeneratedPlacement =
    options.allowExistingGeneratedPlacement === true &&
    currentParentId === targetParentId;
  if (
    currentParentId !== targetParentId &&
    node.semantic.lifecycle.ownership === "generated" &&
    !mayRetainExistingGeneratedPlacement
  ) {
    return failure(
      "generated-requires-adoption",
      "Generated nodes must be adopted before changing their boundary.",
    );
  }

  if (
    targetParentId !== null &&
    (targetParentId === nodeId ||
      isDescendantOf(document, targetParentId, nodeId))
  ) {
    return failure(
      "cycle",
      "A node cannot be placed inside itself or one of its descendants.",
    );
  }

  const placement = validateCatalogPlacementTarget(
    document,
    catalog,
    service,
    targetParentId,
    {
      ...(currentParentId === targetParentId &&
      node.semantic.parent?.relationshipType !== undefined
        ? {
            currentRelationshipType: node.semantic.parent.relationshipType,
          }
        : {}),
      requireVisualBoundary: true,
    },
  );
  if (!placement.success) {
    return failure(placement.code, placement.message);
  }

  const depthFailure = validateSubtreeDepths(
    document,
    catalog,
    nodeId,
    targetParentId,
  );
  if (depthFailure !== null) {
    return depthFailure;
  }

  return placement;
}

export function resolveServiceCreationAvailability(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  serviceId: string,
  options: ServiceCreationOptions = {},
): ServiceCreationAvailability {
  if (!hasExactEditorCatalogBinding(document, catalog)) {
    return {
      code: "catalog-mismatch",
      enabled: false,
      reason:
        "This document is not bound to the exact catalog shown in the sidebar.",
    };
  }

  const matches = catalog.services.filter(
    (candidate) => candidate.serviceType === serviceId,
  );
  if (matches.length !== 1) {
    return {
      code: "unknown-service",
      enabled: false,
      reason: "This service is not uniquely available in the bound catalog.",
    };
  }
  const service = matches[0];
  if (service?.supportState !== "available") {
    return {
      code: "service-unavailable",
      enabled: false,
      reason: "This catalog definition cannot be added by this editor.",
    };
  }
  if (!service.deployable) {
    return {
      code: "service-unavailable",
      enabled: false,
      reason:
        "This graph-backed configuration is created and managed under its owning resource.",
    };
  }
  const values =
    options.configurationValues ?? serviceCreationDefaults(document, service);
  const validation = service.configuration.validate(values);
  const regionProperty = service.configuration.documentRegionProperty;
  const regionValue =
    regionProperty === undefined ? undefined : values[regionProperty];
  if (
    !validation.success ||
    Object.entries(values).some(([key, value]) =>
      isCredentialLiteralProperty(key, value),
    ) ||
    (regionProperty !== undefined &&
      (regionValue?.kind !== "string" ||
        regionValue.value !== document.provider.region))
  ) {
    return {
      code: "configuration-unavailable",
      enabled: false,
      reason:
        "Enter the required service settings before adding it to your project.",
    };
  }

  const configurationValues = validation.values;
  if (options.parentNodeId !== undefined) {
    const placement = validateCatalogPlacementTarget(
      document,
      catalog,
      service,
      options.parentNodeId,
      { requireVisualBoundary: false },
    );
    return placement.success
      ? {
          enabled: true,
          service,
          parent: placement.parent,
          configurationValues,
        }
      : {
          enabled: false,
          code: "parent-unavailable",
          reason: placement.message,
        };
  }

  const rootPlacement = validateCatalogPlacementTarget(
    document,
    catalog,
    service,
    null,
    { requireVisualBoundary: false },
  );
  if (
    !rootPlacement.success &&
    rootPlacement.code === "provider-placement-unavailable"
  ) {
    return {
      code: "service-unavailable",
      enabled: false,
      reason:
        "This service uses provider-defined Region placement that this editor cannot evaluate safely.",
    };
  }
  if (service.placement.rootPlacement !== "forbidden") {
    if (!rootPlacement.success) {
      return {
        code: "service-unavailable",
        enabled: false,
        reason: rootPlacement.message,
      };
    }
    return { enabled: true, parent: null, service, configurationValues };
  }

  const placements: {
    readonly candidate: ArchitectureNode;
    readonly placement: Extract<
      CatalogPlacementTargetValidation,
      { readonly success: true }
    >;
  }[] = [];
  for (const candidate of document.nodes) {
    const placement = validateCatalogPlacementTarget(
      document,
      catalog,
      service,
      candidate.id,
      { requireVisualBoundary: false },
    );
    if (placement.success) {
      placements.push({ candidate, placement });
    }
  }
  placements.sort((left, right) =>
    compareText(left.candidate.id, right.candidate.id),
  );

  if (placements.length === 0) {
    const hasAmbiguousRelationship = document.nodes.some((candidate) => {
      const placement = validateCatalogPlacementTarget(
        document,
        catalog,
        service,
        candidate.id,
        { requireVisualBoundary: false },
      );
      return !placement.success && placement.code === "parent-ambiguous";
    });
    if (hasAmbiguousRelationship) {
      return {
        code: "parent-ambiguous",
        enabled: false,
        reason:
          "More than one valid relationship can place this service under the available parent. Relationship selection is required before this service can be added.",
      };
    }
    return {
      code: "parent-unavailable",
      enabled: false,
      reason:
        service.placement.allowedParents.length === 0
          ? "The catalog forbids root placement and declares no valid parent."
          : `Add a parent first: ${service.placement.allowedParents
              .map(
                (parent) =>
                  catalog.services.find(
                    (candidate) => candidate.serviceType === parent.serviceType,
                  )?.displayName ?? "Compatible resource",
              )
              .sort(compareText)
              .join(", ")}.`,
    };
  }
  if (placements.length > 1) {
    return {
      code: "parent-ambiguous",
      enabled: false,
      reason:
        "More than one valid parent exists. Parent selection is required before this service can be added.",
    };
  }

  const selectedPlacement = placements[0]?.placement;
  if (selectedPlacement?.parent === null || selectedPlacement === undefined) {
    return {
      code: "parent-unavailable",
      enabled: false,
      reason: "A valid catalog-declared parent is unavailable.",
    };
  }

  return {
    enabled: true,
    parent: selectedPlacement.parent,
    service,
    configurationValues,
  };
}

/** Choices are derived from the current graph, then checked again on submission. */
export function listServiceCreationParents(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  service: EditorCatalogService,
): readonly EditorPlacementOption[] {
  if (
    !hasExactEditorCatalogBinding(document, catalog) ||
    service.supportState !== "available" ||
    !service.deployable
  )
    return [];
  const candidates = [null, ...document.nodes.map((node) => node.id)];
  return candidates.flatMap((nodeId) => {
    const result = validateCatalogPlacementTarget(
      document,
      catalog,
      service,
      nodeId,
      { requireVisualBoundary: false },
    );
    if (!result.success) return [];
    const node = nodeId === null ? undefined : nodeById(document, nodeId);
    return [
      {
        label: node?.presentation.label ?? "Project root",
        parentNodeId: nodeId,
        relationshipType: result.parent?.relationshipType ?? null,
        technicalLabel: nodeId ?? "Architecture root",
      },
    ];
  });
}

export function listEditorNodePlacementOptions(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  nodeId: ArchitectureNode["id"],
): readonly EditorPlacementOption[] {
  const options: EditorPlacementOption[] = [];
  const root = validateEditorNodePlacement(document, catalog, nodeId, null);
  if (root.success) {
    options.push({
      label: "No boundary",
      parentNodeId: null,
      relationshipType: null,
      technicalLabel: "Architecture root",
    });
  }

  for (const candidate of [...document.nodes].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    if (candidate.id === nodeId) {
      continue;
    }
    const placement = validateEditorNodePlacement(
      document,
      catalog,
      nodeId,
      candidate.id,
    );
    if (!placement.success || placement.parent === null) {
      continue;
    }
    options.push({
      label: candidate.presentation.label,
      parentNodeId: candidate.id,
      relationshipType: placement.parent.relationshipType,
      technicalLabel: `${candidate.id} · ${placement.parent.relationshipType}`,
    });
  }

  return Object.freeze(options);
}

export function visualBoundaryParentId(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  node: ArchitectureNode,
): ArchitectureNode["id"] | null {
  const parentId = node.semantic.parent?.nodeId;
  if (parentId === undefined) {
    return null;
  }
  const placement = validateEditorNodePlacement(
    document,
    catalog,
    node.id,
    parentId,
    { allowExistingGeneratedPlacement: true },
  );
  return placement.success && placement.parent !== null
    ? placement.parent.nodeId
    : null;
}
