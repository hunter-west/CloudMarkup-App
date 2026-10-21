import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { ApplicationError } from "../application/errors.js";
import type { ProjectEditingLeasePort } from "../application/project-editing-leases.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";

const now = "2026-09-06T12:00:00.000Z";
const token = "A".repeat(43); // public synthetic32-byte value, never a credential
const proof = {
  leaseId: "projectlease_12345678-1234-4234-8234-123456789abc",
  token,
};
const base = "/v1/projects/project_test/editing-lease";
const principal = {
  authenticatedAt: now,
  expiresAt: "2026-09-06T13:00:00.000Z",
  principalId: "principal_test",
  sessionId: "session_test",
};
const verifiedPrincipal = {
  ...principal,
  authenticationSource: "test",
  correlationId: "correlation-editing-test",
};
const available = {
  contractVersion: 1 as const,
  projectId: "project_test",
  state: "available" as const,
};
const owned = {
  ...available,
  state: "owned" as const,
  leaseId: proof.leaseId,
  expiresAt: "2026-09-06T12:02:00.000Z",
};
const methods = [
  { method: "GET", operation: "get" },
  { method: "POST", operation: "acquire" },
  { method: "PUT", operation: "renew" },
  { method: "DELETE", operation: "release" },
] as const;

function fixture(enabled = true) {
  const port = {
    get: vi.fn<ProjectEditingLeasePort["get"]>().mockResolvedValue(available),
    acquire: vi
      .fn<ProjectEditingLeasePort["acquire"]>()
      .mockResolvedValue(owned),
    renew: vi.fn<ProjectEditingLeasePort["renew"]>().mockResolvedValue(owned),
    release: vi
      .fn<ProjectEditingLeasePort["release"]>()
      .mockResolvedValue(available),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    correlationIdFactory: () => "correlation-editing-test",
    principalResolver: new FixedPrincipalResolver({
      "Bearer owner": principal,
    }),
    ...(enabled ? { projectEditingLeases: port } : {}),
  });
  const headers = {
    authorization: "Bearer owner",
    "content-type": "application/json",
  };
  return { app, port, headers };
}

function inputFor(method: string) {
  return method === "POST"
    ? { contractVersion: 1, token }
    : { contractVersion: 1, ...proof };
}

function requestFor(
  method: string,
  headers: Record<string, string>,
): RequestInit {
  return {
    method,
    headers,
    ...(method === "GET" ? {} : { body: JSON.stringify(inputFor(method)) }),
  };
}

describe("authenticated project editing lease routes", () => {
  it.each(methods)(
    "$method passes only the authenticated principal and validated project/proof",
    async ({ method, operation }) => {
      const f = fixture();
      const response = await f.app.request(base, requestFor(method, f.headers));
      expect(response.status).toBe(200);
      if (operation === "get")
        expect(f.port.get).toHaveBeenCalledWith(
          verifiedPrincipal,
          "project_test",
        );
      else
        expect(f.port[operation]).toHaveBeenCalledWith(
          verifiedPrincipal,
          "project_test",
          operation === "acquire" ? { token } : proof,
        );
      for (const [key, portMethod] of Object.entries(f.port))
        expect(portMethod).toHaveBeenCalledTimes(key === operation ? 1 : 0);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      const body = await response.text();
      expect(body).not.toContain(token);
      expect(body).not.toContain(principal.principalId);
      expect(body).not.toContain(principal.sessionId);
    },
  );

  it.each(methods)(
    "$method authenticates before parsing content or calling the port",
    async ({ method }) => {
      const f = fixture();
      const response = await f.app.request(base, {
        method,
        ...(method === "GET" ? {} : { body: "{invalid" }),
      });
      expect(response.status).toBe(401);
      for (const portMethod of Object.values(f.port))
        expect(portMethod).not.toHaveBeenCalled();
    },
  );

  it.each(methods)(
    "$method rejects a malformed project selector before the port",
    async ({ method }) => {
      const f = fixture();
      const response = await f.app.request(
        base.replace("project_test", "org_other"),
        requestFor(method, f.headers),
      );
      expect(response.status).toBe(400);
      for (const portMethod of Object.values(f.port))
        expect(portMethod).not.toHaveBeenCalled();
    },
  );

  it.each(methods.filter(({ method }) => method !== "GET"))(
    "$method rejects malformed, substituted or unversioned mutation authority",
    async ({ method }) => {
      const f = fixture();
      const input = inputFor(method);
      for (const body of [
        "{invalid",
        JSON.stringify(null),
        JSON.stringify({ ...input, token: "A".repeat(42) + "B" }),
        JSON.stringify({ ...input, contractVersion: 2 }),
        JSON.stringify({ ...input, principalId: "principal_other" }),
        JSON.stringify({ ...input, projectId: "project_other" }),
        JSON.stringify({ ...input, expiresAt: "2099-01-01T00:00:00Z" }),
      ]) {
        const response = await f.app.request(base, {
          method,
          headers: f.headers,
          body,
        });
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain(token);
      }
      for (const portMethod of Object.values(f.port))
        expect(portMethod).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"])(
    "%s requires the exact lease ID and rejects an incomplete proof",
    async (method) => {
      const f = fixture();
      for (const input of [
        { contractVersion: 1, token },
        { contractVersion: 1, ...proof, leaseId: "project_wrong" },
      ]) {
        expect(
          (
            await f.app.request(base, {
              method,
              headers: f.headers,
              body: JSON.stringify(input),
            })
          ).status,
        ).toBe(400);
      }
      expect(f.port.renew).not.toHaveBeenCalled();
      expect(f.port.release).not.toHaveBeenCalled();
    },
  );

  it.each(methods)(
    "$method remains unavailable when no implementation is registered",
    async ({ method }) => {
      const f = fixture(false);
      const response = await f.app.request(base, requestFor(method, f.headers));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toMatchObject({
        error: { code: "service_unavailable" },
      });
      for (const portMethod of Object.values(f.port))
        expect(portMethod).not.toHaveBeenCalled();
    },
  );

  it.each(methods)(
    "$method preserves indistinguishable cross-tenant and missing-resource errors",
    async ({ method, operation }) => {
      const f = fixture();
      f.port[operation].mockRejectedValue(
        new ApplicationError(
          "not_found",
          "The requested resource is unavailable.",
        ),
      );
      const foreign = await f.app.request(
        base.replace("project_test", "project_foreign"),
        requestFor(method, f.headers),
      );
      const missing = await f.app.request(
        base.replace("project_test", "project_missing"),
        requestFor(method, f.headers),
      );
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await foreign.json()).toEqual(await missing.json());
      expect(f.port[operation].mock.calls[0]?.slice(0, 2)).toEqual([
        verifiedPrincipal,
        "project_foreign",
      ]);
    },
  );

  it("preserves a safe stale-proof conflict and never returns the submitted token", async () => {
    const f = fixture();
    f.port.renew.mockRejectedValue(
      new ApplicationError("conflict", "The editing lease is no longer valid."),
    );
    const response = await f.app.request(base, requestFor("PUT", f.headers));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(token);
  });

  it.each(["token", "holderId", "holderEmail"])(
    "rejects an implementation response that would leak %s",
    async (field) => {
      const f = fixture();
      const leak = field === "token" ? token : "synthetic-holder@example.test";
      // Runtime validation must reject extra fields even if a structurally typed
      // adapter accidentally returns a richer internal record.
      const unsafe = { ...owned, [field]: leak };
      f.port.acquire.mockResolvedValue(unsafe);
      const response = await f.app.request(base, requestFor("POST", f.headers));
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const body = await response.text();
      expect(body).not.toContain(leak);
      expect(body).not.toContain(proof.leaseId);
      expect(JSON.parse(body)).toMatchObject({
        error: { code: "internal_error" },
      });
    },
  );

  it("sanitizes an unexpected adapter error instead of exposing internal token or tenant details", async () => {
    const f = fixture();
    f.port.acquire.mockRejectedValue(
      new Error(`Synthetic failure ${token} principal_other`),
    );
    const response = await f.app.request(base, requestFor("POST", f.headers));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain(token);
    expect(body).not.toContain("principal_other");
  });
});
