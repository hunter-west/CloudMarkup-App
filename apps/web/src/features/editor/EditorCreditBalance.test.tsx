import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
} from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import type { LocalOwnerBrowserSession } from "../auth/local-owner-browser-auth.js";
import { LocalOwnerSessionContext } from "../auth/local-owner-session.js";
import { EditorCreditBalance } from "./EditorCreditBalance.js";

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

afterEach(cleanup);
function fixture(
  value: unknown = credits(800),
  actor = principal,
  localOwner = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const request = vi.fn().mockResolvedValue({ data: value });
  const client = { request } as unknown as CloudMarkupClient;
  const content = (current = actor) => (
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <RouterProvider>
        {localOwner ? (
          <LocalOwnerSessionContext.Provider
            value={{
              session: {} as LocalOwnerBrowserSession,
              signOut: () => Promise.resolve(),
              reauthenticate: () => Promise.resolve(),
            }}
          >
            <EditorCreditBalance
              principal={current}
              organizationId="org_usage"
            />
          </LocalOwnerSessionContext.Provider>
        ) : (
          <EditorCreditBalance principal={current} organizationId="org_usage" />
        )}
      </RouterProvider>
    </CloudMarkupQueryProvider>
  );
  const view = render(content());
  return {
    ...view,
    request,
    queryClient,
    changePrincipal: (current: CurrentPrincipalV1) => {
      view.rerender(content(current));
    },
  };
}
describe("canvas credit balance", () => {
  it("omits the hosted credit control in local owner mode", () => {
    const f = fixture(credits(800), principal, true);
    expect(
      screen.queryByRole("link", { name: /credits/u }),
    ).not.toBeInTheDocument();
    expect(f.request).not.toHaveBeenCalled();
  });
  it("shows available and reserved credits and links to Usage", async () => {
    fixture({
      ...credits(1000),
      availableCreditUnits: 800,
      reservedCreditUnits: 200,
    });
    const link = await screen.findByRole("link", {
      name: /800 credits.*200 reserved/u,
    });
    expect(link).toHaveAttribute("href", "/organizations/org_usage/usage");
  });
  it("shows canonical zero despite historical grants and usage", async () => {
    fixture({
      ...credits(),
      totalGrantedCreditUnits: 1000,
      netAdjustmentCreditUnits: -938,
      debitAdjustmentCreditUnits: 938,
      settledCreditUnits: 62,
    });
    expect(
      await screen.findByRole("link", { name: "0 credits" }),
    ).toBeVisible();
    expect(screen.queryByText(/938 credits/u)).not.toBeInTheDocument();
  });
  it("discards a response for another organization", async () => {
    fixture(credits(900, "org_elsewhere"));
    expect(
      await screen.findByRole("link", { name: "Credits unavailable" }),
    ).toBeVisible();
    expect(screen.queryByText(/900/u)).not.toBeInTheDocument();
  });
  it("clears a previously visible balance after a permission change", async () => {
    const f = fixture();
    await screen.findByText("800 credits");
    f.changePrincipal({ ...principal, organizationContexts: [] });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("hides stale numbers if the next server check fails", async () => {
    const f = fixture();
    await screen.findByText("800 credits");
    f.request.mockRejectedValue(new Error("Unavailable"));
    await act(async () => {
      await f.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.commercialSummary(
          principal.id,
          "org_usage",
        ),
      });
    });
    expect(
      await screen.findByRole("link", { name: "Credits unavailable" }),
    ).toBeVisible();
    expect(screen.queryByText("800 credits")).not.toBeInTheDocument();
  });
});
