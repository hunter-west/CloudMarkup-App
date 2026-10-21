import type { ApplyDraftCommandV1 } from "@cloudmarkup/api-contract";
import {
  applyGraphCommand,
  getArchitectureDocumentContentHash,
  GraphCommandApplicationError,
} from "@cloudmarkup/domain";
import { ApplicationError } from "./errors.js";

/** Shared deterministic acceptance boundary for ordinary and reviewed commands. */
export function applyBoundDraftCommand(
  baseline: Parameters<typeof applyGraphCommand>[0],
  input: ApplyDraftCommandV1,
) {
  const binding = input.contentBinding;
  if (
    binding !== undefined &&
    getArchitectureDocumentContentHash(baseline) !==
      binding.expectedContentDigest
  )
    throw new ApplicationError(
      "precondition_failed",
      "The saved design changed after this proposal was prepared.",
    );
  let applied;
  try {
    applied = applyGraphCommand(baseline, input.command);
  } catch (error) {
    if (error instanceof GraphCommandApplicationError)
      throw new ApplicationError(
        "invalid_request",
        "The graph command could not be applied.",
        {
          fieldIssues: [
            {
              code: "draft.command-rejected",
              message:
                "The command failed schema, precondition, or graph validation.",
              path: ["body", "command"],
            },
          ],
        },
      );
    throw error;
  }
  if (
    binding !== undefined &&
    getArchitectureDocumentContentHash(applied.document) !==
      binding.resultingContentDigest
  )
    throw new ApplicationError(
      "invalid_request",
      "The command does not produce the reviewed design.",
    );
  return applied;
}
