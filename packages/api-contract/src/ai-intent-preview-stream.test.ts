import { describe, expect, it } from "vitest";
import {
  AI_INTENT_PREVIEW_STREAM_LIMITS_V1,
  aiIntentPreviewDeliveryProofV1Schema,
  aiIntentPreviewFrameV1Schema,
} from "./ai-intent-preview-stream.js";

const proof = {
  contractVersion: 1,
  invocationId: "preview_contract_synthetic",
  outputDigest: `sha256:${"a".repeat(64)}`,
  expiresAt: "2026-09-06T12:00:30.000Z",
  token: "A".repeat(43),
};

describe("memory-only preview wire contract", () => {
  it("declares fixed transport bounds without admission authority", () => {
    expect(AI_INTENT_PREVIEW_STREAM_LIMITS_V1).toEqual({
      candidateFrameBytes: 262144,
      totalBytes: 278528,
      heartbeatMilliseconds: 5000,
      backpressureMilliseconds: 5000,
      deadlineMilliseconds: 180000,
    });
    expect(Object.isFrozen(AI_INTENT_PREVIEW_STREAM_LIMITS_V1)).toBe(true);
    expect(aiIntentPreviewDeliveryProofV1Schema.parse(proof)).toEqual(proof);
  });

  it.each([
    "processing",
    "awaiting-acknowledgement",
    "result-unavailable",
    "finished",
    "unavailable",
  ])("allows only the closed %s status without arbitrary details", (code) => {
    const frame = { contractVersion: 1, type: "status", code };
    expect(aiIntentPreviewFrameV1Schema.parse(frame)).toEqual(frame);
    for (const extra of [
      { message: "details" },
      { id: "replay" },
      { retry: 1 },
    ])
      expect(
        aiIntentPreviewFrameV1Schema.safeParse({ ...frame, ...extra }).success,
      ).toBe(false);
  });

  it.each([
    { contractVersion: 2 },
    { invocationId: "../foreign" },
    { outputDigest: `sha256:${"A".repeat(64)}` },
    { expiresAt: "2026-09-06T12:00:30Z" },
    { expiresAt: "not-an-instant" },
    { token: "A".repeat(42) },
    { token: "A".repeat(42) + "B" },
    { token: "A".repeat(43) + "=" },
    { organizationId: "org_caller_assertion" },
  ])("rejects malformed or expanded proof %j", (change) => {
    expect(
      aiIntentPreviewDeliveryProofV1Schema.safeParse({ ...proof, ...change })
        .success,
    ).toBe(false);
  });

  it("rejects unknown status, versions, partial candidates and alternate operations", () => {
    for (const value of [
      { contractVersion: 1, type: "status", code: "paid" },
      { contractVersion: 2, type: "status", code: "processing" },
      { contractVersion: 1, type: "candidate", delivery: proof },
      {
        contractVersion: 1,
        type: "candidate",
        delivery: proof,
        candidate: { operation: "architecture.propose" },
      },
    ])
      expect(aiIntentPreviewFrameV1Schema.safeParse(value).success).toBe(false);
  });
});
