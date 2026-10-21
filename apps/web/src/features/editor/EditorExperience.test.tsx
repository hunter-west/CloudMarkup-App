import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";

// This suite exercises the loaded editor, not module-download latency. Keep its
// module preparation outside individual interaction deadlines; deferred loading
// and abandoned navigation are covered by App.deferred-routes.test.tsx.
import "./EditorRoute.js";

function setViewport(width = 1440, height = 900): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
}

async function renderEditor(
  start: "blank" | "template",
  width = 1440,
  tool?: "import",
) {
  setViewport(width);
  window.history.replaceState(
    null,
    "",
    `/organizations/local-org/projects/field-notes/editor?start=${start}${tool === undefined ? "" : "&tool=" + tool}`,
  );
  const result = render(<App />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return result;
}

function editorRoot(): HTMLElement {
  const editor = document.querySelector<HTMLElement>(".architecture-editor");
  if (editor === null) {
    throw new Error("The architecture editor did not render.");
  }
  return editor;
}

function architectureNode(nodeId: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(
    `[data-architecture-node-id="${nodeId}"]`,
  );
  if (node === null) {
    throw new Error(`Architecture node ${nodeId} did not render.`);
  }
  return node;
}

function openCommandPalette(): HTMLElement {
  fireEvent.keyDown(document.body, { ctrlKey: true, key: "k" });
  return screen.getByRole("dialog", { name: "Command palette" });
}

async function runCommand(
  query: string,
  accessibleName: RegExp,
): Promise<void> {
  const palette = openCommandPalette();
  const search = within(palette).getByRole("searchbox", {
    name: "Search commands",
  });
  await waitFor(() => {
    expect(search).toHaveFocus();
  });
  fireEvent.change(search, { target: { value: query } });

  const command = within(palette).getByRole("button", {
    name: accessibleName,
  });
  fireEvent.keyDown(search, { key: "ArrowDown" });
  for (
    let index = 0;
    index < 32 && document.activeElement !== command;
    index += 1
  ) {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) {
      break;
    }
    fireEvent.keyDown(focused, { key: "ArrowDown" });
  }
  expect(command).toHaveFocus();

  // jsdom does not synthesize a native click from Enter, so complete the
  // browser activation sequence after proving keyboard focus reached it.
  fireEvent.keyDown(command, { key: "Enter" });
  fireEvent.click(command, { detail: 0 });
  fireEvent.keyUp(command, { key: "Enter" });

  await waitFor(() => {
    expect(
      screen.queryByRole("dialog", { name: "Command palette" }),
    ).not.toBeInTheDocument();
  });
}

describe("guided onboarding and professional productivity", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  // This full walkthrough includes dismissal, restart, seven steps, and a remount.

  it("resets an active walkthrough and restarts Professional users in Guided mode", async () => {
    await renderEditor("template");

    expect(
      await screen.findByRole("heading", { name: "Add a service" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Connect services" }),
    ).toBeVisible();

    await runCommand("restart walkthrough", /^Restart notes API walkthrough/u);
    expect(
      screen.getByRole("heading", { name: "Add a service" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));
    expect(screen.queryByTestId("guided-walkthrough")).not.toBeInTheDocument();

    await runCommand("restart walkthrough", /^Restart notes API walkthrough/u);
    expect(editorRoot()).toHaveAttribute("data-editor-mode", "guided");
    expect(screen.getByTestId("guided-walkthrough")).toHaveTextContent(
      "Step 1 of 7",
    );
  });

  it("keeps permission teaching truthful and exposes the revision placeholder from Project status", async () => {
    await renderEditor("template");

    expect(
      await screen.findByRole("heading", { name: "Add a service" }),
    ).toBeVisible();
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(
      screen.getByRole("heading", {
        name: "Understand generated permissions",
      }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    await waitFor(() => {
      expect(
        document.querySelector(".architecture-live-region"),
      ).toHaveTextContent(
        "No current relationship declares permission effects",
      );
    });
    expect(screen.getByRole("tab", { name: "Connect" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await runCommand("revision", /^Locate future revision review/u);
    expect(
      await screen.findByRole("dialog", { name: "Project status" }),
    ).toBeVisible();
    const revisionPlaceholder = document.getElementById(
      "responsive-review-revision-entry-point",
    );
    expect(revisionPlaceholder).toBeVisible();
    expect(revisionPlaceholder).toHaveAttribute("tabindex", "-1");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Project status" }),
      ).toHaveFocus();
    });
  });

  it("routes global-header Undo and Redo through the existing session history", async () => {
    await renderEditor("template");
    const applicationBar = screen.getByRole("banner", {
      name: "Application header",
    });
    const unavailableUndo = within(applicationBar).getByRole("button", {
      name: "Undo unavailable: nothing to undo",
    });
    const unavailableRedo = within(applicationBar).getByRole("button", {
      name: "Redo unavailable: nothing to redo",
    });
    expect(unavailableUndo).toBeDisabled();
    expect(unavailableRedo).toBeDisabled();

    const initialContentHash = editorRoot().dataset["contentHash"];
    const initialNodeIds = new Set(
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-architecture-node-id]",
        ),
      ].map((node) => node.dataset["architectureNodeId"]),
    );
    await runCommand("add lambda", /^Add Lambda function/u);
    const addedNode = [
      ...document.querySelectorAll<HTMLElement>("[data-architecture-node-id]"),
    ].find((node) => !initialNodeIds.has(node.dataset["architectureNodeId"]));
    const addedNodeId = addedNode?.dataset["architectureNodeId"];
    if (addedNodeId === undefined) {
      throw new Error(
        "Adding Lambda did not render one new architecture node.",
      );
    }
    const addedContentHash = editorRoot().dataset["contentHash"];
    expect(addedContentHash).not.toBe(initialContentHash);

    const undo = within(applicationBar).getByRole("button", {
      name: /^Undo /u,
    });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    await waitFor(() => {
      expect(editorRoot()).toHaveAttribute(
        "data-content-hash",
        initialContentHash,
      );
      expect(
        document.querySelector(`[data-architecture-node-id="${addedNodeId}"]`),
      ).toBeNull();
    });

    const redo = within(applicationBar).getByRole("button", {
      name: /^Redo /u,
    });
    expect(redo).toBeEnabled();
    fireEvent.click(redo);
    await waitFor(() => {
      expect(editorRoot()).toHaveAttribute(
        "data-content-hash",
        addedContentHash,
      );
      expect(architectureNode(addedNodeId)).toBeInTheDocument();
    });
  });

  it("does not stack Commands and Help over an active modal", async () => {
    await renderEditor("template");

    const palette = openCommandPalette();
    fireEvent.keyDown(document.body, { ctrlKey: true, key: "/" });
    expect(palette).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-cm-modal-drawer]")).toHaveLength(1);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Command palette" }),
      ).not.toBeInTheDocument();
    });

    fireEvent.keyDown(document.body, { ctrlKey: true, key: "/" });
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    fireEvent.keyDown(document.body, { ctrlKey: true, key: "k" });
    expect(help).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Command palette" }),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-cm-modal-drawer]")).toHaveLength(1);
  });
  it("keeps command matching deterministic and explains phone fit limits", async () => {
    await renderEditor("template", 390);

    const palette = openCommandPalette();
    const search = within(palette).getByRole("searchbox", {
      name: "Search commands",
    });
    fireEvent.change(search, { target: { value: "ISSUES" } });
    expect(
      within(palette).getByRole("button", { name: /^Open Issues/u }),
    ).toBeEnabled();

    fireEvent.change(search, { target: { value: "FIT" } });
    const fitArchitecture = within(palette).getByRole("button", {
      name: /^Fit architecture/u,
    });
    const fitSelection = within(palette).getByRole("button", {
      name: /^Fit selection/u,
    });
    expect(fitArchitecture).toBeDisabled();
    expect(fitSelection).toBeDisabled();
    expect(
      within(palette).getAllByText(
        "Fit requires the canvas available on tablet or desktop; use the Architecture list on phones.",
      ),
    ).toHaveLength(2);
  });

  it("opens catalog-sourced learning for a keyboard-selected resource", async () => {
    await renderEditor("template");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(architectureNode("node_cognito_user_pool")).toBeInTheDocument();
    });
    const selectedService = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.cognito.user-pool",
    );
    const officialDocumentation = selectedService?.education.documentation.find(
      (reference) =>
        reference.kind === "official" && reference.href.startsWith("https://"),
    );
    if (
      selectedService === undefined ||
      officialDocumentation?.kind !== "official"
    ) {
      throw new Error("Expected catalog-backed Cognito learning metadata.");
    }

    const inspectorTools = screen.getByRole("navigation", {
      name: "Inspector tools",
    });
    const architectureButton = within(inspectorTools).getByRole("button", {
      name: "Architecture",
    });
    fireEvent.click(architectureButton);
    const architectureInspector = await screen.findByRole("dialog", {
      name: "Architecture inspector",
    });
    const architectureList =
      architectureInspector.querySelector<HTMLElement>("#architecture-list");
    if (architectureList === null) {
      throw new Error("The synchronized architecture list did not render.");
    }

    const notesUsers = architectureList.querySelector<HTMLButtonElement>(
      '[data-architecture-tree-node-id="node_cognito_user_pool"]',
    );
    if (notesUsers === null) {
      throw new Error("The Notes users list action did not render.");
    }
    expect(notesUsers).toHaveAccessibleName(/Notes users/iu);
    notesUsers.focus();
    fireEvent.keyDown(notesUsers, { key: "Enter" });
    expect(notesUsers).toHaveAttribute("aria-current", "true");

    await runCommand("learn selection", /^Learn about selection/u);

    const learnTab = screen.getByRole("tab", { name: "Learn" });
    expect(learnTab).toHaveAttribute("aria-selected", "true");
    const panelId = learnTab.getAttribute("aria-controls");
    const learnPanel =
      panelId === null ? null : document.getElementById(panelId);
    if (learnPanel === null) {
      throw new Error("The Learn panel did not render.");
    }
    const selectedInspector = document.getElementById(
      "selected-resource-inspector",
    );
    if (selectedInspector === null) {
      throw new Error("The selected resource inspector did not render.");
    }

    expect(learnPanel).toHaveTextContent(selectedService.education.summary);
    expect(learnPanel).toHaveTextContent(
      selectedService.education.guidedExplanation,
    );
    expect(
      within(learnPanel).getByRole("heading", { name: "What to review" }),
    ).toBeVisible();
    expect(within(learnPanel).getByText("Connections")).toBeVisible();
    expect(within(learnPanel).getByText("Security")).toBeVisible();
    expect(within(learnPanel).getByText("Cost")).toBeVisible();
    expect(within(learnPanel).getByText("Operations")).toBeVisible();
    const officialLink = within(learnPanel)
      .getByText(officialDocumentation.title)
      .closest("a");
    expect(officialLink).toHaveAttribute("href", officialDocumentation.href);
    expect(
      within(learnPanel).getByRole("heading", {
        name: "Reliability and availability",
      }),
    ).toBeVisible();

    expect(
      within(learnPanel).queryByText("Glossary", { selector: "summary" }),
    ).not.toBeInTheDocument();
    const showMe = within(learnPanel).getByRole("button", {
      name: "Show me on the architecture",
    });
    expect(showMe).toBeEnabled();
    fireEvent.click(showMe);
    await waitFor(() => {
      expect(
        document.getElementById(
          "validation-architecture-node-node_cognito_user_pool",
        ),
      ).toHaveFocus();
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    await runCommand("learn selection", /^Learn about selection/u);
    const reopenedSelectedInspector = document.getElementById(
      "selected-resource-inspector",
    );
    if (reopenedSelectedInspector === null) {
      throw new Error("The selected resource inspector did not render.");
    }
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const selectedOverview = reopenedSelectedInspector.querySelector(
      ".selected-inspector__overview-disclosure",
    );
    const selectedOverviewSummary =
      selectedOverview?.querySelector(":scope > summary");
    if (
      selectedOverviewSummary === null ||
      selectedOverviewSummary === undefined
    ) {
      throw new Error("The selected resource summary did not render.");
    }
    fireEvent.click(selectedOverviewSummary);

    fireEvent.click(
      screen.getByText("Technical identity", { selector: "summary" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy stable identifier" }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("node_cognito_user_pool");
      expect(
        within(reopenedSelectedInspector).getByText(
          "Stable identifier node_cognito_user_pool copied.",
        ),
      ).toBeVisible();
    });

    fireEvent.click(architectureButton);
    const currentArchitectureInspector = await screen.findByRole("dialog", {
      name: "Architecture inspector",
    });
    const appClient =
      currentArchitectureInspector.querySelector<HTMLButtonElement>(
        '[data-architecture-tree-node-id="node_cognito_user_pool_client"]',
      );
    if (appClient === null) {
      throw new Error("The Notes web client list action did not render.");
    }
    fireEvent.click(appClient);
    await runCommand("learn selection", /^Learn about selection/u);
    const currentSelectedInspector = document.getElementById(
      "selected-resource-inspector",
    );
    if (currentSelectedInspector === null) {
      throw new Error("The selected resource inspector did not render.");
    }
    await waitFor(() => {
      expect(
        within(currentSelectedInspector).queryByText(
          "Stable identifier node_cognito_user_pool copied.",
        ),
      ).not.toBeInTheDocument();
    });
  });
});
