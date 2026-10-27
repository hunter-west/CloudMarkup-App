import {
  ApiClientError,
  type ChangeAccountAuthenticatorV1,
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
import { afterEach, describe, it, expect, vi } from "vitest";
import type { CloudMarkupQueryRuntime } from "../../api/index.js";
import { AccountAuthenticatorControls } from "./AccountAuthenticatorControls.js";
const id = "principal_actor",
  key = "JBSWY3DPEHPK3PXP";
const initial = {
  contractVersion: 1,
  principalId: id,
  enabled: false,
  enrollmentAvailable: true,
  recoveryContact: { kind: "email", value: "help@example.com" },
  enrollment: null,
};
function setup(
  override?: (op: string, input: unknown) => Promise<unknown> | undefined,
) {
  let state: unknown = initial;
  const request = vi.fn(async (op: string, input: unknown) => {
    const extra = override?.(op, input);
    if (extra !== undefined) return extra;
    if (op === "account.authenticator.get") return { data: state };
    if (op === "principal.get")
      return {
        data: {
          id,
          displayName: "Alex",
          resourceVersion: 1,
          organizationContexts: [],
        },
      };
    const body = (input as { body: ChangeAccountAuthenticatorV1 }).body;
    if (op === "account.authenticator.start") {
      state = {
        ...initial,
        enrollment: {
          id: body.attemptId,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          status: "ready",
          currentSession: true,
        },
      };
      return {
        data: {
          contractVersion: 1,
          principalId: id,
          attemptId: body.attemptId,
          action: "start",
          outcome: "succeeded",
          problem: null,
          state,
          secretCode: key,
        },
      };
    }
    if (op === "account.authenticator.change") {
      state = {
        ...initial,
        enabled: body.action === "verify-enable",
        enrollmentAvailable: body.action !== "verify-enable",
      };
      return {
        data: {
          contractVersion: 1,
          principalId: id,
          attemptId: body.attemptId,
          action: body.action,
          outcome: "succeeded",
          problem: null,
          state,
        },
      };
    }
    throw Error("Unexpected operation");
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const runtime = {
    client: { request },
    queryClient,
    sessionExpired: false,
    resumeSession: vi.fn(),
    expireSession: vi.fn(),
  } as unknown as CloudMarkupQueryRuntime;
  const startSignIn = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <AccountAuthenticatorControls
      runtime={runtime}
      principalId={id}
      startSignIn={startSignIn}
    />,
  );
  return { ...view, request, queryClient, startSignIn, runtime };
}
async function ready() {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Set up authenticator" }),
    ).toBeEnabled(),
  );
}
async function start() {
  await ready();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /saved the recovery contact/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));
  await screen.findByLabelText("Authenticator setup key");
}
function verify() {
  fireEvent.change(screen.getByLabelText("Authenticator code"), {
    target: { value: "123456" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and enable authenticator" }),
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("account authenticator controls", () => {
  it("requires recovery acknowledgement and uses a transient key, then confirms enablement", async () => {
    const f = setup();
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Set up authenticator" }),
    );
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "account.authenticator.start",
      ),
    ).toHaveLength(0);
    await start();
    expect(screen.getByLabelText("Authenticator setup key")).toHaveValue(key);
    expect(f.queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(
      JSON.stringify(f.queryClient.getQueryCache().getAll()),
    ).not.toContain(key);
    expect(JSON.stringify(localStorage)).not.toContain(key);
    expect(JSON.stringify(sessionStorage)).not.toContain(key);
    verify();
    await screen.findByText(
      "Authenticator enabled. You will need its code when signing in.",
    );
    expect(screen.queryByLabelText("Authenticator setup key")).toBeNull();
    expect(
      f.request.mock.calls.find(
        ([op]) => op === "account.authenticator.change",
      )?.[1],
    ).toMatchObject({
      headers: { "x-cloudmarkup-account": id },
      body: { action: "verify-enable", code: "123456" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Disable authenticator" }),
    );
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "account.authenticator.change",
      ),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /removes the authenticator requirement/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Disable authenticator" }),
    );
    await screen.findByText(
      "Authenticator disabled. Existing sessions have not been ended.",
    );
  });
  it("keeps enrollment closed without a configured recovery contact", async () => {
    const f = setup((op) =>
      op === "account.authenticator.get"
        ? Promise.resolve({
            data: {
              ...initial,
              recoveryContact: null,
              enrollmentAvailable: false,
            },
          })
        : undefined,
    );
    await screen.findByText(/New setup is unavailable/);
    expect(
      screen.getByRole("button", { name: "Set up authenticator" }),
    ).toBeDisabled();
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("clears codes before transport and allows explicit correction after an invalid code", async () => {
    const f = setup((op, input) => {
      if (op !== "account.authenticator.change") return;
      expect(screen.getByLabelText("Authenticator code")).toHaveValue("");
      const body = (input as { body: ChangeAccountAuthenticatorV1 }).body;
      return Promise.resolve({
        data: {
          contractVersion: 1,
          principalId: id,
          attemptId: body.attemptId,
          action: body.action,
          outcome: "rejected",
          problem: "incorrect-code",
          state: null,
        },
      });
    });
    await start();
    verify();
    await screen.findByText(/That code was not accepted/);
    expect(screen.getByLabelText("Authenticator setup key")).toHaveValue(key);
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "account.authenticator.change",
      ),
    ).toHaveLength(1);
    verify();
    await waitFor(() => {
      expect(
        f.request.mock.calls.filter(
          ([op]) => op === "account.authenticator.change",
        ),
      ).toHaveLength(2);
    });
  });
  it.each(["unknown", "mismatched", "transport"])(
    "clears key and never retries after %s outcome",
    async (kind) => {
      const f = setup((op, input) => {
        if (op !== "account.authenticator.change") return;
        const body = (input as { body: ChangeAccountAuthenticatorV1 }).body;
        return kind === "transport"
          ? Promise.reject(Error("synthetic"))
          : Promise.resolve({
              data: {
                contractVersion: 1,
                principalId: kind === "mismatched" ? "principal_other" : id,
                attemptId: body.attemptId,
                action: body.action,
                outcome: "uncertain",
                problem: "unknown",
                state: null,
              },
            });
      });
      await start();
      verify();
      await screen.findByText(/We could not confirm/);
      expect(screen.queryByLabelText("Authenticator setup key")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Cancel unfinished setup" }),
      ).toBeDisabled();
      expect(
        f.request.mock.calls.filter(
          ([op]) => op === "account.authenticator.change",
        ),
      ).toHaveLength(1);
    },
  );
  it("clears a refreshed key and lets the owner explicitly cancel the unfinished setup", async () => {
    setup();
    await start();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh authenticator status" }),
    );
    await screen.findByText("Authenticator status refreshed.");
    expect(screen.queryByLabelText("Authenticator setup key")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel unfinished setup" }),
    );
    await screen.findByText(
      "Unfinished setup cancelled. You can start a new setup.",
    );
  });
  it("clears the key at expiry and blocks another code attempt", async () => {
    const timers = vi.spyOn(window, "setTimeout");
    setup((op, input) => {
      if (op !== "account.authenticator.start") return;
      const body = (input as { body: { attemptId: string } }).body;
      return Promise.resolve({
        data: {
          contractVersion: 1,
          principalId: id,
          attemptId: body.attemptId,
          action: "start",
          outcome: "succeeded",
          problem: null,
          state: {
            ...initial,
            enrollment: {
              id: body.attemptId,
              expiresAt: new Date(Date.now() + 5000).toISOString(),
              status: "ready",
              currentSession: true,
            },
          },
          secretCode: key,
        },
      });
    });
    await start();
    const timer = await waitFor(() => {
      const callback = timers.mock.calls.find(
        ([, delay]) =>
          typeof delay === "number" && delay > 1000 && delay <= 5000,
      )?.[0];
      expect(typeof callback).toBe("function");
      return callback;
    });
    act(() => {
      if (typeof timer === "function") timer();
    });
    expect(screen.queryByLabelText("Authenticator setup key")).toBeNull();
    expect(screen.getByText(/Authenticator setup expired/)).toBeVisible();
  });
  it("ignores a slow initial read after an explicit refresh and newer setup", async () => {
    let resolve: (value: unknown) => void = () => {
      throw Error("Uninitialized");
    };
    const first = new Promise<unknown>((done) => {
      resolve = done;
    });
    let firstRead = true;
    setup((op) => {
      if (op === "account.authenticator.get" && firstRead) {
        firstRead = false;
        return first;
      }
      return undefined;
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh authenticator status" }),
    );
    await screen.findByText("Authenticator status refreshed.");
    await start();
    await act(async () => {
      resolve({ data: initial });
      await first;
    });
    expect(screen.getByLabelText("Authenticator setup key")).toHaveValue(key);
  });
  it("does not apply a late setup response after leaving the page", async () => {
    let reject: (error: Error) => void = () => {
      throw Error("Uninitialized");
    };
    const promise = new Promise<unknown>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const f = setup((op) =>
      op === "account.authenticator.start" ? promise : undefined,
    );
    await ready();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /saved the recovery contact/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Set up authenticator" }),
    );
    f.unmount();
    await act(async () => {
      reject(Error("late"));
      await promise.catch(() => undefined);
    });
    expect(f.queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
  it("discards the transient setup when the authenticated session expires", async () => {
    const f = setup();
    await start();
    f.rerender(
      <AccountAuthenticatorControls
        runtime={{ ...f.runtime, sessionExpired: true }}
        principalId={id}
        startSignIn={f.startSignIn}
      />,
    );
    expect(screen.queryByLabelText("Authenticator setup key")).toBeNull();
    await screen.findByText(/setup key is no longer available/);
    expect(
      screen.getByRole("button", { name: "Cancel unfinished setup" }),
    ).toBeDisabled();
  });
  it("fresh sign-in clears setup, detects another account and never resubmits", async () => {
    const f = setup((op) =>
      op === "principal.get"
        ? Promise.resolve({
            data: {
              id: "principal_other",
              displayName: "Other",
              resourceVersion: 1,
              organizationContexts: [],
            },
          })
        : undefined,
    );
    await start();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in again for authenticator" }),
    );
    await screen.findByText(/signed-in account changed/);
    expect(screen.queryByLabelText("Authenticator setup key")).toBeNull();
    expect(f.startSignIn).toHaveBeenCalledTimes(1);
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "account.authenticator.change",
      ),
    ).toHaveLength(0);
  });
  it("requires fresh sign-in after an authorization denial", async () => {
    setup((op) =>
      op === "account.authenticator.start"
        ? Promise.reject(
            new ApiClientError(403, {
              apiVersion: "v1",
              error: {
                code: "access_denied",
                message: "Synthetic denial",
                correlationId: "synthetic",
              },
            }),
          )
        : undefined,
    );
    await ready();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /saved the recovery contact/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Set up authenticator" }),
    );
    await screen.findByText(/Sign in again and reopen Security/);
  });
});
