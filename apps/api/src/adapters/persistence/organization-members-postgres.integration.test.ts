import { PostgresAccountWorkspaces } from "./account-workspaces.js";
import { PostgresOrganizationMembers } from "./organization-members.js";
import type { ChangeOrganizationMembershipV1 } from "@cloudmarkup/api-contract";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BETA_SHARING_PLAN_IDS } from "@cloudmarkup/domain";
import type { OrganizationRole } from "../../application/authorization.js";
import type { TrustedCommercialAdministrationContext } from "../../application/commercial-persistence.js";
import type { PrincipalContext } from "../../application/ports.js";
import { OrganizationInvitationApplication } from "../../application/organization-invitations.js";
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
const schema = "cm_member_test_" + randomUUID().replaceAll("-", "");
const marker = "CloudMarkup synthetic membership lifecycle";
suite("organization membership lifecycle on isolated real PostgreSQL", () => {
  let admin: PostgresDatabase | undefined,
    database: PostgresDatabase,
    app: PostgresOrganizationInvitationRepository;
  let opened: PostgresDatabase | undefined;
  let members: PostgresOrganizationMembers;
  let legacyBefore: unknown;
  let legacyMembershipId: string;
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
        `COMMENT ON SCHEMA "${schema}" IS 'CloudMarkup synthetic membership lifecycle'`,
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
      migrations.filter((m) => m.version < "0087"),
    );
    app = new PostgresOrganizationInvitationRepository(database);
    members = new PostgresOrganizationMembers(database);
    const f = await fixture();
    legacyMembershipId = f.ownerMembershipId;
    legacyBefore = (
      await database.query(
        sql(
          "SELECT to_jsonb(m) AS value FROM memberships m WHERE membership_id=$1",
          [legacyMembershipId],
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
          !/^cm_member_test_[a-f0-9]{32}$/u.test(schema)
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

  async function command(
    actor: PrincipalContext,
    organizationId: string,
    input: ChangeOrganizationMembershipV1,
    key = id("attempt"),
    application = members,
  ) {
    const target = (
      await members.list(actor, organizationId, { limit: 100 })
    ).items.find((m) => m.membershipId === input.membershipId);
    if (!target) throw Error("Synthetic target missing");
    return application.change(actor, organizationId, input, target.etag, key);
  }
  const request = (
    membershipId: string,
    role: "administrator" | "editor" | "viewer" = "viewer",
  ) => ({
    contractVersion: 1 as const,
    action: "set-role" as const,
    membershipId,
    role,
  });
  it("preserves every historical membership field and applies the candidate once", async () => {
    const after = (
      await database.query(
        sql(
          "SELECT to_jsonb(m)-ARRAY['ended_at','end_reason'] AS value FROM memberships m WHERE membership_id=$1",
          [legacyMembershipId],
        ),
      )
    ).rows[0]?.["value"];
    expect(after).toEqual(legacyBefore);
  });
  it("supports unpaid organizations, conditional role changes, exact replay and immutable receipts", async () => {
    const f = await fixture(null),
      target = await principal(),
      mid = await addMember(f.organizationId, target);
    const before = (await members.own(target, f.organizationId)).value,
      key = id("role");
    const receipt = await members.change(
      f.owner,
      f.organizationId,
      request(mid),
      before.etag,
      key,
    );
    expect(receipt.members[0]).toMatchObject({
      membershipId: mid,
      role: "viewer",
      version: 2,
      status: "active",
    });
    await command(f.owner, f.organizationId, request(mid, "administrator"));
    expect(
      await members.change(
        f.owner,
        f.organizationId,
        request(mid),
        before.etag,
        key,
      ),
    ).toEqual(receipt);
    expect((await members.own(target, f.organizationId)).value.role).toBe(
      "administrator",
    );
    await expect(
      members.change(
        f.owner,
        f.organizationId,
        request(mid, "editor"),
        before.etag,
        key,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(
      members.change(
        f.owner,
        f.organizationId,
        request(mid),
        before.etag,
        id("stale"),
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    await expect(
      database.query(
        sql(
          "UPDATE organization_membership_change_receipts SET request_sha256=repeat('f',64) WHERE organization_id=$1",
          [f.organizationId],
        ),
      ),
    ).rejects.toThrow();
  });
  it("restricts administrator changes, self-escalation, owner manipulation and tenant guessing", async () => {
    const f = await fixture(null),
      a = await principal(),
      b = await principal(),
      v = await principal();
    const am = await addMember(f.organizationId, a, "administrator"),
      bm = await addMember(f.organizationId, b, "administrator"),
      vm = await addMember(f.organizationId, v, "viewer");
    for (const input of [
      request(vm, "administrator"),
      request(am, "editor"),
      request(bm, "editor"),
      request(f.ownerMembershipId),
      {
        contractVersion: 1 as const,
        action: "remove" as const,
        membershipId: bm,
      },
    ])
      await expect(command(a, f.organizationId, input)).rejects.toMatchObject({
        code: "access_denied",
      });
    expect(
      (await command(a, f.organizationId, request(vm, "editor"))).members[0]
        ?.role,
    ).toBe("editor");
    await expect(
      members.list(v, f.organizationId, { limit: 20 }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      members.change(
        v,
        f.organizationId,
        request(am),
        '"member:wrong:99"',
        id("viewer-version"),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    const outsider = await principal(),
      etag = (await members.own(v, f.organizationId)).etag;
    await expect(
      members.change(
        outsider,
        f.organizationId,
        request(vm),
        etag,
        id("guess"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(members.own(outsider, f.organizationId)).rejects.toMatchObject(
      { code: "not_found" },
    );
    const other = await fixture(null);
    await expect(
      members.change(
        f.owner,
        other.organizationId,
        request(vm),
        etag,
        id("tenant"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("lets viewers leave and retry their own receipt without restoring access", async () => {
    const f = await fixture(null),
      viewer = await principal(),
      mid = await addMember(f.organizationId, viewer, "viewer");
    const before = await members.own(viewer, f.organizationId),
      input = {
        contractVersion: 1 as const,
        action: "leave" as const,
        membershipId: mid,
      },
      key = id("leave");
    const receipt = await members.change(
      viewer,
      f.organizationId,
      input,
      before.etag,
      key,
    );
    expect(receipt.members[0]).toMatchObject({ status: "removed", version: 2 });
    expect((await members.own(viewer, f.organizationId)).value).toMatchObject({
      status: "removed",
      endReason: "left",
      membershipId: mid,
    });
    expect(
      await members.change(viewer, f.organizationId, input, before.etag, key),
    ).toEqual(receipt);
    await expect(
      members.list(viewer, f.organizationId, { limit: 20 }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("protects the last active owner and transfers both roles atomically", async () => {
    const f = await fixture(null),
      next = await principal(),
      mid = await addMember(f.organizationId, next);
    const own = await members.own(f.owner, f.organizationId);
    await expect(
      members.change(
        f.owner,
        f.organizationId,
        {
          contractVersion: 1,
          action: "leave",
          membershipId: f.ownerMembershipId,
        },
        own.etag,
        id("last"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const input = {
        contractVersion: 1 as const,
        action: "transfer-ownership" as const,
        membershipId: f.ownerMembershipId,
        targetMembershipId: mid,
        targetVersion: 1,
      },
      key = id("transfer");
    const receipt = await members.change(
      f.owner,
      f.organizationId,
      input,
      own.etag,
      key,
    );
    expect(
      receipt.members.map((m) => [m.membershipId, m.role, m.version]),
    ).toEqual([
      [f.ownerMembershipId, "administrator", 2],
      [mid, "owner", 2],
    ]);
    expect(
      await members.change(f.owner, f.organizationId, input, own.etag, key),
    ).toEqual(receipt);
    await expect(
      command(f.owner, f.organizationId, request(mid)),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
  it("serializes competing departures so one active owner always remains", async () => {
    const f = await fixture(null),
      second = await principal(),
      mid = await addMember(f.organizationId, second, "owner");
    const one = await members.own(f.owner, f.organizationId),
      two = await members.own(second, f.organizationId);
    const results = await Promise.allSettled([
      members.change(
        f.owner,
        f.organizationId,
        {
          contractVersion: 1,
          action: "leave",
          membershipId: f.ownerMembershipId,
        },
        one.etag,
        id("one"),
      ),
      members.change(
        second,
        f.organizationId,
        { contractVersion: 1, action: "leave", membershipId: mid },
        two.etag,
        id("two"),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (
        await database.query(
          sql(
            "SELECT membership_id FROM memberships WHERE organization_id=$1 AND role_key='owner' AND lifecycle_status='active'",
            [f.organizationId],
          ),
        )
      ).rowCount,
    ).toBe(1);
  });
  it("rejoins only through a fresh bound invitation with current seat admission", async () => {
    const f = await fixture(),
      target = await principal(),
      recipient = { kind: "user-id", userId: target.principalId };
    const first = await app.createForRecipient(
      f.owner,
      f.organizationId,
      { contractVersion: 1, role: "editor", recipient },
      id("first"),
    );
    const accepted = await app.acceptForRecipient(target, first.id);
    const before = (await members.own(target, f.organizationId)).value;
    await command(f.owner, f.organizationId, {
      contractVersion: 1,
      action: "remove",
      membershipId: accepted.membershipId,
    });
    await expect(
      app.acceptForRecipient(target, first.id),
    ).rejects.toMatchObject({ code: "not_found" });
    const legacy = await new OrganizationInvitationApplication({
      repository: app,
    }).create(
      f.owner,
      f.organizationId,
      { contractVersion: 1, role: "viewer", token: "b".repeat(42) + "A" },
      id("legacy"),
    );
    await expect(
      app.accept(
        target,
        legacy.id,
        createHash("sha256")
          .update("b".repeat(42) + "A")
          .digest("hex"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const fresh = await app.createForRecipient(
      f.owner,
      f.organizationId,
      { contractVersion: 1, role: "viewer", recipient },
      id("fresh"),
    );
    const rejoined = await app.acceptForRecipient(target, fresh.id);
    expect(rejoined).toMatchObject({
      membershipId: accepted.membershipId,
      role: "viewer",
    });
    expect((await members.own(target, f.organizationId)).value).toMatchObject({
      membershipId: before.membershipId,
      joinedAt: before.joinedAt,
      version: 3,
      status: "active",
      endedAt: null,
      endReason: null,
    });
    expect(
      (
        await database.query(
          sql(
            "SELECT membership_id FROM memberships WHERE organization_id=$1 AND principal_id=$2",
            [f.organizationId, target.principalId],
          ),
        )
      ).rowCount,
    ).toBe(1);
  });
  it("keeps administrative suspension non-rejoinable", async () => {
    const f = await fixture(),
      target = await principal();
    await addMember(f.organizationId, target, "editor", "suspended");
    await expect(
      app.createForRecipient(
        f.owner,
        f.organizationId,
        {
          contractVersion: 1,
          role: "editor",
          recipient: { kind: "user-id", userId: target.principalId },
        },
        id("suspended"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("revokes a departing or demoted issuer's pending offers permanently", async () => {
    const f = await fixture(),
      manager = await principal(),
      target = await principal(),
      mid = await addMember(f.organizationId, manager, "administrator");
    const invite = await app.createForRecipient(
      manager,
      f.organizationId,
      {
        contractVersion: 1,
        role: "editor",
        recipient: { kind: "user-id", userId: target.principalId },
      },
      id("issued"),
    );
    await command(f.owner, f.organizationId, request(mid, "viewer"));
    await command(f.owner, f.organizationId, request(mid, "administrator"));
    expect(
      (await app.listForRecipient(target, { limit: 20 })).items.find(
        (i) => i.id === invite.id,
      )?.status,
    ).toBe("revoked");
    await expect(
      app.acceptForRecipient(target, invite.id),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("denies personal-workspace membership mutations", async () => {
    const actor = await principal(),
      workspace = await new PostgresAccountWorkspaces(database).createPersonal(
        actor,
      );
    const before = await members.own(actor, workspace.id);
    await expect(
      members.change(
        actor,
        workspace.id,
        {
          contractVersion: 1,
          action: "leave",
          membershipId: before.value.membershipId,
        },
        before.etag,
        id("personal"),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      members.list(actor, workspace.id, { limit: 20 }),
    ).rejects.toMatchObject({ code: "access_denied" });
    const outsider = await principal();
    await expect(
      members.list(outsider, workspace.id, { limit: 20 }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      members.change(
        outsider,
        workspace.id,
        {
          contractVersion: 1,
          action: "leave",
          membershipId: before.value.membershipId,
        },
        before.etag,
        id("privateguess"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("rolls back membership, pending revocation and receipt when audit fails", async () => {
    const f = await fixture(),
      target = await principal(),
      mid = await addMember(f.organizationId, target);
    const broken: SqlDatabase = {
      query: (s) => database.query(s),
      close: () => Promise.resolve(),
      transaction: (work) =>
        database.transaction((tx) =>
          work({
            query: <T extends SqlRow>(statement: SqlStatement) => {
              if (statement.text.includes("INSERT INTO audit_events"))
                return Promise.reject(Error("Synthetic audit outage"));
              return tx.query<T>(statement);
            },
          }),
        ),
    };
    await expect(
      command(
        f.owner,
        f.organizationId,
        request(mid),
        id("rollback"),
        new PostgresOrganizationMembers(broken),
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect((await members.own(target, f.organizationId)).value).toMatchObject({
      role: "editor",
      version: 1,
    });
    expect(
      (
        await database.query(
          sql(
            "SELECT * FROM organization_membership_change_receipts WHERE organization_id=$1",
            [f.organizationId],
          ),
        )
      ).rowCount,
    ).toBe(0);
  });
  it("rejects expired/suspended identity, malformed inputs and stale transfer target", async () => {
    const f = await fixture(null),
      target = await principal(),
      mid = await addMember(f.organizationId, target),
      before = await members.own(f.owner, f.organizationId);
    await expect(
      members.change(
        { ...f.owner, expiresAt: new Date(0).toISOString() },
        f.organizationId,
        request(mid),
        before.etag,
        id("expired"),
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      members.change(
        {
          ...f.owner,
          authenticatedAt: new Date(Date.now() - 660000).toISOString(),
        },
        f.organizationId,
        request(mid),
        before.etag,
        id("oldauth"),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      members.change(
        f.owner,
        f.organizationId,
        { ...request(mid), principalId: target.principalId },
        before.etag,
        id("extra"),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      members.change(
        f.owner,
        f.organizationId,
        {
          contractVersion: 1,
          action: "transfer-ownership",
          membershipId: f.ownerMembershipId,
          targetMembershipId: mid,
          targetVersion: 2,
        },
        before.etag,
        id("stale"),
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    await database.query(
      sql(
        "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
        [f.owner.principalId],
      ),
    );
    await expect(members.own(f.owner, f.organizationId)).rejects.toMatchObject({
      code: "authentication_required",
    });
  });
  it("advances version for legacy administrative writes without accepting skipped versions", async () => {
    const f = await fixture(null),
      target = await principal(),
      mid = await addMember(f.organizationId, target);
    await database.query(
      sql("UPDATE memberships SET role_key='viewer' WHERE membership_id=$1", [
        mid,
      ]),
    );
    expect((await members.own(target, f.organizationId)).value.version).toBe(2);
    await expect(
      database.query(
        sql(
          "UPDATE memberships SET role_key='editor',record_version=8 WHERE membership_id=$1",
          [mid],
        ),
      ),
    ).rejects.toThrow();
    const noop = await command(f.owner, f.organizationId, request(mid));
    expect(noop.members[0]?.version).toBe(2);
  });
  it.each(["expiry", "recent-auth"])(
    "checks %s again after waiting for the actor lock",
    async (mode) => {
      const f = await fixture(null),
        target = await principal(),
        mid = await addMember(f.organizationId, target);
      const before = await members.own(target, f.organizationId);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
          enter = resolve;
        }),
        released = new Promise<void>((resolve) => {
          release = resolve;
        });
      const holder = database.transaction(async (tx) => {
        await tx.query(
          sql(
            "SELECT principal_id FROM principals WHERE principal_id=$1 FOR UPDATE",
            [f.owner.principalId],
          ),
        );
        enter();
        await released;
      });
      await entered;
      const actor = {
        ...f.owner,
        ...(mode === "expiry"
          ? { expiresAt: new Date(Date.now() + 200).toISOString() }
          : { authenticatedAt: new Date(Date.now() - 599800).toISOString() }),
      };
      const result = members
        .change(
          actor,
          f.organizationId,
          request(mid),
          before.etag,
          id("waiting"),
        )
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error: error as { code: string } }),
        );
      await new Promise((resolve) => setTimeout(resolve, 350));
      release();
      await holder;
      expect(await result).toMatchObject({
        error: {
          code: mode === "expiry" ? "authentication_required" : "access_denied",
        },
      });
      expect((await members.own(target, f.organizationId)).value).toMatchObject(
        { role: "editor", version: 1 },
      );
    },
  );
  it("rechecks active seat limits when a departed member accepts a fresh invitation", async () => {
    const f = await fixture(),
      target = await principal(),
      mid = await addMember(f.organizationId, target);
    await command(f.owner, f.organizationId, {
      contractVersion: 1,
      action: "remove",
      membershipId: mid,
    });
    const invite = await app.createForRecipient(
      f.owner,
      f.organizationId,
      {
        contractVersion: 1,
        role: "editor",
        recipient: { kind: "user-id", userId: target.principalId },
      },
      id("rejoin"),
    );
    await addMember(f.organizationId, await principal());
    await addMember(f.organizationId, await principal());
    await expect(
      app.acceptForRecipient(target, invite.id),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await members.own(target, f.organizationId)).value.status).toBe(
      "removed",
    );
    expect(
      (await app.listForRecipient(target, { limit: 20 })).items[0]?.status,
    ).toBe("pending");
  });
});
