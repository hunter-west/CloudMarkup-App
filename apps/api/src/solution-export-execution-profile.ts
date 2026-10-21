import {
  architectureDocumentV2Schema,
  architectureDocumentV3Schema,
  namespacedIdentifierSchema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import {
  SolutionExportWorkflowFailureError,
  infrastructureOnlyDeliveryInputsMatch,
  type SolutionExportCompilerPort,
  type SolutionExportWorkflowStageIdV1,
} from "@cloudmarkup/solution-export-workflow";

import { BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES } from "./solution-export-limits.js";

/** A missing host capability is a permanent, bounded failure, never a successful stage. */
export function unsupportedSolutionExportStage(
  stage: SolutionExportWorkflowStageIdV1,
): never {
  throw new SolutionExportWorkflowFailureError({
    classification: "permanent",
    code: namespacedIdentifierSchema.parse(
      "cloudmarkup.export.host-stage-unavailable",
    ),
    publicMessage: "export-input-invalid",
    stage,
  });
}

/** Called only after the workflow has resolved and verified immutable input bytes. */
export function assertCloudFormationInfrastructureOnly(
  input: Parameters<SolutionExportCompilerPort["compile"]>[0],
): void {
  if (input.request.applicationDelivery !== undefined) {
    if (!infrastructureOnlyDeliveryInputsMatch(input))
      unsupportedSolutionExportStage("compile-infrastructure");
    return;
  }
  const document = architectureDocumentV3Schema.safeParse(
    input.sources.architectureDocument,
  );
  const historical = document.success
    ? document
    : architectureDocumentV2Schema.safeParse(
        input.sources.architectureDocument,
      );
  if (
    input.request.targetProfileId !==
      "cloudmarkup.export.cloudformation-nodejs24-v1" ||
    input.request.targetSettings.target !== "cloudformation" ||
    input.request.sources.applicationBuildInputs !== undefined ||
    input.sources.applicationBuildInputs !== undefined ||
    !historical.success ||
    historical.data.workloadBehavior.workloads.some(
      (workload) => workload.implementation.mode !== "infrastructure-only",
    )
  ) {
    unsupportedSolutionExportStage("compile-infrastructure");
  }
  // Checking both source representations prevents a separate workload input from
  // requesting code generation while the containing architecture appears safe.
  try {
    if (
      serializeCanonicalJson(historical.data.workloadBehavior) !==
      serializeCanonicalJson(input.sources.workloadBehavior)
    ) {
      unsupportedSolutionExportStage("compile-infrastructure");
    }
  } catch {
    unsupportedSolutionExportStage("compile-infrastructure");
  }
}

/** Enforce the hosted download transport bound before a package stage can succeed. */
export function assertBufferedSolutionExportArchiveFitsDownload(
  bytes: Uint8Array,
): void {
  if (bytes.byteLength > BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES) {
    throw new SolutionExportWorkflowFailureError({
      classification: "permanent",
      code: namespacedIdentifierSchema.parse(
        "cloudmarkup.export.host-package-size-limit",
      ),
      publicMessage: "export-input-invalid",
      stage: "package-export",
    });
  }
}
