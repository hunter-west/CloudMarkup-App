import {
  ApiClientError,
  type BillingWorkspaceV1,
  type CurrentPrincipalV1,
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

import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { BillingWorkspacePage } from "./BillingWorkspacePage.js";

const principal: CurrentPrincipalV1 = {
  id: "principal_billing",
  displayName: "Billing owner",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId: "org_billing",
      membershipId: "membership_billing",
      capabilities: ["billing.manage", "commercial.summary.read"],
      role: "owner",
      isOwner: true,
    },
    {
      organizationId: "org_other",
      membershipId: "membership_other",
      capabilities: ["billing.manage", "commercial.summary.read"],
      role: "owner",
      isOwner: true,
    },
  ],
};

function workspace(organizationId = "org_billing"): BillingWorkspaceV1 {
  return {
    contractVersion: 1,
    organizationId,
    asOf: "2026-09-05T12:00:00.000Z",
    mode: "stripe-sandbox",
    accountState: "active",
    subscriptionState: "not-subscribed",
    currentPlanKey: null,
    canCheckout: true,
    canManage: false,
    plans: [
      {
        key: "starter",
        displayName: "Starter",
        currency: "USD",
        monthlyPriceMicros: "15000000",
        monthlyCreditUnits: 100,
      },
      {
        key: "pro",
        displayName: "Professional",
        currency: "USD",
        monthlyPriceMicros: "49000000",
        monthlyCreditUnits: 500,
      },
    ],
  };
}

function topUps(organizationId = "org_billing") {
  return {
    data: {
      contractVersion: 1,
      organizationId,
      asOf: "2026-09-30T12:00:00.000Z",
      mode: "disabled",
      canPurchase: false,
      availableCreditUnits: "0",
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
    },
  };
}

function hosted(
  organizationId = "org_billing",
  kind: "checkout" | "portal" = "checkout",
) {
  return {
    data: {
      contractVersion: 1,
      organizationId,
      kind,
      url:
        kind === "checkout"
          ? "https://checkout.stripe.com/c/pay/cs_test_fixture"
          : "https://billing.stripe.com/p/session/test_fixture",
    },
  };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function checkoutConflict() {
  return new ApiClientError(409, {
    apiVersion: "v1",
    error: {
      code: "conflict",
      correlationId: "billing_conflict",
      message: "Synthetic guarded attempt conflict.",
    },
  });
}

function renderBilling(
  options: {
    readonly value?: BillingWorkspaceV1;
    readonly action?: () => Promise<unknown>;
  } = {},
) {
  const action = vi.fn(options.action ?? (() => Promise.resolve(hosted())));
  const request = vi.fn(
    (
      operation: string,
      input: {
        readonly path: { readonly organizationId: string };
        readonly headers?: Readonly<Record<string, string>>;
        readonly body?: unknown;
      },
    ) => {
      if (operation === "billing.top-ups.get")
        return Promise.resolve(topUps(input.path.organizationId));
      if (operation === "billing.workspace.get")
        return Promise.resolve({
          data: options.value ?? workspace(input.path.organizationId),
        });
      return action();
    },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const runtime = {
    client: { request },
    queryClient,
  } as unknown as CloudMarkupQueryRuntime;
  const openHosted = vi.fn();
  const content = (
    organizationId = "org_billing",
    selectedPrincipal = principal,
  ) => (
    <QueryClientProvider client={queryClient}>
      <RouterProvider>
        <BillingWorkspacePage
          organizationId={organizationId}
          principal={selectedPrincipal}
          runtime={runtime}
          openHosted={openHosted}
        />
      </RouterProvider>
    </QueryClientProvider>
  );
  const view = render(content());
  return {
    ...view,
    action,
    request,
    openHosted,
    queryClient,
    changeScope: (organizationId: string, selectedPrincipal = principal) => {
      view.rerender(content(organizationId, selectedPrincipal));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("hosted billing workspace", () => {
  it("shows readable plan previews without offering unavailable hosted actions", async () => {
    const view = renderBilling({
      value: { ...workspace(), mode: "disabled", canCheckout: false },
    });
    const plans = await screen.findByRole("group", { name: "Monthly plans" });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Monthly plans", level: 2 }),
    ).toBeVisible();
    expect(
      within(plans).getByRole("heading", { name: "Starter", level: 3 }),
    ).toBeVisible();
    const checkout = within(plans).getByRole("button", {
      name: "Continue with Starter",
    });
    expect(checkout).toBeDisabled();
    fireEvent.click(checkout);
    expect(view.action).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Manage billing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Sandbox Checkout and subscription management are still being connected/u,
      ),
    ).toBeVisible();
  });

  it("opens only a bound hosted Checkout and suppresses duplicate clicks", async () => {
    const response = deferred();
    const view = renderBilling({ action: () => response.promise });
    const checkout = await screen.findByRole("button", {
      name: "Continue with Starter",
    });
    expect(
      screen.getByText("Choose a plan below to continue to secure Checkout."),
    ).toBeVisible();
    fireEvent.click(checkout);
    fireEvent.click(checkout);
    expect(view.action).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Continue with Professional" }),
    ).toBeDisabled();
    expect(view.request).toHaveBeenCalledWith("billing.checkout.create", {
      path: { organizationId: "org_billing" },
      body: { contractVersion: 1, planKey: "starter" },
      headers: {
        "idempotency-key": expect.stringMatching(/^billing-/u) as unknown,
      },
    });
    await act(async () => {
      response.resolve(hosted());
      await response.promise;
    });
    expect(view.openHosted).toHaveBeenCalledExactlyOnceWith(hosted().data.url);
    expect(
      screen.getByRole("heading", { name: "Not subscribed" }),
    ).toBeVisible();
  });

  it("uses the hosted Portal for an existing subscription", async () => {
    const view = renderBilling({
      value: {
        ...workspace(),
        subscriptionState: "active",
        currentPlanKey: "pro",
        canCheckout: false,
        canManage: true,
      },
      action: () => Promise.resolve(hosted("org_billing", "portal")),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Manage billing" }),
    );
    await waitFor(() => {
      expect(view.openHosted).toHaveBeenCalledExactlyOnceWith(
        hosted("org_billing", "portal").data.url,
      );
    });
    expect(view.request).toHaveBeenCalledWith("billing.portal.create", {
      path: { organizationId: "org_billing" },
      body: { contractVersion: 1 },
      headers: { "idempotency-key": expect.any(String) as unknown },
    });
    expect(screen.getByRole("button", { name: "Current plan" })).toBeDisabled();
  });

  it.each(["stripe-live"] as const)(
    "reports a Portal failure in %s without contradicting the current subscription",
    async (mode) => {
      renderBilling({
        value: {
          ...workspace(),
          mode,
          subscriptionState: "active",
          currentPlanKey: "pro",
          canCheckout: false,
          canManage: true,
        },
        action: () =>
          Promise.reject(
            new ApiClientError(503, {
              apiVersion: "v1",
              error: {
                code: "service_unavailable",
                correlationId: "billing_failure",
                message: "Synthetic unavailable provider.",
              },
            }),
          ),
      });
      fireEvent.click(
        await screen.findByRole("button", { name: "Manage billing" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Billing is temporarily unavailable. No billing change has been confirmed. Refresh billing status before retrying a pending action.",
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("Sandbox");
      expect(
        screen.getByRole("region", { name: "Current subscription" }),
      ).toHaveTextContent("Professional");
      expect(
        screen.queryByText(/Your subscription has not been confirmed/u),
      ).not.toBeInTheDocument();
    },
  );

  it("does not redirect a user who left Billing while Checkout was pending", async () => {
    const response = deferred();
    const view = renderBilling({ action: () => response.promise });
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Starter" }),
    );
    view.unmount();
    await act(async () => {
      response.resolve(hosted());
      await response.promise;
    });
    expect(view.openHosted).not.toHaveBeenCalled();
  });

  it.each(["organization", "principal", "permissions"] as const)(
    "discards a pending response after the %s scope changes",
    async (change) => {
      const response = deferred();
      const view = renderBilling({ action: () => response.promise });
      fireEvent.click(
        await screen.findByRole("button", { name: "Continue with Starter" }),
      );
      view.changeScope(
        change === "organization" ? "org_other" : "org_billing",
        {
          ...principal,
          ...(change === "principal" ? { id: "principal_other" } : {}),
          ...(change === "permissions"
            ? {
                organizationContexts: principal.organizationContexts.map(
                  (context) => ({
                    ...context,
                    capabilities: context.capabilities.filter(
                      (capability) => capability !== "billing.manage",
                    ),
                  }),
                ),
              }
            : {}),
        },
      );
      expect(
        await screen.findByRole("button", { name: "Continue with Starter" }),
      ).toBeEnabled();
      await act(async () => {
        response.resolve(hosted());
        await response.promise;
      });
      expect(view.openHosted).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Starter" }),
      );
      const attempts = view.request.mock.calls.filter(
        ([operation]) => operation === "billing.checkout.create",
      );
      expect(attempts).toHaveLength(2);
      expect(attempts[0]?.[1]).not.toEqual(attempts[1]?.[1]);
    },
  );

  it("does not publish an old request error in another organization", async () => {
    const response = deferred();
    const view = renderBilling({ action: () => response.promise });
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Starter" }),
    );
    view.changeScope("org_other");
    await screen.findByRole("button", { name: "Continue with Starter" });
    await act(async () => {
      response.reject(new Error("Old request failed"));
      await response.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.openHosted).not.toHaveBeenCalled();
  });

  it("refreshes return status for at most one minute without treating the redirect as payment", async () => {
    vi.useFakeTimers();
    window.history.replaceState(
      null,
      "",
      "/organizations/org_billing/billing?checkout=returned",
    );
    const view = renderBilling();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(
      screen.getByRole("heading", { name: "Not subscribed" }),
    ).toBeVisible();
    for (let i = 0; i < 12; i += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    expect(
      view.request.mock.calls.filter(
        ([operation]) => operation === "billing.workspace.get",
      ),
    ).toHaveLength(13);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      view.request.mock.calls.filter(
        ([operation]) => operation === "billing.workspace.get",
      ),
    ).toHaveLength(13);
    expect(view.action).not.toHaveBeenCalled();
    expect(view.openHosted).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Not subscribed" }),
    ).toBeVisible();
  });

  it("refreshes scoped credits and stops polling after a verified subscription", async () => {
    vi.useFakeTimers();
    window.history.replaceState(
      null,
      "",
      "/organizations/org_billing/billing?checkout=returned",
    );
    const view = renderBilling();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(
      screen.getByRole("button", { name: "Buy 100 credits" }),
    ).toBeDisabled();
    const otherScope = cloudMarkupQueryKeys.commercialSummary(
      principal.id,
      "org_other",
    );
    view.queryClient.setQueryData(otherScope, { availableCreditUnits: 50 });
    view.request.mockImplementation((operation) =>
      Promise.resolve(
        operation === "billing.top-ups.get"
          ? {
              data: {
                ...topUps().data,
                mode: "stripe-sandbox",
                canPurchase: true,
                availableCreditUnits: "200",
              },
            }
          : {
              data: {
                ...workspace(),
                subscriptionState: "active",
                currentPlanKey: "starter",
                canCheckout: false,
                canManage: true,
              },
            },
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_010);
    });
    expect(
      within(
        screen.getByRole("region", { name: "Current subscription" }),
      ).getByRole("heading", { name: "Starter" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Buy 100 credits" }),
    ).toBeEnabled();
    expect(screen.getByText("200")).toBeVisible();
    expect(view.queryClient.getQueryState(otherScope)?.isInvalidated).toBe(
      false,
    );
    const reads = view.request.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(view.request.mock.calls).toHaveLength(reads);
    expect(view.action).not.toHaveBeenCalled();
  });

  it("reuses the same idempotency key when the user retries an uncertain attempt", async () => {
    const view = renderBilling();
    view.action.mockRejectedValueOnce(new Error("Network interrupted"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Starter" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Starter" }),
    );
    await waitFor(() => {
      expect(view.openHosted).toHaveBeenCalledTimes(1);
    });
    const attempts = view.request.mock.calls.filter(
      ([operation]) => operation === "billing.checkout.create",
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.[1]).toEqual(attempts[1]?.[1]);
  });

  it.each([
    ["starter", "Starter", "Professional"],
    ["pro", "Professional", "Starter"],
  ] as const)(
    "recovers an expired %s checkout through one plan-button click",
    async (planKey, planName, otherPlanName) => {
      const response = deferred();
      const view = renderBilling();
      view.action
        .mockRejectedValueOnce(checkoutConflict())
        .mockImplementationOnce(() => response.promise);
      const button = await screen.findByRole("button", {
        name: `Continue with ${planName}`,
      });
      fireEvent.click(button);
      await waitFor(() => {
        expect(view.action).toHaveBeenCalledTimes(2);
      });
      fireEvent.click(button);
      expect(view.action).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("button", { name: /Start a new/u }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Continue with ${otherPlanName}` }),
      ).toBeDisabled();
      const attempts = view.request.mock.calls.filter(
        ([operation]) => operation === "billing.checkout.create",
      );
      const firstKey = attempts[0]?.[1].headers?.["idempotency-key"];
      const nextKey = attempts[1]?.[1].headers?.["idempotency-key"];
      expect(nextKey).toMatch(/^billing-/u);
      expect(nextKey).not.toBe(firstKey);
      expect(attempts[1]?.[1]).toEqual({
        path: { organizationId: "org_billing" },
        headers: { "idempotency-key": nextKey },
        body: { contractVersion: 1, planKey },
      });
      expect(view.openHosted).not.toHaveBeenCalled();
      await act(async () => {
        response.resolve(hosted());
        await response.promise;
      });
      expect(view.openHosted).toHaveBeenCalledExactlyOnceWith(
        hosted().data.url,
      );
      expect(
        screen.getByRole("heading", { name: "Not subscribed" }),
      ).toBeVisible();
    },
  );

  it("bounds conflict recovery to one retry and never loops or starts a new payment from a redirect", async () => {
    const view = renderBilling({
      action: () => Promise.reject(checkoutConflict()),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Starter" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Checkout could not be opened yet. Your billing status has been refreshed.",
    );
    expect(view.action).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: /Start a new/u }),
    ).not.toBeInTheDocument();
    expect(view.openHosted).not.toHaveBeenCalled();
  });

  it("shows a newly confirmed subscription instead of retrying Checkout", async () => {
    const view = renderBilling();
    const button = await screen.findByRole("button", {
      name: "Continue with Starter",
    });
    view.request.mockImplementation((operation) =>
      operation === "billing.top-ups.get"
        ? Promise.resolve(topUps())
        : operation === "billing.workspace.get"
          ? Promise.resolve({
              data: {
                ...workspace(),
                subscriptionState: "active",
                currentPlanKey: "starter",
                canCheckout: false,
                canManage: true,
              },
            })
          : view.action(),
    );
    view.action.mockRejectedValueOnce(checkoutConflict());
    fireEvent.click(button);
    await within(
      screen.getByRole("region", { name: "Current subscription" }),
    ).findByRole("heading", { name: "Starter" });
    await screen.findByRole("button", { name: "Manage billing" });
    expect(view.action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.openHosted).not.toHaveBeenCalled();
  });

  it("preserves uncertain recovery and other-plan keys after the bounded conflict retry", async () => {
    const view = renderBilling();
    view.action
      .mockRejectedValueOnce(new Error("Interrupted Professional request"))
      .mockRejectedValueOnce(checkoutConflict())
      .mockRejectedValueOnce(new Error("Interrupted recovery request"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Professional" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Starter" }),
    );
    await waitFor(() => {
      expect(view.action).toHaveBeenCalledTimes(3);
    });
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Starter" }),
    );
    await waitFor(() => {
      expect(view.openHosted).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Professional" }),
    );
    await waitFor(() => {
      expect(view.openHosted).toHaveBeenCalledTimes(2);
    });
    const attempts = view.request.mock.calls.filter(
      ([operation]) => operation === "billing.checkout.create",
    );
    expect(attempts).toHaveLength(5);
    expect(attempts[0]?.[1]).toEqual(attempts[4]?.[1]);
    expect(attempts[1]?.[1].headers).not.toEqual(attempts[2]?.[1].headers);
    expect(attempts[2]?.[1]).toEqual(attempts[3]?.[1]);
  });

  it("does not offer Checkout recovery for a Portal conflict", async () => {
    const view = renderBilling({
      value: {
        ...workspace(),
        subscriptionState: "active",
        currentPlanKey: "pro",
        canCheckout: false,
        canManage: true,
      },
      action: () => Promise.reject(checkoutConflict()),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Manage billing" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Billing management could not be opened. Refresh status and try again.",
    );
    expect(
      screen.queryByRole("button", { name: /Start a new/u }),
    ).not.toBeInTheDocument();
    expect(
      view.request.mock.calls.map(([operation]) => operation),
    ).not.toContain("billing.checkout.create");
  });

  it("clears Checkout recovery when the organization changes", async () => {
    const view = renderBilling({
      action: () => Promise.reject(checkoutConflict()),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Starter" }),
    );
    await screen.findByRole("alert");
    view.changeScope("org_other");
    await screen.findByRole("button", { name: "Continue with Starter" });
    expect(
      screen.queryByRole("button", { name: /Start a new/u }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.action).toHaveBeenCalledTimes(2);
  });

  it.each([
    hosted("org_other"),
    hosted("org_billing", "portal"),
    {
      data: {
        ...hosted().data,
        url: "https://checkout.stripe.com.attacker.test/pay",
      },
    },
  ])("rejects an unbound hosted session %#", async (response) => {
    const view = renderBilling({ action: () => Promise.resolve(response) });
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Starter" }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(view.openHosted).not.toHaveBeenCalled();
  });

  it("does not render another organization's workspace response", async () => {
    renderBilling({ value: workspace("org_other") });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Billing summary unavailable",
    );
    expect(
      screen.queryByRole("group", { name: "Monthly plans" }),
    ).not.toBeInTheDocument();
  });
  it("presents live billing without sandbox instructions and discloses monthly renewal", async () => {
    renderBilling({ value: { ...workspace(), mode: "stripe-live" } });
    await screen.findByRole("group", { name: "Monthly plans" });
    expect(screen.queryByText("Sandbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Payment, credits and availability"));
    expect(
      screen.getByText(/Paid plans renew monthly until canceled/),
    ).toBeInTheDocument();
  });
});
