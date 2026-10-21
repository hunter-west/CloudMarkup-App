import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const cloudWatchLogGroup = defineProviderServiceV1({
  id: "aws.cloudwatch.log-group",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "CloudWatch log group",
  description:
    "A retained CloudWatch Logs group for structured notes Lambda logs.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.cloudwatch.log-group",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.cloudwatch-logs",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.cloudwatch.log-group.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.cloudwatch.log-group.configuration:1.0.0",
      type: "object",
      title: "CloudWatch log group configuration",
      description:
        "A bounded retention and lifecycle policy for Lambda application logs.",
      additionalProperties: false,
      properties: {
        logGroupName: {
          type: "string",
          default: "/aws/lambda/notes-api-handler",
          minLength: 1,
          maxLength: 512,
          pattern: "^(?!aws/)[A-Za-z0-9_./#-]+$",
        },
        retentionDays: {
          type: "integer",
          enum: [7, 14, 30, 60, 90],
          default: 30,
        },
        logClass: {
          type: "string",
          enum: ["STANDARD"],
          default: "STANDARD",
        },
        preventDestroy: {
          type: "boolean",
          const: true,
          default: true,
        },
      },
      required: ["logGroupName", "retentionDays", "logClass", "preventDestroy"],
    },
    uiHints: [
      {
        property: "logGroupName",
        control: "text",
        label: "Log group name",
        helpText:
          "Must not start with aws/. The standard /aws/lambda/ prefix is allowed.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "retentionDays",
        control: "number",
        label: "Retention (days)",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "logClass",
        control: "select",
        label: "Log class",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "preventDestroy",
        control: "checkbox",
        label: "Prevent accidental destruction",
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
      id: "aws.cloudwatch.log-group.logs",
      displayName: "Log ingestion",
      description: "Accepts logs from the notes Lambda function.",
      direction: "input",
      capability: "aws.lambda.logs",
      category: "observability",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.cloudwatch.log-group.policy-resource",
      displayName: "Policy resource scope",
      description:
        "Accepts exact IAM statement scope edges targeting this log group.",
      direction: "input",
      capability: "aws.iam.policy.log-group-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.log-retention",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Retains structured Lambda logs for operations, investigation, and audit review.",
    guidedExplanation:
      "The connected Lambda writes diagnostic events here. Retention controls how long those events remain available, while prevent-destroy protects the history from accidental infrastructure removal.",
    professionalExplanation:
      "Models a STANDARD CloudWatch Logs group with a bounded 7-to-90-day retention choice and required Terraform prevent-destroy lifecycle posture. Log payloads, resource policies, subscriptions, data protection, field indexes, and KMS selection are excluded.",
    considerations: [
      "Connections: Associate one Lambda log output with this group and scope any log-writing policy through the exact graph resource.",
      "Security: Log only necessary metadata; tokens, secrets, credentials, and note contents must never enter application logs.",
      "Cost: Ingestion, retained storage, and analysis can incur charges; longer retention preserves more evidence and costs more.",
      "Operations: Choose retention from recovery, audit, and incident-response needs, then test that expected structured events are emitted.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.cloudwatch.documentation.log-group",
        title: "Working with log groups and log streams",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.cloudwatch.unsupported.log-subscriptions-resource-policy",
      title: "Subscriptions and resource policies",
      explanation:
        "Subscription filters, destinations, resource policies, data protection, and field indexes need separate semantics.",
    },
    {
      id: "aws.cloudwatch.unsupported.log-cmk",
      title: "Customer-managed encryption keys",
      explanation:
        "KMS key selection and policy management are not exposed in this slice.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.cloudwatch.log-group.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_cloudwatch_log_group",
      configurationBindings: [
        { configurationKey: "logGroupName", targetName: "name" },
        { configurationKey: "retentionDays", targetName: "retention_in_days" },
        { configurationKey: "logClass", targetName: "log_group_class" },
        {
          configurationKey: "preventDestroy",
          targetName: "lifecycle.prevent_destroy",
        },
      ],
      portBindings: [
        {
          portId: "aws.cloudwatch.log-group.logs",
          targetAttribute: "name",
        },
      ],
    },
    {
      mappingId: "aws.cloudwatch.log-group.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::Logs::LogGroup",
      configurationBindings: [
        { configurationKey: "logGroupName", targetName: "LogGroupName" },
        { configurationKey: "retentionDays", targetName: "RetentionInDays" },
        { configurationKey: "logClass", targetName: "LogGroupClass" },
      ],
      portBindings: [],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound AWS regional availability dataset is bundled with this catalog.",
  },
});
