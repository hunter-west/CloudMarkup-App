import { PostgresAccountWorkspaces } from "./account-workspaces.js";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BETA_SHARING_PLAN_IDS } from "@cloudmarkup/domain";
import type { OrganizationRole } from "../../application/authorization.js";
import type { TrustedCommercialAdministrationContext } from "../../application/commercial-persistence.js";
import type { PrincipalContext } from "../../application/ports.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { PostgresOrganizationInvitationRepository } from "./organization-invitations.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import {
  sql,
  type SqlRow,
  type SqlStatement,
  type SqlDatabase,
} from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const suite = configured ? describe : describe.skip;
const id = (prefix: string) => prefix + "_" + randomUUID();
const schema = "cm_recipient_test_" + randomUUID().replaceAll("-", "");
const marker = "CloudMarkup synthetic recipient invitations";
suite("recipient-bound invitations on isolated real PostgreSQL", () => {
  let admin: PostgresDatabase | undefined,
    database: PostgresDatabase,
    app: PostgresOrganizationInvitationRepository;
  let opened: PostgresDatabase | undefined;
  let legacyId: string, legacyBefore: unknown;
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
        `COMMENT ON SCHEMA "${schema}" IS 'CloudMarkup synthetic recipient invitations'`,
      ),
    );
    database = new PostgresDatabase({
      connectionString: configured,
      max: 8,
      options: `-c search_path=${schema} -c timezone=UTC -c statement_timeout=5000`,
    });
    opened = database;
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(
      database,
      migrations.filter((m) => m.version < "0086"),
    );
    app = new PostgresOrganizationInvitationRepository(database);
    const f = await fixture();
    // Seed the historical shape before0086 without invoking today's repository,
    // whose sharing-plan query requires0098. The successor chain stays unapplied.
    expect(
      (
        await database.query(
          sql(
            "SELECT to_regprocedure('cloudmarkup_staff_trial_current_v1(character varying,character varying)') AS trial_function",
          ),
        )
      ).rows[0]?.["trial_function"],
    ).toBeNull();
    legacyId = "invitation_" + randomUUID();
    const legacyCreatedAt = new Date();
    const legacyDigest = (kind: string) =>
      createHash("sha256")
        .update(`Synthetic historical recipient fixture:${kind}:${legacyId}`)
        .digest("hex");
    await database.query(
      sql(
        `INSERT INTO organization_invitations(
          invitation_id,organization_id,issuer_principal_id,issuer_membership_id,
          target_role,token_sha256,request_sha256,idempotency_key_sha256,created_at,expires_at
        ) VALUES($1,$2,$3,$4,'editor',$5,$6,$7,$8,$9)`,
        [
          legacyId,
          f.organizationId,
          f.owner.principalId,
          f.ownerMembershipId,
          legacyDigest("token"),
          legacyDigest("request"),
          legacyDigest("idempotency"),
          legacyCreatedAt.toISOString(),
          new Date(legacyCreatedAt.getTime() + 3600000).toISOString(),
        ],
      ),
    );
    legacyBefore = (
      await database.query(
        sql(
          "SELECT to_jsonb(i) AS value FROM organization_invitations i WHERE invitation_id=$1",
          [legacyId],
        ),
      )
    ).rows[0]?.["value"];
    await runMigrations(database, migrations);
    await runMigrations(database, migrations);
  }, 30000);
  afterAll(async () => {
    await opened?.close();
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
          !/^cm_recipient_test_[a-f0-9]{32}$/u.test(schema)
        )
          throw Error("Refusing unverified cleanup");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      } finally {
        await admin.close();
      }
    }
  }, 30000);

  async function principal(): Promise<PrincipalContext> {
    const principalId = id("principal");
    await database.query(
      sql(
        "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic invitation member')",
        [principalId],
      ),
    );
    return {
      principalId,
      sessionId: id("session"),
      correlationId: id("correlation"),
      authenticationSource: "test",
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
  }
  async function addMember(
    organizationId: string,
    actor: PrincipalContext,
    role: OrganizationRole = "editor",
    state = "active",
  ) {
    const membershipId = id("membership");
    await database.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key,lifecycle_status) VALUES($1,$2,$3,$4,$5)",
        [membershipId, organizationId, actor.principalId, role, state],
      ),
    );
    return membershipId;
  }
  async function fixture(plan: string | null = BETA_SHARING_PLAN_IDS.starter) {
    const owner = await principal();
    const organizationId = id("org");
    await database.query(
      sql(
        "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic sharing workspace',$2)",
        [organizationId, `sharing-${randomUUID()}`],
      ),
    );
    for (const role of ["owner", "administrator", "editor", "viewer"] as const)
      await database.query(
        sql(
          "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,$2::text,'authorization-v2',$3,cloudmarkup_authorization_v2_permissions($2::text))",
          [organizationId, role, role === "owner"],
        ),
      );
    const ownerMembershipId = await addMember(organizationId, owner, "owner");
    const commercial = new PostgresCommercialPersistenceRepository(database);
    const context: TrustedCommercialAdministrationContext = {
      authority: "internal-administration",
      actorId: id("synthetic_admin"),
      actorPrincipalId: owner.principalId,
      correlationId: owner.correlationId,
      organizationId,
    };
    if (plan !== null) {
      const account = await commercial.createBillingAccount(context, {
        billingAccountId: id("billing"),
      });
      const now = new Date().toISOString();
      const projection = await commercial.updateSubscriptionProjection(
        context,
        {
          subscriptionProjectionId: id("subscriptionprojection"),
          planVersionId: plan,
          billingProvider: "synthetic-local-provider",
          providerCustomerReference: id("customer"),
          providerSubscriptionReference: id("subscription"),
          billableSeatQuantity: "1",
          cancelAtPeriodEnd: false,
          expectedRecordVersion: "0",
          normalizedStatus: "active",
          effectiveAt: now,
          currentPeriodId: id("period"),
          currentPeriodStart: now,
          currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        },
      );
      await commercial.updateEntitlementSnapshot(context, {
        entitlementSnapshotId: id("entitlement"),
        entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
        planVersionId: plan,
        subscriptionProjectionId: projection.subscriptionProjectionId,
        sourceRecordVersion: projection.recordVersion,
        expensiveOperationsEnabled: account.expensiveOperationsEnabled,
        expectedRecordVersion: "0",
        effectiveAt: now,
      });
    }
    return { owner, ownerMembershipId, organizationId, commercial, context };
  }

  const targeted = (person: PrincipalContext) => ({
    contractVersion: 1,
    role: "editor",
    recipient: { kind: "user-id", userId: person.principalId },
  });
  const token = async (invitationId: string) =>
    String(
      (
        await database.query(
          sql(
            "SELECT token_sha256 FROM organization_invitations WHERE invitation_id=$1",
            [invitationId],
          ),
        )
      ).rows[0]?.["token_sha256"],
    );
  const memberCount = async (organizationId: string) =>
    Number(
      (
        await database.query(
          sql(
            "SELECT count(*) AS count FROM memberships WHERE organization_id=$1",
            [organizationId],
          ),
        )
      ).rows[0]?.["count"],
    );
  it("preserves old invitation bytes and applies the registered chain twice", async () => {
    const row = (
      await database.query(
        sql(
          "SELECT to_jsonb(i)-ARRAY['recipient_principal_id','declined_by_recipient'] AS original,recipient_principal_id,declined_by_recipient FROM organization_invitations i WHERE invitation_id=$1",
          [legacyId],
        ),
      )
    ).rows[0];
    expect(row?.["original"]).toEqual(legacyBefore);
    expect(row?.["recipient_principal_id"]).toBeNull();
    expect(row?.["declined_by_recipient"]).toBe(false);
  });
  it("binds exact user ID, hides other inboxes and requires the recipient on both acceptance paths", async () => {
    const f = await fixture(),
      target = await principal(),
      foreign = await principal();
    const invite = await app.createForRecipient(
      f.owner,
      f.organizationId,
      targeted(target),
      id("request"),
    );
    expect(invite.recipient.principalId).toBe(target.principalId);
    expect(await memberCount(f.organizationId)).toBe(1);
    expect((await app.listForRecipient(foreign, { limit: 20 })).items).toEqual(
      [],
    );
    expect(
      (await app.listForRecipient(target, { limit: 20 })).items.map(
        (i) => i.id,
      ),
    ).toContain(invite.id);
    await expect(
      app.acceptForRecipient(foreign, invite.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      app.accept(foreign, invite.id, await token(invite.id)),
    ).rejects.toMatchObject({ code: "not_found" });
    const joined = await app.acceptForRecipient(target, invite.id);
    expect(joined.organizationId).toBe(f.organizationId);
    expect(await app.acceptForRecipient(target, invite.id)).toEqual(joined);
    expect(await memberCount(f.organizationId)).toBe(2);
  });
  it("keeps the original recipient after username rename, reuse and an idempotent retry", async () => {
    const f = await fixture(),
      target = await principal(),
      other = await principal(),
      username = "target_" + randomUUID().slice(0, 8),
      key = id("retry");
    await database.query(
      sql(
        "UPDATE principals SET public_username=$2,profile_record_version=2 WHERE principal_id=$1",
        [target.principalId, username],
      ),
    );
    const request = {
      contractVersion: 1,
      role: "editor",
      recipient: { kind: "username", username: username.toUpperCase() },
    };
    const first = await app.createForRecipient(
      f.owner,
      f.organizationId,
      request,
      key,
    );
    await database.query(
      sql(
        "UPDATE principals SET public_username=NULL,profile_record_version=3 WHERE principal_id=$1",
        [target.principalId],
      ),
    );
    await database.query(
      sql(
        "UPDATE principals SET public_username=$2,profile_record_version=2 WHERE principal_id=$1",
        [other.principalId, username],
      ),
    );
    const retry = await app.createForRecipient(
      f.owner,
      f.organizationId,
      request,
      key,
    );
    expect(retry.id).toBe(first.id);
    expect(retry.recipient.principalId).toBe(target.principalId);
    expect(retry.recipient.username).toBeNull();
    await expect(app.acceptForRecipient(other, first.id)).rejects.toMatchObject(
      { code: "not_found" },
    );
    expect((await app.acceptForRecipient(target, first.id)).status).toBe(
      "accepted",
    );
  });
  it("rejects changed retries and concurrent duplicate pending invites", async () => {
    const f = await fixture(),
      target = await principal(),
      other = await principal(),
      key = id("request");
    const same = await Promise.all([
      app.createForRecipient(f.owner, f.organizationId, targeted(target), key),
      app.createForRecipient(f.owner, f.organizationId, targeted(target), key),
    ]);
    expect(same[0].id).toBe(same[1].id);
    await expect(
      app.createForRecipient(f.owner, f.organizationId, targeted(other), key),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(
      app.createForRecipient(
        f.owner,
        f.organizationId,
        targeted(target),
        id("new"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const concurrent = await Promise.allSettled([
      app.createForRecipient(
        f.owner,
        f.organizationId,
        targeted(other),
        id("one"),
      ),
      app.createForRecipient(
        f.owner,
        f.organizationId,
        targeted(other),
        id("two"),
      ),
    ]);
    expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((r) => r.status === "rejected")).toMatchObject([
      { reason: { code: "conflict" } },
    ]);
  });
  it("declines without joining, retains history and permits a fresh invitation", async () => {
    const f = await fixture(),
      target = await principal(),
      other = await principal();
    const invitation = await app.createForRecipient(
      f.owner,
      f.organizationId,
      targeted(target),
      id("create"),
    );
    await expect(
      app.declineForRecipient(other, invitation.id),
    ).rejects.toMatchObject({ code: "not_found" });
    const declined = await app.declineForRecipient(target, invitation.id);
    expect(declined.status).toBe("declined");
    expect(await app.declineForRecipient(target, invitation.id)).toEqual(
      declined,
    );
    expect(await memberCount(f.organizationId)).toBe(1);
    await expect(
      app.acceptForRecipient(target, invitation.id),
    ).rejects.toMatchObject({ code: "not_found" });
    const next = await app.createForRecipient(
      f.owner,
      f.organizationId,
      targeted(target),
      id("again"),
    );
    expect(next.id).not.toBe(invitation.id);
    expect(
      (await app.listForOrganization(f.owner, f.organizationId, { limit: 20 }))
        .items,
    ).toHaveLength(2);
  });
  it("rejects caller-selected privilege and unauthorized organization reads or writes", async () => {
    const f = await fixture(),
      target = await principal(),
      foreign = await principal();
    await expect(
      app.createForRecipient(
        foreign,
        f.organizationId,
        targeted(target),
        id("foreign"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      app.listForOrganization(foreign, f.organizationId, { limit: 20 }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      app.createForRecipient(
        f.owner,
        f.organizationId,
        { ...targeted(target), role: "owner" },
        id("owner"),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      app.createForRecipient(
        f.owner,
        f.organizationId,
        targeted(f.owner),
        id("self"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await addMember(f.organizationId, foreign, "viewer");
    await expect(
      app.createForRecipient(
        foreign,
        f.organizationId,
        targeted(target),
        id("viewer"),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
  it("checks sharing eligibility before resolving either an existing or missing recipient", async () => {
    const f = await fixture(null),
      target = await principal();
    await f.commercial.createBillingAccount(f.context, {
      billingAccountId: id("billing"),
    });
    for (const userId of [target.principalId, id("principal")]) {
      await expect(
        app.createForRecipient(
          f.owner,
          f.organizationId,
          {
            contractVersion: 1,
            role: "editor",
            recipient: { kind: "user-id", userId },
          },
          id("request"),
        ),
      ).rejects.toMatchObject({
        code: "access_denied",
        message: "An active sharing plan is required to add members.",
      });
    }
    expect(
      (await app.listForOrganization(f.owner, f.organizationId, { limit: 20 }))
        .items,
    ).toEqual([]);
  });
  it("uses generic resolution errors and denies expired or suspended actors", async () => {
    const f = await fixture(),
      target = await principal();
    const missing = {
      ...targeted(target),
      recipient: {
        kind: "username",
        username: "missing_" + randomUUID().slice(0, 8),
      },
    };
    await expect(
      app.createForRecipient(f.owner, f.organizationId, missing, id("missing")),
    ).rejects.toMatchObject({
      code: "not_found",
      message: "The invitation is unavailable.",
    });
    await expect(
      app.listForRecipient(
        { ...target, expiresAt: new Date(0).toISOString() },
        { limit: 20 },
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await database.query(
      sql(
        "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
        [target.principalId],
      ),
    );
    await expect(
      app.createForRecipient(
        f.owner,
        f.organizationId,
        targeted(target),
        id("suspended"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("enforces binding immutability and forbids raw wrong-recipient acceptance in SQL", async () => {
    const f = await fixture(),
      target = await principal(),
      other = await principal();
    const invitation = await app.createForRecipient(
      f.owner,
      f.organizationId,
      targeted(target),
      id("sql"),
    );
    await expect(
      database.query(
        sql(
          "UPDATE organization_invitations SET recipient_principal_id=$2 WHERE invitation_id=$1",
          [invitation.id, other.principalId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql(
          "UPDATE organization_invitations SET recipient_principal_id=NULL WHERE invitation_id=$1",
          [invitation.id],
        ),
      ),
    ).rejects.toThrow();
    const member = await addMember(f.organizationId, other);
    await expect(
      database.query(
        sql(
          "UPDATE organization_invitations SET lifecycle_state='accepted',accepted_principal_id=$2,accepted_membership_id=$3,accepted_at=clock_timestamp(),accepted_auth_expires_at=clock_timestamp()+INTERVAL '5 minutes' WHERE invitation_id=$1",
          [invitation.id, other.principalId, member],
        ),
      ),
    ).rejects.toThrow();
    expect(
      (await app.listForRecipient(target, { limit: 20 })).items[0]?.status,
    ).toBe("pending");
  });
  it("paginates inboxes without accepting another account's cursor as authority", async () => {
    const a = await fixture(),
      b = await fixture(),
      target = await principal(),
      foreign = await principal();
    await app.createForRecipient(
      a.owner,
      a.organizationId,
      targeted(target),
      id("one"),
    );
    await app.createForRecipient(
      b.owner,
      b.organizationId,
      targeted(target),
      id("two"),
    );
    const first = await app.listForRecipient(target, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeDefined();
    const cursor = first.nextCursor;
    if (cursor === undefined)
      throw Error("Missing invitation continuation cursor");
    const last = await app.listForRecipient(target, {
      limit: 1,
      cursor: cursor,
    });
    expect(last.items).toHaveLength(1);
    expect(last.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(last.nextCursor).toBeUndefined();
    expect(
      (
        await app.listForRecipient(foreign, {
          limit: 1,
          cursor: cursor,
        })
      ).items,
    ).toEqual([]);
    await expect(
      app.listForRecipient(target, { limit: 1, cursor: "foreign-cursor" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("rolls back a targeted invitation when its audit fails", async () => {
    const f = await fixture(),
      target = await principal();
    const failing: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (statement) => database.query(statement),
      transaction: (run) =>
        database.transaction((tx) =>
          run({
            query: <TRow extends SqlRow = SqlRow>(statement: SqlStatement) => {
              if (statement.text.startsWith("INSERT INTO audit_events"))
                throw Error("Synthetic invitation audit failure");
              return tx.query<TRow>(statement);
            },
          }),
        ),
    };
    await expect(
      new PostgresOrganizationInvitationRepository(failing).createForRecipient(
        f.owner,
        f.organizationId,
        targeted(target),
        id("audit"),
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect((await app.listForRecipient(target, { limit: 20 })).items).toEqual(
      [],
    );
    expect(await memberCount(f.organizationId)).toBe(1);
  });
  it("denies sharing personal workspaces and rechecks the issuer at acceptance", async () => {
    const f = await fixture(),
      target = await principal();
    const personal = await new PostgresAccountWorkspaces(
      database,
    ).createPersonal(f.owner);
    await expect(
      app.createForRecipient(
        f.owner,
        personal.id,
        targeted(target),
        id("private"),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    const invitation = await app.createForRecipient(
      f.owner,
      f.organizationId,
      targeted(target),
      id("issuer"),
    );
    await database.query(
      sql(
        "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
        [f.owner.principalId],
      ),
    );
    await expect(
      app.acceptForRecipient(target, invitation.id),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await memberCount(f.organizationId)).toBe(1);
    expect(
      (await app.listForRecipient(target, { limit: 20 })).items[0]?.status,
    ).toBe("pending");
  });
  it("bounds the live pending queue while permitting replacement after expiry", async () => {
    async function fill(
      f: Awaited<ReturnType<typeof fixture>>,
      expired: boolean,
    ) {
      await database.query(
        sql(
          `INSERT INTO organization_invitations(invitation_id,organization_id,issuer_principal_id,issuer_membership_id,target_role,token_sha256,request_sha256,idempotency_key_sha256,created_at,expires_at)
        SELECT 'invitation_'||gen_random_uuid()::text,$1::text,$2::text,$3::text,'editor',md5($1::text||n::text)||md5(n::text||$1::text),repeat('a',64),md5(n::text||$2::text)||md5($2::text||n::text),CURRENT_TIMESTAMP-(CASE WHEN $4::boolean THEN INTERVAL '48 hours' ELSE INTERVAL '0 hours' END),CURRENT_TIMESTAMP+(CASE WHEN $4::boolean THEN INTERVAL '-24 hours' ELSE INTERVAL '23 hours' END) FROM generate_series(1,100) n`,
          [f.organizationId, f.owner.principalId, f.ownerMembershipId, expired],
        ),
      );
    }
    const live = await fixture(),
      target = await principal();
    await fill(live, false);
    await expect(
      app.createForRecipient(
        live.owner,
        live.organizationId,
        targeted(target),
        id("bounded"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await app.listForRecipient(target, { limit: 20 })).items).toEqual(
      [],
    );
    const expired = await fixture();
    await fill(expired, true);
    expect(
      (
        await app.createForRecipient(
          expired.owner,
          expired.organizationId,
          targeted(target),
          id("replacement"),
        )
      ).status,
    ).toBe("pending");
  });
  it("supports reciprocal targeted invitations and enforces seat limits on acceptance", async () => {
    const a = await fixture(),
      b = await fixture();
    const created = await Promise.all([
      app.createForRecipient(
        a.owner,
        a.organizationId,
        targeted(b.owner),
        id("a"),
      ),
      app.createForRecipient(
        b.owner,
        b.organizationId,
        targeted(a.owner),
        id("b"),
      ),
    ]);
    const joined = await Promise.all([
      app.acceptForRecipient(b.owner, created[0].id),
      app.acceptForRecipient(a.owner, created[1].id),
    ]);
    expect(joined.map((x) => x.status)).toEqual(["accepted", "accepted"]);
    const one = await principal(),
      two = await principal();
    const first = await app.createForRecipient(
      a.owner,
      a.organizationId,
      targeted(one),
      id("seat"),
    );
    const second = await app.createForRecipient(
      a.owner,
      a.organizationId,
      targeted(two),
      id("last"),
    );
    await app.acceptForRecipient(one, first.id);
    await expect(app.acceptForRecipient(two, second.id)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await memberCount(a.organizationId)).toBe(3);
  });
});
