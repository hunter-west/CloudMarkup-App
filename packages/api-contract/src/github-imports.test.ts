import { describe, expect, it } from "vitest";

import {
  createGithubRepositoryImportV1Schema,
  discoverGithubRepositoryV1Schema,
  githubRepositoryDiscoveryV1Schema,
  createGithubRepositoryRefreshSubscriptionV1Schema,
  githubRepositoryImportV1Schema,
  reviewGithubRepositoryImportV1Schema,
} from "./github-imports.js";
import { apiOperationsV1 } from "./operations.js";

const SHA = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;

describe("GitHub repository import API contracts", () => {
  it("requires an exact commit and safe repository-relative import scope", () => {
    const request = {
      branch: "main",
      commitSha: SHA,
      contractVersion: 1,
      ignoredPaths: [".env", "node_modules"],
      integrationId: "integration_github-test",
      repositoryId: 202,
      requestedMode: "professional",
      selectedPaths: ["application", "infrastructure", ".github/workflows"],
    };
    expect(createGithubRepositoryImportV1Schema.parse(request)).toEqual(
      request,
    );
    expect(
      createGithubRepositoryImportV1Schema.safeParse({
        ...request,
        selectedPaths: ["../another-tenant"],
      }).success,
    ).toBe(false);
    expect(
      createGithubRepositoryImportV1Schema.safeParse({
        ...request,
        commitSha: "main",
      }).success,
    ).toBe(false);
  });

  it("exposes only bounded evidence metadata and rejects raw repository content", () => {
    const record = {
      branch: "main",
      branchHeadSha: SHA,
      commitSha: SHA,
      completedAt: "2026-08-25T12:01:00.000Z",
      createdAt: "2026-08-25T12:00:00.000Z",
      fileDifferences: [
        {
          action: "added",
          currentDigest: DIGEST,
          path: "application/index.ts",
        },
      ],
      files: [{ digest: DIGEST, path: "application/index.ts", sizeBytes: 128 }],
      ignoredFiles: [{ path: ".env", reason: "sensitive-path" }],
      ignoredPaths: [".env"],
      importId: "githubimport_contract-test",
      inferenceClaims: [
        {
          category: "connection",
          claimId: "claim.connection",
          confidenceBasisPoints: 7_500,
          evidenceIds: ["evidence.application"],
          observedOnly: true,
          summary: "The handler may write to the imported table.",
        },
      ],
      issues: [
        {
          evidenceIds: ["evidence.application"],
          issueId: "issue.ambiguous",
          lifecycle: "current",
          severity: "warning",
          source: "repository-import-mismatch",
          summary: "Confirm the inferred application relationship.",
        },
      ],
      projectId: "project_contract-test",
      recordVersion: 2,
      repositoryId: 202,
      repositoryName: "customer-repository",
      repositoryOwner: "example-org",
      selectedPaths: ["application"],
      semanticDifferences: [
        {
          digest: DIGEST,
          differenceId: "difference.connection",
          evidenceIds: ["evidence.application"],
          kind: "connection-mismatch",
          observedFactIds: ["fact.application.connection"],
          operationId: "operation.keep",
          operationKind: "keep-observed-only",
          severity: "warning",
          summary: "The observed relationship is not approved.",
        },
      ],
      snapshotDigest: DIGEST,
      snapshotId: "repository_snapshot_contract_test",
      sourceEvidence: [
        {
          confidence: "unresolved",
          evidenceId: "evidence.application",
          fileDigest: DIGEST,
          path: "application/index.ts",
          startLine: 4,
        },
      ],
      state: "succeeded",
      trigger: "manual",
      updatedAt: "2026-08-25T12:01:00.000Z",
    };
    expect(githubRepositoryImportV1Schema.parse(record)).toEqual(record);
    expect(
      githubRepositoryImportV1Schema.safeParse({
        ...record,
        rawRepositoryContent: "private source",
      }).success,
    ).toBe(false);
  });

  it("requires a reason for ignore, allow-lists push refresh, and registers all routes", () => {
    expect(
      reviewGithubRepositoryImportV1Schema.safeParse({
        contractVersion: 1,
        decision: "ignore",
        expectedSnapshotDigest: DIGEST,
        operationId: "operation.1",
      }).success,
    ).toBe(false);
    expect(
      createGithubRepositoryRefreshSubscriptionV1Schema.safeParse({
        branch: "main",
        contractVersion: 1,
        enabled: true,
        events: ["pull_request"],
        ignoredPaths: [],
        integrationId: "integration_github-test",
        repositoryId: 202,
        selectedPaths: ["."],
      }).success,
    ).toBe(false);
    expect(apiOperationsV1["github-repository-imports.create"]).toMatchObject({
      method: "POST",
      security: "principal",
      successStatus: 201,
    });
    expect(apiOperationsV1["github-repository-imports.list"].method).toBe(
      "GET",
    );
    expect(
      apiOperationsV1["github-repository-import-reviews.create"].method,
    ).toBe("POST");
    expect(
      apiOperationsV1["github-repository-refresh-subscriptions.create"].method,
    ).toBe("POST");
  });
});

describe("read-only repository discovery contracts", () => {
  const request = {
    contractVersion: 1,
    branch: "main",
    commitSha: SHA,
    ignoredPaths: [],
    integrationId: "integration_discovery",
    repositoryId: 42,
    selectedPaths: ["."],
  };
  const response = {
    contractVersion: 1,
    branch: "main",
    commitSha: SHA,
    branchHeadSha: SHA,
    branchChangedSinceSelection: false,
    treeSha: "b".repeat(40),
    integrationId: "integration_discovery",
    projectId: "project_discovery",
    repositoryId: 42,
    files: [{ path: "main.tf", gitBlobSha: "c".repeat(40), sizeBytes: 0 }],
  };
  it("admits bounded metadata and exposes a strict typed read operation", () => {
    expect(discoverGithubRepositoryV1Schema.parse(request)).toEqual(request);
    expect(githubRepositoryDiscoveryV1Schema.parse(response)).toEqual(response);
    expect(apiOperationsV1["github-repository-discovery.read"]).toMatchObject({
      method: "POST",
      security: "principal",
      successStatus: 200,
    });
  });
  it.each([
    { ...request, organizationId: "org_other" },
    { ...request, contractVersion: 2 },
    { ...request, selectedPaths: Array.from({ length: 129 }, () => "main.tf") },
    { ...request, selectedPaths: ["C:/private"] },
  ])("rejects invalid selection or tenant injection %j", (value) => {
    expect(discoverGithubRepositoryV1Schema.safeParse(value).success).toBe(
      false,
    );
  });
  it.each([
    { ...response, branchChangedSinceSelection: true },
    { ...response, files: [response.files[0], response.files[0]] },
    { ...response, files: [{ ...response.files[0], sizeBytes: undefined }] },
    { ...response, files: [{ ...response.files[0], bytes: "private source" }] },
    {
      ...response,
      files: Array.from({ length: 17 }, (_, i) => ({
        path: String(i) + ".tf",
        gitBlobSha: "c".repeat(40),
        sizeBytes: 8 * 1024 * 1024,
      })),
    },
  ])(
    "rejects inconsistent, duplicated, content-bearing, or oversized inventories",
    (value) => {
      expect(githubRepositoryDiscoveryV1Schema.safeParse(value).success).toBe(
        false,
      );
    },
  );
});
