import { parseArchitectureDocument } from "@cloudmarkup/domain";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceShellControllerContext } from "../../../shell/workspace-shell-context.js";
import { ModePreferenceProvider } from "../../../preferences/index.js";
import {
  foundationArchitectureInput,
  foundationEditorCatalog,
  foundationIconRegistry,
  mapArchitectureDocumentToFlow,
} from "../model/index.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
} from "../session/index.js";
import { ArchitectureTree } from "./ArchitectureTree.js";

function treeNode(nodeId: string): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>(
    `[data-architecture-tree-node-id="${nodeId}"]`,
  );
  if (node === null) {
    throw new Error(`Architecture tree node ${nodeId} did not render.`);
  }
  return node;
}

function InteractiveTree() {
  const session = useEditorDocumentSession();
  const document = session.document;
  if (document === null) {
    return <output>Architecture unavailable.</output>;
  }
  const model = mapArchitectureDocumentToFlow(
    document,
    foundationEditorCatalog,
  );
  const application = document.nodes.find(
    (node) => node.id === "node_application",
  );
  return (
    <>
      <output data-testid="architecture-tree-position">
        {application?.presentation.position.x},
        {application?.presentation.position.y}
      </output>
      <ArchitectureTree allowMovement model={model} showHeader={false} />
    </>
  );
}

describe("ArchitectureTree", () => {
  it("keeps an invalid non-boundary semantic child at the same root level as the canvas model", async () => {
    const architectureDocument = parseArchitectureDocument({
      ...foundationArchitectureInput,
      nodes: foundationArchitectureInput.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                parent: {
                  nodeId: "node_unknown",
                  relationshipType: "example.relationship.contained-by",
                },
              },
            }
          : node,
      ),
    });
    const model = mapArchitectureDocumentToFlow(
      architectureDocument,
      foundationEditorCatalog,
    );
    const application = model.nodes.find(
      (node) => node.id === "node_application",
    );
    const invalidParent = model.nodes.find(
      (node) => node.id === "node_unknown",
    );

    expect(
      architectureDocument.nodes.find((node) => node.id === "node_application")
        ?.semantic.parent?.nodeId,
    ).toBe("node_unknown");
    expect(invalidParent?.type).toBe("fallback");
    expect(application).toBeDefined();
    expect(application).not.toHaveProperty("parentId");

    let sequence = 0;
    render(
      <ModePreferenceProvider actorId="architecture-tree-test" storage={null}>
        <EditorSessionProvider
          catalog={foundationEditorCatalog}
          createId={() => {
            sequence += 1;
            return `operation_architecture_tree_${String(sequence).padStart(4, "0")}`;
          }}
          document={architectureDocument}
          iconRegistry={foundationIconRegistry}
        >
          <ArchitectureTree
            allowMovement={false}
            model={model}
            showHeader={false}
          />
        </EditorSessionProvider>
      </ModePreferenceProvider>,
    );

    await waitFor(() => {
      expect(treeNode("node_application")).toBeVisible();
    });
    const tree = screen.getByRole("region", { name: "Architecture list" });
    const rootList = within(tree).getByRole("list", {
      name: "Architecture elements",
    });
    const applicationItem = treeNode("node_application").closest("li");
    const invalidParentItem = treeNode("node_unknown").closest("li");

    expect(applicationItem?.parentElement).toBe(rootList);
    expect(invalidParentItem?.parentElement).toBe(rootList);
  });

  it("offers visible non-drag movement and a direct boundary-placement path through the shared command and inspector", async () => {
    const architectureDocument = parseArchitectureDocument(
      structuredClone(foundationArchitectureInput),
    );
    const application = architectureDocument.nodes.find(
      (node) => node.id === "node_application",
    );
    if (application === undefined) {
      throw new Error(
        "The architecture-list fixture requires an application node.",
      );
    }
    const applicationLabel = application.presentation.label;
    const openContextPanel = vi.fn();
    let sequence = 0;

    render(
      <WorkspaceShellControllerContext.Provider
        value={{
          focusArchitectureTarget: vi.fn(),
          openCatalogPanel: vi.fn(),
          openContextPanel,
          openRevisionPlaceholder: vi.fn(),
          openWorkspacePanel: vi.fn(),
          overlays: {
            catalog: { open: true },
            inspector: { open: false },
            safeArea: { bottom: 0, left: 0, right: 0 },
          },
          posture: "desktop",
        }}
      >
        <ModePreferenceProvider
          actorId="architecture-tree-actions"
          storage={null}
        >
          <EditorSessionProvider
            catalog={foundationEditorCatalog}
            createId={() => {
              sequence += 1;
              return `operation_architecture_tree_action_${String(sequence).padStart(4, "0")}`;
            }}
            document={architectureDocument}
            iconRegistry={foundationIconRegistry}
          >
            <InteractiveTree />
          </EditorSessionProvider>
        </ModePreferenceProvider>
      </WorkspaceShellControllerContext.Provider>,
    );

    fireEvent.click(
      screen.getByText(`Move or change boundary for ${applicationLabel}`),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Move right ${applicationLabel}` }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("architecture-tree-position"),
      ).toHaveTextContent(
        `${String(application.presentation.position.x + 16)},${String(application.presentation.position.y)}`,
      );
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: `Change boundary for ${applicationLabel}`,
      }),
    );
    expect(openContextPanel).toHaveBeenCalledWith(
      "selected-boundary-placement",
      "configure",
    );
  });
});
