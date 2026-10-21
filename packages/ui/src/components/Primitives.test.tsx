import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StatePanel, StatusBadge, ToastViewport } from "../index.js";

describe("provider-neutral UI primitives", () => {
  it("communicates badge status in text without requiring its symbol", () => {
    const { container } = render(
      <StatusBadge label="Validation incomplete" tone="incomplete" />,
    );

    expect(screen.getByText("Validation incomplete")).toBeVisible();
    expect(container.querySelector("[aria-hidden='true']")).toHaveTextContent(
      "?",
    );
  });

  it("names a loading region and exposes its busy state", () => {
    render(
      <StatePanel
        description="Checking authorized project context."
        kind="loading"
        title="Loading project"
      />,
    );

    const region = screen.getByRole("region", { name: "Loading project" });

    expect(region).toHaveAttribute("aria-busy", "true");
    expect(
      within(region).getByText("Checking authorized project context."),
    ).toBeVisible();
  });

  it("keeps an error action in the persistent state region", () => {
    const retry = vi.fn();

    render(
      <StatePanel
        actions={
          <button onClick={retry} type="button">
            Retry loading
          </button>
        }
        kind="error"
        title="Project could not load"
      />,
    );

    const region = screen.getByRole("region", {
      name: "Project could not load",
    });
    expect(region).toBeVisible();
    fireEvent.click(
      within(region).getByRole("button", { name: "Retry loading" }),
    );

    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "Project could not load" })).toBe(
      region,
    );
  });

  it("announces toast tones and offers an explicit dismiss control", () => {
    const dismiss = vi.fn();

    render(
      <ToastViewport
        onDismiss={dismiss}
        toasts={[
          {
            description: "The durable job record remains available.",
            id: "job-started",
            title: "Revision request received",
            tone: "success",
          },
          {
            id: "save-failed",
            title: "Save not acknowledged",
            tone: "error",
          },
        ]}
      />,
    );

    expect(screen.getByRole("region", { name: "Notifications" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Revision request received",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Save not acknowledged",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Dismiss Revision request received",
      }),
    );

    expect(dismiss).toHaveBeenCalledWith("job-started");
  });
});
