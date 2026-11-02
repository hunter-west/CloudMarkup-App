import {
  getArchitectureDocumentCanonicalHash,
  type ValidationFinding,
} from "@cloudmarkup/domain";
import type { RepositoryImportResultV1 } from "@cloudmarkup/repository-importer";
import type { ArchitectureDocumentV3 } from "@cloudmarkup/schemas";
import { Button, EmptyState, ErrorState, Tabs } from "@cloudmarkup/ui";
import { ListTree } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  forgetProjectCreationProposal,
  readProjectCreationProposal,
} from "../generation/project-creation-proposal.js";

import { useModePreference } from "../../preferences/index.js";
import {
  useAiCapabilities,
  useOptionalCloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  betaInfrastructureIssueIdentity,
  betaInfrastructureIssueRepairAvailability,
} from "../generation/beta-infrastructure-issue.js";
import {
  EXPORT_DIAGNOSTIC_QUERY,
  readExportDiagnosticRequest,
  resolveExportDiagnosticRecovery,
  exportDiagnosticTargetId,
  diagnosticReferenceLabel,
} from "../exports/diagnostic-recovery.js";
import { focusValidationElement } from "./validation/validation-navigation.js";
import type { InspectorTab, WorkspaceTab } from "../../shell/AppShell.js";
import { RoutePage } from "../../shell/RoutePage.js";
import {
  useViewportPosture,
  type ViewportPosture,
} from "../../shell/viewport.js";
import { useWorkspaceShellController } from "../../shell/workspace-shell-context.js";
import {
  AssistantWorkspace,
  useAssistantWorkspaceHost,
} from "../assistant/index.js";
import { GuidedWalkthrough } from "../onboarding/GuidedWalkthrough.js";
import {
  ArchitectureCanvas,
  type ArchitectureCanvasViewRequest,
} from "./canvas/ArchitectureCanvas.js";
import { ArchitectureTree } from "./canvas/ArchitectureTree.js";
import { ServiceCatalogPanel } from "./catalog/ServiceCatalogPanel.js";
import {
  ContinuousConformanceWorkspace,
  type ContinuousConformanceReadModel,
  type ContinuousConformanceReviewAction,
} from "./conformance/index.js";
import { ConnectionWizard } from "./connection/ConnectionWizard.js";
import { DevelopmentFixtureStatus } from "./DevelopmentFixtureStatus.js";
import "./editor-canvas.css";
import {
  editorStartRegionSourceLabel,
  useEditorStartRegionSource,
} from "./editor-start-context.js";
import {
  SelectedResourceCode,
  SelectedResourceInspector,
} from "./inspector/SelectedResourceInspector.js";
import { getEditorHistoryShortcut } from "./model/editor-history-shortcuts.js";
import { mapArchitectureDocumentToFlow } from "./model/index.js";
import {
  RepositoryConformanceView,
  type RepositoryReviewAction,
} from "./repository/RepositoryConformanceView.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "./session/index.js";
import { GuidedNextAction } from "./validation/GuidedNextAction.js";
import {
  IssuesPanel,
  type AiRepairAvailability,
} from "./validation/IssuesPanel.js";
import { isEditorValidationSnapshotComplete } from "./validation/editor-validation.js";

const ProjectCreationProposalReview = lazy(() =>
  import("../generation/ProjectCreationProposalReview.js").then((module) => ({
    default: module.ProjectCreationProposalReview,
  })),
);
const BetaInfrastructurePanel = lazy(() =>
  import("../generation/BetaInfrastructurePanel.js").then((module) => ({
    default: module.BetaInfrastructurePanel,
  })),
);

interface EditorWorkspaceProps {
  readonly editingAvailable?: boolean;
  readonly experienceFixture?: "notes-api" | undefined;
  readonly fixtureMode?: boolean;
  readonly projectId: string;
  readonly viewRequest?: ArchitectureCanvasViewRequest | undefined;
  readonly walkthroughInstance?: number | undefined;
  readonly showWalkthrough?: boolean;
}

export function EditorMain({
  editingAvailable = false,
  fixtureMode = false,
  experienceFixture,
  projectId,
  viewRequest,
  walkthroughInstance = 0,
  showWalkthrough = true,
}: EditorWorkspaceProps) {
  const session = useEditorDocumentSession();
  const posture = useViewportPosture();
  const recoveringExport =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has(EXPORT_DIAGNOSTIC_QUERY);
  const [creationProposal, setCreationProposal] = useState(() =>
    readProjectCreationProposal(projectId),
  );

  return (
    <RoutePage
      immersive
      routeKey={`editor-${projectId}`}
      title="Architecture editor"
    >
      {session.status === "invalid" ? (
        <div className="architecture-error-state">
          <ExportDiagnosticRecovery projectId={projectId} document={null} />
          {fixtureMode ? <DevelopmentFixtureStatus /> : null}
          <ErrorState
            description={session.problem.message}
            live="polite"
            title={session.problem.title}
          />
        </div>
      ) : (
        <ReadyEditorMain
          projectId={projectId}
          experienceFixture={experienceFixture}
          fixtureMode={fixtureMode}
          posture={posture}
          session={session}
          viewRequest={viewRequest}
          walkthroughInstance={walkthroughInstance}
          showWalkthrough={
            showWalkthrough && !recoveringExport && creationProposal === null
          }
        />
      )}
      {creationProposal && session.status === "ready" ? (
        <Suspense fallback={<p role="status">Loading diagram review…</p>}>
          <ProjectCreationProposalReview
            proposal={creationProposal}
            editingAvailable={editingAvailable}
            onClose={() => {
              forgetProjectCreationProposal(projectId);
              setCreationProposal(null);
            }}
          />
        </Suspense>
      ) : null}
    </RoutePage>
  );
}

function ExportDiagnosticRecovery({
  projectId,
  document: currentDocument,
}: {
  projectId: string;
  document: ArchitectureDocumentV3 | null;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const shell = useWorkspaceShellController();
  const store = useEditorSessionStoreApi();
  const live = useRef(currentDocument);
  useLayoutEffect(() => {
    live.current = currentDocument;
  }, [currentDocument]);
  const search = typeof window === "undefined" ? "" : window.location.search;
  const present = new URLSearchParams(search).has(EXPORT_DIAGNOSTIC_QUERY);
  const request = useMemo(() => readExportDiagnosticRequest(search), [search]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!present) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    queueMicrotask(() => {
      if (!cancelled)
        setMessage("Checking the saved export against the current canvas.");
    });
    if (runtime === null || request === null) {
      queueMicrotask(() => {
        if (!cancelled)
          setMessage(
            "This export finding is unavailable here. Open the saved export and review its recorded checks.",
          );
      });
      return () => {
        cancelled = true;
      };
    }
    void resolveExportDiagnosticRecovery({
      client: runtime.client,
      projectId,
      request,
      currentDocument: () => live.current,
    }).then((result) => {
      if (cancelled) return;
      if (result.state !== "current") {
        setMessage(result.message);
        return;
      }
      const reference = result.reference;
      if (reference.kind !== "node" && reference.kind !== "edge") return;
      const targetId = exportDiagnosticTargetId(reference);
      store.getState().setSelection({ kind: reference.kind, id: reference.id });
      shell?.openContextPanel(
        undefined,
        reference.fieldPath ? "configure" : "architecture",
      );
      timer = setTimeout(() => {
        if (cancelled) return;
        if (
          live.current === null ||
          getArchitectureDocumentCanonicalHash(live.current) !==
            result.documentDigest
        ) {
          setMessage(
            "The canvas changed while this finding was opening. Your work is kept. Open the export finding again to check its current source.",
          );
          return;
        }
        if (
          targetId !== null &&
          focusValidationElement(document.getElementById(targetId))
        ) {
          const next = `Focused ${diagnosticReferenceLabel(reference, live.current)} in the matching current canvas.`;
          setMessage(next);
          return;
        }
        const modal = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-cm-modal-drawer][aria-modal='true']",
          ),
        ].at(-1);
        const titleId = modal?.getAttribute("aria-labelledby");
        const panelFocused = focusValidationElement(
          titleId ? document.getElementById(titleId) : null,
        );
        const listFocused =
          !panelFocused &&
          focusValidationElement(document.getElementById("architecture-list"));
        const next = `The exact export field or item could not be focused here. ${panelFocused ? "Focused the configuration panel instead." : listFocused ? "Focused the architecture list instead." : "Review the item in Configure or Architecture."}`;
        setMessage(next);
      }, 0);
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [present, projectId, request, runtime, shell, store]);
  return present ? (
    <p className="state-card" role="status">
      {message}
    </p>
  ) : null;
}

function ReadyEditorMain({
  projectId,
  fixtureMode,
  experienceFixture,
  posture,
  session,
  viewRequest,
  walkthroughInstance,
  showWalkthrough,
}: {
  readonly projectId: string;
  readonly fixtureMode: boolean;
  readonly experienceFixture?: "notes-api" | undefined;
  readonly posture: ViewportPosture;
  readonly session: Extract<
    ReturnType<typeof useEditorDocumentSession>,
    { status: "ready" }
  >;
  readonly viewRequest?: ArchitectureCanvasViewRequest | undefined;
  readonly walkthroughInstance: number;
  readonly showWalkthrough: boolean;
}) {
  const { mode } = useModePreference();
  const announcement = useEditorSessionState((state) => state.liveAnnouncement);
  const validationAnnouncement = useEditorSessionState(
    (state) => state.validationAnnouncement,
  );
  const selection = useEditorSessionState((state) => state.selection);
  const workspaceShell = useWorkspaceShellController();
  const regionSource = useEditorStartRegionSource();
  const phoneModel = useMemo(
    () =>
      posture === "phone"
        ? mapArchitectureDocumentToFlow(session.document, session.catalog)
        : null,
    [posture, session.catalog, session.document],
  );

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      const shortcut = getEditorHistoryShortcut(event);
      if (
        shortcut === null ||
        document.querySelector("[data-cm-modal-drawer]") !== null
      ) {
        return;
      }
      const available =
        shortcut === "undo" ? session.history.canUndo : session.history.canRedo;
      if (!available) {
        return;
      }
      event.preventDefault();
      if (shortcut === "undo") {
        session.undo();
      } else {
        session.redo();
      }
    };
    document.addEventListener("keydown", handleHistoryShortcut);
    return () => {
      document.removeEventListener("keydown", handleHistoryShortcut);
    };
  }, [session]);

  const guidedWalkthrough = showWalkthrough ? (
    <GuidedWalkthrough
      experienceFixture={experienceFixture}
      key={"notes-api-walkthrough-" + String(walkthroughInstance)}
    />
  ) : null;

  return (
    <div
      className="architecture-editor"
      data-content-hash={session.hashes.contentHash}
      data-document-id={session.document.documentId}
      data-editor-mode={mode}
      data-visual-hash={session.hashes.visualHash}
    >
      <div className="architecture-editor__viewport">
        {posture === "phone" && phoneModel !== null ? (
          <section
            className="phone-architecture"
            aria-label="Architecture phone review"
          >
            <div className="architecture-editor__experience-controls">
              <ExportDiagnosticRecovery
                projectId={projectId}
                document={session.document}
              />
              {guidedWalkthrough}
              <GuidedNextAction />
            </div>
            {fixtureMode ? <DevelopmentFixtureStatus /> : null}
            <p className="status-label">Your architecture</p>
            <p>
              Add services from Catalog, then tap a service to configure it. Use
              a larger screen to arrange the canvas.
            </p>
            <p
              data-region-source={regionSource}
              data-testid="architecture-document-target"
              title={editorStartRegionSourceLabel(regionSource)}
            >
              Region <code>{session.document.provider.region}</code>
            </p>
            {phoneModel.nodes.length === 0 && phoneModel.edges.length === 0 ? (
              <EmptyState
                className="architecture-empty-message"
                description="Open Catalog to add your first service."
                title="This architecture has no elements"
              />
            ) : null}
            {selection === null ? null : (
              <Button
                onClick={() => {
                  workspaceShell?.openContextPanel("inspector-panel");
                }}
              >
                Open selected details
              </Button>
            )}
            <ArchitectureTree allowMovement={false} model={phoneModel} />
          </section>
        ) : posture !== "phone" ? (
          <ArchitectureCanvas
            guidedWalkthrough={
              <>
                <ExportDiagnosticRecovery
                  projectId={projectId}
                  document={session.document}
                />
                {guidedWalkthrough}
                <GuidedNextAction />
              </>
            }
            fixtureMode={fixtureMode}
            posture={posture}
            viewRequest={viewRequest}
          />
        ) : null}
      </div>
      <p
        aria-atomic="true"
        aria-live="polite"
        className="architecture-live-region"
      >
        {announcement}
      </p>
      <p
        aria-atomic="true"
        aria-live="polite"
        className="architecture-validation-live-region"
      >
        {validationAnnouncement}
      </p>
      <ConnectionWizard />
    </div>
  );
}

export function CatalogPanel({ notice }: { readonly notice?: ReactNode }) {
  return <ServiceCatalogPanel notice={notice} />;
}

function InspectorArchitectureList() {
  const session = useEditorDocumentSession();
  const posture = useViewportPosture();
  const model = useMemo(
    () =>
      session.status === "ready"
        ? mapArchitectureDocumentToFlow(session.document, session.catalog)
        : null,
    [session],
  );

  if (model === null || posture === "phone") {
    return null;
  }

  return (
    <div className="architecture-popup-list">
      <header className="architecture-popup-list__heading">
        <ListTree aria-hidden="true" size={18} />
        <div>
          <h3>Architecture list</h3>
          <p>
            {String(model.nodes.length)} resources ·{" "}
            {String(model.edges.length)} relationships
          </p>
        </div>
      </header>
      <ArchitectureTree
        allowMovement={posture === "desktop"}
        model={model}
        showHeader={false}
      />
    </div>
  );
}

export function InspectorPanel({
  activeTab,
  onActiveTabChange,
}: {
  readonly activeTab: InspectorTab;
  readonly onActiveTabChange: (tab: InspectorTab) => void;
}) {
  const selection = useEditorSessionState((state) => state.selection);

  if (activeTab === "architecture") {
    return (
      <div className="panel-content panel-content--architecture-list">
        <header className="visually-hidden">
          <p className="status-label">Architecture</p>
          <h2>Resources and relationships</h2>
        </header>
        <InspectorArchitectureList />
      </div>
    );
  }

  return (
    <div className="panel-content">
      <header className="visually-hidden">
        <p className="status-label">Contextual inspector</p>
        <h2>{selection === null ? "No selection" : "Document selection"}</h2>
      </header>
      <SelectedResourceInspector
        activeTab={activeTab}
        onActiveTabChange={onActiveTabChange}
      />
    </div>
  );
}

const workspaceTabs = [
  ["assistant", "Assistant"],
  ["issues", "Issues"],
  ["code", "Code"],
  ["activity", "Activity"],
] as const;

const workspaceMessages: Record<string, readonly [string, string]> = {
  assistant: [
    "Assistant not available",
    "AI assistance is not enabled in this workspace. You can continue editing manually.",
  ],
};

function SessionActivity() {
  const session = useEditorDocumentSession();
  const entries = session.history.entries ?? [];
  const activity = useEditorSessionState((state) => state.assistantActivity);
  return (
    <section className="panel-tab-content" aria-label="Editing activity">
      <h3>This editing session</h3>
      {activity ? (
        <div role="status">
          <p>{activity.message}</p>
          {activity.status === "running" ? (
            <progress aria-label="AI proposal progress" />
          ) : null}
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p>
          No edits in this session yet. Accepted AI proposals and manual edits
          appear here.
        </p>
      ) : (
        <ol>
          {[...entries].reverse().map((entry) => (
            <li key={entry.id}>
              {entry.label}
              {entry.applied ? "" : " (undone)"}
            </li>
          ))}
        </ol>
      )}
      <p>Track export progress from Revisions and exports.</p>
    </section>
  );
}

/** Availability is advisory; a click independently checks the latest committed
 * document and finding. Proposal admission and apply remain server guarded. */
function BetaRepairIssues({
  editingAvailable,
  onRequestAiFix,
  activeIssues = [],
}: {
  readonly editingAvailable: boolean;
  readonly onRequestAiFix: (finding: ValidationFinding) => void;
  readonly activeIssues?: NonNullable<
    ComponentProps<typeof IssuesPanel>
  >["activeIssues"];
}) {
  const session = useEditorDocumentSession();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const availability = useAiCapabilities();
  function currentFinding(finding: ValidationFinding) {
    if (
      session.status !== "ready" ||
      session.validation.status !== "current" ||
      !isEditorValidationSnapshotComplete(session.validation.snapshot) ||
      session.validation.snapshot.hashes.contentHash !==
        session.hashes.contentHash ||
      session.validation.snapshot.hashes.visualHash !==
        session.hashes.visualHash
    )
      return undefined;
    const identity = betaInfrastructureIssueIdentity(finding);
    return [
      ...session.validation.snapshot.draftReport.findings,
      ...session.validation.snapshot.compilationReport.findings,
    ].find(
      (candidate) =>
        candidate.findingId === finding.findingId &&
        betaInfrastructureIssueIdentity(candidate) === identity,
    );
  }
  function getAvailability(finding: ValidationFinding): AiRepairAvailability {
    if (session.status !== "ready")
      return {
        available: false,
        reason:
          "The current design is unavailable. Restore it before reviewing a fix with AI.",
      };
    return betaInfrastructureIssueRepairAvailability(finding, {
      document: session.document,
      catalog: session.catalog,
      current: currentFinding(finding) !== undefined,
      editingAvailable,
      sessionExpired: runtime?.sessionExpired ?? false,
      aiState: availability.state,
      proposalAvailable: availability.proposalAvailable,
    });
  }
  const latest = useRef({ currentFinding, getAvailability, onRequestAiFix });
  useLayoutEffect(() => {
    latest.current = { currentFinding, getAvailability, onRequestAiFix };
  });
  return (
    <>
      {availability.state === "error" ||
      availability.state === "loading" ||
      availability.state === "unavailable" ||
      !availability.proposalAvailable ? (
        <div className="panel-tab-content">
          <p role="status">
            {availability.state === "loading"
              ? "Checking AI availability. Manual issue review remains available."
              : availability.state === "error"
                ? "AI availability could not be checked. Your work is kept; use manual review or check again."
                : "AI issue review is unavailable in this workspace. Manual review remains available."}
          </p>
          {runtime?.loadAiCapabilities ? (
            <Button
              disabled={availability.state === "loading"}
              onClick={availability.retry}
              variant="secondary"
            >
              Check AI availability
            </Button>
          ) : null}
        </div>
      ) : null}
      <IssuesPanel
        activeIssues={activeIssues}
        getAiRepairAvailability={getAvailability}
        onRequestAiFix={(finding) => {
          const value = latest.current;
          const canonical = value.currentFinding(finding);
          if (canonical && value.getAvailability(canonical).available)
            value.onRequestAiFix(canonical);
        }}
      />
    </>
  );
}

export function BottomWorkspacePanel({
  betaProjectId,
  betaEditingAvailable = false,
  activeTab,
  architecture,
  onActiveTabChange,
  onRepositoryReviewAction,
  repositoryImport,
  repositoryWorkspace,
  conformanceReport,
  conformanceWorkspace,
  onConformanceReviewAction,
}: {
  readonly betaProjectId?: string;
  readonly betaEditingAvailable?: boolean;
  readonly activeTab: WorkspaceTab;
  readonly architecture?: ArchitectureDocumentV3;
  readonly onActiveTabChange: (tab: WorkspaceTab) => void;
  readonly onRepositoryReviewAction?: (action: RepositoryReviewAction) => void;
  readonly repositoryImport?: RepositoryImportResultV1;
  readonly repositoryWorkspace?: ReactNode;
  readonly conformanceReport?: ContinuousConformanceReadModel;
  readonly conformanceWorkspace?: ReactNode;
  readonly onConformanceReviewAction?: (
    action: ContinuousConformanceReviewAction,
  ) => void;
}) {
  const { mode } = useModePreference();
  const assistantWorkspace = useAssistantWorkspaceHost();
  const [aiRepairRequest, setAiRepairRequest] = useState<{
    key: string;
    requirements: string;
    finding?: ValidationFinding;
  }>({
    key: "general",
    requirements: "",
  });
  const [assistantOpened, setAssistantOpened] = useState(
    activeTab === "assistant",
  );
  return (
    <div className="bottom-workspace-content">
      <Tabs
        ariaLabel="Bottom workspace"
        items={workspaceTabs.map(([id, label]) => {
          const message = workspaceMessages[id];

          return {
            id,
            label,
            panel:
              id === "assistant" && assistantWorkspace !== null ? (
                <AssistantWorkspace value={assistantWorkspace} />
              ) : id === "assistant" &&
                betaProjectId !== undefined &&
                betaEditingAvailable ? (
                assistantOpened || activeTab === "assistant" ? (
                  <Suspense fallback={<p role="status">Loading assistant…</p>}>
                    <BetaInfrastructurePanel
                      key={aiRepairRequest.key}
                      initialRequirements={aiRepairRequest.requirements}
                      {...(aiRepairRequest.finding
                        ? { selectedIssue: aiRepairRequest.finding }
                        : {})}
                      projectId={betaProjectId}
                      editingAvailable={betaEditingAvailable}
                    />
                  </Suspense>
                ) : null
              ) : id === "activity" ? (
                <SessionActivity />
              ) : id === "issues" ? (
                betaProjectId && assistantWorkspace === null ? (
                  <BetaRepairIssues
                    editingAvailable={betaEditingAvailable}
                    onRequestAiFix={(finding) => {
                      setAiRepairRequest({
                        finding,
                        key: finding.findingId + ":" + String(Date.now()),
                        requirements:
                          "Help me review this issue. Suggest the smallest safe change that keeps my design and unsaved work. Ask for any missing information and show the proposed changes for my approval.",
                      });
                      setAssistantOpened(true);
                      onActiveTabChange("assistant");
                    }}
                    {...(conformanceReport === undefined
                      ? {}
                      : { activeIssues: conformanceReport.issues })}
                  />
                ) : (
                  <IssuesPanel
                    {...(conformanceReport === undefined
                      ? {}
                      : { activeIssues: conformanceReport.issues })}
                  />
                )
              ) : id === "code" ? (
                <section
                  id="editor-code-workspace"
                  tabIndex={-1}
                  aria-label="Code and export mappings"
                >
                  <SelectedResourceCode />
                  {repositoryWorkspace !== undefined ? (
                    repositoryWorkspace
                  ) : architecture !== undefined &&
                    repositoryImport !== undefined ? (
                    <RepositoryConformanceView
                      architecture={architecture}
                      mode={mode}
                      {...(onRepositoryReviewAction === undefined
                        ? {}
                        : { onReviewAction: onRepositoryReviewAction })}
                      result={repositoryImport}
                    />
                  ) : null}
                  {conformanceWorkspace !== undefined ? (
                    conformanceWorkspace
                  ) : conformanceReport === undefined ? null : (
                    <ContinuousConformanceWorkspace
                      mode={mode}
                      {...(onConformanceReviewAction === undefined
                        ? {}
                        : { onReviewAction: onConformanceReviewAction })}
                      report={conformanceReport}
                    />
                  )}
                </section>
              ) : (
                <section aria-live="polite" className="workspace-empty">
                  <p className="status-label">{label}</p>
                  <h2>{message?.[0]}</h2>
                  <p>{message?.[1]}</p>
                </section>
              ),
          };
        })}
        onValueChange={(tab) => {
          if (tab === "assistant") setAssistantOpened(true);
          onActiveTabChange(tab as WorkspaceTab);
        }}
        size="compact"
        value={activeTab === "jobs" ? "activity" : activeTab}
      />
    </div>
  );
}
