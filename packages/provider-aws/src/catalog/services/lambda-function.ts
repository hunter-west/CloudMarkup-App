import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const lambdaFunction0_8_0 = defineProviderServiceV1({
  id: "aws.lambda.function",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "Lambda function",
  description:
    "A bounded Lambda function for authenticated notes API request handling.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.lambda.function",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.lambda",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.lambda.function.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.lambda.function.configuration:1.0.0",
      type: "object",
      title: "Lambda function configuration",
      description:
        "Safe runtime and capacity settings for the notes API handler.",
      additionalProperties: false,
      properties: {
        functionName: {
          type: "string",
          default: "notes-api-handler",
          minLength: 1,
          maxLength: 64,
          pattern: "^[A-Za-z0-9_-]+$",
        },
        runtime: {
          type: "string",
          enum: ["nodejs24.x"],
          default: "nodejs24.x",
        },
        architecture: {
          type: "string",
          enum: ["arm64", "x86_64"],
          default: "arm64",
        },
        handler: {
          type: "string",
          default: "index.handler",
          minLength: 3,
          maxLength: 128,
          pattern: "^[A-Za-z0-9_./-]+\\.[A-Za-z0-9_]+$",
        },
        timeoutSeconds: {
          type: "integer",
          default: 10,
          minimum: 1,
          maximum: 30,
        },
        memoryMegabytes: {
          type: "integer",
          enum: [128, 256, 512, 1024],
          default: 256,
        },
        tracingEnabled: { type: "boolean", default: true },
        reservedConcurrency: {
          type: "integer",
          default: 10,
          minimum: 1,
          maximum: 100,
        },
      },
      required: [
        "functionName",
        "runtime",
        "architecture",
        "handler",
        "timeoutSeconds",
        "memoryMegabytes",
        "tracingEnabled",
        "reservedConcurrency",
      ],
    },
    uiHints: [
      {
        property: "functionName",
        control: "text",
        label: "Function name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "runtime",
        control: "select",
        label: "Runtime",
        helpText: "The first notes API slice is pinned to Node.js 24.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "architecture",
        control: "select",
        label: "Architecture",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "handler",
        control: "text",
        label: "Handler",
        order: 3,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "timeoutSeconds",
        control: "number",
        label: "Timeout (seconds)",
        order: 4,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "memoryMegabytes",
        control: "number",
        label: "Memory (MB)",
        order: 5,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "tracingEnabled",
        control: "checkbox",
        label: "Enable active tracing",
        order: 6,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "reservedConcurrency",
        control: "number",
        label: "Reserved concurrency",
        helpText:
          "Bounds notes API concurrency to reduce runaway cost and downstream pressure.",
        order: 7,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.lambda.function.synchronous-invocation",
      displayName: "Synchronous invocation",
      description: "Accepts request-response invocation from a caller.",
      direction: "input",
      capability: "aws.lambda.invocation.synchronous",
      category: "receives-events-from",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.asynchronous-invocation",
      displayName: "Asynchronous invocation",
      description: "Accepts asynchronous event invocation from a caller.",
      direction: "input",
      capability: "aws.lambda.invocation.asynchronous",
      category: "receives-events-from",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.event-source",
      displayName: "Event source",
      description: "Accepts records through an event-source mapping.",
      direction: "input",
      capability: "aws.lambda.invocation.event-source",
      category: "receives-events-from",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.schedule",
      displayName: "Schedule",
      description: "Accepts scheduled invocation events.",
      direction: "input",
      capability: "aws.lambda.invocation.schedule",
      category: "receives-events-from",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.execution-role",
      displayName: "Execution role",
      description: "Accepts the IAM role assumed by the Lambda service.",
      direction: "input",
      capability: "aws.lambda.execution-role",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.lambda.function.invocation-permission",
      displayName: "Invocation permission",
      description:
        "Accepts service-specific invocation grants owned by this function.",
      direction: "input",
      capability: "aws.lambda.invocation.permission",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.policy-resource",
      displayName: "Policy resource scope",
      description:
        "Accepts exact IAM statement scope edges targeting this function.",
      direction: "input",
      capability: "aws.iam.policy.lambda-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.vpc-access",
      displayName: "VPC access",
      description: "Associates the function with reviewed network placement.",
      direction: "input",
      capability: "aws.lambda.vpc-access",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.lambda.function.data-read",
      displayName: "Data read",
      description: "Requests bounded read access to a connected data store.",
      direction: "output",
      capability: "aws.lambda.data.read",
      category: "reads-or-writes-data",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.data-write",
      displayName: "Data write",
      description: "Requests bounded write access to a connected data store.",
      direction: "output",
      capability: "aws.lambda.data.write",
      category: "reads-or-writes-data",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.object-access",
      displayName: "Object access",
      description: "Requests bounded access to connected object storage.",
      direction: "output",
      capability: "aws.lambda.object.access",
      category: "reads-or-writes-data",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.message-send",
      displayName: "Message send",
      description: "Sends messages to a connected messaging destination.",
      direction: "output",
      capability: "aws.lambda.message.send",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.event-publish",
      displayName: "Event publish",
      description: "Publishes events to a connected event destination.",
      direction: "output",
      capability: "aws.lambda.event.publish",
      category: "sends-messages-or-events",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.workload-invocation",
      displayName: "Workload invocation",
      description: "Invokes another connected workload.",
      direction: "output",
      capability: "aws.lambda.workload.invoke",
      category: "invokes-another-workload",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.configuration-read",
      displayName: "Configuration read",
      description:
        "Reads secrets or configuration through a reviewed connection.",
      direction: "output",
      capability: "aws.lambda.configuration.read",
      category: "uses-secrets-or-configuration",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.telemetry",
      displayName: "Telemetry",
      description: "Exposes function telemetry to connected observers.",
      direction: "output",
      capability: "aws.lambda.telemetry",
      category: "observability",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.lambda.function.dead-letter-destination",
      displayName: "Dead-letter destination",
      description: "Associates one destination for failed asynchronous events.",
      direction: "output",
      capability: "aws.lambda.dead-letter-destination",
      category: "sends-messages-or-events",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.lambda.function.logging",
      displayName: "Logging",
      description: "Associates the function with its log destination.",
      direction: "output",
      capability: "aws.lambda.logging",
      category: "observability",
      cardinality: "one",
      required: true,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.api-route-authentication",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.connection-questions",
    "aws.cloudmarkup.validation.lambda-dynamodb-actions",
    "aws.cloudmarkup.validation.lambda-execution-role",
    "aws.cloudmarkup.validation.lambda-runtime-bounds",
    "aws.cloudmarkup.validation.lambda-trigger-compatibility",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Runs a bounded application workload in response to reviewed triggers.",
    guidedExplanation:
      "A function is the compute step, not the application description. Its Workload Behavior defines operations, inputs, outputs, triggers, and downstream actions; reviewed connections then supply its execution role, callers, data access, and logs.",
    professionalExplanation:
      "Models a zip-based Node.js 24 Lambda with bounded architecture, handler, timeout, memory, tracing, and reserved concurrency. The catalog exposes typed capability ports, but only endpoints with a reviewed connection rule in this exact version are resolvable or compilable.",
    considerations: [
      "Connections: A function requires one execution role and one log destination; callers and downstream access must use reviewed typed relationships.",
      "Security: Validate every input, return only the declared output, keep secrets out of configuration, and scope IAM actions to connected resources.",
      "Cost: Invocations, duration, memory, architecture, tracing, and concurrency affect charges; tune them together rather than in isolation.",
      "Operations: Define the function purpose in Workload Behavior and keep handlers idempotent where retries or duplicate delivery are possible.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.function",
        title: "Configuring Lambda functions",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.lambda.unsupported.inline-secrets",
      title: "Inline secrets and raw environment variables",
      explanation:
        "This slice exposes no environment-value field; secret-bearing configuration must use explicit references in a later contract.",
    },
    {
      id: "aws.lambda.unsupported.container-layers",
      title: "Container images and layers",
      explanation:
        "Container packaging, layers, extensions, provisioned concurrency, and function URLs are outside this slice.",
    },
    {
      id: "aws.lambda.unsupported.unbound-capability-recipes",
      title: "Capability recipes not yet bound",
      explanation:
        "The generic asynchronous invocation, event-source, schedule, VPC, object, messaging, event, workload, configuration, and dead-letter ports have no connection rules in this catalog version and cannot yet be resolved.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.lambda.function.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_lambda_function",
      configurationBindings: [
        { configurationKey: "functionName", targetName: "function_name" },
        { configurationKey: "runtime", targetName: "runtime" },
        { configurationKey: "architecture", targetName: "architectures" },
        { configurationKey: "handler", targetName: "handler" },
        { configurationKey: "timeoutSeconds", targetName: "timeout" },
        { configurationKey: "memoryMegabytes", targetName: "memory_size" },
        {
          configurationKey: "tracingEnabled",
          targetName: "tracing_config.mode",
        },
        {
          configurationKey: "reservedConcurrency",
          targetName: "reserved_concurrent_executions",
        },
      ],
      portBindings: [
        {
          portId: "aws.lambda.function.execution-role",
          targetAttribute: "role",
        },
      ],
    },
    {
      mappingId: "aws.lambda.function.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::Lambda::Function",
      configurationBindings: [
        { configurationKey: "functionName", targetName: "FunctionName" },
        { configurationKey: "runtime", targetName: "Runtime" },
        { configurationKey: "architecture", targetName: "Architectures" },
        { configurationKey: "handler", targetName: "Handler" },
        { configurationKey: "timeoutSeconds", targetName: "Timeout" },
        { configurationKey: "memoryMegabytes", targetName: "MemorySize" },
        {
          configurationKey: "tracingEnabled",
          targetName: "TracingConfig.Mode",
        },
        {
          configurationKey: "reservedConcurrency",
          targetName: "ReservedConcurrentExecutions",
        },
      ],
      portBindings: [
        {
          portId: "aws.lambda.function.execution-role",
          targetAttribute: "Role",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound AWS regional runtime availability dataset is bundled with this catalog.",
  },
});

export const lambdaFunction0_10_0 = defineProviderServiceV1({
  ...lambdaFunction0_8_0,
  definitionVersion: "1.1.0",
  validationRuleIds: [
    ...lambdaFunction0_8_0.validationRuleIds,
    "aws.cloudmarkup.validation.lambda-vpc-access",
    "aws.cloudmarkup.validation.network-placement",
  ],
  education: {
    summary:
      "Runs a bounded application workload in response to reviewed triggers, with optional explicit VPC access configuration.",
    guidedExplanation:
      "A function stays an AWS-managed service even when it uses selected subnets and security groups. The separate VPC access configuration explains those associations, while Workload Behavior still defines what the function does. A public subnet does not give the function a public IP or automatic internet access.",
    professionalExplanation:
      "Models the existing zip-based Node.js 24 Lambda plus one optional graph-owned VPC access configuration. The Lambda remains outside VPC containment; exact subnet and security-group association edges preserve placement and policy identity. Terraform renders the reviewed owned configuration as a nested vpc_config block without changing application source semantics.",
    considerations: [
      "Connections: Use one owned VPC access configuration with one to sixteen subnets and one to five security groups; select multiple Availability Zones for resilient workloads.",
      "Security: Lambda VPC attachment requires reviewed ENI-management permissions on the execution role; this catalog does not silently add wildcard EC2 permissions.",
      "Cost: Internet-bound IPv4 traffic from VPC-attached functions can add NAT gateway, data-processing, and cross-Availability-Zone charges; prefer gateway endpoints for supported S3 or DynamoDB access.",
      "Operations: VPC attachment changes cold-start networking and reachability; keep Workload Behavior dependencies explicit and verify routing before treating the function as ready.",
    ],
    documentation: [
      ...lambdaFunction0_8_0.education.documentation,
      {
        kind: "official",
        id: "aws.lambda.documentation.vpc-access",
        title: "Connecting Lambda functions to a VPC",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html",
      },
    ],
  },
  unsupportedCapabilities: [
    ...lambdaFunction0_8_0.unsupportedCapabilities
      .filter(
        (capability) =>
          capability.id !== "aws.lambda.unsupported.unbound-capability-recipes",
      )
      .map((capability) => ({ ...capability })),
    {
      id: "aws.lambda.unsupported.unbound-capability-recipes",
      title: "Capability recipes not yet bound",
      explanation:
        "The generic asynchronous invocation, event-source, schedule, object, messaging, event, workload, configuration, and dead-letter ports still have no connection rules in this catalog version and cannot be resolved.",
    },
    {
      id: "aws.lambda.unsupported.vpc-containment",
      title: "Lambda service containment inside a VPC",
      explanation:
        "Lambda VPC access is an owned subnet and security-group association. The Lambda service is not parented inside a VPC or subnet, and selecting a public subnet does not assign a public IP.",
    },
    {
      id: "aws.lambda.unsupported.vpc-permission-generation",
      title: "Automatic Lambda VPC execution-role permissions",
      explanation:
        "The EC2 network-interface permissions required for VPC access are not silently generated because several require broad resource scope. They remain an explicit reviewed readiness issue.",
    },
  ],
});
export const lambdaFunction = defineProviderServiceV1({
  ...lambdaFunction0_10_0,
  definitionVersion: "1.2.0",
  validationRuleIds: [
    ...lambdaFunction0_10_0.validationRuleIds,
    "aws.cloudmarkup.validation.event-delivery",
    "aws.cloudmarkup.validation.event-topology",
  ],
  education: {
    ...lambdaFunction0_10_0.education,
    summary:
      "Runs reviewed request, event, message, and workflow operations with explicit producer and consumer relationships.",
    guidedExplanation:
      "A function can receive asynchronous S3, SNS, EventBridge, or SQS events and can send messages, publish events, start workflows, or invoke reviewed tasks. Every direction uses its own arrow and event contract; the service name never guesses the payload. Queue consumers must be idempotent because delivery can repeat.",
    professionalExplanation:
      "Extends the established zip-based Node.js 24 Lambda with exact S3/SNS/EventBridge asynchronous trigger, SQS event-source, SQS/SNS/EventBridge producer, Step Functions invocation, and reviewed DLQ relationships. Workload Behavior v2 owns operation/event-contract bindings; no application source or dispatcher is generated in this prompt.",
    considerations: [
      "Connections: Keep invoke, event-source, publish/send, workflow, and dead-letter ports distinct; bind each workload edge to one operation and event contract. For VPC resilience, choose subnets in multiple Availability Zones.",
      "Security: Execution-role and resource-based permissions must scope exact connected resources and service principals; generated previews never justify wildcard access.",
      "Cost: Batch size/window, retries, concurrency, duplicate processing, tracing, downstream delivery, and VPC routing all affect cost.",
      "Operations: Make handlers idempotent, use partial batch response for SQS, bound timeouts, and alarm on failures, queue age, and DLQ depth.",
    ],
  },
  unsupportedCapabilities: [
    ...lambdaFunction0_10_0.unsupportedCapabilities.filter(
      (capability) =>
        capability.id !== "aws.lambda.unsupported.unbound-capability-recipes",
    ),
    {
      id: "aws.lambda.unsupported.remaining-capability-recipes",
      title: "Remaining capability recipes not bound",
      explanation:
        "Schedule triggers, arbitrary configuration stores, stream sources, async destinations beyond the curated SQS DLQ, object read/write access, and unreviewed service integrations remain unavailable.",
    },
    {
      id: "aws.lambda.unsupported.event-dispatcher-generation",
      title: "Inferred event dispatchers and application rendering",
      explanation:
        "The catalog does not infer an event shape or generate a mixed-trigger dispatcher from provider connections. Workload operations and event-message contracts require explicit reviewed bindings, and application rendering remains a later prompt.",
    },
    {
      id: "aws.lambda.unsupported.advanced-sqs-event-source",
      title: "Advanced SQS polling modes",
      explanation:
        "Provisioned polling, cross-account queues, event-source KMS filters, scaling modes beyond bounded maximum concurrency, and arbitrary filter JSON are rejected.",
    },
  ],
});
