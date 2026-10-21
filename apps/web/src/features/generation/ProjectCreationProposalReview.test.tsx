import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { loadBlankAwsEditorArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import { ProjectCreationProposalReview } from "./ProjectCreationProposalReview.js";
const hooks = vi.hoisted(() => ({ session: vi.fn(), runtime: vi.fn() }));
vi.mock("../editor/session/index.js", () => ({
  useEditorDocumentSession: hooks.session,
}));
vi.mock("../../api/index.js", () => ({
  useOptionalCloudMarkupQueryRuntime: hooks.runtime,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup({ editing = true, expired = false, stale = false } = {}) {
  const document = loadBlankAwsEditorArchitectureDocument("us-east-1");
  const apply = vi.fn(() => ({ ok: true }));
  let id = 0;
  hooks.session.mockReturnValue({
    status: "ready",
    document,
    catalog: awsEditorCatalog,
    createId: () => "operation_create_review_" + String(++id),
    applyReviewedCommand: apply,
  });
  hooks.runtime.mockReturnValue({ sessionExpired: expired });
  const onClose = vi.fn();
  render(
    <ProjectCreationProposalReview
      editingAvailable={editing}
      onClose={onClose}
      proposal={{
        architectureDigest: stale
          ? "0".repeat(64)
          : digestCanonicalValue(document),
        credits: {
          contractVersion: 1,
          jobId: "job_setup",
          state: "settled",
          estimatedCreditUnits: "3",
          maximumCreditUnits: "100",
          actualCreditUnits: "2",
        },
        proposal: {
          contractVersion: 1,
          summary: "An application function.",
          resources: [
            {
              key: "function",
              serviceType: "aws.lambda.function",
              label: "Handler",
              parentKey: null,
            },
          ],
          connections: [],
          limitations: ["Supply application code."],
        },
      }}
    />,
  );
  return { apply, onClose };
}
it("prepares the diagram but applies only after explicit review", () => {
  const { apply, onClose } = setup();
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByText("Handler")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Use this diagram" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review checks and assumptions" }),
  );
  expect(screen.getByText("Used 2 credits (estimated 3).")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Use this diagram" }));
  expect(apply).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});
it.each([{ editing: false }, { expired: true }])(
  "cannot apply after editing access is lost: %j",
  (options) => {
    const { apply } = setup(options);
    fireEvent.click(
      screen.getByRole("button", { name: "Review checks and assumptions" }),
    );
    const button = screen.getByRole("button", { name: "Use this diagram" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
  },
);
it("rejects a stale draft before proposing a command", () => {
  const { apply } = setup({ stale: true });
  expect(screen.getByRole("alert")).toHaveTextContent("draft changed");
  fireEvent.click(
    screen.getByRole("button", { name: "Review checks and assumptions" }),
  );
  expect(
    screen.getByRole("button", { name: "Use this diagram" }),
  ).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});
it("allows cancellation without mutating the saved project", () => {
  const { apply, onClose } = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "Continue with empty project" }),
  );
  expect(apply).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});
