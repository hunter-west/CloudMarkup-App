import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationProvider } from "../../../notifications/index.js";
import { ModePreferenceProvider } from "../../../preferences/index.js";
import {
  foundationEditorCatalog,
  foundationIconRegistry,
  loadFoundationArchitectureDocument,
  type LayoutAdapter,
} from "../model/index.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
  useEditorSessionState,
} from "../session/index.js";
import { AutomaticLayoutDialog } from "./AutomaticLayoutDialog.js";

const testLayoutAdapter: LayoutAdapter = {
  layout(request) {
    const positions = new Map([
      ["node_network", { x: 8, y: 8 }],
      ["node_zone", { x: 40, y: 160 }],
      ["node_application", { x: 48, y: 168 }],
      ["node_unknown", { x: 960, y: 40 }],
      ["node_unsupported", { x: 960, y: 440 }],
    ]);
    return Promise.resolve({
      positions: request.nodes.map((node) => ({
        nodeId: node.id,
        parentId: node.parentId ?? null,
        position: positions.get(node.id) ?? { x: 0, y: 0 },
      })),
    });
  },
};

function LayoutDialogHarness() {
  const session = useEditorDocumentSession();
  const preview = useEditorSessionState((state) =>
    state.previewPositions.get("node_application"),
  );

  return (
    <>
      <output data-testid="dialog-layout-status">
        {session.layoutWorkflow.status}
      </output>
      <output data-testid="dialog-layout-preview">
        {preview === undefined
          ? "none"
          : `${String(preview.x)},${String(preview.y)}`}
      </output>
      <output data-testid="dialog-content-hash">
        {session.status === "ready" ? session.hashes.contentHash : "none"}
      </output>
      <output data-testid="dialog-visual-hash">
        {session.status === "ready" ? session.hashes.visualHash : "none"}
      </output>
      <button
        onClick={() => {
          session.startAutomaticLayout();
        }}
        type="button"
      >
        Start layout test
      </button>
      <AutomaticLayoutDialog />
    </>
  );
}

function renderLayoutDialog() {
  let sequence = 0;
  return render(
    <NotificationProvider>
      <ModePreferenceProvider actorId="layout-dialog-test" storage={null}>
        <EditorSessionProvider
          catalog={foundationEditorCatalog}
          createId={() => {
            sequence += 1;
            return `operation_layout_dialog_${String(sequence).padStart(4, "0")}`;
          }}
          document={loadFoundationArchitectureDocument()}
          iconRegistry={foundationIconRegistry}
          layoutAdapter={testLayoutAdapter}
        >
          <LayoutDialogHarness />
        </EditorSessionProvider>
      </ModePreferenceProvider>
    </NotificationProvider>,
  );
}

describe("AutomaticLayoutDialog", () => {
  it("uses one preview and action tree while presentation copy changes", async () => {
    renderLayoutDialog();
    const contentHash = screen.getByTestId("dialog-content-hash").textContent;
    const visualHash = screen.getByTestId("dialog-visual-hash").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Start layout test" }));
    await screen.findByRole("dialog", { name: "Review automatic layout" });
    const positionList = screen.getByRole("list", {
      name: "Automatic layout position changes",
    });
    const guidedActionNames = screen
      .getAllByRole("button")
      .map((button) => button.textContent);

    expect(
      screen.getByText(/Only the resulting positions will be saved/),
    ).toBeVisible();
    expect(screen.getByTestId("dialog-layout-preview")).toHaveTextContent(
      "48,168",
    );
    expect(
      screen.getByRole("button", { name: "Apply positions (Ctrl+Enter)" }),
    ).toHaveAttribute("aria-keyshortcuts", "Control+Enter");
    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(
      screen.getByText(/Exact position-only Graph Command preview/),
    ).toBeVisible();
    expect(
      screen.getByRole("list", {
        name: "Automatic layout position changes",
      }),
    ).toBe(positionList);
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(guidedActionNames);
    expect(screen.getByText("node_application")).toBeVisible();
    expect(screen.getByTestId("dialog-layout-preview")).toHaveTextContent(
      "48,168",
    );
    expect(screen.getByTestId("dialog-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("dialog-visual-hash").textContent).toBe(
      visualHash,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("dialog-layout-status")).toHaveTextContent(
      "idle",
    );
    expect(screen.getByTestId("dialog-layout-preview")).toHaveTextContent(
      "none",
    );
    expect(screen.getByTestId("dialog-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("dialog-visual-hash").textContent).toBe(
      visualHash,
    );
  });

  it("supports keyboard confirmation after changing presentation mode", async () => {
    renderLayoutDialog();
    const contentHash = screen.getByTestId("dialog-content-hash").textContent;
    const visualHash = screen.getByTestId("dialog-visual-hash").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Start layout test" }));
    await screen.findByRole("dialog", { name: "Review automatic layout" });
    fireEvent.click(screen.getByRole("button", { name: "Professional" }));
    expect(
      screen.getByRole("button", { name: "Apply positions (Ctrl+Enter)" }),
    ).toHaveAttribute("aria-keyshortcuts", "Control+Enter");
    fireEvent.keyDown(document, { ctrlKey: true, key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("dialog-layout-status")).toHaveTextContent(
        "idle",
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("dialog-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("dialog-visual-hash").textContent).not.toBe(
      visualHash,
    );
  });

  it("ignores keyboard confirmation while another modal is topmost", async () => {
    renderLayoutDialog();
    const contentHash = screen.getByTestId("dialog-content-hash").textContent;
    const visualHash = screen.getByTestId("dialog-visual-hash").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Start layout test" }));
    await screen.findByRole("dialog", { name: "Review automatic layout" });

    const blockingModal = render(<div data-cm-modal-drawer="" />);
    fireEvent.keyDown(document, { ctrlKey: true, key: "Enter" });

    expect(screen.getByTestId("dialog-layout-status")).toHaveTextContent(
      "preview",
    );
    expect(screen.getByTestId("dialog-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("dialog-visual-hash").textContent).toBe(
      visualHash,
    );

    blockingModal.unmount();
    fireEvent.keyDown(document, { ctrlKey: true, key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("dialog-layout-status")).toHaveTextContent(
        "idle",
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("dialog-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("dialog-visual-hash").textContent).not.toBe(
      visualHash,
    );
  });
});
