import { diagramExportSelectionV1Schema } from "@cloudmarkup/diagram-export/contracts";
import {
  applicationBuildCoverageV1Schema,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  type ApplicationBuildCoverageV1,
  type ApplicationBuildRequestV1,
  type ApplicationBuildResultV1,
} from "@cloudmarkup/application-build-runner";
import {
  applicationPatternPinV1Schema,
  applicationRuntimePinV1Schema,
  applicationTemplatePinV1Schema,
  asyncJobArtifactIdSchema,
  asyncJobArtifactReferenceV1Schema,
  asyncJobDurableInputReferenceV1Schema,
  asyncJobEnvironmentV1Schema,
  asyncJobEvidenceReferenceV1Schema,
  asyncJobIdSchema,
  asyncJobSolutionRevisionSubjectV1Schema,
  evidenceIdSchema,
  exportDiagnosticRecoveryReferencesV1Schema,
  namespacedIdentifierSchema,
  repositoryRelativePathSchema,
  serializeCanonicalJson,
  sha256DigestSchema,
  type AsyncJobArtifactReferenceV1,
  type AsyncJobEvidenceReferenceV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  exactToolPinV1Schema,
  sha256Digest,
  solutionExportCloudFormationApprovedTargetV1Schema,
  solutionExportTerraformApprovedTargetV1Schema,
} from "@cloudmarkup/solution-export";
import { z } from "zod";

export const SOLUTION_EXPORT_WORKFLOW_V1_LIMITS = Object.freeze({
  diagnostics: 256,
  diffEntries: 2_048,
  evidenceRecords: 32,
  stageReports: 2,
  stages: 10,
  warnings: 32,
} as const);

const exportNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes(":") &&
      !value.includes(String.fromCodePoint(0)),
    "Export names cannot contain path separators, ADS syntax, or NUL.",
  );

const availablePreviousPackageSchema = asyncJobArtifactReferenceV1Schema
  .refine(
    (value) => value.object.purpose === "export-package",
    "Previous export must reference an export package.",
  )
  .refine(
    (value) => value.availability.state === "available",
    "Previous export must still be available.",
  )
  .refine(
    (value) => value.object.expiresAt === undefined,
    "A retry-bound previous export reference cannot expire.",
  );

const durableJsonInputReferenceSchema = asyncJobDurableInputReferenceV1Schema
  .extend({ mediaType: z.literal("application/json") })
  .strict();

const workflowStageDescriptorV1Schema = z
  .object({
    adapter: exactToolPinV1Schema,
    limitsDigest: sha256DigestSchema,
    profileDigest: sha256DigestSchema,
    profileId: namespacedIdentifierSchema,
  })
  .strict();

const applicationGenerationStageDescriptorV1Schema =
  workflowStageDescriptorV1Schema
    .extend({
      pattern: applicationPatternPinV1Schema,
      runtime: applicationRuntimePinV1Schema,
      template: applicationTemplatePinV1Schema,
    })
    .strict();

const applicationBuildStageDescriptorV1Schema = workflowStageDescriptorV1Schema
  .extend({
    dependencyContractDigest: sha256DigestSchema,
    toolchainDigest: sha256DigestSchema,
  })
  .strict();

const terraformValidationStageDescriptorV1Schema =
  workflowStageDescriptorV1Schema
    .extend({ policyDigest: sha256DigestSchema })
    .strict();

const workflowStageDescriptorCommonShape = {
  applicationBuild: applicationBuildStageDescriptorV1Schema,
  applicationGenerator: applicationGenerationStageDescriptorV1Schema,
  compiler: workflowStageDescriptorV1Schema,
  diagramRenderer: workflowStageDescriptorV1Schema,
  exporter: workflowStageDescriptorV1Schema,
};

export const solutionExportWorkflowStageDescriptorsV1Schema = z
  .object({
    ...workflowStageDescriptorCommonShape,
    terraformValidation: terraformValidationStageDescriptorV1Schema,
  })
  .strict();

export const solutionExportCloudFormationWorkflowStageDescriptorsV1Schema = z
  .object({
    ...workflowStageDescriptorCommonShape,
    cloudFormationValidation: workflowStageDescriptorV1Schema,
  })
  .strict();

const workflowTargetSettingsExtension = {
  contractVersion: z.literal(1),
};

const terraformWorkflowTargetSettingsProjectionV1Schema =
  solutionExportTerraformApprovedTargetV1Schema
    .omit({ exportName: true })
    .extend({
      ...workflowTargetSettingsExtension,
      stageDescriptors: solutionExportWorkflowStageDescriptorsV1Schema,
    })
    .strict();

const cloudFormationWorkflowTargetSettingsProjectionV1Schema =
  solutionExportCloudFormationApprovedTargetV1Schema
    .omit({ exportName: true })
    .extend({
      ...workflowTargetSettingsExtension,
      stageDescriptors:
        solutionExportCloudFormationWorkflowStageDescriptorsV1Schema,
    })
    .strict();

export const solutionExportWorkflowTargetSettingsProjectionV1Schema =
  z.discriminatedUnion("target", [
    terraformWorkflowTargetSettingsProjectionV1Schema,
    cloudFormationWorkflowTargetSettingsProjectionV1Schema,
  ]);

export type SolutionExportWorkflowStageDescriptorsV1 = z.output<
  typeof solutionExportWorkflowStageDescriptorsV1Schema
>;

export type SolutionExportCloudFormationWorkflowStageDescriptorsV1 = z.output<
  typeof solutionExportCloudFormationWorkflowStageDescriptorsV1Schema
>;

export type SolutionExportWorkflowTargetSettingsProjectionV1 = z.output<
  typeof solutionExportWorkflowTargetSettingsProjectionV1Schema
>;

export function solutionExportWorkflowTargetSettingsDigest(
  settings: SolutionExportWorkflowTargetSettingsProjectionV1,
): Sha256Digest {
  return sha256Digest(serializeCanonicalJson(settings));
}

export const solutionExportWorkflowTargetSettingsV1Schema = z
  .discriminatedUnion("target", [
    terraformWorkflowTargetSettingsProjectionV1Schema
      .extend({ digest: sha256DigestSchema })
      .strict(),
    cloudFormationWorkflowTargetSettingsProjectionV1Schema
      .extend({ digest: sha256DigestSchema })
      .strict(),
  ])
  .superRefine((value, context) => {
    const { digest, ...projection } = value;
    if (digest !== solutionExportWorkflowTargetSettingsDigest(projection)) {
      context.addIssue({
        code: "custom",
        message:
          "Approved target settings must carry their exact canonical digest.",
        path: ["digest"],
      });
    }
  });

const solutionExportRepositoryWorkflowReviewRevisionV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: asyncJobSolutionRevisionSubjectV1Schema.shape.solutionRevisionId,
  })
  .strict();

/**
 * Durable, host-reviewed authority for optional repository-workflow composition.
 * The provider-specific configuration remains untrusted data until its reviewed
 * composition adapter parses, generates, validates, and seals it.
 */
export const solutionExportRepositoryWorkflowReviewV1Schema = z
  .discriminatedUnion("decision", [
    z
      .object({
        configuration: z.record(z.string(), z.unknown()),
        configurationDigest: sha256DigestSchema,
        contractVersion: z.literal(1),
        decision: z.literal("approved"),
        kind: z.literal(
          "cloudmarkup.solution-export-repository-workflow-review",
        ),
        solutionRevision:
          solutionExportRepositoryWorkflowReviewRevisionV1Schema,
      })
      .strict(),
    z
      .object({
        contractVersion: z.literal(1),
        decision: z.literal("denied"),
        kind: z.literal(
          "cloudmarkup.solution-export-repository-workflow-review",
        ),
        reason: z.enum(["not-approved", "policy-denied", "review-rejected"]),
        solutionRevision:
          solutionExportRepositoryWorkflowReviewRevisionV1Schema,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (
      value.decision === "approved" &&
      value.configurationDigest !==
        sha256Digest(serializeCanonicalJson(value.configuration))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Approved repository-workflow configuration must carry its exact canonical digest.",
        path: ["configurationDigest"],
      });
    }
  });

export const solutionExportWorkflowSourceInputsV1Schema = z
  .object({
    applicationBuildInputs: durableJsonInputReferenceSchema.optional(),
    architectureDocument: durableJsonInputReferenceSchema,
    existingFiles: durableJsonInputReferenceSchema.optional(),
    repositoryWorkflowReview: durableJsonInputReferenceSchema.optional(),
    solutionRevision: durableJsonInputReferenceSchema,
    workloadBehavior: durableJsonInputReferenceSchema,
  })
  .strict();

const SOLUTION_EXPORT_APPLICATION_BUILD_BATCH_MAXIMUM = 32;

function generatedBuildRequestIdentity(
  request: ApplicationBuildRequestV1,
): string | undefined {
  if (request.source.kind !== "generated") return undefined;
  const source = request.source;
  const envelope = source.applicationGeneration.artifact.buildContracts.find(
    ({ contractDigest }) => contractDigest === source.buildContractDigest,
  );
  return envelope === undefined
    ? undefined
    : `${envelope.contract.workloadId}\u0000${envelope.contractDigest}`;
}

export const solutionExportApplicationBuildBatchInputV1Schema = z
  .object({
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.application-build-batch-input"),
    requests: z
      .array(applicationBuildRequestV1Schema)
      .min(1)
      .max(SOLUTION_EXPORT_APPLICATION_BUILD_BATCH_MAXIMUM),
  })
  .strict()
  .superRefine((value, context) => {
    const identities = new Set<string>();
    value.requests.forEach((request, index) => {
      const identity = generatedBuildRequestIdentity(request);
      if (identity === undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Application build batches accept only exact generated requests with a matching build envelope.",
          path: ["requests", index, "source"],
        });
        return;
      }
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          message:
            "Application build batch workload and build-contract identities must be unique.",
          path: ["requests", index],
        });
      }
      identities.add(identity);
      const previous = value.requests[index - 1];
      const previousIdentity =
        previous === undefined
          ? undefined
          : generatedBuildRequestIdentity(previous);
      if (previousIdentity !== undefined && previousIdentity >= identity) {
        context.addIssue({
          code: "custom",
          message:
            "Application build batch requests must use canonical workload and build-contract order.",
          path: ["requests", index],
        });
      }
    });
  });

export const solutionExportApplicationBuildBatchResultV1Schema = z
  .object({
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.application-build-batch-result"),
    reportDigest: sha256DigestSchema,
    results: z
      .array(applicationBuildResultV1Schema)
      .min(1)
      .max(SOLUTION_EXPORT_APPLICATION_BUILD_BATCH_MAXIMUM),
  })
  .strict()
  .superRefine((value, context) => {
    const { reportDigest, ...projection } = value;
    if (reportDigest !== sha256Digest(serializeCanonicalJson(projection))) {
      context.addIssue({
        code: "custom",
        message:
          "Application build batch report digest must hash the canonical result projection.",
        path: ["reportDigest"],
      });
    }
    const workloads = new Set<string>();
    const evidence = new Set<string>();
    const portablePaths = new Set<string>();
    value.results.forEach((result, index) => {
      const key = `${result.coverage.workloadId}\u0000${result.coverage.buildRequestDigest}`;
      const previous = value.results[index - 1];
      const previousKey =
        previous === undefined
          ? undefined
          : `${previous.coverage.workloadId}\u0000${previous.coverage.buildRequestDigest}`;
      if (previousKey !== undefined && previousKey >= key) {
        context.addIssue({
          code: "custom",
          message:
            "Application build batch results must use canonical workload and request order.",
          path: ["results", index],
        });
      }
      if (workloads.has(result.coverage.workloadId)) {
        context.addIssue({
          code: "custom",
          message:
            "Application build batch workload identities must be unique.",
          path: ["results", index, "coverage", "workloadId"],
        });
      }
      workloads.add(result.coverage.workloadId);
      if (evidence.has(result.evidence.id)) {
        context.addIssue({
          code: "custom",
          message:
            "Application build batch Evidence identities must be unique.",
          path: ["results", index, "evidence", "id"],
        });
      }
      evidence.add(result.evidence.id);
      result.artifacts.forEach((artifact, artifactIndex) => {
        const path = artifact.path.normalize("NFC").toLowerCase();
        if (portablePaths.has(path)) {
          context.addIssue({
            code: "custom",
            message:
              "Application build batch artifact paths must be portable and unique.",
            path: ["results", index, "artifacts", artifactIndex, "path"],
          });
        }
        portablePaths.add(path);
      });
    });
  });

export function solutionExportApplicationBuildBatchReportDigest(
  results: readonly ApplicationBuildResultV1[],
): Sha256Digest {
  return sha256Digest(
    serializeCanonicalJson({
      contractVersion: 1,
      kind: "cloudmarkup.application-build-batch-result",
      results,
    }),
  );
}

export const solutionExportWorkflowRequestV1Schema = z
  .object({
    contractVersion: z.literal(1),
    diagram: diagramExportSelectionV1Schema,
    environment: asyncJobEnvironmentV1Schema,
    exportName: exportNameSchema,
    kind: z.literal("cloudmarkup.solution-export-workflow-request"),
    applicationSource: z
      .enum(["ai-source-draft-v1", "ai-source-draft-v2", "ai-source-draft-v3"])
      .optional(),
    applicationDelivery: z.literal("infrastructure-only-v1").optional(),
    previousPackage: availablePreviousPackageSchema.optional(),
    sources: solutionExportWorkflowSourceInputsV1Schema,
    subject: asyncJobSolutionRevisionSubjectV1Schema,
    targetProfileId: namespacedIdentifierSchema,
    targetSettings: solutionExportWorkflowTargetSettingsV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.applicationDelivery !== undefined &&
      (value.applicationSource !== undefined ||
        value.sources.applicationBuildInputs !== undefined ||
        value.targetProfileId !==
          "cloudmarkup.export.cloudformation-nodejs24-v1" ||
        value.targetSettings.target !== "cloudformation")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Infrastructure delivery cannot request application source, builds, or another target.",
        path: ["applicationDelivery"],
      });
    }
    if (
      value.sources.solutionRevision.digest !== value.subject.manifestDigest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The Solution Revision content must match the exact immutable subject digest.",
        path: ["sources", "solutionRevision"],
      });
    }
  });

export function solutionExportWorkflowRequestDigest(
  request: SolutionExportWorkflowRequestV1,
): Sha256Digest {
  return sha256Digest(serializeCanonicalJson(request));
}

export const solutionExportWorkflowStageIdV1Schema = z.enum([
  "resolve-request",
  "compile-infrastructure",
  "generate-application",
  "build-application",
  "validate-infrastructure",
  "render-diagram",
  "package-export",
  "verify-export",
  "compare-export",
  "persist-output",
]);

export const SOLUTION_EXPORT_WORKFLOW_STAGE_ORDER = Object.freeze([
  ...solutionExportWorkflowStageIdV1Schema.options,
] as const);

export const solutionExportWorkflowFailureV1Schema = z
  .object({
    classification: z.enum(["transient", "permanent"]),
    code: namespacedIdentifierSchema,
    publicMessage: z.enum([
      "export-input-invalid",
      "export-not-supported",
      "export-compile-failed",
      "export-generation-failed",
      "export-build-failed",
      "export-validation-failed",
      "export-diagram-failed",
      "export-packaging-failed",
      "export-integrity-failed",
      "export-temporarily-unavailable",
      "export-internal-error",
    ]),
    retryAfterSeconds: z.number().int().positive().max(86_400).optional(),
    stage: solutionExportWorkflowStageIdV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.classification === "permanent" &&
      value.retryAfterSeconds !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Permanent workflow failures cannot advertise a retry delay.",
        path: ["retryAfterSeconds"],
      });
    }
  });

export const solutionExportWorkflowArtifactKindV1Schema = z.enum([
  "compiler-result",
  "application-source",
  "cloudformation-validation-report",
  "application-build-report",
  "terraform-validation-report",
  "diagram-render",
  "export-package",
]);

export const solutionExportWorkflowArtifactV1Schema = z
  .object({
    archiveFileName: z.string().min(1).max(128).optional(),
    artifactId: asyncJobArtifactIdSchema.optional(),
    digest: sha256DigestSchema,
    kind: solutionExportWorkflowArtifactKindV1Schema,
    manifestDigest: sha256DigestSchema.optional(),
    mediaType: z.string().min(1).max(128),
    object: asyncJobArtifactReferenceV1Schema.shape.object.optional(),
    sizeBytes: z.number().int().nonnegative().max(2_147_483_648),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.object !== undefined) {
      if (
        value.object.digest !== value.digest ||
        value.object.mediaType !== value.mediaType ||
        value.object.sizeBytes !== value.sizeBytes
      ) {
        context.addIssue({
          code: "custom",
          message: "Artifact metadata must equal its durable object reference.",
          path: ["object"],
        });
      }
    }
    const isExport = value.kind === "export-package";
    const hasExportMetadata =
      value.archiveFileName !== undefined && value.manifestDigest !== undefined;
    if (isExport !== hasExportMetadata) {
      context.addIssue({
        code: "custom",
        message:
          "Only export-package artifacts require archive and manifest metadata.",
        path: ["kind"],
      });
    }
    if (
      isExport &&
      value.object !== undefined &&
      value.object.purpose !== "export-package"
    ) {
      context.addIssue({
        code: "custom",
        message: "Persisted export artifacts must use export-package objects.",
        path: ["object", "purpose"],
      });
    }
    if ((value.artifactId === undefined) !== (value.object === undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "Durable artifact identity and object must be present together.",
        path: ["artifactId"],
      });
    }
  });

export const solutionExportWorkflowDiagnosticV1Schema = z
  .object({
    recoveryReferences: exportDiagnosticRecoveryReferencesV1Schema.optional(),
    code: z
      .string()
      .min(3)
      .max(128)
      .regex(
        /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)+$/u,
        "Must be a stable public diagnostic code.",
      ),
    edgeId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
      .optional(),
    nodeId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
      .optional(),
    origin: z.enum([
      "compiler",
      "application-generator",
      "cloudformation-validation",
      "application-build",
      "terraform-validation",
      "diagram-renderer",
      "packager",
      "workflow",
    ]),
    ownedPolicyId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
      .optional(),
    path: repositoryRelativePathSchema.optional(),
    severity: z.enum(["error", "warning", "info"]),
    stage: solutionExportWorkflowStageIdV1Schema,
    workloadId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
      .optional(),
  })
  .strict();

export function solutionExportWorkflowDiagnosticKey(
  value: z.output<typeof solutionExportWorkflowDiagnosticV1Schema>,
): string {
  return [
    value.stage,
    value.origin,
    value.severity,
    value.code,
    value.path ?? "",
    value.nodeId ?? "",
    value.edgeId ?? "",
    value.ownedPolicyId ?? "",
    value.workloadId ?? "",
    serializeCanonicalJson(value.recoveryReferences ?? null),
  ].join("\u0000");
}

export const solutionExportWorkflowEvidenceSemanticsV1Schema = z
  .object({
    evidenceId: evidenceIdSchema,
    kind: z.enum([
      "infrastructure-compilation",
      "cloudformation-validation",
      "application-build",
      "terraform-validation",
    ]),
    status: z.enum(["passed", "failed", "incomplete"]),
  })
  .strict();

export const solutionExportWorkflowStageReportV1Schema = z
  .object({
    artifact: solutionExportWorkflowArtifactV1Schema,
    evidenceRecords: z
      .array(asyncJobEvidenceReferenceV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.evidenceRecords),
    stage: z.enum(["build-application", "validate-infrastructure"]),
  })
  .strict()
  .superRefine((value, context) => {
    const isBuild = value.stage === "build-application";
    const expectedKinds = isBuild
      ? ["application-build-report"]
      : ["cloudformation-validation-report", "terraform-validation-report"];
    if (
      !expectedKinds.includes(value.artifact.kind) ||
      value.artifact.object === undefined ||
      value.artifact.artifactId === undefined ||
      value.artifact.object.purpose !==
        (isBuild ? "build-output" : "validation-report")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Stage reports must bind a durable report object for the exact stage.",
        path: ["artifact"],
      });
    }
    value.evidenceRecords.forEach((evidence, index) => {
      if (
        value.evidenceRecords.findIndex(
          (candidate) => candidate.evidenceId === evidence.evidenceId,
        ) !== index
      ) {
        context.addIssue({
          code: "custom",
          message: "Stage Evidence references must be unique.",
          path: ["evidenceRecords", index, "evidenceId"],
        });
      }
    });
  });

export const solutionExportWorkflowStageV1Schema = z
  .object({
    artifact: solutionExportWorkflowArtifactV1Schema.optional(),
    failure: solutionExportWorkflowFailureV1Schema.optional(),
    stage: solutionExportWorkflowStageIdV1Schema,
    state: z.enum([
      "pending",
      "running",
      "succeeded",
      "skipped",
      "failed",
      "canceled",
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.state === "failed") !== (value.failure !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only failed stages require one sanitized failure.",
        path: ["failure"],
      });
    }
    if (value.failure !== undefined && value.failure.stage !== value.stage) {
      context.addIssue({
        code: "custom",
        message: "Stage failure identity must match its containing stage.",
        path: ["failure", "stage"],
      });
    }
    if (
      value.artifact !== undefined &&
      value.state !== "succeeded" &&
      value.state !== "skipped"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only completed stages may expose artifact metadata.",
        path: ["artifact"],
      });
    }
  });

export const solutionExportWorkflowFileDiffEntryV1Schema = z
  .object({
    change: z.enum(["added", "modified", "removed", "unchanged"]),
    currentChecksum: sha256DigestSchema.optional(),
    path: repositoryRelativePathSchema,
    previousChecksum: sha256DigestSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const current = value.currentChecksum;
    const previous = value.previousChecksum;
    const valid =
      (value.change === "added" &&
        current !== undefined &&
        previous === undefined) ||
      (value.change === "removed" &&
        current === undefined &&
        previous !== undefined) ||
      (value.change === "modified" &&
        current !== undefined &&
        previous !== undefined &&
        current !== previous) ||
      (value.change === "unchanged" &&
        current !== undefined &&
        current === previous);
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "Diff change must agree with its previous/current checksums.",
        path: ["change"],
      });
    }
  });

export const solutionExportWorkflowFileDiffV1Schema = z
  .object({
    baselineDigest: sha256DigestSchema.optional(),
    contractVersion: z.literal(1),
    currentDigest: sha256DigestSchema,
    entries: z
      .array(solutionExportWorkflowFileDiffEntryV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.diffEntries),
    state: z.enum(["no-baseline", "compared"]),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.state === "compared") !== (value.baselineDigest !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Compared diffs require one exact baseline digest.",
        path: ["baselineDigest"],
      });
    }
    value.entries.forEach((entry, index) => {
      const previous = value.entries[index - 1];
      if (previous !== undefined && previous.path >= entry.path) {
        context.addIssue({
          code: "custom",
          message: "Diff entries must be uniquely sorted by path.",
          path: ["entries", index, "path"],
        });
      }
    });
  });

export const solutionExportWorkflowDownloadPolicyV1Schema =
  z.discriminatedUnion("state", [
    z
      .object({
        reason: z.enum([
          "not-complete",
          "stage-failed",
          "canceled",
          "integrity-unverified",
          "artifact-unavailable",
        ]),
        state: z.literal("blocked"),
      })
      .strict(),
    z
      .object({
        artifactId: asyncJobArtifactIdSchema,
        digest: sha256DigestSchema,
        maxGrantSeconds: z.number().int().positive().max(900),
        state: z.literal("eligible"),
      })
      .strict(),
  ]);

export const solutionExportWorkflowWarningV1Schema = z.enum([
  "application-code-required",
  "cloudmarkup.diagram.detail-reduced",
  "cloudmarkup.diagram.icon-unavailable",
  "cloudmarkup.diagram.label-truncated",
  "cloudmarkup.diagram.minimum-label-scale",
]);

export const solutionExportWorkflowReadModelV1Schema = z
  .object({
    applicationVerification: applicationBuildCoverageV1Schema.optional(),
    applicationVerifications: z
      .array(applicationBuildCoverageV1Schema)
      .min(2)
      .max(SOLUTION_EXPORT_APPLICATION_BUILD_BATCH_MAXIMUM)
      .optional(),
    artifact: solutionExportWorkflowArtifactV1Schema.optional(),
    contractVersion: z.literal(1),
    diagnostics: z
      .array(solutionExportWorkflowDiagnosticV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.diagnostics),
    diff: solutionExportWorkflowFileDiffV1Schema.optional(),
    downloadPolicy: solutionExportWorkflowDownloadPolicyV1Schema,
    environment: asyncJobEnvironmentV1Schema,
    evidenceRecords: z
      .array(asyncJobEvidenceReferenceV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.evidenceRecords),
    evidenceSemantics: z
      .array(solutionExportWorkflowEvidenceSemanticsV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.evidenceRecords),
    failure: solutionExportWorkflowFailureV1Schema.optional(),
    jobId: asyncJobIdSchema,
    requestDigest: sha256DigestSchema,
    stageReports: z
      .array(solutionExportWorkflowStageReportV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.stageReports),
    stages: z
      .array(solutionExportWorkflowStageV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.stages),
    state: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
    subject: asyncJobSolutionRevisionSubjectV1Schema,
    targetProfileId: namespacedIdentifierSchema,
    targetSettingsDigest: sha256DigestSchema,
    warnings: z
      .array(solutionExportWorkflowWarningV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.warnings),
  })
  .strict()
  .superRefine((value, context) => {
    let lastIndex = -1;
    value.stages.forEach((stage, index) => {
      const stageIndex = SOLUTION_EXPORT_WORKFLOW_STAGE_ORDER.indexOf(
        stage.stage,
      );
      if (stageIndex <= lastIndex) {
        context.addIssue({
          code: "custom",
          message: "Workflow stages must be unique and in canonical order.",
          path: ["stages", index, "stage"],
        });
      }
      lastIndex = stageIndex;
    });

    value.diagnostics.forEach((diagnostic, index) => {
      const previous = value.diagnostics[index - 1];
      const key = solutionExportWorkflowDiagnosticKey(diagnostic);
      const previousKey =
        previous === undefined
          ? undefined
          : solutionExportWorkflowDiagnosticKey(previous);
      if (previousKey !== undefined && previousKey >= key) {
        context.addIssue({
          code: "custom",
          message: "Workflow diagnostics must be uniquely sorted.",
          path: ["diagnostics", index],
        });
      }
    });
    value.evidenceRecords.forEach((evidence, index) => {
      const previous = value.evidenceRecords[index - 1];
      if (
        previous !== undefined &&
        previous.evidenceId >= evidence.evidenceId
      ) {
        context.addIssue({
          code: "custom",
          message: "Workflow Evidence references must be uniquely sorted.",
          path: ["evidenceRecords", index, "evidenceId"],
        });
      }
      if (
        evidence.solutionRevisionId !== value.subject.solutionRevisionId ||
        serializeCanonicalJson(evidence.environment) !==
          serializeCanonicalJson(value.environment)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Workflow Evidence must bind the exact subject and environment.",
          path: ["evidenceRecords", index],
        });
      }
    });
    value.evidenceSemantics.forEach((semantics, index) => {
      const previous = value.evidenceSemantics[index - 1];
      if (
        previous !== undefined &&
        previous.evidenceId >= semantics.evidenceId
      ) {
        context.addIssue({
          code: "custom",
          message: "Workflow Evidence semantics must be uniquely sorted.",
          path: ["evidenceSemantics", index, "evidenceId"],
        });
      }
      if (
        !value.evidenceRecords.some(
          ({ evidenceId }) => evidenceId === semantics.evidenceId,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Workflow Evidence semantics must bind one retained Evidence reference.",
          path: ["evidenceSemantics", index, "evidenceId"],
        });
      }
    });
    value.evidenceRecords.forEach((evidence, index) => {
      if (
        !value.evidenceSemantics.some(
          ({ evidenceId }) => evidenceId === evidence.evidenceId,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every retained Evidence reference requires canonical check semantics.",
          path: ["evidenceRecords", index, "evidenceId"],
        });
      }
    });
    value.stageReports.forEach((report, index) => {
      const previous = value.stageReports[index - 1];
      if (
        previous !== undefined &&
        SOLUTION_EXPORT_WORKFLOW_STAGE_ORDER.indexOf(previous.stage) >=
          SOLUTION_EXPORT_WORKFLOW_STAGE_ORDER.indexOf(report.stage)
      ) {
        context.addIssue({
          code: "custom",
          message: "Stage reports must be unique and in canonical order.",
          path: ["stageReports", index, "stage"],
        });
      }
      report.evidenceRecords.forEach((reference, evidenceIndex) => {
        const retained = value.evidenceRecords.find(
          ({ evidenceId }) => evidenceId === reference.evidenceId,
        );
        const semantics = value.evidenceSemantics.find(
          ({ evidenceId }) => evidenceId === reference.evidenceId,
        );
        if (
          retained === undefined ||
          serializeCanonicalJson(retained) !== serializeCanonicalJson(reference)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Stage-report Evidence must equal one retained workflow reference.",
            path: ["stageReports", index, "evidenceRecords", evidenceIndex],
          });
        }
        if (
          semantics === undefined ||
          (report.stage === "build-application"
            ? semantics.kind !== "application-build"
            : semantics.kind === "application-build")
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Stage-report Evidence must carry canonical semantics for its exact stage.",
            path: ["stageReports", index, "evidenceRecords", evidenceIndex],
          });
        }
      });
    });
    value.evidenceRecords.forEach((reference, index) => {
      const reportCount = value.stageReports.filter((report) =>
        report.evidenceRecords.some(
          ({ evidenceId }) => evidenceId === reference.evidenceId,
        ),
      ).length;
      if (reportCount !== 1) {
        context.addIssue({
          code: "custom",
          message:
            "Every retained Evidence reference must belong to exactly one stage report.",
          path: ["evidenceRecords", index],
        });
      }
    });

    const buildReport = value.stageReports.find(
      ({ stage }) => stage === "build-application",
    );
    const buildStage = value.stages.find(
      ({ stage }) => stage === "build-application",
    );
    if (
      value.applicationVerification !== undefined &&
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
      (value.applicationVerification === undefined
        ? []
        : [value.applicationVerification]);
    const hasBuildReport = buildReport !== undefined;
    if (hasBuildReport !== applicationVerifications.length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "A persisted build report requires its distinct per-workload application verification projection.",
        path: ["applicationVerifications"],
      });
    }
    if (
      applicationVerifications.length > 0 &&
      (buildStage === undefined ||
        buildStage.state === "skipped" ||
        buildStage.state === "running")
    ) {
      context.addIssue({
        code: "custom",
        message: "Application verification requires an executed build stage.",
        path: ["applicationVerifications"],
      });
    }
    const generationArtifact = value.stages.find(
      ({ stage }) => stage === "generate-application",
    )?.artifact;
    const seenWorkloads = new Set<string>();
    applicationVerifications.forEach((verification, index) => {
      const field =
        value.applicationVerifications === undefined
          ? "applicationVerification"
          : "applicationVerifications";
      const path = [field, ...(field.endsWith("s") ? [index] : [])];
      if (seenWorkloads.has(verification.workloadId)) {
        context.addIssue({
          code: "custom",
          message:
            "Application verification workload identities must be unique.",
          path: [...path, "workloadId"],
        });
      }
      seenWorkloads.add(verification.workloadId);
      if (
        verification.solutionRevisionId !== value.subject.solutionRevisionId ||
        verification.solutionRevisionDigest !== value.subject.manifestDigest ||
        generationArtifact?.kind !== "application-source" ||
        verification.generationArtifactDigest !== generationArtifact.digest
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Application verification must bind the exact immutable revision and generated artifact.",
          path: [...path, "generationArtifactDigest"],
        });
      }
      if (
        verification.evidenceId !== undefined &&
        (!value.evidenceRecords.some(
          ({ evidenceId }) => evidenceId === verification.evidenceId,
        ) ||
          !buildReport?.evidenceRecords.some(
            ({ evidenceId }) => evidenceId === verification.evidenceId,
          ) ||
          !value.evidenceSemantics.some(
            (semantics) =>
              semantics.evidenceId === verification.evidenceId &&
              semantics.kind === "application-build" &&
              semantics.status === "passed",
          ))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Application verification Evidence must be retained with passing build semantics.",
          path: [...path, "evidenceId"],
        });
      }
    });

    const succeeded = value.state === "succeeded";
    const eligible = value.downloadPolicy.state === "eligible";
    if (
      buildStage?.state === "succeeded" &&
      applicationVerifications.some(
        (verification) =>
          verification.evidenceId === undefined ||
          verification.generationArtifactDigest === undefined ||
          verification.confirmedState === "custom-implementation-required" ||
          verification.confirmedState !== verification.inputState,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Every successful build must preserve its non-custom input coverage with retained Evidence.",
        path: ["applicationVerifications"],
      });
    }
    if (
      (buildStage?.state === "failed" || buildStage?.state === "canceled") &&
      applicationVerifications.length > 0 &&
      !applicationVerifications.some(
        ({ confirmedState }) =>
          confirmedState === "custom-implementation-required",
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A failed or canceled build batch must expose at least one downgraded verification.",
        path: ["applicationVerifications"],
      });
    }
    if (
      succeeded !== eligible ||
      succeeded !== (value.artifact !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only a successful workflow with a verified artifact may be download-eligible.",
        path: ["downloadPolicy"],
      });
    }
    if (succeeded && value.artifact?.kind !== "export-package") {
      context.addIssue({
        code: "custom",
        message: "Successful workflows require the verified export package.",
        path: ["artifact"],
      });
    }
    if ((value.state === "failed") !== (value.failure !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Failed workflows require exactly one sanitized failure.",
        path: ["failure"],
      });
    }
    if (
      value.downloadPolicy.state === "eligible" &&
      (value.artifact?.artifactId !== value.downloadPolicy.artifactId ||
        value.artifact.digest !== value.downloadPolicy.digest)
    ) {
      context.addIssue({
        code: "custom",
        message: "Download eligibility must bind the exact verified artifact.",
        path: ["downloadPolicy"],
      });
    }
    value.warnings.forEach((warning, index) => {
      if (value.warnings.indexOf(warning) !== index) {
        context.addIssue({
          code: "custom",
          message: "Workflow warnings must be unique.",
          path: ["warnings", index],
        });
      }
    });
  });

const checkpointProjectionSchema = z
  .object({
    completedStage: solutionExportWorkflowStageIdV1Schema.optional(),
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    inputDigest: sha256DigestSchema,
    kind: z.literal("cloudmarkup.solution-export-workflow-checkpoint"),
    requestDigest: sha256DigestSchema,
    stages: z
      .array(solutionExportWorkflowStageV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.stages),
    subject: asyncJobSolutionRevisionSubjectV1Schema,
    targetProfileId: namespacedIdentifierSchema,
    targetSettingsDigest: sha256DigestSchema,
    warnings: z
      .array(solutionExportWorkflowWarningV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.warnings),
  })
  .strict();

export function solutionExportWorkflowCheckpointIdentity(
  checkpoint: z.output<typeof checkpointProjectionSchema>,
): Sha256Digest {
  return sha256Digest(serializeCanonicalJson(checkpoint));
}

export const solutionExportWorkflowCheckpointV1Schema =
  checkpointProjectionSchema
    .extend({ checkpointIdentity: sha256DigestSchema })
    .strict()
    .superRefine((value, context) => {
      const { checkpointIdentity, ...projection } = value;
      if (
        checkpointIdentity !==
        solutionExportWorkflowCheckpointIdentity(projection)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Checkpoint identity must hash the exact immutable workflow projection.",
          path: ["checkpointIdentity"],
        });
      }
    });

export const solutionExportWorkflowPersistedOutputV1Schema = z
  .object({
    artifact: solutionExportWorkflowArtifactV1Schema,
    contractVersion: z.literal(1),
    diff: solutionExportWorkflowFileDiffV1Schema,
    evidenceRecords: z
      .array(asyncJobEvidenceReferenceV1Schema)
      .max(SOLUTION_EXPORT_WORKFLOW_V1_LIMITS.evidenceRecords),
    verifiedPackage: asyncJobArtifactReferenceV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.artifact.kind !== "export-package" ||
      value.artifact.artifactId !== value.verifiedPackage.artifactId ||
      value.artifact.object?.objectId !==
        value.verifiedPackage.object.objectId ||
      value.verifiedPackage.object.purpose !== "export-package" ||
      value.verifiedPackage.availability.state !== "available"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Persisted output must identify one available verified export package.",
        path: ["verifiedPackage"],
      });
    }
  });

export type SolutionExportWorkflowRequestV1 = z.output<
  typeof solutionExportWorkflowRequestV1Schema
>;
export type SolutionExportRepositoryWorkflowReviewV1 = z.output<
  typeof solutionExportRepositoryWorkflowReviewV1Schema
>;
export type SolutionExportWorkflowTargetSettingsV1 = z.output<
  typeof solutionExportWorkflowTargetSettingsV1Schema
>;
export type SolutionExportWorkflowStageIdV1 = z.output<
  typeof solutionExportWorkflowStageIdV1Schema
>;
export type SolutionExportWorkflowFailureV1 = z.output<
  typeof solutionExportWorkflowFailureV1Schema
>;
export type SolutionExportWorkflowArtifactV1 = z.output<
  typeof solutionExportWorkflowArtifactV1Schema
>;
export type SolutionExportWorkflowStageV1 = z.output<
  typeof solutionExportWorkflowStageV1Schema
>;
export type SolutionExportWorkflowDiagnosticV1 = z.output<
  typeof solutionExportWorkflowDiagnosticV1Schema
>;
export type SolutionExportWorkflowEvidenceSemanticsV1 = z.output<
  typeof solutionExportWorkflowEvidenceSemanticsV1Schema
>;
export type SolutionExportWorkflowStageReportV1 = z.output<
  typeof solutionExportWorkflowStageReportV1Schema
>;
export type SolutionExportWorkflowFileDiffV1 = z.output<
  typeof solutionExportWorkflowFileDiffV1Schema
>;
export type SolutionExportWorkflowDownloadPolicyV1 = z.output<
  typeof solutionExportWorkflowDownloadPolicyV1Schema
>;
export type SolutionExportWorkflowReadModelV1 = z.output<
  typeof solutionExportWorkflowReadModelV1Schema
>;
export type SolutionExportWorkflowCheckpointV1 = z.output<
  typeof solutionExportWorkflowCheckpointV1Schema
>;
export type SolutionExportWorkflowPersistedOutputV1 = z.output<
  typeof solutionExportWorkflowPersistedOutputV1Schema
>;
export type SolutionExportWorkflowWarningV1 = z.output<
  typeof solutionExportWorkflowWarningV1Schema
>;
export type SolutionExportApplicationBuildBatchInputV1 = z.output<
  typeof solutionExportApplicationBuildBatchInputV1Schema
>;
export type SolutionExportApplicationBuildBatchResultV1 = z.output<
  typeof solutionExportApplicationBuildBatchResultV1Schema
>;
export type { ApplicationBuildCoverageV1 };
export type { AsyncJobArtifactReferenceV1, AsyncJobEvidenceReferenceV1 };
