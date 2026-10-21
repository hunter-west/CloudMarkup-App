import { describe, expect, it } from "vitest";
import { modelDependencyRequestV1Schema } from "@cloudmarkup/schemas";
import { createHostSeedResponseFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import {
  parseModelHostSeedResponseV3,
  sha256Text,
  serializedByteLength,
} from "@cloudmarkup/model-gateway";
import { materializeHostSeedRepairCandidateV3 } from "./host-seed-candidate.js";

function fixture() {
  const f = createHostSeedResponseFixtureV3();
  return {
    ...f,
    options: {
      ...f.input,
      limits: { maximumFileBytes: 65536, maximumPatchHunks: 32 },
    },
  };
}
describe("unaccepted fixed-host repair candidate materialization", () => {
  it("applies one exact patch in RAM and preserves original user ownership", () => {
    const f = fixture();
    const before = structuredClone(f.options);
    const output = materializeHostSeedRepairCandidateV3(f.options);
    expect(output).toMatchObject({
      path: f.source.path,
      content: "export const repaired = true;\n",
      digest: sha256Text("export const repaired = true;\n"),
      baseDigest: f.source.contentDigest,
      ownership: "user-owned-preserved",
      sourceAuthority: "unaccepted-model-repair",
      invocationId: f.input.descriptor.invocationId,
    });
    expect(f.options).toEqual(before);
    expect(Object.isFrozen(output)).toBe(true);
    expect(materializeHostSeedRepairCandidateV3(f.options)).toEqual(output);
  });
  it.each([
    "context",
    "result-digest",
    "base-digest",
    "other-path",
    "dependencies",
    "multiple",
    "limits",
    "over-budget",
    "unsafe-content",
  ] as const)("rejects %s without returning candidate bytes", (kind) => {
    const f = fixture();
    const candidate = f.response.candidateBundle.candidates[0];
    if (candidate?.kind !== "patch") throw Error("Missing synthetic patch");
    if (kind === "context")
      candidate.unifiedDiff = candidate.unifiedDiff.replace(
        "-" + f.source.content.trimEnd(),
        "-foreign context",
      );
    if (kind === "result-digest")
      candidate.proposedResultDigest = sha256Text("foreign bytes");
    if (kind === "base-digest")
      candidate.baseDigest = sha256Text("foreign base");
    if (kind === "other-path") candidate.path = "application/package.json";
    if (kind === "dependencies") {
      const approvalPathId = f.options.request.boundary.approvalPathIds[0];
      if (approvalPathId === undefined)
        throw Error("Missing synthetic approval path");
      f.options.allowedApprovalPathIds = new Set([approvalPathId]);
      f.response.candidateBundle.dependencies = [
        modelDependencyRequestV1Schema.parse({
          approvalPathId,
          ecosystem: "npm.package",
          kind: "package",
          name: "synthetic-repair-dependency",
          reason: "Synthetic bounded repair dependency request.",
          requestedVersion: "1.0.0",
          reviewState: "requested",
        }),
      ];
    }
    if (kind === "multiple")
      f.response.candidateBundle.candidates.push(structuredClone(candidate));
    if (kind === "limits") f.options.limits.maximumPatchHunks = Number.NaN;
    if (kind === "over-budget") f.options.limits.maximumFileBytes = 1;
    if (kind === "unsafe-content") {
      const content = 'eval("untrusted");\n';
      candidate.unifiedDiff = candidate.unifiedDiff.replace(
        "+export const repaired = true;",
        '+eval("untrusted");',
      );
      candidate.proposedResultDigest = sha256Text(content);
    }
    f.options.maximumOutputBytes = serializedByteLength(f.options.content);
    if (kind === "dependencies") {
      expect(parseModelHostSeedResponseV3(f.options)).toEqual(f.response);
    }
    expect(() => materializeHostSeedRepairCandidateV3(f.options)).toThrow(
      "The exact bounded host repair candidate is unavailable.",
    );
  });
});
