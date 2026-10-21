import { beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue as digest } from "@cloudmarkup/model-gateway";
import { normalizedModelUsageV1Schema } from "@cloudmarkup/schemas";
import { finalRepairDispatchFixtureV4 } from "./model-live-repair-successor-dispatch-test-helpers.js";
import { prepareFinalRepairDispatchV4 } from "./model-live-repair-successor-dispatch-binding.js";
import { prepareFinalRepairUsageObservationV4 } from "./model-live-repair-successor-usage-binding.js";
import { prepareFirstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-binding.js";
async function buildFixture() {
  const f = await finalRepairDispatchFixtureV4();
  const usage = normalizedModelUsageV1Schema.parse({
    ...f.predecessorUsage,
    invocationId: f.descriptor.invocationId,
    inputDigest: f.descriptor.inputDigest,
    idempotencyKeyDigest: f.descriptor.idempotencyKeyDigest,
    usageRecordId: "synthetic_final_usage",
    providerRequestId: "synthetic_final_request",
    startedAt: f.dispatchedAt,
    completedAt: new Date(Date.parse(f.dispatchedAt) + 50).toISOString(),
    durationMilliseconds: 50,
  });
  return {
    stage: f.stage,
    descriptor: f.descriptor,
    workflow: f.workflow,
    dispatch: prepareFinalRepairDispatchV4(f),
    usage,
    observedAt: new Date(Date.parse(usage.completedAt) + 1).toISOString(),
    predecessor: {
      stage: f.execution.stageInput,
      attempt: f.predecessorAttempt,
      observation: f.predecessorObservation,
      receipt: f.predecessorReceipt,
    },
  };
}
let base: Awaited<ReturnType<typeof buildFixture>>;
beforeAll(async () => {
  base = await buildFixture();
}, 60_000);
describe("final repair known usage", () => {
  it("records physical send one as canonical repair two under the original workflow", () => {
    const result = prepareFinalRepairUsageObservationV4(base);
    expect(result.usage.attemptNumber).toBe(1);
    expect(result.attempt).toMatchObject({
      attemptNumber: 2,
      retryOfAttemptId: base.predecessor.attempt.attemptId,
      attemptId: base.stage.invocationId + ".attempt.2",
    });
    expect(result.observation).toMatchObject({
      canonicalAttemptOrdinal: 2,
      canonicalWorkflowFingerprint: base.workflow.fingerprint,
      canonicalAttemptDigest: digest(result.attempt),
      normalizedUsageDigest: digest(result.usage),
    });
    expect(() => {
      Reflect.apply(prepareFirstSeedUsageObservationV4, undefined, [base]);
    }).toThrow();
  });
  it.each([
    "scope",
    "first-usage",
    "predecessor-attempt",
    "predecessor-outcome",
    "first-ordinal",
    "unknown",
    "same-provider-request",
    "before-dispatch",
    "before-completion",
    "workflow",
  ] as const)("rejects %s substitution", (kind) => {
    const f = structuredClone(base);
    if (kind === "scope") f.usage.scope.userId = "foreign_user";
    if (kind === "first-usage")
      Object.assign(f.usage, {
        invocationId: f.predecessor.stage.invocationId,
      });
    if (kind === "predecessor-attempt")
      Object.assign(f.predecessor.attempt, { attemptId: "different_attempt" });
    if (kind === "predecessor-outcome")
      Object.assign(f.stage.predecessor, {
        outcomeDigest: digest("different outcome"),
      });
    if (kind === "first-ordinal") f.dispatch.canonicalAttemptOrdinal = 1;
    if (kind === "unknown")
      void Reflect.deleteProperty(f.usage, "providerRequestId");
    if (kind === "same-provider-request")
      f.usage.providerRequestId = String(
        f.predecessor.attempt.providerRequestId,
      );
    if (kind === "before-dispatch") f.usage.startedAt = f.stage.issuedAt;
    if (kind === "before-completion") f.observedAt = f.usage.startedAt;
    if (kind === "workflow")
      Object.assign(f.workflow, { fingerprint: digest("different workflow") });
    expect(() => prepareFinalRepairUsageObservationV4(f)).toThrow();
  });
  it("preserves actual failure usage and budget overruns for conservative accounting", () => {
    const f = structuredClone(base);
    f.usage.result = "provider-error";
    f.usage.outputUnits = "100000";
    expect(prepareFinalRepairUsageObservationV4(f).attempt).toMatchObject({
      status: "provider-failure",
      usage: { outputUnits: 100000 },
    });
  });
});
