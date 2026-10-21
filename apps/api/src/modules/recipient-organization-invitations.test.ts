import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { ApplicationError } from "../application/errors.js";
import type { RecipientOrganizationInvitationApplication } from "../application/recipient-organization-invitations.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
const now = "2026-09-30T12:00:00.000Z",
  invitationId = "invitation_12345678-1234-4234-8234-123456789abc";
const owner = {
  principalId: "principal_owner",
  sessionId: "session_owner",
  authenticatedAt: now,
  expiresAt: "2026-09-30T13:00:00.000Z",
};
const recipient = {
  ...owner,
  principalId: "principal_recipient",
  sessionId: "session_recipient",
};
const metadata = {
  contractVersion: 1 as const,
  id: invitationId,
  organizationId: "org_example",
  organizationName: "Example",
  role: "editor" as const,
  expiresAt: "2026-10-01T12:00:00.000Z",
  status: "pending" as const,
  recipient: {
    principalId: recipient.principalId,
    displayName: "Synthetic recipient",
    username: "recipient_user",
  },
};
const accepted = {
  contractVersion: 1 as const,
  organizationId: metadata.organizationId,
  membershipId: "membership_recipient",
  role: "editor" as const,
  status: "accepted" as const,
};
const input = {
  contractVersion: 1,
  role: "editor",
  recipient: { kind: "username", username: " Recipient_User " },
};
const path = "/v1/organizations/org_example/member-invitations",
  inbox = "/v1/account/invitations";
const headers = {
  authorization: "Bearer owner",
  origin: "https://beta.example.invalid",
  "content-type": "application/json",
  "idempotency-key": "targeted-invitation-request",
};
function fixture(configured = true) {
  const port = {
    createForRecipient: vi
      .fn<RecipientOrganizationInvitationApplication["createForRecipient"]>()
      .mockResolvedValue(metadata),
    listForOrganization: vi
      .fn<RecipientOrganizationInvitationApplication["listForOrganization"]>()
      .mockResolvedValue({ items: [metadata] }),
    listForRecipient: vi
      .fn<RecipientOrganizationInvitationApplication["listForRecipient"]>()
      .mockResolvedValue({ items: [metadata] }),
    acceptForRecipient: vi
      .fn<RecipientOrganizationInvitationApplication["acceptForRecipient"]>()
      .mockResolvedValue(accepted),
    declineForRecipient: vi
      .fn<RecipientOrganizationInvitationApplication["declineForRecipient"]>()
      .mockResolvedValue({ ...metadata, status: "declined" }),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({
      "Bearer owner": owner,
      "Bearer recipient": recipient,
      "Bearer expired": { ...owner, expiresAt: now },
    }),
    ...(configured
      ? {
          recipientOrganizationInvitations: {
            application: port,
            publicOrigin: headers.origin,
          },
        }
      : {}),
  });
  return { app, port };
}
describe("recipient-bound invitation HTTP transport", () => {
  it("uses current actor authority, canonical recipients and exact idempotency", async () => {
    const f = fixture();
    const response = await f.app.request(path, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(f.port.createForRecipient).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: owner.principalId }),
      metadata.organizationId,
      { ...input, recipient: { kind: "username", username: "recipient_user" } },
      headers["idempotency-key"],
    );
    expect(await response.json()).toEqual({ apiVersion: "v1", data: metadata });
  });
  it("paginates management and inbox reads using only the verified actor", async () => {
    const f = fixture();
    expect(
      (await f.app.request(path + "?page[limit]=2", { headers })).status,
    ).toBe(200);
    expect(f.port.listForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: owner.principalId }),
      metadata.organizationId,
      expect.objectContaining({ limit: 2 }),
    );
    const response = await f.app.request(
      inbox + "?page[limit]=1&page[cursor]=" + invitationId,
      { headers: { authorization: "Bearer recipient" } },
    );
    expect(response.status).toBe(200);
    expect(f.port.listForRecipient).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: recipient.principalId }),
      expect.objectContaining({ limit: 1, cursor: invitationId }),
    );
  });
  it.each(["accept", "decline"])(
    "binds %s to the current recipient with a version-only body",
    async (action) => {
      const f = fixture();
      const response = await f.app.request(
        inbox + "/" + invitationId + "/" + action,
        {
          method: "POST",
          headers: { ...headers, authorization: "Bearer recipient" },
          body: JSON.stringify({ contractVersion: 1 }),
        },
      );
      expect(response.status).toBe(200);
      expect(
        action === "accept"
          ? f.port.acceptForRecipient
          : f.port.declineForRecipient,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ principalId: recipient.principalId }),
        invitationId,
      );
    },
  );
  it.each(["principalId", "organizationId", "token", "emailVerified"])(
    "rejects caller-selected %s before dispatch",
    async (field) => {
      const f = fixture();
      expect(
        (
          await f.app.request(path, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...input, [field]: "foreign" }),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await f.app.request(inbox + "/" + invitationId + "/accept", {
            method: "POST",
            headers,
            body: JSON.stringify({ contractVersion: 1, [field]: "foreign" }),
          })
        ).status,
      ).toBe(400);
      expect(f.port.createForRecipient).not.toHaveBeenCalled();
      expect(f.port.acceptForRecipient).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, "https://foreign.test"])(
    "requires same-origin writes for origin %s",
    async (origin) => {
      const f = fixture(),
        candidate = new Headers(headers);
      if (origin === undefined) candidate.delete("origin");
      else candidate.set("origin", origin);
      expect(
        (
          await f.app.request(path, {
            method: "POST",
            headers: candidate,
            body: JSON.stringify(input),
          })
        ).status,
      ).toBe(403);
      expect(f.port.createForRecipient).not.toHaveBeenCalled();
    },
  );
  it("rejects cross-site fetch metadata and unknown or repeated query keys without echo", async () => {
    const f = fixture(),
      secret = "synthetic-untrusted-query";
    expect(
      (
        await f.app.request(path, {
          method: "POST",
          headers: { ...headers, "sec-fetch-site": "cross-site" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    for (const query of [
      "?" + secret + "=value",
      "?page[limit]=1&page[limit]=2",
    ]) {
      const response = await f.app.request(inbox + query, { headers });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(secret);
    }
    expect(f.port.listForRecipient).not.toHaveBeenCalled();
  });
  it("requires idempotency and authenticates before parsing request bytes", async () => {
    const f = fixture(),
      missing = new Headers(headers);
    missing.delete("idempotency-key");
    expect(
      (
        await f.app.request(path, {
          method: "POST",
          headers: missing,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(400);
    for (const authorization of [undefined, "Bearer expired"]) {
      const response = await f.app.request(
        inbox + "/" + invitationId + "/accept",
        {
          method: "POST",
          headers: authorization ? { authorization } : {},
          body: "{bad",
        },
      );
      expect(response.status).toBe(401);
    }
    expect(f.port.createForRecipient).not.toHaveBeenCalled();
    expect(f.port.acceptForRecipient).not.toHaveBeenCalled();
  });
  it("preserves current denied/cross-tenant failures and stays unavailable until configured", async () => {
    const f = fixture();
    f.port.listForOrganization.mockRejectedValue(
      new ApplicationError("access_denied", "This action is not permitted."),
    );
    expect((await f.app.request(path, { headers })).status).toBe(403);
    f.port.acceptForRecipient.mockRejectedValue(
      new ApplicationError("not_found", "The invitation is unavailable."),
    );
    expect(
      (
        await f.app.request(inbox + "/" + invitationId + "/accept", {
          method: "POST",
          headers,
          body: JSON.stringify({ contractVersion: 1 }),
        })
      ).status,
    ).toBe(404);
    expect((await fixture(false).app.request(inbox, { headers })).status).toBe(
      503,
    );
  });
});
