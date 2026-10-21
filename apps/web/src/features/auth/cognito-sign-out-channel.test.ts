import { describe, expect, it, vi } from "vitest";

import {
  COGNITO_SIGN_OUT_CHANNEL_NAME,
  createCognitoSignOutChannel,
  type CognitoSignOutBroadcastChannel,
  type CognitoSignOutBroadcastChannelFactory,
} from "./cognito-sign-out-channel.js";

class TestBroadcastHub {
  public readonly channels: TestBroadcastChannel[] = [];
  public readonly messages: unknown[] = [];

  public readonly create: CognitoSignOutBroadcastChannelFactory = (name) => {
    const channel = new TestBroadcastChannel(this, name);
    this.channels.push(channel);
    return channel;
  };
}

class TestBroadcastChannel implements CognitoSignOutBroadcastChannel {
  public closed = false;
  public readonly name: string;
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly hub: TestBroadcastHub;

  public constructor(hub: TestBroadcastHub, name: string) {
    this.hub = hub;
    this.name = name;
  }

  public close(): void {
    this.closed = true;
    this.onmessage = null;
  }

  public postMessage(message: unknown): void {
    if (this.closed) throw new TypeError("The test channel is closed.");
    this.hub.messages.push(message);
    for (const channel of this.hub.channels) {
      if (channel === this || channel.closed || channel.name !== this.name) {
        continue;
      }
      queueMicrotask(() => {
        if (!channel.closed) {
          channel.onmessage?.({ data: message } as MessageEvent<unknown>);
        }
      });
    }
  }
}

async function flushBroadcasts(): Promise<void> {
  await Promise.resolve();
}

describe("Cognito cross-tab sign-out channel", () => {
  it("delivers one exact token-free message to another tab but not the sender", async () => {
    const hub = new TestBroadcastHub();
    const sender = createCognitoSignOutChannel(hub.create);
    const receiver = createCognitoSignOutChannel(hub.create);
    const senderListener = vi.fn();
    const receiverListener = vi.fn();
    sender.subscribe(senderListener);
    receiver.subscribe(receiverListener);

    sender.publish();
    await flushBroadcasts();

    expect(senderListener).not.toHaveBeenCalled();
    expect(receiverListener).toHaveBeenCalledOnce();
    expect(hub.channels.map((channel) => channel.name)).toEqual([
      COGNITO_SIGN_OUT_CHANNEL_NAME,
      COGNITO_SIGN_OUT_CHANNEL_NAME,
    ]);
    expect(hub.messages).toEqual([
      {
        kind: "cloudmarkup.cognito-sign-out",
        schemaVersion: 1,
      },
    ]);
    expect(Object.keys(hub.messages[0] as object).sort()).toEqual([
      "kind",
      "schemaVersion",
    ]);
    expect(JSON.stringify(hub.messages[0])).not.toMatch(
      /access|authorization|code|organization|principal|state|token|verifier/iu,
    );
  });

  it("ignores malformed, broadened, and wrong-version messages", async () => {
    const hub = new TestBroadcastHub();
    const receiver = createCognitoSignOutChannel(hub.create);
    const listener = vi.fn();
    receiver.subscribe(listener);
    const external = hub.create(COGNITO_SIGN_OUT_CHANNEL_NAME);
    if (external === undefined) throw new Error("The test channel is absent.");
    const invalidMessages: readonly unknown[] = [
      null,
      [],
      {},
      "cloudmarkup.cognito-sign-out",
      { kind: "cloudmarkup.cognito-sign-in", schemaVersion: 1 },
      { kind: "cloudmarkup.cognito-sign-out", schemaVersion: 2 },
      {
        accessToken: "must-not-be-accepted",
        kind: "cloudmarkup.cognito-sign-out",
        schemaVersion: 1,
      },
    ];

    for (const message of invalidMessages) external.postMessage(message);
    await flushBroadcasts();
    expect(listener).not.toHaveBeenCalled();

    external.postMessage({
      kind: "cloudmarkup.cognito-sign-out",
      schemaVersion: 1,
    });
    await flushBroadcasts();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("removes the listener and closes its browser channel on cleanup", async () => {
    const hub = new TestBroadcastHub();
    const receiver = createCognitoSignOutChannel(hub.create);
    const listener = vi.fn();
    const unsubscribe = receiver.subscribe(listener);
    const receiverChannel = hub.channels[0];
    if (receiverChannel === undefined) {
      throw new Error("The receiving test channel is absent.");
    }

    unsubscribe();
    unsubscribe();
    expect(receiverChannel.closed).toBe(true);

    const external = hub.create(COGNITO_SIGN_OUT_CHANNEL_NAME);
    external?.postMessage({
      kind: "cloudmarkup.cognito-sign-out",
      schemaVersion: 1,
    });
    await flushBroadcasts();
    expect(listener).not.toHaveBeenCalled();
  });
});
