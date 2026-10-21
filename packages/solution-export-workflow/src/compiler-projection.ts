import {
  applicationImplementationModeV1Schema,
  normalizedGeneratedProvenanceV1Schema,
  normalizedSolutionProvenanceV1Schema,
  normalizedSolutionV1Schema,
  namespacedIdentifierSchema,
  repositoryRelativePathSchema,
  semanticVersionSchema,
  serializeCanonicalJson,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  canonicalSemanticDigest,
  encodeUtf8,
  sha256Digest,
  solutionExportInfrastructureArtifactV1Schema,
  type SolutionExportArtifactReferenceV1,
  solutionExportTerraformApplicationPackagePathV1Schema,
  type SolutionExportInfrastructureArtifactV1,
  type SolutionExportProvenanceV1,
} from "@cloudmarkup/solution-export";
import { z } from "zod";

const stableIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "Must be a stable ID.");
const boundedIdentifierSchema = z.string().trim().min(1).max(512);
const safeMessageSchema = z.string().trim().min(1).max(512);

type UnknownRecord = Record<string, unknown>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGoNullableDependentNodeIds(value: unknown): unknown {
  if (!isUnknownRecord(value) || value["dependentNodeIds"] !== null)
    return value;
  return { ...value, dependentNodeIds: [] };
}

function normalizeGoResourceWire(value: unknown): unknown {
  if (!isUnknownRecord(value)) return value;
  let normalized =
    value["workloadIds"] === null ? { ...value, workloadIds: [] } : value;
  const lifecycle = value["lifecycle"];
  if (!isUnknownRecord(lifecycle)) return normalized;
  const provenance = lifecycle["provenance"];
  const normalizedProvenance = normalizeGoNullableDependentNodeIds(provenance);
  if (normalizedProvenance === provenance) return normalized;
  normalized = {
    ...normalized,
    lifecycle: { ...lifecycle, provenance: normalizedProvenance },
  };
  return normalized;
}

function normalizeGoPolicyAttachmentWire(value: unknown): unknown {
  if (!isUnknownRecord(value)) return value;
  const provenance = value["provenance"];
  const normalizedProvenance = normalizeGoNullableDependentNodeIds(provenance);
  return normalizedProvenance === provenance
    ? value
    : { ...value, provenance: normalizedProvenance };
}

function normalizeGoSolutionWire(value: unknown): unknown {
  if (!isUnknownRecord(value)) return value;
  return {
    ...value,
    ...(Array.isArray(value["resources"])
      ? { resources: value["resources"].map(normalizeGoResourceWire) }
      : {}),
    ...(Array.isArray(value["policyAttachments"])
      ? {
          policyAttachments: value["policyAttachments"].map(
            normalizeGoPolicyAttachmentWire,
          ),
        }
      : {}),
  };
}

const goNormalizedSolutionV1Schema = z.preprocess(
  normalizeGoSolutionWire,
  normalizedSolutionV1Schema,
);

const goGeneratedProvenanceV1Schema = normalizedGeneratedProvenanceV1Schema
  .extend({
    dependentNodeIds:
      normalizedGeneratedProvenanceV1Schema.shape.dependentNodeIds.nullable(),
  })
  .strict();

const goToolReferenceV1Schema = z
  .object({
    digest: sha256DigestSchema.optional(),
    id: boundedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

const goDiagnosticSourceV1Schema = z
  .object({
    document: z.enum(["architecture", "workload", "solution-revision"]),
    edgeId: boundedIdentifierSchema.optional(),
    nodeId: boundedIdentifierSchema.optional(),
    operationId: boundedIdentifierSchema.optional(),
    path: z.string().min(1).max(4_096).optional(),
    workloadId: boundedIdentifierSchema.optional(),
  })
  .strict();

const goDiagnosticV1Schema = z
  .object({
    code: stableIdSchema,
    message: safeMessageSchema,
    related: z.array(goDiagnosticSourceV1Schema).max(256).optional(),
    severity: z.enum(["error", "warning", "info"]),
    source: goDiagnosticSourceV1Schema,
  })
  .strict();

const goTargetFileV1Schema = z
  .object({
    content: z.string().max(32 * 1024 * 1024),
    digest: sha256DigestSchema,
    mediaType: z.enum([
      "application/json",
      "application/vnd.amazon.cloudformation.template+json",
      "application/vnd.hashicorp.terraform",
      "text/markdown",
      "text/plain",
    ]),
    ownership: z.literal("generated"),
    path: repositoryRelativePathSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.digest !== sha256Digest(value.content)) {
      context.addIssue({
        code: "custom",
        message: "Compiler file digest must hash the exact UTF-8 content.",
        path: ["digest"],
      });
    }
  });

const goArtifactInputVariableV1Schema = z
  .object({
    description: z.string().max(4_096),
    name: boundedIdentifierSchema,
    required: z.boolean(),
    sensitive: z.boolean(),
    validation: z.string().max(4_096),
    valueType: boundedIdentifierSchema,
  })
  .strict();

const goArtifactReferenceV1Schema = z
  .object({
    artifactId: boundedIdentifierSchema,
    digest: sha256DigestSchema,
    kind: boundedIdentifierSchema,
    mediaType: z.string().trim().min(1).max(256).optional(),
    ownership: boundedIdentifierSchema,
    workloadId: boundedIdentifierSchema,
  })
  .strict();

const goApplicationArtifactV1Schema = z
  .object({
    codeRequired: z.boolean(),
    contractVersion: z.literal(1),
    delivery: boundedIdentifierSchema,
    generationCoverage: boundedIdentifierSchema,
    implementationMode: applicationImplementationModeV1Schema,
    inputs: z.array(goArtifactReferenceV1Schema).max(64).nullable(),
    relativePackagePath:
      solutionExportTerraformApplicationPackagePathV1Schema.optional(),
    variables: z.array(goArtifactInputVariableV1Schema).max(256).nullable(),
    workloadId: boundedIdentifierSchema,
  })
  .strict();
const goTargetNeutralApplicationArtifactV2Schema = z
  .object({
    archiveEntrypoint: repositoryRelativePathSchema,
    artifactId: boundedIdentifierSchema,
    digestAlgorithm: z.literal("sha256"),
    handler: z.string().trim().min(1).max(256),
    kind: z.literal("aws-lambda-zip"),
    mediaType: z.literal("application/zip"),
    path: repositoryRelativePathSchema,
    runtime: z
      .object({
        digest: sha256DigestSchema,
        handler: z.string().trim().min(1).max(256),
        id: boundedIdentifierSchema,
        languageFamily: boundedIdentifierSchema,
        moduleFormat: z.literal("esm"),
        runtime: z.literal("nodejs24.x"),
        runtimeFamily: boundedIdentifierSchema,
        version: semanticVersionSchema,
      })
      .strict(),
  })
  .strict();

const goApplicationArtifactV2Schema = goApplicationArtifactV1Schema
  .extend({
    artifactReadiness: boundedIdentifierSchema,
    contractVersion: z.literal(2),
    expectedArtifact: goTargetNeutralApplicationArtifactV2Schema,
  })
  .strict();

function portableArtifactSegment(value: string): string {
  if (/^[a-z][a-z0-9_]{0,62}$/u.test(value)) return value;
  const readable = value.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 48);
  return `${readable.length === 0 ? "id" : readable}-${sha256Digest(value).slice("sha256:".length)}`;
}

function terraformApplicationPackagePath(workloadId: string): string {
  return `../application/artifacts/${portableArtifactSegment(workloadId)}/function.zip`;
}

const goApplicationArtifactSchema = z
  .discriminatedUnion("contractVersion", [
    goApplicationArtifactV1Schema,
    goApplicationArtifactV2Schema,
  ])
  .superRefine((value, context) => {
    const deterministicDelivery =
      value.delivery === "deterministic-relative-package" ||
      value.delivery === "deterministic-package-upload-input";
    if (value.relativePackagePath === undefined) {
      if (deterministicDelivery) {
        context.addIssue({
          code: "custom",
          message:
            "Deterministic application delivery requires its exact infrastructure-relative package path.",
          path: ["relativePackagePath"],
        });
      }
      return;
    }

    if (
      !deterministicDelivery ||
      value.relativePackagePath !==
        terraformApplicationPackagePath(value.workloadId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The infrastructure-relative package path must be canonical for its workload.",
        path: ["relativePackagePath"],
      });
    }
    if (
      value.contractVersion === 2 &&
      value.relativePackagePath !== `../${value.expectedArtifact.path}`
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The infrastructure-relative package path must bind the target-neutral application artifact.",
        path: ["relativePackagePath"],
      });
    }
  });

const goPolicyArtifactV1Schema = z
  .object({
    ownerNodeId: boundedIdentifierSchema,
    ownership: boundedIdentifierSchema,
    policyDocumentId: boundedIdentifierSchema,
    policyKind: boundedIdentifierSchema,
    provenance: goGeneratedProvenanceV1Schema.optional(),
    renderedAs: boundedIdentifierSchema,
  })
  .strict();

const goTerraformMetadataV1Schema = z
  .object({
    formatVersion: semanticVersionSchema,
    providers: z
      .array(
        z
          .object({
            source: z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/),
            version: z.string().trim().min(1).max(256),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    requiredTerraformVersion: z.string().trim().min(1).max(256),
  })
  .strict();

const goCloudFormationMetadataV1Schema = z
  .object({
    formatVersion: semanticVersionSchema,
    localValidation: boundedIdentifierSchema,
    templateFormat: z.literal("json"),
    templateSpecificationVersion: z.literal("2010-09-09"),
  })
  .strict();

const goTargetArtifactCommonShape = z
  .object({
    applicationArtifacts: z
      .array(goApplicationArtifactSchema)
      .max(1_000)
      .nullable(),
    contractVersion: z.literal(1),
    digest: sha256DigestSchema,
    files: z.array(goTargetFileV1Schema).max(256).nullable(),
    formatVersion: semanticVersionSchema,
    policyArtifacts: z.array(goPolicyArtifactV1Schema).max(10_000).nullable(),
    provenance: normalizedSolutionProvenanceV1Schema,
  })
  .strict();

const goTargetArtifactShape = z.discriminatedUnion("target", [
  goTargetArtifactCommonShape
    .extend({
      metadata: goTerraformMetadataV1Schema,
      target: z.literal("terraform"),
    })
    .strict(),
  goTargetArtifactCommonShape
    .extend({
      metadata: goCloudFormationMetadataV1Schema,
      target: z.literal("cloudformation"),
    })
    .strict(),
]);

export type GoTargetArtifactV1 = z.output<typeof goTargetArtifactShape>;

function goJsonStringify(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded.replace(/[<>&\u2028\u2029]/gu, (character) => {
    switch (character) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      default:
        return "\\u2029";
    }
  });
}

function orderedProvenance(
  value: GoTargetArtifactV1["provenance"],
): Record<string, unknown> {
  return {
    architectureDocumentId: value.architectureDocumentId,
    architectureId: value.architectureId,
    architectureRevisionId: value.architectureRevisionId,
    architectureContentHash: value.architectureContentHash,
    architectureDocumentHash: value.architectureDocumentHash,
    architectureVisualHash: value.architectureVisualHash,
    workloadContentHash: value.workloadContentHash,
    ...(value.solutionRevisionId === undefined
      ? {}
      : { solutionRevisionId: value.solutionRevisionId }),
    providerId: value.providerId,
    region: value.region,
    catalog: {
      id: value.catalog.id,
      version: value.catalog.version,
      digest: value.catalog.digest,
    },
  };
}

function orderedGeneratedProvenance(
  value: z.output<typeof goGeneratedProvenanceV1Schema>,
): Record<string, unknown> {
  return {
    generatorKind: value.generatorKind,
    generatorId: value.generatorId,
    generatorVersion: value.generatorVersion,
    operationId: value.operationId,
    dependentNodeIds: value.dependentNodeIds,
    dependentEdgeIds: value.dependentEdgeIds,
  };
}

function targetArtifactDigestProjection(
  artifact: GoTargetArtifactV1,
): Record<string, unknown> {
  return {
    contractVersion: artifact.contractVersion,
    target: artifact.target,
    formatVersion: artifact.formatVersion,
    provenance: orderedProvenance(artifact.provenance),
    metadata:
      artifact.target === "terraform"
        ? {
            formatVersion: artifact.metadata.formatVersion,
            requiredTerraformVersion:
              artifact.metadata.requiredTerraformVersion,
            providers: artifact.metadata.providers.map((provider) => ({
              source: provider.source,
              version: provider.version,
            })),
          }
        : {
            formatVersion: artifact.metadata.formatVersion,
            templateSpecificationVersion:
              artifact.metadata.templateSpecificationVersion,
            templateFormat: artifact.metadata.templateFormat,
            localValidation: artifact.metadata.localValidation,
          },
    files:
      artifact.files?.map((file) => ({
        path: file.path,
        mediaType: file.mediaType,
        ownership: file.ownership,
        content: file.content,
        digest: file.digest,
      })) ?? null,
    applicationArtifacts:
      artifact.applicationArtifacts?.map((application) => ({
        contractVersion: application.contractVersion,
        workloadId: application.workloadId,
        implementationMode: application.implementationMode,
        delivery: application.delivery,
        ...(application.relativePackagePath === undefined
          ? {}
          : { relativePackagePath: application.relativePackagePath }),
        variables:
          application.variables?.map((variable) => ({
            name: variable.name,
            valueType: variable.valueType,
            sensitive: variable.sensitive,
            required: variable.required,
            description: variable.description,
            validation: variable.validation,
          })) ?? null,
        ...(application.contractVersion === 2
          ? {
              expectedArtifact: {
                artifactId: application.expectedArtifact.artifactId,
                kind: application.expectedArtifact.kind,
                mediaType: application.expectedArtifact.mediaType,
                path: application.expectedArtifact.path,
                archiveEntrypoint:
                  application.expectedArtifact.archiveEntrypoint,
                handler: application.expectedArtifact.handler,
                digestAlgorithm: application.expectedArtifact.digestAlgorithm,
                runtime: {
                  id: application.expectedArtifact.runtime.id,
                  version: application.expectedArtifact.runtime.version,
                  digest: application.expectedArtifact.runtime.digest,
                  runtimeFamily:
                    application.expectedArtifact.runtime.runtimeFamily,
                  languageFamily:
                    application.expectedArtifact.runtime.languageFamily,
                  runtime: application.expectedArtifact.runtime.runtime,
                  handler: application.expectedArtifact.runtime.handler,
                  moduleFormat:
                    application.expectedArtifact.runtime.moduleFormat,
                },
              },
              artifactReadiness: application.artifactReadiness,
            }
          : {}),
        inputs:
          application.inputs?.map((input) => ({
            artifactId: input.artifactId,
            digest: input.digest,
            kind: input.kind,
            ownership: input.ownership,
            workloadId: input.workloadId,
            ...(input.mediaType === undefined
              ? {}
              : { mediaType: input.mediaType }),
          })) ?? null,
        generationCoverage: application.generationCoverage,
        codeRequired: application.codeRequired,
      })) ?? null,
    policyArtifacts:
      artifact.policyArtifacts?.map((policy) => ({
        policyDocumentId: policy.policyDocumentId,
        ownerNodeId: policy.ownerNodeId,
        policyKind: policy.policyKind,
        ownership: policy.ownership,
        renderedAs: policy.renderedAs,
        ...(policy.provenance === undefined
          ? {}
          : { provenance: orderedGeneratedProvenance(policy.provenance) }),
      })) ?? null,
    digest: "",
  };
}

export function goTargetArtifactDigest(
  artifact: GoTargetArtifactV1,
): Sha256Digest {
  return sha256Digest(
    goJsonStringify(targetArtifactDigestProjection(artifact)),
  );
}

export const goTargetArtifactV1Schema = goTargetArtifactShape.superRefine(
  (value, context) => {
    if (value.digest !== goTargetArtifactDigest(value)) {
      context.addIssue({
        code: "custom",
        message:
          "Compiler artifact digest must hash the exact Go wire projection with an empty digest field.",
        path: ["digest"],
      });
    }
  },
);

export const goCompilationResultV1Schema = z
  .object({
    artifact: goTargetArtifactV1Schema.optional(),
    compiler: goToolReferenceV1Schema,
    contractVersion: z.literal(1),
    diagnostics: z.array(goDiagnosticV1Schema).max(256).nullable(),
    model: goNormalizedSolutionV1Schema.optional(),
  })
  .strict();

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sourceReferences(
  solutionRevisionId: string,
  values: readonly {
    readonly id: string;
    readonly kind: "edge" | "policy" | "resource";
  }[],
): SolutionExportProvenanceV1["sourceReferences"] {
  const byKey = new Map<string, (typeof values)[number]>();
  for (const value of values) {
    byKey.set(`${value.kind}\u0000${value.id}`, value);
  }
  if (byKey.size === 0) {
    return [{ id: solutionRevisionId, kind: "solution-revision" }];
  }
  return [...byKey.values()].sort((left, right) =>
    compareUtf16(
      `${left.kind}\u0000${left.id}`,
      `${right.kind}\u0000${right.id}`,
    ),
  );
}

function exactCompilerPin(
  result: z.output<typeof goCompilationResultV1Schema>,
): SolutionExportProvenanceV1["producer"] {
  if (result.compiler.digest === undefined) {
    throw new GoCompilationProjectionError("compiler-pin-missing");
  }
  return {
    digest: result.compiler.digest,
    id: namespacedIdentifierSchema.parse(result.compiler.id),
    version: result.compiler.version,
  };
}

function mapReferenceOwnership(
  ownership: string,
): SolutionExportArtifactReferenceV1["ownership"] {
  switch (ownership) {
    case "external":
    case "user":
    case "user-provided":
      return "user-provided";
    case "generated":
    case "cloudmarkup":
      return "generated-build-artifact";
    default:
      throw new GoCompilationProjectionError("artifact-ownership-unsupported");
  }
}

type InfrastructureDigestInput<T> = T extends unknown
  ? Omit<T, "artifactDigest">
  : never;

function computeInfrastructureDigest(
  value: InfrastructureDigestInput<SolutionExportInfrastructureArtifactV1>,
): Sha256Digest {
  const projection = {
    ...value,
    applicationArtifacts: [...value.applicationArtifacts].sort((left, right) =>
      compareUtf16(serializeCanonicalJson(left), serializeCanonicalJson(right)),
    ),
    diagnostics: [...value.diagnostics].sort((left, right) =>
      compareUtf16(serializeCanonicalJson(left), serializeCanonicalJson(right)),
    ),
    files: [...value.files].sort((left, right) =>
      compareUtf16(left.path, right.path),
    ),
    policyArtifacts: [...value.policyArtifacts].sort((left, right) =>
      compareUtf16(left.policyDocumentId, right.policyDocumentId),
    ),
    ...(value.target === "terraform"
      ? {
          providers: [...value.providers].sort((left, right) =>
            compareUtf16(left.source, right.source),
          ),
        }
      : {}),
    resources: [...value.resources].sort((left, right) =>
      compareUtf16(left.resourceId, right.resourceId),
    ),
  };
  return sha256Digest(serializeCanonicalJson(projection));
}

export class GoCompilationProjectionError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super("Compiler output could not be accepted for export.");
    this.name = "GoCompilationProjectionError";
    this.code = code;
  }
}

export function projectGoCompilationResultToSolutionExportInfrastructure(
  input: unknown,
): SolutionExportInfrastructureArtifactV1 {
  const parsed = goCompilationResultV1Schema.safeParse(input);
  if (!parsed.success) {
    throw new GoCompilationProjectionError("compiler-result-invalid");
  }
  const result = parsed.data;
  if (
    result.artifact === undefined ||
    result.model === undefined ||
    result.diagnostics?.some(
      (diagnostic) => diagnostic.severity === "error",
    ) === true
  ) {
    throw new GoCompilationProjectionError("compiler-result-unsuccessful");
  }
  if (
    result.model.provenance.solutionRevisionId === undefined ||
    serializeCanonicalJson(result.model.provenance) !==
      serializeCanonicalJson(result.artifact.provenance) ||
    result.model.target.target !== result.artifact.target ||
    !result.model.target.renderingAvailable
  ) {
    throw new GoCompilationProjectionError("compiler-result-binding-invalid");
  }

  const producer = exactCompilerPin(result);
  const revisionId = result.model.provenance.solutionRevisionId;
  const provenanceFor = (
    values: readonly {
      readonly id: string;
      readonly kind: "edge" | "policy" | "resource";
    }[],
  ): SolutionExportProvenanceV1 => ({
    producer,
    solutionRevisionId: revisionId,
    sourceReferences: sourceReferences(revisionId, values),
  });

  const targetProjection =
    result.artifact.target === "terraform"
      ? {
          providers: result.artifact.metadata.providers.map((provider) => ({
            source: provider.source,
            versionConstraint: provider.version,
          })),
          requiredTerraformVersion:
            result.artifact.metadata.requiredTerraformVersion,
          target: "terraform" as const,
        }
      : {
          localValidation: result.artifact.metadata.localValidation,
          target: "cloudformation" as const,
          templateFormat: result.artifact.metadata.templateFormat,
          templateSpecificationVersion:
            result.artifact.metadata.templateSpecificationVersion,
        };
  const rawProjection: InfrastructureDigestInput<SolutionExportInfrastructureArtifactV1> =
    {
      applicationArtifacts: (result.artifact.applicationArtifacts ?? []).map(
        (application) => ({
          ...(application.contractVersion === 2
            ? {
                artifactReadiness: application.artifactReadiness,
                contractVersion: application.contractVersion,
                delivery: application.delivery,
                expectedArtifact: {
                  ...application.expectedArtifact,
                  runtime: {
                    ...application.expectedArtifact.runtime,
                    id: namespacedIdentifierSchema.parse(
                      application.expectedArtifact.runtime.id,
                    ),
                    languageFamily: namespacedIdentifierSchema.parse(
                      application.expectedArtifact.runtime.languageFamily,
                    ),
                    runtimeFamily: namespacedIdentifierSchema.parse(
                      application.expectedArtifact.runtime.runtimeFamily,
                    ),
                  },
                },
                generationCoverage: application.generationCoverage,
                ...(application.relativePackagePath === undefined
                  ? {}
                  : {
                      relativePackagePath: application.relativePackagePath,
                    }),
              }
            : {}),
          implementationMode: application.implementationMode,
          inputs: (application.inputs ?? []).map((reference) => ({
            artifactId: reference.artifactId,
            digest: reference.digest,
            kind: reference.kind,
            ownership: mapReferenceOwnership(reference.ownership),
            state: "immutable-reference",
            workloadId: reference.workloadId,
          })),
          workloadId: application.workloadId,
        }),
      ),
      catalog: {
        ...result.model.provenance.catalog,
        id: namespacedIdentifierSchema.parse(
          result.model.provenance.catalog.id,
        ),
      },
      compiler: producer,
      contractVersion: 1,
      diagnostics: (result.diagnostics ?? []).map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        severity: diagnostic.severity,
      })),
      files: (result.artifact.files ?? []).map((file) => ({
        checksum: file.digest,
        content: file.content,
        mediaType: file.mediaType,
        ownership: "generated",
        path: file.path,
        provenance: provenanceFor([]),
        semanticChecksum: canonicalSemanticDigest(
          file.mediaType,
          encodeUtf8(file.content),
        ),
      })),
      formatVersion: result.artifact.formatVersion,
      kind: "cloudmarkup.export-infrastructure-input",
      policyArtifacts: (result.artifact.policyArtifacts ?? []).map((policy) => {
        if (
          policy.ownership !== "generated" &&
          policy.ownership !== "user-owned"
        ) {
          throw new GoCompilationProjectionError(
            "policy-ownership-unsupported",
          );
        }
        const dependencies = policy.provenance;
        return {
          ownerNodeId: policy.ownerNodeId,
          ownership: policy.ownership,
          policyDocumentId: policy.policyDocumentId,
          policyKind: policy.policyKind,
          provenance: provenanceFor([
            { id: policy.policyDocumentId, kind: "policy" },
            { id: policy.ownerNodeId, kind: "resource" },
            ...(dependencies?.dependentNodeIds ?? []).map((id) => ({
              id,
              kind: "resource" as const,
            })),
            ...(dependencies?.dependentEdgeIds.map((id) => ({
              id,
              kind: "edge" as const,
            })) ?? []),
          ]),
          renderedAs: policy.renderedAs,
        };
      }),
      ...targetProjection,
      resources: result.model.resources.map((resource) => ({
        dependentEdgeIds: resource.lifecycle.provenance?.dependentEdgeIds ?? [],
        dependentNodeIds:
          resource.lifecycle.provenance?.dependentNodeIds.length === 0 ||
          resource.lifecycle.provenance === undefined
            ? [resource.id]
            : resource.lifecycle.provenance.dependentNodeIds,
        resourceId: resource.id,
        targetKey: resource.targetKey,
      })),
      solutionRevisionId: revisionId,
    };

  return solutionExportInfrastructureArtifactV1Schema.parse({
    ...rawProjection,
    artifactDigest: computeInfrastructureDigest(rawProjection),
  });
}

export type GoCompilationResultV1 = z.output<
  typeof goCompilationResultV1Schema
>;
