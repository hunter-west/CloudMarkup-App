import { describe, expect, it } from "vitest";
import { createHostRepairSuccessorResponseFixtureV4 } from "@cloudmarkup/model-gateway/testing";
import { digestStructuredValue, sha256Text } from "@cloudmarkup/model-gateway";
import {
  materializeHostRepairSuccessorPatchV4,
  materializeHostSeedRepairPatchV2,
} from "./host-seed-candidate.js";

describe("exact final repair patch materialization", () => {
  it("patches the actual predecessor and preserves its bytes and ownership", () => {
    const f = createHostRepairSuccessorResponseFixtureV4();
    const input = {
      ...f.input,
      limits: { maximumFileBytes: 65536, maximumPatchHunks: 32 },
    };
    const before = structuredClone(input);
    const candidate = materializeHostRepairSuccessorPatchV4(input);
    expect(candidate.content).toBe(
      "export const repaired = true;\n// prior unaccepted repair\n",
    );
    expect(candidate.baseDigest).toBe(
      f.input.request.predecessor.contentDigest,
    );
    expect(candidate.baseDigest).not.toBe(f.first.source.contentDigest);
    expect(candidate.digest).toBe(sha256Text(candidate.content));
    expect(candidate.ownership).toBe("user-owned-preserved");
    expect(candidate.sourceAuthority).toBe("unaccepted-model-repair");
    expect(candidate.responseDigest).toBe(digestStructuredValue(f.response));
    expect(input).toEqual(before);
    expect(() => {
      Reflect.apply(materializeHostSeedRepairPatchV2, undefined, [input]);
    }).toThrow();
  });
  it.each([
    "seed-base",
    "wrong-context",
    "unsafe",
    "extra-file",
    "limit",
  ] as const)(
    "rejects %s without restarting from the original seed",
    (kind) => {
      const f = createHostRepairSuccessorResponseFixtureV4();
      if (kind === "seed-base")
        f.patch.baseDigest = f.first.source.contentDigest;
      if (kind === "wrong-context")
        f.patch.unifiedDiff = f.patch.unifiedDiff.replace(
          " // prior unaccepted repair",
          " wrong predecessor",
        );
      if (kind === "unsafe")
        f.patch.unifiedDiff = f.patch.unifiedDiff.replace(
          "+export const repaired = true;",
          '+eval("untrusted");',
        );
      if (kind === "extra-file")
        f.response.candidateBundle.candidates.push({ ...f.patch });
      const input = {
        ...f.input,
        limits: {
          maximumFileBytes: kind === "limit" ? 1 : 65536,
          maximumPatchHunks: 32,
        },
      };
      expect(() => materializeHostRepairSuccessorPatchV4(input)).toThrow();
    },
  );
});
