import {
  gitLabLinkCallbackSchema,
  type GitLabLinkCallback,
} from "./gitlab-link-callback.js";

interface RelayChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
}
export type GitLabLinkChannelFactory = (name: string) => RelayChannel;
const callbackKind = "cloudmarkup.gitlab-link.callback";
const acknowledgmentKind = "cloudmarkup.gitlab-link.acknowledgment";
function browserChannel(name: string): RelayChannel {
  if (typeof BroadcastChannel === "undefined")
    throw new Error(
      "Cross-tab GitLab connection is unavailable in this browser.",
    );
  return new BroadcastChannel(name);
}
function channelName(state: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(state))
    throw new Error("Invalid GitLab connection state.");
  return "cloudmarkup-gitlab-link-v1:" + state;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only the initiating authenticated tab adds its intent and submits completion. */
export function subscribeToGitLabLinkCallback(
  input: {
    readonly state: string;
    readonly expiresAt: string;
    readonly onCallback: (callback: GitLabLinkCallback) => Promise<unknown>;
  },
  createChannel: GitLabLinkChannelFactory = browserChannel,
): () => void {
  const { state, onCallback } = input;
  const expiresAt = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 630_000
  )
    throw new Error("The GitLab connection attempt has expired.");
  const channel = createChannel(channelName(state));
  let active = true;
  let processing = false;
  const close = () => {
    if (!active) return;
    active = false;
    clearTimeout(expiryTimer);
    channel.onmessage = null;
    channel.close();
  };
  const expiryTimer = setTimeout(close, Math.max(0, expiresAt - Date.now()));
  const acknowledge = (succeeded: boolean) => {
    if (!active) return;
    try {
      channel.postMessage({
        contractVersion: 1,
        state,
        kind: acknowledgmentKind,
        succeeded,
      });
    } catch {
      /* A failed relay does not change the server result. */
    } finally {
      close();
    }
  };
  channel.onmessage = (event) => {
    const message = record(event.data);
    if (
      !active ||
      processing ||
      Date.now() >= expiresAt ||
      !message ||
      Object.keys(message).length !== 3 ||
      message["contractVersion"] !== 1 ||
      message["kind"] !== callbackKind
    )
      return;
    const parsed = gitLabLinkCallbackSchema.safeParse(message["callback"]);
    if (!parsed.success || parsed.data.state !== state) return;
    processing = true;
    void Promise.resolve()
      .then(() => onCallback(parsed.data))
      .then(
        () => {
          acknowledge(true);
        },
        () => {
          acknowledge(false);
        },
      );
  };
  return close;
}

/** Same-origin memory channel only: no local/session storage, opener or callback requests. */
export function relayGitLabLinkCallback(
  callback: GitLabLinkCallback,
  options: {
    readonly signal?: AbortSignal;
    readonly createChannel?: GitLabLinkChannelFactory;
  } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const parsed = gitLabLinkCallbackSchema.safeParse(callback);
    if (!parsed.success || options.signal?.aborted === true) {
      reject(new Error("The GitLab callback is unavailable."));
      return;
    }
    const channel = (options.createChannel ?? browserChannel)(
      channelName(parsed.data.state),
    );
    let settled = false;
    const finish = (succeeded: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(retryTimer);
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      channel.onmessage = null;
      channel.close();
      if (succeeded) resolve();
      else
        reject(
          new Error(
            "Return to the original CloudMarkup tab and reload your GitLab connection status.",
          ),
        );
    };
    const abort = () => {
      finish(false);
    };
    const publish = () => {
      try {
        channel.postMessage({
          callback: parsed.data,
          contractVersion: 1,
          kind: callbackKind,
        });
      } catch {
        finish(false);
      }
    };
    channel.onmessage = (event) => {
      const message = record(event.data);
      if (
        !message ||
        Object.keys(message).length !== 4 ||
        message["contractVersion"] !== 1 ||
        message["kind"] !== acknowledgmentKind ||
        message["state"] !== parsed.data.state ||
        typeof message["succeeded"] !== "boolean"
      )
        return;
      finish(message["succeeded"]);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const retryTimer = setInterval(publish, 250);
    const timeout = setTimeout(() => {
      finish(false);
    }, 15_000);
    publish();
  });
}
