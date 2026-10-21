import type { ProviderServiceConnectionPresentationV1Input } from "@cloudmarkup/provider-sdk";

type Dock = ProviderServiceConnectionPresentationV1Input["docks"][number];

function dock(input: Dock): Dock {
  return input;
}

function presentation(
  serviceId: string,
  label: string,
  inputPortIds: readonly string[],
  outputPortIds: readonly string[],
  options: Readonly<{
    inputRequired?: boolean;
    outputRequired?: boolean;
    inputMany?: boolean;
    outputMany?: boolean;
  }> = {},
): ProviderServiceConnectionPresentationV1Input {
  const docks: Dock[] = [];
  if (inputPortIds.length > 0) {
    docks.push(
      dock({
        id: `${serviceId}.dock.inbound`,
        category: "messaging",
        label: `${label} inputs`,
        description: `Stable inbound associations and event inputs for ${label}.`,
        placement: "left",
        order: 0,
        directionPolicy: "input-only",
        portIds: [...inputPortIds],
        cardinality: {
          minimum: options.inputRequired === true ? 1 : 0,
          maximum: options.inputMany === false ? 1 : "many",
          enforcement: "provider-rule",
        },
        allowsMultipleEdges: options.inputMany !== false,
        containsExclusiveRelationships: true,
        guidedExplanation:
          "Connect reviewed producers, owners, permissions, or configuration here.",
        professionalExplanation:
          "The dock is presentation-only; exact port identity and provider rules own direction and cardinality.",
      }),
    );
  }
  if (outputPortIds.length > 0) {
    docks.push(
      dock({
        id: `${serviceId}.dock.outbound`,
        category: "messaging",
        label: `${label} outputs`,
        description: `Stable outbound event, target, owner, and scope associations for ${label}.`,
        placement: "right",
        order: 0,
        directionPolicy: "output-only",
        portIds: [...outputPortIds],
        cardinality: {
          minimum: options.outputRequired === true ? 1 : 0,
          maximum: options.outputMany === false ? 1 : "many",
          enforcement: "provider-rule",
        },
        allowsMultipleEdges: options.outputMany !== false,
        containsExclusiveRelationships: true,
        guidedExplanation:
          "Connect the reviewed consumer, target, or owning resource here.",
        professionalExplanation:
          "Stable dock placement never changes event semantics, graph identity, or target rendering.",
      }),
    );
  }
  return { serviceId, docks };
}

const eventBridgeTargetPresentation = presentation(
  "aws.eventbridge.target",
  "EventBridge target",
  ["aws.eventbridge.target.rule"],
  [
    "aws.eventbridge.target.lambda",
    "aws.eventbridge.target.queue",
    "aws.eventbridge.target.topic",
    "aws.eventbridge.target.state-machine",
    "aws.eventbridge.target.dead-letter-queue",
  ],
  { inputRequired: true, inputMany: false },
);

eventBridgeTargetPresentation.docks.push(
  dock({
    id: "aws.eventbridge.target.dock.identity",
    category: "identity",
    label: "Execution role",
    description: "The service role used for a Step Functions target.",
    placement: "left",
    order: 1,
    directionPolicy: "input-only",
    portIds: ["aws.eventbridge.target.execution-role"],
    cardinality: {
      minimum: 0,
      maximum: 1,
      enforcement: "provider-rule",
    },
    allowsMultipleEdges: false,
    containsExclusiveRelationships: true,
    guidedExplanation:
      "Connect one reviewed EventBridge role only when this target starts a Step Functions workflow.",
    professionalExplanation:
      "The exact conditional role port remains separate from the owning-rule event input and target outputs.",
  }),
);

export const awsEventDrivenServiceConnectionPresentationsV1 = Object.freeze([
  presentation(
    "aws.s3.bucket",
    "S3 bucket",
    [
      "aws.s3.bucket.object-api",
      "aws.s3.bucket.policy-resource",
      "aws.s3.bucket.resource-policy",
      "aws.s3.bucket.lifecycle-configuration",
      "aws.s3.bucket.cors-configuration",
      "aws.s3.bucket.notification-configuration",
    ],
    ["aws.s3.bucket.notifications", "aws.s3.bucket.eventbridge"],
  ),
  presentation(
    "aws.s3.bucket-lifecycle-configuration",
    "Lifecycle",
    [],
    ["aws.s3.bucket-lifecycle-configuration.bucket"],
    { outputRequired: true, outputMany: false },
  ),
  presentation(
    "aws.s3.bucket-cors-configuration",
    "CORS",
    [],
    ["aws.s3.bucket-cors-configuration.bucket"],
    { outputRequired: true, outputMany: false },
  ),
  presentation(
    "aws.s3.bucket-notification-configuration",
    "Notification",
    [],
    ["aws.s3.bucket-notification-configuration.bucket"],
    { outputRequired: true, outputMany: false },
  ),
  presentation(
    "aws.sqs.queue",
    "SQS queue",
    [
      "aws.sqs.queue.message-send",
      "aws.sqs.queue.dead-letter-target",
      "aws.sqs.queue.policy-resource",
      "aws.sqs.queue.resource-policy",
      "aws.sqs.queue.redrive-configuration",
    ],
    ["aws.sqs.queue.event-source", "aws.sqs.queue.redrive"],
  ),
  presentation(
    "aws.sqs.redrive-configuration",
    "Redrive policy",
    [],
    ["aws.sqs.redrive-configuration.queue"],
    { outputRequired: true, outputMany: false },
  ),
  presentation(
    "aws.sns.topic",
    "SNS topic",
    [
      "aws.sns.topic.publish",
      "aws.sns.topic.policy-resource",
      "aws.sns.topic.resource-policy",
    ],
    ["aws.sns.topic.subscriptions"],
  ),
  presentation(
    "aws.sns.subscription",
    "SNS subscription",
    ["aws.sns.subscription.topic"],
    [
      "aws.sns.subscription.lambda-delivery",
      "aws.sns.subscription.queue-delivery",
    ],
    { inputRequired: true, inputMany: false },
  ),
  presentation(
    "aws.eventbridge.event-bus",
    "Event bus",
    [
      "aws.eventbridge.event-bus.publish",
      "aws.eventbridge.event-bus.aws-service-events",
      "aws.eventbridge.event-bus.policy-resource",
      "aws.eventbridge.event-bus.resource-policy",
    ],
    ["aws.eventbridge.event-bus.rules"],
  ),
  presentation(
    "aws.eventbridge.rule",
    "EventBridge rule",
    ["aws.eventbridge.rule.event-bus"],
    ["aws.eventbridge.rule.targets"],
    { inputRequired: true, inputMany: false },
  ),
  eventBridgeTargetPresentation,
  presentation(
    "aws.stepfunctions.state-machine",
    "State machine",
    [
      "aws.stepfunctions.state-machine.start-execution",
      "aws.stepfunctions.state-machine.execution-role",
      "aws.stepfunctions.state-machine.policy-resource",
    ],
    ["aws.stepfunctions.state-machine.lambda-task"],
    { inputRequired: true },
  ),
]);

export const awsEventDrivenRelationshipLabelsV1 = Object.freeze([
  { ruleId: "aws.s3.bucket-notifies-lambda", label: "Notifies" },
  {
    ruleId: "aws.s3.bucket-sends-events-to-eventbridge",
    label: "Sends service events",
  },
  { ruleId: "aws.lambda.sends-message-to-sqs", label: "Sends message" },
  { ruleId: "aws.sqs.queue-triggers-lambda", label: "Delivers messages" },
  { ruleId: "aws.sqs.queue-uses-dead-letter-queue", label: "Dead-letters to" },
  { ruleId: "aws.lambda.publishes-to-sns", label: "Publishes" },
  { ruleId: "aws.sns.topic-owns-subscription", label: "Fans out through" },
  { ruleId: "aws.sns.subscription-invokes-lambda", label: "Invokes" },
  { ruleId: "aws.sns.subscription-sends-to-sqs", label: "Sends message" },
  { ruleId: "aws.lambda.puts-events-on-eventbridge", label: "Puts events" },
  {
    ruleId: "aws.eventbridge.event-bus-associates-rule",
    label: "Evaluates with",
  },
  { ruleId: "aws.eventbridge.rule-owns-target", label: "Routes through" },
  { ruleId: "aws.eventbridge.target-invokes-lambda", label: "Invokes" },
  { ruleId: "aws.eventbridge.target-sends-to-sqs", label: "Sends message" },
  { ruleId: "aws.eventbridge.target-publishes-to-sns", label: "Publishes" },
  {
    ruleId: "aws.eventbridge.target-starts-state-machine",
    label: "Starts workflow",
  },
  {
    ruleId: "aws.eventbridge.target-uses-dead-letter-queue",
    label: "Dead-letters to",
  },
  {
    ruleId: "aws.lambda.starts-step-functions-state-machine",
    label: "Starts workflow",
  },
  {
    ruleId: "aws.stepfunctions.state-machine-invokes-lambda",
    label: "Runs task",
  },
  { ruleId: "aws.iam.role-assumed-by-step-functions", label: "Uses role" },
  {
    ruleId: "aws.iam.role-assumed-by-eventbridge-target",
    label: "Uses role",
  },
  { ruleId: "aws.lambda.uses-sqs-dead-letter-queue", label: "Dead-letters to" },
  {
    ruleId: "aws.s3.bucket-owns-lifecycle-configuration",
    label: "Uses lifecycle",
  },
  { ruleId: "aws.s3.bucket-owns-cors-configuration", label: "Uses CORS" },
  {
    ruleId: "aws.s3.bucket-owns-notification-configuration",
    label: "Owns notification",
  },
  {
    ruleId: "aws.sqs.queue-owns-redrive-configuration",
    label: "Uses redrive policy",
  },
  { ruleId: "aws.s3.bucket-owns-resource-policy", label: "Uses bucket policy" },
  { ruleId: "aws.sqs.queue-owns-resource-policy", label: "Uses queue policy" },
  { ruleId: "aws.sns.topic-owns-resource-policy", label: "Uses topic policy" },
  {
    ruleId: "aws.eventbridge.event-bus-owns-resource-policy",
    label: "Uses bus policy",
  },
  {
    ruleId: "aws.iam.policy-statement-authorizes-s3-bucket",
    label: "Scopes access",
  },
  {
    ruleId: "aws.iam.policy-statement-authorizes-sqs-queue",
    label: "Scopes access",
  },
  {
    ruleId: "aws.iam.policy-statement-authorizes-sns-topic",
    label: "Scopes access",
  },
  {
    ruleId: "aws.iam.policy-statement-authorizes-eventbridge-bus",
    label: "Scopes access",
  },
  {
    ruleId: "aws.iam.policy-statement-authorizes-step-functions-state-machine",
    label: "Scopes access",
  },
]);
