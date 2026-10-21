import { syntheticSeedSequenceRuntimeFixtureV4 } from "./model-live-sequence-runtime-v4-test-helpers.js";
import { prepareModelLiveSeedRuntimeExecutionV4 } from "./model-live-runtime-preparation.js";
import { syntheticSeedPreparationFixture } from "./model-live-seed-runtime-preparation-test-helpers.js";
import { describe, expect, it } from "vitest";
import {
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
} from "@cloudmarkup/schemas";
import { syntheticSeedRuntimeFixtureV3 } from "./model-live-seed-runtime-test-helpers.js";
import { rehashSequenceTest as rehash } from "./model-live-sequence-test-helpers.js";
import { digestStructuredValue as digest } from "./security.js";
import {
  parseModelLiveSeedRuntimeExecutionV3,
  parseModelLiveSeedRuntimeExecutionV4 as parse,
  projectModelLiveSeedRuntimeExecutionIdentityV4 as identity,
  type ModelLiveSeedRuntimeExecutionInputV4,
} from "./model-live-seed-runtime-execution.js";

const fixture = syntheticSeedSequenceRuntimeFixtureV4;
function refresh(f: ModelLiveSeedRuntimeExecutionInputV4, bindCalls = true) {
  Object.assign(f.routingDecision, {
    requestBinding: {
      ...f.routingDecision.requestBinding,
      routingRequestDigest: digest(f.routingRequest),
    },
  });
  Object.assign(f, {
    admissionRequest: modelLiveSequenceRuntimeAdmissionRequestV4Schema.parse(
      rehash(
        {
          ...f.admissionRequest,
          routingDecisionDigest: digest(f.routingDecision),
          ...(bindCalls
            ? {
                canonicalPlannedCallsDigest: digest(
                  f.commercialRequest.plannedCalls,
                ),
              }
            : {}),
        },
        "requestDigest",
      ),
    ),
  });
  Object.assign(f, {
    admissionDecision: modelLiveSequenceRuntimeAdmissionDecisionV4Schema.parse(
      rehash(
        {
          ...f.admissionDecision,
          requestDigest: f.admissionRequest.requestDigest,
          routingDecisionDigest: f.admissionRequest.routingDecisionDigest,
          canonicalPlannedCallsDigest:
            f.admissionRequest.canonicalPlannedCallsDigest,
        },
        "decisionDigest",
      ),
    ),
  });
  return f;
}

describe("explicit two-slot V4 seed runtime metadata", () => {
  it("keeps one-send resources separate from the whole-case reservation", () => {
    const f = fixture();
    const before = structuredClone(f);
    const result = parse(f);
    expect(result.admissionRequest.requested.outputTokens).toBe(1000);
    expect(result.routingDecision.maximumAttempts).toBe(1);
    expect(result.liveAuthorityReservation.planned).toMatchObject({
      invocations: 2,
      inputTokens: 300,
      outputTokens: 2000,
      totalTokens: 2300,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(identity(f).fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(f).toEqual(before);
  });
  it("preserves the historical one-call reader and rejects mixed versions", () => {
    const legacy = syntheticSeedRuntimeFixtureV3().input;
    expect(
      parseModelLiveSeedRuntimeExecutionV3(legacy).liveAuthorityReservation
        .planned.invocations,
    ).toBe(1);
    expect(() => {
      Reflect.apply(parseModelLiveSeedRuntimeExecutionV3, undefined, [
        fixture(),
      ]);
    }).toThrow();
    expect(() => {
      Reflect.apply(parse, undefined, [legacy]);
    }).toThrow();
    expect(() => {
      Reflect.apply(parse, undefined, [
        { ...fixture(), admissionDecision: legacy.admissionDecision },
      ]);
    }).toThrow();
  });
  it.each([
    "missing-call",
    "third-call",
    "automatic-retry",
    "aggregate-output",
    "aggregate-input",
    "different-output",
    "stage-input-ceiling",
    "uncounted-first-minimum",
    "count-route",
    "optional-minimum",
    "cached",
    "call-digest",
    "decision-digest",
    "first-stage",
    "foreign-scope",
    "lease-duration",
    "no-validation-time",
  ] as const)("rejects %s even with coherent surrounding hashes", (kind) => {
    const f = fixture();
    const first = f.commercialRequest.plannedCalls[0];
    const second = f.commercialRequest.plannedCalls[1];
    if (!first || !second) throw Error("Missing synthetic call");
    switch (kind) {
      case "missing-call":
        Object.assign(f.commercialRequest, { plannedCalls: [first] });
        break;
      case "third-call":
        Object.assign(f.commercialRequest, {
          plannedCalls: [first, second, structuredClone(second)],
        });
        break;
      case "automatic-retry":
        Object.assign(second, { kind: "automatic-retry" });
        break;
      case "aggregate-output":
        Object.assign(f.commercialRequest, {
          requestedMaximumOutputUnits: 1000,
        });
        break;
      case "aggregate-input":
        Object.assign(f.commercialRequest, { requestedMaximumInputUnits: 299 });
        break;
      case "different-output":
        Object.assign(second.maximumUsage, {
          outputUnits: 999,
          totalUnits: 1199,
        });
        Object.assign(f.commercialRequest, {
          requestedMaximumOutputUnits: 1999,
        });
        break;
      case "stage-input-ceiling":
        Object.assign(second.maximumUsage, {
          inputUnits: 25001,
          totalUnits: 26001,
        });
        Object.assign(f.commercialRequest, {
          requestedMaximumInputUnits: 25101,
        });
        break;
      case "uncounted-first-minimum":
        Object.assign(first.minimumUsage, { inputUnits: 99, totalUnits: 99 });
        break;
      case "count-route":
        Object.assign(f.routingRequest, { estimatedContextTokens: 101 });
        break;
      case "optional-minimum":
        Object.assign(second.minimumUsage, { inputUnits: 1, totalUnits: 1 });
        break;
      case "cached":
        Object.assign(second.maximumUsage, {
          cacheReadUnits: 1,
          totalUnits: 1201,
        });
        break;
      case "call-digest":
        Object.assign(f.admissionRequest, {
          canonicalPlannedCallsDigest: digest("different-calls"),
        });
        break;
      case "decision-digest":
        break;
      case "first-stage":
        Object.assign(f.admissionRequest, { stageKey: "repair-2" });
        break;
      case "foreign-scope":
        Object.assign(f.admissionRequest, { organizationId: "org_other" });
        break;
      case "lease-duration": {
        const expiresAt = new Date(
          Date.parse(f.commercialRequest.requestedAt) + 300001,
        ).toISOString();
        Object.assign(f.commercialRequest, { expiresAt });
        Object.assign(f.admissionDecision, { expiresAt });
        break;
      }
      case "no-validation-time": {
        const expiresAt = new Date(
          Date.parse(f.commercialRequest.requestedAt) +
            f.routingDecision.timeoutMilliseconds * 2,
        ).toISOString();
        Object.assign(f.commercialRequest, { expiresAt });
        Object.assign(f.admissionDecision, { expiresAt });
        break;
      }
    }
    expect(() => {
      refresh(f, kind !== "call-digest");
      if (kind === "decision-digest")
        Object.assign(f, {
          admissionDecision:
            modelLiveSequenceRuntimeAdmissionDecisionV4Schema.parse(
              rehash(
                {
                  ...f.admissionDecision,
                  canonicalPlannedCallsDigest: digest("other-decision-calls"),
                },
                "decisionDigest",
              ),
            ),
        });
      parse(f);
    }).toThrow();
  });
});

describe("two-slot V4 runtime capacity preparation", () => {
  it("inspects both calls together and returns only metadata", async () => {
    const f = syntheticSeedPreparationFixture(fixture());
    const result = await prepareModelLiveSeedRuntimeExecutionV4(f.options);
    expect(result.admissionDecision).toMatchObject({
      contractVersion: 4,
      parentSequenceContractVersion: 3,
      outcome: "allowed",
      invokeModel: true,
      canonicalPlannedCallsDigest: digest(
        result.commercialRequest.plannedCalls,
      ),
    });
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(
      f.inspect.mock.calls[0]?.[0].liveAuthorityReservation?.planned,
    ).toMatchObject({
      invocations: 2,
      inputTokens: 300,
      outputTokens: 2000,
      totalTokens: 2300,
    });
    expect(result.admissionRequest.requested.outputTokens).toBe(1000);
    expect(result).not.toHaveProperty("executionLease");
  });
  it.each(["invocations", "input", "output", "credits", "cost"] as const)(
    "denies insufficient aggregate %s capacity without authorizing either send",
    async (kind) => {
      const f = syntheticSeedPreparationFixture(fixture());
      const { limits } = f.options.metadata.plan.definition;
      f.setPatch({
        liveAuthorityUsage: {
          authorityDigest: f.options.metadata.plan.approval.approvalDigest,
          activeConcurrentJobs: 0,
          reservedInvocations:
            kind === "invocations" ? limits.maximumInvocations - 1 : 0,
          reservedInputTokens:
            kind === "input" ? limits.maximumInputTokens - 299 : 0,
          reservedOutputTokens:
            kind === "output" ? limits.maximumOutputTokens - 1999 : 0,
          reservedTotalTokens:
            kind === "input"
              ? limits.maximumInputTokens - 299
              : kind === "output"
                ? limits.maximumOutputTokens - 1999
                : 0,
          reservedCacheReadTokens: 0,
          reservedCacheWriteTokens: 0,
          reservedCreditUnits:
            kind === "credits" ? limits.maximumCreditUnits : 0,
          reservedEstimatedMicroUsd:
            kind === "cost" ? limits.maximumEstimatedMicroUsd : 0,
        },
      });
      const result = await prepareModelLiveSeedRuntimeExecutionV4(f.options);
      expect(result.admissionDecision.outcome).toBe("denied");
      expect(result.admissionDecision.invokeModel).toBe(false);
      expect(result.admissionDecision.authorization).toEqual({});
      expect(result.admissionDecision.denialReasons.length).toBeGreaterThan(0);
    },
  );
  it("rejects a rehashed capacity observation for another tenant", async () => {
    const f = syntheticSeedPreparationFixture(fixture());
    f.setPatch({ organizationId: "org_other" });
    await expect(
      prepareModelLiveSeedRuntimeExecutionV4(f.options),
    ).rejects.toThrow();
  });
});
