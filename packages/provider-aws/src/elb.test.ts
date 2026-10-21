import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { elbBindings, elbProperties } from "./catalog/services/elb.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { elbFixture } from "./elb-fixture.test-support.js";
import { awsServiceExtensionV1 } from "./service-extension-v1-accessors.js";
import { createDnsReadinessRuleV1 } from "./validation/dns-acm-readiness-rule.js";
import { createElbReadinessRuleV1 } from "./validation/elb-readiness-rule.js";
const findings = (document: ArchitectureDocument) =>
  executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    [
      createElbReadinessRuleV1(awsCatalogArtifactV1),
      createDnsReadinessRuleV1(awsCatalogArtifactV1),
    ],
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
const required = <T>(v: T | undefined): T => {
  if (v === undefined) throw Error("Missing synthetic ELB graph fact");
  return v;
};
describe("bounded Application Load Balancer", () => {
  it("preserves valid peer descriptions and rejects AWS-incompatible text", () => {
    const valid = "AZaz09 ._-:/()#,@[]+=;{}!$*".padEnd(128, "a");
    for (const description of [
      valid,
      "Backénd access",
      "Backend & access",
      "Backend access\n",
    ]) {
      const values = { description: { kind: "string", value: description } };
      const d = field(
        elbFixture(),
        "access",
        "description",
        values.description,
      );
      const before = structuredClone(d);
      expect(
        awsCatalogV1.validateConfiguration(
          "aws.elb.backend-access-configuration",
          {
            ...required(d.nodes.find((n) => n.id === "access")).semantic
              .configuration.values,
          },
        ).success,
      ).toBe(description === valid);
      expect(
        errors(d).some((f) => f.code === "aws.validation.elb-configuration"),
      ).toBe(description !== valid);
      expect(d).toEqual(before);
    }
  });
  it.each([
    "alb",
    "target",
    "listener",
    "access",
    "certificate",
    "vpc",
    "az",
    "az_b",
    "alb_subnet_a",
    "alb_group",
    "group",
    "instance",
    "alb_client",
  ])("rejects external-resource metadata on bounded dependency %s", (id) => {
    const d = elbFixture(),
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
              serviceFamily: "aws.s3",
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
    const elbFindings = executeArchitectureValidationRules(
      {
        document: externalDocument,
        target: "draft",
        environment: "development",
      },
      [createElbReadinessRuleV1(awsCatalogArtifactV1)],
    ).findings;
    expect(elbFindings.some((f) => f.severity === "security-error")).toBe(true);
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "admits exact EC2/Fargate and internal/public topology (%s/%s)",
    (ecs, publicScheme) => {
      const d = elbFixture(ecs, publicScheme),
        before = structuredClone(d);
      expect(errors(d)).toEqual([]);
      expect(
        findings(d).filter(
          (f) => f.code === "aws.validation.elb-external-readiness",
        ),
      ).toHaveLength(4);
      expect(d).toEqual(before);
    },
  );
  it.each(Object.keys(elbProperties))(
    "fails closed for every required literal field of %s",
    (type) => {
      const d = elbFixture(),
        n = required(d.nodes.find((n) => n.semantic.serviceType === type));
      for (const key of Object.keys(n.semantic.configuration.values)) {
        const values = Object.fromEntries(
          Object.entries(n.semantic.configuration.values).filter(
            ([k]) => k !== key,
          ),
        );
        const absent = parseArchitectureDocument({
          ...d,
          nodes: d.nodes.map((x) =>
            x.id !== n.id
              ? x
              : {
                  ...x,
                  semantic: {
                    ...x.semantic,
                    configuration: { ...x.semantic.configuration, values },
                  },
                },
          ),
        });
        expect(
          errors(absent).some(
            (finding) =>
              finding.code === "aws.validation.elb-configuration" &&
              finding.affected.some(
                (location) =>
                  location.kind === "node" && location.nodeId === n.id,
              ),
          ),
        ).toBe(true);
        expect(
          errors(
            field(d, n.id, key, {
              kind: "node-reference",
              nodeId: "alb",
              attribute: "aws.elb.application-load-balancer.arn",
            }),
          ).some(
            (finding) =>
              finding.code === "aws.validation.elb-configuration" &&
              finding.affected.some(
                (location) =>
                  location.kind === "node" && location.nodeId === n.id,
              ),
          ),
        ).toBe(true);
      }
      expect(
        errors(
          field(d, n.id, "unreviewed", {
            kind: "string",
            value: "unsupported",
          }),
        ).some(
          (finding) =>
            finding.code === "aws.validation.elb-configuration" &&
            finding.affected.some(
              (location) =>
                location.kind === "node" && location.nodeId === n.id,
            ),
        ),
      ).toBe(true);
    },
  );
  it.each([
    ["alb", "scheme", "gateway"],
    ["alb", "ipAddressType", "dualstack"],
    ["alb", "name", "internal-reserved"],
    ["target", "backendMode", "lambda"],
    ["target", "protocol", "HTTPS"],
    ["target", "healthPath", "../health"],
    ["target", "startupGraceSeconds", 1],
    ["target", "deregistrationDelaySeconds", 0],
    ["listener", "protocol", "HTTP"],
    ["listener", "port", 80],
    ["listener", "securityPolicy", "ELBSecurityPolicy-2016-08"],
    ["listener", "serverName", "other.example.test"],
    ["certificate", "intendedUse", "cloudfront-viewer"],
    ["certificate", "certificateRegion", "us-west-2"],
    ["alb_subnet_a", "cidrBlock", "10.20.2.0/28"],
    ["alb_subnet_a", "cidrBlock", "garbage"],
    ["az_b", "zoneName", "us-east-1a"],
    ["alb_client", "fromPort", 80],
  ] as const)("rejects unsupported %s.%s = %s", (id, key, value) => {
    const d = field(elbFixture(), id, key, {
      kind: typeof value === "number" ? "integer" : "string",
      value,
    });
    expect(errors(d).length).toBeGreaterThan(0);
  });
  it("rejects Fargate container-port mismatch", () => {
    expect(
      errors(
        field(elbFixture(true), "target", "port", {
          kind: "integer",
          value: 9090,
        }),
      ).some((f) => f.code === "aws.validation.elb-ecs-port"),
    ).toBe(true);
  });
  it.each(elbBindings)("requires exact owned binding %s", (rel) => {
    const d = elbFixture(rel === "aws.elb.target-group-targets-ecs"),
      e = required(d.edges.find((e) => e.semantic.relationshipType === rel));
    for (const patch of [
      { source: { ...e.semantic.source, port: "aws.elb.unreviewed.port" } },
      {
        configuration: {
          ...e.semantic.configuration,
          values: { unreviewed: { kind: "boolean", value: true } },
        },
      },
      {
        configuration: { ...e.semantic.configuration, schemaVersion: "9.0.0" },
      },
    ].filter(
      () =>
        rel === "aws.elb.alb-uses-subnet" ||
        rel === "aws.elb.target-group-targets-ecs",
    )) {
      const bad = parseArchitectureDocument({
        ...d,
        edges: d.edges.map((x) =>
          x.id !== e.id ? x : { ...x, semantic: { ...x.semantic, ...patch } },
        ),
      });
      expect(
        errors(bad).some((f) => f.code === "aws.validation.elb-binding"),
      ).toBe(true);
    }
    expect(
      errors(
        parseArchitectureDocument({
          ...d,
          edges: d.edges.filter((x) => x.id !== e.id),
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each(elbBindings)(
    "resolves and cleans %s with exact inverses and no inferred permissions",
    (rel) => {
      const d = elbFixture(rel === "aws.elb.target-group-targets-ecs"),
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
        operationId: "operation_elb",
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
        operationId: "cleanup_elb",
      });
      if (!cleanup.success) throw Error(JSON.stringify(cleanup));
      expect(
        applyGraphCommand(applied.document, cleanup.batch).document,
      ).toEqual(without);
    },
  );
  it.each(["listener", "access"])(
    "rejects mismatched canonical owner of %s",
    (id) => {
      const d = elbFixture();
      const bad = parseArchitectureDocument({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id !== id
            ? n
            : {
                ...n,
                semantic: {
                  ...n.semantic,
                  parent: { ...required(n.semantic.parent), nodeId: "vpc" },
                },
              },
        ),
      });
      expect(errors(bad).length).toBeGreaterThan(0);
    },
  );
  it("does not infer internet reachability or a backend source path", () => {
    const d = elbFixture(false, true);
    expect(
      errors(
        parseArchitectureDocument({
          ...d,
          edges: d.edges.filter(
            (e) =>
              e.semantic.relationshipType !==
              "aws.ec2.route-targets-internet-gateway",
          ),
        }),
      ).some((f) => f.code === "aws.validation.elb-public-route"),
    ).toBe(true);
    const privateDoc = elbFixture(),
      group = required(privateDoc.nodes.find((n) => n.id === "group")),
      ingress = required(privateDoc.nodes.find((n) => n.id === "alb_client"));
    const bypass = {
      ...ingress,
      id: "backend_bypass",
      semantic: {
        ...ingress.semantic,
        deploymentKey: "backend_bypass",
        parent: {
          nodeId: group.id,
          relationshipType: "aws.ec2.security-group-owns-ingress-rule",
        },
        configuration: {
          ...ingress.semantic.configuration,
          values: {
            ...ingress.semantic.configuration.values,
            fromPort: { kind: "integer", value: 8080 },
            toPort: { kind: "integer", value: 8080 },
          },
        },
      },
    };
    const rule = required(
      awsCatalogV1
        .listConnectionRules()
        .find((r) => r.id === "aws.ec2.security-group-owns-ingress-rule"),
    );
    const e = required(
      privateDoc.edges.find(
        (e) => String(e.semantic.relationshipType) === String(rule.id),
      ),
    );
    expect(
      errors(
        parseArchitectureDocument({
          ...privateDoc,
          nodes: [...privateDoc.nodes, bypass],
          edges: [
            ...privateDoc.edges,
            {
              ...e,
              id: "backend_bypass_owner",
              semantic: {
                ...e.semantic,
                source: { ...e.semantic.source, nodeId: "backend_bypass" },
                target: { ...e.semantic.target, nodeId: group.id },
              },
            },
          ],
        }),
      ).some((f) => f.code === "aws.validation.elb-backend-bypass"),
    ).toBe(true);
  });
  it("pins four schema contracts, three deployable cards, twelve bindings and owned slots", () => {
    const native: unknown = JSON.parse(
      readFileSync(
        new URL(
          "../../../services/iac-compiler/internal/contracts/elb-configuration-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(native).toEqual(elbProperties);
    const ss = awsCatalogV1
      .listServices()
      .filter((s) => s.id.startsWith("aws.elb."));
    expect(ss).toHaveLength(4);
    expect(
      ss.filter((s) => s.nodeKind.kind === "resource" && s.nodeKind.deployable),
    ).toHaveLength(3);
    expect(elbBindings).toHaveLength(12);
    for (const id of ["aws.elb.target-group"])
      expect(
        awsServiceExtensionV1.requireServiceExtension(id)
          .ownedConfigurationSlots[0]?.cardinality,
      ).toMatchObject({ minimum: 0, maximum: 1 });
  });
});
