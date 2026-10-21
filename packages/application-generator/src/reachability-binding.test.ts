import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Digest } from "./constants.js";
import { generateApplication } from "./generate.js";
import {
  assertApplicationReachabilityBindingResultV1,
  deriveApplicationReachabilityBindingV1,
} from "./reachability-binding.js";
import type { NormalizedSolutionInput } from "./resolver.js";
import { createNotesGenerationRequest } from "./test-fixtures.js";

interface NetworkFixtureOptions {
  readonly endpointService?: "dynamodb" | "s3";
  readonly endpointVpcTopology?:
    "complete" | "missing-backing-edge" | "missing-parent" | "other-vpc";
  readonly includeEndpoint?: boolean;
  readonly includeNat?: boolean;
  readonly natEgressTopology?:
    | "complete"
    | "missing-public-association"
    | "missing-public-default-route"
    | "other-vpc-internet-gateway";
  readonly includeSecurityGroup?: boolean;
  readonly requirement:
    "dynamodb" | "internet" | "none" | "s3" | "s3-and-dynamodb";
  readonly reverse?: boolean;
}

interface FixtureParent {
  readonly id: string;
  readonly relationshipType: string;
}

function literal(value: unknown) {
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "string") return { kind: "string", value };
  throw new TypeError("The fixture accepts string and boolean values only.");
}

function resource(
  id: string,
  resourceType: string,
  schemaId = `${resourceType}.configuration`,
  schemaVersion = "1.0.0",
  values: Record<
    string,
    { readonly kind: string; readonly value: unknown }
  > = {},
  parent?: FixtureParent,
): NormalizedSolutionInput["resources"][number] {
  const fixture = {
    id,
    targetKey: `target_${id}`,
    deploymentKey: `deployment_${id}`,
    serviceType: resourceType,
    resourceType,
    ...(parent === undefined
      ? {}
      : {
          parent: {
            nodeId: parent.id,
            targetKey: `target_${parent.id}`,
            relationshipType: parent.relationshipType,
          },
        }),
    configuration: { schemaId, schemaVersion, values },
    lifecycle: { ownership: "generated" },
    workloadIds: id === "lambda_private" ? ["workload_notes"] : [],
  };
  return fixture;
}

function connection(
  id: string,
  sourceId: string,
  targetId: string,
  relationshipType: string,
): NormalizedSolutionInput["connections"][number] {
  return {
    id,
    source: { nodeId: sourceId, targetKey: `target_${sourceId}` },
    target: { nodeId: targetId, targetKey: `target_${targetId}` },
    relationshipType,
    configuration: {
      schemaId: `${relationshipType}.configuration`,
      schemaVersion: "1.0.0",
      values: {},
    },
    lifecycle: { ownership: "generated" },
  };
}

function networkSolution(
  options: NetworkFixtureOptions,
): NormalizedSolutionInput {
  const natEgressTopology = options.natEgressTopology ?? "complete";
  const endpointVpcTopology = options.endpointVpcTopology ?? "complete";
  const resources: NormalizedSolutionInput["resources"][number][] = [
    resource("vpc_workload", "aws.ec2.vpc"),
    ...(endpointVpcTopology === "other-vpc" ||
    natEgressTopology === "other-vpc-internet-gateway"
      ? [resource("vpc_other", "aws.ec2.vpc")]
      : []),
    resource(
      "availability_zone_a",
      "aws.ec2.availability-zone",
      "aws.ec2.availability-zone.configuration",
      "1.0.0",
      {},
      {
        id: "vpc_workload",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
    ),
    resource("lambda_private", "aws.lambda.function"),
    resource(
      "lambda_network",
      "aws.lambda.vpc-access-configuration",
      "aws.lambda.vpc-access-configuration.configuration",
      "1.1.0",
      {
        egressRequirement: literal(options.requirement),
        ipv6AllowedForDualStack: literal(false),
      },
    ),
    resource(
      "subnet_private_a",
      "aws.ec2.subnet",
      "aws.ec2.subnet.configuration",
      "1.0.0",
      { accessTier: literal("private") },
      {
        id: "availability_zone_a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    ),
    resource(
      "route_table_private_a",
      "aws.ec2.route-table",
      "aws.ec2.route-table.configuration",
      "1.0.0",
      {},
      {
        id: "vpc_workload",
        relationshipType: "aws.ec2.vpc-contains-route-table",
      },
    ),
    resource("subnet_route_association_a", "aws.ec2.route-table-association"),
    ...(options.includeSecurityGroup === false
      ? []
      : [resource("security_group_lambda", "aws.ec2.security-group")]),
    ...(options.includeEndpoint === true
      ? [
          resource(
            "private_service_endpoint",
            "aws.ec2.gateway-vpc-endpoint",
            "aws.ec2.gateway-vpc-endpoint.configuration",
            "1.0.0",
            {
              endpointType: literal("Gateway"),
              policyMode: literal("restricted"),
              service: literal(options.endpointService ?? "s3"),
            },
            endpointVpcTopology === "missing-parent"
              ? undefined
              : {
                  id:
                    endpointVpcTopology === "other-vpc"
                      ? "vpc_other"
                      : "vpc_workload",
                  relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
                },
          ),
        ]
      : []),
    ...(options.includeNat === true
      ? [
          resource(
            "subnet_public_nat_a",
            "aws.ec2.subnet",
            "aws.ec2.subnet.configuration",
            "1.0.0",
            { accessTier: literal("public") },
            {
              id: "availability_zone_a",
              relationshipType: "aws.ec2.availability-zone-contains-subnet",
            },
          ),
          resource(
            "route_table_public_a",
            "aws.ec2.route-table",
            "aws.ec2.route-table.configuration",
            "1.0.0",
            {},
            {
              id: "vpc_workload",
              relationshipType: "aws.ec2.vpc-contains-route-table",
            },
          ),
          resource(
            "nat_subnet_route_association_a",
            "aws.ec2.route-table-association",
          ),
          resource(
            "default_route",
            "aws.ec2.route",
            "aws.ec2.route.configuration",
            "1.0.0",
            { destinationIpv4Cidr: literal("0.0.0.0/0") },
          ),
          resource(
            "nat_egress_a",
            "aws.ec2.nat-gateway",
            "aws.ec2.nat-gateway.configuration",
            "1.0.0",
            {},
            {
              id: "subnet_public_nat_a",
              relationshipType: "aws.ec2.subnet-contains-nat-gateway",
            },
          ),
          resource(
            "public_default_route",
            "aws.ec2.route",
            "aws.ec2.route.configuration",
            "1.0.0",
            { destinationIpv4Cidr: literal("0.0.0.0/0") },
          ),
          resource("internet_gateway", "aws.ec2.internet-gateway"),
        ]
      : []),
  ];
  const connections: NormalizedSolutionInput["connections"][number][] = [
    connection(
      "edge_vpc_availability_zone",
      "vpc_workload",
      "availability_zone_a",
      "aws.ec2.vpc-contains-availability-zone",
    ),
    connection(
      "edge_availability_zone_private_subnet",
      "availability_zone_a",
      "subnet_private_a",
      "aws.ec2.availability-zone-contains-subnet",
    ),
    connection(
      "edge_vpc_private_route_table",
      "vpc_workload",
      "route_table_private_a",
      "aws.ec2.vpc-contains-route-table",
    ),
    connection(
      "edge_lambda_network_owner",
      "lambda_network",
      "lambda_private",
      "aws.lambda.owns-vpc-access-configuration",
    ),
    connection(
      "edge_lambda_subnet_a",
      "lambda_network",
      "subnet_private_a",
      "aws.lambda.vpc-access-uses-subnet",
    ),
    ...(options.includeSecurityGroup === false
      ? []
      : [
          connection(
            "edge_lambda_security_group",
            "lambda_network",
            "security_group_lambda",
            "aws.lambda.vpc-access-uses-security-group",
          ),
        ]),
    connection(
      "edge_association_table",
      "subnet_route_association_a",
      "route_table_private_a",
      "aws.ec2.route-table-owns-subnet-association",
    ),
    connection(
      "edge_association_subnet",
      "subnet_route_association_a",
      "subnet_private_a",
      "aws.ec2.route-table-association-targets-subnet",
    ),
    ...(options.includeEndpoint === true
      ? [
          ...(endpointVpcTopology === "missing-backing-edge"
            ? []
            : [
                connection(
                  "edge_vpc_gateway_endpoint",
                  endpointVpcTopology === "other-vpc"
                    ? "vpc_other"
                    : "vpc_workload",
                  "private_service_endpoint",
                  "aws.ec2.vpc-contains-gateway-endpoint",
                ),
              ]),
          connection(
            "edge_endpoint_route_table",
            "private_service_endpoint",
            "route_table_private_a",
            "aws.ec2.gateway-endpoint-associates-route-table",
          ),
        ]
      : []),
    ...(options.includeNat === true
      ? [
          connection(
            "edge_availability_zone_public_subnet",
            "availability_zone_a",
            "subnet_public_nat_a",
            "aws.ec2.availability-zone-contains-subnet",
          ),
          connection(
            "edge_public_subnet_nat",
            "subnet_public_nat_a",
            "nat_egress_a",
            "aws.ec2.subnet-contains-nat-gateway",
          ),
          connection(
            "edge_vpc_public_route_table",
            "vpc_workload",
            "route_table_public_a",
            "aws.ec2.vpc-contains-route-table",
          ),
          connection(
            "edge_nat_association_table",
            "nat_subnet_route_association_a",
            "route_table_public_a",
            "aws.ec2.route-table-owns-subnet-association",
          ),
          ...(natEgressTopology === "missing-public-association"
            ? []
            : [
                connection(
                  "edge_nat_association_subnet",
                  "nat_subnet_route_association_a",
                  "subnet_public_nat_a",
                  "aws.ec2.route-table-association-targets-subnet",
                ),
              ]),
          connection(
            "edge_route_owner",
            "default_route",
            "route_table_private_a",
            "aws.ec2.route-table-owns-route",
          ),
          connection(
            "edge_route_nat",
            "default_route",
            "nat_egress_a",
            "aws.ec2.route-targets-nat-gateway",
          ),
          ...(natEgressTopology === "missing-public-default-route"
            ? []
            : [
                connection(
                  "edge_public_route_owner",
                  "public_default_route",
                  "route_table_public_a",
                  "aws.ec2.route-table-owns-route",
                ),
                connection(
                  "edge_public_route_gateway",
                  "public_default_route",
                  "internet_gateway",
                  "aws.ec2.route-targets-internet-gateway",
                ),
              ]),
          connection(
            "edge_vpc_internet_gateway",
            natEgressTopology === "other-vpc-internet-gateway"
              ? "vpc_other"
              : "vpc_workload",
            "internet_gateway",
            "aws.ec2.vpc-attaches-internet-gateway",
          ),
        ]
      : []),
  ];
  const workloads: NormalizedSolutionInput["workloads"] = [
    {
      id: "workload_notes",
      owningResource: {
        nodeId: "lambda_private",
        targetKey: "target_lambda_private",
      },
      implementationMode: "complete-supported-pattern",
      runtimeFamily: "aws.lambda.runtime-family.nodejs24",
      languageFamily: "cloudmarkup.language.typescript",
      handler: "index.handler",
      environment: [],
      sourceOwnership: [],
      extensionPoints: [],
      specification: { id: "workload_notes" },
    },
  ];
  const fixture = {
    contractVersion: 1,
    provenance: {
      architectureDocumentId: "document_network",
      architectureId: "architecture_network",
      architectureRevisionId: "revision_network",
      architectureContentHash: `sha256:${"1".repeat(64)}`,
      architectureDocumentHash: `sha256:${"2".repeat(64)}`,
      architectureVisualHash: `sha256:${"3".repeat(64)}`,
      workloadContentHash: `sha256:${"4".repeat(64)}`,
      solutionRevisionId: "solution_revision_network",
      providerId: "aws",
      region: "us-east-1",
      catalog: {
        id: "aws.cloudmarkup.notes-api-catalog",
        version: "0.10.0",
        digest:
          "sha256:17627252eb47c7f2a031ca04e90545e4775c0e0b598bd05b4fe4a0889fcd018d",
      },
    },
    resources: options.reverse ? resources.reverse() : resources,
    connections: options.reverse ? connections.reverse() : connections,
    workloads,
  };
  return fixture;
}

describe("application reachability binding v1", () => {
  it("binds endpoint-backed object storage without copying provider topology into the capability", () => {
    const result = deriveApplicationReachabilityBindingV1(
      networkSolution({
        requirement: "s3",
        includeEndpoint: true,
        endpointService: "s3",
      }),
    );

    expect(result.artifact.catalog).toEqual({
      id: "aws.cloudmarkup.notes-api-catalog",
      version: "0.10.0",
      digest:
        "sha256:17627252eb47c7f2a031ca04e90545e4775c0e0b598bd05b4fe4a0889fcd018d",
    });
    expect(result.artifact.workloads).toEqual([
      expect.objectContaining({
        workloadId: "workload_notes",
        networkAttachment: "customer-network-interface",
        outboundRequirement: "object-storage",
        assumptions: [
          expect.objectContaining({
            capability: "object-storage-api",
            expectedPath: "private-service-endpoint",
            state: "declared",
          }),
        ],
      }),
    ]);
    expect(
      JSON.stringify(result.artifact.workloads[0]?.assumptions),
    ).not.toContain("aws.s3");
    expect(
      result.artifact.workloads[0]?.assumptions[0]?.sourceReferences,
    ).toEqual(
      expect.arrayContaining([
        {
          id: "edge_vpc_gateway_endpoint",
          kind: "normalized-connection",
        },
        { id: "vpc_workload", kind: "normalized-resource" },
      ]),
    );
    expect(() => {
      assertApplicationReachabilityBindingResultV1(result);
    }).not.toThrow();
  });

  it("keeps a missing or wrong endpoint path unresolved instead of inventing reachability", () => {
    const missing = deriveApplicationReachabilityBindingV1(
      networkSolution({ requirement: "s3" }),
    );
    const wrongService = deriveApplicationReachabilityBindingV1(
      networkSolution({
        requirement: "s3",
        includeEndpoint: true,
        endpointService: "dynamodb",
      }),
    );

    expect(missing.artifact.workloads[0]?.assumptions[0]?.state).toBe(
      "unresolved",
    );
    expect(wrongService.artifact.workloads[0]?.assumptions[0]?.state).toBe(
      "unresolved",
    );
  });

  it.each([
    ["its semantic parent is missing", "missing-parent"],
    ["its backing containment edge is missing", "missing-backing-edge"],
    ["it belongs to another VPC", "other-vpc"],
  ] as const)(
    "keeps endpoint reachability unresolved when %s",
    (_description, endpointVpcTopology) => {
      const result = deriveApplicationReachabilityBindingV1(
        networkSolution({
          requirement: "s3",
          includeEndpoint: true,
          endpointService: "s3",
          endpointVpcTopology,
        }),
      );

      expect(result.artifact.workloads[0]?.assumptions[0]).toMatchObject({
        capability: "object-storage-api",
        expectedPath: "private-service-endpoint",
        state: "unresolved",
      });
    },
  );

  it("recognizes internet egress through an exact NAT-subnet route and same-VPC internet gateway path", () => {
    const declared = deriveApplicationReachabilityBindingV1(
      networkSolution({ requirement: "internet", includeNat: true }),
    );
    const unresolved = deriveApplicationReachabilityBindingV1(
      networkSolution({ requirement: "internet" }),
    );

    expect(declared.artifact.workloads[0]?.assumptions[0]).toMatchObject({
      capability: "internet-egress",
      expectedPath: "reviewed-public-egress",
      state: "declared",
    });
    expect(unresolved.artifact.workloads[0]?.assumptions[0]?.state).toBe(
      "unresolved",
    );
  });

  it.each([
    [
      "the public-labeled NAT subnet has no exact route-table association",
      "missing-public-association",
    ],
    [
      "the NAT subnet route table has no IPv4 default route to the gateway",
      "missing-public-default-route",
    ],
    [
      "the internet gateway is attached to another VPC",
      "other-vpc-internet-gateway",
    ],
  ] as const)(
    "keeps internet reachability unresolved when %s",
    (_, topology) => {
      const solution = networkSolution({
        requirement: "internet",
        includeNat: true,
        natEgressTopology: topology,
      });

      expect(
        solution.resources.find(
          (candidate) => candidate.id === "subnet_public_nat_a",
        )?.configuration.values["accessTier"],
      ).toEqual(literal("public"));
      expect(
        deriveApplicationReachabilityBindingV1(solution).artifact.workloads[0]
          ?.assumptions[0]?.state,
      ).toBe("unresolved");
    },
  );

  it("keeps each combined managed-service requirement independently grounded", () => {
    const result = deriveApplicationReachabilityBindingV1(
      networkSolution({
        requirement: "s3-and-dynamodb",
        includeEndpoint: true,
        endpointService: "s3",
      }),
    );

    expect(result.artifact.workloads[0]?.assumptions).toEqual([
      expect.objectContaining({
        capability: "key-value-database-api",
        state: "unresolved",
      }),
      expect.objectContaining({
        capability: "object-storage-api",
        state: "declared",
      }),
    ]);
  });

  it("fails closed when the normalized network association omits a security policy", () => {
    expect(() => {
      deriveApplicationReachabilityBindingV1(
        networkSolution({
          requirement: "none",
          includeSecurityGroup: false,
        }),
      );
    }).toThrow(
      expect.objectContaining({
        code: "APPLICATION_REACHABILITY_ASSOCIATION_INCOMPLETE",
      }),
    );
  });

  it("rejects networking semantics outside the exact approved catalog", () => {
    const input = networkSolution({
      requirement: "s3",
      includeEndpoint: true,
      endpointService: "s3",
    });
    expect(() =>
      deriveApplicationReachabilityBindingV1({
        ...input,
        provenance: {
          ...input.provenance,
          catalog: {
            ...input.provenance.catalog,
            digest: `sha256:${"5".repeat(64)}`,
          },
        },
      }),
    ).toThrow(/requires the exact approved AWS networking catalog identity/u);
  });

  it("is order-stable and rejects a tampered artifact digest", () => {
    const forward = deriveApplicationReachabilityBindingV1(
      networkSolution({ requirement: "internet", includeNat: true }),
    );
    const reverse = deriveApplicationReachabilityBindingV1(
      networkSolution({
        requirement: "internet",
        includeNat: true,
        reverse: true,
      }),
    );
    expect(reverse).toEqual(forward);

    expect(() => {
      assertApplicationReachabilityBindingResultV1({
        ...forward,
        artifactDigest: `sha256:${"f".repeat(64)}`,
      });
    }).toThrow(
      expect.objectContaining({
        code: "APPLICATION_REACHABILITY_ARTIFACT_INVALID",
      }),
    );

    const firstWorkload = forward.artifact.workloads[0];
    if (firstWorkload === undefined) throw new TypeError("Missing workload.");
    const invalidArtifact = {
      ...forward.artifact,
      workloads: [
        {
          ...firstWorkload,
          networkAttachment: "provider-managed-network" as const,
        },
      ],
    };
    expect(() => {
      assertApplicationReachabilityBindingResultV1({
        contractVersion: 1,
        artifact: invalidArtifact,
        artifactDigest: sha256Digest(canonicalJson(invalidArtifact)),
      });
    }).toThrow(
      expect.objectContaining({
        code: "APPLICATION_REACHABILITY_ARTIFACT_INVALID",
      }),
    );
  });

  it("does not alter or embed network topology in generated application source", () => {
    const request = createNotesGenerationRequest({
      mode: "complete-supported-pattern",
    });
    const before = generateApplication(request);
    const sourceBefore = before.artifact.sourceFiles
      .filter((file) => file.mediaType === "text/typescript")
      .map(({ path, checksum }) => ({ path, checksum }));

    deriveApplicationReachabilityBindingV1(
      networkSolution({
        requirement: "s3",
        includeEndpoint: true,
        endpointService: "s3",
      }),
    );

    const after = generateApplication(request);
    const sourceAfter = after.artifact.sourceFiles
      .filter((file) => file.mediaType === "text/typescript")
      .map(({ path, checksum }) => ({ path, checksum }));
    expect(sourceAfter).toEqual(sourceBefore);
    const sourceText = after.artifact.sourceFiles
      .filter((file) => file.mediaType === "text/typescript")
      .map((file) => {
        if (!("content" in file) || typeof file.content !== "string")
          throw new TypeError("Missing source content.");
        return file.content;
      })
      .join("\n");
    expect(sourceText).not.toMatch(
      /lambda_network|subnet_private_a|private_service_endpoint|security_group_lambda/,
    );
  });
});
