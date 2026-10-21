import { afterEach, describe, expect, it, vi } from "vitest";
import { retainedArtifactFixture } from "./adapters/persistence/solution-export-artifact-test-helpers.js";
import { GitLabConnectionAuthority } from "./adapters/persistence/gitlab-connection-authority.js";
import { PostgresGitLabProjectSelections } from "./adapters/persistence/gitlab-project-selections.js";
import { PostgresGitLabExportReviews } from "./adapters/persistence/gitlab-export-reviews.js";
import { PostgresApprovedSolutionPackageRepository } from "./adapters/persistence/solution-export-approved-package-repository.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import type { ObjectStore } from "./application/persistence.js";
import type { PrincipalContext } from "./application/ports.js";
import { ApplicationError } from "./application/errors.js";
import {
  gitLabExportApprovalDigest,
  type GitLabExportRecord,
} from "./application/gitlab-export-state.js";
import { createProductionGitLabExportWorkflow } from "./production-gitlab-exports.js";
const actor: PrincipalContext = {
  principalId: "principal_synthetic",
  sessionId: "family_synthetic",
  authenticationSource: "cognito",
  authenticatedAt: "2026-10-01T12:00:00.000Z",
  expiresAt: "2026-10-01T13:00:00.000Z",
  correlationId: "correlation.synthetic",
};
const organizationId = "org_synthetic",
  projectId = "project_synthetic",
  connectionId = "gitlab_" + "a".repeat(32),
  baseSha = "b".repeat(40);
function fixture() {
  const controls = { deny: "", afterClaim: "" };
  const check = (kind: string) => {
    if (controls.deny === kind)
      throw new ApplicationError(
        "access_denied",
        "Synthetic current authority denied.",
      );
  };
  const current = vi
    .spyOn(GitLabConnectionAuthority.prototype, "assertCurrent")
    .mockImplementation(() => {
      check("session");
      return Promise.resolve();
    });
  const selected = vi
    .spyOn(PostgresGitLabProjectSelections.prototype, "assertSelected")
    .mockImplementation(() => {
      check("selection");
      return Promise.resolve();
    });
  const project = vi
    .spyOn(
      PostgresApprovedSolutionPackageRepository.prototype,
      "withAuthorizedProject",
    )
    .mockImplementation(async (_scope, work) => {
      check("project");
      return work({} as never, {} as never);
    });
  const available = vi
    .spyOn(
      PostgresApprovedSolutionPackageRepository.prototype,
      "assertAvailable",
    )
    .mockImplementation(() => {
      check("artifact");
      return Promise.resolve();
    });
  const artifact = retainedArtifactFixture();
  const readArtifact = vi
    .spyOn(
      PostgresApprovedSolutionPackageRepository.prototype,
      "getApprovedPackage",
    )
    .mockResolvedValue({
      artifact,
      artifactId: "solutionartifact_synthetic",
      organizationId,
      projectId,
    });
  let record: GitLabExportRecord | undefined;
  function required() {
    if (!record) throw Error("Review missing");
    return record;
  }
  const created = vi
    .spyOn(PostgresGitLabExportReviews.prototype, "create")
    .mockImplementation((descriptor) => {
      record = {
        descriptor,
        approvalDigest: gitLabExportApprovalDigest(descriptor),
        state: "prepared",
        recordVersion: 1,
        verifiedFiles: 0,
        commitSha: null,
        mergeRequest: null,
        expiresAt: "2026-10-01T12:15:00.000Z",
        expired: false,
      };
      return Promise.resolve(structuredClone(record));
    });
  vi.spyOn(PostgresGitLabExportReviews.prototype, "get").mockImplementation(
    () => Promise.resolve(structuredClone(required())),
  );
  const claim = vi
    .spyOn(PostgresGitLabExportReviews.prototype, "claimCommit")
    .mockImplementation(() => {
      record = { ...required(), state: "commit-dispatched", recordVersion: 2 };
      controls.deny = controls.afterClaim;
      return Promise.resolve(structuredClone(record));
    });
  const entitlement = vi.fn(() => {
    check("entitlement");
    return Promise.resolve();
  });
  const grant = vi.fn(() => {
    check("grant");
    return Promise.resolve();
  });
  const tokenScopes = vi.fn();
  const token = Buffer.from("synthetic-server-token-material-1234567890");
  const fetcher = vi.fn<typeof globalThis.fetch>((input, options) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (options?.method === "POST")
      throw Error("No provider write expected in this composition fixture");
    const data = url.endsWith("/projects/42")
      ? {
          id: 42,
          path_with_namespace: "synthetic/project",
          default_branch: "main",
          archived: false,
          empty_repo: false,
          permissions: {
            project_access: { access_level: 30 },
            group_access: null,
          },
        }
      : url.includes("/branches/main")
        ? { name: "main", protected: true, commit: { id: baseSha } }
        : url.includes("/repository/tree?")
          ? []
          : null;
    if (data === null) throw Error("Unexpected synthetic GitLab path");
    return Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json", "x-next-page": "" },
      }),
    );
  });
  const resolveOrganization = vi.fn(() =>
    Promise.resolve<string | null>(organizationId),
  );
  const workflowFor = createProductionGitLabExportWorkflow({
    database: {} as SqlDatabase,
    objectStore: {} as ObjectStore,
    applicationId: "c".repeat(64),
    clock: () => new Date("2026-10-01T12:00:00.000Z"),
    organizationForProject: resolveOrganization,
    entitlements: { authorize: entitlement },
    fetch: fetcher,
    connections: {
      withAccess: async (_actor, organization, connection, work) => {
        tokenScopes(organization, connection);
        try {
          return await work({
            accessToken: token,
            grantVersion: 7,
            assertCurrentAdmission: grant,
          });
        } finally {
          /* The real connection scope owns its original token. Each HTTP adapter must clear only its copy. */
        }
      },
    },
  });
  const destination = {
    connectionId,
    providerProjectId: 42,
    selectionVersion: 3,
    artifactId: "solutionartifact_synthetic",
    destinationFolder: "exports/synthetic",
  };
  return {
    workflowFor,
    destination,
    controls,
    current,
    selected,
    project,
    available,
    readArtifact,
    created,
    claim,
    entitlement,
    grant,
    tokenScopes,
    token,
    fetcher,
    resolveOrganization,
    required,
  };
}
afterEach(() => vi.restoreAllMocks());
describe("production GitLab export composition", () => {
  it("binds canonical scope and rechecks current authority around every fixed-host provider request", async () => {
    const f = fixture();
    const workflow = await f.workflowFor(actor, projectId);
    const preview = await workflow.preview(f.destination);
    expect(preview.record.descriptor).toMatchObject({
      organizationId,
      projectId,
      principalId: actor.principalId,
      connectionId,
      selectionVersion: 3,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    expect(f.entitlement.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(f.selected).toHaveBeenCalledWith(connectionId, 42, 3);
    expect(f.available).toHaveBeenCalledWith(
      { organizationId, projectId, artifactId: "solutionartifact_synthetic" },
      preview.record.descriptor.artifactZipDigest,
    );
    expect(f.token.toString()).toBe(
      "synthetic-server-token-material-1234567890",
    );
    expect(
      f.fetcher.mock.calls.every(([url]) =>
        (url instanceof Request ? url.url : url.toString()).startsWith(
          "https://gitlab.com/api/v4/projects/42",
        ),
      ),
    ).toBe(true);
  });
  it("does not accept an unresolved canonical project", async () => {
    const f = fixture();
    f.resolveOrganization.mockResolvedValue(null);
    await expect(f.workflowFor(actor, projectId)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(f.tokenScopes).not.toHaveBeenCalled();
  });
  it.each(["session", "project", "selection", "entitlement", "artifact"])(
    "blocks %s denial before opening provider credentials",
    async (kind) => {
      const f = fixture();
      const workflow = await f.workflowFor(actor, projectId);
      f.controls.deny = kind;
      await expect(workflow.preview(f.destination)).rejects.toMatchObject({
        code: "access_denied",
      });
      expect(f.tokenScopes).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    "session",
    "project",
    "selection",
    "entitlement",
    "artifact",
    "grant",
  ])(
    "blocks a provider POST when %s authority changes after its durable claim",
    async (kind) => {
      const f = fixture();
      const workflow = await f.workflowFor(actor, projectId);
      const { record } = await workflow.preview(f.destination);
      f.controls.afterClaim = kind;
      await expect(
        workflow.advance({
          reviewId: record.descriptor.reviewId,
          expectedVersion: 1,
          approvalDigest: record.approvalDigest,
          acknowledgedAutomation: true,
        }),
      ).rejects.toThrow();
      expect(f.claim).toHaveBeenCalledTimes(1);
      expect(f.required().state).toBe("commit-dispatched");
      expect(
        f.fetcher.mock.calls.some(([, input]) => input?.method === "POST"),
      ).toBe(false);
    },
  );
  it("rejects substituted retained-artifact ownership before opening the provider scope", async () => {
    const f = fixture();
    f.readArtifact.mockResolvedValue({
      artifact: retainedArtifactFixture(),
      artifactId: "solutionartifact_synthetic",
      organizationId: "org_other",
      projectId,
    });
    const workflow = await f.workflowFor(actor, projectId);
    await expect(workflow.preview(f.destination)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(f.tokenScopes).not.toHaveBeenCalled();
  });
  it("applies a whole-step deadline before any provider request", async () => {
    const f = fixture();
    const deadline = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(AbortSignal.abort());
    const workflow = await f.workflowFor(actor, projectId);
    await expect(workflow.preview(f.destination)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(deadline).toHaveBeenCalledWith(20000);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.created).not.toHaveBeenCalled();
  });
});
