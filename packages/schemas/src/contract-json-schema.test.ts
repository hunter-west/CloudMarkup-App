import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contracts from "./index.js";
import {
  generateModelRoutingRequestV1JsonSchema,
  generateModelGatewayRequestV1JsonSchema,
  generateModelGatewayResponseV1JsonSchema,
  modelGatewayRequestV1Schema,
  modelGatewayResponseV1Schema,
  modelRoutingFeatureAuthorityV1,
  serializeCanonicalJson,
} from "./index.js";

describe("complete published JSON Schema contracts", () => {
  it("preserves every gateway constraint when shared definitions are expanded", () => {
    for (const [shape, generate] of [
      [modelGatewayRequestV1Schema, generateModelGatewayRequestV1JsonSchema],
      [modelGatewayResponseV1Schema, generateModelGatewayResponseV1JsonSchema],
    ] as const) {
      const generated = generate();
      const definitions = generated["$defs"] as Record<string, unknown>;
      expect(Object.keys(definitions).length).toBeGreaterThan(0);
      function expand(value: unknown, active: readonly string[] = []): unknown {
        if (Array.isArray(value))
          return value.map((item) => expand(item, active));
        if (value === null || typeof value !== "object") return value;
        const object = value as Record<string, unknown>;
        if (typeof object["$ref"] === "string") {
          const reference = object["$ref"];
          expect(Object.keys(object)).toEqual(["$ref"]);
          expect(reference).toMatch(/^#\/\$defs\/[^/]+$/);
          expect(active).not.toContain(reference);
          const name = reference.slice("#/$defs/".length);
          expect(Object.hasOwn(definitions, name)).toBe(true);
          return expand(definitions[name], [...active, reference]);
        }
        return Object.fromEntries(
          Object.entries(object)
            .filter(([key]) => value !== generated || key !== "$defs")
            .map(([key, item]) => [key, expand(item, active)]),
        );
      }
      const { $id, title } = generated;
      expect(expand(generated)).toEqual({
        ...z.toJSONSchema(shape, { io: "input", target: "draft-2020-12" }),
        $id,
        title,
      });
    }
  });

  it("matches every artifact to its source generator", async () => {
    const directory = new URL("../json-schema/", import.meta.url);
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".schema.json"))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const name =
        "generate" +
        file
          .replace(".schema.json", "")
          .split("-")
          .map((part) =>
            part === "cloudmarkup"
              ? "CloudMarkup"
              : part.charAt(0).toUpperCase() + part.slice(1),
          )
          .join("") +
        "JsonSchema";
      const generate = (contracts as Record<string, unknown>)[name];
      if (typeof generate !== "function")
        throw Error("Missing schema generator: " + file);
      const artifact: unknown = JSON.parse(
        await readFile(new URL(file, directory), "utf8"),
      );
      const generated: unknown = (generate as () => unknown)();
      expect(serializeCanonicalJson(artifact), file).toBe(
        serializeCanonicalJson(generated),
      );
      expect(JSON.stringify(artifact), file).not.toContain(
        "schemas.cloudcanvas.ai",
      );
      if (file === "model-host-seed-patch-response-v2.schema.json")
        expect(JSON.stringify(artifact)).not.toContain("proposedResultDigest");
      if (file === "architecture-document-v3.schema.json")
        expect(artifact).toMatchObject({
          $id: "https://schemas.cloudmarkup.com/architecture-document/v3.schema.json",
        });
    }
  });

  it("encodes every exact routing feature/class join in machine JSON Schema", () => {
    const schema = generateModelRoutingRequestV1JsonSchema();
    const allOf = schema.allOf as
      readonly { readonly oneOf?: readonly unknown[] }[] | undefined;
    const featureAuthority = allOf?.at(-1)?.oneOf;
    expect(featureAuthority).toHaveLength(
      Object.keys(modelRoutingFeatureAuthorityV1).length,
    );
    expect(featureAuthority).toContainEqual({
      properties: {
        expectedOutputClass: { const: "application-files" },
        feature: { const: "application-source.generate" },
        operationClass: { const: "code-generation" },
      },
      required: ["expectedOutputClass", "feature", "operationClass"],
    });
  });
});
