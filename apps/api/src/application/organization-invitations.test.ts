import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "./ports.js";
import {
  OrganizationInvitationApplication,
  type OrganizationInvitationRepository,
} from "./organization-invitations.js";
const at = "2026-09-08T12:00:00.000Z";
const principal: PrincipalContext = {
  principalId: "principal_owner",
  sessionId: "session_owner",
  correlationId: "correlation_invite",
  authenticatedAt: at,
  expiresAt: "2026-09-08T13:00:00.000Z",
  authenticationSource: "test",
};
const token = Buffer.alloc(32, 0xab).toString("base64url");
const id = "invitation_11111111-1111-4111-8111-111111111111";
const invitation = {
  contractVersion: 1,
  id,
  organizationId: "org_shared",
  role: "editor",
  status: "pending",
  expiresAt: "2026-09-09T12:00:00.000Z",
} as const;
const accepted = {
  contractVersion: 1,
  organizationId: "org_shared",
  membershipId: "membership_recipient",
  role: "editor",
  status: "accepted",
} as const;
function fixture() {
  const repository = {
    create: vi
      .fn<OrganizationInvitationRepository["create"]>()
      .mockResolvedValue(invitation),
    accept: vi
      .fn<OrganizationInvitationRepository["accept"]>()
      .mockResolvedValue(accepted),
    revoke: vi
      .fn<OrganizationInvitationRepository["revoke"]>()
      .mockResolvedValue({ ...invitation, status: "revoked" }),
  };
  return {
    repository,
    application: new OrganizationInvitationApplication({
      repository,
      now: () => new Date(at),
    }),
  };
}
describe("organization invitation application boundary", () => {
  it("passes only scoped hashes, never the caller's secret or extra identity claims", async () => {
    const { application, repository } = fixture();
    await expect(
      application.create(
        { ...principal, extra: "private-token" } as PrincipalContext,
        "org_shared",
        { contractVersion: 1, role: "editor", token },
        "attempt_one",
      ),
    ).resolves.toEqual(invitation);
    const args = repository.create.mock.calls[0];
    if (args === undefined) throw new Error("Missing storage invocation.");
    expect(Object.isFrozen(args[0])).toBe(true);
    expect(Object.isFrozen(args[1])).toBe(true);
    expect(args[0]).toEqual(principal);
    expect(args[1]).toMatchObject({
      organizationId: "org_shared",
      role: "editor",
    });
    for (const key of [
      "tokenSha256",
      "requestSha256",
      "idempotencyKeySha256",
    ] as const)
      expect(args[1][key]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain(token);
    expect(JSON.stringify(args)).not.toContain("private-token");
  });
  it("binds create replay to tenant, actor, role and exact token hash", async () => {
    const { application, repository } = fixture();
    const input = { contractVersion: 1, role: "editor", token };
    await application.create(principal, "org_shared", input, "attempt_one");
    await application.create(principal, "org_shared", input, "attempt_one");
    expect(repository.create.mock.calls[0]?.[1]).toEqual(
      repository.create.mock.calls[1]?.[1],
    );
    await application.create(
      principal,
      "org_shared",
      { ...input, token: Buffer.alloc(32, 0xcd).toString("base64url") },
      "attempt_one",
    );
    expect(repository.create.mock.calls[2]?.[1].requestSha256).not.toBe(
      repository.create.mock.calls[0]?.[1].requestSha256,
    );
    expect(repository.create.mock.calls[2]?.[1].idempotencyKeySha256).toBe(
      repository.create.mock.calls[0]?.[1].idempotencyKeySha256,
    );
    repository.create.mockResolvedValue({
      ...invitation,
      organizationId: "org_other",
    });
    await application.create(principal, "org_other", input, "attempt_one");
    expect(repository.create.mock.calls[3]?.[1].idempotencyKeySha256).not.toBe(
      repository.create.mock.calls[0]?.[1].idempotencyKeySha256,
    );
  });
  it.each([
    { role: "owner" },
    { principalId: "principal_forged" },
    { email: "unverified@example.invalid" },
    { contractVersion: 2 },
    { token: "wrong" },
  ])("rejects invalid authority before storage %j", async (extra) => {
    const { application, repository } = fixture();
    await expect(
      application.create(
        principal,
        "org_shared",
        { contractVersion: 1, role: "editor", token, ...extra },
        "attempt_one",
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("requires current and recent authentication before all operations", async () => {
    const { application, repository } = fixture();
    await expect(
      application.create(
        { ...principal, expiresAt: at },
        "org_shared",
        { contractVersion: 1, role: "editor", token },
        "attempt_one",
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      application.accept(
        { ...principal, authenticatedAt: "2026-09-08T11:49:59.000Z" },
        id,
        { contractVersion: 1, token },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      application.revoke(
        { ...principal, expiresAt: "invalid" },
        "org_shared",
        id,
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.accept).not.toHaveBeenCalled();
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it("accepts with the genuine principal and a hash matching creation, without principal selectors", async () => {
    const { application, repository } = fixture();
    await application.create(
      principal,
      "org_shared",
      { contractVersion: 1, role: "editor", token },
      "attempt_one",
    );
    await expect(
      application.accept(principal, id, { contractVersion: 1, token }),
    ).resolves.toEqual(accepted);
    expect(repository.accept.mock.calls[0]).toEqual([
      principal,
      id,
      repository.create.mock.calls[0]?.[1].tokenSha256,
    ]);
    await expect(
      application.accept(principal, id, {
        contractVersion: 1,
        token,
        principalId: "principal_someone",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(repository.accept).toHaveBeenCalledTimes(1);
  });
  it("rejects a mismatched response tenant or role and supports bounded revoke", async () => {
    const { application, repository } = fixture();
    repository.create.mockResolvedValue({
      ...invitation,
      organizationId: "org_other",
    });
    await expect(
      application.create(
        principal,
        "org_shared",
        { contractVersion: 1, role: "editor", token },
        "attempt_one",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    repository.create.mockResolvedValue({
      ...invitation,
      role: "administrator",
    });
    await expect(
      application.create(
        principal,
        "org_shared",
        { contractVersion: 1, role: "editor", token },
        "attempt_one",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      application.revoke(principal, "org_shared", id),
    ).resolves.toMatchObject({ status: "revoked" });
    repository.revoke.mockResolvedValue({
      ...invitation,
      organizationId: "org_other",
    });
    await expect(
      application.revoke(principal, "org_shared", id),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it("does not expose malformed storage responses or their content in schema errors", async () => {
    const { application, repository } = fixture();
    repository.create.mockResolvedValue({
      ...invitation,
      extra: "private stored detail",
    } as typeof invitation);
    await expect(
      application.create(
        principal,
        "org_shared",
        { contractVersion: 1, role: "editor", token },
        "attempt_one",
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      message: "The invitation is unavailable.",
    });
    repository.accept.mockResolvedValue({
      ...accepted,
      extra: "private stored detail",
    } as typeof accepted);
    await expect(
      application.accept(principal, id, { contractVersion: 1, token }),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      message: "The invitation is unavailable.",
    });
  });
});
