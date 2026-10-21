import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { rdsBindings, rdsProperties } from "./catalog/services/rds-postgres.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { rdsFixture } from "./rds-fixture.test-support.js";
import { awsServiceExtensionV1 } from "./service-extension-v1-accessors.js";
import { createRdsReadinessRuleV1 } from "./validation/rds-readiness-rule.js";
const rule = createRdsReadinessRuleV1(awsCatalogArtifactV1);
const findings = (d: ArchitectureDocument) =>
  executeArchitectureValidationRules(
    { document: d, target: "draft", environment: "development" },
    [rule],
  ).findings;
const errors = (d: ArchitectureDocument) =>
  findings(d).filter((f) => f.severity !== "warning");
const change = (
  d: ArchitectureDocument,
  id: string,
  key: string,
  value: ConfigurationValue,
) =>
  parseArchitectureDocument({
    ...d,
    nodes: d.nodes.map((n) =>
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
describe("bounded RDS PostgreSQL foundation", () => {
  it.each(["template", "ai-accepted", "migration"] as const)(
    "accepts reviewed user ownership from %s commands",
    (origin) => {
      const base = rdsFixture();
      const d = parseArchitectureDocument({
        ...base,
        nodes: base.nodes.map((n) =>
          rdsProperties[n.semantic.serviceType]
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
      expect(errors(d)).toEqual([]);
    },
  );
  it("rejects an otherwise modeled security group in a different canonical VPC", () => {
    const d = rdsFixture(),
      vpc = d.nodes.find((n) => n.id === "vpc"),
      membership = d.edges.find((e) => e.id === "region_vpc");
    if (!vpc || !membership) throw Error("Missing network fixture");
    const cross = parseArchitectureDocument({
      ...d,
      nodes: [
        ...d.nodes,
        {
          ...vpc,
          id: "other_vpc",
          semantic: { ...vpc.semantic, deploymentKey: "other_vpc" },
        },
      ],
      edges: [
        ...d.edges.map((e) =>
          e.id === "vpc_group"
            ? {
                ...e,
                semantic: {
                  ...e.semantic,
                  source: { ...e.semantic.source, nodeId: "other_vpc" },
                },
              }
            : e,
        ),
        {
          ...membership,
          id: "region_other_vpc",
          semantic: {
            ...membership.semantic,
            target: { ...membership.semantic.target, nodeId: "other_vpc" },
          },
        },
      ],
    });
    expect(
      errors(cross).some((f) => f.code === "aws.validation.rds-dependencies"),
    ).toBe(true);
  });
  it.each([false, true])(
    "admits private single/standby infrastructure intent %s",
    (multi) => {
      const d = rdsFixture(multi);
      const first = findings(d);
      expect(first.filter((finding) => finding.severity !== "warning")).toEqual(
        [],
      );
      expect(first).toHaveLength(1);
      expect(first[0]?.code).toBe("aws.validation.rds-external-readiness");
      expect(first).toEqual(findings(d));
    },
  );
  it("adds three native cards in one family with no application generation", () => {
    for (const id of Object.keys(rdsProperties)) {
      const s = awsCatalogV1.requireService(id);
      expect(s.nodeKind).toMatchObject({ kind: "resource", deployable: true });
      expect(s.iconId).not.toBeNull();
      expect(s.configuration.jsonSchema.additionalProperties).toBe(false);
      expect(
        s.configuration.uiHints.every((h) => h.valueSource === "literal"),
      ).toBe(true);
      expect(awsServiceExtensionV1.getOwnedConfigurationSlots(id)).toEqual([]);
      expect(s.mappings.map((m) => m.implementationStatus)).toEqual([
        "implemented",
        "implemented",
      ]);
    }
  });
  it.each(rdsBindings)(
    "resolves %s reversibly without invented grants",
    (rel, sourceType, sourceSuffix, targetType, targetSuffix) => {
      const original = rdsFixture(),
        edge = original.edges.find((e) => e.semantic.relationshipType === rel);
      if (!edge) throw Error("Missing binding");
      const d = parseArchitectureDocument({
        ...original,
        edges: original.edges.filter((e) => e.id !== edge.id),
      });
      const request = {
        document: d,
        ruleId: rel,
        source: {
          nodeId: edge.semantic.source.nodeId,
          portId: sourceType + "." + sourceSuffix,
        },
        target: {
          nodeId: edge.semantic.target.nodeId,
          portId: targetType + "." + targetSuffix,
        },
        configuration: {},
        operationId: "operation_rds",
      };
      const result = awsConnectionResolverV1.resolve(request);
      expect(result.success).toBe(true);
      expect(result).toEqual(awsConnectionResolverV1.resolve(request));
      if (!result.success) throw Error("Missing plan");
      expect(result.batch.commands).toHaveLength(1);
      expect(result.preview.document.nodes).toEqual(d.nodes);
      const applied = applyGraphCommand(d, result.batch);
      if (applied.inversion.kind !== "available")
        throw Error("Missing inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(d);
      expect(
        awsConnectionResolverV1.resolve({
          ...request,
          source: request.target,
          target: request.source,
        }).success,
      ).toBe(false);
    },
  );
  it.each(Object.keys(rdsProperties))(
    "rejects every missing/wrong-kind/unknown field of %s",
    (type) => {
      const d = rdsFixture(),
        n = d.nodes.find((n) => n.semantic.serviceType === type);
      if (!n) throw Error("Missing node");
      for (const key of Object.keys(rdsProperties[type] ?? {})) {
        const { [key]: removed, ...remaining } = n.semantic.configuration
          .values as Record<string, ConfigurationValue>;
        if (!removed) throw Error("Missing field");
        const missing = parseArchitectureDocument({
          ...d,
          nodes: d.nodes.map((q) =>
            q.id === n.id
              ? {
                  ...q,
                  semantic: {
                    ...q.semantic,
                    configuration: {
                      ...q.semantic.configuration,
                      values: remaining,
                    },
                  },
                }
              : q,
          ),
        });
        expect(
          errors(missing).some(
            (f) => f.code === "aws.validation.rds-configuration",
          ),
        ).toBe(true);
        const wrong: ConfigurationValue =
          removed.kind === "string"
            ? { kind: "boolean", value: true }
            : { kind: "string", value: "unsupported" };
        expect(
          errors(change(d, n.id, key, wrong)).map((finding) => finding.code),
        ).toContain("aws.validation.rds-configuration");
        expect(
          awsCatalogV1.validateConfiguration(type, {
            ...n.semantic.configuration.values,
            [key]: wrong,
          }).success,
        ).toBe(false);
      }
      expect(
        errors(
          change(d, n.id, "unreviewed", {
            kind: "string",
            value: "synthetic-sensitive-sentinel",
          }),
        ).map((finding) => finding.code),
      ).toContain("aws.validation.rds-configuration");
    },
  );
  it.each([
    ["database", "engineVersion", "17.1"],
    ["database", "instanceClass", "db.r6g.large"],
    ["database", "storageGiB", 400],
    ["database", "storageGiB", 19],
    ["database", "backupRetentionDays", 0],
    ["database", "backupRetentionDays", 36],
    ["database", "caIdentifier", "rds-ca-2019"],
    ["database", "publicAccess", true],
    ["database", "deletionProtection", false],
    ["database", "retain", false],
    ["database", "storageEncrypted", false],
    ["database", "autoMinorUpgrade", true],
    ["database", "allowMajorUpgrade", true],
    ["database", "masterAuthMode", "user-password"],
    ["database", "encryptionMode", "customer-managed"],
    ["database", "iamAuthentication", true],
    ["database", "masterPassword", "synthetic-sensitive-sentinel"],
    ["database", "databaseName", "postgres"],
    ["database", "databaseName", "Table"],
    ["database", "masterUsername", "SELECT"],
    ["database", "masterUsername", "rdsadmin"],
    ["database", "backupWindow", "23:45-00:30"],
    ["database", "backupWindow", "02:00-02:20"],
    ["database", "backupWindow", "02:00-05:00"],
    ["database", "maintenanceWindow", "sun:02:15-sun:02:45"],
    ["database", "maintenanceWindow", "sun:03:00-mon:03:30"],
    ["db_parameters", "family", "postgres17"],
    ["db_parameters", "forceTls", false],
    ["db_parameters", "name", "default-postgres16"],
    ["db_subnets", "name", "default"],
  ] as const)("rejects %s.%s=%s", (id, key, value) => {
    const v: ConfigurationValue =
      typeof value === "boolean"
        ? { kind: "boolean", value }
        : typeof value === "number"
          ? { kind: "integer", value }
          : { kind: "string", value };
    const d = change(rdsFixture(), id, key, v);
    expect(errors(d).length).toBeGreaterThan(0);
    expect(JSON.stringify(findings(d))).not.toContain(
      "synthetic-sensitive-sentinel",
    );
  });
  it.each([
    "one-subnet",
    "same-zone-name",
    "same-zone-parent",
    "wrong-region",
    "missing-group",
    "missing-parameters",
    "missing-subnet-group",
    "wrong-port",
    "edge-configuration",
    "duplicate-edge",
    "duplicate-name",
    "schema",
    "parent",
    "generated",
    "adopted",
  ])("rejects inconsistent %s", (kind) => {
    let d = rdsFixture();
    if (kind === "same-zone-name")
      d = change(d, "az_b", "zoneName", {
        kind: "string",
        value: "us-east-1a",
      });
    else if (kind === "wrong-region")
      d = parseArchitectureDocument({
        ...d,
        provider: { ...d.provider, region: "us-west-2" },
      });
    else if (kind === "duplicate-name") {
      const n = d.nodes.find((n) => n.id === "db_parameters");
      if (n)
        d = parseArchitectureDocument({
          ...d,
          nodes: [
            ...d.nodes,
            {
              ...n,
              id: "duplicate_parameters",
              semantic: {
                ...n.semantic,
                deploymentKey: "duplicate_parameters",
              },
            },
          ],
        });
    } else if (["schema", "parent", "generated", "adopted"].includes(kind))
      d = parseArchitectureDocument({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === "database"
            ? {
                ...n,
                semantic: {
                  ...n.semantic,
                  ...(kind === "schema"
                    ? {
                        configuration: {
                          ...n.semantic.configuration,
                          schemaVersion: "9.0.0",
                        },
                      }
                    : kind === "parent"
                      ? {
                          parent: {
                            nodeId: "vpc",
                            relationshipType: "aws.region.contains-vpc",
                          },
                        }
                      : {
                          lifecycle:
                            kind === "generated"
                              ? {
                                  ownership: "generated",
                                  origin: "connection-rule",
                                  provenance: {
                                    dependentNodeIds: [],
                                    dependentEdgeIds: [],
                                    generatorKind: "connection-rule",
                                    generatorId:
                                      "aws.rds.instance-uses-security-group",
                                    generatorVersion: "1.0.0",
                                    operationId: "operation_synthetic",
                                  },
                                }
                              : {
                                  ownership: "adopted",
                                  origin: "connection-rule",
                                  adoptedBy: "actor_synthetic",
                                  adoptedAt: "2026-10-04T00:00:00Z",
                                  provenance: {
                                    dependentNodeIds: [],
                                    dependentEdgeIds: [],
                                    generatorKind: "connection-rule",
                                    generatorId:
                                      "aws.rds.instance-uses-security-group",
                                    generatorVersion: "1.0.0",
                                    operationId: "operation_synthetic",
                                  },
                                },
                        }),
                },
              }
            : n,
        ),
      });
    else if (kind === "same-zone-parent")
      d = parseArchitectureDocument({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === "subnet_b"
            ? {
                ...n,
                semantic: {
                  ...n.semantic,
                  parent: {
                    nodeId: "az",
                    relationshipType:
                      "aws.ec2.availability-zone-contains-subnet",
                  },
                },
              }
            : n,
        ),
      });
    else {
      const rel =
        kind === "one-subnet"
          ? "db_subnet_b"
          : kind === "missing-group"
            ? "db_group_binding"
            : kind === "missing-parameters"
              ? "db_parameters_binding"
              : "db_subnets_binding";
      const e = d.edges.find((e) => e.id === rel);
      if (!e) throw Error("Missing edge");
      d = parseArchitectureDocument({
        ...d,
        edges:
          kind === "duplicate-edge"
            ? [...d.edges, { ...e, id: "duplicate" }]
            : kind === "wrong-port" || kind === "edge-configuration"
              ? d.edges.map((q) =>
                  q.id === e.id
                    ? {
                        ...q,
                        semantic: {
                          ...q.semantic,
                          ...(kind === "wrong-port"
                            ? {
                                source: {
                                  ...q.semantic.source,
                                  port: "aws.rds.db-subnet-group.invalid",
                                },
                              }
                            : {
                                configuration: {
                                  ...q.semantic.configuration,
                                  values: {
                                    unreviewed: {
                                      kind: "string",
                                      value: "unsupported",
                                    },
                                  },
                                },
                              }),
                        },
                      }
                    : q,
                )
              : d.edges.filter((q) => q.id !== e.id),
      });
    }
    expect(errors(d).length).toBeGreaterThan(0);
  });
});
