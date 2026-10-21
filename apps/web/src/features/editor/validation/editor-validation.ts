import type {
  ArchitectureDocument,
  ArchitectureDocumentHashes,
  ValidationEnvironment,
  ValidationFindingId,
  ValidationReport,
  ValidationTarget,
} from "@cloudmarkup/domain";

export const DEFAULT_EDITOR_VALIDATION_DEBOUNCE_MILLISECONDS = 300;

export type EditorValidationTarget = Extract<
  ValidationTarget,
  "draft" | "compilation"
>;

export interface EditorValidationEvaluationRequest {
  readonly document: ArchitectureDocument;
  readonly target: EditorValidationTarget;
}

/**
 * Application-composition seam for one exact provider/catalog validation pack.
 * The evaluator returns the public domain report without introducing a UI
 * finding or rule schema.
 */
export interface EditorValidationEvaluator {
  readonly environment: ValidationEnvironment;
  evaluate(
    request: EditorValidationEvaluationRequest,
  ): Promise<ValidationReport> | ValidationReport;
}

export interface EditorValidationSnapshot {
  readonly compilationReport: ValidationReport;
  readonly draftReport: ValidationReport;
  readonly hashes: ArchitectureDocumentHashes;
}

export function isEditorValidationSnapshotComplete(
  snapshot: EditorValidationSnapshot,
): boolean {
  return (
    snapshot.draftReport.evaluationStatus === "complete" &&
    snapshot.compilationReport.evaluationStatus === "complete"
  );
}

export type EditorValidationState =
  | {
      readonly message: string;
      readonly status: "unavailable";
    }
  | {
      readonly hashes: ArchitectureDocumentHashes;
      readonly previous: EditorValidationSnapshot | null;
      readonly status: "scheduled" | "running";
    }
  | {
      readonly snapshot: EditorValidationSnapshot;
      readonly status: "current";
    }
  | {
      readonly hashes: ArchitectureDocumentHashes;
      readonly message: string;
      readonly previous: EditorValidationSnapshot | null;
      readonly status: "failed";
    };

export type EditorValidationFixResult =
  | {
      readonly document: ArchitectureDocument;
      readonly hashes: ArchitectureDocumentHashes;
      readonly ok: true;
    }
  | {
      readonly message: string;
      readonly ok: false;
    };

export function snapshotFromValidationState(
  state: EditorValidationState,
): EditorValidationSnapshot | null {
  if (state.status === "current") {
    return state.snapshot;
  }
  if (
    state.status === "scheduled" ||
    state.status === "running" ||
    state.status === "failed"
  ) {
    return state.previous;
  }
  return null;
}

export function findValidationFinding(
  snapshot: EditorValidationSnapshot,
  findingId: ValidationFindingId | string,
  target: EditorValidationTarget,
) {
  const untrustedTarget: unknown = target;
  const report =
    untrustedTarget === "draft"
      ? snapshot.draftReport
      : untrustedTarget === "compilation"
        ? snapshot.compilationReport
        : undefined;
  return report?.findings.find((finding) => finding.findingId === findingId);
}
