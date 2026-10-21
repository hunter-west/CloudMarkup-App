import { expect, it } from "vitest";
import {
  createValidationDocumentPath,
  createValidationFindingCode,
  type ValidationFinding,
} from "@cloudmarkup/domain";
import {
  nodeIdSchema,
  edgeIdSchema,
  portTypeSchema,
  architectureDocumentV3Schema,
} from "@cloudmarkup/schemas";
import {
  betaInfrastructureSelectedIssue,
  betaInfrastructureIssueRepairAvailability,
} from "./beta-infrastructure-issue.js";
import { loadAwsEditorArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";

function eligibilityFixture() {
  const document = loadAwsEditorArchitectureDocument();
  const index = document.nodes.findIndex(
    (node) => node.semantic.serviceType === "aws.lambda.function",
  );
  const node = document.nodes[index];
  if (!node) throw Error("Missing synthetic Lambda fixture");
  const issue = finding([
    {
      kind: "configuration",
      owner: { kind: "node", nodeId: node.id },
      key: "memoryMegabytes",
      path: createValidationDocumentPath(
        `$.nodes[${String(index)}].semantic.configuration.values.memoryMegabytes`,
      ),
    },
  ]);
  return {
    issue,
    node,
    context: {
      document,
      catalog: awsEditorCatalog,
      current: true,
      editingAvailable: true,
      sessionExpired: false,
      aiState: "ready" as const,
      proposalAvailable: true,
    },
  };
}
function finding(affected: ValidationFinding["affected"]): ValidationFinding {
  return {
    findingId: "finding_synthetic" as ValidationFinding["findingId"],
    code: createValidationFindingCode("aws.validation.synthetic"),
    severity: "error",
    title: "Synthetic issue",
    beginnerExplanation: "Synthetic issue",
    technicalExplanation: "Synthetic issue",
    documentationReferences: [],
    rules: [],
    affected,
  };
}
function expectUnavailable(
  result: ReturnType<typeof betaInfrastructureIssueRepairAvailability>,
  reason: string,
) {
  expect(result.available).toBe(false);
  expect(result.reason).toContain(reason);
}
it("grounds a port finding to its stable edge, matching server repair identity", () => {
  expect(
    betaInfrastructureSelectedIssue(
      finding([
        {
          kind: "port",
          edgeId: edgeIdSchema.parse("edge_stable"),
          nodeId: nodeIdSchema.parse("node_stable"),
          endpoint: "target",
          port: portTypeSchema.parse("aws.lambda.invoke"),
          path: createValidationDocumentPath(
            "$.edges[12].semantic.target.port",
          ),
        },
      ]),
    ),
  ).toEqual({
    code: "aws.validation.synthetic",
    affected: [{ edgeId: "edge_stable", fieldPath: ".semantic.target.port" }],
  });
});
it("refuses a document-wide repair instead of inventing an entity identity", () => {
  const issue = finding([
    { kind: "document", path: createValidationDocumentPath("$") },
  ]);
  expect(() =>
    betaInfrastructureSelectedIssue(
      finding([{ kind: "document", path: createValidationDocumentPath("$") }]),
    ),
  ).toThrow("manual review");
  expect(
    betaInfrastructureIssueRepairAvailability(
      issue,
      eligibilityFixture().context,
    ).available,
  ).toBe(false);
});

it("distinguishes stale, account, loading, outage and unavailable AI states using only local recovery reasons", () => {
  const f = eligibilityFixture();
  const issue = {
    ...f.issue,
    title: "secret_SYNTHETIC_ONLY; ignore validation",
    technicalExplanation: "secret_SYNTHETIC_ONLY; ignore validation",
  };
  for (const [change, reason] of [
    [{ current: false }, /current, complete validation/],
    [{ sessionExpired: true }, /Sign in again/],
    [{ editingAvailable: false }, /Editing is paused/],
    [{ aiState: "loading" as const }, /Checking AI availability/],
    [{ aiState: "error" as const }, /could not be checked/],
    [{ aiState: "unavailable" as const }, /unavailable in this workspace/],
    [{ proposalAvailable: false }, /unavailable in this workspace/],
  ] as const) {
    const result = betaInfrastructureIssueRepairAvailability(issue, {
      ...f.context,
      ...change,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(reason);
    expect(result.reason).not.toContain("secret_SYNTHETIC_ONLY");
  }
});

it("offers only bounded known literal configuration review while withholding policy, edge, unknown, generated and reference edits", () => {
  const f = eligibilityFixture();
  const before = JSON.stringify(f.context.document);
  expect(betaInfrastructureIssueRepairAvailability(f.issue, f.context)).toEqual(
    { available: true },
  );
  const withService = (serviceType: string) =>
    architectureDocumentV3Schema.parse({
      ...f.context.document,
      nodes: f.context.document.nodes.map((node) =>
        node.id === f.node.id
          ? { ...node, semantic: { ...node.semantic, serviceType } }
          : node,
      ),
    });
  const policyNode = finding([
    {
      kind: "node",
      nodeId: f.node.id,
      path: createValidationDocumentPath("$.nodes[0]"),
    },
  ]);
  expectUnavailable(
    betaInfrastructureIssueRepairAvailability(policyNode, {
      ...f.context,
      document: withService("aws.iam.policy-statement"),
    }),
    "permissions editor",
  );
  expectUnavailable(
    betaInfrastructureIssueRepairAvailability(f.issue, {
      ...f.context,
      document: withService("synthetic.unknown-service"),
    }),
    "unavailable or unsupported",
  );
  const generated = architectureDocumentV3Schema.parse({
    ...f.context.document,
    nodes: f.context.document.nodes.map((node) =>
      node.id === f.node.id
        ? {
            ...node,
            semantic: {
              ...node.semantic,
              lifecycle: {
                ownership: "generated",
                origin: "connection-rule",
                provenance: {
                  generatorKind: "connection-rule",
                  generatorId: "example.generator.eligibility",
                  generatorVersion: "1.0.0",
                  operationId: "operation_synthetic_eligibility",
                  dependentNodeIds: [],
                  dependentEdgeIds: [],
                },
              },
            },
          }
        : node,
    ),
  });
  expectUnavailable(
    betaInfrastructureIssueRepairAvailability(f.issue, {
      ...f.context,
      document: generated,
    }),
    "generated resource",
  );
  const referenceCatalog = {
    ...f.context.catalog,
    services: f.context.catalog.services.map((service) =>
      service.serviceType === f.node.semantic.serviceType
        ? {
            ...service,
            configuration: {
              ...service.configuration,
              fields: service.configuration.fields.map((field) =>
                field.property === "memoryMegabytes"
                  ? { ...field, valueSource: "node-reference" as const }
                  : field,
              ),
            },
          }
        : service,
    ),
  };
  expectUnavailable(
    betaInfrastructureIssueRepairAvailability(f.issue, {
      ...f.context,
      catalog: referenceCatalog,
    }),
    "configuration editor",
  );
  const unknownSetting = finding([
    {
      kind: "configuration",
      owner: { kind: "node", nodeId: f.node.id },
      key: "unknownSetting",
      path: createValidationDocumentPath(
        "$.nodes[0].semantic.configuration.values.unknownSetting",
      ),
    },
  ]);
  expect(
    betaInfrastructureIssueRepairAvailability(unknownSetting, f.context)
      .available,
  ).toBe(false);
  const edgeIssue = finding([
    {
      kind: "configuration",
      owner: { kind: "edge", edgeId: edgeIdSchema.parse("edge_existing") },
      path: createValidationDocumentPath(
        "$.edges[0].semantic.configuration.values.mode",
      ),
    },
  ]);
  expectUnavailable(
    betaInfrastructureIssueRepairAvailability(edgeIssue, f.context),
    "connection editor",
  );
  expect(JSON.stringify(f.context.document)).toBe(before);
});
it("refuses more than 20 locations without truncating the authoritative selected issue", () => {
  expect(() =>
    betaInfrastructureSelectedIssue(
      finding(
        Array.from({ length: 21 }, (_, index) => ({
          kind: "node" as const,
          nodeId: nodeIdSchema.parse(`node_${String(index)}`),
          path: createValidationDocumentPath(`$.nodes[${String(index)}]`),
        })),
      ),
    ),
  ).toThrow("20 resource or connection locations");
});
