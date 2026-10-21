import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applicationBuildProfileV1Schema,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
} from "./contracts.js";
import {
  applicationHostRepairSeedBuildRequestV1Schema,
  applicationHostRepairSeedBuildResultV1Schema,
  applicationHostRepairSeedProfileV1Schema,
} from "./host-repair-seed-contracts.js";
import {
  applicationHostRepairCandidateProfileV1Schema,
  createApplicationHostRepairCandidateProfileV1,
  generateApplicationHostRepairCandidateV1JsonSchema,
} from "./host-repair-candidate-contracts.js";
import { sha256Digest } from "./security.js";
describe("additive host repair candidate compatibility", () => {
  it("retains strict historical profile and request/result interpretation", () => {
    const profile = createApplicationHostRepairCandidateProfileV1();
    expect(
      applicationHostRepairCandidateProfileV1Schema.parse(profile),
    ).toEqual(profile);
    expect(applicationBuildProfileV1Schema.safeParse(profile).success).toBe(
      false,
    );
    expect(
      applicationHostRepairSeedProfileV1Schema.safeParse(profile).success,
    ).toBe(false);
    for (const schema of [
      applicationBuildRequestV1Schema,
      applicationBuildResultV1Schema,
      applicationHostRepairSeedBuildRequestV1Schema,
      applicationHostRepairSeedBuildResultV1Schema,
    ]) {
      const json = JSON.stringify(
        z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }),
      );
      expect(json).not.toContain("model-repair-of-fixed-host-seed");
      expect(json).not.toContain("host-repair-candidate-validation-artifact");
    }
    expect(
      applicationHostRepairCandidateProfileV1Schema.safeParse({
        ...profile,
        digest: sha256Digest("wrong"),
      }).success,
    ).toBe(false);
  });
  it("matches its checked schema artifact and does not enter the normal entry point", () => {
    expect(
      readFileSync(
        new URL(
          "../json-schema/application-host-repair-candidate-v1.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toBe(
      JSON.stringify(generateApplicationHostRepairCandidateV1JsonSchema()) +
        "\n",
    );
    expect(
      readFileSync(new URL("./index.ts", import.meta.url), "utf8"),
    ).not.toContain("host-repair");
  });
});
