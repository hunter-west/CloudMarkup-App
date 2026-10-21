import {
  asyncJobIdSchema,
  asyncJobOrganizationIdSchema,
  asyncJobTrustedOwnershipV1Schema,
  evidenceRecordV1Schema,
  semanticVersionSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  projectGoCompilationResultToSolutionExportInfrastructure,
  cloudFormationValidationReportDigest,
  validateCloudFormationInfrastructure,
} from "@cloudmarkup/solution-export-workflow";
import type { SolutionRecordRepository } from "../../application/solution-record-persistence.js";
import { exportRunFixture } from "./solution-export-run-test-helpers.js";
import { exportRunBytes, exportRunSha } from "./solution-export-run-codec.js";
import { exportScope } from "./solution-export-artifact-test-helpers.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { SolutionExportWorkflowStorage } from "./solution-export-workflow-storage.js";
import { SolutionExportWorkflowObjects } from "./solution-export-workflow-objects.js";

function fixture(target: "terraform" | "cloudformation" = "cloudformation") {
  const f = exportRunFixture(target);
  const cfn =
    target === "cloudformation" ? f : exportRunFixture("cloudformation");
  const settings = cfn.record.workflowSubmission.request.targetSettings;
  if (settings.target !== "cloudformation")
    throw new Error("Expected CloudFormation fixture.");
  const report = validateCloudFormationInfrastructure({
    infrastructure: projectGoCompilationResultToSolutionExportInfrastructure(
      cfn.source.compilation,
    ),
    now: cfn.record.job.createdAt,
    request: cfn.record.workflowSubmission.request,
    settings: settings.stageDescriptors.cloudFormationValidation,
  });
  const ownership = {
    organizationId: f.record.organizationId,
    projectId: f.record.job.projectId,
  };
  const scope = {
    ...exportScope(),
    ...ownership,
    principalId: f.principal.principalId,
  };
  const storage = new SolutionExportWorkflowStorage(
    {
      ownership,
      permission: "exports.run",
      scope: () => Promise.resolve(scope),
      query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    },
    new InMemoryObjectStore(),
  );
  const put = vi
    .spyOn(storage, "put")
    .mockImplementation((bytes, purpose, mediaType) =>
      Promise.resolve({
        objectId: storage.identity(purpose, {
          digest: exportRunSha(bytes),
          mediaType,
        }),
        owner: ownership,
        purpose,
        mediaType,
        contentSha256: exportRunSha(bytes),
        sizeBytes: bytes.length,
        storageProvider: "memory",
        storageKey: "synthetic",
        objectVersion: "version.synthetic",
      }),
    );
  const create = vi.fn<SolutionRecordRepository["create"]>(
    (scope, input, object) =>
      Promise.resolve({
        ...input,
        organizationId: scope.organizationId,
        contentObjectId: object.objectId,
        createdAt: f.record.job.createdAt,
        createdByPrincipalId: scope.principalId,
      }),
  );
  const records: SolutionRecordRepository = {
    create,
    get: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
  };
  const objects = new SolutionExportWorkflowObjects(
    storage,
    {
      ...ownership,
      jobId: f.record.job.id,
      actorId: f.principal.principalId,
      attemptId: "attempt.synthetic",
      attemptNumber: 1,
      workerId: "worker.synthetic",
      inputDigest: f.binding.orchestrationInputSha256,
    },
    f.record,
    records,
  );
  const input = {
    scope: {
      jobId: asyncJobIdSchema.parse(f.record.job.id),
      ownership: asyncJobTrustedOwnershipV1Schema.parse(ownership),
    },
    stage: "validate-infrastructure" as const,
    report,
    digest: report.reportDigest,
    evidenceRecords: report.evidenceRecords,
  };
  return { f, objects, put, create, input, report };
}

describe("durable CloudFormation local validation projection", () => {
  it("retains the exact canonical report and target-specific artifact kind with revision-bound evidence", async () => {
    const f = fixture();
    const saved = await f.objects.persistStageReport(f.input);
    expect(saved.artifact.kind).toBe("cloudformation-validation-report");
    expect(saved.artifact.digest).toBe(f.report.reportDigest);
    expect(f.put.mock.calls[0]).toEqual([
      exportRunBytes({
        diagnostics: f.report.diagnostics,
        target: f.report.target,
        validation: f.report.validation,
      }),
      "validation-report",
      "application/json",
    ]);
    expect(saved.evidenceRecords[0]?.evidenceId).toBe(
      f.report.evidenceRecords[0]?.id,
    );
    expect(f.create).toHaveBeenCalledOnce();
  });
  it("rejects a CloudFormation report in a Terraform job", async () => {
    const f = fixture("terraform");
    await expect(f.objects.persistStageReport(f.input)).rejects.toThrow();
    expect(f.put).not.toHaveBeenCalled();
  });
  it("rejects altered report bytes and substituted evidence before storage", async () => {
    const f = fixture();
    await expect(
      f.objects.persistStageReport({
        ...f.input,
        report: {
          ...f.report,
          validation: { ...f.report.validation, resourceCount: 1 },
        },
      }),
    ).rejects.toThrow();
    await expect(
      f.objects.persistStageReport({ ...f.input, evidenceRecords: [] }),
    ).rejects.toThrow();
    expect(f.put).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("rejects a recomputed report from an unselected validator", async () => {
    const f = fixture();
    const changed = {
      ...f.report,
      validation: {
        ...f.report.validation,
        validator: {
          ...f.report.validation.validator,
          version: semanticVersionSchema.parse("9.0.0"),
        },
      },
    };
    const reportDigest = cloudFormationValidationReportDigest(changed);
    await expect(
      f.objects.persistStageReport({
        ...f.input,
        report: { ...changed, reportDigest },
        digest: reportDigest,
      }),
    ).rejects.toThrow();
    expect(f.put).not.toHaveBeenCalled();
  });
  it("rejects a foreign tenant scope before storage", async () => {
    const f = fixture();
    await expect(
      f.objects.persistStageReport({
        ...f.input,
        scope: {
          ...f.input.scope,
          ownership: {
            ...f.input.scope.ownership,
            organizationId: asyncJobOrganizationIdSchema.parse("org.foreign"),
          },
        },
      }),
    ).rejects.toThrow();
    expect(f.put).not.toHaveBeenCalled();
  });
  it("rejects evidence for a different revision or environment", async () => {
    for (const changed of [
      { solutionRevisionId: "solutionrevision.other" },
      { environment: { environmentType: "production" as const } },
    ]) {
      const f = fixture();
      const evidenceRecords = f.report.evidenceRecords.map((record) =>
        evidenceRecordV1Schema.parse({ ...record, ...changed }),
      );
      await expect(
        f.objects.persistStageReport({
          ...f.input,
          report: { ...f.report, evidenceRecords },
          evidenceRecords,
        }),
      ).rejects.toThrow();
      expect(f.create).not.toHaveBeenCalled();
    }
  });
});
