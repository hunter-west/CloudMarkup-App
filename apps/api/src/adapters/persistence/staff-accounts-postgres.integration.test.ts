import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { PostgresSolutionExportTargetPolicy } from "./solution-export-target-policy.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import {
  TEST_TARGET_SETTINGS,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";
import { admissionSelectionFixture } from "./solution-export-admission-test-helpers.js";
import { PostgresOrganizationInvitationRepository } from "./organization-invitations.js";
import { permissionsForRole } from "../../application/authorization.js";
import {
  PostgresBetaAiCreditMeter,
  type BetaAiCreditIdentity,
} from "./beta-ai-credit-meter.js";
import { CurrentPlanRepositoryExportEntitlementPolicy } from "../../application/repository-export-entitlements.js";
import { createProductionCommercialReads } from "../../production-commercial-reads.js";
import type { BillingProvider } from "../../application/billing.js";
import type { BillingCheckoutSession } from "../../application/billing-checkout.js";
import { inspectTerminalTestCheckouts } from "./terminal-test-checkouts.js";
import { ENTITLEMENT_POLICY_VERSION } from "@cloudmarkup/domain";
import {
  prepareStaffAuthorization,
  applyStaffAuthorization,
  prepareLiveBillingCutover,
  applyLiveBillingCutover,
} from "./platform-operator.js";
import { PostgresBillingPersistence } from "./billing-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { PostgresStaffAccounts } from "./staff-accounts.js";
import { PostgresAccountCredentialAudit } from "./account-credential-audit.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import {
  sql,
  type SqlDatabase,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"],
  suite = configured ? describe : describe.skip;
const suffix = () => randomUUID().replaceAll("-", "");
const schema = "cm_staff_test_" + suffix(),
  marker = "CloudMarkup synthetic staff accounts";
suite("platform staff authority and accounting on PostgreSQL", () => {
  let admin: PostgresDatabase | undefined,
    db: PostgresDatabase | undefined,
    typed: SqlDatabase,
    app: PostgresStaffAccounts;
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
        `COMMENT ON SCHEMA "${schema}" IS 'CloudMarkup synthetic staff accounts'`,
      ),
    );
    db = new PostgresDatabase({
      connectionString: configured,
      max: 8,
      options: `-c search_path=${schema} -c timezone=UTC -c statement_timeout=8000`,
    });
    typed = withDataApiTypes(db);
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(db, migrations);
    await runMigrations(db, migrations);
    app = new PostgresStaffAccounts(typed);
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
          !/^cm_staff_test_[a-f0-9]{32}$/u.test(schema)
        )
          throw Error("Refusing unverified cleanup");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      } finally {
        await admin.close();
      }
    }
  }, 30000);
  async function actor(staff = true) {
    const p: PrincipalContext = {
      principalId: "principal_" + suffix(),
      sessionId: "session_" + suffix(),
      correlationId: "test_" + suffix(),
      authenticationSource: "cognito",
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    await typed.query(
      sql(
        "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic staff')",
        [p.principalId],
      ),
    );
    if (staff)
      await typed.query(
        sql(
          "INSERT INTO platform_staff_authorizations(principal_id,permissions) VALUES($1,ARRAY['accounts.read','credits.grant','credits.revoke','operations.manage'])",
          [p.principalId],
        ),
      );
    return p;
  }
  async function target(paid = true) {
    const organizationId = "org_" + suffix(),
      billingAccountId = "billing_" + suffix();
    await typed.query(
      sql(
        "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic test account',$2)",
        [organizationId, "synthetic-" + suffix()],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO organization_billing_accounts(organization_id,billing_account_id) VALUES($1,$2)",
        [organizationId, billingAccountId],
      ),
    );
    if (paid) {
      await typed.query(
        sql(
          "INSERT INTO organization_subscription_projections(subscription_projection_id,organization_id,billing_account_id,billing_provider,provider_customer_reference,provider_subscription_reference,normalized_status,plan_version_id,billable_seat_quantity,effective_at,provider_environment) SELECT $3,$1,$2,'stripe',$4,$5,'active',v.plan_version_id,1,clock_timestamp(),CASE WHEN EXISTS(SELECT 1 FROM billing_provider_cutovers) THEN 'live' ELSE 'test' END FROM commercial_plan_versions v JOIN commercial_plan_definitions d ON d.plan_id=v.plan_id WHERE d.plan_key='pro' ORDER BY v.version_number DESC LIMIT 1",
          [
            organizationId,
            billingAccountId,
            "projection_" + suffix(),
            "cus_" + suffix(),
            "sub_" + suffix(),
          ],
        ),
      );
      await typed.query(
        sql(
          "INSERT INTO organization_entitlement_snapshots(organization_id,entitlement_snapshot_id,billing_account_id,subscription_projection_id,plan_version_id,entitlement_policy_version,source_record_version,expensive_operations_enabled,effective_at) SELECT organization_id,$2,billing_account_id,subscription_projection_id,plan_version_id,$3,record_version,true,clock_timestamp() FROM organization_subscription_projections WHERE organization_id=$1",
          [
            organizationId,
            "entitlement_" + suffix(),
            ENTITLEMENT_POLICY_VERSION,
          ],
        ),
      );
    }
    return { organizationId, billingAccountId };
  }
  async function expectCustomerCredits(
    organizationId: string,
    available: number,
    netAdjustment: number,
  ) {
    const customer = await actor(false);
    await typed.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',true,cloudmarkup_authorization_v2_permissions('owner')) ON CONFLICT DO NOTHING",
        [organizationId],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
        ["membership_" + suffix(), organizationId, customer.principalId],
      ),
    );
    const reads = createProductionCommercialReads({ database: typed });
    const overview = await reads.getCreditOverview(customer, organizationId);
    expect(overview.balance).toMatchObject({
      availableCreditUnits: available,
      netAdjustmentCreditUnits: netAdjustment,
    });
    expect(overview.balance).not.toHaveProperty("ledgerThroughEventId");
    expect(overview.availableByKind).toEqual({
      monthly: 0,
      purchased: 0,
      other: available,
    });
    const balance = await reads.getCreditBalance(customer, organizationId);
    expect(balance).toMatchObject({
      availableCreditUnits: available,
      netAdjustmentCreditUnits: netAdjustment,
    });
    expect(balance).not.toHaveProperty("ledgerThroughEventId");
    return customer;
  }
  const grant = (billingAccountId: string) => ({
    contractVersion: 1 as const,
    action: "grant-credits" as const,
    confirmBillingAccountId: billingAccountId,
    creditUnits: 350,
    expiresInDays: 30,
    reason: "Synthetic testing allocation",
  });
  it("finds an active member by verified provider email after contact projection", async () => {
    const staff = await actor(),
      customer = await actor(false),
      t = await target();
    const email = `verified-${suffix()}@example.com`;
    const issuer =
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC";
    const subject = "11111111-2222-7333-4444-" + suffix().slice(0, 12);
    await typed.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',true,cloudmarkup_authorization_v2_permissions('owner'))",
        [t.organizationId],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
        ["membership_" + suffix(), t.organizationId, customer.principalId],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO principal_identity_references(identity_reference_id,principal_id,identity_provider,issuer,subject_reference) VALUES($1,$2,'cognito',$3,$4)",
        ["identity_" + suffix(), customer.principalId, issuer, subject],
      ),
    );
    expect((await app.search(staff, { q: email })).items).toEqual([]);
    const projection = new PostgresAccountCredentialAudit(typed, issuer);
    await projection.synchronizeVerifiedContact(
      customer,
      await projection.readContact(customer),
      { subject, email },
    );
    expect(
      (await app.search(staff, { q: email.toUpperCase() })).items.map(
        (item) => item.organizationId,
      ),
    ).toEqual([t.organizationId]);
    await expect(app.search(customer, { q: email })).rejects.toMatchObject({
      code: "access_denied",
    });
    await projection.synchronizeVerifiedContact(
      customer,
      await projection.readContact(customer),
      {
        subject,
        email: null,
      },
    );
    expect((await app.search(staff, { q: email })).items).toEqual([]);
  });
  it("issues exactly once for concurrent retries with immutable audit and a visible expiring balance", async () => {
    const p = await actor(),
      t = await target(),
      before = await app.get(p, t.organizationId),
      key = "staff-test-" + suffix(),
      input = grant(t.billingAccountId);
    const [one, two] = await Promise.all([
      app.act(p, t.organizationId, input, before.etag, key),
      app.act(p, t.organizationId, input, before.etag, key),
    ]);
    expect(one).toEqual(two);
    const after = await app.get(p, t.organizationId);
    expect(after.value.availableCreditUnits).toBe("350");
    expect(after.value.history).toEqual([one]);
    await expectCustomerCredits(t.organizationId, 350, 0);
    expect(after.value.grants[0]).toMatchObject({
      creditUnits: "350",
      availableCreditUnits: "350",
      actorPrincipalId: p.principalId,
    });
    // Data API's JSON result encodes PostgreSQL JSONB as a JSON string;
    // native pg returns an object and otherwise conceals this read boundary.
    const stringReceipts = new PostgresStaffAccounts({
      ...typed,
      transaction: (work) =>
        typed.transaction((transaction) =>
          work({
            query: async <TRow extends SqlRow>(
              statement: SqlStatement,
            ): Promise<SqlResult<TRow>> => {
              const result = await transaction.query<TRow>(statement);
              return {
                ...result,
                rows: result.rows.map((row) =>
                  row["receipt_json"] === undefined
                    ? row
                    : {
                        ...row,
                        receipt_json: JSON.stringify(row["receipt_json"]),
                      },
                ),
              };
            },
          }),
        ),
    });
    const [detail, replay] = await Promise.allSettled([
      stringReceipts.get(p, t.organizationId),
      stringReceipts.act(p, t.organizationId, input, before.etag, key),
    ]);
    expect([detail.status, replay.status]).toEqual(["fulfilled", "fulfilled"]);
    if (detail.status !== "fulfilled" || replay.status !== "fulfilled")
      throw Error("The stored staff receipt could not be decoded");
    expect(detail.value).toEqual(after);
    expect(replay.value).toEqual(one);
    await expect(
      stringReceipts.act(
        p,
        t.organizationId,
        { ...input, creditUnits: 351 },
        before.etag,
        key,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(
      typed.query(
        sql("DELETE FROM platform_staff_account_actions WHERE action_id=$1", [
          one.actionId,
        ]),
      ),
    ).rejects.toThrow();
  });
  it("denies ordinary owners, forged roles, revoked staff and read-only staff before grants", async () => {
    const p = await actor(false),
      t = await target();
    expect((await app.access(p)).permissions).toEqual([]);
    await expect(app.search(p, { q: "Synthetic" })).rejects.toMatchObject({
      code: "access_denied",
    });
    await expect(
      app.act(
        { ...p, ...{ role: "administrator", permissions: ["credits.grant"] } },
        t.organizationId,
        grant(t.billingAccountId),
        '"fake"',
        suffix(),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    const staff = await actor();
    await typed.query(
      sql(
        "UPDATE platform_staff_authorizations SET revoked_at=clock_timestamp() WHERE principal_id=$1",
        [staff.principalId],
      ),
    );
    await expect(app.get(staff, t.organizationId)).rejects.toMatchObject({
      code: "access_denied",
    });
    const reader = await actor();
    await typed.query(
      sql(
        "UPDATE platform_staff_authorizations SET permissions=ARRAY['accounts.read'] WHERE principal_id=$1",
        [reader.principalId],
      ),
    );
    const before = await app.get(reader, t.organizationId);
    await expect(
      app.act(
        reader,
        t.organizationId,
        grant(t.billingAccountId),
        before.etag,
        suffix(),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
  it("requires current Cognito sessions and recent sign-in, including application session revocation", async () => {
    const p = await actor(),
      t = await target(),
      before = await app.get(p, t.organizationId);
    for (const override of [
      { authenticationSource: "test" as const },
      { expiresAt: new Date(Date.now() - 1000).toISOString() },
    ])
      await expect(
        app.get({ ...p, ...override }, t.organizationId),
      ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      app.act(
        {
          ...p,
          authenticatedAt: new Date(Date.now() - 11 * 60000).toISOString(),
        },
        t.organizationId,
        grant(t.billingAccountId),
        before.etag,
        suffix(),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    await typed.query(
      sql(
        "INSERT INTO account_revoked_session_families(principal_id,provider_session_sha256) VALUES($1,$2)",
        [p.principalId, createHash("sha256").update(p.sessionId).digest("hex")],
      ),
    );
    await expect(app.get(p, t.organizationId)).rejects.toMatchObject({
      code: "authentication_required",
    });
  });
  it("requires an exact target and version and rejects unsupported bounds", async () => {
    const p = await actor(),
      t = await target(),
      other = await target(),
      before = await app.get(p, t.organizationId);
    await expect(
      app.act(
        p,
        t.organizationId,
        grant(other.billingAccountId),
        before.etag,
        suffix(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      app.act(
        p,
        t.organizationId,
        grant(t.billingAccountId),
        '"stale"',
        suffix(),
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    for (const units of [0, -1, 1.5, 100001])
      await expect(
        app.act(
          p,
          t.organizationId,
          { ...grant(t.billingAccountId), creditUnits: units },
          before.etag,
          suffix(),
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("revokes only the selected complimentary grant and cannot overdraw it or touch another account", async () => {
    const p = await actor(),
      t = await target(),
      other = await target();
    const before = await app.get(p, t.organizationId);
    const first = await app.act(
      p,
      t.organizationId,
      grant(t.billingAccountId),
      before.etag,
      suffix(),
    );
    const next = await app.get(p, t.organizationId);
    await app.act(
      p,
      t.organizationId,
      grant(t.billingAccountId),
      next.etag,
      suffix(),
    );
    if (first.creditGrantId === null) throw Error("Missing grant");
    const revoke = {
      contractVersion: 1 as const,
      action: "revoke-credits" as const,
      confirmBillingAccountId: t.billingAccountId,
      creditGrantId: first.creditGrantId,
      creditUnits: 350,
      reason: "Synthetic test cleanup",
    };
    const current = await app.get(p, t.organizationId);
    await expect(
      app.act(
        p,
        t.organizationId,
        { ...revoke, creditUnits: 351 },
        current.etag,
        suffix(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await app.act(p, t.organizationId, revoke, current.etag, suffix());
    const after = await app.get(p, t.organizationId);
    expect(after.value.availableCreditUnits).toBe("350");
    expect(
      after.value.grants.find((g) => g.id === first.creditGrantId)
        ?.availableCreditUnits,
    ).toBe("0");
    await expectCustomerCredits(t.organizationId, 350, -350);
    const otherBefore = await app.get(p, other.organizationId);
    await expect(
      app.act(
        p,
        other.organizationId,
        { ...revoke, confirmBillingAccountId: other.billingAccountId },
        otherBefore.etag,
        suffix(),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("rolls the grant and account version back when the audit insert fails", async () => {
    const p = await actor(),
      t = await target(),
      before = await app.get(p, t.organizationId);
    const failing: SqlDatabase = {
      ...typed,
      transaction: (work) =>
        typed.transaction((tx) =>
          work({
            query: (statement) => {
              if (
                statement.text.startsWith(
                  "INSERT INTO platform_staff_account_actions",
                )
              )
                throw Error("Synthetic audit failure");
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      new PostgresStaffAccounts(failing).act(
        p,
        t.organizationId,
        grant(t.billingAccountId),
        before.etag,
        suffix(),
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(await app.get(p, t.organizationId)).toEqual(before);
  });
  it("records staff pauses and resumes and enforces them for both repository export providers", async () => {
    const p = await actor(),
      customer = await actor(false),
      t = await target();
    await typed.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',true,cloudmarkup_authorization_v2_permissions('owner'))",
        [t.organizationId],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
        ["membership_" + suffix(), t.organizationId, customer.principalId],
      ),
    );
    const commercial = createProductionCommercialReads({ database: typed });
    const exportPolicies = (["GitHub", "GitLab"] as const).map(
      (provider) =>
        new CurrentPlanRepositoryExportEntitlementPolicy(commercial, provider),
    );
    const exportInput = {
      organizationId: t.organizationId,
      principal: customer,
      projectId: "project_" + suffix(),
    };
    for (const policy of exportPolicies)
      await expect(policy.authorize(exportInput)).resolves.toBeUndefined();
    for (const enabled of [false, true]) {
      const before = await app.get(p, t.organizationId);
      await app.act(
        p,
        t.organizationId,
        {
          contractVersion: 1,
          action: "set-operations",
          confirmBillingAccountId: t.billingAccountId,
          enabled,
          reason: "Synthetic operations control",
        },
        before.etag,
        suffix(),
      );
      expect(
        (await app.get(p, t.organizationId)).value.account
          .expensiveOperationsEnabled,
      ).toBe(enabled);
      const entitlement = await typed.query(
        sql(
          "SELECT expensive_operations_enabled FROM organization_entitlement_snapshots WHERE organization_id=$1",
          [t.organizationId],
        ),
      );
      expect(entitlement.rows[0]?.["expensive_operations_enabled"]).toBe(
        enabled,
      );
      for (const policy of exportPolicies) {
        if (enabled)
          await expect(policy.authorize(exportInput)).resolves.toBeUndefined();
        else
          await expect(policy.authorize(exportInput)).rejects.toMatchObject({
            code: "access_denied",
          });
      }
    }
  });
  it("preserves audited self-grants and funded AI access after subscription cancellation", async () => {
    const p = await actor(),
      t = await target();
    await typed.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',true,cloudmarkup_authorization_v2_permissions('owner'))",
        [t.organizationId],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
        ["membership_" + suffix(), t.organizationId, p.principalId],
      ),
    );
    const before = await app.get(p, t.organizationId);
    const receipt = await app.act(
      p,
      t.organizationId,
      grant(t.billingAccountId),
      before.etag,
      suffix(),
    );
    expect(receipt.actorPrincipalId).toBe(p.principalId);
    expect((await app.get(p, t.organizationId)).value.history[0]).toEqual(
      receipt,
    );
    await typed.query(
      sql(
        "UPDATE organization_subscription_projections SET normalized_status='canceled' WHERE organization_id=$1",
        [t.organizationId],
      ),
    );
    const after = await app.get(p, t.organizationId);
    const refill = await app.act(
      p,
      t.organizationId,
      grant(t.billingAccountId),
      after.etag,
      suffix(),
    );
    expect(refill.action).toBe("grant-credits");
    const plan = await createProductionCommercialReads({
      database: typed,
    }).getCurrentPlanEntitlements(p, t.organizationId);
    expect(plan).toMatchObject({
      plan: { key: "staff-credits" },
      subscription: { state: "not-subscribed" },
      expensiveOperationsEnabled: true,
    });
    expect(plan).not.toHaveProperty("trial");
    expect(
      plan.entitlements
        .filter((entry) => entry.enabled)
        .map((entry) => entry.feature),
    ).toEqual(["ai-assisted-operations"]);
    await expectCustomerCredits(t.organizationId, 700, 0);
  });
  it("bootstraps only an exact immutable Cognito identity and audits operator revocation", async () => {
    const p = await actor(false),
      subject = suffix(),
      issuer =
        "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic";
    await typed.query(
      sql(
        "INSERT INTO principal_identity_references(identity_reference_id,principal_id,identity_provider,issuer,subject_reference) VALUES($1,$2,'cognito',$3,$4)",
        ["identity_" + suffix(), p.principalId, issuer, subject],
      ),
    );
    const input = {
      issuer,
      subject,
      principalId: p.principalId,
      operatorReference: "arn:aws:iam::123456789012:role/synthetic",
      reason: "Synthetic operator authorization",
      permissions: ["accounts.read", "credits.grant"] as const,
      action: "authorized" as const,
    };
    const preview = await prepareStaffAuthorization(typed, input);
    await expect(
      applyStaffAuthorization(
        typed,
        { ...input, subject: "wrong" },
        preview.digest,
      ),
    ).rejects.toThrow();
    await expect(
      applyStaffAuthorization(typed, input, "a".repeat(64)),
    ).rejects.toThrow();
    expect((await app.access(p)).permissions).toEqual([]);
    await applyStaffAuthorization(typed, input, preview.digest);
    expect((await app.access(p)).permissions).toEqual(input.permissions);
    await expect(
      applyStaffAuthorization(typed, input, preview.digest),
    ).rejects.toThrow();
    await typed.query(
      sql(
        "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
        [p.principalId],
      ),
    );
    const revoke = { ...input, action: "revoked" as const };
    const next = await prepareStaffAuthorization(typed, revoke);
    await applyStaffAuthorization(typed, revoke, next.digest);
    await expect(app.access(p)).rejects.toMatchObject({
      code: "authentication_required",
    });
    const audit = await typed.query(
      sql(
        "SELECT action FROM platform_staff_authorization_events WHERE principal_id=$1 ORDER BY occurred_at",
        [p.principalId],
      ),
    );
    expect(audit.rows.map((r) => r["action"])).toEqual([
      "authorized",
      "revoked",
    ]);
    await expect(
      typed.query(
        sql(
          "DELETE FROM platform_staff_authorization_events WHERE principal_id=$1",
          [p.principalId],
        ),
      ),
    ).rejects.toThrow();
  });
  it("cuts over once, preserves test evidence, debits unused test grants and refuses test writes afterward", async () => {
    const p = await actor(),
      t = await target(),
      commercial = new PostgresCommercialPersistenceRepository(typed),
      creditGrantId = "grant_" + suffix();
    await commercial.createCreditGrant(
      {
        authority: "internal-accounting",
        actorId: "synthetic_test",
        organizationId: t.organizationId,
        correlationId: "synthetic-cutover",
      },
      {
        creditGrantId,
        ledgerEntryId: "ledger_" + suffix(),
        creditUnits: "100",
        grantKind: "promotional",
        startsAt: new Date().toISOString(),
        expirationPolicy: {
          kind: "does-not-expire",
          policyVersion: "synthetic-test-v1",
        },
        grantPolicyVersion: "synthetic-test-v1",
        chargingPolicyVersion: "synthetic-test-v1",
        consumptionPriority: "20",
        idempotencyKey: suffix(),
        reasonCode: "test.synthetic",
        safeReason: "Synthetic cutover fixture",
      },
    );
    const test = new PostgresBillingPersistence(typed),
      live = new PostgresBillingPersistence(typed, "live");
    await test.assertProviderMode();
    await expect(live.assertProviderMode()).rejects.toMatchObject({
      code: "billing-disabled",
    });
    const terminalSessions: BillingCheckoutSession[] = [];
    for (const status of ["expired", "complete"] as const) {
      const account = status === "expired" ? t : await target(),
        attemptId = "checkout_" + suffix(),
        reference = "cs_test_" + suffix();
      await typed.query(
        sql(
          "INSERT INTO billing_checkout_attempts(attempt_id,organization_id,billing_account_id,request_key_sha256,request_sha256) VALUES($1,$2,$3,$4,$5)",
          [
            attemptId,
            account.organizationId,
            account.billingAccountId,
            "a".repeat(64),
            "b".repeat(64),
          ],
        ),
      );
      await expect(
        inspectTerminalTestCheckouts(typed, p.principalId, () =>
          Promise.reject(
            Error("Provider must not be called for pending attempts"),
          ),
        ),
      ).rejects.toThrow();
      const expiresAt = "2026-01-01T12:00:00.000Z";
      await typed.query(
        sql(
          "UPDATE billing_checkout_attempts SET lifecycle_status='created',provider_session_reference=$2,provider_expires_at=$3::timestamptz,record_version=record_version+1 WHERE attempt_id=$1",
          [attemptId, reference, expiresAt],
        ),
      );
      terminalSessions.push({
        organizationId: account.organizationId,
        billingAccountId: account.billingAccountId,
        providerSessionReference: reference,
        expiresAt,
        status,
        providerSubscriptionReference:
          status === "complete" ? "sub_" + suffix() : null,
        url: null,
      });
    }
    const provider = {
      getCheckoutSession: (
        input: Parameters<BillingProvider["getCheckoutSession"]>[0],
      ) => {
        const session = terminalSessions.find(
          (item) =>
            item.providerSessionReference === input.providerSessionReference,
        );
        return session
          ? Promise.resolve(session)
          : Promise.reject(Error("Missing synthetic session"));
      },
    };
    await expect(
      prepareLiveBillingCutover(typed, p.principalId),
    ).rejects.toThrow();
    for (const unsafe of ["open", "wrong-account", "live-reference"] as const) {
      await expect(
        inspectTerminalTestCheckouts(typed, p.principalId, () =>
          Promise.resolve({
            getCheckoutSession: async (input) => {
              const session = await provider.getCheckoutSession(input);
              return unsafe === "open"
                ? {
                    ...session,
                    status: "open",
                    providerSubscriptionReference: null,
                    url: "https://checkout.stripe.com/synthetic",
                  }
                : unsafe === "wrong-account"
                  ? { ...session, organizationId: "org_wrong" }
                  : { ...session, providerSessionReference: "cs_live_wrong" };
            },
          }),
        ),
      ).rejects.toThrow();
    }
    const pendingAccount = await target();
    const pendingAttempt = "checkout_" + suffix();
    await typed.query(
      sql(
        "INSERT INTO billing_checkout_attempts(attempt_id,organization_id,billing_account_id,request_key_sha256,request_sha256) VALUES($1,$2,$3,$4,$5)",
        [
          pendingAttempt,
          pendingAccount.organizationId,
          pendingAccount.billingAccountId,
          "c".repeat(64),
          "d".repeat(64),
        ],
      ),
    );
    const pendingEvidence = {
      attemptId: pendingAttempt,
      providerRequestId: "req_" + suffix(),
      providerSessionReference: "cs_test_" + suffix(),
      operatorReference: "arn:aws:iam::123456789012:role/synthetic",
      reason: "Synthetic reviewed request log",
    };
    terminalSessions.push({
      ...pendingAccount,
      providerSessionReference: pendingEvidence.providerSessionReference,
      expiresAt: new Date(Date.now() - 24 * 3600000).toISOString(),
      status: "complete",
      providerSubscriptionReference: "sub_" + suffix(),
      url: null,
    });
    let unsafeProviderCalls = 0;
    const noProvider = () => {
      unsafeProviderCalls += 1;
      return Promise.reject(Error("Must deny before provider access"));
    };
    await expect(
      inspectTerminalTestCheckouts(typed, p.principalId, noProvider, [
        pendingEvidence,
      ]),
    ).rejects.toThrow();
    const ordinary = await actor(false);
    await expect(
      inspectTerminalTestCheckouts(typed, ordinary.principalId, noProvider, [
        pendingEvidence,
      ]),
    ).rejects.toThrow();
    // Age only this synthetic fixture inside its verified loopback schema.
    await typed.transaction(async (tx) => {
      await tx.query(
        sql(
          "ALTER TABLE billing_checkout_attempts DISABLE TRIGGER billing_checkout_attempt_transition",
        ),
      );
      await tx.query(
        sql(
          "UPDATE billing_checkout_attempts SET created_at=clock_timestamp()-INTERVAL '2 days',retry_before=clock_timestamp()-INTERVAL '25 hours' WHERE attempt_id=$1",
          [pendingAttempt],
        ),
      );
      await tx.query(
        sql(
          "ALTER TABLE billing_checkout_attempts ENABLE TRIGGER billing_checkout_attempt_transition",
        ),
      );
    });
    await expect(
      inspectTerminalTestCheckouts(typed, p.principalId, noProvider),
    ).rejects.toThrow();
    for (const invalid of [
      { ...pendingEvidence, providerRequestId: "not-a-request" },
      { ...pendingEvidence, providerSessionReference: "cs_live_synthetic" },
      { ...pendingEvidence, attemptId: "checkout_" + suffix() },
    ])
      await expect(
        inspectTerminalTestCheckouts(typed, p.principalId, noProvider, [
          invalid,
        ]),
      ).rejects.toThrow();
    await expect(
      inspectTerminalTestCheckouts(typed, p.principalId, noProvider, [
        pendingEvidence,
        pendingEvidence,
      ]),
    ).rejects.toThrow();
    expect(unsafeProviderCalls).toBe(0);
    await expect(
      inspectTerminalTestCheckouts(
        typed,
        p.principalId,
        () =>
          Promise.resolve({
            getCheckoutSession: async (input) => ({
              ...(await provider.getCheckoutSession(input)),
              ...(input.providerSessionReference ===
              pendingEvidence.providerSessionReference
                ? { organizationId: "org_wrong" }
                : {}),
            }),
          }),
        [pendingEvidence],
      ),
    ).rejects.toThrow();
    const terminalCheckouts = await inspectTerminalTestCheckouts(
      typed,
      p.principalId,
      () => Promise.resolve(provider),
      [pendingEvidence],
    );
    const preview = await prepareLiveBillingCutover(
      typed,
      p.principalId,
      terminalCheckouts,
    );
    if (preview.alreadyCompleted) throw Error("fixture");
    await expect(
      applyLiveBillingCutover(typed, p.principalId, "a".repeat(64)),
    ).rejects.toThrow();
    const pendingProof = terminalCheckouts.find(
      (item) => item.attemptId === pendingAttempt,
    );
    expect(pendingProof?.pendingRequestEvidence).toMatchObject({
      source: "operator-reviewed-stripe-request-log-v1",
      providerRequestId: pendingEvidence.providerRequestId,
      providerIdempotencyKey: "checkout:" + pendingAttempt,
      originalRequestKeySha256: "c".repeat(64),
      originalRequestSha256: "d".repeat(64),
    });
    await expect(
      prepareLiveBillingCutover(
        typed,
        p.principalId,
        terminalCheckouts.map((proof) =>
          proof.attemptId === pendingAttempt
            ? { ...proof, recordVersion: "2" }
            : proof,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      prepareLiveBillingCutover(
        typed,
        p.principalId,
        terminalCheckouts.map((proof) =>
          proof.pendingRequestEvidence
            ? {
                ...proof,
                pendingRequestEvidence: {
                  ...proof.pendingRequestEvidence,
                  originalRequestSha256: "e".repeat(64),
                },
              }
            : proof,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      applyLiveBillingCutover(
        typed,
        p.principalId,
        preview.digest,
        terminalCheckouts.map((proof) =>
          proof.pendingRequestEvidence
            ? {
                ...proof,
                pendingRequestEvidence: {
                  ...proof.pendingRequestEvidence,
                  providerRequestId: "req_changed_after_preview",
                },
              }
            : proof,
        ),
      ),
    ).rejects.toThrow();
    // Failing the immutable receipt must roll back both pending->created->consumed
    // transitions and all grant adjustments, not leave a partially repaired row.
    await typed.query(
      sql(
        "CREATE FUNCTION synthetic_reject_cutover_receipt() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END; $$",
      ),
    );
    await typed.query(
      sql(
        "CREATE TRIGGER synthetic_reject_cutover_receipt BEFORE INSERT ON billing_provider_cutovers FOR EACH ROW EXECUTE FUNCTION synthetic_reject_cutover_receipt()",
      ),
    );
    await expect(
      applyLiveBillingCutover(
        typed,
        p.principalId,
        preview.digest,
        terminalCheckouts,
      ),
    ).rejects.toThrow("synthetic receipt failure");
    expect(
      (
        await typed.query(
          sql(
            "SELECT lifecycle_status,record_version::text,provider_session_reference FROM billing_checkout_attempts WHERE attempt_id=$1",
            [pendingAttempt],
          ),
        )
      ).rows[0],
    ).toMatchObject({
      lifecycle_status: "pending",
      record_version: "1",
      provider_session_reference: null,
    });
    expect(
      (await app.get(p, t.organizationId)).value.availableCreditUnits,
    ).toBe("100");
    expect(
      (
        await typed.query(
          sql("SELECT count(*)::text AS count FROM billing_provider_cutovers"),
        )
      ).rows[0]?.["count"],
    ).toBe("0");
    await typed.query(
      sql(
        "DROP TRIGGER synthetic_reject_cutover_receipt ON billing_provider_cutovers",
      ),
    );
    await typed.query(sql("DROP FUNCTION synthetic_reject_cutover_receipt()"));
    const receipt = await applyLiveBillingCutover(
      typed,
      p.principalId,
      preview.digest,
      terminalCheckouts,
    );
    expect(receipt).toMatchObject({
      removedTestCreditUnits: "100",
      retiredTestCheckouts: 3,
    });
    expect(
      (
        await typed.query(
          sql(
            "SELECT lifecycle_status FROM billing_checkout_attempts ORDER BY lifecycle_status",
          ),
        )
      ).rows.map((row) => row["lifecycle_status"]),
    ).toEqual(["consumed", "consumed", "expired"]);
    expect(receipt).toMatchObject({ checkoutEvidence: terminalCheckouts });
    expect(
      (
        await typed.query(
          sql(
            "SELECT lifecycle_status,record_version::text,request_key_sha256,request_sha256 FROM billing_checkout_attempts WHERE attempt_id=$1",
            [pendingAttempt],
          ),
        )
      ).rows[0],
    ).toMatchObject({
      lifecycle_status: "consumed",
      record_version: "3",
      request_key_sha256: "c".repeat(64),
      request_sha256: "d".repeat(64),
    });
    await expect(
      typed.query(
        sql("UPDATE billing_provider_cutovers SET receipt_json='{}'::jsonb"),
      ),
    ).rejects.toThrow();

    expect(
      await applyLiveBillingCutover(typed, p.principalId, preview.digest),
    ).toEqual(receipt);
    await live.assertProviderMode();
    await expect(test.assertProviderMode()).rejects.toMatchObject({
      code: "billing-disabled",
    });
    expect(
      (await app.get(p, t.organizationId)).value.availableCreditUnits,
    ).toBe("0");
    await expectCustomerCredits(t.organizationId, 0, -100);
    expect(
      (
        await typed.query(
          sql(
            "SELECT normalized_status,provider_environment FROM organization_subscription_projections WHERE organization_id=$1",
            [t.organizationId],
          ),
        )
      ).rows[0],
    ).toMatchObject({
      normalized_status: "canceled",
      provider_environment: "test",
    });
    await expect(
      typed.query(
        sql(
          "UPDATE organization_subscription_projections SET normalized_status='active' WHERE organization_id=$1",
          [t.organizationId],
        ),
      ),
    ).rejects.toThrow();
    expect(
      (
        await typed.query(
          sql(
            "SELECT projection_json->>'normalized_status' AS state FROM billing_cutover_projection_history WHERE organization_id=$1",
            [t.organizationId],
          ),
        )
      ).rows[0]?.["state"],
    ).toBe("active");
  });
  function requiredTrialId(value: string | undefined): string {
    if (!value) throw Error("Missing synthetic trial receipt");
    return value;
  }
  async function trialStaff() {
    const staff = await actor();
    await typed.query(
      sql(
        "UPDATE platform_staff_authorizations SET permissions=permissions||ARRAY['trials.grant','trials.revoke']::text[] WHERE principal_id=$1",
        [staff.principalId],
      ),
    );
    return staff;
  }
  const trialGrant = (billingAccountId: string) => ({
    ...grant(billingAccountId),
    action: "grant-trial" as const,
    creditUnits: 100,
    expiresInDays: 14,
  });
  it("requires dedicated trial authority; a customer owner or credit administrator cannot grant access", async () => {
    const staff = await actor(),
      t = await target(false),
      input = trialGrant(t.billingAccountId);
    const before = await app.get(staff, t.organizationId);
    await expect(
      app.act(
        staff,
        t.organizationId,
        input,
        before.etag,
        "trial-denied-" + suffix(),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(
      (
        await typed.query(
          sql(
            "SELECT trial_id FROM platform_staff_trials WHERE organization_id=$1",
            [t.organizationId],
          ),
        )
      ).rows,
    ).toEqual([]);
  });
  it("grants one trial atomically for concurrent retries, audits expiry, and revokes without manufacturing a subscription", async () => {
    const staff = await trialStaff(),
      t = await target(false),
      input = trialGrant(t.billingAccountId),
      key = "trial-retry-" + suffix();
    const before = await app.get(staff, t.organizationId);
    const [a, b] = await Promise.all([
      app.act(staff, t.organizationId, input, before.etag, key),
      app.act(staff, t.organizationId, input, before.etag, key),
    ]);
    expect(a).toEqual(b);
    expect(a.trialId).toBeDefined();
    expect(a.creditUnits).toBe("100");
    const detail = await app.get(staff, t.organizationId);
    expect(detail.value.trial).toMatchObject({
      id: a.trialId,
      state: "active",
      creditUnits: "100",
      availableCreditUnits: "100",
    });
    expect(detail.value.account.subscriptionState).toBe("not-subscribed");
    expect(detail.value.history).toContainEqual(a);
    await expectCustomerCredits(t.organizationId, 100, 0);
    await expect(
      app.act(
        staff,
        t.organizationId,
        input,
        detail.etag,
        "trial-refill-" + suffix(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      app.act(staff, t.organizationId, input, before.etag, key + "x"),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    const revoke = {
      contractVersion: 1 as const,
      action: "revoke-trial" as const,
      trialId: requiredTrialId(a.trialId),
      confirmBillingAccountId: t.billingAccountId,
      reason: "Synthetic trial revocation",
    };
    const receipt = await app.act(
      staff,
      t.organizationId,
      revoke,
      detail.etag,
      "trial-revoke-" + suffix(),
    );
    expect(receipt.creditUnits).toBe("100");
    expect((await app.get(staff, t.organizationId)).value.trial).toMatchObject({
      state: "revoked",
      availableCreditUnits: "0",
    });
    await expectCustomerCredits(t.organizationId, 0, -100);
    expect(
      (
        await typed.query(
          sql(
            "SELECT 1 FROM organization_subscription_projections WHERE organization_id=$1",
            [t.organizationId],
          ),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      typed.query(
        sql(
          "UPDATE platform_staff_trials SET expires_at=expires_at+interval '1 day' WHERE organization_id=$1",
          [t.organizationId],
        ),
      ),
    ).rejects.toThrow();
  });
  it("refuses trial grants to paid accounts and preserves their subscription and ledger", async () => {
    const staff = await trialStaff(),
      t = await target(),
      before = await app.get(staff, t.organizationId);
    await expect(
      app.act(
        staff,
        t.organizationId,
        trialGrant(t.billingAccountId),
        before.etag,
        "trial-paid-" + suffix(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await app.get(staff, t.organizationId)).value.account).toEqual(
      before.value.account,
    );
    expect(
      (
        await typed.query(
          sql(
            "SELECT credit_grant_id FROM credit_grants WHERE organization_id=$1",
            [t.organizationId],
          ),
        )
      ).rows,
    ).toEqual([]);
  });
  it("rolls back trial access and credit issuance if immutable audit cannot commit", async () => {
    const staff = await trialStaff(),
      t = await target(false),
      before = await app.get(staff, t.organizationId);
    const failing: SqlDatabase = {
      query: (q) => typed.query(q),
      close: () => Promise.resolve(),
      transaction: (work) =>
        typed.transaction((tx) =>
          work({
            query: (q) => {
              if (
                q.text.startsWith("INSERT INTO platform_staff_account_actions")
              )
                throw Error("Synthetic audit failure");
              return tx.query(q);
            },
          }),
        ),
    };
    await expect(
      new PostgresStaffAccounts(failing).act(
        staff,
        t.organizationId,
        trialGrant(t.billingAccountId),
        before.etag,
        "trial-audit-" + suffix(),
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect((await app.get(staff, t.organizationId)).value).toEqual(
      before.value,
    );
    expect(
      (
        await typed.query(
          sql("SELECT 1 FROM platform_staff_trials WHERE organization_id=$1", [
            t.organizationId,
          ]),
        )
      ).rows,
    ).toEqual([]);
  });
  async function trialOperation(funding: "trial" | "staff" = "trial") {
    const staff = funding === "trial" ? await trialStaff() : await actor(),
      t = await target(false),
      before = await app.get(staff, t.organizationId);
    const receipt = await app.act(
      staff,
      t.organizationId,
      funding === "trial"
        ? trialGrant(t.billingAccountId)
        : { ...grant(t.billingAccountId), creditUnits: 100 },
      before.etag,
      "trial-operation-" + suffix(),
    );
    const customer = await actor(false),
      membershipId = "membership_" + suffix(),
      projectId = "project_" + suffix();
    await typed.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',true,cloudmarkup_authorization_v2_permissions('owner')) ON CONFLICT DO NOTHING",
        [t.organizationId],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
        [membershipId, t.organizationId, customer.principalId],
      ),
    );
    await typed.query(
      sql(
        "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic trial',$3)",
        [projectId, t.organizationId, customer.principalId],
      ),
    );
    const scope = {
      capabilities: permissionsForRole("owner"),
      correlationId: customer.correlationId,
      membershipId,
      organizationId: t.organizationId,
      principalId: customer.principalId,
      roleKey: "owner",
      sessionId: customer.sessionId,
    };
    const meter = new PostgresBetaAiCreditMeter(typed, typed);
    const identity: BetaAiCreditIdentity = {
      organizationId: t.organizationId,
      projectId,
      jobId: "trial_job_" + suffix(),
      purpose: "proposal",
      requestSha256: "d".repeat(64),
    };
    return { staff, t, receipt, customer, scope, meter, identity };
  }
  it("funds unsubscribed AI through audited staff credits, reservations, consumption and exhaustion without paid privileges", async () => {
    const f = await trialOperation("staff");
    const reads = createProductionCommercialReads({ database: typed });
    const summary = await reads.getCurrentPlanEntitlements(
      f.customer,
      f.t.organizationId,
    );
    expect(summary).toMatchObject({
      plan: { key: "staff-credits" },
      subscription: { state: "not-subscribed" },
      expensiveOperationsEnabled: true,
    });
    expect(summary).not.toHaveProperty("trial");
    expect(
      summary.entitlements
        .filter((entry) => entry.enabled)
        .map((entry) => entry.feature),
    ).toEqual(["ai-assisted-operations"]);
    await expect(
      new CurrentPlanRepositoryExportEntitlementPolicy(
        reads,
        "GitHub",
      ).authorize({
        principal: f.customer,
        organizationId: f.t.organizationId,
        projectId: f.identity.projectId,
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(
      (
        await typed.query(
          sql(
            "SELECT 1 FROM organization_subscription_projections WHERE organization_id=$1 UNION ALL SELECT 1 FROM platform_staff_trials WHERE organization_id=$1",
            [f.t.organizationId],
          ),
        )
      ).rows,
    ).toEqual([]);
    await expectCustomerCredits(f.t.organizationId, 100, 0);
    const expires = new Date(Date.now() + 3600000).toISOString();
    await f.meter.reserve(f.scope, f.identity, "100", "100", expires);
    expect(
      (await reads.getCreditOverview(f.customer, f.t.organizationId)).balance,
    ).toMatchObject({
      availableCreditUnits: 0,
      reservedCreditUnits: 100,
      settledCreditUnits: 0,
    });
    const nextIdentity = { ...f.identity, jobId: "staff_next_" + suffix() };
    await expect(
      f.meter.reserve(f.scope, nextIdentity, "1", "1", expires),
    ).rejects.toThrow();
    expect(await f.meter.claim(f.identity)).toBe("dispatch");
    await f.meter.record(f.identity, {
      outputObjectId: "object_synthetic_staff_credits",
      outputSha256: "f".repeat(64),
      usage: {
        inputTokens: 333333,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        providerRequestId: "synthetic-staff-credit-usage",
      },
    });
    expect(await f.meter.settle(f.identity)).toMatchObject({
      creditUnits: "100",
    });
    await f.meter.settle(f.identity);
    expect(
      (await reads.getCreditOverview(f.customer, f.t.organizationId)).balance,
    ).toMatchObject({
      availableCreditUnits: 0,
      reservedCreditUnits: 0,
      settledCreditUnits: 100,
      totalGrantedCreditUnits: 100,
    });
    await expect(
      f.meter.reserve(f.scope, nextIdentity, "1", "1", expires),
    ).rejects.toMatchObject({ code: "insufficient-credits" });
    const beforeRefill = await app.get(f.staff, f.t.organizationId);
    await app.act(
      f.staff,
      f.t.organizationId,
      { ...grant(f.t.billingAccountId), creditUnits: 100 },
      beforeRefill.etag,
      "staff-refill-" + suffix(),
    );
    await expectCustomerCredits(f.t.organizationId, 100, 0);
    expect(
      (await reads.getCurrentPlanEntitlements(f.customer, f.t.organizationId))
        .subscription.state,
    ).toBe("not-subscribed");
  });
  it("matches current Professional features/limits, admits both export targets and sharing, and fences revocation", async () => {
    const f = await trialOperation();
    const commercial = createProductionCommercialReads({ database: typed });
    const summary = await commercial.getCurrentPlanEntitlements(
      f.customer,
      f.t.organizationId,
    );
    expect(summary).toMatchObject({
      subscription: { state: "not-subscribed" },
      trial: { state: "active" },
      expensiveOperationsEnabled: true,
    });
    const profile = await typed.query(
      sql(
        "SELECT feature_key,entitlement_state FROM commercial_plan_feature_entitlements WHERE plan_version_id=$1 ORDER BY feature_key",
        [summary.plan.versionId],
      ),
    );
    const paid = await typed.query(
      sql(
        "SELECT feature_key,entitlement_state FROM commercial_plan_feature_entitlements WHERE plan_version_id='planver_pro_2026_09_30_v5' ORDER BY feature_key",
      ),
    );
    expect(profile.rows).toEqual(paid.rows);
    const trialLimits = await typed.query(
      sql(
        "SELECT limit_key,limit_scope,period_kind,limit_value::text FROM commercial_plan_numeric_limits WHERE plan_version_id=$1 ORDER BY limit_key",
        [summary.plan.versionId],
      ),
    );
    const paidLimits = await typed.query(
      sql(
        "SELECT limit_key,limit_scope,period_kind,limit_value::text FROM commercial_plan_numeric_limits WHERE plan_version_id='planver_pro_2026_09_30_v5' ORDER BY limit_key",
      ),
    );
    expect(trialLimits.rows).toEqual(paidLimits.rows);
    const repositoryPolicy = new CurrentPlanRepositoryExportEntitlementPolicy(
      commercial,
      "GitHub",
    );
    const owner = {
      organizationId: f.t.organizationId,
      projectId: f.identity.projectId,
    };
    await repositoryPolicy.authorize({ ...owner, principal: f.customer });
    const record = admissionSelectionFixture().initialRecord;
    const policies = [];
    for (const target of ["terraform", "cloudformation"] as const) {
      const settings =
        target === "terraform"
          ? TEST_TARGET_SETTINGS
          : workflowFixture("infrastructure-only", target).request
              .targetSettings;
      const policy = new PostgresSolutionExportTargetPolicy(
        new SolutionExportRequestAuthority(
          typed,
          f.customer,
          owner,
          "exports.run",
        ),
        settings,
      );
      const input = {
        principal: f.customer,
        organizationId: f.t.organizationId,
        targetProfileId:
          target === "terraform"
            ? ("cloudmarkup.export.terraform-nodejs24-v1" as const)
            : ("cloudmarkup.export.cloudformation-nodejs24-v1" as const),
        environment: record.job.target.environment,
        binding: {
          ...owner,
          solutionRevisionId: record.job.solutionRevision.solutionRevisionId,
          manifestRecordId: record.job.solutionRevision.manifestRecordId,
          manifestDigest: sha256DigestSchema.parse(
            record.job.solutionRevision.manifestDigest,
          ),
          applicationCodeRequired: false,
          generationCoverage: record.job.generationCoverage,
          workflowSources: record.workflowSubmission.request.sources,
        },
      };
      await expect(policy.evaluate(input)).resolves.toHaveProperty(
        "entitlementDecisionReference",
      );
      policies.push({ policy, input });
    }
    const invite = new PostgresOrganizationInvitationRepository(typed);
    const invitationInput = {
      organizationId: f.t.organizationId,
      role: "viewer" as const,
      tokenSha256: "a".repeat(64),
      requestSha256: "b".repeat(64),
      idempotencyKeySha256: "c".repeat(64),
    };
    await typed.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'viewer','authorization-v2',false,cloudmarkup_authorization_v2_permissions('viewer'))",
        [f.t.organizationId],
      ),
    );
    const invitation = await invite.create(f.customer, invitationInput);
    const recipient = await actor(false);
    await expect(
      invite.accept(recipient, invitation.id, invitationInput.tokenSha256),
    ).resolves.toMatchObject({ status: "accepted", role: "viewer" });
    const pending = await invite.create(f.customer, {
      ...invitationInput,
      idempotencyKeySha256: "f".repeat(64),
      tokenSha256: "e".repeat(64),
    });
    const pendingRecipient = await actor(false);
    const before = await app.get(f.staff, f.t.organizationId);
    await app.act(
      f.staff,
      f.t.organizationId,
      {
        contractVersion: 1,
        action: "revoke-trial",
        trialId: requiredTrialId(f.receipt.trialId),
        confirmBillingAccountId: f.t.billingAccountId,
        reason: "Synthetic feature revocation",
      },
      before.etag,
      "trial-features-" + suffix(),
    );
    await expect(
      repositoryPolicy.authorize({ ...owner, principal: f.customer }),
    ).rejects.toMatchObject({ code: "access_denied" });
    for (const { policy, input } of policies)
      await expect(policy.evaluate(input)).rejects.toThrow();
    await expect(
      invite.accept(pendingRecipient, pending.id, "e".repeat(64)),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      invite.create(f.customer, {
        ...invitationInput,
        idempotencyKeySha256: "d".repeat(64),
        tokenSha256: "e".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
  it("allows audited staff funds to supplement an existing trial AI budget without extending its access", async () => {
    const f = await trialOperation();
    const creditStaff = await actor();
    const before = await app.get(creditStaff, f.t.organizationId);
    const receipt = await app.act(
      creditStaff,
      f.t.organizationId,
      { ...grant(f.t.billingAccountId), creditUnits: 35 },
      before.etag,
      "trial-staff-supplement-" + suffix(),
    );
    const trial = (await app.get(creditStaff, f.t.organizationId)).value.trial;
    expect(trial).toEqual(before.value.trial);
    const expires = new Date(Date.now() + 3600000).toISOString();
    const reservation = await f.meter.reserve(
      f.scope,
      f.identity,
      "135",
      "135",
      expires,
    );
    const allocations = await typed.query(
      sql(
        "SELECT credit_grant_id,reserved_credit_units::text FROM credit_reservation_allocations WHERE organization_id=$1 AND reservation_id=$2 ORDER BY credit_reservation_allocations.reserved_credit_units DESC",
        [f.t.organizationId, reservation.reservationId],
      ),
    );
    expect(allocations.rows).toEqual([
      {
        credit_grant_id: f.receipt.creditGrantId,
        reserved_credit_units: "100",
      },
      { credit_grant_id: receipt.creditGrantId, reserved_credit_units: "35" },
    ]);
    await f.meter.release(f.identity);
    await expectCustomerCredits(f.t.organizationId, 135, 0);
    expect(
      (await app.get(creditStaff, f.t.organizationId)).value.trial,
    ).toEqual(trial);
  });
  it("caps trial spend at its own grant, blocks a revoked queued dispatch, and never revives held credits on release", async () => {
    const f = await trialOperation();
    const ledger = new PostgresCommercialPersistenceRepository(typed);
    await ledger.createCreditGrant(
      {
        authority: "internal-accounting",
        actorId: f.staff.principalId,
        organizationId: f.t.organizationId,
        correlationId: "synthetic-paid",
      },
      {
        creditGrantId: "paid_" + suffix(),
        ledgerEntryId: "ledger_" + suffix(),
        creditUnits: "500",
        grantKind: "promotional",
        startsAt: new Date().toISOString(),
        expirationPolicy: {
          kind: "does-not-expire",
          policyVersion: "synthetic-paid-v1",
        },
        grantPolicyVersion: "synthetic-paid-v1",
        chargingPolicyVersion: "synthetic-paid-v1",
        consumptionPriority: "1",
        idempotencyKey: "paid-history-" + suffix(),
        reasonCode: "synthetic.paid-history",
        safeReason: "Synthetic preserved paid allocation",
      },
    );
    const expires = new Date(Date.now() + 3600000).toISOString();
    await expect(
      f.meter.reserve(f.scope, f.identity, "101", "101", expires),
    ).rejects.toMatchObject({ code: "insufficient-credits" });
    await f.meter.reserve(f.scope, f.identity, "60", "60", expires);
    const before = await app.get(f.staff, f.t.organizationId);
    expect(before.value.trial).toMatchObject({
      availableCreditUnits: "40",
      reservedCreditUnits: "60",
    });
    await app.act(
      f.staff,
      f.t.organizationId,
      {
        contractVersion: 1,
        action: "revoke-trial",
        trialId: requiredTrialId(f.receipt.trialId),
        confirmBillingAccountId: f.t.billingAccountId,
        reason: "Synthetic held credit revocation",
      },
      before.etag,
      "revoke-held-" + suffix(),
    );
    await expect(f.meter.claim(f.identity)).rejects.toThrow("no longer active");
    // Direct old-worker state transition must also fail after canonical revocation.
    await expect(
      typed.query(
        sql(
          "UPDATE beta_ai_invocations SET state='dispatched',dispatched_at=clock_timestamp() WHERE organization_id=$1 AND job_id=$2",
          [f.t.organizationId, f.identity.jobId],
        ),
      ),
    ).rejects.toThrow("Trial dispatch authority expired or revoked");
    await f.meter.release(f.identity);
    expect(
      (await app.get(f.staff, f.t.organizationId)).value.trial,
    ).toMatchObject({
      state: "revoked",
      availableCreditUnits: "0",
      reservedCreditUnits: "0",
    });
    const plan = await createProductionCommercialReads({
      database: typed,
    }).getCurrentPlanEntitlements(f.customer, f.t.organizationId);
    expect(plan).toMatchObject({
      expensiveOperationsEnabled: false,
      subscription: { state: "not-subscribed" },
      trial: { state: "revoked" },
    });
    expect(
      (await app.get(f.staff, f.t.organizationId)).value.availableCreditUnits,
    ).toBe("0");
  });
  it("enforces elapsed trial expiry without cleanup and keeps staff funding independent of forbidden trial refills", async () => {
    const staff = await trialStaff(),
      t = await target(false),
      before = await app.get(staff, t.organizationId);
    const past = new Date(Date.now() - 2 * 86400000).toISOString();
    const aged: SqlDatabase = {
      query: (q) => typed.query(q),
      close: () => Promise.resolve(),
      transaction: (work) =>
        typed.transaction((tx) =>
          work({
            query: (q) =>
              tx.query(
                q.text.startsWith("SELECT to_char(clock_timestamp()")
                  ? sql("SELECT $1::text AS now", [past])
                  : q,
              ),
          }),
        ),
    };
    await new PostgresStaffAccounts(aged).act(
      staff,
      t.organizationId,
      { ...trialGrant(t.billingAccountId), expiresInDays: 1 },
      before.etag,
      "trial-expired-" + suffix(),
    );
    const after = await app.get(staff, t.organizationId);
    expect(after.value.trial).toMatchObject({
      state: "expired",
      availableCreditUnits: "0",
    });
    await expectCustomerCredits(t.organizationId, 0, 0);
    await expect(
      app.act(
        staff,
        t.organizationId,
        trialGrant(t.billingAccountId),
        after.etag,
        "trial-no-refill-" + suffix(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await typed.query(
          sql("SELECT cloudmarkup_staff_trial_current_v1($1,$2) AS allowed", [
            t.organizationId,
            t.billingAccountId,
          ]),
        )
      ).rows[0]?.["allowed"],
    ).toBe(false);
    const creditStaff = await actor();
    const expired = await app.get(creditStaff, t.organizationId);
    await app.act(
      creditStaff,
      t.organizationId,
      { ...grant(t.billingAccountId), creditUnits: 100 },
      expired.etag,
      "staff-after-trial-" + suffix(),
    );
    const customer = await expectCustomerCredits(t.organizationId, 100, 0);
    const creditsOnly = await createProductionCommercialReads({
      database: typed,
    }).getCurrentPlanEntitlements(customer, t.organizationId);
    expect(creditsOnly).toMatchObject({
      plan: { key: "staff-credits" },
      expensiveOperationsEnabled: true,
      subscription: { state: "not-subscribed" },
    });
    expect(creditsOnly).not.toHaveProperty("trial");
  });
  it("paid conversion supersedes trial admission and trial revocation preserves paid access", async () => {
    const f = await trialOperation();
    await typed.query(
      sql(
        "INSERT INTO organization_subscription_projections(subscription_projection_id,organization_id,billing_account_id,billing_provider,provider_customer_reference,provider_subscription_reference,normalized_status,plan_version_id,billable_seat_quantity,effective_at,provider_environment) SELECT $3,$1,$2,'stripe',$4,$5,'active',v.plan_version_id,1,clock_timestamp(),'live' FROM commercial_plan_versions v JOIN commercial_plan_definitions d ON d.plan_id=v.plan_id WHERE d.plan_key='pro' ORDER BY v.version_number DESC LIMIT 1",
        [
          f.t.organizationId,
          f.t.billingAccountId,
          "projection_" + suffix(),
          "cus_" + suffix(),
          "sub_" + suffix(),
        ],
      ),
    );
    await typed.query(
      sql(
        "UPDATE organization_entitlement_snapshots e SET subscription_projection_id=s.subscription_projection_id,plan_version_id=s.plan_version_id,source_record_version=s.record_version,record_version=e.record_version+1 FROM organization_subscription_projections s WHERE e.organization_id=s.organization_id AND e.organization_id=$1",
        [f.t.organizationId],
      ),
    );
    const before = await app.get(f.staff, f.t.organizationId);
    expect(before.value.trial?.state).toBe("superseded");
    const reads = createProductionCommercialReads({ database: typed }),
      paid = await reads.getCurrentPlanEntitlements(
        f.customer,
        f.t.organizationId,
      );
    await app.act(
      f.staff,
      f.t.organizationId,
      {
        contractVersion: 1,
        action: "revoke-trial",
        trialId: requiredTrialId(f.receipt.trialId),
        confirmBillingAccountId: f.t.billingAccountId,
        reason: "Synthetic converted trial revocation",
      },
      before.etag,
      "revoke-converted-" + suffix(),
    );
    expect(
      await reads.getCurrentPlanEntitlements(f.customer, f.t.organizationId),
    ).toMatchObject({
      subscription: paid.subscription,
      plan: paid.plan,
      expensiveOperationsEnabled: true,
    });
  });
});
