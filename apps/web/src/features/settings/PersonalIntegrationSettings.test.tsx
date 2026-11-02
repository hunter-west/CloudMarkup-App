import type {
  AccountWorkspaceV1,
  CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
import { PersonalIntegrationSettings } from "./PersonalIntegrationSettings.js";

vi.mock("./GitHubIntegrationSettings.js", () => ({
  GitHubIntegrationSettings: ({
    organizationId,
    principal,
    workspaceKind,
  }: {
    organizationId: string;
    principal: CurrentPrincipalV1;
    workspaceKind: string;
  }) => (
    <p>
      GitHub scope: {organizationId} / {principal.id} / {workspaceKind}
    </p>
  ),
}));
vi.mock("./GitLabIntegrationSettings.js", () => ({
  GitLabIntegrationSettings: ({
    organizationId,
  }: {
    organizationId: string;
  }) => <p>GitLab scope: {organizationId}</p>,
}));

const workspace: AccountWorkspaceV1 = {
  contractVersion: 1,
  id: "org_personal_fixture",
  principalId: "principal_fixture",
  kind: "personal",
  role: "owner",
  displayName: "Personal",
};
const shared: AccountWorkspaceV1 = {
  ...workspace,
  id: "org_shared_fixture",
  kind: "organization",
  displayName: "Team",
};
const principal: CurrentPrincipalV1 = {
  id: workspace.principalId,
  displayName: "Fixture owner",
  resourceVersion: 1,
  organizationContexts: [],
};
const owner: CurrentPrincipalV1 = {
  ...principal,
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
const list = (data: readonly AccountWorkspaceV1[], hasMore = false) => ({
  apiVersion: "v1",
  data,
  page: { hasMore },
});
function setup(request: ReturnType<typeof vi.fn>, sessionExpired = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const runtime = {
    client: { request },
    queryClient,
    sessionExpired,
  } as unknown as CloudMarkupQueryRuntime;
  queryClient.setQueryData(cloudMarkupQueryKeys.currentPrincipal(), principal);
  render(
    <QueryClientProvider client={queryClient}>
      <PersonalIntegrationSettings principal={principal} runtime={runtime} />
    </QueryClientProvider>,
  );
  return queryClient;
}
afterEach(cleanup);

describe("verified personal integration settings", () => {
  it("selects the verified private tenant and owner without shared organization membership", async () => {
    const request = vi.fn((operation: string) => {
      if (operation === "account.workspaces.list")
        return Promise.resolve(list([shared, workspace]));
      if (operation === "account.workspaces.get")
        return Promise.resolve({ data: workspace });
      if (operation === "principal.get")
        return Promise.resolve({ data: owner });
      throw Error("Unexpected synthetic operation");
    });
    setup(request);
    expect(
      await screen.findByText(
        "GitHub scope: org_personal_fixture / principal_fixture / personal",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("GitLab scope: org_personal_fixture"),
    ).toBeVisible();
    const bitbucket = screen.getByRole("region", { name: "Bitbucket" });
    expect(within(bitbucket).getByText("Coming soon")).toBeVisible();
    expect(within(bitbucket).getByText(/personal projects/)).toBeVisible();
    const connect = within(bitbucket).getByRole("button", {
      name: "Connect Bitbucket",
    });
    expect(connect).toBeDisabled();
    fireEvent.click(connect);
    expect(request.mock.calls.some(([op]) => op.startsWith("bitbucket"))).toBe(
      false,
    );
    expect(request).toHaveBeenCalledWith("account.workspaces.get", {
      path: { organizationId: workspace.id },
    });
    expect(request.mock.calls.some(([op]) => op.includes("create"))).toBe(
      false,
    );
  });

  it("never uses an organization as the personal fallback or provisions on mount", async () => {
    const request = vi.fn().mockResolvedValue(list([shared]));
    setup(request);
    expect(
      await screen.findByRole("button", { name: "Create personal workspace" }),
    ).toBeVisible();
    expect(screen.queryByText(/GitHub scope:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Bitbucket" }),
    ).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "another actor's directory",
      directory: list([{ ...workspace, principalId: "principal_other" }]),
      readback: workspace,
      actor: owner,
    },
    {
      name: "duplicate personal tenants",
      directory: list([workspace, { ...workspace, id: "org_other_personal" }]),
      readback: workspace,
      actor: owner,
    },
    {
      name: "incomplete directory",
      directory: list([workspace], true),
      readback: workspace,
      actor: owner,
    },
    {
      name: "shared readback",
      directory: list([workspace]),
      readback: { ...workspace, kind: "organization" },
      actor: owner,
    },
    {
      name: "wrong tenant readback",
      directory: list([workspace]),
      readback: { ...workspace, id: "org_other" },
      actor: owner,
    },
    {
      name: "changed account session",
      directory: list([workspace]),
      readback: workspace,
      actor: { ...owner, id: "principal_other" },
    },
    {
      name: "revoked current membership",
      directory: list([workspace]),
      readback: workspace,
      actor: principal,
    },
  ])("withholds controls for $name", async ({ directory, readback, actor }) => {
    const request = vi.fn((operation: string) =>
      Promise.resolve(
        operation === "account.workspaces.list"
          ? directory
          : { data: operation === "principal.get" ? actor : readback },
      ),
    );
    setup(request);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be verified/,
    );
    expect(screen.queryByText(/GitHub scope:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Bitbucket" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create personal workspace" }),
    ).not.toBeInTheDocument();
  });

  it("creates only on request and verifies current ownership before exposing providers", async () => {
    let created = false;
    const request = vi.fn((operation: string) => {
      if (operation === "account.workspaces.list")
        return Promise.resolve(list(created ? [workspace] : []));
      if (operation === "account.personal-workspace.create") {
        created = true;
        return Promise.resolve({ data: workspace });
      }
      if (operation === "account.workspaces.get")
        return Promise.resolve({ data: workspace });
      if (operation === "principal.get")
        return Promise.resolve({ data: owner });
      throw Error("Unexpected synthetic operation");
    });
    const queryClient = setup(request);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create personal workspace" }),
    );
    expect(await screen.findByText(/GitHub scope:/)).toBeVisible();
    await waitFor(() => {
      expect(
        queryClient.getQueryState(cloudMarkupQueryKeys.currentPrincipal())
          ?.isInvalidated,
      ).toBe(true);
    });
    expect(
      queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toEqual(principal);
    expect(
      request.mock.calls.filter(
        ([op]) => op === "account.personal-workspace.create",
      ),
    ).toHaveLength(1);
  });

  it("does not create a personal workspace after the signed-in account changes", async () => {
    const request = vi.fn((operation: string) =>
      Promise.resolve(
        operation === "account.workspaces.list"
          ? list([])
          : { data: { ...principal, id: "principal_other" } },
      ),
    );
    setup(request);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create personal workspace" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be verified/,
    );
    expect(
      request.mock.calls.some(
        ([op]) => op === "account.personal-workspace.create",
      ),
    ).toBe(false);
  });

  it("does not start integration access after session expiry", () => {
    const request = vi.fn();
    setup(request, true);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in again");
    expect(request).not.toHaveBeenCalled();
  });
});
