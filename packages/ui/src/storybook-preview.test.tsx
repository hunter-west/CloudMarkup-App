import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import preview from "../.storybook/preview";

function Story() {
  return <p>Story content</p>;
}

describe("Storybook presentation density", () => {
  it("defaults to compact without tying density labels to experience modes", () => {
    expect(preview.globalTypes.density.defaultValue).toBe("compact");
    expect(preview.globalTypes.density.toolbar.items).toEqual([
      { title: "Compact", value: "compact" },
      { title: "Comfortable", value: "comfortable" },
    ]);
  });

  it("uses compact when no override is present and honors comfortable", () => {
    const decorate = preview.decorators[0];
    expect(decorate).toBeDefined();
    if (decorate === undefined) {
      throw new Error(
        "The Storybook preview must define its density decorator.",
      );
    }

    const compact = render(decorate(Story, { globals: {}, parameters: {} }));

    expect(compact.container.firstElementChild).toHaveAttribute(
      "data-cm-density",
      "compact",
    );

    compact.unmount();

    const comfortable = render(
      decorate(Story, {
        globals: { density: "comfortable" },
        parameters: {},
      }),
    );

    expect(comfortable.container.firstElementChild).toHaveAttribute(
      "data-cm-density",
      "comfortable",
    );
  });
});
