import { describe, expect, it } from "vitest";
import { createProductionAiIntentPreview } from "./production-ai-intent-preview.js";
import { deniedPreviewFactoryFixture } from "./production-ai-intent-preview-test-helpers.js";
import { AiIntentPreviewError } from "./application/ai-intent-preview-journal.js";

describe("memory-only production Intent factory fail-closed boundaries", () => {
  it.each([
    {},
    { expiresAt: "2020-01-01T00:00:00.000Z" },
    { expiresAt: "2099-01-01T00:00:00Z" },
    { expiresAt: "2099-01-01T00:00:00.000Z", extra: true },
    { expiresAt: "2099-01-01T00:00:00.000Z", [Symbol("hidden")]: true },
    new (class {
      expiresAt = "2099-01-01T00:00:00.000Z";
    })(),
  ])(
    "rejects noncanonical or non-data-only host expiry before SQL %j",
    async (proof) => {
      const f = deniedPreviewFactoryFixture();
      f.authorize.mockResolvedValueOnce(proof as { expiresAt: string });
      await expect(
        createProductionAiIntentPreview(f.input),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(f.unexpected).not.toHaveBeenCalled();
      expect(f.resolve).not.toHaveBeenCalled();
    },
  );
  it("does not evaluate a host proof accessor", async () => {
    const f = deniedPreviewFactoryFixture();
    let read = false;
    const proof = {
      get expiresAt() {
        read = true;
        return "2099-01-01T00:00:00.000Z";
      },
    };
    f.authorize.mockResolvedValueOnce(proof);
    await expect(
      createProductionAiIntentPreview(f.input),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(read).toBe(false);
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it("requires current host authentication before any SQL, resolver or provider action", async () => {
    const f = deniedPreviewFactoryFixture();
    f.authorize.mockRejectedValueOnce(new AiIntentPreviewError());
    await expect(
      createProductionAiIntentPreview(f.input),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.authorize).toHaveBeenCalledOnce();
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it("rejects an aborted request without authentication or SQL", async () => {
    const f = deniedPreviewFactoryFixture();
    await expect(
      createProductionAiIntentPreview({
        ...f.input,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it("rechecks cancellation after asynchronous authentication", async () => {
    const f = deniedPreviewFactoryFixture();
    const cancellation = new AbortController();
    f.authorize.mockImplementationOnce(() => {
      cancellation.abort();
      return Promise.resolve({
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });
    });
    await expect(
      createProductionAiIntentPreview({
        ...f.input,
        signal: cancellation.signal,
      }),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it.each(["organizationId", "projectId", "userId"] as const)(
    "rejects cross-scope %s before host or SQL",
    async (key) => {
      const f = deniedPreviewFactoryFixture();
      const invocation = structuredClone(f.input.invocation);
      invocation.descriptor.scope[key] = "different_identity";
      await expect(
        createProductionAiIntentPreview({ ...f.input, invocation }),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(f.authorize).not.toHaveBeenCalled();
      expect(f.unexpected).not.toHaveBeenCalled();
    },
  );
});
