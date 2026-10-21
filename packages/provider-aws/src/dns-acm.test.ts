import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { dnsProperties } from "./catalog/services/dns-acm.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { dnsFixture, dnsInputs } from "./dns-acm-fixture.test-support.js";
import { awsServiceExtensionV1 } from "./service-extension-v1-accessors.js";
import { createDnsReadinessRuleV1 } from "./validation/dns-acm-readiness-rule.js";
const rule = createDnsReadinessRuleV1(awsCatalogArtifactV1);
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
describe("bounded public DNS and ACM", () => {
  it("admits retained regional intent with external readiness only", () => {
    const d = dnsFixture();
    expect(errors(d)).toEqual([]);
    expect(findings(d).map((f) => f.code)).toEqual([
      "aws.validation.dns-external-readiness",
      "aws.validation.dns-external-readiness",
    ]);
    expect(findings(d)).toEqual(findings(d));
  });
  it("admits viewer intent only in the declared us-east-1 graph", () => {
    expect(
      errors(
        change(dnsFixture(), "certificate", "intendedUse", {
          kind: "string",
          value: "cloudfront-viewer",
        }),
      ),
    ).toEqual([]);
  });
  it("does not infer domain control or add validation-helper cards", () => {
    expect(
      awsCatalogV1.validateConfiguration("aws.route53.public-hosted-zone", {
        domainName: dnsInputs["aws.route53.public-hosted-zone"].domainName,
        comment: dnsInputs["aws.route53.public-hosted-zone"].comment,
      }).success,
    ).toBe(false);
    for (const id of Object.keys(dnsProperties)) {
      const s = awsCatalogV1.requireService(id);
      expect(s.nodeKind).toMatchObject({ kind: "resource", deployable: true });
      expect(s.configuration.jsonSchema.additionalProperties).toBe(false);
      expect(awsServiceExtensionV1.getOwnedConfigurationSlots(id)).toEqual([]);
      expect(s.mappings.map((m) => m.implementationStatus)).toEqual([
        "implemented",
        "implemented",
      ]);
    }
  });
  it.each(["template", "ai-accepted", "migration"] as const)(
    "accepts explicit user origin %s",
    (origin) => {
      const d = dnsFixture();
      expect(
        errors(
          parseArchitectureDocument({
            ...d,
            nodes: d.nodes.map((n) =>
              dnsProperties[n.semantic.serviceType]
                ? {
                    ...n,
                    semantic: {
                      ...n.semantic,
                      lifecycle: { ownership: "user", origin },
                    },
                  }
                : n,
            ),
          }),
        ),
      ).toEqual([]);
    },
  );
  it("resolves the exact binding atomically with an inverse and no grants", () => {
    const base = dnsFixture(),
      d = parseArchitectureDocument({
        ...base,
        edges: base.edges.filter((e) => e.id !== "certificate_zone"),
      });
    const request = {
      document: d,
      ruleId: "aws.acm.certificate-validates-in-zone",
      source: {
        nodeId: "certificate",
        portId: "aws.acm.public-dns-certificate.validation-zone",
      },
      target: {
        nodeId: "public_zone",
        portId: "aws.route53.public-hosted-zone.certificate",
      },
      configuration: {},
      operationId: "operation_dns",
    };
    const result = awsConnectionResolverV1.resolve(request);
    expect(result.success).toBe(true);
    expect(result).toEqual(awsConnectionResolverV1.resolve(request));
    if (!result.success) throw Error("No binding plan");
    expect(result.batch.commands).toHaveLength(1);
    expect(result.preview.document.nodes).toEqual(d.nodes);
    const applied = applyGraphCommand(d, result.batch);
    expect(errors(applied.document)).toEqual([]);
    const generated = applied.document.edges.find(
      (e) => e.semantic.relationshipType === request.ruleId,
    );
    if (generated?.semantic.lifecycle.ownership !== "generated")
      throw Error("Missing rule-owned binding");
    expect(generated.semantic.lifecycle.provenance.generatorId).toBe(
      request.ruleId,
    );
    for (const provenance of [
      {
        ...generated.semantic.lifecycle.provenance,
        generatorId: "aws.acm.unreviewed",
      },
      { ...generated.semantic.lifecycle.provenance, generatorVersion: "9.0.0" },
      {
        ...generated.semantic.lifecycle.provenance,
        dependentNodeIds: ["certificate"],
      },
    ]) {
      const malformed = parseArchitectureDocument({
        ...applied.document,
        edges: applied.document.edges.map((e) =>
          e.id === generated.id
            ? {
                ...e,
                semantic: {
                  ...e.semantic,
                  lifecycle: { ...generated.semantic.lifecycle, provenance },
                },
              }
            : e,
        ),
      });
      expect(errors(malformed).map((f) => f.code)).toContain(
        "aws.validation.dns-zone-authority",
      );
    }
    if (applied.inversion.kind !== "available") throw Error("No inverse");
    expect(
      applyGraphCommand(applied.document, applied.inversion.command).document,
    ).toEqual(d);
    expect(
      awsConnectionResolverV1.resolve({
        ...request,
        configuration: { unreviewed: "value" },
      }).success,
    ).toBe(false);
  });
  it.each(["public_zone", "certificate"])(
    "rejects generated resources and duplicate domain identities for %s",
    (id) => {
      const d = dnsFixture(),
        node = d.nodes.find((n) => n.id === id);
      if (!node) throw Error("Missing DNS resource");
      const duplicate = parseArchitectureDocument({
        ...d,
        nodes: [
          ...d.nodes,
          {
            ...node,
            id: id + "_duplicate",
            semantic: { ...node.semantic, deploymentKey: id + "_duplicate" },
          },
        ],
      });
      expect(errors(duplicate).map((f) => f.code)).toContain(
        "aws.validation.dns-duplicate-domain",
      );
      const generated = parseArchitectureDocument({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                semantic: {
                  ...n.semantic,
                  lifecycle: {
                    ownership: "generated",
                    origin: "connection-rule",
                    provenance: {
                      generatorKind: "connection-rule",
                      generatorId: "aws.acm.certificate-validates-in-zone",
                      generatorVersion: "1.0.0",
                      operationId: "operation_dns_resource",
                      dependentNodeIds:
                        id === "certificate"
                          ? ["public_zone"]
                          : ["certificate"],
                      dependentEdgeIds: [],
                    },
                  },
                },
              }
            : n,
        ),
      });
      expect(errors(generated).map((f) => f.code)).toContain(
        "aws.validation.dns-ownership",
      );
    },
  );
  it.each([
    "UPPER.example.test",
    "example.test.",
    "*.example.test",
    "example..test",
    "-bad.example.test",
    "bad_.example.test",
    "a".repeat(64) + ".test",
    "例.example.test",
    "https://example.test",
    "test",
    "a".repeat(63) +
      "." +
      "b".repeat(63) +
      "." +
      "c".repeat(63) +
      "." +
      "d".repeat(62),
  ])("rejects noncanonical domain %s", (domain) => {
    for (const [type, input] of Object.entries(dnsInputs))
      expect(
        awsCatalogV1.validateConfiguration(type, {
          ...input,
          domainName: { kind: "string", value: domain },
        }).success,
      ).toBe(false);
  });
  it.each([
    ["public_zone", "domainControlAttested", { kind: "boolean", value: false }],
    ["public_zone", "zoneType", { kind: "string", value: "private" }],
    ["public_zone", "forceDestroy", { kind: "boolean", value: true }],
    ["public_zone", "retain", { kind: "boolean", value: false }],
    ["certificate", "validationMethod", { kind: "string", value: "EMAIL" }],
    ["certificate", "keyAlgorithm", { kind: "string", value: "EC_prime256v1" }],
    ["certificate", "certificateType", { kind: "string", value: "private" }],
    ["certificate", "certificateExport", { kind: "string", value: "ENABLED" }],
    ["certificate", "retain", { kind: "boolean", value: false }],
    [
      "certificate",
      "validationRecordsMode",
      { kind: "string", value: "manual" },
    ],
    [
      "certificate",
      "certificateRegion",
      { kind: "string", value: "us-west-2" },
    ],
    ["certificate", "domainName", { kind: "string", value: "notexample.test" }],
  ] as const)("rejects unsupported %s %s", (id, key, value) => {
    expect(errors(change(dnsFixture(), id, key, value)).length).toBeGreaterThan(
      0,
    );
  });
  it.each(Object.keys(dnsProperties))(
    "rejects missing/reference/unknown fields for %s",
    (type) => {
      const d = dnsFixture(),
        n = d.nodes.find((n) => n.semantic.serviceType === type);
      if (!n) throw Error("Missing synthetic resource");
      for (const key of Object.keys(n.semantic.configuration.values)) {
        const absent = parseArchitectureDocument({
          ...d,
          nodes: d.nodes.map((node) => {
            if (node.id !== n.id) return node;
            const values = Object.fromEntries(
              Object.entries(node.semantic.configuration.values).filter(
                ([field]) => field !== key,
              ),
            );
            return {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: { ...node.semantic.configuration, values },
              },
            };
          }),
        });
        expect(
          errors(absent).some(
            (finding) =>
              finding.code === "aws.validation.dns-configuration" &&
              finding.affected.some(
                (location) =>
                  location.kind === "node" && location.nodeId === n.id,
              ),
          ),
        ).toBe(true);
        expect(
          errors(
            change(d, n.id, key, {
              kind: "node-reference",
              nodeId: "certificate",
              attribute: "aws.acm.public-dns-certificate.arn",
            }),
          ).some(
            (finding) =>
              finding.code === "aws.validation.dns-configuration" &&
              finding.affected.some(
                (location) =>
                  location.kind === "node" && location.nodeId === n.id,
              ),
          ),
        ).toBe(true);
      }
      const sensitiveDocument = change(d, n.id, "privateKey", {
        kind: "string",
        value: "synthetic-sensitive-sentinel",
      });
      const privateFindings = errors(sensitiveDocument);
      expect(
        privateFindings.some(
          (finding) =>
            finding.code === "aws.validation.dns-configuration" &&
            finding.affected.some(
              (location) =>
                location.kind === "node" && location.nodeId === n.id,
            ),
        ),
      ).toBe(true);
      expect(JSON.stringify(privateFindings)).not.toContain(
        "synthetic-sensitive-sentinel",
      );
    },
  );
  it.each([
    "missing",
    "duplicate",
    "wrong-port",
    "wrong-version",
    "unknown-field",
    "wrong-endpoint",
  ])("rejects malformed binding %s", (mode) => {
    const d = dnsFixture(),
      e = d.edges.find((e) => e.id === "certificate_zone");
    if (!e) throw Error("Missing edge");
    const edges: unknown[] = d.edges.filter((x) => x.id !== e.id);
    if (mode !== "missing")
      edges.push(
        ...parseArchitectureDocument({
          ...d,
          edges: [
            {
              ...e,
              semantic: {
                ...e.semantic,
                source: {
                  ...e.semantic.source,
                  port:
                    mode === "wrong-port"
                      ? "aws.acm.unreviewed"
                      : e.semantic.source.port,
                },
                target: {
                  ...e.semantic.target,
                  nodeId:
                    mode === "wrong-endpoint"
                      ? "db_subnets"
                      : e.semantic.target.nodeId,
                },
                configuration: {
                  ...e.semantic.configuration,
                  schemaVersion: mode === "wrong-version" ? "9.0.0" : "1.0.0",
                  values:
                    mode === "unknown-field"
                      ? { unreviewed: { kind: "string", value: "value" } }
                      : {},
                },
              },
            },
          ],
        }).edges,
      );
    if (mode === "duplicate") edges.push({ ...e, id: e.id + "_duplicate" });
    expect(
      errors(parseArchitectureDocument({ ...d, edges })).length,
    ).toBeGreaterThan(0);
  });
  it("rejects viewer intent in another graph Region even when certificate matches", () => {
    const d = change(dnsFixture(), "certificate", "certificateRegion", {
      kind: "string",
      value: "us-west-2",
    });
    const west = parseArchitectureDocument({
      ...d,
      provider: { ...d.provider, region: "us-west-2" },
    });
    expect(errors(west)).toEqual([]);
    expect(
      errors(
        change(west, "certificate", "intendedUse", {
          kind: "string",
          value: "cloudfront-viewer",
        }),
      ).map((f) => f.code),
    ).toContain("aws.validation.dns-region");
  });
  it("requires the most-specific modeled public zone", () => {
    const d = dnsFixture(),
      zone = d.nodes.find((n) => n.id === "public_zone");
    if (!zone) throw Error("Missing zone");
    const child = parseArchitectureDocument({
      ...d,
      nodes: [
        ...d.nodes,
        {
          ...zone,
          id: "child_zone",
          semantic: {
            ...zone.semantic,
            deploymentKey: "child_zone",
            configuration: {
              ...zone.semantic.configuration,
              values: {
                ...zone.semantic.configuration.values,
                domainName: { kind: "string", value: "app.example.test" },
              },
            },
          },
        },
      ],
    });
    expect(errors(child).map((f) => f.code)).toContain(
      "aws.validation.dns-zone-authority",
    );
    const fixed = parseArchitectureDocument({
      ...child,
      edges: child.edges.map((e) =>
        e.id !== "certificate_zone"
          ? e
          : {
              ...e,
              semantic: {
                ...e.semantic,
                target: { ...e.semantic.target, nodeId: "child_zone" },
              },
            },
      ),
    });
    expect(errors(fixed)).toEqual([]);
  });
  it("matches the closed native configuration contract", async () => {
    const native = JSON.parse(
      await readFile(
        new URL(
          "../../../services/iac-compiler/internal/contracts/dns-acm-configuration-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;
    expect(native).toEqual(dnsProperties);
  });
});
