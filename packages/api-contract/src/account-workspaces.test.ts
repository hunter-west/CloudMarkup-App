import { describe, expect, it } from "vitest";
import {
  accountWorkspaceV1Schema,
  createAccountOrganizationV1Schema,
  createPersonalWorkspaceV1Schema,
} from "./account-workspaces.js";
describe("actor-owned workspace contracts", () => {
  it("accepts a name without accepting caller-selected ownership", () => {
    expect(
      createAccountOrganizationV1Schema.parse({
        contractVersion: 1,
        displayName: "  Example  ",
      }),
    ).toEqual({ contractVersion: 1, displayName: "Example" });
    expect(
      createPersonalWorkspaceV1Schema.parse({ contractVersion: 1 }),
    ).toEqual({ contractVersion: 1 });
  });
  it.each([
    "principalId",
    "organizationId",
    "role",
    "kind",
    "billingAccountId",
  ])("rejects caller-selected %s", (field) => {
    expect(
      createAccountOrganizationV1Schema.safeParse({
        contractVersion: 1,
        displayName: "Example",
        [field]: "foreign",
      }).success,
    ).toBe(false);
    expect(
      createPersonalWorkspaceV1Schema.safeParse({
        contractVersion: 1,
        [field]: "foreign",
      }).success,
    ).toBe(false);
  });
  it.each(["", "x".repeat(121), "line\nbreak"])(
    "rejects an invalid name",
    (displayName) => {
      expect(
        createAccountOrganizationV1Schema.safeParse({
          contractVersion: 1,
          displayName,
        }).success,
      ).toBe(false);
    },
  );
  it("rejects personal ownership projected as an ordinary member", () => {
    const personal = {
      contractVersion: 1,
      principalId: "principal_test",
      id: "org_test",
      displayName: "Personal",
      kind: "personal",
      role: "owner",
    };
    expect(accountWorkspaceV1Schema.parse(personal)).toEqual(personal);
    expect(
      accountWorkspaceV1Schema.safeParse({ ...personal, role: "viewer" })
        .success,
    ).toBe(false);
  });
});
