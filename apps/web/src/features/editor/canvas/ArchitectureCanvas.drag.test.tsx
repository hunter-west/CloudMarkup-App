import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModePreferenceProvider } from "../../../preferences/index.js";
import {
  BOUNDARY_MAXIMUM_WIDTH,
  foundationArchitectureInput,
  foundationEditorCatalog,
  foundationIconRegistry,
} from "../model/index.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
  useEditorSessionState,
} from "../session/index.js";
import { ArchitectureCanvas } from "./ArchitectureCanvas.js";

interface CapturedFlowNode {
  readonly id: string;
}

interface CapturedReactFlowProps {
  readonly children?: ReactNode;
  readonly nodes: readonly CapturedFlowNode[];
  readonly edges: readonly { readonly id: string }[];
  readonly viewport: {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
  };
  readonly onViewportChange?: (viewport: {
    x: number;
    y: number;
    zoom: number;
  }) => void;
  readonly onConnect?: (connection: {
    readonly source: string;
    readonly sourceHandle: string | null;
    readonly target: string;
    readonly targetHandle: string | null;
  }) => void;
  readonly onInit?: (instance: {
    fitView(): Promise<boolean>;
    getViewport(): { x: number; y: number; zoom: number };
    getInternalNode(nodeId: string):
      | {
          readonly internals: {
            readonly positionAbsolute: {
              readonly x: number;
              readonly y: number;
            };
          };
        }
      | undefined;
    screenToFlowPosition(position: {
      readonly x: number;
      readonly y: number;
    }): {
      readonly x: number;
      readonly y: number;
    };
  }) => void;
  readonly onNodeDragStart?: (event: unknown, node: CapturedFlowNode) => void;
  readonly onNodeDragStop?: (event: unknown, node: CapturedFlowNode) => void;
  readonly onNodesChange?: (
    changes: readonly {
      readonly dragging: boolean;
      readonly id: string;
      readonly position: {
        readonly x: number;
        readonly y: number;
      };
      readonly type: "position";
    }[],
  ) => void;
}

const flowHarness = vi.hoisted(() => ({
  absolutePositions: new Map<
    string,
    { readonly x: number; readonly y: number }
  >(),
  initialized: false,
  props: null as CapturedReactFlowProps | null,
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const React = await import("react");

  function CapturingReactFlow(props: Record<string, unknown>) {
    const captured = props as unknown as CapturedReactFlowProps;

    React.useEffect(() => {
      flowHarness.props = captured;
      captured.onInit?.({
        fitView: () => Promise.resolve(true),
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getInternalNode(nodeId) {
          const positionAbsolute = flowHarness.absolutePositions.get(nodeId);
          return positionAbsolute === undefined
            ? undefined
            : { internals: { positionAbsolute } };
        },
        screenToFlowPosition: (position) => position,
      });
      flowHarness.initialized = true;
    }, [captured]);

    return React.createElement("div", {
      "data-testid": "captured-react-flow",
    });
  }

  return {
    ...actual,
    ReactFlow: CapturingReactFlow,
  };
});

function createSequentialIds(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `operation_canvas_drag_${String(sequence)}`;
  };
}

function CanvasDragStateProbe() {
  const session = useEditorDocumentSession();
  const preview = useEditorSessionState((state) =>
    state.previewPositions.get("node_application"),
  );
  const notice = useEditorSessionState((state) => state.canvasNotice);
  const announcement = useEditorSessionState((state) => state.liveAnnouncement);

  if (session.status !== "ready") {
    return <output data-testid="drag-session-status">invalid</output>;
  }
  const application = session.document.nodes.find(
    (node) => node.id === "node_application",
  );
  if (application === undefined) {
    return <output data-testid="drag-session-status">missing</output>;
  }

  return (
    <>
      <output data-testid="drag-announcement">{announcement}</output>
      <output data-testid="drag-content-hash">
        {session.hashes.contentHash}
      </output>
      <output data-testid="drag-visual-hash">
        {session.hashes.visualHash}
      </output>
      <output data-testid="drag-parent">
        {application.semantic.parent?.nodeId ?? "architecture-root"}
      </output>
      <output data-testid="drag-position">
        {application.presentation.position.x},{" "}
        {application.presentation.position.y}
      </output>
      <output data-testid="drag-preview">
        {preview === undefined
          ? "none"
          : `${String(preview.x)}, ${String(preview.y)}`}
      </output>
      <output data-testid="drag-notice">{notice?.message ?? "none"}</output>
    </>
  );
}

function renderCanvasDragHarness(
  document: unknown = foundationArchitectureInput,
) {
  return render(
    <ModePreferenceProvider actorId="canvas-drag-test" storage={null}>
      <EditorSessionProvider
        catalog={foundationEditorCatalog}
        createId={createSequentialIds()}
        document={document}
        iconRegistry={foundationIconRegistry}
      >
        <ArchitectureCanvas fixtureMode={false} posture="desktop" />
        <CanvasDragStateProbe />
      </EditorSessionProvider>
    </ModePreferenceProvider>,
  );
}

function capturedFlowProps(): CapturedReactFlowProps {
  if (flowHarness.props === null) {
    throw new Error("React Flow props were not captured.");
  }
  return flowHarness.props;
}

function capturedNode(nodeId: string): CapturedFlowNode {
  const node = capturedFlowProps().nodes.find(
    (candidate) => candidate.id === nodeId,
  );
  if (node === undefined) {
    throw new Error(`React Flow node ${nodeId} was not captured.`);
  }
  return node;
}

async function dragExistingNode({
  absolutePosition,
  nodeId,
  previewPosition,
}: {
  readonly absolutePosition: { readonly x: number; readonly y: number };
  readonly nodeId: string;
  readonly previewPosition: { readonly x: number; readonly y: number };
}): Promise<void> {
  flowHarness.absolutePositions.set(nodeId, absolutePosition);

  act(() => {
    capturedFlowProps().onNodeDragStart?.({}, capturedNode(nodeId));
    capturedFlowProps().onNodesChange?.([
      {
        dragging: true,
        id: nodeId,
        position: previewPosition,
        type: "position",
      },
    ]);
  });

  await waitFor(() => {
    expect(screen.getByTestId("drag-preview")).toHaveTextContent(
      `${String(previewPosition.x)}, ${String(previewPosition.y)}`,
    );
  });

  act(() => {
    capturedFlowProps().onNodeDragStop?.({}, capturedNode(nodeId));
  });
}

describe("ArchitectureCanvas existing-node boundary dragging", () => {
  beforeEach(() => {
    flowHarness.absolutePositions.clear();
    flowHarness.initialized = false;
    flowHarness.props = null;
  });

  it("preserves projection elements and handlers during controlled pan bookkeeping", async () => {
    renderCanvasDragHarness();
    await waitFor(() => {
      expect(flowHarness.initialized).toBe(true);
    });
    const before = capturedFlowProps();
    act(() => {
      before.onViewportChange?.({ x: 80, y: 120, zoom: 1 });
    });
    await waitFor(() => {
      expect(capturedFlowProps().viewport).toEqual({ x: 80, y: 120, zoom: 1 });
    });
    const after = capturedFlowProps();
    expect(after.nodes).toBe(before.nodes);
    expect(after.edges).toBe(before.edges);
    expect(after.onNodesChange).toBe(before.onNodesChange);
    expect(after.onNodeDragStop).toBe(before.onNodeDragStop);
    expect(after.onConnect).toBe(before.onConnect);
    expect(after.onInit).toBe(before.onInit);
  });

  it("reparents through drag-stop and snaps an invalid boundary drop back with the rule explanation", async () => {
    renderCanvasDragHarness();

    await waitFor(() => {
      expect(flowHarness.initialized).toBe(true);
      expect(screen.getByTestId("drag-parent")).toHaveTextContent("node_zone");
      expect(screen.getByTestId("drag-position")).toHaveTextContent("40, 160");
    });

    const originalContentHash =
      screen.getByTestId("drag-content-hash").textContent;
    const originalVisualHash =
      screen.getByTestId("drag-visual-hash").textContent;

    await dragExistingNode({
      absolutePosition: { x: 1_600, y: 1_200 },
      nodeId: "node_application",
      previewPosition: { x: 1_480, y: 1_000 },
    });

    await waitFor(() => {
      expect(screen.getByTestId("drag-parent")).toHaveTextContent(
        "architecture-root",
      );
      expect(screen.getByTestId("drag-position")).toHaveTextContent(
        "1600, 1200",
      );
      expect(screen.getByTestId("drag-preview")).toHaveTextContent("none");
      expect(screen.getByTestId("drag-notice")).toHaveTextContent(
        "Node placed at the architecture root.",
      );
    });

    await dragExistingNode({
      absolutePosition: { x: 160, y: 360 },
      nodeId: "node_application",
      previewPosition: { x: 160, y: 360 },
    });

    await waitFor(() => {
      expect(screen.getByTestId("drag-parent")).toHaveTextContent("node_zone");
      expect(screen.getByTestId("drag-position")).toHaveTextContent("40, 160");
      expect(screen.getByTestId("drag-content-hash").textContent).toBe(
        originalContentHash,
      );
      expect(screen.getByTestId("drag-visual-hash").textContent).toBe(
        originalVisualHash,
      );
    });

    const beforeInvalidContentHash =
      screen.getByTestId("drag-content-hash").textContent;
    const beforeInvalidVisualHash =
      screen.getByTestId("drag-visual-hash").textContent;

    await dragExistingNode({
      absolutePosition: { x: 0, y: 80 },
      nodeId: "node_application",
      previewPosition: { x: -120, y: -120 },
    });

    await waitFor(() => {
      expect(screen.getByTestId("drag-parent")).toHaveTextContent("node_zone");
      expect(screen.getByTestId("drag-position")).toHaveTextContent("40, 160");
      expect(screen.getByTestId("drag-preview")).toHaveTextContent("none");
      expect(screen.getByTestId("drag-content-hash").textContent).toBe(
        beforeInvalidContentHash,
      );
      expect(screen.getByTestId("drag-visual-hash").textContent).toBe(
        beforeInvalidVisualHash,
      );
      expect(screen.getByTestId("drag-notice")).toHaveTextContent(
        "Application resource cannot be placed inside Network boundary.",
      );
    });
  });

  it("surfaces capped existing geometry as a persistent warning without mutating the architecture", async () => {
    const overflowDocument = {
      ...foundationArchitectureInput,
      nodes: foundationArchitectureInput.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              presentation: {
                ...node.presentation,
                position: {
                  x: BOUNDARY_MAXIMUM_WIDTH,
                  y: node.presentation.position.y,
                },
              },
            }
          : node,
      ),
    };
    renderCanvasDragHarness(overflowDocument);

    await waitFor(() => {
      expect(flowHarness.initialized).toBe(true);
    });
    const contentHash = screen.getByTestId("drag-content-hash").textContent;
    const warning = screen.getByRole("status", {
      name: "Canvas layout warning",
    });
    expect(warning).toHaveAttribute("data-tone", "warning");
    expect(warning).toHaveTextContent("Canvas layout needs attention.");
    expect(warning).toHaveTextContent("cannot expand beyond 4096 by 3072");
    expect(warning).toHaveTextContent("The architecture was not changed.");
    expect(screen.getByTestId("drag-content-hash").textContent).toBe(
      contentHash,
    );
  });

  it("routes grouped dock drags into connection discovery without mutating the graph", async () => {
    renderCanvasDragHarness();

    await waitFor(() => {
      expect(flowHarness.initialized).toBe(true);
    });
    const originalContentHash =
      screen.getByTestId("drag-content-hash").textContent;
    const originalVisualHash =
      screen.getByTestId("drag-visual-hash").textContent;

    act(() => {
      capturedFlowProps().onConnect?.({
        source: "node_application",
        sourceHandle: "dock:network-and-security:output",
        target: "node_network",
        targetHandle: "dock:network-and-security:input",
      });
    });

    expect(screen.getByTestId("drag-announcement")).toHaveTextContent(
      "The version-bound connection engine is not available.",
    );
    expect(screen.getByTestId("drag-content-hash").textContent).toBe(
      originalContentHash,
    );
    expect(screen.getByTestId("drag-visual-hash").textContent).toBe(
      originalVisualHash,
    );
  });
});
