import { describe, expect, it } from "vitest";
import {
  createRecipientOrganizationInvitationV1Schema,
  recipientOrganizationInvitationV1Schema,
} from "./recipient-organization-invitations.js";
const base = {
  contractVersion: 1,
  role: "editor",
  recipient: { kind: "username", username: " Example_User " },
};
describe("recipient-bound organization invitation contracts", () => {
  it("normalizes exact usernames and accepts exact stable user IDs", () => {
    expect(
      createRecipientOrganizationInvitationV1Schema.parse(base).recipient,
    ).toEqual({ kind: "username", username: "example_user" });
    expect(
      createRecipientOrganizationInvitationV1Schema.parse({
        ...base,
        recipient: { kind: "user-id", userId: "principal_example" },
      }).recipient,
    ).toEqual({ kind: "user-id", userId: "principal_example" });
  });
  it.each([
    { kind: "username", username: "ad" },
    { kind: "username", username: "admin" },
    { kind: "username", username: "example*" },
    { kind: "username", username: "person@example.test" },
    { kind: "email", email: "person@example.test" },
    { kind: "user-id", userId: "principal_example", username: "different" },
    { kind: "username", username: "example_user", emailVerified: true },
  ])("rejects unsupported or ambiguous recipients %j", (recipient) => {
    expect(
      createRecipientOrganizationInvitationV1Schema.safeParse({
        ...base,
        recipient,
      }).success,
    ).toBe(false);
  });
  it.each([
    "principalId",
    "organizationId",
    "token",
    "accepted",
    "emailVerified",
  ])("rejects caller-supplied authority %s", (field) => {
    expect(
      createRecipientOrganizationInvitationV1Schema.safeParse({
        ...base,
        [field]: "foreign",
      }).success,
    ).toBe(false);
  });
  it("cannot create owners or decode an unbound invitation as targeted", () => {
    expect(
      createRecipientOrganizationInvitationV1Schema.safeParse({
        ...base,
        role: "owner",
      }).success,
    ).toBe(false);
    const invitation = {
      contractVersion: 1,
      id: "invitation_10000000-0000-0000-0000-000000000001",
      organizationId: "org_example",
      organizationName: "Example",
      role: "editor",
      expiresAt: "2026-10-01T12:00:00.000Z",
      status: "pending",
    };
    expect(
      recipientOrganizationInvitationV1Schema.safeParse(invitation).success,
    ).toBe(false);
    expect(
      recipientOrganizationInvitationV1Schema.parse({
        ...invitation,
        status: "declined",
        recipient: {
          principalId: "principal_example",
          displayName: "Example",
          username: null,
        },
      }).status,
    ).toBe("declined");
  });
});
