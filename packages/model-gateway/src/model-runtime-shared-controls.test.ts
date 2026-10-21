import {
  namespacedIdentifierSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { syntheticLiveEvaluationFixtureV2 } from "./model-live-evaluation-fakes.js";
import {
  expectedRuntimeDenialReasons,
  expectedSharedStaticDenialReasons,
} from "./model-runtime-shared-controls.js";
import { ModelRuntimeControlError } from "./model-runtime-errors.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing synthetic fixture value.");
  return value;
}

type StaticInput = Parameters<typeof expectedSharedStaticDenialReasons>[0];
function staticInput(): StaticInput {
  const f = syntheticLiveEvaluationFixtureV2();
  return {
    admissionRequest: f.request,
    policy: f.policy,
    routingDecision: {
      routeId: required(f.definition.cases[0]).routeId,
      modelConfigurationReference: required(f.definition.cases[0])
        .authorityBinding.authorityTuple.modelConfigurationReference,
      maximumOutputTokens: f.policy.limits.maximumOutputTokens,
      entitlement: { allowed: true },
      creditAuthorization: { allowed: true },
    },
    routingRequest: { creditAuthorization: { allowed: true } },
  };
}
type RuntimeInput = Parameters<typeof expectedRuntimeDenialReasons>[0];
function runtimeInput(): RuntimeInput {
  const f = syntheticLiveEvaluationFixtureV2();
  return {
    policy: f.policy,
    replayDenialReasons: [],
    liveAuthorityReservation: {
      authorityDigest: f.approval.approvalDigest,
      limits: {
        maximumConcurrentJobs: 1,
        maximumInvocations: 2,
        maximumInputTokens: 100,
        maximumOutputTokens: 20,
        maximumTotalTokens: 120,
        maximumCreditUnits: 2,
        maximumEstimatedMicroUsd: 1000,
      },
      planned: {
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        invocations: 1,
        creditUnits: 1,
        estimatedMicroUsd: 500,
      },
    },
    runtimeState: {
      idempotencyReplay: false,
      windows: {
        organization: {
          activeConcurrentJobs: 0,
          requestCount: 0,
          windowStartedAt: utcTimestampSchema.parse("2026-09-09T12:00:00.000Z"),
          windowEndsAt: utcTimestampSchema.parse("2026-09-09T13:00:00.000Z"),
        },
        user: {
          activeConcurrentJobs: 0,
          requestCount: 0,
          windowStartedAt: utcTimestampSchema.parse("2026-09-09T12:00:00.000Z"),
          windowEndsAt: utcTimestampSchema.parse("2026-09-09T13:00:00.000Z"),
        },
      },
      liveAuthorityUsage: {
        authorityDigest: f.approval.approvalDigest,
        reservedCacheReadTokens: 0,
        reservedCacheWriteTokens: 0,
        activeConcurrentJobs: 0,
        reservedInputTokens: 50,
        reservedOutputTokens: 10,
        reservedTotalTokens: 60,
        reservedInvocations: 1,
        reservedCreditUnits: 1,
        reservedEstimatedMicroUsd: 500,
      },
    },
  };
}

describe("report-independent shared runtime controls", () => {
  it("accepts the V2 projections without a final report or granting authority", () => {
    expect(expectedSharedStaticDenialReasons(staticInput())).toEqual([]);
    expect(expectedRuntimeDenialReasons(runtimeInput())).toEqual([]);
  });
  it.each([
    ["maximumPromptBytes", "promptBytes"],
    ["maximumRepositoryBytes", "repositoryBytes"],
    ["maximumRepositoryFiles", "repositoryFiles"],
    ["maximumFiles", "fileCount"],
    ["maximumNodes", "nodeCount"],
    ["maximumEdges", "edgeCount"],
  ] as const)("enforces the %s boundary", (limit, field) => {
    const input = staticInput();
    const requested = {
      ...input.admissionRequest.requested,
      [field]: input.policy.limits[limit],
    };
    expect(
      expectedSharedStaticDenialReasons({
        ...input,
        admissionRequest: { ...input.admissionRequest, requested },
      }),
    ).toEqual([]);
    expect(
      expectedSharedStaticDenialReasons({
        ...input,
        admissionRequest: {
          ...input.admissionRequest,
          requested: { ...requested, [field]: requested[field] + 1 },
        },
      }),
    ).toEqual(["input-limit-exceeded"]);
  });
  it.each([
    ["dependencyNames", "dependency-not-allow-listed"],
    ["providerSources", "provider-not-allow-listed"],
    ["moduleSources", "module-not-allow-listed"],
  ] as const)("denies unapproved %s", (field, reason) => {
    const input = staticInput();
    expect(
      expectedSharedStaticDenialReasons({
        ...input,
        admissionRequest: {
          ...input.admissionRequest,
          requested: {
            ...input.admissionRequest.requested,
            [field]: ["unreviewed"],
          },
        },
      }),
    ).toEqual([reason]);
  });
  it("enforces output bytes, policy tokens, route tokens and repair ceilings independently", () => {
    const input = staticInput();
    for (const [field, value, reason] of [
      [
        "outputBytes",
        input.policy.limits.maximumOutputBytes + 1,
        "output-limit-exceeded",
      ],
      [
        "outputTokens",
        input.policy.limits.maximumOutputTokens + 1,
        "output-limit-exceeded",
      ],
      [
        "repairAttempts",
        input.policy.limits.maximumRepairAttempts + 1,
        "repair-limit-exceeded",
      ],
    ] as const) {
      expect(
        expectedSharedStaticDenialReasons({
          ...input,
          admissionRequest: {
            ...input.admissionRequest,
            requested: { ...input.admissionRequest.requested, [field]: value },
          },
        }),
      ).toEqual([reason]);
    }
    expect(
      expectedSharedStaticDenialReasons({
        ...input,
        routingDecision: { ...input.routingDecision, maximumOutputTokens: 0 },
      }),
    ).toEqual(["output-limit-exceeded"]);
  });
  it("retains deterministic denial priority across simultaneous controls", () => {
    const input = staticInput();
    expect(
      expectedSharedStaticDenialReasons({
        ...input,
        policy: {
          ...input.policy,
          administrativeSuspensions: [
            {
              scope: "organization",
              scopeId: input.admissionRequest.organizationId,
              reasonCode: namespacedIdentifierSchema.parse(
                "cloudmarkup.review.paused",
              ),
            },
          ],
          killSwitches: {
            global: {
              engaged: true,
              reasonCode: namespacedIdentifierSchema.parse(
                "cloudmarkup.review.paused",
              ),
            },
            capabilitySwitches: [],
          },
          featureEntitlements: [],
          allowlists: { ...input.policy.allowlists, routes: [] },
        },
        routingDecision: {
          ...input.routingDecision,
          creditAuthorization: { allowed: false },
        },
      }),
    ).toEqual([
      "administratively-suspended",
      "capability-killed",
      "feature-not-entitled",
      "insufficient-credits",
      "model-not-allow-listed",
    ]);
  });
  it("requires both routing credit decisions and the plan entitlement", () => {
    const input = staticInput();
    expect(
      expectedSharedStaticDenialReasons({
        ...input,
        routingRequest: { creditAuthorization: { allowed: false } },
      }),
    ).toEqual(["insufficient-credits"]);
    expect(
      expectedSharedStaticDenialReasons({
        ...input,
        routingDecision: {
          ...input.routingDecision,
          entitlement: { allowed: false },
        },
      }),
    ).toEqual(["feature-not-entitled"]);
  });
  it.each(["routes", "roles", "modelConfigurationReferences"] as const)(
    "requires the %s allowlist",
    (field) => {
      const input = staticInput();
      expect(
        expectedSharedStaticDenialReasons({
          ...input,
          policy: {
            ...input.policy,
            allowlists: { ...input.policy.allowlists, [field]: [] },
          },
        }),
      ).toEqual(["model-not-allow-listed"]);
    },
  );
  it.each(["organization", "user"] as const)(
    "enforces shared %s request and concurrency windows",
    (scope) => {
      const input = runtimeInput();
      const windows = input.runtimeState.windows;
      expect(
        expectedRuntimeDenialReasons({
          ...input,
          runtimeState: {
            ...input.runtimeState,
            windows: {
              ...windows,
              [scope]: {
                ...windows[scope],
                requestCount:
                  input.policy.requestWindows[scope].maximumRequests,
                activeConcurrentJobs:
                  input.policy.requestWindows[scope].maximumConcurrentJobs,
              },
            },
          },
        }),
      ).toEqual(["request-limit-exceeded", "concurrency-limit-exceeded"]);
    },
  );
  it.each([
    "reservedInvocations",
    "reservedInputTokens",
    "reservedOutputTokens",
    "reservedTotalTokens",
    "reservedCreditUnits",
    "reservedEstimatedMicroUsd",
  ] as const)(
    "denies cumulative capacity exceeding %s without refunding prior work",
    (field) => {
      const input = runtimeInput();
      const usage = required(input.runtimeState.liveAuthorityUsage);
      expect(
        expectedRuntimeDenialReasons({
          ...input,
          runtimeState: {
            ...input.runtimeState,
            liveAuthorityUsage: { ...usage, [field]: usage[field] + 1 },
          },
        }),
      ).toEqual(["live-evaluation-not-authorized"]);
    },
  );
  it("enforces plan concurrency separately from organization and user limits", () => {
    const input = runtimeInput();
    expect(
      expectedRuntimeDenialReasons({
        ...input,
        runtimeState: {
          ...input.runtimeState,
          liveAuthorityUsage: {
            ...required(input.runtimeState.liveAuthorityUsage),
            activeConcurrentJobs: 1,
          },
        },
      }),
    ).toEqual(["concurrency-limit-exceeded"]);
  });
  it("rejects missing or substituted live capacity authority", () => {
    const input = runtimeInput();
    const state = {
      idempotencyReplay: input.runtimeState.idempotencyReplay,
      windows: input.runtimeState.windows,
    };
    expect(() =>
      expectedRuntimeDenialReasons({ ...input, runtimeState: state }),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      expectedRuntimeDenialReasons({
        ...input,
        liveAuthorityReservation: undefined,
      }),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      expectedRuntimeDenialReasons({
        ...input,
        runtimeState: {
          ...input.runtimeState,
          liveAuthorityUsage: {
            ...required(input.runtimeState.liveAuthorityUsage),
            authorityDigest: sha256DigestSchema.parse(
              "sha256:" + "f".repeat(64),
            ),
          },
        },
      }),
    ).toThrow(ModelRuntimeControlError);
  });
  it("preserves original replay denial reasons even after limits change", () => {
    const input = runtimeInput();
    expect(
      expectedRuntimeDenialReasons({
        ...input,
        replayDenialReasons: ["request-limit-exceeded"],
        runtimeState: { ...input.runtimeState, idempotencyReplay: true },
      }),
    ).toEqual(["request-limit-exceeded"]);
  });
});
