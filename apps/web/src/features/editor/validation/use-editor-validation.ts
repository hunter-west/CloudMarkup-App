import {
  getArchitectureDocumentHashes,
  VALIDATION_ENGINE_VERSION,
  VALIDATION_REPORT_VERSION,
  type ArchitectureDocument,
  type ArchitectureDocumentHashes,
  type ValidationEnvironment,
  type ValidationReport,
} from "@cloudmarkup/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorSessionStore } from "../session/editor-session-store.js";
import {
  DEFAULT_EDITOR_VALIDATION_DEBOUNCE_MILLISECONDS,
  snapshotFromValidationState,
  type EditorValidationEvaluator,
  type EditorValidationSnapshot,
  type EditorValidationState,
} from "./editor-validation.js";

const VALIDATION_UNAVAILABLE_STATE: EditorValidationState = Object.freeze({
  message:
    "No version-bound validation evaluator is connected to this editor session.",
  status: "unavailable",
});

function reportsMatchDocument(
  draftReport: ValidationReport,
  compilationReport: ValidationReport,
  document: ArchitectureDocument,
  hashes: ArchitectureDocumentHashes,
  expectedEnvironment: ValidationEnvironment,
): boolean {
  const reportMatchesIdentity = (report: ValidationReport) => {
    const untrustedReportVersion: unknown = report.reportVersion;
    return (
      untrustedReportVersion === VALIDATION_REPORT_VERSION &&
      report.engineVersion === VALIDATION_ENGINE_VERSION &&
      report.environment === expectedEnvironment &&
      report.documentHash === hashes.contentHash &&
      report.provider?.id === document.provider.id &&
      report.provider.region === document.provider.region &&
      report.catalog?.id === document.catalog.id &&
      report.catalog.version === document.catalog.version &&
      report.catalog.digest === document.catalog.digest
    );
  };

  return (
    draftReport.target === "draft" &&
    compilationReport.target === "compilation" &&
    draftReport.environment === compilationReport.environment &&
    draftReport.engineVersion === compilationReport.engineVersion &&
    reportMatchesIdentity(draftReport) &&
    reportMatchesIdentity(compilationReport)
  );
}
function reportAnnouncement(
  label: "Compilation" | "Draft",
  report: ValidationReport,
): string {
  return `${label} validation ${report.evaluationStatus}: ${String(
    report.findings.length,
  )} ${report.findings.length === 1 ? "finding" : "findings"}.`;
}

function completedAnnouncement(snapshot: EditorValidationSnapshot): string {
  return `${reportAnnouncement("Draft", snapshot.draftReport)} ${reportAnnouncement(
    "Compilation",
    snapshot.compilationReport,
  )}`;
}

export function useEditorValidation({
  debounceMilliseconds = DEFAULT_EDITOR_VALIDATION_DEBOUNCE_MILLISECONDS,
  document,
  evaluator,
  sessionStore,
}: {
  readonly debounceMilliseconds?: number;
  readonly document: ArchitectureDocument | null;
  readonly evaluator?: EditorValidationEvaluator;
  readonly sessionStore: EditorSessionStore;
}) {
  const [requestVersion, setRequestVersion] = useState(0);
  const hashes = useMemo(
    () => (document === null ? null : getArchitectureDocumentHashes(document)),
    [document],
  );
  const [state, setState] = useState<EditorValidationState>(() =>
    hashes === null || evaluator === undefined
      ? VALIDATION_UNAVAILABLE_STATE
      : { hashes, previous: null, status: "scheduled" },
  );
  const generationReference = useRef(0);

  /* eslint-disable react-hooks/set-state-in-effect -- This controller intentionally publishes the evaluator lifecycle as observable editor state when its external document/evaluator inputs change. */
  useEffect(() => {
    generationReference.current += 1;
    const generation = generationReference.current;
    sessionStore.getState().announceValidation("");

    if (document === null || evaluator === undefined || hashes === null) {
      setState(VALIDATION_UNAVAILABLE_STATE);
      return;
    }

    const previous = snapshotFromValidationState(state);
    setState({
      hashes,
      previous,
      status: "scheduled",
    });

    const timer = window.setTimeout(
      () => {
        if (generationReference.current !== generation) {
          return;
        }
        setState({
          hashes,
          previous,
          status: "running",
        });

        void Promise.all([
          Promise.resolve().then(() =>
            evaluator.evaluate({ document, target: "draft" }),
          ),
          Promise.resolve().then(() =>
            evaluator.evaluate({ document, target: "compilation" }),
          ),
        ])
          .then(([draftReport, compilationReport]) => {
            if (generationReference.current !== generation) {
              return;
            }
            if (
              !reportsMatchDocument(
                draftReport,
                compilationReport,
                document,
                hashes,
                evaluator.environment,
              )
            ) {
              throw new TypeError(
                "Validation reports did not match the current document and requested targets.",
              );
            }

            const snapshot: EditorValidationSnapshot = Object.freeze({
              compilationReport,
              draftReport,
              hashes,
            });
            setState({ snapshot, status: "current" });
            sessionStore
              .getState()
              .announceValidation(completedAnnouncement(snapshot));
          })
          .catch(() => {
            if (generationReference.current !== generation) {
              return;
            }
            const message =
              "Validation failed closed. The previous report, if any, is stale and cannot establish readiness.";
            setState({
              hashes,
              message,
              previous,
              status: "failed",
            });
            sessionStore.getState().announceValidation(message);
          });
      },
      Math.max(0, debounceMilliseconds),
    );

    return () => {
      window.clearTimeout(timer);
    };
    // The hashes, rather than document object identity, define a meaningful
    // serialized edit. Selection, panels, viewport, and wizard state cannot
    // retrigger validation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debounceMilliseconds,
    evaluator,
    hashes?.contentHash,
    hashes?.visualHash,
    requestVersion,
    sessionStore,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(
    () => () => {
      generationReference.current += 1;
    },
    [],
  );

  const requestValidation = useCallback(() => {
    setRequestVersion((current) => current + 1);
  }, []);

  return {
    requestValidation,
    state,
  };
}
