import type {
  GithubBranchV1,
  GithubRepositoryDiscoveryV1,
  GithubInstallationV1,
  GithubRepositoryImportV1,
  GithubRepositoryV1,
} from "@cloudmarkup/api-contract";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GitHubRepositoryImportPanel } from "./GitHubRepositoryImportPanel.js";

const SHA = "a".repeat(40);
const NEXT_SHA = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const AT = "2026-08-25T12:00:00.000Z";

const installations: readonly GithubInstallationV1[] = [
  {
    accountId: 1,
    accountLogin: "example-org",
    accountType: "Organization",
    createdAt: AT,
    installationId: 77,
    integrationId: "integration_github-test",
    organizationId: "organization.1",
    permissions: {
      contents: "read",
      metadata: "read",
      pullRequests: "none",
      workflows: "none",
    },
    repositorySelection: "selected",
    status: "connected",
    updatedAt: AT,
  },
];

const repositories: readonly GithubRepositoryV1[] = [
  {
    archived: false,
    defaultBranch: "main",
    disabled: false,
    installationId: 77,
    integrationId: "integration_github-test",
    name: "customer-repository",
    nodeId: "R_repository",
    organizationId: "organization.1",
    owner: "example-org",
    private: true,
    pushedAt: AT,
    repositoryId: 202,
    updatedAt: AT,
  },
];

const branches: readonly GithubBranchV1[] = [
  { name: "main", protected: true, sha: SHA },
];

const history: readonly GithubRepositoryImportV1[] = [
  {
    branch: "main",
    branchChangedSinceSelection: true,
    branchHeadSha: NEXT_SHA,
    commitSha: SHA,
    completedAt: AT,
    createdAt: AT,
    fileDifferences: [
      {
        action: "modified",
        currentDigest: DIGEST,
        path: "application/index.ts",
      },
    ],
    files: [{ digest: DIGEST, path: "application/index.ts", sizeBytes: 256 }],
    ignoredFiles: [{ path: ".env", reason: "sensitive-path" }],
    ignoredPaths: [".env"],
    importId: "githubimport_ui-test",
    inferenceClaims: [
      {
        category: "connection",
        claimId: "claim.application.connection",
        confidenceBasisPoints: 7_500,
        evidenceIds: ["evidence.application.connection"],
        observedOnly: true,
        summary: "The handler may write to the imported table.",
      },
    ],
    issues: [
      {
        evidenceIds: ["evidence.application.connection"],
        issueId: "issue.application.ambiguity",
        lifecycle: "current",
        severity: "warning",
        source: "repository-import-mismatch",
        summary: "Confirm the inferred application relationship.",
      },
    ],
    projectId: "project_ui-test",
    recordVersion: 2,
    repositoryId: 202,
    repositoryName: "customer-repository",
    repositoryOwner: "example-org",
    selectedPaths: ["application"],
    semanticDifferences: [],
    snapshotDigest: DIGEST,
    snapshotId: "repository_snapshot_ui_test",
    sourceEvidence: [
      {
        confidence: "unresolved",
        evidenceId: "evidence.application.connection",
        fileDigest: DIGEST,
        path: "application/index.ts",
        startLine: 4,
      },
    ],
    state: "succeeded",
    trigger: "manual",
    updatedAt: AT,
  },
];

describe("GitHubRepositoryImportPanel", () => {
  it("pins repository selection, scope, prior snapshot, and optional push refresh", async () => {
    const onImport = vi.fn(() => Promise.resolve());
    const onConfigureWebhookRefresh = vi.fn(() => Promise.resolve());
    render(
      <GitHubRepositoryImportPanel
        assistanceMode="professional"
        branches={branches}
        history={history}
        installations={installations}
        onConfigureWebhookRefresh={onConfigureWebhookRefresh}
        onImport={onImport}
        repositories={repositories}
      />,
    );

    expect(screen.getByText(/Your code is never executed/iu)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("branch moved");
    expect(
      screen.getByText("Observed-only inferred relationships"),
    ).toBeVisible();
    expect(
      screen.getByText("Confirm the inferred application relationship."),
    ).toBeVisible();
    expect(screen.queryByText("private source")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Pinned commit SHA"), {
      target: { value: NEXT_SHA },
    });
    expect(
      screen.getByLabelText(
        "Import scope (one repository-relative path per line)",
      ),
    ).not.toBeVisible();
    fireEvent.click(
      screen.getByText("Choose files and import options", { exact: true }),
    );
    fireEvent.change(
      screen.getByLabelText(
        "Import scope (one repository-relative path per line)",
      ),
      { target: { value: "application\ninfrastructure" } },
    );
    fireEvent.change(screen.getByLabelText("Compare with previous snapshot"), {
      target: { value: history[0]?.importId },
    });
    fireEvent.click(
      screen.getByLabelText(
        "Refresh automatically for verified push events on this exact repository and branch",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh at commit" }));

    expect(onImport).toHaveBeenCalledWith({
      branch: "main",
      commitSha: NEXT_SHA,
      contractVersion: 1,
      ignoredPaths: ["node_modules", ".terraform", "dist", ".env"],
      integrationId: "integration_github-test",
      previousImportId: "githubimport_ui-test",
      repositoryId: 202,
      requestedMode: "professional",
      selectedPaths: ["application", "infrastructure"],
    });
    await waitFor(() => {
      expect(onConfigureWebhookRefresh).toHaveBeenCalledWith(
        expect.objectContaining({
          commitSha: NEXT_SHA,
          enabled: true,
          previousImportId: "githubimport_ui-test",
        }),
      );
    });
  });

  it("blocks an invalid commit before invoking import", () => {
    const onImport = vi.fn();
    render(
      <GitHubRepositoryImportPanel
        assistanceMode="guided"
        branches={branches}
        history={[]}
        installations={installations}
        onImport={onImport}
        repositories={repositories}
      />,
    );
    const commit = screen.getByLabelText("Pinned commit SHA");
    fireEvent.change(commit, { target: { value: "main" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Import pinned commit" }),
    );
    expect(commit).toHaveAttribute("aria-invalid", "true");
    expect(onImport).not.toHaveBeenCalled();
  });
});

it("shows unsupported module review evidence for a completed import without an empty-success claim", () => {
  const baseline = history[0];
  if (baseline === undefined)
    throw new Error("Missing import projection fixture.");
  const summary =
    "Terraform modules were found. Module resources are not resolved during import; review the module code separately before relying on conformance.";
  render(
    <GitHubRepositoryImportPanel
      assistanceMode="guided"
      branches={branches}
      installations={installations}
      repositories={repositories}
      onImport={vi.fn(() => Promise.resolve())}
      history={[
        {
          ...baseline,
          branchChangedSinceSelection: false,
          inferenceClaims: [],
          files: [
            { path: "infrastructure/main.tf", digest: DIGEST, sizeBytes: 128 },
          ],
          issues: [
            {
              issueId: "issue.module-unresolved",
              lifecycle: "current",
              source: "repository-import-mismatch",
              severity: "error",
              summary,
              evidenceIds: ["source.module-unresolved"],
            },
          ],
          sourceEvidence: [
            {
              confidence: "confirmed",
              evidenceId: "source.module-unresolved",
              fileDigest: DIGEST,
              path: "infrastructure/main.tf",
              startLine: 2,
            },
          ],
        },
      ]}
    />,
  );
  expect(screen.getByText(summary)).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Active issues (1)" }),
  ).toBeVisible();
  expect(screen.getByText("Line 2 · confirmed")).toBeVisible();
  expect(
    screen.queryByText("No active repository ambiguity or conformance issues."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Accept into design/u }),
  ).not.toBeInTheDocument();
});

it("allows discovery before a saved revision and sends explicitly chosen paths after import is enabled", async () => {
  const onImport = vi.fn(() => Promise.resolve());
  const onDiscover = vi.fn(() =>
    Promise.resolve({
      branch: "main",
      commitSha: SHA,
      branchHeadSha: SHA,
      branchChangedSinceSelection: false,
      contractVersion: 1,
      treeSha: NEXT_SHA,
      integrationId: "integration_github-test",
      projectId: "project_test",
      repositoryId: 202,
      files: [
        { path: "infrastructure/main.tf", gitBlobSha: SHA, sizeBytes: 100 },
      ],
    } satisfies GithubRepositoryDiscoveryV1),
  );
  const props = {
    assistanceMode: "guided" as const,
    branches,
    history: [],
    installations,
    repositories,
    onImport,
    onDiscover,
  };
  const view = render(<GitHubRepositoryImportPanel {...props} disabled />);
  expect(
    screen.getByRole("button", { name: "Import pinned commit" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Discover repository files" }),
  );
  fireEvent.click(
    await screen.findByRole("checkbox", {
      name: "Select infrastructure/main.tf",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use selected files" }));
  view.rerender(<GitHubRepositoryImportPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Import pinned commit" }));
  await waitFor(() => {
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({
        commitSha: SHA,
        selectedPaths: ["infrastructure/main.tf"],
      }),
    );
  });
  fireEvent.change(screen.getByLabelText("Pinned commit SHA"), {
    target: { value: NEXT_SHA },
  });
  expect(
    screen.queryByRole("checkbox", { name: "Select infrastructure/main.tf" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Import scope: All eligible files")).toBeVisible();
});
