import { describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  ModelRuntimeControlError,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelRuntimeStateSnapshotV1Schema,
} from "@cloudmarkup/schemas";
import {
  admissionJson,
  parseRuntimeClaim,
  parseRuntimeRecord,
} from "./model-runtime-admission-codec.js";
import {
  liveRuntimeCapacityReservationSchema,
  parseLiveRuntimeClaim,
  parseLiveRuntimeRecord,
  parseLiveRuntimeStateRequest,
  parseLiveRuntimeTerminal,
} from "./model-live-runtime-admission-codec.js";
import { liveRuntimeAdmissionFixture } from "./model-live-runtime-admission-test-helpers.js";
import { runtimeAdmissionFixture } from "./model-runtime-admission-test-helpers.js";

describe("strict report-free live admission metadata", () => {
  it("roundtrips versioned claims, records and terminals without caller references", () => {
    const f = liveRuntimeAdmissionFixture();
    const input = f.claim(f.emptySnapshot());
    const parsed = parseLiveRuntimeClaim(input, f.scope);
    expect(parsed).toEqual(input);
    expect(parsed.admissionRequest).not.toBe(input.admissionRequest);
    expect(parsed.liveAuthorityReservation).not.toBe(
      input.liveAuthorityReservation,
    );
    expect(parseLiveRuntimeStateRequest(f.state, f.scope)).toEqual(f.state);
    expect(parseLiveRuntimeRecord(admissionJson(f.record()), f.scope)).toEqual(
      f.record(),
    );
    expect(parseLiveRuntimeTerminal(f.terminal, f.request, f.decision)).toEqual(
      f.terminal,
    );
  });
  it("preserves strict rejection between normal and evaluation versions", () => {
    const live = liveRuntimeAdmissionFixture();
    const normal = runtimeAdmissionFixture();
    expect(() =>
      parseRuntimeClaim(live.claim(live.emptySnapshot()) as never, live.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() => parseRuntimeRecord(live.record(), live.scope)).toThrow(
      ModelRuntimeControlError,
    );
    expect(() =>
      parseLiveRuntimeClaim(normal.claim(normal.emptySnapshot()), normal.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseLiveRuntimeStateRequest(normal.state, normal.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseLiveRuntimeTerminal(normal.terminal, live.request, live.decision),
    ).toThrow(ModelRuntimeControlError);
  });
  it.each([
    "evaluationCaseId",
    "evaluationCaseDigest",
    "liveEvaluationPlanDigest",
    "liveEvaluationAuthorityDigest",
    "requestDigest",
  ] as const)("rejects a rehashed decision with substituted %s", (key) => {
    const f = liveRuntimeAdmissionFixture();
    const { decisionDigest: previousDigest, ...body } = f.decision;
    void previousDigest;
    const changed = {
      ...body,
      [key]:
        key === "evaluationCaseId"
          ? "case_other"
          : digestStructuredValue("substituted"),
    };
    const decision = modelLiveRuntimeAdmissionDecisionV2Schema.parse({
      ...changed,
      decisionDigest: digestStructuredValue(changed),
    });
    expect(() =>
      parseLiveRuntimeClaim(
        { ...f.claim(f.emptySnapshot()), admissionDecision: decision },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseLiveRuntimeRecord({ ...f.record(), decision }, f.scope),
    ).toThrow(ModelRuntimeControlError);
  });
  it.each(["organizationId", "projectId", "userId"] as const)(
    "rejects cross-tenant %s",
    (key) => {
      const f = liveRuntimeAdmissionFixture();
      const scope = { ...f.scope, [key]: "foreign_scope" };
      expect(() =>
        parseLiveRuntimeClaim(f.claim(f.emptySnapshot()), scope),
      ).toThrow(ModelRuntimeControlError);
      expect(() => parseLiveRuntimeRecord(f.record(), scope)).toThrow(
        ModelRuntimeControlError,
      );
    },
  );
  it.each([
    "creditUnits",
    "estimatedMicroUsd",
    "totalTokens",
    "outputTokens",
  ] as const)("rejects contradictory planned %s", (key) => {
    const f = liveRuntimeAdmissionFixture();
    const planned = {
      ...f.reservation.planned,
      [key]: key === "outputTokens" ? f.request.requested.outputTokens - 1 : 0,
    };
    if (key === "outputTokens") {
      expect(f.request.requested.outputTokens).toBeGreaterThan(0);
      expect(
        parseLiveRuntimeClaim(f.claim(f.emptySnapshot()), f.scope),
      ).toEqual(f.claim(f.emptySnapshot()));
      expect(parseLiveRuntimeRecord(f.record(), f.scope)).toEqual(f.record());
      planned.totalTokens =
        planned.inputTokens +
        planned.outputTokens +
        planned.cacheReadTokens +
        planned.cacheWriteTokens;
    }
    const reservation = { ...f.reservation, planned };
    if (key === "outputTokens")
      expect(liveRuntimeCapacityReservationSchema.parse(reservation)).toEqual(
        reservation,
      );
    expect(() =>
      parseLiveRuntimeClaim(
        {
          ...f.claim(f.emptySnapshot()),
          liveAuthorityReservation: reservation,
        },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseLiveRuntimeRecord(
        { ...f.record(), liveAuthorityReservation: reservation },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
  });
  it.each(["request", "capacity", "record", "terminal"])(
    "rejects temporary content in %s",
    (kind) => {
      const f = liveRuntimeAdmissionFixture();
      const content = { candidateText: "Unaccepted synthetic content" };
      expect(() => {
        if (kind === "record")
          return parseLiveRuntimeRecord({ ...f.record(), ...content }, f.scope);
        if (kind === "terminal")
          return parseLiveRuntimeTerminal(
            { ...f.terminal, ...content },
            f.request,
            f.decision,
          );
        return parseLiveRuntimeClaim(
          {
            ...f.claim(f.emptySnapshot()),
            ...(kind === "request"
              ? { admissionRequest: { ...f.request, ...content } }
              : { liveAuthorityReservation: { ...f.reservation, ...content } }),
          },
          f.scope,
        );
      }).toThrow(ModelRuntimeControlError);
    },
  );
  it("rejects missing or substituted snapshot capacity even after rehashing", () => {
    const f = liveRuntimeAdmissionFixture();
    const {
      snapshotDigest: previousDigest,
      liveAuthorityUsage,
      ...body
    } = f.emptySnapshot();
    void previousDigest;
    for (const usage of [
      undefined,
      {
        ...liveAuthorityUsage,
        authorityDigest: digestStructuredValue("other approval"),
      },
    ]) {
      const next = {
        ...body,
        ...(usage === undefined ? {} : { liveAuthorityUsage: usage }),
      };
      const originalSnapshot = modelRuntimeStateSnapshotV1Schema.parse({
        ...next,
        snapshotDigest: digestStructuredValue(next),
      });
      expect(() =>
        parseLiveRuntimeRecord({ ...f.record(), originalSnapshot }, f.scope),
      ).toThrow(ModelRuntimeControlError);
    }
  });
  it("preserves sticky recovery and terminal immutability constraints", () => {
    const f = liveRuntimeAdmissionFixture();
    for (const change of [
      { recoveryRequired: true },
      { terminal: f.terminal },
      { pending: f.terminal },
      { executionLease: { ...f.record().executionLease, revision: 1 } },
    ])
      expect(() =>
        parseLiveRuntimeRecord({ ...f.record(), ...change }, f.scope),
      ).toThrow(ModelRuntimeControlError);
  });
});
