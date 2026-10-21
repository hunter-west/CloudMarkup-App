import { githubInstallationLinkIntentResponseV1Schema } from "@cloudmarkup/api-contract";
import {
  GitHubRepositoryExportService,
  type GitHubFetch,
} from "@cloudmarkup/github-repository-export";
import {
  FakeGitHubAppAdapter,
  InMemoryGitHubExportStore,
  RecordingGitHubExportAuditSink,
  RecordingGitHubExportProgressSink,
} from "@cloudmarkup/github-repository-export/testing";
import { describe, expect, it, vi } from "vitest";

import { GitHubInstallationLinkAdapter } from "../adapters/github-installation-link.js";
import { createApp } from "../app.js";
import { ApplicationError } from "../application/errors.js";
import { GitHubRepositoryExportApplicationService } from "../application/github-exports.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";

const origin = "https://beta.example.test";
const now = "2026-09-05T12:00:00.000Z";
const state = "s".repeat(43);
const intentPath =
  "/v1/organizations/org_test/github-app-installation-link-intents";
const completionPath =
  "/v1/organizations/org_test/github-app-installation-link-completions";

function fixture(enabled = true) {
  const fetch = vi.fn<GitHubFetch>((url) => {
    if (String(url).includes("access_token"))
      return Promise.resolve(
        Response.json({
          access_token: "ghu_" + "synthetic".repeat(5),
          scope: "",
          token_type: "bearer",
        }),
      );
    if (String(url) === "https://api.github.com/user")
      return Promise.resolve(Response.json({ id: 31, type: "User" }));
    return Promise.resolve(
      Response.json({
        installations: [
          {
            account: { id: 31, type: "User" },
            app_id: 99,
            id: 71,
            permissions: {
              contents: "write",
              metadata: "read",
              pull_requests: "write",
            },
            repository_selection: "selected",
            suspended_at: null,
          },
        ],
        total_count: 1,
      }),
    );
  });
  const adapter = new GitHubInstallationLinkAdapter({
    appId: 99,
    appSlug: "cloudmarkup-test",
    callbackUrl: `${origin}/api/github/callback`,
    clientId: "Iv1syntheticexample",
    clientSecretReference: "synthetic/github/client-secret",
    clock: () => new Date(now),
    fetch,
    secrets: {
      resolveSecret: () =>
        Promise.resolve(Buffer.from("synthetic-client-secret-for-local-tests")),
    },
  });
  const github = new FakeGitHubAppAdapter();
  github.addInstallation({
    accountId: 31,
    accountLogin: "synthetic-user",
    accountType: "User",
    installationId: 71,
    permissions: {
      contents: "write",
      metadata: "read",
      pullRequests: "write",
      workflows: "none",
    },
    repositorySelection: "selected",
    suspended: false,
  });
  const store = new InMemoryGitHubExportStore();
  const service = new GitHubRepositoryExportService({
    artifactRepository: { getApprovedPackage: () => Promise.resolve(null) },
    audit: new RecordingGitHubExportAuditSink(),
    clock: () => new Date(now),
    github,
    installationLinkCallbackVerifier: adapter,
    installationSetupUrl:
      "https://github.com/apps/cloudmarkup-test/installations/new",
    idFactory: () => "integration_test",
    linkIntentIdFactory: () => "githublink_test",
    linkStateFactory: () => state,
    progress: new RecordingGitHubExportProgressSink(),
    store,
  });
  const application = new GitHubRepositoryExportApplicationService({
    access: {
      authorizeOrganization: (principal, organizationId) => {
        if (organizationId !== "org_test")
          throw new ApplicationError("not_found", "Unavailable.");
        if (principal.principalId !== "principal_test")
          throw new ApplicationError("access_denied", "Unavailable.");
        return Promise.resolve({ organizationId });
      },
      authorizeProject: () =>
        Promise.reject(new ApplicationError("access_denied", "Unavailable.")),
    },
    entitlements: {
      authorize: () =>
        Promise.reject(
          new ApplicationError("service_unavailable", "Not configured."),
        ),
    },
    service,
  });
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    correlationIdFactory: () => "correlation_test",
    githubExports: application,
    ...(enabled
      ? {
          githubInstallationCallback: {
            adapter,
            publicOrigin: origin,
            clock: () => new Date(now),
          },
        }
      : {}),
    principalResolver: new FixedPrincipalResolver({
      "Bearer owner": {
        authenticatedAt: now,
        expiresAt: "2026-09-05T13:00:00.000Z",
        principalId: "principal_test",
        sessionId: "session_test",
      },
      "Bearer other-session": {
        authenticatedAt: now,
        expiresAt: "2026-09-05T13:00:00.000Z",
        principalId: "principal_test",
        sessionId: "session_other",
      },
      "Bearer viewer": {
        authenticatedAt: now,
        expiresAt: "2026-09-05T13:00:00.000Z",
        principalId: "principal_viewer",
        sessionId: "session_viewer",
      },
      "Bearer stale": {
        authenticatedAt: "2026-09-05T11:00:00.000Z",
        expiresAt: "2026-09-05T13:00:00.000Z",
        principalId: "principal_test",
        sessionId: "session_stale",
      },
    }),
  });
  return { adapter, app, fetch, store };
}

function json(
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      authorization: "Bearer owner",
      "content-type": "application/json",
      origin,
      ...headers,
    },
    method: "POST",
  };
}

function cookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null) throw new Error("Missing synthetic browser cookie");
  return header.split(";", 1)[0] ?? "";
}

async function begin(
  value: ReturnType<typeof fixture>,
  headers: Record<string, string> = {},
) {
  const start = await value.app.request(
    intentPath,
    json({ contractVersion: 1 }, headers),
  );
  expect(start.status).toBe(201);
  const intent = githubInstallationLinkIntentResponseV1Schema.parse(
    await start.json(),
  ).data;
  const setup = await value.app.request(
    `/github/setup?installation_id=71&setup_action=install&state=${intent.state}`,
    { headers: { cookie: cookie(start) } },
  );
  expect(setup.status).toBe(303);
  const authorization = new URL(setup.headers.get("location") ?? "");
  return { authorization, setup, start };
}

async function callback(
  value: ReturnType<typeof fixture>,
  headers: Record<string, string> = {},
) {
  const flow = await begin(value, headers);
  const response = await value.app.request(
    `/github/callback?code=synthetic-code&state=${flow.authorization.searchParams.get("state") ?? ""}`,
    { headers: { cookie: cookie(flow.setup) } },
  );
  expect(response.status).toBe(303);
  const redirect = new URL(response.headers.get("location") ?? "");
  const fragment = new URLSearchParams(redirect.hash.slice(1));
  return {
    ...flow,
    redirect,
    response,
    completion: {
      callbackReceipt: fragment.get("github_link_receipt"),
      contractVersion: 1,
      intentId: fragment.get("github_link_intent"),
    },
  };
}

describe("GitHub browser installation callback transport", () => {
  it("performs secure browser setup/OAuth and requires authenticated same-session completion", async () => {
    const value = fixture();
    const flow = await callback(value);
    const startCookie = flow.start.headers.get("set-cookie") ?? "";
    expect(startCookie).toMatch(/^__Host-cloudmarkup-github-link=/);
    expect(startCookie).toContain("Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(startCookie).not.toContain("Domain=");
    expect(flow.response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(flow.redirect.origin).toBe(origin);
    expect(flow.redirect.pathname).toBe(
      "/organizations/org_test/settings/integrations",
    );
    expect(flow.redirect.search).toBe("");
    expect(flow.response.headers.get("cache-control")).toBe("no-store");
    expect(flow.response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(value.store.installations.size).toBe(0);
    const anonymous = await value.app.request(
      completionPath,
      json(flow.completion, { authorization: "" }),
    );
    expect(anonymous.status).toBe(401);
    const wrongSession = await value.app.request(
      completionPath,
      json(flow.completion, { authorization: "Bearer other-session" }),
    );
    expect(wrongSession.status).toBe(400);
    expect(value.store.installations.size).toBe(0);
    const completed = await value.app.request(
      completionPath,
      json(flow.completion),
    );
    expect(completed.status).toBe(201);
    const replay = await value.app.request(
      completionPath,
      json(flow.completion),
    );
    expect(replay.status).toBe(201);
    expect(value.store.installations.size).toBe(1);
    expect(
      JSON.stringify([...value.store.installationLinkIntents.values()]),
    ).not.toContain(state);
  });

  it.each([
    ["absent authentication", { authorization: "" }, 401],
    ["wrong origin", { origin: "https://evil.example.test" }, 403],
    ["missing origin", { origin: "" }, 403],
    ["cross-site fetch", { "sec-fetch-site": "cross-site" }, 403],
    ["viewer", { authorization: "Bearer viewer" }, 403],
    ["stale authentication", { authorization: "Bearer stale" }, 403],
  ] as const)(
    "denies %s before reserving intent or contacting GitHub",
    async (_label, headers, status) => {
      const value = fixture();
      const response = await value.app.request(
        intentPath,
        json({ contractVersion: 1 }, headers),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(value.store.installationLinkIntents.size).toBe(0);
      expect(value.fetch).not.toHaveBeenCalled();
    },
  );

  it("denies cross-tenant start without minting browser proof", async () => {
    const value = fixture();
    const response = await value.app.request(
      intentPath.replace("org_test", "org_other"),
      json({ contractVersion: 1 }),
    );
    expect(response.status).toBe(404);
    expect(value.store.installationLinkIntents.size).toBe(0);
  });

  it("keeps optional callbacks unavailable without configured provider authority", async () => {
    const value = fixture(false);
    for (const path of ["/github/setup", "/github/callback"]) {
      const response = await value.app.request(path);
      expect(response.status).toBe(503);
      expect(await response.text()).toContain("github-disabled");
    }
    expect(value.fetch).not.toHaveBeenCalled();
  });

  it("rejects forged tenant query fields, duplicate parameters, missing cookies and duplicate cookies", async () => {
    const value = fixture();
    const { start } = await begin(value);
    const valid = `/github/setup?installation_id=71&setup_action=install&state=${state}`;
    for (const [path, cookies] of [
      [valid, ""],
      [valid, `${cookie(start)}; ${cookie(start)}`],
      [`${valid}&organizationId=org_other`, cookie(start)],
      [`${valid}&state=${state}`, cookie(start)],
      [
        valid.replace(
          "installation_id=71",
          "installation_id=99999999999999999999",
        ),
        cookie(start),
      ],
    ]) {
      const response = await value.app.request(path ?? "", {
        headers: { cookie: cookies ?? "" },
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(await response.text()).not.toContain(state);
    }
    expect(value.fetch).not.toHaveBeenCalled();
  });

  it("preserves only exact same-origin artifact export return paths", async () => {
    const path =
      "/organizations/org_test/projects/project_test/artifacts/solutionartifact_test/export/github";
    const good = await callback(fixture(), { referer: origin + path });
    expect(good.redirect.pathname).toBe(path);
    const untrusted = await callback(fixture(), {
      referer: "https://evil.example.test" + path,
    });
    expect(untrusted.redirect.pathname).toBe(
      "/organizations/org_test/settings/integrations",
    );
  });
});
