import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { ApplicationError } from "./application/errors.js";
import { ObjectStoreError } from "./application/persistence.js";
import { applyAsyncJobLifecycleCommandV1 } from "@cloudmarkup/domain";
import { requireOperationFundingSource } from "./application/operation-funding.js";
import {
  JobWorker,
  DefaultJobFailureClassifier,
  createJobAuditOutboxEntryV1,
  isTerminalJobState,
  type JobQueuePublisherV1,
  type JobHandlerV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobQueueEnvelopeV1Schema,
  asyncJobAttemptIdSchema,
  asyncJobWorkerIdSchema,
  namespacedIdentifierSchema,
  utcTimestampSchema,
  asyncJobTrustedOwnershipV1Schema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import type {
  BetaInfrastructureApplication,
  BetaProposalBaselineReaderV1,
} from "./application/beta-infrastructure.js";
import type { BetaConverseUsage } from "@cloudmarkup/model-gateway";
import {
  assertBoundBetaProposalInput,
  parseBoundBetaProposalResult,
} from "./application/beta-proposal-result-binding.js";
import {
  PostgresBetaAiCreditMeter,
  betaAiReservationId,
  type BetaAiCreditIdentity,
} from "./adapters/persistence/beta-ai-credit-meter.js";
import { preparedBetaInfrastructureInputSchema } from "./application/beta-infrastructure.js";
import { betaProposalObjectReference } from "./application/beta-infrastructure-jobs.js";
import type { ObjectStore } from "./application/persistence.js";
import { BetaProposalJobAuthority } from "./adapters/persistence/beta-proposal-job-authority.js";
import { PostgresAsyncJobRepository } from "./adapters/persistence/async-job-repository.js";
import { SolutionExportProducerObjects } from "./adapters/persistence/solution-export-producer-objects.js";
import { ProductionSolutionExportAudit } from "./production-solution-export-audit.js";
import {
  exportRunBytes,
  exportRunSha,
  exportRunText,
} from "./adapters/persistence/solution-export-run-codec.js";
import { sql, type SqlDatabase } from "./adapters/persistence/sql.js";
import { createBetaProposalBaselineReader } from "./adapters/persistence/beta-proposal-baseline-reader.js";
import { isProviderDirectProposalJobIdV1 } from "./application/provider-direct-proposal-funding.js";

export interface ProviderDirectProposalExecutionV1 {
  readonly record: AsyncJobRecordV1;
  readonly attemptId: string;
  readonly workerId: string;
  readonly input: Parameters<BetaInfrastructureApplication["generate"]>[0];
  readonly signal: AbortSignal;
  readonly assertCurrent: () => Promise<void>;
  readonly baselineReader: BetaProposalBaselineReaderV1;
  readonly authority: BetaProposalJobAuthority;
  readonly lifecycleAuthority: BetaProposalJobAuthority;
}

export function createBetaInfrastructureWorker(options: {
  fundingSource?: "hosted-credits" | "provider-direct";
  generateProviderDirect?: (
    execution: ProviderDirectProposalExecutionV1,
  ) => ReturnType<BetaInfrastructureApplication["generate"]>;
  database: SqlDatabase;
  objectStore: ObjectStore;
  proposals: Pick<BetaInfrastructureApplication, "generate">;
  onFailure?: (diagnostic: {
    stage: "input" | "generation" | "publication";
    kind:
      | "authorization"
      | "draft-changed"
      | "model"
      | "storage"
      | "invalid-input"
      | "internal";
  }) => void;
  publisher: (
    ownership: ReturnType<typeof asyncJobTrustedOwnershipV1Schema.parse>,
  ) => JobQueuePublisherV1;
}) {
  const fundingSource = requireOperationFundingSource(options.fundingSource);
  if (
    (fundingSource === "provider-direct" &&
      typeof options.generateProviderDirect !== "function") ||
    (fundingSource === "hosted-credits" &&
      options.generateProviderDirect !== undefined)
  )
    throw new Error("Proposal funding composition is unavailable.");
  return {
    async process(value: unknown): Promise<"completed" | "pending"> {
      const envelope = asyncJobQueueEnvelopeV1Schema.parse(value);
      const authority = new BetaProposalJobAuthority(
        options.database,
        envelope,
      );
      const objects = new SolutionExportProducerObjects(
        authority,
        options.objectStore,
      );
      const audit = new ProductionSolutionExportAudit(
        authority,
        authority.ownership,
        "architecture-proposal",
      );
      const rows = await authority.query(
        sql(
          "SELECT input_object_id FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3",
          [
            authority.ownership.organizationId,
            authority.ownership.projectId,
            envelope.jobId,
          ],
        ),
      );
      const repository = new PostgresAsyncJobRepository({
        database: authority,
        objects: objects.jobPort(
          exportRunText(rows.rows[0]?.["input_object_id"]),
          envelope.inputDigest,
        ),
        ownership: envelope.ownership,
      });
      let root = await repository.get(envelope.jobId);
      const projectId = envelope.ownership.projectId;
      if (projectId === undefined)
        throw new Error("Proposal project is unavailable.");
      const creditIdentity: BetaAiCreditIdentity = {
        organizationId: envelope.ownership.organizationId,
        projectId,
        jobId: envelope.jobId,
        purpose: "proposal",
        requestSha256: envelope.inputDigest.slice(7),
      };
      const meter =
        fundingSource === "hosted-credits"
          ? new PostgresBetaAiCreditMeter(authority, options.database)
          : undefined;
      if (
        root?.family !== "architecture-proposal" ||
        root.input.family !== "architecture-proposal" ||
        root.inputDigest !== envelope.inputDigest
      )
        throw new Error("Proposal job unavailable.");
      if (
        fundingSource === "provider-direct"
          ? root.reservation.state !== "none" ||
            !isProviderDirectProposalJobIdV1(root.jobId)
          : isProviderDirectProposalJobIdV1(root.jobId)
      )
        throw new Error("Proposal funding does not match the durable job.");
      const reserved =
        root.reservation.state === "reserved" &&
        root.reservation.reservationId === betaAiReservationId(creditIdentity);
      const settleDelivered = async (job: NonNullable<typeof root>) => {
        if (job.output?.family !== "architecture-proposal")
          throw new Error("Delivered proposal output is unavailable.");
        if (meter === undefined) {
          const reference = job.output.proposal;
          const stored = await objects.metadata(reference.objectId);
          if (
            stored?.state !== "published" ||
            stored.reference.purpose !== "proposal" ||
            "sha256:" + stored.reference.contentSha256 !== reference.digest ||
            stored.reference.sizeBytes !== reference.sizeBytes
          )
            throw new Error("Delivered proposal output is unavailable.");
          return;
        }
        const recorded = await meter.recorded(creditIdentity);
        const stored = recorded
          ? await objects.metadata(recorded.outputObjectId)
          : null;
        if (
          !recorded ||
          stored?.state !== "published" ||
          stored.reference.purpose !== "proposal" ||
          stored.reference.objectId !== job.output.proposal.objectId ||
          stored.reference.contentSha256 !== recorded.outputSha256 ||
          job.output.proposal.digest !== "sha256:" + recorded.outputSha256
        )
          throw new Error("Delivered proposal credit evidence is unavailable.");
        await meter.settle(creditIdentity);
      };
      const workerId = asyncJobWorkerIdSchema.parse(
        "worker.proposal." + randomUUID(),
      );
      let failureStage: "input" | "generation" | "publication" = "input";
      const handler: JobHandlerV1 = {
        family: "architecture-proposal",
        handlerId: "cloudmarkup.beta-infrastructure-proposal",
        handlerVersion: "1.0.0",
        resumePolicy: "restart-from-input",
        async execute(record, context) {
          if (record.input.family !== "architecture-proposal")
            throw new Error("Invalid proposal input.");
          const reference = record.input.intentDocument;
          const stored = await objects.metadata(reference.objectId);
          if (
            stored?.state !== "published" ||
            stored.reference.purpose !== "input-payload" ||
            "sha256:" + stored.reference.contentSha256 !== reference.digest ||
            stored.reference.sizeBytes !== reference.sizeBytes
          )
            throw new Error("Proposal input unavailable.");
          const input = preparedBetaInfrastructureInputSchema.parse(
            JSON.parse(
              Buffer.from(await objects.read(stored.reference)).toString(
                "utf8",
              ),
            ),
          );
          assertBoundBetaProposalInput(input, record);
          const controller = new AbortController();
          let checking: Promise<void> | undefined;
          const check = async () => {
            if (await context.isCancellationRequested())
              throw new DOMException("Proposal cancelled.", "AbortError");
            await authority.assertExecution(workerId);
          };
          const baselineReader = createBetaProposalBaselineReader({
            authority,
            objectStore: options.objectStore,
            assertCurrent: check,
          });
          if (input.proposalVersion === 6) {
            if (!input.validationOwnership || !input.validationSubject)
              throw new Error("Semantic proposal authority unavailable.");
            await baselineReader({
              ownership: input.validationOwnership,
              subject: input.validationSubject,
            });
          }
          const timer = setInterval(() => {
            if (checking) return;
            checking = check()
              .catch(() => {
                controller.abort();
              })
              .finally(() => {
                checking = undefined;
              });
          }, 3000);
          try {
            if (fundingSource === "provider-direct") {
              const attempt = record.attempts.at(-1);
              if (
                record.state !== "running" ||
                record.reservation.state !== "none" ||
                attempt?.state !== "running" ||
                attempt.lease?.workerId !== workerId ||
                attempt.attemptNumber !== context.attemptNumber ||
                options.generateProviderDirect === undefined
              )
                throw new Error(
                  "Provider-direct proposal attempt is unavailable.",
                );
              failureStage = "generation";
              await check();
              const result = await options.generateProviderDirect({
                record: structuredClone(record),
                attemptId: attempt.attemptId,
                workerId,
                input,
                signal: controller.signal,
                assertCurrent: check,
                baselineReader,
                authority,
                lifecycleAuthority: authority,
              });
              parseBoundBetaProposalResult(input, result);
              failureStage = "publication";
              const bytes = exportRunBytes(result);
              await check();
              const output = await objects.put(
                bytes,
                "proposal",
                objects.identity(
                  "beta-proposal-output",
                  "sha256:" + exportRunSha(bytes),
                ),
              );
              await check();
              return {
                outcome: "succeeded",
                outputSizeBytes: bytes.length,
                output: {
                  contractVersion: 1,
                  family: "architecture-proposal",
                  evidenceRecords: [],
                  proposal: betaProposalObjectReference(output, "proposal"),
                },
              };
            }
            if (meter === undefined)
              throw new Error("Proposal credit reservation is unavailable.");
            if (!reserved)
              throw new Error("Proposal credit reservation is unavailable.");
            failureStage = "generation";
            const claim = await meter.claim(creditIdentity);
            if (claim === "uncertain")
              throw new Error("The prior model dispatch needs reconciliation.");
            let output;
            let bytes;
            if (claim === "recorded") {
              const recorded = await meter.recorded(creditIdentity);
              if (!recorded)
                throw new Error("Recorded model output is unavailable.");
              const stored = await objects.metadata(recorded.outputObjectId);
              if (
                stored?.state !== "published" ||
                stored.reference.purpose !== "proposal" ||
                stored.reference.contentSha256 !== recorded.outputSha256
              )
                throw new Error("Recorded model output is unavailable.");
              bytes = Buffer.from(await objects.read(stored.reference));
              parseBoundBetaProposalResult(
                input,
                JSON.parse(bytes.toString("utf8")),
              );
              output = stored.reference;
            } else {
              let usage: BetaConverseUsage | undefined;
              try {
                const result = await options.proposals.generate(
                  input,
                  controller.signal,
                  check,
                  180_000,
                  (actual) => {
                    usage = actual;
                    return Promise.resolve();
                  },
                  baselineReader,
                );
                parseBoundBetaProposalResult(input, result);
                if (!usage) throw new Error("Model usage is unavailable.");
                failureStage = "publication";
                bytes = exportRunBytes(result);
                await check();
                output = await objects.put(
                  bytes,
                  "proposal",
                  objects.identity(
                    "beta-proposal-output",
                    "sha256:" + exportRunSha(bytes),
                  ),
                );
                await meter.record(creditIdentity, {
                  outputObjectId: output.objectId,
                  outputSha256: output.contentSha256,
                  usage,
                });
              } catch (error) {
                await meter.release(creditIdentity);
                throw error;
              }
            }
            await check();
            return {
              outcome: "succeeded",
              outputSizeBytes: bytes.length,
              output: {
                contractVersion: 1,
                family: "architecture-proposal",
                evidenceRecords: [],
                proposal: betaProposalObjectReference(output, "proposal"),
              },
            };
          } finally {
            clearInterval(timer);
            await checking;
          }
        },
      };
      const save = async (
        result: ReturnType<typeof applyAsyncJobLifecycleCommandV1>,
        eventType: "orphan-reconciled" | "attempt-claimed" | "job-expired",
      ) => {
        if (!root) throw new Error("Proposal job unavailable.");
        const entry = createJobAuditOutboxEntryV1({
          actor: { kind: "worker", workerId },
          eventType,
          occurredAt: new Date().toISOString(),
          record: result.job,
          transition: result.transition,
        });
        root = await repository.saveWithAudit(result.job, root.recordVersion, [
          entry,
        ]);
        await audit.append(entry);
      };
      if (isTerminalJobState(root.state)) {
        if (meter === undefined && root.state === "succeeded")
          await settleDelivered(root);
        if (meter !== undefined && reserved) {
          if (root.state === "succeeded") await settleDelivered(root);
          else await meter.release(creditIdentity);
        }
        await audit.flush();
        return "completed";
      }
      if (root.state === "running") {
        const lease = root.attempts.at(-1)?.lease;
        if (lease && Date.parse(lease.leaseExpiresAt) > Date.now())
          return "pending";
        await save(
          applyAsyncJobLifecycleCommandV1(root, {
            kind: "reconcile-orphan",
            at: new Date().toISOString(),
            expectedInputDigest: root.inputDigest,
            expectedRecordVersion: root.recordVersion,
            handler: {
              family: handler.family,
              handlerId: namespacedIdentifierSchema.parse(handler.handlerId),
              handlerVersion: handler.handlerVersion,
              resumePolicy: handler.resumePolicy,
            },
          }),
          "orphan-reconciled",
        );
      }
      if (isTerminalJobState(root.state)) {
        if (meter === undefined && root.state === "succeeded")
          await settleDelivered(root);
        if (meter !== undefined && reserved) {
          if (root.state === "succeeded") await settleDelivered(root);
          else await meter.release(creditIdentity);
        }
        await audit.flush();
        return "completed";
      }
      if (root.state !== "queued") return "pending";
      const retry = root.attempts.at(-1)?.retryDisposition;
      if (retry?.kind === "retry" && Date.parse(retry.notBefore) > Date.now())
        return "pending";
      const at = new Date().toISOString();
      if (root.expiresAt && Date.parse(root.expiresAt) <= Date.parse(at)) {
        await save(
          applyAsyncJobLifecycleCommandV1(root, {
            kind: "expire",
            at,
            expectedInputDigest: root.inputDigest,
            expectedRecordVersion: root.recordVersion,
          }),
          "job-expired",
        );
        if (meter !== undefined && reserved)
          await meter.release(creditIdentity);
        await audit.flush();
        return "completed";
      }
      const remainingRuntime =
        root.limits.runtimeSeconds -
        root.attempts
          .filter((attempt) => attempt.state !== "running")
          .reduce((total, attempt) => total + attempt.runtimeSeconds, 0);
      const leaseMilliseconds = Math.min(
        240_000,
        remainingRuntime * 1_000,
        root.expiresAt ? Date.parse(root.expiresAt) - Date.parse(at) : 240_000,
      );
      await save(
        applyAsyncJobLifecycleCommandV1(root, {
          kind: "claim",
          at,
          attemptId: asyncJobAttemptIdSchema.parse("attempt." + randomUUID()),
          dependencies: [],
          expectedInputDigest: root.inputDigest,
          expectedRecordVersion: root.recordVersion,
          handler: {
            family: handler.family,
            handlerId: namespacedIdentifierSchema.parse(handler.handlerId),
            handlerVersion: handler.handlerVersion,
            resumePolicy: handler.resumePolicy,
          },
          leaseExpiresAt: utcTimestampSchema.parse(
            new Date(Date.parse(at) + leaseMilliseconds).toISOString(),
          ),
          workerId,
        }),
        "attempt-claimed",
      );
      const worker = new JobWorker({
        audit,
        clock: { now: () => new Date() },
        ids: { nextId: (kind) => kind + "." + randomUUID() },
        repository,
        publisher: options.publisher(envelope.ownership),
        handlers: {
          get: (family) => (family === handler.family ? handler : null),
        },
        failureClassifier: {
          classify(error, internalErrorId) {
            const kind =
              error instanceof ApplicationError
                ? error.code === "service_unavailable"
                  ? "model"
                  : error.code === "precondition_failed"
                    ? "draft-changed"
                    : "authorization"
                : error instanceof ObjectStoreError
                  ? "storage"
                  : error instanceof ZodError
                    ? "invalid-input"
                    : "internal";
            // Only fixed categories leave this boundary: no request, model text,
            // exception message, principal, project or storage key is logged.
            options.onFailure?.({ stage: failureStage, kind });
            return new DefaultJobFailureClassifier().classify(
              error,
              internalErrorId,
            );
          },
        },
        orchestration: {
          record: () =>
            Promise.reject(
              new Error("Proposal jobs cannot orchestrate child jobs."),
            ),
        },
      });
      const completed = await worker
        .runClaimed(root, workerId, leaseMilliseconds)
        .catch(async (error: unknown) => {
          // A project deletion can revoke the worker authority while the
          // provider is in flight. The job cannot publish in that state, so
          // release its hold through the internal accounting boundary.
          const status = await options.database.query(
            sql(
              `SELECT p.lifecycle_status AS project_state,j.lifecycle_status AS job_state
               FROM async_jobs j JOIN projects p
                 ON p.organization_id=j.organization_id AND p.project_id=j.project_id
               WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3`,
              [
                creditIdentity.organizationId,
                creditIdentity.projectId,
                creditIdentity.jobId,
              ],
            ),
          );
          const state = status.rows[0];
          if (
            meter !== undefined &&
            reserved &&
            state !== undefined &&
            state["project_state"] !== "active" &&
            state["job_state"] !== "succeeded"
          )
            await meter.release(creditIdentity);
          throw error;
        });
      if (
        meter !== undefined &&
        reserved &&
        isTerminalJobState(completed.state)
      ) {
        if (completed.state === "succeeded") await settleDelivered(completed);
        else await meter.release(creditIdentity);
      }
      if (meter === undefined && completed.state === "succeeded")
        await settleDelivered(completed);
      await audit.flush();
      return isTerminalJobState(completed.state) ? "completed" : "pending";
    },
  };
}
