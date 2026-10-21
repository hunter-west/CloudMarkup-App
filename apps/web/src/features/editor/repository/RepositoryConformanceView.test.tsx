import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { loadFoundationArchitectureDocument } from "../model/foundation-editor-fixture.js";
import {
  RepositoryConformanceView,
  type RepositoryConformanceDisplayResult,
} from "./RepositoryConformanceView.js";

const architecture = loadFoundationArchitectureDocument();
const result = {
  observedSolution: {
    connections: [],
    resources: [
      {
        observedResourceId: "observed.fact.table",
        resourceType: "aws.dynamodb.table",
        capability: "cloudmarkup.import.resource",
        certainty: { kind: "deterministic", confidence: 1 },
        sourceEvidenceIds: ["source.table"],
        designComparison: {
          state: "matches-approved-design",
          target: { kind: "architecture-node", nodeId: "node_application" },
        },
      },
    ],
    externalResources: [
      {
        candidateId: "external.fact.table",
        capability: "cloudmarkup.import.external-resource",
      },
    ],
    evidence: [
      {
        fileChecksum: `sha256:${"2".repeat(64)}`,
        location: { endLine: 3, startLine: 1 },
        path: "infrastructure/main.tf",
        sourceEvidenceId: "source.table",
      },
    ],
  },
  issues: [],
  differences: [
    {
      differenceId: "difference.table",
      kind: "configuration-mismatch",
      severity: "error",
      summary: "Observed table configuration differs from the approved design.",
      observedFactIds: ["fact.table"],
      evidenceIds: ["source.table"],
      digest: `sha256:${"1".repeat(64)}`,
    },
  ],
  proposal: {
    operations: [
      {
        kind: "accept-observed-graph-change",
        operationId: "reconcile.table",
        target: { kind: "resource", observedResourceId: "observed.fact.table" },
      },
    ],
  },
} as unknown as RepositoryConformanceDisplayResult;

describe("RepositoryConformanceView", () => {
  it("uses identical approved-diagram views and action structure across assistance modes", () => {
    for (const mode of ["guided", "professional"] as const) {
      const { container, unmount } = render(
        <RepositoryConformanceView
          architecture={architecture}
          mode={mode}
          result={result}
        />,
      );
      expect(
        screen.getAllByRole("tab").map(({ textContent }) => textContent),
      ).toEqual([
        "Designed",
        "Imported/observed",
        "Combined",
        "Differences (1)",
      ]);
      expect(
        screen.getAllByRole("img", {
          name: /Approved architecture diagram/u,
        }).length,
      ).toBeGreaterThan(0);
      expect(
        container.querySelector('svg [data-conformance-state="matching"]'),
      ).not.toBeNull();
      fireEvent.click(screen.getByRole("tab", { name: "Differences (1)" }));
      expect(
        screen.getAllByRole("button").map(({ textContent }) => textContent),
      ).toEqual([
        "Accept into design",
        "Keep observed-only",
        "Mark external",
        "Regenerate to design",
        "Reject observation",
        "Ignore with reason",
      ]);
      unmount();
    }
  });

  it("shows provenance and emits an exact review intent without mutating design", () => {
    const review = vi.fn();
    const before = JSON.stringify(architecture);
    render(
      <RepositoryConformanceView
        architecture={architecture}
        mode="guided"
        onReviewAction={review}
        result={result}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Imported/observed" }));
    expect(
      screen
        .getAllByText(/infrastructure\/main\.tf/u)
        .some((item) => item.closest("[hidden]") === null),
    ).toBe(true);
    expect(screen.getByText(/Repository code may differ/u)).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Differences (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept into design" }));
    expect(review).toHaveBeenCalledWith({
      action: "accept-into-design",
      differenceId: "difference.table",
      operationId: "reconcile.table",
    });
    expect(JSON.stringify(architecture)).toBe(before);
    const card = screen.getByText("configuration-mismatch").closest("li");
    if (card === null) throw new Error("difference card missing");
    expect(
      within(card).getByRole("button", { name: "Ignore with reason" }),
    ).toBeDisabled();
  });

  it("emits ignore with a reason only for an exact ignore operation", () => {
    const review = vi.fn();
    const ignoreResult = {
      differences: result.differences.map((difference) => ({
        ...difference,
        operationId: "reconcile.ignore",
        operationKind: "ignore-observation" as const,
      })),
      issues: result.issues,
      observedSolution: result.observedSolution,
    };
    render(
      <RepositoryConformanceView
        architecture={architecture}
        mode="guided"
        onReviewAction={review}
        result={ignoreResult}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Differences (1)" }));
    const card = screen.getByText("configuration-mismatch").closest("li");
    if (card === null) throw new Error("difference card missing");
    const ignore = within(card).getByRole("button", {
      name: "Ignore with reason",
    });
    expect(ignore).toBeDisabled();
    fireEvent.change(within(card).getByLabelText("Ignore reason"), {
      target: { value: "Managed by a reviewed migration" },
    });
    fireEvent.click(ignore);
    expect(review).toHaveBeenCalledWith({
      action: "ignore",
      differenceId: "difference.table",
      operationId: "reconcile.ignore",
      reason: "Managed by a reviewed migration",
    });
  });

  it("renders malicious labels as text and never creates external links", () => {
    const malicious = structuredClone(architecture);
    const node = malicious.nodes[0];
    if (node === undefined) throw new Error("fixture node missing");
    node.presentation.label =
      '<script src="https://evil.example/x.js">attack</script>';
    const { container } = render(
      <RepositoryConformanceView
        architecture={malicious}
        mode="professional"
        result={result}
      />,
    );
    expect(screen.getAllByText(node.presentation.label)).toHaveLength(2);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a[href]")).toBeNull();
  });
});
