import {
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { defineProviderOwnedConfigurationSlotV1 } from "@cloudmarkup/provider-sdk";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { awsKmsConnectionRules } from "./catalog/connections/kms-connections.js";
import { kmsKeyPolicySlot } from "./catalog/kms-presentation.js";
import { projectAwsCanonicalPolicyDocumentsV1 } from "./policy/projection-v1.js";
import { createIamPolicySafetyRuleV1 } from "./validation/iam-policy-safety-rule.js";
import { createKmsKeyReadinessRuleV1 } from "./validation/kms-key-rule.js";

function kmsConnection(index: number) {
  const rule = awsKmsConnectionRules[index];
  if (!rule) throw new Error("Missing reviewed KMS connection");
  return rule;
}
function fixture(): ArchitectureDocument {
  const lifecycle = { ownership: "user", origin: "user" };
  const config = (
    schemaId: string,
    values: unknown,
    schemaVersion = "1.0.0",
  ) => ({ schemaId, schemaVersion, values });
  const keyValues = awsCatalogV1.validateConfiguration("aws.kms.key", {});
  if (!keyValues.success) throw new Error("KMS defaults invalid");
  const node = (
    id: string,
    serviceType: string,
    configuration: unknown,
    parent?: unknown,
  ) => ({
    id,
    semantic: {
      deploymentKey: id,
      serviceType,
      resourceType: serviceType,
      configuration,
      lifecycle,
      ...(parent ? { parent } : {}),
    },
    presentation: { label: id, position: { x: 0, y: 0 } },
  });
  const edge = (
    id: string,
    relationshipType: string,
    source: string,
    target: string,
    sourcePort: string,
    targetPort: string,
    schemaId: string,
  ) => ({
    id,
    semantic: {
      source: { nodeId: source, port: sourcePort },
      target: { nodeId: target, port: targetPort },
      relationshipType,
      configuration: config(schemaId, {}),
      lifecycle,
    },
  });
  const owner = kmsConnection(0);
  const scope = kmsConnection(1);
  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 2,
    documentId: "document_kms",
    architectureId: "architecture_kms",
    revision: {
      revisionId: "revision_kms",
      revisionNumber: 1,
      createdAt: "2026-10-02T00:00:00Z",
      createdBy: "actor_synthetic",
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
    nodes: [
      node(
        "key",
        "aws.kms.key",
        config("aws.kms.key.configuration", keyValues.values),
      ),
      node(
        "policy",
        "aws.iam.policy-document",
        config("aws.iam.policy-document.configuration", {
          policyName: { kind: "string", value: "SyntheticKeyPolicy" },
          policyKind: { kind: "string", value: "resource" },
        }),
        { nodeId: "key", relationshipType: owner.relationshipType },
      ),
      node(
        "admin",
        "aws.iam.policy-statement",
        config(
          "aws.iam.policy-statement.configuration",
          {
            statementId: { kind: "string", value: "KeyAdmin" },
            effect: { kind: "string", value: "allow" },
            actions: {
              kind: "string-list",
              value: [
                "kms:DescribeKey",
                "kms:GetKeyPolicy",
                "kms:PutKeyPolicy",
              ],
            },
            principalKind: { kind: "string", value: "provider-identity" },
            principals: {
              kind: "string-list",
              value: ["arn:aws:iam::000000000000:role/synthetic-key-admin"],
            },
            resourceExpressions: { kind: "string-list", value: [] },
            resourceNode: {
              kind: "node-reference",
              nodeId: "key",
              attribute: "aws.kms.key.arn",
            },
          },
          "2.0.0",
        ),
        {
          nodeId: "policy",
          relationshipType: "aws.iam.policy-contains-statement",
        },
      ),
    ],
    edges: [
      edge(
        "owner",
        owner.relationshipType,
        "policy",
        "key",
        owner.source.portId,
        owner.target.portId,
        owner.configuration.schemaId,
      ),
      edge(
        "membership",
        "aws.iam.policy-contains-statement",
        "admin",
        "policy",
        "aws.iam.policy-statement.policy-document",
        "aws.iam.policy-document.statement",
        "aws.iam.policy-membership.connection",
      ),
      edge(
        "scope",
        scope.relationshipType,
        "admin",
        "key",
        scope.source.portId,
        scope.target.portId,
        scope.configuration.schemaId,
      ),
    ],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    workloadBehavior: { contractVersion: 1, workloads: [] },
  });
}
function findings(document: ArchitectureDocument) {
  const report = executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    [
      createKmsKeyReadinessRuleV1(awsCatalogArtifactV1),
      createIamPolicySafetyRuleV1(awsCatalogArtifactV1),
    ],
  );
  expect(report.diagnostics).toEqual([]);
  return report.findings;
}
function change(
  document: ArchitectureDocument,
  nodeId: string,
  property: string,
  value: unknown,
) {
  return parseArchitectureDocument({
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            semantic: {
              ...node.semantic,
              configuration: {
                ...node.semantic.configuration,
                values: {
                  ...node.semantic.configuration.values,
                  [property]: value,
                },
              },
            },
          }
        : node,
    ),
  });
}
describe("bounded KMS key foundation", () => {
  it("admits exact defaults and rejects unsupported key modes and fields", () => {
    expect(awsCatalogV1.validateConfiguration("aws.kms.key", {}).success).toBe(
      true,
    );
    for (const values of [
      { keySpec: { kind: "string", value: "RSA_2048" } },
      { multiRegion: { kind: "boolean", value: true } },
      { rotationPeriodDays: { kind: "integer", value: 89 } },
      { deletionWindowDays: { kind: "integer", value: 31 } },
      { preventDestroy: { kind: "boolean", value: false } },
      { bypassPolicyLockoutSafetyCheck: { kind: "boolean", value: true } },
    ])
      expect(
        awsCatalogV1.validateConfiguration("aws.kms.key", values).success,
      ).toBe(false);
  });
  it("projects exact graph scope without accepting wildcard configuration, preserving user ownership", () => {
    const document = fixture();
    const before = structuredClone(document);
    const owner = kmsConnection(0);
    const options = {
      ownerSlots: [
        {
          slot: defineProviderOwnedConfigurationSlotV1(kmsKeyPolicySlot),
          ownerServiceType: "aws.kms.key",
          ownerResourceType: "aws.kms.key",
          policyDocumentPort: owner.source.portId,
          ownerPort: owner.target.portId,
          bindingConfigurationSchemaId: owner.configuration.schemaId,
          bindingConfigurationSchemaVersion: owner.configuration.schemaVersion,
        },
      ],
    };
    const result = projectAwsCanonicalPolicyDocumentsV1(document, options);
    expect(result.success).toBe(true);
    expect(projectAwsCanonicalPolicyDocumentsV1(document, options)).toEqual(
      result,
    );
    expect(document).toEqual(before);
    expect(findings(document)).toEqual([]);
    expect(
      projectAwsCanonicalPolicyDocumentsV1(
        change(document, "admin", "resourceExpressions", {
          kind: "string-list",
          value: ["*"],
        }),
        options,
      ).success,
    ).toBe(false);
  });
  it.each([
    [
      "actions",
      { kind: "string-list", value: ["kms:Decrypt"] },
      "policy-administrator",
    ],
    [
      "actions",
      { kind: "string-list", value: ["kms:PutKeyPolicy", "kms:Decrypt"] },
      "policy-actions",
    ],
    ["actions", { kind: "string-list", value: ["kms:*"] }, "policy-actions"],
    ["principals", { kind: "string-list", value: ["*"] }, "policy-principal"],
    [
      "principals",
      { kind: "string-list", value: ["arn:aws:iam::000000000000:root"] },
      "policy-principal",
    ],
    [
      "principals",
      {
        kind: "string-list",
        value: [
          "arn:aws:iam::000000000000:role/admin",
          "arn:aws:iam::111111111111:role/admin",
        ],
      },
      "policy-cross-account",
    ],
    [
      "resourceNode",
      {
        kind: "node-reference",
        nodeId: "policy",
        attribute: "aws.kms.key.arn",
      },
      "policy-self-scope",
    ],
  ])(
    "rejects invalid %s intent with located, content-safe findings",
    (property, value, suffix) => {
      const result = findings(change(fixture(), "admin", property, value));
      const finding = result.find(
        (candidate) => candidate.code === "aws.validation.kms-" + suffix,
      );
      expect(finding).toBeDefined();
      expect(finding?.affected.length).toBeGreaterThan(0);
      expect(JSON.stringify(finding)).not.toContain("000000000000");
    },
  );
  it("rejects unrelated policy owners that reuse KMS scope with other actions", () => {
    const document = fixture();
    const policy = document.nodes.find((node) => node.id === "policy");
    const statement = document.nodes.find((node) => node.id === "admin");
    const scope = document.edges.find((edge) => edge.id === "scope");
    if (!policy || !statement || !scope)
      throw new Error("Missing canonical key-policy fixture");
    const rogue = parseArchitectureDocument({
      ...document,
      nodes: [
        ...document.nodes,
        {
          ...policy,
          id: "rogue_policy",
          semantic: {
            ...policy.semantic,
            deploymentKey: "rogue_policy",
            parent: undefined,
          },
        },
        {
          ...statement,
          id: "rogue_statement",
          semantic: {
            ...statement.semantic,
            deploymentKey: "rogue_statement",
            parent: {
              nodeId: "rogue_policy",
              relationshipType: "aws.iam.policy-contains-statement",
            },
            configuration: {
              ...statement.semantic.configuration,
              values: {
                ...statement.semantic.configuration.values,
                actions: {
                  kind: "string-list",
                  value: ["lambda:InvokeFunction"],
                },
              },
            },
          },
        },
      ],
      edges: [
        ...document.edges,
        {
          ...scope,
          id: "rogue_scope",
          semantic: {
            ...scope.semantic,
            source: { ...scope.semantic.source, nodeId: "rogue_statement" },
          },
        },
      ],
    });
    expect(findings(rogue).map((finding) => finding.code)).toContain(
      "aws.validation.kms-policy-owner",
    );
  });
});
