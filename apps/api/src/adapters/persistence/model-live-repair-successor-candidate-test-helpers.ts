import { normalizeModelHostRepairSuccessorUsageV4 } from "@cloudmarkup/model-gateway";
import { finalRepairDispatchFixtureV4 } from "./model-live-repair-successor-dispatch-test-helpers.js";
import { prepareFinalRepairDispatchV4 } from "./model-live-repair-successor-dispatch-binding.js";
import { prepareFinalRepairUsageObservationV4 } from "./model-live-repair-successor-usage-binding.js";
import { seedValidationReceiptFixture } from "../../production-model-live-seed-validation-test-helpers.js";
import { seedCandidateExecutionFixture } from "../../production-model-live-seed-candidate-test-helpers.js";
import { createProductionRepairSuccessorValidationHost } from "../../production-model-live-repair-successor-host.js";
import { result } from "../../production-model-live-host-runner-test-helpers.js";
/** Synthetic retained candidate and native sessions; never live evaluation proof. */
export async function finalRepairCandidateFixtureV4(valid = true) {
  const f = await finalRepairDispatchFixtureV4();
  const seed = await seedValidationReceiptFixture();
  const candidate = seedCandidateExecutionFixture(f.invocation, {
    execute: (_n, command) =>
      !valid && command.step === "typecheck"
        ? result("Unrelated failure\n", { exitCode: 2 })
        : undefined,
  });
  candidate.providerResult.usage.providerRequestId =
    "synthetic-final-provider-request";
  const usage = normalizeModelHostRepairSuccessorUsageV4({
    descriptor: f.descriptor,
    providerUsage: candidate.providerResult.usage,
    result: "succeeded",
    startedAtMilliseconds: Date.parse(f.dispatchedAt),
    completedAtMilliseconds: Date.parse(f.dispatchedAt) + 50,
  });
  const predecessor = {
    stage: f.execution.stageInput,
    attempt: f.predecessorAttempt,
    observation: f.predecessorObservation,
    receipt: f.predecessorReceipt,
  };
  const known = prepareFinalRepairUsageObservationV4({
    stage: f.stage,
    descriptor: f.descriptor,
    workflow: f.workflow,
    dispatch: prepareFinalRepairDispatchV4(f),
    usage,
    predecessor,
    observedAt: new Date(Date.parse(usage.completedAt) + 1).toISOString(),
  });
  const host = await createProductionRepairSuccessorValidationHost({
    seed: seed.configuration,
    policy: candidate.policy,
    executor: candidate.h.executor,
    now: () => new Date("2026-09-14T12:03:00.000Z"),
  }).run({
    seedReceipt: seed.receipt,
    predecessor: f.predecessor,
    invocation: f.invocation,
    usage,
    providerResult: candidate.providerResult,
  });
  return {
    scope: f.predecessor.first.scope,
    stage: f.stage,
    usage,
    attemptObservation: known.observation,
    predecessor: {
      stage: f.execution.stageInput,
      attemptObservation: f.predecessorObservation,
      receipt: f.predecessorReceipt,
    },
    host,
    issuedAt: "2026-09-14T12:03:01.000Z",
  };
}
