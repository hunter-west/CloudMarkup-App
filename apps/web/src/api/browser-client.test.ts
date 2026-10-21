import { describe, expect, it, vi } from "vitest";

import { createBrowserCloudMarkupClient } from "./browser-client.js";

describe("browser CloudMarkup client configuration", () => {
  it("keeps an unconfigured Vite preview on the explicit synthetic boundary", () => {
    expect(
      createBrowserCloudMarkupClient({
        development: true,
        fetchImplementation: vi.fn(),
      }),
    ).toBeUndefined();
  });

  it("uses the reviewed same-origin API path when production has no override", () => {
    expect(
      createBrowserCloudMarkupClient({
        development: false,
        fetchImplementation: vi.fn(),
      }),
    ).toBeDefined();
  });

  it("creates a typed client only for an explicitly configured API origin", () => {
    expect(
      createBrowserCloudMarkupClient({
        apiBaseUrl: "http://127.0.0.1:8787/",
        development: true,
        fetchImplementation: vi.fn(),
        localDevelopmentToken: "developer",
      }),
    ).toBeDefined();
  });

  it("rejects local identity tokens outside development", () => {
    expect(() =>
      createBrowserCloudMarkupClient({
        apiBaseUrl: "https://api.example.test",
        development: false,
        fetchImplementation: vi.fn(),
        localDevelopmentToken: "developer",
      }),
    ).toThrow("local-development identity token is unavailable");
  });

  it("reads the production access token again for every API request", async () => {
    let accessToken = "access-token-one";
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            apiVersion: "v1",
            data: {
              displayName: "Beta Tester",
              id: "principal_beta",
              organizationContexts: [],
              resourceVersion: 1,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      ),
    );
    const client = createBrowserCloudMarkupClient({
      accessToken: () => accessToken,
      development: false,
      fetchImplementation,
    });

    if (client === undefined) {
      throw new Error("The production browser client is unavailable.");
    }
    await client.request("principal.get", {});
    accessToken = "access-token-two";
    await client.request("principal.get", {});

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "/api/v1/me",
      expect.objectContaining({
        headers: { authorization: "Bearer access-token-one" },
      }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "/api/v1/me",
      expect.objectContaining({
        headers: { authorization: "Bearer access-token-two" },
      }),
    );
  });

  it("waits for a renewed token before sending the API request", async () => {
    let finish: (token: string | undefined) => void = () => {
      throw new Error("Deferred token is not initialized.");
    };
    const token = new Promise<string | undefined>((resolve) => {
      finish = resolve;
    });
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            apiVersion: "v1",
            data: {
              displayName: "Beta Tester",
              id: "principal_beta",
              organizationContexts: [],
              resourceVersion: 1,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const client = createBrowserCloudMarkupClient({
      accessToken: () => token,
      development: false,
      fetchImplementation,
    });
    const request = client?.request("principal.get", {});
    expect(fetchImplementation).not.toHaveBeenCalled();
    finish("renewed-access-token");
    await request;
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/v1/me",
      expect.objectContaining({
        headers: { authorization: "Bearer renewed-access-token" },
      }),
    );
  });

  it.each(["invalid token", "invalid\ntoken", ""])(
    "rejects an unsafe asynchronously supplied token before making a request",
    async (token) => {
      const fetchImplementation = vi.fn();
      const client = createBrowserCloudMarkupClient({
        accessToken: () => Promise.resolve(token),
        development: false,
        fetchImplementation,
      });
      await expect(client?.request("principal.get", {})).rejects.toThrow(
        "browser access token is invalid",
      );
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );
});
