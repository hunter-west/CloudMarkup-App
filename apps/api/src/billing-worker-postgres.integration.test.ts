import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BETA_SHARING_EFFECTIVE_FROM,
  BETA_SHARING_PLAN_IDS,
  evaluateOrganizationSeatAdmissionV1,
  type MembershipSeatRecordV1,
} from "@cloudmarkup/domain";

import {
  STRIPE_PRO_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_REFERENCE,
  STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_STARTER_PRODUCT_REFERENCE,
} from "./adapters/billing/environment.js";
import {
  parseStripeBillingWebhookDelivery,
  STRIPE_API_VERSION,
  type StripeFetchImplementation,
} from "./adapters/billing/stripe-billing-provider.js";
import { PostgresBillingPersistence } from "./adapters/persistence/billing-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./adapters/persistence/commercial-repositories.js";
import { runMigrations } from "./adapters/persistence/migrations.js";
import { loadHistoricalBetaMigrations } from "./adapters/persistence/historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./adapters/persistence/postgres-driver.js";
import { withDataApiTypes } from "./adapters/persistence/data-api-postgres-test-helpers.js";
import { sql } from "./adapters/persistence/sql.js";
import {
  BILLING_PLAN_MAPPING_VERSION,
  BILLING_SHARING_PLAN_MAPPING_VERSION,
  BILLING_WEBHOOK_ENDPOINT_VERSION,
} from "./application/billing.js";
import { createProductionBillingWebhookWorker } from "./billing-worker.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = `cm_billing_worker_it_${runId}`;
const schemaMarker = `CloudMarkup synthetic billing worker integration ${runId}`;
const identifier = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;
const created = Date.parse("2026-09-05T12:00:00.000Z") / 1000;
const periodStart = Date.parse("2026-09-01T00:00:00.000Z") / 1000;
const periodEnd = Date.parse("2026-10-01T00:00:00.000Z") / 1000;
const queueArn =
  "arn:aws:sqs:us-east-1:111111111111:cloudmarkup-beta-billing-webhook.fifo";
const apiKeyArn =
  "arn:aws:secretsmanager:us-east-1:111111111111:secret:cloudmarkup/beta/stripe/api-key-Abc123";
const environment = {
  CLOUDMARKUP_BILLING_ENABLED: "true",
  CLOUDMARKUP_STRIPE_ENVIRONMENT: "test",
  CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_ARN: queueArn,
  CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: apiKeyArn,
  CLOUDMARKUP_DATABASE_ARN:
    "arn:aws:rds:us-east-1:111111111111:cluster:synthetic-billing-worker",
  CLOUDMARKUP_DATABASE_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:111111111111:secret:synthetic-db-Abc123",
  CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_synthetic_worker",
  CLOUDMARKUP_BILLING_CANCEL_URL:
    "https://beta.example.test/settings/billing?checkout=canceled",
  CLOUDMARKUP_BILLING_SUCCESS_URL:
    "https://beta.example.test/settings/billing?checkout=success",
  CLOUDMARKUP_BILLING_PORTAL_RETURN_URL:
    "https://beta.example.test/settings/billing",
  STRIPE_STARTER_PRICE_ID: STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_STARTER_PRODUCT_ID: STRIPE_STARTER_PRODUCT_REFERENCE,
  STRIPE_PRO_PRICE_ID: STRIPE_PRO_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_ID: STRIPE_PRO_PRODUCT_REFERENCE,
};

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
      "Billing integration accepts only an explicit loopback database without query or fragment overrides.",
    );
  return configuredUrl;
}

interface Account {
  readonly organizationId: string;
  readonly billingAccountId: string;
}

function providerFixture(
  account: Account,
  plan: "starter" | "pro" = "starter",
  period = { start: periodStart, end: periodEnd },
) {
  const invoiceId = identifier("in");
  const item = {
    current_period_start: period.start,
    current_period_end: period.end,
    id: identifier("si"),
    price: {
      currency: "usd",
      id:
        plan === "starter"
          ? STRIPE_STARTER_PRICE_REFERENCE
          : STRIPE_PRO_PRICE_REFERENCE,
      product:
        plan === "starter"
          ? STRIPE_STARTER_PRODUCT_REFERENCE
          : STRIPE_PRO_PRODUCT_REFERENCE,
      recurring: { interval: "month", interval_count: 1 },
      unit_amount: plan === "starter" ? 900 : 3900,
    },
    quantity: 1,
  };
  const subscription = {
    cancel_at_period_end: false,
    customer: identifier("cus"),
    id: identifier("sub"),
    items: { data: [item], has_more: false },
    latest_invoice: invoiceId,
    livemode: false,
    metadata: {
      cloudmarkup_billing_account_id: account.billingAccountId,
      cloudmarkup_organization_id: account.organizationId,
    },
    object: "subscription",
    status: "active",
    trial_end: null,
  };
  const invoice = {
    amount_due: item.price.unit_amount,
    amount_paid: item.price.unit_amount,
    amount_remaining: 0,
    billing_reason: "subscription_cycle",
    currency: "usd",
    customer: subscription.customer,
    id: invoiceId,
    lines: {
      object: "list",
      has_more: false,
      data: [
        {
          amount: item.price.unit_amount,
          currency: "usd",
          id: identifier("il"),
          invoice: invoiceId,
          livemode: false,
          object: "line_item",
          parent: {
            type: "subscription_item_details",
            subscription_item_details: {
              proration: false,
              subscription: subscription.id,
              subscription_item: item.id,
            },
          },
          period: { start: period.start, end: period.end },
          pricing: {
            type: "price_details",
            price_details: {
              price: item.price.id,
              product: item.price.product,
            },
          },
          quantity: 1,
        },
      ],
    },
    livemode: false,
    object: "invoice",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: subscription.id },
    },
    status: "paid",
  };
  return { subscription, invoice, item };
}

function providerEvent(
  type: string,
  object: unknown,
  at = created,
  eventId = identifier("evt"),
) {
  return {
    api_version: STRIPE_API_VERSION,
    created: at,
    data: { object: structuredClone(object) },
    id: eventId,
    livemode: false,
    object: "event",
    type,
  };
}

// Only Stripe HTTP and secret resolution are synthetic. Production composition,
// receipt attempts, ownership checks, projections, grants and ledger SQL are real.
integrationDescribe(
  "production billing worker on isolated loopback PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_billing_worker_it_[a-f0-9]{32}$/u.test(schemaName))
        throw new Error("Unsafe synthetic schema.");
      administration = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      await administration.transaction(async (tx) => {
        await tx.query(sql(`CREATE SCHEMA "${schemaName}"`));
        await tx.query(
          sql(`COMMENT ON SCHEMA "${schemaName}" IS '${schemaMarker}'`),
        );
      });
      createdSchema = true;
      database = new PostgresDatabase({
        connectionString,
        max: 3,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schemaName} -c timezone=UTC`,
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
            !/^cm_billing_worker_it_[a-f0-9]{32}$/u.test(schemaName)
          )
            throw new Error(
              "Refusing to remove an unverified synthetic schema.",
            );
          await administration.transaction(async (tx) => {
            await tx.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
          });
        }
      } finally {
        await administration?.close();
      }
    }, 30000);

    async function account(): Promise<Account> {
      const organizationId = identifier("organization");
      const billingAccountId = identifier("billing_account");
      const principalId = identifier("principal");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic billing worker')",
            [principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic billing worker',$2)",
            [organizationId, organizationId.replaceAll("_", "-")],
          ),
        );
      });
      const context = {
        actorId: identifier("operator"),
        actorPrincipalId: principalId,
        authority: "internal-administration" as const,
        correlationId: identifier("correlation"),
        organizationId,
      };
      const repository = new PostgresCommercialPersistenceRepository(database);
      const createdAccount = await repository.createBillingAccount(context, {
        billingAccountId,
      });
      await repository.updateBillingAccount(context, {
        expectedRecordVersion: createdAccount.recordVersion,
        lifecycleStatus: "active",
        expensiveOperationsEnabled: true,
      });
      return { organizationId, billingAccountId };
    }

    function transport(
      options: {
        readonly mappingVersion?: string;
        readonly deliveryMappingVersion?: string;
        readonly beforeSubscriptionRead?: (number: number) => Promise<void>;
      } = {},
    ) {
      const events = new Map<string, ReturnType<typeof providerEvent>>();
      const subscriptions = new Map<
        string,
        ReturnType<typeof providerFixture>["subscription"]
      >();
      const secretBuffers: Uint8Array[] = [];
      let subscriptionReads = 0;
      const fetchImplementation: StripeFetchImplementation = async (
        input,
        init,
      ) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        expect(init?.method).toBe("GET");
        expect(init?.redirect).toBe("error");
        const headers = new Headers(init?.headers);
        expect(headers.get("stripe-version")).toBe(STRIPE_API_VERSION);
        expect(headers.get("authorization")).toBe(
          "Bearer sk_test_synthetic_billing_worker",
        );
        const eventMatch =
          /^https:\/\/api\.stripe\.com\/v1\/events\/(evt_[A-Za-z0-9_]+)$/u.exec(
            url,
          );
        if (eventMatch !== null) {
          const value = events.get(eventMatch[1] ?? "");
          if (value === undefined)
            throw new Error("Unconfigured synthetic Stripe event.");
          return Promise.resolve(Response.json(value));
        }
        const subscriptionMatch =
          /^https:\/\/api\.stripe\.com\/v1\/subscriptions\/(sub_[A-Za-z0-9_]+)$/u.exec(
            url,
          );
        if (subscriptionMatch !== null) {
          subscriptionReads += 1;
          await options.beforeSubscriptionRead?.(subscriptionReads);
          const value = subscriptions.get(subscriptionMatch[1] ?? "");
          if (value === undefined)
            throw new Error("Unconfigured synthetic Stripe subscription.");
          return Promise.resolve(Response.json(value));
        }
        throw new Error(
          "Unexpected provider request; no network request is permitted.",
        );
      };
      async function deliver(...sources: ReturnType<typeof providerEvent>[]) {
        const Records = sources.map((source) => {
          events.set(source.id, source);
          const delivery = parseStripeBillingWebhookDelivery({
            rawBody: Buffer.from(JSON.stringify(source)),
            planMappingVersion:
              options.deliveryMappingVersion ?? BILLING_PLAN_MAPPING_VERSION,
            signatureSecretVersion: "current",
            webhookEndpointVersion: BILLING_WEBHOOK_ENDPOINT_VERSION,
          });
          if (delivery === null)
            throw new Error("Expected a supported synthetic event.");
          return {
            body: JSON.stringify(delivery),
            eventSource: "aws:sqs",
            eventSourceARN: queueArn,
            messageId: identifier("message"),
          };
        });
        const handler = createProductionBillingWebhookWorker({
          environment: {
            ...environment,
            CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
              options.mappingVersion ?? BILLING_PLAN_MAPPING_VERSION,
          },
          database: withDataApiTypes(database),
          fetchImplementation,
          secrets: {
            resolveSecret: (reference) => {
              expect(reference).toBe(apiKeyArn);
              const bytes = new TextEncoder().encode(
                JSON.stringify({
                  "API key": "sk_test_synthetic_billing_worker",
                }),
              );
              secretBuffers.push(bytes);
              return Promise.resolve(bytes);
            },
          },
        });
        const result = await handler({ Records });
        expect(
          secretBuffers.every((bytes) => bytes.every((value) => value === 0)),
        ).toBe(true);
        return { result, Records };
      }
      return { subscriptions, deliver };
    }

    async function state(organizationId: string) {
      const persistence = new PostgresBillingPersistence(database);
      const counts = await database.query(
        sql(
          `SELECT
      (SELECT COUNT(*)::TEXT FROM credit_grants WHERE organization_id=$1) AS grants,
      (SELECT COUNT(*)::TEXT FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='grant') AS grant_ledger,
      (SELECT COUNT(*)::TEXT FROM audit_events WHERE organization_id=$1 AND action='billing.webhook.process') AS webhook_audits`,
          [organizationId],
        ),
      );
      const grants = await database.query(
        sql(
          `SELECT credit_units::TEXT AS units, subscription_period_id,
      (EXTRACT(EPOCH FROM subscription_period_start))::BIGINT::TEXT AS start_seconds,
      (EXTRACT(EPOCH FROM subscription_period_end))::BIGINT::TEXT AS end_seconds
      FROM credit_grants WHERE organization_id=$1 ORDER BY credit_grant_id`,
          [organizationId],
        ),
      );
      return {
        projection: await persistence.getCurrentProjection(organizationId),
        entitlement: await persistence.getCurrentEntitlement(organizationId),
        counts: counts.rows[0],
        grants: grants.rows,
      };
    }

    async function receipt(eventId: string) {
      const result = await database.query(
        sql(
          "SELECT lifecycle_status, attempt_count, safe_failure_code FROM billing_webhook_events WHERE provider_event_reference=$1",
          [eventId],
        ),
      );
      return result.rows[0];
    }

    const sharingPeriod = {
      start: Date.parse(BETA_SHARING_EFFECTIVE_FROM) / 1000,
      end: Date.parse("2026-10-07T14:35:22.000Z") / 1000,
    };

    it("supplements a genuinely paid Starter period exactly once on a current Professional upgrade", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
      try {
        const owner = await account();
        const provider = providerFixture(owner, "starter", sharingPeriod);
        const api = transport({
          mappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
        });
        api.subscriptions.set(provider.subscription.id, provider.subscription);
        expect(
          (await api.deliver(providerEvent("invoice.paid", provider.invoice)))
            .result.batchItemFailures,
        ).toEqual([]);
        const original = await database.query(
          sql(
            "SELECT to_jsonb(g) AS grant FROM credit_grants g WHERE organization_id=$1 AND grant_kind='monthly'",
            [owner.organizationId],
          ),
        );
        const price = providerFixture(owner, "pro", sharingPeriod).item.price;
        provider.item.price = price;
        const changed = providerEvent(
          "customer.subscription.updated",
          provider.subscription,
          created + 10,
        );
        expect((await api.deliver(changed)).result.batchItemFailures).toEqual(
          [],
        );
        expect((await api.deliver(changed)).result.batchItemFailures).toEqual(
          [],
        );
        expect(
          (
            await api.deliver(
              providerEvent(
                "customer.subscription.updated",
                provider.subscription,
                created + 11,
              ),
            )
          ).result.batchItemFailures,
        ).toEqual([]);
        const final = await state(owner.organizationId);
        expect(final.counts?.["grants"]).toBe("2");
        expect(final.counts?.["grant_ledger"]).toBe("2");
        expect(final.grants.map((row) => row["units"]).sort()).toEqual([
          "200",
          "800",
        ]);
        expect(
          (
            await database.query(
              sql(
                "SELECT to_jsonb(g) AS grant FROM credit_grants g WHERE organization_id=$1 AND grant_kind='monthly'",
                [owner.organizationId],
              ),
            )
          ).rows,
        ).toEqual(original.rows);
        const allowance = await database.query(
          sql(
            "SELECT credit_units::text AS units, grant_kind, subscription_period_id, grant_policy_version FROM credit_grants WHERE organization_id=$1 AND grant_kind='promotional'",
            [owner.organizationId],
          ),
        );
        expect(allowance.rows).toEqual([
          {
            units: "800",
            grant_kind: "promotional",
            subscription_period_id: null,
            grant_policy_version:
              "cloudmarkup-paid-period-upgrade-allowance-v1",
          },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each(["starter", "pro"] as const)(
      "maps a delayed legacy envelope to an initial current sharing %s period exactly once",
      async (plan) => {
        const owner = await account();
        const provider = providerFixture(owner, plan, sharingPeriod);
        const api = transport({
          mappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
        });
        api.subscriptions.set(provider.subscription.id, provider.subscription);
        const paid = providerEvent("invoice.paid", provider.invoice);
        expect((await api.deliver(paid)).result.batchItemFailures).toEqual([]);
        const first = await state(owner.organizationId);
        expect(first.projection).toMatchObject({
          planVersionId: BETA_SHARING_PLAN_IDS[plan],
          billableSeatQuantity: "1",
        });
        expect(first.entitlement?.planVersionId).toBe(
          BETA_SHARING_PLAN_IDS[plan],
        );
        expect(first.counts?.["grants"]).toBe("1");
        expect(first.counts?.["grant_ledger"]).toBe("1");
        expect(first.grants[0]?.["units"]).toBe(
          plan === "starter" ? "200" : "1000",
        );
        expect((await api.deliver(paid)).result.batchItemFailures).toEqual([]);
        expect(await state(owner.organizationId)).toEqual(first);
      },
    );

    it.each(["starter", "pro"] as const)(
      "keeps one immutable %s same-period grant across mapping adoption and compatible legacy replay",
      async (plan) => {
        const owner = await account();
        const provider = providerFixture(owner, plan, sharingPeriod);
        const legacy = transport();
        const next = transport({
          mappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
          deliveryMappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
        });
        legacy.subscriptions.set(
          provider.subscription.id,
          provider.subscription,
        );
        next.subscriptions.set(provider.subscription.id, provider.subscription);
        const paid = providerEvent("invoice.paid", provider.invoice);
        expect((await legacy.deliver(paid)).result.batchItemFailures).toEqual(
          [],
        );
        const before = await state(owner.organizationId);
        const grantBefore = await database.query(
          sql(
            "SELECT to_jsonb(g) AS grant FROM credit_grants g WHERE organization_id=$1",
            [owner.organizationId],
          ),
        );
        // Previously processed event stays duplicate: it cannot migrate history.
        expect((await next.deliver(paid)).result.batchItemFailures).toEqual([]);
        expect(await state(owner.organizationId)).toEqual(before);
        const update = providerEvent(
          "customer.subscription.updated",
          provider.subscription,
        );
        expect((await next.deliver(update)).result.batchItemFailures).toEqual(
          [],
        );
        const adopted = await state(owner.organizationId);
        expect(adopted.projection?.planVersionId).toBe(
          BETA_SHARING_PLAN_IDS[plan],
        );
        expect(adopted.projection?.billableSeatQuantity).toBe("1");
        expect(
          (await next.deliver(providerEvent("invoice.paid", provider.invoice)))
            .result.batchItemFailures,
        ).toEqual([]);
        expect(
          (
            await legacy.deliver(
              providerEvent(
                "customer.subscription.updated",
                provider.subscription,
              ),
            )
          ).result.batchItemFailures,
        ).toEqual([]);
        const replay = await state(owner.organizationId);
        expect(replay.projection).toEqual(adopted.projection);
        expect(replay.entitlement).toEqual(adopted.entitlement);
        expect(replay.counts?.["grants"]).toBe("1");
        expect(replay.counts?.["grant_ledger"]).toBe("1");
        expect(
          (
            await database.query(
              sql(
                "SELECT to_jsonb(g) AS grant FROM credit_grants g WHERE organization_id=$1",
                [owner.organizationId],
              ),
            )
          ).rows,
        ).toEqual(grantBefore.rows);
      },
    );

    it("retains a pre-effective initial period on legacy so its first genuine paid grant remains valid", async () => {
      const owner = await account();
      const provider = providerFixture(owner);
      const next = transport({
        mappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
      });
      next.subscriptions.set(provider.subscription.id, provider.subscription);
      expect(
        (await next.deliver(providerEvent("invoice.paid", provider.invoice)))
          .result.batchItemFailures,
      ).toEqual([]);
      const value = await state(owner.organizationId);
      expect(value.projection?.planVersionId).toBe(
        "planver_starter_2026_08_14_v1",
      );
      expect(value.counts?.["grants"]).toBe("1");
      expect(value.grants[0]?.["start_seconds"]).toBe(periodStart.toString());
    });

    it("rejects a stale legacy observation after new-plan CAS and retry preserves the new plan", async () => {
      const owner = await account();
      const provider = providerFixture(owner, "starter", sharingPeriod);
      const initial = transport();
      initial.subscriptions.set(
        provider.subscription.id,
        provider.subscription,
      );
      expect(
        (
          await initial.deliver(
            providerEvent(
              "customer.subscription.updated",
              provider.subscription,
            ),
          )
        ).result.batchItemFailures,
      ).toEqual([]);
      // Change a real provider field too, so the stale legacy observer attempts
      // the durable projection CAS rather than only the no-change read fence.
      provider.subscription.cancel_at_period_end = true;
      const next = transport({
        mappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
      });
      next.subscriptions.set(provider.subscription.id, provider.subscription);
      const legacy = transport({
        beforeSubscriptionRead: async (number) => {
          if (number === 2)
            expect(
              (
                await next.deliver(
                  providerEvent(
                    "customer.subscription.updated",
                    provider.subscription,
                  ),
                )
              ).result.batchItemFailures,
            ).toEqual([]);
        },
      });
      legacy.subscriptions.set(provider.subscription.id, provider.subscription);
      const delayed = providerEvent(
        "customer.subscription.updated",
        provider.subscription,
      );
      const failed = await legacy.deliver(delayed);
      expect(failed.result.batchItemFailures).toEqual([
        { itemIdentifier: failed.Records[0]?.messageId },
      ]);
      const adopted = await state(owner.organizationId);
      expect(adopted.projection?.planVersionId).toBe(
        BETA_SHARING_PLAN_IDS.starter,
      );
      expect((await receipt(delayed.id))?.["lifecycle_status"]).toBe(
        "received",
      );
      expect((await legacy.deliver(delayed)).result.batchItemFailures).toEqual(
        [],
      );
      const final = await state(owner.organizationId);
      expect(final.projection).toEqual(adopted.projection);
      expect(final.counts?.["grants"]).toBe("0");
    });

    it("preserves every existing member when a sharing Pro subscription becomes Starter", async () => {
      const owner = await account();
      for (const role of ["owner", "editor", "viewer"] as const) {
        await database.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,$2::text,'authorization-v2',$3,cloudmarkup_authorization_v2_permissions($2::text))",
            [owner.organizationId, role, role === "owner"],
          ),
        );
      }
      const membershipSnapshot: MembershipSeatRecordV1[] = [];
      for (const role of ["owner", "editor", "viewer", "viewer"] as const) {
        const principalId = identifier("principal");
        const membershipId = identifier("membership");
        await database.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic retained member')",
            [principalId],
          ),
        );
        await database.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key,lifecycle_status) VALUES($1,$2,$3,$4,'active')",
            [membershipId, owner.organizationId, principalId, role],
          ),
        );
        membershipSnapshot.push({ membershipId, role, status: "active" });
      }
      const members = await database.query(
        sql(
          "SELECT to_jsonb(m) AS member FROM memberships m WHERE organization_id=$1 ORDER BY membership_id",
          [owner.organizationId],
        ),
      );
      const provider = providerFixture(owner, "pro", sharingPeriod);
      const api = transport({
        mappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
      });
      api.subscriptions.set(provider.subscription.id, provider.subscription);
      expect(
        (
          await api.deliver(
            providerEvent(
              "customer.subscription.updated",
              provider.subscription,
            ),
          )
        ).result.batchItemFailures,
      ).toEqual([]);
      provider.item.price.id = STRIPE_STARTER_PRICE_REFERENCE;
      provider.item.price.product = STRIPE_STARTER_PRODUCT_REFERENCE;
      provider.item.price.unit_amount = 900;
      expect(
        (
          await api.deliver(
            providerEvent(
              "customer.subscription.updated",
              provider.subscription,
            ),
          )
        ).result.batchItemFailures,
      ).toEqual([]);
      const value = await state(owner.organizationId);
      expect(value.projection).toMatchObject({
        planVersionId: BETA_SHARING_PLAN_IDS.starter,
        billableSeatQuantity: "1",
      });
      expect(value.counts?.["grants"]).toBe("0");
      expect(
        (
          await database.query(
            sql(
              "SELECT to_jsonb(m) AS member FROM memberships m WHERE organization_id=$1 ORDER BY membership_id",
              [owner.organizationId],
            ),
          )
        ).rows,
      ).toEqual(members.rows);
      expect(members.rows).toHaveLength(4);
      expect(
        evaluateOrganizationSeatAdmissionV1({
          planVersionId: value.projection?.planVersionId ?? "missing",
          at: new Date().toISOString(),
          memberships: membershipSnapshot,
        }),
      ).toEqual({ allowed: false, reason: "member-limit-reached" });
    });

    it("serializes racing compatible mappings to one current-period grant", async () => {
      const owner = await account();
      const provider = providerFixture(owner, "starter", sharingPeriod);
      const next = transport({
        mappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
      });
      const legacy = transport();
      for (const api of [next, legacy])
        api.subscriptions.set(provider.subscription.id, provider.subscription);
      expect(
        (
          await next.deliver(
            providerEvent(
              "customer.subscription.updated",
              provider.subscription,
            ),
          )
        ).result.batchItemFailures,
      ).toEqual([]);
      const first = providerEvent("invoice.paid", provider.invoice);
      const second = providerEvent("invoice.paid", provider.invoice);
      await Promise.all([legacy.deliver(first), next.deliver(second)]);
      // A legitimate CAS/identity loser retries the same event, not a new grant key.
      expect((await legacy.deliver(first)).result.batchItemFailures).toEqual(
        [],
      );
      expect((await next.deliver(second)).result.batchItemFailures).toEqual([]);
      const value = await state(owner.organizationId);
      expect(value.projection?.planVersionId).toBe(
        BETA_SHARING_PLAN_IDS.starter,
      );
      expect(value.counts?.["grants"]).toBe("1");
      expect(value.counts?.["grant_ledger"]).toBe("1");
      expect(value.grants[0]?.["units"]).toBe("200");
      expect((await receipt(first.id))?.["lifecycle_status"]).toBe("processed");
      expect((await receipt(second.id))?.["lifecycle_status"]).toBe(
        "processed",
      );
    });

    it.each(["starter", "pro"] as const)(
      "applies the exact %s invoice period once across duplicate and distinct event redelivery",
      async (plan) => {
        const owner = await account();
        const provider = providerFixture(owner, plan);
        const api = transport();
        api.subscriptions.set(provider.subscription.id, provider.subscription);
        const paid = providerEvent("invoice.paid", provider.invoice);
        expect((await api.deliver(paid)).result).toEqual({
          batchItemFailures: [],
        });
        const original = await state(owner.organizationId);
        expect(original.counts).toEqual({
          grants: "1",
          grant_ledger: "1",
          webhook_audits: "1",
        });
        expect(original.projection).toMatchObject({
          normalizedStatus: "active",
          providerSubscriptionReference: provider.subscription.id,
          providerCustomerReference: provider.subscription.customer,
        });
        expect(original.grants).toEqual([
          {
            units: plan === "starter" ? "200" : "1000",
            subscription_period_id: original.projection?.currentPeriodId,
            start_seconds: String(periodStart),
            end_seconds: String(periodEnd),
          },
        ]);
        expect((await api.deliver(paid)).result).toEqual({
          batchItemFailures: [],
        });
        expect(await state(owner.organizationId)).toEqual(original);
        expect(await receipt(paid.id)).toMatchObject({
          lifecycle_status: "processed",
          attempt_count: 1,
        });
        expect(
          (
            await api.deliver(
              providerEvent("invoice.paid", provider.invoice, created + 1),
            )
          ).result,
        ).toEqual({ batchItemFailures: [] });
        const repeated = await state(owner.organizationId);
        expect(repeated.counts).toEqual({
          grants: "1",
          grant_ledger: "1",
          webhook_audits: "2",
        });
        expect(repeated.grants).toEqual(original.grants);
      },
    );

    it("grants a reordered same-second paid event without rewriting newer projection or entitlement", async () => {
      const owner = await account();
      const provider = providerFixture(owner);
      const api = transport();
      api.subscriptions.set(provider.subscription.id, provider.subscription);
      const newer = providerEvent(
        "customer.subscription.updated",
        provider.subscription,
        created,
        identifier("evt_z"),
      );
      expect((await api.deliver(newer)).result).toEqual({
        batchItemFailures: [],
      });
      const original = await state(owner.organizationId);
      expect(original.counts?.["grants"]).toBe("0");
      const paid = providerEvent(
        "invoice.paid",
        provider.invoice,
        created,
        identifier("evt_a"),
      );
      expect((await api.deliver(paid)).result).toEqual({
        batchItemFailures: [],
      });
      expect((await api.deliver(paid)).result).toEqual({
        batchItemFailures: [],
      });
      const actual = await state(owner.organizationId);
      expect(actual.projection).toEqual(original.projection);
      expect(actual.entitlement).toEqual(original.entitlement);
      expect(actual.counts).toEqual({
        grants: "1",
        grant_ledger: "1",
        webhook_audits: "2",
      });
    });

    it("rejects cross-organization account metadata and foreign provider ownership without issuing grants", async () => {
      const first = await account();
      const second = await account();
      const provider = providerFixture(first);
      const api = transport();
      api.subscriptions.set(provider.subscription.id, provider.subscription);
      expect(
        (
          await api.deliver(
            providerEvent(
              "customer.subscription.updated",
              provider.subscription,
            ),
          )
        ).result,
      ).toEqual({ batchItemFailures: [] });
      const original = await state(first.organizationId);
      for (const billingAccountId of [
        first.billingAccountId,
        second.billingAccountId,
      ]) {
        const crossed = structuredClone(provider.subscription);
        crossed.metadata = {
          cloudmarkup_organization_id: second.organizationId,
          cloudmarkup_billing_account_id: billingAccountId,
        };
        api.subscriptions.set(crossed.id, crossed);
        const paid = providerEvent(
          "invoice.paid",
          provider.invoice,
          created + 1,
        );
        expect((await api.deliver(paid)).result).toEqual({
          batchItemFailures: [],
        });
        expect(await receipt(paid.id)).toMatchObject({
          lifecycle_status: "failed",
          safe_failure_code:
            "organization-account-or-provider-ownership-unavailable",
        });
        expect(await state(first.organizationId)).toEqual(original);
        const other = await state(second.organizationId);
        expect(other.projection).toBeNull();
        expect(other.counts).toEqual({
          grants: "0",
          grant_ledger: "0",
          webhook_audits: "0",
        });
      }
    });

    it("rejects an earlier invoice period without funding or regressing the current subscription", async () => {
      const owner = await account();
      const provider = providerFixture(owner);
      const api = transport();
      api.subscriptions.set(provider.subscription.id, provider.subscription);
      expect(
        (
          await api.deliver(
            providerEvent(
              "customer.subscription.updated",
              provider.subscription,
            ),
          )
        ).result,
      ).toEqual({ batchItemFailures: [] });
      const original = await state(owner.organizationId);
      const earlierInvoice = structuredClone(provider.invoice);
      const line = earlierInvoice.lines.data[0];
      if (line === undefined)
        throw new Error("Expected one synthetic invoice line.");
      line.period = {
        start: Date.parse("2026-08-01T00:00:00.000Z") / 1000,
        end: periodStart,
      };
      const paid = providerEvent("invoice.paid", earlierInvoice, created - 1);
      expect((await api.deliver(paid)).result).toEqual({
        batchItemFailures: [],
      });
      expect(await receipt(paid.id)).toMatchObject({
        lifecycle_status: "failed",
        safe_failure_code: "invalid-or-unowned-subscription",
      });
      expect(await state(owner.organizationId)).toEqual(original);
      expect(original.counts).toEqual({
        grants: "0",
        grant_ledger: "0",
        webhook_audits: "1",
      });
    });

    it("retains a received receipt after a real grant transaction failure and retries without duplicate ledger effects", async () => {
      const owner = await account();
      const provider = providerFixture(owner);
      const api = transport();
      api.subscriptions.set(provider.subscription.id, provider.subscription);
      const triggerName = identifier("cm_fail_grant");
      if (
        !/^cm_fail_grant_[a-f0-9]{32}$/u.test(triggerName) ||
        !/^organization_[a-f0-9]{32}$/u.test(owner.organizationId)
      )
        throw new Error("Unsafe synthetic fault injection.");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            `CREATE FUNCTION "${triggerName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic grant transaction failure'; END; $$`,
          ),
        );
        await tx.query(
          sql(
            `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON credit_grants FOR EACH ROW WHEN (NEW.organization_id = '${owner.organizationId}') EXECUTE FUNCTION "${triggerName}"()`,
          ),
        );
      });
      const paid = providerEvent("invoice.paid", provider.invoice);
      let failed: Awaited<ReturnType<typeof state>>;
      try {
        const attempt = await api.deliver(paid);
        expect(attempt.result).toEqual({
          batchItemFailures: [
            { itemIdentifier: attempt.Records[0]?.messageId },
          ],
        });
        expect(await receipt(paid.id)).toMatchObject({
          lifecycle_status: "received",
          attempt_count: 1,
        });
        failed = await state(owner.organizationId);
        expect(failed.counts).toEqual({
          grants: "0",
          grant_ledger: "0",
          webhook_audits: "0",
        });
        expect(failed.projection?.recordVersion).toBe("1");
      } finally {
        await database.transaction(async (tx) => {
          await tx.query(sql(`DROP TRIGGER "${triggerName}" ON credit_grants`));
          await tx.query(sql(`DROP FUNCTION "${triggerName}"()`));
        });
      }
      expect((await api.deliver(paid)).result).toEqual({
        batchItemFailures: [],
      });
      expect((await api.deliver(paid)).result).toEqual({
        batchItemFailures: [],
      });
      const completed = await state(owner.organizationId);
      expect(completed.projection).toEqual(failed.projection);
      expect(completed.entitlement).toEqual(failed.entitlement);
      expect(completed.counts).toEqual({
        grants: "1",
        grant_ledger: "1",
        webhook_audits: "1",
      });
      expect(await receipt(paid.id)).toMatchObject({
        lifecycle_status: "processed",
        attempt_count: 2,
      });
    });
  },
);
