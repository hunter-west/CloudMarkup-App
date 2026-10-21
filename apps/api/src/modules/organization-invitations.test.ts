import { MAX_JSON_REQUEST_BYTES } from "@cloudmarkup/api-contract";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { ApplicationError } from "../application/errors.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import type { OrganizationInvitationPort } from "./organization-invitations.js";

const invitationId = "invitation_12345678-1234-4234-8234-123456789abc";
const token = "A".repeat(43);
const now = "2026-09-07T18:00:00.000Z";
const principal = {
  principalId: "principal_owner",
  sessionId: "session_owner",
  authenticatedAt: now,
  expiresAt: "2026-09-07T18:10:00.000Z",
};
const metadata = {
  contractVersion: 1 as const,
  id: invitationId,
  organizationId: "org_sharing",
  role: "editor" as const,
  expiresAt: "2026-09-08T18:00:00.000Z",
  status: "pending" as const,
};
const accepted = {
  contractVersion: 1 as const,
  organizationId: "org_sharing",
  membershipId: "membership_joined",
  role: "editor" as const,
  status: "accepted" as const,
};
const createPath = "/v1/organizations/org_sharing/invitations";
const acceptPath = `/v1/organization-invitations/${invitationId}/accept`;
const revokePath = `${createPath}/${invitationId}`;
const input = { contractVersion: 1, role: "editor", token };
const headers = {
  authorization: "Bearer synthetic-owner",
  "content-type": "application/json",
  "idempotency-key": "invitation-attempt",
};
function fixture(enabled = true) {
  const port = {
    create: vi
      .fn<OrganizationInvitationPort["create"]>()
      .mockResolvedValue(metadata),
    revoke: vi
      .fn<OrganizationInvitationPort["revoke"]>()
      .mockResolvedValue({ ...metadata, status: "revoked" }),
    accept: vi
      .fn<OrganizationInvitationPort["accept"]>()
      .mockResolvedValue(accepted),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    correlationIdFactory: () => "correlation-sharing",
    principalResolver: new FixedPrincipalResolver({
      "Bearer synthetic-owner": principal,
      "Bearer synthetic-expired": { ...principal, expiresAt: now },
    }),
    ...(enabled ? { organizationInvitations: port } : {}),
  });
  return { port, app };
}
describe("organization invitation HTTP transport", () => {
  it("passes only verified principal and strict body input; returns metadata-only no-store results", async () => {
    const { app, port } = fixture();
    const created = await app.request(createPath, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ apiVersion: "v1", data: metadata });
    expect(port.create).toHaveBeenCalledExactlyOnceWith(
      {
        ...principal,
        authenticationSource: "test",
        correlationId: "correlation-sharing",
      },
      "org_sharing",
      input,
      "invitation-attempt",
    );
    const joined = await app.request(acceptPath, {
      method: "POST",
      headers,
      body: JSON.stringify({ contractVersion: 1, token }),
    });
    expect(joined.status).toBe(200);
    expect(await joined.json()).toEqual({ apiVersion: "v1", data: accepted });
    expect(port.accept).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ principalId: principal.principalId }),
      invitationId,
      { contractVersion: 1, token },
    );
    const revoked = await app.request(revokePath, {
      method: "DELETE",
      headers,
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.text()).not.toContain(token);
    expect(port.revoke).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ principalId: principal.principalId }),
      "org_sharing",
      invitationId,
    );
    for (const response of [created, joined, revoked]) {
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
  it.each([undefined, "Bearer synthetic-expired"])(
    "authenticates before reading malformed bytes for %s",
    async (authorization) => {
      const { app, port } = fixture();
      for (const [path, method] of [
        [createPath, "POST"],
        [acceptPath, "POST"],
        [revokePath, "DELETE"],
      ] as const) {
        const response = await app.request(path, {
          method,
          headers: authorization === undefined ? {} : { authorization },
          body: "{invalid",
        });
        expect(response.status).toBe(401);
      }
      expect(port.create).not.toHaveBeenCalled();
      expect(port.accept).not.toHaveBeenCalled();
      expect(port.revoke).not.toHaveBeenCalled();
    },
  );
  it.each([`?token=${token}`, `?${token}=one&${token}=two`])(
    "rejects query secrets without echoing parameter names",
    async (query) => {
      const { app, port } = fixture();
      for (const [path, method, body] of [
        [createPath, "POST", input],
        [acceptPath, "POST", { contractVersion: 1, token }],
        [revokePath, "DELETE", undefined],
      ] as const) {
        const response = await app.request(path + query, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain(token);
      }
      expect(port.create).not.toHaveBeenCalled();
      expect(port.accept).not.toHaveBeenCalled();
      expect(port.revoke).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...input, role: "owner" },
    { ...input, organizationId: "org_other" },
    { ...input, token: "not-canonical" },
    { ...input, [token]: "hidden" },
  ])("rejects strict create input without dispatch", async (body) => {
    const { app, port } = fixture();
    const response = await app.request(createPath, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(token);
    expect(port.create).not.toHaveBeenCalled();
  });
  it("requires idempotency, rejects GET acceptance and DELETE bodies", async () => {
    const { app, port } = fixture();
    const create = await app.request(createPath, {
      method: "POST",
      headers: {
        authorization: headers.authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    expect(create.status).toBe(400);
    expect((await app.request(acceptPath, { headers })).status).toBe(404);
    expect(
      (await app.request(revokePath, { method: "DELETE", headers, body: "{}" }))
        .status,
    ).toBe(400);
    expect(port.create).not.toHaveBeenCalled();
    expect(port.accept).not.toHaveBeenCalled();
    expect(port.revoke).not.toHaveBeenCalled();
  });
  it("retains the existing request byte bound", async () => {
    const { app, port } = fixture();
    const response = await app.request(acceptPath, {
      method: "POST",
      headers,
      body: "x".repeat(MAX_JSON_REQUEST_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(port.accept).not.toHaveBeenCalled();
  });
  it.each([
    "access_denied",
    "not_found",
    "conflict",
    "service_unavailable",
  ] as const)(
    "preserves canonical %s denial without inventing membership",
    async (code) => {
      const { app, port } = fixture();
      port.accept.mockRejectedValue(
        new ApplicationError(code, "The invitation is unavailable."),
      );
      const response = await app.request(acceptPath, {
        method: "POST",
        headers,
        body: JSON.stringify({ contractVersion: 1, token }),
      });
      expect(response.status).toBe(
        {
          access_denied: 403,
          not_found: 404,
          conflict: 409,
          service_unavailable: 503,
        }[code],
      );
      expect(await response.text()).not.toContain(token);
    },
  );
  it("fails closed when no real service is composed", async () => {
    const { app } = fixture(false);
    expect(
      (
        await app.request(createPath, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await app.request(acceptPath, {
          method: "POST",
          headers,
          body: JSON.stringify({ contractVersion: 1, token }),
        })
      ).status,
    ).toBe(503);
    expect(
      (await app.request(revokePath, { method: "DELETE", headers })).status,
    ).toBe(503);
  });
});
