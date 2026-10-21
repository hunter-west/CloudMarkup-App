import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { canonicalJson } from "@cloudmarkup/application-build-runner";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { goCompilationResultV1Schema } from "@cloudmarkup/solution-export-workflow";
import { expect, it } from "vitest";
import {
  createPinnedGoInvocation,
  executeProcess,
} from "./adapters/pinned-go-executable.js";
import { createProductionRepairSeedSourceV1 } from "./production-model-live-repair-seed-source.js";

async function cleanupRoot(root: string): Promise<void> {
  const local = relative(tmpdir(), root);
  if (
    local.startsWith("..") ||
    !basename(root).startsWith("cloudmarkup-seed-normalization-")
  )
    throw Error("Invalid test cleanup root.");
  await rm(root, { recursive: true, force: false });
}

const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
it.skipIf(executablePath === undefined || executableSha256 === undefined)(
  "matches actual stdin-only Go normalization structure without claiming manifest or build evidence",
  async () => {
    const source = createProductionRepairSeedSourceV1();
    const root = await mkdtemp(
      join(tmpdir(), "cloudmarkup-seed-normalization-"),
    );
    try {
      const invoke = createPinnedGoInvocation({
        executablePath: executablePath ?? "",
        executableSha256: executableSha256 ?? "",
        temporaryRoot: root,
      });
      const observation = await invoke(async (executable, directory) => {
        expect(await readdir(directory)).toEqual([basename(executable)]);
        const result = await executeProcess(executable, directory, {
          args: [
            "normalize",
            "--architecture",
            "-",
            "--target",
            "terraform",
            "--output",
            "-",
            "--max-input-bytes",
            "1048576",
            "--max-output-bytes",
            "2097152",
          ],
          stdin: new TextEncoder().encode(
            canonicalJson(source.generationRequest.architectureDocument),
          ),
          limits: { maxOutputBytes: 2097152, timeoutMilliseconds: 30000 },
          signal: new AbortController().signal,
        });
        expect(await readdir(directory)).toEqual([basename(executable)]);
        return result;
      });
      expect(observation.termination).toBe("completed");
      expect(observation.exitCode).toBe(0);
      expect(observation.stderr).toBe("");
      const observed = goCompilationResultV1Schema.parse(
        JSON.parse(observation.stdout) as unknown,
      );
      expect(observed.compiler).toEqual({
        id: "cloudmarkup.iac-compiler",
        version: "1.2.1",
        digest:
          "sha256:2c25a5610c825d171a167a38201c3090aa2278071ddd648bb957e67b7b98f203",
      });
      expect(observed.artifact).toBeUndefined();
      expect(
        (observed.diagnostics ?? [])
          .filter((item) => item.severity === "error")
          .map((item) => item.code),
      ).toEqual([]);
      if (observed.model === undefined)
        throw Error("Expected actual normalized model.");
      const expected = source.generationRequest.normalizedSolution;
      // The CLI receives only the architecture. Manifest provenance and selected
      // generator compatibility are intentionally outside this structural proof.
      const { solutionRevisionId, ...provenance } = expected.provenance;
      expect(solutionRevisionId).toBe(
        source.generationRequest.solutionRevision.solutionRevisionId,
      );
      expect(observed.model.provenance.solutionRevisionId).toBeUndefined();
      expect(
        observed.model.workloads.map((workload) => workload.generatorReadiness),
      ).toEqual(
        expected.workloads.map(() => ({
          state: "not-selected",
          reasons: ["APPLICATION_GENERATOR_NOT_PINNED"],
        })),
      );
      const omitReadiness = <
        T extends { readonly generatorReadiness: unknown },
      >(
        workload: T,
      ) => {
        const { generatorReadiness, ...structure } = workload;
        expect(generatorReadiness).toBeDefined();
        return structure;
      };
      const actualStructure = {
        ...observed.model,
        workloads: observed.model.workloads.map(omitReadiness),
      };
      const expectedStructure = {
        ...expected,
        provenance,
        workloads: expected.workloads.map(omitReadiness),
      };
      expect(digestCanonicalValue(actualStructure)).toBe(
        digestCanonicalValue(expectedStructure),
      );
      expect(await readdir(root)).toEqual([]);
    } finally {
      await cleanupRoot(root);
    }
  },
  45000,
);
