import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  normalizeArchitectureDocumentV1,
  parseArchitectureDocumentV1,
  parseArchitectureDocumentV1Json,
  serializeArchitectureDocumentV1,
} from "./index.js";
import { ArchitectureDocumentSchemaError } from "./validation.js";

async function readFixture(path: string): Promise<string> {
  return readFile(
    new URL(
      `../../test-fixtures/fixtures/architecture-document/v1/${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

describe("Architecture Document v1 schema", () => {
  it("round-trips the representative fixture deterministically", async () => {
    const input = await readFixture("valid/representative.json");
    const first = parseArchitectureDocumentV1Json(input);
    const normalized = normalizeArchitectureDocumentV1(first);
    const serialized = serializeArchitectureDocumentV1(first);
    const second = parseArchitectureDocumentV1Json(serialized);

    expect(second).toEqual(normalized);
    expect(serializeArchitectureDocumentV1(second)).toBe(serialized);
    expect(
      second.nodes.find((node) => node.id === "node_application")?.presentation
        .label,
    ).toBe("Application");
    expect(
      second.nodes.find((node) => node.id === "node_application")?.semantic
        .deploymentKey,
    ).toBe("application");
  });

  it("orders semantically unordered collections without mutating the source", async () => {
    const parsed = parseArchitectureDocumentV1Json(
      await readFixture("valid/representative.json"),
    );
    const reversed = {
      ...parsed,
      nodes: [...parsed.nodes].reverse(),
      edges: [...parsed.edges].reverse(),
      variables: [...parsed.variables].reverse(),
      outputs: [...parsed.outputs].reverse(),
      assumptions: [...parsed.assumptions].reverse(),
      unresolvedRequirements: [...parsed.unresolvedRequirements].reverse(),
    };
    const before = JSON.stringify(reversed);

    expect(serializeArchitectureDocumentV1(reversed)).toBe(
      serializeArchitectureDocumentV1(parsed),
    );
    expect(JSON.stringify(reversed)).toBe(before);
  });

  it("intentionally rejects unsupported schema versions with a safe path", async () => {
    const input = await readFixture("invalid/unsupported-schema-version.json");

    expect.assertions(4);
    try {
      parseArchitectureDocumentV1Json(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureDocumentSchemaError);
      const schemaError = error as ArchitectureDocumentSchemaError;
      expect(schemaError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.schemaVersion",
          }),
        ]),
      );
      expect(schemaError.message).toContain("$.schemaVersion");
      expect(schemaError.message).not.toContain("doc_unsupported_version");
    }
  });

  it("rejects raw untyped configuration values", async () => {
    const valid = parseArchitectureDocumentV1Json(
      await readFixture("valid/representative.json"),
    );
    const firstNode = valid.nodes[0];
    expect(firstNode).toBeDefined();

    const input = {
      ...valid,
      nodes: [
        {
          ...firstNode,
          semantic: {
            ...firstNode?.semantic,
            configuration: {
              ...firstNode?.semantic.configuration,
              values: {
                ...firstNode?.semantic.configuration.values,
                rawValue: {
                  arbitrary: "not a typed configuration value",
                },
              },
            },
          },
        },
        ...valid.nodes.slice(1),
      ],
    };

    expect(() => parseArchitectureDocumentV1(input)).toThrow(
      ArchitectureDocumentSchemaError,
    );
  });
});
