import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FakeBillingProvider } from "./adapters/billing/fake-billing-provider.js";
import { PostgresBillingPersistence } from "./adapters/persistence/billing-persistence.js";
import { withDataApiTypes } from "./adapters/persistence/data-api-postgres-test-helpers.js";
import { runMigrations } from "./adapters/persistence/migrations.js";
import { loadHistoricalBetaMigrations } from "./adapters/persistence/historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./adapters/persistence/postgres-driver.js";
import { sql } from "./adapters/persistence/sql.js";
import {
  createGuardedCheckoutSession,
  type BillingCheckoutSession,
} from "./application/billing-checkout.js";
import { createBillingConfiguration } from "./application/billing.js";
import { permissionsForRole } from "./application/authorization.js";
import type { AuthorizedOrganizationScope } from "./application/persistence.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = "cm_checkout_it_" + runId;
const schemaMarker = "CloudMarkup synthetic Checkout integration " + runId;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");

function loopbackUrl(): string {
  if (configuredUrl === undefined || configuredUrl === "")
    throw new Error("Explicit loopback PostgreSQL URL required.");
  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error("Invalid PostgreSQL integration URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Checkout integration accepts only an explicit loopback database without overrides.",
    );
  return configuredUrl;
}

integrationDescribe(
  "durable Checkout guard on isolated loopback PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_checkout_it_[a-f0-9]{32}$/u.test(schemaName))
        throw new Error("Unsafe synthetic schema.");
      administration = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      await administration.transaction(async (tx) => {
        await tx.query(sql('CREATE SCHEMA "' + schemaName + '"'));
        await tx.query(
          sql(
            'COMMENT ON SCHEMA "' +
              schemaName +
              '" IS ' +
              "'" +
              schemaMarker +
              "'",
          ),
        );
      });
      createdSchema = true;
      database = new PostgresDatabase({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 5000,
        options:
          "-c search_path=" +
          schemaName +
          " -c timezone=UTC -c statement_timeout=5000",
      });
      opened = database;
      const migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../migrations", import.meta.url)),
      );
      await runMigrations(database, migrations);
      await runMigrations(database, migrations);
    }, 60000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (createdSchema && administration !== undefined) {
          const found = await administration.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schemaName],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== schemaMarker ||
            !/^cm_checkout_it_[a-f0-9]{32}$/u.test(schemaName)
          )
            throw new Error(
              "Refusing to remove an unverified synthetic schema.",
            );
          await administration.transaction(async (tx) => {
            await tx.query(sql('DROP SCHEMA "' + schemaName + '" CASCADE'));
          });
        }
      } finally {
        await administration?.close();
      }
    }, 30000);

    async function fixture() {
      const scope: AuthorizedOrganizationScope = {
        capabilities: permissionsForRole("owner"),
        correlationId: id("correlation"),
        membershipId: id("membership"),
        organizationId: id("organization"),
        principalId: id("principal"),
        roleKey: "owner",
        sessionId: id("session"),
      };
      const billingAccountId = id("billing");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic Checkout')",
            [scope.principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic Checkout',$2)",
            [scope.organizationId, scope.organizationId.replaceAll("_", "-")],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES ($1,'owner','authorization-v2',TRUE,cloudmarkup_authorization_v2_permissions('owner'))",
            [scope.organizationId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,'owner')",
            [scope.membershipId, scope.organizationId, scope.principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_billing_accounts(billing_account_id,organization_id) VALUES ($1,$2)",
            [billingAccountId, scope.organizationId],
          ),
        );
      });
      const persistence = new PostgresBillingPersistence(
        withDataApiTypes(database),
      );
      const claim = (key: string) => ({
        attemptId: id("checkout"),
        billingAccountId,
        requestKeySha256: key.repeat(64),
        requestSha256: "c".repeat(64),
      });
      const provider = new FakeBillingProvider();
      const configuration = createBillingConfiguration({
        mode: "fake",
        cancelUrl: "http://localhost:4173/settings/billing?canceled",
        successUrl: "http://localhost:4173/settings/billing?success",
        portalReturnUrl: "http://localhost:4173/settings/billing",
        starterPriceReference: "price_checkout_starter",
        starterProductReference: "prod_checkout_starter",
        proPriceReference: "price_checkout_pro",
        proProductReference: "prod_checkout_pro",
      });
      const checkout = (
        idempotencyKey: string,
        planKey: "starter" | "pro" = "starter",
      ) =>
        createGuardedCheckoutSession({
          configuration,
          idempotencyKey,
          now: () => new Date(),
          persistence,
          planKey,
          provider,
          scope,
        });
      return {
        scope,
        billingAccountId,
        persistence,
        claim,
        provider,
        checkout,
      };
    }

    it("serializes distinct keys and same-key retries into one open account attempt", async () => {
      const f = await fixture();
      const [first, second] = await Promise.all([
        f.persistence.claimCheckoutAttempt(f.scope, f.claim("a")),
        f.persistence.claimCheckoutAttempt(f.scope, f.claim("b")),
      ]);
      expect(first.attemptId).toBe(second.attemptId);
      const rows = await database.query(
        sql(
          "SELECT attempt_id FROM billing_checkout_attempts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(rows.rows).toHaveLength(1);
      await expect(
        f.persistence.claimCheckoutAttempt(
          f.scope,
          f.claim(first.requestKeySha256[0] ?? "a"),
        ),
      ).resolves.toEqual(first);
    });

    it("enforces unique open attempts, immutable request hashes and retained uncertain effects in SQL", async () => {
      const f = await fixture();
      const attempt = await f.persistence.claimCheckoutAttempt(
        f.scope,
        f.claim("a"),
      );
      await expect(
        database.query(
          sql(
            "INSERT INTO billing_checkout_attempts(attempt_id,organization_id,billing_account_id,request_key_sha256,request_sha256) VALUES ($1,$2,$3,$4,$5)",
            [
              id("checkout"),
              f.scope.organizationId,
              f.billingAccountId,
              "b".repeat(64),
              "c".repeat(64),
            ],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "UPDATE billing_checkout_attempts SET request_sha256=$2,record_version=record_version+1 WHERE attempt_id=$1",
            [attempt.attemptId, "d".repeat(64)],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql("DELETE FROM billing_checkout_attempts WHERE attempt_id=$1", [
            attempt.attemptId,
          ]),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "UPDATE billing_checkout_attempts SET lifecycle_status='expired',retired_at=clock_timestamp(),record_version=record_version+1 WHERE attempt_id=$1",
            [attempt.attemptId],
          ),
        ),
      ).rejects.toThrow();
    });

    it("denies cross-tenant and revoked membership claims before any attempt write", async () => {
      const f = await fixture();
      const other = await fixture();
      await expect(
        f.persistence.claimCheckoutAttempt(
          { ...f.scope, organizationId: other.scope.organizationId },
          f.claim("a"),
        ),
      ).rejects.toThrow();
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [f.scope.membershipId],
        ),
      );
      await expect(
        f.persistence.claimCheckoutAttempt(f.scope, f.claim("a")),
      ).rejects.toThrow();
      const rows = await database.query(
        sql(
          "SELECT attempt_id FROM billing_checkout_attempts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(rows.rows).toHaveLength(0);
    });

    it("does not hold SQL locks over the provider wait and denies completion after membership revocation", async () => {
      const f = await fixture();
      const create = f.provider.createCheckoutSession.bind(f.provider);
      f.provider.createCheckoutSession = async (input) => {
        const session = await create(input);
        // This would hit statement_timeout if the service retained its auth row lock.
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [f.scope.membershipId],
          ),
        );
        return session;
      };
      await expect(f.checkout("checkout-revocation-0001")).rejects.toThrow();
      const row = await database.query(
        sql(
          "SELECT lifecycle_status,provider_session_reference FROM billing_checkout_attempts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(row.rows).toEqual([
        { lifecycle_status: "pending", provider_session_reference: null },
      ]);
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='active' WHERE membership_id=$1",
          [f.scope.membershipId],
        ),
      );
      f.provider.createCheckoutSession = create;
      await f.checkout("checkout-revocation-new-browser-0002");
      expect(f.provider.checkoutSessions).toHaveLength(1);
    });

    it("resumes known same-plan sessions with GET only, blocks other plans until verified expiration, and never revives the retired key", async () => {
      const f = await fixture();
      const createSession = vi.spyOn(f.provider, "createCheckoutSession");
      const getSession = vi.spyOn(f.provider, "getCheckoutSession");
      const first = await f.checkout("checkout-expiry-0001");
      const session = [...f.provider.checkoutSnapshots.values()][0];
      if (session === undefined) throw new Error("Missing synthetic session");
      await expect(f.checkout("checkout-expiry-0002")).resolves.toEqual(first);
      expect(getSession).toHaveBeenCalledOnce();
      expect(getSession).toHaveBeenLastCalledWith({
        billingAccountId: f.billingAccountId,
        expectedPlanKey: "starter",
        organizationId: f.scope.organizationId,
        providerSessionReference: session.providerSessionReference,
      });
      expect(createSession).toHaveBeenCalledOnce();
      expect(f.provider.checkoutSessions).toHaveLength(1);
      await expect(
        f.checkout("checkout-other-plan-0003", "pro"),
      ).rejects.toMatchObject({ code: "idempotency-conflict" });
      expect(getSession).toHaveBeenCalledTimes(2);
      expect(createSession).toHaveBeenCalledOnce();
      const openAttempts = await database.query(
        sql(
          "SELECT lifecycle_status,provider_session_reference FROM billing_checkout_attempts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(openAttempts.rows).toEqual([
        {
          lifecycle_status: "created",
          provider_session_reference: session.providerSessionReference,
        },
      ]);
      f.provider.checkoutSnapshots.set(session.providerSessionReference, {
        ...session,
        status: "expired",
        url: null,
      });
      await f.checkout("checkout-expiry-0002");
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(f.provider.checkoutSessions).toHaveLength(2);
      await expect(f.checkout("checkout-expiry-0001")).rejects.toMatchObject({
        code: "idempotency-conflict",
      });
      const rows = await database.query(
        sql(
          "SELECT lifecycle_status FROM billing_checkout_attempts WHERE organization_id=$1 ORDER BY created_at",
          [f.scope.organizationId],
        ),
      );
      expect(rows.rows).toEqual([
        { lifecycle_status: "expired" },
        { lifecycle_status: "created" },
      ]);
    });

    it("rejects retirement without exact known provider evidence and allocates no credits", async () => {
      const f = await fixture();
      const attempt = await f.persistence.claimCheckoutAttempt(
        f.scope,
        f.claim("a"),
      );
      const session: BillingCheckoutSession = {
        billingAccountId: f.billingAccountId,
        organizationId: f.scope.organizationId,
        providerSessionReference: "cs_test_" + runId,
        expiresAt: "2026-09-06T12:00:00.000Z",
        status: "open",
        providerSubscriptionReference: null,
        url: "https://checkout.stripe.com/c/pay/test",
      };
      const created = await f.persistence.recordCheckoutSession(
        f.scope,
        attempt,
        session,
      );
      await expect(
        f.persistence.retireCheckoutAttempt(f.scope, created, {
          ...session,
          status: "complete",
          providerSubscriptionReference: "sub_unverified",
          url: null,
        }),
      ).rejects.toThrow();
      const grants = await database.query(
        sql(
          "SELECT credit_grant_id FROM credit_grants WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(grants.rows).toHaveLength(0);
    });
  },
);
