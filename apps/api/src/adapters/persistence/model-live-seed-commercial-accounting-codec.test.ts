import {
  PostgresModelCommercialAccountingEngine,
  type ModelAccountingEngineOptions,
} from "./model-commercial-accounting-engine.js";
import {
  parseSeedRuntimeRecord,
  type SeedRuntimeAdmissionRecordV3,
} from "./model-live-seed-runtime-admission-codec.js";
import { verifyModelAccountingCommonBinding } from "./model-commercial-accounting-codec.js";
import { MODEL_SEED_ACCOUNTING_WINDOW_MAPPING } from "./model-live-seed-commercial-accounting-codec.js";
import { describe, expect, it } from "vitest";
import { aggregateModelUsageUnitsV1 } from "@cloudmarkup/domain";
import { digestStructuredValue as digest } from "@cloudmarkup/model-gateway";
import { modelLiveAccountingBindingSchema } from "./model-live-commercial-accounting-codec.js";
import {
  modelSeedAccountingBindingSchema,
  verifyModelSeedAccountingRuntime,
} from "./model-live-seed-commercial-accounting-codec.js";
import { seedAccountingFixture } from "./model-live-seed-commercial-accounting-test-helpers.js";
type Fixture = Awaited<ReturnType<typeof seedAccountingFixture>>;
const verify = (f: Fixture) => {
  verifyModelSeedAccountingRuntime(
    f.workflow,
    f.runtime,
    f.binding,
    f.plan,
    f.selection,
    f.stageInput,
  );
};

describe("first-seed canonical accounting binding", () => {
  it("joins the real synthetic coordinator estimate to its exact first repair input", async () => {
    const f = await seedAccountingFixture();
    verify(f);
    expect(f.fixture.input.requestedCreditUnits).toBeGreaterThan(0);
    expect(f.runtime.liveAuthorityReservation.planned.creditUnits).toBe(
      f.fixture.input.requestedCreditUnits,
    );
  });
  it("does not treat a V3 routing binding as historical V2 accounting", async () => {
    const f = await seedAccountingFixture();
    expect(() => modelLiveAccountingBindingSchema.parse(f.binding)).toThrow();
    expect(() =>
      modelSeedAccountingBindingSchema.parse({
        ...f.binding,
        routingDecision: { ...f.binding.routingDecision, contractVersion: 1 },
      }),
    ).toThrow();
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
    "rejects coherently rehashed commercial %s substitution",
    async (key) => {
      const f = await seedAccountingFixture();
      const request = {
        ...f.workflow.request,
        [key]:
          key === "expiresAt"
            ? f.plan.expiresAt
            : key === "environment"
              ? "production"
              : "other_synthetic",
      };
      const workflow = { ...f.workflow, request, fingerprint: digest(request) };
      const binding = {
        ...f.binding,
        workflowFingerprint: workflow.fingerprint,
      };
      expect(() => {
        verify({ ...f, workflow, binding });
      }).toThrow();
    },
  );
  it.each([
    "planVersionId",
    "selectedModel",
    "primaryCall",
    "extraCall",
    "cacheInput",
    "cacheMaximum",
    "contextLimit",
    "acceptedEstimate",
    "confirmation",
    "inputUnits",
    "outputUnits",
    "runtimeFingerprint",
  ] as const)("rejects %s substitution", async (kind) => {
    const f = await seedAccountingFixture();
    const context = f.workflow.resolvedContext;
    const call = f.workflow.request.plannedCalls[0];
    if (context === null || call === undefined)
      throw Error("Missing synthetic workflow");
    const request = f.workflow.request;
    if (kind === "planVersionId")
      Object.assign(context.authorization, { planVersionId: "other_plan" });
    if (kind === "selectedModel")
      Object.assign(context.selectedRoute, { modelId: "other_model" });
    if (kind === "primaryCall") Object.assign(call, { kind: "primary" });
    if (kind === "extraCall")
      Object.assign(request, { plannedCalls: [call, call] });
    if (kind === "cacheInput")
      Object.assign(call.minimumUsage, { cacheReadUnits: 1 });
    if (kind === "cacheMaximum") {
      verify(f);
      Object.assign(call.maximumUsage, {
        cacheWriteUnits: 1,
        totalUnits: call.maximumUsage.totalUnits + 1,
      });
      expect(aggregateModelUsageUnitsV1([call.maximumUsage])).toEqual(
        call.maximumUsage,
      );
    }
    if (kind === "contextLimit")
      Object.assign(context.authorization.featureRequests, {
        maximum:
          f.plan.definition.policy.requestWindows.organization.maximumRequests +
          1,
      });
    if (kind === "acceptedEstimate")
      Object.assign(request, { estimateAccepted: false });
    if (kind === "confirmation")
      Object.assign(request, { confirmationRequired: true });
    if (kind === "inputUnits")
      Object.assign(request, {
        requestedMaximumInputUnits: request.requestedMaximumInputUnits + 1,
      });
    if (kind === "outputUnits")
      Object.assign(request, {
        requestedMaximumOutputUnits: request.requestedMaximumOutputUnits + 1,
      });
    const workflow = { ...f.workflow, fingerprint: digest(request) };
    const binding = { ...f.binding, workflowFingerprint: workflow.fingerprint };
    if (kind === "runtimeFingerprint")
      binding.runtimeFingerprint = digest("another runtime");
    if (kind === "cacheMaximum")
      verifyModelAccountingCommonBinding(workflow, f.runtime, binding);
    expect(() => {
      verify({ ...f, workflow, binding });
    }).toThrow();
  });
  it("rejects historical terminal accounting and unknown or mixed mappings before database access", async () => {
    const f = await seedAccountingFixture();
    const { routingDecision, ...binding } = f.binding;
    void routingDecision;
    const options: ModelAccountingEngineOptions<SeedRuntimeAdmissionRecordV3> =
      {
        database: {
          query: () => Promise.reject(Error("Unexpected SQL")),
          transaction: () => Promise.reject(Error("Unexpected transaction")),
          close: () => Promise.resolve(),
        },
        scope: f.fixture.scope,
        binding,
        seedBinding: f.binding,
        mapping: MODEL_SEED_ACCOUNTING_WINDOW_MAPPING,
        parseRuntime: parseSeedRuntimeRecord,
        verifyRuntime: verifyModelAccountingCommonBinding,
        authorityTransactions: {
          run: () => Promise.reject(Error("Unexpected authority transaction")),
        },
      };
    const engine = new PostgresModelCommercialAccountingEngine(options);
    await expect(
      engine.release({ event: f.fixture.input.event }),
    ).rejects.toMatchObject({ code: "access-denied" });
    expect(
      () =>
        new PostgresModelCommercialAccountingEngine(
          Object.assign({ ...options }, { mapping: "unknown" }),
        ),
    ).toThrow();
    expect(
      () =>
        new PostgresModelCommercialAccountingEngine(
          Object.assign({ ...options }, { liveBinding: f.binding }),
        ),
    ).toThrow();
  });
});
