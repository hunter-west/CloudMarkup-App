import { describe, expect, it } from "vitest";

import {
  gitHubBranchNameSchema,
  gitHubDestinationFolderSchema,
} from "./contracts.js";
import { destinationPath } from "./security.js";

describe("GitHub repository path policy", () => {
  it.each([
    "../escape",
    "safe/../../escape",
    "/absolute",
    "C:/drive",
    "safe\\windows",
    "safe//empty",
    "safe/%2e%2e/escape",
    ".git/hooks",
    "safe/\0nul",
  ])("rejects destination attack %s", (path) => {
    expect(gitHubDestinationFolderSchema.safeParse(path).success).toBe(false);
  });

  it.each([
    "refs/heads/main",
    "bad..name",
    "bad branch",
    "feature.lock",
    ".hidden",
  ])("rejects unsafe branch %s", (branch) => {
    expect(gitHubBranchNameSchema.safeParse(branch).success).toBe(false);
  });

  it("keeps workflow files at repository root while nesting package files", () => {
    expect(destinationPath("cloudmarkup/solution.json", "solutions/api")).toBe(
      "solutions/api/cloudmarkup/solution.json",
    );
    expect(
      destinationPath(
        ".github/workflows/cloudmarkup-validate.yml",
        "solutions/api",
      ),
    ).toBe(".github/workflows/cloudmarkup-validate.yml");
  });
});
