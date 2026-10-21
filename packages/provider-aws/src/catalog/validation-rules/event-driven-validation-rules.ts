import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";

const eventServiceIds = [
  "aws.eventbridge.event-bus",
  "aws.eventbridge.rule",
  "aws.eventbridge.target",
  "aws.lambda.function",
  "aws.s3.bucket",
  "aws.s3.bucket-notification-configuration",
  "aws.sns.subscription",
  "aws.sns.topic",
  "aws.sqs.queue",
  "aws.sqs.redrive-configuration",
  "aws.stepfunctions.state-machine",
] as const;

export const eventTopologyValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.event-topology",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-event-topology",
    serviceIds: [...eventServiceIds],
    documentation: [
      {
        kind: "official",
        id: "aws.eventing.documentation.reliability",
        title:
          "Building serverless applications with event-driven architectures",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/concepts-event-driven-architectures.html",
      },
    ],
  });

export const eventDeliveryValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.event-delivery",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-event-delivery",
    serviceIds: [
      ...eventServiceIds,
      "aws.iam.policy-document",
      "aws.iam.policy-statement",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.sqs-event-source",
        title: "Using Lambda with Amazon SQS",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html",
      },
      {
        kind: "official",
        id: "aws.sqs.documentation.dead-letter-queues",
        title: "Using dead-letter queues in Amazon SQS",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html",
      },
    ],
  });

export const awsEventDrivenValidationRuleDescriptorsV1 = Object.freeze([
  eventTopologyValidationRuleDescriptor,
  eventDeliveryValidationRuleDescriptor,
]);
