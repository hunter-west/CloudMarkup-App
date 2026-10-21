import type { CreateValidationRunV1 } from "@cloudmarkup/api-contract";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogV1,
} from "@cloudmarkup/provider-aws/catalog";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { createInitialArchitectureDocument } from "../../application/architecture-document-storage.js";
import { ApplicationError } from "../../application/errors.js";
import { evaluateHostedAwsValidation } from "./hosted-validation.js";

const input: CreateValidationRunV1 = {
  contractVersion: 1,
  environment: "production",
  input: { kind: "draft", draftId: "draft_evaluator", draftVersion: 1 },
  target: "draft",
};

function documentFixture(
  nodes: readonly unknown[] = [],
  edges: readonly unknown[] = [],
) {
  const base = createInitialArchitectureDocument({
    blank: true,
    infrastructureOnly: true,
    identity: {
      architectureId: "architecture_evaluator",
      documentId: "document_evaluator",
      draftId: "draft_evaluator",
      principalId: "principal_evaluator",
      revisionId: "revision_evaluator",
    },
  });
  return parseArchitectureDocument({
    ...base,
    provider: { id: awsCatalogV1.artifact.provider.id, region: "us-east-1" },
    catalog: {
      id: awsCatalogV1.artifact.catalog.id,
      version: awsCatalogV1.artifact.catalog.version,
      digest: AWS_CATALOG_DIGEST_V1,
    },
    nodes,
    edges,
  });
}

function nodeFixture(id: string, serviceId: string) {
  const service = awsCatalogV1.requireService(serviceId);
  const defaults = awsCatalogV1.validateConfiguration(serviceId, {});
  if (!defaults.success)
    throw new Error(`Fixture service requires values: ${serviceId}`);
  return {
    id,
    semantic: {
      serviceType: service.id,
      resourceType:
        service.nodeKind.kind === "resource"
          ? service.nodeKind.resourceType
          : service.nodeKind.boundaryType,
      deploymentKey: id,
      configuration: {
        schemaId: service.configuration.schemaId,
        schemaVersion: service.configuration.schemaVersion,
        values: defaults.values,
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
    presentation: { label: service.displayName, position: { x: 0, y: 0 } },
  };
}

function relationshipFixture(ruleId: string, index = 0) {
  const rule = awsCatalogV1.getConnectionRule(ruleId);
  if (rule === undefined) throw new Error(`Fixture rule is missing: ${ruleId}`);
  const defaults = validateProviderConfigurationV1(rule.configuration, {});
  if (!defaults.success)
    throw new Error(`Fixture relationship requires values: ${ruleId}`);
  const source = nodeFixture(
    `node_source_${String(index)}`,
    rule.source.serviceId,
  );
  const target = nodeFixture(
    `node_target_${String(index)}`,
    rule.target.serviceId,
  );
  return {
    nodes: [source, target],
    edge: {
      id: `edge_relationship_${String(index)}`,
      semantic: {
        source: { nodeId: source.id, port: rule.source.portId },
        target: { nodeId: target.id, port: rule.target.portId },
        relationshipType: rule.relationshipType,
        configuration: {
          schemaId: rule.configuration.schemaId,
          schemaVersion: rule.configuration.schemaVersion,
          values: defaults.values,
        },
        lifecycle: { ownership: "user", origin: "user" },
      },
    },
  };
}

function expectInvalid(document: ReturnType<typeof documentFixture>) {
  expect(() => evaluateHostedAwsValidation(document, input)).toThrow(
    ApplicationError,
  );
  expect(() => evaluateHostedAwsValidation(document, input)).toThrow(
    expect.objectContaining({ code: "invalid_request", status: 400 }),
  );
}

describe("hosted AWS catalog evaluator", () => {
  it("reports a real warning for a schema-valid table without point-in-time recovery without mutating the source", () => {
    const node = nodeFixture("node_table", "aws.dynamodb.table");
    const values = {
      ...node.semantic.configuration.values,
      pointInTimeRecoveryEnabled: { kind: "boolean", value: false },
    };
    const document = documentFixture([
      {
        ...node,
        semantic: {
          ...node.semantic,
          configuration: { ...node.semantic.configuration, values },
        },
      },
    ]);
    const before = JSON.stringify(document);
    const report = evaluateHostedAwsValidation(document, input);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "aws.validation.dynamodb-recovery-not-enabled",
          severity: "warning",
        }),
      ]),
    );
    expect(JSON.stringify(document)).toBe(before);
    expect(evaluateHostedAwsValidation(document, input)).toEqual(report);
  });

  // The shared test-fixtures public export contains only generic v1/v2 document paths.
  // Exercise the reviewed template relationship families using public catalog descriptors.
  it.each([
    {
      family: "image upload",
      rules: [
        "aws.s3.bucket-notifies-lambda",
        "aws.lambda.writes-dynamodb-table",
        "aws.iam.role-assumed-by-lambda",
        "aws.lambda.writes-log-group",
      ],
    },
    {
      family: "scheduled workflow",
      rules: [
        "aws.eventbridge.event-bus-associates-rule",
        "aws.eventbridge.rule-owns-target",
        "aws.eventbridge.target-starts-state-machine",
        "aws.iam.role-assumed-by-eventbridge-target",
        "aws.iam.role-assumed-by-step-functions",
        "aws.stepfunctions.state-machine-invokes-lambda",
        "aws.iam.role-assumed-by-lambda",
        "aws.lambda.writes-log-group",
      ],
    },
    {
      family: "SNS fan-out",
      rules: [
        "aws.sns.topic-owns-subscription",
        "aws.sns.subscription-sends-to-sqs",
        "aws.sqs.queue-triggers-lambda",
        "aws.sqs.queue-uses-dead-letter-queue",
        "aws.iam.role-assumed-by-lambda",
        "aws.lambda.writes-log-group",
      ],
    },
    {
      family: "queue consumer with DLQ",
      rules: [
        "aws.sqs.queue-triggers-lambda",
        "aws.sqs.queue-uses-dead-letter-queue",
        "aws.iam.role-assumed-by-lambda",
        "aws.lambda.writes-log-group",
      ],
    },
  ])(
    "evaluates the exact known resource/schema bindings in the $family family",
    ({ rules }) => {
      const fixtures = rules.map((rule, index) =>
        relationshipFixture(rule, index),
      );
      const document = documentFixture(
        fixtures.flatMap((fixture) => fixture.nodes),
        fixtures.map((fixture) => fixture.edge),
      );
      expect(() => evaluateHostedAwsValidation(document, input)).not.toThrow();
    },
  );

  it.each([
    ["provider", { provider: { id: "example.cloud", region: "us-east-1" } }],
    [
      "catalog ID",
      { catalog: { ...documentFixture().catalog, id: "aws.unknown.catalog" } },
    ],
    [
      "catalog version",
      { catalog: { ...documentFixture().catalog, version: "0.0.1" } },
    ],
    [
      "catalog digest",
      {
        catalog: {
          ...documentFixture().catalog,
          digest: `sha256:${"0".repeat(64)}`,
        },
      },
    ],
  ])("rejects an unsupported %s binding", (_label, overrides) => {
    expectInvalid(
      parseArchitectureDocument({ ...documentFixture(), ...overrides }),
    );
  });

  it.each([
    ["unknown service", { serviceType: "aws.unsupported.resource" }],
    ["resource type mismatch", { resourceType: "aws.sqs.queue" }],
    [
      "configuration schema ID",
      {
        configuration: {
          ...nodeFixture("node_table", "aws.dynamodb.table").semantic
            .configuration,
          schemaId: "aws.unreviewed.configuration",
        },
      },
    ],
    [
      "configuration schema version",
      {
        configuration: {
          ...nodeFixture("node_table", "aws.dynamodb.table").semantic
            .configuration,
          schemaVersion: "9.0.0",
        },
      },
    ],
  ])("rejects a node with %s", (_label, semantic) => {
    const node = nodeFixture("node_table", "aws.dynamodb.table");
    expectInvalid(
      documentFixture([
        { ...node, semantic: { ...node.semantic, ...semantic } },
      ]),
    );
  });

  it.each<{ label: string; overrides: Record<string, ConfigurationValue> }>([
    {
      label: "invalid enum",
      overrides: { billingMode: { kind: "string", value: "UNREVIEWED" } },
    },
    {
      label: "invalid tagged value",
      overrides: {
        pointInTimeRecoveryEnabled: { kind: "string", value: "false" },
      },
    },
    {
      label: "violated constant",
      overrides: {
        serverSideEncryptionEnabled: { kind: "boolean", value: false },
      },
    },
    {
      label: "unknown property",
      overrides: {
        confidentialUnreviewedSetting: {
          kind: "string",
          value: "must-not-appear-in-error",
        },
      },
    },
  ])(
    "rejects a node configuration with $label using a bounded error",
    ({ overrides }) => {
      const node = nodeFixture("node_table", "aws.dynamodb.table");
      const document = documentFixture([
        {
          ...node,
          semantic: {
            ...node.semantic,
            configuration: {
              ...node.semantic.configuration,
              values: { ...node.semantic.configuration.values, ...overrides },
            },
          },
        },
      ]);
      expectInvalid(document);
      expect(() => evaluateHostedAwsValidation(document, input)).toThrow(
        "The document contains an unsupported AWS resource or invalid resource configuration.",
      );
    },
  );

  it.each([
    "relationship type",
    "source port",
    "target port",
    "schema ID",
    "schema version",
    "source service",
  ])("rejects an edge with a mismatched %s", (caseName) => {
    const fixture = relationshipFixture("aws.sqs.queue-triggers-lambda");
    const semantic = fixture.edge.semantic;
    const overrides = {
      ...(caseName === "relationship type"
        ? { relationshipType: "aws.unsupported.relationship" }
        : {}),
      ...(caseName === "source port"
        ? {
            source: {
              ...semantic.source,
              port: "aws.sqs.queue.dead-letter-target",
            },
          }
        : {}),
      ...(caseName === "target port"
        ? {
            target: {
              ...semantic.target,
              port: "aws.lambda.function.synchronous-invocation",
            },
          }
        : {}),
      ...(caseName === "schema ID"
        ? {
            configuration: {
              ...semantic.configuration,
              schemaId: "aws.unreviewed.connection",
            },
          }
        : {}),
      ...(caseName === "schema version"
        ? {
            configuration: {
              ...semantic.configuration,
              schemaVersion: "9.0.0",
            },
          }
        : {}),
    };
    const nodes =
      caseName === "source service"
        ? [nodeFixture("node_source_0", "aws.dynamodb.table"), fixture.nodes[1]]
        : fixture.nodes;
    expectInvalid(
      documentFixture(nodes, [
        { ...fixture.edge, semantic: { ...semantic, ...overrides } },
      ]),
    );
  });

  it.each<{ label: string; overrides: Record<string, ConfigurationValue> }>([
    {
      label: "out-of-enum batch size",
      overrides: { batchSize: { kind: "integer", value: 999 } },
    },
    {
      label: "invalid tagged integer",
      overrides: { batchSize: { kind: "string", value: "10" } },
    },
    {
      label: "violated partial batch constant",
      overrides: { partialBatchResponse: { kind: "boolean", value: false } },
    },
    {
      label: "unknown property",
      overrides: {
        unreviewedAction: { kind: "string", value: "must-not-appear-in-error" },
      },
    },
  ])("rejects a relationship configuration with $label", ({ overrides }) => {
    const fixture = relationshipFixture("aws.sqs.queue-triggers-lambda");
    const semantic = fixture.edge.semantic;
    expectInvalid(
      documentFixture(fixture.nodes, [
        {
          ...fixture.edge,
          semantic: {
            ...semantic,
            configuration: {
              ...semantic.configuration,
              values: { ...semantic.configuration.values, ...overrides },
            },
          },
        },
      ]),
    );
  });
});
