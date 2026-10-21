import { vi } from "vitest";
import {
  modelRuntimeStateSnapshotV1Schema,
  type ModelRuntimeStateSnapshotV1,
} from "@cloudmarkup/schemas";
import type {
  ModelLiveSeedRuntimeExecutionInputV3,
  ModelLiveSeedRuntimeExecutionInputV4,
} from "./model-live-seed-runtime-execution.js";
import { digestStructuredValue as digest } from "./security.js";
import type { ModelRuntimeStateSnapshotRequestV1 } from "./model-runtime-controls.js";

/** Synthetic read-only capacity fixture; no real admission or reservation. */
export function syntheticSeedPreparationFixture<
  T extends
    ModelLiveSeedRuntimeExecutionInputV3 | ModelLiveSeedRuntimeExecutionInputV4,
>(input: T) {
  const { admissionDecision, ...metadata } = input;
  const now = admissionDecision.decidedAt;
  let patch: Partial<ModelRuntimeStateSnapshotV1> = {};
  const inspect = vi.fn((request: ModelRuntimeStateSnapshotRequestV1) => {
    const window = (seconds: number) => {
      const start =
        Math.floor(Date.parse(now) / (seconds * 1000)) * seconds * 1000;
      return {
        activeConcurrentJobs: 0,
        requestCount: 0,
        windowStartedAt: new Date(start).toISOString(),
        windowEndsAt: new Date(start + seconds * 1000).toISOString(),
      };
    };
    const body = {
      contractVersion: 1,
      recordKind: "model-runtime-state-snapshot",
      snapshotId: "synthetic_seed_preparation_snapshot",
      capturedAt: now,
      organizationId: request.organizationId,
      projectId: request.projectId,
      userId: request.userId,
      policyDigest: request.runtimePolicyDigest,
      requestDigest: request.requestDigest,
      idempotencyReplay: false,
      activeConcurrencyLeaseIds: [],
      windows: {
        organization: window(request.organizationWindowSeconds),
        user: window(request.userWindowSeconds),
      },
      liveAuthorityUsage: {
        authorityDigest: metadata.plan.approval.approvalDigest,
        activeConcurrentJobs: 0,
        reservedInvocations: 0,
        reservedInputTokens: 0,
        reservedOutputTokens: 0,
        reservedTotalTokens: 0,
        reservedCacheReadTokens: 0,
        reservedCacheWriteTokens: 0,
        reservedCreditUnits: 0,
        reservedEstimatedMicroUsd: 0,
      },
      ...patch,
    };
    return Promise.resolve(
      modelRuntimeStateSnapshotV1Schema.parse({
        ...body,
        snapshotDigest: digest(body),
      }),
    );
  });
  const options = {
    metadata,
    store: { inspect },
    observedAt: now,
    decisionId: "synthetic_seed_prepared_decision",
    concurrencyLeaseId: "synthetic_seed_prepared_lease",
  };
  return {
    options,
    inspect,
    setPatch: (value: Partial<ModelRuntimeStateSnapshotV1>) => {
      patch = value;
    },
  };
}
