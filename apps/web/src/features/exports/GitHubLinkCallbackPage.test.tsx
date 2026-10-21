import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { CloudMarkupQueryProvider } from "../../api/index.js";
import { relayGitHubInstallationLinkCallback } from "./github-installation-link-relay.js";

vi.mock("./github-installation-link-relay.js", () => ({
  relayGitHubInstallationLinkCallback: vi.fn(),
  subscribeToGitHubInstallationLinkCallback: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("GitHub callback before the authentication boundary", () => {
  it.each([
    "/organizations/org_callback/settings/integrations",
    "/organizations/org_callback/projects/project_callback/artifacts/solutionartifact_callback/export/github",
  ])(
    "relays and removes proof before any session request at %s",
    async (path) => {
      vi.mocked(relayGitHubInstallationLinkCallback).mockResolvedValue();
      const request = vi
        .fn()
        .mockRejectedValue(
          new Error("Must not query a session in the callback tab"),
        );
      window.history.replaceState(
        null,
        "",
        `${path}#github_link_intent=githublink_callback&github_link_receipt=${"a".repeat(48)}`,
      );
      render(
        <StrictMode>
          <CloudMarkupQueryProvider
            client={{ request } as unknown as CloudMarkupClient}
            queryClient={new QueryClient()}
          >
            <App />
          </CloudMarkupQueryProvider>
        </StrictMode>,
      );
      await waitFor(() =>
        expect(
          screen.getByText("GitHub connected in the original tab"),
        ).toBeVisible(),
      );
      expect(window.location.hash).toBe("");
      expect(request).not.toHaveBeenCalled();
      const call = vi.mocked(relayGitHubInstallationLinkCallback).mock.calls[0];
      expect(call?.[0]).toEqual({
        contractVersion: 1,
        intentId: "githublink_callback",
        callbackReceipt: "a".repeat(48),
      });
      expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(document.body.textContent).not.toContain("a".repeat(48));
    },
  );

  it("removes malformed proof and gives reconnect guidance without a session request", () => {
    const request = vi.fn();
    window.history.replaceState(
      null,
      "",
      "/organizations/org_callback/settings/integrations#github_link_receipt=bad",
    );
    render(
      <CloudMarkupQueryProvider
        client={{ request } as unknown as CloudMarkupClient}
        queryClient={new QueryClient()}
      >
        <App />
      </CloudMarkupQueryProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Return to your original CloudMarkup tab",
    );
    expect(window.location.hash).toBe("");
    expect(request).not.toHaveBeenCalled();
    expect(relayGitHubInstallationLinkCallback).not.toHaveBeenCalled();
  });
});
