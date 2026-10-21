import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { architectureDocumentV3Schema } from "@cloudmarkup/schemas";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import { currentAiCanvasIssueFixture } from "./ai-canvas-context-test-helpers.js";

/** Synthetic reviewed graph; no customer or provider-resolved values. */
export function semanticAiFixture() {
  const initial = currentAiCanvasIssueFixture();
  const base = initial.nodes.find(
    (node) => node.semantic.serviceType === "aws.lambda.function",
  );
  const queue = initial.nodes.find((node) => node.id === "node_affected_queue");
  if (!base || !queue) throw new Error("Missing synthetic fixture nodes.");
  const make = (id: string, serviceType: string, values: unknown) => {
    const service = awsCatalogV1.requireService(serviceType);
    return {
      id,
      semantic: {
        deploymentKey: id,
        serviceType,
        resourceType: serviceType,
        configuration: {
          schemaId: service.configuration.schemaId,
          schemaVersion: service.configuration.schemaVersion,
          values,
        },
        lifecycle: { ownership: "user", origin: "user" },
      },
      presentation: { label: id, position: { x: 0, y: 0 } },
    };
  };
  const policy = make("node_policy", "aws.iam.policy-document", {
    policyName: { kind: "string", value: "ConsumeQueue" },
    policyKind: { kind: "string", value: "identity-inline" },
  });
  const statement = make("node_statement", "aws.iam.policy-statement", {
    statementId: { kind: "string", value: "ConsumeQueue" },
    effect: { kind: "string", value: "allow" },
    actions: {
      kind: "string-list",
      value: ["sqs:ReceiveMessage", "sqs:DeleteMessage"],
    },
    principalKind: { kind: "string", value: "none" },
    principals: { kind: "string-list", value: [] },
    resourceExpressions: { kind: "string-list", value: [] },
    resourceNode: {
      kind: "node-reference",
      nodeId: queue.id,
      attribute: "aws.sqs.queue.arn",
    },
  });
  const condition = make("node_condition", "aws.iam.policy-condition", {
    operator: { kind: "string", value: "Bool" },
    key: { kind: "string", value: "aws:SecureTransport" },
    values: { kind: "string-list", value: ["true"] },
  });
  const nodes = [queue, base, policy, statement, condition];
  const bind = (source: string, target: string) => {
    const from = nodes.find((node) => node.id === source);
    const to = nodes.find((node) => node.id === target);
    const rule = awsCatalogV1
      .listConnectionRules()
      .find(
        (item) =>
          item.source.serviceId === from?.semantic.serviceType &&
          item.target.serviceId === to?.semantic.serviceType,
      );
    if (!rule) throw new Error("Missing reviewed policy connection.");
    const defaults = validateProviderConfigurationV1(rule.configuration, {});
    if (!defaults.success)
      throw new Error("Missing reviewed connection defaults.");
    return {
      id: `edge_${source}_${target}`,
      semantic: {
        source: { nodeId: source, port: rule.source.portId },
        target: { nodeId: target, port: rule.target.portId },
        relationshipType: rule.relationshipType,
        configuration: {
          schemaId: rule.configuration.schemaId,
          schemaVersion: rule.configuration.schemaVersion,
          values: defaults.values,
        },
        lifecycle: { ownership: "user", origin: "user" },
      },
    };
  };
  const notes = createNotesGenerationRequest({
    mode: "generated-starter",
    operations: ["read"],
  }).architectureDocument;
  const workload = notes.workloadBehavior.workloads[0];
  const trigger = initial.edges[0];
  if (!workload || !trigger || !workload.operations[0])
    throw new Error("Missing synthetic workload.");
  const ownedStatement = {
    ...statement,
    semantic: {
      ...statement.semantic,
      parent: {
        nodeId: policy.id,
        relationshipType: "aws.iam.policy-owns-statement",
      },
    },
  };
  const ownedCondition = {
    ...condition,
    semantic: {
      ...condition.semantic,
      parent: {
        nodeId: statement.id,
        relationshipType: "aws.iam.statement-owns-condition",
      },
    },
  };
  return architectureDocumentV3Schema.parse({
    ...initial,
    nodes: [queue, base, policy, ownedStatement, ownedCondition],
    edges: [
      trigger,
      bind(statement.id, policy.id),
      bind(condition.id, statement.id),
      bind(statement.id, queue.id),
    ],
    applicationContracts: {
      ...initial.applicationContracts,
      contracts: notes.applicationContracts.contracts,
    },
    workloadBehavior: {
      contractVersion: 2,
      workloads: [
        {
          ...workload,
          owningNodeId: base.id,
          httpRoutes: [],
          eventBindings: [],
          schedules: [],
          dataBindings: [],
          downstreamActions: [],
          triggers: [
            {
              id: "trigger_queue",
              edgeId: trigger.id,
              targetOperationId: workload.operations[0].id,
            },
          ],
          environment: [
            {
              id: "environment_queue",
              name: "QUEUE_URL",
              value: {
                kind: "node-attribute-reference",
                nodeId: queue.id,
                attribute: "aws.sqs.queue.url",
              },
            },
            {
              id: "environment_secret",
              name: "SERVICE_CREDENTIAL",
              value: {
                kind: "secret-reference",
                reference: "synthetic_secret_locator_never_shared",
              },
            },
          ],
        },
      ],
    },
  });
}
