import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  sha256Text,
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeAdmissionDecisionV1Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
} from "./index.js";
const hash = (name: string) => sha256Text("synthetic V3 runtime " + name);
function identify<T extends object>(value: T, key: string) {
  return {
    ...value,
    [key]: digestCanonicalValue(
      Object.fromEntries(
        Object.entries(value).filter(([name]) => name !== key),
      ),
    ),
  };
}
function request() {
  const estimate = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd: 20000,
    maximumCreditUnits: 2,
    pricingVersionReference: "pricing.synthetic",
  };
  return modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse(
    identify(
      {
        contractVersion: 3,
        recordKind: "model-live-sequence-runtime-admission-request",
        executionClass: "live-evaluation",
        organizationId: "org_synthetic",
        projectId: "project_synthetic",
        userId: "principal_synthetic",
        plan: "pro",
        operation: "candidate.repair",
        role: "repair-escalation",
        evaluationCaseId: "evaluation_case_repair_success_full_beta_v1",
        evaluationCaseDigest: hash("case"),
        evaluationAuthorityTupleDigest: hash("tuple"),
        liveEvaluationPlanDigest: hash("plan"),
        liveEvaluationAuthorityDigest: hash("approval"),
        selectionId: "live_sequence_" + "a".repeat(32),
        selectionDigest: hash("selection"),
        stageId: "live_stage_" + "b".repeat(32),
        stageKey: "repair-1",
        invocationId: "invocation_" + "c".repeat(32),
        inputBindingDigest: hash("issued V3 input"),
        preparedPayloadDigest: hash("full invocation"),
        inputDigest: hash("request plus scope"),
        idempotencyKeyDigest: hash("idempotency"),
        capabilityRegistryDigest: hash("capabilities"),
        catalogDigest: hash("catalog"),
        promptTemplateDigest: hash("prompt"),
        responseSchemaDigest: hash("response"),
        routeRegistryDigest: hash("routes"),
        routingDecisionDigest: hash("route"),
        runtimePolicyDigest: hash("policy"),
        cacheKeyAuthority: {
          dataResidencyBoundary: "residency.synthetic",
          organizationSafePolicyScope: "scope.synthetic",
        },
        commercialEstimate: {
          ...estimate,
          estimateDigest: digestCanonicalValue(estimate),
        },
        requested: {
          dependencyNames: [],
          edgeCount: 0,
          fileCount: 1,
          moduleSources: [],
          nodeCount: 0,
          outputBytes: 10000,
          outputTokens: 1000,
          promptBytes: 1000,
          providerSources: [],
          repairAttempts: 2,
          repositoryBytes: 20,
          repositoryFiles: 1,
        },
      },
      "requestDigest",
    ),
  );
}
function decision() {
  const r = request();
  return modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(
    identify(
      {
        contractVersion: 3,
        recordKind: "model-live-sequence-runtime-admission-decision",
        executionClass: "live-evaluation",
        accountingAuthority: "canonical-commercial-v1",
        authorization: {
          commercialReservationDecisionId: "reservation_synthetic",
          concurrencyLeaseId: "lease_synthetic",
          entitlementDecisionId: "entitlement_synthetic",
        },
        commercialEstimateDigest: r.commercialEstimate.estimateDigest,
        decisionId: "decision_synthetic",
        decidedAt: "2026-09-15T00:00:00.000Z",
        expiresAt: "2026-09-15T00:01:00.000Z",
        denialReasons: [],
        invokeModel: true,
        outcome: "allowed",
        evaluationAuthorityTupleDigest: r.evaluationAuthorityTupleDigest,
        evaluationCaseDigest: r.evaluationCaseDigest,
        evaluationCaseId: r.evaluationCaseId,
        liveEvaluationAuthorityDigest: r.liveEvaluationAuthorityDigest,
        liveEvaluationPlanDigest: r.liveEvaluationPlanDigest,
        selectionId: r.selectionId,
        selectionDigest: r.selectionDigest,
        stageId: r.stageId,
        stageKey: r.stageKey,
        invocationId: r.invocationId,
        inputBindingDigest: r.inputBindingDigest,
        preparedPayloadDigest: r.preparedPayloadDigest,
        requestDigest: r.requestDigest,
        routingDecisionDigest: r.routingDecisionDigest,
        runtimePolicyDigest: r.runtimePolicyDigest,
        writeAuthority: {
          compiler: false,
          deployment: false,
          github: false,
          payment: false,
          repository: false,
        },
      },
      "decisionDigest",
    ),
  );
}
describe("explicit V3 sequence runtime metadata", () => {
  it("preserves stage identity and rejects both records in historical readers", () => {
    const r = request(),
      d = decision();
    expect(modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse(r)).toEqual(
      r,
    );
    expect(modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(d)).toEqual(
      d,
    );
    expect(() => modelRuntimeAdmissionRequestV1Schema.parse(r)).toThrow();
    expect(() => modelLiveRuntimeAdmissionRequestV2Schema.parse(r)).toThrow();
    expect(() => modelRuntimeAdmissionDecisionV1Schema.parse(d)).toThrow();
    expect(() => modelLiveRuntimeAdmissionDecisionV2Schema.parse(d)).toThrow();
    expect(r).not.toHaveProperty("inputEvidenceDigest");
  });
  it.each(["preparedPayloadDigest"] as const)(
    "binds every %s into both complete record digests",
    (key) => {
      const r = request(),
        d = decision();
      const value = hash("changed");
      expect(() =>
        modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse({
          ...r,
          [key]: value,
        }),
      ).toThrow();
      expect(() =>
        modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse({
          ...d,
          [key]: value,
        }),
      ).toThrow();
    },
  );
  it.each([
    "version",
    "legacy-input",
    "source",
    "operation",
    "role",
    "case",
    "repair-limit",
  ] as const)("rejects coherently hashed %s substitutions", (kind) => {
    const r = request();
    if (kind === "version") Object.assign(r, { contractVersion: 2 });
    if (kind === "legacy-input")
      Object.assign(r, { inputEvidenceDigest: hash("legacy") });
    if (kind === "source") Object.assign(r, { content: "not metadata" });
    if (kind === "operation") Object.assign(r, { operation: "intent.extract" });
    if (kind === "role") Object.assign(r, { role: "low-cost-extraction-help" });
    if (kind === "case") Object.assign(r, { evaluationCaseId: "other_case" });
    if (kind === "repair-limit") r.requested.repairAttempts = 1;
    const parsed = modelLiveSequenceRuntimeAdmissionRequestV3Schema.safeParse(
      identify(r, "requestDigest"),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success && (kind === "legacy-input" || kind === "source")) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            path: [],
            keys: [kind === "legacy-input" ? "inputEvidenceDigest" : "content"],
          }),
        ]),
      );
    }
  });
  it.each(["authorization", "expiry", "outcome", "write"] as const)(
    "preserves shared allowed/denied %s invariants",
    (kind) => {
      const d = decision();
      if (kind === "authorization") Object.assign(d, { authorization: {} });
      if (kind === "expiry") d.expiresAt = d.decidedAt;
      if (kind === "outcome") d.invokeModel = false;
      if (kind === "write")
        Object.assign(d.writeAuthority, { deployment: true });
      expect(() =>
        modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(
          identify(d, "decisionDigest"),
        ),
      ).toThrow();
    },
  );
});
