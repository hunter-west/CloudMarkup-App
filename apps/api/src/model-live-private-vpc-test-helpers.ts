import { resolveAwsCurrentCatalogV1 } from "@cloudmarkup/provider-aws";
import { awsConnectionRuleRegistrationsV1 } from "@cloudmarkup/provider-aws/connection-resolution";
import { createProviderConnectionResolverV1 } from "@cloudmarkup/provider-sdk";
import {
  architectureDocumentV3Schema,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import { createProductionModelLiveCaseRequest } from "./production-model-live-case-request.js";
/** Synthetic graph inputs test coverage only, not full provider validation,
 * compiler execution, model output or hosted evidence. */
export function createSyntheticPrivateVpcGraph(validateConfigurations = false) {
  const source = createProductionModelLiveCaseRequest({
    caseId: "evaluation_case_prompt_injection_and_secrets_full_beta_v1",
    requestedMode: "guided",
  });
  if (source.operation !== "operations.propose") throw Error("Wrong source");
  const doc = structuredClone(source.architecture);
  const awsCatalogV1 = resolveAwsCurrentCatalogV1(doc.catalog).catalog;
  const awsConnectionResolverV1 = createProviderConnectionResolverV1(
    awsCatalogV1.artifact,
    awsConnectionRuleRegistrationsV1.filter((registration) =>
      awsCatalogV1
        .listConnectionRules()
        .some((rule) => rule.id === registration.ruleId),
    ),
  );
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
    const validated = validateConfigurations
      ? awsCatalogV1.validateConfiguration(serviceType, typedValues)
      : undefined;
    if (validated && !validated.success)
      throw Error("Invalid synthetic configuration " + serviceType);
    doc.nodes.push(
      architectureDocumentV3Schema.shape.nodes.element.parse({
        id,
        semantic: {
          serviceType,
          resourceType: serviceType,
          deploymentKey: id,
          lifecycle: { origin: "user", ownership: "user" },
          configuration: {
            schemaId: service.configuration.schemaId,
            schemaVersion: service.configuration.schemaVersion,
            values: validated?.success ? validated.values : typedValues,
          },
          ...(parent
            ? { parent: { nodeId: parent[0], relationshipType: parent[1] } }
            : {}),
        },
        presentation: { label: id, position: { x: 0, y: 0 } },
      }),
    );
  };
  const link = (source: string, target: string, relationship: string) => {
    const r = awsCatalogV1
      .listConnectionRules()
      .find((r) => r.relationshipType === relationship);
    if (!r) throw Error("Missing relationship " + relationship);
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
            values: {},
          },
          lifecycle: { origin: "user", ownership: "user" },
        },
      }),
    );
  };
  add("vpc", "aws.ec2.vpc", { cidrBlock: "10.0.0.0/16" }, [
    "region_evaluation",
    "aws.region.contains-vpc",
  ]);
  link("region_evaluation", "vpc", "aws.region.contains-vpc");
  for (const suffix of ["a", "b"]) {
    add(
      "zone_" + suffix,
      "aws.ec2.availability-zone",
      { zoneName: "us-east-1" + suffix },
      ["vpc", "aws.ec2.vpc-contains-availability-zone"],
    );
    add(
      "subnet_" + suffix,
      "aws.ec2.subnet",
      {
        cidrBlock: suffix === "a" ? "10.0.1.0/24" : "10.0.2.0/24",
        accessTier: "private",
        mapPublicIpOnLaunch: false,
        assignIpv6AddressOnCreation: false,
      },
      ["zone_" + suffix, "aws.ec2.availability-zone-contains-subnet"],
    );
    add("association_" + suffix, "aws.ec2.route-table-association", {}, [
      "route_table",
      "aws.ec2.route-table-owns-subnet-association",
    ]);
    link("vpc", "zone_" + suffix, "aws.ec2.vpc-contains-availability-zone");
    link(
      "zone_" + suffix,
      "subnet_" + suffix,
      "aws.ec2.availability-zone-contains-subnet",
    );
    link(
      "association_" + suffix,
      "route_table",
      "aws.ec2.route-table-owns-subnet-association",
    );
    link(
      "association_" + suffix,
      "subnet_" + suffix,
      "aws.ec2.route-table-association-targets-subnet",
    );
  }
  add("route_table", "aws.ec2.route-table", {}, [
    "vpc",
    "aws.ec2.vpc-contains-route-table",
  ]);
  link("vpc", "route_table", "aws.ec2.vpc-contains-route-table");
  add(
    "endpoint",
    "aws.ec2.gateway-vpc-endpoint",
    { service: "dynamodb", endpointType: "Gateway", policyMode: "restricted" },
    ["vpc", "aws.ec2.vpc-contains-gateway-endpoint"],
  );
  link("vpc", "endpoint", "aws.ec2.vpc-contains-gateway-endpoint");
  link(
    "endpoint",
    "route_table",
    "aws.ec2.gateway-endpoint-associates-route-table",
  );
  add(
    "endpoint_policy",
    "aws.iam.policy-document",
    { policyName: "PrivateTableEndpoint", policyKind: "resource" },
    ["endpoint", "aws.ec2.gateway-endpoint-owns-policy"],
  );
  link("endpoint_policy", "endpoint", "aws.ec2.gateway-endpoint-owns-policy");
  add("lambda", "aws.lambda.function");
  add(
    "access",
    "aws.lambda.vpc-access-configuration",
    { egressRequirement: "dynamodb", ipv6AllowedForDualStack: false },
    ["lambda", "aws.lambda.owns-vpc-access-configuration"],
  );
  link("access", "lambda", "aws.lambda.owns-vpc-access-configuration");
  link("access", "subnet_a", "aws.lambda.vpc-access-uses-subnet");
  link("access", "subnet_b", "aws.lambda.vpc-access-uses-subnet");
  add("group", "aws.ec2.security-group");
  link("vpc", "group", "aws.ec2.vpc-associates-security-group");
  link("access", "group", "aws.lambda.vpc-access-uses-security-group");
  add(
    "group_egress",
    "aws.ec2.security-group-egress-rule",
    {
      protocol: "tcp",
      fromPort: { kind: "integer", value: 443 },
      toPort: { kind: "integer", value: 443 },
      destinationIpv4Cidr: "0.0.0.0/0",
    },
    ["group", "aws.ec2.security-group-owns-egress-rule"],
  );
  link("group_egress", "group", "aws.ec2.security-group-owns-egress-rule");
  add("data", "aws.dynamodb.table");
  link("lambda", "data", "aws.lambda.reads-dynamodb-table");
  add("role", "aws.iam.role");
  link("role", "lambda", "aws.iam.role-assumed-by-lambda");
  if (validateConfigurations) {
    doc.edges = doc.edges.filter(
      (e) =>
        ![
          "aws.iam.role-assumed-by-lambda",
          "aws.lambda.reads-dynamodb-table",
        ].includes(e.semantic.relationshipType),
    );
    for (const [source, target, relation] of [
      ["role", "lambda", "aws.iam.role-assumed-by-lambda"],
      ["lambda", "data", "aws.lambda.reads-dynamodb-table"],
    ] as const) {
      const rule = awsCatalogV1
        .listConnectionRules()
        .find((r) => r.relationshipType === relation);
      if (!rule) throw Error("Missing synthetic relationship");
      const resolved = awsConnectionResolverV1.resolve({
        document: doc,
        ruleId: rule.id,
        source: { nodeId: source, portId: rule.source.portId },
        target: { nodeId: target, portId: rule.target.portId },
        configuration: {},
        operationId: "synthetic_" + source,
      });
      if (!resolved.success)
        throw Error(
          "Synthetic resolver failure " + JSON.stringify(resolved.findings),
        );
      Object.assign(
        doc,
        architectureDocumentV3Schema.parse(resolved.preview.document),
      );
    }
    add(
      "vpc_permission",
      "aws.iam.managed-policy-attachment",
      {
        displayName: "PrivateLambdaEni",
        attachmentKind: "managed-policy-attachment",
        managedPolicyReference:
          "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole",
      },
      ["role", "aws.iam.role-owns-managed-policy-attachment"],
    );
    link(
      "vpc_permission",
      "role",
      "aws.iam.role-owns-managed-policy-attachment",
    );
  }
  add(
    "endpoint_statement",
    "aws.iam.policy-statement",
    {
      statementId: "PrivateTableRead",
      effect: "allow",
      actions: {
        kind: "string-list",
        value: ["dynamodb:GetItem", "dynamodb:Query"],
      },
      principalKind: "provider-identity",
      principals: {
        kind: "string-list",
        value: ["arn:aws:iam::111122223333:role/SyntheticPrivateLambda"],
      },
      resourceExpressions: { kind: "string-list", value: [] },
      resourceNode: {
        kind: "node-reference",
        nodeId: "data" as never,
        attribute: "aws.dynamodb.table.arn" as never,
      },
    },
    ["endpoint_policy", "aws.iam.policy-contains-statement"],
  );
  link(
    "endpoint_statement",
    "endpoint_policy",
    "aws.iam.policy-contains-statement",
  );
  link("endpoint_statement", "data", "aws.iam.authorizes-dynamodb-table");
  return { doc, add, link };
}
