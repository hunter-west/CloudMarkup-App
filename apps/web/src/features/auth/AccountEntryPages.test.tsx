import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AccountAccessV1 } from "@cloudmarkup/api-contract";
import { describe, it, expect, vi } from "vitest";
import { RouterProvider } from "../../routing/index.js";
import { SignInPage } from "./AuthPages.js";
import {
  CognitoBrowserAuthError,
  type AccountAuthenticationIntent,
} from "./cognito-browser-auth.js";
function show(
  path: string,
  enabled = false,
  flow = vi
    .fn<
      (
        intent: AccountAuthenticationIntent,
        signal: AbortSignal,
      ) => Promise<void>
    >()
    .mockResolvedValue(undefined),
) {
  window.history.replaceState(null, "", path);
  const signIn = vi.fn().mockResolvedValue(undefined);
  render(
    <RouterProvider>
      <SignInPage
        development={false}
        startSignIn={signIn}
        startAccountFlow={flow}
        loadAccountAccess={() =>
          Promise.resolve({
            schemaVersion: 1,
            managedLogin: true,
            registrationEnabled: enabled,
          })
        }
      />
    </RouterProvider>,
  );
  return { signIn, flow };
}
describe("personal account entry screens", () => {
  it("keeps sign-in and password recovery available while signup is closed", async () => {
    const { signIn } = show("/sign-up?returnTo=%2Fsettings%2Fsecurity");
    await screen.findByText(/New account registration is temporarily closed/u);
    expect(
      screen.getByRole("button", { name: "Registration closed" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("heading", {
        name: "CloudMarkup account registration",
        level: 1,
      }),
    ).toBeVisible();
    expect(screen.queryByText(/Create an independent account/u)).toBeNull();
    expect(screen.getByRole("link", { name: "Help center" })).toHaveAttribute(
      "href",
      "https://support.cloudmarkup.com/",
    );
    expect(
      screen.getByRole("link", { name: "Forgot your password?" }),
    ).toHaveAttribute(
      "href",
      "/forgot-password?returnTo=%2Fsettings%2Fsecurity",
    );
    fireEvent.click(
      screen.getByRole("link", { name: "Already have an account? Sign in" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/security");
    });
    expect(signIn).toHaveBeenCalledOnce();
  });
  it("creates an independent account through verified signup then preserves the return path", async () => {
    const { flow } = show("/signup?returnTo=%2Fsettings%2Fprofile", true);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create account securely" }),
      ).toBeEnabled(),
    );
    expect(screen.getByText(/Create an independent account/u)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Create account securely" }),
    );
    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/profile");
    });
    expect(flow).toHaveBeenCalledWith("sign-up", expect.any(AbortSignal));
  });
  it("offers recovery regardless of signup admission", async () => {
    const { flow } = show("/forgot-password");
    fireEvent.click(
      screen.getByRole("button", { name: "Reset password securely" }),
    );
    await waitFor(() => {
      expect(flow).toHaveBeenCalledWith("recover", expect.any(AbortSignal));
    });
  });
  it("reports a gate that closes after the screen was loaded", async () => {
    const flow = vi
      .fn<
        (
          intent: AccountAuthenticationIntent,
          signal: AbortSignal,
        ) => Promise<void>
      >()
      .mockRejectedValue(
        new CognitoBrowserAuthError("registration-closed", "Closed"),
      );
    show("/sign-up", true, flow);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create account securely" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create account securely" }),
    );
    await screen.findByText(/New account registration is temporarily closed/u);
    expect(
      screen.getByRole("button", { name: "Registration closed" }),
    ).toBeDisabled();
    expect(screen.queryByText(/Create an independent account/u)).toBeNull();
  });
  it("blocks an unknown registration state but does not misreport it as a closed gate", async () => {
    window.history.replaceState(null, "", "/sign-up");
    const loadAccountAccess = vi
      .fn()
      .mockRejectedValueOnce(Error("Unavailable"))
      .mockResolvedValue({
        schemaVersion: 1,
        managedLogin: true,
        registrationEnabled: false,
      });
    render(
      <RouterProvider>
        <SignInPage development={false} loadAccountAccess={loadAccountAccess} />
      </RouterProvider>,
    );
    await screen.findByText(/Registration availability could not be checked/u);
    expect(
      screen.getByRole("heading", {
        name: "CloudMarkup account registration",
        level: 1,
      }),
    ).toBeVisible();
    expect(screen.queryByText(/Create an independent account/u)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Registration closed" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create account securely" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Already have an account? Sign in" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Check availability again" }),
    );
    await screen.findByText(/New account registration is temporarily closed/u);
    expect(loadAccountAccess).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Registration closed" }),
    ).toBeDisabled();
  });
  it("preserves keyboard focus when registration availability arrives", async () => {
    window.history.replaceState(null, "", "/sign-up");
    let resolveAccess: ((access: AccountAccessV1) => void) | undefined;
    const access = new Promise<AccountAccessV1>((resolve) => {
      resolveAccess = resolve;
    });
    render(
      <RouterProvider>
        <SignInPage development={false} loadAccountAccess={() => access} />
      </RouterProvider>,
    );
    const help = screen.getByRole("link", { name: "Help center" });
    help.focus();
    resolveAccess?.({
      schemaVersion: 1,
      managedLogin: true,
      registrationEnabled: false,
    });
    await screen.findByText(/New account registration is temporarily closed/u);
    expect(help).toHaveFocus();
  });
});
