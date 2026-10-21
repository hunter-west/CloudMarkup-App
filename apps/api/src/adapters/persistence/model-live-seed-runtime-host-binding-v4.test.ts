import { beforeAll, describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  utcTimestampSchema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
} from "@cloudmarkup/schemas";
import { parseModelLiveSeedRuntimeExecutionV4 } from "@cloudmarkup/model-gateway";
import { syntheticSeedStageInput } from "./model-live-seed-stage-test-helpers.js";
import { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
import { seedRuntimeExecutionForPreparedV4 } from "./model-live-seed-runtime-host-test-helpers.js";
import { admissionScopeDigest } from "./model-runtime-admission-codec.js";
import {
  bindPreparedSeedRuntimeV4,
  bindPreparedSeedCapacityV4,
} from "./model-live-seed-runtime-host-binding.js";

async function buildFixture() {
  const source = await syntheticSeedStageInput();
  Object.assign(source.invocation, {
    maximumOutputTokens: 1000,
    timeoutMilliseconds: 10000,
  });
  const prepared = prepareModelLiveSeedStageInputV3(source);
  const body = { ...prepared.fields, issuedAt: source.observedAt };
  const issued = modelLiveSequenceInputV3Schema.parse({
    ...body,
    inputBindingDigest: digestCanonicalValue(body),
  });
  const execution = seedRuntimeExecutionForPreparedV4(prepared, issued);
  const request = execution.admissionRequest;
  const policy = prepared.plan.definition.policy;
  const state = {
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
    decidedAt: execution.commercialRequest.requestedAt,
    idempotencyKeyDigest: request.idempotencyKeyDigest,
    liveAuthorityReservation:
      parseModelLiveSeedRuntimeExecutionV4(execution).liveAuthorityReservation,
    organizationWindowSeconds: policy.requestWindows.organization.windowSeconds,
    userWindowSeconds: policy.requestWindows.user.windowSeconds,
    requestDigest: request.requestDigest,
    runtimePolicyDigest: policy.policyDigest,
    tenantScopeDigest: admissionScopeDigest(request),
  };
  return { prepared, issued, execution, state };
}
let original: Awaited<ReturnType<typeof buildFixture>>;
beforeAll(async () => {
  original = await buildFixture();
});
const fixture = () => structuredClone(original);
function capacity(f: ReturnType<typeof fixture>) {
  return bindPreparedSeedCapacityV4(
    f.execution.admissionRequest,
    f.state,
    f.prepared,
    f.issued,
    f.execution.commercialRequest,
  );
}
describe("two-slot runtime binding to actual prepared source", () => {
  it("binds one physical payload and its aggregate two-call capacity", () => {
    const f = fixture();
    const bound = bindPreparedSeedRuntimeV4(f.execution, f.prepared, f.issued);
    expect(bound.execution.admissionRequest.requested.outputTokens).toBe(1000);
    expect(bound.identity.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const reserved = capacity(f).liveAuthorityReservation.planned;
    expect(reserved).toMatchObject({
      invocations: 2,
      inputTokens: 200,
      outputTokens: 2000,
      totalTokens: 2200,
    });
  });
  it.each([
    "requested",
    "budget",
    "entitlement",
    "configuration",
    "output",
    "timeout",
    "job",
    "idempotency",
  ] as const)("rejects substituted actual %s", (kind) => {
    const f = fixture();
    if (kind === "requested") f.prepared.requested.promptBytes += 1;
    if (kind === "budget")
      Object.assign(f.prepared.invocation.descriptor, {
        budgetDecisionId: "foreign_budget",
      });
    if (kind === "entitlement")
      Object.assign(f.prepared.invocation.descriptor, {
        entitlementDecisionId: "foreign_entitlement",
      });
    if (kind === "configuration")
      f.prepared.routingConfigurationDigest = digestCanonicalValue(
        "foreign configuration",
      );
    if (kind === "output")
      Object.assign(f.prepared.invocation, { maximumOutputTokens: 1001 });
    if (kind === "timeout")
      Object.assign(f.prepared.invocation, { timeoutMilliseconds: 10001 });
    if (kind === "job") f.prepared.scope.jobId = "foreign_job";
    if (kind === "idempotency")
      f.prepared.invocation.descriptor.idempotencyKeyDigest =
        digestCanonicalValue("foreign key");
    expect(() =>
      bindPreparedSeedRuntimeV4(f.execution, f.prepared, f.issued),
    ).toThrow();
  });
  it.each([
    "organizationId",
    "projectId",
    "userId",
    "jobId",
    "reservationId",
    "idempotencyKey",
  ] as const)("rejects foreign commercial %s during inspection", (key) => {
    const f = fixture();
    Object.assign(f.execution.commercialRequest, { [key]: "foreign_value" });
    expect(() => capacity(f)).toThrow();
  });
  it.each([
    "invocations",
    "output",
    "calls",
    "digest",
    "clock",
    "stage",
  ] as const)("rejects inconsistent %s during inspection", (kind) => {
    const f = fixture();
    const planned = f.state.liveAuthorityReservation.planned;
    if (kind === "invocations") planned.invocations = 1;
    if (kind === "output") {
      planned.outputTokens = 1000;
      planned.totalTokens = planned.inputTokens + 1000;
    }
    if (kind === "calls") f.execution.commercialRequest.plannedCalls.pop();
    if (kind === "digest") {
      const { requestDigest, ...body } = f.execution.admissionRequest;
      void requestDigest;
      const changed = {
        ...body,
        canonicalPlannedCallsDigest: digestCanonicalValue("foreign calls"),
      };
      f.execution.admissionRequest =
        modelLiveSequenceRuntimeAdmissionRequestV4Schema.parse({
          ...changed,
          requestDigest: digestCanonicalValue(changed),
        });
      f.state.requestDigest = f.execution.admissionRequest.requestDigest;
    }
    if (kind === "clock")
      f.state.decidedAt = utcTimestampSchema.parse(
        new Date(Date.parse(f.state.decidedAt) + 1).toISOString(),
      );
    if (kind === "stage") Object.assign(f.issued, { stageId: "foreign_stage" });
    expect(() => capacity(f)).toThrow();
  });
});
