import { describe, expect, it } from "vitest";
import {
  getArchitectureDocumentHashes,
  executeArchitectureValidationRules,
  applyGraphCommand,
} from "@cloudmarkup/domain";
import {
  awsValidationRuleRegistrationsV1,
  awsValidationRulesV1,
} from "@cloudmarkup/provider-aws/validation";
import {
  architectureDocumentV3Schema,
  betaInfrastructureProposalV1Schema,
  serviceTypeSchema,
} from "@cloudmarkup/schemas";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { loadBlankAwsEditorArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import { applyPreparedResourceRepair } from "../editor/model/resource-repair-command.js";
import { projectOwnedPolicyConfigurations } from "../editor/model/owned-configuration-policy-model.js";
import { awsOwnedPolicyGraphDescriptors } from "../../provider-catalog/aws-owned-policy-descriptors.js";
import { prepareBetaInfrastructureProposal } from "./beta-infrastructure-proposal.js";
import { prepareConfigurationCommand } from "../editor/model/configuration-command.js";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import { unsupportedBetaInfrastructureIssueRepair } from "./beta-infrastructure-issue.js";
import { prepareBetaInfrastructureProposal as prepareSharedProposal } from "@cloudmarkup/provider-aws/proposals";
const proposal = {
  contractVersion: 1,
  summary: "A minimal authenticated serverless API.",
  resources: [
    {
      key: "handler",
      serviceType: "aws.lambda.function",
      label: "API handler",
      parentKey: null,
    },
    {
      key: "role",
      serviceType: "aws.iam.role",
      label: "Execution role",
      parentKey: null,
    },
    {
      key: "logs",
      serviceType: "aws.cloudwatch.log-group",
      label: "API logs",
      parentKey: null,
    },
    {
      key: "api",
      serviceType: "aws.apigateway.http-api",
      label: "HTTP API",
      parentKey: null,
    },
    {
      key: "pool",
      serviceType: "aws.cognito.user-pool",
      label: "Users",
      parentKey: null,
    },
    {
      key: "client",
      serviceType: "aws.cognito.user-pool-client",
      label: "App client",
      parentKey: "pool",
    },
  ],
  connections: [
    {
      ruleId: "aws.cognito.user-pool-configures-app-client",
      sourceKey: "pool",
      targetKey: "client",
      configuration: {},
    },
    {
      ruleId: "aws.iam.role-assumed-by-lambda",
      sourceKey: "role",
      targetKey: "handler",
      configuration: {},
    },
    {
      ruleId: "aws.lambda.writes-log-group",
      sourceKey: "handler",
      targetKey: "logs",
      configuration: {},
    },
    {
      ruleId: "aws.cognito.user-pool-authorizes-http-api",
      sourceKey: "pool",
      targetKey: "api",
      configuration: {},
    },
    {
      ruleId: "aws.cognito.app-client-authorizes-http-api",
      sourceKey: "client",
      targetKey: "api",
      configuration: {},
    },
    {
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      sourceKey: "api",
      targetKey: "handler",
      configuration: { routeKey: "GET /status", timeoutMilliseconds: 10000 },
    },
  ],
  limitations: [
    "Supply application code before deploying the exported infrastructure.",
  ],
};

it("matches manual Cognito security metadata edits with reversible AI updates", () => {
  const f = fixture();
  const initial = prepareBetaInfrastructureProposal(f);
  const document = applyPreparedResourceRepair(f.document, initial).document;
  const pool = document.nodes.find(
    (n) => n.semantic.serviceType === "aws.cognito.user-pool",
  );
  const client = document.nodes.find(
    (n) => n.semantic.serviceType === "aws.cognito.user-pool-client",
  );
  if (!pool || !client) throw new Error("Missing Cognito nodes");
  const prepared = prepareBetaInfrastructureProposal({
    ...f,
    document,
    proposal: {
      contractVersion: 5,
      summary: "Use the requested identity lifetimes.",
      resources: [],
      connections: [],
      existingResources: [
        { key: "pool", nodeId: pool.id },
        { key: "client", nodeId: client.id },
      ],
      updates: [
        {
          resourceKey: "pool",
          configuration: {
            passwordMinimumLength: 16,
            requirePasswordUppercase: true,
          },
          reason: "Use the reviewed password policy",
        },
        {
          resourceKey: "client",
          configuration: {
            generateClientSecret: false,
            allowRefreshTokenAuth: true,
            accessTokenValidityMinutes: 20,
            refreshTokenValidityDays: 14,
          },
          reason: "Use the reviewed token lifetimes",
        },
      ],
      limitations: [],
      review: {
        intent: "Update identity configuration",
        assumptions: [],
        checks: ["Use catalog bounds"],
        questions: [],
      },
    },
  });
  const applied = applyPreparedResourceRepair(document, prepared);
  let manual = document;
  for (const [node, edits] of [
    [
      pool,
      {
        passwordMinimumLength: { kind: "integer", value: 16 },
        requirePasswordUppercase: { kind: "boolean", value: true },
      },
    ],
    [
      client,
      {
        generateClientSecret: { kind: "boolean", value: false },
        allowRefreshTokenAuth: { kind: "boolean", value: true },
        accessTokenValidityMinutes: { kind: "integer", value: 20 },
        refreshTokenValidityDays: { kind: "integer", value: 14 },
      },
    ],
  ] as const) {
    manual = applyGraphCommand(
      manual,
      prepareConfigurationCommand({
        ...f,
        document: manual,
        target: { kind: "node", id: node.id },
        edits,
      }).command,
    ).document;
  }
  for (const node of [pool, client])
    expect(
      applied.document.nodes.find((n) => n.id === node.id)?.semantic
        .configuration,
    ).toEqual(
      manual.nodes.find((n) => n.id === node.id)?.semantic.configuration,
    );
  expect(applied.document.edges).toEqual(document.edges);
  if (applied.inversion.kind !== "available")
    throw new Error("Missing inverse");
  expect(
    applyGraphCommand(applied.document, applied.inversion.command).document,
  ).toEqual(document);
});

it("rejects a purported selected issue fix that leaves or worsens the same queue conflict", () => {
  const f = fixture();
  const initial = applyPreparedResourceRepair(
    f.document,
    prepareBetaInfrastructureProposal(f),
  ).document;
  const lambda = initial.nodes.find(
    (n) => n.semantic.serviceType === "aws.lambda.function",
  );
  const service = awsCatalogV1.requireService("aws.sqs.queue");
  const defaults = awsCatalogV1.validateConfiguration(service.id, {});
  const rule = awsCatalogV1
    .listConnectionRules()
    .find(
      (r) =>
        r.source.serviceId === service.id &&
        r.target.serviceId === "aws.lambda.function",
    );
  if (!lambda || !defaults.success || !rule) throw new Error("Missing fixture");
  const connection = validateProviderConfigurationV1(rule.configuration, {});
  if (!connection.success) throw new Error("Missing trigger defaults");
  const document = architectureDocumentV3Schema.parse({
    ...initial,
    nodes: [
      ...initial.nodes.map((node) =>
        node.id !== lambda.id
          ? node
          : {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    timeoutSeconds: { kind: "integer", value: 90 },
                  },
                },
              },
            },
      ),
      {
        ...lambda,
        id: "node_selected_queue",
        semantic: {
          ...lambda.semantic,
          deploymentKey: "selected_queue",
          serviceType: service.id,
          resourceType: service.id,
          configuration: {
            schemaId: service.configuration.schemaId,
            schemaVersion: service.configuration.schemaVersion,
            values: {
              ...defaults.values,
              visibilityTimeoutSeconds: { kind: "integer", value: 60 },
            },
          },
        },
      },
    ],
    edges: [
      ...initial.edges,
      {
        id: "edge_selected_trigger",
        semantic: {
          source: { nodeId: "node_selected_queue", port: rule.source.portId },
          target: { nodeId: lambda.id, port: rule.target.portId },
          relationshipType: rule.relationshipType,
          configuration: {
            schemaId: rule.configuration.schemaId,
            schemaVersion: rule.configuration.schemaVersion,
            values: connection.values,
          },
          lifecycle: { ownership: "user", origin: "user" },
        },
      },
    ],
  });
  const selectedIssue = executeArchitectureValidationRules(
    { document, environment: "development", target: "draft" },
    awsValidationRulesV1,
  ).findings.find(
    (finding) =>
      finding.code === "aws.validation.sqs-visibility-timeout-conflict",
  );
  if (!selectedIssue) throw new Error("Missing selected timeout issue");
  expect(
    unsupportedBetaInfrastructureIssueRepair(document, selectedIssue),
  ).toBeNull();
  const edgeOnly = {
    ...selectedIssue,
    affected: selectedIssue.affected.filter(
      (location) =>
        location.kind === "configuration" && location.owner.kind === "edge",
    ),
  };
  expect(
    unsupportedBetaInfrastructureIssueRepair(document, edgeOnly),
  ).toContain("connection editor");
  const policyDocument = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === "node_selected_queue"
        ? {
            ...node,
            semantic: {
              ...node.semantic,
              serviceType: serviceTypeSchema.parse("aws.iam.policy-condition"),
            },
          }
        : node,
    ),
  };
  expect(
    unsupportedBetaInfrastructureIssueRepair(policyDocument, selectedIssue),
  ).toContain("permissions editor");
  const update = (visibilityTimeoutSeconds: number) => ({
    contractVersion: 5,
    summary: "Repair queue visibility",
    resources: [],
    connections: [],
    existingResources: [{ key: "queue", nodeId: "node_selected_queue" }],
    updates: [
      {
        resourceKey: "queue",
        configuration: { visibilityTimeoutSeconds },
        reason: "Resolve the selected conflict",
      },
    ],
    limitations: [],
    review: {
      intent: "Repair visibility",
      assumptions: [],
      checks: ["Compared queue and consumer"],
      questions: [],
    },
  });
  expect(() =>
    prepareBetaInfrastructureProposal({
      ...f,
      document,
      selectedIssue,
      proposal: update(30),
    }),
  ).toThrow("does not resolve the selected issue");
  expect(() =>
    prepareBetaInfrastructureProposal({
      ...f,
      document,
      selectedIssue,
      proposal: update(60),
    }),
  ).toThrow("No configuration values changed");
  const prepared = prepareBetaInfrastructureProposal({
    ...f,
    document,
    selectedIssue,
    proposal: update(120),
  });
  const applied = applyPreparedResourceRepair(document, prepared).document;
  const report = executeArchitectureValidationRules(
    { document: applied, environment: "development", target: "draft" },
    awsValidationRulesV1,
  );
  expect(
    report.findings.some((finding) => finding.code === selectedIssue.code),
  ).toBe(false);
  expect(
    report.findings.some(
      (finding) => finding.code === "aws.validation.lambda-timeout-invalid",
    ),
  ).toBe(true);
});
function fixture() {
  let sequence = 0;
  const document = loadBlankAwsEditorArchitectureDocument("us-east-1");
  return {
    document,
    catalog: awsEditorCatalog,
    proposal,
    createId: () => `operation_beta_test_${String(++sequence)}`,
  };
}
describe("reviewed beta AI diagram command preparation", () => {
  it("connects additions to an existing bucket without duplicating it and materializes exact S3 invocation permission", () => {
    const f = fixture();
    const initial = prepareBetaInfrastructureProposal({
      ...f,
      proposal: {
        contractVersion: 1,
        summary: "Input files",
        resources: [
          {
            key: "bucket",
            serviceType: "aws.s3.bucket",
            label: "Input files",
            parentKey: null,
          },
        ],
        connections: [],
        limitations: [],
      },
    });
    const document = applyPreparedResourceRepair(f.document, initial).document;
    const bucket = document.nodes.find(
      (node) => node.semantic.serviceType === "aws.s3.bucket",
    );
    if (!bucket) throw new Error("Missing bucket");
    const update = {
      contractVersion: 2,
      summary: "Process uploaded files",
      existingResources: [{ key: "input", nodeId: bucket.id }],
      resources: [
        {
          key: "handler",
          serviceType: "aws.lambda.function",
          label: "Processor",
          purpose: "Read uploaded files and record processing results.",
          parentKey: null,
        },
      ],
      connections: [
        {
          ruleId: "aws.s3.bucket-notifies-lambda",
          sourceKey: "input",
          targetKey: "handler",
          configuration: {},
        },
      ],
      limitations: [],
    };
    const prepared = prepareBetaInfrastructureProposal({
      ...f,
      document,
      proposal: update,
    });
    const result = applyPreparedResourceRepair(document, prepared);
    expect(
      result.document.nodes.filter(
        (node) => node.semantic.serviceType === "aws.s3.bucket",
      ),
    ).toEqual([bucket]);
    expect(
      result.document.applicationContracts.contracts.some(
        (contract) =>
          "description" in contract &&
          contract.description ===
            "Read uploaded files and record processing results.",
      ),
    ).toBe(true);
    expect(
      result.document.workloadBehavior.workloads[0]?.implementation.mode,
    ).toBe("infrastructure-only");
    const connection = result.document.edges.find(
      (edge) => edge.semantic.relationshipType === "aws.s3.notifies-lambda",
    );
    if (!connection) throw new Error("Missing S3 connection");
    const permissions = result.document.nodes.filter(
      (node) => node.semantic.serviceType === "aws.iam.policy-statement",
    );
    expect(permissions).toHaveLength(1);
    expect(permissions[0]?.semantic.configuration.values).toMatchObject({
      actions: { kind: "string-list", value: ["lambda:InvokeFunction"] },
      principals: { kind: "string-list", value: ["s3.amazonaws.com"] },
    });
    expect(permissions[0]?.semantic.lifecycle).toMatchObject({
      ownership: "generated",
      provenance: {
        dependentEdgeIds: [connection.id],
      },
    });
    expect(
      projectOwnedPolicyConfigurations(
        result.document,
        awsOwnedPolicyGraphDescriptors,
      ).success,
    ).toBe(true);
    expect(permissions[0]?.semantic.configuration.values).toMatchObject({
      resourceNode: {
        kind: "node-reference",
        nodeId: result.document.nodes.find(
          (node) => node.semantic.serviceType === "aws.lambda.function",
        )?.id,
      },
    });
    expect(
      result.document.edges.some(
        (edge) =>
          edge.semantic.source.nodeId === permissions[0]?.id &&
          edge.semantic.relationshipType.startsWith("aws.iam.authorizes-"),
      ),
    ).toBe(true);
    const iamRule = awsValidationRuleRegistrationsV1.find(
      (entry) =>
        entry.rule.id === "aws.cloudmarkup.validation.iam-policy-safety",
    )?.rule;
    if (!iamRule) throw new Error("Expected IAM safety rule.");
    const iamReport = executeArchitectureValidationRules(
      {
        document: result.document,
        environment: "development",
        target: "draft",
      },
      [iamRule],
    );
    expect(
      iamReport.findings.some(
        (finding) => finding.code === "aws.validation.iam-resource-missing",
      ),
    ).toBe(false);
    expect(result.inversion.kind).toBe("available");
    if (result.inversion.kind === "available")
      expect(
        applyGraphCommand(result.document, result.inversion.command).document,
      ).toEqual(document);
    expect(() =>
      prepareBetaInfrastructureProposal({
        ...f,
        document,
        proposal: {
          ...update,
          existingResources: [{ key: "input", nodeId: "unknown" }],
        },
      }),
    ).toThrow("unavailable");
  });
  it("previews the real creation and connection commands atomically, preserves the source and supports one inverse", () => {
    const f = fixture();
    const before = structuredClone(f.document);
    const prepared = prepareBetaInfrastructureProposal(f);
    expect(f.document).toEqual(before);
    const result = applyPreparedResourceRepair(f.document, prepared);
    expect(
      result.document.nodes.find(
        (node) => node.presentation.label === "API handler",
      ),
    ).toBeDefined();
    expect(result.document.workloadBehavior.workloads).toHaveLength(1);
    expect(
      result.document.workloadBehavior.workloads[0]?.implementation.mode,
    ).toBe("infrastructure-only");
    expect(getArchitectureDocumentHashes(result.document)).toEqual(
      prepared.previewHashes,
    );
    expect(result.inversion.kind).toBe("available");
    if (result.inversion.kind === "available")
      expect(
        applyGraphCommand(result.document, result.inversion.command).document,
      ).toEqual(before);
  });
  it("rejects unknown services and partial plans without changing the architecture", () => {
    const f = fixture();
    const before = structuredClone(f.document);
    expect(() =>
      prepareBetaInfrastructureProposal({
        ...f,
        proposal: {
          ...proposal,
          resources: [
            ...proposal.resources,
            {
              key: "unknown",
              serviceType: "aws.invented.service",
              label: "Invented",
              parentKey: null,
            },
          ],
        },
      }),
    ).toThrow();
    expect(f.document).toEqual(before);
  });
  it("rejects drift between preview and acceptance", () => {
    const f = fixture();
    const prepared = prepareBetaInfrastructureProposal(f);
    const accepted = applyPreparedResourceRepair(f.document, prepared).document;
    expect(() => applyPreparedResourceRepair(accepted, prepared)).toThrow();
  });
  it("rejects repeated keys and dangling connections before command creation", () => {
    expect(
      betaInfrastructureProposalV1Schema.safeParse({
        ...proposal,
        resources: [proposal.resources[0], proposal.resources[0]],
      }).success,
    ).toBe(false);
    expect(
      betaInfrastructureProposalV1Schema.safeParse({
        ...proposal,
        connections: [{ ...proposal.connections[0], sourceKey: "missing" }],
      }).success,
    ).toBe(false);
  });
});

describe("configured FSx proposals", () => {
  it("uses ordinary owned-configuration and permission commands for the complete workflow", () => {
    const document = loadBlankAwsEditorArchitectureDocument("us-east-1");
    let count = 0;
    const resources = [
      ["vpc", "aws.ec2.vpc", null, {}],
      ["az", "aws.ec2.availability-zone", "vpc", { zoneName: "us-east-1a" }],
      ["subnet", "aws.ec2.subnet", "az", { cidrBlock: "10.0.1.0/24" }],
      ["routes", "aws.ec2.route-table", "vpc", {}],
      ["association", "aws.ec2.route-table-association", "routes", {}],
      ["sg", "aws.ec2.security-group", null, {}],
      ...(["ingress", "egress"] as const).flatMap((direction) => [
        [
          direction + "988",
          "aws.ec2.security-group-" + direction + "-rule",
          "sg",
          {
            protocol: "tcp",
            fromPort: 988,
            toPort: 988,
            [direction === "ingress"
              ? "sourceIpv4Cidr"
              : "destinationIpv4Cidr"]: "10.0.1.0/24",
          },
        ],
        [
          direction + "1018",
          "aws.ec2.security-group-" + direction + "-rule",
          "sg",
          {
            protocol: "tcp",
            fromPort: 1018,
            toPort: 1023,
            [direction === "ingress"
              ? "sourceIpv4Cidr"
              : "destinationIpv4Cidr"]: "10.0.1.0/24",
          },
        ],
      ]),
      ["input", "aws.s3.bucket", null, {}],
      ["processed", "aws.s3.bucket", null, {}],
      ["handler", "aws.lambda.function", null, {}],
      ["role", "aws.iam.role", null, {}],
      ["vpcAccess", "aws.lambda.vpc-access-configuration", "handler", {}],
      [
        "vpcPolicy",
        "aws.iam.managed-policy-attachment",
        "role",
        {
          displayName: "Lambda network access",
          attachmentKind: "managed-policy-attachment",
          managedPolicyReference:
            "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole",
        },
      ],
      ["logs", "aws.cloudwatch.log-group", null, {}],
      ["share", "aws.fsx.lustre-file-system", null, { storageCapacity: 1200 }],
    ].map(([key, serviceType, parentKey, configuration]) => ({
      key,
      serviceType,
      parentKey,
      configuration,
      label: key,
      ...(key === "handler"
        ? {
            purpose: "Process source bucket events and write processed output.",
          }
        : {}),
    }));
    const connections = [
      [
        "aws.ec2.route-table-association-targets-subnet",
        "association",
        "subnet",
      ],
      ["aws.ec2.vpc-associates-security-group", "vpc", "sg"],
      ["aws.iam.role-assumed-by-lambda", "role", "handler"],
      ["aws.lambda.vpc-access-uses-subnet", "vpcAccess", "subnet"],
      ["aws.lambda.vpc-access-uses-security-group", "vpcAccess", "sg"],
      ["aws.lambda.writes-log-group", "handler", "logs"],
      ["aws.s3.bucket-notifies-lambda", "input", "handler"],
      ["aws.lambda.reads-s3-bucket", "handler", "input"],
      ["aws.lambda.writes-s3-bucket", "handler", "processed"],
      ["aws.fsx.lustre-file-system-uses-subnet", "share", "subnet"],
      ["aws.fsx.lustre-file-system-uses-security-group", "share", "sg"],
      ["aws.fsx.lustre-imports-s3", "share", "processed"],
    ].map(([ruleId, sourceKey, targetKey]) => ({
      ruleId,
      sourceKey,
      targetKey,
      configuration: {},
    }));
    const proposal = {
      contractVersion: 3,
      summary: "S3 processing with Lustre import",
      resources,
      existingResources: [],
      connections,
      limitations: [],
    };

    const prepared = prepareBetaInfrastructureProposal({
      document,
      catalog: awsEditorCatalog,
      createId: () => "fsx_command_" + String(++count),
      proposal,
    });
    const applied = applyPreparedResourceRepair(document, prepared);
    expect(
      applied.document.nodes.find(
        (n) => n.semantic.serviceType === "aws.fsx.lustre-file-system",
      )?.semantic.configuration.values,
    ).toMatchObject({ storageCapacity: { kind: "integer", value: 1200 } });
    expect(
      applied.document.nodes.find(
        (n) => n.semantic.serviceType === "aws.ec2.availability-zone",
      )?.semantic.configuration.values,
    ).toMatchObject({ zoneName: { kind: "string", value: "us-east-1a" } });
    expect(
      applied.document.edges.some(
        (e) => e.semantic.relationshipType === "aws.fsx.lustre-imports-s3",
      ),
    ).toBe(true);
    const objectPermissions = applied.document.nodes.filter(
      (n) =>
        n.semantic.serviceType === "aws.iam.policy-statement" &&
        JSON.stringify(n.semantic.configuration.values).includes("s3:"),
    );
    expect(objectPermissions).toHaveLength(2);
    const fsxRule = awsValidationRuleRegistrationsV1.find(
      (entry) => entry.rule.id === "aws.cloudmarkup.validation.fsx-readiness",
    )?.rule;
    if (!fsxRule) throw new Error("Expected FSx validation rule.");
    const readiness = (graph: typeof document) =>
      executeArchitectureValidationRules(
        {
          document: graph,
          environment: "development",
          target: "compilation",
        },
        [fsxRule],
      );
    expect(readiness(applied.document).diagnostics).toEqual([]);
    expect(readiness(applied.document).findings).toEqual([]);
    const sourceTrigger = applied.document.edges.find(
      (edge) => edge.semantic.relationshipType === "aws.s3.notifies-lambda",
    );
    expect(sourceTrigger).toBeDefined();
    expect(applied.document.workloadBehavior.workloads[0]?.triggers).toEqual([
      expect.objectContaining({ edgeId: sourceTrigger?.id }),
    ]);
    expect(() =>
      prepareBetaInfrastructureProposal({
        document,
        catalog: awsEditorCatalog,
        createId: () => "fsx_incomplete_" + String(++count),
        proposal: {
          ...proposal,
          resources: resources.filter(
            (resource) => resource.key !== "association",
          ),
          connections: connections.filter(
            (connection) =>
              connection.ruleId !==
              "aws.ec2.route-table-association-targets-subnet",
          ),
        },
      }),
    ).toThrow("Subnet needs one explicit route table association");
    const narrowed = {
      ...applied.document,
      nodes: applied.document.nodes.map((node) =>
        node.semantic.serviceType === "aws.ec2.security-group-ingress-rule"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    sourceIpv4Cidr: {
                      kind: "string" as const,
                      value: "10.0.1.0/25",
                    },
                  },
                },
              },
            }
          : node,
      ),
    };
    const report = readiness(narrowed);
    expect(report.findings.map((finding) => finding.code)).toContain(
      "aws.validation.fsx-lustre-ingress",
    );
    expect(report).toEqual(readiness(structuredClone(narrowed)));

    expect(
      applied.document.nodes.filter(
        (n) => n.semantic.serviceType === "aws.lambda.vpc-access-configuration",
      ),
    ).toHaveLength(1);
    expect(
      applied.document.nodes.filter(
        (n) => n.semantic.serviceType === "aws.iam.managed-policy-attachment",
      ),
    ).toHaveLength(1);
    expect(() =>
      prepareBetaInfrastructureProposal({
        document,
        catalog: awsEditorCatalog,
        createId: () => "invalid_policy_" + String(++count),
        proposal: {
          ...proposal,
          resources: resources.map((r) =>
            r.key === "vpcPolicy"
              ? {
                  ...r,
                  configuration: {
                    displayName: "Broad access",
                    attachmentKind: "managed-policy-attachment",
                    managedPolicyReference: "aws-managed:AdministratorAccess",
                  },
                }
              : r,
          ),
        },
      }),
    ).toThrow("not available");

    expect(applied.inversion.kind).toBe("available");
    if (applied.inversion.kind === "available")
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(document);
    const invalid = {
      ...proposal,
      resources: resources.map((r) =>
        r.key === "share"
          ? { ...r, configuration: { storageCapacity: "invalid" } }
          : r,
      ),
    };
    expect(() =>
      prepareBetaInfrastructureProposal({
        document,
        catalog: awsEditorCatalog,
        createId: () => "invalid_" + String(++count),
        proposal: invalid,
      }),
    ).toThrow("invalid configuration");
    expect(document.nodes).toHaveLength(0);
  });
});

describe.each([4, 5])(
  "v%s reviewed configuration changes",
  (contractVersion) => {
    function updateFixture() {
      const f = fixture();
      const initial = prepareBetaInfrastructureProposal(f);
      const document = applyPreparedResourceRepair(
        f.document,
        initial,
      ).document;
      const node = document.nodes.find(
        (n) => n.semantic.serviceType === "aws.lambda.function",
      );
      if (!node) throw new Error("Missing Lambda");
      return {
        ...f,
        document,
        node,
        proposal: {
          contractVersion,
          summary: "Adjust the handler timeout.",
          existingResources: [{ key: "handler", nodeId: node.id }],
          resources: [],
          connections: [],
          updates: [
            {
              resourceKey: "handler",
              configuration: { timeoutSeconds: 20 },
              reason: "Allow the requested processing time.",
            },
          ],
          limitations: [],
          review: {
            intent: "Adjust timeout",
            assumptions: [],
            checks: ["Review processing latency"],
            questions: [],
          },
        },
      };
    }
    it("changes only the reviewed setting, preserves existing issues and has an exact inverse", () => {
      const f = updateFixture();
      const before = structuredClone(f.document);
      const prepared = prepareBetaInfrastructureProposal(f);
      const applied = applyPreparedResourceRepair(f.document, prepared);
      const updated = applied.document.nodes.find((n) => n.id === f.node.id);
      expect(updated?.semantic.configuration.values).toEqual({
        ...f.node.semantic.configuration.values,
        timeoutSeconds: { kind: "integer", value: 20 },
      });
      expect(applied.document.nodes.map((n) => n.id)).toEqual(
        f.document.nodes.map((n) => n.id),
      );
      expect(applied.document.edges).toEqual(f.document.edges);
      expect(f.document).toEqual(before);
      expect(applied.inversion.kind).toBe("available");
      if (applied.inversion.kind === "available")
        expect(
          applyGraphCommand(applied.document, applied.inversion.command)
            .document,
        ).toEqual(before);
      expect(() =>
        applyPreparedResourceRepair(applied.document, prepared),
      ).toThrow("changed after this preview");
    });
    it("rejects invalid, secret, generated-resource and unresolved edits atomically", () => {
      const f = updateFixture();
      const before = structuredClone(f.document);
      for (const configuration of [
        { timeoutSeconds: -1 },
        { password: "never-send" },
      ]) {
        expect(() =>
          prepareBetaInfrastructureProposal({
            ...f,
            proposal: {
              ...f.proposal,
              updates: [{ ...f.proposal.updates[0], configuration }],
            },
          }),
        ).toThrow();
      }
      const generated = f.document.nodes.find(
        (node) => node.semantic.lifecycle.ownership === "generated",
      );
      if (!generated) throw new Error("Expected generated IAM fixture");
      expect(() =>
        prepareBetaInfrastructureProposal({
          ...f,
          proposal: {
            ...f.proposal,
            existingResources: [{ key: "handler", nodeId: generated.id }],
          },
        }),
      ).toThrow("unavailable");
      expect(() =>
        prepareBetaInfrastructureProposal({
          ...f,
          proposal: {
            ...f.proposal,
            updates: [],
            review: {
              ...f.proposal.review,
              questions: ["What is the intended timeout?"],
            },
          },
        }),
      ).toThrow("clarification");
      expect(f.document).toEqual(before);
    });
    it("requires the dedicated review flow for changes to existing managed policies", () => {
      const f = updateFixture();
      const service = awsCatalogV1.requireService(
        "aws.iam.managed-policy-attachment",
      );
      const document = architectureDocumentV3Schema.parse({
        ...f.document,
        nodes: [
          ...f.document.nodes,
          {
            ...f.node,
            id: "node_ai_attachment",
            semantic: {
              ...f.node.semantic,
              deploymentKey: "ai_attachment",
              serviceType: service.id,
              resourceType: service.id,
              configuration: {
                schemaId: service.configuration.schemaId,
                schemaVersion: service.configuration.schemaVersion,
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
        ],
      });
      expect(() =>
        prepareBetaInfrastructureProposal({
          ...f,
          document,
          proposal: {
            ...f.proposal,
            existingResources: [
              { key: "handler", nodeId: "node_ai_attachment" },
            ],
            updates: [
              {
                resourceKey: "handler",
                configuration: {
                  managedPolicyReference: "aws-managed:AdministratorAccess",
                },
                reason: "Untrusted suggestion",
              },
            ],
          },
        }),
      ).toThrow("dedicated permissions review");
    });
  },
);

describe("v5 catalog-bound string-list proposals", () => {
  const reviewed = {
    contractVersion: 5,
    summary: "Route selected events and messages to a queue.",
    existingResources: [],
    updates: [],
    limitations: [],
    review: {
      intent: "Select event and message types",
      assumptions: [],
      checks: ["Review the delivery paths"],
      questions: [],
    },
    resources: [
      {
        key: "messageQueue",
        serviceType: "aws.sqs.queue",
        label: "Message inbox",
        parentKey: null,
      },
      {
        key: "bus",
        serviceType: "aws.eventbridge.event-bus",
        label: "Events",
        parentKey: null,
      },
      {
        key: "rule",
        serviceType: "aws.eventbridge.rule",
        label: "Event selection",
        parentKey: null,
        configuration: {
          detailTypes: ["Application Event"],
          sourceKinds: ["cloudmarkup.application"],
          filterKeys: [],
        },
      },
      {
        key: "queue",
        serviceType: "aws.sqs.queue",
        label: "Event inbox",
        parentKey: null,
      },
      {
        key: "topic",
        serviceType: "aws.sns.topic",
        label: "Messages",
        parentKey: null,
      },
      {
        key: "target",
        serviceType: "aws.eventbridge.target",
        label: "Queue delivery",
        parentKey: "rule",
        configuration: { targetType: "SQS" },
      },
      {
        key: "subscription",
        serviceType: "aws.sns.subscription",
        label: "Message selection",
        parentKey: "topic",
        configuration: {
          protocol: "SQS",
          filterKeys: [],
          filterScope: "NONE",
        },
      },
    ],
    connections: [
      {
        ruleId: "aws.eventbridge.event-bus-associates-rule",
        sourceKey: "bus",
        targetKey: "rule",
        configuration: {},
      },
      {
        ruleId: "aws.eventbridge.target-sends-to-sqs",
        sourceKey: "target",
        targetKey: "queue",
        configuration: {},
      },
      {
        ruleId: "aws.sns.subscription-sends-to-sqs",
        sourceKey: "subscription",
        targetKey: "messageQueue",
        configuration: {},
      },
    ],
  };
  it("v6 browser and host share identical deterministic commands and results", () => {
    const f = fixture();
    const semantic = { ...reviewed, contractVersion: 6 };
    const browser = prepareBetaInfrastructureProposal({
      ...f,
      proposal: semantic,
    });
    const host = prepareSharedProposal({
      ...f,
      proposal: semantic,
      createId: () => {
        throw new Error("V6 IDs must be deterministic");
      },
    });
    expect(browser.command).toEqual(host.command);
    expect(applyGraphCommand(f.document, browser.command).document).toEqual(
      applyGraphCommand(f.document, host.command).document,
    );
  });
  function createdFixture() {
    const f = fixture();
    const prepared = prepareBetaInfrastructureProposal({
      ...f,
      proposal: reviewed,
    });
    return {
      ...f,
      document: applyPreparedResourceRepair(f.document, prepared).document,
    };
  }
  it("creates supported typed lists with an exact inverse and rejects unreviewed filters", () => {
    const f = fixture();
    const before = structuredClone(f.document);
    const applied = applyPreparedResourceRepair(
      f.document,
      prepareBetaInfrastructureProposal({ ...f, proposal: reviewed }),
    );
    const rule = applied.document.nodes.find(
      (node) => node.semantic.serviceType === "aws.eventbridge.rule",
    );
    const subscription = applied.document.nodes.find(
      (node) => node.semantic.serviceType === "aws.sns.subscription",
    );
    expect(rule?.semantic.configuration.values).toMatchObject({
      detailTypes: { kind: "string-list", value: ["Application Event"] },
      sourceKinds: { kind: "string-list", value: ["cloudmarkup.application"] },
      filterKeys: { kind: "string-list", value: [] },
    });
    expect(subscription?.semantic.configuration.values).toMatchObject({
      filterKeys: { kind: "string-list", value: [] },
    });
    expect(applied.inversion.kind).toBe("available");
    if (applied.inversion.kind === "available")
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(before);
    for (const key of ["rule", "subscription"]) {
      expect(() =>
        prepareBetaInfrastructureProposal({
          ...f,
          proposal: {
            ...reviewed,
            resources: reviewed.resources.map((resource) =>
              resource.key === key
                ? {
                    ...resource,
                    configuration: {
                      ...resource.configuration,
                      filterKeys: ["category"],
                      ...(key === "subscription"
                        ? { filterScope: "MESSAGE_ATTRIBUTES" }
                        : {}),
                    },
                  }
                : resource,
            ),
          },
        }),
      ).toThrow("supported typed value contract");
    }
    expect(f.document).toEqual(before);
  });
  it("updates and clears lists atomically without resetting omitted values, and rejects stale reuse", () => {
    const current = createdFixture();
    const f = {
      ...current,
      document: architectureDocumentV3Schema.parse({
        ...current.document,
        nodes: current.document.nodes.map((node) =>
          ["aws.eventbridge.rule", "aws.sns.subscription"].includes(
            node.semantic.serviceType,
          )
            ? {
                ...node,
                semantic: {
                  ...node.semantic,
                  configuration: {
                    ...node.semantic.configuration,
                    values: {
                      ...node.semantic.configuration.values,
                      filterKeys: { kind: "string-list", value: ["category"] },
                      ...(node.semantic.serviceType === "aws.sns.subscription"
                        ? {
                            filterScope: {
                              kind: "string",
                              value: "MESSAGE_ATTRIBUTES",
                            },
                          }
                        : {}),
                    },
                  },
                },
              }
            : node,
        ),
      }),
    };
    const rule = f.document.nodes.find(
      (node) => node.semantic.serviceType === "aws.eventbridge.rule",
    );
    const subscription = f.document.nodes.find(
      (node) => node.semantic.serviceType === "aws.sns.subscription",
    );
    if (!rule || !subscription) throw new Error("Expected eventing resources");
    const before = structuredClone(f.document);
    const update = {
      ...reviewed,
      resources: [],
      connections: [],
      existingResources: [
        { key: "rule", nodeId: rule.id },
        { key: "subscription", nodeId: subscription.id },
      ],
      updates: [
        {
          resourceKey: "rule",
          configuration: {
            filterKeys: [],
            detailTypes: ["Object Created", "Application Event"],
            sourceKinds: ["aws.s3", "cloudmarkup.application"],
          },
          reason: "Include requested sources",
        },
        {
          resourceKey: "subscription",
          configuration: { filterKeys: [], filterScope: "NONE" },
          reason: "Remove optional message filtering",
        },
      ],
    };
    const prepared = prepareBetaInfrastructureProposal({
      ...f,
      proposal: update,
    });
    const applied = applyPreparedResourceRepair(f.document, prepared);
    expect(
      applied.document.nodes.find((node) => node.id === rule.id)?.semantic
        .configuration.values,
    ).toEqual({
      ...rule.semantic.configuration.values,
      filterKeys: { kind: "string-list", value: [] },
      detailTypes: {
        kind: "string-list",
        value: ["Object Created", "Application Event"],
      },
      sourceKinds: {
        kind: "string-list",
        value: ["aws.s3", "cloudmarkup.application"],
      },
    });
    expect(
      applied.document.nodes.find((node) => node.id === subscription.id)
        ?.semantic.configuration.values,
    ).toEqual({
      ...subscription.semantic.configuration.values,
      filterKeys: { kind: "string-list", value: [] },
      filterScope: { kind: "string", value: "NONE" },
    });
    expect(applied.document.edges).toEqual(before.edges);
    expect(() =>
      applyPreparedResourceRepair(applied.document, prepared),
    ).toThrow("changed after this preview");
    if (applied.inversion.kind !== "available")
      throw new Error("Expected reversible update");
    expect(
      applyGraphCommand(applied.document, applied.inversion.command).document,
    ).toEqual(before);
    for (const configuration of [
      { detailTypes: [] },
      { sourceKinds: ["unknown"] },
      { filterKeys: ["duplicate", "duplicate"] },
      { filterKeys: Array.from({ length: 9 }, (_, i) => `key${String(i)}`) },
    ]) {
      expect(() =>
        prepareBetaInfrastructureProposal({
          ...f,
          proposal: {
            ...update,
            updates: [
              { resourceKey: "rule", configuration, reason: "Invalid list" },
            ],
          },
        }),
      ).toThrow();
    }
    expect(f.document).toEqual(before);
  });
});
