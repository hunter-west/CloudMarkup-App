import { describe, expect, it } from "vitest";
import {
  changeOrganizationMembershipV1Schema,
  organizationMemberV1Schema,
  organizationMembershipReceiptV1Schema,
} from "./organization-members.js";
const member = {
  contractVersion: 1,
  organizationId: "org_team",
  membershipId: "membership_member",
  principalId: "principal_member",
  displayName: "Member",
  username: null,
  role: "editor",
  status: "active",
  version: 1,
  etag: '"member:abc:1"',
  joinedAt: "2026-09-30T12:00:00.000Z",
  endedAt: null,
  endReason: null,
};
describe("organization member contract", () => {
  it("keeps commands strict and excludes ordinary owner assignment", () => {
    expect(
      changeOrganizationMembershipV1Schema.safeParse({
        contractVersion: 1,
        action: "set-role",
        membershipId: member.membershipId,
        role: "owner",
      }).success,
    ).toBe(false);
    for (const action of ["leave", "remove"])
      expect(
        changeOrganizationMembershipV1Schema.safeParse({
          contractVersion: 1,
          action,
          membershipId: member.membershipId,
          principalId: member.principalId,
        }).success,
      ).toBe(false);
    expect(
      changeOrganizationMembershipV1Schema.safeParse({
        contractVersion: 1,
        action: "transfer-ownership",
        membershipId: member.membershipId,
        targetMembershipId: "membership_other",
        targetVersion: 0,
      }).success,
    ).toBe(false);
  });
  it("requires consistent departure metadata and exact positive versions", () => {
    expect(organizationMemberV1Schema.safeParse(member).success).toBe(true);
    for (const change of [
      { status: "removed" },
      { status: "active", endReason: "left", endedAt: member.joinedAt },
      { version: 0 },
      { version: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(
        organizationMemberV1Schema.safeParse({ ...member, ...change }).success,
      ).toBe(false);
    expect(
      organizationMemberV1Schema.safeParse({
        ...member,
        status: "removed",
        endReason: "left",
        endedAt: member.joinedAt,
      }).success,
    ).toBe(true);
  });
  it("requires two distinct outcomes for ownership transfer", () => {
    const state = {
      membershipId: member.membershipId,
      principalId: member.principalId,
      role: member.role,
      status: member.status,
      version: 2,
    };
    const receipt = {
      contractVersion: 1,
      organizationId: member.organizationId,
      actorPrincipalId: member.principalId,
      action: "transfer-ownership",
      members: [state],
      occurredAt: member.joinedAt,
    };
    expect(
      organizationMembershipReceiptV1Schema.safeParse(receipt).success,
    ).toBe(false);
    expect(
      organizationMembershipReceiptV1Schema.safeParse({
        ...receipt,
        members: [state, state],
      }).success,
    ).toBe(false);
  });
});
