import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import {
  cloudfrontBindings,
  cloudfrontProperties,
} from "./catalog/services/cloudfront.js";
import {
  cloudfrontFixture,
  cloudfrontInputs,
} from "./cloudfront-fixture.test-support.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { awsServiceExtensionV1 } from "./service-extension-v1-accessors.js";
import { createCloudfrontReadinessRuleV1 } from "./validation/cloudfront-readiness-rule.js";
import { createDnsReadinessRuleV1 } from "./validation/dns-acm-readiness-rule.js";
const rules = [
  createCloudfrontReadinessRuleV1(awsCatalogArtifactV1),
  createDnsReadinessRuleV1(awsCatalogArtifactV1),
];
const findings = (document: ArchitectureDocument) =>
  executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    rules,
  ).findings;
const errors = (document: ArchitectureDocument) =>
  findings(document).filter((f) => f.severity !== "warning");
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
describe("bounded public static CloudFront", () => {
  const required = <T>(value: T | undefined): T => {
    if (value === undefined) throw Error("Missing synthetic graph fact");
    return value;
  };
  it.each([
    "origin",
    "distribution",
    "static_cache",
    "viewer_alias",
    "certificate",
  ])("rejects external-resource metadata on bounded dependency %s", (id) => {
    const d = cloudfrontFixture(true),
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
    const cloudfrontFindings = executeArchitectureValidationRules(
      {
        document: externalDocument,
        target: "draft",
        environment: "development",
      },
      [createCloudfrontReadinessRuleV1(awsCatalogArtifactV1)],
    ).findings;
    expect(
      cloudfrontFindings.some((f) => f.severity === "security-error"),
    ).toBe(true);
  });
  it.each(Object.keys(cloudfrontProperties))(
    "requires every literal reviewed field of %s",
    (type) => {
      const d = cloudfrontFixture(true),
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
              finding.code === "aws.validation.cloudfront-configuration" &&
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
              nodeId: "origin",
              attribute: "aws.s3.bucket.arn",
            }),
          ).some(
            (finding) =>
              finding.code === "aws.validation.cloudfront-configuration" &&
              finding.affected.some(
                (location) =>
                  location.kind === "node" && location.nodeId === n.id,
              ),
          ),
        ).toBe(true);
      }
    },
  );
  it("releases only provenance-owned origin policy dependencies and restores all graph facts", () => {
    const d = cloudfrontFixture(),
      origin = required(
        d.edges.find(
          (e) =>
            e.semantic.relationshipType === "aws.cloudfront.reads-s3-origin",
        ),
      );
    const result = awsConnectionResolverV1.cleanup({
      document: d,
      connectionEdgeId: origin.id,
      operationId: "cleanup_cloudfront_origin",
    });
    if (!result.success) throw Error(JSON.stringify(result));
    const applied = applyGraphCommand(d, result.batch);
    expect(d.nodes.length - applied.document.nodes.length).toBe(2);
    expect(d.edges.length - applied.document.edges.length).toBe(4);
    expect(applied.document.nodes.some((n) => n.id === "origin")).toBe(true);
    expect(applied.document.nodes.some((n) => n.id === "distribution")).toBe(
      true,
    );
    if (applied.inversion.kind !== "available")
      throw Error("No cleanup inverse");
    const restored = applyGraphCommand(
      applied.document,
      applied.inversion.command,
    ).document;
    // The existing cleanup engine may reorder restored support edges. Compare
    // every graph fact after canonical edge ordering, without changing that engine.
    const ordered = (doc: ArchitectureDocument) => ({
      ...doc,
      edges: [...doc.edges].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
    });
    expect(ordered(restored)).toEqual(ordered(d));
  });
  it.each([false, true])(
    "admits default/custom alias intent=%s with external readiness only",
    (alias) => {
      const d = cloudfrontFixture(alias);
      expect(errors(d)).toEqual([]);
      expect(
        findings(d).filter(
          (f) => f.code === "aws.validation.cloudfront-external-readiness",
        ),
      ).toHaveLength(alias ? 3 : 2);
      expect(findings(d)).toEqual(findings(d));
    },
  );
  it("counts two deployable cards and one owned configuration; requires explicit content and serving intent", () => {
    for (const id of Object.keys(cloudfrontProperties)) {
      const s = awsCatalogV1.requireService(id);
      expect(s.configuration.jsonSchema.additionalProperties).toBe(false);
      expect(s.nodeKind.kind === "resource" && s.nodeKind.deployable).toBe(
        id !== "aws.cloudfront.alias-configuration",
      );
    }
    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlots(
        "aws.cloudfront.distribution",
      ),
    ).toHaveLength(1);
    for (const key of ["enabled", "publicContentAttested"]) {
      const raw = Object.fromEntries(
        Object.entries(cloudfrontInputs["aws.cloudfront.distribution"]).filter(
          ([k]) => k !== key,
        ),
      );
      expect(
        awsCatalogV1.validateConfiguration("aws.cloudfront.distribution", raw)
          .success,
      ).toBe(false);
    }
  });
  it.each([
    [
      "distribution",
      "publicContentAttested",
      { kind: "boolean", value: false },
    ],
    [
      "distribution",
      "defaultRootObject",
      { kind: "string", value: "../secret" },
    ],
    ["distribution", "webAclId", { kind: "string", value: "unreviewed" }],
    ["static_cache", "minTtl", { kind: "integer", value: 1 }],
    ["static_cache", "defaultTtl", { kind: "integer", value: 3601 }],
    ["static_cache", "maxTtl", { kind: "integer", value: 59 }],
    ["static_cache", "forwardViewerCookies", { kind: "boolean", value: true }],
    ["origin", "blockPublicAccess", { kind: "boolean", value: false }],
    ["origin", "encryption", { kind: "string", value: "SSE-KMS" }],
    [
      "viewer_alias",
      "domainName",
      { kind: "string", value: "other.example.test" },
    ],
    [
      "certificate",
      "certificateRegion",
      { kind: "string", value: "us-west-2" },
    ],
    ["certificate", "intendedUse", { kind: "string", value: "regional" }],
  ])("rejects unsupported %s.%s", (id, key, value) => {
    const base = cloudfrontFixture(true);
    const document =
      id === "static_cache" && key === "maxTtl"
        ? change(base, "static_cache", "defaultTtl", {
            kind: "integer",
            value: 0,
          })
        : base;
    const rejected = errors(change(document, id, key, value));
    expect(rejected.length).toBeGreaterThan(0);
    if (id === "static_cache" && key === "maxTtl") {
      expect(
        rejected.some(
          (finding) =>
            finding.code === "aws.validation.cloudfront-configuration" &&
            finding.affected.some(
              (location) =>
                location.kind === "node" && location.nodeId === "static_cache",
            ),
        ),
      ).toBe(true);
    }
  });
  it.each([
    "wrong-port",
    "wrong-schema",
    "unknown-property",
    "wrong-generator",
    "wrong-version",
    "wrong-dependency",
    "adopted",
    "wrong-endpoint",
  ])("rejects exact binding corruption %s", (mode) => {
    const d = cloudfrontFixture(true);
    const edges = d.edges.map((e) => {
      if (e.semantic.relationshipType !== "aws.cloudfront.reads-s3-origin")
        return e;
      const x = structuredClone(e);
      if (mode === "wrong-port")
        x.semantic.source.port =
          "aws.cloudfront.distribution.alias" as typeof x.semantic.source.port;
      if (mode === "wrong-schema")
        x.semantic.configuration.schemaVersion =
          "9.0.0" as typeof x.semantic.configuration.schemaVersion;
      if (mode === "unknown-property")
        x.semantic.configuration.values = Object.fromEntries([
          ["extra", { kind: "boolean" as const, value: true }],
        ]);
      if (mode === "wrong-endpoint")
        x.semantic.target.nodeId =
          "static_cache" as typeof x.semantic.target.nodeId;
      if (x.semantic.lifecycle.ownership !== "generated")
        throw Error("Not generated");
      if (mode === "wrong-generator")
        x.semantic.lifecycle.provenance.generatorId =
          "aws.cloudfront.unreviewed" as typeof x.semantic.lifecycle.provenance.generatorId;
      if (mode === "wrong-version")
        x.semantic.lifecycle.provenance.generatorVersion =
          "9.0.0" as typeof x.semantic.lifecycle.provenance.generatorVersion;
      if (mode === "wrong-dependency")
        x.semantic.lifecycle.provenance.dependentNodeIds = [];
      if (mode === "adopted")
        return {
          ...x,
          semantic: {
            ...x.semantic,
            lifecycle: {
              ...x.semantic.lifecycle,
              ownership: "adopted" as const,
              adoptedBy: "actor_fixture",
              adoptedAt: "2026-10-04T00:00:00Z",
            },
          },
        };
      return x;
    });
    expect(
      errors(parseArchitectureDocument({ ...d, edges })).map(
        (finding) => finding.code,
      ),
    ).toContain("aws.validation.cloudfront-binding");
  });
  it.each([
    "actions",
    "principals",
    "effect",
    "scope",
    "owner-port",
    "membership",
    "policy-parent",
    "policy-provenance",
  ])("rejects policy widening or authority corruption %s", (mode) => {
    let d = cloudfrontFixture();
    const policy = required(
        d.nodes.find(
          (n) =>
            n.semantic.serviceType === "aws.iam.policy-document" &&
            n.semantic.lifecycle.ownership === "generated" &&
            n.semantic.lifecycle.provenance.generatorId ===
              "aws.cloudfront.reads-s3-origin",
        ),
      ),
      statement = required(
        d.nodes.find((n) => n.semantic.parent?.nodeId === policy.id),
      );
    if (mode === "actions")
      d = change(d, statement.id, "actions", {
        kind: "string-list",
        value: ["s3:GetObject", "s3:PutObject"],
      });
    if (mode === "principals")
      d = change(d, statement.id, "principals", {
        kind: "string-list",
        value: ["*"],
      });
    if (mode === "effect")
      d = change(d, statement.id, "effect", { kind: "string", value: "deny" });
    if (mode === "scope")
      d = change(d, statement.id, "resourceExpressions", {
        kind: "string-list",
        value: ["*"],
      });
    if (mode === "owner-port" || mode === "membership")
      d = parseArchitectureDocument({
        ...d,
        edges: d.edges.map((e) =>
          e.semantic.relationshipType ===
            (mode === "owner-port"
              ? "aws.s3.bucket-owns-resource-policy"
              : "aws.iam.policy-contains-statement") &&
          e.semantic.source.nodeId ===
            (mode === "owner-port" ? policy.id : statement.id)
            ? {
                ...e,
                semantic: {
                  ...e.semantic,
                  source: {
                    ...e.semantic.source,
                    port: "aws.iam.policy-document.statement",
                  },
                },
              }
            : e,
        ),
      });
    if (mode === "policy-parent" || mode === "policy-provenance")
      d = parseArchitectureDocument({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id !== policy.id
            ? n
            : {
                ...n,
                semantic: {
                  ...n.semantic,
                  ...(mode === "policy-parent"
                    ? {
                        parent: {
                          nodeId: "distribution",
                          relationshipType:
                            "aws.s3.bucket-owns-resource-policy",
                        },
                      }
                    : { lifecycle: { ownership: "user", origin: "user" } }),
                },
              },
        ),
      });
    expect(errors(d).length).toBeGreaterThan(0);
  });
  it.each(["origin", "cache", "owner", "certificate", "zone"])(
    "rejects missing dependency %s",
    (kind) => {
      const rel = required(
        {
          origin: cloudfrontBindings[0][0],
          cache: cloudfrontBindings[1][0],
          owner: cloudfrontBindings[2][0],
          certificate: cloudfrontBindings[3][0],
          zone: "aws.acm.certificate-validates-in-zone",
        }[kind],
      );
      const d = cloudfrontFixture(true);
      if (kind === "origin") {
        expect(() =>
          parseArchitectureDocument({
            ...d,
            edges: d.edges.filter((e) => e.semantic.relationshipType !== rel),
          }),
        ).toThrow();
      } else
        expect(
          errors(
            parseArchitectureDocument({
              ...d,
              edges: d.edges.filter((e) => e.semantic.relationshipType !== rel),
            }),
          ).length,
        ).toBeGreaterThan(0);
    },
  );
  it.each(["cn-north-1", "us-gov-west-1", "us-west-2"])(
    "rejects unsupported alias graph Region %s",
    (region) => {
      const d = cloudfrontFixture(true);
      const rejected = errors(
        parseArchitectureDocument({
          ...d,
          provider: { ...d.provider, region },
        }),
      ).map((finding) => finding.code);
      expect(rejected).toContain(
        region === "us-west-2"
          ? "aws.validation.cloudfront-alias-certificate"
          : "aws.validation.cloudfront-partition",
      );
    },
  );
  it("resolves origin with exactly two IAM nodes/three support edges atomically and restores the source", () => {
    const d = cloudfrontFixture(false, false),
      b = cloudfrontBindings[0],
      request = {
        document: d,
        ruleId: b[0],
        source: { nodeId: "distribution", portId: b[1] + "." + b[2] },
        target: { nodeId: "origin", portId: b[3] + "." + b[4] },
        configuration: {},
        operationId: "operation_cloudfront_origin",
      };
    const r = awsConnectionResolverV1.resolve(request);
    expect(r).toEqual(awsConnectionResolverV1.resolve(request));
    if (!r.success) throw Error(JSON.stringify(r));
    expect(r.batch.commands).toHaveLength(6);
    const applied = applyGraphCommand(d, r.batch);
    expect(applied.document.nodes.length - d.nodes.length).toBe(2);
    expect(applied.document.edges.length - d.edges.length).toBe(4);
    expect(errors(applied.document)).toEqual([]);
    if (applied.inversion.kind !== "available") throw Error("No inverse");
    expect(
      applyGraphCommand(applied.document, applied.inversion.command).document,
    ).toEqual(d);
    const occupied = cloudfrontFixture();
    expect(
      awsConnectionResolverV1.resolve({
        ...request,
        document: occupied,
        operationId: "second_origin",
      }).success,
    ).toBe(false);
  });
  it("matches the closed native configuration contract", async () => {
    const native: unknown = JSON.parse(
      await readFile(
        new URL(
          "../../../services/iac-compiler/internal/contracts/cloudfront-configuration-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(native).toEqual(cloudfrontProperties);
  });
});
