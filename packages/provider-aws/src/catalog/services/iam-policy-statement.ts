import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const iamPolicyStatement0_10_0 = defineProviderServiceV1({
  id: "aws.iam.policy-statement",
  definitionVersion: "2.0.0",
  supportLevel: "production-oriented",
  displayName: "IAM policy statement",
  description: "One canonical typed statement owned by an IAM policy document.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.iam.policy-statement",
    deployable: false,
  },
  iconId: "aws.cloudmarkup.icons.iam-policy",
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.iam.policy-document",
        relationshipType: "aws.iam.policy-contains-statement",
      },
    ],
    maximumDepth: 3,
    regionConstraint: "not-applicable",
  },
  configuration: {
    schemaId: "aws.iam.policy-statement.configuration",
    schemaVersion: "2.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.iam.policy-statement.configuration:2.0.0",
      type: "object",
      title: "Canonical IAM statement configuration",
      description:
        "A structured statement with a closed effect, typed action and principal fields, graph resource references, and child conditions.",
      additionalProperties: false,
      properties: {
        statementId: {
          type: "string",
          default: "NotesTableAccess",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9]+$",
        },
        effect: {
          type: "string",
          enum: ["allow", "deny"],
          default: "allow",
        },
        actions: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 64,
          uniqueItems: true,
        },
        principalKind: {
          type: "string",
          enum: [
            "none",
            "service",
            "architecture-node",
            "provider-identity",
            "federated",
            "all-principals",
          ],
          default: "none",
        },
        principals: {
          type: "array",
          items: { type: "string" },
          default: [],
          maxItems: 32,
          uniqueItems: true,
        },
        resourceExpressions: {
          type: "array",
          items: { type: "string" },
          default: [],
          maxItems: 32,
          uniqueItems: true,
        },
        resourceNode: {
          type: "string",
          minLength: 1,
          maxLength: 256,
        },
      },
      required: [
        "statementId",
        "effect",
        "actions",
        "principalKind",
        "principals",
        "resourceExpressions",
      ],
    },
    uiHints: [
      {
        property: "statementId",
        control: "text",
        label: "Statement ID",
        order: 0,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "effect",
        control: "select",
        label: "Effect",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "actions",
        control: "multi-select",
        label: "Actions",
        helpText:
          "Choose exact service actions. Wildcards are accepted only so validation can report and block them precisely.",
        order: 2,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "principalKind",
        control: "select",
        label: "Principal type",
        helpText:
          "Principals are required for trust, resource, and service-grant policies and forbidden for identity policies.",
        order: 3,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "principals",
        control: "multi-select",
        label: "Principals",
        order: 4,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "resourceExpressions",
        control: "multi-select",
        label: "Advanced resource expressions",
        helpText:
          "Prefer graph resource references. Explicit expressions remain advanced and are validated for wildcards.",
        order: 5,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "resourceNode",
        control: "text",
        label: "Architecture resource",
        helpText:
          "Prefer a graph node; CloudMarkup resolves its target-specific identifier during future compilation.",
        order: 6,
        advanced: false,
        valueSource: "node-reference",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.iam.policy-statement.policy-document",
      displayName: "Policy document",
      description: "Provides this statement to its containing policy document.",
      direction: "output",
      capability: "aws.iam.policy.statement-member",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.iam.policy-statement.dynamodb-resource",
      displayName: "DynamoDB resource",
      description: "Scopes the statement to the connected DynamoDB table ARN.",
      direction: "output",
      capability: "aws.iam.policy.dynamodb-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.policy-statement.lambda-resource",
      displayName: "Lambda resource",
      description: "Scopes the statement to the connected Lambda function ARN.",
      direction: "output",
      capability: "aws.iam.policy.lambda-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.policy-statement.log-group-resource",
      displayName: "Log-group resource",
      description:
        "Scopes the statement to the connected CloudWatch log group ARN.",
      direction: "output",
      capability: "aws.iam.policy.log-group-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.policy-statement.condition",
      displayName: "Condition",
      description: "Accepts structured conditions owned by this statement.",
      direction: "input",
      capability: "aws.iam.policy.condition",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.iam-policy-safety",
    "aws.cloudmarkup.validation.iam-wildcards",
    "aws.cloudmarkup.validation.lambda-dynamodb-actions",
  ],
  education: {
    summary:
      "Defines one effect, action set, resource scope, and optional principal or conditions.",
    guidedExplanation:
      "A statement answers four questions: allow or deny what actions, against which resources, for which principal when that policy kind permits one, and under what optional conditions. Prefer exact actions and connected graph resources.",
    professionalExplanation:
      "The canonical projection combines the versioned effect and actions with typed resource-scope edges, policy-kind-valid principals, child conditions, owner slot, and lifecycle provenance. Unsupported raw IAM JSON is never a second source of truth.",
    considerations: [
      "Connections: Scope resources through exact DynamoDB, Lambda, or log-group graph edges and attach the statement to one policy document.",
      "Security: Wildcard actions, resources, or principals produce findings; principals are valid only for policy kinds that permit them.",
      "Cost: Allowed actions can create, read, or operate billable resources; this statement carries no provider cost estimate.",
      "Operations: Use one coherent purpose per statement and add typed conditions only when their key and operator are understood.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.iam.documentation.policy-statement",
        title: "IAM JSON policy elements",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.iam.unsupported.raw-policy-language",
      title: "Raw IAM policy language",
      explanation:
        "NotAction, NotResource, arbitrary JSON, and unreviewed condition operators are not exposed by the structured editor.",
    },
    {
      id: "aws.iam.unsupported.cloudformation-policy-rendering",
      title: "CloudFormation policy rendering pending",
      explanation:
        "Terraform renders bounded policy statements; CloudFormation policy rendering remains pending.",
    },
  ],
  mappings: [],
  regionAvailability: {
    state: "unknown",
    reason:
      "IAM policy statements have global semantics, but no reviewed catalog policy currently translates those semantics into region availability.",
  },
});

export const iamPolicyStatement = defineProviderServiceV1({
  ...iamPolicyStatement0_10_0,
  unsupportedCapabilities:
    iamPolicyStatement0_10_0.unsupportedCapabilities.filter(
      (entry) =>
        entry.id !== "aws.iam.unsupported.cloudformation-policy-rendering",
    ),
  definitionVersion: "2.1.0",
  ports: [
    ...iamPolicyStatement0_10_0.ports,
    {
      id: "aws.iam.policy-statement.s3-resource",
      displayName: "S3 resource",
      description: "Scopes the statement to a connected S3 bucket ARN.",
      direction: "output",
      capability: "aws.iam.policy.s3-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.policy-statement.sqs-resource",
      displayName: "SQS resource",
      description: "Scopes the statement to a connected SQS queue ARN.",
      direction: "output",
      capability: "aws.iam.policy.sqs-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.policy-statement.sns-resource",
      displayName: "SNS resource",
      description: "Scopes the statement to a connected SNS topic ARN.",
      direction: "output",
      capability: "aws.iam.policy.sns-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.policy-statement.eventbridge-resource",
      displayName: "EventBridge resource",
      description: "Scopes the statement to a connected EventBridge bus ARN.",
      direction: "output",
      capability: "aws.iam.policy.eventbridge-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.iam.policy-statement.step-functions-resource",
      displayName: "Step Functions resource",
      description:
        "Scopes the statement to a connected Step Functions state-machine ARN.",
      direction: "output",
      capability: "aws.iam.policy.step-functions-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [
    ...iamPolicyStatement0_10_0.validationRuleIds,
    "aws.cloudmarkup.validation.event-delivery",
  ],
  education: {
    ...iamPolicyStatement0_10_0.education,
    guidedExplanation:
      "A statement answers four questions: allow or deny which exact actions, against which connected resources, for which principal when that policy kind permits one, and under which typed conditions. Event services use the same canonical policy shape as the established API and data slice.",
    professionalExplanation:
      "The canonical projection combines versioned effect/actions with typed DynamoDB, Lambda, log-group, S3, SQS, SNS, EventBridge, or Step Functions resource-scope edges, policy-kind-valid principals, child conditions, owner slot, and lifecycle provenance.",
    considerations: [
      "Connections: Scope resources through exact graph edges and attach the statement to one policy document; never paste an ARN or raw policy document.",
      "Security: Wildcard actions, resources, or principals produce findings; service principals require reviewed SourceArn/SourceAccount conditions where the target policy demands them.",
      "Cost: Allowed actions can create publish, delivery, transition, or storage cost; this statement carries no provider price estimate.",
      "Operations: Use one coherent purpose per statement and preserve generated versus user-owned cleanup authority.",
    ],
  },
});

/** Absolute graph depth includes Region, VPC and endpoint owner ancestry.
 * Historical service objects above remain byte-reproducible. */
export const iamPolicyStatement0_16_0 = defineProviderServiceV1({
  ...iamPolicyStatement,
  definitionVersion: "2.2.0",
  placement: { ...iamPolicyStatement.placement, maximumDepth: 5 },
});
