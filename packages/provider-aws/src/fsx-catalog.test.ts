import { describe, expect, it } from "vitest";
import {
  executeArchitectureValidationRules,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { rdsFixture } from "./rds-fixture.test-support.js";
import { createFsxReadinessRuleV1 } from "./validation/fsx-rules.js";
describe("FSx catalog and compatibility", () => {
  for (const family of ["lustre", "windows", "openzfs", "ontap"])
    it(
      family +
        " admits draft defaults but rejects undeclared or mistyped settings",
      () => {
        const id = "aws.fsx." + family + "-file-system";
        const defaults = awsCatalogV1.validateConfiguration(id, {});
        expect(defaults.success).toBe(family !== "ontap");
        expect(
          awsCatalogV1.validateConfiguration(id, {
            storageCapacity: { kind: "boolean", value: true },
          }).success,
        ).toBe(false);
        expect(
          awsCatalogV1.validateConfiguration(id, {
            password: { kind: "string", value: "not-a-credential" },
          }).success,
        ).toBe(false);
        const service = awsCatalogV1.requireService(id);
        expect(
          service.mappings.map((m) => [m.target, m.implementationStatus]),
        ).toEqual([
          ["cloudformation", "implemented"],
          ["terraform", "implemented"],
        ]);
        expect(service.regionAvailability.state).toBe("unknown");
      },
    );
  it("never invents a directory or an unrestricted client network", () => {
    const windows = awsCatalogV1.validateConfiguration(
        "aws.fsx.windows-file-system",
        {},
      ),
      zfs = awsCatalogV1.validateConfiguration(
        "aws.fsx.openzfs-file-system",
        {},
      );
    if (windows.success)
      expect(windows.values).not.toHaveProperty("activeDirectoryId");
    if (zfs.success) expect(zfs.values).not.toHaveProperty("clientCidr");
    expect(
      awsCatalogV1.validateConfiguration("aws.fsx.ontap-volume", {
        sizeInMegabytes: { kind: "integer", value: 314572801 },
      }).success,
    ).toBe(false);
  });
});

it("assigns every FSx resource its own exact icon identity", () => {
  const icons = awsCatalogV1
    .listServices()
    .map((service) => service.iconId)
    .filter((icon) => icon !== null);
  expect(new Set(icons).size).toBe(icons.length);
});

it("requires two canonical physical zones in the immutable Region for Windows Multi-AZ", () => {
  const network = rdsFixture();
  const template = network.nodes.find((node) => node.id === "database");
  if (!template) throw Error("Missing synthetic database template");
  const serviceType = "aws.fsx.windows-file-system";
  const configuration = awsCatalogV1.validateConfiguration(serviceType, {
    deploymentType: { kind: "string", value: "MULTI_AZ_1" },
    activeDirectoryId: { kind: "string", value: "d-0123456789" },
  });
  if (!configuration.success) throw Error("Invalid synthetic FSx settings");
  const retained = network.nodes.filter(
    (node) => !String(node.semantic.serviceType).startsWith("aws.rds."),
  );
  const retainedIds = new Set(retained.map((node) => node.id));
  const base = parseArchitectureDocument({
    ...network,
    nodes: [
      ...retained,
      {
        ...template,
        id: "fsx",
        semantic: {
          ...template.semantic,
          deploymentKey: "fsx",
          serviceType,
          resourceType: serviceType,
          configuration: {
            schemaId: serviceType + ".configuration",
            schemaVersion: "1.0.0",
            values: configuration.values,
          },
        },
      },
    ],
    edges: [
      ...network.edges.filter(
        (edge) =>
          retainedIds.has(edge.semantic.source.nodeId) &&
          retainedIds.has(edge.semantic.target.nodeId),
      ),
      ...["subnet", "subnet_b", "group"].map((targetId) => {
        const relationshipType =
          serviceType +
          (targetId === "group" ? "-uses-security-group" : "-uses-subnet");
        const rule = awsCatalogV1
          .listConnectionRules()
          .find((rule) => rule.relationshipType === relationshipType);
        if (!rule) throw Error("Missing FSx binding contract");
        return {
          id: "fsx_" + targetId,
          semantic: {
            relationshipType,
            source: { nodeId: "fsx", port: rule.source.portId },
            target: { nodeId: targetId, port: rule.target.portId },
            configuration: {
              schemaId: rule.configuration.schemaId,
              schemaVersion: rule.configuration.schemaVersion,
              values: {},
            },
            lifecycle: { ownership: "user", origin: "user" },
          },
        };
      }),
    ],
  });
  const rule = createFsxReadinessRuleV1(awsCatalogArtifactV1);
  for (const mutation of [
    "distinct zones",
    "physical alias",
    "foreign zone",
    "missing backing edge",
    "wrong parent relationship",
    "foreign Region boundary",
  ]) {
    const document = parseArchitectureDocument({
      ...base,
      nodes: base.nodes.map((node) => {
        if (
          (node.id === "az_b" &&
            ["physical alias", "foreign zone"].includes(mutation)) ||
          (node.id === "region" && mutation === "foreign Region boundary")
        ) {
          return {
            ...node,
            semantic: {
              ...node.semantic,
              configuration: {
                ...node.semantic.configuration,
                values: {
                  ...node.semantic.configuration.values,
                  [node.id === "region" ? "regionName" : "zoneName"]: {
                    kind: "string",
                    value:
                      mutation === "physical alias"
                        ? "us-east-1a"
                        : node.id === "region"
                          ? "us-west-2"
                          : "us-west-2b",
                  },
                },
              },
            },
          };
        }
        return node.id === "az_b" && mutation === "wrong parent relationship"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                parent: {
                  nodeId: "vpc",
                  relationshipType: "aws.region.contains-vpc",
                },
              },
            }
          : node;
      }),
      edges: base.edges.filter(
        (edge) =>
          mutation !== "missing backing edge" ||
          edge.semantic.relationshipType !==
            "aws.ec2.availability-zone-contains-subnet" ||
          edge.semantic.target.nodeId !== "subnet_b",
      ),
    });
    const before = structuredClone(document);
    const errors = executeArchitectureValidationRules(
      { document, target: "compilation", environment: "production" },
      [rule],
    ).findings.filter((finding) => finding.severity === "error");
    expect(
      errors.some(
        (finding) => finding.code === "aws.validation.fsx-zones-required",
      ),
      mutation,
    ).toBe(mutation !== "distinct zones");
    expect(document, mutation).toEqual(before);
  }
});
