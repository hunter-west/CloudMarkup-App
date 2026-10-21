import { describe, it, expect } from "vitest";
import {
  changeAccountSessionsV1Schema,
  accountSessionChangeReceiptV1Schema,
  accountSessionV1Schema,
} from "./account-sessions.js";
describe("account session contracts", () => {
  it("limits commands to the actor's selected session or all sessions", () => {
    expect(
      changeAccountSessionsV1Schema.safeParse({
        contractVersion: 1,
        action: "revoke-all",
      }).success,
    ).toBe(true);
    for (const input of [
      {
        contractVersion: 1,
        action: "revoke-all",
        principalId: "principal_other",
      },
      { contractVersion: 1, action: "revoke", sessionId: "raw-token" },
      {
        contractVersion: 1,
        action: "revoke-all",
        sessionId: "browser_" + "a".repeat(64),
      },
    ])
      expect(changeAccountSessionsV1Schema.safeParse(input).success).toBe(
        false,
      );
  });
  it("requires action-specific immutable receipt evidence", () => {
    const base = {
      contractVersion: 1,
      principalId: "principal_actor",
      action: "revoke-all",
      sessionId: null,
      authenticatedThrough: "2026-10-01T00:00:00.000Z",
      occurredAt: "2026-10-01T00:00:00.000Z",
    };
    expect(accountSessionChangeReceiptV1Schema.safeParse(base).success).toBe(
      true,
    );
    expect(
      accountSessionChangeReceiptV1Schema.safeParse({
        ...base,
        authenticatedThrough: null,
      }).success,
    ).toBe(false);
    expect(
      accountSessionChangeReceiptV1Schema.safeParse({
        ...base,
        action: "revoke",
      }).success,
    ).toBe(false);
  });
  it("never accepts provider credentials or invented device data in session views", () => {
    const base = {
      contractVersion: 1,
      principalId: "principal_actor",
      id: "browser_" + "a".repeat(64),
      authenticatedAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2026-10-01T08:00:00.000Z",
      current: true,
    };
    expect(accountSessionV1Schema.safeParse(base).success).toBe(true);
    for (const extra of [
      { refreshToken: "credential" },
      { sessionId: "provider-family" },
      { ip: "127.0.0.1" },
      { device: "invented" },
    ])
      expect(
        accountSessionV1Schema.safeParse({ ...base, ...extra }).success,
      ).toBe(false);
  });
});
