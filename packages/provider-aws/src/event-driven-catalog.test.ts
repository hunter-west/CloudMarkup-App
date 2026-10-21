import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import type { ArchitectureDocumentV1 } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { awsEventDrivenConnectionRulesV1 } from "./catalog/connections/event-driven-connections.js";
import { s3BucketNotificationConfiguration } from "./catalog/services/s3-eventing.js";
import {
  awsConnectionResolverV1,
  awsConnectionRuleRegistrationsV1,
} from "./connection-resolution.js";
import { AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2 } from "./event-workload-metadata.js";
import { awsServiceExtensionV1 } from "./service-extension-v1-accessors.js";
import {
  createEventDeliveryRuleV1,
  createEventTopologyRuleV1,
} from "./validation/event-driven-rules.js";

type TestNode = ArchitectureDocumentV1["nodes"][number];
type TestEdge = ArchitectureDocumentV1["edges"][number];

function serviceConfiguration(serviceId: string, values: unknown = {}) {
  const service = awsCatalogV1.requireService(serviceId);
  const result = awsCatalogV1.validateConfiguration(serviceId, values);
  if (!result.success)
    throw new TypeError(`Invalid test service ${serviceId}.`);
  return {
    schemaId: service.configuration.schemaId,
    schemaVersion: service.configuration.schemaVersion,
    values: result.values,
  };
}

function connectionConfiguration(ruleId: string, values: unknown = {}) {
  const rule = awsCatalogV1.getConnectionRule(ruleId);
  if (rule === undefined) throw new TypeError(`Unknown test rule ${ruleId}.`);
  const result = validateProviderConfigurationV1(rule.configuration, values);
  if (!result.success) throw new TypeError(`Invalid test rule ${ruleId}.`);
  return {
    schemaId: rule.configuration.schemaId,
    schemaVersion: rule.configuration.schemaVersion,
    values: result.values,
  };
}

function node(id: string, serviceId: string, values: unknown = {}): TestNode {
  const service = awsCatalogV1.requireService(serviceId);
  if (service.nodeKind.kind !== "resource")
    throw new TypeError("Resource required.");
  return {
    id,
    semantic: {
      deploymentKey: id.replaceAll("-", "_"),
      serviceType: service.id,
      resourceType: service.nodeKind.resourceType,
      configuration: serviceConfiguration(serviceId, values),
      lifecycle: { ownership: "user", origin: "user" },
    },
    presentation: { label: service.displayName, position: { x: 0, y: 0 } },
  } as unknown as TestNode;
}

function edge(
  id: string,
  ruleId: string,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
  values: unknown = {},
): TestEdge {
  const rule = awsCatalogV1.getConnectionRule(ruleId);
  if (rule === undefined) throw new TypeError(`Unknown test rule ${ruleId}.`);
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: sourcePort },
      target: { nodeId: targetNodeId, port: targetPort },
      relationshipType: rule.relationshipType,
      configuration: connectionConfiguration(ruleId, values),
      lifecycle: { ownership: "user", origin: "user" },
    },
  } as TestEdge;
}

function ruleEdge(
  id: string,
  ruleId: string,
  sourceNodeId: string,
  targetNodeId: string,
  values: unknown = {},
): TestEdge {
  const rule = awsCatalogV1.getConnectionRule(ruleId);
  if (rule === undefined) throw new TypeError(`Unknown test rule ${ruleId}.`);
  return edge(
    id,
    ruleId,
    sourceNodeId,
    String(rule.source.portId),
    targetNodeId,
    String(rule.target.portId),
    values,
  );
}

function document(
  nodes: readonly TestNode[],
  edges: readonly TestEdge[],
): ArchitectureDocumentV1 {
  return {
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 1,
    documentId: "event_validation_document",
    architectureId: "event_validation_architecture",
    revision: {
      revisionId: "event_validation_revision",
      revisionNumber: 1,
      createdAt: "2026-08-26T12:00:00Z",
      createdBy: "event_validation_actor",
    },
    provider: { id: awsCatalogArtifactV1.provider.id, region: "us-east-1" },
    catalog: {
      id: awsCatalogArtifactV1.catalog.id,
      version: awsCatalogArtifactV1.catalog.version,
      digest: awsCatalogArtifactV1.digest,
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "0.1.0",
    },
    metadata: {
      source: "user",
      serialization: {
        mediaType: "application/json",
        encoding: "utf-8",
        canonicalization: "cloudmarkup.canonical-json.v1",
      },
    },
    nodes: [...nodes],
    edges: [...edges],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
  } as unknown as ArchitectureDocumentV1;
}

function findingCodes(
  rule: ReturnType<typeof createEventDeliveryRuleV1>,
  architecture: ArchitectureDocumentV1,
): readonly string[] {
  return executeArchitectureValidationRules(
    { document: architecture, target: "draft", environment: "development" },
    [rule],
  ).findings.map((finding) => String(finding.code));
}

function allEventFindingCodes(
  architecture: ArchitectureDocumentV1,
): readonly string[] {
  return executeArchitectureValidationRules(
    { document: architecture, target: "draft", environment: "development" },
    [
      createEventTopologyRuleV1(awsCatalogArtifactV1),
      createEventDeliveryRuleV1(awsCatalogArtifactV1),
    ],
  ).findings.map((finding) => String(finding.code));
}

describe("AWS event-driven catalog slice", () => {
  it("defines exact services, icons, semantic ports, and reviewed Terraform mappings", () => {
    const expected = new Map([
      ["aws.s3.bucket", "aws.cloudmarkup.icons.s3"],
      ["aws.sqs.queue", "aws.cloudmarkup.icons.sqs"],
      ["aws.sns.topic", "aws.cloudmarkup.icons.sns"],
      ["aws.eventbridge.event-bus", "aws.cloudmarkup.icons.eventbridge"],
      ["aws.eventbridge.rule", "aws.cloudmarkup.icons.eventbridge-rule"],
      [
        "aws.stepfunctions.state-machine",
        "aws.cloudmarkup.icons.step-functions",
      ],
    ]);
    for (const [serviceId, iconId] of expected) {
      const service = awsCatalogV1.requireService(serviceId);
      expect(service.iconId, serviceId).toBe(iconId);
      expect(service.ports.length, serviceId).toBeGreaterThan(1);
      expect(
        service.mappings.find((mapping) => mapping.target === "terraform")
          ?.implementationStatus,
        serviceId,
      ).toBe("implemented");
      expect(
        service.mappings.find((mapping) => mapping.target === "cloudformation")
          ?.implementationStatus,
        serviceId,
      ).toBe("implemented");
      expect(service.unsupportedCapabilities.length, serviceId).toBeGreaterThan(
        0,
      );
    }
    expect(
      awsCatalogV1
        .requireService("aws.eventbridge.target")
        .mappings.map((mapping) => mapping.target),
    ).toEqual(["terraform"]);
    expect(
      awsCatalogV1
        .requireService("aws.s3.bucket")
        .mappings.map((mapping) => mapping.target),
    ).toEqual(["cloudformation", "terraform"]);
    expect(
      s3BucketNotificationConfiguration.mappings.map(
        (mapping) => mapping.target,
      ),
    ).toEqual(["terraform"]);
    expect(
      s3BucketNotificationConfiguration.mappings[0]?.configurationBindings.find(
        (binding) => binding.configurationKey === "notificationName",
      )?.targetName,
    ).toBe("lambda_function.id");
    expect(
      awsCatalogV1.validateConfiguration("aws.eventbridge.rule", {
        rawEventPattern: { kind: "string", value: "{}" },
      }).success,
    ).toBe(false);
  });

  it("registers exact event rules, reviewed questions, least-privilege effects, and provenance", () => {
    expect(awsEventDrivenConnectionRulesV1).toHaveLength(35);
    const registered = new Set<string>(
      awsConnectionRuleRegistrationsV1.map(
        (registration) => registration.ruleId,
      ),
    );
    const requiredRuleIds = [
      "aws.s3.bucket-notifies-lambda",
      "aws.s3.bucket-sends-events-to-eventbridge",
      "aws.lambda.sends-message-to-sqs",
      "aws.sqs.queue-triggers-lambda",
      "aws.sqs.queue-uses-dead-letter-queue",
      "aws.lambda.publishes-to-sns",
      "aws.sns.topic-owns-subscription",
      "aws.eventbridge.rule-owns-target",
      "aws.stepfunctions.state-machine-invokes-lambda",
      "aws.iam.role-assumed-by-eventbridge-target",
    ];
    for (const ruleId of requiredRuleIds)
      expect(registered.has(ruleId), ruleId).toBe(true);
    for (const rule of awsEventDrivenConnectionRulesV1) {
      expect(rule.implementation.status, rule.id).toBe("implemented");
      expect(rule.lifecycle, rule.id).toEqual({
        provenance: "connection-rule",
        deletion: "release-generated-resources",
        adoption: "required-before-customization",
        sharedResource: "retain-while-referenced",
      });
      expect(
        rule.iamEffects
          .flatMap((effect) => effect.actions)
          .every((action) => !action.includes("*")),
        rule.id,
      ).toBe(true);
    }
    expect(
      awsCatalogV1
        .getConnectionRule("aws.sqs.queue-triggers-lambda")
        ?.questions.map((question) => question.property),
    ).toEqual([
      "batchSize",
      "batchingWindowSeconds",
      "deliverySemantics",
      "maximumConcurrency",
      "partialBatchResponse",
    ]);
    expect(
      awsCatalogV1.getConnectionRule(
        "aws.stepfunctions.state-machine-invokes-lambda",
      )?.iamEffects[0]?.actions,
    ).toEqual(["lambda:InvokeFunction"]);
    expect(
      awsCatalogV1.getConnectionRule(
        "aws.iam.role-assumed-by-eventbridge-target",
      )?.iamEffects[0],
    ).toMatchObject({
      effect: "trust",
      actions: ["sts:AssumeRole"],
      principal: "events.amazonaws.com",
      resourceScope: "source-node",
    });
    expect(
      awsCatalogV1.getConnectionRule("aws.lambda.publishes-to-sns")?.questions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: "ordering",
          answer: { kind: "catalog-default" },
        }),
      ]),
    );
    expect(
      awsCatalogV1.requireService("aws.iam.policy-statement").definitionVersion,
    ).toBe("2.4.0");

    const roleDocument = document(
      [
        node("resolver_role", "aws.iam.role"),
        node("resolver_target", "aws.eventbridge.target", {
          targetType: { kind: "string", value: "STEP_FUNCTIONS" },
        }),
      ],
      [],
    );
    const resolved = awsConnectionResolverV1.resolve({
      document: roleDocument,
      ruleId: "aws.iam.role-assumed-by-eventbridge-target",
      source: {
        nodeId: "resolver_role",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "resolver_target",
        portId: "aws.eventbridge.target.execution-role",
      },
      configuration: {},
      operationId: "eventbridge_role",
    });
    expect(resolved.success).toBe(true);
    if (resolved.success) {
      expect(resolved.batch.commands).toHaveLength(5);
      expect(resolved.iamEffects).toEqual([
        expect.objectContaining({
          effect: "trust",
          principal: "events.amazonaws.com",
          actions: ["sts:AssumeRole"],
        }),
      ]);
    }
  });

  it("binds current event generation readiness and owned configuration slots", () => {
    const extensions = new Map(
      awsServiceExtensionV1.artifact.services.map((service) => [
        String(service.serviceId),
        service,
      ]),
    );
    expect(
      extensions
        .get("aws.s3.bucket")
        ?.ownedConfigurationSlots.map((slot) => slot.id),
    ).toEqual([
      "aws.s3.bucket.slot.cors",
      "aws.s3.bucket.slot.lifecycle",
      "aws.s3.bucket.slot.notifications",
      "aws.s3.bucket.slot.resource-policy",
    ]);
    expect(
      extensions.get("aws.sqs.queue")?.ownedConfigurationSlots,
    ).toHaveLength(2);
    expect(
      extensions.get("aws.sns.topic")?.ownedConfigurationSlots,
    ).toHaveLength(2);
    expect(
      extensions.get("aws.eventbridge.rule")?.ownedConfigurationSlots[0]
        ?.cardinality.maximum,
    ).toBe("many");
    for (const serviceId of [
      "aws.s3.bucket",
      "aws.sqs.queue",
      "aws.sns.topic",
      "aws.eventbridge.event-bus",
    ]) {
      expect(
        extensions.get(serviceId)?.targetReadiness.terraform.status,
        serviceId,
      ).toBe("supported");
      expect(
        extensions.get(serviceId)?.targetReadiness.generatedCode.status,
        serviceId,
      ).toBe("supported");
      expect(
        extensions.get(serviceId)?.targetReadiness.cloudformation.status,
        serviceId,
      ).toBe("supported");
    }
    expect(
      extensions.get("aws.lambda.function")?.targetReadiness.generatedCode
        .status,
    ).toBe("supported");
    expect(
      extensions.get("aws.dynamodb.table")?.targetReadiness.terraform.status,
    ).toBe("supported");
    expect(
      awsCatalogV1.getConnectionRule("aws.lambda.writes-dynamodb-table")
        ?.implementation.status,
    ).toBe("implemented");
    expect(AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2).toHaveLength(9);
    expect(
      new Set(
        AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2.map(
          (entry) => entry.relationshipType,
        ),
      ).size,
    ).toBe(9);
    for (const entry of AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2) {
      expect(entry.delivery).toBe("at-least-once");
      expect(entry.duplicates).toBe("possible");
      expect(entry.endpointBindings.length).toBeGreaterThan(0);
    }
    expect(
      AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2.find(
        (entry) => entry.relationshipType === "aws.lambda.publishes-to-sns",
      )?.ordering,
    ).toBe("transport-dependent");
    expect(
      AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2.map(
        (entry) => entry.relationshipType,
      ),
    ).toEqual([
      "aws.s3.notifies-lambda",
      "aws.lambda.sends-message-to-sqs",
      "aws.sqs.triggers-lambda",
      "aws.lambda.publishes-to-sns",
      "aws.sns.subscription-invokes-lambda",
      "aws.lambda.puts-events-on-eventbridge",
      "aws.eventbridge.target-invokes-lambda",
      "aws.lambda.starts-step-functions-state-machine",
      "aws.stepfunctions.state-machine-invokes-lambda",
    ]);
    const generatedTriggerRelationships = new Set([
      "aws.s3.notifies-lambda",
      "aws.sqs.triggers-lambda",
      "aws.sns.subscription-invokes-lambda",
      "aws.eventbridge.target-invokes-lambda",
      "aws.stepfunctions.state-machine-invokes-lambda",
    ]);
    for (const entry of AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2) {
      expect(entry.generatedCodeReadiness.status).toBe(
        generatedTriggerRelationships.has(entry.relationshipType)
          ? "supported"
          : "pending",
      );
    }
    expect(
      AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2.filter(
        ({ generatedCodeReadiness }) =>
          generatedCodeReadiness.status === "supported",
      ),
    ).toHaveLength(5);
    expect(
      AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2.filter(
        ({ generatedCodeReadiness }) =>
          generatedCodeReadiness.status === "pending",
      ).map(({ relationshipType }) => relationshipType),
    ).toEqual([
      "aws.lambda.sends-message-to-sqs",
      "aws.lambda.publishes-to-sns",
      "aws.lambda.puts-events-on-eventbridge",
      "aws.lambda.starts-step-functions-state-machine",
    ]);
  });

  it("detects cycles, duplicate notifications, FIFO DLQ mismatches, and timeout conflicts deterministically", () => {
    const lambda = node("lambda", "aws.lambda.function");
    const queue = node("queue", "aws.sqs.queue");
    const cycleDocument = document(
      [lambda, queue],
      [
        edge(
          "send",
          "aws.lambda.sends-message-to-sqs",
          "lambda",
          "aws.lambda.function.message-send",
          "queue",
          "aws.sqs.queue.message-send",
        ),
        edge(
          "consume",
          "aws.sqs.queue-triggers-lambda",
          "queue",
          "aws.sqs.queue.event-source",
          "lambda",
          "aws.lambda.function.event-source",
        ),
      ],
    );
    expect(
      findingCodes(
        createEventTopologyRuleV1(awsCatalogArtifactV1),
        cycleDocument,
      ),
    ).toContain("aws.validation.event-flow-cycle");

    const sourceQueue = node("source_queue", "aws.sqs.queue");
    const fifoDlq = node("fifo_dlq", "aws.sqs.queue", {
      queueName: { kind: "string", value: "failed-events.fifo" },
      queueType: { kind: "string", value: "FIFO" },
    });
    const redriveDocument = document(
      [sourceQueue, fifoDlq],
      [
        edge(
          "redrive",
          "aws.sqs.queue-uses-dead-letter-queue",
          "source_queue",
          "aws.sqs.queue.redrive",
          "fifo_dlq",
          "aws.sqs.queue.dead-letter-target",
        ),
      ],
    );
    expect(
      findingCodes(
        createEventDeliveryRuleV1(awsCatalogArtifactV1),
        redriveDocument,
      ),
    ).toContain("aws.validation.sqs-dead-letter-fifo-mismatch");

    const bucket = node("bucket", "aws.s3.bucket");
    const duplicateDocument = document(
      [bucket, lambda],
      [
        edge(
          "notification_a",
          "aws.s3.bucket-notifies-lambda",
          "bucket",
          "aws.s3.bucket.notifications",
          "lambda",
          "aws.lambda.function.asynchronous-invocation",
        ),
        edge(
          "notification_b",
          "aws.s3.bucket-notifies-lambda",
          "bucket",
          "aws.s3.bucket.notifications",
          "lambda",
          "aws.lambda.function.asynchronous-invocation",
        ),
      ],
    );
    expect(
      findingCodes(
        createEventTopologyRuleV1(awsCatalogArtifactV1),
        duplicateDocument,
      ),
    ).toContain("aws.validation.s3-duplicate-notification");
  });

  it("rejects a nonzero FIFO Lambda batching window while preserving Standard and FIFO zero", () => {
    for (const [queueType, window, rejected] of [
      ["STANDARD", 5, false],
      ["FIFO", 0, false],
      ["FIFO", 5, true],
    ] as const) {
      const architecture = document(
        [
          node("queue", "aws.sqs.queue", {
            queueType: { kind: "string", value: queueType },
            queueName: {
              kind: "string",
              value: queueType === "FIFO" ? "ordered.fifo" : "standard",
            },
          }),
          node("lambda", "aws.lambda.function"),
        ],
        [
          ruleEdge(
            "consumer",
            "aws.sqs.queue-triggers-lambda",
            "queue",
            "lambda",
            {
              batchingWindowSeconds: { kind: "integer", value: window },
            },
          ),
        ],
      );
      const validate = () =>
        executeArchitectureValidationRules(
          {
            document: architecture,
            target: "compilation",
            environment: "production",
          },
          [createEventDeliveryRuleV1(awsCatalogArtifactV1)],
        );
      const report = validate();
      expect(validate()).toEqual(report);
      const invalid = report.findings.filter(
        (f) => f.code === "aws.validation.sqs-fifo-batching-window-unsupported",
      );
      expect(invalid).toHaveLength(rejected ? 1 : 0);
      if (rejected) {
        expect(invalid[0]?.severity).toBe("error");
        expect(invalid[0]?.affected).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "configuration",
              owner: { kind: "edge", edgeId: "consumer" },
              key: "batchingWindowSeconds",
              path: "$.edges[0].semantic.configuration.values.batchingWindowSeconds",
            }),
          ]),
        );
        expect(invalid[0]?.autoFix).toBeUndefined();
      }
    }
  });

  it("keeps scheduled EventBridge rules on the default bus without rejecting custom-bus event patterns", () => {
    for (const [busType, triggerMode, rejected] of [
      ["DEFAULT", "SCHEDULE", false],
      ["CUSTOM", "EVENT_PATTERN", false],
      ["CUSTOM", "SCHEDULE", true],
    ] as const) {
      const architecture = document(
        [
          node("bus", "aws.eventbridge.event-bus", {
            busType: { kind: "string", value: busType },
            busName: {
              kind: "string",
              value: busType === "DEFAULT" ? "default" : "application",
            },
          }),
          node("rule", "aws.eventbridge.rule", {
            triggerMode: { kind: "string", value: triggerMode },
            scheduleExpression: {
              kind: "string",
              value: triggerMode === "SCHEDULE" ? "RATE_1_HOUR" : "NONE",
            },
          }),
        ],
        [
          ruleEdge(
            "bus_rule",
            "aws.eventbridge.event-bus-associates-rule",
            "bus",
            "rule",
          ),
        ],
      );
      const validate = () =>
        executeArchitectureValidationRules(
          {
            document: architecture,
            target: "compilation",
            environment: "production",
          },
          [createEventDeliveryRuleV1(awsCatalogArtifactV1)],
        );
      const report = validate();
      expect(validate()).toEqual(report);
      const invalid = report.findings.filter(
        (f) =>
          f.code === "aws.validation.eventbridge-schedule-default-bus-required",
      );
      expect(invalid).toHaveLength(rejected ? 1 : 0);
      if (rejected) {
        expect(invalid[0]?.severity).toBe("error");
        expect(invalid[0]?.affected).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "edge", edgeId: "bus_rule" }),
          ]),
        );
        expect(invalid[0]?.autoFix).toBeUndefined();
      }
    }
  });

  it("requires each owned S3 notification to match one explicit supported destination", () => {
    for (const state of [
      "matching",
      "standalone",
      "conflicting",
      "eventbridge",
      "duplicate",
    ] as const) {
      const bucket = node("bucket", "aws.s3.bucket");
      const notification = node(
        "notification",
        "aws.s3.bucket-notification-configuration",
        {
          filterPrefix: {
            kind: "string",
            value: state === "conflicting" ? "deleted/" : "incoming/",
          },
          filterSuffix: { kind: "string", value: ".jpg" },
          destinationKind: {
            kind: "string",
            value: state === "eventbridge" ? "EVENTBRIDGE" : "LAMBDA",
          },
        },
      );
      const architecture = document(
        [
          bucket,
          node("lambda", "aws.lambda.function"),
          notification,
          ...(state === "duplicate"
            ? [{ ...notification, id: "duplicate_notification" } as TestNode]
            : []),
        ],
        [
          ruleEdge(
            "owner",
            "aws.s3.bucket-owns-notification-configuration",
            "notification",
            "bucket",
          ),
          ...(state === "duplicate"
            ? [
                ruleEdge(
                  "duplicate_owner",
                  "aws.s3.bucket-owns-notification-configuration",
                  "duplicate_notification",
                  "bucket",
                ),
              ]
            : []),
          ...(state === "standalone"
            ? []
            : [
                ruleEdge(
                  "destination",
                  "aws.s3.bucket-notifies-lambda",
                  "bucket",
                  "lambda",
                  {
                    filterPrefix: { kind: "string", value: "incoming/" },
                    filterSuffix: { kind: "string", value: ".jpg" },
                  },
                ),
              ]),
        ],
      );
      const validate = () =>
        executeArchitectureValidationRules(
          {
            document: architecture,
            target: "compilation",
            environment: "production",
          },
          [createEventDeliveryRuleV1(awsCatalogArtifactV1)],
        );
      const report = validate();
      expect(validate()).toEqual(report);
      const invalid = report.findings.filter(
        (f) => f.code === "aws.validation.s3-owned-notification-unrepresented",
      );
      expect(invalid.length > 0).toBe(state !== "matching");
      if (state !== "matching") {
        const childFinding = invalid.find((f) =>
          f.affected.some(
            (location) =>
              location.kind === "node" && location.nodeId === "notification",
          ),
        );
        expect(childFinding?.severity).toBe("error");
      }
      for (const finding of invalid) expect(finding.autoFix).toBeUndefined();
    }
  });

  it("keeps effective S3 notification names unique within each owning bucket", () => {
    const rule = awsCatalogV1.getConnectionRule(
      "aws.s3.bucket-notifies-lambda",
    );
    if (rule === undefined) throw new Error("Expected reviewed S3 rule.");
    for (const state of [
      "same-name",
      "distinct-names",
      "different-buckets",
      "owned-edge-collision",
      "edge-only-collision",
    ] as const) {
      let architecture:
        ArchitectureDocumentV1 | ReturnType<typeof parseArchitectureDocument> =
        document(
          [
            node("bucket", "aws.s3.bucket"),
            node("other_bucket", "aws.s3.bucket", {
              bucketName: { kind: "string", value: "other-application-events" },
            }),
            node("lambda", "aws.lambda.function"),
            node("other_lambda", "aws.lambda.function", {
              functionName: { kind: "string", value: "other_handler" },
            }),
          ],
          [],
        );
      for (const [index, prefix] of ["incoming/", "outgoing/"].entries()) {
        const result = awsConnectionResolverV1.resolve({
          document: architecture,
          ruleId: "aws.s3.bucket-notifies-lambda",
          source: {
            nodeId:
              index === 1 && state === "different-buckets"
                ? "other_bucket"
                : "bucket",
            portId: rule.source.portId,
          },
          target: {
            nodeId: index === 0 ? "lambda" : "other_lambda",
            portId: rule.target.portId,
          },
          configuration: {
            filterPrefix: { kind: "string", value: prefix },
            filterSuffix: { kind: "string", value: ".jpg" },
          },
          operationId: `notification_names_${String(index)}`,
        });
        expect(result.success, JSON.stringify(result)).toBe(true);
        if (!result.success)
          throw new Error("Expected exact public S3 permission preparation.");
        architecture = result.preview.document;
      }
      if (state !== "edge-only-collision") {
        const first = node(
          "notification",
          "aws.s3.bucket-notification-configuration",
          {
            notificationName: {
              kind: "string",
              value:
                state === "owned-edge-collision"
                  ? "EventConnectionPermission"
                  : "shared-name",
            },
            filterPrefix: { kind: "string", value: "incoming/" },
            filterSuffix: { kind: "string", value: ".jpg" },
          },
        );
        architecture = {
          ...architecture,
          nodes: [...architecture.nodes, first],
          edges: [
            ...architecture.edges,
            ruleEdge(
              "first_owner",
              "aws.s3.bucket-owns-notification-configuration",
              "notification",
              "bucket",
            ),
          ],
        };
        if (state !== "owned-edge-collision") {
          const second = node(
            "other_notification",
            "aws.s3.bucket-notification-configuration",
            {
              notificationName: {
                kind: "string",
                value:
                  state === "distinct-names" ? "different-name" : "shared-name",
              },
              filterPrefix: { kind: "string", value: "outgoing/" },
              filterSuffix: { kind: "string", value: ".jpg" },
            },
          );
          architecture = {
            ...architecture,
            nodes: [...architecture.nodes, second],
            edges: [
              ...architecture.edges,
              ruleEdge(
                "second_owner",
                "aws.s3.bucket-owns-notification-configuration",
                "other_notification",
                state === "different-buckets" ? "other_bucket" : "bucket",
              ),
            ],
          };
        }
      }
      const validate = () =>
        executeArchitectureValidationRules(
          {
            document: architecture,
            target: "compilation",
            environment: "production",
          },
          [createEventDeliveryRuleV1(awsCatalogArtifactV1)],
        );
      const report = validate();
      expect(validate()).toEqual(report);
      const conflicts = report.findings.filter(
        (f) => f.code === "aws.validation.s3-notification-name-conflict",
      );
      const rejected =
        state !== "distinct-names" && state !== "different-buckets";
      expect(conflicts.length > 0).toBe(rejected);
      for (const conflict of conflicts) {
        expect(conflict.severity).toBe(
          state === "edge-only-collision" ? "warning" : "error",
        );
        expect(
          conflict.affected.some((location) => location.kind === "edge"),
        ).toBe(true);
        expect(conflict.autoFix).toBeUndefined();
      }
    }
  });

  it("requires owned redrive settings and their explicit DLQ edge to agree", () => {
    for (const state of ["matching", "conflicting", "standalone"] as const) {
      const architecture = document(
        [
          node("source", "aws.sqs.queue"),
          node("dlq", "aws.sqs.queue"),
          node("redrive", "aws.sqs.redrive-configuration", {
            maximumReceiveCount: {
              kind: "integer",
              value: state === "conflicting" ? 10 : 5,
            },
          }),
        ],
        [
          ruleEdge(
            "redrive_owner",
            "aws.sqs.queue-owns-redrive-configuration",
            "redrive",
            "source",
          ),
          ...(state === "standalone"
            ? []
            : [
                ruleEdge(
                  "destination",
                  "aws.sqs.queue-uses-dead-letter-queue",
                  "source",
                  "dlq",
                  { maximumReceiveCount: { kind: "integer", value: 5 } },
                ),
              ]),
        ],
      );
      const validate = () =>
        executeArchitectureValidationRules(
          {
            document: architecture,
            target: "compilation",
            environment: "production",
          },
          [createEventDeliveryRuleV1(awsCatalogArtifactV1)],
        );
      const report = validate();
      expect(validate()).toEqual(report);
      const invalid = report.findings.filter(
        (f) => f.code === "aws.validation.sqs-owned-redrive-unrepresented",
      );
      expect(invalid).toHaveLength(state === "matching" ? 0 : 1);
      if (state !== "matching") {
        expect(invalid[0]?.severity).toBe("error");
        expect(invalid[0]?.affected).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "node", nodeId: "redrive" }),
          ]),
        );
        expect(invalid[0]?.autoFix).toBeUndefined();
      }
    }
  });

  it("refuses filter-key intent without typed values before export while preserving empty filters", () => {
    for (const kind of ["eventbridge", "sns-attributes", "sns-body"] as const) {
      for (const filtered of [false, true]) {
        const service =
          kind === "eventbridge"
            ? "aws.eventbridge.rule"
            : "aws.sns.subscription";
        const architecture = document(
          [
            node("filtered", service, {
              filterKeys: {
                kind: "string-list",
                value: filtered ? ["tenantId"] : [],
              },
              ...(kind === "eventbridge"
                ? {}
                : {
                    filterScope: {
                      kind: "string",
                      value: !filtered
                        ? "NONE"
                        : kind === "sns-body"
                          ? "MESSAGE_BODY"
                          : "MESSAGE_ATTRIBUTES",
                    },
                  }),
            }),
          ],
          [],
        );
        const report = executeArchitectureValidationRules(
          {
            document: architecture,
            target: "compilation",
            environment: "production",
          },
          [createEventDeliveryRuleV1(awsCatalogArtifactV1)],
        );
        const invalid = report.findings.filter(
          (f) => f.code === "aws.validation.event-filter-unrepresentable",
        );
        expect(invalid).toHaveLength(filtered ? 1 : 0);
        if (filtered) {
          expect(invalid[0]?.severity).toBe("error");
          expect(invalid[0]?.affected).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: "configuration",
                owner: { kind: "node", nodeId: "filtered" },
                key: "filterKeys",
              }),
            ]),
          );
          expect(invalid[0]?.autoFix).toBeUndefined();
        }
      }
    }
  });

  it("covers every curated FIFO, subscription, target, retry, and timeout incompatibility", () => {
    const lambda = node("validation_lambda", "aws.lambda.function", {
      timeoutSeconds: { kind: "integer", value: 30 },
    });
    const standardNamedFifo = node("bad_standard", "aws.sqs.queue", {
      queueName: { kind: "string", value: "bad-standard.fifo" },
      contentBasedDeduplication: { kind: "boolean", value: true },
    });
    const fifoQueue = node("fifo_queue", "aws.sqs.queue", {
      queueName: { kind: "string", value: "ordered.fifo" },
      queueType: { kind: "string", value: "FIFO" },
      visibilityTimeoutSeconds: { kind: "integer", value: 30 },
    });
    const fifoTopic = node("fifo_topic", "aws.sns.topic", {
      topicName: { kind: "string", value: "ordered.fifo" },
      topicType: { kind: "string", value: "FIFO" },
    });
    const subscription = node("subscription", "aws.sns.subscription", {
      protocol: { kind: "string", value: "LAMBDA" },
      rawMessageDelivery: { kind: "boolean", value: true },
      filterScope: { kind: "string", value: "MESSAGE_BODY" },
      filterKeys: { kind: "string-list", value: [] },
    });
    const standardQueue = node("standard_queue", "aws.sqs.queue");
    const stateMachine = node(
      "state_machine",
      "aws.stepfunctions.state-machine",
    );
    const invalidTarget = node("invalid_target", "aws.eventbridge.target", {
      targetType: { kind: "string", value: "STEP_FUNCTIONS" },
      deadLetterMode: { kind: "string", value: "SQS" },
    });
    const noRecoveryTarget = node(
      "no_recovery_target",
      "aws.eventbridge.target",
      {
        maximumRetryAttempts: { kind: "integer", value: 0 },
      },
    );
    const fifoSqsTarget = node("fifo_sqs_target", "aws.eventbridge.target", {
      targetType: { kind: "string", value: "SQS" },
    });
    const fifoDlqTarget = node("fifo_dlq_target", "aws.eventbridge.target", {
      deadLetterMode: { kind: "string", value: "SQS" },
    });

    const codes = allEventFindingCodes(
      document(
        [
          lambda,
          standardNamedFifo,
          fifoQueue,
          fifoTopic,
          subscription,
          standardQueue,
          stateMachine,
          invalidTarget,
          noRecoveryTarget,
          fifoSqsTarget,
          fifoDlqTarget,
        ],
        [
          ruleEdge(
            "topic_owns_subscription",
            "aws.sns.topic-owns-subscription",
            "fifo_topic",
            "subscription",
          ),
          ruleEdge(
            "subscription_wrong_target",
            "aws.sns.subscription-sends-to-sqs",
            "subscription",
            "standard_queue",
          ),
          ruleEdge(
            "lambda_fifo_queue",
            "aws.lambda.sends-message-to-sqs",
            "validation_lambda",
            "fifo_queue",
          ),
          ruleEdge(
            "fifo_queue_lambda",
            "aws.sqs.queue-triggers-lambda",
            "fifo_queue",
            "validation_lambda",
          ),
          ruleEdge(
            "lambda_fifo_topic",
            "aws.lambda.publishes-to-sns",
            "validation_lambda",
            "fifo_topic",
          ),
          ruleEdge(
            "lambda_fifo_dlq",
            "aws.lambda.uses-sqs-dead-letter-queue",
            "validation_lambda",
            "fifo_queue",
          ),
          ruleEdge(
            "invalid_target_state_machine",
            "aws.eventbridge.target-starts-state-machine",
            "invalid_target",
            "state_machine",
          ),
          ruleEdge(
            "invalid_target_lambda",
            "aws.eventbridge.target-invokes-lambda",
            "invalid_target",
            "validation_lambda",
          ),
          ruleEdge(
            "no_recovery_lambda",
            "aws.eventbridge.target-invokes-lambda",
            "no_recovery_target",
            "validation_lambda",
          ),
          ruleEdge(
            "fifo_primary_queue",
            "aws.eventbridge.target-sends-to-sqs",
            "fifo_sqs_target",
            "fifo_queue",
          ),
          ruleEdge(
            "fifo_dlq_primary",
            "aws.eventbridge.target-invokes-lambda",
            "fifo_dlq_target",
            "validation_lambda",
          ),
          ruleEdge(
            "fifo_dlq",
            "aws.eventbridge.target-uses-dead-letter-queue",
            "fifo_dlq_target",
            "fifo_queue",
          ),
          ruleEdge(
            "workflow_timeout",
            "aws.stepfunctions.state-machine-invokes-lambda",
            "state_machine",
            "validation_lambda",
            {
              taskTimeoutSeconds: { kind: "integer", value: 30 },
              retryMode: { kind: "string", value: "NONE" },
              maximumAttempts: { kind: "integer", value: 3 },
            },
          ),
        ],
      ),
    );

    for (const code of [
      "aws.validation.event-fifo-name-mismatch",
      "aws.validation.event-deduplication-requires-fifo",
      "aws.validation.sns-filter-scope-mismatch",
      "aws.validation.sns-raw-delivery-requires-sqs",
      "aws.validation.sns-subscription-protocol-target-mismatch",
      "aws.validation.sns-fifo-lambda-unsupported",
      "aws.validation.eventbridge-target-type-mismatch",
      "aws.validation.eventbridge-execution-role-mismatch",
      "aws.validation.eventbridge-fifo-sqs-target-unsupported",
      "aws.validation.eventbridge-dead-letter-policy-mismatch",
      "aws.validation.eventbridge-dead-letter-fifo-unsupported",
      "aws.validation.eventbridge-no-retry-or-dlq",
      "aws.validation.sqs-producer-ordering-mismatch",
      "aws.validation.sns-producer-ordering-mismatch",
      "aws.validation.lambda-dead-letter-fifo-unsupported",
      "aws.validation.sqs-visibility-timeout-conflict",
      "aws.validation.step-functions-retry-timeout-conflict",
    ]) {
      expect(codes, code).toContain(code);
    }
    const timeoutOnlyEdge = ruleEdge(
      "workflow_timeout_only",
      "aws.stepfunctions.state-machine-invokes-lambda",
      "state_machine",
      "validation_lambda",
      {
        taskTimeoutSeconds: { kind: "integer", value: 30 },
        retryMode: { kind: "string", value: "BOUNDED_EXPONENTIAL" },
        maximumAttempts: { kind: "integer", value: 3 },
      },
    );
    // Direct rule input bypasses the catalog enum to isolate its timeout guard.
    expect(
      findingCodes(
        createEventDeliveryRuleV1(awsCatalogArtifactV1),
        document(
          [stateMachine, lambda],
          [
            {
              ...timeoutOnlyEdge,
              semantic: {
                ...timeoutOnlyEdge.semantic,
                configuration: {
                  ...timeoutOnlyEdge.semantic.configuration,
                  values: Object.assign(
                    {},
                    timeoutOnlyEdge.semantic.configuration.values,
                    { taskTimeoutSeconds: { kind: "integer", value: 29 } },
                  ),
                },
              },
            },
          ],
        ),
      ),
    ).toContain("aws.validation.step-functions-retry-timeout-conflict");
  });

  it("rejects dead-letter cycles and native S3 delivery to a custom EventBridge bus", () => {
    const queueA = node("queue_a", "aws.sqs.queue");
    const queueB = node("queue_b", "aws.sqs.queue");
    const bucket = node("event_bucket", "aws.s3.bucket");
    const customBus = node("custom_bus", "aws.eventbridge.event-bus");
    const codes = allEventFindingCodes(
      document(
        [queueA, queueB, bucket, customBus],
        [
          ruleEdge(
            "queue_a_dlq",
            "aws.sqs.queue-uses-dead-letter-queue",
            "queue_a",
            "queue_b",
          ),
          ruleEdge(
            "queue_b_dlq",
            "aws.sqs.queue-uses-dead-letter-queue",
            "queue_b",
            "queue_a",
          ),
          ruleEdge(
            "s3_custom_bus",
            "aws.s3.bucket-sends-events-to-eventbridge",
            "event_bucket",
            "custom_bus",
          ),
        ],
      ),
    );
    expect(codes).toContain("aws.validation.sqs-dead-letter-cycle");
    expect(codes).toContain(
      "aws.validation.s3-eventbridge-default-bus-required",
    );
  });

  it("requires exclusive primary destinations and the exact conditional EventBridge role", () => {
    const lambda = node("exclusive_lambda", "aws.lambda.function");
    const queue = node("exclusive_queue", "aws.sqs.queue");
    const topic = node("exclusive_topic", "aws.sns.topic");
    const subscription = node("exclusive_subscription", "aws.sns.subscription");
    const target = node("exclusive_target", "aws.eventbridge.target");
    const role = node("eventbridge_role", "aws.iam.role");
    const ambiguousCodes = allEventFindingCodes(
      document(
        [lambda, queue, topic, subscription, target, role],
        [
          ruleEdge(
            "owns_subscription",
            "aws.sns.topic-owns-subscription",
            "exclusive_topic",
            "exclusive_subscription",
          ),
          ruleEdge(
            "subscription_lambda",
            "aws.sns.subscription-invokes-lambda",
            "exclusive_subscription",
            "exclusive_lambda",
          ),
          ruleEdge(
            "subscription_queue",
            "aws.sns.subscription-sends-to-sqs",
            "exclusive_subscription",
            "exclusive_queue",
          ),
          ruleEdge(
            "target_lambda",
            "aws.eventbridge.target-invokes-lambda",
            "exclusive_target",
            "exclusive_lambda",
          ),
          ruleEdge(
            "target_queue",
            "aws.eventbridge.target-sends-to-sqs",
            "exclusive_target",
            "exclusive_queue",
          ),
          ruleEdge(
            "unexpected_role",
            "aws.iam.role-assumed-by-eventbridge-target",
            "eventbridge_role",
            "exclusive_target",
          ),
        ],
      ),
    );
    expect(ambiguousCodes).toContain(
      "aws.validation.sns-subscription-protocol-target-mismatch",
    );
    expect(ambiguousCodes).toContain(
      "aws.validation.eventbridge-target-type-mismatch",
    );
    expect(ambiguousCodes).toContain(
      "aws.validation.eventbridge-execution-role-mismatch",
    );

    const stateMachine = node(
      "valid_state_machine",
      "aws.stepfunctions.state-machine",
    );
    const stateTarget = node("valid_state_target", "aws.eventbridge.target", {
      targetType: { kind: "string", value: "STEP_FUNCTIONS" },
    });
    const validCodes = allEventFindingCodes(
      document(
        [stateMachine, stateTarget, role],
        [
          ruleEdge(
            "valid_state_destination",
            "aws.eventbridge.target-starts-state-machine",
            "valid_state_target",
            "valid_state_machine",
          ),
          ruleEdge(
            "valid_state_role",
            "aws.iam.role-assumed-by-eventbridge-target",
            "eventbridge_role",
            "valid_state_target",
          ),
        ],
      ),
    );
    expect(validCodes).not.toContain(
      "aws.validation.eventbridge-execution-role-mismatch",
    );
    expect(validCodes).not.toContain(
      "aws.validation.eventbridge-target-type-mismatch",
    );
  });
});

describe("event connection permission materialization", () => {
  const recipes = awsCatalogV1
    .listConnectionRules()
    .filter(
      (rule) =>
        awsEventDrivenConnectionRulesV1.some(
          (eventRule) => eventRule.id === rule.id,
        ) &&
        rule.iamEffects.length > 0 &&
        ![
          "aws.iam.role-assumed-by-lambda",
          "aws.apigateway.http-api-invokes-lambda",
          "aws.lambda.reads-dynamodb-table",
          "aws.lambda.writes-dynamodb-table",
          "aws.lambda.writes-log-group",
        ].includes(rule.id),
    );
  function fixture(rule: (typeof recipes)[number], includeRole = true) {
    const source = node(
        "event_source",
        rule.source.serviceId,
        rule.relationshipType === "aws.eventbridge.target-publishes-to-sns"
          ? { targetType: { kind: "string", value: "SNS" } }
          : {},
      ),
      target = node("event_target", rule.target.serviceId);
    const nodes = [source, target];
    const edges: TestEdge[] = [];
    if (rule.source.serviceId === "aws.sns.subscription") {
      nodes.push(node("owner_topic", "aws.sns.topic"));
      edges.push(
        ruleEdge(
          "owns_subscription",
          "aws.sns.topic-owns-subscription",
          "owner_topic",
          source.id,
        ),
      );
    }
    if (rule.source.serviceId === "aws.eventbridge.target") {
      nodes.push(node("owner_rule", "aws.eventbridge.rule"));
      edges.push(
        ruleEdge(
          "owns_target",
          "aws.eventbridge.rule-owns-target",
          "owner_rule",
          source.id,
        ),
      );
    }
    if (
      rule.source.serviceId !== "aws.iam.role" &&
      rule.iamEffects[0]?.principal === undefined &&
      includeRole
    ) {
      const workload =
        rule.source.serviceId === "aws.sqs.queue" ? target : source;
      const roleRule =
        workload.semantic.serviceType === "aws.stepfunctions.state-machine"
          ? "aws.iam.role-assumed-by-step-functions"
          : workload.semantic.serviceType === "aws.eventbridge.target"
            ? "aws.iam.role-assumed-by-eventbridge-target"
            : "aws.iam.role-assumed-by-lambda";
      nodes.push(node("execution_role", "aws.iam.role"));
      edges.push(
        ruleEdge(
          "execution_attachment",
          roleRule,
          "execution_role",
          workload.id,
        ),
      );
    }
    return parseArchitectureDocument(document(nodes, edges));
  }
  for (const rule of recipes)
    it(
      rule.id +
        (rule.relationshipType === "aws.eventbridge.target-publishes-to-sns"
          ? " rejects the unsupported SNS encryption contract without changes"
          : " creates exact generated policy and undoes atomically"),
      () => {
        const before = fixture(rule);
        const request = {
          document: before,
          operationId: "event_permission_test",
          ruleId: rule.id,
          configuration: {},
          source: { nodeId: "event_source", portId: rule.source.portId },
          target: { nodeId: "event_target", portId: rule.target.portId },
        };
        const result = awsConnectionResolverV1.resolve(request);
        if (
          rule.relationshipType === "aws.eventbridge.target-publishes-to-sns"
        ) {
          expect.soft(result).toMatchObject({
            success: false,
            findings: [
              expect.objectContaining({
                severity: "error",
              }),
            ],
          });
          expect
            .soft(
              result.findings.some((f) =>
                f.guidedMessage.includes("AWS-managed KMS"),
              ),
            )
            .toBe(true);
          expect(awsConnectionResolverV1.resolve(request)).toEqual(result);
          expect(before).toEqual(fixture(rule));
          const invalid = {
            ...before,
            edges: [
              ...before.edges,
              ruleEdge(
                "unsupported_sns",
                rule.id,
                "event_source",
                "event_target",
              ),
            ],
          };
          const report = executeArchitectureValidationRules(
            {
              document: invalid,
              target: "compilation",
              environment: "production",
            },
            [createEventDeliveryRuleV1(awsCatalogArtifactV1)],
          );
          const finding = report.findings.find(
            (f) =>
              f.code ===
              "aws.validation.eventbridge-sns-encryption-unsupported",
          );
          expect(finding?.severity).toBe("error");
          expect(finding?.affected).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: "edge",
                edgeId: "unsupported_sns",
              }),
            ]),
          );
          return;
        }
        expect(result.success, JSON.stringify(result)).toBe(true);
        if (!result.success) return;
        expect(awsConnectionResolverV1.resolve(request)).toEqual(result);
        const applied = applyGraphCommand(before, result.batch);
        const generated = applied.document.nodes.filter(
          (n) => n.semantic.lifecycle.ownership === "generated",
        );
        expect(generated).toHaveLength(2);
        const effect = rule.iamEffects[0];
        if (!effect) throw new Error("Expected permission recipe.");
        const statement = generated.find(
          (n) => n.semantic.serviceType === "aws.iam.policy-statement",
        );
        if (!statement) throw new Error("Expected generated statement.");
        const values = statement.semantic.configuration.values as Record<
          string,
          unknown
        >;
        expect(values["actions"]).toEqual({
          kind: "string-list",
          value: effect.actions,
        });
        expect(values["principals"]).toEqual({
          kind: "string-list",
          value: effect.principal ? [effect.principal] : [],
        });
        expect(values["resourceExpressions"]).toEqual({
          kind: "string-list",
          value: [],
        });
        if (effect.principal === undefined)
          expect(values["resourceNode"]).toMatchObject({
            kind: "node-reference",
            nodeId:
              effect.resourceScope === "source-node"
                ? "event_source"
                : "event_target",
          });
        const policy = generated.find(
          (n) => n.semantic.serviceType === "aws.iam.policy-document",
        );
        if (!policy) throw new Error("Expected generated policy.");
        expect(policy.semantic.parent?.nodeId).toBe(
          effect.effect === "trust"
            ? "event_source"
            : effect.principal
              ? "event_target"
              : "execution_role",
        );
        expect(applied.inversion.kind).toBe("available");
        if (applied.inversion.kind === "available")
          expect(
            applyGraphCommand(applied.document, applied.inversion.command)
              .document,
          ).toEqual(before);
      },
    );
  for (const rule of recipes.filter(
    (r) =>
      r.iamEffects[0]?.principal === undefined &&
      ![
        "aws.lambda.publishes-to-sns",
        "aws.lambda.puts-events-on-eventbridge",
        "aws.lambda.starts-step-functions-state-machine",
        "aws.lambda.uses-sqs-dead-letter-queue",
      ].includes(r.id),
  ))
    it(rule.id + " rejects a missing execution role without changes", () => {
      const before = fixture(rule, false);
      const snapshot = JSON.stringify(before);
      const result = awsConnectionResolverV1.resolve({
        document: before,
        operationId: "missing_role",
        ruleId: rule.id,
        configuration: {},
        source: { nodeId: "event_source", portId: rule.source.portId },
        target: { nodeId: "event_target", portId: rule.target.portId },
      });
      expect(result).toMatchObject({
        success: false,
        findings: [
          expect.objectContaining({
            code: "aws.eventing.finding.permission-prerequisite",
            guidedMessage:
              "Connect exactly one execution role to the workload before adding this permission.",
          }),
        ],
      });
      expect(JSON.stringify(before)).toBe(snapshot);
    });
  it("rejects an ambiguous role and a missing SNS owner", () => {
    for (const ruleId of [
      "aws.lambda.sends-message-to-sqs",
      "aws.sns.subscription-invokes-lambda",
    ]) {
      const rule = awsCatalogV1.getConnectionRule(ruleId);
      if (!rule) throw new Error("Expected event rule.");
      let before = fixture(rule);
      const first = before.edges[0];
      if (!first) throw new Error("Expected initial edge.");
      before = ruleId.startsWith("aws.lambda")
        ? {
            ...before,
            edges: [
              ...before.edges,
              { ...first, id: "duplicate_role" as TestEdge["id"] },
            ],
          }
        : { ...before, edges: [] };
      const result = awsConnectionResolverV1.resolve({
        document: before,
        operationId: "ambiguous_owner",
        ruleId,
        configuration: {},
        source: { nodeId: "event_source", portId: rule.source.portId },
        target: { nodeId: "event_target", portId: rule.target.portId },
      });
      expect(result).toMatchObject({
        success: false,
        findings: [
          expect.objectContaining({
            code: "aws.eventing.finding.permission-prerequisite",
            guidedMessage: ruleId.startsWith("aws.lambda")
              ? "Connect exactly one execution role to the workload before adding this permission."
              : "Connect exactly one owning topic or EventBridge rule before adding this delivery.",
          }),
        ],
      });
    }
  });
});
