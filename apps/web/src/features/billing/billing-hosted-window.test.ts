import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeBillingWindowReturn,
  HostedBillingWindowError,
  openBillingWindow,
  readBillingWindowReturn,
} from "./billing-hosted-window.js";

const key = "cloudmarkup.billing-window.v1";
class TestChannel {
  static instances: TestChannel[] = [];
  readonly name: string;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly close = vi.fn(() => {
    this.onmessage = null;
  });
  readonly postMessage = vi.fn((data: unknown) => {
    for (const target of TestChannel.instances)
      if (target !== this && target.name === this.name)
        queueMicrotask(() => {
          target.onmessage?.({ data } as MessageEvent<unknown>);
        });
  });
  constructor(name: string) {
    this.name = name;
    TestChannel.instances.push(this);
  }
}
function fixture() {
  vi.useFakeTimers();
  TestChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", TestChannel);
  const popup = {
    opener: window,
    sessionStorage: window.sessionStorage,
    document: { title: "", body: { textContent: "" } },
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  return popup;
}
afterEach(() => {
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isolated hosted billing window", () => {
  it("preserves the original location and isolates the window before Stripe navigation", () => {
    const popup = fixture();
    const original = window.location.href;
    const onReturn = vi.fn();
    const target = openBillingWindow(onReturn);
    expect(popup.opener).toBeNull();
    expect(readBillingWindowReturn()).toMatch(/^[a-f0-9-]{36}$/u);
    const raw = window.sessionStorage.getItem(key);
    expect(raw).not.toContain("token");
    target.navigate("https://checkout.stripe.com/c/pay/cs_test_fixture");
    expect(popup.location.replace).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/pay/cs_test_fixture",
    );
    expect(window.location.href).toBe(original);
    expect(onReturn).not.toHaveBeenCalled();
    target.close();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("fails before a request when a billing window is blocked", () => {
    fixture();
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(() => openBillingWindow(vi.fn())).toThrow(HostedBillingWindowError);
    expect(TestChannel.instances).toHaveLength(0);
  });

  it("closes the reserved window when browser storage is unavailable", () => {
    const popup = fixture();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("Blocked");
    });
    expect(() => openBillingWindow(vi.fn())).toThrow(HostedBillingWindowError);
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it.each([
    "https://checkout.stripe.com.attacker.test/pay",
    "https://attacker.test/",
    "http://checkout.stripe.com/",
    "https://user:pass@billing.stripe.com/",
    "https://billing.stripe.com:444/",
  ])("rejects an unapproved destination %s", (url) => {
    const popup = fixture();
    const target = openBillingWindow(vi.fn());
    expect(() => {
      target.navigate(url);
    }).toThrow(HostedBillingWindowError);
    expect(popup.location.replace).not.toHaveBeenCalled();
    target.close();
  });

  it("returns through an exact token-free channel and closes only the billing window", async () => {
    fixture();
    const original = window.location.href;
    const onReturn = vi.fn();
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    openBillingWindow(onReturn);
    const id = readBillingWindowReturn();
    if (id === null) throw Error("Missing return marker");
    const parent = TestChannel.instances[0];
    parent?.onmessage?.({
      data: { type: "paid", subscription: "untrusted" },
    } as MessageEvent<unknown>);
    expect(onReturn).not.toHaveBeenCalled();
    const dispose = completeBillingWindowReturn(id);
    await Promise.resolve();
    await Promise.resolve();
    expect(onReturn).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(readBillingWindowReturn()).toBeNull();
    expect(window.location.href).toBe(original);
    expect(
      TestChannel.instances[1]?.postMessage,
    ).toHaveBeenCalledExactlyOnceWith("returned");
    expect(parent?.postMessage).toHaveBeenCalledExactlyOnceWith("acknowledged");
    dispose();
  });

  it.each([
    "malformed",
    JSON.stringify({ id: "invalid", createdAt: 1 }),
    JSON.stringify({
      id: "12345678-1234-1234-1234-123456789012",
      createdAt: 0,
    }),
    JSON.stringify({
      id: "12345678-1234-1234-1234-123456789012",
      createdAt: 9e15,
    }),
    JSON.stringify({
      id: "12345678-1234-1234-1234-123456789012",
      createdAt: Date.now(),
      token: "never-accepted",
    }),
  ])("ignores an invalid or expired navigation marker %#", (raw) => {
    window.sessionStorage.setItem(key, raw);
    expect(readBillingWindowReturn()).toBeNull();
  });
});
