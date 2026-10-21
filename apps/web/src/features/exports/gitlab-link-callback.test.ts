import { afterEach, describe, expect, it } from "vitest";
import { readAndRemoveGitLabLinkCallback } from "./gitlab-link-callback.js";
const state = "s".repeat(43),
  code = "synthetic-code-123456789012345";
afterEach(() => {
  window.history.replaceState(null, "", "/");
});
describe("GitLab callback capture", () => {
  it("removes the authorization proof immediately and returns it only once", () => {
    window.history.replaceState(
      null,
      "",
      `/account/gitlab/callback?state=${state}&code=${code}`,
    );
    expect(readAndRemoveGitLabLinkCallback()).toEqual({ state, code });
    expect(window.location.search).toBe("");
    expect(readAndRemoveGitLabLinkCallback()).toBeUndefined();
  });
  it.each([
    `?state=${state}&code=${code}&code=${code}`,
    `?state=${state}&code=${code}&state=${state}`,
    `?state=${state}`,
    `?code=${code}`,
    `?state=short&code=${code}`,
    `?state=${state}&code=short`,
    `?state=${state}&code=${code}#code=${code}`,
    `#state=${state}&code=${code}`,
    `?state=${state}&code=${code}&next=https://evil.example`,
    "?error=access_denied&error_description=sensitive-provider-text",
    `?state=${state}&code=${"c".repeat(8192)}`,
  ])(
    "removes and rejects ambiguous, failed or malformed callbacks %#",
    (suffix) => {
      window.history.replaceState(
        null,
        "",
        "/account/gitlab/callback" + suffix,
      );
      expect(readAndRemoveGitLabLinkCallback()).toBeUndefined();
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("");
    },
  );
  it("leaves unrelated routes untouched", () => {
    window.history.replaceState(
      null,
      "",
      `/auth/callback?state=${state}&code=${code}`,
    );
    expect(readAndRemoveGitLabLinkCallback()).toBeUndefined();
    expect(window.location.search).toContain(code);
  });
});
