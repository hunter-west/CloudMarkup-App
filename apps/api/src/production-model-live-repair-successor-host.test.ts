import { describe, expect, it } from "vitest";
import {
  normalizeModelHostRepairSuccessorUsageV4,
  reviewedHostBoundedRepairPromptV4,
} from "@cloudmarkup/model-gateway";
import { createHostRepairSuccessorTestInvocationV4 } from "@cloudmarkup/model-gateway/testing";
import { digestCanonicalValue as digest } from "@cloudmarkup/schemas";
import { firstSeedCandidateObservationFixture } from "./adapters/persistence/model-live-seed-candidate-test-helpers.js";
import { prepareFirstSeedCandidateOutcomeV4 } from "./adapters/persistence/model-live-seed-candidate-codec.js";
import { seedValidationReceiptFixture } from "./production-model-live-seed-validation-test-helpers.js";
import { seedCandidateExecutionFixture } from "./production-model-live-seed-candidate-test-helpers.js";
import { prepareProductionRepairSuccessorInput } from "./production-model-live-repair-successor-input.js";
import { createProductionRepairSuccessorValidationHost } from "./production-model-live-repair-successor-host.js";
import {
  result,
  type Hooks,
} from "./production-model-live-host-runner-test-helpers.js";

async function fixture(hooks: Hooks = {}) {
  const first = await firstSeedCandidateObservationFixture(
    "repairable",
    reviewedHostBoundedRepairPromptV4,
  );
  const recorded = prepareFirstSeedCandidateOutcomeV4(first);
  const predecessor = { invocation: first.invocation, first, recorded };
  const derived = prepareProductionRepairSuccessorInput(predecessor);
  const invocation = createHostRepairSuccessorTestInvocationV4(
    first.invocation,
  );
  Object.assign(invocation, { request: derived.request });
  invocation.descriptor.inputDigest = digest({
    request: derived.request,
    scope: invocation.descriptor.scope,
  });
  const f = seedCandidateExecutionFixture(invocation, hooks);
  f.providerResult.usage.providerRequestId = "synthetic-final-provider-request";
  const usage = normalizeModelHostRepairSuccessorUsageV4({
    descriptor: invocation.descriptor,
    providerUsage: f.providerResult.usage,
    result: "succeeded",
    startedAtMilliseconds: Date.parse(recorded.outcome.observedAt) + 1000,
    completedAtMilliseconds: Date.parse(recorded.outcome.observedAt) + 2000,
  });
  const seed = await seedValidationReceiptFixture();
  const clock = { at: new Date(Date.parse(usage.completedAt) + 1000) };
  const host = createProductionRepairSuccessorValidationHost({
    seed: seed.configuration,
    policy: f.policy,
    executor: f.h.executor,
    now: () => clock.at,
  });
  seed.events.splice(0);
  seed.open.mockClear();
  return {
    ...f,
    seed,
    clock,
    host,
    input: {
      seedReceipt: seed.receipt,
      predecessor,
      invocation,
      providerResult: f.providerResult,
      usage,
    },
  };
}
// Synthetic sessions/responses only. No genuine model or native proof.
// Each case restores and validates both predecessor stages before the final host.
// Allow for contention in the full backend run without changing runtime limits.
describe(
  "actual predecessor to final native candidate host",
  { timeout: 30_000 },
  () => {
    it("preserves actual first bytes, runs final validation twice and issues no receipt", async () => {
      const f = await fixture(),
        output = await f.host.run(f.input);
      expect(output.authority).toBe("ram-only-unissued-successor-validation");
      expect(output.observation.state).toBe("passed");
      expect(output.observation.contractVersion).toBe(2);
      expect(output.candidate.content).toBe(f.repaired);
      expect(output.candidate.content).toContain(
        "synthetic repair retains the witnessed defect",
      );
      expect(output.candidate.baseDigest).toBe(
        f.input.predecessor.first.host.candidate.digest,
      );
      expect(output.predecessorOutcomeDigest).toBe(
        f.input.predecessor.recorded.outcome.outcomeDigest,
      );
      expect(output.usageDigest).toBe(digest(f.input.usage));
      expect(f.h.open).toHaveBeenCalledTimes(2);
      expect(f.seed.events).toEqual(["preflight"]);
      expect(f.seed.open).not.toHaveBeenCalled();
    });
    it.each([
      "scope",
      "input",
      "usage",
      "missing-usage",
      "provider-response",
      "patch-base",
      "predecessor",
      "configuration",
      "seed-receipt",
      "old-time",
      "output-limit",
      "preflight",
      "cancel",
    ] as const)("rejects %s before final candidate execution", async (kind) => {
      const f = await fixture(),
        cancellation = new AbortController();
      if (kind === "scope")
        f.input.invocation.descriptor.scope.userId = "principal_foreign";
      if (kind === "input")
        f.input.invocation.request.failedOutputDigest = digest("another input");
      if (kind === "usage") f.input.usage.inputUnits = "999";
      if (kind === "missing-usage")
        Object.assign(f.input.providerResult, { usage: undefined });
      if (kind === "provider-response")
        f.input.providerResult.content.input.provenance.inputDigest =
          digest("other");
      if (kind === "patch-base")
        f.patch.baseDigest =
          f.input.predecessor.first.host.candidate.baseDigest;
      if (kind === "predecessor")
        f.input.predecessor.first.host.candidate = {
          ...f.input.predecessor.first.host.candidate,
          content: "foreign prior candidate",
        };
      if (kind === "configuration")
        f.input.predecessor.first.host.configurationDigest =
          digest("other config");
      if (kind === "seed-receipt")
        f.input.seedReceipt.configurationDigest = digest("other config");
      if (kind === "old-time") f.clock.at = new Date(0);
      if (kind === "output-limit")
        Object.assign(f.input.invocation, {
          maximumOutputBytes: 4 * 1024 * 1024 + 1,
        });
      if (kind === "preflight")
        f.seed.assertHostIsolation.mockRejectedValueOnce(
          Error("synthetic unavailable native host"),
        );
      if (kind === "cancel") cancellation.abort();
      await expect(f.host.run(f.input, cancellation.signal)).rejects.toThrow(
        "bound final repair",
      );
      expect(f.h.open).not.toHaveBeenCalled();
    });
    it("returns the actual failed final validation without a third repair", async () => {
      const f = await fixture({
        execute: (_, command) =>
          command.step === "typecheck"
            ? result("", { exitCode: 2 })
            : undefined,
      });
      const output = await f.host.run(f.input);
      expect(output.observation.state).toBe("failed");
      expect(output.observation.artifacts).toEqual([]);
      expect(f.h.open).toHaveBeenCalledTimes(1);
    });
    it("copies actual predecessor and response before asynchronous isolation checks", async () => {
      const f = await fixture();
      f.seed.assertHostIsolation.mockImplementationOnce(() => {
        f.patch.baseDigest = digest("later changed response");
        f.input.predecessor.first.host.candidate = {
          ...f.input.predecessor.first.host.candidate,
          content: "later changed prior candidate",
        };
        return Promise.resolve();
      });
      const output = await f.host.run(f.input);
      expect(output.observation.state).toBe("passed");
      expect(output.candidate.content).toBe(f.repaired);
    });
    it("honors cancellation after restoration", async () => {
      const f = await fixture(),
        cancellation = new AbortController();
      f.seed.assertHostIsolation.mockImplementationOnce(() => {
        cancellation.abort();
        return Promise.resolve();
      });
      await expect(f.host.run(f.input, cancellation.signal)).rejects.toThrow(
        "bound final repair",
      );
      expect(f.h.open).not.toHaveBeenCalled();
    });
  },
);
