import {
  boundaryOverviewAtZoom,
  boundaryOverviewTile,
  compactServiceTile,
} from "./compact-service-tile.js";
import { useThemePreference } from "../../../preferences/theme-preference.js";
import { Button, EmptyState, StatusBadge } from "@cloudmarkup/ui";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  getViewportForBounds,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type MiniMapNodeProps,
  type NodeChange,
  type NodeTypes,
  type FitViewOptions,
  type ReactFlowInstance,
  type ReactFlowProps,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { useWorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import { DevelopmentFixtureStatus } from "../DevelopmentFixtureStatus.js";
import {
  absoluteEditorNodePosition,
  createArchitectureFlowProjection,
  deepestBoundaryAtPosition,
  readServiceCatalogDragPayload,
  relativeEditorPosition,
  RESOURCE_NODE_HEIGHT,
  RESOURCE_NODE_WIDTH,
  SERVICE_CATALOG_DRAG_MIME,
  visualBoundaryParentId,
  type ArchitectureFlowEdge,
  type ArchitectureFlowNode,
  type ArchitectureFlowModel,
} from "../model/index.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../session/editor-session-hooks.js";
import type { EditorDocumentSession } from "../session/editor-session-context.js";
import { AutomaticLayoutDialog } from "./AutomaticLayoutDialog.js";
import {
  BoundaryNode,
  FallbackNode,
  ResourceNode,
} from "./ArchitectureNodes.js";
import { SemanticEdge } from "./SemanticEdge.js";

const SNAP_GRID: [number, number] = [8, 8];
// Drawing density is independent of movement snapping and saved coordinates.
const VISIBLE_GRID_SIZE = 48;
const FLOW_ARIA_LABELS = {
  "controls.ariaLabel": "Canvas zoom controls",
  "controls.fitView.ariaLabel": "Fit architecture in view",
  "controls.interactive.ariaLabel": "Toggle canvas interactivity",
  "controls.zoomIn.ariaLabel": "Zoom in",
  "controls.zoomOut.ariaLabel": "Zoom out",
  "edge.a11yDescription.default":
    "Press Enter or Space to select this relationship.",
  "handle.ariaLabel": "Typed architecture port",
  "minimap.ariaLabel":
    "Architecture overview. This minimap is non-interactive.",
  "node.a11yDescription.default":
    "Press Enter or Space to select, C to connect, or use arrow keys to request movement through boundary placement validation and the command engine.",
  "node.a11yDescription.keyboardDisabled":
    "This element is selectable but cannot be moved in this view.",
} satisfies NonNullable<
  ReactFlowProps<ArchitectureFlowNode, ArchitectureFlowEdge>["ariaLabelConfig"]
>;

const NODE_TYPES = {
  boundary: BoundaryNode,
  fallback: FallbackNode,
  resource: ResourceNode,
} satisfies NodeTypes;

const EDGE_TYPES = {
  semantic: SemanticEdge,
} satisfies EdgeTypes;

export interface ArchitectureCanvasViewRequest {
  readonly id: number;
  readonly target: "architecture" | "selection";
}

interface ArchitectureCanvasProps {
  readonly fixtureMode: boolean;
  readonly guidedWalkthrough?: ReactNode | undefined;
  readonly posture: "desktop" | "tablet";
  readonly viewRequest?: ArchitectureCanvasViewRequest | undefined;
}

const canvasOverlayGap = 12;
const canvasControlsMaximumHeight = 134;
const miniMapHeight = 104;
// React Flow centers each line in its cell and subtracts offset; use a positive
// offset (zero selects its fallback) to align the opening lines with CSS pixels.
function openingGridOffset(position: number, zoom: number) {
  const offset = VISIBLE_GRID_SIZE / 2 - 0.5;
  return (
    ((((position + offset) % VISIBLE_GRID_SIZE) + VISIBLE_GRID_SIZE) %
      VISIBLE_GRID_SIZE || VISIBLE_GRID_SIZE) / zoom
  );
}

const miniMapWidth = 152;

const compactServiceNodeSize = Object.freeze({
  height: RESOURCE_NODE_HEIGHT,
  width: RESOURCE_NODE_WIDTH,
});

function compactBoundaryNodeSize(zoom: number, overview = false) {
  const safeZoom = Math.max(zoom, Number.EPSILON);
  if (overview) {
    const tile = boundaryOverviewTile(zoom);
    return { height: Math.round(tile.height), width: Math.round(tile.width) };
  }
  const readableScale = Math.min(3, Math.max(1, 1 / safeZoom));
  return {
    height: Math.round(96 * readableScale),
    width: Math.round(288 * readableScale),
  };
}

function px(value: number): `${number}px` {
  return `${String(value)}px` as `${number}px`;
}

function ArchitectureMiniMapNode({
  borderRadius,
  className,
  color,
  height,
  id,
  selected,
  strokeColor,
  strokeWidth,
  width,
  x,
  y,
}: MiniMapNodeProps) {
  return (
    <rect
      className={className}
      data-minimap-node-id={id}
      data-selected={selected ? "true" : "false"}
      height={height}
      rx={borderRadius}
      ry={borderRadius}
      style={{
        fill: color ?? "var(--cm-color-action-subtle)",
        stroke: strokeColor ?? "var(--cm-color-action)",
        strokeWidth,
      }}
      width={width}
      x={x}
      y={y}
    />
  );
}

function miniMapNodeClassName(node: ArchitectureFlowNode): string {
  return [
    "architecture-minimap-node",
    `architecture-minimap-node--${node.data.support.kind}`,
    `architecture-minimap-node--${node.type}`,
    ...(node.data.boundaryLevel === null
      ? []
      : [`architecture-minimap-node--boundary-${node.data.boundaryLevel}`]),
  ].join(" ");
}

function miniMapNodeColor(node: ArchitectureFlowNode): string {
  if (node.data.support.kind !== "available") {
    return "var(--cm-color-status-warning-surface)";
  }
  switch (node.data.boundaryLevel) {
    case "outer":
      return "var(--cm-color-status-info-surface)";
    case "primary":
      return "var(--cm-color-status-success-surface)";
    case "secondary":
      return "var(--cm-color-status-warning-surface)";
    case "tertiary":
      return "var(--cm-color-boundary-surface)";
    case null:
      return "var(--cm-color-action-subtle)";
  }
}

function miniMapNodeStrokeColor(node: ArchitectureFlowNode): string {
  if (node.data.support.kind !== "available") {
    return "var(--cm-color-status-warning)";
  }
  switch (node.data.boundaryLevel) {
    case "outer":
      return "var(--cm-color-status-info)";
    case "primary":
      return "var(--cm-color-status-success)";
    case "secondary":
      return "var(--cm-color-status-warning)";
    case "tertiary":
      return "var(--cm-color-boundary-border)";
    case null:
      return "var(--cm-color-action)";
  }
}

function withTransientState(
  model: ArchitectureFlowModel,
  selection: { readonly id: string; readonly kind: "node" | "edge" } | null,
  nodesAreDraggable: boolean,
  collapsedBoundaryIds: ReadonlySet<string>,
  zoom: number,
): {
  readonly edges: ArchitectureFlowEdge[];
  readonly nodes: ArchitectureFlowNode[];
} {
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const boundaryOverview = (node: ArchitectureFlowNode) =>
    node.type === "boundary" &&
    boundaryOverviewAtZoom(node.data.boundaryLevel, zoom);
  const hiddenNodeIds = new Set<string>();
  for (const node of model.nodes) {
    const seen = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId !== undefined) {
      const parent = nodesById.get(parentId);
      if (
        collapsedBoundaryIds.has(parentId) ||
        (parent !== undefined && boundaryOverview(parent)) ||
        seen.has(parentId)
      ) {
        hiddenNodeIds.add(node.id);
        break;
      }
      seen.add(parentId);
      parentId = parent?.parentId;
    }
  }
  const visibleNodeIds = new Set(
    model.nodes
      .filter((node) => !hiddenNodeIds.has(node.id))
      .map((node) => node.id),
  );

  return {
    nodes: model.nodes
      .filter((node) => !hiddenNodeIds.has(node.id))
      .map((node) => {
        const compact = node.type !== "boundary";
        const collapsedBoundary =
          node.type === "boundary" &&
          (collapsedBoundaryIds.has(node.id) || boundaryOverview(node));
        const displaySize = collapsedBoundary
          ? compactBoundaryNodeSize(zoom, boundaryOverview(node))
          : compact
            ? compactServiceNodeSize
            : null;
        return {
          ...node,
          selected: selection?.kind === "node" && selection.id === node.id,
          draggable: nodesAreDraggable && node.draggable === true,
          ...(displaySize === null
            ? node.style === undefined
              ? {}
              : { style: node.style }
            : {
                height: displaySize.height,
                width: displaySize.width,
                style: {
                  ...node.style,
                  height: displaySize.height,
                  width: displaySize.width,
                },
              }),
        };
      }),
    edges: model.edges
      .filter(
        (edge) =>
          visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
      )
      .map((edge) => ({
        ...edge,
        selected: selection?.kind === "edge" && selection.id === edge.id,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color:
            selection?.kind === "edge" && selection.id === edge.id
              ? "var(--cm-color-edge-selected)"
              : edge.data?.visualRole === "association"
                ? "var(--cm-color-action-hover)"
                : edge.data?.visualRole === "containment"
                  ? "var(--cm-color-boundary-border)"
                  : "var(--cm-color-edge)",
        },
      })),
  };
}

function shallowProjectionEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => {
      if (Object.is(left[key], right[key])) return true;
      if (key !== "style" && key !== "markerEnd" && key !== "position")
        return false;
      const a = left[key];
      const b = right[key];
      if (
        typeof a !== "object" ||
        a === null ||
        typeof b !== "object" ||
        b === null
      )
        return false;
      const aRecord = a as Record<string, unknown>;
      const bRecord = b as Record<string, unknown>;
      const fields = Object.keys(aRecord);
      return (
        fields.length === Object.keys(bRecord).length &&
        fields.every((field) => Object.is(aRecord[field], bRecord[field]))
      );
    })
  );
}

/** Bounded by the current mounted document; keeps unchanged Flow elements stable. */
function createTransientProjector(model: ArchitectureFlowModel) {
  let previousNodes = new Map(model.nodes.map((node) => [node.id, node]));
  let previousEdges = new Map(model.edges.map((edge) => [edge.id, edge]));
  return (...input: Parameters<typeof withTransientState>) => {
    const projected = withTransientState(...input);
    const nodes = projected.nodes.map((node) => {
      const previous = previousNodes.get(node.id);
      return previous !== undefined && shallowProjectionEqual(node, previous)
        ? previous
        : node;
    });
    const edges = projected.edges.map((edge) => {
      const previous = previousEdges.get(edge.id);
      return previous !== undefined && shallowProjectionEqual(edge, previous)
        ? previous
        : edge;
    });
    previousNodes = new Map(nodes.map((node) => [node.id, node]));
    previousEdges = new Map(edges.map((edge) => [edge.id, edge]));
    return { nodes, edges };
  };
}

function ControlledArchitectureFlow(
  props: Omit<
    ReactFlowProps<ArchitectureFlowNode, ArchitectureFlowEdge>,
    "viewport" | "onViewportChange"
  >,
) {
  const store = useEditorSessionStoreApi();
  const viewport = useEditorSessionState((state) => state.viewport);
  const onViewportChange = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      store.getState().setViewport(viewport);
    },
    [store],
  );
  return (
    <ReactFlow
      {...props}
      viewport={viewport}
      onViewportChange={onViewportChange}
    />
  );
}

export function ArchitectureCanvas({
  fixtureMode,
  guidedWalkthrough,
  posture,
  viewRequest,
}: ArchitectureCanvasProps) {
  const session = useEditorDocumentSession();

  if (session.status !== "ready") {
    return null;
  }

  return (
    <ReadyArchitectureCanvas
      fixtureMode={fixtureMode}
      guidedWalkthrough={guidedWalkthrough}
      posture={posture}
      session={session}
      viewRequest={viewRequest}
    />
  );
}

function ReadyArchitectureCanvas({
  fixtureMode,
  guidedWalkthrough,
  posture,
  session,
  viewRequest,
}: ArchitectureCanvasProps & {
  readonly session: Extract<EditorDocumentSession, { status: "ready" }>;
}) {
  const store = useEditorSessionStoreApi();
  const selection = useEditorSessionState((state) => state.selection);
  const zoom = useEditorSessionState((state) => state.viewport.zoom);
  const previewPositions = useEditorSessionState(
    (state) => state.previewPositions,
  );
  const canvasNotice = useEditorSessionState((state) => state.canvasNotice);
  const collapsedBoundaryIds = useEditorSessionState(
    (state) => state.collapsedBoundaryIds,
  );
  const workspaceShell = useWorkspaceShellController();
  const catalogPanelOpen = workspaceShell?.overlays.catalog.open ?? false;
  const inspectorPanelOpen = workspaceShell?.overlays.inspector.open ?? false;
  const shellSafeArea = workspaceShell?.overlays.safeArea ?? {
    bottom: 0,
    left: 0,
    right: 0,
  };
  const [initialGrid, setInitialGrid] = useState({ zoom: 1, x: 0, y: 0 });
  const [topOverlayInset, setTopOverlayInset] = useState(64);
  const architectureWorkspaceRef = useRef<HTMLDivElement>(null);
  const topStackRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useThemePreference();
  const flowInstance = useRef<ReactFlowInstance<
    ArchitectureFlowNode,
    ArchitectureFlowEdge
  > | null>(null);
  const pointerDragNodeId = useRef<string | null>(null);
  const fitViewOptions = useMemo(
    () =>
      ({
        duration: 0,
        padding: {
          bottom: px(
            shellSafeArea.bottom +
              Math.max(miniMapHeight, canvasControlsMaximumHeight) +
              canvasOverlayGap,
          ),
          left: px(shellSafeArea.left + canvasOverlayGap),
          right: px(shellSafeArea.right + miniMapWidth + canvasOverlayGap * 2),
          top: px(topOverlayInset),
        },
      }) satisfies FitViewOptions<ArchitectureFlowNode>,
    [
      shellSafeArea.bottom,
      shellSafeArea.left,
      shellSafeArea.right,
      topOverlayInset,
    ],
  );
  const canvasStyle = useMemo(
    () =>
      ({
        "--architecture-safe-bottom": px(
          shellSafeArea.bottom + canvasOverlayGap,
        ),
        "--architecture-safe-left": px(shellSafeArea.left + canvasOverlayGap),
        "--architecture-safe-right": px(shellSafeArea.right + canvasOverlayGap),
        "--architecture-safe-top": px(topOverlayInset),
        "--architecture-top-safe-left": px(
          catalogPanelOpen ? shellSafeArea.left + canvasOverlayGap : 148,
        ),
        "--architecture-top-safe-right": px(
          inspectorPanelOpen ? shellSafeArea.right + canvasOverlayGap : 148,
        ),
      }) as CSSProperties,
    [
      catalogPanelOpen,
      inspectorPanelOpen,
      shellSafeArea.bottom,
      shellSafeArea.left,
      shellSafeArea.right,
      topOverlayInset,
    ],
  );
  const measureTopOverlay = useCallback(() => {
    const workspace = architectureWorkspaceRef.current;
    const topStack = topStackRef.current;
    if (workspace === null || topStack === null) {
      return;
    }

    const workspaceBounds = workspace.getBoundingClientRect();
    const topStackBounds = topStack.getBoundingClientRect();
    const measuredInset = Math.ceil(
      topStackBounds.bottom - workspaceBounds.top + canvasOverlayGap,
    );
    setTopOverlayInset((current) =>
      current === measuredInset ? current : measuredInset,
    );
  }, []);

  const projection = useMemo(
    () => createArchitectureFlowProjection(session.document, session.catalog),
    [session.catalog, session.document],
  );
  const model = useMemo(
    () => projection.projectPositions(previewPositions),
    [previewPositions, projection],
  );
  const geometryOverflow = model.geometryOverflows[0] ?? null;
  const projectTransient = useMemo(
    () => createTransientProjector(projection.model),
    [projection],
  );
  const projected = useMemo(
    () =>
      projectTransient(
        model,
        selection,
        posture === "desktop",
        collapsedBoundaryIds,
        zoom,
      ),
    [collapsedBoundaryIds, model, posture, projectTransient, selection, zoom],
  );

  const handledViewRequest = useRef(0);
  const fitNodes = useCallback(
    (nodes: ArchitectureFlowNode[]) => {
      const instance = flowInstance.current;
      const flow = architectureWorkspaceRef.current?.querySelector<HTMLElement>(
        ".architecture-canvas__flow",
      );
      if (instance === null || flow == null || nodes.length === 0) return;
      // This canvas controls its viewport through the editor session. React Flow's
      // queued fitView node update does not move that controlled viewport.
      const bounds = instance.getNodesBounds(nodes);
      const viewportFor = (fittedBounds: typeof bounds) =>
        getViewportForBounds(
          fittedBounds,
          flow.clientWidth,
          flow.clientHeight,
          0.05,
          2,
          fitViewOptions.padding,
        );
      let viewport = viewportFor(bounds);
      if (nodes.some((node) => node.type !== "boundary")) {
        // At overview zoom the readable tile can extend beyond its semantic
        // 160px node box. Include that visual overhang in the fitted bounds.
        for (let pass = 0; pass < 3 && viewport.zoom < 0.7; pass += 1) {
          const overhang = Math.max(
            0,
            (compactServiceTile(viewport.zoom).width - RESOURCE_NODE_WIDTH) / 2,
          );
          if (overhang === 0) break;
          viewport = viewportFor({
            ...bounds,
            x: bounds.x - overhang,
            width: bounds.width + overhang * 2,
          });
        }
      }
      store.getState().setViewport(viewport);
    },
    [fitViewOptions.padding, store],
  );
  const fitSelection = useCallback(() => {
    const instance = flowInstance.current;
    if (instance === null || selection === null) {
      store.getState().announce("Select a resource or relationship to fit.");
      return;
    }

    const nodeIds =
      selection.kind === "node"
        ? [selection.id]
        : (() => {
            const edge = projected.edges.find(
              (candidate) => candidate.id === selection.id,
            );
            return edge === undefined ? [] : [edge.source, edge.target];
          })();
    const nodes = nodeIds.flatMap((nodeId) => {
      const node = instance.getNode(nodeId);
      return node === undefined ? [] : [node];
    });
    if (nodes.length === 0) {
      store
        .getState()
        .announce("The selected element is not visible in the current canvas.");
      return;
    }

    fitNodes(nodes);
  }, [fitNodes, projected.edges, selection, store]);

  useEffect(() => {
    if (
      viewRequest === undefined ||
      handledViewRequest.current === viewRequest.id
    ) {
      return;
    }
    handledViewRequest.current = viewRequest.id;
    if (viewRequest.target === "selection") {
      fitSelection();
    } else {
      fitNodes(flowInstance.current?.getNodes() ?? []);
    }
  }, [fitNodes, fitSelection, viewRequest]);

  useLayoutEffect(() => {
    const topStack = topStackRef.current;
    if (topStack === null) {
      return undefined;
    }

    measureTopOverlay();
    const observer = new ResizeObserver(measureTopOverlay);
    observer.observe(topStack);
    window.addEventListener("resize", measureTopOverlay);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureTopOverlay);
    };
  }, [measureTopOverlay]);

  const commitPosition = useCallback(
    function commitPosition(
      nodeId: string,
      position: { readonly x: number; readonly y: number },
    ): void {
      const current = session.document.nodes.find((node) => node.id === nodeId);
      if (
        current === undefined ||
        (current.presentation.position.x === position.x &&
          current.presentation.position.y === position.y)
      ) {
        store.getState().clearNodePositionPreview(nodeId);
        return;
      }

      session.moveNode(nodeId, position);
    },
    [session, store],
  );

  const setValidatedPositionPreview = useCallback(
    function setValidatedPositionPreview(
      nodeId: string,
      position: { readonly x: number; readonly y: number },
    ): void {
      const previewPositions = new Map(store.getState().previewPositions);
      previewPositions.set(nodeId, position);
      try {
        projection.validatePositions(previewPositions);
        store.getState().setNodePositionPreview(nodeId, position);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The requested position is outside the supported canvas range.";
        const current = session.document.nodes.find(
          (candidate) => candidate.id === nodeId,
        );
        if (current === undefined) {
          store.getState().clearNodePositionPreview(nodeId);
        } else {
          store
            .getState()
            .setNodePositionPreview(nodeId, current.presentation.position);
        }
        store.getState().setCanvasNotice({ message, tone: "error" });
        store.getState().announce(message);
      }
    },
    [projection, session.document, store],
  );

  const handleNodeChanges = useCallback(
    function handleNodeChanges(
      changes: readonly NodeChange<ArchitectureFlowNode>[],
    ): void {
      for (const change of changes) {
        if (change.type === "select") {
          const currentSelection = store.getState().selection;
          if (change.selected) {
            store.getState().setSelection({ id: change.id, kind: "node" });
          } else if (
            currentSelection?.kind === "node" &&
            currentSelection.id === change.id
          ) {
            store.getState().setSelection(null);
          }
          continue;
        }

        if (change.type !== "position" || change.position === undefined) {
          continue;
        }

        if (change.dragging === true) {
          setValidatedPositionPreview(change.id, change.position);
        } else if (pointerDragNodeId.current === change.id) {
          setValidatedPositionPreview(change.id, change.position);
        } else {
          commitPosition(change.id, change.position);
        }
      }
    },
    [commitPosition, setValidatedPositionPreview, store],
  );

  const handleEdgeChanges = useCallback(
    function handleEdgeChanges(
      changes: readonly EdgeChange<ArchitectureFlowEdge>[],
    ): void {
      for (const change of changes) {
        if (change.type !== "select") {
          continue;
        }
        const currentSelection = store.getState().selection;
        if (change.selected) {
          store.getState().setSelection({ id: change.id, kind: "edge" });
        } else if (
          currentSelection?.kind === "edge" &&
          currentSelection.id === change.id
        ) {
          store.getState().setSelection(null);
        }
      }
    },
    [store],
  );

  const nodesAreDraggable = posture === "desktop";

  const handleCanvasKeyDown = useCallback(
    function handleCanvasKeyDown(
      event: ReactKeyboardEvent<HTMLDivElement>,
    ): void {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "c" ||
        session.connectionWorkflow.open ||
        selection?.kind !== "node"
      ) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".nokey, button, a, input, select, textarea, summary, [role='button']",
        ) !== null
      ) {
        return;
      }
      const focusedNode = (event.target as HTMLElement).closest<HTMLElement>(
        ".react-flow__node[data-id]",
      );
      if (focusedNode?.dataset["id"] !== selection.id) {
        return;
      }
      event.preventDefault();
      session.beginConnection({ kind: "node", nodeId: selection.id });
    },
    [selection, session],
  );

  const handleConnect = useCallback(
    function handleConnect(connection: Connection): void {
      if (
        connection.sourceHandle === null ||
        connection.targetHandle === null
      ) {
        store
          .getState()
          .announce(
            "Both exact typed ports are required. The architecture was not changed.",
          );
        return;
      }
      if (
        [connection.sourceHandle, connection.targetHandle].some(
          (handle) =>
            handle.startsWith("dock:") || handle.startsWith("connect:"),
        )
      ) {
        session.beginConnection({
          kind: "node-pair",
          sourceNodeId: connection.source,
          targetNodeId: connection.target,
        });
        return;
      }
      session.beginConnection({
        kind: "endpoints",
        source: {
          nodeId: connection.source,
          portId: connection.sourceHandle,
        },
        target: {
          nodeId: connection.target,
          portId: connection.targetHandle,
        },
      });
    },
    [session, store],
  );

  const handleCanvasDragOver = useCallback(function handleCanvasDragOver(
    event: ReactDragEvent<HTMLDivElement>,
  ): void {
    if (
      !Array.from(event.dataTransfer.types).includes(SERVICE_CATALOG_DRAG_MIME)
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleCanvasDrop = useCallback(
    function handleCanvasDrop(event: ReactDragEvent<HTMLDivElement>): void {
      event.preventDefault();
      const serviceId = readServiceCatalogDragPayload(event.dataTransfer);
      if (serviceId === null) {
        store
          .getState()
          .announce("The dropped catalog item was invalid. Nothing was added.");
        return;
      }
      const projectedPosition = flowInstance.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const dropPosition =
        projectedPosition !== undefined &&
        Number.isFinite(projectedPosition.x) &&
        Number.isFinite(projectedPosition.y)
          ? projectedPosition
          : undefined;
      session.addService(serviceId, dropPosition);
    },
    [session, store],
  );

  const handleNodeDragStop = useCallback(
    function handleNodeDragStop(nodeId: string): void {
      pointerDragNodeId.current = null;
      const node = session.document.nodes.find(
        (candidate) => candidate.id === nodeId,
      );
      if (node === undefined) {
        store.getState().clearNodePositionPreview(nodeId);
        return;
      }

      try {
        const internalPosition =
          flowInstance.current?.getInternalNode(nodeId)?.internals
            .positionAbsolute;
        const absolutePosition =
          internalPosition === undefined
            ? absoluteEditorNodePosition(
                session.document,
                session.catalog,
                node.id,
                store.getState().previewPositions,
              )
            : {
                x: internalPosition.x,
                y: internalPosition.y,
              };
        const targetParentNodeId = deepestBoundaryAtPosition(
          session.document,
          session.catalog,
          node.id,
          absolutePosition,
          store.getState().previewPositions,
        );
        const currentVisualParentNodeId = visualBoundaryParentId(
          session.document,
          session.catalog,
          node,
        );
        if (targetParentNodeId === currentVisualParentNodeId) {
          session.moveNode(
            node.id,
            relativeEditorPosition(
              session.document,
              session.catalog,
              absolutePosition,
              currentVisualParentNodeId,
            ),
          );
        } else {
          session.placeNode(node.id, targetParentNodeId, absolutePosition);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The requested boundary placement is invalid.";
        store.getState().clearNodePositionPreview(nodeId);
        store.getState().setCanvasNotice({ message, tone: "error" });
        store.getState().announce(message);
      }
    },
    [session, store],
  );

  const flowEvents = useMemo<
    Pick<
      ReactFlowProps<ArchitectureFlowNode, ArchitectureFlowEdge>,
      | "onEdgeClick"
      | "onEdgeMouseEnter"
      | "onEdgeMouseLeave"
      | "onInit"
      | "onNodeClick"
      | "onNodeDoubleClick"
      | "onNodeDragStart"
      | "onNodeDragStop"
      | "onNodeMouseEnter"
      | "onNodeMouseLeave"
      | "onPaneClick"
    >
  >(
    () => ({
      onEdgeClick: (_event, edge) => {
        store.getState().setSelection({ id: edge.id, kind: "edge" });
        store
          .getState()
          .announce(`${edge.data?.label ?? "Relationship"} selected.`);
      },
      onEdgeMouseEnter: (_event, edge) => {
        store.getState().setHoveredElement({ id: edge.id, kind: "edge" });
      },
      onEdgeMouseLeave: () => {
        store.getState().setHoveredElement(null);
      },
      onInit: (instance) => {
        flowInstance.current = instance;
        void instance.fitView(fitViewOptions).then(() => {
          const initial = instance.getViewport();
          setInitialGrid(initial);
        });
      },
      onNodeClick: (_event, node) => {
        store.getState().setSelection({ id: node.id, kind: "node" });
        store.getState().announce(`${node.data.label} selected.`);
      },
      onNodeDoubleClick: (event, node) => {
        if (
          node.type === "boundary" ||
          (event.target instanceof Element &&
            event.target
              .closest(
                "button, a, input, select, textarea, summary, [role='button']",
              )
              ?.closest(".architecture-node") != null)
        ) {
          return;
        }
        store.getState().setSelection({ id: node.id, kind: "node" });
        store.getState().setActiveConnectionDock(null);
        const expanded = !store.getState().expandedServiceNodeIds.has(node.id);
        store.getState().setServiceNodeExpanded(node.id, expanded);
        store
          .getState()
          .announce(
            `${node.data.label} ${expanded ? "expanded" : "collapsed"} on the canvas.`,
          );
      },
      onNodeDragStart: (_event, node) => {
        pointerDragNodeId.current = node.id;
        store.getState().setCanvasNotice(null);
      },
      onNodeDragStop: (_event, node) => {
        handleNodeDragStop(node.id);
      },
      onNodeMouseEnter: (_event, node) => {
        store.getState().setHoveredElement({ id: node.id, kind: "node" });
      },
      onNodeMouseLeave: () => {
        store.getState().setHoveredElement(null);
      },
      onPaneClick: () => {
        store.getState().setSelection(null);
      },
    }),
    [fitViewOptions, handleNodeDragStop, store],
  );

  return (
    <div
      className="architecture-workspace"
      data-catalog-occlusion={shellSafeArea.left}
      data-inspector-occlusion={shellSafeArea.right}
      data-workspace-occlusion={shellSafeArea.bottom}
      ref={architectureWorkspaceRef}
      style={canvasStyle}
    >
      <section
        aria-label="Architecture canvas"
        className="architecture-canvas-column"
      >
        <div
          className="architecture-top-stack"
          data-canvas-overlay="top-controls"
          ref={topStackRef}
        >
          {guidedWalkthrough}
          {geometryOverflow === null ? null : (
            <div
              aria-label="Canvas layout warning"
              className="architecture-canvas-notice"
              data-tone="warning"
              role="status"
            >
              <span>
                <strong>Canvas layout needs attention.</strong>{" "}
                {geometryOverflow.message} The architecture was not changed. Use
                the Architecture list to move the affected resource.
                {model.geometryOverflows.length > 1
                  ? ` ${String(model.geometryOverflows.length - 1)} more layout issues need review.`
                  : null}
              </span>
            </div>
          )}
          {canvasNotice === null ? null : (
            <div
              className="architecture-canvas-notice"
              data-tone={canvasNotice.tone}
              role={canvasNotice.tone === "error" ? "alert" : "status"}
            >
              <span>{canvasNotice.message}</span>
              <Button
                onClick={() => {
                  store.getState().setCanvasNotice(null);
                }}
                size="compact"
                variant="quiet"
              >
                Dismiss
              </Button>
            </div>
          )}
        </div>
        {fixtureMode ? (
          <div className="architecture-canvas-status-dock">
            <DevelopmentFixtureStatus />
          </div>
        ) : null}

        <ReactFlowProvider>
          <div className="architecture-canvas">
            <div
              className="architecture-canvas__flow"
              onDragOver={handleCanvasDragOver}
              onDrop={handleCanvasDrop}
            >
              <ControlledArchitectureFlow
                {...flowEvents}
                ariaLabelConfig={FLOW_ARIA_LABELS}
                colorMode={resolvedTheme}
                connectionMode={ConnectionMode.Loose}
                connectOnClick={false}
                deleteKeyCode={null}
                edges={projected.edges}
                edgesReconnectable={false}
                edgeTypes={EDGE_TYPES}
                elementsSelectable
                fitViewOptions={fitViewOptions}
                maxZoom={2}
                minZoom={0.05}
                multiSelectionKeyCode={null}
                nodes={projected.nodes}
                nodesConnectable
                nodesDraggable={nodesAreDraggable}
                nodeTypes={NODE_TYPES}
                onEdgesChange={handleEdgeChanges}
                onConnect={handleConnect}
                onKeyDown={handleCanvasKeyDown}
                onNodesChange={handleNodeChanges}
                panOnDrag
                proOptions={{ hideAttribution: true }}
                selectNodesOnDrag={false}
                snapGrid={SNAP_GRID}
                snapToGrid
                zoomOnDoubleClick={false}
              >
                <Background
                  color="var(--cm-color-canvas-grid)"
                  bgColor="var(--cm-color-canvas)"
                  gap={VISIBLE_GRID_SIZE / initialGrid.zoom}
                  offset={[
                    openingGridOffset(initialGrid.x, initialGrid.zoom),
                    openingGridOffset(initialGrid.y, initialGrid.zoom),
                  ]}
                  size={1}
                  variant={BackgroundVariant.Lines}
                />
                <Controls
                  fitViewOptions={fitViewOptions}
                  position="bottom-left"
                  showFitView={false}
                  showInteractive={false}
                  style={{
                    bottom: shellSafeArea.bottom + canvasOverlayGap,
                    left: "var(--architecture-controls-left, var(--architecture-safe-left))",
                    margin: 0,
                  }}
                />
                <div className="architecture-zoom-status">
                  <StatusBadge
                    label={`${String(Math.round(zoom * 100))}% zoom`}
                    tone="read-only"
                  />
                </div>
                <MiniMap
                  ariaLabel="Architecture overview"
                  bgColor="var(--cm-color-canvas-overlay-surface)"
                  className="architecture-minimap"
                  maskColor="color-mix(in srgb, var(--cm-color-hatch) 72%, transparent)"
                  maskStrokeColor="var(--cm-color-selection)"
                  maskStrokeWidth={1}
                  nodeBorderRadius={4}
                  nodeClassName={miniMapNodeClassName}
                  nodeColor={miniMapNodeColor}
                  nodeComponent={ArchitectureMiniMapNode}
                  nodeStrokeColor={miniMapNodeStrokeColor}
                  nodeStrokeWidth={1}
                  pannable={false}
                  position="bottom-right"
                  style={{ height: miniMapHeight, width: miniMapWidth }}
                  zoomable={false}
                />
                <div
                  id="architecture-canvas-menu-slot"
                  className="architecture-canvas-menu-slot"
                  style={{ height: miniMapHeight, width: miniMapWidth }}
                />
              </ControlledArchitectureFlow>
              {model.nodes.length === 0 ? (
                <div className="architecture-empty-state architecture-empty-state--canvas">
                  <EmptyState
                    description="Search the service catalog and use Add, keyboard activation, or drag a service here. No canvas element is inferred."
                    title="This architecture has no elements"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </ReactFlowProvider>
      </section>
      <AutomaticLayoutDialog />
    </div>
  );
}
