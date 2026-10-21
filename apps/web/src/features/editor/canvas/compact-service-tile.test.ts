import { describe, expect, it } from "vitest";
import {
  boundaryOverviewTile,
  compactServiceTile,
} from "./compact-service-tile.js";
describe("compact service tiles", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "keeps invalid zoom finite (%s)",
    (zoom) => {
      const tile = compactServiceTile(zoom);
      expect(Number.isFinite(tile.width)).toBe(true);
      expect(Number.isFinite(tile.scale)).toBe(true);
      expect(tile.compact).toBe(false);
    },
  );
});

describe("nested boundary overview", () => {
  it("keeps labels and icons legible in screen space", () => {
    const labelled = boundaryOverviewTile(0.5);
    expect(labelled.iconOnly).toBe(false);
    expect(labelled.width * 0.5).toBe(176);
    expect(labelled.height * 0.5).toBe(72);
    const distant = boundaryOverviewTile(0.1);
    expect(distant.iconOnly).toBe(true);
    expect(distant.width * 0.1).toBe(56);
    expect(distant.height * 0.1).toBe(56);
    expect(boundaryOverviewTile(Number.NaN).scale).toBe(1);
  });
});
