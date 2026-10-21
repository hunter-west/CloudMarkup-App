import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const iamRole0_8_0 = defineProviderServiceV1({
  id: "aws.iam.role",
  definitionVersion: "2.0.0",
  supportLevel: "production-oriented",
  displayName: "IAM role",
  description:
    "An IAM role with typed trust, custom, generated, managed-policy, and permissions-boundary configuration slots.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.iam.role",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.iam-role",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "not-applicable",
  },
  configuration: {
    schemaId: "aws.iam.role.configuration",
    schemaVersion: "2.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.iam.role.configuration:2.0.0",
      type: "object",
      title: "IAM role configuration",
      description:
        "Stable role settings. Trust and permissions are graph-backed owned configurations rather than competing scalar fields.",
      additionalProperties: false,
      properties: {
        roleName: {
          type: "string",
          default: "notes-api-lambda-role",
          minLength: 1,
          maxLength: 64,
          pattern: "^[A-Za-z0-9+=,.@_-]+$",
        },
        maxSessionDurationSeconds: {
          type: "integer",
          enum: [3600],
          default: 3600,
        },
      },
      required: ["roleName", "maxSessionDurationSeconds"],
    },
    uiHints: [
      {
        property: "roleName",
        control: "text",
        label: "Role name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "maxSessionDurationSeconds",
        control: "number",
        label: "Maximum session duration",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.iam.role.assumable-role",
      displayName: "Assumable role",
      description: "Provides the role ARN to the Lambda function.",
      direction: "output",
      capability: "aws.iam.role.assume.lambda",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.iam.role.trust-policy",
      displayName: "Trust policy",
      description:
        "Accepts the one policy controlling who may assume this role.",
      direction: "input",
      capability: "aws.iam.role.trust-policy",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.iam.role.custom-inline-policy",
      displayName: "Custom inline policy",
      description:
        "Accepts user-authored identity policies owned by this role.",
      direction: "input",
      capability: "aws.iam.role.custom-inline-policy",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.role.generated-permission",
      displayName: "Generated permission",
      description:
        "Accepts connection-generated identity policies whose lifecycle remains provider-owned until adoption.",
      direction: "input",
      capability: "aws.iam.role.generated-permission",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.role.managed-policy",
      displayName: "Managed policy",
      description: "Accepts zero or more reviewed managed-policy attachments.",
      direction: "input",
      capability: "aws.iam.role.managed-policy-attachment",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.role.permissions-boundary",
      displayName: "Permissions boundary",
      description: "Accepts at most one reviewed permissions boundary.",
      direction: "input",
      capability: "aws.iam.role.permissions-boundary",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.iam-policy-safety",
    "aws.cloudmarkup.validation.lambda-dynamodb-actions",
    "aws.cloudmarkup.validation.lambda-execution-role",
  ],
  education: {
    summary:
      "Gives a workload an assumable identity with separately owned trust and permission policies.",
    guidedExplanation:
      "The trust policy decides who may assume the role. Custom policies are permissions you own, generated policies come from reviewed service connections, managed policies add reviewed permission sets, and a boundary can limit the maximum effective permissions.",
    professionalExplanation:
      "Models one Lambda-assumable IAM role whose trust, user-authored inline policies, generated permissions, managed-policy attachments, and optional permissions boundary occupy exact graph-backed slots with independent cardinality, provenance, lifecycle authority, and target readiness.",
    considerations: [
      "Connections: Bind the role to one Lambda function; each trust, generated, custom, managed, or boundary policy uses its exact owner slot.",
      "Security: Review both who can assume the role and what it can do; a permissions boundary limits but never grants permissions.",
      "Cost: Role configuration has no catalog cost estimate, and its permissions may authorize provider operations that incur charges.",
      "Operations: Connection cleanup may release only generated policies it still owns; user-authored policies require explicit user action.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.iam.documentation.role",
        title: "IAM roles",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.iam.unsupported.raw-policy-json",
      title: "Unrestricted raw policy JSON",
      explanation:
        "The default editor uses typed statements, principals, resources, and conditions instead of arbitrary JSON.",
    },
    {
      id: "aws.iam.unsupported.cloudformation-policy-rendering",
      title: "CloudFormation policy rendering pending",
      explanation:
        "Terraform renders the supported owned-policy family; CloudFormation policy rendering remains pending.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.iam.role.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_iam_role",
      configurationBindings: [
        { configurationKey: "roleName", targetName: "name" },
        {
          configurationKey: "maxSessionDurationSeconds",
          targetName: "max_session_duration",
        },
      ],
      portBindings: [
        {
          portId: "aws.iam.role.assumable-role",
          targetAttribute: "arn",
        },
      ],
    },
    {
      mappingId: "aws.iam.role.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::IAM::Role",
      configurationBindings: [
        { configurationKey: "roleName", targetName: "RoleName" },
        {
          configurationKey: "maxSessionDurationSeconds",
          targetName: "MaxSessionDuration",
        },
      ],
      portBindings: [],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "IAM has global semantics, but no reviewed catalog policy currently translates those semantics into region availability.",
  },
});

export const iamRole0_10_0 = defineProviderServiceV1({
  ...iamRole0_8_0,
  definitionVersion: "2.1.0",
  validationRuleIds: [
    ...iamRole0_8_0.validationRuleIds,
    "aws.cloudmarkup.validation.lambda-vpc-access",
  ],
});

export const iamRole = defineProviderServiceV1({
  ...iamRole0_10_0,
  unsupportedCapabilities: iamRole0_10_0.unsupportedCapabilities.filter(
    (entry) =>
      entry.id !== "aws.iam.unsupported.cloudformation-policy-rendering",
  ),
  definitionVersion: "2.2.0",
  ports: iamRole0_10_0.ports.map((port) =>
    port.id === "aws.iam.role.assumable-role"
      ? {
          ...port,
          description:
            "Provides this role ARN to one reviewed Lambda, Step Functions state machine, or EventBridge target.",
          capability: "aws.iam.role.assume.service",
        }
      : port,
  ),
  education: {
    ...iamRole0_10_0.education,
    guidedExplanation:
      "The trust policy decides which reviewed AWS service may assume this role. Custom policies are permissions you own, generated policies come from reviewed service connections, managed policies add reviewed permission sets, and a boundary can limit the maximum effective permissions.",
    professionalExplanation:
      "Models one service-assumable IAM role whose trust, user-authored inline policies, generated permissions, managed-policy attachments, and optional permissions boundary occupy exact graph-backed slots with independent cardinality, provenance, lifecycle authority, and target readiness.",
    considerations: [
      "Connections: Bind the role to one reviewed Lambda function, Step Functions state machine, or EventBridge target; each trust, generated, custom, managed, or boundary policy uses its exact owner slot.",
      ...iamRole0_10_0.education.considerations.slice(1),
    ],
  },
});
