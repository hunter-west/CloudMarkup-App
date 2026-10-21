import {
  aiExtensionIdSchema,
  asyncJobEnvironmentV1Schema,
  evidenceRecordV1Schema,
  modelInvocationDescriptorV1Schema,
  namespacedIdentifierSchema,
  repositoryRelativePathSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  utcTimestampSchema,
  type EvidenceRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export const TERRAFORM_VALIDATION_MAXIMA = Object.freeze({
  cpuSeconds: 120,
  fileBytes: 4 * 1024 * 1024,
  files: 512,
  memoryMiB: 4_096,
  outputBytes: 2 * 1024 * 1024,
  processes: 64,
  totalFileBytes: 16 * 1024 * 1024,
  wallTimeMilliseconds: 300_000,
});

const stableIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u, "Must be a stable ID.");
const safeSummarySchema = z.string().trim().min(1).max(500);

const terraformProviderSourceSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u);
const terraformResourceTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,127}$/u);
const terraformResourceAddressSchema = z
  .string()
  .regex(
    /^(?:data\.)?[a-z][a-z0-9_]{0,127}\.[A-Za-z0-9_-]{1,128}$/u,
    "Must be one exact Terraform resource address.",
  );

const terraformProviderVersionConstraintSchema = z
  .string()
  .trim()
  .min(1)
  .max(128);

const terraformAiExtensionProviderAuthorityV1Schema = z
  .object({
    providerId: namespacedIdentifierSchema,
    source: terraformProviderSourceSchema,
    versionConstraint: terraformProviderVersionConstraintSchema,
  })
  .strict();

const terraformAiExtensionResourceAuthorityV1Schema = z
  .object({
    blockKind: z.enum(["resource", "data"]),
    providerId: namespacedIdentifierSchema,
    resourceType: terraformResourceTypeSchema,
  })
  .strict();

const terraformAiExtensionSchemaAuthorityV1Schema = z
  .object({
    schemaDigest: sha256DigestSchema,
    schemaId: namespacedIdentifierSchema,
    schemaVersion: semanticVersionSchema,
  })
  .strict();

function addUniqueArrayIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const key = value.normalize("NFC").toLowerCase();
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        message: `${path} must be unique under portable normalization.`,
        path: [path, index],
      });
    }
    seen.add(key);
  });
}

export const validationToolPinV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: namespacedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

export const terraformValidationLimitsV1Schema = z
  .object({
    cpuSeconds: z
      .number()
      .int()
      .positive()
      .max(TERRAFORM_VALIDATION_MAXIMA.cpuSeconds),
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .max(TERRAFORM_VALIDATION_MAXIMA.fileBytes),
    maxFiles: z
      .number()
      .int()
      .positive()
      .max(TERRAFORM_VALIDATION_MAXIMA.files),
    maxOutputBytes: z
      .number()
      .int()
      .positive()
      .max(TERRAFORM_VALIDATION_MAXIMA.outputBytes),
    maxProcesses: z
      .number()
      .int()
      .positive()
      .max(TERRAFORM_VALIDATION_MAXIMA.processes),
    maxTotalFileBytes: z
      .number()
      .int()
      .positive()
      .max(TERRAFORM_VALIDATION_MAXIMA.totalFileBytes),
    memoryMiB: z
      .number()
      .int()
      .min(128)
      .max(TERRAFORM_VALIDATION_MAXIMA.memoryMiB),
    wallTimeMilliseconds: z
      .number()
      .int()
      .min(1_000)
      .max(TERRAFORM_VALIDATION_MAXIMA.wallTimeMilliseconds),
  })
  .strict();

export const terraformValidationReferenceV1Schema = z
  .object({
    edgeIds: z.array(stableIdSchema).max(256),
    nodeIds: z.array(stableIdSchema).max(256),
    ownedPolicyIds: z.array(stableIdSchema).max(256),
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict();

export const terraformValidationFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    content: z.string().max(TERRAFORM_VALIDATION_MAXIMA.fileBytes),
    path: repositoryRelativePathSchema,
    references: terraformValidationReferenceV1Schema,
  })
  .strict();

export const approvedProviderV1Schema = z
  .object({
    mirrorPackageDigest: sha256DigestSchema,
    source: z.string().regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u),
    version: semanticVersionSchema,
  })
  .strict();

export const approvedModuleV1Schema = z
  .object({
    digest: sha256DigestSchema,
    source: z.string().min(1).max(256),
    version: semanticVersionSchema,
  })
  .strict();

export const approvedOptionalToolV1Schema = z
  .object({
    configDigest: sha256DigestSchema,
    required: z.boolean(),
    tool: validationToolPinV1Schema,
  })
  .strict();

export const terraformValidationPolicyV1Schema = z
  .object({
    compiler: validationToolPinV1Schema,
    contractVersion: z.literal(1),
    container: z
      .object({
        digest: sha256DigestSchema,
        image: z.string().regex(/^[a-z0-9][a-z0-9./_-]{1,255}$/u),
        platform: z.literal("linux/amd64"),
        providerMirrorPath: z.literal("/opt/cloudmarkup/provider-mirror"),
        terraformCliConfigPath: z.literal("/opt/cloudmarkup/terraform.rc"),
      })
      .strict(),
    limits: terraformValidationLimitsV1Schema,
    modules: z.array(approvedModuleV1Schema).max(64),
    organizationPolicy: approvedOptionalToolV1Schema.optional(),
    providerLock: z
      .object({
        checksum: sha256DigestSchema,
        content: z.string().min(1).max(TERRAFORM_VALIDATION_MAXIMA.fileBytes),
      })
      .strict(),
    providers: z.array(approvedProviderV1Schema).min(1).max(64),
    runner: validationToolPinV1Schema,
    scanner: approvedOptionalToolV1Schema.optional(),
    terraform: validationToolPinV1Schema,
    tflint: approvedOptionalToolV1Schema.optional(),
  })
  .strict()
  .superRefine((policy, context) => {
    const providerSources = new Set<string>();
    const providerNames = new Set<string>();
    policy.providers.forEach((provider, index) => {
      const providerName = provider.source.split("/").at(-1) ?? "";
      if (providerSources.has(provider.source)) {
        context.addIssue({
          code: "custom",
          message: "Approved provider sources must be unique.",
          path: ["providers", index, "source"],
        });
      }
      if (providerNames.has(providerName)) {
        context.addIssue({
          code: "custom",
          message: "Approved provider local names must be unambiguous.",
          path: ["providers", index, "source"],
        });
      }
      providerSources.add(provider.source);
      providerNames.add(providerName);
    });
    const moduleSources = new Set<string>();
    policy.modules.forEach((module, index) => {
      if (moduleSources.has(module.source)) {
        context.addIssue({
          code: "custom",
          message: "Approved module sources must be unique.",
          path: ["modules", index, "source"],
        });
      }
      moduleSources.add(module.source);
    });
  });

export const terraformAiExtensionContextV1Schema = z
  .object({
    baseline: z
      .object({
        artifactDigest: sha256DigestSchema,
        compiler: validationToolPinV1Schema,
        solutionRevisionDigest: sha256DigestSchema,
      })
      .strict(),
    candidateArtifactDigest: sha256DigestSchema,
    candidateDigest: sha256DigestSchema,
    candidateDigestCanonicalization: z.literal(
      "cloudmarkup.terraform-validation-tree.path-checksum.v1",
    ),
    candidateOwnedPaths: z
      .array(
        repositoryRelativePathSchema.refine(
          (path) => path.startsWith("infrastructure/") && path.endsWith(".tf"),
          "AI-authored Terraform extension paths must be infrastructure/*.tf files.",
        ),
      )
      .min(1)
      .max(TERRAFORM_VALIDATION_MAXIMA.files),
    contractVersion: z.literal(1),
    extensionId: aiExtensionIdSchema,
    maximumResourceCount: z.number().int().nonnegative().max(4_096),
    mode: z.literal("ai-authored-extension"),
    modelDescriptor: modelInvocationDescriptorV1Schema,
    modelOutputDigest: sha256DigestSchema,
    officialSchemaAuthorities: z
      .array(terraformAiExtensionSchemaAuthorityV1Schema)
      .min(1)
      .max(128),
    ownedResourceAddresses: z.array(terraformResourceAddressSchema).max(4_096),
    providerAuthorities: z
      .array(terraformAiExtensionProviderAuthorityV1Schema)
      .min(1)
      .max(64),
    protectedDeterministicFiles: z
      .array(
        z
          .object({
            checksum: sha256DigestSchema,
            path: repositoryRelativePathSchema.refine(
              (path) =>
                path.startsWith("infrastructure/") && path.endsWith(".tf"),
              "Protected deterministic Terraform paths must be infrastructure/*.tf files.",
            ),
          })
          .strict(),
      )
      .min(1)
      .max(TERRAFORM_VALIDATION_MAXIMA.files),
    protectedDeterministicResourceAddresses: z
      .array(terraformResourceAddressSchema)
      .max(2_048),
    resourceAuthorities: z
      .array(terraformAiExtensionResourceAuthorityV1Schema)
      .min(1)
      .max(512),
    slotId: namespacedIdentifierSchema,
    target: z.literal("terraform"),
    validationTreeDigestCanonicalization: z.literal(
      "cloudmarkup.terraform-validation-tree.path-checksum.v1",
    ),
  })
  .strict()
  .superRefine((value, context) => {
    addUniqueArrayIssues(
      value.candidateOwnedPaths,
      context,
      "candidateOwnedPaths",
    );
    addUniqueArrayIssues(
      value.protectedDeterministicFiles.map(({ path }) => path),
      context,
      "protectedDeterministicFiles",
    );
    addUniqueArrayIssues(
      value.ownedResourceAddresses,
      context,
      "ownedResourceAddresses",
    );
    addUniqueArrayIssues(
      value.protectedDeterministicResourceAddresses,
      context,
      "protectedDeterministicResourceAddresses",
    );
    const providerIds = new Set<string>();
    const providerSources = new Set<string>();
    const providerLocalNames = new Set<string>();
    value.providerAuthorities.forEach((provider, index) => {
      const localName = provider.source.split("/").at(-1) ?? "";
      if (
        providerIds.has(provider.providerId) ||
        providerSources.has(provider.source) ||
        providerLocalNames.has(localName)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "AI-extension provider identities, sources, and local names must be unambiguous.",
          path: ["providerAuthorities", index],
        });
      }
      providerIds.add(provider.providerId);
      providerSources.add(provider.source);
      providerLocalNames.add(localName);
    });
    const resourceKeys = new Set<string>();
    value.resourceAuthorities.forEach((resource, index) => {
      const key = [resource.blockKind, resource.resourceType].join("\u0000");
      if (resourceKeys.has(key) || !providerIds.has(resource.providerId)) {
        context.addIssue({
          code: "custom",
          message:
            "AI-extension resource authority must be unique and bind one approved provider.",
          path: ["resourceAuthorities", index],
        });
      }
      resourceKeys.add(key);
    });
    const schemaKeys = new Set<string>();
    value.officialSchemaAuthorities.forEach((schema, index) => {
      const key = [schema.schemaId, schema.schemaVersion].join("\u0000");
      if (schemaKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Official schema authority identities must be unique.",
          path: ["officialSchemaAuthorities", index],
        });
      }
      schemaKeys.add(key);
    });
    const protectedAddresses = new Set(
      value.protectedDeterministicResourceAddresses.map((address) =>
        address.normalize("NFC").toLowerCase(),
      ),
    );
    value.ownedResourceAddresses.forEach((address, index) => {
      const normalized = address.normalize("NFC").toLowerCase();
      const segments = normalized.split(".");
      const blockKind = segments[0] === "data" ? "data" : "resource";
      const resourceType = blockKind === "data" ? segments[1] : segments[0];
      if (
        protectedAddresses.has(normalized) ||
        resourceType === undefined ||
        !resourceKeys.has([blockKind, resourceType].join("\u0000"))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every owned Terraform address must be disjoint from protected addresses and bind one exact resource authority.",
          path: ["ownedResourceAddresses", index],
        });
      }
    });
    if (
      value.ownedResourceAddresses.length > value.maximumResourceCount ||
      (value.modelDescriptor.feature !== "iac-extension.generate" &&
        value.modelDescriptor.feature !== "candidate.repair")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "AI-extension address and model authority must remain inside the exact Terraform generation boundary.",
        path: ["maximumResourceCount"],
      });
    }
  });

export const terraformValidationRequestV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    assessedAt: utcTimestampSchema,
    compiler: validationToolPinV1Schema,
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    extensionContext: terraformAiExtensionContextV1Schema.optional(),
    files: z
      .array(terraformValidationFileV1Schema)
      .min(1)
      .max(TERRAFORM_VALIDATION_MAXIMA.files),
    solutionRevisionDigest: sha256DigestSchema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict();

export const terraformValidationDiagnosticV1Schema = z
  .object({
    code: namespacedIdentifierSchema,
    detail: z.string().trim().min(1).max(2_000),
    path: repositoryRelativePathSchema.optional(),
    references: terraformValidationReferenceV1Schema,
    severity: z.enum(["error", "warning", "info"]),
    source: z.enum([
      "admission",
      "terraform-fmt",
      "terraform-init",
      "terraform-validate",
      "tflint",
      "scanner",
      "organization-policy",
      "runner",
    ]),
    summary: safeSummarySchema,
  })
  .strict();

export const terraformValidationCommandSummaryV1Schema = z
  .object({
    executable: z.enum(["terraform", "tflint", "trivy"]),
    outputBytes: z.number().int().nonnegative(),
    state: z.enum([
      "passed",
      "failed",
      "timeout",
      "cancelled",
      "output-limit",
      "unavailable",
    ]),
    step: z.enum(["fmt", "init", "validate", "tflint", "scanner"]),
  })
  .strict();

export const terraformValidationResultV1Schema = z
  .object({
    commandSummaries: z.array(terraformValidationCommandSummaryV1Schema).max(8),
    contractVersion: z.literal(1),
    diagnostics: z.array(terraformValidationDiagnosticV1Schema).max(1_000),
    evidenceRecords: z.array(evidenceRecordV1Schema).max(2),
    reportDigest: sha256DigestSchema,
    state: z.enum(["passed", "failed", "error", "cancelled"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.state === "passed" &&
      value.commandSummaries.some(({ state }) => state === "failed")
    ) {
      context.addIssue({
        code: "custom",
        message: "A passed validation result cannot contain a failed command.",
        path: ["state"],
      });
    }
  });

export type ValidationToolPinV1 = z.output<typeof validationToolPinV1Schema>;
export type TerraformValidationLimitsV1 = z.output<
  typeof terraformValidationLimitsV1Schema
>;
export type TerraformValidationReferenceV1 = z.output<
  typeof terraformValidationReferenceV1Schema
>;
export type TerraformValidationFileV1 = z.output<
  typeof terraformValidationFileV1Schema
>;
export type TerraformValidationPolicyV1 = z.output<
  typeof terraformValidationPolicyV1Schema
>;
export type TerraformAiExtensionContextV1 = z.output<
  typeof terraformAiExtensionContextV1Schema
>;
export type TerraformValidationRequestV1 = z.output<
  typeof terraformValidationRequestV1Schema
>;
export type TerraformValidationDiagnosticV1 = z.output<
  typeof terraformValidationDiagnosticV1Schema
>;
export type TerraformValidationCommandSummaryV1 = z.output<
  typeof terraformValidationCommandSummaryV1Schema
>;
export type TerraformValidationResultV1 = z.output<
  typeof terraformValidationResultV1Schema
>;
export type { EvidenceRecordV1, Sha256Digest };

export type ValidationExecutable = "terraform" | "tflint" | "trivy";
export type ValidationStep = "fmt" | "init" | "validate" | "tflint" | "scanner";

export interface ValidationCommandInvocation {
  readonly args: readonly string[];
  readonly executable: ValidationExecutable;
  readonly step: ValidationStep;
}

export interface ValidationCommandResult {
  readonly exitCode: number | null;
  readonly outputBytes: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly termination:
    "completed" | "timeout" | "cancelled" | "output-limit" | "unavailable";
}

export interface ValidationWorkspaceSession {
  execute(
    invocation: ValidationCommandInvocation,
    signal?: AbortSignal,
  ): Promise<ValidationCommandResult>;
  dispose(): Promise<void>;
}

export interface ValidationWorkspaceExecutor {
  open(input: {
    readonly files: readonly TerraformValidationFileV1[];
    readonly limits: TerraformValidationLimitsV1;
    readonly providerLock: TerraformValidationPolicyV1["providerLock"];
  }): Promise<ValidationWorkspaceSession>;
}

export interface OrganizationPolicyEvaluator {
  evaluate(input: {
    readonly artifactDigest: Sha256Digest;
    readonly diagnostics: readonly TerraformValidationDiagnosticV1[];
    readonly files: readonly TerraformValidationFileV1[];
    readonly solutionRevisionId: string;
  }): Promise<readonly TerraformValidationDiagnosticV1[]>;
}

export interface TerraformValidationRunner {
  run(
    input: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TerraformValidationResultV1>;
}
