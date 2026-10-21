import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "../../routing/index.js";
import { WorkspaceTour } from "./WorkspaceTour.js";
afterEach(() => {
  cleanup();
  localStorage.clear();
});
describe("workspace navigation tour", () => {
  it("guides the reorganized menus, remembers dismissal per account, and can restart", () => {
    window.history.replaceState(null, "", "/organizations/org_tour/dashboard");
    const reveal = vi.fn();
    const view = render(
      <RouterProvider>
        <WorkspaceTour actorId="actor_tour" onRevealNavigation={reveal} />
      </RouterProvider>,
    );
    expect(
      screen.getByRole("complementary", { name: "Workspace tour" }),
    ).toHaveAttribute("data-step", "workspace");
    expect(reveal).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Show navigation" }));
    expect(reveal).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Your account" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss workspace tour" }),
    );
    expect(
      localStorage.getItem("cloudmarkup.workspace-tour.v1.actor_tour"),
    ).toBe("complete");
    view.unmount();
    render(
      <RouterProvider>
        <WorkspaceTour actorId="actor_tour" onRevealNavigation={reveal} />
      </RouterProvider>,
    );
    expect(
      screen.queryByRole("complementary", { name: "Workspace tour" }),
    ).not.toBeInTheDocument();
    fireEvent(window, new Event("cloudmarkup:restart-workspace-tour"));
    expect(
      screen.getByRole("heading", { name: "Your workspace" }),
    ).toBeVisible();
  });
});
