import {
  ApiClientError,
  type ChangeAccountCredentialsV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { AccountCredentialControls } from "./AccountCredentialControls.js";
const id = "principal_actor",
  state = {
    contractVersion: 1,
    principalId: id,
    email: "old@example.com",
    emailVerified: true,
    authenticatorEnabled: false,
  };
function setup(
  override?: (op: string, input: unknown) => Promise<unknown> | undefined,
) {
  const request = vi.fn(async (op: string, input: unknown) => {
    const value = override?.(op, input);
    if (value !== undefined) return value;
    if (op === "account.credentials.get") return { data: state };
    if (op === "principal.get")
      return {
        data: {
          id,
          displayName: "Alex",
          resourceVersion: 1,
          organizationContexts: [],
        },
      };
    if (op === "account.credentials.change") {
      const body = (input as { body: ChangeAccountCredentialsV1 }).body;
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
    throw Error("Unexpected synthetic operation");
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
    <RouterProvider>
      <AccountCredentialControls
        runtime={runtime}
        principalId={id}
        startSignIn={startSignIn}
      />
    </RouterProvider>,
  );
  return { ...view, request, queryClient, startSignIn };
}
async function ready() {
  fireEvent.click(
    screen.getByText("Change your password", { selector: "summary" }),
  );
  fireEvent.click(
    screen.getByText("Update your sign-in email", { selector: "summary" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Change password" }),
    ).toBeEnabled(),
  );
}
function passwords(confirmation = "Synthetic-new-Password2!") {
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "Synthetic-old-Password1!" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "Synthetic-new-Password2!" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirmation },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("personal password and email controls", () => {
  it("refreshes cached principal metadata only after an actor-bound provider read", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const f = setup();
    await ready();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: cloudMarkupQueryKeys.currentPrincipal(),
      exact: true,
    });
    expect(
      f.request.mock.calls.every(
        ([operation]) => operation === "account.credentials.get",
      ),
    ).toBe(true);
  });
  it("uses an account fence and clears credentials without creating a mutation cache entry", async () => {
    const f = setup();
    await ready();
    passwords();
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
    await screen.findByText("Password changed.");
    expect(f.request).toHaveBeenCalledWith(
      "account.credentials.change",
      expect.objectContaining({
        headers: { "x-cloudmarkup-account": id },
        body: expect.objectContaining({
          action: "password-change",
          currentPassword: "Synthetic-old-Password1!",
        }) as unknown,
      }),
    );
    expect(f.queryClient.getMutationCache().getAll()).toEqual([]);
    expect(
      JSON.stringify(f.queryClient.getQueryCache().getAll()),
    ).not.toContain("Synthetic-new-Password2!");
  });
  it("does not dispatch mismatched passwords", async () => {
    const f = setup();
    await ready();
    passwords("Does-not-match3!");
    await screen.findByText("The new passwords do not match.");
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "account.credentials.change",
      ),
    ).toHaveLength(0);
  });
  it("retains the old sign-in email until provider verification completes", async () => {
    setup();
    await ready();
    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await screen.findByText(/Email update requested/u);
    expect(screen.getByText("old@example.com · Verified")).toBeVisible();
    expect(screen.getByLabelText("New email address")).toHaveValue("");
    expect(
      screen.queryByText("new@example.com · Verified"),
    ).not.toBeInTheDocument();
  });
  it("does not retry an uncertain password change and requires explicit readback before another attempt", async () => {
    const f = setup((op, input) => {
      if (op !== "account.credentials.change") return;
      const body = (input as { body: ChangeAccountCredentialsV1 }).body;
      return Promise.resolve({
        data: {
          contractVersion: 1,
          principalId: id,
          attemptId: body.attemptId,
          action: body.action,
          outcome: "uncertain",
          problem: "unknown",
          state: null,
        },
      });
    });
    await ready();
    passwords();
    await screen.findByText(
      /We could not confirm whether the change completed/u,
    );
    expect(
      screen.getByRole("button", { name: "Change password" }),
    ).toBeDisabled();
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "account.credentials.change",
      ),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh account security" }),
    );
    await ready();
    await screen.findByText(/Passwords cannot be checked from this page/u);
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "account.credentials.change",
      ),
    ).toHaveLength(1);
  });
  it("clears rejected verification codes and shows the safe error", async () => {
    setup((op, input) => {
      if (op !== "account.credentials.change") return;
      const body = (input as { body: ChangeAccountCredentialsV1 }).body;
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
    await ready();
    fireEvent.change(screen.getByLabelText("Email verification code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    await screen.findByText(/verification code was not accepted/u);
    expect(screen.getByLabelText("Email verification code")).toHaveValue("");
    expect(screen.queryByText(/Email verified:/u)).not.toBeInTheDocument();
  });
  it("keeps ordinary session state while offering a fresh self-service sign-in", async () => {
    const f = setup((op) =>
      op === "account.credentials.get"
        ? Promise.reject(
            new ApiClientError(401, {
              apiVersion: "v1",
              error: {
                code: "authentication_required",
                message: "Sign in again",
                correlationId: "correlation_test",
              },
            }),
          )
        : undefined,
    );
    await screen.findByText(
      "Sign in again to enable password and email controls.",
    );
    expect(
      screen.getByRole("button", { name: "Change password" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Sign in again securely" }),
    ).toBeEnabled();
    expect(f.startSignIn).not.toHaveBeenCalled();
  });
  it("does not display a change response from another account", async () => {
    setup((op, input) => {
      if (op !== "account.credentials.change") return;
      const body = (input as { body: ChangeAccountCredentialsV1 }).body;
      return Promise.resolve({
        data: {
          contractVersion: 1,
          principalId: "principal_other",
          attemptId: body.attemptId,
          action: body.action,
          outcome: "succeeded",
          problem: null,
          state: {
            ...state,
            principalId: "principal_other",
            email: "private@example.com",
          },
        },
      });
    });
    await ready();
    passwords();
    await screen.findByText(
      /We could not confirm whether the change completed/u,
    );
    expect(screen.queryByText(/private@example.com/u)).not.toBeInTheDocument();
    expect(screen.queryByText("Password changed.")).not.toBeInTheDocument();
  });
  it("does not dispatch credentials as part of a sign-in to a different account", async () => {
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
    await ready();
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "Synthetic-old-Password1!" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in again securely" }),
    );
    await screen.findByText(
      "The signed-in account changed. Reopen Security for that account.",
    );
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Change password" }),
    ).toBeDisabled();
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "account.credentials.change",
      ),
    ).toHaveLength(0);
  });
});
