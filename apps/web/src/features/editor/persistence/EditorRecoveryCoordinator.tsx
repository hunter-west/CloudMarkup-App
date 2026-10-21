import {
  getArchitectureDocumentHashes,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createEditorRecoveryAutosaveController,
  type EditorRecoveryAutosaveController,
  type EditorRecoveryAutosaveState,
} from "./editor-recovery-autosave.js";
import {
  EditorRecoveryContext,
  type EditorRecoveryContextValue,
  type EditorRecoveryStatus,
} from "./editor-recovery-context.js";
import {
  createEditorRecoveryBindingV1,
  serializeEditorRecoveryDiagnosticV1,
} from "./editor-recovery-envelope.js";
import type {
  EditorRecoveryBindingV1,
  EditorRecoveryDiagnosticV1,
  EditorRecoveryHead,
  EditorRecoveryRejected,
  EditorRecoveryStoreV1,
} from "./editor-recovery-store.js";

export interface ResolvedEditorRecoverySession {
  readonly document: ArchitectureDocument | null;
  readonly mountKey: string;
}

export interface EditorRecoveryCoordinatorProps {
  readonly autosaveDebounceMilliseconds?: number;
  readonly children: (session: ResolvedEditorRecoverySession) => ReactNode;
  readonly checkingFallback?: ReactNode;
  readonly downloadDiagnostic?: (contents: string, filename: string) => void;
  readonly now?: () => string;
  readonly scopeKey: string;
  readonly seedDocument: ArchitectureDocument | null;
  readonly store?: EditorRecoveryStoreV1;
  readonly writerId: string;
}

interface RecoveryResolution {
  readonly document: ArchitectureDocument | null;
  readonly mountKey: string;
}

interface RecoveryActivation {
  readonly lastSavedAt: string | null;
  readonly message: string;
  readonly queueForCheckpoint?: boolean;
  readonly recovered: boolean;
}

interface SupersededRecoveryScope {
  readonly binding: EditorRecoveryBindingV1;
  readonly head: EditorRecoveryHead;
}

function sameRecoveryDocument(
  left: ArchitectureDocument | null,
  right: ArchitectureDocument | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  const leftHashes = getArchitectureDocumentHashes(left);
  const rightHashes = getArchitectureDocumentHashes(right);
  return (
    left.documentId === right.documentId &&
    left.architectureId === right.architectureId &&
    left.revision.revisionId === right.revision.revisionId &&
    leftHashes.contentHash === rightHashes.contentHash &&
    leftHashes.visualHash === rightHashes.visualHash
  );
}

const DEFAULT_NOW = () => new Date().toISOString();

function checkingStatus(): EditorRecoveryStatus {
  return {
    hasPendingChanges: false,
    message: "Checking this browser for a recoverable local draft.",
    status: "checking",
  };
}

function unsupportedStatus(): EditorRecoveryStatus {
  return {
    hasPendingChanges: false,
    message:
      "Local draft recovery is unavailable in this browser. Changes are not persisted.",
    status: "unsupported",
  };
}

function failedStatus(
  message: string,
  diagnostic?: EditorRecoveryDiagnosticV1,
  hasPendingChanges = false,
): EditorRecoveryStatus {
  return {
    ...(diagnostic === undefined ? {} : { diagnostic }),
    hasPendingChanges,
    message,
    status: "failed",
  };
}

function recoveryRequiredStatus(
  rejected: EditorRecoveryRejected,
  message?: string,
): EditorRecoveryStatus {
  return {
    classification: rejected.classification,
    diagnostic: rejected.diagnostic,
    hasPendingChanges: false,
    message:
      message ??
      (rejected.classification === "envelope-unsupported-future"
        ? "A local draft was written by a newer unsupported version. It was not opened or overwritten."
        : "A local draft could not be loaded safely. Choose how to resolve it before local autosave can resume."),
    status: "recovery-required",
  };
}

function mapAutosaveState(
  state: EditorRecoveryAutosaveState,
): EditorRecoveryStatus {
  switch (state.status) {
    case "dirty":
      return {
        hasPendingChanges: true,
        message: "Local architecture changes are waiting to be saved.",
        status: "unsaved",
      };
    case "saving":
      return {
        hasPendingChanges: state.hasPendingChanges,
        message: "Saving a local recovery checkpoint.",
        status: "saving",
      };
    case "saved":
      return {
        hasPendingChanges: false,
        lastSavedAt: state.savedAt,
        message:
          state.savedAt === null
            ? "Local draft recovery is ready."
            : "Local recovery checkpoint saved.",
        recovered: false,
        status: "saved",
      };
    case "conflict":
      return {
        hasPendingChanges: state.hasPendingChanges,
        message:
          "Local autosave paused because another tab changed this architecture. Reload before continuing to avoid overwriting it.",
        status: "conflict",
      };
    case "rejected":
      return failedStatus(
        "Local autosave rejected the Architecture Document. The rejected document was not written.",
        state.diagnostic,
        state.hasPendingChanges,
      );
    case "unavailable":
      return state.code === "not-supported"
        ? unsupportedStatus()
        : failedStatus(state.message, undefined, state.hasPendingChanges);
  }
}

function browserDiagnosticDownload(
  contents: string,
  filename: string,
): boolean {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return false;
  }

  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" }),
  );
  try {
    const anchor = document.createElement("a");
    anchor.download = filename;
    anchor.href = url;
    anchor.rel = "noopener";
    anchor.click();
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function headMessage(result: "discarded" | "recovered"): RecoveryActivation {
  return result === "recovered"
    ? {
        lastSavedAt: null,
        message:
          "A validated safe local checkpoint was recovered. New history starts from this document.",
        recovered: true,
      }
    : {
        lastSavedAt: null,
        message:
          "The rejected local draft was discarded. New history starts from the fixture document.",
        recovered: false,
      };
}

export function EditorRecoveryCoordinator({
  autosaveDebounceMilliseconds,
  children,
  checkingFallback = (
    <p aria-live="polite" role="status">
      Checking local draft recovery...
    </p>
  ),
  downloadDiagnostic,
  now = DEFAULT_NOW,
  scopeKey,
  seedDocument,
  store,
  writerId,
}: EditorRecoveryCoordinatorProps) {
  const binding = useMemo(
    () =>
      seedDocument === null
        ? null
        : createEditorRecoveryBindingV1({ scopeKey, seedDocument }),
    [scopeKey, seedDocument],
  );
  const recoveryEnabled = store !== undefined && binding !== null;
  const [resolution, setResolution] = useState<RecoveryResolution | null>(() =>
    recoveryEnabled
      ? null
      : {
          document: seedDocument,
          mountKey: `${scopeKey}:local-recovery-disabled`,
        },
  );
  const [recoveryState, setRecoveryState] = useState<EditorRecoveryStatus>(
    () =>
      store === undefined
        ? unsupportedStatus()
        : binding === null
          ? failedStatus(
              "Local recovery cannot start because the fixture Architecture Document is invalid.",
            )
          : checkingStatus(),
  );
  const resolutionReference = useRef<RecoveryResolution | null>(resolution);
  const autosaveReference = useRef<EditorRecoveryAutosaveController | null>(
    null,
  );
  const autosaveBindingReference = useRef<EditorRecoveryBindingV1 | null>(null);
  const pruneAllowedReference = useRef(false);
  const pruneInFlightReference = useRef(false);
  const pruneRequestedReference = useRef(false);
  const supersededScopesReference = useRef(
    new Map<string, SupersededRecoveryScope>(),
  );
  const rejectedReference = useRef<EditorRecoveryRejected | null>(null);
  const diagnosticReference = useRef<EditorRecoveryDiagnosticV1 | null>(null);
  const mountSequenceReference = useRef(0);
  const mountedReference = useRef(true);

  useEffect(() => {
    mountedReference.current = true;
    return () => {
      mountedReference.current = false;
    };
  }, []);

  const pruneSupersededScopes = useCallback(
    function pruneSupersededScopesCallback() {
      if (
        store === undefined ||
        !pruneAllowedReference.current ||
        supersededScopesReference.current.size === 0
      ) {
        return;
      }
      if (pruneInFlightReference.current) {
        pruneRequestedReference.current = true;
        return;
      }
      pruneRequestedReference.current = false;
      pruneInFlightReference.current = true;
      void (async () => {
        for (const [fingerprint, candidate] of [
          ...supersededScopesReference.current,
        ]) {
          const result = await store.discard({
            binding: candidate.binding,
            expectedHead: candidate.head,
            writerId,
          });
          if (result.status !== "unavailable") {
            supersededScopesReference.current.delete(fingerprint);
          }
        }
      })().finally(() => {
        pruneInFlightReference.current = false;
        if (pruneRequestedReference.current) {
          pruneRequestedReference.current = false;
          pruneSupersededScopesCallback();
        }
      });
    },
    [store, writerId],
  );

  const stopAutosave = useCallback(() => {
    const controller = autosaveReference.current;
    autosaveReference.current = null;
    autosaveBindingReference.current = null;
    if (controller === null) {
      return;
    }
    void controller.flush().finally(() => {
      controller.dispose();
    });
  }, []);

  const stageAutosaveForPruning = useCallback(() => {
    pruneAllowedReference.current = false;
    const controller = autosaveReference.current;
    const activeBinding = autosaveBindingReference.current;
    autosaveReference.current = null;
    autosaveBindingReference.current = null;
    if (controller === null) {
      return;
    }
    void controller
      .flush()
      .then((state) => {
        if (
          activeBinding !== null &&
          state.status === "saved" &&
          state.head !== null
        ) {
          supersededScopesReference.current.set(
            activeBinding.scopeFingerprint,
            { binding: activeBinding, head: state.head },
          );
          pruneSupersededScopes();
        }
      })
      .finally(() => {
        controller.dispose();
      });
  }, [pruneSupersededScopes]);

  const mountDocument = useCallback(
    (document: ArchitectureDocument | null) => {
      if (
        sameRecoveryDocument(
          resolutionReference.current?.document ?? null,
          document,
        )
      ) {
        return;
      }
      mountSequenceReference.current += 1;
      const next = {
        document,
        mountKey:
          scopeKey + ":recovery-" + String(mountSequenceReference.current),
      };
      resolutionReference.current = next;
      setResolution(next);
    },
    [scopeKey],
  );
  const activateAutosave = useCallback(
    (
      document: ArchitectureDocument,
      head: EditorRecoveryHead | null,
      activation: RecoveryActivation,
    ) => {
      if (!mountedReference.current) {
        return;
      }
      if (store === undefined || binding === null) {
        mountDocument(document);
        setRecoveryState(unsupportedStatus());
        return;
      }

      stopAutosave();
      rejectedReference.current = null;
      diagnosticReference.current = null;
      mountDocument(document);

      let controller: EditorRecoveryAutosaveController;
      try {
        controller = createEditorRecoveryAutosaveController({
          binding,
          initialHead: head,
          store,
          writerId,
          ...(autosaveDebounceMilliseconds === undefined
            ? {}
            : { debounceMilliseconds: autosaveDebounceMilliseconds }),
          now,
        });
      } catch {
        setRecoveryState(
          failedStatus("Local autosave could not be initialized safely."),
        );
        return;
      }

      autosaveReference.current = controller;
      autosaveBindingReference.current = binding;
      controller.subscribe((nextState) => {
        if (
          !mountedReference.current ||
          autosaveReference.current !== controller
        ) {
          return;
        }
        if (nextState.status === "rejected") {
          diagnosticReference.current = nextState.diagnostic;
          controller.dispose();
          autosaveReference.current = null;
          autosaveBindingReference.current = null;
        }
        if (nextState.status === "saved" && nextState.head !== null) {
          pruneAllowedReference.current = true;
          pruneSupersededScopes();
        }
        setRecoveryState(mapAutosaveState(nextState));
      });
      setRecoveryState({
        hasPendingChanges: false,
        lastSavedAt: activation.lastSavedAt,
        message: activation.message,
        recovered: activation.recovered,
        status: "saved",
      });
      if (activation.queueForCheckpoint === true) {
        pruneAllowedReference.current = false;
        controller.queue(document);
      } else {
        pruneAllowedReference.current = true;
        pruneSupersededScopes();
      }
    },
    [
      autosaveDebounceMilliseconds,
      binding,
      mountDocument,
      now,
      pruneSupersededScopes,
      stopAutosave,
      store,
      writerId,
    ],
  );

  useEffect(() => {
    if (store === undefined || binding === null || seedDocument === null) {
      return;
    }

    let active = true;
    stopAutosave();
    rejectedReference.current = null;
    diagnosticReference.current = null;
    void store
      .load(binding)
      .then((result) => {
        if (!active) {
          return;
        }
        const currentDocument = resolutionReference.current?.document ?? null;
        const rebasedLocalDocument =
          currentDocument !== null &&
          !sameRecoveryDocument(currentDocument, seedDocument)
            ? currentDocument
            : null;
        switch (result.status) {
          case "empty":
            activateAutosave(rebasedLocalDocument ?? seedDocument, null, {
              lastSavedAt: null,
              message:
                rebasedLocalDocument === null
                  ? "Local draft recovery is ready. Accepted Architecture Document changes will be saved in this browser."
                  : "Unsaved editor changes were rebound to the acknowledged server version and queued for local recovery.",
              queueForCheckpoint: rebasedLocalDocument !== null,
              recovered: false,
            });
            return;
          case "ready":
            activateAutosave(
              rebasedLocalDocument ?? result.document,
              result.head,
              {
                lastSavedAt: result.envelope.checkpoint.savedAt,
                message:
                  rebasedLocalDocument === null
                    ? "Recovered the latest validated local Architecture Document checkpoint."
                    : "Newer in-memory editor changes were preserved and queued over the exact-version local checkpoint.",
                queueForCheckpoint: rebasedLocalDocument !== null,
                recovered: rebasedLocalDocument === null,
              },
            );
            return;
          case "rejected":
            rejectedReference.current = result;
            diagnosticReference.current = result.diagnostic;
            if (rebasedLocalDocument === null) {
              resolutionReference.current = null;
              setResolution(null);
            }
            setRecoveryState(recoveryRequiredStatus(result));
            return;
          case "unavailable":
            mountDocument(rebasedLocalDocument ?? seedDocument);
            setRecoveryState(
              result.code === "not-supported"
                ? unsupportedStatus()
                : failedStatus(result.message),
            );
        }
      })
      .catch(() => {
        if (!active) {
          return;
        }
        const currentDocument =
          resolutionReference.current?.document ?? seedDocument;
        mountDocument(currentDocument);
        setRecoveryState(
          failedStatus(
            "The local recovery adapter threw while checking for a draft.",
          ),
        );
      });

    return () => {
      active = false;
      stageAutosaveForPruning();
    };
  }, [
    activateAutosave,
    binding,
    mountDocument,
    seedDocument,
    stageAutosaveForPruning,
    stopAutosave,
    store,
  ]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const flush = () => {
      void autosaveReference.current?.flush();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };

    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const documentChanged = useCallback((document: ArchitectureDocument) => {
    const currentResolution = resolutionReference.current;
    if (currentResolution !== null) {
      resolutionReference.current = { ...currentResolution, document };
    }
    const controller = autosaveReference.current;
    if (controller !== null) {
      controller.queue(document);
      return;
    }
    setRecoveryState((current) => {
      switch (current.status) {
        case "recovery-required":
          return {
            ...current,
            hasPendingChanges: true,
            message:
              "This Architecture Document has local changes, but autosave is blocked until the rejected draft is resolved.",
          };
        case "failed":
          return {
            ...current,
            hasPendingChanges: true,
            message:
              "This Architecture Document has local changes that local recovery could not save.",
          };
        case "unsupported":
          return {
            ...current,
            hasPendingChanges: true,
            message:
              "This Architecture Document has changes that are not persisted because local recovery is unavailable.",
          };
        default:
          return current;
      }
    });
  }, []);

  const recoverSafeCheckpoint = useCallback(async (): Promise<boolean> => {
    const rejected = rejectedReference.current;
    if (
      store === undefined ||
      binding === null ||
      seedDocument === null ||
      rejected === null
    ) {
      return false;
    }

    const safeDocument =
      rejected.previousValidCheckpoint?.document ?? seedDocument;
    setRecoveryState({
      hasPendingChanges: false,
      message: "Writing a validated safe recovery checkpoint.",
      status: "saving",
    });
    try {
      const savedAt = now();
      const result = await store.remediateRejected({
        action: "replace",
        binding,
        document: safeDocument,
        expectedClassification: rejected.classification,
        expectedHead: rejected.actualHead ?? null,
        savedAt,
        writerId,
      });
      if (!mountedReference.current) {
        return false;
      }
      if (result.status === "stored") {
        activateAutosave(safeDocument, result.head, {
          ...headMessage("recovered"),
          lastSavedAt: savedAt,
        });
        return true;
      }
      if (result.status === "conflict") {
        setRecoveryState({
          hasPendingChanges: false,
          message:
            "Recovery paused because the local record changed after it was inspected. Reload before choosing a recovery action.",
          status: "conflict",
        });
        return false;
      }
      if (result.status === "rejected") {
        diagnosticReference.current = result.diagnostic;
        setRecoveryState(
          failedStatus(
            "The safe recovery checkpoint was rejected and was not written.",
            result.diagnostic,
          ),
        );
        return false;
      }
      if (result.status === "discarded") {
        setRecoveryState(
          failedStatus(
            "The recovery adapter discarded a draft while a safe replacement was requested.",
          ),
        );
        return false;
      }
      setRecoveryState(failedStatus(result.message));
      return false;
    } catch {
      if (!mountedReference.current) {
        return false;
      }
      setRecoveryState(
        failedStatus(
          "The local recovery adapter threw while writing the safe checkpoint.",
        ),
      );
      return false;
    }
  }, [activateAutosave, binding, now, seedDocument, store, writerId]);

  const discardLocalDraft = useCallback(async (): Promise<boolean> => {
    const rejected = rejectedReference.current;
    if (
      store === undefined ||
      binding === null ||
      seedDocument === null ||
      rejected === null
    ) {
      return false;
    }

    setRecoveryState({
      hasPendingChanges: false,
      message: "Discarding the rejected local draft.",
      status: "saving",
    });
    try {
      const result = await store.remediateRejected({
        action: "discard",
        binding,
        expectedClassification: rejected.classification,
        expectedHead: rejected.actualHead ?? null,
        writerId,
      });
      if (!mountedReference.current) {
        return false;
      }
      if (result.status === "discarded") {
        activateAutosave(seedDocument, null, headMessage("discarded"));
        return true;
      }
      if (result.status === "conflict") {
        setRecoveryState({
          hasPendingChanges: false,
          message:
            "Discard paused because the local record changed after it was inspected. Reload before choosing a recovery action.",
          status: "conflict",
        });
        return false;
      }
      if (result.status === "rejected") {
        diagnosticReference.current = result.diagnostic;
        setRecoveryState(
          failedStatus(
            "The rejected local draft could not be discarded safely.",
            result.diagnostic,
          ),
        );
        return false;
      }
      if (result.status === "stored") {
        setRecoveryState(
          failedStatus(
            "The recovery adapter returned an unexpected replacement while discarding the draft.",
          ),
        );
        return false;
      }
      setRecoveryState(failedStatus(result.message));
      return false;
    } catch {
      if (!mountedReference.current) {
        return false;
      }
      setRecoveryState(
        failedStatus(
          "The local recovery adapter threw while discarding the rejected draft.",
        ),
      );
      return false;
    }
  }, [activateAutosave, binding, seedDocument, store, writerId]);

  const downloadDiagnosticCopy = useCallback((): boolean => {
    const diagnostic = diagnosticReference.current;
    if (diagnostic === null) {
      return false;
    }
    const serialized = serializeEditorRecoveryDiagnosticV1(diagnostic);
    if (downloadDiagnostic !== undefined) {
      downloadDiagnostic(serialized, "cloudmarkup-recovery-diagnostic.json");
      return true;
    }
    return browserDiagnosticDownload(
      serialized,
      "cloudmarkup-recovery-diagnostic.json",
    );
  }, [downloadDiagnostic]);

  const contextValue = useMemo<EditorRecoveryContextValue>(
    () => ({
      discardLocalDraft,
      documentChanged,
      downloadDiagnosticCopy,
      recoverSafeCheckpoint,
      state: recoveryState,
    }),
    [
      discardLocalDraft,
      documentChanged,
      downloadDiagnosticCopy,
      recoverSafeCheckpoint,
      recoveryState,
    ],
  );

  return (
    <EditorRecoveryContext.Provider value={contextValue}>
      {resolution === null
        ? checkingFallback
        : children({
            document: resolution.document,
            mountKey: resolution.mountKey,
          })}
    </EditorRecoveryContext.Provider>
  );
}
