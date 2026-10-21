import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  applicationBuildArtifactFileV1Schema,
  applicationBuildPolicyV1Schema,
  applicationBuildProfileV1Schema,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
} from "./contracts.js";
import {
  applicationHostRepairSeedBuildRequestV1Schema,
  applicationHostRepairSeedBuildResultV1Schema,
  applicationHostRepairSeedPolicyV1Schema,
  applicationHostRepairSeedProfileV1Schema,
  createApplicationHostRepairSeedProfileV1,
} from "./host-repair-seed-contracts.js";
import { generateApplicationHostRepairSeedV1JsonSchema } from "./host-repair-seed-json-schema.js";
import { canonicalJson, sha256Digest } from "./security.js";

describe("additive fixed host repair seed compatibility", () => {
  it("preserves all three historical profile branches and denies the new profile there", () => {
    for (const [id, sourcePolicy] of [
      ["cloudmarkup.application-build.generated-nodejs24", "generated-only"],
      [
        "cloudmarkup.application-build.ai-assisted-custom-nodejs24",
        "ai-assisted-custom-only",
      ],
      [
        "cloudmarkup.application-build.user-source-static-nodejs24",
        "user-provided-static-only",
      ],
    ] as const) {
      const body = { id, version: "1.0.0", sourcePolicy };
      const old = { ...body, digest: sha256Digest(canonicalJson(body)) };
      expect(applicationBuildProfileV1Schema.parse(old)).toEqual(old);
      expect(
        applicationHostRepairSeedProfileV1Schema.safeParse(old).success,
      ).toBe(false);
    }
    expect(
      applicationBuildProfileV1Schema.safeParse(
        createApplicationHostRepairSeedProfileV1(),
      ).success,
    ).toBe(false);
  });

  it("requires the exact new profile digest and rejects extra authority", () => {
    const profile = createApplicationHostRepairSeedProfileV1();
    expect(applicationHostRepairSeedProfileV1Schema.parse(profile)).toEqual(
      profile,
    );
    expect(
      applicationHostRepairSeedProfileV1Schema.safeParse({
        ...profile,
        digest: sha256Digest("wrong"),
      }).success,
    ).toBe(false);
    expect(
      applicationHostRepairSeedProfileV1Schema.safeParse({
        ...profile,
        execute: true,
      }).success,
    ).toBe(false);
  });

  it("keeps host origin and artifact ownership absent from all old JSON shapes", () => {
    const oldShapes = [
      applicationBuildRequestV1Schema,
      applicationBuildPolicyV1Schema,
      applicationBuildResultV1Schema,
      applicationBuildArtifactFileV1Schema,
    ];
    for (const shape of oldShapes) {
      const bytes = JSON.stringify(
        z.toJSONSchema(shape, { io: "input", target: "draft-2020-12" }),
      );
      expect(bytes).not.toContain("fixed-host-synthetic");
      expect(bytes).not.toContain("host-synthetic-validation-artifact");
      expect(bytes).not.toContain("host-repair-seed-nodejs24");
    }
  });

  it("matches the registered new artifact exactly without changing root exports", () => {
    const generated = `${JSON.stringify(generateApplicationHostRepairSeedV1JsonSchema())}\n`;
    expect(
      readFileSync(
        new URL(
          "../json-schema/application-host-repair-seed-v1.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toBe(generated);
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, unknown> };
    expect(manifest.exports["./schema/host-repair-seed-v1"]).toBe(
      "./json-schema/application-host-repair-seed-v1.schema.json",
    );
    expect(manifest.exports["."]).toEqual({
      types: "./src/index.ts",
      import: "./dist/index.js",
    });
    expect(
      readFileSync(new URL("./index.ts", import.meta.url), "utf8"),
    ).not.toContain("host-repair-seed");
  });

  it("gives each host request/result/policy its own strict profile or discriminator", () => {
    expect(
      applicationHostRepairSeedBuildRequestV1Schema.safeParse({
        contractVersion: 1,
        source: { kind: "generated" },
      }).success,
    ).toBe(false);
    expect(
      applicationHostRepairSeedBuildResultV1Schema.safeParse({
        contractVersion: 1,
        coverage: {},
        evidence: {},
      }).success,
    ).toBe(false);
    expect(applicationHostRepairSeedPolicyV1Schema.shape.profile).toBe(
      applicationHostRepairSeedProfileV1Schema,
    );
  });
});
