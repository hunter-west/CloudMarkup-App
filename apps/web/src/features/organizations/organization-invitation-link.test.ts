import { describe, expect, it } from "vitest";
import { readInvitationSecret } from "./organization-invitation-link.js";
const id = "invitation_12345678-1234-4234-8234-123456789abc";
const token = "A".repeat(43);
describe("body-only invitation link", () => {
  it("accepts only canonical metadata ID and single unencoded fragment secret", () => {
    expect(readInvitationSecret(id, "", `#token=${token}`)).toEqual({
      invitationId: id,
      token,
    });
  });
  it.each([
    `#token=${token}&token=${token}`,
    `#token=${token}&role=owner`,
    `#token=%41${token.slice(1)}`,
    `#token=${"A".repeat(42)}B`,
    "",
    `#${token}`,
  ])("rejects malformed fragment %s", (hash) => {
    expect(readInvitationSecret(id, "", hash)).toBeNull();
  });
  it("rejects query credentials and raw token paths", () => {
    expect(
      readInvitationSecret(id, `?token=${token}`, `#token=${token}`),
    ).toBeNull();
    expect(readInvitationSecret(token, "", `#token=${token}`)).toBeNull();
  });
});
