import { Button } from "@cloudmarkup/ui";
import { useState } from "react";
import { useModePreference } from "../../../preferences/index.js";
import { useWorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import {
  useEditorDocumentSession,
  useEditorSessionStoreApi,
} from "../session/index.js";
import {
  isEditorValidationSnapshotComplete,
  snapshotFromValidationState,
} from "./editor-validation.js";
import { VALIDATION_SEVERITY_PRESENTATION } from "./validation-presentation.js";

/** Presentation-only advice from the current deterministic validation reports. */
export function GuidedNextAction() {
  const { mode } = useModePreference();
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const shell = useWorkspaceShellController();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const snapshot = snapshotFromValidationState(session.validation);
  if (
    mode !== "guided" ||
    session.status !== "ready" ||
    shell === null ||
    shell.overlays.catalog.open ||
    shell.overlays.inspector.open
  )
    return null;
  const empty =
    session.document.nodes.length === 0 ||
    session.document.nodes.every(
      (node) =>
        session.catalog.services.find(
          (service) => service.serviceType === node.semantic.serviceType,
        )?.nodeKind === "boundary",
    );
  const current =
    session.validation.status === "current" &&
    snapshot !== null &&
    isEditorValidationSnapshotComplete(snapshot) &&
    snapshot.hashes.contentHash === session.hashes.contentHash &&
    snapshot.hashes.visualHash === session.hashes.visualHash;
  const next = !current
    ? undefined
    : [snapshot.draftReport, snapshot.compilationReport]
        .flatMap((report) =>
          report.findings.map((finding) => ({
            finding,
            target:
              report.target === "compilation"
                ? ("compilation" as const)
                : ("draft" as const),
          })),
        )
        .filter(({ finding }) => finding.severity !== "educational-note")
        .sort(
          (a, b) =>
            VALIDATION_SEVERITY_PRESENTATION[a.finding.severity].order -
              VALIDATION_SEVERITY_PRESENTATION[b.finding.severity].order ||
            a.finding.findingId.localeCompare(b.finding.findingId),
        )[0];
  // The empty canvas already explains how to add a service. Show a single
  // current finding only when it can add useful context to an existing graph.
  if (empty || next === undefined) return null;
  const key = `${session.hashes.contentHash}:${next.finding.findingId}`;
  if (key === dismissed) return null;
  return (
    <aside
      className="architecture-canvas-notice guided-next-action"
      aria-label="Recommended next action"
    >
      <span>
        <strong>Next</strong> {next.finding.title}
      </span>
      <Button
        size="compact"
        onClick={() => {
          const location = next.finding.affected[0];
          if (location) {
            store.getState().setValidationFocus({
              findingId: next.finding.findingId,
              location,
              target: next.target,
            });
          }
          shell.openWorkspacePanel("issues");
        }}
      >
        Review issue
      </Button>
      <Button
        size="compact"
        variant="quiet"
        onClick={() => {
          setDismissed(key);
        }}
      >
        Dismiss suggestion
      </Button>
    </aside>
  );
}
