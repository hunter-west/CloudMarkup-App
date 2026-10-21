import { PostgresGitLabExportReviews } from "./gitlab-export-reviews.js";
import { gitLabExportApprovalDigest } from "../../application/gitlab-export-state.js";
import { PostgresGitLabProjectSelections } from "./gitlab-project-selections.js";
import { createProductionGitLabProjects } from "../../production-gitlab-projects.js";
import { httpText } from "../gitlab-test-helpers.js";
import {
  GenerateDataKeyCommand,
  DecryptCommand,
  type KMSClient,
} from "@aws-sdk/client-kms";
import {
  createGitLabConnectionApplication,
  createProductionGitLabConnections,
} from "../../production-gitlab-connections.js";
import { PostgresGitLabGrants } from "./gitlab-grants.js";
import {
  gitLabGrantBindingDigestV1,
  type GitLabGrantBindingV1,
  type GitLabSealedGrantV1,
} from "../gitlab-grant-vault.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { GitLabConnectionAuthority } from "./gitlab-connection-authority.js";
import { PostgresGitLabLinkIntents } from "./gitlab-link-intents.js";
import { sql, type SqlDatabase } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_gitlab_intents_it_${nonce}`;
const marker = `CloudMarkup synthetic GitLab intents ${nonce}`;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
const state = () => randomBytes(32).toString("base64url");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const applicationId = "a".repeat(64);

suite("GitLab link intents on isolated PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let created = false;
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
    )
      throw Error("Explicit synthetic loopback PostgreSQL is required.");
    if (!/^cm_gitlab_intents_it_[a-f0-9]{32}$/u.test(schema))
      throw Error("Unsafe schema.");
    admin = new PostgresDatabase({
      connectionString: configured,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql(`CREATE SCHEMA "${schema}"`));
      await tx.query(sql(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`));
    });
    created = true;
    database = new PostgresDatabase({
      connectionString: configured,
      max: 4,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema} -c timezone=Pacific/Honolulu -c statement_timeout=10000`,
    });
    opened = database;
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(database, migrations);
    await runMigrations(database, migrations);
  }, 120000);
  afterAll(async () => {
    try {
      await opened?.close();
      if (created && admin) {
        const found = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          ),
        );
        if (
          found.rows[0]?.["marker"] !== marker ||
          !/^cm_gitlab_intents_it_[a-f0-9]{32}$/u.test(schema)
        )
          throw Error("Refusing to remove an unverified synthetic schema.");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      }
    } finally {
      await admin?.close();
    }
  }, 30000);
  async function fixture(
    role: "owner" | "administrator" | "editor" | "viewer" = "owner",
  ) {
    const organizationId = id("org");
    const principal: PrincipalContext = {
      principalId: id("principal"),
      sessionId: id("session"),
      correlationId: id("correlation"),
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      authenticationSource: "cognito",
    };
    await database.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic GitLab actor')",
          [principal.principalId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic GitLab workspace',$2)",
          [organizationId, organizationId.replaceAll("_", "-")],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) SELECT $1,role_key,'authorization-v2',role_key='owner',cloudmarkup_authorization_v2_permissions(role_key) FROM (VALUES('owner'),('administrator'),('editor'),('viewer')) AS roles(role_key)",
          [organizationId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,$4)",
          [id("membership"), organizationId, principal.principalId, role],
        ),
      );
    });
    const make = (
      actor = principal,
      org = organizationId,
      app = applicationId,
      db: SqlDatabase = database,
    ) =>
      new PostgresGitLabLinkIntents(
        new GitLabConnectionAuthority(db, actor, org),
        app,
      );
    return { principal, organizationId, make, store: make() };
  }
  it.each(["owner", "administrator"] as const)(
    "allows a current %s to consume once and records safe atomic audit",
    async (role) => {
      const f = await fixture(role);
      const raw = state();
      const intent = await f.store.start(raw);
      expect(intent).toMatchObject({ status: "pending" });
      expect(await f.store.consume(intent.intentId, raw)).toMatchObject({
        status: "consumed",
        connectionId: intent.connectionId,
      });
      await expect(f.store.consume(intent.intentId, raw)).rejects.toMatchObject(
        { code: "conflict" },
      );
      expect(await f.store.inspect(intent.intentId)).toMatchObject({
        status: "consumed",
      });
      const records = await database.query(
        sql(
          "SELECT to_jsonb(i) AS value FROM gitlab_oauth_link_intents i WHERE intent_id=$1",
          [intent.intentId],
        ),
      );
      expect(JSON.stringify(records)).not.toContain(raw);
      expect(records.rows[0]?.["value"]).toMatchObject({
        state_sha256: hash(raw),
        session_sha256: hash(f.principal.sessionId),
      });
      const audits = await database.query(
        sql(
          "SELECT action,safe_summary FROM audit_events WHERE target_id=$1 ORDER BY occurred_at",
          [intent.intentId],
        ),
      );
      expect(audits.rows.map((row) => row["action"])).toEqual([
        "gitlab.connection.start",
        "gitlab.connection.consume",
      ]);
      expect(JSON.stringify(audits)).not.toContain(raw);
    },
  );
  it.each(["editor", "viewer"] as const)(
    "denies %s management",
    async (role) => {
      const f = await fixture(role);
      await expect(f.store.start(state())).rejects.toMatchObject({
        code: "access_denied",
      });
    },
  );
  it("allows exactly one concurrent callback claim", async () => {
    const f = await fixture();
    const raw = state();
    const intent = await f.store.start(raw);
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () => f.store.consume(intent.intentId, raw)),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "rejected")).toHaveLength(3);
  });
  it.each(["state", "session", "application", "workspace", "actor"] as const)(
    "rejects %s substitution without consuming the intent",
    async (kind) => {
      const f = await fixture();
      const other = await fixture();
      const raw = state();
      const intent = await f.store.start(raw);
      const altered =
        kind === "session"
          ? f.make({ ...f.principal, sessionId: id("session") })
          : kind === "application"
            ? f.make(f.principal, f.organizationId, "b".repeat(64))
            : kind === "workspace"
              ? f.make(f.principal, other.organizationId)
              : kind === "actor"
                ? other.make(other.principal, f.organizationId)
                : f.store;
      await expect(
        altered.consume(intent.intentId, kind === "state" ? state() : raw),
      ).rejects.toMatchObject({
        code:
          kind === "workspace" || kind === "actor" ? "not_found" : "conflict",
      });
      expect(await f.store.consume(intent.intentId, raw)).toMatchObject({
        status: "consumed",
      });
    },
  );
  it.each([
    "revoked-session",
    "cutoff",
    "expired",
    "stale-auth",
    "principal",
    "membership",
    "workspace",
  ] as const)("checks current %s after initiation", async (kind) => {
    const f = await fixture();
    const raw = state();
    const intent = await f.store.start(raw);
    let actor = f.principal;
    if (kind === "revoked-session")
      await database.query(
        sql(
          "INSERT INTO account_revoked_session_families(principal_id,provider_session_sha256) VALUES($1,$2)",
          [actor.principalId, hash(actor.sessionId)],
        ),
      );
    if (kind === "cutoff")
      await database.query(
        sql(
          "INSERT INTO account_authentication_cutoffs(principal_id,authenticated_through) VALUES($1,clock_timestamp())",
          [actor.principalId],
        ),
      );
    if (kind === "expired")
      actor = {
        ...actor,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
    if (kind === "stale-auth")
      actor = {
        ...actor,
        authenticatedAt: new Date(Date.now() - 660000).toISOString(),
      };
    if (kind === "principal")
      await database.query(
        sql(
          "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
          [actor.principalId],
        ),
      );
    if (kind === "membership")
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE principal_id=$1 AND organization_id=$2",
          [actor.principalId, f.organizationId],
        ),
      );
    if (kind === "workspace")
      await database.query(
        sql(
          "UPDATE organizations SET lifecycle_status='suspended' WHERE organization_id=$1",
          [f.organizationId],
        ),
      );
    await expect(
      f.make(actor).consume(intent.intentId, raw),
    ).rejects.toMatchObject({
      code:
        kind === "stale-auth"
          ? "access_denied"
          : kind === "workspace" || kind === "membership"
            ? "not_found"
            : "authentication_required",
    });
    const row = await database.query(
      sql(
        "SELECT lifecycle_status FROM gitlab_oauth_link_intents WHERE intent_id=$1",
        [intent.intentId],
      ),
    );
    expect(row.rows[0]?.["lifecycle_status"]).toBe("pending");
  });
  it("denies an expired intent using the database clock", async () => {
    const f = await fixture();
    const raw = state();
    const intentId = id("gitlablink");
    await database.query(
      sql(
        `INSERT INTO gitlab_oauth_link_intents(intent_id,connection_id,organization_id,principal_id,application_id,session_sha256,state_sha256,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,statement_timestamp()-INTERVAL '11 minutes',statement_timestamp()-INTERVAL '1 minute')`,
        [
          intentId,
          id("gitlab"),
          f.organizationId,
          f.principal.principalId,
          applicationId,
          hash(f.principal.sessionId),
          hash(raw),
        ],
      ),
    );
    await expect(f.store.consume(intentId, raw)).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("caps parallel pending intents under the actor lock", async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => f.store.start(state())),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(10);
    for (const attempt of attempts)
      if (attempt.status === "rejected")
        expect(attempt.reason).toMatchObject({ code: "rate_limited" });
  });
  it("rolls intent consumption back if the audit write fails", async () => {
    const f = await fixture();
    const raw = state();
    const intent = await f.store.start(raw);
    const failing: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (statement) => database.query(statement),
      transaction: (work) =>
        database.transaction((tx) =>
          work({
            query: (statement) => {
              if (statement.text.includes("INSERT INTO audit_events"))
                throw Error("synthetic audit outage with private details");
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      f
        .make(f.principal, f.organizationId, applicationId, failing)
        .consume(intent.intentId, raw),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      message: "GitLab connections are temporarily unavailable.",
    });
    expect(await f.store.inspect(intent.intentId)).toMatchObject({
      status: "pending",
    });
    expect(await f.store.consume(intent.intentId, raw)).toMatchObject({
      status: "consumed",
    });
  });
  it("snapshots actor identity and rechecks expiry before committing", async () => {
    const f = await fixture();
    const actor = { ...f.principal };
    const authority = new GitLabConnectionAuthority(
      database,
      actor,
      f.organizationId,
    );
    actor.principalId = id("principal");
    await expect(
      authority.assertCurrent("integrations.manage"),
    ).resolves.toBeUndefined();
    let now = new Date();
    const expiring = new GitLabConnectionAuthority(
      database,
      f.principal,
      f.organizationId,
      () => now,
    );
    await expect(
      expiring.transaction("integrations.manage", async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO account_revoked_session_families(principal_id,provider_session_sha256) VALUES($1,$2)",
            [f.principal.principalId, hash("rollback-test")],
          ),
        );
        now = new Date(Date.parse(f.principal.expiresAt) + 1);
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    const check = await database.query(
      sql(
        "SELECT 1 FROM account_revoked_session_families WHERE principal_id=$1 AND provider_session_sha256=$2",
        [f.principal.principalId, hash("rollback-test")],
      ),
    );
    expect(check.rows).toHaveLength(0);
  });
  it("database constraints preserve owner, expiry, digest and consumed identity", async () => {
    const f = await fixture();
    const raw = state();
    const intent = await f.store.start(raw);
    for (const column of [
      "principal_id",
      "organization_id",
      "application_id",
      "session_sha256",
      "state_sha256",
    ]) {
      await expect(
        database.query(
          sql(
            `UPDATE gitlab_oauth_link_intents SET ${column}=$2 WHERE intent_id=$1`,
            [
              intent.intentId,
              column.endsWith("sha256") || column === "application_id"
                ? "b".repeat(64)
                : id("other"),
            ],
          ),
        ),
      ).rejects.toThrow();
    }
    await expect(
      database.query(
        sql(
          "UPDATE gitlab_oauth_link_intents SET expires_at=expires_at+INTERVAL '1 minute' WHERE intent_id=$1",
          [intent.intentId],
        ),
      ),
    ).rejects.toThrow();
    await f.store.consume(intent.intentId, raw);
    await expect(
      database.query(
        sql(
          "UPDATE gitlab_oauth_link_intents SET lifecycle_status='pending',consumed_at=NULL WHERE intent_id=$1",
          [intent.intentId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql("DELETE FROM gitlab_oauth_link_intents WHERE intent_id=$1", [
          intent.intentId,
        ]),
      ),
    ).rejects.toThrow();
  });
  function envelope(binding: GitLabGrantBindingV1): GitLabSealedGrantV1 {
    // Storage tests use structurally valid opaque ciphertext; vault crypto is verified separately.
    return {
      schemaVersion: 1,
      algorithm: "aes-256-gcm",
      keyArn:
        "arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
      bindingSha256: gitLabGrantBindingDigestV1(binding),
      encryptedDataKey: randomBytes(32).toString("base64"),
      iv: randomBytes(12).toString("base64"),
      authenticationTag: randomBytes(16).toString("base64"),
      ciphertext: randomBytes(64).toString("base64"),
    };
  }
  async function linked() {
    const f = await fixture();
    const raw = state();
    const intent = await f.store.start(raw);
    await f.store.consume(intent.intentId, raw);
    const binding: GitLabGrantBindingV1 = {
      schemaVersion: 1,
      organizationId: f.organizationId,
      principalId: f.principal.principalId,
      applicationId,
      connectionId: intent.connectionId,
      providerUserId: 42,
      grantVersion: 1,
    };
    const details = {
      providerUserId: 42,
      username: "synthetic-gitlab",
      expiresAt: new Date(Date.now() + 7200000).toISOString(),
    };
    const makeGrants = (
      actor = f.principal,
      org = f.organizationId,
      app = applicationId,
      db: SqlDatabase = database,
    ) =>
      new PostgresGitLabGrants(
        new GitLabConnectionAuthority(db, actor, org),
        app,
      );
    const grants = makeGrants();
    const sealed = envelope(binding);
    const connected = await grants.completeLink(
      intent.intentId,
      intent.connectionId,
      details,
      sealed,
    );
    return {
      ...f,
      intent,
      binding,
      details,
      grants,
      makeGrants,
      sealed,
      connected,
    };
  }
  it("atomically completes the consumed intent and stores only the bound encrypted grant", async () => {
    const f = await linked();
    expect(f.connected).toMatchObject({
      status: "active",
      binding: f.binding,
      recordVersion: 1,
      providerRevocationUncertain: false,
    });
    expect(await f.store.inspect(f.intent.intentId)).toMatchObject({
      status: "completed",
    });
    await expect(
      f.grants.completeLink(
        f.intent.intentId,
        f.intent.connectionId,
        f.details,
        f.sealed,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await f.grants.get(f.intent.connectionId)).toEqual(f.connected);
    await expect(
      f.grants.assertUsable(f.intent.connectionId, 1),
    ).resolves.toBeUndefined();
    const audit = await database.query(
      sql("SELECT action FROM audit_events WHERE target_id=$1", [
        f.intent.connectionId,
      ]),
    );
    expect(audit.rows).toEqual([{ action: "gitlab.connection.connect" }]);
  });
  it("rejects an envelope bound to another grant without completing the intent", async () => {
    const f = await fixture();
    const raw = state();
    const intent = await f.store.start(raw);
    await f.store.consume(intent.intentId, raw);
    const binding: GitLabGrantBindingV1 = {
      schemaVersion: 1,
      organizationId: f.organizationId,
      principalId: f.principal.principalId,
      applicationId,
      connectionId: intent.connectionId,
      providerUserId: 42,
      grantVersion: 1,
    };
    const grants = new PostgresGitLabGrants(
      new GitLabConnectionAuthority(database, f.principal, f.organizationId),
      applicationId,
    );
    expect(() =>
      grants.completeLink(
        intent.intentId,
        intent.connectionId,
        {
          providerUserId: 42,
          username: "synthetic",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        envelope({ ...binding, grantVersion: 2 }),
      ),
    ).toThrow("invalid");
    expect(await f.store.inspect(intent.intentId)).toMatchObject({
      status: "consumed",
    });
  });
  it.each(["workspace", "actor", "application"] as const)(
    "denies grant reads for another %s",
    async (kind) => {
      const f = await linked();
      const other = await fixture();
      const altered =
        kind === "workspace"
          ? f.makeGrants(f.principal, other.organizationId)
          : kind === "actor"
            ? f.makeGrants(other.principal, f.organizationId)
            : f.makeGrants(f.principal, f.organizationId, "b".repeat(64));
      await expect(altered.get(f.intent.connectionId)).rejects.toMatchObject({
        code: "not_found",
      });
    },
  );
  it("does not share a personal provider grant with another administrator of the same workspace", async () => {
    const f = await linked();
    const other = await fixture();
    await database.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'administrator')",
        [id("membership"), f.organizationId, other.principal.principalId],
      ),
    );
    await expect(
      f.makeGrants(other.principal).get(f.intent.connectionId),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await f.makeGrants(other.principal).list()).items).toEqual([]);
  });
  it("permits exactly one refresh claim and one conditional grant replacement", async () => {
    const f = await linked();
    const results = await Promise.allSettled([
      f.grants.claimRefresh(f.intent.connectionId, 1),
      f.grants.claimRefresh(f.intent.connectionId, 1),
    ]);
    const successes = results.filter((result) => result.status === "fulfilled");
    expect(successes).toHaveLength(1);
    const claim = successes[0]?.value;
    expect(claim?.refreshAttemptId).toBeTruthy();
    const attempt = claim?.refreshAttemptId ?? "";
    await expect(
      f.grants.assertUsable(f.intent.connectionId, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.grants.assertRefreshCurrent(f.intent.connectionId, 1, attempt),
    ).resolves.toBeUndefined();
    const changed = envelope({ ...f.binding, grantVersion: 2 });
    const completed = await f.grants.completeRefresh(
      f.intent.connectionId,
      1,
      attempt,
      f.details,
      changed,
    );
    expect(completed).toMatchObject({
      status: "active",
      binding: { grantVersion: 2 },
      refreshAttemptId: attempt,
      recordVersion: 3,
    });
    await expect(
      f.grants.completeRefresh(
        f.intent.connectionId,
        1,
        attempt,
        f.details,
        changed,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.grants.markRefreshUnknown(f.intent.connectionId, 1, attempt),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.grants.assertUsable(f.intent.connectionId, 2),
    ).resolves.toBeUndefined();
    await expect(
      f.grants.assertUsable(f.intent.connectionId, 1),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("binds refresh completion to the claiming session and exact attempt", async () => {
    const f = await linked();
    const claim = await f.grants.claimRefresh(f.intent.connectionId, 1);
    const attempt = claim.refreshAttemptId ?? "";
    const changed = envelope({ ...f.binding, grantVersion: 2 });
    await expect(
      f
        .makeGrants({ ...f.principal, sessionId: id("session") })
        .completeRefresh(f.intent.connectionId, 1, attempt, f.details, changed),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.grants.completeRefresh(
        f.intent.connectionId,
        1,
        id("gitlabrefresh"),
        f.details,
        changed,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await f.grants.completeRefresh(
        f.intent.connectionId,
        1,
        attempt,
        f.details,
        changed,
      ),
    ).toMatchObject({ status: "active" });
  });
  it("retains readback after a lost refresh commit acknowledgement", async () => {
    const f = await linked();
    const claim = await f.grants.claimRefresh(f.intent.connectionId, 1);
    const attempt = claim.refreshAttemptId ?? "";
    const lostAck: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (statement) => database.query(statement),
      transaction: async (work) => {
        await database.transaction(work);
        throw Error("synthetic acknowledgement loss");
      },
    };
    await expect(
      f
        .makeGrants(f.principal, f.organizationId, applicationId, lostAck)
        .completeRefresh(
          f.intent.connectionId,
          1,
          attempt,
          f.details,
          envelope({ ...f.binding, grantVersion: 2 }),
        ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(await f.grants.get(f.intent.connectionId)).toMatchObject({
      status: "active",
      binding: { grantVersion: 2 },
      refreshAttemptId: attempt,
    });
    await expect(
      f.grants.claimRefresh(f.intent.connectionId, 1),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("never makes an unknown refresh usable again or falsely confirms revocation", async () => {
    const f = await linked();
    const claim = await f.grants.claimRefresh(f.intent.connectionId, 1);
    const attempt = claim.refreshAttemptId ?? "";
    expect(
      await f.grants.markRefreshUnknown(f.intent.connectionId, 1, attempt),
    ).toMatchObject({
      status: "reconnect-required",
      providerRevocationUncertain: true,
      sealedGrant: f.sealed,
    });
    await expect(
      f.grants.claimRefresh(f.intent.connectionId, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.grants.completeRefresh(
        f.intent.connectionId,
        1,
        attempt,
        f.details,
        envelope({ ...f.binding, grantVersion: 2 }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await f.grants.disconnect(f.intent.connectionId)).toMatchObject({
      status: "disconnected",
      providerRevocationUncertain: true,
    });
    await expect(
      f.grants.confirmRevoked(f.intent.connectionId, 1),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("disconnect blocks in-flight refresh completion and retains uncertain provider state", async () => {
    const f = await linked();
    const claim = await f.grants.claimRefresh(f.intent.connectionId, 1);
    expect(await f.grants.disconnect(f.intent.connectionId)).toMatchObject({
      status: "disconnected",
      providerRevocationUncertain: true,
    });
    await expect(
      f.grants.completeRefresh(
        f.intent.connectionId,
        1,
        claim.refreshAttemptId ?? "",
        f.details,
        envelope({ ...f.binding, grantVersion: 2 }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.grants.assertRefreshCurrent(
        f.intent.connectionId,
        1,
        claim.refreshAttemptId ?? "",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("disconnect immediately denies use and clears encrypted material only after known revocation", async () => {
    const f = await linked();
    await expect(
      f.grants.confirmRevoked(f.intent.connectionId, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    const disconnected = await f.grants.disconnect(f.intent.connectionId);
    expect(disconnected).toMatchObject({
      status: "disconnected",
      sealedGrant: f.sealed,
      providerRevocationUncertain: false,
    });
    expect(await f.grants.disconnect(f.intent.connectionId)).toEqual(
      disconnected,
    );
    await expect(
      f.grants.assertUsable(f.intent.connectionId, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await f.grants.confirmRevoked(f.intent.connectionId, 1),
    ).toMatchObject({ status: "revoked", sealedGrant: null });
    expect(
      await f.grants.confirmRevoked(f.intent.connectionId, 1),
    ).toMatchObject({ status: "revoked", sealedGrant: null });
    await expect(
      f.grants.claimRefresh(f.intent.connectionId, 1),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("database guards prevent grant substitution, resurrection and credential clearing before revocation", async () => {
    const f = await linked();
    for (const mutation of [
      "grant_version=2",
      "provider_user_id=43",
      "sealed_grant=NULL",
      "lifecycle_status='revoked'",
    ]) {
      await expect(
        database.query(
          sql(
            `UPDATE gitlab_oauth_connections SET ${mutation},record_version=record_version+1 WHERE connection_id=$1`,
            [f.intent.connectionId],
          ),
        ),
      ).rejects.toThrow();
    }
    await f.grants.disconnect(f.intent.connectionId);
    await expect(
      database.query(
        sql(
          "UPDATE gitlab_oauth_connections SET lifecycle_status='active',record_version=record_version+1 WHERE connection_id=$1",
          [f.intent.connectionId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql("DELETE FROM gitlab_oauth_connections WHERE connection_id=$1", [
          f.intent.connectionId,
        ]),
      ),
    ).rejects.toThrow();
  });
  function composedFixture(expiresIn = 7200) {
    const keyArn =
      "arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555";
    const keys = new Map<string, { plain: Buffer; context: string }>();
    const issued: Uint8Array[] = [];
    const secrets: Uint8Array[] = [];
    const send = async (command: GenerateDataKeyCommand | DecryptCommand) => {
      await Promise.resolve(); // Preserve an asynchronous synthetic transport boundary.
      if (command instanceof GenerateDataKeyCommand) {
        const wrapped = randomBytes(32),
          plain = randomBytes(32);
        keys.set(wrapped.toString("base64"), {
          plain: Buffer.from(plain),
          context: JSON.stringify(command.input.EncryptionContext),
        });
        issued.push(plain);
        return {
          $metadata: {},
          KeyId: keyArn,
          Plaintext: plain,
          CiphertextBlob: wrapped,
        };
      }
      const record = keys.get(
        Buffer.from(command.input.CiphertextBlob ?? []).toString("base64"),
      );
      if (
        !record ||
        command.input.KeyId !== keyArn ||
        record.context !== JSON.stringify(command.input.EncryptionContext)
      )
        throw Error("Synthetic KMS binding mismatch");
      const plain = Buffer.from(record.plain);
      issued.push(plain);
      return {
        $metadata: {},
        KeyId: keyArn,
        Plaintext: plain,
        EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      };
    };
    const calls: { path: string; grantType: string | null }[] = [];
    let tokenVersion = 0;
    let uncertainRefresh = false;
    const fetch: typeof globalThis.fetch = async (url, init) => {
      await Promise.resolve();
      const path = new URL(httpText(url)).pathname;
      const parameters = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      calls.push({ path, grantType: parameters.get("grant_type") });
      if (path === "/oauth/token") {
        tokenVersion++;
        if (
          parameters.get("grant_type") === "refresh_token" &&
          uncertainRefresh
        )
          throw Error("Synthetic lost refresh response");
        return Response.json({
          access_token: `synthetic-access-token-version-${String(tokenVersion)}`,
          refresh_token: `synthetic-refresh-token-version-${String(tokenVersion)}`,
          token_type: "bearer",
          created_at: Math.floor(Date.now() / 1000),
          expires_in: tokenVersion === 1 ? expiresIn : 7200,
        });
      }
      if (path === "/oauth/token/info")
        return Response.json({
          resource_owner_id: 42,
          scope: ["api"],
          application: { uid: applicationId },
          expires_in: tokenVersion === 1 ? expiresIn : 7200,
        });
      if (path === "/api/v4/user")
        return Response.json({
          id: 42,
          username: "synthetic-provider-user",
          state: "active",
        });
      if (path === "/oauth/revoke") return Response.json({});
      throw Error("Unexpected synthetic provider path");
    };
    const options = {
      database,
      applicationId,
      redirectUri: "https://app.example.test/account/gitlab/callback",
      readClientSecret: () => {
        const value = Buffer.from("synthetic-gitlab-client-secret");
        secrets.push(value);
        return Promise.resolve(value);
      },
      vault: {
        activeKeyArn: keyArn,
        client: { send: send as KMSClient["send"] },
      },
      fetch,
      enabled: true,
    };
    return {
      service: createProductionGitLabConnections(options),
      options,
      calls,
      issued,
      secrets,
      loseRefresh: () => {
        uncertainRefresh = true;
      },
    };
  }
  async function composedLink(expiresIn = 7200) {
    const f = await fixture();
    const c = composedFixture(expiresIn);
    const started = await c.service.start(f.principal, f.organizationId);
    const completion = {
      cookie: started.cookie,
      intentId: started.intentId,
      state: new URL(started.authorizationUrl).searchParams.get("state") ?? "",
      code: "synthetic-authorization-code",
    };
    const connection = await c.service.complete(
      f.principal,
      f.organizationId,
      completion,
    );
    return { ...f, ...c, started, completion, connection };
  }
  it("composes OAuth, sealed browser state, real SQL and encrypted grants without repeating exchange", async () => {
    const f = await composedLink();
    expect(f.connection).toMatchObject({
      status: "active",
      username: "synthetic-provider-user",
    });
    expect(
      await f.service.complete(f.principal, f.organizationId, f.completion),
    ).toEqual(f.connection);
    expect(f.calls.filter((call) => call.path === "/oauth/token")).toHaveLength(
      1,
    );
    let token: Uint8Array | undefined;
    const result = await f.service.withAccess(
      f.principal,
      f.organizationId,
      f.connection.binding.connectionId,
      async (value) => {
        token = value.accessToken;
        expect(new TextDecoder().decode(token)).toBe(
          "synthetic-access-token-version-1",
        );
        await value.assertCurrentAdmission();
        return "synthetic read complete";
      },
    );
    expect(result).toBe("synthetic read complete");
    expect(token?.every((byte) => byte === 0)).toBe(true);
    expect(f.issued.every((value) => value.every((byte) => byte === 0))).toBe(
      true,
    );
    expect(f.secrets.every((value) => value.every((byte) => byte === 0))).toBe(
      true,
    );
    const rows = await database.query(
      sql(
        "SELECT to_jsonb(c) AS value FROM gitlab_oauth_connections c WHERE connection_id=$1",
        [f.connection.binding.connectionId],
      ),
    );
    for (const secret of [
      "synthetic-access-token",
      "synthetic-refresh-token",
      f.completion.code,
      f.completion.cookie,
    ])
      expect(JSON.stringify(rows)).not.toContain(secret);
  });
  it("projects only public account metadata and reports revocation accurately", async () => {
    const f = await composedLink();
    const application = createGitLabConnectionApplication(f.service);
    const expected = {
      contractVersion: 1,
      id: f.connection.binding.connectionId,
      organizationId: f.organizationId,
      principalId: f.principal.principalId,
      providerUsername: "synthetic-provider-user",
      status: "active",
      providerRevocation: "not-requested",
    };
    expect(
      await application.get(f.principal, f.organizationId, expected.id),
    ).toEqual(expected);
    expect(await application.list(f.principal, f.organizationId, 50)).toEqual({
      items: [expected],
    });
    expect(
      await application.complete(
        f.principal,
        f.organizationId,
        {
          contractVersion: 1,
          intentId: f.completion.intentId,
          state: f.completion.state,
          code: f.completion.code,
        },
        f.completion.cookie,
      ),
    ).toEqual(expected);
    expect(
      await application.disconnect(f.principal, f.organizationId, expected.id),
    ).toEqual({
      ...expected,
      status: "revoked",
      providerRevocation: "confirmed",
    });
  });
  it("bounds browser expiry when the API clock trails the database clock", async () => {
    const f = await fixture();
    const c = composedFixture();
    const apiNow = new Date(Date.now() - 1000);
    const service = createProductionGitLabConnections({
      ...c.options,
      clock: () => apiNow,
    });
    const started = await service.start(f.principal, f.organizationId);
    expect(Date.parse(started.expiresAt)).toBe(apiNow.getTime() + 600000);
    const durable = await f.store.inspect(started.intentId);
    expect(Date.parse(started.expiresAt)).toBeLessThan(
      Date.parse(durable.expiresAt),
    );
    expect(
      await service.complete(f.principal, f.organizationId, {
        cookie: started.cookie,
        intentId: started.intentId,
        state:
          new URL(started.authorizationUrl).searchParams.get("state") ?? "",
        code: "synthetic-authorization-code",
      }),
    ).toMatchObject({ status: "active" });
  });
  it("composed capability stays off unless explicitly enabled", async () => {
    const f = await fixture();
    const c = composedFixture();
    const service = createProductionGitLabConnections({
      ...c.options,
      enabled: false,
    });
    await expect(
      service.start(f.principal, f.organizationId),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(c.calls).toEqual([]);
    expect(c.issued).toEqual([]);
    expect(c.secrets).toEqual([]);
  });
  it("rejects a substituted callback session before contacting GitLab", async () => {
    const f = await fixture();
    const c = composedFixture();
    const started = await c.service.start(f.principal, f.organizationId);
    await expect(
      c.service.complete(
        { ...f.principal, sessionId: id("session") },
        f.organizationId,
        {
          cookie: started.cookie,
          intentId: started.intentId,
          state:
            new URL(started.authorizationUrl).searchParams.get("state") ?? "",
          code: "synthetic-authorization-code",
        },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(c.calls).toEqual([]);
  });
  it("refreshes an expiring grant once and uses only the stored next version", async () => {
    const f = await composedLink(60);
    let captured: Uint8Array | undefined;
    await f.service.withAccess(
      f.principal,
      f.organizationId,
      f.connection.binding.connectionId,
      async (value) => {
        await value.assertCurrentAdmission();
        captured = value.accessToken;
        expect(new TextDecoder().decode(value.accessToken)).toBe(
          "synthetic-access-token-version-2",
        );
      },
    );
    expect(captured?.every((byte) => byte === 0)).toBe(true);
    expect(
      f.calls.filter((call) => call.grantType === "refresh_token"),
    ).toHaveLength(1);
    expect(
      await f.service.get(
        f.principal,
        f.organizationId,
        f.connection.binding.connectionId,
      ),
    ).toMatchObject({ status: "active", binding: { grantVersion: 2 } });
  });
  it("a lost refresh response blocks repeated refresh and retains provider revocation uncertainty", async () => {
    const f = await composedLink(60);
    f.loseRefresh();
    let used = false;
    const operation = () => {
      used = true;
      return Promise.resolve();
    };
    await expect(
      f.service.withAccess(
        f.principal,
        f.organizationId,
        f.connection.binding.connectionId,
        operation,
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      f.service.withAccess(
        f.principal,
        f.organizationId,
        f.connection.binding.connectionId,
        operation,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(used).toBe(false);
    expect(
      f.calls.filter((call) => call.grantType === "refresh_token"),
    ).toHaveLength(1);
    expect(
      await f.service.disconnect(
        f.principal,
        f.organizationId,
        f.connection.binding.connectionId,
      ),
    ).toMatchObject({
      status: "disconnected",
      providerRevocationUncertain: true,
    });
    expect(
      f.calls.filter((call) => call.path === "/oauth/revoke"),
    ).toHaveLength(0);
  });
  it("composed disconnect revokes both known tokens before clearing the sealed grant", async () => {
    const f = await composedLink();
    expect(
      await f.service.disconnect(
        f.principal,
        f.organizationId,
        f.connection.binding.connectionId,
      ),
    ).toMatchObject({ status: "revoked", sealedGrant: null });
    expect(
      f.calls.filter((call) => call.path === "/oauth/revoke"),
    ).toHaveLength(2);
    await expect(
      f.service.withAccess(
        f.principal,
        f.organizationId,
        f.connection.binding.connectionId,
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await f.service.disconnect(
        f.principal,
        f.organizationId,
        f.connection.binding.connectionId,
      ),
    ).toMatchObject({ status: "revoked" });
    expect(
      f.calls.filter((call) => call.path === "/oauth/revoke"),
    ).toHaveLength(2);
  });
  function selected(
    f: Awaited<ReturnType<typeof linked>>,
    principal = f.principal,
    org = f.organizationId,
    app = applicationId,
    db: SqlDatabase = database,
  ) {
    return new PostgresGitLabProjectSelections(
      new GitLabConnectionAuthority(db, principal, org),
      app,
    );
  }
  const enable = {
    contractVersion: 1 as const,
    expectedVersion: 0,
    enabled: true,
  };
  it("persists only numeric project authority and invalidates an old approval when deselected and reselected", async () => {
    const f = await linked(),
      store = selected(f),
      connectionId = f.binding.connectionId;
    await expect(
      store.assertSelected(connectionId, 42, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await store.update(connectionId, 42, enable, 1)).toMatchObject({
      projectId: 42,
      version: 1,
      enabled: true,
    });
    await store.assertSelected(connectionId, 42, 1);
    await store.update(connectionId, 42, {
      ...enable,
      expectedVersion: 1,
      enabled: false,
    });
    await expect(
      store.assertSelected(connectionId, 42, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    await store.update(connectionId, 42, { ...enable, expectedVersion: 2 }, 1);
    await expect(
      store.assertSelected(connectionId, 42, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    await store.assertSelected(connectionId, 42, 3);
    await expect(
      store.update(connectionId, 42, enable, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await store.list(connectionId)).items).toMatchObject([
      { projectId: 42, version: 3, enabled: true },
    ]);
    const audits = await database.query(
      sql(
        "SELECT action,safe_summary FROM audit_events WHERE target_id=$1 AND action='gitlab.project.selection'",
        [connectionId],
      ),
    );
    expect(audits.rows).toHaveLength(3);
  });
  it("allows exactly one concurrent selection version and pages retained selection history", async () => {
    const f = await linked(),
      store = selected(f),
      connectionId = f.binding.connectionId;
    const results = await Promise.allSettled([
      store.update(connectionId, 42, enable, 1),
      store.update(connectionId, 42, enable, 1),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await store.update(connectionId, 43, enable, 1);
    const first = await store.list(connectionId, 1);
    expect(first.items.map((item) => item.projectId)).toEqual([42]);
    expect(first.nextCursor).toBe("42");
    expect(
      (await store.list(connectionId, 1, first.nextCursor)).items.map(
        (item) => item.projectId,
      ),
    ).toEqual([43]);
  });
  it.each(["actor", "workspace", "application"] as const)(
    "denies %s substitution for selection metadata and writes",
    async (kind) => {
      const f = await linked(),
        other = await fixture();
      const store = selected(
        f,
        kind === "actor" ? other.principal : f.principal,
        kind === "workspace" ? other.organizationId : f.organizationId,
        kind === "application" ? "b".repeat(64) : applicationId,
      );
      await expect(store.list(f.binding.connectionId)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(
        store.update(f.binding.connectionId, 42, enable, 1),
      ).rejects.toMatchObject({ code: "not_found" });
    },
  );
  it("checks grant version, refresh and disconnect before admitting selection", async () => {
    const f = await linked(),
      store = selected(f),
      connectionId = f.binding.connectionId;
    await expect(
      store.update(connectionId, 42, enable, 2),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(() => store.update(connectionId, 42, enable)).toThrow(
      "The GitLab project selection is invalid.",
    );
    await expect(
      store.update(connectionId, 43, { ...enable, enabled: false }),
    ).rejects.toMatchObject({ code: "conflict" });
    await store.update(connectionId, 42, enable, 1);
    await f.grants.claimRefresh(connectionId, 1);
    await expect(
      store.update(connectionId, 43, enable, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.assertSelected(connectionId, 42, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.grants.disconnect(connectionId);
    await store.update(connectionId, 42, {
      ...enable,
      expectedVersion: 1,
      enabled: false,
    });
    await expect(
      store.update(connectionId, 42, { ...enable, expectedVersion: 2 }, 1),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it.each(["viewer", "stale-auth", "revoked-session"] as const)(
    "denies selection after %s",
    async (kind) => {
      const f = await linked();
      let actor = f.principal;
      if (kind === "viewer")
        await database.query(
          sql(
            "UPDATE memberships SET role_key='viewer' WHERE principal_id=$1 AND organization_id=$2",
            [actor.principalId, f.organizationId],
          ),
        );
      if (kind === "stale-auth")
        actor = {
          ...actor,
          authenticatedAt: new Date(Date.now() - 660000).toISOString(),
        };
      if (kind === "revoked-session")
        await database.query(
          sql(
            "INSERT INTO account_revoked_session_families(principal_id,provider_session_sha256) VALUES($1,$2)",
            [actor.principalId, hash(actor.sessionId)],
          ),
        );
      await expect(
        selected(f, actor).update(f.binding.connectionId, 42, enable, 1),
      ).rejects.toMatchObject({
        code:
          kind === "revoked-session"
            ? "authentication_required"
            : "access_denied",
      });
    },
  );
  it("rolls selection back when atomic audit fails", async () => {
    const f = await linked();
    const broken: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (query) => database.query(query),
      transaction: (work) =>
        database.transaction((tx) =>
          work({
            query: async (query) => {
              if (query.text.includes("INSERT INTO audit_events"))
                throw Error("Synthetic audit failure");
              return tx.query(query);
            },
          }),
        ),
    };
    await expect(
      selected(f, f.principal, f.organizationId, applicationId, broken).update(
        f.binding.connectionId,
        42,
        enable,
        1,
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect((await selected(f).list(f.binding.connectionId)).items).toHaveLength(
      0,
    );
  });
  it("rejects deletion, authority rebinding and version rollback in SQL", async () => {
    const f = await linked(),
      store = selected(f),
      connectionId = f.binding.connectionId;
    await store.update(connectionId, 42, enable, 1);
    for (const query of [
      "DELETE FROM gitlab_project_selections WHERE connection_id=$1",
      "UPDATE gitlab_project_selections SET provider_project_id=43,selection_version=2 WHERE connection_id=$1",
      "UPDATE gitlab_project_selections SET enabled=false WHERE connection_id=$1",
    ])
      await expect(
        database.query(sql(query, [connectionId])),
      ).rejects.toThrow();
    await store.assertSelected(connectionId, 42, 1);
  });
  it("limits active selections while allowing removal and retains history", async () => {
    const f = await linked(),
      store = selected(f),
      connectionId = f.binding.connectionId;
    await database.query(
      sql(
        "INSERT INTO gitlab_project_selections(connection_id,provider_project_id,selection_version,enabled) SELECT $1,i,1,true FROM generate_series(1,100) AS i",
        [connectionId],
      ),
    );
    await expect(
      store.update(connectionId, 101, enable, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    await store.update(connectionId, 1, {
      ...enable,
      expectedVersion: 1,
      enabled: false,
    });
    await store.update(connectionId, 101, enable, 1);
    expect((await store.list(connectionId, 100)).nextCursor).toBe("100");
  });
  it.each([
    "eligible",
    "archived",
    "empty",
    "insufficient-access",
    "wrong-id",
    "disconnected",
  ] as const)(
    "rechecks provider project state %s with real encrypted grants",
    async (kind) => {
      const f = await composedLink(),
        connectionId = f.connection.binding.connectionId;
      const calls: string[] = [];
      const fetch: typeof globalThis.fetch = async (url, init) => {
        const target = new URL(httpText(url));
        calls.push((init?.method ?? "GET") + " " + target.pathname);
        if (kind === "disconnected")
          await new PostgresGitLabGrants(
            new GitLabConnectionAuthority(
              database,
              f.principal,
              f.organizationId,
            ),
            applicationId,
          ).disconnect(connectionId);
        return Response.json({
          id: kind === "wrong-id" ? 43 : 42,
          path_with_namespace: "group/project",
          default_branch: kind === "empty" ? null : "main",
          archived: kind === "archived",
          empty_repo: kind === "empty",
          permissions: {
            project_access: {
              access_level: kind === "insufficient-access" ? 20 : 30,
            },
            group_access: null,
          },
        });
      };
      const app = createProductionGitLabProjects({
        database,
        applicationId,
        connections: f.service,
        fetch,
      });
      if (kind === "eligible")
        expect(
          await app.update(
            f.principal,
            f.organizationId,
            connectionId,
            42,
            enable,
          ),
        ).toMatchObject({ projectId: 42, version: 1, enabled: true });
      else
        await expect(
          app.update(f.principal, f.organizationId, connectionId, 42, enable),
        ).rejects.toBeDefined();
      expect(calls).toEqual(["GET /api/v4/projects/42"]);
      expect(
        (await app.selections(f.principal, f.organizationId, connectionId, 50))
          .items,
      ).toHaveLength(kind === "eligible" ? 1 : 0);
      expect(f.issued.every((value) => value.every((byte) => byte === 0))).toBe(
        true,
      );
    },
  );
  async function exportReviewFixture() {
    const f = await linked(),
      projectId = id("project"),
      reviewId = id("gitlabreview");
    await database.query(
      sql(
        "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic GitLab export project',$3)",
        [projectId, f.organizationId, f.principal.principalId],
      ),
    );
    await selected(f).update(f.binding.connectionId, 42, enable, 1);
    const descriptor = {
      schemaVersion: 1 as const,
      reviewId,
      organizationId: f.organizationId,
      projectId,
      principalId: f.principal.principalId,
      applicationId,
      connectionId: f.binding.connectionId,
      providerProjectId: 42,
      selectionVersion: 1,
      artifactId: id("solutionexportartifact"),
      artifactManifestDigest: "sha256:" + "a".repeat(64),
      artifactZipDigest: "sha256:" + "b".repeat(64),
      artifactReviewDigest: "sha256:" + "c".repeat(64),
      baseCommitSha: "d".repeat(40),
      baseBranch: "main",
      branch: "cloudmarkup/export-" + reviewId.slice("gitlabreview_".length),
      destinationFolder: "exports/reviewed",
      expectedTreeSha: "e".repeat(40),
      fileCount: 20,
    };
    const makeReviews = (
      actor = f.principal,
      org = f.organizationId,
      project = projectId,
      app = applicationId,
      db: SqlDatabase = database,
    ) =>
      new PostgresGitLabExportReviews(
        new GitLabConnectionAuthority(db, actor, org),
        app,
        project,
      );
    const reviews = makeReviews(),
      record = await reviews.create(descriptor);
    return { ...f, projectId, descriptor, reviews, record, makeReviews };
  }
  it("records one approved export through bounded verification and a recovered closed merge request", async () => {
    const f = await exportReviewFixture(),
      r = f.reviews,
      id = f.descriptor.reviewId,
      digest = f.record.approvalDigest,
      sha = "f".repeat(40);
    expect(f.record).toMatchObject({
      state: "prepared",
      recordVersion: 1,
      verifiedFiles: 0,
      commitSha: null,
      mergeRequest: null,
    });
    await r.claimCommit(id, 1, digest, true);
    await r.beginVerification(id, 2, digest, sha);
    await expect(
      r.recordVerifiedFiles(id, 3, digest, 20),
    ).rejects.toMatchObject({ code: "conflict" });
    await r.recordVerifiedFiles(id, 3, digest, 16);
    await r.recordVerifiedFiles(id, 4, digest, 20);
    await r.claimMergeRequest(id, 5, digest);
    const receipt = {
      number: 7,
      sha,
      state: "closed" as const,
      draft: true,
      url: "https://gitlab.com/group/project/-/merge_requests/7",
    };
    expect(await r.complete(id, 6, digest, receipt)).toMatchObject({
      state: "succeeded",
      recordVersion: 7,
      verifiedFiles: 20,
      mergeRequest: receipt,
    });
    await expect(r.claimCommit(id, 7, digest, true)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(r.complete(id, 7, digest, receipt)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (
        await database.query(
          sql(
            "SELECT action FROM audit_events WHERE target_id=$1 ORDER BY occurred_at",
            [id],
          ),
        )
      ).rows.map((row) => row["action"]),
    ).toEqual([
      "gitlab.export.review",
      "gitlab.export.commit-dispatched",
      "gitlab.export.verifying",
      "gitlab.export.verifying",
      "gitlab.export.verified",
      "gitlab.export.merge-request-dispatched",
      "gitlab.export.succeeded",
    ]);
  });
  it("claims each commit and merge-request write only once under concurrent approvals", async () => {
    const f = await exportReviewFixture(),
      r = f.reviews,
      id = f.descriptor.reviewId,
      digest = f.record.approvalDigest;
    const claims = await Promise.allSettled([
      r.claimCommit(id, 1, digest, true),
      r.claimCommit(id, 1, digest, true),
    ]);
    expect(claims.filter((value) => value.status === "fulfilled")).toHaveLength(
      1,
    );
    await expect(r.claimCommit(id, 2, digest, true)).rejects.toMatchObject({
      code: "conflict",
    });
    await r.beginVerification(id, 2, digest, "f".repeat(40));
    await r.recordVerifiedFiles(id, 3, digest, 16);
    await r.recordVerifiedFiles(id, 4, digest, 20);
    const requests = await Promise.allSettled([
      r.claimMergeRequest(id, 5, digest),
      r.claimMergeRequest(id, 5, digest),
    ]);
    expect(
      requests.filter((value) => value.status === "fulfilled"),
    ).toHaveLength(1);
    await expect(r.claimMergeRequest(id, 6, digest)).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("never resets an unknown dispatch and rejects approval, version or selection substitution", async () => {
    const f = await exportReviewFixture(),
      r = f.reviews,
      id = f.descriptor.reviewId,
      digest = f.record.approvalDigest;
    await expect(
      r.claimCommit(id, 1, "sha256:" + "0".repeat(64), true),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(r.claimCommit(id, 2, digest, true)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(() => r.claimCommit(id, 1, digest, false)).toThrow("invalid");
    await r.claimCommit(id, 1, digest, true);
    expect(await r.get(id)).toMatchObject({
      state: "commit-dispatched",
      commitSha: null,
    });
    await selected(f).update(f.binding.connectionId, 42, {
      ...enable,
      expectedVersion: 1,
      enabled: false,
    });
    await selected(f).update(
      f.binding.connectionId,
      42,
      { ...enable, expectedVersion: 2 },
      1,
    );
    await expect(
      r.beginVerification(id, 2, digest, "f".repeat(40)),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("denies another administrator in the same workspace from reading or advancing a review", async () => {
    const f = await exportReviewFixture(),
      other = await fixture();
    await database.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'administrator')",
        [id("membership"), f.organizationId, other.principal.principalId],
      ),
    );
    const store = f.makeReviews(other.principal);
    await expect(store.get(f.descriptor.reviewId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      store.claimCommit(
        f.descriptor.reviewId,
        1,
        f.record.approvalDigest,
        true,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it.each(["workspace", "project", "application"] as const)(
    "denies export review %s substitution",
    async (kind) => {
      const f = await exportReviewFixture(),
        other = await exportReviewFixture();
      const store = f.makeReviews(
        f.principal,
        kind === "workspace" ? other.organizationId : f.organizationId,
        kind === "project" ? other.projectId : f.projectId,
        kind === "application" ? "b".repeat(64) : applicationId,
      );
      await expect(store.get(f.descriptor.reviewId)).rejects.toMatchObject({
        code: "not_found",
      });
    },
  );
  it.each(["viewer", "archived", "revoked-session"] as const)(
    "rechecks %s before dispatch",
    async (kind) => {
      const f = await exportReviewFixture();
      if (kind === "viewer")
        await database.query(
          sql(
            "UPDATE memberships SET role_key='viewer' WHERE organization_id=$1 AND principal_id=$2",
            [f.organizationId, f.principal.principalId],
          ),
        );
      if (kind === "archived")
        await database.query(
          sql(
            "UPDATE projects SET lifecycle_status='archived',record_version=record_version+1 WHERE project_id=$1",
            [f.projectId],
          ),
        );
      if (kind === "revoked-session")
        await database.query(
          sql(
            "INSERT INTO account_revoked_session_families(principal_id,provider_session_sha256) VALUES($1,$2)",
            [f.principal.principalId, hash(f.principal.sessionId)],
          ),
        );
      await expect(
        f.reviews.claimCommit(
          f.descriptor.reviewId,
          1,
          f.record.approvalDigest,
          true,
        ),
      ).rejects.toMatchObject({
        code:
          kind === "viewer"
            ? "access_denied"
            : kind === "archived"
              ? "not_found"
              : "authentication_required",
      });
    },
  );
  it("keeps expired reviews readable but refuses new provider writes", async () => {
    const f = await exportReviewFixture(),
      reviewId = id("gitlabreview");
    const descriptor = {
      ...f.descriptor,
      reviewId,
      branch: "cloudmarkup/export-" + reviewId.slice("gitlabreview_".length),
    };
    const digest = gitLabExportApprovalDigest(descriptor);
    await database.query(
      sql(
        "INSERT INTO gitlab_export_reviews(review_id,organization_id,project_id,principal_id,application_id,connection_id,provider_project_id,branch_name,descriptor,approval_digest,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,42,$7,$8::jsonb,$9,statement_timestamp()-INTERVAL '16 minutes',statement_timestamp()-INTERVAL '16 minutes',statement_timestamp()-INTERVAL '1 minute')",
        [
          reviewId,
          f.organizationId,
          f.projectId,
          f.principal.principalId,
          applicationId,
          f.binding.connectionId,
          descriptor.branch,
          JSON.stringify(descriptor),
          digest,
        ],
      ),
    );
    expect(await f.reviews.get(reviewId)).toMatchObject({
      expired: true,
      state: "prepared",
    });
    await expect(
      f.reviews.claimCommit(reviewId, 1, digest, true),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("rolls back a provider dispatch claim when its audit cannot be recorded", async () => {
    const f = await exportReviewFixture();
    const broken: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (query) => database.query(query),
      transaction: (work) =>
        database.transaction((tx) =>
          work({
            query: async (query) => {
              if (query.text.includes("INSERT INTO audit_events"))
                throw Error("Synthetic export audit failure");
              return tx.query(query);
            },
          }),
        ),
    };
    await expect(
      f
        .makeReviews(
          f.principal,
          f.organizationId,
          f.projectId,
          applicationId,
          broken,
        )
        .claimCommit(f.descriptor.reviewId, 1, f.record.approvalDigest, true),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(await f.reviews.get(f.descriptor.reviewId)).toMatchObject({
      state: "prepared",
      recordVersion: 1,
    });
  });
  it("SQL rejects descriptor mutation, stage rollback and deleting unresolved receipts", async () => {
    const f = await exportReviewFixture(),
      id = f.descriptor.reviewId;
    await f.reviews.claimCommit(id, 1, f.record.approvalDigest, true);
    for (const query of [
      "DELETE FROM gitlab_export_reviews WHERE review_id=$1",
      "UPDATE gitlab_export_reviews SET lifecycle_status='prepared',record_version=record_version+1 WHERE review_id=$1",
      'UPDATE gitlab_export_reviews SET descriptor=descriptor||\'{"destinationFolder":"other"}\'::jsonb,record_version=record_version+1 WHERE review_id=$1',
    ])
      await expect(database.query(sql(query, [id]))).rejects.toThrow();
    expect(await f.reviews.get(id)).toMatchObject({
      state: "commit-dispatched",
      recordVersion: 2,
    });
  });
});
