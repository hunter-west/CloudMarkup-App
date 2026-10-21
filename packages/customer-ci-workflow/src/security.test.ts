import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  containsCredentialShape,
  safeIssue,
  sha256,
  yamlSemanticDigest,
} from "./security.js";

describe("customer CI deterministic security helpers", () => {
  it("canonicalizes object keys and produces stable SHA-256 digests", () => {
    const left = { nested: { z: 3, a: 1 }, values: [{ y: 2, x: 1 }] };
    const right = { values: [{ x: 1, y: 2 }], nested: { a: 1, z: 3 } };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(sha256(canonicalJson(left))).toBe(sha256(canonicalJson(right)));
    expect(sha256("customer-owned")).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("computes a semantic YAML digest independent of mapping order", () => {
    expect(
      yamlSemanticDigest("name: test\npermissions:\n  contents: read\n"),
    ).toBe(yamlSemanticDigest("permissions:\n  contents: read\nname: test\n"));
  });

  it.each([
    ["AKIA", "IOSFODNN7EXAMPLE"].join(""),
    ["ASIA", "IOSFODNN7EXAMPLE"].join(""),
    "aws_access_key_id = value",
    "aws_secret_access_key: value",
    ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
    "https://user:password@example.invalid/repository",
  ])("detects a forbidden credential shape", (value) => {
    expect(containsCredentialShape(value)).toBe(true);
  });

  it("allows OIDC variable references and produces schema-limited issues", () => {
    expect(
      containsCredentialShape(
        "role-to-assume: ${{ vars.CLOUDMARKUP_PLAN_ROLE_ARN }}",
      ),
    ).toBe(false);
    expect(
      safeIssue(
        "CUSTOMER_CI_SAFE_ERROR",
        "The reviewed operation was rejected.",
        "workflow.plan",
      ),
    ).toEqual({
      code: "CUSTOMER_CI_SAFE_ERROR",
      field: "workflow.plan",
      message: "The reviewed operation was rejected.",
      severity: "error",
    });
  });
});
