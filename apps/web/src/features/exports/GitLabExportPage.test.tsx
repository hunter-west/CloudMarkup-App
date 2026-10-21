/** @vitest-environment-options {"url":"https://app.example.test"} */
import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
  GitlabExportV1,
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
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudMarkupQueryProvider } from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { GitLabExportPage } from "./GitLabExportPage.js";
const organizationId = "org_gitlab",
  projectId = "project_gitlab",
  artifactId = "solutionartifact_gitlab",
  principalId = "principal_gitlab",
  connectionId = "gitlab_" + "a".repeat(32),
  reviewId = "gitlabreview_" + "b".repeat(32),
  digest = "sha256:" + "c".repeat(64),
  commit = "d".repeat(40);
const route = `/organizations/${organizationId}/projects/${projectId}/artifacts/${artifactId}/export/gitlab`;
const principal: CurrentPrincipalV1 = {
  id: principalId,
  displayName: "Synthetic owner",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId,
      membershipId: "membership_gitlab",
      role: "owner",
      isOwner: true,
      capabilities: ["exports.run", "integrations.read", "integrations.manage"],
    },
  ],
};
const initial: GitlabExportV1 = {
  contractVersion: 1,
  reviewId,
  organizationId,
  projectId,
  principalId,
  connectionId,
  providerProjectId: 42,
  selectionVersion: 7,
  artifactId,
  artifactManifestDigest: digest,
  artifactZipDigest: digest,
  approvalDigest: digest,
  baseCommitSha: "e".repeat(40),
  baseBranch: "main",
  branch: "cloudmarkup/export-" + "b".repeat(32),
  destinationFolder: "cloudmarkup/export",
  fileCount: 1,
  state: "prepared",
  recordVersion: 1,
  verifiedFiles: 0,
  commitSha: null,
  mergeRequest: null,
  expiresAt: "2099-10-01T12:15:00.000Z",
  expired: false,
};
const collection = (data: unknown[]) => ({
  apiVersion: "v1",
  data,
  page: { hasMore: false },
});
const envelope = (data: unknown) => ({ apiVersion: "v1", data });
function fixture() {
  let record = structuredClone(initial);
  const controls = {
    loseNextResponse: false,
    missingAcknowledgement: false,
    foreignConnection: false,
    foreignPreview: false,
    missingArtifact: false,
  };
  const respond = (operation: string) => {
    if (operation === "solution-export-artifacts.get") {
      if (controls.missingArtifact)
        throw Error("Synthetic private upstream detail");
      return envelope({
        archiveFileName: "synthetic.zip",
        contractVersion: 1,
        createdAt: "2026-10-01T12:00:00.000Z",
        digest,
        manifestDigest: digest,
        downloadAvailability: {
          state: "available",
          expiresAt: "2099-10-01T12:15:00.000Z",
        },
        id: artifactId,
        projectId,
        jobId: "solutionexport_gitlab",
        solutionRevisionId: "solution_gitlab_v1",
        fileCount: 1,
        files: [
          {
            checksum: digest,
            id: "solutionfile_gitlab",
            mediaType: "application/vnd.hashicorp.terraform",
            ownership: "generated-replaceable",
            path: "main.tf",
            previewAvailable: true,
            semanticChecksum: digest,
            sizeBytes: 20,
          },
        ],
        sizeBytes: 200,
        warnings: [],
      });
    }
    if (operation === "gitlab-connections.list")
      return collection([
        {
          contractVersion: 1,
          id: connectionId,
          organizationId: controls.foreignConnection
            ? "org_other"
            : organizationId,
          principalId,
          providerUsername: "synthetic-owner",
          status: "active",
          providerRevocation: "not-requested",
        },
      ]);
    if (operation === "gitlab-project-selections.list")
      return collection([
        {
          contractVersion: 1,
          organizationId,
          principalId,
          connectionId,
          projectId: 42,
          version: 7,
          enabled: true,
        },
      ]);
    if (operation === "gitlab-projects.discover")
      return envelope({
        contractVersion: 1,
        organizationId,
        principalId,
        connectionId,
        projects: [
          {
            projectId: 42,
            pathWithNamespace: "synthetic/application",
            defaultBranch: "main",
            eligibility: "eligible",
            url: "https://gitlab.com/synthetic/application",
          },
        ],
        nextPage: null,
      });
    if (operation === "gitlab-export-reviews.create")
      return envelope({
        export: {
          ...record,
          principalId: controls.foreignPreview
            ? "principal_other"
            : principalId,
        },
        files: [
          {
            path: "cloudmarkup/export/main.tf",
            sizeBytes: 20,
            sha256: digest,
            mode: "100644",
          },
        ],
      });
    if (operation === "gitlab-exports.get")
      return envelope(structuredClone(record));
    if (operation === "gitlab-exports.advance") {
      if (controls.missingAcknowledgement)
        return envelope(structuredClone(record));
      const states = [
        "prepared",
        "commit-dispatched",
        "verifying",
        "verified",
        "merge-request-dispatched",
        "succeeded",
      ] as const;
      const next = states[states.indexOf(record.state) + 1] ?? "succeeded";
      record = {
        ...record,
        state: next,
        recordVersion: record.recordVersion + 1,
        commitSha: next === "commit-dispatched" ? null : commit,
        verifiedFiles: [
          "verified",
          "merge-request-dispatched",
          "succeeded",
        ].includes(next)
          ? 1
          : 0,
        mergeRequest:
          next === "succeeded"
            ? {
                number: 17,
                sha: commit,
                state: "opened",
                draft: true,
                url: "https://gitlab.com/synthetic/application/-/merge_requests/17",
              }
            : null,
      };
      if (controls.loseNextResponse) {
        controls.loseNextResponse = false;
        throw Error("Synthetic unknown provider acknowledgement");
      }
      return envelope(structuredClone(record));
    }
    throw Error("Unexpected synthetic operation " + operation);
  };
  const request = vi.fn<
    (operation: string, input?: unknown) => Promise<unknown>
  >((operation) => Promise.resolve().then(() => respond(operation)));
  return {
    request,
    respond,
    controls,
    setRecord: (value: GitlabExportV1) => {
      record = value;
    },
  };
}
function mount(
  f: ReturnType<typeof fixture>,
  options: {
    readonly resume?: string;
    readonly identity?: CurrentPrincipalV1;
  } = {},
) {
  window.history.replaceState(
    null,
    "",
    route + (options.resume ? "?review=" + options.resume : ""),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <StrictMode>
      <CloudMarkupQueryProvider
        client={{ request: f.request } as unknown as CloudMarkupClient}
        queryClient={queryClient}
      >
        <RouterProvider>
          <GitLabExportPage
            organizationId={organizationId}
            principal={options.identity ?? principal}
            projectId={projectId}
            artifactId={artifactId}
          />
        </RouterProvider>
      </CloudMarkupQueryProvider>
    </StrictMode>,
  );
  return { ...view, queryClient };
}
async function review() {
  await screen.findByRole("option", { name: "synthetic-owner" });
  fireEvent.change(screen.getByLabelText("GitLab account"), {
    target: { value: connectionId },
  });
  await screen.findByRole("option", { name: "synthetic/application" });
  fireEvent.change(screen.getByLabelText("GitLab project"), {
    target: { value: "42" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review export" }));
  await screen.findByRole("checkbox", { name: /I approve these files/u });
}
async function approve() {
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I approve these files/u }),
  );
  const button = screen.getByRole("button", { name: "Approve and export" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
const calls = (f: ReturnType<typeof fixture>, operation: string) =>
  f.request.mock.calls.filter(([name]) => name === operation);
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
describe("GitLab reviewed export page", () => {
  it("reviews the selected project/version and requires approval before automatically completing bounded steps", async () => {
    const f = fixture();
    mount(f);
    await review();
    expect(screen.getByText("cloudmarkup/export/main.tf")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Approve and export" }),
    ).toBeDisabled();
    expect(calls(f, "gitlab-exports.advance")).toHaveLength(0);
    expect(calls(f, "gitlab-export-reviews.create")[0]?.[1]).toMatchObject({
      body: { providerProjectId: 42, selectionVersion: 7, artifactId },
    });
    expect(window.location.search).toBe("?review=" + reviewId);
    expect(
      screen.getByRole("link", { name: "Review package" }),
    ).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/projects/${projectId}/exports/solutionexport_gitlab`,
    );
    await approve();
    await screen.findByRole("link", { name: "Open draft merge request #17" });
    expect(calls(f, "gitlab-exports.advance")).toHaveLength(5);
    expect(calls(f, "gitlab-exports.advance")[0]?.[1]).toMatchObject({
      body: {
        acknowledgedAutomation: true,
        expectedVersion: 1,
        approvalDigest: digest,
      },
    });
  });
  it("loads a saved in-progress link through reads and waits for an explicit resume", async () => {
    const f = fixture();
    f.setRecord({
      ...initial,
      state: "verifying",
      recordVersion: 3,
      commitSha: commit,
    });
    mount(f, { resume: reviewId });
    await screen.findByRole("heading", { name: "Verifying exported files" });
    expect(calls(f, "gitlab-exports.advance")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Resume export" }));
    await screen.findByRole("link", { name: "Open draft merge request #17" });
    expect(calls(f, "gitlab-exports.advance")).toHaveLength(3);
  });
  it("performs only a status read after an uncertain write and resumes with its newer durable version", async () => {
    const f = fixture();
    mount(f);
    await review();
    f.controls.loseNextResponse = true;
    await approve();
    await screen.findByRole("heading", { name: "Export needs attention" });
    await screen.findByRole("heading", { name: "Checking the export branch" });
    expect(calls(f, "gitlab-exports.advance")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Resume export" }));
    await screen.findByRole("link", { name: "Open draft merge request #17" });
    expect(calls(f, "gitlab-exports.advance")[1]?.[1]).toMatchObject({
      body: { expectedVersion: 2 },
    });
  });
  it("stops when read-only recovery has not found an acknowledgement", async () => {
    const f = fixture();
    f.setRecord({ ...initial, state: "commit-dispatched", recordVersion: 2 });
    f.controls.missingAcknowledgement = true;
    mount(f, { resume: reviewId });
    await screen.findByRole("heading", { name: "Checking the export branch" });
    fireEvent.click(screen.getByRole("button", { name: "Resume export" }));
    await screen.findByText(/provider has not confirmed the earlier write/u);
    expect(calls(f, "gitlab-exports.advance")).toHaveLength(1);
  });
  it("cannot approve a prepared review restored without its file preview", async () => {
    const f = fixture();
    mount(f, { resume: reviewId });
    await screen.findByText(/Start a new review to inspect its files/u);
    expect(
      screen.getByRole("button", { name: "Approve and export" }),
    ).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it.each(["prepared", "verified"] as const)(
    "disables a new write for expired %s approval",
    async (state) => {
      const f = fixture();
      f.setRecord({
        ...initial,
        state,
        expired: true,
        commitSha: state === "verified" ? commit : null,
        verifiedFiles: state === "verified" ? 1 : 0,
      });
      mount(f, { resume: reviewId });
      await screen.findByText(/This approval expired/u);
      expect(
        screen.getByRole("button", {
          name: state === "prepared" ? "Approve and export" : "Resume export",
        }),
      ).toBeDisabled();
      expect(calls(f, "gitlab-exports.advance")).toHaveLength(0);
    },
  );
  it("rejects a foreign connection without displaying its name", async () => {
    const f = fixture();
    f.controls.foreignConnection = true;
    mount(f);
    await screen.findByRole("heading", { name: "Connections unavailable" });
    expect(
      screen.queryByRole("option", { name: "synthetic-owner" }),
    ).not.toBeInTheDocument();
  });
  it("rejects a foreign artifact preview before any approval or write", async () => {
    const f = fixture();
    f.controls.foreignPreview = true;
    mount(f);
    await screen.findByRole("option", { name: "synthetic-owner" });
    fireEvent.change(screen.getByLabelText("GitLab account"), {
      target: { value: connectionId },
    });
    await screen.findByRole("option", { name: "synthetic/application" });
    fireEvent.change(screen.getByLabelText("GitLab project"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review export" }));
    await screen.findByRole("heading", { name: "Review unavailable" });
    expect(calls(f, "gitlab-exports.advance")).toHaveLength(0);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("does not call any API without export permission", () => {
    const f = fixture();
    mount(f, {
      identity: {
        ...principal,
        organizationContexts: principal.organizationContexts.map((item) => ({
          ...item,
          capabilities: ["integrations.read"],
        })),
      },
    });
    expect(
      screen.getByRole("heading", { name: "GitLab export unavailable" }),
    ).toBeVisible();
    expect(f.request).not.toHaveBeenCalled();
  });
  it("hides untrusted backend detail when the source package is unavailable", async () => {
    const f = fixture();
    f.controls.missingArtifact = true;
    mount(f);
    await screen.findByRole("heading", { name: "Package unavailable" });
    expect(screen.queryByText(/private upstream/u)).not.toBeInTheDocument();
    expect(calls(f, "gitlab-export-reviews.create")).toHaveLength(0);
  });
  it("rejects malformed saved review selectors without querying their status", async () => {
    const f = fixture();
    mount(f, { resume: "untrusted-review" });
    await screen.findByRole("heading", { name: "Invalid export link" });
    expect(calls(f, "gitlab-exports.get")).toHaveLength(0);
  });
  it("stops requesting further steps after the user leaves during an in-flight request", async () => {
    const f = fixture();
    const view = mount(f);
    await review();
    let finish: ((value: unknown) => void) | undefined;
    f.request.mockImplementation((operation) =>
      operation === "gitlab-exports.advance"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve().then(() => f.respond(operation)),
    );
    await approve();
    await waitFor(() => {
      expect(finish).toBeDefined();
    });
    view.unmount();
    await act(async () => {
      finish?.(
        envelope({ ...initial, state: "commit-dispatched", recordVersion: 2 }),
      );
      await Promise.resolve();
    });
    expect(calls(f, "gitlab-exports.advance")).toHaveLength(1);
  });
});
