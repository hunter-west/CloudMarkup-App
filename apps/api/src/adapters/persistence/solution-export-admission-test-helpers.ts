import { createSolutionExportJobV1Schema } from "@cloudmarkup/api-contract";
import {
  solutionExportRequestIntentDigest,
  type StoredSolutionExportJob,
} from "../../application/solution-exports.js";
import { exportRunFixture } from "./solution-export-run-test-helpers.js";
import {
  exportAdmissionJobId,
  parseExportAdmissionSelection,
  type ExportAdmissionSelectionV1,
} from "./solution-export-admission-codec.js";

/** Rebind only the synthetic fixture's public request digest; no durable authority is invented. */
export function publicAdmissionRecord(
  record: StoredSolutionExportJob,
): StoredSolutionExportJob {
  const request = createSolutionExportJobV1Schema.parse({
    contractVersion: 1,
    solutionRevisionId: record.job.solutionRevision.solutionRevisionId,
    environment: record.job.target.environment,
    exportName: record.job.target.exportName,
    targetProfileId: record.targetProfileId,
    diagram: record.job.target.diagram,
    ...(record.job.target.applicationSource === undefined
      ? {}
      : { applicationSource: record.job.target.applicationSource }),
  });
  return {
    ...record,
    requestIntentDigest: solutionExportRequestIntentDigest({
      organizationId: record.organizationId,
      projectId: record.job.projectId,
      request,
    }),
  };
}

export function admissionSelectionFixture(
  fixture = exportRunFixture(),
): ExportAdmissionSelectionV1 {
  const record = publicAdmissionRecord(fixture.record);
  const jobId = exportAdmissionJobId({
    organizationId: record.organizationId,
    projectId: record.job.projectId,
    primaryInputDigest: record.primaryInputDigest,
    admissionGeneration: 1,
  });
  return parseExportAdmissionSelection({
    contractVersion: 1,
    organizationId: record.organizationId,
    projectId: record.job.projectId,
    createdByPrincipalId: record.createdByPrincipalId,
    originalIdempotencyKeyDigest: fixture.idempotencyKeyDigest,
    admissionGeneration: 1,
    previousAdmission: null,
    initialRecord: {
      ...record,
      job: { ...record.job, id: jobId },
      workflowSubmission: { ...record.workflowSubmission, jobId },
    },
  });
}
