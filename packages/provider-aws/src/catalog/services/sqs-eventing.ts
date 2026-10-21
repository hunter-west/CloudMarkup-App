import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

import {
  eventDrivenRegionAvailability,
  eventDrivenValidationRuleIds,
  eventMetadataMappings,
  internalEventConfiguration,
} from "./event-driven-helpers.js";

const sqsDocumentation = [
  {
    kind: "official" as const,
    id: "aws.sqs.documentation.queues",
    title: "Amazon SQS queues",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html",
  },
];

export const sqsQueue = defineProviderServiceV1({
  id: "aws.sqs.queue",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "SQS queue",
  description:
    "A durable Standard or FIFO message queue that can also be selected as a dead-letter queue.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.sqs.queue",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.sqs",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.sqs.queue.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.sqs.queue.configuration:1.0.0",
      type: "object",
      title: "SQS queue configuration",
      description:
        "Bounded queue type, retention, visibility, long polling, encryption, and lifecycle settings.",
      additionalProperties: false,
      properties: {
        queueName: {
          type: "string",
          default: "application-events",
          minLength: 1,
          maxLength: 80,
          pattern: "^[A-Za-z0-9_-]+(?:\\.fifo)?$",
        },
        queueType: {
          type: "string",
          enum: ["STANDARD", "FIFO"],
          default: "STANDARD",
        },
        contentBasedDeduplication: { type: "boolean", default: false },
        visibilityTimeoutSeconds: {
          type: "integer",
          enum: [30, 60, 120, 300, 900],
          default: 60,
        },
        messageRetentionSeconds: {
          type: "integer",
          enum: [3600, 86400, 345600, 1209600],
          default: 345600,
        },
        receiveWaitTimeSeconds: {
          type: "integer",
          enum: [0, 10, 20],
          default: 20,
        },
        encryption: {
          type: "string",
          enum: ["SQS_MANAGED"],
          default: "SQS_MANAGED",
        },
        deletionProtectionEnabled: {
          type: "boolean",
          const: true,
          default: true,
        },
      },
      required: [
        "queueName",
        "queueType",
        "contentBasedDeduplication",
        "visibilityTimeoutSeconds",
        "messageRetentionSeconds",
        "receiveWaitTimeSeconds",
        "encryption",
        "deletionProtectionEnabled",
      ],
    },
    uiHints: [
      {
        property: "queueName",
        control: "text",
        label: "Queue name",
        helpText: "FIFO queue names must end in .fifo.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "queueType",
        control: "select",
        label: "Queue type",
        helpText:
          "Standard favors scale with at-least-once delivery; FIFO adds ordered message groups and deduplication constraints.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "contentBasedDeduplication",
        control: "checkbox",
        label: "Content-based FIFO deduplication",
        helpText: "Available only for a FIFO queue.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "visibilityTimeoutSeconds",
        control: "number",
        label: "Processing visibility timeout",
        helpText:
          "Keep this longer than the connected consumer timeout and batching window.",
        order: 3,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "messageRetentionSeconds",
        control: "number",
        label: "Message retention",
        order: 4,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "receiveWaitTimeSeconds",
        control: "number",
        label: "Long polling",
        order: 5,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "encryption",
        control: "select",
        label: "Encryption",
        helpText:
          "This slice uses SQS-managed encryption; customer-managed keys require a separate key-policy contract.",
        order: 6,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "deletionProtectionEnabled",
        control: "checkbox",
        label: "Protect from accidental deletion",
        order: 7,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.sqs.queue.message-send",
      displayName: "Message delivery",
      description: "Accepts messages from reviewed producers.",
      direction: "input",
      capability: "aws.sqs.message.send",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.sqs.queue.event-source",
      displayName: "Message consumption",
      description: "Provides polled messages to reviewed Lambda consumers.",
      direction: "output",
      capability: "aws.sqs.message.consume",
      category: "receives-events-from",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.sqs.queue.redrive",
      displayName: "Dead-letter redrive",
      description: "Sends repeatedly failed messages to one selected queue.",
      direction: "output",
      capability: "aws.sqs.queue.redrive",
      category: "sends-messages-or-events",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.sqs.queue.dead-letter-target",
      displayName: "Dead-letter target",
      description: "Accepts failed messages from reviewed source queues.",
      direction: "input",
      capability: "aws.sqs.queue.dead-letter-target",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.sqs.queue.policy-resource",
      displayName: "Policy resource",
      description: "Provides this queue ARN to typed IAM policy statements.",
      direction: "input",
      capability: "aws.iam.policy.sqs-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.sqs.queue.resource-policy",
      displayName: "Queue policy",
      description: "Accepts one reviewed queue resource policy.",
      direction: "input",
      capability: "aws.sqs.queue.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.sqs.queue.redrive-configuration",
      displayName: "Redrive configuration",
      description: "Accepts one bounded retry and dead-letter policy.",
      direction: "input",
      capability: "aws.sqs.queue.redrive-configuration",
      category: "uses-secrets-or-configuration",
      cardinality: "one",
      required: false,
    },
  ],
  validationRuleIds: [...eventDrivenValidationRuleIds],
  education: {
    summary:
      "Buffers messages for at-least-once processing and can isolate repeated failures in another queue.",
    guidedExplanation:
      "A queue separates producers from consumers. Standard queues can deliver duplicates or out of order; FIFO queues preserve order within a message group but require compatible producers and dead-letter queues. Keep the visibility timeout longer than consumer work.",
    professionalExplanation:
      "Models bounded Standard/FIFO queues with SSE-SQS, long polling, explicit retention/visibility, optional content-based FIFO deduplication, prevent-destroy intent, resource-policy and redrive slots, and exact producer/consumer ports.",
    considerations: [
      "Connections: Producers send to the queue; Lambda polls from it. The arrows are intentionally opposite and must not be reversed.",
      "Security: Use exact queue policies and identity permissions; encryption does not replace message-level data minimization.",
      "Cost: Requests, payload size, retention, empty receives, high-throughput patterns, and repeated retries affect charges.",
      "Operations: Make consumers idempotent, monitor oldest-message age and DLQ depth, and replay failures only after correcting their cause.",
    ],
    documentation: sqsDocumentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.sqs.unsupported.advanced-throughput-redrive",
      title: "Advanced throughput and redrive modes",
      explanation:
        "High-throughput FIFO tuning, per-message timers, DLQ redrive tasks, redrive allow-all/deny-all, cross-account queues, and arbitrary queue policies are outside this slice.",
    },
    {
      id: "aws.sqs.unsupported.cmk-large-payload",
      title: "Customer-managed keys and extended payloads",
      explanation:
        "Customer-managed KMS keys, the S3 extended client, payload offloading, and messages above the provider limit require separate contracts.",
    },
    {
      id: "aws.sqs.unsupported.exactly-once",
      title: "Exactly-once processing claim",
      explanation:
        "FIFO deduplication does not make a complete application exactly once. Consumers must still implement reviewed idempotency.",
    },
  ],
  mappings: eventMetadataMappings({
    mappingIdPrefix: "aws.sqs.queue",
    terraformResourceType: "aws_sqs_queue",
    cloudFormationTypeName: "AWS::SQS::Queue",
    terraformConfigurationBindings: [
      { configurationKey: "queueName", targetName: "name" },
      { configurationKey: "queueType", targetName: "fifo_queue" },
      {
        configurationKey: "contentBasedDeduplication",
        targetName: "content_based_deduplication",
      },
      {
        configurationKey: "visibilityTimeoutSeconds",
        targetName: "visibility_timeout_seconds",
      },
      {
        configurationKey: "messageRetentionSeconds",
        targetName: "message_retention_seconds",
      },
      {
        configurationKey: "receiveWaitTimeSeconds",
        targetName: "receive_wait_time_seconds",
      },
      { configurationKey: "encryption", targetName: "sqs_managed_sse_enabled" },
    ],
    cloudFormationConfigurationBindings: [
      { configurationKey: "queueName", targetName: "QueueName" },
      { configurationKey: "queueType", targetName: "FifoQueue" },
      {
        configurationKey: "contentBasedDeduplication",
        targetName: "ContentBasedDeduplication",
      },
      {
        configurationKey: "visibilityTimeoutSeconds",
        targetName: "VisibilityTimeout",
      },
      {
        configurationKey: "messageRetentionSeconds",
        targetName: "MessageRetentionPeriod",
      },
      {
        configurationKey: "receiveWaitTimeSeconds",
        targetName: "ReceiveMessageWaitTimeSeconds",
      },
      { configurationKey: "encryption", targetName: "SqsManagedSseEnabled" },
    ],
    semanticConfigurationKeys: ["deletionProtectionEnabled"],
    terraformPortBindings: [
      { portId: "aws.sqs.queue.message-send", targetAttribute: "arn" },
      { portId: "aws.sqs.queue.event-source", targetAttribute: "arn" },
      { portId: "aws.sqs.queue.redrive", targetAttribute: "arn" },
      { portId: "aws.sqs.queue.dead-letter-target", targetAttribute: "arn" },
      { portId: "aws.sqs.queue.policy-resource", targetAttribute: "arn" },
      { portId: "aws.sqs.queue.resource-policy", targetAttribute: "url" },
      { portId: "aws.sqs.queue.redrive-configuration", targetAttribute: "url" },
    ],
    cloudFormationPortBindings: [
      { portId: "aws.sqs.queue.message-send", targetAttribute: "Arn" },
      { portId: "aws.sqs.queue.event-source", targetAttribute: "Arn" },
      { portId: "aws.sqs.queue.redrive", targetAttribute: "Arn" },
      { portId: "aws.sqs.queue.dead-letter-target", targetAttribute: "Arn" },
      { portId: "aws.sqs.queue.policy-resource", targetAttribute: "Arn" },
      { portId: "aws.sqs.queue.resource-policy", targetAttribute: "QueueUrl" },
      {
        portId: "aws.sqs.queue.redrive-configuration",
        targetAttribute: "QueueUrl",
      },
    ],
  }),
  regionAvailability: eventDrivenRegionAvailability,
});

export const sqsRedriveConfiguration = defineProviderServiceV1(
  internalEventConfiguration({
    serviceId: "aws.sqs.redrive-configuration",
    resourceType: "aws.sqs.redrive-configuration",
    displayName: "SQS redrive configuration",
    description:
      "A bounded retry count and dead-letter policy owned by one SQS source queue.",
    ownerServiceId: "aws.sqs.queue",
    ownerRelationshipType: "aws.sqs.queue-owns-redrive-configuration",
    configuration: {
      schemaId: "aws.sqs.redrive-configuration.configuration",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:aws.sqs.redrive-configuration.configuration:1.0.0",
        type: "object",
        title: "SQS redrive configuration",
        description:
          "Maximum receives before dead-lettering and a closed source-queue allow posture.",
        additionalProperties: false,
        properties: {
          maximumReceiveCount: {
            type: "integer",
            enum: [2, 3, 5, 10],
            default: 5,
          },
          redrivePermission: {
            type: "string",
            enum: ["BY_QUEUE"],
            default: "BY_QUEUE",
          },
          replayMode: {
            type: "string",
            enum: ["MANUAL_REVIEW"],
            default: "MANUAL_REVIEW",
          },
        },
        required: ["maximumReceiveCount", "redrivePermission", "replayMode"],
      },
      uiHints: [
        {
          property: "maximumReceiveCount",
          control: "number",
          label: "Attempts before dead-lettering",
          helpText:
            "Allow enough attempts for transient failures without retrying poison messages indefinitely.",
          order: 0,
          advanced: false,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "cost-sensitive",
        },
        {
          property: "redrivePermission",
          control: "select",
          label: "Allowed source queues",
          helpText: "Only explicitly connected source queues may use this DLQ.",
          order: 1,
          advanced: true,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "none",
        },
        {
          property: "replayMode",
          control: "select",
          label: "Replay behavior",
          helpText:
            "Failed messages are replayed only after a person reviews the cause and destination.",
          order: 2,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
      ],
    },
    ports: [
      {
        id: "aws.sqs.redrive-configuration.queue",
        displayName: "Owning source queue",
        description: "Provides this redrive policy to one source queue.",
        direction: "output",
        capability: "aws.sqs.queue.redrive-configuration",
        category: "uses-secrets-or-configuration",
        cardinality: "one",
        required: true,
      },
    ],
    education: {
      summary:
        "Moves a message to a reviewed dead-letter queue after bounded failed receives.",
      guidedExplanation:
        "A dead-letter queue is another ordinary queue. After a message fails the selected number of receives, it moves there for investigation; the catalog never selects automatic replay.",
      professionalExplanation:
        "Models maxReceiveCount plus explicit byQueue redrive permission and manual-review replay posture. Queue-type compatibility and graph cycles are deterministic validation concerns.",
      considerations: [
        "Connections: Bind one compatible DLQ through the exact queue redrive relationship.",
        "Security: Restrict the DLQ to explicitly connected source queues and avoid exposing message bodies in findings.",
        "Cost: Retries, retention, inspection, and replay all create queue requests and storage time.",
        "Operations: Alarm on DLQ depth and age, correct the failure, then review replay destination and volume.",
      ],
      documentation: [
        {
          kind: "official",
          id: "aws.sqs.documentation.dead-letter-queues",
          title: "Using dead-letter queues in Amazon SQS",
          publisher: "Amazon Web Services",
          url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html",
        },
      ],
    },
    unsupportedCapabilities: [
      {
        id: "aws.sqs.redrive.unsupported.automatic-replay",
        title: "Automatic or unreviewed replay",
        explanation:
          "Automatic redrive tasks, allow-all/deny-all source policies, cross-account DLQs, and unreviewed replay are rejected.",
      },
    ],
    mappings: eventMetadataMappings({
      mappingIdPrefix: "aws.sqs.redrive-configuration",
      terraformResourceType: "aws_sqs_queue_redrive_policy",
      cloudFormationTypeName: "AWS::SQS::Queue",
      terraformConfigurationBindings: [
        {
          configurationKey: "maximumReceiveCount",
          targetName: "redrive_policy.maxReceiveCount",
        },
        {
          configurationKey: "redrivePermission",
          targetName: "redrive_allow_policy.redrivePermission",
        },
      ],
      cloudFormationConfigurationBindings: [
        {
          configurationKey: "maximumReceiveCount",
          targetName: "RedrivePolicy.maxReceiveCount",
        },
        {
          configurationKey: "redrivePermission",
          targetName: "RedriveAllowPolicy.redrivePermission",
        },
      ],
      semanticConfigurationKeys: ["replayMode"],
      terraformPortBindings: [
        {
          portId: "aws.sqs.redrive-configuration.queue",
          targetAttribute: "queue_url",
        },
      ],
      cloudFormationPortBindings: [
        {
          portId: "aws.sqs.redrive-configuration.queue",
          targetAttribute: "QueueUrl",
        },
      ],
      terraformProjection: {
        kind: "owned-resource",
        rendererContractId: "aws.sqs.redrive-configuration.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: ["aws_sqs_queue_redrive_allow_policy"],
      },
      cloudFormationProjection: {
        kind: "owner-nested-block",
        rendererContractId: "aws.sqs.queue.redrive-configuration.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
    }),
  }),
);
