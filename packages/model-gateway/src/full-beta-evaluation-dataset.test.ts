import {
  digestCanonicalValue,
  modelEvaluationCaseKindV1Values,
  modelEvaluationDatasetV1Schema,
} from "@cloudmarkup/schemas";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertFullBetaEvaluationCatalogV1,
  frozenFullBetaEvaluationDatasetV1,
  fullBetaEvaluationCatalogV1,
  fullBetaEvaluationSourceDigestV1,
} from "./full-beta-evaluation-dataset.js";
import {
  frozenModelEvaluationDatasetV1,
  modelEvaluationOperationalBudgetsV1,
} from "./model-evaluation.js";
import { assertRegionalWafEvaluationCatalogV1 } from "./regional-waf-evaluation-source.js";
const catalog: unknown = JSON.parse(
  readFileSync(
    new URL("../../provider-aws/src/compiled/catalog-v1.json", import.meta.url),
    "utf8",
  ),
);
const historicalCatalog: unknown = JSON.parse(
  readFileSync(
    new URL(
      "../../provider-aws/src/model-evaluation-source/catalog-71-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const historicalWafCatalog: unknown = JSON.parse(
  readFileSync(
    new URL(
      "../../provider-aws/src/model-evaluation-source/catalog-73-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
describe("frozen full beta evaluation source", () => {
  it("keeps the checked source mirror byte-derived from canonical metadata", () => {
    const mirrored: unknown = JSON.parse(
      readFileSync(
        new URL(
          "../../../evals/datasets-full-beta-v1/full-beta-evaluation-source-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(mirrored).toEqual({
      sourceDigest: fullBetaEvaluationSourceDigestV1,
      catalog: fullBetaEvaluationCatalogV1,
      dataset: frozenFullBetaEvaluationDatasetV1,
    });
  });

  it("retains all 21 families and includes the normal Intent tuple without rewriting historical cases or budgets", () => {
    const dataset = frozenFullBetaEvaluationDatasetV1;
    expect(dataset.datasetVersion).toBe("1.5.0");
    expect(frozenModelEvaluationDatasetV1.cases).toHaveLength(21);
    expect(frozenModelEvaluationDatasetV1.datasetVersion).toBe("1.0.0");
    expect(modelEvaluationDatasetV1Schema.safeParse(dataset).success).toBe(
      true,
    );
    expect(dataset.cases.map((c) => c.caseKind).sort()).toEqual(
      [...modelEvaluationCaseKindV1Values].sort(),
    );
    expect(
      dataset.cases.find((c) => c.caseKind === "vague-conflicting-requirements")
        ?.expected.authorityRequirement,
    ).toEqual({
      operation: "intent.extract",
      role: "low-cost-extraction-help",
    });
    expect(frozenModelEvaluationDatasetV1.datasetDigest).toBe(
      "sha256:0dc44ea34d37017ffdf38b331ef823d4dcfd1549d9a6d6d8e1dbef3f5c2673a4",
    );
    expect(modelEvaluationOperationalBudgetsV1).toEqual({
      credits: 100,
      "estimated-cost": 10000,
      latency: 1000,
      tokens: 5000,
    });
    expect(fullBetaEvaluationSourceDigestV1).toBe(
      digestCanonicalValue({ dataset, catalog: fullBetaEvaluationCatalogV1 }),
    );
    expect(Object.isFrozen(dataset.cases[0]?.expected)).toBe(true);
    expect(
      Object.isFrozen(
        fullBetaEvaluationCatalogV1.services[0]?.configurationKeys,
      ),
    ).toBe(true);
  });
  it("preserves both historical evaluation inputs without admitting the changed installed catalog", () => {
    expect(() => {
      assertFullBetaEvaluationCatalogV1(historicalCatalog);
    }).not.toThrow();
    expect(() => {
      assertRegionalWafEvaluationCatalogV1(historicalWafCatalog);
    }).not.toThrow();
    expect(() => {
      assertRegionalWafEvaluationCatalogV1(catalog);
    }).toThrow();
    expect(() => {
      assertFullBetaEvaluationCatalogV1(catalog);
    }).toThrow();
    expect(fullBetaEvaluationCatalogV1.services).toHaveLength(71);
    const cases = frozenFullBetaEvaluationDatasetV1.cases;
    expect(
      cases.find((c) => c.caseKind === "private-vpc-application")?.expected,
    ).toMatchObject({
      disposition: "accept-proposal",
      generationTarget: "none",
      deterministicCompilerPreferred: true,
    });
    expect(
      cases.find((c) => c.caseKind === "event-driven-image-processing")
        ?.expected,
    ).toMatchObject({
      disposition: "retain-unresolved",
      generationTarget: "none",
      requiredSafetyOutcomes: [
        "allow-listed-operations-only",
        "unresolved-honestly",
      ],
    });
  });
  it.each([
    "old-catalog",
    "missing-service",
    "extra-field",
    "changed-schema",
    "rehashed-schema",
  ])("rejects %s drift before source preparation", (change) => {
    for (const [source, assertCatalog] of [
      [historicalWafCatalog, assertRegionalWafEvaluationCatalogV1],
      [historicalCatalog, assertFullBetaEvaluationCatalogV1],
    ] as const) {
      const modified = JSON.parse(JSON.stringify(source)) as {
        digest: string;
        catalog: { version: string };
        services: {
          configuration: {
            schemaVersion: string;
            jsonSchema: { properties: Record<string, unknown> };
          };
        }[];
      };
      const first = modified.services[0];
      if (first === undefined) throw Error("Missing catalog service");
      if (change === "old-catalog") modified.catalog.version = "0.10.0";
      else if (change === "missing-service") modified.services.pop();
      else if (change === "extra-field")
        first.configuration.jsonSchema.properties["inventedField"] = {
          type: "string",
        };
      else first.configuration.schemaVersion = "99.0.0";
      if (change === "rehashed-schema") {
        const body = Object.fromEntries(
          Object.entries(modified).filter(([key]) => key !== "digest"),
        );
        modified.digest = digestCanonicalValue(body);
      }
      expect(() => {
        assertCatalog(modified);
      }).toThrow();
    }
  });
});

it("binds private network to executable graph proposals", () => {
  expect(
    frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseKind === "private-vpc-application",
    )?.expected.authorityRequirement,
  ).toEqual({
    operation: "operations.propose",
    role: "standard-planning-generation",
  });
});

it("binds both bounded-refusal cases to executable operations", () => {
  for (const kind of [
    "nonexistent-unsupported-services",
    "excessive-resource-request",
  ])
    expect(
      frozenFullBetaEvaluationDatasetV1.cases.find((c) => c.caseKind === kind)
        ?.expected.authorityRequirement,
    ).toEqual({
      operation: "operations.propose",
      role: "standard-planning-generation",
    });
});

it("preserves source 1.4.0 while making event and external proposals executable", () => {
  const bytes = readFileSync(
    new URL(
      "../../../evals/datasets-full-beta-v1/history/full-beta-evaluation-source-1.4.0.json",
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "3dc13aa4a405f55b7a99852cdbec440cb6dcb506b545ee9740fd990ba0a1f193",
  );
  for (const caseKind of [
    "event-driven-image-processing",
    "external-existing-resource",
  ]) {
    const current = frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseKind === caseKind,
    );
    const archived = JSON.parse(bytes.toString("utf8")) as { dataset: unknown };
    const previous = modelEvaluationDatasetV1Schema
      .parse(archived.dataset)
      .cases.find((c) => c.caseKind === caseKind);
    if (!previous) throw Error("Missing historical case");
    expect(current?.expected.authorityRequirement).toEqual({
      operation: "operations.propose",
      role: "standard-planning-generation",
    });
    expect(current?.input).toEqual(previous.input);
    expect(current?.targetDimensions).toEqual(previous.targetDimensions);
    expect(current?.expected.expectedIssueSeverity).toBe(
      previous.expected.expectedIssueSeverity,
    );
  }
});
