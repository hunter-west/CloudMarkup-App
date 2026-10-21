import { setTimeout as waitForTimer } from "node:timers/promises";
import {
  digestStructuredValue,
  ModelRuntimeControlError,
  projectModelCommercialReservationV1,
  type ModelCommercialWorkflowRecordV1,
  type ModelRuntimeStateSnapshotRequestV1,
} from "@cloudmarkup/model-gateway";
import { utcTimestampSchema } from "@cloudmarkup/schemas";
import type { Principal } from "../../application/identity.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { PostgresModelLiveRuntimeAdmissionStore } from "./model-live-runtime-admission-store.js";
import { PostgresModelLiveCommercialReservations } from "./model-live-commercial-reservations.js";
import { PostgresModelCommercialWorkflowStore } from "./model-commercial-workflow-store.js";
import { PostgresModelCommercialPersistenceRepository } from "./model-commercial-repository.js";
import { modelLiveAccountingBindingSchema } from "./model-live-commercial-accounting-codec.js";
import {
  modelLiveAccountingFixture,
  type LiveAccountingTestHost,
} from "./model-live-commercial-accounting-test-helpers.js";
import { commercialClaim } from "./model-commercial-workflow-test-helpers.js";
import {
  createModelAccountingPgTestHarness,
  plan,
  charging,
  entitlement,
} from "./model-commercial-accounting-pg-test-helpers.js";
import { runtimeWindow } from "./model-runtime-admission-codec.js";
import { runtimeTestId } from "./model-runtime-admission-test-helpers.js";

/** Synthetic loopback fixture using actual plan issuance, shared runtime claims,
 * immutable workflow storage and canonical commercial pricing/balances.
 * No live provider, genuine validator receipt or production credit grant. */
export async function createLiveAccountingPgSeed(
  harness: ReturnType<typeof createModelAccountingPgTestHarness>,
  credits = "100",
  routeMode: "standard" | "deep" = "standard",
  host?: LiveAccountingTestHost & {
    setPlans(plans: PostgresModelLiveEvaluationPlans): void;
  },
  options: { readonly expiresAfterMilliseconds?: number } = {},
) {
  const tenant = await harness.tenant(credits);
  const database = harness.database;
  const errors: unknown[] = [];
  let operators: readonly string[] = [tenant.scope.userId];
  let configurationAvailable = true;
  let beforeInsert: (() => void) | undefined;
  let afterJournalCompletion: (() => void) | undefined;
  let afterHostOutput: (() => void) | undefined;
  let afterValidationReceipt: (() => void) | undefined;
  let corruptTerminalDetail = false;
  let corruptTerminalSource = false;
  const observed: SqlDatabase = {
    query: database.query.bind(database),
    close: () => Promise.resolve(),
    transaction: async (work) => {
      try {
        return await database.transaction((tx) =>
          work({
            query: async <R extends SqlRow>(statement: SqlStatement) => {
              if (
                corruptTerminalDetail &&
                statement.text.includes("INSERT INTO model_usage_event_details")
              ) {
                corruptTerminalDetail = false;
                const values = [...statement.values];
                values[14] = BigInt(String(values[14])) + 1n;
                values[18] = BigInt(String(values[18])) + 1n;
                return tx.query<R>({ ...statement, values });
              }
              if (
                corruptTerminalSource &&
                statement.text.includes(
                  "INSERT INTO model_commercial_accounting_outcomes",
                )
              ) {
                corruptTerminalSource = false;
                const values = [...statement.values];
                values[11] = "workflow-receipt";
                values[17] = null;
                return tx.query<R>({ ...statement, values });
              }
              const result = await tx.query<R>(statement);
              if (
                statement.text.includes(
                  "INSERT INTO model_commercial_reservation_decisions",
                )
              )
                beforeInsert?.();
              if (
                statement.text.includes(
                  "UPDATE model_live_invocations SET gateway_state='complete'",
                )
              )
                afterJournalCompletion?.();
              if (
                statement.text.includes(
                  "INSERT INTO model_live_runtime_host_evidence",
                ) &&
                statement.values[7] === "allow-listed-operations"
              )
                afterHostOutput?.();
              if (
                statement.text.includes(
                  "INSERT INTO model_live_proposal_validation_receipts",
                )
              )
                afterValidationReceipt?.();
              return result;
            },
          }),
        );
      } catch (error) {
        errors.push(error);
        throw error;
      }
    },
  };
  const now = new Date().toISOString();
  const principal: Principal = {
    principalId: tenant.scope.userId,
    sessionId: runtimeTestId("session"),
    authenticationSource: "cognito",
    authenticatedAt: now,
    expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
  };
  let issuedStore: PostgresModelLiveEvaluationPlans | undefined;
  const f = await modelLiveAccountingFixture(
    {
      organizationId: tenant.scope.organizationId,
      projectId: tenant.scope.projectId,
      userId: tenant.scope.userId,
      definitionId: runtimeTestId("definition"),
      now,
      ...options,
    },
    async (configuration) => {
      const store = new PostgresModelLiveEvaluationPlans({
        database: observed,
        scope: configuration.definition.scope,
        principal,
        configuration: {
          environment: "development",
          resolveOperatorPrincipalIds: () => Promise.resolve(operators),
          resolveDefinition: (id) =>
            Promise.resolve(
              configurationAvailable &&
                id === configuration.definition.definitionId
                ? configuration
                : null,
            ),
        },
      });
      issuedStore = store;
      host?.setPlans(store);
      const approved = await store.approve({
        definitionId: configuration.definition.definitionId,
        expectedDefinitionDigest: configuration.definition.definitionDigest,
      });
      await host?.afterPlanIssued?.(approved);
      return approved;
    },
    routeMode,
    {
      planVersionId: plan,
      chargingPolicyVersion: charging,
      entitlementPolicyVersion: entitlement,
    },
    host,
  );
  const plans = issuedStore;
  if (plans === undefined || f.workflow.resolvedContext === null)
    throw Error("Synthetic issued plan or workflow context missing.");
  const record: ModelCommercialWorkflowRecordV1 = f.workflow;
  const price =
    record.resolvedContext?.estimateResult.pricingAuthority.routePins[0];
  if (price === undefined) throw Error("Synthetic canonical price missing.");
  const p = price.pricingVersion,
    n = price.normalizationPolicy;
  const repository = new PostgresModelCommercialPersistenceRepository(database);
  await repository.createModelProviderPricingVersion(tenant.administration, {
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
    cacheWriteMicrosPerMillionUnits: String(p.cacheWriteMicrosPerMillionUnits),
    providerSpecificUnitRates: p.providerSpecificUnitRates.map((r) => ({
      unitName: r.unitName,
      microsPerMillionUnits: String(r.microsPerMillionUnits),
    })),
  });
  await repository.createCreditNormalizationPolicyVersion(
    tenant.administration,
    {
      normalizationPolicyVersionId: n.normalizationPolicyVersionId,
      costCurrency: n.currencyCode,
      creditUnitMicros: String(n.creditUnitMicros),
      effectiveFrom: n.effectiveFrom,
      operatingBufferBasisPoints: String(n.operatingBufferBasisPoints),
      status: n.status,
    },
  );
  return {
    ...tenant,
    ...f,
    plans,
    principal,
    errors,
    database: observed,
    corruptNextTerminalDetail: () => {
      corruptTerminalDetail = true;
    },
    corruptNextTerminalSource: () => {
      corruptTerminalSource = true;
    },
    removeOperators: () => {
      operators = [];
    },
    removeConfiguration: () => {
      configurationAvailable = false;
    },
    withdrawDuringReservation: () => {
      beforeInsert = () => {
        operators = [];
      };
    },
    withdrawDuringValidationReceipt: () => {
      afterValidationReceipt = () => {
        operators = [];
      };
    },
    withdrawDuringHostOutput: () => {
      afterHostOutput = () => {
        operators = [];
      };
    },
    withdrawDuringJournalCompletion: () => {
      afterJournalCompletion = () => {
        operators = [];
      };
    },
  };
}

/** Keep this suite's real-clock setup clear of the hourly reservation boundary.
 * Run as a beforeEach hook, before tenant/plan/lease creation. No issued
 * authority is refreshed and no failed reservation is retried. */
export async function waitForLiveAccountingPgTestWindow(
  database: Pick<SqlDatabase, "query">,
  wait: (milliseconds: number) => Promise<void> = async (milliseconds) => {
    await waitForTimer(milliseconds);
  },
): Promise<void> {
  const read = async () => {
    const clock = await database.query(
      sql(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS runtime_snapshot_now",
      ),
    );
    return Date.parse(
      utcTimestampSchema.parse(clock.rows[0]?.["runtime_snapshot_now"]),
    );
  };
  const hour = 3_600_000;
  const headroom = 60_000;
  const original = await read();
  const remaining = hour - (original % hour);
  if (remaining >= headroom) return;
  await wait(remaining + 1);
  const current = await read();
  if (
    current <= original ||
    Math.floor(current / hour) <= Math.floor(original / hour) ||
    hour - (current % hour) < headroom
  )
    throw new Error(
      "Synthetic fixture could not enter a stable database request window.",
    );
}

/** Test-only fresh snapshot time. Preparation may cross a UTC request-window
 * boundary after immutable decision issuance. Preserve that decision and every
 * request binding; do not retry a sanitized error or alter production clocks. */
export async function currentLiveAccountingPgSnapshotState<
  T extends ModelRuntimeStateSnapshotRequestV1,
>(database: Pick<SqlDatabase, "query">, state: T): Promise<T> {
  const clock = await database.query(
    sql(
      "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS runtime_snapshot_now",
    ),
  );
  return {
    ...state,
    decidedAt: utcTimestampSchema.parse(
      clock.rows[0]?.["runtime_snapshot_now"],
    ),
  };
}

/** At most one retry of the read-only inspection when its scoped inner error
 * and a later database clock both prove a UTC window rollover. Issued authority
 * is unchanged; the second inspection rechecks current authorization normally. */
export async function inspectCurrentLiveAccountingPgSnapshot<
  State extends ModelRuntimeStateSnapshotRequestV1,
  Snapshot,
>(
  database: Pick<SqlDatabase, "query">,
  original: State,
  inspect: (state: State) => Promise<Snapshot>,
  errors: readonly unknown[],
): Promise<{ state: State; snapshot: Snapshot }> {
  const state = await currentLiveAccountingPgSnapshotState(database, original);
  const errorOffset = errors.length;
  try {
    return { state, snapshot: await inspect(state) };
  } catch (error) {
    const captured = errors.slice(errorOffset);
    const inner = captured[0];
    if (
      captured.length !== 1 ||
      !(inner instanceof ModelRuntimeControlError) ||
      inner.safeCode !== "stale-or-duplicate-conflict"
    )
      throw error;
    const current = await currentLiveAccountingPgSnapshotState(database, state);
    const windows = [state.userWindowSeconds, state.organizationWindowSeconds];
    const advanced = windows.some(
      (seconds) =>
        runtimeWindow(current.decidedAt, seconds).startsAt >
        runtimeWindow(state.decidedAt, seconds).startsAt,
    );
    if (
      Date.parse(current.decidedAt) <= Date.parse(state.decidedAt) ||
      !advanced
    )
      throw error;
    return { state: current, snapshot: await inspect(current) };
  }
}

export async function createLiveAccountingPgFixture(
  harness: ReturnType<typeof createModelAccountingPgTestHarness>,
  credits = "100",
  routeMode: "standard" | "deep" = "standard",
  host?: LiveAccountingTestHost & {
    setPlans(plans: PostgresModelLiveEvaluationPlans): void;
  },
  options: { readonly expiresAfterMilliseconds?: number } = {},
) {
  const seed = await createLiveAccountingPgSeed(
    harness,
    credits,
    routeMode,
    host,
    options,
  );
  const f = seed,
    tenant = seed,
    plans = seed.plans,
    principal = seed.principal;
  const errors = seed.errors,
    database = harness.database,
    observed = seed.database;
  const record = seed.workflow;
  const workflows = new PostgresModelCommercialWorkflowStore({
    database,
    scope: tenant.scope,
  });
  const acquired = await workflows.claimExecution(
    commercialClaim(record.request),
  );
  if (acquired.kind !== "acquired")
    throw Error("Synthetic workflow unavailable.");
  const saved = await workflows.compareAndSet({
    expectedRevision: 0,
    lease: acquired.lease,
    record,
    tenantScopeDigest: tenant.scope.tenantScopeDigest,
    trustedNow: new Date().toISOString(),
  });
  const identity = {
    definitionId: f.plan.definition.definitionId,
    planDigest: f.plan.planDigest,
  };
  const runtimeStore = new PostgresModelLiveRuntimeAdmissionStore({
    database,
    scope: f.source.scope,
    plans,
    ...identity,
  });
  const { state, snapshot } = await inspectCurrentLiveAccountingPgSnapshot(
    database,
    {
      ...f.source.state,
      decidedAt: f.runtime.decision.decidedAt,
      idempotencyKeyDigest: f.runtime.request.idempotencyKeyDigest,
      requestDigest: f.runtime.request.requestDigest,
      tenantScopeDigest: f.runtime.tenantScopeDigest,
      liveAuthorityReservation: f.runtime.liveAuthorityReservation,
    },
    (input) => runtimeStore.inspect(input),
    errors,
  );
  const claim = {
    ...f.source.claim(snapshot),
    ...state,
    admissionRequest: f.runtime.request,
    admissionDecision: f.runtime.decision,
    fingerprint: f.runtime.fingerprint,
    commercialExpiresAt: saved.request.expiresAt,
    executionLeaseExpiresAt: saved.request.expiresAt,
  };
  const admitted = await runtimeStore.claim(claim);
  if (admitted.kind !== "claimed")
    throw Error("Synthetic live claim failed: " + admitted.kind);
  const binding = modelLiveAccountingBindingSchema.parse({
    ...f.binding,
    workflowFingerprint: saved.fingerprint,
  });
  const adapter = new PostgresModelLiveCommercialReservations({
    database: observed,
    scope: tenant.scope,
    plans,
    binding,
    ...identity,
  });
  return {
    ...seed,
    record: saved,
    plans,
    adapter,
    binding,
    runtimeStore,
    snapshotState: state,
    claim,
    admitted,
    workflows,
    workflowLease: acquired.lease,
    principal,
    errors,
    input: projectModelCommercialReservationV1(saved),
    identity,
    persistedRuntime: async () =>
      (
        await database.query(
          sql(
            "SELECT snapshot FROM model_runtime_admissions WHERE organization_id=$1 AND scope_sha256=$2",
            [tenant.scope.organizationId, binding.runtimeScopeDigest.slice(7)],
          ),
        )
      ).rows[0]?.["snapshot"],
    bindingDigest: digestStructuredValue(binding),
  };
}
