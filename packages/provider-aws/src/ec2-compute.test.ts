import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { ec2Bindings } from "./catalog/connections/ec2-connections.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { createEc2ReadinessRuleV1 } from "./validation/ec2-readiness-rule.js";
const lifecycle = { ownership: "user", origin: "user" };
const s = (value: string) => ({ kind: "string", value });
const i = (value: number) => ({ kind: "integer", value });
const b = (value: boolean) => ({ kind: "boolean", value });
const l = (...value: string[]) => ({ kind: "string-list", value });
export const ec2SyntheticInput = {
  imageId: s("ami-0123456789abcdef0"),
  imageRegion: s("us-east-1"),
  imageArchitecture: s("x86_64"),
  imageRootDeviceName: s("/dev/xvda"),
  imageRootMinimumGiB: i(8),
  instanceType: s("t3.small"),
  rootSizeGiB: i(30),
};
function defaults(service: string, input: Record<string, unknown> = {}) {
  const v = awsCatalogV1.validateConfiguration(service, input);
  if (!v.success) throw Error("Invalid synthetic configuration " + service);
  return v.values;
}
function node(id: string, service: string, values: unknown, parent?: unknown) {
  const definition = awsCatalogV1.getService(service);
  if (!definition) throw Error("Missing service");
  return {
    id,
    semantic: {
      deploymentKey: id,
      serviceType: service,
      resourceType: service,
      lifecycle,
      ...(parent ? { parent } : {}),
      configuration: {
        schemaId: definition.configuration.schemaId,
        schemaVersion: definition.configuration.schemaVersion,
        values,
      },
    },
    presentation: { label: id, position: { x: 0, y: 0 } },
  };
}
function edge(id: string, rel: string, source: string, target: string) {
  const rule = awsCatalogV1
    .listConnectionRules()
    .find((r) => r.relationshipType === rel);
  if (!rule) throw Error("Missing rule " + rel);
  return {
    id,
    semantic: {
      source: { nodeId: source, port: rule.source.portId },
      target: { nodeId: target, port: rule.target.portId },
      relationshipType: rel,
      configuration: {
        schemaId: rule.configuration.schemaId,
        schemaVersion: rule.configuration.schemaVersion,
        values: {},
      },
      lifecycle,
    },
  };
}
function fixture(): ArchitectureDocument {
  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 2,
    documentId: "document_ec2",
    architectureId: "architecture_ec2",
    revision: {
      revisionId: "revision_ec2",
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
        "instance",
        "aws.ec2.instance",
        defaults("aws.ec2.instance", ec2SyntheticInput),
      ),
      node(
        "profile",
        "aws.iam.instance-profile",
        defaults("aws.iam.instance-profile", {
          name: s("synthetic-instance-profile"),
        }),
      ),
      node("role", "aws.iam.role", defaults("aws.iam.role")),
      node(
        "region",
        "aws.region.boundary",
        defaults("aws.region.boundary", { regionName: s("us-east-1") }),
      ),
      node("vpc", "aws.ec2.vpc", defaults("aws.ec2.vpc"), {
        nodeId: "region",
        relationshipType: "aws.region.contains-vpc",
      }),
      node(
        "az",
        "aws.ec2.availability-zone",
        defaults("aws.ec2.availability-zone", { zoneName: s("us-east-1a") }),
        {
          nodeId: "vpc",
          relationshipType: "aws.ec2.vpc-contains-availability-zone",
        },
      ),
      node("subnet", "aws.ec2.subnet", defaults("aws.ec2.subnet"), {
        nodeId: "az",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      }),
      node(
        "group",
        "aws.ec2.security-group",
        defaults("aws.ec2.security-group"),
      ),
      node(
        "trust",
        "aws.iam.policy-document",
        { policyName: s("Ec2Trust"), policyKind: s("trust") },
        { nodeId: "role", relationshipType: "aws.iam.role-owns-trust-policy" },
      ),
      node(
        "statement",
        "aws.iam.policy-statement",
        {
          statementId: s("Ec2Trust"),
          effect: s("allow"),
          principalKind: s("service"),
          principals: l("ec2.amazonaws.com"),
          actions: l("sts:AssumeRole"),
          resourceExpressions: l(),
        },
        {
          nodeId: "trust",
          relationshipType: "aws.iam.policy-contains-statement",
        },
      ),
    ],
    edges: [
      edge("region_vpc", "aws.region.contains-vpc", "region", "vpc"),
      edge("vpc_az", "aws.ec2.vpc-contains-availability-zone", "vpc", "az"),
      edge(
        "az_subnet",
        "aws.ec2.availability-zone-contains-subnet",
        "az",
        "subnet",
      ),
      edge(
        "vpc_group",
        "aws.ec2.vpc-associates-security-group",
        "vpc",
        "group",
      ),
      edge(
        "instance_subnet",
        "aws.ec2.instance-uses-subnet",
        "instance",
        "subnet",
      ),
      edge(
        "instance_group",
        "aws.ec2.instance-uses-security-group",
        "instance",
        "group",
      ),
      edge(
        "role_profile",
        "aws.iam.role-binds-instance-profile",
        "role",
        "profile",
      ),
      edge(
        "profile_instance",
        "aws.iam.instance-profile-supplies-instance",
        "profile",
        "instance",
      ),
      edge("trust_owner", "aws.iam.role-owns-trust-policy", "trust", "role"),
      edge(
        "trust_member",
        "aws.iam.policy-contains-statement",
        "statement",
        "trust",
      ),
    ],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    workloadBehavior: { contractVersion: 1, workloads: [] },
  });
}
function findings(d: ArchitectureDocument) {
  const r = executeArchitectureValidationRules(
    { document: d, target: "draft", environment: "development" },
    [createEc2ReadinessRuleV1(awsCatalogArtifactV1)],
  );
  expect(r.diagnostics).toEqual([]);
  return r.findings;
}
function change(
  d: ArchitectureDocument,
  id: string,
  values: Record<string, unknown>,
) {
  return parseArchitectureDocument({
    ...d,
    nodes: d.nodes.map((n) =>
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
describe("EC2 private compute foundation", () => {
  it("requires explicit image/root/type information and accepts only baseline configuration", () => {
    expect(
      awsCatalogV1.validateConfiguration("aws.ec2.instance", {}).success,
    ).toBe(false);
    expect(
      awsCatalogV1.validateConfiguration("aws.ec2.instance", ec2SyntheticInput)
        .success,
    ).toBe(true);
    for (const key of Object.keys(ec2SyntheticInput)) {
      const input = Object.fromEntries(
        Object.entries(ec2SyntheticInput).filter(
          ([candidate]) => candidate !== key,
        ),
      );
      expect(
        awsCatalogV1.validateConfiguration("aws.ec2.instance", input).success,
      ).toBe(false);
    }
    expect(
      awsCatalogV1.validateConfiguration("aws.iam.instance-profile", {})
        .success,
    ).toBe(false);
  });
  it.each([
    ["imageId", s("latest")],
    ["rootThroughputMiBps", i(250)],
    ["rootIops", i(6000)],
    ["publicIpv4", b(true)],
    ["metadataAuthentication", s("optional")],
    ["imageOperatingSystem", s("windows")],
    ["rootEncrypted", b(false)],
    ["userData", s("unsupported")],
  ])("rejects unsupported schema field %s", (key, value) => {
    expect(
      awsCatalogV1.validateConfiguration("aws.ec2.instance", {
        ...ec2SyntheticInput,
        [key]: value,
      }).success,
    ).toBe(false);
  });
  it("validates modeled intent while preserving separate external readiness warnings", () => {
    const f = findings(fixture());
    expect(f.filter((x) => x.severity === "security-error")).toEqual([]);
    expect(f.map((x) => x.code)).toEqual(
      expect.arrayContaining([
        "aws.validation.ec2-image-external",
        "aws.validation.ec2-launch-external",
        "aws.validation.ec2-profile-authority",
      ]),
    );
    expect(f.every((x) => x.autoFix === undefined)).toBe(true);
  });
  it.each([
    ["imageRegion", s("us-west-2"), "image-region"],
    ["imageArchitecture", s("arm64"), "image-type"],
    ["rootSizeGiB", i(7), "root-size"],
    ["imageRootDeviceName", s("/dev/sdf"), "root-device"],
    ["rootThroughputMiBps", i(250), "field-root-throughput-mi-bps"],
    ["metadataHopLimit", i(65), "metadata-hop"],
  ])("finds exact semantic invalidity %s", (key, value, code) => {
    expect(
      findings(change(fixture(), "instance", { [key]: value })).map(
        (x) => x.code,
      ),
    ).toContain("aws.validation.ec2-" + code);
  });
  it("checks EC2 trust independently of network/profile wiring", () => {
    expect(
      findings(
        change(fixture(), "statement", {
          principals: l("lambda.amazonaws.com"),
        }),
      ).map((x) => x.code),
    ).toContain("aws.validation.ec2-trust");
    expect(
      findings(
        change(fixture(), "statement", { resourceExpressions: l("*") }),
      ).map((x) => x.code),
    ).toContain("aws.validation.ec2-trust");
  });
  it("rejects malformed trust and placement provenance even when dependency endpoints exist", () => {
    const d = fixture();
    for (const edgeId of [
      "trust_owner",
      "trust_member",
      "vpc_az",
      "az_subnet",
    ]) {
      const invalid = parseArchitectureDocument({
        ...d,
        edges: d.edges.filter((e) => e.id !== edgeId),
      });
      expect(
        findings(invalid).some((f) => f.severity === "security-error"),
      ).toBe(true);
    }
    expect(
      findings(change(d, "statement", { resourceExpressions: s("") })).map(
        (f) => f.code,
      ),
    ).toContain("aws.validation.ec2-trust");
    const roleEdge = d.edges.find((e) => e.id === "role_profile");
    if (!roleEdge) throw Error("Missing synthetic role binding");
    expect(
      findings(
        parseArchitectureDocument({
          ...d,
          edges: [...d.edges, { ...roleEdge, id: "duplicate_role_consumer" }],
        }),
      ).map((f) => f.code),
    ).toContain("aws.validation.ec2-profile-role");
  });
  it("rejects cross-VPC security groups and duplicate account-wide profile names", () => {
    const d = fixture();
    const other = node("other_vpc", "aws.ec2.vpc", defaults("aws.ec2.vpc"), {
      nodeId: "region",
      relationshipType: "aws.region.contains-vpc",
    });
    const differentVpc = parseArchitectureDocument({
      ...d,
      nodes: [...d.nodes, other],
      edges: [
        ...d.edges.filter((e) => e.id !== "vpc_group"),
        edge(
          "other_vpc_group",
          "aws.ec2.vpc-associates-security-group",
          "other_vpc",
          "group",
        ),
        edge(
          "region_other_vpc",
          "aws.region.contains-vpc",
          "region",
          "other_vpc",
        ),
      ],
    });
    expect(findings(differentVpc).map((f) => f.code)).toContain(
      "aws.validation.ec2-security-groups",
    );
    const profile = d.nodes.find((n) => n.id === "profile");
    if (!profile) throw Error("Missing synthetic profile");
    expect(
      findings(
        parseArchitectureDocument({
          ...d,
          nodes: [
            ...d.nodes,
            {
              ...profile,
              id: "other_profile",
              semantic: { ...profile.semantic, deploymentKey: "other_profile" },
            },
          ],
        }),
      ).map((f) => f.code),
    ).toContain("aws.validation.ec2-profile-name");
  });
  it("rejects missing and malformed exact dependency bindings", () => {
    const d = fixture();
    for (const id of [
      "instance_subnet",
      "instance_group",
      "role_profile",
      "profile_instance",
    ])
      expect(
        findings(
          parseArchitectureDocument({
            ...d,
            edges: d.edges.filter((e) => e.id !== id),
          }),
        ).some((x) => x.severity === "security-error"),
      ).toBe(true);
    const invalid = parseArchitectureDocument({
      ...d,
      edges: d.edges.map((e) =>
        e.id === "instance_subnet"
          ? {
              ...e,
              semantic: {
                ...e.semantic,
                source: {
                  ...e.semantic.source,
                  port: "aws.ec2.instance.security-group",
                },
              },
            }
          : e,
      ),
    });
    expect(findings(invalid).map((x) => x.code)).toContain(
      "aws.validation.ec2-subnet",
    );
  });
  it("checks explicit key mode and rejects missing or disabled customer keys", () => {
    expect(
      findings(
        change(fixture(), "instance", {
          rootEncryptionMode: s("customer-managed"),
        }),
      ).map((x) => x.code),
    ).toContain("aws.validation.ec2-root-key");
    const d = change(fixture(), "instance", {
      rootEncryptionMode: s("customer-managed"),
    });
    const keyed = parseArchitectureDocument({
      ...d,
      nodes: [...d.nodes, node("key", "aws.kms.key", defaults("aws.kms.key"))],
      edges: [
        ...d.edges,
        edge("root_key", "aws.kms.encrypts-instance-root", "key", "instance"),
      ],
    });
    expect(
      findings(keyed).filter((x) => x.severity === "security-error"),
    ).toEqual([]);
    expect(
      findings(change(keyed, "key", { enabled: b(false) })).map((x) => x.code),
    ).toContain("aws.validation.ec2-root-key");
  });
  it.each(ec2Bindings)(
    "previews exact atomic binding %s and inverse without generating IAM",
    (ruleId, relationship, sourceType, sourcePort, targetType, targetPort) => {
      let d = fixture();
      if (sourceType === "aws.kms.key")
        d = parseArchitectureDocument({
          ...d,
          nodes: [
            ...d.nodes,
            node("key", "aws.kms.key", defaults("aws.kms.key")),
          ],
        });
      const source = d.nodes.find((n) => n.semantic.serviceType === sourceType),
        target = d.nodes.find((n) => n.semantic.serviceType === targetType);
      if (!source || !target) throw Error("Missing synthetic dependency");
      d = parseArchitectureDocument({
        ...d,
        edges: d.edges.filter(
          (e) => e.semantic.relationshipType !== relationship,
        ),
      });
      const request = {
        document: d,
        ruleId,
        source: { nodeId: source.id, portId: sourcePort },
        target: { nodeId: target.id, portId: targetPort },
        configuration: {},
        operationId: "operation_ec2",
      };
      const r = awsConnectionResolverV1.resolve(request);
      expect(r.success).toBe(true);
      expect(awsConnectionResolverV1.resolve(request)).toEqual(r);
      if (!r.success) throw Error("Expected explicit binding");
      expect(r.batch.commands).toHaveLength(1);
      expect(r.preview.document.nodes).toEqual(d.nodes);
      const a = applyGraphCommand(d, r.batch);
      expect(a.inversion.kind).toBe("available");
      if (a.inversion.kind !== "available") throw Error("Missing inverse");
      expect(
        applyGraphCommand(a.document, a.inversion.command).document,
      ).toEqual(d);
      expect(
        awsConnectionResolverV1.resolve({
          ...request,
          source: request.target,
          target: request.source,
        }).success,
      ).toBe(false);
    },
  );
});
