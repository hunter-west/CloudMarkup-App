import { describe, expect, it } from "vitest";
import { utcTimestampSchema } from "@cloudmarkup/schemas";
import { prepareModelLiveSeedRuntimeExecutionV3 } from "./model-live-runtime-preparation.js";
import { syntheticSeedRuntimeFixtureV3 } from "./model-live-seed-runtime-test-helpers.js";
import { syntheticSeedPreparationFixture } from "./model-live-seed-runtime-preparation-test-helpers.js";
import { digestStructuredValue as digest } from "./security.js";

const fixture = () =>
  syntheticSeedPreparationFixture(syntheticSeedRuntimeFixtureV3().input);
describe("first-seed runtime decision preparation", () => {
  it("derives V3 metadata from the shared capacity calculation without claiming or dispatching", async () => {
    const f = fixture();
    const before = digest(f.options.metadata);
    const result = await prepareModelLiveSeedRuntimeExecutionV3(f.options);
    expect(result.admissionDecision).toMatchObject({
      contractVersion: 3,
      recordKind: "model-live-sequence-runtime-admission-decision",
      outcome: "allowed",
      invocationId: result.stageInput.invocationId,
      inputBindingDigest: result.stageInput.inputBindingDigest,
      preparedPayloadDigest: result.stageInput.preparedPayloadDigest,
      authorization: {
        concurrencyLeaseId: f.options.concurrencyLeaseId,
        commercialReservationDecisionId: result.commercialRequest.reservationId,
      },
    });
    expect(digest(f.options.metadata)).toBe(before);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("inputEvidence");
  });
  it.each(["concurrency", "invocations", "cost"] as const)(
    "retains aggregate %s denial",
    async (kind) => {
      const f = fixture();
      const { limits } = f.options.metadata.plan.definition;
      f.setPatch({
        liveAuthorityUsage: {
          authorityDigest: f.options.metadata.plan.approval.approvalDigest,
          activeConcurrentJobs:
            kind === "concurrency" ? limits.maximumConcurrentJobs : 0,
          reservedInvocations:
            kind === "invocations" ? limits.maximumInvocations : 0,
          reservedEstimatedMicroUsd:
            kind === "cost" ? limits.maximumEstimatedMicroUsd : 0,
          reservedInputTokens: 0,
          reservedOutputTokens: 0,
          reservedTotalTokens: 0,
          reservedCacheReadTokens: 0,
          reservedCacheWriteTokens: 0,
          reservedCreditUnits: 0,
        },
      });
      const result = await prepareModelLiveSeedRuntimeExecutionV3(f.options);
      expect(result.admissionDecision.outcome).toBe("denied");
      expect(result.admissionDecision.invokeModel).toBe(false);
      expect(result.admissionDecision.authorization).toEqual({});
      expect(result.admissionDecision.denialReasons.length).toBeGreaterThan(0);
    },
  );
  it.each([
    "organizationId",
    "projectId",
    "userId",
    "requestDigest",
    "policyDigest",
    "capturedAt",
    "idempotencyReplay",
  ] as const)(
    "rejects a coherently rehashed changed %s snapshot",
    async (key) => {
      const f = fixture();
      const value =
        key === "idempotencyReplay"
          ? true
          : key === "capturedAt"
            ? new Date(Date.parse(f.options.observedAt) - 1).toISOString()
            : key.endsWith("Digest")
              ? digest("other synthetic binding")
              : "other_synthetic_scope";
      f.setPatch({ [key]: value });
      await expect(
        prepareModelLiveSeedRuntimeExecutionV3(f.options),
      ).rejects.toThrow();
    },
  );
  it("rejects expired preparation before capacity inspection", async () => {
    const f = fixture();
    f.options.observedAt = utcTimestampSchema.parse(
      f.options.metadata.commercialRequest.expiresAt,
    );
    await expect(
      prepareModelLiveSeedRuntimeExecutionV3(f.options),
    ).rejects.toThrow();
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it("rejects substituted issued input without creating authority", async () => {
    const f = fixture();
    f.options.metadata.stageInput.inputBindingDigest = digest(
      "substituted issued input",
    );
    await expect(
      prepareModelLiveSeedRuntimeExecutionV3(f.options),
    ).rejects.toThrow();
  });
});
