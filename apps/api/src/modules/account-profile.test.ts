import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { ApiEnvironment } from "../transport/http.js";
import { registerAccountProfileRoutes } from "./account-profile.js";
import { registerAccountPhotoRoutes } from "./account-photo.js";
import { registerAccountWorkspaceRoutes } from "./account-workspaces.js";
import { registerOrganizationMembersRoutes } from "./organization-members.js";
import { registerRecipientOrganizationInvitationRoutes } from "./recipient-organization-invitations.js";
import { registerStaffAccountRoutes } from "./staff-accounts.js";
import { createApp } from "../app.js";
import { ApplicationError } from "../application/errors.js";
import type { AccountProfileApplication } from "../application/account-profile.js";
import { InMemoryCloudMarkupApplication } from "../testing/in-memory-adapters.js";
const now = new Date("2026-09-30T12:00:00.000Z");
const principal = {
  principalId: "principal_profile",
  sessionId: "session_profile",
  authenticatedAt: now.toISOString(),
  expiresAt: "2026-09-30T13:00:00.000Z",
  authenticationSource: "test" as const,
};
const value = {
  contractVersion: 1 as const,
  principalId: principal.principalId,
  displayName: "Synthetic name",
  username: null,
  version: 1,
};
const etag = '"profile:' + "a".repeat(32) + ':1"';
function setup(configured = true) {
  const application = {
    get: vi
      .fn<AccountProfileApplication["get"]>()
      .mockResolvedValue({ value, etag }),
    update: vi
      .fn<AccountProfileApplication["update"]>()
      .mockResolvedValue({ value, etag }),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => now,
    principalResolver: {
      resolve: (header) =>
        Promise.resolve(header === "Bearer test-profile" ? principal : null),
    },
    ...(configured
      ? {
          accountProfile: {
            application,
            publicOrigin: "https://beta.example.invalid",
          },
        }
      : {}),
  });
  const headers = {
    authorization: "Bearer test-profile",
    origin: "https://beta.example.invalid",
    "content-type": "application/json",
    "if-match": etag,
  };
  return { app, application, headers };
}
describe("actor-owned profile HTTP routes", () => {
  it("admits loopback account controls only through trusted local-owner mode and preserves hosted HTTPS", () => {
    const routes = [
      registerAccountProfileRoutes,
      registerAccountPhotoRoutes,
      registerAccountWorkspaceRoutes,
      registerOrganizationMembersRoutes,
      registerRecipientOrganizationInvitationRoutes,
      registerStaffAccountRoutes,
    ];
    const vectors = [
      [undefined, "https://example.invalid", true],
      [undefined, "http://127.0.0.1:4317", false],
      ["hosted-cognito", "http://127.0.0.1:4317", false],
      ["hosted-cognito", "https://example.invalid", true],
      ["local-owner", "http://127.0.0.1:4317", true],
      ["local-owner", "https://127.0.0.1:4317", true],
      ["local-owner", "http://example.invalid", false],
      ["local-owner", "https://example.invalid", false],
      ["local-owner", "http://localhost:4317", false],
      ["local-owner", "http://[::1]:4317", false],
      ["local-owner", "http://user:pass@127.0.0.1:4317", false],
      ["local-owner", "http://127.0.0.1:4317/", false],
      ["local-owner", "http://127.0.0.1:4317/path", false],
      ["local-owner", "http://127.0.0.1:4317?query=1", false],
      ["local-owner", "http://127.0.0.1:4317#fragment", false],
      ["invalid" as never, "https://example.invalid", false],
    ] as const;
    for (const register of routes)
      for (const [mode, publicOrigin, allowed] of vectors) {
        // Registration-only fixture: service methods are never called.
        const invoke = () => {
          register(new Hono<ApiEnvironment>(), {
            publicOrigin,
            application: {} as never,
            ...(mode === undefined ? {} : { mode }),
          });
        };
        if (allowed) expect(invoke).not.toThrow();
        else expect(invoke).toThrow(TypeError);
      }
  });
  it("binds GET/PUT to verified identity and returns the exact profile ETag", async () => {
    const f = setup(),
      read = await f.app.request("/v1/account/profile", { headers: f.headers });
    expect(read.status).toBe(200);
    expect(read.headers.get("etag")).toBe(etag);
    const response = await f.app.request("/v1/account/profile", {
      method: "PUT",
      headers: f.headers,
      body: JSON.stringify({
        contractVersion: 1,
        displayName: "Synthetic name",
        username: null,
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(f.application.update).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: principal.principalId }),
      { contractVersion: 1, displayName: "Synthetic name", username: null },
      etag,
    );
  });
  it.each([
    "principalId",
    "role",
    "organizationId",
    "password",
    "email",
    "emailVerified",
  ])("rejects client-selected %s", async (field) => {
    const f = setup();
    const response = await f.app.request("/v1/account/profile", {
      method: "PUT",
      headers: f.headers,
      body: JSON.stringify({
        contractVersion: 1,
        displayName: "Name",
        username: null,
        [field]: "foreign",
      }),
    });
    expect(response.status).toBe(400);
    expect(f.application.update).not.toHaveBeenCalled();
  });
  it("requires the current version and preserves stale-version failures", async () => {
    const f = setup();
    const headers = new Headers(f.headers);
    headers.delete("if-match");
    const body = JSON.stringify({
      contractVersion: 1,
      displayName: "Name",
      username: null,
    });
    expect(
      (
        await f.app.request("/v1/account/profile", {
          method: "PUT",
          headers,
          body,
        })
      ).status,
    ).toBe(428);
    f.application.update.mockRejectedValue(
      new ApplicationError("precondition_failed", "Reload your profile."),
    );
    expect(
      (
        await f.app.request("/v1/account/profile", {
          method: "PUT",
          headers: f.headers,
          body,
        })
      ).status,
    ).toBe(412);
  });
  it.each(["https://foreign.test", undefined])(
    "denies missing or foreign origin %s",
    async (origin) => {
      const f = setup(),
        headers = new Headers(f.headers);
      if (origin === undefined) headers.delete("origin");
      else headers.set("origin", origin);
      expect(
        (
          await f.app.request("/v1/account/profile", {
            method: "PUT",
            headers,
            body: JSON.stringify({
              contractVersion: 1,
              displayName: "Name",
              username: null,
            }),
          })
        ).status,
      ).toBe(403);
      expect(f.application.update).not.toHaveBeenCalled();
    },
  );
  it("denies unauthenticated access and unconfigured profile writes", async () => {
    const f = setup();
    expect((await f.app.request("/v1/account/profile")).status).toBe(401);
    expect(
      (await f.app.request("/v1/account/profile", { method: "PUT" })).status,
    ).toBe(401);
    const disabled = setup(false);
    expect(
      (
        await disabled.app.request("/v1/account/profile", {
          headers: disabled.headers,
        })
      ).status,
    ).toBe(503);
  });
});
