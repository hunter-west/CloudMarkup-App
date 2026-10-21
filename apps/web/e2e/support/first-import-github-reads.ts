import {
  githubBranchListResponseV1Schema,
  discoverGithubRepositoryV1Schema,
  githubRepositoryDiscoveryResponseV1Schema,
  githubInstallationListResponseV1Schema,
  githubRepositoryImportListResponseV1Schema,
  githubRepositoryListResponseV1Schema,
} from "@cloudmarkup/api-contract";
import type { BrowserContext } from "@playwright/test";

import {
  TYPED_BACKEND_API_PREFIX,
  TYPED_BACKEND_ORGANIZATION_ID,
} from "./typed-backend-api-harness.js";

export const FIRST_IMPORT_COMMIT_SHA = "a".repeat(40);
const integrationId = "integration_first_import";
const repositoryId = 41;
const now = "2026-08-15T12:00:00.000Z";

/** Read-only synthetic discovery. Revision and mutation authority stays in the
 * existing typed-backend harness; no GitHub or parser execution is simulated. */
export async function installFirstImportGitHubReads(
  context: BrowserContext,
): Promise<void> {
  const installations = githubInstallationListResponseV1Schema.parse({
    apiVersion: "v1",
    data: [
      {
        accountId: 2,
        accountLogin: "synthetic-import",
        accountType: "Organization",
        createdAt: now,
        integrationId,
        installationId: 3,
        organizationId: TYPED_BACKEND_ORGANIZATION_ID,
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
  });
  const repositories = githubRepositoryListResponseV1Schema.parse({
    apiVersion: "v1",
    data: [
      {
        archived: false,
        defaultBranch: "main",
        disabled: false,
        installationId: 3,
        integrationId,
        name: "infrastructure-review",
        nodeId: "R_first_import",
        organizationId: TYPED_BACKEND_ORGANIZATION_ID,
        owner: "synthetic-import",
        private: true,
        pushedAt: now,
        repositoryId,
        updatedAt: now,
      },
    ],
    page: { hasMore: false },
  });
  const branches = githubBranchListResponseV1Schema.parse({
    apiVersion: "v1",
    data: [{ name: "main", protected: true, sha: FIRST_IMPORT_COMMIT_SHA }],
    page: { hasMore: false },
  });
  const history = githubRepositoryImportListResponseV1Schema.parse({
    apiVersion: "v1",
    data: [],
    page: { hasMore: false },
  });
  const installationPath = `/v1/organizations/${TYPED_BACKEND_ORGANIZATION_ID}/github-app-installations`;
  const repositoryPath = `${installationPath}/${integrationId}/repositories`;
  const responses = new Map<string, unknown>([
    [installationPath, installations],
    [repositoryPath, repositories],
    [`${repositoryPath}/${String(repositoryId)}/branches`, branches],
  ]);
  // Playwright routes run newest first. Install after TypedBackendApiHarness and
  // fall back for every mutation and every unrelated query. The metadata POST is read-only.
  await context.route(`**${TYPED_BACKEND_API_PREFIX}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(TYPED_BACKEND_API_PREFIX.length);
    const discoveryPath =
      /^\/v1\/projects\/([^/]+)\/github-repository-discovery$/u.exec(path);
    if (request.method() === "POST" && discoveryPath !== null) {
      const input = discoverGithubRepositoryV1Schema.parse(
        request.postDataJSON(),
      );
      if (
        input.integrationId !== integrationId ||
        input.repositoryId !== repositoryId ||
        input.commitSha !== FIRST_IMPORT_COMMIT_SHA ||
        input.branch !== "main"
      ) {
        await route.fallback();
        return;
      }
      const response = githubRepositoryDiscoveryResponseV1Schema.parse({
        apiVersion: "v1",
        data: {
          contractVersion: 1,
          branch: "main",
          branchHeadSha: FIRST_IMPORT_COMMIT_SHA,
          branchChangedSinceSelection: false,
          commitSha: FIRST_IMPORT_COMMIT_SHA,
          integrationId,
          repositoryId,
          projectId: discoveryPath[1],
          treeSha: "b".repeat(40),
          files: [
            {
              path: "application/index.ts",
              gitBlobSha: "c".repeat(40),
              sizeBytes: 512,
            },
            {
              path: "infrastructure/main.tf",
              gitBlobSha: "d".repeat(40),
              sizeBytes: 256,
            },
          ],
        },
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
      return;
    }
    const response =
      responses.get(path) ??
      (/^\/v1\/projects\/[^/]+\/github-repository-imports$/u.test(path) &&
      url.searchParams.get("repositoryId") === String(repositoryId)
        ? history
        : undefined);
    if (request.method() !== "GET" || response === undefined) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}
