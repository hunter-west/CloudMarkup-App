import { createHash } from "node:crypto";

import {
  asyncJobDurableInputReferenceV1Schema,
  serializeCanonicalJson,
  sha256DigestSchema,
  solutionExportOrchestrationJobInputV1Schema,
  type SolutionExportOrchestrationJobInputV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  solutionExportWorkflowRequestDigest,
  solutionExportWorkflowRequestV1Schema,
  type SolutionExportWorkflowRequestV1,
} from "@cloudmarkup/solution-export-workflow/contracts";

import {
  solutionExportPrimaryInputDigest,
  type SolutionExportWorkflowEnqueueV1,
} from "./solution-exports.js";

const SQL_SHA256_HEX = /^[0-9a-f]{64}$/;
export type SqlSha256Hex = string & { readonly __brand: "SqlSha256Hex" };

const encoder = new TextEncoder();

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(serializeCanonicalJson(value));
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalBytes(value)).digest("hex")}`;
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

/** Convert the public `sha256:<hex>` wire form to the SQL CHAR(64) form. */
export function sha256DigestToSqlHex(digest: Sha256Digest): SqlSha256Hex {
  const parsed = sha256DigestSchema.parse(digest);
  return parsed.slice("sha256:".length) as SqlSha256Hex;
}

/** Convert the SQL CHAR(64) form back to the strict public digest type. */
export function sqlHexToSha256Digest(value: string): Sha256Digest {
  if (!SQL_SHA256_HEX.test(value)) {
    throw new TypeError(
      "SQL SHA-256 values must be exactly 64 lowercase hex characters.",
    );
  }
  return sha256DigestSchema.parse(`sha256:${value}`);
}

export interface SolutionExportRunSqlDigestBindingV1 {
  readonly orchestrationInputSha256: SqlSha256Hex;
  readonly primaryInputSha256: SqlSha256Hex;
  readonly requestSha256: SqlSha256Hex;
  readonly targetSettingsSha256: SqlSha256Hex;
}

export interface SolutionExportRunInsertionBindingCandidateV1 {
  readonly organizationId: string;
  readonly orchestrationInput: unknown;
  readonly orchestrationInputReference: unknown;
  readonly primaryInputSha256: unknown;
  readonly projectId: string;
  readonly workflowRequest: unknown;
  readonly workflowRequestReference: unknown;
}

export interface ValidatedSolutionExportRunInsertionBindingV1 {
  readonly orchestrationInput: SolutionExportOrchestrationJobInputV1;
  readonly orchestrationInputObjectId: string;
  readonly orchestrationInputSha256: Sha256Digest;
  readonly primaryInputSha256: Sha256Digest;
  readonly requestSha256: Sha256Digest;
  readonly sqlDigests: SolutionExportRunSqlDigestBindingV1;
  readonly targetSettingsSha256: Sha256Digest;
  readonly workflowRequest: SolutionExportWorkflowRequestV1;
  readonly workflowRequestObjectId: string;
}

/**
 * Concrete fail-closed boundary used before a durable export-run insertion.
 * SQL independently rechecks object metadata and relational commitments.
 */
export function validateSolutionExportRunInsertionBindingV1(
  candidate: SolutionExportRunInsertionBindingCandidateV1,
): ValidatedSolutionExportRunInsertionBindingV1 {
  const orchestrationInput = solutionExportOrchestrationJobInputV1Schema.parse(
    candidate.orchestrationInput,
  );
  const orchestrationInputReference =
    asyncJobDurableInputReferenceV1Schema.parse(
      candidate.orchestrationInputReference,
    );
  const workflowRequest = solutionExportWorkflowRequestV1Schema.parse(
    candidate.workflowRequest,
  );
  const workflowRequestReference = asyncJobDurableInputReferenceV1Schema.parse(
    candidate.workflowRequestReference,
  );
  const orchestrationInputDigest = digest(orchestrationInput);
  const requestDigest = solutionExportWorkflowRequestDigest(workflowRequest);
  const primaryInputDigest = solutionExportPrimaryInputDigest({
    organizationId: candidate.organizationId,
    projectId: candidate.projectId,
    request: workflowRequest,
  });
  const suppliedPrimaryInputDigest = sha256DigestSchema.parse(
    candidate.primaryInputSha256,
  );

  if (
    orchestrationInputReference.mediaType !== "application/json" ||
    orchestrationInputReference.digest !== orchestrationInputDigest ||
    suppliedPrimaryInputDigest !== primaryInputDigest ||
    orchestrationInputReference.sizeBytes !==
      canonicalBytes(orchestrationInput).byteLength ||
    workflowRequestReference.mediaType !== "application/json" ||
    workflowRequestReference.digest !== requestDigest ||
    workflowRequestReference.sizeBytes !==
      canonicalBytes(workflowRequest).byteLength ||
    !equalCanonical(orchestrationInput.request, workflowRequestReference) ||
    orchestrationInput.targetProfileId !== workflowRequest.targetProfileId ||
    orchestrationInput.targetSettingsDigest !==
      workflowRequest.targetSettings.digest ||
    !equalCanonical(
      orchestrationInput.environment,
      workflowRequest.environment,
    ) ||
    !equalCanonical(orchestrationInput.subject, workflowRequest.subject)
  ) {
    throw new Error(
      "Solution export orchestration input does not match its exact workflow request binding.",
    );
  }

  return {
    orchestrationInput,
    orchestrationInputObjectId: orchestrationInputReference.objectId,
    orchestrationInputSha256: orchestrationInputReference.digest,
    primaryInputSha256: primaryInputDigest,
    requestSha256: requestDigest,
    sqlDigests: {
      orchestrationInputSha256: sha256DigestToSqlHex(
        orchestrationInputReference.digest,
      ),
      primaryInputSha256: sha256DigestToSqlHex(primaryInputDigest),
      requestSha256: sha256DigestToSqlHex(requestDigest),
      targetSettingsSha256: sha256DigestToSqlHex(
        workflowRequest.targetSettings.digest,
      ),
    },
    targetSettingsSha256: workflowRequest.targetSettings.digest,
    workflowRequest,
    workflowRequestObjectId: workflowRequestReference.objectId,
  };
}

export function createSolutionExportRunInsertionBindingV1(
  submission: SolutionExportWorkflowEnqueueV1,
): ValidatedSolutionExportRunInsertionBindingV1 {
  const workflowRequestBytes = canonicalBytes(submission.request);
  const workflowRequestReference = asyncJobDurableInputReferenceV1Schema.parse({
    contractVersion: 1,
    digest: submission.requestDigest,
    mediaType: "application/json",
    objectId: `object.solution-export-request.${submission.jobId}`,
    purpose: "input-payload",
    sizeBytes: workflowRequestBytes.byteLength,
  });
  const orchestrationInput = solutionExportOrchestrationJobInputV1Schema.parse({
    contractVersion: 1,
    environment: submission.request.environment,
    family: "solution-export-orchestration",
    request: workflowRequestReference,
    subject: submission.request.subject,
    targetProfileId: submission.request.targetProfileId,
    targetSettingsDigest: submission.request.targetSettings.digest,
  });
  const orchestrationInputBytes = canonicalBytes(orchestrationInput);
  const orchestrationInputReference =
    asyncJobDurableInputReferenceV1Schema.parse({
      contractVersion: 1,
      digest: digest(orchestrationInput),
      mediaType: "application/json",
      objectId: `object.solution-export-orchestration.${submission.jobId}`,
      purpose: "input-payload",
      sizeBytes: orchestrationInputBytes.byteLength,
    });
  return validateSolutionExportRunInsertionBindingV1({
    organizationId: submission.organizationId,
    orchestrationInput,
    orchestrationInputReference,
    primaryInputSha256: submission.primaryInputDigest,
    projectId: submission.projectId,
    workflowRequest: submission.request,
    workflowRequestReference,
  });
}
