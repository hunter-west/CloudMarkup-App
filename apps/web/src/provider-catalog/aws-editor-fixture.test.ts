import type { ArchitectureDocument } from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  editorConnectionGroupForPort,
  editorDockHandleId,
} from "../features/editor/model/connection-docks.js";
import { deriveArchitectureGeometry } from "../features/editor/model/architecture-geometry.js";
import { projectOwnedPolicyConfigurations } from "../features/editor/model/owned-configuration-policy-model.js";
import { awsEditorCatalog } from "./aws-editor-catalog.js";
import {
  loadAwsEditorArchitectureDocument,
  loadBlankAwsEditorArchitectureDocument,
  loadAwsNetworkingVisualArchitectureDocument,
  loadManualNotesApiArchitectureDocument,
  loadOwnedConfigurationVisualArchitectureDocument,
  loadStableConnectionDockVisualArchitectureDocument,
} from "./aws-editor-fixture.js";
import { awsOwnedPolicyGraphDescriptors } from "./aws-owned-policy-descriptors.js";

function requireFixtureNode(document: ArchitectureDocument, nodeId: string) {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new TypeError(`Expected fixture node ${nodeId}.`);
  }
  return node;
}

function fixtureEdgeFacts(
  document: ArchitectureDocument,
  relationshipTypes: ReadonlySet<string>,
) {
  return document.edges
    .filter((edge) => relationshipTypes.has(edge.semantic.relationshipType))
    .map((edge) => ({
      relationshipType: edge.semantic.relationshipType,
      source: edge.semantic.source,
      target: edge.semantic.target,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

function sortedEdgeFacts<T>(facts: readonly T[]): T[] {
  return [...facts].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

describe("AWS editor fixtures", () => {
  it("loads a distinct exact-catalog-bound blank Architecture Document", () => {
    const populatedDocument = loadAwsEditorArchitectureDocument();
    const blankDocument = loadBlankAwsEditorArchitectureDocument();

    expect(blankDocument).toMatchObject({
      documentId: "doc_blank_aws_editor_fixture",
      architectureId: "architecture_blank_aws_editor_fixture",
      revision: {
        revisionId: "revision_blank_aws_editor_0001",
        sourceDraftId: "draft_blank_aws_editor_0001",
      },
      provider: {
        id: awsEditorCatalog.providerId,
        region: "us-east-1",
      },
      catalog: awsEditorCatalog.identity,
      metadata: {
        source: "user",
      },
      schemaVersion: 3,
      workloadBehavior: {
        contractVersion: 2,
        workloads: [],
      },
      nodes: [],
      edges: [],
    });
    expect(blankDocument.documentId).not.toBe(populatedDocument.documentId);
    expect(blankDocument.architectureId).not.toBe(
      populatedDocument.architectureId,
    );
    expect(blankDocument.revision.revisionId).not.toBe(
      populatedDocument.revision.revisionId,
    );
    expect(blankDocument.revision.sourceDraftId).not.toBe(
      populatedDocument.revision.sourceDraftId,
    );
  });

  it("projects a source-free Workload Behavior v2 readiness fixture", () => {
    const document = loadAwsEditorArchitectureDocument();
    const workload = document.workloadBehavior.workloads[0];

    expect(workload).toMatchObject({
      id: "workload_notes_api_handler",
      owningNodeId: "node_api_handler",
      implementation: {
        mode: "user-provided",
        runtimeFamily: "aws.lambda.runtime-family.nodejs24",
        handler: "index.handler",
        sourceOwnership: "user",
      },
      triggerDispatch: { mode: "single" },
    });
    expect(workload?.triggers).toEqual([]);
    expect(workload?.downstreamActions).toEqual([]);
    expect(workload?.environment).toEqual([]);
    expect(JSON.stringify(workload)).not.toContain("sourceCode");
  });

  it("binds a schema-valid preferred Region to both new-start fixtures", () => {
    const blankDocument = loadBlankAwsEditorArchitectureDocument("us-west-2");
    const templateDocument =
      loadManualNotesApiArchitectureDocument("us-west-2");

    expect(blankDocument.provider.region).toBe("us-west-2");
    expect(templateDocument.provider.region).toBe("us-west-2");
    expect(loadBlankAwsEditorArchitectureDocument().provider.region).toBe(
      "us-east-1",
    );
    expect(() => loadBlankAwsEditorArchitectureDocument("US-WEST-2")).toThrow(
      /lowercase provider region identifier/u,
    );
  });

  it("projects every graph-backed IAM visual slot with exact ownership", () => {
    const document = loadOwnedConfigurationVisualArchitectureDocument();
    const projection = projectOwnedPolicyConfigurations(
      document,
      awsOwnedPolicyGraphDescriptors,
    );
    expect(projection.success).toBe(true);
    expect(
      document.nodes.find((node) => node.id === "node_iam_role_policy_fixture")
        ?.semantic.serviceType,
    ).toBe("aws.iam.role");

    const configurations = projection.configurations.filter(
      (configuration) =>
        configuration.ownerNodeId === "node_iam_role_policy_fixture",
    );
    expect(configurations).toHaveLength(5);
    const bySlot = new Map(
      configurations.map((configuration) => [
        configuration.slotId,
        configuration,
      ]),
    );
    expect([...bySlot.keys()]).toEqual(
      expect.arrayContaining([
        "aws.iam.role.slot.trust-policy",
        "aws.iam.role.slot.custom-inline-policy",
        "aws.iam.role.slot.generated-permission",
        "aws.iam.role.slot.managed-policy",
        "aws.iam.role.slot.permissions-boundary",
      ]),
    );
    expect(
      bySlot.get("aws.iam.role.slot.generated-permission")?.configurationNode
        .semantic.lifecycle.ownership,
    ).toBe("generated");
    for (const slotId of [
      "aws.iam.role.slot.trust-policy",
      "aws.iam.role.slot.custom-inline-policy",
      "aws.iam.role.slot.managed-policy",
      "aws.iam.role.slot.permissions-boundary",
    ]) {
      expect(
        bySlot.get(slotId)?.configurationNode.semantic.lifecycle.ownership,
      ).toBe("user");
    }

    const policies = projection.policies.filter(
      (policy) => policy.ownerNodeId === "node_iam_role_policy_fixture",
    );
    const policyKinds = policies.map((policy) => {
      const values = policy.configurationNode.semantic.configuration
        .values as unknown as Readonly<
        Record<string, { readonly kind: string; readonly value?: unknown }>
      >;
      const value = values["policyKind"];
      return value?.kind === "string" ? value.value : undefined;
    });
    expect(policyKinds).toEqual(
      expect.arrayContaining([
        "trust",
        "identity-inline",
        "generated-permission",
      ]),
    );
    expect(policies.every((policy) => policy.statements.length === 1)).toBe(
      true,
    );
  });

  it("builds the several-edge dock fixture through exact resolver relationships", () => {
    const document = loadStableConnectionDockVisualArchitectureDocument();
    const relationshipTypes = [
      "aws.iam.role-assumed-by-lambda",
      "aws.lambda.reads-dynamodb-table",
      "aws.lambda.writes-dynamodb-table",
    ];
    const connections = document.edges
      .filter((edge) =>
        relationshipTypes.includes(edge.semantic.relationshipType),
      )
      .map((edge) => ({
        relationshipType: edge.semantic.relationshipType,
        source: edge.semantic.source,
        target: edge.semantic.target,
      }))
      .sort((left, right) =>
        left.relationshipType.localeCompare(right.relationshipType),
      );

    expect(connections).toEqual([
      {
        relationshipType: "aws.iam.role-assumed-by-lambda",
        source: {
          nodeId: "node_notes_api_execution_role",
          port: "aws.iam.role.assumable-role",
        },
        target: {
          nodeId: "node_api_handler",
          port: "aws.lambda.function.execution-role",
        },
      },
      {
        relationshipType: "aws.lambda.reads-dynamodb-table",
        source: {
          nodeId: "node_api_handler",
          port: "aws.lambda.function.data-read",
        },
        target: {
          nodeId: "node_notes_table",
          port: "aws.dynamodb.table.table-api",
        },
      },
      {
        relationshipType: "aws.lambda.writes-dynamodb-table",
        source: {
          nodeId: "node_api_handler",
          port: "aws.lambda.function.data-write",
        },
        target: {
          nodeId: "node_notes_table",
          port: "aws.dynamodb.table.table-api",
        },
      },
    ]);

    const lambda = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.lambda.function",
    );
    if (lambda === undefined) {
      throw new TypeError("The stable dock fixture requires Lambda metadata.");
    }
    const readGroup = editorConnectionGroupForPort(
      lambda,
      "aws.lambda.function.data-read",
    );
    const writeGroup = editorConnectionGroupForPort(
      lambda,
      "aws.lambda.function.data-write",
    );
    if (readGroup === undefined || writeGroup === undefined) {
      throw new TypeError(
        "The stable dock fixture requires exact Lambda data groups.",
      );
    }
    expect(readGroup.id).toBe(writeGroup.id);
    expect(editorDockHandleId(readGroup.id, "output")).toBe(
      "dock:aws.lambda.function.dock.data:output",
    );
    expect(editorDockHandleId(writeGroup.id, "output")).toBe(
      "dock:aws.lambda.function.dock.data:output",
    );
  });

  it("builds exact Region, VPC, AZ, subnet, and owned-node parentage", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const parentByNodeId = Object.fromEntries(
      document.nodes.map((node) => [node.id, node.semantic.parent ?? null]),
    );

    expect(document.nodes).toHaveLength(25);
    expect(parentByNodeId).toEqual({
      node_application_egress_rule: {
        nodeId: "node_application_security_group",
        relationshipType: "aws.ec2.security-group-owns-egress-rule",
      },
      node_application_ingress_rule: {
        nodeId: "node_application_security_group",
        relationshipType: "aws.ec2.security-group-owns-ingress-rule",
      },
      node_application_security_group: null,
      node_application_table: null,
      node_availability_zone_a: {
        nodeId: "node_network_vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
      node_availability_zone_b: {
        nodeId: "node_network_vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
      node_internet_gateway: null,
      node_lambda_vpc_access: {
        nodeId: "node_networked_lambda",
        relationshipType: "aws.lambda.owns-vpc-access-configuration",
      },
      node_nat_gateway_a: {
        nodeId: "node_public_subnet_a",
        relationshipType: "aws.ec2.subnet-contains-nat-gateway",
      },
      node_network_region: null,
      node_network_vpc: {
        nodeId: "node_network_region",
        relationshipType: "aws.region.contains-vpc",
      },
      node_networked_lambda: null,
      node_private_default_route: {
        nodeId: "node_private_route_table",
        relationshipType: "aws.ec2.route-table-owns-route",
      },
      node_private_route_association_a: {
        nodeId: "node_private_route_table",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
      node_private_route_association_b: {
        nodeId: "node_private_route_table",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
      node_private_route_table: {
        nodeId: "node_network_vpc",
        relationshipType: "aws.ec2.vpc-contains-route-table",
      },
      node_private_subnet_a: {
        nodeId: "node_availability_zone_a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
      node_private_subnet_b: {
        nodeId: "node_availability_zone_b",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
      node_public_default_route: {
        nodeId: "node_public_route_table",
        relationshipType: "aws.ec2.route-table-owns-route",
      },
      node_public_route_association_a: {
        nodeId: "node_public_route_table",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
      node_public_route_association_b: {
        nodeId: "node_public_route_table",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
      node_public_route_table: {
        nodeId: "node_network_vpc",
        relationshipType: "aws.ec2.vpc-contains-route-table",
      },
      node_public_subnet_a: {
        nodeId: "node_availability_zone_a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
      node_public_subnet_b: {
        nodeId: "node_availability_zone_b",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
      node_s3_gateway_endpoint: {
        nodeId: "node_network_vpc",
        relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
      },
    });

    const boundaryNodeIds = new Set(
      document.nodes
        .filter((node) =>
          awsEditorCatalog.services.some(
            (service) =>
              service.serviceType === node.semantic.serviceType &&
              service.nodeKind === "boundary",
          ),
        )
        .map((node) => node.id),
    );
    const boundaryChildren = document.nodes.filter((node) =>
      node.semantic.parent === undefined
        ? false
        : boundaryNodeIds.has(node.semantic.parent.nodeId),
    );
    expect(boundaryChildren).toHaveLength(11);
    for (const child of boundaryChildren) {
      expect(child.presentation.position.x, child.id).toBeGreaterThanOrEqual(
        32,
      );
      expect(child.presentation.position.y, child.id).toBeGreaterThanOrEqual(
        160,
      );
    }
  });

  it("keeps VPC siblings separate from Availability Zone frames", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const geometry = deriveArchitectureGeometry(document, awsEditorCatalog);
    const vpc = requireFixtureNode(document, "node_network_vpc");
    const vpcSize = geometry.sizes.get(vpc.id);
    if (vpcSize === undefined) {
      throw new TypeError("Expected VPC geometry.");
    }
    const siblings = document.nodes
      .filter((node) => node.semantic.parent?.nodeId === vpc.id)
      .map((node) => {
        const size = geometry.sizes.get(node.id);
        if (size === undefined) {
          throw new TypeError(`Expected geometry for ${node.id}.`);
        }
        return { id: node.id, ...node.presentation.position, ...size };
      });
    expect(geometry.overflows).toEqual([]);

    for (const sibling of siblings) {
      expect(sibling.x, sibling.id).toBeGreaterThanOrEqual(32);
      expect(sibling.y, sibling.id).toBeGreaterThanOrEqual(160);
      expect(sibling.x + sibling.width, sibling.id).toBeLessThanOrEqual(
        vpcSize.width - 32,
      );
      expect(sibling.y + sibling.height, sibling.id).toBeLessThanOrEqual(
        vpcSize.height - 32,
      );
    }
    for (const [index, left] of siblings.entries()) {
      for (const right of siblings.slice(index + 1)) {
        expect(
          left.x + left.width + 32 <= right.x ||
            right.x + right.width + 32 <= left.x ||
            left.y + left.height + 32 <= right.y ||
            right.y + right.height + 32 <= left.y,
          `${left.id} must not overlap ${right.id}`,
        ).toBe(true);
      }
    }
  });

  it("keeps owned networking details hidden with normalized catalog configuration", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const hiddenNodeIds = [
      "node_public_default_route",
      "node_private_default_route",
      "node_public_route_association_a",
      "node_public_route_association_b",
      "node_private_route_association_a",
      "node_private_route_association_b",
      "node_application_ingress_rule",
      "node_application_egress_rule",
      "node_lambda_vpc_access",
    ];

    for (const nodeId of hiddenNodeIds) {
      const node = requireFixtureNode(document, nodeId);
      const service = awsEditorCatalog.services.find(
        (candidate) => candidate.serviceType === node.semantic.serviceType,
      );
      expect(service?.deployable, nodeId).toBe(false);
    }

    expect(
      requireFixtureNode(document, "node_public_default_route").semantic
        .configuration.values,
    ).toEqual({
      destinationIpv4Cidr: { kind: "string", value: "0.0.0.0/0" },
    });
    expect(
      requireFixtureNode(document, "node_private_default_route").semantic
        .configuration.values,
    ).toEqual({
      destinationIpv4Cidr: { kind: "string", value: "0.0.0.0/0" },
    });
    for (const nodeId of [
      "node_public_route_association_a",
      "node_public_route_association_b",
      "node_private_route_association_a",
      "node_private_route_association_b",
    ]) {
      expect(
        requireFixtureNode(document, nodeId).semantic.configuration.values,
      ).toEqual({});
    }
    expect(
      requireFixtureNode(document, "node_application_ingress_rule").semantic
        .configuration.values,
    ).toEqual({
      description: { kind: "string", value: "Reviewed inbound traffic" },
      fromPort: { kind: "integer", value: 443 },
      protocol: { kind: "string", value: "tcp" },
      sourceIpv4Cidr: { kind: "string", value: "10.0.0.0/16" },
      toPort: { kind: "integer", value: 443 },
    });
    expect(
      requireFixtureNode(document, "node_application_egress_rule").semantic
        .configuration.values,
    ).toEqual({
      description: { kind: "string", value: "Reviewed outbound traffic" },
      destinationIpv4Cidr: { kind: "string", value: "0.0.0.0/0" },
      fromPort: { kind: "integer", value: 443 },
      protocol: { kind: "string", value: "tcp" },
      toPort: { kind: "integer", value: 443 },
    });
    expect(
      requireFixtureNode(document, "node_lambda_vpc_access").semantic
        .configuration.values,
    ).toEqual({
      egressRequirement: { kind: "string", value: "none" },
      ipv6AllowedForDualStack: { kind: "boolean", value: false },
    });
    expect(
      requireFixtureNode(document, "node_nat_gateway_a").semantic.configuration
        .values,
    ).toEqual({
      allocationId: {
        kind: "string",
        value: "eipalloc-0123456789abcdef0",
      },
      availabilityMode: { kind: "string", value: "zonal" },
      connectivityType: { kind: "string", value: "public" },
    });
    expect(
      requireFixtureNode(document, "node_s3_gateway_endpoint").semantic
        .configuration.values,
    ).toEqual({
      endpointType: { kind: "string", value: "Gateway" },
      policyMode: { kind: "string", value: "full-access" },
      service: { kind: "string", value: "s3" },
    });
  });

  it("uses exact owner and resolver ports for networking associations", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const ownerRelationshipTypes = new Set([
      "aws.ec2.route-table-owns-route",
      "aws.ec2.route-table-owns-subnet-association",
      "aws.ec2.security-group-owns-ingress-rule",
      "aws.ec2.security-group-owns-egress-rule",
      "aws.lambda.owns-vpc-access-configuration",
    ]);
    expect(fixtureEdgeFacts(document, ownerRelationshipTypes)).toEqual(
      sortedEdgeFacts([
        {
          relationshipType: "aws.ec2.route-table-owns-route",
          source: {
            nodeId: "node_private_default_route",
            port: "aws.ec2.route.route-table",
          },
          target: {
            nodeId: "node_private_route_table",
            port: "aws.ec2.route-table.route",
          },
        },
        {
          relationshipType: "aws.ec2.route-table-owns-route",
          source: {
            nodeId: "node_public_default_route",
            port: "aws.ec2.route.route-table",
          },
          target: {
            nodeId: "node_public_route_table",
            port: "aws.ec2.route-table.route",
          },
        },
        ...[
          ["node_public_route_association_a", "node_public_route_table"],
          ["node_public_route_association_b", "node_public_route_table"],
          ["node_private_route_association_a", "node_private_route_table"],
          ["node_private_route_association_b", "node_private_route_table"],
        ].map(([associationId, routeTableId]) => ({
          relationshipType: "aws.ec2.route-table-owns-subnet-association",
          source: {
            nodeId: associationId,
            port: "aws.ec2.route-table-association.route-table",
          },
          target: {
            nodeId: routeTableId,
            port: "aws.ec2.route-table.subnet-association",
          },
        })),
        {
          relationshipType: "aws.ec2.security-group-owns-ingress-rule",
          source: {
            nodeId: "node_application_ingress_rule",
            port: "aws.ec2.security-group-ingress-rule.security-group",
          },
          target: {
            nodeId: "node_application_security_group",
            port: "aws.ec2.security-group.ingress-rule",
          },
        },
        {
          relationshipType: "aws.ec2.security-group-owns-egress-rule",
          source: {
            nodeId: "node_application_egress_rule",
            port: "aws.ec2.security-group-egress-rule.security-group",
          },
          target: {
            nodeId: "node_application_security_group",
            port: "aws.ec2.security-group.egress-rule",
          },
        },
        {
          relationshipType: "aws.lambda.owns-vpc-access-configuration",
          source: {
            nodeId: "node_lambda_vpc_access",
            port: "aws.lambda.vpc-access-configuration.function",
          },
          target: {
            nodeId: "node_networked_lambda",
            port: "aws.lambda.function.vpc-access",
          },
        },
      ]),
    );

    const resolverRelationshipTypes = new Set([
      "aws.ec2.route-table-association-targets-subnet",
      "aws.ec2.vpc-attaches-internet-gateway",
      "aws.ec2.route-targets-internet-gateway",
      "aws.ec2.route-targets-nat-gateway",
      "aws.ec2.gateway-endpoint-associates-route-table",
      "aws.ec2.vpc-associates-security-group",
      "aws.lambda.vpc-access-uses-subnet",
      "aws.lambda.vpc-access-uses-security-group",
    ]);
    expect(fixtureEdgeFacts(document, resolverRelationshipTypes)).toEqual(
      sortedEdgeFacts([
        ...[
          ["node_public_route_association_a", "node_public_subnet_a"],
          ["node_public_route_association_b", "node_public_subnet_b"],
          ["node_private_route_association_a", "node_private_subnet_a"],
          ["node_private_route_association_b", "node_private_subnet_b"],
        ].map(([associationId, subnetId]) => ({
          relationshipType: "aws.ec2.route-table-association-targets-subnet",
          source: {
            nodeId: associationId,
            port: "aws.ec2.route-table-association.subnet",
          },
          target: {
            nodeId: subnetId,
            port: "aws.ec2.subnet.route-table-association",
          },
        })),
        {
          relationshipType: "aws.ec2.vpc-attaches-internet-gateway",
          source: {
            nodeId: "node_network_vpc",
            port: "aws.ec2.vpc.internet-gateway-attachment",
          },
          target: {
            nodeId: "node_internet_gateway",
            port: "aws.ec2.internet-gateway.vpc-attachment",
          },
        },
        {
          relationshipType: "aws.ec2.route-targets-internet-gateway",
          source: {
            nodeId: "node_public_default_route",
            port: "aws.ec2.route.internet-gateway-target",
          },
          target: {
            nodeId: "node_internet_gateway",
            port: "aws.ec2.internet-gateway.route-target",
          },
        },
        {
          relationshipType: "aws.ec2.route-targets-nat-gateway",
          source: {
            nodeId: "node_private_default_route",
            port: "aws.ec2.route.nat-gateway-target",
          },
          target: {
            nodeId: "node_nat_gateway_a",
            port: "aws.ec2.nat-gateway.route-target",
          },
        },
        {
          relationshipType: "aws.ec2.gateway-endpoint-associates-route-table",
          source: {
            nodeId: "node_s3_gateway_endpoint",
            port: "aws.ec2.gateway-vpc-endpoint.route-table-association",
          },
          target: {
            nodeId: "node_private_route_table",
            port: "aws.ec2.route-table.gateway-endpoint-association",
          },
        },
        {
          relationshipType: "aws.ec2.vpc-associates-security-group",
          source: {
            nodeId: "node_network_vpc",
            port: "aws.ec2.vpc.security-group-association",
          },
          target: {
            nodeId: "node_application_security_group",
            port: "aws.ec2.security-group.vpc",
          },
        },
        {
          relationshipType: "aws.lambda.vpc-access-uses-subnet",
          source: {
            nodeId: "node_lambda_vpc_access",
            port: "aws.lambda.vpc-access-configuration.subnet",
          },
          target: {
            nodeId: "node_private_subnet_a",
            port: "aws.ec2.subnet.lambda-vpc-access",
          },
        },
        {
          relationshipType: "aws.lambda.vpc-access-uses-subnet",
          source: {
            nodeId: "node_lambda_vpc_access",
            port: "aws.lambda.vpc-access-configuration.subnet",
          },
          target: {
            nodeId: "node_private_subnet_b",
            port: "aws.ec2.subnet.lambda-vpc-access",
          },
        },
        {
          relationshipType: "aws.lambda.vpc-access-uses-security-group",
          source: {
            nodeId: "node_lambda_vpc_access",
            port: "aws.lambda.vpc-access-configuration.security-group",
          },
          target: {
            nodeId: "node_application_security_group",
            port: "aws.ec2.security-group.lambda-vpc-access",
          },
        },
      ]),
    );
    expect(document.edges).toHaveLength(21);
  });

  it("keeps provider-managed services and associations out of VPC containment", () => {
    const first = loadAwsNetworkingVisualArchitectureDocument();
    const second = loadAwsNetworkingVisualArchitectureDocument();
    expect(second).toEqual(first);

    for (const nodeId of [
      "node_internet_gateway",
      "node_application_security_group",
      "node_networked_lambda",
      "node_application_table",
    ]) {
      expect(
        requireFixtureNode(first, nodeId).semantic.parent,
        nodeId,
      ).toBeUndefined();
    }
    expect(
      first.nodes
        .filter((node) => node.semantic.parent?.nodeId === "node_network_vpc")
        .map((node) => node.id)
        .sort(),
    ).toEqual([
      "node_availability_zone_a",
      "node_availability_zone_b",
      "node_private_route_table",
      "node_public_route_table",
      "node_s3_gateway_endpoint",
    ]);
    expect(
      first.nodes
        .filter(
          (node) => node.semantic.parent?.nodeId === "node_networked_lambda",
        )
        .map((node) => node.id),
    ).toEqual(["node_lambda_vpc_access"]);
  });
});
