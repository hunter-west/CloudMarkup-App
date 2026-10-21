import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { LocalOwnerBrowserSession } from "./local-owner-browser-auth.js";
import { LocalOwnerSessionProvider } from "./local-owner-session-context.js";
import { useOptionalLocalOwnerSession } from "./local-owner-session.js";

const proof = "A".repeat(43);
const firstToken = `cmlo1_${"B".repeat(43)}`;
const secondToken = `cmlo1_${"C".repeat(43)}`;
function grant(accessToken: string): Response {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      accessToken,
      expiresAt: new Date(Date.now() + 28_800_000).toISOString(),
      expiresIn: 28_800,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function SignOutButton() {
  const localOwner = useOptionalLocalOwnerSession();
  if (localOwner === null) throw new Error("Missing local owner context");
  return (
    <button onClick={() => void localOwner.signOut()} type="button">
      Sign out
    </button>
  );
}

describe("local owner sign-out provider", () => {
  it("does not clear queries or navigate after stale logout of an older token", async () => {
    let deliverLogout!: (response: Response) => void;
    const logoutResponse = new Promise<Response>((resolve) => {
      deliverLogout = resolve;
    });
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(grant(firstToken))
      .mockReturnValueOnce(logoutResponse)
      .mockResolvedValueOnce(grant(secondToken));
    const session = new LocalOwnerBrowserSession(
      fetchImplementation,
      "http://127.0.0.1:4173",
    );
    await session.exchange(proof);
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, "clear");
    window.history.replaceState(null, "", "/settings/profile");
    render(
      <CloudMarkupQueryProvider
        client={{ request: vi.fn() } as unknown as CloudMarkupClient}
        queryClient={queryClient}
      >
        <RouterProvider>
          <LocalOwnerSessionProvider session={session}>
            <SignOutButton />
          </LocalOwnerSessionProvider>
        </RouterProvider>
      </CloudMarkupQueryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await session.exchange(proof);
    await act(async () => {
      deliverLogout(new Response(null, { status: 204 }));
      await logoutResponse;
    });
    expect(session.getValidAccessToken()).toBe(secondToken);
    expect(clear).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/settings/profile");
  });
});
