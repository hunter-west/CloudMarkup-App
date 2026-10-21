import { applyAsyncJobLifecycleCommandV1 } from "@cloudmarkup/domain";
import { solutionExportJobV1Schema } from "@cloudmarkup/api-contract";
import {
  namespacedIdentifierSchema,
  parseAsyncJobRecordV1,
  sha256DigestSchema,
  utcTimestampSchema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunSha,
  exportRunUnavailable,
  parsePreparedExportRun,
} from "./solution-export-run-codec.js";
import { solutionExportExecutionIdentitySchema } from "./solution-export-terminal-codec.js";
import { solutionExportExecutionIdentity } from "./solution-export-worker-authority.js";

/** The same registered restart policy as a normal export worker. No caller can
 * choose a failure code, change limits, or substitute another handler. */
export function solutionExportOrphanTransition(
  input: unknown,
  atInput: string,
) {
  const root = parseAsyncJobRecordV1(input);
  solutionExportExecutionIdentity(root);
  const at = utcTimestampSchema.parse(atInput);
  const lease = root.attempts.at(-1)?.lease;
  if (lease === undefined || Date.parse(at) < Date.parse(lease.leaseExpiresAt))
    exportRunUnavailable();
  const result = applyAsyncJobLifecycleCommandV1(root, {
    kind: "reconcile-orphan",
    at,
    expectedInputDigest: root.inputDigest,
    expectedRecordVersion: root.recordVersion,
    handler: {
      family: "solution-export-orchestration",
      handlerId: namespacedIdentifierSchema.parse(
        "cloudmarkup.solution-export.workflow",
      ),
      handlerVersion: "1.0.0",
      resumePolicy: "restart-from-input",
    },
  });
  if (
    result.transition === undefined ||
    !["queued", "failed", "canceled", "expired"].includes(result.job.state)
  )
    exportRunUnavailable();
  return { ...result, transition: result.transition };
}

/** A host reconciliation receipt is deliberately not a worker workflow result.
 * The prior immutable snapshot and canonical transition are the evidence. */
const orphanReceiptSchema = z
  .object({
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.solution-export-orphan-terminal-receipt"),
    execution: solutionExportExecutionIdentitySchema,
    prepared: z.unknown().transform(parsePreparedExportRun),
    priorRecordVersion: z.number().int().positive(),
    priorSnapshot: z
      .object({
        contractVersion: z.literal(1),
        objectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
        digest: sha256DigestSchema,
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(4 * 1024 * 1024),
        purpose: z.literal("report"),
        mediaType: z.literal("application/json"),
      })
      .strict(),
    reconciledAt: utcTimestampSchema,
    terminalState: z.enum(["failed", "canceled", "expired"]),
    terminalRootDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const { execution, prepared, priorSnapshot } = receipt;
    if (
      execution.jobId !== prepared.job.id ||
      execution.organizationId !== prepared.organizationId ||
      execution.projectId !== prepared.job.projectId ||
      execution.actorId !== prepared.createdByPrincipalId ||
      execution.inputDigest !==
        createSolutionExportRunInsertionBindingV1(prepared.workflowSubmission)
          .orchestrationInputSha256 ||
      priorSnapshot.sizeBytes > 4 * 1024 * 1024
    )
      context.addIssue({
        code: "custom",
        message:
          "Orphan settlement must bind one immutable admitted export execution.",
      });
  });
export type SolutionExportOrphanReceipt = z.output<typeof orphanReceiptSchema>;

export function parseSolutionExportOrphanReceipt(
  value: unknown,
): SolutionExportOrphanReceipt {
  if (exportRunBytes(value).length > 4 * 1024 * 1024) exportRunUnavailable();
  return orphanReceiptSchema.parse(value);
}

export function verifySolutionExportOrphanReceipt(
  receiptInput: unknown,
  priorInput: unknown,
  terminalInput?: unknown,
) {
  const receipt = parseSolutionExportOrphanReceipt(receiptInput);
  const prior = parseAsyncJobRecordV1(priorInput);
  if (
    !exportRunEqual(
      solutionExportExecutionIdentity(prior),
      receipt.execution,
    ) ||
    prior.recordVersion !== receipt.priorRecordVersion ||
    receipt.priorSnapshot.digest !==
      `sha256:${exportRunSha(exportRunBytes(prior))}` ||
    receipt.priorSnapshot.sizeBytes !== exportRunBytes(prior).length
  )
    exportRunUnavailable();
  const derived = solutionExportOrphanTransition(prior, receipt.reconciledAt);
  if (
    derived.job.state !== receipt.terminalState ||
    receipt.terminalRootDigest !==
      `sha256:${exportRunSha(exportRunBytes(derived.job))}` ||
    (terminalInput !== undefined &&
      !exportRunEqual(derived.job, parseAsyncJobRecordV1(terminalInput)))
  )
    exportRunUnavailable();
  return { receipt, prior, ...derived };
}

/** Reports only the actual lost-execution settlement. It never invents compiler,
 * validator, package or application-build evidence that the worker did not retain. */
export function projectSolutionExportOrphanTerminal(
  receipt: SolutionExportOrphanReceipt,
  prior: AsyncJobRecordV1,
  terminal: AsyncJobRecordV1,
): StoredSolutionExportJob {
  verifySolutionExportOrphanReceipt(receipt, prior, terminal);
  const prepared = receipt.prepared;
  const canceled = terminal.state === "canceled";
  const completedAt = terminal.completedAt;
  if (
    completedAt === undefined ||
    (canceled && terminal.cancellation.state !== "acknowledged")
  )
    exportRunUnavailable();
  const message = canceled
    ? "The export was canceled after its worker stopped. No download was published."
    : terminal.state === "expired"
      ? "The export expired before a download could be published. Start a new export to try again."
      : "The export stopped after reaching its execution limit. No download was published. Start a new export to try again.";
  const stages = prepared.job.stages.map((stage) => ({
    ...stage,
    status:
      stage.stage === "publication"
        ? canceled
          ? ("canceled" as const)
          : ("failed" as const)
        : stage.status === "running"
          ? ("pending" as const)
          : stage.status,
  }));
  return {
    ...prepared,
    job: solutionExportJobV1Schema.parse({
      ...prepared.job,
      artifact: undefined,
      cancellation: canceled
        ? {
            state: "acknowledged",
            requestedAt:
              terminal.cancellation.state === "acknowledged"
                ? terminal.cancellation.requestedAt
                : undefined,
          }
        : terminal.cancellation.state === "requested"
          ? {
              state: "requested",
              requestedAt: terminal.cancellation.requestedAt,
            }
          : { state: "none" },
      completedAt,
      diagnostics: canceled
        ? []
        : [
            {
              code:
                terminal.state === "expired"
                  ? "cloudmarkup.job.expired"
                  : terminal.failure?.code,
              severity: "error",
              stage: "publication",
              message,
            },
          ],
      evidence: [],
      pollAfterMilliseconds: undefined,
      progress: {
        completedStages: stages.filter(({ status }) =>
          ["succeeded", "failed", "canceled", "skipped"].includes(status),
        ).length,
        totalStages: 8,
        message,
      },
      stages,
      state: canceled ? "canceled" : "failed",
      updatedAt: completedAt,
    }),
  };
}
