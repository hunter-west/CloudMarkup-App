import "@xyflow/react/dist/style.css";
import "@cloudmarkup/ui/styles.css";
import "../../styles.css";

import type { ReactElement } from "react";

import { App } from "../../App.js";
import { getModePreferenceStorageKey } from "../../preferences/index.js";
import type { ExperienceMode } from "../../preferences/index.js";

const EDITOR_PATH = "/organizations/local-org/projects/field-notes/editor";
const WAIT_TIMEOUT_MS = 4_000;

interface StoryPlayContext {
  readonly canvasElement: HTMLElement;
}

interface EditorVisualStory {
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly play?: (context: StoryPlayContext) => Promise<void>;
  readonly render: () => ReactElement;
}

interface EditorFixtureOptions {
  readonly height?: number;
  readonly mode?: ExperienceMode;
  readonly reducedMotion?: boolean;
  readonly search?: string;
  readonly storyId: string;
  readonly width?: number;
}

const meta = {
  parameters: {
    layout: "fullscreen",
  },
  title: "Editor/Manual architecture editor",
};

export default meta;

function prepareEditorFixture({
  height = 900,
  mode = "guided",
  reducedMotion = false,
  search,
  storyId,
  width = 1440,
}: EditorFixtureOptions): ReactElement {
  Object.defineProperties(window, {
    innerHeight: {
      configurable: true,
      value: height,
    },
    innerWidth: {
      configurable: true,
      value: width,
    },
  });

  const searchParameters = new URLSearchParams(window.location.search);
  searchParameters.delete("fixture");
  const requestedFixture =
    search === undefined ? null : new URLSearchParams(search).get("fixture");
  if (requestedFixture !== null) {
    searchParameters.set("fixture", requestedFixture);
  }
  const normalizedSearch = searchParameters.toString();
  const locationSuffix = `${normalizedSearch.length === 0 ? "" : `?${normalizedSearch}`}${window.location.hash}`;
  window.history.replaceState(
    window.history.state,
    "",
    `${EDITOR_PATH}${locationSuffix}`,
  );

  try {
    window.localStorage.setItem(getModePreferenceStorageKey(), mode);
  } catch {
    // The real preference provider exposes its unavailable-storage fallback.
  }

  if (reducedMotion) {
    document.documentElement.dataset["cmReducedMotion"] = "true";
  } else {
    delete document.documentElement.dataset["cmReducedMotion"];
  }

  return (
    <div
      data-cm-reduced-motion={reducedMotion ? "true" : undefined}
      style={{ blockSize: height, inlineSize: width }}
    >
      <App key={storyId} />
    </div>
  );
}

function createEditorStory(
  options: EditorFixtureOptions,
  play?: (context: StoryPlayContext) => Promise<void>,
): EditorVisualStory {
  return {
    parameters: {
      layout: "fullscreen",
    },
    ...(play === undefined ? {} : { play }),
    render: () => prepareEditorFixture(options),
  };
}

function storyDocument(context: StoryPlayContext): Document {
  return context.canvasElement.ownerDocument;
}

async function waitForElement<T extends Element>(
  find: () => T | null,
  description: string,
): Promise<T> {
  const startedAt = performance.now();

  while (performance.now() - startedAt < WAIT_TIMEOUT_MS) {
    const element = find();
    if (element !== null) {
      return element;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 16);
    });
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

function findButton(
  documentRoot: ParentNode,
  accessibleName: string,
  match: "exact" | "prefix" = "exact",
): HTMLButtonElement | null {
  const buttons = documentRoot.querySelectorAll<HTMLButtonElement>("button");

  for (const button of buttons) {
    const name = button.getAttribute("aria-label") ?? button.textContent.trim();
    const matches =
      match === "prefix"
        ? name.startsWith(accessibleName)
        : name === accessibleName;

    if (matches) {
      return button;
    }
  }

  return null;
}

async function waitForCatalogCard(
  context: StoryPlayContext,
): Promise<HTMLElement> {
  const card = await waitForElement(
    () =>
      storyDocument(context).querySelector<HTMLElement>("[data-service-id]"),
    "a catalog service card",
  );
  card.scrollIntoView({ block: "nearest" });
  return card;
}

async function clickButton(
  context: StoryPlayContext,
  accessibleName: string,
  match: "exact" | "prefix" = "exact",
): Promise<HTMLButtonElement> {
  const button = await waitForElement(
    () => findButton(storyDocument(context), accessibleName, match),
    `the "${accessibleName}" control`,
  );
  button.click();
  return button;
}

async function toggleFixtureDetails(
  context: StoryPlayContext,
): Promise<HTMLDetailsElement> {
  const disclosure = await waitForElement(
    () =>
      storyDocument(context).querySelector<HTMLDetailsElement>(
        ".architecture-fixture-status__disclosure",
      ),
    "the local fixture details disclosure",
  );
  const summary = disclosure.querySelector<HTMLElement>(":scope > summary");
  if (summary === null) {
    throw new Error("The local fixture disclosure summary did not render.");
  }
  summary.click();
  return disclosure;
}

async function waitForDisclosureState(
  disclosure: HTMLDetailsElement,
  expanded: boolean,
): Promise<void> {
  await waitForElement(
    () => (disclosure.open === expanded ? disclosure : null),
    `the local fixture disclosure to become ${
      expanded ? "expanded" : "collapsed"
    }`,
  );
}

async function waitForExpandedState(
  button: HTMLButtonElement,
  expanded: boolean,
): Promise<void> {
  await waitForElement(
    () =>
      button.getAttribute("aria-expanded") === String(expanded) ? button : null,
    `${button.getAttribute("aria-label") ?? "control"} to become ${
      expanded ? "expanded" : "collapsed"
    }`,
  );
}

async function waitForShellState(
  context: StoryPlayContext,
  state: {
    readonly catalog: boolean;
    readonly inspector: boolean;
    readonly workspace: boolean;
  },
): Promise<HTMLElement> {
  return waitForElement(
    () =>
      storyDocument(context).querySelector<HTMLElement>(
        `.workspace-shell[data-catalog-open="${String(
          state.catalog,
        )}"][data-inspector-open="${String(
          state.inspector,
        )}"][data-workspace-open="${String(state.workspace)}"]`,
      ),
    "the requested floating editor panel state",
  );
}

async function waitForCompactCatalogActions(
  context: StoryPlayContext,
): Promise<HTMLElement> {
  const card = await waitForCatalogCard(context);
  await waitForElement(
    () =>
      card.querySelector<HTMLElement>(
        '.service-catalog-card__actions .cm-button[data-size="compact"][data-variant="secondary"]',
      ),
    "the compact secondary Details action",
  );
  await waitForElement(
    () =>
      card.querySelector<HTMLElement>(
        '.service-catalog-card__actions .cm-button[data-size="compact"][data-variant="primary"]',
      ),
    "the compact primary Add action",
  );
  return card;
}

interface LayoutRectangle {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const sharedLayoutSelectors = {
  actions: '[role="toolbar"][aria-label="Editor actions"]',
  appBar: ".top-app-bar",
  catalog: ".workspace-shell__catalog",
  inspector: ".workspace-shell__inspector-launcher",
} as const;

async function waitForEditorHeaderActions(
  context: StoryPlayContext,
): Promise<HTMLElement> {
  return waitForElement(() => {
    const toolbar = storyDocument(context).querySelector<HTMLElement>(
      sharedLayoutSelectors.actions,
    );
    if (toolbar === null) {
      return null;
    }

    const labels = [
      ...toolbar.querySelectorAll<HTMLButtonElement>("button"),
    ].map(
      (button) =>
        button.getAttribute("aria-label") ?? button.textContent.trim(),
    );
    return labels.some((label) => label.startsWith("Undo")) &&
      labels.some((label) => label.startsWith("Redo")) &&
      !labels.includes("Commands") &&
      labels.includes("Open Canvas menu") &&
      labels.includes("Help and keyboard shortcuts")
      ? toolbar
      : null;
  }, "the compact editor header actions");
}

function readSharedLayoutFoundation(
  context: StoryPlayContext,
): Record<keyof typeof sharedLayoutSelectors, LayoutRectangle> {
  return Object.fromEntries(
    Object.entries(sharedLayoutSelectors).map(([key, selector]) => {
      const element =
        storyDocument(context).querySelector<HTMLElement>(selector);
      if (element === null) {
        throw new Error(
          `The shared layout element "${selector}" did not render.`,
        );
      }
      const { height, width, x, y } = element.getBoundingClientRect();
      return [key, { height, width, x, y }];
    }),
  ) as Record<keyof typeof sharedLayoutSelectors, LayoutRectangle>;
}

function assertSharedLayoutFoundation(
  guided: Record<keyof typeof sharedLayoutSelectors, LayoutRectangle>,
  professional: Record<keyof typeof sharedLayoutSelectors, LayoutRectangle>,
): void {
  for (const key of Object.keys(
    sharedLayoutSelectors,
  ) as (keyof typeof sharedLayoutSelectors)[]) {
    for (const dimension of ["height", "width", "x", "y"] as const) {
      if (Math.abs(guided[key][dimension] - professional[key][dimension]) > 1) {
        throw new Error(
          `${key} ${dimension} changed between Guided and Professional.`,
        );
      }
    }
  }
}

async function waitForMode(
  context: StoryPlayContext,
  mode: ExperienceMode,
): Promise<HTMLElement> {
  return waitForElement(
    () =>
      storyDocument(context).documentElement.dataset["mode"] === mode
        ? storyDocument(context).documentElement
        : null,
    `the ${mode} presentation mode`,
  );
}

async function selectLambdaFixtureNode(
  context: StoryPlayContext,
): Promise<HTMLElement> {
  const node = await waitForElement(
    () =>
      storyDocument(context).querySelector<HTMLElement>(
        '.react-flow__node[data-id="node_api_handler"]',
      ),
    "the Lambda fixture node",
  );
  const view = storyDocument(context).defaultView;
  if (view === null) {
    throw new Error("The Storybook document does not expose a window.");
  }
  node.dispatchEvent(
    new view.MouseEvent("dblclick", { bubbles: true, button: 0 }),
  );
  await waitForElement(
    () =>
      storyDocument(context).querySelector<HTMLElement>(
        '[aria-label="Implementation readiness"]',
      ),
    "the Lambda implementation readiness section",
  );
  return node;
}

async function openLambdaDataDock(
  context: StoryPlayContext,
): Promise<HTMLElement> {
  const node = await waitForElement(
    () =>
      storyDocument(context).querySelector<HTMLElement>(
        '.react-flow__node[data-id="node_api_handler"]',
      ),
    "the Lambda fixture node",
  );
  const expand = findButton(node, "Expand Notes API handler");
  if (expand !== null) {
    expand.click();
    await waitForElement(
      () => findButton(node, "Collapse Notes API handler"),
      "the expanded Lambda service",
    );
  }
  const trigger = await waitForElement(
    () =>
      [...node.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button
          .getAttribute("aria-label")
          ?.startsWith("Open Data & storage output connections"),
      ) ?? null,
    "the Lambda Data connection dock",
  );
  trigger.click();
  await waitForExpandedState(trigger, true);
  return waitForElement(
    () =>
      [
        ...storyDocument(context).querySelectorAll<HTMLElement>(
          '[role="dialog"]',
        ),
      ].find((candidate) =>
        candidate
          .getAttribute("aria-label")
          ?.startsWith("Data & storage output connections"),
      ) ?? null,
    "the open Lambda Data dock menu",
  );
}

async function clickInspectorTab(
  context: StoryPlayContext,
  label: string,
): Promise<HTMLElement> {
  const tab = await waitForElement(
    () =>
      [
        ...storyDocument(context).querySelectorAll<HTMLElement>('[role="tab"]'),
      ].find((candidate) => candidate.textContent.trim() === label) ?? null,
    `the ${label} Inspector tab`,
  );
  tab.click();
  return tab;
}

const API_CONNECTION_DIALOG_TITLE =
  "Connect API Gateway HTTP API to Lambda function";

async function openApiGatewayConnectionDialog(
  context: StoryPlayContext,
): Promise<HTMLElement> {
  const documentRoot = storyDocument(context);
  const existingApiNodeIds = new Set(
    [
      ...documentRoot.querySelectorAll<HTMLElement>(
        '.react-flow__node[data-id^="node_apigateway_http_api"]',
      ),
    ].flatMap((node) => {
      const nodeId = node.getAttribute("data-id");
      return nodeId === null ? [] : [nodeId];
    }),
  );

  await clickButton(context, "Add API Gateway HTTP API to canvas");
  const apiNode = await waitForElement(
    () =>
      [
        ...documentRoot.querySelectorAll<HTMLElement>(
          '.react-flow__node[data-id^="node_apigateway_http_api"]',
        ),
      ].find((node) => {
        const nodeId = node.getAttribute("data-id");
        return nodeId !== null && !existingApiNodeIds.has(nodeId);
      }) ?? null,
    "the newly added API Gateway fixture node",
  );

  const view = storyDocument(context).defaultView;
  if (view === null) {
    throw new Error("The Storybook document does not expose a window.");
  }
  apiNode.dispatchEvent(
    new view.MouseEvent("dblclick", { bubbles: true, button: 0 }),
  );
  await clickInspectorTab(context, "Connect");
  await clickButton(
    context,
    "Connect API Gateway HTTP API using Route invocation output capability",
  );

  const dialog = await waitForElement(
    () =>
      [...documentRoot.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
        (candidate) =>
          candidate.textContent.includes(API_CONNECTION_DIALOG_TITLE),
      ) ?? null,
    `the ${API_CONNECTION_DIALOG_TITLE} dialog`,
  );
  await waitForElement(
    () => dialog.querySelector<HTMLElement>('[data-stage="setup-connection"]'),
    "the connection setup stage",
  );
  return dialog;
}

function replaceInputValue(input: HTMLInputElement, value: string): void {
  const view = input.ownerDocument.defaultView;
  const valueDescriptor =
    view === null
      ? undefined
      : Object.getOwnPropertyDescriptor(
          view.HTMLInputElement.prototype,
          "value",
        );
  if (view === null || valueDescriptor?.set === undefined) {
    throw new Error("The Storybook input value setter is unavailable.");
  }

  input.focus();
  valueDescriptor.set.call(input, value);
  input.dispatchEvent(new view.Event("input", { bubbles: true }));
  input.dispatchEvent(new view.Event("change", { bubbles: true }));
}

async function openConnectionReview(
  context: StoryPlayContext,
): Promise<HTMLElement> {
  const dialog = await openApiGatewayConnectionDialog(context);
  const route = await waitForElement(
    () => dialog.querySelector<HTMLInputElement>('input[id$="-routeKey"]'),
    "the required API route decision",
  );
  replaceInputValue(route, "GET /notes");
  const review = await waitForElement(() => {
    const button = findButton(storyDocument(context), "Review connection");
    return button !== null && !button.disabled ? button : null;
  }, "the enabled Review connection action");
  review.click();
  await waitForElement(
    () =>
      dialog.querySelector<HTMLElement>('[data-stage="review-and-connect"]'),
    "the concise connection review",
  );
  return dialog;
}

async function expandConnectionTechnicalDetails(
  dialog: HTMLElement,
): Promise<HTMLDetailsElement> {
  const details = await waitForElement(
    () =>
      dialog.querySelector<HTMLDetailsElement>(
        "details.connection-wizard__technical",
      ),
    "the connection Technical details disclosure",
  );
  const summary = details.querySelector<HTMLElement>(":scope > summary");
  if (summary === null) {
    throw new Error("The connection Technical details summary did not render.");
  }
  if (!details.open) {
    summary.click();
  }
  await waitForElement(
    () => (details.open ? details : null),
    "the expanded connection Technical details",
  );
  return details;
}

export const FullCanvasWithCompactLaunchers: EditorVisualStory =
  createEditorStory(
    {
      storyId: "full-canvas-with-compact-launchers",
    },
    async (context) => {
      await waitForShellState(context, {
        catalog: true,
        inspector: false,
        workspace: false,
      });
      await waitForElement(
        () =>
          storyDocument(context).querySelector<HTMLElement>(
            ".architecture-canvas__flow",
          ),
        "the full architecture canvas",
      );
      await waitForElement(() => {
        const button = findButton(storyDocument(context), "Architecture");
        return button?.getAttribute("aria-expanded") === "false"
          ? button
          : null;
      }, "the idle compact Inspector launchers");
      await waitForElement(() => {
        const button = findButton(storyDocument(context), "Issues");
        return button?.getAttribute("aria-expanded") === "false"
          ? button
          : null;
      }, "the idle compact Workspace launchers");
    },
  );

export const CompactHeaderCanvasMenuOpen: EditorVisualStory = createEditorStory(
  {
    storyId: "compact-header-canvas-menu-open",
  },
  async (context) => {
    const toolbar = await waitForEditorHeaderActions(context);
    toolbar.scrollIntoView({ block: "nearest" });
    const trigger = await clickButton(context, "Open Canvas menu");
    await waitForExpandedState(trigger, true);
    await waitForElement(() => {
      const menu = storyDocument(context).querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Canvas actions"]',
      );
      return menu !== null &&
        [
          "Arrange automatically",
          "Fit architecture",
          "Architecture list",
        ].every((label) => menu.textContent.includes(label))
        ? menu
        : null;
    }, "the open Canvas menu and its primary actions");
  },
);

export const CompactHeaderHelpOpen: EditorVisualStory = createEditorStory(
  {
    storyId: "compact-header-help-open",
  },
  async (context) => {
    const toolbar = await waitForEditorHeaderActions(context);
    toolbar.scrollIntoView({ block: "nearest" });
    await clickButton(context, "Help and keyboard shortcuts");
    await waitForElement(() => {
      const help =
        storyDocument(context).querySelector<HTMLElement>('[role="dialog"]');
      return help !== null &&
        help.textContent.includes("Keyboard shortcuts") &&
        help.textContent.includes("Ctrl/Command + K")
        ? help
        : null;
    }, "the open keyboard shortcut help dialog");
  },
);

export const GuidedProfessionalSharedLayoutFoundation: EditorVisualStory =
  createEditorStory(
    {
      mode: "guided",
      storyId: "guided-professional-shared-layout-foundation",
    },
    async (context) => {
      await waitForShellState(context, {
        catalog: true,
        inspector: false,
        workspace: false,
      });
      await waitForEditorHeaderActions(context);
      await waitForCompactCatalogActions(context);
      const guidedLayout = readSharedLayoutFoundation(context);

      await clickButton(context, "Professional");
      await waitForMode(context, "professional");
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            resolve();
          });
        });
      });

      await waitForEditorHeaderActions(context);
      await waitForCompactCatalogActions(context);
      assertSharedLayoutFoundation(
        guidedLayout,
        readSharedLayoutFoundation(context),
      );
    },
  );

export const CompactInspectorTabs: EditorVisualStory = createEditorStory(
  {
    storyId: "compact-inspector-tabs",
  },
  async (context) => {
    const launcher = await clickButton(context, "Configure");
    await waitForExpandedState(launcher, true);
    await waitForShellState(context, {
      catalog: true,
      inspector: true,
      workspace: false,
    });
    await waitForElement(() => {
      const tabs = storyDocument(context).querySelector<HTMLElement>(
        '.selected-inspector .cm-tabs[data-size="compact"]',
      );
      return tabs?.querySelectorAll('[role="tab"]').length === 4 ? tabs : null;
    }, "the four compact Inspector tabs");
  },
);

export const GuidedLambdaImplementationReadiness: EditorVisualStory =
  createEditorStory(
    {
      mode: "guided",
      storyId: "guided-lambda-implementation-readiness",
    },
    async (context) => {
      await selectLambdaFixtureNode(context);
      const implementation = await waitForElement(
        () =>
          storyDocument(context).querySelector<HTMLElement>(
            '[aria-label="Implementation readiness"]',
          ),
        "the Guided Lambda implementation readiness section",
      );
      implementation.scrollIntoView({ block: "nearest" });
    },
  );

export const ProfessionalLambdaCapabilityInventory: EditorVisualStory =
  createEditorStory(
    {
      mode: "professional",
      storyId: "professional-lambda-capability-inventory",
    },
    async (context) => {
      await selectLambdaFixtureNode(context);
      await clickInspectorTab(context, "Connect");
      const inventory = await waitForElement(
        () =>
          storyDocument(context).querySelector<HTMLElement>(
            '[aria-label="Available connection actions"]',
          ),
        "the Professional Lambda connection options",
      );
      await openSectionDisclosure(inventory, "Connection options", "prefix");
      inventory.scrollIntoView({ block: "nearest" });
    },
  );

export const ServiceInformationOpen: EditorVisualStory = createEditorStory(
  {
    mode: "guided",
    storyId: "service-information-open",
  },
  async (context) => {
    await waitForCatalogCard(context);
    const trigger = await clickButton(
      context,
      "More information about ",
      "prefix",
    );
    await waitForExpandedState(trigger, true);
  },
);

export const ServiceDetailsOpen: EditorVisualStory = createEditorStory(
  {
    mode: "guided",
    storyId: "service-details-open",
  },
  async (context) => {
    await waitForCatalogCard(context);
    await clickButton(context, "Show details for ", "prefix");
    await waitForElement(
      () => storyDocument(context).querySelector('[role="dialog"]'),
      "the service details dialog",
    );
  },
);

export const CatalogClosed: EditorVisualStory = createEditorStory(
  {
    storyId: "catalog-closed",
  },
  async (context) => {
    const button = await clickButton(context, "Hide Catalog");
    await waitForExpandedState(button, false);
    await waitForShellState(context, {
      catalog: false,
      inspector: false,
      workspace: false,
    });
  },
);

export const CatalogResizeEdgeFocused: EditorVisualStory = createEditorStory(
  {
    storyId: "catalog-resize-edge-focused",
  },
  async (context) => {
    const separator = await waitForElement(
      () =>
        storyDocument(context).querySelector<HTMLElement>(
          '[role="separator"][aria-label="Resize service catalog"]',
        ),
      "the Catalog resize edge",
    );
    separator.focus();
    await waitForElement(
      () =>
        storyDocument(context).activeElement === separator ? separator : null,
      "keyboard focus on the Catalog resize edge",
    );
  },
);

export const DevelopmentFixtureNoticeCollapsed: EditorVisualStory =
  createEditorStory(
    {
      storyId: "development-fixture-notice-collapsed",
    },
    async (context) => {
      await waitForElement(() => {
        const disclosure = storyDocument(
          context,
        ).querySelector<HTMLDetailsElement>(
          ".architecture-fixture-status__disclosure",
        );
        return disclosure?.open === false ? disclosure : null;
      }, "the collapsed development fixture notice");
    },
  );

export const DevelopmentFixtureNoticeExpanded: EditorVisualStory =
  createEditorStory(
    {
      storyId: "development-fixture-notice-expanded",
    },
    async (context) => {
      const disclosure = await toggleFixtureDetails(context);
      await waitForDisclosureState(disclosure, true);
    },
  );

export const IssuesWorkspaceOpen: EditorVisualStory = createEditorStory(
  {
    storyId: "issues-workspace-open",
  },
  async (context) => {
    const button = await clickButton(context, "Issues");
    await waitForExpandedState(button, true);
    await waitForShellState(context, {
      catalog: true,
      inspector: false,
      workspace: true,
    });
    await waitForElement(
      () =>
        storyDocument(context).querySelector<HTMLElement>(
          '[role="dialog"][aria-label="Issues workspace"]',
        ),
      "the open Issues workspace popup",
    );
  },
);

export const ArchitectureInspectorOpen: EditorVisualStory = createEditorStory(
  {
    storyId: "architecture-inspector-open",
  },
  async (context) => {
    const button = await clickButton(context, "Architecture");
    await waitForExpandedState(button, true);
    await waitForShellState(context, {
      catalog: true,
      inspector: true,
      workspace: false,
    });
    await waitForElement(
      () =>
        storyDocument(context).querySelector<HTMLElement>(
          '[role="dialog"][aria-label="Architecture inspector"]',
        ),
      "the open Architecture inspector popup",
    );
    await waitForElement(
      () =>
        storyDocument(context).querySelector<HTMLElement>(
          '#architecture-list[role="region"]',
        ),
      "the Architecture list inside the inspector popup",
    );
  },
);

export const CompactLambdaAggregateConnections: EditorVisualStory =
  createEditorStory(
    {
      storyId: "compact-lambda-aggregate-connections",
    },
    async (context) => {
      const node = await waitForElement(
        () =>
          storyDocument(context).querySelector<HTMLElement>(
            '.react-flow__node[data-id="node_api_handler"]',
          ),
        "the Lambda fixture node",
      );
      const outputs = await waitForElement(
        () =>
          [...node.querySelectorAll<HTMLButtonElement>("button")].find(
            (candidate) =>
              candidate
                .getAttribute("aria-label")
                ?.startsWith("Open outputs for Notes API handler"),
          ) ?? null,
        "the compact Lambda Outputs point",
      );
      outputs.click();
      await waitForExpandedState(outputs, true);
      await waitForElement(
        () =>
          storyDocument(context).querySelector<HTMLElement>(
            '[role="dialog"][aria-label="Outputs for Notes API handler"]',
          ),
        "the adjacent compact Outputs popup",
      );
    },
  );

export const ReducedMotion: EditorVisualStory = createEditorStory(
  {
    reducedMotion: true,
    storyId: "reduced-motion",
  },
  async (context) => {
    const disclosure = await toggleFixtureDetails(context);
    await waitForDisclosureState(disclosure, true);
  },
);

export const NotesApiMinimap: EditorVisualStory = createEditorStory(
  {
    storyId: "notes-api-minimap",
  },
  async (context) => {
    await waitForElement(() => {
      const minimap = storyDocument(context).querySelector<HTMLElement>(
        '[data-testid="rf__minimap"]',
      );
      return minimap?.querySelectorAll("[data-minimap-node-id]").length === 4
        ? minimap
        : null;
    }, "all four notes API nodes in the architecture minimap");
  },
);

export const LaptopWidthFloatingPanels: EditorVisualStory = createEditorStory(
  {
    height: 800,
    storyId: "laptop-width-floating-panels",
    width: 1280,
  },
  async (context) => {
    await waitForShellState(context, {
      catalog: true,
      inspector: false,
      workspace: false,
    });
    await waitForElement(
      () =>
        storyDocument(context).querySelector<HTMLElement>(
          ".architecture-canvas__flow",
        ),
      "the laptop-width full canvas",
    );
  },
);

export const ConciseConnectionDialog: EditorVisualStory = createEditorStory(
  {
    mode: "guided",
    storyId: "concise-connection-dialog",
  },
  async (context) => {
    const dialog = await openConnectionReview(context);
    const review = await waitForElement(() => {
      const stage = dialog.querySelector<HTMLElement>(
        '[data-stage="review-and-connect"]',
      );
      const technical = dialog.querySelector<HTMLDetailsElement>(
        "details.connection-wizard__technical",
      );
      const connect = findButton(storyDocument(context), "Connect");
      return stage !== null &&
        stage.textContent.includes("What will change") &&
        technical?.open === false &&
        connect !== null
        ? stage
        : null;
    }, "the concise primary connection summary with collapsed technical detail");
    review.scrollIntoView({ block: "start" });
  },
);

export const ConnectionTechnicalDetailsExpanded: EditorVisualStory =
  createEditorStory(
    {
      mode: "guided",
      storyId: "connection-technical-details-expanded",
    },
    async (context) => {
      const dialog = await openApiGatewayConnectionDialog(context);
      const details = await expandConnectionTechnicalDetails(dialog);
      await waitForElement(
        () =>
          details.textContent.includes(
            "aws.apigateway.http-api-invokes-lambda",
          ) && details.textContent.includes("Cardinality utilization")
            ? details
            : null,
        "the expanded rule, port, and cardinality details",
      );
      details.scrollIntoView({ block: "start" });
    },
  );

export const GuidedConnectionAssistance: EditorVisualStory = createEditorStory(
  {
    mode: "guided",
    storyId: "guided-connection-assistance",
  },
  async (context) => {
    await waitForMode(context, "guided");
    const dialog = await openApiGatewayConnectionDialog(context);
    const setup = await waitForElement(() => {
      const stage = dialog.querySelector<HTMLElement>(
        '[data-stage="setup-connection"]',
      );
      return stage !== null &&
        dialog.textContent.includes(
          "Guidance is shown inline; validation and the resulting change are the same.",
        ) &&
        stage.textContent.includes(
          "Routes one HTTP API method and path to a Lambda function.",
        )
        ? stage
        : null;
    }, "the Guided connection assistance copy");
    setup.scrollIntoView({ block: "start" });
  },
);

export const ProfessionalConnectionConciseText: EditorVisualStory =
  createEditorStory(
    {
      mode: "professional",
      storyId: "professional-connection-concise-text",
    },
    async (context) => {
      await waitForMode(context, "professional");
      const dialog = await openApiGatewayConnectionDialog(context);
      const setup = await waitForElement(() => {
        const stage = dialog.querySelector<HTMLElement>(
          '[data-stage="setup-connection"]',
        );
        return stage !== null &&
          dialog.textContent.includes(
            "Assistance is concise; validation and the resulting change are the same.",
          ) &&
          stage.textContent.includes(
            "Review the connection settings and declared consequences.",
          )
          ? stage
          : null;
      }, "the Professional concise connection copy");
      setup.scrollIntoView({ block: "start" });
    },
  );

export const GuidedStableConnectionDock: EditorVisualStory = createEditorStory(
  {
    mode: "guided",
    search: "?fixture=stable-connection-dock",
    storyId: "guided-stable-connection-dock",
  },
  async (context) => {
    await waitForMode(context, "guided");
    const menu = await openLambdaDataDock(context);
    await waitForElement(
      () =>
        menu.textContent.includes(
          "Connect the data stores this function reads or changes.",
        ) && menu.textContent.includes("Available connections")
          ? menu
          : null,
      "the Guided dock assistance and exact connection list",
    );
    menu.scrollIntoView({ block: "nearest" });
  },
);

export const ProfessionalStableConnectionDockReducedMotion: EditorVisualStory =
  createEditorStory(
    {
      mode: "professional",
      reducedMotion: true,
      search: "?fixture=stable-connection-dock",
      storyId: "professional-stable-connection-dock-reduced-motion",
    },
    async (context) => {
      await waitForMode(context, "professional");
      const menu = await openLambdaDataDock(context);
      await waitForElement(
        () =>
          menu.textContent.includes(
            "Read, write, and object capabilities share one anchor but keep exact ports and IAM effects.",
          ) && menu.textContent.includes("Available connections")
            ? menu
            : null,
        "the Professional dock metadata in reduced-motion mode",
      );
      menu.scrollIntoView({ block: "nearest" });
    },
  );

async function selectOwnedConfigurationIamRole(
  context: StoryPlayContext,
): Promise<HTMLElement> {
  const roleNode = await waitForElement(
    () =>
      storyDocument(context)
        .querySelector<HTMLElement>(
          '[data-architecture-node-id="node_iam_role_policy_fixture"]',
        )
        ?.closest<HTMLElement>(".react-flow__node") ?? null,
    "the graph-backed IAM role policy fixture",
  );
  const view = storyDocument(context).defaultView;
  if (view === null) {
    throw new Error("The Storybook document does not expose a window.");
  }
  roleNode.dispatchEvent(
    new view.MouseEvent("dblclick", { bubbles: true, button: 0 }),
  );
  await clickInspectorTab(context, "Configure");
  return waitForElement(
    () =>
      storyDocument(context).querySelector<HTMLElement>(".owned-configuration"),
    "the IAM role owned-configuration panel",
  );
}

async function findOwnedConfigurationSection(
  context: StoryPlayContext,
  title: string,
): Promise<HTMLElement> {
  const panel = await selectOwnedConfigurationIamRole(context);
  const section = await waitForElement(
    () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          "[data-owned-configuration-slot]",
        ),
      ].find(
        (candidate) => candidate.querySelector("h4")?.textContent === title,
      ) ?? null,
    `the ${title} owned-configuration section`,
  );
  section.scrollIntoView({ block: "start" });
  return section;
}

async function openSectionDisclosure(
  section: HTMLElement,
  summaryText: string,
  match: "exact" | "prefix" = "exact",
): Promise<HTMLDetailsElement> {
  const disclosure = await waitForElement(
    () =>
      [...section.querySelectorAll<HTMLDetailsElement>("details")].find(
        (candidate) =>
          match === "prefix"
            ? candidate
                .querySelector(":scope > summary")
                ?.textContent.trim()
                .startsWith(summaryText)
            : candidate
                .querySelector(":scope > summary")
                ?.textContent.trim() === summaryText,
      ) ?? null,
    `the ${summaryText} disclosure`,
  );
  const summary = disclosure.querySelector<HTMLElement>(":scope > summary");
  if (summary === null) {
    throw new Error(`The ${summaryText} disclosure has no summary.`);
  }
  if (!disclosure.open) {
    summary.click();
  }
  await waitForDisclosureState(disclosure, true);
  disclosure.scrollIntoView({ block: "nearest" });
  return disclosure;
}

function createIamRoleSectionStory(
  storyId: string,
  title: string,
  mode: ExperienceMode = "guided",
): EditorVisualStory {
  return createEditorStory(
    { mode, search: "?fixture=owned-configurations", storyId },
    async (context) => {
      await waitForMode(context, mode);
      await findOwnedConfigurationSection(context, title);
    },
  );
}

export const IamRolePermissionsSummary: EditorVisualStory = createEditorStory(
  {
    search: "?fixture=owned-configurations",
    storyId: "iam-role-permissions-summary",
  },
  async (context) => {
    const panel = await selectOwnedConfigurationIamRole(context);
    await waitForElement(
      () =>
        panel.textContent.includes("Owned configurations") &&
        panel.textContent.includes("Validation summary")
          ? panel
          : null,
      "the IAM role permissions and validation summary",
    );
    panel.scrollIntoView({ block: "start" });
  },
);

export const GeneratedPermissions: EditorVisualStory =
  createIamRoleSectionStory(
    "iam-role-generated-permissions",
    "Generated permissions",
  );

export const CustomInlinePolicies: EditorVisualStory =
  createIamRoleSectionStory(
    "iam-role-custom-inline-policies",
    "Custom inline policies",
  );

export const TrustPolicy: EditorVisualStory = createIamRoleSectionStory(
  "iam-role-trust-policy",
  "Trust policy",
);

export const ManagedPolicyAttachments: EditorVisualStory =
  createIamRoleSectionStory(
    "iam-role-managed-policy-attachments",
    "Managed attachments",
  );

export const PermissionsBoundary: EditorVisualStory = createIamRoleSectionStory(
  "iam-role-permissions-boundary",
  "Permissions boundary",
);

async function openPolicyEditor(
  context: StoryPlayContext,
): Promise<HTMLDetailsElement> {
  const section = await findOwnedConfigurationSection(
    context,
    "Custom inline policies",
  );
  const editor = await openSectionDisclosure(
    section,
    "Add Custom inline policies",
  );
  await waitForElement(
    () =>
      editor.textContent.includes("Policy details") &&
      editor.textContent.includes("Initial statement") &&
      editor.textContent.includes(
        "Principals are not permitted for this policy kind.",
      )
        ? editor
        : null,
    "the structured custom inline policy editor",
  );
  return editor;
}

export const GuidedPolicyEditor: EditorVisualStory = createEditorStory(
  {
    mode: "guided",
    search: "?fixture=owned-configurations",
    storyId: "guided-policy-editor",
  },
  async (context) => {
    await waitForMode(context, "guided");
    await openPolicyEditor(context);
  },
);

export const ProfessionalPolicyEditor: EditorVisualStory = createEditorStory(
  {
    mode: "professional",
    search: "?fixture=owned-configurations",
    storyId: "professional-policy-editor",
  },
  async (context) => {
    await waitForMode(context, "professional");
    await openPolicyEditor(context);
  },
);

export const TerraformSupportedPolicyTarget: EditorVisualStory =
  createEditorStory(
    {
      search: "?fixture=owned-configurations",
      storyId: "terraform-supported-policy-target",
    },
    async (context) => {
      const section = await findOwnedConfigurationSection(
        context,
        "Custom inline policies",
      );
      const readiness = await openSectionDisclosure(
        section,
        "Target readiness",
      );
      await waitForElement(
        () =>
          readiness.textContent.includes("Terraform export") &&
          readiness.textContent.includes("Supported")
            ? readiness
            : null,
        "the supported Terraform policy target state",
      );
    },
  );

async function findLambdaDockTrigger(
  context: StoryPlayContext,
  label: string,
  direction: "input" | "output",
): Promise<HTMLButtonElement> {
  const node = await waitForElement(
    () =>
      storyDocument(context).querySelector<HTMLElement>(
        '.react-flow__node[data-id="node_api_handler"]',
      ),
    "the Lambda fixture node",
  );
  return waitForElement(
    () =>
      [...node.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button
          .getAttribute("aria-label")
          ?.startsWith(`Open ${label} ${direction} connections`),
      ) ?? null,
    `the Lambda ${label} connection dock`,
  );
}

export const LambdaNoConnections: EditorVisualStory = createEditorStory(
  {
    storyId: "lambda-no-connections",
  },
  async (context) => {
    const node = await waitForElement(
      () =>
        storyDocument(context).querySelector<HTMLElement>(
          '.react-flow__node[data-id="node_api_handler"]',
        ),
      "the unconnected Lambda node",
    );
    await waitForElement(
      () =>
        node.querySelector("[data-connection-group-id]") === null ? node : null,
      "no inactive connection docks",
    );
    node.scrollIntoView({ block: "center", inline: "center" });
  },
);

export const LambdaSeveralConnectionGroups: EditorVisualStory =
  createEditorStory(
    {
      storyId: "lambda-several-connection-groups",
    },
    async (context) => {
      await selectLambdaFixtureNode(context);
      await clickInspectorTab(context, "Connect");
      const inventory = await waitForElement(
        () =>
          storyDocument(context).querySelector<HTMLElement>(
            '[aria-label="Available connection actions"]',
          ),
        "the grouped connection options",
      );
      await openSectionDisclosure(inventory, "Connection options", "prefix");
      inventory.scrollIntoView({ block: "nearest" });
    },
  );

export const OneDockSeveralEdges: EditorVisualStory = createEditorStory(
  {
    search: "?fixture=stable-connection-dock",
    storyId: "one-dock-several-edges",
  },
  async (context) => {
    const trigger = await findLambdaDockTrigger(
      context,
      "Data & storage",
      "output",
    );
    await waitForElement(
      () =>
        trigger.getAttribute("aria-label")?.includes("2 current connections")
          ? trigger
          : null,
      "the shared Data dock count for two exact semantic edges",
    );
    const menu = await openLambdaDataDock(context);
    const currentList = await waitForElement(() => {
      const list = menu.querySelector<HTMLUListElement>(
        ".architecture-connection-menu__list",
      );
      return list?.querySelectorAll(":scope > li").length === 2 ? list : null;
    }, "two current connections listed from one stable dock");
    currentList.scrollIntoView({ block: "nearest" });
  },
);

export const ScrollingConnectionList: EditorVisualStory = createEditorStory(
  {
    search: "?fixture=stable-connection-dock",
    storyId: "scrolling-connection-list",
  },
  async (context) => {
    const menu = await openLambdaDataDock(context);
    menu.style.blockSize = "11rem";
    menu.style.maxBlockSize = "11rem";
    menu.style.overflowY = "scroll";
    menu.scrollTop = menu.scrollHeight;
    const view = menu.ownerDocument.defaultView;
    if (view === null) {
      throw new Error("The dock menu does not expose a window.");
    }
    menu.dispatchEvent(new view.Event("scroll", { bubbles: false }));
    await waitForElement(
      () =>
        menu.scrollHeight > menu.clientHeight && menu.scrollTop > 0
          ? menu
          : null,
      "a genuinely scrolling connection list",
    );
  },
);

export const GroupedConnectionError: EditorVisualStory = createEditorStory(
  {
    search: "?fixture=stable-connection-dock",
    storyId: "grouped-connection-error",
  },
  async (context) => {
    const menu = await openLambdaDataDock(context);
    const error = await waitForElement(() => {
      const reasons = [
        ...menu.querySelectorAll<HTMLElement>(
          ".architecture-connection-menu__unavailable-reason",
        ),
      ];
      return (
        reasons.find((reason) => reason.textContent.trim().length > 0) ?? null
      );
    }, "the exact grouped-connection unavailable reason");
    error.scrollIntoView({ block: "nearest" });
  },
);

export const KeyboardFocusedConnectionDock: EditorVisualStory =
  createEditorStory(
    {
      search: "?fixture=stable-connection-dock",
      storyId: "keyboard-focused-connection-dock",
    },
    async (context) => {
      const trigger = await findLambdaDockTrigger(
        context,
        "Data & storage",
        "output",
      );
      trigger.focus();
      await waitForElement(
        () =>
          storyDocument(context).activeElement === trigger ? trigger : null,
        "keyboard focus on the stable Data dock",
      );
      await waitForElement(() => {
        const tooltip =
          storyDocument(context).querySelector<HTMLElement>('[role="tooltip"]');
        return tooltip?.textContent.trim() === "Output: Data & storage"
          ? tooltip
          : null;
      }, "the output dock name on keyboard focus");
      trigger.scrollIntoView({ block: "center", inline: "center" });
    },
  );

export const AwsNetworkingHierarchy: EditorVisualStory = createEditorStory(
  {
    height: 1_000,
    search: "?fixture=aws-networking",
    storyId: "aws-networking-hierarchy",
    width: 2_000,
  },
  async (context) => {
    const expectedLevels = [
      ["node_network_region", "outer"],
      ["node_network_vpc", "primary"],
      ["node_availability_zone_a", "secondary"],
      ["node_public_subnet_a", "tertiary"],
    ] as const;
    for (const [nodeId, level] of expectedLevels) {
      await waitForElement(
        () =>
          storyDocument(context).querySelector<HTMLElement>(
            `[data-architecture-node-id="${nodeId}"][data-boundary-level="${level}"]`,
          ),
        `${level} networking boundary ${nodeId}`,
      );
    }
    await waitForElement(
      () =>
        storyDocument(context).querySelector<SVGPathElement>(
          '.architecture-edge__path[data-visual-role="association"]',
        ),
      "a visible networking association edge",
    );
    const fit = findButton(storyDocument(context), "Fit architecture");
    fit?.click();
  },
);

export const AwsNetworkingLambdaVpcAccess: EditorVisualStory =
  createEditorStory(
    {
      height: 1_000,
      search: "?fixture=aws-networking",
      storyId: "aws-networking-lambda-vpc-access",
      width: 2_000,
    },
    async (context) => {
      await clickButton(context, "Expand Private application function");
      await clickButton(context, "Explain Private application function");
      const help = await waitForElement(
        () =>
          storyDocument(context).querySelector<HTMLElement>(
            '[role="dialog"][aria-label="Private application function information"]',
          ),
        "Lambda VPC access education",
      );
      await waitForElement(
        () =>
          help.textContent.includes("VPC access (1)") &&
          help.textContent.includes("Private subnet A") &&
          help.textContent.includes("Application security group")
            ? help
            : null,
        "Lambda subnet and security-group association evidence",
      );
      help.scrollIntoView({ block: "center", inline: "nearest" });
    },
  );
