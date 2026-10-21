import type { ValidationRuleV1 } from "@cloudmarkup/domain";
import {
  catalogIdSchema,
  configurationKeySchema,
  configurationSchemaIdSchema,
  namespacedIdentifierSchema,
  portTypeSchema,
  providerIdSchema,
  regionIdentifierSchema,
  relationshipTypeSchema,
  resourceTypeSchema,
  semanticVersionSchema,
  serviceTypeSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export const PROVIDER_CATALOG_CONTRACT_VERSION = 1 as const;
export const PROVIDER_CATALOG_ARTIFACT_KIND =
  "cloudmarkup.provider-catalog" as const;
export const PROVIDER_CATALOG_CANONICALIZATION =
  "cloudmarkup.provider-catalog.canonical-json.v1" as const;
export const PROVIDER_VALIDATION_RULE_INTERFACE_VERSION = 1 as const;
export const PROVIDER_MAPPING_DECLARATION_VERSION = 1 as const;
export const PROVIDER_CONNECTION_RULE_INTERFACE_VERSION = 1 as const;

const shortTextSchema = z.string().trim().min(1).max(256);
const longTextSchema = z.string().trim().min(1).max(4_096);
const httpsUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => value.startsWith("https://"), {
    message: "External documentation URLs must use HTTPS.",
  });
const cloudMarkupDocumentationPathSchema = z
  .string()
  .regex(
    /^docs\/[A-Za-z0-9_./-]+(?:#[A-Za-z0-9_.-]+)?$/u,
    "CloudMarkup documentation must use a repository docs/ path.",
  )
  .refine(
    (value) =>
      value
        .split("#", 1)[0]
        ?.split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        ) ?? false,
    "CloudMarkup documentation paths cannot contain traversal segments.",
  );
const iconIdSchema = namespacedIdentifierSchema.brand<"ProviderIconId">();
const documentationIdSchema =
  namespacedIdentifierSchema.brand<"ProviderDocumentationId">();
const connectionRuleIdSchema =
  namespacedIdentifierSchema.brand<"ProviderConnectionRuleId">();
const providerValidationRuleIdSchema =
  namespacedIdentifierSchema.brand<"ProviderValidationRuleId">();
const catalogMigrationIdSchema =
  namespacedIdentifierSchema.brand<"ProviderCatalogMigrationId">();
const compilerMappingIdSchema =
  namespacedIdentifierSchema.brand<"ProviderCompilerMappingId">();
const boundaryTypeSchema =
  namespacedIdentifierSchema.brand<"ProviderBoundaryType">();

export const providerDocumentationReferenceV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("official"),
        id: documentationIdSchema,
        title: shortTextSchema,
        publisher: shortTextSchema,
        url: httpsUrlSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("cloudmarkup"),
        id: documentationIdSchema,
        title: shortTextSchema,
        path: cloudMarkupDocumentationPathSchema,
      })
      .strict(),
  ],
);

export const providerEducationalContentV1Schema = z
  .object({
    summary: shortTextSchema,
    guidedExplanation: longTextSchema,
    professionalExplanation: longTextSchema,
    considerations: z.array(shortTextSchema).max(32),
    documentation: z.array(providerDocumentationReferenceV1Schema).max(32),
  })
  .strict();

export const providerMetadataV1Schema = z
  .object({
    id: providerIdSchema,
    displayName: shortTextSchema,
    description: longTextSchema,
    iconNamespace: namespacedIdentifierSchema,
    homepage: httpsUrlSchema,
    documentation: z
      .array(providerDocumentationReferenceV1Schema)
      .min(1)
      .max(32),
  })
  .strict();

export const providerCatalogMetadataV1Schema = z
  .object({
    id: catalogIdSchema,
    version: semanticVersionSchema,
    maturity: z.enum(["proof", "production-oriented", "curated"]),
    description: longTextSchema,
    architectureDocumentSchemaVersions: z
      .array(z.union([z.literal(1), z.literal(2), z.literal(3)]))
      .min(1)
      .max(8),
    runtimeRetrieval: z.literal("forbidden"),
  })
  .strict();

const jsonSchemaStringPropertyV1Schema = z
  .object({
    type: z.literal("string"),
    title: shortTextSchema.optional(),
    description: longTextSchema.optional(),
    default: z.string().optional(),
    enum: z.array(z.string()).min(1).max(128).optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().max(512).optional(),
  })
  .strict();

const jsonSchemaNumberPropertyV1Schema = z
  .object({
    type: z.enum(["number", "integer"]),
    title: shortTextSchema.optional(),
    description: longTextSchema.optional(),
    default: z.number().optional(),
    enum: z.array(z.number()).min(1).max(128).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  })
  .strict();

const jsonSchemaBooleanPropertyV1Schema = z
  .object({
    type: z.literal("boolean"),
    title: shortTextSchema.optional(),
    description: longTextSchema.optional(),
    default: z.boolean().optional(),
    const: z.boolean().optional(),
  })
  .strict();

const jsonSchemaArrayItemV1Schema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("string"),
      enum: z.array(z.string()).min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum(["number", "integer"]),
      enum: z.array(z.number()).min(1).max(128).optional(),
    })
    .strict(),
]);

const jsonSchemaArrayPropertyV1Schema = z
  .object({
    type: z.literal("array"),
    title: shortTextSchema.optional(),
    description: longTextSchema.optional(),
    items: jsonSchemaArrayItemV1Schema,
    default: z
      .array(z.union([z.string(), z.number()]))
      .max(256)
      .optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    uniqueItems: z.boolean().optional(),
  })
  .strict();

export const providerConfigurationPropertyJsonSchemaV1Schema =
  z.discriminatedUnion("type", [
    jsonSchemaStringPropertyV1Schema,
    jsonSchemaNumberPropertyV1Schema,
    jsonSchemaBooleanPropertyV1Schema,
    jsonSchemaArrayPropertyV1Schema,
  ]);

export const providerConfigurationJsonSchemaV1Schema = z
  .object({
    $schema: z.literal("https://json-schema.org/draft/2020-12/schema"),
    $id: z
      .string()
      .regex(
        /^urn:cloudmarkup:configuration:[a-z][a-z0-9.-]*:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u,
        "Configuration schema IDs must use the CloudMarkup configuration URN.",
      ),
    type: z.literal("object"),
    title: shortTextSchema,
    description: longTextSchema.optional(),
    additionalProperties: z.literal(false),
    properties: z.record(
      configurationKeySchema,
      providerConfigurationPropertyJsonSchemaV1Schema,
    ),
    required: z.array(configurationKeySchema).max(256),
  })
  .strict();

export const providerConfigurationUiHintV1Schema = z
  .object({
    property: configurationKeySchema,
    control: z.enum([
      "text",
      "textarea",
      "number",
      "checkbox",
      "select",
      "multi-select",
    ]),
    label: shortTextSchema,
    helpText: longTextSchema.optional(),
    order: z.number().int().nonnegative(),
    advanced: z.boolean(),
    valueSource: z.enum([
      "literal",
      "node-reference",
      "secret-reference",
      "sensitive-variable-reference",
    ]),
    securityImpact: z.enum(["none", "security-sensitive", "secret-reference"]),
    costImpact: z.enum(["none", "cost-sensitive"]),
  })
  .strict();

export const providerServiceConfigurationV1Schema = z
  .object({
    schemaId: configurationSchemaIdSchema,
    schemaVersion: semanticVersionSchema,
    jsonSchema: providerConfigurationJsonSchemaV1Schema,
    uiHints: z.array(providerConfigurationUiHintV1Schema).max(256),
  })
  .strict();

export const providerResourceNodeKindV1Schema = z
  .object({
    kind: z.literal("resource"),
    resourceType: resourceTypeSchema,
    deployable: z.boolean(),
  })
  .strict();

export const providerBoundaryNodeKindV1Schema = z
  .object({
    kind: z.literal("boundary"),
    boundaryType: boundaryTypeSchema,
    containmentModel: z.literal("provider-semantic"),
  })
  .strict();

export const providerNodeKindV1Schema = z.discriminatedUnion("kind", [
  providerResourceNodeKindV1Schema,
  providerBoundaryNodeKindV1Schema,
]);

export const providerAllowedParentTypeV1Schema = z
  .object({
    serviceId: serviceTypeSchema,
    relationshipType: relationshipTypeSchema,
  })
  .strict();

export const providerPlacementRulesV1Schema = z
  .object({
    rootPlacement: z.enum(["allowed", "required", "forbidden"]),
    allowedParentTypes: z.array(providerAllowedParentTypeV1Schema).max(64),
    maximumDepth: z.number().int().positive().max(64).optional(),
    regionConstraint: z.enum([
      "same-region",
      "provider-defined",
      "not-applicable",
    ]),
  })
  .strict();

export const providerConnectionCategoryV1Schema = z.enum([
  "receives-events-from",
  "reads-or-writes-data",
  "sends-messages-or-events",
  "invokes-another-workload",
  "uses-secrets-or-configuration",
  "network-and-security",
  "observability",
]);

export const providerPortDefinitionV1Schema = z
  .object({
    id: portTypeSchema,
    displayName: shortTextSchema,
    description: longTextSchema,
    direction: z.enum(["input", "output"]),
    capability: namespacedIdentifierSchema,
    category: providerConnectionCategoryV1Schema,
    cardinality: z.enum(["one", "many"]),
    required: z.boolean(),
  })
  .strict();

export const providerConnectionEndpointV1Schema = z
  .object({
    serviceId: serviceTypeSchema,
    portId: portTypeSchema,
  })
  .strict();

const providerConnectionQuestionIdSchema =
  namespacedIdentifierSchema.brand<"ProviderConnectionQuestionId">();
const providerConnectionSupportingChangeIdSchema =
  namespacedIdentifierSchema.brand<"ProviderConnectionSupportingChangeId">();
const providerConnectionIamEffectIdSchema =
  namespacedIdentifierSchema.brand<"ProviderConnectionIamEffectId">();
const providerConnectionFindingCodeSchema =
  namespacedIdentifierSchema.brand<"ProviderConnectionFindingCode">();

export const providerConnectionQuestionV1Schema = z
  .object({
    id: providerConnectionQuestionIdSchema,
    property: configurationKeySchema,
    prompt: shortTextSchema,
    explanation: longTextSchema,
    answer: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("catalog-default") }).strict(),
      z
        .object({
          kind: z.literal("required-user-input"),
          reason: longTextSchema,
        })
        .strict(),
    ]),
  })
  .strict();

export const providerConnectionSupportingChangeV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        id: providerConnectionSupportingChangeIdSchema,
        kind: z.literal("node"),
        serviceId: serviceTypeSchema,
        ownership: z.literal("generated"),
        purpose: longTextSchema,
      })
      .strict(),
    z
      .object({
        id: providerConnectionSupportingChangeIdSchema,
        kind: z.literal("edge"),
        relationshipType: relationshipTypeSchema,
        ownership: z.literal("generated"),
        purpose: longTextSchema,
      })
      .strict(),
  ],
);

const providerConnectionIamActionSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9-]+:[A-Za-z0-9-]+$/u,
    "IAM effects must declare one exact service action without wildcards.",
  )
  .max(256);

export const providerConnectionIamEffectV1Schema = z
  .object({
    id: providerConnectionIamEffectIdSchema,
    effect: z.enum(["allow", "trust"]),
    actions: z.array(providerConnectionIamActionSchema).min(1).max(128),
    resourceScope: z.enum([
      "source-node",
      "target-node",
      "connected-target",
      "supporting-node",
    ]),
    principal: shortTextSchema.optional(),
    when: z
      .object({
        property: configurationKeySchema,
        equals: z.union([z.string(), z.number(), z.boolean()]),
      })
      .strict()
      .optional(),
    explanation: longTextSchema,
  })
  .strict();

export const providerConnectionMissingInformationFindingV1Schema = z
  .object({
    code: providerConnectionFindingCodeSchema,
    trigger: z.enum([
      "missing-configuration",
      "missing-prerequisite",
      "ambiguous-prerequisite",
    ]),
    configurationProperties: z.array(configurationKeySchema).max(32),
    guidedMessage: longTextSchema,
    professionalMessage: longTextSchema,
  })
  .strict();

export const providerConnectionLifecyclePolicyV1Schema = z
  .object({
    provenance: z.literal("connection-rule"),
    deletion: z.literal("release-generated-resources"),
    adoption: z.literal("required-before-customization"),
    sharedResource: z.literal("retain-while-referenced"),
  })
  .strict();

export const providerConnectionImplementationV1Schema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("not-implemented"),
        reason: longTextSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("implemented"),
        interfaceVersion: z.literal(PROVIDER_CONNECTION_RULE_INTERFACE_VERSION),
        implementationId: namespacedIdentifierSchema,
      })
      .strict(),
  ],
);

export const providerConnectionRuleDescriptorV1Schema = z
  .object({
    id: connectionRuleIdSchema,
    ruleVersion: semanticVersionSchema,
    relationshipType: relationshipTypeSchema,
    category: providerConnectionCategoryV1Schema,
    source: providerConnectionEndpointV1Schema,
    target: providerConnectionEndpointV1Schema,
    maximumConnectionsPerSource: z.number().int().positive().max(10_000),
    maximumConnectionsPerTarget: z.number().int().positive().max(10_000),
    maximumConnectionsPerEndpointPair: z.number().int().positive().max(10_000),
    configuration: providerServiceConfigurationV1Schema,
    questions: z.array(providerConnectionQuestionV1Schema).max(64),
    supportingChanges: z
      .array(providerConnectionSupportingChangeV1Schema)
      .max(64),
    iamEffects: z.array(providerConnectionIamEffectV1Schema).max(64),
    missingInformationFindings: z
      .array(providerConnectionMissingInformationFindingV1Schema)
      .max(64),
    lifecycle: providerConnectionLifecyclePolicyV1Schema,
    implementation: providerConnectionImplementationV1Schema,
    validationRuleIds: z.array(providerValidationRuleIdSchema).max(64),
    education: providerEducationalContentV1Schema,
  })
  .strict();

export const providerValidationRuleDescriptorV1Schema = z
  .object({
    id: providerValidationRuleIdSchema,
    interfaceVersion: z.literal(PROVIDER_VALIDATION_RULE_INTERFACE_VERSION),
    ruleVersion: semanticVersionSchema,
    implementationId: namespacedIdentifierSchema,
    serviceIds: z.array(serviceTypeSchema).min(1).max(256),
    documentation: z
      .array(providerDocumentationReferenceV1Schema)
      .min(1)
      .max(32),
  })
  .strict();

export const providerCompilerConfigurationBindingV1Schema = z
  .object({
    configurationKey: configurationKeySchema,
    targetName: z
      .string()
      .regex(
        /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u,
        "Compiler target names must be stable identifiers.",
      ),
  })
  .strict();

export const providerCompilerPortBindingV1Schema = z
  .object({
    portId: portTypeSchema,
    targetAttribute: z
      .string()
      .regex(
        /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u,
        "Compiler target attributes must be stable identifiers.",
      ),
  })
  .strict();

/**
 * Declares the reviewed projection shape used when a target renderer needs
 * more than a one-node/one-resource field copy. This is evidence metadata, not
 * an executable template language: the named renderer remains closed,
 * versioned implementation code with its own deterministic tests.
 */
export const providerCompilerProjectionV1Schema = z
  .object({
    kind: z.enum([
      "relationship-resource",
      "owned-resource",
      "owner-nested-block",
    ]),
    rendererContractId: namespacedIdentifierSchema,
    rendererContractVersion: semanticVersionSchema,
    generatedResourceTypes: z
      .array(
        z
          .string()
          .regex(
            /^[a-z][a-z0-9_]{0,127}$/u,
            "Generated Terraform resource types must be lowercase identifiers.",
          ),
      )
      .max(32)
      .default([]),
  })
  .strict();

const providerCompilerMappingBaseV1Schema = z.object({
  mappingId: compilerMappingIdSchema,
  declarationVersion: z.literal(PROVIDER_MAPPING_DECLARATION_VERSION),
  implementationStatus: z.enum(["metadata-only", "implemented"]),
  configurationBindings: z
    .array(providerCompilerConfigurationBindingV1Schema)
    .max(256),
  semanticConfigurationKeys: z
    .array(configurationKeySchema)
    .max(256)
    .optional(),
  portBindings: z.array(providerCompilerPortBindingV1Schema).max(256),
  projection: providerCompilerProjectionV1Schema.optional(),
});

export const providerTerraformResourceMappingMetadataV1Schema =
  providerCompilerMappingBaseV1Schema
    .extend({
      target: z.literal("terraform"),
      kind: z.literal("resource"),
      providerSource: z
        .string()
        .regex(
          /^[a-z0-9-]+\/[a-z0-9-]+$/u,
          "Terraform provider sources must use namespace/name.",
        ),
      resourceType: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]{0,127}$/u,
          "Terraform resource types must be lowercase identifiers.",
        ),
    })
    .strict();

export const providerTerraformNestedBlockMappingMetadataV1Schema =
  providerCompilerMappingBaseV1Schema
    .extend({
      target: z.literal("terraform"),
      kind: z.literal("nested-block"),
      providerSource: z
        .string()
        .regex(
          /^[a-z0-9-]+\/[a-z0-9-]+$/u,
          "Terraform provider sources must use namespace/name.",
        ),
      ownerServiceId: serviceTypeSchema,
      ownerRelationshipType: namespacedIdentifierSchema,
      blockName: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]{0,127}$/u,
          "Terraform nested block names must be lowercase identifiers.",
        ),
    })
    .strict();

export const providerTerraformMappingMetadataV1Schema = z.discriminatedUnion(
  "kind",
  [
    providerTerraformResourceMappingMetadataV1Schema,
    providerTerraformNestedBlockMappingMetadataV1Schema,
  ],
);

export const providerCloudFormationMappingMetadataV1Schema =
  providerCompilerMappingBaseV1Schema
    .extend({
      target: z.literal("cloudformation"),
      kind: z.literal("resource"),
      typeName: z
        .string()
        .regex(
          /^[A-Z][A-Za-z0-9]*::[A-Z][A-Za-z0-9]*::[A-Z][A-Za-z0-9]*$/u,
          "CloudFormation type names must use Namespace::Service::Resource.",
        ),
    })
    .strict();

export const providerCompilerMappingMetadataV1Schema = z.union([
  providerTerraformMappingMetadataV1Schema,
  providerCloudFormationMappingMetadataV1Schema,
]);

export const providerRegionAvailabilityV1Schema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("unknown"),
        reason: longTextSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("known"),
        coverage: z.enum(["complete", "partial"]),
        regions: z
          .array(
            z
              .object({
                region: regionIdentifierSchema,
                availability: z.enum(["available", "unavailable"]),
              })
              .strict(),
          )
          .min(1)
          .max(256),
      })
      .strict(),
  ],
);

export const providerUnsupportedCapabilityV1Schema = z
  .object({
    id: namespacedIdentifierSchema,
    title: shortTextSchema,
    explanation: longTextSchema,
  })
  .strict();

export const providerServiceDefinitionV1Schema = z
  .object({
    id: serviceTypeSchema,
    definitionVersion: semanticVersionSchema,
    supportLevel: z.enum(["proof", "production-oriented", "curated"]),
    displayName: shortTextSchema,
    description: longTextSchema,
    nodeKind: providerNodeKindV1Schema,
    iconId: iconIdSchema.nullable(),
    placement: providerPlacementRulesV1Schema,
    configuration: providerServiceConfigurationV1Schema,
    ports: z.array(providerPortDefinitionV1Schema).max(256),
    validationRuleIds: z.array(providerValidationRuleIdSchema).max(256),
    education: providerEducationalContentV1Schema,
    unsupportedCapabilities: z
      .array(providerUnsupportedCapabilityV1Schema)
      .max(64),
    mappings: z.array(providerCompilerMappingMetadataV1Schema).max(32),
    regionAvailability: providerRegionAvailabilityV1Schema,
  })
  .strict()
  .superRefine((service, context) => {
    const isInternalConfiguration =
      service.nodeKind.kind === "resource" && !service.nodeKind.deployable;

    if (service.iconId === null && !isInternalConfiguration) {
      context.addIssue({
        code: "custom",
        path: ["iconId"],
        message:
          "Only nondeployable internal configuration resources may omit an icon ID.",
      });
    }
  });

export const providerCatalogMigrationDescriptorV1Schema = z
  .object({
    id: catalogMigrationIdSchema,
    interfaceVersion: z.literal(1),
    fromCatalogVersion: semanticVersionSchema,
    toCatalogVersion: semanticVersionSchema,
    description: longTextSchema,
  })
  .strict();

export const providerCatalogSourceV1Schema = z
  .object({
    contractVersion: z.literal(PROVIDER_CATALOG_CONTRACT_VERSION),
    provider: providerMetadataV1Schema,
    catalog: providerCatalogMetadataV1Schema,
    services: z.array(providerServiceDefinitionV1Schema).max(2_048),
    connectionRules: z
      .array(providerConnectionRuleDescriptorV1Schema)
      .max(4_096),
    validationRules: z
      .array(providerValidationRuleDescriptorV1Schema)
      .max(4_096),
    migrations: z.array(providerCatalogMigrationDescriptorV1Schema).max(256),
  })
  .strict();

const providerCatalogArtifactContentV1Schema = providerCatalogSourceV1Schema
  .extend({
    kind: z.literal(PROVIDER_CATALOG_ARTIFACT_KIND),
    canonicalization: z.literal(PROVIDER_CATALOG_CANONICALIZATION),
  })
  .strict();

export const providerCatalogArtifactV1Schema =
  providerCatalogArtifactContentV1Schema
    .extend({
      digest: sha256DigestSchema,
    })
    .strict();

export type ProviderDocumentationReferenceV1 = z.output<
  typeof providerDocumentationReferenceV1Schema
>;
export type ProviderEducationalContentV1 = z.output<
  typeof providerEducationalContentV1Schema
>;
export type ProviderMetadataV1 = z.output<typeof providerMetadataV1Schema>;
export type ProviderCatalogMetadataV1 = z.output<
  typeof providerCatalogMetadataV1Schema
>;
export type ProviderConfigurationPropertyJsonSchemaV1 = z.output<
  typeof providerConfigurationPropertyJsonSchemaV1Schema
>;
export type ProviderConfigurationJsonSchemaV1 = z.output<
  typeof providerConfigurationJsonSchemaV1Schema
>;
export type ProviderConfigurationUiHintV1 = z.output<
  typeof providerConfigurationUiHintV1Schema
>;
export type ProviderServiceConfigurationV1 = z.output<
  typeof providerServiceConfigurationV1Schema
>;
export type ProviderNodeKindV1 = z.output<typeof providerNodeKindV1Schema>;
export type ProviderAllowedParentTypeV1 = z.output<
  typeof providerAllowedParentTypeV1Schema
>;
export type ProviderPlacementRulesV1 = z.output<
  typeof providerPlacementRulesV1Schema
>;
export type ProviderPortDefinitionV1 = z.output<
  typeof providerPortDefinitionV1Schema
>;
export type ProviderConnectionCategoryV1 = z.output<
  typeof providerConnectionCategoryV1Schema
>;
export type ProviderConnectionRuleDescriptorV1 = z.output<
  typeof providerConnectionRuleDescriptorV1Schema
>;
export type ProviderConnectionQuestionV1 = z.output<
  typeof providerConnectionQuestionV1Schema
>;
export type ProviderConnectionSupportingChangeV1 = z.output<
  typeof providerConnectionSupportingChangeV1Schema
>;
export type ProviderConnectionIamEffectV1 = z.output<
  typeof providerConnectionIamEffectV1Schema
>;
export type ProviderConnectionMissingInformationFindingV1 = z.output<
  typeof providerConnectionMissingInformationFindingV1Schema
>;
export type ProviderConnectionLifecyclePolicyV1 = z.output<
  typeof providerConnectionLifecyclePolicyV1Schema
>;
export type ProviderConnectionImplementationV1 = z.output<
  typeof providerConnectionImplementationV1Schema
>;
export type ProviderValidationRuleDescriptorV1 = z.output<
  typeof providerValidationRuleDescriptorV1Schema
>;
export type ProviderCompilerMappingMetadataV1 = z.output<
  typeof providerCompilerMappingMetadataV1Schema
>;
export type ProviderRegionAvailabilityV1 = z.output<
  typeof providerRegionAvailabilityV1Schema
>;
export type ProviderUnsupportedCapabilityV1 = z.output<
  typeof providerUnsupportedCapabilityV1Schema
>;
export type ProviderServiceDefinitionV1 = z.output<
  typeof providerServiceDefinitionV1Schema
>;
export type ProviderCatalogMigrationDescriptorV1 = z.output<
  typeof providerCatalogMigrationDescriptorV1Schema
>;
export type ProviderCatalogSourceV1 = z.output<
  typeof providerCatalogSourceV1Schema
>;
export type ProviderCatalogArtifactContentV1 = z.output<
  typeof providerCatalogArtifactContentV1Schema
>;
export type ProviderCatalogArtifactV1 = z.output<
  typeof providerCatalogArtifactV1Schema
>;
export type ProviderIconId = z.output<typeof iconIdSchema>;
export type ProviderMetadataV1Input = z.input<typeof providerMetadataV1Schema>;
export type ProviderCatalogMetadataV1Input = z.input<
  typeof providerCatalogMetadataV1Schema
>;
export type ProviderServiceDefinitionV1Input = z.input<
  typeof providerServiceDefinitionV1Schema
>;
export type ProviderConnectionRuleDescriptorV1Input = z.input<
  typeof providerConnectionRuleDescriptorV1Schema
>;
export type ProviderValidationRuleDescriptorV1Input = z.input<
  typeof providerValidationRuleDescriptorV1Schema
>;
export type ProviderCatalogSourceV1Input = z.input<
  typeof providerCatalogSourceV1Schema
>;

export interface ProviderValidationRuleRegistrationV1 {
  readonly descriptor: ProviderValidationRuleDescriptorV1;
  readonly rule: ValidationRuleV1;
}

export interface ProviderValidationRuleRegistrationV1Input {
  readonly descriptor: ProviderValidationRuleDescriptorV1Input;
  readonly rule: ValidationRuleV1;
}

export interface ProviderCatalogMigrationV1 {
  readonly descriptor: ProviderCatalogMigrationDescriptorV1;
  migrate(source: Readonly<ProviderCatalogArtifactV1>): ProviderCatalogSourceV1;
}

export function defineProviderMetadataV1(
  definition: ProviderMetadataV1Input,
): ProviderMetadataV1 {
  return providerMetadataV1Schema.parse(definition);
}

export function defineProviderCatalogMetadataV1(
  definition: ProviderCatalogMetadataV1Input,
): ProviderCatalogMetadataV1 {
  return providerCatalogMetadataV1Schema.parse(definition);
}

export function defineProviderServiceV1(
  definition: ProviderServiceDefinitionV1Input,
): ProviderServiceDefinitionV1 {
  return providerServiceDefinitionV1Schema.parse(definition);
}

export function defineProviderConnectionRuleV1(
  definition: ProviderConnectionRuleDescriptorV1Input,
): ProviderConnectionRuleDescriptorV1 {
  return providerConnectionRuleDescriptorV1Schema.parse(definition);
}

export function defineProviderValidationRuleDescriptorV1(
  definition: ProviderValidationRuleDescriptorV1Input,
): ProviderValidationRuleDescriptorV1 {
  return providerValidationRuleDescriptorV1Schema.parse(definition);
}

export function defineProviderValidationRuleRegistrationV1(
  definition: ProviderValidationRuleRegistrationV1Input,
): ProviderValidationRuleRegistrationV1 {
  const descriptor = providerValidationRuleDescriptorV1Schema.parse(
    definition.descriptor,
  );
  if (
    String(descriptor.id) !== String(definition.rule.id) ||
    descriptor.ruleVersion !== definition.rule.ruleVersion
  ) {
    throw new TypeError(
      "Provider validation registration metadata must match the validation rule.",
    );
  }

  return Object.freeze({
    descriptor,
    rule: definition.rule,
  });
}

export function defineProviderCatalogMigrationV1(
  definition: ProviderCatalogMigrationV1,
): ProviderCatalogMigrationV1 {
  return {
    descriptor: providerCatalogMigrationDescriptorV1Schema.parse(
      definition.descriptor,
    ),
    migrate: (source) => definition.migrate(source),
  };
}

export function defineProviderCatalogSourceV1(
  source: ProviderCatalogSourceV1Input,
): ProviderCatalogSourceV1 {
  return providerCatalogSourceV1Schema.parse(source);
}
