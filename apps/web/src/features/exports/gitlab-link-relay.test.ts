import { afterEach, describe, expect, it, vi } from "vitest";
import {
  relayGitLabLinkCallback,
  subscribeToGitLabLinkCallback,
  type GitLabLinkChannelFactory,
} from "./gitlab-link-relay.js";

const callback = {
  state: "s".repeat(43),
  code: "a".repeat(48),
} as const;
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();
function harness() {
  type Channel = ReturnType<GitLabLinkChannelFactory>;
  const channels = new Map<string, Set<Channel>>();
  const messages: unknown[] = [];
  const createChannel: GitLabLinkChannelFactory = (name) => {
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

describe("ephemeral GitLab installation linking relay", () => {
  it("completes only through the exact initiating intent and closes both channels", async () => {
    const channel = harness();
    const onCallback = vi.fn(() => Promise.resolve());
    const stop = subscribeToGitLabLinkCallback(
      { state: callback.state, expiresAt: expiresAt(), onCallback },
      channel.createChannel,
    );
    await relayGitLabLinkCallback(callback, {
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
    subscribeToGitLabLinkCallback(
      { state: callback.state, expiresAt: expiresAt(), onCallback },
      channel.createChannel,
    );
    let succeeded = false;
    const relay = relayGitLabLinkCallback(callback, {
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
    subscribeToGitLabLinkCallback(
      {
        state: callback.state,
        expiresAt: expiresAt(),
        onCallback: () => Promise.reject(new Error("sensitive backend detail")),
      },
      channel.createChannel,
    );
    await expect(
      relayGitLabLinkCallback(callback, {
        createChannel: channel.createChannel,
      }),
    ).rejects.toThrow("Return to the original");
    expect(JSON.stringify(channel.messages)).not.toContain(
      "sensitive backend detail",
    );
    expect(channel.openCount()).toBe(0);
  });

  it("rejects expired subscriptions and malformed callbacks before opening a channel", async () => {
    const createChannel = vi.fn<GitLabLinkChannelFactory>();
    expect(() =>
      subscribeToGitLabLinkCallback(
        {
          state: callback.state,
          expiresAt: new Date(0).toISOString(),
          onCallback: () => Promise.resolve(),
        },
        createChannel,
      ),
    ).toThrow("expired");
    await expect(
      relayGitLabLinkCallback(
        { ...callback, code: "short" },
        { createChannel },
      ),
    ).rejects.toThrow();
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("times out safely when the originating tab is closed or a different intent is pending", async () => {
    vi.useFakeTimers();
    const channel = harness();
    const onCallback = vi.fn(() => Promise.resolve());
    const stop = subscribeToGitLabLinkCallback(
      { state: "x".repeat(43), expiresAt: expiresAt(), onCallback },
      channel.createChannel,
    );
    const outcome = relayGitLabLinkCallback(callback, {
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
    const outcome = relayGitLabLinkCallback(callback, {
      createChannel: channel.createChannel,
      signal: controller.signal,
    });
    controller.abort();
    await expect(outcome).rejects.toThrow();
    expect(channel.openCount()).toBe(0);
  });
  it("ignores duplicate publications while one server completion is pending", async () => {
    vi.useFakeTimers();
    const channel = harness();
    let finish: () => void = () => undefined;
    const onCallback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    subscribeToGitLabLinkCallback(
      { state: callback.state, expiresAt: expiresAt(), onCallback },
      channel.createChannel,
    );
    const relay = relayGitLabLinkCallback(callback, {
      createChannel: channel.createChannel,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onCallback).toHaveBeenCalledOnce();
    finish();
    await relay;
    expect(channel.openCount()).toBe(0);
  });
  it("ignores malformed and mismatched state messages on the pending channel", async () => {
    const channel = harness();
    const onCallback = vi.fn(() => Promise.resolve());
    const stop = subscribeToGitLabLinkCallback(
      { state: callback.state, expiresAt: expiresAt(), onCallback },
      channel.createChannel,
    );
    const sender = channel.createChannel(
      "cloudmarkup-gitlab-link-v1:" + callback.state,
    );
    for (const value of [
      {
        contractVersion: 1,
        kind: "cloudmarkup.gitlab-link.callback",
        callback: { ...callback, state: "x".repeat(43) },
      },
      {
        contractVersion: 1,
        kind: "cloudmarkup.gitlab-link.callback",
        callback: { ...callback, code: "short" },
      },
      {
        contractVersion: 1,
        kind: "cloudmarkup.gitlab-link.callback",
        callback,
        extra: true,
      },
    ])
      sender.postMessage(value);
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(onCallback).not.toHaveBeenCalled();
    stop();
    sender.close();
    expect(channel.openCount()).toBe(0);
  });
  it("automatically closes abandoned subscriptions at expiry", async () => {
    vi.useFakeTimers();
    const channel = harness();
    const onCallback = vi.fn(() => Promise.resolve());
    subscribeToGitLabLinkCallback(
      {
        state: callback.state,
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        onCallback,
      },
      channel.createChannel,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(channel.openCount()).toBe(0);
    expect(onCallback).not.toHaveBeenCalled();
  });
  it("allows a small browser clock difference without accepting an unbounded lifetime", () => {
    const channel = harness();
    const stop = subscribeToGitLabLinkCallback(
      {
        state: callback.state,
        expiresAt: new Date(Date.now() + 601000).toISOString(),
        onCallback: () => Promise.resolve(),
      },
      channel.createChannel,
    );
    stop();
    expect(() =>
      subscribeToGitLabLinkCallback(
        {
          state: callback.state,
          expiresAt: new Date(Date.now() + 631000).toISOString(),
          onCallback: () => Promise.resolve(),
        },
        channel.createChannel,
      ),
    ).toThrow();
    expect(channel.openCount()).toBe(0);
  });
});
