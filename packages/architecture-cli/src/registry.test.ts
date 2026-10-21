import { rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { architectureCliRepositoryProfileV1Schema } from "./contracts.js";
import {
  createArchitectureCliService,
  type ArchitectureCliPipelineV1,
} from "./service.js";
import {
  createArchitectureCliPipelineRegistry,
  createProfileBoundArchitectureCliPipeline,
} from "./registry.js";
import {
  architectureCliFixtureArtifact,
  architectureCliFixtureSnapshot,
  writeArchitectureCliFixtureRepository,
} from "./test-fixtures.js";

const fixturePipeline: ArchitectureCliPipelineV1 = {
  inspect: () =>
    Promise.resolve({
      artifact: architectureCliFixtureArtifact(),
      diagnostics: [],
      evidence: { current: 1, failed: 0, stale: 0, unavailableLevels: [] },
      semanticSnapshot: architectureCliFixtureSnapshot(),
      state: "ready" as const,
    }),
  run: () =>
    Promise.resolve({
      artifact: architectureCliFixtureArtifact(),
      diagnostics: [],
      evidence: { current: 1, failed: 0, stale: 0, unavailableLevels: [] },
      semanticSnapshot: architectureCliFixtureSnapshot(),
      state: "ready" as const,
    }),
};

const registeredProfile = architectureCliRepositoryProfileV1Schema.parse({
  cli: {
    digest: `sha256:${"8".repeat(64)}`,
    id: "cloudmarkup.architecture-cli",
    version: "1.0.0",
  },
  contractVersion: 1,
  kind: "cloudmarkup.repository-verification-profile",
  paths: {
    lock: "cloudmarkup/cloudmarkup.lock.json",
    manifest: "cloudmarkup/cloudmarkup.manifest.json",
    solutionRevision: "cloudmarkup/solution.json",
  },
  pipelineProfile: {
    digest: `sha256:${"9".repeat(64)}`,
    id: "cloudmarkup.pipeline.aws-notes-v1",
    version: "1.0.0",
  },
}).pipelineProfile;

describe("architecture CLI reviewed pipeline registry", () => {
  it("selects only an exact ID/version/digest registration", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const registry = createArchitectureCliPipelineRegistry([
        {
          ...registeredProfile,
          pipeline: fixturePipeline,
        },
      ]);
      const output = await createArchitectureCliService(
        createProfileBoundArchitectureCliPipeline(registry),
      ).execute({ command: "validate", root });
      expect(output).toMatchObject({ exitCode: 0, state: "succeeded" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed for an unavailable locked profile without fabricating Evidence", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const output = await createArchitectureCliService(
        createProfileBoundArchitectureCliPipeline(
          createArchitectureCliPipelineRegistry([]),
        ),
      ).execute({ command: "validate", root });
      expect(output).toMatchObject({
        diagnostics: [{ code: "cloudmarkup.cli.pipeline-profile-unavailable" }],
        evidence: { current: 0, failed: 0, stale: 0 },
        exitCode: 6,
        state: "failed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects ambiguous exact registrations", () => {
    const registration = { ...registeredProfile, pipeline: fixturePipeline };
    expect(() =>
      createArchitectureCliPipelineRegistry([registration, registration]),
    ).toThrow("exact and unique");
  });
});
