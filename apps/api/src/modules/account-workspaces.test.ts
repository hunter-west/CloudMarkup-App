import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../application/errors.js";
import { createApp } from "../app.js";
import { InMemoryCloudMarkupApplication } from "../testing/in-memory-adapters.js";
import type { AccountWorkspacesApplication } from "../application/account-workspaces.js";
const now = new Date("2026-09-30T12:00:00.000Z");
const principal = {
  principalId: "principal_workspaces",
  authenticatedAt: now.toISOString(),
  expiresAt: "2026-09-30T13:00:00.000Z",
  authenticationSource: "test" as const,
  sessionId: "session_workspaces",
};
const workspace = {
  contractVersion: 1 as const,
  principalId: principal.principalId,
  id: "org_workspace",
  displayName: "Example",
  kind: "organization" as const,
  role: "owner" as const,
};
function fixture(configured = true) {
  const application = {
    get: vi
      .fn<AccountWorkspacesApplication["get"]>()
      .mockResolvedValue(workspace),
    list: vi
      .fn<AccountWorkspacesApplication["list"]>()
      .mockResolvedValue({ items: [workspace] }),
    createOrganization: vi
      .fn<AccountWorkspacesApplication["createOrganization"]>()
      .mockResolvedValue(workspace),
    createPersonal: vi
      .fn<AccountWorkspacesApplication["createPersonal"]>()
      .mockResolvedValue({
        ...workspace,
        kind: "personal",
        displayName: "Personal",
      }),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => now,
    principalResolver: {
      resolve: (header) =>
        Promise.resolve(header === "Bearer test-workspaces" ? principal : null),
    },
    ...(configured
      ? {
          accountWorkspaces: {
            application,
            publicOrigin: "https://beta.example.invalid",
          },
        }
      : {}),
  });
  const headers = {
    authorization: "Bearer test-workspaces",
    origin: "https://beta.example.invalid",
    "content-type": "application/json",
    "idempotency-key": "workspace-request-1",
  };
  return { app, application, headers };
}
describe("actor-owned workspace routes", () => {
  it("binds list and creation to the verified actor", async () => {
    const f = fixture();
    expect(
      (await f.app.request("/v1/account/workspaces", { headers: f.headers }))
        .status,
    ).toBe(200);
    expect(f.application.list).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: principal.principalId }),
      expect.objectContaining({ limit: 25 }),
    );
    expect(
      (
        await f.app.request("/v1/account/organizations", {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify({ contractVersion: 1, displayName: "Example" }),
        })
      ).status,
    ).toBe(201);
    expect(f.application.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: principal.principalId }),
      { contractVersion: 1, displayName: "Example" },
      "workspace-request-1",
    );
    expect(
      (
        await f.app.request("/v1/account/personal-workspace", {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify({ contractVersion: 1 }),
        })
      ).status,
    ).toBe(200);
  });
  it("binds a workspace read to the verified actor and does not disclose inaccessible workspaces", async () => {
    const f = fixture();
    expect(
      (
        await f.app.request("/v1/account/workspaces/org_workspace", {
          headers: f.headers,
        })
      ).status,
    ).toBe(200);
    expect(f.application.get).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: principal.principalId }),
      "org_workspace",
    );
    f.application.get.mockRejectedValue(
      new ApplicationError("not_found", "The workspace is unavailable."),
    );
    expect(
      (
        await f.app.request("/v1/account/workspaces/org_foreign", {
          headers: f.headers,
        })
      ).status,
    ).toBe(404);
    f.application.get.mockClear();
    expect(
      (await f.app.request("/v1/account/workspaces/org_workspace")).status,
    ).toBe(401);
    expect(f.application.get).not.toHaveBeenCalled();
  });
  it.each([
    "principalId",
    "organizationId",
    "role",
    "billingAccountId",
    "kind",
  ])("rejects browser-supplied authority %s", async (field) => {
    const f = fixture();
    expect(
      (
        await f.app.request("/v1/account/organizations", {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify({
            contractVersion: 1,
            displayName: "Example",
            [field]: "foreign",
          }),
        })
      ).status,
    ).toBe(400);
    expect(f.application.createOrganization).not.toHaveBeenCalled();
  });
  it.each(["https://evil.test", undefined])(
    "denies missing or foreign origin %s",
    async (origin) => {
      const f = fixture();
      const headers = new Headers(f.headers);
      if (origin === undefined) headers.delete("origin");
      else headers.set("origin", origin);
      expect(
        (
          await f.app.request("/v1/account/personal-workspace", {
            method: "POST",
            headers,
            body: JSON.stringify({ contractVersion: 1 }),
          })
        ).status,
      ).toBe(403);
      expect(f.application.createPersonal).not.toHaveBeenCalled();
    },
  );
  it("denies unauthenticated list and creation and fails closed when unconfigured", async () => {
    const f = fixture();
    expect((await f.app.request("/v1/account/workspaces")).status).toBe(401);
    expect(
      (
        await f.app.request("/v1/account/organizations", {
          method: "POST",
          body: JSON.stringify({ contractVersion: 1, displayName: "Example" }),
        })
      ).status,
    ).toBe(401);
    const absent = fixture(false);
    expect(
      (
        await absent.app.request("/v1/account/workspaces", {
          headers: absent.headers,
        })
      ).status,
    ).toBe(503);
  });
});
