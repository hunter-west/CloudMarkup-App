import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  awsConnectionResolverV1,
  awsConnectionRuleRegistrationsV1,
} from "./connection-resolution.js";
import {
  AWS_IAM_POLICY_INTERNAL_BINDINGS_V1,
  AWS_IAM_POLICY_RESOURCE_SCOPES_V1,
} from "./policy/index.js";
import { awsValidationRulesV1 } from "./validation/index.js";

interface ProviderAwsPackageManifest {
  readonly exports?: Readonly<Record<string, unknown>>;
}

const expectedRuntimeSubpaths = {
  "./connection-resolution": {
    types: "./src/connection-resolution.ts",
    import: "./dist/connection-resolution.js",
  },
  "./policy": {
    types: "./src/policy/index.ts",
    import: "./dist/policy/index.js",
  },
  "./validation": {
    types: "./src/validation/index.ts",
    import: "./dist/validation/index.js",
  },
} as const;

describe("AWS provider public package exports", () => {
  it("declares focused runtime subpaths for browser consumers", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as ProviderAwsPackageManifest;

    for (const [subpath, target] of Object.entries(expectedRuntimeSubpaths)) {
      expect(manifest.exports?.[subpath]).toEqual(target);
    }
  });

  it("keeps each focused source surface populated", () => {
    expect(awsConnectionResolverV1).toBeDefined();
    expect(awsConnectionRuleRegistrationsV1.length).toBeGreaterThan(0);
    expect(
      Object.keys(AWS_IAM_POLICY_INTERNAL_BINDINGS_V1).length,
    ).toBeGreaterThan(0);
    expect(AWS_IAM_POLICY_RESOURCE_SCOPES_V1.length).toBeGreaterThan(0);
    expect(awsValidationRulesV1.length).toBeGreaterThan(0);
  });
});
