import type {
  ValidationAffectedLocation,
  ValidationFinding,
} from "@cloudmarkup/domain";

import type { WorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import type { EditorSessionStore } from "../session/editor-session-store.js";
import type { EditorValidationTarget } from "./editor-validation.js";

export function validationLocationNodeId(
  location: ValidationAffectedLocation,
): string | null {
  if (location.kind === "node") {
    return location.nodeId;
  }
  if (location.kind === "port") {
    return location.nodeId;
  }
  if (location.kind === "configuration" && location.owner.kind === "node") {
    return location.owner.nodeId;
  }
  return null;
}

export function validationLocationEdgeId(
  location: ValidationAffectedLocation,
): string | null {
  if (location.kind === "edge" || location.kind === "port") {
    return location.edgeId;
  }
  if (location.kind === "configuration" && location.owner.kind === "edge") {
    return location.owner.edgeId;
  }
  return null;
}

export function validationLocationMatchesPort(
  location: ValidationAffectedLocation,
  nodeId: string,
  portId: string,
): boolean {
  return (
    location.kind === "port" &&
    location.nodeId === nodeId &&
    location.port === portId
  );
}

export function validationFocusTargetId(location: ValidationAffectedLocation): {
  readonly inspectorTab?: "configure";
  readonly targetId: string;
} {
  if (location.kind === "configuration") {
    if (location.key !== undefined) {
      return {
        inspectorTab: "configure",
        targetId:
          location.owner.kind === "node"
            ? `inspector-configuration-node-${location.owner.nodeId}-${location.key}`
            : `inspector-configuration-edge-${location.owner.edgeId}-${location.key}`,
      };
    }
    return {
      inspectorTab: "configure",
      targetId:
        location.owner.kind === "node"
          ? `validation-architecture-node-${location.owner.nodeId}`
          : `validation-architecture-edge-${location.owner.edgeId}`,
    };
  }
  if (location.kind === "node") {
    return { targetId: `validation-architecture-node-${location.nodeId}` };
  }
  if (location.kind === "edge") {
    return { targetId: `validation-architecture-edge-${location.edgeId}` };
  }
  if (location.kind === "port") {
    return {
      targetId: `validation-architecture-port-${location.nodeId}-${location.port}`,
    };
  }
  return { targetId: "architecture-list" };
}

function validationLocationSelection(location: ValidationAffectedLocation) {
  switch (location.kind) {
    case "document":
      return null;
    case "node":
      return { id: location.nodeId, kind: "node" as const };
    case "edge":
    case "port":
      return { id: location.edgeId, kind: "edge" as const };
    case "configuration":
      return location.owner.kind === "node"
        ? { id: location.owner.nodeId, kind: "node" as const }
        : { id: location.owner.edgeId, kind: "edge" as const };
  }
}

/** Opens native disclosures and focuses only an available, editable target. */
export function focusValidationElement(element: HTMLElement | null): boolean {
  if (
    element === null ||
    !element.isConnected ||
    element.matches(":disabled, [aria-disabled='true']") ||
    ((element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement) &&
      element.readOnly)
  ) {
    return false;
  }
  for (
    let parent = element.parentElement;
    parent !== null;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement && !parent.open)
      parent.open = true;
  }
  if (element.closest("[hidden], [inert], [aria-hidden='true']") !== null)
    return false;
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  element.focus();
  return (
    document.activeElement === element ||
    (document.activeElement instanceof Node &&
      element.contains(document.activeElement))
  );
}

/**
 * Moves presentation focus for one canonical validation finding. It never
 * changes the Architecture Document, finding, severity, or validation report.
 */
export function navigateToValidationFinding({
  finding,
  location,
  shell,
  store,
  target,
}: {
  readonly finding: ValidationFinding;
  readonly location: ValidationAffectedLocation;
  readonly shell: WorkspaceShellController | null;
  readonly store: EditorSessionStore;
  readonly target: EditorValidationTarget;
}): void {
  store.getState().setValidationFocus({
    findingId: finding.findingId,
    location,
    target,
  });
  store.getState().setSelection(validationLocationSelection(location));
  const request = store.getState().validationFocus;
  // Explicit user navigation must reannounce even when the finding repeats.
  // Background validation retains its separate, deduplicated announcement.
  store.getState().announce("");
  const focus = validationFocusTargetId(location);
  if (location.kind === "configuration") {
    shell?.openContextPanel(focus.targetId, focus.inspectorTab);
  } else {
    shell?.focusArchitectureTarget(focus.targetId);
  }

  window.setTimeout(() => {
    if (store.getState().validationFocus !== request) return;
    if (focusValidationElement(document.getElementById(focus.targetId))) {
      store
        .getState()
        .announce(
          `Focused the affected ${location.kind}. ${String(location.path)}.`,
        );
      return;
    }
    const panels = document.querySelectorAll<HTMLElement>(
      "[data-cm-modal-drawer][aria-modal='true'], [data-cm-modeless-drawer]",
    );
    const panel = [...panels].at(-1);
    const titleId = panel?.getAttribute("aria-labelledby");
    const title =
      titleId === null || titleId === undefined
        ? null
        : document.getElementById(titleId);
    const panelFocused = focusValidationElement(title);
    const listFocused =
      !panelFocused &&
      focusValidationElement(document.getElementById("architecture-list"));
    store
      .getState()
      .announce(
        panelFocused || listFocused
          ? `The affected ${location.kind} could not be focused here. Focused the ${panelFocused ? "configuration panel" : "architecture list"} instead.`
          : `The affected ${location.kind} could not be focused here. Review the selected item in the configuration panel or architecture list.`,
      );
  }, 0);
}
