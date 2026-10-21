import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

import {
  eventDrivenRegionAvailability,
  eventDrivenValidationRuleIds,
  eventMetadataMappings,
} from "./event-driven-helpers.js";

export const stepFunctionsStateMachine0_11_0 = defineProviderServiceV1({
  id: "aws.stepfunctions.state-machine",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "Step Functions state machine",
  description:
    "A Standard workflow assembled only from reviewed catalog operations and explicit task connections.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.stepfunctions.state-machine",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.step-functions",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.stepfunctions.state-machine.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.stepfunctions.state-machine.configuration:1.0.0",
      type: "object",
      title: "Step Functions state machine configuration",
      description:
        "A bounded Standard workflow with catalog-derived definition, timeout, tracing, logging, encryption, and lifecycle intent.",
      additionalProperties: false,
      properties: {
        stateMachineName: {
          type: "string",
          default: "application-workflow",
          minLength: 1,
          maxLength: 80,
          pattern: "^[A-Za-z0-9_-]+$",
        },
        workflowType: {
          type: "string",
          enum: ["STANDARD"],
          default: "STANDARD",
        },
        definitionMode: {
          type: "string",
          enum: ["CATALOG_OPERATIONS"],
          default: "CATALOG_OPERATIONS",
        },
        executionTimeoutSeconds: {
          type: "integer",
          enum: [60, 300, 900, 3600],
          default: 300,
        },
        tracingEnabled: { type: "boolean", default: true },
        loggingMode: {
          type: "string",
          enum: ["ERRORS_WITHOUT_EXECUTION_DATA"],
          default: "ERRORS_WITHOUT_EXECUTION_DATA",
        },
        encryption: {
          type: "string",
          enum: ["AWS_OWNED_KEY"],
          default: "AWS_OWNED_KEY",
        },
        deletionProtectionEnabled: {
          type: "boolean",
          const: true,
          default: true,
        },
      },
      required: [
        "stateMachineName",
        "workflowType",
        "definitionMode",
        "executionTimeoutSeconds",
        "tracingEnabled",
        "loggingMode",
        "encryption",
        "deletionProtectionEnabled",
      ],
    },
    uiHints: [
      {
        property: "stateMachineName",
        control: "text",
        label: "Workflow name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "workflowType",
        control: "select",
        label: "Workflow type",
        helpText:
          "Standard workflows are the only reviewed mode in this slice; Express has different history and delivery tradeoffs.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "definitionMode",
        control: "select",
        label: "Workflow definition",
        helpText:
          "A future renderer may derive the definition only from reviewed catalog operations; raw ASL is not accepted.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "executionTimeoutSeconds",
        control: "number",
        label: "Execution timeout",
        helpText:
          "Keep this longer than the sum of reviewed task timeout and retry windows.",
        order: 3,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "tracingEnabled",
        control: "checkbox",
        label: "Enable tracing",
        order: 4,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "loggingMode",
        control: "select",
        label: "Execution logging",
        helpText:
          "Log errors without execution payload data to reduce sensitive-data exposure.",
        order: 5,
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
          "Uses AWS-owned encryption; custom KMS keys require explicit key policies.",
        order: 6,
        advanced: true,
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
      id: "aws.stepfunctions.state-machine.start-execution",
      displayName: "Start execution",
      description: "Accepts reviewed workflow-start requests or events.",
      direction: "input",
      capability: "aws.stepfunctions.execution.start",
      category: "invokes-another-workload",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.stepfunctions.state-machine.lambda-task",
      displayName: "Lambda tasks",
      description:
        "Invokes connected Lambda tasks through reviewed operations.",
      direction: "output",
      capability: "aws.stepfunctions.task.lambda",
      category: "receives-events-from",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.stepfunctions.state-machine.execution-role",
      displayName: "Execution role",
      description: "Accepts the IAM role assumed by Step Functions.",
      direction: "input",
      capability: "aws.stepfunctions.execution-role",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.stepfunctions.state-machine.policy-resource",
      displayName: "Policy resource",
      description:
        "Provides this state-machine ARN to typed IAM policy statements.",
      direction: "input",
      capability: "aws.iam.policy.step-functions-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [...eventDrivenValidationRuleIds],
  education: {
    summary:
      "Coordinates reviewed long-running steps with visible timeout and failure boundaries.",
    guidedExplanation:
      "Use a state machine when several steps need explicit order, retry, or failure handling. This slice supports Standard workflows and reviewed Lambda task connections only. It never asks you to paste workflow JSON.",
    professionalExplanation:
      "Models a Standard state machine whose future ASL definition must be deterministically derived from catalog-approved operations. Exact execution-role and Lambda-task edges carry IAM requirements; raw ASL, Express, Maps, callbacks, activities, and service integrations are excluded.",
    considerations: [
      "Connections: Add one execution role, explicit starters, and reviewed Lambda task operations; each task retains its own timeout/retry questions.",
      "Security: Scope states:StartExecution and lambda:InvokeFunction to exact graph resources and keep payloads out of ordinary logs.",
      "Cost: Standard workflow state transitions, retries, duration of activities, logging, and tracing can add charges.",
      "Operations: Bound execution and task timeouts, make retryable tasks idempotent, and monitor failed or timed-out executions.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.stepfunctions.documentation.state-machines",
        title: "AWS Step Functions state machines",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.stepfunctions.unsupported.raw-asl-express",
      title: "Raw ASL and Express workflows",
      explanation:
        "Raw Amazon States Language, Express workflows, versions, aliases, publish, and imported definitions are rejected.",
    },
    {
      id: "aws.stepfunctions.unsupported.advanced-states",
      title: "Advanced states and integrations",
      explanation:
        "Map/Distributed Map, Parallel, callback task tokens, activities, nested workflows, direct AWS SDK integrations, JSONata, and custom payload templates require later operation contracts.",
    },
    {
      id: "aws.stepfunctions.unsupported.custom-kms-execution-data",
      title: "Custom encryption and execution-data logging",
      explanation:
        "Customer-managed KMS keys and logging full execution data remain unsupported to avoid unreviewed key policies and sensitive payload retention.",
    },
  ],
  mappings: eventMetadataMappings({
    mappingIdPrefix: "aws.stepfunctions.state-machine",
    terraformResourceType: "aws_sfn_state_machine",
    cloudFormationTypeName: "AWS::StepFunctions::StateMachine",
    terraformConfigurationBindings: [
      { configurationKey: "stateMachineName", targetName: "name" },
      { configurationKey: "workflowType", targetName: "type" },
      {
        configurationKey: "tracingEnabled",
        targetName: "tracing_configuration.enabled",
      },
      { configurationKey: "loggingMode", targetName: "logging_configuration" },
      {
        configurationKey: "encryption",
        targetName: "encryption_configuration.type",
      },
    ],
    cloudFormationConfigurationBindings: [
      { configurationKey: "stateMachineName", targetName: "StateMachineName" },
      { configurationKey: "workflowType", targetName: "StateMachineType" },
      {
        configurationKey: "tracingEnabled",
        targetName: "TracingConfiguration.Enabled",
      },
      { configurationKey: "loggingMode", targetName: "LoggingConfiguration" },
      {
        configurationKey: "encryption",
        targetName: "EncryptionConfiguration.Type",
      },
    ],
    semanticConfigurationKeys: [
      "definitionMode",
      "executionTimeoutSeconds",
      "deletionProtectionEnabled",
    ],
    terraformPortBindings: [
      {
        portId: "aws.stepfunctions.state-machine.start-execution",
        targetAttribute: "arn",
      },
      {
        portId: "aws.stepfunctions.state-machine.lambda-task",
        targetAttribute: "definition",
      },
      {
        portId: "aws.stepfunctions.state-machine.execution-role",
        targetAttribute: "role_arn",
      },
      {
        portId: "aws.stepfunctions.state-machine.policy-resource",
        targetAttribute: "arn",
      },
    ],
    cloudFormationPortBindings: [
      {
        portId: "aws.stepfunctions.state-machine.start-execution",
        targetAttribute: "Arn",
      },
      {
        portId: "aws.stepfunctions.state-machine.lambda-task",
        targetAttribute: "Definition",
      },
      {
        portId: "aws.stepfunctions.state-machine.execution-role",
        targetAttribute: "RoleArn",
      },
      {
        portId: "aws.stepfunctions.state-machine.policy-resource",
        targetAttribute: "Arn",
      },
    ],
    terraformProjection: {
      kind: "relationship-resource",
      rendererContractId: "aws.stepfunctions.state-machine.catalog-operations",
      rendererContractVersion: "1.0.0",
      generatedResourceTypes: [],
    },
    cloudFormationProjection: {
      kind: "relationship-resource",
      rendererContractId: "aws.stepfunctions.state-machine.catalog-operations",
      rendererContractVersion: "1.0.0",
      generatedResourceTypes: [],
    },
  }),
  regionAvailability: eventDrivenRegionAvailability,
});

export const stepFunctionsStateMachine = defineProviderServiceV1({
  ...stepFunctionsStateMachine0_11_0,
  definitionVersion: "1.1.0",
  description:
    "A Standard workflow deterministically assembled from reviewed Lambda task edges with a compiler-owned protected error log group.",
  mappings: stepFunctionsStateMachine0_11_0.mappings.map((mapping) =>
    mapping.target === "terraform"
      ? {
          ...mapping,
          projection: {
            kind: "relationship-resource",
            rendererContractId:
              "aws.stepfunctions.state-machine.catalog-operations",
            rendererContractVersion: "1.0.0",
            generatedResourceTypes: ["aws_cloudwatch_log_group"],
          },
        }
      : mapping,
  ),
});
