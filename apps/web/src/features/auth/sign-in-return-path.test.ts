import { describe, expect, it } from "vitest";
import {
  checkedSignInReturnPath,
  signInPathForReturn,
  signInReturnPathFromSearch,
} from "./sign-in-return-path.js";
const path = "/organizations/org_test/projects/project_test/exports/job_test";
describe("sign-in return navigation", () => {
  it("preserves a known export route and its view selectors", () => {
    const destination = path + "?tab=findings#details";
    const link = signInPathForReturn(destination);
    expect(
      signInReturnPathFromSearch(new URL(link, "https://example.test").search),
    ).toBe(destination);
  });
  it.each([
    null,
    "https://attacker.test/",
    "//attacker.test/",
    "/\\attacker.test/",
    "/api/auth/session/v1/restore",
    "/auth/callback?code=secret",
    "/sign-in?returnTo=/settings/profile",
    "/missing",
    "/settings/profile\n",
    "javascript:alert(1)",
    "/" + "a".repeat(2049),
  ])("rejects unsafe or unsupported return values (%s)", (value) => {
    expect(checkedSignInReturnPath(value)).toBeUndefined();
  });
  it("rejects duplicate return selectors", () => {
    expect(
      signInReturnPathFromSearch(
        "?returnTo=" + encodeURIComponent(path) + "&returnTo=/settings/profile",
      ),
    ).toBeUndefined();
  });
});
