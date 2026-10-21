import { randomUUID } from "node:crypto";
import { requireOperationFundingSource } from "./operation-funding.js";
import {
  JobService,
  JobFrameworkError,
  type CreateJobCommandV1,
  type JobQueuePublisherV1,
} from "@cloudmarkup/job-framework";
import {
  getAsyncJobCreateRequestDigestV1,
  getAsyncJobIdempotencyKeyDigestV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
} from "@cloudmarkup/domain";
import {
  asyncJobCreateRequestV1Schema,
  asyncJobTrustedContextV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobIdempotencyClaimV1Schema,
  asyncJobIdSchema,
  digestCanonicalValue,
  type CreateBetaInfrastructureProposalV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import {
  betaInfrastructureJobV1Schema,
  betaInfrastructureJobCreditsV1Schema,
  type BetaInfrastructureJobCreditsV1,
  type BetaInfrastructureJobV1,
} from "@cloudmarkup/api-contract";
import type { CloudMarkupApplication, PrincipalContext } from "./ports.js";
import type { ObjectStore } from "./persistence.js";
import {
  preparedBetaInfrastructureInputSchema,
  type BetaInfrastructureApplication,
} from "./beta-infrastructure.js";
import { ApplicationError } from "./errors.js";
import { ActiveProjectRequestAuthority } from "../adapters/persistence/solution-export-authority.js";
import { SolutionExportProducerObjects } from "../adapters/persistence/solution-export-producer-objects.js";
import { PostgresAsyncJobRepository } from "../adapters/persistence/async-job-repository.js";
import { ProductionSolutionExportAudit } from "../production-solution-export-audit.js";
import {
  exportRunBytes,
  exportRunSha,
  exportRunText,
} from "../adapters/persistence/solution-export-run-codec.js";
import { sql, type SqlDatabase } from "../adapters/persistence/sql.js";
import { PostgresBetaAiCreditMeter } from "../adapters/persistence/beta-ai-credit-meter.js";
import { betaAiEstimate } from "./beta-ai-pricing.js";
import {
  assertBoundBetaProposalInput,
  parseBoundBetaProposalResult,
} from "./beta-proposal-result-binding.js";
import {
  isProviderDirectProposalJobIdV1,
  PROVIDER_DIRECT_PROPOSAL_JOB_PREFIX_V1,
} from "./provider-direct-proposal-funding.js";

export interface BetaInfrastructureJobs {
  create(
    principal: PrincipalContext,
    projectId: string,
    request: CreateBetaInfrastructureProposalV1,
    etag: string,
    key: string,
  ): Promise<BetaInfrastructureJobV1>;
  get(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
  ): Promise<BetaInfrastructureJobV1>;
  credits(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
  ): Promise<BetaInfrastructureJobCreditsV1>;
  cancel(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
  ): Promise<BetaInfrastructureJobV1>;
}
export function betaProposalObjectReference(
  reference: Awaited<ReturnType<SolutionExportProducerObjects["put"]>>,
  purpose: "input-payload" | "proposal",
) {
  return asyncJobObjectReferenceV1Schema.parse({
    contractVersion: 1,
    objectId: reference.objectId,
    digest: "sha256:" + reference.contentSha256,
    sizeBytes: reference.sizeBytes,
    mediaType: "application/json",
    purpose,
  });
}
export function createBetaInfrastructureJobs(options: {
  /** Trusted server composition only; request bodies cannot choose funding. */
  fundingSource?: "hosted-credits" | "provider-direct";
  database: SqlDatabase;
  objectStore: ObjectStore;
  application: Pick<CloudMarkupApplication, "getProject">;
  proposals: BetaInfrastructureApplication;
  publisher: (ownership: AsyncJobRecordV1["ownership"]) => JobQueuePublisherV1;
}): BetaInfrastructureJobs {
  const fundingSource = requireOperationFundingSource(options.fundingSource);
  const unavailable = (): never => {
    throw new ApplicationError(
      "not_found",
      "The AI proposal job is unavailable.",
    );
  };
  async function authorized(principal: PrincipalContext, projectId: string) {
    const project = await options.application.getProject(principal, projectId);
    const ownership = asyncJobTrustedOwnershipV1Schema.parse({
      organizationId: project.value.organizationId,
      projectId,
    });
    const authority = new ActiveProjectRequestAuthority(
      options.database,
      principal,
      { organizationId: ownership.organizationId, projectId },
      "projects.mutate",
    );
    await authority.scope();
    const objects = new SolutionExportProducerObjects(
      authority,
      options.objectStore,
    );
    const context = asyncJobTrustedContextV1Schema.parse({
      ownership,
      actor: { kind: "principal", actorId: principal.principalId },
      correlationId: principal.correlationId,
    });
    const runtime = (
      objectId: string,
      digest: string,
      reservation?: {
        readonly estimatedCreditUnits: string;
        readonly reservedCreditUnits: string;
        readonly expiresAt: string;
      },
    ) => {
      const repository = new PostgresAsyncJobRepository({
        database: authority,
        ownership,
        objects: objects.jobPort(objectId, digest),
      });
      const service = new JobService({
        repository,
        publisher: options.publisher(ownership),
        clock: { now: () => new Date() },
        ids: { nextId: (kind) => kind + "." + randomUUID() },
        audit: new ProductionSolutionExportAudit(
          authority,
          authority.ownership,
          "architecture-proposal",
        ),
        ...(fundingSource === "provider-direct" || reservation === undefined
          ? {}
          : {
              reservation: {
                async reserve(input: { readonly jobId: string }) {
                  const scope = await authority.scope();
                  const meter = new PostgresBetaAiCreditMeter(
                    authority,
                    options.database,
                  );
                  try {
                    const held = await meter.reserve(
                      scope,
                      {
                        organizationId: ownership.organizationId,
                        projectId,
                        jobId: input.jobId,
                        purpose: "proposal",
                        requestSha256: digest.slice(7),
                      },
                      reservation.estimatedCreditUnits,
                      reservation.reservedCreditUnits,
                      reservation.expiresAt,
                    );
                    return { allowed: true, reservationId: held.reservationId };
                  } catch {
                    return {
                      allowed: false,
                      denialCode: "job.reservation-denied",
                      publicMessage: "job-temporarily-unavailable",
                    };
                  }
                },
              },
            }),
        entitlement: {
          async evaluate(input) {
            await authority.scope();
            return {
              allowed: input.family === "architecture-proposal",
              decisionReference: "owner-authorized-beta-preview-v1",
            };
          },
        },
      });
      return { repository, service };
    };
    return { authority, ownership, objects, context, runtime };
  }
  async function view(
    root: AsyncJobRecordV1,
    objects: SolutionExportProducerObjects,
  ): Promise<BetaInfrastructureJobV1> {
    if (
      root.family !== "architecture-proposal" ||
      root.input.family !== "architecture-proposal"
    )
      return unavailable();
    const inputReference = root.input.intentDocument;
    const inputStored = await objects.metadata(inputReference.objectId);
    if (
      inputStored?.state !== "published" ||
      inputStored.reference.purpose !== "input-payload" ||
      "sha256:" + inputStored.reference.contentSha256 !==
        inputReference.digest ||
      inputStored.reference.sizeBytes !== inputReference.sizeBytes
    )
      return unavailable();
    const input = preparedBetaInfrastructureInputSchema.parse(
      JSON.parse(
        Buffer.from(await objects.read(inputStored.reference)).toString("utf8"),
      ),
    );
    assertBoundBetaProposalInput(input, root);
    let result;
    if (root.state === "succeeded") {
      if (root.output?.family !== "architecture-proposal") return unavailable();
      const reference = root.output.proposal;
      const stored = await objects.metadata(reference.objectId);
      if (
        stored?.state !== "published" ||
        stored.reference.purpose !== "proposal" ||
        "sha256:" + stored.reference.contentSha256 !== reference.digest ||
        stored.reference.sizeBytes !== reference.sizeBytes
      )
        return unavailable();
      result = parseBoundBetaProposalResult(
        input,
        JSON.parse(
          Buffer.from(await objects.read(stored.reference)).toString("utf8"),
        ),
      );
    }
    return betaInfrastructureJobV1Schema.parse({
      contractVersion: 1,
      id: root.jobId,
      state: root.state,
      architectureDigest: input.architectureDigest,
      ...(result === undefined ? {} : { result }),
    });
  }
  async function read(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
    cancel = false,
  ) {
    const access = await authorized(principal, projectId);
    const found = await access.authority.query(
      sql(
        "SELECT input_object_id,input_sha256 FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3 AND family='architecture-proposal' AND created_by_principal_id=$4 AND idempotency_actor_id=$4 AND parent_job_id IS NULL AND root_job_id=job_id",
        [
          access.ownership.organizationId,
          projectId,
          jobId,
          principal.principalId,
        ],
      ),
    );
    if (found.rows.length !== 1) return unavailable();
    const runtime = access.runtime(
      exportRunText(found.rows[0]?.["input_object_id"]),
      "sha256:" + exportRunText(found.rows[0]?.["input_sha256"]),
    );
    let root = await runtime.repository.get(jobId);
    if (root?.idempotency.actorId !== principal.principalId)
      return unavailable();
    if (
      fundingSource === "provider-direct"
        ? root.reservation.state !== "none" ||
          !isProviderDirectProposalJobIdV1(root.jobId)
        : isProviderDirectProposalJobIdV1(root.jobId)
    )
      return unavailable();
    if (cancel) root = await runtime.service.cancel(access.context, jobId);
    if (root === null) return unavailable();
    // Polling also recovers uncertain queue publication, using the same job identity.
    if (root.state === "queued")
      await runtime.service.publishQueuedJob(access.context, jobId);
    const result = await view(root, access.objects);
    if (
      fundingSource === "hosted-credits" &&
      root.reservation.state === "reserved"
    ) {
      const identity = {
        organizationId: access.ownership.organizationId,
        projectId,
        jobId,
        purpose: "proposal" as const,
        requestSha256: root.inputDigest.slice(7),
      };
      const meter = new PostgresBetaAiCreditMeter(
        access.authority,
        options.database,
      );
      if (result.state === "succeeded") await meter.settle(identity);
      else if (["failed", "canceled", "expired"].includes(result.state))
        await meter.release(identity);
    }
    await access.authority.scope();
    return result;
  }
  return {
    async create(principal, projectId, request, etag, key) {
      const prepared = await options.proposals.prepare(
        principal,
        projectId,
        request,
        etag,
      );
      const access = await authorized(principal, projectId);
      if (access.ownership.organizationId !== prepared.organizationId)
        return unavailable();
      const bytes = exportRunBytes(prepared.request);
      const payload = await access.objects.put(
        bytes,
        "input-payload",
        access.objects.identity(
          "beta-proposal-request",
          "sha256:" + exportRunSha(bytes),
        ),
      );
      const input = {
        contractVersion: 1 as const,
        family: "architecture-proposal" as const,
        subject: prepared.subject,
        intentDocument: betaProposalObjectReference(payload, "input-payload"),
      };
      const create = asyncJobCreateRequestV1Schema.parse({
        contractVersion: 1,
        idempotencyKey: key,
        input,
        inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
      });
      const digest = getAsyncJobInputDigestV1(create.input);
      const initialRuntime = access.runtime(
        access.objects.identity("beta-proposal-input", digest),
        digest,
      );
      const idempotency = asyncJobIdempotencyClaimV1Schema.parse({
        actorId: principal.principalId,
        operationId: "cloudmarkup.beta-infrastructure-proposals.create",
        keyDigest: getAsyncJobIdempotencyKeyDigestV1(key),
        requestDigest: getAsyncJobCreateRequestDigestV1(create),
      });
      const claimSelector = {
        ownership: access.ownership,
        operationId: idempotency.operationId,
        keyDigest: idempotency.keyDigest,
      };
      const prior =
        await initialRuntime.repository.getCreationClaim(claimSelector);
      if (
        prior !== null &&
        (prior.creation.reservationRequested !==
          (fundingSource === "hosted-credits") ||
          (fundingSource === "provider-direct"
            ? !isProviderDirectProposalJobIdV1(prior.jobId)
            : isProviderDirectProposalJobIdV1(prior.jobId)))
      )
        throw new ApplicationError(
          "conflict",
          "This request key has different funding.",
        );
      const expiresAt =
        prior?.creation.expiresAt ??
        new Date(Date.now() + 3_600_000).toISOString();
      const runtime = access.runtime(
        access.objects.identity("beta-proposal-input", digest),
        digest,
        fundingSource === "provider-direct"
          ? undefined
          : {
              ...betaAiEstimate(
                prepared.request.modelInputBytes ?? bytes.length,
                prepared.request.proposalVersion >= 3 ? 6144 : 4096,
              ),
              expiresAt,
            },
      );
      const command: CreateJobCommandV1 = {
        request: create,
        inputDigest: digest,
        reservationRequested: fundingSource === "hosted-credits",
        expiresAt,
        limits: { attemptCount: 2, runtimeSeconds: 420, outputBytes: 262144 },
        idempotency,
        ...(fundingSource !== "provider-direct"
          ? {}
          : (() => {
              const parentId = asyncJobIdSchema.parse(
                prior?.jobId ??
                  PROVIDER_DIRECT_PROPOSAL_JOB_PREFIX_V1 +
                    digestCanonicalValue({
                      ownership: access.ownership,
                      actorId: principal.principalId,
                      operationId: idempotency.operationId,
                      keyDigest: idempotency.keyDigest,
                    }).slice(7),
              );
              return {
                preallocatedJobId: parentId,
              };
            })()),
      };
      const outcome = await runtime.service
        .create(access.context, command)
        .catch(async (error: unknown) => {
          if (
            !(error instanceof JobFrameworkError) ||
            error.code !== "job.idempotency-key-reused"
          )
            throw error;
          const raced =
            await runtime.repository.getCreationClaim(claimSelector);
          if (
            !raced?.creation.expiresAt ||
            raced.creation.reservationRequested !==
              (fundingSource === "hosted-credits") ||
            (fundingSource === "provider-direct"
              ? !isProviderDirectProposalJobIdV1(raced.jobId)
              : isProviderDirectProposalJobIdV1(raced.jobId)) ||
            raced.idempotency.requestDigest !== idempotency.requestDigest ||
            raced.idempotency.actorId !== principal.principalId
          )
            throw new ApplicationError(
              "conflict",
              "This request key was already used for a different proposal.",
            );
          return runtime.service.create(access.context, {
            ...command,
            expiresAt: raced.creation.expiresAt,
          });
        });
      if (outcome.kind === "denied")
        throw new ApplicationError(
          "access_denied",
          "AI proposal generation is unavailable for this account.",
        );
      if (outcome.kind === "in-progress")
        throw new ApplicationError(
          "service_unavailable",
          "The proposal is being queued. Retry with the same request key.",
        );
      if (
        fundingSource === "provider-direct"
          ? outcome.job.reservation.state !== "none" ||
            !isProviderDirectProposalJobIdV1(outcome.job.jobId)
          : isProviderDirectProposalJobIdV1(outcome.job.jobId)
      )
        return unavailable();
      return view(outcome.job, access.objects);
    },
    get: (p, id, job) => read(p, id, job),
    async credits(principal, projectId, jobId) {
      await read(principal, projectId, jobId);
      if (fundingSource === "provider-direct")
        return betaInfrastructureJobCreditsV1Schema.parse({
          contractVersion: 1,
          jobId,
          state: "not-metered",
        });
      const access = await authorized(principal, projectId);
      const found = await access.authority.query(
        sql(
          `SELECT i.state,i.estimated_credit_units,r.reserved_credit_units,
           (SELECT COALESCE(sum(a.settled_credit_units),0) FROM credit_reservation_allocations a
            WHERE a.organization_id=i.organization_id AND a.reservation_id=i.reservation_id) AS actual_credit_units
         FROM beta_ai_invocations i
         JOIN credit_reservations r ON r.organization_id=i.organization_id AND r.reservation_id=i.reservation_id
         WHERE i.organization_id=$1 AND i.project_id=$2 AND i.job_id=$3 AND i.purpose='proposal'`,
          [access.ownership.organizationId, projectId, jobId],
        ),
      );
      const row = found.rows[0];
      return betaInfrastructureJobCreditsV1Schema.parse({
        contractVersion: 1,
        jobId,
        ...(row === undefined
          ? { state: "not-metered" }
          : {
              state: row["state"],
              estimatedCreditUnits: String(row["estimated_credit_units"]),
              maximumCreditUnits: String(row["reserved_credit_units"]),
              ...(row["state"] === "settled" || row["state"] === "released"
                ? { actualCreditUnits: String(row["actual_credit_units"]) }
                : {}),
            }),
      });
    },
    cancel: (p, id, job) => read(p, id, job, true),
  };
}
