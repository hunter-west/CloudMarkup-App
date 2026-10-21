import { readFile } from "node:fs/promises";

import {
  parseIntentDocumentV1Json,
  serializeIntentDocumentV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  IntentDocumentSemanticError,
  parseIntentDocument,
  validateIntentDocumentSemantics,
} from "./index.js";

async function readFixture(path: string): Promise<string> {
  return readFile(
    new URL(
      `../../test-fixtures/fixtures/intent-document/v1/${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

describe("Intent Document domain validation", () => {
  it("accepts and normalizes the representative Intent IR", async () => {
    const document = parseIntentDocument(
      JSON.parse(await readFixture("valid/representative.json")) as unknown,
    );

    expect(validateIntentDocumentSemantics(document)).toEqual([]);
    expect(
      document.application.capabilities.state === "known"
        ? document.application.capabilities.items.map((item) => item.id)
        : [],
    ).toEqual(["cap_api", "cap_kv", "cap_objects", "cap_queue"]);
    expect(
      serializeIntentDocumentV1(
        parseIntentDocument(
          JSON.parse(serializeIntentDocumentV1(document)) as unknown,
        ),
      ),
    ).toBe(serializeIntentDocumentV1(document));
  });

  it("accepts ambiguity when every unknown points to an unresolved question", async () => {
    const document = parseIntentDocument(
      JSON.parse(
        await readFixture("ambiguous/unknown-requirements.json"),
      ) as unknown,
    );

    expect(validateIntentDocumentSemantics(document)).toEqual([]);
    expect(document.application.capabilities.state).toBe("unknown");
    expect(
      document.unresolvedQuestions.some(
        (question) => question.classification === "blocking",
      ),
    ).toBe(true);
  });

  it("rejects the conflicting fixture with deterministic contradiction codes", async () => {
    const structurallyValid = parseIntentDocumentV1Json(
      await readFixture("conflicting/detectable-contradictions.json"),
    );
    const issues = validateIntentDocumentSemantics(structurallyValid);

    expect(issues.map((issue) => issue.code)).toEqual([
      "selected_alternative_state_mismatch",
      "invalid_retention_range",
      "conflicting_active_decisions",
      "unexpected_prompt_provenance",
      "non_monotonic_latency_targets",
      "invalid_scale_peak",
      "unresolved_decided_subject",
    ]);
    expect(() => parseIntentDocument(structurallyValid)).toThrow(
      IntentDocumentSemanticError,
    );
  });

  it("rejects unknown values whose unresolved-question reference is absent", async () => {
    const ambiguous = parseIntentDocumentV1Json(
      await readFixture("ambiguous/unknown-requirements.json"),
    );
    const withoutCapabilityQuestion = parseIntentDocumentV1Json(
      JSON.stringify({
        ...ambiguous,
        unresolvedQuestions: ambiguous.unresolvedQuestions.filter(
          (question) => question.id !== "question_capabilities",
        ),
      }),
    );

    expect(validateIntentDocumentSemantics(withoutCapabilityQuestion)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "broken_unknown_question_reference",
          path: "$.application.capabilities.questionId",
        }),
      ]),
    );
  });

  it("rejects duplicate capabilities and broken capability references", async () => {
    const valid = parseIntentDocumentV1Json(
      await readFixture("valid/representative.json"),
    );

    if (
      valid.application.capabilities.state !== "known" ||
      valid.connectivity.ingress.state !== "known"
    ) {
      throw new Error("Representative fixture must have known requirements.");
    }
    const firstCapability = valid.application.capabilities.items[0];
    if (firstCapability === undefined) {
      throw new Error("Representative fixture must have a capability.");
    }

    const invalid = parseIntentDocumentV1Json(
      JSON.stringify({
        ...valid,
        application: {
          ...valid.application,
          capabilities: {
            state: "known",
            items: [
              ...valid.application.capabilities.items,
              {
                ...firstCapability,
                id: "cap_duplicate_type",
              },
            ],
          },
        },
        connectivity: {
          ...valid.connectivity,
          ingress: {
            state: "known",
            items: valid.connectivity.ingress.items.map((requirement, index) =>
              index === 0
                ? {
                    ...requirement,
                    capabilityIds: [
                      ...requirement.capabilityIds,
                      "cap_missing",
                    ],
                  }
                : requirement,
            ),
          },
        },
      }),
    );

    expect(
      validateIntentDocumentSemantics(invalid).map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining([
        "broken_capability_reference",
        "duplicate_capability_type",
      ]),
    );
  });
});
