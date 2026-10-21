import { beforeAll, describe, expect, it } from "vitest";
import {
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  type ModelLiveSequenceInputV3,
} from "@cloudmarkup/schemas";
import {
  normalizeModelHostSeedUsageV3,
  normalizeModelHostRepairSuccessorUsageV4,
} from "./gateway.js";
import {
  modelHostSeedUsageToCommercialAttemptV4 as project,
  modelHostRepairSuccessorUsageToCommercialAttemptV4 as projectSuccessor,
} from "./model-host-seed-commercial-usage.js";
import {
  syntheticSequenceFixtureV3,
  rehashSequenceTest,
} from "./model-live-sequence-test-helpers.js";
import { digestStructuredValue as digest } from "./security.js";
import { commercialUnits } from "./commercial-usage-units.js";

function buildFixture() {
  const sequence = syntheticSequenceFixtureV3({ runtimeRepairRoute: true });
  const firstStage = sequence.prepare(0);
  const secondStage = sequence.prepare(
    1,
    sequence.outcome(firstStage, "repairable"),
  );
  const d = digest({ syntheticUsage: true });
  const make = (stage: ModelLiveSequenceInputV3) => {
    const descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse({
      budgetDecisionId: "synthetic_usage_budget",
      complexity: "standard",
      contractVersion: 3,
      recordKind: "model-live-seed-invocation-descriptor",
      entitlementDecisionId: "synthetic_usage_entitlement",
      evaluationPolicyId: "cloudmarkup.evaluation.synthetic",
      evaluationPolicyVersion: "1.0.0",
      feature: "candidate.repair",
      idempotencyKeyDigest: digest(stage.stageId),
      inferenceProfileId: "profile.synthetic",
      inputDigest: stage.operationInputDigest,
      invocationId: stage.invocationId,
      modelId: "model.synthetic",
      modelVersion: "1",
      promptDigest: d,
      promptTemplateId: "prompt.synthetic",
      promptVersion: "1.0.0",
      providerFamily: "amazon-bedrock",
      providerId: "cloudmarkup.amazon-bedrock",
      requestedMode: "professional",
      role: "repair-escalation",
      toolAuthority: "none",
      scope: {
        organizationId: "organization_seed_usage",
        projectId: "project_seed_usage",
        userId: "user_seed_usage",
        jobId: "job_seed_usage",
      },
      routing: {
        capabilityRegistryDigest: d,
        capabilityRegistryId: "capabilities.synthetic",
        capabilityRegistryVersion: "1.0.0",
        capabilityVersion: "1.0.0",
        effort: "high",
        evaluationPolicyId: "cloudmarkup.evaluation.synthetic",
        evaluationPolicyVersion: "1.0.0",
        modelCapabilityDigest: d,
        modelConfigurationReference: "model.synthetic",
        modelFamily: "family.synthetic",
        pricingVersionReference: "pricing.synthetic",
        routeDefinitionDigest: d,
        routeId: "internal-escalation",
        routeRegistryDigest: d,
        routeRegistryId: "routes.synthetic",
        routeRegistryVersion: "1.0.0",
        routingConfigurationDigest: d,
      },
    });
    const startedAtMilliseconds = Date.parse(stage.issuedAt) + 10;
    const usage = normalizeModelHostSeedUsageV3({
      descriptor,
      result: "succeeded",
      startedAtMilliseconds,
      completedAtMilliseconds: startedAtMilliseconds + 10,
      providerUsage: {
        inputUnits: "123",
        outputUnits: "17",
        thinkingUnits: "2",
        cacheReadUnits: "0",
        cacheWriteUnits: "0",
        providerRequestId: "provider_" + stage.stageId,
      },
    });
    return { descriptor, stage, usage };
  };
  return { first: make(firstStage), second: make(secondStage) };
}
type Fixture = ReturnType<typeof buildFixture>;
let base: Fixture;
beforeAll(() => {
  base = buildFixture();
});
const fixture = () => structuredClone(base);

describe("actual seed usage to canonical repair attempts", () => {
  it("maps both physical first sends to ordered repair attempts with a real predecessor", () => {
    const f = fixture();
    const first = project({ ...f.first, predecessor: null });
    const second = project({
      ...f.second,
      predecessor: { stage: f.first.stage, attempt: first },
    });
    expect(f.first.usage.attemptNumber).toBe(1);
    expect(f.second.usage.attemptNumber).toBe(1);
    expect(first).toMatchObject({
      attemptKind: "repair",
      attemptNumber: 1,
      retryOfAttemptId: null,
    });
    expect(second).toMatchObject({
      attemptKind: "repair",
      attemptNumber: 2,
      retryOfAttemptId: first.attemptId,
    });
    expect(second.invocationId).not.toBe(first.invocationId);
    expect(second.usageRecordId).not.toBe(first.usageRecordId);
    expect(first.usage).toEqual({
      inputUnits: 123,
      outputUnits: 17,
      totalUnits: 140,
      cacheReadUnits: 0,
      cacheWriteUnits: 0,
      providerSpecificUnits: [],
    });
    expect(commercialUnits(f.first.usage).providerSpecificUnits).toEqual([
      { unitName: "thinking-units", units: 2 },
    ]);
  });
  it.each([
    ["succeeded", "succeeded"],
    ["provider-error", "provider-failure"],
    ["canceled", "cancelled"],
    ["invalid-output", "internal-failure"],
  ] as const)(
    "preserves actual %s usage without asserting delivery",
    (result, status) => {
      const f = fixture();
      Object.assign(f.first.usage, { result });
      const attempt = project({ ...f.first, predecessor: null });
      expect(attempt.status).toBe(status);
      expect(attempt.mayHaveBeenProcessed).toBe(true);
      expect(attempt.usage?.inputUnits).toBe(123);
    },
  );
  it.each([
    "scope",
    "invocationId",
    "inputDigest",
    "idempotencyKeyDigest",
    "modelId",
    "modelVersion",
    "providerId",
    "inferenceProfileId",
    "promptTemplateId",
    "promptVersion",
    "attemptNumber",
    "missing-request",
    "cache",
    "thinking",
    "overflow",
  ] as const)("rejects %s mismatch or invalid accounting units", (kind) => {
    const f = fixture();
    const usage = f.first.usage;
    if (kind === "scope")
      Object.assign(usage.scope, { organizationId: "foreign_org" });
    else if (kind === "attemptNumber")
      Object.assign(usage, { attemptNumber: 2 });
    else if (kind === "missing-request")
      Reflect.deleteProperty(usage, "providerRequestId");
    else if (kind === "cache") Object.assign(usage, { cacheReadUnits: "1" });
    else if (kind === "thinking") Object.assign(usage, { thinkingUnits: "18" });
    else if (kind === "overflow")
      Object.assign(usage, { inputUnits: "9007199254740992" });
    else
      Object.assign(usage, {
        [kind]: kind.endsWith("Digest")
          ? digest("foreign")
          : kind === "promptVersion"
            ? "2.0.0"
            : "foreign.synthetic",
      });
    expect(() => project({ ...f.first, predecessor: null })).toThrow();
  });
  it("rejects missing, foreign, reordered and unknown-usage predecessors", () => {
    const f = fixture();
    const secondRequest = f.second.usage.providerRequestId;
    if (secondRequest === undefined)
      throw Error("Missing synthetic provider request");
    const first = project({ ...f.first, predecessor: null });
    expect(() => project({ ...f.second, predecessor: null })).toThrow();
    expect(() =>
      project({
        ...f.first,
        predecessor: { stage: f.first.stage, attempt: first },
      }),
    ).toThrow();
    const foreign = rehashSequenceTest(
      { ...f.first.stage, stageId: "stage_foreign" },
      "inputBindingDigest",
    );
    expect(() =>
      project({ ...f.second, predecessor: { stage: foreign, attempt: first } }),
    ).toThrow();
    for (const patch of [
      { attemptNumber: 2 },
      { usage: null },
      { invocationId: "invocation_foreign" },
      { providerRequestId: secondRequest },
      { completedAt: f.second.usage.completedAt },
    ]) {
      expect(() =>
        project({
          ...f.second,
          predecessor: {
            stage: f.first.stage,
            attempt: { ...first, ...patch },
          },
        }),
      ).toThrow();
    }
  });
});

describe("actual final repair usage", () => {
  function finalFixture() {
    const f = fixture();
    const descriptor =
      modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse({
        ...f.second.descriptor,
        contractVersion: 4,
        recordKind: "model-live-repair-successor-invocation-descriptor",
      });
    const {
      inputUnits,
      outputUnits,
      thinkingUnits,
      cacheReadUnits,
      cacheWriteUnits,
      providerRequestId,
    } = f.second.usage;
    if (providerRequestId === undefined)
      throw Error("Synthetic final usage requires its provider request ID");
    const raw = {
      descriptor,
      result: "succeeded" as const,
      startedAtMilliseconds: Date.parse(f.second.usage.startedAt),
      completedAtMilliseconds: Date.parse(f.second.usage.completedAt),
      providerUsage: {
        inputUnits,
        outputUnits,
        thinkingUnits,
        cacheReadUnits,
        cacheWriteUnits,
        providerRequestId,
      },
    };
    const usage = normalizeModelHostRepairSuccessorUsageV4(raw);
    const first = project({ ...f.first, predecessor: null });
    return {
      f,
      raw,
      input: {
        descriptor,
        stage: f.second.stage,
        usage,
        predecessor: { stage: f.first.stage, attempt: first },
      },
    };
  }
  it("maps the actual physical send to canonical repair two without inventing historical routing", () => {
    const f = finalFixture(),
      attempt = projectSuccessor(f.input);
    expect(f.input.usage.attemptNumber).toBe(1);
    expect(f.input.usage.routing).toBeUndefined();
    expect(attempt.attemptNumber).toBe(2);
    expect(attempt.retryOfAttemptId).toBe(
      f.input.predecessor.attempt.attemptId,
    );
    expect(attempt.usage).toEqual(
      commercialUnits(f.input.usage, "included-in-output"),
    );
    expect(attempt.usageRecordId).not.toBe(
      f.input.predecessor.attempt.usageRecordId,
    );
    expect(
      () =>
        void Reflect.apply(normalizeModelHostSeedUsageV3, undefined, [f.raw]),
    ).toThrow();
    expect(() => void Reflect.apply(project, undefined, [f.input])).toThrow();
    expect(
      () =>
        void Reflect.apply(
          normalizeModelHostRepairSuccessorUsageV4,
          undefined,
          [{ ...f.raw, descriptor: f.f.second.descriptor }],
        ),
    ).toThrow();
    expect(
      () =>
        void Reflect.apply(projectSuccessor, undefined, [
          { ...f.input, descriptor: f.f.second.descriptor },
        ]),
    ).toThrow();
  });
  it.each([
    "missing",
    "request-id",
    "cache-read",
    "cache-write",
    "units",
    "time",
    "extra",
  ] as const)("rejects uncertain or invalid %s provider usage", (kind) => {
    const f = finalFixture();
    if (kind === "missing") Object.assign(f.raw, { providerUsage: undefined });
    if (kind === "request-id")
      Object.assign(f.raw.providerUsage, { providerRequestId: undefined });
    if (kind === "cache-read") f.raw.providerUsage.cacheReadUnits = "1";
    if (kind === "cache-write") f.raw.providerUsage.cacheWriteUnits = "1";
    if (kind === "units") f.raw.providerUsage.inputUnits = "-1";
    if (kind === "time")
      f.raw.completedAtMilliseconds = f.raw.startedAtMilliseconds - 1;
    if (kind === "extra") Object.assign(f.raw.providerUsage, { trusted: true });
    expect(() => normalizeModelHostRepairSuccessorUsageV4(f.raw)).toThrow();
  });
  it.each([
    "first-stage",
    "missing-predecessor",
    "prior-model",
    "same-request",
    "before-prior",
    "units-substitution",
  ] as const)("rejects %s accounting substitution", (kind) => {
    const f = finalFixture();
    if (kind === "first-stage") f.input.stage = f.f.first.stage;
    if (kind === "missing-predecessor")
      Object.assign(f.input, { predecessor: null });
    if (kind === "prior-model")
      f.input.predecessor.attempt = {
        ...f.input.predecessor.attempt,
        modelId: "model.foreign",
      };
    if (kind === "same-request")
      f.input.usage.providerRequestId =
        f.input.predecessor.attempt.providerRequestId ?? undefined;
    if (kind === "before-prior")
      Object.assign(f.input.usage, { startedAt: f.f.first.usage.startedAt });
    if (kind === "units-substitution")
      f.input.usage.inputDigest = digest("other actual input");
    expect(() => projectSuccessor(f.input)).toThrow();
  });
});
