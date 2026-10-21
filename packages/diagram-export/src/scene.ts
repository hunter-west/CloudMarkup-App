import {
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentHashes,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import type {
  ArchitectureDocumentV3,
  ArchitectureEdgeV1,
  ArchitectureNodeV1,
  ConfigurationValue,
  Sha256Digest,
} from "@cloudmarkup/schemas";
import type {
  ProviderCatalogArtifactV1,
  ProviderServiceDefinitionV1,
} from "@cloudmarkup/provider-sdk";

import {
  DIAGRAM_EXPORT_LIMITS,
  type DiagramExportRequestV1,
  type DiagramExportWarningV1,
} from "./contracts.js";
import {
  compareUtf16,
  digestBytes,
  iconInnerMarkup,
  sanitizeDiagramText,
  sanitizeProviderIconSvg,
  utf8Size,
} from "./security.js";

const NODE_WIDTH = 264;
const TECHNICAL_NODE_WIDTH = 304;
const NODE_BASE_HEIGHT = 112;
const LINE_HEIGHT = 18;
const ICON_SIZE = 48;
const MARGIN = 48;
const GRID_X = 344;
const GRID_Y = 184;

export interface DiagramSceneIconV1 {
  readonly innerMarkup: string;
  readonly viewBox: string;
}

export interface DiagramSceneNodeV1 {
  readonly configuration: readonly string[];
  readonly deploymentIdentifier?: string;
  readonly generated: boolean;
  readonly height: number;
  readonly icon: DiagramSceneIconV1 | null;
  readonly id: string;
  readonly internalId: string;
  readonly kind: "boundary" | "resource";
  readonly label: string;
  readonly parentInternalId: string | null;
  readonly serviceLabel: string;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface DiagramSceneEdgeV1 {
  readonly id: string;
  readonly internalId: string;
  readonly label: string;
  readonly relationshipType: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}

export interface DiagramSceneV1 {
  readonly architecture: {
    readonly canonicalHash: Sha256Digest;
    readonly contentHash: Sha256Digest;
    readonly visualHash: Sha256Digest;
  };
  readonly dimensions: {
    readonly height: number;
    readonly scale: number;
    readonly viewBoxHeight: number;
    readonly viewBoxWidth: number;
    readonly width: number;
  };
  readonly edges: readonly DiagramSceneEdgeV1[];
  readonly metadata: {
    readonly architectureTitle: string;
    readonly coverageState: string;
    readonly profile: "presentation" | "technical";
    readonly projectTitle: string;
    readonly provider: string;
    readonly region: string;
    readonly solutionRevisionId: string;
  };
  readonly nodes: readonly DiagramSceneNodeV1[];
  readonly sceneDigest: Sha256Digest;
  readonly warnings: readonly DiagramExportWarningV1[];
}

function warning(
  code: DiagramExportWarningV1["code"],
  message: string,
): DiagramExportWarningV1 {
  return { code, message };
}

function pushWarning(
  warnings: DiagramExportWarningV1[],
  candidate: DiagramExportWarningV1,
): void {
  if (!warnings.some((item) => item.code === candidate.code)) {
    warnings.push(candidate);
  }
}

function checkedLabel(
  value: string,
  warnings: DiagramExportWarningV1[],
): string {
  const result = sanitizeDiagramText(
    value,
    DIAGRAM_EXPORT_LIMITS.maxLabelLength,
  );
  if (result.truncated) {
    pushWarning(
      warnings,
      warning(
        "cloudmarkup.diagram.label-truncated",
        "One or more labels were truncated to the reviewed diagram limit.",
      ),
    );
  }
  return result.value;
}

function scalarConfigurationText(value: ConfigurationValue): string | null {
  switch (value.kind) {
    case "boolean":
    case "integer":
    case "number":
      return String(value.value);
    case "string":
      return value.value;
    case "number-list":
    case "string-list":
      return value.value.length <= 3 ? value.value.join(", ") : null;
    case "node-reference":
    case "secret-reference":
    case "variable-reference":
      return null;
  }
}

function configurationSummary(
  node: ArchitectureNodeV1,
  service: ProviderServiceDefinitionV1,
  maximum: number,
  warnings: DiagramExportWarningV1[],
): readonly string[] {
  const hints = [...service.configuration.uiHints]
    .filter(
      (hint) =>
        hint.valueSource === "literal" && hint.securityImpact === "none",
    )
    .sort((left, right) => {
      const order = left.order - right.order;
      return order === 0 ? compareUtf16(left.property, right.property) : order;
    });
  const summaries: string[] = [];
  for (const hint of hints) {
    const raw = node.semantic.configuration.values[hint.property];
    if (raw === undefined) {
      continue;
    }
    const value = scalarConfigurationText(raw);
    if (value === null || value.length === 0) {
      continue;
    }
    const label = checkedLabel(hint.label, warnings);
    const safeValue = checkedLabel(value, warnings);
    summaries.push(`${label}: ${safeValue}`);
    if (summaries.length === maximum) {
      break;
    }
  }
  return Object.freeze(summaries);
}

function serviceById(
  catalog: ProviderCatalogArtifactV1,
): ReadonlyMap<string, ProviderServiceDefinitionV1> {
  const services = new Map<string, ProviderServiceDefinitionV1>();
  for (const service of catalog.services) {
    const resourceType =
      service.nodeKind.kind === "resource"
        ? service.nodeKind.resourceType
        : service.nodeKind.boundaryType;
    if (services.has(resourceType)) {
      throw new TypeError(
        "Diagram catalog resource types must resolve to one exact service.",
      );
    }
    services.set(resourceType, service);
  }
  return services;
}

function absoluteSavedPosition(
  node: ArchitectureNodeV1,
  nodes: ReadonlyMap<string, ArchitectureNodeV1>,
  memo: Map<string, { readonly x: number; readonly y: number }>,
  visiting: Set<string>,
): { readonly x: number; readonly y: number } {
  const existing = memo.get(node.id);
  if (existing !== undefined) {
    return existing;
  }
  if (visiting.has(node.id)) {
    throw new TypeError(
      "Architecture parent relationships cannot form cycles.",
    );
  }
  visiting.add(node.id);
  const local = node.presentation.position;
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) {
    throw new TypeError("Saved diagram positions must be finite.");
  }
  const parentId = node.semantic.parent?.nodeId;
  const parent = parentId === undefined ? undefined : nodes.get(parentId);
  if (parentId !== undefined && parent === undefined) {
    throw new TypeError(
      "Diagram parent must reference an exact architecture node.",
    );
  }
  const parentPosition =
    parent === undefined
      ? { x: 0, y: 0 }
      : absoluteSavedPosition(parent, nodes, memo, visiting);
  const result = {
    x: parentPosition.x + local.x,
    y: parentPosition.y + local.y,
  };
  visiting.delete(node.id);
  memo.set(node.id, result);
  return result;
}

function deterministicPositions(
  document: ArchitectureDocumentV3,
): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  const incoming = new Map<string, number>(
    document.nodes.map((node) => [node.id, 0]),
  );
  const outgoing = new Map<string, string[]>();
  for (const edge of document.edges) {
    incoming.set(
      edge.semantic.target.nodeId,
      (incoming.get(edge.semantic.target.nodeId) ?? 0) + 1,
    );
    const targets = outgoing.get(edge.semantic.source.nodeId) ?? [];
    targets.push(edge.semantic.target.nodeId);
    outgoing.set(edge.semantic.source.nodeId, targets);
  }
  const queue: string[] = [...document.nodes]
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id)
    .sort(compareUtf16);
  const ranks = new Map<string, number>(
    document.nodes.map((node) => [node.id, 0]),
  );
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    const rank = ranks.get(current) ?? 0;
    const targets = [...(outgoing.get(current) ?? [])].sort(compareUtf16);
    for (const target of targets) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, rank + 1));
      const remaining = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) {
        queue.push(target);
        queue.sort(compareUtf16);
      }
    }
  }
  const byRank = new Map<number, ArchitectureNodeV1[]>();
  for (const node of document.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const values = byRank.get(rank) ?? [];
    values.push(node);
    byRank.set(rank, values);
  }
  const positions = new Map<
    string,
    { readonly x: number; readonly y: number }
  >();
  for (const [rank, nodes] of [...byRank.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    nodes.sort((left, right) => compareUtf16(left.id, right.id));
    nodes.forEach((node, index) => {
      positions.set(node.id, { x: rank * GRID_X, y: index * GRID_Y });
    });
  }
  return positions;
}

function humanizeRelationship(value: string): string {
  const last = value.split(".").at(-1) ?? value;
  return last
    .replaceAll("-", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function edgeLabel(
  edge: ArchitectureEdgeV1,
  request: DiagramExportRequestV1,
  warnings: DiagramExportWarningV1[],
): string {
  return checkedLabel(
    request.profile.kind === "technical"
      ? edge.semantic.relationshipType
      : humanizeRelationship(edge.semantic.relationshipType),
    warnings,
  );
}

function diagramScale(
  width: number,
  height: number,
  request: DiagramExportRequestV1,
): number {
  return Math.min(
    1,
    request.output.maxWidth / request.output.scale / width,
    request.output.maxHeight / request.output.scale / height,
  );
}

export function buildDiagramScene(
  request: DiagramExportRequestV1,
): DiagramSceneV1 {
  const document = request.architectureDocument;
  if (document.nodes.length > DIAGRAM_EXPORT_LIMITS.maxNodes) {
    throw new TypeError("Architecture exceeds the diagram node limit.");
  }
  if (document.edges.length > DIAGRAM_EXPORT_LIMITS.maxEdges) {
    throw new TypeError("Architecture exceeds the diagram edge limit.");
  }
  if (
    request.catalog.provider.id !== document.provider.id ||
    request.catalog.catalog.id !== document.catalog.id ||
    request.catalog.catalog.version !== document.catalog.version ||
    request.catalog.digest !== document.catalog.digest
  ) {
    throw new TypeError(
      "Diagram catalog must match the immutable Architecture Document exactly.",
    );
  }
  if (request.iconSet.assetSet.providerId !== document.provider.id) {
    throw new TypeError(
      "Diagram icon set must match the architecture provider.",
    );
  }

  const hashes = getArchitectureDocumentHashes(document);
  const canonicalHash = getArchitectureDocumentCanonicalHash(document);
  const revision = request.solutionRevision;
  if (
    revision.solutionRevisionId !==
      revision.generationCoverage.solutionRevisionId ||
    revision.architecture.revisionId !== document.revision.revisionId ||
    revision.architecture.contentHash !== hashes.contentHash ||
    revision.architecture.visualHash !== hashes.visualHash ||
    revision.architecture.documentHash !== canonicalHash ||
    revision.versions.catalog.id !== document.catalog.id ||
    revision.versions.catalog.version !== document.catalog.version ||
    revision.versions.catalog.digest !== document.catalog.digest
  ) {
    throw new TypeError(
      "Diagram inputs must bind one exact immutable Solution Revision and Architecture Document.",
    );
  }
  if (
    revision.versions.diagramRenderer.state !== "pinned" ||
    revision.versions.diagramRenderer.tool.id !== request.renderer.id ||
    revision.versions.diagramRenderer.tool.version !==
      request.renderer.version ||
    revision.versions.diagramRenderer.tool.digest !== request.renderer.digest
  ) {
    throw new TypeError(
      "Solution Revision must pin the exact selected diagram renderer.",
    );
  }

  const warnings: DiagramExportWarningV1[] = [];
  const catalogServices = serviceById(request.catalog);
  const icons = new Map(
    request.iconSet.icons.map((icon) => [icon.iconId, icon]),
  );
  const architectureNodes = new Map(
    document.nodes.map((node) => [node.id, node]),
  );
  const savedPositions = new Map<
    string,
    { readonly x: number; readonly y: number }
  >();
  if (request.layout.strategy === "saved-positions") {
    for (const node of document.nodes) {
      absoluteSavedPosition(node, architectureNodes, savedPositions, new Set());
    }
  }
  const rawPositions =
    request.layout.strategy === "saved-positions"
      ? savedPositions
      : deterministicPositions(document);

  const reduceDetail = document.nodes.length > 50;
  if (reduceDetail) {
    pushWarning(
      warnings,
      warning(
        "cloudmarkup.diagram.detail-reduced",
        "Configuration summaries were reduced to keep the large diagram readable; no nodes or edges were omitted.",
      ),
    );
  }
  const sortedNodes = [...document.nodes].sort((left, right) =>
    compareUtf16(left.id, right.id),
  );
  const nodeIdByInternalId = new Map(
    sortedNodes.map((node, index) => [
      node.id,
      `node-${String(index + 1).padStart(4, "0")}`,
    ]),
  );
  const sceneNodes = sortedNodes.map((node): DiagramSceneNodeV1 => {
    const service = catalogServices.get(node.semantic.resourceType);
    if (service === undefined) {
      throw new TypeError(
        "Every diagram node must resolve by exact resource type to one catalog service.",
      );
    }
    const rawPosition = rawPositions.get(node.id);
    if (rawPosition === undefined) {
      throw new TypeError(
        "Every diagram node must have one deterministic position.",
      );
    }
    const iconAsset =
      service.iconId === null ? undefined : icons.get(service.iconId);
    let icon: DiagramSceneIconV1 | null = null;
    if (service.iconId !== null && iconAsset === undefined) {
      pushWarning(
        warnings,
        warning(
          "cloudmarkup.diagram.icon-placeholder",
          "One or more catalog icons were unavailable; a deterministic neutral marker was used.",
        ),
      );
    }
    if (iconAsset !== undefined) {
      if (digestBytes(iconAsset.svg) !== iconAsset.normalizedSha256) {
        throw new TypeError(
          "Diagram icon bytes do not match their approved digest.",
        );
      }
      const sanitized = sanitizeProviderIconSvg(
        iconAsset.svg,
        iconAsset.viewBox,
      );
      icon = {
        innerMarkup: iconInnerMarkup(sanitized),
        viewBox: iconAsset.viewBox,
      };
    }
    const maximumSummaries = reduceDetail
      ? 0
      : request.profile.kind === "technical"
        ? 3
        : 1;
    const configuration = configurationSummary(
      node,
      service,
      maximumSummaries,
      warnings,
    );
    const deploymentIdentifier =
      request.profile.kind === "technical" &&
      request.profile.includeStableDeploymentIdentifiers
        ? checkedLabel(node.semantic.deploymentKey, warnings)
        : undefined;
    return {
      configuration,
      ...(deploymentIdentifier === undefined ? {} : { deploymentIdentifier }),
      generated: node.semantic.lifecycle.ownership === "generated",
      height:
        NODE_BASE_HEIGHT +
        configuration.length * LINE_HEIGHT +
        (deploymentIdentifier === undefined ? 0 : LINE_HEIGHT),
      icon,
      id: nodeIdByInternalId.get(node.id) ?? "node-unresolved",
      internalId: node.id,
      kind: service.nodeKind.kind,
      label: checkedLabel(node.presentation.label, warnings),
      parentInternalId: node.semantic.parent?.nodeId ?? null,
      serviceLabel: checkedLabel(service.displayName, warnings),
      width:
        request.profile.kind === "technical"
          ? TECHNICAL_NODE_WIDTH
          : NODE_WIDTH,
      x: rawPosition.x,
      y: rawPosition.y,
    };
  });

  const minimumX =
    sceneNodes.length === 0 ? 0 : Math.min(...sceneNodes.map((node) => node.x));
  const minimumY =
    sceneNodes.length === 0 ? 0 : Math.min(...sceneNodes.map((node) => node.y));
  const normalizedNodes = sceneNodes.map((node) => ({
    ...node,
    x: Math.round(node.x - minimumX + MARGIN),
    y: Math.round(node.y - minimumY + MARGIN + 112),
  }));
  const rawWidth = Math.max(
    DIAGRAM_EXPORT_LIMITS.minWidth,
    Math.ceil(
      Math.max(...normalizedNodes.map((node) => node.x + node.width), 0) +
        MARGIN,
    ),
  );
  const rawHeight = Math.max(
    DIAGRAM_EXPORT_LIMITS.minHeight,
    Math.ceil(
      Math.max(...normalizedNodes.map((node) => node.y + node.height), 0) +
        MARGIN +
        72,
    ),
  );
  const scale = diagramScale(rawWidth, rawHeight, request);
  if (scale < 1) {
    pushWarning(
      warnings,
      warning(
        "cloudmarkup.diagram.fit-scaled",
        "The diagram was uniformly scaled to fit the approved output dimensions.",
      ),
    );
  }
  if (14 * scale < DIAGRAM_EXPORT_LIMITS.minReadableLabelPixels) {
    pushWarning(
      warnings,
      warning(
        "cloudmarkup.diagram.minimum-label-scale",
        "The fitted diagram is below the preferred label scale; use SVG zoom for full detail.",
      ),
    );
  }
  const width = Math.max(
    DIAGRAM_EXPORT_LIMITS.minWidth,
    Math.min(request.output.maxWidth, Math.ceil(rawWidth * scale)),
  );
  const height = Math.max(
    DIAGRAM_EXPORT_LIMITS.minHeight,
    Math.min(request.output.maxHeight, Math.ceil(rawHeight * scale)),
  );

  const sortedEdges = [...document.edges].sort((left, right) =>
    compareUtf16(left.id, right.id),
  );
  const edges = sortedEdges.map((edge, index): DiagramSceneEdgeV1 => {
    const sourceNodeId = nodeIdByInternalId.get(edge.semantic.source.nodeId);
    const targetNodeId = nodeIdByInternalId.get(edge.semantic.target.nodeId);
    if (sourceNodeId === undefined || targetNodeId === undefined) {
      throw new TypeError(
        "Every diagram edge must reference exact rendered nodes.",
      );
    }
    return {
      id: `edge-${String(index + 1).padStart(4, "0")}`,
      internalId: edge.id,
      label: edgeLabel(edge, request, warnings),
      relationshipType: edge.semantic.relationshipType,
      sourceNodeId,
      targetNodeId,
    };
  });
  const metadata = {
    architectureTitle: checkedLabel(
      request.profile.architectureTitle,
      warnings,
    ),
    coverageState: revision.generationCoverage.state,
    profile: request.profile.kind,
    projectTitle: checkedLabel(request.profile.projectTitle, warnings),
    provider: checkedLabel(request.catalog.provider.displayName, warnings),
    region: checkedLabel(document.provider.region, warnings),
    solutionRevisionId: revision.solutionRevisionId,
  } as const;
  const sceneProjection = {
    architecture: { canonicalHash, ...hashes },
    dimensions: {
      height,
      scale,
      viewBoxHeight: rawHeight,
      viewBoxWidth: rawWidth,
      width,
    },
    edges,
    metadata,
    nodes: normalizedNodes,
  };
  const sceneDigest = hashCanonicalValue(sceneProjection);
  const orderedWarnings = warnings.sort((left, right) =>
    compareUtf16(left.code, right.code),
  );
  if (
    utf8Size(JSON.stringify(sceneProjection)) >
    DIAGRAM_EXPORT_LIMITS.maxSvgBytes
  ) {
    throw new TypeError(
      "Diagram scene exceeds the approved serialization budget.",
    );
  }
  return Object.freeze({
    ...sceneProjection,
    sceneDigest,
    warnings: Object.freeze(orderedWarnings),
  });
}

export const DIAGRAM_SCENE_ICON_SIZE = ICON_SIZE;
