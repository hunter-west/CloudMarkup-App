import { PostgresAccountSessions } from "./account-sessions.js";
import type { PrincipalContext } from "../../application/ports.js";
import type { SqlDatabase, SqlRow, SqlStatement } from "./sql.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../application/identity.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { PostgresBrowserRefreshSessions } from "./browser-refresh-sessions.js";
import { sql } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_account_session_it_${nonce}`;
const marker = `CloudMarkup synthetic account session ${nonce}`;
const handle = () => randomBytes(32).toString("base64url");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
suite("account session lifecycle on isolated real PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let created = false;
  let sessions: PostgresBrowserRefreshSessions;
  let admission: PostgresAccountSessions;
  let legacyActive: Principal,
    legacyRevoked: Principal,
    legacyHandle: string,
    legacyBefore: unknown;
  const context = (p: Principal): PrincipalContext => ({
    ...p,
    correlationId: "correlation_security_test",
  });
  async function freshPrincipal(p: Principal): Promise<Principal> {
    const at = (
      await database.query(sql("SELECT clock_timestamp()::text AS now"))
    ).rows[0]?.["now"];
    return {
      ...p,
      sessionId: "fresh-" + randomUUID(),
      authenticatedAt: new Date(String(at)).toISOString(),
    };
  }

  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
    )
      throw Error("Explicit synthetic loopback PostgreSQL is required.");
    admin = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql(`CREATE SCHEMA "${schema}"`));
      await tx.query(sql(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`));
    });
    created = true;
    database = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 4,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema} -c timezone=Pacific/Honolulu -c statement_timeout=5000`,
    });
    opened = database;
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(
      database,
      migrations.filter((m) => m.version < "0088"),
    );
    legacyActive = await principal();
    legacyRevoked = await principal();
    legacyHandle = handle();
    await database.query(
      sql(
        "INSERT INTO browser_refresh_sessions(session_sha256,lifecycle_status,principal_id,provider_session_sha256,authenticated_at,expires_at) VALUES($1,'active',$2,$3,$4::timestamptz,$4::timestamptz+INTERVAL '8 hours')",
        [
          digest(legacyHandle),
          legacyActive.principalId,
          digest(legacyActive.sessionId),
          legacyActive.authenticatedAt,
        ],
      ),
    );
    await database.query(
      sql(
        "INSERT INTO browser_refresh_sessions(session_sha256,lifecycle_status,principal_id,provider_session_sha256,authenticated_at,expires_at,revoked_at) VALUES($1,'revoked',$2,$3,$4::timestamptz,$4::timestamptz+INTERVAL '8 hours',clock_timestamp())",
        [
          digest(handle()),
          legacyRevoked.principalId,
          digest(legacyRevoked.sessionId),
          legacyRevoked.authenticatedAt,
        ],
      ),
    );
    legacyBefore = (
      await database.query(
        sql(
          "SELECT to_jsonb(s) AS value FROM browser_refresh_sessions s WHERE session_sha256=$1",
          [digest(legacyHandle)],
        ),
      )
    ).rows[0]?.["value"];
    await runMigrations(database, migrations);
    await runMigrations(database, migrations);
    sessions = new PostgresBrowserRefreshSessions(database);
    admission = new PostgresAccountSessions(database);
  }, 120000);
  afterAll(async () => {
    try {
      await opened?.close();
      if (created && admin !== undefined) {
        if (!/^cm_account_session_it_[a-f0-9]{32}$/u.test(schema))
          throw Error("Unsafe synthetic schema.");
        const check = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          ),
        );
        if (check.rows[0]?.["marker"] !== marker)
          throw Error("Synthetic schema marker mismatch.");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      }
    } finally {
      await admin?.close();
    }
  }, 30000);
  async function principal(): Promise<Principal> {
    const id = "principal_" + randomUUID().replaceAll("-", "");
    await database.query(
      sql(
        "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic browser user')",
        [id],
      ),
    );
    const result = await database.query(
      sql(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`,
      ),
    );
    const now = result.rows[0]?.["now"];
    if (typeof now !== "string")
      throw Error("Missing synthetic database clock.");
    return {
      principalId: id,
      sessionId: "synthetic-family-" + randomUUID(),
      authenticatedAt: now,
      expiresAt: new Date(Date.parse(now) + 1800000).toISOString(),
      authenticationSource: "cognito",
    };
  }

  it("preserves legacy sessions and backfills only explicit known revocations", async () => {
    expect(await admission.isActive(legacyActive)).toBe(true);
    expect(await admission.isActive(legacyRevoked)).toBe(false);
    const row = (
      await database.query(
        sql(
          "SELECT to_jsonb(s) AS value FROM browser_refresh_sessions s WHERE session_sha256=$1",
          [digest(legacyHandle)],
        ),
      )
    ).rows[0]?.["value"];
    expect(row).toEqual(legacyBefore);
    expect(
      await admission.isActive({
        ...legacyActive,
        sessionId: "unregistered-family",
      }),
    ).toBe(true);
  });
  it("lists only the verified actor's active sessions with stable pagination and no credentials", async () => {
    const p = await principal(),
      other = await principal(),
      h1 = handle(),
      h2 = handle();
    await sessions.begin(h1);
    await sessions.activate(h1, p);
    const p2 = { ...p, sessionId: "second-" + randomUUID() };
    await sessions.begin(h2);
    await sessions.activate(h2, p2);
    const otherHandle = handle();
    await sessions.begin(otherHandle);
    await sessions.activate(otherHandle, other);
    const first = await admission.list(context(p), { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0]?.id);
    const second = await admission.list(context(p), {
      limit: 1,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    const all = [...first.items, ...second.items];
    expect(all).toHaveLength(2);
    expect(second.nextCursor).toBeUndefined();
    expect(all.filter((v) => v.current)).toHaveLength(1);
    expect(all.every((v) => v.principalId === p.principalId)).toBe(true);
    const text = JSON.stringify(all);
    for (const secret of [
      h1,
      h2,
      otherHandle,
      p.sessionId,
      p2.sessionId,
      other.principalId,
    ])
      expect(text).not.toContain(secret);
  });
  it("rejects cross-account and missing targets identically", async () => {
    const p = await principal(),
      other = await principal(),
      h = handle();
    await sessions.begin(h);
    await sessions.activate(h, other);
    for (const sessionId of [
      "browser_" + digest(h),
      "browser_" + "e".repeat(64),
    ])
      await expect(
        admission.change(
          context(p),
          { contractVersion: 1, action: "revoke", sessionId },
          randomUUID(),
        ),
      ).rejects.toMatchObject({
        code: "not_found",
        message: "The session is unavailable.",
      });
    expect(await admission.isActive(other)).toBe(true);
  });
  it("revokes a complete family, keeps other families usable and replays immutably", async () => {
    const p = await principal(),
      target = { ...p, sessionId: "target-" + randomUUID() },
      h1 = handle(),
      h2 = handle();
    for (const h of [h1, h2]) {
      await sessions.begin(h);
      await sessions.activate(h, target);
    }
    const input = {
        contractVersion: 1 as const,
        action: "revoke" as const,
        sessionId: "browser_" + digest(h1),
      },
      key = randomUUID();
    const receipt = await admission.change(context(p), input, key);
    expect(await admission.isActive(target)).toBe(false);
    expect(await admission.isActive(p)).toBe(true);
    expect(await sessions.current(h2, target)).toBeNull();
    expect(await admission.change(context(p), input, key)).toEqual(receipt);
    await expect(
      admission.change(
        context(p),
        { contractVersion: 1, action: "revoke-all" },
        key,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(
      database.query(
        sql(
          "DELETE FROM account_session_change_receipts WHERE principal_id=$1",
          [p.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql(
          "DELETE FROM account_revoked_session_families WHERE principal_id=$1",
          [p.principalId],
        ),
      ),
    ).rejects.toThrow();
  });
  it("applies an all-session cutoff to legacy tokens and preserves fresh login on receipt replay", async () => {
    const p = await principal(),
      input = { contractVersion: 1 as const, action: "revoke-all" as const },
      key = randomUUID();
    const receipt = await admission.change(context(p), input, key);
    expect(await admission.isActive(p)).toBe(false);
    expect(await admission.isActive({ ...p, sessionId: "legacy-other" })).toBe(
      false,
    );
    await expect(
      admission.change(context(p), input, key),
    ).rejects.toMatchObject({ code: "authentication_required" });
    const fresh = await freshPrincipal(p);
    expect(await admission.isActive(fresh)).toBe(true);
    expect(await admission.change(context(fresh), input, key)).toEqual(receipt);
    expect(await admission.isActive(fresh)).toBe(true);
    await expect(
      database.query(
        sql(
          "UPDATE account_authentication_cutoffs SET authenticated_through=authenticated_through-INTERVAL '1 second' WHERE principal_id=$1",
          [p.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql(
          "DELETE FROM account_authentication_cutoffs WHERE principal_id=$1",
          [p.principalId],
        ),
      ),
    ).rejects.toThrow();
  });
  it("keeps cookie revocation effective after browser metadata is pruned", async () => {
    const p = await principal(),
      h = handle();
    await sessions.begin(h);
    await sessions.activate(h, p);
    await sessions.revoke(h);
    await database.query(
      sql("DELETE FROM browser_refresh_sessions WHERE session_sha256=$1", [
        digest(h),
      ]),
    );
    expect(await admission.isActive(p)).toBe(false);
    const retry = handle();
    await sessions.begin(retry);
    expect(await sessions.activate(retry, p)).toBeNull();
  });
  it("serializes activation against all-session revocation", async () => {
    for (let i = 0; i < 4; i++) {
      const p = await principal(),
        h = handle();
      await sessions.begin(h);
      await Promise.all([
        sessions.activate(h, p),
        admission.change(
          context(p),
          { contractVersion: 1, action: "revoke-all" },
          randomUUID(),
        ),
      ]);
      expect(await admission.isActive(p)).toBe(false);
      expect(await sessions.current(h, p)).toBeNull();
    }
  });
  it("denies malformed, stale, expired, inactive and non-Cognito actors", async () => {
    const p = await principal();
    expect(
      await admission.isActive({ ...p, authenticationSource: "test" }),
    ).toBe(false);
    expect(await admission.isActive({ ...p, expiresAt: "bad" })).toBe(false);
    expect(
      await admission.isActive({
        ...p,
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }),
    ).toBe(false);
    for (const actor of [
      { ...p, authenticatedAt: new Date(Date.now() - 700000).toISOString() },
      { ...p, expiresAt: new Date(Date.now() - 1).toISOString() },
    ])
      await expect(
        admission.change(
          context(actor),
          { contractVersion: 1, action: "revoke-all" },
          randomUUID(),
        ),
      ).rejects.toBeInstanceOf(Error);
    await expect(
      admission.list(context(p), { limit: 1, cursor: "not-a-session" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      admission.change(
        context(p),
        { contractVersion: 1, action: "revoke", sessionId: "bad" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await database.query(
      sql(
        "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
        [p.principalId],
      ),
    );
    expect(await admission.isActive(p)).toBe(false);
    await expect(
      admission.list(context(p), { limit: 10 }),
    ).rejects.toMatchObject({ code: "authentication_required" });
  });
  it("rolls back revocation when receipt persistence fails", async () => {
    const p = await principal(),
      target = { ...p, sessionId: "target-" + randomUUID() },
      h = handle();
    await sessions.begin(h);
    await sessions.activate(h, target);
    const failing: SqlDatabase = {
      query: (statement) => database.query(statement),
      close: () => Promise.resolve(),
      transaction: (work) =>
        database.transaction((tx) =>
          work({
            query: (statement) => {
              if (
                statement.text.startsWith(
                  "INSERT INTO account_session_change_receipts",
                )
              )
                throw Error("synthetic receipt outage");
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      new PostgresAccountSessions(failing).change(
        context(p),
        {
          contractVersion: 1,
          action: "revoke",
          sessionId: "browser_" + digest(h),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(await admission.isActive(target)).toBe(true);
    expect(await sessions.current(h, target)).not.toBeNull();
  });

  it("serializes cookie and account revocation for sibling handles without deadlocks", async () => {
    for (let i = 0; i < 5; i++) {
      const p = await principal(),
        target = { ...p, sessionId: "sibling-" + randomUUID() },
        one = handle(),
        two = handle();
      for (const h of [one, two]) {
        await sessions.begin(h);
        await sessions.activate(h, target);
      }
      await Promise.all([
        sessions.revoke(two),
        admission.change(
          context(p),
          {
            contractVersion: 1,
            action: "revoke",
            sessionId: "browser_" + digest(one),
          },
          randomUUID(),
        ),
      ]);
      expect(await admission.isActive(target)).toBe(false);
      expect(await admission.isActive(p)).toBe(true);
    }
  });
  it("fences activation racing with cancellation before a principal is bound", async () => {
    const p = await principal();
    for (let i = 0; i < 5; i++) {
      const actor = { ...p, sessionId: "race-" + randomUUID() },
        h = handle();
      await sessions.begin(h);
      await Promise.all([sessions.activate(h, actor), sessions.revoke(h)]);
      expect(await sessions.current(h, actor)).toBeNull();
      expect(await sessions.begin(h)).toBe(false);
    }
  });
  it("rechecks active identity after waiting for its session lock", async () => {
    const p = await principal();
    let suspended = false;
    const wrapped: SqlDatabase = {
      query: (statement) => database.query(statement),
      close: () => Promise.resolve(),
      transaction: (work) =>
        database.transaction((tx) =>
          work({
            query: async <TRow extends SqlRow>(statement: SqlStatement) => {
              const result = await tx.query<TRow>(statement);
              if (
                statement.text.includes("pg_advisory_xact_lock") &&
                !suspended
              ) {
                suspended = true;
                await database.query(
                  sql(
                    "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
                    [p.principalId],
                  ),
                );
              }
              return result;
            },
          }),
        ),
    };
    await expect(
      new PostgresAccountSessions(wrapped).change(
        context(p),
        { contractVersion: 1, action: "revoke-all" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(suspended).toBe(true);
    expect(
      (
        await database.query(
          sql(
            "SELECT principal_id FROM account_authentication_cutoffs WHERE principal_id=$1",
            [p.principalId],
          ),
        )
      ).rowCount,
    ).toBe(0);
  });
});
