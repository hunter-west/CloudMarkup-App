import { describe, expect, it } from "vitest";
import { z } from "zod";
import { modelOperationProposalResponseV1Schema } from "@cloudmarkup/schemas";

import {
  getModelResponseToolV1,
  listModelResponseToolsV1,
  parseModelResponseToolContentV1,
} from "./tools.js";

describe("ModelGateway response tools v1", () => {
  it("publishes one unique, authority-free strict schema per operation", () => {
    const tools = listModelResponseToolsV1();
    expect(tools).toHaveLength(15);
    expect(new Set(tools.map((tool) => tool.operation)).size).toBe(15);
    expect(new Set(tools.map((tool) => tool.toolName)).size).toBe(15);
    expect(tools.map((tool) => tool.authority)).toEqual(
      Array.from({ length: 15 }, () => "none"),
    );
    expect(
      tools.every(
        (tool) =>
          tool.inputSchema["additionalProperties"] === false &&
          tool.schemaId.includes(tool.toolName),
      ),
    ).toBe(true);
  });

  it("rejects prose, mismatched tools, and extra content fields", () => {
    expect(() =>
      parseModelResponseToolContentV1({
        content: { kind: "text", text: "unstructured" },
        operation: "summary.technical",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "model-gateway.prose-not-machine-state",
      }),
    );
    expect(() =>
      parseModelResponseToolContentV1({
        content: {
          input: {},
          kind: "tool-use",
          toolName: getModelResponseToolV1("summary.plain-language").toolName,
        },
        operation: "summary.technical",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "model-gateway.unknown-response-tool",
      }),
    );
    expect(() =>
      parseModelResponseToolContentV1({
        content: {
          extra: "not-allowed",
          input: {},
          kind: "tool-use",
          toolName: getModelResponseToolV1("summary.technical").toolName,
        },
        operation: "summary.technical",
      }),
    ).toThrow(
      expect.objectContaining({ code: "model-gateway.invalid-output" }),
    );
  });
});

/** Resolve local references only to compare the complete structural contract.
 * No external schema fetching or provider invocation is allowed in this check. */
function expandedSchema(
  value: unknown,
  root: Record<string, unknown>,
  ancestors = new Set<string>(),
): unknown {
  if (Array.isArray(value))
    return value.map((item) => expandedSchema(item, root, ancestors));
  if (value === null || typeof value !== "object") return value;
  const entries = value as Record<string, unknown>;
  const reference = entries["$ref"];
  const rest = Object.fromEntries(
    Object.entries(entries).filter(
      ([key]) => key !== "$defs" && key !== "$ref",
    ),
  );
  if (reference !== undefined) {
    if (
      typeof reference !== "string" ||
      !reference.startsWith("#/$defs/") ||
      ancestors.has(reference)
    )
      throw new Error("Unsupported response schema reference.");
    const definitions = root["$defs"] as Record<string, unknown>;
    const resolved = definitions[reference.slice("#/$defs/".length)];
    if (resolved === undefined)
      throw new Error("Unresolved response schema reference.");
    return {
      ...(expandedSchema(
        resolved,
        root,
        new Set([...ancestors, reference]),
      ) as Record<string, unknown>),
      ...(expandedSchema(rest, root, ancestors) as Record<string, unknown>),
    };
  }
  return Object.fromEntries(
    Object.entries(rest).map(([key, child]) => [
      key,
      expandedSchema(child, root, ancestors),
    ]),
  );
}
it("preserves the entire operations schema while sharing repeated definitions", () => {
  const original = z.toJSONSchema(modelOperationProposalResponseV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });
  const compact = getModelResponseToolV1("operations.propose").inputSchema;
  expect(expandedSchema(compact, compact)).toEqual(
    expandedSchema(original, original),
  );
  expect(JSON.stringify(compact).length).toBeLessThan(
    JSON.stringify(original).length / 3,
  );
});
