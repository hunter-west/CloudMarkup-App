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
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { subscribeToGitHubInstallationLinkCallback } from "../exports/github-installation-link-relay.js";
import { OrganizationSettingsPage } from "./SettingsPages.js";

vi.mock("../exports/github-installation-link-relay.js", () => ({
  subscribeToGitHubInstallationLinkCallback: vi.fn(),
}));
vi.mock("./GitLabIntegrationSettings.js", () => ({
  GitLabIntegrationSettings: () => null,
}));
const organizationId = "org_github_settings";
const installed = {
  accountId: 123,
  accountLogin: "fixture-owner",
  accountType: "User",
  createdAt: "2026-08-03T14:30:00.000Z",
  integrationId: "integration_settings",
  installationId: 456,
  organizationId,
  permissions: {
    contents: "write",
    metadata: "read",
    pullRequests: "write",
    workflows: "none",
  },
  repositorySelection: "selected",
  status: "connected",
  updatedAt: "2026-08-03T14:30:00.000Z",
} as const;
function intent() {
  return {
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    intentId: "githublink_settings",
    state: "a".repeat(48),
    installationUrl: `https://github.com/apps/cloudmarkup-example-beta/installations/new?state=${"a".repeat(48)}`,
  };
}
function principal(
  capabilities = [
    "organizations.read",
    "integrations.read",
    "integrations.manage",
  ],
): CurrentPrincipalV1 {
  return {
    id: "principal_github_settings",
    displayName: "Integration owner",
    resourceVersion: 1,
    organizationContexts: [
      {
        organizationId,
        membershipId: "membership_github_settings",
        role: "owner",
        isOwner: true,
        capabilities,
      },
    ],
  };
}
function mount(
  request: ReturnType<typeof vi.fn>,
  currentPrincipal = principal(),
  selector = organizationId,
) {
  const callRequest = request as unknown as (
    operation: string,
    input: unknown,
  ) => unknown;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  window.history.replaceState(
    null,
    "",
    `/organizations/${selector}/settings/integrations`,
  );
  const view = render(
    <CloudMarkupQueryProvider
      client={
        {
          request: (operation: string, input: unknown) =>
            operation === "account.workspaces.get"
              ? Promise.resolve({
                  data: {
                    contractVersion: 1,
                    principalId: currentPrincipal.id,
                    id: selector,
                    displayName: "Integration test workspace",
                    kind: "organization",
                    role:
                      currentPrincipal.organizationContexts.find(
                        (context) => context.organizationId === selector,
                      )?.role ?? "owner",
                  },
                })
              : Promise.resolve(callRequest(operation, input)),
        } as unknown as CloudMarkupClient
      }
      queryClient={queryClient}
    >
      <RouterProvider>
        <OrganizationSettingsPage
          organizationId={selector}
          principal={currentPrincipal}
          section="integrations"
        />
      </RouterProvider>
    </CloudMarkupQueryProvider>,
  );
  return { ...view, queryClient };
}
beforeEach(() => {
  vi.mocked(subscribeToGitHubInstallationLinkCallback).mockReturnValue(vi.fn());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("organization GitHub integrations", () => {
  it("does not request or disclose integrations without the verified capability or matching organization", () => {
    const request = vi.fn();
    mount(request, principal(["organizations.read"]));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
    cleanup();
    mount(request, principal(), "org_other");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("lists connected accounts and discovers repositories only on request", async () => {
    const request = vi.fn().mockImplementation((operation: string) => {
      if (operation === "github-installations.list")
        return Promise.resolve({ data: [installed] });
      if (operation === "github-repositories.list")
        return Promise.resolve({
          data: [
            {
              archived: false,
              defaultBranch: "main",
              disabled: false,
              installationId: 456,
              integrationId: installed.integrationId,
              name: "notes-api",
              nodeId: "R_fixture",
              organizationId,
              owner: "fixture-owner",
              private: true,
              pushedAt: null,
              repositoryId: 789,
              updatedAt: installed.updatedAt,
            },
          ],
        });
      throw new Error("Unexpected request");
    });
    mount(request);
    expect(
      await screen.findByText(/Shared organization connection/),
    ).toHaveTextContent("Editors, administrators and owners");
    expect(
      await screen.findByText("fixture-owner", { exact: true }),
    ).toBeVisible();
    expect(
      screen.queryByRole("navigation", {
        name: "Organization settings sections",
      }),
    ).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View repositories" }));
    expect(await screen.findByText("fixture-owner/notes-api")).toBeVisible();
    expect(request).toHaveBeenCalledWith("github-repositories.list", {
      path: { organizationId, integrationId: installed.integrationId },
    });
  });

  it("does not reveal installation data bound to another organization", async () => {
    mount(
      vi.fn().mockResolvedValue({
        data: [
          {
            ...installed,
            organizationId: "org_other",
            accountLogin: "private-other-owner",
          },
        ],
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be verified",
    );
    expect(screen.queryByText("private-other-owner")).toBeNull();
  });

  it("keeps read-only connections available without a connect action", async () => {
    mount(
      vi.fn().mockResolvedValue({ data: [installed] }),
      principal(["organizations.read", "integrations.read"]),
    );
    await screen.findByText("fixture-owner");
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    expect(
      screen.getByText(
        "Ask an organization owner or administrator to connect GitHub.",
      ),
    ).toBeVisible();
  });

  it("reports unavailable providers without implying a configured connection", async () => {
    mount(
      vi.fn().mockRejectedValue(
        new ApiClientError(503, {
          apiVersion: "v1",
          error: {
            code: "service_unavailable",
            correlationId: "correlation_integration_unavailable",
            message: "Sensitive provider diagnostics must not be rendered.",
          },
        }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GitHub connections are unavailable in this deployment. No connection was created.",
    );
    expect(screen.queryByText(/Sensitive provider diagnostics/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    expect(
      screen.queryByText(
        "No GitHub accounts are connected to this organization.",
      ),
    ).toBeNull();
  });

  it("does not disclose repositories from an installation outside the selected connection", async () => {
    mount(
      vi.fn().mockImplementation((operation: string) =>
        Promise.resolve({
          data:
            operation === "github-installations.list"
              ? [installed]
              : [
                  {
                    organizationId,
                    integrationId: installed.integrationId,
                    installationId: 999,
                    repositoryId: 789,
                    owner: "private-other-owner",
                    name: "private-other-repository",
                  },
                ],
        }),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "View repositories" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be verified",
    );
    expect(screen.queryByText(/private-other/)).toBeNull();
  });

  it("creates an exact intent, opens GitHub separately, and completes through the pending original tab", async () => {
    const next = intent();
    let connected = false;
    const request = vi.fn().mockImplementation((operation: string) => {
      if (operation === "github-installations.list")
        return Promise.resolve({ data: connected ? [installed] : [] });
      if (operation === "github-installation-link-intents.create")
        return Promise.resolve({ data: next });
      if (operation === "github-installation-link-completions.create") {
        connected = true;
        return Promise.resolve({ data: installed });
      }
      throw new Error("Unexpected request");
    });
    mount(request);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect GitHub" }),
    );
    const link = await screen.findByRole("link", {
      name: "Continue to GitHub",
    });
    expect(link).toHaveAttribute("href", next.installationUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(request).toHaveBeenCalledWith(
      "github-installation-link-intents.create",
      { body: { contractVersion: 1 }, path: { organizationId } },
    );
    await waitFor(() => {
      expect(subscribeToGitHubInstallationLinkCallback).toHaveBeenCalledOnce();
    });
    const pending = vi.mocked(subscribeToGitHubInstallationLinkCallback).mock
      .calls[0]?.[0];
    expect(pending?.intentId).toBe(next.intentId);
    const callback = {
      contractVersion: 1,
      intentId: next.intentId,
      callbackReceipt: "b".repeat(48),
    } as const;
    await act(async () => {
      await pending?.onCallback(callback);
    });
    expect(
      await screen.findByText(
        "GitHub connected. Repository access is limited to the verified installation.",
      ),
    ).toBeVisible();
    expect(request).toHaveBeenCalledWith(
      "github-installation-link-completions.create",
      { body: callback, path: { organizationId } },
    );
    expect(
      screen.queryByRole("link", { name: "Continue to GitHub" }),
    ).toBeNull();
  });

  it("rejects an unsafe installation URL without creating a navigation link", async () => {
    const request = vi.fn().mockImplementation((operation: string) =>
      Promise.resolve({
        data:
          operation === "github-installations.list"
            ? []
            : { ...intent(), installationUrl: "https://attacker.example/" },
      }),
    );
    mount(request);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect GitHub" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be verified",
    );
    expect(
      screen.queryByRole("link", { name: "Continue to GitHub" }),
    ).toBeNull();
    expect(subscribeToGitHubInstallationLinkCallback).not.toHaveBeenCalled();
  });
});
