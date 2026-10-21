/* eslint-disable @typescript-eslint/require-await -- Synthetic ports exercise the real coordinator without provider or SQL I/O. */
import type {
  CreditNormalizationPolicyVersionV1,
  ModelProviderPricingVersionV1,
} from "@cloudmarkup/domain";
import {
  digestModelCommercialVerifiedScopeV1,
  digestStructuredValue,
  ModelCommercialLifecycleCoordinator,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialVerifiedScopeV1,
  type ModelCommercialWorkflowStore,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialRouteV1,
  type ModelCommercialAuthorizationDecisionV1,
  type ModelCommercialInvocationRecoveryPortV1,
  type ModelCommercialAccountingPort,
  type ModelCommercialTerminalRecoveryPortV1,
} from "@cloudmarkup/model-gateway";
import {
  InMemoryCanonicalModelCommercialAccounting,
  InMemoryModelCommercialAuthorization,
  InMemoryModelCommercialHostAttestations,
  InMemoryModelCommercialPricing,
  InMemoryModelCommercialScopeResolver,
} from "@cloudmarkup/model-gateway/testing";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

export const workflowTestTime = "2026-09-05T12:00:00.000Z";
export function commercialScope(
  organizationId = "org_workflow",
  projectId = "project_workflow",
  userId = "user_workflow",
): ModelCommercialVerifiedScopeV1 {
  const identities = { organizationId, projectId, userId };
  return {
    ...identities,
    authority: "verified-principal-scope-v1",
    tenantScopeDigest: digestModelCommercialVerifiedScopeV1(identities),
  };
}
export const workflowTestRoute: ModelCommercialRouteV1 = {
  explanation: "Synthetic reviewed route.",
  inferenceProfileId: "synthetic_profile",
  label: "Standard Design",
  modelId: "synthetic_model",
  modelVersion: "synthetic_v1",
  providerKey: "synthetic_provider",
  route: "standard",
  routeId: "synthetic_route",
};
export function commercialUsage(input = 100, output = 20) {
  return {
    inputUnits: input,
    outputUnits: output,
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    totalUnits: input + output,
    providerSpecificUnits: [],
  };
}
export function commercialRequest(
  scope = commercialScope(),
  now = workflowTestTime,
): ModelCommercialOperationRequestV1 {
  return {
    confirmationRequired: false,
    environment: "test",
    estimateAccepted: true,
    eventIdPrefix: "event_workflow",
    expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
    feature: "ai-assisted-operations",
    idempotencyKey: "idempotency_workflow",
    includeTechnicalUnitDetail: true,
    jobId: "job_workflow",
    multiCallWorkflowId: "workflow_one",
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    plannedCalls: [
      {
        kind: "primary",
        maximumUsage: commercialUsage(200, 40),
        minimumUsage: commercialUsage(50, 10),
        routeId: workflowTestRoute.routeId,
      },
    ],
    promptId: "prompt_workflow",
    promptVersion: "prompt_v1",
    requestedAt: now,
    requestedMaximumInputUnits: 200,
    requestedMaximumOutputUnits: 40,
    requestedRoute: "standard",
    requestId: "request_workflow",
    reservationId: "reservation_workflow",
    templateId: null,
    templateVersion: null,
  };
}
export function commercialClaim(
  request = commercialRequest(),
  now = request.requestedAt,
) {
  return {
    fingerprint: digestStructuredValue(request),
    leaseExpiresAt: new Date(Date.parse(now) + 300000).toISOString(),
    recoveryOnly: false,
    request,
    tenantScopeDigest: digestModelCommercialVerifiedScopeV1(request),
    trustedNow: now,
  };
}
export function commercialInvocation(
  request: ModelCommercialOperationRequestV1,
): ModelCommercialInvocationResultV1 {
  const completedAt = request.requestedAt;
  return {
    attempts: [
      {
        attemptId: "attempt_one",
        attemptKind: "primary",
        attemptNumber: 1,
        callId: "call_one",
        completedAt,
        failureCategory: null,
        invocationId: "invocation_one",
        latencyMilliseconds: 1000,
        mayHaveBeenProcessed: true,
        modelId: workflowTestRoute.modelId,
        modelVersion: workflowTestRoute.modelVersion,
        inferenceProfileId: workflowTestRoute.inferenceProfileId,
        promptId: request.promptId,
        promptVersion: request.promptVersion,
        providerKey: workflowTestRoute.providerKey,
        providerRequestId: "provider_request",
        retryOfAttemptId: null,
        routeId: workflowTestRoute.routeId,
        startedAt: request.requestedAt,
        status: "succeeded",
        usage: commercialUsage(),
        usageRecordId: "usage_one",
      },
    ],
    completedAt,
    failureCategory: null,
    resultId: "result_one",
    status: "completed",
    usefulOutputDelivered: true,
  };
}
export function commercialHarness(
  workflows: ModelCommercialWorkflowStore,
  request = commercialRequest(),
  now = () => request.requestedAt,
  options: {
    readonly route?: ModelCommercialRouteV1;
    readonly pricingVersionId?: string;
    readonly pricing?: Partial<ModelProviderPricingVersionV1>;
    readonly normalization?: Partial<CreditNormalizationPolicyVersionV1>;
    readonly authorization?: Partial<ModelCommercialAuthorizationDecisionV1>;
    readonly invocationRecovery?: ModelCommercialInvocationRecoveryPortV1;
    readonly accounting?: ModelCommercialAccountingPort;
    readonly terminalRecovery?: ModelCommercialTerminalRecoveryPortV1;
  } = {},
) {
  const route = options.route ?? workflowTestRoute;
  const authorization: ModelCommercialAuthorizationDecisionV1 = {
    allowed: true,
    allowedModelKeys: [
      [
        route.providerKey,
        route.modelId,
        route.modelVersion,
        route.inferenceProfileId,
      ].join("|"),
    ],
    allowedRouteIds: [route.routeId],
    approvedRoutes: [route],
    availableCreditUnits: 100,
    chargingPolicyVersion: "charging_v1",
    commercialState: "active",
    denialReason: null,
    entitlementPolicyVersion: "entitlement_v1",
    evaluatedAt: request.requestedAt,
    featureEntitled: true,
    featureRequests: { current: 0, maximum: 100 },
    maximumInputUnits: 1000,
    maximumOutputUnits: 1000,
    organizationConcurrentReservations: { current: 0, maximum: 10 },
    organizationId: request.organizationId,
    organizationStatus: "active",
    perUserRequests: { current: 0, maximum: 100 },
    planVersionId: "plan_v1",
    ...options.authorization,
  };
  const accounting = new InMemoryCanonicalModelCommercialAccounting({
    [request.organizationId]: 100,
  });
  const dependencies = {
    accounting: options.accounting ?? accounting,
    attestations: new InMemoryModelCommercialHostAttestations(),
    authorization: new InMemoryModelCommercialAuthorization(authorization),
    now,
    pricing: new InMemoryModelCommercialPricing({
      policies: [
        {
          creditUnitMicros: 100,
          currencyCode: "USD",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          effectiveUntil: null,
          normalizationPolicyVersionId: "normalization_v1",
          operatingBufferBasisPoints: 0,
          status: "enabled",
          version: 1,
          ...options.normalization,
        },
      ],
      pricing: [
        {
          cacheReadMicrosPerMillionUnits: 1000000,
          cacheWriteMicrosPerMillionUnits: 1000000,
          currencyCode: "USD",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          effectiveUntil: null,
          environment: "test",
          inferenceProfileId: route.inferenceProfileId,
          inputMicrosPerMillionUnits: 1000000,
          modelId: route.modelId,
          modelVersion: route.modelVersion,
          outputMicrosPerMillionUnits: 1000000,
          pricingVersionId: options.pricingVersionId ?? "pricing_v1",
          providerKey: route.providerKey,
          providerSpecificUnitRates: [],
          status: "enabled",
          version: 1,
          ...options.pricing,
        },
      ],
    }),
    scopeResolver: new InMemoryModelCommercialScopeResolver(request),
    workflows,
    ...(options.terminalRecovery === undefined
      ? {}
      : { terminalRecovery: options.terminalRecovery }),
    ...(options.invocationRecovery === undefined
      ? {}
      : { invocationRecovery: options.invocationRecovery }),
  };
  const coordinator = new ModelCommercialLifecycleCoordinator(dependencies);
  return { accounting, coordinator, dependencies };
}

/** Statement-aware deterministic test double, not PostgreSQL execution evidence.
 * Serial transactions and rollback support coordinator crash/replay scenarios. */
export class WorkflowStatementDatabase implements SqlDatabase {
  now = workflowTestTime;
  rows = new Map<string, Record<string, unknown>>();
  history: unknown[] = [];
  statements: SqlStatement[] = [];
  failNextSnapshot: ((snapshot: unknown) => boolean) | null = null;
  #tail = Promise.resolve();
  async close(): Promise<void> {
    return;
  }
  async transaction<T>(
    work: (executor: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    const previous = this.#tail;
    let release = () => {
      /* overwritten before awaiting */
    };
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const rows = structuredClone(this.rows);
    const history = structuredClone(this.history);
    try {
      return await work(this);
    } catch (error) {
      this.rows = rows;
      this.history = history;
      throw error;
    } finally {
      release();
    }
  }
  async query<T extends SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<T>> {
    this.statements.push(statement);
    const values = statement.values;
    const key = values.slice(0, 5).join("|");
    const stored = this.rows.get(key);
    const result = (
      rows: SqlRow[] = [],
      rowCount = rows.length,
    ): SqlResult<T> => ({ rows: rows as T[], rowCount });
    if (statement.text.includes("pg_advisory_xact_lock")) return result();
    if (statement.text.includes("AS workflow_now"))
      return result([{ workflow_now: this.now }]);
    if (statement.text.startsWith("SELECT *")) {
      // Deliberately fail like a bounded row transport, not a PostgreSQL or AWS
      // emulator. The real RDS Data API adapter uses the same SqlDatabase port.
      const projected =
        stored === undefined
          ? undefined
          : { ...stored, snapshot: JSON.stringify(stored["snapshot"]) };
      if (
        projected !== undefined &&
        new TextEncoder().encode(JSON.stringify(projected)).byteLength > 65536
      )
        throw new Error("Synthetic Data API row byte limit.");
      return result(
        projected === undefined ? [] : [structuredClone(projected)],
      );
    }
    if (statement.text.startsWith("SELECT workflow_id"))
      return result(
        [...this.rows.values()].filter(
          (row) =>
            row["organization_id"] === values[0] &&
            (row["reservation_id"] === values[1] ||
              (row["scope_sha256"] === values[2] &&
                row["idempotency_sha256"] === values[3])),
        ),
      );
    if (statement.text.startsWith("INSERT INTO model_commercial_workflows")) {
      if (stored !== undefined) throw new Error("Synthetic duplicate claim.");
      const snapshot = JSON.parse(String(values[8])) as unknown;
      this.rows.set(key, {
        organization_id: values[0],
        scope_sha256: values[1],
        project_id: values[2],
        principal_id: values[3],
        workflow_id: values[4],
        fingerprint_sha256: values[5],
        idempotency_sha256: values[6],
        reservation_id: values[7],
        snapshot,
        snapshot_sha256: values[9],
        revision: 0,
        state: "claimed",
        fence: values[10],
        lease_id: values[11],
        acquired_iso: values[12],
        expires_iso: values[13],
      });
      this.history.push(snapshot);
      return result([], 1);
    }
    if (stored === undefined) return result([], 0);
    if (
      statement.text.startsWith(
        "UPDATE model_commercial_workflows SET snapshot",
      )
    ) {
      const snapshot = JSON.parse(String(values[5])) as unknown;
      if (this.failNextSnapshot?.(snapshot) === true) {
        this.failNextSnapshot = null;
        throw new Error("Synthetic crash before metadata CAS.");
      }
      if (
        stored["revision"] !== values[9] ||
        stored["fence"] !== values[10] ||
        stored["lease_id"] !== values[11] ||
        Date.parse(String(stored["expires_iso"])) <= Date.parse(this.now)
      )
        return result([], 0);
      Object.assign(stored, {
        snapshot,
        snapshot_sha256: values[6],
        revision: values[7],
        state: values[8],
      });
      this.history.push(structuredClone(snapshot));
      return result([], 1);
    }
    if (
      statement.text.startsWith("UPDATE model_commercial_workflows SET fence")
    ) {
      if (
        stored["lease_id"] !== null &&
        Date.parse(String(stored["expires_iso"])) > Date.parse(this.now)
      )
        return result([], 0);
      Object.assign(stored, {
        fence: values[5],
        lease_id: values[6],
        acquired_iso: values[7],
        expires_iso: values[8],
      });
      return result([], 1);
    }
    if (
      statement.text.startsWith(
        "UPDATE model_commercial_workflows SET lease_id=NULL",
      )
    ) {
      Object.assign(stored, {
        lease_id: null,
        acquired_iso: null,
        expires_iso: null,
      });
      return result([], 1);
    }
    throw new Error("Unexpected commercial workflow SQL statement.");
  }
}
