import {
  defineProviderConnectionRuleV1,
  providerServiceConfigurationV1Schema,
  type ProviderConnectionRuleDescriptorV1Input,
} from "@cloudmarkup/provider-sdk";

const lifecycle = {
  provenance: "connection-rule",
  deletion: "release-generated-resources",
  adoption: "required-before-customization",
  sharedResource: "retain-while-referenced",
} as const;

const eventDocumentation = [
  {
    kind: "official" as const,
    id: "aws.eventing.documentation.delivery",
    title: "AWS event-driven architecture guidance",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html",
  },
];

function emptyConfiguration(schemaId: string, title: string) {
  return providerServiceConfigurationV1Schema.parse({
    schemaId,
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `urn:cloudmarkup:configuration:${schemaId}:1.0.0`,
      type: "object",
      title,
      description:
        "This exact relationship derives its provider references from graph identity and accepts no raw identifiers.",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    uiHints: [],
  });
}

const deliveryConfiguration = providerServiceConfigurationV1Schema.parse({
  schemaId: "aws.eventing.delivery.connection",
  schemaVersion: "1.0.0",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:cloudmarkup:configuration:aws.eventing.delivery.connection:1.0.0",
    type: "object",
    title: "Event delivery",
    description:
      "The one honest delivery guarantee for the curated asynchronous connection.",
    additionalProperties: false,
    properties: {
      deliverySemantics: {
        type: "string",
        enum: ["AT_LEAST_ONCE"],
        default: "AT_LEAST_ONCE",
      },
    },
    required: ["deliverySemantics"],
  },
  uiHints: [
    {
      property: "deliverySemantics",
      control: "select",
      label: "Delivery behavior",
      helpText:
        "At-least-once delivery can repeat, so the consumer operation must be idempotent.",
      order: 0,
      advanced: true,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "none",
    },
  ],
});

const deliveryQuestions = [
  {
    id: "aws.eventing.question.delivery-semantics",
    property: "deliverySemantics",
    prompt: "Can the consumer safely handle the same event more than once?",
    explanation:
      "The reviewed asynchronous services use at-least-once delivery; this answer stays visible instead of implying exactly once.",
    answer: { kind: "catalog-default" as const },
  },
];

const s3NotificationConfiguration = providerServiceConfigurationV1Schema.parse({
  schemaId: "aws.s3.notification.connection",
  schemaVersion: "1.0.0",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:cloudmarkup:configuration:aws.s3.notification.connection:1.0.0",
    type: "object",
    title: "S3 event delivery",
    description:
      "A bounded object event, literal key filters, and at-least-once unordered delivery.",
    additionalProperties: false,
    properties: {
      eventType: {
        type: "string",
        enum: ["OBJECT_CREATED", "OBJECT_REMOVED"],
        default: "OBJECT_CREATED",
      },
      filterPrefix: { type: "string", default: "", maxLength: 1024 },
      filterSuffix: { type: "string", default: "", maxLength: 1024 },
      deliverySemantics: {
        type: "string",
        enum: ["AT_LEAST_ONCE_UNORDERED"],
        default: "AT_LEAST_ONCE_UNORDERED",
      },
    },
    required: [
      "eventType",
      "filterPrefix",
      "filterSuffix",
      "deliverySemantics",
    ],
  },
  uiHints: [
    {
      property: "eventType",
      control: "select",
      label: "Object event",
      order: 0,
      advanced: false,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
    {
      property: "filterPrefix",
      control: "text",
      label: "Object-key prefix",
      helpText: "Use a narrow input prefix to avoid self-trigger loops.",
      order: 1,
      advanced: false,
      valueSource: "literal",
      securityImpact: "security-sensitive",
      costImpact: "cost-sensitive",
    },
    {
      property: "filterSuffix",
      control: "text",
      label: "Object-key suffix",
      order: 2,
      advanced: false,
      valueSource: "literal",
      securityImpact: "security-sensitive",
      costImpact: "cost-sensitive",
    },
    {
      property: "deliverySemantics",
      control: "select",
      label: "Delivery behavior",
      order: 3,
      advanced: true,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "none",
    },
  ],
});

const s3NotificationQuestions = [
  {
    id: "aws.s3.question.event-type",
    property: "eventType",
    prompt: "Which object change should create an event?",
    explanation:
      "Created and removed events have different payload meaning and operational risk.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.s3.question.filter-prefix",
    property: "filterPrefix",
    prompt: "Should only one object-key prefix trigger this consumer?",
    explanation:
      "A narrow prefix reduces unwanted work and helps prevent a function from triggering itself.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.s3.question.filter-suffix",
    property: "filterSuffix",
    prompt: "Should only one object-key suffix trigger this consumer?",
    explanation:
      "A literal suffix such as .json can narrow delivery without an arbitrary filter language.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.s3.question.delivery-semantics",
    property: "deliverySemantics",
    prompt:
      "Can the consumer handle duplicates and events that arrive out of order?",
    explanation:
      "Direct S3 notifications are modeled honestly as at-least-once and unordered.",
    answer: { kind: "catalog-default" as const },
  },
];

const lambdaQueueSendConfiguration = providerServiceConfigurationV1Schema.parse(
  {
    schemaId: "aws.lambda.sqs-send.connection",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.lambda.sqs-send.connection:1.0.0",
      type: "object",
      title: "Lambda message send",
      description:
        "At-least-once message publication with an explicit ordering-key posture.",
      additionalProperties: false,
      properties: {
        ordering: {
          type: "string",
          enum: ["NOT_GUARANTEED", "EVENT_CONTRACT_KEY"],
          default: "NOT_GUARANTEED",
        },
        deliverySemantics: {
          type: "string",
          enum: ["AT_LEAST_ONCE"],
          default: "AT_LEAST_ONCE",
        },
      },
      required: ["ordering", "deliverySemantics"],
    },
    uiHints: [
      {
        property: "ordering",
        control: "select",
        label: "Message ordering",
        helpText:
          "FIFO queues require a stable message-group key from the bound event contract.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "deliverySemantics",
        control: "select",
        label: "Delivery behavior",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
    ],
  },
);

const lambdaQueueSendQuestions = [
  {
    id: "aws.lambda.sqs.question.ordering",
    property: "ordering",
    prompt: "Does this message contract require ordered message groups?",
    explanation:
      "Standard queues do not guarantee order; FIFO requires a reviewed stable group key.",
    answer: { kind: "catalog-default" as const },
  },
  ...deliveryQuestions,
];

const lambdaTopicPublishConfiguration =
  providerServiceConfigurationV1Schema.parse({
    schemaId: "aws.lambda.sns-publish.connection",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.lambda.sns-publish.connection:1.0.0",
      type: "object",
      title: "Lambda event publication",
      description:
        "At-least-once SNS publication with an explicit FIFO message-group posture.",
      additionalProperties: false,
      properties: {
        ordering: {
          type: "string",
          enum: ["NOT_GUARANTEED", "EVENT_CONTRACT_KEY"],
          default: "NOT_GUARANTEED",
        },
        deliverySemantics: {
          type: "string",
          enum: ["AT_LEAST_ONCE"],
          default: "AT_LEAST_ONCE",
        },
      },
      required: ["ordering", "deliverySemantics"],
    },
    uiHints: [
      {
        property: "ordering",
        control: "select",
        label: "Event ordering",
        helpText:
          "FIFO topics require a stable message-group key from the bound event contract.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "deliverySemantics",
        control: "select",
        label: "Delivery behavior",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
    ],
  });

const lambdaTopicPublishQuestions = [
  {
    id: "aws.lambda.sns.question.ordering",
    property: "ordering",
    prompt: "Does this event contract require ordered message groups?",
    explanation:
      "Standard topics do not guarantee order; FIFO requires a reviewed stable group key.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.lambda.sns.question.delivery-semantics",
    property: "deliverySemantics",
    prompt: "Can every subscriber safely handle the same event more than once?",
    explanation:
      "SNS delivery is at least once; this answer stays visible instead of implying exactly once.",
    answer: { kind: "catalog-default" as const },
  },
];

const sqsConsumerConfiguration = providerServiceConfigurationV1Schema.parse({
  schemaId: "aws.sqs.lambda-consumer.connection",
  schemaVersion: "1.0.0",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:cloudmarkup:configuration:aws.sqs.lambda-consumer.connection:1.0.0",
    type: "object",
    title: "SQS Lambda consumer",
    description:
      "Bounded batch, window, concurrency, partial failure, and at-least-once behavior.",
    additionalProperties: false,
    properties: {
      batchSize: {
        type: "integer",
        enum: [1, 5, 10],
        default: 10,
      },
      batchingWindowSeconds: {
        type: "integer",
        enum: [0, 1, 5, 10],
        default: 0,
      },
      maximumConcurrency: {
        type: "integer",
        enum: [2, 5, 10, 50],
        default: 10,
      },
      partialBatchResponse: { type: "boolean", const: true, default: true },
      deliverySemantics: {
        type: "string",
        enum: ["AT_LEAST_ONCE"],
        default: "AT_LEAST_ONCE",
      },
    },
    required: [
      "batchSize",
      "batchingWindowSeconds",
      "maximumConcurrency",
      "partialBatchResponse",
      "deliverySemantics",
    ],
  },
  uiHints: [
    {
      property: "batchSize",
      control: "number",
      label: "Messages per batch",
      order: 0,
      advanced: false,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
    {
      property: "batchingWindowSeconds",
      control: "number",
      label: "Maximum batching window",
      order: 1,
      advanced: false,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
    {
      property: "maximumConcurrency",
      control: "number",
      label: "Maximum consumer concurrency",
      order: 2,
      advanced: true,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
    {
      property: "partialBatchResponse",
      control: "checkbox",
      label: "Retry only failed messages",
      helpText:
        "The handler must return the reviewed partial batch response contract.",
      order: 3,
      advanced: false,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
    {
      property: "deliverySemantics",
      control: "select",
      label: "Delivery behavior",
      order: 4,
      advanced: true,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "none",
    },
  ],
});

const sqsConsumerQuestions = [
  {
    id: "aws.sqs.lambda.question.batch-size",
    property: "batchSize",
    prompt: "How many messages may one function invocation process?",
    explanation:
      "Larger batches improve throughput but expand each retry and timeout failure domain.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.sqs.lambda.question.batch-window",
    property: "batchingWindowSeconds",
    prompt: "How long may Lambda wait to fill a batch?",
    explanation:
      "A longer window can improve efficiency while adding delivery latency.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.sqs.lambda.question.concurrency",
    property: "maximumConcurrency",
    prompt: "How many concurrent batches may this consumer process?",
    explanation:
      "This bound protects downstream capacity and makes cost pressure visible.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.sqs.lambda.question.partial-batch",
    property: "partialBatchResponse",
    prompt: "Should only failed records be retried?",
    explanation:
      "The curated handler contract reports individual failed message identifiers.",
    answer: { kind: "catalog-default" as const },
  },
  ...deliveryQuestions,
];

const redriveConfiguration = providerServiceConfigurationV1Schema.parse({
  schemaId: "aws.sqs.redrive.connection",
  schemaVersion: "1.0.0",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:cloudmarkup:configuration:aws.sqs.redrive.connection:1.0.0",
    type: "object",
    title: "SQS dead-letter relationship",
    description: "Bounded failed receives before moving to the selected queue.",
    additionalProperties: false,
    properties: {
      maximumReceiveCount: {
        type: "integer",
        enum: [2, 3, 5, 10],
        default: 5,
      },
      replayMode: {
        type: "string",
        enum: ["MANUAL_REVIEW"],
        default: "MANUAL_REVIEW",
      },
    },
    required: ["maximumReceiveCount", "replayMode"],
  },
  uiHints: [
    {
      property: "maximumReceiveCount",
      control: "number",
      label: "Attempts before dead-lettering",
      order: 0,
      advanced: false,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
    {
      property: "replayMode",
      control: "select",
      label: "Replay behavior",
      helpText:
        "The catalog never selects automatic replay of failed messages.",
      order: 1,
      advanced: true,
      valueSource: "literal",
      securityImpact: "security-sensitive",
      costImpact: "cost-sensitive",
    },
  ],
});

const redriveQuestions = [
  {
    id: "aws.sqs.question.maximum-receives",
    property: "maximumReceiveCount",
    prompt: "How many receives may fail before the message moves to the DLQ?",
    explanation:
      "This bounds poison-message retries while leaving room for transient failures.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.sqs.question.replay-mode",
    property: "replayMode",
    prompt: "How will failed messages be replayed?",
    explanation:
      "Manual review is the only supported posture so corrected messages are not reintroduced blindly.",
    answer: { kind: "catalog-default" as const },
  },
];

const workflowTaskConfiguration = providerServiceConfigurationV1Schema.parse({
  schemaId: "aws.stepfunctions.lambda-task.connection",
  schemaVersion: "1.0.0",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:cloudmarkup:configuration:aws.stepfunctions.lambda-task.connection:1.0.0",
    type: "object",
    title: "Step Functions Lambda task",
    description: "One bounded Lambda task timeout and retry posture.",
    additionalProperties: false,
    properties: {
      taskTimeoutSeconds: {
        type: "integer",
        enum: [30, 60, 120, 300, 900],
        default: 60,
      },
      retryMode: {
        type: "string",
        enum: ["NONE", "BOUNDED_EXPONENTIAL"],
        default: "BOUNDED_EXPONENTIAL",
      },
      maximumAttempts: {
        type: "integer",
        enum: [1, 2, 3, 5],
        default: 3,
      },
    },
    required: ["taskTimeoutSeconds", "retryMode", "maximumAttempts"],
  },
  uiHints: [
    {
      property: "taskTimeoutSeconds",
      control: "number",
      label: "Task timeout",
      helpText: "Keep this at least as long as the connected Lambda timeout.",
      order: 0,
      advanced: false,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
    {
      property: "retryMode",
      control: "select",
      label: "Retry behavior",
      order: 1,
      advanced: false,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
    {
      property: "maximumAttempts",
      control: "number",
      label: "Maximum attempts",
      order: 2,
      advanced: false,
      valueSource: "literal",
      securityImpact: "none",
      costImpact: "cost-sensitive",
    },
  ],
});

const workflowTaskQuestions = [
  {
    id: "aws.stepfunctions.question.task-timeout",
    property: "taskTimeoutSeconds",
    prompt: "How long may this workflow task run?",
    explanation:
      "The task timeout must not be shorter than the connected Lambda timeout.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.stepfunctions.question.retry-mode",
    property: "retryMode",
    prompt: "Should retryable task failures be retried?",
    explanation:
      "Retries are safe only for an idempotent operation with reviewed failure categories.",
    answer: { kind: "catalog-default" as const },
  },
  {
    id: "aws.stepfunctions.question.maximum-attempts",
    property: "maximumAttempts",
    prompt: "How many total attempts may the workflow make?",
    explanation: "A bounded count limits latency and downstream cost.",
    answer: { kind: "catalog-default" as const },
  },
];

interface EventRuleInput {
  readonly id: string;
  readonly relationshipType: string;
  readonly category: ProviderConnectionRuleDescriptorV1Input["category"];
  readonly source: ProviderConnectionRuleDescriptorV1Input["source"];
  readonly target: ProviderConnectionRuleDescriptorV1Input["target"];
  readonly maximumConnectionsPerSource: number;
  readonly maximumConnectionsPerTarget: number;
  readonly maximumConnectionsPerEndpointPair?: number;
  readonly configuration?: ProviderConnectionRuleDescriptorV1Input["configuration"];
  readonly questions?: ProviderConnectionRuleDescriptorV1Input["questions"];
  readonly iamEffects?: ProviderConnectionRuleDescriptorV1Input["iamEffects"];
  readonly summary: string;
  readonly guidedExplanation: string;
  readonly professionalExplanation: string;
}

function eventRule(input: EventRuleInput) {
  return defineProviderConnectionRuleV1({
    id: input.id,
    ruleVersion: "1.0.0",
    relationshipType: input.relationshipType,
    category: input.category,
    source: input.source,
    target: input.target,
    maximumConnectionsPerSource: input.maximumConnectionsPerSource,
    maximumConnectionsPerTarget: input.maximumConnectionsPerTarget,
    maximumConnectionsPerEndpointPair:
      input.maximumConnectionsPerEndpointPair ?? 1,
    configuration:
      input.configuration ??
      emptyConfiguration(`${input.id}.connection`, `${input.summary} settings`),
    questions: input.questions ?? [],
    supportingChanges: [],
    iamEffects: input.iamEffects ?? [],
    missingInformationFindings: [],
    lifecycle,
    implementation: {
      status: "implemented",
      interfaceVersion: 1,
      implementationId: `${input.id}.resolver`,
    },
    validationRuleIds: [
      "aws.cloudmarkup.validation.connection-questions",
      "aws.cloudmarkup.validation.event-delivery",
      "aws.cloudmarkup.validation.event-topology",
    ],
    education: {
      summary: input.summary,
      guidedExplanation: input.guidedExplanation,
      professionalExplanation: input.professionalExplanation,
      considerations: [
        "Review retry, timeout, ordering, filtering, DLQ, and delivery assumptions before accepting the connection.",
        "Generated direct edges retain exact rule/version/operation provenance and require adoption before customization.",
      ],
      documentation: eventDocumentation,
    },
  });
}

function policyEffect(
  input: Readonly<{
    id: string;
    actions: readonly string[];
    resourceScope: "source-node" | "target-node" | "connected-target";
    principal?: string;
    explanation: string;
  }>,
): ProviderConnectionRuleDescriptorV1Input["iamEffects"][number] {
  return {
    id: input.id,
    effect: "allow",
    actions: [...input.actions],
    resourceScope: input.resourceScope,
    ...(input.principal === undefined ? {} : { principal: input.principal }),
    explanation: input.explanation,
  };
}

export const s3NotifiesLambda = eventRule({
  id: "aws.s3.bucket-notifies-lambda",
  relationshipType: "aws.s3.notifies-lambda",
  category: "receives-events-from",
  source: { serviceId: "aws.s3.bucket", portId: "aws.s3.bucket.notifications" },
  target: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.asynchronous-invocation",
  },
  maximumConnectionsPerSource: 64,
  maximumConnectionsPerTarget: 64,
  configuration: s3NotificationConfiguration,
  questions: s3NotificationQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.s3.iam.invoke-lambda",
      actions: ["lambda:InvokeFunction"],
      resourceScope: "target-node",
      principal: "s3.amazonaws.com",
      explanation:
        "The Lambda resource policy must allow only S3 invocation from the connected bucket and current account.",
    }),
  ],
  summary: "Delivers selected S3 object events to one Lambda function.",
  guidedExplanation:
    "Choose the object event and optional key filters. The function receives an asynchronous S3 event and must tolerate duplicates and reordered delivery.",
  professionalExplanation:
    "Binds exact bucket and Lambda ports with object event/filter configuration and a resource-scoped lambda:InvokeFunction service-grant requirement qualified by SourceArn and SourceAccount.",
});

export const s3SendsEventsToEventBridge = eventRule({
  id: "aws.s3.bucket-sends-events-to-eventbridge",
  relationshipType: "aws.s3.sends-events-to-eventbridge",
  category: "sends-messages-or-events",
  source: { serviceId: "aws.s3.bucket", portId: "aws.s3.bucket.eventbridge" },
  target: {
    serviceId: "aws.eventbridge.event-bus",
    portId: "aws.eventbridge.event-bus.aws-service-events",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1_000,
  summary: "Enables S3 service events on the same-Region default event bus.",
  guidedExplanation:
    "Use EventBridge when separate consumers should own separate matching rules instead of sharing one bucket notification configuration.",
  professionalExplanation:
    "Associates one bucket with the same-Region default EventBridge bus; custom buses and direct PutEvents are not substituted for AWS service-event delivery.",
});

export const lambdaSendsMessageToSqs = eventRule({
  id: "aws.lambda.sends-message-to-sqs",
  relationshipType: "aws.lambda.sends-message-to-sqs",
  category: "sends-messages-or-events",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.message-send",
  },
  target: { serviceId: "aws.sqs.queue", portId: "aws.sqs.queue.message-send" },
  maximumConnectionsPerSource: 64,
  maximumConnectionsPerTarget: 128,
  configuration: lambdaQueueSendConfiguration,
  questions: lambdaQueueSendQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.lambda.iam.sqs-send-message",
      actions: ["sqs:SendMessage"],
      resourceScope: "target-node",
      explanation:
        "The Lambda execution role needs only sqs:SendMessage on the connected queue.",
    }),
  ],
  summary: "Lets one Lambda producer send messages to one SQS queue.",
  guidedExplanation:
    "This arrow points from the function to the queue because the function actively sends. Choose ordered message groups only when the event contract provides a stable key.",
  professionalExplanation:
    "Declares exact sqs:SendMessage scope plus ordering and at-least-once metadata; FIFO compatibility is deterministic validation rather than inferred from labels.",
});

export const sqsTriggersLambda = eventRule({
  id: "aws.sqs.queue-triggers-lambda",
  relationshipType: "aws.sqs.triggers-lambda",
  category: "receives-events-from",
  source: { serviceId: "aws.sqs.queue", portId: "aws.sqs.queue.event-source" },
  target: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.event-source",
  },
  maximumConnectionsPerSource: 32,
  maximumConnectionsPerTarget: 32,
  configuration: sqsConsumerConfiguration,
  questions: sqsConsumerQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.lambda.iam.sqs-consume",
      actions: [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
      ],
      resourceScope: "source-node",
      explanation:
        "The Lambda execution role receives, deletes, and reads attributes only on the connected queue.",
    }),
  ],
  summary:
    "Polls one SQS queue and delivers bounded message batches to Lambda.",
  guidedExplanation:
    "This arrow points from the queue to the function because Lambda polls and consumes. Choose batch, wait, and concurrency bounds, and retry only failed records.",
  professionalExplanation:
    "Declares an SQS event-source mapping with exact consume actions, bounded batch/window/concurrency, partial batch response, same-Region requirement, and at-least-once semantics.",
});

export const sqsUsesDeadLetterQueue = eventRule({
  id: "aws.sqs.queue-uses-dead-letter-queue",
  relationshipType: "aws.sqs.uses-dead-letter-queue",
  category: "sends-messages-or-events",
  source: { serviceId: "aws.sqs.queue", portId: "aws.sqs.queue.redrive" },
  target: {
    serviceId: "aws.sqs.queue",
    portId: "aws.sqs.queue.dead-letter-target",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 10,
  configuration: redriveConfiguration,
  questions: redriveQuestions,
  summary: "Moves repeatedly failed messages to one compatible SQS queue.",
  guidedExplanation:
    "A DLQ is another queue. Choose the failed-receive count and investigate before manually replaying messages.",
  professionalExplanation:
    "Binds one source queue to one Standard/Standard or FIFO/FIFO dead-letter queue with bounded maxReceiveCount, byQueue policy posture, manual replay, and cycle validation.",
});

export const lambdaPublishesToSns = eventRule({
  id: "aws.lambda.publishes-to-sns",
  relationshipType: "aws.lambda.publishes-to-sns",
  category: "sends-messages-or-events",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.event-publish",
  },
  target: { serviceId: "aws.sns.topic", portId: "aws.sns.topic.publish" },
  maximumConnectionsPerSource: 64,
  maximumConnectionsPerTarget: 128,
  configuration: lambdaTopicPublishConfiguration,
  questions: lambdaTopicPublishQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.lambda.iam.sns-publish",
      actions: ["sns:Publish"],
      resourceScope: "target-node",
      explanation:
        "The Lambda execution role needs only sns:Publish on the connected topic.",
    }),
  ],
  summary: "Publishes one workload event to an SNS fan-out topic.",
  guidedExplanation:
    "The function publishes one reviewed event contract; each explicit subscription decides which consumers receive it.",
  professionalExplanation:
    "Declares exact sns:Publish scope and at-least-once event-contract metadata; FIFO message-group requirements are validated separately.",
});

export const snsTopicOwnsSubscription = eventRule({
  id: "aws.sns.topic-owns-subscription",
  relationshipType: "aws.sns.topic-owns-subscription",
  category: "sends-messages-or-events",
  source: {
    serviceId: "aws.sns.topic",
    portId: "aws.sns.topic.subscriptions",
  },
  target: {
    serviceId: "aws.sns.subscription",
    portId: "aws.sns.subscription.topic",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  summary: "Adds one explicit fan-out subscription to an SNS topic.",
  guidedExplanation:
    "Each subscription is one visible fan-out branch with its own target and optional filter.",
  professionalExplanation:
    "Binds one graph-backed subscription configuration to exactly one topic; protocol, filter, retry, raw-delivery, and delivery semantics remain typed node configuration.",
});

export const snsSubscriptionInvokesLambda = eventRule({
  id: "aws.sns.subscription-invokes-lambda",
  relationshipType: "aws.sns.subscription-invokes-lambda",
  category: "receives-events-from",
  source: {
    serviceId: "aws.sns.subscription",
    portId: "aws.sns.subscription.lambda-delivery",
  },
  target: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.asynchronous-invocation",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 64,
  configuration: deliveryConfiguration,
  questions: deliveryQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.sns.iam.invoke-lambda",
      actions: ["lambda:InvokeFunction"],
      resourceScope: "target-node",
      principal: "sns.amazonaws.com",
      explanation:
        "The Lambda resource policy allows SNS invocation only from the owning connected topic ARN.",
    }),
  ],
  summary: "Delivers one SNS subscription to a Lambda consumer.",
  guidedExplanation:
    "The Lambda receives the SNS envelope and must validate the bound event contract and handle duplicate delivery.",
  professionalExplanation:
    "Requires a resource-scoped lambda:InvokeFunction service grant qualified by the owning topic SourceArn and preserves at-least-once subscription delivery.",
});

export const snsSubscriptionSendsToSqs = eventRule({
  id: "aws.sns.subscription-sends-to-sqs",
  relationshipType: "aws.sns.subscription-sends-to-sqs",
  category: "sends-messages-or-events",
  source: {
    serviceId: "aws.sns.subscription",
    portId: "aws.sns.subscription.queue-delivery",
  },
  target: { serviceId: "aws.sqs.queue", portId: "aws.sqs.queue.message-send" },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 100,
  configuration: deliveryConfiguration,
  questions: deliveryQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.sns.iam.sqs-send-message",
      actions: ["sqs:SendMessage"],
      resourceScope: "target-node",
      principal: "sns.amazonaws.com",
      explanation:
        "The queue resource policy allows sns:SendMessage only from the owning connected topic ARN.",
    }),
  ],
  summary: "Delivers one SNS subscription to an SQS queue.",
  guidedExplanation:
    "Use a queue subscription when a consumer needs durable buffering and independent retry.",
  professionalExplanation:
    "Requires an exact queue resource-policy statement for sns:SendMessage qualified by the owning topic SourceArn; FIFO combinations remain validation-bound.",
});

export const lambdaPutsEventsOnBus = eventRule({
  id: "aws.lambda.puts-events-on-eventbridge",
  relationshipType: "aws.lambda.puts-events-on-eventbridge",
  category: "sends-messages-or-events",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.event-publish",
  },
  target: {
    serviceId: "aws.eventbridge.event-bus",
    portId: "aws.eventbridge.event-bus.publish",
  },
  maximumConnectionsPerSource: 64,
  maximumConnectionsPerTarget: 128,
  configuration: deliveryConfiguration,
  questions: deliveryQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.lambda.iam.eventbridge-put-events",
      actions: ["events:PutEvents"],
      resourceScope: "target-node",
      explanation:
        "The Lambda execution role needs only events:PutEvents on the connected bus.",
    }),
  ],
  summary: "Publishes a reviewed custom event from Lambda to EventBridge.",
  guidedExplanation:
    "The function publishes an explicit event contract to the bus; rules then decide which targets receive it.",
  professionalExplanation:
    "Declares exact events:PutEvents scope and at-least-once outbound event-contract metadata without inferring source or detail-type fields.",
});

export const eventBusAssociatesRule = eventRule({
  id: "aws.eventbridge.event-bus-associates-rule",
  relationshipType: "aws.eventbridge.event-bus-associates-rule",
  category: "sends-messages-or-events",
  source: {
    serviceId: "aws.eventbridge.event-bus",
    portId: "aws.eventbridge.event-bus.rules",
  },
  target: {
    serviceId: "aws.eventbridge.rule",
    portId: "aws.eventbridge.rule.event-bus",
  },
  maximumConnectionsPerSource: 300,
  maximumConnectionsPerTarget: 1,
  summary: "Associates one event-pattern rule with one EventBridge bus.",
  guidedExplanation:
    "The rule listens only to this bus and keeps its filter separate from every target.",
  professionalExplanation:
    "Binds EventBusName through an exact association without implying physical containment or cross-bus matching.",
});

export const eventBridgeRuleOwnsTarget = eventRule({
  id: "aws.eventbridge.rule-owns-target",
  relationshipType: "aws.eventbridge.rule-owns-target",
  category: "sends-messages-or-events",
  source: {
    serviceId: "aws.eventbridge.rule",
    portId: "aws.eventbridge.rule.targets",
  },
  target: {
    serviceId: "aws.eventbridge.target",
    portId: "aws.eventbridge.target.rule",
  },
  maximumConnectionsPerSource: 5,
  maximumConnectionsPerTarget: 1,
  summary: "Adds one retryable delivery target to an EventBridge rule.",
  guidedExplanation:
    "Each target keeps its destination, retry window, and optional dead-letter queue visible and reviewable.",
  professionalExplanation:
    "Binds one graph-backed target to one rule; AWS target cardinality is capped and target-type exclusivity is validated from the exact outgoing edge.",
});

function eventBridgeTargetRule(
  input: Readonly<{
    id: string;
    relationshipType: string;
    sourcePort: string;
    targetServiceId: string;
    targetPort: string;
    action: string;
    principal?: string;
    category?: ProviderConnectionRuleDescriptorV1Input["category"];
    summary: string;
  }>,
) {
  return eventRule({
    id: input.id,
    relationshipType: input.relationshipType,
    category:
      input.category ??
      (input.action === "lambda:InvokeFunction" ||
      input.action === "states:StartExecution"
        ? "invokes-another-workload"
        : "sends-messages-or-events"),
    source: {
      serviceId: "aws.eventbridge.target",
      portId: input.sourcePort,
    },
    target: { serviceId: input.targetServiceId, portId: input.targetPort },
    maximumConnectionsPerSource: 1,
    maximumConnectionsPerTarget: 100,
    configuration: deliveryConfiguration,
    questions: deliveryQuestions,
    iamEffects: [
      policyEffect({
        id: `${input.id}.iam`,
        actions: [input.action],
        resourceScope: "target-node",
        ...(input.principal === undefined
          ? {}
          : { principal: input.principal }),
        explanation: `${input.action} is scoped to the exact connected target; any service principal or execution role remains explicit.`,
      }),
    ],
    summary: input.summary,
    guidedExplanation:
      input.relationshipType === "aws.eventbridge.target-publishes-to-sns"
        ? "EventBridge cannot deliver to the current AWS-managed KMS SNS topics. Choose a supported Lambda or Standard SQS target."
        : "The full matched event is delivered to this exact target with bounded retry and at-least-once behavior.",
    professionalExplanation:
      input.relationshipType === "aws.eventbridge.target-publishes-to-sns"
        ? "EventBridge-to-encrypted-SNS requires a customer-managed topic key and explicit KMS service permissions, outside this catalog's closed AWS_MANAGED_KMS topic contract. The resolver, provider validation and both compiler targets reject this combination."
        : `Declares exact ${input.action} target scope; target-specific resource policy or execution-role requirements remain visible and compiler rendering is pending.`,
  });
}

export const eventBridgeTargetInvokesLambda = eventBridgeTargetRule({
  id: "aws.eventbridge.target-invokes-lambda",
  relationshipType: "aws.eventbridge.target-invokes-lambda",
  sourcePort: "aws.eventbridge.target.lambda",
  targetServiceId: "aws.lambda.function",
  targetPort: "aws.lambda.function.asynchronous-invocation",
  action: "lambda:InvokeFunction",
  principal: "events.amazonaws.com",
  category: "receives-events-from",
  summary: "Invokes one Lambda function from an EventBridge target.",
});

export const eventBridgeTargetSendsToSqs = eventBridgeTargetRule({
  id: "aws.eventbridge.target-sends-to-sqs",
  relationshipType: "aws.eventbridge.target-sends-to-sqs",
  sourcePort: "aws.eventbridge.target.queue",
  targetServiceId: "aws.sqs.queue",
  targetPort: "aws.sqs.queue.message-send",
  action: "sqs:SendMessage",
  principal: "events.amazonaws.com",
  summary: "Sends matched EventBridge events to one SQS queue.",
});

export const eventBridgeTargetPublishesToSns = eventBridgeTargetRule({
  id: "aws.eventbridge.target-publishes-to-sns",
  relationshipType: "aws.eventbridge.target-publishes-to-sns",
  sourcePort: "aws.eventbridge.target.topic",
  targetServiceId: "aws.sns.topic",
  targetPort: "aws.sns.topic.publish",
  action: "sns:Publish",
  principal: "events.amazonaws.com",
  summary:
    "EventBridge-to-SNS delivery is unavailable with the current topic encryption contract.",
});

export const eventBridgeTargetStartsStateMachine = eventBridgeTargetRule({
  id: "aws.eventbridge.target-starts-state-machine",
  relationshipType: "aws.eventbridge.target-starts-state-machine",
  sourcePort: "aws.eventbridge.target.state-machine",
  targetServiceId: "aws.stepfunctions.state-machine",
  targetPort: "aws.stepfunctions.state-machine.start-execution",
  action: "states:StartExecution",
  summary:
    "Starts one Step Functions state machine from an EventBridge target.",
});

export const eventBridgeTargetUsesDeadLetterQueue = eventBridgeTargetRule({
  id: "aws.eventbridge.target-uses-dead-letter-queue",
  relationshipType: "aws.eventbridge.target-uses-dead-letter-queue",
  sourcePort: "aws.eventbridge.target.dead-letter-queue",
  targetServiceId: "aws.sqs.queue",
  targetPort: "aws.sqs.queue.dead-letter-target",
  action: "sqs:SendMessage",
  principal: "events.amazonaws.com",
  summary:
    "Sends exhausted EventBridge deliveries to one SQS dead-letter queue.",
});

export const lambdaStartsStateMachine = eventRule({
  id: "aws.lambda.starts-step-functions-state-machine",
  relationshipType: "aws.lambda.starts-step-functions-state-machine",
  category: "invokes-another-workload",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.workload-invocation",
  },
  target: {
    serviceId: "aws.stepfunctions.state-machine",
    portId: "aws.stepfunctions.state-machine.start-execution",
  },
  maximumConnectionsPerSource: 32,
  maximumConnectionsPerTarget: 64,
  iamEffects: [
    policyEffect({
      id: "aws.lambda.iam.step-functions-start-execution",
      actions: ["states:StartExecution"],
      resourceScope: "target-node",
      explanation:
        "The Lambda execution role can start only the connected state machine.",
    }),
  ],
  summary: "Lets one Lambda operation start one Step Functions workflow.",
  guidedExplanation:
    "Use this when the function hands off to a reviewed multi-step workflow; the input contract remains explicit.",
  professionalExplanation:
    "Declares exact states:StartExecution scope and an outbound operation binding without embedding state-machine details in application source.",
});

export const stateMachineInvokesLambda = eventRule({
  id: "aws.stepfunctions.state-machine-invokes-lambda",
  relationshipType: "aws.stepfunctions.state-machine-invokes-lambda",
  category: "receives-events-from",
  source: {
    serviceId: "aws.stepfunctions.state-machine",
    portId: "aws.stepfunctions.state-machine.lambda-task",
  },
  target: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.synchronous-invocation",
  },
  maximumConnectionsPerSource: 64,
  maximumConnectionsPerTarget: 64,
  maximumConnectionsPerEndpointPair: 16,
  configuration: workflowTaskConfiguration,
  questions: workflowTaskQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.stepfunctions.iam.lambda-invoke",
      actions: ["lambda:InvokeFunction"],
      resourceScope: "target-node",
      explanation:
        "The Step Functions execution role can invoke only the connected Lambda function.",
    }),
  ],
  summary: "Invokes one reviewed Lambda operation as a Step Functions task.",
  guidedExplanation:
    "Choose a task timeout and retry count that fit the function timeout and idempotency behavior.",
  professionalExplanation:
    "Declares an exact Lambda task operation with lambda:InvokeFunction scope, bounded timeout/retry semantics, and no raw ASL or payload template.",
});

export const iamRoleAssumedByStepFunctions = eventRule({
  id: "aws.iam.role-assumed-by-step-functions",
  relationshipType: "aws.iam.role-assumed-by-step-functions",
  category: "network-and-security",
  source: { serviceId: "aws.iam.role", portId: "aws.iam.role.assumable-role" },
  target: {
    serviceId: "aws.stepfunctions.state-machine",
    portId: "aws.stepfunctions.state-machine.execution-role",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  iamEffects: [
    {
      id: "aws.iam.effect.step-functions-assume-role",
      effect: "trust",
      actions: ["sts:AssumeRole"],
      resourceScope: "source-node",
      principal: "states.amazonaws.com",
      explanation:
        "The role trust policy permits only the Step Functions service principal.",
    },
  ],
  summary: "Assigns one least-privilege execution role to a state machine.",
  guidedExplanation:
    "The workflow uses this role for its reviewed task permissions; it is not shared automatically with a Lambda function.",
  professionalExplanation:
    "Binds one execution role and exact states.amazonaws.com sts:AssumeRole trust requirement to the state machine.",
});

export const iamRoleAssumedByEventBridgeTarget = eventRule({
  id: "aws.iam.role-assumed-by-eventbridge-target",
  relationshipType: "aws.iam.role-assumed-by-eventbridge-target",
  category: "network-and-security",
  source: { serviceId: "aws.iam.role", portId: "aws.iam.role.assumable-role" },
  target: {
    serviceId: "aws.eventbridge.target",
    portId: "aws.eventbridge.target.execution-role",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  iamEffects: [
    {
      id: "aws.iam.effect.eventbridge-assume-role",
      effect: "trust",
      actions: ["sts:AssumeRole"],
      resourceScope: "source-node",
      principal: "events.amazonaws.com",
      explanation:
        "The role trust policy permits only the EventBridge service principal.",
    },
  ],
  summary:
    "Assigns one least-privilege execution role to a Step Functions EventBridge target.",
  guidedExplanation:
    "EventBridge uses this role only to start the connected workflow; Lambda, SNS, and SQS targets use their reviewed resource policies instead.",
  professionalExplanation:
    "Binds one conditional target execution role and exact events.amazonaws.com sts:AssumeRole trust requirement without inferring a shared workload identity.",
});

export const lambdaUsesDeadLetterQueue = eventRule({
  id: "aws.lambda.uses-sqs-dead-letter-queue",
  relationshipType: "aws.lambda.uses-sqs-dead-letter-queue",
  category: "sends-messages-or-events",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.dead-letter-destination",
  },
  target: {
    serviceId: "aws.sqs.queue",
    portId: "aws.sqs.queue.dead-letter-target",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 64,
  configuration: deliveryConfiguration,
  questions: deliveryQuestions,
  iamEffects: [
    policyEffect({
      id: "aws.lambda.iam.dead-letter-send",
      actions: ["sqs:SendMessage"],
      resourceScope: "target-node",
      explanation:
        "The Lambda execution role sends failed asynchronous invocation records only to the connected queue.",
    }),
  ],
  summary: "Sends exhausted Lambda asynchronous failures to one SQS queue.",
  guidedExplanation:
    "Use a DLQ for asynchronous invocation records that still fail after Lambda retries; investigate before replay.",
  professionalExplanation:
    "Declares exact sqs:SendMessage scope for one Lambda DLQ association; async destinations and automatic replay remain unsupported.",
});

function ownedConfigurationRule(
  input: Readonly<{
    id: string;
    relationshipType: string;
    sourceServiceId: string;
    sourcePort: string;
    targetServiceId: string;
    maximumConnectionsPerOwner?: number;
    targetPort: string;
    summary: string;
  }>,
) {
  return eventRule({
    id: input.id,
    relationshipType: input.relationshipType,
    category: "uses-secrets-or-configuration",
    source: { serviceId: input.sourceServiceId, portId: input.sourcePort },
    target: { serviceId: input.targetServiceId, portId: input.targetPort },
    maximumConnectionsPerSource: 1,
    maximumConnectionsPerTarget: input.maximumConnectionsPerOwner ?? 1,
    summary: input.summary,
    guidedExplanation:
      "This setting belongs to exactly one resource and remains separate from unrelated configuration.",
    professionalExplanation:
      "Binds one typed graph-backed configuration to one exact owner slot with user/generated lifecycle and adoption enforced by graph provenance.",
  });
}

export const s3BucketOwnsLifecycle = ownedConfigurationRule({
  id: "aws.s3.bucket-owns-lifecycle-configuration",
  relationshipType: "aws.s3.bucket-owns-lifecycle-configuration",
  sourceServiceId: "aws.s3.bucket-lifecycle-configuration",
  sourcePort: "aws.s3.bucket-lifecycle-configuration.bucket",
  targetServiceId: "aws.s3.bucket",
  targetPort: "aws.s3.bucket.lifecycle-configuration",
  summary: "Attaches one bounded lifecycle configuration to an S3 bucket.",
});

export const s3BucketOwnsCors = ownedConfigurationRule({
  id: "aws.s3.bucket-owns-cors-configuration",
  relationshipType: "aws.s3.bucket-owns-cors-configuration",
  sourceServiceId: "aws.s3.bucket-cors-configuration",
  sourcePort: "aws.s3.bucket-cors-configuration.bucket",
  targetServiceId: "aws.s3.bucket",
  targetPort: "aws.s3.bucket.cors-configuration",
  summary: "Attaches one bounded CORS configuration to an S3 bucket.",
});

export const s3BucketOwnsNotification = ownedConfigurationRule({
  id: "aws.s3.bucket-owns-notification-configuration",
  relationshipType: "aws.s3.bucket-owns-notification-configuration",
  sourceServiceId: "aws.s3.bucket-notification-configuration",
  sourcePort: "aws.s3.bucket-notification-configuration.bucket",
  targetServiceId: "aws.s3.bucket",
  maximumConnectionsPerOwner: 100,
  targetPort: "aws.s3.bucket.notification-configuration",
  summary: "Attaches one reviewed notification configuration to an S3 bucket.",
});

export const sqsQueueOwnsRedrive = ownedConfigurationRule({
  id: "aws.sqs.queue-owns-redrive-configuration",
  relationshipType: "aws.sqs.queue-owns-redrive-configuration",
  sourceServiceId: "aws.sqs.redrive-configuration",
  sourcePort: "aws.sqs.redrive-configuration.queue",
  targetServiceId: "aws.sqs.queue",
  targetPort: "aws.sqs.queue.redrive-configuration",
  summary:
    "Attaches one retry and redrive configuration to an SQS source queue.",
});

function resourcePolicyOwnershipRule(
  input: Readonly<{
    id: string;
    relationshipType: string;
    policyPort: string;
    ownerServiceId: string;
    ownerPort: string;
    summary: string;
  }>,
) {
  return eventRule({
    id: input.id,
    relationshipType: input.relationshipType,
    category: "network-and-security",
    source: {
      serviceId: "aws.iam.policy-document",
      portId: input.policyPort,
    },
    target: { serviceId: input.ownerServiceId, portId: input.ownerPort },
    maximumConnectionsPerSource: 1,
    maximumConnectionsPerTarget: 1,
    summary: input.summary,
    guidedExplanation:
      "This resource policy belongs to one exact service and stays separate from execution-role permissions.",
    professionalExplanation:
      "Binds one canonical resource-policy document to one owner slot; principals, actions, scopes, conditions, lifecycle, and adoption remain typed graph facts.",
  });
}

export const s3BucketOwnsResourcePolicy = resourcePolicyOwnershipRule({
  id: "aws.s3.bucket-owns-resource-policy",
  relationshipType: "aws.s3.bucket-owns-resource-policy",
  policyPort: "aws.iam.policy-document.s3-bucket-resource-policy",
  ownerServiceId: "aws.s3.bucket",
  ownerPort: "aws.s3.bucket.resource-policy",
  summary: "Attaches one canonical resource policy to an S3 bucket.",
});

export const sqsQueueOwnsResourcePolicy = resourcePolicyOwnershipRule({
  id: "aws.sqs.queue-owns-resource-policy",
  relationshipType: "aws.sqs.queue-owns-resource-policy",
  policyPort: "aws.iam.policy-document.sqs-queue-resource-policy",
  ownerServiceId: "aws.sqs.queue",
  ownerPort: "aws.sqs.queue.resource-policy",
  summary: "Attaches one canonical resource policy to an SQS queue.",
});

export const snsTopicOwnsResourcePolicy = resourcePolicyOwnershipRule({
  id: "aws.sns.topic-owns-resource-policy",
  relationshipType: "aws.sns.topic-owns-resource-policy",
  policyPort: "aws.iam.policy-document.sns-topic-resource-policy",
  ownerServiceId: "aws.sns.topic",
  ownerPort: "aws.sns.topic.resource-policy",
  summary: "Attaches one canonical resource policy to an SNS topic.",
});

export const eventBusOwnsResourcePolicy = resourcePolicyOwnershipRule({
  id: "aws.eventbridge.event-bus-owns-resource-policy",
  relationshipType: "aws.eventbridge.event-bus-owns-resource-policy",
  policyPort: "aws.iam.policy-document.event-bus-resource-policy",
  ownerServiceId: "aws.eventbridge.event-bus",
  ownerPort: "aws.eventbridge.event-bus.resource-policy",
  summary: "Attaches one canonical resource policy to an EventBridge bus.",
});

function policyScopeRule(
  input: Readonly<{
    id: string;
    relationshipType: string;
    statementPort: string;
    targetServiceId: string;
    targetPort: string;
    summary: string;
  }>,
) {
  return eventRule({
    id: input.id,
    relationshipType: input.relationshipType,
    category: "network-and-security",
    source: {
      serviceId: "aws.iam.policy-statement",
      portId: input.statementPort,
    },
    target: { serviceId: input.targetServiceId, portId: input.targetPort },
    maximumConnectionsPerSource: 128,
    maximumConnectionsPerTarget: 128,
    summary: input.summary,
    guidedExplanation:
      "This edge uses the selected graph resource instead of a pasted ARN or wildcard.",
    professionalExplanation:
      "Supplies one typed architecture-node ARN scope to the canonical policy projection with exact lifecycle and owner provenance.",
  });
}

export const policyScopesS3 = policyScopeRule({
  id: "aws.iam.policy-statement-authorizes-s3-bucket",
  relationshipType: "aws.iam.authorizes-s3-bucket",
  statementPort: "aws.iam.policy-statement.s3-resource",
  targetServiceId: "aws.s3.bucket",
  targetPort: "aws.s3.bucket.policy-resource",
  summary: "Scopes one policy statement to an S3 bucket.",
});

export const policyScopesSqs = policyScopeRule({
  id: "aws.iam.policy-statement-authorizes-sqs-queue",
  relationshipType: "aws.iam.authorizes-sqs-queue",
  statementPort: "aws.iam.policy-statement.sqs-resource",
  targetServiceId: "aws.sqs.queue",
  targetPort: "aws.sqs.queue.policy-resource",
  summary: "Scopes one policy statement to an SQS queue.",
});

export const policyScopesSns = policyScopeRule({
  id: "aws.iam.policy-statement-authorizes-sns-topic",
  relationshipType: "aws.iam.authorizes-sns-topic",
  statementPort: "aws.iam.policy-statement.sns-resource",
  targetServiceId: "aws.sns.topic",
  targetPort: "aws.sns.topic.policy-resource",
  summary: "Scopes one policy statement to an SNS topic.",
});

export const policyScopesEventBridge = policyScopeRule({
  id: "aws.iam.policy-statement-authorizes-eventbridge-bus",
  relationshipType: "aws.iam.authorizes-eventbridge-bus",
  statementPort: "aws.iam.policy-statement.eventbridge-resource",
  targetServiceId: "aws.eventbridge.event-bus",
  targetPort: "aws.eventbridge.event-bus.policy-resource",
  summary: "Scopes one policy statement to an EventBridge bus.",
});

export const policyScopesStepFunctions = policyScopeRule({
  id: "aws.iam.policy-statement-authorizes-step-functions-state-machine",
  relationshipType: "aws.iam.authorizes-step-functions-state-machine",
  statementPort: "aws.iam.policy-statement.step-functions-resource",
  targetServiceId: "aws.stepfunctions.state-machine",
  targetPort: "aws.stepfunctions.state-machine.policy-resource",
  summary: "Scopes one policy statement to a Step Functions state machine.",
});

export const awsEventDrivenConnectionRulesV1 = Object.freeze([
  s3NotifiesLambda,
  s3SendsEventsToEventBridge,
  lambdaSendsMessageToSqs,
  sqsTriggersLambda,
  sqsUsesDeadLetterQueue,
  lambdaPublishesToSns,
  snsTopicOwnsSubscription,
  snsSubscriptionInvokesLambda,
  snsSubscriptionSendsToSqs,
  lambdaPutsEventsOnBus,
  eventBusAssociatesRule,
  eventBridgeRuleOwnsTarget,
  eventBridgeTargetInvokesLambda,
  eventBridgeTargetSendsToSqs,
  eventBridgeTargetPublishesToSns,
  eventBridgeTargetStartsStateMachine,
  eventBridgeTargetUsesDeadLetterQueue,
  lambdaStartsStateMachine,
  stateMachineInvokesLambda,
  iamRoleAssumedByStepFunctions,
  iamRoleAssumedByEventBridgeTarget,
  lambdaUsesDeadLetterQueue,
  s3BucketOwnsLifecycle,
  s3BucketOwnsCors,
  s3BucketOwnsNotification,
  sqsQueueOwnsRedrive,
  s3BucketOwnsResourcePolicy,
  sqsQueueOwnsResourcePolicy,
  snsTopicOwnsResourcePolicy,
  eventBusOwnsResourcePolicy,
  policyScopesS3,
  policyScopesSqs,
  policyScopesSns,
  policyScopesEventBridge,
  policyScopesStepFunctions,
]);
