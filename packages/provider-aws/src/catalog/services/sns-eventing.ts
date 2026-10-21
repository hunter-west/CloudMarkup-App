import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

import {
  eventDrivenRegionAvailability,
  eventDrivenValidationRuleIds,
  eventMetadataMappings,
  internalEventConfiguration,
} from "./event-driven-helpers.js";

const snsDocumentation = [
  {
    kind: "official" as const,
    id: "aws.sns.documentation.topic-subscription",
    title: "Amazon SNS topics and subscriptions",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html",
  },
];

export const snsTopic = defineProviderServiceV1({
  id: "aws.sns.topic",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "SNS topic",
  description:
    "A Standard or FIFO publish/subscribe topic with explicit subscriptions and resource policy.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.sns.topic",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.sns",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.sns.topic.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.sns.topic.configuration:1.0.0",
      type: "object",
      title: "SNS topic configuration",
      description:
        "Bounded topic type, deduplication, managed encryption, and lifecycle settings.",
      additionalProperties: false,
      properties: {
        topicName: {
          type: "string",
          default: "application-events",
          minLength: 1,
          maxLength: 256,
          pattern: "^[A-Za-z0-9_-]+(?:\\.fifo)?$",
        },
        topicType: {
          type: "string",
          enum: ["STANDARD", "FIFO"],
          default: "STANDARD",
        },
        contentBasedDeduplication: { type: "boolean", default: false },
        encryption: {
          type: "string",
          enum: ["AWS_MANAGED_KMS"],
          default: "AWS_MANAGED_KMS",
        },
        deletionProtectionEnabled: {
          type: "boolean",
          const: true,
          default: true,
        },
      },
      required: [
        "topicName",
        "topicType",
        "contentBasedDeduplication",
        "encryption",
        "deletionProtectionEnabled",
      ],
    },
    uiHints: [
      {
        property: "topicName",
        control: "text",
        label: "Topic name",
        helpText: "FIFO topic names must end in .fifo.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "topicType",
        control: "select",
        label: "Topic type",
        helpText:
          "Standard supports broad fan-out. FIFO requires compatible FIFO subscriptions and message-group metadata.",
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
        helpText: "Available only for a FIFO topic.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "encryption",
        control: "select",
        label: "Encryption",
        helpText:
          "Uses the AWS-managed SNS KMS key. Custom keys require explicit key-policy and cost support.",
        order: 3,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "deletionProtectionEnabled",
        control: "checkbox",
        label: "Protect from accidental deletion",
        order: 4,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.sns.topic.publish",
      displayName: "Publish",
      description: "Accepts events or messages from reviewed publishers.",
      direction: "input",
      capability: "aws.sns.topic.publish",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.sns.topic.subscriptions",
      displayName: "Subscriptions",
      description: "Owns reviewed fan-out subscriptions.",
      direction: "output",
      capability: "aws.sns.topic.subscription",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.sns.topic.policy-resource",
      displayName: "Policy resource",
      description: "Provides this topic ARN to typed IAM policy statements.",
      direction: "input",
      capability: "aws.iam.policy.sns-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.sns.topic.resource-policy",
      displayName: "Topic policy",
      description: "Accepts one reviewed topic resource policy.",
      direction: "input",
      capability: "aws.sns.topic.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
  ],
  validationRuleIds: [...eventDrivenValidationRuleIds],
  education: {
    summary:
      "Publishes one message to multiple independently reviewed subscriptions.",
    guidedExplanation:
      "Use a topic when one event should fan out to several consumers. Each subscription is explicit and can apply a small, reviewable filter. Delivery can be retried or duplicated, so consumers must be idempotent.",
    professionalExplanation:
      "Models Standard/FIFO topics with optional content-based FIFO deduplication, AWS-managed KMS encryption, prevent-destroy intent, one resource-policy slot, and graph-backed Lambda/SQS subscription concepts.",
    considerations: [
      "Connections: Add one subscription per target; topic publication and subscription delivery are separate relationships.",
      "Security: Scope publisher permissions and topic resource policy to exact principals and resources; filters are not authorization.",
      "Cost: Publishes, deliveries, payload size, retries, transfer, and KMS requests can all add charges.",
      "Operations: Monitor failed deliveries and design subscribers for duplicate at-least-once delivery.",
    ],
    documentation: snsDocumentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.sns.unsupported.mobile-email-http",
      title: "Mobile, email, SMS, and HTTP subscriptions",
      explanation:
        "SMS, email, mobile push, Firehose, HTTP/S, cross-account confirmation, data protection, and delivery-status logging require separate contracts.",
    },
    {
      id: "aws.sns.unsupported.custom-kms-archive",
      title: "Custom keys, archive, and replay",
      explanation:
        "Customer-managed KMS keys, FIFO archive/replay, tracing controls, and arbitrary delivery policies are outside this slice.",
    },
    {
      id: "aws.sns.unsupported.exactly-once",
      title: "Exactly-once fan-out claim",
      explanation:
        "Neither Standard nor FIFO topic delivery makes an end-to-end application exactly once; subscribers need reviewed idempotency.",
    },
  ],
  mappings: eventMetadataMappings({
    mappingIdPrefix: "aws.sns.topic",
    terraformResourceType: "aws_sns_topic",
    cloudFormationTypeName: "AWS::SNS::Topic",
    terraformConfigurationBindings: [
      { configurationKey: "topicName", targetName: "name" },
      { configurationKey: "topicType", targetName: "fifo_topic" },
      {
        configurationKey: "contentBasedDeduplication",
        targetName: "content_based_deduplication",
      },
      { configurationKey: "encryption", targetName: "kms_master_key_id" },
    ],
    cloudFormationConfigurationBindings: [
      { configurationKey: "topicName", targetName: "TopicName" },
      { configurationKey: "topicType", targetName: "FifoTopic" },
      {
        configurationKey: "contentBasedDeduplication",
        targetName: "ContentBasedDeduplication",
      },
      { configurationKey: "encryption", targetName: "KmsMasterKeyId" },
    ],
    semanticConfigurationKeys: ["deletionProtectionEnabled"],
    terraformPortBindings: [
      { portId: "aws.sns.topic.publish", targetAttribute: "arn" },
      { portId: "aws.sns.topic.subscriptions", targetAttribute: "arn" },
      { portId: "aws.sns.topic.policy-resource", targetAttribute: "arn" },
      { portId: "aws.sns.topic.resource-policy", targetAttribute: "arn" },
    ],
    cloudFormationPortBindings: [
      { portId: "aws.sns.topic.publish", targetAttribute: "TopicArn" },
      { portId: "aws.sns.topic.subscriptions", targetAttribute: "TopicArn" },
      { portId: "aws.sns.topic.policy-resource", targetAttribute: "TopicArn" },
      { portId: "aws.sns.topic.resource-policy", targetAttribute: "TopicArn" },
    ],
  }),
  regionAvailability: eventDrivenRegionAvailability,
});

export const snsSubscription = defineProviderServiceV1(
  internalEventConfiguration({
    serviceId: "aws.sns.subscription",
    resourceType: "aws.sns.subscription",
    displayName: "SNS subscription",
    description:
      "A graph-backed Lambda or SQS subscription with bounded filtering and delivery semantics.",
    ownerServiceId: "aws.sns.topic",
    ownerRelationshipType: "aws.sns.topic-owns-subscription",
    configuration: {
      schemaId: "aws.sns.subscription.configuration",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:aws.sns.subscription.configuration:1.0.0",
        type: "object",
        title: "SNS subscription configuration",
        description:
          "One Lambda or SQS subscription with optional bounded filter keys and service-managed retry behavior.",
        additionalProperties: false,
        properties: {
          subscriptionName: {
            type: "string",
            default: "primary-subscriber",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
          },
          protocol: {
            type: "string",
            enum: ["LAMBDA", "SQS"],
            default: "LAMBDA",
          },
          rawMessageDelivery: { type: "boolean", default: false },
          filterScope: {
            type: "string",
            enum: ["NONE", "MESSAGE_ATTRIBUTES", "MESSAGE_BODY"],
            default: "NONE",
          },
          filterKeys: {
            type: "array",
            items: { type: "string" },
            default: [],
            maxItems: 8,
            uniqueItems: true,
          },
          retryPolicy: {
            type: "string",
            enum: ["SERVICE_MANAGED"],
            default: "SERVICE_MANAGED",
          },
          deliverySemantics: {
            type: "string",
            enum: ["AT_LEAST_ONCE"],
            default: "AT_LEAST_ONCE",
          },
        },
        required: [
          "subscriptionName",
          "protocol",
          "rawMessageDelivery",
          "filterScope",
          "filterKeys",
          "retryPolicy",
          "deliverySemantics",
        ],
      },
      uiHints: [
        {
          property: "subscriptionName",
          control: "text",
          label: "Subscription name",
          order: 0,
          advanced: true,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "none",
        },
        {
          property: "protocol",
          control: "select",
          label: "Target type",
          order: 1,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
        {
          property: "rawMessageDelivery",
          control: "checkbox",
          label: "Send raw message to SQS",
          helpText:
            "Available only for SQS. Lambda receives the SNS event envelope in this slice.",
          order: 2,
          advanced: true,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "none",
        },
        {
          property: "filterScope",
          control: "select",
          label: "Filter location",
          helpText:
            "Choose no filter, message attributes, or message body. Filters do not authorize access.",
          order: 3,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
        {
          property: "filterKeys",
          control: "multi-select",
          label: "Required filter keys",
          helpText:
            "List stable contract fields only. Values remain in the application event contract, not this provider configuration.",
          order: 4,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
        {
          property: "retryPolicy",
          control: "select",
          label: "Retry behavior",
          helpText: "Lambda and SQS use the reviewed service-managed policy.",
          order: 5,
          advanced: true,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "cost-sensitive",
        },
        {
          property: "deliverySemantics",
          control: "select",
          label: "Delivery behavior",
          order: 6,
          advanced: true,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "none",
        },
      ],
    },
    ports: [
      {
        id: "aws.sns.subscription.topic",
        displayName: "Owning topic",
        description: "Accepts publication from one SNS topic.",
        direction: "input",
        capability: "aws.sns.topic.subscription",
        category: "sends-messages-or-events",
        cardinality: "one",
        required: true,
      },
      {
        id: "aws.sns.subscription.lambda-delivery",
        displayName: "Lambda delivery",
        description: "Delivers the SNS envelope to one Lambda target.",
        direction: "output",
        capability: "aws.sns.subscription.lambda-delivery",
        category: "receives-events-from",
        cardinality: "one",
        required: false,
      },
      {
        id: "aws.sns.subscription.queue-delivery",
        displayName: "Queue delivery",
        description: "Delivers the message to one SQS queue target.",
        direction: "output",
        capability: "aws.sns.subscription.sqs-delivery",
        category: "sends-messages-or-events",
        cardinality: "one",
        required: false,
      },
    ],
    education: {
      summary:
        "Connects one SNS topic to one Lambda or SQS target with an optional small filter.",
      guidedExplanation:
        "A subscription is one branch of topic fan-out. Choose the target type, then optionally name the contract fields used for filtering. The consumer still validates the event and handles duplicates.",
      professionalExplanation:
        "Models one Lambda/SQS protocol endpoint, optional attribute/body filter-key inventory, SQS-only raw delivery, service-managed retry, and at-least-once delivery. Arbitrary filter JSON and delivery-policy JSON are excluded.",
      considerations: [
        "Connections: Exactly one topic owns the subscription and exactly one compatible target receives it.",
        "Security: Filter keys reduce traffic but never replace target resource policy or Lambda invocation permission.",
        "Cost: Every matched subscription creates delivery work; broad filters can multiply downstream requests.",
        "Operations: Validate payload contracts, monitor failures, and keep subscribers idempotent.",
      ],
      documentation: snsDocumentation,
    },
    unsupportedCapabilities: [
      {
        id: "aws.sns.subscription.unsupported.protocols-filter-json",
        title: "Other protocols and arbitrary filters",
        explanation:
          "Email, SMS, HTTP/S, mobile, Firehose, arbitrary filter JSON, filter values, replay, and custom delivery-policy JSON are rejected.",
      },
    ],
    mappings: eventMetadataMappings({
      mappingIdPrefix: "aws.sns.subscription",
      terraformResourceType: "aws_sns_topic_subscription",
      cloudFormationTypeName: "AWS::SNS::Subscription",
      terraformConfigurationBindings: [
        { configurationKey: "subscriptionName", targetName: "stable_identity" },
        { configurationKey: "protocol", targetName: "protocol" },
        {
          configurationKey: "rawMessageDelivery",
          targetName: "raw_message_delivery",
        },
        { configurationKey: "filterScope", targetName: "filter_policy_scope" },
        { configurationKey: "filterKeys", targetName: "filter_policy.keys" },
      ],
      cloudFormationConfigurationBindings: [
        { configurationKey: "subscriptionName", targetName: "StableIdentity" },
        { configurationKey: "protocol", targetName: "Protocol" },
        {
          configurationKey: "rawMessageDelivery",
          targetName: "RawMessageDelivery",
        },
        { configurationKey: "filterScope", targetName: "FilterPolicyScope" },
        { configurationKey: "filterKeys", targetName: "FilterPolicy.Keys" },
      ],
      semanticConfigurationKeys: ["retryPolicy", "deliverySemantics"],
      terraformPortBindings: [
        { portId: "aws.sns.subscription.topic", targetAttribute: "topic_arn" },
        {
          portId: "aws.sns.subscription.lambda-delivery",
          targetAttribute: "endpoint",
        },
        {
          portId: "aws.sns.subscription.queue-delivery",
          targetAttribute: "endpoint",
        },
      ],
      cloudFormationPortBindings: [
        { portId: "aws.sns.subscription.topic", targetAttribute: "TopicArn" },
        {
          portId: "aws.sns.subscription.lambda-delivery",
          targetAttribute: "Endpoint",
        },
        {
          portId: "aws.sns.subscription.queue-delivery",
          targetAttribute: "Endpoint",
        },
      ],
      terraformProjection: {
        kind: "owned-resource",
        rendererContractId: "aws.sns.subscription.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
    }),
  }),
);
