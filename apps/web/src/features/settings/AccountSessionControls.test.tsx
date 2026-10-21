import {
  ApiClientError,
  type CurrentPrincipalV1,
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
import type { CloudMarkupQueryRuntime } from "../../api/index.js";
import {
  AccountSessionControls,
  type AccountSessionAttempt,
} from "./AccountSessionControls.js";
import { browserCognitoAuthSession } from "../auth/cognito-browser-auth.js";
const principal: CurrentPrincipalV1 = {
  id: "principal_actor",
  displayName: "Alex",
  resourceVersion: 1,
  organizationContexts: [],
};
const now = "2026-10-01T00:00:00.000Z";
const other = {
  contractVersion: 1 as const,
  principalId: principal.id,
  id: "browser_" + "a".repeat(64),
  authenticatedAt: now,
  expiresAt: "2026-10-01T08:00:00.000Z",
  current: false,
};
const own = { ...other, id: "browser_" + "b".repeat(64), current: true };
const expired = () =>
  new ApiClientError(401, {
    apiVersion: "v1",
    error: {
      code: "authentication_required",
      message: "Sign in again.",
      correlationId: "correlation_session",
    },
  });
function setup(
  options: {
    override?: (op: string, input: unknown) => Promise<unknown> | undefined;
    endCurrent?: boolean;
    attempts?: Map<string, AccountSessionAttempt>;
  } = {},
) {
  let changed = false;
  const request = vi.fn<(op: string, input: unknown) => Promise<unknown>>(
    async (op, input) => {
      const result = options.override?.(op, input);
      if (result !== undefined) return result;
      if (op === "principal.get") return { data: principal };
      if (op === "account.sessions.list") {
        if (changed && options.endCurrent) throw expired();
        return {
          data: changed ? [own] : [other, own],
          page: { hasMore: false },
        };
      }
      if (op === "account.sessions.change") {
        const command = (
          input as {
            body: { action: "revoke" | "revoke-all"; sessionId?: string };
          }
        ).body;
        changed = true;
        return {
          data: {
            contractVersion: 1,
            principalId: principal.id,
            action: command.action,
            sessionId: command.sessionId ?? null,
            authenticatedThrough: command.action === "revoke-all" ? now : null,
            occurredAt: now,
          },
        };
      }
      throw Error("Unexpected synthetic operation " + op);
    },
  );
  const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
    expireSession = vi.fn();
  const runtime = {
    client: { request },
    queryClient,
    sessionExpired: false,
    expireSession,
    resumeSession: vi.fn(),
  } as unknown as CloudMarkupQueryRuntime;
  const attempts = options.attempts ?? new Map<string, AccountSessionAttempt>();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountSessionControls
        runtime={runtime}
        principal={principal}
        attempts={attempts}
      />
    </QueryClientProvider>,
  );
  return { ...view, request, queryClient, expireSession, attempts };
}
async function review() {
  fireEvent.click(
    await screen.findByRole("button", { name: "End browser sign-in 1" }),
  );
}
function confirm() {
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm ending sessions" }),
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("account session controls", () => {
  it("shows recorded times and requires review before ending a selected sign-in", async () => {
    const f = setup();
    await review();
    expect(
      screen.getByText(
        "Your projects, billing history and local draft recovery are retained.",
      ),
    ).toBeVisible();
    expect(
      f.request.mock.calls.filter(([op]) => op === "account.sessions.change"),
    ).toHaveLength(0);
    confirm();
    await screen.findByText("The selected sign-in ended.");
    expect(f.request).toHaveBeenCalledWith(
      "account.sessions.change",
      expect.objectContaining({
        body: { contractVersion: 1, action: "revoke", sessionId: other.id },
        headers: { "idempotency-key": expect.any(String) as unknown },
      }),
    );
    expect(f.expireSession).not.toHaveBeenCalled();
  });
  it("cancels an unsubmitted change without a request", async () => {
    const f = setup();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel session change" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(f.attempts.size).toBe(0);
    expect(
      f.request.mock.calls.filter(([op]) => op === "account.sessions.change"),
    ).toHaveLength(0);
  });
  it("retains the same unknown attempt across a remount", async () => {
    let fail = true;
    const attempts = new Map<string, AccountSessionAttempt>();
    const first = setup({
      attempts,
      override: (op) =>
        op === "account.sessions.change" && fail
          ? Promise.reject(Error("Response lost"))
          : undefined,
    });
    await review();
    confirm();
    await screen.findByRole("alert");
    const call = first.request.mock.calls.find(
      ([op]) => op === "account.sessions.change",
    )?.[1];
    first.unmount();
    fail = false;
    const second = setup({ attempts });
    fireEvent.click(
      screen.getByRole("button", { name: "Review pending session change" }),
    );
    confirm();
    await screen.findByText("The selected sign-in ended.");
    expect(
      second.request.mock.calls.find(
        ([op]) => op === "account.sessions.change",
      )?.[1],
    ).toEqual(call);
  });
  it("retains a receipt across readback failure without repeating the change", async () => {
    let writes = 0,
      failRead = false;
    const f = setup({
      override: (op) => {
        if (op === "account.sessions.change") {
          writes++;
          failRead = true;
        }
        if (op === "account.sessions.list" && failRead)
          return Promise.reject(Error("Read outage"));
        return undefined;
      },
    });
    await review();
    confirm();
    await screen.findByRole("alert");
    failRead = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh session status" }),
    );
    await screen.findByText("The selected sign-in ended.");
    expect(writes).toBe(1);
    expect(
      f.request.mock.calls.filter(([op]) => op === "account.sessions.change"),
    ).toHaveLength(1);
  });
  it("clears current access only after a bound receipt and denied admission", async () => {
    const clear = vi
        .spyOn(browserCognitoAuthSession, "clearSession")
        .mockImplementation(() => undefined),
      f = setup({ endCurrent: true });
    await screen.findByRole("button", { name: "End this sign-in" });
    fireEvent.click(
      screen.getByRole("button", { name: "End all CloudMarkup sessions" }),
    );
    confirm();
    await waitFor(() => {
      expect(f.expireSession).toHaveBeenCalledOnce();
    });
    expect(clear).toHaveBeenCalledOnce();
    expect(f.attempts.size).toBe(0);
  });
  it("does not claim success from an unbound receipt", async () => {
    const f = setup({
      override: (op) =>
        op === "account.sessions.change"
          ? Promise.resolve({
              data: {
                contractVersion: 1,
                principalId: "principal_other",
                action: "revoke",
                sessionId: other.id,
                authenticatedThrough: null,
                occurredAt: now,
              },
            })
          : undefined,
    });
    await review();
    confirm();
    await screen.findByRole("alert");
    expect(
      screen.queryByText("The selected sign-in ended."),
    ).not.toBeInTheDocument();
    expect(f.expireSession).not.toHaveBeenCalled();
  });
  it("does not send a reviewed change after the verified actor switches", async () => {
    const f = setup({
      override: (op) =>
        op === "principal.get"
          ? Promise.resolve({
              data: { ...principal, id: "principal_switched" },
            })
          : undefined,
    });
    await review();
    confirm();
    await screen.findByRole("alert");
    expect(
      f.request.mock.calls.filter(([op]) => op === "account.sessions.change"),
    ).toHaveLength(0);
  });
  it("never displays another account's session metadata", async () => {
    setup({
      override: (op) =>
        op === "account.sessions.list"
          ? Promise.resolve({
              data: [{ ...other, principalId: "principal_other" }],
              page: { hasMore: false },
            })
          : undefined,
    });
    await screen.findByText("Your sessions could not be loaded.");
    expect(
      screen.queryByRole("button", { name: "End browser sign-in 1" }),
    ).not.toBeInTheDocument();
  });
  it("locks confirmation and cancellation while verifying the current account", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const f = setup({
      override: (op) => (op === "principal.get" ? pending : undefined),
    });
    await review();
    confirm();
    expect(
      screen.getByRole("button", { name: "Cancel session change" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirming…" }));
    await act(async () => {
      release({ data: principal });
      await pending;
    });
    await screen.findByText("The selected sign-in ended.");
    expect(
      f.request.mock.calls.filter(([op]) => op === "account.sessions.change"),
    ).toHaveLength(1);
  });

  it("confirms an earlier all-session receipt without ending a fresh sign-in", async () => {
    const attempts = new Map<string, AccountSessionAttempt>();
    attempts.set(principal.id, {
      input: { contractVersion: 1, action: "revoke-all" },
      key: "session_saved_attempt",
      dispatched: true,
      receipt: {
        contractVersion: 1,
        principalId: principal.id,
        action: "revoke-all",
        sessionId: null,
        authenticatedThrough: now,
        occurredAt: now,
      },
    });
    const f = setup({
      attempts,
      override: (op) =>
        op === "account.sessions.list"
          ? Promise.resolve({
              data: [{ ...own, authenticatedAt: "2026-10-01T00:00:01.000Z" }],
              page: { hasMore: false },
            })
          : undefined,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Review pending session change" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh session status" }),
    );
    await screen.findByText(
      "Earlier CloudMarkup sessions ended. Your current sign-in is active.",
    );
    expect(f.expireSession).not.toHaveBeenCalled();
    expect(
      f.request.mock.calls.filter(([op]) => op === "account.sessions.change"),
    ).toHaveLength(0);
  });
});
