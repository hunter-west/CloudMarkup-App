import { beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue as digest } from "@cloudmarkup/model-gateway";
import { seedSequenceAccountingFixtureV4 } from "./model-live-seed-commercial-accounting-test-helpers.js";
import {
  verifyModelSeedAccountingRuntime,
  verifyModelSeedSequenceAccountingRuntimeV4,
} from "./model-live-seed-commercial-accounting-codec.js";
import { verifyModelAccountingCommonBinding } from "./model-commercial-accounting-codec.js";

async function dataFixture() {
  const { fixture, execution, identity, ...data } =
    await seedSequenceAccountingFixtureV4();
  void execution;
  void identity;
  return { ...data, reservationCredits: fixture.input.requestedCreditUnits };
}
type Fixture = Awaited<ReturnType<typeof dataFixture>>;
let original: Fixture;
beforeAll(async () => {
  original = await dataFixture();
});
const fixture = () => structuredClone(original);
function verify(f: Fixture) {
  verifyModelSeedSequenceAccountingRuntimeV4(
    f.workflow,
    f.runtime,
    f.binding,
    f.plan,
    f.selection,
    f.stageInput,
  );
}
function rehash<T extends object>(value: T, key: string) {
  return {
    ...value,
    [key]: digest(
      Object.fromEntries(
        Object.entries(value).filter(([name]) => name !== key),
      ),
    ),
  };
}
/** Synthetic metadata substitutions deliberately preserve their digest joins so
 * the actual call/scope checks, rather than an incidental stale hash, reject them. */
function rebind(
  f: Fixture,
  callDigest = digest(f.workflow.request.plannedCalls),
) {
  Object.assign(f.workflow, { fingerprint: digest(f.workflow.request) });
  Object.assign(f.binding, { workflowFingerprint: f.workflow.fingerprint });
  Object.assign(
    f.runtime.request,
    rehash(
      { ...f.runtime.request, canonicalPlannedCallsDigest: callDigest },
      "requestDigest",
    ),
  );
  Object.assign(
    f.runtime.decision,
    rehash(
      {
        ...f.runtime.decision,
        canonicalPlannedCallsDigest: callDigest,
        requestDigest: f.runtime.request.requestDigest,
      },
      "decisionDigest",
    ),
  );
  Object.assign(
    f.runtime.originalSnapshot,
    rehash(
      {
        ...f.runtime.originalSnapshot,
        requestDigest: f.runtime.request.requestDigest,
      },
      "snapshotDigest",
    ),
  );
}
describe("canonical two-slot repair accounting binding", () => {
  it("joins the real synthetic coordinator estimate and separate physical limit", () => {
    const f = fixture();
    verify(f);
    verifyModelAccountingCommonBinding(f.workflow, f.runtime, f.binding);
    expect(f.workflow.request.plannedCalls).toHaveLength(2);
    expect(f.runtime.request.requested.outputTokens).toBe(1000);
    expect(f.workflow.request.requestedMaximumOutputUnits).toBe(2000);
    expect(f.runtime.liveAuthorityReservation.planned.creditUnits).toBe(
      f.reservationCredits,
    );
    expect(f.reservationCredits).toBeGreaterThan(0);
  });
  it("keeps the historical reader closed to successor records", () => {
    const f = fixture();
    expect(() => {
      Reflect.apply(verifyModelSeedAccountingRuntime, undefined, [
        f.workflow,
        f.runtime,
        f.binding,
        f.plan,
        f.selection,
        f.stageInput,
      ]);
    }).toThrow();
  });
  it.each([
    "organizationId",
    "projectId",
    "userId",
    "reservationId",
    "idempotencyKey",
  ] as const)("rejects a coherently rehashed foreign %s", (key) => {
    const f = fixture();
    Object.assign(f.workflow.request, { [key]: "foreign_scope" });
    rebind(f);
    expect(() => {
      verify(f);
    }).toThrow();
  });
  it.each([
    "missing-call",
    "third-call",
    "kind",
    "second-route",
    "first-minimum",
    "optional-minimum",
    "split-output",
    "calls-digest",
    "single-capacity",
    "canonical-cost",
  ] as const)("rejects %s", (kind) => {
    const f = fixture();
    const [first, second] = f.workflow.request.plannedCalls;
    if (!first || !second) throw Error("Missing synthetic planned calls");
    if (kind === "missing-call")
      Object.assign(f.workflow.request, { plannedCalls: [first] });
    if (kind === "third-call")
      Object.assign(f.workflow.request, {
        plannedCalls: [first, second, second],
      });
    if (kind === "kind") Object.assign(second, { kind: "automatic-retry" });
    if (kind === "second-route")
      Object.assign(second, { routeId: "other_route" });
    if (kind === "first-minimum")
      Object.assign(first.minimumUsage, { inputUnits: 0, totalUnits: 0 });
    if (kind === "optional-minimum")
      Object.assign(second.minimumUsage, { inputUnits: 1, totalUnits: 1 });
    if (kind === "split-output") {
      Object.assign(first.maximumUsage, {
        outputUnits: 1500,
        totalUnits: first.maximumUsage.inputUnits + 1500,
      });
      Object.assign(second.maximumUsage, {
        outputUnits: 500,
        totalUnits: second.maximumUsage.inputUnits + 500,
      });
    }
    if (kind === "single-capacity")
      Object.assign(f.runtime.liveAuthorityReservation.planned, {
        invocations: 1,
      });
    if (kind === "canonical-cost") {
      const context = f.workflow.resolvedContext;
      if (!context) throw Error("Missing synthetic canonical context");
      Object.assign(context.estimateResult, {
        maximumEstimatedProviderCostMicros:
          context.estimateResult.maximumEstimatedProviderCostMicros + 1,
      });
    }
    rebind(f, kind === "calls-digest" ? digest("foreign calls") : undefined);
    expect(() => {
      verify(f);
    }).toThrow();
  });
});
