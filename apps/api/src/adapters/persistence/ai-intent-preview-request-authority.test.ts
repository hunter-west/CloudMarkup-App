import { describe, expect, it, vi } from "vitest";
import { AiIntentPreviewError } from "../../application/ai-intent-preview-journal.js";
import { deniedPreviewFactoryFixture } from "../../production-ai-intent-preview-test-helpers.js";
import { createProductionAiIntentPreview } from "../../production-ai-intent-preview.js";
import {
  parsePreviewPrincipal,
  parsePreviewEditingProof,
  parsePreviewRequestAuthority,
  PreviewRequestAuthority,
  previewAuthorityHash,
  previewHashMatches,
} from "./ai-intent-preview-request-authority.js";

const fixture = () => deniedPreviewFactoryFixture().input.requestAuthority;
describe("strict host-only preview request authority", () => {
  it("clones exact authenticated principal, published baseline and canonical tab proof", () => {
    const original = fixture();
    const parsed = parsePreviewRequestAuthority(original);
    expect(parsed).toEqual(original);
    expect(parsed).not.toBe(original);
    expect(parsed.principal).not.toBe(original.principal);
    expect(parsePreviewPrincipal(original.principal)).toEqual(
      original.principal,
    );
    expect(parsePreviewEditingProof(original.editingProof)).toEqual(
      original.editingProof,
    );
    const guard = new PreviewRequestAuthority(original);
    expect(guard.value).toEqual(parsed);
    expect(guard.value).not.toBe(guard.value);
  });
  it.each([
    undefined,
    null,
    [],
    {},
    { ...fixture(), extra: "not-authority" },
    { ...fixture(), principal: { ...fixture().principal, principalId: "" } },
    { ...fixture(), principal: { ...fixture().principal, sessionId: "" } },
    {
      ...fixture(),
      principal: { ...fixture().principal, sessionId: "s".repeat(257) },
    },
    {
      ...fixture(),
      principal: { ...fixture().principal, authenticationSource: "browser" },
    },
    {
      ...fixture(),
      principal: { ...fixture().principal, expiresAt: "2099-01-01T00:00:00Z" },
    },
    {
      ...fixture(),
      principal: {
        ...fixture().principal,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    },
    {
      ...fixture(),
      baseline: { ...fixture().baseline, draftEtag: '"draft:draft_x:v0"' },
    },
    {
      ...fixture(),
      baseline: { ...fixture().baseline, draftEtag: '"draft:draft_x:v01"' },
    },
    {
      ...fixture(),
      baseline: {
        ...fixture().baseline,
        editingLeaseId: "projectlease_not-a-uuid",
      },
    },
    {
      ...fixture(),
      editingProof: {
        ...fixture().editingProof,
        leaseId: "projectlease_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      },
    },
    {
      ...fixture(),
      editingProof: { ...fixture().editingProof, token: "A".repeat(42) + "B" },
    },
    {
      ...fixture(),
      editingProof: { ...fixture().editingProof, token: "A".repeat(44) },
    },
    {
      ...fixture(),
      editingProof: { ...fixture().editingProof, holderIdentity: "forged" },
    },
  ])(
    "rejects malformed metadata without interpreting it as trusted authority %#",
    (value) => {
      expect(() => parsePreviewRequestAuthority(value)).toThrow(
        AiIntentPreviewError,
      );
    },
  );
  it.each(["local-development", "test"] as const)(
    "rejects %s hosted authority in both parsers and the real factory before host or SQL",
    async (authenticationSource) => {
      const f = deniedPreviewFactoryFixture();
      const principal = {
        ...f.input.requestAuthority.principal,
        authenticationSource,
      };
      const requestAuthority = { ...f.input.requestAuthority, principal };
      expect(() => parsePreviewPrincipal(principal)).toThrow(
        AiIntentPreviewError,
      );
      expect(() => parsePreviewRequestAuthority(requestAuthority)).toThrow(
        AiIntentPreviewError,
      );
      await expect(
        createProductionAiIntentPreview({ ...f.input, requestAuthority }),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(f.authorize).not.toHaveBeenCalled();
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.unexpected).not.toHaveBeenCalled();
    },
  );
  it("rejects accessors, symbols, hidden fields and prototype-bearing records without executing getters", () => {
    const getter = vi.fn(() => fixture().principal);
    const withGetter = { ...fixture() };
    Object.defineProperty(withGetter, "principal", {
      enumerable: true,
      get: getter,
    });
    const hidden = { ...fixture() };
    Object.defineProperty(hidden, "ignored", {
      value: "hidden",
      enumerable: false,
    });
    const classValue = new (class {
      principal = fixture().principal;
      baseline = fixture().baseline;
      editingProof = fixture().editingProof;
    })();
    for (const value of [
      withGetter,
      hidden,
      classValue,
      { ...fixture(), [Symbol("hidden")]: "x" },
    ])
      expect(() => parsePreviewRequestAuthority(value)).toThrow(
        AiIntentPreviewError,
      );
    expect(getter).not.toHaveBeenCalled();
  });
  it("uses fixed-size SHA256 equality and rejects malformed digests", () => {
    const digest = previewAuthorityHash("synthetic-session");
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(previewHashMatches(digest, digest)).toBe(true);
    expect(
      previewHashMatches(digest, previewAuthorityHash("another-session")),
    ).toBe(false);
    for (const value of [
      null,
      "",
      "A".repeat(64),
      "a".repeat(63),
      "z".repeat(64),
    ])
      expect(previewHashMatches(value, digest)).toBe(false);
  });
  it("requires original actor identity before host authority or SQL in the real factory", async () => {
    const f = deniedPreviewFactoryFixture();
    await expect(
      createProductionAiIntentPreview({
        ...f.input,
        requestAuthority: {
          ...f.input.requestAuthority,
          principal: {
            ...f.input.requestAuthority.principal,
            principalId: "different_actor",
          },
        },
      }),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it("does not replace an expired original bearer with a fresh host expiry proof", async () => {
    const f = deniedPreviewFactoryFixture();
    await expect(
      createProductionAiIntentPreview({
        ...f.input,
        requestAuthority: {
          ...f.input.requestAuthority,
          principal: {
            ...f.input.requestAuthority.principal,
            authenticatedAt: "2020-01-01T00:00:00.000Z",
            expiresAt: "2020-01-02T00:00:00.000Z",
          },
        },
      }),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
  });
});
