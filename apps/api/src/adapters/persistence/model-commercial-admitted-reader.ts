import {
  aggregateModelUsageUnitsV1,
  ENTITLEMENT_POLICY_VERSION,
  USAGE_DISPOSITION_POLICY_VERSION,
  type CreditNormalizationPolicyVersionV1,
  type ModelProviderPricingVersionV1,
} from "@cloudmarkup/domain";
import {
  digestStructuredValue,
  type ModelCommercialAuthorizationDecisionV1,
  type ModelCommercialRouteV1,
  type ModelRuntimeControlExecutionInputV1,
  type ModelLiveRuntimeControlExecutionInputV2,
  type ModelLiveSeedRuntimeExecutionInputV4,
} from "@cloudmarkup/model-gateway";
import {
  runtimeWindow,
  type RuntimeAdmissionRecord,
} from "./model-runtime-admission-codec.js";
import type { LiveRuntimeAdmissionRecord } from "./model-live-runtime-admission-codec.js";
import {
  modelReadAssert,
  modelReadNumber,
  sameModelReadValue,
} from "./model-commercial-read-host-codec.js";
import type {
  ModelCommercialSnapshotReadAuthority,
  ModelCommercialSnapshotScope,
  ModelCommercialSnapshotData,
} from "./model-commercial-snapshot-reader.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";
import type { SeedRuntimeAdmissionRecordV4 } from "./model-live-seed-runtime-admission-codec.js";
type ModelCommercialReadRuntime =
  | Pick<
      ModelRuntimeControlExecutionInputV1,
      | "commercialRequest"
      | "routingDecision"
      | "admissionRequest"
      | "admissionDecision"
      | "policy"
    >
  | (Pick<
      ModelLiveRuntimeControlExecutionInputV2,
      | "commercialRequest"
      | "routingDecision"
      | "admissionRequest"
      | "admissionDecision"
    > & {
      readonly policy: ModelLiveRuntimeControlExecutionInputV2["plan"]["definition"]["policy"];
    })
  | (Pick<
      ModelLiveSeedRuntimeExecutionInputV4,
      | "commercialRequest"
      | "routingDecision"
      | "admissionRequest"
      | "admissionDecision"
    > & {
      readonly policy: ModelLiveSeedRuntimeExecutionInputV4["plan"]["definition"]["policy"];
    });
export interface ModelCommercialReadSnapshot {
  readonly authorization: ModelCommercialAuthorizationDecisionV1;
  readonly price: ModelProviderPricingVersionV1;
  readonly normalization: CreditNormalizationPolicyVersionV1;
}
const rowText = (row: SqlRow, key: string): string => {
  const value = row[key];
  modelReadAssert(typeof value === "string");
  return value;
};
const hexDigest = (value: string) => value.slice(7);
/** Shared internal read algorithm. Closed versioned hosts supply their own exact
 * parser, current authenticated authority and canonical snapshot; no admission,
 * reservation, dispatch or promotion can be created through this reader. */
export async function readModelCommercialAdmittedRuntime(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialSnapshotScope;
  readonly identity: {
    readonly tenantScopeDigest: string;
    readonly fingerprint: string;
  };
  readonly runtime: ModelCommercialReadRuntime;
  readonly parseRow: (
    row: SqlRow,
    scope: ModelCommercialSnapshotScope,
  ) =>
    | RuntimeAdmissionRecord
    | LiveRuntimeAdmissionRecord
    | SeedRuntimeAdmissionRecordV4;
}): Promise<
  | RuntimeAdmissionRecord
  | LiveRuntimeAdmissionRecord
  | SeedRuntimeAdmissionRecordV4
> {
  const { tx, scope, identity, runtime, parseRow } = input;
  const row = (
    await tx.query(
      sql(
        `SELECT organization_id,project_id,principal_id,scope_sha256,snapshot,snapshot_sha256,revision::text,active_concurrency_lease_id,
       to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS lease_expires_at FROM model_runtime_admissions
       WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4
       AND lease_expires_at>clock_timestamp()
       AND snapshot->>'fingerprint'=$5 AND snapshot->'recoveryRequired'='false'::jsonb
       AND snapshot#>'{executionLease,recoveryOnly}'='false'::jsonb
       AND snapshot#>>'{decision,outcome}'='allowed' AND snapshot->'terminal'='null'::jsonb
       AND (snapshot->>'commercialExpiresAt')::timestamptz>clock_timestamp() FOR SHARE`,
        [
          scope.organizationId,
          hexDigest(identity.tenantScopeDigest),
          scope.projectId,
          scope.userId,
          identity.fingerprint,
        ],
      ),
    )
  ).rows[0];
  modelReadAssert(row !== undefined);
  const record = parseRow(row, scope);
  modelReadAssert(
    row["snapshot_sha256"] === hexDigest(digestStructuredValue(record)) &&
      record.fingerprint === identity.fingerprint &&
      sameModelReadValue(record.request, runtime.admissionRequest) &&
      sameModelReadValue(record.decision, runtime.admissionDecision),
  );
  for (const key of ["organization", "user"] as const) {
    const expected = runtimeWindow(
      record.originalSnapshot.capturedAt,
      runtime.policy.requestWindows[key].windowSeconds,
    );
    const actual = record.originalSnapshot.windows[key];
    modelReadAssert(
      actual.windowStartedAt === expected.startsAt &&
        actual.windowEndsAt === expected.endsAt,
    );
  }
  return record;
}

export async function readModelCommercialAdmittedSnapshot(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialSnapshotScope;
  readonly authority: ModelCommercialSnapshotReadAuthority;
  readonly runtime: ModelCommercialReadRuntime;
  readonly readRuntime: (
    tx: SqlExecutor,
  ) => Promise<
    | RuntimeAdmissionRecord
    | LiveRuntimeAdmissionRecord
    | SeedRuntimeAdmissionRecordV4
  >;
  readonly readCanonical: (
    tx: SqlExecutor,
  ) => Promise<Omit<ModelCommercialSnapshotData, "descriptor">>;
  readonly routeExplanation: string;
}): Promise<ModelCommercialReadSnapshot> {
  const {
    tx,
    scope,
    authority,
    runtime: runtimeInput,
    readRuntime,
    readCanonical,
    routeExplanation,
  } = input;
  await authority.assertCurrent(tx, scope);
  await tx.query(
    sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `runtime-admission:${scope.organizationId}`,
    ]),
  );
  const runtime = await readRuntime(tx);
  const windows = runtime.originalSnapshot.windows;
  const canonical = await readCanonical(tx);
  const { price, normalization, balance, entitlement } = canonical;
  const planVersion = entitlement.planVersionId;
  const planKey = entitlement.planKey;
  modelReadAssert(
    planKey === runtimeInput.admissionRequest.plan &&
      planVersion === runtimeInput.routingDecision.entitlement.planVersionId &&
      price.environment === runtimeInput.commercialRequest.environment,
  );
  const maximumConcurrent = Math.min(
    canonical.maximumConcurrentReservations,
    runtimeInput.policy.requestWindows.organization.maximumConcurrentJobs,
  );
  const counts = (
    await tx.query(
      sql(
        `SELECT
            (SELECT count(*)::text FROM model_commercial_reservation_decisions WHERE organization_id=$1 AND accepted AND created_at >= $2::timestamptz AND created_at < $3::timestamptz) AS feature_count,
            (SELECT count(*)::text FROM model_commercial_reservation_decisions WHERE organization_id=$1 AND principal_id=$4 AND accepted AND created_at >= $5::timestamptz AND created_at < $6::timestamptz) AS user_count,
            (SELECT count(*)::text FROM credit_reservations WHERE organization_id=$1 AND status='active') AS concurrent_count`,
        [
          scope.organizationId,
          windows.organization.windowStartedAt,
          windows.organization.windowEndsAt,
          scope.userId,
          windows.user.windowStartedAt,
          windows.user.windowEndsAt,
        ],
      ),
    )
  ).rows[0];
  modelReadAssert(counts !== undefined);
  const currentAuthority = await authority.assertCurrent(tx, scope);
  const currentRuntime = await readRuntime(tx);
  const clock = (
    await tx.query(
      sql(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at`,
      ),
    )
  ).rows[0];
  modelReadAssert(clock !== undefined);
  const evaluatedAt = rowText(clock, "observed_at");
  const now = Date.parse(evaluatedAt);
  modelReadAssert(
    Number.isFinite(now) &&
      now < Date.parse(currentAuthority.expiresAt) &&
      currentRuntime.executionLease !== null &&
      now < Date.parse(currentRuntime.executionLease.expiresAt) &&
      now < Date.parse(currentRuntime.commercialExpiresAt),
  );
  for (const interval of [windows.organization, windows.user])
    modelReadAssert(
      Date.parse(interval.windowStartedAt) <= now &&
        now < Date.parse(interval.windowEndsAt),
    );
  for (const version of [price, normalization])
    modelReadAssert(
      Date.parse(version.effectiveFrom) <= now &&
        (version.effectiveUntil === null ||
          now < Date.parse(version.effectiveUntil)),
    );
  modelReadAssert(now < Date.parse(canonical.expiresAt));
  const enabled =
    canonical.featureEnabled &&
    runtimeInput.policy.featureEntitlements.some(
      (entry) =>
        entry.plan === planKey &&
        entry.features.some(
          (feature) => feature === runtimeInput.commercialRequest.feature,
        ),
    );
  const selectedRoute = runtimeInput.commercialRequest.requestedRoute;
  modelReadAssert(["standard", "deep"].includes(selectedRoute));
  const route: ModelCommercialRouteV1 = {
    route: selectedRoute,
    routeId: runtimeInput.routingDecision.routeId,
    label: selectedRoute === "standard" ? "Standard Design" : "Deep Design",
    explanation: routeExplanation,
    providerKey: price.providerKey,
    modelId: price.modelId,
    modelVersion: price.modelVersion,
    inferenceProfileId: price.inferenceProfileId,
  };
  const primary = runtimeInput.commercialRequest.plannedCalls[0];
  modelReadAssert(primary !== undefined);
  const slots = runtimeInput.admissionRequest.contractVersion === 4 ? 2 : 1;
  const maximum =
    slots === 2
      ? aggregateModelUsageUnitsV1(
          runtimeInput.commercialRequest.plannedCalls.map(
            (call) => call.maximumUsage,
          ),
        )
      : primary.maximumUsage;
  const authorization: ModelCommercialAuthorizationDecisionV1 = {
    allowed: enabled,
    allowedModelKeys: [
      [
        route.providerKey,
        route.modelId,
        route.modelVersion,
        route.inferenceProfileId ?? "",
      ].join("|"),
    ],
    allowedRouteIds: [route.routeId],
    approvedRoutes: [route],
    availableCreditUnits: modelReadNumber(balance.availableCreditUnits),
    chargingPolicyVersion: USAGE_DISPOSITION_POLICY_VERSION,
    commercialState: enabled ? "active" : "unavailable",
    denialReason: enabled ? null : "commercial-state-unavailable",
    entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION,
    evaluatedAt,
    featureEntitled: enabled,
    featureRequests: {
      current: modelReadNumber(counts["feature_count"]),
      maximum: runtimeInput.policy.requestWindows.organization.maximumRequests,
    },
    maximumInputUnits: Math.min(
      runtimeInput.commercialRequest.requestedMaximumInputUnits,
      maximum.inputUnits,
    ),
    maximumOutputUnits: Math.min(
      runtimeInput.commercialRequest.requestedMaximumOutputUnits,
      runtimeInput.policy.limits.maximumOutputTokens * slots,
      runtimeInput.routingDecision.maximumOutputTokens * slots,
      maximum.outputUnits,
    ),
    organizationConcurrentReservations: {
      current: modelReadNumber(counts["concurrent_count"]),
      maximum: maximumConcurrent,
    },
    organizationId: scope.organizationId,
    organizationStatus: "active",
    perUserRequests: {
      current: modelReadNumber(counts["user_count"]),
      maximum: runtimeInput.policy.requestWindows.user.maximumRequests,
    },
    planVersionId: planVersion,
  };
  return { authorization, price, normalization };
}
