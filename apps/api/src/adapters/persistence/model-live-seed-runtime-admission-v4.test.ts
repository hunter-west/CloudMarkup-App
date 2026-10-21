import { describe, expect, it } from "vitest";
import {
  digestStructuredValue as digest,
  ModelRuntimeControlError,
} from "@cloudmarkup/model-gateway";
import { modelLiveSequenceRuntimeAdmissionDecisionV4Schema } from "@cloudmarkup/schemas";
import { admissionJson } from "./model-runtime-admission-codec.js";
import {
  parseSeedRuntimeClaim,
  parseSeedRuntimeRecord,
  parseSeedRuntimeClaimV4,
  parseSeedRuntimeRecordV4,
  parseSeedRuntimeTerminalV4,
} from "./model-live-seed-runtime-admission-codec.js";
import { seedRuntimeAdmissionFixture } from "./model-live-seed-runtime-admission-test-helpers.js";
import { seedSequenceRuntimeAdmissionFixtureV4 } from "./model-live-seed-runtime-admission-v4-test-helpers.js";

describe("strict two-slot V4 persisted runtime metadata", () => {
  it("roundtrips separate per-send and aggregate bounds without retaining caller references", () => {
    const f = seedSequenceRuntimeAdmissionFixtureV4();
    const claim = f.claim(),
      record = f.record();
    const parsed = parseSeedRuntimeClaimV4(claim, f.scope);
    expect(parsed).toEqual(claim);
    expect(parsed.admissionRequest.requested.outputTokens).toBe(1000);
    expect(parsed.liveAuthorityReservation.planned).toMatchObject({
      invocations: 2,
      outputTokens: 2000,
    });
    expect(parsed.admissionRequest).not.toBe(claim.admissionRequest);
    expect(parsed.liveAuthorityReservation).not.toBe(
      claim.liveAuthorityReservation,
    );
    expect(parseSeedRuntimeRecordV4(admissionJson(record), f.scope)).toEqual(
      record,
    );
    expect(
      parseSeedRuntimeTerminalV4(f.terminal, f.request, f.decision),
    ).toEqual(f.terminal);
  });
  it("rejects historical and successor records through the wrong explicit reader", () => {
    const f = seedSequenceRuntimeAdmissionFixtureV4(),
      old = seedRuntimeAdmissionFixture();
    expect(() =>
      parseSeedRuntimeClaimV4(old.claim(old.emptySnapshot()), old.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() => parseSeedRuntimeRecordV4(old.record(), old.scope)).toThrow(
      ModelRuntimeControlError,
    );
    expect(() => parseSeedRuntimeClaim(f.claim(), f.scope)).toThrow(
      ModelRuntimeControlError,
    );
    expect(() => parseSeedRuntimeRecord(f.record(), f.scope)).toThrow(
      ModelRuntimeControlError,
    );
    expect(() =>
      parseSeedRuntimeTerminalV4(old.terminal, f.request, f.decision),
    ).toThrow(ModelRuntimeControlError);
  });
  it.each([
    "one-call",
    "output-total",
    "cached",
    "cost",
    "credits",
    "authority",
    "request",
    "decision-calls",
    "lease-too-long",
    "expired-lease",
    "extra-field",
  ] as const)("rejects a changed %s claim", (kind) => {
    const f = seedSequenceRuntimeAdmissionFixtureV4();
    const claim = f.claim();
    const planned = claim.liveAuthorityReservation.planned;
    switch (kind) {
      case "one-call":
        Object.assign(planned, { invocations: 1 });
        break;
      case "output-total":
        Object.assign(planned, {
          outputTokens: 1000,
          totalTokens: planned.inputTokens + 1000,
        });
        break;
      case "cached":
        Object.assign(planned, {
          cacheReadTokens: 1,
          totalTokens: planned.totalTokens + 1,
        });
        break;
      case "cost":
        Object.assign(planned, {
          estimatedMicroUsd: planned.estimatedMicroUsd + 1,
        });
        break;
      case "credits":
        Object.assign(planned, { creditUnits: planned.creditUnits + 1 });
        break;
      case "authority":
        Object.assign(claim.liveAuthorityReservation, {
          authorityDigest: digest("other-authority"),
        });
        break;
      case "request":
        Object.assign(claim, { requestDigest: digest("other-request") });
        break;
      case "decision-calls": {
        const { decisionDigest, ...body } = claim.admissionDecision;
        void decisionDigest;
        const updated = {
          ...body,
          canonicalPlannedCallsDigest: digest("other-calls"),
        };
        Object.assign(claim, {
          admissionDecision:
            modelLiveSequenceRuntimeAdmissionDecisionV4Schema.parse({
              ...updated,
              decisionDigest: digest(updated),
            }),
        });
        break;
      }
      case "lease-too-long":
        Object.assign(claim, {
          executionLeaseExpiresAt: new Date(
            Date.parse(claim.decidedAt) + 300001,
          ).toISOString(),
        });
        break;
      case "expired-lease":
        Object.assign(claim, { executionLeaseExpiresAt: claim.decidedAt });
        break;
      case "extra-field":
        Object.assign(claim, { futureUsageDigest: digest("invented-usage") });
        break;
    }
    expect(() => parseSeedRuntimeClaimV4(claim, f.scope)).toThrow(
      ModelRuntimeControlError,
    );
  });
  it.each(["organizationId", "projectId", "userId"] as const)(
    "rejects a foreign %s scope for claims and records",
    (key) => {
      const f = seedSequenceRuntimeAdmissionFixtureV4();
      const scope = { ...f.scope, [key]: "other_synthetic_scope" };
      expect(() => parseSeedRuntimeClaimV4(f.claim(), scope)).toThrow(
        ModelRuntimeControlError,
      );
      expect(() => parseSeedRuntimeRecordV4(f.record(), scope)).toThrow(
        ModelRuntimeControlError,
      );
    },
  );
  it("retains lost execution as recovery metadata without a terminal financial claim", () => {
    const f = seedSequenceRuntimeAdmissionFixtureV4();
    const record = {
      ...f.record(),
      recoveryRequired: true,
      executionLease: null,
    };
    const parsed = parseSeedRuntimeRecordV4(record, f.scope);
    expect(parsed.recoveryRequired).toBe(true);
    expect(parsed.terminal).toBeNull();
    expect(parsed.pending).toBeNull();
    expect(parsed.liveAuthorityReservation.planned.invocations).toBe(2);
  });
});
