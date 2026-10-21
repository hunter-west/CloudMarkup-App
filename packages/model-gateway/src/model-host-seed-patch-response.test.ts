import { describe, expect, it } from "vitest";
import {
  modelCandidateRepairResponseV1Schema,
  modelHostSeedPatchResponseV2Schema,
} from "@cloudmarkup/schemas";
import {
  createHostSeedPatchResponseFixtureV2,
  createHostSeedResponseFixtureV3,
} from "./host-seed-response-test-helpers.js";
import {
  parseModelHostSeedPatchResponseV2,
  parseModelHostSeedResponseV3,
  serializedByteLength,
  sha256Text,
} from "./security.js";
import {
  getModelHostSeedPatchResponseToolV2,
  getModelResponseToolV1,
} from "./tools.js";
describe("host-computed patch response version", () => {
  it("accepts only the new exact channel and never invents a model-supplied result hash", () => {
    const f = createHostSeedPatchResponseFixtureV2();
    expect(parseModelHostSeedPatchResponseV2(f.input)).toEqual(f.response);
    expect(f.response.candidateBundle.candidates[0]).not.toHaveProperty(
      "proposedResultDigest",
    );
    expect(
      modelCandidateRepairResponseV1Schema.safeParse(f.response).success,
    ).toBe(false);
    expect(
      modelHostSeedPatchResponseV2Schema.safeParse(
        createHostSeedResponseFixtureV3().response,
      ).success,
    ).toBe(false);
    expect(getModelHostSeedPatchResponseToolV2().toolName).not.toBe(
      getModelResponseToolV1("candidate.repair").toolName,
    );
    expect(() => parseModelHostSeedResponseV3(f.input)).toThrow();
  });
  it.each([
    "provenance",
    "base",
    "path",
    "digest",
    "dependency",
    "tool",
    "text",
    "multiple",
    "prompt",
  ] as const)("denies %s substitution", (kind) => {
    const f = createHostSeedPatchResponseFixtureV2();
    const patch = f.response.candidateBundle.candidates[0];
    if (!patch) throw Error("Missing patch");
    if (kind === "provenance")
      f.response.provenance.inputDigest = sha256Text("foreign");
    if (kind === "base") patch.baseDigest = sha256Text("foreign");
    if (kind === "path") patch.path = "application/foreign.ts";
    if (kind === "digest")
      Object.assign(patch, { proposedResultDigest: sha256Text("invented") });
    if (kind === "dependency")
      Object.assign(f.response.candidateBundle, {
        dependencies: [{ packageName: "arbitrary", version: "1" }],
      });
    if (kind === "tool")
      f.input.content.toolName =
        getModelResponseToolV1("candidate.repair").toolName;
    if (kind === "text")
      Object.assign(f.input, {
        content: { kind: "text", text: JSON.stringify(f.response) },
      });
    if (kind === "multiple")
      f.response.candidateBundle.candidates.push({ ...patch });
    if (kind === "prompt")
      Object.assign(f.input.descriptor, { promptVersion: "1.0.0" });
    f.input.maximumOutputBytes = serializedByteLength(f.input.content) + 1000;
    expect(() => parseModelHostSeedPatchResponseV2(f.input)).toThrow();
  });
});
