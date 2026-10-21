import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
  digestStructuredValue,
  projectModelCommercialReservationV1,
  sha256Text,
  type ModelCommercialCapacityReservationV1,
  type ModelCommercialWorkflowRecordV1,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialVerifiedScopeV1,
  type ModelCommercialWorkflowExecutionLeaseV1,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialLifecycleCoordinator,
  type ModelRuntimeAdmissionStoreV1,
  type ModelRuntimeAdmissionClaimV1,
} from "@cloudmarkup/model-gateway";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type {
  TrustedCommercialAccountingContext,
  TrustedCommercialAdministrationContext,
} from "../../application/commercial-persistence.js";
import type {
  ModelAccountingBinding,
  ModelReservationInput,
} from "./model-commercial-accounting-codec.js";
import {
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeAdmissionDecisionV1Schema,
  normalizedModelUsageV1Schema,
} from "@cloudmarkup/schemas";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql, type SqlDatabase } from "./sql.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { runMigrations, runSeedFile } from "./migrations.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { PostgresModelCommercialPersistenceRepository } from "./model-commercial-repository.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { PostgresModelCommercialWorkflowStore } from "./model-commercial-workflow-store.js";
import { PostgresModelRuntimeAdmissionStore } from "./model-runtime-admission-store.js";
import {
  runtimeAdmissionFixture,
  runtimeTestId,
} from "./model-runtime-admission-test-helpers.js";
import {
  commercialScope,
  commercialClaim,
  commercialHarness,
} from "./model-commercial-workflow-test-helpers.js";
import { modelAccountingFixture } from "./model-commercial-accounting-test-helpers.js";
import { PostgresModelCommercialReservations } from "./model-commercial-accounting.js";
import { admissionScopeDigest } from "./model-runtime-admission-codec.js";
import { aiPreviewFixture } from "./ai-intent-preview-test-helpers.js";
import { PostgresAiIntentPreviewJournal } from "./ai-intent-preview.js";
import { PostgresIntentRuntimeHostEvidence } from "./model-runtime-host-evidence.js";

/** Synthetic test-only PostgreSQL fixture. Each caller owns one marked random
 * loopback schema; no production module may import this helper. */
export const plan = "planver_pro_2026_08_14_v2";
export const entitlement = "cloudmarkup-entitlements-v1";
export const charging = "cloudmarkup-charging-and-failure-v1";
interface ModelAccountingPgTenant {
  scope: ModelCommercialVerifiedScopeV1;
  administration: TrustedCommercialAdministrationContext;
  accounting: TrustedCommercialAccountingContext;
  repository: PostgresCommercialPersistenceRepository;
  authorized: AuthorizedOrganizationScope;
}
interface ModelAccountingPgFixtureOptions {
  readonly capacity?: ModelCommercialCapacityReservationV1;
  readonly windowSeconds?: number;
  readonly preview?: boolean;
  readonly complexPricing?: boolean;
  readonly expiresAfterMilliseconds?: number;
}
interface ModelAccountingPgFixture extends ModelAccountingPgTenant {
  input: ModelReservationInput;
  record: ModelCommercialWorkflowRecordV1;
  adapter: PostgresModelCommercialReservations;
  binding: ModelAccountingBinding;
  wf: PostgresModelCommercialWorkflowStore;
  runtime: Extract<
    Awaited<ReturnType<ModelRuntimeAdmissionStoreV1["claim"]>>,
    { kind: "claimed" }
  >;
  runtimeStore: PostgresModelRuntimeAdmissionStore;
  claim: ModelRuntimeAdmissionClaimV1;
  errors: unknown[];
  workflowLease: ModelCommercialWorkflowExecutionLeaseV1;
  priceOverrides: Pick<
    NonNullable<Parameters<typeof commercialHarness>[3]>,
    "pricing" | "normalization"
  >;
  preview: ModelAccountingPgPreview | undefined;
}
interface ModelAccountingPgPreview extends Omit<
  ReturnType<typeof aiPreviewFixture>,
  "request"
> {
  request: ModelCommercialOperationRequestV1;
}
interface ModelAccountingPgTerminalFixture extends ModelAccountingPgFixture {
  coordinator: ModelCommercialLifecycleCoordinator;
  journal: PostgresAiIntentPreviewJournal;
  evidence: PostgresIntentRuntimeHostEvidence;
  preview: ModelAccountingPgPreview;
  generate(
    callback: ModelCommercialInvocationContextV1,
    acknowledged: boolean,
  ): Promise<ModelCommercialInvocationResultV1>;
}
interface ModelAccountingPgTestHarness {
  readonly setup: () => Promise<void>;
  readonly teardown: () => Promise<void>;
  readonly tenant: (credits?: string) => Promise<ModelAccountingPgTenant>;
  readonly fixture: (
    account?: ModelAccountingPgTenant,
    name?: string,
    options?: ModelAccountingPgFixtureOptions,
  ) => Promise<ModelAccountingPgFixture>;
  readonly terminalFixture: (
    complexPricing?: boolean,
    expiresAfterMilliseconds?: number,
  ) => Promise<ModelAccountingPgTerminalFixture>;
  readonly database: PostgresDatabase;
  readonly legacy: ModelAccountingPgTenant;
  readonly legacyReservationId: string;
  readonly legacyBefore: unknown;
}
export function createModelAccountingPgTestHarness(
  configured: string | undefined,
  migrationLimit?: "0055" | "0057" | "0058" | "0098",
): ModelAccountingPgTestHarness {
  const suffix = randomUUID().replaceAll("-", "");
  const schemaName = `cm_model_accounting_${suffix}`;
  const marker = `CloudMarkup synthetic model accounting ${suffix}`;
  let admin: PostgresDatabase | undefined;
  let db: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let created = false;
  let legacy: Awaited<ReturnType<typeof tenant>>;
  let legacyReservationId: string;
  let legacyBefore: unknown;
  async function setup() {
    if (!configured) throw new Error("Explicit synthetic database required.");
    const url = new URL(configured);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
    )
      throw new Error("Explicit loopback-only database required.");
    // Native Windows PostgreSQL can take more than five seconds to open a
    // backend during compiler/verification load. This is a synthetic connection
    // deadline only; SQL, execution-lease and reservation deadlines are unchanged.
    admin = new PostgresDatabase({
      connectionString: configured,
      max: 1,
      connectionTimeoutMillis: 15_000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql(`CREATE SCHEMA "${schemaName}"`));
      await tx.query(sql(`COMMENT ON SCHEMA "${schemaName}" IS '${marker}'`));
    });
    created = true;
    db = new PostgresDatabase({
      connectionString: configured,
      max: 6,
      connectionTimeoutMillis: 15_000,
      options: `-c search_path=${schemaName} -c timezone=UTC -c statement_timeout=7000`,
    });
    opened = db;
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const migrations = await loadHistoricalBetaMigrations(`${root}migrations`);
    await runMigrations(
      db,
      migrations.filter((migration) => migration.version < "0028"),
    );
    await runSeedFile(db, `${root}seeds/0001_local_development.sql`);
    legacy = await tenant();
    const oldPrice = await legacy.repository.createProviderPricingVersion(
      legacy.administration,
      {
        pricingVersionId: runtimeTestId("legacyprice"),
        providerKey: "synthetic-provider",
        modelId: "synthetic_model",
        modelVersion: "synthetic_v1",
        costCurrency: "USD",
        creditConversionDenominator: "1",
        creditConversionNumerator: "1",
        inputMicrosPerMillionTokens: "1000000",
        outputMicrosPerMillionTokens: "1000000",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      },
    );
    legacyReservationId = runtimeTestId("legacyreservation");
    await legacy.repository.reserveCredits(legacy.authorized, {
      chargingPolicyVersion: charging,
      entitlementPolicyVersion: entitlement,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      featureKey: "ai-assisted-operations",
      idempotencyKey: runtimeTestId("legacyidem"),
      jobId: runtimeTestId("job"),
      modelId: oldPrice.modelId,
      modelVersion: oldPrice.modelVersion,
      planVersionId: plan,
      pricingVersionId: oldPrice.pricingVersionId,
      projectId: legacy.scope.projectId,
      providerKey: oldPrice.providerKey,
      requestId: runtimeTestId("request"),
      requestSha256: digestStructuredValue("syntheticlegacy").slice(7),
      requestedCreditUnits: "1",
      reservationId: legacyReservationId,
    });
    legacyBefore = (
      await db.query(
        sql(
          "SELECT to_jsonb(r) AS record FROM credit_reservations r WHERE reservation_id=$1",
          [legacyReservationId],
        ),
      )
    ).rows[0]?.["record"];
    const current =
      migrationLimit === undefined
        ? migrations
        : migrations.filter(({ version }) => version <= migrationLimit);
    await runMigrations(db, current);
    await runMigrations(db, current);
  }
  async function teardown() {
    await opened?.close();
    try {
      if (created && admin) {
        const found = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schemaName],
          ),
        );
        if (
          found.rows[0]?.["marker"] !== marker ||
          !/^cm_model_accounting_[a-f0-9]{32}$/u.test(schemaName)
        )
          throw new Error("Refusing unverified synthetic schema removal.");
        await admin.transaction((tx) =>
          tx.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`)),
        );
      }
    } finally {
      await admin?.close();
    }
  }
  async function tenant(credits = "100") {
    const scope = commercialScope(
      runtimeTestId("org"),
      runtimeTestId("project"),
      runtimeTestId("principal"),
    );
    await db.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic accounting')",
          [scope.userId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic accounting',$2)",
          [scope.organizationId, scope.organizationId.replaceAll("_", "-")],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',TRUE,cloudmarkup_authorization_v2_permissions('owner'))",
          [scope.organizationId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
          [runtimeTestId("membership"), scope.organizationId, scope.userId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic accounting',$3)",
          [scope.projectId, scope.organizationId, scope.userId],
        ),
      );
    });
    const administration = {
      authority: "internal-administration" as const,
      actorId: "synthetic_admin",
      actorPrincipalId: scope.userId,
      organizationId: scope.organizationId,
      correlationId: runtimeTestId("correlation"),
    };
    const accounting = {
      authority: "internal-accounting" as const,
      actorId: "synthetic_accounting",
      organizationId: scope.organizationId,
      correlationId: administration.correlationId,
    };
    const repository = new PostgresCommercialPersistenceRepository(db);
    const account = await repository.createBillingAccount(administration, {
      billingAccountId: runtimeTestId("billing"),
    });
    await repository.updateBillingAccount(administration, {
      expectedRecordVersion: account.recordVersion,
      expensiveOperationsEnabled: true,
      lifecycleStatus: "active",
    });
    const effectiveAt = new Date(Date.now() - 1000).toISOString();
    const subscription = await repository.updateSubscriptionProjection(
      administration,
      {
        billableSeatQuantity: "1",
        billingProvider: "synthetic-billing",
        cancelAtPeriodEnd: false,
        effectiveAt,
        expectedRecordVersion: "0",
        normalizedStatus: "active",
        planVersionId: plan,
        providerCustomerReference: runtimeTestId("customer"),
        providerSubscriptionReference: runtimeTestId("subscription"),
        subscriptionProjectionId: runtimeTestId("projection"),
      },
    );
    await repository.updateEntitlementSnapshot(administration, {
      effectiveAt,
      entitlementPolicyVersion: entitlement,
      entitlementSnapshotId: runtimeTestId("entitlement"),
      expensiveOperationsEnabled: true,
      expectedRecordVersion: "0",
      planVersionId: plan,
      sourceRecordVersion: subscription.recordVersion,
      subscriptionProjectionId: subscription.subscriptionProjectionId,
    });
    if (credits !== "0")
      await repository.createCreditGrant(accounting, {
        chargingPolicyVersion: charging,
        consumptionPriority: "100",
        creditGrantId: runtimeTestId("grant"),
        creditUnits: credits,
        expirationPolicy: {
          kind: "does-not-expire",
          policyVersion: "cloudmarkup-credit-expiration-v1",
        },
        grantKind: "promotional",
        grantPolicyVersion: "cloudmarkup-credit-grants-v1",
        idempotencyKey: runtimeTestId("grantidem"),
        ledgerEntryId: runtimeTestId("ledger"),
        reasonCode: "test.synthetic-grant",
        sourceReference: runtimeTestId("source"),
        startsAt: effectiveAt,
      });
    const authorized = await new PostgresCloudMarkupRepository(
      db,
    ).resolveOrganizationScope(
      {
        correlationId: administration.correlationId,
        principalId: scope.userId,
        sessionId: runtimeTestId("session"),
      },
      scope.organizationId,
    );
    if (!authorized) throw new Error("Synthetic scope unavailable.");
    return { scope, administration, accounting, repository, authorized };
  }
  async function fixture(
    account?: Awaited<ReturnType<typeof tenant>>,
    name = runtimeTestId("case"),
    options: {
      readonly capacity?: ModelCommercialCapacityReservationV1;
      readonly windowSeconds?: number;
      readonly preview?: boolean;
      readonly complexPricing?: boolean;
      readonly expiresAfterMilliseconds?: number;
    } = {},
  ) {
    const t = account ?? (await tenant());
    const now = new Date().toISOString();
    let preview =
      options.preview === true
        ? aiPreviewFixture(
            {
              organizationId: t.scope.organizationId,
              projectId: t.scope.projectId,
              userId: t.scope.userId,
              jobId: "job_workflow",
            },
            now,
          )
        : undefined;
    const priceOverrides =
      options.complexPricing === true
        ? {
            pricing: {
              pricingVersionId: "pricing.synthetic.fractional",
              environment: "staging" as const,
              currencyCode: "EUR",
              inputMicrosPerMillionUnits: 100001,
              outputMicrosPerMillionUnits: 200003,
              cacheReadMicrosPerMillionUnits: 300007,
              cacheWriteMicrosPerMillionUnits: 400009,
              providerSpecificUnitRates: [
                { unitName: "thinking-units", microsPerMillionUnits: 500021 },
              ],
            },
            normalization: {
              normalizationPolicyVersionId: "normalization_fractional_v1",
              currencyCode: "EUR",
              creditUnitMicros: 2,
              operatingBufferBasisPoints: 2500,
            },
          }
        : {};
    if (preview !== undefined && options.complexPricing === true) {
      const result = {
        ...preview.result,
        usage: normalizedModelUsageV1Schema.parse({
          ...preview.result.usage,
          inputUnits: "11",
          outputUnits: "7",
          cacheReadUnits: "3",
          cacheWriteUnits: "2",
          thinkingUnits: "5",
        }),
      };
      const request = {
        ...preview.request,
        environment: "staging" as const,
        plannedCalls: preview.request.plannedCalls.map((call) => ({
          ...call,
          maximumUsage: {
            ...call.maximumUsage,
            cacheReadUnits: 4,
            cacheWriteUnits: 3,
            totalUnits: call.maximumUsage.totalUnits + 7,
            providerSpecificUnits: [{ unitName: "thinking-units", units: 6 }],
          },
        })),
      };
      preview = {
        ...preview,
        result,
        request,
        binding: { ...preview.binding, request },
        outputInput: { ...preview.outputInput, result },
      };
    }
    let f = await modelAccountingFixture(
      now,
      t.scope,
      name,
      options.capacity,
      preview === undefined
        ? undefined
        : {
            ...preview,
            ...priceOverrides,
            ...(options.expiresAfterMilliseconds === undefined
              ? {}
              : { expiresAfterMilliseconds: options.expiresAfterMilliseconds }),
          },
    );
    if (!f.record.resolvedContext)
      throw new Error("Synthetic context missing.");
    let record: ModelCommercialWorkflowRecordV1 = {
      ...f.record,
      resolvedContext: {
        ...f.record.resolvedContext,
        authorization: {
          ...f.record.resolvedContext.authorization,
          chargingPolicyVersion: charging,
          entitlementPolicyVersion: entitlement,
          planVersionId: plan,
        },
      },
    };
    let input = projectModelCommercialReservationV1(record);
    const modelRepository = new PostgresModelCommercialPersistenceRepository(
      db,
    );
    const pin =
      record.resolvedContext?.estimateResult.pricingAuthority.routePins[0];
    if (!pin) throw new Error("Synthetic pricing pin missing.");
    const p = pin.pricingVersion,
      n = pin.normalizationPolicy;
    await modelRepository.createModelProviderPricingVersion(t.administration, {
      pricingVersionId: p.pricingVersionId,
      providerKey: p.providerKey,
      modelId: p.modelId,
      modelVersion: p.modelVersion,
      ...(p.inferenceProfileId === null
        ? {}
        : { inferenceProfileId: p.inferenceProfileId }),
      environment: p.environment,
      effectiveFrom: p.effectiveFrom,
      status: p.status,
      costCurrency: p.currencyCode,
      inputMicrosPerMillionUnits: String(p.inputMicrosPerMillionUnits),
      outputMicrosPerMillionUnits: String(p.outputMicrosPerMillionUnits),
      cacheReadMicrosPerMillionUnits: String(p.cacheReadMicrosPerMillionUnits),
      cacheWriteMicrosPerMillionUnits: String(
        p.cacheWriteMicrosPerMillionUnits,
      ),
      providerSpecificUnitRates: p.providerSpecificUnitRates.map((rate) => ({
        unitName: rate.unitName,
        microsPerMillionUnits: String(rate.microsPerMillionUnits),
      })),
    });
    await modelRepository.createCreditNormalizationPolicyVersion(
      t.administration,
      {
        normalizationPolicyVersionId: n.normalizationPolicyVersionId,
        costCurrency: n.currencyCode,
        creditUnitMicros: String(n.creditUnitMicros),
        effectiveFrom: n.effectiveFrom,
        operatingBufferBasisPoints: String(n.operatingBufferBasisPoints),
        status: n.status,
      },
    );
    if (options.windowSeconds !== undefined) {
      if (preview !== undefined)
        throw new Error("Short-window preview fixtures are unsupported.");
      const windowMilliseconds = options.windowSeconds * 1000;
      // Seed pricing first, then give the commercial request and runtime
      // decision the same fresh database clock within one short window.
      for (;;) {
        const result = await db.query(
          sql(
            "SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS now_ms",
          ),
        );
        const now = Number(result.rows[0]?.["now_ms"]);
        if (!Number.isSafeInteger(now))
          throw new Error("Synthetic database clock unavailable.");
        const remaining = windowMilliseconds - (now % windowMilliseconds);
        if (remaining >= 1200) {
          f = await modelAccountingFixture(
            new Date(now).toISOString(),
            t.scope,
            name,
            options.capacity,
          );
          break;
        }
        await new Promise<void>((resolve) =>
          setTimeout(resolve, remaining + 10),
        );
      }
      if (!f.record.resolvedContext)
        throw new Error("Synthetic context missing.");
      record = {
        ...f.record,
        resolvedContext: {
          ...f.record.resolvedContext,
          authorization: {
            ...f.record.resolvedContext.authorization,
            chargingPolicyVersion: charging,
            entitlementPolicyVersion: entitlement,
            planVersionId: plan,
          },
        },
      };
      input = projectModelCommercialReservationV1(record);
      if (!record.resolvedContext)
        throw new Error("Synthetic context missing.");
      const latePin =
        record.resolvedContext.estimateResult.pricingAuthority.routePins[0];
      if (
        latePin?.pricingVersion.pricingVersionId !== p.pricingVersionId ||
        latePin.normalizationPolicy.normalizationPolicyVersionId !==
          n.normalizationPolicyVersionId
      )
        throw new Error("Short-window pricing pins changed after seeding.");
    }
    if (!record.resolvedContext) throw new Error("Synthetic context missing.");
    const wf = new PostgresModelCommercialWorkflowStore({
      database: db,
      scope: t.scope,
    });
    const acquired = await wf.claimExecution(commercialClaim(f.request));
    if (acquired.kind !== "acquired")
      throw new Error("Synthetic workflow claim failed.");
    const saved = await wf.compareAndSet({
      expectedRevision: 0,
      lease: acquired.lease,
      record,
      tenantScopeDigest: t.scope.tenantScopeDigest,
      trustedNow: new Date().toISOString(),
    });
    const runtimeScope = {
      organizationId: t.scope.organizationId,
      projectId: t.scope.projectId,
      userId: t.scope.userId,
    };
    const r = runtimeAdmissionFixture(
      runtimeScope,
      f.request.requestedAt,
      name,
    );
    const estimateBody = {
      ...r.request.commercialEstimate,
      maximumCreditUnits: input.requestedCreditUnits,
      estimatedMicroUsd:
        record.resolvedContext.estimateResult
          .maximumEstimatedProviderCostMicros,
      pricingVersionReference: input.event.pricingVersionId,
    };
    const { estimateDigest: oldEstimate, ...estimate } = estimateBody;
    expect(oldEstimate).toBeDefined();
    const { requestDigest: oldDigest, ...requestBody } = r.request;
    expect(oldDigest).toBeDefined();
    const runtimeRequest = modelRuntimeAdmissionRequestV1Schema.parse({
      ...requestBody,
      ...(preview === undefined
        ? {}
        : { inputDigest: preview.binding.inputDigest }),
      idempotencyKeyDigest: sha256Text(f.request.idempotencyKey),
      requested: {
        ...r.request.requested,
        outputTokens: f.request.requestedMaximumOutputUnits,
      },
      commercialEstimate: {
        ...estimate,
        estimateDigest: digestStructuredValue(estimate),
      },
      requestDigest: digestStructuredValue({
        ...requestBody,
        ...(preview === undefined
          ? {}
          : { inputDigest: preview.binding.inputDigest }),
        idempotencyKeyDigest: sha256Text(f.request.idempotencyKey),
        requested: {
          ...r.request.requested,
          outputTokens: f.request.requestedMaximumOutputUnits,
        },
        commercialEstimate: {
          ...estimate,
          estimateDigest: digestStructuredValue(estimate),
        },
      }),
    });
    const { decisionDigest: oldDecision, ...decision } = r.decision;
    expect(oldDecision).toBeDefined();
    const decisionBody = {
      ...decision,
      authorization: {
        ...decision.authorization,
        commercialReservationDecisionId: f.request.reservationId,
      },
      requestDigest: runtimeRequest.requestDigest,
      commercialEstimateDigest:
        runtimeRequest.commercialEstimate.estimateDigest,
    };
    const runtimeDecision = modelRuntimeAdmissionDecisionV1Schema.parse({
      ...decisionBody,
      decisionDigest: digestStructuredValue(decisionBody),
    });
    const state = {
      ...r.state,
      organizationWindowSeconds: options.windowSeconds ?? 3600,
      userWindowSeconds: options.windowSeconds ?? 3600,
      idempotencyKeyDigest: runtimeRequest.idempotencyKeyDigest,
      requestDigest: runtimeRequest.requestDigest,
      tenantScopeDigest: admissionScopeDigest(runtimeRequest),
    };
    const runtimeStore = new PostgresModelRuntimeAdmissionStore({
      database: db,
      scope: runtimeScope,
    });
    const claim = {
      ...r.claim(await runtimeStore.inspect(state)),
      ...state,
      admissionRequest: runtimeRequest,
      admissionDecision: runtimeDecision,
      claimOutbox: [],
      commercialExpiresAt: f.request.expiresAt,
      limits: {
        maximumConcurrentOrganizationJobs: 100,
        maximumConcurrentUserJobs: 100,
        maximumOrganizationRequests: 100,
        maximumUserRequests: 100,
      },
    };
    const runtime = await runtimeStore.claim(claim);
    if (runtime.kind !== "claimed")
      throw new Error(`Synthetic admission failed ${runtime.kind}`);
    const binding = {
      workflowId: f.request.multiCallWorkflowId,
      workflowFingerprint: f.fingerprint,
      runtimeScopeDigest: state.tenantScopeDigest,
      runtimeFingerprint: claim.fingerprint,
    };
    const errors: unknown[] = [];
    const observed: SqlDatabase = {
      query: db.query.bind(db),
      close: () => Promise.resolve(),
      transaction: async (work) => {
        try {
          return await db.transaction(work);
        } catch (error) {
          errors.push(error);
          throw error;
        }
      },
    };
    const adapter = new PostgresModelCommercialReservations({
      database: observed,
      scope: t.scope,
      binding,
    });
    return {
      ...t,
      input,
      record: saved,
      adapter,
      binding,
      wf,
      runtime,
      runtimeStore,
      claim,
      errors,
      workflowLease: acquired.lease,
      priceOverrides,
      preview:
        preview === undefined
          ? undefined
          : {
              ...preview,
              request: f.request,
              binding: { ...preview.binding, request: f.request },
            },
    };
  }
  async function terminalFixture(
    complexPricing = false,
    expiresAfterMilliseconds = 240000,
  ) {
    const f = await fixture(undefined, "", {
      preview: true,
      complexPricing,
      expiresAfterMilliseconds,
    });
    const preview = f.preview;
    if (preview === undefined) throw new Error("Synthetic preview missing.");
    await f.wf.releaseExecution({
      lease: f.workflowLease,
      multiCallWorkflowId: f.record.request.multiCallWorkflowId,
      tenantScopeDigest: f.scope.tenantScopeDigest,
    });
    const journal = new PostgresAiIntentPreviewJournal({
      database: db,
      binding: preview.binding,
    });
    const evidence = new PostgresIntentRuntimeHostEvidence({
      database: db,
      scope: preview.scope,
    });
    const h = commercialHarness(
      f.wf,
      f.record.request,
      () => new Date().toISOString(),
      {
        route: preview.route,
        accounting: f.adapter,
        terminalRecovery: f.adapter,
        invocationRecovery: journal,
        authorization: {
          chargingPolicyVersion: charging,
          entitlementPolicyVersion: entitlement,
          planVersionId: plan,
        },
        pricingVersionId: "pricing.synthetic.preview",
        ...f.priceOverrides,
      },
    );
    const generate = async (
      callback: ModelCommercialInvocationContextV1,
      acknowledged: boolean,
    ) => {
      await journal.prepare(callback);
      expect(await journal.claim(preview.claim)).toEqual({ kind: "claimed" });
      await journal.record(preview.result.usage);
      await journal.complete(preview.claim, preview.result);
      await evidence.issueInput(preview.invocation);
      const proof = await journal.prepareDelivery(
        await evidence.issueOutput(preview.outputInput),
      );
      if (acknowledged) await journal.acknowledge(proof);
      else await journal.closeDelivery();
      const delivered = await journal.deliveryOutcome();
      if (delivered.kind !== "terminal")
        throw new Error("Synthetic delivery missing.");
      return delivered.commercial;
    };
    return {
      ...f,
      coordinator: h.coordinator,
      journal,
      evidence,
      preview,
      generate,
    };
  }
  return {
    setup,
    teardown,
    tenant,
    fixture,
    terminalFixture,
    get database() {
      return db;
    },
    get legacy() {
      return legacy;
    },
    get legacyReservationId() {
      return legacyReservationId;
    },
    get legacyBefore() {
      return legacyBefore;
    },
  };
}
