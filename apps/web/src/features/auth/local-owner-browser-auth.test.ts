import { describe, expect, it, vi } from "vitest";

import {
  LocalOwnerBrowserSession,
  selectLocalOwnerAuthentication,
} from "./local-owner-browser-auth.js";

const origin = "http://127.0.0.1:4173";
const proof = "A".repeat(43);
const token = `cmlo1_${"B".repeat(43)}`;
const newerToken = `cmlo1_${"C".repeat(43)}`;

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

describe("local owner browser session", () => {
  it("keeps Cognito as the default and confines the opt-in mode to loopback", () => {
    expect(
      selectLocalOwnerAuthentication(
        undefined,
        "https://cloudmarkup.com",
        undefined,
        undefined,
      ),
    ).toBe(false);
    expect(
      selectLocalOwnerAuthentication("local-owner", origin, "/api", undefined),
    ).toBe(true);
    expect(() =>
      selectLocalOwnerAuthentication(
        "local-owner",
        "https://cloudmarkup.com",
        "/api",
        undefined,
      ),
    ).toThrow();
    expect(() =>
      selectLocalOwnerAuthentication(
        "local-owner",
        "http://localhost:4173",
        "/api",
        undefined,
      ),
    ).toThrow();
    expect(() =>
      selectLocalOwnerAuthentication(
        "local-owner",
        origin,
        "https://api.example.test",
        undefined,
      ),
    ).toThrow();
    expect(() =>
      selectLocalOwnerAuthentication(
        "local-owner",
        origin,
        "/api",
        "legacy-token",
      ),
    ).toThrow();
  });

  it("exchanges the proof with same-origin POST, holds only a memory token, and revokes it", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            accessToken: token,
            expiresAt: new Date(Date.now() + 28_800_000).toISOString(),
            expiresIn: 28_800,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const session = new LocalOwnerBrowserSession(fetchImplementation, origin);
    await session.exchange(proof);
    expect(session.getValidAccessToken()).toBe(token);
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "/auth/local-owner/v1/exchange",
      expect.objectContaining({
        body: JSON.stringify({ schemaVersion: 1, proof }),
        credentials: "same-origin",
        method: "POST",
        mode: "same-origin",
        redirect: "error",
      }),
    );
    await session.signOut();
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "/auth/local-owner/v1/logout",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchImplementation.mock.calls[1]?.[1]).toHaveProperty(
      "headers.authorization",
      `Bearer ${token}`,
    );
    expect(session.getValidAccessToken()).toBeUndefined();
  });

  it("does not accept an invalid proof or token response", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          accessToken: "hosted-token",
          expiresAt: new Date(Date.now() + 28_800_000).toISOString(),
          expiresIn: 28_800,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const session = new LocalOwnerBrowserSession(fetchImplementation, origin);
    await expect(session.exchange("short")).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
    await expect(session.exchange(proof)).rejects.toThrow();
    expect(session.getValidAccessToken()).toBeUndefined();
  });

  it("retains the token when server revocation is unconfirmed", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            accessToken: token,
            expiresAt: new Date(Date.now() + 28_800_000).toISOString(),
            expiresIn: 28_800,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const session = new LocalOwnerBrowserSession(fetchImplementation, origin);
    await session.exchange(proof);
    await expect(session.signOut()).rejects.toThrow();
    expect(session.getValidAccessToken()).toBe(token);
  });

  it("drops an expired memory token before any further API request", async () => {
    vi.useFakeTimers();
    try {
      const fetchImplementation = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            accessToken: token,
            expiresAt: new Date(Date.now() + 28_800_000).toISOString(),
            expiresIn: 28_800,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      const session = new LocalOwnerBrowserSession(fetchImplementation, origin);
      await session.exchange(proof);
      vi.advanceTimersByTime(28_800_001);
      expect(session.getValidAccessToken()).toBeUndefined();
      expect(fetchImplementation).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the 15-second deadline even when the caller supplies a signal", async () => {
    const timeout = new AbortController();
    const deadline = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    let deliver!: (value: Response) => void;
    const fetchImplementation = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        deliver = resolve;
      }),
    );
    try {
      const session = new LocalOwnerBrowserSession(fetchImplementation, origin);
      const caller = new AbortController();
      const exchange = session.exchange(proof, caller.signal);
      const requestSignal = (
        fetchImplementation.mock.calls[0]?.[1] as RequestInit
      ).signal;
      expect(requestSignal).not.toBe(caller.signal);
      expect(requestSignal?.aborted).toBe(false);
      timeout.abort();
      expect(requestSignal?.aborted).toBe(true);
      deliver(grant(token)); // Even a fetch mock that ignores abort cannot install it.
      await expect(exchange).rejects.toThrow();
      expect(session.getValidAccessToken()).toBeUndefined();
    } finally {
      deadline.mockRestore();
    }
  });

  it("coalesces duplicate logout and never clears a newer exchanged session", async () => {
    let deliverLogout!: (value: Response) => void;
    const logoutResponse = new Promise<Response>((resolve) => {
      deliverLogout = resolve;
    });
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(grant(token))
      .mockReturnValueOnce(logoutResponse)
      .mockResolvedValueOnce(grant(newerToken));
    const session = new LocalOwnerBrowserSession(fetchImplementation, origin);
    await session.exchange(proof);
    const first = session.signOut();
    const duplicate = session.signOut();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    await session.exchange(proof);
    expect(session.getValidAccessToken()).toBe(newerToken);
    deliverLogout(new Response(null, { status: 204 }));
    expect(await first).toBe(false);
    expect(await duplicate).toBe(false);
    expect(session.getValidAccessToken()).toBe(newerToken);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });
});
