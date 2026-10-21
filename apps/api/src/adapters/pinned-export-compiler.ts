import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS,
  solutionExportCompilerArgs,
  type SolutionExportCompilerCommandExecutor,
} from "@cloudmarkup/solution-export-workflow";
import {
  createPinnedGoInvocation,
  executeProcess,
  type PinnedCompilerConfiguration,
} from "./pinned-go-executable.js";

type Command = Parameters<SolutionExportCompilerCommandExecutor["execute"]>[0];
const fileNames = [
  "architecture.json",
  "solution-revision.json",
  "workload.json",
] as const;

function unavailable(): never {
  throw new Error("The pinned export compiler is unavailable.");
}
function validate(input: Command): void {
  if (
    (input.executable as unknown) !== "cloudmarkup-iac" ||
    !["terraform", "cloudformation"].some(
      (target) =>
        JSON.stringify(input.args) ===
        JSON.stringify(
          solutionExportCompilerArgs(target as "terraform" | "cloudformation"),
        ),
    ) ||
    JSON.stringify(Object.keys(input.files).sort()) !==
      JSON.stringify([...fileNames].sort()) ||
    fileNames.some((name) => typeof input.files[name] !== "string") ||
    fileNames.reduce(
      (sum, name) => sum + Buffer.byteLength(input.files[name], "utf8"),
      0,
    ) > SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS.maxInputBytes ||
    !Number.isSafeInteger(input.limits.maxOutputBytes) ||
    input.limits.maxOutputBytes < 1 ||
    input.limits.maxOutputBytes >
      SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS.maxOutputBytes ||
    !Number.isSafeInteger(input.limits.timeoutMilliseconds) ||
    input.limits.timeoutMilliseconds < 1 ||
    input.limits.timeoutMilliseconds >
      SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS.timeoutMilliseconds
  )
    unavailable();
}

export function createPinnedSolutionExportCompilerExecutor(
  configuration: PinnedCompilerConfiguration,
): SolutionExportCompilerCommandExecutor {
  const run = createPinnedGoInvocation(configuration);
  return {
    async execute(raw) {
      const input: Command = {
        executable: raw.executable,
        args: [...raw.args],
        files: { ...raw.files },
        limits: { ...raw.limits },
        signal: raw.signal,
      };
      validate(input);
      if (input.signal.aborted)
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          termination: "cancelled",
        };
      return run(async (executable, directory) => {
        for (const name of fileNames)
          await writeFile(join(directory, name), input.files[name], {
            flag: "wx",
            mode: 0o600,
          });
        return executeProcess(executable, directory, input);
      });
    },
  };
}
