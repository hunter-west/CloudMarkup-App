import { beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue as digest } from "@cloudmarkup/model-gateway";
import { prepareFirstSeedDispatchV4 } from "./model-live-seed-dispatch-binding.js";
import { seedDispatchBindingFixtureV4 } from "./model-live-seed-dispatch-test-helpers.js";
let base: Awaited<ReturnType<typeof seedDispatchBindingFixtureV4>>;
beforeAll(async () => {
  base = await seedDispatchBindingFixtureV4();
});
const fixture = () => structuredClone(base);

describe("first seed dispatch joins actual canonical and platform metadata", () => {
  it("binds a real synthetic coordinator intent without a future completed attempt", () => {
    const f = fixture();
    const record = prepareFirstSeedDispatchV4(f);
    expect(record).toMatchObject({
      contractVersion: 4,
      canonicalAttemptOrdinal: 1,
      invocationId: f.descriptor.invocationId,
      platformReservationDigest: digest(f.platformReceipt),
      canonicalWorkflowFingerprint: f.workflow.fingerprint,
      canonicalDispatchIntentDigest: digest(f.workflow.dispatchIntent),
      canonicalPlannedCallDigest: digest(f.workflow.request.plannedCalls[0]),
    });
    expect(Object.hasOwn(record, "canonicalAttemptDigest")).toBe(false);
  });
  it.each([
    "scope",
    "invocation",
    "payload",
    "model",
    "price",
    "cost",
    "uncounted",
    "expired-count",
  ] as const)("rejects a coherently rehashed %s platform claim", (kind) => {
    const f = fixture();
    if (kind === "scope") f.platformClaim.scope.organizationId = "foreign_org";
    if (kind === "invocation")
      Object.assign(f.platformClaim, { invocationId: "foreign_invocation" });
    if (kind === "payload")
      f.platformClaim.ceiling.invocationDigest = digest("other payload");
    if (kind === "model")
      Object.assign(f.platformClaim.ceiling, { modelId: "model.foreign" });
    if (kind === "price")
      Object.assign(f.platformClaim.ceiling, {
        pricingVersionId: "price.foreign",
      });
    if (kind === "cost")
      f.platformClaim.ceiling.maximumCostMicroUsd =
        f.execution.admissionRequest.commercialEstimate.estimatedMicroUsd + 1;
    if (kind === "uncounted")
      Reflect.deleteProperty(f.platformClaim.ceiling, "dispatchValidUntil");
    if (kind === "expired-count")
      f.platformClaim.ceiling.dispatchValidUntil = f.platformReceipt.reservedAt;
    f.platformReceipt.claimDigest = digest(f.platformClaim);
    expect(() => prepareFirstSeedDispatchV4(f)).toThrow();
  });
  it.each([
    "claim-digest",
    "dispatch-id",
    "receipt-expired",
    "receipt-future",
    "receipt-length",
    "workflow",
    "unreserved",
    "no-intent",
  ] as const)("rejects %s without inventing dispatch authority", (kind) => {
    const f = fixture();
    if (kind === "claim-digest")
      f.platformReceipt.claimDigest = digest("foreign receipt");
    if (kind === "dispatch-id")
      f.platformReceipt.dispatchId = "dispatch_" + "b".repeat(32);
    if (kind === "receipt-expired")
      f.dispatchedAt = f.platformReceipt.dispatchBefore;
    if (kind === "receipt-future")
      f.dispatchedAt = f.workflow.request.requestedAt;
    if (kind === "receipt-length")
      Object.assign(f.platformReceipt, {
        dispatchBefore: new Date(
          Date.parse(f.platformReceipt.reservedAt) + 6000,
        ).toISOString(),
      });
    if (kind === "workflow")
      Object.assign(f.workflow, { fingerprint: digest("foreign workflow") });
    if (kind === "unreserved")
      Object.assign(f.workflow, { reservationReceipt: null });
    if (kind === "no-intent")
      Object.assign(f.workflow, { dispatchIntent: null });
    expect(() => prepareFirstSeedDispatchV4(f)).toThrow();
  });
});
