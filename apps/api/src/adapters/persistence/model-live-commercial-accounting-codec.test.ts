import { describe, expect, it } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import {
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelRuntimeStateSnapshotV1Schema,
  modelRoutingDecisionV1Schema,
} from "@cloudmarkup/schemas";
import {
  modelLiveAccountingBindingSchema,
  verifyModelLiveAccountingRuntime,
} from "./model-live-commercial-accounting-codec.js";
import { verifyModelAccountingRuntime } from "./model-commercial-accounting-codec.js";
import {
  modelLiveAccountingFixture,
  rehashLiveAccountingTestMetadata as rehash,
} from "./model-live-commercial-accounting-test-helpers.js";

describe("exact evaluation canonical accounting join", () => {
  it("joins actual synthetic coordinator reservations to a versioned frozen case", async () => {
    const f = await modelLiveAccountingFixture();
    expect(() => {
      verifyModelLiveAccountingRuntime(
        f.workflow,
        f.runtime,
        f.binding,
        f.plan,
      );
    }).not.toThrow();
    expect(f.fixture.input.requestedCreditUnits).toBeGreaterThan(0);
    expect(f.runtime.liveAuthorityReservation.planned.creditUnits).toBe(
      f.fixture.input.requestedCreditUnits,
    );
    expect(() => {
      verifyModelAccountingRuntime(f.workflow, f.runtime as never, f.binding);
    }).toThrow();
  });
  it("rejects a different billing-plan version despite identical runtime and routing digests", async () => {
    const f = await modelLiveAccountingFixture();
    const context = f.workflow.resolvedContext;
    if (context === null) throw Error("Missing synthetic commercial context.");
    const workflow = {
      ...f.workflow,
      resolvedContext: {
        ...context,
        authorization: {
          ...context.authorization,
          planVersionId: "plan_other_v1",
        },
      },
    };
    expect(() => {
      verifyModelLiveAccountingRuntime(workflow, f.runtime, f.binding, f.plan);
    }).toThrow();
  });
  it.each([
    "organizationId",
    "projectId",
    "userId",
    "environment",
    "promptId",
    "promptVersion",
    "reservationId",
    "expiresAt",
  ] as const)(
    "rejects a coherently rehashed commercial %s substitution",
    async (key) => {
      const f = await modelLiveAccountingFixture();
      const request = {
        ...f.workflow.request,
        [key]:
          key === "expiresAt"
            ? f.plan.expiresAt
            : key === "environment"
              ? "production"
              : "other_synthetic",
      };
      const workflow = {
        ...f.workflow,
        request,
        fingerprint: digestStructuredValue(request),
      };
      const binding = {
        ...f.binding,
        workflowFingerprint: workflow.fingerprint,
      };
      expect(() => {
        verifyModelLiveAccountingRuntime(workflow, f.runtime, binding, f.plan);
      }).toThrow();
    },
  );
  it.each([
    "maximumCreditUnits",
    "maximumEstimatedProviderCostMicros",
    "primaryPricingVersionId",
  ] as const)(
    "rejects changed coordinator %s even when the workflow ID is unchanged",
    async (field) => {
      const f = await modelLiveAccountingFixture();
      const context = f.workflow.resolvedContext;
      if (context === null) throw Error("Missing synthetic estimate.");
      const estimateResult =
        field === "maximumCreditUnits"
          ? {
              ...context.estimateResult,
              estimate: {
                ...context.estimateResult.estimate,
                maximumCreditUnits: 99,
              },
            }
          : {
              ...context.estimateResult,
              [field]:
                field === "primaryPricingVersionId" ? "pricing.other" : 99999,
            };
      const workflow = {
        ...f.workflow,
        resolvedContext: { ...context, estimateResult },
      };
      expect(() => {
        verifyModelLiveAccountingRuntime(
          workflow,
          f.runtime,
          f.binding,
          f.plan,
        );
      }).toThrow();
    },
  );
  it.each([
    "extra-call",
    "retry",
    "extra-input",
    "extra-cache",
    "extra-provider-unit",
    "weaker-limit",
  ] as const)("denies planned capacity changes: %s", async (kind) => {
    const f = await modelLiveAccountingFixture();
    const first = f.workflow.request.plannedCalls[0];
    const context = f.workflow.resolvedContext;
    if (first === undefined || context === null)
      throw Error("Missing synthetic call.");
    const request = { ...structuredClone(f.workflow.request) };
    const call = structuredClone(first);
    if (kind === "extra-call") request.plannedCalls = [call, call];
    else if (kind === "retry")
      request.plannedCalls = [{ ...call, kind: "automatic-retry" }];
    else if (kind === "extra-input")
      request.plannedCalls = [
        {
          ...call,
          maximumUsage: {
            ...call.maximumUsage,
            inputUnits: 201,
            totalUnits: 241,
          },
        },
      ];
    else if (kind === "extra-cache")
      request.plannedCalls = [
        {
          ...call,
          maximumUsage: {
            ...call.maximumUsage,
            cacheReadUnits: 1,
            totalUnits: 241,
          },
        },
      ];
    else if (kind === "extra-provider-unit")
      request.plannedCalls = [
        {
          ...call,
          maximumUsage: {
            ...call.maximumUsage,
            providerSpecificUnits: [{ unitName: "synthetic.extra", units: 1 }],
          },
        },
      ];
    const workflow = {
      ...f.workflow,
      request,
      fingerprint: digestStructuredValue(request),
      resolvedContext:
        kind === "weaker-limit"
          ? {
              ...context,
              authorization: {
                ...context.authorization,
                perUserRequests: { current: 0, maximum: 99999 },
              },
            }
          : context,
    };
    const binding = { ...f.binding, workflowFingerprint: workflow.fingerprint };
    expect(() => {
      verifyModelLiveAccountingRuntime(workflow, f.runtime, binding, f.plan);
    }).toThrow();
  });
  it("rejects a substituted concrete model even after all routing and runtime hashes are recomputed", async () => {
    const f = await modelLiveAccountingFixture();
    const routingDecision = modelRoutingDecisionV1Schema.parse({
      ...f.binding.routingDecision,
      modelId: "cloudmarkup.synthetic.unapproved",
    });
    const request = modelLiveRuntimeAdmissionRequestV2Schema.parse(
      rehash(
        {
          ...f.runtime.request,
          routingDecisionDigest: digestStructuredValue(routingDecision),
        },
        "requestDigest",
      ),
    );
    const decision = modelLiveRuntimeAdmissionDecisionV2Schema.parse(
      rehash(
        {
          ...f.runtime.decision,
          requestDigest: request.requestDigest,
          routingDecisionDigest: request.routingDecisionDigest,
        },
        "decisionDigest",
      ),
    );
    const originalSnapshot = modelRuntimeStateSnapshotV1Schema.parse(
      rehash(
        {
          ...f.runtime.originalSnapshot,
          requestDigest: request.requestDigest,
        },
        "snapshotDigest",
      ),
    );
    const runtime = {
      ...f.runtime,
      request,
      decision,
      originalSnapshot,
      fingerprint: digestStructuredValue({ synthetic: true, request }),
    };
    const binding = {
      ...f.binding,
      routingDecision,
      runtimeFingerprint: runtime.fingerprint,
    };
    expect(() => {
      verifyModelLiveAccountingRuntime(f.workflow, runtime, binding, f.plan);
    }).toThrow();
  });
  it.each([
    "workflowId",
    "workflowFingerprint",
    "runtimeScopeDigest",
    "runtimeFingerprint",
  ] as const)("rejects substituted persisted binding %s", async (key) => {
    const f = await modelLiveAccountingFixture();
    const binding = {
      ...f.binding,
      [key]:
        key === "workflowId"
          ? "workflow_other"
          : digestStructuredValue("other binding"),
    };
    expect(() => {
      verifyModelLiveAccountingRuntime(f.workflow, f.runtime, binding, f.plan);
    }).toThrow();
  });
  it("rejects added prompt bodies and leaves caller metadata untouched", async () => {
    const { source, ...f } = await modelLiveAccountingFixture();
    void source;
    const before = structuredClone(f);
    expect(
      modelLiveAccountingBindingSchema.safeParse({
        ...f.binding,
        promptText: "Unaccepted synthetic text",
      }).success,
    ).toBe(false);
    verifyModelLiveAccountingRuntime(f.workflow, f.runtime, f.binding, f.plan);
    expect(f).toEqual(before);
  });
});
