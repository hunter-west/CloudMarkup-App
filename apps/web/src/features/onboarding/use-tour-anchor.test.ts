import { describe, expect, it } from "vitest";
import { placeTour } from "./use-tour-anchor.js";
const viewport = { width: 1440, height: 900 };
const card = { width: 352, height: 240 };
describe("tour placement beside actual menus", () => {
  it("places navigation guidance to the right of its highlighted group", () => {
    expect(
      placeTour(
        {
          left: 20,
          top: 170,
          right: 250,
          bottom: 330,
          width: 230,
          height: 160,
        },
        card,
        viewport,
      ),
    ).toEqual({ left: 268, top: 170, side: "right" });
  });
  it("places inspector guidance to its left and bottom workspace guidance above", () => {
    expect(
      placeTour(
        {
          left: 960,
          top: 80,
          right: 1400,
          bottom: 780,
          width: 440,
          height: 700,
        },
        card,
        viewport,
      ).side,
    ).toBe("left");
    expect(
      placeTour(
        {
          left: 350,
          top: 590,
          right: 1340,
          bottom: 840,
          width: 990,
          height: 250,
        },
        card,
        viewport,
      ),
    ).toEqual({ left: 350, top: 332, side: "above" });
  });
  it("keeps the profile tour on screen", () => {
    const position = placeTour(
      { left: 1376, top: 8, right: 1424, bottom: 56, width: 48, height: 48 },
      card,
      viewport,
    );
    expect(position.left).toBeGreaterThanOrEqual(16);
    expect(position.left + card.width).toBeLessThanOrEqual(1424);
    expect(position.top).toBeGreaterThanOrEqual(16);
  });
});
