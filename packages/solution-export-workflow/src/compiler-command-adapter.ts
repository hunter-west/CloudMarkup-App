import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import { goCompilationResultV1Schema } from "./compiler-projection.js";
import { solutionExportWorkflowFailureV1Schema } from "./contracts.js";
import { SolutionExportWorkflowFailureError } from "./orchestrator.js";
import type {
  SolutionExportCompilerCommandExecutor,
  SolutionExportCompilerPort,
} from "./ports.js";

export const SOLUTION_EXPORT_COMPILER_EXECUTABLE = "cloudmarkup-iac" as const;
export function solutionExportCompilerArgs(
  target: "cloudformation" | "terraform",
): readonly string[] {
  return Object.freeze([
    "compile",
    "--architecture",
    "architecture.json",
    "--workload",
    "workload.json",
    "--solution-revision",
    "solution-revision.json",
    "--target",
    target,
    "--output",
    "-",
  ]);
}

export const SOLUTION_EXPORT_COMPILER_ARGS =
  solutionExportCompilerArgs("terraform");

export const SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS = Object.freeze({
  maxInputBytes: 12 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  timeoutMilliseconds: 30_000,
} as const);

export interface GoCliSolutionExportCompilerPortDependencies {
  readonly executable?: string;
  readonly executor: SolutionExportCompilerCommandExecutor;
  readonly limits?: {
    readonly maxInputBytes: number;
    readonly maxOutputBytes: number;
    readonly timeoutMilliseconds: number;
  };
}

function commandFailure(
  code: string,
  publicMessage:
    | "export-compile-failed"
    | "export-input-invalid"
    | "export-temporarily-unavailable",
  classification: "permanent" | "transient" = "permanent",
): SolutionExportWorkflowFailureError {
  return new SolutionExportWorkflowFailureError(
    solutionExportWorkflowFailureV1Schema.parse({
      classification,
      code,
      publicMessage,
      ...(classification === "transient" ? { retryAfterSeconds: 30 } : {}),
      stage: "compile-infrastructure",
    }),
  );
}

function checkedLimits(
  input: GoCliSolutionExportCompilerPortDependencies["limits"],
): Required<GoCliSolutionExportCompilerPortDependencies>["limits"] {
  const limits = input ?? SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS;
  if (
    !Number.isSafeInteger(limits.maxInputBytes) ||
    limits.maxInputBytes < 1 ||
    limits.maxInputBytes >
      SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS.maxInputBytes ||
    !Number.isSafeInteger(limits.maxOutputBytes) ||
    limits.maxOutputBytes < 1 ||
    limits.maxOutputBytes >
      SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS.maxOutputBytes ||
    !Number.isSafeInteger(limits.timeoutMilliseconds) ||
    limits.timeoutMilliseconds < 1 ||
    limits.timeoutMilliseconds >
      SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS.timeoutMilliseconds
  ) {
    throw commandFailure(
      "cloudmarkup.export.compiler-limits-invalid",
      "export-input-invalid",
    );
  }
  return limits;
}

function compilerFiles(
  sources: Parameters<SolutionExportCompilerPort["compile"]>[0]["sources"],
  maxInputBytes: number,
): Readonly<
  Record<
    "architecture.json" | "solution-revision.json" | "workload.json",
    string
  >
> {
  let files: Readonly<
    Record<
      "architecture.json" | "solution-revision.json" | "workload.json",
      string
    >
  >;
  try {
    files = Object.freeze({
      "architecture.json": serializeCanonicalJson(sources.architectureDocument),
      "solution-revision.json": serializeCanonicalJson(
        sources.solutionRevision,
      ),
      "workload.json": serializeCanonicalJson(sources.workloadBehavior),
    });
  } catch {
    throw commandFailure(
      "cloudmarkup.export.compiler-input-invalid",
      "export-input-invalid",
    );
  }
  const size = Object.values(files).reduce(
    (total, value) => total + new TextEncoder().encode(value).byteLength,
    0,
  );
  if (size > maxInputBytes) {
    throw commandFailure(
      "cloudmarkup.export.compiler-input-limit",
      "export-input-invalid",
    );
  }
  return files;
}

export function createGoCliSolutionExportCompilerPort(
  dependencies: GoCliSolutionExportCompilerPortDependencies,
): SolutionExportCompilerPort {
  if (
    (dependencies.executable ?? SOLUTION_EXPORT_COMPILER_EXECUTABLE) !==
    SOLUTION_EXPORT_COMPILER_EXECUTABLE
  ) {
    throw commandFailure(
      "cloudmarkup.export.compiler-executable-forbidden",
      "export-input-invalid",
    );
  }
  const limits = checkedLimits(dependencies.limits);
  return {
    async compile(input) {
      if (input.signal.aborted) {
        throw commandFailure(
          "cloudmarkup.export.compiler-canceled",
          "export-compile-failed",
        );
      }
      const result = await dependencies.executor.execute({
        args: solutionExportCompilerArgs(input.request.targetSettings.target),
        executable: SOLUTION_EXPORT_COMPILER_EXECUTABLE,
        files: compilerFiles(input.sources, limits.maxInputBytes),
        limits: {
          maxOutputBytes: limits.maxOutputBytes,
          timeoutMilliseconds: limits.timeoutMilliseconds,
        },
        signal: input.signal,
      });
      const outputBytes = new TextEncoder().encode(
        `${result.stdout}${result.stderr}`,
      ).byteLength;
      if (
        result.termination === "timeout" ||
        result.termination === "unavailable"
      ) {
        throw commandFailure(
          "cloudmarkup.export.compiler-temporarily-unavailable",
          "export-temporarily-unavailable",
          "transient",
        );
      }
      if (
        result.termination === "output-limit" ||
        outputBytes > limits.maxOutputBytes
      ) {
        throw commandFailure(
          "cloudmarkup.export.compiler-output-limit",
          "export-compile-failed",
        );
      }
      if (result.termination === "cancelled") {
        throw commandFailure(
          "cloudmarkup.export.compiler-canceled",
          "export-compile-failed",
        );
      }
      // The Go CLI exits 2 for a structured validation failure. Preserve its
      // checked diagnostics so the workflow can record an actionable failure.
      if (result.exitCode !== 0 && result.exitCode !== 2) {
        throw commandFailure(
          "cloudmarkup.export.compiler-command-failed",
          "export-compile-failed",
        );
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(result.stdout) as unknown;
      } catch {
        throw commandFailure(
          "cloudmarkup.export.compiler-json-invalid",
          "export-compile-failed",
        );
      }
      const parsed = goCompilationResultV1Schema.safeParse(decoded);
      if (!parsed.success) {
        throw commandFailure(
          "cloudmarkup.export.compiler-result-invalid",
          "export-compile-failed",
        );
      }
      if (
        parsed.data.compiler.digest !== input.settings.adapter.digest ||
        parsed.data.compiler.id !== input.settings.adapter.id ||
        parsed.data.compiler.version !== input.settings.adapter.version
      ) {
        throw commandFailure(
          "cloudmarkup.export.compiler-pin-mismatch",
          "export-compile-failed",
        );
      }
      if (
        result.exitCode === 2 &&
        (parsed.data.artifact !== undefined ||
          parsed.data.diagnostics?.some(
            ({ severity }) => severity === "error",
          ) !== true)
      ) {
        throw commandFailure(
          "cloudmarkup.export.compiler-command-failed",
          "export-compile-failed",
        );
      }
      return parsed.data;
    },
  };
}
