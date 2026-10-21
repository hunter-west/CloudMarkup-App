import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { PostgresAccountPhoto } from "./account-photo.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql, type SqlDatabase } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const suite = configured ? describe : describe.skip;
const schema = "cm_photo_test_" + randomUUID().replaceAll("-", "");
const marker = "CloudMarkup synthetic private account photo";
const image =
  "data:image/png;base64," +
  new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#365ec8"/></svg>',
    { font: { loadSystemFonts: false } },
  )
    .render()
    .asPng()
    .toString("base64");
suite("private photos on isolated loopback PostgreSQL", () => {
  let admin: PostgresDatabase | undefined,
    db: PostgresDatabase | undefined,
    typed: SqlDatabase,
    application: PostgresAccountPhoto;
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
        `COMMENT ON SCHEMA "${schema}" IS 'CloudMarkup synthetic private account photo'`,
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
    await runMigrations(db, migrations);
    await runMigrations(db, migrations);
    application = new PostgresAccountPhoto(typed);
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
          !/^cm_photo_test_[a-f0-9]{32}$/u.test(schema)
        )
          throw Error("Refusing unverified cleanup");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      } finally {
        await admin.close();
      }
    }
  }, 30000);
  async function actor(): Promise<PrincipalContext> {
    const principalId = "principal_" + randomUUID().replaceAll("-", "");
    await typed.query(
      sql(
        "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic photo account')",
        [principalId],
      ),
    );
    return {
      principalId,
      sessionId: "session_photo",
      correlationId: "correlation_photo",
      authenticationSource: "test",
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
  }
  it("persists across fresh clients, isolates accounts, removes bytes and preserves stale-version rejection", async () => {
    const person = await actor(),
      other = await actor(),
      empty = await application.get(person);
    const saved = await application.update(
      person,
      { contractVersion: 1, image },
      empty.etag,
    );
    const fresh = new PostgresDatabase({
      connectionString: configured,
      max: 1,
      options: `-c search_path=${schema} -c timezone=UTC -c statement_timeout=5000`,
    });
    try {
      expect(
        await new PostgresAccountPhoto(withDataApiTypes(fresh)).get(person),
      ).toEqual(saved);
    } finally {
      await fresh.close();
    }
    expect((await application.get(other)).value.image).toBeNull();
    await expect(
      application.update(other, { contractVersion: 1, image }, saved.etag),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    const removed = await application.update(
      person,
      { contractVersion: 1, image: null },
      saved.etag,
    );
    expect(removed.value).toMatchObject({ version: 2, image: null });
    expect(
      (
        await typed.query(
          sql(
            "SELECT image_bytes FROM principal_account_photos WHERE principal_id=$1",
            [person.principalId],
          ),
        )
      ).rows[0]?.["image_bytes"],
    ).toBeNull();
    await expect(
      application.update(person, { contractVersion: 1, image }, empty.etag),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    expect(
      (
        await typed.query(
          sql(
            "SELECT action FROM principal_account_photo_events WHERE principal_id=$1 ORDER BY record_version",
            [person.principalId],
          ),
        )
      ).rows.map((row) => row["action"]),
    ).toEqual(["changed", "removed"]);
  });
  it("serializes simultaneous writes and forbids unversioned owner/byte changes", async () => {
    const person = await actor(),
      other = await actor(),
      empty = await application.get(person);
    const results = await Promise.allSettled([
      application.update(person, { contractVersion: 1, image }, empty.etag),
      application.update(person, { contractVersion: 1, image }, empty.etag),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      typed.query(
        sql(
          "UPDATE principal_account_photos SET image_bytes=NULL WHERE principal_id=$1",
          [person.principalId],
        ),
      ),
    ).rejects.toThrow();
    const baseline = await application.get(person);
    let release!: () => void, locked!: () => void, attempted!: () => void;
    const lockReady = new Promise<void>((done) => {
      locked = done;
    });
    const attemptedRead = new Promise<void>((done) => {
      attempted = done;
    });
    const lockRelease = new Promise<void>((done) => {
      release = done;
    });
    const holder = typed.transaction(async (tx) => {
      await tx.query(
        sql(
          "SELECT principal_id FROM principals WHERE principal_id=$1 FOR UPDATE",
          [person.principalId],
        ),
      );
      locked();
      await lockRelease;
    });
    await lockReady;
    const observed: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (statement) => typed.query(statement),
      transaction: (work) =>
        typed.transaction((tx) =>
          work({
            query: (statement) => {
              if (statement.text.startsWith("SELECT principal_id")) attempted();
              return tx.query(statement);
            },
          }),
        ),
    };
    let completed = false;
    const pending = new PostgresAccountPhoto(observed)
      .update(
        { ...person, expiresAt: new Date(Date.now() + 500).toISOString() },
        { contractVersion: 1, image: null },
        baseline.etag,
      )
      .then(
        () => {
          completed = true;
          return null;
        },
        (error: unknown) => {
          completed = true;
          return error;
        },
      );
    try {
      await attemptedRead;
      await new Promise((done) => setTimeout(done, 50));
      expect(completed).toBe(false);
      await new Promise((done) => setTimeout(done, 550));
    } finally {
      release();
      await holder;
    }
    expect(await pending).toMatchObject({ code: "authentication_required" });
    expect(await application.get(person)).toEqual(baseline);
    await expect(
      typed.query(
        sql(
          "UPDATE principal_account_photos SET principal_id=$2,record_version=record_version+1,image_bytes=NULL WHERE principal_id=$1",
          [person.principalId, other.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      typed.query(
        sql(
          "DELETE FROM principal_account_photo_events WHERE principal_id=$1",
          [person.principalId],
        ),
      ),
    ).rejects.toThrow();
  });
  it("denies inactive and expired accounts and rolls back bytes when audit persistence fails", async () => {
    const person = await actor(),
      empty = await application.get(person);
    const failing: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (statement) => typed.query(statement),
      transaction: (work) =>
        typed.transaction((tx) =>
          work({
            query: (statement) => {
              if (
                statement.text.startsWith(
                  "INSERT INTO principal_account_photo_events",
                )
              )
                throw Error("Synthetic audit failure");
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      new PostgresAccountPhoto(failing).update(
        person,
        { contractVersion: 1, image },
        empty.etag,
      ),
    ).rejects.toThrow();
    expect(await application.get(person)).toEqual(empty);
    await expect(
      application.update(
        { ...person, authenticatedAt: new Date(0).toISOString() },
        { contractVersion: 1, image },
        empty.etag,
      ),
    ).rejects.toThrow();
    await expect(
      application.get({ ...person, expiresAt: new Date(0).toISOString() }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await typed.query(
      sql(
        "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
        [person.principalId],
      ),
    );
    await expect(application.get(person)).rejects.toMatchObject({
      code: "authentication_required",
    });
  });
});
