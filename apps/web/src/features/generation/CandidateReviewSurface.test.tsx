import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ModePreferenceProvider,
  type ExperienceMode,
  type ModePreferenceStorage,
} from "../../preferences/index.js";
import {
  CandidateReviewSurface,
  type CandidateReviewSurfaceProps,
  type CandidateReviewView,
} from "./CandidateReviewSurface.js";

function modeStorage(mode: ExperienceMode): ModePreferenceStorage {
  return {
    getItem: () => mode,
    setItem: () => undefined,
  };
}

function candidateView(): CandidateReviewView {
  return {
    acceptanceReady: true,
    assumptions: [
      {
        assumptionId: "assumption-runtime-response",
        sourceReferenceIds: ["contract.application-handler"],
        statement:
          "The handler returns no response body for a successful request.",
      },
    ],
    candidateId: "candidate_prompt_36a_001",
    evidence: [
      {
        checkCounts: { error: 0, failed: 0, passed: 2, skipped: 0 },
        environmentType: "test",
        evidenceId: "evidence-candidate-validation",
        layer: "generated",
        levelKind: "application-build-and-tests",
        levelRank: 5,
        stalenessState: "current",
      },
    ],
    expectedTests: [
      {
        description: "The generated handler satisfies its response contract.",
        expectedTestId: "expected-test-handler-contract",
        kind: "contract-test",
        sourceReferenceIds: ["contract.application-handler"],
        targetPaths: ["src/handler.ts"],
        validationCheckId: "application.contract-tests",
      },
    ],
    files: [
      {
        content: "export const handler = () => ({ statusCode: 204 });\n",
        contentDigest: "sha256:generated-file-v1",
        language: "TypeScript",
        ownership: "generated-candidate",
        path: "src/handler.ts",
        sizeBytes: 55,
      },
      {
        content: 'resource "aws_sns_topic" "notifications" {}\n',
        contentDigest: "sha256:user-file-v1",
        language: "HCL",
        ownership: "user-owned",
        path: "extensions/notifications.tf",
        sizeBytes: 47,
      },
    ],
    fixes: [
      {
        description: "Formatted the bounded Terraform extension",
        afterContentHash: "sha256:content-after",
        afterVisualHash: "sha256:visual-after",
        beforeContentHash: "sha256:content-before",
        beforeVisualHash: "sha256:visual-before",
        commandBatchDigest: "sha256:command-batch",
        exactReference: "operation:format-extension:attempt-1",
        kind: "deterministic-operation",
        status: "applied",
      },
      {
        description: "Rejected a patch outside the owned path",
        exactReference: "sha256:rejected-patch-1",
        kind: "ai-proposal",
        status: "rejected",
      },
    ],
    issues: [
      {
        issueId: "candidate_issue_owner_001",
        nextAction: "Confirm the notification topic owner before acceptance.",
        severity: "warning",
        state: "active",
        summary: "The notification topic still needs an owner.",
      },
      {
        issueId: "candidate_issue_format_001",
        nextAction: "No action is needed unless the candidate changes again.",
        severity: "information",
        state: "stale",
        summary: "A previous formatting issue is no longer current.",
      },
    ],
    modelProvenance: {
      modelId: "extension-author",
      modelVersion: "2026-08-01",
      promptDigest: "sha256:prompt-36a-v1",
      promptVersion: "36A.1",
      providerId: "configured-model-gateway",
    },
    progress: {
      accept: "current",
      check: "complete",
      fix: "complete",
      generate: "complete",
      review: "complete",
    },
    revalidationState: "current",
    schemaReferences: [
      {
        digest: "sha256:candidate-schema-v1",
        schemaId: "cloudmarkup.ai-extension-candidate",
        version: "1",
      },
    ],
    toolDiagnostics: [
      {
        checkId: "terraform.validate",
        code: "TF_VALID",
        message: "The bounded extension parsed and validated successfully.",
        path: "extensions/notifications.tf",
        toolName: "Terraform",
        toolVersion: "1.14.5",
      },
    ],
    unresolvedItems: [],
    validatedCandidateDigest: "sha256:candidate-v1",
  };
}

let renderSequence = 0;

function renderCandidate({
  candidate = candidateView(),
  mode,
  onAccept = vi.fn<CandidateReviewSurfaceProps["onAccept"]>(),
  onFileChange = vi.fn<CandidateReviewSurfaceProps["onFileChange"]>(),
}: {
  readonly candidate?: CandidateReviewView;
  readonly mode: ExperienceMode;
  readonly onAccept?: CandidateReviewSurfaceProps["onAccept"];
  readonly onFileChange?: CandidateReviewSurfaceProps["onFileChange"];
}) {
  renderSequence += 1;
  const actorId = `candidate-review-${mode}-${String(renderSequence)}`;

  return render(
    <ModePreferenceProvider actorId={actorId} storage={modeStorage(mode)}>
      <CandidateReviewSurface
        candidate={candidate}
        onAccept={onAccept}
        onFileChange={onFileChange}
      />
    </ModePreferenceProvider>,
  );
}

function markupSignature(root: HTMLElement): readonly string[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].map((element) =>
    [
      element.tagName,
      element.getAttribute("class") ?? "",
      element.getAttribute("role") ?? "",
      element.getAttribute("type") ?? "",
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("data-blocking") ?? "",
      element.getAttribute("data-progress-state") ?? "",
    ].join("|"),
  );
}

function reviewRoot(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Review candidate" });
  const root = heading.closest("section");
  if (root === null) {
    throw new Error("Expected the candidate review section.");
  }
  return root;
}

describe("CandidateReviewSurface", () => {
  it("keeps the complete review flow, controls, and content identical across assistance preferences", () => {
    const guided = renderCandidate({ mode: "guided" });
    const guidedRoot = reviewRoot();
    const guidedSignature = markupSignature(guidedRoot);
    const guidedContent = guidedRoot.textContent;
    const guidedProgress = within(guidedRoot).getByRole("list", {
      name: "Candidate generation progress",
    });

    expect(
      within(guidedProgress)
        .getAllByRole("listitem")
        .map((item) => item.textContent.replaceAll(/\s+/gu, " ").trim()),
    ).toEqual([
      "Generate — Complete",
      "Check — Complete",
      "Fix automatically where safe — Complete",
      "Review remaining issues — Complete",
      "Accept candidate — Current",
    ]);
    expect(
      within(guidedRoot)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["src/handler.ts", "extensions/notifications.tf"]);

    const reviewContext = within(guidedRoot).getByRole("region", {
      name: "Review context",
    });
    expect(
      within(reviewContext).getByText(
        "The handler returns no response body for a successful request.",
      ),
    ).toBeVisible();
    expect(
      within(reviewContext).getByText(
        "The generated handler satisfies its response contract.",
      ),
    ).toBeVisible();
    expect(reviewContext).toHaveTextContent(
      "2 checks: 2 passed, 0 failed, 0 errors, and 0 skipped.",
    );
    expect(reviewContext.textContent).not.toContain("export const handler");

    const issues = within(guidedRoot).getByRole("list", {
      name: "Candidate issues",
    });
    expect(
      within(issues).getByText("The notification topic still needs an owner."),
    ).toBeVisible();
    expect(
      within(issues).getByText(
        "Confirm the notification topic owner before acceptance.",
      ),
    ).toBeVisible();
    expect(
      within(issues).getByText(
        "A previous formatting issue is no longer current.",
      ),
    ).toBeVisible();
    expect(
      within(issues).getByText("Stale — retained for review", {
        exact: false,
      }),
    ).toBeVisible();
    expect(issues.textContent).not.toContain("sha256:");
    expect(within(issues).queryByText("TF_VALID")).not.toBeInTheDocument();

    const technicalSummary = within(guidedRoot).getByText("Technical details", {
      selector: "summary",
    });
    const technicalDetails = technicalSummary.closest("details");
    if (technicalDetails === null) {
      throw new Error("Expected collapsed candidate technical details.");
    }
    expect(technicalDetails).not.toHaveAttribute("open");
    expect(within(technicalDetails).getByText("TF_VALID")).not.toBeVisible();
    fireEvent.click(technicalSummary);
    expect(within(technicalDetails).getByText("TF_VALID")).toBeVisible();
    expect(
      within(technicalDetails).getByText("cloudmarkup.ai-extension-candidate"),
    ).toBeVisible();
    expect(
      within(technicalDetails).getByText("configured-model-gateway"),
    ).toBeVisible();
    expect(
      within(technicalDetails).getByText(
        "operation:format-extension:attempt-1",
      ),
    ).toBeVisible();
    expect(technicalDetails.textContent).toContain("src/handler.ts");
    expect(technicalDetails.textContent).toContain("sha256:generated-file-v1");
    expect(technicalDetails.textContent).toContain(
      "cloudmarkup.ai-extension-candidate",
    );
    expect(technicalDetails.textContent).toContain(
      "sha256:candidate-schema-v1",
    );
    expect(technicalDetails.textContent).toContain(
      "extensions/notifications.tf",
    );
    expect(technicalDetails.textContent).toContain("configured-model-gateway");
    expect(technicalDetails.textContent).toContain("sha256:prompt-36a-v1");
    expect(technicalDetails.textContent).toContain(
      "operation:format-extension:attempt-1",
    );
    expect(technicalDetails.textContent).toContain("sha256:rejected-patch-1");
    expect(technicalDetails.textContent).toContain("sha256:command-batch");
    expect(technicalDetails.textContent).toContain("sha256:content-before");
    expect(technicalDetails.textContent).toContain("sha256:content-after");
    expect(technicalDetails.textContent).toContain("sha256:visual-before");
    expect(technicalDetails.textContent).toContain("sha256:visual-after");
    expect(technicalDetails.textContent).toContain("ai-proposal · rejected");

    for (const forbiddenAction of [
      "Deploy",
      "Plan",
      "Apply",
      "Create change set",
      "Retry",
      "Choose model",
    ]) {
      expect(
        within(guidedRoot).queryByRole("button", {
          name: forbiddenAction,
        }),
      ).not.toBeInTheDocument();
    }

    expect(guidedRoot).toHaveTextContent(
      "Acceptance creates a new immutable Solution Revision/export input. It does not deploy, plan, apply, or create a change set.",
    );
    guided.unmount();
    renderCandidate({ mode: "professional" });
    const professionalRoot = reviewRoot();

    expect(markupSignature(professionalRoot)).toEqual(guidedSignature);
    expect(professionalRoot.textContent).toBe(guidedContent);
    expect(
      within(professionalRoot)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Accept candidate"]);
  });

  it("marks a blocking unresolved question, locks acceptance, and stays mode-neutral", () => {
    const candidate: CandidateReviewView = {
      ...candidateView(),
      unresolvedItems: [
        {
          blocking: true,
          detail:
            "Choose the owning team before this candidate can become an immutable revision.",
          question: "Which team owns the generated handler?",
          sourceReferenceIds: ["contract.application-handler"],
          unresolvedItemId: "unresolved-handler-owner",
        },
      ],
    };
    const guided = renderCandidate({ candidate, mode: "guided" });
    const guidedRoot = reviewRoot();
    const guidedSignature = markupSignature(guidedRoot);
    const guidedContent = guidedRoot.textContent;
    const questions = within(guidedRoot).getByRole("list", {
      name: "Unresolved questions",
    });

    expect(within(questions).getByText("Blocking question")).toBeVisible();
    expect(
      within(questions).getByText("Which team owns the generated handler?"),
    ).toBeVisible();
    expect(
      within(questions).getByText(
        "Choose the owning team before this candidate can become an immutable revision.",
      ),
    ).toBeVisible();
    expect(questions.querySelector('[data-blocking="true"]')).not.toBeNull();
    expect(
      within(guidedRoot).getByRole("button", { name: "Accept candidate" }),
    ).toBeDisabled();
    expect(within(guidedRoot).getByRole("status")).toHaveTextContent(
      "A required behavior decision is still unresolved.",
    );

    guided.unmount();
    renderCandidate({ candidate, mode: "professional" });
    const professionalRoot = reviewRoot();
    expect(markupSignature(professionalRoot)).toEqual(guidedSignature);
    expect(professionalRoot.textContent).toBe(guidedContent);
  });

  it("reports user edits and keeps acceptance disabled until a newly validated digest arrives", () => {
    const candidate = candidateView();
    const onAccept = vi.fn();
    const onFileChange = vi.fn();
    const actorId = "candidate-review-editing";
    const view = (nextCandidate: CandidateReviewView) => (
      <ModePreferenceProvider actorId={actorId} storage={modeStorage("guided")}>
        <CandidateReviewSurface
          candidate={nextCandidate}
          onAccept={onAccept}
          onFileChange={onFileChange}
        />
      </ModePreferenceProvider>
    );
    const rendered = render(view(candidate));
    const accept = screen.getByRole("button", { name: "Accept candidate" });

    expect(accept).toBeEnabled();
    const generatedTab = screen.getByRole("tab", { name: "src/handler.ts" });
    const userOwnedTab = screen.getByRole("tab", {
      name: "extensions/notifications.tf",
    });
    fireEvent.keyDown(generatedTab, { key: "ArrowRight" });
    expect(userOwnedTab).toHaveFocus();
    expect(userOwnedTab).toHaveAttribute("aria-selected", "true");
    expect(
      within(screen.getByRole("tabpanel")).getByText("User-owned file", {
        exact: false,
      }),
    ).toBeVisible();

    const modifiedContent =
      'resource "aws_sns_topic" "notifications" { name = "alerts" }\n';
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Edit candidate file extensions/notifications.tf",
      }),
      { target: { value: modifiedContent } },
    );

    expect(onFileChange).toHaveBeenCalledWith({
      candidateId: candidate.candidateId,
      content: modifiedContent,
      originalContentDigest: "sha256:user-file-v1",
      path: "extensions/notifications.tf",
    });
    expect(accept).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Changes need revalidation before acceptance.",
    );
    expect(
      screen.getByText("Edited — revalidation required", { exact: false }),
    ).toBeVisible();

    const revalidatedCandidate: CandidateReviewView = {
      ...candidate,
      files: candidate.files.map((file) =>
        file.path === "extensions/notifications.tf"
          ? {
              ...file,
              content: modifiedContent,
              contentDigest: "sha256:user-file-v2",
              sizeBytes: modifiedContent.length,
            }
          : file,
      ),
      validatedCandidateDigest: "sha256:candidate-v2",
    };
    rendered.rerender(view(revalidatedCandidate));

    const revalidatedAccept = screen.getByRole("button", {
      name: "Accept candidate",
    });
    expect(revalidatedAccept).toBeEnabled();
    expect(
      screen.getByText("Matches validated candidate", { exact: false }),
    ).toBeVisible();
    fireEvent.click(revalidatedAccept);
    expect(onAccept).toHaveBeenCalledWith({
      candidateId: candidate.candidateId,
      validatedCandidateDigest: "sha256:candidate-v2",
    });
  });
});
