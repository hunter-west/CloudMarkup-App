import {
  conformanceDiagramArtifactV1Schema,
  conformanceDiagramRequestV1Schema,
  conformanceDiagramResultV1Schema,
} from "@cloudmarkup/diagram-export/conformance";
import { diagramExportArtifactV1Schema } from "@cloudmarkup/diagram-export/contracts";
import {
  applicationGenerationCoverageV1Schema,
  applicationGenerationResultV1Schema,
  architectureDocumentV3Schema,
  asyncJobEnvironmentV1Schema,
  evidenceRecordV1Schema,
  namespacedIdentifierSchema,
  repositoryRelativePathSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  solutionGenerationCoverageV1Schema,
  solutionRevisionManifestV1Schema,
  type ApplicationGenerationResultV1,
  type ArchitectureDocumentV3,
  type Sha256Digest,
  type SolutionRevisionManifestV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export const SOLUTION_EXPORT_V1_MAXIMA = Object.freeze({
  archiveBytes: 64 * 1024 * 1024,
  decompressedBytes: 64 * 1024 * 1024,
  fileBytes: 32 * 1024 * 1024,
  files: 2_048,
  pathBytes: 240,
  provenanceReferences: 2_048,
  warnings: 256,
});

export const SOLUTION_EXPORT_ZIP_EPOCH = "1980-01-01T00:00:00.000Z";
export const SOLUTION_EXPORT_MANIFEST_PATH =
  "cloudmarkup/cloudmarkup.manifest.json";

const stableIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "Must be a stable ID.");
const safeMessageSchema = z.string().trim().min(1).max(512);

export const solutionExportTerraformApplicationPackagePathV1Schema = z
  .string()
  .regex(
    /^\.\.\/application\/artifacts\/(?:[a-z][a-z0-9_]{0,62}|[A-Za-z0-9][A-Za-z0-9_-]{0,47}-[a-f0-9]{64})\/function\.zip$/u,
    "Must be the exact bounded application artifact path relative to infrastructure/.",
  );

function containsAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function containsUnsafeGitReferenceCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || "~^:?*[\\".includes(character)) {
      return true;
    }
  }
  return false;
}

const safeReviewValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !containsAsciiControlCharacter(value), {
    message: "Review values cannot contain control characters.",
  });

function addUniquePortablePathIssues(
  paths: readonly string[],
  context: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  const seen = new Set<string>();
  paths.forEach((value, index) => {
    const key = value.normalize("NFC").toLowerCase();
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        message: "Paths must be unique across portable filesystems.",
        path: [...path, index],
      });
    }
    seen.add(key);
  });
}

function addRepositoryWorkflowTruthIssues(
  value: {
    readonly dependencyLockDigests: readonly {
      readonly digest: string;
      readonly id: string;
    }[];
    readonly files: readonly { readonly path: string }[];
    readonly pinRegistryDigest: string;
    readonly requiredPackageTrees: readonly {
      readonly files: readonly {
        readonly checksum: string;
        readonly path: string;
      }[];
      readonly root: string;
    }[];
    readonly review: {
      readonly environments: readonly {
        readonly approvedRefs: readonly string[];
        readonly githubEnvironment: string;
        readonly id: string;
        readonly smokeBaseUrlDigest: string;
      }[];
      readonly permissions: readonly {
        readonly scope: string;
        readonly workflowPath: string;
      }[];
      readonly roles: readonly {
        readonly audience: string;
        readonly environment: string;
        readonly purpose: string;
        readonly reference: string;
        readonly subject: string;
        readonly variable: string;
      }[];
      readonly secrets: readonly { readonly name: string }[];
      readonly triggers: readonly {
        readonly events: readonly string[];
        readonly workflowPath: string;
      }[];
      readonly variables: readonly { readonly name: string }[];
      readonly workflows: readonly { readonly path: string }[];
    };
  },
  context: z.RefinementCtx,
): void {
  const filePaths = value.files.map(({ path }) => path);
  const reviewedPaths = value.review.workflows.map(({ path }) => path);
  addUniquePortablePathIssues(reviewedPaths, context, ["review", "workflows"]);
  if (
    filePaths.length !== reviewedPaths.length ||
    filePaths.some((path) => !reviewedPaths.includes(path))
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Workflow review rows must name the exact sealed workflow file set.",
      path: ["review", "workflows"],
    });
  }
  const filePathSet = new Set(filePaths);
  value.review.permissions.forEach((permission, index) => {
    if (!filePathSet.has(permission.workflowPath)) {
      context.addIssue({
        code: "custom",
        message:
          "Permission review rows must reference a sealed workflow file.",
        path: ["review", "permissions", index, "workflowPath"],
      });
    }
  });
  value.review.triggers.forEach((trigger, index) => {
    if (!filePathSet.has(trigger.workflowPath)) {
      context.addIssue({
        code: "custom",
        message: "Trigger review rows must reference a sealed workflow file.",
        path: ["review", "triggers", index, "workflowPath"],
      });
    }
  });
  const referencedPermissionPaths = new Set(
    value.review.permissions.map(({ workflowPath }) => workflowPath),
  );
  const referencedTriggerPaths = new Set(
    value.review.triggers.map(({ workflowPath }) => workflowPath),
  );
  if (
    filePaths.some(
      (path) =>
        !referencedPermissionPaths.has(path) ||
        !referencedTriggerPaths.has(path),
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Every sealed workflow must have permission and trigger review rows.",
      path: ["review"],
    });
  }
  const uniqueRowKeys = (
    rows: readonly string[],
    path: readonly (string | number)[],
  ): void => {
    if (new Set(rows).size !== rows.length) {
      context.addIssue({
        code: "custom",
        message: "Review and supply-chain rows must be unique.",
        path: [...path],
      });
    }
  };
  uniqueRowKeys(
    value.review.permissions.map(
      ({ scope, workflowPath }) => `${workflowPath}\u0000${scope}`,
    ),
    ["review", "permissions"],
  );
  uniqueRowKeys(
    value.review.triggers.map(({ workflowPath }) => workflowPath),
    ["review", "triggers"],
  );
  value.review.triggers.forEach((trigger, index) => {
    uniqueRowKeys(trigger.events, ["review", "triggers", index, "events"]);
  });
  uniqueRowKeys(
    value.dependencyLockDigests.map(({ id }) => id.toLowerCase()),
    ["dependencyLockDigests"],
  );
  const boundPackageDigests = new Set(
    value.requiredPackageTrees.flatMap(({ files }) =>
      files.map(({ checksum }) => checksum),
    ),
  );
  if (
    !value.dependencyLockDigests.some(
      ({ digest }) => digest === value.pinRegistryDigest,
    ) ||
    value.dependencyLockDigests.some(
      ({ digest }) =>
        digest !== value.pinRegistryDigest && !boundPackageDigests.has(digest),
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Dependency lock digests must bind the pin registry or an exact required package file.",
      path: ["dependencyLockDigests"],
    });
  }
  const environmentIds = value.review.environments.map(({ id }) => id);
  uniqueRowKeys(environmentIds, ["review", "environments"]);
  uniqueRowKeys(
    value.review.environments.map(({ githubEnvironment }) =>
      githubEnvironment.toLowerCase(),
    ),
    ["review", "environments"],
  );
  value.review.environments.forEach((environment, index) => {
    uniqueRowKeys(environment.approvedRefs, [
      "review",
      "environments",
      index,
      "approvedRefs",
    ]);
  });
  uniqueRowKeys(
    value.review.roles.map((role) =>
      [
        role.audience,
        role.environment,
        role.purpose,
        role.reference,
        role.subject,
        role.variable,
      ].join("\u0000"),
    ),
    ["review", "roles"],
  );
  uniqueRowKeys(
    value.review.variables.map(({ name }) => name.toLowerCase()),
    ["review", "variables"],
  );
  uniqueRowKeys(
    value.review.secrets.map(({ name }) => name.toLowerCase()),
    ["review", "secrets"],
  );
  const environmentSet = new Set(environmentIds);
  value.review.roles.forEach((role, index) => {
    if (!environmentSet.has(role.environment)) {
      context.addIssue({
        code: "custom",
        message: "Role review rows must reference a declared environment.",
        path: ["review", "roles", index, "environment"],
      });
    }
  });
}

function addCanonicalReviewedWorkflowOrderIssues(
  files: readonly { readonly path: string }[],
  context: z.RefinementCtx,
): void {
  if (
    files.some(
      ({ path }, index) =>
        path !== SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS[index],
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Reviewed workflow files must use the exact canonical path order.",
      path: ["files"],
    });
  }
}

export const exactToolPinV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: namespacedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

export const solutionExportOwnershipKindV1Schema = z.enum([
  "architecture-as-code-source",
  "generated-replaceable",
  "ai-generated-review-required",
  "user-owned-extension",
  "user-provided",
  "generated-build-artifact",
  "evidence-artifact",
]);

export const solutionExportMediaTypeV1Schema = z.enum([
  "application/json",
  "application/yaml",
  "application/pdf",
  "application/vnd.cyclonedx+json",
  "application/vnd.hashicorp.terraform",
  "application/vnd.amazon.cloudformation.template+json",
  "application/zip",
  "image/png",
  "image/svg+xml",
  "text/markdown",
  "text/plain",
  "text/typescript",
  "text/javascript",
]);

export const solutionExportSourceReferenceV1Schema = z
  .object({
    id: stableIdSchema,
    kind: z.enum([
      "application-artifact",
      "architecture",
      "artifact",
      "contract",
      "edge",
      "environment-binding",
      "evidence",
      "export",
      "extension",
      "operation",
      "policy",
      "resource",
      "solution-revision",
      "workload",
    ]),
  })
  .strict();

export const solutionExportProvenanceV1Schema = z
  .object({
    producer: exactToolPinV1Schema,
    solutionRevisionId: stableIdSchema,
    sourceReferences: z
      .array(solutionExportSourceReferenceV1Schema)
      .min(1)
      .max(SOLUTION_EXPORT_V1_MAXIMA.provenanceReferences),
  })
  .strict();

export const solutionExportTextContentV1Schema = z
  .object({
    encoding: z.literal("utf8"),
    value: z.string().max(SOLUTION_EXPORT_V1_MAXIMA.fileBytes),
  })
  .strict();

export const solutionExportBinaryContentV1Schema = z
  .object({
    encoding: z.literal("base64"),
    value: z
      .string()
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
      .max(Math.ceil((SOLUTION_EXPORT_V1_MAXIMA.fileBytes * 4) / 3) + 4),
  })
  .strict();

export const solutionExportContentV1Schema = z.discriminatedUnion("encoding", [
  solutionExportTextContentV1Schema,
  solutionExportBinaryContentV1Schema,
]);

export const solutionExportDiagramFileV1Schema = z
  .object({
    content: solutionExportContentV1Schema,
    path: z.enum([
      "diagram/README.md",
      "diagram/architecture.png",
      "diagram/architecture.svg",
    ]),
  })
  .strict();

export const solutionExportDiagramV1Schema = z
  .object({
    artifact: diagramExportArtifactV1Schema,
    files: z.array(solutionExportDiagramFileV1Schema).min(2).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    const paths = value.files.map(({ path }) => path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        message: "Diagram export file paths must be unique.",
        path: ["files"],
      });
    }
  });

export const solutionExportConformanceDiagramV1Schema = z
  .object({
    request: conformanceDiagramRequestV1Schema,
    result: conformanceDiagramResultV1Schema,
  })
  .strict();

export const solutionExportConformanceDiagramsV1Schema = z
  .array(solutionExportConformanceDiagramV1Schema)
  .min(1)
  .max(12)
  .superRefine((value, context) => {
    const selections = new Set<string>();
    const exactBinding = value[0]?.request;
    value.forEach(({ request }, index) => {
      if (
        exactBinding !== undefined &&
        (request.environmentId !== exactBinding.environmentId ||
          request.reportId !== exactBinding.reportId ||
          request.reportDigest !== exactBinding.reportDigest ||
          request.solutionRevisionId !== exactBinding.solutionRevisionId)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Conformance diagram selections must bind one exact report, environment, and Solution Revision.",
          path: [index, "request"],
        });
      }
      const selection = `${request.state}\u0000${String(request.showDifferences)}`;
      if (selections.has(selection)) {
        context.addIssue({
          code: "custom",
          message:
            "Conformance diagram state and Differences selections must be unique.",
          path: [index, "request"],
        });
      }
      selections.add(selection);
    });
    addUniquePortablePathIssues(
      value.map(({ result }) => result.artifact.file.path),
      context,
      [],
    );
  });

export const solutionExportConformanceDiagramArtifactsV1Schema = z
  .array(conformanceDiagramArtifactV1Schema)
  .min(1)
  .max(12)
  .superRefine((value, context) => {
    const selections = new Set<string>();
    const exactBinding = value[0];
    value.forEach((artifact, index) => {
      if (
        exactBinding !== undefined &&
        (artifact.environmentId !== exactBinding.environmentId ||
          artifact.reportId !== exactBinding.reportId ||
          artifact.reportDigest !== exactBinding.reportDigest ||
          artifact.solutionRevisionId !== exactBinding.solutionRevisionId)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Conformance diagram artifacts must bind one exact report, environment, and Solution Revision.",
          path: [index],
        });
      }
      const selection = `${artifact.state}\u0000${String(artifact.showDifferences)}`;
      if (selections.has(selection)) {
        context.addIssue({
          code: "custom",
          message:
            "Conformance diagram state and Differences selections must be unique.",
          path: [index],
        });
      }
      selections.add(selection);
    });
    addUniquePortablePathIssues(
      value.map(({ file }) => file.path),
      context,
      [],
    );
  });
export const solutionExportSupplementalFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    content: solutionExportContentV1Schema,
    kind: z.enum(["regular-file", "symlink", "device-file", "directory"]),
    mediaType: solutionExportMediaTypeV1Schema,
    ownership: z.enum([
      "ai-generated-review-required",
      "user-owned-extension",
      "user-provided",
      "generated-build-artifact",
      "evidence-artifact",
    ]),
    path: repositoryRelativePathSchema,
    provenance: solutionExportProvenanceV1Schema,
    semanticChecksum: sha256DigestSchema,
  })
  .strict();

export const SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT =
  ".github/workflows/" as const;
export const SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH =
  ".github/workflows/cloudmarkup-validate.yml" as const;
export const SOLUTION_EXPORT_PRIVILEGED_REPOSITORY_WORKFLOW_PATHS =
  Object.freeze([
    ".github/workflows/cloudmarkup-deploy.yml",
    ".github/workflows/cloudmarkup-drift.yml",
    ".github/workflows/cloudmarkup-plan.yml",
    ".github/workflows/cloudmarkup-smoke.yml",
  ] as const);
export const SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS = Object.freeze(
  [
    ...SOLUTION_EXPORT_PRIVILEGED_REPOSITORY_WORKFLOW_PATHS,
    SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH,
  ] as const,
);
export const SOLUTION_EXPORT_V1_MAX_REPOSITORY_WORKFLOWS =
  SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS.length;
export const SOLUTION_EXPORT_REPOSITORY_WORKFLOW_INCLUSION_POLICY =
  "explicit-workflow-permission-and-confirmation-required" as const;

const reviewedRepositoryWorkflowPathSet = new Set<string>(
  SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS,
);
export const solutionExportRepositoryWorkflowPathV1Schema =
  repositoryRelativePathSchema.refine(
    (path) => reviewedRepositoryWorkflowPathSet.has(path),
    "Repository workflows must use the exact reviewed CloudMarkup workflow paths.",
  );

export const solutionExportRepositoryBranchV1Schema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value === value.trim() &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.startsWith(".") &&
      !value.endsWith(".") &&
      value !== "@" &&
      !value.toLowerCase().endsWith(".lock") &&
      !value.includes("..") &&
      !value.includes("@{") &&
      !value.includes("//") &&
      !containsUnsafeGitReferenceCharacter(value) &&
      value
        .split("/")
        .every(
          (segment) =>
            segment !== "" &&
            segment !== "." &&
            segment !== ".." &&
            !segment.endsWith(".") &&
            !segment.toLowerCase().endsWith(".lock"),
        ),
    "Default branch must be a safe exact Git ref name.",
  );

const solutionExportGitHubNumericIdV1Schema = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/u, "Use the canonical decimal GitHub ID.");

export const solutionExportBoundRepositoryV1Schema = z
  .object({
    defaultBranch: solutionExportRepositoryBranchV1Schema,
    destinationFolder: z.union([
      z.literal(""),
      repositoryRelativePathSchema.refine(
        (path) => !path.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT),
        "The package destination cannot be inside the workflow root.",
      ),
    ]),
    name: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}$/u, "Invalid repository name."),
    owner: z
      .string()
      .regex(
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u,
        "Invalid repository owner.",
      ),
    repositoryId: solutionExportGitHubNumericIdV1Schema,
    repositoryOwnerId: solutionExportGitHubNumericIdV1Schema,
    state: z.literal("bound"),
  })
  .strict();

export const solutionExportPortableRepositoryV1Schema = z
  .object({
    destinationFolder: z.literal(""),
    state: z.literal("portable-unbound"),
  })
  .strict();

export const solutionExportRepositoryWorkflowReviewV1Schema = z
  .object({
    environments: z
      .array(
        z
          .object({
            approvedRefs: z.array(safeReviewValueSchema).max(32),
            githubEnvironment: safeReviewValueSchema,
            id: stableIdSchema,
            smokeBaseUrlDigest: sha256DigestSchema,
            protected: z.boolean(),
            requiredApprovals: z.number().int().nonnegative().max(16),
            workspace: safeReviewValueSchema,
          })
          .strict(),
      )
      .max(32),
    permissions: z
      .array(
        z
          .object({
            access: z.enum(["none", "read", "write"]),
            explanation: safeMessageSchema,
            scope: safeReviewValueSchema,
            workflowPath: solutionExportRepositoryWorkflowPathV1Schema,
          })
          .strict(),
      )
      .max(128),
    roles: z
      .array(
        z
          .object({
            audience: safeReviewValueSchema,
            environment: safeReviewValueSchema,
            purpose: safeReviewValueSchema,
            reference: safeReviewValueSchema,
            subject: safeReviewValueSchema,
            variable: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
          })
          .strict(),
      )
      .max(64),
    secrets: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
            purpose: safeReviewValueSchema,
          })
          .strict(),
      )
      .max(128),
    triggers: z
      .array(
        z
          .object({
            events: z.array(safeReviewValueSchema).min(1).max(16),
            workflowPath: solutionExportRepositoryWorkflowPathV1Schema,
          })
          .strict(),
      )
      .max(32),
    variables: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
            purpose: safeReviewValueSchema,
          })
          .strict(),
      )
      .max(128),
    workflows: z
      .array(
        z
          .object({
            environmentScoped: z.boolean(),
            path: solutionExportRepositoryWorkflowPathV1Schema,
            purpose: safeReviewValueSchema,
          })
          .strict(),
      )
      .min(1)
      .max(SOLUTION_EXPORT_V1_MAX_REPOSITORY_WORKFLOWS),
    warnings: z
      .array(
        z
          .object({
            code: stableIdSchema,
            message: safeMessageSchema,
          })
          .strict(),
      )
      .max(SOLUTION_EXPORT_V1_MAXIMA.warnings),
  })
  .strict();

export const solutionExportRequiredPackageFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    path: repositoryRelativePathSchema.refine(
      (path) =>
        path !== SOLUTION_EXPORT_MANIFEST_PATH &&
        !path.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT),
      "Required package bindings must name package-local, non-manifest files.",
    ),
  })
  .strict();

export const solutionExportRequiredPackageTreeV1Schema = z
  .object({
    files: z.array(solutionExportRequiredPackageFileV1Schema).min(1).max(256),
    root: repositoryRelativePathSchema.refine(
      (path) =>
        path !== SOLUTION_EXPORT_MANIFEST_PATH &&
        !path.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT),
      "Required package tree roots must be package-local.",
    ),
  })
  .strict()
  .superRefine((value, context) => {
    addUniquePortablePathIssues(
      value.files.map(({ path }) => path),
      context,
      ["files"],
    );
    value.files.forEach((file, index) => {
      if (file.path !== value.root && !file.path.startsWith(`${value.root}/`)) {
        context.addIssue({
          code: "custom",
          message:
            "Required package tree files must stay inside their declared root.",
          path: ["files", index, "path"],
        });
      }
    });
  });

export const solutionExportReviewedRepositoryWorkflowFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    content: solutionExportTextContentV1Schema,
    kind: z.literal("regular-file"),
    mediaType: z.literal("application/yaml"),
    ownership: z.literal("generated-replaceable"),
    path: solutionExportRepositoryWorkflowPathV1Schema,
    provenance: solutionExportProvenanceV1Schema,
    semanticChecksum: sha256DigestSchema,
  })
  .strict();

const reviewedRepositoryWorkflowsDigestPayloadV1Shape = {
  configDigest: sha256DigestSchema,
  contractVersion: z.literal(1),
  files: z
    .array(solutionExportReviewedRepositoryWorkflowFileV1Schema)
    .length(SOLUTION_EXPORT_V1_MAX_REPOSITORY_WORKFLOWS),
  dependencyLockDigests: z
    .array(
      z
        .object({
          digest: sha256DigestSchema,
          id: stableIdSchema,
        })
        .strict(),
    )
    .min(1)
    .max(64),
  generator: exactToolPinV1Schema,
  kind: z.literal("cloudmarkup.reviewed-repository-workflows"),
  pinRegistryDigest: sha256DigestSchema,
  policyDigest: sha256DigestSchema,
  repository: solutionExportBoundRepositoryV1Schema,
  requiredPackageTrees: z
    .array(solutionExportRequiredPackageTreeV1Schema)
    .min(1)
    .max(32),
  review: solutionExportRepositoryWorkflowReviewV1Schema,
  solutionRevision: z
    .object({ digest: sha256DigestSchema, id: stableIdSchema })
    .strict(),
  validator: exactToolPinV1Schema,
} as const;

export const reviewedRepositoryWorkflowsDigestPayloadV1Schema = z
  .object(reviewedRepositoryWorkflowsDigestPayloadV1Shape)
  .strict()
  .superRefine((value, context) => {
    addUniquePortablePathIssues(
      value.files.map(({ path }) => path),
      context,
      ["files"],
    );
    addCanonicalReviewedWorkflowOrderIssues(value.files, context);
    addUniquePortablePathIssues(
      value.requiredPackageTrees.map(({ root }) => root),
      context,
      ["requiredPackageTrees"],
    );
    addUniquePortablePathIssues(
      value.requiredPackageTrees.flatMap(({ files }) =>
        files.map(({ path }) => path),
      ),
      context,
      ["requiredPackageTrees"],
    );
    addRepositoryWorkflowTruthIssues(value, context);
  });

export const reviewedRepositoryWorkflowsV1Schema = z
  .object({
    ...reviewedRepositoryWorkflowsDigestPayloadV1Shape,
    resultDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addUniquePortablePathIssues(
      value.files.map(({ path }) => path),
      context,
      ["files"],
    );
    addCanonicalReviewedWorkflowOrderIssues(value.files, context);
    addUniquePortablePathIssues(
      value.requiredPackageTrees.map(({ root }) => root),
      context,
      ["requiredPackageTrees"],
    );
    addUniquePortablePathIssues(
      value.requiredPackageTrees.flatMap(({ files }) =>
        files.map(({ path }) => path),
      ),
      context,
      ["requiredPackageTrees"],
    );
    addRepositoryWorkflowTruthIssues(value, context);
    value.files.forEach((file, index) => {
      if (file.provenance.solutionRevisionId !== value.solutionRevision.id) {
        context.addIssue({
          code: "custom",
          message: "Workflow provenance must bind the exact Solution Revision.",
          path: ["files", index, "provenance", "solutionRevisionId"],
        });
      }
      if (
        file.provenance.producer.id !== value.generator.id ||
        file.provenance.producer.version !== value.generator.version ||
        file.provenance.producer.digest !== value.generator.digest
      ) {
        context.addIssue({
          code: "custom",
          message: "Workflow provenance must bind the exact generator pin.",
          path: ["files", index, "provenance", "producer"],
        });
      }
    });
  });
export const solutionExportExistingFileV1Schema = z
  .object({
    baselineChecksum: sha256DigestSchema.optional(),
    currentChecksum: sha256DigestSchema,
    kind: z.enum(["regular-file", "symlink", "device-file", "directory"]),
    ownership: solutionExportOwnershipKindV1Schema,
    path: repositoryRelativePathSchema,
  })
  .strict();

export const solutionExportInfrastructureFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    content: z.string().max(SOLUTION_EXPORT_V1_MAXIMA.fileBytes),
    mediaType: z.enum([
      "application/json",
      "application/vnd.amazon.cloudformation.template+json",
      "application/vnd.hashicorp.terraform",
      "text/markdown",
      "text/plain",
    ]),
    ownership: z.literal("generated"),
    path: repositoryRelativePathSchema,
    provenance: solutionExportProvenanceV1Schema,
    semanticChecksum: sha256DigestSchema,
  })
  .strict();

export const solutionExportArtifactReferenceV1Schema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        artifactId: stableIdSchema,
        digest: sha256DigestSchema,
        kind: stableIdSchema,
        ownership: solutionExportOwnershipKindV1Schema,
        state: z.literal("immutable-reference"),
        workloadId: stableIdSchema,
      })
      .strict(),
    z
      .object({
        kind: stableIdSchema,
        ownership: solutionExportOwnershipKindV1Schema,
        path: repositoryRelativePathSchema,
        state: z.literal("required-output"),
        workloadId: stableIdSchema,
      })
      .strict(),
  ],
);

export const solutionExportResourceProvenanceV1Schema = z
  .object({
    dependentEdgeIds: z.array(stableIdSchema).max(1_024),
    dependentNodeIds: z.array(stableIdSchema).max(1_024),
    resourceId: stableIdSchema,
    targetKey: stableIdSchema,
  })
  .strict();

export const solutionExportPolicyProvenanceV1Schema = z
  .object({
    ownerNodeId: stableIdSchema,
    ownership: z.enum(["generated", "user-owned"]),
    policyDocumentId: stableIdSchema,
    policyKind: stableIdSchema,
    provenance: solutionExportProvenanceV1Schema,
    renderedAs: stableIdSchema,
  })
  .strict();

const solutionExportTerraformInfrastructureArtifactV1Schema = z
  .object({
    applicationArtifacts: z
      .array(
        z
          .object({
            artifactReadiness: stableIdSchema.optional(),
            contractVersion: z.union([z.literal(1), z.literal(2)]).optional(),
            delivery: stableIdSchema.optional(),
            expectedArtifact: z
              .object({
                archiveEntrypoint: repositoryRelativePathSchema,
                artifactId: stableIdSchema,
                digestAlgorithm: z.literal("sha256"),
                handler: z.string().trim().min(1).max(256),
                kind: z.literal("aws-lambda-zip"),
                mediaType: z.literal("application/zip"),
                path: repositoryRelativePathSchema,
                runtime: z
                  .object({
                    digest: sha256DigestSchema,
                    handler: z.string().trim().min(1).max(256),
                    id: namespacedIdentifierSchema,
                    languageFamily: namespacedIdentifierSchema,
                    moduleFormat: z.literal("esm"),
                    runtime: z.literal("nodejs24.x"),
                    runtimeFamily: namespacedIdentifierSchema,
                    version: semanticVersionSchema,
                  })
                  .strict(),
              })
              .strict()
              .optional(),
            generationCoverage: stableIdSchema.optional(),
            implementationMode: z.enum([
              "infrastructure-only",
              "user-provided",
              "generated-starter",
              "complete-supported-pattern",
              "ai-assisted-custom",
              "external-artifact",
            ]),
            inputs: z.array(solutionExportArtifactReferenceV1Schema).max(64),
            relativePackagePath:
              solutionExportTerraformApplicationPackagePathV1Schema.optional(),
            workloadId: stableIdSchema,
          })
          .strict()
          .superRefine((value, context) => {
            if (value.contractVersion !== 2) return;
            const requiredFields = [
              "artifactReadiness",
              "delivery",
              "expectedArtifact",
              "generationCoverage",
              "relativePackagePath",
            ] as const;
            for (const field of requiredFields) {
              if (value[field] === undefined) {
                context.addIssue({
                  code: "custom",
                  message:
                    "Version 2 application artifacts require the complete target-neutral application binding.",
                  path: [field],
                });
              }
            }
            if (
              value.expectedArtifact !== undefined &&
              value.relativePackagePath !== undefined &&
              value.relativePackagePath !== `../${value.expectedArtifact.path}`
            ) {
              context.addIssue({
                code: "custom",
                message:
                  "The stable infrastructure-relative package path must bind the target-neutral application artifact.",
                path: ["relativePackagePath"],
              });
            }
          }),
      )
      .max(1_000),
    artifactDigest: sha256DigestSchema,
    catalog: exactToolPinV1Schema,
    compiler: exactToolPinV1Schema,
    contractVersion: z.literal(1),
    diagnostics: z
      .array(
        z
          .object({
            code: stableIdSchema,
            message: safeMessageSchema,
            severity: z.enum(["error", "warning", "info"]),
          })
          .strict(),
      )
      .max(256),
    files: z.array(solutionExportInfrastructureFileV1Schema).max(256),
    formatVersion: semanticVersionSchema,
    kind: z.literal("cloudmarkup.export-infrastructure-input"),
    policyArtifacts: z
      .array(solutionExportPolicyProvenanceV1Schema)
      .max(10_000),
    providers: z
      .array(
        z
          .object({
            source: z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/),
            versionConstraint: z.string().trim().min(1).max(256),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    requiredTerraformVersion: z.string().trim().min(1).max(256),
    resources: z.array(solutionExportResourceProvenanceV1Schema).max(10_000),
    solutionRevisionId: stableIdSchema,
    target: z.literal("terraform"),
  })
  .strict();

const solutionExportCloudFormationInfrastructureArtifactV1Schema =
  solutionExportTerraformInfrastructureArtifactV1Schema
    .omit({ providers: true, requiredTerraformVersion: true, target: true })
    .extend({
      localValidation: stableIdSchema,
      target: z.literal("cloudformation"),
      templateFormat: z.literal("json"),
      templateSpecificationVersion: z.literal("2010-09-09"),
    })
    .strict();

export const solutionExportInfrastructureArtifactV1Schema =
  z.discriminatedUnion("target", [
    solutionExportTerraformInfrastructureArtifactV1Schema,
    solutionExportCloudFormationInfrastructureArtifactV1Schema,
  ]);

export const solutionExportLimitsV1Schema = z
  .object({
    maxArchiveBytes: z
      .number()
      .int()
      .positive()
      .max(SOLUTION_EXPORT_V1_MAXIMA.archiveBytes),
    maxDecompressedBytes: z
      .number()
      .int()
      .positive()
      .max(SOLUTION_EXPORT_V1_MAXIMA.decompressedBytes),
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .max(SOLUTION_EXPORT_V1_MAXIMA.fileBytes),
    maxFiles: z.number().int().positive().max(SOLUTION_EXPORT_V1_MAXIMA.files),
    maxPathBytes: z
      .number()
      .int()
      .positive()
      .max(SOLUTION_EXPORT_V1_MAXIMA.pathBytes),
  })
  .strict();

export const solutionExportTerraformApprovedTargetV1Schema = z
  .object({
    exportName: z
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
        {
          message:
            "Logical export names cannot contain path separators or ADS syntax.",
        },
      ),
    limits: solutionExportLimitsV1Schema,
    policyPacks: z.array(exactToolPinV1Schema).max(64),
    renderer: exactToolPinV1Schema,
    target: z.literal("terraform"),
  })
  .strict();

export const solutionExportCloudFormationApprovedTargetV1Schema =
  solutionExportTerraformApprovedTargetV1Schema
    .omit({ target: true })
    .extend({ target: z.literal("cloudformation") })
    .strict();

export const solutionExportApprovedTargetV1Schema = z.discriminatedUnion(
  "target",
  [
    solutionExportTerraformApprovedTargetV1Schema,
    solutionExportCloudFormationApprovedTargetV1Schema,
  ],
);

export const solutionExportExternalEvidenceReferenceV1Schema = z
  .object({
    evidenceId: evidenceRecordV1Schema.shape.id,
    recordDigest: sha256DigestSchema,
  })
  .strict();

function externalPassedStageSchema(maxEvidenceRecords: number) {
  return z
    .object({
      evidenceRecords: z
        .array(solutionExportExternalEvidenceReferenceV1Schema)
        .min(1)
        .max(maxEvidenceRecords),
      reportDigest: sha256DigestSchema,
      state: z.literal("passed-before-export"),
    })
    .strict()
    .superRefine((value, context) => {
      value.evidenceRecords.forEach((record, index) => {
        const previous = value.evidenceRecords[index - 1];
        if (
          previous !== undefined &&
          previous.evidenceId >= record.evidenceId
        ) {
          context.addIssue({
            code: "custom",
            message:
              "External stage Evidence references must be uniquely UTF-16 sorted.",
            path: ["evidenceRecords", index, "evidenceId"],
          });
        }
      });
    });
}

export const solutionExportExternalPassedStageV1Schema =
  externalPassedStageSchema(2);

const solutionExportExternalApplicationBuildPassedStageV1Schema =
  externalPassedStageSchema(32);

const solutionExportExternalStageStatusCommonShape = {
  applicationBuild:
    solutionExportExternalApplicationBuildPassedStageV1Schema.optional(),
  environment: asyncJobEnvironmentV1Schema,
  targetSettingsDigest: sha256DigestSchema,
  workflowRequestDigest: sha256DigestSchema,
};

function validateExternalStageEvidenceIdentities(
  input: {
    readonly applicationBuild:
      | z.output<
          typeof solutionExportExternalApplicationBuildPassedStageV1Schema
        >
      | undefined;
    readonly field: "cloudFormationValidation" | "terraformValidation";
    readonly validation: z.output<
      typeof solutionExportExternalPassedStageV1Schema
    >;
  },
  context: z.RefinementCtx,
): void {
  const evidenceIds = [
    ...(input.applicationBuild?.evidenceRecords ?? []),
    ...input.validation.evidenceRecords,
  ].map(({ evidenceId }) => evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({
      code: "custom",
      message: "External stage Evidence identities must be disjoint.",
      path: [input.field, "evidenceRecords"],
    });
  }
}

const solutionExportTerraformExternalStageStatusV1Schema = z
  .object({
    ...solutionExportExternalStageStatusCommonShape,
    terraformValidation: solutionExportExternalPassedStageV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    validateExternalStageEvidenceIdentities(
      {
        applicationBuild: value.applicationBuild,
        field: "terraformValidation",
        validation: value.terraformValidation,
      },
      context,
    );
  });

const solutionExportCloudFormationExternalStageStatusV1Schema = z
  .object({
    ...solutionExportExternalStageStatusCommonShape,
    cloudFormationValidation: solutionExportExternalPassedStageV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    validateExternalStageEvidenceIdentities(
      {
        applicationBuild: value.applicationBuild,
        field: "cloudFormationValidation",
        validation: value.cloudFormationValidation,
      },
      context,
    );
  });

export const solutionExportExternalStageStatusV1Schema = z.union([
  solutionExportTerraformExternalStageStatusV1Schema,
  solutionExportCloudFormationExternalStageStatusV1Schema,
]);

export const solutionExportRequestV1Schema = z
  .object({
    application: applicationGenerationResultV1Schema.optional(),
    architectureDocument: architectureDocumentV3Schema,
    conformanceDiagrams: solutionExportConformanceDiagramsV1Schema.optional(),
    contractVersion: z.literal(1),
    reviewedRepositoryWorkflows: reviewedRepositoryWorkflowsV1Schema.optional(),
    diagram: solutionExportDiagramV1Schema.optional(),
    existingFiles: z.array(solutionExportExistingFileV1Schema).max(2_048),
    externalStageStatus: solutionExportExternalStageStatusV1Schema.optional(),
    infrastructure: solutionExportInfrastructureArtifactV1Schema,
    solutionRevision: solutionRevisionManifestV1Schema,
    supplementalFiles: z
      .array(solutionExportSupplementalFileV1Schema)
      .max(1_024),
    target: solutionExportApprovedTargetV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.externalStageStatus?.applicationBuild !== undefined &&
      value.application === undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "External build status requires the generated application input.",
        path: ["externalStageStatus", "applicationBuild"],
      });
    }
    if (
      value.reviewedRepositoryWorkflows !== undefined &&
      value.reviewedRepositoryWorkflows.solutionRevision.id !==
        value.solutionRevision.solutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Reviewed repository workflows must bind the exported Solution Revision.",
        path: ["reviewedRepositoryWorkflows", "solutionRevision", "id"],
      });
    }
  });

export const solutionExportManifestFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    mediaType: solutionExportMediaTypeV1Schema,
    ownership: solutionExportOwnershipKindV1Schema,
    path: repositoryRelativePathSchema.refine(
      (path) => path !== SOLUTION_EXPORT_MANIFEST_PATH,
      "The manifest cannot checksum itself.",
    ),
    provenance: solutionExportProvenanceV1Schema,
    semanticChecksum: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(SOLUTION_EXPORT_V1_MAXIMA.fileBytes),
  })
  .strict();

export const solutionExportRepositoryWorkflowManifestFileV1Schema =
  solutionExportManifestFileV1Schema.extend({
    mediaType: z.literal("application/yaml"),
    ownership: z.literal("generated-replaceable"),
    path: solutionExportRepositoryWorkflowPathV1Schema,
  });

export const solutionExportRepositoryWorkflowsV1Schema = z
  .object({
    configDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    dependencyLockDigests: z
      .array(
        z.object({ digest: sha256DigestSchema, id: stableIdSchema }).strict(),
      )
      .min(1)
      .max(64),
    files: z
      .array(solutionExportRepositoryWorkflowManifestFileV1Schema)
      .min(1)
      .max(SOLUTION_EXPORT_V1_MAX_REPOSITORY_WORKFLOWS),
    generator: exactToolPinV1Schema,
    inclusionPolicy: z.literal(
      SOLUTION_EXPORT_REPOSITORY_WORKFLOW_INCLUSION_POLICY,
    ),
    kind: z.literal("cloudmarkup.reviewed-repository-workflows"),
    pinRegistryDigest: sha256DigestSchema,
    policyDigest: sha256DigestSchema,
    repository: z.discriminatedUnion("state", [
      solutionExportBoundRepositoryV1Schema,
      solutionExportPortableRepositoryV1Schema,
    ]),
    requiredPackageTrees: z
      .array(solutionExportRequiredPackageTreeV1Schema)
      .max(32),
    resultDigest: sha256DigestSchema,
    review: solutionExportRepositoryWorkflowReviewV1Schema,
    solutionRevision: z
      .object({ digest: sha256DigestSchema, id: stableIdSchema })
      .strict(),
    validator: exactToolPinV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    addUniquePortablePathIssues(
      value.files.map(({ path }) => path),
      context,
      ["files"],
    );
    addUniquePortablePathIssues(
      value.requiredPackageTrees.map(({ root }) => root),
      context,
      ["requiredPackageTrees"],
    );
    addUniquePortablePathIssues(
      value.requiredPackageTrees.flatMap(({ files }) =>
        files.map(({ path }) => path),
      ),
      context,
      ["requiredPackageTrees"],
    );
    addRepositoryWorkflowTruthIssues(value, context);
    if (
      value.repository.state === "portable-unbound" &&
      (value.files.length !== 1 ||
        value.files[0]?.path !==
          SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Portable repository workflows may contain only the credentialless validation workflow.",
        path: ["repository", "state"],
      });
    }
    value.files.forEach((file, index) => {
      if (
        file.provenance.solutionRevisionId !== value.solutionRevision.id ||
        file.provenance.producer.id !== value.generator.id ||
        file.provenance.producer.version !== value.generator.version ||
        file.provenance.producer.digest !== value.generator.digest
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Workflow inventory provenance must bind its revision and generator.",
          path: ["files", index, "provenance"],
        });
      }
    });
  });

export const solutionExportOwnershipV1Schema = z
  .object({
    baselineChecksum: sha256DigestSchema.optional(),
    conflictBehavior: z.enum([
      "fail-closed",
      "preserve-user-content",
      "replace-only-when-baseline-matches",
    ]),
    ownership: solutionExportOwnershipKindV1Schema,
    path: repositoryRelativePathSchema,
    regeneration: z.enum(["never", "verified-replacement"]),
  })
  .strict();

export const solutionExportWarningV1Schema = z
  .object({
    code: stableIdSchema,
    message: safeMessageSchema,
  })
  .strict();

export const solutionExportManifestV1Schema = z
  .object({
    application: z
      .object({
        artifactDigest: sha256DigestSchema,
        generator: exactToolPinV1Schema,
      })
      .strict()
      .nullable(),
    archive: z
      .object({
        compression: z.literal("store"),
        ordering: z.literal("utf16-code-unit"),
        timestamp: z.literal(SOLUTION_EXPORT_ZIP_EPOCH),
      })
      .strict(),
    artifactReferences: z
      .array(solutionExportArtifactReferenceV1Schema)
      .max(1_024),
    conformanceDiagrams:
      solutionExportConformanceDiagramArtifactsV1Schema.optional(),
    diagram: diagramExportArtifactV1Schema.nullable(),
    contractVersion: z.literal(1),
    files: z.array(solutionExportManifestFileV1Schema).max(2_048),
    repositoryWorkflows: solutionExportRepositoryWorkflowsV1Schema.optional(),
    generationCoverage: z
      .object({
        artifact: applicationGenerationCoverageV1Schema.optional(),
        revision: solutionGenerationCoverageV1Schema,
      })
      .strict(),
    inputs: z
      .object({
        applicationContracts: sha256DigestSchema,
        architectureContent: sha256DigestSchema,
        architectureDocument: sha256DigestSchema,
        architectureVisual: sha256DigestSchema,
        externalResources: sha256DigestSchema,
        workload: sha256DigestSchema,
      })
      .strict(),
    infrastructure: z
      .object({
        artifactDigest: sha256DigestSchema,
      })
      .strict(),

    kind: z.literal("cloudmarkup.solution-export-manifest"),
    limits: solutionExportLimitsV1Schema,
    ownership: z.array(solutionExportOwnershipV1Schema).max(4_096),
    package: z
      .object({
        archiveFileName: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}\.zip$/),
        displayName: z.string().min(1).max(128),
      })
      .strict(),
    provenance: z
      .object({
        artifacts: z.array(stableIdSchema).max(10_000),
        contracts: z.array(stableIdSchema).max(10_000),
        policies: z.array(stableIdSchema).max(10_000),
        resources: z.array(stableIdSchema).max(10_000),
      })
      .strict(),
    solutionRevision: z
      .object({
        digest: sha256DigestSchema,
        id: stableIdSchema,
      })
      .strict(),
    status: z
      .object({
        evidence: z
          .object({
            evidenceIdsAtFreeze: z.array(stableIdSchema).max(10_000),
            state: z.literal("not-collected-by-export"),
          })
          .strict(),
        externalStages: solutionExportExternalStageStatusV1Schema.optional(),
        validation: z
          .object({
            state: z.literal("not-run-by-export"),
          })
          .strict(),
      })
      .strict(),
    target: z.discriminatedUnion("kind", [
      z
        .object({
          formatVersion: semanticVersionSchema,
          kind: z.literal("terraform"),
          providers: z
            .array(
              z
                .object({
                  source: z.string().min(1).max(128),
                  versionConstraint: z.string().min(1).max(256),
                })
                .strict(),
            )
            .min(1)
            .max(16),
          requiredTerraformVersion: z.string().min(1).max(256),
        })
        .strict(),
      z
        .object({
          formatVersion: semanticVersionSchema,
          kind: z.literal("cloudformation"),
          localValidation: stableIdSchema,
          templateFormat: z.literal("json"),
          templateSpecificationVersion: z.literal("2010-09-09"),
        })
        .strict(),
    ]),
    tools: z
      .object({
        catalog: exactToolPinV1Schema,
        compiler: exactToolPinV1Schema,
        generator: exactToolPinV1Schema.nullable(),
        policyPacks: z.array(exactToolPinV1Schema).max(64),
        renderer: exactToolPinV1Schema,
      })
      .strict(),
    warnings: z
      .array(solutionExportWarningV1Schema)
      .max(SOLUTION_EXPORT_V1_MAXIMA.warnings),
  })
  .strict()
  .superRefine((value, context) => {
    const allPaths = [
      ...value.files.map(({ path }) => path),
      ...(value.repositoryWorkflows?.files.map(({ path }) => path) ?? []),
    ];
    addUniquePortablePathIssues(allPaths, context, ["files"]);
    const workflows = value.repositoryWorkflows;
    if (
      workflows !== undefined &&
      value.files.some(({ path }) =>
        path.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "New manifests must inventory repository workflows outside package-local files.",
        path: ["files"],
      });
    }
  });

export const solutionExportDiagnosticV1Schema = z
  .object({
    code: stableIdSchema,
    message: safeMessageSchema,
    path: repositoryRelativePathSchema.optional(),
    severity: z.enum(["error", "warning", "info"]),
  })
  .strict();

export const solutionExportConflictV1Schema = z
  .object({
    currentChecksum: sha256DigestSchema,
    existingOwnership: solutionExportOwnershipKindV1Schema,
    path: repositoryRelativePathSchema,
    proposedChecksum: sha256DigestSchema,
    reason: safeMessageSchema,
  })
  .strict();

export type ExactToolPinV1 = z.output<typeof exactToolPinV1Schema>;
export type SolutionExportOwnershipKindV1 = z.output<
  typeof solutionExportOwnershipKindV1Schema
>;
export type SolutionExportMediaTypeV1 = z.output<
  typeof solutionExportMediaTypeV1Schema
>;
export type SolutionExportProvenanceV1 = z.output<
  typeof solutionExportProvenanceV1Schema
>;
export type SolutionExportSupplementalFileV1 = z.output<
  typeof solutionExportSupplementalFileV1Schema
>;
export type ReviewedRepositoryWorkflowsDigestPayloadV1 = z.output<
  typeof reviewedRepositoryWorkflowsDigestPayloadV1Schema
>;
export type ReviewedRepositoryWorkflowsV1 = z.output<
  typeof reviewedRepositoryWorkflowsV1Schema
>;
export type SolutionExportRepositoryWorkflowsV1 = z.output<
  typeof solutionExportRepositoryWorkflowsV1Schema
>;
export type SolutionExportDiagramV1 = z.output<
  typeof solutionExportDiagramV1Schema
>;
export type SolutionExportConformanceDiagramV1 = z.output<
  typeof solutionExportConformanceDiagramV1Schema
>;
export type SolutionExportArtifactReferenceV1 = z.output<
  typeof solutionExportArtifactReferenceV1Schema
>;
export type SolutionExportInfrastructureArtifactV1 = z.output<
  typeof solutionExportInfrastructureArtifactV1Schema
>;
export type SolutionExportRequestV1 = z.output<
  typeof solutionExportRequestV1Schema
>;
export type SolutionExportManifestV1 = z.output<
  typeof solutionExportManifestV1Schema
>;
export type SolutionExportExternalEvidenceReferenceV1 = z.output<
  typeof solutionExportExternalEvidenceReferenceV1Schema
>;
export type SolutionExportExternalStageStatusV1 = z.output<
  typeof solutionExportExternalStageStatusV1Schema
>;
export type SolutionExportManifestFileV1 = z.output<
  typeof solutionExportManifestFileV1Schema
>;
export type SolutionExportOwnershipV1 = z.output<
  typeof solutionExportOwnershipV1Schema
>;
export type SolutionExportDiagnosticV1 = z.output<
  typeof solutionExportDiagnosticV1Schema
>;
export type SolutionExportConflictV1 = z.output<
  typeof solutionExportConflictV1Schema
>;

export interface SolutionExportFileV1 {
  readonly bytes: Uint8Array;
  readonly checksum: Sha256Digest;
  readonly mediaType: SolutionExportMediaTypeV1;
  readonly ownership: SolutionExportOwnershipKindV1;
  readonly path: string;
  readonly provenance: SolutionExportProvenanceV1;
  readonly semanticChecksum: Sha256Digest;
}

export interface SolutionExportArtifactV1 {
  readonly archiveFileName: string;
  readonly files: readonly SolutionExportFileV1[];
  readonly manifest: SolutionExportManifestV1;
  readonly manifestDigest: Sha256Digest;
  readonly zipBytes: Uint8Array;
  readonly zipDigest: Sha256Digest;
}

export type SolutionExportResultV1 =
  | {
      readonly artifact: SolutionExportArtifactV1;
      readonly contractVersion: 1;
      readonly diagnostics: readonly SolutionExportDiagnosticV1[];
      readonly state: "ready";
    }
  | {
      readonly conflicts: readonly SolutionExportConflictV1[];
      readonly contractVersion: 1;
      readonly diagnostics: readonly SolutionExportDiagnosticV1[];
      readonly state: "blocked";
    };

export interface SolutionExportService {
  generate(input: unknown): SolutionExportResultV1;
  verify(
    artifact: SolutionExportArtifactV1,
  ): readonly SolutionExportDiagnosticV1[];
}

export type {
  ApplicationGenerationResultV1,
  ArchitectureDocumentV3,
  SolutionRevisionManifestV1,
};
