import {
  ApiClientError,
  type CloudMarkupClient,
  type CurrentPrincipalV1,
  type RecipientOrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudMarkupQueryProvider,
  useOptionalCloudMarkupQueryRuntime,
} from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { OrganizationInvitationComposer } from "./OrganizationInvitationComposer.js";
import { InvitationInbox } from "./AccountInvitationsPage.js";
import { OrganizationSettingsPage } from "../settings/SettingsPages.js";

import { startCognitoSignInWithPopup } from "../auth/cognito-browser-auth.js";
vi.mock("../auth/cognito-browser-auth.js", async (original) => ({
  ...(await original<typeof import("../auth/cognito-browser-auth.js")>()),
  startCognitoSignInWithPopup: vi.fn(),
}));

const item: RecipientOrganizationInvitationV1 = {
  contractVersion: 1,
  id: "invitation_12345678-1234-4234-8234-123456789abc",
  organizationId: "org_team",
  organizationName: "Northstar Team",
  role: "editor",
  expiresAt: "2026-10-01T18:00:00.000Z",
  status: "pending",
  recipient: {
    principalId: "principal_member",
    displayName: "Morgan Member",
    username: "morgan",
  },
};
const owner: CurrentPrincipalV1 = {
  id: "principal_owner",
  displayName: "Owner",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId: "org_team",
      membershipId: "membership_owner",
      role: "owner",
      isOwner: true,
      capabilities: [
        "organizations.read",
        "memberships.read",
        "memberships.manage",
        "projects.read",
      ],
    },
  ],
};
const recipient: CurrentPrincipalV1 = {
  id: "principal_member",
  displayName: "Morgan Member",
  resourceVersion: 1,
  organizationContexts: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  options: {
    inbox?: boolean;
    entries?: readonly RecipientOrganizationInvitationV1[];
    current?: CurrentPrincipalV1;
    override?: (
      operation: string,
      input: unknown,
    ) => Promise<unknown> | undefined;
    settings?: boolean;
    isOwner?: boolean;
  } = {},
) {
  let entries = [...(options.entries ?? [])];
  let current = options.current ?? (options.inbox === true ? recipient : owner);
  const request = vi.fn<
    (operation: string, input: unknown) => Promise<unknown>
  >(async (operation, input) => {
    const override = options.override?.(operation, input);
    if (override !== undefined) return override;
    if (operation === "principal.get") return { data: current };
    if (operation === "commercial.current-plan.get")
      throw Error("Plan offline for synthetic test");
    if (operation === "organization-members.list")
      return { data: [], page: { hasMore: false } };
    if (
      operation === "account.invitations.list" ||
      operation === "organization-member-invitations.list"
    )
      return { data: entries, page: { hasMore: false } };
    if (operation === "organization-member-invitations.create") {
      entries = [item];
      return { data: item };
    }
    if (operation === "organization-invitations.revoke") {
      entries = [{ ...item, status: "revoked" }];
      const {
        organizationName: ignoredName,
        recipient: ignoredRecipient,
        ...legacy
      } = entries[0] ?? item;
      void ignoredName;
      void ignoredRecipient;
      return { data: legacy };
    }
    if (operation === "account.invitations.accept") {
      entries = [{ ...item, status: "accepted" }];
      current = {
        ...recipient,
        organizationContexts: [
          {
            organizationId: item.organizationId,
            membershipId: "membership_member",
            role: "editor",
            isOwner: false,
            capabilities: ["organizations.read", "projects.read"],
          },
        ],
      };
      return {
        data: {
          contractVersion: 1,
          organizationId: item.organizationId,
          membershipId: "membership_member",
          role: "editor",
          status: "accepted",
        },
      };
    }
    if (operation === "account.invitations.decline") {
      entries = [{ ...item, status: "declined" }];
      return { data: entries[0] };
    }
    throw Error(`Unexpected synthetic operation ${operation}`);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  function Surface() {
    const runtime = useOptionalCloudMarkupQueryRuntime();
    if (runtime === null) throw Error("Missing runtime");
    if (options.settings === true)
      return (
        <OrganizationSettingsPage
          principal={current}
          organizationId="org_team"
          section="members"
        />
      );
    return options.inbox === true ? (
      <InvitationInbox runtime={runtime} principal={recipient} />
    ) : (
      <OrganizationInvitationComposer
        runtime={runtime}
        principalId={owner.id}
        organizationId="org_team"
        isOwner={options.isOwner ?? true}
      />
    );
  }
  window.history.replaceState(
    null,
    "",
    options.inbox === true
      ? "/settings/invitations"
      : "/organizations/org_team/settings/members",
  );
  const view = render(
    <CloudMarkupQueryProvider
      client={{ request } as unknown as CloudMarkupClient}
      queryClient={queryClient}
    >
      <RouterProvider>
        <Surface />
      </RouterProvider>
    </CloudMarkupQueryProvider>,
  );
  return { ...view, request, queryClient };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function send() {
  fireEvent.change(screen.getByLabelText("Member username"), {
    target: { value: " Morgan " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
}
describe("recipient-bound invitations", () => {
  it("sends an exact normalized username and confirms its stable recipient before success", async () => {
    const { request } = setup();
    await screen.findByText("No invitations yet.");
    send();
    await screen.findByText(/Invitation sent to Morgan Member/);
    expect(request).toHaveBeenCalledWith(
      "organization-member-invitations.create",
      expect.objectContaining({
        body: {
          contractVersion: 1,
          role: "editor",
          recipient: { kind: "username", username: "morgan" },
        },
        headers: { "idempotency-key": expect.any(String) as unknown },
      }),
    );
    expect(
      request.mock.calls.some(
        ([op]) => op === "organization-invitations.create",
      ),
    ).toBe(false);
    expect(screen.queryByLabelText("Private invitation link")).toBeNull();
  });
  it("preserves the same key, recipient and role across an uncertain response", async () => {
    let tries = 0;
    const { request } = setup({
      override: (op) =>
        op === "organization-member-invitations.create" && ++tries === 1
          ? Promise.reject(Error("Dropped reply"))
          : undefined,
    });
    send();
    await screen.findByRole("button", { name: "Retry same invitation" });
    expect(screen.getByLabelText("Member username")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Edit recipient" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry same invitation" }),
    );
    await screen.findByText(/Invitation sent to Morgan Member/);
    const calls = request.mock.calls.filter(
      ([op]) => op === "organization-member-invitations.create",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toEqual(calls[1]?.[1]);
  });
  it("allows correction after a definitive unavailable-recipient rejection", async () => {
    setup({
      override: (op) =>
        op === "organization-member-invitations.create"
          ? Promise.reject(
              new ApiClientError(404, {
                apiVersion: "v1",
                error: {
                  code: "not_found",
                  message: "Unavailable",
                  correlationId: "request_recipient",
                },
              }),
            )
          : undefined,
    });
    send();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit recipient" }),
    );
    expect(screen.getByLabelText("Member username")).toBeEnabled();
  });
  it("keeps the same invitation attempt after refreshing sign-in", async () => {
    vi.mocked(startCognitoSignInWithPopup).mockResolvedValue(undefined);
    let count = 0;
    const { request } = setup({
      override: (op) =>
        op === "organization-member-invitations.create" && ++count === 1
          ? Promise.reject(Error("Interrupted response"))
          : undefined,
    });
    send();
    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in again" }),
    );
    await screen.findByText(
      "Sign-in refreshed. Retry the same invitation attempt to continue.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry same invitation" }),
    );
    await screen.findByText(/Invitation sent to Morgan Member/);
    const attempts = request.mock.calls.filter(
      ([op]) => op === "organization-member-invitations.create",
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.[1]).toEqual(attempts[1]?.[1]);
  });
  it("aborts an unfinished sign-in when the invitation surface unmounts", async () => {
    const pending = deferred<undefined>();
    vi.mocked(startCognitoSignInWithPopup).mockReturnValue(pending.promise);
    const { unmount } = setup({
      override: (op) =>
        op === "organization-member-invitations.create"
          ? Promise.reject(Error("Interrupted response"))
          : undefined,
    });
    send();
    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in again" }),
    );
    const signal = vi
      .mocked(startCognitoSignInWithPopup)
      .mock.calls.at(-1)?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
  });
  it("does not report success or clear the attempt if readback targets a different user", async () => {
    setup({
      override: (op) =>
        op === "organization-member-invitations.list"
          ? Promise.resolve({
              data: [
                {
                  ...item,
                  recipient: {
                    ...item.recipient,
                    principalId: "principal_other",
                  },
                },
              ],
              page: { hasMore: false },
            })
          : undefined,
    });
    send();
    await screen.findByRole("button", { name: "Retry same invitation" });
    await screen.findByRole("alert");
    expect(screen.queryByText(/Invitation sent to/)).toBeNull();
  });
  it("revokes then resends to the immutable user ID instead of a reused username", async () => {
    const { request } = setup({
      entries: [
        { ...item, recipient: { ...item.recipient, username: "renamed" } },
      ],
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Revoke invitation for Morgan Member",
      }),
    );
    await screen.findByText("Invitation revoked.");
    fireEvent.click(
      screen.getByRole("button", { name: "Invite Morgan Member again" }),
    );
    await screen.findByText(/Invitation sent to Morgan Member/);
    expect(request).toHaveBeenCalledWith(
      "organization-member-invitations.create",
      expect.objectContaining({
        body: {
          contractVersion: 1,
          role: "editor",
          recipient: { kind: "user-id", userId: "principal_member" },
        },
      }),
    );
  });
  it("does not offer administrator invitations to an administrator or offer repeat declined invitations", async () => {
    setup({ isOwner: false, entries: [{ ...item, status: "declined" }] });
    await screen.findByText("Morgan Member");
    expect(screen.queryByRole("option", { name: /Administrator/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Invite Morgan Member again/ }),
    ).toBeNull();
  });
  it("hides the invitation composer without the server manage capability", async () => {
    setup({
      settings: true,
      current: {
        ...owner,
        organizationContexts: owner.organizationContexts.map((context) => ({
          ...context,
          capabilities: ["organizations.read", "memberships.read"],
        })),
      },
    });
    await screen.findByRole("heading", { name: "Organization members" });
    expect(
      screen.queryByRole("button", { name: "Send invitation" }),
    ).toBeNull();
  });
  it("does not publish success after unmount or issue duplicate create requests", async () => {
    const pending = deferred<unknown>();
    const { request, unmount } = setup({
      override: (op) =>
        op === "organization-member-invitations.create"
          ? pending.promise
          : undefined,
    });
    send();
    fireEvent.click(
      screen.getByRole("button", { name: "Updating invitation…" }),
    );
    unmount();
    await act(async () => {
      pending.resolve({ data: item });
      await pending.promise;
    });
    expect(
      request.mock.calls.filter(
        ([op]) => op === "organization-member-invitations.create",
      ),
    ).toHaveLength(1);
  });
  it("requires explicit acceptance and reads back membership before opening a workspace", async () => {
    const { request } = setup({ inbox: true, entries: [item] });
    const accept = await screen.findByRole("button", {
      name: "Accept invitation to Northstar Team",
    });
    expect(
      request.mock.calls.some(([op]) => op === "account.invitations.accept"),
    ).toBe(false);
    fireEvent.click(accept);
    const link = await screen.findByRole("link", { name: "Open workspace" });
    expect(link).toHaveAttribute("href", "/organizations/org_team/projects");
    expect(request).toHaveBeenCalledWith("account.invitations.accept", {
      path: { invitationId: item.id },
      body: { contractVersion: 1 },
    });
  });
  it("declines without creating membership or offering access", async () => {
    const { request } = setup({ inbox: true, entries: [item] });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Decline invitation to Northstar Team",
      }),
    );
    await screen.findByText("Invitation to Northstar Team declined.");
    expect(
      request.mock.calls.some(([op]) => op === "account.invitations.accept"),
    ).toBe(false);
    expect(screen.queryByRole("link", { name: "Open workspace" })).toBeNull();
  });
  it("retries membership readback without accepting twice and never opens another actor's workspace", async () => {
    let changed = true;
    const { request } = setup({
      inbox: true,
      entries: [item],
      override: (op) =>
        op === "principal.get" && changed
          ? Promise.resolve({ data: { ...recipient, id: "principal_other" } })
          : undefined,
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Accept invitation to Northstar Team",
      }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "Open workspace" })).toBeNull();
    changed = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh workspace access" }),
    );
    await screen.findByRole("link", { name: "Open workspace" });
    expect(
      request.mock.calls.filter(([op]) => op === "account.invitations.accept"),
    ).toHaveLength(1);
  });
  it("rejects a foreign-recipient inbox response without showing its organization", async () => {
    setup({
      inbox: true,
      entries: [
        {
          ...item,
          recipient: { ...item.recipient, principalId: "principal_other" },
        },
      ],
    });
    await screen.findByText(
      "Your invitations could not be loaded. Refresh to try again.",
    );
    expect(screen.queryByText("Northstar Team")).toBeNull();
  });
  it("loads the next page with its server cursor", async () => {
    const next = {
      ...item,
      id: "invitation_22345678-1234-4234-8234-123456789abc",
      organizationName: "Second Team",
    };
    const { request } = setup({
      inbox: true,
      override: (op, input) =>
        op === "account.invitations.list"
          ? Promise.resolve(
              JSON.stringify(input).includes("page[cursor]")
                ? { data: [next], page: { hasMore: false } }
                : {
                    data: [item],
                    page: { hasMore: true, nextCursor: item.id },
                  },
            )
          : undefined,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more invitations" }),
    );
    await screen.findByText("Second Team");
    expect(request).toHaveBeenCalledWith("account.invitations.list", {
      query: { "page[limit]": "100", "page[cursor]": item.id },
    });
  });
});
