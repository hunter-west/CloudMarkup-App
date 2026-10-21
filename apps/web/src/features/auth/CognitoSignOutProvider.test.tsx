import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import type { CognitoBrowserAuthSession } from "./cognito-browser-auth.js";
import { CognitoSignOutProvider } from "./CognitoSignOutProvider.js";
import type { CognitoSignOutChannel } from "./cognito-sign-out-channel.js";

function testChannel() {
  let active = false;
  let listener: (() => void) | undefined;
  const close = vi.fn(() => {
    active = false;
    listener = undefined;
  });
  const subscribe = vi.fn((nextListener: () => void) => {
    active = true;
    listener = nextListener;
    return close;
  });
  return {
    channel: {
      publish: vi.fn(),
      subscribe,
    } satisfies CognitoSignOutChannel,
    close,
    emit() {
      if (active) listener?.();
    },
    subscribe,
  };
}

function testClient(): CloudMarkupClient {
  return {
    request: vi.fn(),
    requestWithMetadata: vi.fn(),
  };
}

describe("global Cognito sign-out listener", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/auth/callback?surface=public");
  });

  afterEach(() => {
    cleanup();
  });

  it("clears a public tab's in-memory authority and cache before replace-navigation", async () => {
    const queryClient = new QueryClient();
    const tenantKey = ["cloudmarkup-api", "tenant", "sensitive"] as const;
    queryClient.setQueryData(tenantKey, { architecture: "private" });
    const clearSession = vi.fn();
    const channel = testChannel();

    render(
      <CloudMarkupQueryProvider client={testClient()} queryClient={queryClient}>
        <RouterProvider>
          <CognitoSignOutProvider
            channel={channel.channel}
            session={{ clearSession } as unknown as CognitoBrowserAuthSession}
          >
            <h1>Public callback surface</h1>
          </CognitoSignOutProvider>
        </RouterProvider>
      </CloudMarkupQueryProvider>,
    );

    expect(channel.subscribe).toHaveBeenCalledOnce();
    await act(async () => {
      channel.emit();
      await Promise.resolve();
    });

    expect(clearSession).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(tenantKey)).toBeUndefined();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/sign-in");
      expect(window.location.search).toBe("");
    });
  });

  it("unsubscribes on unmount and ignores later broadcasts", () => {
    const clearSession = vi.fn();
    const channel = testChannel();
    const { unmount } = render(
      <CloudMarkupQueryProvider client={testClient()}>
        <RouterProvider>
          <CognitoSignOutProvider
            channel={channel.channel}
            session={{ clearSession } as unknown as CognitoBrowserAuthSession}
          >
            <h1>Public callback surface</h1>
          </CognitoSignOutProvider>
        </RouterProvider>
      </CloudMarkupQueryProvider>,
    );

    unmount();
    channel.emit();

    expect(channel.close).toHaveBeenCalledOnce();
    expect(clearSession).not.toHaveBeenCalled();
  });
});
