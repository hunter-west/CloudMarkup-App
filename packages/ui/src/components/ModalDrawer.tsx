import type { ReactNode, RefObject } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { OverlayOwnerContext, useOverlayOwner } from "./overlay-owner.js";
import { OverlayBoundaryProvider } from "./OverlayBoundaryProvider.js";
import { useOverlayPresence } from "./useOverlayPresence.js";
import {
  announceModalOverlayOpening,
  dismissTransientOverlays,
  observeModalOverlayOpening,
} from "./overlay-events.js";

export interface ModalDrawerProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly closeLabel?: string;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly kind?: "modal" | "drawer";
  readonly onClose: () => void;
  readonly open: boolean;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly title: string;
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ManagedBodyElementState {
  readonly ariaHidden: string | null;
  readonly inert: boolean;
}

interface ModalIsolationState {
  readonly activeBackdrops: HTMLElement[];
  readonly originals: Map<HTMLElement, ManagedBodyElementState>;
  observer: MutationObserver | null;
}

const modalIsolationStates = new WeakMap<Document, ModalIsolationState>();

function restoreManagedBodyElement(
  element: HTMLElement,
  original: ManagedBodyElementState,
): void {
  if (original.inert) {
    element.setAttribute("inert", "");
  } else {
    element.removeAttribute("inert");
  }

  if (original.ariaHidden === null) {
    element.removeAttribute("aria-hidden");
  } else {
    element.setAttribute("aria-hidden", original.ariaHidden);
  }
}

function rememberBodyElement(
  state: ModalIsolationState,
  element: HTMLElement,
): ManagedBodyElementState {
  const remembered = state.originals.get(element);
  if (remembered !== undefined) {
    return remembered;
  }

  const original = {
    ariaHidden: element.getAttribute("aria-hidden"),
    inert: element.hasAttribute("inert"),
  };
  state.originals.set(element, original);
  return original;
}

function applyModalIsolation(
  ownerDocument: Document,
  state: ModalIsolationState,
): void {
  const connectedBackdrops = state.activeBackdrops.filter(
    (backdrop) => backdrop.isConnected,
  );
  state.activeBackdrops.splice(
    0,
    state.activeBackdrops.length,
    ...connectedBackdrops,
  );
  const topmostBackdrop = connectedBackdrops.at(-1) ?? null;

  for (const child of ownerDocument.body.children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    const original = rememberBodyElement(state, child);
    if (topmostBackdrop !== null && child !== topmostBackdrop) {
      child.setAttribute("aria-hidden", "true");
      child.setAttribute("inert", "");
    } else {
      restoreManagedBodyElement(child, original);
    }
  }
}

function isolateDocumentForModal(backdrop: HTMLElement): () => void {
  const ownerDocument = backdrop.ownerDocument;
  if (backdrop.parentElement !== ownerDocument.body) {
    return () => undefined;
  }

  let state = modalIsolationStates.get(ownerDocument);
  if (state === undefined) {
    state = {
      activeBackdrops: [],
      observer: null,
      originals: new Map(),
    };
    const Observer = ownerDocument.defaultView?.MutationObserver;
    if (Observer !== undefined) {
      state.observer = new Observer(() => {
        const currentState = modalIsolationStates.get(ownerDocument);
        if (currentState !== undefined) {
          applyModalIsolation(ownerDocument, currentState);
        }
      });
      state.observer.observe(ownerDocument.body, { childList: true });
    }
    modalIsolationStates.set(ownerDocument, state);
  }

  state.activeBackdrops.push(backdrop);
  applyModalIsolation(ownerDocument, state);
  let registered = true;

  return () => {
    if (!registered) {
      return;
    }
    registered = false;

    const currentState = modalIsolationStates.get(ownerDocument);
    if (currentState === undefined) {
      return;
    }
    const index = currentState.activeBackdrops.lastIndexOf(backdrop);
    if (index >= 0) {
      currentState.activeBackdrops.splice(index, 1);
    }

    if (currentState.activeBackdrops.length > 0) {
      applyModalIsolation(ownerDocument, currentState);
      return;
    }

    currentState.observer?.disconnect();
    for (const [element, original] of currentState.originals) {
      if (element.matches(".cm-modal-drawer__backdrop[data-state='closed']")) {
        continue;
      }
      restoreManagedBodyElement(element, original);
    }
    currentState.originals.clear();
    modalIsolationStates.delete(ownerDocument);
  };
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      element.closest("[hidden], [aria-hidden='true'], [inert]") === null,
  );
}

function isTopmostModal(element: HTMLElement): boolean {
  const openModals = document.querySelectorAll<HTMLElement>(
    "[data-cm-modal-drawer]",
  );

  return openModals.item(openModals.length - 1) === element;
}

function resolveReturnFocusTarget(
  returnFocusRef: RefObject<HTMLElement | null> | undefined,
  ...fallbacks: readonly (HTMLElement | null)[]
): HTMLElement | null {
  const requestedTarget = returnFocusRef?.current;
  if (
    requestedTarget?.isConnected === true &&
    requestedTarget.closest("[hidden], [aria-hidden='true'], [inert]") === null
  ) {
    return requestedTarget;
  }
  return (
    fallbacks.find(
      (target) =>
        target?.isConnected === true &&
        target.closest("[hidden], [aria-hidden='true'], [inert]") === null,
    ) ?? null
  );
}

/**
 * A modal surface rendered as a centered dialog or end-aligned drawer.
 *
 * Focus moves to an explicit target or the title, remains contained while the
 * surface is open, and returns to the invoking element when it closes.
 */
export function ModalDrawer({
  children,
  className,
  closeLabel = "Close",
  description,
  footer,
  initialFocusRef,
  kind = "modal",
  onClose,
  open,
  returnFocusRef,
  title,
}: ModalDrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  const presence = useOverlayPresence(open);
  const overlayOwner = useOverlayOwner();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const requestedReturnTarget = resolveReturnFocusTarget(returnFocusRef);
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;

    if (dialog === null) {
      return undefined;
    }

    const transientReturnTarget = dismissTransientOverlays(
      dialog.ownerDocument,
    );
    const handedOffReturnTarget =
      kind === "modal"
        ? announceModalOverlayOpening(
            dialog.ownerDocument,
            overlayOwner?.current ?? null,
          )
        : null;
    const backdrop = dialog.parentElement;
    const restoreModalIsolation =
      backdrop instanceof HTMLElement
        ? isolateDocumentForModal(backdrop)
        : () => undefined;
    const focusInitialTarget = () => {
      const requestedTarget = initialFocusRef?.current;
      if (requestedTarget !== undefined && requestedTarget !== null) {
        requestedTarget.focus();
        return;
      }

      titleRef.current?.focus();
    };

    focusInitialTarget();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isTopmostModal(dialog)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        // Dismiss help before its containing task. Portaled help must remain
        // inside this dialog so isolation and focus containment still apply.
        if (dialog.querySelector('.cm-popover__content[data-state="open"]')) {
          dismissTransientOverlays(dialog.ownerDocument)?.focus();
          return;
        }
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements.at(-1);
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      if (event.shiftKey) {
        if (
          activeElement === first ||
          activeElement === titleRef.current ||
          activeElement === dialog ||
          !dialog.contains(activeElement)
        ) {
          event.preventDefault();
          last?.focus();
        }
      } else if (
        activeElement === last ||
        activeElement === dialog ||
        !dialog.contains(activeElement)
      ) {
        event.preventDefault();
        first?.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (
        isTopmostModal(dialog) &&
        event.target instanceof Node &&
        !dialog.contains(event.target)
      ) {
        focusInitialTarget();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      restoreModalIsolation();

      const returnTarget = resolveReturnFocusTarget(
        returnFocusRef,
        handedOffReturnTarget,
        transientReturnTarget,
        requestedReturnTarget,
        previouslyFocused,
      );
      if (returnTarget?.isConnected === true) {
        returnTarget.focus();
      }
    };
  }, [initialFocusRef, kind, open, overlayOwner, returnFocusRef]);

  useEffect(() => {
    if (!open || kind !== "drawer") {
      return undefined;
    }
    const ownerDocument =
      dialogRef.current?.ownerDocument ?? globalThis.document;
    return observeModalOverlayOpening(
      ownerDocument,
      (openingOwner, claimReturnFocusTarget) => {
        if (openingOwner === dialogRef.current) {
          return;
        }
        const drawers = ownerDocument.querySelectorAll<HTMLElement>(
          '[data-cm-modal-drawer][data-kind="drawer"]',
        );
        if (drawers.item(drawers.length - 1) === dialogRef.current) {
          const returnTarget = resolveReturnFocusTarget(returnFocusRef);
          if (returnTarget !== null) {
            claimReturnFocusTarget(returnTarget);
          }
        }
        onCloseRef.current();
      },
    );
  }, [kind, open, returnFocusRef]);

  if (!presence.present) {
    return null;
  }

  const classes = ["cm-modal-drawer", className].filter(Boolean).join(" ");

  const surface = (
    <div
      aria-hidden={open ? undefined : "true"}
      className="cm-modal-drawer__backdrop"
      data-state={presence.state}
      inert={open ? undefined : true}
    >
      <div
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-labelledby={titleId}
        aria-modal={open ? "true" : undefined}
        className={classes}
        data-cm-modal-drawer={open ? "" : undefined}
        data-kind={kind}
        data-state={presence.state}
        ref={dialogRef}
        role="dialog"
      >
        <header className="cm-modal-drawer__header">
          <h2
            className="cm-modal-drawer__title"
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
          >
            {title}
          </h2>
          <button
            aria-label={closeLabel}
            className="cm-modal-drawer__close"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </header>
        <OverlayOwnerContext.Provider
          value={kind === "drawer" ? dialogRef : overlayOwner}
        >
          {description === undefined ? null : (
            <div className="cm-modal-drawer__description" id={descriptionId}>
              {description}
            </div>
          )}
          <OverlayBoundaryProvider boundaryRef={dialogRef}>
            <div className="cm-modal-drawer__body">{children}</div>
          </OverlayBoundaryProvider>
          {footer === undefined ? null : (
            <footer className="cm-modal-drawer__footer">{footer}</footer>
          )}
        </OverlayOwnerContext.Provider>
      </div>
    </div>
  );
  const portalTarget = typeof document === "undefined" ? null : document.body;
  return portalTarget === null ? surface : createPortal(surface, portalTarget);
}
