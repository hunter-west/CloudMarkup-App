import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { apiOperationsV1 } from "./operations.js";
import { generateOpenApiDocumentV1 } from "./openapi.js";

describe("OpenAPI v1 generation", () => {
  it("is deterministic and covers every canonical operation", () => {
    const first = generateOpenApiDocumentV1();
    const second = generateOpenApiDocumentV1();

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const paths = first.paths as Record<
      string,
      Record<string, { operationId: string }>
    >;
    const operationIds = Object.values(paths).flatMap((pathItem) =>
      Object.values(pathItem).map((operation) => operation.operationId),
    );
    expect(operationIds.sort()).toEqual(
      Object.keys(apiOperationsV1)
        .map((operationId) => operationId.replaceAll(".", "_"))
        .sort(),
    );
  });

  it("matches the complete reviewed canonical contract artifact", () => {
    const expected = readFileSync(
      new URL("../openapi/cloudmarkup-v1.openapi.json", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");
    const actual = JSON.stringify(generateOpenApiDocumentV1()) + "\n";

    expect(actual).toBe(expected);
  });
});

function schemaAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current))
      throw new Error("Missing OpenAPI schema path");
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

it("adds v6 to both proposal request schemas while preserving released alternatives", () => {
  const api = generateOpenApiDocumentV1();
  for (const path of [
    "/v1/projects/{projectId}/beta-infrastructure-proposals",
    "/v1/projects/{projectId}/beta-infrastructure-jobs",
  ]) {
    const candidate = schemaAt(api, [
      "paths",
      path,
      "post",
      "requestBody",
      "content",
      "application/json",
      "schema",
      "properties",
      "proposalVersion",
      "anyOf",
    ]);
    if (!Array.isArray(candidate))
      throw new Error("Expected proposal version alternatives");
    const variants: unknown[] = candidate;
    expect(variants.map((variant) => schemaAt(variant, ["const"]))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    // Fingerprint from immutable product baseline 38500f98.
    expect(
      createHash("sha256")
        .update(JSON.stringify(variants.slice(0, 4)))
        .digest("hex"),
    ).toBe("98ab19caecb4e44d4803217a769b314da65ac80c2afb6d88af8f28e32514d170");
  }
});

it("publishes v6 responses and retains exact v1-v4 proposal alternatives on all readers", () => {
  const api = generateOpenApiDocumentV1();
  for (const [path, method, status, job] of [
    [
      "/v1/projects/{projectId}/beta-infrastructure-proposals",
      "post",
      "200",
      false,
    ],
    ["/v1/projects/{projectId}/beta-infrastructure-jobs", "post", "202", true],
    [
      "/v1/projects/{projectId}/beta-infrastructure-jobs/{jobId}",
      "get",
      "200",
      true,
    ],
    [
      "/v1/projects/{projectId}/beta-infrastructure-jobs/{jobId}",
      "delete",
      "200",
      true,
    ],
  ] as const) {
    const candidate = schemaAt(api, [
      "paths",
      path,
      method,
      "responses",
      status,
      "content",
      "application/json",
      "schema",
      "properties",
      "data",
      ...(job ? ["properties", "result"] : []),
      "properties",
      "proposal",
      "anyOf",
    ]);
    if (!Array.isArray(candidate))
      throw new Error("Expected proposal alternatives");
    const variants: unknown[] = candidate;
    expect(
      variants.map((variant) =>
        schemaAt(variant, ["properties", "contractVersion", "const"]),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      createHash("sha256")
        .update(JSON.stringify(variants.slice(0, 4)))
        .digest("hex"),
    ).toBe("11c006e12792056c09b50e9ed162db204132a0669882ddc9ab5d79288b9be482");
  }
});
