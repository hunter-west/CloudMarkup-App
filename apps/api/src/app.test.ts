import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { app } from "./app.js";
import {
  securityHeadersMiddleware,
  type ApiEnvironment,
} from "./transport/http.js";

describe("GET /health", () => {
  it("reports the API foundation as healthy", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("permissions-policy")).toContain("payment=()");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    await expect(response.json()).resolves.toEqual({
      contractVersion: 1,
      service: "cloudmarkup-api",
      status: "ok",
    });
  });

  it("keeps security headers on unmatched error responses", async () => {
    const response = await app.request("/not-a-route");

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("explicit binary response policy", () => {
  it("retains the strict sandbox CSP and overrides weaker route policies", async () => {
    const sandboxed = new Hono<ApiEnvironment>();
    sandboxed.use("*", securityHeadersMiddleware());
    sandboxed.get(
      "/download",
      () =>
        new Response("zip", {
          headers: { "content-security-policy": "sandbox" },
        }),
    );
    sandboxed.get(
      "/weak",
      () =>
        new Response("text", {
          headers: { "content-security-policy": "default-src *" },
        }),
    );

    const download = await sandboxed.request("/download");
    expect(download.headers.get("content-security-policy")).toBe("sandbox");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    const weak = await sandboxed.request("/weak");
    expect(weak.headers.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
  });
});
