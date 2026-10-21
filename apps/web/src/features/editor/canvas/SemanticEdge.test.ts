import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { connectionDockHighlightsEdge } from "./connection-dock-presentation.js";
import { createSemanticEdgeFanoutPath } from "./semantic-edge-path.js";

describe("semantic edge shared-dock fan-out", () => {
  it("uses the same common segment for top and bottom anchors", () => {
    const top = createSemanticEdgeFanoutPath({
      sourceX: 200,
      sourceY: 300,
      sourcePosition: Position.Top,
      sourceRank: 1,
      sourceCount: 3,
      targetX: 200,
      targetY: 40,
      targetPosition: Position.Bottom,
      targetRank: 1,
      targetCount: 3,
    })[0];

    expect(top).toMatch(/^M200 300 L200 288 L200 276 /u);
    expect(top).toMatch(/L200 64 L200 52 L200 40$/u);
  });

  it("highlights every exact edge represented by an active compact direction", () => {
    const edge = {
      sourceConnectionGroupId: "example.group.first-output",
      sourceDockSide: "right" as const,
      targetConnectionGroupId: "example.group.first-input",
      targetDockSide: "left" as const,
    };

    expect(
      connectionDockHighlightsEdge(
        {
          direction: "output",
          groupId: "collapsed:output",
          nodeId: "node-source",
        },
        edge,
        "node-source",
        "node-target",
      ),
    ).toBe(true);
    expect(
      connectionDockHighlightsEdge(
        {
          direction: "input",
          groupId: "collapsed:input",
          nodeId: "node-target",
        },
        edge,
        "node-source",
        "node-target",
      ),
    ).toBe(true);
    expect(
      connectionDockHighlightsEdge(
        {
          direction: "input",
          groupId: "collapsed:input",
          nodeId: "another-node",
        },
        edge,
        "node-source",
        "node-target",
      ),
    ).toBe(false);
  });
});
