import {
  getAsyncJobCreateRequestDigestV1,
  getAsyncJobIdempotencyKeyDigestV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import type { CreateJobCommandV1 } from "@cloudmarkup/job-framework";
import {
  asyncJobCreateRequestV1Schema,
  asyncJobIdSchema,
  asyncJobIdempotencyClaimV1Schema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import type { StoredSolutionExportJob } from "./solution-exports.js";
import { createSolutionExportRunInsertionBindingV1 } from "./solution-export-persistence-binding.js";

/** Purpose-separated internal admission key. The caller's raw key is never persisted.
 * The public request-intent digest is deliberately not an AsyncJob create-request digest. */
export function solutionExportRootAdmissionCommand(
  record: StoredSolutionExportJob,
  publicKeyDigest: string,
): CreateJobCommandV1 {
  const binding = createSolutionExportRunInsertionBindingV1(
    record.workflowSubmission,
  );
  const key = `export-root:${hashCanonicalValue({
    contractVersion: 1,
    organizationId: record.organizationId,
    projectId: record.job.projectId,
    principalId: record.createdByPrincipalId,
    publicKeyDigest: sha256DigestSchema.parse(publicKeyDigest),
  }).slice(7)}`;
  const request = asyncJobCreateRequestV1Schema.parse({
    contractVersion: 1,
    idempotencyKey: key,
    input: binding.orchestrationInput,
    inputSizeBytes: getAsyncJobInputSizeBytesV1(binding.orchestrationInput),
  });
  return {
    request,
    preallocatedJobId: asyncJobIdSchema.parse(record.job.id),
    inputDigest: getAsyncJobInputDigestV1(request.input),
    idempotency: asyncJobIdempotencyClaimV1Schema.parse({
      actorId: record.createdByPrincipalId,
      operationId: "solution-export-jobs.create",
      keyDigest: getAsyncJobIdempotencyKeyDigestV1(key),
      requestDigest: getAsyncJobCreateRequestDigestV1(request),
    }),
  };
}
