import { useState } from "react";
import { WorkspaceShellControllerContext } from "../../shell/workspace-shell-context.js";
import type { InspectorTab } from "../../shell/AppShell.js";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { awsIconRegistry } from "../../provider-icons/aws-icon-registry.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import { loadAwsNetworkingVisualArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import {
  ExperiencePreferenceProvider,
  ModePreferenceProvider,
  useModePreference,
} from "../../preferences/index.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
} from "./session/index.js";
import { EditorMain, InspectorPanel } from "./EditorWorkspace.js";

function createSequentialIds(): () => string {
  let sequence = 0;
  return () => `operation_networking_ui_${String(++sequence).padStart(4, "0")}`;
}

function NetworkingHistoryStatus() {
  const session = useEditorDocumentSession();
  return session.status === "ready" ? (
    <output data-testid="networking-history-status" hidden>
      {`${String(session.history.canUndo)}|${String(session.history.canRedo)}`}
    </output>
  ) : null;
}
function NetworkingModeSwitch() {
  const { setMode } = useModePreference();
  return (
    <button
      type="button"
      onClick={() => {
        setMode("professional");
      }}
    >
      Professional
    </button>
  );
}

function NetworkingPanels() {
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("configure");
  return (
    <WorkspaceShellControllerContext.Provider
      value={{
        posture: "desktop",
        overlays: {
          catalog: { open: false },
          inspector: { open: true },
          safeArea: { left: 0, right: 0, bottom: 0 },
        },
        focusArchitectureTarget: () => undefined,
        openRevisionPlaceholder: () => undefined,
        openCatalogPanel: () => undefined,
        openWorkspacePanel: () => undefined,
        openContextPanel: (_target, tab) => {
          if (tab) setInspectorTab(tab);
        },
      }}
    >
      <EditorMain fixtureMode={false} projectId="networking-ui-test" />
      <InspectorPanel
        activeTab={inspectorTab}
        onActiveTabChange={setInspectorTab}
      />
    </WorkspaceShellControllerContext.Provider>
  );
}
function renderNetworkingEditor() {
  Object.defineProperties(window, {
    innerHeight: { configurable: true, value: 1_000 },
    innerWidth: { configurable: true, value: 2_000 },
  });
  return render(
    <ModePreferenceProvider actorId="networking-ui-test" storage={null}>
      <ExperiencePreferenceProvider actorId="networking-ui-test" storage={null}>
        <EditorSessionProvider
          catalog={awsEditorCatalog}
          createId={createSequentialIds()}
          document={loadAwsNetworkingVisualArchitectureDocument()}
          iconRegistry={awsIconRegistry}
        >
          <NetworkingModeSwitch />
          <NetworkingPanels />
          <NetworkingHistoryStatus />
          <InspectorPanel
            activeTab="architecture"
            onActiveTabChange={() => undefined}
          />
        </EditorSessionProvider>
      </ExperiencePreferenceProvider>
    </ModePreferenceProvider>,
  );
}

function architectureNode(nodeId: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(
    `[data-architecture-node-id="${nodeId}"]`,
  );
  if (node === null) {
    throw new Error(`Networking architecture node ${nodeId} did not render.`);
  }
  return node;
}

function expandResource(node: HTMLElement, label: string): void {
  fireEvent.click(
    within(node).getByRole("button", { name: `Expand ${label}` }),
  );
  expect(node).toHaveAttribute("data-collapsed", "false");
}

describe("AWS networking editor presentation", () => {
  it("does not reopen a descendant connection dialog after collapsing and expanding its VPC", async () => {
    renderNetworkingEditor();
    await waitFor(() => {
      expect(architectureNode("node_network_vpc")).toBeVisible();
    });

    const vpc = architectureNode("node_network_vpc");
    const nat = architectureNode("node_nat_gateway_a");
    expandResource(nat, "NAT gateway · AZ A");
    const [dockTrigger] = within(
      screen.getByRole("dialog", { name: /NAT gateway.*AZ A/u }),
    ).getAllByRole("button", {
      name: /^Open .+ (?:input|output) connections for NAT gateway · AZ A;/u,
    });
    if (dockTrigger === undefined) {
      throw new Error("The NAT gateway must expose an exact connection dock.");
    }
    fireEvent.click(dockTrigger);
    const dialogName = /(?:input|output) connections for NAT gateway · AZ A$/u;
    expect(screen.getByRole("dialog", { name: dialogName })).toBeVisible();

    fireEvent.click(within(vpc).getByRole("button", { name: "Hide contents" }));
    expect(
      document.querySelector(
        '[data-architecture-node-id="node_nat_gateway_a"]',
      ),
    ).toBeNull();
    expect(screen.queryByRole("dialog", { name: dialogName })).toBeNull();

    fireEvent.click(within(vpc).getByRole("button", { name: "Show contents" }));
    await waitFor(() => {
      expect(architectureNode("node_nat_gateway_a")).toBeVisible();
    });
    expect(screen.queryByRole("dialog", { name: dialogName })).toBeNull();
  });
});
