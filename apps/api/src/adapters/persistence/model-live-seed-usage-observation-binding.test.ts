import { beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue as digest } from "@cloudmarkup/model-gateway";
import { normalizedModelUsageV1Schema } from "@cloudmarkup/schemas";
import { seedDispatchBindingFixtureV4 } from "./model-live-seed-dispatch-test-helpers.js";
import { prepareFirstSeedDispatchV4 } from "./model-live-seed-dispatch-binding.js";
import { prepareFirstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-binding.js";

async function fixture() {
  const f = await seedDispatchBindingFixtureV4();
  const descriptor = f.descriptor;
  const startedAt = new Date(Date.parse(f.dispatchedAt) - 10).toISOString();
  const completedAt = new Date(Date.parse(f.dispatchedAt) + 50).toISOString();
  const usage = normalizedModelUsageV1Schema.parse({
    contractVersion: 1,
    attemptNumber: 1,
    inputUnits: "10",
    outputUnits: "20",
    cacheReadUnits: "0",
    cacheWriteUnits: "0",
    thinkingUnits: "5",
    completedAt,
    startedAt,
    durationMilliseconds: 60,
    feature: descriptor.feature,
    inputDigest: descriptor.inputDigest,
    idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
    invocationId: descriptor.invocationId,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    providerId: descriptor.providerId,
    inferenceProfileId: descriptor.inferenceProfileId,
    promptTemplateId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    scope: descriptor.scope,
    providerRequestId: "synthetic-known-provider-request",
    usageRecordId: "synthetic_usage_" + descriptor.invocationId,
    result: "succeeded",
  });
  return {
    stage: f.execution.stageInput,
    dispatch: prepareFirstSeedDispatchV4(f),
    descriptor,
    workflow: f.workflow,
    usage,
    observedAt: new Date(Date.parse(completedAt) + 10).toISOString(),
  };
}
let base: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  base = await fixture();
});
describe("known first-stage usage observation binding", () => {
  it("records actual usage and canonical repair ordinal without final settlement", () => {
    const f = structuredClone(base);
    const result = prepareFirstSeedUsageObservationV4(f);
    expect(result.observation).toMatchObject({
      canonicalAttemptOrdinal: 1,
      normalizedUsageDigest: digest(f.usage),
      canonicalAttemptDigest: digest(result.attempt),
    });
    expect(result.attempt).toMatchObject({
      attemptNumber: 1,
      attemptKind: "repair",
      usage: {
        inputUnits: 10,
        outputUnits: 20,
        totalUnits: 30,
        providerSpecificUnits: [],
      },
    });
    expect(result.observation).not.toHaveProperty("commercialTerminalDigest");
  });
  it.each([
    "scope",
    "input",
    "descriptor",
    "workflow",
    "intent",
    "call",
    "stage",
    "unknown",
    "unobserved",
  ] as const)("rejects %s substitution", (kind) => {
    const f = structuredClone(base);
    if (kind === "scope") f.usage.scope.userId = "foreign_user";
    if (kind === "input") f.usage.inputDigest = digest("foreign-input");
    if (kind === "descriptor")
      Object.assign(f.descriptor, { modelVersion: "foreign-model" });
    if (kind === "workflow")
      Object.assign(f.workflow, { fingerprint: digest("foreign-workflow") });
    if (kind === "intent") Object.assign(f.workflow, { dispatchIntent: null });
    if (kind === "call")
      Object.assign(f.workflow.request, { plannedCalls: [] });
    if (kind === "stage") Object.assign(f.stage, { stageId: "other-stage" });
    if (kind === "unknown")
      Reflect.deleteProperty(f.usage, "providerRequestId");
    if (kind === "unobserved")
      f.observedAt = new Date(
        Date.parse(f.dispatch.dispatchedAt) - 1,
      ).toISOString();
    expect(() => prepareFirstSeedUsageObservationV4(f)).toThrow();
  });
  it("preserves known failure usage and actual overrun for later financial handling", () => {
    const f = structuredClone(base);
    f.usage.result = "provider-error";
    f.usage.outputUnits = "100000";
    const result = prepareFirstSeedUsageObservationV4(f);
    expect(result.attempt).toMatchObject({
      status: "provider-failure",
      usage: { inputUnits: 10, outputUnits: 100000, totalUnits: 100010 },
    });
  });
});
