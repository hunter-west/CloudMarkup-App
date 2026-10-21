import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { PostgresAccountProfile } from "./account-profile.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const suite = configured ? describe : describe.skip;
const suffix = () => randomUUID().replaceAll("-", "");
const schema = "cm_profile_test_" + suffix(),
  marker = "CloudMarkup synthetic account profile";
suite("actor-owned profiles on isolated PostgreSQL", () => {
  let admin: PostgresDatabase | undefined,
    db: PostgresDatabase | undefined,
    typed: SqlDatabase,
    app: PostgresAccountProfile;
  const legacy = "principal_" + suffix();
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash
    )
      throw Error("Synthetic loopback database required");
    admin = new PostgresDatabase({ connectionString: configured, max: 1 });
    await admin.query(sql(`CREATE SCHEMA "${schema}"`));
    await admin.query(
      sql(
        `COMMENT ON SCHEMA "${schema}" IS 'CloudMarkup synthetic account profile'`,
      ),
    );
    db = new PostgresDatabase({
      connectionString: configured,
      max: 8,
      options: `-c search_path=${schema} -c timezone=UTC -c statement_timeout=5000`,
    });
    typed = withDataApiTypes(db);
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(
      db,
      migrations.filter((m) => m.version < "0085"),
    );
    await typed.query(
      sql(
        "INSERT INTO principals(principal_id,display_name) VALUES($1,'Legacy profile')",
        [legacy],
      ),
    );
    await runMigrations(db, migrations);
    await runMigrations(db, migrations);
    app = new PostgresAccountProfile(typed);
  }, 30000);
  afterAll(async () => {
    await db?.close();
    if (admin) {
      try {
        const check = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          ),
        );
        if (
          check.rows[0]?.["marker"] !== marker ||
          !/^cm_profile_test_[a-f0-9]{32}$/u.test(schema)
        )
          throw Error("Refusing unverified cleanup");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      } finally {
        await admin.close();
      }
    }
  }, 30000);
  function context(principalId: string): PrincipalContext {
    return {
      principalId,
      sessionId: "session_" + suffix(),
      correlationId: "correlation_" + suffix(),
      authenticationSource: "test",
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
  }
  async function actor() {
    const principal = context("principal_" + suffix());
    await typed.query(
      sql(
        "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic profile')",
        [principal.principalId],
      ),
    );
    return principal;
  }
  const input = (username: string | null = null) => ({
    contractVersion: 1,
    displayName: "Updated name",
    username,
  });
  it("preserves legacy identity/name without inventing a public username", async () => {
    const profile = await app.get(context(legacy));
    expect(profile.value).toEqual({
      contractVersion: 1,
      principalId: legacy,
      displayName: "Legacy profile",
      username: null,
      version: 1,
    });
    expect(profile.etag).toMatch(/^"profile:[a-f0-9]{32}:1"$/u);
  });
  it("updates only the actor and records immutable metadata, with stable no-op versions", async () => {
    const person = await actor(),
      other = await actor(),
      before = await app.get(person),
      username = "user_" + suffix().slice(0, 16);
    const after = await app.update(
      person,
      input(" " + username.toUpperCase() + " "),
      before.etag,
    );
    expect(after.value).toEqual({
      contractVersion: 1,
      principalId: person.principalId,
      displayName: "Updated name",
      username,
      version: 2,
    });
    expect(await app.get(person)).toEqual(after);
    expect((await app.get(other)).value.displayName).toBe("Synthetic profile");
    expect(await app.update(person, input(username), after.etag)).toEqual(
      after,
    );
    const events = await typed.query(
      sql(
        "SELECT profile_record_version,display_name_changed,username_changed FROM principal_profile_events WHERE principal_id=$1",
        [person.principalId],
      ),
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      display_name_changed: true,
      username_changed: true,
    });
    await expect(
      typed.query(
        sql("DELETE FROM principal_profile_events WHERE principal_id=$1", [
          person.principalId,
        ]),
      ),
    ).rejects.toThrow();
  });
  it("rejects stale and foreign account versions without overwriting edits", async () => {
    const person = await actor(),
      other = await actor(),
      before = await app.get(person),
      foreign = await app.get(other);
    await expect(
      app.update(person, input(), foreign.etag),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    const after = await app.update(person, input(), before.etag);
    await expect(
      app.update(
        person,
        { ...input(), displayName: "Stale replacement" },
        before.etag,
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    expect(await app.get(person)).toEqual(after);
  });
  it("admits exactly one concurrent claim to a normalized username and rolls back the loser", async () => {
    const a = await actor(),
      b = await actor(),
      first = await app.get(a),
      second = await app.get(b),
      username = "claim_" + suffix().slice(0, 16);
    const result = await Promise.allSettled([
      app.update(a, input(username), first.etag),
      app.update(b, input(username.toUpperCase()), second.etag),
    ]);
    expect(result.filter((value) => value.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(result.filter((value) => value.status === "rejected")).toMatchObject(
      [{ reason: { code: "conflict" } }],
    );
    const values = await Promise.all([app.get(a), app.get(b)]);
    expect(values.map((value) => value.value.version).sort()).toEqual([1, 2]);
    expect(
      values.filter((value) => value.value.username === username),
    ).toHaveLength(1);
  });
  it("serializes competing saves with one version and permits explicit username clearing", async () => {
    const person = await actor(),
      before = await app.get(person);
    const results = await Promise.allSettled([
      app.update(person, input("user_" + suffix().slice(0, 12)), before.etag),
      app.update(
        person,
        { ...input(), displayName: "Alternative" },
        before.etag,
      ),
    ]);
    expect(
      results.filter((value) => value.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((value) => value.status === "rejected"),
    ).toMatchObject([{ reason: { code: "precondition_failed" } }]);
    const current = await app.get(person);
    const cleared = await app.update(
      person,
      {
        contractVersion: 1,
        displayName: current.value.displayName,
        username: null,
      },
      current.etag,
    );
    expect(cleared.value.username).toBeNull();
  });
  it("denies expired, stale-authenticated and suspended actors", async () => {
    const person = await actor(),
      before = await app.get(person);
    await expect(
      app.get({ ...person, expiresAt: new Date(0).toISOString() }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      app.update(
        {
          ...person,
          authenticatedAt: new Date(Date.now() - 660000).toISOString(),
        },
        input(),
        before.etag,
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    await typed.query(
      sql(
        "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
        [person.principalId],
      ),
    );
    await expect(
      app.update(person, input(), before.etag),
    ).rejects.toMatchObject({ code: "authentication_required" });
  });
  it.each(["read-expiry", "noop-expiry", "noop-reauth"])(
    "rechecks authority after waiting for a profile lock: %s",
    async (mode) => {
      const person = await actor(),
        before = await app.get(person);
      const delayed: SqlDatabase = {
        close: () => Promise.resolve(),
        query: (statement) => typed.query(statement),
        transaction: (run) =>
          typed.transaction((tx) =>
            run({
              query: async <TRow extends SqlRow = SqlRow>(
                statement: SqlStatement,
              ) => {
                const result = await tx.query<TRow>(statement);
                if (
                  statement.text.startsWith("SELECT principal_id,display_name")
                )
                  vi.setSystemTime(
                    Date.now() + (mode === "noop-reauth" ? 660000 : 700000),
                  );
                return result;
              },
            }),
          ),
      };
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const target = new PostgresAccountProfile(delayed);
        const context =
          mode === "noop-reauth"
            ? {
                ...person,
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
              }
            : person;
        const operation =
          mode === "read-expiry"
            ? target.get(context)
            : target.update(
                context,
                {
                  contractVersion: 1,
                  displayName: before.value.displayName,
                  username: before.value.username,
                },
                before.etag,
              );
        await expect(operation).rejects.toMatchObject({
          code:
            mode === "noop-reauth"
              ? "access_denied"
              : "authentication_required",
        });
      } finally {
        vi.useRealTimers();
      }
      expect(await app.get(person)).toEqual(before);
    },
  );
  it("rolls back names and version if audit persistence fails", async () => {
    const person = await actor(),
      before = await app.get(person);
    const failing: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (statement) => typed.query(statement),
      transaction: (run) =>
        typed.transaction((tx) =>
          run({
            query: (statement) => {
              if (
                statement.text.startsWith(
                  "INSERT INTO principal_profile_events",
                )
              )
                throw Error("Synthetic profile audit failure");
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      new PostgresAccountProfile(failing).update(
        person,
        input("audit_" + suffix().slice(0, 12)),
        before.etag,
      ),
    ).rejects.toThrow();
    expect(await app.get(person)).toEqual(before);
  });
  it("enforces username and version invariants in SQL", async () => {
    const person = await actor();
    await expect(
      typed.query(
        sql(
          "UPDATE principals SET public_username='admin',profile_record_version=2 WHERE principal_id=$1",
          [person.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      typed.query(
        sql(
          "UPDATE principals SET display_name='Unversioned' WHERE principal_id=$1",
          [person.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      typed.query(
        sql(
          "UPDATE principals SET profile_record_version=2 WHERE principal_id=$1",
          [person.principalId],
        ),
      ),
    ).rejects.toThrow();
  });
});
