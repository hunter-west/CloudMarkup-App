import type { ElkNode } from "elkjs/lib/elk-api.js";
import { describe, expect, it, vi } from "vitest";

import {
  createWebWorkerElkLayoutEngine,
  ElkLayoutAdapter,
  type ElkLayoutEngine,
} from "./elk-layout-adapter.js";
import { createBundledElkLayoutEngine } from "./elk-layout-bundled-engine.js";
import {
  LayoutAdapterError,
  LayoutCanceledError,
  type LayoutRequest,
} from "./layout-adapter.js";
import { createArchitectureLayoutRequest } from "./architecture-layout.js";
import {
  foundationEditorCatalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";

function request(): LayoutRequest {
  return {
    nodes: [
      {
        id: "node_boundary",
        width: 672,
        height: 384,
        ports: [],
      },
      {
        id: "node_source",
        parentId: "node_boundary",
        width: 240,
        height: 208,
        ports: [{ id: "port_output", direction: "output" }],
      },
      {
        id: "node_target",
        width: 240,
        height: 208,
        ports: [{ id: "port_input", direction: "input" }],
      },
    ],
    edges: [
      {
        id: "edge_request",
        source: { nodeId: "node_source", portId: "port_output" },
        target: { nodeId: "node_target", portId: "port_input" },
      },
    ],
  };
}

function positionedGraph(graph: ElkNode): ElkNode {
  const output = structuredClone(graph);

  function position(children: ElkNode[] | undefined): void {
    children?.forEach((child, index) => {
      child.x = 35 + index * 317;
      child.y = 69 + index * 191;
      position(child.children);
    });
  }
  position(output.children);
  return output;
}

function fakeEngine(
  layout: (graph: ElkNode) => Promise<ElkNode>,
  terminateWorker = vi.fn(),
): ElkLayoutEngine {
  return {
    layout,
    terminateWorker,
  };
}

describe("ELK layout adapter", () => {
  it("builds nested compound nodes and node-qualified typed ports", async () => {
    let captured: ElkNode | undefined;
    const adapter = new ElkLayoutAdapter({
      createEngine: () =>
        fakeEngine((graph) => {
          captured = structuredClone(graph);
          return Promise.resolve(positionedGraph(graph));
        }),
    });

    const result = await adapter.layout(request());

    const boundary = captured?.children?.find(
      (node) => node.id === "node_boundary",
    );
    const source = boundary?.children?.find(
      (node) => node.id === "node_source",
    );
    const target = captured?.children?.find(
      (node) => node.id === "node_target",
    );
    const sourcePortId = source?.ports?.[0]?.id;
    const targetPortId = target?.ports?.[0]?.id;

    expect(boundary?.children?.map((node) => node.id)).toEqual(["node_source"]);
    expect(captured?.layoutOptions).toMatchObject({
      "elk.layered.spacing.nodeNodeBetweenLayers": "112",
      "elk.spacing.nodeNode": "72",
    });
    expect(boundary?.layoutOptions).toMatchObject({
      "elk.spacing.nodeNode": "72",
    });
    expect(sourcePortId).toContain("node_source");
    expect(sourcePortId).toContain("port_output");
    expect(targetPortId).toContain("node_target");
    expect(source?.ports?.[0]?.layoutOptions).toMatchObject({
      "elk.port.side": "EAST",
    });
    expect(target?.ports?.[0]?.layoutOptions).toMatchObject({
      "elk.port.side": "WEST",
    });
    expect(captured?.edges?.[0]).toMatchObject({
      id: "edge_request",
      sources: [sourcePortId],
      targets: [targetPortId],
    });
    expect(result.positions).toEqual([
      {
        nodeId: "node_boundary",
        parentId: null,
        position: { x: 32, y: 72 },
      },
      {
        nodeId: "node_source",
        parentId: "node_boundary",
        position: { x: 32, y: 72 },
      },
      {
        nodeId: "node_target",
        parentId: null,
        position: { x: 352, y: 264 },
      },
    ]);
  });

  it("returns identical normalized output for repeated real ELK runs", async () => {
    const adapter = new ElkLayoutAdapter({
      createEngine: createBundledElkLayoutEngine,
    });
    const first = await adapter.layout(request());
    const second = await adapter.layout({
      nodes: [...request().nodes].reverse(),
      edges: [...request().edges].reverse(),
    });

    expect(second).toEqual(first);
    expect(
      first.positions.every(
        ({ position }) => position.x % 8 === 0 && position.y % 8 === 0,
      ),
    ).toBe(true);
  });

  it("lays out the real two-level hierarchy and descendant-to-ancestor edge deterministically", async () => {
    const architectureRequest = createArchitectureLayoutRequest(
      loadFoundationArchitectureDocument(),
      foundationEditorCatalog,
    );
    const adapter = new ElkLayoutAdapter({
      createEngine: createBundledElkLayoutEngine,
    });

    const first = await adapter.layout(architectureRequest);
    const second = await adapter.layout({
      nodes: [...architectureRequest.nodes].reverse(),
      edges: [...architectureRequest.edges].reverse(),
    });

    expect(second).toEqual(first);
    expect(
      first.positions.map(({ nodeId, parentId }) => [nodeId, parentId]),
    ).toEqual([
      ["node_network", null],
      ["node_zone", "node_network"],
      ["node_application", "node_zone"],
      ["node_unknown", null],
      ["node_unsupported", null],
    ]);
    expect(
      first.positions.every(
        ({ position }) =>
          Number.isFinite(position.x) &&
          Number.isFinite(position.y) &&
          position.x % 8 === 0 &&
          position.y % 8 === 0,
      ),
    ).toBe(true);
  });

  it.each([
    {
      name: "a missing nested child",
      corrupt: (graph: ElkNode): ElkNode => {
        const output = positionedGraph(graph);
        const boundary = output.children?.find(
          (node) => node.id === "node_boundary",
        );
        if (boundary !== undefined) {
          boundary.children = [];
        }
        return output;
      },
    },
    {
      name: "a non-finite coordinate",
      corrupt: (graph: ElkNode): ElkNode => {
        const output = positionedGraph(graph);
        const first = output.children?.[0];
        if (first !== undefined) {
          first.x = Number.POSITIVE_INFINITY;
        }
        return output;
      },
    },
    {
      name: "a changed parent",
      corrupt: (graph: ElkNode): ElkNode => {
        const output = positionedGraph(graph);
        const boundary = output.children?.find(
          (node) => node.id === "node_boundary",
        );
        const child = boundary?.children?.[0];
        if (boundary !== undefined && child !== undefined) {
          boundary.children = [];
          output.children?.push(child);
        }
        return output;
      },
    },
  ])("rejects malformed engine output with $name", async ({ corrupt }) => {
    const adapter = new ElkLayoutAdapter({
      createEngine: () =>
        fakeEngine((graph) => Promise.resolve(corrupt(graph))),
    });

    await expect(adapter.layout(request())).rejects.toEqual(
      expect.objectContaining<Partial<LayoutAdapterError>>({
        code: "invalid-result",
      }),
    );
  });

  it("cancels immediately, terminates the engine, and discards late output", async () => {
    let resolveLayout: ((value: ElkNode) => void) | undefined;
    let captured: ElkNode | undefined;
    const terminateWorker = vi.fn();
    const adapter = new ElkLayoutAdapter({
      createEngine: () =>
        fakeEngine((graph) => {
          captured = graph;
          return new Promise<ElkNode>((resolve) => {
            resolveLayout = resolve;
          });
        }, terminateWorker),
    });
    const controller = new AbortController();
    const pending = adapter.layout(request(), { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(LayoutCanceledError);
    expect(terminateWorker).toHaveBeenCalledTimes(1);
    if (captured !== undefined) {
      resolveLayout?.(positionedGraph(captured));
    }
  });

  it("terminates the underlying browser Worker when cancellation is requested", async () => {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    const worker = {
      onmessage: null,
      postMessage,
      terminate,
    } as unknown as Worker;
    const adapter = new ElkLayoutAdapter({
      createEngine: () => createWebWorkerElkLayoutEngine(() => worker),
    });
    const controller = new AbortController();
    const pending = adapter.layout(request(), { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(LayoutCanceledError);
    expect(postMessage).toHaveBeenCalled();
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
