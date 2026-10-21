import {
  ApiClientError,
  type ApiErrorCode,
  type CurrentPrincipalV1,
  type StaffAccountV1,
  type StaffActionReceiptV1,
} from "@cloudmarkup/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { RouterProvider } from "../../routing/index.js";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { StaffWorkspace } from "./StaffAccountsPage.js";
const principal: CurrentPrincipalV1 = {
  id: "principal_staff",
  displayName: "Synthetic staff",
  resourceVersion: 1,
  organizationContexts: [],
};
const account: StaffAccountV1 = {
  contractVersion: 1,
  organizationId: "org_target",
  billingAccountId: "billing_target",
  displayName: "Synthetic workspace",
  kind: "personal",
  organizationState: "active",
  billingState: "active",
  subscriptionState: "active",
  planDisplayName: "Professional",
  expensiveOperationsEnabled: true,
  version: 1,
};
function fixture(
  options: {
    staff?: boolean;
    uncertain?: boolean;
    trials?: boolean;
    unsubscribed?: boolean;
    suspended?: boolean;
  } = {},
) {
  const receipt: StaffActionReceiptV1 = {
    contractVersion: 1,
    actionId: "staff_receipt",
    organizationId: account.organizationId,
    billingAccountId: account.billingAccountId,
    actorPrincipalId: principal.id,
    action: options.trials ? "grant-trial" : "grant-credits",
    ...(options.trials
      ? { trialId: "trial_fixture", trialExpiresAt: "2026-10-31T12:00:00.000Z" }
      : {}),
    creditUnits: "100",
    creditGrantId: "grant_fixture",
    expensiveOperationsEnabled: null,
    reason: "Synthetic test allowance",
    occurredAt: "2026-10-01T12:00:00.000Z",
    accountVersion: 2,
  };
  let attempts = 0,
    applied = false;
  const action = vi.fn(() => {
    attempts++;
    if (options.uncertain && attempts === 1)
      return Promise.reject(Error("Synthetic unknown response"));
    applied = true;
    return Promise.resolve({ data: receipt });
  });
  const request = vi.fn(async (operation: string) => {
    if (operation === "staff.access.get")
      return {
        data: {
          contractVersion: 1,
          permissions:
            options.staff === false
              ? []
              : [
                  "accounts.read",
                  "credits.grant",
                  "credits.revoke",
                  "operations.manage",
                  ...(options.trials ? ["trials.grant", "trials.revoke"] : []),
                ],
        },
      };
    if (operation === "staff.accounts.list")
      return { data: { contractVersion: 1, items: [account] } };
    if (operation === "staff.accounts.act") return action();
    throw Error("Unexpected operation");
  });
  const metadata = vi.fn(() =>
    Promise.resolve({
      data: {
        data: {
          contractVersion: 1,
          account: {
            ...account,
            version: applied ? 2 : 1,
            ...(options.unsubscribed
              ? { subscriptionState: "not-subscribed", planDisplayName: null }
              : {}),
            ...(options.suspended ? { billingState: "suspended" } : {}),
          },
          availableCreditUnits: applied ? "100" : "0",
          reservedCreditUnits: "0",
          grants: [],
          history: applied ? [receipt] : [],
        },
      },
      metadata: {
        etag: '"staff-account:billing_target:' + (applied ? "2" : "1") + '"',
      },
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const runtime = {
    client: { request, requestWithMetadata: metadata },
    queryClient,
  } as unknown as CloudMarkupQueryRuntime;
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider>
        <StaffWorkspace runtime={runtime} principal={principal} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  return { request, action, metadata, queryClient, receipt };
}
afterEach(cleanup);
async function selectAccount() {
  fireEvent.change(
    await screen.findByRole("searchbox", { name: "Find an account" }),
    { target: { value: "Synthetic" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Search accounts" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic workspace/ }),
  );
  await screen.findByRole("heading", { name: "Account actions" });
}
async function review() {
  await selectAccount();
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "Synthetic test allowance" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review action" }));
  await screen.findByRole("region", { name: "Review staff action" });
}
describe("staff account workspace", () => {
  it("denies ordinary accounts before issuing account searches", async () => {
    const f = fixture({ staff: false });
    await screen.findByRole("heading", { name: "Staff access required" });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(f.request.mock.calls.map((c) => c[0])).toEqual(["staff.access.get"]);
  });
  it("grants an unsubscribed account credits after target review without selecting a trial", async () => {
    const f = fixture({ unsubscribed: true });
    const balanceKey = [
      ...cloudMarkupQueryKeys.commercialSummary(
        principal.id,
        account.organizationId,
      ),
      "editor-credit-balance",
    ];
    const otherKey = cloudMarkupQueryKeys.commercialSummary(
      principal.id,
      "org_other",
    );
    f.queryClient.setQueryData(balanceKey, { availableCreditUnits: 0 });
    f.queryClient.setQueryData(otherKey, { availableCreditUnits: 50 });
    await review();
    expect(f.action).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Review staff action" }),
    ).toHaveTextContent("billing_target");
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await screen.findByText(/100 complimentary credits granted. Receipt:/);
    await waitFor(() => {
      expect(f.queryClient.getQueryState(balanceKey)?.isInvalidated).toBe(true);
    });
    expect(f.queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
    const call = f.request.mock.calls.find(
      (c) => c[0] === "staff.accounts.act",
    );
    expect(call).toEqual([
      "staff.accounts.act",
      expect.objectContaining({
        path: { organizationId: "org_target" },
        headers: {
          "if-match": '"staff-account:billing_target:1"',
          "idempotency-key": expect.any(String) as unknown,
        },
        body: expect.objectContaining({
          action: "grant-credits",
          creditUnits: 100,
          expiresInDays: 30,
          confirmBillingAccountId: "billing_target",
          reason: "Synthetic test allowance",
        }) as unknown,
      }),
    ]);
    expect(
      await screen.findByRole("heading", { name: "Staff action history" }),
    ).toBeInTheDocument();
  });
  it("blocks a suspended account without sending a grant or selecting a trial", async () => {
    const f = fixture({ suspended: true, unsubscribed: true, trials: true });
    await selectAccount();
    expect(
      screen.getByText(/Complimentary credits require an active account/u),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Review action" }),
    ).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Action" })).toHaveValue(
      "grant-credits",
    );
    expect(f.action).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("region", { name: "Review staff action" }),
    ).not.toBeInTheDocument();
  });
  it.each(["transport", "receipt"] as const)(
    "retries an uncertain %s response using the exact same action and idempotency key",
    async (uncertainty) => {
      const f = fixture({ uncertain: uncertainty === "transport" });
      if (uncertainty === "receipt")
        f.action.mockResolvedValueOnce({
          data: { ...f.receipt, creditUnits: "99" },
        });
      await review();
      fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
      await screen.findByText(/result could not be confirmed/);
      expect(
        screen.queryByText(/complimentary credits granted/u),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Back to editing" }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Retry same action" }),
      );
      await waitFor(() => {
        expect(f.action).toHaveBeenCalledTimes(2);
      });
      const calls = f.request.mock.calls.filter(
        (c) => c[0] === "staff.accounts.act",
      );
      expect(calls[0]).toEqual(calls[1]);
    },
  );
  it.each([
    [
      "conflict",
      409,
      "This account cannot receive credit changes in its current state.",
    ],
    [
      "precondition_failed",
      412,
      "The account changed. Reload it before applying this action.",
    ],
  ] as const)(
    "shows the specific %s rejection and requires a fresh account review",
    async (code: ApiErrorCode, status, message) => {
      const f = fixture();
      f.action.mockRejectedValueOnce(
        new ApiClientError(status, {
          apiVersion: "v1",
          error: { code, message, correlationId: "synthetic-staff-rejection" },
        }),
      );
      await review();
      fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByText(/Action recorded. Receipt:/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Retry same action" }),
      ).not.toBeInTheDocument();
      await waitFor(() => {
        expect(f.metadata).toHaveBeenCalledTimes(2);
      });
      expect(f.action).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "Review action" }),
      ).toBeInTheDocument();
    },
  );

  it("reviews a bounded trial separately from paid credit grants before sending it", async () => {
    const f = fixture({ trials: true });
    await selectAccount();
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), {
      target: { value: "grant-trial" },
    });
    expect(screen.getByRole("spinbutton", { name: "Credits" })).toHaveAttribute(
      "max",
      "1000",
    );
    expect(
      screen.getByRole("spinbutton", { name: "Expire after (days)" }),
    ).toHaveAttribute("max", "30");
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
      target: { value: "Synthetic test allowance" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review action" }));
    expect(
      await screen.findByRole("heading", { name: "Confirm trial grant" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Review staff action" }),
    ).toHaveTextContent("No subscription or automatic renewal");
    expect(f.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await screen.findByText(/Action recorded. Receipt:/);
    expect(
      f.request.mock.calls.find((c) => c[0] === "staff.accounts.act"),
    ).toMatchObject([
      "staff.accounts.act",
      {
        body: {
          action: "grant-trial",
          creditUnits: 100,
          expiresInDays: 30,
        },
      },
    ]);
  });
  it("does not offer trial commands to legacy credit staff", async () => {
    fixture();
    await selectAccount();
    expect(
      screen.queryByRole("option", { name: "Grant time-limited trial" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Revoke trial access" }),
    ).not.toBeInTheDocument();
  });
});
