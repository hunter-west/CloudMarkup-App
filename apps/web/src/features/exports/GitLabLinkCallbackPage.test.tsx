import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { CloudMarkupQueryProvider } from "../../api/index.js";
import { relayGitLabLinkCallback } from "./gitlab-link-relay.js";
vi.mock("./gitlab-link-relay.js", () => ({
  relayGitLabLinkCallback: vi.fn(),
  subscribeToGitLabLinkCallback: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});
function mount(suffix: string) {
  const request = vi
    .fn()
    .mockRejectedValue(
      new Error("Must not query authentication in the callback tab"),
    );
  window.history.replaceState(null, "", "/account/gitlab/callback" + suffix);
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
  return request;
}
describe("GitLab callback before authentication", () => {
  it("relays only in memory and removes proof before any session request", async () => {
    vi.mocked(relayGitLabLinkCallback).mockImplementation(() => {
      expect(window.location.search).toBe("");
      return Promise.resolve();
    });
    const state = "s".repeat(43),
      code = "c".repeat(48);
    const request = mount(`?state=${state}&code=${code}`);
    await waitFor(() =>
      expect(
        screen.getByText("GitLab connected in the original tab"),
      ).toBeVisible(),
    );
    expect(request).not.toHaveBeenCalled();
    expect(vi.mocked(relayGitLabLinkCallback).mock.calls[0]?.[0]).toEqual({
      state,
      code,
    });
    expect(document.body.textContent).not.toContain(code);
    expect(document.body.textContent).not.toContain(state);
  });
  it.each([
    "",
    "?code=bad",
    "?error=access_denied&error_description=private-detail",
  ])("gives safe guidance for unavailable callback %s", (suffix) => {
    const request = mount(suffix);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Return to your original CloudMarkup tab",
    );
    expect(window.location.search).toBe("");
    expect(request).not.toHaveBeenCalled();
    expect(relayGitLabLinkCallback).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("private-detail");
  });
});
