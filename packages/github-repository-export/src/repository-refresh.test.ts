import type { Sha256Digest } from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  gitHubInstallationRecordSchema,
  gitHubRepositoryRecordSchema,
} from "./contracts.js";
import {
  InMemoryGitHubExportStore,
  FakeGitHubRepositoryImportStore,
} from "./fakes.js";
import { repositoryImportIdempotencyDigest } from "./repository-import.js";
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
  return { importRepository, service, store, history };
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
  it.each([
    "later-subscription-failure",
    "lost-import-acknowledgement",
  ] as const)(
    "replays persisted import identities after %s without repeating completed work",
    async (failure) => {
      const value = await setup();
      const imports = new FakeGitHubRepositoryImportStore();
      const completedProjects: string[] = [];
      let next = 0;
      let injected = false;
      const retain = (record: StoredGitHubRepositoryImport) => {
        const index = value.history.findIndex(
          ({ importId }) => importId === record.importId,
        );
        if (index < 0) value.history.push(record);
        else value.history[index] = record;
      };
      value.importRepository.mockImplementation(async (input) => {
        const attemptId = `attempt.${String(++next)}`;
        const claim = await imports.reserveImport({
          attemptId,
          record: {
            ...storedImport(input),
            importId: `import.${String(next)}`,
            snapshotId: `snapshot.${String(next)}`,
            idempotencyDigest: repositoryImportIdempotencyDigest(input),
            createdAt: "2026-08-25T13:00:00.000Z",
            state: "running",
            recordVersion: 1,
          },
        });
        if (claim.outcome === "terminal") return claim.record;
        if (claim.outcome !== "acquired")
          throw new Error("Import still running");
        if (
          !injected &&
          failure === "later-subscription-failure" &&
          input.projectId === "project.2"
        ) {
          injected = true;
          const failed = {
            ...claim.record,
            state: "failed-transient" as const,
            recordVersion: claim.record.recordVersion + 1,
          };
          expect(await imports.saveImport({ attemptId, record: failed })).toBe(
            "saved",
          );
          retain(failed);
          throw new Error("Synthetic second subscription failure");
        }
        const completed = {
          ...claim.record,
          state: "succeeded" as const,
          recordVersion: claim.record.recordVersion + 1,
        };
        expect(await imports.saveImport({ attemptId, record: completed })).toBe(
          "saved",
        );
        retain(completed);
        completedProjects.push(input.projectId);
        if (!injected && failure === "lost-import-acknowledgement") {
          injected = true;
          throw new Error("Synthetic import acknowledgement lost");
        }
        return completed;
      });
      await value.service.configure(subscription);
      await value.service.configure({
        ...subscription,
        projectId: "project.2",
        idempotencyKey: "refresh-second",
      });
      const push = {
        branch: "main",
        commitSha: NEXT_SHA,
        deliveryId: "delivery.partial",
        forced: false,
        installationId: 77,
        integrationId: "integration.1",
        organizationId: "organization.1",
        repositoryId: 202,
      };
      await expect(value.service.handlePush(push)).rejects.toThrow(
        /Synthetic/u,
      );
      const failedReceipts = structuredClone(value.store.receipts);
      // A newer, intentional manual import must not become the retry baseline.
      for (const projectId of ["project.1", "project.2"]) {
        const baseline = value.history[0];
        if (baseline === undefined) throw new Error("Missing baseline");
        value.history.push({
          ...baseline,
          projectId,
          importId: `manual.${projectId}`,
          createdAt: "2026-08-25T14:00:00.000Z",
        });
      }
      await expect(value.service.handlePush(push)).resolves.toBe("queued");
      await expect(value.service.handlePush(push)).resolves.toBe("queued");
      expect(completedProjects).toEqual(["project.1", "project.2"]);
      for (const projectId of ["project.1", "project.2"]) {
        const calls = value.importRepository.mock.calls
          .map(([input]) => input)
          .filter((input) => input.projectId === projectId);
        expect(calls.length).toBeGreaterThan(1);
        expect(new Set(calls.map(repositoryImportIdempotencyDigest)).size).toBe(
          1,
        );
      }
      expect(value.importRepository.mock.calls[0]?.[0].previousImportId).toBe(
        "githubimport.previous",
      );
      if (failure === "later-subscription-failure")
        expect(
          value.importRepository.mock.calls.find(
            ([input]) => input.projectId === "project.2",
          )?.[0].previousImportId,
        ).toBeUndefined();
      expect(value.store.receipts.slice(0, failedReceipts.length)).toEqual(
        failedReceipts,
      );
    },
  );

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
