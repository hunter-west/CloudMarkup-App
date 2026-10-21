import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import {
  architectureDocumentV3Schema,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import { createProductionModelLiveCaseRequest } from "./production-model-live-case-request.js";
/** Synthetic graph inputs test coverage only, not full provider validation,
 * compiler execution, model output or hosted evidence. */
export function createSyntheticEventGraph() {
  const source = createProductionModelLiveCaseRequest({
    caseId: "evaluation_case_event_driven_image_processing_full_beta_v1",
    requestedMode: "guided",
  });
  if (source.operation !== "operations.propose") throw Error("Wrong source");
  const doc = structuredClone(source.architecture);
  const add = (
    id: string,
    serviceType: string,
    values: Record<string, string | boolean | ConfigurationValue> = {},
    parent?: [string, string],
  ) => {
    const service = awsCatalogV1.requireService(serviceType);
    const typedValues = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        typeof v === "object"
          ? v
          : { kind: typeof v === "boolean" ? "boolean" : "string", value: v },
      ]),
    );
    const validated = awsCatalogV1.validateConfiguration(
      serviceType,
      typedValues,
    );
    if (!validated.success)
      throw Error("Invalid synthetic configuration " + serviceType);
    doc.nodes.push(
      architectureDocumentV3Schema.shape.nodes.element.parse({
        id,
        semantic: {
          serviceType,
          resourceType: serviceType,
          deploymentKey: id.toLowerCase(),
          lifecycle: { origin: "user", ownership: "user" },
          configuration: {
            schemaId: service.configuration.schemaId,
            schemaVersion: service.configuration.schemaVersion,
            values: validated.values,
          },
          ...(parent
            ? { parent: { nodeId: parent[0], relationshipType: parent[1] } }
            : {}),
        },
        presentation: { label: id, position: { x: 0, y: 0 } },
      }),
    );
  };
  const link = (
    source: string,
    target: string,
    relationship: string,
    values: Record<string, ConfigurationValue> = {},
  ) => {
    const r = awsCatalogV1
      .listConnectionRules()
      .find((r) => r.relationshipType === relationship);
    if (!r) throw Error("Missing relationship " + relationship);
    const validated = validateProviderConfigurationV1(r.configuration, values);
    if (!validated.success)
      throw Error("Invalid synthetic relationship " + relationship);
    doc.edges.push(
      architectureDocumentV3Schema.shape.edges.element.parse({
        id: "edge_" + String(doc.edges.length),
        semantic: {
          relationshipType: relationship,
          source: { nodeId: source, port: r.source.portId },
          target: { nodeId: target, port: r.target.portId },
          configuration: {
            schemaId: r.configuration.schemaId,
            schemaVersion: r.configuration.schemaVersion,
            values: validated.values,
          },
          lifecycle: { origin: "user", ownership: "user" },
        },
      }),
    );
  };

  add("input", "aws.s3.bucket", { bucketName: "synthetic-image-input" });
  add("output", "aws.s3.bucket", { bucketName: "synthetic-image-output" });
  add("lambda", "aws.lambda.function");
  add("role", "aws.iam.role");
  add("log", "aws.cloudwatch.log-group");
  add("dlq", "aws.sqs.queue");
  link("role", "lambda", "aws.iam.role-assumed-by-lambda");
  link("lambda", "log", "aws.lambda.writes-log-group");
  link("lambda", "dlq", "aws.lambda.uses-sqs-dead-letter-queue", {
    deliverySemantics: { kind: "string", value: "AT_LEAST_ONCE" },
  });
  link("input", "lambda", "aws.s3.notifies-lambda", {
    eventType: { kind: "string", value: "OBJECT_CREATED" },
    filterPrefix: { kind: "string", value: "uploads/" },
    filterSuffix: { kind: "string", value: ".png" },
    deliverySemantics: { kind: "string", value: "AT_LEAST_ONCE_UNORDERED" },
  });
  add(
    "identity",
    "aws.iam.policy-document",
    { policyName: "ImageAccess", policyKind: "identity-inline" },
    ["role", "aws.iam.role-owns-inline-policy"],
  );
  link("identity", "role", "aws.iam.role-owns-inline-policy");
  const grant = (
    id: string,
    policy: string,
    action: string,
    target: string,
    relation: string,
    service = false,
  ) => {
    const targetNode = doc.nodes.find((n) => n.id === target);
    if (!targetNode) throw Error("Missing synthetic target");
    add(
      id,
      "aws.iam.policy-statement",
      {
        statementId: id,
        effect: "allow",
        actions: { kind: "string-list", value: [action] },
        principalKind: service ? "service" : "none",
        principals: {
          kind: "string-list",
          value: service ? ["s3.amazonaws.com"] : [],
        },
        resourceExpressions: { kind: "string-list", value: [] },
        resourceNode: {
          kind: "node-reference",
          nodeId: targetNode.id,
          attribute: (targetNode.semantic.serviceType + ".arn") as never,
        },
      },
      [policy, "aws.iam.policy-contains-statement"],
    );
    link(id, policy, "aws.iam.policy-contains-statement");
    link(id, target, relation);
  };
  grant(
    "ReadInput",
    "identity",
    "s3:GetObject",
    "input",
    "aws.iam.authorizes-s3-bucket",
  );
  grant(
    "WriteOutput",
    "identity",
    "s3:PutObject",
    "output",
    "aws.iam.authorizes-s3-bucket",
  );
  grant(
    "SendFailure",
    "identity",
    "sqs:SendMessage",
    "dlq",
    "aws.iam.authorizes-sqs-queue",
  );
  add(
    "invocation",
    "aws.iam.policy-document",
    { policyName: "S3Invocation", policyKind: "service-grant" },
    ["lambda", "aws.lambda.owns-invocation-permission"],
  );
  link("invocation", "lambda", "aws.lambda.owns-invocation-permission");
  grant(
    "InvokeLambda",
    "invocation",
    "lambda:InvokeFunction",
    "lambda",
    "aws.iam.authorizes-lambda-function",
    true,
  );
  add(
    "source",
    "aws.iam.policy-condition",
    {
      operator: "ArnEquals",
      key: "AWS:SourceArn",
      values: {
        kind: "string-list",
        value: ["arn:aws:s3:::synthetic-image-input"],
      },
    },
    ["InvokeLambda", "aws.iam.statement-owns-condition"],
  );
  link("source", "InvokeLambda", "aws.iam.statement-owns-condition");
  return { doc, add, link };
}
