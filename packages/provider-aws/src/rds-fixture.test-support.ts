import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";
import { ecsFixture } from "./ecs-fixture.test-support.js";
export const rdsInputs = {
  "aws.rds.db-instance": {
    identifier: { kind: "string", value: "synthetic-postgres" },
    engineVersion: { kind: "string", value: "16.6" },
    instanceClass: { kind: "string", value: "db.t4g.small" },
    databaseName: { kind: "string", value: "SyntheticApp" },
    masterUsername: { kind: "string", value: "SyntheticAdmin" },
    storageGiB: { kind: "integer", value: 30 },
    caIdentifier: { kind: "string", value: "rds-ca-rsa2048-g1" },
  },
  "aws.rds.db-subnet-group": {
    name: { kind: "string", value: "synthetic-db-subnets" },
    description: {
      kind: "string",
      value: "Explicit synthetic database subnets",
    },
  },
  "aws.rds.db-parameter-group": {
    name: { kind: "string", value: "synthetic-postgres-tls" },
    description: { kind: "string", value: "Explicit synthetic TLS parameters" },
  },
} as const;
export function rdsFixture(multiAz = false) {
  const base = ecsFixture();
  const keep = new Set(["region", "vpc", "az", "subnet", "group"]);
  const nodes: unknown[] = base.nodes.filter((n) => keep.has(n.id));
  const edges: unknown[] = base.edges.filter(
    (e) =>
      keep.has(e.semantic.source.nodeId) && keep.has(e.semantic.target.nodeId),
  );
  const node = (
    id: string,
    type: string,
    input: Record<string, unknown>,
    parent?: { nodeId: string; relationshipType: string },
  ) => {
    const service = awsCatalogV1.requireService(type),
      configuration = awsCatalogV1.validateConfiguration(type, input);
    if (!configuration.success) throw Error("Invalid synthetic RDS fixture");
    nodes.push({
      id,
      semantic: {
        deploymentKey: id,
        serviceType: type,
        resourceType: type,
        lifecycle: { ownership: "user", origin: "user" },
        ...(parent ? { parent } : {}),
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
    if (!rule) throw Error("Missing synthetic RDS rule");
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
    "az_b",
    "aws.ec2.availability-zone",
    { zoneName: { kind: "string", value: "us-east-1b" } },
    {
      nodeId: "vpc",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
    },
  );
  node(
    "subnet_b",
    "aws.ec2.subnet",
    { cidrBlock: { kind: "string", value: "10.0.2.0/24" } },
    {
      nodeId: "az_b",
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
    },
  );
  edge("vpc_az_b", "aws.ec2.vpc-contains-availability-zone", "vpc", "az_b");
  edge(
    "az_subnet_b",
    "aws.ec2.availability-zone-contains-subnet",
    "az_b",
    "subnet_b",
  );
  node("database", "aws.rds.db-instance", {
    ...rdsInputs["aws.rds.db-instance"],
    multiAz: { kind: "boolean", value: multiAz },
  });
  node(
    "db_subnets",
    "aws.rds.db-subnet-group",
    rdsInputs["aws.rds.db-subnet-group"],
  );
  node(
    "db_parameters",
    "aws.rds.db-parameter-group",
    rdsInputs["aws.rds.db-parameter-group"],
  );
  edge(
    "db_subnet_a",
    "aws.rds.subnet-group-uses-subnet",
    "db_subnets",
    "subnet",
  );
  edge(
    "db_subnet_b",
    "aws.rds.subnet-group-uses-subnet",
    "db_subnets",
    "subnet_b",
  );
  edge(
    "db_subnets_binding",
    "aws.rds.instance-uses-subnet-group",
    "db_subnets",
    "database",
  );
  edge(
    "db_parameters_binding",
    "aws.rds.instance-uses-parameter-group",
    "db_parameters",
    "database",
  );
  edge(
    "db_group_binding",
    "aws.rds.instance-uses-security-group",
    "database",
    "group",
  );
  return parseArchitectureDocument({ ...base, nodes, edges });
}
