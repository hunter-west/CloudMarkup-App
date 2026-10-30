import { WorkspaceTour } from "../features/onboarding/WorkspaceTour.js";
import { AccountAvatar } from "../features/settings/AccountAvatar.js";
import { AccountMenu } from "./AccountMenu.js";
import { useNavigationPreference } from "./navigation-preference.js";
import {
  BrandLockup,
  Button,
  Drawer,
  IconButton,
  ModalDrawer,
  OverlayBoundaryProvider,
  ResizeHandle,
  StatusBadge,
  Tooltip,
  ToastViewport,
} from "@cloudmarkup/ui";
import {
  Building2,
  ChevronDown,
  CreditCard,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  BookOpen,
  Cable,
  CircleAlert,
  Code2,
  History,
  ListTree,
  Menu as MenuIcon,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  localMockIdentity,
  localMockProjects,
} from "../mock/local-mock-context.js";
import { useNotifications } from "../notifications/index.js";
import { ModeSwitch } from "../preferences/ModeSwitch.js";
import { useModePreference } from "../preferences/index.js";
import { AppLink, useRouteMatch } from "../routing/index.js";
import { useOnlineStatus } from "./online-status.js";
import { type ViewportPosture, useViewportDimensions } from "./viewport.js";
import {
  focusWorkspaceShellTarget,
  WorkspaceShellControllerContext,
  type WorkspaceInspectorTab,
  type WorkspacePanelTab,
  type WorkspaceShellController,
} from "./workspace-shell-context.js";

type Overlay =
  | "account"
  | "catalog"
  | "context"
  | "navigation"
  | "notifications"
  | "status"
  | "workspace"
  | null;

type DesktopShellFocusRegion =
  "catalog" | "context" | "main" | "navigation" | "status" | "workspace" | null;

const responsiveCatalogPanelId = "responsive-catalog-panel";
const responsiveInspectorPanelId = "responsive-inspector-panel";
const responsiveWorkspacePanelId = "responsive-bottom-workspace";
const responsiveRevisionPlaceholderId =
  "responsive-review-revision-entry-point";

function getDesktopShellFocusRegion(
  target: EventTarget,
): DesktopShellFocusRegion {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const declaredRegion = target
    .closest<HTMLElement>("[data-shell-focus-region]")
    ?.getAttribute("data-shell-focus-region");
  if (
    declaredRegion === "catalog" ||
    declaredRegion === "main" ||
    declaredRegion === "navigation" ||
    declaredRegion === "status" ||
    declaredRegion === "workspace"
  ) {
    return declaredRegion;
  }
  if (target.closest("#application-navigation") !== null) {
    return "navigation";
  }
  if (target.closest(`#catalog-panel, #${responsiveCatalogPanelId}`) !== null) {
    return "catalog";
  }
  if (
    target.closest(`#inspector-panel, #${responsiveInspectorPanelId}`) !== null
  ) {
    return "context";
  }
  if (
    target.closest(`#bottom-workspace, #${responsiveWorkspacePanelId}`) !== null
  ) {
    return "workspace";
  }
  if (target.closest("#main-content") !== null) {
    return "main";
  }

  const controlledPanelId =
    target.getAttribute("aria-controls") ??
    target
      .closest(".cm-resize-handle")
      ?.querySelector<HTMLElement>("[aria-controls]")
      ?.getAttribute("aria-controls");
  return controlledPanelId === "application-navigation"
    ? "navigation"
    : controlledPanelId === "catalog-panel" ||
        controlledPanelId === responsiveCatalogPanelId
      ? "catalog"
      : controlledPanelId === "inspector-panel" ||
          controlledPanelId === responsiveInspectorPanelId
        ? "context"
        : controlledPanelId === "bottom-workspace" ||
            controlledPanelId === responsiveWorkspacePanelId
          ? "workspace"
          : null;
}

export type InspectorTab = WorkspaceInspectorTab;
export type WorkspaceTab = WorkspacePanelTab;

interface WorkspaceLauncherItem<T extends string> {
  readonly description: string;
  readonly icon: LucideIcon;
  readonly id: T;
  readonly label: string;
}

const inspectorLauncherItems: readonly WorkspaceLauncherItem<InspectorTab>[] = [
  {
    description: "Browse every resource and relationship in a structured list.",
    icon: ListTree,
    id: "architecture",
    label: "Architecture",
  },
  {
    description: "Review and edit the currently selected element.",
    icon: Settings2,
    id: "configure",
    label: "Configure",
  },
  {
    description: "Review compatible relationships for the current selection.",
    icon: Cable,
    id: "connect",
    label: "Connect",
  },
  {
    description: "Read provider guidance for the current selection.",
    icon: BookOpen,
    id: "learn",
    label: "Learn",
  },
];

const workspaceLauncherItems: readonly WorkspaceLauncherItem<WorkspaceTab>[] = [
  {
    description: "Review proposals, questions, and guided work.",
    icon: Sparkles,
    id: "assistant",
    label: "Assistant",
  },
  {
    description: "Inspect current validation findings and next actions.",
    icon: CircleAlert,
    id: "issues",
    label: "Issues",
  },
  {
    description: "Review repository and generated code evidence.",
    icon: Code2,
    id: "code",
    label: "Code",
  },
  {
    description: "Review architecture and lifecycle activity.",
    icon: History,
    id: "activity",
    label: "Activity",
  },
];

const catalogDefaultWidth = 300;
const catalogMinimumWidth = 224;
const navigationDefaultWidth = 264;
const navigationMinimumWidth = 208;
const navigationMaximumWidth = 320;
const collapsedSideWidth = 72;
const desktopCanvasRecoverableWidth = 320;
const desktopOverlayInset = 12;
const inspectorLauncherWidth = 92;
const workspaceLauncherHeight = 48;

export interface WorkspaceRegions {
  readonly issueIndicator?: ReactNode;
  readonly header?: ReactNode;
  readonly bottom: (
    activeTab: WorkspaceTab,
    onActiveTabChange: (tab: WorkspaceTab) => void,
  ) => ReactNode;
  readonly catalog: ReactNode;
  readonly context: (
    activeTab: InspectorTab,
    onActiveTabChange: (tab: InspectorTab) => void,
  ) => ReactNode;
}

export interface AppShellIdentity {
  readonly actorId: string;
  readonly displayName: string;
  readonly kind: "local-mock" | "verified";
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly kind?: "personal" | "organization" | "unavailable";
    readonly capabilities?: readonly string[];
  } | null;
}

export interface AppShellProps {
  readonly children: ReactNode;
  readonly identity?: AppShellIdentity;
  readonly navigationOrganizationId?: string | null;
  readonly workspace?: WorkspaceRegions;
  readonly loadingWorkspace?: boolean;
}

const navigationGroups = [
  {
    label: "Workspace",
    links: [
      {
        label: "Dashboard",
        path: "/organizations/local-org/dashboard",
        routeIds: ["dashboard"],
      },
      {
        label: "Projects",
        path: "/organizations/local-org/projects",
        routeIds: [
          "projects",
          "project-new",
          "project-overview",
          "project-intent",
          "project-editor",
          "project-revisions",
          "project-revision",
          "solution-export-job",
          "artifact-review",
          "artifact-export-zip",
          "artifact-export-github",
          "artifact-export-gitlab",
        ],
      },
      {
        label: "Templates",
        path: "/organizations/local-org/templates",
        routeIds: ["templates", "template-detail"],
      },
    ],
  },
  {
    label: "Organization",
    links: [
      {
        label: "Usage",
        path: "/organizations/local-org/usage",
        routeIds: ["usage"],
      },
      {
        label: "Plans & billing",
        path: "/organizations/local-org/billing",
        routeIds: ["billing"],
      },
      {
        label: "Organization settings",
        path: "/organizations/local-org/settings/general",
        routeIds: [
          "organization-general-settings",
          "organization-role-settings",
          "organization-policy-settings",
          "organization-security-settings",
          "organization-data-settings",
        ],
      },
      {
        label: "Members & roles",
        path: "/organizations/local-org/settings/members",
        routeIds: ["organization-member-settings"],
        capability: "memberships.read",
      },
      {
        label: "Organization integrations",
        path: "/organizations/local-org/settings/integrations",
        routeIds: ["organization-integration-settings"],
        capability: "integrations.read",
      },
    ],
  },
  {
    label: "Account",
    links: [
      {
        label: "Personal & organizations",
        path: "/organizations",
        routeIds: ["organizations"],
      },
      {
        label: "Profile",
        path: "/settings/profile",
        routeIds: ["profile-settings"],
      },
      {
        label: "Personal security",
        path: "/settings/security",
        routeIds: ["personal-security-settings"],
      },
      {
        label: "Preferences",
        path: "/settings/preferences",
        routeIds: ["preference-settings"],
      },
      {
        label: "Personal integrations",
        path: "/settings/integrations",
        routeIds: ["personal-integration-settings"],
      },
      {
        label: "Invitations",
        path: "/settings/invitations",
        routeIds: ["account-invitations"],
      },
    ],
  },
] as const;

export function AppShell({
  children,
  identity = localMockIdentity,
  navigationOrganizationId,
  workspace,
  loadingWorkspace = false,
}: AppShellProps) {
  const selectedNavigationOrganizationId =
    navigationOrganizationId ?? identity.organization?.id ?? null;
  const viewport = useViewportDimensions();
  const posture = viewport.posture;
  const isOnline = useOnlineStatus();
  const { announcement, storageStatus } = useModePreference();
  const {
    activeToasts,
    dismissNotification,
    history,
    markNotificationsRead,
    markNotificationsSeen,
    unseenCount,
  } = useNotifications();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [leftExpanded, setLeftExpanded] = useState(true);
  const navigationPreference = useNavigationPreference(identity.actorId);
  const [leftWidth, setLeftWidth] = useState(
    workspace === undefined ? navigationDefaultWidth : catalogDefaultWidth,
  );
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("issues");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("configure");
  const [inspectorWidth, setInspectorWidth] = useState(448);
  const [layoutAnnouncement, setLayoutAnnouncement] = useState("");
  const previousPostureRef = useRef(posture);
  const responsiveFocusElementRef = useRef<HTMLElement | null>(null);
  const responsiveFocusTargetRef = useRef<string | null>(null);
  const shellFocusRegionRef = useRef<DesktopShellFocusRegion>(null);
  const overlayInvokerRef = useRef<HTMLElement | null>(null);
  const workspaceBoundaryRef = useRef<HTMLDivElement | null>(null);
  const isWorkspace = workspace !== undefined;
  const previousWorkspaceRef = useRef(isWorkspace);
  const canvasRightInset =
    inspectorLauncherWidth +
    desktopOverlayInset +
    (overlay === "context"
      ? Math.min(inspectorWidth, viewport.width - 160) + 8
      : 0);
  const leftMaximum = Math.max(
    catalogMinimumWidth,
    viewport.width -
      desktopCanvasRecoverableWidth -
      desktopOverlayInset -
      canvasRightInset,
  );
  const visibleLeftWidth =
    posture === "desktop" && isWorkspace
      ? Math.min(leftWidth, leftMaximum)
      : leftWidth;

  function resetWorkspaceLayout() {
    setLeftExpanded(true);
    setOverlay(null);
    setLeftWidth(isWorkspace ? catalogDefaultWidth : navigationDefaultWidth);
    setWorkspaceTab("issues");
    setInspectorTab("configure");
    setInspectorWidth(448);
    setLayoutAnnouncement(
      "Workspace layout reset. Architecture data was not changed.",
    );
  }

  /* eslint-disable react-hooks/set-state-in-effect -- Route context and the
     viewport are external systems. This effect keeps standard navigation and
     Catalog widths independent, then prevents the Catalog from covering the
     minimum recoverable canvas plus the compact Inspector launcher. */
  useEffect(() => {
    if (previousWorkspaceRef.current !== isWorkspace) {
      previousWorkspaceRef.current = isWorkspace;
      setLeftWidth(isWorkspace ? catalogDefaultWidth : navigationDefaultWidth);
      return;
    }

    if (
      posture === "desktop" &&
      isWorkspace &&
      overlay !== "context" &&
      leftWidth > leftMaximum
    ) {
      setLeftWidth(leftMaximum);
    }
  }, [isWorkspace, leftMaximum, leftWidth, overlay, posture]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect -- Responsive posture comes
     from the external viewport. Reconcile which presentation-only surface owns
     focus when that external layout changes. */
  useLayoutEffect(() => {
    const previousPosture = previousPostureRef.current;
    previousPostureRef.current = posture;

    const focusRegionTarget = (
      region: Exclude<DesktopShellFocusRegion, null | "status">,
    ): HTMLElement | null => {
      if (posture === "desktop") {
        if (region === "navigation") {
          return isWorkspace
            ? document.getElementById("main-content")
            : (document.querySelector<HTMLElement>(
                "#application-navigation [aria-current='page']",
              ) ??
                document.querySelector<HTMLElement>(
                  "#application-navigation a",
                ));
        }
        if (region === "catalog") {
          return document.getElementById("catalog-panel");
        }
        if (region === "context") {
          return document.getElementById("inspector-panel");
        }
        if (region === "workspace") {
          return document.getElementById("bottom-workspace");
        }
        return document.getElementById("main-content");
      }
      if (region === "navigation") {
        return document.querySelector<HTMLElement>(
          '[aria-label="Open application navigation"]',
        );
      }
      if (region === "main") {
        return document.getElementById("main-content");
      }
      if (posture === "tablet") {
        const controlsId =
          region === "catalog"
            ? responsiveCatalogPanelId
            : region === "context"
              ? responsiveInspectorPanelId
              : responsiveWorkspacePanelId;
        return document.querySelector<HTMLElement>(
          `.responsive-workspace-toolbar [aria-controls="${controlsId}"]`,
        );
      }
      if (region === "workspace") {
        return (
          document.querySelector<HTMLElement>(
            `.phone-workspace-navigation [data-workspace-tab="${workspaceTab}"]`,
          ) ?? document.getElementById("main-content")
        );
      }
      return document.getElementById("main-content");
    };

    const setTransitionInvoker = (
      region: Exclude<DesktopShellFocusRegion, null | "status">,
    ) => {
      const target = focusRegionTarget(region);
      overlayInvokerRef.current = target;
      target?.focus();
    };

    if (previousPosture === posture) {
      return;
    }

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement.isConnected &&
      activeElement !== document.body &&
      activeElement !== document.documentElement &&
      activeElement.closest("[aria-hidden='true'], [inert]") === null
    ) {
      setLayoutAnnouncement(
        `Current focus retained in the ${posture} review layout.`,
      );
      return;
    }

    if (posture !== "desktop") {
      if (
        overlay === "navigation" ||
        overlay === "catalog" ||
        overlay === "context" ||
        overlay === "workspace"
      ) {
        setTransitionInvoker(overlay);
        setLayoutAnnouncement(
          `Open ${overlay} context retained in the ${posture} review layout.`,
        );
        return;
      }

      if (overlay !== null) {
        setLayoutAnnouncement(
          `Open shell context retained in the ${posture} review layout.`,
        );
        return;
      }

      const focusedRegion = shellFocusRegionRef.current;
      if (focusedRegion === "main") {
        setLayoutAnnouncement(
          `Main content retained focus after switching to the ${posture} review layout.`,
        );
        queueMicrotask(() => {
          document.getElementById("main-content")?.focus();
        });
        return;
      }

      if (
        focusedRegion === "navigation" ||
        (isWorkspace &&
          (focusedRegion === "catalog" ||
            focusedRegion === "context" ||
            focusedRegion === "workspace"))
      ) {
        setTransitionInvoker(focusedRegion);
        setOverlay(focusedRegion);
        setLayoutAnnouncement(
          `${
            focusedRegion === "navigation"
              ? "Application navigation"
              : focusedRegion === "catalog"
                ? "Service catalog"
                : focusedRegion === "context"
                  ? "Contextual inspector"
                  : "Bottom workspace"
          } opened after switching to the ${posture} review layout.`,
        );
      }
      return;
    }

    if (
      overlay !== "catalog" &&
      overlay !== "context" &&
      overlay !== "navigation" &&
      overlay !== "workspace"
    ) {
      const focusedRegion = shellFocusRegionRef.current;
      if (
        focusedRegion !== null &&
        focusedRegion !== "status" &&
        (isWorkspace ||
          focusedRegion === "main" ||
          focusedRegion === "navigation")
      ) {
        const target = focusRegionTarget(focusedRegion);
        overlayInvokerRef.current = target;
        queueMicrotask(() => {
          target?.focus();
        });
        setLayoutAnnouncement(
          "Focus moved to the matching desktop shell region.",
        );
      }
      return;
    }

    if (isWorkspace && (overlay === "context" || overlay === "workspace")) {
      setTransitionInvoker(overlay);
      setLayoutAnnouncement(
        `${overlay === "context" ? "Inspector" : "Workspace"} popup retained after switching to the desktop workspace.`,
      );
      return;
    }

    let targetId = "main-content";
    if (overlay === "catalog") {
      targetId = "catalog-panel";
      setLeftExpanded(true);
    } else if (overlay === "context") {
      targetId = "inspector-panel";
    } else if (overlay === "workspace") {
      targetId = "bottom-workspace";
    } else if (!isWorkspace) {
      targetId = "application-navigation";
    }
    const desktopTarget = focusRegionTarget(
      overlay === "navigation"
        ? "navigation"
        : overlay === "catalog"
          ? "catalog"
          : overlay === "context"
            ? "context"
            : "workspace",
    );
    overlayInvokerRef.current = desktopTarget;
    responsiveFocusElementRef.current = desktopTarget;
    responsiveFocusTargetRef.current = targetId;
    setOverlay(null);
    setLayoutAnnouncement(
      "Responsive panel closed after switching to the desktop workspace.",
    );
  }, [
    identity.kind,
    isWorkspace,
    overlay,
    posture,
    viewport.width,
    workspaceTab,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (
      (overlay !== null && overlay !== "context") ||
      responsiveFocusTargetRef.current === null
    ) {
      return;
    }

    const targetId = responsiveFocusTargetRef.current;
    const exactTarget = responsiveFocusElementRef.current;
    responsiveFocusElementRef.current = null;
    responsiveFocusTargetRef.current = null;
    const timeout = window.setTimeout(() => {
      if (exactTarget?.isConnected === true) {
        exactTarget.focus();
        return;
      }

      const target =
        targetId === "application-navigation"
          ? (document.querySelector<HTMLElement>(
              "#application-navigation [aria-current='page']",
            ) ??
            document.querySelector<HTMLElement>("#application-navigation a"))
          : null;
      if (target !== null) {
        target.focus();
      } else {
        focusWorkspaceShellTarget(targetId);
      }
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [overlay]);

  function openOverlay(nextOverlay: Exclude<Overlay, null>) {
    const activeElement = document.activeElement;
    overlayInvokerRef.current =
      activeElement instanceof HTMLElement &&
      activeElement.isConnected &&
      activeElement !== document.body &&
      activeElement !== document.documentElement
        ? activeElement
        : null;
    setOverlay(nextOverlay);
  }

  function openCatalogPanel(focusTargetId = "catalog-panel") {
    if (!isWorkspace) {
      return;
    }

    if (posture !== "desktop") {
      openOverlay("catalog");
      window.setTimeout(() => {
        focusWorkspaceShellTarget(focusTargetId);
      }, 0);
      return;
    }

    setLeftExpanded(true);
    window.setTimeout(() => {
      focusWorkspaceShellTarget(focusTargetId);
    }, 0);
  }

  function focusArchitectureTarget(targetId: string) {
    if (!isWorkspace) {
      return;
    }
    if (posture === "phone") {
      const focusTarget =
        document.getElementById(targetId) ??
        document.getElementById("architecture-list");
      if (focusTarget !== null) {
        overlayInvokerRef.current = focusTarget;
      }
      setOverlay(null);
      window.setTimeout(() => {
        focusWorkspaceShellTarget(focusTarget?.id ?? "architecture-list");
      }, 0);
      return;
    }

    openContextPanel(targetId, "architecture");
    window.setTimeout(() => {
      focusWorkspaceShellTarget(targetId);
    }, 0);
  }

  function openRevisionPlaceholder(
    focusTargetId = responsiveRevisionPlaceholderId,
  ) {
    if (!isWorkspace) {
      return;
    }
    openOverlay("status");
    window.setTimeout(() => {
      focusWorkspaceShellTarget(focusTargetId);
    }, 0);
  }

  function openContextPanel(
    focusTargetId = "inspector-panel",
    requestedInspectorTab?: WorkspaceInspectorTab,
  ) {
    if (requestedInspectorTab === "iac") {
      openWorkspacePanel("code");
      return;
    }
    if (requestedInspectorTab !== undefined) {
      setInspectorTab(requestedInspectorTab);
    }
    if (!isWorkspace) {
      return;
    }

    const responsiveFocusTargetId =
      focusTargetId === "inspector-panel"
        ? responsiveInspectorPanelId
        : focusTargetId;
    if (overlay === "context") {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.isConnected) {
        overlayInvokerRef.current = activeElement;
      }
      queueMicrotask(() => {
        focusWorkspaceShellTarget(responsiveFocusTargetId);
      });
      return;
    }
    responsiveFocusElementRef.current = null;
    responsiveFocusTargetRef.current = responsiveFocusTargetId;
    openOverlay("context");
  }

  function openWorkspacePanel(
    requestedWorkspaceTab?: WorkspacePanelTab,
    focusTargetId = "bottom-workspace",
  ) {
    if (requestedWorkspaceTab !== undefined) {
      setWorkspaceTab(requestedWorkspaceTab);
    }
    if (!isWorkspace) {
      return;
    }

    openOverlay("workspace");
    window.setTimeout(() => {
      focusWorkspaceShellTarget(focusTargetId);
    }, 0);
  }

  const workspaceShellController: WorkspaceShellController = {
    closePanels: () => {
      setOverlay(null);
    },
    focusArchitectureTarget,
    overlays: {
      catalog: {
        open: isWorkspace && posture === "desktop" && leftExpanded,
      },
      inspector: {
        open: isWorkspace && posture === "desktop",
      },
      safeArea: {
        bottom:
          isWorkspace && posture === "desktop"
            ? workspaceLauncherHeight + desktopOverlayInset
            : 0,
        left:
          isWorkspace && posture === "desktop" && leftExpanded
            ? visibleLeftWidth + desktopOverlayInset
            : 0,
        right: isWorkspace && posture === "desktop" ? canvasRightInset : 0,
      },
    },
    openRevisionPlaceholder,
    openCatalogPanel,
    openContextPanel,
    openWorkspacePanel,
    posture,
  };

  const shellStyle = useMemo(
    () =>
      ({
        "--shell-bottom-height": `${String(workspaceLauncherHeight)}px`,
        "--shell-left-width": `${String(
          isWorkspace
            ? visibleLeftWidth
            : navigationPreference.expanded
              ? leftWidth
              : collapsedSideWidth,
        )}px`,
        "--shell-inspector-width": `${String(inspectorWidth)}px`,
        "--shell-right-width": `${String(inspectorLauncherWidth)}px`,
        "--workspace-safe-bottom": `${String(
          isWorkspace ? workspaceLauncherHeight + desktopOverlayInset : 0,
        )}px`,
        "--workspace-safe-left": `${String(
          leftExpanded ? visibleLeftWidth + desktopOverlayInset : 0,
        )}px`,
        "--workspace-safe-right": `${String(
          isWorkspace ? inspectorLauncherWidth + desktopOverlayInset : 0,
        )}px`,
      }) as CSSProperties,
    [
      isWorkspace,
      leftExpanded,
      leftWidth,
      visibleLeftWidth,
      inspectorWidth,
      navigationPreference.expanded,
    ],
  );

  return (
    <div
      className={`authenticated-shell ${
        isWorkspace ? "authenticated-shell--workspace" : ""
      }`}
      data-posture={posture}
      onFocusCapture={(event: FocusEvent<HTMLDivElement>) => {
        shellFocusRegionRef.current = getDesktopShellFocusRegion(event.target);
      }}
      style={shellStyle}
    >
      <SkipLinks
        includeWorkspace={isWorkspace}
        onOpenCatalog={
          isWorkspace
            ? () => {
                openCatalogPanel();
              }
            : undefined
        }
        onOpenContext={
          isWorkspace
            ? () => {
                openContextPanel();
              }
            : undefined
        }
        onOpenStatus={() => {
          openOverlay("status");
        }}
        onOpenWorkspace={
          isWorkspace
            ? () => {
                openWorkspacePanel();
              }
            : undefined
        }
      />
      <OverlayBoundaryProvider boundaryRef={workspaceBoundaryRef}>
        {!isWorkspace && !loadingWorkspace && identity.organization !== null ? (
          <WorkspaceTour
            key={identity.actorId}
            actorId={identity.actorId}
            autoRevealNavigation={posture === "desktop"}
            onRevealNavigation={() => {
              setLeftExpanded(true);
              if (!navigationPreference.expanded) navigationPreference.toggle();
              if (posture !== "desktop") openOverlay("navigation");
            }}
          />
        ) : null}
        <WorkspaceShellControllerContext.Provider
          value={workspaceShellController}
        >
          <TopApplicationBar
            editorActions={workspace?.header}
            identity={identity}
            notificationCount={unseenCount}
            onOpenAccount={() => {
              markNotificationsSeen(history.map((item) => item.id));
              openOverlay("account");
            }}
            onOpenNavigation={() => {
              openOverlay("navigation");
            }}
            overlay={overlay}
            posture={posture}
          />
        </WorkspaceShellControllerContext.Provider>

        <div
          aria-label="Workspace status"
          className="shell-status-region"
          id="workspace-status"
          role="region"
          tabIndex={-1}
        >
          {!isOnline ? (
            <div className="offline-banner" role="status" aria-live="polite">
              <strong>Offline.</strong>{" "}
              {identity.kind === "verified"
                ? "Server actions are paused. Validated browser recovery remains separate from the server draft."
                : "This local shell has no backend connection; server freshness and save status remain unavailable."}
            </div>
          ) : null}
          <div
            aria-atomic="true"
            aria-live="polite"
            className="visually-hidden"
            role="status"
          >
            {announcement}
          </div>
          <div
            aria-atomic="true"
            aria-live="polite"
            className="visually-hidden"
            role="status"
          >
            {layoutAnnouncement}
          </div>
          {storageStatus === "available" ? null : (
            <div className="preference-banner" role="status">
              The experience preference could not be saved locally. Your current
              session presentation remains available.
            </div>
          )}
        </div>

        <WorkspaceShellControllerContext.Provider
          value={workspaceShellController}
        >
          {loadingWorkspace ? (
            <main
              className="editor-loading-surface"
              id="main-content"
              tabIndex={-1}
            >
              {children}
            </main>
          ) : isWorkspace ? (
            <WorkspaceShell
              activeOverlay={overlay}
              boundaryRef={workspaceBoundaryRef}
              inspectorTab={inspectorTab}
              leftExpanded={leftExpanded}
              leftMaximum={leftMaximum}
              leftWidth={visibleLeftWidth}
              onLeftWidthChange={(value) => {
                setLeftWidth(value);
              }}
              onOpenCatalog={() => {
                openCatalogPanel();
              }}
              onOpenContext={() => {
                openContextPanel();
              }}
              onOpenWorkspace={() => {
                openWorkspacePanel();
              }}
              onSelectInspector={(tab) => {
                if (overlay === "context" && inspectorTab === tab) {
                  setOverlay(null);
                  return;
                }
                openContextPanel(
                  tab === "architecture"
                    ? "architecture-list"
                    : "selected-resource-inspector",
                  tab,
                );
              }}
              onSelectWorkspace={(tab) => {
                if (overlay === "workspace" && workspaceTab === tab) {
                  setOverlay(null);
                  return;
                }
                openWorkspacePanel(
                  tab,
                  tab === "issues"
                    ? "validation-issues-panel"
                    : tab === "code"
                      ? "editor-code-workspace"
                      : responsiveWorkspacePanelId,
                );
              }}
              onToggleLeft={() => {
                setLeftExpanded((current) => !current);
              }}
              posture={posture}
              regions={workspace}
              workspaceTab={workspaceTab}
            >
              {children}
            </WorkspaceShell>
          ) : (
            <StandardShell
              capabilities={identity.organization?.capabilities}
              workspaceKind={identity.organization?.kind}
              organizationName={identity.organization?.name}
              organizationId={selectedNavigationOrganizationId}
              leftExpanded={navigationPreference.expanded}
              leftWidth={leftWidth}
              onLeftWidthChange={setLeftWidth}
              onToggleLeft={() => {
                navigationPreference.toggle();
              }}
              posture={posture}
            >
              {children}
            </StandardShell>
          )}

          {posture === "phone" && isWorkspace ? (
            <PhoneWorkspaceNavigation
              activeOverlay={overlay}
              onOpenCatalog={() => {
                openOverlay("catalog");
              }}
              onOpenMore={() => {
                openOverlay("navigation");
              }}
              onOpenWorkspace={(tab) => {
                setWorkspaceTab(tab);
                openOverlay("workspace");
              }}
            />
          ) : null}

          <ShellOverlay
            inspectorWidth={inspectorWidth}
            onInspectorWidthChange={setInspectorWidth}
            inspectorMaximum={Math.max(
              448,
              Math.min(800, viewport.width - 400),
            )}
            identity={identity}
            navigationOrganizationId={selectedNavigationOrganizationId}
            inspectorTab={inspectorTab}
            onInspectorTabChange={setInspectorTab}
            onClose={() => {
              setOverlay(null);
            }}
            overlay={overlay}
            onResetWorkspaceLayout={resetWorkspaceLayout}
            onOpenNotifications={() => {
              markNotificationsRead(history.map((item) => item.id));
              setOverlay("notifications");
            }}
            posture={posture}
            regions={workspace}
            returnFocusRef={overlayInvokerRef}
            workspaceTab={workspaceTab}
            onWorkspaceTabChange={setWorkspaceTab}
          />
        </WorkspaceShellControllerContext.Provider>
      </OverlayBoundaryProvider>

      <ToastViewport
        onDismiss={dismissNotification}
        toasts={activeToasts.map((notification) => ({
          description: notification.message,
          id: notification.id,
          title: notification.title,
          tone: notification.kind,
        }))}
      />
    </div>
  );
}

function SkipLinks({
  includeWorkspace,
  onOpenCatalog,
  onOpenContext,
  onOpenStatus,
  onOpenWorkspace,
}: {
  readonly includeWorkspace: boolean;
  readonly onOpenCatalog: (() => void) | undefined;
  readonly onOpenContext: (() => void) | undefined;
  readonly onOpenStatus: (() => void) | undefined;
  readonly onOpenWorkspace: (() => void) | undefined;
}) {
  function handleResponsiveSkip(
    event: MouseEvent<HTMLAnchorElement>,
    onOpen: (() => void) | undefined,
  ) {
    if (onOpen === undefined) {
      return;
    }

    event.preventDefault();
    onOpen();
  }

  return (
    <nav className="skip-links" aria-label="Skip links">
      <a href="#main-content">Skip to main content</a>
      {includeWorkspace ? (
        <>
          <a
            href="#catalog-panel"
            onClick={(event) => {
              handleResponsiveSkip(event, onOpenCatalog);
            }}
          >
            Skip to catalog
          </a>
          <a href="#architecture-workspace">Skip to architecture</a>
          <a
            href="#inspector-panel"
            onClick={(event) => {
              handleResponsiveSkip(event, onOpenContext);
            }}
          >
            Skip to inspector
          </a>
          <a
            href="#bottom-workspace"
            onClick={(event) => {
              handleResponsiveSkip(event, onOpenWorkspace);
            }}
          >
            Skip to bottom workspace
          </a>
          <a
            href="#workspace-status"
            onClick={(event) => {
              handleResponsiveSkip(event, onOpenStatus);
            }}
          >
            Skip to workspace status
          </a>
        </>
      ) : null}
    </nav>
  );
}

function TopApplicationBar({
  editorActions,
  identity,
  notificationCount,
  onOpenAccount,
  onOpenNavigation,
  overlay,
  posture,
}: {
  readonly editorActions?: ReactNode;
  readonly identity: AppShellIdentity;
  readonly notificationCount: number;
  readonly onOpenAccount: () => void;
  readonly onOpenNavigation: () => void;
  readonly overlay: Overlay;
  readonly posture: ViewportPosture;
}) {
  const route = useRouteMatch();
  const isLocalOrganization =
    route.params.organizationId === undefined ||
    route.params.organizationId === identity.organization?.id;
  const project =
    identity.kind === "local-mock" &&
    isLocalOrganization &&
    route.params.projectId !== undefined
      ? localMockProjects.find(
          (candidate) => candidate.id === route.params.projectId,
        )
      : undefined;
  return (
    <header
      aria-label="Application header"
      className="top-app-bar"
      data-identity-kind={identity.kind}
    >
      <div className="top-app-bar__start">
        {posture === "desktop" ? null : (
          <IconButton
            aria-expanded={overlay === "navigation"}
            aria-haspopup="dialog"
            className="icon-button"
            data-shell-focus-region="navigation"
            icon={<MenuIcon />}
            label="Open application navigation"
            onClick={onOpenNavigation}
          />
        )}
        <AppLink
          aria-label={
            identity.organization === null ? "Organizations" : "Dashboard home"
          }
          className="brand-link"
          to={
            identity.organization === null
              ? "/organizations"
              : `/organizations/${encodeURIComponent(identity.organization.id)}/dashboard`
          }
        >
          <BrandLockup markSrc="/app-icon-192.png" />
        </AppLink>
        <span
          aria-label={
            identity.organization === null
              ? "Personal account"
              : `${identity.organization.kind === "personal" ? "Personal workspace" : "Organization " + identity.organization.name}${
                  project === undefined ? "" : `, project ${project.name}`
                }`
          }
          className="organization-context"
          role="group"
        >
          <span>
            {identity.organization?.kind === "personal"
              ? "Personal workspace"
              : (identity.organization?.name ?? "Personal account")}
          </span>
          {project === undefined ? null : (
            <>
              <span aria-hidden="true">/</span>
              <strong>{project.name}</strong>
            </>
          )}
        </span>
      </div>
      {editorActions === undefined ? null : (
        <div className="top-app-bar__editor-actions">{editorActions}</div>
      )}

      <div className="top-app-bar__actions">
        <div className="top-mode-switch" data-shell-focus-region="status">
          <ModeSwitch />
        </div>
        <button
          aria-expanded={overlay === "account"}
          aria-haspopup="dialog"
          aria-label={
            identity.kind === "verified"
              ? "Open authenticated account"
              : "Open local mock account"
          }
          aria-describedby={
            notificationCount > 0 ? "profile-notification-count" : undefined
          }
          id="profile-menu-trigger"
          className="mock-account-button"
          onClick={onOpenAccount}
          type="button"
        >
          <span className="account-avatar-trigger">
            <AccountAvatar
              displayName={identity.displayName}
              principalId={
                identity.kind === "verified" ? identity.actorId : undefined
              }
            />
            {notificationCount > 0 ? (
              <span className="profile-notification-badge">
                {notificationCount > 99 ? "99+" : notificationCount}
              </span>
            ) : null}
          </span>
          {notificationCount > 0 ? (
            <span className="visually-hidden" id="profile-notification-count">
              {notificationCount} new{" "}
              {notificationCount === 1 ? "notification" : "notifications"}
            </span>
          ) : null}
          <span aria-hidden="true" className="compact-mock-label">
            {identity.kind === "verified" ? "Verified" : "Mock"}
          </span>
          <span className="mock-account-button__label">
            {identity.displayName}
            <small>
              {identity.kind === "verified"
                ? "Verified server session"
                : "Local mock - not verified"}
            </small>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="account-trigger-chevron"
            size={14}
          />
        </button>
      </div>
    </header>
  );
}

function StandardShell({
  capabilities,
  workspaceKind,
  organizationName,
  children,
  organizationId,
  leftExpanded,
  leftWidth,
  onLeftWidthChange,
  onToggleLeft,
  posture,
}: {
  readonly capabilities?: readonly string[] | undefined;
  readonly workspaceKind?:
    "personal" | "organization" | "unavailable" | undefined;
  readonly organizationName?: string | undefined;
  readonly children: ReactNode;
  readonly organizationId: string | null;
  readonly leftExpanded: boolean;
  readonly leftWidth: number;
  readonly onLeftWidthChange: (value: number) => void;
  readonly onToggleLeft: () => void;
  readonly posture: ViewportPosture;
}) {
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    // RoutePage owns heading focus. Native history restoration otherwise runs
    // after that focus and can scroll the heading out of the standard panel.
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  return (
    <div className="standard-shell">
      {posture === "desktop" ? (
        <>
          <aside
            aria-label="Application navigation region"
            className="shell-left-panel"
          >
            <PanelHeader
              expanded={leftExpanded}
              label="Navigation"
              onToggle={onToggleLeft}
              panelId="application-navigation"
            />
            {leftExpanded ? (
              <PrimaryNavigation
                capabilities={capabilities}
                id="application-navigation"
                organizationId={organizationId}
                organizationName={organizationName}
                workspaceKind={workspaceKind}
              />
            ) : (
              <PrimaryNavigation
                capabilities={capabilities}
                collapsed
                id="application-navigation"
                organizationId={organizationId}
                organizationName={organizationName}
                workspaceKind={workspaceKind}
              />
            )}
          </aside>
          {leftExpanded ? (
            <ResizeHandle
              controlsId="application-navigation"
              label="Resize application navigation"
              maximum={navigationMaximumWidth}
              minimum={navigationMinimumWidth}
              onChange={onLeftWidthChange}
              orientation="vertical"
              value={leftWidth}
            />
          ) : null}
        </>
      ) : null}
      <main className="shell-main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function WorkspaceShell({
  activeOverlay,
  boundaryRef,
  children,
  inspectorTab,
  leftExpanded,
  leftMaximum,
  leftWidth,
  onLeftWidthChange,
  onOpenCatalog,
  onOpenContext,
  onOpenWorkspace,
  onSelectInspector,
  onSelectWorkspace,
  onToggleLeft,
  posture,
  regions,
  workspaceTab,
}: {
  readonly activeOverlay: Overlay;
  readonly boundaryRef: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
  readonly inspectorTab: InspectorTab;
  readonly leftExpanded: boolean;
  readonly leftMaximum: number;
  readonly leftWidth: number;
  readonly onLeftWidthChange: (value: number) => void;
  readonly onOpenCatalog: () => void;
  readonly onOpenContext: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onSelectInspector: (tab: InspectorTab) => void;
  readonly onSelectWorkspace: (tab: WorkspaceTab) => void;
  readonly onToggleLeft: () => void;
  readonly posture: ViewportPosture;
  readonly regions: WorkspaceRegions;
  readonly workspaceTab: WorkspaceTab;
}) {
  if (posture !== "desktop") {
    return (
      <div
        className="responsive-workspace-shell"
        data-active-overlay={activeOverlay ?? "none"}
        ref={boundaryRef}
      >
        {posture === "tablet" ? (
          <div className="responsive-workspace-toolbar">
            <button
              aria-controls={responsiveCatalogPanelId}
              aria-expanded={activeOverlay === "catalog"}
              aria-haspopup="dialog"
              className="button button--secondary"
              onClick={onOpenCatalog}
              type="button"
            >
              Catalog
            </button>
            <button
              aria-controls={responsiveInspectorPanelId}
              aria-expanded={activeOverlay === "context"}
              aria-haspopup="dialog"
              className="button button--secondary"
              onClick={onOpenContext}
              type="button"
            >
              Inspector
            </button>
            <button
              aria-controls={responsiveWorkspacePanelId}
              aria-expanded={activeOverlay === "workspace"}
              aria-haspopup="dialog"
              className="button button--secondary"
              onClick={onOpenWorkspace}
              type="button"
            >
              Workspace
            </button>
          </div>
        ) : null}
        <main
          className="shell-main shell-main--workspace"
          id="main-content"
          tabIndex={-1}
        >
          <div id="architecture-workspace" tabIndex={-1}>
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="workspace-shell"
      data-catalog-open={leftExpanded ? "true" : "false"}
      data-inspector-open={activeOverlay === "context" ? "true" : "false"}
      data-workspace-open={activeOverlay === "workspace" ? "true" : "false"}
      ref={boundaryRef}
    >
      <main
        className="shell-main shell-main--workspace"
        id="main-content"
        tabIndex={-1}
      >
        <div id="architecture-workspace" tabIndex={-1}>
          {children}
        </div>
      </main>

      <aside
        aria-label="Service catalog region"
        className="shell-left-panel shell-floating-panel workspace-shell__catalog"
        data-expanded={leftExpanded ? "true" : "false"}
        id="catalog-panel"
        tabIndex={-1}
      >
        <header className="panel-chrome">
          <Button
            aria-controls="catalog-content"
            aria-expanded={leftExpanded}
            aria-label={`${leftExpanded ? "Hide" : "Show"} Catalog`}
            className="workspace-shell__catalog-toggle"
            data-shell-focus-region="catalog"
            onClick={onToggleLeft}
            size="compact"
            type="button"
            variant="quiet"
          >
            Catalog
            <ChevronDown aria-hidden="true" size={16} />
          </Button>
        </header>
        {leftExpanded ? (
          <div id="catalog-content">{regions.catalog}</div>
        ) : (
          <div aria-hidden="true" id="catalog-content" />
        )}
      </aside>
      {leftExpanded ? (
        <ResizeHandle
          className="workspace-shell__catalog-resize"
          controlsId="catalog-panel"
          label="Resize service catalog"
          maximum={leftMaximum}
          minimum={catalogMinimumWidth}
          onChange={onLeftWidthChange}
          orientation="vertical"
          value={leftWidth}
        />
      ) : null}

      <nav
        aria-label="Inspector tools"
        className="workspace-shell__inspector-launcher"
        data-shell-focus-region="context"
        id="inspector-panel"
        tabIndex={-1}
      >
        {inspectorLauncherItems.map(
          ({ description, icon: Icon, id, label }) => {
            const active = activeOverlay === "context" && inspectorTab === id;
            return (
              <Tooltip
                content={`${active ? "Close" : "Open"} ${label} — ${description}`}
                disabled={active}
                key={id}
                placement="left"
                renderInPortal
              >
                <Button
                  aria-controls={responsiveInspectorPanelId}
                  aria-expanded={active}
                  aria-haspopup="dialog"
                  className="workspace-launcher-button"
                  data-inspector-tab={id}
                  id={`inspector-launcher-${id}`}
                  onClick={() => {
                    onSelectInspector(id);
                  }}
                  size="compact"
                  variant={active ? "secondary" : "quiet"}
                >
                  <span
                    aria-hidden="true"
                    className="workspace-launcher-button__icon"
                  >
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <span className="workspace-launcher-button__label">
                    {label}
                  </span>
                </Button>
              </Tooltip>
            );
          },
        )}
      </nav>

      <nav
        aria-label="Workspace tools"
        className="workspace-shell__workspace-launcher"
        data-shell-focus-region="workspace"
        id="bottom-workspace"
        tabIndex={-1}
      >
        {workspaceLauncherItems.map(
          ({ description, icon: Icon, id, label }) => {
            const active = activeOverlay === "workspace" && workspaceTab === id;
            return (
              <Tooltip
                content={`${active ? "Close" : "Open"} ${label} — ${description}`}
                disabled={active}
                key={id}
                placement="top"
                renderInPortal
              >
                <Button
                  aria-label={label}
                  aria-describedby={
                    id === "issues" && regions.issueIndicator
                      ? "editor-issue-count"
                      : undefined
                  }
                  aria-controls={responsiveWorkspacePanelId}
                  aria-expanded={active}
                  aria-haspopup="dialog"
                  className="workspace-launcher-button"
                  data-workspace-tab={id}
                  id={`workspace-launcher-${id}`}
                  onClick={() => {
                    onSelectWorkspace(id);
                  }}
                  size="compact"
                  variant={active ? "secondary" : "quiet"}
                >
                  {id === "issues" && regions.issueIndicator ? (
                    regions.issueIndicator
                  ) : (
                    <span
                      aria-hidden="true"
                      className="workspace-launcher-button__icon"
                    >
                      <Icon size={16} strokeWidth={1.75} />
                    </span>
                  )}
                  <span className="workspace-launcher-button__label">
                    {label}
                  </span>
                </Button>
              </Tooltip>
            );
          },
        )}
      </nav>
    </div>
  );
}

function PanelHeader({
  expanded,
  label,
  onToggle,
  panelId,
}: {
  readonly expanded: boolean;
  readonly label: string;
  readonly onToggle: () => void;
  readonly panelId: string;
}) {
  return (
    <header className="panel-chrome" data-expanded={expanded}>
      {expanded ? <strong>{label}</strong> : null}
      <Button
        aria-controls={panelId}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} ${label}`}
        className="panel-toggle"
        onClick={onToggle}
        size="compact"
        title={`${expanded ? "Hide" : "Show"} ${label}`}
        type="button"
        variant={expanded ? "quiet" : "secondary"}
      >
        {label === "Navigation" ? (
          expanded ? (
            <PanelLeftClose size={18} aria-hidden="true" />
          ) : (
            <PanelLeftOpen size={18} aria-hidden="true" />
          )
        ) : (
          <span aria-hidden="true">{expanded ? "Hide" : `Show ${label}`}</span>
        )}
      </Button>
    </header>
  );
}

const navigationIcons: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Projects: FolderKanban,
  Templates: LayoutTemplate,
  Profile: UserRound,
  Invitations: Mail,
  Preferences: SlidersHorizontal,
  "Personal security": ShieldCheck,
  Usage: Gauge,
  "Plans & billing": CreditCard,
  "Personal & organizations": Building2,
  "Organization settings": Settings2,
  "Personal integrations": Cable,
  "Members & roles": UsersRound,
  "Organization integrations": Cable,
};

function PrimaryNavigation({
  capabilities,
  collapsed = false,
  workspaceKind,
  id,
  onNavigate,
  organizationId,
  organizationName,
}: {
  readonly capabilities?: readonly string[] | undefined;
  readonly workspaceKind?:
    "personal" | "organization" | "unavailable" | undefined;
  readonly collapsed?: boolean;
  readonly id?: string;
  readonly onNavigate?: () => void;
  readonly organizationId: string | null;
  readonly organizationName?: string | undefined;
}) {
  const route = useRouteMatch();

  return (
    <nav
      aria-label={
        collapsed ? "Collapsed application navigation" : "Primary navigation"
      }
      className={`primary-navigation${collapsed ? " primary-navigation--collapsed" : ""}`}
      id={id}
    >
      {organizationId === null ? (
        <section className="navigation-group" data-navigation-group="Workspace">
          <h2 className={collapsed ? "visually-hidden" : undefined}>
            Project work
          </h2>
          <p
            className={
              collapsed ? "visually-hidden" : "navigation-workspace-note"
            }
          >
            Choose your personal workspace or an organization to open Dashboard,
            Projects, Usage, and billing.
          </p>
          <ul>
            <li>
              <AppLink
                aria-current={route.id === "organizations" ? "page" : undefined}
                aria-label={collapsed ? "Personal & organizations" : undefined}
                title={collapsed ? "Personal & organizations" : undefined}
                onClick={onNavigate}
                to="/organizations"
              >
                <MenuIcon size={18} aria-hidden="true" />
                <span className={collapsed ? "visually-hidden" : undefined}>
                  Personal & organizations
                </span>
              </AppLink>
            </li>
          </ul>
        </section>
      ) : null}
      {navigationGroups
        .filter((group) => organizationId !== null || group.label === "Account")
        .map((group) => (
          <section
            className="navigation-group"
            data-navigation-group={group.label}
            key={group.label}
          >
            <h2 className={collapsed ? "visually-hidden" : undefined}>
              {group.label === "Workspace"
                ? "Project work"
                : group.label === "Account"
                  ? "Personal account"
                  : workspaceKind === "personal"
                    ? "Personal workspace"
                    : workspaceKind === "organization"
                      ? "Organization"
                      : "Selected workspace"}
            </h2>
            {group.label === "Organization" ? (
              <p
                className={
                  collapsed ? "visually-hidden" : "navigation-workspace-note"
                }
              >
                {organizationName ??
                  "Selected personal workspace or organization"}
              </p>
            ) : null}
            <ul>
              {group.links
                .filter(
                  (link) =>
                    (organizationId !== null ||
                      link.path !== "/organizations") &&
                    (organizationId !== null ||
                      !link.path.includes("/local-org/")) &&
                    ((workspaceKind !== "personal" &&
                      workspaceKind !== "unavailable") ||
                      group.label !== "Organization" ||
                      !link.path.includes("/settings/")) &&
                    (!("capability" in link) ||
                      (workspaceKind === "organization" &&
                        capabilities?.includes(link.capability))),
                )
                .map((link) => {
                  const Icon = navigationIcons[link.label] ?? MenuIcon;
                  const active = link.routeIds.some(
                    (routeId) => routeId === route.id,
                  );

                  return (
                    <li key={link.path}>
                      <Tooltip
                        content={link.label}
                        disabled={!collapsed}
                        placement="right"
                        renderInPortal
                      >
                        <AppLink
                          aria-current={active ? "page" : undefined}
                          aria-label={collapsed ? link.label : undefined}
                          title={collapsed ? link.label : undefined}
                          onClick={onNavigate}
                          to={
                            organizationId === null
                              ? link.path
                              : link.path.replace(
                                  "/organizations/local-org",
                                  `/organizations/${encodeURIComponent(organizationId)}`,
                                )
                          }
                        >
                          <Icon size={18} aria-hidden="true" />
                          <span
                            className={
                              collapsed ? "visually-hidden" : undefined
                            }
                          >
                            {link.label}
                          </span>
                        </AppLink>
                      </Tooltip>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
    </nav>
  );
}

function ResponsiveShellSurface({
  children,
  className,
  description,
  dismissOnOutside = false,
  onClose,
  open,
  placement = "end",
  posture,
  returnFocusRef,
  title,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly dismissOnOutside?: boolean;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly placement?: "bottom" | "start" | "end";
  readonly posture: ViewportPosture;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly title: string;
}) {
  const descriptionProps = description === undefined ? {} : { description };
  const classNameProps = className === undefined ? {} : { className };
  useEffect(() => {
    if (!open || !dismissOnOutside || posture === "phone") return undefined;
    const dismiss = (event: PointerEvent) => {
      const surface = document.querySelector(
        "[data-cm-account-menu='true'][data-state='open']",
      );
      if (
        event.target instanceof Node &&
        surface !== null &&
        !surface.contains(event.target) &&
        !returnFocusRef.current?.contains(event.target)
      )
        onClose();
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
    };
  }, [dismissOnOutside, onClose, open, posture, returnFocusRef]);

  if (posture === "phone") {
    return (
      <ModalDrawer
        {...classNameProps}
        {...descriptionProps}
        kind="drawer"
        footer={<div data-guided-tour-slot="" />}
        onClose={onClose}
        open={open}
        returnFocusRef={returnFocusRef}
        title={title}
      >
        {children}
      </ModalDrawer>
    );
  }

  return (
    <Drawer
      {...classNameProps}
      {...descriptionProps}
      data-cm-account-menu={dismissOnOutside ? "true" : undefined}
      onClose={onClose}
      open={open}
      placement={placement}
      returnFocusRef={returnFocusRef}
      title={title}
    >
      {children}
    </Drawer>
  );
}

const shellPopupExitDurationMs = 160;

function shellPopupReducedMotionRequested(): boolean {
  const matchMedia = Reflect.get(window, "matchMedia") as
    ((query: string) => MediaQueryList) | undefined;
  return (
    document.documentElement.dataset["cmReducedMotion"] === "true" ||
    (matchMedia?.call(window, "(prefers-reduced-motion: reduce)").matches ??
      false)
  );
}

function ShellOverlay({
  inspectorWidth,
  inspectorMaximum,
  onInspectorWidthChange,
  identity,
  navigationOrganizationId,
  inspectorTab,
  onClose,
  onInspectorTabChange,
  onResetWorkspaceLayout,
  onOpenNotifications,
  onWorkspaceTabChange,
  overlay,
  posture,
  regions,
  returnFocusRef,
  workspaceTab,
}: {
  readonly inspectorWidth: number;
  readonly inspectorMaximum: number;
  readonly onInspectorWidthChange: (width: number) => void;
  readonly identity: AppShellIdentity;
  readonly navigationOrganizationId: string | null;
  readonly inspectorTab: InspectorTab;
  readonly onClose: () => void;
  readonly onInspectorTabChange: (tab: InspectorTab) => void;
  readonly onResetWorkspaceLayout: () => void;
  readonly onOpenNotifications: () => void;
  readonly onWorkspaceTabChange: (tab: WorkspaceTab) => void;
  readonly overlay: Overlay;
  readonly posture: ViewportPosture;
  readonly regions: WorkspaceRegions | undefined;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly workspaceTab: WorkspaceTab;
}) {
  const { history, markNotificationsRead, unreadCount } = useNotifications();
  const route = useRouteMatch();
  const requestedOverlay =
    posture === "desktop" && (overlay === "catalog" || overlay === "navigation")
      ? null
      : overlay;
  const [renderedOverlay, setRenderedOverlay] = useState<Exclude<
    Overlay,
    null
  > | null>(requestedOverlay);

  /* eslint-disable react-hooks/set-state-in-effect -- The previously active
     shell surface remains rendered with open=false long enough for the shared
     primitive to complete its exit motion while becoming inert immediately. */
  useEffect(() => {
    if (requestedOverlay === null || requestedOverlay === renderedOverlay) {
      return undefined;
    }
    if (renderedOverlay === null || shellPopupReducedMotionRequested()) {
      setRenderedOverlay(requestedOverlay);
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setRenderedOverlay(requestedOverlay);
    }, shellPopupExitDurationMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [renderedOverlay, requestedOverlay]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (
      posture !== "desktop" ||
      requestedOverlay !== null ||
      (renderedOverlay !== "catalog" &&
        renderedOverlay !== "context" &&
        renderedOverlay !== "navigation" &&
        renderedOverlay !== "workspace")
    ) {
      return;
    }

    const target = returnFocusRef.current;
    if (
      document.querySelector("[data-cm-modal-drawer]") === null &&
      target?.isConnected === true
    ) {
      target.focus();
    }
  }, [posture, renderedOverlay, requestedOverlay, returnFocusRef]);

  const isLocalOrganization =
    route.params.organizationId === undefined ||
    route.params.organizationId === identity.organization?.id;
  const project =
    identity.kind === "local-mock" &&
    isLocalOrganization &&
    route.params.projectId !== undefined
      ? localMockProjects.find(
          (candidate) => candidate.id === route.params.projectId,
        )
      : undefined;

  if (renderedOverlay === null) {
    return null;
  }

  const surfaceOpen = requestedOverlay === renderedOverlay;

  if (renderedOverlay === "navigation") {
    return (
      <ResponsiveShellSurface
        key={renderedOverlay}
        className="application-navigation-surface"
        onClose={onClose}
        open={surfaceOpen}
        placement="start"
        posture={posture}
        returnFocusRef={returnFocusRef}
        title="Application navigation"
      >
        <PrimaryNavigation
          capabilities={identity.organization?.capabilities}
          id="application-navigation"
          onNavigate={onClose}
          organizationId={navigationOrganizationId}
          organizationName={identity.organization?.name}
          workspaceKind={identity.organization?.kind}
        />
      </ResponsiveShellSurface>
    );
  }

  if (renderedOverlay === "catalog" && regions !== undefined) {
    return (
      <ResponsiveShellSurface
        className="workspace-catalog-surface"
        key={renderedOverlay}
        onClose={onClose}
        open={surfaceOpen}
        placement="start"
        posture={posture}
        returnFocusRef={returnFocusRef}
        title="Service catalog"
      >
        <div id={responsiveCatalogPanelId}>{regions.catalog}</div>
      </ResponsiveShellSurface>
    );
  }

  if (renderedOverlay === "context" && regions !== undefined) {
    const label =
      inspectorLauncherItems.find((item) => item.id === inspectorTab)?.label ??
      "Inspector";
    return (
      <ResponsiveShellSurface
        className="editor-popup-surface editor-popup-surface--inspector"
        key={renderedOverlay}
        onClose={onClose}
        open={surfaceOpen}
        posture={posture}
        returnFocusRef={returnFocusRef}
        title={`${label} inspector`}
      >
        {posture === "desktop" ? (
          <ResizeHandle
            className="inspector-width-handle"
            controlsId={responsiveInspectorPanelId}
            label="Resize inspector"
            minimum={360}
            maximum={inspectorMaximum}
            value={inspectorWidth}
            onChange={onInspectorWidthChange}
            orientation="vertical"
            reverse
          />
        ) : null}
        <div id={responsiveInspectorPanelId} tabIndex={-1}>
          {regions.context(inspectorTab, onInspectorTabChange)}
        </div>
      </ResponsiveShellSurface>
    );
  }

  if (renderedOverlay === "workspace" && regions !== undefined) {
    const label =
      workspaceLauncherItems.find((item) => item.id === workspaceTab)?.label ??
      "Workspace";
    return (
      <ResponsiveShellSurface
        className="editor-popup-surface editor-popup-surface--workspace workspace-bottom-surface"
        key={renderedOverlay}
        onClose={onClose}
        open={surfaceOpen}
        placement="bottom"
        posture={posture}
        returnFocusRef={returnFocusRef}
        title={`${label} workspace`}
      >
        <div id={responsiveWorkspacePanelId} tabIndex={-1}>
          {regions.bottom(workspaceTab, onWorkspaceTabChange)}
        </div>
      </ResponsiveShellSurface>
    );
  }

  if (renderedOverlay === "status" && identity.organization !== null) {
    const authenticated = identity.kind === "verified";
    return (
      <ResponsiveShellSurface
        key={renderedOverlay}
        onClose={onClose}
        open={surfaceOpen}
        posture={posture}
        returnFocusRef={returnFocusRef}
        title="Project status"
        description={
          authenticated
            ? "Verified organization context. Authoritative draft status is shown by server-backed route controls; browser recovery remains separate."
            : "Local editor projections only. No backend, billing, job, compiler, or export service is connected."
        }
      >
        {authenticated && route.params.projectId !== undefined ? (
          <nav aria-label="Project file tools" className="project-file-tools">
            <AppLink
              id="project-revisions-link"
              to={
                "/organizations/" +
                encodeURIComponent(identity.organization.id) +
                "/projects/" +
                encodeURIComponent(route.params.projectId) +
                "/revisions"
              }
            >
              Revisions and exports
            </AppLink>
            <p>Save a revision, then review the available export formats.</p>
          </nav>
        ) : null}
        <dl className="project-status-list">
          <div>
            <dt>Organization</dt>
            <dd>
              {identity.organization.name}
              {identity.kind === "verified" ? " · verified" : " · local mock"}
            </dd>
          </div>
          <div>
            <dt>{authenticated ? "Project route" : "Project"}</dt>
            <dd>
              {authenticated
                ? (route.params.projectId ?? "No project selected")
                : (project?.name ?? "No authorized project context")}
            </dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>
              {project?.lifecycle ??
                (authenticated
                  ? "Server-backed context"
                  : "Local shell preview")}
            </dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd>
              {authenticated
                ? "Open the editor environment selector for the current view"
                : "Unknown · read-only presentation"}
            </dd>
          </div>
          <div>
            <dt>Revision review</dt>
            <dd id={responsiveRevisionPlaceholderId} tabIndex={-1}>
              {authenticated
                ? "Open the project revision route for immutable Solution Revision status."
                : "Review revision unavailable - no persisted revision or backend acknowledgement exists."}
            </dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>
              {authenticated
                ? "Bound value and provider availability are shown in the editor"
                : "Bound value shown in editor · provider availability not reviewed"}
            </dd>
          </div>
          <div>
            <dt>Save</dt>
            <dd>
              {authenticated
                ? "Use server-backed route controls · local recovery is separate"
                : "Backend unavailable · local recovery is separate"}
            </dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>
              <ModeSwitch />
            </dd>
          </div>
          <div>
            <dt>AI credits</dt>
            <dd>
              {authenticated
                ? "Open organization Usage for metering and availability"
                : "Unavailable · usage service not connected"}
            </dd>
          </div>
          <div>
            <dt>Validation</dt>
            <dd>Open Issues for availability and current report status</dd>
          </div>
          <div>
            <dt>Jobs</dt>
            <dd>
              {authenticated
                ? "Open the relevant workflow for job progress and availability"
                : "Unavailable · no job service"}
            </dd>
          </div>
          <div>
            <dt>Export</dt>
            <dd>
              {authenticated
                ? "Open a Solution Revision for artifact and export eligibility"
                : "Unavailable · no immutable artifact"}
            </dd>
          </div>
        </dl>
        {regions === undefined ? null : (
          <button
            className="button button--secondary"
            onClick={onResetWorkspaceLayout}
            type="button"
          >
            Reset workspace layout
          </button>
        )}
      </ResponsiveShellSurface>
    );
  }

  if (renderedOverlay === "notifications") {
    return (
      <ResponsiveShellSurface
        className="notifications-popup-surface"
        key={renderedOverlay}
        onClose={onClose}
        open={surfaceOpen}
        posture={posture}
        returnFocusRef={returnFocusRef}
        title="Notifications"
        description="Notifications from this tab. Opening this list marks them as read."
      >
        {history.length === 0 ? (
          <div className="drawer-empty" role="status">
            <h3>No notifications in this tab</h3>
            <p>
              Activity stays here while this tab is open. A reload starts a new
              history.
            </p>
          </div>
        ) : (
          <>
            {unreadCount > 0 ? (
              <Button
                variant="quiet"
                onClick={() => {
                  markNotificationsRead(history.map((item) => item.id));
                }}
              >
                Mark all as read
              </Button>
            ) : null}
            <ol
              className="notification-history"
              aria-label="Notification history"
            >
              {history.map((notification) => (
                <li key={notification.id}>
                  <StatusBadge
                    label={notification.kind}
                    tone={notification.kind}
                  />
                  <strong>{notification.title}</strong>
                  <span>{notification.read ? "Read" : "Unread"}</span>
                  {notification.message === undefined ? null : (
                    <p>{notification.message}</p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </ResponsiveShellSurface>
    );
  }

  if (renderedOverlay === "account") {
    return (
      <ResponsiveShellSurface
        className="account-popup-surface"
        dismissOnOutside
        key={renderedOverlay}
        onClose={onClose}
        open={surfaceOpen}
        posture={posture}
        returnFocusRef={returnFocusRef}
        title={
          identity.kind === "verified"
            ? "Authenticated account"
            : "Local mock account"
        }
        description={
          identity.kind === "verified"
            ? "Your account and preferences."
            : "This synthetic identity is not authenticated or server-authoritative."
        }
      >
        <AccountMenu
          identity={identity}
          organizationId={navigationOrganizationId}
          onClose={onClose}
          onOpenNotifications={onOpenNotifications}
          onResetWorkspaceLayout={onResetWorkspaceLayout}
          hasWorkspace={regions !== undefined}
        />
      </ResponsiveShellSurface>
    );
  }

  return null;
}

function PhoneWorkspaceNavigation({
  activeOverlay,
  onOpenCatalog,
  onOpenMore,
  onOpenWorkspace,
}: {
  readonly activeOverlay: Overlay;
  readonly onOpenCatalog: () => void;
  readonly onOpenMore: () => void;
  readonly onOpenWorkspace: (tab: WorkspaceTab) => void;
}) {
  return (
    <nav
      aria-label="Phone workspace navigation"
      className="phone-workspace-navigation"
    >
      <a data-shell-focus-region="main" href="#architecture-workspace">
        Architecture
      </a>
      <button
        aria-controls={responsiveCatalogPanelId}
        aria-expanded={activeOverlay === "catalog"}
        aria-haspopup="dialog"
        data-shell-focus-region="catalog"
        onClick={onOpenCatalog}
        type="button"
      >
        Catalog
      </button>
      <button
        aria-controls={responsiveWorkspacePanelId}
        aria-expanded={activeOverlay === "workspace"}
        aria-haspopup="dialog"
        data-shell-focus-region="workspace"
        data-workspace-tab="issues"
        onClick={() => {
          onOpenWorkspace("issues");
        }}
        type="button"
      >
        Issues
      </button>
      <button
        aria-controls={responsiveWorkspacePanelId}
        aria-expanded={activeOverlay === "workspace"}
        aria-haspopup="dialog"
        data-shell-focus-region="workspace"
        data-workspace-tab="activity"
        onClick={() => {
          onOpenWorkspace("activity");
        }}
        type="button"
      >
        Activity
      </button>
      <button
        aria-controls="application-navigation"
        aria-expanded={activeOverlay === "navigation"}
        aria-haspopup="dialog"
        data-shell-focus-region="navigation"
        onClick={onOpenMore}
        type="button"
      >
        More
      </button>
    </nav>
  );
}
