import {
  applyPreparedResourceRepair,
  type PreparedResourceRepair,
} from "../model/resource-repair-command.js";
import { createArchitectureDocumentIndex } from "../model/architecture-document-index.js";
import { EditorDocumentIndexContext } from "./editor-session-context.js";
import {
  GraphCommandApplicationError,
  applyGraphCommand,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
  type ArchitectureDocumentHashes,
  type GraphCommandApplicationResult,
  type ValidationFindingId,
} from "@cloudmarkup/domain";
import type {
  ProviderConnectionResolutionResultV1,
  ProviderConnectionResolverV1,
} from "@cloudmarkup/provider-sdk";
import {
  parseGraphCommandV1,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import type { ServiceCreationOptions } from "../model/placement-rules.js";
import type { GraphCommandV1 } from "@cloudmarkup/schemas";
import type { IconRegistry } from "@cloudmarkup/ui";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  applyPreparedConfigurationCommand,
  ArchitectureLayoutError,
  CLOSED_CONNECTION_WORKFLOW,
  ConfigurationCommandPreparationError,
  applyPreparedArchitectureLayout,
  connectionEducation,
  createArchitectureLayoutRequest,
  createConfigurationFormBufferKey,
  dispatchAddServiceCommand,
  DisconnectEdgeCommandError,
  dispatchDisconnectEdgeCommand,
  dispatchEditorNodeMove,
  dispatchEditorNodePlacement,
  EditorNodePlacementError,
  initialConnectionConfiguration,
  inspectEditorConnectionDock,
  isLayoutCanceledError,
  listEditorNodePlacementOptions,
  prepareArchitectureLayout,
  prepareConnectionCompatibilityRequest,
  prepareConfigurationCommand,
  projectConnectionCandidates,
  projectConnectionFindings,
  projectConnectionPreview,
  prepareServiceRemoval,
  ServiceRemovalError,
  type ConfigurationCommandTarget,
  type ConfigurationEdit,
  type EditorCatalog,
  type EditorConnectionFinding,
  type EditorConnectionStartIntent,
  type EditorConnectionWorkflow,
  type LayoutAdapter,
  type PreparedArchitectureLayout,
  type PreparedConfigurationCommand,
  type PreparedWorkloadOperationCommand,
  type PreparedServiceRemoval,
} from "../model/index.js";
import type { OwnedPolicyGraphDescriptorSet } from "../model/owned-configuration-policy-model.js";
import type { OwnedPolicyCommandPreparationResult } from "../model/owned-policy-commands.js";
import { hasExactEditorCatalogBinding } from "@cloudmarkup/graph-preparation/catalog-selection";
import { prepareEventWorkloadBinding } from "@cloudmarkup/graph-preparation/event-workload-binding";
import {
  createEditorCommandHistory,
  getEditorCommandHistorySummary,
  recordEditorCommand,
  redoEditorCommand,
  undoEditorCommand,
  type EditorCommandHistory,
} from "../model/editor-command-history.js";
import { EditorRecoveryCoordinator } from "../persistence/EditorRecoveryCoordinator.js";
import { useEditorRecovery } from "../persistence/editor-recovery-context.js";
import { createEditorRuntimeIdentity } from "../persistence/editor-runtime-identity.js";
import type { EditorRecoveryStoreV1 } from "../persistence/editor-recovery-store.js";
import {
  findValidationFinding,
  isEditorValidationSnapshotComplete,
  type EditorValidationEvaluator,
  type EditorValidationFixResult,
  type EditorValidationTarget,
} from "../validation/editor-validation.js";
import { useEditorValidation } from "../validation/use-editor-validation.js";
import {
  EditorDocumentSessionContext,
  EditorSessionStoreContext,
  type AddServiceFailure,
  type AddServiceResult,
  type ConnectionWorkflowActionResult,
  type ConfigurationApplyFailure,
  type ConfigurationApplyResult,
  type ConfigurationPreviewFailure,
  type ConfigurationPreviewResult,
  type EditorCommandHistoryStatus,
  type EditorDocumentProblem,
  type EditorDocumentSession,
  type EditorHistoryActionResult,
  type ServiceRemovalPreviewResult,
  type EditorLayoutWorkflow,
  type MoveNodeFailure,
  type MoveNodeResult,
} from "./editor-session-context.js";
import {
  createEditorSessionStore,
  type EditorPosition,
  type EditorSessionStore,
} from "./editor-session-store.js";

const INVALID_DOCUMENT_PROBLEM: EditorDocumentProblem = Object.freeze({
  message:
    "The architecture document is invalid or unsupported. It was not loaded.",
  title: "Architecture unavailable",
});

const DOCUMENT_UNAVAILABLE_FAILURE: MoveNodeFailure = Object.freeze({
  code: "document-unavailable",
  message:
    "The node could not be moved because no valid architecture is loaded.",
  ok: false,
});

const COMMAND_REJECTED_FAILURE: MoveNodeFailure = Object.freeze({
  code: "command-rejected",
  message:
    "The node could not be moved. The architecture document was not changed.",
  ok: false,
});

const PLACEMENT_REJECTED_FAILURE = (message: string): MoveNodeFailure => ({
  code: "placement-rejected",
  message,
  ok: false,
});

function placementCommandFailure(error: unknown): MoveNodeFailure {
  if (
    error instanceof EditorNodePlacementError &&
    error.code !== "duplicate-command-identity"
  ) {
    return PLACEMENT_REJECTED_FAILURE(error.message);
  }
  return COMMAND_REJECTED_FAILURE;
}

const LAYOUT_PREVIEW_UNAVAILABLE_FAILURE: MoveNodeFailure = Object.freeze({
  code: "command-rejected",
  message:
    "Review a completed automatic-layout preview before applying positions.",
  ok: false,
});

const IDLE_LAYOUT_WORKFLOW: EditorLayoutWorkflow = Object.freeze({
  message: null,
  preview: null,
  status: "idle",
});

const EMPTY_HISTORY_STATUS: EditorCommandHistoryStatus = Object.freeze({
  barrierMessage: null,
  canRedo: false,
  canUndo: false,
  redoLabel: null,
  undoLabel: null,
});

function projectHistoryStatus(
  history: EditorCommandHistory | null,
): EditorCommandHistoryStatus {
  if (history === null) {
    return EMPTY_HISTORY_STATUS;
  }
  const summary = getEditorCommandHistorySummary(history);
  return {
    barrierMessage:
      summary.barrier === null
        ? null
        : summary.barrier.kind === "non-invertible"
          ? summary.barrier.reason.message
          : summary.barrier.message,
    canRedo: summary.canRedo,
    canUndo: summary.canUndo,
    redoLabel: summary.redoLabel,
    undoLabel: summary.undoLabel,
    entries: history.entries.map((entry, index) => ({
      id: entry.forwardCommand.commandId,
      label: entry.label,
      applied: index < history.cursor,
    })),
  };
}

const ADD_DOCUMENT_UNAVAILABLE_FAILURE: AddServiceFailure = Object.freeze({
  code: "document-unavailable",
  message:
    "The service could not be added because no valid architecture is loaded.",
  ok: false,
});

const ADD_COMMAND_REJECTED_FAILURE: AddServiceFailure = Object.freeze({
  code: "command-rejected",
  message:
    "The service could not be added. The architecture document was not changed.",
  ok: false,
});

const CONFIGURATION_DOCUMENT_UNAVAILABLE_FAILURE: ConfigurationPreviewFailure =
  Object.freeze({
    code: "document-unavailable",
    issues: [],
    message:
      "Configuration could not be previewed because no valid architecture is loaded.",
    ok: false,
  });

const CONFIGURATION_APPLY_DOCUMENT_UNAVAILABLE_FAILURE: ConfigurationApplyFailure =
  Object.freeze({
    code: "document-unavailable",
    message:
      "Configuration could not be applied because no valid architecture is loaded.",
    ok: false,
  });

const CONFIGURATION_PREVIEW_UNAVAILABLE_FAILURE: ConfigurationApplyFailure =
  Object.freeze({
    code: "preview-unavailable",
    message: "Preview a valid configuration command before applying changes.",
    ok: false,
  });

function editorConnectionFinding(
  code: string,
  guidedMessage: string,
  professionalMessage: string,
  path = "$.connection",
): EditorConnectionFinding {
  return {
    code,
    guidedMessage,
    path,
    professionalMessage,
    severity: "error",
  };
}

interface LoadedArchitectureDocument {
  readonly document: ArchitectureDocument;
  readonly hashes: ArchitectureDocumentHashes;
  readonly status: "ready";
}

interface InvalidArchitectureDocument {
  readonly problem: EditorDocumentProblem;
  readonly status: "invalid";
}

type ArchitectureDocumentLoad =
  InvalidArchitectureDocument | LoadedArchitectureDocument;

export interface EditorSessionProviderProps {
  readonly catalog: EditorCatalog;
  readonly children: ReactNode;
  readonly createId: () => string;
  readonly document: unknown;
  readonly iconRegistry: IconRegistry<ReactNode>;
  readonly ownedPolicyDescriptors?: OwnedPolicyGraphDescriptorSet;
  readonly connectionResolver?: ProviderConnectionResolverV1;
  readonly layoutAdapter?: LayoutAdapter;
  readonly validationDebounceMilliseconds?: number;
  readonly validationEvaluator?: EditorValidationEvaluator;
  readonly recoveryAutosaveDebounceMilliseconds?: number;
  readonly recoveryCheckingFallback?: ReactNode;
  readonly recoveryDownloadDiagnostic?: (
    contents: string,
    filename: string,
  ) => void;
  readonly recoveryNow?: () => string;
  readonly recoveryStore?: EditorRecoveryStoreV1;
  readonly recoveryWriterId?: string;
  readonly scopeKey?: string;
  readonly onDocumentChange?: (document: ArchitectureDocument) => void;
  readonly preserveSessionOnRecoveryRebind?: boolean;
}

interface EditorTransientStateProviderProps {
  readonly children: ReactNode;
}

interface EditorDocumentStateProviderProps {
  readonly catalog: EditorCatalog;
  readonly children: ReactNode;
  readonly connectionResolver?: ProviderConnectionResolverV1;
  readonly createId: () => string;
  readonly iconRegistry: IconRegistry<ReactNode>;
  readonly initialLoad: ArchitectureDocumentLoad;
  readonly ownedPolicyDescriptors?: OwnedPolicyGraphDescriptorSet;
  readonly layoutAdapter?: LayoutAdapter;
  readonly validationDebounceMilliseconds?: number;
  readonly validationEvaluator?: EditorValidationEvaluator;
  readonly onDocumentChange?: (document: ArchitectureDocument) => void;
  readonly preserveSessionOnRecoveryRebind?: boolean;
}

function loadArchitectureDocument(input: unknown): ArchitectureDocumentLoad {
  try {
    const document = parseArchitectureDocument(input);
    return {
      document,
      hashes: getArchitectureDocumentHashes(document),
      status: "ready",
    };
  } catch {
    return {
      problem: INVALID_DOCUMENT_PROBLEM,
      status: "invalid",
    };
  }
}

function documentScopeKey(load: ArchitectureDocumentLoad): string {
  if (load.status === "invalid") {
    return "invalid-architecture-document";
  }

  return [
    load.document.documentId,
    load.document.architectureId,
    load.document.revision.revisionId,
    load.hashes.contentHash,
    load.hashes.visualHash,
  ].join(":");
}

function EditorTransientStateProvider({
  children,
}: EditorTransientStateProviderProps) {
  const [store] = useState(createEditorSessionStore);

  return (
    <EditorSessionStoreContext.Provider value={store}>
      {children}
    </EditorSessionStoreContext.Provider>
  );
}

interface EditorRecoveryDocumentProvidersProps extends Omit<
  EditorDocumentStateProviderProps,
  "onDocumentChange"
> {
  readonly mountKey: string;
  readonly onDocumentChange?: (document: ArchitectureDocument) => void;
  readonly preserveSessionOnRecoveryRebind?: boolean;
}

function EditorRecoveryDocumentProviders({
  mountKey,
  onDocumentChange,
  ...documentProviderProps
}: EditorRecoveryDocumentProvidersProps) {
  const recovery = useEditorRecovery();
  const handleDocumentChange = useCallback(
    (document: ArchitectureDocument) => {
      recovery.documentChanged(document);
      onDocumentChange?.(document);
    },
    [onDocumentChange, recovery],
  );
  return (
    <EditorTransientStateProvider key={mountKey}>
      <EditorDocumentStateProvider
        key={mountKey}
        {...documentProviderProps}
        onDocumentChange={handleDocumentChange}
      />
    </EditorTransientStateProvider>
  );
}

function EditorDocumentStateProvider({
  catalog,
  children,
  connectionResolver,
  createId,
  iconRegistry,
  initialLoad,
  layoutAdapter,
  ownedPolicyDescriptors,
  onDocumentChange,
  validationDebounceMilliseconds,
  validationEvaluator,
}: EditorDocumentStateProviderProps) {
  const sessionStore = useEditorSessionStoreForProvider();
  const [loadedDocument, setLoadedDocument] =
    useState<ArchitectureDocumentLoad>(initialLoad);
  const [configurationPreview, setConfigurationPreview] =
    useState<PreparedConfigurationCommand | null>(null);
  const [connectionWorkflow, setConnectionWorkflow] =
    useState<EditorConnectionWorkflow>(CLOSED_CONNECTION_WORKFLOW);
  const [layoutWorkflow, setLayoutWorkflow] =
    useState<EditorLayoutWorkflow>(IDLE_LAYOUT_WORKFLOW);
  const [initialHistory] = useState<EditorCommandHistory | null>(() =>
    initialLoad.status === "ready"
      ? createEditorCommandHistory(initialLoad.document)
      : null,
  );
  const historyReference = useRef<EditorCommandHistory | null>(initialHistory);
  const [historyStatus, setHistoryStatus] =
    useState<EditorCommandHistoryStatus>(() =>
      projectHistoryStatus(initialHistory),
    );
  const documentReference = useRef<ArchitectureDocument | null>(
    initialLoad.status === "ready" ? initialLoad.document : null,
  );
  const configurationPreviewReference =
    useRef<PreparedConfigurationCommand | null>(null);
  const connectionPreviewReference = useRef<Extract<
    ProviderConnectionResolutionResultV1,
    { success: true }
  > | null>(null);
  const layoutAbortReference = useRef<AbortController | null>(null);
  const layoutGenerationReference = useRef(0);
  const layoutPreviewReference = useRef<PreparedArchitectureLayout | null>(
    null,
  );
  const { requestValidation, state: validation } = useEditorValidation({
    document:
      loadedDocument.status === "ready" ? loadedDocument.document : null,
    sessionStore,
    ...(validationEvaluator === undefined
      ? {}
      : { evaluator: validationEvaluator }),
    ...(validationDebounceMilliseconds === undefined
      ? {}
      : { debounceMilliseconds: validationDebounceMilliseconds }),
  });

  useEffect(() => {
    const focus = sessionStore.getState().validationFocus;
    if (focus === null) {
      return;
    }
    const findingStillCurrent =
      validation.status === "current" &&
      (focus.target === "draft"
        ? validation.snapshot.draftReport
        : validation.snapshot.compilationReport
      ).findings.some((finding) => finding.findingId === focus.findingId);
    if (!findingStillCurrent) {
      sessionStore.getState().setValidationFocus(null);
    }
  }, [sessionStore, validation]);

  const acceptLoadedDocument = useCallback(
    (nextLoad: LoadedArchitectureDocument) => {
      const previousDocument = documentReference.current;
      const previousHashes =
        previousDocument === null
          ? null
          : getArchitectureDocumentHashes(previousDocument);
      documentReference.current = nextLoad.document;
      setLoadedDocument(nextLoad);
      if (
        previousHashes?.contentHash !== nextLoad.hashes.contentHash ||
        previousHashes.visualHash !== nextLoad.hashes.visualHash
      ) {
        onDocumentChange?.(nextLoad.document);
      }
    },
    [onDocumentChange],
  );

  const updateHistory = useCallback((history: EditorCommandHistory) => {
    historyReference.current = history;
    setHistoryStatus(projectHistoryStatus(history));
  }, []);

  const recordAppliedCommand = useCallback(
    (
      command: GraphCommandV1,
      application: GraphCommandApplicationResult,
      label: string,
    ) => {
      const history = historyReference.current;
      if (history === null) {
        return;
      }
      const recorded = recordEditorCommand(
        history,
        command,
        application,
        label,
      );
      if (recorded.ok) {
        updateHistory(recorded.history);
        return;
      }

      const replacement = createEditorCommandHistory(application.document);
      updateHistory(replacement);
      sessionStore
        .getState()
        .announce(
          "The architecture change was applied, but older undo history was reset because it could not be verified.",
        );
    },
    [sessionStore, updateHistory],
  );

  const clearConfigurationPreview = useCallback(() => {
    configurationPreviewReference.current = null;
    setConfigurationPreview(null);
  }, []);

  const clearConnectionWorkflow = useCallback(() => {
    connectionPreviewReference.current = null;
    setConnectionWorkflow(CLOSED_CONNECTION_WORKFLOW);
  }, []);

  useEffect(
    () => () => {
      layoutGenerationReference.current += 1;
      layoutAbortReference.current?.abort();
      layoutAbortReference.current = null;
      layoutPreviewReference.current = null;
    },
    [],
  );

  const cancelAutomaticLayout = useCallback(() => {
    const hadDraft =
      layoutAbortReference.current !== null ||
      layoutPreviewReference.current !== null;
    layoutGenerationReference.current += 1;
    layoutAbortReference.current?.abort();
    layoutAbortReference.current = null;
    layoutPreviewReference.current = null;
    sessionStore.getState().clearAllPositionPreviews();
    setLayoutWorkflow(IDLE_LAYOUT_WORKFLOW);
    if (hadDraft) {
      const message = "Automatic layout canceled. No positions changed.";
      sessionStore.getState().setCanvasNotice({
        message,
        tone: "info",
      });
      sessionStore.getState().announce(message);
    }
  }, [sessionStore]);

  const clearStaleDocumentPreviews = useCallback(() => {
    clearConfigurationPreview();
    connectionPreviewReference.current = null;
    setConnectionWorkflow((current) =>
      current.preview === null
        ? current
        : { ...current, findings: [], preview: null },
    );
    layoutGenerationReference.current += 1;
    layoutAbortReference.current?.abort();
    layoutAbortReference.current = null;
    layoutPreviewReference.current = null;
    sessionStore.getState().clearAllPositionPreviews();
    setLayoutWorkflow(IDLE_LAYOUT_WORKFLOW);
  }, [clearConfigurationPreview, sessionStore]);

  const applyOwnedPolicyCommand = useCallback(
    (
      prepared: OwnedPolicyCommandPreparationResult,
      label: string,
    ): ConnectionWorkflowActionResult => {
      if (prepared.status !== "ready") {
        const message =
          prepared.status === "adopt-before-customize"
            ? prepared.reason
            : (prepared.issues[0]?.message ??
              "The owned configuration command is invalid. Nothing was applied.");
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }

      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        const message =
          "The owned configuration cannot be changed because no valid architecture is loaded.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }

      try {
        const application = applyGraphCommand(
          currentDocument,
          prepared.command,
        );
        const hashes = getArchitectureDocumentHashes(application.document);
        recordAppliedCommand(prepared.command, application, label);
        acceptLoadedDocument({
          document: application.document,
          hashes,
          status: "ready",
        });
        clearStaleDocumentPreviews();
        sessionStore
          .getState()
          .announce(`${label} applied through one Graph Command batch.`);
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof GraphCommandApplicationError &&
          error.issues.some((issue) => issue.code === "precondition_failed")
            ? "The owned configuration changed before this command could be applied. Review it again."
            : "The owned configuration command failed closed. The architecture document was not changed.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }
    },
    [
      acceptLoadedDocument,
      clearStaleDocumentPreviews,
      recordAppliedCommand,
      sessionStore,
    ],
  );

  const applyResourceRepair = useCallback(
    (prepared: PreparedResourceRepair): ConnectionWorkflowActionResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null)
        return { ok: false, message: "No valid design is loaded." };
      try {
        const application = applyPreparedResourceRepair(
          currentDocument,
          prepared,
        );
        const hashes = getArchitectureDocumentHashes(application.document);
        recordAppliedCommand(prepared.command, application, prepared.label);
        acceptLoadedDocument({
          document: application.document,
          hashes,
          status: "ready",
        });
        clearStaleDocumentPreviews();
        sessionStore
          .getState()
          .announce(prepared.label + " applied. Undo is available.");
        return { ok: true };
      } catch {
        const message =
          "The design changed or the repair is unavailable. Review the latest design and preview again.";
        sessionStore.getState().announce(message);
        return { ok: false, message };
      }
    },
    [
      acceptLoadedDocument,
      clearStaleDocumentPreviews,
      recordAppliedCommand,
      sessionStore,
    ],
  );

  const applyWorkloadOperationCommand = useCallback(
    (
      prepared: PreparedWorkloadOperationCommand,
    ): ConnectionWorkflowActionResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        const message =
          "The workload operation cannot be changed because no valid architecture is loaded.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }

      try {
        const application = applyGraphCommand(
          currentDocument,
          prepared.command,
        );
        const hashes = getArchitectureDocumentHashes(application.document);
        if (
          hashes.contentHash !== prepared.previewHashes.contentHash ||
          hashes.visualHash !== prepared.previewHashes.visualHash
        ) {
          throw new TypeError(
            "The workload operation replay did not match its prepared preview.",
          );
        }
        recordAppliedCommand(
          prepared.command,
          application,
          "Update workload purpose and I/O",
        );
        acceptLoadedDocument({
          document: application.document,
          hashes,
          status: "ready",
        });
        clearStaleDocumentPreviews();
        sessionStore
          .getState()
          .announce(
            "Workload purpose and I/O applied through one atomic Graph Command.",
          );
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof GraphCommandApplicationError &&
          error.issues.some((issue) => issue.code === "precondition_failed")
            ? "The workload or Application Contracts changed after this preview. Review the latest values and preview again."
            : "The workload operation failed closed. The architecture document was not changed.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }
    },
    [
      acceptLoadedDocument,
      clearStaleDocumentPreviews,
      recordAppliedCommand,
      sessionStore,
    ],
  );

  const transitionHistory = useCallback(
    (direction: "redo" | "undo"): EditorHistoryActionResult => {
      const currentDocument = documentReference.current;
      const history = historyReference.current;
      if (currentDocument === null || history === null) {
        const message =
          "History is unavailable because no valid architecture is loaded.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }

      const result =
        direction === "undo"
          ? undoEditorCommand(history, currentDocument)
          : redoEditorCommand(history, currentDocument);
      updateHistory(result.history);
      if (!result.ok) {
        sessionStore.getState().announce(result.message);
        return { message: result.message, ok: false };
      }

      const hashes = getArchitectureDocumentHashes(result.document);
      acceptLoadedDocument({
        document: result.document,
        hashes,
        status: "ready",
      });
      clearStaleDocumentPreviews();
      sessionStore
        .getState()
        .announce(
          `${direction === "undo" ? "Undid" : "Redid"} ${result.label}.`,
        );
      return { document: result.document, hashes, ok: true };
    },
    [
      acceptLoadedDocument,
      clearStaleDocumentPreviews,
      sessionStore,
      updateHistory,
    ],
  );

  const undo = useCallback(
    (): EditorHistoryActionResult => transitionHistory("undo"),
    [transitionHistory],
  );
  const redo = useCallback(
    (): EditorHistoryActionResult => transitionHistory("redo"),
    [transitionHistory],
  );

  const startAutomaticLayout = useCallback(() => {
    const currentDocument = documentReference.current;
    if (currentDocument === null || layoutAdapter === undefined) {
      const message =
        currentDocument === null
          ? "Automatic layout needs a valid architecture document."
          : "Automatic layout is not available in this editor session.";
      setLayoutWorkflow({
        message,
        preview: null,
        status: "error",
      });
      sessionStore.getState().setCanvasNotice({
        message,
        tone: "error",
      });
      sessionStore.getState().announce(message);
      return;
    }

    layoutGenerationReference.current += 1;
    const generation = layoutGenerationReference.current;
    layoutAbortReference.current?.abort();
    const controller = new AbortController();
    layoutAbortReference.current = controller;
    layoutPreviewReference.current = null;
    sessionStore.getState().clearAllPositionPreviews();
    sessionStore.getState().setCanvasNotice(null);
    setLayoutWorkflow({
      message: null,
      preview: null,
      status: "running",
    });

    void (async () => {
      try {
        const request = createArchitectureLayoutRequest(
          currentDocument,
          catalog,
        );
        const result = await layoutAdapter.layout(request, {
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          layoutGenerationReference.current !== generation
        ) {
          return;
        }
        if (documentReference.current !== currentDocument) {
          throw new Error(
            "The architecture changed while automatic layout was running.",
          );
        }

        const prepared = prepareArchitectureLayout(
          currentDocument,
          catalog,
          result,
          createId,
        );
        if (prepared === null) {
          layoutPreviewReference.current = null;
          setLayoutWorkflow(IDLE_LAYOUT_WORKFLOW);
          const message =
            "Automatic layout found no position changes to preview.";
          sessionStore.getState().setCanvasNotice({
            message,
            tone: "info",
          });
          sessionStore.getState().announce(message);
          return;
        }

        layoutPreviewReference.current = prepared;
        sessionStore.getState().clearAllPositionPreviews();
        for (const change of prepared.changes) {
          sessionStore
            .getState()
            .setNodePositionPreview(change.nodeId, change.to);
        }
        setLayoutWorkflow({
          message: null,
          preview: prepared,
          status: "preview",
        });
        sessionStore
          .getState()
          .announce(
            `Automatic layout preview ready for ${String(prepared.changes.length)} nodes. Confirm to apply positions.`,
          );
      } catch (error) {
        if (
          controller.signal.aborted ||
          layoutGenerationReference.current !== generation ||
          isLayoutCanceledError(error)
        ) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Automatic layout could not produce a safe preview.";
        layoutPreviewReference.current = null;
        sessionStore.getState().clearAllPositionPreviews();
        setLayoutWorkflow({
          message,
          preview: null,
          status: "error",
        });
        sessionStore.getState().setCanvasNotice({
          message,
          tone: "error",
        });
        sessionStore.getState().announce(message);
      } finally {
        if (layoutAbortReference.current === controller) {
          layoutAbortReference.current = null;
        }
      }
    })();
  }, [catalog, createId, layoutAdapter, sessionStore]);

  const applyAutomaticLayout = useCallback((): MoveNodeResult => {
    const currentDocument = documentReference.current;
    const prepared = layoutPreviewReference.current;
    if (currentDocument === null || prepared === null) {
      sessionStore
        .getState()
        .announce(LAYOUT_PREVIEW_UNAVAILABLE_FAILURE.message);
      return LAYOUT_PREVIEW_UNAVAILABLE_FAILURE;
    }

    try {
      const commandResult = applyPreparedArchitectureLayout(
        currentDocument,
        prepared,
      );
      const hashes = getArchitectureDocumentHashes(commandResult.document);
      const nextLoad: LoadedArchitectureDocument = {
        document: commandResult.document,
        hashes,
        status: "ready",
      };
      recordAppliedCommand(
        prepared.command,
        commandResult,
        `Arrange architecture (${String(prepared.changes.length)} positions)`,
      );

      acceptLoadedDocument(nextLoad);
      layoutPreviewReference.current = null;
      sessionStore.getState().clearAllPositionPreviews();
      setLayoutWorkflow(IDLE_LAYOUT_WORKFLOW);
      const message = `Automatic layout applied ${String(
        prepared.changes.length,
      )} position changes. Architecture content did not change.`;
      sessionStore.getState().setCanvasNotice({
        message,
        tone: "info",
      });
      sessionStore.getState().announce(message);
      return {
        document: commandResult.document,
        hashes,
        ok: true,
      };
    } catch (error) {
      const message =
        error instanceof GraphCommandApplicationError &&
        error.issues.some((issue) => issue.code === "precondition_failed")
          ? "The architecture changed after this layout preview. Run automatic layout again."
          : error instanceof ArchitectureLayoutError &&
              error.code === "stale-preview"
            ? "The architecture changed after this layout preview. Run automatic layout again."
            : "Automatic layout could not be applied. No positions changed.";
      layoutPreviewReference.current = null;
      sessionStore.getState().clearAllPositionPreviews();
      setLayoutWorkflow({
        message,
        preview: null,
        status: "error",
      });
      sessionStore.getState().setCanvasNotice({
        message,
        tone: "error",
      });
      sessionStore.getState().announce(message);
      return {
        code: "command-rejected",
        message,
        ok: false,
      };
    }
  }, [acceptLoadedDocument, recordAppliedCommand, sessionStore]);

  useEffect(
    () =>
      sessionStore.subscribe((state, previousState) => {
        if (state.selection === previousState.selection) {
          return;
        }

        const preview = configurationPreviewReference.current;
        if (
          preview !== null &&
          (state.selection?.kind !== preview.target.kind ||
            state.selection.id !== preview.target.id)
        ) {
          clearConfigurationPreview();
        }
      }),
    [clearConfigurationPreview, sessionStore],
  );

  const addService = useCallback(
    (
      serviceId: string,
      position?: EditorPosition,
      options: ServiceCreationOptions = {},
    ): AddServiceResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        sessionStore
          .getState()
          .announce(ADD_DOCUMENT_UNAVAILABLE_FAILURE.message);
        return ADD_DOCUMENT_UNAVAILABLE_FAILURE;
      }

      try {
        const commandResult = dispatchAddServiceCommand({
          ...options,
          catalog,
          createId,
          document: currentDocument,
          ...(position === undefined ? {} : { position }),
          serviceId,
        });
        const hashes = getArchitectureDocumentHashes(commandResult.document);
        const nextLoad: LoadedArchitectureDocument = {
          document: commandResult.document,
          hashes,
          status: "ready",
        };
        const serviceName =
          catalog.services.find((service) => service.serviceType === serviceId)
            ?.displayName ?? "Service";
        recordAppliedCommand(
          commandResult.command,
          commandResult,
          `Add ${serviceName}`,
        );

        acceptLoadedDocument(nextLoad);
        sessionStore
          .getState()
          .setSelection({ id: commandResult.nodeId, kind: "node" });
        sessionStore.getState().recordRecentService(serviceId);
        sessionStore
          .getState()
          .announce(`${serviceName} added through a Graph Command.`);

        return {
          deploymentKey: commandResult.deploymentKey,
          document: commandResult.document,
          hashes,
          nodeId: commandResult.nodeId,
          ok: true,
        };
      } catch {
        sessionStore.getState().announce(ADD_COMMAND_REJECTED_FAILURE.message);
        return ADD_COMMAND_REJECTED_FAILURE;
      }
    },
    [
      acceptLoadedDocument,
      catalog,
      createId,
      recordAppliedCommand,
      sessionStore,
    ],
  );

  const moveNode = useCallback(
    (nodeId: string, position: EditorPosition): MoveNodeResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        sessionStore.getState().clearNodePositionPreview(nodeId);
        sessionStore.getState().announce(DOCUMENT_UNAVAILABLE_FAILURE.message);
        return DOCUMENT_UNAVAILABLE_FAILURE;
      }

      const nodeLabel =
        currentDocument.nodes.find((node) => node.id === nodeId)?.presentation
          .label ?? "Node";
      try {
        const commandResult = dispatchEditorNodeMove({
          catalog,
          createId,
          document: currentDocument,
          nodeId,
          position,
        });
        const hashes = getArchitectureDocumentHashes(commandResult.document);
        const nextLoad: LoadedArchitectureDocument = {
          document: commandResult.document,
          hashes,
          status: "ready",
        };
        if (commandResult.command !== null) {
          recordAppliedCommand(
            commandResult.command,
            commandResult,
            `Move ${nodeLabel}`,
          );
        }

        acceptLoadedDocument(nextLoad);
        sessionStore.getState().clearNodePositionPreview(nodeId);
        sessionStore.getState().setCanvasNotice(null);
        sessionStore
          .getState()
          .announce("Node moved. Architecture content did not change.");

        return {
          document: commandResult.document,
          hashes,
          ok: true,
        };
      } catch (error) {
        sessionStore.getState().clearNodePositionPreview(nodeId);
        const failure = placementCommandFailure(error);
        sessionStore.getState().setCanvasNotice({
          message: failure.message,
          tone: "error",
        });
        sessionStore.getState().announce(failure.message);
        return failure;
      }
    },
    [
      acceptLoadedDocument,
      catalog,
      createId,
      recordAppliedCommand,
      sessionStore,
    ],
  );

  const placeNode = useCallback(
    (
      nodeId: string,
      targetParentNodeId: string | null,
      absolutePosition?: EditorPosition,
    ): MoveNodeResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        sessionStore.getState().clearNodePositionPreview(nodeId);
        sessionStore.getState().announce(DOCUMENT_UNAVAILABLE_FAILURE.message);
        return DOCUMENT_UNAVAILABLE_FAILURE;
      }

      const nodeLabel =
        currentDocument.nodes.find((node) => node.id === nodeId)?.presentation
          .label ?? "Node";
      try {
        const commandResult = dispatchEditorNodePlacement({
          catalog,
          createId,
          document: currentDocument,
          nodeId,
          ...(absolutePosition === undefined
            ? {}
            : {
                position: absolutePosition,
                positionSpace: "absolute" as const,
              }),
          targetParentNodeId,
        });
        const hashes = getArchitectureDocumentHashes(commandResult.document);
        const nextLoad: LoadedArchitectureDocument = {
          document: commandResult.document,
          hashes,
          status: "ready",
        };
        if (commandResult.command !== null) {
          recordAppliedCommand(
            commandResult.command,
            commandResult,
            commandResult.parent === null
              ? `Place ${nodeLabel} at architecture root`
              : `Place ${nodeLabel} in boundary`,
          );
        }

        acceptLoadedDocument(nextLoad);
        sessionStore.getState().clearNodePositionPreview(nodeId);
        sessionStore.getState().setCanvasNotice({
          message:
            commandResult.parent === null
              ? "Node placed at the architecture root."
              : "Node placed inside the selected boundary.",
          tone: "info",
        });
        sessionStore
          .getState()
          .announce(
            commandResult.parent === null
              ? "Node placed at the architecture root."
              : "Node placed inside the selected boundary.",
          );

        return {
          document: commandResult.document,
          hashes,
          ok: true,
        };
      } catch (error) {
        sessionStore.getState().clearNodePositionPreview(nodeId);
        const failure = placementCommandFailure(error);
        sessionStore.getState().setCanvasNotice({
          message: failure.message,
          tone: "error",
        });
        sessionStore.getState().announce(failure.message);
        return failure;
      }
    },
    [
      acceptLoadedDocument,
      catalog,
      createId,
      recordAppliedCommand,
      sessionStore,
    ],
  );

  const listPlacementOptions = useCallback(
    (nodeId: string) => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        return [];
      }
      const node = currentDocument.nodes.find(
        (candidate) => candidate.id === nodeId,
      );
      return node === undefined
        ? []
        : listEditorNodePlacementOptions(currentDocument, catalog, node.id);
    },
    [catalog],
  );

  const inspectConnectionDock = useCallback(
    (nodeId: string, portIds: readonly string[]) =>
      inspectEditorConnectionDock(
        documentReference.current,
        catalog,
        connectionResolver,
        nodeId,
        portIds,
      ),
    [catalog, connectionResolver],
  );

  const beginConnection = useCallback(
    (intent: EditorConnectionStartIntent) => {
      sessionStore.getState().setActiveConnectionDock(null);
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        const message =
          "A connection cannot be started because no valid architecture is loaded.";
        sessionStore.getState().announce(message);
        return { message, ok: false as const };
      }

      clearConfigurationPreview();
      if (!hasExactEditorCatalogBinding(currentDocument, catalog)) {
        const finding = editorConnectionFinding(
          "cloudmarkup.connection.catalog-mismatch",
          "Open this architecture with the provider catalog version it was created with.",
          "Connection discovery fails closed unless provider, catalog ID, version, and digest match exactly.",
          "$.document.catalog",
        );
        connectionPreviewReference.current = null;
        setConnectionWorkflow({
          ...CLOSED_CONNECTION_WORKFLOW,
          education: null,
          findings: [finding],
          open: true,
        });
        sessionStore.getState().announce(finding.guidedMessage);
        return { message: finding.guidedMessage, ok: false as const };
      }

      const education = connectionEducation(currentDocument, catalog, intent);
      const prepared = prepareConnectionCompatibilityRequest(
        currentDocument,
        intent,
      );
      if (connectionResolver === undefined || prepared === undefined) {
        const finding = editorConnectionFinding(
          "cloudmarkup.connection.workflow-unavailable",
          prepared === undefined
            ? "Only a generated catalog connection can be edited safely."
            : "The version-bound connection engine is not available.",
          prepared === undefined
            ? "The selected edge lacks editable connection-rule provenance."
            : "No ProviderConnectionResolver v1 is bound to this editor session.",
        );
        connectionPreviewReference.current = null;
        setConnectionWorkflow({
          ...CLOSED_CONNECTION_WORKFLOW,
          education,
          findings: [finding],
          open: true,
        });
        sessionStore.getState().announce(finding.guidedMessage);
        return { message: finding.guidedMessage, ok: false as const };
      }

      try {
        const result = connectionResolver.listCompatible(prepared.request);
        const projectedCandidates = projectConnectionCandidates(
          currentDocument,
          catalog,
          result.candidates,
          prepared.editingEdgeId,
        );
        const candidates =
          prepared.requiredRuleId === null
            ? projectedCandidates
            : projectedCandidates.filter(
                (candidate) =>
                  candidate.relationship.descriptorId ===
                  prepared.requiredRuleId,
              );
        const availableCandidates = candidates.filter(
          (candidate) =>
            !candidate.findings.some((finding) => finding.severity === "error"),
        );
        const selectedCandidate =
          prepared.requiredRuleId !== null
            ? availableCandidates.length === 1
              ? availableCandidates[0]
              : undefined
            : prepared.preferredRuleId === null
              ? availableCandidates.length === 1
                ? availableCandidates[0]
                : undefined
              : availableCandidates.find(
                  (candidate) =>
                    candidate.relationship.descriptorId ===
                    prepared.preferredRuleId,
                );
        const requestFindings = projectConnectionFindings(result.findings);
        const findings =
          requestFindings.length > 0
            ? requestFindings
            : availableCandidates.length === 0 && candidates.length > 0
              ? candidates.flatMap((candidate) => candidate.findings)
              : candidates.length === 0
                ? [
                    editorConnectionFinding(
                      "cloudmarkup.connection.no-compatible-candidate",
                      "These services do not have a supported connection. Try a different service or review their connection options.",
                      "The bound resolver returned no catalog rule for the exact selected endpoints.",
                    ),
                  ]
                : [];
        connectionPreviewReference.current = null;
        setConnectionWorkflow({
          candidates,
          configuration:
            selectedCandidate === undefined
              ? {}
              : initialConnectionConfiguration(
                  selectedCandidate,
                  currentDocument,
                  prepared.editingEdgeId,
                ),
          editingEdgeId: prepared.editingEdgeId,
          education: selectedCandidate?.relationship.education ?? education,
          findings,
          open: true,
          preview: null,
          selectedCandidateKey: selectedCandidate?.key ?? null,
        });
        const message =
          findings[0]?.guidedMessage ??
          (selectedCandidate === undefined
            ? availableCandidates.length > 1
              ? "What should these services do together? Choose a connection to continue."
              : "Review the available connection before continuing."
            : prepared.editingEdgeId === null
              ? "Connection questions are ready. Nothing has changed yet."
              : "Connection settings are ready to edit. Nothing has changed yet.");
        sessionStore.getState().announce(message);
        return { ok: true as const };
      } catch {
        const message =
          "The connection engine could not inspect this architecture safely.";
        setConnectionWorkflow({
          ...CLOSED_CONNECTION_WORKFLOW,
          education,
          findings: [
            editorConnectionFinding(
              "cloudmarkup.connection.discovery-failed",
              message,
              "Provider connection compatibility discovery failed closed.",
            ),
          ],
          open: true,
        });
        sessionStore.getState().announce(message);
        return { message, ok: false as const };
      }
    },
    [catalog, clearConfigurationPreview, connectionResolver, sessionStore],
  );

  const selectConnectionCandidate = useCallback((candidateKey: string) => {
    const currentDocument = documentReference.current;
    if (currentDocument === null) {
      return;
    }
    connectionPreviewReference.current = null;
    setConnectionWorkflow((current) => {
      const candidate = current.candidates.find(
        (item) => item.key === candidateKey,
      );
      if (
        candidate === undefined ||
        candidate.findings.some((finding) => finding.severity === "error")
      ) {
        return current;
      }
      return {
        ...current,
        configuration: initialConnectionConfiguration(
          candidate,
          currentDocument,
          current.editingEdgeId,
        ),
        education: candidate.relationship.education,
        findings: candidate.findings,
        preview: null,
        selectedCandidateKey: candidate.key,
      };
    });
  }, []);

  const updateConnectionConfiguration = useCallback(
    (property: string, value: Readonly<ConfigurationValue> | undefined) => {
      connectionPreviewReference.current = null;
      setConnectionWorkflow((current) => {
        if (!current.open || current.selectedCandidateKey === null) {
          return current;
        }
        const configuration =
          value === undefined
            ? Object.fromEntries(
                Object.entries(current.configuration).filter(
                  ([key]) => key !== property,
                ),
              )
            : { ...current.configuration, [property]: value };
        return {
          ...current,
          configuration,
          findings: [],
          preview: null,
        };
      });
    },
    [],
  );

  const discardConnectionPreview = useCallback(() => {
    connectionPreviewReference.current = null;
    setConnectionWorkflow((current) => ({
      ...current,
      findings: [],
      preview: null,
    }));
    sessionStore
      .getState()
      .announce("Connection preview discarded. Draft answers are unchanged.");
  }, [sessionStore]);

  const previewConnection = useCallback(() => {
    const currentDocument = documentReference.current;
    const candidate = connectionWorkflow.candidates.find(
      (item) => item.key === connectionWorkflow.selectedCandidateKey,
    );
    if (
      currentDocument === null ||
      connectionResolver === undefined ||
      candidate === undefined
    ) {
      const message =
        "Choose an available relationship before preparing a connection preview.";
      sessionStore.getState().announce(message);
      return { message, ok: false as const };
    }

    const request = {
      configuration: connectionWorkflow.configuration,
      document: currentDocument,
      operationId: createId(),
      ruleId: candidate.relationship.descriptorId,
      source: {
        nodeId: candidate.source.nodeId,
        portId: candidate.source.portId,
      },
      target: {
        nodeId: candidate.target.nodeId,
        portId: candidate.target.portId,
      },
    };
    const result =
      connectionWorkflow.editingEdgeId === null
        ? connectionResolver.resolve(request)
        : connectionResolver.edit({
            ...request,
            connectionEdgeId: connectionWorkflow.editingEdgeId,
          });
    if (
      !result.success ||
      result.findings.some((finding) => finding.severity === "error")
    ) {
      connectionPreviewReference.current = null;
      const findings = projectConnectionFindings(result.findings);
      setConnectionWorkflow((current) => ({
        ...current,
        findings,
        preview: null,
      }));
      const message =
        findings[0]?.guidedMessage ??
        "The connection could not be previewed safely.";
      sessionStore.getState().announce(message);
      return { message, ok: false as const };
    }

    let preview: ReturnType<typeof projectConnectionPreview>;
    let confirmableResult = result;
    try {
      if (
        result.rule.category === "receives-events-from" &&
        result.rule.target.portId ===
          "aws.lambda.function.asynchronous-invocation" &&
        connectionWorkflow.editingEdgeId === null
      ) {
        const eventEdges = result.generatedResources
          .filter((resource) => resource.kind === "edge")
          .map((resource) =>
            result.preview.document.edges.find(
              (edge) => edge.id === resource.edgeId,
            ),
          )
          .filter(
            (edge) =>
              edge?.semantic.relationshipType ===
                result.rule.relationshipType &&
              edge.semantic.source.nodeId === candidate.source.nodeId &&
              edge.semantic.target.nodeId === candidate.target.nodeId,
          );
        const eventEdge = eventEdges.length === 1 ? eventEdges[0] : undefined;
        if (eventEdge === undefined)
          throw new TypeError("The reviewed event edge is missing.");
        const bind = prepareEventWorkloadBinding(
          result.preview.document,
          [eventEdge],
          createId,
        );
        if (bind === null)
          throw new TypeError("The event is already bound to its workload.");
        const batch = parseGraphCommandV1({
          ...result.batch,
          commandId: createId(),
          inverseCommandId: createId(),
          commands: [...result.batch.commands, bind],
        });
        if (batch.kind !== "batch")
          throw new TypeError("Expected an atomic connection batch.");
        const replay = applyGraphCommand(currentDocument, batch);
        confirmableResult = {
          ...result,
          batch,
          preview: { document: replay.document, changes: replay.changes },
        };
      }
      preview = projectConnectionPreview(
        catalog,
        candidate,
        confirmableResult,
        currentDocument,
      );
    } catch (error) {
      connectionPreviewReference.current = null;
      const finding = editorConnectionFinding(
        "cloudmarkup.connection.invalid-preview",
        error instanceof Error &&
          error.message.startsWith("Choose one workload")
          ? error.message
          : "The connection could not prepare a complete, version-bound preview.",
        "The resolver result did not match the selected catalog relationship or generated-resource set.",
        "$.connection.preview",
      );
      setConnectionWorkflow((current) => ({
        ...current,
        findings: [finding],
        preview: null,
      }));
      sessionStore.getState().announce(finding.guidedMessage);
      return { message: finding.guidedMessage, ok: false as const };
    }

    connectionPreviewReference.current = confirmableResult;
    setConnectionWorkflow((current) => ({
      ...current,
      configuration: { ...confirmableResult.configuration },
      findings: projectConnectionFindings(confirmableResult.findings),
      preview,
    }));
    sessionStore
      .getState()
      .announce(
        "Atomic connection preview ready. The architecture has not changed.",
      );
    return { ok: true as const };
  }, [catalog, connectionResolver, connectionWorkflow, createId, sessionStore]);

  const applyConnectionPreview = useCallback(() => {
    const currentDocument = documentReference.current;
    const prepared = connectionPreviewReference.current;
    if (currentDocument === null || prepared === null) {
      const message =
        "Prepare a valid connection preview before confirming changes.";
      sessionStore.getState().announce(message);
      return { message, ok: false as const };
    }
    if (prepared.findings.some((finding) => finding.severity === "error")) {
      connectionPreviewReference.current = null;
      const message =
        "A connection preview containing error findings cannot be confirmed.";
      setConnectionWorkflow((current) => ({
        ...current,
        findings: projectConnectionFindings(prepared.findings),
        preview: null,
      }));
      sessionStore.getState().announce(message);
      return { message, ok: false as const };
    }

    try {
      const commandResult = applyGraphCommand(currentDocument, prepared.batch);
      const hashes = getArchitectureDocumentHashes(commandResult.document);
      const nextLoad: LoadedArchitectureDocument = {
        document: commandResult.document,
        hashes,
        status: "ready",
      };
      const directEdge = prepared.generatedResources.find(
        (resource) => resource.kind === "edge",
      );
      recordAppliedCommand(
        prepared.batch,
        commandResult,
        connectionWorkflow.editingEdgeId === null
          ? "Connect architecture resources"
          : "Update connection",
      );

      acceptLoadedDocument(nextLoad);
      clearConnectionWorkflow();
      if (directEdge?.kind === "edge") {
        sessionStore
          .getState()
          .setSelection({ id: directEdge.edgeId, kind: "edge" });
      }
      sessionStore
        .getState()
        .announce(
          "Connection applied through the confirmed atomic Graph Command batch.",
        );
      return { ok: true as const };
    } catch {
      connectionPreviewReference.current = null;
      const message =
        "The architecture changed after this preview. Review the connection again; nothing was applied.";
      setConnectionWorkflow((current) => ({
        ...current,
        findings: [
          editorConnectionFinding(
            "cloudmarkup.connection.stale-preview",
            message,
            "The prepared atomic batch failed its Graph Command preconditions.",
          ),
        ],
        preview: null,
      }));
      sessionStore.getState().announce(message);
      return { message, ok: false as const };
    }
  }, [
    acceptLoadedDocument,
    clearConnectionWorkflow,
    connectionWorkflow.editingEdgeId,
    recordAppliedCommand,
    sessionStore,
  ]);

  const previewServiceRemoval = useCallback(
    (nodeId: string): ServiceRemovalPreviewResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        return { ok: false, message: "No valid design is loaded." };
      }
      try {
        return {
          ok: true,
          preview: prepareServiceRemoval({
            ...(connectionResolver === undefined ? {} : { connectionResolver }),
            createId,
            document: currentDocument,
            nodeId,
          }),
        };
      } catch (error) {
        const message =
          error instanceof ServiceRemovalError
            ? error.message
            : "This service cannot be safely removed from the current design.";
        sessionStore.getState().announce(message);
        return { ok: false, message };
      }
    },
    [connectionResolver, createId, sessionStore],
  );

  const removeService = useCallback(
    (preview: PreparedServiceRemoval): ConnectionWorkflowActionResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        return { ok: false, message: "No valid design is loaded." };
      }
      const currentHashes = getArchitectureDocumentHashes(currentDocument);
      if (
        currentHashes.contentHash !== preview.beforeHashes.contentHash ||
        currentHashes.visualHash !== preview.beforeHashes.visualHash
      ) {
        const message =
          "The design changed after this preview. Review the service removal again.";
        sessionStore.getState().announce(message);
        return { ok: false, message };
      }
      try {
        const application = applyGraphCommand(currentDocument, preview.command);
        const hashes = getArchitectureDocumentHashes(application.document);
        if (
          hashes.contentHash !== preview.previewHashes.contentHash ||
          hashes.visualHash !== preview.previewHashes.visualHash
        ) {
          throw new TypeError(
            "Service removal replay did not match its preview.",
          );
        }
        recordAppliedCommand(preview.command, application, preview.label);
        acceptLoadedDocument({
          document: application.document,
          hashes,
          status: "ready",
        });
        clearStaleDocumentPreviews();
        const removed = new Set(
          application.changes.flatMap((change) =>
            change.kind === "node-removed"
              ? [change.nodeId]
              : change.kind === "edge-removed"
                ? [change.edgeId]
                : change.kind === "generated-resource-released" &&
                    change.disposition === "removed"
                  ? [
                      change.resource.kind === "node"
                        ? change.resource.nodeId
                        : change.resource.edgeId,
                    ]
                  : [],
          ),
        );
        const transient = sessionStore.getState();
        if (transient.selection !== null && removed.has(transient.selection.id))
          transient.setSelection(null);
        if (
          transient.hoveredElement !== null &&
          removed.has(transient.hoveredElement.id)
        )
          transient.setHoveredElement(null);
        transient.setActiveConnectionDock(null);
        transient.announce(
          preview.label +
            " applied through one Graph Command. Undo is available.",
        );
        return { ok: true };
      } catch {
        const message =
          "The service removal failed closed. Review the latest design and try again.";
        sessionStore.getState().announce(message);
        return { ok: false, message };
      }
    },
    [
      acceptLoadedDocument,
      clearStaleDocumentPreviews,
      recordAppliedCommand,
      sessionStore,
    ],
  );

  const disconnectEdge = useCallback(
    (edgeId: string): ConnectionWorkflowActionResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        const message =
          "The connection cannot be disconnected because no valid architecture is loaded.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }

      const edge = currentDocument.edges.find(
        (candidate) => candidate.id === edgeId,
      );
      if (edge?.semantic.lifecycle.ownership === "generated") {
        try {
          if (
            connectionResolver === undefined ||
            !hasExactEditorCatalogBinding(currentDocument, catalog)
          )
            throw new Error(
              "Open this design with its exact connection catalog before removing generated resources.",
            );
          const target = {
            architectureId: currentDocument.architectureId,
            documentId: currentDocument.documentId,
            revisionId: currentDocument.revision.revisionId,
          };
          const actions: GraphCommandV1[] = [];
          let working = currentDocument;
          const workloads = working.workloadBehavior.workloads.map(
            (workload) => ({
              ...workload,
              triggers: workload.triggers.filter(
                (binding) => binding.edgeId !== edgeId,
              ),
              downstreamActions: workload.downstreamActions.filter(
                (binding) => binding.edgeId !== edgeId,
              ),
            }),
          );
          if (
            workloads.some((workload, index) => {
              const previous = working.workloadBehavior.workloads[index];
              return (
                workload.triggers.length !== previous?.triggers.length ||
                workload.downstreamActions.length !==
                  previous.downstreamActions.length
              );
            })
          ) {
            const unbind = parseGraphCommandV1({
              schemaVersion: 1,
              commandId: createId(),
              inverseCommandId: createId(),
              origin: "user",
              target,
              kind: "replace-workload-and-application-contracts",
              expectedWorkloadBehavior: working.workloadBehavior,
              expectedApplicationContracts: working.applicationContracts,
              workloadBehavior: { ...working.workloadBehavior, workloads },
              applicationContracts: working.applicationContracts,
            });
            working = applyGraphCommand(working, unbind).document;
            actions.push(unbind);
          }
          const seed = createId()
            .replace(/[^a-z0-9]/gu, "_")
            .slice(-18);
          const cleanup = connectionResolver.cleanup({
            connectionEdgeId: edgeId,
            document: working,
            operationId: "disconnect_" + seed,
          });
          if (!cleanup.success)
            throw new Error(
              cleanup.findings[0]?.guidedMessage ??
                "This generated connection cannot be removed safely.",
            );
          actions.push(...cleanup.batch.commands);
          const command = parseGraphCommandV1({
            schemaVersion: 1,
            commandId: createId(),
            inverseCommandId: createId(),
            origin: "user",
            target,
            kind: "batch",
            commands: actions,
          });
          const commandResult = applyGraphCommand(currentDocument, command);
          if (commandResult.inversion.kind !== "available")
            throw new Error(
              "This connection cannot be restored by Undo. Review its dependencies first.",
            );
          const hashes = getArchitectureDocumentHashes(commandResult.document);
          recordAppliedCommand(command, commandResult, "Remove connection");
          acceptLoadedDocument({
            document: commandResult.document,
            hashes,
            status: "ready",
          });
          clearStaleDocumentPreviews();
          clearConnectionWorkflow();
          const transient = sessionStore.getState();
          if (transient.selection?.id === edgeId) transient.setSelection(null);
          if (transient.hoveredElement?.id === edgeId)
            transient.setHoveredElement(null);
          transient.setActiveConnectionDock(null);
          transient.announce(
            "Removed the connection and its unused generated resources. Undo is available.",
          );
          return { ok: true };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "This generated connection could not be removed safely.";
          sessionStore.getState().announce(message);
          return { message, ok: false };
        }
      }

      try {
        const commandResult = dispatchDisconnectEdgeCommand({
          createId,
          document: currentDocument,
          edgeId,
        });
        const hashes = getArchitectureDocumentHashes(commandResult.document);
        recordAppliedCommand(
          commandResult.command,
          commandResult,
          "Disconnect architecture resources",
        );
        acceptLoadedDocument({
          document: commandResult.document,
          hashes,
          status: "ready",
        });
        clearStaleDocumentPreviews();

        const transient = sessionStore.getState();
        if (
          transient.selection?.kind === "edge" &&
          transient.selection.id === edgeId
        ) {
          transient.setSelection(null);
        }
        if (
          transient.hoveredElement?.kind === "edge" &&
          transient.hoveredElement.id === edgeId
        ) {
          transient.setHoveredElement(null);
        }
        transient.setActiveConnectionDock(null);
        transient.announce(
          "Disconnected the selected user-owned connection through a Graph Command.",
        );
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof DisconnectEdgeCommandError
            ? error.message
            : error instanceof GraphCommandApplicationError &&
                error.issues.some(
                  (issue) => issue.code === "precondition_failed",
                )
              ? "The connection changed before it could be disconnected. Review it again."
              : "The connection could not be disconnected. The architecture document was not changed.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }
    },
    [
      acceptLoadedDocument,
      catalog,
      clearConnectionWorkflow,
      clearStaleDocumentPreviews,
      connectionResolver,
      createId,
      recordAppliedCommand,
      sessionStore,
    ],
  );

  const cancelConnection = useCallback(() => {
    if (!connectionWorkflow.open) {
      return;
    }
    clearConnectionWorkflow();
    sessionStore
      .getState()
      .announce("Connection canceled. The architecture was not changed.");
  }, [clearConnectionWorkflow, connectionWorkflow.open, sessionStore]);

  const previewConfiguration = useCallback(
    (
      target: ConfigurationCommandTarget,
      edits: Readonly<Record<string, ConfigurationEdit>>,
    ): ConfigurationPreviewResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        clearConfigurationPreview();
        sessionStore
          .getState()
          .announce(CONFIGURATION_DOCUMENT_UNAVAILABLE_FAILURE.message);
        return CONFIGURATION_DOCUMENT_UNAVAILABLE_FAILURE;
      }

      try {
        const preview = prepareConfigurationCommand({
          catalog,
          createId,
          document: currentDocument,
          edits,
          target,
        });
        configurationPreviewReference.current = preview;
        setConfigurationPreview(preview);
        sessionStore
          .getState()
          .announce(
            "Configuration command preview ready. The architecture document has not changed.",
          );
        return { ok: true, preview };
      } catch (error) {
        clearConfigurationPreview();
        const issues =
          error instanceof ConfigurationCommandPreparationError
            ? error.issues
            : [];
        const message =
          error instanceof ConfigurationCommandPreparationError
            ? error.message
            : error instanceof GraphCommandApplicationError &&
                error.issues.some(
                  (issue) =>
                    issue.code === "generated_resource_requires_adoption",
                )
              ? "Generated resources must be adopted before their configuration can be customized."
              : "Configuration could not be previewed. The architecture document was not changed.";
        const failure: ConfigurationPreviewFailure = {
          code: "command-rejected",
          issues,
          message,
          ok: false,
        };
        sessionStore.getState().announce(message);
        return failure;
      }
    },
    [catalog, clearConfigurationPreview, createId, sessionStore],
  );

  const discardConfigurationPreview = useCallback(() => {
    if (configurationPreviewReference.current === null) {
      return;
    }

    clearConfigurationPreview();
    sessionStore
      .getState()
      .announce("Configuration command preview discarded.");
  }, [clearConfigurationPreview, sessionStore]);

  const applyConfigurationPreview =
    useCallback((): ConfigurationApplyResult => {
      const currentDocument = documentReference.current;
      if (currentDocument === null) {
        clearConfigurationPreview();
        sessionStore
          .getState()
          .announce(CONFIGURATION_APPLY_DOCUMENT_UNAVAILABLE_FAILURE.message);
        return CONFIGURATION_APPLY_DOCUMENT_UNAVAILABLE_FAILURE;
      }

      const prepared = configurationPreviewReference.current;
      if (prepared === null) {
        sessionStore
          .getState()
          .announce(CONFIGURATION_PREVIEW_UNAVAILABLE_FAILURE.message);
        return CONFIGURATION_PREVIEW_UNAVAILABLE_FAILURE;
      }

      try {
        const commandResult = applyPreparedConfigurationCommand(
          currentDocument,
          prepared,
        );
        const hashes = getArchitectureDocumentHashes(commandResult.document);
        const nextLoad: LoadedArchitectureDocument = {
          document: commandResult.document,
          hashes,
          status: "ready",
        };
        const configuration = prepared.command.configuration;
        const bufferKey = createConfigurationFormBufferKey(
          prepared.target,
          configuration.schemaId,
          configuration.schemaVersion,
        );
        recordAppliedCommand(
          prepared.command,
          commandResult,
          `Update ${prepared.target.kind} configuration`,
        );

        acceptLoadedDocument(nextLoad);
        clearConfigurationPreview();
        sessionStore.getState().clearConfigurationFormBuffer(bufferKey);
        sessionStore
          .getState()
          .announce(
            "Configuration applied through the prepared Graph Command.",
          );

        return {
          document: commandResult.document,
          hashes,
          ok: true,
        };
      } catch (error) {
        const message =
          error instanceof GraphCommandApplicationError &&
          error.issues.some((issue) => issue.code === "precondition_failed")
            ? "Configuration changed after this preview. Review the latest values and preview again."
            : "Configuration could not be applied. The architecture document was not changed.";
        clearConfigurationPreview();
        sessionStore.getState().announce(message);
        return {
          code: "command-rejected",
          message,
          ok: false,
        };
      }
    }, [
      acceptLoadedDocument,
      clearConfigurationPreview,
      recordAppliedCommand,
      sessionStore,
    ]);

  const applyValidationFix = useCallback(
    (
      findingId: ValidationFindingId | string,
      target: EditorValidationTarget,
    ): EditorValidationFixResult => {
      const currentDocument = documentReference.current;
      if (
        currentDocument === null ||
        validation.status !== "current" ||
        !isEditorValidationSnapshotComplete(validation.snapshot)
      ) {
        const message =
          "A current, complete validation report is required before applying this fix.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }

      const currentHashes = getArchitectureDocumentHashes(currentDocument);
      const snapshot = validation.snapshot;
      if (
        currentHashes.contentHash !== snapshot.hashes.contentHash ||
        currentHashes.visualHash !== snapshot.hashes.visualHash
      ) {
        const message =
          "The validation fix is stale. Run validation again before reviewing it.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }

      const finding = findValidationFinding(snapshot, findingId, target);
      if (finding?.autoFix === undefined) {
        const message =
          "This finding has no reviewed safe auto-fix. Follow its manual remediation guidance.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }
      if (finding.autoFix.conflictsWithFindingIds.length > 0) {
        const message =
          "This auto-fix conflicts with another finding and cannot be applied automatically.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }

      try {
        const commandResult = applyGraphCommand(
          currentDocument,
          finding.autoFix.command,
        );
        const nextHashes = getArchitectureDocumentHashes(
          commandResult.document,
        );
        if (
          nextHashes.contentHash !== finding.autoFix.resultingDocumentHash ||
          nextHashes.visualHash !== finding.autoFix.resultingVisualHash
        ) {
          throw new TypeError(
            "The validation fix replay did not match its reviewed preview.",
          );
        }

        acceptLoadedDocument({
          document: commandResult.document,
          hashes: nextHashes,
          status: "ready",
        });
        recordAppliedCommand(
          finding.autoFix.command,
          commandResult,
          `Fix ${finding.title}`,
        );
        clearStaleDocumentPreviews();
        sessionStore
          .getState()
          .announce(
            "Validation fix applied as one confirmed atomic Graph Command batch.",
          );
        return {
          document: commandResult.document,
          hashes: nextHashes,
          ok: true,
        };
      } catch (error) {
        const message =
          error instanceof GraphCommandApplicationError &&
          error.issues.some((issue) => issue.code === "precondition_failed")
            ? "The architecture changed after this fix was reviewed. Run validation again."
            : "The validation fix failed closed. The architecture document was not changed.";
        sessionStore.getState().announce(message);
        return { message, ok: false };
      }
    },
    [
      acceptLoadedDocument,
      clearStaleDocumentPreviews,
      recordAppliedCommand,
      sessionStore,
      validation,
    ],
  );

  const contextValue = useMemo<EditorDocumentSession>(() => {
    if (loadedDocument.status === "invalid") {
      return {
        addService,
        applyAutomaticLayout,
        applyConnectionPreview,
        applyConfigurationPreview,
        applyOwnedPolicyCommand,
        applyResourceRepair,
        applyReviewedCommand: applyResourceRepair,
        applyWorkloadOperationCommand,
        applyValidationFix,
        automaticLayoutAvailable: layoutAdapter !== undefined,
        beginConnection,
        cancelAutomaticLayout,
        cancelConnection,
        catalog,
        connectionWorkflow,
        configurationPreview,
        createId,
        discardConnectionPreview,
        discardConfigurationPreview,
        document: null,
        hashes: null,
        history: historyStatus,
        iconRegistry,
        inspectConnectionDock,
        layoutWorkflow,
        ownedPolicyDescriptors: ownedPolicyDescriptors ?? null,
        disconnectEdge,
        previewServiceRemoval,
        removeService,
        listPlacementOptions,
        moveNode,
        placeNode,
        previewConnection,
        previewConfiguration,
        problem: loadedDocument.problem,
        redo,
        requestValidation,
        selectConnectionCandidate,
        startAutomaticLayout,
        status: "invalid",
        undo,
        updateConnectionConfiguration,
        validation,
      };
    }

    return {
      addService,
      applyAutomaticLayout,
      applyConnectionPreview,
      applyConfigurationPreview,
      applyOwnedPolicyCommand,
      applyResourceRepair,
      applyReviewedCommand: applyResourceRepair,
      applyWorkloadOperationCommand,
      applyValidationFix,
      automaticLayoutAvailable: layoutAdapter !== undefined,
      beginConnection,
      cancelAutomaticLayout,
      cancelConnection,
      catalog,
      connectionWorkflow,
      configurationPreview,
      createId,
      discardConnectionPreview,
      discardConfigurationPreview,
      document: loadedDocument.document,
      hashes: loadedDocument.hashes,
      history: historyStatus,
      iconRegistry,
      inspectConnectionDock,
      layoutWorkflow,
      ownedPolicyDescriptors: ownedPolicyDescriptors ?? null,
      disconnectEdge,
      previewServiceRemoval,
      removeService,
      listPlacementOptions,
      moveNode,
      placeNode,
      previewConnection,
      previewConfiguration,
      problem: null,
      redo,
      requestValidation,
      selectConnectionCandidate,
      startAutomaticLayout,
      status: "ready",
      undo,
      updateConnectionConfiguration,
      validation,
    };
  }, [
    addService,
    applyAutomaticLayout,
    applyConnectionPreview,
    applyConfigurationPreview,
    applyOwnedPolicyCommand,
    applyResourceRepair,
    applyWorkloadOperationCommand,
    applyValidationFix,
    beginConnection,
    cancelAutomaticLayout,
    cancelConnection,
    catalog,
    connectionWorkflow,
    configurationPreview,
    createId,
    discardConnectionPreview,
    discardConfigurationPreview,
    historyStatus,
    iconRegistry,
    inspectConnectionDock,
    layoutAdapter,
    layoutWorkflow,
    listPlacementOptions,
    ownedPolicyDescriptors,
    disconnectEdge,
    previewServiceRemoval,
    removeService,
    loadedDocument,
    moveNode,
    placeNode,
    previewConnection,
    previewConfiguration,
    redo,
    requestValidation,
    selectConnectionCandidate,
    startAutomaticLayout,
    undo,
    updateConnectionConfiguration,
    validation,
  ]);

  const indexedDocument =
    loadedDocument.status === "ready" ? loadedDocument.document : null;
  const documentIndex = useMemo(
    () =>
      indexedDocument === null
        ? null
        : createArchitectureDocumentIndex(indexedDocument),
    [indexedDocument],
  );
  return (
    <EditorDocumentIndexContext.Provider value={documentIndex}>
      <EditorDocumentSessionContext.Provider value={contextValue}>
        {children}
      </EditorDocumentSessionContext.Provider>
    </EditorDocumentIndexContext.Provider>
  );
}

function useEditorSessionStoreForProvider(): EditorSessionStore {
  const store = useContext(EditorSessionStoreContext);

  if (store === null) {
    throw new Error("Editor session store context was not initialized.");
  }

  return store;
}

export function EditorSessionProvider({
  catalog,
  children,
  connectionResolver,
  createId,
  document,
  iconRegistry,
  layoutAdapter,
  ownedPolicyDescriptors,
  recoveryAutosaveDebounceMilliseconds,
  recoveryCheckingFallback,
  recoveryDownloadDiagnostic,
  recoveryNow,
  recoveryStore,
  recoveryWriterId,
  scopeKey,
  onDocumentChange,
  preserveSessionOnRecoveryRebind,
  validationDebounceMilliseconds,
  validationEvaluator,
}: EditorSessionProviderProps) {
  const initialLoad = useMemo(
    () => loadArchitectureDocument(document),
    [document],
  );
  const effectiveScopeKey = scopeKey ?? documentScopeKey(initialLoad);
  const [fallbackRecoveryIdentity] = useState(createEditorRuntimeIdentity);
  const seedDocument =
    initialLoad.status === "ready" ? initialLoad.document : null;

  return (
    <EditorRecoveryCoordinator
      key={
        preserveSessionOnRecoveryRebind === true
          ? undefined
          : effectiveScopeKey + ":" + documentScopeKey(initialLoad)
      }
      scopeKey={effectiveScopeKey}
      seedDocument={seedDocument}
      writerId={recoveryWriterId ?? fallbackRecoveryIdentity.writerId}
      {...(recoveryAutosaveDebounceMilliseconds === undefined
        ? {}
        : {
            autosaveDebounceMilliseconds: recoveryAutosaveDebounceMilliseconds,
          })}
      {...(recoveryCheckingFallback === undefined
        ? {}
        : { checkingFallback: recoveryCheckingFallback })}
      {...(recoveryDownloadDiagnostic === undefined
        ? {}
        : { downloadDiagnostic: recoveryDownloadDiagnostic })}
      {...(recoveryNow === undefined ? {} : { now: recoveryNow })}
      {...(recoveryStore === undefined ? {} : { store: recoveryStore })}
    >
      {(recoverySession) => {
        const resolvedLoad =
          recoverySession.document === null
            ? initialLoad
            : loadArchitectureDocument(recoverySession.document);
        return (
          <EditorRecoveryDocumentProviders
            catalog={catalog}
            {...(connectionResolver === undefined
              ? {}
              : { connectionResolver })}
            createId={createId}
            iconRegistry={iconRegistry}
            initialLoad={resolvedLoad}
            mountKey={recoverySession.mountKey}
            {...(onDocumentChange === undefined ? {} : { onDocumentChange })}
            {...(ownedPolicyDescriptors === undefined
              ? {}
              : { ownedPolicyDescriptors })}
            {...(layoutAdapter === undefined ? {} : { layoutAdapter })}
            {...(validationDebounceMilliseconds === undefined
              ? {}
              : { validationDebounceMilliseconds })}
            {...(validationEvaluator === undefined
              ? {}
              : { validationEvaluator })}
          >
            {children}
          </EditorRecoveryDocumentProviders>
        );
      }}
    </EditorRecoveryCoordinator>
  );
}
