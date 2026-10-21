import { useEditorDocumentSession } from "../session/index.js";
import {
  snapshotFromValidationState,
  isEditorValidationSnapshotComplete,
} from "./editor-validation.js";
export function EditorIssueIndicator() {
  const session = useEditorDocumentSession();
  const snapshot = snapshotFromValidationState(session.validation);
  if (
    session.status !== "ready" ||
    session.validation.status !== "current" ||
    !snapshot ||
    !isEditorValidationSnapshotComplete(snapshot) ||
    snapshot.hashes.contentHash !== session.hashes.contentHash ||
    snapshot.hashes.visualHash !== session.hashes.visualHash
  )
    return (
      <span
        id="editor-issue-count"
        className="editor-issue-count editor-issue-count--pending"
        aria-label="Checking issues"
      >
        …
      </span>
    );
  const actionableFindings = [
    ...snapshot.draftReport.findings,
    ...snapshot.compilationReport.findings,
  ].filter((finding) =>
    ["error", "security-error", "warning", "cost-warning"].includes(
      finding.severity,
    ),
  );
  const findingCount = new Set(
    actionableFindings.map((finding) =>
      JSON.stringify([finding.code, finding.affected]),
    ),
  ).size;
  if (findingCount === 0)
    return (
      <span
        id="editor-issue-count"
        className="editor-issue-count editor-issue-count--clear"
        aria-label="No errors or warnings"
      >
        0
      </span>
    );
  const blocking = actionableFindings.some(
    (f) => f.severity === "error" || f.severity === "security-error",
  );
  return (
    <span
      id="editor-issue-count"
      className={
        "editor-issue-count" + (blocking ? " editor-issue-count--error" : "")
      }
      aria-label={
        String(findingCount) + (findingCount === 1 ? " issue" : " issues")
      }
    >
      {findingCount}
    </span>
  );
}
