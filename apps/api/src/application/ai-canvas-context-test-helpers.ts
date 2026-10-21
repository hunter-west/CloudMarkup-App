import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { architectureDocumentV3Schema } from "@cloudmarkup/schemas";
import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";

/** Synthetic current-catalog Lambda for context tests; historical generator fixtures stay intact. */
export function currentAiCanvasFixture() {
  const initial = createNotesGenerationRequest({
    mode: "infrastructure-only",
  }).architectureDocument;
  const node = initial.nodes.find(
    (n) => n.semantic.resourceType === "aws.lambda.function",
  );
  if (!node) throw new Error("Missing Lambda fixture");
  const service = awsCatalogV1.requireService("aws.lambda.function");
  const configuration = awsCatalogV1.validateConfiguration(service.id, {});
  if (!configuration.success) throw new Error("Missing Lambda defaults");
  return architectureDocumentV3Schema.parse({
    ...initial,
    provider: { id: awsCatalogV1.artifact.provider.id, region: "us-east-1" },
    catalog: {
      id: awsCatalogV1.artifact.catalog.id,
      version: awsCatalogV1.artifact.catalog.version,
      digest: awsCatalogV1.artifact.digest,
    },
    nodes: [
      {
        ...node,
        semantic: {
          ...node.semantic,
          serviceType: service.id,
          configuration: {
            schemaId: service.configuration.schemaId,
            schemaVersion: service.configuration.schemaVersion,
            values: configuration.values,
          },
        },
      },
    ],
    edges: [],
    workloadBehavior: { ...initial.workloadBehavior, workloads: [] },
    applicationContracts: { ...initial.applicationContracts, contracts: [] },
  });
}

/** Reviewed scalar fixture plus stable relationship identities. All data is synthetic. */
export function currentAiCanvasIssueFixture() {
  const input = currentAiCanvasFixture();
  const base = input.nodes[0];
  if (!base) throw new Error("Missing base node");
  const make = (serviceType: string, id: string) => {
    const service = awsCatalogV1.requireService(serviceType);
    const defaults = awsCatalogV1.validateConfiguration(service.id, {});
    return {
      ...base,
      id,
      semantic: {
        ...base.semantic,
        deploymentKey: id,
        serviceType,
        resourceType: serviceType,
        configuration: {
          schemaId: service.configuration.schemaId,
          schemaVersion: service.configuration.schemaVersion,
          values: defaults.success ? defaults.values : {},
        },
      },
    };
  };
  const hidden = make("aws.iam.policy-document", "node_hidden_policy");
  const other = make("aws.sqs.queue", "node_other_queue");
  const affected = make("aws.sqs.queue", "node_affected_queue");
  const rule = awsCatalogV1
    .listConnectionRules()
    .find(
      (r) =>
        r.source.serviceId === "aws.sqs.queue" &&
        r.target.serviceId === "aws.lambda.function",
    );
  if (!rule) throw new Error("Missing SQS trigger rule");
  const defaults = validateProviderConfigurationV1(rule.configuration, {});
  if (!defaults.success) throw new Error("Missing SQS trigger defaults");
  return architectureDocumentV3Schema.parse({
    ...input,
    nodes: [
      hidden,
      other,
      affected,
      {
        ...base,
        semantic: {
          ...base.semantic,
          configuration: {
            ...base.semantic.configuration,
            values: {
              ...base.semantic.configuration.values,
              timeoutSeconds: { kind: "integer", value: 90 },
            },
          },
        },
      },
    ],
    edges: [
      {
        id: "edge_affected_trigger",
        semantic: {
          source: { nodeId: affected.id, port: rule.source.portId },
          target: { nodeId: base.id, port: rule.target.portId },
          relationshipType: rule.relationshipType,
          configuration: {
            schemaId: rule.configuration.schemaId,
            schemaVersion: rule.configuration.schemaVersion,
            values: defaults.values,
          },
          lifecycle: { ownership: "user", origin: "user" },
        },
      },
    ],
  });
}
