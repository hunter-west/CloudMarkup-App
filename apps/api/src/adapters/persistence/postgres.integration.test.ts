import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CommercialPersistenceError,
  type ProviderPricingVersionRecord,
  type ReserveCreditsInput,
  type TrustedCommercialAccountingContext,
  type TrustedCommercialAdministrationContext,
} from "../../application/commercial-persistence.js";
import type {
  AuthorizedOrganizationScope,
  VerifiedPrincipalContext,
} from "../../application/persistence.js";
import { PostgresBillingPersistence } from "./billing-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { runMigrations, runSeedFile } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { sql, type SqlExecutor } from "./sql.js";

const databaseUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const integrationDescribe =
  databaseUrl === undefined ? describe.skip : describe;

const commercialTestRunId = randomUUID().replaceAll("-", "");
const schemaName = `cloudmarkup_persistence_test_${commercialTestRunId}`;
const schemaMarker = `CloudMarkup synthetic persistence integration ${commercialTestRunId}`;
const proPlanVersionId = "planver_pro_2026_08_14_v2";
const chargingPolicyVersion = "cloudmarkup-charging-and-failure-v1";
const entitlementPolicyVersion = "cloudmarkup-entitlements-v1";
const grantPolicyVersion = "cloudmarkup-credit-grants-v1";
const expirationPolicyVersion = "cloudmarkup-credit-expiration-v1";
const billingMigrationChecksum =
  "bc85458cf94571e8c766889e0b44d2ef13e21cfe3a6269fba0ac6795cb6e849c";

interface CommercialFixture {
  readonly accountingContext: TrustedCommercialAccountingContext;
  readonly administrationContext: TrustedCommercialAdministrationContext;
  readonly billingAccountId: string;
  readonly entitlementSnapshotId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly repository: PostgresCommercialPersistenceRepository;
  readonly scope: AuthorizedOrganizationScope;
}

interface CreatedGrant {
  readonly creditGrantId: string;
  readonly ledgerEntryId: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function testId(prefix: string, label: string): string {
  return `${prefix}_${commercialTestRunId}_${label}`;
}

integrationDescribe("local PostgreSQL persistence", () => {
  let database: PostgresDatabase;
  let openedDatabase: PostgresDatabase | undefined;
  let admin: PostgresDatabase | undefined;
  let createdSchema = false;

  async function createCommercialFixture(
    label: string,
  ): Promise<CommercialFixture> {
    const principalId = testId("principal", label);
    const organizationId = testId("organization", label);
    const membershipId = testId("membership", label);
    const projectId = testId("project", label);
    const billingAccountId = testId("billing", label);
    const entitlementSnapshotId = testId("entitlement", label);
    const effectiveAt = new Date().toISOString();

    await database.transaction(async (transaction) => {
      await transaction.query(
        sql(
          `INSERT INTO principals (principal_id, display_name)
           VALUES ($1, $2)`,
          [principalId, `Commercial integration ${label}`],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO organizations (organization_id, display_name, slug)
           VALUES ($1, $2, $3)`,
          [
            organizationId,
            `Commercial integration ${label}`,
            `commercial-${commercialTestRunId}-${label.replaceAll("_", "-")}`,
          ],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO organization_roles (
             organization_id, role_key, policy_version, is_owner, capabilities
           ) VALUES (
             $1, 'owner', 'authorization-v2', TRUE,
             cloudmarkup_authorization_v2_permissions('owner')
           )`,
          [organizationId],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO memberships (
             membership_id, organization_id, principal_id, role_key
           ) VALUES ($1, $2, $3, 'owner')`,
          [membershipId, organizationId, principalId],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO projects (
             project_id, organization_id, name, created_by_principal_id
           ) VALUES ($1, $2, $3, $4)`,
          [projectId, organizationId, `Commercial ${label}`, principalId],
        ),
      );
    });

    const principal: VerifiedPrincipalContext = {
      correlationId: testId("correlation", label),
      principalId,
      sessionId: testId("session", label),
    };
    const scope = await new PostgresCloudMarkupRepository(
      database,
    ).resolveOrganizationScope(principal, organizationId);
    if (scope === null) {
      throw new Error("Expected the commercial owner scope to resolve.");
    }

    const administrationContext: TrustedCommercialAdministrationContext = {
      actorId: testId("worker", label),
      actorPrincipalId: principalId,
      authority: "internal-administration",
      correlationId: principal.correlationId,
      organizationId,
    };
    const accountingContext: TrustedCommercialAccountingContext = {
      actorId: testId("accounting-worker", label),
      authority: "internal-accounting",
      correlationId: principal.correlationId,
      organizationId,
    };
    const repository = new PostgresCommercialPersistenceRepository(database);
    const account = await repository.createBillingAccount(
      administrationContext,
      { billingAccountId },
    );
    const enabledAccount = await repository.updateBillingAccount(
      administrationContext,
      {
        expectedRecordVersion: account.recordVersion,
        expensiveOperationsEnabled: true,
        lifecycleStatus: "active",
      },
    );
    const subscription = await repository.updateSubscriptionProjection(
      administrationContext,
      {
        billableSeatQuantity: "1",
        billingProvider: "test-billing-provider",
        cancelAtPeriodEnd: false,
        effectiveAt,
        expectedRecordVersion: "0",
        normalizedStatus: "active",
        planVersionId: proPlanVersionId,
        providerCustomerReference: testId("customer", label),
        providerSubscriptionReference: testId("subscription", label),
        subscriptionProjectionId: testId("subscriptionprojection", label),
      },
    );
    await repository.updateEntitlementSnapshot(administrationContext, {
      effectiveAt,
      entitlementPolicyVersion,
      entitlementSnapshotId,
      expensiveOperationsEnabled: enabledAccount.expensiveOperationsEnabled,
      expectedRecordVersion: "0",
      planVersionId: proPlanVersionId,
      sourceRecordVersion: subscription.recordVersion,
      subscriptionProjectionId: subscription.subscriptionProjectionId,
    });

    return {
      accountingContext,
      administrationContext,
      billingAccountId,
      entitlementSnapshotId,
      organizationId,
      principalId,
      projectId,
      repository,
      scope,
    };
  }

  async function createPricing(
    fixture: CommercialFixture,
    label: string,
  ): Promise<ProviderPricingVersionRecord> {
    return fixture.repository.createProviderPricingVersion(
      fixture.administrationContext,
      {
        cachedInputMicrosPerMillionTokens: "500000",
        costCurrency: "USD",
        creditConversionDenominator: "1",
        creditConversionNumerator: "1",
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        inputMicrosPerMillionTokens: "1000000",
        modelId: testId("model", label),
        modelVersion: "2026-08-13",
        outputMicrosPerMillionTokens: "2000000",
        pricingVersionId: testId("pricing", label),
        providerKey: "test-model-provider",
      },
    );
  }

  async function createPromotionalGrant(
    fixture: CommercialFixture,
    label: string,
    creditUnits: string,
    expiresAt?: string,
  ): Promise<CreatedGrant> {
    const creditGrantId = testId("grant", label);
    const ledgerEntryId = testId("ledger", label);
    await fixture.repository.createCreditGrant(fixture.accountingContext, {
      chargingPolicyVersion,
      consumptionPriority: "100",
      creditGrantId,
      creditUnits,
      expirationPolicy:
        expiresAt === undefined
          ? {
              kind: "does-not-expire",
              policyVersion: expirationPolicyVersion,
            }
          : {
              expiresAt,
              kind: "expires-at",
              policyVersion: expirationPolicyVersion,
            },
      grantKind: "promotional",
      grantPolicyVersion,
      idempotencyKey: testId("grant-idempotency", label),
      ledgerEntryId,
      reasonCode: "test.promotional-grant",
      sourceReference: testId("grant-source", label),
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    return { creditGrantId, ledgerEntryId };
  }

  function createReservationInput(
    fixture: CommercialFixture,
    pricing: ProviderPricingVersionRecord,
    label: string,
    requestedCreditUnits: string,
  ): ReserveCreditsInput {
    return {
      chargingPolicyVersion,
      entitlementPolicyVersion,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      featureKey: "ai-assisted-operations",
      idempotencyKey: testId("reservation-idempotency", label),
      jobId: testId("job", label),
      modelId: pricing.modelId,
      modelVersion: pricing.modelVersion,
      planVersionId: proPlanVersionId,
      pricingVersionId: pricing.pricingVersionId,
      projectId: fixture.projectId,
      providerKey: pricing.providerKey,
      requestId: testId("request", label),
      requestSha256: digest(testId("request-payload", label)),
      requestedCreditUnits,
      reservationId: testId("reservation", label),
    };
  }

  async function insertDirectReservation(
    transaction: SqlExecutor,
    fixture: CommercialFixture,
    pricing: ProviderPricingVersionRecord,
    label: string,
    creditGrantId: string,
    requestedCreditUnits: string,
    ledgerCreditGrantId = creditGrantId,
  ): Promise<{
    readonly ledgerEntryId: string;
    readonly reservationId: string;
  }> {
    const reservationId = testId("reservation", label);
    const ledgerEntryId = testId("ledger", `reservation_${label}`);
    const requestId = testId("request", label);
    const jobId = testId("job", label);
    const requestSha256 = digest(testId("request-payload", label));

    await transaction.query(
      sql(
        `INSERT INTO credit_reservations (
           reservation_id, organization_id, billing_account_id,
           entitlement_snapshot_id, entitlement_policy_version,
           plan_version_id, pricing_version_id, charging_policy_version,
           acting_principal_id, project_id, feature_key, request_id, job_id,
           provider_key, model_key, model_version,
           requested_credit_units, reserved_credit_units,
           request_sha256, idempotency_key_sha256, expires_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17, $17, $18, $19,
           CURRENT_TIMESTAMP + INTERVAL '15 minutes'
         )`,
        [
          reservationId,
          fixture.organizationId,
          fixture.billingAccountId,
          fixture.entitlementSnapshotId,
          entitlementPolicyVersion,
          proPlanVersionId,
          pricing.pricingVersionId,
          chargingPolicyVersion,
          fixture.principalId,
          fixture.projectId,
          "ai-assisted-operations",
          requestId,
          jobId,
          pricing.providerKey,
          pricing.modelId,
          pricing.modelVersion,
          requestedCreditUnits,
          requestSha256,
          digest(testId("reservation-idempotency", label)),
        ],
      ),
    );
    await transaction.query(
      sql(
        `INSERT INTO credit_reservation_allocations (
           organization_id, reservation_id, credit_grant_id,
           allocation_sequence, reserved_credit_units
         ) VALUES ($1, $2, $3, 1, $4)`,
        [
          fixture.organizationId,
          reservationId,
          creditGrantId,
          requestedCreditUnits,
        ],
      ),
    );
    await transaction.query(
      sql(
        `INSERT INTO usage_ledger_entries (
           organization_id, ledger_entry_id, idempotency_key_sha256,
           entry_kind, billing_account_id, reservation_id,
           acting_principal_id, recorded_by_actor_kind,
           recorded_by_actor_id, project_id, feature_key, request_id,
           job_id, plan_version_id, pricing_version_id, provider_key,
           model_key, model_version, reserved_credit_units,
           entitlement_policy_version, reason_code,
           charging_policy_version, outcome, correlation_id
         ) VALUES (
           $1, $2, $3, 'reservation', $4, $5, $6, 'principal',
           $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
           $16, $17, 'credit.reserved', $18, 'reserved', $19
         )`,
        [
          fixture.organizationId,
          ledgerEntryId,
          digest(testId("ledger-idempotency", label)),
          fixture.billingAccountId,
          reservationId,
          fixture.principalId,
          fixture.projectId,
          "ai-assisted-operations",
          requestId,
          jobId,
          proPlanVersionId,
          pricing.pricingVersionId,
          pricing.providerKey,
          pricing.modelId,
          pricing.modelVersion,
          requestedCreditUnits,
          entitlementPolicyVersion,
          chargingPolicyVersion,
          fixture.scope.correlationId,
        ],
      ),
    );
    await transaction.query(
      sql(
        `INSERT INTO usage_ledger_entry_allocations (
           organization_id, ledger_entry_id, allocation_sequence,
           credit_grant_id, reserved_credit_units
         ) VALUES ($1, $2, 1, $3, $4)`,
        [
          fixture.organizationId,
          ledgerEntryId,
          ledgerCreditGrantId,
          requestedCreditUnits,
        ],
      ),
    );
    return { ledgerEntryId, reservationId };
  }

  async function insertDirectAdjustment(
    transaction: SqlExecutor,
    fixture: CommercialFixture,
    grant: CreatedGrant,
    label: string,
    adjustmentCreditUnits: string,
  ): Promise<string> {
    const ledgerEntryId = testId("ledger_adjustment", label);
    await transaction.query(
      sql(
        `INSERT INTO usage_ledger_entries (
           organization_id, ledger_entry_id, idempotency_key_sha256,
           entry_kind, billing_account_id, related_ledger_entry_id,
           recorded_by_actor_kind, recorded_by_actor_id,
           credit_adjustment_units, outcome, reason_code, safe_reason,
           charging_policy_version, correlation_id
         ) VALUES (
           $1, $2, $3, 'adjustment', $4, $5,
           'internal-administration', $6, $7, $8, $9, $10, $11, $12
         )`,
        [
          fixture.organizationId,
          ledgerEntryId,
          digest(testId("adjustment-idempotency", label)),
          fixture.billingAccountId,
          grant.ledgerEntryId,
          fixture.administrationContext.actorId,
          adjustmentCreditUnits,
          adjustmentCreditUnits.startsWith("-") ? "adjusted" : "compensated",
          "test.direct-adjustment",
          "Intentional direct adjustment for database invariant verification.",
          chargingPolicyVersion,
          fixture.administrationContext.correlationId,
        ],
      ),
    );
    await transaction.query(
      sql(
        `INSERT INTO usage_ledger_entry_allocations (
           organization_id, ledger_entry_id, allocation_sequence,
           credit_grant_id, credit_adjustment_units
         ) VALUES ($1, $2, 1, $3, $4)`,
        [
          fixture.organizationId,
          ledgerEntryId,
          grant.creditGrantId,
          adjustmentCreditUnits,
        ],
      ),
    );
    return ledgerEntryId;
  }

  beforeAll(async () => {
    let parsedUrl: URL | undefined;
    try {
      if (databaseUrl !== undefined) parsedUrl = new URL(databaseUrl);
    } catch {
      throw new Error("The local PostgreSQL test URL is invalid.");
    }
    if (
      databaseUrl === undefined ||
      parsedUrl === undefined ||
      !["postgres:", "postgresql:"].includes(parsedUrl.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname) ||
      parsedUrl.search !== "" ||
      parsedUrl.hash !== "" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsedUrl.pathname)
    ) {
      throw new Error(
        "Integration tests require an explicitly configured loopback PostgreSQL database.",
      );
    }
    if (!/^cloudmarkup_persistence_test_[a-f0-9]{32}$/u.test(schemaName))
      throw new Error("Invalid test schema.");
    admin = new PostgresDatabase({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 30000,
    });
    await admin.transaction(async (transaction) => {
      await transaction.query(sql(`CREATE SCHEMA ${schemaName}`));
      await transaction.query(
        sql(`COMMENT ON SCHEMA ${schemaName} IS '${schemaMarker}'`),
      );
    });
    createdSchema = true;
    database = new PostgresDatabase({
      application_name: "cloudmarkup-persistence-integration",
      connectionString: databaseUrl,
      max: 2,
      options: `-c search_path=${schemaName} -c timezone=UTC`,
      connectionTimeoutMillis: 30000,
    });
    openedDatabase = database;
    const apiDirectory = fileURLToPath(new URL("../../../", import.meta.url));
    const migrations = await loadHistoricalBetaMigrations(
      `${apiDirectory}migrations`,
    );
    await runMigrations(database, migrations);
    await runMigrations(database, migrations);
    await runSeedFile(
      database,
      `${apiDirectory}seeds/0001_local_development.sql`,
    );
    await runSeedFile(
      database,
      `${apiDirectory}seeds/0001_local_development.sql`,
    );
  }, 60_000);

  afterAll(async () => {
    await openedDatabase?.close();
    try {
      if (
        createdSchema &&
        /^cloudmarkup_persistence_test_[a-f0-9]{32}$/u.test(schemaName)
      ) {
        const marker = await admin?.query(
          sql(
            "SELECT obj_description(oid, 'pg_namespace') AS marker FROM pg_namespace WHERE nspname = $1",
            [schemaName],
          ),
        );
        if (marker?.rows[0]?.["marker"] !== schemaMarker)
          throw new Error(
            "Refusing cleanup of an unverified integration schema.",
          );
        await admin?.query(sql(`DROP SCHEMA ${schemaName} CASCADE`));
      }
    } finally {
      await admin?.close();
    }
  });

  it("applies the complete canonical schema once", async () => {
    const applied = await database.query<
      { checksum_sha256: string; version: string } & Record<string, unknown>
    >(
      sql(
        `SELECT version, checksum_sha256
         FROM cloudmarkup_schema_migrations ORDER BY version`,
      ),
    );
    const seededCommercialRows = await database.query<
      {
        entitlement_count: string;
        grant_count: string;
        granted_credit_units: string;
        membership_count: string;
        organization_count: string;
        subscription_count: string;
      } & Record<string, unknown>
    >(
      sql(
        `SELECT
           (SELECT COUNT(*)::TEXT FROM organizations
            WHERE organization_id IN (
              'org_local', 'org_local_team'
            )) AS organization_count,
           (SELECT COUNT(*)::TEXT FROM memberships
            WHERE membership_id LIKE 'membership_local%') AS membership_count,
           (SELECT COUNT(*)::TEXT FROM organization_subscription_projections
            WHERE billing_provider = 'fake'
              AND organization_id IN (
                'org_local', 'org_local_team'
              )) AS subscription_count,
           (SELECT COUNT(*)::TEXT FROM organization_entitlement_snapshots
            WHERE organization_id IN (
              'org_local', 'org_local_team'
            )) AS entitlement_count,
           (SELECT COUNT(*)::TEXT FROM usage_ledger_entries
            WHERE organization_id IN (
              'org_local', 'org_local_team'
            ) AND entry_kind = 'grant') AS grant_count,
           (SELECT COALESCE(SUM(granted_credit_units), 0)::TEXT
            FROM usage_ledger_entries
            WHERE organization_id IN (
              'org_local', 'org_local_team'
            ) AND entry_kind = 'grant') AS granted_credit_units`,
      ),
    );

    expect(applied.rows.map((row) => row.version)).toEqual([
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
      "0006",
      "0007",
      "0008",
      "0009",
      "0010",
      "0011",
      "0012",
      "0013",
      "0014",
      "0015",
      "0016",
      "0017",
      "0018",
      "0019",
      "0020",
      "0021",
      "0022",
      "0023",
      "0024",
      "0025",
      "0026",
      "0027",
      "0028",
      "0029",
      "0030",
      "0031",
      "0032",
      "0033",
      "0034",
      "0035",
      "0036",
      "0037",
      "0038",
      "0039",
      "0040",
      "0041",
      "0042",
      "0043",
      "0044",
      "0045",
      "0046",
      "0047",
      "0048",
      "0049",
      "0050",
      "0051",
      "0052",
      "0053",
      "0054",
      "0055",
      "0056",
      "0057",
      "0058",
      "0059",
      "0078",
      "0079",
      "0080",
      "0081",
      "0082",
      "0083",
      "0084",
      "0085",
      "0086",
      "0087",
      "0088",
      "0089",
      "0090",
      "0091",
      "0092",
      "0093",
      "0094",
      "0095",
      "0096",
      "0097",
      "0098",
      "0138",
    ]);
    expect(applied.rows[7]).toMatchObject({
      checksum_sha256: billingMigrationChecksum,
      version: "0008",
    });
    expect(seededCommercialRows.rows[0]).toMatchObject({
      entitlement_count: "2",
      grant_count: "2",
      granted_credit_units: "1200",
      membership_count: "5",
      organization_count: "2",
      subscription_count: "2",
    });
  });

  it("resolves tenant authority and synchronizes actor preferences", async () => {
    const repository = new PostgresCloudMarkupRepository(database);
    const principal: VerifiedPrincipalContext = {
      correlationId: "correlation_postgres_integration",
      principalId: "principal_local_owner",
      sessionId: "session_postgres_integration",
    };

    const scope = await repository.resolveOrganizationScope(
      principal,
      "org_local",
    );
    const current = await repository.getPresentationPreferences(principal);
    expect(scope).toMatchObject({
      membershipId: "membership_local_owner",
      organizationId: "org_local",
    });
    expect(current).not.toBeNull();
    if (current === null) {
      throw new Error("Expected seeded presentation preferences.");
    }
    const updated = await repository.updatePresentationPreferences(
      principal,
      {
        contextualLearningEnabled: !current.contextualLearningEnabled,
        experienceMode:
          current.experienceMode === "guided" ? "professional" : "guided",
      },
      current.syncVersion,
    );
    expect(updated.syncVersion).toBe(current.syncVersion + 1);
  });

  it("enforces owner, viewer, and cross-tenant commercial read boundaries", async () => {
    const fixture = await createCommercialFixture("commercial_authorization");
    const grant = await createPromotionalGrant(
      fixture,
      "commercial_authorization",
      "5",
    );
    const viewerPrincipalId = testId("principal", "commercial_viewer");
    const viewerMembershipId = testId("membership", "commercial_viewer");
    await database.transaction(async (transaction) => {
      await transaction.query(
        sql(
          `INSERT INTO principals (principal_id, display_name)
           VALUES ($1, 'Commercial integration viewer')`,
          [viewerPrincipalId],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO organization_roles (
             organization_id, role_key, policy_version, is_owner, capabilities
           ) VALUES (
             $1, 'viewer', 'authorization-v2', FALSE,
             cloudmarkup_authorization_v2_permissions('viewer')
           )`,
          [fixture.organizationId],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO memberships (
             membership_id, organization_id, principal_id, role_key
           ) VALUES ($1, $2, $3, 'viewer')`,
          [viewerMembershipId, fixture.organizationId, viewerPrincipalId],
        ),
      );
    });
    const viewerScope = await new PostgresCloudMarkupRepository(
      database,
    ).resolveOrganizationScope(
      {
        correlationId: testId("correlation", "commercial_viewer"),
        principalId: viewerPrincipalId,
        sessionId: testId("session", "commercial_viewer"),
      },
      fixture.organizationId,
    );
    if (viewerScope === null) {
      throw new Error("Expected the commercial viewer scope to resolve.");
    }

    await expect(
      fixture.repository.getUsageEntry(fixture.scope, grant.ledgerEntryId),
    ).resolves.toMatchObject({ ledgerEntryId: grant.ledgerEntryId });
    await expect(
      fixture.repository.getCreditBalance(viewerScope),
    ).resolves.toMatchObject({ organizationId: fixture.organizationId });
    await expect(
      fixture.repository.getUsageEntry(viewerScope, grant.ledgerEntryId),
    ).rejects.toMatchObject({ code: "access-denied" });

    const otherFixture = await createCommercialFixture(
      "commercial_authorization_other",
    );
    const otherGrant = await createPromotionalGrant(
      otherFixture,
      "commercial_authorization_other",
      "5",
    );
    const forgedCrossTenantScope: AuthorizedOrganizationScope = {
      ...fixture.scope,
      organizationId: otherFixture.organizationId,
    };
    await expect(
      fixture.repository.getCreditBalance(forgedCrossTenantScope),
    ).rejects.toMatchObject({ code: "access-denied" });
    await expect(
      fixture.repository.getUsageEntry(
        forgedCrossTenantScope,
        otherGrant.ledgerEntryId,
      ),
    ).rejects.toMatchObject({ code: "access-denied" });
  });

  it("rejects malformed model identifiers from direct writers", async () => {
    const invalidRows = [
      ["invalid_model_key", "invalid model", "2026-08-13"],
      ["invalid_model_version", "valid-model", "invalid version"],
    ] as const;
    for (const [label, modelId, modelVersion] of invalidRows) {
      await expect(
        database.query(
          sql(
            `INSERT INTO provider_pricing_versions (
               pricing_version_id, provider_key, model_key, model_version,
               effective_from, cost_currency,
               input_micros_per_million_tokens,
               output_micros_per_million_tokens,
               credit_conversion_numerator, credit_conversion_denominator
             ) VALUES (
               $1, 'test-invalid-model-provider', $2, $3,
               CURRENT_TIMESTAMP + INTERVAL '5 minutes',
               'USD', 1, 1, 1, 1
             )`,
            [testId("pricing", label), modelId, modelVersion],
          ),
        ),
      ).rejects.toThrow(/check constraint|provider_pricing_versions/i);
    }
  });

  it("seeds the versioned beta plan catalog exactly", async () => {
    const plans = await database.query<
      {
        ai_entitlement: string;
        concurrency_limit: string;
        grant_kind: string;
        included_billable_seats: string;
        included_credit_units: string;
        monthly_price_micros: string;
        plan_key: string;
        plan_version_id: string;
        project_limit: string;
        viewer_limit: string;
      } & Record<string, unknown>
    >(
      sql(
        `SELECT definition.plan_key, version.plan_version_id,
                version.proposed_monthly_price_micros::TEXT
                  AS monthly_price_micros,
                included.grant_kind,
                included.credit_units::TEXT AS included_credit_units,
                seats.included_billable_seats::TEXT
                  AS included_billable_seats,
                seats.maximum_nonbillable_viewers::TEXT AS viewer_limit,
                projects.limit_value::TEXT AS project_limit,
                concurrency.limit_value::TEXT AS concurrency_limit,
                ai.entitlement_state AS ai_entitlement
         FROM commercial_plan_definitions definition
         JOIN commercial_plan_versions version
           ON version.plan_id = definition.plan_id
         JOIN commercial_plan_included_credit_grants included
           ON included.plan_version_id = version.plan_version_id
         JOIN commercial_plan_seat_rules seats
           ON seats.plan_version_id = version.plan_version_id
         JOIN commercial_plan_numeric_limits projects
           ON projects.plan_version_id = version.plan_version_id
          AND projects.limit_key = 'projects'
         JOIN commercial_plan_numeric_limits concurrency
           ON concurrency.plan_version_id = version.plan_version_id
          AND concurrency.limit_key = 'concurrent-ai-jobs'
         JOIN commercial_plan_feature_entitlements ai
           ON ai.plan_version_id = version.plan_version_id
          AND ai.feature_key = 'ai-assisted-operations'
         WHERE version.configuration_version =
           'cloudmarkup-beta-plans-2026-08-14-v2'
           AND version.configuration_status = 'proposed-beta-example'
         ORDER BY definition.plan_key`,
      ),
    );

    expect(plans.rows).toEqual([
      {
        ai_entitlement: "enabled",
        concurrency_limit: "2",
        grant_kind: "monthly",
        included_billable_seats: "1",
        included_credit_units: "1000",
        monthly_price_micros: "39000000",
        plan_key: "pro",
        plan_version_id: proPlanVersionId,
        project_limit: "25",
        viewer_limit: "0",
      },
      {
        ai_entitlement: "enabled",
        concurrency_limit: "1",
        grant_kind: "monthly",
        included_billable_seats: "1",
        included_credit_units: "200",
        monthly_price_micros: "9000000",
        plan_key: "starter",
        plan_version_id: "planver_starter_2026_08_14_v1",
        project_limit: "5",
        viewer_limit: "0",
      },
    ]);
  });

  it("persists verified billing event retries and one safe audit outcome", async () => {
    const fixture = await createCommercialFixture(
      "billing_webhook_persistence",
    );
    const other = await createCommercialFixture(
      "billing_webhook_persistence_other",
    );
    const repository = new PostgresBillingPersistence(database);
    const providerCustomerReference = testId(
      "customer",
      "billing_webhook_persistence",
    );
    const providerSubscriptionReference = testId(
      "subscription",
      "billing_webhook_persistence",
    );
    const providerEventReference = testId(
      "stripeevent",
      "billing_webhook_persistence",
    );
    const webhookEventId = testId("webhook", "billing_webhook_persistence");
    const eventPosition = "00000000001786668400:" + providerEventReference;
    const payloadSha256 = digest("safe verified fixture");
    const receivedAt = new Date().toISOString();

    await expect(
      repository.getSessionAccount(fixture.scope),
    ).resolves.toMatchObject({
      billingAccountId: fixture.billingAccountId,
      currentSubscriptionState: "active",
      organizationId: fixture.organizationId,
      providerCustomerReference,
    });
    await expect(
      repository.resolveWebhookTarget({
        billingAccountId: fixture.billingAccountId,
        organizationId: fixture.organizationId,
        providerCustomerReference,
        providerSubscriptionReference,
      }),
    ).resolves.toMatchObject({
      organizationId: fixture.organizationId,
      organizationState: "active",
    });
    await expect(
      repository.resolveWebhookTarget({
        billingAccountId: fixture.billingAccountId,
        organizationId: fixture.organizationId,
        providerCustomerReference: testId(
          "customer",
          "billing_webhook_persistence_other",
        ),
        providerSubscriptionReference: testId(
          "subscription",
          "billing_webhook_persistence_other",
        ),
      }),
    ).resolves.toBeNull();

    const input = {
      eventPosition,
      eventType: "invoice.paid",
      payloadSha256,
      providerEventReference,
      receivedAt,
      webhookEventId,
    } as const;
    await expect(repository.recordWebhookEvent(input)).resolves.toMatchObject({
      lifecycleStatus: "received",
      payloadSha256,
      webhookEventId,
    });
    await expect(repository.recordWebhookEvent(input)).resolves.toMatchObject({
      lifecycleStatus: "received",
    });

    const completion = {
      billingAccountId: fixture.billingAccountId,
      eventPosition,
      eventType: input.eventType,
      organizationId: fixture.organizationId,
      processedAt: new Date().toISOString(),
      providerEventReference,
      status: "processed",
      webhookEventId,
    } as const;
    await repository.completeWebhookEvent(completion);
    await repository.completeWebhookEvent(completion);

    const stored = await database.query<
      {
        attempt_count: number;
        lifecycle_status: string;
        payload_sha256: string;
      } & Record<string, unknown>
    >(
      sql(
        `SELECT attempt_count, lifecycle_status, payload_sha256
         FROM billing_webhook_events
         WHERE webhook_event_id = $1`,
        [webhookEventId],
      ),
    );
    expect(stored.rows).toEqual([
      {
        attempt_count: 2,
        lifecycle_status: "processed",
        payload_sha256: payloadSha256,
      },
    ]);
    const audit = await database.query<
      { count: string } & Record<string, unknown>
    >(
      sql(
        `SELECT COUNT(*)::TEXT AS count
         FROM audit_events
         WHERE audit_event_id = $1
           AND organization_id = $2
           AND target_kind = 'billing-account'
           AND target_id = $3`,
        [
          "audit_billing_" +
            createHash("sha256")
              .update(webhookEventId)
              .digest("hex")
              .slice(0, 48),
          fixture.organizationId,
          fixture.billingAccountId,
        ],
      ),
    );
    expect(audit.rows[0]?.count).toBe("1");
    await expect(
      repository.getCurrentProjection(fixture.organizationId),
    ).resolves.toMatchObject({
      cancelAtPeriodEnd: false,
      organizationId: fixture.organizationId,
    });
    await expect(
      repository.getCurrentEntitlement(fixture.organizationId),
    ).resolves.toMatchObject({
      organizationId: fixture.organizationId,
    });
    expect(other.organizationId).not.toBe(fixture.organizationId);
  });
  it("rejects a direct ledger write whose grant allocations do not reconcile", async () => {
    const fixture = await createCommercialFixture("direct_write");
    const grant = await createPromotionalGrant(fixture, "direct_write", "5");
    const ledgerEntryId = testId("ledger", "mismatched_adjustment");

    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          sql(
            `INSERT INTO usage_ledger_entries (
               organization_id, ledger_entry_id, idempotency_key_sha256,
               entry_kind, billing_account_id, related_ledger_entry_id,
               recorded_by_actor_kind, recorded_by_actor_id,
               credit_adjustment_units, outcome, reason_code, safe_reason,
               charging_policy_version, correlation_id
             ) VALUES (
               $1, $2, $3, 'adjustment', $4, $5,
               'internal-administration', $6,
               -2, 'adjusted', 'test.mismatched-allocation', $7, $8, $9
             )`,
            [
              fixture.organizationId,
              ledgerEntryId,
              digest(testId("idempotency", "mismatched_adjustment")),
              fixture.billingAccountId,
              grant.ledgerEntryId,
              fixture.administrationContext.actorId,
              "Intentional mismatched allocation for integration verification.",
              chargingPolicyVersion,
              fixture.administrationContext.correlationId,
            ],
          ),
        );
        await transaction.query(
          sql(
            `INSERT INTO usage_ledger_entry_allocations (
               organization_id, ledger_entry_id, allocation_sequence,
               credit_grant_id, credit_adjustment_units
             ) VALUES ($1, $2, 1, $3, -1)`,
            [fixture.organizationId, ledgerEntryId, grant.creditGrantId],
          ),
        );
      }),
    ).rejects.toThrow(/reconcil/i);

    const rolledBack = await database.query<
      { count: string } & Record<string, unknown>
    >(
      sql(
        `SELECT COUNT(*)::TEXT AS count FROM usage_ledger_entries
         WHERE organization_id = $1 AND ledger_entry_id = $2`,
        [fixture.organizationId, ledgerEntryId],
      ),
    );
    expect(rolledBack.rows[0]?.count).toBe("0");
  });

  it("rejects a direct credit grant without its reciprocal funding ledger event", async () => {
    const fixture = await createCommercialFixture("unledgered_grant");
    const creditGrantId = testId("grant", "unledgered_direct_write");
    const missingGuardError = new Error(
      "Expected the reciprocal credit-grant funding guard to reject the write.",
    );
    let rejection: unknown;

    try {
      await database.transaction(async (transaction) => {
        await transaction.query(
          sql(
            `INSERT INTO credit_grants (
               credit_grant_id, organization_id, billing_account_id,
               grant_kind, credit_units, starts_at,
               expiration_policy_kind, expiration_policy_version,
               consumption_priority, source_reference, grant_policy_version,
               idempotency_key_sha256, created_by_actor_kind,
               created_by_actor_id
             ) VALUES (
               $1, $2, $3, 'promotional', 5,
               CURRENT_TIMESTAMP - INTERVAL '1 minute',
               'does-not-expire', $4, 100, $5, $6, $7,
               'internal-accounting', $8
             )`,
            [
              creditGrantId,
              fixture.organizationId,
              fixture.billingAccountId,
              expirationPolicyVersion,
              testId("grant-source", "unledgered_direct_write"),
              grantPolicyVersion,
              digest(testId("idempotency", "unledgered_direct_write")),
              fixture.accountingContext.actorId,
            ],
          ),
        );
        await transaction.query(sql("SET CONSTRAINTS ALL IMMEDIATE"));
        throw missingGuardError;
      });
    } catch (error: unknown) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).not.toBe(missingGuardError);
    if (rejection instanceof Error) {
      expect(rejection.message).toMatch(/funding|grant|ledger|reconcil/i);
    }
    const rolledBack = await database.query<
      { count: string } & Record<string, unknown>
    >(
      sql(
        `SELECT COUNT(*)::TEXT AS count FROM credit_grants
         WHERE organization_id = $1 AND credit_grant_id = $2`,
        [fixture.organizationId, creditGrantId],
      ),
    );
    expect(rolledBack.rows[0]?.count).toBe("0");
  });

  it("rejects positive direct adjustments assigned to an ordinary grant", async () => {
    const fixture = await createCommercialFixture(
      "positive_ordinary_adjustment",
    );
    const grant = await createPromotionalGrant(
      fixture,
      "positive_ordinary_adjustment",
      "5",
    );

    await expect(
      database.transaction(async (transaction) => {
        await insertDirectAdjustment(
          transaction,
          fixture,
          grant,
          "positive_ordinary_adjustment",
          "1",
        );
      }),
    ).rejects.toThrow(/positive credit adjustment.*administrative grant/i);
  });

  it("rejects negative direct adjustments that overdraw one grant", async () => {
    const fixture = await createCommercialFixture("negative_grant_overdraw");
    const grant = await createPromotionalGrant(
      fixture,
      "negative_grant_overdraw",
      "5",
    );
    const ledgerEntryId = testId(
      "ledger_adjustment",
      "negative_grant_overdraw",
    );

    await expect(
      database.transaction(async (transaction) => {
        await insertDirectAdjustment(
          transaction,
          fixture,
          grant,
          "negative_grant_overdraw",
          "-6",
        );
      }),
    ).rejects.toThrow(/overdraw its grant/i);
    const rolledBack = await database.query<
      { count: string } & Record<string, unknown>
    >(
      sql(
        `SELECT COUNT(*)::TEXT AS count FROM usage_ledger_entries
         WHERE organization_id = $1 AND ledger_entry_id = $2`,
        [fixture.organizationId, ledgerEntryId],
      ),
    );
    expect(rolledBack.rows[0]?.count).toBe("0");
  });

  it("rejects reservation ledger allocations mapped to a different grant", async () => {
    const fixture = await createCommercialFixture("moved_reservation_grant");
    const pricing = await createPricing(fixture, "moved_reservation_grant");
    const reservationGrant = await createPromotionalGrant(
      fixture,
      "reservation_grant",
      "5",
    );
    const ledgerGrant = await createPromotionalGrant(
      fixture,
      "ledger_grant",
      "5",
    );

    await expect(
      database.transaction(async (transaction) => {
        await insertDirectReservation(
          transaction,
          fixture,
          pricing,
          "moved_reservation_grant",
          reservationGrant.creditGrantId,
          "2",
          ledgerGrant.creditGrantId,
        );
      }),
    ).rejects.toThrow(/reservation allocation evidence does not reconcile/i);
  });

  it("rejects settled allocation units while the reservation remains active", async () => {
    const fixture = await createCommercialFixture("active_settlement");
    const pricing = await createPricing(fixture, "active_settlement");
    await createPromotionalGrant(fixture, "active_settlement", "5");
    const input = createReservationInput(
      fixture,
      pricing,
      "active_settlement",
      "2",
    );
    await fixture.repository.reserveCredits(fixture.scope, input);

    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          sql(
            `UPDATE credit_reservation_allocations
             SET settled_credit_units = reserved_credit_units
             WHERE organization_id = $1 AND reservation_id = $2`,
            [fixture.organizationId, input.reservationId],
          ),
        );
        await transaction.query(sql("SET CONSTRAINTS ALL IMMEDIATE"));
      }),
    ).rejects.toThrow(/allocation state does not reconcile/i);

    const allocation = await database.query<
      { settled_credit_units: string } & Record<string, unknown>
    >(
      sql(
        `SELECT settled_credit_units::TEXT AS settled_credit_units
         FROM credit_reservation_allocations
         WHERE organization_id = $1 AND reservation_id = $2`,
        [fixture.organizationId, input.reservationId],
      ),
    );
    expect(allocation.rows[0]?.settled_credit_units).toBe("0");
  });

  it("rejects a direct expiration before the reservation expiry", async () => {
    const fixture = await createCommercialFixture("premature_expiration");
    const pricing = await createPricing(fixture, "premature_expiration");
    await createPromotionalGrant(fixture, "premature_expiration", "5");
    const input = createReservationInput(
      fixture,
      pricing,
      "premature_expiration",
      "2",
    );
    await fixture.repository.reserveCredits(fixture.scope, input);

    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          sql(
            `UPDATE credit_reservations
             SET status = 'expired',
                 terminal_request_sha256 = $1,
                 terminal_idempotency_key_sha256 = $2,
                 terminal_ledger_entry_id = $3,
                 terminal_payload_sha256 = $4,
                 terminal_at = CURRENT_TIMESTAMP,
                 record_version = record_version + 1
             WHERE organization_id = $5 AND reservation_id = $6`,
            [
              digest(testId("terminal-request", "premature_expiration")),
              digest(testId("terminal-idempotency", "premature_expiration")),
              testId("ledger", "premature_expiration"),
              digest(testId("terminal-payload", "premature_expiration")),
              fixture.organizationId,
              input.reservationId,
            ],
          ),
        );
      }),
    ).rejects.toThrow(/check constraint|credit_reservations/i);

    const reservation = await database.query<
      { status: string } & Record<string, unknown>
    >(
      sql(
        `SELECT status FROM credit_reservations
         WHERE organization_id = $1 AND reservation_id = $2`,
        [fixture.organizationId, input.reservationId],
      ),
    );
    expect(reservation.rows[0]?.status).toBe("active");
  });

  it("rejects a direct reservation allocation that overdraws its grant", async () => {
    const fixture = await createCommercialFixture("direct_overdraw");
    const pricing = await createPricing(fixture, "direct_overdraw");
    const grant = await createPromotionalGrant(fixture, "direct_overdraw", "5");
    await fixture.repository.reserveCredits(
      fixture.scope,
      createReservationInput(fixture, pricing, "direct_overdraw_existing", "4"),
    );

    await expect(
      database.transaction(async (transaction) => {
        await insertDirectReservation(
          transaction,
          fixture,
          pricing,
          "direct_overdraw_attempt",
          grant.creditGrantId,
          "2",
        );
      }),
    ).rejects.toThrow(/overdraw its grant/i);
  });

  it("serializes concurrent direct reservations against one grant balance", async () => {
    const fixture = await createCommercialFixture("concurrent_direct_overdraw");
    const pricing = await createPricing(fixture, "concurrent_direct_overdraw");
    const grant = await createPromotionalGrant(
      fixture,
      "concurrent_direct_overdraw",
      "3",
    );

    const attempts = await Promise.allSettled([
      database.transaction((transaction) =>
        insertDirectReservation(
          transaction,
          fixture,
          pricing,
          "concurrent_direct_overdraw_first",
          grant.creditGrantId,
          "2",
        ),
      ),
      database.transaction((transaction) =>
        insertDirectReservation(
          transaction,
          fixture,
          pricing,
          "concurrent_direct_overdraw_second",
          grant.creditGrantId,
          "2",
        ),
      ),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    const rejection = attempts.find((attempt) => attempt.status === "rejected");
    if (rejection?.status !== "rejected") {
      throw new Error("Expected one direct grant-overdraw rejection.");
    }
    expect(rejection.reason).toBeInstanceOf(Error);
    if (rejection.reason instanceof Error) {
      expect(rejection.reason.message).toMatch(/overdraw its grant/i);
    }

    const active = await database.query<
      { count: string; reserved: string } & Record<string, unknown>
    >(
      sql(
        `SELECT COUNT(*)::TEXT AS count,
                COALESCE(SUM(allocation.reserved_credit_units), 0)::TEXT
                  AS reserved
         FROM credit_reservation_allocations allocation
         JOIN credit_reservations reservation
           ON reservation.organization_id = allocation.organization_id
          AND reservation.reservation_id = allocation.reservation_id
         WHERE allocation.organization_id = $1
           AND allocation.credit_grant_id = $2
           AND reservation.status = 'active'`,
        [fixture.organizationId, grant.creditGrantId],
      ),
    );
    expect(active.rows[0]).toMatchObject({ count: "1", reserved: "2" });
  });

  it("serializes concurrent overlapping provider pricing windows", async () => {
    const fixture = await createCommercialFixture("pricing_overlap");
    const providerKey = "test-overlap-provider";
    const modelId = testId("model", "pricing_overlap");
    const modelVersion = "2026-08-13";
    const effectiveFrom = Date.now() + 5 * 60_000;
    const commonPricing = {
      costCurrency: "USD",
      creditConversionDenominator: "1",
      creditConversionNumerator: "1",
      inputMicrosPerMillionTokens: "1000000",
      modelId,
      modelVersion,
      outputMicrosPerMillionTokens: "2000000",
      providerKey,
    } as const;

    const attempts = await Promise.allSettled([
      fixture.repository.createProviderPricingVersion(
        fixture.administrationContext,
        {
          ...commonPricing,
          effectiveFrom: new Date(effectiveFrom).toISOString(),
          effectiveUntil: new Date(effectiveFrom + 60 * 60_000).toISOString(),
          pricingVersionId: testId("pricing", "overlap_first"),
        },
      ),
      fixture.repository.createProviderPricingVersion(
        fixture.administrationContext,
        {
          ...commonPricing,
          effectiveFrom: new Date(effectiveFrom + 60_000).toISOString(),
          effectiveUntil: new Date(
            effectiveFrom + 2 * 60 * 60_000,
          ).toISOString(),
          pricingVersionId: testId("pricing", "overlap_second"),
        },
      ),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    if (
      rejected?.status !== "rejected" ||
      !(rejected.reason instanceof CommercialPersistenceError)
    ) {
      throw new Error("Expected one typed pricing-overlap rejection.");
    }
    expect(rejected.reason.code).toBe("idempotency-conflict");

    const stored = await database.query<
      { count: string } & Record<string, unknown>
    >(
      sql(
        `SELECT COUNT(*)::TEXT AS count FROM provider_pricing_versions
         WHERE provider_key = $1 AND model_key = $2 AND model_version = $3`,
        [providerKey, modelId, modelVersion],
      ),
    );
    expect(stored.rows[0]?.count).toBe("1");
  });

  it("allocates the earliest-expiring grant first", async () => {
    const fixture = await createCommercialFixture("earliest_expiry");
    const pricing = await createPricing(fixture, "earliest_expiry");
    const later = await createPromotionalGrant(
      fixture,
      "expires_later",
      "5",
      new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    );
    const earlier = await createPromotionalGrant(
      fixture,
      "expires_earlier",
      "3",
      new Date(Date.now() + 60 * 60_000).toISOString(),
    );

    const reservation = await fixture.repository.reserveCredits(
      fixture.scope,
      createReservationInput(fixture, pricing, "earliest_expiry", "4"),
    );

    expect(reservation.allocations).toEqual([
      {
        allocationSequence: "1",
        creditGrantId: earlier.creditGrantId,
        reservedCreditUnits: "3",
        settledCreditUnits: "0",
      },
      {
        allocationSequence: "2",
        creditGrantId: later.creditGrantId,
        reservedCreditUnits: "1",
        settledCreditUnits: "0",
      },
    ]);
  });

  it("prevents two concurrent reservations from overspending one shared pool", async () => {
    const fixture = await createCommercialFixture("shared_pool");
    const pricing = await createPricing(fixture, "shared_pool");
    await createPromotionalGrant(fixture, "shared_pool", "5");

    const attempts = await Promise.allSettled([
      fixture.repository.reserveCredits(
        fixture.scope,
        createReservationInput(fixture, pricing, "shared_pool_first", "4"),
      ),
      fixture.repository.reserveCredits(
        fixture.scope,
        createReservationInput(fixture, pricing, "shared_pool_second", "4"),
      ),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    if (
      rejected?.status !== "rejected" ||
      !(rejected.reason instanceof CommercialPersistenceError)
    ) {
      throw new Error("Expected one typed shared-pool rejection.");
    }
    expect(rejected.reason.code).toBe("insufficient-credits");

    const active = await database.query<
      { count: string; reserved: string } & Record<string, unknown>
    >(
      sql(
        `SELECT COUNT(*)::TEXT AS count,
                COALESCE(SUM(reserved_credit_units), 0)::TEXT AS reserved
         FROM credit_reservations
         WHERE organization_id = $1 AND status = 'active'`,
        [fixture.organizationId],
      ),
    );
    expect(active.rows[0]).toMatchObject({ count: "1", reserved: "4" });
  });

  it("terminalizes the later of two same-sequence reservations independently", async () => {
    const fixture = await createCommercialFixture("terminal_sequence_scope");
    const pricing = await createPricing(fixture, "terminal_sequence_scope");
    const grant = await createPromotionalGrant(
      fixture,
      "terminal_sequence_scope",
      "10",
    );
    const firstInput = createReservationInput(
      fixture,
      pricing,
      "terminal_sequence_first",
      "2",
    );
    const secondInput = createReservationInput(
      fixture,
      pricing,
      "terminal_sequence_second",
      "2",
    );
    const first = await fixture.repository.reserveCredits(
      fixture.scope,
      firstInput,
    );
    const second = await fixture.repository.reserveCredits(
      fixture.scope,
      secondInput,
    );
    expect(first.allocations[0]?.allocationSequence).toBe("1");
    expect(second.allocations[0]?.allocationSequence).toBe("1");

    const terminalLedgerEntryId = testId("ledger", "terminal_sequence_second");
    const released = await fixture.repository.releaseReservation(
      fixture.accountingContext,
      {
        chargingPolicyVersion,
        chargingScenario: "user-cancelled-before-invocation",
        idempotencyKey: testId(
          "terminal-idempotency",
          "terminal_sequence_second",
        ),
        ledgerEntryId: terminalLedgerEntryId,
        reasonCode: "usage.user-cancelled",
        requestId: secondInput.requestId,
        requestSha256: secondInput.requestSha256,
        reservationId: secondInput.reservationId,
      },
    );
    expect(released).toMatchObject({
      reservationId: secondInput.reservationId,
      status: "released",
    });
    expect(released.allocations).toEqual([
      {
        allocationSequence: "1",
        creditGrantId: grant.creditGrantId,
        reservedCreditUnits: "2",
        settledCreditUnits: "0",
      },
    ]);

    const states = await database.query<
      { reservation_id: string; status: string } & Record<string, unknown>
    >(
      sql(
        `SELECT reservation_id, status FROM credit_reservations
         WHERE organization_id = $1 AND reservation_id IN ($2, $3)
         ORDER BY reservation_id`,
        [
          fixture.organizationId,
          firstInput.reservationId,
          secondInput.reservationId,
        ],
      ),
    );
    expect(states.rows).toEqual(
      expect.arrayContaining([
        { reservation_id: firstInput.reservationId, status: "active" },
        { reservation_id: secondInput.reservationId, status: "released" },
      ]),
    );
    const terminalAllocation = await database.query<
      { credit_grant_id: string; released_credit_units: string } & Record<
        string,
        unknown
      >
    >(
      sql(
        `SELECT credit_grant_id,
                released_credit_units::TEXT AS released_credit_units
         FROM usage_ledger_entry_allocations
         WHERE organization_id = $1 AND ledger_entry_id = $2`,
        [fixture.organizationId, terminalLedgerEntryId],
      ),
    );
    expect(terminalAllocation.rows).toEqual([
      { credit_grant_id: grant.creditGrantId, released_credit_units: "2" },
    ]);
  });

  it("replays two concurrent attempts with one idempotency identity", async () => {
    const fixture = await createCommercialFixture("idempotent_reservation");
    const pricing = await createPricing(fixture, "idempotent_reservation");
    await createPromotionalGrant(fixture, "idempotent_reservation", "5");
    const input = createReservationInput(
      fixture,
      pricing,
      "idempotent_reservation",
      "4",
    );

    const attempts = await Promise.allSettled([
      fixture.repository.reserveCredits(fixture.scope, input),
      fixture.repository.reserveCredits(fixture.scope, input),
    ]);
    for (const attempt of attempts) {
      expect(attempt.status).toBe("fulfilled");
      if (attempt.status === "fulfilled") {
        expect(attempt.value.reservationId).toBe(input.reservationId);
      }
    }

    const stored = await database.query<
      { ledger_count: string; reservation_count: string } & Record<
        string,
        unknown
      >
    >(
      sql(
        `SELECT
           (SELECT COUNT(*)::TEXT FROM credit_reservations
            WHERE organization_id = $1 AND reservation_id = $2)
             AS reservation_count,
           (SELECT COUNT(*)::TEXT FROM usage_ledger_entries
            WHERE organization_id = $1 AND reservation_id = $2
              AND entry_kind = 'reservation') AS ledger_count`,
        [fixture.organizationId, input.reservationId],
      ),
    );
    expect(stored.rows[0]).toMatchObject({
      ledger_count: "1",
      reservation_count: "1",
    });
  });
});
const explicitlyRequested = process.argv.some((argument) =>
  argument.includes("postgres.integration.test"),
);

if (databaseUrl === undefined && explicitlyRequested) {
  throw new Error(
    "CLOUDMARKUP_TEST_DATABASE_URL is required for the dedicated PostgreSQL integration suite.",
  );
}
