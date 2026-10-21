import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { compileProviderCatalogV1 } from "@cloudmarkup/provider-sdk/compiler";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { awsCatalogSourceV1 } from "./catalog/source.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { createSecretReadinessRuleV1 } from "./validation/secret-readiness-rule.js";

const lifecycle = { ownership: "user", origin: "user" };
function node(
  id: string,
  service: string,
  values: unknown,
  parent?: unknown,
  schemaVersion = "1.0.0",
) {
  return {
    id,
    semantic: {
      deploymentKey: id,
      serviceType: service,
      resourceType: service,
      lifecycle,
      ...(parent ? { parent } : {}),
      configuration: {
        schemaId: service + ".configuration",
        schemaVersion,
        values,
      },
    },
    presentation: { label: id, position: { x: 0, y: 0 } },
  };
}
function edge(id: string, ruleId: string, source: string, target: string) {
  const rule = awsCatalogV1.getConnectionRule(ruleId);
  if (!rule) throw Error("Missing synthetic fixture connection rule");
  return {
    id,
    semantic: {
      source: { nodeId: source, port: rule.source.portId },
      target: { nodeId: target, port: rule.target.portId },
      relationshipType: rule.relationshipType,
      configuration: {
        schemaId: rule.configuration.schemaId,
        schemaVersion: rule.configuration.schemaVersion,
        values: {},
      },
      lifecycle,
    },
  };
}
function defaults(service: string, input: Record<string, unknown> = {}) {
  const result = awsCatalogV1.validateConfiguration(service, input);
  if (!result.success) throw Error("Invalid synthetic configuration");
  return result.values;
}
function fixture(): ArchitectureDocument {
  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 2,
    documentId: "document_secret",
    architectureId: "architecture_secret",
    revision: {
      revisionId: "revision_secret",
      revisionNumber: 1,
      createdAt: "2026-10-03T00:00:00Z",
      createdBy: "actor_synthetic",
    },
    provider: { id: "aws.cloudmarkup", region: "us-east-1" },
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
        "secret",
        "aws.secretsmanager.secret",
        defaults("aws.secretsmanager.secret", {
          name: { kind: "string", value: "application/credential" },
        }),
      ),
    ],
    edges: [],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    workloadBehavior: { contractVersion: 1, workloads: [] },
  });
}
function findings(document: ArchitectureDocument) {
  const result = executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    [createSecretReadinessRuleV1(awsCatalogArtifactV1)],
  );
  expect(result.diagnostics).toEqual([]);
  return result.findings;
}
function change(
  document: ArchitectureDocument,
  id: string,
  values: Record<string, unknown>,
) {
  return parseArchitectureDocument({
    ...document,
    nodes: document.nodes.map((n) =>
      n.id === id
        ? {
            ...n,
            semantic: {
              ...n.semantic,
              configuration: {
                ...n.semantic.configuration,
                values: { ...n.semantic.configuration.values, ...values },
              },
            },
          }
        : n,
    ),
  });
}
function withKey(document = fixture()) {
  return parseArchitectureDocument({
    ...change(document, "secret", {
      encryptionMode: { kind: "string", value: "customer-managed" },
    }),
    nodes: [
      ...change(document, "secret", {
        encryptionMode: { kind: "string", value: "customer-managed" },
      }).nodes,
      node("key", "aws.kms.key", defaults("aws.kms.key")),
    ],
    edges: [edge("encryption", "aws.kms.key-encrypts-secret", "key", "secret")],
  });
}
function withPolicy() {
  const base = fixture();
  return parseArchitectureDocument({
    ...base,
    nodes: [
      ...base.nodes,
      node("role", "aws.iam.role", defaults("aws.iam.role")),
      node(
        "policy",
        "aws.iam.policy-document",
        {
          policyName: { kind: "string", value: "SecretRead" },
          policyKind: { kind: "string", value: "identity-inline" },
        },
        { nodeId: "role", relationshipType: "aws.iam.role-owns-inline-policy" },
      ),
      node(
        "read",
        "aws.iam.policy-statement",
        {
          statementId: { kind: "string", value: "ReadSecretValue" },
          effect: { kind: "string", value: "allow" },
          actions: {
            kind: "string-list",
            value: ["secretsmanager:GetSecretValue"],
          },
          principalKind: { kind: "string", value: "none" },
          principals: { kind: "string-list", value: [] },
          resourceExpressions: { kind: "string-list", value: [] },
          resourceNode: {
            kind: "node-reference",
            nodeId: "secret",
            attribute: "aws.secretsmanager.secret.arn",
          },
        },
        {
          nodeId: "policy",
          relationshipType: "aws.iam.policy-contains-statement",
        },
        "2.0.0",
      ),
    ],
    edges: [
      edge("owner", "aws.iam.role-owns-inline-policy", "policy", "role"),
      edge("member", "aws.iam.policy-contains-statement", "read", "policy"),
      edge(
        "scope",
        "aws.iam.policy-statement-authorizes-secret",
        "read",
        "secret",
      ),
    ],
  });
}
describe("Secrets Manager metadata foundation", () => {
  it("requires an explicit name and admits safe defaults without value fields", () => {
    expect(
      awsCatalogV1.validateConfiguration("aws.secretsmanager.secret", {})
        .success,
    ).toBe(false);
    const n = fixture().nodes[0];
    expect(n?.semantic.configuration.values).toMatchObject({
      valueMode: { kind: "string", value: "external-population" },
      preventDestroy: { kind: "boolean", value: true },
      recoveryWindowDays: { kind: "integer", value: 30 },
    });
    expect(findings(fixture()).map((f) => [f.code, f.severity])).toEqual([
      ["aws.validation.secret-external-population", "warning"],
    ]);
  });
  it.each(["secretString", "replicaRegions", "resourcePolicy"])(
    "rejects unreviewed field %s without exporting its content",
    (property) => {
      const config = fixture().nodes[0]?.semantic.configuration.values;
      expect(
        awsCatalogV1.validateConfiguration("aws.secretsmanager.secret", {
          ...config,
          [property]: { kind: "string", value: "sensitive-sentinel" },
        }).success,
      ).toBe(false);
      const report = findings(
        change(fixture(), "secret", {
          [property]: { kind: "string", value: "sensitive-sentinel" },
        }),
      );
      expect(
        report.find((f) => f.code === "aws.validation.secret-mode"),
      ).toMatchObject({
        severity: "security-error",
        affected: [{ kind: "node", nodeId: "secret", path: "$.nodes[0]" }],
      });
      expect(JSON.stringify(report)).not.toContain("sensitive-sentinel");
    },
  );
  it.each(["", "bad name", "bad\n", "name-abc123", "x".repeat(513)])(
    "finds invalid or ambiguous name %j",
    (name) => {
      const report = findings(
        change(fixture(), "secret", { name: { kind: "string", value: name } }),
      );
      expect(
        report.find((f) => f.code === "aws.validation.secret-name"),
      ).toMatchObject({
        severity: "security-error",
        affected: [
          {
            kind: "configuration",
            owner: { kind: "node", nodeId: "secret" },
            path: "$.nodes[0].semantic.configuration.values.name",
          },
        ],
      });
    },
  );
  it.each([6, 31, 7.5])("rejects unsafe recovery %s", (days) => {
    expect(
      awsCatalogV1.validateConfiguration("aws.secretsmanager.secret", {
        ...fixture().nodes[0]?.semantic.configuration.values,
        recoveryWindowDays: { kind: "integer", value: days },
      }).success,
    ).toBe(false);
  });
  it("requires exact enabled-key wiring only in customer-managed mode", () => {
    expect(
      findings(withKey()).filter((f) => f.severity === "security-error"),
    ).toEqual([]);
    expect(
      findings(
        change(withKey(), "key", {
          enabled: { kind: "boolean", value: false },
        }),
      ).map((f) => f.code),
    ).toContain("aws.validation.secret-encryption");
    for (const doc of [
      parseArchitectureDocument({ ...withKey(), edges: [] }),
      change(withKey(), "secret", {
        encryptionMode: { kind: "string", value: "aws-managed" },
      }),
      parseArchitectureDocument({
        ...withKey(),
        edges: [...withKey().edges, { ...withKey().edges[0], id: "duplicate" }],
      }),
    ])
      expect(findings(doc).map((f) => f.code)).toContain(
        "aws.validation.secret-encryption",
      );
  });
  it("previews an atomic encryption edge deterministically and undo retains the key/secret", () => {
    const doc = parseArchitectureDocument({ ...withKey(), edges: [] });
    const request = {
      document: doc,
      ruleId: "aws.kms.key-encrypts-secret",
      source: { nodeId: "key", portId: "aws.kms.key.secret-encryption" },
      target: {
        nodeId: "secret",
        portId: "aws.secretsmanager.secret.encryption-key",
      },
      configuration: {},
      operationId: "operation_encrypt",
    };
    const result = awsConnectionResolverV1.resolve(request);
    expect(result.success).toBe(true);
    expect(awsConnectionResolverV1.resolve(request)).toEqual(result);
    if (!result.success) throw Error("Expected encryption preview");
    expect(result.preview.document.nodes).toEqual(doc.nodes);
    expect(result.batch.commands).toHaveLength(1);
    const applied = applyGraphCommand(doc, result.batch);
    expect(applied.inversion.kind).toBe("available");
    if (applied.inversion.kind !== "available") throw Error("Missing inverse");
    expect(
      applyGraphCommand(applied.document, applied.inversion.command).document,
    ).toEqual(doc);
    expect(
      awsConnectionResolverV1.resolve({
        ...request,
        source: request.target,
        target: request.source,
      }).success,
    ).toBe(false);
  });
  it("separates read value from metadata and rejects broader or mismatched policy intent", () => {
    expect(
      findings(withPolicy()).filter((f) => f.severity === "security-error"),
    ).toEqual([]);
    expect(
      findings(
        change(withPolicy(), "read", {
          actions: {
            kind: "string-list",
            value: ["secretsmanager:DescribeSecret"],
          },
        }),
      ).filter((f) => f.severity === "security-error"),
    ).toEqual([]);
    for (const [values, code] of [
      [
        {
          actions: {
            kind: "string-list",
            value: ["secretsmanager:PutSecretValue"],
          },
        },
        "aws.validation.secret-policy-actions",
      ],
      [
        { actions: { kind: "string-list", value: ["secretsmanager:*"] } },
        "aws.validation.secret-policy-actions",
      ],
      [
        {
          principalKind: { kind: "string", value: "service" },
          principals: { kind: "string-list", value: ["lambda.amazonaws.com"] },
        },
        "aws.validation.secret-policy-actions",
      ],
      [
        { resourceExpressions: { kind: "string-list", value: ["*"] } },
        "aws.validation.secret-policy-scope",
      ],
      [
        {
          resourceNode: {
            kind: "node-reference",
            nodeId: "role",
            attribute: "aws.secretsmanager.secret.arn",
          },
        },
        "aws.validation.secret-policy-scope",
      ],
    ] as const)
      expect(
        findings(change(withPolicy(), "read", values)).map((f) => f.code),
      ).toContain(code);
    expect(
      findings(
        change(withPolicy(), "policy", {
          policyKind: { kind: "string", value: "resource" },
        }),
      ).map((f) => f.code),
    ).toContain("aws.validation.secret-policy-owner");
  });
  it("keeps findings deterministic and supplies no unsafe fixes", () => {
    const doc = withKey();
    const before = structuredClone(doc);
    const first = findings(doc);
    expect(findings(doc)).toEqual(first);
    expect(doc).toEqual(before);
    expect(first.every((f) => f.autoFix === undefined)).toBe(true);
  });
  it("produces identical source-order-independent successor bytes", () => {
    expect(
      compileProviderCatalogV1({
        ...awsCatalogSourceV1,
        services: [...awsCatalogSourceV1.services].reverse(),
        connectionRules: [...awsCatalogSourceV1.connectionRules].reverse(),
        validationRules: [...awsCatalogSourceV1.validationRules].reverse(),
      }).artifact,
    ).toEqual(awsCatalogArtifactV1);
  });
});
