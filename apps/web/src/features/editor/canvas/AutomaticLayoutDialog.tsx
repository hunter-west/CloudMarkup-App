import { Button, Dialog, StatusBadge } from "@cloudmarkup/ui";
import { Check, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { ModeSwitch } from "../../../preferences/ModeSwitch.js";
import { useModePreference } from "../../../preferences/index.js";
import { useEditorDocumentSession } from "../session/editor-session-hooks.js";

function PreviewBody() {
  const session = useEditorDocumentSession();
  const { mode } = useModePreference();
  const preview = session.layoutWorkflow.preview;

  if (session.layoutWorkflow.status !== "preview" || preview === null) {
    return null;
  }

  return (
    <>
      <div className="automatic-layout-dialog__mode">
        <StatusBadge
          label={
            mode === "guided" ? "Guided explanation" : "Professional review"
          }
          tone="info"
        />
        <ModeSwitch />
        <span>
          Presentation can change; containment and proposed positions do not.
        </span>
      </div>
      <div className="automatic-layout-dialog__preview">
        <p>
          {mode === "guided"
            ? "The editor will arrange " +
              String(preview.changes.length) +
              " nodes while keeping every resource in the same boundary. Only " +
              "the resulting positions will be saved."
            : "Exact position-only Graph Command preview. Coordinates are stored " +
              "relative to the listed boundary, or to the canvas at root."}
        </p>
        <ul aria-label="Automatic layout position changes">
          {preview.changes.map((change) => (
            <li key={change.nodeId}>
              <code>{change.nodeId}</code>
              <span>
                parent <code>{change.parentNodeId ?? "architecture-root"}</code>
              </span>
              <span>
                ({String(change.from.x)}, {String(change.from.y)}) → (
                {String(change.to.x)}, {String(change.to.y)})
              </span>
            </li>
          ))}
        </ul>
        <p>
          Content hash remains <code>{preview.baseHashes.contentHash}</code>.
        </p>
      </div>
    </>
  );
}

export function AutomaticLayoutDialog() {
  const session = useEditorDocumentSession();
  const workflow = session.layoutWorkflow;

  useEffect(() => {
    if (workflow.status !== "preview") {
      return undefined;
    }
    const confirmWithKeyboard = (event: KeyboardEvent) => {
      const openModals = document.querySelectorAll<HTMLElement>(
        "[data-cm-modal-drawer]",
      );
      const topmostModal = openModals[openModals.length - 1];

      if (
        topmostModal?.classList.contains("automatic-layout-dialog") === true &&
        event.key === "Enter" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        session.applyAutomaticLayout();
      }
    };
    document.addEventListener("keydown", confirmWithKeyboard);
    return () => {
      document.removeEventListener("keydown", confirmWithKeyboard);
    };
  }, [session, workflow.status]);

  if (workflow.status === "idle") {
    return null;
  }

  const previewing = workflow.status === "preview";
  const running = workflow.status === "running";

  return (
    <Dialog
      className="automatic-layout-dialog"
      description={
        running
          ? "The editor is calculating deterministic positions. Canceling makes no changes."
          : previewing
            ? "Review every proposed position before one atomic command batch is applied."
            : "The layout request failed closed and the architecture was not changed."
      }
      footer={
        <div className="automatic-layout-dialog__footer">
          <Button
            onClick={() => {
              session.cancelAutomaticLayout();
            }}
            variant="quiet"
          >
            {workflow.status === "error" ? "Close" : "Cancel"}
          </Button>
          {workflow.status === "error" ? (
            <Button
              onClick={() => {
                session.startAutomaticLayout();
              }}
              variant="secondary"
            >
              <RotateCcw aria-hidden="true" size={16} /> Try again
            </Button>
          ) : previewing ? (
            <Button
              aria-keyshortcuts="Control+Enter"
              onClick={() => {
                session.applyAutomaticLayout();
              }}
            >
              <Check aria-hidden="true" size={16} /> Apply positions
              (Ctrl+Enter)
            </Button>
          ) : null}
        </div>
      }
      onClose={() => {
        session.cancelAutomaticLayout();
      }}
      open
      title={
        running
          ? "Calculating automatic layout"
          : previewing
            ? "Review automatic layout"
            : "Automatic layout unavailable"
      }
    >
      {running ? (
        <p aria-live="polite">
          Arranging nested groups and typed ports. No document positions have
          been written.
        </p>
      ) : workflow.status === "error" ? (
        <p role="alert">{workflow.message}</p>
      ) : (
        <PreviewBody />
      )}
    </Dialog>
  );
}
