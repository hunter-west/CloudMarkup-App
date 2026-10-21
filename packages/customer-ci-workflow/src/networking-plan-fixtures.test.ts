import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  analyzeSanitizedTerraformPlanV1,
  sanitizeTerraformPlanV1,
} from "./plan-integrity.js";
import { canonicalJson, sha256 } from "./security.js";
import { planSanitizerScriptV1 } from "./workflow-scripts.js";

const endpointPlanPath = new URL(
  "./fixtures/networking-endpoint-plan.fake.json",
  import.meta.url,
);
const natPlanPath = new URL(
  "./fixtures/networking-nat-plan.fake.json",
  import.meta.url,
);

function readFixture(path: URL): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function digestAddress(address: string): string {
  return sha256(`cloudmarkup.terraform-resource-address.v1\u0000${address}`);
}

describe("sanitized fake Terraform networking plan fixtures", () => {
  it("keeps only deterministic structural facts for an endpoint-based serverless layout", () => {
    const input = readFixture(endpointPlanPath);
    const first = sanitizeTerraformPlanV1(input);
    const repeated = sanitizeTerraformPlanV1(input);
    const analysis = analyzeSanitizedTerraformPlanV1(first);

    expect(repeated).toEqual(first);
    expect(analysis.counts).toEqual({
      create: 1,
      delete: 0,
      noOp: 2,
      read: 0,
      replace: 0,
      update: 1,
    });
    expect(analysis.issues).toEqual([
      expect.objectContaining({
        code: "NETWORK_BOUNDARY_PLAN_CHANGE",
        field: digestAddress("aws_vpc_endpoint.s3"),
      }),
    ]);

    const retained = canonicalJson({ analysis, sanitized: first });
    for (const forbidden of [
      "aws_lambda_function.api",
      "aws_subnet.private_a",
      "aws_subnet.private_b",
      "aws_vpc_endpoint.s3",
      "sg-fixture-private",
      "subnet-fixture-private-a",
      "after_sensitive",
    ]) {
      expect(retained).not.toContain(forbidden);
    }
  });

  it("reports the endpoint-to-NAT semantic change set, including generic EIP network review", () => {
    const endpoint = analyzeSanitizedTerraformPlanV1(
      sanitizeTerraformPlanV1(readFixture(endpointPlanPath)),
    );
    const nat = analyzeSanitizedTerraformPlanV1(
      sanitizeTerraformPlanV1(readFixture(natPlanPath)),
    );

    expect(nat.changes.map(({ actions, type }) => ({ actions, type }))).toEqual(
      expect.arrayContaining([
        { actions: ["create"], type: "aws_eip" },
        { actions: ["create"], type: "aws_nat_gateway" },
        { actions: ["update"], type: "aws_route" },
        { actions: ["delete"], type: "aws_vpc_endpoint" },
        {
          actions: ["update"],
          type: "aws_vpc_security_group_egress_rule",
        },
      ]),
    );
    expect(
      nat.issues.filter(({ code }) => code === "NETWORK_BOUNDARY_PLAN_CHANGE"),
    ).toHaveLength(5);
    expect(nat.issues).toContainEqual(
      expect.objectContaining({
        code: "NETWORK_BOUNDARY_PLAN_CHANGE",
        field: digestAddress("aws_eip.nat_a"),
      }),
    );
    expect(nat.issues).toContainEqual(
      expect.objectContaining({
        code: "DESTRUCTIVE_PLAN_CHANGE",
        field: digestAddress("aws_vpc_endpoint.s3"),
      }),
    );
    expect(nat.changes).not.toEqual(endpoint.changes);

    const retained = canonicalJson(nat);
    for (const forbidden of [
      "aws_eip.nat_a",
      "aws_nat_gateway.nat_a",
      "aws_route.private_default",
      "aws_vpc_endpoint.s3",
      "eipalloc-fixture",
      "192.0.2.10",
    ]) {
      expect(retained).not.toContain(forbidden);
    }
  });

  it("keeps the emitted workflow sanitizer aligned and credential-free", () => {
    const script = planSanitizerScriptV1();

    expect(script).toContain("'aws_eip'");
    expect(script).toContain("NETWORK_BOUNDARY_PLAN_CHANGE");
    expect(script).not.toMatch(
      /(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|terraform\s+apply|terraform\s+destroy)/u,
    );
  });
});
