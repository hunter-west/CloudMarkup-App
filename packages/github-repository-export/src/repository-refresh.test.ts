import type { Sha256Digest } from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  gitHubInstallationRecordSchema,
  gitHubRepositoryRecordSchema,
} from "./contracts.js";
import { InMemoryGitHubExportStore } from "./fakes.js";
import type {
  GitHubRepositoryImportInput,
  GitHubRepositoryImportService,
  StoredGitHubRepositoryImport,
} from "./repository-import.js";
import {
  createGitHubRepositoryRefreshService,
  InMemoryGitHubRepositoryRefreshStore,
} from "./repository-refresh.js";

const SHA = "a".repeat(40);
const NEXT_SHA = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}` as Sha256Digest;
const AT = new Date("2026-08-25T12:00:00.000Z");

function storedImport(
  input: GitHubRepositoryImportInput,
): StoredGitHubRepositoryImport {
  return {
    branch: input.branch,
    branchHeadSha: input.commitSha,
    commitSha: input.commitSha,
    completedAt: AT.toISOString(),
    createdAt: AT.toISOString(),
    createdByPrincipalId: input.principalId,
    idempotencyDigest: DIGEST,
    ignoredPaths: [...input.ignoredPaths],
    importId: "githubimport.refresh-test",
    integrationId: input.integrationId,
    organizationId: input.organizationId,
    ...(input.previousImportId === undefined
      ? {}
      : { previousImportId: input.previousImportId }),
    projectId: input.projectId,
    recordVersion: 2,
    repositoryId: input.repositoryId,
    repositoryName: "customer-repository",
    repositoryOwner: "example-org",
    selectedPaths: [...input.selectedPaths],
    snapshotDigest: DIGEST,
    snapshotId: "repository_snapshot_refresh_test",
    state: "succeeded",
    trigger: input.trigger,
    updatedAt: AT.toISOString(),
  };
}

async function setup() {
  const directory = new InMemoryGitHubExportStore();
  await directory.saveInstallation(
    gitHubInstallationRecordSchema.parse({
      accountId: 500,
      accountLogin: "example-org",
      accountType: "Organization",
      createdAt: AT.toISOString(),
      installationId: 77,
      integrationId: "integration.1",
      organizationId: "organization.1",
      permissions: {
        contents: "read",
        metadata: "read",
        pullRequests: "none",
        workflows: "none",
      },
      repositorySelection: "selected",
      status: "connected",
      updatedAt: AT.toISOString(),
    }),
  );
  await directory.saveRepositories({
    installationId: 77,
    integrationId: "integration.1",
    organizationId: "organization.1",
    repositories: [
      gitHubRepositoryRecordSchema.parse({
        archived: false,
        defaultBranch: "main",
        disabled: false,
        installationId: 77,
        integrationId: "integration.1",
        name: "customer-repository",
        nodeId: "R_repo",
        organizationId: "organization.1",
        owner: "example-org",
        private: true,
        pushedAt: AT.toISOString(),
        repositoryId: 202,
        updatedAt: AT.toISOString(),
      }),
    ],
  });
  const history: StoredGitHubRepositoryImport[] = [
    {
      ...storedImport({
        branch: "main",
        commitSha: SHA,
        correlationId: "correlation.previous",
        idempotencyKey: "previous",
        ignoredPaths: [],
        integrationId: "integration.1",
        organizationId: "organization.1",
        principalId: "principal.1",
        projectId: "project.1",
        repositoryId: 202,
        requestedMode: "professional",
        selectedPaths: ["."],
        trigger: "manual",
      }),
      importId: "githubimport.previous",
    },
  ];
  const importRepository = vi.fn((input: GitHubRepositoryImportInput) => {
    const record = storedImport(input);
    history.push(record);
    return Promise.resolve(record);
  });
  const imports: GitHubRepositoryImportService = {
    discoverRepository: () =>
      Promise.reject(new Error("discovery is not used by refresh")),
    importRepository,
    listImports: ({ projectId }) =>
      Promise.resolve(
        history.filter((record) => record.projectId === projectId),
      ),
    review: () => Promise.reject(new Error("review is not used by refresh")),
  };
  const store = new InMemoryGitHubRepositoryRefreshStore();
  let nextId = 0;
  const service = createGitHubRepositoryRefreshService({
    clock: () => new Date(AT),
    directory,
    id: () => `subscription-${String(++nextId)}`,
    imports,
    store,
  });
  return { importRepository, service, store };
}

const subscription = {
  branch: "main",
  enabled: true,
  idempotencyKey: "refresh-enabled",
  ignoredPaths: [".env"],
  integrationId: "integration.1",
  organizationId: "organization.1",
  principalId: "principal.1",
  projectId: "project.1",
  repositoryId: 202,
  selectedPaths: ["application", "infrastructure"],
} as const;

describe("GitHub repository push refresh", () => {
  it("imports the exact push commit as immutable history linked to the previous snapshot", async () => {
    const value = await setup();
    const configured = await value.service.configure(subscription);
    await expect(
      value.service.handlePush({
        branch: "main",
        commitSha: NEXT_SHA,
        deliveryId: "delivery.refresh.1",
        forced: false,
        installationId: 77,
        integrationId: "integration.1",
        organizationId: "organization.1",
        repositoryId: 202,
      }),
    ).resolves.toBe("queued");
    expect(value.importRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        commitSha: NEXT_SHA,
        previousImportId: "githubimport.previous",
        trigger: "webhook",
      }),
    );
    expect(value.store.receipts).toEqual([
      expect.objectContaining({
        commitSha: NEXT_SHA,
        state: "processed",
        subscriptionId: configured.subscriptionId,
      }),
    ]);
  });

  it("treats subscription configuration as immutable history and lets the latest record disable refresh", async () => {
    const value = await setup();
    const first = await value.service.configure(subscription);
    await expect(value.service.configure(subscription)).resolves.toEqual(first);
    await value.service.configure({
      ...subscription,
      enabled: false,
      idempotencyKey: "refresh-disabled",
    });
    await expect(
      value.service.handlePush({
        branch: "main",
        commitSha: NEXT_SHA,
        deliveryId: "delivery.refresh.disabled",
        forced: false,
        installationId: 77,
        integrationId: "integration.1",
        organizationId: "organization.1",
        repositoryId: 202,
      }),
    ).resolves.toBe("ignored");
    expect(value.importRepository).not.toHaveBeenCalled();
  });

  it("rejects traversal scopes before recording a subscription", async () => {
    const value = await setup();
    await expect(
      value.service.configure({
        ...subscription,
        selectedPaths: ["../private"],
      }),
    ).rejects.toMatchObject({ code: "import-blocked" });
  });
});
