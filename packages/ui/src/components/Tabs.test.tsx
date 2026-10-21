import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { TabItem, TabsSize } from "../index.js";
import { Tabs } from "../index.js";

const items: readonly TabItem[] = [
  {
    id: "configure",
    label: "Configure",
    panel: <p>Configuration summary</p>,
  },
  {
    disabled: true,
    id: "connect",
    label: "Connect",
    panel: <p>Connections</p>,
  },
  {
    id: "learn",
    label: "Learn",
    panel: <p>Catalog education</p>,
  },
  {
    id: "iac",
    label: "IaC",
    panel: <p>Mapping metadata only</p>,
  },
];

function TabsHarness({
  orientation = "horizontal",
  size = "default",
}: {
  readonly orientation?: "horizontal" | "vertical";
  readonly size?: TabsSize;
}) {
  const [value, setValue] = useState("configure");

  return (
    <Tabs
      ariaLabel="Resource details"
      items={items}
      onValueChange={setValue}
      orientation={orientation}
      size={size}
      value={value}
    />
  );
}

describe("Tabs", () => {
  it("uses arrow keys with wrapping and skips disabled tabs", () => {
    render(<TabsHarness />);

    const configure = screen.getByRole("tab", { name: "Configure" });
    const configurePanel = screen.getByRole("tabpanel", {
      name: "Configure",
    });
    configure.focus();
    fireEvent.keyDown(configure, { key: "ArrowRight" });

    const learn = screen.getByRole("tab", { name: "Learn" });
    expect(learn).toHaveFocus();
    expect(learn).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Learn" })).toHaveTextContent(
      "Catalog education",
    );
    expect(configurePanel).toBeInTheDocument();
    expect(configurePanel).not.toBeVisible();

    fireEvent.keyDown(learn, { key: "Home" });
    expect(configure).toHaveFocus();

    fireEvent.keyDown(configure, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "IaC" })).toHaveFocus();
  });

  it("uses vertical arrow keys for a vertical tab list", () => {
    render(<TabsHarness orientation="vertical" />);

    const configure = screen.getByRole("tab", { name: "Configure" });
    configure.focus();
    fireEvent.keyDown(configure, { key: "ArrowDown" });

    expect(screen.getByRole("tab", { name: "Learn" })).toHaveFocus();
    expect(
      screen.getByRole("tablist", { name: "Resource details" }),
    ).toHaveAttribute("aria-orientation", "vertical");
  });
});
