import { describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  ModelRuntimeControlError,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelRuntimeStateSnapshotV1Schema,
} from "@cloudmarkup/schemas";
import {
  admissionJson,
  parseRuntimeClaim,
  parseRuntimeRecord,
} from "./model-runtime-admission-codec.js";
import {
  parseSeedRuntimeClaim,
  parseSeedRuntimeRecord,
  parseSeedRuntimeStateRequest,
  parseSeedRuntimeTerminal,
} from "./model-live-seed-runtime-admission-codec.js";
import { seedRuntimeAdmissionFixture } from "./model-live-seed-runtime-admission-test-helpers.js";
import {
  parseLiveRuntimeClaim,
  parseLiveRuntimeRecord,
} from "./model-live-runtime-admission-codec.js";
import { liveRuntimeAdmissionFixture } from "./model-live-runtime-admission-test-helpers.js";
import { runtimeAdmissionFixture } from "./model-runtime-admission-test-helpers.js";

describe("strict first-seed V3 admission metadata", () => {
  it("roundtrips versioned claims, records and terminals without caller references", () => {
    const f = seedRuntimeAdmissionFixture();
    const input = f.claim(f.emptySnapshot());
    const parsed = parseSeedRuntimeClaim(input, f.scope);
    expect(parsed).toEqual(input);
    expect(parsed.admissionRequest).not.toBe(input.admissionRequest);
    expect(parsed.liveAuthorityReservation).not.toBe(
      input.liveAuthorityReservation,
    );
    expect(parseSeedRuntimeStateRequest(f.state, f.scope)).toEqual(f.state);
    expect(parseSeedRuntimeRecord(admissionJson(f.record()), f.scope)).toEqual(
      f.record(),
    );
    expect(parseSeedRuntimeTerminal(f.terminal, f.request, f.decision)).toEqual(
      f.terminal,
    );
  });
  it("preserves strict rejection between normal and evaluation versions", () => {
    const live = seedRuntimeAdmissionFixture();
    const normal = runtimeAdmissionFixture();
    const historical = liveRuntimeAdmissionFixture();
    expect(() =>
      parseSeedRuntimeClaim(
        historical.claim(historical.emptySnapshot()),
        historical.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseSeedRuntimeRecord(historical.record(), historical.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseLiveRuntimeClaim(live.claim(live.emptySnapshot()), live.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() => parseLiveRuntimeRecord(live.record(), live.scope)).toThrow(
      ModelRuntimeControlError,
    );
    expect(() =>
      parseRuntimeClaim(live.claim(live.emptySnapshot()) as never, live.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() => parseRuntimeRecord(live.record(), live.scope)).toThrow(
      ModelRuntimeControlError,
    );
    expect(() =>
      parseSeedRuntimeClaim(normal.claim(normal.emptySnapshot()), normal.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseSeedRuntimeStateRequest(normal.state, normal.scope),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseSeedRuntimeTerminal(normal.terminal, live.request, live.decision),
    ).toThrow(ModelRuntimeControlError);
  });
  it.each([
    "evaluationCaseId",
    "selectionId",
    "selectionDigest",
    "stageId",
    "invocationId",
    "inputBindingDigest",
    "preparedPayloadDigest",
    "routingDecisionDigest",
    "runtimePolicyDigest",
    "commercialEstimateDigest",
    "evaluationAuthorityTupleDigest",
    "evaluationCaseDigest",
    "liveEvaluationPlanDigest",
    "liveEvaluationAuthorityDigest",
    "requestDigest",
  ] as const)("rejects a rehashed decision with substituted %s", (key) => {
    const f = seedRuntimeAdmissionFixture();
    const { decisionDigest: previousDigest, ...body } = f.decision;
    void previousDigest;
    const changed = {
      ...body,
      [key]:
        key === "evaluationCaseId"
          ? body.evaluationCaseId ===
            "evaluation_case_repair_success_full_beta_v1"
            ? "evaluation_case_repair_exhaustion_full_beta_v1"
            : "evaluation_case_repair_success_full_beta_v1"
          : key.endsWith("Id")
            ? body[key].slice(0, -1) + (body[key].endsWith("a") ? "b" : "a")
            : digestStructuredValue("substituted"),
    };
    const decision = modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse({
      ...changed,
      decisionDigest: digestStructuredValue(changed),
    });
    expect(() =>
      parseSeedRuntimeClaim(
        { ...f.claim(f.emptySnapshot()), admissionDecision: decision },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseSeedRuntimeRecord({ ...f.record(), decision }, f.scope),
    ).toThrow(ModelRuntimeControlError);
  });
  it.each(["organizationId", "projectId", "userId"] as const)(
    "rejects cross-tenant %s",
    (key) => {
      const f = seedRuntimeAdmissionFixture();
      const scope = { ...f.scope, [key]: "foreign_scope" };
      expect(() =>
        parseSeedRuntimeClaim(f.claim(f.emptySnapshot()), scope),
      ).toThrow(ModelRuntimeControlError);
      expect(() => parseSeedRuntimeRecord(f.record(), scope)).toThrow(
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
    const f = seedRuntimeAdmissionFixture();
    const reservation = {
      ...f.reservation,
      planned: { ...f.reservation.planned, [key]: 0 },
    };
    expect(() =>
      parseSeedRuntimeClaim(
        {
          ...f.claim(f.emptySnapshot()),
          liveAuthorityReservation: reservation,
        },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseSeedRuntimeRecord(
        { ...f.record(), liveAuthorityReservation: reservation },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
  });

  it.each([
    "invocations",
    "cacheReadTokens",
    "cacheWriteTokens",
    "outputTokens",
  ] as const)(
    "rejects internally consistent substituted %s capacity",
    (key) => {
      const f = seedRuntimeAdmissionFixture();
      const planned = {
        ...f.reservation.planned,
        [key]: f.reservation.planned[key] + 1,
      };
      planned.totalTokens =
        planned.inputTokens +
        planned.outputTokens +
        planned.cacheReadTokens +
        planned.cacheWriteTokens;
      const changed = { ...f.reservation, planned };
      expect(() =>
        parseSeedRuntimeClaim(
          { ...f.claim(f.emptySnapshot()), liveAuthorityReservation: changed },
          f.scope,
        ),
      ).toThrow(ModelRuntimeControlError);
      expect(() =>
        parseSeedRuntimeRecord(
          { ...f.record(), liveAuthorityReservation: changed },
          f.scope,
        ),
      ).toThrow(ModelRuntimeControlError);
    },
  );
  it.each([0, -1, 300001])(
    "rejects an execution lease lasting %s milliseconds",
    (duration) => {
      const f = seedRuntimeAdmissionFixture();
      expect(() =>
        parseSeedRuntimeClaim(
          {
            ...f.claim(f.emptySnapshot()),
            executionLeaseExpiresAt: new Date(
              Date.parse(f.now) + duration,
            ).toISOString(),
          },
          f.scope,
        ),
      ).toThrow(ModelRuntimeControlError);
    },
  );
  it.each([
    { acquire: false },
    { leaseId: "substituted_lease" },
    { deniedTerminal: null },
  ])("rejects contradictory lease acquisition %j", (change) => {
    const f = seedRuntimeAdmissionFixture();
    expect(() =>
      parseSeedRuntimeClaim(
        { ...f.claim(f.emptySnapshot()), ...change },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
  });
  it("rejects a different valid decision nested in terminal metadata", () => {
    const f = seedRuntimeAdmissionFixture();
    const { decisionDigest: ignored, ...body } = f.decision;
    void ignored;
    const changed = { ...body, decisionId: "different_decision" };
    const admission = modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse({
      ...changed,
      decisionDigest: digestStructuredValue(changed),
    });
    expect(() =>
      parseSeedRuntimeTerminal(
        { ...f.terminal, admission },
        f.request,
        f.decision,
      ),
    ).toThrow(ModelRuntimeControlError);
  });
  it.each(["request", "capacity", "record", "terminal"])(
    "rejects temporary content in %s",
    (kind) => {
      const f = seedRuntimeAdmissionFixture();
      const content = { candidateText: "Unaccepted synthetic content" };
      expect(() => {
        if (kind === "record")
          return parseSeedRuntimeRecord({ ...f.record(), ...content }, f.scope);
        if (kind === "terminal")
          return parseSeedRuntimeTerminal(
            { ...f.terminal, ...content },
            f.request,
            f.decision,
          );
        return parseSeedRuntimeClaim(
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
    const f = seedRuntimeAdmissionFixture();
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
        parseSeedRuntimeRecord({ ...f.record(), originalSnapshot }, f.scope),
      ).toThrow(ModelRuntimeControlError);
    }
  });
  it("preserves sticky recovery and terminal immutability constraints", () => {
    const f = seedRuntimeAdmissionFixture();
    for (const change of [
      { recoveryRequired: true },
      { terminal: f.terminal },
      { pending: f.terminal },
      { executionLease: { ...f.record().executionLease, revision: 1 } },
    ])
      expect(() =>
        parseSeedRuntimeRecord({ ...f.record(), ...change }, f.scope),
      ).toThrow(ModelRuntimeControlError);
  });
});
