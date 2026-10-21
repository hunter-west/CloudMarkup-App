import { describe, expect, it } from "vitest";

import {
  createLocalPrincipalResolver,
  LOCAL_IDENTITY_TOKENS,
} from "./local-principals.js";

describe("local API verified identity selection", () => {
  it("accepts only the documented local-development bearer tokens", async () => {
    const resolver = createLocalPrincipalResolver(
      new Date("2026-08-15T12:00:00.000Z"),
    );
    for (const token of LOCAL_IDENTITY_TOKENS) {
      const principal = await resolver.resolve(
        `Bearer local-development:${token}`,
      );
      expect(principal?.authenticationSource).toBe("local-development");
      expect(principal?.sessionId).toBe(`session_${token}`);
    }
    await expect(resolver.resolve("Bearer local-owner")).resolves.toBeNull();
    await expect(
      resolver.resolve("Bearer local-development:unknown"),
    ).resolves.toBeNull();
    await expect(resolver.resolve(undefined)).resolves.toBeNull();
  });
});
