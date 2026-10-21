import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "../index.js";

describe("Button", () => {
  it("exposes the compact shared size without changing native button semantics", () => {
    render(
      <Button size="compact" variant="primary">
        Add
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Add" });
    expect(button).toHaveAttribute("data-size", "compact");
    expect(button).toHaveAttribute("data-variant", "primary");
    expect(button).toHaveAttribute("type", "button");
  });
});
