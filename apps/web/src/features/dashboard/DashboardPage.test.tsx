import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudMarkupQueryProvider } from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import type { LocalOwnerBrowserSession } from "../auth/local-owner-browser-auth.js";
import { LocalOwnerSessionContext } from "../auth/local-owner-session.js";
import { DashboardPage } from "./DashboardPage.js";
const principal: CurrentPrincipalV1 = {
  id: "principal_dashboard",
  displayName: "Architect",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId: "org_dashboard",
      membershipId: "membership_dashboard",
      role: "editor",
      isOwner: false,
      capabilities: ["projects.read", "projects.create", "organizations.read"],
    },
  ],
};
function credits(organizationId = "org_dashboard") {
  return {
    contractVersion: 1,
    organizationId,
    asOf: "2026-09-22T12:00:00.000Z",
    activeGrantedCreditUnits: 100,
    availableCreditUnits: 70,
    compensatedCreditUnits: 0,
    debitAdjustmentCreditUnits: 0,
    exhausted: false,
    expiredCreditUnits: 0,
    netAdjustmentCreditUnits: 0,
    reservedCreditUnits: 10,
    settledCreditUnits: 20,
    totalGrantedCreditUnits: 100,
    unresolvedCreditUnits: 0,
  };
}
function project(
  id: string,
  lifecycleStatus = "active",
  updatedAt = "2026-09-22T12:00:00.000Z",
) {
  return {
    id,
    name: id,
    organizationId: "org_dashboard",
    lifecycleStatus,
    updatedAt,
  };
}
function mount(
  options: {
    actor?: CurrentPrincipalV1;
    organizationId?: string;
    creditScope?: string;
    projectScope?: string;
    failure?: boolean;
    localOwner?: boolean;
  } = {},
) {
  const request = vi.fn((operation: string) =>
    Promise.resolve().then(() => {
      if (options.failure) throw new Error("Unavailable");
      if (operation === "projects.list")
        return {
          data: [
            project("Earlier", "active", "2026-09-20T12:00:00.000Z"),
            project("Recent"),
            project("Archived", "archived"),
            project("Deleted", "deleted"),
          ].map((p) => ({
            ...p,
            organizationId: options.projectScope ?? p.organizationId,
          })),
        };
      if (operation === "commercial.credit-balance.get")
        return { data: credits(options.creditScope) };
      throw new Error("Unexpected operation");
    }),
  );
  const client = {
    request,
    requestWithMetadata: vi.fn(),
  } as unknown as CloudMarkupClient;
  window.history.replaceState(
    null,
    "",
    "/organizations/org_dashboard/dashboard",
  );
  const content = (actor: CurrentPrincipalV1) => (
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <RouterProvider>
        {options.localOwner ? (
          <LocalOwnerSessionContext.Provider
            value={{
              session: {} as LocalOwnerBrowserSession,
              signOut: () => Promise.resolve(),
              reauthenticate: () => Promise.resolve(),
            }}
          >
            <DashboardPage
              principal={actor}
              organizationId={options.organizationId ?? "org_dashboard"}
            />
          </LocalOwnerSessionContext.Provider>
        ) : (
          <DashboardPage
            principal={actor}
            organizationId={options.organizationId ?? "org_dashboard"}
          />
        )}
      </RouterProvider>
    </CloudMarkupQueryProvider>
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(content(options.actor ?? principal));
  return {
    request,
    changeActor: (actor: CurrentPrincipalV1) => {
      view.rerender(content(actor));
    },
  };
}
afterEach(cleanup);
describe("organization dashboard", () => {
  it("shows local projects without probing unavailable hosted credits", async () => {
    const f = mount({ localOwner: true });
    expect(
      screen.getByText(
        "Hosted credits and billing are unavailable in this local workspace.",
      ),
    ).toBeVisible();
    await screen.findByText("Recent");
    expect(f.request.mock.calls.map((call) => call[0])).not.toContain(
      "commercial.credit-balance.get",
    );
  });
  it("shows recorded credits and recent active projects, with an AI-first entry", async () => {
    const f = mount();
    expect(await screen.findByText("Recorded credit balance")).toBeVisible();
    expect(screen.getByText("70")).toBeVisible();
    expect(screen.getByText("Used (lifetime)")).toBeVisible();
    expect(
      screen.getByText(/Available credits exclude reservations/u),
    ).toBeVisible();
    const recent = screen.getByRole("region", { name: "Recent projects" });
    await waitFor(() =>
      expect(within(recent).getByText("Recent")).toBeVisible(),
    );
    expect(within(recent).queryByText("Archived")).not.toBeInTheDocument();
    expect(screen.queryByText("Deleted")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Create with AI/u }),
    ).toHaveAttribute(
      "href",
      "/organizations/org_dashboard/projects/new?start=prompt",
    );
    expect(f.request).toHaveBeenCalledWith("projects.list", {
      path: { organizationId: "org_dashboard" },
      query: { "page[limit]": "100", sort: "-updatedAt" },
    });
  });
  it("makes no project or credit request for a foreign organization", () => {
    const f = mount({ organizationId: "org_foreign" });
    expect(screen.getByRole("alert")).toHaveTextContent("do not have access");
    expect(f.request).not.toHaveBeenCalled();
  });
  it("does not load usage or offer creation without the corresponding capability", async () => {
    const actor = {
      ...principal,
      organizationContexts: principal.organizationContexts.map((c) => ({
        ...c,
        capabilities: ["projects.read"],
      })),
    };
    const f = mount({ actor });
    await screen.findByText("Recent");
    expect(
      screen.getByText("Your role does not include usage access."),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Create with AI/u }),
    ).not.toBeInTheDocument();
    expect(f.request.mock.calls.map((call) => call[0])).not.toContain(
      "commercial.credit-balance.get",
    );
  });
  it("rejects mismatched project and credit response bindings", async () => {
    mount({ projectScope: "org_foreign", creditScope: "org_foreign" });
    expect(
      await screen.findByText("Recent projects are unavailable."),
    ).toBeVisible();
    expect(
      await screen.findByText("Usage is temporarily unavailable."),
    ).toBeVisible();
    expect(screen.queryByText("70")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Recent", { exact: true }),
    ).not.toBeInTheDocument();
  });
  it("removes visible data when membership is revoked", async () => {
    const f = mount();
    await screen.findByText("70");
    f.changeActor({ ...principal, organizationContexts: [] });
    expect(screen.getByRole("alert")).toHaveTextContent("do not have access");
    expect(screen.queryByText("70")).not.toBeInTheDocument();
  });
  it("keeps failed requests distinct from zero usage", async () => {
    mount({ failure: true });
    await screen.findByText("Usage is temporarily unavailable.");
    expect(
      screen.queryByText("Recorded credit balance"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();
  });
});
