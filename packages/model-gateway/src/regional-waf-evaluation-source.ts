import { z } from "zod";
import {
  digestCanonicalValue,
  digestModelEvaluationDatasetV1,
  modelEvaluationDatasetV1Schema,
  semanticVersionSchema,
} from "@cloudmarkup/schemas";

import { frozenFullBetaEvaluationDatasetV1 } from "./full-beta-evaluation-dataset.js";
import { regionalWafEvaluationCatalogProjectionV1 } from "./regional-waf-evaluation-catalog.js";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Separate input authority only. No current report policy, runtime route,
 * budget, observation, invocation or promotion is created or replaced. */
export const regionalWafEvaluationCatalogV1 = freeze(
  regionalWafEvaluationCatalogProjectionV1,
);

const { datasetDigest: predecessorDigest, ...predecessor } =
  frozenFullBetaEvaluationDatasetV1;
if (digestModelEvaluationDatasetV1(predecessor) !== predecessorDigest)
  throw Error("The frozen full-beta predecessor dataset is invalid.");

const body = {
  ...predecessor,
  datasetVersion: semanticVersionSchema.parse("1.8.0"),
};

/** Preserves all 21 historical case definitions, authority requirements,
 * dimensions and expectations. New catalog context still requires fresh exact
 * invocation inputs and evaluation; these data do not admit an old report. */
export const frozenRegionalWafEvaluationDatasetV1 = freeze(
  modelEvaluationDatasetV1Schema.parse({
    ...body,
    datasetDigest: digestModelEvaluationDatasetV1(body),
  }),
);

export const regionalWafEvaluationSourceDigestV1 = digestCanonicalValue({
  catalog: regionalWafEvaluationCatalogV1,
  dataset: frozenRegionalWafEvaluationDatasetV1,
});

const catalogSource = z
  .object({
    digest: z.string(),
    catalog: z.object({ id: z.string(), version: z.string() }).loose(),
    services: z.array(
      z
        .object({
          id: z.string(),
          configuration: z
            .object({
              schemaId: z.string(),
              schemaVersion: z.string(),
              jsonSchema: z
                .object({ properties: z.record(z.string(), z.unknown()) })
                .loose(),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .loose();

/** Rehashes the complete actual artifact and exact frozen 73-service projection.
 * A caller-supplied digest, service count or rehashed substitute is insufficient.
 * Offline input consistency only; never a report/promotion/admission authority. */
export function assertRegionalWafEvaluationCatalogV1(value: unknown): void {
  const parsed = catalogSource.parse(value);
  const { digest, ...content } = parsed;
  const selected = {
    id: parsed.catalog.id,
    version: parsed.catalog.version,
    digest,
    services: parsed.services.map((service) => ({
      id: service.id,
      configurationSchemaId: service.configuration.schemaId,
      configurationSchemaVersion: service.configuration.schemaVersion,
      configurationKeys: Object.keys(
        service.configuration.jsonSchema.properties,
      ).sort(),
    })),
  };
  if (
    digestCanonicalValue(content) !== digest ||
    digestCanonicalValue(selected) !==
      digestCanonicalValue(regionalWafEvaluationCatalogV1)
  )
    throw Error(
      "The installed catalog differs from the regional WAF evaluation input source.",
    );
}
