import {
  asyncJobEvidenceReferenceV1Schema,
  exportDiagnosticRecoveryReferencesV1Schema,
  repositoryRelativePathSchema,
  solutionGenerationCoverageV1Schema,
  solutionRevisionIdSchema,
  type ExportDiagnosticRecoveryReferencesV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  createDataEnvelopeSchema,
  createOpaqueIdentifierSchema,
  safeUserMessageSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./common.js";
import { environmentIdSchema, projectIdSchema } from "./resources.js";

export const solutionExportJobIdSchema =
  createOpaqueIdentifierSchema("solutionexport");
export const solutionExportArtifactIdSchema =
  createOpaqueIdentifierSchema("solutionartifact");
export const solutionExportArtifactFileIdSchema =
  createOpaqueIdentifierSchema("solutionfile");
export const solutionExportDownloadGrantIdSchema =
  createOpaqueIdentifierSchema("downloadgrant");

export const solutionExportTargetProfileIdV1Schema = z.enum([
  "cloudmarkup.export.terraform-nodejs24-v1",
  "cloudmarkup.export.cloudformation-nodejs24-v1",
]);

export const solutionExportEnvironmentV1Schema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    environmentType: z.enum(["development", "test", "staging", "production"]),
  })
  .strict();
export const solutionExportDiagramOptionsV1Schema = z
  .object({
    background: z.enum(["canvas-light", "opaque-light", "transparent"]),
    includeStableDeploymentIdentifiers: z.boolean(),
    maxHeight: z.number().int().min(320).max(8_192),
    maxWidth: z.number().int().min(480).max(8_192),
    profile: z.enum(["presentation", "technical"]),
    scale: z.number().int().min(1).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.profile === "presentation" &&
      value.includeStableDeploymentIdentifiers
    ) {
      context.addIssue({
        code: "custom",
        message: "Presentation diagrams cannot include deployment identifiers.",
        path: ["includeStableDeploymentIdentifiers"],
      });
    }
    if (
      value.maxWidth * value.maxHeight > 32_000_000 ||
      value.maxWidth / value.scale < 480 ||
      value.maxHeight / value.scale < 320
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Diagram dimensions exceed the approved readable pixel budget.",
        path: ["maxWidth"],
      });
    }
  });

/**
 * The browser selects immutable input and approved server-known settings only.
 * Tenant identity, manifest identity/digest, coverage, and entitlements are
 * deliberately absent and must be resolved from trusted server state.
 */
export const createSolutionExportJobV1Schema = z
  .object({
    contractVersion: z.literal(1),
    environment: solutionExportEnvironmentV1Schema,
    diagram: solutionExportDiagramOptionsV1Schema.optional(),
    exportName: z
      .string()
      .trim()
      .min(1)
      .max(96)
      .regex(
        /^(?:[A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9 ._-]{0,94}[A-Za-z0-9])$/,
        "Export names must be portable display names without path syntax.",
      ),
    solutionRevisionId: solutionRevisionIdSchema,
    targetProfileId: solutionExportTargetProfileIdV1Schema,
    applicationSource: z
      .enum(["ai-source-draft-v1", "ai-source-draft-v2", "ai-source-draft-v3"])
      .optional(),
  })
  .strict();

export const cancelSolutionExportJobV1Schema = z
  .object({ contractVersion: z.literal(1) })
  .strict();

export const createSolutionExportDownloadGrantV1Schema = z
  .object({ contractVersion: z.literal(1) })
  .strict();

export const solutionExportJobPathV1Schema = z
  .object({
    projectId: projectIdSchema,
    solutionExportJobId: solutionExportJobIdSchema,
  })
  .strict();

export const solutionExportArtifactPathV1Schema = z
  .object({
    projectId: projectIdSchema,
    solutionExportArtifactId: solutionExportArtifactIdSchema,
  })
  .strict();

export const solutionExportArtifactFilePathV1Schema = z
  .object({
    projectId: projectIdSchema,
    solutionExportArtifactFileId: solutionExportArtifactFileIdSchema,
    solutionExportArtifactId: solutionExportArtifactIdSchema,
  })
  .strict();

export const solutionExportDownloadGrantPathV1Schema = z
  .object({
    projectId: projectIdSchema,
    solutionExportArtifactId: solutionExportArtifactIdSchema,
    solutionExportDownloadGrantId: solutionExportDownloadGrantIdSchema,
  })
  .strict();

export const SOLUTION_EXPORT_STAGES_V1 = [
  "authorization",
  "compilation",
  "application-generation",
  "application-build",
  "terraform-validation",
  "diagram-rendering",
  "packaging",
  "publication",
] as const;

export const SOLUTION_EXPORT_CLOUDFORMATION_STAGES_V1 = [
  "authorization",
  "compilation",
  "application-generation",
  "application-build",
  "cloudformation-validation",
  "diagram-rendering",
  "packaging",
  "publication",
] as const;

/** The historical Terraform stage list remains byte-compatible. */
export function solutionExportStagesForTargetProfile(profileId: string) {
  return solutionExportTargetProfileIdV1Schema.parse(profileId) ===
    "cloudmarkup.export.cloudformation-nodejs24-v1"
    ? SOLUTION_EXPORT_CLOUDFORMATION_STAGES_V1
    : SOLUTION_EXPORT_STAGES_V1;
}
export const solutionExportStageV1Schema = z.enum([
  ...SOLUTION_EXPORT_STAGES_V1,
  "cloudformation-validation",
]);

export const solutionExportStageStatusV1Schema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "canceled",
]);

export const solutionExportJobStateV1Schema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancellation-requested",
  "canceled",
]);

const solutionExportReferenceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const solutionExportCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)+$/);

const solutionExportDiagnosticV1 = z
  .object({
    recoveryReferences: exportDiagnosticRecoveryReferencesV1Schema.optional(),
    code: solutionExportCodeSchema,
    edgeId: solutionExportReferenceIdSchema.optional(),
    message: safeUserMessageSchema,
    nodeId: solutionExportReferenceIdSchema.optional(),
    ownedPolicyId: solutionExportReferenceIdSchema.optional(),
    path: repositoryRelativePathSchema.optional(),
    severity: z.enum(["error", "warning", "info"]),
    stage: solutionExportStageV1Schema,
    workloadId: solutionExportReferenceIdSchema.optional(),
  })
  .strict();

export const solutionExportDiagnosticV1Schema: z.ZodType<SolutionExportDiagnosticV1> =
  solutionExportDiagnosticV1;

export const solutionExportEvidenceSummaryV1Schema = z
  .object({
    digest: sha256DigestSchema,
    evidenceId: solutionExportReferenceIdSchema,
    kind: z.enum([
      "infrastructure-compilation",
      "application-generation",
      "application-build",
      "application-test",
      "dependency-scan",
      "security-scan",
      "terraform-validation",
      "cloudformation-validation",
      "organization-policy",
      "export-verification",
    ]),
    stage: solutionExportStageV1Schema,
    reference: asyncJobEvidenceReferenceV1Schema.optional(),
    status: z.enum(["passed", "failed", "incomplete"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.reference !== undefined &&
      (value.reference.evidenceId !== value.evidenceId ||
        value.reference.record.digest !== value.digest)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Evidence summaries must match their exact durable Evidence reference.",
        path: ["reference"],
      });
    }
  });

const solutionExportApplicationCoverageStateV1Schema = z.enum([
  "starter-application",
  "complete-supported-pattern",
  "custom-implementation-required",
]);

/**
 * Public projection of the verified application-build coverage. It remains
 * independent of the private runner package while retaining every immutable
 * revision, generation, request, workload, and Evidence binding.
 */
export const solutionExportApplicationVerificationV1Schema = z
  .object({
    buildRequestDigest: sha256DigestSchema,
    confirmedState: solutionExportApplicationCoverageStateV1Schema,
    downgradeReason: safeUserMessageSchema.optional(),
    evidenceId: solutionExportReferenceIdSchema.optional(),
    generationArtifactDigest: sha256DigestSchema.optional(),
    inputState: solutionExportApplicationCoverageStateV1Schema,
    solutionRevisionDigest: sha256DigestSchema,
    solutionRevisionId: solutionRevisionIdSchema,
    workloadId: solutionExportReferenceIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const confirmed =
      value.confirmedState === value.inputState &&
      value.confirmedState !== "custom-implementation-required";
    const downgraded =
      value.confirmedState === "custom-implementation-required";
    if (!confirmed && !downgraded) {
      context.addIssue({
        code: "custom",
        message:
          "Application verification may only preserve generated coverage or downgrade it to custom implementation required.",
        path: ["confirmedState"],
      });
    }
    if (
      confirmed &&
      (value.evidenceId === undefined ||
        value.downgradeReason !== undefined ||
        value.generationArtifactDigest === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Confirmed generated coverage requires its generation digest and Evidence without a downgrade reason.",
        path: ["confirmedState"],
      });
    }
    if (
      downgraded &&
      (value.downgradeReason === undefined || value.evidenceId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Downgraded application verification requires a reason and cannot claim passing Evidence.",
        path: ["downgradeReason"],
      });
    }
    if (
      value.inputState !== "custom-implementation-required" &&
      value.generationArtifactDigest === undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Generated application input requires its exact artifact digest.",
        path: ["generationArtifactDigest"],
      });
    }
  });

export const solutionExportWarningV1Schema = z
  .object({
    code: solutionExportCodeSchema,
    message: safeUserMessageSchema,
  })
  .strict();

export const solutionExportStageSummaryV1Schema = z
  .object({
    completedAt: utcTimestampSchema.optional(),
    stage: solutionExportStageV1Schema,
    startedAt: utcTimestampSchema.optional(),
    status: solutionExportStageStatusV1Schema,
  })
  .strict();

export const solutionExportDownloadAvailabilityV1Schema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        expiresAt: utcTimestampSchema,
        state: z.literal("available"),
      })
      .strict(),
    z
      .object({
        expiredAt: utcTimestampSchema,
        state: z.literal("expired"),
      })
      .strict(),
  ],
);
export const solutionExportArtifactReferenceV1Schema = z
  .object({
    artifactId: solutionExportArtifactIdSchema,
    digest: sha256DigestSchema,
    downloadAvailability: solutionExportDownloadAvailabilityV1Schema,
    fileCount: z.number().int().nonnegative().max(2_048),
    manifestDigest: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
  })
  .strict();

export const solutionExportJobV1Schema = z
  .object({
    artifact: solutionExportArtifactReferenceV1Schema.optional(),
    cancellation: z
      .object({
        requestedAt: utcTimestampSchema.optional(),
        state: z.enum(["none", "requested", "acknowledged"]),
      })
      .strict(),
    completedAt: utcTimestampSchema.optional(),
    contractVersion: z.literal(1),
    createdAt: utcTimestampSchema,
    applicationVerification:
      solutionExportApplicationVerificationV1Schema.optional(),
    applicationVerifications: z
      .array(solutionExportApplicationVerificationV1Schema)
      .min(2)
      .max(32)
      .optional(),
    diagnostics: z.array(solutionExportDiagnosticV1Schema).max(1_000),
    evidence: z.array(solutionExportEvidenceSummaryV1Schema).max(1_000),
    generationCoverage: solutionGenerationCoverageV1Schema,
    id: solutionExportJobIdSchema,
    pollAfterMilliseconds: z.number().int().min(250).max(30_000).optional(),
    previousArtifactId: solutionExportArtifactIdSchema.optional(),
    rerunOfJobId: solutionExportJobIdSchema.optional(),
    progress: z
      .object({
        completedStages: z.number().int().nonnegative().max(8),
        currentStage: solutionExportStageV1Schema.optional(),
        message: safeUserMessageSchema,
        totalStages: z.literal(8),
      })
      .strict(),
    projectId: projectIdSchema,
    requestDigest: sha256DigestSchema,
    runSequence: z.number().int().min(1).max(1_000_000),
    solutionRevision: z
      .object({
        manifestDigest: sha256DigestSchema,
        manifestRecordId: solutionExportReferenceIdSchema,
        solutionRevisionId: solutionRevisionIdSchema,
      })
      .strict(),
    stages: z.array(solutionExportStageSummaryV1Schema).length(8),
    state: solutionExportJobStateV1Schema,
    target: z
      .object({
        environment: solutionExportEnvironmentV1Schema,
        exportName: z.string().min(1).max(96),
        applicationSource: z
          .enum([
            "ai-source-draft-v1",
            "ai-source-draft-v2",
            "ai-source-draft-v3",
          ])
          .optional(),
        profileId: solutionExportTargetProfileIdV1Schema,
        diagram: solutionExportDiagramOptionsV1Schema,
        settingsDigest: sha256DigestSchema,
      })
      .strict(),
    updatedAt: utcTimestampSchema,
    warnings: z.array(solutionExportWarningV1Schema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.runSequence === 1) !== (value.rerunOfJobId === undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "Only a versioned rerun may reference the preceding export job.",
        path: ["runSequence"],
      });
    }
    const expectedStages = solutionExportStagesForTargetProfile(
      value.target.profileId,
    );
    const validationStage = expectedStages[4];
    const otherValidationStage =
      validationStage === "terraform-validation"
        ? "cloudformation-validation"
        : "terraform-validation";
    if (
      value.progress.currentStage === otherValidationStage ||
      value.diagnostics.some((entry) => entry.stage === otherValidationStage) ||
      value.evidence.some(
        (entry) =>
          entry.stage === otherValidationStage ||
          entry.kind === otherValidationStage,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Validation progress, diagnostics and Evidence must match the selected export target.",
        path: ["target", "profileId"],
      });
    }
    const stagesInCanonicalOrder = value.stages.every(
      ({ stage }, index) => stage === expectedStages[index],
    );
    if (!stagesInCanonicalOrder) {
      context.addIssue({
        code: "custom",
        message: "Every export stage must appear once in canonical order.",
        path: ["stages"],
      });
    }
    if (
      value.generationCoverage.solutionRevisionId !==
      value.solutionRevision.solutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Generation coverage must describe the selected Solution Revision.",
        path: ["generationCoverage", "solutionRevisionId"],
      });
    }
    const applicationVerification = value.applicationVerification;
    if (
      applicationVerification !== undefined &&
      value.applicationVerifications !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Singular and batch application verification projections are mutually exclusive.",
        path: ["applicationVerifications"],
      });
    }
    const applicationVerifications =
      value.applicationVerifications ??
      (applicationVerification === undefined ? [] : [applicationVerification]);
    const evidenceIds = new Set<string>();
    const workloadIds = new Set<string>();
    applicationVerifications.forEach((verification, index) => {
      const root =
        value.applicationVerifications === undefined
          ? ["applicationVerification"]
          : ["applicationVerifications", index];
      const previous = applicationVerifications[index - 1];
      const key = `${verification.workloadId}\u0000${verification.buildRequestDigest}`;
      const previousKey =
        previous === undefined
          ? undefined
          : `${previous.workloadId}\u0000${previous.buildRequestDigest}`;
      if (
        value.applicationVerifications !== undefined &&
        previousKey !== undefined &&
        previousKey >= key
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Application verifications must use canonical workload and build-request order.",
          path: root,
        });
      }
      if (workloadIds.has(verification.workloadId)) {
        context.addIssue({
          code: "custom",
          message:
            "Application verification workload identities must be unique.",
          path: [...root, "workloadId"],
        });
      }
      workloadIds.add(verification.workloadId);
      if (
        verification.evidenceId !== undefined &&
        evidenceIds.has(verification.evidenceId)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Application verification Evidence identities must be unique.",
          path: [...root, "evidenceId"],
        });
      }
      if (verification.evidenceId !== undefined)
        evidenceIds.add(verification.evidenceId);
      if (
        verification.solutionRevisionId !==
          value.solutionRevision.solutionRevisionId ||
        verification.solutionRevisionDigest !==
          value.solutionRevision.manifestDigest
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Application verification must bind the exact selected Solution Revision.",
          path: [...root, "solutionRevisionId"],
        });
      }
      if (verification.inputState !== value.generationCoverage.state) {
        context.addIssue({
          code: "custom",
          message:
            "Application verification input must equal the immutable revision generation coverage.",
          path: [...root, "inputState"],
        });
      }
      if (
        verification.evidenceId !== undefined &&
        !value.evidence.some(
          (evidence) =>
            evidence.evidenceId === verification.evidenceId &&
            evidence.kind === "application-build" &&
            evidence.stage === "application-build" &&
            evidence.status === "passed" &&
            evidence.reference?.evidenceId === verification.evidenceId,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Confirmed application verification must retain its durable passing build Evidence.",
          path: [...root, "evidenceId"],
        });
      }
      if (
        verification.confirmedState === "custom-implementation-required" &&
        value.state === "succeeded"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Downgraded application verification cannot publish a successful export.",
          path: [...root, "confirmedState"],
        });
      }
    });
    if (value.state === "succeeded") {
      const generatedCoverage =
        value.generationCoverage.state === "starter-application" ||
        value.generationCoverage.state === "complete-supported-pattern";
      if (
        generatedCoverage &&
        (applicationVerifications.length === 0 ||
          applicationVerifications.some(
            (verification) =>
              verification.confirmedState !== value.generationCoverage.state ||
              verification.evidenceId === undefined,
          ))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A successful generated export requires confirmed application verification with durable Evidence.",
          path: ["applicationVerification"],
        });
      }
      if (!generatedCoverage && applicationVerifications.length > 0) {
        context.addIssue({
          code: "custom",
          message:
            "A successful non-generated export cannot claim application verification.",
          path: ["applicationVerification"],
        });
      }
    }
    const pollable = ["queued", "running", "cancellation-requested"].includes(
      value.state,
    );
    if (pollable !== (value.pollAfterMilliseconds !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only active jobs provide server-directed polling cadence.",
        path: ["pollAfterMilliseconds"],
      });
    }
    const published = value.artifact !== undefined;
    if ((value.state === "succeeded") !== published) {
      context.addIssue({
        code: "custom",
        message:
          "A successful export job must publish exactly one verified artifact.",
        path: ["artifact"],
      });
    }
    const terminal = ["succeeded", "failed", "canceled"].includes(value.state);
    if (terminal !== (value.completedAt !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only terminal export jobs must include completion time.",
        path: ["completedAt"],
      });
    }
    value.evidence.forEach((evidence, index) => {
      const reference = evidence.reference;
      if (reference === undefined) return;
      if (
        reference.solutionRevisionId !==
          value.solutionRevision.solutionRevisionId ||
        reference.environment.environmentType !==
          value.target.environment.environmentType ||
        reference.environment.environmentId !==
          value.target.environment.environmentId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Durable Evidence must match the selected revision and target environment.",
          path: ["evidence", index, "reference"],
        });
      }
    });
    const stageStatuses = value.stages.map(({ status }) => status);
    if (value.state === "succeeded") {
      const statusByStage = new Map(
        value.stages.map(({ stage, status }) => [stage, status] as const),
      );
      const applicationGenerationStatus = statusByStage.get(
        "application-generation",
      );
      const hasVerifiedApplication = applicationVerifications.length > 0;
      const hasExpectedApplicationStages = hasVerifiedApplication
        ? applicationGenerationStatus === "succeeded" &&
          statusByStage.get("application-build") === "succeeded"
        : (applicationGenerationStatus === "skipped" ||
            applicationGenerationStatus === "succeeded") &&
          statusByStage.get("application-build") === "skipped";
      const hasCanonicalSuccessStages =
        (
          [
            "authorization",
            "compilation",
            validationStage,
            "diagram-rendering",
            "packaging",
            "publication",
          ] as const
        ).every((stage) => statusByStage.get(stage) === "succeeded") &&
        hasExpectedApplicationStages;
      const hasDurableTargetValidationEvidence = value.evidence.some(
        (evidence) =>
          evidence.kind === validationStage &&
          evidence.stage === validationStage &&
          evidence.status === "passed" &&
          evidence.reference?.evidenceId === evidence.evidenceId,
      );
      if (
        value.progress.completedStages !== 8 ||
        value.progress.currentStage !== undefined ||
        !hasCanonicalSuccessStages ||
        !hasDurableTargetValidationEvidence ||
        value.diagnostics.some(({ severity }) => severity === "error") ||
        value.evidence.some(({ status }) => status === "failed")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Successful exports require the canonical stage matrix and durable passing validation Evidence for the selected target.",
          path: ["state"],
        });
      }
    }
    if (
      value.state === "failed" &&
      (!stageStatuses.includes("failed") ||
        (!value.diagnostics.some(({ severity }) => severity === "error") &&
          !value.evidence.some(({ status }) => status === "failed")))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Failed exports must retain a failed stage and reviewable failure evidence or diagnostics.",
        path: ["state"],
      });
    }
    if (
      value.state === "canceled" &&
      (value.cancellation.state !== "acknowledged" ||
        !stageStatuses.includes("canceled"))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Canceled exports must acknowledge cancellation and retain the canceled stage.",
        path: ["cancellation"],
      });
    }
    if (
      ["succeeded", "failed", "canceled"].includes(value.state) &&
      value.progress.currentStage !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Terminal exports cannot report a current stage.",
        path: ["progress", "currentStage"],
      });
    }
  });

export const solutionExportOwnershipV1Schema = z.enum([
  "architecture-as-code-source",
  "generated-replaceable",
  "user-owned-extension",
  "user-provided",
  "generated-build-artifact",
  "evidence-artifact",
]);

export const solutionExportMediaTypeV1Schema = z.enum([
  "application/json",
  "application/pdf",
  "application/vnd.cyclonedx+json",
  "application/vnd.hashicorp.terraform",
  "application/vnd.amazon.cloudformation.template+json",
  "application/yaml",
  "application/zip",
  "image/png",
  "image/svg+xml",
  "text/markdown",
  "text/plain",
  "text/typescript",
  "text/javascript",
]);

export const solutionExportArtifactFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    id: solutionExportArtifactFileIdSchema,
    mediaType: solutionExportMediaTypeV1Schema,
    ownership: solutionExportOwnershipV1Schema,
    path: repositoryRelativePathSchema,
    previewAvailable: z.boolean(),
    semanticChecksum: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(32 * 1024 * 1024),
  })
  .strict();

function portableRepositoryPathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export const solutionExportArtifactV1Schema = z
  .object({
    archiveFileName: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}\.zip$/),
    contractVersion: z.literal(1),
    createdAt: utcTimestampSchema,
    digest: sha256DigestSchema,
    downloadAvailability: solutionExportDownloadAvailabilityV1Schema,
    fileCount: z.number().int().nonnegative().max(2_048),
    files: z.array(solutionExportArtifactFileV1Schema).max(2_048),
    id: solutionExportArtifactIdSchema,
    jobId: solutionExportJobIdSchema,
    manifestDigest: sha256DigestSchema,
    previousArtifactId: solutionExportArtifactIdSchema.optional(),
    projectId: projectIdSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
    solutionRevisionId: solutionRevisionIdSchema,
    warnings: z.array(solutionExportWarningV1Schema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fileCount !== value.files.length) {
      context.addIssue({
        code: "custom",
        message: "Artifact file count must match the file metadata.",
        path: ["fileCount"],
      });
    }
    const portablePaths = new Set<string>();
    const ids = new Set<string>();
    for (const [index, file] of value.files.entries()) {
      const portablePath = portableRepositoryPathKey(file.path);
      if (portablePaths.has(portablePath)) {
        context.addIssue({
          code: "custom",
          message:
            "Artifact paths must be unique after NFC normalization and case folding.",
          path: ["files", index, "path"],
        });
      }
      if (ids.has(file.id)) {
        context.addIssue({
          code: "custom",
          message: "Artifact file identifiers must be unique.",
          path: ["files", index, "id"],
        });
      }
      const previous = value.files[index - 1];
      if (previous !== undefined && previous.path >= file.path) {
        context.addIssue({
          code: "custom",
          message: "Artifact files must use canonical UTF-16 path order.",
          path: ["files", index, "path"],
        });
      }
      portablePaths.add(portablePath);
      ids.add(file.id);
    }
  });

export const solutionExportFilePreviewV1Schema = z
  .object({
    artifactId: solutionExportArtifactIdSchema,
    checksum: sha256DigestSchema,
    content: z.string().max(256 * 1024),
    contractVersion: z.literal(1),
    fileId: solutionExportArtifactFileIdSchema,
    mediaType: z.enum([
      "application/json",
      "application/vnd.hashicorp.terraform",
      "application/vnd.amazon.cloudformation.template+json",
      "application/yaml",
      "image/svg+xml",
      "text/markdown",
      "text/plain",
      "text/typescript",
      "text/javascript",
    ]),
    path: repositoryRelativePathSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(32 * 1024 * 1024),
    truncated: z.boolean(),
  })
  .strict();

export const solutionExportFileDiffSnapshotV1Schema =
  solutionExportArtifactFileV1Schema.omit({
    id: true,
    previewAvailable: true,
  });

export const solutionExportFileDiffV1Schema = z
  .object({
    after: solutionExportFileDiffSnapshotV1Schema.optional(),
    before: solutionExportFileDiffSnapshotV1Schema.optional(),
    change: z.enum(["added", "removed", "modified", "unchanged"]),
    path: repositoryRelativePathSchema,
    semanticChange: z.enum([
      "added",
      "removed",
      "changed",
      "formatting-only",
      "unchanged",
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const beforeMatches = value.before?.path === value.path;
    const afterMatches = value.after?.path === value.path;
    const invalidShape =
      (value.change === "added" &&
        (value.before !== undefined ||
          value.after === undefined ||
          value.semanticChange !== "added" ||
          !afterMatches)) ||
      (value.change === "removed" &&
        (value.before === undefined ||
          value.after !== undefined ||
          value.semanticChange !== "removed" ||
          !beforeMatches)) ||
      (value.change === "modified" &&
        (value.before === undefined ||
          value.after === undefined ||
          !beforeMatches ||
          !afterMatches ||
          !["changed", "formatting-only"].includes(value.semanticChange))) ||
      (value.change === "unchanged" &&
        (value.before === undefined ||
          value.after === undefined ||
          !beforeMatches ||
          !afterMatches ||
          value.semanticChange !== "unchanged" ||
          JSON.stringify(value.before) !== JSON.stringify(value.after)));
    if (invalidShape) {
      context.addIssue({
        code: "custom",
        message:
          "Diff change, semantic change, path, and before/after snapshots must agree.",
        path: ["change"],
      });
    }
    if (
      value.change === "modified" &&
      value.before !== undefined &&
      value.after !== undefined
    ) {
      const snapshotsDiffer =
        JSON.stringify(value.before) !== JSON.stringify(value.after);
      const metadataMatches =
        value.before.mediaType === value.after.mediaType &&
        value.before.ownership === value.after.ownership;
      const formattingOnly =
        value.before.checksum !== value.after.checksum &&
        value.before.semanticChecksum === value.after.semanticChecksum &&
        metadataMatches;
      if (
        !snapshotsDiffer ||
        (value.semanticChange === "formatting-only") !== formattingOnly
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Modified diffs require a changed snapshot and exact semantic or metadata classification.",
          path: ["semanticChange"],
        });
      }
    }
  });

export const solutionExportArtifactDiffV1Schema = z
  .object({
    artifactId: solutionExportArtifactIdSchema,
    contractVersion: z.literal(1),
    files: z.array(solutionExportFileDiffV1Schema).max(4_096),
    previousArtifactId: solutionExportArtifactIdSchema.optional(),
    state: z.enum(["unavailable", "available"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.state === "unavailable" &&
        (value.files.length !== 0 || value.previousArtifactId !== undefined)) ||
      (value.state === "available" && value.previousArtifactId === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only an available baseline may expose deterministic file differences.",
        path: ["state"],
      });
    }
    const paths = new Set<string>();
    value.files.forEach((file, index) => {
      const portablePath = portableRepositoryPathKey(file.path);
      if (paths.has(portablePath)) {
        context.addIssue({
          code: "custom",
          message:
            "Diff paths must be unique after NFC normalization and case folding.",
          path: ["files", index, "path"],
        });
      }
      const previous = value.files[index - 1];
      if (previous !== undefined && previous.path >= file.path) {
        context.addIssue({
          code: "custom",
          message: "Diff files must use canonical UTF-16 path order.",
          path: ["files", index, "path"],
        });
      }
      paths.add(portablePath);
    });
  });

export const solutionExportDownloadGrantV1Schema = z
  .object({
    artifactId: solutionExportArtifactIdSchema,
    contractVersion: z.literal(1),
    digest: sha256DigestSchema,
    expiresAt: utcTimestampSchema,
    fileName: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}\.zip$/),
    id: solutionExportDownloadGrantIdSchema,
    mediaType: z.literal("application/zip"),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
    url: z
      .string()
      .min(1)
      .max(1_024)
      .regex(/^\/v1\/[A-Za-z0-9/_-]+$/),
  })
  .strict();

export const solutionExportDownloadContentV1Schema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength <= 64 * 1024 * 1024);

export const solutionExportDownloadResponseHeadersV1Schema = z
  .object({
    "cache-control": z.literal("private, no-store"),
    "content-disposition": z
      .string()
      .regex(/^attachment; filename="[a-z0-9][a-z0-9._-]{0,95}\.zip"$/),
    "content-length": z.string().regex(/^(?:0|[1-9][0-9]{0,7})$/),
    "content-security-policy": z.literal("sandbox"),
    "content-type": z.literal("application/zip"),
    "referrer-policy": z.literal("no-referrer"),
    "x-cloudmarkup-content-sha256": sha256DigestSchema,
    "x-content-type-options": z.literal("nosniff"),
  })
  .strict();

export const solutionExportJobResponseV1Schema = createDataEnvelopeSchema(
  solutionExportJobV1Schema,
);
export const solutionExportArtifactResponseV1Schema = createDataEnvelopeSchema(
  solutionExportArtifactV1Schema,
);
export const solutionExportFilePreviewResponseV1Schema =
  createDataEnvelopeSchema(solutionExportFilePreviewV1Schema);
export const solutionExportArtifactDiffResponseV1Schema =
  createDataEnvelopeSchema(solutionExportArtifactDiffV1Schema);
export const solutionExportDownloadGrantResponseV1Schema =
  createDataEnvelopeSchema(solutionExportDownloadGrantV1Schema);

export type SolutionExportDiagramOptionsV1 = z.output<
  typeof solutionExportDiagramOptionsV1Schema
>;
export type CreateSolutionExportJobV1 = z.output<
  typeof createSolutionExportJobV1Schema
>;
export type SolutionExportDownloadAvailabilityV1 = z.output<
  typeof solutionExportDownloadAvailabilityV1Schema
>;
export type SolutionExportArtifactReferenceV1 = z.output<
  typeof solutionExportArtifactReferenceV1Schema
>;
export interface SolutionExportDiagnosticV1 {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  stage: z.output<typeof solutionExportStageV1Schema>;
  edgeId?: string | undefined;
  nodeId?: string | undefined;
  ownedPolicyId?: string | undefined;
  workloadId?: string | undefined;
  path?: z.output<typeof repositoryRelativePathSchema> | undefined;
  recoveryReferences?: ExportDiagnosticRecoveryReferencesV1 | undefined;
}
export type SolutionExportEvidenceSummaryV1 = z.output<
  typeof solutionExportEvidenceSummaryV1Schema
>;
export type SolutionExportApplicationVerificationV1 = z.output<
  typeof solutionExportApplicationVerificationV1Schema
>;
export type SolutionExportWarningV1 = z.output<
  typeof solutionExportWarningV1Schema
>;
export type SolutionExportStageSummaryV1 = z.output<
  typeof solutionExportStageSummaryV1Schema
>;
export type SolutionExportJobV1 = z.output<typeof solutionExportJobV1Schema>;
export type SolutionExportArtifactV1 = z.output<
  typeof solutionExportArtifactV1Schema
>;
export type SolutionExportArtifactFileV1 = z.output<
  typeof solutionExportArtifactFileV1Schema
>;
export type SolutionExportFilePreviewV1 = z.output<
  typeof solutionExportFilePreviewV1Schema
>;
export type SolutionExportArtifactDiffV1 = z.output<
  typeof solutionExportArtifactDiffV1Schema
>;
export type SolutionExportDownloadGrantV1 = z.output<
  typeof solutionExportDownloadGrantV1Schema
>;
export type SolutionExportDownloadContentV1 = z.output<
  typeof solutionExportDownloadContentV1Schema
>;
export type SolutionExportDownloadResponseHeadersV1 = z.output<
  typeof solutionExportDownloadResponseHeadersV1Schema
>;
