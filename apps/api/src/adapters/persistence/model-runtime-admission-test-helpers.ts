import { randomUUID } from "node:crypto";
import {
  digestStructuredValue,
  type ModelRuntimeAdmissionClaimV1,
  type ModelRuntimeAdmissionStoreV1,
  type ModelRuntimeAdmissionTerminalV1,
} from "@cloudmarkup/model-gateway";
import {
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeAdmissionDecisionV1Schema,
  modelRuntimeAuditEventV1Schema,
  modelRuntimeMetricV1Schema,
  modelRuntimeStateSnapshotV1Schema,
  type ModelRuntimeStateSnapshotV1,
} from "@cloudmarkup/schemas";
import {
  admissionScopeDigest,
  runtimeWindow,
  type RuntimeAdmissionScope,
} from "./model-runtime-admission-codec.js";

const hash = (label: string) =>
  digestStructuredValue({ syntheticRuntimeTest: label });
export const runtimeTestId = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;
/** Synthetic metadata fixtures, not a reviewed evaluation or production
 * authorization. No model, credit-ledger, network, or content persistence. */
export function runtimeAdmissionFixture(
  scope: RuntimeAdmissionScope = {
    organizationId: runtimeTestId("org"),
    projectId: runtimeTestId("project"),
    userId: runtimeTestId("principal"),
  },
  now = new Date().toISOString(),
  suffix = runtimeTestId("request"),
  leaseId = runtimeTestId("concurrency"),
) {
  const estimate = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd: 100,
    maximumCreditUnits: 2,
    pricingVersionReference: "cloudmarkup.synthetic.pricing",
  };
  const requestBody = {
    ...scope,
    capabilityRegistryDigest: hash("capabilities"),
    cacheKeyAuthority: {
      dataResidencyBoundary: "cloudmarkup.synthetic.global",
      organizationSafePolicyScope: "cloudmarkup.synthetic.organization",
    },
    catalogDigest: hash("catalog"),
    commercialEstimate: {
      ...estimate,
      estimateDigest: digestStructuredValue(estimate),
    },
    contractVersion: 1,
    evaluationAuthorityTupleDigest: hash("evaluation-tuple"),
    evaluationReportDigest: hash("evaluation-report"),
    evaluationReportId: "evaluation.synthetic",
    evaluationResultSetDigest: hash("evaluation-results"),
    executionClass: "normal",
    idempotencyKeyDigest: hash(suffix),
    inputDigest: hash("input-metadata-only"),
    inputEvidenceDigest: hash("input-evidence"),
    operation: "intent.extract",
    plan: "pro",
    promptTemplateDigest: hash("template"),
    recordKind: "model-runtime-admission-request",
    requested: {
      dependencyNames: [],
      edgeCount: 0,
      fileCount: 0,
      moduleSources: [],
      nodeCount: 0,
      outputBytes: 2000,
      outputTokens: 200,
      promptBytes: 1000,
      providerSources: [],
      repairAttempts: 0,
      repositoryBytes: 0,
      repositoryFiles: 0,
    },
    responseSchemaDigest: hash("response-schema"),
    role: "standard-planning-generation",
    routeRegistryDigest: hash("routes"),
    routingDecisionDigest: hash("routing"),
    runtimePolicyDigest: hash("runtime-policy"),
  };
  const request = modelRuntimeAdmissionRequestV1Schema.parse({
    ...requestBody,
    requestDigest: digestStructuredValue(requestBody),
  });
  const expiresAt = new Date(Date.parse(now) + 240000).toISOString();
  const decisionBody = {
    accountingAuthority: "canonical-commercial-v1",
    authorization: {
      commercialReservationDecisionId: "reservation.synthetic",
      concurrencyLeaseId: leaseId,
      entitlementDecisionId: "entitlement.synthetic",
    },
    commercialEstimateDigest: request.commercialEstimate.estimateDigest,
    contractVersion: 1,
    decisionId: `admission_${suffix}`,
    decidedAt: now,
    denialReasons: [],
    evaluationAuthorityTupleDigest: request.evaluationAuthorityTupleDigest,
    evaluationReportDigest: request.evaluationReportDigest,
    evaluationReportId: request.evaluationReportId,
    evaluationResultSetDigest: request.evaluationResultSetDigest,
    executionClass: "normal",
    expiresAt,
    invokeModel: true,
    outcome: "allowed",
    recordKind: "model-runtime-admission-decision",
    requestDigest: request.requestDigest,
    routingDecisionDigest: request.routingDecisionDigest,
    runtimePolicyDigest: request.runtimePolicyDigest,
    writeAuthority: {
      compiler: false,
      deployment: false,
      github: false,
      payment: false,
      repository: false,
    },
  };
  const decision = modelRuntimeAdmissionDecisionV1Schema.parse({
    ...decisionBody,
    decisionDigest: digestStructuredValue(decisionBody),
  });
  const state = {
    ...scope,
    decidedAt: now,
    idempotencyKeyDigest: request.idempotencyKeyDigest,
    organizationWindowSeconds: 3600,
    requestDigest: request.requestDigest,
    runtimePolicyDigest: request.runtimePolicyDigest,
    tenantScopeDigest: admissionScopeDigest(request),
    userWindowSeconds: 3600,
  };
  function outbox(
    eventKind: "request" | "release" | "safety-issue" = "request",
    terminalDigest?: string,
    serial = "first",
  ) {
    const audit = modelRuntimeAuditEventV1Schema.parse({
      admissionDecisionDigest: decision.decisionDigest,
      contractVersion: 1,
      eventId: `event_${suffix}_${serial}`,
      eventKind,
      idempotencyKeyDigest: request.idempotencyKeyDigest,
      noRawPromptResponseRepositoryOrCandidateContent: true,
      occurredAt: now,
      ...scope,
      recordKind: "model-runtime-audit-event",
      referenceDigests: [
        request.requestDigest,
        decision.decisionDigest,
        ...(terminalDigest === undefined ? [] : [terminalDigest]),
      ],
      safeReasonCodes: [],
    });
    const metric = modelRuntimeMetricV1Schema.parse({
      contractVersion: 1,
      eventKind,
      metricId: `metric_${suffix}_${serial}`,
      noRawSensitiveDimensions: true,
      occurredAt: now,
      organizationScopeDigest: digestStructuredValue({
        organizationId: scope.organizationId,
      }),
      recordKind: "model-runtime-metric",
      sourceAuthority: "runtime-control-v1",
      unit: "count",
      value: 1,
    });
    return {
      audit,
      metric,
      outboxId: digestStructuredValue({ audit, metric }),
    };
  }
  function claim(
    snapshot: ModelRuntimeStateSnapshotV1,
  ): ModelRuntimeAdmissionClaimV1 {
    return {
      ...state,
      admissionRequest: request,
      admissionDecision: decision,
      acquire: true,
      claimOutbox: [outbox()],
      commercialExpiresAt: expiresAt,
      executionLeaseExpiresAt: expiresAt,
      fingerprint: hash(`fingerprint:${suffix}`),
      leaseId,
      limits: {
        maximumConcurrentOrganizationJobs: 2,
        maximumConcurrentUserJobs: 2,
        maximumOrganizationRequests: 20,
        maximumUserRequests: 20,
      },
      snapshotDigest: snapshot.snapshotDigest,
      snapshotId: snapshot.snapshotId,
    };
  }
  const terminal: ModelRuntimeAdmissionTerminalV1 = {
    admission: decision,
    output: null,
    commercial: {
      compensationStatus: "not-required",
      completedCreditUnits: 0,
      denialReason: null,
      estimate: {
        maximumCreditUnits: 2,
        minimumCreditUnits: 1,
        requiresConfirmation: false,
      },
      reconciliationState: "not-required",
      reservationAccepted: true,
      reservationId: "reservation.synthetic",
      route: "standard",
      routeExplanation: null,
      routeLabel: "Standard Design",
      state: "released",
      technicalUnits: null,
      version: 1,
    },
  };
  async function admit(store: ModelRuntimeAdmissionStoreV1) {
    const input = claim(await store.inspect(state));
    const result = await store.claim(input);
    if (result.kind !== "claimed")
      throw new Error(`Synthetic runtime claim failed: ${result.kind}`);
    return { input, result };
  }
  function emptySnapshot(): ModelRuntimeStateSnapshotV1 {
    const bounds = runtimeWindow(now, 3600);
    const body = {
      activeConcurrencyLeaseIds: [],
      capturedAt: now,
      contractVersion: 1 as const,
      idempotencyReplay: false,
      ...scope,
      policyDigest: state.runtimePolicyDigest,
      recordKind: "model-runtime-state-snapshot" as const,
      requestDigest: request.requestDigest,
      snapshotId: `runtime_snapshot_${digestStructuredValue({ capturedAt: now, requestDigest: request.requestDigest, runtimePolicyDigest: state.runtimePolicyDigest, tenantScopeDigest: state.tenantScopeDigest }).slice(7, 55)}`,
      windows: {
        organization: {
          activeConcurrentJobs: 0,
          requestCount: 0,
          windowStartedAt: bounds.startsAt,
          windowEndsAt: bounds.endsAt,
        },
        user: {
          activeConcurrentJobs: 0,
          requestCount: 0,
          windowStartedAt: bounds.startsAt,
          windowEndsAt: bounds.endsAt,
        },
      },
    };
    return modelRuntimeStateSnapshotV1Schema.parse({
      ...body,
      snapshotDigest: digestStructuredValue(body),
    });
  }
  return {
    scope,
    now,
    request,
    decision,
    state,
    claim,
    terminal,
    outbox,
    admit,
    emptySnapshot,
  };
}
