import { rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ARCHITECTURE_CLI_EXIT_CODES } from "./contracts.js";
import {
  createArchitectureCliService,
  type ArchitectureCliPipelineV1,
} from "./service.js";
import {
  architectureCliFixtureArtifact,
  architectureCliFixtureSnapshot,
  writeArchitectureCliFixtureRepository,
} from "./test-fixtures.js";

function pipeline(changed = false, failed = false): ArchitectureCliPipelineV1 {
  const result = {
    ...(changed || !failed
      ? { artifact: architectureCliFixtureArtifact(changed) }
      : {}),
    diagnostics: failed
      ? [
          {
            code: "cloudmarkup.cli.test-pipeline-failed" as const,
            message: "The approved local test pipeline did not pass." as const,
            severity: "error" as const,
          },
        ]
      : [],
    evidence: {
      current: 3,
      failed: failed ? 1 : 0,
      stale: 0,
      unavailableLevels: [6, 7, 8, 9],
    },
    semanticSnapshot: architectureCliFixtureSnapshot(changed),
    state: failed ? ("failed" as const) : ("ready" as const),
  };
  return {
    inspect: () =>
      Promise.resolve({
        ...result,
        artifact: architectureCliFixtureArtifact(),
        semanticSnapshot: architectureCliFixtureSnapshot(),
        state: "ready" as const,
      }),
    run: () => Promise.resolve(result),
  };
}

async function execute(
  command: Parameters<
    ReturnType<typeof createArchitectureCliService>["execute"]
  >[0]["command"],
  adapter = pipeline(),
) {
  const root = await writeArchitectureCliFixtureRepository();
  try {
    return await createArchitectureCliService(adapter).execute({
      command,
      root,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("architecture CLI command service", () => {
  it.each([
    "validate",
    "generate",
    "diff",
    "render",
    "test",
    "evidence",
  ] as const)("executes %s with stable success semantics", async (command) => {
    const output = await execute(command);
    expect(output.exitCode).toBe(ARCHITECTURE_CLI_EXIT_CODES.success);
    expect(output.solutionRevision?.id).toBeTruthy();
  });

  it("passes no-drift verification after isolated repeated regeneration", async () => {
    const first = await execute("verify");
    const repeated = await execute("verify");
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ exitCode: 0, state: "succeeded" });
  });

  it("returns stable drift and semantic changes without mutating the repository", async () => {
    const output = await execute("verify", pipeline(true));
    expect(output).toMatchObject({
      exitCode: ARCHITECTURE_CLI_EXIT_CODES.drift,
      state: "drift",
    });
    expect(output.fileChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          change: "modified",
          path: "infrastructure/main.tf",
        }),
      ]),
    );
    expect(output.semanticChanges.map(({ kind }) => kind)).toContain(
      "public-exposure-changed",
    );
  });

  it("refuses a diagram-only render when non-diagram outputs also drift", async () => {
    const output = await execute("render", pipeline(true));
    expect(output).toMatchObject({
      diagnostics: [{ code: "cloudmarkup.cli.render-output-mismatch" }],
      exitCode: ARCHITECTURE_CLI_EXIT_CODES.conflict,
      state: "conflict",
    });
  });

  it("keeps failed validation visible and does not fabricate Evidence", async () => {
    const output = await execute("test", pipeline(false, true));
    expect(output).toMatchObject({
      evidence: { failed: 1 },
      exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
      state: "failed",
    });
  });

  it("independently rejects a corrupted generated artifact", async () => {
    const adapter = pipeline();
    const corrupted: ArchitectureCliPipelineV1 = {
      ...adapter,
      run: async (input) => {
        const output = await adapter.run(input);
        const artifact = output.artifact;
        if (artifact === undefined) return output;
        return {
          ...output,
          artifact: {
            ...artifact,
            zipBytes: Uint8Array.of(0),
          },
        };
      },
    };
    const output = await execute("verify", corrupted);
    expect(output).toMatchObject({
      diagnostics: [{ code: "cloudmarkup.cli.pipeline-artifact-invalid" }],
      exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
      state: "failed",
    });
  });
});
