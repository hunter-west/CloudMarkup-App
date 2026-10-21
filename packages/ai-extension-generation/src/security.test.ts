import { describe, expect, it } from "vitest";

import {
  candidateContentSafetyDiagnostics,
  digestCanonicalValue,
  portablePathKey,
  sameStringSet,
  sha256Text,
  stableRecordId,
  utf8ByteLength,
  validatePortableCandidatePath,
} from "./security.js";

describe("candidate security primitives", () => {
  it("derives canonical digests and stable IDs reproducibly", () => {
    const first = { alpha: 1, nested: { beta: true } };
    const reordered = { nested: { beta: true }, alpha: 1 };

    expect(digestCanonicalValue(reordered)).toBe(digestCanonicalValue(first));
    expect(stableRecordId("candidate", reordered)).toBe(
      stableRecordId("candidate", first),
    );
    expect(stableRecordId("candidate", { alpha: 2 })).not.toBe(
      stableRecordId("candidate", first),
    );
    expect(sha256Text("value")).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("normalizes portable comparison keys while requiring canonical input paths", () => {
    expect(portablePathKey("Application/CAFÉ.ts")).toBe(
      portablePathKey("application/cafe\u0301.ts"),
    );
    expect(validatePortableCandidatePath("application/custom.ts")).toBe(
      "application/custom.ts",
    );
    expect(() =>
      validatePortableCandidatePath("application/cafe\u0301.ts"),
    ).toThrow();
  });

  it.each([
    "application/CON.ts",
    "application/trailing.",
    "application/trailing ",
    "application/name:stream.ts",
    `application/${"a".repeat(240)}.ts`,
  ])("rejects non-portable candidate path %s", (path) => {
    expect(() => validatePortableCandidatePath(path)).toThrow();
  });

  it("detects canonical-text, secret, and application authority violations", () => {
    expect(
      candidateContentSafetyDiagnostics(
        "line one\r\nline two\n",
        "application",
      ),
    ).toContain("Candidate text must use canonical LF line endings.");
    expect(
      candidateContentSafetyDiagnostics("safe\u202Eunsafe\n", "application"),
    ).toContain("Candidate text contains a forbidden control character.");
    expect(
      candidateContentSafetyDiagnostics(
        'const client_secret = "candidate-secret-value";\n',
        "application",
      ),
    ).toContain("Candidate text contains a secret or credential candidate.");
    expect(
      candidateContentSafetyDiagnostics(
        'import { exec } from "node:child_process";\n',
        "application",
      ),
    ).toContain(
      "Candidate source requests forbidden process or dynamic-code authority.",
    );
    expect(
      candidateContentSafetyDiagnostics(
        'resource "example" "child_process" {}\n',
        "terraform",
      ),
    ).not.toContain(
      "Candidate source requests forbidden process or dynamic-code authority.",
    );
  });

  it("counts UTF-8 bytes and compares exact string sets", () => {
    expect(utf8ByteLength("é")).toBe(2);
    expect(sameStringSet(["alpha", "beta"], ["beta", "alpha"])).toBe(true);
    expect(sameStringSet(["alpha"], ["alpha", "beta"])).toBe(false);
    expect(sameStringSet(["alpha", "beta"], ["alpha", "alpha"])).toBe(false);
  });
});
