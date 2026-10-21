import {
  evidenceRecordV1Schema,
  namespacedIdentifierSchema,
  safeRelativePathSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  serializeCanonicalJson,
  utcTimestampSchema,
  type EvidenceRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { isAlias, parseAllDocuments, visit } from "yaml";
import { z } from "zod";

import {
  AI_EXTENSION_GENERATION_COORDINATOR_ID,
  AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
  candidateDiagnosticV1Schema,
  type CandidateDiagnosticV1,
} from "./contracts.js";
import {
  candidateContentSafetyDiagnostics,
  digestCanonicalValue,
  portablePathKey,
  sha256Text,
  stableRecordId,
  utf8ByteLength,
  validatePortableCandidatePath,
} from "./security.js";

const cloudFormationResourceTypeSchema = z
  .string()
  .regex(/^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$/u)
  .max(256);
const cloudFormationLogicalIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]{0,254}$/u);

const intrinsicNameSchema = z.enum([
  "Ref",
  "Fn::GetAtt",
  "Fn::Join",
  "Fn::Sub",
  "Fn::If",
  "Fn::Select",
  "Fn::FindInMap",
  "Fn::GetAZs",
  "Fn::ImportValue",
]);
type CloudFormationIntrinsicName = z.output<typeof intrinsicNameSchema>;
type CloudFormationValueType =
  "string" | "number" | "integer" | "boolean" | "object" | "array";

interface CloudFormationPropertyAuthorityV1 {
  allowedIntrinsicFunctions: CloudFormationIntrinsicName[];
  allowedStringValues?: string[] | undefined;
  itemType?: Exclude<CloudFormationValueType, "array"> | undefined;
  maximum?: number | undefined;
  maximumItems?: number | undefined;
  maximumLength?: number | undefined;
  minimum?: number | undefined;
  minimumItems?: number | undefined;
  minimumLength?: number | undefined;
  name: string;
  pattern?: string | undefined;
  properties?: CloudFormationPropertyAuthorityV1[] | undefined;
  required: boolean;
  secretHandling: "not-secret" | "reference-only" | "forbidden";
  valueType: CloudFormationValueType;
}

const cloudFormationPropertyAuthorityV1Schema: z.ZodType<CloudFormationPropertyAuthorityV1> =
  z.lazy(() =>
    z
      .object({
        allowedIntrinsicFunctions: z.array(intrinsicNameSchema).max(16),
        allowedStringValues: z.array(z.string().max(1_000)).max(256).optional(),
        itemType: z
          .enum(["string", "number", "integer", "boolean", "object"])
          .optional(),
        maximum: z.number().optional(),
        maximumItems: z.number().int().nonnegative().max(10_000).optional(),
        maximumLength: z.number().int().nonnegative().max(1_000_000).optional(),
        minimum: z.number().optional(),
        minimumItems: z.number().int().nonnegative().max(10_000).optional(),
        minimumLength: z.number().int().nonnegative().max(1_000_000).optional(),
        name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,127}$/u),
        pattern: z
          .string()
          .min(1)
          .max(256)
          .refine((pattern) => {
            try {
              new RegExp(pattern, "u");
              return true;
            } catch {
              return false;
            }
          }, "CloudFormation property patterns must be valid Unicode regular expressions.")
          .optional(),
        properties: z
          .array(cloudFormationPropertyAuthorityV1Schema)
          .max(256)
          .optional(),
        required: z.boolean(),
        secretHandling: z.enum(["not-secret", "reference-only", "forbidden"]),
        valueType: z.enum([
          "string",
          "number",
          "integer",
          "boolean",
          "object",
          "array",
        ]),
      })
      .strict()
      .superRefine((value, context) => {
        const modelsObject =
          value.valueType === "object" ||
          (value.valueType === "array" && value.itemType === "object");
        if (value.valueType === "array" && value.itemType === undefined) {
          context.addIssue({
            code: "custom",
            message: "Array property authorities require an exact item type.",
            path: ["itemType"],
          });
        }
        if (value.valueType !== "array" && value.itemType !== undefined) {
          context.addIssue({
            code: "custom",
            message:
              "Only array property authorities may declare an item type.",
            path: ["itemType"],
          });
        }
        if (modelsObject !== (value.properties !== undefined)) {
          context.addIssue({
            code: "custom",
            message:
              "Object values and object array items require a complete nested property list; other values cannot declare one.",
            path: ["properties"],
          });
        }
        const propertyNames = new Set<string>();
        value.properties?.forEach((property, index) => {
          if (propertyNames.has(property.name)) {
            context.addIssue({
              code: "custom",
              message: "Nested CloudFormation properties must be unique.",
              path: ["properties", index, "name"],
            });
          }
          propertyNames.add(property.name);
        });
        const stringConstrained =
          value.allowedStringValues !== undefined ||
          value.pattern !== undefined ||
          value.minimumLength !== undefined ||
          value.maximumLength !== undefined;
        if (stringConstrained && value.valueType !== "string") {
          context.addIssue({
            code: "custom",
            message: "String constraints require a string property.",
            path: ["valueType"],
          });
        }
        const numberConstrained =
          value.minimum !== undefined || value.maximum !== undefined;
        if (
          numberConstrained &&
          value.valueType !== "number" &&
          value.valueType !== "integer"
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Numeric constraints require a number or integer property.",
            path: ["valueType"],
          });
        }
        const itemConstrained =
          value.minimumItems !== undefined || value.maximumItems !== undefined;
        if (itemConstrained && value.valueType !== "array") {
          context.addIssue({
            code: "custom",
            message: "Item-count constraints require an array property.",
            path: ["valueType"],
          });
        }
        if (
          (value.minimum !== undefined &&
            value.maximum !== undefined &&
            value.minimum > value.maximum) ||
          (value.minimumLength !== undefined &&
            value.maximumLength !== undefined &&
            value.minimumLength > value.maximumLength) ||
          (value.minimumItems !== undefined &&
            value.maximumItems !== undefined &&
            value.minimumItems > value.maximumItems)
        ) {
          context.addIssue({
            code: "custom",
            message: "CloudFormation property minimums cannot exceed maximums.",
          });
        }
      }),
  );

const cloudFormationResourceAuthorityV1Schema = z
  .object({
    catalogResourceType: namespacedIdentifierSchema,
    properties: z.array(cloudFormationPropertyAuthorityV1Schema).max(256),
    providerId: namespacedIdentifierSchema,
    resourceType: cloudFormationResourceTypeSchema,
    schemaDigest: sha256DigestSchema,
    schemaId: namespacedIdentifierSchema,
    schemaVersion: semanticVersionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const names = new Set<string>();
    value.properties.forEach((property, index) => {
      if (names.has(property.name)) {
        context.addIssue({
          code: "custom",
          message: "CloudFormation property authorities must be unique.",
          path: ["properties", index, "name"],
        });
      }
      names.add(property.name);
    });
  });

export function getCloudFormationReviewedSchemaDocument(
  authorityInput: z.output<typeof cloudFormationResourceAuthorityV1Schema>,
): string {
  const authority =
    cloudFormationResourceAuthorityV1Schema.parse(authorityInput);
  return serializeCanonicalJson({
    catalogResourceType: authority.catalogResourceType,
    properties: authority.properties,
    providerId: authority.providerId,
    resourceType: authority.resourceType,
  });
}

export const cloudFormationExtensionValidationPolicyV1Schema = z
  .object({
    allowedConditionReferences: z.array(cloudFormationLogicalIdSchema).max(256),
    allowedParameterReferences: z.array(cloudFormationLogicalIdSchema).max(256),
    allowedPaths: z.array(safeRelativePathSchema).min(1).max(1_000),
    allowedSecretReferenceIds: z.array(cloudFormationLogicalIdSchema).max(256),
    contractVersion: z.literal(1),
    extensionId: solutionStableIdSchema,
    limits: z
      .object({
        maximumDepth: z.number().int().positive().max(128),
        maximumFileBytes: z
          .number()
          .int()
          .positive()
          .max(4 * 1024 * 1024),
        maximumFiles: z.number().int().positive().max(1_000),
        maximumNodes: z.number().int().positive().max(100_000),
        maximumResources: z.number().int().positive().max(10_000),
        maximumTotalBytes: z
          .number()
          .int()
          .positive()
          .max(64 * 1024 * 1024),
      })
      .strict(),
    parser: z
      .object({
        digest: sha256DigestSchema,
        id: namespacedIdentifierSchema,
        version: semanticVersionSchema,
      })
      .strict(),
    policy: z
      .object({
        allowIamPolicyResources: z.boolean(),
        allowWildcardIamActions: z.boolean(),
        allowWildcardIamResources: z.boolean(),
      })
      .strict(),
    protectedLogicalIds: z.array(cloudFormationLogicalIdSchema).max(10_000),
    resourceAuthorities: z
      .array(cloudFormationResourceAuthorityV1Schema)
      .min(1)
      .max(1_000),
    slotId: namespacedIdentifierSchema,
    targetReadiness: z.enum(["supported", "pending", "unsupported"]),
  })
  .strict()
  .superRefine((value, context) => {
    const paths = new Set<string>();
    value.allowedPaths.forEach((path, index) => {
      const key = portablePathKey(path);
      if (paths.has(key)) {
        context.addIssue({
          code: "custom",
          message: "CloudFormation extension paths must be portably unique.",
          path: ["allowedPaths", index],
        });
      }
      paths.add(key);
    });
    const protectedIds = new Set<string>();
    value.protectedLogicalIds.forEach((logicalId, index) => {
      if (protectedIds.has(logicalId)) {
        context.addIssue({
          code: "custom",
          message: "Protected CloudFormation logical IDs must be unique.",
          path: ["protectedLogicalIds", index],
        });
      }
      protectedIds.add(logicalId);
    });
    const resourceTypes = new Set<string>();
    const schemaIdentities = new Set<string>();
    value.resourceAuthorities.forEach((authority, index) => {
      const key = authority.resourceType;
      if (resourceTypes.has(key)) {
        context.addIssue({
          code: "custom",
          message: "CloudFormation resource authorities must be unique.",
          path: ["resourceAuthorities", index, "resourceType"],
        });
      }
      resourceTypes.add(key);
      const schemaKey = [authority.schemaId, authority.schemaVersion].join(
        "\u0000",
      );
      if (schemaIdentities.has(schemaKey)) {
        context.addIssue({
          code: "custom",
          message: "CloudFormation reviewed schema identities must be unique.",
          path: ["resourceAuthorities", index, "schemaId"],
        });
      }
      schemaIdentities.add(schemaKey);
    });
  });

export const cloudFormationExtensionValidationRequestV1Schema = z
  .object({
    assessedAt: utcTimestampSchema,
    candidateArtifactDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    files: z
      .array(
        z
          .object({
            content: z.string().max(4 * 1024 * 1024),
            digest: sha256DigestSchema,
            path: safeRelativePathSchema,
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
    model: z
      .object({
        modelId: namespacedIdentifierSchema,
        modelVersion: z.string().min(1).max(128),
        promptVersion: semanticVersionSchema,
        providerId: namespacedIdentifierSchema,
      })
      .strict(),
    policy: cloudFormationExtensionValidationPolicyV1Schema,
    solutionRevisionDigest: sha256DigestSchema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict();

export const cloudFormationStructuredResourceV1Schema = z
  .object({
    logicalId: cloudFormationLogicalIdSchema,
    path: safeRelativePathSchema,
    propertyNames: z.array(z.string().min(1).max(128)).max(256),
    references: z.array(z.string().min(1).max(256)).max(1_000),
    resourceType: cloudFormationResourceTypeSchema,
  })
  .strict();

const cloudFormationExtensionValidationResultBaseV1Schema = z
  .object({
    contractVersion: z.literal(1),
    diagnostics: z.array(candidateDiagnosticV1Schema).max(1_000),
    evidence: evidenceRecordV1Schema,
    reportDigest: sha256DigestSchema,
    resources: z.array(cloudFormationStructuredResourceV1Schema).max(10_000),
    state: z.enum(["passed", "failed", "error"]),
  })
  .strict();

export type CloudFormationExtensionValidationResultV1 = z.output<
  typeof cloudFormationExtensionValidationResultBaseV1Schema
>;

export function getCloudFormationValidationReportDigest(
  input:
    | CloudFormationExtensionValidationResultV1
    | Omit<CloudFormationExtensionValidationResultV1, "reportDigest">,
): Sha256Digest {
  const projection = {
    ...input,
  } as Partial<CloudFormationExtensionValidationResultV1>;
  delete projection.reportDigest;
  return digestCanonicalValue(projection);
}

export const cloudFormationExtensionValidationResultV1Schema =
  cloudFormationExtensionValidationResultBaseV1Schema.superRefine(
    (value, context) => {
      if (
        getCloudFormationValidationReportDigest(value) !== value.reportDigest
      ) {
        context.addIssue({
          code: "custom",
          message: "CloudFormation report digest must hash the exact result.",
          path: ["reportDigest"],
        });
      }
      const hasErrors = value.diagnostics.some(
        ({ severity }) => severity === "error",
      );
      if ((value.state === "passed") === hasErrors) {
        context.addIssue({
          code: "custom",
          message:
            "CloudFormation state must reflect deterministic diagnostics.",
          path: ["state"],
        });
      }
      if (
        value.state === "passed" &&
        value.evidence.checks.some(({ status }) => status !== "passed")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Passing CloudFormation validation requires passing Evidence checks.",
          path: ["evidence", "checks"],
        });
      }
    },
  );

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(input: {
  readonly category: CandidateDiagnosticV1["category"];
  readonly code: string;
  readonly detail: string;
  readonly path?: string;
  readonly repairable: boolean;
  readonly severity?: CandidateDiagnosticV1["severity"];
  readonly summary: string;
}): CandidateDiagnosticV1 {
  return candidateDiagnosticV1Schema.parse({
    category: input.category,
    checkId: `cloudmarkup.ai-extension.cloudformation-${input.category}`,
    code: input.code,
    ...(input.path === undefined ? {} : { path: input.path }),
    repairable: input.repairable,
    severity: input.severity ?? "error",
    summary: input.summary,
    technicalDetail: input.detail,
  });
}

function parseStructuredFile(
  path: string,
  content: string,
): { readonly value?: unknown; readonly diagnostic?: CandidateDiagnosticV1 } {
  try {
    let strictJson: unknown;
    if (path.endsWith(".json")) strictJson = JSON.parse(content) as unknown;
    const documents = parseAllDocuments(content, {
      schema: "core",
      uniqueKeys: true,
    });
    if (documents.length !== 1 || documents[0] === undefined) {
      throw new Error("parse");
    }
    const document = documents[0];
    const forbiddenYamlFeatures = new Set<"alias-or-anchor" | "tag">();
    visit(document, {
      Node(_key, node) {
        if (
          isAlias(node) ||
          ("anchor" in node &&
            typeof node.anchor === "string" &&
            node.anchor.length > 0)
        ) {
          forbiddenYamlFeatures.add("alias-or-anchor");
        }
        if (!isAlias(node) && node.tag !== undefined) {
          forbiddenYamlFeatures.add("tag");
        }
      },
    });
    if (forbiddenYamlFeatures.has("alias-or-anchor")) {
      return {
        diagnostic: diagnostic({
          category: "parse",
          code: "cloudmarkup.ai-extension.cloudformation-yaml-alias-denied",
          detail:
            "YAML anchors and aliases are outside the approved extension grammar.",
          path,
          repairable: true,
          summary: "CloudFormation YAML contains an anchor or alias.",
        }),
      };
    }
    if (forbiddenYamlFeatures.has("tag")) {
      return {
        diagnostic: diagnostic({
          category: "parse",
          code: "cloudmarkup.ai-extension.cloudformation-yaml-tag-denied",
          detail:
            "All explicit YAML tags, including short-form intrinsics and standard tags, are denied; use ordinary values and long-form intrinsic objects.",
          path,
          repairable: true,
          summary: "CloudFormation YAML contains an unapproved tag.",
        }),
      };
    }
    if (document.errors.length > 0 || document.warnings.length > 0) {
      throw new Error("parse");
    }
    const value = document.toJS({ maxAliasCount: 0 }) as unknown;
    if (
      path.endsWith(".json") &&
      digestCanonicalValue(value) !== digestCanonicalValue(strictJson)
    ) {
      throw new Error("json-mismatch");
    }
    return { value };
  } catch {
    return {
      diagnostic: diagnostic({
        category: "parse",
        code: "cloudmarkup.ai-extension.cloudformation-parse-failed",
        detail:
          "The candidate is not one strict duplicate-free JSON/YAML document.",
        path,
        repairable: true,
        summary: "CloudFormation candidate could not be parsed safely.",
      }),
    };
  }
}

function countNodes(
  value: unknown,
  maximumDepth: number,
  maximumNodes: number,
): void {
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maximumNodes || depth > maximumDepth) {
      throw new Error("CloudFormation candidate exceeds structural limits.");
    }
    if (Array.isArray(current)) {
      current.forEach((entry) => {
        visit(entry, depth + 1);
      });
    } else if (isObject(current)) {
      Object.values(current).forEach((entry) => {
        visit(entry, depth + 1);
      });
    }
  };
  visit(value, 0);
}

const intrinsicNames = new Set([
  "Ref",
  "Fn::GetAtt",
  "Fn::Join",
  "Fn::Sub",
  "Fn::If",
  "Fn::Select",
  "Fn::FindInMap",
  "Fn::GetAZs",
  "Fn::ImportValue",
]);
const pseudoParameters = new Set([
  "AWS::AccountId",
  "AWS::NotificationARNs",
  "AWS::NoValue",
  "AWS::Partition",
  "AWS::Region",
  "AWS::StackId",
  "AWS::StackName",
  "AWS::URLSuffix",
]);

function valueMatchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

interface ReferenceCollector {
  readonly conditions: Set<string>;
  readonly references: Set<string>;
}

const getAttAttributeSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9.:_-]{0,255}$/u);
const subVariableSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,254}$/u);

function collectSubTemplateReferences(
  template: string,
  variableNames: ReadonlySet<string>,
  collector: ReferenceCollector,
): void {
  let offset = 0;
  for (;;) {
    const opening = template.indexOf("${", offset);
    if (opening === -1) return;
    const closing = template.indexOf("}", opening + 2);
    if (closing === -1) {
      throw new Error("Fn::Sub contains an unterminated placeholder.");
    }
    const expression = template.slice(opening + 2, closing);
    const separator = expression.indexOf(".");
    const logicalId =
      separator === -1 ? expression : expression.slice(0, separator);
    const attribute =
      separator === -1 ? undefined : expression.slice(separator + 1);
    if (
      (!cloudFormationLogicalIdSchema.safeParse(logicalId).success &&
        !pseudoParameters.has(logicalId)) ||
      (pseudoParameters.has(logicalId) && attribute !== undefined) ||
      (attribute !== undefined &&
        !getAttAttributeSchema.safeParse(attribute).success)
    ) {
      throw new Error("Fn::Sub contains an invalid reference placeholder.");
    }
    if (!variableNames.has(expression)) collector.references.add(logicalId);
    offset = closing + 1;
  }
}

function inspectIntrinsic(
  value: unknown,
  allowedIntrinsics: ReadonlySet<string>,
  collector: ReferenceCollector,
): boolean {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  const intrinsicKey = keys.find(
    (key) => key === "Ref" || key.startsWith("Fn::"),
  );
  if (intrinsicKey === undefined) return false;
  if (
    keys.length !== 1 ||
    !intrinsicNames.has(intrinsicKey) ||
    !allowedIntrinsics.has(intrinsicKey)
  ) {
    throw new Error(
      "Intrinsic function is unknown or not approved for this property.",
    );
  }
  const argument = value[intrinsicKey];
  switch (intrinsicKey) {
    case "Ref":
      if (typeof argument !== "string")
        throw new Error("Ref requires one string.");
      collector.references.add(argument);
      break;
    case "Fn::GetAtt": {
      if (typeof argument === "string") {
        const separator = argument.indexOf(".");
        const logicalId = argument.slice(0, separator);
        const attribute = argument.slice(separator + 1);
        if (
          separator <= 0 ||
          !cloudFormationLogicalIdSchema.safeParse(logicalId).success ||
          !getAttAttributeSchema.safeParse(attribute).success
        )
          throw new Error("Fn::GetAtt is invalid.");
        collector.references.add(logicalId);
      } else if (
        Array.isArray(argument) &&
        argument.length === 2 &&
        typeof argument[0] === "string" &&
        typeof argument[1] === "string" &&
        cloudFormationLogicalIdSchema.safeParse(argument[0]).success &&
        getAttAttributeSchema.safeParse(argument[1]).success
      ) {
        collector.references.add(argument[0]);
      } else {
        throw new Error("Fn::GetAtt requires a logical ID and attribute.");
      }
      break;
    }
    case "Fn::Join":
      if (
        !Array.isArray(argument) ||
        argument.length !== 2 ||
        typeof argument[0] !== "string" ||
        !Array.isArray(argument[1])
      ) {
        throw new Error("Fn::Join requires a delimiter and value array.");
      }
      argument[1].forEach((entry) => {
        inspectValue(entry, allowedIntrinsics, collector);
      });
      break;
    case "Fn::Sub":
      if (typeof argument === "string") {
        collectSubTemplateReferences(argument, new Set(), collector);
      } else if (
        Array.isArray(argument) &&
        argument.length === 2 &&
        typeof argument[0] === "string" &&
        isObject(argument[1])
      ) {
        const variables = new Set(Object.keys(argument[1]));
        if (
          [...variables].some(
            (variable) => !subVariableSchema.safeParse(variable).success,
          )
        ) {
          throw new Error("Fn::Sub variable names must be exact identifiers.");
        }
        collectSubTemplateReferences(argument[0], variables, collector);
        Object.values(argument[1]).forEach((entry) => {
          if (
            typeof entry !== "string" &&
            typeof entry !== "number" &&
            typeof entry !== "boolean" &&
            !inspectIntrinsic(entry, allowedIntrinsics, collector)
          ) {
            throw new Error(
              "Fn::Sub variable values must be scalar values or approved intrinsic expressions.",
            );
          }
        });
      } else {
        throw new Error(
          "Fn::Sub requires a template string and optional variable map.",
        );
      }
      break;
    case "Fn::If":
      if (
        !Array.isArray(argument) ||
        argument.length !== 3 ||
        typeof argument[0] !== "string"
      ) {
        throw new Error("Fn::If requires a condition and two branches.");
      }
      collector.conditions.add(argument[0]);
      inspectValue(argument[1], allowedIntrinsics, collector);
      inspectValue(argument[2], allowedIntrinsics, collector);
      break;
    case "Fn::Select":
      if (!Array.isArray(argument) || argument.length !== 2)
        throw new Error("Fn::Select requires index and list arguments.");
      inspectValue(argument[0], allowedIntrinsics, collector);
      inspectValue(argument[1], allowedIntrinsics, collector);
      break;
    case "Fn::FindInMap":
      throw new Error(
        "Fn::FindInMap is outside resource-only extension authority because mappings are not admitted.",
      );
    case "Fn::GetAZs":
      if (typeof argument !== "string" && !isObject(argument))
        throw new Error("Fn::GetAZs requires a Region expression.");
      if (isObject(argument))
        inspectValue(argument, allowedIntrinsics, collector);
      break;
    case "Fn::ImportValue":
      throw new Error(
        "Fn::ImportValue is outside the bounded extension reference authority.",
      );
  }
  return true;
}

function inspectValue(
  value: unknown,
  allowedIntrinsics: ReadonlySet<string>,
  collector: ReferenceCollector,
): void {
  if (inspectIntrinsic(value, allowedIntrinsics, collector)) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      inspectValue(entry, allowedIntrinsics, collector);
    });
  } else if (isObject(value)) {
    Object.values(value).forEach((entry) => {
      inspectValue(entry, allowedIntrinsics, collector);
    });
  }
}

function validateObjectProperties(
  value: unknown,
  properties: readonly CloudFormationPropertyAuthorityV1[],
  allowedSecretReferenceIds: ReadonlySet<string>,
  collector: ReferenceCollector,
): void {
  if (!isObject(value)) {
    throw new Error("Object property does not match its reviewed type.");
  }
  const propertyByName = new Map(
    properties.map((property) => [property.name, property]),
  );
  for (const property of properties) {
    if (property.required && !(property.name in value)) {
      throw new Error(
        "Nested object is missing required property " + property.name + ".",
      );
    }
  }
  for (const [name, nestedValue] of Object.entries(value)) {
    const property = propertyByName.get(name);
    if (property === undefined) {
      throw new Error("Nested object contains unknown property " + name + ".");
    }
    validatePropertyValue(
      nestedValue,
      property,
      allowedSecretReferenceIds,
      collector,
    );
  }
}

function validatePropertyValue(
  value: unknown,
  property: CloudFormationPropertyAuthorityV1,
  allowedSecretReferenceIds: ReadonlySet<string>,
  collector: ReferenceCollector,
): void {
  const allowedIntrinsics = new Set(property.allowedIntrinsicFunctions);
  const isIntrinsic = inspectIntrinsic(value, allowedIntrinsics, collector);
  if (property.secretHandling === "forbidden") {
    throw new Error("This property is forbidden by secret-handling policy.");
  }
  if (property.secretHandling === "reference-only") {
    if (
      !isObject(value) ||
      Object.keys(value).length !== 1 ||
      typeof value["Ref"] !== "string" ||
      !allowedSecretReferenceIds.has(value["Ref"])
    ) {
      throw new Error(
        "Secret-bearing properties require an approved secret reference, never a value.",
      );
    }
    return;
  }
  if (isIntrinsic) return;
  if (!valueMatchesType(value, property.valueType)) {
    throw new Error("Property value does not match its exact reviewed type.");
  }
  if (typeof value === "string") {
    if (
      property.allowedStringValues !== undefined &&
      !property.allowedStringValues.includes(value)
    ) {
      throw new Error("Property string is outside its exact reviewed values.");
    }
    if (
      property.minimumLength !== undefined &&
      value.length < property.minimumLength
    ) {
      throw new Error("Property string is shorter than its reviewed minimum.");
    }
    if (
      property.maximumLength !== undefined &&
      value.length > property.maximumLength
    ) {
      throw new Error("Property string is longer than its reviewed maximum.");
    }
    if (
      property.pattern !== undefined &&
      !new RegExp(property.pattern, "u").test(value)
    ) {
      throw new Error("Property string does not match its reviewed pattern.");
    }
  }
  if (typeof value === "number") {
    if (property.minimum !== undefined && value < property.minimum) {
      throw new Error("Property number is below its reviewed minimum.");
    }
    if (property.maximum !== undefined && value > property.maximum) {
      throw new Error("Property number is above its reviewed maximum.");
    }
  }
  if (Array.isArray(value)) {
    if (
      property.minimumItems !== undefined &&
      value.length < property.minimumItems
    ) {
      throw new Error("Property array has fewer than its reviewed items.");
    }
    if (
      property.maximumItems !== undefined &&
      value.length > property.maximumItems
    ) {
      throw new Error("Property array has more than its reviewed items.");
    }
    for (const entry of value) {
      if (inspectIntrinsic(entry, allowedIntrinsics, collector)) continue;
      if (!valueMatchesType(entry, property.itemType ?? "")) {
        throw new Error("Array item does not match its exact reviewed type.");
      }
      if (property.itemType === "object") {
        validateObjectProperties(
          entry,
          property.properties ?? [],
          allowedSecretReferenceIds,
          collector,
        );
      }
    }
  } else if (isObject(value)) {
    validateObjectProperties(
      value,
      property.properties ?? [],
      allowedSecretReferenceIds,
      collector,
    );
  }
}

function containsWildcardString(value: unknown): boolean {
  if (typeof value === "string") return value.includes("*");
  if (Array.isArray(value)) return value.some(containsWildcardString);
  if (!isObject(value)) return false;
  return Object.values(value).some(containsWildcardString);
}

function containsWildcardPolicy(
  value: unknown,
  key: "Action" | "Resource",
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsWildcardPolicy(entry, key));
  }
  if (!isObject(value)) return false;
  for (const [propertyName, propertyValue] of Object.entries(value)) {
    if (
      (propertyName === key || propertyName === "Not" + key) &&
      containsWildcardString(propertyValue)
    ) {
      return true;
    }
    if (containsWildcardPolicy(propertyValue, key)) return true;
  }
  return false;
}

function hasReferenceCycle(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const target of edges.get(id) ?? []) {
      if (edges.has(target) && visit(target)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...edges.keys()].some(visit);
}

function makeEvidence(input: {
  readonly request: z.output<
    typeof cloudFormationExtensionValidationRequestV1Schema
  >;
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly totalBytes: number;
}): EvidenceRecordV1 {
  const status = (
    category: CandidateDiagnosticV1["category"],
  ): "passed" | "failed" =>
    input.diagnostics.some(
      (entry) => entry.category === category && entry.severity === "error",
    )
      ? "failed"
      : "passed";
  const checks = [
    ["admission", "cloudmarkup.ai-extension.cloudformation-admission"],
    ["ownership", "cloudmarkup.ai-extension.cloudformation-ownership"],
    ["parse", "cloudmarkup.ai-extension.cloudformation-parse"],
    ["static-analysis", "cloudmarkup.ai-extension.cloudformation-schema"],
    ["provenance", "cloudmarkup.ai-extension.cloudformation-references"],
    ["security", "cloudmarkup.ai-extension.cloudformation-security"],
    ["target-readiness", "cloudmarkup.ai-extension.cloudformation-readiness"],
  ] as const;
  const schemaDigests = input.request.policy.resourceAuthorities.map(
    ({ schemaDigest }) => schemaDigest,
  );
  const evidenceInput = {
    artifact: input.request.candidateArtifactDigest,
    checks: checks.map(([category, checkId]) => ({
      checkId,
      status: status(category),
    })),
    extensionId: input.request.policy.extensionId,
    schemaDigests,
    slotId: input.request.policy.slotId,
    solutionRevisionDigest: input.request.solutionRevisionDigest,
  };
  return evidenceRecordV1Schema.parse({
    artifacts: [
      {
        digest: input.request.candidateArtifactDigest,
        mediaType: "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
        sizeBytes: input.totalBytes,
      },
    ],
    checks: checks.map(([category, checkId]) => ({
      artifactDigests: [input.request.candidateArtifactDigest],
      checkId,
      generationCoverageRequirement:
        category === "static-analysis"
          ? "ai-extension-parse-static-validity"
          : undefined,
      issueIds: [],
      ...(status(category) === "failed"
        ? {
            redactedFailure:
              "The bounded candidate did not satisfy this deterministic check.",
          }
        : {}),
      status: status(category),
      summary:
        status(category) === "passed"
          ? "The bounded CloudFormation extension check passed."
          : "The bounded CloudFormation extension check failed.",
    })),
    contractVersion: 1,
    environment: { environmentType: "unknown" },
    id: stableRecordId("evidence-ai-cfn", evidenceInput),
    layer: "generated",
    level: { kind: "ai-extension-parse-static-validity", rank: 4 },
    models: [input.request.model],
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: {
          id: AI_EXTENSION_GENERATION_COORDINATOR_ID,
          version: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
        },
      },
      createdAt: input.request.assessedAt,
      inputDigests: [
        input.request.candidateArtifactDigest,
        input.request.solutionRevisionDigest,
        input.request.policy.parser.digest,
        ...schemaDigests,
      ],
    },
    solutionRevisionId: input.request.solutionRevisionId,
    staleness: { assessedAt: input.request.assessedAt, state: "current" },
    tools: [
      {
        digest: input.request.policy.parser.digest,
        id: input.request.policy.parser.id,
        version: input.request.policy.parser.version,
      },
      {
        id: AI_EXTENSION_GENERATION_COORDINATOR_ID,
        version: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
      },
    ],
  });
}

export function validateCloudFormationExtension(
  input: unknown,
): CloudFormationExtensionValidationResultV1 {
  const request = cloudFormationExtensionValidationRequestV1Schema.parse(input);
  const diagnostics: CandidateDiagnosticV1[] = [];
  const resources: z.output<typeof cloudFormationStructuredResourceV1Schema>[] =
    [];
  const allowedPaths = new Set(request.policy.allowedPaths);
  const authorityByType = new Map(
    request.policy.resourceAuthorities.map((authority) => [
      authority.resourceType,
      authority,
    ]),
  );
  const protectedIds = new Set(request.policy.protectedLogicalIds);
  const logicalIds = new Set<string>();
  const referenceEdges = new Map<string, Set<string>>();
  let totalBytes = 0;
  let resourceDeclarationCount = 0;

  if (request.files.length > request.policy.limits.maximumFiles) {
    diagnostics.push(
      diagnostic({
        category: "admission",
        code: "cloudmarkup.ai-extension.cloudformation-file-count-exceeded",
        detail:
          "CloudFormation file count exceeds the exact configured maximum.",
        repairable: true,
        summary: "CloudFormation candidate contains too many files.",
      }),
    );
  }
  if (request.policy.targetReadiness !== "supported") {
    diagnostics.push(
      diagnostic({
        category: "target-readiness",
        code: "cloudmarkup.ai-extension.cloudformation-target-not-supported",
        detail: "The exact target readiness authority is not supported.",
        repairable: false,
        summary: "CloudFormation extension target is not ready for acceptance.",
      }),
    );
  }

  for (const file of request.files) {
    let path: string;
    try {
      path = validatePortableCandidatePath(file.path);
    } catch {
      diagnostics.push(
        diagnostic({
          category: "ownership",
          code: "cloudmarkup.ai-extension.cloudformation-path-invalid",
          detail: "CloudFormation file path is invalid or non-portable.",
          repairable: true,
          summary: "CloudFormation candidate path is invalid.",
        }),
      );
      continue;
    }
    const bytes = utf8ByteLength(file.content);
    totalBytes += bytes;
    if (
      !allowedPaths.has(path) ||
      (!path.endsWith(".yaml") &&
        !path.endsWith(".yml") &&
        !path.endsWith(".json"))
    ) {
      diagnostics.push(
        diagnostic({
          category: "ownership",
          code: "cloudmarkup.ai-extension.cloudformation-path-not-approved",
          detail:
            "CloudFormation file is outside the exact extension slot or has an unsupported extension.",
          path,
          repairable: false,
          summary: "CloudFormation file path is not approved.",
        }),
      );
      continue;
    }
    if (
      bytes > request.policy.limits.maximumFileBytes ||
      sha256Text(file.content) !== file.digest
    ) {
      diagnostics.push(
        diagnostic({
          category: "admission",
          code: "cloudmarkup.ai-extension.cloudformation-content-boundary-invalid",
          detail:
            "CloudFormation file exceeds its limit or does not match its exact digest.",
          path,
          repairable: true,
          summary: "CloudFormation content boundary was rejected.",
        }),
      );
      continue;
    }
    const safety = candidateContentSafetyDiagnostics(
      file.content,
      "cloudformation",
    );
    if (safety.length > 0) {
      diagnostics.push(
        diagnostic({
          category: "security",
          code: "cloudmarkup.ai-extension.cloudformation-content-unsafe",
          detail: safety[0] ?? "CloudFormation content is unsafe.",
          path,
          repairable: true,
          summary: "CloudFormation candidate contains unsafe content.",
        }),
      );
      continue;
    }
    const parsed = parseStructuredFile(path, file.content);
    if (parsed.diagnostic !== undefined) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }
    try {
      countNodes(
        parsed.value,
        request.policy.limits.maximumDepth,
        request.policy.limits.maximumNodes,
      );
    } catch {
      diagnostics.push(
        diagnostic({
          category: "admission",
          code: "cloudmarkup.ai-extension.cloudformation-structure-limit",
          detail:
            "CloudFormation structure exceeds exact depth or node limits.",
          path,
          repairable: true,
          summary: "CloudFormation structure is too large.",
        }),
      );
      continue;
    }
    if (!isObject(parsed.value)) {
      diagnostics.push(
        diagnostic({
          category: "parse",
          code: "cloudmarkup.ai-extension.cloudformation-root-invalid",
          detail:
            "CloudFormation extension must be an object with exactly a Resources section.",
          path,
          repairable: true,
          summary: "CloudFormation root structure is invalid.",
        }),
      );
      continue;
    }
    const topLevelKeys = Object.keys(parsed.value);
    if (
      topLevelKeys.some((key) => key !== "Resources") ||
      !isObject(parsed.value["Resources"])
    ) {
      diagnostics.push(
        diagnostic({
          category: "static-analysis",
          code: "cloudmarkup.ai-extension.cloudformation-top-level-denied",
          detail:
            "Extension files may contain only a Resources object; transforms, macros, parameters, outputs, and template authority are denied.",
          path,
          repairable: true,
          summary:
            "CloudFormation extension uses unapproved top-level sections.",
        }),
      );
      continue;
    }
    const resourceEntries = Object.entries(parsed.value["Resources"]);
    resourceDeclarationCount += resourceEntries.length;
    for (const [logicalId, rawResource] of resourceEntries) {
      if (
        !cloudFormationLogicalIdSchema.safeParse(logicalId).success ||
        !isObject(rawResource)
      ) {
        diagnostics.push(
          diagnostic({
            category: "static-analysis",
            code: "cloudmarkup.ai-extension.cloudformation-resource-invalid",
            detail:
              "CloudFormation resources require a valid logical ID and object body.",
            path,
            repairable: true,
            summary: "CloudFormation resource declaration is invalid.",
          }),
        );
        continue;
      }
      const logicalKey = logicalId.toLowerCase();
      if (
        [...logicalIds].some((id) => id.toLowerCase() === logicalKey) ||
        protectedIds.has(logicalId)
      ) {
        diagnostics.push(
          diagnostic({
            category: "ownership",
            code: "cloudmarkup.ai-extension.cloudformation-logical-id-collision",
            detail:
              "Resource logical ID collides with another candidate or protected deterministic resource.",
            path,
            repairable: false,
            summary: "CloudFormation resource shadows an existing resource.",
          }),
        );
        continue;
      }
      logicalIds.add(logicalId);
      const allowedResourceKeys = new Set([
        "Type",
        "Properties",
        "DependsOn",
        "Condition",
      ]);
      if (
        Object.keys(rawResource).some((key) => !allowedResourceKeys.has(key))
      ) {
        diagnostics.push(
          diagnostic({
            category: "static-analysis",
            code: "cloudmarkup.ai-extension.cloudformation-resource-field-unknown",
            detail:
              "Resource contains a field outside the approved extension grammar.",
            path,
            repairable: true,
            summary: "CloudFormation resource contains an unknown field.",
          }),
        );
      }
      const resourceType = rawResource["Type"];
      if (typeof resourceType !== "string") {
        diagnostics.push(
          diagnostic({
            category: "static-analysis",
            code: "cloudmarkup.ai-extension.cloudformation-resource-type-missing",
            detail: "Resource Type must be an exact string.",
            path,
            repairable: true,
            summary: "CloudFormation resource type is missing.",
          }),
        );
        continue;
      }
      if (
        resourceType.startsWith("Custom::") ||
        resourceType === "AWS::CloudFormation::CustomResource" ||
        resourceType === "AWS::CloudFormation::Macro"
      ) {
        diagnostics.push(
          diagnostic({
            category: "security",
            code: "cloudmarkup.ai-extension.cloudformation-custom-resource-denied",
            detail:
              "Custom resources and macros can execute unreviewed handlers and are denied.",
            path,
            repairable: false,
            summary: "CloudFormation custom execution authority was rejected.",
          }),
        );
        continue;
      }
      const authority = authorityByType.get(resourceType);
      if (authority === undefined) {
        diagnostics.push(
          diagnostic({
            category: "static-analysis",
            code: "cloudmarkup.ai-extension.cloudformation-resource-type-not-approved",
            detail:
              "Resource type is absent from the exact reviewed schema allowlist.",
            path,
            repairable: true,
            summary: "CloudFormation resource type is not approved.",
          }),
        );
        continue;
      }
      if (
        resourceType.startsWith("AWS::IAM::") &&
        !request.policy.policy.allowIamPolicyResources
      ) {
        diagnostics.push(
          diagnostic({
            category: "security",
            code: "cloudmarkup.ai-extension.cloudformation-iam-resource-denied",
            detail:
              "IAM resource creation is not enabled by the reviewed extension policy.",
            path,
            repairable: false,
            summary: "CloudFormation IAM resource is not approved.",
          }),
        );
      }
      const properties = rawResource["Properties"] ?? {};
      if (!isObject(properties)) {
        diagnostics.push(
          diagnostic({
            category: "static-analysis",
            code: "cloudmarkup.ai-extension.cloudformation-properties-invalid",
            detail: "Resource Properties must be an object.",
            path,
            repairable: true,
            summary: "CloudFormation resource properties are invalid.",
          }),
        );
        continue;
      }
      const propertyByName = new Map(
        authority.properties.map((property) => [property.name, property]),
      );
      for (const required of authority.properties.filter(
        ({ required }) => required,
      )) {
        if (!(required.name in properties)) {
          diagnostics.push(
            diagnostic({
              category: "static-analysis",
              code: "cloudmarkup.ai-extension.cloudformation-required-property-missing",
              detail:
                "Resource is missing a required property from the exact reviewed schema.",
              path,
              repairable: true,
              summary:
                "CloudFormation resource is missing a required property.",
            }),
          );
        }
      }
      const collector: ReferenceCollector = {
        conditions: new Set<string>(),
        references: new Set<string>(),
      };
      const resourceCondition = rawResource["Condition"];
      if (resourceCondition !== undefined) {
        if (typeof resourceCondition !== "string") {
          diagnostics.push(
            diagnostic({
              category: "static-analysis",
              code: "cloudmarkup.ai-extension.cloudformation-condition-reference-invalid",
              detail:
                "A resource Condition must be one exact reviewed condition reference.",
              path,
              repairable: true,
              summary: "CloudFormation condition reference is invalid.",
            }),
          );
        } else {
          collector.conditions.add(resourceCondition);
        }
      }
      for (const [propertyName, propertyValue] of Object.entries(properties)) {
        const property = propertyByName.get(propertyName);
        if (property === undefined) {
          diagnostics.push(
            diagnostic({
              category: "static-analysis",
              code: "cloudmarkup.ai-extension.cloudformation-property-unknown",
              detail:
                "Property is absent from the exact reviewed resource schema.",
              path,
              repairable: true,
              summary: "CloudFormation resource contains an unknown property.",
            }),
          );
          continue;
        }
        try {
          validatePropertyValue(
            propertyValue,
            property,
            new Set(request.policy.allowedSecretReferenceIds),
            collector,
          );
        } catch (error) {
          diagnostics.push(
            diagnostic({
              category:
                error instanceof Error && /secret/iu.test(error.message)
                  ? "security"
                  : "static-analysis",
              code: "cloudmarkup.ai-extension.cloudformation-property-invalid",
              detail:
                error instanceof Error
                  ? error.message
                  : "Property did not satisfy its exact reviewed schema.",
              path,
              repairable: true,
              summary: "CloudFormation property validation failed.",
            }),
          );
        }
      }
      const dependsOn = rawResource["DependsOn"];
      if (typeof dependsOn === "string") collector.references.add(dependsOn);
      else if (Array.isArray(dependsOn)) {
        if (dependsOn.some((entry) => typeof entry !== "string")) {
          diagnostics.push(
            diagnostic({
              category: "static-analysis",
              code: "cloudmarkup.ai-extension.cloudformation-depends-on-invalid",
              detail: "DependsOn must contain exact logical ID strings.",
              path,
              repairable: true,
              summary: "CloudFormation DependsOn is invalid.",
            }),
          );
        } else {
          dependsOn.forEach((entry) =>
            collector.references.add(entry as string),
          );
        }
      } else if (dependsOn !== undefined) {
        diagnostics.push(
          diagnostic({
            category: "static-analysis",
            code: "cloudmarkup.ai-extension.cloudformation-depends-on-invalid",
            detail:
              "DependsOn must be one logical ID or an array of logical IDs.",
            path,
            repairable: true,
            summary: "CloudFormation DependsOn is invalid.",
          }),
        );
      }
      if (
        collector.conditions.size > 0 &&
        [...collector.conditions].some(
          (condition) =>
            !request.policy.allowedConditionReferences.includes(condition),
        )
      ) {
        diagnostics.push(
          diagnostic({
            category: "static-analysis",
            code: "cloudmarkup.ai-extension.cloudformation-condition-reference-invalid",
            detail:
              "Intrinsic references a condition outside exact reviewed authority.",
            path,
            repairable: true,
            summary: "CloudFormation condition reference is invalid.",
          }),
        );
      }
      referenceEdges.set(logicalId, collector.references);
      if (
        !request.policy.policy.allowWildcardIamActions &&
        containsWildcardPolicy(properties, "Action")
      ) {
        diagnostics.push(
          diagnostic({
            category: "security",
            code: "cloudmarkup.ai-extension.cloudformation-wildcard-action-denied",
            detail:
              "Wildcard IAM actions are denied by exact extension policy.",
            path,
            repairable: true,
            summary: "CloudFormation policy contains wildcard actions.",
          }),
        );
      }
      if (
        !request.policy.policy.allowWildcardIamResources &&
        containsWildcardPolicy(properties, "Resource")
      ) {
        diagnostics.push(
          diagnostic({
            category: "security",
            code: "cloudmarkup.ai-extension.cloudformation-wildcard-resource-denied",
            detail:
              "Wildcard IAM resources are denied by exact extension policy.",
            path,
            repairable: true,
            summary: "CloudFormation policy contains wildcard resources.",
          }),
        );
      }
      resources.push(
        cloudFormationStructuredResourceV1Schema.parse({
          logicalId,
          path,
          propertyNames: Object.keys(properties).sort(),
          references: [...collector.references].sort(),
          resourceType,
        }),
      );
    }
  }

  if (totalBytes > request.policy.limits.maximumTotalBytes) {
    diagnostics.push(
      diagnostic({
        category: "admission",
        code: "cloudmarkup.ai-extension.cloudformation-total-bytes-exceeded",
        detail: "CloudFormation candidate exceeds the exact total byte limit.",
        repairable: true,
        summary: "CloudFormation candidate is too large.",
      }),
    );
  }
  if (resourceDeclarationCount > request.policy.limits.maximumResources) {
    diagnostics.push(
      diagnostic({
        category: "admission",
        code: "cloudmarkup.ai-extension.cloudformation-resource-count-exceeded",
        detail:
          "CloudFormation resource count exceeds the exact configured maximum.",
        repairable: true,
        summary: "CloudFormation candidate contains too many resources.",
      }),
    );
  }
  for (const [source, references] of referenceEdges.entries()) {
    const sourcePath = resources.find(
      ({ logicalId }) => logicalId === source,
    )?.path;
    for (const reference of references) {
      if (
        !logicalIds.has(reference) &&
        !request.policy.allowedParameterReferences.includes(reference) &&
        !pseudoParameters.has(reference)
      ) {
        diagnostics.push(
          diagnostic({
            category: "static-analysis",
            code: "cloudmarkup.ai-extension.cloudformation-reference-unresolved",
            detail:
              "Resource contains a Ref/GetAtt/Sub/DependsOn target outside exact local or parameter authority.",
            ...(sourcePath === undefined ? {} : { path: sourcePath }),
            repairable: true,
            summary: "CloudFormation reference cannot be resolved.",
          }),
        );
      }
    }
  }
  if (hasReferenceCycle(referenceEdges)) {
    diagnostics.push(
      diagnostic({
        category: "static-analysis",
        code: "cloudmarkup.ai-extension.cloudformation-reference-cycle",
        detail: "Resource reference graph contains a cycle.",
        repairable: true,
        summary: "CloudFormation resources contain a reference cycle.",
      }),
    );
  }

  const orderedDiagnostics = [...diagnostics].sort((left, right) => {
    const leftKey = [left.path ?? "", left.code, left.summary].join("\u0000");
    const rightKey = [right.path ?? "", right.code, right.summary].join(
      "\u0000",
    );
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const orderedResources = [...resources].sort((left, right) => {
    const leftKey = [portablePathKey(left.path), left.logicalId].join("\u0000");
    const rightKey = [portablePathKey(right.path), right.logicalId].join(
      "\u0000",
    );
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const evidence = makeEvidence({
    diagnostics: orderedDiagnostics,
    request,
    totalBytes,
  });
  const projection = {
    contractVersion: 1 as const,
    diagnostics: orderedDiagnostics,
    evidence,
    resources: orderedResources,
    state: orderedDiagnostics.some(({ severity }) => severity === "error")
      ? ("failed" as const)
      : ("passed" as const),
  };
  return cloudFormationExtensionValidationResultV1Schema.parse({
    ...projection,
    reportDigest: getCloudFormationValidationReportDigest(projection),
  });
}

export type CloudFormationExtensionValidationPolicyV1 = z.output<
  typeof cloudFormationExtensionValidationPolicyV1Schema
>;
export type CloudFormationExtensionValidationRequestV1 = z.output<
  typeof cloudFormationExtensionValidationRequestV1Schema
>;
