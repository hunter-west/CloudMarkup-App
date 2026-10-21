import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./adapters/persistence/migrations.js";
import { loadHistoricalBetaMigrations } from "./adapters/persistence/historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./adapters/persistence/postgres-driver.js";
import { PostgresCommercialPersistenceRepository } from "./adapters/persistence/commercial-repositories.js";
import {
  sql,
  type SqlDatabase,
  type SqlStatement,
} from "./adapters/persistence/sql.js";
import type { CreateCreditGrantInput } from "./application/commercial-persistence.js";
import type { OrganizationRole } from "./application/authorization.js";
import type { PrincipalContext } from "./application/ports.js";
import { createProductionCommercialReads } from "./production-commercial-reads.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = "cm_commercial_reads_it_" + runId;
const schemaMarker = "CloudMarkup synthetic credit read integration " + runId;
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
      "Credit read tests accept only a loopback database without overrides.",
    );
  return configuredUrl;
}

integrationDescribe(
  "production credit reads on isolated loopback PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_commercial_reads_it_[a-f0-9]{32}$/u.test(schemaName))
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
            !/^cm_commercial_reads_it_[a-f0-9]{32}$/u.test(schemaName)
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

    async function fixture(role: OrganizationRole = "owner") {
      const organizationId = id("org");
      const membershipId = id("membership");
      const principal: PrincipalContext = {
        principalId: id("principal"),
        sessionId: id("session"),
        correlationId: id("correlation"),
        authenticatedAt: "2026-09-05T08:00:00.000Z",
        expiresAt: "2026-09-05T13:00:00.000Z",
        authenticationSource: "test",
      };
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic credit reads')",
            [principal.principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic credit reads',$2)",
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
      let revokeAfterBalance = false;
      const tracked: SqlDatabase = {
        close: () => Promise.resolve(),
        query: (statement) => {
          statements.push(statement);
          return database.query(statement);
        },
        transaction: async (work) => {
          const statementOffset = statements.length;
          const result = await database.transaction((tx) =>
            work({
              query: (statement) => {
                statements.push(statement);
                return tx.query(statement);
              },
            }),
          );
          if (
            revokeAfterBalance &&
            statements
              .slice(statementOffset)
              .some(
                (statement) =>
                  statement.text.includes("WITH eligible_account") ||
                  statement.text.includes("AS subscription_record_version"),
              )
          ) {
            revokeAfterBalance = false;
            await database.query(
              sql(
                "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
                [membershipId],
              ),
            );
          }
          return result;
        },
      };
      return {
        organizationId,
        membershipId,
        principal,
        statements,
        revokeAfterRead: () => {
          revokeAfterBalance = true;
        },
        app: createProductionCommercialReads({
          database: tracked,
          clock: () => now,
        }),
      };
    }
    async function counts(organizationId: string) {
      return (
        await database.query(
          sql(
            "SELECT (SELECT COUNT(*)::TEXT FROM organization_billing_accounts WHERE organization_id=$1) AS accounts, (SELECT COUNT(*)::TEXT FROM credit_grants WHERE organization_id=$1) AS grants, (SELECT COUNT(*)::TEXT FROM usage_ledger_entries WHERE organization_id=$1) AS ledger, (SELECT COUNT(*)::TEXT FROM organization_entitlement_snapshots WHERE organization_id=$1) AS entitlements",
            [organizationId],
          ),
        )
      ).rows[0];
    }
    async function fund(f: Awaited<ReturnType<typeof fixture>>) {
      const billingAccountId = id("billing");
      await database.query(
        sql(
          "INSERT INTO organization_billing_accounts(billing_account_id,organization_id) VALUES ($1,$2)",
          [billingAccountId, f.organizationId],
        ),
      );
      const repository = new PostgresCommercialPersistenceRepository(database);
      await repository.createCreditGrant(
        {
          authority: "internal-accounting",
          actorId: id("synthetic_accounting"),
          correlationId: f.principal.correlationId,
          organizationId: f.organizationId,
        },
        {
          chargingPolicyVersion: "cloudmarkup-charging-and-failure-v1",
          consumptionPriority: "100",
          creditGrantId: id("grant"),
          creditUnits: "200",
          expirationPolicy: {
            kind: "does-not-expire",
            policyVersion: "synthetic-expiration-v1",
          },
          grantKind: "promotional",
          grantPolicyVersion: "synthetic-grant-v1",
          idempotencyKey: id("synthetic_grant_key"),
          ledgerEntryId: id("usage"),
          reasonCode: "test.synthetic-credit-read",
          sourceReference: id("synthetic_grant"),
          startsAt: "2020-01-01T00:00:00.000Z",
        },
      );
      return billingAccountId;
    }
    async function grant(
      f: Awaited<ReturnType<typeof fixture>>,
      overrides: Partial<CreateCreditGrantInput>,
    ) {
      if (
        overrides.grantKind === "monthly" &&
        overrides.subscriptionPeriod !== undefined
      ) {
        const period = overrides.subscriptionPeriod;
        await database.query(
          sql(
            "INSERT INTO organization_subscription_projections(subscription_projection_id,organization_id,billing_account_id,billing_provider,provider_customer_reference,provider_subscription_reference,normalized_status,plan_version_id,billable_seat_quantity,current_period_id,current_period_start,current_period_end,effective_at) SELECT $1,$2::text,billing_account_id,'stripe',$3,$4,'active',$5,1,$6,$7::timestamptz,$8::timestamptz,$7::timestamptz FROM organization_billing_accounts WHERE organization_id=$2::text ON CONFLICT (billing_account_id) DO UPDATE SET current_period_id=EXCLUDED.current_period_id,current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,record_version=organization_subscription_projections.record_version+1",
            [
              id("subscription"),
              f.organizationId,
              id("cus"),
              id("sub"),
              overrides.planVersionId ?? null,
              period.periodId,
              period.startsAt,
              period.endsAt,
            ],
          ),
        );
      }
      return new PostgresCommercialPersistenceRepository(
        database,
      ).createCreditGrant(
        {
          authority: "internal-accounting",
          actorId: id("synthetic_accounting"),
          correlationId: f.principal.correlationId,
          organizationId: f.organizationId,
        },
        {
          chargingPolicyVersion: "cloudmarkup-charging-and-failure-v1",
          consumptionPriority: "100",
          creditGrantId: id("grant"),
          creditUnits: "100",
          expirationPolicy: {
            kind: "does-not-expire",
            policyVersion: "synthetic-expiration-v1",
          },
          grantKind: "purchased",
          grantPolicyVersion: "synthetic-grant-v1",
          idempotencyKey: id("grant_key"),
          ledgerEntryId: id("usage"),
          reasonCode: "test.synthetic-overview",
          sourceReference: id("source"),
          startsAt: "2020-01-01T00:00:00.000Z",
          ...overrides,
        },
      );
    }
    it("projects mixed funding from all grants and retains purchased credits after monthly expiration", async () => {
      const f = await fixture();
      await fund(f);
      const tomorrow = new Date(Date.now() + 86400000).toISOString();
      const dayAfter = new Date(Date.now() + 172800000).toISOString();
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const monthly = (
        startsAt: string,
        endsAt: string,
      ): Partial<CreateCreditGrantInput> => ({
        grantKind: "monthly",
        creditUnits: "1250",
        planVersionId: "planver_pro_2026_09_30_v5",
        startsAt,
        expirationPolicy: {
          kind: "expires-at",
          expiresAt: endsAt,
          policyVersion: "synthetic-period-v1",
        },
        subscriptionPeriod: { periodId: id("period"), startsAt, endsAt },
      });
      await grant(f, monthly("2026-09-30T00:00:00.000Z", yesterday));
      await grant(f, {});
      // The previous allowance is expired; purchased and promotional funding survives.
      expect(
        await f.app.getCreditOverview(f.principal, f.organizationId),
      ).toMatchObject({
        balance: { availableCreditUnits: 300, expiredCreditUnits: 1250 },
        availableByKind: { monthly: 0, purchased: 100, other: 200 },
        nextExpiration: null,
      });
      await grant(f, monthly(yesterday, tomorrow));
      await grant(f, {
        grantKind: "promotional",
        creditUnits: "25",
        expirationPolicy: {
          kind: "expires-at",
          expiresAt: tomorrow,
          policyVersion: "synthetic-expiration-v1",
        },
      });
      await grant(f, { creditUnits: "800", startsAt: dayAfter });
      await grant(f, {
        creditUnits: "350",
        expirationPolicy: { kind: "unresolved" },
      });
      const before = await counts(f.organizationId);
      const overview = await f.app.getCreditOverview(
        f.principal,
        f.organizationId,
      );
      expect(overview).toMatchObject({
        balance: {
          availableCreditUnits: 1575,
          expiredCreditUnits: 1250,
          unresolvedCreditUnits: 350,
        },
        availableByKind: { monthly: 1250, purchased: 100, other: 225 },
        nextExpiration: { at: tomorrow, creditUnits: 1275 },
      });
      expect(await counts(f.organizationId)).toEqual(before);
      const foreign = await fixture();
      await expect(
        f.app.getCreditOverview(f.principal, foreign.organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
      f.revokeAfterRead();
      await expect(
        f.app.getCreditOverview(f.principal, f.organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    async function subscribe(f: Awaited<ReturnType<typeof fixture>>) {
      const billingAccountId = await fund(f);
      const subscriptionId = id("subscription");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO organization_subscription_projections(subscription_projection_id,organization_id,billing_account_id,billing_provider,provider_customer_reference,provider_subscription_reference,normalized_status,plan_version_id,billable_seat_quantity,effective_at) VALUES ($1,$2,$3,'stripe',$4,$5,'active','planver_pro_2026_08_14_v2',1,$6)",
            [
              subscriptionId,
              f.organizationId,
              billingAccountId,
              id("cus"),
              id("sub"),
              now.toISOString(),
            ],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_entitlement_snapshots(organization_id,entitlement_snapshot_id,billing_account_id,subscription_projection_id,plan_version_id,entitlement_policy_version,source_record_version,expensive_operations_enabled,effective_at) VALUES ($1,$2,$3,$4,'planver_pro_2026_08_14_v2','commercial-entitlements-v1',1,TRUE,$5)",
            [
              f.organizationId,
              id("entitlement"),
              billingAccountId,
              subscriptionId,
              now.toISOString(),
            ],
          ),
        );
      });
      return { billingAccountId, subscriptionId };
    }

    it.each(["owner", "administrator", "editor", "viewer"] as const)(
      "reads the canonical plan for an authorized %s without commercial writes",
      async (role) => {
        const f = await fixture(role);
        await subscribe(f);
        const before = await counts(f.organizationId);
        const plan = await f.app.getCurrentPlanEntitlements(
          f.principal,
          f.organizationId,
        );
        expect(plan).toMatchObject({
          contractVersion: 1,
          organizationId: f.organizationId,
          plan: {
            key: "pro",
            versionId: "planver_pro_2026_08_14_v2",
            version: 2,
          },
          subscription: { state: "active", projectionVersion: 1 },
        });
        expect(plan.entitlements).toContainEqual({
          feature: "github-export",
          enabled: true,
          source: "plan",
        });
        expect(
          plan.limits.every((limit) => Number.isSafeInteger(limit.maximum)),
        ).toBe(true);
        expect(await counts(f.organizationId)).toEqual(before);
        expect(
          f.statements.every((statement) =>
            /^(?:SELECT|WITH|SET TRANSACTION)\b/u.test(
              statement.text.trimStart(),
            ),
          ),
        ).toBe(true);
      },
    );

    it("does not invent a subscription or plan for an unprovisioned organization", async () => {
      const f = await fixture();
      const before = await counts(f.organizationId);
      await expect(
        f.app.getCurrentPlanEntitlements(f.principal, f.organizationId),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(await counts(f.organizationId)).toEqual(before);
    });

    it("reflects the account kill switch and rejects a stale subscription snapshot", async () => {
      const f = await fixture();
      const { billingAccountId, subscriptionId } = await subscribe(f);
      await database.query(
        sql(
          "UPDATE organization_billing_accounts SET expensive_operations_enabled=FALSE WHERE billing_account_id=$1",
          [billingAccountId],
        ),
      );
      expect(
        await f.app.getCurrentPlanEntitlements(f.principal, f.organizationId),
      ).toMatchObject({ expensiveOperationsEnabled: false });
      await database.query(
        sql(
          "UPDATE organization_subscription_projections SET record_version=2 WHERE subscription_projection_id=$1",
          [subscriptionId],
        ),
      );
      await expect(
        f.app.getCurrentPlanEntitlements(f.principal, f.organizationId),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });

    it("withholds plans for a foreign tenant, expired session, or membership revoked during the read", async () => {
      const f = await fixture();
      await subscribe(f);
      const foreign = await fixture();
      await expect(
        f.app.getCurrentPlanEntitlements(f.principal, foreign.organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        f.app.getCurrentPlanEntitlements(
          { ...f.principal, expiresAt: now.toISOString() },
          f.organizationId,
        ),
      ).rejects.toMatchObject({ code: "authentication_required" });
      f.revokeAfterRead();
      await expect(
        f.app.getCurrentPlanEntitlements(f.principal, f.organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it.each(["owner", "administrator", "editor", "viewer"] as const)(
      "reads zero for an authorized unprovisioned %s without any commercial writes",
      async (role) => {
        const f = await fixture(role);
        const before = await counts(f.organizationId);
        const balance = await f.app.getCreditBalance(
          f.principal,
          f.organizationId,
        );
        expect(balance).toMatchObject({
          availableCreditUnits: 0,
          reservedCreditUnits: 0,
          totalGrantedCreditUnits: 0,
          exhausted: true,
        });
        expect(balance.asOf).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
        );
        expect(await counts(f.organizationId)).toEqual(before);
        expect(before).toEqual({
          accounts: "0",
          grants: "0",
          ledger: "0",
          entitlements: "0",
        });
        expect(
          f.statements.every((s) =>
            /^(?:SELECT|WITH)\b/u.test(s.text.trimStart()),
          ),
        ).toBe(true);
      },
    );
    it("returns an actual persisted grant balance independently of a subscription and never mutates it", async () => {
      const f = await fixture();
      const billingAccountId = await fund(f);
      const before = await counts(f.organizationId);
      expect(
        await f.app.getCreditBalance(f.principal, f.organizationId),
      ).toMatchObject({
        availableCreditUnits: 200,
        activeGrantedCreditUnits: 200,
        totalGrantedCreditUnits: 200,
        reservedCreditUnits: 0,
        settledCreditUnits: 0,
        exhausted: false,
      });
      expect(await counts(f.organizationId)).toEqual(before);
      expect(before).toEqual({
        accounts: "1",
        grants: "1",
        ledger: "1",
        entitlements: "0",
      });
      for (const lifecycle of ["suspended", "closed"]) {
        await database.query(
          sql(
            "UPDATE organization_billing_accounts SET lifecycle_status=$2,expensive_operations_enabled=FALSE WHERE billing_account_id=$1",
            [billingAccountId, lifecycle],
          ),
        );
        expect(
          (await f.app.getCreditBalance(f.principal, f.organizationId))
            .availableCreditUnits,
        ).toBe(200);
      }
      expect(
        f.statements.every((s) =>
          /^(?:SELECT|WITH)\b/u.test(s.text.trimStart()),
        ),
      ).toBe(true);
    });
    it("rejects another tenant, an expired token and a revoked membership without zero substitutes", async () => {
      const f = await fixture();
      const other = await fixture();
      await expect(
        f.app.getCreditBalance(f.principal, other.organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        f.app.getCreditBalance(
          { ...f.principal, expiresAt: now.toISOString() },
          f.organizationId,
        ),
      ).rejects.toMatchObject({ code: "authentication_required" });
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [f.membershipId],
        ),
      );
      await expect(
        f.app.getCreditBalance(f.principal, f.organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(await counts(f.organizationId)).toEqual({
        accounts: "0",
        grants: "0",
        ledger: "0",
        entitlements: "0",
      });
    });
    it("withholds a completed balance after current membership was revoked between read and response", async () => {
      const f = await fixture();
      await fund(f);
      f.revokeAfterRead();
      await expect(
        f.app.getCreditBalance(f.principal, f.organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  },
);
