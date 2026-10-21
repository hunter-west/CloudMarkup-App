import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1 } from "./catalog-v1-accessors.js";
import { ebsBindings, ebsProperties } from "./catalog/services/ebs.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { ebsFixture } from "./ebs-fixture.test-support.js";
import { createEbsReadinessRuleV1 } from "./validation/ebs-readiness-rule.js";
const findings = (document: ArchitectureDocument) =>
  executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    [createEbsReadinessRuleV1(awsCatalogArtifactV1)],
  ).findings;
const errors = (d: ArchitectureDocument) =>
  findings(d).filter((f) => f.severity !== "warning");
const field = (
  d: ArchitectureDocument,
  id: string,
  key: string,
  value: unknown,
) =>
  parseArchitectureDocument({
    ...d,
    nodes: d.nodes.map((n) =>
      n.id !== id
        ? n
        : {
            ...n,
            semantic: {
              ...n.semantic,
              configuration: {
                ...n.semantic.configuration,
                values: { ...n.semantic.configuration.values, [key]: value },
              },
            },
          },
    ),
  });
const required = <T>(x: T | undefined): T => {
  if (x === undefined) throw Error("Missing EBS fixture fact");
  return x;
};
describe("bounded encrypted EBS volumes", () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "validates customer=%s attached=%s without guest claims",
    (customer, attached) => {
      const d = ebsFixture(customer, attached);
      expect(errors(d)).toEqual([]);
      expect(findings(d).filter((f) => f.severity === "warning")).toHaveLength(
        attached ? 2 : 1,
      );
    },
  );
  for (const [type, props] of Object.entries(ebsProperties)) {
    const id = type === "aws.ebs.volume" ? "volume" : "attachment";
    it.each(Object.keys(props))(
      "requires every literal field " + type + ".%s",
      (key) => {
        const d = ebsFixture();
        expect(
          errors(
            field(d, id, key, {
              kind: "node-reference",
              nodeId: "volume",
              attribute: "aws.ebs.volume.id",
            }),
          ).length,
        ).toBeGreaterThan(0);
        const n = required(d.nodes.find((n) => n.id === id));
        const values = Object.fromEntries(
          Object.entries(n.semantic.configuration.values).filter(
            ([field]) => field !== key,
          ),
        );
        expect(
          errors(
            parseArchitectureDocument({
              ...d,
              nodes: d.nodes.map((x) =>
                x.id !== id
                  ? x
                  : {
                      ...x,
                      semantic: {
                        ...x.semantic,
                        configuration: { ...x.semantic.configuration, values },
                      },
                    },
              ),
            }),
          ).length,
        ).toBeGreaterThan(0);
      },
    );
  }
  it.each([
    ["volume", "sizeGiB", 0],
    ["volume", "sizeGiB", 16385],
    ["volume", "iops", 3001],
    ["volume", "throughputMiBps", 126],
    ["attachment", "deviceName", "/dev/xvda"],
    ["attachment", "deviceName", "/dev/nvme1n1"],
    ["attachment", "guestPreparation", "format-and-mount"],
  ] as const)("rejects expanded %s.%s", (id, key, value) => {
    expect(
      errors(
        field(ebsFixture(), id, key, {
          kind: typeof value === "number" ? "integer" : "string",
          value,
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each(ebsBindings)("closes binding %s", (rel) => {
    const d = ebsFixture(true);
    const e = required(
      d.edges.find((x) => x.semantic.relationshipType === rel),
    );
    for (const kind of ["missing", "port", "schema", "duplicate"].filter(
      (kind) =>
        kind === "missing" ||
        kind === "duplicate" ||
        rel === "aws.ebs.availability-zone-contains-volume" ||
        rel === "aws.ebs.attachment-uses-instance",
    )) {
      const broken =
        kind === "missing"
          ? d.edges.filter((x) => x.id !== e.id)
          : kind === "duplicate"
            ? [...d.edges, { ...e, id: "duplicate" }]
            : d.edges.map((x) =>
                x.id !== e.id
                  ? x
                  : {
                      ...x,
                      semantic: {
                        ...x.semantic,
                        ...(kind === "port"
                          ? {
                              source: {
                                ...x.semantic.source,
                                port: "aws.ebs.unreviewed",
                              },
                            }
                          : {
                              configuration: {
                                ...x.semantic.configuration,
                                schemaVersion: "9.0.0",
                              },
                            }),
                      },
                    },
              );
      expect(
        errors(parseArchitectureDocument({ ...d, edges: broken })).length,
      ).toBeGreaterThan(0);
    }
  });
  it.each(["volume", "attachment"])(
    "rejects unknown configuration on %s",
    (id) => {
      expect(
        errors(
          field(ebsFixture(), id, "unreviewed", {
            kind: "string",
            value: "unsupported",
          }),
        ).length,
      ).toBeGreaterThan(0);
    },
  );
  it("requires exact same canonical AZ, not another node for the same declared AZ", () => {
    const d = ebsFixture();
    const z = required(d.nodes.find((n) => n.id === "az"));
    const azOwner = required(
      d.edges.find(
        (e) =>
          e.semantic.relationshipType ===
            "aws.ec2.vpc-contains-availability-zone" &&
          e.semantic.target.nodeId === z.id,
      ),
    );
    const bad = parseArchitectureDocument({
      ...d,
      nodes: [
        ...d.nodes.map((n) =>
          n.id !== "volume"
            ? n
            : {
                ...n,
                semantic: {
                  ...n.semantic,
                  parent: {
                    ...required(n.semantic.parent),
                    nodeId: "other_az",
                  },
                },
              },
        ),
        {
          ...z,
          id: "other_az",
          semantic: { ...z.semantic, deploymentKey: "other_az" },
        },
      ],
      edges: [
        ...d.edges.map((e) =>
          e.semantic.relationshipType !==
          "aws.ebs.availability-zone-contains-volume"
            ? e
            : {
                ...e,
                semantic: {
                  ...e.semantic,
                  target: { ...e.semantic.target, nodeId: "other_az" },
                },
              },
        ),
        {
          ...azOwner,
          id: "other_az_owner",
          semantic: {
            ...azOwner.semantic,
            target: { ...azOwner.semantic.target, nodeId: "other_az" },
          },
        },
      ],
    });
    const rejected = errors(bad).map((finding) => finding.code);
    expect(rejected).toContain("aws.validation.ebs-placement");
    expect(rejected).not.toContain("aws.validation.ebs-az");
  });
  it("rejects a selected key in account-default mode and missing customer key", () => {
    const d = ebsFixture(true);
    expect(
      errors(
        field(d, "volume", "encryptionMode", {
          kind: "string",
          value: "account-default",
        }),
      ).some((f) => f.code === "aws.validation.ebs-key"),
    ).toBe(true);
    expect(
      errors(
        parseArchitectureDocument({
          ...d,
          edges: d.edges.filter(
            (e) => e.semantic.relationshipType !== "aws.ebs.volume-uses-key",
          ),
        }),
      ).some((f) => f.code === "aws.validation.ebs-key"),
    ).toBe(true);
  });
  it.each(ebsBindings)(
    "resolves and cleans %s with exact inverses and no inferred permissions",
    (rel) => {
      const d = ebsFixture(true),
        e = required(d.edges.find((e) => e.semantic.relationshipType === rel)),
        without = parseArchitectureDocument({
          ...d,
          edges: d.edges.filter((x) => x.id !== e.id),
        });
      const r = awsConnectionResolverV1.resolve({
        document: without,
        ruleId: rel,
        source: {
          nodeId: e.semantic.source.nodeId,
          portId: e.semantic.source.port,
        },
        target: {
          nodeId: e.semantic.target.nodeId,
          portId: e.semantic.target.port,
        },
        configuration: {},
        operationId: "operation_ebs",
      });
      if (!r.success) throw Error(JSON.stringify(r));
      const applied = applyGraphCommand(without, r.batch);
      expect(applied.document.nodes).toEqual(without.nodes);
      expect(applied.document.edges).toHaveLength(without.edges.length + 1);
      if (applied.inversion.kind !== "available")
        throw Error("No connection inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(without);
      const cleanup = awsConnectionResolverV1.cleanup({
        document: applied.document,
        connectionEdgeId: required(
          applied.document.edges.find(
            (x) => !without.edges.some((y) => y.id === x.id),
          ),
        ).id,
        operationId: "cleanup_ebs",
      });
      if (!cleanup.success) throw Error(JSON.stringify(cleanup));
      expect(
        applyGraphCommand(applied.document, cleanup.batch).document,
      ).toEqual(without);
    },
  );

  it.each([
    "volume",
    "attachment",
    "instance",
    "encryption_key",
    "az",
    "vpc",
    "region",
    "subnet",
    "group",
  ])("rejects external-resource metadata on bounded dependency %s", (id) => {
    const d = ebsFixture(true),
      n = required(d.nodes.find((n) => n.id === id));
    const externalDocument = parseArchitectureDocument({
      ...d,
      externalResources: {
        ...d.externalResources,
        resources: [
          {
            id: "external_bounded_resource",
            displayName: "Synthetic external ownership",
            capability: n.semantic.serviceType,
            resourceType: n.semantic.resourceType,
            architectureNodeIds: [id],
            provider: {
              state: "known",
              providerId: "aws.cloudmarkup",
              serviceFamily: n.semantic.serviceType
                .split(".")
                .slice(0, 2)
                .join("."),
            },
            scope: {
              accountReference: "synthetic_account",
              region: "us-east-1",
            },
            addresses: [
              {
                addressId: "external_id",
                kind: "provider-resource-id",
                value: "synthetic-existing-resource",
              },
            ],
            lifecycle: {
              ownershipState: "existing-cloud-managed-elsewhere",
              lifecycleAuthority: "external-owner",
              behavior: {
                create: "forbidden",
                reference: "required",
                import: "review-optional",
                dataSource: "allowed",
              },
              iacTargets: [
                {
                  target: "terraform",
                  readiness: "reference-ready",
                  mappingId: n.semantic.serviceType + ".terraform",
                  mappingVersion: "1.0.0",
                },
              ],
            },
            interfaces: [],
            dataClassifications: ["public"],
            trustBoundary: "same-network",
            availability: { assumption: "unknown" },
            evidence: [],
            extractedCandidates: [],
            unresolvedInformation: [],
          },
        ],
      },
    });
    const ebsFindings = executeArchitectureValidationRules(
      {
        document: externalDocument,
        target: "draft",
        environment: "development",
      },
      [createEbsReadinessRuleV1(awsCatalogArtifactV1)],
    ).findings;
    expect(ebsFindings.some((f) => f.severity === "security-error")).toBe(true);
  });

  it.each(["volume", "attachment"])(
    "rejects generated/adopted resource ownership on %s",
    (id) => {
      const d = ebsFixture();
      const provenance = {
        generatorKind: "connection-rule",
        generatorId: "aws.ebs.volume-owns-attachment",
        generatorVersion: "1.0.0",
        operationId: "operation_ebs",
        dependentNodeIds: ["az", "instance"],
        dependentEdgeIds: [],
      };
      for (const ownership of ["generated", "adopted"]) {
        const lifecycle = {
          ownership,
          origin: "connection-rule",
          provenance,
          ...(ownership === "adopted"
            ? { adoptedBy: "actor_fixture", adoptedAt: "2026-10-04T00:00:00Z" }
            : {}),
        };
        expect(
          errors(
            parseArchitectureDocument({
              ...d,
              nodes: d.nodes.map((n) =>
                n.id === id
                  ? { ...n, semantic: { ...n.semantic, lifecycle } }
                  : n,
              ),
            }),
          ).some((f) => f.code === "aws.validation.ebs-ownership"),
        ).toBe(true);
      }
    },
  );
  it.each(["volume", "attachment"])(
    "rejects wrong canonical parent on %s",
    (id) => {
      const d = ebsFixture();
      expect(
        errors(
          parseArchitectureDocument({
            ...d,
            nodes: d.nodes.map((n) =>
              n.id === id
                ? {
                    ...n,
                    semantic: {
                      ...n.semantic,
                      parent: { ...required(n.semantic.parent), nodeId: "vpc" },
                    },
                  }
                : n,
            ),
          }),
        ).length,
      ).toBeGreaterThan(0);
    },
  );
  it("rejects duplicate API device names across separately owned volumes", () => {
    const d = ebsFixture(),
      v = required(d.nodes.find((n) => n.id === "volume")),
      a = required(d.nodes.find((n) => n.id === "attachment"));
    const volume = {
        ...v,
        id: "second_volume",
        semantic: { ...v.semantic, deploymentKey: "second_volume" },
      },
      attachment = {
        ...a,
        id: "second_attachment",
        semantic: {
          ...a.semantic,
          deploymentKey: "second_attachment",
          parent: { ...required(a.semantic.parent), nodeId: "second_volume" },
        },
      };
    const edges = d.edges
      .filter((e) => e.semantic.relationshipType.startsWith("aws.ebs."))
      .map((e) => ({
        ...e,
        id: "second_" + e.id,
        semantic: {
          ...e.semantic,
          source: {
            ...e.semantic.source,
            nodeId:
              e.semantic.source.nodeId === "volume"
                ? "second_volume"
                : "second_attachment",
          },
          target: {
            ...e.semantic.target,
            nodeId:
              e.semantic.target.nodeId === "volume"
                ? "second_volume"
                : e.semantic.target.nodeId,
          },
        },
      }));
    expect(
      errors(
        parseArchitectureDocument({
          ...d,
          nodes: [...d.nodes, volume, attachment],
          edges: [...d.edges, ...edges],
        }),
      ).some((f) => f.code === "aws.validation.ebs-device"),
    ).toBe(true);
  });
  it("matches the closed native configuration contract", () => {
    const native: unknown = JSON.parse(
      readFileSync(
        new URL(
          "../../../services/iac-compiler/internal/contracts/ebs-configuration-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(native).toEqual(ebsProperties);
  });
  it.each(["cn-north-1", "us-gov-west-1"])(
    "rejects unsupported partition %s",
    (region) => {
      const d = ebsFixture();
      expect(
        errors(
          parseArchitectureDocument({
            ...d,
            provider: { ...d.provider, region },
          }),
        ).some((f) => f.code === "aws.validation.ebs-region"),
      ).toBe(true);
    },
  );
  it("rejects a disabled selected encryption key", () => {
    expect(
      errors(
        field(ebsFixture(true), "encryption_key", "enabled", {
          kind: "boolean",
          value: false,
        }),
      ).some((f) => f.code === "aws.validation.ebs-key"),
    ).toBe(true);
  });
});
