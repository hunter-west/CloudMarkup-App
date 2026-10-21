import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import {
  createModelAccountingPgTestHarness,
  plan,
} from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import {
  parseModelLiveCommercialReadSelectors,
  parseModelLiveReadRuntimeRow,
  parseModelReadRuntimeRow,
} from "./model-commercial-read-host-codec.js";
import {
  PostgresModelLiveCommercialPreflight,
  PostgresModelLiveCommercialReadHost,
} from "./model-live-commercial-read-host.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Component proof only: actual scoped SQL approval/admission/pricing/accounting
 * over isolated synthetic Cognito/provider metadata. No AWS or quality claim. */
integration("V2 live canonical commercial readers", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 60000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(mode: "standard" | "deep" = "standard") {
    const f = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      true,
      mode,
    );
    const runtime = f.executionInput;
    const pin =
      f.record.resolvedContext?.estimateResult.pricingAuthority.routePins[0];
    if (runtime === undefined || pin === undefined)
      throw Error("Missing exact synthetic read fixture.");
    const policy = runtime.plan.definition.policy,
      route = runtime.routingDecision;
    const selectors = parseModelLiveCommercialReadSelectors({
      contractVersion: 2,
      executionClass: "live-evaluation",
      pricingVersionId: pin.pricingVersion.pricingVersionId,
      pricingVersionDigest: digestStructuredValue(pin.pricingVersion),
      normalizationPolicyVersionId:
        pin.normalizationPolicy.normalizationPolicyVersionId,
      normalizationPolicyDigest: digestStructuredValue(pin.normalizationPolicy),
      runtimePolicyId: policy.policyId,
      runtimePolicyVersion: policy.policyVersion,
      runtimePolicyDigest: policy.policyDigest,
      routeId: route.routeId,
      routeDefinitionDigest: route.routeDefinitionDigest,
      modelConfigurationReference: route.modelConfigurationReference,
    });
    const options = {
      database: harness.database,
      plans: f.plans,
      definitionId: f.plan.definition.definitionId,
      planDigest: f.plan.planDigest,
      caseId: runtime.admissionRequest.evaluationCaseId,
      runtime,
      descriptor: f.hostInput.invocation.descriptor,
      selectors,
    };
    return {
      ...f,
      runtimeInput: runtime,
      pin,
      options,
      preflight: new PostgresModelLiveCommercialPreflight(options),
      reader: new PostgresModelLiveCommercialReadHost(options),
    };
  }
  async function rows(organizationId: string) {
    return (
      await harness.database.query(
        sql(
          "SELECT (SELECT count(*)::int FROM model_runtime_admissions WHERE organization_id=$1) AS admissions, (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations, (SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1) AS ledger, (SELECT count(*)::int FROM model_commercial_reservation_decisions WHERE organization_id=$1) AS decisions",
          [organizationId],
        ),
      )
    ).rows;
  }
  for (const mode of ["standard", "deep"] as const) {
    it(
      "reads actual current " +
        mode +
        " pricing, credits and counts without writes or activation",
      async () => {
        const f = await fixture(mode);
        const before = await rows(f.scope.organizationId);
        const snapshot = await f.preflight.read();
        expect(snapshot).toMatchObject({
          contractVersion: 2,
          executionClass: "live-evaluation",
          planDigest: f.plan.planDigest,
          featureEnabled: true,
          entitlement: { planVersionId: plan, planKey: "pro" },
        });
        expect(snapshot.price).toEqual(f.pin.pricingVersion);
        const result = await f.reader.resolve(f.runtimeInput.commercialRequest);
        expect(result).toMatchObject({
          allowed: true,
          organizationId: f.scope.organizationId,
          planVersionId: plan,
          availableCreditUnits: Number(snapshot.balance.availableCreditUnits),
          allowedRouteIds: [
            mode === "deep" ? "deep-design" : "standard-design",
          ],
          featureRequests: { current: 1 },
          perUserRequests: { current: 1 },
          organizationConcurrentReservations: { current: 1, maximum: 2 },
        });
        expect(result.approvedRoutes).toHaveLength(1);
        expect(result.approvedRoutes[0]?.route).toBe(mode);
        expect(await f.reader.listProviderPricingVersions()).toEqual([
          f.pin.pricingVersion,
        ]);
        expect(await f.reader.listCreditNormalizationPolicies()).toEqual([
          f.pin.normalizationPolicy,
        ]);
        expect(await rows(f.scope.organizationId)).toEqual(before);
      },
    );
  }
  it.each([
    "revoked-plan",
    "removed-operator",
    "removed-definition",
    "suspended-member",
    "archived-project",
    "released-runtime",
  ] as const)(
    "rejects %s on every admitted authorization and pricing read",
    async (kind) => {
      const f = await fixture();
      if (kind === "revoked-plan") await f.plans.revoke(f.identity);
      if (kind === "removed-operator") f.removeOperators();
      if (kind === "removed-definition") f.removeConfiguration();
      if (kind === "suspended-member")
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
      if (kind === "released-runtime")
        await f.runtimeStore.release({
          tenantScopeDigest: f.runtime.tenantScopeDigest,
          executionLease: f.admitted.executionLease,
        });
      const before = await rows(f.scope.organizationId);
      await expect(
        f.reader.resolve(f.runtimeInput.commercialRequest),
      ).rejects.toThrow("Current model commercial authority is unavailable.");
      await expect(f.reader.listProviderPricingVersions()).rejects.toThrow();
      await expect(
        f.reader.listCreditNormalizationPolicies(),
      ).rejects.toThrow();
      if (kind !== "released-runtime")
        await expect(f.preflight.read()).rejects.toThrow();
      expect(await rows(f.scope.organizationId)).toEqual(before);
    },
  );
  it.each([
    "organizationId",
    "projectId",
    "userId",
    "jobId",
    "idempotencyKey",
  ] as const)("rejects commercial %s substitution", async (key) => {
    const f = await fixture();
    await expect(
      f.reader.resolve({
        ...f.runtimeInput.commercialRequest,
        [key]: "other_" + key,
      }),
    ).rejects.toThrow();
  });
  it.each(["pricingVersionDigest", "normalizationPolicyDigest"] as const)(
    "rejects a changed canonical %s",
    async (key) => {
      const f = await fixture();
      const options = {
        ...f.options,
        selectors: {
          ...f.options.selectors,
          [key]: digestStructuredValue("unissued price"),
        },
      };
      await expect(
        new PostgresModelLiveCommercialPreflight(options).read(),
      ).rejects.toThrow();
      await expect(
        new PostgresModelLiveCommercialReadHost(
          options,
        ).listProviderPricingVersions(),
      ).rejects.toThrow();
    },
  );
  it("rejects an unissued plan and a different tenant's actual issuer", async () => {
    const f = await fixture(),
      other = await fixture();
    for (const options of [
      { ...f.options, planDigest: digestStructuredValue("unissued plan") },
      { ...f.options, plans: other.plans },
    ])
      await expect(
        new PostgresModelLiveCommercialPreflight(options).read(),
      ).rejects.toThrow();
    await expect(
      new PostgresModelLiveCommercialReadHost({
        ...f.options,
        plans: other.plans,
      }).resolve(f.runtimeInput.commercialRequest),
    ).rejects.toThrow();
  });
  it("reads current canonical account disablement without inventing an entitlement", async () => {
    const f = await fixture();
    await harness.database.query(
      sql(
        "UPDATE organization_billing_accounts SET expensive_operations_enabled=false WHERE organization_id=$1",
        [f.scope.organizationId],
      ),
    );
    expect((await f.preflight.read()).featureEnabled).toBe(false);
    expect(
      await f.reader.resolve(f.runtimeInput.commercialRequest),
    ).toMatchObject({
      allowed: false,
      featureEntitled: false,
      commercialState: "unavailable",
    });
  });
  it("rejects drift in every actual durable admission row projection and preserves V1 closure", async () => {
    const f = await fixture();
    const row = (
      await harness.database.query(
        sql(
          "SELECT organization_id,project_id,principal_id,scope_sha256,snapshot,snapshot_sha256,revision::text,active_concurrency_lease_id,to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS lease_expires_at FROM model_runtime_admissions WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      )
    ).rows[0];
    if (row === undefined) throw Error("Missing actual admission.");
    const scope = {
      organizationId: f.scope.organizationId,
      projectId: f.scope.projectId,
      userId: f.scope.userId,
    };
    expect(parseModelLiveReadRuntimeRow(row, scope).fingerprint).toBe(
      f.runtime.fingerprint,
    );
    expect(() => parseModelReadRuntimeRow(row, scope)).toThrow();
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
        parseModelLiveReadRuntimeRow(
          { ...row, [key]: key === "revision" ? "999" : "changed" },
          scope,
        ),
      ).toThrow();
    }
  });
  function readerPlans(
    f: Awaited<ReturnType<typeof fixture>>,
    database: SqlDatabase = harness.database,
    expiresAt = f.principal.expiresAt,
    operators = () => [f.principal.principalId],
  ) {
    return new PostgresModelLiveEvaluationPlans({
      database,
      principal: { ...f.principal, expiresAt },
      scope: f.plan.definition.scope,
      configuration: {
        environment: "development",
        resolveOperatorPrincipalIds: () => Promise.resolve(operators()),
        resolveDefinition: (id) =>
          Promise.resolve(
            id === f.identity.definitionId
              ? {
                  definition: f.plan.definition,
                  dataset: f.source.dataset,
                  policy: f.plan.definition.policy,
                }
              : null,
          ),
      },
    });
  }
  it("rejects the original expired authenticated session on every read", async () => {
    const f = await fixture();
    const plans = readerPlans(
      f,
      harness.database,
      new Date(Date.now() - 1).toISOString(),
    );
    const options = { ...f.options, plans };
    await expect(
      new PostgresModelLiveCommercialPreflight(options).read(),
    ).rejects.toThrow();
    const reader = new PostgresModelLiveCommercialReadHost(options);
    await expect(
      reader.resolve(f.runtimeInput.commercialRequest),
    ).rejects.toThrow();
    await expect(reader.listProviderPricingVersions()).rejects.toThrow();
    await expect(reader.listCreditNormalizationPolicies()).rejects.toThrow();
  });
  it.each(["preflight", "admitted"] as const)(
    "rejects approval withdrawn during the actual %s SQL read",
    async (kind) => {
      const f = await fixture();
      let operators = [f.principal.principalId],
        priceRead = false;
      const database: SqlDatabase = {
        query: harness.database.query.bind(harness.database),
        close: () => Promise.resolve(),
        transaction: (work) =>
          harness.database.transaction((tx) =>
            work({
              query: async <R extends SqlRow>(statement: SqlStatement) => {
                const result = await tx.query<R>(statement);
                if (
                  statement.text.includes(
                    "FROM model_provider_pricing_versions",
                  )
                ) {
                  priceRead = true;
                  operators = [];
                }
                return result;
              },
            }),
          ),
      };
      const options = {
        ...f.options,
        database,
        plans: readerPlans(f, database, f.principal.expiresAt, () => operators),
      };
      const before = await rows(f.scope.organizationId);
      await expect(
        kind === "preflight"
          ? new PostgresModelLiveCommercialPreflight(options).read()
          : new PostgresModelLiveCommercialReadHost(options).resolve(
              f.runtimeInput.commercialRequest,
            ),
      ).rejects.toThrow();
      expect(priceRead).toBe(true);
      expect(await rows(f.scope.organizationId)).toEqual(before);
    },
  );
  it("detaches supplied and returned metadata across live reads", async () => {
    const f = await fixture();
    const original = await f.preflight.read();
    const snapshot = await f.preflight.read();
    Object.assign(snapshot.selectors, {
      pricingVersionDigest: digestStructuredValue("changed returned metadata"),
    });
    Object.assign(snapshot.descriptor, {
      inputDigest: digestStructuredValue("changed returned descriptor"),
    });
    Object.assign(f.options.selectors, {
      pricingVersionDigest: digestStructuredValue("changed supplied metadata"),
    });
    Object.assign(f.options.descriptor, {
      inputDigest: digestStructuredValue("changed supplied descriptor"),
    });
    Object.assign(f.options.runtime.commercialRequest, {
      idempotencyKey: "changed supplied request",
    });
    const next = await f.preflight.read();
    expect(next.selectors).toEqual(original.selectors);
    expect(next.descriptor).toEqual(original.descriptor);
    expect(await f.reader.listProviderPricingVersions()).toEqual([
      f.pin.pricingVersion,
    ]);
  });
});
