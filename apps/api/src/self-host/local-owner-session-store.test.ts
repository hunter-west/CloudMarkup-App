import { describe, expect, it, vi } from "vitest";

import type { SqlDatabase, SqlStatement } from "../adapters/persistence/sql.js";
import type { LocalOwnerSessionRecord } from "./local-owner-identity.js";
import { PostgresLocalOwnerSessionStore } from "./local-owner-session-store.js";

const record: LocalOwnerSessionRecord = {
  tokenSha256: "a".repeat(64),
  principalId: "principal_local_owner",
  sessionSha256: "b".repeat(64),
  authenticatedAt: "2026-10-12T12:00:00.000Z",
  expiresAt: "2026-10-12T20:00:00.000Z",
};

function database(result: {
  readonly rowCount: number;
  readonly rows: readonly object[];
}) {
  const query = vi.fn().mockResolvedValue(result);
  return {
    database: { query } as unknown as SqlDatabase,
    query,
  };
}

function statement(query: {
  readonly mock: { readonly calls: unknown[][] };
}): SqlStatement {
  const call = query.mock.calls.at(-1);
  if (call === undefined) throw new Error("Expected a database query.");
  return call[0] as SqlStatement;
}

describe("PostgreSQL local owner session store", () => {
  it("inserts only for an active owner without storing bearer or proof", async () => {
    const fixture = database({ rowCount: 1, rows: [{}] });
    const store = new PostgresLocalOwnerSessionStore(fixture.database);
    await expect(store.create(record)).resolves.toBe(true);
    const insert = statement(fixture.query);
    expect(insert.text).toContain("INSERT INTO browser_refresh_sessions");
    expect(insert.text).toContain("lifecycle_status='active'");
    expect(insert.text).toContain("ON CONFLICT DO NOTHING");
    expect(insert.values).toEqual([
      record.tokenSha256,
      record.principalId,
      record.sessionSha256,
      record.authenticatedAt,
      record.expiresAt,
    ]);
    expect(JSON.stringify(insert.values)).not.toContain("cmlo1_");
    fixture.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(store.create(record)).resolves.toBe(false);
  });

  it("reads only a live, allowed session and refuses malformed returned rows", async () => {
    const fixture = database({
      rowCount: 1,
      rows: [
        {
          token_sha256: record.tokenSha256,
          principal_id: record.principalId,
          session_sha256: record.sessionSha256,
          authenticated_at: record.authenticatedAt,
          expires_at: record.expiresAt,
        },
      ],
    });
    const store = new PostgresLocalOwnerSessionStore(fixture.database);
    await expect(
      store.readActive(record.tokenSha256, record.sessionSha256),
    ).resolves.toEqual(record);
    const read = statement(fixture.query);
    expect(read.values).toEqual([record.tokenSha256, record.sessionSha256]);
    expect(read.text).toContain("lifecycle_status='active'");
    expect(read.text).toContain("cloudmarkup_account_session_allowed_v1(");
    fixture.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ token_sha256: record.tokenSha256 }],
    });
    await expect(
      store.readActive(record.tokenSha256, record.sessionSha256),
    ).resolves.toBeNull();
  });

  it("checks active ownership and uses durable revocation", async () => {
    const fixture = database({
      rowCount: 1,
      rows: [{ principal_id: record.principalId }],
    });
    const store = new PostgresLocalOwnerSessionStore(fixture.database);
    await expect(store.isActiveOwner(record.principalId)).resolves.toBe(true);
    expect(statement(fixture.query).values).toEqual([record.principalId]);
    fixture.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(store.isActiveOwner(record.principalId)).resolves.toBe(false);
    await store.revoke(record.tokenSha256);
    const revoke = statement(fixture.query);
    expect(revoke.values).toEqual([record.tokenSha256]);
    expect(revoke.text).toContain("lifecycle_status='revoked'");
    expect(revoke.text).toContain("lifecycle_status='active'");
  });

  it("propagates storage outages without admitting a principal", async () => {
    const outage = new Error("synthetic database outage");
    const fixture = database({ rowCount: 0, rows: [] });
    fixture.query.mockRejectedValue(outage);
    const store = new PostgresLocalOwnerSessionStore(fixture.database);
    await expect(
      store.readActive(record.tokenSha256, record.sessionSha256),
    ).rejects.toBe(outage);
    await expect(store.isActiveOwner(record.principalId)).rejects.toBe(outage);
  });
});
