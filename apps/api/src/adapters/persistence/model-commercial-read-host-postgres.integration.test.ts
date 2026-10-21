import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  sha256Text,
  selectModelRoutingDecisionV1,
} from "@cloudmarkup/model-gateway";
import {
  namespacedIdentifierSchema,
  modelInvocationDescriptorV1Schema,
  modelRoutingRequestV1Schema,
} from "@cloudmarkup/schemas";
import {
  createModelAccountingPgTestHarness,
  plan,
} from "./model-commercial-accounting-pg-test-helpers.js";
import { createPreviewAuthorityFixture } from "./ai-intent-preview-authority-test-helpers.js";
import { modelAccountingFixture } from "./model-commercial-accounting-test-helpers.js";
import {
  modelReadRuntimeFixture,
  seedModelCommercialReadPriceFixture,
} from "./model-commercial-read-host-test-helpers.js";
import { PostgresModelCommercialPreflight } from "./model-commercial-snapshot.js";
import { PostgresStaffAccounts } from "./staff-accounts.js";
import { PostgresModelCommercialReadHost } from "./model-commercial-read-host.js";
import { parseModelReadRuntimeRow } from "./model-commercial-read-host-codec.js";
import { PostgresModelRuntimeAdmissionStore } from "./model-runtime-admission-store.js";
import { runtimeTestId } from "./model-runtime-admission-test-helpers.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Actual canonical SQL/account/price/admission component proof, not a valid
 * promotion or normal runtime execution. The held fake report is unchanged;
 * synthetic decision metadata is admitted directly only inside this marked
 * loopback schema. No provider/HTTP, output body persistence or authority port. */
integration("canonical preview commercial read host (component only)", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 60000);
  afterAll(() => harness.teardown(), 30000);
  async function preflightFixture(options: { credits?: string } = {}) {
    const tenant = await harness.tenant(options.credits);
    const scope = {
      organizationId: tenant.scope.organizationId,
      projectId: tenant.scope.projectId,
      userId: tenant.scope.userId,
      jobId: runtimeTestId("job"),
    };
    const authority = await createPreviewAuthorityFixture(
      harness.database,
      scope,
    );
    const f = await modelAccountingFixture(
      new Date().toISOString(),
      tenant.scope,
      "",
      undefined,
      {
        ...authority.preview,
        pricing: { pricingVersionId: "pricing.synthetic.preview" },
      },
    );
    const built = await modelReadRuntimeFixture(
      authority.preview,
      f.record,
      plan,
    );
    await seedModelCommercialReadPriceFixture(
      harness.database,
      tenant.administration,
      built.pin.pricingVersion,
      built.pin.normalizationPolicy,
    );
    const input = {
      database: harness.database,
      requestAuthority: authority.authority,
      runtime: built.runtime,
      descriptor: built.descriptor,
      selectors: built.selectors,
    };
    return {
      tenant,
      scope,
      authority,
      f,
      built,
      input,
      before: await durableCounts(scope.organizationId),
    };
  }
  async function fixture(options: { credits?: string } = {}) {
    const { tenant, scope, authority, f, built, input } =
      await preflightFixture(options);
    const runtimeStore = new PostgresModelRuntimeAdmissionStore({
      database: harness.database,
      scope: {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
      },
    });
    const snapshot = await runtimeStore.inspect(built.state);
    const claim = {
      ...built.base.claim(snapshot),
      ...built.state,
      admissionRequest: built.runtime.admissionRequest,
      admissionDecision: built.runtime.admissionDecision,
      fingerprint: built.identity.fingerprint,
      commercialExpiresAt: f.request.expiresAt,
      executionLeaseExpiresAt: f.request.expiresAt,
      claimOutbox: [],
    };
    const acquired = await runtimeStore.claim(claim);
    if (acquired.kind !== "claimed")
      throw new Error(`Synthetic component admission failed: ${acquired.kind}`);
    return {
      tenant,
      authority,
      built,
      runtimeStore,
      acquired,
      claim,
      input,
      host: new PostgresModelCommercialReadHost(input),
    };
  }
  async function durableCounts(organizationId: string) {
    return (
      await harness.database.query(
        sql(
          `SELECT
      (SELECT count(*)::int FROM model_runtime_admissions WHERE organization_id=$1) AS admissions,
      (SELECT count(*)::int FROM model_commercial_workflows WHERE organization_id=$1) AS workflows,
      (SELECT count(*)::int FROM model_commercial_reservation_decisions WHERE organization_id=$1) AS decisions,
      (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations,
      (SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1) AS ledger`,
          [organizationId],
        ),
      )
    ).rows;
  }
  it("reads exact real plan, balance and immutable prices without writing or promoting", async () => {
    const f = await fixture();
    const before = await durableCounts(f.tenant.scope.organizationId);
    const result = await f.host.resolve(f.built.runtime.commercialRequest);
    expect(result).toMatchObject({
      allowed: true,
      organizationId: f.tenant.scope.organizationId,
      planVersionId: plan,
      availableCreditUnits: 100,
      maximumInputUnits: 200,
      maximumOutputUnits: 40,
      featureRequests: { current: 0, maximum: 100 },
      perUserRequests: { current: 0, maximum: 20 },
      organizationConcurrentReservations: { current: 0, maximum: 2 },
    });
    expect(await f.host.listProviderPricingVersions()).toEqual([
      f.built.pin.pricingVersion,
    ]);
    expect(await f.host.listCreditNormalizationPolicies()).toEqual([
      f.built.pin.normalizationPolicy,
    ]);
    expect(f.built.runtime.evaluationReport).toMatchObject({
      executionMode: "deterministic-fake",
      activationRecommendation: "hold",
      capabilityActivated: false,
    });
    expect(await durableCounts(f.tenant.scope.organizationId)).toEqual(before);
  });
  it("reads the audited staff-credit AI profile without borrowing a subscription or trial", async () => {
    const f = await preflightFixture();
    const principal = f.input.requestAuthority.principal;
    await harness.database.query(
      sql(
        "UPDATE organization_subscription_projections SET normalized_status='canceled' WHERE organization_id=$1",
        [f.scope.organizationId],
      ),
    );
    await harness.database.query(
      sql(
        "INSERT INTO platform_staff_authorizations(principal_id,permissions) VALUES($1,ARRAY['accounts.read','credits.grant','trials.grant'])",
        [principal.principalId],
      ),
    );
    const staff = new PostgresStaffAccounts(harness.database);
    const beforeGrant = await staff.get(principal, f.scope.organizationId);
    await staff.act(
      principal,
      f.scope.organizationId,
      {
        contractVersion: 1,
        action: "grant-credits",
        confirmBillingAccountId: beforeGrant.value.account.billingAccountId,
        creditUnits: 100,
        expiresInDays: 30,
        reason: "Synthetic model credit access",
      },
      beforeGrant.etag,
      runtimeTestId("staff-credit"),
    );
    const beforeRead = await durableCounts(f.scope.organizationId);
    const snapshot = await new PostgresModelCommercialPreflight(f.input).read();
    expect(snapshot).toMatchObject({
      featureEnabled: true,
      maximumConcurrentReservations: 1,
      entitlement: {
        planKey: "starter",
        planVersionId: "planver_staff_credits_2026_10_15_v1",
      },
      balance: { availableCreditUnits: "200" },
    });
    expect(snapshot.entitlement).not.toHaveProperty("subscriptionProjectionId");
    expect(snapshot.entitlement).not.toHaveProperty("trial");
    const routing = modelRoutingRequestV1Schema.parse({
      ...f.built.runtime.routingRequest,
      plan: {
        ...f.built.runtime.routingRequest.plan,
        key: snapshot.entitlement.planKey,
        versionId: snapshot.entitlement.planVersionId,
      },
    });
    expect(routing.plan).toMatchObject({
      key: "starter",
      versionId: "planver_staff_credits_2026_10_15_v1",
    });
    const standard = selectModelRoutingDecisionV1({
      request: { ...routing, selectedPreference: "standard-design" },
      routingConfigurationDigest: sha256Text("synthetic-staff-credit-routing"),
    });
    expect(standard.entitlement.allowed).toBe(true);
    const deep = selectModelRoutingDecisionV1({
      request: { ...routing, selectedPreference: "deep-design" },
      routingConfigurationDigest: sha256Text("synthetic-staff-credit-routing"),
    });
    expect(deep.entitlement.allowed).toBe(false);
    expect(deep.reasonCodes).toContain("plan-denied");
    expect(await durableCounts(f.scope.organizationId)).toEqual(beforeRead);
    // A separately authorized synthetic trial retains its existing Pro routing
    // tier and independent expiry; the preceding credit grant created neither.
    const beforeTrial = await staff.get(principal, f.scope.organizationId);
    await staff.act(
      principal,
      f.scope.organizationId,
      {
        contractVersion: 1,
        action: "grant-trial",
        confirmBillingAccountId: beforeTrial.value.account.billingAccountId,
        creditUnits: 100,
        expiresInDays: 7,
        reason: "Synthetic explicit trial routing",
      },
      beforeTrial.etag,
      runtimeTestId("explicit-trial"),
    );
    const trialSnapshot = await new PostgresModelCommercialPreflight(
      f.input,
    ).read();
    expect(trialSnapshot.entitlement).toMatchObject({
      planKey: "pro",
      planVersionId: "planver_staff_trial_2026_10_06_v1",
    });
    expect(trialSnapshot.entitlement.trial).toBeDefined();
    expect(trialSnapshot.entitlement).not.toHaveProperty(
      "subscriptionProjectionId",
    );
  });
  it("fresh instances return the canonical decision while matching metadata grants no new admission", async () => {
    const f = await fixture();
    const before = await durableCounts(f.tenant.scope.organizationId);
    const first = await f.host.resolve(f.built.runtime.commercialRequest);
    const second = await new PostgresModelCommercialReadHost(f.input).resolve(
      f.built.runtime.commercialRequest,
    );
    expect({ ...second, evaluatedAt: first.evaluatedAt }).toEqual(first);
    expect(await durableCounts(f.tenant.scope.organizationId)).toEqual(before);
  });
  it.each([
    "organizationId",
    "projectId",
    "userId",
    "idempotencyKey",
    "reservationId",
    "requestId",
  ] as const)(
    "rejects candidate %s rebinding before any writes",
    async (key) => {
      const f = await fixture();
      const before = await durableCounts(f.tenant.scope.organizationId);
      await expect(
        f.host.resolve({
          ...f.built.runtime.commercialRequest,
          [key]: `different_${key}`,
        }),
      ).rejects.toThrow();
      expect(await durableCounts(f.tenant.scope.organizationId)).toEqual(
        before,
      );
    },
  );
  it.each([
    "released-edit",
    "stale-draft",
    "revoked-member",
    "archived-project",
    "expired-auth",
    "released-runtime",
  ] as const)(
    "rechecks %s on every authority and pricing read",
    async (kind) => {
      const f = await fixture();
      if (kind === "released-edit")
        await f.authority.leases.release(
          f.input.requestAuthority.principal,
          f.tenant.scope.projectId,
          f.input.requestAuthority.editingProof,
        );
      if (kind === "stale-draft") await f.authority.advanceDraft(true);
      if (kind === "revoked-member")
        await harness.database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1",
            [f.tenant.scope.organizationId],
          ),
        );
      if (kind === "archived-project")
        await harness.database.query(
          sql(
            "UPDATE projects SET lifecycle_status='archived' WHERE project_id=$1",
            [f.tenant.scope.projectId],
          ),
        );
      if (kind === "released-runtime")
        await f.runtimeStore.release({
          tenantScopeDigest: f.built.identity.tenantScopeDigest,
          executionLease: f.acquired.executionLease,
        });
      const host =
        kind === "expired-auth"
          ? new PostgresModelCommercialReadHost({
              ...f.input,
              requestAuthority: {
                ...f.input.requestAuthority,
                principal: {
                  ...f.input.requestAuthority.principal,
                  expiresAt: new Date(Date.now() - 1).toISOString(),
                },
              },
            })
          : f.host;
      await expect(
        host.resolve(f.built.runtime.commercialRequest),
      ).rejects.toThrow();
      await expect(host.listProviderPricingVersions()).rejects.toThrow();
      await expect(host.listCreditNormalizationPolicies()).rejects.toThrow();
    },
  );
  it.each(["pricingVersionDigest", "normalizationPolicyDigest"] as const)(
    "rejects a correctly shaped changed %s instead of selecting a default",
    async (key) => {
      const f = await fixture();
      const host = new PostgresModelCommercialReadHost({
        ...f.input,
        selectors: {
          ...f.input.selectors,
          [key]: sha256Text("different unissued selector"),
        },
      });
      await expect(
        host.resolve(f.built.runtime.commercialRequest),
      ).rejects.toThrow();
    },
  );
  it("zero balance is truthfully projected, not replaced with a grant or an unavailable stub", async () => {
    const f = await fixture({ credits: "0" });
    expect(
      await f.host.resolve(f.built.runtime.commercialRequest),
    ).toMatchObject({ allowed: true, availableCreditUnits: 0 });
    expect(await durableCounts(f.tenant.scope.organizationId)).toEqual([
      { admissions: 1, workflows: 0, decisions: 0, reservations: 0, ledger: 0 },
    ]);
  });
  it("retains unsettled reservations in real credit and concurrency counts", async () => {
    const f = await fixture();
    const reserved = await harness.fixture(f.tenant, runtimeTestId("held"), {
      preview: true,
    });
    expect(await reserved.adapter.reserve(reserved.input)).toMatchObject({
      accepted: true,
    });
    const result = await f.host.resolve(f.built.runtime.commercialRequest);
    expect(result).toMatchObject({
      featureRequests: { current: 1, maximum: 100 },
      perUserRequests: { current: 1, maximum: 20 },
      organizationConcurrentReservations: { current: 1, maximum: 2 },
      availableCreditUnits: 100 - reserved.input.requestedCreditUnits,
    });
    // Releasing runtime ownership does not prove remote completion or refund
    // the separate canonical customer hold.
    await reserved.runtimeStore.release({
      tenantScopeDigest: reserved.claim.tenantScopeDigest,
      executionLease: reserved.runtime.executionLease,
    });
    expect(
      await f.host.resolve(f.built.runtime.commercialRequest),
    ).toMatchObject({
      organizationConcurrentReservations: { current: 1, maximum: 2 },
      availableCreditUnits: result.availableCreditUnits,
    });
  });
  it("returns current disabled account state and never silently enables expensive use", async () => {
    const f = await fixture();
    await harness.database.query(
      sql(
        "UPDATE organization_billing_accounts SET expensive_operations_enabled=false WHERE organization_id=$1",
        [f.tenant.scope.organizationId],
      ),
    );
    expect(
      await f.host.resolve(f.built.runtime.commercialRequest),
    ).toMatchObject({
      allowed: false,
      featureEntitled: false,
      commercialState: "unavailable",
      denialReason: "commercial-state-unavailable",
    });
  });
  it("denies unsupported period-based plan limits instead of resetting them as runtime windows", async () => {
    const f = await fixture();
    const rollback = new Error(
      "Rollback the synthetic additional immutable plan limit.",
    );
    await expect(
      harness.database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO commercial_plan_numeric_limits(plan_version_id,limit_key,limit_scope,period_kind,limit_value) VALUES($1,'per-user-request-count','member','calendar-month',1000)",
            [plan],
          ),
        );
        // Use this same real PostgreSQL transaction so its new immutable policy
        // can be inspected and then rolled back without changing historical rows.
        const database: SqlDatabase = {
          query: tx.query.bind(tx),
          transaction: (work) => work(tx),
          close: () => Promise.resolve(),
        };
        const host = new PostgresModelCommercialReadHost({
          ...f.input,
          database,
        });
        await expect(
          host.resolve(f.built.runtime.commercialRequest),
        ).rejects.toThrow();
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT count(*)::int AS count FROM commercial_plan_numeric_limits WHERE plan_version_id=$1 AND limit_key='per-user-request-count' AND limit_scope='member'",
            [plan],
          ),
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  });
  it("binds selectors to the exact runtime route and policy before database access", async () => {
    const f = await fixture();
    for (const selectors of [
      { ...f.input.selectors, runtimePolicyDigest: sha256Text("other policy") },
      {
        ...f.input.selectors,
        routeDefinitionDigest: sha256Text("other route"),
      },
      {
        ...f.input.selectors,
        modelConfigurationReference:
          namespacedIdentifierSchema.parse("other.model"),
      },
    ]) {
      expect(
        () => new PostgresModelCommercialReadHost({ ...f.input, selectors }),
      ).toThrow();
    }
    expect(digestStructuredValue(f.input.runtime.policy)).toBe(
      digestStructuredValue(f.built.runtime.policy),
    );
  });
  it("rejects drift in each real durable runtime ownership projection", async () => {
    const f = await fixture();
    const row = (
      await harness.database.query(
        sql(
          `SELECT organization_id,project_id,principal_id,scope_sha256,snapshot,snapshot_sha256,revision::text,active_concurrency_lease_id,to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS lease_expires_at FROM model_runtime_admissions WHERE organization_id=$1`,
          [f.tenant.scope.organizationId],
        ),
      )
    ).rows[0];
    if (!row) throw new Error("Missing actual synthetic runtime row.");
    expect(parseModelReadRuntimeRow(row, f.built.state)).toMatchObject({
      fingerprint: f.built.identity.fingerprint,
    });
    for (const key of [
      "organization_id",
      "project_id",
      "principal_id",
      "scope_sha256",
      "snapshot_sha256",
      "revision",
      "active_concurrency_lease_id",
      "lease_expires_at",
    ]) {
      expect(() =>
        parseModelReadRuntimeRow(
          { ...row, [key]: key === "revision" ? "1" : "changed" },
          f.built.state,
        ),
      ).toThrow();
    }
  });
  it("rejects descriptor operation, input, idempotency, prompt and job drift independently", async () => {
    const f = await fixture();
    for (const descriptor of [
      { ...f.input.descriptor, feature: "summary.technical" },
      { ...f.input.descriptor, inputDigest: sha256Text("other input") },
      { ...f.input.descriptor, idempotencyKeyDigest: sha256Text("other key") },
      { ...f.input.descriptor, promptVersion: "9.0.0" },
      {
        ...f.input.descriptor,
        scope: { ...f.input.descriptor.scope, jobId: "other_job" },
      },
    ]) {
      expect(
        () =>
          new PostgresModelCommercialReadHost({
            ...f.input,
            descriptor: modelInvocationDescriptorV1Schema.parse(descriptor),
          }),
      ).toThrow();
    }
  });
  it("preflights real canonical records with no admission row or bootstrap writes", async () => {
    const f = await preflightFixture();
    const before = await durableCounts(f.scope.organizationId);
    expect(before).toMatchObject([
      { admissions: 0, workflows: 0, decisions: 0, reservations: 0 },
    ]);
    const observed: string[] = [];
    const database: SqlDatabase = {
      query: harness.database.query.bind(harness.database),
      close: () => Promise.resolve(),
      transaction: (work) =>
        harness.database.transaction((tx) =>
          work({
            query: async <TRow extends SqlRow>(statement: SqlStatement) => {
              observed.push(statement.text);
              if (
                /model_runtime_admissions|model_commercial_workflows|model_commercial_reservation_decisions/u.test(
                  statement.text,
                )
              )
                throw new Error(
                  "Preflight must not bootstrap from admission/workflow state.",
                );
              return tx.query<TRow>(statement);
            },
          }),
        ),
    };
    const preflight = new PostgresModelCommercialPreflight({
      database,
      requestAuthority: f.authority.authority,
      descriptor: f.built.descriptor,
      selectors: f.built.selectors,
    });
    const snapshot = await preflight.read();
    expect(snapshot).toMatchObject({
      contractVersion: 1,
      featureEnabled: true,
      maximumConcurrentReservations: 2,
      entitlement: {
        planVersionId: plan,
        planKey: "pro",
        sourceRecordVersion: "1",
      },
      balance: { availableCreditUnits: "100" },
      price: f.built.pin.pricingVersion,
      normalization: f.built.pin.normalizationPolicy,
    });
    expect(snapshot.entitlement.entitlementSnapshotId).not.toBe("");
    expect(snapshot.entitlement.subscriptionProjectionId).not.toBe("");
    expect(Date.parse(snapshot.observedAt)).toBeLessThan(
      Date.parse(snapshot.expiresAt),
    );
    expect(Date.parse(snapshot.expiresAt)).toBeLessThanOrEqual(
      Date.parse(f.authority.authority.principal.expiresAt),
    );
    for (const key of [
      "maximumInputUnits",
      "maximumOutputUnits",
      "estimateAccepted",
      "admissionDecision",
      "featureRequests",
      "perUserRequests",
    ])
      expect(snapshot).not.toHaveProperty(key);
    expect(
      observed.some((statement) =>
        statement.includes("organization_subscription_projections"),
      ),
    ).toBe(true);
    expect(
      observed.some((statement) =>
        /INSERT|UPDATE\s+\w+\s+SET|DELETE/iu.test(statement),
      ),
    ).toBe(false);
    expect(await durableCounts(f.scope.organizationId)).toEqual(before);
  });
  it("returns cloned fresh canonical observations, without reusing a customer grant or authority decision", async () => {
    const f = await preflightFixture();
    const reader = new PostgresModelCommercialPreflight(f.input);
    const first = await reader.read();
    Object.assign(first.price, {
      providerSpecificUnitRates: [
        { unitName: "synthetic-mutated-copy", microsPerMillionUnits: 1 },
      ],
    });
    const second = await reader.read();
    expect(second.price).toEqual(f.built.pin.pricingVersion);
    expect(second.selectors).toEqual(f.built.selectors);
    expect(second.descriptor).toEqual(f.built.descriptor);
    expect(await durableCounts(f.scope.organizationId)).toEqual(f.before);
  });
  it.each([
    "released-edit",
    "stale-draft",
    "revoked-member",
    "archived-project",
    "expired-auth",
    "wrong-session",
  ] as const)(
    "preflight denies %s without an admission record",
    async (kind) => {
      const f = await preflightFixture();
      if (kind === "released-edit")
        await f.authority.leases.release(
          f.authority.authority.principal,
          f.scope.projectId,
          f.authority.authority.editingProof,
        );
      if (kind === "stale-draft") await f.authority.advanceDraft(true);
      if (kind === "revoked-member")
        await harness.database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        );
      if (kind === "archived-project")
        await harness.database.query(
          sql(
            "UPDATE projects SET lifecycle_status='archived' WHERE project_id=$1",
            [f.scope.projectId],
          ),
        );
      const original = f.authority.authority;
      const requestAuthority = {
        ...original,
        principal: {
          ...original.principal,
          ...(kind === "expired-auth"
            ? { expiresAt: new Date(Date.now() - 1).toISOString() }
            : {}),
          ...(kind === "wrong-session"
            ? { sessionId: "different_verified_session" }
            : {}),
        },
      };
      await expect(
        new PostgresModelCommercialPreflight({
          ...f.input,
          requestAuthority,
        }).read(),
      ).rejects.toThrow();
      expect(await durableCounts(f.scope.organizationId)).toEqual(f.before);
    },
  );
  it("rechecks real membership after immutable price reads and rolls back the injected revocation", async () => {
    const f = await preflightFixture();
    let interrupted = false;
    const database: SqlDatabase = {
      query: harness.database.query.bind(harness.database),
      close: () => Promise.resolve(),
      transaction: (work) =>
        harness.database.transaction((tx) =>
          work({
            query: async <TRow extends SqlRow>(statement: SqlStatement) => {
              const result = await tx.query<TRow>(statement);
              if (
                !interrupted &&
                statement.text.includes(
                  "FROM credit_normalization_policy_versions",
                )
              ) {
                interrupted = true;
                await tx.query(
                  sql(
                    "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1",
                    [f.scope.organizationId],
                  ),
                );
              }
              return result;
            },
          }),
        ),
    };
    await expect(
      new PostgresModelCommercialPreflight({ ...f.input, database }).read(),
    ).rejects.toThrow();
    expect(interrupted).toBe(true);
    expect(
      (await new PostgresModelCommercialPreflight(f.input).read())
        .featureEnabled,
    ).toBe(true);
    expect(await durableCounts(f.scope.organizationId)).toEqual(f.before);
  });
  it("rejects the original authentication ceiling crossed during actual PostgreSQL reads", async () => {
    const f = await preflightFixture();
    const expiresAt = new Date(Date.now() + 2000).toISOString();
    let delayed = false;
    const database: SqlDatabase = {
      query: harness.database.query.bind(harness.database),
      close: () => Promise.resolve(),
      transaction: (work) =>
        harness.database.transaction((tx) =>
          work({
            query: async <TRow extends SqlRow>(statement: SqlStatement) => {
              const result = await tx.query<TRow>(statement);
              if (
                !delayed &&
                statement.text.includes(
                  "FROM credit_normalization_policy_versions",
                )
              ) {
                delayed = true;
                await tx.query(
                  sql(
                    "SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.02)",
                    [expiresAt],
                  ),
                );
              }
              return result;
            },
          }),
        ),
    };
    await expect(
      new PostgresModelCommercialPreflight({
        ...f.input,
        database,
        requestAuthority: {
          ...f.authority.authority,
          principal: { ...f.authority.authority.principal, expiresAt },
        },
      }).read(),
    ).rejects.toThrow();
    expect(delayed).toBe(true);
    expect(await durableCounts(f.scope.organizationId)).toEqual(f.before);
  });
  it("does not replace zero balance or missing immutable prices with defaults", async () => {
    const f = await preflightFixture({ credits: "0" });
    const snapshot = await new PostgresModelCommercialPreflight(f.input).read();
    expect(snapshot.balance.availableCreditUnits).toBe("0");
    await expect(
      new PostgresModelCommercialPreflight({
        ...f.input,
        selectors: {
          ...f.built.selectors,
          pricingVersionId: namespacedIdentifierSchema.parse(
            "pricing.synthetic.missing",
          ),
        },
      }).read(),
    ).rejects.toThrow();
    expect(await durableCounts(f.scope.organizationId)).toEqual(f.before);
  });
  it("shares canonical price, plan and balance semantics with the still-required post-admission reader", async () => {
    const f = await fixture();
    const before = await durableCounts(f.tenant.scope.organizationId);
    const snapshot = await new PostgresModelCommercialPreflight(f.input).read();
    const authorization = await f.host.resolve(
      f.built.runtime.commercialRequest,
    );
    expect(authorization).toMatchObject({
      allowed: snapshot.featureEnabled,
      availableCreditUnits: Number(snapshot.balance.availableCreditUnits),
      planVersionId: snapshot.entitlement.planVersionId,
      organizationConcurrentReservations: {
        maximum: snapshot.maximumConcurrentReservations,
      },
    });
    expect(await f.host.listProviderPricingVersions()).toEqual([
      snapshot.price,
    ]);
    expect(await f.host.listCreditNormalizationPolicies()).toEqual([
      snapshot.normalization,
    ]);
    await f.runtimeStore.release({
      tenantScopeDigest: f.built.identity.tenantScopeDigest,
      executionLease: f.acquired.executionLease,
    });
    await expect(
      f.host.resolve(f.built.runtime.commercialRequest),
    ).rejects.toThrow();
    // Commercial observation never revives released runtime ownership.
    expect(
      (await new PostgresModelCommercialPreflight(f.input).read()).balance
        .availableCreditUnits,
    ).toBe("100");
    expect(await durableCounts(f.tenant.scope.organizationId)).toEqual(before);
  });

  it.each(["organizationId", "projectId"] as const)(
    "denies preflight cross-tenant/project %s before canonical commercial reads",
    async (key) => {
      const f = await preflightFixture();
      const descriptor = modelInvocationDescriptorV1Schema.parse({
        ...f.built.descriptor,
        scope: {
          ...f.built.descriptor.scope,
          [key]: runtimeTestId("different"),
        },
      });
      await expect(
        new PostgresModelCommercialPreflight({ ...f.input, descriptor }).read(),
      ).rejects.toThrow();
      expect(await durableCounts(f.scope.organizationId)).toEqual(f.before);
    },
  );
  it("detaches returned normal preflight selectors and descriptor from later reads", async () => {
    const f = await preflightFixture();
    const reader = new PostgresModelCommercialPreflight(f.input);
    const first = await reader.read();
    const selectors = structuredClone(first.selectors),
      descriptor = structuredClone(first.descriptor);
    Object.assign(first.selectors, {
      pricingVersionDigest: digestStructuredValue(
        "changed returned normal metadata",
      ),
    });
    Object.assign(first.descriptor, {
      inputDigest: digestStructuredValue("changed returned normal descriptor"),
    });
    const next = await reader.read();
    expect(next.selectors).toEqual(selectors);
    expect(next.descriptor).toEqual(descriptor);
  });
});
