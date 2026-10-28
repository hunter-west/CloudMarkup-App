/** @vitest-environment-options {"url":"https://app.example.test"} */
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
import { subscribeToGitLabLinkCallback } from "../exports/gitlab-link-relay.js";
import { OrganizationSettingsPage } from "./SettingsPages.js";
vi.mock("../exports/gitlab-link-relay.js", () => ({
  subscribeToGitLabLinkCallback: vi.fn(),
}));
vi.mock("./GitHubIntegrationSettings.js", () => ({
  GitHubIntegrationSettings: () => <p>Existing GitHub integration</p>,
}));
const organizationId = "org_gitlab_settings";
const connected = {
  contractVersion: 1,
  id: "gitlab_" + "a".repeat(32),
  organizationId,
  principalId: "principal_gitlab_settings",
  providerUsername: "synthetic-gitlab-user",
  status: "active",
  providerRevocation: "not-requested",
} as const;
const state = "s".repeat(43);
function intent() {
  const parameters = new URLSearchParams({
    client_id: "a".repeat(64),
    redirect_uri: window.location.origin + "/account/gitlab/callback",
    response_type: "code",
    state,
    scope: "api",
    code_challenge: "c".repeat(43),
    code_challenge_method: "S256",
  });
  return {
    contractVersion: 1 as const,
    intentId: "gitlablink_" + "b".repeat(32),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    authorizationUrl:
      "https://gitlab.com/oauth/authorize?" + parameters.toString(),
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
    id: connected.principalId,
    displayName: "Integration owner",
    resourceVersion: 1,
    organizationContexts: [
      {
        organizationId,
        membershipId: "membership_gitlab_settings",
        role: "owner",
        isOwner: true,
        capabilities,
      },
    ],
  };
}
function collection(data: unknown[] = [], nextCursor?: string) {
  return {
    apiVersion: "v1",
    data,
    page: {
      hasMore: nextCursor !== undefined,
      ...(nextCursor ? { nextCursor } : {}),
    },
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
  vi.mocked(subscribeToGitLabLinkCallback).mockReturnValue(vi.fn());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("GitLab account integration settings", () => {
  it("makes no request without workspace permission or membership", () => {
    const request = vi.fn();
    mount(request, principal(["organizations.read"]));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
    cleanup();
    mount(request, principal(), "org_other");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });
  it("lists actor-owned connections beside GitHub and discloses broad provider permission", async () => {
    const request = vi.fn().mockResolvedValue(collection([connected]));
    mount(request);
    expect(
      await screen.findByText(/Member-owned connection/),
    ).toHaveTextContent("Other members cannot use your GitLab authorization");
    expect(await screen.findByText(connected.providerUsername)).toBeVisible();
    expect(screen.getByText("Existing GitHub integration")).toBeVisible();
    expect(screen.getByText(/GitLab requests broad access/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Connect GitLab" }),
    ).toBeEnabled();
    expect(request).toHaveBeenCalledExactlyOnceWith("gitlab-connections.list", {
      path: { organizationId },
      query: { limit: 50 },
    });
  });
  it.each(["organization", "actor", "credential", "duplicate"])(
    "rejects %s substitution without displaying private details",
    async (kind) => {
      const bad = {
        ...connected,
        providerUsername: "private-other-user",
        ...(kind === "organization"
          ? { organizationId: "org_other" }
          : kind === "actor"
            ? { principalId: "principal_other" }
            : kind === "credential"
              ? { sealedGrant: "private-envelope" }
              : {}),
      };
      mount(
        vi
          .fn()
          .mockResolvedValue(
            collection(kind === "duplicate" ? [bad, bad] : [bad]),
          ),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "could not be verified",
      );
      expect(screen.queryByText("private-other-user")).toBeNull();
    },
  );
  it("keeps read permission separate from connection management", async () => {
    mount(
      vi.fn().mockResolvedValue(collection([connected])),
      principal(["organizations.read", "integrations.read"]),
    );
    await screen.findByText(connected.providerUsername);
    expect(screen.queryByRole("button", { name: "Connect GitLab" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Disconnect/ })).toBeNull();
  });
  it("shows unavailable configuration without exposing provider diagnostics", async () => {
    mount(
      vi.fn().mockRejectedValue(
        new ApiClientError(503, {
          apiVersion: "v1",
          error: {
            code: "service_unavailable",
            correlationId: "correlation_gitlab",
            message: "sensitive-provider-detail",
          },
        }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "unavailable in this deployment",
    );
    expect(document.body.textContent).not.toContain(
      "sensitive-provider-detail",
    );
    expect(screen.queryByRole("button", { name: "Connect GitLab" })).toBeNull();
    expect(
      screen.queryByText(/Connect your GitLab.com account/u),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/GitLab availability must be confirmed/u),
    ).toBeVisible();
  });
  it("stops pending authorization when current connection access is denied", async () => {
    let denied = false;
    const stop = vi.fn();
    vi.mocked(subscribeToGitLabLinkCallback).mockReturnValue(stop);
    const request = vi.fn().mockImplementation((operation: string) => {
      if (operation === "gitlab-connections.list") {
        if (denied)
          return Promise.reject(
            new ApiClientError(403, {
              apiVersion: "v1",
              error: {
                code: "access_denied",
                correlationId: "correlation_gitlab_revoked",
                message: "Connection access is unavailable.",
              },
            }),
          );
        return Promise.resolve(collection([connected]));
      }
      if (operation === "gitlab-link-intents.create")
        return Promise.resolve({ data: intent() });
      throw Error("Unexpected synthetic request");
    });
    mount(request);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect GitLab" }),
    );
    expect(
      await screen.findByRole("link", { name: "Continue to GitLab" }),
    ).toBeVisible();
    denied = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Reload GitLab status" }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(connected.providerUsername)).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Continue to GitLab" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Connect GitLab|Start new GitLab connection|Disconnect /,
      }),
    ).toBeNull();
    expect(stop).toHaveBeenCalled();
    expect(
      request.mock.calls.some(
        ([operation]) => operation === "gitlab-link-completions.create",
      ),
    ).toBe(false);
  });
  it("prepares an exact callback and completes only from the original authenticated tab", async () => {
    const next = intent();
    let linked = false;
    const request = vi.fn().mockImplementation((operation: string) => {
      if (operation === "gitlab-connections.list")
        return Promise.resolve(collection(linked ? [connected] : []));
      if (operation === "gitlab-link-intents.create")
        return Promise.resolve({ data: next });
      if (operation === "gitlab-link-completions.create") {
        linked = true;
        return Promise.resolve({ data: connected });
      }
      throw Error("Unexpected request");
    });
    mount(request);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect GitLab" }),
    );
    const link = await screen.findByRole("link", {
      name: "Continue to GitLab",
    });
    expect(link).toHaveAttribute("href", next.authorizationUrl);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    await waitFor(() => {
      expect(subscribeToGitLabLinkCallback).toHaveBeenCalledOnce();
    });
    const pending = vi.mocked(subscribeToGitLabLinkCallback).mock.calls[0]?.[0];
    expect(pending?.state).toBe(state);
    await act(async () => {
      await pending?.onCallback({ state, code: "c".repeat(48) });
    });
    expect(
      await screen.findByText(
        "GitLab connection saved. Review its status above.",
      ),
    ).toBeVisible();
    expect(request).toHaveBeenCalledWith("gitlab-link-completions.create", {
      path: { organizationId },
      body: {
        contractVersion: 1,
        intentId: next.intentId,
        state,
        code: "c".repeat(48),
      },
    });
  });
  it.each(["redirect", "expired", "host"])(
    "rejects an unsafe %s authorization link",
    async (kind) => {
      const next = intent();
      const url = new URL(next.authorizationUrl);
      if (kind === "redirect")
        url.searchParams.set(
          "redirect_uri",
          "https://other.example/account/gitlab/callback",
        );
      if (kind === "host") url.hostname = "evil.example";
      if (kind === "expired") next.expiresAt = new Date(0).toISOString();
      next.authorizationUrl = url.toString();
      mount(
        vi
          .fn()
          .mockImplementation((operation: string) =>
            Promise.resolve(
              operation === "gitlab-connections.list"
                ? collection()
                : { data: next },
            ),
          ),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "Connect GitLab" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "could not be verified",
      );
      expect(
        screen.queryByRole("link", { name: "Continue to GitLab" }),
      ).toBeNull();
      expect(subscribeToGitLabLinkCallback).not.toHaveBeenCalled();
    },
  );
  it("disconnects the selected connection and retains provider-side revocation guidance", async () => {
    let disconnected = false;
    const revoked = {
      ...connected,
      status: "disconnected",
      providerRevocation: "requires-user-action",
    };
    const request = vi.fn().mockImplementation((operation: string) => {
      if (operation === "gitlab-connections.list")
        return Promise.resolve(
          collection([disconnected ? revoked : connected]),
        );
      if (operation === "gitlab-connections.disconnect") {
        disconnected = true;
        return Promise.resolve({ data: revoked });
      }
      throw Error("Unexpected request");
    });
    mount(request);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Disconnect " + connected.providerUsername,
      }),
    );
    expect(
      await screen.findByText(
        /cannot confirm that all GitLab access was revoked/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "GitLab applications" }),
    ).toHaveAttribute(
      "href",
      "https://gitlab.com/-/user_settings/applications",
    );
    expect(request).toHaveBeenCalledWith("gitlab-connections.disconnect", {
      path: { organizationId, connectionId: connected.id },
      body: { contractVersion: 1 },
    });
    expect(screen.queryByRole("button", { name: /Disconnect / })).toBeNull();
  });
  it("loads only the next validated page on request", async () => {
    const second = {
      ...connected,
      id: "gitlab_" + "b".repeat(32),
      providerUsername: "second-synthetic-user",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(collection([connected], connected.id))
      .mockResolvedValueOnce(collection([second]));
    mount(request);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Load more GitLab connections",
      }),
    );
    expect(await screen.findByText(second.providerUsername)).toBeVisible();
    expect(request).toHaveBeenLastCalledWith("gitlab-connections.list", {
      path: { organizationId },
      query: { limit: 50, cursor: connected.id },
    });
  });
});
