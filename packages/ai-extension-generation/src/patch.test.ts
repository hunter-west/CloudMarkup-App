import { describe, expect, it } from "vitest";

import { applyExactUnifiedPatch } from "./patch.js";

const limits = {
  maximumHunks: 4,
  maximumOutputBytes: 1_024,
} as const;

describe("exact unified patch materialization", () => {
  it("applies one exact bounded patch deterministically", () => {
    const input = {
      baseContent: "export const answer = 41;\n",
      limits,
      path: "application/extensions/custom.ts",
      unifiedDiff: [
        "--- a/application/extensions/custom.ts",
        "+++ b/application/extensions/custom.ts",
        "@@ -1,1 +1,1 @@",
        "-export const answer = 41;",
        "+export const answer = 42;",
        "",
      ].join("\n"),
    };
    expect(applyExactUnifiedPatch(input)).toBe("export const answer = 42;\n");
    expect(applyExactUnifiedPatch(input)).toBe(applyExactUnifiedPatch(input));
  });

  it.each([
    {
      name: "another path",
      patch: "--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-old\n+new\n",
    },
    {
      name: "mismatched context",
      patch:
        "--- a/application/extensions/custom.ts\n+++ b/application/extensions/custom.ts\n@@ -1 +1 @@\n-wrong\n+new\n",
    },
    {
      name: "multiple file headers",
      patch:
        "--- a/application/extensions/custom.ts\n+++ b/application/extensions/custom.ts\n@@ -1 +1 @@\n-old\n+new\n--- a/other.ts\n+++ b/other.ts\n",
    },
    {
      name: "final newline directive",
      patch:
        "--- a/application/extensions/custom.ts\n+++ b/application/extensions/custom.ts\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n",
    },
  ])("rejects $name", ({ patch }) => {
    expect(() =>
      applyExactUnifiedPatch({
        baseContent: "old\n",
        limits,
        path: "application/extensions/custom.ts",
        unifiedDiff: patch,
      }),
    ).toThrow();
  });
});
