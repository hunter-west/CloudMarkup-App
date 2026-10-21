import type { GitLabProjectsApplication } from "../application/gitlab-projects.js";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import type { GitLabConnectionsApplication } from "../application/gitlab-connections.js";
import { ApplicationError } from "../application/errors.js";
const now = "2026-10-01T12:00:00.000Z";
const origin = "https://beta.example.invalid";
const actor = {
  principalId: "principal_actor",
  sessionId: "family_actor",
  authenticatedAt: now,
  expiresAt: "2026-10-01T13:00:00.000Z",
};
const connection = {
  contractVersion: 1 as const,
  id: "gitlab_" + "1".repeat(32),
  organizationId: "org_example",
  principalId: actor.principalId,
  providerUsername: "synthetic-user",
  status: "active" as const,
  providerRevocation: "not-requested" as const,
};
const root = "/v1/organizations/org_example/gitlab-connections";
const cookie =
  "v1." + "i".repeat(16) + "." + "c".repeat(64) + "." + "t".repeat(22);
const cookieHeader = "__Host-cloudmarkup-gitlab-link=" + cookie;
const intent = {
  contractVersion: 1 as const,
  intentId: "gitlablink_" + "2".repeat(32),
  expiresAt: "2026-10-01T12:10:00.000Z",
  authorizationUrl:
    "https://gitlab.com/oauth/authorize?" +
    new URLSearchParams({
      client_id: "a".repeat(64),
      redirect_uri: origin + "/account/gitlab/callback",
      response_type: "code",
      scope: "api",
      state: "s".repeat(43),
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
    }).toString(),
};
const completion = {
  contractVersion: 1 as const,
  intentId: intent.intentId,
  state: "s".repeat(43),
  code: "synthetic-authorization-code",
};
const headers = {
  authorization: "Bearer actor",
  origin,
  "content-type": "application/json",
  cookie: cookieHeader,
};
function fixture(configured = true) {
  const port = {
    start: vi
      .fn<GitLabConnectionsApplication["start"]>()
      .mockResolvedValue({ intent, cookie }),
    complete: vi
      .fn<GitLabConnectionsApplication["complete"]>()
      .mockResolvedValue(connection),
    list: vi
      .fn<GitLabConnectionsApplication["list"]>()
      .mockResolvedValue({ items: [connection] }),
    get: vi
      .fn<GitLabConnectionsApplication["get"]>()
      .mockResolvedValue(connection),
    disconnect: vi
      .fn<GitLabConnectionsApplication["disconnect"]>()
      .mockResolvedValue({
        ...connection,
        status: "revoked",
        providerRevocation: "confirmed",
      }),
  };
  const selection = {
    contractVersion: 1 as const,
    organizationId: connection.organizationId,
    principalId: connection.principalId,
    connectionId: connection.id,
    projectId: 42,
    version: 1,
    enabled: true,
  };
  const projects = {
    discover: vi.fn<GitLabProjectsApplication["discover"]>().mockResolvedValue({
      contractVersion: 1,
      organizationId: connection.organizationId,
      principalId: connection.principalId,
      connectionId: connection.id,
      projects: [
        {
          projectId: 42,
          pathWithNamespace: "group/project",
          defaultBranch: "main",
          url: "https://gitlab.com/group/project",
          eligibility: "eligible",
        },
      ],
      nextPage: null,
    }),
    selections: vi
      .fn<GitLabProjectsApplication["selections"]>()
      .mockResolvedValue({ items: [selection] }),
    update: vi
      .fn<GitLabProjectsApplication["update"]>()
      .mockResolvedValue(selection),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({ "Bearer actor": actor }),
    ...(configured
      ? {
          gitlabConnections: {
            application: port,
            projects,
            publicOrigin: origin,
            clock: () => new Date(now),
          },
        }
      : {}),
  });
  return { app, port, projects };
}
const mutationPaths = [
  "/link-intents",
  "/link-completions",
  "/" + connection.id + "/disconnect",
];
function body(path: string) {
  return path.endsWith("link-completions")
    ? completion
    : { contractVersion: 1 };
}
describe("GitLab connection HTTP transport", () => {
  it("starts with a secure HttpOnly state cookie that never appears in response JSON", async () => {
    const f = fixture();
    const response = await f.app.request(root + "/link-intents", {
      method: "POST",
      headers,
      body: JSON.stringify({ contractVersion: 1 }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBe(
      cookieHeader + "; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const text = await response.text();
    expect(text).not.toContain(cookie);
    expect(JSON.parse(text)).toMatchObject({ data: intent });
    expect(f.port.start).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: actor.principalId,
        sessionId: actor.sessionId,
      }),
      "org_example",
    );
  });
  it("completes the exact callback and clears the transient cookie", async () => {
    const f = fixture();
    const response = await f.app.request(root + "/link-completions", {
      method: "POST",
      headers,
      body: JSON.stringify(completion),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(f.port.complete).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      "org_example",
      completion,
      cookie,
    );
    const text = await response.text();
    expect(text).not.toContain(completion.code);
    expect(text).not.toContain(cookie);
  });
  it("lists, reads and disconnects only exact actor/workspace records", async () => {
    const f = fixture();
    const response = await f.app.request(root + "?limit=25", { headers });
    expect(response.status).toBe(200);
    expect(f.port.list).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      "org_example",
      25,
      undefined,
    );
    expect(
      (await f.app.request(root + "/" + connection.id, { headers })).status,
    ).toBe(200);
    const disconnected = await f.app.request(
      root + "/" + connection.id + "/disconnect",
      { method: "POST", headers, body: JSON.stringify({ contractVersion: 1 }) },
    );
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toMatchObject({
      data: { status: "revoked", providerRevocation: "confirmed" },
    });
  });
  it.each(mutationPaths)(
    "requires exact browser origin for %s",
    async (path) => {
      for (const changed of [
        { origin: "" },
        { origin: "https://other.example" },
        { "sec-fetch-site": "cross-site" },
      ]) {
        const f = fixture();
        const response = await f.app.request(root + path, {
          method: "POST",
          headers: { ...headers, ...changed },
          body: JSON.stringify(body(path)),
        });
        expect(response.status).toBe(403);
        expect(f.port.start).not.toHaveBeenCalled();
        expect(f.port.complete).not.toHaveBeenCalled();
        expect(f.port.disconnect).not.toHaveBeenCalled();
      }
    },
  );
  it.each([
    "",
    cookieHeader + "; " + cookieHeader,
    "__Host-cloudmarkup-gitlab-link=bad",
    "__Host-cloudmarkup-gitlab-link=v1." + "x".repeat(4090) + ".a.b",
  ])(
    "denies absent, duplicate or malformed callback cookie",
    async (changed) => {
      const f = fixture();
      const response = await f.app.request(root + "/link-completions", {
        method: "POST",
        headers: { ...headers, cookie: changed },
        body: JSON.stringify(completion),
      });
      expect(response.status).toBe(400);
      expect(f.port.complete).not.toHaveBeenCalled();
    },
  );
  it.each(
    [
      "?limit=1&limit=2",
      "?cursor=integration_foreign",
      "?principalId=principal_other",
      "?organizationId=org_other",
    ].filter((_, index) => index !== 3),
  )("rejects ambiguous or foreign selectors %s", async (query) => {
    const f = fixture();
    const response = await f.app.request(root + query, { headers });
    expect(response.status).toBe(400);
    expect(f.port.list).not.toHaveBeenCalled();
  });
  it.each(mutationPaths)(
    "requires authentication and denies authority fields for %s",
    async (path) => {
      const f = fixture();
      expect(
        (
          await f.app.request(root + path, {
            method: "POST",
            headers: { "content-type": "application/json", origin },
            body: JSON.stringify(body(path)),
          })
        ).status,
      ).toBe(401);
      const response = await f.app.request(root + path, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body(path), principalId: "principal_other" }),
      });
      expect(response.status).toBe(400);
    },
  );
  it.each(["", ...mutationPaths, "/" + connection.id])(
    "fails closed when unconfigured for %s",
    async (path) => {
      const f = fixture(false),
        write = mutationPaths.includes(path);
      expect(
        (
          await f.app.request(root + path, {
            method: write ? "POST" : "GET",
            headers,
            ...(write ? { body: JSON.stringify(body(path)) } : {}),
          })
        ).status,
      ).toBe(503);
    },
  );
  it.each(["principalId", "organizationId", "id"] as const)(
    "rejects foreign returned %s before exposing response data",
    async (field) => {
      const f = fixture();
      f.port.get.mockResolvedValue({
        ...connection,
        [field]:
          field === "id"
            ? "gitlab_" + "3".repeat(32)
            : field === "organizationId"
              ? "org_other"
              : "principal_other",
      });
      const response = await f.app.request(root + "/" + connection.id, {
        headers,
      });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("synthetic-user");
    },
  );
  it("rejects response credentials even when ordinary metadata matches", async () => {
    const f = fixture();
    const leaked = {
      ...connection,
      accessToken: "synthetic-private-provider-token",
    };
    f.port.get.mockResolvedValue(leaked);
    const response = await f.app.request(root + "/" + connection.id, {
      headers,
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(leaked.accessToken);
  });
  it("preserves pending recovery cookie when completion acknowledgement is uncertain", async () => {
    const f = fixture();
    f.port.complete.mockRejectedValue(
      new ApplicationError(
        "service_unavailable",
        "GitLab connections are temporarily unavailable.",
      ),
    );
    const response = await f.app.request(root + "/link-completions", {
      method: "POST",
      headers,
      body: JSON.stringify(completion),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("rejects a start response with a different configured callback", async () => {
    const f = fixture();
    const url = new URL(intent.authorizationUrl);
    url.searchParams.set(
      "redirect_uri",
      "https://other.example/account/gitlab/callback",
    );
    f.port.start.mockResolvedValue({
      intent: { ...intent, authorizationUrl: url.href },
      cookie,
    });
    const response = await f.app.request(root + "/link-intents", {
      method: "POST",
      headers,
      body: JSON.stringify({ contractVersion: 1 }),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("GitLab selected project HTTP transport", () => {
  const base = root + "/" + connection.id;
  const input = { contractVersion: 1, expectedVersion: 0, enabled: true };
  it("returns only bound project discovery and selection metadata", async () => {
    const f = fixture();
    expect(
      (await f.app.request(base + "/projects?page=2", { headers })).status,
    ).toBe(200);
    expect(f.projects.discover).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      "org_example",
      connection.id,
      2,
    );
    expect(
      (await f.app.request(base + "/project-selections?limit=10", { headers }))
        .status,
    ).toBe(200);
    const response = await f.app.request(base + "/project-selections/42", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.projects.update).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      "org_example",
      connection.id,
      42,
      input,
    );
  });
  it.each(["/projects", "/project-selections", "/project-selections/42"])(
    "denies unauthenticated and disabled operation %s",
    async (path) => {
      const method = path.endsWith("/42") ? "POST" : "GET",
        options = {
          method,
          headers: { origin, "content-type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
        };
      expect((await fixture().app.request(base + path, options)).status).toBe(
        401,
      );
      expect(
        (await fixture(false).app.request(base + path, { ...options, headers }))
          .status,
      ).toBe(503);
    },
  );
  it.each([
    "/projects?page=1&page=2",
    "/projects?host=evil",
    "/projects?page=201",
    "/project-selections?cursor=01",
    "/project-selections?limit=101",
  ])("rejects selector %s before application access", async (path) => {
    const f = fixture();
    expect((await f.app.request(base + path, { headers })).status).toBe(400);
    expect(f.projects.discover).not.toHaveBeenCalled();
    expect(f.projects.selections).not.toHaveBeenCalled();
  });
  it.each([
    { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" },
  ])("rejects project mutation origin %#", async (extra) => {
    const f = fixture();
    expect(
      (
        await f.app.request(base + "/project-selections/42", {
          method: "POST",
          headers: { ...headers, ...extra },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    expect(f.projects.update).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "principalId", "connectionId"] as const)(
    "does not expose foreign discovery %s",
    async (key) => {
      const f = fixture(),
        value = await f.projects.discover(
          actor as never,
          "org_example",
          connection.id,
          1,
        );
      f.projects.discover.mockClear();
      f.projects.discover.mockResolvedValue({
        ...value,
        [key]:
          key === "connectionId"
            ? "gitlab_" + "f".repeat(32)
            : key === "organizationId"
              ? "org_other"
              : "principal_other",
      });
      const response = await f.app.request(base + "/projects", { headers });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("group/project");
    },
  );
  it.each([
    { version: 2 },
    { projectId: 43 },
    { enabled: false },
    { principalId: "principal_other" },
  ])("rejects mismatched mutation result %#", async (change) => {
    const f = fixture(),
      value = await f.projects.update(
        actor as never,
        "org_example",
        connection.id,
        42,
        input as never,
      );
    f.projects.update.mockClear();
    f.projects.update.mockResolvedValue({ ...value, ...change });
    expect(
      (
        await f.app.request(base + "/project-selections/42", {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(503);
  });
  it("passes a stale selection version failure without retrying the mutation", async () => {
    const f = fixture();
    f.projects.update.mockRejectedValue(
      new ApplicationError("conflict", "Reload selected projects."),
    );
    expect(
      (
        await f.app.request(base + "/project-selections/42", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...input, expectedVersion: 4 }),
        })
      ).status,
    ).toBe(409);
    expect(f.projects.update).toHaveBeenCalledOnce();
  });
});
