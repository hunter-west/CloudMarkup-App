import { generateApplication } from "@cloudmarkup/application-generator";
import {
  applicationGenerationRequestV1Schema,
  type ApplicationGenerationResultV1,
  type ApplicationGenerationRequestV1,
} from "@cloudmarkup/schemas";

import { solutionExportWorkflowFailureV1Schema } from "./contracts.js";
import { SolutionExportWorkflowFailureError } from "./orchestrator.js";
import type { SolutionExportApplicationGeneratorPort } from "./ports.js";

export class SolutionExportApplicationGenerationInputError extends Error {
  public constructor() {
    super("Application generation input bindings are invalid.");
    this.name = "SolutionExportApplicationGenerationInputError";
  }
}

function abortError(): Error {
  const error = new Error("Application generation was canceled.");
  error.name = "AbortError";
  return error;
}

function permanentGenerationFailure(
  error: unknown,
): SolutionExportWorkflowFailureError {
  const inputInvalid =
    error instanceof SolutionExportApplicationGenerationInputError;
  return new SolutionExportWorkflowFailureError(
    solutionExportWorkflowFailureV1Schema.parse({
      classification: "permanent",
      code: inputInvalid
        ? "cloudmarkup.export.application-generation-input-invalid"
        : "cloudmarkup.export.application-generation-failed",
      publicMessage: inputInvalid
        ? "export-input-invalid"
        : "export-generation-failed",
      stage: "generate-application",
    }),
  );
}

/** Build the strict generator request exclusively from resolved workflow data. */
export function applicationGenerationRequestFromWorkflowInput(
  input: Parameters<SolutionExportApplicationGeneratorPort["generate"]>[0],
): ApplicationGenerationRequestV1 {
  const parsed = applicationGenerationRequestV1Schema.safeParse({
    architectureDocument: input.sources.architectureDocument,
    contractVersion: 1,
    existingFiles: input.sources.existingFiles ?? [],
    generator: input.settings.adapter,
    normalizedSolution: input.compilation.model,
    pattern: input.settings.pattern,
    runtime: input.settings.runtime,
    solutionRevision: input.sources.solutionRevision,
    template: input.settings.template,
    workloadBehavior: input.sources.workloadBehavior,
  });
  if (!parsed.success) {
    throw new SolutionExportApplicationGenerationInputError();
  }
  return parsed.data;
}

/** Connect the workflow to the deterministic in-process application generator. */
export function createSolutionExportApplicationGeneratorPort(): SolutionExportApplicationGeneratorPort & {
  generate(
    input: Parameters<SolutionExportApplicationGeneratorPort["generate"]>[0],
  ): Promise<ApplicationGenerationResultV1>;
} {
  return {
    generate(input) {
      return Promise.resolve()
        .then(() => {
          if (input.signal.aborted) {
            throw abortError();
          }
          const result = generateApplication(
            applicationGenerationRequestFromWorkflowInput(input),
          );
          return result;
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") {
            throw error;
          }
          throw permanentGenerationFailure(error);
        });
    },
  };
}
