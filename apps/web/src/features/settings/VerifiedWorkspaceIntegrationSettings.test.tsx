import {
  ApiClientError,
  type AccountWorkspaceV1,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudMarkupQueryRuntime } from "../../api/index.js";
import { VerifiedWorkspaceIntegrationSettings } from "./VerifiedWorkspaceIntegrationSettings.js";

vi.mock("./GitHubIntegrationSettings.js", () => ({
  GitHubIntegrationSettings: ({
    organizationId,
    workspaceKind,
  }: {
    organizationId: string;
    workspaceKind: string;
  }) => (
    <p>
      GitHub: {organizationId} / {workspaceKind}
    </p>
  ),
}));
vi.mock("./GitLabIntegrationSettings.js", () => ({
  GitLabIntegrationSettings: ({
    organizationId,
    workspaceKind,
  }: {
    organizationId: string;
    workspaceKind: string;
  }) => (
    <p>
      GitLab: {organizationId} / {workspaceKind}
    </p>
  ),
}));
const workspace: AccountWorkspaceV1 = {
  contractVersion: 1,
  id: "org_fixture",
  principalId: "principal_fixture",
  kind: "organization",
  displayName: "Fixture",
  role: "owner",
};
const principal: CurrentPrincipalV1 = {
  id: workspace.principalId,
  displayName: "Fixture owner",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId: workspace.id,
      membershipId: "membership_fixture",
      role: "owner",
      isOwner: true,
      capabilities: ["integrations.read", "integrations.manage"],
    },
  ],
};
function setup(
  request: ReturnType<typeof vi.fn>,
  actor = principal,
  sessionExpired = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const runtime = {
    client: { request },
    queryClient,
    sessionExpired,
  } as unknown as CloudMarkupQueryRuntime;
  render(
    <QueryClientProvider client={queryClient}>
      <VerifiedWorkspaceIntegrationSettings
        runtime={runtime}
        principal={actor}
        organizationId={workspace.id}
      />
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
describe("verified integration route scope", () => {
  it.each(["organization", "personal"] as const)(
    "renders the server verified %s kind through either route shape",
    async (kind) => {
      const request = vi
        .fn()
        .mockResolvedValue({ data: { ...workspace, kind } });
      setup(request);
      expect(
        await screen.findByText(`GitHub: org_fixture / ${kind}`),
      ).toBeVisible();
      expect(screen.getByText(`GitLab: org_fixture / ${kind}`)).toBeVisible();
      expect(
        screen.getByRole("heading", {
          name:
            kind === "personal"
              ? "Personal integrations"
              : "Organization integrations",
        }),
      ).toBeVisible();
      const bitbucket = screen.getByRole("region", { name: "Bitbucket" });
      expect(within(bitbucket).getByText("Coming soon")).toBeVisible();
      expect(
        within(bitbucket).getByText(
          kind === "personal"
            ? "Bitbucket Cloud is planned for your personal projects."
            : "Bitbucket Cloud is planned for this organization's projects.",
        ),
      ).toBeVisible();
      const connect = within(bitbucket).getByRole("button", {
        name: "Connect Bitbucket",
      });
      expect(connect).toBeDisabled();
      fireEvent.click(connect);
      expect(request).toHaveBeenCalledExactlyOnceWith(
        "account.workspaces.get",
        { path: { organizationId: workspace.id } },
      );
    },
  );
  it.each([
    {
      name: "membership absent",
      actor: { ...principal, organizationContexts: [] },
      expired: false,
    },
    {
      name: "integration permission absent",
      actor: {
        ...principal,
        organizationContexts: principal.organizationContexts.map((context) => ({
          ...context,
          capabilities: ["organizations.read"],
        })),
      },
      expired: false,
    },
    { name: "session expired", actor: principal, expired: true },
  ])("does not request integration scope when $name", ({ actor, expired }) => {
    const request = vi.fn();
    setup(request, actor, expired);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByText(/GitHub:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Bitbucket" }),
    ).not.toBeInTheDocument();
  });
  it.each([
    { name: "tenant", response: { ...workspace, id: "org_other" } },
    {
      name: "actor",
      response: { ...workspace, principalId: "principal_other" },
    },
    { name: "current role", response: { ...workspace, role: "editor" } },
  ])(
    "withholds provider controls on mismatched $name",
    async ({ response }) => {
      setup(vi.fn().mockResolvedValue({ data: response }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "could not be verified",
      );
      expect(screen.queryByText(/GitHub:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/GitLab:/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Bitbucket" }),
      ).not.toBeInTheDocument();
    },
  );
  it("withholds providers when the server denies current workspace access", async () => {
    setup(
      vi.fn().mockRejectedValue(
        new ApiClientError(403, {
          apiVersion: "v1",
          error: {
            code: "access_denied",
            message: "Access is unavailable.",
            correlationId: "correlation_fixture",
          },
        }),
      ),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(/GitHub:/)).not.toBeInTheDocument();
  });
});
