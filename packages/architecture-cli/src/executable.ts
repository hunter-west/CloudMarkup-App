import { runArchitectureCli } from "./cli.js";
import {
  createArchitectureCliPipelineRegistry,
  createProfileBoundArchitectureCliPipeline,
  type ArchitectureCliPipelineRegistrationV1,
} from "./registry.js";
import { createArchitectureCliService } from "./service.js";
import type { ArchitectureCliConformancePortV1 } from "./conformance.js";
import type { ArchitectureCliRepositoryImportPortV1 } from "./repository-import.js";

export async function runArchitectureCliExecutable(input: {
  readonly args: readonly string[];
  readonly conformance?: ArchitectureCliConformancePortV1;
  readonly registrations: readonly ArchitectureCliPipelineRegistrationV1[];
  readonly repositoryImporter?: ArchitectureCliRepositoryImportPortV1;
  readonly signal?: AbortSignal;
  readonly stderr: { write(value: string): unknown };
  readonly stdout: { write(value: string): unknown };
}): Promise<number> {
  const pipeline = createProfileBoundArchitectureCliPipeline(
    createArchitectureCliPipelineRegistry(input.registrations),
  );
  return runArchitectureCli({
    args: input.args,
    service: createArchitectureCliService(
      pipeline,
      input.repositoryImporter,
      input.conformance,
    ),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    stderr: input.stderr,
    stdout: input.stdout,
  });
}
