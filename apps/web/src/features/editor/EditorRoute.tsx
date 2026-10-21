import {
  ApiClientError,
  type ConflictRecoveryV1,
  type CreateSolutionRevisionV1,
  type CurrentPrincipalV1,
  type DraftArchitectureDocumentV1,
  type ProjectEditingLeaseProofV1,
  type ProjectV1,
  type SolutionRevisionV1,
} from "@cloudmarkup/api-contract";
import {
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws/connection-resolution";
import { Popover } from "@cloudmarkup/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, CloudUpload, Info } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { RouteLoadingIndicator } from "../../shell/RouteLoadingIndicator.js";
import "./editor-project-access.css";

import {
  cloudMarkupQueryKeys,
  isApiErrorCode,
  mapApiError,
  useOptionalCloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  useExperiencePreference,
  useModePreference,
} from "../../preferences/index.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import {
  loadAwsEditorArchitectureDocument,
  loadAwsNetworkingVisualArchitectureDocument,
  loadBlankAwsEditorArchitectureDocument,
  loadDynamoDbEncryptionFixArchitectureDocument,
  loadManualNotesApiArchitectureDocument,
  loadOwnedConfigurationVisualArchitectureDocument,
  loadStableConnectionDockVisualArchitectureDocument,
} from "../../provider-catalog/aws-editor-fixture.js";
import { awsEditorValidationEvaluator } from "../../provider-catalog/aws-editor-validation.js";
import {
  isAwsEventTemplateId,
  loadAwsEventTemplateArchitectureDocument,
} from "../../provider-catalog/aws-event-template-fixture.js";
import { awsOwnedPolicyGraphDescriptors } from "../../provider-catalog/aws-owned-policy-descriptors.js";
import { awsIconRegistry } from "../../provider-icons/aws-icon-registry.js";
import { AppLink, useNavigate } from "../../routing/index.js";
import { AppShell, type AppShellIdentity } from "../../shell/AppShell.js";
import { useViewportPosture } from "../../shell/viewport.js";
import { useWorkspaceShellController } from "../../shell/workspace-shell-context.js";
import type { ArchitectureCanvasViewRequest } from "./canvas/ArchitectureCanvas.js";
import {
  projectApprovedConformanceTopologyV1,
  useContinuousConformanceQueryWorkspace,
  type ContinuousConformanceQueryBinding,
} from "./conformance/index.js";
import { DevelopmentFixtureStatus } from "./DevelopmentFixtureStatus.js";
import { EditorStartContext } from "./editor-start-context.js";
import { EditorCreditBalance } from "./EditorCreditBalance.js";
import {
  BottomWorkspacePanel,
  CatalogPanel,
  EditorMain,
  InspectorPanel,
} from "./EditorWorkspace.js";
import { hasExactEditorCatalogBinding } from "@cloudmarkup/graph-preparation/catalog-selection";
import {
  prepareEditorCatalogOpening,
  type EditorCatalogOpening,
} from "@cloudmarkup/graph-preparation/catalog-opening";
import {
  foundationEditorCatalog,
  foundationIconRegistry,
  loadFoundationArchitectureDocument,
  type LayoutAdapter,
} from "./model/index.js";
import { useEditorRecovery } from "./persistence/editor-recovery-context.js";
import {
  createEditorCommandIdFactory,
  createEditorRuntimeIdentity,
} from "./persistence/editor-runtime-identity.js";
import { createImmutableAttemptCoordinator } from "./persistence/immutable-attempt.js";
import {
  createIndexedDbEditorRecoveryStore,
  type IndexedDbEditorRecoveryStoreV1,
} from "./persistence/indexeddb-editor-recovery-store.js";
import { createLatestSaveDrain } from "./persistence/latest-save-drain.js";
import { EditorProductivityTools } from "./productivity/EditorProductivityTools.js";
import {
  GitHubRepositoryWorkspace,
  type AcceptRepositoryGraph,
  type RepositoryGraphAcceptanceRequest,
} from "./repository/GitHubRepositoryWorkspace.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
} from "./session/index.js";
import { useAcceptedIntentSelection } from "./use-accepted-intent-selection.js";
import { useProjectEditingLease } from "./use-project-editing-lease.js";
import { EditorIssueIndicator } from "./validation/EditorIssueIndicator.js";

export interface EditorRouteProps {
  readonly organizationId?: string;
  readonly principal?: CurrentPrincipalV1;
  readonly projectId: string;
  readonly shellIdentity?: AppShellIdentity;
}

function createBrowserRecoveryStore():
  IndexedDbEditorRecoveryStoreV1 | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const browserWindow = window as unknown as {
      readonly indexedDB?: IDBFactory;
    };
    return browserWindow.indexedDB === undefined
      ? undefined
      : createIndexedDbEditorRecoveryStore();
  } catch {
    return undefined;
  }
}

const awsEditorFixtureCapabilities = Object.freeze({
  connectionResolver: awsConnectionResolverV1,
  ownedPolicyDescriptors: awsOwnedPolicyGraphDescriptors,
  validationEvaluator: awsEditorValidationEvaluator,
});

function loadEditorVisualFixture(selectedFixture: string | null) {
  switch (selectedFixture) {
    case "aws":
      return {
        capabilities: awsEditorFixtureCapabilities,
        catalog: awsEditorCatalog,
        document: loadAwsEditorArchitectureDocument(),
        iconRegistry: awsIconRegistry,
        key: "aws",
      };
    case "aws-networking":
      return {
        capabilities: awsEditorFixtureCapabilities,
        catalog: awsEditorCatalog,
        document: loadAwsNetworkingVisualArchitectureDocument(),
        iconRegistry: awsIconRegistry,
        key: "aws-networking",
      };
    case "nested-boundaries":
      return {
        capabilities: {},
        catalog: foundationEditorCatalog,
        document: loadFoundationArchitectureDocument(),
        iconRegistry: foundationIconRegistry,
        key: "nested-boundaries",
      };
    case "manual-notes-api":
      return {
        capabilities: awsEditorFixtureCapabilities,
        catalog: awsEditorCatalog,
        document: loadManualNotesApiArchitectureDocument(),
        iconRegistry: awsIconRegistry,
        key: "manual-notes-api",
      };
    case "dynamodb-encryption-fix":
      return {
        capabilities: awsEditorFixtureCapabilities,
        catalog: awsEditorCatalog,
        document: loadDynamoDbEncryptionFixArchitectureDocument(),
        iconRegistry: awsIconRegistry,
        key: "dynamodb-encryption-fix",
      };
    case "owned-configurations":
      return {
        capabilities: awsEditorFixtureCapabilities,
        catalog: awsEditorCatalog,
        document: loadOwnedConfigurationVisualArchitectureDocument(),
        iconRegistry: awsIconRegistry,
        key: "owned-configurations",
      };
    case "stable-connection-dock":
      return {
        capabilities: awsEditorFixtureCapabilities,
        catalog: awsEditorCatalog,
        document: loadStableConnectionDockVisualArchitectureDocument(),
        iconRegistry: awsIconRegistry,
        key: "stable-connection-dock",
      };
    default:
      return undefined;
  }
}

const editorLayoutAdapter: LayoutAdapter = {
  async layout(request, options) {
    const { elkLayoutAdapter } =
      await import("./model/elk-layout-browser-adapter.js");
    return elkLayoutAdapter.layout(request, options);
  },
};

interface EditorWorkspaceShellProps {
  readonly betaEditingAvailable?: boolean;
  readonly conformanceBinding?: ContinuousConformanceQueryBinding;
  readonly catalogNotice?: ReactNode;
  readonly experienceFixture?: "notes-api" | undefined;
  readonly projectId: string;
  readonly repositoryWorkspace?: ReactNode;
  readonly serverControls?: ReactNode;
  readonly serverNotice?: ReactNode;
  readonly shellIdentity?: AppShellIdentity;
}

function EditorRequestedTool() {
  const shell = useWorkspaceShellController();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || shell === null) return;
    const tool = new URLSearchParams(window.location.search).get("tool");
    if (tool !== "import" && tool !== "assistant") return;
    opened.current = true;
    if (tool === "assistant") shell.openWorkspacePanel("assistant");
    else shell.openWorkspacePanel("code", "repository-import-workspace");
  }, [shell]);
  return null;
}

function EditorWorkspaceShell({
  betaEditingAvailable = false,
  catalogNotice,
  experienceFixture,
  conformanceBinding,
  repositoryWorkspace,
  projectId,
  serverControls,
  serverNotice,
  shellIdentity,
}: EditorWorkspaceShellProps) {
  const posture = useViewportPosture();
  const [viewRequest, setViewRequest] = useState<
    ArchitectureCanvasViewRequest | undefined
  >();
  const [walkthroughInstance, setWalkthroughInstance] = useState(0);
  const { mode } = useModePreference();
  const conformance = useContinuousConformanceQueryWorkspace({
    ...(conformanceBinding === undefined
      ? {}
      : { binding: conformanceBinding }),
    mode,
  });

  return (
    <AppShell
      {...(shellIdentity === undefined ? {} : { identity: shellIdentity })}
      workspace={{
        issueIndicator: <EditorIssueIndicator />,
        bottom: (activeTab, onActiveTabChange) => (
          <BottomWorkspacePanel
            betaProjectId={projectId}
            betaEditingAvailable={betaEditingAvailable}
            activeTab={activeTab}
            onActiveTabChange={onActiveTabChange}
            {...(repositoryWorkspace === undefined
              ? {}
              : { repositoryWorkspace })}
            {...(conformance.content === undefined
              ? {}
              : { conformanceWorkspace: conformance.content })}
            {...(conformance.report === undefined
              ? {}
              : { conformanceReport: conformance.report })}
          />
        ),
        catalog: <CatalogPanel notice={catalogNotice} />,
        context: (activeTab, onActiveTabChange) => (
          <InspectorPanel
            activeTab={activeTab}
            onActiveTabChange={onActiveTabChange}
          />
        ),
        header: (
          <>
            <EditorProductivityTools
              experienceFixture={experienceFixture}
              onWalkthroughRestart={() => {
                setWalkthroughInstance((current) => current + 1);
              }}
              onViewRequest={(target) => {
                setViewRequest((current) => ({
                  id: (current?.id ?? 0) + 1,
                  target,
                }));
              }}
              posture={posture}
            />
            {serverControls}
          </>
        ),
      }}
    >
      {serverNotice}
      <EditorRequestedTool />
      <EditorMain
        editingAvailable={betaEditingAvailable}
        experienceFixture={experienceFixture}
        fixtureMode
        projectId={projectId}
        viewRequest={viewRequest}
        walkthroughInstance={walkthroughInstance}
        showWalkthrough={
          walkthroughInstance > 0 ||
          new URLSearchParams(window.location.search).get("tool") !== "import"
        }
      />
    </AppShell>
  );
}

/**
 * Authorized route composition for the local fixture editor. The provider is
 * outside every shell region so canvas, tree, catalog, and inspector share one
 * document session without putting the document in shell or Zustand state.
 */
function FixtureEditorRoute({ projectId }: EditorRouteProps) {
  const [runtimeIdentity] = useState(createEditorRuntimeIdentity);
  const { defaultRegion } = useExperiencePreference();
  const [createId] = useState(() =>
    createEditorCommandIdFactory(runtimeIdentity.commandIdPrefix),
  );
  const [recoveryStore] = useState(createBrowserRecoveryStore);
  const recoveryStoreLifecycle = useRef(0);
  useEffect(() => {
    recoveryStoreLifecycle.current += 1;
    const generation = recoveryStoreLifecycle.current;
    return () => {
      queueMicrotask(() => {
        if (recoveryStoreLifecycle.current === generation) {
          recoveryStore?.close();
        }
      });
    };
  }, [recoveryStore]);
  const locationSearch =
    typeof window === "undefined" ? "" : window.location.search;
  const fixture = useMemo(() => {
    const searchParameters = new URLSearchParams(locationSearch);
    const visualFixturesEnabled =
      import.meta.env.DEV ||
      import.meta.env.VITE_CLOUDMARKUP_VISUAL_FIXTURES === "true";
    const visualFixture = visualFixturesEnabled
      ? loadEditorVisualFixture(searchParameters.get("fixture"))
      : undefined;
    if (visualFixture !== undefined) {
      return visualFixture;
    }
    const selectedStart = searchParameters.get("start") ?? null;
    switch (selectedStart) {
      case "event-template": {
        const selectedTemplate = searchParameters.get("template");
        if (
          selectedTemplate !== null &&
          isAwsEventTemplateId(selectedTemplate)
        ) {
          return {
            capabilities: awsEditorFixtureCapabilities,
            catalog: awsEditorCatalog,
            document: loadAwsEventTemplateArchitectureDocument(
              selectedTemplate,
              defaultRegion ?? undefined,
            ),
            iconRegistry: awsIconRegistry,
            key: `event-template-${selectedTemplate}`,
          };
        }
        return {
          capabilities: awsEditorFixtureCapabilities,
          catalog: awsEditorCatalog,
          document: loadBlankAwsEditorArchitectureDocument(
            defaultRegion ?? undefined,
          ),
          iconRegistry: awsIconRegistry,
          key: "blank",
        };
      }
      case "template":
        return {
          capabilities: awsEditorFixtureCapabilities,
          catalog: awsEditorCatalog,
          document: loadManualNotesApiArchitectureDocument(
            defaultRegion ?? undefined,
          ),
          iconRegistry: awsIconRegistry,
          key: "notes-api-template",
        };
      case "blank":
        return {
          capabilities: awsEditorFixtureCapabilities,
          catalog: awsEditorCatalog,
          document: loadBlankAwsEditorArchitectureDocument(
            defaultRegion ?? undefined,
          ),
          iconRegistry: awsIconRegistry,
          key: "blank",
        };
      default:
        return {
          capabilities: awsEditorFixtureCapabilities,
          catalog: awsEditorCatalog,
          document: loadAwsEditorArchitectureDocument(),
          iconRegistry: awsIconRegistry,
          key: "aws",
        };
    }
  }, [defaultRegion, locationSearch]);
  const isNewStartFixture =
    fixture.key === "blank" ||
    fixture.key === "notes-api-template" ||
    fixture.key.startsWith("event-template-");
  const regionSource = isNewStartFixture
    ? defaultRegion === null
      ? "local-fallback"
      : "preference"
    : "fixture";
  const recoveryVariantKey = isNewStartFixture
    ? `${fixture.key}:${fixture.document.provider.region}`
    : fixture.key;
  return (
    <EditorSessionProvider
      catalog={fixture.catalog}
      {...fixture.capabilities}
      key={`${projectId}:${recoveryVariantKey}`}
      createId={createId}
      document={fixture.document}
      iconRegistry={fixture.iconRegistry}
      layoutAdapter={editorLayoutAdapter}
      recoveryCheckingFallback={<DevelopmentFixtureStatus />}
      recoveryWriterId={runtimeIdentity.writerId}
      scopeKey={`local-fixture:${projectId}:${recoveryVariantKey}`}
      {...(recoveryStore === undefined ? {} : { recoveryStore })}
    >
      <EditorStartContext.Provider value={regionSource}>
        <EditorWorkspaceShell
          experienceFixture={
            fixture.key === "manual-notes-api" ||
            fixture.key === "notes-api-template"
              ? "notes-api"
              : undefined
          }
          projectId={projectId}
        />
      </EditorStartContext.Provider>
    </EditorSessionProvider>
  );
}
interface ServerDraftHead {
  readonly draft: DraftArchitectureDocumentV1;
  readonly etag: string;
}

// Read through a function because an awaited request can outlive this scope;
// a pre-await ref check is not evidence that the editor is still mounted.
function isEditorScopeActive(scope: { readonly current: boolean }): boolean {
  return scope.current;
}

type ServerSaveStatus =
  | "queued"
  | "saving"
  | "saved"
  | "offline"
  | "conflict"
  | "error"
  | "session-expired";

interface ServerSaveState {
  readonly conflict?: ConflictRecoveryV1;
  readonly editingLeaseId?: string;
  readonly message: string;
  readonly status: ServerSaveStatus;
}

interface PendingSolutionRevisionAttempt {
  readonly request: {
    readonly body: CreateSolutionRevisionV1;
    readonly headers: {
      readonly "idempotency-key": string;
      readonly "if-match": string;
    };
    readonly path: { readonly projectId: string };
  };
  readonly sourceDraftId: string;
  readonly sourceDraftVersion: number;
}

let browserMutationSequence = 0;

function createBrowserMutationKey(prefix: string): string {
  const randomId = globalThis.crypto.randomUUID();
  browserMutationSequence += 1;
  return [prefix, randomId, String(browserMutationSequence)].join(":");
}

function projectOrganizationContext(
  principal: CurrentPrincipalV1,
  organizationId: string,
) {
  return principal.organizationContexts.find(
    (context) => context.organizationId === organizationId,
  );
}

function hasCapability(
  principal: CurrentPrincipalV1,
  organizationId: string,
  capability: string,
): boolean {
  return (
    projectOrganizationContext(
      principal,
      organizationId,
    )?.capabilities.includes(capability) ?? false
  );
}

function assertServerResponseBinding(condition: boolean): asserts condition {
  if (!condition) {
    throw new Error("The server response binding is invalid.");
  }
}

function serverEditorBinding(document: ArchitectureDocument) {
  if (hasExactEditorCatalogBinding(document, awsEditorCatalog)) {
    return {
      capabilities: awsEditorFixtureCapabilities,
      catalog: awsEditorCatalog,
      iconRegistry: awsIconRegistry,
    } as const;
  }
  if (hasExactEditorCatalogBinding(document, foundationEditorCatalog)) {
    return {
      capabilities: {},
      catalog: foundationEditorCatalog,
      iconRegistry: foundationIconRegistry,
    } as const;
  }
  return undefined;
}

function solutionCoverageLabel(revision: SolutionRevisionV1): string {
  switch (revision.summary.generationCoverage.state) {
    case "infrastructure-only":
      return "Infrastructure only";
    case "starter-application":
      return "Starter application coverage";
    case "complete-supported-pattern":
      return "Complete supported application pattern";
    case "ai-assisted-custom-validated":
      return "Validated custom application coverage";
    case "custom-implementation-required":
      return "Application generation requires custom work";
    case "target-unsupported":
      return "Application target unsupported";
  }
}

function DraftLoadFailure({
  error,
  identity,
}: {
  readonly error: unknown;
  readonly identity: AppShellIdentity;
}) {
  const mapped = mapApiError(error);
  return (
    <AppShell identity={identity}>
      <main id="main-content" tabIndex={-1}>
        <section
          className={
            mapped.sessionExpired
              ? "state-card state-card--permission"
              : "state-card state-card--warning"
          }
          role="alert"
        >
          <p className="status-label">
            {mapped.sessionExpired ? "Session expired" : "Draft unavailable"}
          </p>
          <h1>
            {mapped.sessionExpired
              ? "Your session expired"
              : "The project draft could not be loaded"}
          </h1>
          <p>{mapped.message}</p>
          {mapped.sessionExpired ? (
            <a className="button button--primary" href="/sign-in">
              Sign in again
            </a>
          ) : identity.organization === null ? null : (
            <AppLink
              className="button button--secondary"
              to={`/organizations/${encodeURIComponent(identity.organization.id)}/projects`}
            >
              Return to projects
            </AppLink>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function ReadOnlyServerDraft({
  head,
  identity,
  leaseNotice,
  lastObservedLeaseExpiry,
  onTryEditing,
  recoveryActions,
  project,
}: {
  readonly head: ServerDraftHead;
  readonly identity: AppShellIdentity;
  readonly leaseNotice?: string;
  readonly lastObservedLeaseExpiry?: string;
  readonly onTryEditing?: () => void;
  readonly recoveryActions?: ReactNode;
  readonly project: ProjectV1;
}) {
  useEffect(() => {
    globalThis.document.title = `${project.name} · Read-only project`;
  }, [project.name]);
  const document = parseArchitectureDocument(head.draft.architectureDocument);
  const coverage =
    document.workloadBehavior.workloads.length === 0
      ? "Infrastructure only"
      : "Application workload contract present";
  const projectPath =
    "/organizations/" +
    encodeURIComponent(project.organizationId) +
    "/projects/" +
    encodeURIComponent(project.id);

  return (
    <AppShell identity={identity}>
      <main className="editor-project-access" id="main-content" tabIndex={-1}>
        <section className="state-card editor-project-access__card">
          <p className="status-label">Read-only project</p>
          <h1>{project.name}</h1>
          {leaseNotice === undefined ? null : (
            <p role="status">{leaseNotice}</p>
          )}
          {lastObservedLeaseExpiry === undefined ? null : (
            <p>
              Last observed reservation expiry:{" "}
              <time dateTime={lastObservedLeaseExpiry}>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "long",
                }).format(new Date(lastObservedLeaseExpiry))}
              </time>
            </p>
          )}
          {recoveryActions}
          <p>
            You can inspect server metadata and immutable Solution Revisions,
            but you cannot change or autosave this draft.
          </p>
          <details className="page-info-disclosure">
            <summary>Saved resources and connections</summary>
            <p>
              This is a saved draft summary, not a live collaborative canvas.
            </p>
            {document.nodes.length === 0 ? (
              <p>No resources in this saved draft.</p>
            ) : (
              <ul>
                {document.nodes.map((node) => (
                  <li key={node.id}>
                    {node.presentation.label} · {node.semantic.resourceType}
                  </li>
                ))}
              </ul>
            )}
            {document.edges.length === 0 ? (
              <p>No connections in this saved draft.</p>
            ) : (
              <ul>
                {document.edges.map((edge) => (
                  <li key={edge.id}>
                    {document.nodes.find(
                      (node) => node.id === edge.semantic.source.nodeId,
                    )?.presentation.label ?? edge.semantic.source.nodeId}
                    {" → "}
                    {document.nodes.find(
                      (node) => node.id === edge.semantic.target.nodeId,
                    )?.presentation.label ?? edge.semantic.target.nodeId}
                    {" · "}
                    {edge.semantic.relationshipType}
                  </li>
                ))}
              </ul>
            )}
          </details>
          <details className="page-info-disclosure">
            <summary>Saved draft details</summary>
            <dl className="project-status-list">
              <div>
                <dt>Draft version</dt>
                <dd>{head.draft.version}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{head.draft.updatedAt}</dd>
              </div>
              <div>
                <dt>Coverage</dt>
                <dd>{coverage}</dd>
              </div>
              <div>
                <dt>Semantic digest</dt>
                <dd>{head.draft.semanticDigest ?? head.draft.contentDigest}</dd>
              </div>
            </dl>
          </details>
          <div className="editor-project-access__actions">
            <AppLink
              className="button button--secondary"
              to={projectPath + "/revisions"}
            >
              View Solution Revisions
            </AppLink>
            {onTryEditing === undefined ? null : (
              <button
                className="button button--secondary"
                onClick={onTryEditing}
                type="button"
              >
                Try editing
              </button>
            )}
            <AppLink
              className="button button--secondary"
              to={`/organizations/${encodeURIComponent(project.organizationId)}/projects`}
            >
              Return to projects
            </AppLink>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function CatalogRecoveryActions({
  opening,
  original,
  onApply,
}: {
  readonly opening: EditorCatalogOpening;
  readonly original: ArchitectureDocument;
  readonly onApply: () => void;
}) {
  const [downloadState, setDownloadState] = useState("");
  return (
    <section aria-label="Catalog compatibility review" role="alert">
      <h2>Review this project&apos;s catalog compatibility</h2>
      <p>
        Your saved resources, configuration and connections are preserved.
        Editing and new exports wait until the differences below are resolved.
        Download the original before reviewing a schema migration or
        replacement.
      </p>
      <ul>
        {opening.issues.map((issue, index) => (
          <li key={String(index)}>
            <code>{issue.path}</code>: {issue.message}
          </li>
        ))}
      </ul>
      <button
        className="button button--secondary"
        type="button"
        onClick={() => {
          try {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(original, null, 2)], {
                type: "application/json",
              }),
            );
            const anchor = globalThis.document.createElement("a");
            anchor.href = url;
            anchor.download = "cloudmarkup-original-project.json";
            globalThis.document.body.append(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => {
              URL.revokeObjectURL(url);
            }, 1000);
            setDownloadState(
              "Original project download prepared. Check your downloads before closing this tab.",
            );
          } catch {
            setDownloadState(
              "The download could not start. Keep this tab open and try again.",
            );
          }
        }}
      >
        Download original project
      </button>
      {opening.status === "review-required" ? (
        <>
          <p>
            This adaptation updates only the catalog and configuration schema
            versions listed above. It retains all saved values, resource IDs,
            placement and connections. Review the service changes before
            applying; normal validation still runs before export.
          </p>
          <button
            className="button button--primary"
            type="button"
            onClick={onApply}
          >
            Apply reviewed catalog adaptation
          </button>
        </>
      ) : (
        <p>
          A removed service, field or connection needs an explicit migration
          that maps the saved meaning to a supported definition. Keep this
          original project and share these issue paths with support; do not
          recreate or delete resources to bypass validation.
        </p>
      )}
      {downloadState === "" ? null : <p role="status">{downloadState}</p>}
    </section>
  );
}

function BackendEditorRoute({
  organizationId,
  principal,
  projectId,
  shellIdentity,
}: Required<
  Pick<
    EditorRouteProps,
    "organizationId" | "principal" | "projectId" | "shellIdentity"
  >
>) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const projectKey = cloudMarkupQueryKeys.project(
    principal.id,
    organizationId,
    projectId,
  );
  const draftKey = cloudMarkupQueryKeys.draft(
    principal.id,
    organizationId,
    projectId,
  );
  const projectQuery = useQuery({
    enabled: runtime !== null,
    queryFn: async ({ signal }) => {
      if (runtime === null) {
        throw new Error("The CloudMarkup API client is unavailable.");
      }
      const response = await runtime.client.requestWithMetadata(
        "projects.get",
        {
          path: { projectId },
        },
      );
      const project = response.data.data;
      assertServerResponseBinding(
        project.id === projectId && project.organizationId === organizationId,
      );
      if (signal.aborted) throw new Error("The project read was superseded.");
      // ProjectOverviewPage shares this key and uses the ETag for lifecycle
      // mutations, so every producer must cache the same snapshot shape.
      return { etag: response.metadata.etag, project };
    },
    queryKey: projectKey,
  });
  const projectIsClosed =
    projectQuery.data?.project.lifecycleStatus === "deleted" ||
    projectQuery.data?.project.lifecycleStatus === "deletion-pending";
  const draftQuery = useQuery({
    enabled: runtime !== null && projectQuery.isSuccess && !projectIsClosed,
    // Each editor mount must verify its server head. A cached snapshot can
    // predate an in-flight save from a previous visit to this workspace.
    refetchOnMount: "always",
    queryFn: async ({ signal }): Promise<ServerDraftHead> => {
      if (runtime === null) {
        throw new Error("The CloudMarkup API client is unavailable.");
      }
      const response = await runtime.client.requestWithMetadata("drafts.get", {
        path: { projectId },
      });
      assertServerResponseBinding(response.data.data.projectId === projectId);
      if (signal.aborted) throw new Error("The draft read was superseded.");
      return {
        draft: response.data.data,
        etag: response.metadata.etag,
      };
    },
    queryKey: draftKey,
  });
  const canRequestEditing =
    projectQuery.isSuccess &&
    projectQuery.data.project.lifecycleStatus === "active" &&
    hasCapability(principal, organizationId, "projects.mutate");
  const currentDraftId = projectQuery.data?.project.currentDraft.id;
  const readLeaseHead = useCallback(async (): Promise<ServerDraftHead> => {
    if (runtime === null) throw new Error("The API client is unavailable.");
    const response = await runtime.client.requestWithMetadata("drafts.get", {
      path: { projectId },
    });
    assertServerResponseBinding(
      response.data.data.projectId === projectId &&
        response.data.data.id === currentDraftId,
    );
    return { draft: response.data.data, etag: response.metadata.etag };
  }, [currentDraftId, projectId, runtime]);
  const editingLease = useProjectEditingLease({
    client: runtime?.client ?? null,
    enabled: canRequestEditing,
    projectId,
    readHead: readLeaseHead,
  });
  const lastOwnedLease = editingLease.retained;
  const { isError: draftReadFailed, refetch: refetchDraft } = draftQuery;
  const { isError: projectReadFailed, refetch: refetchProject } = projectQuery;
  const retryLease = editingLease.retry;
  const retryEditing = useCallback(() => {
    void (async () => {
      if (draftReadFailed) {
        const refreshed = await refetchDraft();
        if (!refreshed.isSuccess) return;
      }
      if (projectReadFailed) {
        // Successful current authority revalidation re-enables acquisition;
        // never clear a failed authorization/read state based on an old head.
        await refetchProject();
        return;
      }
      retryLease();
    })();
  }, [
    draftReadFailed,
    refetchDraft,
    projectReadFailed,
    refetchProject,
    retryLease,
  ]);

  if (runtime === null) {
    return (
      <DraftLoadFailure
        error={new TypeError("The API client is unavailable.")}
        identity={shellIdentity}
      />
    );
  }
  // Keep an already-authorized local session mounted for download-only recovery.
  // A closed project must still fail closed on its first open.
  if (
    projectQuery.isSuccess &&
    projectIsClosed &&
    lastOwnedLease === null &&
    editingLease.status !== "owned"
  ) {
    return (
      <AppShell identity={shellIdentity}>
        <main id="main-content" tabIndex={-1}>
          <section className="state-card" role="status">
            <p className="status-label">Project closed</p>
            <h1>{projectQuery.data.project.name}</h1>
            <p>
              This project is closed and its draft cannot be opened for editing.
            </p>
            <AppLink
              className="button button--secondary"
              to={`/organizations/${encodeURIComponent(organizationId)}/projects`}
            >
              Return to projects
            </AppLink>
          </section>
        </main>
      </AppShell>
    );
  }
  if (
    projectQuery.isPending ||
    (!projectQuery.isError &&
      (draftQuery.isPending || !draftQuery.isFetchedAfterMount))
  ) {
    return (
      <AppShell identity={shellIdentity} loadingWorkspace>
        <RouteLoadingIndicator />
      </AppShell>
    );
  }
  const loadError = projectQuery.error ?? draftQuery.error;
  if (
    loadError !== null &&
    lastOwnedLease === null &&
    editingLease.status !== "owned"
  ) {
    return <DraftLoadFailure error={loadError} identity={shellIdentity} />;
  }

  const project = projectQuery.data?.project;
  const head = draftQuery.data;
  if (project === undefined || head === undefined) {
    return (
      <DraftLoadFailure
        error={new Error("The server returned no project draft.")}
        identity={shellIdentity}
      />
    );
  }
  if (
    project.organizationId !== organizationId ||
    head.draft.projectId !== project.id ||
    head.draft.id !== project.currentDraft.id
  ) {
    return (
      <DraftLoadFailure
        error={new Error("The project binding is inconsistent.")}
        identity={shellIdentity}
      />
    );
  }

  const retainedLease =
    editingLease.status === "owned" ? editingLease : lastOwnedLease;
  if (
    retainedLease === null &&
    canRequestEditing &&
    editingLease.status === "checking"
  ) {
    return (
      <AppShell identity={shellIdentity} loadingWorkspace>
        <RouteLoadingIndicator />
      </AppShell>
    );
  }
  if (retainedLease === null) {
    return (
      <ReadOnlyServerDraft
        head={head}
        identity={shellIdentity}
        {...(!canRequestEditing
          ? {}
          : {
              leaseNotice:
                editingLease.status === "held"
                  ? "Editing access was reserved when last checked. If you just reloaded or closed another editor, wait briefly, then choose Try editing to check again."
                  : editingLease.status === "lost"
                    ? "Editing paused because access could not be renewed. Unsaved changes remain separate in local recovery when available."
                    : "Editing is temporarily unavailable. You can still review the saved draft.",
              onTryEditing: retryEditing,
              ...(editingLease.status === "held"
                ? {
                    lastObservedLeaseExpiry: editingLease.lastObservedExpiresAt,
                  }
                : {}),
            })}
        project={project}
      />
    );
  }

  return (
    <BackendEditorSession
      key={`${principal.id}:${organizationId}:${project.id}:${head.draft.id}`}
      draftKey={draftKey}
      editingPaused={
        loadError !== null ||
        !canRequestEditing ||
        editingLease.status !== "owned"
      }
      getEditingLease={editingLease.getProof}
      initialHead={retainedLease.head}
      leaseId={retainedLease.leaseId}
      onTryEditing={retryEditing}
      organizationId={organizationId}
      principal={principal}
      project={project}
      releaseEditingLease={editingLease.release}
      shellIdentity={shellIdentity}
    />
  );
}

function BackendEditorSession({
  draftKey,
  editingPaused,
  getEditingLease,
  initialHead,
  leaseId,
  onTryEditing,
  organizationId,
  principal,
  project,
  releaseEditingLease,
  shellIdentity,
}: {
  readonly draftKey: ReturnType<typeof cloudMarkupQueryKeys.draft>;
  readonly editingPaused: boolean;
  readonly getEditingLease: () => ProjectEditingLeaseProofV1 | null;
  readonly initialHead: ServerDraftHead;
  readonly leaseId: string;
  readonly onTryEditing: () => void;
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly project: ProjectV1;
  readonly releaseEditingLease: () => Promise<void>;
  readonly shellIdentity: AppShellIdentity;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const navigate = useNavigate();
  const [runtimeIdentity] = useState(createEditorRuntimeIdentity);
  const [createId] = useState(() =>
    createEditorCommandIdFactory(runtimeIdentity.commandIdPrefix),
  );
  const [recoveryStore] = useState(createBrowserRecoveryStore);
  const recoveryStoreLifecycle = useRef(0);
  const [mountedDocument, setMountedDocument] = useState<ArchitectureDocument>(
    () => parseArchitectureDocument(initialHead.draft.architectureDocument),
  );
  const catalogOpening = useMemo<EditorCatalogOpening>(() => {
    if (
      hasExactEditorCatalogBinding(mountedDocument, foundationEditorCatalog)
    ) {
      return { status: "current", document: mountedDocument, issues: [] };
    }
    return prepareEditorCatalogOpening(mountedDocument, awsEditorCatalog);
  }, [mountedDocument]);
  const [mountGeneration, setMountGeneration] = useState(1);
  const [head, setHead] = useState(initialHead);
  const headReference = useRef(initialHead);
  const acceptedIntent = useAcceptedIntentSelection({
    principalId: principal.id,
    organizationId,
    projectId: project.id,
    draftId: head.draft.id,
    draftVersion: head.draft.version,
  });
  const intentSelectionKey =
    acceptedIntent.kind === "ready"
      ? acceptedIntent.record.acceptedIntentId
      : acceptedIntent.kind;
  const intentSelectionReference = useRef(intentSelectionKey);
  useLayoutEffect(() => {
    intentSelectionReference.current = intentSelectionKey;
  }, [intentSelectionKey]);
  const [acceptedLeaseId, setAcceptedLeaseId] = useState(leaseId);
  const needsFreshHeadReview = leaseId !== acceptedLeaseId;
  const editsPaused = editingPaused || needsFreshHeadReview;
  const editingAllowed = useRef(!editsPaused);
  useLayoutEffect(() => {
    editingAllowed.current = !editsPaused;
    return () => {
      editingAllowed.current = false;
    };
  }, [editsPaused]);
  useEffect(() => {
    // Explicit retry may resume the still-mounted local document only when
    // the newly fetched server head is exactly its existing save base.
    if (
      !editingPaused &&
      needsFreshHeadReview &&
      initialHead.etag === headReference.current.etag
    )
      setAcceptedLeaseId(leaseId);
  }, [editingPaused, initialHead.etag, leaseId, needsFreshHeadReview]);
  const saveTimerReference = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeScope = useRef(false);
  const [saveDrain] = useState(() =>
    createLatestSaveDrain<ArchitectureDocument, ServerDraftHead>(),
  );
  const blockedReference = useRef(false);
  const queuedChangeVersion = useRef(0);
  const acceptingRepository = useRef(false);
  const [repositoryAcceptanceBusy, setRepositoryAcceptanceBusy] =
    useState(false);
  const repositoryAttempt = useRef<{
    readonly request: RepositoryGraphAcceptanceRequest;
    readonly head: ServerDraftHead;
    readonly localVersion: number;
  } | null>(null);
  const [storedSaveState, setSaveState] = useState<ServerSaveState>({
    message:
      "Saved · server draft version " + String(initialHead.draft.version),
    status: "saved",
  });
  // A request from a lost epoch cannot acknowledge the local document. Keep
  // its visible state unsaved even after explicit acquisition of a new lease.
  const saveState: ServerSaveState =
    storedSaveState.status === "saving" &&
    (editsPaused || storedSaveState.editingLeaseId !== leaseId)
      ? {
          status: "queued",
          message: "Unsaved local changes · editing access was interrupted.",
        }
      : storedSaveState;
  useEffect(() => {
    if (!editsPaused) return;
    if (saveTimerReference.current !== null)
      clearTimeout(saveTimerReference.current);
  }, [editsPaused]);
  const [revision, setRevision] = useState<SolutionRevisionV1 | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionAttempt] = useState(() =>
    createImmutableAttemptCoordinator<PendingSolutionRevisionAttempt>(),
  );
  const copyKeyReference = useRef<string | null>(null);
  const invalidateDraftSnapshot = useCallback(() => {
    void runtime?.queryClient.invalidateQueries({
      exact: true,
      queryKey: cloudMarkupQueryKeys.draft(
        principal.id,
        organizationId,
        project.id,
      ),
      refetchType: "none",
    });
  }, [organizationId, principal.id, project.id, runtime]);

  useEffect(
    () => () => {
      invalidateDraftSnapshot();
    },
    [invalidateDraftSnapshot],
  );

  useEffect(() => {
    recoveryStoreLifecycle.current += 1;
    const generation = recoveryStoreLifecycle.current;
    return () => {
      queueMicrotask(() => {
        if (recoveryStoreLifecycle.current === generation) {
          recoveryStore?.close();
        }
      });
    };
  }, [recoveryStore]);

  useEffect(() => {
    activeScope.current = true;
    blockedReference.current = false;
    return () => {
      activeScope.current = false;
      blockedReference.current = true;
      if (saveTimerReference.current !== null) {
        clearTimeout(saveTimerReference.current);
      }
    };
  }, []);

  const applySuccessfulHead = useCallback(
    (nextHead: ServerDraftHead) => {
      if (!isEditorScopeActive(activeScope)) return;
      headReference.current = nextHead;
      setHead(nextHead);
      setMountedDocument(
        parseArchitectureDocument(nextHead.draft.architectureDocument),
      );
      runtime?.queryClient.setQueryData(draftKey, nextHead);
      setSaveState({
        message:
          "Saved · server draft version " + String(nextHead.draft.version),
        status: "saved",
      });
    },
    [draftKey, runtime],
  );

  const performSave = useCallback(
    async (document: ArchitectureDocument): Promise<ServerDraftHead | null> => {
      const editingLease = getEditingLease();
      if (
        runtime === null ||
        !editingAllowed.current ||
        editingLease === null ||
        blockedReference.current ||
        !isEditorScopeActive(activeScope)
      ) {
        return null;
      }
      setSaveState({
        editingLeaseId: editingLease.leaseId,
        message: "Saving Architecture and Workload Documents...",
        status: "saving",
      });
      try {
        const response = await runtime.client.requestWithMetadata(
          "drafts.save",
          {
            body: {
              architectureDocument: document,
              contractVersion: 1,
              editingLease,
            },
            headers: { "if-match": headReference.current.etag },
            path: { projectId: project.id },
          },
        );
        if (
          !isEditorScopeActive(activeScope) ||
          !isEditorScopeActive(editingAllowed) ||
          getEditingLease()?.leaseId !== editingLease.leaseId ||
          getEditingLease()?.token !== editingLease.token
        ) {
          invalidateDraftSnapshot();
          return null;
        }
        const nextHead: ServerDraftHead = {
          draft: response.data.data,
          etag: response.metadata.etag,
        };
        assertServerResponseBinding(
          nextHead.draft.projectId === project.id &&
            nextHead.draft.id === headReference.current.draft.id,
        );
        applySuccessfulHead(nextHead);
        return nextHead;
      } catch (error) {
        if (
          !isEditorScopeActive(activeScope) ||
          !isEditorScopeActive(editingAllowed) ||
          getEditingLease()?.leaseId !== editingLease.leaseId ||
          getEditingLease()?.token !== editingLease.token
        ) {
          invalidateDraftSnapshot();
          return null;
        }
        blockedReference.current = true;
        const mapped = mapApiError(error);
        if (isApiErrorCode(error, "precondition_failed")) {
          const conflict =
            error instanceof ApiClientError
              ? error.envelope.error.conflict
              : undefined;
          setSaveState({
            ...(conflict === undefined ? {} : { conflict }),
            message:
              "Save conflict · the server draft is newer. Reload, compare, or save as copy.",
            status: "conflict",
          });
        } else if (mapped.sessionExpired) {
          runtime.expireSession();
          setSaveState({
            message: "Your session expired. Local recovery remains separate.",
            status: "session-expired",
          });
        } else if (mapped.code === "network_unavailable") {
          setSaveState({
            message:
              "Offline recovery · the server was not changed. A validated browser checkpoint is kept when available.",
            status: "offline",
          });
        } else {
          setSaveState({
            message: "Save failed · " + mapped.message,
            status: "error",
          });
        }
        return null;
      }
    },
    [
      applySuccessfulHead,
      getEditingLease,
      invalidateDraftSnapshot,
      project.id,
      runtime,
    ],
  );

  const flushPending = useCallback(
    async (
      explicitDocument?: ArchitectureDocument,
    ): Promise<ServerDraftHead | null> => {
      if (explicitDocument !== undefined) saveDrain.queue(explicitDocument);
      if (saveTimerReference.current !== null) {
        clearTimeout(saveTimerReference.current);
        saveTimerReference.current = null;
      }
      return saveDrain.flush({
        currentHead: () => headReference.current,
        isBlocked: () => blockedReference.current,
        save: performSave,
      });
    },
    [performSave, saveDrain],
  );

  const queueSave = useCallback(
    (document: ArchitectureDocument) => {
      queuedChangeVersion.current += 1;
      saveDrain.queue(document);
      if (!blockedReference.current && isEditorScopeActive(activeScope)) {
        setSaveState({
          message: "Unsaved local changes",
          status: "queued",
        });
      }
      if (
        blockedReference.current ||
        !editingAllowed.current ||
        getEditingLease() === null
      ) {
        return;
      }
      if (saveTimerReference.current !== null) {
        clearTimeout(saveTimerReference.current);
      }
      saveTimerReference.current = setTimeout(() => {
        saveTimerReference.current = null;
        void flushPending();
      }, 700);
    },
    [flushPending, getEditingLease, saveDrain],
  );

  const acceptRepositoryGraph = useCallback<AcceptRepositoryGraph>(
    async (request) => {
      if (
        runtime === null ||
        acceptingRepository.current ||
        !isEditorScopeActive(editingAllowed) ||
        !isEditorScopeActive(activeScope)
      )
        throw new Error(
          "Editing access is required before accepting repository changes.",
        );
      acceptingRepository.current = true;
      setRepositoryAcceptanceBusy(true);
      try {
        let attempt = repositoryAttempt.current;
        if (
          attempt !== null &&
          (attempt.request.idempotencyKey !== request.idempotencyKey ||
            JSON.stringify(attempt.request) !== JSON.stringify(request))
        )
          throw new Error(
            "Retry the pending repository review or reload the saved design first.",
          );
        if (attempt === null) {
          const saved = await flushPending();
          if (
            saved === null ||
            !isEditorScopeActive(activeScope) ||
            !isEditorScopeActive(editingAllowed)
          )
            throw new Error(
              "Save the current design before accepting repository changes.",
            );
          attempt = {
            request: structuredClone(request),
            head: saved,
            localVersion: queuedChangeVersion.current,
          };
          repositoryAttempt.current = attempt;
        }
        blockedReference.current = true;
        const editingLease = getEditingLease();
        if (
          editingLease === null ||
          queuedChangeVersion.current !== attempt.localVersion
        )
          throw new Error(
            "Local changes or editing access changed. Reload the saved design before accepting this review.",
          );
        const assertCurrent = () => {
          if (
            !isEditorScopeActive(activeScope) ||
            !isEditorScopeActive(editingAllowed) ||
            getEditingLease()?.leaseId !== editingLease.leaseId ||
            getEditingLease()?.token !== editingLease.token ||
            queuedChangeVersion.current !== attempt.localVersion
          )
            throw new Error(
              "Editing changed while the review was running. Reload the saved design to see its outcome.",
            );
        };
        const response = await runtime.client.request(
          "github-repository-import-reviews.create",
          {
            body: {
              ...attempt.request.input,
              draftAcceptance: {
                expectedDraftEtag: attempt.head.etag,
                editingLease,
              },
            },
            headers: { "idempotency-key": attempt.request.idempotencyKey },
            path: { projectId: project.id, importId: attempt.request.importId },
          },
        );
        assertCurrent();
        assertServerResponseBinding(
          response.data.importId === attempt.request.importId &&
            response.data.operationId === attempt.request.input.operationId &&
            response.data.decision === "accept-into-design" &&
            response.data.designChanged,
        );
        const latest = await runtime.client.requestWithMetadata("drafts.get", {
          path: { projectId: project.id },
        });
        assertCurrent();
        const nextHead: ServerDraftHead = {
          draft: latest.data.data,
          etag: latest.metadata.etag,
        };
        assertServerResponseBinding(
          nextHead.draft.projectId === project.id &&
            nextHead.draft.id === attempt.head.draft.id &&
            nextHead.draft.version > attempt.head.draft.version,
        );
        saveDrain.clearPending();
        blockedReference.current = false;
        repositoryAttempt.current = null;
        applySuccessfulHead(nextHead);
        setRevision(null);
        setMountGeneration((current) => current + 1);
        return response.data;
      } catch (error) {
        invalidateDraftSnapshot();
        if (isEditorScopeActive(activeScope)) {
          blockedReference.current = true;
          const mapped = mapApiError(error);
          if (mapped.sessionExpired) runtime.expireSession();
          setSaveState({
            status: "error",
            message:
              "Repository acceptance needs attention · " + mapped.message,
          });
        }
        throw error;
      } finally {
        acceptingRepository.current = false;
        if (isEditorScopeActive(activeScope))
          setRepositoryAcceptanceBusy(false);
      }
    },
    [
      applySuccessfulHead,
      flushPending,
      getEditingLease,
      invalidateDraftSnapshot,
      project.id,
      runtime,
      saveDrain,
    ],
  );

  const retrySave = useCallback(
    async (document: ArchitectureDocument) => {
      blockedReference.current = false;
      saveDrain.queue(document);
      return flushPending();
    },
    [flushPending, saveDrain],
  );

  const closeProject = useCallback(
    async (document: ArchitectureDocument) => {
      if (revisionBusy || !isEditorScopeActive(activeScope)) return;
      if (saveState.status !== "saved") {
        const saved = await flushPending(
          saveState.status === "saving" ? undefined : document,
        );
        if (saved === null || !isEditorScopeActive(activeScope)) return;
      }
      await releaseEditingLease();
      if (!isEditorScopeActive(activeScope)) return;
      navigate(`/organizations/${encodeURIComponent(organizationId)}/projects`);
    },
    [
      flushPending,
      navigate,
      organizationId,
      releaseEditingLease,
      revisionBusy,
      saveState.status,
    ],
  );

  const reloadServerDraft = useCallback(async () => {
    if (
      !window.confirm(
        "Load the latest saved draft? This replaces unsaved changes in this tab. Save a copy or download local recovery first if you need to keep them.",
      )
    ) {
      return;
    }
    if (runtime === null) {
      return;
    }
    try {
      const response = await runtime.client.requestWithMetadata("drafts.get", {
        path: { projectId: project.id },
      });
      if (!isEditorScopeActive(activeScope)) return;
      const nextHead: ServerDraftHead = {
        draft: response.data.data,
        etag: response.metadata.etag,
      };
      assertServerResponseBinding(
        nextHead.draft.projectId === project.id &&
          nextHead.draft.id === headReference.current.draft.id,
      );
      const nextDocument = parseArchitectureDocument(
        nextHead.draft.architectureDocument,
      );
      saveDrain.clearPending();
      repositoryAttempt.current = null;
      blockedReference.current = false;
      applySuccessfulHead(nextHead);
      setAcceptedLeaseId(leaseId);
      setMountedDocument(nextDocument);
      setMountGeneration((current) => current + 1);
    } catch (error) {
      if (!isEditorScopeActive(activeScope)) return;
      const mapped = mapApiError(error);
      if (mapped.sessionExpired) {
        runtime.expireSession();
      }
      setSaveState({
        message: "Reload failed · " + mapped.message,
        status: "error",
      });
    }
  }, [applySuccessfulHead, leaseId, project.id, runtime, saveDrain]);

  const saveAsCopy = useCallback(
    async (document: ArchitectureDocument) => {
      if (runtime === null) {
        return;
      }
      copyKeyReference.current ??= createBrowserMutationKey("draft-copy");
      try {
        const result = await runtime.client.request("projects.create", {
          body: {
            architectureDocument: document,
            creationMode: "draft-copy",
            name: (project.name.slice(0, 100) + " conflict copy").trim(),
          },
          headers: { "idempotency-key": copyKeyReference.current },
          path: { organizationId },
        });
        if (!isEditorScopeActive(activeScope)) return;
        assertServerResponseBinding(
          result.data.project.organizationId === organizationId,
        );
        copyKeyReference.current = null;
        await runtime.queryClient.invalidateQueries({
          queryKey: cloudMarkupQueryKeys.projects(principal.id, organizationId),
        });
        if (!isEditorScopeActive(activeScope)) return;
        navigate(
          "/organizations/" +
            encodeURIComponent(organizationId) +
            "/projects/" +
            encodeURIComponent(result.data.project.id) +
            "/editor",
        );
      } catch (error) {
        if (!isEditorScopeActive(activeScope)) return;
        const mapped = mapApiError(error);
        if (mapped.sessionExpired) {
          runtime.expireSession();
        }
        setSaveState({
          message: "Save as copy failed · " + mapped.message,
          status: "error",
        });
      }
    },
    [navigate, organizationId, principal.id, project.name, runtime],
  );

  const createSolutionRevision = useCallback(
    async (document: ArchitectureDocument) => {
      if (runtime === null) {
        return;
      }
      setRevisionBusy(true);
      setRevisionError(null);
      try {
        if (acceptedIntent.kind !== "none" && acceptedIntent.kind !== "ready") {
          setRevisionError(
            "Selected requirements are unavailable. Review the selection before creating a revision.",
          );
          return;
        }
        const attempt = await revisionAttempt.prepare(async () => {
          const exactHead = await retrySave(document);
          if (exactHead === null) return null;
          const body: CreateSolutionRevisionV1 = {
            contractVersion: 1,
            draftId: exactHead.draft.id,
            draftVersion: exactHead.draft.version,
            name: "Solution revision " + String(exactHead.draft.version),
            ...(acceptedIntent.kind === "ready"
              ? { acceptedIntentId: acceptedIntent.record.acceptedIntentId }
              : {}),
          };
          return {
            request: {
              body,
              headers: {
                "idempotency-key":
                  createBrowserMutationKey("solution-revision"),
                "if-match": exactHead.etag,
              },
              path: { projectId: project.id },
            },
            sourceDraftId: exactHead.draft.id,
            sourceDraftVersion: exactHead.draft.version,
          };
        });
        if (attempt === null || !isEditorScopeActive(activeScope)) return;
        if (
          intentSelectionReference.current !== intentSelectionKey ||
          (attempt.request.body.acceptedIntentId ?? "none") !==
            intentSelectionKey
        ) {
          setRevisionError(
            "The requirements selection changed. Abandon the pending revision attempt before creating a new one.",
          );
          return;
        }
        const result = await runtime.client.request(
          "solution-revisions.create",
          attempt.request,
        );
        if (!isEditorScopeActive(activeScope)) return;
        assertServerResponseBinding(
          result.data.summary.projectId === project.id &&
            result.data.revision.projectId === project.id &&
            result.data.summary.sourceDraftId === attempt.sourceDraftId &&
            result.data.summary.sourceDraftVersion ===
              attempt.sourceDraftVersion &&
            (acceptedIntent.kind === "ready"
              ? result.data.manifest.intent.state === "included" &&
                result.data.manifest.intent.id ===
                  acceptedIntent.record.acceptedIntentId &&
                result.data.manifest.intent.contentHash ===
                  acceptedIntent.record.intentDigest &&
                result.data.manifest.intent.version ===
                  acceptedIntent.record.contractVersion
              : result.data.manifest.intent.state === "not-applicable"),
        );
        revisionAttempt.complete(attempt);
        setRevision(result.data);
        await runtime.queryClient.invalidateQueries({
          queryKey: cloudMarkupQueryKeys.revisions(
            principal.id,
            organizationId,
            project.id,
          ),
        });
      } catch (error) {
        if (!isEditorScopeActive(activeScope)) return;
        const mapped = mapApiError(error);
        if (mapped.sessionExpired) {
          runtime.expireSession();
        }
        setRevisionError(mapped.message);
      } finally {
        if (isEditorScopeActive(activeScope)) setRevisionBusy(false);
      }
    },
    [
      organizationId,
      principal.id,
      project.id,
      retrySave,
      acceptedIntent,
      intentSelectionKey,
      revisionAttempt,
      runtime,
    ],
  );

  const abandonRevisionAttempt = useCallback(() => {
    if (revisionAttempt.abandon()) setRevisionError(null);
  }, [revisionAttempt]);

  const document = catalogOpening.document;
  const binding = serverEditorBinding(document);
  if (binding === undefined || catalogOpening.status === "review-required") {
    return (
      <ReadOnlyServerDraft
        head={head}
        identity={shellIdentity}
        project={project}
        recoveryActions={
          <CatalogRecoveryActions
            opening={catalogOpening}
            original={mountedDocument}
            onApply={() => {
              if (editsPaused || catalogOpening.status !== "review-required")
                return;
              setMountedDocument(catalogOpening.document);
              setMountGeneration((current) => current + 1);
              queueSave(catalogOpening.document);
            }}
          />
        }
      />
    );
  }

  const scopeKey = [
    "server-draft",
    principal.id,
    organizationId,
    project.id,
    head.draft.id,
    String(head.draft.version),
  ].join(":");

  return (
    <EditorSessionProvider
      catalog={binding.catalog}
      {...binding.capabilities}
      key={
        project.id + ":" + head.draft.id + ":mount-" + String(mountGeneration)
      }
      createId={createId}
      document={document}
      iconRegistry={binding.iconRegistry}
      layoutAdapter={editorLayoutAdapter}
      onDocumentChange={queueSave}
      preserveSessionOnRecoveryRebind
      recoveryCheckingFallback={<DevelopmentFixtureStatus serverBacked />}
      recoveryWriterId={runtimeIdentity.writerId}
      scopeKey={scopeKey}
      {...(recoveryStore === undefined ? {} : { recoveryStore })}
    >
      {editsPaused ? (
        <PausedProjectRecovery
          head={needsFreshHeadReview ? initialHead : head}
          identity={shellIdentity}
          project={project}
          onTryEditing={onTryEditing}
          onReload={
            needsFreshHeadReview && !editingPaused
              ? reloadServerDraft
              : undefined
          }
          onSaveAsCopy={saveAsCopy}
          error={saveState.status === "error" ? saveState.message : null}
        />
      ) : (
        <EditorStartContext.Provider value="server">
          {repositoryAcceptanceBusy ? (
            <p role="status">
              Saving and accepting the reviewed repository change…
            </p>
          ) : null}
          <div inert={repositoryAcceptanceBusy} style={{ display: "contents" }}>
            <EditorWorkspaceShell
              betaEditingAvailable={!editsPaused}
              {...(revision === null
                ? {}
                : {
                    conformanceBinding: {
                      approvedTopology: projectApprovedConformanceTopologyV1(
                        revision.revision.architectureDocument,
                      ),
                      organizationId,
                      principalId: principal.id,
                      projectId: project.id,
                      solutionRevisionId: revision.summary.solutionRevisionId,
                    },
                  })}
              projectId={project.id}
              repositoryWorkspace={
                hasCapability(
                  principal,
                  organizationId,
                  "integrations.read",
                ) ? (
                  <section
                    id="repository-import-workspace"
                    tabIndex={-1}
                    aria-label="Import infrastructure code"
                  >
                    <GitHubRepositoryWorkspace
                      architecture={document}
                      onAcceptIntoDesign={acceptRepositoryGraph}
                      firstRevisionAction={(onStarted) => (
                        <RepositoryImportFirstRevisionAction
                          onStarted={onStarted}
                          canCreateRevision={hasCapability(
                            principal,
                            organizationId,
                            "revisions.create",
                          )}
                          editingPaused={editsPaused}
                          onCreateRevision={createSolutionRevision}
                          revisionBusy={revisionBusy}
                          revisionError={revisionError}
                          saveState={saveState}
                        />
                      )}
                      organizationId={organizationId}
                      principal={principal}
                      projectId={project.id}
                    />
                  </section>
                ) : undefined
              }
              serverControls={
                <>
                  <EditorCreditBalance
                    principal={principal}
                    organizationId={organizationId}
                  />
                  <AppLink
                    className="button button--quiet"
                    to={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(project.id)}/revisions`}
                  >
                    Revisions and exports
                  </AppLink>
                  <BackendEditorControls
                    canCreateRevision={hasCapability(
                      principal,
                      organizationId,
                      "revisions.create",
                    )}
                    onCreateRevision={createSolutionRevision}
                    onCloseProject={closeProject}
                    onRetrySave={retrySave}
                    onSaveNow={flushPending}
                    revisionBusy={revisionBusy}
                    saveState={saveState}
                  />
                </>
              }
              catalogNotice={
                binding.catalog === foundationEditorCatalog ? (
                  <section
                    className="state-card state-card--warning"
                    role="alert"
                  >
                    <h2>This project uses the early example catalog</h2>
                    <p>
                      Its sample resources cannot generate AWS infrastructure.
                      Create an AWS project to use Lambda, API Gateway, DynamoDB
                      and the other supported services. Your existing draft
                      stays saved.
                    </p>
                    <AppLink
                      to={`/organizations/${encodeURIComponent(organizationId)}/projects/new`}
                    >
                      Create an AWS project
                    </AppLink>
                  </section>
                ) : null
              }
              serverNotice={
                <>
                  {catalogOpening.status === "compatible" ? (
                    <p role="status">
                      Opened with the latest catalog. Saved resources,
                      configuration and connections are unchanged. The catalog
                      binding will be saved with your next edit or save; export
                      still requires normal validation.
                    </p>
                  ) : null}
                  {acceptedIntent.kind ===
                  "none" ? null : acceptedIntent.kind === "ready" ? (
                    <section aria-label="Selected requirements">
                      <p>
                        Requirements selected for the next revision:{" "}
                        {
                          acceptedIntent.record.intentDocument.application
                            .summary
                        }
                      </p>
                      <AppLink
                        to={
                          "/organizations/" +
                          encodeURIComponent(organizationId) +
                          "/projects/" +
                          encodeURIComponent(project.id) +
                          "/intent?acceptedIntent=" +
                          encodeURIComponent(
                            acceptedIntent.record.acceptedIntentId,
                          )
                        }
                      >
                        Review selected requirements
                      </AppLink>
                    </section>
                  ) : (
                    <p role="status">
                      {acceptedIntent.kind === "loading"
                        ? "Loading selected requirements…"
                        : "Selected requirements are unavailable. Return to the saved requirements to review the selection."}
                    </p>
                  )}
                  <BackendEditorNotice
                    head={head}
                    onAbandonRevisionAttempt={abandonRevisionAttempt}
                    onReload={reloadServerDraft}
                    onSaveAsCopy={saveAsCopy}
                    revision={revision}
                    revisionError={revisionError}
                    saveState={saveState}
                    organizationId={organizationId}
                    projectId={project.id}
                  />
                </>
              }
              shellIdentity={shellIdentity}
            />
          </div>
        </EditorStartContext.Provider>
      )}
    </EditorSessionProvider>
  );
}

function PausedProjectRecovery({
  error,
  head,
  identity,
  project,
  onTryEditing,
  onReload,
  onSaveAsCopy,
}: {
  readonly error: string | null;
  readonly head: ServerDraftHead;
  readonly identity: AppShellIdentity;
  readonly project: ProjectV1;
  readonly onTryEditing: () => void;
  readonly onReload: (() => Promise<void>) | undefined;
  readonly onSaveAsCopy: (document: ArchitectureDocument) => Promise<void>;
}) {
  const session = useEditorDocumentSession();
  const recovery = useEditorRecovery();
  const [downloaded, setDownloaded] = useState(false);
  const [copying, setCopying] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const projectIsClosed =
    project.lifecycleStatus === "deleted" ||
    project.lifecycleStatus === "deletion-pending";
  const download = () => {
    if (session.status !== "ready") return;
    try {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(session.document, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "cloudmarkup-recovery.json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      setDownloaded(true);
      setDownloadError(false);
    } catch {
      setDownloadError(true);
    }
  };
  return (
    <ReadOnlyServerDraft
      head={head}
      identity={identity}
      project={project}
      leaseNotice={
        projectIsClosed
          ? "This project is closed. Your local changes remain available for download only."
          : onReload === undefined
            ? "Editing paused. Your in-memory changes remain open here; they are not being saved to the shared project."
            : "The saved draft changed while this session was paused. Review or download your local copy before loading the latest saved draft."
      }
      {...(!projectIsClosed && onReload === undefined ? { onTryEditing } : {})}
      recoveryActions={
        <section
          className="editor-project-recovery"
          aria-label="Paused local recovery"
        >
          {error === null ? null : <p role="alert">{error}</p>}
          <p>
            {recovery.state.message} Keep this tab open until you have saved or
            downloaded the work you need.
          </p>
          {session.status === "ready" ? (
            <>
              <details>
                <summary>Unsaved local resources</summary>
                <ul>
                  {session.document.nodes.map((node) => (
                    <li key={node.id}>{node.presentation.label}</li>
                  ))}
                </ul>
              </details>
              <div className="editor-project-access__actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={download}
                >
                  Download local recovery
                </button>
                {projectIsClosed ? null : (
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={copying}
                    onClick={() => {
                      setCopying(true);
                      void onSaveAsCopy(session.document).finally(() => {
                        setCopying(false);
                      });
                    }}
                  >
                    Save local changes as a copy
                  </button>
                )}
              </div>
              {downloaded ? (
                <p role="status">
                  Local recovery download prepared. Check your downloads before
                  closing this tab.
                </p>
              ) : null}
              {downloadError ? (
                <p role="alert">
                  The download could not start. Keep this tab open and try
                  again.
                </p>
              ) : null}
            </>
          ) : null}
          {projectIsClosed || onReload === undefined ? null : (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                void onReload();
              }}
            >
              Load latest saved draft
            </button>
          )}
        </section>
      }
    />
  );
}

function RepositoryImportFirstRevisionAction({
  canCreateRevision,
  editingPaused,
  onStarted,
  onCreateRevision,
  revisionBusy,
  revisionError,
  saveState,
}: {
  readonly canCreateRevision: boolean;
  readonly editingPaused: boolean;
  readonly onStarted: () => void;
  readonly onCreateRevision: (document: ArchitectureDocument) => Promise<void>;
  readonly revisionBusy: boolean;
  readonly revisionError: string | null;
  readonly saveState: ServerSaveState;
}) {
  const session = useEditorDocumentSession();
  const blocked =
    editingPaused ||
    session.status !== "ready" ||
    saveState.status === "conflict" ||
    saveState.status === "session-expired";
  const failure =
    revisionError ??
    (["error", "conflict", "session-expired", "offline"].includes(
      saveState.status,
    )
      ? saveState.message
      : null);
  if (!canCreateRevision)
    return (
      <p>
        Ask a project editor with revision access to save the first revision.
      </p>
    );
  return (
    <div>
      <button
        className="button button--primary"
        type="button"
        disabled={blocked || revisionBusy}
        onClick={() => {
          if (!blocked && !revisionBusy) {
            onStarted();
            void onCreateRevision(session.document);
          }
        }}
      >
        {revisionBusy ? "Saving first revision…" : "Save first revision"}
      </button>
      {editingPaused ? (
        <p role="status">
          Restore editing access before saving the first revision.
        </p>
      ) : null}
      {failure === null ? null : <p role="alert">{failure}</p>}
    </div>
  );
}

function BackendEditorControls({
  canCreateRevision,
  onCloseProject,
  onCreateRevision,
  onRetrySave,
  onSaveNow,
  revisionBusy,
  saveState,
}: {
  readonly canCreateRevision: boolean;
  readonly onCloseProject: (document: ArchitectureDocument) => Promise<void>;
  readonly onCreateRevision: (document: ArchitectureDocument) => Promise<void>;
  readonly onRetrySave: (
    document: ArchitectureDocument,
  ) => Promise<ServerDraftHead | null>;
  readonly onSaveNow: (
    document?: ArchitectureDocument,
  ) => Promise<ServerDraftHead | null>;
  readonly revisionBusy: boolean;
  readonly saveState: ServerSaveState;
}) {
  const session = useEditorDocumentSession();
  const recovery = useEditorRecovery();
  const [saveDetailsOpen, setSaveDetailsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const saveBlocked =
    saveState.status === "conflict" ||
    saveState.status === "session-expired" ||
    session.status !== "ready";
  const saveLabels: Record<ServerSaveStatus, string> = {
    queued: "Unsaved changes",
    saving: "Saving",
    saved: "Saved",
    offline: "Offline recovery",
    conflict: "Save conflict",
    error: "Save failed",
    "session-expired": "Session expired",
  };
  const SaveIcon =
    saveState.status === "saved"
      ? Check
      : saveState.status === "queued" || saveState.status === "saving"
        ? CloudUpload
        : CircleAlert;

  return (
    <div className="editor-server-controls">
      <div
        aria-live="polite"
        className="editor-server-controls__status"
        role="status"
      >
        <span className="visually-hidden">{saveState.message}</span>
        <Popover
          className="editor-server-controls__save-details"
          label="Save and recovery status"
          onOpenChange={setSaveDetailsOpen}
          open={saveDetailsOpen}
          renderContent={(content) => createPortal(content, document.body)}
          trigger={
            <span className="editor-server-controls__save-label">
              <SaveIcon aria-hidden="true" size={14} />
              <span>{saveLabels[saveState.status]}</span>
              <Info aria-hidden="true" size={12} />
            </span>
          }
          triggerLabel="Open save and recovery status"
        >
          <div className="editor-save-details">
            <h2>Save and recovery</h2>
            <dl>
              <div>
                <dt>Server draft</dt>
                <dd>{saveState.message}</dd>
              </div>
              <div>
                <dt>Local recovery</dt>
                <dd>{recovery.state.message}</dd>
              </div>
            </dl>
            <p>Browser recovery is separate from the saved server draft.</p>
            <p>
              Only one session can edit this shared project. Closing it saves
              your changes and releases editing access for another member.
            </p>
            <button
              className="status-button"
              disabled={saveBlocked || closing}
              onClick={() => {
                if (session.status === "ready") {
                  void (saveState.status === "offline" ||
                  saveState.status === "error"
                    ? onRetrySave(session.document)
                    : onSaveNow(session.document));
                }
              }}
              type="button"
            >
              {saveState.status === "offline" || saveState.status === "error"
                ? "Retry save"
                : "Save now"}
            </button>
            <button
              className="status-button"
              disabled={saveBlocked || closing || revisionBusy}
              onClick={() => {
                if (session.status !== "ready") return;
                setClosing(true);
                void onCloseProject(session.document).finally(() => {
                  setClosing(false);
                });
              }}
              type="button"
            >
              {closing ? "Saving and closing…" : "Close project"}
            </button>
          </div>
        </Popover>
      </div>
      {canCreateRevision ? (
        <button
          aria-label={
            revisionBusy
              ? "Creating Solution Revision"
              : "Create Solution Revision"
          }
          className="status-button status-button--primary"
          id="create-solution-revision"
          disabled={saveBlocked || revisionBusy}
          onClick={() => {
            if (session.status === "ready") {
              void onCreateRevision(session.document);
            }
          }}
          type="button"
        >
          {revisionBusy ? "Creating revision…" : "Create revision"}
        </button>
      ) : null}
    </div>
  );
}

function BackendEditorNotice({
  head,
  onAbandonRevisionAttempt,
  onReload,
  onSaveAsCopy,
  organizationId,
  projectId,
  revision,
  revisionError,
  saveState,
}: {
  readonly head: ServerDraftHead;
  readonly onAbandonRevisionAttempt: () => void;
  readonly onReload: () => Promise<void>;
  readonly onSaveAsCopy: (document: ArchitectureDocument) => Promise<void>;
  readonly organizationId: string;
  readonly projectId: string;
  readonly revision: SolutionRevisionV1 | null;
  readonly revisionError: string | null;
  readonly saveState: ServerSaveState;
}) {
  const session = useEditorDocumentSession();
  const [compareOpen, setCompareOpen] = useState(false);
  const localHashes =
    session.status === "ready"
      ? getArchitectureDocumentHashes(session.document)
      : null;
  const revisionPath =
    "/organizations/" +
    encodeURIComponent(organizationId) +
    "/projects/" +
    encodeURIComponent(projectId) +
    "/revisions/";

  return (
    <>
      {saveState.status === "conflict" ? (
        <section className="editor-server-notice" role="alert">
          <p className="status-label">Save conflict</p>
          <h2>A newer server draft was not overwritten</h2>
          <p>{saveState.message}</p>
          <div className="form-actions">
            <button
              className="button button--secondary"
              onClick={() => {
                void onReload();
              }}
              type="button"
            >
              Reload server draft
            </button>
            <button
              className="button button--secondary"
              onClick={() => {
                setCompareOpen((current) => !current);
              }}
              type="button"
            >
              Compare versions
            </button>
            <button
              className="button button--primary"
              disabled={session.status !== "ready"}
              onClick={() => {
                if (session.status === "ready") {
                  void onSaveAsCopy(session.document);
                }
              }}
              type="button"
            >
              Save as copy
            </button>
          </div>
          {compareOpen ? (
            <dl className="project-status-list">
              <div>
                <dt>Loaded server version</dt>
                <dd>{head.draft.version}</dd>
              </div>
              <div>
                <dt>Current server version</dt>
                <dd>{saveState.conflict?.current.version ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Current server updated</dt>
                <dd>{saveState.conflict?.current.updatedAt ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Local semantic digest</dt>
                <dd>{localHashes?.contentHash ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Current server semantic digest</dt>
                <dd>
                  {saveState.conflict?.current.semanticDigest ??
                    saveState.conflict?.current.contentDigest ??
                    "Unavailable"}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
      {saveState.status === "session-expired" ? (
        <section className="editor-server-notice" role="alert">
          <h2>Your session expired</h2>
          <p>
            The server was not changed. Local recovery remains separate and
            cannot establish authorization.
          </p>
          <a className="button button--primary" href="/sign-in">
            Sign in again
          </a>
        </section>
      ) : null}
      {revisionError === null ? null : (
        <section className="editor-server-notice" role="alert">
          <h2>Solution Revision was not created</h2>
          <p>{revisionError}</p>
          <p>
            Retry creation to replay the exact draft request, or abandon that
            retry before starting from a newer draft.
          </p>
          <button
            className="button button--secondary"
            onClick={onAbandonRevisionAttempt}
            type="button"
          >
            Abandon revision retry
          </button>
        </section>
      )}
      {revision === null ? null : (
        <section className="editor-server-notice" role="status">
          <p className="status-label">Immutable Solution Revision created</p>
          <h2>{solutionCoverageLabel(revision)}</h2>
          <p>
            Draft version {revision.summary.sourceDraftVersion} is bound to
            exact Architecture, Workload, contract, assumption, and coverage
            evidence.
          </p>
          <AppLink
            className="button button--secondary"
            to={
              revisionPath +
              encodeURIComponent(revision.summary.solutionRevisionId)
            }
          >
            Open read-only Solution Revision
          </AppLink>
        </section>
      )}
    </>
  );
}

export function EditorRoute(props: EditorRouteProps) {
  const locationSearch =
    typeof window === "undefined" ? "" : window.location.search;
  const explicitFixture =
    import.meta.env.DEV &&
    new URLSearchParams(locationSearch).get("fixture") !== null;
  if (
    props.organizationId === undefined ||
    props.principal === undefined ||
    props.shellIdentity === undefined ||
    explicitFixture
  ) {
    return <FixtureEditorRoute {...props} />;
  }

  return (
    <BackendEditorRoute
      key={`${props.principal.id}:${props.organizationId}:${props.projectId}`}
      organizationId={props.organizationId}
      principal={props.principal}
      projectId={props.projectId}
      shellIdentity={props.shellIdentity}
    />
  );
}
