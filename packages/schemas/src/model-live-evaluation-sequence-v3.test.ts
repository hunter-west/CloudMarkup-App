import { describe, expect, it } from "vitest";
import { digestCanonicalValue } from "./canonical-digest.js";
import { generateModelLiveEvaluationSequenceV3JsonSchema } from "./contract-json-schema.js";
import {
  MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3,
  modelLiveEvaluationSequenceRecordV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceOutcomeV3Schema,
} from "./model-live-evaluation-sequence-v3.js";

const digest = (name: string) =>
  digestCanonicalValue({ syntheticMetadata: name });
function rehash<T extends object>(value: T, key: string): T {
  return {
    ...value,
    [key]: digestCanonicalValue(
      Object.fromEntries(
        Object.entries(value).filter(([name]) => name !== key),
      ),
    ),
  };
}
function preparedInput() {
  return rehash(
    {
      contractVersion: 3,
      recordKind: "model-live-sequence-input",
      selectionId: `live_sequence_${"a".repeat(32)}`,
      selectionDigest: digest("selection"),
      planDigest: digest("plan"),
      caseId: "evaluation_case_repair_success_full_beta_v1",
      caseDigest:
        "sha256:26e82404d35aea55037641eabad0cc378c9bb3de4e61178255dd9366313600f6",
      stageKey: "repair-1",
      stageId: `live_stage_${"b".repeat(32)}`,
      invocationId: `invocation_${"c".repeat(32)}`,
      inputBindingDigest: digest("unhashed"),
      recipeDigest: MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3,
      authorityTupleDigest: digest("authority"),
      operationInputDigest: digest("operation-input"),
      preparedPayloadDigest: digest("complete-prepared-payload"),
      diagnosticsDigest: digest("complete-sanitized-diagnostics"),
      revisionDigest: digest("revision"),
      ownershipDigest: digest("ownership"),
      predecessor: {
        kind: "seed",
        candidateDigest: digest("candidate"),
        validationReceiptDigest: digest("validation-receipt"),
      },
      issuedAt: "2026-09-12T12:00:00.000Z",
    },
    "inputBindingDigest",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected JSON Schema object.");
  return value as Record<string, unknown>;
}
function branches(value: unknown): readonly Record<string, unknown>[] {
  const schema = record(value);
  const options = schema["anyOf"] ?? schema["oneOf"];
  return Array.isArray(options) ? options.flatMap(branches) : [schema];
}

describe("additive persisted V3 sequence compatibility", () => {
  it("publishes only seven closed V3 record kinds and all four explicit outcome variants", () => {
    const schema = generateModelLiveEvaluationSequenceV3JsonSchema();
    expect(schema["$id"]).toBe(
      "https://schemas.cloudmarkup.com/model-live-evaluation-sequence/v3.schema.json",
    );
    const leaves = branches(schema);
    expect(leaves).toHaveLength(10);
    const kinds = new Set<string>();
    const outcomes: string[] = [];
    for (const leaf of leaves) {
      expect(leaf["additionalProperties"]).toBe(false);
      const properties = record(leaf["properties"]);
      expect(record(properties["contractVersion"])["const"]).toBe(3);
      const kind = record(properties["recordKind"])["const"];
      expect(typeof kind).toBe("string");
      kinds.add(String(kind));
      expect(properties).not.toHaveProperty("prompt");
      expect(properties).not.toHaveProperty("candidate");
      expect(properties).not.toHaveProperty("report");
      if (kind === "model-live-sequence-outcome") {
        const status = record(properties["status"])["const"];
        outcomes.push(String(status));
        if (status === "dispatch-unknown" || status === "not-dispatched") {
          expect(properties).not.toHaveProperty("normalizedUsageDigest");
          expect(properties).not.toHaveProperty("commercialTerminalDigest");
        }
      }
    }
    expect([...kinds].sort()).toEqual([
      "model-live-sequence-approval",
      "model-live-sequence-definition",
      "model-live-sequence-dispatch",
      "model-live-sequence-input",
      "model-live-sequence-outcome",
      "model-live-sequence-plan",
      "model-live-sequence-selection",
    ]);
    expect(outcomes.sort()).toEqual([
      "dispatch-unknown",
      "not-dispatched",
      "provider-failed",
      "validated",
    ]);
  });
  it("retains exact canonical metadata through the additive classifier", () => {
    const input = preparedInput();
    expect(modelLiveSequenceInputV3Schema.parse(input)).toEqual(input);
    expect(modelLiveEvaluationSequenceRecordV3Schema.parse(input)).toEqual(
      input,
    );
  });
  it.each([1, 2])(
    "rejects a coherently rehashed historical version %s as V3",
    (contractVersion) => {
      expect(
        modelLiveEvaluationSequenceRecordV3Schema.safeParse(
          rehash({ ...preparedInput(), contractVersion }, "inputBindingDigest"),
        ).success,
      ).toBe(false);
    },
  );
  it.each(["prompt", "candidate", "diagnostics"])(
    "rejects raw %s even after recomputing the input digest",
    (field) => {
      const changed = rehash(
        { ...preparedInput(), [field]: "synthetic content must not be stored" },
        "inputBindingDigest",
      );
      expect(
        modelLiveEvaluationSequenceRecordV3Schema.safeParse(changed).success,
      ).toBe(false);
    },
  );
  it("requires all complete-input fields and detects independent tampering", () => {
    const input = preparedInput();
    const withoutPayload = Object.fromEntries(
      Object.entries(input).filter(([key]) => key !== "preparedPayloadDigest"),
    );
    expect(
      modelLiveSequenceInputV3Schema.safeParse(
        rehash(withoutPayload, "inputBindingDigest"),
      ).success,
    ).toBe(false);
    expect(
      modelLiveSequenceInputV3Schema.safeParse({
        ...input,
        preparedPayloadDigest: digest("substituted-payload"),
      }).success,
    ).toBe(false);
  });
  it("does not let unknown dispatch masquerade as reconciled zero usage", () => {
    const input = preparedInput();
    const unknown = rehash(
      {
        contractVersion: 3,
        recordKind: "model-live-sequence-outcome",
        selectionId: input.selectionId,
        selectionDigest: input.selectionDigest,
        planDigest: input.planDigest,
        caseId: input.caseId,
        caseDigest: input.caseDigest,
        stageKey: input.stageKey,
        stageId: input.stageId,
        invocationId: input.invocationId,
        outcomeDigest: digest("unhashed"),
        observedAt: "2026-09-12T12:00:01.000Z",
        status: "dispatch-unknown",
        inputBindingDigest: input.inputBindingDigest,
        dispatchDigest: digest("actual-dispatch"),
        reason: "missing-usage",
      },
      "outcomeDigest",
    );
    expect(modelLiveSequenceOutcomeV3Schema.parse(unknown)).toEqual(unknown);
    expect(
      modelLiveEvaluationSequenceRecordV3Schema.safeParse(
        rehash(
          {
            ...unknown,
            normalizedUsageDigest: digest("pretend-zero"),
            commercialTerminalDigest: digest("pretend-settlement"),
          },
          "outcomeDigest",
        ),
      ).success,
    ).toBe(false);
  });
});
