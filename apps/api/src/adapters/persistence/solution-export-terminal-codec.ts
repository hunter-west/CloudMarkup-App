import {
  asyncJobHandlerOutcomeV1Schema,
  asyncJobObjectReferenceV1Schema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import {
  solutionExportWorkflowPersistedOutputV1Schema,
  solutionExportWorkflowReadModelV1Schema,
} from "@cloudmarkup/solution-export-workflow/contracts";
import { z } from "zod";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunUnavailable,
  parsePreparedExportRun,
} from "./solution-export-run-codec.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const solutionExportExecutionIdentitySchema = z
  .object({
    jobId: id,
    organizationId: id,
    projectId: id,
    attemptId: id,
    attemptNumber: z.number().int().positive(),
    workerId: id,
    actorId: id,
    inputDigest: sha256DigestSchema,
  })
  .strict();

export const solutionExportTerminalReceiptSchema = z
  .object({
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.solution-export-terminal-receipt"),
    execution: solutionExportExecutionIdentitySchema,
    prepared: z.unknown().transform(parsePreparedExportRun),
    result: z
      .object({
        outcome: asyncJobHandlerOutcomeV1Schema,
        persistedOutput:
          solutionExportWorkflowPersistedOutputV1Schema.optional(),
        readModel: solutionExportWorkflowReadModelV1Schema.optional(),
      })
      .strict(),
    retained: z
      .object({
        manifestObjectId: id,
        archiveObject: asyncJobObjectReferenceV1Schema,
        archiveFileName: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}\.zip$/u),
        fileCount: z.number().int().min(0).max(2048),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const { execution, prepared, result, retained } = receipt;
    if (
      execution.jobId !== prepared.job.id ||
      execution.organizationId !== prepared.organizationId ||
      execution.projectId !== prepared.job.projectId ||
      execution.actorId !== prepared.createdByPrincipalId ||
      execution.inputDigest !==
        createSolutionExportRunInsertionBindingV1(prepared.workflowSubmission)
          .orchestrationInputSha256 ||
      result.outcome.outcome === "awaiting-user-input" ||
      (result.outcome.outcome === "succeeded" &&
        (result.outcome.output.family !== "solution-export-orchestration" ||
          retained === undefined ||
          result.persistedOutput === undefined ||
          result.readModel?.state !== "succeeded" ||
          !exportRunEqual(
            result.outcome.output.verifiedPackage,
            result.persistedOutput.verifiedPackage,
          ) ||
          !exportRunEqual(
            retained.archiveObject,
            result.persistedOutput.verifiedPackage.object,
          ))) ||
      (result.readModel !== undefined &&
        (result.readModel.jobId !== execution.jobId ||
          result.readModel.requestDigest !==
            prepared.workflowSubmission.requestDigest ||
          !exportRunEqual(
            result.readModel.subject,
            prepared.workflowSubmission.request.subject,
          ) ||
          result.readModel.targetSettingsDigest !==
            prepared.job.target.settingsDigest))
    )
      context.addIssue({
        code: "custom",
        message: "The terminal receipt must bind one exact prepared execution.",
      });
  });
export type SolutionExportTerminalReceipt = z.output<
  typeof solutionExportTerminalReceiptSchema
>;

export function parseSolutionExportTerminalReceipt(
  value: unknown,
): SolutionExportTerminalReceipt {
  if (exportRunBytes(value).length > 4 * 1024 * 1024) exportRunUnavailable();
  return solutionExportTerminalReceiptSchema.parse(value);
}
