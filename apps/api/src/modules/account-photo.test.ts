import { describe, it, expect, vi } from "vitest";
import { createApp } from "../app.js";
import type { AccountPhotoApplication } from "../application/account-photo.js";
import { InMemoryCloudMarkupApplication } from "../testing/in-memory-adapters.js";
const now = new Date("2026-10-06T12:00:00Z");
const actor = {
  principalId: "principal_photo",
  sessionId: "session_photo",
  authenticatedAt: now.toISOString(),
  expiresAt: "2026-10-06T13:00:00Z",
  authenticationSource: "test" as const,
};
const value = {
  contractVersion: 1 as const,
  principalId: actor.principalId,
  version: 0,
  image: null,
};
const etag = '"photo:empty:0"';
function setup(configured = true) {
  const application = {
    get: vi
      .fn<AccountPhotoApplication["get"]>()
      .mockResolvedValue({ value, etag }),
    update: vi
      .fn<AccountPhotoApplication["update"]>()
      .mockResolvedValue({ value, etag }),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => now,
    principalResolver: {
      resolve: (header) =>
        Promise.resolve(header === "Bearer synthetic-photo" ? actor : null),
    },
    ...(configured
      ? {
          accountPhoto: {
            application,
            publicOrigin: "https://beta.example.invalid",
          },
        }
      : {}),
  });
  const headers = {
    authorization: "Bearer synthetic-photo",
    origin: "https://beta.example.invalid",
    "content-type": "application/json",
    "if-match": etag,
  };
  return { app, application, headers };
}
describe("private actor-owned photo HTTP contract", () => {
  it("binds reads and writes to verified identity, independent of query selectors, with no-store", async () => {
    const f = setup();
    const read = await f.app.request("/v1/account/photo?principalId=foreign", {
      headers: f.headers,
    });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toContain("private");
    expect(read.headers.get("cache-control")).toContain("no-store");
    expect(read.headers.get("etag")).toBe(etag);
    expect(f.application.get).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
    );
    expect(
      (
        await f.app.request("/v1/account/photo", {
          method: "PUT",
          headers: f.headers,
          body: JSON.stringify({ contractVersion: 1, image: null }),
        })
      ).status,
    ).toBe(200);
    expect(f.application.update).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      { contractVersion: 1, image: null },
      etag,
    );
  });
  it.each(["principalId", "organizationId", "role", "url"])(
    "rejects client-selected %s",
    async (field) => {
      const f = setup();
      expect(
        (
          await f.app.request("/v1/account/photo", {
            method: "PUT",
            headers: f.headers,
            body: JSON.stringify({
              contractVersion: 1,
              image: null,
              [field]: "foreign",
            }),
          })
        ).status,
      ).toBe(400);
      expect(f.application.update).not.toHaveBeenCalled();
    },
  );
  it("fails closed for authentication, exact origin, cross-site, missing preconditions and unavailable service", async () => {
    const f = setup(),
      body = JSON.stringify({ contractVersion: 1, image: null });
    expect((await f.app.request("/v1/account/photo")).status).toBe(401);
    for (const changes of [
      { origin: "https://foreign.test" },
      { "sec-fetch-site": "cross-site" },
      { origin: "" },
    ]) {
      expect(
        (
          await f.app.request("/v1/account/photo", {
            method: "PUT",
            headers: { ...f.headers, ...changes },
            body,
          })
        ).status,
      ).toBe(403);
    }
    const headers = new Headers(f.headers);
    headers.delete("if-match");
    expect(
      (
        await f.app.request("/v1/account/photo", {
          method: "PUT",
          headers,
          body,
        })
      ).status,
    ).toBe(428);
    expect(f.application.update).not.toHaveBeenCalled();
    expect(
      (
        await setup(false).app.request("/v1/account/photo", {
          headers: f.headers,
        })
      ).status,
    ).toBe(503);
  });
});
