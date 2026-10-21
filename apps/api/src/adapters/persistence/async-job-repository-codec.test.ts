import { hashCanonicalValue } from "@cloudmarkup/domain";
import { DEFAULT_JOB_LIMITS_V1 } from "@cloudmarkup/job-framework";
import {
  asyncJobInputV1Schema,
  parseAsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  bytesOf,
  digestBytes,
  jobClaimSnapshotSchema,
  recordProjection,
  timestampColumn,
  verifyProjection,
} from "./async-job-repository-codec.js";

describe("durable async job lossless codec", () => {
  it.each([
    "2026-09-05 12:00:00",
    "2026-09-05 12:00:00.000000",
    "2026-09-05 12:00:00+00",
    "2026-09-05T08:00:00-04:00",
  ])("normalizes database timestamp %s without the host timezone", (value) => {
    expect(timestampColumn({ occurred_at: value }, "occurred_at")).toBe(
      "2026-09-05T12:00:00.000Z",
    );
    expect(() => {
      verifyProjection(
        { occurred_at: value },
        { occurred_at: "2026-09-05T12:00:00.000Z" },
      );
    }).not.toThrow();
  });
  it("rejects ambiguous unzoned ISO and malformed persisted times", () => {
    expect(() =>
      timestampColumn({ occurred_at: "2026-09-05T12:00:00" }, "occurred_at"),
    ).toThrow("could not be verified");
    expect(() =>
      timestampColumn({ occurred_at: "yesterday" }, "occurred_at"),
    ).toThrow("could not be verified");
  });
  it("preserves retry hints on the record separately from output metadata", () => {
    const at = "2026-09-05T12:00:00.000Z";
    const input = asyncJobInputV1Schema.parse({
      contractVersion: 1,
      family: "billing-usage-reconciliation",
      subject: { kind: "organization" },
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-09-02T00:00:00.000Z",
      batch: {
        contractVersion: 1,
        objectId: "batch-1",
        digest: hashCanonicalValue("batch"),
        mediaType: "application/json",
        purpose: "input-payload",
        sizeBytes: 128,
      },
    });
    const record = parseAsyncJobRecordV1({
      attempts: [],
      cancellation: { state: "none" },
      checkpoints: [],
      completedAt: at,
      contractVersion: 1,
      correlationId: "correlation-1",
      createdAt: at,
      family: input.family,
      failure: {
        classification: "transient",
        code: "job.rate-limited",
        publicMessage: "job-temporarily-unavailable",
        retryAfterSeconds: 71,
      },
      idempotency: {
        actorId: "principal-1",
        keyDigest: hashCanonicalValue("key"),
        operationId: "jobs.create",
        requestDigest: hashCanonicalValue("request"),
      },
      input,
      inputDigest: hashCanonicalValue(input),
      inputSizeBytes: bytesOf(input).length,
      interaction: { state: "none" },
      jobId: "job-1",
      limits: DEFAULT_JOB_LIMITS_V1,
      orchestration: {
        dependencyJobIds: [],
        expectedChildJobIds: [],
        failurePolicy: "fail-parent",
        rootJobId: "job-1",
      },
      ownership: { organizationId: "organization-1" },
      queuedAt: at,
      recordVersion: 1,
      reservation: { state: "none" },
      state: "failed",
      updatedAt: at,
    });
    const projection = recordProjection(
      record,
      {
        objectId: "input-1",
        digest: record.inputDigest,
        sizeBytes: record.inputSizeBytes,
      },
      null,
      "entitlement-1",
    );
    expect(projection["failure_retry_after_seconds"]).toBe(71);
    expect(projection["output_size_bytes"]).toBeNull();
    expect(projection["measured_output_size_bytes"]).toBeNull();
    expect(
      parseAsyncJobRecordV1(
        JSON.parse(new TextDecoder().decode(bytesOf(record))) as unknown,
      ),
    ).toEqual(record);
  });
  it("requires strict versioned claim snapshots rather than trusting arbitrary JSON", () => {
    expect(
      jobClaimSnapshotSchema.safeParse({
        claimedAt: "now",
        recordVersion: 1,
        unchecked: true,
      }).success,
    ).toBe(false);
  });
  it("checks timestamps and database bigint decoding while rejecting changed normalized authority", () => {
    expect(() => {
      verifyProjection(
        { created_at: new Date("2026-09-05T00:00:00Z"), record_version: "12" },
        { created_at: "2026-09-05T00:00:00Z", record_version: 12 },
      );
    }).not.toThrow();
    expect(() => {
      verifyProjection({ record_version: "13" }, { record_version: 12 });
    }).toThrow("could not be verified");
  });
  it("uses canonical UTF-8 bytes for independently verifiable snapshot digests", () => {
    const value = { label: "é", nested: { beta: 2, alpha: 1 } };
    expect(digestBytes(bytesOf(value))).toBe(hashCanonicalValue(value));
    expect(bytesOf(value)).toEqual(
      bytesOf({ nested: { alpha: 1, beta: 2 }, label: "é" }),
    );
  });
});
