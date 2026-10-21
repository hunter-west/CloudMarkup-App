import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../App.js";

describe("connection guidance route", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/help/connections");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("serves the fallback guidance inside the application", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Connection guidance" }),
    ).toBeVisible();
    expect(
      screen.getByText(/deterministic connection-rule engine/iu),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Confirmation applies one atomic command batch",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to organizations" }),
    ).toHaveAttribute("href", "/organizations");
  });
});
