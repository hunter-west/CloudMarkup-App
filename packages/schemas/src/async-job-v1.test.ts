import { describe, expect, it } from "vitest";

import {
  ASYNC_JOB_V1_HARD_LIMITS,
  asyncJobAttemptV1Schema,
  asyncJobCreateRequestV1Schema,
  asyncJobEvidenceReferenceV1Schema,
  asyncJobFamilyV1Schema,
  asyncJobInputV1Schema,
  asyncJobRecordV1Schema,
  asyncJobStatusViewV1Schema,
  type AsyncJobRecordV1,
} from "./async-job-v1.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const at = "2026-08-15T12:00:00Z";

function inputRef(sizeBytes = 10) {
  return {
    contractVersion: 1 as const,
    digest: digestA,
    mediaType: "application/json",
    objectId: "object.input",
    purpose: "input-payload" as const,
    sizeBytes,
  };
}

function queuedDraftRecord(): AsyncJobRecordV1 {
  return asyncJobRecordV1Schema.parse({
    attempts: [],
    cancellation: { state: "none" },
    checkpoints: [],
    contractVersion: 1,
    correlationId: "correlation.1",
    createdAt: at,
    family: "intent-extraction",
    idempotency: {
      actorId: "actor.1",
      keyDigest: digestA,
      operationId: "jobs.create",
      requestDigest: digestB,
    },
    input: {
      contractVersion: 1,
      family: "intent-extraction",
      source: inputRef(),
      subject: {
        contentDigest: digestA,
        draftId: "draft.1",
        draftVersion: 7,
        etag: '"etag.7"',
        kind: "draft",
      },
    },
    inputDigest: digestB,
    interaction: { state: "none" },
    inputSizeBytes: 512,
    jobId: "job.1",
    limits: {
      artifactCount: 8,
      attemptCount: 3,
      checkpointBytes: 1_024,
      checkpointCount: 4,
      contractVersion: 1,
      inlineInputBytes: 1_024,
      outputBytes: 4_096,
      referencedInputBytes: 1_024,
      runtimeSeconds: 300,
    },
    orchestration: {
      dependencyJobIds: [],
      expectedChildJobIds: [],
      failurePolicy: "fail-parent",
      rootJobId: "job.1",
    },
    ownership: {
      organizationId: "organization.1",
      projectId: "project.1",
    },
    queuedAt: at,
    recordVersion: 1,
    reservation: { state: "none" },
    state: "queued",
    updatedAt: at,
  });
}

function awaitingDraftRecord(): AsyncJobRecordV1 {
  const job = queuedDraftRecord();
  return asyncJobRecordV1Schema.parse({
    ...job,
    attempts: [
      {
        attemptId: "attempt.1",
        attemptNumber: 1,
        completedAt: at,
        runtimeSeconds: 0,
        startedAt: at,
        state: "succeeded",
      },
    ],
    checkpoints: [
      {
        attemptNumber: 1,
        checkpointId: "checkpoint.1",
        createdAt: at,
        handlerId: "cloudmarkup.handler.intent-extraction",
        handlerVersion: "1.0.0",
        inputDigest: digestB,
        sequence: 1,
        state: {
          contractVersion: 1,
          digest: digestA,
          mediaType: "application/json",
          objectId: "object.checkpoint",
          purpose: "checkpoint-state",
          sizeBytes: 100,
        },
      },
    ],
    interaction: {
      checkpointId: "checkpoint.1",
      handlerId: "cloudmarkup.handler.intent-extraction",
      handlerVersion: "1.0.0",
      interactionId: "interaction.1",
      requestedAt: at,
      state: "awaiting-user-input",
    },
    latestCheckpointId: "checkpoint.1",
    state: "awaiting-user-input",
  });
}

describe("Async Job v1", () => {
  it("defines every planned family without implying a handler", () => {
    expect(asyncJobFamilyV1Schema.options).toEqual([
      "intent-extraction",
      "architecture-proposal",
      "workload-contract-proposal",
      "graph-workload-operation-proposal",
      "iac-compilation",
      "application-source-generation",
      "application-build-test-package",
      "static-validation",
      "diagram-rendering",
      "combined-export-packaging",
      "solution-export-orchestration",
      "github-repository-export",
      "customer-owned-plan-evidence",
      "deployment-evidence",
      "smoke-integration-evidence",
      "drift-evidence",
      "billing-usage-reconciliation",
    ]);
  });

  it("keeps organization identity and credentials out of strict job input", () => {
    const input = queuedDraftRecord().input;
    expect(
      asyncJobInputV1Schema.safeParse({
        ...input,
        organizationId: "attacker-organization",
      }).success,
    ).toBe(false);
    expect(
      asyncJobInputV1Schema.safeParse({
        ...input,
        accessToken: "secret",
      }).success,
    ).toBe(false);
  });

  it("requires the exact immutable manifest identity and digest", () => {
    const result = asyncJobInputV1Schema.safeParse({
      compilerTargetId: "compiler.terraform",
      contractVersion: 1,
      environment: { environmentType: "development" },
      family: "iac-compilation",
      subject: {
        kind: "solution-revision",
        manifestDigest: digestA,
        solutionRevisionId: "solution.1",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized inline and referenced payloads", () => {
    expect(
      asyncJobCreateRequestV1Schema.safeParse({
        contractVersion: 1,
        idempotencyKey: "key-1",
        input: queuedDraftRecord().input,
        inputSizeBytes: ASYNC_JOB_V1_HARD_LIMITS.inlineInputBytes + 1,
      }).success,
    ).toBe(false);

    const job = queuedDraftRecord();
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        input: {
          ...job.input,
          source: inputRef(job.limits.referencedInputBytes + 1),
        },
      }).success,
    ).toBe(false);
  });

  it("keeps superseded jobs auditable and linked", () => {
    const job = queuedDraftRecord();
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        completedAt: at,
        state: "superseded",
      }).success,
    ).toBe(false);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        completedAt: at,
        state: "superseded",
        supersededByJobId: "job.2",
      }).success,
    ).toBe(true);
  });

  it("requires durable Evidence references", () => {
    const base = {
      environment: { environmentType: "production" as const },
      evidenceId: "evidence.1",
      solutionRevisionId: "solution.1",
    };
    expect(
      asyncJobEvidenceReferenceV1Schema.safeParse({
        ...base,
        record: {
          contractVersion: 1,
          digest: digestA,
          expiresAt: at,
          mediaType: "application/json",
          objectId: "object.evidence",
          purpose: "evidence",
          sizeBytes: 100,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects draft completion that masquerades as revision Evidence", () => {
    const job = queuedDraftRecord();
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        completedAt: at,
        family: "static-validation",
        input: {
          contractVersion: 1,
          environment: { environmentType: "development" },
          family: "static-validation",
          inputs: [inputRef()],
          subject: job.input.subject,
          validationProfileId: "validation.standard",
        },
        output: {
          contractVersion: 1,
          evidenceRecords: [
            {
              environment: { environmentType: "development" },
              evidenceId: "evidence.1",
              record: {
                contractVersion: 1,
                digest: digestA,
                mediaType: "application/json",
                objectId: "object.evidence",
                purpose: "evidence",
                sizeBytes: 100,
              },
              solutionRevisionId: "solution.1",
            },
          ],
          family: "static-validation",
          report: {
            artifactId: "artifact.1",
            availability: { state: "available" },
            object: {
              contractVersion: 1,
              digest: digestA,
              mediaType: "application/json",
              objectId: "object.report",
              purpose: "validation-report",
              sizeBytes: 100,
            },
          },
        },
        outputSizeBytes: 100,
        state: "succeeded",
      }).success,
    ).toBe(false);
  });

  it("accepts a durable non-expiring Evidence reference", () => {
    const result = asyncJobEvidenceReferenceV1Schema.safeParse({
      environment: { environmentType: "production" },
      evidenceId: "evidence.1",
      record: {
        contractVersion: 1,
        digest: digestA,
        mediaType: "application/json",
        objectId: "object.evidence",
        purpose: "evidence",
        sizeBytes: 100,
      },
      solutionRevisionId: "solution.1",
    });
    expect(result.success).toBe(true);
  });

  it("binds an awaited interaction to the latest durable checkpoint", () => {
    const job = awaitingDraftRecord();
    expect(asyncJobRecordV1Schema.safeParse(job).success).toBe(true);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        interaction: { state: "none" },
      }).success,
    ).toBe(false);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        interaction: {
          ...job.interaction,
          handlerVersion: "2.0.0",
        },
      }).success,
    ).toBe(false);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        state: "queued",
      }).success,
    ).toBe(false);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        completedAt: "2026-08-15T12:00:01Z",
        state: "expired",
        updatedAt: "2026-08-15T12:00:01Z",
      }).success,
    ).toBe(true);
  });

  it("exposes only the opaque awaited-interaction binding in status", () => {
    const job = awaitingDraftRecord();
    if (job.interaction.state !== "awaiting-user-input") {
      throw new Error("fixture must await user input");
    }
    const status = {
      cancellation: job.cancellation,
      contractVersion: 1,
      correlationId: job.correlationId,
      createdAt: job.createdAt,
      family: job.family,
      inputSubject: job.input.subject,
      interaction: {
        interactionId: job.interaction.interactionId,
        requestedAt: job.interaction.requestedAt,
        state: "awaiting-user-input" as const,
      },
      jobId: job.jobId,
      recordVersion: job.recordVersion,
      state: job.state,
      updatedAt: job.updatedAt,
    };
    expect(asyncJobStatusViewV1Schema.safeParse(status).success).toBe(true);
    expect(
      asyncJobStatusViewV1Schema.safeParse({
        ...status,
        interaction: { state: "none" },
      }).success,
    ).toBe(false);
    expect(
      asyncJobStatusViewV1Schema.safeParse({
        ...status,
        interaction: {
          ...status.interaction,
          checkpointId: job.interaction.checkpointId,
        },
      }).success,
    ).toBe(false);
    expect(
      asyncJobStatusViewV1Schema.safeParse({
        ...status,
        completedAt: "2026-08-15T12:00:01Z",
        interaction: { state: "none" },
        state: "expired",
        updatedAt: "2026-08-15T12:00:01Z",
      }).success,
    ).toBe(true);
    expect(
      asyncJobStatusViewV1Schema.safeParse({
        ...status,
        completedAt: "2026-08-15T12:00:01Z",
        state: "expired",
        updatedAt: "2026-08-15T12:00:01Z",
      }).success,
    ).toBe(false);
  });

  it("persists only durable user responses and counts them as referenced input", () => {
    const job = awaitingDraftRecord();
    if (job.interaction.state !== "awaiting-user-input") {
      throw new Error("fixture must await user input");
    }
    const response = {
      ...inputRef(100),
      objectId: "object.user-response",
    };
    const received = {
      ...job,
      interaction: {
        ...job.interaction,
        receivedAt: "2026-08-15T12:00:01Z",
        state: "user-input-received" as const,
        userResponse: response,
      },
      state: "queued" as const,
      updatedAt: "2026-08-15T12:00:01Z",
    };
    expect(asyncJobRecordV1Schema.safeParse(received).success).toBe(true);
    const originalCheckpoint = job.checkpoints[0];
    if (originalCheckpoint === undefined) {
      throw new Error("fixture must contain its interaction checkpoint");
    }
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...received,
        checkpoints: [
          ...received.checkpoints,
          {
            ...originalCheckpoint,
            checkpointId: "checkpoint.2",
            createdAt: "2026-08-15T12:00:02Z",
            sequence: 2,
            state: {
              ...originalCheckpoint.state,
              objectId: "object.checkpoint.2",
            },
          },
        ],
        latestCheckpointId: "checkpoint.2",
        updatedAt: "2026-08-15T12:00:02Z",
      }).success,
    ).toBe(true);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...received,
        interaction: {
          ...received.interaction,
          userResponse: { ...response, expiresAt: "2026-08-16T12:00:00Z" },
        },
      }).success,
    ).toBe(false);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...received,
        interaction: {
          ...received.interaction,
          userResponse: {
            ...response,
            sizeBytes: job.limits.referencedInputBytes,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires unique, disjoint, self-free orchestration sets", () => {
    const job = queuedDraftRecord();
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        orchestration: {
          ...job.orchestration,
          expectedChildJobIds: ["job.2", "job.2"],
        },
      }).success,
    ).toBe(false);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        orchestration: {
          ...job.orchestration,
          expectedChildJobIds: [job.jobId],
        },
      }).success,
    ).toBe(false);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...job,
        orchestration: {
          ...job.orchestration,
          dependencyJobIds: ["job.2"],
          expectedChildJobIds: ["job.2"],
        },
      }).success,
    ).toBe(false);
  });

  it("keeps retry scheduling on exactly one completed-attempt disposition", () => {
    const failedAttempt = {
      attemptId: "attempt.1",
      attemptNumber: 1,
      completedAt: at,
      failure: {
        classification: "transient",
        code: "jobs.transient",
        publicMessage: "job-temporarily-unavailable",
      },
      runtimeSeconds: 0,
      startedAt: at,
      state: "failed",
    };
    expect(asyncJobAttemptV1Schema.safeParse(failedAttempt).success).toBe(
      false,
    );
    expect(
      asyncJobAttemptV1Schema.safeParse({
        ...failedAttempt,
        failure: {
          classification: "permanent",
          code: "jobs.permanent",
          publicMessage: "job-input-invalid",
        },
        retryDisposition: { kind: "retry", notBefore: at },
      }).success,
    ).toBe(false);
    expect(
      asyncJobAttemptV1Schema.safeParse({
        ...failedAttempt,
        retryDisposition: { kind: "do-not-retry" },
      }).success,
    ).toBe(true);
    expect(
      asyncJobAttemptV1Schema.safeParse({
        attemptId: "attempt.2",
        attemptNumber: 2,
        completedAt: at,
        retryDisposition: { kind: "retry", notBefore: at },
        runtimeSeconds: 0,
        startedAt: at,
        state: "orphaned",
      }).success,
    ).toBe(true);
    expect(
      asyncJobRecordV1Schema.safeParse({
        ...queuedDraftRecord(),
        nextRetryAt: at,
      }).success,
    ).toBe(false);
  });
});
