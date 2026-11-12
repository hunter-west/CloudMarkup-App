import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { permissionsForRole } from "../../application/authorization.js";
import type {
  CreateCreditGrantInput,
  TrustedCommercialAccountingContext,
  TrustedCommercialAdministrationContext,
} from "../../application/commercial-persistence.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

class RecordingDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  readonly #results: SqlResult[];

  constructor(results: readonly SqlResult[]) {
    this.#results = [...results];
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("Missing controlled commercial SQL result.");
    }
    return Promise.resolve(result as SqlResult<TRow>);
  }

  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this);
  }
}

function result(
  rows: readonly SqlRow[] = [],
  rowCount = rows.length,
): SqlResult {
  return { rowCount, rows };
}

const organizationId = "organization_commercial_test";
const principalId = "principal_commercial_test";
const membershipId = "membership_commercial_test";
const billingAccountId = "billing_commercial_test";
const reservationId = "reservation_commercial_test";
const digest = createHash("sha256").update("commercial-test").digest("hex");

const scope: AuthorizedOrganizationScope = {
  capabilities: permissionsForRole("owner"),
  correlationId: "correlation_commercial_test",
  membershipId,
  organizationId,
  principalId,
  roleKey: "owner",
  sessionId: "session_commercial_test",
};

const accountingContext: TrustedCommercialAccountingContext = {
  actorId: "worker_commercial_accounting",
  authority: "internal-accounting",
  correlationId: "correlation_commercial_accounting",
  organizationId,
};

const administrationContext: TrustedCommercialAdministrationContext = {
  actorId: "worker_commercial_administration",
  actorPrincipalId: principalId,
  authority: "internal-administration",
  correlationId: "correlation_commercial_administration",
  organizationId,
};

const billingAccountRow = {
  billing_account_id: billingAccountId,
  expensive_operations_enabled: true,
  lifecycle_status: "active",
  organization_id: organizationId,
  record_version: "1",
};

const entitlementRow = {
  billing_account_id: billingAccountId,
  effective_at: "2026-08-03T00:00:00.000Z",
  entitlement_policy_version: "commercial-v1",
  entitlement_snapshot_id: "entitlement_commercial_test",
  entitlement_state: "enabled",
  expensive_operations_enabled: true,
  organization_id: organizationId,
  plan_version_id: "plan-version_pro_beta-v1",
  record_version: "1",
  source_record_version: "1",
  subscription_projection_id: null,
};

function reservationRow(
  status: "active" | "settled" | "released" | "expired" = "active",
  overrides: Readonly<Record<string, unknown>> = {},
): SqlRow {
  return {
    acting_principal_id: principalId,
    billing_account_id: billingAccountId,
    charging_policy_version: "charging-v1",
    created_at: "2026-08-03T12:00:00.000Z",
    entitlement_policy_version: "commercial-v1",
    entitlement_snapshot_id: "entitlement_commercial_test",
    expires_at: "2026-08-03T12:10:00.000Z",
    feature_key: "ai-assisted-operations",
    idempotency_key_sha256: digest,
    is_expired: status === "expired",
    job_id: "job_commercial_test",
    model_key: "model-commercial-test",
    model_version: "2026-08-01",
    organization_id: organizationId,
    plan_version_id: "plan-version_pro_beta-v1",
    pricing_version_id: "pricing_commercial_test",
    project_id: "project_commercial_test",
    provider_key: "model-provider",
    record_version: status === "active" ? "1" : "2",
    request_id: "request_commercial_test",
    request_sha256: digest,
    requested_credit_units: "5",
    reservation_id: reservationId,
    reserved_credit_units: "5",
    status,
    terminal_at: status === "active" ? null : "2026-08-03T12:01:00.000Z",
    terminal_idempotency_key_sha256: null,
    terminal_ledger_entry_id:
      status === "active" ? null : "ledger_terminal_commercial_test",
    terminal_payload_sha256: status === "active" ? null : digest,
    terminal_request_sha256: null,
    ...overrides,
  };
}

const grantBase = {
  billing_account_id: billingAccountId,
  consumption_priority: 100,
  credit_units: "10",
  expires_at: "2026-08-31T23:59:59.000Z",
  grant_kind: "monthly",
  organization_id: organizationId,
  plan_version_id: "plan-version_pro_beta-v1",
  source_reference: "period_2026_08",
  starts_at: "2026-08-01T00:00:00.000Z",
};

const monthlyGrantInput: CreateCreditGrantInput = {
  chargingPolicyVersion: "charging-v1",
  consumptionPriority: "100",
  creditGrantId: "grant_paid_period",
  creditUnits: "1000",
  expirationPolicy: {
    kind: "expires-at",
    expiresAt: "2026-10-01T00:00:00.000Z",
    policyVersion: "monthly-expiry-v1",
  },
  grantKind: "monthly",
  grantPolicyVersion: "included-grant-v1",
  idempotencyKey: "paid-period-grant",
  ledgerEntryId: "ledger_paid_period",
  planVersionId: "plan-version_pro_beta-v1",
  reasonCode: "billing.subscription-period.grant",
  sourceReference: "sub_paid_period:period_2026_09",
  startsAt: "2026-09-01T00:00:00.000Z",
  subscriptionPeriod: {
    periodId: "period_2026_09",
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: "2026-10-01T00:00:00.000Z",
  },
};
const monthlySubscriptionRow = {
  current_period_id: "period_2026_09",
  current_period_start: "2026-09-01T00:00:00.000Z",
  current_period_end: "2026-10-01T00:00:00.000Z",
  effective_at: "2026-09-05T12:00:00.000Z",
  normalized_status: "active",
  plan_version_id: "plan-version_pro_beta-v1",
};
function grantSourceResults(subscription: SqlRow = monthlySubscriptionRow) {
  return [
    result([billingAccountRow]),
    result(),
    result(),
    result([{ credit_units: "1000" }]),
    result([subscription]),
  ];
}

describe("commercial PostgreSQL repository", () => {
  it("keeps complete expiration totals while bounding historical grant details", async () => {
    const asOf = "2026-08-03T12:00:00.000Z";
    const windowEndsAt = "2026-08-31T00:00:00.000Z";
    const grant = (id: string, overrides: SqlRow = {}): SqlRow => ({
      ...grantBase,
      credit_grant_id: id,
      grant_kind: "promotional",
      expiration_policy_kind: "expires-at",
      expiration_policy_version: "expiry_test_v1",
      grant_policy_version: "promotional-v1",
      starts_at: "2026-08-01T00:00:00.000Z",
      expires_at: "2026-08-10T00:00:00.000Z",
      trial_grant_admitted: true,
      adjustments: "0",
      settled: "0",
      active_reserved: "0",
      ...overrides,
    });
    const current = grant("grant_current");
    const mixed = [
      current,
      grant("grant_reserved", { active_reserved: "3" }),
      grant("grant_exhausted", {
        settled: "10",
        expires_at: "2026-08-04T00:00:00.000Z",
      }),
      grant("grant_scheduled", {
        starts_at: "2026-08-20T00:00:00.000Z",
        expires_at: "2026-08-25T00:00:00.000Z",
      }),
      grant("grant_unresolved", {
        expiration_policy_kind: "unresolved",
        expires_at: null,
      }),
      grant("grant_trial_refused", {
        trial_grant_admitted: false,
        expires_at: "2026-08-05T00:00:00.000Z",
      }),
      grant("grant_adjusted", {
        grant_kind: "administrative",
        adjustments: "5",
      }),
    ];
    // The SQL double supplies complete aggregates and a bounded detail page.
    // Query-shape assertions below are not native PostgreSQL execution.
    for (const scenario of [
      {
        historical: 1000,
        current: [current],
        total: "10",
        next: current["expires_at"],
        truncated: true,
      },
      {
        historical: 999,
        current: [current],
        total: "10",
        next: current["expires_at"],
        truncated: false,
      },
      {
        historical: 1000,
        current: mixed,
        total: "22",
        next: mixed[2]?.["expires_at"],
        truncated: true,
      },
      {
        historical: 0,
        current: [],
        total: "0",
        next: undefined,
        truncated: false,
      },
    ]) {
      const all = [
        ...Array.from({ length: scenario.historical }, (_, i) =>
          grant(`grant_old_${String(i).padStart(4, "0")}`, {
            expires_at: "2026-08-02T00:00:00.000Z",
          }),
        ),
        ...scenario.current,
        grant("grant_foreign", {
          organization_id: "organization_other",
          credit_units: "9000",
        }),
      ];
      const scoped = all.filter(
        (row) => row["organization_id"] === organizationId,
      );
      const details = scoped.slice(0, 1000).map((row) => ({
        ...row,
        summary_expiring: scenario.total,
        summary_next_expiration: scenario.next ?? null,
        summary_grant_count: String(scoped.length),
      }));
      const database = new RecordingDatabase([
        result(),
        result([{ allowed: 1 }]),
        result([{ as_of: asOf }]),
        result(details),
      ]);
      const repository = new PostgresCommercialPersistenceRepository(database);
      const summary = await repository.getCreditGrantExpirationSummary(
        scope,
        windowEndsAt,
      );
      expect(summary.expiringCreditUnits).toBe(scenario.total);
      expect(summary).toMatchObject({
        organizationId,
        asOf,
        windowEndsAt,
        grantsTruncated: scenario.truncated,
      });
      expect(summary.nextExpirationAt).toBe(scenario.next);
      expect(summary.grants).toHaveLength(Math.min(scoped.length, 1000));
      expect(summary.grants.some((row) => row.id === "grant_foreign")).toBe(
        false,
      );
      if (scenario.historical === 999)
        expect(summary.grants[999]).toMatchObject({
          id: "grant_current",
          availableCreditUnits: "10",
        });
      expect(database.statements).toHaveLength(4);
      expect(database.statements[0]?.text).toBe(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      expect(database.statements[1]?.values).toEqual([
        membershipId,
        principalId,
        organizationId,
        "commercial.summary.read",
      ]);
      expect(database.statements[2]?.values).toEqual([
        membershipId,
        principalId,
        organizationId,
      ]);
      const query = database.statements[3];
      expect(query?.values).toEqual([organizationId, asOf, windowEndsAt]);
      expect(query?.text).toContain("WHERE grant_row.organization_id = $1");
      expect(
        query?.text.match(/allocation.organization_id = \$1/gu),
      ).toHaveLength(2);
      expect(query?.text).toContain("AND grant_row.created_at <= $2");
      expect(query?.text).toContain("COUNT(*) OVER () AS summary_grant_count");
      expect(query?.text).toContain("END) OVER () AS summary_expiring");
      expect(query?.text).toContain("END) OVER () AS summary_next_expiration");
      expect(query?.text).toContain("trial_grant_admitted");
      expect(query?.text.match(/LIMIT/gu)).toHaveLength(1);
      expect(query?.text.trim()).toMatch(
        /ORDER BY grant_row\.expires_at NULLS LAST,\s*grant_row\.starts_at, grant_row\.credit_grant_id LIMIT 1000$/u,
      );
    }
    const overflow = new RecordingDatabase([
      result(),
      result([{ allowed: 1 }]),
      result([{ as_of: asOf }]),
      result([
        {
          ...current,
          summary_expiring: "9223372036854775808",
          summary_grant_count: "1",
          summary_next_expiration: current["expires_at"],
        },
      ]),
    ]);
    await expect(
      new PostgresCommercialPersistenceRepository(
        overflow,
      ).getCreditGrantExpirationSummary(scope, windowEndsAt),
    ).rejects.toMatchObject({ code: "invalid-input" });
    const denied = new RecordingDatabase([result(), result()]);
    await expect(
      new PostgresCommercialPersistenceRepository(
        denied,
      ).getCreditGrantExpirationSummary(scope, windowEndsAt),
    ).rejects.toBeInstanceOf(CommercialPersistenceError);
    expect(denied.statements).toHaveLength(2);
  });
  it("grants the exact current monthly period when its provider event became effective after period start", async () => {
    const database = new RecordingDatabase([
      ...grantSourceResults(),
      result([
        {
          ...grantBase,
          credit_grant_id: monthlyGrantInput.creditGrantId,
          credit_units: monthlyGrantInput.creditUnits,
          expiration_policy_kind: "expires-at",
          expiration_policy_version: "monthly-expiry-v1",
          expires_at: monthlySubscriptionRow.current_period_end,
          grant_policy_version: monthlyGrantInput.grantPolicyVersion,
          source_reference: monthlyGrantInput.sourceReference,
          starts_at: monthlyGrantInput.startsAt,
          subscription_period_id: monthlySubscriptionRow.current_period_id,
          subscription_period_start:
            monthlySubscriptionRow.current_period_start,
          subscription_period_end: monthlySubscriptionRow.current_period_end,
        },
      ]),
      result([{ ledger_entry_id: monthlyGrantInput.ledgerEntryId }]),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);
    await expect(
      repository.createCreditGrant(accountingContext, monthlyGrantInput),
    ).resolves.toMatchObject({
      creditGrantId: monthlyGrantInput.creditGrantId,
      creditUnits: "1000",
      startsAt: monthlyGrantInput.startsAt,
      subscriptionPeriod: monthlyGrantInput.subscriptionPeriod,
    });
    const sourceQuery = database.statements.find((statement) =>
      statement.text.includes("FROM organization_subscription_projections"),
    );
    expect(sourceQuery?.values).toEqual([organizationId, billingAccountId]);
    expect(sourceQuery?.text).toContain("FOR UPDATE");
    const planQuery = database.statements.find((statement) =>
      statement.text.includes("FROM commercial_plan_included_credit_grants"),
    );
    expect(planQuery?.text).toContain("version.effective_from <= $3");
    expect(planQuery?.text).toContain("version.effective_until > $3");
    expect(planQuery?.values).toEqual([
      monthlyGrantInput.planVersionId,
      "monthly",
      monthlyGrantInput.startsAt,
    ]);
    expect(
      database.statements.filter((statement) =>
        statement.text.includes("INSERT INTO credit_grants"),
      ),
    ).toHaveLength(1);
    expect(
      database.statements.filter((statement) =>
        statement.text.includes("INSERT INTO usage_ledger_entries"),
      ),
    ).toHaveLength(1);
  });

  it.each([
    { current_period_id: "period_older" },
    { current_period_start: "2026-08-01T00:00:00.000Z" },
    { current_period_end: "2026-09-01T00:00:00.000Z" },
    { current_period_id: null },
    { normalized_status: "canceled" },
    { plan_version_id: "plan-version_starter_beta-v1" },
  ])(
    "retains current-period and active-plan checks for a delayed monthly grant: %j",
    async (override) => {
      const database = new RecordingDatabase(
        grantSourceResults({ ...monthlySubscriptionRow, ...override }),
      );
      const repository = new PostgresCommercialPersistenceRepository(database);
      await expect(
        repository.createCreditGrant(accountingContext, monthlyGrantInput),
      ).rejects.toMatchObject({ code: "invalid-input" });
      expect(
        database.statements.some((statement) =>
          statement.text.includes("INSERT INTO"),
        ),
      ).toBe(false);
    },
  );

  it.each(["2026-08-31T23:59:59.000Z", "2026-10-01T00:00:00.000Z"])(
    "rejects a monthly grant start outside its explicit period: %s",
    async (startsAt) => {
      const database = new RecordingDatabase([]);
      const repository = new PostgresCommercialPersistenceRepository(database);
      await expect(
        repository.createCreditGrant(accountingContext, {
          ...monthlyGrantInput,
          startsAt,
        }),
      ).rejects.toMatchObject({ code: "invalid-input" });
      expect(database.statements).toHaveLength(0);
    },
  );

  it("does not relax the effective-time restriction for one-time included grants", async () => {
    const database = new RecordingDatabase(grantSourceResults());
    const repository = new PostgresCommercialPersistenceRepository(database);
    const oneTime = { ...monthlyGrantInput };
    delete oneTime.subscriptionPeriod;
    await expect(
      repository.createCreditGrant(accountingContext, {
        ...oneTime,
        grantKind: "one-time",
      }),
    ).rejects.toMatchObject({
      code: "invalid-input",
      message: "The included credit grant subscription source is not current.",
    });
    expect(
      database.statements.some((statement) =>
        statement.text.includes("INSERT INTO"),
      ),
    ).toBe(false);
  });

  it("closes the open pricing predecessor before appending its successor", async () => {
    const effectiveFrom = "2026-09-01T00:00:00.000Z";
    const createdRow = {
      cached_input_micros_per_million_tokens: "50",
      cost_currency: "USD",
      created_at: "2026-08-03T12:00:00.000Z",
      credit_conversion_denominator: "1",
      credit_conversion_numerator: "2",
      effective_from: effectiveFrom,
      effective_until: null,
      input_micros_per_million_tokens: "100",
      model_key: "model-commercial-test",
      model_version: "2026-08-01",
      output_micros_per_million_tokens: "200",
      pricing_version_id: "pricing_successor_test",
      provider_key: "model-provider",
    };
    const database = new RecordingDatabase([
      result(),
      result(),
      result([
        {
          effective_from: "2026-08-01T00:00:00.000Z",
          effective_until: null,
          pricing_version_id: "pricing_predecessor_test",
        },
      ]),
      result([{ is_current_or_future: true }]),
      result([], 1),
      result(),
      result([createdRow]),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(
      repository.createProviderPricingVersion(administrationContext, {
        cachedInputMicrosPerMillionTokens: "50",
        costCurrency: "USD",
        creditConversionDenominator: "1",
        creditConversionNumerator: "2",
        effectiveFrom,
        inputMicrosPerMillionTokens: "100",
        modelId: "model-commercial-test",
        modelVersion: "2026-08-01",
        outputMicrosPerMillionTokens: "200",
        pricingVersionId: "pricing_successor_test",
        providerKey: "model-provider",
      }),
    ).resolves.toMatchObject({
      effectiveFrom,
      modelId: "model-commercial-test",
      pricingVersionId: "pricing_successor_test",
    });

    const closeIndex = database.statements.findIndex((statement) =>
      statement.text.includes("UPDATE provider_pricing_versions"),
    );
    const insertIndex = database.statements.findIndex((statement) =>
      statement.text.includes("INSERT INTO provider_pricing_versions"),
    );
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(closeIndex);
    expect(database.statements[closeIndex]?.values).toEqual([
      effectiveFrom,
      "pricing_predecessor_test",
      "model-provider",
      "model-commercial-test",
      "2026-08-01",
    ]);
    const pricingLock = database.statements.find((statement) =>
      statement.text.includes("pg_advisory_xact_lock"),
    );
    expect(pricingLock?.values).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
  });

  it("rejects model identities outside the shared safe-string grammar", async () => {
    const database = new RecordingDatabase([]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(
      repository.createProviderPricingVersion(administrationContext, {
        costCurrency: "USD",
        creditConversionDenominator: "1",
        creditConversionNumerator: "1",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        inputMicrosPerMillionTokens: "1",
        modelId: "model identity with spaces",
        modelVersion: "2026-08-01",
        outputMicrosPerMillionTokens: "1",
        pricingVersionId: "pricing_invalid_model_test",
        providerKey: "model-provider",
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      repository.reserveCredits(scope, {
        chargingPolicyVersion: "charging-v1",
        entitlementPolicyVersion: "commercial-v1",
        expiresAt: "2026-08-03T12:10:00.000Z",
        featureKey: "ai-assisted-operations",
        idempotencyKey: "invalid-model-id-test",
        jobId: "job_invalid_model_test",
        modelId: "model-commercial-test",
        modelVersion: "/invalid-leading-character",
        planVersionId: "plan-version_pro_beta-v1",
        pricingVersionId: "pricing_commercial_test",
        projectId: "project_commercial_test",
        providerKey: "model-provider",
        requestId: "request_invalid_model_test",
        requestSha256: digest,
        requestedCreditUnits: "1",
        reservationId: "reservation_invalid_model_test",
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(database.statements).toHaveLength(0);
  });

  it("serializes on the billing account and allocates earliest-expiring grants deterministically", async () => {
    const database = new RecordingDatabase([
      result([{}]),
      result([billingAccountRow]),
      result(),
      result(),
      result(),
      result([entitlementRow]),
      result([{ pricing_version_id: "pricing_commercial_test" }]),
      result(),
      result([{ active_count: "0", limit_value: "5" }]),
      result([
        {
          ...grantBase,
          available_credit_units: "3",
          credit_grant_id: "grant_expires_first",
          expires_at: "2026-08-10T00:00:00.000Z",
        },
        {
          ...grantBase,
          available_credit_units: "7",
          credit_grant_id: "grant_expires_second",
        },
      ]),
      result([], 1),
      result([], 1),
      result([], 1),
      result([], 1),
      result([], 1),
      result([], 1),
      result([reservationRow()]),
      result([
        {
          allocation_sequence: 1,
          credit_grant_id: "grant_expires_first",
          reserved_credit_units: "3",
          settled_credit_units: "0",
        },
        {
          allocation_sequence: 2,
          credit_grant_id: "grant_expires_second",
          reserved_credit_units: "2",
          settled_credit_units: "0",
        },
      ]),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(
      repository.reserveCredits(scope, {
        chargingPolicyVersion: "charging-v1",
        entitlementPolicyVersion: "commercial-v1",
        expiresAt: "2026-08-03T12:10:00.000Z",
        featureKey: "ai-assisted-operations",
        idempotencyKey: "reservation-idempotency-test",
        jobId: "job_commercial_test",
        modelId: "model-commercial-test",
        modelVersion: "2026-08-01",
        planVersionId: "plan-version_pro_beta-v1",
        pricingVersionId: "pricing_commercial_test",
        projectId: "project_commercial_test",
        providerKey: "model-provider",
        requestId: "request_commercial_test",
        requestSha256: digest,
        requestedCreditUnits: "5",
        reservationId,
      }),
    ).resolves.toMatchObject({
      allocations: [
        { creditGrantId: "grant_expires_first", reservedCreditUnits: "3" },
        { creditGrantId: "grant_expires_second", reservedCreditUnits: "2" },
      ],
      planVersionId: "plan-version_pro_beta-v1",
      pricingVersionId: "pricing_commercial_test",
      reservedCreditUnits: "5",
    });

    const joined = database.statements
      .map((statement) => statement.text)
      .join("\n");
    const accountLock = joined.indexOf("organization_billing_accounts");
    const grantRead = joined.indexOf("FROM credit_grants g");
    expect(accountLock).toBeGreaterThanOrEqual(0);
    expect(grantRead).toBeGreaterThan(accountLock);
    expect(joined).toContain("FOR UPDATE");
    expect(joined).toContain("ORDER BY g.expires_at NULLS LAST");
    expect(joined).toContain("INSERT INTO credit_reservation_allocations");
    expect(joined).not.toContain("reservation-idempotency-test");
    expect(
      database.statements.flatMap((statement) => statement.values),
    ).toContain(5n);
  });

  it("rejects insufficient credits before writing a reservation or ledger entry", async () => {
    const database = new RecordingDatabase([
      result([{}]),
      result([billingAccountRow]),
      result(),
      result(),
      result(),
      result([entitlementRow]),
      result([{ pricing_version_id: "pricing_commercial_test" }]),
      result(),
      result([{ active_count: "0", limit_value: "5" }]),
      result([
        {
          ...grantBase,
          available_credit_units: "1",
          credit_grant_id: "grant_too_small",
        },
      ]),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(
      repository.reserveCredits(scope, {
        chargingPolicyVersion: "charging-v1",
        entitlementPolicyVersion: "commercial-v1",
        expiresAt: "2026-08-03T12:10:00.000Z",
        featureKey: "ai-assisted-operations",
        idempotencyKey: "insufficient-credit-test",
        jobId: "job_insufficient_test",
        modelId: "model-commercial-test",
        modelVersion: "2026-08-01",
        planVersionId: "plan-version_pro_beta-v1",
        pricingVersionId: "pricing_commercial_test",
        projectId: "project_commercial_test",
        providerKey: "model-provider",
        requestId: "request_insufficient_test",
        requestSha256: digest,
        requestedCreditUnits: "2",
        reservationId: "reservation_insufficient_test",
      }),
    ).rejects.toMatchObject({ code: "insufficient-credits" });
    expect(
      database.statements.some((statement) =>
        statement.text.includes("INSERT INTO credit_reservations"),
      ),
    ).toBe(false);
  });

  it("partially settles allocations and releases the unused reservation while retaining provider metrics", async () => {
    const settledRow = reservationRow("settled", {
      terminal_at: "2026-08-03T12:01:00.000Z",
      terminal_idempotency_key_sha256: createHash("sha256")
        .update("settlement-idempotency-test")
        .digest("hex"),
      terminal_ledger_entry_id: "ledger_settlement_test",
      terminal_request_sha256: digest,
    });
    const database = new RecordingDatabase([
      result([billingAccountRow]),
      result(),
      result([reservationRow()]),
      result([
        {
          cached_input_micros_per_million_tokens: null,
          cost_currency: "USD",
          credit_conversion_denominator: "1",
          credit_conversion_numerator: "1",
          input_micros_per_million_tokens: "1",
          output_micros_per_million_tokens: "1",
        },
      ]),
      result(),
      result([
        {
          allocation_sequence: 1,
          credit_grant_id: "grant_expires_first",
          reserved_credit_units: "3",
          settled_credit_units: "0",
        },
        {
          allocation_sequence: 2,
          credit_grant_id: "grant_expires_second",
          reserved_credit_units: "2",
          settled_credit_units: "0",
        },
      ]),
      result([], 1),
      result([], 1),
      result([], 1),
      result([], 1),
      result([], 1),
      result([settledRow]),
      result([
        {
          allocation_sequence: 1,
          credit_grant_id: "grant_expires_first",
          reserved_credit_units: "3",
          settled_credit_units: "3",
        },
        {
          allocation_sequence: 2,
          credit_grant_id: "grant_expires_second",
          reserved_credit_units: "2",
          settled_credit_units: "1",
        },
      ]),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(
      repository.settleReservation(accountingContext, {
        actualNormalizedCreditUnits: "4",
        chargingPolicyVersion: "charging-v1",
        chargingScenario: "proposal-delivered-user-rejected",
        customerChargeCreditUnits: "4",
        estimatedProviderCostMicros: "4",
        idempotencyKey: "settlement-idempotency-test",
        inputTokenCount: "1000000",
        ledgerEntryId: "ledger_settlement_test",
        modelId: "model-commercial-test",
        modelVersion: "2026-08-01",
        outputTokenCount: "3000000",
        pricingVersionId: "pricing_commercial_test",
        providerKey: "model-provider",
        providerCostCurrency: "USD",
        reasonCode: "usage.settled",
        requestId: "request_commercial_test",
        requestSha256: digest,
        reservationId,
      }),
    ).resolves.toMatchObject({
      allocations: [{ settledCreditUnits: "3" }, { settledCreditUnits: "1" }],
      status: "settled",
    });

    const ledgerInsert = database.statements.find((statement) =>
      statement.text.includes("INSERT INTO usage_ledger_entries"),
    );
    expect(ledgerInsert?.values).toContain(4n);
    expect(ledgerInsert?.values).toContain(1n);
    expect(ledgerInsert?.values).toContain(3_000_000n);
    expect(ledgerInsert?.text).not.toContain("model prompt");
  });

  it("keeps BIGINT accounting as decimal strings at the adapter boundary", async () => {
    const database = new RecordingDatabase([
      result([{}]),
      result([
        {
          active_granted: "9000000000000000000",
          as_of: "2026-08-03T12:00:00.000Z",
          available: "6000000000000000000",
          compensated: "3000000000000000000",
          debit_adjustments: "1000000000000000000",
          eligible_organization_id: organizationId,
          expired: "0",
          ledger_through_event_id: "ledger_balance_test",
          net_adjustments: "2000000000000000000",
          reserved: "1000000000000000000",
          settled: "2000000000000000000",
          total_granted: "9000000000000000000",
          unresolved: "0",
        },
      ]),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(repository.getCreditBalance(scope)).resolves.toEqual({
      activeGrantedCreditUnits: "9000000000000000000",
      asOf: "2026-08-03T12:00:00.000Z",
      availableCreditUnits: "6000000000000000000",
      compensatedCreditUnits: "3000000000000000000",
      debitAdjustmentCreditUnits: "1000000000000000000",
      exhausted: false,
      expiredCreditUnits: "0",
      ledgerThroughEventId: "ledger_balance_test",
      netAdjustmentCreditUnits: "2000000000000000000",
      organizationId,
      reservedCreditUnits: "1000000000000000000",
      settledCreditUnits: "2000000000000000000",
      totalGrantedCreditUnits: "9000000000000000000",
      unresolvedCreditUnits: "0",
    });
    expect(database.statements[1]?.values).toEqual([
      organizationId,
      membershipId,
      principalId,
    ]);
  });

  it("keeps provider cost out of viewer-readable aggregate usage summaries", async () => {
    const database = new RecordingDatabase([
      result(),
      result([{}]),
      result([
        {
          as_of: "2026-08-03T13:00:00.000Z",
          compensated: "0",
          compensated_events: "0",
          debit_adjustments: "0",
          event_count: "2",
          expired: "0",
          net_adjustments: "0",
          organization_id: organizationId,
          provider_events: "1",
          released: "0",
          request_count: "1",
          reserved: "5",
          settled: "4",
        },
      ]),
      result([
        {
          compensated: "0",
          debit_adjustments: "0",
          expired: "0",
          feature_key: "ai-assisted-operations",
          net_adjustments: "0",
          released: "0",
          request_count: "1",
          reserved: "5",
          settled: "4",
        },
      ]),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);
    const viewerScope: AuthorizedOrganizationScope = {
      ...scope,
      capabilities: permissionsForRole("viewer"),
      roleKey: "viewer",
    };

    const summary = await repository.getUsageSummary(
      viewerScope,
      "2026-08-03T12:00:00.000Z",
      "2026-08-03T14:00:00.000Z",
    );

    expect(summary).toMatchObject({
      eventCount: "2",
      organizationId,
      providerReportedEventCount: "1",
      requestCount: "1",
    });
    expect(summary).not.toHaveProperty("providerCostTotals");
    expect(database.statements).toHaveLength(4);
    const sqlText = database.statements
      .map((statement) => statement.text)
      .join("\n");
    expect(sqlText).not.toContain("SUM(estimated_provider_cost_micros)");
    expect(sqlText).not.toContain("GROUP BY provider_cost_currency");
    expect(database.statements[1]?.values).toContain("commercial.summary.read");
  });

  it("does not read a future entitlement snapshot as the current plan", async () => {
    const database = new RecordingDatabase([result(), result([{}]), result()]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(
      repository.getCurrentPlanEntitlements(scope),
    ).rejects.toMatchObject({ code: "access-denied" });
    expect(database.statements[2]?.text).toContain(
      "snapshot.effective_at <= CURRENT_TIMESTAMP",
    );
  });

  it("derives seat usage only from active canonical memberships", async () => {
    const database = new RecordingDatabase([
      result([{}]),
      result([
        {
          administrator_count: "1",
          as_of: "2026-08-03T12:00:00.000Z",
          billable_role_keys: ["owner", "administrator", "editor"],
          editor_count: "3",
          included_billable_seats: "5",
          maximum_billable_seats: "5",
          maximum_nonbillable_viewers: "20",
          organization_id: organizationId,
          owner_count: "1",
          plan_version_id: "plan-version_team_beta-v1",
          viewer_count: "20",
        },
      ]),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(repository.getSeatUsage(scope)).resolves.toMatchObject({
      billableSeatQuantity: "5",
      pendingInvitationQuantityExcluded: "0",
      viewerQuantity: "20",
    });
    expect(database.statements[1]?.text).toContain(
      "counted.lifecycle_status = 'active'",
    );
    expect(database.statements[1]?.text).toContain(
      "version.configuration_status = 'proposed-beta-example'",
    );
    expect(database.statements[1]?.text).toContain(
      "entitlement.effective_at <= CURRENT_TIMESTAMP",
    );
    expect(database.statements[1]?.text).not.toContain("invitation");
  });

  it("appends a compensating adjustment without rewriting provider usage", async () => {
    const adjustmentRow = {
      acting_principal_id: principalId,
      cached_input_token_count: null,
      charging_policy_version: "charging-v1",
      charging_scenario: null,
      credit_adjustment_units: "4",
      credit_grant_id: "grant_expires_first",
      entry_kind: "adjustment",
      estimated_provider_cost_micros: null,
      expired_credit_units: "0",
      feature_key: "ai.architecture-proposal",
      granted_credit_units: "0",
      idempotency_key_sha256: digest,
      input_token_count: null,
      job_id: "job_commercial_test",
      latency_milliseconds: null,
      ledger_entry_id: "ledger_adjustment_test",
      occurred_at: "2026-08-03T12:02:00.000Z",
      organization_id: organizationId,
      outcome: "compensated",
      output_token_count: null,
      provider_key: null,
      provider_request_id: null,
      reason_code: "system.repair",
      plan_version_id: "plan-version_pro_beta-v1",
      pricing_version_id: "pricing_commercial_test",
      project_id: "project_commercial_test",
      provider_cost_currency: null,
      recorded_by_actor_id: administrationContext.actorId,
      recorded_by_actor_kind: "internal-administration",
      related_ledger_entry_id: "ledger_settlement_test",
      released_credit_units: "0",
      request_id: "request_commercial_test",
      reservation_id: null,
      reserved_credit_units: "0",
      settled_credit_units: "0",
      safe_reason: "A system-required repair restored customer credits.",
    };
    const relatedUsage = {
      ...adjustmentRow,
      credit_adjustment_units: "0",
      credit_grant_id: null,
      entry_kind: "settlement",
      estimated_provider_cost_micros: "9000000",
      input_token_count: "1000",
      ledger_entry_id: "ledger_settlement_test",
      output_token_count: "500",
      provider_cost_currency: "USD",
      related_ledger_entry_id: null,
      settled_credit_units: "4",
    };
    const database = new RecordingDatabase([
      result([billingAccountRow]),
      result(),
      result(),
      result([relatedUsage]),
      result([{ credit_grant_id: "grant_adjustment_test" }]),
      result([adjustmentRow]),
      result([], 1),
    ]);
    const repository = new PostgresCommercialPersistenceRepository(database);

    await expect(
      repository.appendCompensatingAdjustment(administrationContext, {
        adjustmentCreditUnits: "4",
        chargingPolicyVersion: "charging-v1",
        idempotencyKey: "adjustment-idempotency-test",
        ledgerEntryId: "ledger_adjustment_test",
        reasonCode: "system.repair",
        relatedLedgerEntryId: "ledger_settlement_test",
        safeReason: "A system-required repair restored customer credits.",
      }),
    ).resolves.toMatchObject({
      creditAdjustmentUnits: "4",
      relatedLedgerEntryId: "ledger_settlement_test",
    });
    const text = database.statements
      .map((statement) => statement.text)
      .join("\n");
    expect(text).toContain("INSERT INTO usage_ledger_entries");
    expect(text).not.toMatch(/UPDATE\s+usage_ledger_entries/i);
    expect(text).not.toMatch(/DELETE\s+FROM\s+usage_ledger_entries/i);
  });
});
