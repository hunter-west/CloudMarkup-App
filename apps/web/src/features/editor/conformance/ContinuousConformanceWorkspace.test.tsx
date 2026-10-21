import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContinuousConformanceWorkspace } from "./ContinuousConformanceWorkspace.js";
import {
  CONTINUOUS_CONFORMANCE_STATES,
  type ContinuousConformanceLayer,
  type ContinuousConformanceReadModel,
} from "./model.js";

afterEach(cleanup);

function layer(
  state: ContinuousConformanceLayer["state"],
): ContinuousConformanceLayer {
  return {
    diagram: {
      edges: [
        {
          differenceIds: ["difference.network"],
          evidenceIds: [`evidence.${state}`],
          id: `edge.${state}`,
          label: "invokes",
          mapping: "mapped",
          presence: "present",
          sourceNodeId: `node.${state}.source`,
          status: state === "planned" ? "different" : "matching",
          targetNodeId: `node.${state}.target`,
        },
      ],
      nodes: [
        {
          differenceIds: ["difference.network"],
          evidenceIds: [`evidence.${state}`],
          id: `node.${state}.source`,
          label:
            state === "imported"
              ? "Authorization: Bearer private-value"
              : `${state} source`,
          mapping: "mapped",
          position: { x: 100, y: 120 },
          presence: "present",
          serviceLabel: "AWS Lambda",
          status: state === "planned" ? "different" : "matching",
        },
        {
          differenceIds: [],
          evidenceIds: [`evidence.${state}`],
          id: `node.${state}.target`,
          label: `${state} target`,
          mapping: "mapped",
          position: { x: 500, y: 120 },
          presence:
            state === "current-drift" ? "comparison-only-missing" : "present",
          serviceLabel: "Amazon DynamoDB",
          status: state === "current-drift" ? "unknown" : "matching",
        },
      ],
      unmappedEvidence:
        state === "imported"
          ? [
              {
                evidenceIds: [`evidence.${state}`],
                id: "unmapped.imported.bucket",
                kind: "resource",
                label: "Imported bucket without a stable key",
                reason: "No approved deployment key was safely mapped.",
              },
            ]
          : [],
    },
    evidence: [
      {
        evidenceIds: [`evidence.${state}`],
        level: state,
        provenanceId: `source.${state}`,
        sourceDigest: `sha256:${"b".repeat(64)}`,
        sourceLabel: `${state} evidence source`,
        toolLabel: "conformance-evaluator@1.0.0",
        verifiedAt: "2026-08-29T10:05:00.000Z",
      },
    ],
    quality:
      state === "imported"
        ? {
            completeness: "partial",
            availability: "available",
            expiresAt: "2026-08-29T10:30:00.000Z",
            freshness: "stale",
            lastVerifiedAt: "2026-08-29T10:05:00.000Z",
            freshnessReasons: ["source-declared-stale"],
            reason: "Repository evidence is partial and stale.",
          }
        : state === "current-drift"
          ? {
              completeness: "unknown",
              availability: "unavailable",
              freshness: "invalid",
              reason: "Read-only drift evidence did not verify.",
              freshnessReasons: ["evidence-unavailable"],
            }
          : {
              completeness: "complete",
              availability: "available",
              freshness: "current",
              lastVerifiedAt: "2026-08-29T10:05:00.000Z",
              freshnessReasons: [],
            },
    state,
  };
}

const report: ContinuousConformanceReadModel = {
  differences: [
    {
      differenceId: "difference.network",
      evidenceIds: ["evidence.planned"],
      kind: "network-public-exposure-change",
      reviewActions: [
        {
          actionKey: "action.issue.network",
          differenceId: "difference.network",
          kind: "github-issue",
        },
        {
          actionKey: "action.pr.network",
          differenceId: "difference.network",
          kind: "reconciliation-pr",
        },
      ],
      severity: "security-error",
      states: ["planned", "current-drift"],
      summary: "A safely mapped network exposure changed.",
      target: { id: "node.planned.source", kind: "node" },
    },
    {
      differenceId: "difference.partial",
      evidenceIds: ["evidence.imported"],
      kind: "partial-evidence",
      reviewActions: [],
      severity: "warning",
      states: ["imported"],
      summary: "Imported evidence is partial.",
    },
  ],
  environmentLabel: "staging",
  issues: [
    {
      evidenceIds: ["evidence.planned"],
      issueId: "issue.network",
      lifecycle: "current",
      severity: "security-error",
      source: "cloud-plan-change-set",
      summary: "Public exposure requires review.",
    },
  ],
  layers: CONTINUOUS_CONFORMANCE_STATES.map(layer),
  environmentId: "environment.staging",
  reportDigest: `sha256:${"a".repeat(64)}`,
  reportId: "report.notes.7",
  solutionRevisionId: "revision.notes.7",
};

describe("ContinuousConformanceWorkspace", () => {
  it("shows quality, provenance, unmapped Evidence, and safe mapped-only projections without fabricating inventory", () => {
    const { container } = render(
      <ContinuousConformanceWorkspace mode="guided" report={report} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Imported" }));

    expect(screen.getByText("partial · stale")).toBeVisible();
    expect(screen.getByText("2026-08-29T10:30:00.000Z")).toBeVisible();
    expect(screen.getByText(/source sha256:/u)).toBeVisible();
    expect(
      screen.getAllByText("2026-08-29T10:05:00.000Z").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Imported bucket without a stable key"),
    ).toBeVisible();
    expect(screen.getByText("Sensitive label redacted")).toBeVisible();
    expect(container).not.toHaveTextContent("Bearer private-value");
    expect(
      screen.getByRole("img", {
        name: "imported safely mapped evidence diagram",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByText("Diagram text alternative"));
    const resourceAlternative = screen.getByRole("list", {
      name: "Safely mapped resources text alternative",
    });
    const connectionAlternative = screen.getByRole("list", {
      name: "Mapped connections text alternative",
    });
    expect(within(resourceAlternative).getAllByRole("listitem")).toHaveLength(
      2,
    );
    expect(resourceAlternative).toHaveTextContent("Sensitive label redacted");
    expect(connectionAlternative).toHaveTextContent(
      "Sensitive label redacted → invokes → imported target",
    );
    expect(container.querySelector("#unmapped\\.imported\\.bucket")).toBeNull();
    expect(screen.getByText(/never fabricated as inventory/u)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Current drift" }));
    expect(screen.getByText("Evidence unavailable")).toBeVisible();
    expect(
      screen.getByText(/Read-only drift evidence did not verify/u),
    ).toBeVisible();
  });

  it("never describes partial current evidence as complete and shows its expiry", () => {
    render(
      <ContinuousConformanceWorkspace
        mode="guided"
        report={{
          ...report,
          layers: report.layers.map((candidate) =>
            candidate.state === "generated"
              ? {
                  ...candidate,
                  quality: {
                    availability: "available",
                    completeness: "partial",
                    expiresAt: "2026-08-29T11:00:00.000Z",
                    freshness: "current",
                    freshnessReasons: [],
                    lastVerifiedAt: "2026-08-29T10:05:00.000Z",
                  },
                }
              : candidate,
          ),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generated" }));
    expect(screen.getByText("partial · current")).toBeVisible();
    expect(
      screen.getByText(
        "Evidence is partial and current for its declared scope.",
      ),
    ).toBeVisible();
    expect(screen.getByText("2026-08-29T11:00:00.000Z")).toBeVisible();
    expect(
      screen.queryByText("Complete and current for its declared scope."),
    ).not.toBeInTheDocument();
  });

  it("toggles the overlay and emits only exact reviewed issue or PR intents", () => {
    const exportDiagram = vi.fn();
    const review = vi.fn();
    const { container } = render(
      <ContinuousConformanceWorkspace
        mode="professional"
        onExportDiagram={exportDiagram}
        onReviewAction={review}
        report={report}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Planned" }));
    expect(
      container.querySelector(
        '.continuous-conformance__diagram [data-conformance-status="different"]',
      ),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show Differences overlay" }),
    );
    expect(
      container.querySelector(
        '.continuous-conformance__diagram [data-conformance-status="different"]',
      ),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Create or update reviewed GitHub issue",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Export current evidence diagram" }),
    );
    expect(exportDiagram).toHaveBeenCalledWith({
      contractVersion: 1,
      environmentId: "environment.staging",
      kind: "cloudmarkup.conformance-diagram-export-intent",
      reportDigest: `sha256:${"a".repeat(64)}`,
      reportId: "report.notes.7",
      showDifferences: false,
      solutionRevisionId: "revision.notes.7",
      state: "planned",
    });
    expect(review).toHaveBeenCalledWith({
      actionKey: "action.issue.network",
      differenceId: "difference.network",
      kind: "github-issue",
    });
    expect(
      screen.getByText(/cannot approve, deploy, or remediate/u),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /remediate/iu }),
    ).not.toBeInTheDocument();
  });

  it("treats an absent layer as unknown rather than empty or matching", () => {
    render(
      <ContinuousConformanceWorkspace
        mode="guided"
        report={{
          ...report,
          layers: report.layers.filter(({ state }) => state !== "deployed"),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deployed" }));
    expect(screen.getByText("Evidence unavailable")).toBeVisible();
    expect(
      screen.getByText(/unknown, not an empty or matching environment/u),
    ).toBeVisible();
  });
});
