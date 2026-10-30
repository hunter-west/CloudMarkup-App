import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  betaInfrastructureProposalV6Schema,
  betaProposalApplicabilityReceiptV1Schema,
  digestCanonicalValue,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { applyGraphCommand } from "@cloudmarkup/domain";
import { loadBlankAwsEditorArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import { ProjectCreationProposalReview } from "./ProjectCreationProposalReview.js";
import { prepareBetaInfrastructureProposal } from "./beta-infrastructure-proposal.js";
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
type ProofFault =
  | "missing"
  | "architectureDigest"
  | "catalogDigest"
  | "proposalDigest"
  | "commandDigest"
  | "resultDigest";
function setup({
  editing = true,
  expired = false,
  stale = false,
  proofFault,
  assessment = false,
}: {
  editing?: boolean;
  expired?: boolean;
  stale?: boolean;
  proofFault?: ProofFault;
  assessment?: boolean;
} = {}) {
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
  const suggestion = betaInfrastructureProposalV6Schema.parse({
    contractVersion: 6,
    summary: "A private files bucket.",
    resources: assessment
      ? []
      : [
          {
            key: "files",
            serviceType: "aws.s3.bucket",
            label: "Files",
            parentKey: null,
          },
        ],
    existingResources: [],
    connections: [],
    updates: [],
    limitations: ["Supply application code separately."],
    review: {
      intent: "Private uploads",
      assumptions: [],
      checks: ["Review data retention."],
      questions: [],
    },
  });
  const command = assessment
    ? null
    : prepareBetaInfrastructureProposal({
        document,
        catalog: awsEditorCatalog,
        proposal: suggestion,
        createId: () => "synthetic_proof_id",
      }).command;
  const receipt = betaProposalApplicabilityReceiptV1Schema.parse({
    contractVersion: 1,
    validatorVersion: "beta-applicability-v1",
    architectureDigest: digestCanonicalValue(document),
    catalogDigest: document.catalog.digest,
    proposalDigest: digestCanonicalValue(suggestion),
    commandDigest: command ? digestCanonicalValue(command) : null,
    resultDigest: digestCanonicalValue(
      command ? applyGraphCommand(document, command).document : document,
    ),
    kind: command ? "mutation" : "questions-or-assessment",
  });
  if (proofFault && proofFault !== "missing")
    receipt[proofFault] = sha256DigestSchema.parse("sha256:" + "0".repeat(64));
  const handoff = {
    architectureDigest: stale ? "0".repeat(64) : digestCanonicalValue(document),
    credits: {
      contractVersion: 1 as const,
      jobId: "job_setup",
      state: "settled" as const,
      estimatedCreditUnits: "3",
      maximumCreditUnits: "100",
      actualCreditUnits: "2",
    },
    proposal: suggestion,
    ...(proofFault === "missing" ? {} : { applicability: receipt }),
  };
  render(
    <ProjectCreationProposalReview
      editingAvailable={editing}
      onClose={onClose}
      proposal={handoff}
    />,
  );
  return { apply, onClose };
}
it("prepares the diagram but applies only after explicit review", () => {
  const { apply, onClose } = setup();
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByText("Files")).toBeVisible();
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
it.each([false, true])(
  "rejects a stale draft before presenting changes or an assessment (assessment: %s)",
  (assessment) => {
    const { apply } = setup({ stale: true, assessment });
    expect(screen.getByRole("alert")).toHaveTextContent("draft changed");
    fireEvent.click(
      screen.getByRole("button", { name: "Review checks and assumptions" }),
    );
    if (!assessment)
      expect(
        screen.getByRole("button", { name: "Use this diagram" }),
      ).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  },
);
it("allows cancellation without mutating the saved project", () => {
  const { apply, onClose } = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "Continue with empty project" }),
  );
  expect(apply).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});
it.each([
  "missing",
  "architectureDigest",
  "catalogDigest",
  "proposalDigest",
  "commandDigest",
  "resultDigest",
] as const)("refuses a v6 creation proposal with %s proof", (proofFault) => {
  const { apply } = setup({ proofFault });
  fireEvent.click(
    screen.getByRole("button", { name: "Review checks and assumptions" }),
  );
  expect(
    screen.getByRole("button", { name: "Use this diagram" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("proof");
  expect(apply).not.toHaveBeenCalled();
});
