import { Button, Disclosure, StatusBadge } from "@cloudmarkup/ui";
import { Info } from "lucide-react";

import { useEditorStartRegionSource } from "./editor-start-context.js";
import {
  useEditorRecovery,
  type EditorRecoveryStatus,
} from "./persistence/editor-recovery-context.js";

function recoveryBadge(state: EditorRecoveryStatus) {
  switch (state.status) {
    case "saved":
      return {
        label:
          state.lastSavedAt === null
            ? "Browser draft ready"
            : "Saved in this browser",
        tone: "success" as const,
      };
    case "unsaved":
      return { label: "Unsaved changes", tone: "warning" as const };
    case "saving":
      return { label: "Saving in browser", tone: "incomplete" as const };
    case "conflict":
      return { label: "Local draft conflict", tone: "warning" as const };
    case "failed":
      return { label: "Local save failed", tone: "warning" as const };
    case "recovery-required":
      return { label: "Recovery required", tone: "warning" as const };
    case "checking":
      return { label: "Checking local draft", tone: "incomplete" as const };
    case "unsupported":
      return { label: "Local fixture", tone: "incomplete" as const };
  }
}

export function DevelopmentFixtureStatus({
  serverBacked = false,
}: {
  readonly serverBacked?: boolean;
}) {
  const recovery = useEditorRecovery();
  const regionSource = useEditorStartRegionSource();
  const isServerBacked = serverBacked || regionSource === "server";
  const badge = recoveryBadge(recovery.state);

  if (
    isServerBacked &&
    (recovery.state.status === "saved" ||
      recovery.state.status === "unsaved" ||
      recovery.state.status === "saving")
  ) {
    return null;
  }

  return (
    <section
      aria-label={
        isServerBacked ? "Local recovery status" : "Development fixture status"
      }
      className="architecture-fixture-status"
      data-attention={
        recovery.state.status !== "saved" &&
        recovery.state.status !== "checking"
      }
      data-canvas-overlay="fixture-status"
    >
      <Disclosure
        className="architecture-fixture-status__disclosure"
        summary={
          <span className="architecture-fixture-status__summary">
            <StatusBadge label={badge.label} tone={badge.tone} />
            {recovery.state.status === "saved" ||
            recovery.state.status === "checking" ? null : (
              <strong className="visually-hidden" role="status">
                {recovery.state.message}
              </strong>
            )}
            <span className="architecture-fixture-status__details-label">
              <Info aria-hidden="true" size={16} />
              Details
            </span>
          </span>
        }
      >
        <p>{recovery.state.message}</p>
        <p>
          Selection, panels, viewport, and unfinished wizards stay out of
          semantic history.
        </p>
        <p>
          Accepted document states—including undo and redo—are saved to this
          browser&apos;s IndexedDB;{" "}
          {isServerBacked
            ? "server draft status is tracked separately in the Save and recovery controls."
            : "backend persistence is not implemented yet."}
        </p>
        {recovery.state.status === "recovery-required" ? (
          <>
            <p>
              Rejection class: {recovery.state.classification}. The rejected
              draft is blocked from autosave and was not opened.
            </p>
            <div
              aria-label="Local draft recovery actions"
              className="architecture-fixture-status__actions"
              role="group"
            >
              <Button
                onClick={() => {
                  void recovery.recoverSafeCheckpoint();
                }}
              >
                Recover safe copy
              </Button>
              <Button
                onClick={() => {
                  void recovery.discardLocalDraft();
                }}
              >
                Discard local draft
              </Button>
              <Button
                onClick={() => {
                  recovery.downloadDiagnosticCopy();
                }}
              >
                Download diagnostic copy
              </Button>
            </div>
          </>
        ) : recovery.state.status === "failed" &&
          recovery.state.diagnostic !== undefined ? (
          <div
            aria-label="Local draft diagnostics"
            className="architecture-fixture-status__actions"
            role="group"
          >
            <Button
              onClick={() => {
                recovery.downloadDiagnosticCopy();
              }}
            >
              Download diagnostic copy
            </Button>
          </div>
        ) : null}
      </Disclosure>
    </section>
  );
}
