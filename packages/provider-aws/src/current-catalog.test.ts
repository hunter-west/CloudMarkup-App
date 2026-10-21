import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";
import {
  AWS_CURRENT_CATALOG_BINDING_V1,
  resolveAwsCurrentCatalogV1,
} from "./current-catalog.js";
describe("installed current AWS catalog", () => {
  it("binds all current services and service metadata to their verified digest", () => {
    const current = resolveAwsCurrentCatalogV1();
    expect(current.catalog).toBe(awsCatalogV1);
    expect(current.catalog.listServices()).toHaveLength(73);
    expect(current.catalog.listConnectionRules()).toHaveLength(139);
    expect(current.catalog.listValidationRules()).toHaveLength(34);
    expect(current.serviceExtension.artifact.catalog).toEqual(
      AWS_CURRENT_CATALOG_BINDING_V1,
    );
    expect(current.catalog.artifact.migrations).toEqual([]);
    for (const artifact of [
      current.catalog.artifact,
      current.serviceExtension.artifact,
    ]) {
      const { digest, ...content } = artifact;
      expect(digestCanonicalValue(content)).toBe(digest);
    }
  });
  it.each([
    { id: "other" },
    { version: "0.16.0" },
    { version: "0.29.0" },
    { digest: "sha256:" + "0".repeat(64) },
  ])("rejects unsupported or relabeled bindings %j", (change) => {
    expect(() =>
      resolveAwsCurrentCatalogV1({
        ...AWS_CURRENT_CATALOG_BINDING_V1,
        ...change,
      }),
    ).toThrow("review catalog compatibility");
  });
});
