import { afterEach, describe, expect, it } from "vitest";

import { readAndRemoveGitHubInstallationLinkCallback } from "./github-installation-link-callback.js";

const intent = "githublink_test";
const receipt = `receipt.${"r".repeat(40)}`;
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("GitHub callback fragment capture", () => {
  it("removes fragment proof immediately and returns it once without changing other parameters", () => {
    window.history.replaceState(
      {},
      "",
      `/organizations/org_test/settings/integrations?keep=visible#github_link_intent=${intent}&github_link_receipt=${receipt}`,
    );
    expect(readAndRemoveGitHubInstallationLinkCallback()).toEqual({
      present: true,
      callback: {
        contractVersion: 1,
        intentId: intent,
        callbackReceipt: receipt,
      },
    });
    expect(window.location.search).toBe("?keep=visible");
    expect(window.location.hash).toBe("");
    expect(readAndRemoveGitHubInstallationLinkCallback()).toEqual({
      present: false,
    });
  });
  it.each([
    `#github_link_intent=${intent}&github_link_receipt=${receipt}&github_link_receipt=${receipt}`,
    `?github_link_intent=${intent}#github_link_intent=${intent}&github_link_receipt=${receipt}`,
    `#github_link_intent=${intent}`,
  ])(
    "removes but rejects duplicate, mixed-location or incomplete proof %s",
    (suffix) => {
      window.history.replaceState(
        {},
        "",
        `/organizations/org_test/settings/integrations${suffix}`,
      );
      expect(readAndRemoveGitHubInstallationLinkCallback()).toEqual({
        present: true,
      });
      expect(window.location.href).not.toContain("github_link");
    },
  );
});
