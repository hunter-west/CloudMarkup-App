import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
  OrganizationV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { OrganizationsPage } from "./OrganizationPages.js";

const PRINCIPAL_ID = "principal_organizations";
const PRIMARY_ID = "org_primary";
const SECONDARY_ID = "org_secondary";

const principal: CurrentPrincipalV1 = {
  displayName: "Morgan Architect",
  id: PRINCIPAL_ID,
  organizationContexts: [
    {
      capabilities: ["organizations.read", "projects.read"],
      isOwner: true,
      membershipId: "membership_primary",
      organizationId: PRIMARY_ID,
      role: "owner",
    },
    {
      capabilities: ["organizations.read", "projects.read"],
      isOwner: false,
      membershipId: "membership_secondary",
      organizationId: SECONDARY_ID,
      role: "viewer",
    },
  ],
  resourceVersion: 1,
};

const primary: OrganizationV1 = {
  createdAt: "2026-08-03T14:30:00.000Z",
  displayName: "Northstar Engineering",
  id: PRIMARY_ID,
  lifecycleStatus: "active",
  slug: "northstar-engineering",
  version: 7,
};

const secondary: OrganizationV1 = {
  createdAt: "2026-08-04T14:30:00.000Z",
  displayName: "Reference Workspace",
  id: SECONDARY_ID,
  lifecycleStatus: "active",
  slug: "reference-workspace",
  version: 2,
};

function clientWithRequest(
  request: (operation: string, input: unknown) => unknown,
): CloudMarkupClient {
  return {
    request: (operation: string, input: unknown) =>
      operation === "account.workspaces.list"
        ? Promise.resolve({
            data: [primary, secondary].map((item) => ({
              contractVersion: 1,
              principalId: PRINCIPAL_ID,
              id: item.id,
              displayName: item.displayName,
              kind: "organization",
              role: item.id === PRIMARY_ID ? "owner" : "viewer",
            })),
            page: { hasMore: false },
          })
        : request(operation, input),
    requestWithMetadata: vi
      .fn()
      .mockRejectedValue(new Error("Unexpected metadata request")),
  } as unknown as CloudMarkupClient;
}

function renderBackend(
  children: ReactNode,
  client: CloudMarkupClient,
): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  window.history.replaceState(null, "", "/organizations");
  render(
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <RouterProvider>{children}</RouterProvider>
    </CloudMarkupQueryProvider>,
  );
  return queryClient;
}

describe("organization chooser", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the local directory explicitly synthetic", () => {
    render(
      <RouterProvider>
        <OrganizationsPage />
      </RouterProvider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Organizations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Local preview only")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open local project previews" }),
    ).toHaveAttribute("href", "/organizations/local-org/projects");
  });

  it("shows a bounded loading state before disclosing organization data", () => {
    const request = vi.fn(() => new Promise<never>(() => undefined));
    renderBackend(
      <OrganizationsPage principal={principal} />,
      clientWithRequest(request),
    );

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Loading your organizations",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(primary.displayName)).not.toBeInTheDocument();
  });

  it("renders principal-bound organizations with distinct workspace and settings actions", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [primary, secondary],
      page: { hasMore: false },
    });
    renderBackend(
      <OrganizationsPage principal={principal} />,
      clientWithRequest(request),
    );

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Your workspaces",
      }),
    ).toBeInTheDocument();
    const primaryCard = screen
      .getByRole("heading", { level: 3, name: primary.displayName })
      .closest("li");
    if (primaryCard === null) throw new Error("Primary card was not rendered.");
    expect(within(primaryCard).getByText("Owner access")).toBeInTheDocument();
    expect(
      within(primaryCard).getByText(
        "Projects in this workspace are shared with authorized organization members.",
      ),
    ).toBeVisible();
    fireEvent.click(within(primaryCard).getByText("Organization details"));
    expect(
      within(primaryCard).getByText(
        /Owners and administrators with invitation access can invite registered users from Members settings\./u,
      ),
    ).toBeVisible();
    expect(
      within(primaryCard).getByRole("link", { name: "Open dashboard" }),
    ).toHaveAttribute("href", `/organizations/${PRIMARY_ID}/dashboard`);
    expect(
      within(primaryCard).getByRole("link", {
        name: "Organization settings",
      }),
    ).toHaveAttribute("href", `/organizations/${PRIMARY_ID}/settings/general`);
    expect(screen.getByText("Viewer access")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open your personal workspace or choose an organization to collaborate.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/principal-bound|authenticated CloudMarkup API/u),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create organization" }),
    ).toBeDisabled();
    expect(request).toHaveBeenCalledWith("organizations.list", {
      query: { "page[limit]": "100", sort: "displayName" },
    });
  });

  it("loads additional authorized pages only on request", async () => {
    const request = vi
      .fn()
      .mockImplementation(
        (
          _operation: string,
          input: { readonly query: { readonly "page[cursor]"?: string } },
        ) =>
          input.query["page[cursor]"] === "beta-offset-1"
            ? Promise.resolve({
                data: [secondary],
                page: { hasMore: false },
              })
            : Promise.resolve({
                data: [primary],
                page: { hasMore: true, nextCursor: "beta-offset-1" },
              }),
      );
    renderBackend(
      <OrganizationsPage principal={principal} />,
      clientWithRequest(request),
    );

    expect(await screen.findByText(primary.displayName)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Load more organizations" }),
    );
    expect(await screen.findByText(secondary.displayName)).toBeInTheDocument();
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
    });
  });

  it("fails closed when an inactive response is outside the verified principal contexts", async () => {
    const foreignOrganization: OrganizationV1 = {
      ...primary,
      displayName: "Foreign Tenant Secret",
      id: "org_foreign",
      lifecycleStatus: "suspended",
      slug: "foreign-tenant-secret",
    };
    const request = vi.fn().mockResolvedValue({
      data: [foreignOrganization],
      page: { hasMore: false },
    });
    renderBackend(
      <OrganizationsPage principal={principal} />,
      clientWithRequest(request),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Organization directory unavailable");
    expect(
      screen.queryByText(foreignOrganization.displayName),
    ).not.toBeInTheDocument();
  });

  it("does not disclose a cached organization after the same principal loses membership", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [primary],
        page: { hasMore: false },
      })
      .mockImplementation(() => new Promise<never>(() => undefined));
    const client = clientWithRequest(request);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    });
    const view = (currentPrincipal: CurrentPrincipalV1) => (
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <RouterProvider>
          <OrganizationsPage principal={currentPrincipal} />
        </RouterProvider>
      </CloudMarkupQueryProvider>
    );
    window.history.replaceState(null, "", "/organizations");
    const { rerender } = render(view(principal));

    expect(await screen.findByText(primary.displayName)).toBeInTheDocument();
    rerender(
      view({
        ...principal,
        organizationContexts: principal.organizationContexts.filter(
          (context) => context.organizationId !== primary.id,
        ),
      }),
    );

    expect(screen.queryByText(primary.displayName)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Loading your organizations",
      }),
    ).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "binds personal ownership without disclosing a foreign actor response: %s",
    async (foreign) => {
      const request = vi.fn((operation: string) =>
        Promise.resolve(
          operation === "account.workspaces.list"
            ? {
                data: [
                  {
                    contractVersion: 1,
                    principalId: foreign ? "principal_foreign" : PRINCIPAL_ID,
                    id: PRIMARY_ID,
                    displayName: "Personal",
                    kind: "personal",
                    role: "owner",
                  },
                ],
                page: { hasMore: false },
              }
            : { data: [primary], page: { hasMore: false } },
        ),
      );
      renderBackend(<OrganizationsPage principal={principal} />, {
        request,
      } as unknown as CloudMarkupClient);
      if (foreign) {
        await screen.findByRole("alert");
        expect(screen.queryByText(primary.displayName)).not.toBeInTheDocument();
        return;
      }
      const heading = await screen.findByRole("heading", {
        level: 3,
        name: "Personal",
      });
      const card = heading.closest("li");
      if (!card) throw Error("Missing personal card");
      expect(within(card).getByText("Only you")).toBeVisible();
      expect(
        within(card).queryByRole("link", { name: "Organization settings" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Create personal workspace" }),
      ).not.toBeInTheDocument();
    },
  );

  it("does not infer organizations when the authenticated runtime is unavailable", () => {
    render(<OrganizationsPage principal={principal} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Organization access is unavailable",
    );
    expect(screen.queryByText(primary.displayName)).not.toBeInTheDocument();
  });
});
