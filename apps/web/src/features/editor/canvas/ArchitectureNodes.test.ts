import { describe, expect, it } from "vitest";

import {
  connectionDockBuckets,
  connectionDockFaces,
  connectionDockPosition,
} from "./connection-dock-presentation.js";

describe("connection dock directional presentation", () => {
  it("keeps an authored side, group order, and stable axis-aware offsets", () => {
    const group = {
      allowsMultipleEdges: true,
      cardinality: {
        enforcement: "semantic-port" as const,
        maximum: "many" as const,
        minimum: 0 as const,
      },
      category: "other" as const,
      containsExclusiveRelationships: false,
      currentEdgeIds: ["edge-input", "edge-output"],
      description: "Mixed exact capabilities.",
      direction: "mixed" as const,
      exclusivePortIds: [],
      guidedAssistance: "Review both directions.",
      id: "example.group.mixed",
      label: "Mixed",
      order: 0,
      portIds: ["example.port.input", "example.port.output"],
      ports: [
        {
          actionable: true,
          binding: "catalog" as const,
          capability: "example.capability.input",
          cardinality: "many" as const,
          category: "other" as const,
          description: "Input",
          direction: "input" as const,
          displayName: "Input",
          groupId: "example.group.mixed",
          handleId: "dock:example.group.mixed:input",
          hasExistingEdge: true,
          id: "example.port.input",
          label: "Input",
          required: false,
        },
        {
          actionable: false,
          binding: "catalog" as const,
          capability: "example.capability.output",
          cardinality: "many" as const,
          category: "other" as const,
          description: "Output",
          direction: "output" as const,
          displayName: "Output",
          groupId: "example.group.mixed",
          handleId: "dock:example.group.mixed:output",
          hasExistingEdge: true,
          id: "example.port.output",
          label: "Output",
          required: false,
        },
      ],
      professionalMetadata: "Exact mixed ports.",
      side: "bottom" as const,
    };

    const faces = connectionDockFaces([group]);
    expect(faces).toEqual([
      expect.objectContaining({
        direction: "input",
        group,
        portIds: ["example.port.input"],
        side: "bottom",
      }),
      expect.objectContaining({
        direction: "output",
        group,
        portIds: ["example.port.output"],
        side: "bottom",
      }),
    ]);
    expect(
      connectionDockBuckets(faces).map((bucket) => ({
        direction: bucket.direction,
        groupIds: bucket.faces.map((face) => face.group.id),
        side: bucket.side,
      })),
    ).toEqual([
      {
        direction: "input",
        groupIds: ["example.group.mixed"],
        side: "bottom",
      },
      {
        direction: "output",
        groupIds: ["example.group.mixed"],
        side: "bottom",
      },
    ]);
    expect(connectionDockPosition(0, 2, "bottom")).toEqual({
      left: "33.33333333333333%",
    });
    expect(connectionDockPosition(1, 2, "bottom")).toEqual({
      left: "66.66666666666666%",
    });
    expect(connectionDockPosition(0, 1, "left")).toEqual({ top: "50%" });
    expect(connectionDockPosition(0, 1, "right")).toEqual({ top: "50%" });
  });
});
