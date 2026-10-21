import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelLiveSeedRoutingDecisionV3Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
} from "@cloudmarkup/schemas";
import { rehashSequenceTest as rehash } from "./model-live-sequence-test-helpers.js";
import {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingRequest,
  modelTestRoutingDecision,
} from "./test-helpers.js";
import { sha256Text } from "./security.js";
import {
  parseModelLiveSeedRuntimeExecutionV3 as parse,
  projectModelLiveSeedRuntimeExecutionIdentityV3 as identity,
  type ModelLiveSeedRuntimeExecutionInputV3,
} from "./model-live-seed-runtime-execution.js";
import { syntheticSeedRuntimeFixtureV3 } from "./model-live-seed-runtime-test-helpers.js";

function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("Missing synthetic runtime fixture value");
  return value;
}
const hash = (value: string) => sha256Text("synthetic stage binding " + value);
/** Synthetic comparison records only; no provider, validation, tenant,
 * pricing, reservation or approval fact is issued by this fixture. */
const fixture = syntheticSeedRuntimeFixtureV3;

function changeRequest(
  input: ModelLiveSeedRuntimeExecutionInputV3,
  changes: object,
) {
  const request = modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse(
    rehash({ ...input.admissionRequest, ...changes }, "requestDigest"),
  );
  const keys = [
    "evaluationCaseId",
    "evaluationCaseDigest",
    "evaluationAuthorityTupleDigest",
    "liveEvaluationPlanDigest",
    "liveEvaluationAuthorityDigest",
    "selectionId",
    "selectionDigest",
    "stageId",
    "stageKey",
    "invocationId",
    "inputBindingDigest",
    "preparedPayloadDigest",
  ] as const;
  return {
    ...input,
    admissionRequest: request,
    admissionDecision: modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(
      rehash(
        {
          ...input.admissionDecision,
          ...Object.fromEntries(keys.map((key) => [key, request[key]])),
          requestDigest: request.requestDigest,
          routingDecisionDigest: request.routingDecisionDigest,
          commercialEstimateDigest: request.commercialEstimate.estimateDigest,
          runtimePolicyDigest: request.runtimePolicyDigest,
        },
        "decisionDigest",
      ),
    ),
  };
}

describe("first fixed-seed V3 runtime metadata", () => {
  it("binds exact issued lineage and one repair to the original aggregate capacity", () => {
    const { input } = fixture(),
      parsed = parse(input);
    expect(parsed.liveAuthorityReservation).toEqual({
      authorityDigest: input.plan.approval.approvalDigest,
      limits: input.plan.definition.limits,
      planned: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        invocations: 1,
        inputTokens: 100,
        outputTokens: 1000,
        totalTokens: 1100,
        creditUnits: 1,
        estimatedMicroUsd: 1000,
      },
    });
    expect(parsed.admissionRequest.requested.repairAttempts).toBe(2);
    expect(
      modelLiveRuntimeAdmissionRequestV2Schema.safeParse(
        parsed.admissionRequest,
      ).success,
    ).toBe(false);
    expect(
      modelLiveRuntimeAdmissionDecisionV2Schema.safeParse(
        parsed.admissionDecision,
      ).success,
    ).toBe(false);
    expect("inputEvidence" in parsed).toBe(false);
  });
  it.each([
    ["selectionDigest", hash("other selection")],
    ["inputBindingDigest", hash("other input")],
    ["preparedPayloadDigest", hash("other full SDK payload")],
    ["liveEvaluationPlanDigest", hash("other plan")],
    ["liveEvaluationAuthorityDigest", hash("other approval")],
    ["evaluationAuthorityTupleDigest", hash("other authority")],
    ["catalogDigest", hash("other catalog")],
    ["promptTemplateDigest", hash("other prompt")],
    ["responseSchemaDigest", hash("other schema")],
    ["organizationId", "org_other_synthetic"],
    ["projectId", "project_other_synthetic"],
    ["userId", "principal_other_synthetic"],
    ["inputDigest", hash("other scoped operation")],
    ["invocationId", "invocation_" + "f".repeat(32)],
    ["stageId", "live_stage_" + "f".repeat(32)],
  ])("rejects coherently rehashed %s substitutions", (key, value) => {
    const { input } = fixture();
    expect(() => parse(changeRequest(input, { [key]: value }))).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
  });
  it("rejects a real second-stage record until genuine predecessor integration exists", () => {
    const { f, input } = fixture(),
      prior = f.outcome(input.stageInput, "repairable");
    const stageInput = f.prepare(1, prior);
    const changed = changeRequest(
      { ...input, stageInput },
      {
        stageId: stageInput.stageId,
        stageKey: stageInput.stageKey,
        invocationId: stageInput.invocationId,
        inputBindingDigest: stageInput.inputBindingDigest,
        preparedPayloadDigest: stageInput.preparedPayloadDigest,
        inputDigest: stageInput.operationInputDigest,
      },
    );
    expect(() => parse(changed)).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
  });
  it.each(["primary", "system-escalation"] as const)(
    "rejects aliasing the physical repair as %s",
    (kind) => {
      const { input } = fixture();
      expect(() =>
        parse({
          ...input,
          commercialRequest: {
            ...input.commercialRequest,
            plannedCalls: input.commercialRequest.plannedCalls.map((call) => ({
              ...call,
              kind,
            })),
          },
        }),
      ).toThrow(
        expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
      );
    },
  );
  it.each([
    ["estimateAccepted", false],
    ["confirmationRequired", true],
    ["reservationId", "synthetic_other_reservation"],
    ["requestedRoute", "standard"],
    ["requestedMaximumOutputUnits", 999],
    ["requestedMaximumInputUnits", 99],
    ["promptVersion", "9.0.0"],
  ])("rejects contradictory commercial %s", (key, value) => {
    const { input } = fixture();
    expect(() =>
      parse({
        ...input,
        commercialRequest: { ...input.commercialRequest, [key]: value },
      }),
    ).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
  });
  it("rejects additional planned sends and uncounted cache units", () => {
    const { input } = fixture(),
      call = present(input.commercialRequest.plannedCalls[0]);
    for (const plannedCalls of [
      [call, call],
      [
        {
          ...call,
          maximumUsage: {
            ...call.maximumUsage,
            cacheReadUnits: 1,
            totalUnits: 1101,
          },
        },
      ],
    ])
      expect(() =>
        parse({
          ...input,
          commercialRequest: { ...input.commercialRequest, plannedCalls },
        }),
      ).toThrow(
        expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
      );
  });
  it("rejects enabled caching even with coherently rebound routing hashes", () => {
    const { input } = fixture();
    Reflect.set(input.routingDecision, "promptCachePolicy", {
      enabled: true,
      cacheKeyRequired: true,
      maximumCheckpoints: 1,
      minimumCheckpointTokens: 100,
    });
    expect(() =>
      parse(
        changeRequest(input, {
          routingDecisionDigest: digestCanonicalValue(input.routingDecision),
        }),
      ),
    ).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
  });
  it("rejects denied entitlement after coherently rebinding routing", () => {
    const { input } = fixture();
    const routingDecision = {
      ...input.routingDecision,
      entitlement: { ...input.routingDecision.entitlement, allowed: false },
    };
    expect(() =>
      parse(
        changeRequest(
          { ...input, routingDecision },
          { routingDecisionDigest: digestCanonicalValue(routingDecision) },
        ),
      ),
    ).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
  });
  it("rejects a coherent cross-tenant route and commercial request against the original plan", () => {
    const { input } = fixture(),
      organizationId = "org_other_synthetic";
    const routingRequest = modelRoutingRequestV1Schema.parse({
      ...input.routingRequest,
      organizationId,
    });
    const routingDecision = {
      ...input.routingDecision,
      requestBinding: {
        ...input.routingDecision.requestBinding,
        routingRequestDigest: digestCanonicalValue(routingRequest),
      },
    };
    expect(() =>
      parse(
        changeRequest(
          {
            ...input,
            routingRequest,
            routingDecision,
            commercialRequest: { ...input.commercialRequest, organizationId },
          },
          {
            organizationId,
            routingDecisionDigest: digestCanonicalValue(routingDecision),
          },
        ),
      ),
    ).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
  });
  it("rejects pre-input admission and admission or expiry beyond the approved window", () => {
    const { input } = fixture();
    for (const times of [
      { decidedAt: input.plan.issuedAt },
      {
        decidedAt: input.plan.expiresAt,
        expiresAt: new Date(
          Date.parse(input.plan.expiresAt) + 1000,
        ).toISOString(),
      },
      {
        expiresAt: new Date(
          Date.parse(input.plan.expiresAt) + 1000,
        ).toISOString(),
      },
    ]) {
      const admissionDecision =
        modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(
          rehash({ ...input.admissionDecision, ...times }, "decisionDigest"),
        );
      expect(() =>
        parse({
          ...input,
          admissionDecision,
          commercialRequest: {
            ...input.commercialRequest,
            requestedAt: admissionDecision.decidedAt,
            expiresAt: present(admissionDecision.expiresAt),
          },
        }),
      ).toThrow(
        expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
      );
    }
  });
  it("rejects raw source and legacy input evidence on the exact V3 boundary", () => {
    const { input } = fixture();
    expect(() =>
      parse({
        ...input,
        source: "synthetic candidate",
      } as ModelLiveSeedRuntimeExecutionInputV3),
    ).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
    expect(() =>
      parse({
        ...input,
        inputEvidence: {},
      } as ModelLiveSeedRuntimeExecutionInputV3),
    ).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
  });
  it("returns detached metadata and preserves identity across a valid clock refresh", () => {
    const { input } = fixture(),
      first = identity(input),
      parsed = parse(input);
    const decidedAt = new Date(
      Date.parse(input.admissionDecision.decidedAt) + 1000,
    ).toISOString();
    const updated = {
      ...input,
      admissionDecision:
        modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(
          rehash({ ...input.admissionDecision, decidedAt }, "decisionDigest"),
        ),
      commercialRequest: { ...input.commercialRequest, requestedAt: decidedAt },
    };
    expect(identity(updated)).toEqual(first);
    Reflect.set(
      present(input.commercialRequest.plannedCalls[0]).maximumUsage,
      "inputUnits",
      90,
    );
    expect(
      parsed.commercialRequest.plannedCalls[0]?.maximumUsage.inputUnits,
    ).toBe(100);
  });
  it("rejects a coherently rebound route naming another seed input", () => {
    const { input } = fixture();
    const routingDecision = {
      ...input.routingDecision,
      seedInputBindingDigest: hash("other seed"),
    };
    expect(() =>
      parse(
        changeRequest(
          { ...input, routingDecision },
          {
            routingDecisionDigest: digestCanonicalValue(routingDecision),
          },
        ),
      ),
    ).toThrow(
      expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
    );
  });

  it.each([{ outcome: "denied" as const }, { userConfirmationRequired: true }])(
    "rejects an allowed admission with an unresolved route %#",
    (change) => {
      const { input } = fixture();
      const routingDecision = { ...input.routingDecision, ...change };
      expect(() =>
        parse(
          changeRequest(
            { ...input, routingDecision },
            {
              routingDecisionDigest: digestCanonicalValue(routingDecision),
            },
          ),
        ),
      ).toThrow(
        expect.objectContaining({ safeCode: "routing-authority-mismatch" }),
      );
    },
  );
  it("keeps seed routing and prior-invocation V1 routing distinct", () => {
    const { input } = fixture();
    expect(
      modelRoutingDecisionV1Schema.safeParse(input.routingDecision).success,
    ).toBe(false);
    const request = modelTestRoutingRequest(
      present(modelTestRequests()[0]),
      modelTestContext("synthetic_v1_routing_compatibility"),
    );
    const route = modelTestRoutingDecision(request);
    expect(modelRoutingDecisionV1Schema.safeParse(route).success).toBe(true);
    expect(
      modelRoutingDecisionV1Schema.safeParse({
        ...route,
        routeId: "internal-escalation",
        maximumAttempts: 1,
        automaticEscalationPermitted: false,
      }).success,
    ).toBe(false);
  });
  it.each([
    { maximumAttempts: 2 },
    { automaticEscalationPermitted: true },
    { contractVersion: 1 },
    { seedInputBindingDigest: "bad" },
    { routeId: "standard-design" },
    { escalation: {} },
    { evaluationResultDigest: hash("legacy result") },
    { source: "synthetic candidate" },
    { reasonCodes: ["standard-default", "standard-default"] },
    { effort: "xhigh" },
  ])("rejects malformed or incompatible seed routing %#", (changes) => {
    const { input } = fixture();
    expect(
      modelLiveSeedRoutingDecisionV3Schema.safeParse({
        ...input.routingDecision,
        ...changes,
      }).success,
    ).toBe(false);
  });
});
