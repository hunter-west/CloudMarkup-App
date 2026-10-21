import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";
import { rdsFixture } from "./rds-fixture.test-support.js";
export const auroraInputs = {
  "aws.aurora.postgresql-cluster": {
    identifier: { kind: "string", value: "synthetic-aurora" },
    engineVersion: { kind: "string", value: "16.6" },
    databaseName: { kind: "string", value: "SyntheticApp" },
    masterUsername: { kind: "string", value: "SyntheticAdmin" },
  },
  "aws.aurora.postgresql-instance": {
    identifier: { kind: "string", value: "synthetic-aurora-a" },
    availabilityZone: { kind: "string", value: "us-east-1a" },
    caIdentifier: { kind: "string", value: "rds-ca-rsa2048-g1" },
  },
  "aws.aurora.postgresql-cluster-parameter-group": {
    name: { kind: "string", value: "synthetic-aurora-tls" },
    description: {
      kind: "string",
      value: "Explicit synthetic Aurora TLS parameters",
    },
  },
} as const;
export function auroraFixture(twoMembers = true) {
  const base = rdsFixture();
  const removed = new Set(["database", "db_parameters"]);
  const nodes: unknown[] = base.nodes.filter((n) => !removed.has(n.id));
  const edges: unknown[] = base.edges.filter(
    (e) =>
      !removed.has(e.semantic.source.nodeId) &&
      !removed.has(e.semantic.target.nodeId),
  );
  const node = (id: string, type: string, values: Record<string, unknown>) => {
    const service = awsCatalogV1.requireService(type),
      configuration = awsCatalogV1.validateConfiguration(type, values);
    if (!configuration.success) throw Error("Invalid synthetic Aurora fixture");
    nodes.push({
      id,
      semantic: {
        deploymentKey: id,
        serviceType: type,
        resourceType: type,
        lifecycle: { ownership: "user", origin: "user" },
        configuration: {
          schemaId: service.configuration.schemaId,
          schemaVersion: service.configuration.schemaVersion,
          values: configuration.values,
        },
      },
      presentation: { label: id, position: { x: 0, y: 0 } },
    });
  };
  const edge = (id: string, rel: string, source: string, target: string) => {
    const rule = awsCatalogV1
      .listConnectionRules()
      .find((r) => r.relationshipType === rel);
    if (!rule) throw Error("Missing synthetic Aurora binding");
    edges.push({
      id,
      semantic: {
        relationshipType: rel,
        source: { nodeId: source, port: rule.source.portId },
        target: { nodeId: target, port: rule.target.portId },
        configuration: {
          schemaId: rule.configuration.schemaId,
          schemaVersion: rule.configuration.schemaVersion,
          values: {},
        },
        lifecycle: { ownership: "user", origin: "user" },
      },
    });
  };
  node(
    "aurora_cluster",
    "aws.aurora.postgresql-cluster",
    auroraInputs["aws.aurora.postgresql-cluster"],
  );
  node(
    "aurora_a",
    "aws.aurora.postgresql-instance",
    auroraInputs["aws.aurora.postgresql-instance"],
  );
  node(
    "aurora_parameters",
    "aws.aurora.postgresql-cluster-parameter-group",
    auroraInputs["aws.aurora.postgresql-cluster-parameter-group"],
  );
  for (const [id, rel, source, target] of [
    [
      "aurora_subnets",
      "aws.aurora.cluster-uses-subnet-group",
      "db_subnets",
      "aurora_cluster",
    ],
    [
      "aurora_tls",
      "aws.aurora.cluster-uses-parameter-group",
      "aurora_parameters",
      "aurora_cluster",
    ],
    [
      "aurora_member_a",
      "aws.aurora.cluster-has-instance",
      "aurora_cluster",
      "aurora_a",
    ],
    [
      "aurora_security",
      "aws.aurora.cluster-uses-security-group",
      "aurora_cluster",
      "group",
    ],
  ] as const)
    edge(id, rel, source, target);
  if (twoMembers) {
    node("aurora_b", "aws.aurora.postgresql-instance", {
      ...auroraInputs["aws.aurora.postgresql-instance"],
      identifier: { kind: "string", value: "synthetic-aurora-b" },
      availabilityZone: { kind: "string", value: "us-east-1b" },
      promotionTier: { kind: "integer", value: 1 },
    });
    edge(
      "aurora_member_b",
      "aws.aurora.cluster-has-instance",
      "aurora_cluster",
      "aurora_b",
    );
  }
  return parseArchitectureDocument({ ...base, nodes, edges });
}
