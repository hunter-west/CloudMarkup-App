import {
  executeArchitectureValidationRules,
  type ValidationRuleV1,
} from "@cloudmarkup/domain";
import {
  resourceTypeSchema,
  serviceConfigurationRecordSchema,
  type ArchitectureDocumentV1,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { networkRoutingValidationRuleDescriptor } from "./catalog/validation-rules/index.js";
import {
  awsValidationRulesV1,
  createCompilerReadinessRuleV1,
  createLambdaVpcAccessRuleV1,
  createNetworkPlacementRuleV1,
  createNetworkRoutingRuleV1,
  createSecurityGroupPolicyRuleV1,
} from "./validation/index.js";

type TestNode = ArchitectureDocumentV1["nodes"][number];
type TestEdge = ArchitectureDocumentV1["edges"][number];
type TestValueInput = Readonly<Record<string, ConfigurationValue>>;

const stringValue = (value: string) => ({ kind: "string", value }) as const;
const integerValue = (value: number) => ({ kind: "integer", value }) as const;
const booleanValue = (value: boolean) => ({ kind: "boolean", value }) as const;

it("rejects AWS-incompatible group descriptions at whole-graph validation", () => {
  const rule = createSecurityGroupPolicyRuleV1(awsCatalogArtifactV1);
  for (const service of [
    "aws.ec2.security-group",
    "aws.ec2.security-group-ingress-rule",
    "aws.ec2.security-group-egress-rule",
  ]) {
    const valid = (
      "AZaz09 ._-:/()#,@[]+=;{}!$*" +
      (service === "aws.ec2.security-group" ? "&" : "")
    ).padEnd(255, "a");
    for (const description of [
      valid,
      "é",
      "Purpose\n",
      ...(service === "aws.ec2.security-group" ? [] : ["Purpose & access"]),
    ]) {
      const candidate = document(
        [node("policy", service, { description: stringValue(description) })],
        [],
      );
      const before = structuredClone(candidate);
      const failures = report(rule, candidate, "production").findings.filter(
        (f) => f.code === "aws.validation.security-group-description-invalid",
      );
      expect(failures).toHaveLength(description === valid ? 0 : 1);
      if (description !== valid) {
        expect(failures[0]).toMatchObject({
          severity: "error",
          affected: [{ kind: "configuration", key: "description" }],
        });
        expect(failures[0]?.autoFix).toBeUndefined();
      }
      expect(candidate).toEqual(before);
    }
  }
});

function node(
  id: string,
  serviceType: string,
  values: TestValueInput = {},
  parent?: { readonly nodeId: string; readonly relationshipType: string },
): TestNode {
  const parsedValues =
    serviceConfigurationRecordSchema.shape.values.parse(values);

  return {
    id,
    semantic: {
      deploymentKey: id.replaceAll("-", "_"),
      serviceType,
      resourceType: serviceType,
      configuration: {
        schemaId: `${serviceType}.configuration`,
        schemaVersion: "1.0.0",
        values: parsedValues,
      },
      ...(parent === undefined ? {} : { parent }),
      lifecycle: { ownership: "user", origin: "user" },
    },
    presentation: {
      label: id,
      position: { x: 0, y: 0 },
    },
  } as unknown as TestNode;
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  relationshipType: string,
): TestEdge {
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: `${relationshipType}.source` },
      target: { nodeId: targetNodeId, port: `${relationshipType}.target` },
      relationshipType,
      configuration: {
        schemaId: `${relationshipType}.configuration`,
        schemaVersion: "1.0.0",
        values: {},
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
  } as unknown as TestEdge;
}

function typedEdge(
  id: string,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
  relationshipType: string,
): TestEdge {
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: sourcePort },
      target: { nodeId: targetNodeId, port: targetPort },
      relationshipType,
      configuration: {
        schemaId: `${relationshipType}.configuration`,
        schemaVersion: "1.0.0",
        values: {},
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
  } as unknown as TestEdge;
}

function registeredRule(ruleId: string): ValidationRuleV1 {
  const rule = awsValidationRulesV1.find(
    (candidate) => String(candidate.id) === ruleId,
  );
  if (rule === undefined) {
    throw new TypeError(`Missing validation rule: ${ruleId}.`);
  }
  return rule;
}

function document(
  nodes: readonly TestNode[],
  edges: readonly TestEdge[],
): ArchitectureDocumentV1 {
  return {
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 1,
    documentId: "network_validation_document",
    architectureId: "network_validation_architecture",
    revision: {
      revisionId: "network_validation_revision",
      revisionNumber: 1,
      createdAt: "2026-08-25T12:00:00Z",
      createdBy: "network_validation_actor",
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
    nodes: [...nodes],
    edges: [...edges],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
  } as unknown as ArchitectureDocumentV1;
}

function report(
  rule: ValidationRuleV1,
  candidate: ArchitectureDocumentV1,
  environment: "development" | "production" = "development",
  target: "draft" | "compilation" = "draft",
) {
  return executeArchitectureValidationRules(
    { document: candidate, target, environment },
    [rule],
  );
}

function baseHierarchy() {
  const region = node("region", "aws.region.boundary", {
    regionName: stringValue("us-east-1"),
  });
  const vpc = node(
    "vpc",
    "aws.ec2.vpc",
    {
      cidrBlock: stringValue("10.0.0.0/16"),
      enableDnsSupport: booleanValue(true),
      enableDnsHostnames: booleanValue(true),
      instanceTenancy: stringValue("default"),
    },
    { nodeId: "region", relationshipType: "aws.region.contains-vpc" },
  );
  const zoneA = node(
    "zone-a",
    "aws.ec2.availability-zone",
    { zoneName: stringValue("us-east-1a") },
    {
      nodeId: "vpc",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
    },
  );
  const hierarchyEdges = [
    edge("region-vpc", "region", "vpc", "aws.region.contains-vpc"),
    edge(
      "vpc-zone-a",
      "vpc",
      "zone-a",
      "aws.ec2.vpc-contains-availability-zone",
    ),
  ];
  return { region, vpc, zoneA, hierarchyEdges };
}

describe("AWS networking validation rules", () => {
  it("enforces the current networking literal schemas before topology validation", () => {
    const rule = createNetworkPlacementRuleV1(awsCatalogArtifactV1);
    for (const [id, input, property, invalid] of [
      ["aws.ec2.vpc", {}, "cidrBlock", stringValue("")],
      ["aws.ec2.vpc", {}, "enableDnsSupport", stringValue("true")],
      [
        "aws.ec2.availability-zone",
        { zoneName: stringValue("us-east-1a") },
        "zoneName",
        stringValue(""),
      ],
      ["aws.ec2.internet-gateway", {}, "name", stringValue("")],
      ["aws.ec2.route-table", {}, "name", stringValue("")],
      ["aws.ec2.security-group", {}, "groupName", stringValue("")],
      [
        "aws.ec2.security-group-ingress-rule",
        { sourceIpv4Cidr: stringValue("10.0.0.0/16") },
        "sourceIpv4Cidr",
        stringValue(""),
      ],
      [
        "aws.ec2.security-group-egress-rule",
        { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
        "destinationIpv4Cidr",
        stringValue("not-a-cidr"),
      ],
      [
        "aws.ec2.security-group-egress-rule",
        { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
        "fromPort",
        integerValue(-2),
      ],
      [
        "aws.ec2.security-group-egress-rule",
        { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
        "toPort",
        integerValue(65536),
      ],
      [
        "aws.ec2.security-group-egress-rule",
        { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
        "protocol",
        stringValue("unsupported"),
      ],
      [
        "aws.ec2.security-group-ingress-rule",
        { sourceIpv4Cidr: stringValue("10.0.0.0/16") },
        "fromPort",
        { kind: "number", value: 443 },
      ],
      [
        "aws.ec2.nat-gateway",
        { allocationId: stringValue("eipalloc-0123456789abcdef0") },
        "allocationId",
        stringValue("invalid-allocation"),
      ],
      ["aws.ec2.subnet", {}, "accessTier", stringValue("unsupported")],
      [
        "aws.lambda.vpc-access-configuration",
        {},
        "egressRequirement",
        stringValue("unsupported"),
      ],
    ] as const) {
      const valid = awsCatalogV1.validateConfiguration(id, input);
      if (!valid.success) throw Error("Invalid reviewed network control");
      const validDocument = document([node("network", id, valid.values)], []);
      expect(
        report(rule, validDocument).findings.filter(
          (finding) =>
            finding.code === "aws.validation.network-configuration-invalid",
        ),
      ).toHaveLength(0);
      const values = { ...valid.values, [property]: invalid };
      expect(awsCatalogV1.validateConfiguration(id, values).success).toBe(
        false,
      );
      const candidate = document([node("network", id, values)], []);
      const before = structuredClone(candidate);
      const failures = report(
        rule,
        candidate,
        "production",
        "compilation",
      ).findings.filter(
        (finding) =>
          finding.code === "aws.validation.network-configuration-invalid",
      );
      expect(failures, id + "." + property).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        severity: "error",
        affected: [{ kind: "configuration", key: property }],
      });
      expect(candidate).toEqual(before);
    }
  });

  it("compares security group names case-insensitively within their exact VPC", () => {
    const rule = createSecurityGroupPolicyRuleV1(awsCatalogArtifactV1);
    for (const [otherName, separateVpc, duplicate] of [
      ["Other-Group", false, false],
      ["Audit-Group", false, true],
      ["audit-group", false, true],
      ["audit-group", true, false],
    ] as const) {
      const { region, vpc, hierarchyEdges } = baseHierarchy();
      const otherVpc = node(
        "other-vpc",
        "aws.ec2.vpc",
        vpc.semantic.configuration.values,
        {
          nodeId: region.id,
          relationshipType: "aws.region.contains-vpc",
        },
      );
      const groups = ["Audit-Group", otherName].map((name, index) =>
        node("group-" + String(index), "aws.ec2.security-group", {
          groupName: stringValue(name),
          description: stringValue("Synthetic scoped group"),
        }),
      );
      const candidate = document(
        [region, vpc, ...(separateVpc ? [otherVpc] : []), ...groups],
        [
          ...hierarchyEdges.filter(
            (edge) => edge.semantic.target.nodeId === vpc.id,
          ),
          ...(separateVpc
            ? [
                edge(
                  "other-vpc-region",
                  region.id,
                  otherVpc.id,
                  "aws.region.contains-vpc",
                ),
              ]
            : []),
          ...groups.map((group, index) =>
            edge(
              "group-vpc-" + String(index),
              separateVpc && index === 1 ? otherVpc.id : vpc.id,
              group.id,
              "aws.ec2.vpc-associates-security-group",
            ),
          ),
        ],
      );
      const before = structuredClone(candidate);
      const failures = report(
        rule,
        candidate,
        "production",
        "compilation",
      ).findings.filter(
        (finding) =>
          finding.code === "aws.validation.security-group-name-duplicate",
      );
      expect(failures).toHaveLength(duplicate ? 1 : 0);
      if (duplicate)
        expect(failures[0]).toMatchObject({
          severity: "error",
          affected: [
            {
              kind: "configuration",
              key: "groupName",
              owner: { nodeId: "group-0" },
            },
            {
              kind: "configuration",
              key: "groupName",
              owner: { nodeId: "group-1" },
            },
          ],
        });
      expect(candidate).toEqual(before);
    }
  });

  it("requires DNS support only when VPC DNS hostnames are explicitly enabled", () => {
    const rule = createNetworkPlacementRuleV1(awsCatalogArtifactV1);
    for (const hostnames of [false, true]) {
      for (const support of [false, true]) {
        const { region, vpc, hierarchyEdges } = baseHierarchy();
        const candidate = document(
          [
            region,
            {
              ...vpc,
              semantic: {
                ...vpc.semantic,
                configuration: {
                  ...vpc.semantic.configuration,
                  values: serviceConfigurationRecordSchema.shape.values.parse({
                    ...vpc.semantic.configuration.values,
                    enableDnsHostnames: booleanValue(hostnames),
                    enableDnsSupport: booleanValue(support),
                  }),
                },
              },
            },
          ],
          hierarchyEdges.filter(
            (edge) => edge.semantic.target.nodeId === vpc.id,
          ),
        );
        const before = structuredClone(candidate);
        const failures = report(
          rule,
          candidate,
          "production",
          "compilation",
        ).findings.filter(
          (finding) =>
            finding.code === "aws.validation.vpc-dns-hostnames-require-support",
        );
        expect(failures).toHaveLength(hostnames && !support ? 1 : 0);
        if (hostnames && !support) {
          expect(failures[0]).toMatchObject({
            severity: "error",
            affected: [
              { kind: "configuration", key: "enableDnsHostnames" },
              { kind: "configuration", key: "enableDnsSupport" },
            ],
          });
          expect(failures[0]?.autoFix).toBeUndefined();
        }
        expect(candidate).toEqual(before);
      }
    }
  });

  it("keeps the four networking rule identities stable and catalog-bound", () => {
    const rules = [
      createNetworkPlacementRuleV1(awsCatalogArtifactV1),
      createNetworkRoutingRuleV1(awsCatalogArtifactV1),
      createSecurityGroupPolicyRuleV1(awsCatalogArtifactV1),
      createLambdaVpcAccessRuleV1(awsCatalogArtifactV1),
    ];

    expect(rules.map((rule) => String(rule.id))).toEqual([
      "aws.cloudmarkup.validation.network-placement",
      "aws.cloudmarkup.validation.network-routing",
      "aws.cloudmarkup.validation.security-group-policy",
      "aws.cloudmarkup.validation.lambda-vpc-access",
    ]);
    expect(rules.map((rule) => rule.ruleVersion)).toEqual([
      "1.0.0",
      "1.1.0",
      "1.0.0",
      "1.1.0",
    ]);
    expect(networkRoutingValidationRuleDescriptor.serviceIds).toContain(
      "aws.iam.policy-document",
    );
    for (const rule of rules) {
      expect(rule.interfaceVersion).toBe(1);
      expect(rule.applicability.providers).toEqual({
        kind: "include",
        providerIds: [awsCatalogArtifactV1.provider.id],
      });
      expect(rule.applicability.catalogs).toEqual({
        kind: "include",
        catalogs: [
          {
            catalogId: awsCatalogArtifactV1.catalog.id,
            versions: [awsCatalogArtifactV1.catalog.version],
          },
        ],
      });
    }
  });

  it("reports malformed VPC, subnet, and route CIDRs at their exact configuration paths", () => {
    const cases = [
      {
        rule: createNetworkPlacementRuleV1(awsCatalogArtifactV1),
        candidate: document(
          [
            node("invalid-vpc", "aws.ec2.vpc", {
              cidrBlock: stringValue("10.0.0.1/16"),
            }),
          ],
          [],
        ),
        code: "aws.validation.vpc-cidr-invalid",
        path: "$.nodes[0].semantic.configuration.values.cidrBlock",
      },
      {
        rule: createNetworkPlacementRuleV1(awsCatalogArtifactV1),
        candidate: document(
          [
            node("invalid-subnet", "aws.ec2.subnet", {
              cidrBlock: stringValue("10.0.1.1/24"),
              accessTier: stringValue("private"),
              mapPublicIpOnLaunch: booleanValue(false),
              assignIpv6AddressOnCreation: booleanValue(false),
            }),
          ],
          [],
        ),
        code: "aws.validation.subnet-cidr-invalid",
        path: "$.nodes[0].semantic.configuration.values.cidrBlock",
      },
      {
        rule: createNetworkRoutingRuleV1(awsCatalogArtifactV1),
        candidate: document(
          [
            node("invalid-route", "aws.ec2.route", {
              destinationIpv4Cidr: stringValue("10.0.0.1/24"),
            }),
          ],
          [],
        ),
        code: "aws.validation.route-destination-invalid",
        path: "$.nodes[0].semantic.configuration.values.destinationIpv4Cidr",
      },
    ] as const;

    for (const testCase of cases) {
      const first = report(testCase.rule, testCase.candidate);
      const second = report(testCase.rule, structuredClone(testCase.candidate));
      const finding = first.findings.find(
        (candidateFinding) => candidateFinding.code === testCase.code,
      );
      expect(first, testCase.code).toEqual(second);
      expect(finding, testCase.code).toMatchObject({
        severity: "error",
        affected: [{ path: testCase.path }],
      });
      expect(finding?.autoFix, testCase.code).toBeUndefined();
    }
  });

  it("rejects cross-Region boundary and Availability Zone evidence at exact paths", () => {
    const region = node("region", "aws.region.boundary", {
      regionName: stringValue("us-west-2"),
    });
    const vpc = node(
      "vpc",
      "aws.ec2.vpc",
      { cidrBlock: stringValue("10.0.0.0/16") },
      { nodeId: "region", relationshipType: "aws.region.contains-vpc" },
    );
    const zone = node(
      "zone",
      "aws.ec2.availability-zone",
      { zoneName: stringValue("us-west-2a") },
      {
        nodeId: "vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
    );
    const candidate = document(
      [region, vpc, zone],
      [
        edge("region-vpc", "region", "vpc", "aws.region.contains-vpc"),
        edge(
          "vpc-zone",
          "vpc",
          "zone",
          "aws.ec2.vpc-contains-availability-zone",
        ),
      ],
    );
    const rule = createNetworkPlacementRuleV1(awsCatalogArtifactV1);
    const first = report(rule, candidate, "production");
    const second = report(rule, structuredClone(candidate), "production");

    expect(first).toEqual(second);
    for (const [code, path] of [
      [
        "aws.validation.region-boundary-provider-mismatch",
        "$.nodes[0].semantic.configuration.values.regionName",
      ],
      [
        "aws.validation.availability-zone-region-mismatch",
        "$.nodes[2].semantic.configuration.values.zoneName",
      ],
    ] as const) {
      const finding = first.findings.find(
        (candidateFinding) => candidateFinding.code === code,
      );
      expect(finding, code).toMatchObject({
        severity: "error",
        affected: [{ path }],
      });
      expect(finding?.autoFix, code).toBeUndefined();
    }
  });

  it("uses the shared connection-cardinality rule when one subnet is linked to multiple Availability Zones", () => {
    const zoneA = node("zone-a", "aws.ec2.availability-zone", {
      zoneName: stringValue("us-east-1a"),
    });
    const zoneB = node("zone-b", "aws.ec2.availability-zone", {
      zoneName: stringValue("us-east-1b"),
    });
    const subnet = node(
      "subnet",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.0.1.0/24"),
        accessTier: stringValue("private"),
        mapPublicIpOnLaunch: booleanValue(false),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const candidate = document(
      [zoneA, zoneB, subnet],
      [
        typedEdge(
          "zone-a-subnet",
          "zone-a",
          "aws.ec2.availability-zone.subnet-placement",
          "subnet",
          "aws.ec2.subnet.availability-zone",
          "aws.ec2.availability-zone-contains-subnet",
        ),
        typedEdge(
          "zone-b-subnet",
          "zone-b",
          "aws.ec2.availability-zone.subnet-placement",
          "subnet",
          "aws.ec2.subnet.availability-zone",
          "aws.ec2.availability-zone-contains-subnet",
        ),
      ],
    );
    const result = executeArchitectureValidationRules(
      { document: candidate, target: "draft", environment: "production" },
      [
        registeredRule("aws.cloudmarkup.validation.connection-cardinality"),
        createNetworkPlacementRuleV1(awsCatalogArtifactV1),
      ],
    );

    for (const [code, suffix] of [
      [
        "aws.validation.connection-target-port-cardinality-exceeded",
        "target.port",
      ],
      [
        "aws.validation.connection-target-cardinality-exceeded",
        "relationshipType",
      ],
    ] as const) {
      expect(
        result.findings
          .find((finding) => finding.code === code)
          ?.affected.map((location) => location.path),
      ).toEqual([
        `$.edges[0].semantic.${suffix}`,
        `$.edges[1].semantic.${suffix}`,
      ]);
    }
    expect(
      result.findings.every((finding) => finding.autoFix === undefined),
    ).toBe(true);
  });

  it("finds out-of-VPC and overlapping subnet CIDRs deterministically without fixes", () => {
    const { region, vpc, zoneA, hierarchyEdges } = baseHierarchy();
    const firstSubnet = node(
      "subnet-a",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.1.0.0/24"),
        accessTier: stringValue("private"),
        mapPublicIpOnLaunch: booleanValue(false),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const secondSubnet = node(
      "subnet-b",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.1.0.0/25"),
        accessTier: stringValue("private"),
        mapPublicIpOnLaunch: booleanValue(false),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const candidate = document(
      [region, vpc, zoneA, firstSubnet, secondSubnet],
      [
        ...hierarchyEdges,
        edge(
          "zone-subnet-a",
          "zone-a",
          "subnet-a",
          "aws.ec2.availability-zone-contains-subnet",
        ),
        edge(
          "zone-subnet-b",
          "zone-a",
          "subnet-b",
          "aws.ec2.availability-zone-contains-subnet",
        ),
      ],
    );
    const rule = createNetworkPlacementRuleV1(awsCatalogArtifactV1);
    const first = report(rule, candidate);
    const second = report(rule, structuredClone(candidate));

    expect(first).toEqual(second);
    expect(first.diagnostics).toEqual([]);
    expect(first.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "aws.validation.subnet-cidr-outside-vpc",
        "aws.validation.subnet-cidr-overlap",
        "aws.validation.vpc-single-availability-zone",
      ]),
    );
    expect(
      first.findings.find(
        (finding) =>
          finding.code === "aws.validation.vpc-single-availability-zone",
      ),
    ).toMatchObject({
      severity: "recommendation",
      affected: [{ path: "$.nodes[3]" }],
    });
    expect(
      report(rule, candidate, "production").findings.find(
        (finding) =>
          finding.code === "aws.validation.vpc-single-availability-zone",
      ),
    ).toMatchObject({
      severity: "warning",
      affected: [{ path: "$.nodes[3]" }],
    });
    expect(
      first.findings
        .find(
          (finding) => finding.code === "aws.validation.subnet-cidr-overlap",
        )
        ?.affected.map((location) => location.path),
    ).toEqual([
      "$.nodes[1].semantic.configuration.values.cidrBlock",
      "$.nodes[2].semantic.configuration.values.cidrBlock",
    ]);
    expect(
      first.findings
        .filter(
          (finding) =>
            finding.code === "aws.validation.subnet-cidr-outside-vpc",
        )
        .flatMap(({ affected }) => affected.map(({ path }) => path))
        .sort(),
    ).toEqual([
      "$.nodes[1].semantic.configuration.values.cidrBlock",
      "$.nodes[2].semantic.configuration.values.cidrBlock",
    ]);
    expect(
      first.findings.every((finding) => finding.autoFix === undefined),
    ).toBe(true);
  });

  it("scopes internet gateways and security groups through VPC associations without containment", () => {
    const { region, vpc, zoneA, hierarchyEdges } = baseHierarchy();
    const internetGateway = node(
      "internet-gateway",
      "aws.ec2.internet-gateway",
      { name: stringValue("internet") },
    );
    const securityGroup = node("security-group", "aws.ec2.security-group", {
      groupName: stringValue("application"),
      description: stringValue("Application traffic"),
    });
    const candidate = document(
      [region, vpc, zoneA, internetGateway, securityGroup],
      [
        ...hierarchyEdges,
        edge(
          "vpc-internet-gateway",
          "vpc",
          "internet-gateway",
          "aws.ec2.vpc-attaches-internet-gateway",
        ),
        edge(
          "vpc-security-group",
          "vpc",
          "security-group",
          "aws.ec2.vpc-associates-security-group",
        ),
      ],
    );

    const result = report(
      createNetworkPlacementRuleV1(awsCatalogArtifactV1),
      candidate,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("rejects false VPC containment and missing VPC associations", () => {
    const { region, vpc, zoneA, hierarchyEdges } = baseHierarchy();
    const nestedSecurityGroup = node(
      "nested-security-group",
      "aws.ec2.security-group",
      {
        groupName: stringValue("nested"),
        description: stringValue("Invalid containment"),
      },
      {
        nodeId: "vpc",
        relationshipType: "aws.ec2.vpc-associates-security-group",
      },
    );
    const internetGateway = node(
      "internet-gateway",
      "aws.ec2.internet-gateway",
      { name: stringValue("missing-association") },
    );
    const candidate = document(
      [region, vpc, zoneA, nestedSecurityGroup, internetGateway],
      [
        ...hierarchyEdges,
        edge(
          "vpc-security-group",
          "vpc",
          "nested-security-group",
          "aws.ec2.vpc-associates-security-group",
        ),
      ],
    );

    const result = report(
      createNetworkPlacementRuleV1(awsCatalogArtifactV1),
      candidate,
    );
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "aws.validation.network-association-false-containment",
        "aws.validation.network-vpc-association-invalid",
      ]),
    );
    expect(
      result.findings.every((finding) => finding.autoFix === undefined),
    ).toBe(true);
  });

  it("distinguishes a missing VPC internet gateway from a missing public default route", () => {
    const { region, vpc, zoneA, hierarchyEdges } = baseHierarchy();
    const subnet = node(
      "public-subnet",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.0.1.0/24"),
        accessTier: stringValue("public"),
        mapPublicIpOnLaunch: booleanValue(true),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const routeTable = node(
      "public-table",
      "aws.ec2.route-table",
      { name: stringValue("public") },
      { nodeId: "vpc", relationshipType: "aws.ec2.vpc-contains-route-table" },
    );
    const association = node(
      "public-association",
      "aws.ec2.route-table-association",
      {},
      {
        nodeId: "public-table",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
    );
    const baseEdges = [
      ...hierarchyEdges,
      edge(
        "zone-public-subnet",
        "zone-a",
        "public-subnet",
        "aws.ec2.availability-zone-contains-subnet",
      ),
      edge(
        "vpc-public-table",
        "vpc",
        "public-table",
        "aws.ec2.vpc-contains-route-table",
      ),
      edge(
        "public-association-owner",
        "public-association",
        "public-table",
        "aws.ec2.route-table-owns-subnet-association",
      ),
      edge(
        "public-association-target",
        "public-association",
        "public-subnet",
        "aws.ec2.route-table-association-targets-subnet",
      ),
    ];
    const rule = createNetworkRoutingRuleV1(awsCatalogArtifactV1);
    const missingGateway = report(
      rule,
      document(
        [region, vpc, zoneA, subnet, routeTable, association],
        baseEdges,
      ),
      "production",
    );
    expect(missingGateway.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "aws.validation.public-subnet-internet-gateway-missing",
          severity: "error",
          affected: [
            expect.objectContaining({
              path: "$.nodes[1].semantic.configuration.values.accessTier",
            }),
          ],
        }),
      ]),
    );
    expect(
      missingGateway.findings.find(
        (finding) =>
          finding.code ===
          "aws.validation.public-subnet-internet-gateway-missing",
      )?.autoFix,
    ).toBeUndefined();
    expect(
      missingGateway.findings.some(
        (finding) =>
          finding.code ===
          "aws.validation.public-subnet-internet-route-invalid",
      ),
    ).toBe(false);

    const internetGateway = node(
      "internet-gateway",
      "aws.ec2.internet-gateway",
      { name: stringValue("internet") },
    );
    const missingRoute = report(
      rule,
      document(
        [region, vpc, zoneA, subnet, routeTable, association, internetGateway],
        [
          ...baseEdges,
          edge(
            "vpc-internet-gateway",
            "vpc",
            "internet-gateway",
            "aws.ec2.vpc-attaches-internet-gateway",
          ),
        ],
      ),
      "production",
    );
    const missingRouteFinding = missingRoute.findings.find(
      (finding) =>
        finding.code === "aws.validation.public-subnet-internet-route-invalid",
    );
    expect(missingRouteFinding).toMatchObject({
      severity: "error",
      affected: [
        {
          path: "$.nodes[2].semantic.configuration.values.accessTier",
        },
      ],
    });
    expect(missingRouteFinding?.autoFix).toBeUndefined();
    expect(missingRoute.findings.map((finding) => finding.code)).not.toContain(
      "aws.validation.public-subnet-internet-gateway-missing",
    );
    expect(
      [...missingGateway.findings, ...missingRoute.findings].every(
        (finding) => finding.autoFix === undefined,
      ),
    ).toBe(true);
  });

  it("rejects duplicate S3 endpoint routes on one route table", () => {
    const vpc = node("vpc", "aws.ec2.vpc", {
      cidrBlock: stringValue("10.0.0.0/16"),
    });
    const table = node("table", "aws.ec2.route-table", {
      name: stringValue("private"),
    });
    const endpointValues = {
      service: stringValue("s3"),
      endpointType: stringValue("Gateway"),
      policyMode: stringValue("full-access"),
    } satisfies TestValueInput;
    const firstEndpoint = node(
      "endpoint-a",
      "aws.ec2.gateway-vpc-endpoint",
      endpointValues,
      {
        nodeId: "vpc",
        relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
      },
    );
    const secondEndpoint = node(
      "endpoint-b",
      "aws.ec2.gateway-vpc-endpoint",
      endpointValues,
      {
        nodeId: "vpc",
        relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
      },
    );
    const candidate = document(
      [vpc, table, firstEndpoint, secondEndpoint],
      [
        edge(
          "endpoint-a-table",
          "endpoint-a",
          "table",
          "aws.ec2.gateway-endpoint-associates-route-table",
        ),
        edge(
          "endpoint-b-table",
          "endpoint-b",
          "table",
          "aws.ec2.gateway-endpoint-associates-route-table",
        ),
      ],
    );

    const result = report(
      createNetworkRoutingRuleV1(awsCatalogArtifactV1),
      candidate,
    );
    expect(
      result.findings.find(
        (finding) =>
          finding.code === "aws.validation.gateway-endpoint-service-duplicate",
      ),
    ).toMatchObject({
      severity: "error",
      affected: [{ path: "$.edges[0]" }, { path: "$.edges[1]" }],
    });
  });

  it("requires route target relationships to match the actual gateway service", () => {
    const routeTable = node("route-table", "aws.ec2.route-table", {
      name: stringValue("private"),
    });
    const route = node(
      "route",
      "aws.ec2.route",
      { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
      {
        nodeId: "route-table",
        relationshipType: "aws.ec2.route-table-owns-route",
      },
    );
    const internetGateway = node(
      "internet-gateway",
      "aws.ec2.internet-gateway",
      { name: stringValue("internet") },
    );
    const candidate = document(
      [routeTable, route, internetGateway],
      [
        edge(
          "route-owner",
          "route",
          "route-table",
          "aws.ec2.route-table-owns-route",
        ),
        edge(
          "route-target",
          "route",
          "internet-gateway",
          "aws.ec2.route-targets-nat-gateway",
        ),
      ],
    );

    const result = report(
      createNetworkRoutingRuleV1(awsCatalogArtifactV1),
      candidate,
    );
    const mismatch = result.findings.find(
      (finding) =>
        finding.code === "aws.validation.route-target-service-mismatch",
    );
    expect(mismatch).toMatchObject({
      severity: "error",
      affected: [{ path: "$.edges[1]" }],
    });
    expect(mismatch?.autoFix).toBeUndefined();
  });

  it("reports exact route-table association and NAT target paths across VPCs", () => {
    const vpcA = node("vpc-a", "aws.ec2.vpc");
    const vpcB = node("vpc-b", "aws.ec2.vpc");
    const zoneB = node(
      "zone-b",
      "aws.ec2.availability-zone",
      { zoneName: stringValue("us-east-1b") },
      {
        nodeId: "vpc-b",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
    );
    const subnetB = node(
      "subnet-b",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.1.1.0/24"),
        accessTier: stringValue("private"),
        mapPublicIpOnLaunch: booleanValue(false),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-b",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const natSubnet = node(
      "nat-subnet",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.1.2.0/24"),
        accessTier: stringValue("public"),
        mapPublicIpOnLaunch: booleanValue(false),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-b",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const routeTable = node(
      "route-table-a",
      "aws.ec2.route-table",
      { name: stringValue("vpc-a") },
      {
        nodeId: "vpc-a",
        relationshipType: "aws.ec2.vpc-contains-route-table",
      },
    );
    const association = node(
      "association",
      "aws.ec2.route-table-association",
      {},
      {
        nodeId: "route-table-a",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
    );
    const route = node(
      "route",
      "aws.ec2.route",
      { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
      {
        nodeId: "route-table-a",
        relationshipType: "aws.ec2.route-table-owns-route",
      },
    );
    const nat = node(
      "nat",
      "aws.ec2.nat-gateway",
      {
        allocationId: stringValue("eipalloc-0123456789abcdef0"),
        connectivityType: stringValue("public"),
        availabilityMode: stringValue("zonal"),
      },
      {
        nodeId: "nat-subnet",
        relationshipType: "aws.ec2.subnet-contains-nat-gateway",
      },
    );
    const candidate = document(
      [
        vpcA,
        vpcB,
        zoneB,
        subnetB,
        natSubnet,
        routeTable,
        association,
        route,
        nat,
      ],
      [
        edge(
          "association-owner",
          "association",
          "route-table-a",
          "aws.ec2.route-table-owns-subnet-association",
        ),
        edge(
          "association-target",
          "association",
          "subnet-b",
          "aws.ec2.route-table-association-targets-subnet",
        ),
        edge(
          "route-owner",
          "route",
          "route-table-a",
          "aws.ec2.route-table-owns-route",
        ),
        edge(
          "route-target",
          "route",
          "nat",
          "aws.ec2.route-targets-nat-gateway",
        ),
      ],
    );
    const result = report(
      createNetworkRoutingRuleV1(awsCatalogArtifactV1),
      candidate,
      "production",
    );

    expect(
      result.findings
        .find(
          (finding) =>
            finding.code ===
            "aws.validation.route-table-association-vpc-mismatch",
        )
        ?.affected.map((location) => location.path),
    ).toEqual(["$.edges[0]", "$.edges[1]"]);
    expect(
      result.findings
        .find(
          (finding) =>
            finding.code === "aws.validation.route-target-vpc-mismatch",
        )
        ?.affected.map((location) => location.path),
    ).toEqual(["$.edges[2]", "$.edges[3]"]);
  });

  it("keeps gateway endpoint policy mode and canonical ownership aligned", () => {
    const endpoint = (policyMode: "full-access" | "restricted") =>
      node("endpoint", "aws.ec2.gateway-vpc-endpoint", {
        service: stringValue("s3"),
        endpointType: stringValue("Gateway"),
        policyMode: stringValue(policyMode),
      });
    const policy = node(
      "endpoint-policy",
      "aws.iam.policy-document",
      {},
      {
        nodeId: "endpoint",
        relationshipType: "aws.ec2.gateway-endpoint-owns-policy",
      },
    );
    const policyEdge = edge(
      "endpoint-policy-owner",
      "endpoint-policy",
      "endpoint",
      "aws.ec2.gateway-endpoint-owns-policy",
    );
    const rule = createNetworkRoutingRuleV1(awsCatalogArtifactV1);

    const restrictedMissing = report(
      rule,
      document([endpoint("restricted")], []),
    ).findings.find(
      (finding) =>
        finding.code === "aws.validation.gateway-endpoint-policy-mode-mismatch",
    );
    expect(restrictedMissing).toMatchObject({
      severity: "security-error",
      affected: [
        {
          path: "$.nodes[0].semantic.configuration.values.policyMode",
        },
      ],
    });
    expect(restrictedMissing?.autoFix).toBeUndefined();

    const restrictedOwned = report(
      rule,
      document([endpoint("restricted"), policy], [policyEdge]),
    );
    expect(
      restrictedOwned.findings.find(
        (finding) =>
          finding.code ===
          "aws.validation.gateway-endpoint-policy-mode-mismatch",
      ),
    ).toBeUndefined();

    const fullAccessOwned = report(
      rule,
      document([endpoint("full-access"), policy], [policyEdge]),
    ).findings.find(
      (finding) =>
        finding.code === "aws.validation.gateway-endpoint-policy-mode-mismatch",
    );
    expect(fullAccessOwned?.affected.map((location) => location.path)).toEqual(
      expect.arrayContaining([
        "$.nodes[0].semantic.configuration.values.policyMode",
        "$.edges[0]",
      ]),
    );
    expect(fullAccessOwned?.autoFix).toBeUndefined();
  });

  it("treats world-open administrative ingress as a security error", () => {
    const securityGroup = node("sg", "aws.ec2.security-group", {
      groupName: stringValue("lambda"),
      description: stringValue("Lambda egress policy"),
    });
    const ingress = node(
      "ingress",
      "aws.ec2.security-group-ingress-rule",
      {
        protocol: stringValue("tcp"),
        fromPort: integerValue(22),
        toPort: integerValue(22),
        sourceIpv4Cidr: stringValue("0.0.0.0/0"),
        description: stringValue("Do not allow"),
      },
      {
        nodeId: "sg",
        relationshipType: "aws.ec2.security-group-owns-ingress-rule",
      },
    );
    const candidate = document(
      [securityGroup, ingress],
      [
        edge(
          "sg-ingress",
          "ingress",
          "sg",
          "aws.ec2.security-group-owns-ingress-rule",
        ),
      ],
    );

    const result = report(
      createSecurityGroupPolicyRuleV1(awsCatalogArtifactV1),
      candidate,
      "production",
    );
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: "aws.validation.security-group-admin-ingress-open",
        severity: "security-error",
        affected: [
          expect.objectContaining({
            path: "$.nodes[0].semantic.configuration.values.sourceIpv4Cidr",
          }),
        ],
      }),
    ]);
    expect(result.findings[0]?.autoFix).toBeUndefined();
  });

  it("accepts protocol -1 fields while reporting broad all-protocol policy", () => {
    const securityGroup = node("sg", "aws.ec2.security-group", {
      groupName: stringValue("application"),
      description: stringValue("Application traffic"),
    });
    const ingress = node(
      "ingress",
      "aws.ec2.security-group-ingress-rule",
      {
        protocol: stringValue("-1"),
        fromPort: integerValue(-1),
        toPort: integerValue(-1),
        sourceIpv4Cidr: stringValue("0.0.0.0/0"),
        description: stringValue("All inbound traffic"),
      },
      {
        nodeId: "sg",
        relationshipType: "aws.ec2.security-group-owns-ingress-rule",
      },
    );
    const egress = node(
      "egress",
      "aws.ec2.security-group-egress-rule",
      {
        protocol: stringValue("-1"),
        fromPort: integerValue(-1),
        toPort: integerValue(-1),
        destinationIpv4Cidr: stringValue("0.0.0.0/0"),
        description: stringValue("All outbound traffic"),
      },
      {
        nodeId: "sg",
        relationshipType: "aws.ec2.security-group-owns-egress-rule",
      },
    );
    const candidate = document(
      [securityGroup, ingress, egress],
      [
        edge(
          "sg-ingress",
          "ingress",
          "sg",
          "aws.ec2.security-group-owns-ingress-rule",
        ),
        edge(
          "sg-egress",
          "egress",
          "sg",
          "aws.ec2.security-group-owns-egress-rule",
        ),
      ],
    );

    const result = report(
      createSecurityGroupPolicyRuleV1(awsCatalogArtifactV1),
      candidate,
      "production",
    );
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "aws.validation.security-group-all-ingress-open",
        "aws.validation.security-group-broad-egress",
      ]),
    );
    expect(
      result.findings.find(
        (finding) =>
          finding.code === "aws.validation.security-group-port-range-invalid",
      ),
    ).toBeUndefined();
    expect(
      result.findings.every((finding) => finding.autoFix === undefined),
    ).toBe(true);
  });

  it("explains single-AZ and public-subnet Lambda VPC access without inventing fixes", () => {
    const { region, vpc, zoneA, hierarchyEdges } = baseHierarchy();
    const subnet = node(
      "public-subnet",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.0.1.0/24"),
        accessTier: stringValue("public"),
        mapPublicIpOnLaunch: booleanValue(true),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const securityGroup = node("sg", "aws.ec2.security-group", {
      groupName: stringValue("lambda"),
      description: stringValue("Lambda network policy"),
    });
    const lambda = node("lambda", "aws.lambda.function");
    const configuration = node(
      "lambda-vpc",
      "aws.lambda.vpc-access-configuration",
      { ipv6AllowedForDualStack: booleanValue(false) },
      {
        nodeId: "lambda",
        relationshipType: "aws.lambda.owns-vpc-access-configuration",
      },
    );
    const candidate = document(
      [region, vpc, zoneA, subnet, securityGroup, lambda, configuration],
      [
        ...hierarchyEdges,
        edge(
          "zone-subnet",
          "zone-a",
          "public-subnet",
          "aws.ec2.availability-zone-contains-subnet",
        ),
        edge("vpc-sg", "vpc", "sg", "aws.ec2.vpc-associates-security-group"),
        edge(
          "lambda-vpc-owner",
          "lambda-vpc",
          "lambda",
          "aws.lambda.owns-vpc-access-configuration",
        ),
        edge(
          "lambda-vpc-subnet",
          "lambda-vpc",
          "public-subnet",
          "aws.lambda.vpc-access-uses-subnet",
        ),
        edge(
          "lambda-vpc-sg",
          "lambda-vpc",
          "sg",
          "aws.lambda.vpc-access-uses-security-group",
        ),
      ],
    );

    const result = report(
      createLambdaVpcAccessRuleV1(awsCatalogArtifactV1),
      candidate,
    );
    expect(
      result.findings.map((finding) => ({
        code: finding.code,
        severity: finding.severity,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          code: "aws.validation.lambda-vpc-single-availability-zone",
          severity: "recommendation",
        },
        {
          code: "aws.validation.lambda-vpc-public-subnet-no-internet",
          severity: "warning",
        },
        {
          code: "aws.validation.lambda-vpc-eni-permission-missing",
          severity: "error",
        },
      ]),
    );
    expect(
      result.findings.every((finding) => finding.autoFix === undefined),
    ).toBe(true);
  });

  it("accepts two private AZs, one security group, and the reviewed Lambda VPC policy", () => {
    const { region, vpc, zoneA, hierarchyEdges } = baseHierarchy();
    const zoneB = node(
      "zone-b",
      "aws.ec2.availability-zone",
      { zoneName: stringValue("us-east-1b") },
      {
        nodeId: "vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
    );
    const subnetA = node(
      "subnet-a",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.0.1.0/24"),
        accessTier: stringValue("private"),
      },
      {
        nodeId: "zone-a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const subnetB = node(
      "subnet-b",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.0.2.0/24"),
        accessTier: stringValue("private"),
      },
      {
        nodeId: "zone-b",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const securityGroup = node("sg", "aws.ec2.security-group", {
      groupName: stringValue("lambda"),
      description: stringValue("policy"),
    });
    const lambda = node("lambda", "aws.lambda.function");
    const configuration = node(
      "lambda-vpc",
      "aws.lambda.vpc-access-configuration",
      { ipv6AllowedForDualStack: booleanValue(false) },
      {
        nodeId: "lambda",
        relationshipType: "aws.lambda.owns-vpc-access-configuration",
      },
    );
    const role = node("role", "aws.iam.role");
    const attachment = node("vpc-policy", "aws.iam.managed-policy-attachment", {
      attachmentKind: stringValue("managed-policy-attachment"),
      managedPolicyReference: stringValue(
        "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole",
      ),
    });
    const candidate = document(
      [
        region,
        vpc,
        zoneA,
        zoneB,
        subnetA,
        subnetB,
        securityGroup,
        lambda,
        configuration,
        role,
        attachment,
      ],
      [
        ...hierarchyEdges,
        edge(
          "vpc-zone-b",
          "vpc",
          "zone-b",
          "aws.ec2.vpc-contains-availability-zone",
        ),
        edge(
          "zone-a-subnet",
          "zone-a",
          "subnet-a",
          "aws.ec2.availability-zone-contains-subnet",
        ),
        edge(
          "zone-b-subnet",
          "zone-b",
          "subnet-b",
          "aws.ec2.availability-zone-contains-subnet",
        ),
        edge("vpc-sg", "vpc", "sg", "aws.ec2.vpc-associates-security-group"),
        edge(
          "lambda-vpc-owner",
          "lambda-vpc",
          "lambda",
          "aws.lambda.owns-vpc-access-configuration",
        ),
        edge(
          "lambda-vpc-subnet-a",
          "lambda-vpc",
          "subnet-a",
          "aws.lambda.vpc-access-uses-subnet",
        ),
        edge(
          "lambda-vpc-subnet-b",
          "lambda-vpc",
          "subnet-b",
          "aws.lambda.vpc-access-uses-subnet",
        ),
        edge(
          "lambda-vpc-sg",
          "lambda-vpc",
          "sg",
          "aws.lambda.vpc-access-uses-security-group",
        ),
        edge("role-lambda", "role", "lambda", "aws.iam.role-assumed-by-lambda"),
        edge(
          "policy-role",
          "vpc-policy",
          "role",
          "aws.iam.role-owns-managed-policy-attachment",
        ),
      ],
    );

    const result = report(
      createLambdaVpcAccessRuleV1(awsCatalogArtifactV1),
      candidate,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("requires private egress only when Lambda VPC access explicitly opts in", () => {
    const egressDocument = (
      requirement: "none" | "internet" | "s3" | "dynamodb" | "s3-and-dynamodb",
      endpointServices: readonly ("s3" | "dynamodb")[] = [],
      includeNat = false,
      includeNatPublicPath = includeNat,
    ) => {
      const vpc = node("vpc", "aws.ec2.vpc");
      const zone = node(
        "zone",
        "aws.ec2.availability-zone",
        { zoneName: stringValue("us-east-1a") },
        {
          nodeId: "vpc",
          relationshipType: "aws.ec2.vpc-contains-availability-zone",
        },
      );
      const subnet = node(
        "subnet",
        "aws.ec2.subnet",
        {
          cidrBlock: stringValue("10.0.1.0/24"),
          accessTier: stringValue("private"),
          mapPublicIpOnLaunch: booleanValue(false),
          assignIpv6AddressOnCreation: booleanValue(false),
        },
        {
          nodeId: "zone",
          relationshipType: "aws.ec2.availability-zone-contains-subnet",
        },
      );
      const routeTable = node(
        "route-table",
        "aws.ec2.route-table",
        { name: stringValue("private") },
        { nodeId: "vpc", relationshipType: "aws.ec2.vpc-contains-route-table" },
      );
      const association = node(
        "association",
        "aws.ec2.route-table-association",
        {},
        {
          nodeId: "route-table",
          relationshipType: "aws.ec2.route-table-owns-subnet-association",
        },
      );
      const securityGroup = node("security-group", "aws.ec2.security-group");
      const lambda = node("lambda", "aws.lambda.function");
      const configuration = node(
        "vpc-access",
        "aws.lambda.vpc-access-configuration",
        {
          egressRequirement: stringValue(requirement),
          ipv6AllowedForDualStack: booleanValue(false),
        },
        {
          nodeId: "lambda",
          relationshipType: "aws.lambda.owns-vpc-access-configuration",
        },
      );
      const endpointNodes = endpointServices.map((service) =>
        node(
          `endpoint-${service}`,
          "aws.ec2.gateway-vpc-endpoint",
          {
            service: stringValue(service),
            endpointType: stringValue("Gateway"),
            policyMode: stringValue("full-access"),
          },
          {
            nodeId: "vpc",
            relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
          },
        ),
      );
      const natSubnet = node(
        "nat-subnet",
        "aws.ec2.subnet",
        {
          cidrBlock: stringValue("10.0.2.0/24"),
          accessTier: stringValue("public"),
          mapPublicIpOnLaunch: booleanValue(false),
          assignIpv6AddressOnCreation: booleanValue(false),
        },
        {
          nodeId: "zone",
          relationshipType: "aws.ec2.availability-zone-contains-subnet",
        },
      );
      const nat = node(
        "nat",
        "aws.ec2.nat-gateway",
        {
          allocationId: stringValue("eipalloc-0123456789abcdef0"),
          connectivityType: stringValue("public"),
          availabilityMode: stringValue("zonal"),
        },
        {
          nodeId: "nat-subnet",
          relationshipType: "aws.ec2.subnet-contains-nat-gateway",
        },
      );
      const internetGateway = node(
        "internet-gateway",
        "aws.ec2.internet-gateway",
        { name: stringValue("application-internet") },
      );
      const natRouteTable = node(
        "nat-route-table",
        "aws.ec2.route-table",
        { name: stringValue("public") },
        {
          nodeId: "vpc",
          relationshipType: "aws.ec2.vpc-contains-route-table",
        },
      );
      const natAssociation = node(
        "nat-association",
        "aws.ec2.route-table-association",
        {},
        {
          nodeId: "nat-route-table",
          relationshipType: "aws.ec2.route-table-owns-subnet-association",
        },
      );
      const natInternetRoute = node(
        "nat-internet-route",
        "aws.ec2.route",
        { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
        {
          nodeId: "nat-route-table",
          relationshipType: "aws.ec2.route-table-owns-route",
        },
      );
      const defaultRoute = node(
        "default-route",
        "aws.ec2.route",
        { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
        {
          nodeId: "route-table",
          relationshipType: "aws.ec2.route-table-owns-route",
        },
      );
      return document(
        [
          vpc,
          zone,
          subnet,
          routeTable,
          association,
          securityGroup,
          lambda,
          configuration,
          ...endpointNodes,
          ...(includeNat ? [natSubnet, nat, defaultRoute] : []),
          ...(includeNatPublicPath
            ? [internetGateway, natRouteTable, natAssociation, natInternetRoute]
            : []),
        ],
        [
          edge(
            "association-owner",
            "association",
            "route-table",
            "aws.ec2.route-table-owns-subnet-association",
          ),
          edge(
            "association-target",
            "association",
            "subnet",
            "aws.ec2.route-table-association-targets-subnet",
          ),
          edge(
            "vpc-security-group",
            "vpc",
            "security-group",
            "aws.ec2.vpc-associates-security-group",
          ),
          edge(
            "lambda-vpc-owner",
            "vpc-access",
            "lambda",
            "aws.lambda.owns-vpc-access-configuration",
          ),
          edge(
            "lambda-vpc-subnet",
            "vpc-access",
            "subnet",
            "aws.lambda.vpc-access-uses-subnet",
          ),
          edge(
            "lambda-vpc-security-group",
            "vpc-access",
            "security-group",
            "aws.lambda.vpc-access-uses-security-group",
          ),
          ...endpointServices.map((service) =>
            edge(
              `endpoint-${service}-table`,
              `endpoint-${service}`,
              "route-table",
              "aws.ec2.gateway-endpoint-associates-route-table",
            ),
          ),
          ...(includeNat
            ? [
                edge(
                  "default-route-owner",
                  "default-route",
                  "route-table",
                  "aws.ec2.route-table-owns-route",
                ),
                edge(
                  "default-route-target",
                  "default-route",
                  "nat",
                  "aws.ec2.route-targets-nat-gateway",
                ),
              ]
            : []),
          ...(includeNatPublicPath
            ? [
                edge(
                  "vpc-internet-gateway",
                  "vpc",
                  "internet-gateway",
                  "aws.ec2.vpc-attaches-internet-gateway",
                ),
                edge(
                  "nat-association-owner",
                  "nat-association",
                  "nat-route-table",
                  "aws.ec2.route-table-owns-subnet-association",
                ),
                edge(
                  "nat-association-target",
                  "nat-association",
                  "nat-subnet",
                  "aws.ec2.route-table-association-targets-subnet",
                ),
                edge(
                  "nat-internet-route-owner",
                  "nat-internet-route",
                  "nat-route-table",
                  "aws.ec2.route-table-owns-route",
                ),
                edge(
                  "nat-internet-route-target",
                  "nat-internet-route",
                  "internet-gateway",
                  "aws.ec2.route-targets-internet-gateway",
                ),
              ]
            : []),
        ],
      );
    };
    const rule = createLambdaVpcAccessRuleV1(awsCatalogArtifactV1);
    const hasMissingEgressFinding = (candidate: ArchitectureDocumentV1) =>
      report(rule, candidate, "production").findings.find(
        (finding) =>
          finding.code ===
          "aws.validation.lambda-vpc-egress-requirement-unsatisfied",
      );

    expect(hasMissingEgressFinding(egressDocument("none"))).toBeUndefined();
    const missing = hasMissingEgressFinding(egressDocument("dynamodb"));
    expect(missing).toMatchObject({ severity: "error" });
    expect(missing?.affected.map((location) => location.path).sort()).toEqual(
      [
        "$.edges[4]",
        "$.nodes[6].semantic.configuration.values.egressRequirement",
      ].sort(),
    );
    expect(missing?.autoFix).toBeUndefined();
    expect(
      hasMissingEgressFinding(egressDocument("dynamodb", ["dynamodb"])),
    ).toBeUndefined();
    expect(
      hasMissingEgressFinding(egressDocument("s3-and-dynamodb", ["dynamodb"])),
    ).toBeDefined();
    expect(
      hasMissingEgressFinding(
        egressDocument("s3-and-dynamodb", ["dynamodb", "s3"]),
      ),
    ).toBeUndefined();
    expect(
      hasMissingEgressFinding(egressDocument("internet", [], true, false)),
    ).toMatchObject({ severity: "error" });
    expect(
      hasMissingEgressFinding(egressDocument("internet", [], true)),
    ).toBeUndefined();
  });

  it("rejects private IGW routing and reports bounded NAT mode and cross-AZ cost choices", () => {
    const { region, vpc, zoneA, hierarchyEdges } = baseHierarchy();
    const privateSubnet = node(
      "private-subnet",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.0.1.0/24"),
        accessTier: stringValue("private"),
        mapPublicIpOnLaunch: booleanValue(false),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const routeTable = node(
      "private-table",
      "aws.ec2.route-table",
      { name: stringValue("private") },
      { nodeId: "vpc", relationshipType: "aws.ec2.vpc-contains-route-table" },
    );
    const association = node(
      "private-association",
      "aws.ec2.route-table-association",
      {},
      {
        nodeId: "private-table",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
    );
    const route = node(
      "default-route",
      "aws.ec2.route",
      { destinationIpv4Cidr: stringValue("0.0.0.0/0") },
      {
        nodeId: "private-table",
        relationshipType: "aws.ec2.route-table-owns-route",
      },
    );
    const internetGateway = node(
      "internet-gateway",
      "aws.ec2.internet-gateway",
      { name: stringValue("internet") },
    );
    const directInternet = document(
      [
        region,
        vpc,
        zoneA,
        privateSubnet,
        routeTable,
        association,
        route,
        internetGateway,
      ],
      [
        ...hierarchyEdges,
        edge(
          "zone-private-subnet",
          "zone-a",
          "private-subnet",
          "aws.ec2.availability-zone-contains-subnet",
        ),
        edge(
          "vpc-private-table",
          "vpc",
          "private-table",
          "aws.ec2.vpc-contains-route-table",
        ),
        edge(
          "private-association-owner",
          "private-association",
          "private-table",
          "aws.ec2.route-table-owns-subnet-association",
        ),
        edge(
          "private-association-target",
          "private-association",
          "private-subnet",
          "aws.ec2.route-table-association-targets-subnet",
        ),
        edge(
          "default-route-owner",
          "default-route",
          "private-table",
          "aws.ec2.route-table-owns-route",
        ),
        edge(
          "vpc-internet-gateway",
          "vpc",
          "internet-gateway",
          "aws.ec2.vpc-attaches-internet-gateway",
        ),
        edge(
          "default-route-target",
          "default-route",
          "internet-gateway",
          "aws.ec2.route-targets-internet-gateway",
        ),
      ],
    );
    expect(
      report(
        createNetworkRoutingRuleV1(awsCatalogArtifactV1),
        directInternet,
      ).findings.map((finding) => finding.code),
    ).toContain("aws.validation.private-subnet-direct-internet-route");

    const unsupportedNat = node(
      "unsupported-nat",
      "aws.ec2.nat-gateway",
      {
        allocationId: stringValue("eipalloc-0123456789abcdef0"),
        connectivityType: stringValue("private"),
        availabilityMode: stringValue("regional"),
      },
      {
        nodeId: "private-subnet",
        relationshipType: "aws.ec2.subnet-contains-nat-gateway",
      },
    );
    const unsupportedNatReport = report(
      createNetworkRoutingRuleV1(awsCatalogArtifactV1),
      document([privateSubnet, unsupportedNat], []),
    );
    expect(
      unsupportedNatReport.findings.map((finding) => finding.code),
    ).toEqual(
      expect.arrayContaining([
        "aws.validation.nat-gateway-mode-unsupported",
        "aws.validation.nat-gateway-endpoint-choice",
      ]),
    );
    const endpointChoice = unsupportedNatReport.findings.find(
      (finding) =>
        finding.code === "aws.validation.nat-gateway-endpoint-choice",
    );
    expect(endpointChoice).toMatchObject({
      severity: "cost-warning",
      affected: [{ path: "$.nodes[1]" }],
    });
    expect(endpointChoice?.autoFix).toBeUndefined();

    const zoneB = node(
      "zone-b",
      "aws.ec2.availability-zone",
      { zoneName: stringValue("us-east-1b") },
      {
        nodeId: "vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
    );
    const natSubnet = node(
      "nat-subnet",
      "aws.ec2.subnet",
      {
        cidrBlock: stringValue("10.0.2.0/24"),
        accessTier: stringValue("public"),
        mapPublicIpOnLaunch: booleanValue(false),
        assignIpv6AddressOnCreation: booleanValue(false),
      },
      {
        nodeId: "zone-b",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const natGateway = node(
      "nat-gateway",
      "aws.ec2.nat-gateway",
      {
        allocationId: stringValue("eipalloc-0123456789abcdef0"),
        connectivityType: stringValue("public"),
        availabilityMode: stringValue("zonal"),
      },
      {
        nodeId: "nat-subnet",
        relationshipType: "aws.ec2.subnet-contains-nat-gateway",
      },
    );
    const crossAz = document(
      [
        region,
        vpc,
        zoneA,
        zoneB,
        privateSubnet,
        natSubnet,
        routeTable,
        association,
        route,
        natGateway,
      ],
      [
        ...hierarchyEdges,
        edge(
          "vpc-zone-b",
          "vpc",
          "zone-b",
          "aws.ec2.vpc-contains-availability-zone",
        ),
        edge(
          "zone-private-subnet",
          "zone-a",
          "private-subnet",
          "aws.ec2.availability-zone-contains-subnet",
        ),
        edge(
          "zone-nat-subnet",
          "zone-b",
          "nat-subnet",
          "aws.ec2.availability-zone-contains-subnet",
        ),
        edge(
          "vpc-private-table",
          "vpc",
          "private-table",
          "aws.ec2.vpc-contains-route-table",
        ),
        edge(
          "private-association-owner",
          "private-association",
          "private-table",
          "aws.ec2.route-table-owns-subnet-association",
        ),
        edge(
          "private-association-target",
          "private-association",
          "private-subnet",
          "aws.ec2.route-table-association-targets-subnet",
        ),
        edge(
          "default-route-owner",
          "default-route",
          "private-table",
          "aws.ec2.route-table-owns-route",
        ),
        edge(
          "default-route-nat-target",
          "default-route",
          "nat-gateway",
          "aws.ec2.route-targets-nat-gateway",
        ),
      ],
    );
    const crossAzReport = report(
      createNetworkRoutingRuleV1(awsCatalogArtifactV1),
      crossAz,
    );
    const crossAzChoice = crossAzReport.findings.find(
      (finding) => finding.code === "aws.validation.nat-gateway-cross-az-route",
    );
    expect(crossAzChoice).toMatchObject({
      severity: "cost-warning",
      affected: [{ path: "$.edges[0]" }],
    });
    expect(crossAzChoice?.autoFix).toBeUndefined();
  });

  it("rejects unsupported, unassociated, and cross-VPC gateway endpoints", () => {
    const vpcA = node("vpc-a", "aws.ec2.vpc", {
      cidrBlock: stringValue("10.0.0.0/16"),
    });
    const vpcB = node("vpc-b", "aws.ec2.vpc", {
      cidrBlock: stringValue("10.1.0.0/16"),
    });
    const unsupported = node(
      "unsupported-endpoint",
      "aws.ec2.gateway-vpc-endpoint",
      {
        service: stringValue("sns"),
        endpointType: stringValue("Interface"),
        policyMode: stringValue("custom"),
      },
      {
        nodeId: "vpc-a",
        relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
      },
    );
    const crossVpc = node(
      "cross-vpc-endpoint",
      "aws.ec2.gateway-vpc-endpoint",
      {
        service: stringValue("dynamodb"),
        endpointType: stringValue("Gateway"),
        policyMode: stringValue("full-access"),
      },
      {
        nodeId: "vpc-a",
        relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
      },
    );
    const routeTable = node(
      "vpc-b-table",
      "aws.ec2.route-table",
      { name: stringValue("vpc-b") },
      {
        nodeId: "vpc-b",
        relationshipType: "aws.ec2.vpc-contains-route-table",
      },
    );
    const candidate = document(
      [vpcA, vpcB, unsupported, crossVpc, routeTable],
      [
        edge(
          "cross-vpc-endpoint-table",
          "cross-vpc-endpoint",
          "vpc-b-table",
          "aws.ec2.gateway-endpoint-associates-route-table",
        ),
      ],
    );
    const codes = report(
      createNetworkRoutingRuleV1(awsCatalogArtifactV1),
      candidate,
    ).findings.map((finding) => finding.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "aws.validation.gateway-endpoint-mode-unsupported",
        "aws.validation.gateway-endpoint-route-table-missing",
        "aws.validation.gateway-endpoint-route-table-vpc-mismatch",
      ]),
    );
  });

  it("rejects invalid security-group ownership and CIDRs while distinguishing broad web ingress", () => {
    const securityGroup = node("sg", "aws.ec2.security-group", {
      groupName: stringValue("application"),
      description: stringValue("Application traffic"),
    });
    const invalidIngress = node(
      "invalid-ingress",
      "aws.ec2.security-group-ingress-rule",
      {
        protocol: stringValue("tcp"),
        fromPort: integerValue(443),
        toPort: integerValue(443),
        sourceIpv4Cidr: stringValue("10.0.0.1/24"),
        description: stringValue("Non-canonical peer"),
      },
    );
    const broadIngress = node(
      "broad-ingress",
      "aws.ec2.security-group-ingress-rule",
      {
        protocol: stringValue("tcp"),
        fromPort: integerValue(443),
        toPort: integerValue(443),
        sourceIpv4Cidr: stringValue("0.0.0.0/0"),
        description: stringValue("Reviewed public TLS"),
      },
      {
        nodeId: "sg",
        relationshipType: "aws.ec2.security-group-owns-ingress-rule",
      },
    );
    const candidate = document(
      [securityGroup, invalidIngress, broadIngress],
      [
        edge(
          "broad-ingress-owner",
          "broad-ingress",
          "sg",
          "aws.ec2.security-group-owns-ingress-rule",
        ),
      ],
    );
    const before = structuredClone(candidate);
    const rule = createSecurityGroupPolicyRuleV1(awsCatalogArtifactV1);
    const first = report(rule, candidate, "production");
    const second = report(rule, structuredClone(candidate), "production");

    expect(first).toEqual(second);
    expect(candidate).toEqual(before);
    expect(first.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "aws.validation.security-group-rule-owner-invalid",
        "aws.validation.security-group-cidr-invalid",
        "aws.validation.security-group-broad-ingress",
      ]),
    );
    expect(
      first.findings.find(
        (finding) =>
          finding.code === "aws.validation.security-group-broad-ingress",
      ),
    ).toMatchObject({ severity: "warning" });
  });

  it("reports an exact compilation limitation for metadata-only networking mappings", () => {
    const metadataOnlyCatalog = {
      ...awsCatalogArtifactV1,
      services: awsCatalogArtifactV1.services.map((service) =>
        service.id === "aws.ec2.vpc"
          ? {
              ...service,
              mappings: service.mappings.map((mapping) => ({
                ...mapping,
                implementationStatus: "metadata-only" as const,
              })),
            }
          : service,
      ),
    };
    const result = report(
      createCompilerReadinessRuleV1(metadataOnlyCatalog),
      document(
        [
          node("vpc", "aws.ec2.vpc", {
            cidrBlock: stringValue("10.0.0.0/16"),
          }),
        ],
        [],
      ),
      "production",
      "compilation",
    );

    expect(result.findings).toEqual([
      expect.objectContaining({
        code: "aws.validation.compiler-target-not-implemented",
        severity: "error",
        affected: [
          expect.objectContaining({
            path: "$.nodes[0].semantic.serviceType",
          }),
        ],
      }),
    ]);
  });

  it("accepts only the reviewed Region and zone semantic configuration without resource mappings", () => {
    const { region, vpc, zoneA, hierarchyEdges } = baseHierarchy();
    const candidate = document([region, vpc, zoneA], hierarchyEdges);
    const before = structuredClone(candidate);
    const rule = createCompilerReadinessRuleV1(awsCatalogArtifactV1);
    expect(
      report(rule, candidate, "production", "compilation").findings,
    ).toEqual([]);
    expect(candidate).toEqual(before);
    for (const serviceId of [
      "aws.region.boundary",
      "aws.ec2.availability-zone",
    ]) {
      expect(
        awsCatalogArtifactV1.services.find(
          (service) => service.id === serviceId,
        )?.mappings,
      ).toEqual([]);
    }
    const unsupported = document(
      [
        node("region", "aws.region.boundary", {
          regionName: stringValue("us-east-1"),
          invented: stringValue("unreviewed"),
        }),
        node("zone", "aws.ec2.availability-zone", {
          zoneName: stringValue("us-east-1a"),
          invented: stringValue("unreviewed"),
        }),
      ],
      [],
    );
    const findings = report(
      rule,
      unsupported,
      "production",
      "compilation",
    ).findings;
    expect(findings.map((finding) => finding.code)).toEqual([
      "aws.validation.configuration-binding-missing",
      "aws.validation.configuration-binding-missing",
    ]);
    expect(findings.map((finding) => finding.affected[0]?.path)).toEqual([
      "$.nodes[0].semantic.configuration.values.invented",
      "$.nodes[1].semantic.configuration.values.invented",
    ]);
  });

  it.each(["schema-version", "definition-version", "node-kind"] as const)(
    "does not infer semantic-boundary support from a changed %s",
    (change) => {
      const changed = {
        ...awsCatalogArtifactV1,
        services: awsCatalogArtifactV1.services.map((service) =>
          service.id === "aws.region.boundary"
            ? change === "schema-version"
              ? {
                  ...service,
                  configuration: {
                    ...service.configuration,
                    schemaVersion:
                      "2.0.0" as typeof service.configuration.schemaVersion,
                  },
                }
              : change === "definition-version"
                ? {
                    ...service,
                    definitionVersion:
                      "2.0.0" as typeof service.definitionVersion,
                  }
                : {
                    ...service,
                    nodeKind: {
                      kind: "resource" as const,
                      resourceType: resourceTypeSchema.parse(service.id),
                      deployable: true,
                    },
                  }
            : service,
        ),
      };
      const result = report(
        createCompilerReadinessRuleV1(changed),
        document(
          [
            node("region", "aws.region.boundary", {
              regionName: stringValue("us-east-1"),
            }),
          ],
          [],
        ),
        "production",
        "compilation",
      );
      expect(result.findings).toMatchObject([
        {
          code: "aws.validation.compiler-target-not-implemented",
          severity: "error",
        },
      ]);
    },
  );

  it.each(["0.31.0"])(
    "rejects semantic-boundary admission for uninstalled catalog %s",
    (version) => {
      const changed = {
        ...awsCatalogArtifactV1,
        catalog: {
          ...awsCatalogArtifactV1.catalog,
          version: version as typeof awsCatalogArtifactV1.catalog.version,
        },
      };
      const candidate = document(
        [
          node("region", "aws.region.boundary", {
            regionName: stringValue("us-east-1"),
          }),
        ],
        [],
      );
      const result = report(
        createCompilerReadinessRuleV1(changed),
        {
          ...candidate,
          catalog: { ...candidate.catalog, version: changed.catalog.version },
        },
        "production",
        "compilation",
      );
      expect(result.evaluationStatus).toBe("incomplete");
      expect(result.diagnostics).toMatchObject([
        {
          code: "rule_execution_failed",
        },
      ]);
    },
  );

  it("accepts compiler-consumed networking intent without pretending it is a Terraform argument", () => {
    const result = report(
      createCompilerReadinessRuleV1(awsCatalogArtifactV1),
      document(
        [
          node("subnet", "aws.ec2.subnet", {
            accessTier: stringValue("private"),
          }),
          node("endpoint", "aws.ec2.gateway-vpc-endpoint", {
            policyMode: stringValue("full-access"),
          }),
          node("lambda-vpc", "aws.lambda.vpc-access-configuration", {
            egressRequirement: stringValue("s3"),
          }),
        ],
        [],
      ),
      "production",
      "compilation",
    );

    expect(result.findings).toEqual([]);
    const services = [
      "aws.ec2.subnet",
      "aws.ec2.gateway-vpc-endpoint",
      "aws.lambda.vpc-access-configuration",
    ].map((serviceId) =>
      awsCatalogArtifactV1.services.find(({ id }) => id === serviceId),
    );
    expect(
      services.map(
        (service) =>
          service?.mappings.find(
            ({ target, implementationStatus }) =>
              target === "terraform" && implementationStatus === "implemented",
          )?.semanticConfigurationKeys,
      ),
    ).toEqual([["accessTier"], ["policyMode"], ["egressRequirement"]]);
  });

  it("fails closed for Lambda owner, association cardinality, VPC, and IPv6 gaps", () => {
    const orphan = node(
      "orphan-vpc-access",
      "aws.lambda.vpc-access-configuration",
      { ipv6AllowedForDualStack: booleanValue(true) },
    );
    const lambda = node("lambda", "aws.lambda.function");
    const configuration = node(
      "cross-vpc-access",
      "aws.lambda.vpc-access-configuration",
      { ipv6AllowedForDualStack: booleanValue(false) },
      {
        nodeId: "lambda",
        relationshipType: "aws.lambda.owns-vpc-access-configuration",
      },
    );
    const vpcA = node("vpc-a", "aws.ec2.vpc");
    const vpcB = node("vpc-b", "aws.ec2.vpc");
    const zoneA = node(
      "zone-a",
      "aws.ec2.availability-zone",
      { zoneName: stringValue("us-east-1a") },
      {
        nodeId: "vpc-a",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
    );
    const subnet = node(
      "subnet-a",
      "aws.ec2.subnet",
      { accessTier: stringValue("private") },
      {
        nodeId: "zone-a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    );
    const securityGroup = node("sg-b", "aws.ec2.security-group");
    const candidate = document(
      [orphan, lambda, configuration, vpcA, vpcB, zoneA, subnet, securityGroup],
      [
        edge(
          "lambda-vpc-owner",
          "cross-vpc-access",
          "lambda",
          "aws.lambda.owns-vpc-access-configuration",
        ),
        edge(
          "lambda-vpc-subnet",
          "cross-vpc-access",
          "subnet-a",
          "aws.lambda.vpc-access-uses-subnet",
        ),
        edge(
          "vpc-b-sg",
          "vpc-b",
          "sg-b",
          "aws.ec2.vpc-associates-security-group",
        ),
        edge(
          "lambda-vpc-sg",
          "cross-vpc-access",
          "sg-b",
          "aws.lambda.vpc-access-uses-security-group",
        ),
      ],
    );
    const result = report(
      createLambdaVpcAccessRuleV1(awsCatalogArtifactV1),
      candidate,
      "production",
      "compilation",
    );

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "aws.validation.lambda-vpc-owner-invalid",
        "aws.validation.lambda-vpc-subnet-cardinality-invalid",
        "aws.validation.lambda-vpc-security-group-cardinality-invalid",
        "aws.validation.lambda-vpc-association-vpc-mismatch",
        "aws.validation.lambda-vpc-ipv6-mode-unsupported",
      ]),
    );
    expect(
      result.findings.every((finding) => finding.autoFix === undefined),
    ).toBe(true);
  });
});
