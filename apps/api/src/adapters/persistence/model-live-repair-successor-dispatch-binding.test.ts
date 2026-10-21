import { beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue as digest } from "@cloudmarkup/model-gateway";
import { prepareFirstSeedDispatchV4 } from "./model-live-seed-dispatch-binding.js";
import { prepareFinalRepairDispatchV4 } from "./model-live-repair-successor-dispatch-binding.js";
import { finalRepairDispatchFixtureV4 } from "./model-live-repair-successor-dispatch-test-helpers.js";
let base: Awaited<ReturnType<typeof finalRepairDispatchFixtureV4>>;
beforeAll(async () => {
  base = await finalRepairDispatchFixtureV4();
}, 60_000);
const fixture = () => structuredClone(base);

describe("final repair dispatch under the original reservation", () => {
  it("binds ordinal two to the issued actual predecessor and reserved second call", () => {
    const f = fixture(),
      record = prepareFinalRepairDispatchV4(f);
    expect(record.canonicalAttemptOrdinal).toBe(2);
    expect(record.canonicalWorkflowFingerprint).toBe(f.workflow.fingerprint);
    expect(record.canonicalPlannedCallDigest).toBe(
      digest(f.workflow.request.plannedCalls[1]),
    );
    expect(record.runtimeRequestDigest).toBe(
      f.execution.admissionRequest.requestDigest,
    );
    expect(record.inputBindingDigest).toBe(f.stage.inputBindingDigest);
    expect(record.invocationId).not.toBe(f.execution.stageInput.invocationId);
    expect(() => {
      Reflect.apply(prepareFirstSeedDispatchV4, undefined, [f]);
    }).toThrow();
  });
  it.each([
    "predecessor",
    "predecessor-workflow",
    "receipt",
    "first-stage",
    "selected-stage",
    "selection",
    "time",
    "scope",
    "budget",
    "payload",
    "count-expired",
    "future-count",
  ] as const)("rejects %s substitution before issuing metadata", (kind) => {
    const f = fixture();
    if (kind === "predecessor" && f.stage.predecessor.kind === "stage")
      f.stage.predecessor.outcomeDigest = digest("other");
    if (kind === "predecessor-workflow") {
      const { observationDigest: prior, ...body } = f.predecessorObservation;
      expect(prior).toMatch(/^sha256:/u);
      body.canonicalWorkflowFingerprint = digest("foreign workflow");
      f.predecessorObservation = { ...body, observationDigest: digest(body) };
    }
    if (kind === "receipt")
      f.predecessorReceipt.inputBindingDigest = digest("another first input");
    if (kind === "first-stage") f.stage = f.execution.stageInput;
    if (kind === "selected-stage")
      Object.assign(f.stage, { stageId: "live_stage_" + "f".repeat(32) });
    if (kind === "selection")
      f.stage.selectionDigest = digest("another selection");
    if (kind === "time") f.dispatchedAt = f.predecessorReceipt.completedAt;
    if (kind === "scope")
      f.platformClaim.scope.organizationId = "foreign_organization";
    if (kind === "budget")
      Object.assign(f.descriptor, { budgetDecisionId: "foreign_budget" });
    if (kind === "payload")
      f.platformClaim.ceiling.invocationDigest = digest(
        "another actual payload",
      );
    if (kind === "count-expired")
      f.platformClaim.ceiling.dispatchValidUntil = f.platformReceipt.reservedAt;
    if (kind === "future-count")
      Object.assign(f.platformClaim.ceiling, {
        validFrom: f.platformReceipt.dispatchBefore,
      });
    f.platformReceipt.claimDigest = digest(f.platformClaim);
    const { inputBindingDigest: old, ...fields } = f.stage;
    expect(old).toMatch(/^sha256:/u);
    f.stage = { ...fields, inputBindingDigest: digest(fields) };
    expect(() => prepareFinalRepairDispatchV4(f)).toThrow();
  });
});
