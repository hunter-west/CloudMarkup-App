import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { auroraFixture } from "./aurora-fixture.test-support.js";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import {
  auroraBindings,
  auroraProperties,
} from "./catalog/services/aurora-postgres.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { rdsFixture } from "./rds-fixture.test-support.js";
import { awsServiceExtensionV1 } from "./service-extension-v1-accessors.js";
import { createAuroraReadinessRuleV1 } from "./validation/aurora-readiness-rule.js";
const rule = createAuroraReadinessRuleV1(awsCatalogArtifactV1);
const findings = (document: ArchitectureDocument) =>
  executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    [rule],
  ).findings;
const errors = (document: ArchitectureDocument) =>
  findings(document).filter((f) => f.severity !== "warning");
const change = (
  document: ArchitectureDocument,
  id: string,
  key: string,
  value: ConfigurationValue,
) =>
  parseArchitectureDocument({
    ...document,
    nodes: document.nodes.map((n) =>
      n.id === id
        ? {
            ...n,
            semantic: {
              ...n.semantic,
              configuration: {
                ...n.semantic.configuration,
                values: { ...n.semantic.configuration.values, [key]: value },
              },
            },
          }
        : n,
    ),
  });
describe("bounded Aurora PostgreSQL Serverless v2", () => {
  it("rejects RDS and Aurora member identifiers in the same native namespace", () => {
    const aurora = auroraFixture(),
      rds = rdsFixture();
    const extra = new Set(["database", "db_parameters"]);
    const mixed = parseArchitectureDocument({
      ...aurora,
      nodes: [...aurora.nodes, ...rds.nodes.filter((n) => extra.has(n.id))],
      edges: [
        ...aurora.edges,
        ...rds.edges.filter(
          (e) =>
            extra.has(e.semantic.source.nodeId) ||
            extra.has(e.semantic.target.nodeId),
        ),
      ],
    });
    expect(errors(mixed)).toEqual([]);
    const collision = change(mixed, "aurora_a", "identifier", {
      kind: "string",
      value: "synthetic-postgres",
    });
    expect(errors(collision).map((f) => f.code)).toContain(
      "aws.validation.aurora-name",
    );
  });
  it("rejects a canonical security group from a different VPC", () => {
    const base = auroraFixture(),
      vpc = base.nodes.find((n) => n.id === "vpc");
    if (!vpc) throw Error("Missing VPC");
    const foreign = parseArchitectureDocument({
      ...base,
      nodes: [
        ...base.nodes,
        {
          ...vpc,
          id: "other_vpc",
          semantic: { ...vpc.semantic, deploymentKey: "other_vpc" },
        },
      ],
      edges: [
        ...base.edges.map((e) =>
          e.semantic.target.nodeId !== "group"
            ? e
            : {
                ...e,
                semantic: {
                  ...e.semantic,
                  source: { ...e.semantic.source, nodeId: "other_vpc" },
                },
              },
        ),
        ...base.edges
          .filter((e) => e.semantic.target.nodeId === "vpc")
          .map((e) => ({
            ...e,
            id: e.id + "_other",
            semantic: {
              ...e.semantic,
              target: { ...e.semantic.target, nodeId: "other_vpc" },
            },
          })),
      ],
    });
    expect(errors(foreign).map((f) => f.code)).toContain(
      "aws.validation.aurora-dependencies",
    );
  });
  it.each([false, true])(
    "admits %s two-member intent with external readiness only",
    (two) => {
      const document = auroraFixture(two);
      const first = findings(document);
      expect(first.filter((finding) => finding.severity !== "warning")).toEqual(
        [],
      );
      expect(first.map((f) => f.code)).toEqual([
        "aws.validation.aurora-external-readiness",
      ]);
      expect(first).toEqual(findings(document));
    },
  );
  it("adds three real native cards and no configuration helpers", () => {
    for (const id of Object.keys(auroraProperties)) {
      const service = awsCatalogV1.requireService(id);
      expect(service.nodeKind).toMatchObject({
        kind: "resource",
        deployable: true,
      });
      expect(service.iconId).not.toBeNull();
      expect(service.configuration.jsonSchema.additionalProperties).toBe(false);
      expect(
        service.configuration.uiHints.every((h) => h.valueSource === "literal"),
      ).toBe(true);
      expect(awsServiceExtensionV1.getOwnedConfigurationSlots(id)).toEqual([]);
      expect(service.mappings.map((m) => m.implementationStatus)).toEqual([
        "implemented",
        "implemented",
      ]);
    }
  });
  it.each(["template", "ai-accepted", "migration"] as const)(
    "preserves accepted user origin %s",
    (origin) => {
      const base = auroraFixture();
      const document = parseArchitectureDocument({
        ...base,
        nodes: base.nodes.map((n) =>
          auroraProperties[n.semantic.serviceType]
            ? {
                ...n,
                semantic: {
                  ...n.semantic,
                  lifecycle: { ownership: "user", origin },
                },
              }
            : n,
        ),
      });
      expect(errors(document)).toEqual([]);
    },
  );
  it.each(auroraBindings)(
    "resolves %s atomically and reversibly without grants",
    (rel, sourceType, sourcePort, targetType, targetPort) => {
      const original = auroraFixture(),
        edge = original.edges.find((e) => e.semantic.relationshipType === rel);
      if (!edge) throw Error("Missing edge");
      const document = parseArchitectureDocument({
        ...original,
        edges: original.edges.filter((e) => e.id !== edge.id),
      });
      const request = {
        document,
        ruleId: rel,
        source: {
          nodeId: edge.semantic.source.nodeId,
          portId: sourceType + "." + sourcePort,
        },
        target: {
          nodeId: edge.semantic.target.nodeId,
          portId: targetType + "." + targetPort,
        },
        configuration: {},
        operationId: "operation_aurora",
      };
      const result = awsConnectionResolverV1.resolve(request);
      expect(result.success).toBe(true);
      expect(result).toEqual(awsConnectionResolverV1.resolve(request));
      if (!result.success) throw Error("Missing plan");
      expect(result.batch.commands).toHaveLength(1);
      expect(result.preview.document.nodes).toEqual(document.nodes);
      const applied = applyGraphCommand(document, result.batch);
      if (applied.inversion.kind !== "available")
        throw Error("Missing inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(document);
      expect(
        awsConnectionResolverV1.resolve({
          ...request,
          source: request.target,
          target: request.source,
        }).success,
      ).toBe(false);
    },
  );
  it.each(Object.keys(auroraProperties))(
    "rejects every missing, wrong-kind and unknown field for %s",
    (type) => {
      const document = auroraFixture(),
        node = document.nodes.find((n) => n.semantic.serviceType === type);
      if (!node) throw Error("Missing node");
      for (const key of Object.keys(auroraProperties[type] ?? {})) {
        const { [key]: removed, ...remaining } = node.semantic.configuration
          .values as Record<string, ConfigurationValue>;
        if (!removed) throw Error("Missing field");
        const missing = parseArchitectureDocument({
          ...document,
          nodes: document.nodes.map((n) =>
            n.id === node.id
              ? {
                  ...n,
                  semantic: {
                    ...n.semantic,
                    configuration: {
                      ...n.semantic.configuration,
                      values: remaining,
                    },
                  },
                }
              : n,
          ),
        });
        expect(
          errors(missing).some(
            (f) => f.code === "aws.validation.aurora-configuration",
          ),
        ).toBe(true);
        const wrong: ConfigurationValue =
          removed.kind === "string"
            ? { kind: "boolean", value: true }
            : { kind: "string", value: "unsupported" };
        expect(
          errors(change(document, node.id, key, wrong)).map(
            (finding) => finding.code,
          ),
        ).toContain("aws.validation.aurora-configuration");
        expect(
          awsCatalogV1.validateConfiguration(type, {
            ...node.semantic.configuration.values,
            [key]: wrong,
          }).success,
        ).toBe(false);
      }
      expect(
        errors(
          change(document, node.id, "unreviewed", {
            kind: "string",
            value: "synthetic-sensitive-sentinel",
          }),
        ).map((finding) => finding.code),
      ).toContain("aws.validation.aurora-configuration");
    },
  );
  it.each([
    ["aurora_cluster", "engineVersion", "17.1"],
    ["aurora_cluster", "engineMode", "serverless"],
    ["aurora_cluster", "capacityMode", "provisioned"],
    ["aurora_cluster", "minimumCapacityAcus", "0"],
    ["aurora_cluster", "minimumCapacityAcus", "8"],
    ["aurora_cluster", "maximumCapacityAcus", "0.5"],
    ["aurora_cluster", "maximumCapacityAcus", "128"],
    ["aurora_cluster", "autoPause", true],
    ["aurora_cluster", "masterPassword", "synthetic-sensitive-sentinel"],
    ["aurora_cluster", "masterAuthMode", "user-password"],
    ["aurora_cluster", "storageType", "gp3"],
    ["aurora_cluster", "storageEncrypted", false],
    ["aurora_cluster", "deletionProtection", false],
    ["aurora_cluster", "retain", false],
    ["aurora_cluster", "dataApi", true],
    ["aurora_cluster", "iamAuthentication", true],
    ["aurora_cluster", "autoMinorUpgrade", true],
    ["aurora_cluster", "allowMajorUpgrade", true],
    ["aurora_cluster", "databaseName", "Table"],
    ["aurora_cluster", "masterUsername", "current_user"],
    ["aurora_cluster", "backupRetentionDays", 0],
    ["aurora_cluster", "backupWindow", "23:45-00:30"],
    ["aurora_cluster", "maintenanceWindow", "sun:02:15-sun:02:45"],
    ["aurora_a", "instanceClass", "db.r6g.large"],
    ["aurora_a", "availabilityZone", "us-east-1c"],
    ["aurora_a", "publicAccess", true],
    ["aurora_a", "retain", false],
    ["aurora_a", "promotionTier", 16],
    ["aurora_b", "promotionTier", 0],
    ["aurora_b", "availabilityZone", "us-east-1a"],
    ["aurora_a", "caIdentifier", "rds-ca-2019"],
    ["aurora_parameters", "family", "postgres16"],
    ["aurora_parameters", "forceTls", false],
    ["aurora_parameters", "name", "default-aurora"],
  ] as const)("rejects %s.%s=%s without echoing values", (id, key, value) => {
    const scalar: ConfigurationValue =
      typeof value === "boolean"
        ? { kind: "boolean", value }
        : typeof value === "number"
          ? { kind: "integer", value }
          : { kind: "string", value };
    const document = change(auroraFixture(), id, key, scalar);
    expect(errors(document).length).toBeGreaterThan(0);
    expect(JSON.stringify(findings(document))).not.toContain(
      "synthetic-sensitive-sentinel",
    );
  });
  it.each([
    "no-member",
    "third-member",
    "no-subnet-group",
    "no-parameters",
    "no-security",
    "wrong-port",
    "edge-schema",
    "edge-field",
    "duplicate-edge",
    "member-schema",
    "member-parent",
    "member-generated",
    "member-adopted",
    "same-subnet-zone",
    "region",
  ])("rejects malformed %s", (mode) => {
    let document = auroraFixture();
    if (mode === "same-subnet-zone")
      document = change(document, "az_b", "zoneName", {
        kind: "string",
        value: "us-east-1a",
      });
    else if (mode === "region")
      document = parseArchitectureDocument({
        ...document,
        provider: { ...document.provider, region: "us-west-2" },
      });
    else if (mode === "third-member") {
      const node = document.nodes.find((n) => n.id === "aurora_a");
      const edge = document.edges.find((e) => e.id === "aurora_member_a");
      const zone = document.nodes.find((n) => n.id === "az_b");
      const subnet = document.nodes.find((n) => n.id === "subnet_b");
      const vpcZone = document.edges.find((e) => e.id === "vpc_az_b");
      const zoneSubnet = document.edges.find((e) => e.id === "az_subnet_b");
      const groupSubnet = document.edges.find((e) => e.id === "db_subnet_b");
      if (
        !node ||
        !edge ||
        !zone ||
        !subnet ||
        !vpcZone ||
        !zoneSubnet ||
        !groupSubnet
      )
        throw Error("Missing member or canonical network fixture");
      document = parseArchitectureDocument({
        ...document,
        nodes: [
          ...document.nodes,
          {
            ...zone,
            id: "az_c",
            semantic: {
              ...zone.semantic,
              deploymentKey: "az_c",
              configuration: {
                ...zone.semantic.configuration,
                values: {
                  ...zone.semantic.configuration.values,
                  zoneName: { kind: "string", value: "us-east-1c" },
                },
              },
            },
          },
          {
            ...subnet,
            id: "subnet_c",
            semantic: {
              ...subnet.semantic,
              deploymentKey: "subnet_c",
              parent: {
                nodeId: "az_c",
                relationshipType: "aws.ec2.availability-zone-contains-subnet",
              },
              configuration: {
                ...subnet.semantic.configuration,
                values: {
                  ...subnet.semantic.configuration.values,
                  cidrBlock: { kind: "string", value: "10.0.3.0/24" },
                },
              },
            },
          },
          {
            ...node,
            id: "aurora_c",
            semantic: {
              ...node.semantic,
              deploymentKey: "aurora_c",
              configuration: {
                ...node.semantic.configuration,
                values: {
                  ...node.semantic.configuration.values,
                  identifier: { kind: "string", value: "synthetic-aurora-c" },
                  availabilityZone: { kind: "string", value: "us-east-1c" },
                  promotionTier: { kind: "integer", value: 2 },
                },
              },
            },
          },
        ],
        edges: [
          ...document.edges,
          {
            ...vpcZone,
            id: "vpc_az_c",
            semantic: {
              ...vpcZone.semantic,
              target: { ...vpcZone.semantic.target, nodeId: "az_c" },
            },
          },
          {
            ...zoneSubnet,
            id: "az_subnet_c",
            semantic: {
              ...zoneSubnet.semantic,
              source: { ...zoneSubnet.semantic.source, nodeId: "az_c" },
              target: { ...zoneSubnet.semantic.target, nodeId: "subnet_c" },
            },
          },
          {
            ...groupSubnet,
            id: "db_subnet_c",
            semantic: {
              ...groupSubnet.semantic,
              target: { ...groupSubnet.semantic.target, nodeId: "subnet_c" },
            },
          },
          {
            ...edge,
            id: "aurora_member_c",
            semantic: {
              ...edge.semantic,
              target: { ...edge.semantic.target, nodeId: "aurora_c" },
            },
          },
        ],
      });
    } else if (mode.startsWith("member-"))
      document = parseArchitectureDocument({
        ...document,
        nodes: document.nodes.map((n) =>
          n.id !== "aurora_a"
            ? n
            : {
                ...n,
                semantic: {
                  ...n.semantic,
                  ...(mode === "member-parent"
                    ? {
                        parent: {
                          nodeId: "vpc",
                          relationshipType: "aws.region.contains-vpc",
                        },
                      }
                    : {}),
                  lifecycle: {
                    ...n.semantic.lifecycle,
                    ...(mode === "member-generated"
                      ? {
                          ownership: "generated",
                          origin: "connection-rule",
                          provenance: {
                            dependentNodeIds: [],
                            dependentEdgeIds: [],
                            generatorKind: "connection-rule",
                            generatorId: "aws.aurora.cluster-has-instance",
                            generatorVersion: "1.0.0",
                            operationId: "operation_synthetic",
                          },
                        }
                      : mode === "member-adopted"
                        ? {
                            ownership: "adopted",
                            origin: "connection-rule",
                            adoptedBy: "actor_synthetic",
                            adoptedAt: "2026-10-04T00:00:00Z",
                            provenance: {
                              dependentNodeIds: [],
                              dependentEdgeIds: [],
                              generatorKind: "connection-rule",
                              generatorId: "aws.aurora.cluster-has-instance",
                              generatorVersion: "1.0.0",
                              operationId: "operation_synthetic",
                            },
                          }
                        : {}),
                  },
                  configuration: {
                    ...n.semantic.configuration,
                    ...(mode === "member-schema"
                      ? { schemaVersion: "9.0.0" }
                      : {}),
                  },
                },
              },
        ),
      });
    else {
      const edge = document.edges.find((e) => e.id === "aurora_subnets");
      if (!edge) throw Error("Missing edge");
      const remove =
        mode === "no-member"
          ? ["aurora_member_a", "aurora_member_b"]
          : mode === "no-subnet-group"
            ? ["aurora_subnets"]
            : mode === "no-parameters"
              ? ["aurora_tls"]
              : mode === "no-security"
                ? ["aurora_security"]
                : [];
      document = parseArchitectureDocument({
        ...document,
        edges: [
          ...document.edges
            .filter((e) => !remove.includes(e.id))
            .map((e) =>
              e.id !== edge.id
                ? e
                : {
                    ...e,
                    semantic: {
                      ...e.semantic,
                      source: {
                        ...e.semantic.source,
                        ...(mode === "wrong-port"
                          ? { port: "aws.rds.unreviewed" }
                          : {}),
                      },
                      configuration: {
                        ...e.semantic.configuration,
                        ...(mode === "edge-schema"
                          ? { schemaVersion: "9.0.0" }
                          : mode === "edge-field"
                            ? {
                                values: {
                                  unknown: {
                                    kind: "string",
                                    value: "unsupported",
                                  },
                                },
                              }
                            : {}),
                      },
                    },
                  },
            ),
          ...(mode === "duplicate-edge"
            ? [{ ...edge, id: "aurora_subnets_duplicate" }]
            : []),
        ],
      });
    }
    if (mode === "third-member") {
      expect(errors(document)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "aws.validation.aurora-members",
            affected: [
              expect.objectContaining({
                kind: "node",
                nodeId: "aurora_cluster",
              }),
            ],
          }),
        ]),
      );
    } else {
      expect(errors(document).length).toBeGreaterThan(0);
    }
  });
  it("matches the closed native configuration contract", async () => {
    const native = JSON.parse(
      await readFile(
        new URL(
          "../../../services/iac-compiler/internal/contracts/aurora-configuration-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;
    expect(native).toEqual(auroraProperties);
  });
});
