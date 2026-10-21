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
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudMarkupQueryProvider } from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { OrganizationInvitationPage } from "./OrganizationInvitationPage.js";

const id = "invitation_12345678-1234-4234-8234-123456789abc";
const token = "A".repeat(43);
const actor: CurrentPrincipalV1 = {
  id: "principal_joiner",
  displayName: "Morgan",
  resourceVersion: 1,
  organizationContexts: [],
};
const receipt = {
  contractVersion: 1 as const,
  organizationId: "org_shared",
  membershipId: "membership_joined",
  role: "editor" as const,
  status: "accepted" as const,
};
const joined: CurrentPrincipalV1 = {
  ...actor,
  organizationContexts: [
    {
      organizationId: receipt.organizationId,
      membershipId: receipt.membershipId,
      role: receipt.role,
      isOwner: false,
      capabilities: ["projects.read"],
    },
  ],
};
function denied(
  code:
    | "authentication_required"
    | "conflict"
    | "access_denied" = "authentication_required",
) {
  return new ApiClientError(code === "authentication_required" ? 401 : 403, {
    apiVersion: "v1",
    error: {
      code,
      correlationId: "correlation_invitation",
      message: "Synthetic unsafe details must not appear.",
    },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  options: {
    path?: string;
    anonymous?: boolean;
    accept?: () => Promise<unknown>;
    refreshed?: CurrentPrincipalV1;
    failRefresh?: boolean;
  } = {},
) {
  window.history.replaceState(
    null,
    "",
    options.path ?? `/invitations/${id}#token=${token}`,
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  let authenticated = options.anonymous !== true;
  let accepted = false;
  let refreshFailed = options.failRefresh === true;
  const request = vi.fn<
    (operation: string, input: unknown) => Promise<unknown>
  >(async (operation) => {
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    if (operation === "principal.get") {
      if (!authenticated) throw denied();
      if (accepted && refreshFailed)
        throw new TypeError("Synthetic read failure.");
      return { data: accepted ? (options.refreshed ?? joined) : actor };
    }
    if (operation === "organization-invitations.accept") {
      const response =
        options.accept === undefined
          ? { data: receipt }
          : await options.accept();
      accepted = true;
      return response;
    }
    throw new Error("Unexpected synthetic operation.");
  });
  const startSignIn = vi.fn<(signal: AbortSignal) => Promise<void>>(() => {
    authenticated = true;
    return Promise.resolve();
  });
  const client = { request } as unknown as CloudMarkupClient;
  const view = render(
    <StrictMode>
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <RouterProvider>
          <OrganizationInvitationPage startSignIn={startSignIn} />
        </RouterProvider>
      </CloudMarkupQueryProvider>
    </StrictMode>,
  );
  return {
    ...view,
    request,
    queryClient,
    startSignIn,
    repairRead: () => {
      refreshFailed = false;
    },
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("RAM-only explicit invitation acceptance", () => {
  it("scrubs the URL before any request, keeps the secret out of content/cache/storage, and never joins on mount", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const f = setup();
    expect(await screen.findByText(/Signed in as Morgan/u)).toBeVisible();
    expect(
      f.request.mock.calls.every(
        ([operation]) => operation === "principal.get",
      ),
    ).toBe(true);
    expect(window.location.pathname).toBe(`/invitations/${id}`);
    expect(document.body.textContent).not.toContain(token);
    expect(
      JSON.stringify(
        f.queryClient
          .getQueryCache()
          .getAll()
          .map((query) => [query.queryKey, query.state.data]),
      ),
    ).not.toContain(token);
    expect(f.queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(storage).not.toHaveBeenCalled();
  });
  it("waits for explicit Join, sends body-only proof, then refreshes genuine membership before offering projects", async () => {
    const f = setup();
    await screen.findByText(/Signed in as Morgan/u);
    fireEvent.click(screen.getByRole("button", { name: "Join workspace" }));
    expect(
      await screen.findByRole("link", { name: "Open shared projects" }),
    ).toHaveAttribute("href", "/organizations/org_shared/projects");
    expect(
      f.request.mock.calls.filter(
        ([operation]) => operation === "organization-invitations.accept",
      ),
    ).toEqual([
      [
        "organization-invitations.accept",
        { path: { invitationId: id }, body: { contractVersion: 1, token } },
      ],
    ]);
    expect(f.queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
  it("keeps the invitation through popup sign-in without automatically accepting", async () => {
    const f = setup({ anonymous: true });
    await screen.findByText("Sign in to review and accept this invitation.");
    expect(
      screen.getByRole("button", { name: "Join workspace" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
    expect(await screen.findByText(/Signed in as Morgan/u)).toBeVisible();
    expect(f.startSignIn).toHaveBeenCalledOnce();
    expect(
      f.request.mock.calls.some(
        ([operation]) => operation === "organization-invitations.accept",
      ),
    ).toBe(false);
    expect(window.location.pathname).toBe(`/invitations/${id}`);
    fireEvent.click(screen.getByRole("button", { name: "Join workspace" }));
    await screen.findByRole("link", { name: "Open shared projects" });
  });
  it("retains the accepted receipt when directory refresh fails; retry does not consume the invitation again", async () => {
    const f = setup({ failRefresh: true });
    await screen.findByText(/Signed in as Morgan/u);
    fireEvent.click(screen.getByRole("button", { name: "Join workspace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The invitation was accepted",
    );
    expect(
      screen.queryByRole("link", { name: "Open shared projects" }),
    ).not.toBeInTheDocument();
    f.repairRead();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh workspace access" }),
    );
    await screen.findByRole("link", { name: "Open shared projects" });
    expect(
      f.request.mock.calls.filter(
        ([operation]) => operation === "organization-invitations.accept",
      ),
    ).toHaveLength(1);
  });
  it.each([
    { ...joined, id: "principal_other" },
    { ...joined, organizationContexts: [] },
  ])(
    "does not invent access from a receipt when fresh identity differs",
    async (refreshed) => {
      setup({ refreshed });
      await screen.findByText(/Signed in as Morgan/u);
      fireEvent.click(screen.getByRole("button", { name: "Join workspace" }));
      await screen.findByRole("alert");
      expect(
        screen.queryByRole("link", { name: "Open shared projects" }),
      ).not.toBeInTheDocument();
    },
  );
  it("prevents duplicate accepts and ignores a late completion after unmount", async () => {
    const pending = deferred<unknown>();
    const f = setup({ accept: () => pending.promise });
    await screen.findByText(/Signed in as Morgan/u);
    fireEvent.click(screen.getByRole("button", { name: "Join workspace" }));
    expect(
      screen
        .getAllByRole("button", { name: "Please wait…" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    expect(
      f.request.mock.calls.filter(
        ([operation]) => operation === "organization-invitations.accept",
      ),
    ).toHaveLength(1);
    f.unmount();
    const before = f.request.mock.calls.length;
    await act(async () => {
      pending.resolve({ data: receipt });
      await Promise.resolve();
    });
    expect(f.request).toHaveBeenCalledTimes(before);
  });
  it("keeps the same body proof for explicit retry after an unknown response", async () => {
    let calls = 0;
    const f = setup({
      accept: () =>
        ++calls === 1
          ? Promise.reject(new TypeError("Unconfirmed response"))
          : Promise.resolve({ data: receipt }),
    });
    await screen.findByText(/Signed in as Morgan/u);
    fireEvent.click(screen.getByRole("button", { name: "Join workspace" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Join workspace" }));
    await screen.findByRole("link", { name: "Open shared projects" });
    const attempts = f.request.mock.calls.filter(
      ([operation]) => operation === "organization-invitations.accept",
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
  });
  it.each([
    `/invitations/${id}?token=${token}`,
    `/invitations/${id}#token=invalid`,
    `/invitations/${token}`,
    `/invitations/${id}`,
  ])(
    "fails closed for an unavailable link without account requests",
    (path) => {
      const f = setup({ path });
      expect(
        screen.getByRole("heading", { name: "Invitation link unavailable" }),
      ).toBeVisible();
      expect(f.request).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("");
      expect(document.body.textContent).not.toContain(token);
    },
  );
});
