import { z } from "zod";

import { activeIssueV1Schema } from "./active-issue-v1.js";
import {
  assistantOperationBatchV1Schema,
  assistantOperationKindV1Schema,
} from "./assistant-workflow-v1.js";
import {
  architectureDocumentV3Schema,
  type ArchitectureDocumentV3,
} from "./architecture-document-v3.js";
import {
  configurationKeySchema,
  configurationSchemaIdSchema,
  namespacedIdentifierSchema,
  nodeIdSchema,
  portTypeSchema,
  relationshipTypeSchema,
  resourceTypeSchema,
  semanticVersionSchema,
  serviceTypeSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { externalResourceV1Schema } from "./external-resource-reference-v1.js";
import { graphCommandBatchV1Schema } from "./graph-command-v1.js";
import {
  generationCoverageRequirementSchema,
  generationCoverageStateSchema,
} from "./generation-coverage-v1.js";
import { intentDocumentV1Schema } from "./intent-document-v1.js";
import {
  reconciliationOperationIdSchema,
  reconciliationOperationV1Schema,
  reconciliationProposalV1Schema,
} from "./reconciliation-proposal-v1.js";
import {
  repositoryCommitShaSchema,
  repositorySourceLocationV1Schema,
} from "./repository-snapshot-v1.js";
import {
  activeIssueIdSchema,
  aiExtensionIdSchema,
  repositorySnapshotIdSchema,
  safeRelativePathSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
} from "./solution-contract-common-v1.js";
import { repositoryPackageRootV1Schema } from "./repository-ownership-v1.js";
import {
  solutionRevisionManifestV1Schema,
  solutionSourceOwnershipV1Schema,
} from "./solution-revision-v1.js";
import { workloadIdSchema } from "./workload-behavior-v1.js";

function isPrintableOneLine(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit < 0x20 ||
      codeUnit === 0x7f ||
      codeUnit === 0x2028 ||
      codeUnit === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

const printableOneLineSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(isPrintableOneLine, "Must be printable one-line text.");
const boundedTextSchema = z
  .string()
  .min(1)
  .max(64 * 1_024);
const candidateContentSchema = z.string().max(256 * 1_024);
const decimalUnitSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,38})$/, "Must be a nonnegative decimal integer.");
const invocationIdSchema = solutionStableIdSchema.brand<"ModelInvocationId">();
export const proposalItemIdSchema =
  solutionStableIdSchema.brand<"ModelProposalItemId">();

export const modelGatewayOperationV1Schema = z.enum([
  "intent.extract",
  "requirements.blocking-questions",
  "architecture.propose",
  "workload.propose",
  "external-resource.propose",
  "operations.propose",
  "repository.interpret",
  "issue.explain",
  "deterministic-fix.explain",
  "fix.propose",
  "application-source.generate",
  "iac-extension.generate",
  "candidate.repair",
  "summary.plain-language",
  "summary.technical",
]);

export const modelGatewayRoleV1Schema = z.enum([
  "low-cost-extraction-help",
  "standard-planning-generation",
  "deep-architecture-custom-generation",
  "repair-escalation",
  "fallback",
]);

export const modelRequestedModeV1Schema = z.enum(["guided", "professional"]);

export const modelComplexityV1Schema = z.enum([
  "low",
  "standard",
  "deep",
  "repair",
]);

export const modelProviderFamilyV1Schema = z.enum([
  "amazon-bedrock",
  "future-provider",
  "deterministic-fake",
]);

export const modelGatewayEvidenceReferenceV1Schema = z
  .object({
    digest: sha256DigestSchema.optional(),
    kind: z.enum([
      "requirements-source",
      "architecture-node",
      "architecture-edge",
      "workload",
      "external-resource",
      "solution-contract",
      "repository-evidence",
      "repository-file",
      "active-issue",
      "evidence-record",
      "candidate-artifact",
    ]),
    location: repositorySourceLocationV1Schema.optional(),
    path: safeRelativePathSchema.optional(),
    referenceId: solutionStableIdSchema,
  })
  .strict();

export const modelGatewayConfidenceV1Schema = z
  .object({
    basisPoints: z.number().int().min(0).max(10_000),
    evidenceReferences: z.array(modelGatewayEvidenceReferenceV1Schema).max(256),
    rationale: printableOneLineSchema,
  })
  .strict();

export const modelGatewayAssumptionV1Schema = z
  .object({
    assumptionId: proposalItemIdSchema,
    confidence: modelGatewayConfidenceV1Schema,
    statement: printableOneLineSchema,
  })
  .strict();

export const modelGatewayUnknownV1Schema = z
  .object({
    blocking: z.boolean(),
    confidence: modelGatewayConfidenceV1Schema,
    question: printableOneLineSchema,
    unknownId: proposalItemIdSchema,
  })
  .strict();

export const modelProposalProvenanceV1Schema = z
  .object({
    contractVersion: z.literal(1),
    gatewayId: namespacedIdentifierSchema,
    inferenceProfileId: namespacedIdentifierSchema.optional(),
    inputDigest: sha256DigestSchema,
    invocationId: invocationIdSchema,
    modelId: namespacedIdentifierSchema,
    modelVersion: z.string().min(1).max(128),
    ownership: z.literal("untrusted-proposal"),
    promptDigest: sha256DigestSchema,
    promptTemplateId: namespacedIdentifierSchema,
    promptVersion: semanticVersionSchema,
    providerId: namespacedIdentifierSchema,
  })
  .strict();

export const modelProposalContextV1Schema = z
  .object({
    assumptions: z.array(modelGatewayAssumptionV1Schema).max(256),
    confidence: modelGatewayConfidenceV1Schema,
    unknowns: z.array(modelGatewayUnknownV1Schema).max(256),
  })
  .strict();

export const modelSanitizedRepositoryExcerptV1Schema = z
  .object({
    content: z.string().max(16 * 1_024),
    evidenceId: solutionStableIdSchema,
    fileChecksum: sha256DigestSchema,
    location: repositorySourceLocationV1Schema,
    path: safeRelativePathSchema,
    redaction: z
      .object({
        categories: z
          .array(
            z.enum([
              "credential-candidate",
              "secret-candidate",
              "personal-data",
              "sensitive-content",
            ]),
          )
          .max(4),
        noSecretValues: z.literal(true),
        status: z.enum(["not-required", "applied"]),
      })
      .strict(),
  })
  .strict();

export const modelSanitizedDiagnosticV1Schema = z
  .object({
    candidateId: proposalItemIdSchema,
    checkKind: z.enum([
      "parse",
      "format",
      "static-analysis",
      "build",
      "unit-test",
      "contract-test",
      "integration-test",
      "security",
    ]),
    diagnosticId: solutionStableIdSchema,
    message: z.string().min(1).max(2_000),
    noSecretValues: z.literal(true),
    path: safeRelativePathSchema,
    redactionStatus: z.enum(["not-required", "applied"]),
    toolId: namespacedIdentifierSchema,
    toolVersion: z.string().min(1).max(128),
  })
  .strict();

export const modelCatalogGroundingPortV1Schema = z
  .object({
    direction: z.enum(["input", "output"]),
    port: portTypeSchema,
  })
  .strict();

const modelCatalogConfigurationValueSourceV1Schema = z.enum([
  "literal",
  "node-reference",
  "secret-reference",
  "sensitive-variable-reference",
]);

const modelCatalogNodeReferenceAuthorityV1Schema = z
  .object({
    attribute: namespacedIdentifierSchema,
    serviceType: serviceTypeSchema,
  })
  .strict();

const modelCatalogConfigurationStringPropertyV1Schema = z
  .object({
    default: z.string().optional(),
    description: boundedTextSchema.optional(),
    enum: z.array(z.string()).min(1).max(128).optional(),
    maxLength: z.number().int().nonnegative().optional(),
    minLength: z.number().int().nonnegative().optional(),
    pattern: z.string().max(512).optional(),
    title: printableOneLineSchema.optional(),
    type: z.literal("string"),
  })
  .strict();

const modelCatalogConfigurationNumberPropertyV1Schema = z
  .object({
    default: z.number().optional(),
    description: boundedTextSchema.optional(),
    enum: z.array(z.number()).min(1).max(128).optional(),
    maximum: z.number().optional(),
    minimum: z.number().optional(),
    title: printableOneLineSchema.optional(),
    type: z.enum(["number", "integer"]),
  })
  .strict();

const modelCatalogConfigurationBooleanPropertyV1Schema = z
  .object({
    const: z.boolean().optional(),
    default: z.boolean().optional(),
    description: boundedTextSchema.optional(),
    title: printableOneLineSchema.optional(),
    type: z.literal("boolean"),
  })
  .strict();

const modelCatalogConfigurationArrayItemV1Schema = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        enum: z.array(z.string()).min(1).max(128).optional(),
        type: z.literal("string"),
      })
      .strict(),
    z
      .object({
        enum: z.array(z.number()).min(1).max(128).optional(),
        type: z.enum(["number", "integer"]),
      })
      .strict(),
  ],
);

const modelCatalogConfigurationArrayPropertyV1Schema = z
  .object({
    default: z
      .array(z.union([z.string(), z.number()]))
      .max(256)
      .optional(),
    description: boundedTextSchema.optional(),
    items: modelCatalogConfigurationArrayItemV1Schema,
    maxItems: z.number().int().nonnegative().optional(),
    minItems: z.number().int().nonnegative().optional(),
    title: printableOneLineSchema.optional(),
    type: z.literal("array"),
    uniqueItems: z.boolean().optional(),
  })
  .strict();

export const modelCatalogConfigurationPropertyV1Schema = z.discriminatedUnion(
  "type",
  [
    modelCatalogConfigurationStringPropertyV1Schema,
    modelCatalogConfigurationNumberPropertyV1Schema,
    modelCatalogConfigurationBooleanPropertyV1Schema,
    modelCatalogConfigurationArrayPropertyV1Schema,
  ],
);

export const modelCatalogConfigurationValidationV1Schema = z
  .object({
    canonicalization: z.literal(
      "cloudmarkup.provider-configuration-authority.canonical-json.v1",
    ),
    jsonSchema: z
      .object({
        $id: z
          .string()
          .regex(
            /^urn:cloudmarkup:configuration:[a-z][a-z0-9.-]*:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u,
          ),
        $schema: z.literal("https://json-schema.org/draft/2020-12/schema"),
        additionalProperties: z.literal(false),
        description: boundedTextSchema.optional(),
        properties: z.record(
          configurationKeySchema,
          modelCatalogConfigurationPropertyV1Schema,
        ),
        required: z.array(configurationKeySchema).max(256),
        title: printableOneLineSchema,
        type: z.literal("object"),
      })
      .strict(),
    nodeReferenceAuthorities: z.record(
      configurationKeySchema,
      z.array(modelCatalogNodeReferenceAuthorityV1Schema).min(1).max(256),
    ),
    schemaDigest: sha256DigestSchema,
    valueSources: z.record(
      configurationKeySchema,
      modelCatalogConfigurationValueSourceV1Schema,
    ),
  })
  .strict()
  .superRefine((value, context) => {
    const propertyKeys = Object.keys(value.jsonSchema.properties).sort();
    const valueSourceKeys = Object.keys(value.valueSources).sort();
    const nodeReferenceKeys = Object.entries(value.valueSources)
      .filter(([, source]) => source === "node-reference")
      .map(([key]) => key)
      .sort();
    const nodeReferenceAuthorityKeys = Object.keys(
      value.nodeReferenceAuthorities,
    ).sort();
    if (
      propertyKeys.length > 256 ||
      propertyKeys.length !== valueSourceKeys.length ||
      propertyKeys.some((key, index) => key !== valueSourceKeys[index])
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Configuration authority must define one exact value source for every allow-listed property.",
        path: ["valueSources"],
      });
    }
    if (
      nodeReferenceKeys.length !== nodeReferenceAuthorityKeys.length ||
      nodeReferenceKeys.some(
        (key, index) => key !== nodeReferenceAuthorityKeys[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Every node-reference field must define one exact service/attribute authority list and no other field may define one.",
        path: ["nodeReferenceAuthorities"],
      });
    }
    for (const [key, authorities] of Object.entries(
      value.nodeReferenceAuthorities,
    )) {
      const tuples = new Set<string>();
      for (const [index, authority] of authorities.entries()) {
        const tuple = `${authority.serviceType}\u0000${authority.attribute}`;
        if (tuples.has(tuple)) {
          context.addIssue({
            code: "custom",
            message:
              "Node-reference service/attribute authority tuples must be unique per field.",
            path: ["nodeReferenceAuthorities", key, index],
          });
        }
        tuples.add(tuple);
      }
    }
    const required = new Set<string>();
    for (const [index, key] of value.jsonSchema.required.entries()) {
      if (
        required.has(key) ||
        !Object.hasOwn(value.jsonSchema.properties, key)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Required configuration properties must be unique and allow-listed.",
          path: ["jsonSchema", "required", index],
        });
      }
      required.add(key);
    }
  });

export const modelCatalogGroundingPlacementV1Schema = z
  .object({
    allowedParentTypes: z
      .array(
        z
          .object({
            relationshipType: relationshipTypeSchema,
            serviceType: serviceTypeSchema,
          })
          .strict(),
      )
      .max(64),
    maximumDepth: z.number().int().positive().max(64).optional(),
    rootPlacement: z.enum(["allowed", "required", "forbidden"]),
  })
  .strict();

export const modelCatalogGroundingNodeV1Schema = z
  .object({
    configurationSchemaId: configurationSchemaIdSchema,
    configurationSchemaVersion: semanticVersionSchema,
    configurationValidation: modelCatalogConfigurationValidationV1Schema,
    placement: modelCatalogGroundingPlacementV1Schema,
    ports: z.array(modelCatalogGroundingPortV1Schema).max(256),
    resourceType: resourceTypeSchema,
    serviceType: serviceTypeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const ports = new Set<string>();
    for (const [index, port] of value.ports.entries()) {
      if (ports.has(port.port)) {
        context.addIssue({
          code: "custom",
          message: "Catalog-grounding ports must be unique per service.",
          path: ["ports", index, "port"],
        });
      }
      ports.add(port.port);
    }
    const expectedSchemaId = `urn:cloudmarkup:configuration:${value.configurationSchemaId}:${value.configurationSchemaVersion}`;
    if (value.configurationValidation.jsonSchema.$id !== expectedSchemaId) {
      context.addIssue({
        code: "custom",
        message:
          "Node configuration authority must bind the exact schema ID and version.",
        path: ["configurationValidation", "jsonSchema", "$id"],
      });
    }
    const parentTuples = new Set<string>();
    for (const [
      index,
      parent,
    ] of value.placement.allowedParentTypes.entries()) {
      const tuple = `${parent.serviceType}\u0000${parent.relationshipType}`;
      if (parentTuples.has(tuple)) {
        context.addIssue({
          code: "custom",
          message: "Ordered parent service/relationship tuples must be unique.",
          path: ["placement", "allowedParentTypes", index],
        });
      }
      parentTuples.add(tuple);
    }
    if (
      (value.placement.rootPlacement === "required" &&
        value.placement.allowedParentTypes.length > 0) ||
      (value.placement.rootPlacement === "forbidden" &&
        value.placement.allowedParentTypes.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Placement authority must make required-root and forbidden-root behavior unambiguous.",
        path: ["placement"],
      });
    }
  });

export const modelCatalogGroundingConnectionRuleV1Schema = z
  .object({
    configurationSchemaId: configurationSchemaIdSchema,
    configurationSchemaVersion: semanticVersionSchema,
    configurationValidation: modelCatalogConfigurationValidationV1Schema,
    relationshipType: relationshipTypeSchema,
    ruleId: namespacedIdentifierSchema,
    ruleVersion: semanticVersionSchema,
    source: z
      .object({ port: portTypeSchema, serviceType: serviceTypeSchema })
      .strict(),
    target: z
      .object({ port: portTypeSchema, serviceType: serviceTypeSchema })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedSchemaId = `urn:cloudmarkup:configuration:${value.configurationSchemaId}:${value.configurationSchemaVersion}`;
    if (value.configurationValidation.jsonSchema.$id !== expectedSchemaId) {
      context.addIssue({
        code: "custom",
        message:
          "Connection configuration authority must bind the exact schema ID and version.",
        path: ["configurationValidation", "jsonSchema", "$id"],
      });
    }
  });

export const modelOperationCatalogGroundingV1Schema = z
  .object({
    catalog: z
      .object({
        digest: sha256DigestSchema,
        id: namespacedIdentifierSchema,
        version: semanticVersionSchema,
      })
      .strict(),
    connectionRules: z
      .array(modelCatalogGroundingConnectionRuleV1Schema)
      .max(4_096),
    manifestVersion: z.literal(1),
    nodes: z.array(modelCatalogGroundingNodeV1Schema).min(1).max(2_048),
  })
  .strict()
  .superRefine((value, context) => {
    const nodeTuples = new Set<string>();
    const services = new Set<string>();
    const portsByService = new Map<string, Map<string, "input" | "output">>();
    for (const [index, node] of value.nodes.entries()) {
      const tuple = [
        node.serviceType,
        node.resourceType,
        node.configurationSchemaId,
        node.configurationSchemaVersion,
      ].join("\u0000");
      if (nodeTuples.has(tuple) || services.has(node.serviceType)) {
        context.addIssue({
          code: "custom",
          message:
            "Catalog-grounding node tuples and service identities must be unique.",
          path: ["nodes", index],
        });
      }
      nodeTuples.add(tuple);
      services.add(node.serviceType);
      portsByService.set(
        node.serviceType,
        new Map(node.ports.map((port) => [port.port, port.direction])),
      );
    }
    for (const [nodeIndex, node] of value.nodes.entries()) {
      for (const [key, authorities] of Object.entries(
        node.configurationValidation.nodeReferenceAuthorities,
      )) {
        for (const [authorityIndex, authority] of authorities.entries()) {
          if (!services.has(authority.serviceType)) {
            context.addIssue({
              code: "custom",
              message:
                "Node-reference authority must target a service declared by the same catalog grounding manifest.",
              path: [
                "nodes",
                nodeIndex,
                "configurationValidation",
                "nodeReferenceAuthorities",
                key,
                authorityIndex,
                "serviceType",
              ],
            });
          }
        }
      }
    }

    const ruleIds = new Set<string>();
    const orderedRuleTuples = new Set<string>();
    for (const [index, rule] of value.connectionRules.entries()) {
      const tuple = [
        rule.source.serviceType,
        rule.source.port,
        rule.target.serviceType,
        rule.target.port,
        rule.relationshipType,
        rule.configurationSchemaId,
        rule.configurationSchemaVersion,
      ].join("\u0000");
      if (ruleIds.has(rule.ruleId) || orderedRuleTuples.has(tuple)) {
        context.addIssue({
          code: "custom",
          message:
            "Catalog-grounding connection rule IDs and ordered semantic tuples must be unique.",
          path: ["connectionRules", index],
        });
      }
      ruleIds.add(rule.ruleId);
      orderedRuleTuples.add(tuple);
      for (const [key, authorities] of Object.entries(
        rule.configurationValidation.nodeReferenceAuthorities,
      )) {
        for (const [authorityIndex, authority] of authorities.entries()) {
          if (!services.has(authority.serviceType)) {
            context.addIssue({
              code: "custom",
              message:
                "Node-reference authority must target a service declared by the same catalog grounding manifest.",
              path: [
                "connectionRules",
                index,
                "configurationValidation",
                "nodeReferenceAuthorities",
                key,
                authorityIndex,
                "serviceType",
              ],
            });
          }
        }
      }
      if (
        portsByService.get(rule.source.serviceType)?.get(rule.source.port) !==
          "output" ||
        portsByService.get(rule.target.serviceType)?.get(rule.target.port) !==
          "input"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every ordered connection rule must reference a declared output source port and input target port.",
          path: ["connectionRules", index],
        });
      }
    }
  });

export const modelSourceOwnershipAuthorityV1Schema = z
  .object({
    authority: z.literal("solution-revision-candidate-generation"),
    candidateRoots: z.array(repositoryPackageRootV1Schema).min(1).max(6),
    canonicalization: z.literal(
      "cloudmarkup.solution-source-ownership.canonical-json.v1",
    ),
    ownedPaths: z.array(safeRelativePathSchema).min(1).max(1_000),
    solutionRevisionId: solutionRevisionIdSchema,
    sourceOwnership: z.array(solutionSourceOwnershipV1Schema).min(1).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const roots = new Set<string>();
    for (const [index, root] of value.candidateRoots.entries()) {
      if (roots.has(root)) {
        context.addIssue({
          code: "custom",
          message: "Candidate roots must be unique.",
          path: ["candidateRoots", index],
        });
      }
      roots.add(root);
    }
    const paths = new Set<string>();
    for (const [index, path] of value.ownedPaths.entries()) {
      if (paths.has(path)) {
        context.addIssue({
          code: "custom",
          message: "Owned candidate paths must be unique.",
          path: ["ownedPaths", index],
        });
      }
      paths.add(path);
      if (
        !value.candidateRoots.some(
          (root) => path === root || path.startsWith(`${root}/`),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Every owned candidate path must be inside an exact root.",
          path: ["ownedPaths", index],
        });
      }
    }
    const ownershipPaths = new Set<string>();
    for (const [index, entry] of value.sourceOwnership.entries()) {
      if (ownershipPaths.has(entry.path)) {
        context.addIssue({
          code: "custom",
          message: "Source-ownership authority paths must be unique.",
          path: ["sourceOwnership", index, "path"],
        });
      }
      ownershipPaths.add(entry.path);
    }
    if (
      paths.size !== ownershipPaths.size ||
      [...paths].some((path) => !ownershipPaths.has(path))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Source-ownership authority must bind every and only the owned candidate paths.",
        path: ["sourceOwnership"],
      });
    }
  });

export const modelCandidateBoundaryV1Schema = z
  .object({
    approvalPathIds: z.array(namespacedIdentifierSchema).min(1).max(32),
    boundaryId: solutionStableIdSchema,
    ownedPaths: z.array(safeRelativePathSchema).min(1).max(1_000),
    writeAuthority: z.literal("candidate-artifacts-only"),
  })
  .strict();

export const modelDependencyRequestV1Schema = z
  .object({
    approvalPathId: namespacedIdentifierSchema,
    ecosystem: namespacedIdentifierSchema,
    kind: z.enum(["package", "module", "provider"]),
    name: z.string().min(1).max(214),
    reason: printableOneLineSchema,
    requestedVersion: z.string().min(1).max(128),
    reviewState: z.literal("requested"),
  })
  .strict();

export const modelValidationExpectationV1Schema = z
  .object({
    checkId: namespacedIdentifierSchema,
    kind: z.enum([
      "parse",
      "format",
      "static-analysis",
      "build",
      "unit-test",
      "contract-test",
      "integration-test",
      "security",
    ]),
    required: z.boolean(),
    successCondition: z.literal("must-pass"),
    toolProfileId: namespacedIdentifierSchema,
  })
  .strict();

const modelGenerationResourceAddressV1Schema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(isPrintableOneLine, "Must be a printable resource address.");

export const modelGenerationOfficialSchemaV1Schema = z
  .object({
    document: boundedTextSchema,
    schemaDigest: sha256DigestSchema,
    schemaId: namespacedIdentifierSchema,
    schemaVersion: semanticVersionSchema,
  })
  .strict();

export const modelGenerationCatalogSliceV1Schema = z
  .object({
    catalog: z
      .object({
        digest: sha256DigestSchema,
        id: namespacedIdentifierSchema,
        version: semanticVersionSchema,
      })
      .strict(),
    content: boundedTextSchema,
    entries: z
      .array(
        z
          .object({
            resourceType: resourceTypeSchema,
            serviceType: serviceTypeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(2_048),
    sliceDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const entries = new Set<string>();
    value.entries.forEach((entry, index) => {
      const key = `${entry.serviceType}\u0000${entry.resourceType}`;
      if (entries.has(key)) {
        context.addIssue({
          code: "custom",
          message:
            "Generation catalog service/resource entries must be unique.",
          path: ["entries", index],
        });
      }
      entries.add(key);
    });
  });

export const modelGenerationAllowedDependencyV1Schema = z
  .object({
    approvalPathId: namespacedIdentifierSchema,
    ecosystem: namespacedIdentifierSchema,
    kind: z.enum(["package", "module", "provider"]),
    name: z.string().min(1).max(214),
    requestedVersion: z.string().min(1).max(128),
  })
  .strict();

export const modelGenerationAllowedProviderV1Schema = z
  .object({
    providerId: namespacedIdentifierSchema,
    source: z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,255}$/u),
    versionConstraint: z.string().min(1).max(128),
  })
  .strict();

export const modelGenerationAllowedResourceV1Schema = z
  .object({
    providerId: namespacedIdentifierSchema,
    resourceType: z.string().regex(/^[A-Za-z][A-Za-z0-9:_./-]{0,255}$/u),
  })
  .strict();

export const modelGenerationExistingFileV1Schema = z
  .object({
    content: candidateContentSchema,
    contentDigest: sha256DigestSchema,
    noSecretValues: z.literal(true),
    ownership: z.enum([
      "generated",
      "ai-authored",
      "user-owned",
      "approved-extension",
    ]),
    path: safeRelativePathSchema,
    redactionStatus: z.enum(["not-required", "applied"]),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(256 * 1_024),
  })
  .strict();

export const modelGenerationLimitsV1Schema = z
  .object({
    maximumCandidateFileBytes: z
      .number()
      .int()
      .positive()
      .max(256 * 1_024),
    maximumCandidateFiles: z.number().int().positive().max(1_000),
    maximumCandidateTotalBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1_024 * 1_024),
    maximumDependencyRequests: z.number().int().nonnegative().max(256),
    maximumExpectedTests: z.number().int().nonnegative().max(256),
    maximumRepairAttempts: z.number().int().nonnegative().max(3),
    maximumResourceCount: z.number().int().nonnegative().max(4_096),
  })
  .strict();

export const modelGenerationRequestedBehaviorV1Schema = z
  .object({
    acceptanceCriteria: z.array(printableOneLineSchema).min(1).max(64),
    objective: z.string().min(1).max(8_000),
    requirements: z.array(printableOneLineSchema).max(128),
  })
  .strict();

const modelGenerationContextCommonShape = {
  allowedDependencies: z
    .array(modelGenerationAllowedDependencyV1Schema)
    .max(256),
  allowedProviders: z.array(modelGenerationAllowedProviderV1Schema).max(64),
  allowedResources: z.array(modelGenerationAllowedResourceV1Schema).max(512),
  catalogSlice: modelGenerationCatalogSliceV1Schema,
  existingFiles: z.array(modelGenerationExistingFileV1Schema).max(1_000),
  extensionId: aiExtensionIdSchema,
  language: namespacedIdentifierSchema,
  limits: modelGenerationLimitsV1Schema,
  officialSchemas: z
    .array(modelGenerationOfficialSchemaV1Schema)
    .min(1)
    .max(128),
  ownedPaths: z.array(safeRelativePathSchema).min(1).max(1_000),
  ownedResourceAddresses: z
    .array(modelGenerationResourceAddressV1Schema)
    .max(4_096),
  protectedPaths: z.array(safeRelativePathSchema).max(2_000),
  protectedResourceAddresses: z
    .array(modelGenerationResourceAddressV1Schema)
    .max(4_096),
  requestedBehavior: modelGenerationRequestedBehaviorV1Schema,
  runtimeFamily: namespacedIdentifierSchema,
  sourceReferences: z
    .array(modelGatewayEvidenceReferenceV1Schema)
    .min(1)
    .max(256),
  validationExpectations: z
    .array(modelValidationExpectationV1Schema)
    .min(1)
    .max(128),
} as const;

const modelApplicationGenerationContextV1Schema = z
  .object({
    ...modelGenerationContextCommonShape,
    extensionPointId: namespacedIdentifierSchema,
    kind: z.literal("application"),
    workloadId: workloadIdSchema,
  })
  .strict();

const modelIacGenerationContextV1Schema = z
  .object({
    ...modelGenerationContextCommonShape,
    extensionSlotId: solutionStableIdSchema,
    kind: z.literal("iac-extension"),
    targetFormat: z.enum(["terraform", "cloudformation"]),
  })
  .strict();

export const modelGenerationContextV1Schema = z
  .discriminatedUnion("kind", [
    modelApplicationGenerationContextV1Schema,
    modelIacGenerationContextV1Schema,
  ])
  .superRefine((value, context) => {
    const unique = (
      values: readonly string[],
      path: readonly (string | number)[],
      message: string,
    ): Set<string> => {
      const seen = new Set<string>();
      values.forEach((entry, index) => {
        if (seen.has(entry)) {
          context.addIssue({ code: "custom", message, path: [...path, index] });
        }
        seen.add(entry);
      });
      return seen;
    };

    const ownedPaths = unique(
      value.ownedPaths,
      ["ownedPaths"],
      "Owned generation paths must be unique.",
    );
    const protectedPaths = unique(
      value.protectedPaths,
      ["protectedPaths"],
      "Protected generation paths must be unique.",
    );
    value.protectedPaths.forEach((path, index) => {
      if (ownedPaths.has(path)) {
        context.addIssue({
          code: "custom",
          message: "Owned and protected generation paths must be disjoint.",
          path: ["protectedPaths", index],
        });
      }
    });
    const ownedAddresses = unique(
      value.ownedResourceAddresses,
      ["ownedResourceAddresses"],
      "Owned resource addresses must be unique.",
    );
    unique(
      value.protectedResourceAddresses,
      ["protectedResourceAddresses"],
      "Protected resource addresses must be unique.",
    );
    value.protectedResourceAddresses.forEach((address, index) => {
      if (ownedAddresses.has(address)) {
        context.addIssue({
          code: "custom",
          message: "Owned and protected resource addresses must be disjoint.",
          path: ["protectedResourceAddresses", index],
        });
      }
    });

    const existingPaths = new Set<string>();
    value.existingFiles.forEach((file, index) => {
      if (
        existingPaths.has(file.path) ||
        (!ownedPaths.has(file.path) && !protectedPaths.has(file.path))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Sanitized existing files must have unique owned or protected paths.",
          path: ["existingFiles", index, "path"],
        });
      }
      existingPaths.add(file.path);
    });

    const providerIds = unique(
      value.allowedProviders.map((provider) => provider.providerId),
      ["allowedProviders"],
      "Allowed provider identities must be unique.",
    );
    unique(
      value.allowedDependencies.map((dependency) =>
        [
          dependency.approvalPathId,
          dependency.ecosystem,
          dependency.kind,
          dependency.name,
          dependency.requestedVersion,
        ].join("\u0000"),
      ),
      ["allowedDependencies"],
      "Allowed dependency tuples must be unique.",
    );
    unique(
      value.allowedResources.map(
        (resource) => `${resource.providerId}\u0000${resource.resourceType}`,
      ),
      ["allowedResources"],
      "Allowed provider/resource tuples must be unique.",
    );
    value.allowedResources.forEach((resource, index) => {
      if (!providerIds.has(resource.providerId)) {
        context.addIssue({
          code: "custom",
          message: "Every allowed resource must bind an allowed provider.",
          path: ["allowedResources", index, "providerId"],
        });
      }
    });
    unique(
      value.officialSchemas.map(
        (schema) => `${schema.schemaId}\u0000${schema.schemaVersion}`,
      ),
      ["officialSchemas"],
      "Official schema identities and versions must be unique.",
    );
    unique(
      value.sourceReferences.map((reference) => JSON.stringify(reference)),
      ["sourceReferences"],
      "Generation-context source references must be unique.",
    );
    unique(
      value.validationExpectations.map((expectation) => expectation.checkId),
      ["validationExpectations"],
      "Generation-context validation expectations must be unique.",
    );

    if (
      value.existingFiles.length > value.limits.maximumCandidateFiles ||
      value.allowedDependencies.length > value.limits.maximumDependencyRequests
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Generation context exceeds its declared deterministic limits.",
        path: ["limits"],
      });
    }
  });

export const modelCandidateAssumptionV1Schema = z
  .object({
    assumptionId: proposalItemIdSchema,
    sourceReferences: z
      .array(modelGatewayEvidenceReferenceV1Schema)
      .min(1)
      .max(64),
    statement: printableOneLineSchema,
  })
  .strict();

export const modelCandidateUnresolvedItemV1Schema = z
  .object({
    blocking: z.boolean(),
    detail: z.string().min(1).max(4_000),
    question: printableOneLineSchema,
    sourceReferences: z
      .array(modelGatewayEvidenceReferenceV1Schema)
      .min(1)
      .max(64),
    unresolvedItemId: proposalItemIdSchema,
  })
  .strict();

export const modelCandidateExpectedTestV1Schema = z
  .object({
    description: z.string().min(1).max(4_000),
    expectedTestId: proposalItemIdSchema,
    kind: z.enum(["unit-test", "contract-test", "integration-test"]),
    sourceReferences: z
      .array(modelGatewayEvidenceReferenceV1Schema)
      .min(1)
      .max(64),
    targetPaths: z.array(safeRelativePathSchema).min(1).max(64),
    validationCheckId: namespacedIdentifierSchema,
  })
  .strict();

export const modelCandidatePriorContextV1Schema = z
  .object({
    assumptions: z.array(modelCandidateAssumptionV1Schema).max(128),
    contextDigest: sha256DigestSchema,
    expectedTests: z.array(modelCandidateExpectedTestV1Schema).max(256),
    unresolvedItems: z.array(modelCandidateUnresolvedItemV1Schema).max(128),
  })
  .strict();

export const modelGenerationPlanStepV1Schema = z
  .object({
    action: z.enum(["create-file", "replace-owned-file", "propose-patch"]),
    rationale: printableOneLineSchema,
    sourceReferences: z
      .array(modelGatewayEvidenceReferenceV1Schema)
      .min(1)
      .max(256),
    stepId: proposalItemIdSchema,
    targetPath: safeRelativePathSchema,
  })
  .strict();

export const modelGenerationPlanV1Schema = z
  .object({
    objective: printableOneLineSchema,
    planId: proposalItemIdSchema,
    steps: z.array(modelGenerationPlanStepV1Schema).min(1).max(1_000),
  })
  .strict();

export const modelFileCandidateV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      candidateId: proposalItemIdSchema,
      content: candidateContentSchema,
      contentDigest: sha256DigestSchema,
      encoding: z.literal("utf-8"),
      kind: z.literal("file"),
      ownership: z.literal("ai-authored-candidate"),
      path: safeRelativePathSchema,
      priorDigest: sha256DigestSchema.optional(),
    })
    .strict(),
  z
    .object({
      baseDigest: sha256DigestSchema,
      candidateId: proposalItemIdSchema,
      kind: z.literal("patch"),
      ownership: z.literal("ai-authored-candidate"),
      path: safeRelativePathSchema,
      proposedResultDigest: sha256DigestSchema,
      unifiedDiff: candidateContentSchema,
    })
    .strict(),
]);

export const modelCandidateBundleV1Schema = z
  .object({
    assumptions: z.array(modelCandidateAssumptionV1Schema).max(128).optional(),
    boundary: modelCandidateBoundaryV1Schema,
    candidates: z.array(modelFileCandidateV1Schema).min(1).max(1_000),
    dependencies: z.array(modelDependencyRequestV1Schema).max(256),
    expectedTests: z
      .array(modelCandidateExpectedTestV1Schema)
      .max(256)
      .optional(),
    generationPlan: modelGenerationPlanV1Schema,
    provenance: modelProposalProvenanceV1Schema,
    unresolvedItems: z
      .array(modelCandidateUnresolvedItemV1Schema)
      .max(128)
      .optional(),
    validationExpectations: z
      .array(modelValidationExpectationV1Schema)
      .min(1)
      .max(128),
  })
  .strict();

export const modelWorkloadOperationV1Schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add"),
      expectedWorkloadContentHash: sha256DigestSchema,
      operationId: proposalItemIdSchema,
      proposal: z
        .object({
          implementationMode: z.enum([
            "infrastructure-only",
            "user-provided",
            "generated-starter",
            "complete-supported-pattern",
            "ai-assisted-custom",
            "external-artifact",
          ]),
          owningNodeId: nodeIdSchema,
          responsibilities: z.array(printableOneLineSchema).min(1).max(64),
          runtimeFamily: namespacedIdentifierSchema.optional(),
          workloadId: workloadIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      expectedWorkloadContentHash: sha256DigestSchema,
      operationId: proposalItemIdSchema,
      patch: z
        .object({
          responsibilities: z.array(printableOneLineSchema).max(64).optional(),
          runtimeFamily: namespacedIdentifierSchema.optional(),
        })
        .strict(),
      workloadId: workloadIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      expectedWorkloadContentHash: sha256DigestSchema,
      operationId: proposalItemIdSchema,
      rationale: printableOneLineSchema,
      workloadId: workloadIdSchema,
    })
    .strict(),
]);

/** A non-mutating refusal is machine data, never a dummy Graph Command. */
export const modelSafetyRefusalBatchV1Schema = z
  .object({
    contractVersion: z.literal(1),
    kind: z.literal("safety-refusal"),
    reasonCodes: z
      .array(
        z.enum([
          "reject-prompt-injection",
          "secret-redaction",
          "no-credential-authority",
          "no-deployment-authority",
          "reject-unsupported-service",
          "reject-unsupported-field",
          "reject-resource-limit",
        ]),
      )
      .min(1)
      .max(4)
      .refine(
        (codes) => new Set(codes).size === codes.length,
        "Refusal reasons must be unique.",
      ),
    explanation: printableOneLineSchema,
  })
  .strict();

export const modelOperationBatchV1Schema = z.discriminatedUnion("kind", [
  modelSafetyRefusalBatchV1Schema,
  z
    .object({
      batch: graphCommandBatchV1Schema,
      kind: z.literal("graph"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("workload"),
      operations: z.array(modelWorkloadOperationV1Schema).min(1).max(256),
    })
    .strict(),
  z
    .object({
      expectedObservedContentHash: sha256DigestSchema,
      kind: z.literal("reconciliation"),
      operations: z.array(reconciliationOperationV1Schema).min(1).max(256),
    })
    .strict(),
  z
    .object({
      batch: assistantOperationBatchV1Schema,
      kind: z.literal("assistant"),
    })
    .strict(),
]);

export const modelSolutionPlanningGraphCommandKindV1Schema = z.enum([
  "add-node",
  "remove-node",
  "update-node-configuration",
  "move-node",
  "reparent-node",
  "add-edge",
  "remove-edge",
  "update-edge-configuration",
  "replace-workload-and-application-contracts",
  "adopt-generated-resource",
  "release-generated-resource",
]);

export const modelSolutionPlanningContextV1Schema = z
  .object({
    approvedIntent: intentDocumentV1Schema,
    approvedRepositoryEvidence: z
      .object({
        commitSha: repositoryCommitShaSchema,
        evidence: z.array(modelSanitizedRepositoryExcerptV1Schema).max(256),
        repositorySnapshotDigest: sha256DigestSchema,
        repositorySnapshotId: repositorySnapshotIdSchema,
      })
      .strict()
      .optional(),
    allowedAssistantOperationKinds: z
      .array(assistantOperationKindV1Schema)
      .min(1)
      .max(15)
      .optional(),
    allowedGraphCommandKinds: z
      .array(modelSolutionPlanningGraphCommandKindV1Schema)
      .min(1)
      .max(11),
    allowedPolicyKinds: z.array(namespacedIdentifierSchema).max(64),
    assistantLimits: z
      .object({
        maximumApplicationContracts: z.number().int().min(0).max(2_048),
        maximumOperations: z.number().int().min(1).max(256),
        maximumSourceOwnershipDeclarations: z.number().int().min(0).max(10_000),
        maximumTestScenarios: z.number().int().min(0).max(2_048),
        maximumWorkloadOperations: z.number().int().min(0).max(10_000),
        maximumWorkloads: z.number().int().min(0).max(2_048),
      })
      .strict()
      .optional(),
    limits: z
      .object({
        maximumAddedNodes: z.number().int().min(0).max(512),
        maximumEdges: z.number().int().min(0).max(4_096),
        maximumExternalResources: z.number().int().min(0).max(512),
        maximumNodes: z.number().int().min(1).max(2_048),
      })
      .strict(),
    target: z.enum(["terraform", "cloudformation"]),
    targetReadiness: z
      .array(
        z
          .object({
            rationale: printableOneLineSchema,
            serviceType: serviceTypeSchema,
            status: z.enum(["ready", "pending", "unsupported"]),
            target: z.enum(["terraform", "cloudformation"]),
          })
          .strict(),
      )
      .max(2_048),
    validationRules: z
      .array(
        z
          .object({
            kind: z.enum([
              "placement",
              "connection",
              "policy",
              "security",
              "cost-sensitive",
              "coverage",
              "target-readiness",
            ]),
            ruleId: namespacedIdentifierSchema,
          })
          .strict(),
      )
      .max(512),
  })
  .strict()
  .superRefine((value, context) => {
    const policyKinds = new Set<string>();
    value.allowedPolicyKinds.forEach((kind, index) => {
      if (policyKinds.has(kind)) {
        context.addIssue({
          code: "custom",
          message: "Allowed policy kinds must be unique.",
          path: ["allowedPolicyKinds", index],
        });
      }
      policyKinds.add(kind);
    });
    const allowedCommands = new Set<string>();
    value.allowedGraphCommandKinds.forEach((kind, index) => {
      if (allowedCommands.has(kind)) {
        context.addIssue({
          code: "custom",
          message: "Allowed Graph Command kinds must be unique.",
          path: ["allowedGraphCommandKinds", index],
        });
      }
      allowedCommands.add(kind);
    });
    const ruleIds = new Set<string>();
    value.validationRules.forEach((rule, index) => {
      if (ruleIds.has(rule.ruleId)) {
        context.addIssue({
          code: "custom",
          message: "Planning validation-rule identities must be unique.",
          path: ["validationRules", index, "ruleId"],
        });
      }
      ruleIds.add(rule.ruleId);
    });
    const requiredRuleKinds = [
      "placement",
      "connection",
      "policy",
      "security",
      "cost-sensitive",
      "coverage",
      "target-readiness",
    ] as const;
    const declaredRuleKinds = new Set(
      value.validationRules.map((rule) => rule.kind),
    );
    requiredRuleKinds.forEach((kind) => {
      if (!declaredRuleKinds.has(kind)) {
        context.addIssue({
          code: "custom",
          message: `Planning context is missing ${kind} validation metadata.`,
          path: ["validationRules"],
        });
      }
    });
    const readiness = new Set<string>();
    value.targetReadiness.forEach((entry, index) => {
      const key = `${entry.target}\u0000${entry.serviceType}`;
      if (readiness.has(key) || entry.target !== value.target) {
        context.addIssue({
          code: "custom",
          message:
            "Target-readiness entries must be unique and match the selected planning target.",
          path: ["targetReadiness", index],
        });
      }
      readiness.add(key);
    });
  });

const modelSolutionPlanningEvidenceArrayV1Schema = z
  .array(modelGatewayEvidenceReferenceV1Schema)
  .max(256);

export const modelSolutionPlanningProposalV1Schema = z
  .object({
    externalResources: z.array(externalResourceV1Schema).max(512),
    generationCoverageSuggestions: z
      .array(
        z
          .object({
            missingRequirements: z
              .array(generationCoverageRequirementSchema)
              .max(16),
            rationale: printableOneLineSchema,
            state: generationCoverageStateSchema,
            workloadId: workloadIdSchema,
          })
          .strict(),
      )
      .max(1_000),
    policyKindsUsed: z.array(namespacedIdentifierSchema).max(64),
    rationale: z.string().min(1).max(16_000),
    reconciliationSuggestions: z
      .array(
        z
          .object({
            confidence: modelGatewayConfidenceV1Schema,
            evidenceReferences: modelSolutionPlanningEvidenceArrayV1Schema,
            explanation: printableOneLineSchema,
            operationId: reconciliationOperationIdSchema,
          })
          .strict(),
      )
      .max(256),
    rejectedAlternatives: z
      .array(
        z
          .object({
            alternativeId: proposalItemIdSchema,
            evidenceReferences: modelSolutionPlanningEvidenceArrayV1Schema,
            rationale: printableOneLineSchema,
            summary: printableOneLineSchema,
          })
          .strict(),
      )
      .max(64),
    targetReadiness: z
      .object({
        rationale: printableOneLineSchema,
        status: z.enum(["ready", "blocked", "unsupported"]),
        target: z.enum(["terraform", "cloudformation"]),
      })
      .strict(),
    testScenarios: z
      .array(
        z
          .object({
            evidenceReferences: modelSolutionPlanningEvidenceArrayV1Schema,
            expectedOutcome: printableOneLineSchema,
            kind: z.enum([
              "unit",
              "contract",
              "integration",
              "security",
              "failure",
            ]),
            name: printableOneLineSchema,
            scenarioId: proposalItemIdSchema,
            workloadId: workloadIdSchema.optional(),
          })
          .strict(),
      )
      .max(512),
  })
  .strict();
const requestEnvelopeShape = {
  contractVersion: z.literal(1),
  requestedMode: modelRequestedModeV1Schema,
} as const;
const responseEnvelopeShape = {
  contractVersion: z.literal(1),
  proposalContext: modelProposalContextV1Schema,
  provenance: modelProposalProvenanceV1Schema,
} as const;

export const modelIntentExtractionRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    operation: z.literal("intent.extract"),
    source: z
      .object({
        content: boundedTextSchema,
        digest: sha256DigestSchema,
        kind: z.literal("requirements-text"),
        sourceId: solutionStableIdSchema,
      })
      .strict(),
  })
  .strict();

export const modelIntentExtractionResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    intentDocument: intentDocumentV1Schema,
    operation: z.literal("intent.extract"),
  })
  .strict();

export const modelBlockingQuestionsRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    intentDocument: intentDocumentV1Schema,
    maximumQuestions: z.number().int().min(1).max(64),
    operation: z.literal("requirements.blocking-questions"),
  })
  .strict();

export const modelBlockingQuestionsResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    operation: z.literal("requirements.blocking-questions"),
    questions: z
      .array(
        z
          .object({
            evidenceReferences: z
              .array(modelGatewayEvidenceReferenceV1Schema)
              .max(64),
            question: printableOneLineSchema,
            questionId: proposalItemIdSchema,
            rationale: printableOneLineSchema,
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

export const modelArchitectureProposalRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    catalog: z
      .object({
        allowedRelationshipTypes: z
          .array(namespacedIdentifierSchema)
          .max(2_048),
        allowedServiceIds: z.array(namespacedIdentifierSchema).max(2_048),
        catalogDigest: sha256DigestSchema,
        catalogId: namespacedIdentifierSchema,
        catalogVersion: semanticVersionSchema,
      })
      .strict(),
    currentArchitecture: architectureDocumentV3Schema.optional(),
    intentDocument: intentDocumentV1Schema,
    operation: z.literal("architecture.propose"),
  })
  .strict();

export const modelArchitectureProposalResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    operation: z.literal("architecture.propose"),
    relationships: z
      .array(
        z
          .object({
            candidateId: proposalItemIdSchema,
            rationale: printableOneLineSchema,
            relationshipType: namespacedIdentifierSchema,
            sourceCandidateId: proposalItemIdSchema,
            targetCandidateId: proposalItemIdSchema,
          })
          .strict(),
      )
      .max(2_048),
    services: z
      .array(
        z
          .object({
            candidateId: proposalItemIdSchema,
            capability: namespacedIdentifierSchema,
            catalogServiceId: namespacedIdentifierSchema,
            evidenceReferences: z
              .array(modelGatewayEvidenceReferenceV1Schema)
              .max(64),
            rationale: printableOneLineSchema,
          })
          .strict(),
      )
      .max(2_048),
  })
  .strict();

export const modelWorkloadProposalRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    architecture: architectureDocumentV3Schema,
    operation: z.literal("workload.propose"),
    solutionRevision: solutionRevisionManifestV1Schema.optional(),
  })
  .strict();

export const modelWorkloadProposalResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    operation: z.literal("workload.propose"),
    workloads: z
      .array(
        z
          .object({
            candidateId: proposalItemIdSchema,
            implementationMode: z.enum([
              "infrastructure-only",
              "user-provided",
              "generated-starter",
              "complete-supported-pattern",
              "ai-assisted-custom",
              "external-artifact",
            ]),
            owningNodeId: nodeIdSchema,
            responsibilities: z.array(printableOneLineSchema).min(1).max(64),
            runtimeFamily: namespacedIdentifierSchema.optional(),
            sourceReferences: z
              .array(modelGatewayEvidenceReferenceV1Schema)
              .max(64),
          })
          .strict(),
      )
      .max(2_048),
  })
  .strict();

export const modelExternalResourceProposalRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    architecture: architectureDocumentV3Schema,
    operation: z.literal("external-resource.propose"),
    repositoryExcerpts: z
      .array(modelSanitizedRepositoryExcerptV1Schema)
      .max(256),
  })
  .strict();

export const modelExternalResourceProposalResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    operation: z.literal("external-resource.propose"),
    resources: z
      .array(
        z
          .object({
            candidateId: proposalItemIdSchema,
            capability: namespacedIdentifierSchema,
            evidenceReferences: z
              .array(modelGatewayEvidenceReferenceV1Schema)
              .max(256),
            ownershipCandidate: z.enum([
              "existing-cloud-managed-elsewhere",
              "imported-current-iac-lifecycle",
              "third-party-service-api",
              "on-premises-network-endpoint",
              "repository-defined-external-dependency",
              "unknown-unresolved",
            ]),
            rationale: printableOneLineSchema,
          })
          .strict(),
      )
      .max(2_048),
  })
  .strict();

export const modelOperationProposalRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    architecture: architectureDocumentV3Schema,
    catalogGrounding: modelOperationCatalogGroundingV1Schema,
    operation: z.literal("operations.propose"),
    planningContext: modelSolutionPlanningContextV1Schema.optional(),
    reconciliation: reconciliationProposalV1Schema.optional(),
    repairContext: z
      .object({
        attempt: z.number().int().min(1).max(2),
        diagnostics: z
          .array(
            z
              .object({
                code: namespacedIdentifierSchema,
                message: printableOneLineSchema,
                path: z.string().min(1).max(1_000),
              })
              .strict(),
          )
          .min(1)
          .max(128),
        previousProposalDigest: sha256DigestSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.catalogGrounding.catalog.id !== value.architecture.catalog.id ||
      value.catalogGrounding.catalog.version !==
        value.architecture.catalog.version ||
      value.catalogGrounding.catalog.digest !==
        value.architecture.catalog.digest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Operation catalog grounding must bind the exact Architecture catalog identity, version, and digest.",
        path: ["catalogGrounding", "catalog"],
      });
    }
  });

export const modelOperationProposalResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    batches: z.array(modelOperationBatchV1Schema).min(1).max(64),
    operation: z.literal("operations.propose"),
    solutionProposal: modelSolutionPlanningProposalV1Schema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.batches.some((batch) => batch.kind === "safety-refusal") &&
      (response.batches.length !== 1 || response.solutionProposal !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A safety refusal must be the sole response and cannot contain a solution proposal.",
      });
    }
  });

export const modelRepositoryInterpretationRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    commitSha: repositoryCommitShaSchema,
    evidence: z.array(modelSanitizedRepositoryExcerptV1Schema).min(1).max(256),
    operation: z.literal("repository.interpret"),
    repositorySnapshotDigest: sha256DigestSchema,
    repositorySnapshotId: repositorySnapshotIdSchema,
  })
  .strict();

export const modelRepositoryInterpretationResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    claims: z
      .array(
        z
          .object({
            category: z.enum([
              "resource",
              "connection",
              "workload",
              "external-resource",
              "source-ownership",
              "workflow",
              "diagnostic",
            ]),
            claimId: proposalItemIdSchema,
            confidence: modelGatewayConfidenceV1Schema,
            evidenceReferences: z
              .array(modelGatewayEvidenceReferenceV1Schema)
              .min(1)
              .max(256),
            summary: printableOneLineSchema,
          })
          .strict(),
      )
      .max(2_048),
    operation: z.literal("repository.interpret"),
  })
  .strict();

export const modelIssueExplanationRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    issue: activeIssueV1Schema,
    operation: z.literal("issue.explain"),
  })
  .strict();

export const modelDeterministicFixExplanationRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    issue: activeIssueV1Schema,
    operation: z.literal("deterministic-fix.explain"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.issue.deterministicFix === undefined) {
      context.addIssue({
        code: "custom",
        message: "A deterministic-fix explanation requires an exact fix.",
        path: ["issue", "deterministicFix"],
      });
    }
  });

const explanationResponseShape = {
  ...responseEnvelopeShape,
  explanation: z
    .object({
      nextActions: z.array(printableOneLineSchema).max(32),
      plainLanguage: z.string().min(1).max(8_000),
      technical: z.string().min(1).max(16_000),
    })
    .strict(),
} as const;

export const modelIssueExplanationResponseV1Schema = z
  .object({
    ...explanationResponseShape,
    operation: z.literal("issue.explain"),
  })
  .strict();

export const modelDeterministicFixExplanationResponseV1Schema = z
  .object({
    ...explanationResponseShape,
    operation: z.literal("deterministic-fix.explain"),
  })
  .strict();

export const modelAiFixRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    boundary: modelCandidateBoundaryV1Schema,
    issue: activeIssueV1Schema,
    operation: z.literal("fix.propose"),
    validationExpectations: z
      .array(modelValidationExpectationV1Schema)
      .min(1)
      .max(128),
  })
  .strict();

export const modelAiFixResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    candidateBundle: modelCandidateBundleV1Schema,
    issueId: activeIssueIdSchema,
    operation: z.literal("fix.propose"),
  })
  .strict();

export const modelApplicationSourceGenerationRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    acceptanceCriteria: z.array(printableOneLineSchema).min(1).max(64),
    architecture: architectureDocumentV3Schema,
    boundary: modelCandidateBoundaryV1Schema,
    generationContext: modelGenerationContextV1Schema.optional(),
    generationContextDigest: sha256DigestSchema.optional(),
    operation: z.literal("application-source.generate"),
    solutionRevision: solutionRevisionManifestV1Schema,
    sourceReferences: z
      .array(modelGatewayEvidenceReferenceV1Schema)
      .min(1)
      .max(256),
    sourceOwnershipAuthority: modelSourceOwnershipAuthorityV1Schema,
    validationExpectations: z
      .array(modelValidationExpectationV1Schema)
      .min(1)
      .max(128),
    workloadId: workloadIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.generationContext === undefined) !==
      (value.generationContextDigest === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Generation context and its canonical digest must be supplied together.",
        path: ["generationContextDigest"],
      });
    }
  });

export const modelApplicationSourceGenerationResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    candidateBundle: modelCandidateBundleV1Schema,
    operation: z.literal("application-source.generate"),
  })
  .strict();

export const modelIacExtensionGenerationRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    acceptanceCriteria: z.array(printableOneLineSchema).min(1).max(64),
    architecture: architectureDocumentV3Schema,
    boundary: modelCandidateBoundaryV1Schema,
    generationContext: modelGenerationContextV1Schema.optional(),
    generationContextDigest: sha256DigestSchema.optional(),
    operation: z.literal("iac-extension.generate"),
    solutionRevision: solutionRevisionManifestV1Schema,
    sourceReferences: z
      .array(modelGatewayEvidenceReferenceV1Schema)
      .min(1)
      .max(256),
    sourceOwnershipAuthority: modelSourceOwnershipAuthorityV1Schema,
    targetFormat: z.enum(["terraform", "cloudformation"]),
    validationExpectations: z
      .array(modelValidationExpectationV1Schema)
      .min(1)
      .max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.generationContext === undefined) !==
      (value.generationContextDigest === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Generation context and its canonical digest must be supplied together.",
        path: ["generationContextDigest"],
      });
    }
  });

export const modelIacExtensionGenerationResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    candidateBundle: modelCandidateBundleV1Schema,
    operation: z.literal("iac-extension.generate"),
  })
  .strict();

export const modelCandidateRepairRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    boundary: modelCandidateBoundaryV1Schema,
    diagnostics: z.array(modelSanitizedDiagnosticV1Schema).min(1).max(256),
    failedCandidates: z.array(modelFileCandidateV1Schema).min(1).max(1_000),
    failedCandidatesCanonicalization: z.literal(
      "cloudmarkup.model-failed-candidates.canonical-json.v1",
    ),
    failedOutputDigest: sha256DigestSchema,
    generationContext: modelGenerationContextV1Schema.optional(),
    generationContextDigest: sha256DigestSchema.optional(),
    priorCandidateContext: modelCandidatePriorContextV1Schema.optional(),
    currentAttempt: z.number().int().min(1).max(3),
    maximumRepairAttempts: z.number().int().min(1).max(3),
    operation: z.literal("candidate.repair"),
    validationExpectations: z
      .array(modelValidationExpectationV1Schema)
      .min(1)
      .max(128),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.generationContext === undefined) !==
      (value.generationContextDigest === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Repair generation context and its canonical digest must be supplied together.",
        path: ["generationContextDigest"],
      });
    }
    if (value.currentAttempt > value.maximumRepairAttempts) {
      context.addIssue({
        code: "custom",
        message: "Current repair attempt cannot exceed its exact maximum.",
        path: ["currentAttempt"],
      });
    }
    const candidateIds = new Set<string>();
    const candidatePaths = new Set<string>();
    for (const [index, candidate] of value.failedCandidates.entries()) {
      if (
        candidateIds.has(candidate.candidateId) ||
        candidatePaths.has(candidate.path)
      ) {
        context.addIssue({
          code: "custom",
          message: "Failed candidate IDs and paths must be unique.",
          path: ["failedCandidates", index],
        });
      }
      candidateIds.add(candidate.candidateId);
      candidatePaths.add(candidate.path);
    }
    const diagnosticIds = new Set<string>();
    for (const [index, diagnostic] of value.diagnostics.entries()) {
      if (diagnosticIds.has(diagnostic.diagnosticId)) {
        context.addIssue({
          code: "custom",
          message: "Repair diagnostic IDs must be unique.",
          path: ["diagnostics", index],
        });
      }
      diagnosticIds.add(diagnostic.diagnosticId);
    }
  });

export const modelCandidateRepairResponseV1Schema = z
  .object({
    ...responseEnvelopeShape,
    candidateBundle: modelCandidateBundleV1Schema,
    operation: z.literal("candidate.repair"),
    repairedFromDigest: sha256DigestSchema,
    resolvedDiagnosticIds: z.array(solutionStableIdSchema).max(256),
  })
  .strict();

const summarySourceV1Schema = z
  .object({
    content: boundedTextSchema,
    contentDigest: sha256DigestSchema,
    evidenceReferences: z.array(modelGatewayEvidenceReferenceV1Schema).max(256),
    sourceKind: z.enum([
      "intent",
      "architecture",
      "workload",
      "external-resource",
      "repository-observation",
      "issue",
      "candidate",
      "evidence",
    ]),
  })
  .strict();

export const modelPlainLanguageSummaryRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    operation: z.literal("summary.plain-language"),
    source: summarySourceV1Schema,
  })
  .strict();

export const modelTechnicalSummaryRequestV1Schema = z
  .object({
    ...requestEnvelopeShape,
    operation: z.literal("summary.technical"),
    source: summarySourceV1Schema,
  })
  .strict();

const summaryResponseShape = {
  ...responseEnvelopeShape,
  summary: z.string().min(1).max(16_000),
} as const;

export const modelPlainLanguageSummaryResponseV1Schema = z
  .object({
    ...summaryResponseShape,
    operation: z.literal("summary.plain-language"),
  })
  .strict();

export const modelTechnicalSummaryResponseV1Schema = z
  .object({
    ...summaryResponseShape,
    operation: z.literal("summary.technical"),
  })
  .strict();

type ModelGatewayRequestV1Value =
  | z.output<typeof modelIntentExtractionRequestV1Schema>
  | z.output<typeof modelBlockingQuestionsRequestV1Schema>
  | z.output<typeof modelArchitectureProposalRequestV1Schema>
  | z.output<typeof modelWorkloadProposalRequestV1Schema>
  | z.output<typeof modelExternalResourceProposalRequestV1Schema>
  | z.output<typeof modelOperationProposalRequestV1Schema>
  | z.output<typeof modelRepositoryInterpretationRequestV1Schema>
  | z.output<typeof modelIssueExplanationRequestV1Schema>
  | z.output<typeof modelDeterministicFixExplanationRequestV1Schema>
  | z.output<typeof modelAiFixRequestV1Schema>
  | z.output<typeof modelApplicationSourceGenerationRequestV1Schema>
  | z.output<typeof modelIacExtensionGenerationRequestV1Schema>
  | z.output<typeof modelCandidateRepairRequestV1Schema>
  | z.output<typeof modelTechnicalSummaryRequestV1Schema>
  | z.output<typeof modelPlainLanguageSummaryRequestV1Schema>;

export const modelGatewayRequestV1Schema: z.ZodType<ModelGatewayRequestV1Value> =
  z.discriminatedUnion("operation", [
    modelIntentExtractionRequestV1Schema,
    modelBlockingQuestionsRequestV1Schema,
    modelArchitectureProposalRequestV1Schema,
    modelWorkloadProposalRequestV1Schema,
    modelExternalResourceProposalRequestV1Schema,
    modelOperationProposalRequestV1Schema,
    modelRepositoryInterpretationRequestV1Schema,
    modelIssueExplanationRequestV1Schema,
    modelDeterministicFixExplanationRequestV1Schema,
    modelAiFixRequestV1Schema,
    modelApplicationSourceGenerationRequestV1Schema,
    modelIacExtensionGenerationRequestV1Schema,
    modelCandidateRepairRequestV1Schema,
    modelTechnicalSummaryRequestV1Schema,
    modelPlainLanguageSummaryRequestV1Schema,
  ]);

export const modelGatewayResponseV1Schema = z.discriminatedUnion("operation", [
  modelIntentExtractionResponseV1Schema,
  modelBlockingQuestionsResponseV1Schema,
  modelArchitectureProposalResponseV1Schema,
  modelWorkloadProposalResponseV1Schema,
  modelExternalResourceProposalResponseV1Schema,
  modelOperationProposalResponseV1Schema,
  modelRepositoryInterpretationResponseV1Schema,
  modelIssueExplanationResponseV1Schema,
  modelDeterministicFixExplanationResponseV1Schema,
  modelAiFixResponseV1Schema,
  modelApplicationSourceGenerationResponseV1Schema,
  modelIacExtensionGenerationResponseV1Schema,
  modelCandidateRepairResponseV1Schema,
  modelPlainLanguageSummaryResponseV1Schema,
  modelTechnicalSummaryResponseV1Schema,
]);

export const modelInvocationScopeV1Schema = z
  .object({
    jobId: solutionStableIdSchema.optional(),
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema.optional(),
    repositorySnapshotId: repositorySnapshotIdSchema.optional(),
    solutionRevisionId: solutionRevisionIdSchema.optional(),
    userId: solutionStableIdSchema,
  })
  .strict();

export const modelInvocationRoutingV1Schema = z
  .object({
    acceptedMaximumCreditUnits: z
      .number()
      .int()
      .nonnegative()
      .max(10_000_000)
      .optional(),
    capabilityRegistryDigest: sha256DigestSchema,
    capabilityRegistryId: namespacedIdentifierSchema,
    capabilityRegistryVersion: semanticVersionSchema,
    capabilityVersion: semanticVersionSchema,
    effort: z.enum(["medium", "high", "xhigh"]),
    evaluationPolicyId: namespacedIdentifierSchema,
    evaluationPolicyVersion: semanticVersionSchema,
    evaluationResultDigest: sha256DigestSchema,
    evaluationResultVersion: semanticVersionSchema,
    modelCapabilityDigest: sha256DigestSchema,
    modelConfigurationReference: namespacedIdentifierSchema,
    modelFamily: namespacedIdentifierSchema,
    pricingVersionReference: namespacedIdentifierSchema,
    routeId: z.enum(["standard-design", "deep-design", "internal-escalation"]),
    routeDefinitionDigest: sha256DigestSchema,
    routeRegistryDigest: sha256DigestSchema,
    routeRegistryId: namespacedIdentifierSchema,
    routeRegistryVersion: semanticVersionSchema,
    routingConfigurationDigest: sha256DigestSchema,
    routingDecisionDigest: sha256DigestSchema,
  })
  .strict();

export const modelInvocationDescriptorV1Schema = z
  .object({
    budgetDecisionId: solutionStableIdSchema,
    complexity: modelComplexityV1Schema,
    contractVersion: z.literal(1),
    entitlementDecisionId: solutionStableIdSchema,
    evaluationPolicyId: namespacedIdentifierSchema,
    evaluationPolicyVersion: semanticVersionSchema,
    feature: modelGatewayOperationV1Schema,
    idempotencyKeyDigest: sha256DigestSchema,
    inferenceProfileId: namespacedIdentifierSchema.optional(),
    inputDigest: sha256DigestSchema,
    invocationId: invocationIdSchema,
    modelId: namespacedIdentifierSchema,
    modelVersion: z.string().min(1).max(128),
    promptDigest: sha256DigestSchema,
    promptTemplateId: namespacedIdentifierSchema,
    promptVersion: semanticVersionSchema,
    providerFamily: modelProviderFamilyV1Schema,
    providerId: namespacedIdentifierSchema,
    requestedMode: modelRequestedModeV1Schema,
    role: modelGatewayRoleV1Schema,
    routing: modelInvocationRoutingV1Schema.optional(),
    scope: modelInvocationScopeV1Schema,
    toolAuthority: z.literal("none"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.routing !== undefined &&
      (value.routing.evaluationPolicyId !== value.evaluationPolicyId ||
        value.routing.evaluationPolicyVersion !== value.evaluationPolicyVersion)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Routing provenance must bind the descriptor evaluation policy exactly.",
        path: ["routing", "evaluationPolicyId"],
      });
    }
  });

export const normalizedModelUsageV1Schema = z
  .object({
    attemptNumber: z.number().int().min(1).max(2),
    cacheReadUnits: decimalUnitSchema,
    cacheWriteUnits: decimalUnitSchema,
    completedAt: utcTimestampSchema,
    contractVersion: z.literal(1),
    durationMilliseconds: z
      .number()
      .int()
      .nonnegative()
      .max(24 * 60 * 60_000),
    feature: modelGatewayOperationV1Schema,
    idempotencyKeyDigest: sha256DigestSchema,
    inferenceProfileId: namespacedIdentifierSchema.optional(),
    inputDigest: sha256DigestSchema,
    inputUnits: decimalUnitSchema,
    invocationId: invocationIdSchema,
    modelId: namespacedIdentifierSchema,
    modelVersion: z.string().min(1).max(128),
    outputUnits: decimalUnitSchema,
    promptTemplateId: namespacedIdentifierSchema,
    promptVersion: semanticVersionSchema,
    providerId: namespacedIdentifierSchema,
    providerRequestId: z.string().min(1).max(256).optional(),
    result: z.enum([
      "succeeded",
      "provider-error",
      "canceled",
      "invalid-output",
    ]),
    routing: modelInvocationRoutingV1Schema.optional(),
    scope: modelInvocationScopeV1Schema,
    startedAt: utcTimestampSchema,
    thinkingUnits: decimalUnitSchema,
    usageRecordId: solutionStableIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const elapsed = Date.parse(value.completedAt) - Date.parse(value.startedAt);
    if (elapsed < 0 || elapsed !== value.durationMilliseconds) {
      context.addIssue({
        code: "custom",
        message:
          "Normalized usage duration must exactly match its UTC timestamps.",
        path: ["durationMilliseconds"],
      });
    }
  });

export type ModelGatewayOperationV1 = z.output<
  typeof modelGatewayOperationV1Schema
>;
export type ModelGatewayRoleV1 = z.output<typeof modelGatewayRoleV1Schema>;
export type ModelRequestedModeV1 = z.output<typeof modelRequestedModeV1Schema>;
export type ModelComplexityV1 = z.output<typeof modelComplexityV1Schema>;
export type ModelGatewayRequestV1 = z.output<
  typeof modelGatewayRequestV1Schema
>;
export type ModelGatewayResponseV1 = z.output<
  typeof modelGatewayResponseV1Schema
>;
export type ModelSolutionPlanningContextV1 = z.output<
  typeof modelSolutionPlanningContextV1Schema
>;
export type ModelSolutionPlanningProposalV1 = z.output<
  typeof modelSolutionPlanningProposalV1Schema
>;
export type ModelInvocationDescriptorV1 = z.output<
  typeof modelInvocationDescriptorV1Schema
>;
export type NormalizedModelUsageV1 = z.output<
  typeof normalizedModelUsageV1Schema
>;
export type ModelCandidateBundleV1 = z.output<
  typeof modelCandidateBundleV1Schema
>;
export type ModelGenerationContextV1 = z.output<
  typeof modelGenerationContextV1Schema
>;
export type ModelCandidateAssumptionV1 = z.output<
  typeof modelCandidateAssumptionV1Schema
>;
export type ModelCandidateUnresolvedItemV1 = z.output<
  typeof modelCandidateUnresolvedItemV1Schema
>;
export type ModelCandidateExpectedTestV1 = z.output<
  typeof modelCandidateExpectedTestV1Schema
>;
export type ModelCandidatePriorContextV1 = z.output<
  typeof modelCandidatePriorContextV1Schema
>;
export type ModelSanitizedDiagnosticV1 = z.output<
  typeof modelSanitizedDiagnosticV1Schema
>;
export type ModelArchitectureProposalRequestV1 = z.output<
  typeof modelArchitectureProposalRequestV1Schema
>;
export type ModelArchitectureProposalResponseV1 = z.output<
  typeof modelArchitectureProposalResponseV1Schema
>;

export type ModelGatewayArchitectureInputV1 = ArchitectureDocumentV3;
