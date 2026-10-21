const markerKey = "cloudmarkup.billing-window.v1";
const channelPrefix = "cloudmarkup.billing-return.v1.";
const maximumWindowAge = 8 * 60 * 60 * 1_000;

export interface HostedBillingWindow {
  navigate(url: string): void;
  close(): void;
}

export class HostedBillingWindowError extends Error {
  constructor() {
    super("Allow the billing window in your browser, then try again.");
    this.name = "HostedBillingWindowError";
  }
}

/** Non-credential navigation marker. It authorizes no API or billing action. */
export function readBillingWindowReturn(): string | null {
  try {
    const raw = window.sessionStorage.getItem(markerKey);
    if (raw === null || raw.length > 256) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const fields = value as Record<string, unknown>;
    const now = Date.now();
    return Object.keys(fields).length === 2 &&
      typeof fields["id"] === "string" &&
      /^[a-f0-9-]{36}$/u.test(fields["id"]) &&
      typeof fields["createdAt"] === "number" &&
      fields["createdAt"] <= now &&
      now - fields["createdAt"] <= maximumWindowAge
      ? fields["id"]
      : null;
  } catch {
    return null;
  }
}

/** Must run synchronously inside the user's click, before any network await. */
export function openBillingWindow(onReturn: () => void): HostedBillingWindow {
  const popup = window.open(
    "",
    "_blank",
    "popup,width=720,height=820,resizable=yes,scrollbars=yes",
  );
  if (popup === null) throw new HostedBillingWindowError();
  let channel: BroadcastChannel;
  const id = crypto.randomUUID();
  try {
    popup.opener = null;
    popup.sessionStorage.setItem(
      markerKey,
      JSON.stringify({ id, createdAt: Date.now() }),
    );
    popup.document.title = "Opening billing";
    popup.document.body.textContent = "Opening secure billing…";
    channel = new BroadcastChannel(channelPrefix + id);
  } catch {
    popup.close();
    throw new HostedBillingWindowError();
  }
  const timer = window.setTimeout(() => {
    channel.close();
  }, maximumWindowAge);
  const dispose = () => {
    window.clearTimeout(timer);
    channel.close();
  };
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data !== "returned") return;
    // This notification only refreshes authenticated server state. It carries
    // no token, tenant, subscription or payment claim.
    channel.postMessage("acknowledged");
    dispose();
    onReturn();
  };
  return {
    navigate(url) {
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(
          parsed.hostname,
        ) ||
        parsed.port !== "" ||
        parsed.username !== "" ||
        parsed.password !== ""
      )
        throw new HostedBillingWindowError();
      popup.location.replace(parsed.href);
    },
    close() {
      dispose();
      popup.close();
    },
  };
}

export function completeBillingWindowReturn(id: string): () => void {
  const channel = new BroadcastChannel(channelPrefix + id);
  window.sessionStorage.removeItem(markerKey);
  const close = () => {
    window.close();
  };
  const timer = window.setTimeout(close, 1_000);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data === "acknowledged") close();
  };
  channel.postMessage("returned");
  return () => {
    window.clearTimeout(timer);
    channel.close();
  };
}
