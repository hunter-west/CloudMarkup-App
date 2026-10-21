import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import { ApplicationError } from "../application/errors.js";
import type { OrganizationMembersApplication } from "../application/organization-members.js";
const now = "2026-09-30T12:00:00.000Z",
  actor = {
    principalId: "principal_actor",
    sessionId: "session_actor",
    authenticatedAt: now,
    expiresAt: "2026-09-30T13:00:00.000Z",
  };
const member = {
  contractVersion: 1 as const,
  organizationId: "org_team",
  membershipId: "membership_member",
  principalId: "principal_member",
  displayName: "Member",
  username: null,
  role: "editor" as const,
  status: "active" as const,
  version: 1,
  etag: '"member:abc:1"',
  joinedAt: now,
  endedAt: null,
  endReason: null,
};
const input = {
  contractVersion: 1,
  action: "set-role",
  membershipId: member.membershipId,
  role: "viewer",
};
const receipt = {
  contractVersion: 1 as const,
  organizationId: member.organizationId,
  actorPrincipalId: actor.principalId,
  action: "set-role" as const,
  members: [
    {
      membershipId: member.membershipId,
      principalId: member.principalId,
      role: "viewer" as const,
      status: "active" as const,
      version: 2,
    },
  ],
  occurredAt: now,
};
const headers = {
  authorization: "Bearer actor",
  origin: "https://beta.example.invalid",
  "content-type": "application/json",
  "idempotency-key": "member-change-001",
  "if-match": member.etag,
};
const path = "/v1/organizations/org_team/membership-changes";
function fixture(configured = true) {
  const port = {
    list: vi
      .fn<OrganizationMembersApplication["list"]>()
      .mockResolvedValue({ items: [member] }),
    own: vi
      .fn<OrganizationMembersApplication["own"]>()
      .mockResolvedValue({ value: member, etag: member.etag }),
    change: vi
      .fn<OrganizationMembersApplication["change"]>()
      .mockResolvedValue(receipt),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({ "Bearer actor": actor }),
    ...(configured
      ? {
          organizationMembers: {
            application: port,
            publicOrigin: headers.origin,
          },
        }
      : {}),
  });
  return { app, port };
}
describe("member lifecycle HTTP transport", () => {
  it("forwards only the verified actor and exact conditional attempt", async () => {
    const f = fixture(),
      response = await f.app.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(f.port.change).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      member.organizationId,
      input,
      member.etag,
      headers["idempotency-key"],
    );
    expect(await response.json()).toEqual({ apiVersion: "v1", data: receipt });
  });
  it("returns a versioned self-read and strict manager pagination", async () => {
    const f = fixture(),
      response = await f.app.request(
        "/v1/account/workspaces/org_team/membership",
        { headers },
      );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(member.etag);
    expect(
      (
        await f.app.request(
          "/v1/organizations/org_team/members?page[limit]=2&page[cursor]=membership_cursor",
          { headers },
        )
      ).status,
    ).toBe(200);
    expect(f.port.list).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      member.organizationId,
      expect.objectContaining({ limit: 2, cursor: "membership_cursor" }),
    );
  });
  it.each([
    [{ origin: "https://other.example" }, 403],
    [{ "sec-fetch-site": "cross-site" }, 403],
    [{ authorization: "" }, 401],
    [{ "if-match": "" }, 400],
    [{ "idempotency-key": "" }, 400],
  ] as const)(
    "denies missing authority or headers %j",
    async (change, status) => {
      const f = fixture(),
        response = await f.app.request(path, {
          method: "POST",
          headers: { ...headers, ...change },
          body: JSON.stringify(input),
        });
      expect(response.status).toBe(status);
      expect(f.port.change).not.toHaveBeenCalled();
    },
  );
  it.each(["?actor=principal_other"])(
    "rejects unknown mutation query %s",
    async (query) => {
      const f = fixture(),
        response = await f.app.request(path + query, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        });
      expect(response.status).toBe(400);
      expect(f.port.change).not.toHaveBeenCalled();
    },
  );
  it("rejects unknown body fields and duplicate paging", async () => {
    const f = fixture();
    expect(
      (
        await f.app.request(path, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...input,
            actorPrincipalId: "principal_other",
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.app.request(
          "/v1/organizations/org_team/members?page[limit]=1&page[limit]=2",
          { headers },
        )
      ).status,
    ).toBe(400);
    expect(f.port.change).not.toHaveBeenCalled();
    expect(f.port.list).not.toHaveBeenCalled();
  });
  it.each(["not_found", "access_denied", "precondition_failed"] as const)(
    "preserves application %s decisions",
    async (code) => {
      const f = fixture();
      f.port.change.mockRejectedValue(
        new ApplicationError(code, "Membership unavailable."),
      );
      const response = await f.app.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(
        { not_found: 404, access_denied: 403, precondition_failed: 412 }[code],
      );
      expect(await response.json()).toMatchObject({ error: { code } });
    },
  );
  it("fails closed when configuration is unavailable", async () => {
    const f = fixture(false);
    expect(
      (
        await f.app.request(path, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(503);
  });
});
