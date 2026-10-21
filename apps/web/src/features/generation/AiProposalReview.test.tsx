import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AiProposalReview } from "./AiProposalReview.js";
import { loadBlankAwsEditorArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";

it.each([
  { question: true, contractVersion: 4 as const },
  { question: false, contractVersion: 5 as const },
  { question: true, contractVersion: 5 as const },
])(
  "reviews an assessment or clarification without an apply action: %s",
  ({ question, contractVersion }) => {
    const onApply = vi.fn();
    render(
      <AiProposalReview
        document={loadBlankAwsEditorArchitectureDocument("us-east-1")}
        catalog={awsEditorCatalog}
        onApply={onApply}
        proposal={{
          contractVersion,
          summary: "Review the requested design.",
          existingResources: [],
          resources: [],
          connections: [],
          updates: [],
          limitations: [],
          review: {
            intent: "Understand the queue behavior",
            assumptions: [],
            checks: ["The queue buffers incoming work."],
            questions: question ? ["How long can processing take?"] : [],
          },
        }}
      />,
    );
    if (question)
      expect(screen.getByText("How long can processing take?")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Review checks and assumptions" }),
    );
    expect(screen.getByText("The queue buffers incoming work.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Apply reviewed proposal" }),
    ).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  },
);

it("shows explicit list values and keeps applying behind the checks step", () => {
  const onApply = vi.fn();
  render(
    <AiProposalReview
      document={loadBlankAwsEditorArchitectureDocument("us-east-1")}
      catalog={awsEditorCatalog}
      onApply={onApply}
      proposal={{
        contractVersion: 5,
        summary: "Clear the optional filter",
        existingResources: [{ key: "rule", nodeId: "node_rule" }],
        resources: [],
        connections: [],
        updates: [
          {
            resourceKey: "rule",
            configuration: {
              filterKeys: [],
              detailTypes: ["Object Created", "Application Event"],
            },
            reason: "Match the requested events",
          },
        ],
        limitations: [],
        review: {
          intent: "Update event selection",
          assumptions: [],
          checks: ["Reviewed selection"],
          questions: [],
        },
      }}
    />,
  );
  expect(screen.getByRole("cell", { name: "[]" })).toBeVisible();
  expect(
    screen.getByRole("cell", {
      name: '["Object Created","Application Event"]',
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Apply reviewed proposal" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review checks and assumptions" }),
  );
  expect(screen.getByText("Reviewed selection")).toBeVisible();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Apply reviewed proposal" }),
  );
  expect(onApply).toHaveBeenCalledOnce();
});
