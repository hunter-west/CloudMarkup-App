import { useTourAnchor } from "./use-tour-anchor.js";
import { Button, Popover } from "@cloudmarkup/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";

import { useUsabilityEvents } from "../../instrumentation/usability-events.js";
import {
  useExperiencePreference,
  useModePreference,
  type EditorWalkthroughStepId,
} from "../../preferences/index.js";
import {
  focusWorkspaceShellTarget,
  useWorkspaceShellController,
} from "../../shell/workspace-shell-context.js";
import { resolveExactEditorCatalogRelationship } from "@cloudmarkup/graph-preparation/catalog-selection";
import {
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../editor/session/index.js";
import "./onboarding.css";

interface GuidedWalkthroughProps {
  readonly experienceFixture?: "notes-api" | undefined;
}

interface WalkthroughStep {
  readonly description: string;
  readonly id: EditorWalkthroughStepId;
  readonly title: string;
  readonly why: string;
}

const fixtureSteps: readonly WalkthroughStep[] = [
  {
    description:
      "Catalog is your toolbox. Find a service by name or purpose, then choose Add. You can drag it onto the canvas too.",
    id: "add",
    title: "Add a service",
    why: "Start with one service. You can always add more as your idea takes shape.",
  },
  {
    description:
      "Here are the settings for your selected service. Make a change, then preview it before applying.",
    id: "configure",
    title: "Select and configure it",
    why: "You stay in control: review what will change before saving your settings.",
  },
  {
    description:
      "Connect shows how your services can work together. Choose a connection and follow the short setup.",
    id: "connect",
    title: "Connect services",
    why: "The editor checks which services can connect and shows the access they need.",
  },
  {
    description:
      "Before connecting services, review the permissions in the preview. It explains what each service will be allowed to do.",
    id: "permissions",
    title: "Understand generated permissions",
    why: "Nothing changes until you confirm the complete preview.",
  },
  {
    description:
      "Issues gathers checks in one place. Open a finding to see what needs attention and review a suggested fix when available.",
    id: "validation",
    title: "Review a validation finding",
    why: "Some findings are review-only. They remain canonical, and any safe fix still requires confirmation.",
  },
  {
    description:
      "Project status shows your progress. This practice editor introduces revisions; saved project revisions are available in the signed-in workspace.",
    id: "revision",
    title: "Prepare for a future revision",
    why: "This local editor has no immutable revision or backend acknowledgement yet.",
  },
  {
    description:
      "Code is where to look for code and diagram tools. This practice editor shows the entry point; use a saved project for available export workflows.",
    id: "export",
    title: "Locate future exports",
    why: "No compiler artifact, code bundle, diagram export, or deployment is created here.",
  },
];

const editorSteps: readonly WalkthroughStep[] = [
  {
    id: "add",
    title: "Your backend starts here",
    description:
      "Catalog is your AWS toolbox. Search for a service, then add it to the canvas.",
    why: "Region groups your network. Services such as Lambda and S3 can sit outside VPC boxes and still use your project’s Region.",
  },
  {
    id: "configure",
    title: "Make each service your own",
    description:
      "Here are your service settings. Select a service on the canvas, make a change, then preview it before applying.",
    why: "Required fields and helpful defaults guide you through the settings that matter.",
  },
  {
    id: "learn",
    title: "A little help, right where you need it",
    description:
      "Learn explains the selected service, useful examples, and things to watch for. You can come back whenever a service is new to you.",
    why: "You do not need to learn every AWS service before you start.",
  },
  {
    id: "connect",
    title: "Connect the pieces",
    description:
      "Drag between the connection bubbles on any two services, or use Connect in Inspector. Choose what they should do together, then review the settings and permissions.",
    why: "Connections describe how your backend works, including the access each service needs.",
  },
  {
    id: "assistant",
    title: "Get help from AI",
    description:
      "Open Assistant to describe your idea and review suggestions. Check availability and the credit estimate before starting.",
    why: "AI suggestions need your review. Your architecture changes only when you accept a valid proposal.",
  },
  {
    id: "validation",
    title: "Catch issues early",
    description:
      "Issues brings checks into one place. Select a finding to see what needs attention and review an available fix.",
    why: "Resolve blocking findings before preparing code. Warnings explain tradeoffs worth reviewing.",
  },
  {
    id: "revision",
    title: "Save a milestone",
    description:
      "Finish your canvas edits and review Issues, then choose Create revision in the application header. This saves your current draft and freezes a version for export.",
    why: "Your draft stays editable. Later changes need a new revision before they can appear in an export.",
  },
  {
    id: "import",
    title: "Already have infrastructure code?",
    description:
      "First save a revision. In Code, connect GitHub, choose the repository, branch and pinned commit, then review supported Terraform or CloudFormation observations and any proposed changes. Repository files are not executed or automatically converted into an editable design.",
    why: "Import support is bounded. Unsupported constructs stay visible for review, and importing does not run your code.",
  },
  {
    id: "export",
    title: "Take your backend with you",
    description:
      "Open Revisions and exports in Project status, then choose your saved revision and an available format. Choose Generate export, review the completed files, and download the bundle. Infrastructure-only workloads need your application package before deployment.",
    why: "Exports belong to you. Cloud Markup does not deploy resources into your AWS account.",
  },
];

export function GuidedWalkthrough({
  experienceFixture,
}: GuidedWalkthroughProps) {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const selection = useEditorSessionState((state) => state.selection);
  const shell = useWorkspaceShellController();
  const hosted = useOptionalCloudMarkupQueryRuntime() !== null;
  const steps = hosted ? editorSteps : fixtureSteps;
  const { mode } = useModePreference();
  const preference = useExperiencePreference();
  const usabilityEvents = useUsabilityEvents();
  const [stepIndex, setStepIndex] = useState(() =>
    Math.max(
      0,
      steps.findIndex((step) => step.id === preference.editorWalkthroughStep),
    ),
  );
  const started = useRef(false);
  const focusStepAfterChange = useRef(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [mobilePortalHost, setMobilePortalHost] = useState<HTMLElement | null>(
    null,
  );
  const visible =
    (hosted || experienceFixture === "notes-api") &&
    session.status === "ready" &&
    (hosted || mode === "guided") &&
    preference.contextualTeachingEnabled &&
    preference.notesApiWalkthrough === "not-started";

  const targetStep = steps[stepIndex]?.id;
  const targetSelector =
    targetStep === "add"
      ? '#catalog-panel[data-expanded="true"], .workspace-catalog-surface'
      : ["configure", "learn", "connect", "permissions"].includes(
            targetStep ?? "",
          )
        ? '.editor-popup-surface--inspector[aria-hidden="false"], .editor-popup-surface--inspector:not([aria-hidden]), #inspector-panel'
        : hosted && targetStep === "revision"
          ? "#create-solution-revision, .top-app-bar__editor-actions"
          : hosted && targetStep === "export"
            ? "#project-revisions-link, #project-status-trigger"
            : targetStep === "revision"
              ? ".cm-drawer:has(#responsive-review-revision-entry-point), #project-status-trigger"
              : ".workspace-bottom-surface:not([aria-hidden]), #bottom-workspace";
  const {
    ref: tourRef,
    style: tourStyle,
    side: tourSide,
  } = useTourAnchor(targetSelector, visible && shell?.posture === "desktop");

  useEffect(() => {
    if (!visible) {
      started.current = false;
      return;
    }
    if (started.current || hosted) {
      return;
    }
    started.current = true;
    usabilityEvents.record({
      surface: "first-use",
      type: "walkthrough_started",
      walkthrough: "notes-api",
    });
  }, [hosted, usabilityEvents, visible]);

  useEffect(() => {
    if (!visible || shell?.posture !== "phone") return;
    // Phone tools are modal. Keep the tour inside their focus and inert boundary.
    const updateHost = () => {
      setMobilePortalHost(
        document.querySelector<HTMLElement>(
          "[data-cm-modal-drawer] [data-guided-tour-slot]",
        ),
      );
    };
    const observer = new MutationObserver(updateHost);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-cm-modal-drawer"],
    });
    queueMicrotask(updateHost);
    return () => {
      observer.disconnect();
    };
  }, [visible, shell?.posture]);

  useEffect(() => {
    if (!focusStepAfterChange.current) {
      return;
    }
    let focusTimer: number | undefined;
    const timer = window.setTimeout(() => {
      // Shell drawers schedule their initial focus after mounting. Hand it back
      // to the tour only after that handoff, without trapping focus here.
      focusTimer = window.setTimeout(() => {
        stepHeading.current?.focus();
        focusStepAfterChange.current = false;
      }, 0);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(focusTimer);
    };
  }, [stepIndex, mobilePortalHost]);

  const architectureDocument = session.document;
  if (!visible || architectureDocument === null) {
    return null;
  }

  const step = steps[stepIndex];
  if (step === undefined) {
    return null;
  }
  const selectedNode =
    selection?.kind === "node"
      ? architectureDocument.nodes.find((node) => node.id === selection.id)
      : undefined;
  const currentNode = selectedNode ?? architectureDocument.nodes[0];
  const activeStep: WalkthroughStep = step;
  const permissionEdge = architectureDocument.edges.find((edge) => {
    const relationship = resolveExactEditorCatalogRelationship(
      architectureDocument,
      edge,
      session.catalog,
    );
    return relationship !== undefined && relationship.iamEffects.length > 0;
  });

  function focusCurrentResource(tab: "configure" | "connect" | "learn") {
    if (currentNode === undefined && hosted) {
      shell?.openContextPanel("selected-resource-inspector", tab);
      store
        .getState()
        .announce(
          "Select a service on the canvas to explore its settings. You can continue the tour without adding anything.",
        );
      return;
    }
    if (currentNode === undefined) {
      shell?.openCatalogPanel("service-catalog-search");
      store
        .getState()
        .announce("Add a service first; the catalog search is focused.");
      return;
    }
    store.getState().setSelection({ id: currentNode.id, kind: "node" });
    shell?.openContextPanel("selected-resource-inspector", tab);
    store.getState().announce(`Selected ${currentNode.id} and opened ${tab}.`);
  }

  function showCurrentStep(
    targetStep: WalkthroughStep = activeStep,
    focusTarget = true,
  ) {
    switch (targetStep.id) {
      case "add":
        shell?.closePanels?.();
        shell?.openCatalogPanel("service-catalog-search");
        return;
      case "configure":
        focusCurrentResource("configure");
        return;
      case "learn":
        focusCurrentResource("learn");
        return;
      case "connect":
        focusCurrentResource("connect");
        return;
      case "permissions": {
        if (permissionEdge !== undefined) {
          store
            .getState()
            .setSelection({ id: permissionEdge.id, kind: "edge" });
          shell?.openContextPanel(
            `connection-permission-implications-${permissionEdge.id}`,
            "connect",
          );
          store
            .getState()
            .announce(
              `Selected ${permissionEdge.id} and focused its catalog-declared permission implications.`,
            );
          return;
        }

        focusCurrentResource("connect");
        store
          .getState()
          .announce(
            "No current relationship declares permission effects. Prepare a supported connection preview and review its Security section before confirming.",
          );
        return;
      }
      case "assistant":
        shell?.openWorkspacePanel("assistant");
        return;
      case "validation":
        shell?.openWorkspacePanel("issues", "validation-issues-panel");
        return;
      case "revision":
        if (hosted) {
          shell?.closePanels?.();
          if (focusTarget) {
            window.setTimeout(() => {
              focusWorkspaceShellTarget("create-solution-revision");
            }, 0);
          }
          return;
        }
        shell?.openRevisionPlaceholder();
        return;
      case "import":
        shell?.openWorkspacePanel("code", "repository-import-workspace");
        return;
      case "export":
        if (hosted) {
          shell?.openRevisionPlaceholder(
            focusTarget ? "project-revisions-link" : undefined,
          );
          return;
        }
        usabilityEvents.record({
          artifact: "code",
          surface: "walkthrough",
          type: "export_entry_point_opened",
        });
        shell?.openWorkspacePanel("code", "editor-code-workspace");
    }
  }

  function moveToStep(nextStepIndex: number) {
    focusStepAfterChange.current = true;
    const nextIndex = Math.max(0, Math.min(steps.length - 1, nextStepIndex));
    setStepIndex(nextIndex);
    const nextStep = steps[nextIndex];
    if (nextStep !== undefined) {
      preference.setEditorWalkthroughStep(nextStep.id);
      showCurrentStep(nextStep, false);
    }
  }

  function restoreProductivityFocus(message: string) {
    shell?.closePanels?.();
    store.getState().announce(message);
    window.setTimeout(() => {
      focusWorkspaceShellTarget("editor-shortcut-help-trigger");
    }, 0);
  }

  function completeWalkthrough() {
    preference.setWalkthroughStatus("completed");
    setStepIndex(0);
    if (!hosted)
      usabilityEvents.record({
        surface: "first-use",
        type: "walkthrough_completed",
        walkthrough: "notes-api",
      });
    restoreProductivityFocus("Walkthrough completed. Help is focused.");
  }

  function dismissWalkthrough() {
    preference.setWalkthroughStatus("dismissed");
    setStepIndex(0);
    restoreProductivityFocus("Walkthrough dismissed. Help is focused.");
  }

  const walkthrough = (
    <aside
      ref={tourRef}
      style={shell?.posture === "desktop" ? tourStyle : undefined}
      data-anchor-side={tourSide}
      aria-labelledby="guided-walkthrough-title"
      className="guided-walkthrough guided-walkthrough--editor"
      data-step={activeStep.id}
      data-posture={shell?.posture ?? "desktop"}
      data-testid="guided-walkthrough"
    >
      <div className="guided-walkthrough__progress">
        <p className="status-label">
          {hosted ? "A quick tour" : "Notes API walkthrough"}
        </p>
        <span>
          Step {String(stepIndex + 1)} of {String(steps.length)}
        </span>
      </div>
      {hosted ? (
        <progress
          className="guided-walkthrough__meter"
          aria-label="Tour progress"
          max={steps.length}
          value={stepIndex + 1}
        />
      ) : null}
      <div className="guided-walkthrough__content">
        <div>
          <h2 id="guided-walkthrough-title" ref={stepHeading} tabIndex={-1}>
            {activeStep.title}
          </h2>
          <p>{activeStep.description}</p>
        </div>
        <Popover
          key={activeStep.id}
          label="Why this matters"
          trigger={<span aria-hidden="true">i</span>}
          triggerLabel="Why this walkthrough step matters"
        >
          <p>{activeStep.why}</p>
        </Popover>
      </div>
      <div className="guided-walkthrough__actions">
        <Button
          onClick={() => {
            showCurrentStep();
          }}
          size="compact"
          type="button"
          variant="secondary"
        >
          Show me
        </Button>
        <Button
          disabled={stepIndex === 0}
          size="compact"
          onClick={() => {
            moveToStep(stepIndex - 1);
          }}
          type="button"
          variant="quiet"
        >
          Previous
        </Button>
        {stepIndex === steps.length - 1 ? (
          <Button
            onClick={completeWalkthrough}
            size="compact"
            type="button"
            variant="primary"
          >
            Complete walkthrough
          </Button>
        ) : (
          <Button
            size="compact"
            onClick={() => {
              moveToStep(stepIndex + 1);
            }}
            type="button"
            variant="primary"
          >
            Next
          </Button>
        )}
        <Button
          onClick={dismissWalkthrough}
          size="compact"
          type="button"
          variant="quiet"
        >
          Dismiss
        </Button>
      </div>
    </aside>
  );
  return createPortal(
    walkthrough,
    shell?.posture === "phone"
      ? (mobilePortalHost ?? document.body)
      : document.body,
  );
}
