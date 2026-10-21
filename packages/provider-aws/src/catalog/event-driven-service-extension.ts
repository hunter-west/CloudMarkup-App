import type {
  ProviderOwnedConfigurationSlotV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
} from "@cloudmarkup/provider-sdk";

function readiness(
  name: string,
  generatedCode: ProviderTargetReadinessV1["generatedCode"]["status"] = "not-applicable",
): ProviderTargetReadinessV1 {
  return {
    modeling: {
      status: "supported",
      reason: `${name} has a curated typed graph definition and exact semantic ports.`,
    },
    configuration: {
      status: "supported",
      reason: `${name} exposes only bounded reviewed configuration.`,
    },
    validation: {
      status: "supported",
      reason: `${name} participates in deterministic event topology and delivery validation.`,
    },
    terraform: {
      status: "supported",
      reason: `${name} has an exact-catalog-bound reviewed deterministic Terraform projection.`,
    },
    cloudformation: {
      status: "pending",
      reason: `${name} has mapping metadata but no reviewed CloudFormation renderer in Prompt 45.`,
    },
    generatedCode: {
      status: generatedCode,
      reason:
        generatedCode === "supported"
          ? `${name} participates in an exact AWS catalog 0.13 curated event application contract and deterministic Lambda artifact build.`
          : generatedCode === "pending"
            ? `${name} binds explicit Workload operations and event contracts, but application handler generation remains pending until Prompt 45A.`
            : `${name} does not itself render application source.`,
    },
  };
}

function slot(
  id: string,
  configurationKind: string,
  displayName: string,
  configurationServiceId: string,
  ownershipRelationshipType: string,
  maximum: 1 | "many",
  policyKinds: ProviderOwnedConfigurationSlotV1Input["policyKinds"] = [],
): ProviderOwnedConfigurationSlotV1Input {
  return {
    id,
    slotVersion: "1.0.0",
    configurationKind,
    displayName,
    description: `${displayName} remains an explicit graph-backed child with stable ownership and provenance.`,
    graphBinding: { configurationServiceId, ownershipRelationshipType },
    cardinality: { minimum: 0, maximum, enforcement: "provider-rule" },
    allowedOwnership: ["user", "generated"],
    generatedAdoption: "allowed",
    policyKinds,
    targetReadiness: readiness(displayName),
    guidedExplanation:
      "Review this setting separately from the service, and adopt generated content before customizing it.",
    professionalExplanation:
      "Exact owner edges, generated lifecycle metadata, adoption state, and deterministic cleanup prevent silent replacement.",
  };
}

const bucketSlots = [
  slot(
    "aws.s3.bucket.slot.resource-policy",
    "aws.iam.policy.s3-resource",
    "S3 bucket policy",
    "aws.iam.policy-document",
    "aws.s3.bucket-owns-resource-policy",
    1,
    ["resource"],
  ),
  slot(
    "aws.s3.bucket.slot.lifecycle",
    "aws.s3.lifecycle",
    "S3 lifecycle configuration",
    "aws.s3.bucket-lifecycle-configuration",
    "aws.s3.bucket-owns-lifecycle-configuration",
    1,
  ),
  slot(
    "aws.s3.bucket.slot.cors",
    "aws.s3.cors",
    "S3 CORS configuration",
    "aws.s3.bucket-cors-configuration",
    "aws.s3.bucket-owns-cors-configuration",
    1,
  ),
  slot(
    "aws.s3.bucket.slot.notifications",
    "aws.s3.notification",
    "S3 notification configuration",
    "aws.s3.bucket-notification-configuration",
    "aws.s3.bucket-owns-notification-configuration",
    "many",
  ),
];

const queueSlots = [
  slot(
    "aws.sqs.queue.slot.resource-policy",
    "aws.iam.policy.sqs-resource",
    "SQS queue policy",
    "aws.iam.policy-document",
    "aws.sqs.queue-owns-resource-policy",
    1,
    ["resource"],
  ),
  slot(
    "aws.sqs.queue.slot.redrive",
    "aws.sqs.redrive",
    "SQS redrive configuration",
    "aws.sqs.redrive-configuration",
    "aws.sqs.queue-owns-redrive-configuration",
    1,
  ),
];

const topicSlots = [
  slot(
    "aws.sns.topic.slot.resource-policy",
    "aws.iam.policy.sns-resource",
    "SNS topic policy",
    "aws.iam.policy-document",
    "aws.sns.topic-owns-resource-policy",
    1,
    ["resource"],
  ),
  slot(
    "aws.sns.topic.slot.subscriptions",
    "aws.sns.subscription",
    "SNS subscriptions",
    "aws.sns.subscription",
    "aws.sns.topic-owns-subscription",
    "many",
  ),
];

const eventBusSlots = [
  slot(
    "aws.eventbridge.event-bus.slot.resource-policy",
    "aws.iam.policy.eventbridge-resource",
    "EventBridge bus policy",
    "aws.iam.policy-document",
    "aws.eventbridge.event-bus-owns-resource-policy",
    1,
    ["resource"],
  ),
];

const eventRuleSlots = [
  slot(
    "aws.eventbridge.rule.slot.targets",
    "aws.eventbridge.target",
    "EventBridge targets",
    "aws.eventbridge.target",
    "aws.eventbridge.rule-owns-target",
    "many",
  ),
];

export const awsEventDrivenServiceExtensions0_12_0: ProviderServiceExtensionDefinitionV1Input[] =
  [
    {
      serviceId: "aws.s3.bucket",
      targetReadiness: readiness("S3 bucket", "pending"),
      ownedConfigurationSlots: bucketSlots,
    },
    {
      serviceId: "aws.s3.bucket-lifecycle-configuration",
      targetReadiness: readiness("S3 lifecycle configuration"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.s3.bucket-cors-configuration",
      targetReadiness: readiness("S3 CORS configuration"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.s3.bucket-notification-configuration",
      targetReadiness: readiness("S3 notification configuration", "pending"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.sqs.queue",
      targetReadiness: readiness("SQS queue", "pending"),
      ownedConfigurationSlots: queueSlots,
    },
    {
      serviceId: "aws.sqs.redrive-configuration",
      targetReadiness: readiness("SQS redrive configuration"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.sns.topic",
      targetReadiness: readiness("SNS topic", "pending"),
      ownedConfigurationSlots: topicSlots,
    },
    {
      serviceId: "aws.sns.subscription",
      targetReadiness: readiness("SNS subscription", "pending"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.eventbridge.event-bus",
      targetReadiness: readiness("EventBridge event bus", "pending"),
      ownedConfigurationSlots: eventBusSlots,
    },
    {
      serviceId: "aws.eventbridge.rule",
      targetReadiness: readiness("EventBridge rule", "pending"),
      ownedConfigurationSlots: eventRuleSlots,
    },
    {
      serviceId: "aws.eventbridge.target",
      targetReadiness: readiness("EventBridge target", "pending"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.stepfunctions.state-machine",
      targetReadiness: readiness("Step Functions state machine", "pending"),
      ownedConfigurationSlots: [],
    },
  ];

export const awsEventDrivenServiceExtensionsV1: ProviderServiceExtensionDefinitionV1Input[] =
  awsEventDrivenServiceExtensions0_12_0.map((extension) => {
    return {
      ...extension,
      targetReadiness: {
        ...extension.targetReadiness,
        cloudformation: {
          status: "supported",
          reason: `${extension.serviceId} has an exact AWS catalog 0.15 deterministic CloudFormation projection with semantic and negative evidence.`,
        },
        ...(extension.targetReadiness.generatedCode.status === "pending"
          ? {
              generatedCode: {
                status: "supported" as const,
                reason: `${extension.serviceId} participates in an exact AWS catalog 0.13 curated event application contract and deterministic Lambda artifact build.`,
              },
            }
          : {}),
      },
      ownedConfigurationSlots: extension.ownedConfigurationSlots.map(
        (ownedSlot) => ({
          ...ownedSlot,
          targetReadiness: {
            ...ownedSlot.targetReadiness,
            cloudformation: {
              status: "supported" as const,
              reason: `${ownedSlot.displayName} has a graph-backed CloudFormation projection through the exact reviewed event renderer.`,
            },
          },
        }),
      ),
    };
  });
