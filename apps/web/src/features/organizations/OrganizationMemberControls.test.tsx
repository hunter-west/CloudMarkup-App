import {
  ApiClientError,
  type ChangeOrganizationMembershipV1,
  type CurrentPrincipalV1,
  type OrganizationMemberV1,
} from "@cloudmarkup/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { OrganizationMemberControls } from "./OrganizationMemberControls.js";
const now = "2026-09-30T12:00:00.000Z";
const initial: OrganizationMemberV1 = {
  contractVersion: 1,
  organizationId: "org_team",
  membershipId: "membership_owner",
  principalId: "principal_owner",
  displayName: "Alex Owner",
  username: null,
  role: "owner",
  status: "active",
  version: 1,
  etag: '"member:owner:1"',
  joinedAt: now,
  endedAt: null,
  endReason: null,
};
const other: OrganizationMemberV1 = {
  ...initial,
  membershipId: "membership_target",
  principalId: "principal_target",
  displayName: "Morgan Member",
  username: "morgan",
  role: "editor",
  etag: '"member:target:1"',
};
function current(member: OrganizationMemberV1): CurrentPrincipalV1 {
  return {
    id: member.principalId,
    displayName: member.displayName,
    resourceVersion: 1,
    organizationContexts:
      member.status === "active"
        ? [
            {
              organizationId: member.organizationId,
              membershipId: member.membershipId,
              role: member.role,
              isOwner: member.role === "owner",
              capabilities: [
                "organizations.read",
                "projects.read",
                ...(member.role === "owner" || member.role === "administrator"
                  ? ["memberships.read", "memberships.manage"]
                  : []),
              ],
            },
          ]
        : [],
  };
}
function setup(
  options: {
    mode?: "manage" | "leave";
    role?: "owner" | "administrator" | "viewer";
    personal?: boolean;
    override?: (
      operation: string,
      input: unknown,
    ) => Promise<unknown> | undefined;
  } = {},
) {
  let own = { ...initial, role: options.role ?? initial.role },
    target = { ...other };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const request = vi.fn<
    (operation: string, input: unknown) => Promise<unknown>
  >(async (operation, input) => {
    const result = options.override?.(operation, input);
    if (result !== undefined) return result;
    if (operation === "principal.get") return { data: current(own) };
    if (operation === "account.workspaces.get")
      return {
        data: {
          contractVersion: 1,
          id: "org_team",
          principalId: own.principalId,
          displayName: "Team",
          kind: options.personal ? "personal" : "organization",
          role: own.role,
        },
      };
    if (operation === "organization-members.list")
      return { data: [own, target], page: { hasMore: false } };
    if (operation === "organization-members.change") {
      const change = (input as { body: ChangeOrganizationMembershipV1 }).body;
      if (change.action === "set-role")
        target = {
          ...target,
          role: change.role,
          version: 2,
          etag: '"member:target:2"',
        };
      if (change.action === "remove")
        target = {
          ...target,
          status: "removed",
          version: 2,
          etag: '"member:target:2"',
          endedAt: now,
          endReason: "removed",
        };
      if (change.action === "leave")
        own = {
          ...own,
          status: "removed",
          version: 2,
          etag: '"member:owner:2"',
          endedAt: now,
          endReason: "left",
        };
      if (change.action === "transfer-ownership") {
        own = {
          ...own,
          role: "administrator",
          version: 2,
          etag: '"member:owner:2"',
        };
        target = {
          ...target,
          role: "owner",
          version: 2,
          etag: '"member:target:2"',
        };
      }
      const states =
        change.action === "leave"
          ? [own]
          : change.action === "transfer-ownership"
            ? [own, target]
            : [target];
      return {
        data: {
          contractVersion: 1,
          organizationId: "org_team",
          actorPrincipalId: own.principalId,
          action: change.action,
          members: states.map((m) => ({
            membershipId: m.membershipId,
            principalId: m.principalId,
            role: m.role,
            status: m.status,
            version: m.version,
          })),
          occurredAt: now,
        },
      };
    }
    throw Error("Unexpected synthetic operation " + operation);
  });
  const requestWithMetadata = vi.fn(async () => {
    const result = options.override?.("account.membership.get", {});
    if (result !== undefined) return result;
    return { data: { data: own }, metadata: { etag: own.etag } };
  });
  const runtime = {
    client: { request, requestWithMetadata },
    queryClient,
    sessionExpired: false,
    resumeSession: vi.fn(),
  } as unknown as CloudMarkupQueryRuntime;
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OrganizationMemberControls
        runtime={runtime}
        principal={current(own)}
        organizationId="org_team"
        mode={options.mode ?? "manage"}
      />
    </QueryClientProvider>,
  );
  return { ...view, request, requestWithMetadata, queryClient };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Manage member access" }));
  await screen.findByLabelText("Member");
}
function confirm() {
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm membership change" }),
  );
}
afterEach(cleanup);
describe("organization member controls", () => {
  it("reviews a role change before sending and confirms authoritative access", async () => {
    const f = setup();
    await open();
    expect(
      screen.getByLabelText("Organization role permissions"),
    ).toHaveTextContent(
      "run paid workflows within the organization’s plan and credits",
    );
    fireEvent.click(screen.getByRole("button", { name: "Review role change" }));
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "organization-members.change",
      ),
    ).toHaveLength(0);
    expect(screen.getByText(/Change Morgan Member to viewer/)).toBeVisible();
    confirm();
    await screen.findByText(
      "Membership change recorded. Current access has been refreshed.",
    );
    expect(f.request).toHaveBeenCalledWith(
      "organization-members.change",
      expect.objectContaining({
        headers: {
          "if-match": other.etag,
          "idempotency-key": expect.stringMatching(/^membership_/) as unknown,
        },
        body: {
          contractVersion: 1,
          action: "set-role",
          membershipId: other.membershipId,
          role: "viewer",
        },
      }),
    );
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toMatchObject({ id: initial.principalId });
  });
  it("permits backing out before any command is sent", async () => {
    const f = setup();
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Review member removal" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to member details" }),
    );
    await screen.findByLabelText("Member");
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "organization-members.change",
      ),
    ).toHaveLength(0);
  });
  it("withholds roster and management actions when current membership is a viewer", async () => {
    const f = setup({ role: "viewer" });
    fireEvent.click(
      screen.getByRole("button", { name: "Manage member access" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only an owner or administrator",
    );
    expect(screen.queryByLabelText("Member")).not.toBeInTheDocument();
    expect(
      f.request.mock.calls.some(
        ([op]) =>
          op === "organization-members.list" ||
          op === "organization-members.change",
      ),
    ).toBe(false);
  });
  it("transfers ownership with both reviewed versions and demotes the acting owner", async () => {
    const f = setup();
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Review ownership transfer" }),
    );
    expect(screen.getByText(/You will become an administrator/)).toBeVisible();
    confirm();
    await screen.findByText(
      "Membership change recorded. Current access has been refreshed.",
    );
    expect(f.request).toHaveBeenCalledWith(
      "organization-members.change",
      expect.objectContaining({
        headers: {
          "if-match": initial.etag,
          "idempotency-key": expect.any(String) as unknown,
        },
        body: {
          contractVersion: 1,
          action: "transfer-ownership",
          membershipId: initial.membershipId,
          targetMembershipId: other.membershipId,
          targetVersion: 1,
        },
      }),
    );
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toMatchObject({ organizationContexts: [{ role: "administrator" }] });
  });
  it("retains one attempt across an unknown result and repeated clicks", async () => {
    let release!: (value: unknown) => void;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    const f = setup({
      override: (op) =>
        op === "organization-members.change" ? waiting : undefined,
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Review role change" }));
    confirm();
    const button = screen.getByRole("button", { name: "Confirming…" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(
        f.request.mock.calls.filter(
          ([op]) => op === "organization-members.change",
        ),
      ).toHaveLength(1);
    });
    await act(async () => {
      release({ data: { wrong: true } });
      await waiting;
    });
    await screen.findByRole("alert");
    confirm();
    await waitFor(() => {
      expect(
        f.request.mock.calls.filter(
          ([op]) => op === "organization-members.change",
        ),
      ).toHaveLength(2);
    });
    const calls = f.request.mock.calls.filter(
      ([op]) => op === "organization-members.change",
    );
    expect(calls[0]?.[1]).toEqual(calls[1]?.[1]);
  });
  it("keeps a saved receipt when readback fails and never sends the change twice", async () => {
    let fail = false;
    let actorReads = 0;
    const f = setup({
      override: (op) =>
        op === "principal.get" && ++actorReads > 1 && fail
          ? Promise.reject(Error("Read outage"))
          : undefined,
    });
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Review member removal" }),
    );
    fail = true;
    confirm();
    await screen.findByRole("alert");
    fail = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh changed access" }),
    );
    await screen.findByText(
      "Membership change recorded. Current access has been refreshed.",
    );
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "organization-members.change",
      ),
    ).toHaveLength(1);
  });
  it("lets a viewer leave after confirming their current membership", async () => {
    const f = setup({ mode: "leave", role: "viewer" });
    fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Review leaving organization",
      }),
    );
    confirm();
    await screen.findByText(
      "Membership change recorded. Current access has been refreshed.",
    );
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toMatchObject({ organizationContexts: [] });
    expect(
      f.request.mock.calls.filter(([op]) => op === "organization-members.list"),
    ).toHaveLength(0);
  });
  it("hides private-workspace and administrator owner-transfer controls", async () => {
    const f = setup({ mode: "leave", personal: true });
    fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
    await screen.findByText(/personal workspace belongs only to you/);
    expect(
      screen.queryByRole("button", { name: "Review leaving organization" }),
    ).not.toBeInTheDocument();
    f.unmount();
    setup({ role: "administrator" });
    await open();
    expect(
      screen.queryByRole("button", { name: "Review ownership transfer" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Administrator" }),
    ).not.toBeInTheDocument();
  });
  it("requires reload after a stale version and does not replay another action", async () => {
    const f = setup({
      override: (op) =>
        op === "organization-members.change"
          ? Promise.reject(
              new ApiClientError(412, {
                apiVersion: "v1",
                error: {
                  code: "precondition_failed",
                  message: "Changed.",
                  correlationId: "correlation_test",
                },
              }),
            )
          : undefined,
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Review role change" }));
    confirm();
    fireEvent.click(
      await screen.findByRole("button", { name: "Reload membership details" }),
    );
    await screen.findByLabelText("Member");
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "organization-members.change",
      ),
    ).toHaveLength(1);
  });
  it("does not expose a cross-account membership response", async () => {
    const f = setup({
      override: (op) =>
        op === "account.membership.get"
          ? Promise.resolve({
              data: { data: { ...initial, principalId: "principal_other" } },
              metadata: { etag: initial.etag },
            })
          : undefined,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Manage member access" }),
    );
    await screen.findByText("Current membership details could not be loaded.");
    expect(screen.queryByLabelText("Member")).not.toBeInTheDocument();
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "organization-members.change",
      ),
    ).toHaveLength(0);
  });
  it("keeps confirmation locked while current-account verification is pending", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const f = setup({
      override: (op) => (op === "principal.get" ? pending : undefined),
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Review role change" }));
    confirm();
    const back = screen.getByRole("button", { name: "Back to member details" });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "organization-members.change",
      ),
    ).toHaveLength(0);
    await act(async () => {
      release({ data: current(initial) });
      await pending;
    });
    await screen.findByText(
      "Membership change recorded. Current access has been refreshed.",
    );
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "organization-members.change",
      ),
    ).toHaveLength(1);
  });
  it("checks the active account before sending a reviewed change", async () => {
    const f = setup({
      override: (op) =>
        op === "principal.get"
          ? Promise.resolve({
              data: current({ ...initial, principalId: "principal_switched" }),
            })
          : undefined,
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Review role change" }));
    confirm();
    await screen.findByRole("alert");
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "organization-members.change",
      ),
    ).toHaveLength(0);
  });
});
