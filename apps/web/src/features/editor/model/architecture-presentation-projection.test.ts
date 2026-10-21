import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsNetworkingVisualArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { mapArchitectureDocumentToFlow } from "./architecture-flow-adapter.js";
import { isVisualContainmentEdge } from "./architecture-presentation-projection.js";

describe("AWS networking architecture presentation", () => {
  it("keeps managed services and policy associations outside visual containment", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const flow = mapArchitectureDocumentToFlow(document, awsEditorCatalog);

    expect(
      flow.nodes
        .filter((node) => node.parentId === "node_network_vpc")
        .map((node) => node.id)
        .sort(),
    ).toEqual([
      "node_availability_zone_a",
      "node_availability_zone_b",
      "node_private_route_table",
      "node_public_route_table",
      "node_s3_gateway_endpoint",
    ]);
    for (const nodeId of [
      "node_application_security_group",
      "node_application_table",
      "node_internet_gateway",
      "node_networked_lambda",
    ]) {
      const node = flow.nodes.find((candidate) => candidate.id === nodeId);
      expect(node, nodeId).toBeDefined();
      expect(node === undefined ? "missing" : "parentId" in node, nodeId).toBe(
        false,
      );
    }

    const vpcSecurityGroup = document.edges.find(
      (edge) =>
        edge.semantic.relationshipType ===
        "aws.ec2.vpc-associates-security-group",
    );
    expect(vpcSecurityGroup).toBeDefined();
    expect(
      vpcSecurityGroup === undefined
        ? true
        : isVisualContainmentEdge(document, awsEditorCatalog, vpcSecurityGroup),
    ).toBe(false);
    expect(
      flow.edges.find((edge) => edge.id === vpcSecurityGroup?.id)?.data
        ?.visualRole,
    ).toBe("association");
  });

  it("summarizes hidden routes, subnet associations, security-group rules, and Lambda VPC access on their visible owners", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const flow = mapArchitectureDocumentToFlow(document, awsEditorCatalog);
    const nodeData = (nodeId: string) => {
      const node = flow.nodes.find((candidate) => candidate.id === nodeId);
      if (node === undefined) {
        throw new TypeError(`Expected visible flow node ${nodeId}.`);
      }
      return node.data;
    };

    expect(flow.nodes.map((node) => node.id)).not.toContain(
      "node_lambda_vpc_access",
    );
    expect(flow.nodes.map((node) => node.id)).not.toContain(
      "node_public_default_route",
    );

    const publicRoutes = nodeData(
      "node_public_route_table",
    ).ownedConfigurationSummaries;
    expect(publicRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 1, label: "Routes" }),
        expect.objectContaining({
          count: 2,
          label: "Subnet associations",
        }),
      ]),
    );
    expect(
      publicRoutes.flatMap((summary) =>
        summary.entries.flatMap((entry) => entry.associations),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          remoteNodeId: "node_public_subnet_a",
          remoteNodeLabel: "Public subnet A · 10.0.1.0/24",
        }),
        expect.objectContaining({
          remoteNodeId: "node_public_subnet_b",
          remoteNodeLabel: "Public subnet B · 10.0.2.0/24",
        }),
      ]),
    );

    expect(
      nodeData("node_application_security_group").ownedConfigurationSummaries,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 1, label: "Egress rules" }),
        expect.objectContaining({ count: 1, label: "Ingress rules" }),
      ]),
    );

    const lambdaVpcAccess = nodeData(
      "node_networked_lambda",
    ).ownedConfigurationSummaries;
    expect(lambdaVpcAccess).toHaveLength(1);
    expect(lambdaVpcAccess[0]).toMatchObject({
      count: 1,
      label: "VPC access",
    });
    expect(
      lambdaVpcAccess[0]?.entries[0]?.associations.map(
        (association) => association.remoteNodeId,
      ),
    ).toEqual([
      "node_application_security_group",
      "node_private_subnet_a",
      "node_private_subnet_b",
    ]);
  });

  it("derives hidden route headings and current facts without trusting stale presentation labels", () => {
    const source = loadAwsNetworkingVisualArchitectureDocument();
    const document = parseArchitectureDocument({
      ...source,
      nodes: source.nodes.map((node) =>
        node.id === "node_public_default_route"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    destinationIpv4Cidr: {
                      kind: "string",
                      value: "10.42.0.0/16",
                    },
                  },
                },
              },
              presentation: {
                ...node.presentation,
                label: "Stale 0.0.0.0/0 route to the internet gateway",
              },
            }
          : node,
      ),
      edges: source.edges.map((edge) =>
        edge.id === "net_public_default.edge.connection"
          ? {
              ...edge,
              semantic: {
                ...edge.semantic,
                relationshipType: "aws.ec2.route-targets-nat-gateway",
                source: {
                  nodeId: "node_public_default_route",
                  port: "aws.ec2.route.nat-gateway-target",
                },
                target: {
                  nodeId: "node_nat_gateway_a",
                  port: "aws.ec2.nat-gateway.route-target",
                },
              },
            }
          : edge,
      ),
    });
    const routeTable = mapArchitectureDocumentToFlow(
      document,
      awsEditorCatalog,
    ).nodes.find((node) => node.id === "node_public_route_table");
    const route = routeTable?.data.ownedConfigurationSummaries
      .find((summary) => summary.slotId === "aws.ec2.route-table.slot.routes")
      ?.entries.find((entry) => entry.nodeId === "node_public_default_route");

    expect(route?.label).toBe("Route");
    expect(route?.facts).toContainEqual({
      label: "Destination IPv4 CIDR",
      tone: "cost",
      value: "10.42.0.0/16",
    });
    expect(route?.associations).toContainEqual(
      expect.objectContaining({
        remoteNodeId: "node_nat_gateway_a",
        remoteNodeLabel: "NAT gateway · AZ A",
      }),
    );
    expect(JSON.stringify(route)).not.toContain("Stale 0.0.0.0/0");
  });

  it("projects concise primary facts, plain-language education, stable association docks, and exact edge IDs", () => {
    const flow = mapArchitectureDocumentToFlow(
      loadAwsNetworkingVisualArchitectureDocument(),
      awsEditorCatalog,
    );
    const publicSubnet = flow.nodes.find(
      (node) => node.id === "node_public_subnet_a",
    );
    const natGateway = flow.nodes.find(
      (node) => node.id === "node_nat_gateway_a",
    );
    const endpoint = flow.nodes.find(
      (node) => node.id === "node_s3_gateway_endpoint",
    );
    const vpc = flow.nodes.find((node) => node.id === "node_network_vpc");

    expect(publicSubnet?.data.primaryFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Access tier", value: "public" }),
        expect.objectContaining({
          label: "IPv4 CIDR block",
          value: "10.0.1.0/24",
        }),
      ]),
    );
    expect(natGateway?.data.education?.considerations.join(" ")).toMatch(
      /hourly and per-gigabyte charges/u,
    );
    expect(endpoint?.data.education?.guidedExplanation).toMatch(
      /managed service stays outside your VPC/u,
    );
    expect(vpc?.data.associationBadges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          count: 2,
          edgeIds: [
            "net_vpc_igw.edge.connection",
            "net_vpc_security_group.edge.connection",
          ],
          id: "aws.ec2.vpc.dock.associations",
          label: "Associations",
        }),
      ]),
    );

    const association = flow.edges.find(
      (edge) =>
        edge.data?.relationshipType === "aws.ec2.vpc-associates-security-group",
    );
    expect(association).toMatchObject({
      sourceHandle: "dock:aws.ec2.vpc.dock.associations:output",
      targetHandle: "dock:aws.ec2.security-group.dock.vpc:input",
      data: {
        architectureEdgeId: "net_vpc_security_group.edge.connection",
        sourceConnectionGroupId: "aws.ec2.vpc.dock.associations",
        targetConnectionGroupId: "aws.ec2.security-group.dock.vpc",
        visualRole: "association",
      },
    });
  });
});
