import { describe, expect, it } from "vitest";

import {
  SOLUTION_EXPORT_COMPILER_ARGS,
  SOLUTION_EXPORT_COMPILER_EXECUTABLE,
  createGoCliSolutionExportCompilerPort,
  solutionExportCompilerArgs,
} from "./compiler-command-adapter.js";
import { SolutionExportWorkflowFailureError } from "./orchestrator.js";
import type { SolutionExportCompilerCommandExecutor } from "./ports.js";
import { TEST_TARGET_SETTINGS } from "./workflow.test-support.js";

const wireResult = {
  compiler: {
    digest: TEST_TARGET_SETTINGS.stageDescriptors.compiler.adapter.digest,
    id: "cloudmarkup.iac-compiler",
    version: "1.1.0",
  },
  contractVersion: 1,
  diagnostics: null,
};

function completed(
  overrides: Partial<
    Awaited<ReturnType<SolutionExportCompilerCommandExecutor["execute"]>>
  > = {},
): Awaited<ReturnType<SolutionExportCompilerCommandExecutor["execute"]>> {
  return {
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify(wireResult),
    termination: "completed",
    ...overrides,
  };
}

function compileInput(
  signal = new AbortController().signal,
  target: "cloudformation" | "terraform" = "terraform",
) {
  return {
    request: { targetSettings: { target } } as never,
    signal,
    settings: TEST_TARGET_SETTINGS.stageDescriptors.compiler,
    sources: {
      architectureDocument: {
        displayName: "$(touch should-not-run); --output stolen.json",
      },
      solutionRevision: { solutionRevisionId: "solution-revision.1" },
      workloadBehavior: { command: "& calc.exe" },
    },
  };
}

function failureCode(error: unknown): string | undefined {
  return error instanceof SolutionExportWorkflowFailureError
    ? error.failure.code
    : undefined;
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

function thrownValue(run: () => unknown): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the callback to throw.");
}

describe("fixed Go CLI compiler adapter", () => {
  it("retains validated compiler findings on the Go CLI validation exit status", async () => {
    const failed = {
      ...wireResult,
      diagnostics: [
        {
          code: "CLOUDFORMATION_LAMBDA_WORKLOAD_REQUIRED",
          severity: "error",
          message:
            "Each supported Lambda function must own exactly one Workload record.",
          source: { document: "architecture", nodeId: "node.lambda" },
        },
      ],
    };
    const compiler = createGoCliSolutionExportCompilerPort({
      executor: {
        execute: () =>
          Promise.resolve(
            completed({ exitCode: 2, stdout: JSON.stringify(failed) }),
          ),
      },
    });
    await expect(compiler.compile(compileInput())).resolves.toEqual(failed);
  });

  it.each([
    null,
    [],
    [
      {
        code: "WARNING",
        severity: "warning",
        message: "Warning.",
        source: { document: "architecture" },
      },
    ],
  ])(
    "does not treat an unsuccessful exit without errors as a compilation result",
    async (diagnostics) => {
      const compiler = createGoCliSolutionExportCompilerPort({
        executor: {
          execute: () =>
            Promise.resolve(
              completed({
                exitCode: 2,
                stdout: JSON.stringify({ ...wireResult, diagnostics }),
              }),
            ),
        },
      });
      expect(
        failureCode(await rejectedValue(compiler.compile(compileInput()))),
      ).toBe("cloudmarkup.export.compiler-command-failed");
    },
  );

  it("checks the compiler pin before accepting failed-compilation diagnostics", async () => {
    const compiler = createGoCliSolutionExportCompilerPort({
      executor: {
        execute: () =>
          Promise.resolve(
            completed({
              exitCode: 2,
              stdout: JSON.stringify({
                ...wireResult,
                compiler: {
                  ...wireResult.compiler,
                  digest: "sha256:" + "0".repeat(64),
                },
                diagnostics: [
                  {
                    code: "INPUT_INVALID",
                    severity: "error",
                    message: "Invalid input.",
                    source: { document: "architecture" },
                  },
                ],
              }),
            }),
          ),
      },
    });
    expect(
      failureCode(await rejectedValue(compiler.compile(compileInput()))),
    ).toBe("cloudmarkup.export.compiler-pin-mismatch");
  });

  it("uses one allow-listed executable, exact argv, and bounded named files", async () => {
    let captured:
      | Parameters<SolutionExportCompilerCommandExecutor["execute"]>[0]
      | undefined;
    const executor: SolutionExportCompilerCommandExecutor = {
      execute(input) {
        captured = input;
        return Promise.resolve(completed());
      },
    };
    const compiler = createGoCliSolutionExportCompilerPort({ executor });

    await expect(compiler.compile(compileInput())).resolves.toEqual(wireResult);

    expect(captured?.executable).toBe(SOLUTION_EXPORT_COMPILER_EXECUTABLE);
    expect(captured?.args).toEqual(SOLUTION_EXPORT_COMPILER_ARGS);
    expect(Object.keys(captured?.files ?? {}).sort()).toEqual([
      "architecture.json",
      "solution-revision.json",
      "workload.json",
    ]);
    expect(captured?.args.join(" ")).not.toContain("touch");
    expect(captured?.args.join(" ")).not.toContain("calc.exe");
    expect(captured?.files["architecture.json"]).toContain("should-not-run");
  });

  it("passes the sealed CloudFormation target without expanding executable authority", async () => {
    let captured:
      | Parameters<SolutionExportCompilerCommandExecutor["execute"]>[0]
      | undefined;
    const compiler = createGoCliSolutionExportCompilerPort({
      executor: {
        execute(input) {
          captured = input;
          return Promise.resolve(completed());
        },
      },
    });

    await compiler.compile(
      compileInput(new AbortController().signal, "cloudformation"),
    );

    expect(captured?.executable).toBe(SOLUTION_EXPORT_COMPILER_EXECUTABLE);
    expect(captured?.args).toEqual(
      solutionExportCompilerArgs("cloudformation"),
    );
    expect(captured?.args).not.toEqual(SOLUTION_EXPORT_COMPILER_ARGS);
  });

  it("rejects every executable override", () => {
    const error = thrownValue(() =>
      createGoCliSolutionExportCompilerPort({
        executable: "C:\\operator\\cloudmarkup-iac.exe --unsafe",
        executor: { execute: () => Promise.resolve(completed()) },
      }),
    );

    expect(failureCode(error)).toBe(
      "cloudmarkup.export.compiler-executable-forbidden",
    );
  });

  it.each([
    [
      "timeout",
      completed({ exitCode: null, termination: "timeout" }),
      "cloudmarkup.export.compiler-temporarily-unavailable",
      "transient",
    ],
    [
      "unavailable",
      completed({ exitCode: null, termination: "unavailable" }),
      "cloudmarkup.export.compiler-temporarily-unavailable",
      "transient",
    ],
    [
      "cancelled",
      completed({ exitCode: null, termination: "cancelled" }),
      "cloudmarkup.export.compiler-canceled",
      "permanent",
    ],
    [
      "output-limit",
      completed({ exitCode: null, termination: "output-limit" }),
      "cloudmarkup.export.compiler-output-limit",
      "permanent",
    ],
  ] as const)(
    "maps %s termination to a sanitized typed failure",
    async (_name, result, code, classification) => {
      const compiler = createGoCliSolutionExportCompilerPort({
        executor: { execute: () => Promise.resolve(result) },
      });

      const error = await rejectedValue(compiler.compile(compileInput()));

      expect(error).toBeInstanceOf(SolutionExportWorkflowFailureError);
      expect(error).toMatchObject({
        failure: { classification, code },
      });
    },
  );

  it("checks cancellation before invoking the process boundary", async () => {
    let calls = 0;
    const compiler = createGoCliSolutionExportCompilerPort({
      executor: {
        execute() {
          calls += 1;
          return Promise.resolve(completed());
        },
      },
    });
    const controller = new AbortController();
    controller.abort();

    const error = await rejectedValue(
      compiler.compile(compileInput(controller.signal)),
    );

    expect(failureCode(error)).toBe("cloudmarkup.export.compiler-canceled");
    expect(calls).toBe(0);
  });

  it("rejects output over the byte limit even if the executor misreports completion", async () => {
    const compiler = createGoCliSolutionExportCompilerPort({
      executor: {
        execute: () =>
          Promise.resolve(completed({ stdout: JSON.stringify(wireResult) })),
      },
      limits: {
        maxInputBytes: 1_024,
        maxOutputBytes: 16,
        timeoutMilliseconds: 1_000,
      },
    });

    const error = await rejectedValue(compiler.compile(compileInput()));

    expect(failureCode(error)).toBe("cloudmarkup.export.compiler-output-limit");
  });

  it("rejects malformed JSON and never exposes stderr", async () => {
    const secret = "C:\\private\\customer\\main.tf: provider token=do-not-leak";
    const malformed = createGoCliSolutionExportCompilerPort({
      executor: {
        execute: () => Promise.resolve(completed({ stdout: "not-json" })),
      },
    });
    const failedCommand = createGoCliSolutionExportCompilerPort({
      executor: {
        execute: () =>
          Promise.resolve(
            completed({ exitCode: 1, stderr: secret, stdout: "" }),
          ),
      },
    });

    const malformedError = await rejectedValue(
      malformed.compile(compileInput()),
    );
    const commandError = await rejectedValue(
      failedCommand.compile(compileInput()),
    );

    expect(failureCode(malformedError)).toBe(
      "cloudmarkup.export.compiler-json-invalid",
    );
    expect(failureCode(commandError)).toBe(
      "cloudmarkup.export.compiler-command-failed",
    );
    expect(JSON.stringify(commandError)).not.toContain(secret);
    expect((commandError as Error).message).not.toContain(secret);
  });

  it("rejects a valid compiler result that does not match the approved adapter pin", async () => {
    const compiler = createGoCliSolutionExportCompilerPort({
      executor: {
        execute: () =>
          Promise.resolve(
            completed({
              stdout: JSON.stringify({
                ...wireResult,
                compiler: {
                  ...wireResult.compiler,
                  digest: `sha256:${"0".repeat(64)}`,
                },
              }),
            }),
          ),
      },
    });

    expect(
      failureCode(await rejectedValue(compiler.compile(compileInput()))),
    ).toBe("cloudmarkup.export.compiler-pin-mismatch");
  });
});
