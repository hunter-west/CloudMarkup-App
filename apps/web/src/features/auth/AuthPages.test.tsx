import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RouterProvider } from "../../routing/index.js";
import { CloudMarkupQueryProvider } from "../../api/index.js";
import {
  AuthCallbackPage,
  SignInPage,
  PublicEntrySessionBoundary,
} from "./AuthPages.js";
import type {
  CognitoBrowserAuthSession,
  ParsedCognitoCallback,
} from "./cognito-browser-auth.js";

describe("browser authentication pages", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/sign-in");
  });

  it("routes an existing verified session to its organizations and rejects an external return destination", async () => {
    window.history.replaceState(
      null,
      "",
      "/signup?returnTo=https%3A%2F%2Fattacker.test",
    );
    const request = vi.fn().mockResolvedValue({
      data: {
        organizationContexts: [
          { organizationId: "first" },
          { organizationId: "second" },
        ],
      },
    });
    const client = {
      request,
      requestWithMetadata: vi.fn(),
    } as unknown as CloudMarkupClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <RouterProvider>
          <PublicEntrySessionBoundary
            development={false}
            readSession={() => Promise.resolve("verified-session")}
          >
            <p>Public entry</p>
          </PublicEntrySessionBoundary>
        </RouterProvider>
      </CloudMarkupQueryProvider>,
    );
    await waitFor(() => {
      expect(window.location.pathname).toBe("/organizations");
    });
    expect(request).toHaveBeenCalledExactlyOnceWith("principal.get", {});
  });

  it("returns to the existing export after sign-in without creating another export", async () => {
    const path =
      "/organizations/org_test/projects/project_test/exports/job_test";
    window.history.replaceState(
      null,
      "",
      "/sign-in?" + new URLSearchParams({ returnTo: path }).toString(),
    );
    const startSignIn = vi.fn().mockResolvedValue(undefined);
    render(
      <RouterProvider>
        <SignInPage development={false} startSignIn={startSignIn} />
      </RouterProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(path);
    });
    expect(startSignIn).toHaveBeenCalledOnce();
  });

  it("starts production Cognito sign-in and navigates client-side after success", async () => {
    const startSignIn = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);

    render(
      <RouterProvider>
        <SignInPage development={false} startSignIn={startSignIn} />
      </RouterProvider>,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Sign in to CloudMarkup",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("list", { name: "Workspace capabilities" }),
    ).toBeVisible();
    expect(
      screen.getByRole("list", { name: "Workspace capabilities" }),
    ).toHaveTextContent("Keep architecture and application context together.");
    expect(
      screen.getByRole("list", { name: "Workspace capabilities" }),
    ).not.toHaveTextContent(/export/iu);
    expect(screen.queryByText(/generated artifacts/iu)).not.toBeInTheDocument();
    expect(screen.getByText("Security details")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));

    expect(startSignIn).toHaveBeenCalledOnce();
    expect(startSignIn).toHaveBeenCalledWith(expect.any(AbortSignal));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/profile");
    });
  });

  it.each([
    { count: 1, destination: "/organizations/org_first/dashboard" },
    { count: 2, destination: "/organizations" },
  ])(
    "opens $destination after sign-in with $count verified organizations",
    async ({ count, destination }) => {
      const startSignIn = vi
        .fn<(signal: AbortSignal) => Promise<void>>()
        .mockResolvedValue(undefined);
      const request = vi.fn().mockResolvedValue({
        data: {
          displayName: "Multi-organization architect",
          id: "principal_multi_org",
          organizationContexts: [
            {
              capabilities: ["organizations.read", "projects.read"],
              isOwner: true,
              membershipId: "membership_first",
              organizationId: "org_first",
              role: "owner",
            },
            {
              capabilities: ["organizations.read", "projects.read"],
              isOwner: false,
              membershipId: "membership_second",
              organizationId: "org_second",
              role: "viewer",
            },
          ].slice(0, count),
          resourceVersion: 1,
        },
      });
      const client = {
        request,
        requestWithMetadata: vi.fn(),
      } as unknown as CloudMarkupClient;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
          <RouterProvider>
            <SignInPage development={false} startSignIn={startSignIn} />
          </RouterProvider>
        </CloudMarkupQueryProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));

      await waitFor(() => {
        expect(window.location.pathname).toBe(destination);
      });
      expect(request).toHaveBeenCalledWith("principal.get", {});
    },
  );

  it.each(["cancel", "change-route"])(
    "does not navigate from a late landing read after %s",
    async (action) => {
      let resolveLanding: (value: unknown) => void = () => {
        throw Error("Uninitialized landing");
      };
      const landing = {
        promise: new Promise<unknown>((resolve) => {
          resolveLanding = resolve;
        }),
      };
      const request = vi.fn().mockReturnValue(landing.promise);
      const client = {
        request,
        requestWithMetadata: vi.fn(),
      } as unknown as CloudMarkupClient;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
          <RouterProvider>
            <SignInPage
              development={false}
              startSignIn={vi.fn().mockResolvedValue(undefined)}
              loadAccountAccess={() =>
                Promise.resolve({
                  schemaVersion: 1,
                  managedLogin: true,
                  registrationEnabled: false,
                })
              }
            />
          </RouterProvider>
        </CloudMarkupQueryProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
      await waitFor(() => {
        expect(request).toHaveBeenCalledWith("principal.get", {});
      });
      if (action === "cancel") {
        fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
      } else {
        window.history.replaceState(null, "", "/forgot-password");
        fireEvent.popState(window);
        expect(
          screen.getByRole("heading", {
            level: 1,
            name: "Recover your account",
          }),
        ).toBeVisible();
      }
      await act(async () => {
        resolveLanding({
          data: { organizationContexts: [{ organizationId: "org_late" }] },
        });
        await landing.promise;
      });
      expect(window.location.pathname).toBe(
        action === "cancel" ? "/sign-in" : "/forgot-password",
      );
    },
  );

  it("offers explicit cancellation without reporting a failed sign-in", async () => {
    let capturedSignal: AbortSignal | undefined;
    const startSignIn = vi.fn((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      });
    });

    render(
      <RouterProvider>
        <SignInPage development={false} startSignIn={startSignIn} />
      </RouterProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));

    expect(
      screen.getByText(
        "Complete sign-in in the secure window, or cancel this attempt and start again.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));

    expect(capturedSignal?.aborted).toBe(true);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sign in securely" }),
      ).toBeEnabled();
    });
    expect(
      screen.getByRole("button", { name: "Sign in securely" }),
    ).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("exchanges a matching direct callback once before client-side navigation", async () => {
    const completeCallback = vi.fn().mockResolvedValue(undefined);
    const authSession = {
      completeCallback,
      hasPendingAuthorization: vi.fn(() => true),
    } as unknown as CognitoBrowserAuthSession;
    const state = "a".repeat(43);
    const relayCallback = vi
      .fn<(callback: ParsedCognitoCallback) => Promise<void>>()
      .mockResolvedValue(undefined);
    window.history.replaceState(
      null,
      "",
      `/auth/callback?code=authorization-code&state=${state}`,
    );

    render(
      <RouterProvider>
        <AuthCallbackPage
          authSession={authSession}
          development={false}
          relayCallback={relayCallback}
          search={`?code=authorization-code&state=${state}`}
        />
      </RouterProvider>,
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings/profile");
    });
    expect(completeCallback).toHaveBeenCalledOnce();
    expect(relayCallback).not.toHaveBeenCalled();
  });
});
