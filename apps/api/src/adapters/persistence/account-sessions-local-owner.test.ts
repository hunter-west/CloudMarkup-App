import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { Principal } from "../../application/identity.js";
import type { PrincipalContext } from "../../application/ports.js";
import {
  accountSessionAllowed,
  PostgresAccountSessions,
} from "./account-sessions.js";
import type { SqlDatabase, SqlExecutor, SqlStatement } from "./sql.js";

const authenticatedAt = new Date().toISOString();
const local: Principal = {
  authenticationSource: "local-owner",
  principalId: "principal_local_owner",
  sessionId: "session_local_owner",
  authenticatedAt,
  expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
};
const hosted: Principal = { ...local, authenticationSource: "cognito" };

function database() {
  const query = vi.fn((statement: SqlStatement) => {
    if (statement.text.includes("AS allowed"))
      return Promise.resolve({ rowCount: 1, rows: [{ allowed: true }] });
    if (statement.text.includes("RETURNING to_char(authenticated_through"))
      return Promise.resolve({
        rowCount: 1,
        rows: [{ cutoff: new Date().toISOString() }],
      });
    if (statement.text.includes("SELECT principal_id FROM principals"))
      return Promise.resolve({
        rowCount: 1,
        rows: [{ principal_id: local.principalId }],
      });
    return Promise.resolve({ rowCount: 0, rows: [] });
  });
  const executor = { query } as unknown as SqlExecutor;
  const db = {
    query,
    transaction: async <T>(work: (tx: SqlExecutor) => Promise<T>) =>
      work(executor),
    close: () => Promise.resolve(),
  } as SqlDatabase;
  return { db, query };
}

describe("account sessions authentication-source separation", () => {
  it("keeps Cognito as the default and admits local-owner only when selected", async () => {
    const fixture = database();
    await expect(accountSessionAllowed(fixture.db, local)).resolves.toBe(false);
    await expect(
      accountSessionAllowed(fixture.db, hosted, "local-owner"),
    ).resolves.toBe(false);
    expect(fixture.query).not.toHaveBeenCalled();

    await expect(accountSessionAllowed(fixture.db, hosted)).resolves.toBe(true);
    await expect(
      accountSessionAllowed(fixture.db, local, "local-owner"),
    ).resolves.toBe(true);
    expect(fixture.query).toHaveBeenCalledTimes(2);
    expect(fixture.query.mock.calls[1]?.[0]?.values).toEqual([
      local.principalId,
      createHash("sha256").update(local.sessionId).digest("hex"),
      local.authenticatedAt,
      local.expiresAt,
    ]);
  });

  it("uses the selected source for admission and actor-owned session listing", async () => {
    const fixture = database();
    const defaultSessions = new PostgresAccountSessions(fixture.db);
    const localSessions = new PostgresAccountSessions(fixture.db, {
      authenticationSource: "local-owner",
    });
    await expect(defaultSessions.isActive(local)).resolves.toBe(false);
    await expect(localSessions.isActive(hosted)).resolves.toBe(false);
    await expect(localSessions.isActive(local)).resolves.toBe(true);

    const context: PrincipalContext = {
      ...local,
      correlationId: "correlation_local_owner_test",
    };
    await expect(
      defaultSessions.list(context, { limit: 25 }),
    ).rejects.toMatchObject({
      code: "authentication_required",
    });
    await expect(localSessions.list(context, { limit: 25 })).resolves.toEqual({
      items: [],
    });
    const listing = fixture.query.mock.calls.find(([statement]) =>
      statement.text.includes("FROM browser_refresh_sessions s"),
    )?.[0];
    expect(listing?.values).toEqual([local.principalId, "", 26]);
  });

  it("permits local owner revocation only in the explicitly selected profile", async () => {
    const fixture = database();
    const context: PrincipalContext = {
      ...local,
      correlationId: "correlation_local_owner_change",
    };
    const input = {
      contractVersion: 1 as const,
      action: "revoke-all" as const,
    };
    await expect(
      new PostgresAccountSessions(fixture.db).change(
        context,
        input,
        "local-session-change-001",
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      new PostgresAccountSessions(fixture.db, {
        authenticationSource: "local-owner",
      }).change(context, input, "local-session-change-002"),
    ).resolves.toMatchObject({
      action: "revoke-all",
      principalId: local.principalId,
    });
    expect(
      fixture.query.mock.calls.some(([statement]) =>
        statement.text.includes("account_authentication_cutoffs"),
      ),
    ).toBe(true);
  });
});
