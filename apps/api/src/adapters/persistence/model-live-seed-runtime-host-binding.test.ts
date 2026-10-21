import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
} from "@cloudmarkup/schemas";
import { syntheticSeedStageInput } from "./model-live-seed-stage-test-helpers.js";
import { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
import { seedRuntimeExecutionForPrepared } from "./model-live-seed-runtime-host-test-helpers.js";
import { parseModelLiveSeedRuntimeExecutionV3 } from "@cloudmarkup/model-gateway";
import { admissionScopeDigest } from "./model-runtime-admission-codec.js";
import {
  bindPreparedSeedRuntime,
  bindPreparedSeedCapacity,
} from "./model-live-seed-runtime-host-binding.js";

async function fixture() {
  const f = await syntheticSeedStageInput();
  const prepared = prepareModelLiveSeedStageInputV3(f);
  const body = { ...prepared.fields, issuedAt: f.observedAt };
  const issued = modelLiveSequenceInputV3Schema.parse({
    ...body,
    inputBindingDigest: digestCanonicalValue(body),
  });
  const execution = seedRuntimeExecutionForPrepared(prepared, issued);
  return { prepared, issued, execution };
}
describe("fresh seed runtime host binding", () => {
  it("compares actual prepared resources, scoped invocation and current route", async () => {
    const f = await fixture();
    const result = bindPreparedSeedRuntime(f.execution, f.prepared, f.issued);
    expect(result.execution.admissionRequest.requested).toEqual(
      f.prepared.requested,
    );
    expect(result.identity.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.execution.stageInput).toEqual(f.issued);
  });
  it.each([
    "cache",
    "requested",
    "job",
    "configuration",
    "timeout",
    "output",
    "idempotency",
    "model",
  ] as const)("rejects substituted actual %s", async (kind) => {
    const f = await fixture();
    const prepared = structuredClone(f.prepared);
    if (kind === "cache")
      Object.assign(prepared.invocation.promptCachePolicy, { enabled: true });
    if (kind === "requested") prepared.requested.promptBytes += 1;
    if (kind === "job") prepared.scope.jobId = "foreign_job";
    if (kind === "configuration")
      prepared.routingConfigurationDigest =
        digestCanonicalValue("other config");
    if (kind === "timeout")
      Object.assign(prepared.invocation, {
        timeoutMilliseconds: prepared.invocation.timeoutMilliseconds + 1,
      });
    if (kind === "output")
      Object.assign(prepared.invocation, {
        maximumOutputTokens: prepared.invocation.maximumOutputTokens + 1,
      });
    if (kind === "idempotency")
      prepared.invocation.descriptor.idempotencyKeyDigest =
        digestCanonicalValue("other idempotency");
    if (kind === "model")
      Object.assign(prepared.invocation.descriptor, {
        modelId: "foreign_model",
      });
    expect(() =>
      bindPreparedSeedRuntime(f.execution, prepared, f.issued),
    ).toThrow();
  });
});

function capacityState(f: Awaited<ReturnType<typeof fixture>>) {
  const request = f.execution.admissionRequest;
  const policy = f.prepared.plan.definition.policy;
  return {
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
    decidedAt: f.issued.issuedAt,
    idempotencyKeyDigest: request.idempotencyKeyDigest,
    liveAuthorityReservation: parseModelLiveSeedRuntimeExecutionV3(f.execution)
      .liveAuthorityReservation,
    organizationWindowSeconds: policy.requestWindows.organization.windowSeconds,
    userWindowSeconds: policy.requestWindows.user.windowSeconds,
    requestDigest: request.requestDigest,
    runtimePolicyDigest: policy.policyDigest,
    tenantScopeDigest: admissionScopeDigest(request),
  };
}
describe("first-seed read-only capacity binding", () => {
  it("binds an issued request without a provisional decision or execution identity", async () => {
    const f = await fixture();
    const state = capacityState(f);
    const result = bindPreparedSeedCapacity(
      f.execution.admissionRequest,
      state,
      f.prepared,
      f.issued,
    );
    expect(result.request).toEqual(f.execution.admissionRequest);
    expect(result.liveAuthorityReservation).toEqual(
      state.liveAuthorityReservation,
    );
    expect(result).not.toHaveProperty("decision");
    expect(result).not.toHaveProperty("fingerprint");
  });
  it.each(["resources", "issued-input", "capability", "price"] as const)(
    "rejects a coherently rehashed request with changed %s",
    async (kind) => {
      const f = await fixture();
      const request = structuredClone(f.execution.admissionRequest);
      const state = capacityState(f);
      if (kind === "resources") request.requested.promptBytes += 1;
      if (kind === "issued-input")
        request.inputBindingDigest = digestCanonicalValue("other input");
      if (kind === "capability")
        request.capabilityRegistryDigest =
          digestCanonicalValue("other capability");
      if (kind === "price") {
        Object.assign(request.commercialEstimate, {
          pricingVersionReference: "cloudmarkup.other.price",
        });
        const { estimateDigest, ...body } = request.commercialEstimate;
        void estimateDigest;
        request.commercialEstimate.estimateDigest = digestCanonicalValue(body);
      }
      const { requestDigest, ...body } = request;
      void requestDigest;
      request.requestDigest = digestCanonicalValue(body);
      state.requestDigest = request.requestDigest;
      expect(
        modelLiveSequenceRuntimeAdmissionRequestV3Schema.safeParse(request)
          .success,
      ).toBe(true);
      expect(() =>
        bindPreparedSeedCapacity(request, state, f.prepared, f.issued),
      ).toThrow();
    },
  );
  it.each([
    "tenant",
    "window",
    "approval",
    "limit",
    "credits",
    "time",
  ] as const)("rejects substituted %s capacity state", async (kind) => {
    const f = await fixture();
    const state = capacityState(f);
    if (kind === "tenant")
      state.tenantScopeDigest = digestCanonicalValue("other tenant");
    if (kind === "window") state.organizationWindowSeconds += 1;
    if (kind === "approval")
      state.liveAuthorityReservation.authorityDigest =
        digestCanonicalValue("other approval");
    if (kind === "limit")
      state.liveAuthorityReservation.limits.maximumEstimatedMicroUsd += 1;
    if (kind === "credits")
      state.liveAuthorityReservation.planned.creditUnits += 1;
    if (kind === "time") state.decidedAt = f.prepared.plan.expiresAt;
    expect(() =>
      bindPreparedSeedCapacity(
        f.execution.admissionRequest,
        state,
        f.prepared,
        f.issued,
      ),
    ).toThrow();
  });
});
