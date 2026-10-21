import { describe, expect, it } from "vitest";
import {
  accountProfileV1Schema,
  updateAccountProfileV1Schema,
} from "./account-profile.js";
const valid = {
  contractVersion: 1,
  displayName: "Example User",
  username: "example_user",
};
describe("actor-owned profile contracts", () => {
  it("normalizes usernames and accepts an explicitly cleared username", () => {
    expect(
      updateAccountProfileV1Schema.parse({
        ...valid,
        username: " Example_User ",
      }),
    ).toEqual(valid);
    expect(
      updateAccountProfileV1Schema.parse({ ...valid, username: null }).username,
    ).toBeNull();
  });
  it.each(
    ["principalId", "organizationId", "role", "password"].filter(
      (_, index) => index !== 1 && index !== 2 && index !== 3,
    ),
  )("rejects authority or credential field %s", (field) => {
    expect(
      updateAccountProfileV1Schema.safeParse({ ...valid, [field]: "foreign" })
        .success,
    ).toBe(false);
  });
  it("keeps legacy display names readable while requiring single-line new writes", () => {
    const legacy = { ...valid, displayName: "Legacy\nUser" };
    expect(
      accountProfileV1Schema.parse({
        ...legacy,
        principalId: "principal_example",
        version: 1,
      }).displayName,
    ).toBe(legacy.displayName);
    expect(updateAccountProfileV1Schema.safeParse(legacy).success).toBe(false);
  });
  it("rejects malformed profile readback or an unsafe display name", () => {
    expect(
      accountProfileV1Schema.safeParse({
        ...valid,
        principalId: "principal_example",
        version: 1,
      }).success,
    ).toBe(true);
    expect(
      accountProfileV1Schema.safeParse({
        ...valid,
        principalId: "principal_example",
        version: 0,
      }).success,
    ).toBe(false);
    expect(
      updateAccountProfileV1Schema.safeParse({
        ...valid,
        displayName: "one\ntwo",
      }).success,
    ).toBe(false);
    expect(
      updateAccountProfileV1Schema.safeParse({ ...valid, displayName: " " })
        .success,
    ).toBe(false);
  });
});
