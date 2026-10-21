import { describe, expect, it } from "vitest";
import { digestCanonicalValue, sha256Text } from "./canonical-digest.js";
import {
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeAdmissionDecisionV1Schema,
  modelRuntimeControlPolicyV1Schema,
} from "./model-evaluation-v1.js";
import {
  digestModelLiveRuntimeAdmissionRequestV2,
  digestModelLiveRuntimeAdmissionDecisionV2,
  modelLiveRuntimeAdmissionDecisionV2Schema,
  type ModelLiveRuntimeAdmissionDecisionV2,
  digestModelLiveRuntimeControlPolicyV2,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeControlPolicyV2Schema,
  type ModelLiveRuntimeAdmissionRequestV2,
  type ModelLiveRuntimeControlPolicyV2,
} from "./model-live-evaluation-v2.js";

const digest = sha256Text;
function rehash(
  value: Record<string, unknown>,
  key: "policyDigest" | "requestDigest" | "decisionDigest",
) {
  const data = Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  );
  return { ...data, [key]: digestCanonicalValue(data) };
}
function policy(): ModelLiveRuntimeControlPolicyV2 {
  return modelLiveRuntimeControlPolicyV2Schema.parse(
    rehash(
      {
        administrativeSuspensions: [],
        allowlists: {
          dependencies: ["zod"],
          modelConfigurationReferences: [
            "cloudmarkup.model.synthetic-evaluation",
          ],
          modules: ["registry.example/approved/module"],
          providers: ["registry.example/approved/provider"],
          roles: ["low-cost-extraction-help"],
          routes: ["standard-design"],
        },
        cacheKeyAuthority: {
          dataResidencyBoundary: "cloudmarkup.residency.test",
          organizationSafePolicyScope: "cloudmarkup.cache.synthetic",
        },
        canonicalCommercialAuthority: "canonical-commercial-v1",
        contractVersion: 2,
        evaluationRequirement: {
          datasetId: "cloudmarkup.dataset.synthetic",
          datasetVersion: "2.0.0",
          datasetDigest: digest("synthetic dataset"),
          datasetCaseDigests: [digest("case A"), digest("case B")],
          evaluationPolicyDigest: digest("synthetic evaluator"),
          evaluationPolicyId: "cloudmarkup.evaluation.synthetic",
          evaluationPolicyVersion: "2.0.0",
          minimumDeterministicQualityBasisPoints: 9000,
        },
        featureEntitlements: [{ features: ["intent.extract"], plan: "pro" }],
        killSwitches: { capabilitySwitches: [], global: { engaged: false } },
        limits: {
          maximumEdges: 1000,
          maximumFiles: 100,
          maximumNodes: 500,
          maximumOutputBytes: 1000000,
          maximumOutputTokens: 10000,
          maximumPromptBytes: 100000,
          maximumRepairAttempts: 2,
          maximumRepositoryBytes: 10000000,
          maximumRepositoryFiles: 1000,
        },
        liveEvaluation: {
          enabledByDefault: false,
          excludedFromNormalCi: true,
          killSwitchEngagedByDefault: true,
          permittedEnvironments: ["development", "staging"],
        },
        policyId: "cloudmarkup.live-runtime.synthetic",
        policyVersion: "2.0.0",
        recordKind: "model-live-runtime-control-policy",
        requestWindows: {
          organization: {
            maximumConcurrentJobs: 10,
            maximumRequests: 100,
            windowSeconds: 3600,
          },
          user: {
            maximumConcurrentJobs: 2,
            maximumRequests: 20,
            windowSeconds: 3600,
          },
        },
        safety: {
          arbitraryPackageAuthority: false,
          arbitraryShellAuthority: false,
          arbitraryToolAuthority: false,
          arbitraryUrlAuthority: false,
          credentialAuthority: false,
          deploymentAuthority: false,
          rawSensitiveLogsPermitted: false,
          repositoryWriteAuthority: false,
          resultSanitizationRequired: true,
          secretRedactionRequired: true,
          structuredOutputsRequired: true,
          tenantSafeCacheAndPromptKeysRequired: true,
        },
      },
      "policyDigest",
    ),
  );
}
function request(): ModelLiveRuntimeAdmissionRequestV2 {
  const estimate = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd: 100000,
    maximumCreditUnits: 10,
    pricingVersionReference: "cloudmarkup.pricing.synthetic",
  };
  return modelLiveRuntimeAdmissionRequestV2Schema.parse(
    rehash(
      {
        capabilityRegistryDigest: digest("capabilities"),
        cacheKeyAuthority: policy().cacheKeyAuthority,
        catalogDigest: digest("catalog"),
        commercialEstimate: {
          ...estimate,
          estimateDigest: digestCanonicalValue(estimate),
        },
        contractVersion: 2,
        evaluationAuthorityTupleDigest: digest("tuple"),
        evaluationCaseDigest: digest("case A"),
        evaluationCaseId: "case_A",
        executionClass: "live-evaluation",
        idempotencyKeyDigest: digest("idempotency"),
        inputDigest: digest("input"),
        inputEvidenceDigest: digest("input evidence"),
        liveEvaluationAuthorityDigest: digest("operator authority"),
        liveEvaluationPlanDigest: digest("issued plan"),
        operation: "intent.extract",
        organizationId: "org_synthetic",
        plan: "pro",
        projectId: "project_synthetic",
        promptTemplateDigest: digest("prompt"),
        recordKind: "model-live-runtime-admission-request",
        requested: {
          dependencyNames: [],
          edgeCount: 0,
          fileCount: 0,
          moduleSources: [],
          nodeCount: 0,
          outputBytes: 10000,
          outputTokens: 1000,
          promptBytes: 100,
          providerSources: [],
          repairAttempts: 0,
          repositoryBytes: 0,
          repositoryFiles: 0,
        },
        responseSchemaDigest: digest("response schema"),
        role: "low-cost-extraction-help",
        routeRegistryDigest: digest("routes"),
        routingDecisionDigest: digest("route decision"),
        runtimePolicyDigest: policy().policyDigest,
        userId: "principal_synthetic",
      },
      "requestDigest",
    ),
  );
}

function decision(): ModelLiveRuntimeAdmissionDecisionV2 {
  const admission = request();
  const metadata = {
    accountingAuthority: "canonical-commercial-v1",
    authorization: {
      commercialReservationDecisionId: "commercial_synthetic",
      concurrencyLeaseId: "lease_synthetic",
      entitlementDecisionId: "entitlement_synthetic",
    },
    commercialEstimateDigest: admission.commercialEstimate.estimateDigest,
    contractVersion: 2,
    decisionId: "decision_live_synthetic",
    decidedAt: "2026-09-09T12:00:00.000Z",
    denialReasons: [],
    evaluationAuthorityTupleDigest: admission.evaluationAuthorityTupleDigest,
    evaluationCaseDigest: admission.evaluationCaseDigest,
    evaluationCaseId: admission.evaluationCaseId,
    executionClass: "live-evaluation",
    expiresAt: "2026-09-09T12:01:00.000Z",
    invokeModel: true,
    liveEvaluationAuthorityDigest: admission.liveEvaluationAuthorityDigest,
    liveEvaluationPlanDigest: admission.liveEvaluationPlanDigest,
    outcome: "allowed",
    recordKind: "model-live-runtime-admission-decision",
    requestDigest: admission.requestDigest,
    routingDecisionDigest: admission.routingDecisionDigest,
    runtimePolicyDigest: admission.runtimePolicyDigest,
    writeAuthority: {
      compiler: false,
      deployment: false,
      github: false,
      payment: false,
      repository: false,
    },
  };
  return modelLiveRuntimeAdmissionDecisionV2Schema.parse({
    ...metadata,
    decisionDigest: digestCanonicalValue(metadata),
  });
}

describe("report-free live evaluation V2 metadata", () => {
  it("constructs policy and request without any final report or activation result", () => {
    const controls = policy(),
      admission = request();
    expect(controls).not.toHaveProperty("evaluationGate");
    expect(admission).not.toHaveProperty("evaluationReportDigest");
    expect(admission).not.toHaveProperty("evaluationReportId");
    expect(admission).not.toHaveProperty("evaluationResultSetDigest");
    expect(controls.liveEvaluation.enabledByDefault).toBe(false);
    expect(modelRuntimeControlPolicyV1Schema.safeParse(controls).success).toBe(
      false,
    );
    expect(
      modelRuntimeAdmissionRequestV1Schema.safeParse(admission).success,
    ).toBe(false);
  });
  it("exports canonical digest helpers without changing metadata", () => {
    const controls = policy(),
      admission = request();
    const controlMetadata = { ...controls },
      requestMetadata = { ...admission };
    delete (controlMetadata as Partial<ModelLiveRuntimeControlPolicyV2>)
      .policyDigest;
    delete (requestMetadata as Partial<ModelLiveRuntimeAdmissionRequestV2>)
      .requestDigest;
    expect(digestModelLiveRuntimeControlPolicyV2(controlMetadata)).toBe(
      controls.policyDigest,
    );
    expect(digestModelLiveRuntimeAdmissionRequestV2(requestMetadata)).toBe(
      admission.requestDigest,
    );
  });
  it.each(["normal", "deterministic-evaluation"])(
    "rejects execution class %s even with a matching digest",
    (executionClass) => {
      expect(
        modelLiveRuntimeAdmissionRequestV2Schema.safeParse(
          rehash({ ...request(), executionClass }, "requestDigest"),
        ).success,
      ).toBe(false);
    },
  );
  it.each(["evaluationReportId", "prompt", "candidate", "approved"])(
    "rejects undeclared request data %s",
    (key) => {
      const result = modelLiveRuntimeAdmissionRequestV2Schema.safeParse(
        rehash({ ...request(), [key]: "untrusted" }, "requestDigest"),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "unrecognized_keys",
              keys: [key],
              path: [],
            }),
          ]),
        );
      }
    },
  );
  it.each(["evaluationGate", "capabilityActivated"])(
    "rejects report/activation field %s in the policy",
    (key) => {
      const result = modelLiveRuntimeControlPolicyV2Schema.safeParse(
        rehash({ ...policy(), [key]: "untrusted" }, "policyDigest"),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "unrecognized_keys",
              keys: [key],
              path: [],
            }),
          ]),
        );
      }
    },
  );
  it.each([
    "evaluationCaseId",
    "evaluationCaseDigest",
    "liveEvaluationAuthorityDigest",
    "liveEvaluationPlanDigest",
    "inputEvidenceDigest",
  ])("requires the binding %s", (key) => {
    const original: Record<string, unknown> = { ...request() };
    const value = Object.fromEntries(
      Object.entries(original).filter(([name]) => name !== key),
    );
    expect(
      modelLiveRuntimeAdmissionRequestV2Schema.safeParse(
        rehash(value, "requestDigest"),
      ).success,
    ).toBe(false);
  });
  it.each([
    "organizationId",
    "projectId",
    "userId",
    "evaluationCaseId",
    "liveEvaluationPlanDigest",
    "runtimePolicyDigest",
  ])(
    "detects substituted %s before any issuer can consider the request",
    (key) => {
      expect(
        modelLiveRuntimeAdmissionRequestV2Schema.safeParse({
          ...request(),
          [key]: key.endsWith("Digest")
            ? digest("substitution")
            : "substitution",
        }).success,
      ).toBe(false);
    },
  );
  it("binds case order and rejects duplicate case digests", () => {
    const original = policy();
    const cases = original.evaluationRequirement.datasetCaseDigests;
    expect(
      modelLiveRuntimeControlPolicyV2Schema.safeParse({
        ...original,
        evaluationRequirement: {
          ...original.evaluationRequirement,
          datasetCaseDigests: [...cases].reverse(),
        },
      }).success,
    ).toBe(false);
    expect(
      modelLiveRuntimeControlPolicyV2Schema.safeParse(
        rehash(
          {
            ...original,
            evaluationRequirement: {
              ...original.evaluationRequirement,
              datasetCaseDigests: [digest("case A"), digest("case A")],
            },
          },
          "policyDigest",
        ),
      ).success,
    ).toBe(false);
  });
  it.each(["providers"] as const)(
    "preserves duplicate allowlist rejection for %s",
    (key) => {
      const original = policy(),
        values = original.allowlists[key];
      expect(
        modelLiveRuntimeControlPolicyV2Schema.safeParse(
          rehash(
            {
              ...original,
              allowlists: {
                ...original.allowlists,
                [key]: [...values, ...values],
              },
            },
            "policyDigest",
          ),
        ).success,
      ).toBe(false);
    },
  );
  it("preserves duplicate suspension, entitlement and switch rejection", () => {
    const original = policy();
    const suspension = {
      scope: "organization",
      scopeId: "org_synthetic",
      reasonCode: "cloudmarkup.test.suspension",
    };
    const capability = { operation: "intent.extract", engaged: false };
    for (const changed of [
      { ...original, administrativeSuspensions: [suspension, suspension] },
      {
        ...original,
        featureEntitlements: [
          ...original.featureEntitlements,
          ...original.featureEntitlements,
        ],
      },
      {
        ...original,
        featureEntitlements: [
          { features: ["intent.extract", "intent.extract"], plan: "pro" },
        ],
      },
      {
        ...original,
        killSwitches: {
          ...original.killSwitches,
          capabilitySwitches: [capability, capability],
        },
      },
    ])
      expect(
        modelLiveRuntimeControlPolicyV2Schema.safeParse(
          rehash(changed, "policyDigest"),
        ).success,
      ).toBe(false);
  });
  it("requires the exact reason-code presence for both switch levels", () => {
    const original = policy();
    for (const changed of [
      {
        ...original,
        killSwitches: { ...original.killSwitches, global: { engaged: true } },
      },
      {
        ...original,
        killSwitches: {
          ...original.killSwitches,
          global: { engaged: false, reasonCode: "cloudmarkup.test.stop" },
        },
      },
      {
        ...original,
        killSwitches: {
          ...original.killSwitches,
          capabilitySwitches: [{ operation: "intent.extract", engaged: true }],
        },
      },
      {
        ...original,
        killSwitches: {
          ...original.killSwitches,
          capabilitySwitches: [
            {
              operation: "intent.extract",
              engaged: false,
              reasonCode: "cloudmarkup.test.stop",
            },
          ],
        },
      },
    ])
      expect(
        modelLiveRuntimeControlPolicyV2Schema.safeParse(
          rehash(changed, "policyDigest"),
        ).success,
      ).toBe(false);
  });
  it.each([
    "arbitraryPackageAuthority",
    "arbitraryShellAuthority",
    "arbitraryToolAuthority",
    "arbitraryUrlAuthority",
    "credentialAuthority",
    "deploymentAuthority",
    "rawSensitiveLogsPermitted",
    "repositoryWriteAuthority",
  ])("preserves the safety denial for %s", (key) => {
    const original = policy();
    expect(
      modelLiveRuntimeControlPolicyV2Schema.safeParse(
        rehash(
          {
            ...original,
            safety: { ...original.safety, [key]: true },
          },
          "policyDigest",
        ),
      ).success,
    ).toBe(false);
  });
  it("preserves size limits and canonical-estimate digest validation", () => {
    const original = request();
    expect(
      modelLiveRuntimeAdmissionRequestV2Schema.safeParse(
        rehash(
          {
            ...original,
            requested: { ...original.requested, repairAttempts: 3 },
          },
          "requestDigest",
        ),
      ).success,
    ).toBe(false);
    expect(
      modelLiveRuntimeAdmissionRequestV2Schema.safeParse(
        rehash(
          {
            ...original,
            commercialEstimate: {
              ...original.commercialEstimate,
              maximumCreditUnits: 1,
            },
          },
          "requestDigest",
        ),
      ).success,
    ).toBe(false);
  });
});

describe("report-free live admission decision V2 metadata", () => {
  it("requires a distinct version while retaining all V1 safe-outcome invariants", () => {
    const result = decision();
    expect(result).not.toHaveProperty("evaluationReportDigest");
    expect(
      modelRuntimeAdmissionDecisionV1Schema.safeParse(result).success,
    ).toBe(false);
    const { decisionDigest, ...metadata } = result;
    expect(digestModelLiveRuntimeAdmissionDecisionV2(metadata)).toBe(
      decisionDigest,
    );
  });
  it.each(["normal", "deterministic-evaluation"])(
    "rejects the %s execution class",
    (executionClass) => {
      expect(
        modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
          rehash({ ...decision(), executionClass }, "decisionDigest"),
        ).success,
      ).toBe(false);
    },
  );
  it.each([
    "commercialReservationDecisionId",
    "concurrencyLeaseId",
    "entitlementDecisionId",
  ])("rejects an allowed decision missing %s", (key) => {
    const result = decision();
    const authorization = Object.fromEntries(
      Object.entries(result.authorization).filter(([name]) => name !== key),
    );
    expect(
      modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
        rehash({ ...result, authorization }, "decisionDigest"),
      ).success,
    ).toBe(false);
  });
  it("admits only a closed safe denial shape without invocation authority", () => {
    const source = decision();
    const metadata = Object.fromEntries(
      Object.entries(source).filter(([key]) => key !== "expiresAt"),
    );
    const denied = rehash(
      {
        ...metadata,
        outcome: "denied",
        invokeModel: false,
        authorization: {},
        denialReasons: ["runtime-control-unavailable"],
        safeError: {
          code: "runtime-control-unavailable",
          messageKey: "cloudmarkup.live.unavailable",
          noRawSensitiveValues: true,
        },
      },
      "decisionDigest",
    );
    expect(
      modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(denied).success,
    ).toBe(true);
    expect(
      modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
        rehash({ ...denied, invokeModel: true }, "decisionDigest"),
      ).success,
    ).toBe(false);
    expect(
      modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
        rehash({ ...denied, denialReasons: [] }, "decisionDigest"),
      ).success,
    ).toBe(false);
    expect(
      modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
        rehash(
          {
            ...denied,
            denialReasons: [
              "runtime-control-unavailable",
              "runtime-control-unavailable",
            ],
          },
          "decisionDigest",
        ),
      ).success,
    ).toBe(false);
  });
  it.each(["compiler", "deployment", "github", "payment", "repository"])(
    "cannot grant %s write authority",
    (key) => {
      const result = decision();
      expect(
        modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
          rehash(
            {
              ...result,
              writeAuthority: { ...result.writeAuthority, [key]: true },
            },
            "decisionDigest",
          ),
        ).success,
      ).toBe(false);
    },
  );
  it.each(["evaluationReportId", "prompt", "candidate"])(
    "rejects added %s metadata",
    (key) => {
      const result = modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
        rehash({ ...decision(), [key]: "untrusted" }, "decisionDigest"),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "unrecognized_keys",
              keys: [key],
              path: [],
            }),
          ]),
        );
      }
    },
  );
  it("rejects an expired allowed decision even after recalculating its digest", () => {
    const result = decision();
    expect(
      modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
        rehash({ ...result, expiresAt: result.decidedAt }, "decisionDigest"),
      ).success,
    ).toBe(false);
  });
});
