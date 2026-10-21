import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuidedNextAction } from "./GuidedNextAction.js";
import { EditorIssueIndicator } from "./EditorIssueIndicator.js";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  mode: vi.fn(),
  focus: vi.fn(),
  openIssues: vi.fn(),
  openCatalog: vi.fn(),
  catalogOpen: vi.fn(),
  inspectorOpen: vi.fn(),
}));
vi.mock("../../../preferences/index.js", () => ({
  useModePreference: mocks.mode,
}));
vi.mock("../../../shell/workspace-shell-context.js", () => ({
  useWorkspaceShellController: () => ({
    openWorkspacePanel: mocks.openIssues,
    openCatalogPanel: mocks.openCatalog,
    overlays: {
      catalog: { open: mocks.catalogOpen() === true },
      inspector: { open: mocks.inspectorOpen() === true },
    },
  }),
}));
vi.mock("../session/index.js", () => ({
  useEditorDocumentSession: mocks.session,
  useEditorSessionStoreApi: () => ({
    getState: () => ({ setValidationFocus: mocks.focus }),
  }),
}));
const hashes = { contentHash: "current", visualHash: "layout" };
const finding = {
  findingId: "finding_missing_role",
  code: "role-missing",
  title: "Add an execution role",
  severity: "error",
  affected: [{ kind: "node", nodeId: "handler", path: "$.nodes[0]" }],
};
const report = {
  target: "draft",
  evaluationStatus: "complete",
  findings: [finding],
};
const session = {
  catalog: {
    services: [{ serviceType: "aws.lambda.function", nodeKind: "resource" }],
  },
  status: "ready",
  document: {
    nodes: [
      { id: "handler", semantic: { serviceType: "aws.lambda.function" } },
    ],
  },
  hashes,
  validation: {
    status: "current",
    snapshot: {
      hashes,
      draftReport: report,
      compilationReport: {
        ...report,
        target: "compilation",
        findings: [{ ...finding, severity: "warning" }],
      },
    },
  },
};
beforeEach(() => {
  mocks.mode.mockReturnValue({ mode: "guided" });
  mocks.session.mockReturnValue(session);
  mocks.catalogOpen.mockReturnValue(false);
  mocks.inspectorOpen.mockReturnValue(false);
});
describe("current issue guidance", () => {
  it("counts a shared finding once and opens its review without a mutation", () => {
    render(
      <>
        <GuidedNextAction />
        <EditorIssueIndicator />
      </>,
    );
    expect(screen.getByLabelText("1 issue")).toHaveTextContent("1");
    expect(screen.getByLabelText("1 issue")).toHaveClass(
      "editor-issue-count--error",
    );
    fireEvent.click(screen.getByRole("button", { name: "Review issue" }));
    expect(mocks.openIssues).toHaveBeenCalledWith("issues");
    expect(mocks.focus).toHaveBeenCalledWith({
      findingId: finding.findingId,
      location: finding.affected[0],
      target: "draft",
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
    expect(screen.queryByLabelText("Recommended next action")).toBeNull();
  });
  it("withholds findings when validation belongs to another graph", () => {
    mocks.session.mockReturnValue({
      ...session,
      hashes: { ...hashes, contentHash: "changed" },
    });
    render(
      <>
        <GuidedNextAction />
        <EditorIssueIndicator />
      </>,
    );
    expect(screen.queryByLabelText("Recommended next action")).toBeNull();
    expect(screen.getByLabelText("Checking issues")).toBeVisible();
  });
  it("keeps Professional mode hands off", () => {
    mocks.mode.mockReturnValue({ mode: "professional" });
    render(<GuidedNextAction />);
    expect(screen.queryByLabelText("Recommended next action")).toBeNull();
  });
  it("avoids duplicate blank-canvas advice and stays out of an active panel", () => {
    mocks.session.mockReturnValue({
      ...session,
      document: { nodes: [] },
    });
    const view = render(<GuidedNextAction />);
    expect(screen.queryByLabelText("Recommended next action")).toBeNull();

    mocks.session.mockReturnValue(session);
    mocks.catalogOpen.mockReturnValue(true);
    view.rerender(<GuidedNextAction />);
    expect(screen.queryByLabelText("Recommended next action")).toBeNull();

    mocks.catalogOpen.mockReturnValue(false);
    view.rerender(<GuidedNextAction />);
    expect(screen.getByLabelText("Recommended next action")).toBeVisible();
  });
});
