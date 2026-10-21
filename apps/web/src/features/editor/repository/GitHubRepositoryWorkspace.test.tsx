import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
  GithubRepositoryImportV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import {
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
} from "../../../api/index.js";
import { RouterProvider } from "../../../routing/index.js";
import { ModePreferenceProvider } from "../../../preferences/ModePreferenceProvider.js";
import { loadFoundationArchitectureDocument } from "../model/foundation-editor-fixture.js";
import { GitHubRepositoryWorkspace } from "./GitHubRepositoryWorkspace.js";

const organizationId = "org_repository_import";
const projectId = "project_repository_import";
const integrationId = "integration_repository_import";
const repositoryId = 42;
const commitSha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const now = "2026-08-25T12:00:00.000Z";
const comparisonRevisionId = "solution_revision_import_baseline";
const principal: CurrentPrincipalV1 = {
  displayName: "Repository reviewer",
  id: "principal_repository_reviewer",
  organizationContexts: [
    {
      capabilities: ["integrations.read", "projects.read", "projects.mutate"],
      isOwner: false,
      membershipId: "membership_repository_reviewer",
      organizationId,
      role: "administrator",
    },
  ],
  resourceVersion: 1,
};

function repositoryImportRecord() {
  return {
    comparisonSolutionRevisionId: comparisonRevisionId,
    branch: "main",
    branchHeadSha: commitSha,
    commitSha,
    completedAt: now,
    createdAt: now,
    fileDifferences: [],
    files: [{ digest, path: "infrastructure/main.tf", sizeBytes: 128 }],
    ignoredFiles: [],
    ignoredPaths: [".env"],
    importId: "githubimport_notes",
    inferenceClaims: [],
    issues: [],
    observedSolution: {
      connections: [],
      evidence: [
        {
          fileChecksum: digest,
          location: { endLine: 3, startLine: 1 },
          path: "infrastructure/main.tf",
          sourceEvidenceId: "source.table",
        },
      ],
      externalResources: [],
      resources: [
        {
          capability: "cloudmarkup.import.resource",
          certainty: { confidence: 1, kind: "deterministic" },
          designComparison: {
            state: "matches-approved-design",
            target: {
              kind: "architecture-node",
              nodeId: "node_application",
            },
          },
          observedResourceId: "observed.fact.table",
          resourceType: "aws.dynamodb.table",
          sourceEvidenceIds: ["source.table"],
        },
      ],
    },
    projectId,
    recordVersion: 1,
    repositoryId,
    repositoryName: "notes-api",
    repositoryOwner: "cloudmarkup",
    selectedPaths: ["."],
    semanticDifferences: [
      {
        differenceId: "difference.table",
        digest,
        evidenceIds: ["source.table"],
        kind: "configuration-mismatch",
        observedFactIds: ["fact.table"],
        operationId: "reconcile.table",
        operationKind: "accept-observed-graph-change",
        severity: "error",
        summary: "Observed configuration differs from the approved design.",
      },
    ],
    snapshotDigest: digest,
    snapshotId: "snapshot_notes",
    sourceEvidence: [
      {
        confidence: "confirmed",
        evidenceId: "source.table",
        fileDigest: digest,
        path: "infrastructure/main.tf",
        startLine: 1,
      },
    ],
    state: "succeeded",
    trigger: "manual",
    updatedAt: now,
  };
}

function testClient(
  importState: GithubRepositoryImportV1["state"] = "succeeded",
  revisionResponse?: () => unknown,
) {
  const record = repositoryImportRecord();
  const request = vi.fn((operationId: string) => {
    switch (operationId) {
      case "solution-revisions.list":
        return revisionResponse === undefined
          ? {
              apiVersion: "v1",
              data: [{ projectId, solutionRevisionId: comparisonRevisionId }],
              page: { hasMore: false },
            }
          : revisionResponse();
      case "solution-revisions.get": {
        const architecture = loadFoundationArchitectureDocument();
        const node = architecture.nodes[0];
        if (node === undefined)
          throw new Error("Missing synthetic diagram node.");
        node.presentation.label = "Published import baseline";
        return {
          apiVersion: "v1",
          data: {
            summary: { projectId, solutionRevisionId: comparisonRevisionId },
            revision: { architectureDocument: architecture },
          },
        };
      }
      case "github-installations.list":
        return {
          apiVersion: "v1",
          data: [
            {
              accountId: 2,
              accountLogin: "cloudmarkup",
              accountType: "Organization",
              createdAt: now,
              installationId: 3,
              integrationId,
              organizationId,
              permissions: {
                contents: "read",
                metadata: "read",
                pullRequests: "none",
                workflows: "none",
              },
              repositorySelection: "selected",
              status: "connected",
              updatedAt: now,
            },
          ],
          page: { hasMore: false },
        };
      case "github-repositories.list":
        return {
          apiVersion: "v1",
          data: [
            {
              archived: false,
              defaultBranch: "main",
              disabled: false,
              installationId: 3,
              integrationId,
              name: "notes-api",
              nodeId: "R_notes",
              organizationId,
              owner: "cloudmarkup",
              private: true,
              pushedAt: now,
              repositoryId,
              updatedAt: now,
            },
          ],
          page: { hasMore: false },
        };
      case "github-repository-discovery.read":
        return {
          apiVersion: "v1",
          data: {
            contractVersion: 1,
            projectId,
            integrationId,
            repositoryId,
            branch: "main",
            commitSha,
            branchHeadSha: commitSha,
            branchChangedSinceSelection: false,
            treeSha: "b".repeat(40),
            files: [
              {
                path: "infrastructure/main.tf",
                gitBlobSha: "c".repeat(40),
                sizeBytes: 128,
              },
            ],
          },
        };
      case "github-repository-branches.list":
        return {
          apiVersion: "v1",
          data: [{ name: "main", protected: true, sha: commitSha }],
          page: { hasMore: false },
        };
      case "github-repository-imports.list":
        return {
          apiVersion: "v1",
          data: [record],
          page: { hasMore: false },
        };
      case "github-repository-imports.create":
        return { apiVersion: "v1", data: { ...record, state: importState } };
      case "github-repository-import-reviews.create":
        return {
          apiVersion: "v1",
          data: {
            decision: "accept-into-design",
            designChanged: true,
            importId: record.importId,
            operationId: "reconcile.table",
            receiptId: "review_notes",
            reviewedAt: now,
            snapshotDigest: digest,
          },
        };
      default:
        throw new Error(`Unexpected operation ${operationId}`);
    }
  });
  return {
    client: {
      request,
      requestWithMetadata: vi.fn(),
    } as unknown as CloudMarkupClient,
    request,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderImportWorkspace(
  fixture: ReturnType<typeof testClient>,
  queryClient: QueryClient,
  firstRevisionAction?: ReactNode,
) {
  render(
    <ModePreferenceProvider actorId={principal.id}>
      <CloudMarkupQueryProvider
        client={fixture.client}
        queryClient={queryClient}
      >
        <GitHubRepositoryWorkspace
          architecture={loadFoundationArchitectureDocument()}
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
          {...(firstRevisionAction === undefined
            ? {}
            : { firstRevisionAction: () => firstRevisionAction })}
        />
      </CloudMarkupQueryProvider>
    </ModePreferenceProvider>,
  );
}

describe("GitHubRepositoryWorkspace", () => {
  it("keeps a first import disabled until a saved revision is confirmed by the server, then leaves importing explicit", async () => {
    let saved = false;
    let release: ((value: unknown) => void) | undefined;
    const confirmation = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const fixture = testClient("succeeded", () =>
      saved
        ? confirmation
        : { apiVersion: "v1", data: [], page: { hasMore: false } },
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const save = vi.fn(() => {
      saved = true;
      void queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.revisions(
          principal.id,
          organizationId,
          projectId,
        ),
      });
    });
    renderImportWorkspace(
      fixture,
      queryClient,
      <button type="button" onClick={save}>
        Save first revision
      </button>,
    );
    expect(
      await screen.findByRole("heading", { name: "Save your first revision" }),
    ).toBeVisible();
    const submit = screen.getByRole("button", { name: "Import pinned commit" });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Pinned commit SHA")).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Discover repository files" }),
    );
    expect(
      await screen.findByRole("checkbox", {
        name: "Select infrastructure/main.tf",
      }),
    ).toBeVisible();
    expect(fixture.request).toHaveBeenCalledWith(
      "github-repository-discovery.read",
      {
        path: { projectId },
        body: {
          branch: "main",
          commitSha,
          contractVersion: 1,
          ignoredPaths: ["node_modules", ".terraform", "dist", ".env"],
          integrationId,
          repositoryId,
          selectedPaths: ["."],
        },
      },
    );
    expect(submit).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save first revision" }),
    );
    await screen.findByText("Checking your saved revision before import…");
    expect(submit).toBeDisabled();
    expect(
      fixture.request.mock.calls.some(
        ([operation]) => operation === "github-repository-imports.create",
      ),
    ).toBe(false);
    if (release === undefined)
      throw new Error("Expected pending revision confirmation.");
    const confirm = release;
    await act(async () => {
      confirm({
        apiVersion: "v1",
        data: [{ projectId, solutionRevisionId: comparisonRevisionId }],
        page: { hasMore: false },
      });
      await confirmation;
    });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    expect(
      screen.queryByRole("heading", { name: "Save your first revision" }),
    ).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledOnce();
    expect(
      fixture.request.mock.calls.some(
        ([operation]) => operation === "github-repository-imports.create",
      ),
    ).toBe(false);
    fireEvent.click(submit);
    await screen.findByText(
      /was imported without changing the approved design/u,
    );
  });
  it.each(["failure", "foreign"] as const)(
    "keeps import unavailable on %s baseline response and supports a fresh read",
    async (failure) => {
      let ready = false;
      const fixture = testClient("succeeded", () =>
        ready
          ? {
              apiVersion: "v1",
              data: [{ projectId, solutionRevisionId: comparisonRevisionId }],
            }
          : failure === "failure"
            ? Promise.reject(new Error("Synthetic baseline lookup failure"))
            : {
                apiVersion: "v1",
                data: [
                  {
                    projectId: "project.foreign",
                    solutionRevisionId: comparisonRevisionId,
                  },
                ],
              },
      );
      renderImportWorkspace(
        fixture,
        new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      );
      expect(
        await screen.findByRole("heading", {
          name: "We couldn't check your saved revision",
        }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Import pinned commit" }),
      ).toBeDisabled();
      ready = true;
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Import pinned commit" }),
        ).toBeEnabled();
      });
      expect(
        fixture.request.mock.calls.some(
          ([operation]) => operation === "github-repository-imports.create",
        ),
      ).toBe(false);
    },
  );
  it("does not offer automatic refresh or generated-drift regeneration that production cannot perform", async () => {
    const fixture = testClient();
    const base = fixture.request.getMockImplementation();
    fixture.request.mockImplementation((operation) =>
      operation === "github-repository-imports.list"
        ? {
            apiVersion: "v1",
            data: [
              {
                ...repositoryImportRecord(),
                semanticDifferences: [
                  {
                    differenceId: "difference.generated",
                    digest,
                    evidenceIds: [],
                    kind: "generated-file-drift",
                    observedFactIds: [],
                    operationId: "reconcile.generated",
                    operationKind: "update-generated-output-to-design",
                    severity: "error",
                    summary: "Generated content changed.",
                  },
                ],
              },
            ],
          }
        : base?.(operation),
    );
    renderImportWorkspace(
      fixture,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    fireEvent.click(await screen.findByText("Choose files and import options"));
    expect(
      screen.queryByRole("checkbox", { name: /Refresh automatically/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Automatic refresh is not available here/u),
    ).toBeVisible();
    fireEvent.click(
      await screen.findByRole("tab", { name: "Differences (1)" }),
    );
    expect(
      screen.getByRole("button", { name: "Regenerate to design" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Regeneration from repository review is not available/u),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Keep observed-only" }),
    ).toBeEnabled();
  });
  it.each(["installation", "repository"] as const)(
    "shows a setup action when no %s is available, instead of waiting on disabled queries",
    async (empty) => {
      const fixture = testClient();
      const baseRequest = fixture.request.getMockImplementation();
      fixture.request.mockImplementation((operationId: string) => {
        if (
          operationId ===
          (empty === "installation"
            ? "github-installations.list"
            : "github-repositories.list")
        ) {
          return { apiVersion: "v1", data: [], page: { hasMore: false } };
        }
        if (baseRequest === undefined) throw new Error("Missing test request");
        return baseRequest(operationId);
      });
      render(
        <RouterProvider>
          <ModePreferenceProvider actorId={principal.id}>
            <CloudMarkupQueryProvider
              client={fixture.client}
              queryClient={
                new QueryClient({
                  defaultOptions: { queries: { retry: false } },
                })
              }
            >
              <GitHubRepositoryWorkspace
                architecture={loadFoundationArchitectureDocument()}
                organizationId={organizationId}
                principal={principal}
                projectId={projectId}
              />
            </CloudMarkupQueryProvider>
          </ModePreferenceProvider>
        </RouterProvider>,
      );
      const link = await screen.findByRole("link", {
        name:
          empty === "installation"
            ? "Connect GitHub"
            : "Manage GitHub connection",
      });
      expect(link).toHaveAttribute(
        "href",
        "/organizations/" + organizationId + "/settings/integrations",
      );
      expect(screen.queryByText("Loading authorized repositories…")).toBeNull();
      expect(fixture.request).not.toHaveBeenCalledWith(
        "github-repository-branches.list",
        expect.anything(),
      );
    },
  );

  it("reports a failed import without announcing a successful snapshot", async () => {
    const { client } = testClient("failed-permanent");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <ModePreferenceProvider actorId={principal.id}>
        <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
          <GitHubRepositoryWorkspace
            architecture={loadFoundationArchitectureDocument()}
            organizationId={organizationId}
            principal={principal}
            projectId={projectId}
          />
        </CloudMarkupQueryProvider>
      </ModePreferenceProvider>,
    );
    const button = await screen.findByRole("button", {
      name: "Import pinned commit",
    });
    fireEvent.click(button);
    expect(
      await screen.findByText(/The repository import failed/u),
    ).toBeVisible();
    expect(screen.queryByText(/was imported without changing/u)).toBeNull();
  });
  it("loads tenant-bound pinned evidence and delegates acceptance to the saved editor", async () => {
    const { client, request } = testClient();
    const accept = vi.fn(
      async ({
        importId,
        input,
        idempotencyKey,
      }: import("./GitHubRepositoryWorkspace.js").RepositoryGraphAcceptanceRequest) =>
        (
          await client.request("github-repository-import-reviews.create", {
            body: input,
            headers: { "idempotency-key": idempotencyKey },
            path: { importId, projectId },
          })
        ).data,
    );
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    render(
      <ModePreferenceProvider actorId={principal.id}>
        <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
          <GitHubRepositoryWorkspace
            onAcceptIntoDesign={accept}
            architecture={loadFoundationArchitectureDocument()}
            organizationId={organizationId}
            principal={principal}
            projectId={projectId}
          />
        </CloudMarkupQueryProvider>
      </ModePreferenceProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Import Terraform or CloudFormation",
      }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue(commitSha)).toBeInTheDocument();
    expect(
      await screen.findByRole("img", {
        name: /Approved architecture diagram/u,
      }),
    ).toBeInTheDocument();

    expect(request).toHaveBeenCalledWith("solution-revisions.get", {
      path: { projectId, solutionRevisionId: comparisonRevisionId },
    });
    expect(
      queryClient.getQueryData(
        cloudMarkupQueryKeys.revision(
          principal.id,
          organizationId,
          projectId,
          comparisonRevisionId,
        ),
      ),
    ).toMatchObject({
      summary: { solutionRevisionId: comparisonRevisionId },
      revision: {
        architectureDocument: {
          documentId: loadFoundationArchitectureDocument().documentId,
        },
      },
    });
    expect(
      screen.getAllByText(/Published import baseline/u).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("img", {
        name: "Imported architecture diagram from repository source",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Differences (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept into design" }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "github-repository-import-reviews.create",
        expect.objectContaining({
          body: {
            contractVersion: 1,
            decision: "accept-into-design",
            expectedSnapshotDigest: digest,
            operationId: "reconcile.table",
          },
          path: {
            importId: "githubimport_notes",
            projectId,
          },
        }),
      );
    });
    expect(
      await screen.findByText(
        "The accepted canonical operation changed the approved design.",
      ),
    ).toBeInTheDocument();
  });
});
