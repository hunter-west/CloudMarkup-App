import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModalDrawer, Tabs } from "../index.js";

function ModalHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Open revision review
      </button>
      <button type="button">Outside action</button>
      <ModalDrawer
        footer={<button type="button">Create revision</button>}
        onClose={() => {
          setOpen(false);
        }}
        open={open}
        title="Create immutable revision"
      >
        <p>Review the exact persisted draft before creating a revision.</p>
      </ModalDrawer>
    </>
  );
}

function ExplicitReturnFocusHarness() {
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button">
        Explicit return target
      </button>
      <button
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Open explicit focus review
      </button>
      <ModalDrawer
        onClose={() => {
          setOpen(false);
        }}
        open={open}
        returnFocusRef={returnFocusRef}
        title="Explicit focus review"
      >
        <p>Review content.</p>
      </ModalDrawer>
    </>
  );
}

describe("ModalDrawer", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset["cmReducedMotion"];
  });

  it("moves focus into the dialog, contains it, and restores it on Escape", async () => {
    const { container } = render(<ModalHarness />);

    const trigger = screen.getByRole("button", {
      name: "Open revision review",
    });
    const outside = screen.getByRole("button", { name: "Outside action" });
    trigger.focus();
    fireEvent.click(trigger);

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Create immutable revision",
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(
      screen.getByRole("dialog", { name: "Create immutable revision" }),
    ).toHaveAttribute("aria-modal", "true");
    expect(container).toHaveAttribute("aria-hidden", "true");
    expect(container).toHaveAttribute("inert");
    expect(heading.closest(".cm-modal-drawer__backdrop")).not.toHaveAttribute(
      "inert",
    );

    outside.focus();
    expect(heading).toHaveFocus();

    fireEvent.keyDown(heading, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Create immutable revision" }),
    ).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute("aria-hidden");
    expect(container).not.toHaveAttribute("inert");
    expect(trigger).toHaveFocus();
  });

  it("prefers a connected explicit return target when the modal closes", async () => {
    render(<ExplicitReturnFocusHarness />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open explicit focus review" }),
    );
    const heading = screen.getByRole("heading", {
      name: "Explicit focus review",
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    fireEvent.keyDown(heading, { key: "Escape" });

    expect(
      screen.getByRole("button", { name: "Explicit return target" }),
    ).toHaveFocus();
  });

  it("wraps Tab and Shift+Tab within the modal controls", async () => {
    render(<ModalHarness />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open revision review" }),
    );

    const heading = screen.getByRole("heading", {
      name: "Create immutable revision",
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });

    const close = screen.getByRole("button", { name: "Close" });
    const create = screen.getByRole("button", { name: "Create revision" });

    create.focus();
    fireEvent.keyDown(create, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(create).toHaveFocus();
  });

  it("excludes controls inside inactive tab panels from the focus trap", async () => {
    render(
      <ModalDrawer onClose={() => undefined} open title="Review configuration">
        <Tabs
          ariaLabel="Configuration sections"
          items={[
            {
              id: "active",
              label: "Active",
              panel: <button type="button">Visible panel action</button>,
            },
            {
              id: "inactive",
              label: "Inactive",
              panel: <button type="button">Inactive panel action</button>,
            },
          ]}
          onValueChange={() => undefined}
          value="active"
        />
      </ModalDrawer>,
    );

    const heading = screen.getByRole("heading", {
      name: "Review configuration",
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });

    const visibleAction = screen.getByRole("button", {
      name: "Visible panel action",
    });
    visibleAction.focus();
    fireEvent.keyDown(visibleAction, { key: "Tab" });

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("makes a closing surface inert immediately and skips its exit delay for reduced motion", () => {
    vi.useFakeTimers();
    document.documentElement.dataset["cmReducedMotion"] = "true";
    const { rerender } = render(
      <ModalDrawer onClose={() => undefined} open title="Reduced motion review">
        <p>Review content</p>
      </ModalDrawer>,
    );

    rerender(
      <ModalDrawer
        onClose={() => undefined}
        open={false}
        title="Reduced motion review"
      >
        <p>Review content</p>
      </ModalDrawer>,
    );

    const lingeringBackdrop = document.querySelector(
      ".cm-modal-drawer__backdrop",
    );
    expect(lingeringBackdrop).toHaveAttribute("aria-hidden", "true");
    expect(lingeringBackdrop).toHaveAttribute("inert");
    expect(lingeringBackdrop).toHaveAttribute("data-state", "closed");
    expect(
      screen.queryByRole("dialog", { name: "Reduced motion review" }),
    ).not.toBeInTheDocument();

    act(() => {
      vi.runAllTimers();
    });
    expect(
      document.querySelector(".cm-modal-drawer__backdrop"),
    ).not.toBeInTheDocument();
  });
});
