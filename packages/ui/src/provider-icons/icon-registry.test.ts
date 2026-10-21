import { describe, expect, it } from "vitest";

import { createIconRegistry } from "./icon-registry.js";

const assetSet = {
  id: "cloudmarkup.test.icons",
  providerId: "example.provider",
  version: "1.0.0",
  digest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
} as const;

type TestAsset = Readonly<{
  kind: "local-svg" | "neutral";
}>;

describe("createIconRegistry", () => {
  it("resolves approved exact IDs and returns a safe fallback for unknown IDs", () => {
    const placeholder: TestAsset = Object.freeze({ kind: "neutral" });
    const approved: TestAsset = Object.freeze({ kind: "local-svg" });
    const registry = createIconRegistry<TestAsset>({
      assetSet,
      placeholderAsset: placeholder,
      registrations: [
        {
          kind: "approved",
          iconId: "example.icons.database",
          asset: approved,
          sourceDigest:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    });

    expect(registry.resolve("example.icons.database")).toMatchObject({
      kind: "approved",
      asset: approved,
      iconId: "example.icons.database",
    });
    expect(registry.resolve("example.icons.unknown")).toMatchObject({
      kind: "placeholder",
      asset: placeholder,
      iconId: "example.icons.unknown",
      reason: "missing",
    });
  });

  it("preserves explicit unavailable reasons without interpreting the ID", () => {
    const registry = createIconRegistry<string>({
      assetSet,
      placeholderAsset: "neutral",
      registrations: [
        {
          kind: "placeholder",
          iconId: "opaque.value",
          reason: "withdrawn",
        },
      ],
    });

    expect(registry.resolve("opaque.value")).toMatchObject({
      kind: "placeholder",
      reason: "withdrawn",
    });
  });

  it("rejects duplicate registrations and malformed integrity metadata", () => {
    expect(() =>
      createIconRegistry<string>({
        assetSet,
        placeholderAsset: "neutral",
        registrations: [
          {
            kind: "placeholder",
            iconId: "opaque.value",
            reason: "pending-approval",
          },
          {
            kind: "placeholder",
            iconId: "opaque.value",
            reason: "rejected",
          },
        ],
      }),
    ).toThrow(/unique exact IDs/u);

    expect(() =>
      createIconRegistry<string>({
        assetSet: { ...assetSet, digest: "not-a-digest" },
        placeholderAsset: "neutral",
        registrations: [],
      }),
    ).toThrow(/SHA-256/u);
  });

  it("returns stable resolution data for repeated requests", () => {
    const registry = createIconRegistry<string>({
      assetSet,
      placeholderAsset: "neutral",
      registrations: [],
    });

    expect(registry.resolve("opaque.missing")).toEqual(
      registry.resolve("opaque.missing"),
    );
    expect(Object.isFrozen(registry.assetSet)).toBe(true);
    expect(Object.isFrozen(registry.resolve("opaque.missing"))).toBe(true);
  });
});
