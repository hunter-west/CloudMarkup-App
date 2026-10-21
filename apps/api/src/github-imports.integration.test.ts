import type {
  GithubRepositoryImportV1,
  GithubRepositoryReconciliationReviewV1,
  GithubRepositoryRefreshSubscriptionV1,
} from "@cloudmarkup/api-contract";
import { describe, expect, it, vi } from "vitest";

import type { GitHubRepositoryImportApplication } from "./application/github-imports.js";
import { createApp } from "./app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "./testing/in-memory-adapters.js";

const token = "Bearer github-import-test";
const at = "2026-08-25T12:00:00.000Z";
const sha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;

const record: GithubRepositoryImportV1 = {
  branch: "main",
  branchHeadSha: sha,
  commitSha: sha,
  completedAt: at,
  createdAt: at,
  fileDifferences: [
    { action: "added", currentDigest: digest, path: "application/index.ts" },
  ],
  files: [{ digest, path: "application/index.ts", sizeBytes: 128 }],
  ignoredFiles: [{ path: ".env", reason: "sensitive-path" }],
  ignoredPaths: [".env"],
  importId: "githubimport_api-test",
  inferenceClaims: [],
  issues: [],
  projectId: "project_test",
  recordVersion: 2,
  repositoryId: 42,
  repositoryName: "customer-repository",
  repositoryOwner: "cloudmarkup",
  selectedPaths: ["application"],
  semanticDifferences: [],
  snapshotDigest: digest,
  snapshotId: "repository_snapshot_api_test",
  sourceEvidence: [],
  state: "succeeded",
  trigger: "manual",
  updatedAt: at,
};

const discoveryInput = {
  branch: "main",
  commitSha: sha,
  contractVersion: 1 as const,
  ignoredPaths: [".env"],
  integrationId: "integration_test",
  repositoryId: 42,
  selectedPaths: ["."],
};
function fixture() {
  const discoverRepository = vi.fn<
    GitHubRepositoryImportApplication["discoverRepository"]
  >((_principal, projectId, input) =>
    Promise.resolve({
      contractVersion: 1,
      branch: input.branch,
      commitSha: input.commitSha,
      branchHeadSha: sha,
      branchChangedSinceSelection: input.commitSha !== sha,
      treeSha: "b".repeat(40),
      integrationId: input.integrationId,
      repositoryId: input.repositoryId,
      projectId,
      files: [{ path: "main.tf", gitBlobSha: "c".repeat(40), sizeBytes: 100 }],
    }),
  );
  const createImport = vi.fn<GitHubRepositoryImportApplication["createImport"]>(
    () => Promise.resolve(record),
  );
  const listImports = vi.fn<GitHubRepositoryImportApplication["listImports"]>(
    () => Promise.resolve([record]),
  );
  const review = vi.fn<GitHubRepositoryImportApplication["review"]>(() =>
    Promise.resolve({
      decision: "keep-observed",
      designChanged: false,
      importId: record.importId,
      operationId: "operation.1",
      receiptId: "review.1",
      reviewedAt: at,
      snapshotDigest: digest,
    } satisfies GithubRepositoryReconciliationReviewV1),
  );
  const configureRefresh = vi.fn<
    GitHubRepositoryImportApplication["configureRefresh"]
  >((_principal, projectId, input) =>
    Promise.resolve({
      branch: input.branch,
      enabled: input.enabled,
      events: ["push"],
      integrationId: input.integrationId,
      projectId,
      repositoryId: input.repositoryId,
      subscriptionId: "githubrefresh_api-test",
      updatedAt: at,
    } satisfies GithubRepositoryRefreshSubscriptionV1),
  );
  const githubImports: GitHubRepositoryImportApplication = {
    configureRefresh,
    discoverRepository,
    createImport,
    listImports,
    review,
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(at),
    correlationIdFactory: () => "correlation-github-import",
    githubImports,
    principalResolver: new FixedPrincipalResolver({
      [token]: {
        authenticatedAt: at,
        expiresAt: "2026-08-25T13:00:00.000Z",
        principalId: "principal_test",
        sessionId: "session_test",
      },
    }),
  });
  return {
    app,
    configureRefresh,
    createImport,
    discoverRepository,
    listImports,
    review,
  };
}

function authorized(body?: unknown): RequestInit {
  return {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      authorization: token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": "github-import-idempotency-1",
    },
    method: body === undefined ? "GET" : "POST",
  };
}

describe("GitHub repository import API", () => {
  it("creates and lists exact-commit snapshots without exposing raw repository bytes", async () => {
    const value = fixture();
    const response = await value.app.request(
      "/v1/projects/project_test/github-repository-imports",
      authorized({
        branch: "main",
        commitSha: sha,
        contractVersion: 1,
        ignoredPaths: [".env"],
        integrationId: "integration_github-test",
        repositoryId: 42,
        requestedMode: "professional",
        selectedPaths: ["application"],
      }),
    );
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain("private source");
    expect(text).not.toMatch(/installation.?token/iu);
    expect(JSON.parse(text)).toMatchObject({ data: { commitSha: sha } });
    expect(value.createImport).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: "principal_test" }),
      "project_test",
      expect.objectContaining({ commitSha: sha, repositoryId: 42 }),
      "github-import-idempotency-1",
    );

    const listed = await value.app.request(
      "/v1/projects/project_test/github-repository-imports?repositoryId=42",
      authorized(),
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      data: [{ importId: record.importId }],
    });
    expect(value.listImports).toHaveBeenCalledWith(
      expect.anything(),
      "project_test",
      42,
    );
  });

  it("records reviewed keep-observed intent and push-only refresh configuration", async () => {
    const value = fixture();
    const reviewResponse = await value.app.request(
      `/v1/projects/project_test/github-repository-imports/${record.importId}/reviews`,
      authorized({
        contractVersion: 1,
        decision: "keep-observed",
        expectedSnapshotDigest: digest,
        operationId: "operation.1",
      }),
    );
    expect(reviewResponse.status).toBe(201);
    expect(value.review).toHaveBeenCalled();

    const refreshResponse = await value.app.request(
      "/v1/projects/project_test/github-repository-import-refresh-subscriptions",
      authorized({
        branch: "main",
        contractVersion: 1,
        enabled: true,
        events: ["push"],
        ignoredPaths: [".env"],
        integrationId: "integration_github-test",
        repositoryId: 42,
        selectedPaths: ["application"],
      }),
    );
    expect(refreshResponse.status).toBe(201);
    expect(value.configureRefresh).toHaveBeenCalledWith(
      expect.anything(),
      "project_test",
      expect.objectContaining({ events: ["push"] }),
      "github-import-idempotency-1",
    );
  });

  it("requires authentication and idempotency before invoking mutations", async () => {
    const value = fixture();
    const unauthenticated = await value.app.request(
      "/v1/projects/project_test/github-repository-imports",
      { method: "GET" },
    );
    expect(unauthenticated.status).toBe(401);
    const missingKey = await value.app.request(
      "/v1/projects/project_test/github-repository-imports",
      {
        body: JSON.stringify({
          branch: "main",
          commitSha: sha,
          contractVersion: 1,
          ignoredPaths: [],
          integrationId: "integration_github-test",
          repositoryId: 42,
          requestedMode: "guided",
          selectedPaths: ["."],
        }),
        headers: { authorization: token, "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(missingKey.status).toBe(400);
    expect(value.createImport).not.toHaveBeenCalled();
  });
});

describe("repository file discovery transport", () => {
  it("returns a strict metadata envelope for an authenticated project without importing", async () => {
    const value = fixture();
    const response = await value.app.request(
      "/v1/projects/project_test/github-repository-discovery",
      authorized(discoveryInput),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        projectId: "project_test",
        files: [{ path: "main.tf", sizeBytes: 100 }],
      },
    });
    expect(value.discoverRepository).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: "principal_test" }),
      "project_test",
      discoveryInput,
    );
    expect(value.createImport).not.toHaveBeenCalled();
  });
  it("requires authentication before reading repository metadata", async () => {
    const value = fixture();
    const response = await value.app.request(
      "/v1/projects/project_test/github-repository-discovery",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(discoveryInput),
      },
    );
    expect(response.status).toBe(401);
    expect(value.discoverRepository).not.toHaveBeenCalled();
  });
  it.each([
    { organizationId: "org_foreign" },
    { contractVersion: 2 },
    { selectedPaths: ["../private"] },
    { commitSha: "main" },
  ])("rejects malformed or caller-supplied authority %j", async (patch) => {
    const value = fixture();
    const response = await value.app.request(
      "/v1/projects/project_test/github-repository-discovery",
      authorized({ ...discoveryInput, ...patch }),
    );
    expect(response.status).toBe(400);
    expect(value.discoverRepository).not.toHaveBeenCalled();
  });
});
