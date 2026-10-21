import {
  completeGithubAppInstallationLinkV1Schema,
  githubInstallationLinkIntentIdSchema,
  type CompleteGithubAppInstallationLinkV1,
} from "@cloudmarkup/api-contract";

interface RelayChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
}

export type GitHubLinkChannelFactory = (name: string) => RelayChannel;

const callbackKind = "cloudmarkup.github-installation-link.callback";
const acknowledgmentKind =
  "cloudmarkup.github-installation-link.acknowledgment";

function browserChannel(name: string): RelayChannel {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error(
      "Cross-tab GitHub connection is unavailable in this browser.",
    );
  }
  return new BroadcastChannel(name);
}

function channelName(intentId: string): string {
  return (
    "cloudmarkup-github-installation-link-v1:" +
    githubInstallationLinkIntentIdSchema.parse(intentId)
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only the still-authenticated initiating tab may submit its pending intent. */
export function subscribeToGitHubInstallationLinkCallback(
  input: {
    readonly intentId: string;
    readonly expiresAt: string;
    readonly onCallback: (
      callback: CompleteGithubAppInstallationLinkV1,
    ) => Promise<unknown>;
  },
  createChannel: GitHubLinkChannelFactory = browserChannel,
): () => void {
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("The GitHub connection attempt has expired.");
  }
  const channel = createChannel(channelName(input.intentId));
  let active = true;
  let processing = false;
  const close = () => {
    if (!active) return;
    active = false;
    channel.onmessage = null;
    channel.close();
  };
  const acknowledge = (succeeded: boolean) => {
    if (!active) return;
    try {
      channel.postMessage({
        contractVersion: 1,
        intentId: input.intentId,
        kind: acknowledgmentKind,
        succeeded,
      });
    } catch {
      // A failed relay never changes the verified server completion result.
    } finally {
      close();
    }
  };
  channel.onmessage = (event) => {
    const message = record(event.data);
    if (
      !active ||
      Date.now() >= expiresAt ||
      message === undefined ||
      Object.keys(message).length !== 3 ||
      message["contractVersion"] !== 1 ||
      message["kind"] !== callbackKind
    )
      return;
    const parsed = completeGithubAppInstallationLinkV1Schema.safeParse(
      message["callback"],
    );
    if (!parsed.success || parsed.data.intentId !== input.intentId) return;
    if (processing) return;
    processing = true;
    void Promise.resolve()
      .then(() => input.onCallback(parsed.data))
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

/** Relay proof in memory over the same-origin channel, never via storage. */
export function relayGitHubInstallationLinkCallback(
  callback: CompleteGithubAppInstallationLinkV1,
  options: {
    readonly signal?: AbortSignal;
    readonly createChannel?: GitHubLinkChannelFactory;
  } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const parsed =
      completeGithubAppInstallationLinkV1Schema.safeParse(callback);
    if (!parsed.success || options.signal?.aborted === true) {
      reject(new Error("The GitHub callback is unavailable."));
      return;
    }
    const channel = (options.createChannel ?? browserChannel)(
      channelName(parsed.data.intentId),
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
            "Return to the original CloudMarkup tab and start a new GitHub connection.",
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
        message === undefined ||
        Object.keys(message).length !== 4 ||
        message["contractVersion"] !== 1 ||
        message["kind"] !== acknowledgmentKind ||
        message["intentId"] !== parsed.data.intentId ||
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
