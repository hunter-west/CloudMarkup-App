import { describe, expect, it, vi } from "vitest";

import type { GitHubRepositoryExportApplication } from "./application/github-exports.js";
import { createApp } from "./app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "./testing/in-memory-adapters.js";

const token = "Bearer github-export-test";
const now = "2026-08-23T20:00:00.000Z";
const expires = "2026-08-24T20:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}`;
const commitSha = "b".repeat(40);
const linkState = "s".repeat(43);
const callbackReceipt = `callback.receipt.${"r".repeat(32)}`;

function fixture() {
  const execute = vi.fn<GitHubRepositoryExportApplication["execute"]>(
    (_principal, projectId, input) =>
      Promise.resolve({
        branch: "cloudmarkup/export-1",
        commitSha,
        completedAt: now,
        executionId: "githubexport_test",
        organizationId: "org_test",
        previewDigest: input.previewDigest,
        projectId,
        pullRequestNumber: 3,
        pullRequestUrl: "https://github.com/cloudmarkup/export-test/pull/3",
        repositoryId: 42,
      }),
  );
  const githubExports: GitHubRepositoryExportApplication = {
    createPreview: () => Promise.reject(new Error("unused")),
    completeInstallationLink: (_principal, organizationId) =>
      Promise.resolve({
        accountId: 22,
        accountLogin: "cloudmarkup",
        accountType: "Organization",
        createdAt: now,
        installationId: 11,
        integrationId: "integration_test",
        organizationId,
        permissions: {
          contents: "write",
          metadata: "read",
          pullRequests: "write",
          workflows: "none",
        },
        repositorySelection: "selected",
        status: "connected",
        updatedAt: now,
      }),
    createInstallationLinkIntent: () =>
      Promise.resolve({
        expiresAt: "2026-08-23T20:10:00.000Z",
        installationUrl: `https://github.com/apps/cloudmarkup-test/installations/new?state=${linkState}`,
        intentId: "githublink_test",
        state: linkState,
      }),
    discoverBranches: () =>
      Promise.resolve([{ name: "main", protected: true, sha: commitSha }]),
    discoverRepositories: (_principal, organizationId, integrationId) =>
      Promise.resolve([
        {
          archived: false,
          defaultBranch: "main",
          disabled: false,
          installationId: 11,
          integrationId,
          name: "export-test",
          nodeId: "R_test",
          organizationId,
          owner: "cloudmarkup",
          private: true,
          pushedAt: now,
          repositoryId: 42,
          updatedAt: now,
        },
      ]),
    execute,
    listInstallations: (_principal, organizationId) =>
      Promise.resolve([
        {
          accountId: 22,
          accountLogin: "cloudmarkup",
          accountType: "Organization" as const,
          createdAt: now,
          installationId: 11,
          integrationId: "integration_test",
          organizationId,
          permissions: {
            contents: "write" as const,
            metadata: "read" as const,
            pullRequests: "write" as const,
            workflows: "none" as const,
          },
          repositorySelection: "selected" as const,
          status: "connected" as const,
          updatedAt: now,
        },
      ]),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    correlationIdFactory: () => "correlation-github-export",
    githubExports,
    principalResolver: new FixedPrincipalResolver({
      [token]: {
        authenticatedAt: now,
        expiresAt: expires,
        principalId: "principal_test",
        sessionId: "session_test",
      },
    }),
  });
  return { app, execute };
}

function authorizedJson(body: unknown, extraHeaders = {}): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      authorization: token,
      "content-type": "application/json",
      ...extraHeaders,
    },
    method: "POST",
  };
}

describe("GitHub repository export API", () => {
  it("uses a state-bound intent and verified callback receipt while the bare installation-ID route stays absent", async () => {
    const { app } = fixture();
    const intentPath =
      "/v1/organizations/org_test/github-app-installation-link-intents";
    const completionPath =
      "/v1/organizations/org_test/github-app-installation-link-completions";

    const intent = await app.request(
      intentPath,
      authorizedJson({ contractVersion: 1 }),
    );
    const accepted = await app.request(
      completionPath,
      authorizedJson({
        callbackReceipt,
        contractVersion: 1,
        intentId: "githublink_test",
      }),
    );
    const guessed = await app.request(
      "/v1/organizations/org_test/github-app-installations",
      authorizedJson({
        contractVersion: 1,
        installationId: 11,
      }),
    );
    const injected = await app.request(
      completionPath,
      authorizedJson({
        callbackReceipt,
        contractVersion: 1,
        installationId: 11,
        intentId: "githublink_test",
      }),
    );

    expect(intent.status).toBe(201);
    expect(await intent.text()).toContain(
      "https://github.com/apps/cloudmarkup-test/",
    );
    expect(accepted.status).toBe(201);
    expect(await accepted.text()).not.toMatch(/token|secret|privateKey/i);
    expect(guessed.status).toBe(404);
    expect(injected.status).toBe(400);
  });

  it("requires an authenticated principal for both installation-link operations", async () => {
    const { app } = fixture();
    const [intent, completion] = await Promise.all([
      app.request(
        "/v1/organizations/org_test/github-app-installation-link-intents",
        {
          body: JSON.stringify({ contractVersion: 1 }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
      app.request(
        "/v1/organizations/org_test/github-app-installation-link-completions",
        {
          body: JSON.stringify({
            callbackReceipt,
            contractVersion: 1,
            intentId: "githublink_test",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
    ]);

    expect(intent.status).toBe(401);
    expect(completion.status).toBe(401);
  });

  it("lists only linked GitHub App installation metadata", async () => {
    const { app } = fixture();
    const response = await app.request(
      "/v1/organizations/org_test/github-app-installations",
      { headers: { authorization: token } },
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      data: [
        {
          accountLogin: "cloudmarkup",
          integrationId: "integration_test",
          organizationId: "org_test",
        },
      ],
      page: { hasMore: false },
    });
    expect(body).not.toMatch(
      /installationToken|privateKey|webhookSecret|credential/i,
    );
  });

  it("returns discovered repositories and protected base branch metadata", async () => {
    const { app } = fixture();
    const repositories = await app.request(
      "/v1/organizations/org_test/github-app-installations/integration_test/repositories",
      { headers: { authorization: token } },
    );
    const branches = await app.request(
      "/v1/organizations/org_test/github-app-installations/integration_test/repositories/42/branches",
      { headers: { authorization: token } },
    );

    expect(repositories.status).toBe(200);
    expect(await repositories.json()).toMatchObject({
      data: [{ defaultBranch: "main", repositoryId: 42 }],
      page: { hasMore: false },
    });
    expect(branches.status).toBe(200);
    expect(await branches.json()).toMatchObject({
      data: [{ name: "main", protected: true }],
    });
  });

  it("requires an idempotency key and forwards exact workflow confirmations", async () => {
    const { app, execute } = fixture();
    const path = "/v1/projects/project_test/github-repository-exports";
    const body = {
      confirmedWorkflowFiles: [
        { digest, path: ".github/workflows/cloudmarkup-validate.yml" },
      ],
      contractVersion: 1,
      previewDigest: digest,
      previewId: "githubpreview_test",
    };

    const denied = await app.request(path, authorizedJson(body));
    const accepted = await app.request(
      path,
      authorizedJson(body, { "idempotency-key": "github-export-retry-1" }),
    );

    expect(denied.status).toBe(400);
    expect(accepted.status).toBe(201);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[2].confirmedWorkflowFiles).toEqual(
      body.confirmedWorkflowFiles,
    );
  });

  it("keeps the webhook endpoint disabled when no verified service is configured", async () => {
    const { app } = fixture();
    const response = await app.request("/webhooks/github", {
      body: "{}",
      headers: {
        "x-github-delivery": "delivery-1",
        "x-github-event": "ping",
        "x-hub-signature-256": `sha256:${"0".repeat(64)}`,
      },
      method: "POST",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      received: false,
      status: "github-disabled",
    });
  });
});
