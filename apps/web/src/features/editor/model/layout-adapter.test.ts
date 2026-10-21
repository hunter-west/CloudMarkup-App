import { describe, expect, it } from "vitest";

import {
  canonicalizeLayoutRequest,
  LayoutAdapterError,
  type LayoutRequest,
} from "./layout-adapter.js";

function shuffledRequest(): LayoutRequest {
  return {
    nodes: [
      {
        id: "node_z",
        width: 240,
        height: 208,
        ports: [
          { id: "port_z_output", direction: "output" },
          { id: "port_z_input", direction: "input" },
        ],
      },
      {
        id: "node_child_b",
        parentId: "node_a",
        width: 240,
        height: 208,
        ports: [{ id: "port_b_input", direction: "input" }],
      },
      {
        id: "node_a",
        width: 672,
        height: 384,
        ports: [],
      },
      {
        id: "node_child_a",
        parentId: "node_a",
        width: 240,
        height: 208,
        ports: [{ id: "port_a_output", direction: "output" }],
      },
    ],
    edges: [
      {
        id: "edge_z",
        source: { nodeId: "node_z", portId: "port_z_output" },
        target: { nodeId: "node_child_b", portId: "port_b_input" },
      },
      {
        id: "edge_a",
        source: { nodeId: "node_child_a", portId: "port_a_output" },
        target: { nodeId: "node_z", portId: "port_z_input" },
      },
    ],
  };
}

describe("layout adapter request contract", () => {
  it("canonicalizes roots, nested children, ports, and edges deterministically", () => {
    const first = canonicalizeLayoutRequest(shuffledRequest());
    const input = shuffledRequest();
    const second = canonicalizeLayoutRequest({
      nodes: [...input.nodes].reverse(),
      edges: [...input.edges].reverse(),
    });

    expect(first).toEqual(second);
    expect(first.nodes.map((node) => node.id)).toEqual([
      "node_a",
      "node_child_a",
      "node_child_b",
      "node_z",
    ]);
    expect(first.nodes.at(-1)?.ports.map((port) => port.id)).toEqual([
      "port_z_input",
      "port_z_output",
    ]);
    expect(first.edges.map((edge) => edge.id)).toEqual(["edge_a", "edge_z"]);
  });

  it.each([
    {
      name: "parent cycle",
      change: (request: LayoutRequest): LayoutRequest => ({
        ...request,
        nodes: [
          {
            id: "node_a",
            parentId: "node_child_a",
            width: 672,
            height: 384,
            ports: [],
          },
          ...request.nodes.filter((node) => node.id !== "node_a"),
        ],
      }),
      path: "$.nodes.node_a.parentId",
    },
    {
      name: "invalid edge direction",
      change: (request: LayoutRequest): LayoutRequest => ({
        ...request,
        edges: [
          {
            id: "edge_invalid",
            source: { nodeId: "node_z", portId: "port_z_input" },
            target: { nodeId: "node_child_b", portId: "port_b_input" },
          },
        ],
      }),
      path: "$.edges[0].source.portId",
    },
    {
      name: "non-finite dimension",
      change: (request: LayoutRequest): LayoutRequest => ({
        ...request,
        nodes: request.nodes.map((node) =>
          node.id === "node_z" ? { ...node, width: Number.NaN } : node,
        ),
      }),
      path: "$.nodes[0].width",
    },
  ])("rejects $name without repairing it", ({ change, path }) => {
    expect(() => canonicalizeLayoutRequest(change(shuffledRequest()))).toThrow(
      expect.objectContaining<Partial<LayoutAdapterError>>({
        code: "invalid-request",
        path,
      }),
    );
  });
});
