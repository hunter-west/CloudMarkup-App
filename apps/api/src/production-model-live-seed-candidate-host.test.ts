import {
  getModelHostSeedPatchResponseToolV2,
  digestStructuredValue,
  sha256Text,
  normalizeModelHostSeedUsageV3,
  reviewedHostSeedPatchRepairPromptV3,
  type ModelProviderHostSeedInvocationV3,
} from "@cloudmarkup/model-gateway";
import { seedCandidateExecutionFixture } from "./production-model-live-seed-candidate-test-helpers.js";
import { describe, expect, it } from "vitest";
import { createHostSeedResponseFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import { modelLiveSeedInvocationDescriptorV3Schema } from "@cloudmarkup/schemas";
import { seedValidationReceiptFixture } from "./production-model-live-seed-validation-test-helpers.js";
import {
  result,
  type Hooks,
} from "./production-model-live-host-runner-test-helpers.js";
import { createProductionSeedCandidateValidationHost } from "./production-model-live-seed-candidate-host.js";

async function fixture(hooks: Hooks = {}) {
  const seed = await seedValidationReceiptFixture();
  const restored = await seed.host.prepareRepairInput(seed.receipt, "guided");
  const request = restored.request;
  const responseFixture = createHostSeedResponseFixtureV3();
  const scope = {
    ...responseFixture.input.descriptor.scope,
    organizationId: seed.receipt.scope.organizationId,
    projectId: seed.receipt.scope.projectId,
    userId: seed.receipt.scope.userId,
  };
  const descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse({
    ...responseFixture.input.descriptor,
    promptDigest: reviewedHostSeedPatchRepairPromptV3.digest,
    promptTemplateId: reviewedHostSeedPatchRepairPromptV3.templateId,
    promptVersion: reviewedHostSeedPatchRepairPromptV3.version,
    scope,
    inputDigest: digestStructuredValue({ request, scope }),
  });
  const invocation: ModelProviderHostSeedInvocationV3 = {
    descriptor,
    request,
    prompt: reviewedHostSeedPatchRepairPromptV3,
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
    responseTool: getModelHostSeedPatchResponseToolV2(),
    maximumOutputBytes: 65536,
    maximumOutputTokens: 1024,
    timeoutMilliseconds: 20000,
  };
  const { providerResult, repaired, patch, h, policy } =
    seedCandidateExecutionFixture(invocation, hooks);
  const usage = normalizeModelHostSeedUsageV3({
    descriptor,
    providerUsage: providerResult.usage,
    result: "succeeded",
    startedAtMilliseconds: Date.parse(seed.receipt.completedAt) + 1000,
    completedAtMilliseconds: Date.parse(seed.receipt.completedAt) + 2000,
  });
  const clock = { at: new Date(Date.parse(usage.completedAt) + 1000) };
  const host = createProductionSeedCandidateValidationHost({
    seed: seed.configuration,
    policy,
    executor: h.executor,
    now: () => clock.at,
  });
  seed.events.splice(0);
  seed.open.mockClear();
  return {
    seed,
    h,
    host,
    clock,
    policy,
    repaired,
    patch,
    input: { seedReceipt: seed.receipt, invocation, providerResult, usage },
  };
}
// Synthetic responses and sessions only; no provider, database issuer or native proof.
describe("production seed response-to-candidate host", () => {
  it("owns restoration, exact patching and two runner sessions without issuing durable authority", async () => {
    const f = await fixture();
    const output = await f.host.run(f.input);
    expect(output.authority).toBe("ram-only-unissued-candidate-validation");
    expect(output.observation.state).toBe("passed");
    expect(output.candidate.content).toBe(f.repaired);
    expect(output.candidate.inputDigest).toBe(
      f.input.invocation.descriptor.inputDigest,
    );
    expect(output.usageDigest).toBe(digestStructuredValue(f.input.usage));
    expect(output.seedReceiptDigest).toBe(f.seed.receipt.receiptDigest);
    expect(output.configurationDigest).toBe(f.host.configurationDigest);
    expect(f.seed.events).toEqual(["preflight"]);
    expect(f.seed.open).not.toHaveBeenCalled();
    expect(f.h.open).toHaveBeenCalledTimes(2);
  });
  it.each([
    "tenant",
    "input",
    "usage",
    "missing-usage",
    "response",
    "patch",
    "receipt",
    "time",
    "preflight",
    "cancel",
  ] as const)("rejects %s before candidate execution", async (kind) => {
    const f = await fixture(),
      signal = new AbortController();
    if (kind === "tenant")
      f.input.invocation.descriptor.scope.userId = "principal_foreign";
    if (kind === "input")
      f.input.invocation.request.failedOutputDigest =
        sha256Text("foreign source");
    if (kind === "usage") f.input.usage.inputUnits = "101";
    if (kind === "missing-usage")
      Object.assign(f.input.providerResult, { usage: undefined });
    if (kind === "response")
      f.input.providerResult.content.input.provenance.inputDigest =
        sha256Text("foreign input");
    if (kind === "patch")
      f.patch.baseDigest = sha256Text("foreign proposed bytes");
    if (kind === "receipt")
      f.seed.receipt.configurationDigest = sha256Text("foreign configuration");
    if (kind === "time") f.clock.at = new Date(0);
    if (kind === "preflight")
      f.seed.assertHostIsolation.mockRejectedValueOnce(
        Error("Synthetic denied native host"),
      );
    if (kind === "cancel") signal.abort();
    await expect(f.host.run(f.input, signal.signal)).rejects.toThrow(
      "bound seed candidate validation",
    );
    expect(f.h.open).not.toHaveBeenCalled();
  });
  it("returns actual failed validation without substituting a successful control", async () => {
    const f = await fixture({
      execute: (_, command) =>
        command.step === "typecheck" ? result("", { exitCode: 2 }) : undefined,
    });
    const output = await f.host.run(f.input);
    expect(output.observation.state).toBe("failed");
    expect(output.observation.artifacts).toEqual([]);
    expect(output.candidate.content).toBe(f.repaired);
    expect(f.h.open).toHaveBeenCalledTimes(1);
  });
  it("copies response and configuration before asynchronous host admission", async () => {
    const f = await fixture();
    f.policy.container.digest = sha256Text("later foreign config");
    f.seed.assertHostIsolation.mockImplementationOnce(() => {
      f.patch.baseDigest = sha256Text("later foreign result");
      return Promise.resolve();
    });
    const output = await f.host.run(f.input);
    expect(output.observation.state).toBe("passed");
    expect(output.candidate.content).toBe(f.repaired);
  });
  it("honors cancellation after restoration without opening a candidate workspace", async () => {
    const f = await fixture(),
      signal = new AbortController();
    f.seed.assertHostIsolation.mockImplementationOnce(() => {
      signal.abort();
      return Promise.resolve();
    });
    await expect(f.host.run(f.input, signal.signal)).rejects.toThrow();
    expect(f.h.open).not.toHaveBeenCalled();
  });
});
