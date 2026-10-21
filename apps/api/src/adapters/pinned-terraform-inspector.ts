import {
  createTerraformHCLInspectorCommand,
  type TerraformHCLInspectorPort,
} from "@cloudmarkup/repository-importer";
import {
  createPinnedGoInvocation,
  executeProcess,
  type PinnedCompilerConfiguration,
} from "./pinned-go-executable.js";

/** Parses Terraform syntax only. Repository content is stdin, never executable code. */
export function createPinnedTerraformHclInspector(
  configuration: PinnedCompilerConfiguration,
): TerraformHCLInspectorPort {
  const run = createPinnedGoInvocation(configuration);
  return createTerraformHCLInspectorCommand({
    executable: "cloudmarkup-iac",
    maximumInputBytes: 1024 * 1024,
    maximumOutputBytes: 8 * 1024 * 1024,
    executor: {
      async run(input) {
        const result = await run((executable, directory) =>
          executeProcess(executable, directory, {
            args: input.args,
            stdin: input.stdin,
            signal: AbortSignal.timeout(15_000),
            limits: {
              timeoutMilliseconds: 15_000,
              maxOutputBytes: input.maximumOutputBytes,
            },
          }),
        );
        return {
          exitCode: result.exitCode ?? -1,
          stdout: new TextEncoder().encode(result.stdout),
          stderr: new TextEncoder().encode(result.stderr),
          termination: result.termination,
        };
      },
    },
  });
}
