import { sourceDraftExportRunFixture } from "./solution-export-run-test-helpers.js";
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createSolutionExportJobV1Schema } from "@cloudmarkup/api-contract";
import { solutionExportRequestIntentDigest } from "../../application/solution-exports.js";
import {
  EXPORT_ADMISSION_OPERATIONS as OP,
  exportAdmissionHash,
  exportAdmissionJobId,
  exportAdmissionKey,
  parseExportAdmissionRow,
  parseExportAdmissionSelection,
} from "./solution-export-admission-codec.js";
import { admissionSelectionFixture } from "./solution-export-admission-test-helpers.js";

describe("immutable public export admission metadata codec", () => {
  it("preserves the historical compact public digest separately from immutable-object serialization", () => {
    const request = createSolutionExportJobV1Schema.parse({
      contractVersion: 1,
      environment: { environmentType: "development" },
      exportName: "Example",
      solutionRevisionId: "solution.revision",
      targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
    });
    const input = {
      organizationId: "org.example",
      projectId: "project.example",
      request,
    };
    const compact =
      '{"contractVersion":1,"organizationId":"org.example","projectId":"project.example","request":{"contractVersion":1,"environment":{"environmentType":"development"},"exportName":"Example","solutionRevisionId":"solution.revision","targetProfileId":"cloudmarkup.export.terraform-nodejs24-v1"}}';
    expect(solutionExportRequestIntentDigest(input)).toBe(
      `sha256:${createHash("sha256").update(compact).digest("hex")}`,
    );
    expect(solutionExportRequestIntentDigest(input)).not.toBe(
      exportAdmissionHash({ contractVersion: 1, ...input }),
    );
  });
  it("clones the exact public selection and preserves source/baseline/digest identity", () => {
    const value = admissionSelectionFixture();
    const parsed = parseExportAdmissionSelection(value);
    expect(parsed).toEqual(value);
    expect(parsed.initialRecord).not.toBe(value.initialRecord);
    expect(exportAdmissionHash(parsed)).toBe(exportAdmissionHash(value));
    expect(parsed.initialRecord.requestIntentDigest).not.toBe(
      parsed.initialRecord.primaryInputDigest,
    );
  });
  it("separates tenant and generation job identities from the actual run sequence", () => {
    const value = admissionSelectionFixture();
    const identity = {
      organizationId: value.organizationId,
      projectId: value.projectId,
      primaryInputDigest: value.initialRecord.primaryInputDigest,
      admissionGeneration: 1,
    };
    const ids = [
      exportAdmissionJobId(identity),
      exportAdmissionJobId({ ...identity, organizationId: "org.other" }),
      exportAdmissionJobId({ ...identity, projectId: "project.other" }),
      exportAdmissionJobId({ ...identity, admissionGeneration: 2 }),
    ];
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => id.length <= 128)).toBe(true);
    const jobId = ids[3];
    const recovered = parseExportAdmissionSelection({
      ...value,
      admissionGeneration: 2,
      previousAdmission: {
        generation: 1,
        objectId: "object.previous-selection",
        digest: exportAdmissionHash(value),
      },
      initialRecord: {
        ...value.initialRecord,
        job: { ...value.initialRecord.job, id: jobId },
        workflowSubmission: {
          ...value.initialRecord.workflowSubmission,
          jobId,
        },
      },
    });
    expect(recovered.initialRecord.job.runSequence).toBe(1);
    expect(recovered.initialRecord.job.rerunOfJobId).toBeUndefined();
  });
  it.each([
    0,
    -1,
    1.5,
    "1",
    "01",
    Number.MAX_SAFE_INTEGER + 1,
    null,
    undefined,
  ])("denies invalid admission generation %s", (admissionGeneration) => {
    expect(() =>
      parseExportAdmissionSelection({
        ...admissionSelectionFixture(),
        admissionGeneration,
      }),
    ).toThrow();
  });
  it("rejects gaps, forged public request digests, lineage and actor changes", () => {
    const value = admissionSelectionFixture();
    for (const candidate of [
      { ...value, extra: true },
      { ...value, projectId: "project.other" },
      { ...value, createdByPrincipalId: "principal.other" },
      { ...value, admissionGeneration: 2, previousAdmission: null },
      {
        ...value,
        previousAdmission: {
          generation: 0,
          objectId: "object.previous",
          digest: exportAdmissionHash(value),
        },
      },
      {
        ...value,
        initialRecord: {
          ...value.initialRecord,
          requestIntentDigest: exportAdmissionHash("forged"),
        },
      },
      {
        ...value,
        initialRecord: {
          ...value.initialRecord,
          job: {
            ...value.initialRecord.job,
            runSequence: 2,
            rerunOfJobId: value.initialRecord.job.id,
          },
        },
      },
    ])
      expect(() => parseExportAdmissionSelection(candidate)).toThrow();
  });
  it("rejects executable descriptors, symbols and class input without invoking accessors", () => {
    const value = admissionSelectionFixture();
    const getter = vi.fn(() => 1);
    const accessor = { ...value };
    Object.defineProperty(accessor, "admissionGeneration", {
      enumerable: true,
      get: getter,
    });
    class Selection {
      readonly value = value;
    }
    for (const candidate of [
      accessor,
      { ...value, [Symbol("extra")]: true },
      new Selection(),
      {
        ...value,
        initialRecord: { ...value.initialRecord, extra: () => true },
      },
    ])
      expect(() => parseExportAdmissionSelection(candidate)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it("uses exact operation namespaces and caller-bound public aliases", () => {
    const value = admissionSelectionFixture();
    const fields = {
      organizationId: value.organizationId,
      principalId: value.createdByPrincipalId,
      publicKeyDigest: value.originalIdempotencyKeyDigest,
    };
    expect(exportAdmissionKey(OP.create, fields)).not.toBe(
      exportAdmissionKey(OP.cancel, fields),
    );
    expect(exportAdmissionKey(OP.create, fields)).not.toBe(
      exportAdmissionKey(OP.create, {
        ...fields,
        principalId: "principal.other",
      }),
    );
    expect(() => exportAdmissionKey(OP.primary, fields)).toThrow();
    expect(() =>
      exportAdmissionKey(OP.create, { ...fields, projectId: value.projectId }),
    ).toThrow();
    expect(() =>
      exportAdmissionKey(OP.create, { ...fields, publicKeyDigest: "bad" }),
    ).toThrow();
  });
  it("admits only non-expiring adapter-owned SQL lifecycle rows", () => {
    const value = admissionSelectionFixture();
    const row = {
      organization_id: value.organizationId,
      operation_name: OP.selection,
      idempotency_key_sha256: "a".repeat(64),
      request_sha256: "b".repeat(64),
      principal_id: value.createdByPrincipalId,
      resource_kind: "export-selection",
      resource_id: "object.selection",
      lifecycle_status: "in-progress",
      created_at: "2026-09-07T00:00:00.000Z",
      completed_at: null,
      expires_at: null,
    };
    expect(parseExportAdmissionRow(row).state).toBe("in-progress");
    expect(
      parseExportAdmissionRow({
        ...row,
        lifecycle_status: "completed",
        completed_at: row.created_at,
      }).state,
    ).toBe("completed");
    for (const change of [
      { lifecycle_status: "failed" },
      { expires_at: row.created_at },
      { operation_name: "other.v1" },
      { resource_kind: "solution-export-job" },
      { lifecycle_status: "completed" },
      { completed_at: row.created_at },
      { request_sha256: "A".repeat(64) },
    ])
      expect(() => parseExportAdmissionRow({ ...row, ...change })).toThrow();
  });
});

it("binds explicit source generation into durable admission replay and rejects a downgraded view", () => {
  const selection = admissionSelectionFixture(sourceDraftExportRunFixture());
  expect(
    parseExportAdmissionSelection(selection).initialRecord.job.target
      .applicationSource,
  ).toBe("ai-source-draft-v1");
  const tampered = structuredClone(selection);
  delete tampered.initialRecord.job.target.applicationSource;
  expect(() => parseExportAdmissionSelection(tampered)).toThrow();
});
