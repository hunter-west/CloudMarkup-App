import { describe, expect, it } from "vitest";
import { reviewedHostSeedRepairPromptV2 } from "./host-seed-repair.js";
import {
  reviewedHostSeedPatchRepairPromptV3,
  resolveReviewedHostSeedRepairPromptV3,
} from "./host-seed-patch-repair.js";
import {
  createHostSeedResponseFixtureV3,
  createHostSeedPatchResponseFixtureV2,
} from "../host-seed-response-test-helpers.js";
import {
  parseModelHostSeedResponseV3,
  parseModelHostSeedPatchResponseV2,
  sha256Text,
} from "../security.js";

describe("versioned fixed-seed patch instructions", () => {
  it("binds current model output instructions to the patch-only materializer", () => {
    const prompt = reviewedHostSeedPatchRepairPromptV3;
    expect(prompt).toMatchObject({
      templateId: reviewedHostSeedRepairPromptV2.templateId,
      version: "1.1.0",
      digest: sha256Text(prompt.content),
    });
    expect(prompt.content).toContain(
      "Return exactly one candidate of kind patch",
    );
    expect(prompt.content).toContain(
      "Set baseDigest to the supplied contentDigest",
    );
    expect(prompt.content).toContain(
      "the host applies the patch and computes the resulting file",
    );
    expect(prompt.content).toContain("Do not return a whole\nfile candidate");
    expect(Object.isFrozen(prompt)).toBe(true);
    expect(prompt.digest).not.toBe(reviewedHostSeedRepairPromptV2.digest);
  });
  it.each([
    reviewedHostSeedRepairPromptV2,
    reviewedHostSeedPatchRepairPromptV3,
  ])("retains exact response identity for prompt $version", (prompt) => {
    const f =
      prompt.version === "1.1.0"
        ? createHostSeedPatchResponseFixtureV2()
        : createHostSeedResponseFixtureV3();
    const fields = {
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
    };
    Object.assign(f.input.descriptor, fields);
    Object.assign(f.response.provenance, fields);
    Object.assign(f.response.candidateBundle.provenance, fields);
    expect(
      (prompt.version === "1.1.0"
        ? parseModelHostSeedPatchResponseV2
        : parseModelHostSeedResponseV3)(f.input),
    ).toEqual(f.response);
    expect(resolveReviewedHostSeedRepairPromptV3(f.input.descriptor)).toBe(
      prompt,
    );
  });
  it("rejects mixed and unknown prompt identities instead of relabeling old bytes", () => {
    const legacy = reviewedHostSeedRepairPromptV2,
      current = reviewedHostSeedPatchRepairPromptV3;
    expect(legacy.version).toBe("1.0.0");
    expect(legacy.content).toContain("Return one file candidate");
    for (const mismatch of [
      { promptVersion: current.version, promptDigest: legacy.digest },
      { promptVersion: legacy.version, promptDigest: current.digest },
      { promptVersion: "99.0.0", promptDigest: current.digest },
    ])
      expect(
        resolveReviewedHostSeedRepairPromptV3({
          promptTemplateId: current.templateId,
          ...mismatch,
        }),
      ).toBeNull();
  });
});
