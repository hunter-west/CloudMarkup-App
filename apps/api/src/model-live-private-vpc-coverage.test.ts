import { describe, expect, it } from "vitest";
import {
  serviceConfigurationRecordSchema,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";
import { createSyntheticPrivateVpcGraph as fixture } from "./model-live-private-vpc-test-helpers.js";
import { inspectModelLivePrivateVpcCoverage } from "./model-live-private-vpc-coverage.js";

function setting(
  doc: ArchitectureDocumentV3,
  id: string,
  key: string,
  value: string | boolean,
) {
  const n = doc.nodes.find((n) => n.id === id);
  if (!n) throw Error("Missing node");
  n.semantic.configuration.values =
    serviceConfigurationRecordSchema.shape.values.parse({
      ...n.semantic.configuration.values,
      [key]:
        typeof value === "boolean"
          ? { kind: "boolean", value }
          : { kind: "string", value },
    });
}
function passes(doc: unknown, criterion: string) {
  return inspectModelLivePrivateVpcCoverage(doc).criteria.find(
    (c) => c.criterion === criterion,
  )?.satisfied;
}
describe("private VPC requirement coverage from actual candidate graph", () => {
  it("follows all thirteen explicit topology requirements", () => {
    const { doc } = fixture();
    const result = inspectModelLivePrivateVpcCoverage(doc);
    expect(result.numerator).toBe(13);
    expect(result.denominator).toBe(13);
  });
  it.each([
    ["subnet_b", "accessTier", "public", "private-subnet-selection"],
    ["subnet_b", "mapPublicIpOnLaunch", true, "private-subnet-selection"],
    [
      "subnet_b",
      "assignIpv6AddressOnCreation",
      true,
      "private-subnet-selection",
    ],
    ["zone_b", "zoneName", "us-east-1a", "distinct-availability-zones"],
    ["access", "egressRequirement", "none", "explicit-dynamodb-egress"],
    ["endpoint", "service", "s3", "endpoint-route-for-every-subnet"],
    ["endpoint", "policyMode", "full-access", "restricted-endpoint-policy"],
  ] as const)("rejects changed %s.%s", (id, key, value, criterion) => {
    const { doc } = fixture();
    setting(doc, id, key, value);
    expect(passes(doc, criterion)).toBe(false);
  });
  it.each([
    ["aws.lambda.owns-vpc-access-configuration", "lambda-vpc-association"],
    [
      "aws.ec2.route-table-association-targets-subnet",
      "endpoint-route-for-every-subnet",
    ],
    [
      "aws.ec2.gateway-endpoint-associates-route-table",
      "endpoint-route-for-every-subnet",
    ],
    ["aws.ec2.gateway-endpoint-owns-policy", "restricted-endpoint-policy"],
    ["aws.ec2.vpc-associates-security-group", "same-vpc-security-groups"],
    ["aws.lambda.reads-dynamodb-table", "explicit-dynamodb-data-access"],
    ["aws.iam.role-assumed-by-lambda", "explicit-execution-role"],
  ])("requires an actual %s edge", (relation, criterion) => {
    const { doc } = fixture();
    doc.edges = doc.edges.filter(
      (e) => e.semantic.relationshipType !== relation,
    );
    expect(passes(doc, criterion)).toBe(false);
  });
  it("does not mistake decorative containment or incorrect ports for a real association", () => {
    const { doc } = fixture();
    const e = doc.edges.find(
      (e) =>
        e.semantic.relationshipType === "aws.lambda.vpc-access-uses-subnet",
    );
    if (!e) throw Error("Missing edge");
    e.semantic.target.port =
      "aws.unrelated.port" as typeof e.semantic.target.port;
    expect(passes(doc, "private-subnet-selection")).toBe(false);
  });
  it("rejects NAT even if all other required nodes remain", () => {
    const f = fixture();
    f.add("nat", "aws.ec2.nat-gateway");
    expect(passes(f.doc, "no-nat-gateway")).toBe(false);
  });
  it.each(["0.0.0.0/0", "8.8.8.0/24", "172.0.0.0/8", "999.0.0.0/8"])(
    "rejects public or malformed ingress %s",
    (cidr) => {
      const f = fixture();
      f.add(
        "ingress",
        "aws.ec2.security-group-ingress-rule",
        { sourceIpv4Cidr: cidr },
        ["group", "aws.ec2.security-group-owns-ingress-rule"],
      );
      expect(passes(f.doc, "no-workload-ingress")).toBe(false);
    },
  );
  it.each(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"])(
    "preserves private ingress %s",
    (cidr) => {
      const f = fixture();
      f.add(
        "ingress",
        "aws.ec2.security-group-ingress-rule",
        { sourceIpv4Cidr: cidr },
        ["group", "aws.ec2.security-group-owns-ingress-rule"],
      );
      expect(passes(f.doc, "no-workload-ingress")).toBe(true);
    },
  );
  it("does not infer private workload ingress from subnet placement when a public API invokes Lambda", () => {
    const f = fixture();
    f.add("api", "aws.apigateway.http-api");
    f.link("api", "lambda", "aws.apigateway.integrates-lambda");
    expect(passes(f.doc, "no-workload-ingress")).toBe(false);
  });
  it("is independent of visual layout and never changes the supplied graph", () => {
    const { doc } = fixture();
    const before = structuredClone(doc);
    const first = inspectModelLivePrivateVpcCoverage(doc);
    expect(doc).toEqual(before);
    for (const n of doc.nodes) {
      n.presentation.label = "Cosmetic";
      n.presentation.position = { x: 400, y: 900 };
    }
    expect(inspectModelLivePrivateVpcCoverage(doc)).toEqual(first);
  });
  it("rejects a stale catalog", () => {
    const { doc } = fixture();
    doc.catalog.version = "0.8.0" as typeof doc.catalog.version;
    expect(() => inspectModelLivePrivateVpcCoverage(doc)).toThrow(
      "current private-network evaluation catalog",
    );
  });
});

it("requires the selected security group to permit the modeled DynamoDB HTTPS egress", () => {
  for (const mutate of [
    (doc: ArchitectureDocumentV3) => {
      const n = doc.nodes.find((n) => n.id === "group_egress");
      if (n)
        n.semantic.configuration.values =
          serviceConfigurationRecordSchema.shape.values.parse({
            ...n.semantic.configuration.values,
            toPort: { kind: "integer", value: 444 },
          });
    },
    (doc: ArchitectureDocumentV3) => {
      doc.edges = doc.edges.filter(
        (e) =>
          e.semantic.relationshipType !==
          "aws.ec2.security-group-owns-egress-rule",
      );
    },
  ]) {
    const { doc } = fixture();
    mutate(doc);
    expect(passes(doc, "dynamodb-https-egress")).toBe(false);
  }
});

it.each([
  "empty",
  "wildcard-action",
  "wildcard-principal",
  "wrong-table",
  "missing-binding",
  "wrong-parent",
  "deny",
  "inline-resource",
])(
  "does not mistake a %s endpoint policy for restricted data access",
  (variation) => {
    const { doc } = fixture();
    const statement = doc.nodes.find((n) => n.id === "endpoint_statement");
    if (!statement) throw Error("Missing synthetic statement");
    const values: Record<string, unknown> = {
      ...statement.semantic.configuration.values,
    };
    if (variation === "empty") {
      doc.nodes = doc.nodes.filter((n) => n.id !== statement.id);
      doc.edges = doc.edges.filter(
        (e) =>
          e.semantic.source.nodeId !== statement.id &&
          e.semantic.target.nodeId !== statement.id,
      );
    }
    if (variation === "wildcard-action")
      values["actions"] = { kind: "string-list", value: ["dynamodb:*"] };
    if (variation === "wildcard-principal")
      values["principals"] = { kind: "string-list", value: ["*"] };
    if (variation === "wrong-table")
      values["resourceNode"] = {
        kind: "node-reference",
        nodeId: "role" as never,
        attribute: "aws.dynamodb.table.arn" as never,
      };
    if (variation === "missing-binding")
      doc.edges = doc.edges.filter(
        (e) =>
          e.semantic.relationshipType !== "aws.iam.authorizes-dynamodb-table",
      );
    if (variation === "wrong-parent" && statement.semantic.parent)
      statement.semantic.parent.nodeId = "role" as never;
    if (variation === "deny")
      values["effect"] = { kind: "string", value: "deny" };
    if (variation === "inline-resource")
      values["resourceExpressions"] = { kind: "string-list", value: ["*"] };
    statement.semantic.configuration.values =
      serviceConfigurationRecordSchema.shape.values.parse(values);
    expect(passes(doc, "restricted-endpoint-policy")).toBe(false);
  },
);
