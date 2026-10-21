import { createProductionCommercialReads } from "../../production-commercial-reads.js";
import { createGuardedCreditTopUp } from "../../application/billing-top-ups.js";
import { PostgresBillingPersistence } from "./billing-persistence.js";
import { createProductionCreditTopUps } from "../../production-credit-top-ups.js";
import { createBillingConfiguration } from "../../application/billing.js";
import { FakeBillingProvider } from "../billing/fake-billing-provider.js";
import { createCreditTopUpWebhookProcessor } from "../billing/top-up-webhook.js";
import type {
  CreditTopUpProvider,
  CreditTopUpPurchase,
} from "../../application/billing-top-ups.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BETA_CREDIT_PRO_PLAN_ID,
  CREDIT_TOP_UP_PACKS_V1,
  CREDIT_TOP_UP_POLICY_VERSION,
} from "@cloudmarkup/domain";
import { permissionsForRole } from "../../application/authorization.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type {
  CreditTopUpAttempt,
  CreditTopUpSession,
} from "../../application/billing-top-ups.js";
import { PostgresCreditTopUpPersistence } from "./credit-top-up-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql, type SqlDatabase, type SqlRow } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const suite = configured ? describe : describe.skip;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
const schema = id("cm_topup_test"),
  marker = "CloudMarkup synthetic top-up integration";
suite("durable credit purchases on isolated local PostgreSQL", () => {
  let admin: PostgresDatabase | undefined,
    db: PostgresDatabase | undefined,
    typed: SqlDatabase;
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash
    )
      throw Error("Loopback synthetic database required");
    admin = new PostgresDatabase({ connectionString: configured, max: 1 });
    await admin.query(sql(`CREATE SCHEMA "${schema}"`));
    await admin.query(
      sql(
        `COMMENT ON SCHEMA "${schema}" IS 'CloudMarkup synthetic top-up integration'`,
      ),
    );
    db = new PostgresDatabase({
      connectionString: configured,
      max: 6,
      options: `-c search_path=${schema} -c timezone=UTC -c statement_timeout=5000`,
    });
    typed = withDataApiTypes(db);
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(db, migrations);
    await runMigrations(db, migrations);
  }, 120000);
  afterAll(async () => {
    await db?.close();
    if (admin) {
      try {
        const found = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          ),
        );
        if (
          found.rows[0]?.["marker"] !== marker ||
          !/^cm_topup_test_[a-f0-9]{32}$/u.test(schema)
        )
          throw Error("Refusing to remove unverified schema");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      } finally {
        await admin.close();
      }
    }
  }, 30000);
  async function fixture(packKey: CreditTopUpAttempt["packKey"] = "small") {
    const scope: AuthorizedOrganizationScope = {
      capabilities: permissionsForRole("owner"),
      roleKey: "owner",
      principalId: id("principal"),
      membershipId: id("membership"),
      organizationId: id("org"),
      sessionId: id("session"),
      correlationId: id("correlation"),
    };
    await typed.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic top-up')",
          [scope.principalId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic top-up',$2)",
          [scope.organizationId, scope.organizationId.replaceAll("_", "-")],
        ),
      );
      for (const role of ["owner", "viewer"])
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES ($1,$2,'authorization-v2',$3,cloudmarkup_authorization_v2_permissions($2))",
            [scope.organizationId, role, role === "owner"],
          ),
        );
      await tx.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,'owner')",
          [scope.membershipId, scope.organizationId, scope.principalId],
        ),
      );
    });
    const commercial = new PostgresCommercialPersistenceRepository(typed);
    const context = {
      authority: "internal-administration" as const,
      actorId: "synthetic-top-up-admin",
      actorPrincipalId: scope.principalId,
      organizationId: scope.organizationId,
      correlationId: scope.correlationId,
    };
    const billingAccountId = id("billing"),
      providerCustomerReference = id("cus");
    await commercial.createBillingAccount(context, { billingAccountId });
    const now = new Date().toISOString();
    await commercial.updateSubscriptionProjection(context, {
      subscriptionProjectionId: id("projection"),
      billingProvider: "stripe",
      providerCustomerReference,
      providerSubscriptionReference: id("sub"),
      planVersionId: BETA_CREDIT_PRO_PLAN_ID,
      billableSeatQuantity: "1",
      cancelAtPeriodEnd: false,
      expectedRecordVersion: "0",
      normalizedStatus: "active",
      effectiveAt: now,
      currentPeriodId: id("period"),
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    const persistence = new PostgresCreditTopUpPersistence(typed);
    const input = (key = "a") => ({
      attemptId: id("topup"),
      organizationId: scope.organizationId,
      billingAccountId,
      providerCustomerReference,
      packKey,
      policyVersion: CREDIT_TOP_UP_POLICY_VERSION,
      requestKeySha256: key.repeat(64),
      requestSha256: "c".repeat(64),
    });
    const claim = () => persistence.claim(scope, input());
    return { scope, persistence, input, claim, context, commercial };
  }
  function paid(attempt: CreditTopUpPurchase): CreditTopUpSession {
    return {
      purchase: attempt,
      providerSessionReference: "cs_test_" + attempt.attemptId,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: "complete",
      paymentStatus: "paid",
      providerPaymentReference: "pi_" + attempt.attemptId,
      url: null,
      paymentReview: "clear",
    };
  }
  async function grants(
    f: Awaited<ReturnType<typeof fixture>>,
  ): Promise<readonly SqlRow[]> {
    return (
      await typed.query(
        sql(
          "SELECT credit_units,expiration_policy_kind,expires_at,grant_kind FROM credit_grants WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      )
    ).rows;
  }
  it("serializes distinct request keys into one open account purchase", async () => {
    const f = await fixture();
    const result = await Promise.all([
      f.persistence.claim(f.scope, f.input("a")),
      f.persistence.claim(f.scope, f.input("b")),
    ]);
    expect(result[0].attemptId).toBe(result[1].attemptId);
    expect(
      (
        await typed.query(
          sql(
            "SELECT attempt_id FROM credit_top_up_attempts WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rows,
    ).toHaveLength(1);
  });
  it.each(CREDIT_TOP_UP_PACKS_V1)(
    "grants exactly $creditUnits non-expiring credits once under concurrent payment delivery",
    async (pack) => {
      const f = await fixture(pack.key),
        attempt = await f.claim(),
        session = paid(attempt);
      expect(
        await Promise.all([
          f.persistence.observeVerifiedPayment(attempt, session),
          f.persistence.observeVerifiedPayment(attempt, session),
        ]),
      ).toContain("duplicate");
      expect(await grants(f)).toEqual([
        {
          credit_units: String(pack.creditUnits),
          expiration_policy_kind: "does-not-expire",
          expires_at: null,
          grant_kind: "purchased",
        },
      ]);
      const ledger = await typed.query(
        sql(
          "SELECT granted_credit_units FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='grant'",
          [f.scope.organizationId],
        ),
      );
      expect(ledger.rows).toEqual([
        { granted_credit_units: String(pack.creditUnits) },
      ]);
      expect(await f.persistence.observeVerifiedPayment(attempt, session)).toBe(
        "duplicate",
      );
    },
  );
  it("retains unpaid completion without credits until payment succeeds", async () => {
    const f = await fixture(),
      attempt = await f.claim(),
      session = paid(attempt);
    await f.persistence.observeVerifiedPayment(attempt, {
      ...session,
      paymentStatus: "unpaid",
      providerPaymentReference: null,
      paymentReview: null,
    });
    expect(await grants(f)).toHaveLength(0);
    expect(await f.persistence.observeVerifiedPayment(attempt, session)).toBe(
      "applied",
    );
    expect(await grants(f)).toHaveLength(1);
  });
  it("rejects cross-tenant and missing-capability claims without writing a purchase", async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(
      f.persistence.claim(other.scope, f.input()),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
    await expect(
      f.persistence.claim({ ...f.scope, capabilities: [] }, f.input()),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
    await expect(
      f.persistence.claim(
        { ...f.scope, principalId: other.scope.principalId },
        f.input(),
      ),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(
      (
        await typed.query(
          sql(
            "SELECT attempt_id FROM credit_top_up_attempts WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("rejects a substituted account, customer or pack during payment fulfillment", async () => {
    const f = await fixture(),
      attempt = await f.claim(),
      session = paid(attempt);
    for (const purchase of [
      { ...attempt, billingAccountId: "foreign" },
      { ...attempt, providerCustomerReference: "cus_foreign" },
      { ...attempt, packKey: "large" as const },
    ]) {
      await expect(
        f.persistence.observeVerifiedPayment(attempt, { ...session, purchase }),
      ).rejects.toMatchObject({ code: "idempotency-conflict" });
    }
    expect(await grants(f)).toHaveLength(0);
  });
  it("rolls the ledger and purchase back together when receipt persistence fails", async () => {
    const f = await fixture(),
      attempt = await f.claim(),
      session = paid(attempt);
    const failing: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (statement) => typed.query(statement),
      transaction: (work) =>
        typed.transaction((tx) =>
          work({
            query: (statement) => {
              if (statement.text.includes("SET lifecycle_status='fulfilled'"))
                throw Error("synthetic receipt write failure");
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      new PostgresCreditTopUpPersistence(failing).observeVerifiedPayment(
        attempt,
        session,
      ),
    ).rejects.toThrow("synthetic receipt write failure");
    expect(await grants(f)).toHaveLength(0);
    expect(
      (await f.persistence.findForProvider({ attemptId: attempt.attemptId }))
        ?.state,
    ).toBe("pending");
    expect(await f.persistence.observeVerifiedPayment(attempt, session)).toBe(
      "applied",
    );
  });
  it.each(["refund", "dispute"] as const)(
    "withholds a %s before fulfillment and never reverses historical grants on later review",
    async (review) => {
      const first = await fixture(),
        attempt = await first.claim(),
        session = paid(attempt);
      expect(
        await first.persistence.observeVerifiedPayment(attempt, {
          ...session,
          paymentReview: review,
        }),
      ).toBe("rejected");
      expect(await grants(first)).toHaveLength(0);
      expect(
        await first.persistence.observeVerifiedPayment(attempt, session),
      ).toBe("rejected");
      const second = await fixture(),
        paidAttempt = await second.claim(),
        paidSession = paid(paidAttempt);
      await second.persistence.observeVerifiedPayment(paidAttempt, paidSession);
      expect(
        await second.persistence.observeVerifiedPayment(paidAttempt, {
          ...paidSession,
          paymentReview: review,
        }),
      ).toBe("rejected");
      expect(await grants(second)).toHaveLength(1);
      expect(
        (
          await second.persistence.findForProvider({
            attemptId: paidAttempt.attemptId,
          })
        )?.reviewReason,
      ).toBe(review);
    },
  );
  it("enforces immutable policy, durable unknown results and exact grant evidence in SQL", async () => {
    const f = await fixture(),
      attempt = await f.claim();
    for (const text of [
      "UPDATE credit_top_up_attempts SET credit_units=999,record_version=record_version+1 WHERE attempt_id=$1",
      "UPDATE credit_top_up_attempts SET request_sha256=repeat('d',64),record_version=record_version+1 WHERE attempt_id=$1",
      "DELETE FROM credit_top_up_attempts WHERE attempt_id=$1",
    ]) {
      await expect(
        typed.query(sql(text, [attempt.attemptId])),
      ).rejects.toThrow();
    }
    expect(
      (await f.persistence.findForProvider({ attemptId: attempt.attemptId }))
        ?.state,
    ).toBe("pending");
  });
  function workspace(f: Awaited<ReturnType<typeof fixture>>, enabled = true) {
    const now = new Date().toISOString();
    const principal = {
      principalId: f.scope.principalId,
      sessionId: f.scope.sessionId,
      correlationId: f.scope.correlationId,
      authenticatedAt: now,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      authenticationSource: "test" as const,
    };
    const sessions = new Map<string, CreditTopUpSession>();
    const hooks: { afterRequest?: () => Promise<void>; calls: number } = {
      calls: 0,
    };
    const provider = (authorize: () => Promise<void>) => {
      const topups: CreditTopUpProvider = {
        createCreditTopUpSession: async (input) => {
          await authorize();
          hooks.calls += 1;
          const session = sessions.get(input.purchase.attemptId) ?? {
            ...paid(input.purchase),
            status: "open" as const,
            paymentStatus: "unpaid" as const,
            providerPaymentReference: null,
            paymentReview: null,
            url: "https://checkout.stripe.com/c/pay/cs_test_example",
          };
          sessions.set(input.purchase.attemptId, session);
          await hooks.afterRequest?.();
          return session;
        },
        getCreditTopUpSession: async (input) => {
          await authorize();
          hooks.calls += 1;
          const session = sessions.get(input.purchase.attemptId);
          if (session === undefined) throw Error("Missing synthetic session");
          return session;
        },
      };
      return Object.assign(new FakeBillingProvider(), topups);
    };
    const configuration = createBillingConfiguration({
      mode: "stripe-sandbox",
      stripeEnvironment: "test",
      cancelUrl: "https://beta.example.test/billing",
      successUrl: "https://beta.example.test/billing?returned",
      portalReturnUrl: "https://beta.example.test/billing",
      portalConfigurationReference: "bpc_synthetic_topup",
      starterPriceReference: "price_starter",
      starterProductReference: "prod_starter",
      proPriceReference: "price_pro",
      proProductReference: "prod_pro",
    });
    const app = createProductionCreditTopUps({
      database: typed,
      sessions: {
        configuration,
        topUpsEnabled: enabled,
        createProvider: provider,
      },
    });
    return { app, principal, hooks, sessions, provider };
  }
  it("keeps the default purchase gate closed while exposing the approved catalog", async () => {
    const f = await fixture(),
      w = workspace(f, false);
    const view = await w.app.getCreditTopUps(
      w.principal,
      f.scope.organizationId,
    );
    expect(view).toMatchObject({
      mode: "disabled",
      canPurchase: false,
      availableCreditUnits: "0",
      latestPurchase: null,
    });
    expect(
      view.packs.map((pack) => [
        pack.creditUnits,
        pack.priceMicros,
        pack.expiration,
      ]),
    ).toEqual([
      [100, "5000000", "never"],
      [350, "15000000", "never"],
      [800, "30000000", "never"],
    ]);
    await expect(
      w.app.createCreditTopUp(
        w.principal,
        f.scope.organizationId,
        { contractVersion: 1, packKey: "small" },
        "topup-request-disabled",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(w.hooks.calls).toBe(0);
  });
  it("connects authorized Checkout, a delayed webhook, fulfillment and balance readback", async () => {
    const f = await fixture(),
      w = workspace(f);
    const created = await w.app.createCreditTopUp(
      w.principal,
      f.scope.organizationId,
      { contractVersion: 1, packKey: "medium" },
      "topup-request-enabled",
    );
    expect(created).toMatchObject({
      organizationId: f.scope.organizationId,
      kind: "checkout",
    });
    const pending = await w.app.getCreditTopUps(
      w.principal,
      f.scope.organizationId,
    );
    expect(pending.latestPurchase).toMatchObject({
      state: "created",
      packKey: "medium",
    });
    const attemptId = pending.latestPurchase?.id;
    if (attemptId === undefined) throw Error("Missing purchase");
    const attempt = await f.persistence.findForProvider({ attemptId });
    if (attempt === null) throw Error("Missing attempt");
    const original = w.sessions.get(attemptId);
    if (original === undefined) throw Error("Missing session");
    const process = createCreditTopUpWebhookProcessor({
      provider: w.provider(() => Promise.resolve()),
      persistence: f.persistence,
    });
    const event = {
      eventPosition: "00000000001790700000:evt_topup",
      eventType: "checkout.session.completed",
      occurredAt: new Date().toISOString(),
      payloadSha256: "a".repeat(64),
      providerEventReference: "evt_topup",
      supported: true,
      providerEventData: {
        object: "checkout.session",
        id: original.providerSessionReference,
        mode: "payment",
        metadata: { cloudmarkup_top_up_attempt: attemptId },
      },
    };
    await process(event);
    expect(await grants(f)).toHaveLength(0);
    w.sessions.set(attemptId, {
      ...original,
      status: "complete",
      paymentStatus: "paid",
      paymentReview: "clear",
      providerPaymentReference: "pi_" + attemptId,
      url: null,
    });
    expect(
      await process({
        ...event,
        eventType: "checkout.session.async_payment_succeeded",
      }),
    ).toMatchObject({ status: "applied" });
    expect(
      await process({
        ...event,
        eventType: "checkout.session.async_payment_succeeded",
      }),
    ).toMatchObject({ status: "duplicate" });
    const complete = await w.app.getCreditTopUps(
      w.principal,
      f.scope.organizationId,
    );
    expect(complete.availableCreditUnits).toBe("350");
    const reads = createProductionCommercialReads({ database: typed });
    const overview = await reads.getCreditOverview(
      w.principal,
      f.scope.organizationId,
    );
    expect(overview.balance).toMatchObject({
      availableCreditUnits: 350,
      totalGrantedCreditUnits: 350,
    });
    expect(overview.balance).not.toHaveProperty("ledgerThroughEventId");
    expect(overview.availableByKind).toEqual({
      monthly: 0,
      purchased: 350,
      other: 0,
    });
    const balance = await reads.getCreditBalance(
      w.principal,
      f.scope.organizationId,
    );
    expect(balance.availableCreditUnits).toBe(350);
    expect(balance).not.toHaveProperty("ledgerThroughEventId");
    expect(complete.latestPurchase).toMatchObject({
      state: "fulfilled",
      needsReview: false,
    });
  });
  it("withholds a hosted URL after revocation and reuses the retained attempt after reauthentication", async () => {
    const f = await fixture(),
      w = workspace(f);
    w.hooks.afterRequest = async () => {
      await typed.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [f.scope.membershipId],
        ),
      );
    };
    await expect(
      w.app.createCreditTopUp(
        w.principal,
        f.scope.organizationId,
        { contractVersion: 1, packKey: "small" },
        "topup-request-revoked",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(w.sessions.size).toBe(1);
    const rows = await typed.query(
      sql(
        "SELECT lifecycle_status,provider_session_reference FROM credit_top_up_attempts WHERE organization_id=$1",
        [f.scope.organizationId],
      ),
    );
    expect(rows.rows).toEqual([
      { lifecycle_status: "pending", provider_session_reference: null },
    ]);
    delete w.hooks.afterRequest;
    await typed.query(
      sql(
        "UPDATE memberships SET lifecycle_status='active' WHERE membership_id=$1",
        [f.scope.membershipId],
      ),
    );
    await expect(
      w.app.createCreditTopUp(
        w.principal,
        f.scope.organizationId,
        { contractVersion: 1, packKey: "small" },
        "topup-another-browser",
      ),
    ).resolves.toMatchObject({ kind: "checkout" });
    expect(w.sessions.size).toBe(1);
  });
  it("denies cross-account and stale-auth purchase creation before provider access", async () => {
    const f = await fixture(),
      other = await fixture(),
      w = workspace(f);
    await expect(
      w.app.createCreditTopUp(
        w.principal,
        other.scope.organizationId,
        { contractVersion: 1, packKey: "small" },
        "topup-cross-account",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      w.app.createCreditTopUp(
        { ...w.principal, authenticatedAt: "2000-01-01T00:00:00.000Z" },
        f.scope.organizationId,
        { contractVersion: 1, packKey: "small" },
        "topup-stale-auth",
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(w.hooks.calls).toBe(0);
  });
  it("releases only a provider-verified unpaid expiration before allowing another pack", async () => {
    const f = await fixture(),
      w = workspace(f);
    await w.app.createCreditTopUp(
      w.principal,
      f.scope.organizationId,
      { contractVersion: 1, packKey: "small" },
      "topup-expiration-first",
    );
    const entry = [...w.sessions.entries()][0];
    if (entry === undefined) throw Error("Missing session");
    w.sessions.set(entry[0], { ...entry[1], status: "expired", url: null });
    await expect(
      w.app.createCreditTopUp(
        w.principal,
        f.scope.organizationId,
        { contractVersion: 1, packKey: "medium" },
        "topup-expiration-new-key",
      ),
    ).resolves.toMatchObject({ kind: "checkout" });
    expect(w.sessions.size).toBe(2);
    expect(
      (await f.persistence.findForProvider({ attemptId: entry[0] }))?.state,
    ).toBe("expired");
    expect(await grants(f)).toHaveLength(0);
  });
  it("never replaces a completed payment while webhook fulfillment is pending", async () => {
    const f = await fixture(),
      w = workspace(f);
    await w.app.createCreditTopUp(
      w.principal,
      f.scope.organizationId,
      { contractVersion: 1, packKey: "small" },
      "topup-paid-pending-first",
    );
    const entry = [...w.sessions.entries()][0];
    if (entry === undefined) throw Error("Missing session");
    w.sessions.set(entry[0], {
      ...entry[1],
      status: "complete",
      paymentStatus: "paid",
      paymentReview: "clear",
      providerPaymentReference: "pi_" + entry[0],
      url: null,
    });
    await expect(
      w.app.createCreditTopUp(
        w.principal,
        f.scope.organizationId,
        { contractVersion: 1, packKey: "small" },
        "topup-paid-pending-new-key",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(w.sessions.size).toBe(1);
    expect(await grants(f)).toHaveLength(0);
    expect(
      (await f.persistence.findForProvider({ attemptId: entry[0] }))?.state,
    ).toBe("created");
  });
  it("retains an unknown provider result after the safe idempotency retry window", async () => {
    const f = await fixture();
    let now = new Date(),
      calls = 0;
    const provider: CreditTopUpProvider = {
      createCreditTopUpSession: () => {
        calls += 1;
        return Promise.reject(new Error("Synthetic unknown provider result"));
      },
      getCreditTopUpSession: () =>
        Promise.reject(new Error("Unexpected session read")),
    };
    const request = (idempotencyKey: string) =>
      createGuardedCreditTopUp({
        scope: f.scope,
        packKey: "small",
        idempotencyKey,
        provider,
        persistence: f.persistence,
        getAccount: () =>
          new PostgresBillingPersistence(typed).getSessionAccount(f.scope),
        successUrl: "https://beta.example.test/billing?returned",
        cancelUrl: "https://beta.example.test/billing?canceled",
        now: () => now,
      });
    await expect(request("topup-unknown-first")).rejects.toThrow(
      "Synthetic unknown provider result",
    );
    now = new Date(now.getTime() + 24 * 3600000);
    await expect(
      request("topup-unknown-another-browser"),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    expect(calls).toBe(1);
    const rows = await typed.query(
      sql(
        "SELECT lifecycle_status,provider_session_reference FROM credit_top_up_attempts WHERE organization_id=$1",
        [f.scope.organizationId],
      ),
    );
    expect(rows.rows).toEqual([
      { lifecycle_status: "pending", provider_session_reference: null },
    ]);
  });
});
