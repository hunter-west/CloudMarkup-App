import { describe, expect, it } from "vitest";
import sqsEventTemplate from "@cloudmarkup/provider-aws/testing/sqs-event-template-v1.json" with { type: "json" };

import { awsEditorCatalog } from "./aws-editor-catalog.js";
import {
  isAwsEventTemplateId,
  loadAwsEventTemplateArchitectureDocument,
  type AwsEventTemplateId,
} from "./aws-event-template-fixture.js";

const templateIds: readonly AwsEventTemplateId[] = [
  "image-upload-processing",
  "scheduled-workflow",
  "sns-fan-out-notification",
  "queue-consumer-with-dlq",
];

const expectedWorkloadCounts: Readonly<Record<AwsEventTemplateId, number>> = {
  "image-upload-processing": 1,
  "scheduled-workflow": 1,
  "sns-fan-out-notification": 2,
  "queue-consumer-with-dlq": 1,
};

describe("AWS event template fixtures", () => {
  it("keeps the shared SQS export regression fixture identical to the built-in template", () => {
    expect(
      loadAwsEventTemplateArchitectureDocument("queue-consumer-with-dlq"),
    ).toEqual(sqsEventTemplate);
  });
  it("creates deterministic SQS policies with exact role ownership, least-privilege scope and source-edge provenance", () => {
    const document = loadAwsEventTemplateArchitectureDocument(
      "queue-consumer-with-dlq",
    );
    expect(document).toEqual(
      loadAwsEventTemplateArchitectureDocument("queue-consumer-with-dlq"),
    );
    const statements = document.nodes.filter(
      ({ semantic }) => semantic.resourceType === "aws.iam.policy-statement",
    );
    expect(statements).toHaveLength(3);
    for (const [operationId, generatorId, actions, resourceNode] of [
      [
        "edge_consumer_role",
        "aws.iam.role-assumed-by-lambda",
        ["sts:AssumeRole"],
        undefined,
      ],
      [
        "edge_consumer_logs",
        "aws.lambda.writes-log-group",
        ["logs:CreateLogStream", "logs:PutLogEvents"],
        "node_consumer_logs",
      ],
      [
        "edge_queue_consumer",
        "aws.sqs.queue-triggers-lambda",
        ["sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"],
        "node_work_queue",
      ],
    ] as const) {
      const statement = statements.find(
        ({ semantic }) =>
          semantic.lifecycle.ownership === "generated" &&
          semantic.lifecycle.provenance.operationId === operationId,
      );
      expect(statement?.semantic.configuration.values).toMatchObject({
        actions: { kind: "string-list", value: actions },
        effect: { kind: "string", value: "allow" },
        resourceExpressions: { kind: "string-list", value: [] },
        ...(resourceNode === undefined
          ? {
              principalKind: { kind: "string", value: "service" },
              principals: {
                kind: "string-list",
                value: ["lambda.amazonaws.com"],
              },
            }
          : { resourceNode: { kind: "node-reference", nodeId: resourceNode } }),
      });
      expect(statement?.semantic.lifecycle).toMatchObject({
        ownership: "generated",
        provenance: {
          generatorKind: "connection-rule",
          generatorId,
          generatorVersion: "1.0.0",
          dependentEdgeIds: [operationId + ".edge.connection"],
        },
      });
    }
    expect(
      document.edges.filter(
        ({ semantic }) =>
          [
            "aws.iam.role-owns-trust-policy",
            "aws.iam.role-owns-generated-permission",
          ].includes(semantic.relationshipType) &&
          semantic.target.nodeId === "node_consumer_role",
      ),
    ).toHaveLength(3);
    expect(
      document.workloadBehavior.workloads[0]?.eventBindings[0],
    ).toMatchObject({
      edgeId: "edge_queue_consumer.edge.connection",
    });
  });
  it.each(templateIds)("parses %s against the exact current catalog", (id) => {
    const document = loadAwsEventTemplateArchitectureDocument(id);

    expect(document.catalog.version).toBe("0.30.0");
    expect(document.schemaVersion).toBe(3);
    expect(document.nodes.length).toBeGreaterThan(2);
    expect(document.edges.length).toBeGreaterThan(1);
    expect(document.metadata.source).toBe("template");
    expect(document.assumptions).toHaveLength(1);
    expect(document.assumptions[0]?.origin).toBe("template");
    expect(document.assumptions[0]?.status).toBe("accepted");
    expect(document.assumptions[0]?.statement).toContain("Workload Document");

    const expectedWorkloadCount = expectedWorkloadCounts[id];
    expect(document.workloadBehavior.contractVersion).toBe(2);
    expect(document.workloadBehavior.workloads).toHaveLength(
      expectedWorkloadCount,
    );
    expect(document.applicationContracts.contracts).toHaveLength(
      expectedWorkloadCount * 5,
    );
    expect(document.externalResources.resources).toEqual([]);

    for (const workload of document.workloadBehavior.workloads) {
      if (workload.implementation.mode !== "complete-supported-pattern") {
        throw new TypeError("Curated template workload lost complete support.");
      }
      expect(workload.implementation.supportedPattern).toEqual({
        patternId: "cloudmarkup.pattern.aws-lambda-curated-event-driven",
        patternVersion: "1.0.0",
        digest:
          "sha256:b74c6d0c918d5dd3eac3485cb5004aece78e7dc9a9936f3ecbd85aa012a53686",
      });
      expect(workload.triggerDispatch).toMatchObject({
        mode: "generated-supported",
        dispatcherId: "cloudmarkup.event-trigger-dispatcher",
        dispatcherVersion: "1.0.0",
      });
      expect(workload.eventBindings).toHaveLength(1);
      expect(workload.eventBindings[0]).toMatchObject({ direction: "inbound" });
      expect(workload.idempotency).toEqual([
        expect.objectContaining({ mode: "not-required" }),
      ]);
      expect(workload.extensionPoints).toHaveLength(1);
      expect(workload.sourceOwnership).toContainEqual(
        expect.objectContaining({
          ownership: "user-owned",
          regeneration: "never",
          conflictBehavior: "preserve-user-content",
        }),
      );
      expect(workload.tests).toHaveLength(2);
      expect(
        workload.tests.every(({ requiredForCoverage }) => requiredForCoverage),
      ).toBe(true);
      expect(workload.implementationRequirements).toEqual([]);
      expect(
        workload.environment.some(
          ({ value }) => value.kind === "secret-reference",
        ),
      ).toBe(false);
      expect(workload.compatibility.applicationGenerators).toContainEqual(
        expect.objectContaining({
          generatorId: "cloudmarkup.event-application-generator",
          minimumVersion: "1.0.0",
        }),
      );
      expect(workload.executionAssumptions).toEqual({
        timeout: { kind: "duration", milliseconds: 30_000 },
        retry: { kind: "bounded", maximumAttempts: 5 },
      });
      const owningNode = document.nodes.find(
        ({ id: nodeId }) => nodeId === workload.owningNodeId,
      );
      const timeout = Object.entries(
        owningNode?.semantic.configuration.values ?? {},
      ).find(([key]) => key === "timeoutSeconds")?.[1];
      expect(timeout).toEqual({ kind: "integer", value: 30 });
      expect(
        document.edges.filter(
          ({ semantic }) =>
            semantic.source.nodeId === workload.owningNodeId &&
            semantic.relationshipType === "aws.lambda.writes-log-group",
        ),
      ).toHaveLength(1);
    }

    for (const contract of document.applicationContracts.contracts) {
      if (contract.contractKind === "event-message") {
        expect(contract.delivery).toEqual({
          ordering: "not-guaranteed",
          duplicates: "possible",
          delivery: "at-least-once",
        });
      }
      if (contract.contractKind === "test-case") {
        if (contract.level === "unit") {
          expect(contract.expectations).toEqual([
            expect.objectContaining({ kind: "contract-conformance" }),
          ]);
        } else {
          expect(contract.expectations).toEqual([
            expect.objectContaining({
              kind: "error-category",
              category: "application.validation",
            }),
          ]);
        }
      }
    }
  });

  it("includes the scheduled Lambda task and both durable fan-out consumers", () => {
    const scheduled =
      loadAwsEventTemplateArchitectureDocument("scheduled-workflow");
    expect(
      scheduled.edges.some(
        ({ semantic }) =>
          semantic.relationshipType ===
          "aws.stepfunctions.state-machine-invokes-lambda",
      ),
    ).toBe(true);
    expect(
      scheduled.workloadBehavior.workloads[0]?.operations[0]?.capability,
    ).toBe("cloudmarkup.event.step-functions-task");
    expect(scheduled.workloadBehavior.workloads[0]?.schedules).toEqual([]);
    expect(
      scheduled.edges.find(({ id }) => id === "edge_workflow_task")?.semantic
        .configuration.values,
    ).toMatchObject({
      taskTimeoutSeconds: { kind: "integer", value: 30 },
      maximumAttempts: { kind: "integer", value: 5 },
    });

    const fanOut = loadAwsEventTemplateArchitectureDocument(
      "sns-fan-out-notification",
    );
    expect(fanOut.workloadBehavior.workloads).toHaveLength(2);
    const subscriptions = fanOut.nodes.filter(
      ({ semantic }) => semantic.serviceType === "aws.sns.subscription",
    );
    expect(subscriptions).toHaveLength(2);
    for (const subscription of subscriptions) {
      expect(subscription.semantic.configuration.values).toMatchObject({
        protocol: { kind: "string", value: "SQS" },
        rawMessageDelivery: { kind: "boolean", value: true },
      });
    }
    expect(
      fanOut.edges.filter(
        ({ semantic }) =>
          semantic.relationshipType === "aws.sqs.triggers-lambda",
      ),
    ).toHaveLength(2);
    expect(
      fanOut.edges.filter(
        ({ semantic }) =>
          semantic.relationshipType === "aws.sqs.uses-dead-letter-queue",
      ),
    ).toHaveLength(2);
  });

  it("binds S3 object metadata to the exact DynamoDB string key", () => {
    const document = loadAwsEventTemplateArchitectureDocument(
      "image-upload-processing",
    );
    const table = document.nodes.find(({ id }) => id === "node_image_metadata");
    expect(table?.semantic.configuration.values).toMatchObject({
      partitionKeyName: { kind: "string", value: "key" },
      partitionKeyType: { kind: "string", value: "S" },
    });

    const payload = document.applicationContracts.contracts.find(
      (contract) =>
        contract.contractKind === "data-entity" &&
        contract.semanticName ===
          "application.templates.image-processor.payload",
    );
    if (payload?.contractKind !== "data-entity") {
      throw new TypeError("Image metadata payload contract is missing.");
    }
    expect(payload.fields).toContainEqual(
      expect.objectContaining({
        name: "key",
        fieldType: { kind: "scalar", scalarType: "string" },
        required: true,
      }),
    );
  });

  it("keeps final artifacts build-gated despite generated-code readiness", () => {
    const lambda = awsEditorCatalog.services.find(
      ({ serviceType }) => serviceType === "aws.lambda.function",
    );
    expect(lambda?.targetReadiness).toMatchObject({
      generatedCode: { status: "supported" },
      terraform: { status: "supported" },
      cloudformation: { status: "supported" },
    });

    const document = loadAwsEventTemplateArchitectureDocument(
      "queue-consumer-with-dlq",
    );
    expect(document.externalResources.resources).toEqual([]);
    expect(
      document.workloadBehavior.workloads.some(
        ({ implementation }) => "artifact" in implementation,
      ),
    ).toBe(false);
  });

  it("rejects unreviewed route selectors", () => {
    expect(isAwsEventTemplateId("recursive-s3-experiment")).toBe(false);
  });
});
