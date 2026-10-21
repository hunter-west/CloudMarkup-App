import { rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { runArchitectureCliExecutable } from "./executable.js";
import { architectureCliRepositoryProfileV1Schema } from "./contracts.js";
import type { ArchitectureCliPipelineV1 } from "./service.js";
import {
  architectureCliFixtureArtifact,
  architectureCliFixtureSnapshot,
  writeArchitectureCliFixtureRepository,
} from "./test-fixtures.js";

const pipeline: ArchitectureCliPipelineV1 = {
  inspect: () =>
    Promise.resolve({
      artifact: architectureCliFixtureArtifact(),
      diagnostics: [],
      evidence: { current: 4, failed: 0, stale: 0, unavailableLevels: [] },
      semanticSnapshot: architectureCliFixtureSnapshot(),
      state: "ready",
    }),
  run: () =>
    Promise.resolve({
      artifact: architectureCliFixtureArtifact(),
      diagnostics: [],
      evidence: { current: 4, failed: 0, stale: 0, unavailableLevels: [] },
      semanticSnapshot: architectureCliFixtureSnapshot(),
      state: "ready",
    }),
};

const profile = architectureCliRepositoryProfileV1Schema.parse({
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

describe("generated repository command-line fixture", () => {
  it("runs every command through one exact locked pipeline with repeatable JSON", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const outputs = new Map<string, string>();
      for (const command of [
        "validate",
        "generate",
        "verify",
        "diff",
        "render",
        "test",
        "evidence",
      ] as const) {
        let stdout = "";
        const exit = await runArchitectureCliExecutable({
          args: [command, "--root", root, "--format", "json"],
          registrations: [{ ...profile, pipeline }],
          stderr: { write: () => undefined },
          stdout: { write: (value) => (stdout += value) },
        });
        expect(exit).toBe(0);
        expect(stdout).not.toMatch(/(?:token|secret|[A-Za-z]:\\|file:\/\/)/iu);
        outputs.set(command, stdout);
      }

      let repeated = "";
      const repeatedExit = await runArchitectureCliExecutable({
        args: ["verify", "--root", root, "--format", "json"],
        registrations: [{ ...profile, pipeline }],
        stderr: { write: () => undefined },
        stdout: { write: (value) => (repeated += value) },
      });
      expect(repeatedExit).toBe(0);
      expect(repeated).toBe(outputs.get("verify"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 15_000);
});
