import {
  ApiClientError,
  type CreditTopUpWorkspaceV1,
} from "@cloudmarkup/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudMarkupQueryRuntime } from "../../api/index.js";
import { CreditTopUpSection } from "./CreditTopUpSection.js";
function view(): CreditTopUpWorkspaceV1 {
  return {
    contractVersion: 1,
    organizationId: "org_purchase",
    asOf: "2026-09-30T12:00:00.000Z",
    mode: "stripe-sandbox",
    canPurchase: true,
    availableCreditUnits: "1250",
    latestPurchase: null,
    packs: [
      {
        key: "small",
        creditUnits: 100,
        priceMicros: "5000000",
        currency: "USD",
        expiration: "never",
      },
      {
        key: "medium",
        creditUnits: 350,
        priceMicros: "15000000",
        currency: "USD",
        expiration: "never",
      },
      {
        key: "large",
        creditUnits: 800,
        priceMicros: "30000000",
        currency: "USD",
        expiration: "never",
      },
    ],
  };
}
const hosted = (organizationId = "org_purchase") => ({
  data: {
    contractVersion: 1,
    organizationId,
    kind: "checkout",
    url: "https://checkout.stripe.com/c/pay/cs_test_purchase",
  },
});
function setup(
  options: {
    value?: CreditTopUpWorkspaceV1;
    action?: () => Promise<unknown>;
  } = {},
) {
  let current = options.value ?? view();
  const openHosted = vi.fn();
  const action = vi.fn(options.action ?? (() => Promise.resolve(hosted())));
  const request = vi.fn((operation: string) =>
    operation === "billing.top-ups.get"
      ? Promise.resolve({ data: current })
      : action(),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const runtime = {
    queryClient,
    client: { request },
  } as unknown as CloudMarkupQueryRuntime;
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <CreditTopUpSection
        runtime={runtime}
        principalId="principal_purchase"
        organizationId="org_purchase"
        authorizationScope="scope_purchase"
        disabled={false}
        openHosted={openHosted}
      />
    </QueryClientProvider>,
  );
  return {
    ...rendered,
    request,
    action,
    openHosted,
    queryClient,
    setValue: (value: CreditTopUpWorkspaceV1) => {
      current = value;
    },
  };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("account credit packs", () => {
  it("shows the approved packs and expiry distinction while purchase admission is closed", async () => {
    const f = setup({
      value: { ...view(), mode: "disabled", canPurchase: false },
    });
    const packs = await screen.findByRole("group", { name: "Credit packs" });
    for (const [credits, price] of [
      [100, "$5"],
      [350, "$15"],
      [800, "$30"],
    ] as const) {
      expect(
        within(packs).getByRole("heading", {
          name: String(credits) + " credits",
        }),
      ).toBeVisible();
      expect(within(packs).getByText(price)).toBeVisible();
      const button = within(packs).getByRole("button", {
        name: "Buy " + String(credits) + " credits",
      });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(
      screen.getByText(
        /Monthly credits expire at the end of the billing period/u,
      ),
    ).toBeVisible();
    expect(f.action).not.toHaveBeenCalled();
  });
  it("sends only the chosen pack and a stable retry key, suppressing duplicate clicks", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const f = setup({ action: () => pending });
    const buy = await screen.findByRole("button", { name: "Buy 350 credits" });
    fireEvent.click(buy);
    fireEvent.click(buy);
    expect(f.action).toHaveBeenCalledOnce();
    const call = f.request.mock.calls.find(
      ([operation]) => operation === "billing.top-ups.checkout.create",
    ) as unknown as [
      string,
      { body: unknown; path: unknown; headers: Record<string, string> },
    ];
    expect(call[1].body).toEqual({ contractVersion: 1, packKey: "medium" });
    expect(call[1].path).toEqual({ organizationId: "org_purchase" });
    expect(call[1].headers["idempotency-key"]).toMatch(/^topup-/u);
    await act(async () => {
      resolve(hosted());
      await pending;
    });
    await waitFor(() => {
      expect(f.openHosted).toHaveBeenCalledOnce();
    });
  });
  it("retains the same purchase retry key after an uncertain provider response", async () => {
    const f = setup({
      action: () =>
        Promise.reject(
          new ApiClientError(503, {
            apiVersion: "v1",
            error: {
              code: "service_unavailable",
              correlationId: "purchase_unavailable",
              message: "Unavailable",
            },
          }),
        ),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Buy 100 credits" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Buy 100 credits" }));
    await waitFor(() => {
      expect(f.action).toHaveBeenCalledTimes(2);
    });
    const calls = f.request.mock.calls.filter(
      ([operation]) => operation === "billing.top-ups.checkout.create",
    ) as unknown as [string, { headers: Record<string, string> }][];
    expect(calls[0]?.[1].headers["idempotency-key"]).toBe(
      calls[1]?.[1].headers["idempotency-key"],
    );
    expect(f.openHosted).not.toHaveBeenCalled();
  });
  it("shows verified balance and prevents a browser return from granting credits", async () => {
    const f = setup({
      value: {
        ...view(),
        availableCreditUnits: "1250",
        latestPurchase: {
          id: "topup_" + "a".repeat(32),
          packKey: "small",
          state: "created",
          needsReview: false,
        },
      },
    });
    await screen.findByText(/Payment has not been confirmed/u);
    expect(f.action).not.toHaveBeenCalled();
    expect(screen.getByText("1,250")).toBeVisible();
    f.setValue({
      ...view(),
      availableCreditUnits: "1350",
      latestPurchase: {
        id: "topup_" + "a".repeat(32),
        packKey: "small",
        state: "fulfilled",
        needsReview: false,
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh credit status" }),
    );
    await screen.findByText(
      "Payment verified. Your purchased credits are available.",
    );
    expect(screen.getByText("1,350")).toBeVisible();
    expect(f.action).not.toHaveBeenCalled();
  });
  it("does not navigate to a hosted URL for another account", async () => {
    const f = setup({ action: () => Promise.resolve(hosted("org_foreign")) });
    fireEvent.click(
      await screen.findByRole("button", { name: "Buy 800 credits" }),
    );
    await screen.findByRole("alert");
    expect(f.openHosted).not.toHaveBeenCalled();
  });
  it("discards a late checkout response after leaving the authorized account", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const f = setup({ action: () => pending });
    fireEvent.click(
      await screen.findByRole("button", { name: "Buy 100 credits" }),
    );
    f.unmount();
    await act(async () => {
      resolve(hosted());
      await pending;
    });
    expect(f.openHosted).not.toHaveBeenCalled();
  });
  it("keeps a reviewed payment distinct from successful fulfillment", async () => {
    setup({
      value: {
        ...view(),
        latestPurchase: {
          id: "topup_" + "a".repeat(32),
          packKey: "small",
          state: "fulfilled",
          needsReview: true,
        },
      },
    });
    await screen.findByText(/purchase needs billing review/u);
    expect(
      screen.queryByText(
        "Payment verified. Your purchased credits are available.",
      ),
    ).not.toBeInTheDocument();
  });
});
