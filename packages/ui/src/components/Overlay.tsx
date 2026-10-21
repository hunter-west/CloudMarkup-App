import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  FocusEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from "react";
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { ModalDrawerProps } from "./ModalDrawer.js";
import { ModalDrawer } from "./ModalDrawer.js";
import {
  dismissTransientOverlays,
  observeModalOverlayOpening,
  observeTransientOverlayDismissal,
} from "./overlay-events.js";
import { useOverlayBoundary } from "./overlay-boundary.js";
import { OverlayOwnerContext } from "./overlay-owner.js";
import { useOverlayPresence } from "./useOverlayPresence.js";

export type DialogProps = Omit<ModalDrawerProps, "kind">;

/** A modal, focus-contained bounded task surface. */
export function Dialog(props: DialogProps) {
  return <ModalDrawer {...props} kind="modal" />;
}

export interface DrawerProps extends Omit<
  ComponentPropsWithoutRef<"section">,
  "children" | "title"
> {
  readonly children: ReactNode;
  readonly closeLabel?: string;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly placement?: "bottom" | "start" | "end";
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly title: string;
}

function getMeaningfulActiveElement(): HTMLElement | null {
  const activeElement = document.activeElement;
  if (
    !(activeElement instanceof HTMLElement) ||
    !activeElement.isConnected ||
    activeElement === document.body ||
    activeElement === document.documentElement ||
    activeElement.closest("[hidden], [aria-hidden='true'], [inert]") !== null
  ) {
    return null;
  }

  return activeElement;
}

function isUsableReturnFocusTarget(
  target: HTMLElement | null | undefined,
  excludedContainer?: HTMLElement | null,
): target is HTMLElement {
  return (
    target?.isConnected === true &&
    excludedContainer?.contains(target) !== true &&
    target.closest("[hidden], [aria-hidden='true'], [inert]") === null
  );
}

/**
 * A modeless drawer. It enters the page focus order, does not trap focus, and
 * restores focus to the invoking control when closed.
 */
export function Drawer({
  children,
  className,
  closeLabel = "Close",
  description,
  footer,
  onClose,
  open,
  placement = "end",
  returnFocusRef,
  title,
  ...rest
}: DrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const restorationTargetRef = useRef<HTMLElement | null>(null);
  const transientReturnTargetRef = useRef<HTMLElement | null>(null);
  const dismissalFocusRef = useRef<HTMLElement | null>(null);
  const focusCycleRef = useRef(0);
  const presence = useOverlayPresence(open);
  const overlayBoundary = useOverlayBoundary();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const cycle = focusCycleRef.current + 1;
    focusCycleRef.current = cycle;

    const restoreFocus = () => {
      const requestedTarget = returnFocusRef?.current;
      const connectedExternalTarget = isUsableReturnFocusTarget(
        requestedTarget,
        drawerRef.current,
      )
        ? requestedTarget
        : null;
      const previous =
        connectedExternalTarget ??
        (restorationTargetRef.current?.isConnected === true
          ? restorationTargetRef.current
          : transientReturnTargetRef.current);
      if (previous === null) {
        dismissalFocusRef.current = null;
        return;
      }

      queueMicrotask(() => {
        if (focusCycleRef.current !== cycle) {
          return;
        }

        const activeElement = getMeaningfulActiveElement();
        const dismissalFocus = dismissalFocusRef.current;
        const focusMovedDeliberately =
          activeElement !== null &&
          activeElement !== previous &&
          (dismissalFocus === null || activeElement !== dismissalFocus);

        if (!focusMovedDeliberately && previous.isConnected) {
          previous.focus();
        }

        restorationTargetRef.current = null;
        transientReturnTargetRef.current = null;
        dismissalFocusRef.current = null;
      });
    };

    if (!open) {
      restoreFocus();
      return undefined;
    }

    const activeBeforeDismissal = getMeaningfulActiveElement();
    transientReturnTargetRef.current = dismissTransientOverlays(
      drawerRef.current?.ownerDocument ?? globalThis.document,
    );
    const requestedReturnTarget = returnFocusRef?.current;
    const connectedExternalTarget = isUsableReturnFocusTarget(
      requestedReturnTarget,
      drawerRef.current,
    )
      ? requestedReturnTarget
      : null;
    restorationTargetRef.current ??=
      connectedExternalTarget ??
      transientReturnTargetRef.current ??
      activeBeforeDismissal;
    titleRef.current?.focus();

    return restoreFocus;
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      const drawers = document.querySelectorAll<HTMLElement>(
        "[data-cm-modeless-drawer]",
      );
      const topmost = drawers.item(drawers.length - 1);
      if (event.key === "Escape" && topmost === drawerRef.current) {
        event.preventDefault();
        event.stopPropagation();
        dismissalFocusRef.current = getMeaningfulActiveElement();
        onCloseRef.current();
      }
    };

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    const drawer = drawerRef.current;
    const boundary = overlayBoundary?.current;
    const view = drawer?.ownerDocument.defaultView;
    if (
      drawer === null ||
      boundary === null ||
      boundary === undefined ||
      view === null ||
      view === undefined
    ) {
      return undefined;
    }

    const updateBoundaryInsets = () => {
      const bounds = boundary.getBoundingClientRect();
      drawer.style.setProperty(
        "--cm-overlay-boundary-top",
        `${String(Math.max(0, bounds.top))}px`,
      );
      drawer.style.setProperty(
        "--cm-overlay-boundary-right",
        `${String(Math.max(0, view.innerWidth - bounds.right))}px`,
      );
      drawer.style.setProperty(
        "--cm-overlay-boundary-bottom",
        `${String(Math.max(0, view.innerHeight - bounds.bottom))}px`,
      );
      drawer.style.setProperty(
        "--cm-overlay-boundary-left",
        `${String(Math.max(0, bounds.left))}px`,
      );
    };
    updateBoundaryInsets();
    view.addEventListener("resize", updateBoundaryInsets);
    view.addEventListener("scroll", updateBoundaryInsets, true);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateBoundaryInsets);
    resizeObserver?.observe(boundary);

    return () => {
      view.removeEventListener("resize", updateBoundaryInsets);
      view.removeEventListener("scroll", updateBoundaryInsets, true);
      resizeObserver?.disconnect();
    };
  }, [open, overlayBoundary]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const ownerDocument =
      drawerRef.current?.ownerDocument ?? globalThis.document;
    return observeModalOverlayOpening(
      ownerDocument,
      (openingOwner, claimReturnFocusTarget) => {
        if (openingOwner === drawerRef.current) {
          return;
        }
        const drawers = ownerDocument.querySelectorAll<HTMLElement>(
          "[data-cm-modeless-drawer]",
        );
        if (drawers.item(drawers.length - 1) === drawerRef.current) {
          const requestedReturnTarget = returnFocusRef?.current;
          const returnTarget = isUsableReturnFocusTarget(
            requestedReturnTarget,
            drawerRef.current,
          )
            ? requestedReturnTarget
            : restorationTargetRef.current?.isConnected === true
              ? restorationTargetRef.current
              : transientReturnTargetRef.current;
          if (returnTarget?.isConnected === true) {
            claimReturnFocusTarget(returnTarget);
          }
        }
        dismissalFocusRef.current = getMeaningfulActiveElement();
        onCloseRef.current();
      },
    );
  }, [open, returnFocusRef]);

  if (!presence.present) {
    return null;
  }

  const classes = ["cm-drawer", className].filter(Boolean).join(" ");

  return (
    <section
      {...rest}
      aria-describedby={description === undefined ? undefined : descriptionId}
      aria-hidden={open ? undefined : "true"}
      aria-labelledby={titleId}
      className={classes}
      data-cm-modeless-drawer={open ? "" : undefined}
      data-placement={placement}
      data-state={presence.state}
      inert={open ? undefined : true}
      ref={drawerRef}
      role="dialog"
    >
      <header className="cm-drawer__header">
        <h2
          className="cm-drawer__title"
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
        >
          {title}
        </h2>
        <button
          aria-label={closeLabel}
          className="cm-drawer__close"
          onClick={() => {
            dismissalFocusRef.current = getMeaningfulActiveElement();
            onClose();
          }}
          type="button"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </header>
      <OverlayOwnerContext.Provider value={drawerRef}>
        {description === undefined ? null : (
          <div className="cm-drawer__description" id={descriptionId}>
            {description}
          </div>
        )}
        <div className="cm-drawer__body">{children}</div>
        {footer === undefined ? null : (
          <footer className="cm-drawer__footer">{footer}</footer>
        )}
      </OverlayOwnerContext.Provider>
    </section>
  );
}

interface TooltipTriggerProps {
  readonly "aria-describedby"?: string;
}

export interface TooltipProps {
  readonly children: ReactElement<TooltipTriggerProps>;
  readonly content: ReactNode;
  readonly disabled?: boolean;
  readonly placement?: TooltipPlacement;
  readonly renderInPortal?: boolean;
}

export type TooltipPlacement = "bottom" | "left" | "right" | "top";

interface TooltipPortalLayout {
  readonly left: number;
  readonly placement: TooltipPlacement;
  readonly top: number;
}

const TOOLTIP_PORTAL_GAP = 8;
const TOOLTIP_PORTAL_GUTTER = 8;

function oppositeTooltipPlacement(
  placement: TooltipPlacement,
): TooltipPlacement {
  switch (placement) {
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
  }
}

function tooltipPortalCoordinates(
  anchor: DOMRect,
  content: DOMRect,
  placement: TooltipPlacement,
): Pick<TooltipPortalLayout, "left" | "top"> {
  switch (placement) {
    case "bottom":
      return {
        left: anchor.left + (anchor.width - content.width) / 2,
        top: anchor.bottom + TOOLTIP_PORTAL_GAP,
      };
    case "left":
      return {
        left: anchor.left - content.width - TOOLTIP_PORTAL_GAP,
        top: anchor.top + (anchor.height - content.height) / 2,
      };
    case "right":
      return {
        left: anchor.right + TOOLTIP_PORTAL_GAP,
        top: anchor.top + (anchor.height - content.height) / 2,
      };
    case "top":
      return {
        left: anchor.left + (anchor.width - content.width) / 2,
        top: anchor.top - content.height - TOOLTIP_PORTAL_GAP,
      };
  }
}

function tooltipPortalOverflow(
  coordinates: Pick<TooltipPortalLayout, "left" | "top">,
  content: DOMRect,
  viewportHeight: number,
  viewportWidth: number,
): number {
  return (
    Math.max(TOOLTIP_PORTAL_GUTTER - coordinates.left, 0) +
    Math.max(
      coordinates.left +
        content.width -
        (viewportWidth - TOOLTIP_PORTAL_GUTTER),
      0,
    ) +
    Math.max(TOOLTIP_PORTAL_GUTTER - coordinates.top, 0) +
    Math.max(
      coordinates.top +
        content.height -
        (viewportHeight - TOOLTIP_PORTAL_GUTTER),
      0,
    )
  );
}

/** Supplemental help available through pointer hover, focus, and Escape. */
export function Tooltip({
  children,
  content,
  disabled = false,
  placement = "bottom",
  renderInPortal = false,
}: TooltipProps) {
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const shown = visible && !disabled;
  const presence = useOverlayPresence(shown);
  const priorDescription = children.props["aria-describedby"];
  const contentRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [portalLayout, setPortalLayout] = useState<TooltipPortalLayout>();
  const assignRootRef = useCallback((element: HTMLSpanElement | null) => {
    rootRef.current = element;
    if (element !== null) {
      const nextPortalTarget = element.ownerDocument.body;
      setPortalTarget((current) =>
        current === nextPortalTarget ? current : nextPortalTarget,
      );
    }
  }, []);
  const describedBy = [priorDescription, shown ? tooltipId : undefined]
    .filter(Boolean)
    .join(" ");

  useLayoutEffect(() => {
    if (!shown || !renderInPortal) {
      return undefined;
    }
    const root = rootRef.current;
    const tooltip = contentRef.current;
    const view = root?.ownerDocument.defaultView;
    if (
      root === null ||
      tooltip === null ||
      view === null ||
      view === undefined
    ) {
      return undefined;
    }

    const updateLayout = () => {
      const anchorBounds = root.getBoundingClientRect();
      const tooltipBounds = tooltip.getBoundingClientRect();
      const preferredCoordinates = tooltipPortalCoordinates(
        anchorBounds,
        tooltipBounds,
        placement,
      );
      const oppositePlacement = oppositeTooltipPlacement(placement);
      const oppositeCoordinates = tooltipPortalCoordinates(
        anchorBounds,
        tooltipBounds,
        oppositePlacement,
      );
      const preferredOverflow = tooltipPortalOverflow(
        preferredCoordinates,
        tooltipBounds,
        view.innerHeight,
        view.innerWidth,
      );
      const oppositeOverflow = tooltipPortalOverflow(
        oppositeCoordinates,
        tooltipBounds,
        view.innerHeight,
        view.innerWidth,
      );
      const resolvedPlacement =
        oppositeOverflow < preferredOverflow ? oppositePlacement : placement;
      const resolvedCoordinates =
        resolvedPlacement === placement
          ? preferredCoordinates
          : oppositeCoordinates;
      const maximumLeft = Math.max(
        TOOLTIP_PORTAL_GUTTER,
        view.innerWidth - TOOLTIP_PORTAL_GUTTER - tooltipBounds.width,
      );
      const maximumTop = Math.max(
        TOOLTIP_PORTAL_GUTTER,
        view.innerHeight - TOOLTIP_PORTAL_GUTTER - tooltipBounds.height,
      );
      const nextLayout = {
        left: clamp(
          resolvedCoordinates.left,
          TOOLTIP_PORTAL_GUTTER,
          maximumLeft,
        ),
        placement: resolvedPlacement,
        top: clamp(resolvedCoordinates.top, TOOLTIP_PORTAL_GUTTER, maximumTop),
      };
      setPortalLayout((current) =>
        current?.left === nextLayout.left &&
        current.placement === nextLayout.placement &&
        current.top === nextLayout.top
          ? current
          : nextLayout,
      );
    };

    updateLayout();
    const resizeObserver =
      typeof view.ResizeObserver === "undefined"
        ? null
        : new view.ResizeObserver(updateLayout);
    resizeObserver?.observe(root);
    resizeObserver?.observe(tooltip);
    view.addEventListener("resize", updateLayout);
    view.addEventListener("scroll", updateLayout, true);
    return () => {
      resizeObserver?.disconnect();
      view.removeEventListener("resize", updateLayout);
      view.removeEventListener("scroll", updateLayout, true);
    };
  }, [placement, renderInPortal, shown]);

  const hideAfterFocusLeaves = (event: FocusEvent<HTMLSpanElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setVisible(false);
  };

  const tooltipContent =
    !disabled && presence.present ? (
      <span
        aria-hidden={shown ? undefined : "true"}
        className="cm-tooltip__content"
        data-state={presence.state}
        id={tooltipId}
        ref={contentRef}
        role="tooltip"
      >
        {content}
      </span>
    ) : null;
  const portaledTooltip =
    renderInPortal && portalTarget !== null && tooltipContent !== null
      ? createPortal(
          <span
            className="cm-tooltip cm-tooltip--portal"
            data-placement={portalLayout?.placement ?? placement}
            style={{
              left: portalLayout?.left ?? 0,
              top: portalLayout?.top ?? 0,
              visibility: portalLayout === undefined ? "hidden" : undefined,
            }}
          >
            {tooltipContent}
          </span>,
          portalTarget,
        )
      : null;

  return (
    // The wrapper delegates hover/focus/Escape from its native trigger; it is
    // deliberately absent from the tab sequence.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span
      className="cm-tooltip"
      data-placement={placement}
      ref={assignRootRef}
      onBlur={hideAfterFocusLeaves}
      onFocus={() => {
        if (!disabled) {
          setVisible(true);
        }
      }}
      onKeyDown={(event) => {
        if (!disabled && event.key === "Escape") {
          event.stopPropagation();
          setVisible(false);
        }
      }}
      onMouseEnter={() => {
        if (!disabled) {
          setVisible(true);
        }
      }}
      onMouseLeave={() => {
        setVisible(false);
      }}
    >
      {cloneElement(
        children,
        describedBy.length === 0 ? {} : { "aria-describedby": describedBy },
      )}
      {renderInPortal ? portaledTooltip : tooltipContent}
    </span>
  );
}

export interface PopoverTriggerTooltip {
  readonly content: ReactNode;
  readonly placement?: TooltipPlacement;
  readonly renderInPortal?: boolean;
}

export interface PopoverProps {
  readonly adjacentPositioning?: PopoverAdjacentPositioning;
  readonly children: ReactNode;
  readonly className?: string;
  readonly defaultOpen?: boolean;
  readonly label: string;
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
  readonly openOnHoverOrFocus?: boolean;
  readonly renderContent?: (content: ReactNode) => ReactNode;
  readonly trigger: ReactNode;
  readonly triggerLabel: string;
  readonly triggerTooltip?: PopoverTriggerTooltip;
}

export type PopoverAdjacentPlacement = "left" | "right";

export interface PopoverAdjacentPositioning {
  /** The stable visual owner whose outer edge the popover sits beside. */
  readonly ownerRef: RefObject<HTMLElement | null>;
  /** Optional visual dot used for vertical alignment; the trigger is the fallback. */
  readonly anchorRef?: RefObject<HTMLElement | null>;
  readonly preferredPlacement: PopoverAdjacentPlacement;
}

interface PopoverContentLayout {
  readonly bottom?: number;
  readonly left: number;
  readonly maxHeight: number;
  readonly placement?: PopoverAdjacentPlacement;
  readonly top?: number;
  readonly width: number;
}

const POPOVER_VIEWPORT_GUTTER = 16;
const POPOVER_GAP = 8;
const POPOVER_MAX_WIDTH = 352;
const POPOVER_MIN_HEIGHT = 96;
const POPOVER_MIN_WIDTH = 160;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function contentLayoutsEqual(
  left: PopoverContentLayout | undefined,
  right: PopoverContentLayout,
): boolean {
  return (
    left !== undefined &&
    left.bottom === right.bottom &&
    left.left === right.left &&
    left.maxHeight === right.maxHeight &&
    left.placement === right.placement &&
    left.top === right.top &&
    left.width === right.width
  );
}

function defaultPopoverLayout(
  boundaryRect: DOMRect,
  triggerRect: DOMRect,
  viewportHeight: number,
  viewportWidth: number,
): PopoverContentLayout {
  const width = Math.min(
    POPOVER_MAX_WIDTH,
    Math.max(
      POPOVER_MIN_WIDTH,
      boundaryRect.width - POPOVER_VIEWPORT_GUTTER * 2,
    ),
  );
  const minimumLeft = Math.max(
    POPOVER_VIEWPORT_GUTTER,
    boundaryRect.left + POPOVER_VIEWPORT_GUTTER,
  );
  const maximumLeft = Math.max(
    minimumLeft,
    Math.min(
      viewportWidth - POPOVER_VIEWPORT_GUTTER - width,
      boundaryRect.right - POPOVER_VIEWPORT_GUTTER - width,
    ),
  );
  const left = clamp(triggerRect.right - width, minimumLeft, maximumLeft);
  const top = Math.max(
    triggerRect.bottom + POPOVER_GAP,
    boundaryRect.top + POPOVER_VIEWPORT_GUTTER,
    POPOVER_VIEWPORT_GUTTER,
  );
  const bottom = Math.max(
    viewportHeight - triggerRect.top + POPOVER_GAP,
    viewportHeight - boundaryRect.bottom + POPOVER_VIEWPORT_GUTTER,
    POPOVER_VIEWPORT_GUTTER,
  );
  const spaceBelow = boundaryRect.bottom - top - POPOVER_VIEWPORT_GUTTER;
  const spaceAbove =
    viewportHeight - bottom - boundaryRect.top - POPOVER_VIEWPORT_GUTTER;
  const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow;

  return placeAbove
    ? {
        bottom,
        left,
        maxHeight: Math.max(POPOVER_MIN_HEIGHT, spaceAbove),
        width,
      }
    : {
        left,
        maxHeight: Math.max(POPOVER_MIN_HEIGHT, spaceBelow),
        top,
        width,
      };
}

function adjacentPopoverLayout(
  anchorRect: DOMRect,
  boundaryRect: DOMRect,
  contentRect: DOMRect,
  ownerRect: DOMRect,
  preferredPlacement: PopoverAdjacentPlacement,
  viewportHeight: number,
  viewportWidth: number,
): PopoverContentLayout {
  const width = Math.min(
    POPOVER_MAX_WIDTH,
    Math.max(
      POPOVER_MIN_WIDTH,
      boundaryRect.width - POPOVER_VIEWPORT_GUTTER * 2,
    ),
  );
  const availableHeight = Math.max(
    POPOVER_MIN_HEIGHT,
    boundaryRect.height - POPOVER_VIEWPORT_GUTTER * 2,
  );
  const measuredHeight = Math.min(contentRect.height, availableHeight);
  const minimumLeft = Math.max(
    POPOVER_VIEWPORT_GUTTER,
    boundaryRect.left + POPOVER_VIEWPORT_GUTTER,
  );
  const leftSpace = ownerRect.left - POPOVER_GAP - minimumLeft;
  const rightSpace =
    boundaryRect.right -
    POPOVER_VIEWPORT_GUTTER -
    ownerRect.right -
    POPOVER_GAP;
  const preferredSpace = preferredPlacement === "left" ? leftSpace : rightSpace;
  const oppositeSpace = preferredPlacement === "left" ? rightSpace : leftSpace;
  const placement =
    preferredSpace < width && oppositeSpace > preferredSpace
      ? preferredPlacement === "left"
        ? "right"
        : "left"
      : preferredPlacement;
  const requestedLeft =
    placement === "left"
      ? ownerRect.left - POPOVER_GAP - width
      : ownerRect.right + POPOVER_GAP;
  const maximumLeft = Math.max(
    minimumLeft,
    Math.min(
      viewportWidth - POPOVER_VIEWPORT_GUTTER - width,
      boundaryRect.right - POPOVER_VIEWPORT_GUTTER - width,
    ),
  );
  const maximumTop = Math.max(
    boundaryRect.top + POPOVER_VIEWPORT_GUTTER,
    Math.min(
      viewportHeight - POPOVER_VIEWPORT_GUTTER - measuredHeight,
      boundaryRect.bottom - POPOVER_VIEWPORT_GUTTER - measuredHeight,
    ),
  );
  const ownerAlignedMinimumTop = clamp(
    ownerRect.top,
    boundaryRect.top + POPOVER_VIEWPORT_GUTTER,
    maximumTop,
  );
  const anchorCenter = anchorRect.top + anchorRect.height / 2;

  return {
    left: clamp(requestedLeft, minimumLeft, maximumLeft),
    maxHeight: availableHeight,
    placement,
    top: clamp(
      anchorCenter - measuredHeight / 2,
      ownerAlignedMinimumTop,
      maximumTop,
    ),
    width,
  };
}

/** A small modeless context surface with deterministic dismissal and restore. */
export function Popover({
  adjacentPositioning,
  children,
  className,
  defaultOpen = false,
  label,
  onOpenChange,
  open: controlledOpen,
  openOnHoverOrFocus = false,
  renderContent,
  trigger,
  triggerLabel,
  triggerTooltip,
}: PopoverProps) {
  const popoverId = useId();
  const overlayBoundary = useOverlayBoundary();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const [contentLayout, setContentLayout] = useState<PopoverContentLayout>();
  const contentRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(defaultOpen);
  const previousOpenRef = useRef(false);
  const pinnedRef = useRef(defaultOpen);
  const suppressFocusOpenRef = useRef(false);
  const focusedContentRef = useRef(false);
  const pendingReturnClaimRef = useRef(false);
  const returnClaimClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presence = useOverlayPresence(open);
  const adjacentAnchorRef = adjacentPositioning?.anchorRef;
  const adjacentOwnerRef = adjacentPositioning?.ownerRef;
  const adjacentPreferredPlacement = adjacentPositioning?.preferredPlacement;

  const updateOpen = useCallback(
    (nextOpen: boolean, restoreFocus = false) => {
      if (openRef.current === nextOpen) {
        return;
      }
      openRef.current = nextOpen;
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
      if (!nextOpen && restoreFocus) {
        suppressFocusOpenRef.current = true;
        triggerRef.current?.focus();
        queueMicrotask(() => {
          suppressFocusOpenRef.current = false;
        });
      }
    },
    [controlledOpen, onOpenChange],
  );

  const cancelHoverClose = useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const clearPendingReturnClaim = useCallback(() => {
    pendingReturnClaimRef.current = false;
    if (returnClaimClearTimerRef.current !== null) {
      clearTimeout(returnClaimClearTimerRef.current);
      returnClaimClearTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    cancelHoverClose();
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = null;
      if (!pinnedRef.current) {
        updateOpen(false);
      }
    }, 120);
  }, [cancelHoverClose, updateOpen]);

  useEffect(() => cancelHoverClose, [cancelHoverClose]);
  useEffect(() => clearPendingReturnClaim, [clearPendingReturnClaim]);

  useLayoutEffect(() => {
    if (open) {
      clearPendingReturnClaim();
      return;
    }
    if (!previousOpenRef.current || !focusedContentRef.current) {
      return;
    }

    pendingReturnClaimRef.current = true;
    returnClaimClearTimerRef.current = setTimeout(() => {
      pendingReturnClaimRef.current = false;
      returnClaimClearTimerRef.current = null;
    }, 0);
  }, [clearPendingReturnClaim, open]);

  useLayoutEffect(() => {
    const ownerDocument =
      triggerRef.current?.ownerDocument ?? globalThis.document;
    return observeTransientOverlayDismissal(
      ownerDocument,
      (exceptId, claimReturnFocusTarget) => {
        const activeElement = ownerDocument.activeElement;
        const ownsFocus =
          activeElement instanceof Node &&
          (rootRef.current?.contains(activeElement) === true ||
            contentRef.current?.contains(activeElement) === true);
        const ownsReturnClaim = ownsFocus || pendingReturnClaimRef.current;
        if (exceptId === popoverId || (!openRef.current && !ownsReturnClaim)) {
          return;
        }
        if (ownsReturnClaim && triggerRef.current?.isConnected === true) {
          claimReturnFocusTarget(triggerRef.current);
          clearPendingReturnClaim();
        }
        if (!openRef.current) {
          return;
        }
        cancelHoverClose();
        pinnedRef.current = false;
        updateOpen(false);
      },
    );
  }, [cancelHoverClose, clearPendingReturnClaim, popoverId, updateOpen]);

  useLayoutEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    openRef.current = open;
    if (!wasOpen && open) {
      dismissTransientOverlays(
        triggerRef.current?.ownerDocument ?? globalThis.document,
        popoverId,
      );
    }
    if (
      wasOpen &&
      !open &&
      (rootRef.current?.contains(document.activeElement) === true ||
        contentRef.current?.contains(document.activeElement) === true)
    ) {
      suppressFocusOpenRef.current = true;
      triggerRef.current?.focus();
      queueMicrotask(() => {
        suppressFocusOpenRef.current = false;
      });
    }
  }, [open, popoverId]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    const triggerElement = triggerRef.current;
    const view = triggerElement?.ownerDocument.defaultView;
    if (triggerElement === null || view === null || view === undefined) {
      return undefined;
    }

    const positionContent = () => {
      const triggerElement = triggerRef.current;
      if (triggerElement === null) {
        return;
      }

      const ownerElement = adjacentOwnerRef?.current;
      const contentElement = contentRef.current;
      const boundaryRect =
        overlayBoundary?.current?.getBoundingClientRect() ??
        new DOMRect(0, 0, view.innerWidth, view.innerHeight);
      const nextLayout =
        ownerElement !== null &&
        ownerElement !== undefined &&
        contentElement !== null &&
        adjacentPreferredPlacement !== undefined
          ? adjacentPopoverLayout(
              (
                adjacentAnchorRef?.current ?? triggerElement
              ).getBoundingClientRect(),
              boundaryRect,
              contentElement.getBoundingClientRect(),
              ownerElement.getBoundingClientRect(),
              adjacentPreferredPlacement,
              view.innerHeight,
              view.innerWidth,
            )
          : defaultPopoverLayout(
              boundaryRect,
              triggerElement.getBoundingClientRect(),
              view.innerHeight,
              view.innerWidth,
            );
      setContentLayout((current) =>
        contentLayoutsEqual(current, nextLayout) ? current : nextLayout,
      );
    };

    positionContent();
    view.addEventListener("resize", positionContent);
    view.addEventListener("scroll", positionContent, true);

    let animationFrame: number | undefined;
    if (adjacentOwnerRef !== undefined) {
      const trackTransformedAnchor = () => {
        positionContent();
        animationFrame = view.requestAnimationFrame(trackTransformedAnchor);
      };
      animationFrame = view.requestAnimationFrame(trackTransformedAnchor);
    }

    return () => {
      view.removeEventListener("resize", positionContent);
      view.removeEventListener("scroll", positionContent, true);
      if (animationFrame !== undefined) {
        view.cancelAnimationFrame(animationFrame);
      }
    };
  }, [
    adjacentAnchorRef,
    adjacentOwnerRef,
    adjacentPreferredPlacement,
    open,
    overlayBoundary,
  ]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const ownerDocument =
      triggerRef.current?.ownerDocument ?? globalThis.document;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target) !== true &&
        contentRef.current?.contains(event.target) !== true
      ) {
        pinnedRef.current = false;
        updateOpen(false);
      }
    };

    ownerDocument.addEventListener("pointerdown", handlePointerDown);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, updateOpen]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const ownerDocument =
      triggerRef.current?.ownerDocument ?? globalThis.document;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !openRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      cancelHoverClose();
      pinnedRef.current = false;
      updateOpen(false, true);
    };

    ownerDocument.addEventListener("keydown", handleKeyDown);
    return () => {
      ownerDocument.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelHoverClose, open, updateOpen]);

  const classes = ["cm-popover", className].filter(Boolean).join(" ");
  const contentStyle: CSSProperties | undefined =
    contentLayout === undefined
      ? undefined
      : {
          bottom: contentLayout.bottom,
          left: contentLayout.left,
          maxHeight: contentLayout.maxHeight,
          top: contentLayout.top,
          width: contentLayout.width,
        };
  const handleEscape = (event: {
    readonly key: string;
    preventDefault(): void;
    stopPropagation(): void;
  }) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      pinnedRef.current = false;
      updateOpen(false, true);
    }
  };

  const content = presence.present ? (
    // The portaled modeless dialog must receive Escape without relying on the
    // trigger wrapper's React tree.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <span
      aria-hidden={open ? undefined : "true"}
      aria-label={label}
      className="cm-popover__content"
      data-placement={contentLayout?.placement}
      data-state={presence.state}
      inert={open ? undefined : true}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          (rootRef.current?.contains(event.relatedTarget) === true ||
            contentRef.current?.contains(event.relatedTarget) === true)
        ) {
          return;
        }
        focusedContentRef.current = false;
      }}
      onFocusCapture={() => {
        focusedContentRef.current = true;
      }}
      onKeyDown={handleEscape}
      onMouseEnter={cancelHoverClose}
      onMouseLeave={() => {
        if (openOnHoverOrFocus && !pinnedRef.current) {
          scheduleHoverClose();
        }
      }}
      ref={contentRef}
      role="dialog"
      style={contentStyle}
    >
      {children}
    </span>
  ) : null;

  return (
    // Escape bubbles from the native trigger or controls inside the popover;
    // the wrapper itself is not an interactive stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span
      className={classes}
      onKeyDown={handleEscape}
      onBlur={(event) => {
        if (
          !openOnHoverOrFocus ||
          pinnedRef.current ||
          (event.relatedTarget instanceof Node &&
            (event.currentTarget.contains(event.relatedTarget) ||
              contentRef.current?.contains(event.relatedTarget) === true))
        ) {
          return;
        }
        updateOpen(false);
      }}
      onFocus={() => {
        if (suppressFocusOpenRef.current) {
          suppressFocusOpenRef.current = false;
        } else if (openOnHoverOrFocus) {
          updateOpen(true);
        }
      }}
      onMouseEnter={() => {
        if (openOnHoverOrFocus) {
          cancelHoverClose();
          updateOpen(true);
        }
      }}
      onMouseLeave={() => {
        if (openOnHoverOrFocus && !pinnedRef.current) {
          scheduleHoverClose();
        }
      }}
      ref={rootRef}
    >
      {(() => {
        const triggerButton = (
          <button
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={triggerLabel}
            className="cm-popover__trigger"
            onClick={() => {
              if (open && pinnedRef.current) {
                pinnedRef.current = false;
                updateOpen(false, true);
                return;
              }

              pinnedRef.current = true;
              updateOpen(true);
            }}
            ref={triggerRef}
            type="button"
          >
            {trigger}
          </button>
        );

        return triggerTooltip === undefined ? (
          triggerButton
        ) : (
          <Tooltip
            content={triggerTooltip.content}
            disabled={open}
            placement={triggerTooltip.placement ?? "bottom"}
            renderInPortal={triggerTooltip.renderInPortal ?? false}
          >
            {triggerButton}
          </Tooltip>
        );
      })()}
      {content === null
        ? null
        : renderContent === undefined
          ? content
          : renderContent(content)}
    </span>
  );
}
