import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  normalizeIntentDocumentV1,
  parseIntentDocumentV1,
  parseIntentDocumentV1Json,
  serializeIntentDocumentV1,
} from "./index.js";
import { IntentDocumentSchemaError } from "./intent-validation.js";

async function readFixture(path: string): Promise<string> {
  return readFile(
    new URL(
      `../../test-fixtures/fixtures/intent-document/v1/${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

describe("Intent Document v1 schema", () => {
  it("normalizes and round-trips the representative fixture deterministically", async () => {
    const input = await readFixture("valid/representative.json");
    const parsed = parseIntentDocumentV1Json(input);
    const normalized = normalizeIntentDocumentV1(parsed);
    const serialized = serializeIntentDocumentV1(parsed);
    const reparsed = parseIntentDocumentV1Json(serialized);

    expect(normalizeIntentDocumentV1(reparsed)).toEqual(normalized);
    expect(serializeIntentDocumentV1(reparsed)).toBe(serialized);
    expect(
      normalized.application.capabilities.state === "known"
        ? normalized.application.capabilities.items.map((item) => item.id)
        : [],
    ).toEqual(["cap_api", "cap_kv", "cap_objects", "cap_queue"]);
    expect(
      normalized.quality.latency.state === "known"
        ? normalized.quality.latency.targets.map((target) => target.percentile)
        : [],
    ).toEqual(["p50", "p95", "p99"]);
  });

  it("keeps explicit unknown values in an ambiguous document", async () => {
    const document = parseIntentDocumentV1Json(
      await readFixture("ambiguous/unknown-requirements.json"),
    );

    expect(document.application.capabilities).toEqual(
      expect.objectContaining({
        state: "unknown",
        questionId: "question_capabilities",
      }),
    );
    expect(document.unresolvedQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "blocking",
          id: "question_capabilities",
        }),
        expect.objectContaining({
          classification: "non-blocking",
          id: "question_cost",
        }),
      ]),
    );
  });

  it("rejects provider service IDs in capability fields", async () => {
    const input = await readFixture("invalid/provider-service-capability.json");

    expect.assertions(4);
    try {
      parseIntentDocumentV1Json(input);
    } catch (error) {
      expect(error).toBeInstanceOf(IntentDocumentSchemaError);
      const schemaError = error as IntentDocumentSchemaError;
      expect(schemaError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.application.capabilities.items[0].capability",
          }),
        ]),
      );
      expect(schemaError.message).toContain(
        "$.application.capabilities.items[0].capability",
      );
      expect(schemaError.message).not.toContain("aws.lambda");
    }
  });

  it("rejects unsupported versions and model-provider provenance fields", async () => {
    const valid = parseIntentDocumentV1Json(
      await readFixture("valid/representative.json"),
    );

    expect(() =>
      parseIntentDocumentV1({
        ...valid,
        schemaVersion: 2,
      }),
    ).toThrow(IntentDocumentSchemaError);

    expect(() =>
      parseIntentDocumentV1({
        ...valid,
        metadata: {
          ...valid.metadata,
          provenance: {
            ...valid.metadata.provenance,
            prompt: {
              ...valid.metadata.provenance.prompt,
              modelProvider: "example-provider",
            },
          },
        },
      }),
    ).toThrow(IntentDocumentSchemaError);
  });
});
