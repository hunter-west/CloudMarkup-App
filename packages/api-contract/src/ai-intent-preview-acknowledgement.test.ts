import { describe, expect, it } from "vitest";

import {
  acknowledgeAiIntentPreviewV1Schema,
  aiIntentPreviewAcknowledgementQueryV1Schema,
  aiIntentPreviewAcknowledgementResponseV1Schema,
} from "./ai-intent-preview-acknowledgement.js";
import { apiOperationsV1 } from "./operations.js";

const input = {
  contractVersion: 1,
  delivery: {
    contractVersion: 1,
    invocationId: "invocation_test",
    outputDigest: `sha256:${"a".repeat(64)}`,
    expiresAt: "2026-09-07T15:30:00.000Z",
    token: "A".repeat(43),
  },
  editingProof: {
    leaseId: "projectlease_12345678-1234-4234-8234-123456789abc",
    token: "Q".repeat(42) + "A",
  },
};

describe("metadata-only AI preview ACK contract", () => {
  it("accepts exactly an issued delivery and current tab proof", () => {
    expect(acknowledgeAiIntentPreviewV1Schema.parse(input)).toEqual(input);
    expect(
      aiIntentPreviewAcknowledgementResponseV1Schema.parse({
        apiVersion: "v1",
        data: { contractVersion: 1, state: "acknowledged" },
      }),
    ).toEqual({
      apiVersion: "v1",
      data: { contractVersion: 1, state: "acknowledged" },
    });
  });
  it.each(["organizationId", "principalId", "candidate"])(
    "rejects caller-supplied %s",
    (field) => {
      expect(
        acknowledgeAiIntentPreviewV1Schema.safeParse({
          ...input,
          [field]: "untrusted",
        }).success,
      ).toBe(false);
    },
  );
  it("rejects changed contracts and noncanonical or incomplete proofs", () => {
    for (const value of [
      { ...input, contractVersion: 2 },
      { ...input, delivery: { ...input.delivery, contractVersion: 2 } },
      {
        ...input,
        delivery: { ...input.delivery, expiresAt: "2026-09-07T15:30:00Z" },
      },
      {
        ...input,
        delivery: { ...input.delivery, token: "A".repeat(42) + "B" },
      },
      {
        ...input,
        editingProof: { ...input.editingProof, token: "A".repeat(42) },
      },
      {
        ...input,
        editingProof: { ...input.editingProof, sessionId: "untrusted" },
      },
      { ...input, delivery: { ...input.delivery, candidate: "untrusted" } },
    ])
      expect(acknowledgeAiIntentPreviewV1Schema.safeParse(value).success).toBe(
        false,
      );
  });
  it("defines a protected POST with no query authority or proof-bearing URL", () => {
    expect(apiOperationsV1["ai-intent-previews.acknowledge"]).toMatchObject({
      method: "POST",
      security: "principal",
      successStatus: 200,
      path: "/v1/projects/:projectId/ai-intent-previews/acknowledgement",
    });
    expect(aiIntentPreviewAcknowledgementQueryV1Schema.parse({})).toEqual({});
    expect(
      aiIntentPreviewAcknowledgementQueryV1Schema.safeParse({
        token: input.delivery.token,
      }).success,
    ).toBe(false);
    expect(
      aiIntentPreviewAcknowledgementResponseV1Schema.safeParse({
        apiVersion: "v1",
        data: { contractVersion: 1, state: "accepted" },
      }).success,
    ).toBe(false);
    expect(
      aiIntentPreviewAcknowledgementResponseV1Schema.safeParse({
        apiVersion: "v1",
        data: {
          contractVersion: 1,
          state: "acknowledged",
          token: input.delivery.token,
        },
      }).success,
    ).toBe(false);
  });
});
