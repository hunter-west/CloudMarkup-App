import { solutionExportTargetProfileIdV1Schema } from "@cloudmarkup/api-contract";
import {
  namespacedIdentifierSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import {
  SolutionExportWorkflowFailureError,
  type SolutionExportWorkflowTargetSettingsV1,
} from "@cloudmarkup/solution-export-workflow";
import { ApplicationError } from "./application/errors.js";
import { PostgresSolutionExportTargetPolicy } from "./adapters/persistence/solution-export-target-policy.js";
import { assertProductionSolutionExportRequest } from "./production-solution-export-host.js";
import type { DurableSolutionExportHandlerOptions } from "./solution-export-worker.js";

export async function assertProductionSolutionExportStageAdmission(
  input: Parameters<
    NonNullable<
      DurableSolutionExportHandlerOptions["assertCurrentStageAdmission"]
    >
  >[0],
  settings: SolutionExportWorkflowTargetSettingsV1,
  executionEnabled = true,
): Promise<void> {
  const { prepared, authority, stage } = input;
  if (!executionEnabled) {
    throw new SolutionExportWorkflowFailureError({
      classification: "permanent",
      code: namespacedIdentifierSchema.parse(
        "cloudmarkup.export.host-disabled",
      ),
      publicMessage: "export-input-invalid",
      stage,
    });
  }
  const request = prepared.workflowSubmission.request;
  assertProductionSolutionExportRequest(request, settings);
  try {
    await new PostgresSolutionExportTargetPolicy(
      authority,
      request.targetSettings,
    ).evaluateForWorker({
      organizationId: prepared.organizationId,
      environment: prepared.job.target.environment,
      targetProfileId: solutionExportTargetProfileIdV1Schema.parse(
        prepared.targetProfileId,
      ),
      ...(request.applicationDelivery === undefined
        ? {}
        : { applicationDelivery: request.applicationDelivery }),
      binding: {
        organizationId: prepared.organizationId,
        projectId: prepared.job.projectId,
        solutionRevisionId: prepared.job.solutionRevision.solutionRevisionId,
        manifestRecordId: prepared.job.solutionRevision.manifestRecordId,
        manifestDigest: sha256DigestSchema.parse(
          prepared.job.solutionRevision.manifestDigest,
        ),
        generationCoverage: prepared.job.generationCoverage,
        workflowSources: request.sources,
        // This host rejects application inputs and independently verifies both
        // immutable workload representations before any compiler execution.
        applicationCodeRequired: request.applicationDelivery !== undefined,
      },
    });
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      (error.code === "access_denied" || error.code === "service_unavailable")
    )
      throw new SolutionExportWorkflowFailureError({
        classification: "permanent",
        code: namespacedIdentifierSchema.parse(
          "cloudmarkup.export.current-commercial-admission-denied",
        ),
        publicMessage: "export-input-invalid",
        stage,
      });
    throw error;
  }
}
