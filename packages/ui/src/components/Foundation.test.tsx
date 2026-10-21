import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import axe from "axe-core";
import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Button,
  Checkbox,
  Disclosure,
  Dialog,
  Drawer,
  FormField,
  Input,
  OverlayBoundaryProvider,
  Popover,
  RadioGroup,
  ResizeHandle,
  ServiceIconContainer,
  Tooltip,
} from "../index.js";

afterEach(() => {
  delete document.documentElement.dataset["cmReducedMotion"];
});

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Open inspector
      </button>
      <button type="button">Outside action</button>
      <Drawer
        onClose={() => {
          setOpen(false);
        }}
        open={open}
        title="Inspector"
      >
        <button type="button">Drawer action</button>
      </Drawer>
    </>
  );
}

function DrawerFocusHandoffHarness() {
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [destinationVisible, setDestinationVisible] = useState(false);
  const destinationRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (destinationVisible) {
      destinationRef.current?.focus();
    }
  }, [destinationVisible]);

  return (
    <>
      <button
        onClick={() => {
          setDrawerMounted(true);
          setDestinationVisible(false);
        }}
        type="button"
      >
        Open review
      </button>
      {destinationVisible ? (
        <h1 ref={destinationRef} tabIndex={-1}>
          Review destination
        </h1>
      ) : null}
      {drawerMounted ? (
        <Drawer
          onClose={() => {
            setDrawerMounted(false);
          }}
          open
          title="Review"
        >
          <button
            onClick={() => {
              setDestinationVisible(true);
              setDrawerMounted(false);
            }}
            type="button"
          >
            Continue to destination
          </button>
        </Drawer>
      ) : null}
    </>
  );
}

function DrawerToModalHarness({
  disconnectedReturnTarget = false,
}: {
  readonly disconnectedReturnTarget?: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <>
      <button
        onClick={() => {
          returnFocusRef.current = disconnectedReturnTarget
            ? document.createElement("button")
            : launcherRef.current;
          setDrawerOpen(true);
        }}
        ref={launcherRef}
        type="button"
      >
        Open connection inspector
      </button>
      <Drawer
        onClose={() => {
          setDrawerOpen(false);
        }}
        open={drawerOpen}
        returnFocusRef={returnFocusRef}
        title="Connection inspector"
      >
        <button
          onClick={() => {
            setModalOpen(true);
          }}
          type="button"
        >
          Start connection workflow
        </button>
      </Drawer>
      <Dialog
        onClose={() => {
          setModalOpen(false);
        }}
        open={modalOpen}
        title="Connection workflow"
      >
        <button type="button">Review connection</button>
      </Dialog>
    </>
  );
}

function NestedDrawerModalHarness() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => {
          setDrawerOpen(true);
        }}
        type="button"
      >
        Open service catalog
      </button>
      <Drawer
        onClose={() => {
          setDrawerOpen(false);
        }}
        open={drawerOpen}
        title="Service catalog"
      >
        <button
          onClick={() => {
            setModalOpen(true);
          }}
          type="button"
        >
          Show Lambda details
        </button>
        <Dialog
          onClose={() => {
            setModalOpen(false);
          }}
          open={modalOpen}
          title="Lambda function details"
        >
          <button type="button">Review Lambda guidance</button>
        </Dialog>
      </Drawer>
    </>
  );
}

function PopoverDrawerModalHarness() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <>
      <Popover
        label="Canvas actions"
        onOpenChange={setMenuOpen}
        open={menuOpen}
        trigger="Canvas"
        triggerLabel="Open Canvas menu"
      >
        <button
          onClick={(event) => {
            drawerReturnFocusRef.current = event.currentTarget;
            setMenuOpen(false);
            setDrawerOpen(true);
          }}
          type="button"
        >
          Open Architecture inspector
        </button>
      </Popover>
      <Drawer
        onClose={() => {
          setDrawerOpen(false);
        }}
        open={drawerOpen}
        returnFocusRef={drawerReturnFocusRef}
        title="Architecture inspector"
      >
        <button
          onClick={(event) => {
            drawerReturnFocusRef.current = event.currentTarget;
          }}
          type="button"
        >
          Show internal details
        </button>
        <button
          onClick={() => {
            setModalOpen(true);
          }}
          type="button"
        >
          Start connection workflow
        </button>
      </Drawer>
      <Dialog
        onClose={() => {
          setModalOpen(false);
        }}
        open={modalOpen}
        title="Connection workflow"
      >
        <button type="button">Review connection</button>
      </Dialog>
    </>
  );
}

function BoundaryPopoverHarness() {
  const boundaryRef = useRef<HTMLDivElement>(null);

  return (
    <OverlayBoundaryProvider boundaryRef={boundaryRef}>
      <Popover
        label="Canvas actions"
        trigger="Canvas"
        triggerLabel="Open bounded Canvas menu"
      >
        Fit architecture
      </Popover>
      <div data-popover-boundary="" ref={boundaryRef} />
    </OverlayBoundaryProvider>
  );
}

function PortaledAdjacentPopoverHarness({
  preferredPlacement,
}: {
  readonly preferredPlacement: "left" | "right";
}) {
  const ownerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <div data-popover-owner ref={ownerRef}>
      <Popover
        adjacentPositioning={{
          anchorRef,
          ownerRef,
          preferredPlacement,
        }}
        label="Connection information"
        renderContent={(content) => createPortal(content, document.body)}
        trigger={
          <span data-popover-anchor ref={anchorRef}>
            Connections
          </span>
        }
        triggerLabel="Open connection information"
      >
        <button type="button">Inspect exact connection</button>
      </Popover>
    </div>
  );
}

describe("CloudMarkup visual foundation", () => {
  it("keeps modeless drawer focus escapable and restores it on document Escape", async () => {
    render(
      <StrictMode>
        <DrawerHarness />
      </StrictMode>,
    );
    const trigger = screen.getByRole("button", { name: "Open inspector" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("heading", { name: "Inspector" })).toHaveFocus();
    const outside = screen.getByRole("button", { name: "Outside action" });
    outside.focus();
    expect(outside).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Inspector" })).toBeNull();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Inspector" })).toBeNull();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("does not override a deliberate connected focus destination when unmounted", async () => {
    render(
      <StrictMode>
        <DrawerFocusHandoffHarness />
      </StrictMode>,
    );
    const trigger = screen.getByRole("button", { name: "Open review" });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to destination" }),
    );

    const destination = screen.getByRole("heading", {
      level: 1,
      name: "Review destination",
    });
    await waitFor(() => {
      expect(destination).toHaveFocus();
    });
    expect(trigger).not.toHaveFocus();
  });

  it("supports named keyboard and pointer resizing without a divider menu", () => {
    const change = vi.fn();
    render(
      <ResizeHandle
        label="Resize catalog"
        maximum={400}
        minimum={224}
        onChange={change}
        orientation="vertical"
        value={280}
      />,
    );

    const separator = screen.getByRole("separator", {
      name: "Resize catalog",
    });
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuemin", "224");
    expect(separator).toHaveAttribute("aria-valuemax", "400");
    expect(separator).toHaveAttribute("aria-valuenow", "280");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(change).toHaveBeenLastCalledWith(288);
    fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    expect(change).toHaveBeenLastCalledWith(248);
    fireEvent.keyDown(separator, { key: "End" });
    expect(change).toHaveBeenLastCalledWith(400);
    fireEvent.pointerDown(separator, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 120, pointerId: 1 });
    expect(change).toHaveBeenLastCalledWith(300);
    fireEvent.pointerUp(separator, { clientX: 120, pointerId: 1 });
    const callsAfterPointerUp = change.mock.calls.length;
    fireEvent.pointerDown(separator, { clientX: 100, pointerId: 2 });
    fireEvent.pointerCancel(separator, { pointerId: 2 });
    fireEvent.pointerMove(separator, { clientX: 140, pointerId: 2 });
    expect(change).toHaveBeenCalledTimes(callsAfterPointerUp);
    expect(screen.queryByText("Panel options")).toBeNull();
  });

  it("opens a shared information popover on hover, focus, and pinned click", async () => {
    render(
      <Popover
        label="Example service information"
        openOnHoverOrFocus
        renderContent={(content) => createPortal(content, document.body)}
        trigger="i"
        triggerLabel="More information about Example service"
      >
        <button type="button">Availability and infrastructure metadata</button>
      </Popover>,
    );

    const trigger = screen.getByRole("button", {
      name: "More information about Example service",
    });
    const root = trigger.closest(".cm-popover");
    if (root === null) {
      throw new Error("The popover root did not render.");
    }

    fireEvent.mouseEnter(root);
    const hoverContent = screen.getByRole("dialog", {
      name: "Example service information",
    });
    expect(hoverContent).toBeVisible();
    fireEvent.mouseLeave(root);
    expect(hoverContent).toBeVisible();
    fireEvent.mouseEnter(hoverContent);
    await act(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 150);
        }),
    );
    expect(hoverContent).toBeVisible();
    fireEvent.mouseLeave(hoverContent);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Example service information" }),
      ).toBeNull();
    });

    fireEvent.mouseEnter(root);
    expect(
      screen.getByRole("dialog", { name: "Example service information" }),
    ).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Example service information" }),
    ).toBeNull();
    expect(trigger).toHaveFocus();
    await act(async () => Promise.resolve());

    fireEvent.focus(trigger);
    expect(
      screen.getByRole("dialog", { name: "Example service information" }),
    ).toBeVisible();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Example service information" }),
    ).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.mouseLeave(root);
    expect(
      screen.getByRole("dialog", { name: "Example service information" }),
    ).toBeVisible();
    const popoverAction = screen.getByRole("button", {
      name: "Availability and infrastructure metadata",
    });
    popoverAction.focus();
    fireEvent.keyDown(popoverAction, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Example service information" }),
    ).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.mouseLeave(root);
    expect(
      screen.getByRole("dialog", { name: "Example service information" }),
    ).toBeVisible();
    fireEvent.click(trigger);
    expect(
      screen.queryByRole("dialog", { name: "Example service information" }),
    ).toBeNull();
  });

  it("supports a parent-controlled popover without duplicating its surface", () => {
    function ControlledPopover() {
      const [open, setOpen] = useState(false);
      return (
        <Popover
          label="Canvas actions"
          onOpenChange={setOpen}
          open={open}
          trigger="Canvas"
          triggerLabel="Open Canvas menu"
        >
          <button
            onClick={() => {
              setOpen(false);
            }}
            type="button"
          >
            Fit architecture
          </button>
        </Popover>
      );
    }

    render(<ControlledPopover />);

    const trigger = screen.getByRole("button", {
      name: "Open Canvas menu",
    });
    fireEvent.click(trigger);
    expect(
      screen.getByRole("dialog", { name: "Canvas actions" }),
    ).toBeVisible();
    const action = screen.getByRole("button", { name: "Fit architecture" });
    action.focus();
    fireEvent.click(action);
    expect(screen.queryByRole("dialog", { name: "Canvas actions" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps only one transient popover open at a time", () => {
    render(
      <>
        <Popover
          label="First menu"
          trigger="First"
          triggerLabel="Open first menu"
        >
          First content
        </Popover>
        <Popover
          label="Second menu"
          trigger="Second"
          triggerLabel="Open second menu"
        >
          Second content
        </Popover>
      </>,
    );

    const firstTrigger = screen.getByRole("button", {
      name: "Open first menu",
    });
    const secondTrigger = screen.getByRole("button", {
      name: "Open second menu",
    });
    fireEvent.click(firstTrigger);
    expect(screen.getByRole("dialog", { name: "First menu" })).toBeVisible();

    fireEvent.click(secondTrigger);

    expect(firstTrigger).toHaveAttribute("aria-expanded", "false");
    expect(secondTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("dialog", { name: "First menu" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Second menu" })).toBeVisible();
  });

  it("coordinates controlled and initially open transient popovers", () => {
    function ControlledPopovers() {
      const [firstOpen, setFirstOpen] = useState(false);
      const [secondOpen, setSecondOpen] = useState(false);

      return (
        <>
          <button
            onClick={() => {
              setFirstOpen(true);
            }}
            type="button"
          >
            Programmatically open first
          </button>
          <button
            onClick={() => {
              setSecondOpen(true);
            }}
            type="button"
          >
            Programmatically open second
          </button>
          <Popover
            label="Controlled first"
            onOpenChange={setFirstOpen}
            open={firstOpen}
            trigger="First"
            triggerLabel="Open controlled first"
          >
            First controlled content
          </Popover>
          <Popover
            label="Controlled second"
            onOpenChange={setSecondOpen}
            open={secondOpen}
            trigger="Second"
            triggerLabel="Open controlled second"
          >
            Second controlled content
          </Popover>
        </>
      );
    }

    const initialRender = render(
      <>
        <Popover
          defaultOpen
          label="Initial first"
          trigger="First"
          triggerLabel="Open initial first"
        >
          First initial content
        </Popover>
        <Popover
          defaultOpen
          label="Initial second"
          trigger="Second"
          triggerLabel="Open initial second"
        >
          Second initial content
        </Popover>
      </>,
    );
    expect(screen.queryByRole("dialog", { name: "Initial first" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Initial second" }),
    ).toBeVisible();

    initialRender.unmount();
    render(<ControlledPopovers />);
    fireEvent.click(
      screen.getByRole("button", { name: "Programmatically open first" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Controlled first" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Programmatically open second" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Controlled first" }),
    ).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Controlled second" }),
    ).toBeVisible();
  });

  it("dismisses transient popovers before a modal takes focus", () => {
    function ModalAfterPopover() {
      const [modalOpen, setModalOpen] = useState(false);
      return (
        <>
          <Popover
            label="Connection menu"
            trigger="Connect"
            triggerLabel="Open connection menu"
          >
            Connection details
          </Popover>
          <button
            onClick={() => {
              setModalOpen(true);
            }}
            type="button"
          >
            Open connection review
          </button>
          <Dialog
            onClose={() => {
              setModalOpen(false);
            }}
            open={modalOpen}
            title="Connection review"
          >
            Review changes
          </Dialog>
        </>
      );
    }

    render(<ModalAfterPopover />);
    const popoverTrigger = screen.getByRole("button", {
      name: "Open connection menu",
    });
    fireEvent.click(popoverTrigger);
    expect(
      screen.getByRole("dialog", { name: "Connection menu" }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Open connection review" }),
    );

    expect(popoverTrigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("dialog", { name: "Connection menu" }),
    ).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Connection review" }),
    ).toBeVisible();
  });

  it("closes a modeless inspector when a modal workflow takes focus", async () => {
    render(<DrawerToModalHarness />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open connection inspector" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start connection workflow" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Connection inspector" }),
      ).toBeNull();
    });
    const workflow = screen.getByRole("dialog", {
      name: "Connection workflow",
    });
    expect(workflow).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Connection workflow" }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Connection workflow" }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Open connection inspector" }),
    ).toHaveFocus();
  });

  it("keeps a logical owner open when its portaled modal takes focus", async () => {
    render(<NestedDrawerModalHarness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open service catalog" }),
    );
    const catalog = screen.getByRole("dialog", { name: "Service catalog" });
    const detailsTrigger = screen.getByRole("button", {
      name: "Show Lambda details",
    });
    detailsTrigger.focus();
    fireEvent.click(detailsTrigger);

    const details = screen.getByRole("dialog", {
      name: "Lambda function details",
    });
    expect(details).toBeVisible();
    expect(catalog).toBeVisible();
    expect(catalog).toHaveAttribute("data-cm-modeless-drawer");
    expect(details.closest(".cm-drawer")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Lambda function details" }),
    ).toHaveFocus();

    fireEvent.click(within(details).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Lambda function details" }),
      ).toBeNull();
    });
    expect(catalog).toBeVisible();
    expect(detailsTrigger).toHaveFocus();
  });

  it("hands focus from a popover action through a drawer and modal back to the stable trigger", async () => {
    document.documentElement.dataset["cmReducedMotion"] = "true";
    render(<PopoverDrawerModalHarness />);

    const canvasTrigger = screen.getByRole("button", {
      name: "Open Canvas menu",
    });
    fireEvent.click(canvasTrigger);
    const architectureAction = screen.getByRole("button", {
      name: "Open Architecture inspector",
    });
    architectureAction.focus();
    fireEvent.click(architectureAction);
    await waitFor(() => {
      expect(architectureAction.isConnected).toBe(false);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Show internal details" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start connection workflow" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Architecture inspector" }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("heading", { name: "Connection workflow" }),
    ).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Connection workflow" }),
      ).toBeNull();
    });
    expect(canvasTrigger).toHaveFocus();
  });

  it("positions portaled adjacent content beside its owner and tracks transformed anchors", async () => {
    let ownerLeft = 500;
    let frameCallback: FrameRequestCallback | undefined;
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset["popoverOwner"] !== undefined) {
          return new DOMRect(ownerLeft, 200, 200, 160);
        }
        if (this.dataset["popoverAnchor"] !== undefined) {
          return new DOMRect(ownerLeft + 192, 260, 16, 20);
        }
        if (this.classList.contains("cm-popover__content")) {
          return new DOMRect(0, 0, 352, 240);
        }
        return new DOMRect();
      },
    );

    render(<PortaledAdjacentPopoverHarness preferredPlacement="right" />);
    const trigger = screen.getByRole("button", {
      name: "Open connection information",
    });
    fireEvent.click(trigger);
    const content = screen.getByRole("dialog", {
      name: "Connection information",
    });

    await waitFor(() => {
      expect(content).toHaveAttribute("data-placement", "right");
      expect(content).toHaveStyle({
        left: "708px",
        maxHeight: "768px",
        top: "200px",
        width: "352px",
      });
    });
    expect(content.parentElement).toBe(document.body);
    expect(content.style.getPropertyValue("placement")).toBe("");

    ownerLeft = 1000;
    const pendingFrame = frameCallback;
    if (pendingFrame === undefined) {
      throw new Error("The adjacent popover did not start anchor tracking.");
    }
    act(() => {
      pendingFrame(0);
    });
    await waitFor(() => {
      expect(content).toHaveAttribute("data-placement", "left");
      expect(content).toHaveStyle({ left: "640px", top: "200px" });
    });

    const action = screen.getByRole("button", {
      name: "Inspect exact connection",
    });
    fireEvent.pointerDown(action);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    action.focus();
    fireEvent.keyDown(action, { key: "Escape" });
    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
  });

  it("associates native forms and preserves mode action parity", () => {
    const setMode = vi.fn();
    render(
      <>
        <FormField
          error="Enter a project name."
          htmlFor="project-name"
          label="Project name"
          information={<button type="button">Project name help</button>}
          required
        >
          <Input aria-invalid="true" id="project-name" />
        </FormField>
        <Checkbox label="Show explanations" />
        <RadioGroup
          legend="Experience"
          name="experience"
          onValueChange={setMode}
          options={[
            { label: "Guided", value: "guided" },
            { label: "Professional", value: "professional" },
          ]}
          value="guided"
        />
        <Button>Save presentation preference</Button>
      </>,
    );

    expect(screen.getByLabelText(/Project name/u)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText(/Project name/u)).toHaveAccessibleDescription(
      "Enter a project name.",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Professional" }));
    const fieldHelp = screen.getByRole("button", {
      name: "Project name help",
    });
    expect(fieldHelp.closest("label")).toBeNull();
    expect(setMode).toHaveBeenCalledWith("professional");
    expect(
      screen.getByRole("button", { name: "Save presentation preference" }),
    ).toBeEnabled();
  });

  it("names service placeholders and makes tooltip help keyboard dismissible", () => {
    render(
      <>
        <ServiceIconContainer label="Example queue" />
        <Tooltip content="This help is supplemental.">
          <button type="button">Connection help</button>
        </Tooltip>
        <Disclosure summary="Advanced">
          <label>
            Preserved value
            <input defaultValue="kept" />
          </label>
        </Disclosure>
      </>,
    );

    expect(
      screen.getByRole("img", {
        name: "Example queue service icon placeholder",
      }),
    ).toBeVisible();
    const help = screen.getByRole("button", { name: "Connection help" });
    fireEvent.focus(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "This help is supplemental.",
    );
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a directional trigger name until its detailed popover opens", () => {
    render(
      <Popover
        label="Invokes output connections"
        trigger={<span>Blue dot</span>}
        triggerLabel="Open Invokes output connections"
        triggerTooltip={{ content: "Output: Invokes", placement: "right" }}
      >
        <p>Exact connection information</p>
      </Popover>,
    );

    const trigger = screen.getByRole("button", {
      name: "Open Invokes output connections",
    });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Output: Invokes");
    expect(tooltip.parentElement).toHaveAttribute("data-placement", "right");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);

    fireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).not.toHaveAttribute("aria-describedby");
    expect(
      screen.getByRole("dialog", { name: "Invokes output connections" }),
    ).toBeVisible();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Invokes output connections" }),
    ).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("portals a directional trigger tooltip beyond a scrolling owner", async () => {
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("cm-tooltip__content")) {
          return new DOMRect(0, 0, 80, 20);
        }
        if (
          this.classList.contains("cm-tooltip") &&
          !this.classList.contains("cm-tooltip--portal")
        ) {
          return new DOMRect(100, 40, 20, 40);
        }
        return new DOMRect();
      },
    );

    const { container } = render(
      <div style={{ overflow: "auto" }}>
        <Popover
          label="Invokes output connections"
          trigger={<span>Blue dot</span>}
          triggerLabel="Open Invokes output connections"
          triggerTooltip={{
            content: "Output: Invokes",
            placement: "right",
            renderInPortal: true,
          }}
        >
          <p>Exact connection information</p>
        </Popover>
      </div>,
    );

    const trigger = screen.getByRole("button", {
      name: "Open Invokes output connections",
    });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole("tooltip");
    const portal = tooltip.parentElement;
    expect(portal).not.toBeNull();
    expect(container).not.toContainElement(tooltip);
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
    await waitFor(() => {
      expect(portal).toHaveAttribute("data-placement", "right");
      expect(portal).toHaveStyle({
        left: "128px",
        top: "50px",
        visibility: "visible",
      });
    });

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("has no detectable axe violations in a representative light foundation", async () => {
    const { container } = render(
      <main>
        <h1>Foundation accessibility fixture</h1>
        <FormField
          description="Visible and programmatically associated label."
          htmlFor="fixture-name"
          label="Name"
        >
          <Input id="fixture-name" />
        </FormField>
        <Button variant="primary">Continue</Button>
        <ServiceIconContainer label="Synthetic service" />
      </main>,
    );

    const results = await axe.run(container, {
      rules: {
        // JSDOM has no canvas implementation for axe's contrast measurement;
        // Storybook's browser addon retains the real color-contrast rule.
        "color-contrast": { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });

  it("falls back to the active launcher when an explicit drawer return target is disconnected", async () => {
    render(<DrawerToModalHarness disconnectedReturnTarget />);

    const launcher = screen.getByRole("button", {
      name: "Open connection inspector",
    });
    launcher.focus();
    fireEvent.click(launcher);
    fireEvent.click(
      screen.getByRole("button", { name: "Start connection workflow" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Connection workflow" }),
      ).toBeNull();
    });
    expect(launcher).toHaveFocus();
  });

  it("clamps a default popover below the top of its explicit boundary", async () => {
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset["popoverBoundary"] !== undefined) {
          return new DOMRect(0, 56, 1440, 844);
        }
        if (this.classList.contains("cm-popover__trigger")) {
          return new DOMRect(1000, 8, 120, 40);
        }
        return new DOMRect();
      },
    );

    render(<BoundaryPopoverHarness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open bounded Canvas menu" }),
    );
    const content = screen.getByRole("dialog", { name: "Canvas actions" });

    await waitFor(() => {
      expect(content).toHaveStyle({
        maxHeight: "812px",
        top: "72px",
      });
    });
  });

  it("preserves the preferred adjacent side and clamps when neither side fits", async () => {
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset["popoverOwner"] !== undefined) {
          return new DOMRect(100, 200, 1000, 160);
        }
        if (this.dataset["popoverAnchor"] !== undefined) {
          return new DOMRect(92, 300, 16, 20);
        }
        if (this.classList.contains("cm-popover__content")) {
          return new DOMRect(0, 0, 352, 240);
        }
        return new DOMRect();
      },
    );

    render(<PortaledAdjacentPopoverHarness preferredPlacement="left" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open connection information" }),
    );
    const content = screen.getByRole("dialog", {
      name: "Connection information",
    });
    await waitFor(() => {
      expect(content).toHaveAttribute("data-placement", "left");
      expect(content).toHaveStyle({ left: "16px", top: "200px" });
    });
  });
});
