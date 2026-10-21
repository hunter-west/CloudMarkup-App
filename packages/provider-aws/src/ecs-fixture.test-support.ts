import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
const s = (value: string) => ({ kind: "string", value });
const i = (value: number) => ({ kind: "integer", value });
const l = (...value: string[]) => ({ kind: "string-list", value });
const lifecycle = { ownership: "user", origin: "user" };
export function ecsFixture(ready = false) {
  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  const node = (
    id: string,
    type: string,
    input: Record<string, unknown>,
    parent?: { nodeId: string; relationshipType: string },
  ) => {
    const service = awsCatalogV1.getService(type);
    const result = awsCatalogV1.validateConfiguration(type, input);
    if (!service || !result.success)
      throw Error("Invalid synthetic " + type + " " + JSON.stringify(result));
    nodes.push({
      id,
      semantic: {
        deploymentKey: id,
        serviceType: type,
        resourceType: type,
        lifecycle,
        ...(parent ? { parent } : {}),
        configuration: {
          schemaId: service.configuration.schemaId,
          schemaVersion: service.configuration.schemaVersion,
          values: result.values,
        },
      },
      presentation: { label: id, position: { x: 0, y: 0 } },
    });
  };
  const edge = (
    id: string,
    rel: string,
    source: string,
    target: string,
    input: Record<string, unknown> = {},
  ) => {
    const rule = awsCatalogV1
      .listConnectionRules()
      .find((r) => r.relationshipType === rel);
    if (!rule) throw Error("Missing synthetic rule");
    edges.push({
      id,
      semantic: {
        relationshipType: rel,
        source: { nodeId: source, port: rule.source.portId },
        target: { nodeId: target, port: rule.target.portId },
        configuration: {
          schemaId: rule.configuration.schemaId,
          schemaVersion: rule.configuration.schemaVersion,
          values: input,
        },
        lifecycle,
      },
    });
  };
  node("repository", "aws.ecr.repository", {
    name: s("synthetic/application"),
  });
  node(
    "image",
    "aws.ecr.image-reference",
    {
      digest: s("sha256:" + "a".repeat(64)),
      architecture: s("x86_64"),
      manifestType: s("oci-image"),
      publicationStatus: s(
        ready ? "externally-confirmed" : "external-publication-required",
      ),
    },
    { nodeId: "repository", relationshipType: "aws.ecr.repository-owns-image" },
  );
  node("cluster", "aws.ecs.cluster", { name: s("SyntheticCluster") });
  node("task", "aws.ecs.task-definition", {
    family: s("SyntheticTask"),
    cpu: i(256),
    memoryMiB: i(512),
    architecture: s("x86_64"),
  });
  node(
    "container",
    "aws.ecs.container-definition",
    {
      name: s("Application"),
      containerPort: i(8080),
      user: s("10001:10001"),
      healthExecutable: s("/app/health"),
      logStreamPrefix: s("Application"),
    },
    { nodeId: "task", relationshipType: "aws.ecs.task-owns-container" },
  );
  node("service", "aws.ecs.service", {
    name: s("SyntheticService"),
    desiredCount: i(ready ? 1 : 0),
  });
  node("logs", "aws.cloudwatch.log-group", {
    logGroupName: s("/ecs/synthetic"),
  });
  node("secret", "aws.secretsmanager.secret", {
    name: s("synthetic/application/configuration"),
  });
  node("region", "aws.region.boundary", { regionName: s("us-east-1") });
  node(
    "vpc",
    "aws.ec2.vpc",
    {},
    { nodeId: "region", relationshipType: "aws.region.contains-vpc" },
  );
  node(
    "az",
    "aws.ec2.availability-zone",
    { zoneName: s("us-east-1a") },
    {
      nodeId: "vpc",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
    },
  );
  node(
    "subnet",
    "aws.ec2.subnet",
    { cidrBlock: s("10.0.1.0/24") },
    {
      nodeId: "az",
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
    },
  );
  node("group", "aws.ec2.security-group", { groupName: s("synthetic") });
  edge("region_vpc", "aws.region.contains-vpc", "region", "vpc");
  edge("vpc_az", "aws.ec2.vpc-contains-availability-zone", "vpc", "az");
  edge(
    "az_subnet",
    "aws.ec2.availability-zone-contains-subnet",
    "az",
    "subnet",
  );
  edge("vpc_group", "aws.ec2.vpc-associates-security-group", "vpc", "group");
  for (const id of ["execution_role", "application_role"]) {
    node(id, "aws.iam.role", { roleName: s(id) });
    node(
      id + "_trust",
      "aws.iam.policy-document",
      { policyKind: s("trust"), policyName: s(id + "_trust") },
      { nodeId: id, relationshipType: "aws.iam.role-owns-trust-policy" },
    );
    node(
      id + "_statement",
      "aws.iam.policy-statement",
      {
        statementId: s("AssumeRole"),
        effect: s("allow"),
        actions: l("sts:AssumeRole"),
        principalKind: s("service"),
        principals: l("ecs-tasks.amazonaws.com"),
        resourceExpressions: l(),
      },
      {
        nodeId: id + "_trust",
        relationshipType: "aws.iam.policy-contains-statement",
      },
    );
    edge(
      id + "_trust_owner",
      "aws.iam.role-owns-trust-policy",
      id + "_trust",
      id,
    );
    edge(
      id + "_trust_member",
      "aws.iam.policy-contains-statement",
      id + "_statement",
      id + "_trust",
    );
  }
  node(
    "attachment",
    "aws.iam.managed-policy-attachment",
    {
      displayName: s("Explicit ECS execution policy"),
      attachmentKind: s("managed-policy-attachment"),
      managedPolicyReference: s(
        "aws-managed:service-role/AmazonECSTaskExecutionRolePolicy",
      ),
    },
    {
      nodeId: "execution_role",
      relationshipType: "aws.iam.role-owns-managed-policy-attachment",
    },
  );
  edge(
    "attachment_owner",
    "aws.iam.role-owns-managed-policy-attachment",
    "attachment",
    "execution_role",
  );
  node(
    "secret_policy",
    "aws.iam.policy-document",
    { policyKind: s("identity-inline"), policyName: s("ReadInjectedSecret") },
    {
      nodeId: "execution_role",
      relationshipType: "aws.iam.role-owns-inline-policy",
    },
  );
  node(
    "secret_statement",
    "aws.iam.policy-statement",
    {
      statementId: s("ReadSecret"),
      effect: s("allow"),
      actions: l("secretsmanager:GetSecretValue"),
      principalKind: s("none"),
      principals: l(),
      resourceExpressions: l(),
      resourceNode: {
        kind: "node-reference",
        nodeId: "secret",
        attribute: "aws.secretsmanager.secret.arn",
      },
    },
    {
      nodeId: "secret_policy",
      relationshipType: "aws.iam.policy-contains-statement",
    },
  );
  edge(
    "secret_policy_owner",
    "aws.iam.role-owns-inline-policy",
    "secret_policy",
    "execution_role",
  );
  edge(
    "secret_member",
    "aws.iam.policy-contains-statement",
    "secret_statement",
    "secret_policy",
  );
  edge(
    "secret_scope",
    "aws.iam.authorizes-secret",
    "secret_statement",
    "secret",
  );
  for (const [id, rel, source, target] of [
    ["image_owner", "aws.ecr.repository-owns-image", "image", "repository"],
    ["container_owner", "aws.ecs.task-owns-container", "container", "task"],
    ["image_binding", "aws.ecs.container-uses-image", "image", "container"],
    ["cluster_binding", "aws.ecs.service-uses-cluster", "cluster", "service"],
    ["task_binding", "aws.ecs.service-uses-task", "task", "service"],
    [
      "execution_binding",
      "aws.ecs.task-uses-execution-role",
      "execution_role",
      "task",
    ],
    [
      "application_binding",
      "aws.ecs.task-uses-application-role",
      "application_role",
      "task",
    ],
    ["subnet_binding", "aws.ecs.service-uses-subnet", "service", "subnet"],
    [
      "group_binding",
      "aws.ecs.service-uses-security-group",
      "service",
      "group",
    ],
    ["logs_binding", "aws.ecs.container-writes-logs", "container", "logs"],
  ] as const)
    edge(id, rel, source, target);
  edge(
    "secret_binding",
    "aws.ecs.container-uses-secret",
    "secret",
    "container",
    {
      environmentName: s("DATABASE_PASSWORD"),
      populationStatus: s(
        ready ? "externally-confirmed" : "external-population-required",
      ),
    },
  );
  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 2,
    documentId: "document_ecs",
    architectureId: "architecture_ecs",
    revision: {
      revisionId: "revision_ecs",
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
    nodes,
    edges,
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    workloadBehavior: { contractVersion: 1, workloads: [] },
  });
}
