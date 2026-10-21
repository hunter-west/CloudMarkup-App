import {
  parseArchitectureDocument,
  applyGraphCommand,
} from "@cloudmarkup/domain";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { dnsFixture } from "./dns-acm-fixture.test-support.js";
export const cloudfrontInputs = {
  "aws.cloudfront.distribution": {
    comment: { kind: "string", value: "Synthetic public static delivery" },
    enabled: { kind: "boolean", value: false },
    publicContentAttested: { kind: "boolean", value: true },
    defaultRootObject: { kind: "string", value: "index.html" },
    priceClass: { kind: "string", value: "PriceClass_100" },
  },
  "aws.cloudfront.cache-policy": {
    name: { kind: "string", value: "StaticExample" },
    comment: { kind: "string", value: "Synthetic bounded static cache" },
    defaultTtl: { kind: "integer", value: 300 },
    maxTtl: { kind: "integer", value: 3600 },
  },
  "aws.cloudfront.alias-configuration": {
    domainName: { kind: "string", value: "app.example.test" },
  },
} as const;
export function cloudfrontFixture(alias = false, resolveOrigin = true) {
  const base = dnsFixture();
  const nodes: unknown[] = base.nodes.map((n) =>
    n.id !== "certificate"
      ? n
      : {
          ...n,
          semantic: {
            ...n.semantic,
            configuration: {
              ...n.semantic.configuration,
              values: {
                ...n.semantic.configuration.values,
                intendedUse: { kind: "string", value: "cloudfront-viewer" },
              },
            },
          },
        },
  );
  const definitions: {
    id: string;
    type: string;
    values: Record<string, unknown>;
    parent?: { nodeId: string; relationshipType: string };
  }[] = [
    {
      id: "origin",
      type: "aws.s3.bucket",
      values: {
        bucketName: {
          kind: "string",
          value: "cloudmarkup-synthetic-static-origin",
        },
      },
    },
    {
      id: "distribution",
      type: "aws.cloudfront.distribution",
      values: {
        ...cloudfrontInputs["aws.cloudfront.distribution"],
        viewerCertificateMode: {
          kind: "string",
          value: alias ? "acm-alias" : "default",
        },
      },
    },
    {
      id: "static_cache",
      type: "aws.cloudfront.cache-policy",
      values: cloudfrontInputs["aws.cloudfront.cache-policy"],
    },
  ];
  if (alias)
    definitions.push({
      id: "viewer_alias",
      type: "aws.cloudfront.alias-configuration",
      values: cloudfrontInputs["aws.cloudfront.alias-configuration"],
      parent: {
        nodeId: "distribution",
        relationshipType: "aws.cloudfront.distribution-owns-alias",
      },
    });
  for (const { id, type, values, parent } of definitions) {
    const service = awsCatalogV1.requireService(type),
      c = awsCatalogV1.validateConfiguration(type, values);
    if (!c.success) throw Error("Invalid synthetic CloudFront fixture");
    nodes.push({
      id,
      semantic: {
        deploymentKey: id,
        serviceType: type,
        resourceType: type,
        lifecycle: { ownership: "user", origin: "user" },
        configuration: {
          schemaId: service.configuration.schemaId,
          schemaVersion: service.configuration.schemaVersion,
          values: c.values,
        },
        ...(parent ? { parent } : {}),
      },
      presentation: { label: id, position: { x: 0, y: 0 } },
    });
  }
  let document = parseArchitectureDocument({ ...base, nodes });
  const bindings: [string, string, string][] = [
    ["aws.cloudfront.uses-cache-policy", "distribution", "static_cache"],
  ];
  if (alias)
    bindings.push(
      [
        "aws.cloudfront.distribution-owns-alias",
        "viewer_alias",
        "distribution",
      ],
      ["aws.cloudfront.alias-uses-certificate", "viewer_alias", "certificate"],
    );
  if (resolveOrigin)
    bindings.push(["aws.cloudfront.reads-s3-origin", "distribution", "origin"]);
  for (const [id, source, target] of bindings) {
    const rule = awsCatalogV1.listConnectionRules().find((r) => r.id === id);
    if (!rule) throw Error("Missing CloudFront rule");
    const result = awsConnectionResolverV1.resolve({
      document,
      ruleId: id,
      source: { nodeId: source, portId: rule.source.portId },
      target: { nodeId: target, portId: rule.target.portId },
      configuration: {},
      operationId: "operation_cloudfront_" + String(document.edges.length),
    });
    if (!result.success) throw Error(JSON.stringify(result));
    document = applyGraphCommand(document, result.batch).document;
  }
  return document;
}
