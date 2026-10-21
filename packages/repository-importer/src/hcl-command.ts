import {
  hclInspectionResultV1Schema,
  type HCLInspectionResultV1,
} from "./contracts.js";
import type { TerraformHCLInspectorPort } from "./service.js";

export interface TerraformHCLCommandExecutor {
  run(
    input: Readonly<{
      executable: string;
      args: readonly string[];
      stdin: Uint8Array;
      maximumOutputBytes: number;
      signal?: AbortSignal;
    }>,
  ): Promise<
    Readonly<{
      exitCode: number;
      stdout: Uint8Array;
      stderr: Uint8Array;
      termination:
        "completed" | "cancelled" | "timeout" | "output-limit" | "unavailable";
    }>
  >;
}

export function createTerraformHCLInspectorCommand(
  input: Readonly<{
    executable: string;
    executor: TerraformHCLCommandExecutor;
    maximumInputBytes?: number;
    maximumOutputBytes?: number;
    signal?: AbortSignal;
  }>,
): TerraformHCLInspectorPort {
  if (input.executable.length === 0 || /[\r\n\0]/u.test(input.executable)) {
    throw new Error("Terraform HCL inspector executable is invalid.");
  }
  const maximumInputBytes = input.maximumInputBytes ?? 8 * 1024 * 1024;
  const maximumOutputBytes = input.maximumOutputBytes ?? 8 * 1024 * 1024;
  return Object.freeze({
    async inspect(
      request: Readonly<{ path: string; source: Uint8Array }>,
    ): Promise<HCLInspectionResultV1> {
      if (request.source.byteLength > maximumInputBytes) {
        throw new Error("Terraform HCL input exceeds the approved limit.");
      }
      const args = Object.freeze([
        "inspect-terraform-hcl",
        "--input",
        "-",
        "--output",
        "-",
        "--max-input-bytes",
        String(maximumInputBytes),
        "--max-output-bytes",
        String(maximumOutputBytes),
      ]);
      const result = await input.executor.run({
        executable: input.executable,
        args,
        stdin: request.source,
        maximumOutputBytes,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (
        result.termination !== "completed" ||
        (result.exitCode !== 0 && result.exitCode !== 2) ||
        result.stdout.byteLength > maximumOutputBytes
      ) {
        throw new Error("Terraform HCL inspector did not complete safely.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
        );
      } catch {
        throw new Error("Terraform HCL inspector returned malformed output.");
      }
      return hclInspectionResultV1Schema.parse(parsed);
    },
  });
}
