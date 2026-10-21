import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FakeBillingProvider,
  type FakeBillingSessionRecord,
} from "./adapters/billing/fake-billing-provider.js";
import { runMigrations } from "./adapters/persistence/migrations.js";
import { loadHistoricalBetaMigrations } from "./adapters/persistence/historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./adapters/persistence/postgres-driver.js";
import { withDataApiTypes } from "./adapters/persistence/data-api-postgres-test-helpers.js";
import {
  sql,
  type SqlDatabase,
  type SqlStatement,
} from "./adapters/persistence/sql.js";
import {
  permissionsForRole,
  type OrganizationRole,
} from "./application/authorization.js";
import {
  createBillingConfiguration,
  type CreateHostedCheckoutInput,
  type CreateHostedPortalInput,
} from "./application/billing.js";
import type { BillingCheckoutSession } from "./application/billing-checkout.js";
import type { PrincipalContext } from "./application/ports.js";
import { createProductionBillingWorkspace } from "./production-billing-workspace.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = "cm_billing_workspace_it_" + runId;
const schemaMarker =
  "CloudMarkup synthetic billing workspace integration " + runId;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
const now = new Date("2026-09-05T12:00:00.000Z");

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
      "Billing workspace tests accept only a loopback database without overrides.",
    );
  return configuredUrl;
}

type Boundary = "checkout" | "retrieve" | "portal";
interface ProviderState {
  readonly calls: Boundary[];
  readonly authorizations: Boundary[];
  readonly sessions: Map<string, BillingCheckoutSession>;
  readonly creations: FakeBillingSessionRecord[];
  readonly portalInputs: CreateHostedPortalInput[];
  beforeRequest?: (boundary: Boundary) => Promise<void>;
  afterRequest?: (boundary: Boundary) => Promise<void>;
}

/** Only external transport is synthetic; the production factory, authority,
 * metadata, account bootstrap, Checkout guard, transaction and audit SQL are real. */
class SyntheticProvider extends FakeBillingProvider {
  override readonly checkoutSnapshots: Map<string, BillingCheckoutSession>;
  override readonly checkoutSessions: FakeBillingSessionRecord[];
  readonly #authorize: () => Promise<void>;
  readonly #state: ProviderState;
  constructor(authorize: () => Promise<void>, state: ProviderState) {
    super();
    this.#authorize = authorize;
    this.#state = state;
    this.checkoutSnapshots = state.sessions;
    this.checkoutSessions = state.creations;
  }
  async #before(boundary: Boundary) {
    await this.#state.beforeRequest?.(boundary);
    await this.#authorize();
    this.#state.authorizations.push(boundary);
    this.#state.calls.push(boundary);
  }
  override async createCheckoutSession(input: CreateHostedCheckoutInput) {
    await this.#before("checkout");
    const original = await super.createCheckoutSession(input);
    const result = {
      ...original,
      url:
        "https://checkout.stripe.com/c/pay/" +
        original.providerSessionReference,
    };
    this.checkoutSnapshots.set(result.providerSessionReference, result);
    await this.#state.afterRequest?.("checkout");
    return result;
  }
  override async getCheckoutSession(input: {
    readonly billingAccountId: string;
    readonly organizationId: string;
    readonly providerSessionReference: string;
  }) {
    await this.#before("retrieve");
    return super.getCheckoutSession(input);
  }
  override async createPortalSession(input: CreateHostedPortalInput) {
    await this.#before("portal");
    this.#state.portalInputs.push(input);
    await this.#state.afterRequest?.("portal");
    return { url: "https://billing.stripe.com/p/session/synthetic" };
  }
}

integrationDescribe(
  "production Billing workspace on isolated loopback PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_billing_workspace_it_[a-f0-9]{32}$/u.test(schemaName))
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
        max: 6,
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
            !/^cm_billing_workspace_it_[a-f0-9]{32}$/u.test(schemaName)
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

    async function fixture(role: OrganizationRole = "owner", enabled = true) {
      const organizationId = id("org");
      const membershipId = id("membership");
      const principal: PrincipalContext = {
        principalId: id("principal"),
        sessionId: id("session"),
        correlationId: id("correlation"),
        authenticatedAt: now.toISOString(),
        expiresAt: "2026-09-05T13:00:00.000Z",
        authenticationSource: "test",
      };
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic Billing workspace')",
            [principal.principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic Billing workspace',$2)",
            [organizationId, organizationId.replaceAll("_", "-")],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES ($1,$2::text,'authorization-v2',$3,cloudmarkup_authorization_v2_permissions($2::text))",
            [organizationId, role, role === "owner"],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,$4)",
            [membershipId, organizationId, principal.principalId, role],
          ),
        );
      });
      const statements: SqlStatement[] = [];
      const tracked: SqlDatabase = {
        close: () => Promise.resolve(),
        query: (statement) => {
          statements.push(statement);
          return database.query(statement);
        },
        transaction: (work) =>
          database.transaction((tx) =>
            work({
              query: (statement) => {
                statements.push(statement);
                return tx.query(statement);
              },
            }),
          ),
      };
      const provider: ProviderState = {
        calls: [],
        authorizations: [],
        creations: [],
        portalInputs: [],
        sessions: new Map(),
      };
      const configuration = createBillingConfiguration({
        mode: "stripe-sandbox",
        stripeEnvironment: "test",
        cancelUrl: "https://beta.example.test/settings/billing?canceled",
        successUrl: "https://beta.example.test/settings/billing?returned",
        portalReturnUrl: "https://beta.example.test/settings/billing",
        portalConfigurationReference: "bpc_synthetic_workspace",
        starterPriceReference: "price_workspace_starter",
        starterProductReference: "prod_workspace_starter",
        proPriceReference: "price_workspace_pro",
        proProductReference: "prod_workspace_pro",
      });
      const app = createProductionBillingWorkspace({
        database: withDataApiTypes(tracked),
        clock: () => now,
        ...(enabled
          ? {
              sessions: {
                configuration,
                createProvider: (authorize: () => Promise<void>) =>
                  new SyntheticProvider(authorize, provider),
              },
            }
          : {}),
      });
      const checkout = (
        key = "checkout-workspace-0001",
        actor = principal,
        org = organizationId,
      ) =>
        app.createCheckout(
          actor,
          org,
          { contractVersion: 1, planKey: "starter" },
          key,
        );
      return {
        app,
        checkout,
        membershipId,
        organizationId,
        principal,
        provider,
        statements,
      };
    }

    async function counts(organizationId: string) {
      return (
        await database.query(
          sql(
            "SELECT (SELECT COUNT(*)::TEXT FROM organization_billing_accounts WHERE organization_id=$1) AS accounts," +
              " (SELECT COUNT(*)::TEXT FROM billing_checkout_attempts WHERE organization_id=$1) AS attempts," +
              " (SELECT COUNT(*)::TEXT FROM audit_events WHERE organization_id=$1) AS audits," +
              " (SELECT COUNT(*)::TEXT FROM credit_grants WHERE organization_id=$1) AS grants," +
              " (SELECT COUNT(*)::TEXT FROM organization_entitlement_snapshots WHERE organization_id=$1) AS entitlements," +
              " (SELECT COUNT(*)::TEXT FROM usage_ledger_entries WHERE organization_id=$1) AS ledger",
            [organizationId],
          ),
        )
      ).rows[0];
    }

    async function subscribedAccount(organizationId: string) {
      const billingAccountId = id("billing");
      const customer = id("cus");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO organization_billing_accounts(billing_account_id,organization_id) VALUES ($1,$2)",
            [billingAccountId, organizationId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_subscription_projections(subscription_projection_id,organization_id,billing_account_id,billing_provider,provider_customer_reference,provider_subscription_reference,normalized_status,plan_version_id,billable_seat_quantity,effective_at) VALUES ($1,$2,$3,'stripe',$4,$5,'active','planver_pro_2026_08_14_v2',1,$6)",
            [
              id("subscription"),
              organizationId,
              billingAccountId,
              customer,
              id("sub"),
              now.toISOString(),
            ],
          ),
        );
      });
      return { billingAccountId, customer };
    }

    it("reads an unprovisioned organization without writes, trial, credits or a fallback paid plan", async () => {
      const f = await fixture();
      await expect(
        f.app.getWorkspace(f.principal, f.organizationId),
      ).resolves.toMatchObject({
        accountState: "unprovisioned",
        subscriptionState: "not-subscribed",
        currentPlanKey: null,
        mode: "stripe-sandbox",
        canCheckout: true,
        canManage: false,
      });
      expect(
        f.statements.every((statement) =>
          statement.text.trimStart().startsWith("SELECT"),
        ),
      ).toBe(true);
      expect(await counts(f.organizationId)).toEqual({
        accounts: "0",
        attempts: "0",
        audits: "0",
        grants: "0",
        entitlements: "0",
        ledger: "0",
      });
      expect(f.provider.calls).toHaveLength(0);
    });

    it("idempotently bootstraps one account and persists one guarded session plus exact audits", async () => {
      const f = await fixture();
      const [first, concurrent] = await Promise.all([
        f.checkout(),
        f.checkout(),
      ]);
      const replay = await f.checkout();
      expect(first).toEqual(concurrent);
      expect(first).toEqual(replay);
      expect(first).toMatchObject({
        contractVersion: 1,
        organizationId: f.organizationId,
        kind: "checkout",
      });
      expect(f.provider.creations).toHaveLength(1);
      expect(f.provider.calls).toEqual(f.provider.authorizations);
      expect(f.provider.calls).toContain("retrieve");
      expect(await counts(f.organizationId)).toEqual({
        accounts: "1",
        attempts: "1",
        audits: "3",
        grants: "0",
        entitlements: "0",
        ledger: "0",
      });
      const audits = await database.query(
        sql(
          "SELECT actor_principal_id,correlation_id,action,outcome,target_kind FROM audit_events WHERE organization_id=$1",
          [f.organizationId],
        ),
      );
      expect(audits.rows).toHaveLength(3);
      for (const audit of audits.rows)
        expect(audit).toEqual({
          actor_principal_id: f.principal.principalId,
          correlation_id: f.principal.correlationId,
          action: "billing.checkout.create",
          outcome: "succeeded",
          target_kind: "billing-account",
        });
      const createsBeforeRemount = f.provider.calls.filter(
        (call) => call === "checkout",
      ).length;
      await expect(
        f.checkout("checkout-workspace-different"),
      ).resolves.toMatchObject({
        kind: "checkout",
        organizationId: f.organizationId,
      });
      expect(
        f.provider.calls.filter((call) => call === "checkout"),
      ).toHaveLength(createsBeforeRemount);
      expect(f.provider.calls.at(-1)).toBe("retrieve");
      expect((await counts(f.organizationId))?.["attempts"]).toBe("1");
      expect(f.provider.creations).toHaveLength(1);
    });

    it.each(["owner", "administrator", "editor", "viewer"] as const)(
      "reads canonical %s capabilities through the Data API text projection",
      async (role) => {
        const f = await fixture(role);
        const row = await database.query(
          sql(
            "SELECT to_json(capabilities)::TEXT AS capabilities_json FROM organization_roles WHERE organization_id=$1 AND role_key=$2",
            [f.organizationId, role],
          ),
        );
        const capabilities = row.rows[0]?.["capabilities_json"];
        expect(typeof capabilities).toBe("string");
        expect(new Set(JSON.parse(capabilities as string) as string[])).toEqual(
          new Set(permissionsForRole(role)),
        );
        const workspace = await f.app.getWorkspace(
          f.principal,
          f.organizationId,
        );
        expect(workspace.currentPlanKey).toBeNull();
        expect(workspace.canCheckout).toBe(
          role === "owner" || role === "administrator",
        );
      },
    );

    it("denies viewer, cross-tenant, stale and expired sessions before provisioning or provider access", async () => {
      const viewer = await fixture("viewer");
      await expect(viewer.checkout()).rejects.toMatchObject({
        code: "access_denied",
      });
      const f = await fixture();
      const other = await fixture();
      await expect(
        f.checkout("checkout-cross-0001", f.principal, other.organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        f.checkout("checkout-stale-0001", {
          ...f.principal,
          authenticatedAt: "2026-09-05T11:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "access_denied" });
      await expect(
        f.checkout("checkout-expired-0001", {
          ...f.principal,
          expiresAt: now.toISOString(),
        }),
      ).rejects.toMatchObject({ code: "authentication_required" });
      for (const target of [viewer, f, other]) {
        expect((await counts(target.organizationId))?.["accounts"]).toBe("0");
        expect(target.provider.calls).toHaveLength(0);
      }
    });

    it("rechecks identity at the injected transport callback without holding SQL locks over provider preparation", async () => {
      const f = await fixture();
      f.provider.beforeRequest = async () => {
        // The provider wrapper already authorized; this statement would time out
        // if that authorization retained its row lock over provider preparation.
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
      };
      await expect(f.checkout()).rejects.toMatchObject({ code: "not_found" });
      expect(f.provider.calls).toHaveLength(0);
      expect(f.provider.authorizations).toHaveLength(0);
      const state = await database.query(
        sql(
          "SELECT lifecycle_status,provider_session_reference FROM billing_checkout_attempts WHERE organization_id=$1",
          [f.organizationId],
        ),
      );
      expect(state.rows).toEqual([
        { lifecycle_status: "pending", provider_session_reference: null },
      ]);
      const audit = await database.query(
        sql("SELECT outcome FROM audit_events WHERE organization_id=$1", [
          f.organizationId,
        ]),
      );
      expect(audit.rows).toEqual([{ outcome: "failed" }]);
    });

    it("retains unknown external effects when membership is revoked and recovers the durable attempt from a new browser", async () => {
      const f = await fixture();
      f.provider.afterRequest = async () => {
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
      };
      await expect(f.checkout()).rejects.toMatchObject({ code: "not_found" });
      expect(f.provider.creations).toHaveLength(1);
      expect((await counts(f.organizationId))?.["attempts"]).toBe("1");
      delete f.provider.afterRequest;
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='active' WHERE membership_id=$1",
          [f.membershipId],
        ),
      );
      await f.checkout("checkout-restored-new-browser-0002");
      expect(f.provider.creations).toHaveLength(1);
      expect(f.provider.calls).toEqual(f.provider.authorizations);
    });

    it("reports active paid state truthfully, uses its exact customer for Portal, and prevents Checkout for closed accounts", async () => {
      const f = await fixture();
      const { customer } = await subscribedAccount(f.organizationId);
      await expect(
        f.app.getWorkspace(f.principal, f.organizationId),
      ).resolves.toMatchObject({
        accountState: "active",
        currentPlanKey: "pro",
        subscriptionState: "active",
        canCheckout: false,
        canManage: true,
      });
      await expect(f.checkout()).rejects.toMatchObject({
        code: "invalid_request",
      });
      const portal = await f.app.createPortal(
        f.principal,
        f.organizationId,
        "portal-workspace-0001",
      );
      expect(portal).toMatchObject({
        kind: "portal",
        organizationId: f.organizationId,
      });
      expect(f.provider.portalInputs[0]?.providerCustomerReference).toBe(
        customer,
      );
      expect(f.provider.portalInputs[0]?.returnUrl).toBe(
        "https://beta.example.test/organizations/" +
          f.organizationId +
          "/billing",
      );
      await database.query(
        sql(
          "UPDATE organization_billing_accounts SET lifecycle_status='closed',expensive_operations_enabled=FALSE WHERE organization_id=$1",
          [f.organizationId],
        ),
      );
      await expect(
        f.app.getWorkspace(f.principal, f.organizationId),
      ).resolves.toMatchObject({
        accountState: "closed",
        currentPlanKey: "pro",
        subscriptionState: "active",
        canCheckout: false,
        canManage: false,
      });
      await expect(f.checkout("checkout-closed-0001")).rejects.toMatchObject({
        code: "not_found",
      });
      expect(f.provider.creations).toHaveLength(0);
    });

    it.each([
      ["beforeRequest", "suspended"],
      ["beforeRequest", "closed"],
      ["beforeRequest", "customer"],
      ["afterRequest", "suspended"],
      ["afterRequest", "closed"],
      ["afterRequest", "customer"],
    ] as const)(
      "denies Portal when %s changes %s, retaining only a safe failed audit",
      async (timing, change) => {
        const f = await fixture();
        await subscribedAccount(f.organizationId);
        f.provider[timing] = async (boundary) => {
          expect(boundary).toBe("portal");
          if (change === "customer") {
            await database.query(
              sql(
                "UPDATE organization_subscription_projections SET provider_customer_reference=$2,record_version=record_version+1 WHERE organization_id=$1",
                [f.organizationId, id("cus")],
              ),
            );
          } else {
            await database.query(
              sql(
                "UPDATE organization_billing_accounts SET lifecycle_status=$2,expensive_operations_enabled=FALSE,record_version=record_version+1 WHERE organization_id=$1",
                [f.organizationId, change],
              ),
            );
          }
        };
        await expect(
          f.app.createPortal(f.principal, f.organizationId, "portal-race-0001"),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(f.provider.calls).toHaveLength(
          timing === "beforeRequest" ? 0 : 1,
        );
        expect(f.provider.calls).toEqual(f.provider.authorizations);
        const audits = await database.query(
          sql(
            "SELECT action,outcome,target_kind,safe_summary FROM audit_events WHERE organization_id=$1",
            [f.organizationId],
          ),
        );
        expect(audits.rows).toEqual([
          {
            action: "billing.portal.create",
            outcome: "failed",
            target_kind: "billing-account",
            safe_summary:
              "Created a short-lived hosted billing Portal session.",
          },
        ]);
        expect((await counts(f.organizationId))?.["grants"]).toBe("0");
      },
    );

    it("keeps disabled production sessions read-only and unprovisioned", async () => {
      const f = await fixture("owner", false);
      await expect(f.checkout()).rejects.toMatchObject({
        code: "service_unavailable",
      });
      expect((await counts(f.organizationId))?.["accounts"]).toBe("0");
      expect(f.provider.calls).toHaveLength(0);
    });
  },
);
