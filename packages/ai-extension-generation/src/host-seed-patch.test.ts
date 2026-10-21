import { describe, expect, it } from "vitest";
import { createHostSeedPatchResponseFixtureV2 } from "@cloudmarkup/model-gateway/testing";
import { sha256Text, serializedByteLength } from "@cloudmarkup/model-gateway";
import { materializeHostSeedRepairPatchV2 } from "./host-seed-candidate.js";
describe("host-computed repaired candidate digest", () => {
  it("computes the actual digest after exact patch application without a model hash", () => {
    const f = createHostSeedPatchResponseFixtureV2();
    const options = {
      ...f.input,
      limits: { maximumFileBytes: 65536, maximumPatchHunks: 32 },
    };
    const before = structuredClone(options);
    const result = materializeHostSeedRepairPatchV2(options);
    expect(result.content).toBe("export const repaired = true;\n");
    expect(result.digest).toBe(sha256Text(result.content));
    expect(result.ownership).toBe("user-owned-preserved");
    expect(options).toEqual(before);
    expect(f.response.candidateBundle.candidates[0]).not.toHaveProperty(
      "proposedResultDigest",
    );
  });
  it.each([
    "wrong-context",
    "invented-digest",
    "unsafe-content",
    "limit",
  ] as const)("denies %s while preserving source ownership", (kind) => {
    const f = createHostSeedPatchResponseFixtureV2();
    const candidate = f.response.candidateBundle.candidates[0];
    if (!candidate) throw Error("Missing synthetic patch");
    if (kind === "wrong-context")
      candidate.unifiedDiff = candidate.unifiedDiff.replace(
        "-" + f.source.content.trimEnd(),
        "-wrong",
      );
    if (kind === "invented-digest")
      Object.assign(candidate, {
        proposedResultDigest: sha256Text("fabricated"),
      });
    if (kind === "unsafe-content")
      candidate.unifiedDiff = candidate.unifiedDiff.replace(
        "+export const repaired = true;",
        '+eval("untrusted");',
      );
    const options = {
      ...f.input,
      maximumOutputBytes: serializedByteLength(f.input.content) + 1000,
      limits: {
        maximumFileBytes: kind === "limit" ? 1 : 65536,
        maximumPatchHunks: 32,
      },
    };
    expect(() => materializeHostSeedRepairPatchV2(options)).toThrow();
  });
});
