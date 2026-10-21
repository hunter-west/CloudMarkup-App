import {
  applyGraphCommand,
  getApplicationContractRecordContentHash,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws/connection-resolution";
import {
  applicationContractRecordV1Schema,
  regionIdentifierSchema,
  workloadV2Schema,
  type ApplicationContractRecordV1,
  type ConfigurationValue,
  type WorkloadV2,
} from "@cloudmarkup/schemas";

import { awsEditorCatalog } from "./aws-editor-catalog.js";

export type AwsEventTemplateId =
  | "image-upload-processing"
  | "scheduled-workflow"
  | "sns-fan-out-notification"
  | "queue-consumer-with-dlq";

const supportedTemplateIds = new Set<string>([
  "image-upload-processing",
  "scheduled-workflow",
  "sns-fan-out-notification",
  "queue-consumer-with-dlq",
]);
const eventApplicationContract = Object.freeze({
  generator: {
    id: "cloudmarkup.event-application-generator",
    version: "1.0.0",
  },
  template: {
    id: "cloudmarkup.template.aws-lambda-curated-events-typescript",
    version: "1.0.0",
  },
  pattern: {
    patternId: "cloudmarkup.pattern.aws-lambda-curated-event-driven",
    patternVersion: "1.0.0",
    digest:
      "sha256:b74c6d0c918d5dd3eac3485cb5004aece78e7dc9a9936f3ecbd85aa012a53686",
  },
  dispatcher: {
    id: "cloudmarkup.event-trigger-dispatcher",
    version: "1.0.0",
  },
  runtimeFamily: "aws.lambda.runtime-family.nodejs24",
  languageFamily: "cloudmarkup.language.typescript",
  handler: "index.handler",
});

const fixtureTimestamp = "2026-08-27T00:00:00.000Z";

interface EventWorkloadSpecification {
  readonly key: string;
  readonly pattern:
    "s3-image-metadata" | "sqs-consumer-dlq" | "step-functions-task";
  readonly owningNodeId: string;
  readonly triggerEdgeId: string;
  readonly downstreamEdgeId?: string;
  readonly metadataNodeId?: string;
}

function applicationContractReference<
  TKind extends ApplicationContractRecordV1["contractKind"],
>(contract: Extract<ApplicationContractRecordV1, { contractKind: TKind }>) {
  return {
    contractKind: contract.contractKind,
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    digest: getApplicationContractRecordContentHash(contract),
  };
}

function workloadIoReference(contract: ApplicationContractRecordV1) {
  const reference = applicationContractReference(contract);
  return {
    contractId: reference.contractId,
    contractVersion: reference.contractVersion,
    digest: reference.digest,
  };
}

function eventCapability(
  pattern: EventWorkloadSpecification["pattern"],
): string {
  switch (pattern) {
    case "s3-image-metadata":
      return "cloudmarkup.event.s3-record-metadata";
    case "sqs-consumer-dlq":
      return "cloudmarkup.event.sqs-consume";
    case "step-functions-task":
      return "cloudmarkup.event.step-functions-task";
  }
}

function createEventWorkloadBundle(
  specification: EventWorkloadSpecification,
  sourceReferenceId: string,
): Readonly<{
  contracts: readonly ApplicationContractRecordV1[];
  workload: WorkloadV2;
}> {
  const namespace = `templates.${specification.key.replaceAll("_", "-")}`;
  const provenance = {
    source: "designed" as const,
    sourceReferenceIds: [sourceReferenceId],
    recordedAt: fixtureTimestamp,
    recordedBy: "actor_curated_template",
  };
  const payload = applicationContractRecordV1Schema.parse({
    contractKind: "data-entity",
    contractId: `contracts.${namespace}.payload`,
    contractVersion: "1.0.0",
    displayName:
      specification.pattern === "s3-image-metadata"
        ? "S3 object metadata"
        : "Curated event payload",
    provenance,
    semanticName: `application.${namespace}.payload`,
    storageIntent:
      specification.pattern === "s3-image-metadata"
        ? "persistent"
        : "transient",
    fields:
      specification.pattern === "s3-image-metadata"
        ? [
            ["bucket", "string", true],
            ["key", "string", true],
            ["eTag", "string", true],
            ["size", "integer", true],
            ["versionId", "string", true],
            ["sequencer", "string", true],
          ].map(([name, scalarType, required]) => ({
            name,
            fieldType: { kind: "scalar", scalarType },
            required,
            nullable: false,
            classification: "internal",
          }))
        : [
            {
              name: "eventId",
              fieldType: { kind: "scalar", scalarType: "string" },
              required: true,
              nullable: false,
              classification: "internal",
            },
            {
              name: "correlationId",
              fieldType: { kind: "scalar", scalarType: "string" },
              required: false,
              nullable: false,
              classification: "internal",
            },
          ],
    indexes: [
      {
        indexId: `index_${specification.key}_primary`,
        name: "primary",
        kind: "primary",
        partitionFields: [
          specification.pattern === "s3-image-metadata" ? "key" : "eventId",
        ],
        sortFields: [],
      },
    ],
    supportedOperations:
      specification.pattern === "s3-image-metadata"
        ? ["create", "consume"]
        : ["consume"],
  });
  if (payload.contractKind !== "data-entity") {
    throw new TypeError("Event template payload contract kind is invalid.");
  }
  const payloadReference = applicationContractReference(payload);
  const eventContract = applicationContractRecordV1Schema.parse({
    contractKind: "event-message",
    contractId: `contracts.${namespace}.event`,
    contractVersion: "1.0.0",
    displayName: "Curated event envelope",
    provenance,
    transportKind:
      specification.pattern === "sqs-consumer-dlq" ? "message" : "event",
    semanticName: `application.${namespace}.event`,
    payload: payloadReference,
    headers: [],
    delivery: {
      ordering: "not-guaranteed",
      duplicates: "possible",
      delivery: "at-least-once",
    },
  });
  if (eventContract.contractKind !== "event-message") {
    throw new TypeError("Event template envelope contract kind is invalid.");
  }
  const eventReference = applicationContractReference(eventContract);
  const behavior = applicationContractRecordV1Schema.parse({
    contractKind: "behavior-operation",
    contractId: `contracts.${namespace}.behavior`,
    contractVersion: "1.0.0",
    displayName: "Curated event behavior",
    provenance,
    capability: eventCapability(specification.pattern),
    input: { kind: "contract-reference", reference: eventReference },
    output:
      specification.pattern === "step-functions-task"
        ? { kind: "contract-reference", reference: payloadReference }
        : { kind: "none" },
    failureOutcomes: [
      {
        category: "application.validation",
        retryable: false,
        description: "The typed event contract was not satisfied.",
      },
    ],
  });
  if (behavior.contractKind !== "behavior-operation") {
    throw new TypeError("Event template behavior contract kind is invalid.");
  }
  const behaviorReference = applicationContractReference(behavior);
  const tests = (["unit", "contract"] as const).map((level) => {
    const test = applicationContractRecordV1Schema.parse({
      contractKind: "test-case",
      contractId: `contracts.${namespace}.test.${level}`,
      contractVersion: "1.0.0",
      displayName: `${level} event contract test`,
      provenance,
      level,
      target: behaviorReference,
      preconditions: [
        {
          kind: "contract-available",
          contract: level === "unit" ? payloadReference : eventReference,
        },
      ],
      fixtureReferences: [],
      expectations:
        level === "unit"
          ? [
              {
                expectationId: `expect_${level}_${specification.key}_conformance`,
                kind: "contract-conformance",
                contract: payloadReference,
              },
            ]
          : [
              {
                expectationId: `expect_${level}_${specification.key}_validation`,
                kind: "error-category",
                category: "application.validation",
              },
            ],
    });
    if (test.contractKind !== "test-case") {
      throw new TypeError("Event template test contract kind is invalid.");
    }
    return test;
  });
  const operationId = `operation_${specification.key}`;
  const extensionPath = `application/src/functions/${specification.key}/extensions/custom.ts`;
  const workload = workloadV2Schema.parse({
    id: `workload_${specification.key}`,
    owningNodeId: specification.owningNodeId,
    implementation: {
      mode: "complete-supported-pattern",
      runtimeFamily: eventApplicationContract.runtimeFamily,
      handler: eventApplicationContract.handler,
      sourceOwnership: "cloudmarkup",
      supportedPattern: eventApplicationContract.pattern,
    },
    operations: [
      {
        id: operationId,
        capability: eventCapability(specification.pattern),
        inputContract: {
          kind: "contract-reference",
          reference: workloadIoReference(eventContract),
        },
        outputContract:
          specification.pattern === "step-functions-task"
            ? {
                kind: "contract-reference",
                reference: workloadIoReference(payload),
              }
            : { kind: "none" },
      },
    ],
    behaviorContracts: [behaviorReference],
    triggers: [
      {
        id: `trigger_${specification.key}`,
        edgeId: specification.triggerEdgeId,
        targetOperationId: operationId,
      },
    ],
    downstreamActions:
      specification.downstreamEdgeId === undefined
        ? []
        : [
            {
              id: `action_${specification.key}_metadata`,
              edgeId: specification.downstreamEdgeId,
              sourceOperationId: operationId,
            },
          ],
    environment:
      specification.metadataNodeId === undefined
        ? []
        : [
            {
              id: `environment_${specification.key}_metadata`,
              name: "METADATA_TABLE_NAME",
              value: {
                kind: "node-attribute-reference",
                nodeId: specification.metadataNodeId,
                attribute: "aws.dynamodb.table.name",
              },
            },
          ],
    errorBehavior: {
      mode:
        specification.pattern === "sqs-consumer-dlq"
          ? "continue"
          : "fail-invocation",
    },
    executionAssumptions: {
      timeout: { kind: "duration", milliseconds: 30_000 },
      retry: { kind: "bounded", maximumAttempts: 5 },
    },
    triggerDispatch: {
      mode: "generated-supported",
      dispatcherId: eventApplicationContract.dispatcher.id,
      dispatcherVersion: eventApplicationContract.dispatcher.version,
      dispatcherOperationId: operationId,
    },
    unresolvedRequirementIds: [],
    languageFamily: eventApplicationContract.languageFamily,
    entrypoints: [
      {
        entrypointId: `entrypoint_${specification.key}`,
        kind:
          specification.pattern === "sqs-consumer-dlq"
            ? "message-handler"
            : specification.pattern === "step-functions-task"
              ? "background-worker"
              : "event-handler",
        operationId,
        handler: eventApplicationContract.handler,
      },
    ],
    httpRoutes: [],
    eventBindings: [
      {
        bindingId: `event_${specification.key}`,
        direction: "inbound",
        transportKind:
          specification.pattern === "sqs-consumer-dlq" ? "message" : "event",
        operationId,
        edgeId: specification.triggerEdgeId,
        contract: eventReference,
      },
    ],
    schedules: [],
    dataBindings:
      specification.downstreamEdgeId === undefined
        ? []
        : [
            {
              bindingId: `data_${specification.key}_metadata`,
              operationId,
              entity: payloadReference,
              dataOperation: "create",
              edgeId: specification.downstreamEdgeId,
            },
          ],
    authorization: [],
    idempotency: [
      {
        policyId: `idempotency_${specification.key}`,
        mode: "not-required",
        operationIds: [operationId],
      },
    ],
    observability: { signals: ["logs"], healthChecks: [], smokeTests: [] },
    tests: tests.map((test) => ({
      bindingId: `test_${test.level}_${specification.key}`,
      level: test.level,
      testCase: applicationContractReference(test),
      requiredForCoverage: true,
    })),
    sourceOwnership: [
      {
        declarationId: `ownership_${specification.key}_extension`,
        path: extensionPath,
        pathKind: "file",
        ownership: "user-owned",
        ownerId: `application.${namespace}.owner`,
        regeneration: "never",
        conflictBehavior: "preserve-user-content",
        semanticDiff: { strategy: "structured-language" },
      },
    ],
    extensionPoints: [
      {
        extensionPointId: `application.${namespace}.extensions`,
        path: extensionPath,
        kind: "module",
        permittedOwnership: ["user-owned", "approved-extension"],
        conflictBehavior: "require-reviewed-resolution",
      },
    ],
    extensions: [],
    implementationRequirements: [],
    compatibility: {
      applicationGenerators: [
        {
          generatorId: eventApplicationContract.generator.id,
          minimumVersion: eventApplicationContract.generator.version,
          templateId: eventApplicationContract.template.id,
          templateVersion: eventApplicationContract.template.version,
          supportedModes: ["generated-starter", "complete-supported-pattern"],
        },
      ],
      modelGateways: [],
    },
    provenance: {
      source: "manual",
      recordedAt: fixtureTimestamp,
      recordedBy: "actor_curated_template",
    },
  });

  return {
    contracts: [payload, eventContract, behavior, ...tests],
    workload,
  };
}

export function isAwsEventTemplateId(
  value: string,
): value is AwsEventTemplateId {
  return supportedTemplateIds.has(value);
}

function serviceNode(
  id: string,
  deploymentKey: string,
  label: string,
  serviceType: string,
  position: Readonly<{ x: number; y: number }>,
  overrides: Readonly<Record<string, Readonly<ConfigurationValue>>> = {},
) {
  const service = awsEditorCatalog.services.find(
    (candidate) => candidate.serviceType === serviceType,
  );
  if (service?.configuration.defaults.kind !== "ready") {
    throw new TypeError(
      `Event template requires defaultable service ${serviceType}.`,
    );
  }
  const values = {
    ...structuredClone(service.configuration.defaults.values),
    ...structuredClone(overrides),
  };
  const validation = service.configuration.validate(values);
  if (!validation.success) {
    throw new TypeError(
      `Event template configuration is invalid for ${serviceType}.`,
    );
  }
  return {
    id,
    semantic: {
      deploymentKey,
      serviceType,
      resourceType: service.resourceType,
      configuration: {
        schemaId: service.configuration.schemaId,
        schemaVersion: service.configuration.schemaVersion,
        values: structuredClone(validation.values),
      },
      lifecycle: { ownership: "user" as const, origin: "template" as const },
    },
    presentation: { label, position },
  };
}

function relationshipEdge(
  id: string,
  descriptorId: string,
  sourceNodeId: string,
  targetNodeId: string,
  overrides: Readonly<Record<string, Readonly<ConfigurationValue>>> = {},
) {
  const relationship = (awsEditorCatalog.relationships ?? []).find(
    (candidate) => candidate.descriptorId === descriptorId,
  );
  if (relationship?.configuration.defaults.kind !== "ready") {
    throw new TypeError(
      `Event template requires defaultable relationship ${descriptorId}.`,
    );
  }
  const values = {
    ...structuredClone(relationship.configuration.defaults.values),
    ...structuredClone(overrides),
  };
  const validation = relationship.configuration.validate(values);
  if (!validation.success) {
    throw new TypeError(
      `Event template relationship configuration is invalid for ${descriptorId}.`,
    );
  }
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: relationship.sourcePortId },
      target: { nodeId: targetNodeId, port: relationship.targetPortId },
      relationshipType: relationship.id,
      configuration: {
        schemaId: relationship.configuration.schemaId,
        schemaVersion: relationship.configuration.schemaVersion,
        values: structuredClone(validation.values),
      },
      lifecycle: { ownership: "user" as const, origin: "template" as const },
    },
  };
}

function lambdaConfiguration(
  functionName: string,
): Readonly<Record<string, Readonly<ConfigurationValue>>> {
  return {
    functionName: { kind: "string", value: functionName },
    timeoutSeconds: { kind: "integer", value: 30 },
  };
}

function roleConfiguration(
  roleName: string,
): Readonly<Record<string, Readonly<ConfigurationValue>>> {
  return { roleName: { kind: "string", value: roleName } };
}

function queueConfiguration(
  queueName: string,
): Readonly<Record<string, Readonly<ConfigurationValue>>> {
  return { queueName: { kind: "string", value: queueName } };
}

function logGroupConfiguration(
  logGroupName: string,
): Readonly<Record<string, Readonly<ConfigurationValue>>> {
  return {
    logGroupName: { kind: "string", value: logGroupName },
  };
}

function templateGraph(templateId: AwsEventTemplateId) {
  switch (templateId) {
    case "image-upload-processing":
      return {
        nodes: [
          serviceNode(
            "node_uploads",
            "uploads",
            "Image uploads",
            "aws.s3.bucket",
            { x: 80, y: 120 },
          ),
          serviceNode(
            "node_image_processor",
            "image_processor",
            "Image processor",
            "aws.lambda.function",
            { x: 440, y: 120 },
            lambdaConfiguration("image-processor"),
          ),
          serviceNode(
            "node_image_metadata",
            "image_metadata",
            "Image metadata",
            "aws.dynamodb.table",
            { x: 800, y: 120 },
            {
              tableName: { kind: "string", value: "image-metadata" },
              partitionKeyName: { kind: "string", value: "key" },
              partitionKeyType: { kind: "string", value: "S" },
            },
          ),
          serviceNode(
            "node_image_processor_role",
            "image_processor_role",
            "Image processor role",
            "aws.iam.role",
            { x: 440, y: 360 },
            roleConfiguration("image-processor-role"),
          ),
          serviceNode(
            "node_image_processor_logs",
            "image_processor_logs",
            "Image processor logs",
            "aws.cloudwatch.log-group",
            { x: 800, y: 360 },
            logGroupConfiguration("/aws/lambda/image-processor"),
          ),
        ],
        edges: [
          relationshipEdge(
            "edge_upload_notification",
            "aws.s3.bucket-notifies-lambda",
            "node_uploads",
            "node_image_processor",
          ),
          relationshipEdge(
            "edge_metadata_write",
            "aws.lambda.writes-dynamodb-table",
            "node_image_processor",
            "node_image_metadata",
          ),
          relationshipEdge(
            "edge_image_processor_role",
            "aws.iam.role-assumed-by-lambda",
            "node_image_processor_role",
            "node_image_processor",
          ),
          relationshipEdge(
            "edge_image_processor_logs",
            "aws.lambda.writes-log-group",
            "node_image_processor",
            "node_image_processor_logs",
          ),
        ],
      };
    case "scheduled-workflow":
      return {
        nodes: [
          serviceNode(
            "node_default_bus",
            "default_bus",
            "Default event bus",
            "aws.eventbridge.event-bus",
            { x: 80, y: 120 },
          ),
          serviceNode(
            "node_schedule",
            "scheduled_workflow",
            "Every five minutes",
            "aws.eventbridge.rule",
            { x: 360, y: 120 },
            {
              triggerMode: { kind: "string", value: "SCHEDULE" },
              scheduleExpression: { kind: "string", value: "RATE_5_MINUTES" },
            },
          ),
          serviceNode(
            "node_schedule_target",
            "workflow_target",
            "Workflow target",
            "aws.eventbridge.target",
            { x: 640, y: 120 },
            {
              targetType: { kind: "string", value: "STEP_FUNCTIONS" },
            },
          ),
          serviceNode(
            "node_workflow",
            "scheduled_state_machine",
            "Scheduled workflow",
            "aws.stepfunctions.state-machine",
            { x: 920, y: 120 },
          ),
          serviceNode(
            "node_event_role",
            "event_target_role",
            "Event target role",
            "aws.iam.role",
            { x: 640, y: 360 },
            roleConfiguration("scheduled-event-target-role"),
          ),
          serviceNode(
            "node_workflow_role",
            "workflow_role",
            "Workflow role",
            "aws.iam.role",
            { x: 920, y: 360 },
            roleConfiguration("scheduled-workflow-role"),
          ),
          serviceNode(
            "node_workflow_task",
            "scheduled_task",
            "Scheduled task",
            "aws.lambda.function",
            { x: 1200, y: 120 },
            lambdaConfiguration("scheduled-task"),
          ),
          serviceNode(
            "node_task_role",
            "scheduled_task_role",
            "Task role",
            "aws.iam.role",
            { x: 1200, y: 360 },
            roleConfiguration("scheduled-task-role"),
          ),
          serviceNode(
            "node_workflow_task_logs",
            "scheduled_task_logs",
            "Scheduled task logs",
            "aws.cloudwatch.log-group",
            { x: 1440, y: 120 },
            logGroupConfiguration("/aws/lambda/scheduled-task"),
          ),
        ],
        edges: [
          relationshipEdge(
            "edge_bus_rule",
            "aws.eventbridge.event-bus-associates-rule",
            "node_default_bus",
            "node_schedule",
          ),
          relationshipEdge(
            "edge_rule_target",
            "aws.eventbridge.rule-owns-target",
            "node_schedule",
            "node_schedule_target",
          ),
          relationshipEdge(
            "edge_target_workflow",
            "aws.eventbridge.target-starts-state-machine",
            "node_schedule_target",
            "node_workflow",
          ),
          relationshipEdge(
            "edge_event_role",
            "aws.iam.role-assumed-by-eventbridge-target",
            "node_event_role",
            "node_schedule_target",
          ),
          relationshipEdge(
            "edge_workflow_role",
            "aws.iam.role-assumed-by-step-functions",
            "node_workflow_role",
            "node_workflow",
          ),
          relationshipEdge(
            "edge_workflow_task",
            "aws.stepfunctions.state-machine-invokes-lambda",
            "node_workflow",
            "node_workflow_task",
            {
              taskTimeoutSeconds: { kind: "integer", value: 30 },
              maximumAttempts: { kind: "integer", value: 5 },
            },
          ),
          relationshipEdge(
            "edge_task_role",
            "aws.iam.role-assumed-by-lambda",
            "node_task_role",
            "node_workflow_task",
          ),
          relationshipEdge(
            "edge_workflow_task_logs",
            "aws.lambda.writes-log-group",
            "node_workflow_task",
            "node_workflow_task_logs",
          ),
        ],
      };
    case "sns-fan-out-notification":
      return {
        nodes: [
          serviceNode(
            "node_topic",
            "notifications",
            "Notifications",
            "aws.sns.topic",
            { x: 80, y: 200 },
          ),
          serviceNode(
            "node_subscription_a",
            "orders_subscription",
            "Orders subscription",
            "aws.sns.subscription",
            { x: 400, y: 80 },
            {
              protocol: { kind: "string", value: "SQS" },
              rawMessageDelivery: { kind: "boolean", value: true },
            },
          ),
          serviceNode(
            "node_subscription_b",
            "audit_subscription",
            "Audit subscription",
            "aws.sns.subscription",
            { x: 400, y: 320 },
            {
              protocol: { kind: "string", value: "SQS" },
              rawMessageDelivery: { kind: "boolean", value: true },
            },
          ),
          serviceNode(
            "node_orders_queue",
            "orders_queue",
            "Orders queue",
            "aws.sqs.queue",
            { x: 760, y: 80 },
            queueConfiguration("fanout-orders"),
          ),
          serviceNode(
            "node_audit_queue",
            "audit_queue",
            "Audit queue",
            "aws.sqs.queue",
            { x: 760, y: 320 },
            queueConfiguration("fanout-audit"),
          ),
          serviceNode(
            "node_orders_consumer",
            "orders_consumer",
            "Orders consumer",
            "aws.lambda.function",
            { x: 1080, y: 80 },
            lambdaConfiguration("fanout-orders-consumer"),
          ),
          serviceNode(
            "node_audit_consumer",
            "audit_consumer",
            "Audit consumer",
            "aws.lambda.function",
            { x: 1080, y: 320 },
            lambdaConfiguration("fanout-audit-consumer"),
          ),
          serviceNode(
            "node_orders_dlq",
            "orders_dlq",
            "Orders DLQ",
            "aws.sqs.queue",
            { x: 760, y: 560 },
            queueConfiguration("fanout-orders-dlq"),
          ),
          serviceNode(
            "node_audit_dlq",
            "audit_dlq",
            "Audit DLQ",
            "aws.sqs.queue",
            { x: 760, y: 720 },
            queueConfiguration("fanout-audit-dlq"),
          ),
          serviceNode(
            "node_orders_consumer_role",
            "orders_consumer_role",
            "Orders consumer role",
            "aws.iam.role",
            { x: 1080, y: 520 },
            roleConfiguration("fanout-orders-consumer-role"),
          ),
          serviceNode(
            "node_audit_consumer_role",
            "audit_consumer_role",
            "Audit consumer role",
            "aws.iam.role",
            { x: 1360, y: 520 },
            roleConfiguration("fanout-audit-consumer-role"),
          ),
          serviceNode(
            "node_orders_consumer_logs",
            "orders_consumer_logs",
            "Orders consumer logs",
            "aws.cloudwatch.log-group",
            { x: 1360, y: 80 },
            logGroupConfiguration("/aws/lambda/fanout-orders-consumer"),
          ),
          serviceNode(
            "node_audit_consumer_logs",
            "audit_consumer_logs",
            "Audit consumer logs",
            "aws.cloudwatch.log-group",
            { x: 1360, y: 320 },
            logGroupConfiguration("/aws/lambda/fanout-audit-consumer"),
          ),
        ],
        edges: [
          relationshipEdge(
            "edge_topic_subscription_a",
            "aws.sns.topic-owns-subscription",
            "node_topic",
            "node_subscription_a",
          ),
          relationshipEdge(
            "edge_subscription_queue_a",
            "aws.sns.subscription-sends-to-sqs",
            "node_subscription_a",
            "node_orders_queue",
          ),
          relationshipEdge(
            "edge_topic_subscription_b",
            "aws.sns.topic-owns-subscription",
            "node_topic",
            "node_subscription_b",
          ),
          relationshipEdge(
            "edge_subscription_queue_b",
            "aws.sns.subscription-sends-to-sqs",
            "node_subscription_b",
            "node_audit_queue",
          ),
          relationshipEdge(
            "edge_orders_queue_consumer",
            "aws.sqs.queue-triggers-lambda",
            "node_orders_queue",
            "node_orders_consumer",
          ),
          relationshipEdge(
            "edge_audit_queue_consumer",
            "aws.sqs.queue-triggers-lambda",
            "node_audit_queue",
            "node_audit_consumer",
          ),
          relationshipEdge(
            "edge_orders_queue_dlq",
            "aws.sqs.queue-uses-dead-letter-queue",
            "node_orders_queue",
            "node_orders_dlq",
          ),
          relationshipEdge(
            "edge_audit_queue_dlq",
            "aws.sqs.queue-uses-dead-letter-queue",
            "node_audit_queue",
            "node_audit_dlq",
          ),
          relationshipEdge(
            "edge_orders_consumer_role",
            "aws.iam.role-assumed-by-lambda",
            "node_orders_consumer_role",
            "node_orders_consumer",
          ),
          relationshipEdge(
            "edge_audit_consumer_role",
            "aws.iam.role-assumed-by-lambda",
            "node_audit_consumer_role",
            "node_audit_consumer",
          ),
          relationshipEdge(
            "edge_orders_consumer_logs",
            "aws.lambda.writes-log-group",
            "node_orders_consumer",
            "node_orders_consumer_logs",
          ),
          relationshipEdge(
            "edge_audit_consumer_logs",
            "aws.lambda.writes-log-group",
            "node_audit_consumer",
            "node_audit_consumer_logs",
          ),
        ],
      };
    case "queue-consumer-with-dlq":
      return {
        nodes: [
          serviceNode(
            "node_work_queue",
            "work_queue",
            "Work queue",
            "aws.sqs.queue",
            { x: 80, y: 120 },
            queueConfiguration("work-queue"),
          ),
          serviceNode(
            "node_consumer",
            "queue_consumer",
            "Queue consumer",
            "aws.lambda.function",
            { x: 440, y: 120 },
            lambdaConfiguration("queue-consumer"),
          ),
          serviceNode(
            "node_dlq",
            "work_dlq",
            "Work DLQ",
            "aws.sqs.queue",
            {
              x: 80,
              y: 360,
            },
            queueConfiguration("work-dlq"),
          ),
          serviceNode(
            "node_consumer_role",
            "queue_consumer_role",
            "Consumer role",
            "aws.iam.role",
            { x: 440, y: 360 },
            roleConfiguration("queue-consumer-role"),
          ),
          serviceNode(
            "node_consumer_logs",
            "queue_consumer_logs",
            "Queue consumer logs",
            "aws.cloudwatch.log-group",
            { x: 720, y: 120 },
            logGroupConfiguration("/aws/lambda/queue-consumer"),
          ),
        ],
        edges: [
          relationshipEdge(
            "edge_queue_consumer",
            "aws.sqs.queue-triggers-lambda",
            "node_work_queue",
            "node_consumer",
          ),
          relationshipEdge(
            "edge_queue_dlq",
            "aws.sqs.queue-uses-dead-letter-queue",
            "node_work_queue",
            "node_dlq",
          ),
          relationshipEdge(
            "edge_consumer_role",
            "aws.iam.role-assumed-by-lambda",
            "node_consumer_role",
            "node_consumer",
          ),
          relationshipEdge(
            "edge_consumer_logs",
            "aws.lambda.writes-log-group",
            "node_consumer",
            "node_consumer_logs",
          ),
        ],
      };
  }
}

function templateWorkloadSpecifications(
  templateId: AwsEventTemplateId,
): readonly EventWorkloadSpecification[] {
  switch (templateId) {
    case "image-upload-processing":
      return [
        {
          key: "image_processor",
          pattern: "s3-image-metadata",
          owningNodeId: "node_image_processor",
          triggerEdgeId: "edge_upload_notification",
          downstreamEdgeId: "edge_metadata_write",
          metadataNodeId: "node_image_metadata",
        },
      ];
    case "scheduled-workflow":
      return [
        {
          key: "scheduled_task",
          pattern: "step-functions-task",
          owningNodeId: "node_workflow_task",
          triggerEdgeId: "edge_workflow_task",
        },
      ];
    case "sns-fan-out-notification":
      return [
        {
          key: "orders_consumer",
          pattern: "sqs-consumer-dlq",
          owningNodeId: "node_orders_consumer",
          triggerEdgeId: "edge_orders_queue_consumer",
        },
        {
          key: "audit_consumer",
          pattern: "sqs-consumer-dlq",
          owningNodeId: "node_audit_consumer",
          triggerEdgeId: "edge_audit_queue_consumer",
        },
      ];
    case "queue-consumer-with-dlq":
      return [
        {
          key: "queue_consumer",
          pattern: "sqs-consumer-dlq",
          owningNodeId: "node_consumer",
          triggerEdgeId: "edge_queue_consumer.edge.connection",
        },
      ];
  }
}

/** New SQS documents use the same reviewed connection commands as the editor. */
function resolveSqsTemplateConnections(
  document: ArchitectureDocument,
  edges: ReturnType<typeof templateGraph>["edges"],
): ArchitectureDocument {
  let candidate = document;
  // Resolve execution-role prerequisites before permissions that depend on them.
  for (const edgeId of [
    "edge_consumer_role",
    "edge_consumer_logs",
    "edge_queue_dlq",
    "edge_queue_consumer",
  ]) {
    const edge = edges.find(({ id }) => id === edgeId);
    const relationship = awsEditorCatalog.relationships?.find(
      ({ id }) => id === edge?.semantic.relationshipType,
    );
    if (edge === undefined || relationship === undefined)
      throw new TypeError(
        "SQS template requires its exact reviewed relationships.",
      );
    const resolved = awsConnectionResolverV1.resolve({
      document: candidate,
      ruleId: relationship.descriptorId,
      source: {
        nodeId: edge.semantic.source.nodeId,
        portId: edge.semantic.source.port,
      },
      target: {
        nodeId: edge.semantic.target.nodeId,
        portId: edge.semantic.target.port,
      },
      configuration: edge.semantic.configuration.values,
      operationId: edge.id,
    });
    if (!resolved.success)
      throw new TypeError(
        "SQS template connection cannot resolve: " +
          resolved.findings.map(({ code }) => code).join(", "),
      );
    candidate = applyGraphCommand(candidate, resolved.batch).document;
  }
  return candidate;
}

export function loadAwsEventTemplateArchitectureDocument(
  templateId: AwsEventTemplateId,
  region = "us-east-1",
): ArchitectureDocument {
  const graph = templateGraph(templateId);
  const safeId = templateId.replaceAll("-", "_");
  const assumptionId = `assumption_${safeId}_handler_contract_authority`;
  const revision = {
    revisionId: `revision_event_template_${safeId}_0001`,
    revisionNumber: 1,
    createdAt: fixtureTimestamp,
    createdBy: "actor_curated_template",
    sourceDraftId: `draft_event_template_${safeId}_0001`,
  };
  const contractRevision = {
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
  };
  const workloadBundles = templateWorkloadSpecifications(templateId).map(
    (specification) => createEventWorkloadBundle(specification, assumptionId),
  );
  const usesCanonicalSqsConnections = templateId === "queue-consumer-with-dlq";
  const document = parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 3,
    documentId: `doc_event_template_${safeId}`,
    architectureId: `architecture_event_template_${safeId}`,
    revision,
    provider: {
      id: awsEditorCatalog.providerId,
      region: regionIdentifierSchema.parse(region),
    },
    catalog: {
      id: awsEditorCatalog.identity.id,
      version: awsEditorCatalog.identity.version,
      digest: awsEditorCatalog.identity.digest,
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "1.0.0",
      maximumCompilerVersionExclusive: "2.0.0",
    },
    metadata: {
      source: "template",
      serialization: {
        mediaType: "application/json",
        encoding: "utf-8",
        canonicalization: "cloudmarkup.canonical-json.v1",
      },
    },
    nodes: graph.nodes,
    edges: usesCanonicalSqsConnections ? [] : graph.edges,
    variables: [],
    outputs: [],
    assumptions: [
      {
        id: assumptionId,
        statement:
          "Application source is generated only when an exact Workload Document and reviewed event contracts bind every required operation; unsupported business transforms remain custom-required, and adding side effects requires a revised Workload plus an implemented durable hook.",
        status: "accepted",
        origin: "template",
      },
    ],
    unresolvedRequirements: [],
    applicationContracts: {
      kind: "cloudmarkup.application-contracts",
      schemaVersion: 1,
      contractSetId: `contracts_event_template_${safeId}`,
      documentId: `doc_event_template_${safeId}`,
      revision: contractRevision,
      contracts: usesCanonicalSqsConnections
        ? []
        : workloadBundles.flatMap(({ contracts }) => contracts),
    },
    externalResources: {
      kind: "cloudmarkup.external-resource-reference-document",
      schemaVersion: 1,
      documentId: `doc_event_template_${safeId}`,
      architectureId: `architecture_event_template_${safeId}`,
      revision: contractRevision,
      resources: [],
    },
    workloadBehavior: {
      contractVersion: 2,
      workloads: usesCanonicalSqsConnections
        ? []
        : workloadBundles.map(({ workload }) => workload),
    },
  });
  if (!usesCanonicalSqsConnections) return document;
  const connected = resolveSqsTemplateConnections(document, graph.edges);
  return applyGraphCommand(connected, {
    schemaVersion: 1,
    kind: "replace-workload-and-application-contracts",
    commandId: "command_sqs_template_workload",
    inverseCommandId: "command_sqs_template_workload_inverse",
    origin: "user",
    target: {
      documentId: connected.documentId,
      architectureId: connected.architectureId,
      revisionId: connected.revision.revisionId,
    },
    expectedWorkloadBehavior: connected.workloadBehavior,
    workloadBehavior: {
      contractVersion: 2,
      workloads: workloadBundles.map(({ workload }) => workload),
    },
    expectedApplicationContracts: connected.applicationContracts,
    applicationContracts: {
      ...connected.applicationContracts,
      contracts: workloadBundles.flatMap(({ contracts }) => contracts),
    },
  }).document;
}
