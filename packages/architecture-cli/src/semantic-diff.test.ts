import { describe, expect, it } from "vitest";

import { architectureCliFixtureSnapshot } from "./test-fixtures.js";
import { diffArchitectureCliSemanticSnapshots } from "./semantic-diff.js";

describe("architecture semantic diff", () => {
  it("reports stable public-exposure and service changes without using labels", () => {
    const changes = diffArchitectureCliSemanticSnapshots(
      architectureCliFixtureSnapshot(false),
      architectureCliFixtureSnapshot(true),
    );

    expect(changes.map(({ kind }) => kind)).toEqual([
      "public-exposure-changed",
      "service-changed",
    ]);
    expect(JSON.stringify(changes)).not.toContain("Notes API");
  });

  it("is invariant to equivalent collection ordering after strict normalization", () => {
    const baseline = architectureCliFixtureSnapshot();
    expect(
      diffArchitectureCliSemanticSnapshots(baseline, {
        ...baseline,
        services: [...baseline.services].reverse(),
      }),
    ).toEqual([]);
  });
});
