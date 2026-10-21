import {
  Button,
  IconButton,
  ModalDrawer,
  Popover,
  Tooltip,
} from "@cloudmarkup/ui";
import {
  CircleHelp,
  Command,
  LayoutDashboard,
  ListTree,
  LocateFixed,
  Maximize2,
  Redo2,
  Undo2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { useOptionalCloudMarkupQueryRuntime } from "../../../api/index.js";
import { useUsabilityEvents } from "../../../instrumentation/usability-events.js";
import {
  useExperiencePreference,
  useModePreference,
} from "../../../preferences/index.js";
import { useWorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import { restartNotesApiWalkthrough } from "../../onboarding/restart-walkthrough.js";
import {
  getEditorHistoryShortcut,
  isEditorTextEntryTarget,
} from "../model/editor-history-shortcuts.js";
import { createServiceCatalogViewModel } from "../model/index.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../session/index.js";
import { snapshotFromValidationState } from "../validation/editor-validation.js";
import { navigateToValidationFinding } from "../validation/validation-navigation.js";
import type { ArchitectureCanvasViewRequest } from "../canvas/ArchitectureCanvas.js";
import "./productivity.css";

type CommandGroup = "Create" | "Navigate" | "View" | "Learn" | "History";

interface EditorCommand {
  readonly description: string;
  readonly disabledReason?: string | undefined;
  readonly group: CommandGroup;
  readonly id: string;
  readonly keywords: string;
  readonly label: string;
  run(): void;
}

interface EditorProductivityToolsProps {
  readonly experienceFixture?: "notes-api" | undefined;
  readonly onWalkthroughRestart: () => void;
  readonly onViewRequest: (
    target: ArchitectureCanvasViewRequest["target"],
  ) => void;
  readonly posture: "desktop" | "phone" | "tablet";
}

function commandMatches(command: EditorCommand, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const searchable =
    `${command.label} ${command.description} ${command.group} ${command.keywords}`.toLowerCase();
  return tokens.every((token) => searchable.includes(token));
}

function isProductivityShortcut(
  event: KeyboardEvent,
): "commands" | "help" | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    isEditorTextEntryTarget(event.target)
  ) {
    return null;
  }
  const primary = event.ctrlKey || event.metaKey;
  if (!primary || (event.ctrlKey && event.metaKey)) {
    return null;
  }
  if (event.key.toLowerCase() === "k") {
    return "commands";
  }
  return event.key === "/" ? "help" : null;
}

function subscribeCanvasMenuSlot(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}
function canvasMenuSlot() {
  return document.getElementById("architecture-canvas-menu-slot");
}

export function EditorProductivityTools({
  experienceFixture,
  onWalkthroughRestart,
  onViewRequest,
  posture,
}: EditorProductivityToolsProps) {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const selection = useEditorSessionState((state) => state.selection);
  const validationFocus = useEditorSessionState(
    (state) => state.validationFocus,
  );
  const shell = useWorkspaceShellController();
  const { mode, setMode } = useModePreference();
  const experience = useExperiencePreference();
  const hosted = useOptionalCloudMarkupQueryRuntime() !== null;
  const usabilityEvents = useUsabilityEvents();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const canvasMenuTarget = useSyncExternalStore(
    subscribeCanvasMenuSlot,
    canvasMenuSlot,
    () => null,
  );
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (getEditorHistoryShortcut(event) !== null) {
        return;
      }
      const shortcut = isProductivityShortcut(event);
      if (shortcut === null) {
        return;
      }
      event.preventDefault();
      if (document.querySelector("[data-cm-modal-drawer]") !== null) {
        return;
      }

      if (shortcut === "commands") {
        setPaletteOpen(true);
      } else {
        setHelpOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const catalogItems = useMemo(() => {
    if (session.status !== "ready") {
      return [];
    }
    return createServiceCatalogViewModel({
      catalog: session.catalog,
      document: session.document,
      mode,
      query: "",
      recentServiceIds: store.getState().recentServiceIds,
    }).categories.flatMap((category) => category.items);
  }, [mode, session, store]);

  if (session.status !== "ready") {
    return null;
  }

  const currentSnapshot =
    session.validation.status === "current"
      ? snapshotFromValidationState(session.validation)
      : null;
  const consequentialFindings =
    currentSnapshot !== null &&
    currentSnapshot.hashes.contentHash === session.hashes.contentHash &&
    currentSnapshot.hashes.visualHash === session.hashes.visualHash
      ? (
          [
            ...currentSnapshot.draftReport.findings.map((finding) => ({
              finding,
              target: "draft" as const,
            })),
            ...currentSnapshot.compilationReport.findings.map((finding) => ({
              finding,
              target: "compilation" as const,
            })),
          ] as const
        ).filter(
          ({ finding }) =>
            finding.severity === "error" ||
            finding.severity === "security-error",
        )
      : [];

  function focusSelected(tab: "configure" | "connect" | "learn") {
    if (selection === null) {
      store.getState().announce("Select a resource or relationship first.");
      return;
    }
    shell?.openContextPanel("selected-resource-inspector", tab);
  }

  function jumpToNextFinding() {
    const currentIndex = consequentialFindings.findIndex(
      ({ finding, target }) =>
        finding.findingId === validationFocus?.findingId &&
        target === validationFocus.target,
    );
    const next =
      consequentialFindings[
        currentIndex < 0 ? 0 : (currentIndex + 1) % consequentialFindings.length
      ];
    const location = next?.finding.affected[0];
    if (next === undefined || location === undefined) {
      shell?.openWorkspacePanel("issues", "validation-issues-panel");
      store
        .getState()
        .announce(
          "No current error or security finding is available to focus.",
        );
      return;
    }
    navigateToValidationFinding({
      finding: next.finding,
      location,
      shell,
      store,
      target: next.target,
    });
  }

  const baseCommands: EditorCommand[] = [
    {
      description: "Focus exact catalog search and Add controls.",
      group: "Create",
      id: "open-catalog",
      keywords: "quick add service",
      label: "Open service catalog",
      run() {
        shell?.openCatalogPanel("service-catalog-search");
      },
    },
    {
      description: "Open Configure for the current stable selection.",
      disabledReason:
        selection === null ? "Select an element first." : undefined,
      group: "Navigate",
      id: "focus-selected",
      keywords: "inspector configure node resource edge",
      label: "Focus selection in inspector",
      run() {
        focusSelected("configure");
      },
    },
    {
      description:
        "Open Connect without applying or confirming a relationship.",
      disabledReason:
        selection?.kind !== "node" ? "Select a resource first." : undefined,
      group: "Navigate",
      id: "connect-selected",
      keywords: "connection wizard ports relationship",
      label: "Connect selected resource",
      run() {
        if (selection?.kind === "node") {
          session.beginConnection({ kind: "node", nodeId: selection.id });
        }
      },
    },
    {
      description:
        "Focus the next canonical draft or compilation error or security finding.",
      disabledReason:
        consequentialFindings.length === 0
          ? "No current error or security finding."
          : undefined,
      group: "Navigate",
      id: "next-consequential-finding",
      keywords: "next issue validation error security",
      label: "Next error or security finding",
      run: jumpToNextFinding,
    },
    {
      description: "Open the canonical Issues report.",
      group: "Navigate",
      id: "open-issues",
      keywords: "validation findings",
      label: "Open Issues",
      run() {
        shell?.openWorkspacePanel("issues", "validation-issues-panel");
      },
    },
    {
      description:
        "Preview an automatic arrangement without changing resources or connections.",
      disabledReason: !session.automaticLayoutAvailable
        ? "Automatic arrangement is unavailable for this architecture."
        : session.connectionWorkflow.open
          ? "Finish or cancel the open connection first."
          : undefined,
      group: "View",
      id: "arrange-automatically",
      keywords: "layout arrange canvas preview",
      label: "Arrange automatically",
      run() {
        session.startAutomaticLayout();
      },
    },
    {
      description:
        "Open the synchronized Architecture list without changing the document.",
      disabledReason:
        posture === "phone"
          ? "The Architecture list is already the primary phone view."
          : undefined,
      group: "View",
      id: "architecture-list",
      keywords: "tree list inspector resources relationships",
      label: "Architecture list",
      run() {
        shell?.focusArchitectureTarget("architecture-list");
      },
    },
    {
      description:
        "Fit every visible resource without changing saved positions.",
      disabledReason:
        posture === "phone"
          ? "Fit requires the canvas available on tablet or desktop; use the Architecture list on phones."
          : undefined,
      group: "View",
      id: "fit-architecture",
      keywords: "graph zoom canvas",
      label: "Fit architecture",
      run() {
        onViewRequest("architecture");
      },
    },
    {
      description: "Fit the selected resource or relationship endpoints.",
      disabledReason:
        posture === "phone"
          ? "Fit requires the canvas available on tablet or desktop; use the Architecture list on phones."
          : selection === null
            ? "Select an element first."
            : undefined,
      group: "View",
      id: "fit-selection",
      keywords: "node edge endpoints zoom canvas",
      label: "Fit selection",
      run() {
        onViewRequest("selection");
      },
    },
    {
      description:
        "Open catalog-sourced explanation for the current selection.",
      disabledReason:
        selection === null ? "Select an element first." : undefined,
      group: "Learn",
      id: "learn-selection",
      keywords: "why glossary documentation cost security reliability",
      label: "Learn about selection",
      run() {
        focusSelected("learn");
      },
    },
    {
      description: hosted
        ? "Open Revisions and exports from Project status."
        : "Locate future code and diagram export; no artifact is created.",
      group: "Navigate",
      id: "future-export",
      keywords:
        "code diagram export artifact terraform cloudformation download",
      label: hosted
        ? "Export infrastructure and diagrams"
        : "Open future code and diagram export",
      run() {
        usabilityEvents.record({
          artifact: "code",
          surface: "workspace",
          type: "export_entry_point_opened",
        });
        if (hosted) shell?.openRevisionPlaceholder();
        else shell?.openWorkspacePanel("code", "editor-code-workspace");
      },
    },
    {
      description: hosted
        ? "Open Project status for saved revisions and export options."
        : "Focus the truthful revision placeholder; no revision is created.",
      group: "Navigate",
      id: "revision-placeholder",
      keywords: "prepare create revision",
      label: hosted
        ? "Open revisions and exports"
        : "Locate future revision review",
      run() {
        shell?.openRevisionPlaceholder();
      },
    },
    {
      description:
        "Open Code to import infrastructure from a GitHub repository.",
      disabledReason: hosted
        ? undefined
        : "Repository import is available in a signed-in project.",
      group: "Navigate",
      id: "import-infrastructure",
      keywords:
        "import terraform cloudformation github repository existing code",
      label: "Import Terraform or CloudFormation",
      run() {
        shell?.openWorkspacePanel("code", "repository-import-workspace");
      },
    },
    {
      description: "Undo the most recent accepted Graph Command.",
      disabledReason: session.history.canUndo ? undefined : "Nothing to undo.",
      group: "History",
      id: "undo",
      keywords: "command history",
      label: session.history.undoLabel ?? "Undo",
      run() {
        session.undo();
      },
    },
    {
      description: "Redo the next accepted Graph Command.",
      disabledReason: session.history.canRedo ? undefined : "Nothing to redo.",
      group: "History",
      id: "redo",
      keywords: "command history",
      label: session.history.redoLabel ?? "Redo",
      run() {
        session.redo();
      },
    },
    {
      description: hosted
        ? "Take a quick tour of the editor menus."
        : "Restart the local notes-API teaching progress in Guided presentation.",
      disabledReason:
        !hosted && experienceFixture !== "notes-api"
          ? "Open the notes API template first."
          : undefined,
      group: "Learn",
      id: "restart-walkthrough",
      keywords: "tour onboarding guided help",
      label: hosted ? "Restart editor tour" : "Restart notes API walkthrough",
      run() {
        if (hosted) {
          experience.restartWalkthrough();
          experience.setContextualTeachingEnabled(true);
          onWalkthroughRestart();
          store.getState().announce("Editor tour restarted.");
          return;
        }
        const changedMode = restartNotesApiWalkthrough({
          experience,
          mode,
          setMode,
          surface: "walkthrough",
          usabilityEvents,
        });
        onWalkthroughRestart();
        if (changedMode) {
          store
            .getState()
            .announce(
              "The notes API walkthrough restarted in Guided presentation.",
            );
        } else {
          store.getState().announce("The notes API walkthrough was restarted.");
        }
      },
    },
  ];

  const addCommands: EditorCommand[] = catalogItems.map((item) => ({
    description: item.addability.enabled
      ? item.primarySummary
      : item.addability.reason,
    disabledReason: item.addability.enabled
      ? undefined
      : item.addability.reason,
    group: "Create",
    id: `add-service:${item.serviceId}`,
    keywords: `add quick ${item.service.searchText}`,
    label: `Add ${item.service.displayName}`,
    run() {
      const result = session.addService(item.serviceId);
      if (!result.ok) {
        store.getState().announce(result.message);
        return;
      }
      store.getState().setSelection({ id: result.nodeId, kind: "node" });
      shell?.openContextPanel("selected-resource-inspector", "configure");
    },
  }));
  const commands = [...baseCommands, ...addCommands];
  const visibleCommands = commands.filter((command) =>
    commandMatches(command, query),
  );
  const canvasCommands = [
    baseCommands.find((command) => command.id === "arrange-automatically"),
    baseCommands.find((command) => command.id === "fit-architecture"),
    baseCommands.find((command) => command.id === "fit-selection"),
    baseCommands.find((command) => command.id === "architecture-list"),
  ].filter((command): command is EditorCommand => command !== undefined);

  function execute(command: EditorCommand) {
    if (command.disabledReason !== undefined) {
      store.getState().announce(command.disabledReason);
      return;
    }
    setPaletteOpen(false);
    command.run();
  }

  function executeCanvasCommand(command: EditorCommand) {
    if (command.disabledReason !== undefined) {
      store.getState().announce(command.disabledReason);
      return;
    }
    setCanvasOpen(false);
    command.run();
  }

  function moveCommandFocus(
    event: ReactKeyboardEvent<HTMLElement>,
    direction: 1 | -1,
  ) {
    event.preventDefault();
    const buttons = Array.from(
      commandListRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    if (buttons.length === 0) {
      return;
    }
    const current = document.activeElement;
    const index = buttons.findIndex((button) => button === current);
    const nextIndex =
      index < 0
        ? direction > 0
          ? 0
          : buttons.length - 1
        : (index + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  }

  return (
    <>
      <div
        aria-label="Editor actions"
        className="editor-header-actions"
        role="toolbar"
      >
        <div
          aria-label="Command history"
          className="editor-history-actions"
          role="group"
        >
          <IconButton
            disabled={!session.history.canUndo}
            icon={<Undo2 aria-hidden="true" size={16} />}
            label={
              session.history.undoLabel === null
                ? "Undo unavailable: nothing to undo"
                : `Undo ${session.history.undoLabel} (Ctrl or Command plus Z)`
            }
            onClick={() => {
              session.undo();
            }}
            title={
              session.history.undoLabel === null
                ? "Nothing to undo"
                : `Undo ${session.history.undoLabel}`
            }
            variant="quiet"
          />
          <IconButton
            disabled={!session.history.canRedo}
            icon={<Redo2 aria-hidden="true" size={16} />}
            label={
              session.history.redoLabel === null
                ? "Redo unavailable: nothing to redo"
                : `Redo ${session.history.redoLabel} (Ctrl or Command plus Shift plus Z)`
            }
            onClick={() => {
              session.redo();
            }}
            title={
              session.history.redoLabel === null
                ? "Nothing to redo"
                : `Redo ${session.history.redoLabel}`
            }
            variant="quiet"
          />
        </div>

        <Tooltip
          content="Keyboard shortcuts and editor help (Ctrl or Command plus /)"
          placement="bottom"
          renderInPortal
        >
          <button
            aria-label="Help and keyboard shortcuts"
            id="editor-shortcut-help-trigger"
            ref={helpTriggerRef}
            onClick={() => {
              setHelpOpen(true);
            }}
            className="cm-button"
            data-size="compact"
            type="button"
            data-variant="quiet"
          >
            <CircleHelp aria-hidden="true" size={16} />
            <span className="editor-header-actions__label">Help</span>
          </button>
        </Tooltip>
      </div>

      {canvasMenuTarget === null
        ? null
        : createPortal(
            <Popover
              className="canvas-minimap-menu nodrag nopan"
              label="Canvas actions"
              onOpenChange={setCanvasOpen}
              open={canvasOpen}
              renderContent={(content) => createPortal(content, document.body)}
              trigger={
                <span className="editor-header-actions__trigger">
                  <LayoutDashboard aria-hidden="true" size={16} />
                  <span className="canvas-minimap-menu__label">Canvas</span>
                </span>
              }
              triggerLabel="Open Canvas menu"
              triggerTooltip={{
                content: "View, arrange, fit, or list the architecture",
                placement: "bottom",
                renderInPortal: true,
              }}
            >
              <div
                aria-label="Canvas actions"
                className="editor-header-menu"
                role="group"
              >
                {canvasCommands.map((command) => (
                  <Tooltip
                    content={command.description}
                    disabled={command.disabledReason !== undefined}
                    key={command.id}
                    placement="left"
                    renderInPortal
                  >
                    <button
                      aria-disabled={
                        command.disabledReason === undefined
                          ? undefined
                          : "true"
                      }
                      className="editor-header-menu__action"
                      onClick={() => {
                        executeCanvasCommand(command);
                      }}
                      type="button"
                    >
                      <span>
                        {command.id === "arrange-automatically" ? (
                          <LayoutDashboard aria-hidden="true" size={16} />
                        ) : command.id === "fit-architecture" ? (
                          <Maximize2 aria-hidden="true" size={16} />
                        ) : command.id === "fit-selection" ? (
                          <LocateFixed aria-hidden="true" size={16} />
                        ) : (
                          <ListTree aria-hidden="true" size={16} />
                        )}
                        <strong>{command.label}</strong>
                      </span>
                      {command.disabledReason === undefined ? null : (
                        <small>{command.disabledReason}</small>
                      )}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </Popover>,
            canvasMenuTarget,
          )}
      <ModalDrawer
        description={
          paletteOpen
            ? "Search available local editor actions. Highlighting never runs an action."
            : "Shortcuts never bypass a preview, confirmation, or generated-resource safeguard."
        }
        {...(paletteOpen ? { initialFocusRef: searchRef } : {})}
        returnFocusRef={helpTriggerRef}
        onClose={() => {
          setPaletteOpen(false);
          setHelpOpen(false);
        }}
        open={paletteOpen || helpOpen}
        title={paletteOpen ? "Command palette" : "Keyboard shortcuts"}
      >
        {paletteOpen ? (
          <>
            <label className="editor-command-search">
              <span>Search commands</span>
              <input
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    moveCommandFocus(event, 1);
                  }
                }}
                ref={searchRef}
                type="search"
                value={query}
              />
            </label>
            <div
              aria-label="Available editor commands"
              className="editor-command-list"
              ref={commandListRef}
            >
              {visibleCommands.length === 0 ? (
                <p role="status">
                  No local editor command matches this search.
                </p>
              ) : (
                visibleCommands.map((command) => (
                  <button
                    aria-describedby={`${command.id}-description`}
                    className="editor-command-list__item"
                    disabled={command.disabledReason !== undefined}
                    key={command.id}
                    onClick={() => {
                      execute(command);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        moveCommandFocus(event, 1);
                      } else if (event.key === "ArrowUp") {
                        moveCommandFocus(event, -1);
                      }
                    }}
                    type="button"
                  >
                    <span>
                      <strong>{command.label}</strong>
                      <small>{command.group}</small>
                    </span>
                    <small id={`${command.id}-description`}>
                      {command.disabledReason ?? command.description}
                    </small>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                setQuery("");
                setHelpOpen(false);
                setPaletteOpen(true);
              }}
              variant="secondary"
              aria-label="Commands"
            >
              <Command aria-hidden="true" size={16} />
              Commands
              <kbd>Ctrl/⌘ K</kbd>
            </Button>
            <dl className="editor-shortcut-list">
              <div>
                <dt>Command palette</dt>
                <dd>Ctrl/Command + K</dd>
              </div>
              <div>
                <dt>Shortcut help</dt>
                <dd>Ctrl/Command + /</dd>
              </div>
              <div>
                <dt>Undo</dt>
                <dd>Ctrl/Command + Z</dd>
              </div>
              <div>
                <dt>Redo</dt>
                <dd>Ctrl/Command + Shift + Z</dd>
              </div>
              <div>
                <dt>Connect selected canvas resource</dt>
                <dd>C</dd>
              </div>
              <div>
                <dt>Move focused resource in the desktop Architecture list</dt>
                <dd>Alt + Arrow keys</dd>
              </div>
              <div>
                <dt>Confirm prepared connection preview</dt>
                <dd>Ctrl/Command + Enter</dd>
              </div>
              <div>
                <dt>Apply prepared automatic layout</dt>
                <dd>Ctrl + Enter</dd>
              </div>
              <div>
                <dt>Navigate lists</dt>
                <dd>Tab, Arrow keys, Enter, Space</dd>
              </div>
            </dl>
            <p>
              Text fields keep their native editing shortcuts. Drag actions also
              have Catalog Add, Architecture list, Configure, and
              connection-wizard controls.
            </p>
          </>
        )}
      </ModalDrawer>
    </>
  );
}
