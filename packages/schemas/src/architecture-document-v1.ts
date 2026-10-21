import { z } from "zod";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const namespacedIdentifierPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const deploymentKeyPattern = /^[a-z][a-z0-9_]{0,62}$/;
const configurationKeyPattern = /^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/;
const regionIdentifierPattern = /^[a-z][a-z0-9-]{0,62}$/;
const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;
const utcTimestampPattern =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;

const opaqueIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");

export const documentIdSchema = opaqueIdSchema.brand<"DocumentId">();
export const architectureIdSchema = opaqueIdSchema.brand<"ArchitectureId">();
export const revisionIdSchema = opaqueIdSchema.brand<"RevisionId">();
export const draftIdSchema = opaqueIdSchema.brand<"DraftId">();
export const actorIdSchema = opaqueIdSchema.brand<"ActorId">();
export const nodeIdSchema = opaqueIdSchema.brand<"NodeId">();
export const edgeIdSchema = opaqueIdSchema.brand<"EdgeId">();
export const variableIdSchema = opaqueIdSchema.brand<"VariableId">();
export const outputIdSchema = opaqueIdSchema.brand<"OutputId">();
export const assumptionIdSchema = opaqueIdSchema.brand<"AssumptionId">();
export const requirementIdSchema = opaqueIdSchema.brand<"RequirementId">();
export const operationIdSchema = opaqueIdSchema.brand<"OperationId">();

export const namespacedIdentifierSchema = z
  .string()
  .regex(
    namespacedIdentifierPattern,
    "Must be a lowercase, dot-namespaced identifier.",
  )
  .brand<"NamespacedIdentifier">();
export const providerIdSchema =
  namespacedIdentifierSchema.brand<"ProviderId">();
export const catalogIdSchema = namespacedIdentifierSchema.brand<"CatalogId">();
export const serviceTypeSchema =
  namespacedIdentifierSchema.brand<"ServiceType">();
export const resourceTypeSchema =
  namespacedIdentifierSchema.brand<"ResourceType">();
export const relationshipTypeSchema =
  namespacedIdentifierSchema.brand<"RelationshipType">();
export const portTypeSchema = namespacedIdentifierSchema.brand<"PortType">();
export const configurationSchemaIdSchema =
  namespacedIdentifierSchema.brand<"ConfigurationSchemaId">();
export const generatorIdSchema =
  namespacedIdentifierSchema.brand<"GeneratorId">();

export const semanticVersionSchema = z
  .string()
  .regex(semanticVersionPattern, "Must be a semantic version.")
  .brand<"SemanticVersion">();
export const sha256DigestSchema = z
  .string()
  .regex(sha256DigestPattern, "Must be a lowercase SHA-256 digest.")
  .brand<"Sha256Digest">();
export const utcTimestampSchema = z
  .string()
  .regex(utcTimestampPattern, "Must be an RFC 3339 UTC timestamp.")
  .brand<"UtcTimestamp">();
export const deploymentKeySchema = z
  .string()
  .regex(
    deploymentKeyPattern,
    "Must start with a lowercase letter and contain lowercase letters, digits, or underscores.",
  )
  .brand<"DeploymentKey">();
export const regionIdentifierSchema = z
  .string()
  .regex(
    regionIdentifierPattern,
    "Must be a lowercase provider region identifier.",
  )
  .brand<"RegionIdentifier">();
export const configurationKeySchema = z
  .string()
  .regex(
    configurationKeyPattern,
    "Must be a stable lower-camel-case or namespaced configuration key.",
  )
  .brand<"ConfigurationKey">();

export const elementOriginSchema = z.enum([
  "user",
  "template",
  "ai-accepted",
  "connection-rule",
  "migration",
]);

export const generatorKindSchema = z.enum([
  "template-expansion",
  "connection-rule",
  "migration",
]);

export const generatedResourceProvenanceSchema = z
  .object({
    generatorKind: generatorKindSchema,
    generatorId: generatorIdSchema,
    generatorVersion: semanticVersionSchema,
    operationId: operationIdSchema,
    dependentNodeIds: z.array(nodeIdSchema),
    dependentEdgeIds: z.array(edgeIdSchema),
  })
  .strict();

export const userElementLifecycleSchema = z
  .object({
    ownership: z.literal("user"),
    origin: z.enum(["user", "template", "ai-accepted", "migration"]),
  })
  .strict();

export const generatedElementLifecycleSchema = z
  .object({
    ownership: z.literal("generated"),
    origin: z.enum(["template", "connection-rule", "migration"]),
    provenance: generatedResourceProvenanceSchema,
  })
  .strict();

export const adoptedElementLifecycleSchema = z
  .object({
    ownership: z.literal("adopted"),
    origin: z.enum(["template", "connection-rule", "migration"]),
    provenance: generatedResourceProvenanceSchema,
    adoptedBy: actorIdSchema,
    adoptedAt: utcTimestampSchema,
  })
  .strict();

export const elementLifecycleSchema = z.discriminatedUnion("ownership", [
  userElementLifecycleSchema,
  generatedElementLifecycleSchema,
  adoptedElementLifecycleSchema,
]);

export const configurationValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("string"), value: z.string() }).strict(),
  z.object({ kind: z.literal("number"), value: z.number() }).strict(),
  z.object({ kind: z.literal("integer"), value: z.number().int() }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z
    .object({ kind: z.literal("string-list"), value: z.array(z.string()) })
    .strict(),
  z
    .object({
      kind: z.literal("number-list"),
      value: z.array(z.number()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("node-reference"),
      nodeId: nodeIdSchema,
      attribute: namespacedIdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("variable-reference"),
      variableId: variableIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("secret-reference"),
      reference: opaqueIdSchema.brand<"SecretReference">(),
    })
    .strict(),
]);

export const serviceConfigurationRecordSchema = z
  .object({
    schemaId: configurationSchemaIdSchema,
    schemaVersion: semanticVersionSchema,
    values: z.record(configurationKeySchema, configurationValueSchema),
  })
  .strict();

export const visualPositionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

export const nodeParentV1Schema = z
  .object({
    nodeId: nodeIdSchema,
    relationshipType: relationshipTypeSchema,
  })
  .strict();

export const architectureNodeV1Schema = z
  .object({
    id: nodeIdSchema,
    semantic: z
      .object({
        deploymentKey: deploymentKeySchema,
        serviceType: serviceTypeSchema,
        resourceType: resourceTypeSchema,
        configuration: serviceConfigurationRecordSchema,
        parent: nodeParentV1Schema.optional(),
        lifecycle: elementLifecycleSchema,
      })
      .strict(),
    presentation: z
      .object({
        label: z.string().min(1),
        position: visualPositionSchema,
      })
      .strict(),
  })
  .strict();

export const edgeEndpointV1Schema = z
  .object({
    nodeId: nodeIdSchema,
    port: portTypeSchema,
  })
  .strict();

export const architectureEdgeV1Schema = z
  .object({
    id: edgeIdSchema,
    semantic: z
      .object({
        source: edgeEndpointV1Schema,
        target: edgeEndpointV1Schema,
        relationshipType: relationshipTypeSchema,
        configuration: serviceConfigurationRecordSchema,
        lifecycle: elementLifecycleSchema,
      })
      .strict(),
  })
  .strict();

export const variableValueTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "string-list",
  "number-list",
]);

export const architectureVariableV1Schema = z
  .object({
    id: variableIdSchema,
    key: deploymentKeySchema,
    valueType: variableValueTypeSchema,
    required: z.boolean(),
    description: z.string().min(1).optional(),
    defaultValue: configurationValueSchema.optional(),
  })
  .strict();

export const outputSourceV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("node-attribute"),
      nodeId: nodeIdSchema,
      attribute: namespacedIdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("variable"),
      variableId: variableIdSchema,
    })
    .strict(),
]);

export const architectureOutputV1Schema = z
  .object({
    id: outputIdSchema,
    key: deploymentKeySchema,
    valueType: variableValueTypeSchema,
    description: z.string().min(1).optional(),
    sensitive: z.boolean(),
    source: outputSourceV1Schema,
  })
  .strict();

export const assumptionStatusSchema = z.enum([
  "unverified",
  "accepted",
  "rejected",
]);

export const architectureAssumptionV1Schema = z
  .object({
    id: assumptionIdSchema,
    statement: z.string().min(1),
    status: assumptionStatusSchema,
    origin: elementOriginSchema,
  })
  .strict();

export const requirementCategorySchema = z.enum([
  "functional",
  "availability",
  "security",
  "data",
  "cost",
  "compliance",
  "operational",
  "other",
]);

export const unresolvedRequirementV1Schema = z
  .object({
    id: requirementIdSchema,
    statement: z.string().min(1),
    category: requirementCategorySchema,
    blocking: z.boolean(),
    origin: elementOriginSchema,
  })
  .strict();

export const architectureDocumentV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.architecture-document"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    architectureId: architectureIdSchema,
    revision: z
      .object({
        revisionId: revisionIdSchema,
        revisionNumber: z.number().int().positive(),
        createdAt: utcTimestampSchema,
        createdBy: actorIdSchema,
        sourceDraftId: draftIdSchema.optional(),
        previousRevisionId: revisionIdSchema.optional(),
      })
      .strict(),
    provider: z
      .object({
        id: providerIdSchema,
        region: regionIdentifierSchema,
      })
      .strict(),
    catalog: z
      .object({
        id: catalogIdSchema,
        version: semanticVersionSchema,
        digest: sha256DigestSchema,
      })
      .strict(),
    compilerCompatibility: z
      .object({
        inputContractVersion: z.literal(1),
        minimumCompilerVersion: semanticVersionSchema,
        maximumCompilerVersionExclusive: semanticVersionSchema.optional(),
      })
      .strict(),
    metadata: z
      .object({
        source: z.enum(["user", "template", "ai-accepted", "migration"]),
        serialization: z
          .object({
            mediaType: z.literal("application/json"),
            encoding: z.literal("utf-8"),
            canonicalization: z.literal("cloudmarkup.canonical-json.v1"),
          })
          .strict(),
      })
      .strict(),
    nodes: z.array(architectureNodeV1Schema),
    edges: z.array(architectureEdgeV1Schema),
    variables: z.array(architectureVariableV1Schema),
    outputs: z.array(architectureOutputV1Schema),
    assumptions: z.array(architectureAssumptionV1Schema),
    unresolvedRequirements: z.array(unresolvedRequirementV1Schema),
  })
  .strict();

export type ArchitectureDocumentV1 = z.output<
  typeof architectureDocumentV1Schema
>;
export type ArchitectureNodeV1 = z.output<typeof architectureNodeV1Schema>;
export type ArchitectureEdgeV1 = z.output<typeof architectureEdgeV1Schema>;
export type ServiceConfigurationRecord = z.output<
  typeof serviceConfigurationRecordSchema
>;
export type ConfigurationValue = z.output<typeof configurationValueSchema>;
export type ElementLifecycle = z.output<typeof elementLifecycleSchema>;
export type GeneratedElementLifecycle = z.output<
  typeof generatedElementLifecycleSchema
>;
export type NodeParentV1 = z.output<typeof nodeParentV1Schema>;
export type NodeId = z.output<typeof nodeIdSchema>;
export type EdgeId = z.output<typeof edgeIdSchema>;
export type VariableId = z.output<typeof variableIdSchema>;
export type ProviderId = z.output<typeof providerIdSchema>;
export type CatalogId = z.output<typeof catalogIdSchema>;
export type PortType = z.output<typeof portTypeSchema>;
export type SemanticVersion = z.output<typeof semanticVersionSchema>;
export type Sha256Digest = z.output<typeof sha256DigestSchema>;
export type RegionIdentifier = z.output<typeof regionIdentifierSchema>;

export function generateArchitectureDocumentV1JsonSchema() {
  const generated = z.toJSONSchema(architectureDocumentV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/architecture-document/v1.schema.json",
    title: "Cloud Markup Architecture Document v1",
  };
}
