import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const dynamodbTable0_8_0 = defineProviderServiceV1({
  id: "aws.dynamodb.table",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "DynamoDB table",
  description:
    "A secure on-demand DynamoDB table for notes keyed by a single string identifier.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.dynamodb.table",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.dynamodb",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.dynamodb.table.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.dynamodb.table.configuration:1.0.0",
      type: "object",
      title: "DynamoDB notes table configuration",
      description:
        "Bounded on-demand table settings for the authenticated notes API.",
      additionalProperties: false,
      properties: {
        tableName: {
          type: "string",
          default: "notes",
          minLength: 3,
          maxLength: 255,
          pattern: "^[A-Za-z0-9_.-]+$",
        },
        billingMode: {
          type: "string",
          enum: ["PAY_PER_REQUEST"],
          default: "PAY_PER_REQUEST",
        },
        partitionKeyName: {
          type: "string",
          default: "noteId",
          minLength: 1,
          maxLength: 255,
          pattern: "^[A-Za-z][A-Za-z0-9_]*$",
        },
        partitionKeyType: {
          type: "string",
          enum: ["S"],
          default: "S",
        },
        pointInTimeRecoveryEnabled: { type: "boolean", default: true },
        serverSideEncryptionEnabled: {
          type: "boolean",
          const: true,
          default: true,
        },
        deletionProtectionEnabled: { type: "boolean", default: true },
      },
      required: [
        "tableName",
        "billingMode",
        "partitionKeyName",
        "partitionKeyType",
        "pointInTimeRecoveryEnabled",
        "serverSideEncryptionEnabled",
        "deletionProtectionEnabled",
      ],
    },
    uiHints: [
      {
        property: "tableName",
        control: "text",
        label: "Table name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "billingMode",
        control: "select",
        label: "Billing mode",
        helpText: "The first slice uses on-demand request billing only.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "partitionKeyName",
        control: "text",
        label: "Partition key",
        order: 2,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "partitionKeyType",
        control: "select",
        label: "Partition key type",
        order: 3,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "pointInTimeRecoveryEnabled",
        control: "checkbox",
        label: "Point-in-time recovery",
        order: 4,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "serverSideEncryptionEnabled",
        control: "checkbox",
        label: "Server-side encryption",
        order: 5,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "deletionProtectionEnabled",
        control: "checkbox",
        label: "Deletion protection",
        order: 6,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.dynamodb.table.table-api",
      displayName: "Table API",
      description:
        "Accepts bounded notes-table access from the Lambda function.",
      direction: "input",
      capability: "aws.dynamodb.table.read-write",
      category: "reads-or-writes-data",
      cardinality: "many",
      required: true,
    },
    {
      id: "aws.dynamodb.table.policy-resource",
      displayName: "Policy resource",
      description: "Provides the table ARN to a bounded IAM policy statement.",
      direction: "input",
      capability: "aws.iam.policy.dynamodb-resource",
      category: "network-and-security",
      cardinality: "many",
      required: true,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.connection-questions",
    "aws.cloudmarkup.validation.dynamodb-protection",
    "aws.cloudmarkup.validation.lambda-dynamodb-actions",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Stores notes by one stable string key with on-demand request billing.",
    guidedExplanation:
      "This table stores one item collection keyed by note ID. A connected Lambda receives only the reviewed read or write actions, while encryption, recovery, and deletion protection reduce common data-loss risks.",
    professionalExplanation:
      "Models a single-string-partition-key DynamoDB table in PAY_PER_REQUEST mode with server-side encryption, point-in-time recovery, and deletion protection. Typed Lambda relationships determine exact actions and graph resource scope; indexes, streams, global tables, and provisioned capacity are excluded.",
    considerations: [
      "Connections: Use separate reviewed read-only or read-write Lambda relationships; the table ARN scopes the generated permission.",
      "Security: Keep encryption and deletion protection enabled, and never broaden a table-scoped policy to a wildcard resource.",
      "Cost: PAY_PER_REQUEST follows request volume; stored data and point-in-time recovery add charges that this catalog does not estimate.",
      "Operations: Confirm the single-key access pattern fits every workload operation and test recovery before relying on it.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.dynamodb.documentation.table",
        title: "Core components of Amazon DynamoDB",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.dynamodb.unsupported.indexes-streams-global",
      title: "Indexes, streams, and global tables",
      explanation:
        "Secondary indexes, DynamoDB Streams, global tables, DAX, imports, and exports are outside this notes-table slice.",
    },
    {
      id: "aws.dynamodb.unsupported.provisioned-cmk",
      title: "Provisioned capacity and customer-managed keys",
      explanation:
        "Provisioned autoscaling and customer-managed KMS keys require later cost and key-policy semantics.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.dynamodb.table.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_dynamodb_table",
      configurationBindings: [
        { configurationKey: "tableName", targetName: "name" },
        { configurationKey: "billingMode", targetName: "billing_mode" },
        { configurationKey: "partitionKeyName", targetName: "hash_key" },
        {
          configurationKey: "partitionKeyType",
          targetName: "attribute.type",
        },
        {
          configurationKey: "pointInTimeRecoveryEnabled",
          targetName: "point_in_time_recovery.enabled",
        },
        {
          configurationKey: "serverSideEncryptionEnabled",
          targetName: "server_side_encryption.enabled",
        },
        {
          configurationKey: "deletionProtectionEnabled",
          targetName: "deletion_protection_enabled",
        },
      ],
      portBindings: [
        {
          portId: "aws.dynamodb.table.table-api",
          targetAttribute: "arn",
        },
        {
          portId: "aws.dynamodb.table.policy-resource",
          targetAttribute: "arn",
        },
      ],
    },
    {
      mappingId: "aws.dynamodb.table.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::DynamoDB::Table",
      configurationBindings: [
        { configurationKey: "tableName", targetName: "TableName" },
        { configurationKey: "billingMode", targetName: "BillingMode" },
        { configurationKey: "partitionKeyName", targetName: "KeySchema.Hash" },
        {
          configurationKey: "partitionKeyType",
          targetName: "AttributeDefinitions.Hash.AttributeType",
        },
        {
          configurationKey: "pointInTimeRecoveryEnabled",
          targetName:
            "PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled",
        },
        {
          configurationKey: "serverSideEncryptionEnabled",
          targetName: "SSESpecification.SSEEnabled",
        },
        {
          configurationKey: "deletionProtectionEnabled",
          targetName: "DeletionProtectionEnabled",
        },
      ],
      portBindings: [
        {
          portId: "aws.dynamodb.table.table-api",
          targetAttribute: "Arn",
        },
        {
          portId: "aws.dynamodb.table.policy-resource",
          targetAttribute: "Arn",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound AWS regional availability dataset is bundled with this catalog.",
  },
});

export const dynamodbTable = defineProviderServiceV1({
  ...dynamodbTable0_8_0,
  definitionVersion: "1.1.0",
  validationRuleIds: [
    ...dynamodbTable0_8_0.validationRuleIds,
    "aws.cloudmarkup.validation.network-placement",
  ],
});
