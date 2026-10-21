import { createContext, useContext } from "react";

export interface WorkspaceOverlayState {
  readonly catalog: {
    readonly open: boolean;
  };
  readonly inspector: {
    readonly open: boolean;
  };
  readonly safeArea: {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

export type WorkspaceInspectorTab =
  "architecture" | "configure" | "connect" | "learn" | "iac";

export type WorkspacePanelTab =
  "assistant" | "issues" | "code" | "activity" | "jobs";

export interface WorkspaceShellController {
  readonly overlays: WorkspaceOverlayState;
  readonly posture: "desktop" | "phone" | "tablet";
  closePanels?(): void;
  focusArchitectureTarget(targetId: string): void;
  openRevisionPlaceholder(focusTargetId?: string): void;
  openCatalogPanel(focusTargetId?: string): void;
  openContextPanel(
    focusTargetId?: string,
    inspectorTab?: WorkspaceInspectorTab,
  ): void;
  openWorkspacePanel(
    workspaceTab?: WorkspacePanelTab,
    focusTargetId?: string,
  ): void;
}

export function focusWorkspaceShellTarget(targetId: string): void {
  const target = document.getElementById(targetId);
  if (target === null) {
    return;
  }

  if (targetId === "architecture-list") {
    const summary =
      target
        .closest("details")
        ?.querySelector<HTMLElement>(":scope > summary") ?? target;
    summary.scrollIntoView({
      behavior: "instant",
      block: "nearest",
      inline: "nearest",
    });
  }

  target.focus({ preventScroll: targetId === "architecture-list" });
}

export const WorkspaceShellControllerContext =
  createContext<WorkspaceShellController | null>(null);

/**
 * Optional presentation-only bridge for workspace content rendered by the
 * shell. It never owns Architecture Documents or semantic commands.
 */
export function useWorkspaceShellController(): WorkspaceShellController | null {
  return useContext(WorkspaceShellControllerContext);
}
