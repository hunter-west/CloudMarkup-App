export const COGNITO_SIGN_OUT_CHANNEL_NAME =
  "cloudmarkup-cognito-sign-out-v1" as const;

const signOutMessage = Object.freeze({
  kind: "cloudmarkup.cognito-sign-out",
  schemaVersion: 1,
} as const);

export interface CognitoSignOutBroadcastChannel {
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

export type CognitoSignOutBroadcastChannelFactory = (
  name: string,
) => CognitoSignOutBroadcastChannel | undefined;

export interface CognitoSignOutChannel {
  publish(): void;
  subscribe(listener: () => void): () => void;
}

function createBrowserBroadcastChannel(
  name: string,
): CognitoSignOutBroadcastChannel | undefined {
  return typeof BroadcastChannel === "undefined"
    ? undefined
    : new BroadcastChannel(name);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactSignOutMessage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === "kind" &&
    keys[1] === "schemaVersion" &&
    value["kind"] === signOutMessage.kind &&
    value["schemaVersion"] === signOutMessage.schemaVersion
  );
}

export function createCognitoSignOutChannel(
  createBroadcastChannel: CognitoSignOutBroadcastChannelFactory = createBrowserBroadcastChannel,
): CognitoSignOutChannel {
  const listeners = new Set<() => void>();
  let broadcastChannel: CognitoSignOutBroadcastChannel | undefined;

  const closeIfIdle = () => {
    if (listeners.size !== 0 || broadcastChannel === undefined) return;
    const channel = broadcastChannel;
    broadcastChannel = undefined;
    channel.onmessage = null;
    try {
      channel.close();
    } catch {
      // Closing a failed browser channel must not make local sign-out unsafe.
    }
  };

  const ensureChannel = (): CognitoSignOutBroadcastChannel | undefined => {
    if (broadcastChannel !== undefined) return broadcastChannel;
    let channel: CognitoSignOutBroadcastChannel | undefined;
    try {
      channel = createBroadcastChannel(COGNITO_SIGN_OUT_CHANNEL_NAME);
    } catch {
      return undefined;
    }
    if (channel === undefined) return undefined;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isExactSignOutMessage(event.data)) return;
      for (const listener of [...listeners]) listener();
    };
    broadcastChannel = channel;
    return channel;
  };

  return Object.freeze({
    publish() {
      const channel = ensureChannel();
      if (channel === undefined) return;
      try {
        channel.postMessage(signOutMessage);
      } finally {
        closeIfIdle();
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      ensureChannel();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        closeIfIdle();
      };
    },
  });
}

export const browserCognitoSignOutChannel = createCognitoSignOutChannel();
