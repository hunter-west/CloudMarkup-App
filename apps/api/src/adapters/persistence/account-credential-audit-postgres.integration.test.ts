import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { PostgresAccountCredentialAudit } from "./account-credential-audit.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import { sql, type SqlDatabase } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = "cm_credential_test_" + nonce,
  marker = "CloudMarkup synthetic credential audit " + nonce;
const issuer =
  "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
suite("account credential audit on isolated PostgreSQL", () => {
  let admin: PostgresDatabase | undefined,
    db: PostgresDatabase | undefined,
    typed: SqlDatabase,
    audit: PostgresAccountCredentialAudit;
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
    audit = new PostgresAccountCredentialAudit(typed, issuer);
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
          !/^cm_credential_test_[a-f0-9]{32}$/u.test(schema)
        )
          throw Error("Refusing unverified cleanup");
        await admin.query(sql('DROP SCHEMA "' + schema + '" CASCADE'));
      } finally {
        await admin.close();
      }
    }
  }, 30000);
  async function actor(providerSubject: string = randomUUID()) {
    const principalId = "principal_" + randomUUID().replaceAll("-", ""),
      subject = providerSubject;
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
  it("preserves identity and profile versions while synchronizing a verified subject's email", async () => {
    const { principal, subject } = await actor(
        "11111111-2222-7333-4444-555555555555",
      ),
      id = randomUUID();
    const before = (
      await typed.query(
        sql(
          "SELECT principal_id,display_name,application_record_version,profile_record_version,public_username FROM principals WHERE principal_id=$1",
          [principal.principalId],
        ),
      )
    ).rows[0];
    await audit.begin(principal, id, "email-confirm");
    await audit.assertCurrent(principal, id);
    await audit.finish(principal, id, "succeeded", {
      subject,
      email: "verified@example.com",
    });
    expect(
      (
        await typed.query(
          sql(
            "SELECT principal_id,display_name,application_record_version,profile_record_version,public_username FROM principals WHERE principal_id=$1",
            [principal.principalId],
          ),
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await typed.query(
          sql("SELECT email FROM principals WHERE principal_id=$1", [
            principal.principalId,
          ]),
        )
      ).rows[0]?.["email"],
    ).toBe("verified@example.com");
    const rows = await typed.query(
      sql(
        "SELECT a.action,a.provider_session_sha256,o.outcome FROM account_credential_attempts a JOIN account_credential_outcomes o USING(principal_id,attempt_id) WHERE a.principal_id=$1",
        [principal.principalId],
      ),
    );
    expect(rows.rows).toEqual([
      {
        action: "email-confirm",
        provider_session_sha256: digest(principal.sessionId),
        outcome: "succeeded",
      },
    ]);
    await expect(
      typed.query(
        sql(
          "UPDATE account_credential_outcomes SET outcome='rejected' WHERE principal_id=$1",
          [principal.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      typed.query(
        sql("DELETE FROM account_credential_attempts WHERE principal_id=$1", [
          principal.principalId,
        ]),
      ),
    ).rejects.toThrow();
  });
  it("denies reusing an attempt, including after completion", async () => {
    const { principal } = await actor(),
      id = randomUUID();
    await audit.begin(principal, id, "password-change");
    await expect(
      audit.begin(principal, id, "email-resend"),
    ).rejects.toMatchObject({ code: "conflict" });
    await audit.finish(principal, id, "rejected");
    await expect(
      audit.begin(principal, id, "password-change"),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(audit.assertCurrent(principal, id)).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("projects verified contact reads without changing identity, profile or credential journals", async () => {
    const { principal, subject } = await actor(
      "11111111-2222-7333-4444-" +
        randomUUID().replaceAll("-", "").slice(0, 12),
    );
    const before = (
      await typed.query(
        sql(
          "SELECT principal_id,display_name,application_record_version,profile_record_version,public_username FROM principals WHERE principal_id=$1",
          [principal.principalId],
        ),
      )
    ).rows[0];
    const expectedEmail = await audit.readContact(principal);
    await audit.synchronizeVerifiedContact(principal, expectedEmail, {
      subject,
      email: "projected@example.com",
    });
    expect(
      (
        await typed.query(
          sql(
            "SELECT principal_id,display_name,application_record_version,profile_record_version,public_username FROM principals WHERE principal_id=$1",
            [principal.principalId],
          ),
        )
      ).rows[0],
    ).toEqual(before);
    expect((await audit.readContact(principal)).email).toBe(
      "projected@example.com",
    );
    expect(
      (
        await typed.query(
          sql(
            "SELECT attempt_id FROM account_credential_attempts WHERE principal_id=$1",
            [principal.principalId],
          ),
        )
      ).rowCount,
    ).toBe(0);
    await expect(
      audit.synchronizeVerifiedContact(principal, expectedEmail, {
        subject,
        email: "stale@example.com",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect((await audit.readContact(principal)).email).toBe(
      "projected@example.com",
    );
    await audit.synchronizeVerifiedContact(
      principal,
      await audit.readContact(principal),
      {
        subject,
        email: null,
      },
    );
    expect((await audit.readContact(principal)).email).toBeNull();
  });
  it("denies revoked sessions and foreign subject contact projection", async () => {
    const one = await actor(),
      two = await actor();
    const expectedEmail = await audit.readContact(one.principal);
    await expect(
      audit.synchronizeVerifiedContact(one.principal, expectedEmail, {
        subject: two.subject,
        email: "foreign@example.com",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect((await audit.readContact(one.principal)).email).toBe(
      "old@example.com",
    );
    await typed.query(
      sql(
        "INSERT INTO account_authentication_cutoffs(principal_id,authenticated_through) VALUES($1,clock_timestamp())",
        [one.principal.principalId],
      ),
    );
    await expect(
      audit.synchronizeVerifiedContact(one.principal, expectedEmail, {
        subject: one.subject,
        email: "revoked@example.com",
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(audit.readContact(one.principal)).rejects.toMatchObject({
      code: "authentication_required",
    });
    await expect(
      audit.readContact({
        ...two.principal,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(
      (
        await typed.query(
          sql("SELECT email FROM principals WHERE principal_id=$1", [
            one.principal.principalId,
          ]),
        )
      ).rows[0]?.["email"],
    ).toBe("old@example.com");
  });
  it("fences contact reads across an in-flight change and a later A-B-A credential cycle", async () => {
    const { principal, subject } = await actor();
    const snapshot = await audit.readContact(principal);
    const first = randomUUID();
    await audit.begin(principal, first, "email-confirm");
    await expect(audit.readContact(principal)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    await audit.finish(principal, first, "succeeded", {
      subject,
      email: "new@example.com",
    });
    const second = randomUUID();
    await audit.begin(principal, second, "email-confirm");
    await audit.finish(principal, second, "succeeded", {
      subject,
      email: snapshot.email ?? "old@example.com",
    });
    await expect(
      audit.synchronizeVerifiedContact(principal, snapshot, {
        subject,
        email: "delayed@example.com",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect((await audit.readContact(principal)).email).toBe("old@example.com");
  });
  it("allows only one concurrently admitted credential change", async () => {
    const { principal } = await actor();
    const results = await Promise.allSettled([
      audit.begin(principal, randomUUID(), "email-start"),
      audit.begin(principal, randomUUID(), "password-change"),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  });
  it("prevents cross-account and cross-session finalization", async () => {
    const one = await actor(),
      two = await actor(),
      id = randomUUID();
    await audit.begin(one.principal, id, "email-confirm");
    await expect(
      audit.finish(two.principal, id, "succeeded", {
        subject: two.subject,
        email: "other@example.com",
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      audit.finish(
        { ...one.principal, sessionId: "different" },
        id,
        "rejected",
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      audit.finish(one.principal, id, "succeeded", {
        subject: two.subject,
        email: "other@example.com",
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(
      (
        await typed.query(
          sql("SELECT email FROM principals WHERE principal_id=$1", [
            one.principal.principalId,
          ]),
        )
      ).rows[0]?.["email"],
    ).toBe("old@example.com");
    expect(
      (
        await typed.query(
          sql(
            "SELECT outcome FROM account_credential_outcomes WHERE principal_id=$1",
            [one.principal.principalId],
          ),
        )
      ).rowCount,
    ).toBe(0);
  });
  it("rechecks revocation before dispatch and successful email persistence", async () => {
    const { principal, subject } = await actor(),
      id = randomUUID();
    await audit.begin(principal, id, "email-confirm");
    await typed.query(
      sql(
        "INSERT INTO account_authentication_cutoffs(principal_id,authenticated_through) VALUES($1,clock_timestamp())",
        [principal.principalId],
      ),
    );
    await expect(audit.assertCurrent(principal, id)).rejects.toMatchObject({
      code: "authentication_required",
    });
    await expect(
      audit.finish(principal, id, "succeeded", {
        subject,
        email: "new@example.com",
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await audit.finish(principal, id, "uncertain");
    expect(
      (
        await typed.query(
          sql(
            "SELECT outcome FROM account_credential_outcomes WHERE principal_id=$1",
            [principal.principalId],
          ),
        )
      ).rows[0]?.["outcome"],
    ).toBe("uncertain");
  });
  it("bounds new attempts and rejects stale authentication", async () => {
    const { principal } = await actor();
    await expect(
      audit.begin(
        {
          ...principal,
          authenticatedAt: new Date(Date.now() - 660000).toISOString(),
        },
        randomUUID(),
        "email-resend",
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    for (let i = 0; i < 12; i++) {
      const id = randomUUID();
      await audit.begin(principal, id, "email-resend");
      await audit.finish(principal, id, "rejected");
    }
    await expect(
      audit.begin(principal, randomUUID(), "email-resend"),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
  it("never lets an expired attempt overwrite a newer change", async () => {
    const { principal, subject } = await actor(),
      old = randomUUID(),
      next = randomUUID();
    await typed.query(
      sql(
        "INSERT INTO account_credential_attempts(principal_id,attempt_id,action,provider_session_sha256,correlation_id,started_at) VALUES($1,$2::uuid,'email-start',$3,$4,clock_timestamp()-INTERVAL '3 minutes')",
        [
          principal.principalId,
          old,
          digest(principal.sessionId),
          principal.correlationId,
        ],
      ),
    );
    await audit.begin(principal, next, "email-confirm");
    await expect(audit.assertCurrent(principal, old)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      audit.finish(principal, old, "succeeded", {
        subject,
        email: "old-result@example.com",
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await audit.finish(principal, next, "succeeded", {
      subject,
      email: "current@example.com",
    });
    await audit.finish(principal, old, "uncertain");
    expect(
      (
        await typed.query(
          sql("SELECT email FROM principals WHERE principal_id=$1", [
            principal.principalId,
          ]),
        )
      ).rows[0]?.["email"],
    ).toBe("current@example.com");
  });
});
