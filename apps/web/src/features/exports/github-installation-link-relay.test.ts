import { afterEach, describe, expect, it, vi } from "vitest";
import {
  relayGitHubInstallationLinkCallback,
  subscribeToGitHubInstallationLinkCallback,
  type GitHubLinkChannelFactory,
} from "./github-installation-link-relay.js";

const callback = {
  contractVersion: 1,
  intentId: "githublink_synthetic",
  callbackReceipt: "a".repeat(48),
} as const;
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();
function harness() {
  type Channel = ReturnType<GitHubLinkChannelFactory>;
  const channels = new Map<string, Set<Channel>>();
  const messages: unknown[] = [];
  const createChannel: GitHubLinkChannelFactory = (name) => {
    const channel: Channel = {
      onmessage: null,
      postMessage(value) {
        messages.push(value);
        for (const target of channels.get(name) ?? []) {
          if (target !== channel)
            queueMicrotask(() =>
              target.onmessage?.({
                data: structuredClone(value),
              } as MessageEvent<unknown>),
            );
        }
      },
      close() {
        channels.get(name)?.delete(channel);
      },
    };
    const peers = channels.get(name) ?? new Set<Channel>();
    peers.add(channel);
    channels.set(name, peers);
    return channel;
  };
  return {
    createChannel,
    messages,
    openCount: () =>
      [...channels.values()].reduce((sum, peers) => sum + peers.size, 0),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ephemeral GitHub installation linking relay", () => {
  it("completes only through the exact initiating intent and closes both channels", async () => {
    const channel = harness();
    const onCallback = vi.fn(() => Promise.resolve());
    const stop = subscribeToGitHubInstallationLinkCallback(
      { intentId: callback.intentId, expiresAt: expiresAt(), onCallback },
      channel.createChannel,
    );
    await relayGitHubInstallationLinkCallback(callback, {
      createChannel: channel.createChannel,
    });
    expect(onCallback).toHaveBeenCalledExactlyOnceWith(callback);
    expect(channel.openCount()).toBe(0);
    stop();
  });

  it("does not report success before the backend completion promise resolves", async () => {
    const channel = harness();
    let complete: () => void = () => undefined;
    const onCallback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    subscribeToGitHubInstallationLinkCallback(
      { intentId: callback.intentId, expiresAt: expiresAt(), onCallback },
      channel.createChannel,
    );
    let succeeded = false;
    const relay = relayGitHubInstallationLinkCallback(callback, {
      createChannel: channel.createChannel,
    }).then(() => {
      succeeded = true;
    });
    await vi.waitFor(() => {
      expect(onCallback).toHaveBeenCalledOnce();
    });
    expect(succeeded).toBe(false);
    complete();
    await relay;
    expect(succeeded).toBe(true);
  });

  it("reports a server rejection without exposing its details", async () => {
    const channel = harness();
    subscribeToGitHubInstallationLinkCallback(
      {
        intentId: callback.intentId,
        expiresAt: expiresAt(),
        onCallback: () => Promise.reject(new Error("sensitive backend detail")),
      },
      channel.createChannel,
    );
    await expect(
      relayGitHubInstallationLinkCallback(callback, {
        createChannel: channel.createChannel,
      }),
    ).rejects.toThrow("Return to the original");
    expect(JSON.stringify(channel.messages)).not.toContain(
      "sensitive backend detail",
    );
    expect(channel.openCount()).toBe(0);
  });

  it("rejects expired subscriptions and malformed callbacks before opening a channel", async () => {
    const createChannel = vi.fn<GitHubLinkChannelFactory>();
    expect(() =>
      subscribeToGitHubInstallationLinkCallback(
        {
          intentId: callback.intentId,
          expiresAt: new Date(0).toISOString(),
          onCallback: () => Promise.resolve(),
        },
        createChannel,
      ),
    ).toThrow("expired");
    await expect(
      relayGitHubInstallationLinkCallback(
        { ...callback, callbackReceipt: "short" },
        { createChannel },
      ),
    ).rejects.toThrow();
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("times out safely when the originating tab is closed or a different intent is pending", async () => {
    vi.useFakeTimers();
    const channel = harness();
    const onCallback = vi.fn(() => Promise.resolve());
    const stop = subscribeToGitHubInstallationLinkCallback(
      { intentId: "githublink_other", expiresAt: expiresAt(), onCallback },
      channel.createChannel,
    );
    const outcome = relayGitHubInstallationLinkCallback(callback, {
      createChannel: channel.createChannel,
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(onCallback).not.toHaveBeenCalled();
    stop();
    expect(channel.openCount()).toBe(0);
  });

  it("cancels a callback tab without leaving timers or channels open", async () => {
    const channel = harness();
    const controller = new AbortController();
    const outcome = relayGitHubInstallationLinkCallback(callback, {
      createChannel: channel.createChannel,
      signal: controller.signal,
    });
    controller.abort();
    await expect(outcome).rejects.toThrow();
    expect(channel.openCount()).toBe(0);
  });
});
