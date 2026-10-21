import { describe, expect, it } from "vitest";

import {
  semanticEdgePresentation,
  type SemanticEdgePresentationInput,
} from "./semantic-edge-presentation.js";

const base: SemanticEdgePresentationInput = {
  edgeId: "relationship-1",
  sourceNodeId: "source",
  targetNodeId: "target",
  visualRole: "relationship",
  hoveredElement: null,
  selectedElement: null,
  validationEdgeId: null,
  dockHighlighted: false,
};

describe("semantic edge presentation", () => {
  it("retains visible validation and dock routes through boundary frames", () => {
    expect(
      semanticEdgePresentation({
        ...base,
        visualRole: "containment",
        validationEdgeId: "relationship-1",
      }),
    ).toMatchObject({
      emphasizePath: true,
      showLabel: true,
      showPath: true,
    });
    expect(
      semanticEdgePresentation({
        ...base,
        visualRole: "containment",
        dockHighlighted: true,
      }),
    ).toMatchObject({
      emphasizePath: true,
      showLabel: false,
      showPath: true,
    });
  });
});
