import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "./catalog-v1-accessors.js";
import {
  AWS_FROZEN_MODEL_CATALOG_BINDING_V1,
  AWS_FROZEN_WAF_MODEL_CATALOG_BINDING_V1,
  resolveAwsModelCatalogV1,
} from "./model-evaluation-catalog.js";
import {
  AWS_CURRENT_CATALOG_BINDING_V1,
  resolveAwsCurrentCatalogV1,
} from "./current-catalog.js";
import {
  awsValidationRulesV1,
  createAwsFrozenModelEvaluationRulesV1,
} from "./validation/index.js";
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
  it("keeps the exact historical model context separate from current catalog admission", () => {
    for (const [binding, counts] of [
      [AWS_FROZEN_MODEL_CATALOG_BINDING_V1, [71, 137, 33]],
      [AWS_FROZEN_WAF_MODEL_CATALOG_BINDING_V1, [73, 139, 34]],
    ] as const) {
      const historical = resolveAwsModelCatalogV1(binding);
      expect(resolveAwsModelCatalogV1(binding)).toBe(historical);
      expect(historical.catalog.listServices()).toHaveLength(counts[0]);
      expect(historical.catalog.listConnectionRules()).toHaveLength(counts[1]);
      expect(historical.catalog.listValidationRules()).toHaveLength(counts[2]);
      expect(
        historical.catalog.getService("aws.wafv2.web-acl") === undefined,
      ).toBe(counts[0] === 71);
      expect(historical.serviceExtension.artifact.catalog).toEqual(binding);
      for (const artifact of [
        historical.catalog.artifact,
        historical.serviceExtension.artifact,
      ]) {
        const { digest, ...content } = artifact;
        expect(digestCanonicalValue(content)).toBe(digest);
      }
      expect(historical.catalog.artifact.digest).not.toBe(
        AWS_CURRENT_CATALOG_BINDING_V1.digest,
      );
      expect(() => resolveAwsCurrentCatalogV1(binding)).toThrow(
        "review catalog compatibility",
      );
      for (const change of [
        { id: "other" },
        { version: "0.29.0" },
        { digest: "sha256:" + "f".repeat(64) },
      ])
        expect(() =>
          resolveAwsModelCatalogV1({ ...binding, ...change }),
        ).toThrow("unsupported AWS catalog");
    }
    expect(resolveAwsModelCatalogV1().catalog).toBe(awsCatalogV1);
  });
  it("uses only frozen descriptors for historical model assessment while retaining current rules", () => {
    const historical = resolveAwsModelCatalogV1(
      AWS_FROZEN_MODEL_CATALOG_BINDING_V1,
    ).catalog;
    expect(
      createAwsFrozenModelEvaluationRulesV1().map((rule) => rule.id),
    ).toEqual(
      awsValidationRulesV1
        .map((rule) => rule.id)
        .filter((id) => historical.getValidationRule(id) !== undefined),
    );
    expect(awsValidationRulesV1).toHaveLength(34);
    expect(createAwsFrozenModelEvaluationRulesV1()).toHaveLength(33);
  });
});
