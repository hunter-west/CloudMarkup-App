import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { architectureDocumentV3Schema } from "@cloudmarkup/schemas";
import {
  currentAiCanvasFixture,
  currentAiCanvasIssueFixture,
} from "./ai-canvas-context-test-helpers.js";
import {
  aiCanvasContextSchema,
  projectAiCanvasContext,
} from "./ai-canvas-context.js";
import { betaInfrastructureModelRequest } from "@cloudmarkup/model-gateway";

describe("reviewed AI canvas context", () => {
  const document = currentAiCanvasFixture;
  it("projects actual catalog literals and findings without source or arbitrary settings", () => {
    const input = structuredClone(document());
    const node = input.nodes.find(
      (n) => n.semantic.serviceType === "aws.lambda.function",
    );
    if (!node) throw new Error("Missing Lambda fixture");
    const raw = architectureDocumentV3Schema.parse({
      ...input,
      nodes: input.nodes.map((n) =>
        n.id !== node.id
          ? n
          : {
              ...n,
              semantic: {
                ...n.semantic,
                configuration: {
                  ...n.semantic.configuration,
                  values: {
                    ...n.semantic.configuration.values,
                    password: {
                      kind: "string",
                      value: "synthetic-private-setting",
                    },
                    unknownBusinessData: {
                      kind: "string",
                      value: "must-not-reach-the-model",
                    },
                  },
                },
              },
            },
      ),
    });
    const context = projectAiCanvasContext(raw);
    const projected = context.resources.find((r) => r.nodeId === node.id);
    expect(projected?.configuration).toHaveProperty("runtime", "nodejs24.x");
    expect(projected?.omittedConfigurationKeys).toEqual(
      expect.arrayContaining(["password", "unknownBusinessData"]),
    );
    expect(JSON.stringify(context)).not.toContain("synthetic-private-setting");
    expect(JSON.stringify(context)).not.toContain("must-not-reach-the-model");
    expect(context).not.toHaveProperty("applicationContracts");
    expect(context.validation.status).toBe("complete");
  });
  it("fails closed when the catalog identity changes", () => {
    const input = document();
    expect(() =>
      projectAiCanvasContext({
        ...input,
        catalog: { ...input.catalog, version: "999.0.0" },
      }),
    ).toThrow("catalog");
  });
});

it("admits exact KMS literals and reports missing explicit key policy without inferring an administrator", () => {
  const input = currentAiCanvasFixture();
  const service = awsCatalogV1.requireService("aws.kms.key");
  const defaults = awsCatalogV1.validateConfiguration(service.id, {});
  if (!defaults.success || !input.nodes[0])
    throw new Error("Missing synthetic KMS defaults or presentation fixture");
  const document = architectureDocumentV3Schema.parse({
    ...input,
    nodes: [
      {
        id: "node_kms_foundation",
        semantic: {
          deploymentKey: "kms_foundation",
          serviceType: service.id,
          resourceType: service.id,
          configuration: {
            schemaId: service.configuration.schemaId,
            schemaVersion: service.configuration.schemaVersion,
            values: defaults.values,
          },
          lifecycle: { ownership: "user", origin: "user" },
        },
        presentation: {
          ...input.nodes[0].presentation,
          label: "Synthetic encryption key",
        },
      },
    ],
    edges: [],
    workloadBehavior: { contractVersion: 2, workloads: [] },
    applicationContracts: { ...input.applicationContracts, contracts: [] },
  });
  const context = projectAiCanvasContext(document);
  expect(context.resources).toHaveLength(1);
  expect(context.resources[0]).toMatchObject({
    serviceType: "aws.kms.key",
    editable: true,
    configuration: {
      keySpec: "SYMMETRIC_DEFAULT",
      rotationPeriodDays: 365,
      preventDestroy: true,
    },
  });
  expect(context.validation.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "aws.validation.kms-policy-owner",
        severity: "security-error",
      }),
    ]),
  );
  expect(JSON.stringify(context)).not.toContain("arn:aws:iam");
});

it("keeps existing policy attachments read-only and excludes policy conditions", () => {
  const input = currentAiCanvasFixture();
  const node = input.nodes[0];
  if (!node) throw new Error("Missing node fixture");
  const attachment = awsCatalogV1.requireService(
    "aws.iam.managed-policy-attachment",
  );
  const condition = awsCatalogV1.requireService("aws.iam.policy-condition");
  const document = architectureDocumentV3Schema.parse({
    ...input,
    nodes: [
      {
        ...node,
        id: "node_attachment",
        semantic: {
          ...node.semantic,
          deploymentKey: "attachment",
          serviceType: attachment.id,
          resourceType: attachment.id,
          configuration: {
            schemaId: attachment.configuration.schemaId,
            schemaVersion: attachment.configuration.schemaVersion,
            values: {
              displayName: { kind: "string", value: "Existing policy" },
              attachmentKind: {
                kind: "string",
                value: "managed-policy-attachment",
              },
              managedPolicyReference: {
                kind: "string",
                value: "aws-managed:ReadOnlyAccess",
              },
            },
          },
        },
      },
      {
        ...node,
        id: "node_condition",
        semantic: {
          ...node.semantic,
          deploymentKey: "condition",
          serviceType: condition.id,
          resourceType: condition.id,
          configuration: {
            schemaId: condition.configuration.schemaId,
            schemaVersion: condition.configuration.schemaVersion,
            values: {
              operator: { kind: "string", value: "StringEquals" },
              key: { kind: "string", value: "aws:PrincipalOrgID" },
              values: {
                kind: "string-list",
                value: ["synthetic-policy-detail"],
              },
            },
          },
        },
      },
    ],
  });
  const context = projectAiCanvasContext(document);
  expect(
    context.resources.find((resource) => resource.nodeId === "node_attachment")
      ?.editable,
  ).toBe(false);
  expect(
    context.resources.some((resource) => resource.nodeId === "node_condition"),
  ).toBe(false);
  expect(JSON.stringify(context)).not.toContain("synthetic-policy-detail");
});

it("shares connection literals only for the exact catalog relationship and ports", () => {
  const input = currentAiCanvasFixture();
  const original = input.nodes[0];
  if (!original) throw new Error("Missing node fixture");
  const service = awsCatalogV1.requireService("aws.apigateway.http-api");
  const defaults = awsCatalogV1.validateConfiguration(service.id, {});
  if (!defaults.success) throw new Error("Missing API defaults");
  const rule = awsCatalogV1
    .listConnectionRules()
    .find(
      (r) =>
        r.source.serviceId === service.id &&
        r.target.serviceId === "aws.lambda.function",
    );
  if (!rule) throw new Error("Missing integration rule");
  const make = (sourcePort: string) =>
    architectureDocumentV3Schema.parse({
      ...input,
      nodes: [
        ...input.nodes,
        {
          ...original,
          id: "node_api_context",
          semantic: {
            ...original.semantic,
            serviceType: service.id,
            resourceType: service.id,
            deploymentKey: "context_api",
            configuration: {
              schemaId: service.configuration.schemaId,
              schemaVersion: service.configuration.schemaVersion,
              values: defaults.values,
            },
          },
        },
      ],
      edges: [
        {
          id: "edge_context",
          semantic: {
            source: { nodeId: "node_api_context", port: sourcePort },
            target: { nodeId: original.id, port: rule.target.portId },
            relationshipType: rule.relationshipType,
            configuration: {
              schemaId: rule.configuration.schemaId,
              schemaVersion: rule.configuration.schemaVersion,
              values: {
                routeKey: { kind: "string", value: "GET /context" },
                password: {
                  kind: "string",
                  value: "synthetic-private-setting",
                },
              },
            },
            lifecycle: { ownership: "user", origin: "user" },
          },
        },
      ],
    });
  const allowed = projectAiCanvasContext(make(rule.source.portId))
    .connections[0];
  expect(allowed?.configuration).toEqual({ routeKey: "GET /context" });
  expect(allowed).toMatchObject({
    edgeId: "edge_context",
    sourcePath: "$.edges[0]",
    sourcePort: rule.source.portId,
    targetPort: rule.target.portId,
  });
  expect(allowed?.omittedConfigurationKeys).toEqual(["password"]);
  const mismatched = projectAiCanvasContext(make("unsupported.port"))
    .connections[0];
  expect(mismatched?.configuration).toEqual({});
  expect(mismatched?.omittedConfigurationKeys).toEqual([
    "routeKey",
    "password",
  ]);
});

it.each([
  { family: "lustre", capacity: 3600 },
  { family: "ontap", capacity: 524289 },
])(
  "shares the deterministic $family capacity issue with AI without changing the canvas",
  ({ family, capacity }) => {
    const input = currentAiCanvasFixture();
    const base = input.nodes[0];
    if (!base) throw new Error("Missing synthetic node");
    const service = awsCatalogV1.requireService(
      "aws.fsx." + family + "-file-system",
    );
    const defaults = awsCatalogV1.validateConfiguration(
      service.id,
      family === "ontap"
        ? { throughputCapacity: { kind: "integer", value: 1536 } }
        : {},
    );
    if (!defaults.success) throw new Error("Missing FSx defaults");
    const graph = architectureDocumentV3Schema.parse({
      ...input,
      nodes: [
        {
          ...base,
          id: "node_fsx_capacity",
          semantic: {
            ...base.semantic,
            deploymentKey: "fsx_capacity",
            serviceType: service.id,
            resourceType: service.id,
            configuration: {
              schemaId: service.configuration.schemaId,
              schemaVersion: service.configuration.schemaVersion,
              values: {
                ...defaults.values,
                storageCapacity: { kind: "integer", value: capacity },
              },
            },
          },
        },
      ],
    });
    const before = structuredClone(graph);
    const context = projectAiCanvasContext(graph);
    expect(context.resources[0]?.configuration).toHaveProperty(
      "storageCapacity",
      capacity,
    );
    expect(context.validation.status).toBe("complete");
    expect(context.validation.findings).toContainEqual(
      expect.objectContaining({
        code: "aws.validation.fsx-" + family + "-storage-capacity",
        severity: "error",
        affectedPaths: [
          "$.nodes[0].semantic.configuration.values.storageCapacity",
        ],
      }),
    );
    expect(graph).toEqual(before);
  },
);

it("grounds original finding paths in stable nodes after hidden policies and another same-service queue", () => {
  const document = currentAiCanvasIssueFixture();
  const before = structuredClone(document);
  const context = projectAiCanvasContext(document);
  expect(context.resources.map((r) => r.nodeId)).toEqual([
    "node_other_queue",
    "node_affected_queue",
    document.nodes[3]?.id,
  ]);
  expect(context.resources[1]).toMatchObject({
    nodeId: "node_affected_queue",
    sourcePath: "$.nodes[2]",
  });
  const finding = context.validation.findings.find(
    (f) => f.code === "aws.validation.sqs-visibility-timeout-conflict",
  );
  expect(finding?.affectedEntities).toContainEqual({
    nodeId: "node_affected_queue",
    path: "$.nodes[2].semantic.configuration.values.visibilityTimeoutSeconds",
    validationPath:
      "$.nodes[0].semantic.configuration.values.visibilityTimeoutSeconds",
    included: true,
  });
  const model = betaInfrastructureModelRequest({
    requirements: "Resolve the visibility timeout issue",
    proposalVersion: 5,
    catalog: {},
    existingArchitecture: context,
  });
  const serialized = model.messages?.[0]?.content?.[0]?.text;
  const payload: unknown = JSON.parse(serialized ?? "{}");
  if (
    !payload ||
    typeof payload !== "object" ||
    !("existingArchitecture" in payload)
  )
    throw new Error("Missing serialized context");
  const actual = aiCanvasContextSchema.parse(payload.existingArchitecture);
  expect(actual).toEqual(context);
  expect(actual.connections[0]).toMatchObject({
    edgeId: "edge_affected_trigger",
    sourcePath: "$.edges[0]",
    sourceNodeId: "node_affected_queue",
    configuration: { batchingWindowSeconds: 0 },
  });
  expect(actual.omissions).toMatchObject({
    resources: 1,
    excludedServiceTypes: ["aws.iam.policy-document"],
  });
  expect(document).toEqual(before);
});

it.each(["aws.cognito.user-pool", "aws.cognito.user-pool-client"])(
  "shares typed %s security metadata without allowing credential text or reference values",
  (serviceType) => {
    const input = currentAiCanvasFixture();
    const base = input.nodes[0];
    if (!base) throw new Error("Missing fixture");
    const service = awsCatalogV1.requireService(serviceType);
    const defaults = awsCatalogV1.validateConfiguration(service.id, {});
    if (!defaults.success) throw new Error("Missing defaults");
    const graph = architectureDocumentV3Schema.parse({
      ...input,
      nodes: [
        {
          ...base,
          semantic: {
            ...base.semantic,
            serviceType,
            resourceType: serviceType,
            configuration: {
              schemaId: service.configuration.schemaId,
              schemaVersion: service.configuration.schemaVersion,
              values: defaults.values,
            },
          },
        },
      ],
    });
    const projected = projectAiCanvasContext(graph).resources[0];
    expect(projected?.omittedConfigurationKeys).toEqual([]);
    for (const [key, value] of Object.entries(defaults.values)) {
      if ("value" in value)
        expect(projected?.configuration[key]).toEqual(value.value);
    }
    const key = serviceType.endsWith("client")
      ? "accessTokenValidityMinutes"
      : "passwordMinimumLength";
    const malformed = architectureDocumentV3Schema.parse({
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        semantic: {
          ...node.semantic,
          configuration: {
            ...node.semantic.configuration,
            values: {
              ...node.semantic.configuration.values,
              [key]: {
                kind: "string",
                value: "private-text-must-not-be-shared",
              },
              clientSecret: {
                kind: "string",
                value: "private-credential-must-not-be-shared",
              },
            },
          },
        },
      })),
    });
    const context = projectAiCanvasContext(malformed);
    expect(context.resources[0]?.omittedConfigurationKeys).toEqual(
      expect.arrayContaining([key, "clientSecret"]),
    );
    expect(JSON.stringify(context)).not.toContain(
      "private-text-must-not-be-shared",
    );
    expect(JSON.stringify(context)).not.toContain(
      "private-credential-must-not-be-shared",
    );
  },
);

it("reads historical context snapshots without inventing new grounding metadata", () => {
  const current = projectAiCanvasContext(currentAiCanvasFixture());
  const historical = structuredClone(current);
  delete historical.omissions;
  delete historical.projectionVersion;
  for (const resource of historical.resources) delete resource.sourcePath;
  for (const finding of historical.validation.findings)
    delete finding.affectedEntities;
  expect(aiCanvasContextSchema.parse(historical)).toEqual(historical);
});

it("keeps credential detection and the resource ceiling fail-closed with richer metadata", () => {
  const input = currentAiCanvasFixture();
  const node = input.nodes[0];
  if (!node) throw new Error("Missing fixture");
  expect(() =>
    projectAiCanvasContext({
      ...input,
      nodes: [
        {
          ...node,
          presentation: {
            ...node.presentation,
            label: "password=synthetic-context-marker",
          },
        },
      ],
    }),
  ).toThrow("free of credentials");
  expect(() =>
    projectAiCanvasContext({
      ...input,
      nodes: Array.from({ length: 101 }, (_, i) => ({
        ...node,
        id: `node_limit_${String(i)}`,
        semantic: { ...node.semantic, deploymentKey: `limit_${String(i)}` },
      })),
    }),
  ).toThrow();
});
