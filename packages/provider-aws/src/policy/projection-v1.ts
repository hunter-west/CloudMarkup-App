import {
  classifyOwnedConfigurationNodes,
  parseArchitectureDocument,
  type ArchitectureConfiguration,
  type ArchitectureConfigurationValue,
  type ArchitectureDocument,
  type ArchitectureEdge,
  type ArchitectureNode,
  type OwnedConfigurationClassificationIssue,
  type OwnedConfigurationDescriptorSet,
  type OwnedConfigurationInstance,
  type VersionedArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  providerCanonicalPolicyDocumentV1Schema,
  providerCanonicalPolicyStatementV1Schema,
  providerOwnedConfigurationSlotV1Schema,
  providerPolicyConditionV1Schema,
  providerPolicyDocumentKindV1Schema,
  type ProviderCanonicalPolicyDocumentV1,
  type ProviderCanonicalPolicyStatementV1,
  type ProviderOwnedConfigurationSlotV1,
  type ProviderPolicyConditionV1,
  type ProviderPolicyDocumentKindV1,
  type ProviderPolicyPrincipalV1,
  type ProviderPolicyResourceV1,
} from "@cloudmarkup/provider-sdk";
import {
  configurationSchemaIdSchema,
  namespacedIdentifierSchema,
  nodeIdSchema,
  portTypeSchema,
  relationshipTypeSchema,
  resourceTypeSchema,
  semanticVersionSchema,
  serializeCanonicalJson,
  serviceTypeSchema,
  type ElementLifecycle,
} from "@cloudmarkup/schemas";

const policyDocumentServiceType = "aws.iam.policy-document";
const policyDocumentResourceType = "aws.iam.policy-document";
const policyDocumentConfigurationSchemaId =
  "aws.iam.policy-document.configuration";
const policyDocumentConfigurationSchemaVersion = "1.0.0";
const policyStatementServiceType = "aws.iam.policy-statement";
const policyStatementResourceType = "aws.iam.policy-statement";
const policyStatementConfigurationSchemaId =
  "aws.iam.policy-statement.configuration";
const policyStatementConfigurationSchemaVersion = "2.0.0";
const policyConditionServiceType = "aws.iam.policy-condition";
const policyConditionResourceType = "aws.iam.policy-condition";
const policyConditionConfigurationSchemaId =
  "aws.iam.policy-condition.configuration";
const policyConditionConfigurationSchemaVersion = "1.0.0";

export const AWS_IAM_POLICY_INTERNAL_BINDINGS_V1 = Object.freeze({
  statementMembership: Object.freeze({
    slotId: "aws.iam.policy-document.slot.statements",
    relationshipType: "aws.iam.policy-contains-statement",
    childPort: "aws.iam.policy-statement.policy-document",
    ownerPort: "aws.iam.policy-document.statement",
    configurationSchemaId: "aws.iam.policy-membership.connection",
    configurationSchemaVersion: "1.0.0",
  }),
  conditionMembership: Object.freeze({
    slotId: "aws.iam.policy-statement.slot.conditions",
    relationshipType: "aws.iam.statement-owns-condition",
    childPort: "aws.iam.policy-condition.statement-condition",
    ownerPort: "aws.iam.policy-statement.condition",
    configurationSchemaId: "aws.iam.condition-membership.connection",
    configurationSchemaVersion: "1.0.0",
  }),
});

export interface AwsPolicyOwnerSlotDescriptorV1 {
  readonly slot: Readonly<ProviderOwnedConfigurationSlotV1>;
  readonly ownerServiceType: string;
  readonly ownerResourceType: string;
  readonly policyDocumentPort: string;
  readonly ownerPort: string;
  readonly bindingConfigurationSchemaId: string;
  readonly bindingConfigurationSchemaVersion: string;
}

export interface AwsPolicyResourceScopeDescriptorV1 {
  readonly id: string;
  readonly relationshipType: string;
  readonly statementPort: string;
  readonly resourceServiceType: string;
  readonly resourceResourceType: string;
  readonly resourcePort: string;
  readonly resourceAttribute: string;
  readonly bindingConfigurationSchemaId: string;
  readonly bindingConfigurationSchemaVersion: string;
}

export const AWS_IAM_POLICY_RESOURCE_SCOPES_V1: readonly AwsPolicyResourceScopeDescriptorV1[] =
  Object.freeze([
    Object.freeze({
      id: "aws.iam.policy-scope.secret",
      relationshipType: "aws.iam.authorizes-secret",
      statementPort: "aws.iam.policy-statement.secret-resource",
      resourceServiceType: "aws.secretsmanager.secret",
      resourceResourceType: "aws.secretsmanager.secret",
      resourcePort: "aws.secretsmanager.secret.policy-resource",
      resourceAttribute: "aws.secretsmanager.secret.arn",
      bindingConfigurationSchemaId:
        "aws.iam.policy-statement-authorizes-secret.connection",
      bindingConfigurationSchemaVersion: "1.0.0",
    }),
    Object.freeze({
      id: "aws.iam.policy-scope.kms-key",
      relationshipType: "aws.iam.authorizes-kms-key",
      statementPort: "aws.iam.policy-statement.kms-resource",
      resourceServiceType: "aws.kms.key",
      resourceResourceType: "aws.kms.key",
      resourcePort: "aws.kms.key.policy-resource",
      resourceAttribute: "aws.kms.key.arn",
      bindingConfigurationSchemaId:
        "aws.iam.policy-statement-authorizes-kms-key.connection",
      bindingConfigurationSchemaVersion: "1.0.0",
    }),
    Object.freeze({
      id: "aws.iam.policy-scope.dynamodb-table",
      relationshipType: "aws.iam.authorizes-dynamodb-table",
      statementPort: "aws.iam.policy-statement.dynamodb-resource",
      resourceServiceType: "aws.dynamodb.table",
      resourceResourceType: "aws.dynamodb.table",
      resourcePort: "aws.dynamodb.table.policy-resource",
      resourceAttribute: "aws.dynamodb.table.arn",
      bindingConfigurationSchemaId: "aws.iam.policy-table.connection",
      bindingConfigurationSchemaVersion: "1.0.0",
    }),
    Object.freeze({
      id: "aws.iam.policy-scope.lambda-function",
      relationshipType: "aws.iam.authorizes-lambda-function",
      statementPort: "aws.iam.policy-statement.lambda-resource",
      resourceServiceType: "aws.lambda.function",
      resourceResourceType: "aws.lambda.function",
      resourcePort: "aws.lambda.function.policy-resource",
      resourceAttribute: "aws.lambda.function.arn",
      bindingConfigurationSchemaId: "aws.iam.policy-lambda.connection",
      bindingConfigurationSchemaVersion: "1.0.0",
    }),
    Object.freeze({
      id: "aws.iam.policy-scope.log-group",
      relationshipType: "aws.iam.authorizes-log-group",
      statementPort: "aws.iam.policy-statement.log-group-resource",
      resourceServiceType: "aws.cloudwatch.log-group",
      resourceResourceType: "aws.cloudwatch.log-group",
      resourcePort: "aws.cloudwatch.log-group.policy-resource",
      resourceAttribute: "aws.cloudwatch.log-group.arn",
      bindingConfigurationSchemaId: "aws.iam.policy-log-group.connection",
      bindingConfigurationSchemaVersion: "1.0.0",
    }),
    Object.freeze({
      id: "aws.iam.policy-scope.s3-bucket",
      relationshipType: "aws.iam.authorizes-s3-bucket",
      statementPort: "aws.iam.policy-statement.s3-resource",
      resourceServiceType: "aws.s3.bucket",
      resourceResourceType: "aws.s3.bucket",
      resourcePort: "aws.s3.bucket.policy-resource",
      resourceAttribute: "aws.s3.bucket.arn",
      bindingConfigurationSchemaId:
        "aws.iam.policy-statement-authorizes-s3-bucket.connection",
      bindingConfigurationSchemaVersion: "1.0.0",
    }),
    Object.freeze({
      id: "aws.iam.policy-scope.sqs-queue",
      relationshipType: "aws.iam.authorizes-sqs-queue",
      statementPort: "aws.iam.policy-statement.sqs-resource",
      resourceServiceType: "aws.sqs.queue",
      resourceResourceType: "aws.sqs.queue",
      resourcePort: "aws.sqs.queue.policy-resource",
      resourceAttribute: "aws.sqs.queue.arn",
      bindingConfigurationSchemaId:
        "aws.iam.policy-statement-authorizes-sqs-queue.connection",
      bindingConfigurationSchemaVersion: "1.0.0",
    }),
  ]);

export interface AwsCanonicalPolicyProjectionOptionsV1 {
  readonly ownerSlots: readonly AwsPolicyOwnerSlotDescriptorV1[];
  readonly resourceScopes?: readonly AwsPolicyResourceScopeDescriptorV1[];
}

export type AwsCanonicalPolicyProjectionIssueCodeV1 =
  | "duplicate-equivalent-statement"
  | "empty-actions"
  | "empty-resources"
  | "invalid-canonical-policy"
  | "invalid-condition-binding"
  | "invalid-owner-binding"
  | "invalid-owner-slot-descriptor"
  | "invalid-policy-document-configuration"
  | "invalid-principal-kind"
  | "invalid-resource-scope"
  | "invalid-resource-scope-descriptor"
  | "invalid-statement-binding"
  | "invalid-statement-configuration"
  | "lifecycle-mismatch"
  | "malformed-condition"
  | "ownership-not-allowed"
  | "policy-kind-not-allowed"
  | "resource-scope-mismatch"
  | "unsupported-target-readiness-claim"
  | "wildcard-action"
  | "wildcard-principal"
  | "wildcard-resource";

export interface AwsCanonicalPolicyProjectionIssueV1 {
  readonly code: AwsCanonicalPolicyProjectionIssueCodeV1;
  readonly path: string;
  readonly message: string;
}

export type AwsCanonicalPolicyProjectionResultV1 =
  | {
      readonly success: true;
      readonly documents: readonly Readonly<ProviderCanonicalPolicyDocumentV1>[];
    }
  | {
      readonly success: false;
      readonly issues: readonly AwsCanonicalPolicyProjectionIssueV1[];
    };

interface ValidatedOwnerSlotDescriptor {
  readonly slot: ProviderOwnedConfigurationSlotV1;
  readonly ownerServiceType: ArchitectureNode["semantic"]["serviceType"];
  readonly ownerResourceType: ArchitectureNode["semantic"]["resourceType"];
  readonly policyDocumentPort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly ownerPort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly bindingConfigurationSchemaId: ArchitectureConfiguration["schemaId"];
  readonly bindingConfigurationSchemaVersion: ArchitectureConfiguration["schemaVersion"];
}

interface ValidatedResourceScopeDescriptor {
  readonly id: string;
  readonly relationshipType: ArchitectureEdge["semantic"]["relationshipType"];
  readonly statementPort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly resourceServiceType: ArchitectureNode["semantic"]["serviceType"];
  readonly resourceResourceType: ArchitectureNode["semantic"]["resourceType"];
  readonly resourcePort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly resourceAttribute: string;
  readonly bindingConfigurationSchemaId: ArchitectureConfiguration["schemaId"];
  readonly bindingConfigurationSchemaVersion: ArchitectureConfiguration["schemaVersion"];
}

const issueMessages: Readonly<
  Record<AwsCanonicalPolicyProjectionIssueCodeV1, string>
> = Object.freeze({
  "duplicate-equivalent-statement":
    "A policy document cannot contain semantically equivalent statements.",
  "empty-actions": "A canonical policy statement requires at least one action.",
  "empty-resources":
    "A non-trust canonical policy statement requires at least one resource.",
  "invalid-canonical-policy":
    "The graph projection does not satisfy the canonical policy contract.",
  "invalid-condition-binding":
    "A policy condition must have one exact, typed statement binding.",
  "invalid-owner-binding":
    "A policy document must have one exact, typed owner-slot binding.",
  "invalid-owner-slot-descriptor":
    "The supplied policy owner-slot descriptor is invalid or ambiguous.",
  "invalid-policy-document-configuration":
    "The policy document configuration must use the exact bounded schema.",
  "invalid-principal-kind":
    "The policy kind and principal configuration are incompatible.",
  "invalid-resource-scope":
    "A statement resource must use a declared typed graph scope or bounded expression.",
  "invalid-resource-scope-descriptor":
    "The supplied policy resource-scope descriptor is invalid or ambiguous.",
  "invalid-statement-binding":
    "A policy statement must have one exact, typed policy-document binding.",
  "invalid-statement-configuration":
    "The policy statement configuration must use the exact bounded schema.",
  "lifecycle-mismatch":
    "Owned policy nodes and their child resources must share exact lifecycle authority and provenance.",
  "malformed-condition":
    "A policy condition must use a supported operator, key, and non-empty typed values.",
  "ownership-not-allowed":
    "The policy document lifecycle is not allowed by its exact owner slot.",
  "policy-kind-not-allowed":
    "The policy document kind is not allowed by its exact owner slot.",
  "resource-scope-mismatch":
    "The configured resource reference must match an exact typed resource-scope edge.",
  "unsupported-target-readiness-claim":
    "Canonical policy projection cannot claim CloudFormation support before compiler evidence exists.",
  "wildcard-action":
    "Wildcard policy actions are rejected by the canonical AWS projection.",
  "wildcard-principal":
    "Wildcard policy principals are rejected by the canonical AWS projection.",
  "wildcard-resource":
    "Wildcard policy resources are rejected by the canonical AWS projection.",
});

const policyDocumentKeys = new Set(["policyKind", "policyName"]);
const policyStatementKeys = new Set([
  "actions",
  "effect",
  "principals",
  "principalKind",
  "resourceExpressions",
  "resourceNode",
  "statementId",
]);
const policyConditionKeys = new Set(["key", "operator", "values"]);
const supportedConditionOperators = new Set([
  "ArnEquals",
  "ArnLike",
  "Bool",
  "IpAddress",
  "NumericEquals",
  "StringEquals",
  "StringLike",
]);

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function createIssue(
  code: AwsCanonicalPolicyProjectionIssueCodeV1,
  path: string,
): AwsCanonicalPolicyProjectionIssueV1 {
  return Object.freeze({ code, path, message: issueMessages[code] });
}

function sortIssues(
  issues: readonly AwsCanonicalPolicyProjectionIssueV1[],
): AwsCanonicalPolicyProjectionIssueV1[] {
  const seen = new Set<string>();
  return [...issues]
    .sort(
      (left, right) =>
        compareStrings(left.path, right.path) ||
        compareStrings(left.code, right.code),
    )
    .filter((entry) => {
      const key = `${entry.path}\u0000${entry.code}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(serializeCanonicalJson(value)) as T;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((nested) => {
      deepFreeze(nested);
    });
  }
  return value;
}

function sortCanonical<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) =>
    compareStrings(serializeCanonicalJson(left), serializeCanonicalJson(right)),
  );
}

function lifecycleMatches(
  left: ElementLifecycle,
  right: ElementLifecycle,
): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function nodePath(
  nodeId: ArchitectureNode["id"],
  nodeIndexById: ReadonlyMap<ArchitectureNode["id"], number>,
): string {
  return `$.nodes[${String(nodeIndexById.get(nodeId) ?? 0)}]`;
}

function edgePath(
  edgeId: ArchitectureEdge["id"],
  edgeIndexById: ReadonlyMap<ArchitectureEdge["id"], number>,
): string {
  return `$.edges[${String(edgeIndexById.get(edgeId) ?? 0)}]`;
}

function validateExactKeys(
  configuration: ArchitectureConfiguration,
  allowedKeys: ReadonlySet<string>,
  path: string,
  code:
    | "invalid-policy-document-configuration"
    | "invalid-statement-configuration"
    | "malformed-condition",
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): void {
  Object.keys(configuration.values)
    .filter((key) => !allowedKeys.has(key))
    .sort(compareStrings)
    .forEach((key) => {
      issues.push(createIssue(code, `${path}.values[${JSON.stringify(key)}]`));
    });
}

function configurationValue(
  configuration: ArchitectureConfiguration,
  key: string,
): ArchitectureConfigurationValue | undefined {
  return (
    configuration.values as Readonly<
      Record<string, ArchitectureConfigurationValue>
    >
  )[key];
}

function readString(
  configuration: ArchitectureConfiguration,
  key: string,
  path: string,
  code:
    | "invalid-policy-document-configuration"
    | "invalid-statement-configuration"
    | "malformed-condition",
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): string | undefined {
  const value = configurationValue(configuration, key);
  if (
    value?.kind !== "string" ||
    value.value.length === 0 ||
    value.value.trim() !== value.value
  ) {
    issues.push(createIssue(code, `${path}.values.${key}`));
    return undefined;
  }
  return value.value;
}

function readStringList(
  configuration: ArchitectureConfiguration,
  key: string,
  path: string,
  code: "invalid-statement-configuration" | "malformed-condition",
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): readonly string[] | undefined {
  const value = configurationValue(configuration, key);
  if (
    value?.kind !== "string-list" ||
    value.value.some((entry) => entry.length === 0 || entry.trim() !== entry) ||
    new Set(value.value).size !== value.value.length
  ) {
    issues.push(createIssue(code, `${path}.values.${key}`));
    return undefined;
  }
  return [...value.value].sort(compareStrings);
}

function validateEmptyBindingConfiguration(
  edge: ArchitectureEdge,
  schemaId: ArchitectureConfiguration["schemaId"],
  schemaVersion: ArchitectureConfiguration["schemaVersion"],
  path: string,
  code:
    | "invalid-owner-binding"
    | "invalid-statement-binding"
    | "invalid-condition-binding"
    | "invalid-resource-scope",
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): void {
  if (
    edge.semantic.configuration.schemaId !== schemaId ||
    edge.semantic.configuration.schemaVersion !== schemaVersion ||
    Object.keys(edge.semantic.configuration.values).length !== 0
  ) {
    issues.push(createIssue(code, `${path}.semantic.configuration`));
  }
}

function validateOwnerSlotDescriptors(
  input: readonly AwsPolicyOwnerSlotDescriptorV1[],
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): readonly ValidatedOwnerSlotDescriptor[] {
  const validated: ValidatedOwnerSlotDescriptor[] = [];
  const slotIds = new Set<string>();
  const bindingShapes = new Set<string>();

  input.forEach((descriptor, index) => {
    const path = `$.options.ownerSlots[${String(index)}]`;
    const slotResult = providerOwnedConfigurationSlotV1Schema.safeParse(
      descriptor.slot,
    );
    const ownerService = serviceTypeSchema.safeParse(
      descriptor.ownerServiceType,
    );
    const ownerResource = resourceTypeSchema.safeParse(
      descriptor.ownerResourceType,
    );
    const policyPort = portTypeSchema.safeParse(descriptor.policyDocumentPort);
    const ownerPort = portTypeSchema.safeParse(descriptor.ownerPort);
    const bindingSchemaId = configurationSchemaIdSchema.safeParse(
      descriptor.bindingConfigurationSchemaId,
    );
    const bindingSchemaVersion = semanticVersionSchema.safeParse(
      descriptor.bindingConfigurationSchemaVersion,
    );
    if (
      !slotResult.success ||
      !ownerService.success ||
      !ownerResource.success ||
      !policyPort.success ||
      !ownerPort.success ||
      !bindingSchemaId.success ||
      !bindingSchemaVersion.success
    ) {
      issues.push(createIssue("invalid-owner-slot-descriptor", path));
      return;
    }
    const slot = slotResult.data;
    if (
      slot.graphBinding.configurationServiceId !== policyDocumentServiceType ||
      slot.policyKinds.length === 0 ||
      slot.policyKinds.some(
        (kind) => !providerPolicyDocumentKindV1Schema.safeParse(kind).success,
      )
    ) {
      issues.push(createIssue("invalid-owner-slot-descriptor", path));
      return;
    }
    const slotId = String(slot.id);
    const bindingShape = [
      ownerService.data,
      ownerResource.data,
      slot.graphBinding.ownershipRelationshipType,
      policyPort.data,
      ownerPort.data,
    ].join("\u0000");
    if (slotIds.has(slotId) || bindingShapes.has(bindingShape)) {
      issues.push(createIssue("invalid-owner-slot-descriptor", path));
      return;
    }
    slotIds.add(slotId);
    bindingShapes.add(bindingShape);
    validated.push({
      slot,
      ownerServiceType: ownerService.data,
      ownerResourceType: ownerResource.data,
      policyDocumentPort: policyPort.data,
      ownerPort: ownerPort.data,
      bindingConfigurationSchemaId: bindingSchemaId.data,
      bindingConfigurationSchemaVersion: bindingSchemaVersion.data,
    });
  });

  return validated.sort((left, right) =>
    compareStrings(String(left.slot.id), String(right.slot.id)),
  );
}

function validateResourceScopeDescriptors(
  input: readonly AwsPolicyResourceScopeDescriptorV1[],
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): readonly ValidatedResourceScopeDescriptor[] {
  const validated: ValidatedResourceScopeDescriptor[] = [];
  const ids = new Set<string>();
  const shapes = new Set<string>();

  input.forEach((descriptor, index) => {
    const path = `$.options.resourceScopes[${String(index)}]`;
    const id = namespacedIdentifierSchema.safeParse(descriptor.id);
    const relationship = relationshipTypeSchema.safeParse(
      descriptor.relationshipType,
    );
    const statementPort = portTypeSchema.safeParse(descriptor.statementPort);
    const resourceService = serviceTypeSchema.safeParse(
      descriptor.resourceServiceType,
    );
    const resourceResource = resourceTypeSchema.safeParse(
      descriptor.resourceResourceType,
    );
    const resourcePort = portTypeSchema.safeParse(descriptor.resourcePort);
    const resourceAttribute = namespacedIdentifierSchema.safeParse(
      descriptor.resourceAttribute,
    );
    const bindingSchemaId = configurationSchemaIdSchema.safeParse(
      descriptor.bindingConfigurationSchemaId,
    );
    const bindingSchemaVersion = semanticVersionSchema.safeParse(
      descriptor.bindingConfigurationSchemaVersion,
    );
    if (
      !id.success ||
      !relationship.success ||
      !statementPort.success ||
      !resourceService.success ||
      !resourceResource.success ||
      !resourcePort.success ||
      !resourceAttribute.success ||
      !bindingSchemaId.success ||
      !bindingSchemaVersion.success
    ) {
      issues.push(createIssue("invalid-resource-scope-descriptor", path));
      return;
    }
    const shape = [
      relationship.data,
      statementPort.data,
      resourceService.data,
      resourceResource.data,
      resourcePort.data,
    ].join("\u0000");
    if (ids.has(id.data) || shapes.has(shape)) {
      issues.push(createIssue("invalid-resource-scope-descriptor", path));
      return;
    }
    ids.add(id.data);
    shapes.add(shape);
    validated.push({
      id: id.data,
      relationshipType: relationship.data,
      statementPort: statementPort.data,
      resourceServiceType: resourceService.data,
      resourceResourceType: resourceResource.data,
      resourcePort: resourcePort.data,
      resourceAttribute: resourceAttribute.data,
      bindingConfigurationSchemaId: bindingSchemaId.data,
      bindingConfigurationSchemaVersion: bindingSchemaVersion.data,
    });
  });

  return validated.sort((left, right) => compareStrings(left.id, right.id));
}

function policyDocumentDescriptorSet(
  descriptors: readonly ValidatedOwnerSlotDescriptor[],
): OwnedConfigurationDescriptorSet {
  return {
    kinds: [
      {
        id: "aws.iam.owned-configuration.policy-document",
        nodeServiceType: serviceTypeSchema.parse(policyDocumentServiceType),
        nodeResourceType: resourceTypeSchema.parse(policyDocumentResourceType),
        configurationSchemaId: configurationSchemaIdSchema.parse(
          policyDocumentConfigurationSchemaId,
        ),
        configurationSchemaVersion: semanticVersionSchema.parse(
          policyDocumentConfigurationSchemaVersion,
        ),
        allowedOwnership: ["user", "generated", "adopted"],
      },
    ],
    slots: descriptors.map((descriptor) => ({
      id: descriptor.slot.id,
      ownerServiceType: descriptor.ownerServiceType,
      ownerResourceType: descriptor.ownerResourceType,
      relationshipType: descriptor.slot.graphBinding.ownershipRelationshipType,
      configurationEndpoint: "source",
      configurationPort: descriptor.policyDocumentPort,
      ownerPort: descriptor.ownerPort,
      parentBinding: "required",
      configurationKindIds: ["aws.iam.owned-configuration.policy-document"],
      cardinality: {
        minimum: descriptor.slot.cardinality.minimum,
        maximum:
          descriptor.slot.cardinality.maximum === "many"
            ? null
            : descriptor.slot.cardinality.maximum,
      },
    })),
  };
}

function statementDescriptorSet(): OwnedConfigurationDescriptorSet {
  return {
    kinds: [
      {
        id: "aws.iam.owned-configuration.policy-statement",
        nodeServiceType: serviceTypeSchema.parse(policyStatementServiceType),
        nodeResourceType: resourceTypeSchema.parse(policyStatementResourceType),
        configurationSchemaId: configurationSchemaIdSchema.parse(
          policyStatementConfigurationSchemaId,
        ),
        configurationSchemaVersion: semanticVersionSchema.parse(
          policyStatementConfigurationSchemaVersion,
        ),
        allowedOwnership: ["user", "generated", "adopted"],
      },
    ],
    slots: [
      {
        id: AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership.slotId,
        ownerServiceType: serviceTypeSchema.parse(policyDocumentServiceType),
        ownerResourceType: resourceTypeSchema.parse(policyDocumentResourceType),
        relationshipType: relationshipTypeSchema.parse(
          AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership
            .relationshipType,
        ),
        configurationEndpoint: "source",
        configurationPort: portTypeSchema.parse(
          AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership.childPort,
        ),
        ownerPort: portTypeSchema.parse(
          AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership.ownerPort,
        ),
        parentBinding: "required",
        configurationKindIds: ["aws.iam.owned-configuration.policy-statement"],
        cardinality: { minimum: 1, maximum: null },
      },
    ],
  };
}

function conditionDescriptorSet(): OwnedConfigurationDescriptorSet {
  return {
    kinds: [
      {
        id: "aws.iam.owned-configuration.policy-condition",
        nodeServiceType: serviceTypeSchema.parse(policyConditionServiceType),
        nodeResourceType: resourceTypeSchema.parse(policyConditionResourceType),
        configurationSchemaId: configurationSchemaIdSchema.parse(
          policyConditionConfigurationSchemaId,
        ),
        configurationSchemaVersion: semanticVersionSchema.parse(
          policyConditionConfigurationSchemaVersion,
        ),
        allowedOwnership: ["user", "generated", "adopted"],
      },
    ],
    slots: [
      {
        id: AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership.slotId,
        ownerServiceType: serviceTypeSchema.parse(policyStatementServiceType),
        ownerResourceType: resourceTypeSchema.parse(
          policyStatementResourceType,
        ),
        relationshipType: relationshipTypeSchema.parse(
          AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership
            .relationshipType,
        ),
        configurationEndpoint: "source",
        configurationPort: portTypeSchema.parse(
          AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership.childPort,
        ),
        ownerPort: portTypeSchema.parse(
          AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership.ownerPort,
        ),
        parentBinding: "required",
        configurationKindIds: ["aws.iam.owned-configuration.policy-condition"],
        cardinality: { minimum: 0, maximum: null },
      },
    ],
  };
}

function appendClassificationIssues(
  source: readonly OwnedConfigurationClassificationIssue[],
  code:
    | "invalid-owner-binding"
    | "invalid-statement-binding"
    | "invalid-condition-binding",
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): void {
  source.forEach((entry) => {
    issues.push(createIssue(code, entry.path));
  });
}

function slotAllowsLifecycle(
  slot: ProviderOwnedConfigurationSlotV1,
  lifecycle: ElementLifecycle,
): boolean {
  if (lifecycle.ownership === "adopted") {
    return slot.generatedAdoption === "allowed";
  }
  return slot.allowedOwnership.includes(lifecycle.ownership);
}

function adaptPrincipals(
  policyKind: ProviderPolicyDocumentKindV1,
  principalKind: string,
  values: readonly string[],
  path: string,
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): readonly ProviderPolicyPrincipalV1[] {
  const forbidsPrincipals =
    policyKind === "identity-inline" || policyKind === "generated-permission";
  const requiresPrincipals =
    policyKind === "trust" ||
    policyKind === "resource" ||
    policyKind === "service-grant";
  const validKinds = new Set([
    "all-principals",
    "architecture-node",
    "federated",
    "none",
    "provider-identity",
    "service",
  ]);
  if (
    !validKinds.has(principalKind) ||
    (principalKind === "none" && values.length > 0) ||
    (principalKind !== "none" && values.length === 0) ||
    (forbidsPrincipals && (principalKind !== "none" || values.length > 0)) ||
    (requiresPrincipals && (principalKind === "none" || values.length === 0))
  ) {
    issues.push(createIssue("invalid-principal-kind", path));
    return [];
  }
  if (principalKind === "none") {
    return [];
  }
  if (
    principalKind === "all-principals" &&
    (values.length !== 1 || values[0] !== "*")
  ) {
    issues.push(createIssue("invalid-principal-kind", path));
    return [];
  }
  if (
    principalKind === "service" &&
    values.some((value) => !namespacedIdentifierSchema.safeParse(value).success)
  ) {
    issues.push(createIssue("invalid-principal-kind", path));
    return [];
  }
  if (
    principalKind === "architecture-node" &&
    values.some((value) => !nodeIdSchema.safeParse(value).success)
  ) {
    issues.push(createIssue("invalid-principal-kind", path));
    return [];
  }
  if (values.some((value) => value.includes("*") || value.includes("?"))) {
    issues.push(createIssue("wildcard-principal", path));
  }
  const principals = values.map((value): ProviderPolicyPrincipalV1 => {
    if (principalKind === "all-principals") {
      return { kind: "all-principals" };
    }
    if (principalKind === "service") {
      return {
        kind: "service",
        service: namespacedIdentifierSchema.parse(value),
      };
    }
    if (principalKind === "architecture-node") {
      return {
        kind: "architecture-node",
        nodeId: nodeIdSchema.parse(value),
      };
    }
    if (principalKind === "federated") {
      return { kind: "federated", value };
    }
    return { kind: "provider-identity", value };
  });
  return sortCanonical(principals);
}

function adaptCondition(
  node: ArchitectureNode,
  path: string,
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): ProviderPolicyConditionV1 | undefined {
  const configuration = node.semantic.configuration;
  validateExactKeys(
    configuration,
    policyConditionKeys,
    `${path}.semantic.configuration`,
    "malformed-condition",
    issues,
  );
  const operator = readString(
    configuration,
    "operator",
    `${path}.semantic.configuration`,
    "malformed-condition",
    issues,
  );
  const key = readString(
    configuration,
    "key",
    `${path}.semantic.configuration`,
    "malformed-condition",
    issues,
  );
  const values = readStringList(
    configuration,
    "values",
    `${path}.semantic.configuration`,
    "malformed-condition",
    issues,
  );
  if (
    operator === undefined ||
    key === undefined ||
    values === undefined ||
    values.length === 0 ||
    !supportedConditionOperators.has(operator)
  ) {
    issues.push(createIssue("malformed-condition", path));
    return undefined;
  }
  const result = providerPolicyConditionV1Schema.safeParse({
    id: node.id,
    operator,
    key,
    values: values.map((value) => ({ kind: "string" as const, value })),
  });
  if (!result.success) {
    issues.push(createIssue("malformed-condition", path));
    return undefined;
  }
  return result.data;
}

function resourcesForStatement(
  document: ArchitectureDocument,
  statement: ArchitectureNode,
  configuration: ArchitectureConfiguration,
  scopes: readonly ValidatedResourceScopeDescriptor[],
  path: string,
  edgeIndexById: ReadonlyMap<ArchitectureEdge["id"], number>,
  nodeById: ReadonlyMap<ArchitectureNode["id"], ArchitectureNode>,
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): readonly ProviderPolicyResourceV1[] {
  const resources: ProviderPolicyResourceV1[] = [];
  const relationshipTypes = new Set(
    scopes.map((scope) => scope.relationshipType),
  );
  const statementPorts = new Set(scopes.map((scope) => scope.statementPort));
  const scopeEdges = document.edges.filter(
    (edge) =>
      (edge.semantic.source.nodeId === statement.id &&
        (relationshipTypes.has(edge.semantic.relationshipType) ||
          statementPorts.has(edge.semantic.source.port))) ||
      (edge.semantic.target.nodeId === statement.id &&
        relationshipTypes.has(edge.semantic.relationshipType)),
  );

  scopeEdges.forEach((edge) => {
    const target = nodeById.get(edge.semantic.target.nodeId);
    const matches = scopes.filter(
      (scope) =>
        edge.semantic.source.nodeId === statement.id &&
        edge.semantic.source.port === scope.statementPort &&
        edge.semantic.relationshipType === scope.relationshipType &&
        edge.semantic.target.port === scope.resourcePort &&
        target?.semantic.serviceType === scope.resourceServiceType &&
        target.semantic.resourceType === scope.resourceResourceType,
    );
    const edgeLocation = edgePath(edge.id, edgeIndexById);
    const scope = matches[0];
    if (matches.length !== 1 || scope === undefined || target === undefined) {
      issues.push(createIssue("invalid-resource-scope", edgeLocation));
      return;
    }
    validateEmptyBindingConfiguration(
      edge,
      scope.bindingConfigurationSchemaId,
      scope.bindingConfigurationSchemaVersion,
      edgeLocation,
      "invalid-resource-scope",
      issues,
    );
    if (
      !lifecycleMatches(statement.semantic.lifecycle, edge.semantic.lifecycle)
    ) {
      issues.push(
        createIssue("lifecycle-mismatch", `${edgeLocation}.semantic.lifecycle`),
      );
    }
    resources.push({
      kind: "architecture-node",
      nodeId: target.id,
      attribute: namespacedIdentifierSchema.parse(scope.resourceAttribute),
    });
  });

  const expressions = readStringList(
    configuration,
    "resourceExpressions",
    `${path}.semantic.configuration`,
    "invalid-statement-configuration",
    issues,
  );
  expressions?.forEach((value) => {
    if (value.includes("*") || value.includes("?")) {
      issues.push(
        createIssue(
          "wildcard-resource",
          `${path}.semantic.configuration.values.resourceExpressions`,
        ),
      );
      resources.push({ kind: "all-resources" });
      return;
    }
    resources.push({ kind: "provider-resource", value });
  });

  const configuredResource = configurationValue(configuration, "resourceNode");
  if (configuredResource !== undefined) {
    if (configuredResource.kind === "string") {
      issues.push(
        createIssue(
          configuredResource.value.includes("*") ||
            configuredResource.value.includes("?")
            ? "wildcard-resource"
            : "invalid-resource-scope",
          `${path}.semantic.configuration.values.resourceNode`,
        ),
      );
    } else if (configuredResource.kind !== "node-reference") {
      issues.push(
        createIssue(
          "invalid-resource-scope",
          `${path}.semantic.configuration.values.resourceNode`,
        ),
      );
    } else if (
      !resources.some(
        (resource) =>
          resource.kind === "architecture-node" &&
          resource.nodeId === configuredResource.nodeId &&
          resource.attribute === configuredResource.attribute,
      )
    ) {
      issues.push(
        createIssue(
          "resource-scope-mismatch",
          `${path}.semantic.configuration.values.resourceNode`,
        ),
      );
    }
  }

  const sorted = sortCanonical(resources);
  const seen = new Set<string>();
  sorted.forEach((resource) => {
    const key = serializeCanonicalJson(resource);
    if (seen.has(key)) {
      issues.push(createIssue("invalid-resource-scope", path));
    }
    seen.add(key);
  });
  return sorted;
}

function adaptStatement(
  document: ArchitectureDocument,
  node: ArchitectureNode,
  policyKind: ProviderPolicyDocumentKindV1,
  conditions: readonly ProviderPolicyConditionV1[],
  scopes: readonly ValidatedResourceScopeDescriptor[],
  path: string,
  edgeIndexById: ReadonlyMap<ArchitectureEdge["id"], number>,
  nodeById: ReadonlyMap<ArchitectureNode["id"], ArchitectureNode>,
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): ProviderCanonicalPolicyStatementV1 | undefined {
  const configuration = node.semantic.configuration;
  validateExactKeys(
    configuration,
    policyStatementKeys,
    `${path}.semantic.configuration`,
    "invalid-statement-configuration",
    issues,
  );
  const statementIdentifier = readString(
    configuration,
    "statementId",
    `${path}.semantic.configuration`,
    "invalid-statement-configuration",
    issues,
  );
  const effectValue = readString(
    configuration,
    "effect",
    `${path}.semantic.configuration`,
    "invalid-statement-configuration",
    issues,
  );
  const actionValues = readStringList(
    configuration,
    "actions",
    `${path}.semantic.configuration`,
    "invalid-statement-configuration",
    issues,
  );
  const principalKind = readString(
    configuration,
    "principalKind",
    `${path}.semantic.configuration`,
    "invalid-statement-configuration",
    issues,
  );
  const principalValues = readStringList(
    configuration,
    "principals",
    `${path}.semantic.configuration`,
    "invalid-statement-configuration",
    issues,
  );
  if (
    statementIdentifier === undefined ||
    effectValue === undefined ||
    actionValues === undefined ||
    principalKind === undefined ||
    principalValues === undefined
  ) {
    return undefined;
  }
  if (actionValues.length === 0) {
    issues.push(
      createIssue(
        "empty-actions",
        `${path}.semantic.configuration.values.actions`,
      ),
    );
  }
  const actions = actionValues.map((action) => {
    if (action.includes("*") || action.includes("?")) {
      issues.push(
        createIssue(
          "wildcard-action",
          `${path}.semantic.configuration.values.actions`,
        ),
      );
      return { kind: "all-actions" as const };
    }
    return { kind: "provider-action" as const, action };
  });
  const resources = resourcesForStatement(
    document,
    node,
    configuration,
    scopes,
    path,
    edgeIndexById,
    nodeById,
    issues,
  );
  if (policyKind !== "trust" && resources.length === 0) {
    issues.push(createIssue("empty-resources", path));
  }
  const principals = adaptPrincipals(
    policyKind,
    principalKind,
    principalValues,
    `${path}.semantic.configuration.values.principals`,
    issues,
  );
  const effect =
    effectValue === "allow" || effectValue === "deny" ? effectValue : undefined;
  if (effect === undefined) {
    issues.push(
      createIssue(
        "invalid-statement-configuration",
        `${path}.semantic.configuration.values.effect`,
      ),
    );
    return undefined;
  }
  const result = providerCanonicalPolicyStatementV1Schema.safeParse({
    id: node.id,
    statementIdentifier,
    effect,
    actions: sortCanonical(actions),
    resources,
    principals,
    conditions: sortCanonical(conditions),
    lifecycle: node.semantic.lifecycle,
  });
  if (!result.success) {
    issues.push(createIssue("invalid-canonical-policy", path));
    return undefined;
  }
  return result.data;
}

function statementFingerprint(
  statement: ProviderCanonicalPolicyStatementV1,
): string {
  return serializeCanonicalJson({
    effect: statement.effect,
    actions: statement.actions,
    resources: statement.resources,
    principals: statement.principals,
    conditions: sortCanonical(
      statement.conditions.map((condition) => ({
        operator: condition.operator,
        key: condition.key,
        values: condition.values,
      })),
    ),
  });
}

function validateBindingInstances(
  documentInstances: readonly OwnedConfigurationInstance[],
  statementInstances: readonly OwnedConfigurationInstance[],
  conditionInstances: readonly OwnedConfigurationInstance[],
  ownerDescriptorBySlotId: ReadonlyMap<string, ValidatedOwnerSlotDescriptor>,
  edgeIndexById: ReadonlyMap<ArchitectureEdge["id"], number>,
  edgeById: ReadonlyMap<ArchitectureEdge["id"], ArchitectureEdge>,
  issues: AwsCanonicalPolicyProjectionIssueV1[],
): void {
  documentInstances.forEach((instance) => {
    const edge = edgeById.get(instance.bindingEdgeId);
    const descriptor = ownerDescriptorBySlotId.get(instance.slotId);
    if (edge === undefined || descriptor === undefined) {
      issues.push(createIssue("invalid-owner-binding", "$.edges"));
      return;
    }
    validateEmptyBindingConfiguration(
      edge,
      descriptor.bindingConfigurationSchemaId,
      descriptor.bindingConfigurationSchemaVersion,
      edgePath(edge.id, edgeIndexById),
      "invalid-owner-binding",
      issues,
    );
  });
  statementInstances.forEach((instance) => {
    const edge = edgeById.get(instance.bindingEdgeId);
    if (edge === undefined) {
      issues.push(createIssue("invalid-statement-binding", "$.edges"));
      return;
    }
    validateEmptyBindingConfiguration(
      edge,
      configurationSchemaIdSchema.parse(
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership
          .configurationSchemaId,
      ),
      semanticVersionSchema.parse(
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership
          .configurationSchemaVersion,
      ),
      edgePath(edge.id, edgeIndexById),
      "invalid-statement-binding",
      issues,
    );
  });
  conditionInstances.forEach((instance) => {
    const edge = edgeById.get(instance.bindingEdgeId);
    if (edge === undefined) {
      issues.push(createIssue("invalid-condition-binding", "$.edges"));
      return;
    }
    validateEmptyBindingConfiguration(
      edge,
      configurationSchemaIdSchema.parse(
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership
          .configurationSchemaId,
      ),
      semanticVersionSchema.parse(
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership
          .configurationSchemaVersion,
      ),
      edgePath(edge.id, edgeIndexById),
      "invalid-condition-binding",
      issues,
    );
  });
}

/**
 * Projects graph-backed AWS policy nodes into the provider-SDK canonical
 * contract. The Architecture Document remains the only persisted source.
 */
export function projectAwsCanonicalPolicyDocumentsV1(
  documentInput: VersionedArchitectureDocument,
  options: AwsCanonicalPolicyProjectionOptionsV1,
): AwsCanonicalPolicyProjectionResultV1 {
  const issues: AwsCanonicalPolicyProjectionIssueV1[] = [];
  const ownerDescriptors = validateOwnerSlotDescriptors(
    options.ownerSlots,
    issues,
  );
  const scopeDescriptors = validateResourceScopeDescriptors(
    options.resourceScopes ?? AWS_IAM_POLICY_RESOURCE_SCOPES_V1,
    issues,
  );
  if (issues.length > 0 || ownerDescriptors.length === 0) {
    if (ownerDescriptors.length === 0 && issues.length === 0) {
      issues.push(
        createIssue("invalid-owner-slot-descriptor", "$.options.ownerSlots"),
      );
    }
    return Object.freeze({
      success: false,
      issues: Object.freeze(sortIssues(issues)),
    });
  }

  const document = parseArchitectureDocument(documentInput);
  const nodeById = new Map(
    document.nodes.map((node) => [node.id, node] as const),
  );
  const edgeById = new Map(
    document.edges.map((edge) => [edge.id, edge] as const),
  );
  const nodeIndexById = new Map(
    document.nodes.map((node, index) => [node.id, index] as const),
  );
  const edgeIndexById = new Map(
    document.edges.map((edge, index) => [edge.id, index] as const),
  );
  const documentClassification = classifyOwnedConfigurationNodes(
    document,
    policyDocumentDescriptorSet(ownerDescriptors),
  );
  const statementClassification = classifyOwnedConfigurationNodes(
    document,
    statementDescriptorSet(),
  );
  const conditionClassification = classifyOwnedConfigurationNodes(
    document,
    conditionDescriptorSet(),
  );
  if (!documentClassification.success) {
    appendClassificationIssues(
      documentClassification.issues,
      "invalid-owner-binding",
      issues,
    );
  }
  if (!statementClassification.success) {
    appendClassificationIssues(
      statementClassification.issues,
      "invalid-statement-binding",
      issues,
    );
  }
  if (!conditionClassification.success) {
    appendClassificationIssues(
      conditionClassification.issues,
      "invalid-condition-binding",
      issues,
    );
  }
  if (
    !documentClassification.success ||
    !statementClassification.success ||
    !conditionClassification.success
  ) {
    return Object.freeze({
      success: false,
      issues: Object.freeze(sortIssues(issues)),
    });
  }

  const ownerDescriptorBySlotId = new Map(
    ownerDescriptors.map((descriptor) => [
      String(descriptor.slot.id),
      descriptor,
    ]),
  );
  validateBindingInstances(
    documentClassification.instances,
    statementClassification.instances,
    conditionClassification.instances,
    ownerDescriptorBySlotId,
    edgeIndexById,
    edgeById,
    issues,
  );

  const conditionByStatementId = new Map<
    ArchitectureNode["id"],
    ProviderPolicyConditionV1[]
  >();
  conditionClassification.instances.forEach((instance) => {
    const conditionNode = nodeById.get(instance.configurationNodeId);
    const statementNode = nodeById.get(instance.ownerNodeId);
    if (conditionNode === undefined || statementNode === undefined) {
      issues.push(createIssue("invalid-condition-binding", "$.nodes"));
      return;
    }
    const path = nodePath(conditionNode.id, nodeIndexById);
    if (
      !lifecycleMatches(
        conditionNode.semantic.lifecycle,
        statementNode.semantic.lifecycle,
      )
    ) {
      issues.push(
        createIssue("lifecycle-mismatch", `${path}.semantic.lifecycle`),
      );
    }
    const condition = adaptCondition(conditionNode, path, issues);
    if (condition !== undefined) {
      const current = conditionByStatementId.get(statementNode.id) ?? [];
      current.push(condition);
      conditionByStatementId.set(statementNode.id, current);
    }
  });

  const statementsByDocumentId = new Map<
    ArchitectureNode["id"],
    ProviderCanonicalPolicyStatementV1[]
  >();
  const policyKindByDocumentId = new Map<
    ArchitectureNode["id"],
    ProviderPolicyDocumentKindV1
  >();
  documentClassification.instances.forEach((instance) => {
    const policyNode = nodeById.get(instance.configurationNodeId);
    if (policyNode === undefined) {
      return;
    }
    const path = nodePath(policyNode.id, nodeIndexById);
    const value = readString(
      policyNode.semantic.configuration,
      "policyKind",
      `${path}.semantic.configuration`,
      "invalid-policy-document-configuration",
      issues,
    );
    const result = providerPolicyDocumentKindV1Schema.safeParse(value);
    if (result.success) {
      policyKindByDocumentId.set(policyNode.id, result.data);
    }
  });

  statementClassification.instances.forEach((instance) => {
    const statementNode = nodeById.get(instance.configurationNodeId);
    const policyNode = nodeById.get(instance.ownerNodeId);
    const policyKind = policyKindByDocumentId.get(instance.ownerNodeId);
    if (
      statementNode === undefined ||
      policyNode === undefined ||
      policyKind === undefined
    ) {
      issues.push(createIssue("invalid-statement-binding", "$.nodes"));
      return;
    }
    const path = nodePath(statementNode.id, nodeIndexById);
    if (
      !lifecycleMatches(
        statementNode.semantic.lifecycle,
        policyNode.semantic.lifecycle,
      )
    ) {
      issues.push(
        createIssue("lifecycle-mismatch", `${path}.semantic.lifecycle`),
      );
    }
    const statement = adaptStatement(
      document,
      statementNode,
      policyKind,
      conditionByStatementId.get(statementNode.id) ?? [],
      scopeDescriptors,
      path,
      edgeIndexById,
      nodeById,
      issues,
    );
    if (statement !== undefined) {
      const current = statementsByDocumentId.get(policyNode.id) ?? [];
      current.push(statement);
      statementsByDocumentId.set(policyNode.id, current);
    }
  });

  const projected: ProviderCanonicalPolicyDocumentV1[] = [];
  documentClassification.instances.forEach((instance) => {
    const policyNode = nodeById.get(instance.configurationNodeId);
    const descriptor = ownerDescriptorBySlotId.get(instance.slotId);
    const policyKind = policyKindByDocumentId.get(instance.configurationNodeId);
    if (
      policyNode === undefined ||
      descriptor === undefined ||
      policyKind === undefined
    ) {
      issues.push(createIssue("invalid-owner-binding", "$.nodes"));
      return;
    }
    const path = nodePath(policyNode.id, nodeIndexById);
    validateExactKeys(
      policyNode.semantic.configuration,
      policyDocumentKeys,
      `${path}.semantic.configuration`,
      "invalid-policy-document-configuration",
      issues,
    );
    const displayName = readString(
      policyNode.semantic.configuration,
      "policyName",
      `${path}.semantic.configuration`,
      "invalid-policy-document-configuration",
      issues,
    );
    if (!descriptor.slot.policyKinds.includes(policyKind)) {
      issues.push(createIssue("policy-kind-not-allowed", path));
    }
    if (!slotAllowsLifecycle(descriptor.slot, policyNode.semantic.lifecycle)) {
      issues.push(createIssue("ownership-not-allowed", path));
    }
    const statements = sortCanonical(
      statementsByDocumentId.get(policyNode.id) ?? [],
    );
    const statementFingerprints = new Map<string, string>();
    statements.forEach((statement) => {
      const fingerprint = statementFingerprint(statement);
      if (statementFingerprints.has(fingerprint)) {
        issues.push(
          createIssue(
            "duplicate-equivalent-statement",
            nodePath(statement.id, nodeIndexById),
          ),
        );
      } else {
        statementFingerprints.set(fingerprint, statement.id);
      }
    });
    if (displayName === undefined) {
      return;
    }
    const result = providerCanonicalPolicyDocumentV1Schema.safeParse({
      contractVersion: 1,
      id: policyNode.id,
      ownerNodeId: instance.ownerNodeId,
      slotId: descriptor.slot.id,
      schemaVersion: policyNode.semantic.configuration.schemaVersion,
      displayName,
      policyKind,
      lifecycle: policyNode.semantic.lifecycle,
      statements,
      targetReadiness: canonicalClone(descriptor.slot.targetReadiness),
    });
    if (!result.success) {
      result.error.issues.forEach((entry) => {
        issues.push(
          createIssue(
            "invalid-canonical-policy",
            `${path}.projection.${entry.path.map(String).join(".")}`,
          ),
        );
      });
      return;
    }
    projected.push(result.data);
  });

  if (issues.length > 0) {
    return Object.freeze({
      success: false,
      issues: Object.freeze(sortIssues(issues)),
    });
  }
  return Object.freeze({
    success: true,
    documents: Object.freeze(
      projected
        .sort((left, right) => compareStrings(left.id, right.id))
        .map((documentValue) => deepFreeze(canonicalClone(documentValue))),
    ),
  });
}
