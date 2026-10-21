import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../App.js";

function setViewport(width: number, height = 900) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function renderPath(path: string) {
  window.history.replaceState(null, "", path);
  return render(<App />);
}

describe("safe route-state focus", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setViewport(1440);
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    [
      "permission denied",
      "/organizations/other-org/projects/private-a",
      "/organizations/another-org/projects/private-b",
      "Access unavailable",
    ],
    [
      "not found",
      "/missing-location-a",
      "/missing-location-b",
      "Page unavailable",
    ],
  ])(
    "returns focus to the heading when a distinct %s URL renders the same safe state",
    async (_state, initialPath, nextPath, headingName) => {
      renderPath(initialPath);

      const initialHeading = screen.getByRole("heading", {
        level: 1,
        name: headingName,
      });
      expect(initialHeading).toHaveFocus();

      const safeReturn = screen.getByRole("link", {
        name: "Return to organizations",
      });
      expect(safeReturn).toHaveAttribute("href", "/organizations");
      safeReturn.focus();
      expect(safeReturn).toHaveFocus();

      window.history.pushState(null, "", nextPath);
      fireEvent.popState(window);

      await waitFor(() => {
        expect(
          screen.getByRole("heading", {
            level: 1,
            name: headingName,
          }),
        ).toHaveFocus();
      });
      expect(
        screen
          .getAllByRole("status")
          .some((status) => status.textContent === `Viewing ${headingName}`),
      ).toBe(true);
    },
  );
});
