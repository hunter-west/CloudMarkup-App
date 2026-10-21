import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";
import { auroraFixture } from "./aurora-fixture.test-support.js";
export const dnsInputs = {
  "aws.route53.public-hosted-zone": {
    domainName: { kind: "string", value: "example.test" },
    comment: { kind: "string", value: "Synthetic public DNS authority" },
    domainControlAttested: { kind: "boolean", value: true },
  },
  "aws.acm.public-dns-certificate": {
    domainName: { kind: "string", value: "app.example.test" },
    certificateRegion: { kind: "string", value: "us-east-1" },
  },
} as const;
export function dnsFixture() {
  const base = auroraFixture(),
    nodes: unknown[] = [...base.nodes];
  for (const [id, type] of [
    ["public_zone", "aws.route53.public-hosted-zone"],
    ["certificate", "aws.acm.public-dns-certificate"],
  ] as const) {
    const service = awsCatalogV1.requireService(type),
      configuration = awsCatalogV1.validateConfiguration(type, dnsInputs[type]);
    if (!configuration.success) throw Error("Invalid synthetic DNS fixture");
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
          values: configuration.values,
        },
      },
      presentation: { label: id, position: { x: 0, y: 0 } },
    });
  }
  const rule = awsCatalogV1
    .listConnectionRules()
    .find((r) => r.id === "aws.acm.certificate-validates-in-zone");
  if (!rule) throw Error("Missing DNS binding");
  return parseArchitectureDocument({
    ...base,
    nodes,
    edges: [
      ...base.edges,
      {
        id: "certificate_zone",
        semantic: {
          relationshipType: rule.relationshipType,
          source: { nodeId: "certificate", port: rule.source.portId },
          target: { nodeId: "public_zone", port: rule.target.portId },
          configuration: {
            schemaId: rule.configuration.schemaId,
            schemaVersion: rule.configuration.schemaVersion,
            values: {},
          },
          lifecycle: { ownership: "user", origin: "user" },
        },
      },
    ],
  });
}
