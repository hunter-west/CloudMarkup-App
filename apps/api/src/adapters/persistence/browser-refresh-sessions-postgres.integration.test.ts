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
const schema = `cm_browser_session_it_${nonce}`;
const marker = `CloudMarkup synthetic browser session ${nonce}`;
const handle = () => randomBytes(32).toString("base64url");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
suite("browser refresh lifecycle on isolated real PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let created = false;
  let sessions: PostgresBrowserRefreshSessions;
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
    await runMigrations(
      database,
      await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      ),
    );
    sessions = new PostgresBrowserRefreshSessions(database);
  }, 120000);
  afterAll(async () => {
    try {
      await opened?.close();
      if (created && admin !== undefined) {
        if (!/^cm_browser_session_it_[a-f0-9]{32}$/u.test(schema))
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
  it("admits one exchange and one activation, storing only digests and lifecycle metadata", async () => {
    const h = handle(),
      p = await principal();
    expect(await sessions.activate(h, p)).toBeNull();
    const starts = await Promise.all([sessions.begin(h), sessions.begin(h)]);
    expect(starts.filter(Boolean)).toHaveLength(1);
    const activations = await Promise.all([
      sessions.activate(h, p),
      sessions.activate(h, p),
    ]);
    expect(activations.filter(Boolean)).toHaveLength(1);
    expect(await sessions.current(h, p)).toBe(
      new Date(Date.parse(p.authenticatedAt) + 28800000).toISOString(),
    );
    const rows = await database.query(
      sql("SELECT * FROM browser_refresh_sessions WHERE session_sha256=$1", [
        digest(h),
      ]),
    );
    expect(rows.rows[0]).toMatchObject({
      session_sha256: digest(h),
      provider_session_sha256: digest(p.sessionId),
      principal_id: p.principalId,
      lifecycle_status: "active",
    });
    expect(JSON.stringify(rows.rows)).not.toContain(h);
    expect(JSON.stringify(rows.rows)).not.toContain(p.sessionId);
  });
  it("allows cancellation before exchange and never reactivates a canceled handle", async () => {
    const h = handle(),
      p = await principal();
    await sessions.revoke(h);
    await sessions.revoke(h);
    expect(await sessions.begin(h)).toBe(false);
    expect(await sessions.activate(h, p)).toBeNull();
    expect(await sessions.current(h, p)).toBeNull();
  });
  it("fences an activation racing with cancellation", async () => {
    const p = await principal();
    for (let i = 0; i < 5; i++) {
      const h = handle();
      expect(await sessions.begin(h)).toBe(true);
      await Promise.all([sessions.activate(h, p), sessions.revoke(h)]);
      expect(await sessions.current(h, p)).toBeNull();
      expect(await sessions.begin(h)).toBe(false);
      expect(await sessions.activate(h, p)).toBeNull();
    }
  });
  it("requires the exact verified principal, refresh family and original authentication time", async () => {
    const h = handle(),
      p = await principal(),
      other = await principal();
    await sessions.begin(h);
    await sessions.activate(h, p);
    for (const changed of [
      other,
      { ...p, sessionId: other.sessionId },
      {
        ...p,
        authenticatedAt: new Date(
          Date.parse(p.authenticatedAt) + 1,
        ).toISOString(),
      },
    ])
      expect(await sessions.current(h, changed)).toBeNull();
    expect(await sessions.activate(h, other)).toBeNull();
    expect(await sessions.current(h, p)).not.toBeNull();
  });
  it("denies disabled principals for activation and restoration", async () => {
    const h = handle(),
      p = await principal();
    await sessions.begin(h);
    await sessions.activate(h, p);
    await database.query(
      sql(
        "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
        [p.principalId],
      ),
    );
    expect(await sessions.current(h, p)).toBeNull();
    const next = handle();
    await sessions.begin(next);
    expect(await sessions.activate(next, p)).toBeNull();
  });
  it.each([-28800001, 31000])(
    "rejects original authentication outside the database clock window (%i ms)",
    async (offset) => {
      const h = handle(),
        p = await principal();
      await sessions.begin(h);
      expect(
        await sessions.activate(h, {
          ...p,
          authenticatedAt: new Date(
            Date.parse(p.authenticatedAt) + offset,
          ).toISOString(),
        }),
      ).toBeNull();
    },
  );
  it("denies expired active metadata and expired pending exchanges", async () => {
    const p = await principal(),
      h = handle(),
      expired = handle();
    await database.query(
      sql(
        "INSERT INTO browser_refresh_sessions(session_sha256,lifecycle_status,principal_id,provider_session_sha256,authenticated_at,expires_at) VALUES($1,'active',$2,$3,statement_timestamp()-INTERVAL '9 hours',statement_timestamp()-INTERVAL '1 hour')",
        [digest(h), p.principalId, digest(p.sessionId)],
      ),
    );
    expect(await sessions.current(h, p)).toBeNull();
    await database.query(
      sql(
        "INSERT INTO browser_refresh_sessions(session_sha256,lifecycle_status,expires_at) VALUES($1,'exchanging',clock_timestamp()-INTERVAL '1 second')",
        [digest(expired)],
      ),
    );
    expect(await sessions.activate(expired, p)).toBeNull();
  });
  it("rejects rebinding, extension and resurrection of durable metadata", async () => {
    const h = handle(),
      p = await principal();
    await sessions.begin(h);
    await sessions.activate(h, p);
    for (const mutation of [
      "expires_at=expires_at+INTERVAL '1 second'",
      "provider_session_sha256='" + "0".repeat(64) + "'",
      "lifecycle_status='exchanging'",
      "session_sha256='" + "1".repeat(64) + "'",
    ]) {
      await expect(
        database.query(
          sql(
            `UPDATE browser_refresh_sessions SET ${mutation} WHERE session_sha256=$1`,
            [digest(h)],
          ),
        ),
      ).rejects.toThrow();
    }
    await sessions.revoke(h);
    await expect(
      database.query(
        sql(
          "UPDATE browser_refresh_sessions SET lifecycle_status='active',revoked_at=NULL WHERE session_sha256=$1",
          [digest(h)],
        ),
      ),
    ).rejects.toThrow();
  });
});
