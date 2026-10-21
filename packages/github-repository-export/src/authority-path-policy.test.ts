import { SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS } from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import {
  gitHubPreviousExportAuthorityV1Schema,
  type GitHubPreviousExportAuthorityPayloadV1,
  type GitHubPreviousExportAuthorityV1,
} from "./contracts.js";
import { canonicalDigest, sha256Digest } from "./security.js";

function authorityForPath(input: {
  readonly destinationFolder: string;
  readonly path: string;
  readonly workflow?: boolean;
}): GitHubPreviousExportAuthorityV1 {
  const files = [
    {
      checksum: sha256Digest("managed bytes\n"),
      ownership: "generated-replaceable" as const,
      path: input.path,
      workflow: input.workflow ?? false,
    },
  ];
  const payload: GitHubPreviousExportAuthorityPayloadV1 = {
    artifactDigest: sha256Digest("artifact"),
    artifactId: "artifact.1",
    baseBranch: "main",
    commitSha: "a".repeat(40),
    completedAt: "2026-08-24T12:00:00.000Z",
    contractVersion: 1,
    destinationFolder: input.destinationFolder,
    executionId: "execution.1",
    featureBranch: "cloudmarkup/path-policy",
    files,
    installationId: 77,
    integrationId: "integration.1",
    inventoryDigest: canonicalDigest(files),
    kind: "github-previous-export-authority",
    organizationId: "organization.1",
    previewDigest: sha256Digest("preview"),
    projectId: "project.1",
    pullRequestNumber: 1,
    pullRequestUrl: "https://github.com/example/cloudmarkup/pull/1",
    repositoryId: 900,
    repositoryName: "cloudmarkup",
    repositoryOwner: "example",
    repositoryOwnerId: 500,
  };
  return {
    ...payload,
    authorityDigest: canonicalDigest(payload),
  };
}

describe("previous-export authority path policy", () => {
  it("admits a canonical package path after stripping the exact destination", () => {
    expect(
      gitHubPreviousExportAuthorityV1Schema.safeParse(
        authorityForPath({
          destinationFolder: "solutions/notes-api",
          path: "solutions/notes-api/application/src/index.ts",
        }),
      ).success,
    ).toBe(true);
  });

  it("retains authority for an exact reviewed repository workflow", () => {
    const path = SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS[0];
    expect(
      gitHubPreviousExportAuthorityV1Schema.safeParse(
        authorityForPath({
          destinationFolder: "solutions/notes-api",
          path,
          workflow: true,
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    {
      destinationFolder: "solutions/notes-api",
      kind: "destination-prefixed workflow disguised as package content",
      path: "solutions/notes-api/.github/workflows/cloudmarkup-plan.yml",
    },
    {
      destinationFolder: "",
      kind: "reviewed root workflow without workflow classification",
      path: SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS[0],
    },
    {
      destinationFolder: "",
      kind: "root CODEOWNERS",
      path: "CODEOWNERS",
    },
    {
      destinationFolder: "solutions/notes-api",
      kind: "nested CODEOWNERS",
      path: "solutions/notes-api/.github/CODEOWNERS",
    },
    {
      destinationFolder: "solutions/notes-api",
      kind: "environment file",
      path: "solutions/notes-api/application/.env.production",
    },
    {
      destinationFolder: "solutions/notes-api",
      kind: "Terraform state",
      path: "solutions/notes-api/infrastructure/terraform.tfstate.backup",
    },
    {
      destinationFolder: "solutions/notes-api",
      kind: "Windows device name",
      path: "solutions/notes-api/application/CON.txt",
    },
    {
      destinationFolder: "solutions/notes-api",
      kind: "trailing-dot segment",
      path: "solutions/notes-api/application/generated.",
    },
    {
      destinationFolder: "solutions/notes-api",
      kind: "nonportable dependency output",
      path: "solutions/notes-api/application/node_modules/dependency.js",
    },
  ])(
    "rejects self-digested forged authority for $kind",
    ({ destinationFolder, path }) => {
      const authority = authorityForPath({ destinationFolder, path });
      const { authorityDigest, ...payload } = authority;
      expect(authorityDigest).toBe(canonicalDigest(payload));
      expect(authority.inventoryDigest).toBe(canonicalDigest(authority.files));
      expect(
        gitHubPreviousExportAuthorityV1Schema.safeParse(authority).success,
      ).toBe(false);
    },
  );
});
