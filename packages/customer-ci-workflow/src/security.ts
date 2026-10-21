import { createHash } from "node:crypto";

import {
  serializeCanonicalJson,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import { parse } from "yaml";

import {
  customerCiIssueV1Schema,
  type CustomerCiIssueV1,
} from "./contracts.js";

export function canonicalJson(value: unknown): string {
  return serializeCanonicalJson(value);
}

export function sha256(value: string | Uint8Array): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`,
  );
}

export function yamlSemanticDigest(content: string): Sha256Digest {
  return sha256(canonicalJson(parse(content)));
}

export function safeIssue(
  code: string,
  message: string,
  field?: string,
  severity: "error" | "warning" | "info" = "error",
): CustomerCiIssueV1 {
  return customerCiIssueV1Schema.parse(
    field === undefined
      ? { code, message, severity }
      : { code, field, message, severity },
  );
}

export function containsCredentialShape(value: string): boolean {
  return [
    /AKIA[0-9A-Z]{16}/,
    /ASIA[0-9A-Z]{16}/,
    /aws_access_key_id\s*[:=]/i,
    /aws_secret_access_key\s*[:=]/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /https?:\/\/[^\s/@]+:[^\s/@]+@/,
  ].some((pattern) => pattern.test(value));
}
