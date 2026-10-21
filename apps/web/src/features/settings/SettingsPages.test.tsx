import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
  OrganizationMemberV1,
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

import {
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
} from "../../api/index.js";
import type { LocalOwnerBrowserSession } from "../auth/local-owner-browser-auth.js";
import { LocalOwnerSessionContext } from "../auth/local-owner-session.js";
import type { LocalMockIdentity } from "../../mock/local-mock-context.js";
import { RouterProvider } from "../../routing/index.js";
import {
  OrganizationSettingsPage,
  PersonalSettingsPage,
} from "./SettingsPages.js";

const ORGANIZATION_ID = "org_settings";
const PRINCIPAL_ID = "principal_settings";

const organization: OrganizationV1 = {
  createdAt: "2026-08-03T14:30:00.000Z",
  displayName: "Northstar Engineering",
  id: ORGANIZATION_ID,
  lifecycleStatus: "active",
  slug: "northstar-engineering",
  version: 7,
};

const legacyMemberships = [
  {
    capabilities: ["memberships.read", "organizations.read"],
    id: "membership_riley",
    isOwner: false,
    joinedAt: "2026-08-04T10:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    principal: {
      displayName: "Riley Admin",
      id: "principal_riley",
    },
    role: "administrator",
    status: "active",
  },
  {
    capabilities: ["organizations.read"],
    id: "membership_taylor",
    isOwner: false,
    joinedAt: "2026-08-05T11:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    principal: {
      displayName: "Taylor Viewer",
      id: "principal_taylor",
    },
    role: "viewer",
    status: "suspended",
  },
] as const;
const memberships: readonly OrganizationMemberV1[] = legacyMemberships.map(
  (m) => ({
    contractVersion: 1,
    organizationId: m.organizationId,
    membershipId: m.id,
    principalId: m.principal.id,
    displayName: m.principal.displayName,
    username: null,
    role: m.role,
    status: m.status,
    version: 1,
    etag: '"member:' + m.id + ':1"',
    joinedAt: m.joinedAt,
    endedAt: null,
    endReason: null,
  }),
);

const firstMembership = memberships[0];
if (firstMembership === undefined) throw Error("Missing synthetic membership");

const deniedIdentity: LocalMockIdentity = {
  kind: "local-mock",
  actorId: "denied-settings-test-actor",
  displayName: "Restricted settings fixture",
  organization: {
    id: "restricted-settings-organization",
    name: "Restricted settings organization",
  },
  capabilities: new Set(),
};

function principal(
  capabilities: readonly string[] = ["memberships.read", "organizations.read"],
): CurrentPrincipalV1 {
  return {
    displayName: "Settings Principal",
    id: PRINCIPAL_ID,
    organizationContexts: [
      {
        capabilities: [...capabilities],
        isOwner: false,
        membershipId: "membership_settings",
        organizationId: ORGANIZATION_ID,
        role: "administrator",
      },
    ],
    resourceVersion: 1,
  };
}

function clientWith(
  overrides: {
    readonly request?: ReturnType<typeof vi.fn>;
    readonly requestWithMetadata?: ReturnType<typeof vi.fn>;
  } = {},
): CloudMarkupClient {
  return {
    request:
      overrides.request ??
      vi.fn().mockRejectedValue(new Error("Unexpected API request")),
    requestWithMetadata:
      overrides.requestWithMetadata ??
      vi.fn().mockRejectedValue(new Error("Unexpected metadata request")),
  } as unknown as CloudMarkupClient;
}

function renderBackend(
  children: ReactNode,
  client: CloudMarkupClient,
): { readonly queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  window.history.replaceState(
    null,
    "",
    `/organizations/${ORGANIZATION_ID}/settings/general`,
  );
  render(
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <RouterProvider>{children}</RouterProvider>
    </CloudMarkupQueryProvider>,
  );
  return { queryClient };
}

describe("personal settings", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps local-owner profile available without probing hosted staff authority", () => {
    const request = vi
      .fn()
      .mockRejectedValue(new Error("Hosted staff unavailable"));
    const queryClient = new QueryClient();
    render(
      <CloudMarkupQueryProvider
        client={clientWith({ request })}
        queryClient={queryClient}
      >
        <RouterProvider>
          <LocalOwnerSessionContext.Provider
            value={{
              session: {} as LocalOwnerBrowserSession,
              signOut: () => Promise.resolve(),
              reauthenticate: () => Promise.resolve(),
            }}
          >
            <PersonalSettingsPage principal={principal()} section="profile" />
          </LocalOwnerSessionContext.Provider>
        </RouterProvider>
      </CloudMarkupQueryProvider>,
    );
    expect(screen.getByText("Verified account")).toBeInTheDocument();
    expect(
      queryClient.getQueryCache().findAll({ queryKey: ["staff-access"] }),
    ).toHaveLength(0);
    expect(request).not.toHaveBeenCalledWith("staff.access.get", {});
  });

  it("renders only verified, read-only profile details from the current principal", () => {
    const currentPrincipal = {
      ...principal(),
      email: "settings.principal@example.com",
    };

    render(
      <RouterProvider>
        <PersonalSettingsPage principal={currentPrincipal} section="profile" />
      </RouterProvider>,
    );

    expect(screen.getByText("Verified account")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: currentPrincipal.displayName,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(currentPrincipal.email)).toBeInTheDocument();
    expect(screen.getByText("1 organization")).toBeInTheDocument();
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    expect(screen.queryByText(/local mock identity/iu)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit|save|update/iu }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Technical identity details"));
    expect(screen.getByText(currentPrincipal.id)).toBeVisible();
  });

  it("states the exact security boundary without inventing account controls", () => {
    render(
      <RouterProvider>
        <PersonalSettingsPage principal={principal()} section="security" />
      </RouterProvider>,
    );

    expect(screen.getByText("Verified session")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Authenticated account",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Managed by your sign-in provider"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Password and email controls require/iu),
    ).toHaveTextContent("Your sign-in provider continues to manage them.");
    expect(
      screen.queryByRole("button", {
        name: /change|configure|manage|reset|save/iu,
      }),
    ).not.toBeInTheDocument();
  });

  it("retains the explicit unverified local-development state", () => {
    render(
      <RouterProvider>
        <PersonalSettingsPage section="profile" />
      </RouterProvider>,
    );

    expect(
      screen.getByText("Personal settings placeholder"),
    ).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(
      screen.getByText(/local mock identity is not a verified account/iu),
    ).toBeInTheDocument();
    expect(screen.queryByText("Verified account")).not.toBeInTheDocument();
  });
});

describe("organization settings", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps local development behavior explicitly synthetic", () => {
    render(<OrganizationSettingsPage section="general" />);

    expect(screen.getByText("Local development fixture")).toBeInTheDocument();
    expect(
      screen.getByText(/Synthetic organization behavior/iu),
    ).toBeInTheDocument();
  });

  it("does not disclose local organization details or offer member actions when view access is denied", () => {
    render(
      <OrganizationSettingsPage identity={deniedIdentity} section="members" />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This settings section is unavailable",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No organization or policy details are disclosed",
    );
    expect(
      screen.queryByText("No organization changes can be made"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /manage|add|invite|save/iu }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(deniedIdentity.organization.name),
    ).not.toBeInTheDocument();
  });

  it("renders a read-only server-authoritative organization overview", async () => {
    const requestWithMetadata = vi.fn().mockResolvedValue({
      data: { apiVersion: "v1", data: organization },
      metadata: { etag: '"organization:7"' },
    });
    const { queryClient } = renderBackend(
      <OrganizationSettingsPage
        organizationId={ORGANIZATION_ID}
        principal={principal()}
        section="general"
      />,
      clientWith({ requestWithMetadata }),
    );

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: organization.displayName,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getAllByText("Active")).toHaveLength(1);
    expect(requestWithMetadata).toHaveBeenCalledWith("organizations.get", {
      path: { organizationId: ORGANIZATION_ID },
    });
    expect(
      queryClient.getQueryData(
        cloudMarkupQueryKeys.organization(PRINCIPAL_ID, ORGANIZATION_ID),
      ),
    ).toEqual({ etag: '"organization:7"', organization });
    expect(
      screen.queryByRole("button", { name: /edit|rename|delete|save/iu }),
    ).not.toBeInTheDocument();
  });

  it("renders a safe retryable error without stale organization data", async () => {
    const requestWithMetadata = vi
      .fn()
      .mockRejectedValue(new TypeError("network details must not render"));
    renderBackend(
      <OrganizationSettingsPage
        organizationId={ORGANIZATION_ID}
        principal={principal()}
        section="general"
      />,
      clientWith({ requestWithMetadata }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Organization details unavailable");
    expect(alert).toHaveTextContent(
      "The request could not be completed. Check its status before trying again.",
    );
    expect(alert).not.toHaveTextContent("network details must not render");
    expect(
      within(alert).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("rejects a cross-tenant route before requesting or disclosing data", () => {
    const request = vi.fn();
    const requestWithMetadata = vi.fn();
    renderBackend(
      <OrganizationSettingsPage
        organizationId="org_other"
        principal={principal()}
        section="general"
      />,
      clientWith({ request, requestWithMetadata }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This settings section is unavailable",
    );
    expect(
      screen.queryByText(organization.displayName),
    ).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    expect(requestWithMetadata).not.toHaveBeenCalled();
  });

  it("rejects and does not cache an organization response from another tenant", async () => {
    const otherOrganization: OrganizationV1 = {
      ...organization,
      displayName: "Do not disclose this organization",
      id: "org_other",
      slug: "other-organization",
    };
    const { queryClient } = renderBackend(
      <OrganizationSettingsPage
        organizationId={ORGANIZATION_ID}
        principal={principal()}
        section="general"
      />,
      clientWith({
        requestWithMetadata: vi.fn().mockResolvedValue({
          data: { apiVersion: "v1", data: otherOrganization },
          metadata: { etag: '"organization:1"' },
        }),
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Organization details unavailable",
    );
    expect(
      screen.queryByText(otherOrganization.displayName),
    ).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        cloudMarkupQueryKeys.organization(PRINCIPAL_ID, ORGANIZATION_ID),
      ),
    ).toBeUndefined();
  });

  it("fails closed before requesting memberships when the capability is absent", () => {
    const request = vi.fn();
    const requestWithMetadata = vi.fn();
    renderBackend(
      <OrganizationSettingsPage
        organizationId={ORGANIZATION_ID}
        principal={principal(["organizations.read"])}
        section="members"
      />,
      clientWith({ request, requestWithMetadata }),
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This settings section is unavailable");
    expect(alert).toHaveTextContent(
      "No organization or membership details are disclosed",
    );
    expect(screen.queryByText("Northstar Engineering")).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    expect(requestWithMetadata).not.toHaveBeenCalled();
  });

  it("renders an authorized read-only member roster", async () => {
    const request = vi.fn().mockResolvedValue({
      apiVersion: "v1",
      data: memberships,
      page: { hasMore: false },
    });
    renderBackend(
      <OrganizationSettingsPage
        organizationId={ORGANIZATION_ID}
        principal={principal()}
        section="members"
      />,
      clientWith({ request }),
    );

    expect(await screen.findByText("Riley Admin")).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Organization member roster",
    });
    expect(within(table).getByText("Administrator")).toBeInTheDocument();
    expect(within(table).getByText("Taylor Viewer")).toBeInTheDocument();
    expect(within(table).getByText("Suspended")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Active members can access shared projects according to their role.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByText("What each role can do"));
    expect(
      screen.getByText(/Authorized invitations can add eligible members/u),
    ).toBeVisible();
    expect(request).toHaveBeenCalledWith("organization-members.list", {
      path: { organizationId: ORGANIZATION_ID },
      query: { "page[limit]": "100" },
    });
    expect(
      screen.queryByRole("button", { name: /invite|remove|change role/iu }),
    ).not.toBeInTheDocument();
  });

  it("loads additional authorized member pages using only the server cursor", async () => {
    const secondMembership: OrganizationMemberV1 = {
      ...firstMembership,
      membershipId: "membership_zmorgan",
      displayName: "Morgan Owner",
      principalId: "principal_morgan",
      role: "owner",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        apiVersion: "v1",
        data: [memberships[0]],
        page: { hasMore: true, nextCursor: "membership_riley" },
      })
      .mockResolvedValueOnce({
        apiVersion: "v1",
        data: [secondMembership],
        page: { hasMore: false },
      });
    renderBackend(
      <OrganizationSettingsPage
        organizationId={ORGANIZATION_ID}
        principal={principal()}
        section="members"
      />,
      clientWith({ request }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Load more members" }),
    );
    expect(await screen.findByText("Morgan Owner")).toBeInTheDocument();
    expect(screen.getByText("Riley Admin")).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith("organization-members.list", {
      path: { organizationId: ORGANIZATION_ID },
      query: {
        "page[cursor]": "membership_riley",
        "page[limit]": "100",
      },
    });
  });

  it("rejects and does not cache cross-tenant membership data", async () => {
    const otherMembership: OrganizationMemberV1 = {
      ...firstMembership,
      membershipId: "membership_other",
      organizationId: "org_other",
      displayName: "Do not disclose this member",
      principalId: "principal_other",
    };
    const { queryClient } = renderBackend(
      <OrganizationSettingsPage
        organizationId={ORGANIZATION_ID}
        principal={principal()}
        section="members"
      />,
      clientWith({
        request: vi.fn().mockResolvedValue({
          apiVersion: "v1",
          data: [otherMembership],
          page: { hasMore: false },
        }),
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Member directory unavailable",
    );
    expect(
      screen.queryByText(otherMembership.displayName),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          cloudMarkupQueryKeys.memberships(PRINCIPAL_ID, ORGANIZATION_ID),
        ),
      ).toBeUndefined();
    });
  });
});
