import { describe, expect, it } from "vitest";

import { runArchitectureCli } from "./cli.js";
import { architectureCliCommandResultV1Schema } from "./contracts.js";

function serviceResult(command: "validate" | "import" = "validate") {
  return architectureCliCommandResultV1Schema.parse({
    command,
    contractVersion: 1,
    diagnostics: [],
    exitCode: 0,
    fileChanges: [],
    semanticChanges: [],
    state: "succeeded",
  });
}

describe("cloudmarkup command transport", () => {
  it("uses strict command/options and stable usage exit code", async () => {
    let stderr = "";
    const exit = await runArchitectureCli({
      args: ["validate", "--unknown", "value"],
      service: { execute: () => Promise.resolve(serviceResult()) },
      stderr: { write: (value) => (stderr += value) },
      stdout: { write: () => undefined },
    });
    expect(exit).toBe(2);
    expect(stderr).toContain("usage: cloudmarkup");
  });

  it("accepts the explicit --source alias for repository import", async () => {
    let root = "";
    const exit = await runArchitectureCli({
      args: ["import", "--source", "C:/bounded/repository", "--format", "json"],
      service: {
        execute: (input) => {
          root = input.root;
          return Promise.resolve(serviceResult("import"));
        },
      },
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });
    expect(exit).toBe(0);
    expect(root).toBe("C:/bounded/repository");
  });

  it("bounds command output before writing stdout", async () => {
    let stderr = "";
    let stdout = "";
    const exit = await runArchitectureCli({
      args: ["validate", "--format", "json"],
      service: {
        execute: () =>
          Promise.resolve({
            ...serviceResult(),
            diagnostics: [
              {
                code: "cloudmarkup.cli.output-limit-test",
                message: "x".repeat(9 * 1024 * 1024),
                severity: "error",
              },
            ],
          } as never),
      },
      stderr: { write: (value) => (stderr += value) },
      stdout: { write: (value) => (stdout += value) },
    });
    expect(exit).toBe(7);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "cloudmarkup: sanitized command output exceeded the configured byte limit.\n",
    );
  });

  it("emits canonical machine-readable JSON and stable human output", async () => {
    for (const format of ["json", "human"] as const) {
      let output = "";
      const exit = await runArchitectureCli({
        args: ["validate", "--format", format],
        service: { execute: () => Promise.resolve(serviceResult()) },
        stderr: { write: () => undefined },
        stdout: { write: (value) => (output += value) },
      });
      expect(exit).toBe(0);
      expect(output).not.toMatch(/(?:token|secret|[A-Za-z]:\\)/iu);
      if (format === "json")
        expect(JSON.parse(output)).toEqual(serviceResult());
      else {
        expect(output).toContain("cloudmarkup validate: succeeded");
        expect(output).toContain(
          "Deployment: not performed; this CLI does not apply infrastructure or create CloudFormation change sets.",
        );
      }
    }
  });
});
