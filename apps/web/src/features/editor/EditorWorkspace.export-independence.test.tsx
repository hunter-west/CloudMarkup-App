import { WorkspaceShellControllerContext } from "../../shell/workspace-shell-context.js";
import {
  getArchitectureDocumentCanonicalHash,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

import { awsIconRegistry } from "../../provider-icons/aws-icon-registry.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import { loadAwsNetworkingVisualArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import {
  ExperiencePreferenceProvider,
  ModePreferenceProvider,
  useModePreference,
} from "../../preferences/index.js";
import type { InspectorTab } from "../../shell/AppShell.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
} from "./session/index.js";
import { EditorMain, InspectorPanel } from "./EditorWorkspace.js";

function createSequentialIds(): () => string {
  let sequence = 0;
  return () => `op_export_ui_${String(++sequence).padStart(4, "0")}`;
}

function DiagramExportSourceProbe({
  observeDocument,
}: {
  readonly observeDocument: (document: ArchitectureDocument) => void;
}) {
  const session = useEditorDocumentSession();
  const architectureDocument =
    session.status === "ready" ? session.document : null;

  useEffect(() => {
    if (architectureDocument !== null) {
      observeDocument(architectureDocument);
    }
  }, [architectureDocument, observeDocument]);

  const source =
    session.status === "ready"
      ? serializeCanonicalJson({
          architectureDocument: session.document,
          revisionArchitectureBinding: {
            contentHash: session.hashes.contentHash,
            documentHash: getArchitectureDocumentCanonicalHash(
              session.document,
            ),
            visualHash: session.hashes.visualHash,
          },
        })
      : "unavailable";

  return (
    <output data-testid="diagram-export-source" hidden>
      {source}
    </output>
  );
}

function ExportIndependenceHarness({
  observeDocument,
}: {
  readonly observeDocument: (document: ArchitectureDocument) => void;
}) {
  const { mode, setMode } = useModePreference();
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] =
    useState<InspectorTab>("architecture");

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
      <button
        type="button"
        onClick={() => {
          setMode(mode === "guided" ? "professional" : "guided");
        }}
      >
        {mode === "guided"
          ? "Use professional assistance"
          : "Use guided assistance"}
      </button>
      <button
        type="button"
        onClick={() => {
          setInspectorOpen((current) => !current);
        }}
      >
        {inspectorOpen ? "Hide inspector panel" : "Show inspector panel"}
      </button>
      <button
        type="button"
        onClick={() => {
          setInspectorTab("configure");
        }}
      >
        Show configure inspector
      </button>
      <EditorMain fixtureMode={false} projectId="export-independence-test" />
      {inspectorOpen ? (
        <InspectorPanel
          activeTab={inspectorTab}
          onActiveTabChange={setInspectorTab}
        />
      ) : null}
      <DiagramExportSourceProbe observeDocument={observeDocument} />
    </WorkspaceShellControllerContext.Provider>
  );
}

function renderExportIndependenceEditor(
  observeDocument: (document: ArchitectureDocument) => void,
) {
  Object.defineProperties(window, {
    innerHeight: { configurable: true, value: 1_000 },
    innerWidth: { configurable: true, value: 2_000 },
  });
  return render(
    <ModePreferenceProvider actorId="export-independence-test" storage={null}>
      <ExperiencePreferenceProvider
        actorId="export-independence-test"
        storage={null}
      >
        <EditorSessionProvider
          catalog={awsEditorCatalog}
          createId={createSequentialIds()}
          document={loadAwsNetworkingVisualArchitectureDocument()}
          iconRegistry={awsIconRegistry}
        >
          <ExportIndependenceHarness observeDocument={observeDocument} />
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
    throw new Error(`Architecture node ${nodeId} did not render.`);
  }
  return node;
}

function exportSource(): string {
  return screen.getByTestId("diagram-export-source").textContent;
}

describe("editor diagram-export independence", () => {
  it("keeps the immutable export source outside collapse, mode, minimap, panel, and disclosure state", async () => {
    const observedDocuments: ArchitectureDocument[] = [];
    const observeDocument = (architectureDocument: ArchitectureDocument) => {
      observedDocuments.push(architectureDocument);
    };
    renderExportIndependenceEditor(observeDocument);

    await waitFor(() => {
      expect(exportSource()).not.toBe("unavailable");
    });
    const editor = document.querySelector<HTMLElement>(".architecture-editor");
    if (editor === null || observedDocuments[0] === undefined) {
      throw new Error("The export-independence editor did not become ready.");
    }
    const initialSource = exportSource();
    const initialDocument = observedDocuments[0];
    const initialDocumentBytes = serializeCanonicalJson(initialDocument);
    const initialContentHash = editor.dataset["contentHash"];
    const initialVisualHash = editor.dataset["visualHash"];
    const expectUnchangedExportSource = () => {
      expect(exportSource()).toBe(initialSource);
      expect(serializeCanonicalJson(initialDocument)).toBe(
        initialDocumentBytes,
      );
      expect(
        observedDocuments.every((candidate) => candidate === initialDocument),
      ).toBe(true);
      expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
      expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);
    };

    const minimap = screen.getByRole("img", {
      name: "Architecture overview",
    });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(minimap).toBeVisible();
    expectUnchangedExportSource();

    const nat = architectureNode("node_nat_gateway_a");
    fireEvent.click(
      within(nat).getByRole("button", { name: "Expand NAT gateway · AZ A" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: /NAT gateway.*AZ A/u }),
      ).getByRole("button", {
        name: "Explain NAT gateway · AZ A",
      }),
    );
    expect(screen.getByRole("tabpanel", { name: "Learn" })).toBeVisible();
    expectUnchangedExportSource();
    fireEvent.keyDown(document, { key: "Escape" });

    const vpc = architectureNode("node_network_vpc");
    fireEvent.click(within(vpc).getByRole("button", { name: "Hide contents" }));
    expect(
      document.querySelector(
        '[data-architecture-node-id="node_availability_zone_a"]',
      ),
    ).toBeNull();
    expectUnchangedExportSource();

    fireEvent.click(
      screen.getByRole("button", { name: "Use professional assistance" }),
    );
    expect(editor).toHaveAttribute("data-editor-mode", "professional");
    expectUnchangedExportSource();

    fireEvent.click(
      screen.getByRole("button", { name: "Show configure inspector" }),
    );
    expect(
      screen.getByRole("heading", { name: "Document selection" }),
    ).toBeVisible();
    expectUnchangedExportSource();
    fireEvent.click(
      screen.getByRole("button", { name: "Hide inspector panel" }),
    );
    expect(
      screen.queryByRole("heading", { name: "Document selection" }),
    ).toBeNull();
    expectUnchangedExportSource();
    fireEvent.click(
      screen.getByRole("button", { name: "Show inspector panel" }),
    );
    expect(
      screen.getByRole("heading", { name: "Document selection" }),
    ).toBeVisible();
    expectUnchangedExportSource();
  }, 15_000);
});
