import { describe, expect, it } from "vitest";

import {
  createApp,
  parsePublicRuntimeConfig,
  type PublicRuntimeConfig,
} from "./app.js";
import type { CloudMarkupApplication } from "./application/ports.js";

const runtimeConfig: PublicRuntimeConfig = {
  authentication: {
    callbackUrl: "https://beta.example.invalid/auth/callback",
    clientId: "client-123",
    domain: "https://cloudmarkup-beta.auth.us-east-1.amazoncognito.com",
    logoutUrl: "https://beta.example.invalid/",
    provider: "cognito",
    scopes: ["openid", "profile", "cloudmarkup-api/access"],
  },
  schemaVersion: 1,
};

describe("public runtime configuration", () => {
  it("reports disabled exports by default without altering the authentication contract", async () => {
    const app = createApp({
      application: {} as CloudMarkupApplication,
      principalResolver: { resolve: () => Promise.resolve(null) },
      runtimeConfig,
    });
    const response = await app.request("/runtime-config?view=exports");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      exports: { targets: [], workload: null, maximumBytes: 4_194_304 },
    });
    const authenticationResponse = await app.request("/runtime-config");
    expect(authenticationResponse.status).toBe(200);
    expect(authenticationResponse.headers.get("cache-control")).toBe(
      "no-store",
    );
    await expect(authenticationResponse.json()).resolves.toEqual(runtimeConfig);
  });
  it("publishes only the admitted nonsecret display capabilities", async () => {
    const capabilities = {
      schemaVersion: 1 as const,
      exports: {
        targets: ["cloudformation"] as ["cloudformation"],
        workload: "infrastructure-only" as const,
        maximumBytes: 4_194_304 as const,
      },
    };
    const app = createApp({
      application: {} as CloudMarkupApplication,
      principalResolver: { resolve: () => Promise.resolve(null) },
      runtimeConfig,
      runtimeExportCapabilities: capabilities,
    });
    const response = await app.request("/runtime-config?view=exports");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(capabilities);
    await expect(
      (await app.request("/runtime-config")).json(),
    ).resolves.toEqual(runtimeConfig);
    expect(
      (
        await app.request("/v1/projects/project_private/solution-export-jobs", {
          method: "POST",
        })
      ).status,
    ).toBe(401);
  });
  it.each(["?view=secret", "?view=exports&view=exports"])(
    "rejects an unrecognized runtime view %s",
    async (query) => {
      const app = createApp({
        application: {} as CloudMarkupApplication,
        principalResolver: { resolve: () => Promise.resolve(null) },
        runtimeConfig,
      });
      const response = await app.request("/runtime-config" + query);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("rejects a callback that crosses origins", () => {
    expect(() =>
      parsePublicRuntimeConfig({
        ...runtimeConfig,
        authentication: {
          ...runtimeConfig.authentication,
          callbackUrl: "https://attacker.example/auth/callback",
        },
      }),
    ).toThrow("public runtime configuration is invalid");
  });

  it("rejects extra public fields", () => {
    expect(() =>
      parsePublicRuntimeConfig({
        ...runtimeConfig,
        secret: "must-not-leak",
      }),
    ).toThrow();
  });
});

it("reports AI unavailable by default and advertises exact opt-in versions without tenant access", async () => {
  const principalResolver = {
    resolve: () =>
      Promise.reject(new Error("Public support must not authenticate")),
  };
  const application = {} as CloudMarkupApplication;
  const unavailable = createApp({
    application,
    principalResolver,
    runtimeConfig,
  });
  await expect(
    (await unavailable.request("/runtime-config?view=ai")).json(),
  ).resolves.toEqual({
    schemaVersion: 1,
    proposalVersions: [],
    applicationSources: [],
  });
  const support = {
    schemaVersion: 1 as const,
    proposalVersions: [6] as [6],
    applicationSources: ["ai-source-draft-v3"] as ["ai-source-draft-v3"],
  };
  const app = createApp({
    application,
    principalResolver,
    runtimeConfig,
    runtimeAiCapabilities: support,
  });
  const response = await app.request("/runtime-config?view=ai");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual(support);
  await expect((await app.request("/runtime-config")).json()).resolves.toEqual(
    runtimeConfig,
  );
});
