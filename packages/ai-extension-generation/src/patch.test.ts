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
    for (const [baseContent, hunks, expected] of [
      ["a\nb\n", "@@ -0,0 +1,1 @@\n+x\n", "x\na\nb\n"],
      ["a\nb\n", "@@ -1,0 +2,1 @@\n+x\n", "a\nx\nb\n"],
      ["a\nb\n", "@@ -2,0 +3,1 @@\n+x\n", "a\nb\nx\n"],
      ["a\nb\n", "@@ -1,0 +2,1 @@\n+x\n@@ -2,0 +4,1 @@\n+y\n", "a\nx\nb\ny\n"],
      ["a\nb", "@@ -1,0 +2,1 @@\n+x\n", "a\nx\nb"],
      ["", "@@ -0,0 +1,1 @@\n+x\n", "x"],
    ] as const) {
      expect(
        applyExactUnifiedPatch({
          ...input,
          baseContent,
          unifiedDiff: `--- a/${input.path}\n+++ b/${input.path}\n${hunks}`,
        }),
      ).toBe(expected);
    }
    for (const header of ["@@ -1,0 +1,1 @@", "@@ -0,1 +1,1 @@"]) {
      expect(() =>
        applyExactUnifiedPatch({
          ...input,
          baseContent: "a\nb\n",
          unifiedDiff: `--- a/${input.path}\n+++ b/${input.path}\n${header}\n+x\n`,
        }),
      ).toThrow(/out of range|overlap/u);
    }
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
