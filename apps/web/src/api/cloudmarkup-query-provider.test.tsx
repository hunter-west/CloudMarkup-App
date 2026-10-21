import {
  createCloudMarkupClient,
  type ApiTransport,
  type ApiTransportResponse,
} from "@cloudmarkup/api-contract";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedSessionBoundary } from "./authenticated-session.js";
import { useOptionalCloudMarkupQueryRuntime } from "./cloudmarkup-query-context.js";
import { CloudMarkupQueryProvider } from "./cloudmarkup-query-provider.js";
import { cloudMarkupQueryKeys } from "./query-keys.js";

function response(status: number, payload: unknown): ApiTransportResponse {
  return {
    headers: { get: () => null },
    status,
    text() {
      return Promise.resolve(JSON.stringify(payload));
    },
  };
}

function ProtectedProjectList() {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  if (runtime === null) {
    throw new Error("The typed API runtime is required by this test.");
  }
  useQuery({
    queryKey: cloudMarkupQueryKeys.projects("principal_one", "org_main"),
    queryFn: () =>
      runtime.client.request("projects.list", {
        path: { organizationId: "org_main" },
        query: { "page[limit]": "100", sort: "-updatedAt" },
      }),
    retry: false,
  });
  return <h1>Authenticated shell</h1>;
}

describe("CloudMarkup query session expiry", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/sign-in");
  });
  it("asks a fresh guest to sign in after an initial 401 without calling it an expired session", async () => {
    window.history.replaceState(
      null,
      "",
      "/organizations/org_main/projects?sort=recent#list",
    );
    const transport = vi.fn<ApiTransport>(() =>
      Promise.resolve(
        response(401, {
          apiVersion: "v1",
          error: {
            code: "authentication_required",
            correlationId: "correlation-new-guest",
            message: "Authentication is required.",
          },
        }),
      ),
    );
    const client = createCloudMarkupClient({
      baseUrl: "https://api.test.invalid",
      transport,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tenantCacheKey = cloudMarkupQueryKeys.draft(
      "principal_one",
      "org_main",
      "project_main",
    );
    queryClient.setQueryData(tenantCacheKey, {
      sensitive: "stale tenant draft",
    });
    render(
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <AuthenticatedSessionBoundary>
          {() => <h1>Protected content</h1>}
        </AuthenticatedSessionBoundary>
      </CloudMarkupQueryProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Sign in to continue" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Your session expired" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Protected content" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?returnTo=%2Forganizations%2Forg_main%2Fprojects%3Fsort%3Drecent%23list",
    );
    await waitFor(() => {
      expect(queryClient.getQueryData(tenantCacheKey)).toBeUndefined();
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("replaces authenticated content and clears tenant cache after a child query returns 401", async () => {
    let resolveProtectedRequest!: (value: ApiTransportResponse) => void;
    const protectedResponse = new Promise<ApiTransportResponse>((resolve) => {
      resolveProtectedRequest = resolve;
    });
    const transport = vi.fn<ApiTransport>((request) => {
      if (request.url.endsWith("/v1/me")) {
        return Promise.resolve(
          response(200, {
            apiVersion: "v1",
            data: {
              displayName: "Principal One",
              email: "one@example.com",
              id: "principal_one",
              organizationContexts: [
                {
                  capabilities: ["organizations.read", "projects.read"],
                  isOwner: false,
                  membershipId: "membership_main",
                  organizationId: "org_main",
                  role: "viewer",
                },
              ],
              resourceVersion: 1,
            },
          }),
        );
      }
      return protectedResponse;
    });
    const client = createCloudMarkupClient({
      baseUrl: "https://api.test.invalid",
      transport,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tenantCacheKey = cloudMarkupQueryKeys.draft(
      "principal_one",
      "org_main",
      "project_main",
    );
    queryClient.setQueryData(tenantCacheKey, { sensitive: "tenant draft" });

    render(
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <AuthenticatedSessionBoundary>
          {() => <ProtectedProjectList />}
        </AuthenticatedSessionBoundary>
      </CloudMarkupQueryProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Authenticated shell" }),
    ).toBeInTheDocument();
    expect(queryClient.getQueryData(tenantCacheKey)).toEqual({
      sensitive: "tenant draft",
    });
    resolveProtectedRequest(
      response(401, {
        apiVersion: "v1",
        error: {
          code: "authentication_required",
          correlationId: "correlation-session-expiry-test",
          message: "Authentication is required.",
        },
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Your session expired" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    await waitFor(() => {
      expect(queryClient.getQueryData(tenantCacheKey)).toBeUndefined();
    });
  });
});
