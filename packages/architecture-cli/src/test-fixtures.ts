import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  normalizeArchitectureDocumentV3,
  repositoryRelativePathSchema,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";
import {
  SOLUTION_EXPORT_MANIFEST_PATH,
  exactToolPinV1Schema,
  SOLUTION_EXPORT_V1_MAXIMA,
  SOLUTION_EXPORT_ZIP_EPOCH,
  canonicalSemanticDigest,
  createDeterministicZip,
  encodeUtf8,
  sha256Digest,
  type SolutionExportArtifactV1,
  type SolutionExportFileV1,
  type SolutionExportManifestFileV1,
  solutionExportManifestV1Schema,
} from "@cloudmarkup/solution-export";
import {
  TEST_RENDERER,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";

import {
  ARCHITECTURE_CLI_ID,
  ARCHITECTURE_CLI_VERSION,
  architectureCliRepositoryProfileV1Schema,
  architectureCliSemanticSnapshotV1Schema,
  architectureCliServiceFactV1Schema,
  type ArchitectureCliSemanticSnapshotV1,
} from "./contracts.js";
import {
  ARCHITECTURE_CLI_PROFILE_PATH,
  architectureCliPinDigest,
  canonicalProfileBytes,
} from "./repository.js";
import { semanticSnapshotDigest } from "./semantic-diff.js";

const producer = exactToolPinV1Schema.parse({
  digest: sha256Digest("cloudmarkup.solution-exporter@1.0.0"),
  id: "cloudmarkup.solution-exporter",
  version: "1.0.0",
});

function file(
  path: string,
  content: string,
  mediaType: SolutionExportFileV1["mediaType"],
  solutionRevisionId: string,
  ownership: SolutionExportFileV1["ownership"] = "generated-replaceable",
): SolutionExportFileV1 {
  const bytes = encodeUtf8(content);
  return {
    bytes,
    checksum: sha256Digest(bytes),
    mediaType,
    ownership,
    path,
    provenance: {
      producer,
      solutionRevisionId,
      sourceReferences: [{ id: solutionRevisionId, kind: "solution-revision" }],
    },
    semanticChecksum: canonicalSemanticDigest(mediaType, bytes),
  };
}

function manifestFile(
  file: SolutionExportFileV1,
): SolutionExportManifestFileV1 {
  return {
    checksum: file.checksum,
    mediaType: file.mediaType,
    ownership: file.ownership,
    path: file.path as SolutionExportManifestFileV1["path"],
    provenance: file.provenance,
    semanticChecksum: file.semanticChecksum,
    sizeBytes: file.bytes.byteLength,
  };
}

export function architectureCliFixtureArtifact(
  changed = false,
): SolutionExportArtifactV1 {
  const fixture = workflowFixture();
  const revision = fixture.generationRequest.solutionRevision;
  const revisionDigest = sha256Digest(serializeCanonicalJson(revision));
  const sourceDocument = normalizeArchitectureDocumentV3(
    fixture.generationRequest.architectureDocument,
  );
  const {
    applicationContracts,
    externalResources,
    workloadBehavior,
    ...architecture
  } = sourceDocument;
  const tools = {
    catalog: exactToolPinV1Schema.parse({
      digest: revision.versions.catalog.digest,
      id: revision.versions.catalog.id,
      version: revision.versions.catalog.version,
    }),
    compiler: exactToolPinV1Schema.parse(fixture.compilation.compiler),
    generator: null,
    policyPacks: [],
    renderer: TEST_RENDERER,
  };
  const lock = {
    contractVersion: 1,
    inputs: {
      applicationContracts: revision.contracts.contentHash,
      architecture: revision.architecture.documentHash,
      externalResources: revision.externalResources.contentHash,
      workload: revision.workload.contentHash,
    },
    kind: "cloudmarkup.solution-export-lock",
    solutionRevision: {
      digest: revisionDigest,
      id: revision.solutionRevisionId,
    },
    tools,
  } as const;
  const payload = [
    file(
      "README.md",
      "# Notes architecture\n",
      "text/markdown",
      revision.solutionRevisionId,
    ),
    file(
      "cloudmarkup/architecture.json",
      serializeCanonicalJson(architecture),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/workloads.json",
      serializeCanonicalJson(workloadBehavior),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/external-resources.json",
      serializeCanonicalJson(externalResources),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/contracts/application-contracts.json",
      serializeCanonicalJson(applicationContracts),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/solution.json",
      serializeCanonicalJson(revision),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/cloudmarkup.lock.json",
      serializeCanonicalJson(lock),
      "application/json",
      revision.solutionRevisionId,
    ),
    file(
      "infrastructure/main.tf",
      changed
        ? 'terraform { required_version = ">= 1.9.0" }\n'
        : 'terraform { required_version = ">= 1.8.0" }\n',
      "application/vnd.hashicorp.terraform",
      revision.solutionRevisionId,
    ),
    file(
      "diagram/architecture.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Notes</title></svg>',
      "image/svg+xml",
      revision.solutionRevisionId,
    ),
    file(
      "evidence/status.json",
      serializeCanonicalJson({ contractVersion: 1, state: "current" }),
      "application/json",
      revision.solutionRevisionId,
      "evidence-artifact",
    ),
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const previousInfrastructureChecksum = changed
    ? architectureCliFixtureArtifact(false).files.find(
        ({ path }) => path === "infrastructure/main.tf",
      )?.checksum
    : undefined;
  const manifest = solutionExportManifestV1Schema.parse({
    application: null,
    archive: {
      compression: "store",
      ordering: "utf16-code-unit",
      timestamp: SOLUTION_EXPORT_ZIP_EPOCH,
    },
    artifactReferences: [],
    contractVersion: 1,
    diagram: null,
    files: payload.map(manifestFile),
    generationCoverage: { revision: revision.generationCoverage },
    infrastructure: { artifactDigest: sha256Digest("infrastructure-artifact") },
    inputs: {
      applicationContracts: revision.contracts.contentHash,
      architectureContent: revision.architecture.contentHash,
      architectureDocument: revision.architecture.documentHash,
      architectureVisual: revision.architecture.visualHash,
      externalResources: revision.externalResources.contentHash,
      workload: revision.workload.contentHash,
    },
    kind: "cloudmarkup.solution-export-manifest",
    limits: {
      maxArchiveBytes: SOLUTION_EXPORT_V1_MAXIMA.archiveBytes,
      maxDecompressedBytes: SOLUTION_EXPORT_V1_MAXIMA.decompressedBytes,
      maxFileBytes: SOLUTION_EXPORT_V1_MAXIMA.fileBytes,
      maxFiles: SOLUTION_EXPORT_V1_MAXIMA.files,
      maxPathBytes: SOLUTION_EXPORT_V1_MAXIMA.pathBytes,
    },
    ownership: payload.map((entry) => ({
      ...(entry.path === "infrastructure/main.tf" &&
      previousInfrastructureChecksum !== undefined
        ? { baselineChecksum: previousInfrastructureChecksum }
        : {}),
      conflictBehavior:
        entry.ownership === "generated-replaceable"
          ? ("replace-only-when-baseline-matches" as const)
          : ("fail-closed" as const),
      ownership: entry.ownership,
      path: entry.path as never,
      regeneration:
        entry.ownership === "generated-replaceable"
          ? ("verified-replacement" as const)
          : ("never" as const),
    })),
    package: {
      archiveFileName: "notes-architecture.zip",
      displayName: "Notes architecture",
    },
    provenance: { artifacts: [], contracts: [], policies: [], resources: [] },
    solutionRevision: {
      digest: revisionDigest,
      id: revision.solutionRevisionId,
    },
    status: {
      evidence: {
        evidenceIdsAtFreeze: revision.evidenceIdsAtFreeze,
        state: "not-collected-by-export",
      },
      validation: { state: "not-run-by-export" },
    },
    target: {
      formatVersion: "1.0.0",
      kind: "terraform",
      providers: [{ source: "hashicorp/aws", versionConstraint: "~> 6.0" }],
      requiredTerraformVersion: ">= 1.8.0",
    },
    tools,
    warnings: [],
  });
  const manifestOutput = file(
    SOLUTION_EXPORT_MANIFEST_PATH,
    serializeCanonicalJson(manifest),
    "application/json",
    revision.solutionRevisionId,
  );
  const files = [...payload, manifestOutput].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const zipBytes = createDeterministicZip(files);
  return {
    archiveFileName: manifest.package.archiveFileName,
    files,
    manifest,
    manifestDigest: manifestOutput.checksum,
    zipBytes,
    zipDigest: sha256Digest(zipBytes),
  };
}

const networkingEndpointFixturePath = new URL(
  "./fixtures/aws-networking/networking-endpoint.tf",
  import.meta.url,
);
const networkingNatFixturePath = new URL(
  "./fixtures/aws-networking/networking-nat.tf",
  import.meta.url,
);

const AWS_NETWORKING_CATALOG = {
  digest:
    "sha256:17627252eb47c7f2a031ca04e90545e4775c0e0b598bd05b4fe4a0889fcd018d",
  id: "aws.cloudmarkup.notes-api-catalog",
  version: "0.10.0",
} as const;

interface NetworkingNodeFixtureInput {
  readonly deploymentKey: string;
  readonly id: string;
  readonly label: string;
  readonly parent?: {
    readonly nodeId: string;
    readonly relationshipType: string;
  };
  readonly position: { readonly x: number; readonly y: number };
  readonly schemaVersion?: string;
  readonly serviceId: string;
  readonly values: Readonly<Record<string, unknown>>;
}

function networkingNode(input: NetworkingNodeFixtureInput) {
  return {
    id: input.id,
    semantic: {
      deploymentKey: input.deploymentKey,
      serviceType: input.serviceId,
      resourceType: input.serviceId,
      configuration: {
        schemaId: `${input.serviceId}.configuration`,
        schemaVersion: input.schemaVersion ?? "1.0.0",
        values: input.values,
      },
      ...(input.parent === undefined ? {} : { parent: input.parent }),
      lifecycle: { ownership: "user", origin: "template" },
    },
    presentation: { label: input.label, position: input.position },
  };
}

interface NetworkingEdgeFixtureInput {
  readonly id: string;
  readonly relationshipType: string;
  readonly sourceNodeId: string;
  readonly sourcePort: string;
  readonly targetNodeId: string;
  readonly targetPort: string;
}

function networkingEdge(input: NetworkingEdgeFixtureInput) {
  return {
    id: input.id,
    semantic: {
      source: { nodeId: input.sourceNodeId, port: input.sourcePort },
      target: { nodeId: input.targetNodeId, port: input.targetPort },
      relationshipType: input.relationshipType,
      configuration: {
        schemaId: `${input.relationshipType}.connection`,
        schemaVersion: "1.0.0",
        values: {},
      },
      lifecycle: { ownership: "user", origin: "template" },
    },
  };
}

function architectureCliNetworkingFixtureDocument(
  changed: boolean,
): ArchitectureDocumentV3 {
  const base = normalizeArchitectureDocumentV3(
    workflowFixture().generationRequest.architectureDocument,
  );
  const revisionId = changed
    ? "revision_networking_nat_0002"
    : "revision_networking_endpoint_0001";
  const revision = {
    revisionId,
    revisionNumber: changed ? 2 : 1,
    createdAt: base.revision.createdAt,
    createdBy: base.revision.createdBy,
    sourceDraftId: changed
      ? "draft_networking_nat_0002"
      : "draft_networking_endpoint_0001",
    ...(changed
      ? { previousRevisionId: "revision_networking_endpoint_0001" }
      : {}),
  };
  const boundRevision = {
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
    ...(changed
      ? { previousRevisionId: "revision_networking_endpoint_0001" }
      : {}),
  };
  const commonNodes = [
    networkingNode({
      deploymentKey: "network_region",
      id: "node_region",
      label: "US East (N. Virginia)",
      position: { x: 40, y: 40 },
      serviceId: "aws.region.boundary",
      values: { regionName: { kind: "string", value: "us-east-1" } },
    }),
    networkingNode({
      deploymentKey: "application_vpc",
      id: "node_application_vpc",
      label: "Application VPC",
      parent: {
        nodeId: "node_region",
        relationshipType: "aws.region.contains-vpc",
      },
      position: { x: 40, y: 140 },
      serviceId: "aws.ec2.vpc",
      values: {
        cidrBlock: { kind: "string", value: "10.20.0.0/16" },
        enableDnsSupport: { kind: "boolean", value: true },
        enableDnsHostnames: { kind: "boolean", value: true },
        instanceTenancy: { kind: "string", value: "default" },
      },
    }),
    networkingNode({
      deploymentKey: "availability_zone_a",
      id: "node_az_a",
      label: "Availability Zone A",
      parent: {
        nodeId: "node_application_vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
      position: { x: 40, y: 140 },
      serviceId: "aws.ec2.availability-zone",
      values: { zoneName: { kind: "string", value: "us-east-1a" } },
    }),
    networkingNode({
      deploymentKey: "availability_zone_b",
      id: "node_az_b",
      label: "Availability Zone B",
      parent: {
        nodeId: "node_application_vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
      position: { x: 520, y: 140 },
      serviceId: "aws.ec2.availability-zone",
      values: { zoneName: { kind: "string", value: "us-east-1b" } },
    }),
    networkingNode({
      deploymentKey: "private_subnet_a",
      id: "node_private_a",
      label: "Private subnet A",
      parent: {
        nodeId: "node_az_a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
      position: { x: 40, y: 140 },
      serviceId: "aws.ec2.subnet",
      values: {
        cidrBlock: { kind: "string", value: "10.20.10.0/24" },
        accessTier: { kind: "string", value: "private" },
        mapPublicIpOnLaunch: { kind: "boolean", value: false },
        assignIpv6AddressOnCreation: { kind: "boolean", value: false },
      },
    }),
    networkingNode({
      deploymentKey: "private_subnet_b",
      id: "node_private_b",
      label: "Private subnet B",
      parent: {
        nodeId: "node_az_b",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
      position: { x: 40, y: 140 },
      serviceId: "aws.ec2.subnet",
      values: {
        cidrBlock: { kind: "string", value: "10.20.11.0/24" },
        accessTier: { kind: "string", value: "private" },
        mapPublicIpOnLaunch: { kind: "boolean", value: false },
        assignIpv6AddressOnCreation: { kind: "boolean", value: false },
      },
    }),
    networkingNode({
      deploymentKey: "private_route_table",
      id: "node_private_routes",
      label: "Private routes",
      parent: {
        nodeId: "node_application_vpc",
        relationshipType: "aws.ec2.vpc-contains-route-table",
      },
      position: { x: 400, y: 520 },
      serviceId: "aws.ec2.route-table",
      values: { name: { kind: "string", value: "private-routes" } },
    }),
    networkingNode({
      deploymentKey: "private_route_association_a",
      id: "node_private_route_association_a",
      label: "Private subnet A association",
      parent: {
        nodeId: "node_private_routes",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
      position: { x: 0, y: 0 },
      serviceId: "aws.ec2.route-table-association",
      values: {},
    }),
    networkingNode({
      deploymentKey: "private_route_association_b",
      id: "node_private_route_association_b",
      label: "Private subnet B association",
      parent: {
        nodeId: "node_private_routes",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
      position: { x: 0, y: 0 },
      serviceId: "aws.ec2.route-table-association",
      values: {},
    }),
    networkingNode({
      deploymentKey: "application_security_group",
      id: "node_application_security_group",
      label: "Application security group",
      position: { x: 1160, y: 300 },
      serviceId: "aws.ec2.security-group",
      values: {
        groupName: { kind: "string", value: "application-lambda" },
        description: {
          kind: "string",
          value: "Reviewed Lambda application traffic",
        },
      },
    }),
    networkingNode({
      deploymentKey: "application_egress_https",
      id: "node_application_egress_https",
      label: "Reviewed HTTPS egress",
      parent: {
        nodeId: "node_application_security_group",
        relationshipType: "aws.ec2.security-group-owns-egress-rule",
      },
      position: { x: 0, y: 0 },
      serviceId: "aws.ec2.security-group-egress-rule",
      values: {
        protocol: { kind: "string", value: "tcp" },
        fromPort: { kind: "integer", value: 443 },
        toPort: { kind: "integer", value: 443 },
        destinationIpv4Cidr: {
          kind: "string",
          value: changed ? "0.0.0.0/0" : "10.20.0.0/16",
        },
        description: { kind: "string", value: "Reviewed HTTPS egress" },
      },
    }),
    networkingNode({
      deploymentKey: "notes_lambda_vpc_access",
      id: "node_lambda_vpc_access",
      label: "Lambda VPC access",
      parent: {
        nodeId: "node_notes_function",
        relationshipType: "aws.lambda.owns-vpc-access-configuration",
      },
      position: { x: 0, y: 0 },
      schemaVersion: "1.1.0",
      serviceId: "aws.lambda.vpc-access-configuration",
      values: {
        egressRequirement: {
          kind: "string",
          value: changed ? "internet" : "s3",
        },
        ipv6AllowedForDualStack: { kind: "boolean", value: false },
      },
    }),
  ];
  const conditionalNodes = changed
    ? [
        networkingNode({
          deploymentKey: "public_subnet_a",
          id: "node_public_a",
          label: "Public subnet A",
          parent: {
            nodeId: "node_az_a",
            relationshipType: "aws.ec2.availability-zone-contains-subnet",
          },
          position: { x: 40, y: 360 },
          serviceId: "aws.ec2.subnet",
          values: {
            cidrBlock: { kind: "string", value: "10.20.1.0/24" },
            accessTier: { kind: "string", value: "public" },
            mapPublicIpOnLaunch: { kind: "boolean", value: true },
            assignIpv6AddressOnCreation: { kind: "boolean", value: false },
          },
        }),
        networkingNode({
          deploymentKey: "internet_gateway",
          id: "node_internet_gateway",
          label: "Internet gateway",
          position: { x: 1160, y: 40 },
          serviceId: "aws.ec2.internet-gateway",
          values: { name: { kind: "string", value: "application-igw" } },
        }),
        networkingNode({
          deploymentKey: "public_route_table",
          id: "node_public_routes",
          label: "Public routes",
          parent: {
            nodeId: "node_application_vpc",
            relationshipType: "aws.ec2.vpc-contains-route-table",
          },
          position: { x: 80, y: 520 },
          serviceId: "aws.ec2.route-table",
          values: { name: { kind: "string", value: "public-routes" } },
        }),
        networkingNode({
          deploymentKey: "public_default_route",
          id: "node_public_default_route",
          label: "0.0.0.0/0 to internet gateway",
          parent: {
            nodeId: "node_public_routes",
            relationshipType: "aws.ec2.route-table-owns-route",
          },
          position: { x: 0, y: 0 },
          serviceId: "aws.ec2.route",
          values: {
            destinationIpv4Cidr: { kind: "string", value: "0.0.0.0/0" },
          },
        }),
        networkingNode({
          deploymentKey: "public_route_association_a",
          id: "node_public_route_association_a",
          label: "Public subnet A association",
          parent: {
            nodeId: "node_public_routes",
            relationshipType: "aws.ec2.route-table-owns-subnet-association",
          },
          position: { x: 0, y: 0 },
          serviceId: "aws.ec2.route-table-association",
          values: {},
        }),
        networkingNode({
          deploymentKey: "nat_gateway_a",
          id: "node_nat_a",
          label: "NAT gateway A",
          parent: {
            nodeId: "node_public_a",
            relationshipType: "aws.ec2.subnet-contains-nat-gateway",
          },
          position: { x: 40, y: 160 },
          serviceId: "aws.ec2.nat-gateway",
          values: {
            allocationId: {
              kind: "variable-reference",
              variableId: "variable_reviewed_nat_allocation_id",
            },
            connectivityType: { kind: "string", value: "public" },
            availabilityMode: { kind: "string", value: "zonal" },
          },
        }),
        networkingNode({
          deploymentKey: "private_default_route",
          id: "node_private_default_route",
          label: "0.0.0.0/0 to NAT gateway",
          parent: {
            nodeId: "node_private_routes",
            relationshipType: "aws.ec2.route-table-owns-route",
          },
          position: { x: 0, y: 0 },
          serviceId: "aws.ec2.route",
          values: {
            destinationIpv4Cidr: { kind: "string", value: "0.0.0.0/0" },
          },
        }),
      ]
    : [
        networkingNode({
          deploymentKey: "s3_gateway_endpoint",
          id: "node_s3_endpoint",
          label: "S3 gateway endpoint",
          parent: {
            nodeId: "node_application_vpc",
            relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
          },
          position: { x: 760, y: 520 },
          serviceId: "aws.ec2.gateway-vpc-endpoint",
          values: {
            service: { kind: "string", value: "s3" },
            endpointType: { kind: "string", value: "Gateway" },
            policyMode: { kind: "string", value: "full-access" },
          },
        }),
      ];
  const commonEdges = [
    networkingEdge({
      id: "edge_region_vpc",
      relationshipType: "aws.region.contains-vpc",
      sourceNodeId: "node_region",
      sourcePort: "aws.region.boundary.vpc-placement",
      targetNodeId: "node_application_vpc",
      targetPort: "aws.ec2.vpc.region",
    }),
    networkingEdge({
      id: "edge_vpc_az_a",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
      sourceNodeId: "node_application_vpc",
      sourcePort: "aws.ec2.vpc.availability-zone-placement",
      targetNodeId: "node_az_a",
      targetPort: "aws.ec2.availability-zone.vpc",
    }),
    networkingEdge({
      id: "edge_vpc_az_b",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
      sourceNodeId: "node_application_vpc",
      sourcePort: "aws.ec2.vpc.availability-zone-placement",
      targetNodeId: "node_az_b",
      targetPort: "aws.ec2.availability-zone.vpc",
    }),
    networkingEdge({
      id: "edge_az_a_private_a",
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
      sourceNodeId: "node_az_a",
      sourcePort: "aws.ec2.availability-zone.subnet-placement",
      targetNodeId: "node_private_a",
      targetPort: "aws.ec2.subnet.availability-zone",
    }),
    networkingEdge({
      id: "edge_az_b_private_b",
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
      sourceNodeId: "node_az_b",
      sourcePort: "aws.ec2.availability-zone.subnet-placement",
      targetNodeId: "node_private_b",
      targetPort: "aws.ec2.subnet.availability-zone",
    }),
    networkingEdge({
      id: "edge_vpc_private_routes",
      relationshipType: "aws.ec2.vpc-contains-route-table",
      sourceNodeId: "node_application_vpc",
      sourcePort: "aws.ec2.vpc.route-table-placement",
      targetNodeId: "node_private_routes",
      targetPort: "aws.ec2.route-table.vpc",
    }),
    networkingEdge({
      id: "edge_private_association_a_owner",
      relationshipType: "aws.ec2.route-table-owns-subnet-association",
      sourceNodeId: "node_private_route_association_a",
      sourcePort: "aws.ec2.route-table-association.route-table",
      targetNodeId: "node_private_routes",
      targetPort: "aws.ec2.route-table.subnet-association",
    }),
    networkingEdge({
      id: "edge_private_association_b_owner",
      relationshipType: "aws.ec2.route-table-owns-subnet-association",
      sourceNodeId: "node_private_route_association_b",
      sourcePort: "aws.ec2.route-table-association.route-table",
      targetNodeId: "node_private_routes",
      targetPort: "aws.ec2.route-table.subnet-association",
    }),
    networkingEdge({
      id: "edge_private_association_a_subnet",
      relationshipType: "aws.ec2.route-table-association-targets-subnet",
      sourceNodeId: "node_private_route_association_a",
      sourcePort: "aws.ec2.route-table-association.subnet",
      targetNodeId: "node_private_a",
      targetPort: "aws.ec2.subnet.route-table-association",
    }),
    networkingEdge({
      id: "edge_private_association_b_subnet",
      relationshipType: "aws.ec2.route-table-association-targets-subnet",
      sourceNodeId: "node_private_route_association_b",
      sourcePort: "aws.ec2.route-table-association.subnet",
      targetNodeId: "node_private_b",
      targetPort: "aws.ec2.subnet.route-table-association",
    }),
    networkingEdge({
      id: "edge_vpc_security_group",
      relationshipType: "aws.ec2.vpc-associates-security-group",
      sourceNodeId: "node_application_vpc",
      sourcePort: "aws.ec2.vpc.security-group-association",
      targetNodeId: "node_application_security_group",
      targetPort: "aws.ec2.security-group.vpc",
    }),
    networkingEdge({
      id: "edge_application_egress_owner",
      relationshipType: "aws.ec2.security-group-owns-egress-rule",
      sourceNodeId: "node_application_egress_https",
      sourcePort: "aws.ec2.security-group-egress-rule.security-group",
      targetNodeId: "node_application_security_group",
      targetPort: "aws.ec2.security-group.egress-rule",
    }),
    networkingEdge({
      id: "edge_lambda_vpc_access",
      relationshipType: "aws.lambda.owns-vpc-access-configuration",
      sourceNodeId: "node_lambda_vpc_access",
      sourcePort: "aws.lambda.vpc-access-configuration.function",
      targetNodeId: "node_notes_function",
      targetPort: "aws.lambda.function.vpc-access",
    }),
    networkingEdge({
      id: "edge_lambda_subnet_a",
      relationshipType: "aws.lambda.vpc-access-uses-subnet",
      sourceNodeId: "node_lambda_vpc_access",
      sourcePort: "aws.lambda.vpc-access-configuration.subnet",
      targetNodeId: "node_private_a",
      targetPort: "aws.ec2.subnet.lambda-vpc-access",
    }),
    networkingEdge({
      id: "edge_lambda_subnet_b",
      relationshipType: "aws.lambda.vpc-access-uses-subnet",
      sourceNodeId: "node_lambda_vpc_access",
      sourcePort: "aws.lambda.vpc-access-configuration.subnet",
      targetNodeId: "node_private_b",
      targetPort: "aws.ec2.subnet.lambda-vpc-access",
    }),
    networkingEdge({
      id: "edge_lambda_security_group",
      relationshipType: "aws.lambda.vpc-access-uses-security-group",
      sourceNodeId: "node_lambda_vpc_access",
      sourcePort: "aws.lambda.vpc-access-configuration.security-group",
      targetNodeId: "node_application_security_group",
      targetPort: "aws.ec2.security-group.lambda-vpc-access",
    }),
  ];
  const conditionalEdges = changed
    ? [
        networkingEdge({
          id: "edge_az_a_public_a",
          relationshipType: "aws.ec2.availability-zone-contains-subnet",
          sourceNodeId: "node_az_a",
          sourcePort: "aws.ec2.availability-zone.subnet-placement",
          targetNodeId: "node_public_a",
          targetPort: "aws.ec2.subnet.availability-zone",
        }),
        networkingEdge({
          id: "edge_vpc_internet_gateway",
          relationshipType: "aws.ec2.vpc-attaches-internet-gateway",
          sourceNodeId: "node_application_vpc",
          sourcePort: "aws.ec2.vpc.internet-gateway-attachment",
          targetNodeId: "node_internet_gateway",
          targetPort: "aws.ec2.internet-gateway.vpc-attachment",
        }),
        networkingEdge({
          id: "edge_vpc_public_routes",
          relationshipType: "aws.ec2.vpc-contains-route-table",
          sourceNodeId: "node_application_vpc",
          sourcePort: "aws.ec2.vpc.route-table-placement",
          targetNodeId: "node_public_routes",
          targetPort: "aws.ec2.route-table.vpc",
        }),
        networkingEdge({
          id: "edge_public_route_owner",
          relationshipType: "aws.ec2.route-table-owns-route",
          sourceNodeId: "node_public_default_route",
          sourcePort: "aws.ec2.route.route-table",
          targetNodeId: "node_public_routes",
          targetPort: "aws.ec2.route-table.route",
        }),
        networkingEdge({
          id: "edge_public_route_internet_gateway",
          relationshipType: "aws.ec2.route-targets-internet-gateway",
          sourceNodeId: "node_public_default_route",
          sourcePort: "aws.ec2.route.internet-gateway-target",
          targetNodeId: "node_internet_gateway",
          targetPort: "aws.ec2.internet-gateway.route-target",
        }),
        networkingEdge({
          id: "edge_public_association_owner",
          relationshipType: "aws.ec2.route-table-owns-subnet-association",
          sourceNodeId: "node_public_route_association_a",
          sourcePort: "aws.ec2.route-table-association.route-table",
          targetNodeId: "node_public_routes",
          targetPort: "aws.ec2.route-table.subnet-association",
        }),
        networkingEdge({
          id: "edge_public_association_subnet",
          relationshipType: "aws.ec2.route-table-association-targets-subnet",
          sourceNodeId: "node_public_route_association_a",
          sourcePort: "aws.ec2.route-table-association.subnet",
          targetNodeId: "node_public_a",
          targetPort: "aws.ec2.subnet.route-table-association",
        }),
        networkingEdge({
          id: "edge_public_subnet_nat",
          relationshipType: "aws.ec2.subnet-contains-nat-gateway",
          sourceNodeId: "node_public_a",
          sourcePort: "aws.ec2.subnet.nat-gateway-placement",
          targetNodeId: "node_nat_a",
          targetPort: "aws.ec2.nat-gateway.subnet",
        }),
        networkingEdge({
          id: "edge_route_owner",
          relationshipType: "aws.ec2.route-table-owns-route",
          sourceNodeId: "node_private_default_route",
          sourcePort: "aws.ec2.route.route-table",
          targetNodeId: "node_private_routes",
          targetPort: "aws.ec2.route-table.route",
        }),
        networkingEdge({
          id: "edge_private_route_nat",
          relationshipType: "aws.ec2.route-targets-nat-gateway",
          sourceNodeId: "node_private_default_route",
          sourcePort: "aws.ec2.route.nat-gateway-target",
          targetNodeId: "node_nat_a",
          targetPort: "aws.ec2.nat-gateway.route-target",
        }),
      ]
    : [
        networkingEdge({
          id: "edge_vpc_s3_endpoint",
          relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
          sourceNodeId: "node_application_vpc",
          sourcePort: "aws.ec2.vpc.gateway-endpoint-placement",
          targetNodeId: "node_s3_endpoint",
          targetPort: "aws.ec2.gateway-vpc-endpoint.vpc",
        }),
        networkingEdge({
          id: "edge_endpoint_private_routes",
          relationshipType: "aws.ec2.gateway-endpoint-associates-route-table",
          sourceNodeId: "node_s3_endpoint",
          sourcePort: "aws.ec2.gateway-vpc-endpoint.route-table-association",
          targetNodeId: "node_private_routes",
          targetPort: "aws.ec2.route-table.gateway-endpoint-association",
        }),
      ];

  return normalizeArchitectureDocumentV3(
    architectureDocumentV3Schema.parse({
      ...base,
      documentId: "doc_notes_networking_fixture",
      architectureId: "architecture_notes_networking_fixture",
      revision,
      catalog: AWS_NETWORKING_CATALOG,
      applicationContracts: {
        ...base.applicationContracts,
        documentId: "doc_notes_networking_fixture",
        revision: boundRevision,
      },
      externalResources: {
        ...base.externalResources,
        documentId: "doc_notes_networking_fixture",
        architectureId: "architecture_notes_networking_fixture",
        revision: boundRevision,
      },
      nodes: [...base.nodes, ...commonNodes, ...conditionalNodes],
      edges: [...base.edges, ...commonEdges, ...conditionalEdges],
      variables: [
        ...base.variables,
        ...(changed
          ? [
              {
                id: "variable_reviewed_nat_allocation_id",
                key: "reviewed_nat_allocation_id",
                valueType: "string",
                required: true,
                description:
                  "Existing reviewed Elastic IP allocation for the public NAT gateway.",
              },
            ]
          : []),
      ],
    }),
  );
}

function architectureCliNetworkingFixtureSource(changed: boolean) {
  const fixture = workflowFixture();
  const architectureDocument =
    architectureCliNetworkingFixtureDocument(changed);
  const baseRevision = fixture.generationRequest.solutionRevision;
  const solutionRevisionId = changed
    ? "solution_networking_nat_revision_2"
    : "solution_networking_endpoint_revision_1";
  const solutionRevision = solutionRevisionManifestV1Schema.parse({
    ...baseRevision,
    solutionRevisionId,
    architecture: {
      ...baseRevision.architecture,
      revisionId: architectureDocument.revision.revisionId,
      contentHash: getArchitectureDocumentContentHash(architectureDocument),
      documentHash: getArchitectureDocumentCanonicalHash(architectureDocument),
      visualHash: getArchitectureDocumentVisualHash(architectureDocument),
    },
    workload: {
      ...baseRevision.workload,
      contentHash: getWorkloadBehaviorContentHash(
        architectureDocument.workloadBehavior,
      ),
    },
    contracts: {
      ...baseRevision.contracts,
      contentHash: getApplicationContractsContentHash(
        architectureDocument.applicationContracts,
      ),
    },
    externalResources: {
      ...baseRevision.externalResources,
      contentHash: getExternalResourceReferenceContentHash(
        architectureDocument.externalResources,
      ),
    },
    generationCoverage: {
      ...baseRevision.generationCoverage,
      solutionRevisionId,
    },
    versions: {
      ...baseRevision.versions,
      catalog: AWS_NETWORKING_CATALOG,
    },
  });
  return {
    architectureDocument,
    compilation: fixture.compilation,
    solutionRevision,
  };
}

/**
 * Builds a manifest-bound repository artifact for CLI orchestration tests. The
 * Terraform bytes are synthetic fixture data; compiler readiness is proved by
 * the compiler package rather than inferred here.
 */
export function architectureCliNetworkingFixtureArtifact(
  changed = false,
): SolutionExportArtifactV1 {
  const source = architectureCliNetworkingFixtureSource(changed);
  const revision = source.solutionRevision;
  const revisionDigest = sha256Digest(serializeCanonicalJson(revision));
  const {
    applicationContracts,
    externalResources,
    workloadBehavior,
    ...architecture
  } = source.architectureDocument;
  const tools = {
    catalog: exactToolPinV1Schema.parse(AWS_NETWORKING_CATALOG),
    compiler: exactToolPinV1Schema.parse(source.compilation.compiler),
    generator: null,
    policyPacks: [],
    renderer: TEST_RENDERER,
  };
  const lock = {
    contractVersion: 1,
    inputs: {
      applicationContracts: revision.contracts.contentHash,
      architecture: revision.architecture.documentHash,
      externalResources: revision.externalResources.contentHash,
      workload: revision.workload.contentHash,
    },
    kind: "cloudmarkup.solution-export-lock",
    solutionRevision: {
      digest: revisionDigest,
      id: revision.solutionRevisionId,
    },
    tools,
  } as const;
  const infrastructure = file(
    "infrastructure/main.tf",
    readFileSync(
      changed ? networkingNatFixturePath : networkingEndpointFixturePath,
      "utf8",
    ),
    "application/vnd.hashicorp.terraform",
    revision.solutionRevisionId,
  );
  const payload = [
    file(
      "README.md",
      "# Notes networking architecture\n",
      "text/markdown",
      revision.solutionRevisionId,
    ),
    file(
      "cloudmarkup/architecture.json",
      serializeCanonicalJson(architecture),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/workloads.json",
      serializeCanonicalJson(workloadBehavior),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/external-resources.json",
      serializeCanonicalJson(externalResources),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/contracts/application-contracts.json",
      serializeCanonicalJson(applicationContracts),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/solution.json",
      serializeCanonicalJson(revision),
      "application/json",
      revision.solutionRevisionId,
      "architecture-as-code-source",
    ),
    file(
      "cloudmarkup/cloudmarkup.lock.json",
      serializeCanonicalJson(lock),
      "application/json",
      revision.solutionRevisionId,
    ),
    infrastructure,
    file(
      "diagram/architecture.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Notes networking</title></svg>',
      "image/svg+xml",
      revision.solutionRevisionId,
    ),
    file(
      "evidence/status.json",
      serializeCanonicalJson({ contractVersion: 1, state: "current" }),
      "application/json",
      revision.solutionRevisionId,
      "evidence-artifact",
    ),
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const baselineChecksum = changed
    ? architectureCliNetworkingFixtureArtifact(false).files.find(
        ({ path }) => path === "infrastructure/main.tf",
      )?.checksum
    : undefined;
  const manifest = solutionExportManifestV1Schema.parse({
    application: null,
    archive: {
      compression: "store",
      ordering: "utf16-code-unit",
      timestamp: SOLUTION_EXPORT_ZIP_EPOCH,
    },
    artifactReferences: [],
    contractVersion: 1,
    diagram: null,
    files: payload.map(manifestFile),
    generationCoverage: { revision: revision.generationCoverage },
    infrastructure: { artifactDigest: sha256Digest(infrastructure.bytes) },
    inputs: {
      applicationContracts: revision.contracts.contentHash,
      architectureContent: revision.architecture.contentHash,
      architectureDocument: revision.architecture.documentHash,
      architectureVisual: revision.architecture.visualHash,
      externalResources: revision.externalResources.contentHash,
      workload: revision.workload.contentHash,
    },
    kind: "cloudmarkup.solution-export-manifest",
    limits: {
      maxArchiveBytes: SOLUTION_EXPORT_V1_MAXIMA.archiveBytes,
      maxDecompressedBytes: SOLUTION_EXPORT_V1_MAXIMA.decompressedBytes,
      maxFileBytes: SOLUTION_EXPORT_V1_MAXIMA.fileBytes,
      maxFiles: SOLUTION_EXPORT_V1_MAXIMA.files,
      maxPathBytes: SOLUTION_EXPORT_V1_MAXIMA.pathBytes,
    },
    ownership: payload.map((entry) => ({
      ...(entry.path === "infrastructure/main.tf" &&
      baselineChecksum !== undefined
        ? { baselineChecksum }
        : {}),
      conflictBehavior:
        entry.ownership === "generated-replaceable"
          ? ("replace-only-when-baseline-matches" as const)
          : ("fail-closed" as const),
      ownership: entry.ownership,
      path: entry.path as never,
      regeneration:
        entry.ownership === "generated-replaceable"
          ? ("verified-replacement" as const)
          : ("never" as const),
    })),
    package: {
      archiveFileName: "notes-networking-architecture.zip",
      displayName: "Notes networking architecture",
    },
    provenance: { artifacts: [], contracts: [], policies: [], resources: [] },
    solutionRevision: {
      digest: revisionDigest,
      id: revision.solutionRevisionId,
    },
    status: {
      evidence: {
        evidenceIdsAtFreeze: revision.evidenceIdsAtFreeze,
        state: "not-collected-by-export",
      },
      validation: { state: "not-run-by-export" },
    },
    target: {
      formatVersion: "1.0.0",
      kind: "terraform",
      providers: [
        {
          source: "hashicorp/aws",
          versionConstraint: ">= 6.55.0, < 7.0.0",
        },
      ],
      requiredTerraformVersion: ">= 1.13.0, < 2.0.0",
    },
    tools,
    warnings: [],
  });
  const manifestOutput = file(
    SOLUTION_EXPORT_MANIFEST_PATH,
    serializeCanonicalJson(manifest),
    "application/json",
    revision.solutionRevisionId,
  );
  const files = [...payload, manifestOutput].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const zipBytes = createDeterministicZip(files);
  return {
    archiveFileName: manifest.package.archiveFileName,
    files,
    manifest,
    manifestDigest: manifestOutput.checksum,
    zipBytes,
    zipDigest: sha256Digest(zipBytes),
  };
}

/**
 * Models unexpected generated-file drift for the endpoint revision without
 * rewriting its architecture source or immutable Solution Revision. The exact
 * NAT design is represented separately by architectureCliNetworkingFixtureArtifact(true).
 */
export function architectureCliNetworkingGeneratedDriftArtifact(): SolutionExportArtifactV1 {
  const base = architectureCliNetworkingFixtureArtifact(false);
  const infrastructure = file(
    "infrastructure/main.tf",
    readFileSync(networkingNatFixturePath, "utf8"),
    "application/vnd.hashicorp.terraform",
    base.manifest.solutionRevision.id,
  );
  const payload = base.files
    .filter(({ path }) => path !== SOLUTION_EXPORT_MANIFEST_PATH)
    .map((entry) =>
      entry.path === "infrastructure/main.tf" ? infrastructure : entry,
    )
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  const ownershipByPath = new Map(
    base.manifest.ownership.map((entry) => [entry.path, entry]),
  );
  const baselineChecksum = base.files.find(
    ({ path }) => path === "infrastructure/main.tf",
  )?.checksum;
  if (baselineChecksum === undefined) {
    throw new TypeError(
      "Networking drift fixture requires endpoint Terraform.",
    );
  }
  const manifest = solutionExportManifestV1Schema.parse({
    ...base.manifest,
    files: payload.map(manifestFile),
    infrastructure: { artifactDigest: sha256Digest(infrastructure.bytes) },
    ownership: payload.map((entry) => {
      const existing = ownershipByPath.get(
        repositoryRelativePathSchema.parse(entry.path),
      );
      if (existing === undefined) {
        throw new TypeError("Networking drift ownership is incomplete.");
      }
      return entry.path === "infrastructure/main.tf"
        ? { ...existing, baselineChecksum }
        : existing;
    }),
  });
  const manifestOutput = file(
    SOLUTION_EXPORT_MANIFEST_PATH,
    serializeCanonicalJson(manifest),
    "application/json",
    base.manifest.solutionRevision.id,
  );
  const files = [...payload, manifestOutput].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const zipBytes = createDeterministicZip(files);
  return {
    archiveFileName: manifest.package.archiveFileName,
    files,
    manifest,
    manifestDigest: manifestOutput.checksum,
    zipBytes,
    zipDigest: sha256Digest(zipBytes),
  };
}

interface NetworkingServiceFixture {
  readonly costSensitive: boolean;
  readonly generated: boolean;
  readonly id: string;
  readonly publicExposure: "none" | "private" | "public" | "unknown";
  readonly serviceType: string;
}

interface NetworkingConnectionFixture {
  readonly id: string;
  readonly relationshipType: string;
  readonly sourceId: string;
  readonly targetId: string;
}

function fixtureFact<T extends { readonly id: string }>(input: T) {
  return {
    ...input,
    digest: sha256Digest(serializeCanonicalJson(input)),
  };
}

function compareFixtureId(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
}

export function architectureCliNetworkingFixtureSnapshot(
  changed = false,
): ArchitectureCliSemanticSnapshotV1 {
  const base = architectureCliFixtureSnapshot();
  const source = architectureCliNetworkingFixtureSource(changed);
  const commonServices: NetworkingServiceFixture[] = [
    {
      costSensitive: false,
      generated: false,
      id: "node_notes_function",
      publicExposure: "private",
      serviceType: "aws.lambda.function",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_application_security_group",
      publicExposure: "private",
      serviceType: "aws.ec2.security-group",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_application_vpc",
      publicExposure: "none",
      serviceType: "aws.ec2.vpc",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_az_a",
      publicExposure: "none",
      serviceType: "aws.ec2.availability-zone",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_az_b",
      publicExposure: "none",
      serviceType: "aws.ec2.availability-zone",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_lambda_vpc_access",
      publicExposure: "private",
      serviceType: "aws.lambda.vpc-access-configuration",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_private_a",
      publicExposure: "private",
      serviceType: "aws.ec2.subnet",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_private_b",
      publicExposure: "private",
      serviceType: "aws.ec2.subnet",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_private_routes",
      publicExposure: "private",
      serviceType: "aws.ec2.route-table",
    },
    {
      costSensitive: false,
      generated: false,
      id: "node_region",
      publicExposure: "none",
      serviceType: "aws.region.boundary",
    },
  ];
  const conditionalServices: NetworkingServiceFixture[] = changed
    ? [
        {
          costSensitive: false,
          generated: false,
          id: "node_internet_gateway",
          publicExposure: "public",
          serviceType: "aws.ec2.internet-gateway",
        },
        {
          costSensitive: true,
          generated: false,
          id: "node_nat_a",
          publicExposure: "public",
          serviceType: "aws.ec2.nat-gateway",
        },
        {
          costSensitive: false,
          generated: false,
          id: "node_private_default_route",
          publicExposure: "private",
          serviceType: "aws.ec2.route",
        },
        {
          costSensitive: false,
          generated: false,
          id: "node_public_a",
          publicExposure: "public",
          serviceType: "aws.ec2.subnet",
        },
      ]
    : [
        {
          costSensitive: false,
          generated: false,
          id: "node_s3_endpoint",
          publicExposure: "private",
          serviceType: "aws.ec2.gateway-vpc-endpoint",
        },
      ];
  const commonConnections: NetworkingConnectionFixture[] = [
    {
      id: "edge_az_a_private_a",
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
      sourceId: "node_az_a",
      targetId: "node_private_a",
    },
    {
      id: "edge_az_b_private_b",
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
      sourceId: "node_az_b",
      targetId: "node_private_b",
    },
    {
      id: "edge_lambda_security_group",
      relationshipType: "aws.lambda.vpc-access-uses-security-group",
      sourceId: "node_lambda_vpc_access",
      targetId: "node_application_security_group",
    },
    {
      id: "edge_lambda_subnet_a",
      relationshipType: "aws.lambda.vpc-access-uses-subnet",
      sourceId: "node_lambda_vpc_access",
      targetId: "node_private_a",
    },
    {
      id: "edge_lambda_subnet_b",
      relationshipType: "aws.lambda.vpc-access-uses-subnet",
      sourceId: "node_lambda_vpc_access",
      targetId: "node_private_b",
    },
    {
      id: "edge_lambda_vpc_access",
      relationshipType: "aws.lambda.owns-vpc-access-configuration",
      sourceId: "node_lambda_vpc_access",
      targetId: "node_notes_function",
    },
    {
      id: "edge_region_vpc",
      relationshipType: "aws.region.contains-vpc",
      sourceId: "node_region",
      targetId: "node_application_vpc",
    },
    {
      id: "edge_vpc_az_a",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
      sourceId: "node_application_vpc",
      targetId: "node_az_a",
    },
    {
      id: "edge_vpc_az_b",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
      sourceId: "node_application_vpc",
      targetId: "node_az_b",
    },
    {
      id: "edge_vpc_private_routes",
      relationshipType: "aws.ec2.vpc-contains-route-table",
      sourceId: "node_application_vpc",
      targetId: "node_private_routes",
    },
    {
      id: "edge_vpc_security_group",
      relationshipType: "aws.ec2.vpc-associates-security-group",
      sourceId: "node_application_vpc",
      targetId: "node_application_security_group",
    },
  ];
  const conditionalConnections: NetworkingConnectionFixture[] = changed
    ? [
        {
          id: "edge_az_a_public_a",
          relationshipType: "aws.ec2.availability-zone-contains-subnet",
          sourceId: "node_az_a",
          targetId: "node_public_a",
        },
        {
          id: "edge_private_route_nat",
          relationshipType: "aws.ec2.route-targets-nat-gateway",
          sourceId: "node_private_default_route",
          targetId: "node_nat_a",
        },
        {
          id: "edge_public_subnet_nat",
          relationshipType: "aws.ec2.subnet-contains-nat-gateway",
          sourceId: "node_public_a",
          targetId: "node_nat_a",
        },
        {
          id: "edge_route_owner",
          relationshipType: "aws.ec2.route-table-owns-route",
          sourceId: "node_private_default_route",
          targetId: "node_private_routes",
        },
        {
          id: "edge_vpc_internet_gateway",
          relationshipType: "aws.ec2.vpc-attaches-internet-gateway",
          sourceId: "node_application_vpc",
          targetId: "node_internet_gateway",
        },
      ]
    : [
        {
          id: "edge_endpoint_private_routes",
          relationshipType: "aws.ec2.gateway-endpoint-associates-route-table",
          sourceId: "node_s3_endpoint",
          targetId: "node_private_routes",
        },
        {
          id: "edge_vpc_s3_endpoint",
          relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
          sourceId: "node_application_vpc",
          targetId: "node_s3_endpoint",
        },
      ];
  const projection = architectureCliSemanticSnapshotV1Schema
    .omit({ snapshotDigest: true })
    .parse({
      connections: [...commonConnections, ...conditionalConnections]
        .map(fixtureFact)
        .sort(compareFixtureId),
      contractVersion: 1,
      contracts: base.contracts,
      coverage: base.coverage,
      events: base.events,
      kind: "cloudmarkup.repository-semantic-snapshot",
      permissions: base.permissions,
      readiness: { reasons: [], state: "ready" },
      routes: base.routes,
      services: [...commonServices, ...conditionalServices]
        .map(fixtureFact)
        .sort(compareFixtureId),
      solutionRevision: {
        digest: sha256Digest(serializeCanonicalJson(source.solutionRevision)),
        id: source.solutionRevision.solutionRevisionId,
      },
      unresolvedRequirements: [],
      workloadOperations: base.workloadOperations,
    });
  return architectureCliSemanticSnapshotV1Schema.parse({
    ...projection,
    snapshotDigest: semanticSnapshotDigest(projection),
  });
}

export function architectureCliFixtureSnapshot(
  changed = false,
): ArchitectureCliSemanticSnapshotV1 {
  const fixture = workflowFixture();
  const revision = fixture.generationRequest.solutionRevision;
  const serviceDigest = sha256Digest(
    changed ? "service-public" : "service-private",
  );
  const projection = {
    connections: [],
    contractVersion: 1 as const,
    contracts: [],
    coverage: {
      evidenceIds: revision.generationCoverage.evidence.map(
        ({ evidenceId }) => evidenceId,
      ),
      missingRequirements: revision.generationCoverage.missingRequirements,
      state: revision.generationCoverage.state,
      unresolvedRequirementIds: revision.generationCoverage.workloads.flatMap(
        ({ unresolvedRequirementIds }) => unresolvedRequirementIds,
      ),
    },
    events: [],
    kind: "cloudmarkup.repository-semantic-snapshot" as const,
    permissions: [],
    readiness: { reasons: [], state: "ready" as const },
    routes: [],
    services: [
      architectureCliServiceFactV1Schema.parse({
        costSensitive: true,
        digest: serviceDigest,
        generated: false,
        id: "node_notes_api",
        publicExposure: changed ? ("public" as const) : ("private" as const),
        serviceType: "aws.apigateway.http-api",
      }),
    ],
    solutionRevision: {
      digest: sha256Digest(serializeCanonicalJson(revision)),
      id: revision.solutionRevisionId,
    },
    unresolvedRequirements: [],
    workloadOperations: [],
  };
  return architectureCliSemanticSnapshotV1Schema.parse({
    ...projection,
    snapshotDigest: semanticSnapshotDigest(projection),
  });
}

export async function writeArchitectureCliFixtureRepository(
  artifact = architectureCliFixtureArtifact(),
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-cli-fixture-"));
  for (const output of artifact.files) {
    const target = join(root, ...output.path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, output.bytes);
  }
  const profile = architectureCliRepositoryProfileV1Schema.parse({
    cli: {
      digest: architectureCliPinDigest(),
      id: ARCHITECTURE_CLI_ID,
      version: ARCHITECTURE_CLI_VERSION,
    },
    contractVersion: 1,
    kind: "cloudmarkup.repository-verification-profile",
    paths: {
      lock: "cloudmarkup/cloudmarkup.lock.json",
      manifest: "cloudmarkup/cloudmarkup.manifest.json",
      solutionRevision: "cloudmarkup/solution.json",
    },
    pipelineProfile: {
      digest: `sha256:${"9".repeat(64)}`,
      id: "cloudmarkup.pipeline.aws-notes-v1",
      version: "1.0.0",
    },
  });
  await writeFile(
    join(root, ARCHITECTURE_CLI_PROFILE_PATH),
    canonicalProfileBytes(profile),
  );
  return root;
}
