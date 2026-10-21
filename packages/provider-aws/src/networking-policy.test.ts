import {
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { defineProviderOwnedConfigurationSlotV1 } from "@cloudmarkup/provider-sdk";
import {
  serializeCanonicalJson,
  type ArchitectureDocumentV2,
  type ConfigurationValue,
  type ElementLifecycle,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { awsCatalogArtifactV1 } from "./catalog-v1-accessors.js";
import { gatewayEndpointOwnsPolicy } from "./catalog/connections/networking-connections.js";
import { awsGatewayVpcEndpointOwnedConfigurationSlotsV1 } from "./catalog/networking-service-extension.js";
import {
  projectAwsCanonicalPolicyDocumentsV1,
  type AwsCanonicalPolicyProjectionResultV1,
  type AwsPolicyOwnerSlotDescriptorV1,
} from "./policy/projection-v1.js";
import { createNetworkRoutingRuleV1 } from "./validation/index.js";
import { createIamPolicySafetyRuleV1 } from "./validation/iam-policy-safety-rule.js";

type TestNode = ArchitectureDocumentV2["nodes"][number];
type TestEdge = ArchitectureDocumentV2["edges"][number];

const endpointNodeId = "node_gateway_endpoint" as TestNode["id"];
const policyNodeId = "node_gateway_endpoint_policy" as TestNode["id"];
const statementNodeId = "node_gateway_endpoint_statement" as TestNode["id"];

function userLifecycle(): ElementLifecycle {
  return { ownership: "user", origin: "user" };
}

function configuration(
  schemaId: string,
  schemaVersion: string,
  values: Readonly<Record<string, ConfigurationValue>>,
) {
  return {
    schemaId,
    schemaVersion,
    values,
  } as TestNode["semantic"]["configuration"];
}

function node(
  id: string,
  serviceType: string,
  nodeConfiguration: TestNode["semantic"]["configuration"],
  parent?: { readonly nodeId: string; readonly relationshipType: string },
): TestNode {
  return {
    id,
    semantic: {
      deploymentKey: id,
      serviceType,
      resourceType: serviceType,
      configuration: nodeConfiguration,
      ...(parent === undefined ? {} : { parent }),
      lifecycle: userLifecycle(),
    },
    presentation: {
      label: id,
      position: { x: 0, y: 0 },
    },
  } as TestNode;
}

function edge(
  id: string,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
  relationshipType: string,
  schemaId: string,
): TestEdge {
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: sourcePort },
      target: { nodeId: targetNodeId, port: targetPort },
      relationshipType,
      configuration: configuration(schemaId, "1.0.0", {}),
      lifecycle: userLifecycle(),
    },
  } as TestEdge;
}

function endpointPolicyOwnerDescriptor(): AwsPolicyOwnerSlotDescriptorV1 {
  const slotInput = awsGatewayVpcEndpointOwnedConfigurationSlotsV1.find(
    (candidate) =>
      candidate.id === "aws.ec2.gateway-vpc-endpoint.slot.resource-policy",
  );
  if (slotInput === undefined) {
    throw new Error("Expected the gateway endpoint resource-policy slot.");
  }
  return {
    slot: defineProviderOwnedConfigurationSlotV1(slotInput),
    ownerServiceType: "aws.ec2.gateway-vpc-endpoint",
    ownerResourceType: "aws.ec2.gateway-vpc-endpoint",
    policyDocumentPort: gatewayEndpointOwnsPolicy.source.portId,
    ownerPort: gatewayEndpointOwnsPolicy.target.portId,
    bindingConfigurationSchemaId:
      gatewayEndpointOwnsPolicy.configuration.schemaId,
    bindingConfigurationSchemaVersion:
      gatewayEndpointOwnsPolicy.configuration.schemaVersion,
  };
}

function endpointNode(policyMode: "full-access" | "restricted"): TestNode {
  return node(
    endpointNodeId,
    "aws.ec2.gateway-vpc-endpoint",
    configuration("aws.ec2.gateway-vpc-endpoint.configuration", "1.0.0", {
      service: { kind: "string", value: "s3" },
      endpointType: { kind: "string", value: "Gateway" },
      policyMode: { kind: "string", value: policyMode },
    }),
  );
}

function policyDocumentNode(): TestNode {
  return node(
    policyNodeId,
    "aws.iam.policy-document",
    configuration("aws.iam.policy-document.configuration", "1.0.0", {
      policyName: { kind: "string", value: "RestrictedArtifactRead" },
      policyKind: { kind: "string", value: "resource" },
    }),
    {
      nodeId: endpointNodeId,
      relationshipType: "aws.ec2.gateway-endpoint-owns-policy",
    },
  );
}

function policyStatementNode(): TestNode {
  return node(
    statementNodeId,
    "aws.iam.policy-statement",
    configuration("aws.iam.policy-statement.configuration", "2.0.0", {
      statementId: { kind: "string", value: "ReadArtifactIndex" },
      effect: { kind: "string", value: "allow" },
      actions: { kind: "string-list", value: ["s3:ListBucket"] },
      principalKind: { kind: "string", value: "provider-identity" },
      principals: {
        kind: "string-list",
        value: ["arn:aws:iam::111122223333:role/ArtifactReader"],
      },
      resourceExpressions: {
        kind: "string-list",
        value: ["arn:aws:s3:::cloudmarkup-networking-policy-test"],
      },
    }),
    {
      nodeId: policyNodeId,
      relationshipType: "aws.iam.policy-contains-statement",
    },
  );
}

function nonPolicyOwnedConfigurations(): {
  readonly nodes: readonly TestNode[];
  readonly edges: readonly TestEdge[];
} {
  const securityGroup = node(
    "node_security_group",
    "aws.ec2.security-group",
    configuration("aws.ec2.security-group.configuration", "1.0.0", {
      groupName: { kind: "string", value: "application" },
      description: { kind: "string", value: "Application traffic" },
    }),
  );
  const ingress = node(
    "node_security_group_ingress",
    "aws.ec2.security-group-ingress-rule",
    configuration(
      "aws.ec2.security-group-ingress-rule.configuration",
      "1.0.0",
      {
        protocol: { kind: "string", value: "tcp" },
        fromPort: { kind: "integer", value: 443 },
        toPort: { kind: "integer", value: 443 },
        sourceIpv4Cidr: { kind: "string", value: "10.0.0.0/8" },
        description: { kind: "string", value: "TLS ingress" },
      },
    ),
    {
      nodeId: securityGroup.id,
      relationshipType: "aws.ec2.security-group-owns-ingress-rule",
    },
  );
  const egress = node(
    "node_security_group_egress",
    "aws.ec2.security-group-egress-rule",
    configuration("aws.ec2.security-group-egress-rule.configuration", "1.0.0", {
      protocol: { kind: "string", value: "tcp" },
      fromPort: { kind: "integer", value: 443 },
      toPort: { kind: "integer", value: 443 },
      destinationIpv4Cidr: { kind: "string", value: "10.0.0.0/8" },
      description: { kind: "string", value: "TLS egress" },
    }),
    {
      nodeId: securityGroup.id,
      relationshipType: "aws.ec2.security-group-owns-egress-rule",
    },
  );
  const routeTable = node(
    "node_route_table",
    "aws.ec2.route-table",
    configuration("aws.ec2.route-table.configuration", "1.0.0", {
      name: { kind: "string", value: "private" },
    }),
  );
  const route = node(
    "node_route",
    "aws.ec2.route",
    configuration("aws.ec2.route.configuration", "1.0.0", {
      destinationIpv4Cidr: { kind: "string", value: "0.0.0.0/0" },
    }),
    {
      nodeId: routeTable.id,
      relationshipType: "aws.ec2.route-table-owns-route",
    },
  );
  const lambdaFunction = node(
    "node_lambda_function",
    "aws.lambda.function",
    configuration("aws.lambda.function.configuration", "1.0.0", {}),
  );
  const lambdaVpcAccess = node(
    "node_lambda_vpc_access",
    "aws.lambda.vpc-access-configuration",
    configuration(
      "aws.lambda.vpc-access-configuration.configuration",
      "1.0.0",
      {
        ipv6AllowedForDualStack: { kind: "boolean", value: false },
      },
    ),
    {
      nodeId: lambdaFunction.id,
      relationshipType: "aws.lambda.owns-vpc-access-configuration",
    },
  );

  return {
    nodes: [
      securityGroup,
      ingress,
      egress,
      routeTable,
      route,
      lambdaFunction,
      lambdaVpcAccess,
    ],
    edges: [
      edge(
        "edge_security_group_ingress_owner",
        ingress.id,
        "aws.ec2.security-group-ingress-rule.security-group",
        securityGroup.id,
        "aws.ec2.security-group.ingress-rule",
        "aws.ec2.security-group-owns-ingress-rule",
        "aws.ec2.security-group-owns-ingress-rule.connection",
      ),
      edge(
        "edge_security_group_egress_owner",
        egress.id,
        "aws.ec2.security-group-egress-rule.security-group",
        securityGroup.id,
        "aws.ec2.security-group.egress-rule",
        "aws.ec2.security-group-owns-egress-rule",
        "aws.ec2.security-group-owns-egress-rule.connection",
      ),
      edge(
        "edge_route_owner",
        route.id,
        "aws.ec2.route.route-table",
        routeTable.id,
        "aws.ec2.route-table.route",
        "aws.ec2.route-table-owns-route",
        "aws.ec2.route-table-owns-route.connection",
      ),
      edge(
        "edge_lambda_vpc_access_owner",
        lambdaVpcAccess.id,
        "aws.lambda.vpc-access-configuration.function",
        lambdaFunction.id,
        "aws.lambda.function.vpc-access",
        "aws.lambda.owns-vpc-access-configuration",
        "aws.lambda.owns-vpc-access-configuration.connection",
      ),
    ],
  };
}

function createDocument(options?: {
  readonly includePolicy?: boolean;
  readonly policyMode?: "full-access" | "restricted";
}): ArchitectureDocument {
  const includePolicy = options?.includePolicy ?? true;
  const ownedConfigurations = nonPolicyOwnedConfigurations();
  const nodes: TestNode[] = [
    endpointNode(options?.policyMode ?? "restricted"),
    ...ownedConfigurations.nodes,
  ];
  const edges: TestEdge[] = [...ownedConfigurations.edges];

  if (includePolicy) {
    nodes.push(policyDocumentNode(), policyStatementNode());
    edges.push(
      edge(
        "edge_gateway_endpoint_policy_owner",
        policyNodeId,
        gatewayEndpointOwnsPolicy.source.portId,
        endpointNodeId,
        gatewayEndpointOwnsPolicy.target.portId,
        gatewayEndpointOwnsPolicy.relationshipType,
        gatewayEndpointOwnsPolicy.configuration.schemaId,
      ),
      edge(
        "edge_gateway_endpoint_policy_statement",
        statementNodeId,
        "aws.iam.policy-statement.policy-document",
        policyNodeId,
        "aws.iam.policy-document.statement",
        "aws.iam.policy-contains-statement",
        "aws.iam.policy-membership.connection",
      ),
    );
  }

  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 2,
    documentId: "document_networking_policy",
    architectureId: "architecture_networking_policy",
    revision: {
      revisionId: "revision_networking_policy",
      revisionNumber: 1,
      createdAt: "2026-08-25T12:00:00Z",
      createdBy: "actor_networking_policy",
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
    nodes,
    edges,
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    workloadBehavior: { contractVersion: 1, workloads: [] },
  });
}

function replaceNodeValues(
  document: ArchitectureDocument,
  nodeId: TestNode["id"],
  replace: (
    values: Readonly<Record<string, ConfigurationValue>>,
  ) => Readonly<Record<string, ConfigurationValue>>,
): ArchitectureDocument {
  return parseArchitectureDocument({
    ...document,
    nodes: document.nodes.map((candidate) =>
      candidate.id === nodeId
        ? {
            ...candidate,
            semantic: {
              ...candidate.semantic,
              configuration: {
                ...candidate.semantic.configuration,
                values: replace(
                  candidate.semantic.configuration.values as Readonly<
                    Record<string, ConfigurationValue>
                  >,
                ),
              },
            },
          }
        : candidate,
    ),
  });
}

function requireProjectionSuccess(
  result: AwsCanonicalPolicyProjectionResultV1,
) {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("Expected the endpoint policy projection to succeed.");
  }
  return result;
}

function issueCodes(result: AwsCanonicalPolicyProjectionResultV1) {
  expect(result.success).toBe(false);
  return result.success ? [] : result.issues.map((issue) => issue.code);
}

function policyModeMismatchFindings(document: ArchitectureDocument) {
  const report = executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    [createNetworkRoutingRuleV1(awsCatalogArtifactV1)],
  );
  expect(report.diagnostics).toEqual([]);
  return report.findings.filter(
    (finding) =>
      finding.code === "aws.validation.gateway-endpoint-policy-mode-mismatch",
  );
}

describe("AWS networking owned policy configuration", () => {
  it("projects one user-owned endpoint resource policy deterministically without classifying other networking configurations as IAM policies", () => {
    const descriptor = endpointPolicyOwnerDescriptor();
    expect(descriptor.slot).toMatchObject({
      id: "aws.ec2.gateway-vpc-endpoint.slot.resource-policy",
      configurationKind: "aws.ec2.gateway-vpc-endpoint.resource-policy",
      graphBinding: {
        configurationServiceId: "aws.iam.policy-document",
        ownershipRelationshipType: "aws.ec2.gateway-endpoint-owns-policy",
      },
      allowedOwnership: ["user"],
      policyKinds: ["resource"],
    });
    expect(gatewayEndpointOwnsPolicy).toMatchObject({
      relationshipType: "aws.ec2.gateway-endpoint-owns-policy",
      source: {
        serviceId: "aws.iam.policy-document",
        portId: "aws.iam.policy-document.gateway-endpoint-resource-policy",
      },
      target: {
        serviceId: "aws.ec2.gateway-vpc-endpoint",
        portId: "aws.ec2.gateway-vpc-endpoint.resource-policy",
      },
      validationRuleIds: [
        "aws.cloudmarkup.validation.connection-cardinality",
        "aws.cloudmarkup.validation.iam-policy-safety",
        "aws.cloudmarkup.validation.network-routing",
      ],
    });

    const document = createDocument();
    const projection = requireProjectionSuccess(
      projectAwsCanonicalPolicyDocumentsV1(document, {
        ownerSlots: [descriptor],
      }),
    );
    expect(projection.documents).toHaveLength(1);
    expect(projection.documents[0]).toMatchObject({
      id: policyNodeId,
      ownerNodeId: endpointNodeId,
      slotId: "aws.ec2.gateway-vpc-endpoint.slot.resource-policy",
      displayName: "RestrictedArtifactRead",
      policyKind: "resource",
      lifecycle: { ownership: "user", origin: "user" },
      targetReadiness: {
        modeling: { status: "supported" },
        configuration: { status: "supported" },
        validation: { status: "supported" },
        terraform: { status: "supported" },
        cloudformation: { status: "supported" },
        generatedCode: { status: "not-applicable" },
      },
      statements: [
        {
          id: statementNodeId,
          effect: "allow",
          actions: [{ kind: "provider-action", action: "s3:ListBucket" }],
          principals: [
            {
              kind: "provider-identity",
              value: "arn:aws:iam::111122223333:role/ArtifactReader",
            },
          ],
          resources: [
            {
              kind: "provider-resource",
              value: "arn:aws:s3:::cloudmarkup-networking-policy-test",
            },
          ],
        },
      ],
    });

    const reordered = parseArchitectureDocument({
      ...document,
      nodes: [...document.nodes].reverse(),
      edges: [...document.edges].reverse(),
    });
    const reorderedProjection = requireProjectionSuccess(
      projectAwsCanonicalPolicyDocumentsV1(reordered, {
        ownerSlots: [descriptor],
      }),
    );
    expect(serializeCanonicalJson(reorderedProjection.documents)).toBe(
      serializeCanonicalJson(projection.documents),
    );
  });

  it("leaves full-access versus restricted endpoint posture to deterministic network validation", () => {
    const descriptor = endpointPolicyOwnerDescriptor();
    const restrictedWithPolicy = createDocument({ policyMode: "restricted" });
    const fullAccessWithPolicy = createDocument({ policyMode: "full-access" });
    const restrictedProjection = requireProjectionSuccess(
      projectAwsCanonicalPolicyDocumentsV1(restrictedWithPolicy, {
        ownerSlots: [descriptor],
      }),
    );
    const fullAccessProjection = requireProjectionSuccess(
      projectAwsCanonicalPolicyDocumentsV1(fullAccessWithPolicy, {
        ownerSlots: [descriptor],
      }),
    );
    expect(serializeCanonicalJson(fullAccessProjection.documents)).toBe(
      serializeCanonicalJson(restrictedProjection.documents),
    );
    expect(policyModeMismatchFindings(restrictedWithPolicy)).toEqual([]);
    expect(policyModeMismatchFindings(fullAccessWithPolicy)).toHaveLength(1);

    const restrictedWithoutPolicy = createDocument({
      includePolicy: false,
      policyMode: "restricted",
    });
    const fullAccessWithoutPolicy = createDocument({
      includePolicy: false,
      policyMode: "full-access",
    });
    expect(policyModeMismatchFindings(restrictedWithoutPolicy)).toHaveLength(1);
    expect(policyModeMismatchFindings(fullAccessWithoutPolicy)).toEqual([]);
    expect(
      requireProjectionSuccess(
        projectAwsCanonicalPolicyDocumentsV1(restrictedWithoutPolicy, {
          ownerSlots: [descriptor],
        }),
      ).documents,
    ).toEqual([]);
    expect(
      requireProjectionSuccess(
        projectAwsCanonicalPolicyDocumentsV1(fullAccessWithoutPolicy, {
          ownerSlots: [descriptor],
        }),
      ).documents,
    ).toEqual([]);
  });

  it("rejects raw policy fields and wildcard action, principal, and resource claims from canonical projection", () => {
    const descriptor = endpointPolicyOwnerDescriptor();
    const rawPolicy = replaceNodeValues(
      createDocument(),
      policyNodeId,
      (values) => ({
        ...values,
        rawPolicy: {
          kind: "string",
          value: '{"Version":"2012-10-17","Statement":[]}',
        },
      }),
    );
    expect(
      issueCodes(
        projectAwsCanonicalPolicyDocumentsV1(rawPolicy, {
          ownerSlots: [descriptor],
        }),
      ),
    ).toContain("invalid-policy-document-configuration");

    const wildcardPolicy = replaceNodeValues(
      createDocument(),
      statementNodeId,
      (values) => ({
        ...values,
        actions: { kind: "string-list", value: ["s3:*"] },
        principalKind: { kind: "string", value: "all-principals" },
        principals: { kind: "string-list", value: ["*"] },
        resourceExpressions: { kind: "string-list", value: ["*"] },
      }),
    );
    expect(
      issueCodes(
        projectAwsCanonicalPolicyDocumentsV1(wildcardPolicy, {
          ownerSlots: [descriptor],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "wildcard-action",
        "wildcard-principal",
        "wildcard-resource",
      ]),
    );
  });
});

describe("gateway endpoint ownership through the actual IAM safety rule", () => {
  const run = (document: ArchitectureDocument) =>
    executeArchitectureValidationRules(
      { document, environment: "production", target: "compilation" },
      [createIamPolicySafetyRuleV1(awsCatalogArtifactV1)],
    ).findings;
  it("accepts the already supported exact resource-policy slot without suppressing other IAM findings", () => {
    const document = createDocument();
    expect(run(document)).toEqual([]);
    expect(run(document)).toEqual(run(structuredClone(document)));
  });
  it.each([
    "source-port",
    "target-port",
    "owner-type",
    "parent",
    "schema",
    "duplicate",
    "wrong-kind",
  ])("rejects %s on the endpoint policy", (change) => {
    const document = createDocument();
    const owner = document.edges.find(
      (e) => e.id === "edge_gateway_endpoint_policy_owner",
    );
    const policy = document.nodes.find((n) => n.id === policyNodeId);
    const endpoint = document.nodes.find((n) => n.id === endpointNodeId);
    if (!owner || !policy || !endpoint)
      throw Error("Missing synthetic endpoint policy");
    if (change === "source-port")
      owner.semantic.source.port = gatewayEndpointOwnsPolicy.target.portId;
    if (change === "target-port")
      owner.semantic.target.port = gatewayEndpointOwnsPolicy.source.portId;
    if (change === "owner-type")
      endpoint.semantic.serviceType = policy.semantic.serviceType;
    if (change === "parent") delete policy.semantic.parent;
    if (change === "schema")
      owner.semantic.configuration.schemaVersion =
        "99.0.0" as typeof owner.semantic.configuration.schemaVersion;
    if (change === "duplicate")
      document.edges.push({
        ...structuredClone(owner),
        id: "duplicate_policy_owner" as typeof owner.id,
      });
    if (change === "wrong-kind")
      policy.semantic.configuration = configuration(
        "aws.iam.policy-document.configuration",
        "1.0.0",
        {
          policyName: { kind: "string", value: "WrongKind" },
          policyKind: { kind: "string", value: "identity-inline" },
        },
      );
    const findings = run(document);
    expect(
      findings.some(
        (f) =>
          f.code ===
            (change === "wrong-kind"
              ? "aws.validation.iam-policy-kind-owner-mismatch"
              : "aws.validation.iam-policy-owner-invalid") &&
          f.severity === "security-error",
      ),
    ).toBe(true);
    expect(findings.every((f) => f.autoFix === undefined)).toBe(true);
  });
});
