import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

import {
  eventDrivenRegionAvailability,
  eventDrivenValidationRuleIds,
  eventMetadataMappings,
  internalEventConfiguration,
} from "./event-driven-helpers.js";

const eventBridgeDocumentation = [
  {
    kind: "official" as const,
    id: "aws.eventbridge.documentation.rules",
    title: "Amazon EventBridge rules",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html",
  },
];

export const eventBridgeBus = defineProviderServiceV1({
  id: "aws.eventbridge.event-bus",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "EventBridge event bus",
  description:
    "A default or custom same-account event bus for reviewed application and AWS service events.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.eventbridge.event-bus",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.eventbridge",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.eventbridge.event-bus.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.eventbridge.event-bus.configuration:1.0.0",
      type: "object",
      title: "EventBridge event bus configuration",
      description:
        "A default AWS service-event bus or one same-account custom application bus.",
      additionalProperties: false,
      properties: {
        busName: {
          type: "string",
          default: "application-events",
          minLength: 1,
          maxLength: 256,
          pattern: "^[A-Za-z0-9._-]+$",
        },
        busType: {
          type: "string",
          enum: ["DEFAULT", "CUSTOM"],
          default: "CUSTOM",
        },
        encryption: {
          type: "string",
          enum: ["AWS_OWNED"],
          default: "AWS_OWNED",
        },
        deletionProtectionEnabled: {
          type: "boolean",
          const: true,
          default: true,
        },
      },
      required: [
        "busName",
        "busType",
        "encryption",
        "deletionProtectionEnabled",
      ],
    },
    uiHints: [
      {
        property: "busName",
        control: "text",
        label: "Bus name",
        helpText: "Use default only when the bus type is Default.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "busType",
        control: "select",
        label: "Bus type",
        helpText:
          "AWS service events such as S3 arrive on the default bus. Application events can use a custom bus.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "encryption",
        control: "select",
        label: "Encryption",
        helpText:
          "This slice uses AWS-owned encryption. Customer-managed keys require key-policy support.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "deletionProtectionEnabled",
        control: "checkbox",
        label: "Protect from accidental deletion",
        order: 3,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.eventbridge.event-bus.publish",
      displayName: "Put events",
      description: "Accepts reviewed custom events from producers.",
      direction: "input",
      capability: "aws.eventbridge.events.put",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.eventbridge.event-bus.aws-service-events",
      displayName: "AWS service events",
      description: "Accepts supported same-Region AWS service events.",
      direction: "input",
      capability: "aws.eventbridge.events.aws-service",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.eventbridge.event-bus.rules",
      displayName: "Rules",
      description: "Associates reviewed matching rules with this bus.",
      direction: "output",
      capability: "aws.eventbridge.rule",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.eventbridge.event-bus.policy-resource",
      displayName: "Policy resource",
      description: "Provides this bus ARN to typed IAM policy statements.",
      direction: "input",
      capability: "aws.iam.policy.eventbridge-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.eventbridge.event-bus.resource-policy",
      displayName: "Bus policy",
      description: "Accepts one reviewed event-bus resource policy.",
      direction: "input",
      capability: "aws.eventbridge.event-bus.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
  ],
  validationRuleIds: [...eventDrivenValidationRuleIds],
  education: {
    summary:
      "Routes matching AWS or application events to independently configured targets.",
    guidedExplanation:
      "A bus receives events; rules decide which ones match; targets decide where matches go. S3 service events use the default bus. Custom application events use a reviewed PutEvents relationship and an explicit event contract.",
    professionalExplanation:
      "Models default/custom same-account buses with AWS-owned encryption, explicit rules, a canonical resource-policy slot, and exact service/custom producer ports. Partner, cross-account, cross-Region, archive, replay, Pipes, and schema discovery remain excluded.",
    considerations: [
      "Connections: Keep bus, rule, target, and destination as separate graph concepts so filters and retries have one owner.",
      "Security: Scope PutEvents and target permissions to exact buses and destinations; a rule filter is not authorization.",
      "Cost: Custom events, cross-account delivery, archives, replay, API destinations, and target work can add charges.",
      "Operations: Monitor failed invocations and DLQs, and version event contracts before changing producer payloads.",
    ],
    documentation: eventBridgeDocumentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.eventbridge.unsupported.partner-cross-account",
      title: "Partner and cross-account buses",
      explanation:
        "Partner event sources, cross-account/cross-Region routing, organization grants, global endpoints, and discovery are rejected.",
    },
    {
      id: "aws.eventbridge.unsupported.archive-replay-pipes",
      title: "Archive, replay, Pipes, and Scheduler",
      explanation:
        "Archives, replay, EventBridge Pipes, Scheduler, schema registry/discovery, API destinations, and connections require separate contracts.",
    },
    {
      id: "aws.eventbridge.unsupported.custom-kms",
      title: "Customer-managed bus encryption",
      explanation:
        "Customer-managed KMS keys are not exposed until key policies and failure routing are modeled.",
    },
  ],
  mappings: eventMetadataMappings({
    mappingIdPrefix: "aws.eventbridge.event-bus",
    terraformResourceType: "aws_cloudwatch_event_bus",
    cloudFormationTypeName: "AWS::Events::EventBus",
    terraformConfigurationBindings: [
      { configurationKey: "busName", targetName: "name" },
    ],
    cloudFormationConfigurationBindings: [
      { configurationKey: "busName", targetName: "Name" },
    ],
    semanticConfigurationKeys: [
      "busType",
      "encryption",
      "deletionProtectionEnabled",
    ],
    terraformPortBindings: [
      { portId: "aws.eventbridge.event-bus.publish", targetAttribute: "arn" },
      {
        portId: "aws.eventbridge.event-bus.aws-service-events",
        targetAttribute: "arn",
      },
      { portId: "aws.eventbridge.event-bus.rules", targetAttribute: "name" },
      {
        portId: "aws.eventbridge.event-bus.policy-resource",
        targetAttribute: "arn",
      },
      {
        portId: "aws.eventbridge.event-bus.resource-policy",
        targetAttribute: "arn",
      },
    ],
    cloudFormationPortBindings: [
      { portId: "aws.eventbridge.event-bus.publish", targetAttribute: "Arn" },
      {
        portId: "aws.eventbridge.event-bus.aws-service-events",
        targetAttribute: "Arn",
      },
      { portId: "aws.eventbridge.event-bus.rules", targetAttribute: "Name" },
      {
        portId: "aws.eventbridge.event-bus.policy-resource",
        targetAttribute: "Arn",
      },
      {
        portId: "aws.eventbridge.event-bus.resource-policy",
        targetAttribute: "Arn",
      },
    ],
  }),
  regionAvailability: eventDrivenRegionAvailability,
});

export const eventBridgeRule0_11_0 = defineProviderServiceV1({
  id: "aws.eventbridge.rule",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "EventBridge rule",
  description:
    "A bounded event-pattern rule associated with one EventBridge bus and reviewed targets.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.eventbridge.rule",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.eventbridge-rule",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.eventbridge.rule.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.eventbridge.rule.configuration:1.0.0",
      type: "object",
      title: "EventBridge rule configuration",
      description:
        "A closed event-pattern abstraction over source, detail type, and contract field keys.",
      additionalProperties: false,
      properties: {
        ruleName: {
          type: "string",
          default: "route-application-events",
          minLength: 1,
          maxLength: 64,
          pattern: "^[A-Za-z0-9._-]+$",
        },
        enabled: { type: "boolean", default: true },
        sourceKinds: {
          type: "array",
          items: {
            type: "string",
            enum: ["aws.s3", "cloudmarkup.application"],
          },
          default: ["cloudmarkup.application"],
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
        },
        detailTypes: {
          type: "array",
          items: {
            type: "string",
            enum: ["Object Created", "Object Deleted", "Application Event"],
          },
          default: ["Application Event"],
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        },
        filterKeys: {
          type: "array",
          items: { type: "string" },
          default: [],
          maxItems: 8,
          uniqueItems: true,
        },
      },
      required: [
        "ruleName",
        "enabled",
        "sourceKinds",
        "detailTypes",
        "filterKeys",
      ],
    },
    uiHints: [
      {
        property: "ruleName",
        control: "text",
        label: "Rule name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "enabled",
        control: "checkbox",
        label: "Enable matching",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "sourceKinds",
        control: "multi-select",
        label: "Event sources",
        helpText: "Choose only reviewed source namespaces.",
        order: 2,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "detailTypes",
        control: "multi-select",
        label: "Event types",
        order: 3,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "filterKeys",
        control: "multi-select",
        label: "Required detail keys",
        helpText:
          "List stable fields from the bound event contract; values and arbitrary patterns are not stored here.",
        order: 4,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.eventbridge.rule.event-bus",
      displayName: "Event bus",
      description: "Accepts events from exactly one associated bus.",
      direction: "input",
      capability: "aws.eventbridge.rule",
      category: "sends-messages-or-events",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.eventbridge.rule.targets",
      displayName: "Targets",
      description: "Owns zero or more reviewed delivery targets.",
      direction: "output",
      capability: "aws.eventbridge.target",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [...eventDrivenValidationRuleIds],
  education: {
    summary: "Matches a small, readable set of event source and type fields.",
    guidedExplanation:
      "A rule watches one bus and forwards only matching events. Choose the source and event type first; use stable contract keys only when an extra filter is needed.",
    professionalExplanation:
      "Models one enabled/disabled event-pattern rule with closed source/detail-type sets and filter-key inventory. The renderer must derive reviewed JSON; raw event-pattern JSON and schedules are not accepted.",
    considerations: [
      "Connections: Associate one bus and add explicit target configurations.",
      "Security: Keep patterns narrow; matching controls traffic but does not grant target permission.",
      "Cost: Broad rules can multiply target requests, downstream work, and delivery charges unexpectedly.",
      "Operations: Version event contracts and test representative matching and non-matching events.",
    ],
    documentation: eventBridgeDocumentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.eventbridge.rule.unsupported.raw-schedule-managed",
      title: "Raw patterns, schedules, and managed rules",
      explanation:
        "Arbitrary event-pattern JSON, cron/rate schedules, managed rules, rule replacement, and cross-bus forwarding are rejected.",
    },
  ],
  mappings: eventMetadataMappings({
    mappingIdPrefix: "aws.eventbridge.rule",
    terraformResourceType: "aws_cloudwatch_event_rule",
    cloudFormationTypeName: "AWS::Events::Rule",
    terraformConfigurationBindings: [
      { configurationKey: "ruleName", targetName: "name" },
      { configurationKey: "enabled", targetName: "state" },
      { configurationKey: "sourceKinds", targetName: "event_pattern.source" },
      {
        configurationKey: "detailTypes",
        targetName: "event_pattern.detail-type",
      },
      {
        configurationKey: "filterKeys",
        targetName: "event_pattern.detail.keys",
      },
    ],
    cloudFormationConfigurationBindings: [
      { configurationKey: "ruleName", targetName: "Name" },
      { configurationKey: "enabled", targetName: "State" },
      { configurationKey: "sourceKinds", targetName: "EventPattern.source" },
      {
        configurationKey: "detailTypes",
        targetName: "EventPattern.detail-type",
      },
      {
        configurationKey: "filterKeys",
        targetName: "EventPattern.detail.Keys",
      },
    ],
    terraformPortBindings: [
      {
        portId: "aws.eventbridge.rule.event-bus",
        targetAttribute: "event_bus_name",
      },
      { portId: "aws.eventbridge.rule.targets", targetAttribute: "name" },
    ],
    cloudFormationPortBindings: [
      {
        portId: "aws.eventbridge.rule.event-bus",
        targetAttribute: "EventBusName",
      },
      { portId: "aws.eventbridge.rule.targets", targetAttribute: "Name" },
    ],
  }),
  regionAvailability: eventDrivenRegionAvailability,
});

export const eventBridgeRule = defineProviderServiceV1({
  ...eventBridgeRule0_11_0,
  definitionVersion: "1.1.0",
  description:
    "A bounded event-pattern or fixed-rate scheduled rule associated with one EventBridge bus and reviewed targets.",
  configuration: {
    ...eventBridgeRule0_11_0.configuration,
    schemaVersion: "1.1.0",
    jsonSchema: {
      ...eventBridgeRule0_11_0.configuration.jsonSchema,
      $id: "urn:cloudmarkup:configuration:aws.eventbridge.rule.configuration:1.1.0",
      description:
        "A closed event-pattern or fixed-rate schedule abstraction without raw JSON or arbitrary schedule expressions.",
      properties: {
        ...eventBridgeRule0_11_0.configuration.jsonSchema.properties,
        triggerMode: {
          type: "string",
          enum: ["EVENT_PATTERN", "SCHEDULE"],
          default: "EVENT_PATTERN",
        },
        scheduleExpression: {
          type: "string",
          enum: ["NONE", "RATE_5_MINUTES", "RATE_1_HOUR", "RATE_1_DAY"],
          default: "NONE",
        },
      },
      required: [
        ...eventBridgeRule0_11_0.configuration.jsonSchema.required,
        "triggerMode",
        "scheduleExpression",
      ],
    },
    uiHints: [
      ...eventBridgeRule0_11_0.configuration.uiHints,
      {
        property: "triggerMode",
        control: "select",
        label: "Trigger mode",
        helpText:
          "Choose contract-based event matching or one reviewed fixed-rate schedule.",
        order: 5,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "scheduleExpression",
        control: "select",
        label: "Schedule",
        helpText:
          "Fixed rates make invocation volume and cost easier to review; arbitrary cron text is not accepted.",
        order: 6,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
    ],
  },
  education: {
    ...eventBridgeRule0_11_0.education,
    summary:
      "Matches a small event contract or invokes targets on one reviewed fixed rate.",
    guidedExplanation:
      "Choose either event matching or a fixed schedule. Event rules use reviewed sources and types; schedules use one bounded rate so invocation volume remains understandable.",
    professionalExplanation:
      "Models one enabled/disabled event-pattern or fixed-rate rule. Terraform derives canonical event JSON or one exact rate expression; raw patterns, raw cron, managed rules, and input transforms remain unsupported.",
  },
  unsupportedCapabilities: [
    {
      id: "aws.eventbridge.rule.unsupported.raw-managed",
      title: "Raw patterns, arbitrary schedules, and managed rules",
      explanation:
        "Arbitrary event-pattern JSON, arbitrary cron/rate expressions, managed rules, rule replacement, and cross-bus forwarding are rejected.",
    },
  ],
  mappings: eventBridgeRule0_11_0.mappings.map((mapping) => ({
    ...mapping,
    configurationBindings: [
      ...mapping.configurationBindings,
      {
        configurationKey: "scheduleExpression",
        targetName:
          mapping.target === "terraform"
            ? "schedule_expression"
            : "ScheduleExpression",
      },
    ],
    semanticConfigurationKeys: [
      ...(mapping.semanticConfigurationKeys ?? []),
      "triggerMode",
    ],
  })),
});

export const eventBridgeTarget = defineProviderServiceV1(
  internalEventConfiguration({
    serviceId: "aws.eventbridge.target",
    resourceType: "aws.eventbridge.target",
    displayName: "EventBridge target",
    description:
      "One Lambda, SQS, SNS, or Step Functions target with bounded retry and optional SQS DLQ.",
    ownerServiceId: "aws.eventbridge.rule",
    ownerRelationshipType: "aws.eventbridge.rule-owns-target",
    configuration: {
      schemaId: "aws.eventbridge.target.configuration",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:aws.eventbridge.target.configuration:1.0.0",
        type: "object",
        title: "EventBridge target configuration",
        description:
          "A reviewed target type, matched-event input, bounded retry, event age, and optional SQS dead-letter mode.",
        additionalProperties: false,
        properties: {
          targetName: {
            type: "string",
            default: "primary-target",
            minLength: 1,
            maxLength: 64,
            pattern: "^[A-Za-z0-9._-]+$",
          },
          targetType: {
            type: "string",
            enum: ["LAMBDA", "SQS", "SNS", "STEP_FUNCTIONS"],
            default: "LAMBDA",
          },
          inputMode: {
            type: "string",
            enum: ["MATCHED_EVENT"],
            default: "MATCHED_EVENT",
          },
          maximumRetryAttempts: {
            type: "integer",
            enum: [0, 3, 10, 24, 185],
            default: 24,
          },
          maximumEventAgeSeconds: {
            type: "integer",
            enum: [60, 300, 3600, 21600, 86400],
            default: 3600,
          },
          deadLetterMode: {
            type: "string",
            enum: ["NONE", "SQS"],
            default: "NONE",
          },
          deliverySemantics: {
            type: "string",
            enum: ["AT_LEAST_ONCE"],
            default: "AT_LEAST_ONCE",
          },
        },
        required: [
          "targetName",
          "targetType",
          "inputMode",
          "maximumRetryAttempts",
          "maximumEventAgeSeconds",
          "deadLetterMode",
          "deliverySemantics",
        ],
      },
      uiHints: [
        {
          property: "targetName",
          control: "text",
          label: "Target name",
          order: 0,
          advanced: true,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "none",
        },
        {
          property: "targetType",
          control: "select",
          label: "Target type",
          order: 1,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
        {
          property: "inputMode",
          control: "select",
          label: "Payload sent to target",
          helpText:
            "The full matched event is the only reviewed mode; input transformers require a later contract.",
          order: 2,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "none",
        },
        {
          property: "maximumRetryAttempts",
          control: "number",
          label: "Maximum retries",
          order: 3,
          advanced: false,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "cost-sensitive",
        },
        {
          property: "maximumEventAgeSeconds",
          control: "number",
          label: "Maximum event age",
          order: 4,
          advanced: false,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "cost-sensitive",
        },
        {
          property: "deadLetterMode",
          control: "select",
          label: "After delivery fails",
          helpText:
            "Choose an explicitly connected SQS queue or keep no DLQ with a visible validation warning.",
          order: 5,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
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
        id: "aws.eventbridge.target.rule",
        displayName: "Owning rule",
        description: "Accepts matched events from one rule.",
        direction: "input",
        capability: "aws.eventbridge.target",
        category: "sends-messages-or-events",
        cardinality: "one",
        required: true,
      },
      {
        id: "aws.eventbridge.target.execution-role",
        displayName: "Execution role",
        description:
          "Accepts the one EventBridge service role required for a Step Functions target.",
        direction: "input",
        capability: "aws.eventbridge.target.execution-role",
        category: "network-and-security",
        cardinality: "one",
        required: false,
      },
      {
        id: "aws.eventbridge.target.lambda",
        displayName: "Lambda target",
        description: "Invokes one Lambda target.",
        direction: "output",
        capability: "aws.eventbridge.target.lambda",
        category: "receives-events-from",
        cardinality: "one",
        required: false,
      },
      {
        id: "aws.eventbridge.target.queue",
        displayName: "SQS target",
        description: "Sends the matched event to one SQS queue.",
        direction: "output",
        capability: "aws.eventbridge.target.sqs",
        category: "sends-messages-or-events",
        cardinality: "one",
        required: false,
      },
      {
        id: "aws.eventbridge.target.topic",
        displayName: "SNS target",
        description: "Publishes the matched event to one SNS topic.",
        direction: "output",
        capability: "aws.eventbridge.target.sns",
        category: "sends-messages-or-events",
        cardinality: "one",
        required: false,
      },
      {
        id: "aws.eventbridge.target.state-machine",
        displayName: "Step Functions target",
        description: "Starts one Step Functions state machine.",
        direction: "output",
        capability: "aws.eventbridge.target.step-functions",
        category: "invokes-another-workload",
        cardinality: "one",
        required: false,
      },
      {
        id: "aws.eventbridge.target.dead-letter-queue",
        displayName: "Dead-letter queue",
        description: "Sends exhausted delivery failures to one SQS queue.",
        direction: "output",
        capability: "aws.eventbridge.target.dead-letter-queue",
        category: "sends-messages-or-events",
        cardinality: "one",
        required: false,
      },
    ],
    education: {
      summary:
        "Delivers matched events to one target with bounded retries and an optional dead-letter queue.",
      guidedExplanation:
        "Choose one destination, how long the event remains useful, how many retries are reasonable, and whether exhausted failures need an SQS dead-letter queue. A Step Functions destination also needs one reviewed EventBridge execution role. The complete matched event is delivered without an inferred transformation.",
      professionalExplanation:
        "Models Lambda/SQS/SNS/Step Functions targets, matched-event input, retry policy, event age, optional SQS DLQ, conditional Step Functions execution-role association, and at-least-once semantics. Target-specific permissions remain exact graph policy effects.",
      considerations: [
        "Connections: Exactly one rule owns this configuration, one primary target is required, and an optional separate SQS DLQ handles exhausted delivery.",
        "Security: Target permissions must scope the exact destination; Step Functions uses an explicit events.amazonaws.com role trust, while Lambda, SNS, and SQS use reviewed resource policies in this slice.",
        "Cost: Retries and downstream target work can multiply cost; a DLQ adds requests and retention.",
        "Operations: Keep event age below the business usefulness window and alarm on DLQ depth and failed invocations.",
      ],
      documentation: eventBridgeDocumentation,
    },
    unsupportedCapabilities: [
      {
        id: "aws.eventbridge.target.unsupported.advanced-targets-input",
        title: "Advanced targets and input transformations",
        explanation:
          "API destinations, ECS, Batch, Kinesis, Redshift, AppSync, SageMaker, cross-account buses, input paths/transformers, and target-specific parameter blocks are rejected.",
      },
    ],
    mappings: eventMetadataMappings({
      mappingIdPrefix: "aws.eventbridge.target",
      terraformResourceType: "aws_cloudwatch_event_target",
      cloudFormationTypeName: "AWS::Events::Rule",
      terraformConfigurationBindings: [
        { configurationKey: "targetName", targetName: "target_id" },
        { configurationKey: "targetType", targetName: "target_kind" },
        { configurationKey: "inputMode", targetName: "input_mode" },
        {
          configurationKey: "maximumRetryAttempts",
          targetName: "retry_policy.maximum_retry_attempts",
        },
        {
          configurationKey: "maximumEventAgeSeconds",
          targetName: "retry_policy.maximum_event_age_in_seconds",
        },
        {
          configurationKey: "deadLetterMode",
          targetName: "dead_letter_config",
        },
      ],
      cloudFormationConfigurationBindings: [
        { configurationKey: "targetName", targetName: "Targets.Id" },
        { configurationKey: "targetType", targetName: "Targets.TargetKind" },
        { configurationKey: "inputMode", targetName: "Targets.InputMode" },
        {
          configurationKey: "maximumRetryAttempts",
          targetName: "Targets.RetryPolicy.MaximumRetryAttempts",
        },
        {
          configurationKey: "maximumEventAgeSeconds",
          targetName: "Targets.RetryPolicy.MaximumEventAgeInSeconds",
        },
        {
          configurationKey: "deadLetterMode",
          targetName: "Targets.DeadLetterConfig",
        },
      ],
      semanticConfigurationKeys: ["deliverySemantics"],
      terraformPortBindings: [
        { portId: "aws.eventbridge.target.rule", targetAttribute: "rule" },
        {
          portId: "aws.eventbridge.target.execution-role",
          targetAttribute: "role_arn",
        },
        { portId: "aws.eventbridge.target.lambda", targetAttribute: "arn" },
        { portId: "aws.eventbridge.target.queue", targetAttribute: "arn" },
        { portId: "aws.eventbridge.target.topic", targetAttribute: "arn" },
        {
          portId: "aws.eventbridge.target.state-machine",
          targetAttribute: "arn",
        },
        {
          portId: "aws.eventbridge.target.dead-letter-queue",
          targetAttribute: "dead_letter_config.arn",
        },
      ],
      cloudFormationPortBindings: [
        { portId: "aws.eventbridge.target.rule", targetAttribute: "RuleName" },
        {
          portId: "aws.eventbridge.target.execution-role",
          targetAttribute: "Targets.RoleArn",
        },
        {
          portId: "aws.eventbridge.target.lambda",
          targetAttribute: "Targets.Arn",
        },
        {
          portId: "aws.eventbridge.target.queue",
          targetAttribute: "Targets.Arn",
        },
        {
          portId: "aws.eventbridge.target.topic",
          targetAttribute: "Targets.Arn",
        },
        {
          portId: "aws.eventbridge.target.state-machine",
          targetAttribute: "Targets.Arn",
        },
        {
          portId: "aws.eventbridge.target.dead-letter-queue",
          targetAttribute: "Targets.DeadLetterConfig.Arn",
        },
      ],
      terraformProjection: {
        kind: "owned-resource",
        rendererContractId: "aws.eventbridge.target.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      cloudFormationProjection: {
        kind: "owner-nested-block",
        rendererContractId: "aws.eventbridge.rule.targets.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
    }),
  }),
);
