import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AssistantWorkspace,
  type AssistantWorkspaceHostInputV1,
} from "./index.js";

type AssistancePreference =
  AssistantWorkspaceHostInputV1["assistancePreference"];

function reviewView(
  assistancePreference: AssistancePreference,
): AssistantWorkspaceHostInputV1 {
  return {
    activeIssues: [
      {
        blocking: true,
        id: "issue_prompt38_missing_port",
        state: "current",
        summary: "Choose the API port before accepting this change.",
        technical:
          "validation.connection.missing-port at $.edges[0].target.port",
      },
      {
        blocking: false,
        id: "issue_prompt38_stale_repository_observation",
        state: "stale",
        summary: "The earlier repository observation is no longer current.",
        technical:
          "repository.evidence sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        evidenceIds: ["evidence_prompt38_architecture"],
        ids: ["node_api", "edge_client_api"],
        paths: ["$.nodes[1].configuration.timeout"],
        policyActions: [],
        primary:
          "Move the API into the service boundary and change its timeout to 45 seconds.",
        validationDeltas: ["Placement and connection validation pass."],
      },
      {
        category: "permission-policy",
        evidenceIds: ["evidence_prompt38_policy"],
        ids: ["policy_notes_table"],
        paths: ["$.nodes[1].policies[0]"],
        policyActions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        primary: "Limit table access to read and write note items.",
        validationDeltas: ["Least-privilege policy validation passes."],
      },
      {
        category: "repository-observation",
        evidenceIds: ["evidence_prompt38_repository"],
        ids: ["observed_difference_worker"],
        paths: ["application/worker.ts"],
        policyActions: [],
        primary:
          "Keep the observed worker timeout as repository evidence only.",
        validationDeltas: ["Designed state is unchanged."],
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
        id: "assistant_operation_prompt38_timeout",
        kind: "edit-workload",
        paths: ["$.workloadBehavior.workloads[0].executionAssumptions"],
        policyActions: [],
        primary: "Change timeout and retry behavior.",
        technical:
          "Exact Workload content precondition sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; unrelated fields preserved.",
      },
      {
        id: "assistant_operation_prompt38_policy",
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
        stage: "needs-user-input",
        summary: "One clarification remains before acceptance.",
      },
    ],
    repositoryDifferences: [
      "Observed worker timeout differs from the designed timeout; keep observed only.",
    ],
    requirements: [
      "Keep the notes API responsive during transient table failures.",
      "Do not replace, write, compile, or deploy the existing stack.",
    ],
    state: "needs-user-input",
    userOwnedFileImpact: ["application/manual.ts — preserved, no overwrite"],
    validationEvidenceIds: [
      "evidence_prompt38_architecture",
      "evidence_prompt38_policy",
      "evidence_prompt38_repository",
    ],
    workflowId: "assistant_workflow_prompt38_ui_e2e",
  };
}

function renderWorkspace(assistancePreference: AssistancePreference) {
  const callbacks = {
    onAccept: vi.fn(),
    onCancel: vi.fn(),
    onEdit: vi.fn(),
    onReject: vi.fn(),
  };
  const rendered = render(
    <AssistantWorkspace
      value={{ ...reviewView(assistancePreference), ...callbacks }}
    />,
  );
  const workspace = screen.getByRole("region", {
    name: "Assistant workspace",
  });
  return { callbacks, rendered, workspace };
}

describe("Prompt 38 production Assistant workspace E2E", () => {
  it("exposes screen-reader landmarks and keyboard-reachable review actions without apply or deploy controls", () => {
    const { callbacks, workspace } = renderWorkspace("guided");
    const expectedSections = [
      "Requirements",
      "Proposed changes",
      "Imported repository differences",
      "Custom generation requests",
      "File impact",
      "Active issues",
      "Job progress",
      "Credit estimate and use",
      "Accept, reject, or edit",
    ];
    for (const name of expectedSections) {
      expect(within(workspace).getByRole("heading", { name })).toBeVisible();
    }
    expect(workspace.querySelectorAll('[aria-live="polite"]')).toHaveLength(2);
    expect(
      within(workspace).queryByRole("button", {
        name: /apply|deploy|compile/iu,
      }),
    ).not.toBeInTheDocument();

    const technical = within(workspace).getByText("Technical details");
    fireEvent.click(within(workspace).getByText("Request changes"));
    fireEvent.click(within(workspace).getByText("Add a rejection reason"));
    const edit = within(workspace).getByRole("textbox", {
      name: "Edit request",
    });
    const revalidate = within(workspace).getByRole("button", {
      name: "Revalidate edit",
    });
    const rejection = within(workspace).getByRole("textbox", {
      name: "Rejection reason",
    });
    const reject = within(workspace).getByRole("button", {
      name: "Reject candidate",
    });
    const accept = within(workspace).getByRole("button", {
      name: "Accept candidate",
    });
    const cancel = within(workspace).getByRole("button", {
      name: "Cancel job",
    });
    for (const control of [technical, edit, rejection, reject]) {
      control.focus();
      expect(control).toHaveFocus();
    }

    fireEvent.change(edit, {
      target: { value: "Use the reviewed 50 second timeout." },
    });
    expect(revalidate).toBeEnabled();
    revalidate.focus();
    expect(revalidate).toHaveFocus();
    fireEvent.click(revalidate);
    expect(callbacks.onEdit).toHaveBeenCalledWith(
      "Use the reviewed 50 second timeout.",
    );
    fireEvent.change(rejection, {
      target: { value: "Keep the existing design." },
    });
    fireEvent.click(reject);
    expect(callbacks.onReject).toHaveBeenCalledWith(
      "Keep the existing design.",
    );
    expect(accept).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(callbacks.onAccept).not.toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });
});
