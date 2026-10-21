import {
  principalIdSchema,
  projectIdSchema,
  type CloudMarkupClient,
} from "@cloudmarkup/api-contract";
import { evaluateConformanceV1, hashCanonicalValue } from "@cloudmarkup/domain";
import {
  defaultConformanceStalenessPolicyV1,
  solutionRevisionIdSchema,
} from "@cloudmarkup/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudMarkupQueryRuntimeContext,
  type CloudMarkupQueryRuntime,
} from "../../../api/cloudmarkup-query-context.js";
import { assertConformanceReportProjectionBindingV1 } from "./adapter.js";
import { continuousConformanceStateLabels } from "./model.js";
import {
  type ContinuousConformanceQueryBinding,
  useContinuousConformanceQueryWorkspace,
} from "./query-workspace.js";

const binding: ContinuousConformanceQueryBinding = {
  approvedTopology: { edges: [], nodes: [] },
  organizationId: "org_main",
  principalId: principalIdSchema.parse("principal_main"),
  projectId: projectIdSchema.parse("project_main"),
  solutionRevisionId: solutionRevisionIdSchema.parse("solution-revision-main"),
};

const layerEvidence = {
  designed: ["approved-documents", "architecture-document"],
  imported: ["repository-snapshot", "repository-snapshot"],
  generated: ["generated-manifest", "generated-manifest"],
  planned: ["cloud-plan-change-set", "terraform-plan"],
  deployed: ["deployment-smoke-integration", "deployment-attestation"],
  "current-drift": ["read-only-drift", "read-only-drift-result"],
} as const;

function conformanceReport() {
  const revision = {
    digest: hashCanonicalValue("query-workspace-revision"),
    id: binding.solutionRevisionId,
  };
  return evaluateConformanceV1({
    contractVersion: 1,
    currentSolutionRevision: revision,
    environment: {
      environmentId: "env_staging",
      environmentType: "staging",
    },
    evaluatedAt: "2026-08-29T12:00:00.000Z",
    evaluatedSolutionRevision: revision,
    evaluator: {
      id: "cloudmarkup.continuous-conformance",
      version: "1.0.0",
    },
    layers: (
      [
        "designed",
        "imported",
        "generated",
        "planned",
        "deployed",
        "current-drift",
      ] as const
    ).map((layer) => {
      const [evidenceType, sourceKind] = layerEvidence[layer];
      const evidenceId = `evidence.${layer}`;
      const sourceId = `source.${layer}`;
      return {
        availability: "available",
        boundSolutionRevision: revision,
        completeness: "complete",
        declaredFreshness: "current",
        evidenceIds: [evidenceId],
        evidenceType,
        ...(layer === "planned" ||
        layer === "deployed" ||
        layer === "current-drift"
          ? { environmentId: "env_staging" }
          : {}),
        ...(layer === "planned" || layer === "current-drift"
          ? { explicitExpiresAt: "2026-08-29T13:00:00.000Z" }
          : {}),
        facts:
          layer === "designed"
            ? [
                {
                  applicationBinding: "not-applicable",
                  evidenceIds: [evidenceId],
                  extensionPoint: false,
                  factId: "fact.designed.resource.processor",
                  iamAccess: "not-applicable",
                  iamPermissions: [],
                  layer,
                  management: "managed",
                  operation: "none",
                  ownership: "generated",
                  publicExposure: "private",
                  semanticComparison: {
                    basis: "resource-intent",
                    contractVersion: 1,
                    coverage: "complete",
                  },
                  semanticDigest: hashCanonicalValue("processor-resource"),
                  sourceIds: [sourceId],
                  sourceLocations: [],
                  subject: {
                    kind: "resource",
                    stableKey: "resource.processor",
                  },
                },
              ]
            : [],
        integrity: "verified",
        layer,
        sources: [
          {
            digest: hashCanonicalValue(sourceId),
            kind: sourceKind,
            observedAt: "2026-08-29T11:30:00.000Z",
            solutionRevisionId: revision.id,
            sourceId,
          },
        ],
        verifiedAt: "2026-08-29T11:30:00.000Z",
      };
    }),
    projectId: binding.projectId,
    stalenessPolicy: structuredClone(defaultConformanceStalenessPolicyV1),
  });
}

function QueryWorkspace() {
  return useContinuousConformanceQueryWorkspace({ binding, mode: "guided" })
    .content;
}

function renderWorkspace(request: ReturnType<typeof vi.fn>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const runtime = {
    client: {
      request,
      requestWithMetadata: vi.fn(),
    } as unknown as CloudMarkupClient,
    downloadBinary: vi.fn(),
    expireSession: vi.fn(),
    presentationPreferences: {},
    queryClient,
    sessionExpired: false,
  } as unknown as CloudMarkupQueryRuntime;
  return {
    queryClient,
    runtime,
    view: render(
      <QueryClientProvider client={queryClient}>
        <CloudMarkupQueryRuntimeContext.Provider value={runtime}>
          <QueryWorkspace />
        </CloudMarkupQueryRuntimeContext.Provider>
      </QueryClientProvider>,
    ),
  };
}

async function selectStagingEnvironment() {
  const selector = await screen.findByRole("combobox", {
    name: "Project environment",
  });
  await screen.findByRole("option", { name: "Staging · staging" });
  fireEvent.change(selector, { target: { value: "env_staging" } });
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (part) =>
    part.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function environmentResponse() {
  return {
    apiVersion: "v1",
    data: [
      {
        createdAt: "2026-08-29T10:00:00.000Z",
        environmentType: "staging",
        id: "env_staging",
        lifecycleStatus: "active",
        name: "Staging",
        projectId: binding.projectId,
        version: 1,
      },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authorized continuous conformance query workspace", () => {
  it("does not guess an environment and requests evidence only after explicit selection", async () => {
    const request = vi.fn((operation: string) => {
      if (operation === "environments.list") return environmentResponse();
      throw new Error("Conformance fixture intentionally unavailable.");
    });
    renderWorkspace(request);
    const selector = await screen.findByRole("combobox", {
      name: "Project environment",
    });
    expect(selector).toHaveValue("");
    expect(screen.getByText(/does not guess or preselect one/u)).toBeVisible();
    await screen.findByRole("option", { name: "Staging · staging" });
    expect(selector).toBeEnabled();
    expect(request).toHaveBeenCalledTimes(1);

    fireEvent.change(selector, { target: { value: "env_staging" } });
    expect(
      await screen.findByText(
        /unavailable or failed exact binding validation/u,
      ),
    ).toBeVisible();
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
    });
    expect(request.mock.calls[1]).toEqual([
      "continuous-conformance.get",
      {
        path: {
          environmentId: "env_staging",
          projectId: binding.projectId,
          solutionRevisionId: binding.solutionRevisionId,
        },
      },
    ]);
  });

  it("downloads only a checksum-bound server SVG and executes only a server-known reviewed action", async () => {
    const report = conformanceReport();
    const reviewable = report.differences[0];
    if (reviewable === undefined) throw new Error("Expected one difference.");
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><text>opaque-server-svg</text></svg>';
    const svgChecksum = await sha256Text(svg);
    const createObjectUrl = vi.fn(() => "blob:conformance-diagram");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    let conformanceGets = 0;
    const request = vi.fn((operation: string, input: unknown) => {
      if (operation === "environments.list") return environmentResponse();
      if (operation === "continuous-conformance.get") {
        conformanceGets += 1;
        return {
          apiVersion: "v1",
          data: {
            availableReviewActions: [
              {
                actions: [
                  {
                    actionKey: "action.issue.processor",
                    kind: "github-issue",
                  },
                ],
                differenceId: reviewable.differenceId,
              },
            ],
            report,
          },
        };
      }
      const requestInput = input as {
        readonly body: Record<string, unknown>;
      };
      if (operation === "continuous-conformance.export-diagram") {
        return {
          apiVersion: "v1",
          data: {
            ...requestInput.body,
            artifact: {
              artifactId: "artifact.conformance.designed",
              checksum: svgChecksum,
              mediaType: "image/svg+xml",
              sizeBytes: new TextEncoder().encode(svg).byteLength,
            },
            svg,
          },
        };
      }
      if (operation === "continuous-conformance.review-action") {
        return {
          apiVersion: "v1",
          data: {
            ...requestInput.body,
            receipt: {
              actionId: "action.receipt.processor",
              createdAt: "2026-08-29T12:01:00.000Z",
              mergeAuthority: "none",
              providerRecordDigest: hashCanonicalValue("provider-record"),
              remediation: "none",
              sourceRecordDigest: hashCanonicalValue("source-record"),
              state: "created",
            },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}.`);
    });
    renderWorkspace(request);
    await selectStagingEnvironment();
    await screen.findByText(report.reportId);

    fireEvent.click(
      screen.getByRole("button", { name: "Export current evidence diagram" }),
    );
    expect(await screen.findByText(/verified and downloaded/u)).toBeVisible();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:conformance-diagram");
    expect(document.body).not.toHaveTextContent("opaque-server-svg");

    fireEvent.click(
      screen.getByRole("button", {
        name: continuousConformanceStateLabels[reviewable.layer],
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Create or update reviewed GitHub issue",
      }),
    );
    expect(
      await screen.findByText(/GitHub issue action was recorded/u),
    ).toBeVisible();
    await waitFor(() => {
      expect(conformanceGets).toBeGreaterThanOrEqual(2);
    });

    const exportCall = request.mock.calls.find(
      ([operation]) => operation === "continuous-conformance.export-diagram",
    );
    expect(exportCall?.[1]).toEqual({
      body: {
        contractVersion: 1,
        reportDigest: report.reportDigest,
        reportId: report.reportId,
        showDifferences: true,
        state: "designed",
      },
      path: {
        environmentId: "env_staging",
        projectId: binding.projectId,
        solutionRevisionId: binding.solutionRevisionId,
      },
    });
    const reviewCall = request.mock.calls.find(
      ([operation]) => operation === "continuous-conformance.review-action",
    );
    const reviewInput = reviewCall?.[1] as
      | {
          readonly body: Record<string, unknown>;
          readonly headers: { readonly "idempotency-key": string };
          readonly path: Record<string, unknown>;
        }
      | undefined;
    expect(reviewInput?.body).toEqual({
      actionKey: "action.issue.processor",
      contractVersion: 1,
      differenceId: reviewable.differenceId,
      kind: "github-issue",
      reportDigest: report.reportDigest,
      reportId: report.reportId,
    });
    expect(reviewInput?.headers["idempotency-key"]).toMatch(
      /^conformance-review:[a-f0-9]{64}$/u,
    );
    expect(reviewInput?.path).toEqual({
      environmentId: "env_staging",
      projectId: binding.projectId,
      solutionRevisionId: binding.solutionRevisionId,
    });
  });

  it("fails closed when server action availability references another report difference", async () => {
    const report = conformanceReport();
    const request = vi.fn((operation: string) => {
      if (operation === "environments.list") return environmentResponse();
      if (operation === "continuous-conformance.get") {
        return {
          apiVersion: "v1",
          data: {
            availableReviewActions: [
              {
                actions: [
                  { actionKey: "action.cross-bound", kind: "github-issue" },
                ],
                differenceId: "difference.from-another-report",
              },
            ],
            report,
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}.`);
    });
    renderWorkspace(request);
    await selectStagingEnvironment();
    expect(
      await screen.findByText(/failed exact binding validation/u),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "Create or update reviewed GitHub issue",
      }),
    ).not.toBeInTheDocument();
  });

  it("rejects mismatched operation responses and does not download or refetch them", async () => {
    const report = conformanceReport();
    const reviewable = report.differences[0];
    if (reviewable === undefined) throw new Error("Expected one difference.");
    const createObjectUrl = vi.fn(() => "blob:must-not-be-used");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    let conformanceGets = 0;
    const request = vi.fn((operation: string, input: unknown) => {
      if (operation === "environments.list") return environmentResponse();
      if (operation === "continuous-conformance.get") {
        conformanceGets += 1;
        return {
          apiVersion: "v1",
          data: {
            availableReviewActions: [
              {
                actions: [
                  {
                    actionKey: "action.issue.processor",
                    kind: "github-issue",
                  },
                ],
                differenceId: reviewable.differenceId,
              },
            ],
            report,
          },
        };
      }
      const requestInput = input as {
        readonly body: Record<string, unknown>;
      };
      if (operation === "continuous-conformance.export-diagram") {
        return {
          apiVersion: "v1",
          data: {
            ...requestInput.body,
            artifact: {
              artifactId: "artifact.invalid",
              checksum: hashCanonicalValue("wrong-checksum"),
              mediaType: "image/svg+xml",
              sizeBytes: 6,
            },
            svg: "<svg/>",
          },
        };
      }
      if (operation === "continuous-conformance.review-action") {
        return {
          apiVersion: "v1",
          data: {
            ...requestInput.body,
            differenceId: "difference.cross-bound-response",
            receipt: {
              actionId: "action.invalid.receipt",
              createdAt: "2026-08-29T12:01:00.000Z",
              mergeAuthority: "none",
              providerRecordDigest: hashCanonicalValue("provider-record"),
              remediation: "none",
              sourceRecordDigest: hashCanonicalValue("source-record"),
              state: "created",
            },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}.`);
    });
    renderWorkspace(request);
    await selectStagingEnvironment();
    await screen.findByText(report.reportId);

    fireEvent.click(
      screen.getByRole("button", { name: "Export current evidence diagram" }),
    );
    expect(
      await screen.findByText(/artifact integrity validation/u),
    ).toBeVisible();
    expect(createObjectUrl).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: continuousConformanceStateLabels[reviewable.layer],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create or update reviewed GitHub issue",
      }),
    );
    expect(
      await screen.findByText(/difference, or action binding validation/u),
    ).toBeVisible();
    expect(conformanceGets).toBe(1);
  });

  it("exposes no evidence or operations without an authorized API runtime", async () => {
    render(<QueryWorkspace />);
    expect(
      await screen.findByText(/API runtime is not configured/u),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Project environment" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /evidence diagram/u }),
    ).not.toBeInTheDocument();
  });

  it("allows a newer current revision while retaining the exact evaluated revision binding", () => {
    expect(() => {
      assertConformanceReportProjectionBindingV1(
        {
          currentSolutionRevision: { id: "solution-revision-current" },
          environment: { environmentId: "env_staging" },
          evaluatedSolutionRevision: { id: binding.solutionRevisionId },
          projectId: binding.projectId,
        },
        {
          environmentId: "env_staging",
          projectId: binding.projectId,
          solutionRevisionId: binding.solutionRevisionId,
        },
      );
    }).not.toThrow();
  });

  it("fails closed when an authorized response binding differs", () => {
    const reportBinding = {
      currentSolutionRevision: {
        digest: `sha256:${"a".repeat(64)}`,
        id: binding.solutionRevisionId,
      },
      environment: {
        environmentId: "env_other",
        environmentType: "staging" as const,
      },
      evaluatedSolutionRevision: {
        digest: `sha256:${"a".repeat(64)}`,
        id: binding.solutionRevisionId,
      },
      projectId: binding.projectId,
    };
    expect(() => {
      assertConformanceReportProjectionBindingV1(reportBinding, {
        environmentId: "env_staging",
        projectId: binding.projectId,
        solutionRevisionId: binding.solutionRevisionId,
      });
    }).toThrow(
      /does not match the authorized project, evaluated revision, and environment/u,
    );
  });
});
