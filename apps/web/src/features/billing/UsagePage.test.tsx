import {
  ApiClientError,
  type CloudMarkupClient,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
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
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
} from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { UsagePage } from "./BillingUsagePages.js";

const principal: CurrentPrincipalV1 = {
  id: "principal_usage",
  displayName: "Usage reader",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId: "org_usage",
      membershipId: "membership_usage",
      role: "viewer",
      isOwner: false,
      capabilities: ["commercial.summary.read"],
    },
  ],
};
function credits(available = 0, organizationId = "org_usage") {
  return {
    contractVersion: 1,
    organizationId,
    asOf: "2026-09-05T12:00:00.000Z",
    activeGrantedCreditUnits: available,
    availableCreditUnits: available,
    compensatedCreditUnits: 0,
    debitAdjustmentCreditUnits: 0,
    exhausted: available === 0,
    expiredCreditUnits: 0,
    netAdjustmentCreditUnits: 0,
    reservedCreditUnits: 0,
    settledCreditUnits: 0,
    totalGrantedCreditUnits: available,
    unresolvedCreditUnits: 0,
  };
}
function overview(balance: unknown = credits()) {
  return {
    contractVersion: 1,
    balance,
    availableByKind: {
      monthly: 0,
      purchased: 0,
      other: (balance as ReturnType<typeof credits>).availableCreditUnits,
    },
    nextExpiration: null,
  };
}
function billing(organizationId = "org_usage") {
  return {
    contractVersion: 1,
    organizationId,
    asOf: "2026-09-05T12:00:00.000Z",
    mode: "disabled",
    accountState: "unprovisioned",
    subscriptionState: "not-subscribed",
    currentPlanKey: null,
    canCheckout: false,
    canManage: false,
    plans: [
      {
        key: "starter",
        displayName: "Starter",
        currency: "USD",
        monthlyPriceMicros: "9000000",
        monthlyCreditUnits: 200,
      },
      {
        key: "pro",
        displayName: "Professional",
        currency: "USD",
        monthlyPriceMicros: "39000000",
        monthlyCreditUnits: 1000,
      },
    ],
  };
}
function denied(
  code: "access_denied" | "not_found" | "authentication_required",
) {
  return new ApiClientError(
    code === "authentication_required" ? 401 : code === "not_found" ? 404 : 403,
    {
      apiVersion: "v1",
      error: {
        code,
        correlationId: "correlation_usage",
        message: "The summary is unavailable.",
      },
    },
  );
}
function fixture(
  options: {
    credit?: unknown;
    overview?: unknown;
    workspace?: unknown;
    delayed?: Promise<unknown>;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let failure: Error | undefined;
  const request = vi.fn((operation: string) => {
    if (failure) return Promise.reject(failure);
    if (operation === "commercial.credit-overview.get")
      return (
        options.delayed ??
        Promise.resolve({
          data: options.overview ?? overview(options.credit ?? credits()),
        })
      );
    if (operation === "billing.workspace.get")
      return Promise.resolve({ data: options.workspace ?? billing() });
    throw new Error("Unexpected operation");
  });
  const client = {
    request,
    requestWithMetadata: vi.fn(),
  } as unknown as CloudMarkupClient;
  const content = (actor = principal) => (
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <RouterProvider>
        <UsagePage principal={actor} organizationId="org_usage" />
      </RouterProvider>
    </CloudMarkupQueryProvider>
  );
  const view = render(content());
  return {
    ...view,
    request,
    queryClient,
    setFailure: (error: Error) => {
      failure = error;
    },
    changePrincipal: (actor: CurrentPrincipalV1) => {
      view.rerender(content(actor));
    },
  };
}
afterEach(cleanup);

describe("authenticated credit Usage page", () => {
  it("shows real zero/no-subscription state without implying exhausted trial credits", async () => {
    const f = fixture();
    expect(
      await screen.findByRole("heading", { name: "0 available credits" }),
    ).toBeVisible();
    expect(screen.getByText("No credits granted")).toBeVisible();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText(/Not subscribed/u)).toBeVisible();
    expect(screen.queryByText("Credits exhausted")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /existing permissions to read projects or edit manually/u,
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "View billing" })).toHaveAttribute(
      "href",
      "/organizations/org_usage/billing",
    );
    expect(f.request.mock.calls.map(([operation]) => operation).sort()).toEqual(
      ["billing.workspace.get", "commercial.credit-overview.get"],
    );
    expect(
      screen.queryByRole("button", { name: /Checkout|Buy|Generate/u }),
    ).not.toBeInTheDocument();
  });
  it("separates available monthly and purchased balances and their next expiration", async () => {
    fixture({
      overview: {
        contractVersion: 1,
        balance: credits(1550),
        availableByKind: { monthly: 1200, purchased: 350, other: 0 },
        nextExpiration: { at: "2026-10-05T12:00:00.000Z", creditUnits: 1200 },
      },
    });
    await screen.findByRole("heading", { name: "1,550 available credits" });
    expect(
      within(screen.getByRole("region", { name: "Monthly credits" })).getByText(
        "1,200",
      ),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Purchased credits" }),
      ).getByText("350"),
    ).toBeVisible();
    expect(
      screen.getByText(/1,200 available credits expire next/u),
    ).toBeVisible();
    expect(screen.getByText("Top-up packs have no expiration.")).toBeVisible();
  });
  it("withholds a breakdown that does not reconcile to its total", async () => {
    fixture({
      overview: {
        ...overview(credits(200)),
        availableByKind: { monthly: 200, purchased: 100, other: 0 },
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Usage summary unavailable",
    );
    expect(
      screen.queryByRole("region", { name: "Purchased credits" }),
    ).not.toBeInTheDocument();
  });
  it("shows available/reserved/used credits without fabricating monthly history", async () => {
    fixture({
      workspace: {
        ...billing(),
        mode: "stripe-live",
        accountState: "active",
        subscriptionState: "active",
        currentPlanKey: "starter",
        plans: billing().plans.map((plan) =>
          plan.key === "starter" ? { ...plan, displayName: "Standard" } : plan,
        ),
      },
      credit: {
        ...credits(170),
        activeGrantedCreditUnits: 200,
        totalGrantedCreditUnits: 200,
        reservedCreditUnits: 20,
        settledCreditUnits: 10,
      },
    });
    expect(
      await screen.findByRole("heading", { name: "170 available credits" }),
    ).toBeVisible();
    expect(screen.getByText("Standard · active")).toBeVisible();
    expect(
      screen.getByText("20 credits reserved for work in progress."),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Granted" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/not available credits or monthly usage history/u),
    ).toBeInTheDocument();
  });
  it("keeps historical grants and adjustments out of the spendable total", async () => {
    fixture({
      credit: {
        ...credits(0),
        totalGrantedCreditUnits: 1000,
        netAdjustmentCreditUnits: -938,
        debitAdjustmentCreditUnits: 938,
        settledCreditUnits: 62,
      },
    });
    await screen.findByRole("heading", { name: "0 available credits" });
    expect(screen.getByText("No credits available")).toBeVisible();
    expect(
      screen.queryByLabelText("Workspace credit balance"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Credit details and accounting"));
    expect(screen.getByText("Total historical grants")).toBeVisible();
    expect(screen.getByText("1,000")).toBeVisible();
    expect(screen.getByText("-938")).toBeVisible();
    expect(screen.getByText("62")).toBeVisible();
    expect(screen.queryByText("938 available credits")).not.toBeInTheDocument();
  });
  it.each(["credits", "workspace"] as const)(
    "does not cache a mismatched organization %s response",
    async (which) => {
      const f = fixture(
        which === "credits"
          ? { credit: credits(200, "org_other") }
          : { workspace: billing("org_other") },
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Usage summary unavailable",
      );
      expect(
        screen.queryByText(/200 available credits/u),
      ).not.toBeInTheDocument();
      const queries = f.queryClient.getQueryCache().findAll({
        queryKey: cloudMarkupQueryKeys.commercialSummary(
          principal.id,
          "org_usage",
        ),
      });
      expect(queries.every((query) => query.state.data === undefined)).toBe(
        true,
      );
    },
  );
  it.each(["access_denied", "not_found", "authentication_required"] as const)(
    "hides a previously loaded balance after %s",
    async (code) => {
      const f = fixture({ credit: credits(200) });
      await screen.findByRole("heading", { name: "200 available credits" });
      f.setFailure(denied(code));
      fireEvent.click(screen.getByRole("button", { name: "Refresh credits" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Usage summary unavailable",
      );
      expect(
        screen.queryByRole("heading", { name: "200 available credits" }),
      ).not.toBeInTheDocument();
    },
  );
  it("purges the old scope on permission loss and does not request a forbidden read", async () => {
    const f = fixture({ credit: credits(200) });
    await screen.findByRole("heading", { name: "200 available credits" });
    const calls = f.request.mock.calls.length;
    f.changePrincipal({
      ...principal,
      organizationContexts: principal.organizationContexts.map(
        (organization) => ({ ...organization, capabilities: [] }),
      ),
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No usage or credit details are disclosed",
    );
    expect(f.request).toHaveBeenCalledTimes(calls);
    await waitFor(() => {
      expect(
        f.queryClient.getQueryCache().findAll({
          queryKey: cloudMarkupQueryKeys.commercialSummary(
            principal.id,
            "org_usage",
          ),
        }),
      ).toHaveLength(0);
    });
  });
  it("discards and does not cache a late response after the principal scope leaves", async () => {
    let release!: (value: unknown) => void;
    const delayed = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const f = fixture({ delayed });
    await screen.findByRole("heading", { name: "Loading credit summary" });
    f.unmount();
    await act(async () => {
      release({ data: overview(credits(200)) });
      await delayed;
    });
    expect(
      f.queryClient.getQueryCache().findAll({
        queryKey: cloudMarkupQueryKeys.commercialSummary(
          principal.id,
          "org_usage",
        ),
      }),
    ).toHaveLength(0);
  });
});
