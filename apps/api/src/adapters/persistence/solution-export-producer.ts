import { requireOperationFundingSource } from "../../application/operation-funding.js";
import {
  JobService,
  selectJobPublicationTransportV1,
  type JobAuditPort,
  type JobEntitlementPort,
  type JobIdGenerator,
  type JobPublicationReadinessPort,
  type JobPublicationTransportV1,
  type JobCreationClaimV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobTrustedContextV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import type { ObjectStore } from "../../application/persistence.js";
import type { PrincipalContext } from "../../application/ports.js";
import type {
  ImmutableSolutionRevisionExportBinding,
  StoredSolutionExportJob,
} from "../../application/solution-exports.js";
import { solutionExportRootAdmissionCommand } from "../../application/solution-export-root-admission.js";
import { isProviderDirectExportFundingReferenceV1 } from "../../application/provider-direct-export-funding.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import { ApplicationError } from "../../application/errors.js";
import { PostgresAsyncJobRepository } from "./async-job-repository.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import { PostgresSolutionExportRunRepository } from "./solution-export-run-repository.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunSha,
  exportRunUnavailable,
  parsePreparedExportRun,
  parseStoredExportRun,
} from "./solution-export-run-codec.js";
import { sql, type SqlDatabase } from "./sql.js";

interface ImmutableInputs {
  getImmutableBinding(input: {
    organizationId: string;
    projectId: string;
    solutionRevisionId: string;
  }): Promise<ImmutableSolutionRevisionExportBinding | null>;
  prepare(expected: ImmutableSolutionRevisionExportBinding): Promise<void>;
}

/** A genuine queued root is necessary but insufficient: the exact run and every
 * referenced source must be committed and readable before any queue publication. */
export class SolutionExportPublicationReadiness implements JobPublicationReadinessPort {
  readonly authority: SolutionExportRequestAuthority;
  readonly objects: SolutionExportProducerObjects;
  readonly runs: PostgresSolutionExportRunRepository;
  constructor(
    authority: SolutionExportRequestAuthority,
    objects: SolutionExportProducerObjects,
    runs: PostgresSolutionExportRunRepository,
  ) {
    this.authority = authority;
    this.objects = objects;
    this.runs = runs;
  }
  async isReady(root: AsyncJobRecordV1): Promise<boolean> {
    if (
      root.family !== "solution-export-orchestration" ||
      root.state !== "queued" ||
      root.cancellation.state !== "none" ||
      !exportRunEqual(root.ownership, this.authority.ownership) ||
      root.idempotency.actorId !== this.authority.principal.principalId
    )
      return false;
    const run = await this.runs.getJob({
      ...this.authority.ownership,
      jobId: root.jobId,
    });
    if (run?.record.job.state !== "queued") return false;
    const record = run.record;
    const keys = await this.authority.query(
      sql(
        "SELECT idempotency_key_sha256 FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
        [
          root.ownership.organizationId,
          root.ownership.projectId ?? null,
          root.jobId,
        ],
      ),
    );
    const key = keys.rows[0]?.["idempotency_key_sha256"];
    if (typeof key !== "string") return false;
    const command = solutionExportRootAdmissionCommand(record, `sha256:${key}`);
    if (
      !exportRunEqual(command.idempotency, root.idempotency) ||
      !exportRunEqual(command.request.input, root.input) ||
      command.inputDigest !== root.inputDigest ||
      root.createdAt !== record.job.createdAt
    )
      return false;
    await this.runs.assertPreparedRoot(record, `sha256:${key}`);
    for (const [name, reference] of Object.entries(
      record.workflowSubmission.request.sources,
    )) {
      if (reference === undefined) continue;
      const object = await this.objects.metadata(reference.objectId);
      const purpose =
        name === "architectureDocument"
          ? "architecture-revision"
          : name === "solutionRevision"
            ? "solution-revision-manifest"
            : "input-payload";
      if (
        object?.state !== "published" ||
        object.reference.purpose !== purpose ||
        object.reference.contentSha256 !== reference.digest.slice(7) ||
        object.reference.sizeBytes !== reference.sizeBytes
      )
        return false;
      await this.objects.read(object.reference);
    }
    const current = await this.runs.getJob({
      ...this.authority.ownership,
      jobId: root.jobId,
    });
    await this.authority.scope();
    return current !== null && exportRunEqual(current, run);
  }
}

/** Internal prepared producer. No terminal stage worker, target policy, public
 * cross-key coalescing or downloadable-artifact behavior is fabricated here. */
export type DurableSolutionExportProducerOptions = JobPublicationTransportV1 & {
  /** Trusted static composition; omitted retains hosted credit behavior. */
  readonly fundingSource?: "hosted-credits" | "provider-direct";
  /** Only the separately admitted PG17 local profile uses its restricted INSERT function. */
  readonly localRestrictedInsert?: boolean;
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly principal: PrincipalContext;
  readonly ownership: {
    readonly organizationId: string;
    readonly projectId: string;
  };
  readonly revisions: ImmutableInputs;
  readonly audit: JobAuditPort;
  readonly entitlement: JobEntitlementPort;
  readonly ids: JobIdGenerator;
  readonly clock?: () => Date;
};
export class DurableSolutionExportProducer {
  readonly authority: SolutionExportRequestAuthority;
  readonly objects: SolutionExportProducerObjects;
  readonly runs: PostgresSolutionExportRunRepository;
  readonly options: DurableSolutionExportProducerOptions;
  constructor(options: DurableSolutionExportProducerOptions) {
    selectJobPublicationTransportV1(options);
    requireOperationFundingSource(options.fundingSource);
    this.options = options;
    this.authority = new SolutionExportRequestAuthority(
      options.database,
      options.principal,
      options.ownership,
      "exports.run",
      options.clock,
    );
    this.objects = new SolutionExportProducerObjects(
      this.authority,
      options.objectStore,
    );
    this.runs = new PostgresSolutionExportRunRepository({
      database: options.database,
      objectStore: options.objectStore,
      principal: options.principal,
      ...(options.localRestrictedInsert === true
        ? { localRestrictedInsert: true }
        : {}),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
  }
  #fundedRecord(record: StoredSolutionExportJob): StoredSolutionExportJob {
    const direct = isProviderDirectExportFundingReferenceV1(
      record.workflowSubmission.entitlementDecisionReference,
    );
    if (direct !== (this.options.fundingSource === "provider-direct"))
      exportRunUnavailable();
    return record;
  }
  async #assertDirectRootFunding(
    root: AsyncJobRecordV1,
    record: StoredSolutionExportJob,
    repository: PostgresAsyncJobRepository,
  ): Promise<void> {
    if (this.options.fundingSource !== "provider-direct") return;
    const claim = await repository.getCreationClaim({
      ownership: root.ownership,
      operationId: root.idempotency.operationId,
      keyDigest: root.idempotency.keyDigest,
    });
    if (
      root.reservation.state !== "none" ||
      claim?.jobId !== root.jobId ||
      claim.status !== "completed" ||
      claim.entitlementDecision?.allowed !== true ||
      claim.entitlementDecision.decisionReference !==
        record.workflowSubmission.entitlementDecisionReference
    )
      exportRunUnavailable();
  }
  async prepare(input: {
    readonly record: StoredSolutionExportJob;
    readonly idempotencyKeyDigest: string;
  }): Promise<{
    readonly record: StoredSolutionExportJob;
    readonly dispatched: boolean;
  }> {
    return this.#prepare(input, true);
  }
  /** Commit a genuinely selected root/run without publishing its envelope yet. */
  async prepareSelected(input: {
    readonly record: StoredSolutionExportJob;
    readonly idempotencyKeyDigest: string;
  }): Promise<StoredSolutionExportJob> {
    return (await this.#prepare(input, false)).record;
  }
  #runtime(record: StoredSolutionExportJob, publicationAllowed: boolean) {
    const binding = createSolutionExportRunInsertionBindingV1(
      record.workflowSubmission,
    );
    const repository = new PostgresAsyncJobRepository({
      database: this.authority,
      objects: this.objects.jobPort(
        binding.orchestrationInputObjectId,
        binding.orchestrationInputSha256,
      ),
      ownership: asyncJobTrustedOwnershipV1Schema.parse(
        this.authority.ownership,
      ),
    });
    const readiness = new SolutionExportPublicationReadiness(
      this.authority,
      this.objects,
      this.runs,
    );
    const service = new JobService({
      repository,
      ...selectJobPublicationTransportV1(this.options),
      ids: this.options.ids,
      audit: this.options.audit,
      entitlement:
        this.options.fundingSource === "provider-direct"
          ? {
              evaluate: async (input) => {
                const decision = await this.options.entitlement.evaluate(input);
                if (
                  decision.allowed &&
                  decision.decisionReference !==
                    record.workflowSubmission.entitlementDecisionReference
                )
                  exportRunUnavailable();
                return decision;
              },
            }
          : this.options.entitlement,
      clock: { now: this.authority.clock },
      // Deferred preparation closes publication; an enabled boundary still requires real readiness.
      publicationReadiness: {
        isReady: async (root) => {
          if (!publicationAllowed) return false;
          await this.#assertDirectRootFunding(root, record, repository);
          return readiness.isReady(root);
        },
      },
    });
    const context = asyncJobTrustedContextV1Schema.parse({
      ownership: this.authority.ownership,
      actor: {
        kind: "principal",
        actorId: this.authority.principal.principalId,
      },
      correlationId: this.authority.principal.correlationId,
    });
    return { repository, service, context };
  }
  async getRoot(
    recordInput: StoredSolutionExportJob,
  ): Promise<AsyncJobRecordV1 | null> {
    const record = this.#fundedRecord(parseStoredExportRun(recordInput));
    if (
      !exportRunEqual(
        {
          organizationId: record.organizationId,
          projectId: record.job.projectId,
        },
        this.authority.ownership,
      )
    )
      exportRunUnavailable();
    const runtime = this.#runtime(record, false);
    const root = await runtime.repository.get(record.job.id);
    if (
      root !== null &&
      (!exportRunEqual(
        root.input,
        createSolutionExportRunInsertionBindingV1(record.workflowSubmission)
          .orchestrationInput,
      ) ||
        root.idempotency.actorId !== record.createdByPrincipalId)
    )
      exportRunUnavailable();
    if (root !== null)
      await this.#assertDirectRootFunding(root, record, runtime.repository);
    await this.authority.scope();
    return root;
  }
  async dispatchSelected(record: StoredSolutionExportJob): Promise<boolean> {
    const root = await this.getRoot(record);
    if (root === null) exportRunUnavailable();
    if (record.createdByPrincipalId !== this.authority.principal.principalId) {
      // Another current member can reuse committed work, never impersonate its creator.
      return root.state !== "queued";
    }
    if (root.state !== "queued" || root.cancellation.state !== "none")
      return true;
    const { service, context } = this.#runtime(record, true);
    return service.publishQueuedJob(context, root.jobId);
  }
  async getCreationClaim(
    recordInput: StoredSolutionExportJob,
    publicKeyDigest: string,
  ): Promise<JobCreationClaimV1 | null> {
    const record = this.#fundedRecord(recordInput);
    if (
      !exportRunEqual(
        {
          organizationId: record.organizationId,
          projectId: record.job.projectId,
        },
        this.authority.ownership,
      )
    )
      exportRunUnavailable();
    const command = solutionExportRootAdmissionCommand(record, publicKeyDigest);
    const claim = await this.#runtime(
      record,
      false,
    ).repository.getCreationClaim({
      ownership: asyncJobTrustedOwnershipV1Schema.parse(
        this.authority.ownership,
      ),
      operationId: command.idempotency.operationId,
      keyDigest: command.idempotency.keyDigest,
    });
    if (
      claim !== null &&
      (claim.jobId !== record.job.id ||
        !exportRunEqual(claim.idempotency, command.idempotency) ||
        !exportRunEqual(claim.creation.input, command.request.input))
    )
      exportRunUnavailable();
    await this.authority.scope();
    return claim;
  }
  async cancelRoot(record: StoredSolutionExportJob): Promise<AsyncJobRecordV1> {
    if (record.createdByPrincipalId !== this.authority.principal.principalId)
      exportRunUnavailable();
    const current = await this.getRoot(record);
    if (current === null) exportRunUnavailable();
    const { service, context } = this.#runtime(record, false);
    const root = await service.cancel(context, current.jobId);
    if (root === null) exportRunUnavailable();
    return root;
  }
  async #prepare(
    input: {
      readonly record: StoredSolutionExportJob;
      readonly idempotencyKeyDigest: string;
    },
    publicationAllowed: boolean,
  ): Promise<{
    readonly record: StoredSolutionExportJob;
    readonly dispatched: boolean;
  }> {
    let record = this.#fundedRecord(
      parsePreparedExportRun(structuredClone(input.record)),
    );
    if (
      !exportRunEqual(this.authority.ownership, {
        organizationId: record.organizationId,
        projectId: record.job.projectId,
      }) ||
      record.createdByPrincipalId !== this.authority.principal.principalId ||
      record.job.state !== "queued"
    )
      exportRunUnavailable();
    await this.authority.scope();
    const immutable = await this.options.revisions.getImmutableBinding({
      ...this.authority.ownership,
      solutionRevisionId: record.job.solutionRevision.solutionRevisionId,
    });
    if (
      immutable?.manifestRecordId !==
        record.job.solutionRevision.manifestRecordId ||
      immutable.manifestDigest !== record.job.solutionRevision.manifestDigest ||
      !exportRunEqual(
        immutable.generationCoverage,
        record.job.generationCoverage,
      ) ||
      !exportRunEqual(
        immutable.workflowSources,
        record.workflowSubmission.request.sources,
      )
    )
      exportRunUnavailable();
    await this.options.revisions.prepare(immutable);
    const binding = createSolutionExportRunInsertionBindingV1(
      record.workflowSubmission,
    );
    const [workflowRequest, orchestrationInput] = await Promise.all([
      this.objects.put(
        exportRunBytes(binding.workflowRequest),
        "input-payload",
        binding.workflowRequestObjectId,
      ),
      this.objects.put(
        exportRunBytes(binding.orchestrationInput),
        "input-payload",
        binding.orchestrationInputObjectId,
      ),
    ]);
    const { service, context } = this.#runtime(record, publicationAllowed);
    const outcome = await service.create(
      context,
      solutionExportRootAdmissionCommand(record, input.idempotencyKeyDigest),
    );
    if (outcome.kind === "denied")
      throw new ApplicationError(
        "access_denied",
        "This export is not available for the current account.",
      );
    if (outcome.kind === "in-progress")
      throw new ApplicationError(
        "service_unavailable",
        "Export admission is pending. Retry with the same Idempotency-Key.",
      );
    const root = outcome.job;
    if (root.state !== "queued" || root.cancellation.state !== "none")
      throw new ApplicationError(
        "conflict",
        "The export has already changed state.",
      );
    record = parsePreparedExportRun({
      ...record,
      job: {
        ...record.job,
        createdAt: root.createdAt,
        updatedAt: root.createdAt,
        stages: record.job.stages.map((stage) =>
          stage.stage === "authorization"
            ? {
                ...stage,
                startedAt: root.createdAt,
                completedAt: root.createdAt,
              }
            : stage,
        ),
      },
    });
    const snapshotBytes = exportRunBytes(record);
    const snapshot = await this.objects.put(
      snapshotBytes,
      "checkpoint-state",
      this.objects.identity(
        "run-snapshot",
        `sha256:${exportRunSha(snapshotBytes)}`,
      ),
    );
    const saved = await this.runs.insertPreparedRun({
      record,
      idempotencyKeyDigest: input.idempotencyKeyDigest,
      snapshot,
      workflowRequest,
      orchestrationInput,
    });
    // Specific-job reconciliation; do not scan or dispatch another caller's work.
    const dispatched =
      publicationAllowed &&
      (await service.publishQueuedJob(context, root.jobId));
    return { record: saved.run.record, dispatched };
  }
}
