import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { PostgresAccountAuthenticatorJournal } from "./account-authenticator-journal.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import { sql, type SqlDatabase } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = "cm_authenticator_test_" + nonce,
  marker = "CloudMarkup synthetic authenticator journal " + nonce;
const issuer =
  "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC";
suite("account authenticator journal on isolated PostgreSQL", () => {
  let admin: PostgresDatabase | undefined,
    db: PostgresDatabase | undefined,
    typed: SqlDatabase,
    journal: PostgresAccountAuthenticatorJournal;
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
    )
      throw Error("Synthetic loopback database required");
    admin = new PostgresDatabase({
      connectionString: configured,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql('CREATE SCHEMA "' + schema + '"'));
      await tx.query(
        sql('COMMENT ON SCHEMA "' + schema + "\" IS '" + marker + "'"),
      );
    });
    db = new PostgresDatabase({
      connectionString: configured,
      max: 5,
      connectionTimeoutMillis: 5000,
      options:
        "-c search_path=" +
        schema +
        " -c timezone=UTC -c statement_timeout=5000",
    });
    typed = withDataApiTypes(db);
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(db, migrations);
    await runMigrations(db, migrations);
    journal = new PostgresAccountAuthenticatorJournal(typed, issuer);
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
          !/^cm_authenticator_test_[a-f0-9]{32}$/u.test(schema)
        )
          throw Error("Refusing unverified cleanup");
        await admin.query(sql('DROP SCHEMA "' + schema + '" CASCADE'));
      } finally {
        await admin.close();
      }
    }
  }, 30000);
  async function actor() {
    const principalId = "principal_" + randomUUID().replaceAll("-", ""),
      subject = randomUUID();
    await typed.query(
      sql(
        "INSERT INTO principals(principal_id,display_name,email) VALUES($1,'Synthetic credential account','old@example.com')",
        [principalId],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO principal_identity_references(identity_reference_id,principal_id,identity_provider,issuer,subject_reference) VALUES($1,$2,'cognito',$3,$4)",
        [
          "identity_" + randomUUID().replaceAll("-", ""),
          principalId,
          issuer,
          subject,
        ],
      ),
    );
    const principal: PrincipalContext = {
      principalId,
      sessionId: "session_" + randomUUID(),
      correlationId: "correlation_" + randomUUID(),
      authenticationSource: "cognito",
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    return { principal, subject };
  }

  it("binds a bounded setup to its account and session without secret storage", async () => {
    const { principal } = await actor(),
      id = randomUUID();
    const starting = await journal.begin(principal, id, "start");
    expect(starting).toMatchObject({
      id,
      status: "starting",
      currentSession: true,
    });
    const deadline = Date.parse(starting?.expiresAt ?? "");
    expect(deadline).toBeLessThanOrEqual(
      Date.parse(principal.authenticatedAt) + 600000,
    );
    await journal.assertCurrent(principal, id);
    await journal.finish(principal, id, "succeeded");
    expect(await journal.read(principal)).toMatchObject({
      id,
      status: "ready",
      currentSession: true,
    });
    const stored = await typed.query(
      sql(
        "SELECT * FROM account_authenticator_enrollments WHERE principal_id=$1",
        [principal.principalId],
      ),
    );
    expect(Object.keys(stored.rows[0] ?? {}).sort()).toEqual(
      [
        "principal_id",
        "enrollment_id",
        "provider_session_sha256",
        "state",
        "last_attempt_id",
        "created_at",
        "expires_at",
      ].sort(),
    );
    expect(JSON.stringify(stored.rows)).not.toContain(principal.sessionId);
  });
  it("normalizes UUID casing and rolls state back if its completion receipt cannot commit", async () => {
    const { principal } = await actor(),
      id = randomUUID();
    await journal.begin(principal, id.toUpperCase(), "start");
    await journal.assertCurrent(principal, id.toUpperCase());
    const failing: SqlDatabase = {
      query: (statement) => typed.query(statement),
      close: () => Promise.resolve(),
      transaction: (work) =>
        typed.transaction((tx) =>
          work({
            query: (statement) => {
              if (
                statement.text.includes(
                  "INSERT INTO account_credential_outcomes",
                )
              )
                throw Error("synthetic receipt failure");
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      new PostgresAccountAuthenticatorJournal(failing, issuer).finish(
        principal,
        id,
        "succeeded",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(await journal.read(principal)).toMatchObject({
      id,
      status: "starting",
    });
    expect(
      (
        await typed.query(
          sql(
            "SELECT 1 FROM account_credential_outcomes WHERE principal_id=$1 AND attempt_id=$2::uuid",
            [principal.principalId, id],
          ),
        )
      ).rowCount,
    ).toBe(0);
    await journal.finish(principal, id.toUpperCase(), "succeeded");
    const verify = randomUUID();
    await journal.begin(
      principal,
      verify.toUpperCase(),
      "verify-enable",
      id.toUpperCase(),
    );
    await journal.finish(principal, id, "uncertain");
    expect(await journal.read(principal)).toMatchObject({
      id,
      status: "verifying",
    });
    await journal.finish(principal, verify, "rejected");
  });
  it("allows only one concurrent setup and refuses duplicate attempt identities", async () => {
    const { principal } = await actor(),
      first = randomUUID(),
      second = randomUUID();
    const results = await Promise.allSettled([
      journal.begin(principal, first, "start"),
      journal.begin(principal, second, "start"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const current = await journal.read(principal);
    if (!current) throw Error("Missing setup");
    await journal.finish(principal, current.id, "succeeded");
    await expect(
      journal.begin(principal, current.id, "start"),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      journal.begin(principal, randomUUID(), "start"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await journal.read(principal))?.id).toBe(current.id);
  });
  it("rejects another account or session verifying a setup but lets its owner explicitly cancel", async () => {
    const one = await actor(),
      two = await actor(),
      id = randomUUID();
    await journal.begin(one.principal, id, "start");
    await journal.finish(one.principal, id, "succeeded");
    await expect(
      journal.begin(two.principal, randomUUID(), "verify-enable", id),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await journal.read(two.principal)).toBeNull();
    const otherSession = {
      ...one.principal,
      sessionId: "family_fresh_" + randomUUID(),
    };
    expect(await journal.read(otherSession)).toMatchObject({
      id,
      currentSession: false,
    });
    await expect(
      journal.begin(otherSession, randomUUID(), "verify-enable", id),
    ).rejects.toMatchObject({ code: "conflict" });
    const cancel = randomUUID();
    await journal.begin(otherSession, cancel, "cancel-setup", id);
    await journal.finish(otherSession, cancel, "succeeded");
    expect(await journal.read(one.principal)).toBeNull();
  });
  it("permits explicit new code attempts after rejection and closes successful verification", async () => {
    const { principal } = await actor(),
      id = randomUUID(),
      bad = randomUUID(),
      good = randomUUID();
    await journal.begin(principal, id, "start");
    await journal.finish(principal, id, "succeeded");
    await journal.begin(principal, bad, "verify-enable", id);
    await journal.assertCurrent(principal, bad);
    expect(await journal.read(principal)).toMatchObject({
      status: "verifying",
    });
    await journal.finish(principal, bad, "rejected");
    expect(await journal.read(principal)).toMatchObject({ status: "ready" });
    await journal.begin(principal, good, "verify-enable", id);
    await journal.finish(principal, good, "succeeded");
    expect(await journal.read(principal)).toBeNull();
    await journal.finish(principal, good, "uncertain");
    expect(
      (
        await typed.query(
          sql(
            "SELECT outcome FROM account_credential_outcomes WHERE principal_id=$1 AND attempt_id=$2::uuid",
            [principal.principalId, good],
          ),
        )
      ).rows[0]?.["outcome"],
    ).toBe("succeeded");
  });
  it("holds uncertain verification until expiry and never accepts an expired code attempt", async () => {
    const { principal } = await actor(),
      id = randomUUID(),
      verify = randomUUID();
    await journal.begin(principal, id, "start");
    await journal.finish(principal, id, "succeeded");
    await journal.begin(principal, verify, "verify-enable", id);
    await journal.finish(principal, verify, "uncertain");
    await expect(
      journal.begin(principal, randomUUID(), "cancel-setup", id),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      journal.begin(principal, randomUUID(), "start"),
    ).rejects.toMatchObject({ code: "conflict" });
    await typed.query(
      sql(
        "UPDATE account_authenticator_enrollments SET created_at=clock_timestamp()-INTERVAL '12 minutes',expires_at=clock_timestamp()-INTERVAL '3 minutes' WHERE principal_id=$1 AND enrollment_id=$2::uuid",
        [principal.principalId, id],
      ),
    );
    expect(await journal.read(principal)).toBeNull();
    await expect(
      journal.begin(principal, randomUUID(), "verify-enable", id),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await journal.begin(principal, randomUUID(), "start")).toMatchObject(
      { status: "starting" },
    );
  });
  it("checks revocation before dispatch and completion while retaining an honest uncertain receipt", async () => {
    const { principal } = await actor(),
      id = randomUUID(),
      verify = randomUUID();
    await journal.begin(principal, id, "start");
    await journal.finish(principal, id, "succeeded");
    await journal.begin(principal, verify, "verify-enable", id);
    await typed.query(
      sql(
        "INSERT INTO account_authentication_cutoffs(principal_id,authenticated_through) VALUES($1,clock_timestamp())",
        [principal.principalId],
      ),
    );
    await expect(
      journal.assertCurrent(principal, verify),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      journal.finish(principal, verify, "succeeded"),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await journal.finish(principal, verify, "uncertain");
    expect(
      (
        await typed.query(
          sql(
            "SELECT state FROM account_authenticator_enrollments WHERE principal_id=$1",
            [principal.principalId],
          ),
        )
      ).rows[0]?.["state"],
    ).toBe("uncertain");
    expect(
      (
        await typed.query(
          sql(
            "SELECT outcome FROM account_credential_outcomes WHERE principal_id=$1 AND attempt_id=$2::uuid",
            [principal.principalId, verify],
          ),
        )
      ).rows[0]?.["outcome"],
    ).toBe("uncertain");
  });
  it("protects immutable stage bindings and supports audited removal without a pending setup", async () => {
    const { principal } = await actor(),
      id = randomUUID();
    expect(await journal.begin(principal, id, "disable")).toBeNull();
    await journal.assertCurrent(principal, id);
    await journal.finish(principal, id, "succeeded");
    await expect(
      typed.query(
        sql(
          "UPDATE account_authenticator_attempts SET action='start' WHERE principal_id=$1",
          [principal.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      typed.query(
        sql(
          "DELETE FROM account_authenticator_attempts WHERE principal_id=$1",
          [principal.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      journal.begin(
        {
          ...principal,
          authenticatedAt: new Date(Date.now() - 660000).toISOString(),
        },
        randomUUID(),
        "start",
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
});
