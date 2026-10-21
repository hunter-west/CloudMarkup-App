import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createSyntheticAiPreviewCandidate } from "./ai-intent-preview-test-helpers.js";
import { IntentRequirementsDetails } from "./IntentRequirementsDetails.js";

describe("complete requirements review", () => {
  it("keeps actual sections, assumptions and blocking questions identical after changing assistance preference", () => {
    const intent = createSyntheticAiPreviewCandidate("preview_review_modes")
      .candidate.intentDocument;
    const { container, rerender } = render(
      <IntentRequirementsDetails intent={intent} requestedMode="guided" />,
    );
    const read = () => ({
      headings: screen.getAllByRole("heading").map((v) => v.textContent),
      lists: screen.getAllByRole("list").map((v) => v.textContent),
      sections: [...container.querySelectorAll("details")].map(
        (v) => v.textContent,
      ),
    });
    const guided = read();
    expect(screen.getByRole("heading", { name: "Assumptions" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Open questions" }),
    ).toBeVisible();
    expect(guided.sections).toHaveLength(11);
    for (const question of intent.unresolvedQuestions)
      expect(
        within(container).getByText(
          question.question + " (" + question.classification + ")",
        ),
      ).toBeVisible();
    rerender(
      <IntentRequirementsDetails
        intent={intent}
        requestedMode="professional"
      />,
    );
    expect(read()).toEqual(guided);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
