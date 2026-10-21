import { z } from "zod";

import {
  draftIdSchema,
  namespacedIdentifierSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { environmentTypeSchema } from "./intent-document-v1.js";
import {
  evidenceIdSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
} from "./solution-contract-common-v1.js";

/**
 * Absolute contract ceilings. Deployments may configure lower limits through
 * {@link asyncJobLimitsV1Schema}, but no adapter may raise these without a new
 * contract version.
 */
export const ASYNC_JOB_V1_HARD_LIMITS = Object.freeze({
  artifactCount: 256,
  attemptCount: 10,
  checkpointBytes: 268_435_456,
  checkpointCount: 1_024,
  inlineInputBytes: 65_536,
  outputBytes: 2_147_483_648,
  referencedInputBytes: 2_147_483_648,
  runtimeSeconds: 86_400,
} as const);

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const strongEtagPattern = /^"[A-Za-z0-9._:-]{1,120}"$/;
const exactCommitShaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const printableIdempotencyKeyPattern = /^[\x21-\x7e]{1,128}$/;
const transitionCursorPattern = /^[A-Za-z0-9_-]{1,256}$/;

const opaqueIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");

export const asyncJobIdSchema = opaqueIdSchema.brand<"AsyncJobId">();
export const asyncJobAttemptIdSchema =
  opaqueIdSchema.brand<"AsyncJobAttemptId">();
export const asyncJobCheckpointIdSchema =
  opaqueIdSchema.brand<"AsyncJobCheckpointId">();
export const asyncJobInteractionIdSchema =
  opaqueIdSchema.brand<"AsyncJobInteractionId">();
export const asyncJobArtifactIdSchema =
  opaqueIdSchema.brand<"AsyncJobArtifactId">();
export const asyncJobAuditEventIdSchema =
  opaqueIdSchema.brand<"AsyncJobAuditEventId">();
export const asyncJobWorkerIdSchema =
  opaqueIdSchema.brand<"AsyncJobWorkerId">();
export const asyncJobCorrelationIdSchema =
  opaqueIdSchema.brand<"AsyncJobCorrelationId">();
export const asyncJobOrganizationIdSchema =
  opaqueIdSchema.brand<"AsyncJobOrganizationId">();
export const asyncJobProjectIdSchema =
  opaqueIdSchema.brand<"AsyncJobProjectId">();

export const asyncJobFamilyV1Schema = z.enum([
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

export const asyncJobStateV1Schema = z.enum([
  "queued",
  "running",
  "awaiting-user-input",
  "succeeded",
  "failed",
  "canceled",
  "expired",
  "superseded",
]);

export const asyncJobTerminalStateV1Schema = z.enum([
  "succeeded",
  "failed",
  "canceled",
  "expired",
  "superseded",
]);

export const asyncJobObjectPurposeV1Schema = z.enum([
  "input-payload",
  "checkpoint-state",
  "proposal",
  "generated-source",
  "build-output",
  "validation-report",
  "diagram",
  "export-package",
  "repository-export-receipt",
  "plan-result",
  "deployment-result",
  "smoke-integration-result",
  "drift-result",
  "billing-reconciliation-result",
  "evidence",
]);

/**
 * A durable object-store reference, never a URL, storage key, credential, or
 * inline body. Authorization and tenant ownership are re-established by the
 * adapter that resolves objectId.
 */
export const asyncJobObjectReferenceV1Schema = z
  .object({
    contractVersion: z.literal(1),
    digest: sha256DigestSchema,
    expiresAt: utcTimestampSchema.optional(),
    mediaType: z.string().min(1).max(128),
    objectId: opaqueIdSchema,
    purpose: asyncJobObjectPurposeV1Schema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(ASYNC_JOB_V1_HARD_LIMITS.outputBytes),
  })
  .strict();

export const asyncJobArtifactAvailabilityV1Schema = z.discriminatedUnion(
  "state",
  [
    z.object({ state: z.literal("available") }).strict(),
    z
      .object({
        expiredAt: utcTimestampSchema,
        state: z.literal("expired"),
      })
      .strict(),
  ],
);

export const asyncJobArtifactReferenceV1Schema = z
  .object({
    artifactId: asyncJobArtifactIdSchema,
    availability: asyncJobArtifactAvailabilityV1Schema,
    object: asyncJobObjectReferenceV1Schema,
  })
  .strict();

export const asyncJobEnvironmentV1Schema = z
  .object({
    environmentId: solutionStableIdSchema.optional(),
    environmentType: z.union([environmentTypeSchema, z.literal("unknown")]),
  })
  .strict();

export const asyncJobEvidenceReferenceV1Schema = z
  .object({
    environment: asyncJobEnvironmentV1Schema,
    evidenceId: evidenceIdSchema,
    record: asyncJobObjectReferenceV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.record.expiresAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Evidence record references cannot expire.",
        path: ["record", "expiresAt"],
      });
    }
    if (value.record.purpose !== "evidence") {
      context.addIssue({
        code: "custom",
        message: "Evidence output must use an evidence object reference.",
        path: ["record", "purpose"],
      });
    }
  });

export const asyncJobDraftSubjectV1Schema = z
  .object({
    contentDigest: sha256DigestSchema,
    draftId: draftIdSchema,
    draftVersion: z.number().int().positive(),
    etag: z.string().regex(strongEtagPattern, "Must be a bounded strong ETag."),
    kind: z.literal("draft"),
  })
  .strict();

export const asyncJobSolutionRevisionSubjectV1Schema = z
  .object({
    kind: z.literal("solution-revision"),
    manifestDigest: sha256DigestSchema,
    manifestRecordId: solutionStableIdSchema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict();

/** Organization identity is deliberately absent; trusted ownership carries it. */
export const asyncJobOrganizationSubjectV1Schema = z
  .object({ kind: z.literal("organization") })
  .strict();

export const asyncJobSubjectV1Schema = z.discriminatedUnion("kind", [
  asyncJobDraftSubjectV1Schema,
  asyncJobSolutionRevisionSubjectV1Schema,
  asyncJobOrganizationSubjectV1Schema,
]);

const inputObjectReferenceV1Schema = asyncJobObjectReferenceV1Schema
  .extend({ purpose: z.literal("input-payload") })
  .strict();

export const asyncJobDurableInputReferenceV1Schema =
  inputObjectReferenceV1Schema.omit({ expiresAt: true }).strict();

const namedProfileIdSchema = namespacedIdentifierSchema;

export const intentExtractionJobInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    family: z.literal("intent-extraction"),
    source: inputObjectReferenceV1Schema,
    subject: asyncJobDraftSubjectV1Schema,
  })
  .strict();

export const architectureProposalJobInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    currentArchitecture: inputObjectReferenceV1Schema.optional(),
    family: z.literal("architecture-proposal"),
    intentDocument: inputObjectReferenceV1Schema,
    request: inputObjectReferenceV1Schema.optional(),
    subject: asyncJobDraftSubjectV1Schema,
  })
  .strict();

export const workloadContractProposalJobInputV1Schema = z
  .object({
    architecture: inputObjectReferenceV1Schema,
    contractVersion: z.literal(1),
    currentWorkload: inputObjectReferenceV1Schema.optional(),
    family: z.literal("workload-contract-proposal"),
    request: inputObjectReferenceV1Schema.optional(),
    subject: asyncJobDraftSubjectV1Schema,
  })
  .strict();

export const graphWorkloadOperationProposalJobInputV1Schema = z
  .object({
    architecture: inputObjectReferenceV1Schema,
    contractVersion: z.literal(1),
    family: z.literal("graph-workload-operation-proposal"),
    request: inputObjectReferenceV1Schema,
    subject: asyncJobDraftSubjectV1Schema,
    workload: inputObjectReferenceV1Schema.optional(),
  })
  .strict();

export const iacCompilationJobInputV1Schema = z
  .object({
    compilerTargetId: namedProfileIdSchema,
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    family: z.literal("iac-compilation"),
    subject: asyncJobSolutionRevisionSubjectV1Schema,
  })
  .strict();

export const applicationSourceGenerationJobInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    family: z.literal("application-source-generation"),
    generatorTargetId: namedProfileIdSchema,
    subject: asyncJobSolutionRevisionSubjectV1Schema,
  })
  .strict();

export const applicationBuildTestPackageJobInputV1Schema = z
  .object({
    buildProfileId: namedProfileIdSchema,
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    family: z.literal("application-build-test-package"),
    source: inputObjectReferenceV1Schema,
    subject: asyncJobSolutionRevisionSubjectV1Schema,
  })
  .strict();

export const staticValidationJobInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    family: z.literal("static-validation"),
    inputs: z.array(inputObjectReferenceV1Schema).max(32),
    subject: z.union([
      asyncJobDraftSubjectV1Schema,
      asyncJobSolutionRevisionSubjectV1Schema,
    ]),
    validationProfileId: namedProfileIdSchema,
  })
  .strict();

export const diagramRenderingJobInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    family: z.literal("diagram-rendering"),
    format: z.enum(["svg", "png", "pdf"]),
    rendererTargetId: namedProfileIdSchema,
    subject: asyncJobSolutionRevisionSubjectV1Schema,
  })
  .strict();

export const combinedExportPackagingJobInputV1Schema = z
  .object({
    artifacts: z
      .array(inputObjectReferenceV1Schema)
      .min(1)
      .max(ASYNC_JOB_V1_HARD_LIMITS.artifactCount),
    contractVersion: z.literal(1),
    family: z.literal("combined-export-packaging"),
    packageFormat: z.literal("zip"),
    subject: asyncJobSolutionRevisionSubjectV1Schema,
  })
  .strict();

export const solutionExportOrchestrationJobInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    family: z.literal("solution-export-orchestration"),
    request: asyncJobDurableInputReferenceV1Schema
      .extend({ mediaType: z.literal("application/json") })
      .strict(),
    subject: asyncJobSolutionRevisionSubjectV1Schema,
    targetProfileId: namedProfileIdSchema,
    targetSettingsDigest: sha256DigestSchema,
  })
  .strict();

export const gitHubRepositoryTargetV1Schema = z
  .object({
    branch: z.string().min(1).max(255),
    expectedBaseCommit: z
      .string()
      .regex(
        exactCommitShaPattern,
        "Must be an exact lowercase Git commit SHA.",
      )
      .optional(),
    integrationId: opaqueIdSchema,
    name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
    owner: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  })
  .strict();

export const gitHubRepositoryExportJobInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    family: z.literal("github-repository-export"),
    package: inputObjectReferenceV1Schema,
    subject: asyncJobSolutionRevisionSubjectV1Schema,
    target: gitHubRepositoryTargetV1Schema,
  })
  .strict();

const evidenceJobInputBaseShape = {
  contractVersion: z.literal(1),
  environment: asyncJobEnvironmentV1Schema,
  subject: asyncJobSolutionRevisionSubjectV1Schema,
  targetId: namedProfileIdSchema,
};

export const customerOwnedPlanEvidenceJobInputV1Schema = z
  .object({
    ...evidenceJobInputBaseShape,
    family: z.literal("customer-owned-plan-evidence"),
  })
  .strict();

export const deploymentEvidenceJobInputV1Schema = z
  .object({
    ...evidenceJobInputBaseShape,
    family: z.literal("deployment-evidence"),
    planEvidenceId: evidenceIdSchema,
  })
  .strict();

export const smokeIntegrationEvidenceJobInputV1Schema = z
  .object({
    ...evidenceJobInputBaseShape,
    family: z.literal("smoke-integration-evidence"),
    suiteIds: z.array(namedProfileIdSchema).min(1).max(64),
  })
  .strict();

export const driftEvidenceJobInputV1Schema = z
  .object({
    ...evidenceJobInputBaseShape,
    family: z.literal("drift-evidence"),
  })
  .strict();

export const billingUsageReconciliationJobInputV1Schema = z
  .object({
    batch: inputObjectReferenceV1Schema,
    contractVersion: z.literal(1),
    family: z.literal("billing-usage-reconciliation"),
    periodEnd: utcTimestampSchema,
    periodStart: utcTimestampSchema,
    subject: asyncJobOrganizationSubjectV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.periodEnd <= value.periodStart) {
      context.addIssue({
        code: "custom",
        message: "Reconciliation periodEnd must follow periodStart.",
        path: ["periodEnd"],
      });
    }
  });

export const asyncJobInputV1Schema = z.discriminatedUnion("family", [
  intentExtractionJobInputV1Schema,
  architectureProposalJobInputV1Schema,
  workloadContractProposalJobInputV1Schema,
  graphWorkloadOperationProposalJobInputV1Schema,
  iacCompilationJobInputV1Schema,
  applicationSourceGenerationJobInputV1Schema,
  applicationBuildTestPackageJobInputV1Schema,
  staticValidationJobInputV1Schema,
  diagramRenderingJobInputV1Schema,
  combinedExportPackagingJobInputV1Schema,
  solutionExportOrchestrationJobInputV1Schema,
  gitHubRepositoryExportJobInputV1Schema,
  customerOwnedPlanEvidenceJobInputV1Schema,
  deploymentEvidenceJobInputV1Schema,
  smokeIntegrationEvidenceJobInputV1Schema,
  driftEvidenceJobInputV1Schema,
  billingUsageReconciliationJobInputV1Schema,
]);

const proposalReferenceV1Schema = asyncJobObjectReferenceV1Schema.refine(
  (reference) => reference.purpose === "proposal",
  "Proposal output must use a proposal object reference.",
);

function artifactForPurpose(
  purpose: z.output<typeof asyncJobObjectPurposeV1Schema>,
) {
  return asyncJobArtifactReferenceV1Schema.refine(
    (artifact) => artifact.object.purpose === purpose,
    `Artifact must use the ${purpose} purpose.`,
  );
}

const noEvidenceReferencesSchema = z
  .array(asyncJobEvidenceReferenceV1Schema)
  .max(0);
const boundedEvidenceReferencesSchema = z
  .array(asyncJobEvidenceReferenceV1Schema)
  .max(32);
const requiredEvidenceReferencesSchema = z
  .array(asyncJobEvidenceReferenceV1Schema)
  .min(1)
  .max(32);

export const intentExtractionJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: noEvidenceReferencesSchema,
    family: z.literal("intent-extraction"),
    proposal: proposalReferenceV1Schema,
  })
  .strict();

export const architectureProposalJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: noEvidenceReferencesSchema,
    family: z.literal("architecture-proposal"),
    proposal: proposalReferenceV1Schema,
  })
  .strict();

export const workloadContractProposalJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: noEvidenceReferencesSchema,
    family: z.literal("workload-contract-proposal"),
    proposal: proposalReferenceV1Schema,
  })
  .strict();

export const graphWorkloadOperationProposalJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: noEvidenceReferencesSchema,
    family: z.literal("graph-workload-operation-proposal"),
    proposal: proposalReferenceV1Schema,
  })
  .strict();

export const iacCompilationJobOutputV1Schema = z
  .object({
    compiledInfrastructure: artifactForPurpose("build-output"),
    contractVersion: z.literal(1),
    evidenceRecords: requiredEvidenceReferencesSchema,
    family: z.literal("iac-compilation"),
  })
  .strict();

export const applicationSourceGenerationJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: requiredEvidenceReferencesSchema,
    family: z.literal("application-source-generation"),
    generatedSource: artifactForPurpose("generated-source"),
  })
  .strict();

export const applicationBuildTestPackageJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: requiredEvidenceReferencesSchema,
    family: z.literal("application-build-test-package"),
    package: artifactForPurpose("build-output"),
  })
  .strict();

export const staticValidationJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: boundedEvidenceReferencesSchema,
    family: z.literal("static-validation"),
    report: artifactForPurpose("validation-report"),
  })
  .strict();

export const diagramRenderingJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    diagram: artifactForPurpose("diagram"),
    evidenceRecords: noEvidenceReferencesSchema,
    family: z.literal("diagram-rendering"),
  })
  .strict();

export const combinedExportPackagingJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: noEvidenceReferencesSchema,
    family: z.literal("combined-export-packaging"),
    package: artifactForPurpose("export-package"),
  })
  .strict();

export const solutionExportOrchestrationJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: boundedEvidenceReferencesSchema,
    family: z.literal("solution-export-orchestration"),
    verifiedPackage: artifactForPurpose("export-package"),
  })
  .strict();

export const gitHubRepositoryExportJobOutputV1Schema = z
  .object({
    commitSha: z.string().regex(exactCommitShaPattern),
    contractVersion: z.literal(1),
    evidenceRecords: requiredEvidenceReferencesSchema,
    family: z.literal("github-repository-export"),
    receipt: artifactForPurpose("repository-export-receipt"),
  })
  .strict();

export const customerOwnedPlanEvidenceJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: requiredEvidenceReferencesSchema,
    family: z.literal("customer-owned-plan-evidence"),
    result: artifactForPurpose("plan-result"),
  })
  .strict();

export const deploymentEvidenceJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: requiredEvidenceReferencesSchema,
    family: z.literal("deployment-evidence"),
    result: artifactForPurpose("deployment-result"),
  })
  .strict();

export const smokeIntegrationEvidenceJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: requiredEvidenceReferencesSchema,
    family: z.literal("smoke-integration-evidence"),
    result: artifactForPurpose("smoke-integration-result"),
  })
  .strict();

export const driftEvidenceJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: requiredEvidenceReferencesSchema,
    family: z.literal("drift-evidence"),
    result: artifactForPurpose("drift-result"),
  })
  .strict();

export const billingUsageReconciliationJobOutputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceRecords: noEvidenceReferencesSchema,
    family: z.literal("billing-usage-reconciliation"),
    reconciliation: artifactForPurpose("billing-reconciliation-result"),
  })
  .strict();

export const asyncJobOutputV1Schema = z.discriminatedUnion("family", [
  intentExtractionJobOutputV1Schema,
  architectureProposalJobOutputV1Schema,
  workloadContractProposalJobOutputV1Schema,
  graphWorkloadOperationProposalJobOutputV1Schema,
  iacCompilationJobOutputV1Schema,
  applicationSourceGenerationJobOutputV1Schema,
  applicationBuildTestPackageJobOutputV1Schema,
  staticValidationJobOutputV1Schema,
  diagramRenderingJobOutputV1Schema,
  combinedExportPackagingJobOutputV1Schema,
  solutionExportOrchestrationJobOutputV1Schema,
  gitHubRepositoryExportJobOutputV1Schema,
  customerOwnedPlanEvidenceJobOutputV1Schema,
  deploymentEvidenceJobOutputV1Schema,
  smokeIntegrationEvidenceJobOutputV1Schema,
  driftEvidenceJobOutputV1Schema,
  billingUsageReconciliationJobOutputV1Schema,
]);

export const asyncJobLimitsV1Schema = z
  .object({
    artifactCount: z
      .number()
      .int()
      .positive()
      .max(ASYNC_JOB_V1_HARD_LIMITS.artifactCount),
    attemptCount: z
      .number()
      .int()
      .positive()
      .max(ASYNC_JOB_V1_HARD_LIMITS.attemptCount),
    checkpointBytes: z
      .number()
      .int()
      .positive()
      .max(ASYNC_JOB_V1_HARD_LIMITS.checkpointBytes),
    checkpointCount: z
      .number()
      .int()
      .positive()
      .max(ASYNC_JOB_V1_HARD_LIMITS.checkpointCount),
    contractVersion: z.literal(1),
    inlineInputBytes: z
      .number()
      .int()
      .positive()
      .max(ASYNC_JOB_V1_HARD_LIMITS.inlineInputBytes),
    outputBytes: z
      .number()
      .int()
      .positive()
      .max(ASYNC_JOB_V1_HARD_LIMITS.outputBytes),
    referencedInputBytes: z
      .number()
      .int()
      .positive()
      .max(ASYNC_JOB_V1_HARD_LIMITS.referencedInputBytes),
    runtimeSeconds: z
      .number()
      .int()
      .positive()
      .max(ASYNC_JOB_V1_HARD_LIMITS.runtimeSeconds),
  })
  .strict();

export const asyncJobProgressV1Schema = z
  .object({
    completedUnits: z.number().int().nonnegative(),
    messageKey: namespacedIdentifierSchema.optional(),
    phase: namespacedIdentifierSchema,
    sequence: z.number().int().nonnegative(),
    totalUnits: z.number().int().positive().optional(),
    updatedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.totalUnits !== undefined &&
      value.completedUnits > value.totalUnits
    ) {
      context.addIssue({
        code: "custom",
        message: "completedUnits cannot exceed totalUnits.",
        path: ["completedUnits"],
      });
    }
  });

export const asyncJobFailureClassificationV1Schema = z.enum([
  "transient",
  "permanent",
]);

export const asyncJobPublicFailureMessageV1Schema = z.enum([
  "job-temporarily-unavailable",
  "job-input-invalid",
  "job-not-supported",
  "job-canceled",
  "job-limit-exceeded",
  "job-expired",
  "job-internal-error",
]);

/** Raw tool or provider errors are intentionally not representable here. */
export const asyncJobFailureV1Schema = z
  .object({
    classification: asyncJobFailureClassificationV1Schema,
    code: namespacedIdentifierSchema,
    internalErrorId: opaqueIdSchema.optional(),
    publicMessage: asyncJobPublicFailureMessageV1Schema,
    retryAfterSeconds: z.number().int().positive().max(86_400).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.classification === "permanent" &&
      value.retryAfterSeconds !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Permanent failures cannot advertise a retry delay.",
        path: ["retryAfterSeconds"],
      });
    }
  });

export const asyncJobRetryDispositionV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("retry"),
      notBefore: utcTimestampSchema,
    })
    .strict(),
  z.object({ kind: z.literal("do-not-retry") }).strict(),
]);

export const asyncJobLeaseV1Schema = z
  .object({
    heartbeatAt: utcTimestampSchema,
    leaseExpiresAt: utcTimestampSchema,
    workerId: asyncJobWorkerIdSchema,
  })
  .strict();

export const asyncJobAttemptStateV1Schema = z.enum([
  "running",
  "succeeded",
  "failed",
  "canceled",
  "orphaned",
]);

export const asyncJobAttemptV1Schema = z
  .object({
    attemptId: asyncJobAttemptIdSchema,
    attemptNumber: z.number().int().positive(),
    completedAt: utcTimestampSchema.optional(),
    failure: asyncJobFailureV1Schema.optional(),
    lease: asyncJobLeaseV1Schema.optional(),
    resumedFromCheckpointId: asyncJobCheckpointIdSchema.optional(),
    retryDisposition: asyncJobRetryDispositionV1Schema.optional(),
    runtimeSeconds: z.number().int().nonnegative(),
    startedAt: utcTimestampSchema,
    state: asyncJobAttemptStateV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "running" && value.completedAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: "A running attempt cannot have completedAt.",
        path: ["completedAt"],
      });
    }
    if (value.state !== "running" && value.completedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "A completed attempt requires completedAt.",
        path: ["completedAt"],
      });
    }
    if (value.state === "running" && value.lease === undefined) {
      context.addIssue({
        code: "custom",
        message: "A running attempt requires a worker lease.",
        path: ["lease"],
      });
    }
    if (value.state === "failed" && value.failure === undefined) {
      context.addIssue({
        code: "custom",
        message: "A failed attempt requires a sanitized failure.",
        path: ["failure"],
      });
    }
    if (value.state !== "failed" && value.failure !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only a failed attempt may contain failure details.",
        path: ["failure"],
      });
    }
    const hasRetryDisposition = value.retryDisposition !== undefined;
    const needsRetryDisposition =
      value.state === "failed" || value.state === "orphaned";
    if (hasRetryDisposition !== needsRetryDisposition) {
      context.addIssue({
        code: "custom",
        message:
          "Every failed or orphaned attempt requires exactly one retry disposition, and other attempt states cannot carry one.",
        path: ["retryDisposition"],
      });
    }
    if (
      value.retryDisposition?.kind === "retry" &&
      value.state === "failed" &&
      value.failure?.classification !== "transient"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a transient failed attempt may be scheduled for retry.",
        path: ["retryDisposition"],
      });
    }
    if (
      value.retryDisposition?.kind === "retry" &&
      value.completedAt !== undefined &&
      Date.parse(value.retryDisposition.notBefore) <
        Date.parse(value.completedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "A retry cannot be scheduled before attempt completion.",
        path: ["retryDisposition", "notBefore"],
      });
    }
  });

export const asyncJobCheckpointV1Schema = z
  .object({
    attemptNumber: z.number().int().positive(),
    checkpointId: asyncJobCheckpointIdSchema,
    createdAt: utcTimestampSchema,
    handlerId: namespacedIdentifierSchema,
    handlerVersion: z.string().min(1).max(128),
    inputDigest: sha256DigestSchema,
    sequence: z.number().int().positive(),
    state: asyncJobObjectReferenceV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state.purpose !== "checkpoint-state") {
      context.addIssue({
        code: "custom",
        message: "Checkpoint state must use a checkpoint-state reference.",
        path: ["state", "purpose"],
      });
    }
    if (value.state.expiresAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: "A resumable checkpoint cannot reference expiring state.",
        path: ["state", "expiresAt"],
      });
    }
  });

export const asyncJobCancellationV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z
    .object({
      requestedAt: utcTimestampSchema,
      requestedBy: solutionStableIdSchema,
      state: z.literal("requested"),
    })
    .strict(),
  z
    .object({
      acknowledgedAt: utcTimestampSchema,
      requestedAt: utcTimestampSchema,
      requestedBy: solutionStableIdSchema,
      state: z.literal("acknowledged"),
    })
    .strict(),
]);

export const asyncJobInteractionV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z
    .object({
      checkpointId: asyncJobCheckpointIdSchema,
      handlerId: namespacedIdentifierSchema,
      handlerVersion: z.string().min(1).max(128),
      interactionId: asyncJobInteractionIdSchema,
      requestedAt: utcTimestampSchema,
      state: z.literal("awaiting-user-input"),
    })
    .strict(),
  z
    .object({
      checkpointId: asyncJobCheckpointIdSchema,
      handlerId: namespacedIdentifierSchema,
      handlerVersion: z.string().min(1).max(128),
      interactionId: asyncJobInteractionIdSchema,
      receivedAt: utcTimestampSchema,
      requestedAt: utcTimestampSchema,
      state: z.literal("user-input-received"),
      userResponse: asyncJobDurableInputReferenceV1Schema,
    })
    .strict()
    .superRefine((value, context) => {
      if (Date.parse(value.receivedAt) < Date.parse(value.requestedAt)) {
        context.addIssue({
          code: "custom",
          message: "User input cannot be received before it was requested.",
          path: ["receivedAt"],
        });
      }
    }),
]);
export const asyncJobChildFailurePolicyV1Schema = z.enum([
  "fail-parent",
  "cancel-remaining",
  "continue-and-report",
]);

export const asyncJobOrchestrationV1Schema = z
  .object({
    dependencyJobIds: z.array(asyncJobIdSchema).max(128),
    expectedChildJobIds: z.array(asyncJobIdSchema).max(128),
    failurePolicy: asyncJobChildFailurePolicyV1Schema,
    parentJobId: asyncJobIdSchema.optional(),
    rootJobId: asyncJobIdSchema,
  })
  .strict();
export const asyncJobTrustedOwnershipV1Schema = z
  .object({
    organizationId: asyncJobOrganizationIdSchema,
    projectId: asyncJobProjectIdSchema.optional(),
  })
  .strict();

export const asyncJobTrustedActorV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      actorId: solutionStableIdSchema,
      kind: z.literal("principal"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("worker"),
      workerId: asyncJobWorkerIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("system"),
      reason: z.enum(["scheduler", "orphan-reconciler", "retention"]),
    })
    .strict(),
]);

/** Trusted context is supplied by verified request or internal worker scope. */
export const asyncJobTrustedContextV1Schema = z
  .object({
    actor: asyncJobTrustedActorV1Schema,
    correlationId: asyncJobCorrelationIdSchema,
    ownership: asyncJobTrustedOwnershipV1Schema,
  })
  .strict();

export const asyncJobIdempotencyClaimV1Schema = z
  .object({
    actorId: solutionStableIdSchema,
    keyDigest: sha256DigestSchema,
    operationId: namespacedIdentifierSchema,
    requestDigest: sha256DigestSchema,
  })
  .strict();

export const asyncJobReservationLinkV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z
    .object({
      reservationId: opaqueIdSchema,
      state: z.literal("reserved"),
    })
    .strict(),
]);

/** The raw idempotency key is request-only and is never persisted. */
export const asyncJobCreateRequestV1Schema = z
  .object({
    contractVersion: z.literal(1),
    idempotencyKey: z.string().regex(printableIdempotencyKeyPattern),
    input: asyncJobInputV1Schema,
    inputSizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(ASYNC_JOB_V1_HARD_LIMITS.inlineInputBytes),
  })
  .strict();

function collectObjectReferences(value: unknown): {
  purpose: string;
  sizeBytes: number;
}[] {
  const references: { purpose: string; sizeBytes: number }[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") {
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record["objectId"] === "string" &&
      typeof record["purpose"] === "string" &&
      typeof record["sizeBytes"] === "number"
    ) {
      references.push({
        purpose: record["purpose"],
        sizeBytes: record["sizeBytes"],
      });
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return references;
}

function duplicateStableValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function collectArtifactReferenceIds(value: unknown): string[] {
  const artifactIds: string[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") {
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record["artifactId"] === "string" &&
      record["object"] !== undefined &&
      record["availability"] !== undefined
    ) {
      artifactIds.push(record["artifactId"]);
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return artifactIds;
}
export const asyncJobRecordV1Schema = z
  .object({
    attempts: z
      .array(asyncJobAttemptV1Schema)
      .max(ASYNC_JOB_V1_HARD_LIMITS.attemptCount),
    cancellation: asyncJobCancellationV1Schema,
    checkpoints: z
      .array(asyncJobCheckpointV1Schema)
      .max(ASYNC_JOB_V1_HARD_LIMITS.checkpointCount),
    completedAt: utcTimestampSchema.optional(),
    contractVersion: z.literal(1),
    correlationId: asyncJobCorrelationIdSchema,
    createdAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema.optional(),
    failure: asyncJobFailureV1Schema.optional(),
    family: asyncJobFamilyV1Schema,
    idempotency: asyncJobIdempotencyClaimV1Schema,
    input: asyncJobInputV1Schema,
    inputDigest: sha256DigestSchema,
    interaction: asyncJobInteractionV1Schema,
    inputSizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(ASYNC_JOB_V1_HARD_LIMITS.inlineInputBytes),
    jobId: asyncJobIdSchema,
    latestCheckpointId: asyncJobCheckpointIdSchema.optional(),
    limits: asyncJobLimitsV1Schema,
    orchestration: asyncJobOrchestrationV1Schema,
    output: asyncJobOutputV1Schema.optional(),
    outputSizeBytes: z.number().int().nonnegative().optional(),
    ownership: asyncJobTrustedOwnershipV1Schema,
    progress: asyncJobProgressV1Schema.optional(),
    queuedAt: utcTimestampSchema,
    recordVersion: z.number().int().positive(),
    reservation: asyncJobReservationLinkV1Schema,
    startedAt: utcTimestampSchema.optional(),
    state: asyncJobStateV1Schema,
    supersededByJobId: asyncJobIdSchema.optional(),
    updatedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((job, context) => {
    if (job.family !== job.input.family) {
      context.addIssue({
        code: "custom",
        message: "Stored family must match the immutable input family.",
        path: ["family"],
      });
    }

    const isOrganizationJob = job.input.subject.kind === "organization";
    if (isOrganizationJob && job.ownership.projectId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Organization reconciliation jobs cannot claim a project.",
        path: ["ownership", "projectId"],
      });
    }
    if (!isOrganizationJob && job.ownership.projectId === undefined) {
      context.addIssue({
        code: "custom",
        message:
          "Draft and Solution Revision jobs require trusted project ownership.",
        path: ["ownership", "projectId"],
      });
    }

    if (job.inputSizeBytes > job.limits.inlineInputBytes) {
      context.addIssue({
        code: "custom",
        message: "Inline input exceeds this job's configured limit.",
        path: ["inputSizeBytes"],
      });
    }
    const referencedInputBytes = [
      ...collectObjectReferences(job.input),
      ...(job.interaction.state === "user-input-received"
        ? collectObjectReferences(job.interaction.userResponse)
        : []),
    ].reduce((total, reference) => total + reference.sizeBytes, 0);
    if (referencedInputBytes > job.limits.referencedInputBytes) {
      context.addIssue({
        code: "custom",
        message: "Referenced input exceeds this job's configured limit.",
        path: ["input"],
      });
    }

    if (job.attempts.length > job.limits.attemptCount) {
      context.addIssue({
        code: "custom",
        message: "Attempt count exceeds this job's configured limit.",
        path: ["attempts"],
      });
    }
    if (
      duplicateStableValues(job.attempts.map((attempt) => attempt.attemptId))
        .length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Attempt identities must be unique within a job.",
        path: ["attempts"],
      });
    }
    job.attempts.forEach((attempt, index) => {
      if (attempt.attemptNumber !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Attempts must have contiguous one-based numbers.",
          path: ["attempts", index, "attemptNumber"],
        });
      }
      if (attempt.runtimeSeconds > job.limits.runtimeSeconds) {
        context.addIssue({
          code: "custom",
          message: "Attempt runtime exceeds this job's configured limit.",
          path: ["attempts", index, "runtimeSeconds"],
        });
      }
    });

    const totalRuntimeSeconds = job.attempts.reduce(
      (total, attempt) => total + attempt.runtimeSeconds,
      0,
    );
    if (totalRuntimeSeconds > job.limits.runtimeSeconds) {
      context.addIssue({
        code: "custom",
        message:
          "Cumulative attempt runtime exceeds this job's configured limit.",
        path: ["attempts"],
      });
    }

    if (job.checkpoints.length > job.limits.checkpointCount) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint count exceeds this job's configured limit.",
        path: ["checkpoints"],
      });
    }
    if (
      duplicateStableValues(
        job.checkpoints.map((checkpoint) => checkpoint.checkpointId),
      ).length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint identities must be unique within a job.",
        path: ["checkpoints"],
      });
    }
    job.checkpoints.forEach((checkpoint, index) => {
      if (checkpoint.inputDigest !== job.inputDigest) {
        context.addIssue({
          code: "custom",
          message: "A checkpoint must preserve the exact job input digest.",
          path: ["checkpoints", index, "inputDigest"],
        });
      }
      if (checkpoint.state.sizeBytes > job.limits.checkpointBytes) {
        context.addIssue({
          code: "custom",
          message: "Checkpoint state exceeds this job's configured limit.",
          path: ["checkpoints", index, "state", "sizeBytes"],
        });
      }
    });
    if (
      job.latestCheckpointId !== undefined &&
      !job.checkpoints.some(
        (checkpoint) => checkpoint.checkpointId === job.latestCheckpointId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "latestCheckpointId must reference a durable checkpoint.",
        path: ["latestCheckpointId"],
      });
    }

    if (job.state === "awaiting-user-input") {
      if (job.interaction.state !== "awaiting-user-input") {
        context.addIssue({
          code: "custom",
          message:
            "A job awaiting user input requires an exact interaction binding.",
          path: ["interaction"],
        });
      }
    } else if (
      job.interaction.state === "awaiting-user-input" &&
      (job.state === "queued" ||
        job.state === "running" ||
        job.state === "succeeded")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A nonterminal awaited interaction requires awaiting-user-input job state.",
        path: ["interaction", "state"],
      });
    }
    if (
      job.interaction.state === "user-input-received" &&
      job.state === "awaiting-user-input"
    ) {
      context.addIssue({
        code: "custom",
        message: "A received response must leave awaiting-user-input state.",
        path: ["interaction", "state"],
      });
    }
    const interaction = job.interaction;
    if (interaction.state !== "none") {
      const interactionCheckpoint = job.checkpoints.find(
        (checkpoint) => checkpoint.checkpointId === interaction.checkpointId,
      );
      if (interactionCheckpoint === undefined) {
        context.addIssue({
          code: "custom",
          message:
            "The persisted interaction must reference a durable job checkpoint.",
          path: ["interaction", "checkpointId"],
        });
      } else {
        if (
          interactionCheckpoint.handlerId !== interaction.handlerId ||
          interactionCheckpoint.handlerVersion !== interaction.handlerVersion
        ) {
          context.addIssue({
            code: "custom",
            message:
              "The persisted interaction must bind the checkpoint handler identity and version.",
            path: ["interaction", "handlerId"],
          });
        }
        if (
          Date.parse(interaction.requestedAt) <
          Date.parse(interactionCheckpoint.createdAt)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "User input cannot be requested before its checkpoint exists.",
            path: ["interaction", "requestedAt"],
          });
        }
      }
      if (
        interaction.state === "awaiting-user-input" &&
        job.latestCheckpointId !== interaction.checkpointId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Persisted user interaction state must bind the latest checkpoint.",
          path: ["interaction", "checkpointId"],
        });
      }
    }
    if (job.orchestration.parentJobId === undefined) {
      if (job.orchestration.rootJobId !== job.jobId) {
        context.addIssue({
          code: "custom",
          message: "A root job must identify itself as rootJobId.",
          path: ["orchestration", "rootJobId"],
        });
      }
    } else if (job.orchestration.parentJobId === job.jobId) {
      context.addIssue({
        code: "custom",
        message: "A job cannot be its own parent.",
        path: ["orchestration", "parentJobId"],
      });
    }
    if (duplicateStableValues(job.orchestration.dependencyJobIds).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Dependency identities must be unique.",
        path: ["orchestration", "dependencyJobIds"],
      });
    }
    if (
      duplicateStableValues(job.orchestration.expectedChildJobIds).length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Expected child identities must be unique.",
        path: ["orchestration", "expectedChildJobIds"],
      });
    }
    if (
      job.orchestration.expectedChildJobIds.some((jobId) =>
        job.orchestration.dependencyJobIds.includes(jobId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Dependency and expected-child relationships must be disjoint.",
        path: ["orchestration"],
      });
    }
    if (job.orchestration.expectedChildJobIds.includes(job.jobId)) {
      context.addIssue({
        code: "custom",
        message: "A job cannot identify itself as an expected child.",
        path: ["orchestration", "expectedChildJobIds"],
      });
    }
    if (job.orchestration.dependencyJobIds.includes(job.jobId)) {
      context.addIssue({
        code: "custom",
        message: "A job cannot depend on itself.",
        path: ["orchestration", "dependencyJobIds"],
      });
    }

    const hasOutput = job.output !== undefined;
    if (hasOutput !== (job.outputSizeBytes !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Output and measured outputSizeBytes must be stored together.",
        path: ["outputSizeBytes"],
      });
    }
    if (job.state === "succeeded" && !hasOutput) {
      context.addIssue({
        code: "custom",
        message: "A succeeded job requires a bounded output.",
        path: ["output"],
      });
    }
    if (job.state !== "succeeded" && hasOutput) {
      context.addIssue({
        code: "custom",
        message: "Only a succeeded job may publish output.",
        path: ["output"],
      });
    }
    if (job.output !== undefined) {
      if (job.output.family !== job.input.family) {
        context.addIssue({
          code: "custom",
          message: "Output family must match the immutable input family.",
          path: ["output", "family"],
        });
      }
      if (
        job.outputSizeBytes !== undefined &&
        job.outputSizeBytes > job.limits.outputBytes
      ) {
        context.addIssue({
          code: "custom",
          message: "Output exceeds this job's configured byte limit.",
          path: ["outputSizeBytes"],
        });
      }
      const referencedOutputBytes = collectObjectReferences(job.output).reduce(
        (total, reference) => total + reference.sizeBytes,
        0,
      );
      if (
        job.outputSizeBytes !== undefined &&
        referencedOutputBytes > job.outputSizeBytes
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Measured output bytes cannot underreport referenced output.",
          path: ["outputSizeBytes"],
        });
      }
      if (referencedOutputBytes > job.limits.outputBytes) {
        context.addIssue({
          code: "custom",
          message:
            "Referenced output exceeds this job's configured byte limit.",
          path: ["output"],
        });
      }
      const artifactIds = collectArtifactReferenceIds(job.output);
      if (artifactIds.length > job.limits.artifactCount) {
        context.addIssue({
          code: "custom",
          message: "Output exceeds this job's configured artifact limit.",
          path: ["output"],
        });
      }
      if (duplicateStableValues(artifactIds).length > 0) {
        context.addIssue({
          code: "custom",
          message: "Output artifact identities must be unique.",
          path: ["output"],
        });
      }

      const evidenceRecords = job.output.evidenceRecords;
      if (
        duplicateStableValues(
          evidenceRecords.map((evidence) => evidence.evidenceId),
        ).length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Output Evidence identities must be unique.",
          path: ["output", "evidenceRecords"],
        });
      }
      const revisionSubject =
        job.input.subject.kind === "solution-revision"
          ? job.input.subject
          : undefined;
      if (revisionSubject === undefined) {
        if (evidenceRecords.length > 0) {
          context.addIssue({
            code: "custom",
            message:
              "Draft and organization jobs cannot emit Solution Revision Evidence.",
            path: ["output", "evidenceRecords"],
          });
        }
      } else {
        evidenceRecords.forEach((evidence, index) => {
          if (
            evidence.solutionRevisionId !== revisionSubject.solutionRevisionId
          ) {
            context.addIssue({
              code: "custom",
              message:
                "Evidence must identify the exact input Solution Revision.",
              path: ["output", "evidenceRecords", index, "solutionRevisionId"],
            });
          }
          const inputEnvironment =
            "environment" in job.input ? job.input.environment : undefined;
          if (inputEnvironment === undefined) {
            context.addIssue({
              code: "custom",
              message:
                "Evidence-producing jobs require an exact input environment.",
              path: ["input", "environment"],
            });
          } else if (
            JSON.stringify(evidence.environment) !==
            JSON.stringify(inputEnvironment)
          ) {
            context.addIssue({
              code: "custom",
              message:
                "Evidence environment must match the exact job environment.",
              path: ["output", "evidenceRecords", index, "environment"],
            });
          }
        });
      }
    }

    if (job.state === "failed" && job.failure === undefined) {
      context.addIssue({
        code: "custom",
        message: "A failed job requires a sanitized failure.",
        path: ["failure"],
      });
    }
    if (job.state !== "failed" && job.failure !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only a failed job may include a failure.",
        path: ["failure"],
      });
    }
    if (job.state === "superseded" && job.supersededByJobId === undefined) {
      context.addIssue({
        code: "custom",
        message: "A superseded job must identify its replacement.",
        path: ["supersededByJobId"],
      });
    }
    if (job.state !== "superseded" && job.supersededByJobId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only a superseded job may identify a replacement.",
        path: ["supersededByJobId"],
      });
    }
    const terminal = asyncJobTerminalStateV1Schema.safeParse(job.state).success;
    if (terminal !== (job.completedAt !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only terminal jobs require completedAt.",
        path: ["completedAt"],
      });
    }
    if (job.state === "canceled" && job.cancellation.state !== "acknowledged") {
      context.addIssue({
        code: "custom",
        message: "A canceled job requires acknowledged cancellation.",
        path: ["cancellation"],
      });
    }
  });
/** Status is a compatibility alias; state is the canonical lifecycle term. */
export const asyncJobStatusV1Schema = asyncJobStateV1Schema;

export const asyncJobTransitionReasonV1Schema = z.enum([
  "created",
  "worker-claimed",
  "progress-checkpoint",
  "user-input-required",
  "user-input-received",
  "retry-scheduled",
  "cancellation-requested",
  "cancellation-acknowledged",
  "handler-succeeded",
  "handler-failed",
  "retention-expired",
  "revision-superseded",
  "orphan-reconciled",
  "parent-policy",
]);

export const asyncJobTransitionV1Schema = z
  .object({
    at: utcTimestampSchema,
    from: asyncJobStateV1Schema.optional(),
    reason: asyncJobTransitionReasonV1Schema,
    recordVersion: z.number().int().positive(),
    to: asyncJobStateV1Schema,
  })
  .strict();

export const asyncJobQueueEnvelopeV1Schema = z
  .object({
    attemptNumber: z.number().int().positive(),
    availableAt: utcTimestampSchema,
    contractVersion: z.literal(1),
    correlationId: asyncJobCorrelationIdSchema,
    family: asyncJobFamilyV1Schema,
    inputDigest: sha256DigestSchema,
    jobId: asyncJobIdSchema,
    ownership: asyncJobTrustedOwnershipV1Schema,
    recordVersion: z.number().int().positive(),
  })
  .strict();

export const asyncJobAuditEventTypeV1Schema = z.enum([
  "job-created",
  "entitlement-authorized",
  "entitlement-denied",
  "reservation-established",
  "job-enqueued",
  "attempt-claimed",
  "progress-recorded",
  "checkpoint-recorded",
  "awaiting-user-input",
  "retry-scheduled",
  "cancellation-requested",
  "job-canceled",
  "job-succeeded",
  "job-failed",
  "job-expired",
  "job-superseded",
  "orphan-reconciled",
  "child-linked",
]);

export const asyncJobAuditEventV1Schema = z
  .object({
    actor: asyncJobTrustedActorV1Schema,
    correlationId: asyncJobCorrelationIdSchema,
    eventId: asyncJobAuditEventIdSchema,
    eventType: asyncJobAuditEventTypeV1Schema,
    jobId: asyncJobIdSchema,
    occurredAt: utcTimestampSchema,
    ownership: asyncJobTrustedOwnershipV1Schema,
    summaryDigest: sha256DigestSchema.optional(),
    transition: asyncJobTransitionV1Schema.optional(),
  })
  .strict();

export const asyncJobTransitionCursorV1Schema = z
  .string()
  .regex(
    transitionCursorPattern,
    "Must be an opaque bounded transition cursor.",
  )
  .brand<"AsyncJobTransitionCursor">();

const asyncJobPublicFailureV1Schema = z
  .object({
    code: namespacedIdentifierSchema,
    publicMessage: asyncJobPublicFailureMessageV1Schema,
  })
  .strict();

/** Public projection exposes only the opaque binding needed to answer. */
export const asyncJobStatusInteractionV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z
    .object({
      interactionId: asyncJobInteractionIdSchema,
      requestedAt: utcTimestampSchema,
      state: z.literal("awaiting-user-input"),
    })
    .strict(),
]);

export const asyncJobStatusViewV1Schema = z
  .object({
    cancellation: asyncJobCancellationV1Schema,
    completedAt: utcTimestampSchema.optional(),
    contractVersion: z.literal(1),
    correlationId: asyncJobCorrelationIdSchema,
    createdAt: utcTimestampSchema,
    failure: asyncJobPublicFailureV1Schema.optional(),
    family: asyncJobFamilyV1Schema,
    inputSubject: asyncJobSubjectV1Schema,
    interaction: asyncJobStatusInteractionV1Schema,
    jobId: asyncJobIdSchema,
    nextRetryAt: utcTimestampSchema.optional(),
    output: asyncJobOutputV1Schema.optional(),
    progress: asyncJobProgressV1Schema.optional(),
    recordVersion: z.number().int().positive(),
    state: asyncJobStateV1Schema,
    supersededByJobId: asyncJobIdSchema.optional(),
    updatedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((status, context) => {
    const isAwaiting = status.state === "awaiting-user-input";
    const hasAwaitedInteraction =
      status.interaction.state === "awaiting-user-input";
    if (isAwaiting !== hasAwaitedInteraction) {
      context.addIssue({
        code: "custom",
        message:
          "Awaiting status and its redacted interaction projection must agree.",
        path: ["interaction"],
      });
    }
  });

export const asyncJobPollingResponseV1Schema = z
  .object({
    contractVersion: z.literal(1),
    job: asyncJobStatusViewV1Schema,
    pollAfterMilliseconds: z.number().int().min(250).max(60_000),
    transitionCursor: asyncJobTransitionCursorV1Schema,
  })
  .strict();

export const asyncJobOrphanResolutionV1Schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("resume"),
      checkpointId: asyncJobCheckpointIdSchema,
      notBefore: utcTimestampSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("restart"),
      notBefore: utcTimestampSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("fail"),
      failure: asyncJobFailureV1Schema,
    })
    .strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);

export const asyncJobHandlerOutcomeV1Schema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("succeeded"),
      output: asyncJobOutputV1Schema,
      outputSizeBytes: z
        .number()
        .int()
        .nonnegative()
        .max(ASYNC_JOB_V1_HARD_LIMITS.outputBytes),
    })
    .strict(),
  z
    .object({
      checkpoint: asyncJobCheckpointV1Schema,
      interactionId: asyncJobInteractionIdSchema,
      messageKey: namespacedIdentifierSchema,
      outcome: z.literal("awaiting-user-input"),
    })
    .strict(),
  z
    .object({
      checkpoint: asyncJobCheckpointV1Schema.optional(),
      failure: asyncJobFailureV1Schema,
      outcome: z.literal("failed"),
    })
    .strict(),
  z.object({ outcome: z.literal("canceled") }).strict(),
]);

export function parseAsyncJobInputV1(value: unknown): AsyncJobInputV1 {
  return asyncJobInputV1Schema.parse(value);
}

export function parseAsyncJobInputV1Json(json: string): AsyncJobInputV1 {
  return parseAsyncJobInputV1(JSON.parse(json) as unknown);
}

export function parseAsyncJobOutputV1(value: unknown): AsyncJobOutputV1 {
  return asyncJobOutputV1Schema.parse(value);
}

export function parseAsyncJobOutputV1Json(json: string): AsyncJobOutputV1 {
  return parseAsyncJobOutputV1(JSON.parse(json) as unknown);
}

export function parseAsyncJobRecordV1(value: unknown): AsyncJobRecordV1 {
  return asyncJobRecordV1Schema.parse(value);
}

export function parseAsyncJobRecordV1Json(json: string): AsyncJobRecordV1 {
  return parseAsyncJobRecordV1(JSON.parse(json) as unknown);
}

export function parseAsyncJobQueueEnvelopeV1(
  value: unknown,
): AsyncJobQueueEnvelopeV1 {
  return asyncJobQueueEnvelopeV1Schema.parse(value);
}

export function generateAsyncJobV1JsonSchema() {
  const generated = z.toJSONSchema(asyncJobRecordV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/async-job/v1.schema.json",
    title: "Cloud Markup Async Job v1",
  };
}

export type AsyncJobArtifactReferenceV1 = z.output<
  typeof asyncJobArtifactReferenceV1Schema
>;
export type AsyncJobAttemptV1 = z.output<typeof asyncJobAttemptV1Schema>;
export type AsyncJobAuditEventV1 = z.output<typeof asyncJobAuditEventV1Schema>;
export type AsyncJobCancellationV1 = z.output<
  typeof asyncJobCancellationV1Schema
>;
export type AsyncJobDurableInputReferenceV1 = z.output<
  typeof asyncJobDurableInputReferenceV1Schema
>;
export type AsyncJobCheckpointV1 = z.output<typeof asyncJobCheckpointV1Schema>;
export type AsyncJobCreateRequestV1 = z.output<
  typeof asyncJobCreateRequestV1Schema
>;
export type AsyncJobEnvironmentV1 = z.output<
  typeof asyncJobEnvironmentV1Schema
>;
export type AsyncJobEvidenceReferenceV1 = z.output<
  typeof asyncJobEvidenceReferenceV1Schema
>;
export type AsyncJobFailureV1 = z.output<typeof asyncJobFailureV1Schema>;
export type AsyncJobFamilyV1 = z.output<typeof asyncJobFamilyV1Schema>;
export type AsyncJobHandlerOutcomeV1 = z.output<
  typeof asyncJobHandlerOutcomeV1Schema
>;
export type AsyncJobId = z.output<typeof asyncJobIdSchema>;
export type AsyncJobInteractionId = z.output<
  typeof asyncJobInteractionIdSchema
>;
export type AsyncJobInteractionV1 = z.output<
  typeof asyncJobInteractionV1Schema
>;
export type AsyncJobInputV1 = z.output<typeof asyncJobInputV1Schema>;
export type SolutionExportOrchestrationJobInputV1 = z.output<
  typeof solutionExportOrchestrationJobInputV1Schema
>;
export type AsyncJobLimitsV1 = z.output<typeof asyncJobLimitsV1Schema>;
export type AsyncJobObjectReferenceV1 = z.output<
  typeof asyncJobObjectReferenceV1Schema
>;
export type AsyncJobOrchestrationV1 = z.output<
  typeof asyncJobOrchestrationV1Schema
>;
export type AsyncJobOrphanResolutionV1 = z.output<
  typeof asyncJobOrphanResolutionV1Schema
>;
export type AsyncJobOutputV1 = z.output<typeof asyncJobOutputV1Schema>;
export type SolutionExportOrchestrationJobOutputV1 = z.output<
  typeof solutionExportOrchestrationJobOutputV1Schema
>;
export type AsyncJobPollingResponseV1 = z.output<
  typeof asyncJobPollingResponseV1Schema
>;
export type AsyncJobProgressV1 = z.output<typeof asyncJobProgressV1Schema>;
export type AsyncJobQueueEnvelopeV1 = z.output<
  typeof asyncJobQueueEnvelopeV1Schema
>;
export type AsyncJobRecordV1 = z.output<typeof asyncJobRecordV1Schema>;
export type AsyncJobStateV1 = z.output<typeof asyncJobStateV1Schema>;
export type AsyncJobStatusInteractionV1 = z.output<
  typeof asyncJobStatusInteractionV1Schema
>;
export type AsyncJobStatusV1 = AsyncJobStateV1;
export type AsyncJobStatusViewV1 = z.output<typeof asyncJobStatusViewV1Schema>;
export type AsyncJobSubjectV1 = z.output<typeof asyncJobSubjectV1Schema>;
export type AsyncJobTrustedContextV1 = z.output<
  typeof asyncJobTrustedContextV1Schema
>;
export type AsyncJobTrustedOwnershipV1 = z.output<
  typeof asyncJobTrustedOwnershipV1Schema
>;
