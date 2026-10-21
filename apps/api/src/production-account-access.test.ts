import { describe, it, expect } from "vitest";
import { createApp, type PublicRuntimeConfig } from "./app.js";
import type { CloudMarkupApplication } from "./application/ports.js";
import { readProductionAccountAccess } from "./production-account-access.js";
const runtimeConfig: PublicRuntimeConfig = {
  schemaVersion: 1,
  authentication: {
    provider: "cognito",
    clientId: "a".repeat(26),
    domain: "https://synthetic.auth.us-east-1.amazoncognito.com",
    callbackUrl: "https://beta.example.invalid/auth/callback",
    logoutUrl: "https://beta.example.invalid/",
    scopes: ["openid", "profile", "cloudmarkup-api/access"],
  },
};
describe("independent account registration capability", () => {
  it("keeps old installations closed and the original runtime response unchanged", async () => {
    const access = readProductionAccountAccess({});
    expect(access).toEqual({
      schemaVersion: 1,
      managedLogin: false,
      registrationEnabled: false,
    });
    const app = createApp({
      application: {} as CloudMarkupApplication,
      principalResolver: { resolve: () => Promise.resolve(null) },
      runtimeConfig,
      accountAccess: access,
    });
    expect(await (await app.request("/runtime-config")).json()).toEqual(
      runtimeConfig,
    );
    const r = await app.request("/runtime-config?view=account");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual(access);
    expect(
      (await app.request("/runtime-config?view=account&view=account")).status,
    ).toBe(400);
  });
  it.each([false, true])(
    "reports registration %s without a sign-in or purchase disable flag",
    async (registrationEnabled) => {
      const access = readProductionAccountAccess({
        CLOUDMARKUP_ACCOUNT_ACCESS: JSON.stringify({
          schemaVersion: 1,
          managedLogin: true,
          registrationEnabled,
        }),
      });
      const app = createApp({
        application: {} as CloudMarkupApplication,
        principalResolver: { resolve: () => Promise.resolve(null) },
        runtimeConfig,
        accountAccess: access,
      });
      expect(
        await (await app.request("/runtime-config?view=account")).json(),
      ).toEqual(access);
      expect(await (await app.request("/runtime-config")).json()).toEqual(
        runtimeConfig,
      );
    },
  );
  it.each([
    "",
    "true",
    "{}",
    '{"schemaVersion":2,"managedLogin":true,"registrationEnabled":false}',
    '{"schemaVersion":1,"managedLogin":true,"registrationEnabled":"false"}',
    '{"schemaVersion":1,"managedLogin":false,"registrationEnabled":true}',
    '{"schemaVersion":1,"managedLogin":true,"registrationEnabled":false,"token":"unsafe"}',
  ])("rejects malformed account access configuration %s", (value) => {
    expect(() =>
      readProductionAccountAccess({ CLOUDMARKUP_ACCOUNT_ACCESS: value }),
    ).toThrow("CLOUDMARKUP_ACCOUNT_ACCESS is invalid.");
  });
});
