import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  acceptOrganizationInvitationV1Schema,
  createOrganizationInvitationV1Schema,
  organizationInvitationIdV1Schema,
  organizationInvitationV1Schema,
} from "./organization-invitations.js";
import { apiOperationsV1 } from "./operations.js";
const token = Buffer.alloc(32, 0xab).toString("base64url");
const id = "invitation_11111111-1111-4111-8111-111111111111";
describe("closed organization invitation v1 contracts", () => {
  it("accepts bounded create/accept requests and UUID metadata only", () => {
    expect(
      createOrganizationInvitationV1Schema.parse({
        contractVersion: 1,
        role: "editor",
        token,
      }),
    ).toEqual({ contractVersion: 1, role: "editor", token });
    expect(
      acceptOrganizationInvitationV1Schema.parse({ contractVersion: 1, token }),
    ).toEqual({ contractVersion: 1, token });
    expect(organizationInvitationIdV1Schema.parse(id)).toBe(id);
  });
  it.each(
    ["", token + "=", token.slice(1), token.slice(0, -1) + "B"].filter(
      (_, index) => index !== 0,
    ),
  )("rejects malformed/noncanonical token %s", (candidate) => {
    expect(
      acceptOrganizationInvitationV1Schema.safeParse({
        contractVersion: 1,
        token: candidate,
      }).success,
    ).toBe(false);
  });
  it.each(
    [
      { role: "owner" },
      { principalId: "principal_forged" },
      { email: "not-verified@example.invalid" },
      { organizationId: "org_forged" },
      { contractVersion: 2 },
    ].filter((_, index) => index !== 2 && index !== 3),
  )("rejects unauthorized or extra authority %j", (extra) => {
    expect(
      createOrganizationInvitationV1Schema.safeParse({
        contractVersion: 1,
        role: "editor",
        token,
        ...extra,
      }).success,
    ).toBe(false);
  });
  it("excludes the secret and token hash from public metadata", () => {
    const value = {
      contractVersion: 1,
      id,
      organizationId: "org_shared",
      role: "editor",
      status: "pending",
      expiresAt: "2026-09-08T00:00:00.000Z",
    };
    expect(organizationInvitationV1Schema.parse(value)).toEqual(value);
    expect(
      organizationInvitationV1Schema.safeParse({ ...value, token }).success,
    ).toBe(false);
    expect(
      organizationInvitationV1Schema.safeParse({
        ...value,
        tokenSha256: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      organizationInvitationIdV1Schema.safeParse("invitation_arbitrary")
        .success,
    ).toBe(false);
  });
  it("requires authentication and only a POST can accept", () => {
    expect(apiOperationsV1["organization-invitations.create"].security).toBe(
      "principal",
    );
    expect(apiOperationsV1["organization-invitations.revoke"].security).toBe(
      "principal",
    );
    expect(apiOperationsV1["organization-invitations.accept"].security).toBe(
      "principal",
    );
    expect(apiOperationsV1["organization-invitations.accept"].method).toBe(
      "POST",
    );
  });
});
