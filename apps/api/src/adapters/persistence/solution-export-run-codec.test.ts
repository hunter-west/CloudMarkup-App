import { describe, expect, it } from "vitest";
import { exportRunFixture } from "./solution-export-run-test-helpers.js";
import {
  exportRunFields,
  exportRunInteger,
  exportRunTimestamp,
  immutableExportRun,
  parsePreparedExportRun,
  parseStoredExportRun,
  verifyExportRunProjection,
} from "./solution-export-run-codec.js";

describe("prepared target-bound export journal codec", () => {
  it("roundtrips the strict immutable queued checkpoint and Data API integer projections", () => {
    const fixture = exportRunFixture();
    const record = parsePreparedExportRun(fixture.record);
    expect(record).toEqual(fixture.record);
    const projection = {
      ...exportRunFields(record, fixture.idempotencyKeyDigest),
      run_sequence: "1",
      progress_completed_stages: "1",
      record_version: "2",
      completed_at: null,
      cancellation_acknowledged_at: null,
    };
    expect(() => {
      verifyExportRunProjection(projection, record);
    }).not.toThrow();
    expect(() => {
      verifyExportRunProjection(
        { ...projection, project_id: "project.other" },
        record,
      );
    }).toThrow();
    expect(exportRunTimestamp(record.job.createdAt)).toBe(record.job.createdAt);
  });
  it("roundtrips CloudFormation with exact persisted settings, job and SQL profile parity", () => {
    const f = exportRunFixture("cloudformation");
    expect(parsePreparedExportRun(f.record)).toEqual(f.record);
    expect(parseStoredExportRun(f.record)).toEqual(f.record);
    const fields = {
      ...exportRunFields(f.record, f.idempotencyKeyDigest),
      record_version: 1,
    };
    expect(() => {
      verifyExportRunProjection(fields, f.record);
    }).not.toThrow();
    expect(() => {
      verifyExportRunProjection(
        {
          ...fields,
          target_profile_id: "cloudmarkup.export.terraform-nodejs24-v1",
        },
        f.record,
      );
    }).toThrow();
    const changed = structuredClone(f.record);
    changed.workflowSubmission.request.targetSettings =
      exportRunFixture().record.workflowSubmission.request.targetSettings;
    expect(() => parsePreparedExportRun(changed)).toThrow();
  });
  it.each([
    0,
    -1,
    1.5,
    "01",
    "+1",
    "1e2",
    "9007199254740993",
    Number.NaN,
    undefined,
  ])("rejects unsafe or noncanonical integers %s", (value) => {
    expect(() => exportRunInteger(value)).toThrow();
  });
  it.each([1, "1", 1n])("accepts checked positive SQL integers %s", (value) => {
    expect(exportRunInteger(value)).toBe(1);
  });
  it("rejects non-UTC timestamps and impossible ISO dates", () => {
    for (const value of [
      "2026-09-06 00:00:00+00",
      "2026-02-31T00:00:00.000Z",
      "2026-09-06T00:00:00.000-04:00",
    ])
      expect(() => exportRunTimestamp(value)).toThrow();
  });
  it("does not silently project unsupported diagram stage, substituted target, terminal or completed-eight values into historical SQL", () => {
    const { record } = exportRunFixture();
    const candidates = [
      {
        ...record,
        targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
      },
      {
        ...record,
        job: {
          ...record.job,
          progress: {
            ...record.job.progress,
            currentStage: "diagram-rendering",
          },
        },
      },
      {
        ...record,
        job: {
          ...record.job,
          progress: { ...record.job.progress, completedStages: 8 },
        },
      },
      {
        ...record,
        job: {
          ...record.job,
          state: "failed",
          completedAt: record.job.createdAt,
        },
      },
    ];
    for (const candidate of candidates)
      expect(() => parsePreparedExportRun(candidate)).toThrow();
  });
  it("rejects unknown fields and mismatched scope, creator, source and target commitments", () => {
    const { record } = exportRunFixture();
    for (const candidate of [
      { ...record, unexpected: true },
      { ...record, organizationId: "organization.other" },
      { ...record, createdByPrincipalId: "principal.other" },
      { ...record, job: { ...record.job, projectId: "project.other" } },
      {
        ...record,
        job: {
          ...record.job,
          target: { ...record.job.target, exportName: "Different export" },
        },
      },
      {
        ...record,
        job: {
          ...record.job,
          solutionRevision: {
            ...record.job.solutionRevision,
            manifestRecordId: "record.other",
          },
        },
      },
    ])
      expect(() => parsePreparedExportRun(candidate)).toThrow();
  });
  it("only separates mutable polling state; coverage and immutable creation stay fenced", () => {
    const { record } = exportRunFixture();
    expect(
      immutableExportRun({
        ...record,
        job: {
          ...record.job,
          updatedAt: new Date().toISOString(),
          state: "running",
        },
      }),
    ).toEqual(immutableExportRun(record));
    expect(
      immutableExportRun({
        ...record,
        requestIntentDigest: `sha256:${"a".repeat(64)}`,
      }),
    ).not.toEqual(immutableExportRun(record));
  });
});
