import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelEvaluationDatasetV1Schema,
} from "@cloudmarkup/schemas";
import {
  frozenFullBetaEvaluationDatasetV1,
  fullBetaEvaluationCatalogV1,
} from "./full-beta-evaluation-dataset.js";
import {
  assertRegionalWafEvaluationCatalogV1,
  frozenRegionalWafEvaluationDatasetV1,
  regionalWafEvaluationCatalogV1,
  regionalWafEvaluationSourceDigestV1,
} from "./regional-waf-evaluation-source.js";

interface CatalogInput {
  digest: string;
  catalog: { id: string; version: string };
  services: {
    id: string;
    displayName: string;
    configuration: {
      schemaId: string;
      schemaVersion: string;
      jsonSchema: { properties: Record<string, unknown> };
    };
  }[];
}
const catalog = JSON.parse(
  readFileSync(
    new URL(
      "../../provider-aws/src/model-evaluation-source/catalog-73-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as CatalogInput;

describe("regional WAF catalog evaluation input successor", () => {
  it("binds the actual catalog and exact mirror while retaining historical cases and authority", () => {
    const mirrored: unknown = JSON.parse(
      readFileSync(
        new URL(
          "../../../evals/datasets-regional-waf-v1/regional-waf-evaluation-source-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(mirrored).toEqual({
      sourceDigest: regionalWafEvaluationSourceDigestV1,
      catalog: regionalWafEvaluationCatalogV1,
      dataset: frozenRegionalWafEvaluationDatasetV1,
    });
    expect(regionalWafEvaluationSourceDigestV1).toBe(
      "sha256:23cd9177a42331632673d7e60bbbe2789e84713ad5b343c35cb4964b102d15ae",
    );
    expect(frozenRegionalWafEvaluationDatasetV1.datasetDigest).toBe(
      "sha256:a045637294361644c027c9079f5b2b5745f8d744590a3b31655d61fddec623ee",
    );
    expect(frozenRegionalWafEvaluationDatasetV1.datasetVersion).toBe("1.8.0");
    expect(
      modelEvaluationDatasetV1Schema.safeParse(
        frozenRegionalWafEvaluationDatasetV1,
      ).success,
    ).toBe(true);
    expect(frozenRegionalWafEvaluationDatasetV1.cases).toEqual(
      frozenFullBetaEvaluationDatasetV1.cases,
    );
    expect(
      frozenRegionalWafEvaluationDatasetV1.requiredDeterministicDimensions,
    ).toEqual(
      frozenFullBetaEvaluationDatasetV1.requiredDeterministicDimensions,
    );
    expect(regionalWafEvaluationCatalogV1.services).toHaveLength(73);
    expect(fullBetaEvaluationCatalogV1.services).toHaveLength(71);
    for (const service of fullBetaEvaluationCatalogV1.services)
      expect(
        regionalWafEvaluationCatalogV1.services.find(
          (entry) => entry.id === service.id,
        ),
      ).toEqual(service);
    expect(
      regionalWafEvaluationCatalogV1.services
        .filter(
          (service) =>
            !fullBetaEvaluationCatalogV1.services.some(
              (previous) => previous.id === service.id,
            ),
        )
        .map(({ id }) => id),
    ).toEqual(["aws.wafv2.alb-association", "aws.wafv2.web-acl"]);
    expect(() => {
      assertRegionalWafEvaluationCatalogV1(catalog);
    }).not.toThrow();
    expect(Object.isFrozen(regionalWafEvaluationCatalogV1.services)).toBe(true);
    expect(
      Object.isFrozen(frozenRegionalWafEvaluationDatasetV1.cases[0]?.expected),
    ).toBe(true);
  });

  it("rejects stale and rehashed catalog substitutions across projected and unprojected fields", () => {
    const mutations: readonly ((value: CatalogInput) => void)[] = [
      (value) => {
        value.digest = fullBetaEvaluationCatalogV1.digest;
      },
      (value) => {
        value.catalog.version = "0.29.0";
      },
      (value) => {
        value.services = value.services.filter(
          ({ id }) => id !== "aws.wafv2.web-acl",
        );
      },
      (value) => {
        const first = value.services[0];
        if (first === undefined) throw Error("Synthetic catalog is empty.");
        value.services.push(structuredClone(first));
      },
      (value) => {
        const first = value.services[0];
        if (first === undefined) throw Error("Synthetic catalog is empty.");
        first.configuration.schemaVersion = "999.0.0";
      },
      (value) => {
        const first = value.services[0];
        if (first === undefined) throw Error("Synthetic catalog is empty.");
        first.configuration.jsonSchema.properties["unreviewed"] = {
          type: "string",
        };
      },
      (value) => {
        const first = value.services[0];
        if (first === undefined) throw Error("Synthetic catalog is empty.");
        first.displayName = "Unreviewed display value";
      },
    ];
    for (const mutate of mutations) {
      const modified = structuredClone(catalog);
      mutate(modified);
      expect(() => {
        assertRegionalWafEvaluationCatalogV1(modified);
      }).toThrow();
      const body = Object.fromEntries(
        Object.entries(modified).filter(([key]) => key !== "digest"),
      );
      modified.digest = digestCanonicalValue(body);
      // A digest-only substitution is repaired to the actual unchanged catalog;
      // every changed artifact still fails after its caller rehashes it.
      if (JSON.stringify(modified) !== JSON.stringify(catalog))
        expect(() => {
          assertRegionalWafEvaluationCatalogV1(modified);
        }).toThrow();
    }
  });
});
