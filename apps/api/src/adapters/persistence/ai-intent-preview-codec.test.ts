import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  aiPreviewProofSchema,
  aiPreviewTokenSchema,
  parsePreviewBinding,
  previewJson,
} from "./ai-intent-preview-codec.js";
import { AiIntentPreviewError } from "../../application/ai-intent-preview-journal.js";
import { aiPreviewFixture } from "./ai-intent-preview-test-helpers.js";
import { PostgresAiIntentPreviewJournal } from "./ai-intent-preview.js";
import { loadMigrations } from "./migrations.js";
import type { SqlDatabase } from "./sql.js";

describe("strict memory-only preview metadata", () => {
  it("preserves the five immutable preview statements within the current migration chain", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    expect(migrations).toHaveLength(120);
    expect(
      migrations.reduce((count, item) => count + item.statements.length, 0),
    ).toBe(1367);
    const previewMigration = migrations.find(
      ({ version }) => version === "0026",
    );
    expect(previewMigration).toMatchObject({
      version: "0026",
      checksumSha256:
        "e85696f4671b59ac637bfc8cd40881c0f60909cdfbf5cbe5d67314e982a56b56",
    });
    expect(previewMigration?.statements).toHaveLength(5);
  });
  it("permits only a canonical32-byte unpadded proof and exact response fields", () => {
    for (const final of "AEIMQUYcgkosw048")
      expect(
        aiPreviewTokenSchema.safeParse("A".repeat(42) + final).success,
      ).toBe(true);
    for (const token of [
      "A".repeat(42),
      "A".repeat(44),
      "A".repeat(42) + "B",
      "A".repeat(42) + "=",
      "A".repeat(42) + "/",
    ])
      expect(aiPreviewTokenSchema.safeParse(token).success).toBe(false);
    const f = aiPreviewFixture();
    const proof = {
      contractVersion: 1,
      invocationId: f.binding.invocationId,
      outputDigest: f.binding.inputDigest,
      expiresAt: "2026-09-06T12:00:30.000Z",
      token: "A".repeat(43),
    };
    expect(aiPreviewProofSchema.safeParse(proof).success).toBe(true);
    expect(
      aiPreviewProofSchema.safeParse({
        ...proof,
        candidate: "No retained candidate",
      }).success,
    ).toBe(false);
  });
  it("strictly binds one Standard extraction and rejects content, unknown keys and cross-scope requests", () => {
    const f = aiPreviewFixture();
    expect(parsePreviewBinding(f.binding)).toEqual(f.binding);
    for (const candidate of [
      { ...f.binding, prompt: "Unaccepted prompt content" },
      { ...f.binding, request: { ...f.request, userId: "other-user" } },
      {
        ...f.binding,
        request: { ...f.request, requestedRoute: "deep" as const },
      },
      {
        ...f.binding,
        request: {
          ...f.request,
          plannedCalls: [...f.request.plannedCalls, ...f.request.plannedCalls],
        },
      },
    ])
      expect(() => parsePreviewBinding(candidate)).toThrow();
    expect(() => previewJson({ metadata: "x".repeat(9000) })).toThrow(
      AiIntentPreviewError,
    );
  });
  it("returns only safe adapter failures for malformed raw proof, claim and callback before SQL", async () => {
    const f = aiPreviewFixture();
    const query = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error("Unexpected SQL"));
    const transaction = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error("Unexpected SQL transaction"));
    const database: SqlDatabase = {
      query: () => query(),
      transaction: () => transaction(),
      close: () => Promise.resolve(),
    };
    const journal = new PostgresAiIntentPreviewJournal({
      database,
      binding: f.binding,
    });
    for (const operation of [
      () =>
        journal.acknowledge({
          contractVersion: 1,
          invocationId: f.binding.invocationId,
          outputDigest: f.binding.inputDigest,
          expiresAt: "sensitive-untrusted-value",
          token: "not-canonical",
        }),
      () => journal.claim({ ...f.claim, invocationId: "\nUntrusted content" }),
      () => journal.prepare({ rawPrompt: "Untrusted callback" } as never),
    ]) {
      await expect(operation()).rejects.toEqual(new AiIntentPreviewError());
    }
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
