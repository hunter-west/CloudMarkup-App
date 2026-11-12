import { readFile } from "node:fs/promises";

import { intentDocumentV1Schema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { modelIntentResultV1Schema } from "./model-intent.js";

async function validIntentDocument() {
  return intentDocumentV1Schema.parse(
    JSON.parse(
      await readFile(
        new URL(
          "../../test-fixtures/fixtures/intent-document/v1/valid/representative.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
  );
}

function completedCommercial() {
  return {
    compensationStatus: "not-required" as const,
    completedCreditUnits: 2,
    contractVersion: 1 as const,
    denialReason: null,
    estimate: {
      maximumCreditUnits: 4,
      minimumCreditUnits: 1,
      requiresConfirmation: false,
    },
    reconciliationState: "not-required" as const,
    reservation: {
      reservationId: "reservation_intent_contract",
      status: "accepted" as const,
    },
    route: {
      explanation: "Configured Standard analysis for requirements.",
      label: "Standard Design" as const,
      route: "standard" as const,
    },
    state: "completed" as const,
    technicalUnits: {
      cacheReadUnits: 2,
      cacheWriteUnits: 1,
      inputUnits: 10,
      outputUnits: 5,
      providerSpecificUnits: [],
      totalUnits: 18,
    },
  };
}

describe("Prompt 35 safe Intent API/UI contract", () => {
  it("returns clarification, route, credits, safe provenance, and optional technical usage in one flow", async () => {
    const parsed = modelIntentResultV1Schema.parse({
      assumptions: [],
      commercial: completedCommercial(),
      contractVersion: 1,
      intentDocument: null,
      issues: [
        {
          category: "ambiguity",
          issueId: "issue_requirement_ambiguity",
          message: "A required retention period remains unknown.",
          severity: "warning",
        },
      ],
      operation: "requirements.blocking-questions",
      provenance: {
        inferenceProfileId: "configured.profile.standard",
        invocationId: "invocation_intent_contract",
        jobId: "job_intent_contract",
        modelId: "configured.model.standard",
        modelVersion: "configured-standard-version",
        promptTemplateId: "cloudmarkup.prompt.architecture-planning",
        promptVersion: "1.1.0",
        providerId: "cloudmarkup.amazon-bedrock",
        route: "standard",
        routeId: "standard-design",
        stopReason: "end_turn",
      },
      questions: [
        {
          classification: "blocking",
          question: "What retention period is required?",
          questionId: "question_retention",
          rationale: "Retention changes the accepted requirements.",
        },
      ],
    });
    expect(parsed.commercial.completedCreditUnits).toBe(2);
    expect(parsed.commercial.technicalUnits?.totalUnits).toBe(18);
    expect(parsed.provenance?.modelId).toBe("configured.model.standard");
    expect(parsed).not.toHaveProperty("estimatedProviderCostMicros");
    expect(parsed).not.toHaveProperty("operatingBufferBasisPoints");
    expect(parsed).not.toHaveProperty("rawPrompt");
    expect(parsed).not.toHaveProperty("rawResponse");

    const extraction = {
      ...parsed,
      intentDocument: await validIntentDocument(),
      operation: "intent.extract",
    };
    expect(modelIntentResultV1Schema.parse(extraction).intentDocument).toEqual(
      extraction.intentDocument,
    );
    expect(
      modelIntentResultV1Schema.safeParse({
        ...extraction,
        intentDocument: null,
      }).success,
    ).toBe(false);
  });

  it("represents a stable commercial denial without provider provenance or model output", async () => {
    const parsed = modelIntentResultV1Schema.parse({
      assumptions: [],
      commercial: {
        compensationStatus: "not-required",
        completedCreditUnits: null,
        contractVersion: 1,
        denialReason: "insufficient-credits",
        estimate: {
          maximumCreditUnits: 4,
          minimumCreditUnits: 1,
          requiresConfirmation: false,
        },
        reconciliationState: "not-required",
        reservation: { status: "not-requested" },
        route: {
          explanation: "Configured Standard analysis for requirements.",
          label: "Standard Design",
          route: "standard",
        },
        state: "denied",
        technicalUnits: null,
      },
      contractVersion: 1,
      intentDocument: null,
      issues: [
        {
          category: "commercial-denial",
          issueId: "issue_insufficient_credits",
          message: "The credit reservation was not accepted.",
          severity: "blocking",
        },
      ],
      operation: "intent.extract",
      provenance: null,
      questions: [],
    });
    expect(parsed.provenance).toBeNull();
    expect(parsed.intentDocument).toBeNull();

    const deniedOutput = modelIntentResultV1Schema.safeParse({
      ...parsed,
      intentDocument: await validIntentDocument(),
    });
    expect(deniedOutput.success).toBe(false);
    if (deniedOutput.success)
      throw new TypeError("Denied model output must be rejected.");
    expect(deniedOutput.error.issues).toEqual([
      expect.objectContaining({
        code: "custom",
        message:
          "Only a provider-completed Intent extraction carries an Intent document.",
        path: ["intentDocument"],
      }),
    ]);
  });

  it("rejects secret pricing fields and mismatched route provenance", () => {
    const input = {
      assumptions: [],
      commercial: completedCommercial(),
      contractVersion: 1,
      intentDocument: null,
      issues: [],
      operation: "requirements.blocking-questions",
      provenance: {
        inferenceProfileId: "configured.profile.standard",
        invocationId: "invocation_intent_contract",
        jobId: "job_intent_contract",
        modelId: "configured.model.standard",
        modelVersion: "configured-standard-version",
        promptTemplateId: "cloudmarkup.prompt.architecture-planning",
        promptVersion: "1.1.0",
        providerId: "cloudmarkup.amazon-bedrock",
        route: "standard",
        routeId: "standard-design",
        stopReason: "end_turn",
      },
      questions: [],
    };
    expect(modelIntentResultV1Schema.safeParse(input).success).toBe(true);

    const pricing = modelIntentResultV1Schema.safeParse({
      ...input,
      commercial: {
        ...input.commercial,
        operatingBufferBasisPoints: 1_000,
      },
    });
    expect(pricing.success).toBe(false);
    if (pricing.success)
      throw new TypeError("Pricing mutation must be rejected.");
    expect(pricing.error.issues).toEqual([
      expect.objectContaining({
        code: "unrecognized_keys",
        keys: ["operatingBufferBasisPoints"],
        path: ["commercial"],
      }),
    ]);

    const route = modelIntentResultV1Schema.safeParse({
      ...input,
      provenance: { ...input.provenance, route: "deep" },
    });
    expect(route.success).toBe(false);
    if (route.success) throw new TypeError("Route mutation must be rejected.");
    expect(route.error.issues).toEqual([
      expect.objectContaining({
        code: "custom",
        message:
          "Provider provenance must match the commercially authorized route.",
        path: ["provenance", "route"],
      }),
    ]);
  });
});
