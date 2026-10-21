import { syntheticRepositoryInterpretationReview } from "./repository-interpretation-test-helpers.js";
import { createSyntheticAiPreviewCandidate } from "../generation/ai-intent-preview-test-helpers.js";
import {
  modelBlockingQuestionsRequestV1Schema,
  modelBlockingQuestionsResponseV1Schema,
} from "@cloudmarkup/schemas";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../App.js";
import {
  AssistantWorkspace,
  type AssistantWorkspaceHostInputV1,
} from "./AssistantWorkspace.js";

// This suite reviews loaded assistant interactions, not editor module latency.
// Cold loading and navigation remain covered by App.deferred-routes.test.tsx.
import "../editor/EditorRoute.js";

function view(
  assistancePreference: "guided" | "professional" = "guided",
  blocking = false,
): AssistantWorkspaceHostInputV1 {
  return {
    activeIssues: blocking
      ? [
          {
            blocking: true,
            id: "issue_missing_port",
            state: "current",
            summary: "Choose the API port before accepting this change.",
            technical:
              "validation.connection.missing-port at $.edges[0].target.port",
          },
        ]
      : [
          {
            blocking: false,
            id: "issue_resolved_coverage",
            state: "resolved",
            summary: "Contract coverage was validated.",
            technical: "application.contract-tests passed with Evidence.",
          },
        ],
    assistancePreference,
    credit: {
      completed: 2,
      maximumEstimate: 3,
      minimumEstimate: 1,
      state: "completed",
    },
    customGenerationRequests: [
      "Create the reviewed application extension under application/notes-api/.",
    ],
    diffs: [
      {
        category: "architecture",
        evidenceIds: [],
        ids: ["node_api", "edge_client_api"],
        paths: ["$.nodes[1].configuration.timeout"],
        policyActions: [],
        primary:
          "Move the API into the service boundary and change its timeout to 45 seconds.",
        validationDeltas: ["Placement and connection validation pass."],
      },
      {
        category: "workload",
        evidenceIds: ["evidence_contract_tests"],
        ids: ["workload_notes"],
        paths: ["$.workloadBehavior.workloads[0]"],
        policyActions: [],
        primary: "Add retry behavior and the create-note contract scenario.",
        validationDeltas: [
          "Contract coverage changes from missing to passing.",
        ],
      },
      {
        category: "permission-policy",
        evidenceIds: ["evidence_policy"],
        ids: ["policy_notes_table"],
        paths: ["$.nodes[1].policies[0]"],
        policyActions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        primary: "Limit table access to read and write note items.",
        validationDeltas: ["Least-privilege policy validation passes."],
      },
      {
        category: "external-resource",
        evidenceIds: ["evidence_imported_queue"],
        ids: ["external_queue"],
        paths: ["$.externalResources.resources[0]"],
        policyActions: [],
        primary:
          "Reference the existing customer event queue without adopting it.",
        validationDeltas: ["Ownership remains external and unchanged."],
      },
      {
        category: "repository-observation",
        evidenceIds: ["repository_evidence_worker"],
        ids: ["observed_difference_worker"],
        paths: ["application/worker.ts"],
        policyActions: [],
        primary:
          "Keep the observed worker timeout as repository evidence only.",
        validationDeltas: ["Designed state is unchanged."],
      },
      {
        category: "file-impact",
        evidenceIds: [],
        ids: [],
        paths: ["application/notes-api/index.ts", "application/manual.ts"],
        policyActions: [],
        primary:
          "Generate one extension file and preserve the user-owned file.",
        validationDeltas: [],
      },
    ],
    generatedFileImpact: ["application/notes-api/index.ts — create"],
    modelProvenance: {
      model: "model-planner@2026-08",
      prompt: "cloudmarkup.operations.propose@1.0.0",
      provider: "provider.reviewed",
    },
    operations: [
      {
        id: "assistant_operation_timeout",
        kind: "edit-workload",
        paths: ["$.workloadBehavior.workloads[0].executionAssumptions"],
        policyActions: [],
        primary: "Change timeout and retry behavior.",
        technical:
          "Exact Workload content precondition sha256:111; unrelated fields preserved.",
      },
      {
        id: "assistant_operation_policy",
        kind: "graph-command",
        paths: ["$.nodes[1].policies[0]"],
        policyActions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        primary: "Narrow the table policy.",
        technical: "Graph Command cloudmarkup.graph-command.v1; atomic batch.",
      },
    ],
    progress: [
      { sequence: 0, stage: "queued", summary: "Request queued." },
      {
        sequence: 1,
        stage: "commercial-check",
        summary: "Credits reserved.",
      },
      {
        sequence: 2,
        stage: "review-ready",
        summary: "Validated proposal ready for review.",
      },
    ],
    repositoryDifferences: [
      "Observed worker timeout differs from the designed timeout; keep observed only.",
    ],
    requirements: [
      "Keep the notes API responsive during transient table failures.",
      "Do not replace or deploy the existing stack.",
    ],
    state: blocking ? "needs-user-input" : "review-ready",
    userOwnedFileImpact: ["application/manual.ts — preserved, no overwrite"],
    validationEvidenceIds: [
      "evidence_contract_tests",
      "evidence_policy",
      "repository_evidence_worker",
    ],
    workflowId: "assistant_workflow_ui_test",
  };
}

function interactiveNames(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll("button, textarea, input, summary"),
  ].map(
    (element) =>
      `${element.tagName}:${element.textContent || (element.getAttribute("aria-label") ?? "")}`,
  );
}

describe("AssistantWorkspace", () => {
  it("mounts one glanceable review in the editor Assistant tab with technical disclosure", async () => {
    const onAccept = vi.fn();
    const onEdit = vi.fn();
    const onReject = vi.fn();
    window.history.replaceState(
      null,
      "",
      "/organizations/local-org/projects/field-notes/editor?fixture=foundation",
    );
    render(
      <App
        assistantWorkspace={{
          ...view(),
          onAccept,
          onEdit,
          onReject,
        }}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("tab", { name: "Assistant" }));
    const workspace = screen.getByRole("region", {
      name: "Assistant workspace",
    });
    expect(
      within(workspace).getByRole("heading", { name: "Proposed changes" }),
    ).toBeVisible();
    expect(
      within(workspace).getByText(/Move the API into the service boundary/iu),
    ).toBeVisible();
    expect(
      within(workspace).getByText(/Keep the observed worker timeout/iu),
    ).toBeVisible();
    expect(
      within(workspace).getByText(/preserved, no overwrite/iu),
    ).toBeVisible();
    expect(
      within(workspace).getByText(/Nothing is applied automatically/iu),
    ).toBeVisible();
    fireEvent.click(within(workspace).getByText("Review safeguards"));
    expect(
      screen.getByText(/Nothing is applied, deployed, compiled/iu),
    ).toBeVisible();
    fireEvent.click(within(workspace).getByText("Review safeguards"));
    expect(workspace).toBeVisible();

    const technical = within(workspace).getByText("Technical details");
    expect(technical.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(technical);
    expect(
      within(workspace).getByText("assistant_operation_policy"),
    ).toBeVisible();
    expect(
      within(workspace).getByText(/dynamodb:GetItem, dynamodb:PutItem/iu),
    ).toBeVisible();
    expect(
      within(workspace).getByText(/repository_evidence_worker/iu),
    ).toBeVisible();
    expect(
      within(workspace).getByText(/cloudmarkup.operations.propose@1.0.0/iu),
    ).toBeVisible();

    expect(within(workspace).getByLabelText("Edit request")).not.toBeVisible();
    fireEvent.click(within(workspace).getByText("Request changes"));
    const edit = within(workspace).getByRole("textbox", {
      name: "Edit request",
    });
    fireEvent.change(edit, { target: { value: "Use a 50 second timeout." } });
    fireEvent.click(
      within(workspace).getByRole("button", { name: "Revalidate edit" }),
    );
    expect(onEdit).toHaveBeenCalledWith("Use a 50 second timeout.");

    fireEvent.click(
      within(workspace).getByRole("button", { name: "Accept candidate" }),
    );
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("keeps blocking issues visible and exposes the same base UI in both assistance preferences", () => {
    const guided = render(<AssistantWorkspace value={view("guided", true)} />);
    const guidedNames = interactiveNames(guided.container);
    expect(
      screen.getByText("Choose the API port before accepting this change."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Accept candidate" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Resolve blocking issues before acceptance.",
    );
    guided.unmount();

    const professional = render(
      <AssistantWorkspace value={view("professional", true)} />,
    );
    expect(interactiveNames(professional.container)).toEqual(guidedNames);
    expect(
      screen.getByRole("region", { name: "Assistant workspace" }),
    ).toHaveAttribute("data-assistance-preference", "professional");
  });

  it("keeps in-progress review inputs and disclosures when assistance preference changes", () => {
    const value = view();
    const rendered = render(<AssistantWorkspace value={value} />);
    fireEvent.click(screen.getByText("Request changes"));
    fireEvent.click(screen.getByText("Add a rejection reason"));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit request" }), {
      target: { value: "Keep the current database." },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Rejection reason" }),
      { target: { value: "Needs review." } },
    );
    rendered.rerender(
      <AssistantWorkspace
        value={{ ...value, assistancePreference: "professional" }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Edit request" })).toHaveValue(
      "Keep the current database.",
    );
    expect(
      screen.getByRole("textbox", { name: "Rejection reason" }),
    ).toHaveValue("Needs review.");
    expect(
      screen.getByText("Request changes").closest("details"),
    ).toHaveAttribute("open");
    expect(
      screen.getByText("Add a rejection reason").closest("details"),
    ).toHaveAttribute("open");
  });

  it("collapses empty optional context without concealing credits, file impact, or review state", () => {
    render(
      <AssistantWorkspace
        value={{
          ...view(),
          repositoryDifferences: [],
          customGenerationRequests: [],
          generatedFileImpact: [],
          userOwnedFileImpact: [],
        }}
      />,
    );
    expect(
      screen.queryByRole("heading", {
        name: "Imported repository differences",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Additional review context").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText("No generated or user-owned file impact."),
    ).toBeVisible();
    expect(
      screen.getByText(/1–3 credits estimated. 2 credits used./u),
    ).toBeVisible();
    expect(
      screen.getByText(/Validated proposal ready for review./u, {
        selector: "p",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByText("Additional review context"));
    expect(
      screen.getByText("No imported differences are in this review."),
    ).toBeVisible();
    expect(
      screen.getByText("No custom generation request is proposed."),
    ).toBeVisible();
  });
});

function clarification() {
  const candidate = createSyntheticAiPreviewCandidate().candidate;
  const request = modelBlockingQuestionsRequestV1Schema.parse({
    contractVersion: 1,
    operation: "requirements.blocking-questions",
    requestedMode: "guided",
    intentDocument: candidate.intentDocument,
    maximumQuestions: 16,
  });
  const response = modelBlockingQuestionsResponseV1Schema.parse({
    contractVersion: 1,
    operation: request.operation,
    proposalContext: candidate.proposalContext,
    provenance: candidate.provenance,
    questions: request.intentDocument.unresolvedQuestions
      .filter((q) => q.classification === "blocking")
      .map((q) => ({
        questionId: q.id,
        question: "Please clarify: " + q.question,
        rationale: q.rationale ?? "This requirement remains unresolved.",
        evidenceReferences: [],
      })),
  });
  return { request, response };
}
it.each(["guided", "professional"] as const)(
  "keeps clarification visible and prevents acceptance in %s",
  (assistancePreference) => {
    const onAccept = vi.fn(),
      input = clarification();
    render(
      <AssistantWorkspace
        value={{
          ...view(assistancePreference),
          state: "review-ready",
          blockingQuestions: input,
          onAccept,
        }}
      />,
    );
    const questions = screen.getByRole("region", {
      name: "Open requirement questions",
    });
    for (const q of input.response.questions)
      expect(within(questions).getByText(q.question)).toBeInTheDocument();
    expect(
      screen.getByText("No requirement has been answered or accepted."),
    ).toBeInTheDocument();
    const accept = screen.getByRole("button", { name: /accept candidate/i });
    expect(accept).toBeDisabled();
    fireEvent.click(accept);
    expect(onAccept).not.toHaveBeenCalled();
  },
);
it("retains omitted blocking constraints and identifies an unlinked model question", () => {
  const input = clarification();
  const omitted = input.response.questions.pop();
  if (!omitted) throw Error("Missing synthetic question");
  const source = input.request.intentDocument.unresolvedQuestions.find(
    (q) => String(q.id) === String(omitted.questionId),
  );
  if (!source) throw Error("Missing original");
  input.response.questions.push({
    ...omitted,
    questionId: "question_unrelated" as never,
    question: "An unrelated generated question?",
  });
  render(
    <AssistantWorkspace
      value={{ ...view(), state: "needs-user-input", blockingQuestions: input }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Still unresolved" }),
  ).toBeInTheDocument();
  expect(screen.getByText(source.question)).toBeInTheDocument();
  expect(
    screen.getByText("This question is not linked to an original requirement."),
  ).toBeInTheDocument();
});

it.each(["guided", "professional"] as const)(
  "keeps repository interpretation unverified and nonmutating in %s",
  (assistancePreference) => {
    const onAccept = vi.fn(),
      input = syntheticRepositoryInterpretationReview();
    render(
      <AssistantWorkspace
        value={{
          ...view(assistancePreference),
          state: "review-ready",
          repositoryInterpretation: input,
          onAccept,
        }}
      />,
    );
    const review = screen.getByRole("region", {
      name: "Repository interpretation review",
    });
    expect(within(review).getByText("Unverified suggestion")).toBeVisible();
    expect(
      within(review).getByText(
        "Who owns the storage and which access rules apply?",
      ),
    ).toBeVisible();
    expect(
      within(review).getByText(
        "No deterministic findings were established for this source.",
      ),
    ).toBeVisible();
    const accept = screen.getByRole("button", { name: /accept candidate/i });
    expect(accept).toBeDisabled();
    fireEvent.click(accept);
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByText("Source: application/handler.ts"));
    expect(
      within(review).getByText("export const storage = undefined;"),
    ).toBeVisible();
  },
);
it("shows a broken citation without displaying unrelated source content", () => {
  const input = syntheticRepositoryInterpretationReview(),
    claim = input.response.claims[0];
  if (!claim) throw Error("Missing synthetic claim");
  delete claim.evidenceReferences[0]?.location;
  render(
    <AssistantWorkspace
      value={{ ...view(), repositoryInterpretation: input }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This citation does not match the imported source.",
  );
  expect(
    screen.queryByText("Source: application/handler.ts"),
  ).not.toBeInTheDocument();
});
