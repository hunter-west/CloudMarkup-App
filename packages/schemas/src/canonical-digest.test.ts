import { describe, expect, it } from "vitest";

import {
  digestCanonicalValue,
  encodeUtf8,
  sha256Bytes,
  sha256Text,
} from "./canonical-digest.js";

describe("browser-safe canonical digests", () => {
  it("matches the SHA-256 standard vectors without runtime crypto authority", () => {
    expect(sha256Text("")).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Text("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Bytes(encodeUtf8("abc"))).toBe(sha256Text("abc"));
  });

  it("binds canonical object content independent of key insertion order", () => {
    expect(digestCanonicalValue({ alpha: 1, nested: { beta: true } })).toBe(
      digestCanonicalValue({ nested: { beta: true }, alpha: 1 }),
    );
  });
});
