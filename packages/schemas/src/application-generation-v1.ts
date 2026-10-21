import { z } from "zod";

import { architectureDocumentV3Schema } from "./architecture-document-v3.js";
import {
  digestCanonicalValue,
  encodeUtf8,
  sha256Bytes,
} from "./canonical-digest.js";
import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
} from "./architecture-document-v1.js";
import {
  generationCoverageRequirementSchema,
  generationCoverageStateSchema,
} from "./generation-coverage-v1.js";
import {
  repositoryConflictBehaviorV1Schema,
  repositoryPackagePathSchema,
  repositoryPathOwnershipKindV1Schema,
  repositoryRegenerationPolicyV1Schema,
  repositoryRelativePathSchema,
  repositorySemanticDiffStrategyV1Schema,
} from "./repository-ownership-v1.js";
import { solutionRevisionManifestV1Schema } from "./solution-revision-v1.js";
import { workloadBehaviorV2Schema } from "./workload-behavior-v2.js";

export const APPLICATION_GENERATION_V1_LIMITS = Object.freeze({
  diagnostics: 256,
  files: 64,
  artifactBytes: 32 << 20,
  normalizedResources: 2_000,
  normalizedConnections: 10_000,
  normalizedWorkloads: 1_000,
  normalizedRecords: 10_000,
  sourceReferences: 64,
  text: 8_000,
} as const);

const boundedIdentifierSchema = z.string().trim().min(1).max(512);
const boundedShortTextSchema = z.string().trim().min(1).max(1_000);
const diagnosticCodeSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_]{0,127}$/,
    "Must be a stable uppercase diagnostic code.",
  );
const mediaTypeSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/,
    "Must be a lowercase media type without parameters.",
  );
export const applicationRepositoryPathV1Schema =
  repositoryRelativePathSchema.refine(
    (path) => path.startsWith("application/"),
    "Application source paths must remain under application/.",
  );

export const applicationManifestPathV1Schema = z.literal(
  "application/manifest.json",
);

const applicationArtifactPathV1Schema = applicationRepositoryPathV1Schema
  .refine(
    (path) => path.startsWith("application/artifacts/"),
    "Built workload artifacts must remain under application/artifacts/.",
  )
  .refine(
    (path) => path.endsWith(".zip"),
    "The Prompt 32A Lambda artifact path must end in .zip.",
  );

function addUniqueStringIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  description: string,
) {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `${description} must be unique.`,
        path: [...path, index],
      });
    }
    seen.add(value);
  }
}
function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function addCanonicalStringArrayIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  description: string,
) {
  addUniqueStringIssues(values, context, path, description);
  const sorted = [...values].sort(compareUtf16);
  const firstOutOfOrder = values.findIndex(
    (value, index) => value !== sorted[index],
  );
  if (firstOutOfOrder !== -1) {
    context.addIssue({
      code: "custom",
      message: `${description} must use canonical UTF-16 order.`,
      path: [...path, firstOutOfOrder],
    });
  }
}

export type NormalizedJsonValueV1 =
  | null
  | boolean
  | number
  | string
  | NormalizedJsonValueV1[]
  | { readonly [key: string]: NormalizedJsonValueV1 };

/** JSON-only data accepted by Go's json.RawMessage and `any` fields. */
export const normalizedJsonValueV1Schema: z.ZodType<NormalizedJsonValueV1> =
  z.lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number(),
      z.string().max(APPLICATION_GENERATION_V1_LIMITS.artifactBytes),
      z
        .array(normalizedJsonValueV1Schema)
        .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
      z
        .record(z.string().min(1).max(512), normalizedJsonValueV1Schema)
        .superRefine((value, context) => {
          if (
            Object.keys(value).length >
            APPLICATION_GENERATION_V1_LIMITS.normalizedRecords
          ) {
            context.addIssue({
              code: "too_big",
              maximum: APPLICATION_GENERATION_V1_LIMITS.normalizedRecords,
              origin: "object",
              inclusive: true,
              message: "Normalized JSON objects are bounded.",
            });
          }
        }),
    ]),
  );

export const normalizedConfigurationValueV1Schema = z
  .object({
    attribute: boundedIdentifierSchema.optional(),
    kind: boundedIdentifierSchema,
    nodeId: boundedIdentifierSchema.optional(),
    reference: boundedIdentifierSchema.optional(),
    value: normalizedJsonValueV1Schema.optional(),
    variableId: boundedIdentifierSchema.optional(),
  })
  .strict();

export const normalizedConfigurationV1Schema = z
  .object({
    schemaId: boundedIdentifierSchema,
    schemaVersion: semanticVersionSchema,
    values: z
      .record(z.string().min(1).max(512), normalizedConfigurationValueV1Schema)
      .superRefine((value, context) => {
        if (
          Object.keys(value).length >
          APPLICATION_GENERATION_V1_LIMITS.normalizedRecords
        ) {
          context.addIssue({
            code: "too_big",
            maximum: APPLICATION_GENERATION_V1_LIMITS.normalizedRecords,
            origin: "object",
            inclusive: true,
            message: "Normalized configuration values are bounded.",
          });
        }
      }),
  })
  .strict();

export const normalizedGeneratedProvenanceV1Schema = z
  .object({
    dependentEdgeIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedConnections),
    dependentNodeIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedResources),
    generatorId: boundedIdentifierSchema,
    generatorKind: boundedIdentifierSchema,
    generatorVersion: semanticVersionSchema,
    operationId: boundedIdentifierSchema,
  })
  .strict();

export const normalizedLifecycleV1Schema = z
  .object({
    adoptedBy: boundedIdentifierSchema.optional(),
    origin: boundedIdentifierSchema,
    ownership: boundedIdentifierSchema,
    provenance: normalizedGeneratedProvenanceV1Schema.optional(),
  })
  .strict();

export const normalizedResourceReferenceV1Schema = z
  .object({
    attribute: boundedIdentifierSchema.optional(),
    nodeId: boundedIdentifierSchema,
    port: boundedIdentifierSchema.optional(),
    targetKey: boundedIdentifierSchema,
  })
  .strict();

export const normalizedResourceV1Schema = z
  .object({
    configuration: normalizedConfigurationV1Schema,
    deploymentKey: boundedIdentifierSchema,
    id: boundedIdentifierSchema,
    lifecycle: normalizedLifecycleV1Schema,
    parent: normalizedResourceReferenceV1Schema
      .extend({ relationshipType: boundedIdentifierSchema.optional() })
      .strict()
      .optional(),
    resourceType: boundedIdentifierSchema,
    serviceType: boundedIdentifierSchema,
    targetKey: boundedIdentifierSchema,
    workloadIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedWorkloads),
  })
  .strict();

export const normalizedConnectionV1Schema = z
  .object({
    configuration: normalizedConfigurationV1Schema,
    id: boundedIdentifierSchema,
    lifecycle: normalizedLifecycleV1Schema,
    relationshipType: boundedIdentifierSchema,
    source: normalizedResourceReferenceV1Schema,
    target: normalizedResourceReferenceV1Schema,
  })
  .strict();

export const normalizedPolicyAttachmentV1Schema = z
  .object({
    configuration: normalizedConfigurationV1Schema,
    ownerReferences: z
      .array(normalizedResourceReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedResources),
    ownership: boundedIdentifierSchema,
    provenance: normalizedGeneratedProvenanceV1Schema.optional(),
    resourceId: boundedIdentifierSchema,
    resourceType: boundedIdentifierSchema,
    targetKey: boundedIdentifierSchema,
  })
  .strict();

export const normalizedEnvironmentBindingV1Schema = z
  .object({
    id: boundedIdentifierSchema,
    kind: boundedIdentifierSchema,
    name: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,127}$/, "Must be a portable environment name."),
    resource: normalizedResourceReferenceV1Schema.optional(),
    secretReference: boundedIdentifierSchema.optional(),
    variableId: boundedIdentifierSchema.optional(),
  })
  .strict();

export const normalizedContractReferenceV1Schema = z
  .object({
    contractId: boundedIdentifierSchema,
    contractKind: boundedIdentifierSchema.optional(),
    contractVersion: semanticVersionSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const normalizedOperationBindingV1Schema = z
  .object({
    capability: boundedIdentifierSchema,
    id: boundedIdentifierSchema,
    inputContract: normalizedContractReferenceV1Schema.optional(),
    outputContract: normalizedContractReferenceV1Schema.optional(),
  })
  .strict();

export const normalizedTriggerBindingV1Schema = z
  .object({
    connection: normalizedConnectionV1Schema.optional(),
    edgeId: boundedIdentifierSchema.optional(),
    id: boundedIdentifierSchema,
    kind: boundedIdentifierSchema,
    operationId: boundedIdentifierSchema,
  })
  .strict();

export const normalizedSourceOwnershipV1Schema = z
  .object({
    baselineDigest: sha256DigestSchema.optional(),
    conflictBehavior: repositoryConflictBehaviorV1Schema,
    declarationId: boundedIdentifierSchema,
    extensionPointId: boundedIdentifierSchema.optional(),
    normalizerId: boundedIdentifierSchema.optional(),
    normalizerVersion: semanticVersionSchema.optional(),
    ownerId: boundedIdentifierSchema,
    ownership: repositoryPathOwnershipKindV1Schema,
    path: repositoryPackagePathSchema,
    pathKind: z.enum(["file", "directory", "subtree"]),
    regeneration: repositoryRegenerationPolicyV1Schema,
    semanticDiff: repositorySemanticDiffStrategyV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.normalizerId === undefined) !==
      (value.normalizerVersion === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Normalizer identity and version must be supplied together.",
        path: ["normalizerId"],
      });
    }
    if (
      value.regeneration === "replace-when-baseline-matches" &&
      value.baselineDigest === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Safe replacement requires an exact baseline digest.",
        path: ["baselineDigest"],
      });
    }
    if (
      value.ownership === "approved-extension" &&
      value.extensionPointId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved extensions require an extension point.",
        path: ["extensionPointId"],
      });
    }
    if (value.ownership === "user-owned" && value.regeneration !== "never") {
      context.addIssue({
        code: "custom",
        message: "User-owned source cannot be regenerated.",
        path: ["regeneration"],
      });
    }
  });

export const normalizedExtensionPointV1Schema = z
  .object({
    conflictBehavior: repositoryConflictBehaviorV1Schema,
    id: boundedIdentifierSchema,
    kind: boundedIdentifierSchema,
    path: repositoryPackagePathSchema,
    permittedOwnership: z.array(repositoryPathOwnershipKindV1Schema).max(6),
  })
  .strict();

export const normalizedArtifactReferenceV1Schema = z
  .object({
    artifactId: boundedIdentifierSchema,
    digest: sha256DigestSchema,
    kind: boundedIdentifierSchema,
    mediaType: mediaTypeSchema.optional(),
    ownership: boundedIdentifierSchema,
    workloadId: boundedIdentifierSchema,
  })
  .strict();

export const normalizedToolReferenceV1Schema = z
  .object({
    digest: sha256DigestSchema.optional(),
    id: boundedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

export const normalizedGeneratorReadinessV1Schema = z
  .object({
    generator: normalizedToolReferenceV1Schema.optional(),
    reasons: z.array(boundedShortTextSchema).max(64),
    state: boundedIdentifierSchema,
    templateId: boundedIdentifierSchema.optional(),
    templateVersion: semanticVersionSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.templateId === undefined) !==
      (value.templateVersion === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Template identity and version must be supplied together.",
        path: ["templateId"],
      });
    }
  });

export const applicationImplementationModeV1Schema = z.enum([
  "infrastructure-only",
  "user-provided",
  "generated-starter",
  "complete-supported-pattern",
  "ai-assisted-custom",
  "external-artifact",
]);

export const applicationExpectedLambdaArtifactV1Schema = z
  .object({
    kind: z.literal("aws-lambda-zip"),
    mediaType: z.literal("application/zip"),
    path: applicationArtifactPathV1Schema,
  })
  .strict();

const applicationWorkloadPackageV1Shape = {
  expectedArtifact: applicationExpectedLambdaArtifactV1Schema,
  handler: boundedIdentifierSchema,
  packageManifestPath: applicationRepositoryPathV1Schema,
  packageRoot: z.literal("application"),
  runtimeFamily: namespacedIdentifierSchema,
} as const;

const applicationWorkloadSourceReferenceV1Schema = z
  .object({
    ownership: z.enum(["generated", "user-owned", "approved-extension"]),
    path: applicationRepositoryPathV1Schema,
  })
  .strict();

export const infrastructureOnlyWorkloadContractV1Schema = z
  .object({
    implementationMode: z.literal("infrastructure-only"),
    ownershipReadiness: z.literal("not-applicable"),
    readiness: z.literal("application-code-required"),
    workloadId: boundedIdentifierSchema,
  })
  .strict();

export const userProvidedWorkloadContractV1Schema = z
  .object({
    ...applicationWorkloadPackageV1Shape,
    implementationMode: z.literal("user-provided"),
    ownershipReadiness: z.literal("user-source-preserved"),
    readiness: z.literal("user-source-required"),
    workloadId: boundedIdentifierSchema,
  })
  .strict();

export const generatedStarterWorkloadContractV1Schema = z
  .object({
    ...applicationWorkloadPackageV1Shape,
    implementationMode: z.literal("generated-starter"),
    ownershipReadiness: z.enum([
      "safe-to-materialize",
      "not-safe-to-materialize",
    ]),
    readiness: z.enum(["starter-source-ready", "generation-blocked"]),
    sourceFiles: z
      .array(applicationWorkloadSourceReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    workloadId: boundedIdentifierSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const ready = value.readiness === "starter-source-ready";
    if (
      ready !==
      (value.ownershipReadiness === "safe-to-materialize" &&
        value.sourceFiles.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Starter source is ready only with materializable emitted files.",
        path: ["readiness"],
      });
    }
  });

export const completeSupportedPatternWorkloadContractV1Schema = z
  .object({
    ...applicationWorkloadPackageV1Shape,
    implementationMode: z.literal("complete-supported-pattern"),
    ownershipReadiness: z.enum([
      "safe-to-materialize",
      "not-safe-to-materialize",
    ]),
    readiness: z.enum(["complete-source-ready", "generation-blocked"]),
    sourceFiles: z
      .array(applicationWorkloadSourceReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    workloadId: boundedIdentifierSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const ready = value.readiness === "complete-source-ready";
    if (
      ready !==
      (value.ownershipReadiness === "safe-to-materialize" &&
        value.sourceFiles.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Complete source is ready only with materializable emitted files.",
        path: ["readiness"],
      });
    }
  });

export const aiAssistedCustomWorkloadContractV1Schema = z
  .object({
    ...applicationWorkloadPackageV1Shape,
    implementationMode: z.literal("ai-assisted-custom"),
    ownershipReadiness: z.enum([
      "extension-boundary-ready",
      "not-safe-to-materialize",
    ]),
    readiness: z.enum(["custom-source-required", "generation-blocked"]),
    sourceFiles: z
      .array(applicationWorkloadSourceReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    validationRequirements: z
      .array(
        z.enum([
          "parse",
          "static-analysis",
          "build",
          "unit-tests",
          "contract-tests",
          "security",
        ]),
      )
      .max(6),
    workloadId: boundedIdentifierSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const ready = value.readiness === "custom-source-required";
    if (
      ready !==
      (value.ownershipReadiness === "extension-boundary-ready" &&
        value.sourceFiles.length > 0 &&
        value.validationRequirements.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Custom-source handoff is ready only with scaffold, ownership, and validation requirements.",
        path: ["readiness"],
      });
    }
  });

export const externalArtifactWorkloadContractV1Schema = z
  .object({
    artifact: z
      .object({
        artifactId: boundedIdentifierSchema,
        digest: sha256DigestSchema,
        resolution: z.literal("reference-only"),
      })
      .strict(),
    implementationMode: z.literal("external-artifact"),
    ownershipReadiness: z.literal("not-applicable"),
    readiness: z.literal("external-artifact-reference-ready"),
    workloadId: boundedIdentifierSchema,
  })
  .strict();

export const applicationWorkloadContractV1Schema = z.discriminatedUnion(
  "implementationMode",
  [
    infrastructureOnlyWorkloadContractV1Schema,
    userProvidedWorkloadContractV1Schema,
    generatedStarterWorkloadContractV1Schema,
    completeSupportedPatternWorkloadContractV1Schema,
    aiAssistedCustomWorkloadContractV1Schema,
    externalArtifactWorkloadContractV1Schema,
  ],
);

export const normalizedWorkloadV1Schema = z
  .object({
    artifactInputs: z
      .array(normalizedArtifactReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    artifactOutputs: z
      .array(normalizedArtifactReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    downstreamActions: z
      .array(normalizedTriggerBindingV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedConnections),
    environment: z
      .array(normalizedEnvironmentBindingV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    extensionPoints: z
      .array(normalizedExtensionPointV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    generationCoverage: boundedIdentifierSchema,
    generatorReadiness: normalizedGeneratorReadinessV1Schema,
    handler: boundedIdentifierSchema.optional(),
    id: boundedIdentifierSchema,
    implementationMode: applicationImplementationModeV1Schema,
    languageFamily: boundedIdentifierSchema.optional(),
    operations: z
      .array(normalizedOperationBindingV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    owningResource: normalizedResourceReferenceV1Schema,
    runtimeFamily: boundedIdentifierSchema.optional(),
    sourceOwner: boundedIdentifierSchema.optional(),
    sourceOwnership: z
      .array(normalizedSourceOwnershipV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    specification: normalizedJsonValueV1Schema,
    targetReadiness: boundedIdentifierSchema,
    triggers: z
      .array(normalizedTriggerBindingV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedConnections),
  })
  .strict();

export const normalizedVariableV1Schema = z
  .object({
    defaultValue: normalizedConfigurationValueV1Schema.optional(),
    id: boundedIdentifierSchema,
    key: boundedIdentifierSchema,
    required: z.boolean(),
    valueType: boundedIdentifierSchema,
  })
  .strict();

export const normalizedOutputV1Schema = z
  .object({
    id: boundedIdentifierSchema,
    key: boundedIdentifierSchema,
    kind: boundedIdentifierSchema,
    resource: normalizedResourceReferenceV1Schema.optional(),
    sensitive: z.boolean(),
    variableId: boundedIdentifierSchema.optional(),
  })
  .strict();

export const normalizedExternalResourceAddressV1Schema = z
  .object({
    id: boundedIdentifierSchema,
    kind: boundedIdentifierSchema,
    value: z.string().min(1).max(4_096).optional(),
  })
  .strict();

export const normalizedExternalResourceBehaviorV1Schema = z
  .object({
    create: boundedIdentifierSchema,
    dataSource: boundedIdentifierSchema,
    import: boundedIdentifierSchema,
    importAddressId: boundedIdentifierSchema.optional(),
    reference: boundedIdentifierSchema,
  })
  .strict();

export const normalizedExternalResourceTargetV1Schema = z
  .object({
    mappingId: boundedIdentifierSchema.optional(),
    mappingVersion: semanticVersionSchema.optional(),
    readiness: boundedIdentifierSchema,
    target: z.enum(["terraform", "cloudformation"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.mappingId === undefined) !==
      (value.mappingVersion === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "External mapping identity and version must be supplied together.",
        path: ["mappingId"],
      });
    }
  });

export const normalizedExternalResourceV1Schema = z
  .object({
    addresses: z
      .array(normalizedExternalResourceAddressV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    architectureNodes: z
      .array(normalizedResourceReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedResources),
    behavior: normalizedExternalResourceBehaviorV1Schema,
    id: boundedIdentifierSchema,
    lifecycleAuthority: boundedIdentifierSchema,
    ownershipState: boundedIdentifierSchema,
    resourceType: boundedIdentifierSchema,
    targets: z.array(normalizedExternalResourceTargetV1Schema).max(2),
  })
  .strict();

export const normalizedTargetReadinessV1Schema = z
  .object({
    contractVersion: semanticVersionSchema,
    reasons: z.array(boundedShortTextSchema).max(64),
    renderingAvailable: z.boolean(),
    state: boundedIdentifierSchema,
    target: z.enum(["terraform", "cloudformation"]),
  })
  .strict();

export const normalizedCatalogReferenceV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: boundedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

export const normalizedSolutionProvenanceV1Schema = z
  .object({
    architectureContentHash: sha256DigestSchema,
    architectureDocumentHash: sha256DigestSchema,
    architectureDocumentId: boundedIdentifierSchema,
    architectureId: boundedIdentifierSchema,
    architectureRevisionId: boundedIdentifierSchema,
    architectureVisualHash: sha256DigestSchema,
    catalog: normalizedCatalogReferenceV1Schema,
    providerId: boundedIdentifierSchema,
    region: boundedIdentifierSchema,
    solutionRevisionId: boundedIdentifierSchema.optional(),
    workloadContentHash: sha256DigestSchema,
  })
  .strict();

/** Exact strict TypeScript mirror of Go compiler.NormalizedSolution v1. */
export const normalizedSolutionV1Schema = z
  .object({
    connections: z
      .array(normalizedConnectionV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedConnections),
    contractVersion: z.literal(1),
    externalResources: z
      .array(normalizedExternalResourceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedResources),
    outputs: z
      .array(normalizedOutputV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    policyAttachments: z
      .array(normalizedPolicyAttachmentV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    provenance: normalizedSolutionProvenanceV1Schema,
    resources: z
      .array(normalizedResourceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedResources),
    target: normalizedTargetReadinessV1Schema,
    variables: z
      .array(normalizedVariableV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    workloads: z
      .array(normalizedWorkloadV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedWorkloads),
  })
  .strict();

export const applicationGeneratorPinV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: namespacedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

export const applicationTemplatePinV1Schema = applicationGeneratorPinV1Schema;
export const applicationPatternPinV1Schema = applicationGeneratorPinV1Schema;

export const applicationRuntimePinV1Schema = applicationGeneratorPinV1Schema
  .extend({
    handler: boundedIdentifierSchema,
    languageFamily: namespacedIdentifierSchema,
    moduleFormat: z.enum(["esm", "commonjs"]),
    runtime: boundedIdentifierSchema,
    runtimeFamily: namespacedIdentifierSchema,
  })
  .strict();

const existingApplicationOwnershipV1Schema = z.enum([
  "generated",
  "ai-authored",
  "user-owned",
  "approved-extension",
]);

export const existingApplicationFileV1Schema = z
  .object({
    baselineChecksum: sha256DigestSchema.optional(),
    currentChecksum: sha256DigestSchema,
    mediaType: mediaTypeSchema,
    ownership: existingApplicationOwnershipV1Schema,
    path: applicationRepositoryPathV1Schema,
    semanticChecksum: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(APPLICATION_GENERATION_V1_LIMITS.artifactBytes),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.ownership === "generated" &&
      value.baselineChecksum === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Existing generated files require an exact baseline checksum.",
        path: ["baselineChecksum"],
      });
    }
    if (
      value.ownership !== "generated" &&
      value.baselineChecksum !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Only generated files may carry a replacement baseline.",
        path: ["baselineChecksum"],
      });
    }
  });

export const applicationGenerationRequestV1Schema = z
  .object({
    architectureDocument: architectureDocumentV3Schema,
    contractVersion: z.literal(1),
    existingFiles: z
      .array(existingApplicationFileV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    generator: applicationGeneratorPinV1Schema,
    normalizedSolution: normalizedSolutionV1Schema,
    pattern: applicationPatternPinV1Schema,
    runtime: applicationRuntimePinV1Schema,
    solutionRevision: solutionRevisionManifestV1Schema,
    template: applicationTemplatePinV1Schema,
    workloadBehavior: workloadBehaviorV2Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const revision = value.solutionRevision;
    const provenance = value.normalizedSolution.provenance;

    if (
      revision.architecture.revisionId !==
      value.architectureDocument.revision.revisionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Solution Revision must bind the supplied Architecture revision.",
        path: ["solutionRevision", "architecture", "revisionId"],
      });
    }
    if (
      provenance.architectureDocumentId !==
        value.architectureDocument.documentId ||
      provenance.architectureId !== value.architectureDocument.architectureId ||
      provenance.architectureRevisionId !==
        value.architectureDocument.revision.revisionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Normalized provenance must bind the supplied Architecture.",
        path: ["normalizedSolution", "provenance"],
      });
    }
    if (
      provenance.solutionRevisionId !== revision.solutionRevisionId ||
      provenance.architectureContentHash !==
        revision.architecture.contentHash ||
      provenance.architectureDocumentHash !==
        revision.architecture.documentHash ||
      provenance.architectureVisualHash !== revision.architecture.visualHash ||
      provenance.workloadContentHash !== revision.workload.contentHash
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Normalized provenance must bind the immutable Solution Revision.",
        path: ["normalizedSolution", "provenance"],
      });
    }
    if (
      provenance.catalog.id !== revision.versions.catalog.id ||
      provenance.catalog.version !== revision.versions.catalog.version ||
      provenance.catalog.digest !== revision.versions.catalog.digest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Normalized provenance must use the Solution Revision catalog pin.",
        path: ["normalizedSolution", "provenance", "catalog"],
      });
    }
    const generatorBinding = revision.versions.applicationGenerator;
    if (
      generatorBinding.state !== "pinned" ||
      generatorBinding.tool.id !== value.generator.id ||
      generatorBinding.tool.version !== value.generator.version ||
      generatorBinding.tool.digest !== value.generator.digest
    ) {
      context.addIssue({
        code: "custom",
        message: "Solution Revision must pin the exact application generator.",
        path: ["solutionRevision", "versions", "applicationGenerator"],
      });
    }
    const existingFileBytes = value.existingFiles.reduce(
      (sum, file) => sum + file.sizeBytes,
      0,
    );
    if (existingFileBytes > APPLICATION_GENERATION_V1_LIMITS.artifactBytes) {
      context.addIssue({
        code: "custom",
        message:
          "Existing application inventory exceeds its aggregate byte bound.",
        path: ["existingFiles"],
      });
    }
    addUniqueStringIssues(
      value.existingFiles.map((file) => file.path),
      context,
      ["existingFiles"],
      "Existing application paths",
    );
  });

export const applicationGenerationSourceReferenceV1Schema = z
  .object({
    contractId: boundedIdentifierSchema.optional(),
    document: z.enum([
      "architecture",
      "workload",
      "solution-revision",
      "normalized-solution",
      "repository",
    ]),
    edgeId: boundedIdentifierSchema.optional(),
    nodeId: boundedIdentifierSchema.optional(),
    operationId: boundedIdentifierSchema.optional(),
    path: z.string().min(1).max(512).optional(),
    workloadId: boundedIdentifierSchema.optional(),
  })
  .strict();

export const applicationGenerationDiagnosticV1Schema = z
  .object({
    code: diagnosticCodeSchema,
    message: boundedShortTextSchema,
    related: z
      .array(applicationGenerationSourceReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.sourceReferences),
    severity: z.enum(["error", "warning", "info"]),
    source: applicationGenerationSourceReferenceV1Schema,
  })
  .strict();

export const applicationSourceFileProvenanceV1Schema = z
  .object({
    contractIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    edgeIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedConnections),
    environmentBindingIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    extensionPointIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    generator: applicationGeneratorPinV1Schema,
    operationIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    pattern: applicationPatternPinV1Schema,
    resourceTargetKeys: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedResources),
    runtime: applicationRuntimePinV1Schema,
    solutionRevisionId: boundedIdentifierSchema,
    template: applicationTemplatePinV1Schema,
    workloadIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedWorkloads),
  })
  .strict()
  .superRefine((value, context) => {
    for (const field of [
      "contractIds",
      "edgeIds",
      "environmentBindingIds",
      "extensionPointIds",
      "operationIds",
      "resourceTargetKeys",
      "workloadIds",
    ] as const) {
      addCanonicalStringArrayIssues(
        value[field],
        context,
        [field],
        `Source provenance ${field}`,
      );
    }
  });
const sourceFileCommonV1Shape = {
  checksum: sha256DigestSchema,
  mediaType: mediaTypeSchema,
  path: applicationRepositoryPathV1Schema,
  provenance: applicationSourceFileProvenanceV1Schema,
  semanticChecksum: sha256DigestSchema,
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(APPLICATION_GENERATION_V1_LIMITS.artifactBytes),
  sourceReferences: z
    .array(applicationGenerationSourceReferenceV1Schema)
    .max(APPLICATION_GENERATION_V1_LIMITS.sourceReferences),
} as const;

function addSourceContentMetadataIssues(
  value: {
    readonly checksum: string;
    readonly content: string;
    readonly mediaType: string;
    readonly semanticChecksum: string;
    readonly sizeBytes: number;
  },
  context: z.RefinementCtx,
) {
  const contentBytes = encodeUtf8(value.content);
  const contentChecksum = sha256Bytes(contentBytes);
  if (value.checksum !== contentChecksum) {
    context.addIssue({
      code: "custom",
      message: "Source checksum must hash the exact emitted UTF-8 content.",
      path: ["checksum"],
    });
  }
  if (value.sizeBytes !== contentBytes.byteLength) {
    context.addIssue({
      code: "custom",
      message: "Source size must equal the exact emitted UTF-8 byte length.",
      path: ["sizeBytes"],
    });
  }

  let semanticChecksum = contentChecksum;
  if (value.mediaType === "application/json") {
    try {
      semanticChecksum = digestCanonicalValue(
        JSON.parse(value.content) as unknown,
      );
    } catch {
      // The generator's documented fallback for non-JSON bytes is the exact
      // content checksum; validity remains the generated source's concern.
    }
  }
  if (value.semanticChecksum !== semanticChecksum) {
    context.addIssue({
      code: "custom",
      message:
        value.mediaType === "application/json"
          ? "JSON semantic checksum must hash canonical JSON."
          : "Text semantic checksum must equal the exact content checksum.",
      path: ["semanticChecksum"],
    });
  }
}

export const applicationSourceCreateFileV1Schema = z
  .object({
    ...sourceFileCommonV1Shape,
    content: z.string().max(APPLICATION_GENERATION_V1_LIMITS.artifactBytes),
    disposition: z.literal("create"),
    ownership: z.enum(["generated", "user-owned"]),
  })
  .strict()
  .superRefine(addSourceContentMetadataIssues);

export const applicationSourceReplaceFileV1Schema = z
  .object({
    ...sourceFileCommonV1Shape,
    baselineChecksum: sha256DigestSchema,
    content: z.string().max(APPLICATION_GENERATION_V1_LIMITS.artifactBytes),
    disposition: z.literal("replace"),
    ownership: z.literal("generated"),
    previousChecksum: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addSourceContentMetadataIssues(value, context);
    if (value.previousChecksum !== value.baselineChecksum) {
      context.addIssue({
        code: "custom",
        message: "Generated replacement requires an exact unchanged baseline.",
        path: ["baselineChecksum"],
      });
    }
  });

export const applicationSourceUnchangedFileV1Schema = z
  .object({
    ...sourceFileCommonV1Shape,
    disposition: z.literal("unchanged"),
    ownership: z.literal("generated"),
  })
  .strict();

export const applicationSourcePreservedFileV1Schema = z
  .object({
    ...sourceFileCommonV1Shape,
    disposition: z.literal("preserve"),
    ownership: z.enum(["ai-authored", "user-owned", "approved-extension"]),
  })
  .strict();

export const applicationSourceFileV1Schema = z.discriminatedUnion(
  "disposition",
  [
    applicationSourceCreateFileV1Schema,
    applicationSourceReplaceFileV1Schema,
    applicationSourceUnchangedFileV1Schema,
    applicationSourcePreservedFileV1Schema,
  ],
);

export const applicationFileDiffV1Schema = z
  .object({
    afterChecksum: sha256DigestSchema.optional(),
    beforeChecksum: sha256DigestSchema.optional(),
    change: z.enum(["create", "replace", "unchanged", "preserve", "conflict"]),
    ownership: existingApplicationOwnershipV1Schema,
    path: applicationRepositoryPathV1Schema,
    reason: boundedShortTextSchema,
    sourceReferences: z
      .array(applicationGenerationSourceReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.sourceReferences),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.change === "create") {
      if (
        value.beforeChecksum !== undefined ||
        value.afterChecksum === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "Create diffs require only an after checksum.",
        });
      }
      return;
    }
    if (value.change === "conflict") {
      if (value.beforeChecksum === undefined) {
        context.addIssue({
          code: "custom",
          message: "Conflict diffs require the current checksum.",
          path: ["beforeChecksum"],
        });
      }
      return;
    }
    if (
      value.beforeChecksum === undefined ||
      value.afterChecksum === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Existing-file diffs require before and after checksums.",
      });
    }
    if (
      (value.change === "unchanged" || value.change === "preserve") &&
      value.beforeChecksum !== value.afterChecksum
    ) {
      context.addIssue({
        code: "custom",
        message: "Unchanged and preserved files must retain their checksum.",
        path: ["afterChecksum"],
      });
    }
  });

export const applicationSemanticDiffV1Schema = z
  .object({
    afterDigest: sha256DigestSchema.optional(),
    beforeDigest: sha256DigestSchema.optional(),
    kind: z.enum([
      "operation",
      "contract",
      "binding",
      "test",
      "build-contract",
      "ownership",
    ]),
    semanticId: boundedIdentifierSchema,
    sourceReferences: z
      .array(applicationGenerationSourceReferenceV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.sourceReferences),
    summary: boundedShortTextSchema,
  })
  .strict();

export const applicationGenerationDiffV1Schema = z
  .object({
    files: z
      .array(applicationFileDiffV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    semantic: z
      .array(applicationSemanticDiffV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
  })
  .strict()
  .superRefine((value, context) => {
    addUniqueStringIssues(
      value.files.map((file) => file.path),
      context,
      ["files"],
      "File diff paths",
    );
  });

export const applicationWorkloadCoverageV1Schema = z
  .object({
    implementationMode: applicationImplementationModeV1Schema,
    missingRequirements: z.array(generationCoverageRequirementSchema).max(16),
    representedOperationIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    representedTestIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    sourceFilePaths: z
      .array(applicationRepositoryPathV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    state: generationCoverageStateSchema,
    unresolvedBehaviorIds: z
      .array(boundedIdentifierSchema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedRecords),
    workloadId: boundedIdentifierSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "complete-supported-pattern") {
      if (value.implementationMode !== "complete-supported-pattern") {
        context.addIssue({
          code: "custom",
          message:
            "Only complete-supported-pattern mode may claim complete coverage.",
          path: ["state"],
        });
      }
      if (
        value.missingRequirements.length > 0 ||
        value.unresolvedBehaviorIds.length > 0 ||
        value.representedOperationIds.length === 0 ||
        value.representedTestIds.length === 0 ||
        !value.sourceFilePaths.some((path) =>
          path.startsWith("application/src/"),
        ) ||
        !value.sourceFilePaths.some((path) =>
          path.startsWith("application/tests/"),
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Complete coverage requires represented operations, source, tests, and no unresolved requirements.",
        });
      }
    }
  });

export const applicationGenerationCoverageV1Schema = z
  .object({
    contractVersion: z.literal(1),
    missingRequirements: z.array(generationCoverageRequirementSchema).max(16),
    solutionRevisionId: boundedIdentifierSchema,
    state: generationCoverageStateSchema,
    workloads: z
      .array(applicationWorkloadCoverageV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedWorkloads),
  })
  .strict()
  .superRefine((value, context) => {
    addUniqueStringIssues(
      value.workloads.map((workload) => workload.workloadId),
      context,
      ["workloads"],
      "Coverage workload IDs",
    );
    if (
      value.state === "complete-supported-pattern" &&
      (value.missingRequirements.length > 0 ||
        value.workloads.length === 0 ||
        value.workloads.some(
          (workload) => workload.state !== "complete-supported-pattern",
        ))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Solution-level complete coverage requires every workload to be complete.",
        path: ["state"],
      });
    }
  });

export const prompt32AToolchainPinV1Schema = applicationGeneratorPinV1Schema
  .extend({
    digestKind: z.literal("canonical-coordinate"),
    role: z.enum([
      "runtime",
      "package-manager",
      "compiler",
      "test-runner",
      "packager",
    ]),
  })
  .strict();

export const prompt32ADependencyPinV1Schema = z
  .object({
    digest: sha256DigestSchema,
    digestKind: z.literal("canonical-coordinate"),
    kind: z.enum(["runtime", "development"]),
    name: z
      .string()
      .regex(
        /^(?:@[a-z0-9][a-z0-9._-]{0,127}\/[a-z0-9][a-z0-9._-]{0,127}|[a-z0-9][a-z0-9._-]{0,127})$/,
        "Must be an exact portable package name.",
      ),
    version: semanticVersionSchema,
  })
  .strict();

export const prompt32ABuildArtifactContractV1Schema = z
  .object({
    contractVersion: z.literal(1),
    compiledEntrypoint: applicationRepositoryPathV1Schema,
    dependencies: z.array(prompt32ADependencyPinV1Schema).max(256),
    entrypoint: applicationRepositoryPathV1Schema,
    executionPolicy: z
      .object({
        credentials: z.literal("deny"),
        filesystem: z.literal("isolated"),
        network: z.literal("deny"),
        packageScripts: z.literal("deny"),
        reproducible: z.literal(true),
      })
      .strict(),
    expectedArtifact: z
      .object({
        artifactId: boundedIdentifierSchema,
        archiveEntrypoint: z.literal("index.js"),
        digestAlgorithm: z.literal("sha256"),
        handler: z.literal("index.handler"),
        kind: z.literal("aws-lambda-zip"),
        mediaType: z.literal("application/zip"),
        path: applicationArtifactPathV1Schema,
      })
      .strict(),
    implementationMode: applicationImplementationModeV1Schema,
    lockfilePath: applicationRepositoryPathV1Schema,
    packageManifestPath: applicationRepositoryPathV1Schema,
    requiredChecks: z
      .array(
        z.enum([
          "compile",
          "unit-tests",
          "contract-tests",
          "security",
          "reproducibility",
        ]),
      )
      .min(1)
      .max(5),
    runtime: applicationRuntimePinV1Schema,
    sourceInputs: z
      .array(
        z
          .object({
            checksum: sha256DigestSchema,
            path: applicationRepositoryPathV1Schema,
          })
          .strict(),
      )
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    sourceManifestPath: applicationManifestPathV1Schema,
    toolchain: z.array(prompt32AToolchainPinV1Schema).min(1).max(16),
    workloadId: boundedIdentifierSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addUniqueStringIssues(
      value.sourceInputs.map((input) => input.path),
      context,
      ["sourceInputs"],
      "Prompt 32A source input paths",
    );
    addUniqueStringIssues(
      value.dependencies.map((dependency) => dependency.name),
      context,
      ["dependencies"],
      "Prompt 32A dependency names",
    );
    addUniqueStringIssues(
      value.toolchain.map((tool) => tool.role),
      context,
      ["toolchain"],
      "Prompt 32A toolchain roles",
    );
  });

export const prompt32ABuildArtifactEnvelopeV1Schema = z
  .object({
    contract: prompt32ABuildArtifactContractV1Schema,
    contractDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.contractDigest !== digestCanonicalValue(value.contract)) {
      context.addIssue({
        code: "custom",
        message:
          "Build contract digest must hash the exact canonical contract.",
        path: ["contractDigest"],
      });
    }
  });

export const applicationSourceManifestFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    mediaType: mediaTypeSchema,
    ownership: existingApplicationOwnershipV1Schema,
    path: applicationRepositoryPathV1Schema.refine(
      (path) => path !== "application/manifest.json",
      "The inner source manifest must exclude its own file.",
    ),
    semanticChecksum: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(APPLICATION_GENERATION_V1_LIMITS.artifactBytes),
  })
  .strict();

export const applicationSourceManifestV1Schema = z
  .object({
    architectureRevisionId: boundedIdentifierSchema,
    buildContracts: z
      .array(
        z
          .object({
            contractDigest: sha256DigestSchema,
            workloadId: boundedIdentifierSchema,
          })
          .strict(),
      )
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedWorkloads),
    contractVersion: z.literal(1),
    catalog: applicationGeneratorPinV1Schema,
    coverageDigest: sha256DigestSchema,
    files: z
      .array(applicationSourceManifestFileV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    generator: applicationGeneratorPinV1Schema,
    kind: z.literal("cloudmarkup.application-source-manifest"),
    inputDigests: z
      .object({
        applicationContracts: sha256DigestSchema,
        architectureDocument: sha256DigestSchema,
        normalizedSolution: sha256DigestSchema,
        solutionRevision: sha256DigestSchema,
        workloadBehavior: sha256DigestSchema,
      })
      .strict(),
    manifestPath: applicationManifestPathV1Schema,
    pattern: applicationPatternPinV1Schema,
    runtime: applicationRuntimePinV1Schema,
    solutionRevisionId: boundedIdentifierSchema,
    template: applicationTemplatePinV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    addUniqueStringIssues(
      value.files.map((file) => file.path),
      context,
      ["files"],
      "Source manifest paths",
    );
    addUniqueStringIssues(
      value.buildContracts.map((entry) => entry.workloadId),
      context,
      ["buildContracts"],
      "Source manifest build workload IDs",
    );
  });

function pinsEqual(
  left: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  },
  right: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  },
): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.digest === right.digest
  );
}

export const applicationSourceArtifactV1Schema = z
  .object({
    buildContracts: z
      .array(prompt32ABuildArtifactEnvelopeV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedWorkloads),
    contractVersion: z.literal(1),
    coverage: applicationGenerationCoverageV1Schema,
    coverageDigest: sha256DigestSchema,
    diagnostics: z
      .array(applicationGenerationDiagnosticV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.diagnostics),
    diff: applicationGenerationDiffV1Schema,
    generator: applicationGeneratorPinV1Schema,
    kind: z.literal("cloudmarkup.application-source-artifact"),
    pattern: applicationPatternPinV1Schema,
    runtime: applicationRuntimePinV1Schema,
    solutionRevisionId: boundedIdentifierSchema,
    sourceFiles: z
      .array(applicationSourceFileV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.files),
    sourceManifest: applicationSourceManifestV1Schema,
    sourceManifestDigest: sha256DigestSchema,
    template: applicationTemplatePinV1Schema,
    workloadContracts: z
      .array(applicationWorkloadContractV1Schema)
      .max(APPLICATION_GENERATION_V1_LIMITS.normalizedWorkloads),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.coverageDigest !== digestCanonicalValue(value.coverage)) {
      context.addIssue({
        code: "custom",
        message: "Coverage digest must hash the exact canonical assessment.",
        path: ["coverageDigest"],
      });
    }
    if (
      value.sourceManifestDigest !== digestCanonicalValue(value.sourceManifest)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Source manifest digest must hash the exact canonical manifest.",
        path: ["sourceManifestDigest"],
      });
    }
    const paths = value.sourceFiles.map((file) => file.path);
    addUniqueStringIssues(
      paths,
      context,
      ["sourceFiles"],
      "Application source paths",
    );
    if (paths.some((path) => path === "application/manifest.json")) {
      context.addIssue({
        code: "custom",
        message:
          "The source manifest is returned separately and must not hash itself as a source file.",
        path: ["sourceFiles"],
      });
    }
    const totalSize = value.sourceFiles.reduce(
      (sum, file) => sum + file.sizeBytes,
      0,
    );
    if (totalSize > APPLICATION_GENERATION_V1_LIMITS.artifactBytes) {
      context.addIssue({
        code: "custom",
        message: "The application source artifact exceeds its byte bound.",
        path: ["sourceFiles"],
      });
    }
    if (
      value.coverage.solutionRevisionId !== value.solutionRevisionId ||
      value.sourceManifest.solutionRevisionId !== value.solutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Coverage and source manifest must bind the artifact revision.",
        path: ["solutionRevisionId"],
      });
    }
    if (value.sourceManifest.coverageDigest !== value.coverageDigest) {
      context.addIssue({
        code: "custom",
        message: "The source manifest must bind the exact coverage assessment.",
        path: ["sourceManifest", "coverageDigest"],
      });
    }
    for (const field of ["generator", "template", "pattern"] as const) {
      if (!pinsEqual(value[field], value.sourceManifest[field])) {
        context.addIssue({
          code: "custom",
          message: `Source manifest ${field} pin must match the artifact.`,
          path: ["sourceManifest", field],
        });
      }
    }
    if (!pinsEqual(value.runtime, value.sourceManifest.runtime)) {
      context.addIssue({
        code: "custom",
        message: "Source manifest runtime pin must match the artifact.",
        path: ["sourceManifest", "runtime"],
      });
    }
    const sourceByPath = new Map(
      value.sourceFiles.map((file) => [file.path, file] as const),
    );
    addUniqueStringIssues(
      value.workloadContracts.map((contract) => contract.workloadId),
      context,
      ["workloadContracts"],
      "Application workload contract IDs",
    );
    for (const [index, contract] of value.workloadContracts.entries()) {
      if (!("sourceFiles" in contract)) {
        continue;
      }
      for (const expected of contract.sourceFiles) {
        const source = sourceByPath.get(expected.path);
        if (source?.ownership !== expected.ownership) {
          context.addIssue({
            code: "custom",
            message:
              "Workload source contracts must bind emitted source paths and ownership.",
            path: ["workloadContracts", index, "sourceFiles"],
          });
        }
      }
    }
    const workloadContractIds = new Set(
      value.workloadContracts.map((contract) => contract.workloadId),
    );
    const coverageWorkloadIds = new Set(
      value.coverage.workloads.map((workload) => workload.workloadId),
    );
    if (
      workloadContractIds.size !== coverageWorkloadIds.size ||
      [...workloadContractIds].some((id) => !coverageWorkloadIds.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Coverage and per-workload result contracts must bind the same workloads.",
        path: ["workloadContracts"],
      });
    }
    if (value.sourceManifest.files.length !== sourceByPath.size) {
      context.addIssue({
        code: "custom",
        message:
          "Source manifest must enumerate every source file exactly once.",
        path: ["sourceManifest", "files"],
      });
    }
    for (const [index, entry] of value.sourceManifest.files.entries()) {
      const source = sourceByPath.get(entry.path);
      if (
        source?.checksum !== entry.checksum ||
        source.semanticChecksum !== entry.semanticChecksum ||
        source.sizeBytes !== entry.sizeBytes ||
        source.mediaType !== entry.mediaType ||
        source.ownership !== entry.ownership
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Source manifest entry must match its exact source file metadata.",
          path: ["sourceManifest", "files", index],
        });
      }
    }
    const buildByWorkload = new Map(
      value.buildContracts.map(
        (entry) => [entry.contract.workloadId, entry] as const,
      ),
    );
    if (value.sourceManifest.buildContracts.length !== buildByWorkload.size) {
      context.addIssue({
        code: "custom",
        message: "Source manifest must enumerate every Prompt 32A contract.",
        path: ["sourceManifest", "buildContracts"],
      });
    }
    for (const [
      index,
      entry,
    ] of value.sourceManifest.buildContracts.entries()) {
      const build = buildByWorkload.get(entry.workloadId);
      if (build?.contractDigest !== entry.contractDigest) {
        context.addIssue({
          code: "custom",
          message:
            "Source manifest build entry must bind the exact build contract.",
          path: ["sourceManifest", "buildContracts", index],
        });
      }
    }
    for (const [index, workload] of value.coverage.workloads.entries()) {
      for (const path of workload.sourceFilePaths) {
        if (!sourceByPath.has(path)) {
          context.addIssue({
            code: "custom",
            message:
              "Coverage may reference only emitted or preserved source files.",
            path: ["coverage", "workloads", index, "sourceFilePaths"],
          });
        }
      }
    }
  });

/**
 * The digest is outside the artifact payload, just as sourceManifestDigest is
 * outside the inner manifest. Neither content-addressed object hashes itself.
 */
export const applicationGenerationResultV1Schema = z
  .object({
    artifact: applicationSourceArtifactV1Schema,
    artifactDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.artifactDigest !== digestCanonicalValue(value.artifact)) {
      context.addIssue({
        code: "custom",
        message: "Artifact digest must hash the exact canonical artifact.",
        path: ["artifactDigest"],
      });
    }
  });

export type NormalizedSolutionV1 = z.output<typeof normalizedSolutionV1Schema>;
export type ApplicationImplementationModeV1 = z.output<
  typeof applicationImplementationModeV1Schema
>;
export type ApplicationWorkloadContractV1 = z.output<
  typeof applicationWorkloadContractV1Schema
>;
export type ApplicationGeneratorPinV1 = z.output<
  typeof applicationGeneratorPinV1Schema
>;
export type ApplicationRuntimePinV1 = z.output<
  typeof applicationRuntimePinV1Schema
>;
export type ExistingApplicationFileV1 = z.output<
  typeof existingApplicationFileV1Schema
>;
export type ApplicationGenerationRequestV1 = z.output<
  typeof applicationGenerationRequestV1Schema
>;
export type ApplicationGenerationSourceReferenceV1 = z.output<
  typeof applicationGenerationSourceReferenceV1Schema
>;
export type ApplicationGenerationDiagnosticV1 = z.output<
  typeof applicationGenerationDiagnosticV1Schema
>;
export type ApplicationSourceFileV1 = z.output<
  typeof applicationSourceFileV1Schema
>;
export type ApplicationGenerationDiffV1 = z.output<
  typeof applicationGenerationDiffV1Schema
>;
export type ApplicationGenerationCoverageV1 = z.output<
  typeof applicationGenerationCoverageV1Schema
>;
export type Prompt32ABuildArtifactContractV1 = z.output<
  typeof prompt32ABuildArtifactContractV1Schema
>;
export type Prompt32ABuildArtifactEnvelopeV1 = z.output<
  typeof prompt32ABuildArtifactEnvelopeV1Schema
>;
export type ApplicationSourceManifestV1 = z.output<
  typeof applicationSourceManifestV1Schema
>;
export type ApplicationSourceArtifactV1 = z.output<
  typeof applicationSourceArtifactV1Schema
>;
export type ApplicationGenerationResultV1 = z.output<
  typeof applicationGenerationResultV1Schema
>;
