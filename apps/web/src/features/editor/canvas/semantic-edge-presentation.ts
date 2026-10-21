type CanvasElement = {
  readonly id: string;
  readonly kind: "edge" | "node";
} | null;

export interface SemanticEdgePresentationInput {
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly visualRole: "association" | "containment" | "relationship";
  readonly hoveredElement: CanvasElement;
  readonly selectedElement: CanvasElement;
  readonly validationEdgeId: string | null;
  readonly dockHighlighted: boolean;
}

/** Canvas-only disclosure: one relationship label at a time, with nested
 * boundaries carrying their own containment meaning. */
export function semanticEdgePresentation({
  edgeId,
  sourceNodeId,
  targetNodeId,
  visualRole,
  hoveredElement,
  selectedElement,
  validationEdgeId,
  dockHighlighted,
}: SemanticEdgePresentationInput): {
  readonly emphasizePath: boolean;
  readonly showLabel: boolean;
  readonly showMarker: boolean;
  readonly showPath: boolean;
} {
  const hoveredEdgeId =
    hoveredElement?.kind === "edge" ? hoveredElement.id : null;
  const selectedEdgeId =
    selectedElement?.kind === "edge" ? selectedElement.id : null;
  const inspectedEdgeId = hoveredEdgeId ?? selectedEdgeId ?? validationEdgeId;
  const showLabel = inspectedEdgeId === edgeId;
  const relatedNodeIsActive = [hoveredElement, selectedElement].some(
    (element) =>
      element?.kind === "node" &&
      (element.id === sourceNodeId || element.id === targetNodeId),
  );

  const emphasizePath =
    showLabel ||
    dockHighlighted ||
    validationEdgeId === edgeId ||
    (visualRole === "association" && relatedNodeIsActive);
  const showPath =
    visualRole !== "containment" ||
    showLabel ||
    dockHighlighted ||
    validationEdgeId === edgeId;

  return {
    emphasizePath,
    showLabel,
    showMarker: showPath && (visualRole !== "association" || emphasizePath),
    showPath,
  };
}
