import {
  SOLUTION_EXPORT_STAGES_V1,
  solutionExportJobV1Schema,
  type SolutionExportJobV1,
} from "@cloudmarkup/api-contract";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import {
  createSolutionExportApplicationGeneratorPort,
  createSolutionExportWorkflowOrchestrator,
  type SolutionExportWorkflowDependencies,
  type SolutionExportWorkflowOrchestrator,
} from "@cloudmarkup/solution-export-workflow";

import { ApplicationError } from "../application/errors.js";
import { createSolutionExportPackager } from "../application/solution-export-packager.js";
import { createSolutionExportRunInsertionBindingV1 } from "../application/solution-export-persistence-binding.js";
import {
  DefaultSolutionExportApplication,
  publicationCancellationAcknowledged,
  publicationIntegrityFailure,
  SolutionExportPublicationError,
  type SolutionExportAccessControl,
  type SolutionExportRepository,
  type SolutionExportRevisionRepository,
  type SolutionExportTargetPolicy,
  type SolutionExportWorkflowEnqueueV1,
  type SolutionExportWorkflowPort,
  type SolutionExportWorkflowResultStore,
} from "../application/solution-exports.js";
import {
  projectInjectedSolutionExportResult,
  type InjectedSolutionExportProjectionMaterialV1,
  type InjectedSolutionExportPublicationV1,
} from "../application/solution-export-projection.js";

export type {
  InjectedSolutionExportProjectionMaterialV1,
  InjectedSolutionExportPublicationV1,
} from "../application/solution-export-projection.js";

type WorkflowRunResult = Awaited<
  ReturnType<SolutionExportWorkflowOrchestrator["run"]>
>;
type WorkflowContext = Parameters<SolutionExportWorkflowOrchestrator["run"]>[1];
type WorkflowRecord = Parameters<SolutionExportWorkflowOrchestrator["run"]>[0];

export interface InjectedSolutionExportExecutionPort {
  loadProjectionMaterial(input: {
    readonly result: WorkflowRunResult;
    readonly submission: SolutionExportWorkflowEnqueueV1;
  }): Promise<InjectedSolutionExportProjectionMaterialV1>;
  prepare(input: {
    readonly submission: SolutionExportWorkflowEnqueueV1;
  }): Promise<{
    readonly context: WorkflowContext;
    readonly record: WorkflowRecord;
  }>;
}

export interface InjectedLocalSolutionExportComposition {
  readonly application: DefaultSolutionExportApplication;
  readonly worker: InjectedLocalSolutionExportWorker;
}

const utf8Encoder = new TextEncoder();

function sameJson(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

class PreparedSolutionExportBindingError extends Error {
  constructor() {
    super("The prepared workflow record does not match its immutable request.");
    this.name = "PreparedSolutionExportBindingError";
  }
}

function assertPreparedBinding(
  submission: SolutionExportWorkflowEnqueueV1,
  prepared: Awaited<ReturnType<InjectedSolutionExportExecutionPort["prepare"]>>,
): void {
  const { context, record } = prepared;
  const durableBinding = createSolutionExportRunInsertionBindingV1(submission);
  if (
    record.jobId !== submission.jobId ||
    record.ownership.organizationId !== submission.organizationId ||
    record.ownership.projectId !== submission.projectId ||
    record.idempotency.actorId !== submission.createdByPrincipalId ||
    record.idempotency.operationId !== "solution-export-jobs.create" ||
    record.idempotency.requestDigest !== submission.requestDigest ||
    record.input.family !== "solution-export-orchestration" ||
    record.inputDigest !== durableBinding.orchestrationInputSha256 ||
    !sameJson(record.input, durableBinding.orchestrationInput) ||
    record.inputSizeBytes !==
      utf8Encoder.encode(
        serializeCanonicalJson(durableBinding.orchestrationInput),
      ).byteLength ||
    record.input.request.digest !== submission.requestDigest ||
    record.input.request.objectId !== durableBinding.workflowRequestObjectId ||
    record.input.request.sizeBytes !==
      durableBinding.orchestrationInput.request.sizeBytes ||
    record.input.subject.solutionRevisionId !==
      submission.request.subject.solutionRevisionId ||
    record.input.subject.manifestRecordId !==
      submission.request.subject.manifestRecordId ||
    record.input.subject.manifestDigest !==
      submission.request.subject.manifestDigest ||
    !sameJson(record.input.environment, submission.request.environment) ||
    record.input.targetProfileId !== submission.request.targetProfileId ||
    record.input.targetSettingsDigest !==
      submission.request.targetSettings.digest ||
    context.jobId !== record.jobId ||
    context.ownership.organizationId !== record.ownership.organizationId ||
    context.ownership.projectId !== record.ownership.projectId
  ) {
    throw new PreparedSolutionExportBindingError();
  }
}

function assertPublicationBinding(
  submission: SolutionExportWorkflowEnqueueV1,
  publication: InjectedSolutionExportPublicationV1,
  result: WorkflowRunResult,
): void {
  const job = publication.job;
  if (
    job.job.id !== submission.jobId ||
    job.organizationId !== submission.organizationId ||
    job.job.projectId !== submission.projectId ||
    job.createdByPrincipalId !== submission.createdByPrincipalId ||
    job.primaryInputDigest !== submission.primaryInputDigest ||
    job.job.requestDigest !== submission.requestDigest ||
    job.job.solutionRevision.solutionRevisionId !==
      submission.request.subject.solutionRevisionId ||
    job.job.solutionRevision.manifestRecordId !==
      submission.request.subject.manifestRecordId ||
    job.job.solutionRevision.manifestDigest !==
      submission.request.subject.manifestDigest ||
    !sameJson(job.job.target.environment, submission.request.environment) ||
    job.job.target.exportName !== submission.request.exportName ||
    job.job.target.profileId !== submission.request.targetProfileId ||
    job.job.target.settingsDigest !==
      submission.request.targetSettings.digest ||
    job.job.previousArtifactId !== submission.previousArtifactId ||
    job.workflowSubmission.primaryInputDigest !==
      submission.primaryInputDigest ||
    job.workflowSubmission.requestDigest !== submission.requestDigest ||
    job.workflowSubmission.organizationId !== submission.organizationId ||
    job.workflowSubmission.projectId !== submission.projectId ||
    job.workflowSubmission.jobId !== submission.jobId ||
    !sameJson(job.workflowSubmission.request, submission.request)
  ) {
    throw new ApplicationError(
      "conflict",
      "The workflow result does not match its immutable export request.",
    );
  }
  const persisted = result.persistedOutput;
  if (
    publication.state === "succeeded" &&
    (result.outcome.outcome !== "succeeded" ||
      persisted === undefined ||
      job.job.state !== "succeeded" ||
      job.job.artifact?.artifactId !== publication.artifact.artifact.id ||
      job.job.artifact.digest !== publication.artifact.artifact.digest ||
      job.job.artifact.manifestDigest !==
        publication.artifact.artifact.manifestDigest ||
      publication.artifact.organizationId !== submission.organizationId ||
      publication.artifact.artifact.projectId !== submission.projectId ||
      publication.artifact.artifact.solutionRevisionId !==
        submission.request.subject.solutionRevisionId ||
      publication.artifact.artifact.previousArtifactId !==
        submission.previousArtifactId ||
      persisted.artifact.artifactId !== publication.artifact.artifact.id ||
      persisted.artifact.digest !== publication.artifact.artifact.digest ||
      persisted.artifact.manifestDigest !==
        publication.artifact.artifact.manifestDigest ||
      persisted.verifiedPackage.object.digest !==
        publication.artifact.artifact.digest)
  ) {
    throw new ApplicationError(
      "conflict",
      "Only a successful verified workflow may publish an artifact.",
    );
  }
  if (
    publication.state === "terminal" &&
    (result.outcome.outcome === "succeeded" ||
      (job.job.state !== "failed" && job.job.state !== "canceled"))
  ) {
    throw new ApplicationError(
      "conflict",
      "A non-successful workflow must remain reviewable without an artifact.",
    );
  }
}

function publicProgress(
  completedUnits: number,
  coverageState: SolutionExportJobV1["generationCoverage"]["state"],
): {
  readonly completedStages: number;
  readonly currentStage: SolutionExportJobV1["stages"][number]["stage"];
  readonly message: string;
} {
  if (completedUnits < 2) {
    return {
      completedStages: 1,
      currentStage: "compilation",
      message: "Compiling deterministic infrastructure.",
    };
  }
  if (completedUnits < 3) {
    return {
      completedStages: 2,
      currentStage: "application-generation",
      message:
        coverageState === "ai-assisted-custom-validated"
          ? "Generating the approved AI-assisted application scaffold."
          : "Generating supported application source and contracts.",
    };
  }
  if (completedUnits < 4) {
    return {
      completedStages: 3,
      currentStage: "application-build",
      message:
        "Verifying the generated application in the isolated build boundary.",
    };
  }
  if (completedUnits < 5) {
    return {
      completedStages: 4,
      currentStage: "terraform-validation",
      message: "Running bounded Terraform static validation.",
    };
  }
  if (completedUnits < 6) {
    return {
      completedStages: 5,
      currentStage: "diagram-rendering",
      message: "Rendering the immutable architecture diagram.",
    };
  }
  if (completedUnits < 9) {
    return {
      completedStages: 6,
      currentStage: "packaging",
      message: "Packaging and verifying the deterministic export.",
    };
  }
  return {
    completedStages: 7,
    currentStage: "publication",
    message: "Publishing the verified tenant-scoped export artifact.",
  };
}

export function projectInjectedSolutionExportProgress(
  completedUnits: number,
  coverageState: SolutionExportJobV1["generationCoverage"]["state"],
) {
  const shouldGenerate =
    coverageState === "starter-application" ||
    coverageState === "complete-supported-pattern" ||
    coverageState === "ai-assisted-custom-validated";
  const shouldBuild =
    coverageState === "starter-application" ||
    coverageState === "complete-supported-pattern";
  const applicableCompletedUnits =
    !shouldGenerate && completedUnits >= 2 && completedUnits < 4
      ? 4
      : !shouldBuild && completedUnits >= 3 && completedUnits < 4
        ? 4
        : completedUnits;
  const progress = publicProgress(applicableCompletedUnits, coverageState);
  const currentIndex = SOLUTION_EXPORT_STAGES_V1.findIndex(
    (stage) => stage === progress.currentStage,
  );
  return {
    progress,
    statuses: SOLUTION_EXPORT_STAGES_V1.map((stage, index) =>
      index < currentIndex
        ? stage === "application-generation" && !shouldGenerate
          ? "skipped"
          : stage === "application-build" && !shouldBuild
            ? "skipped"
            : "succeeded"
        : index === currentIndex
          ? "running"
          : "pending",
    ),
  } as const;
}

/**
 * Credential-free local worker composition. Compiler/build/validation process
 * adapters remain injected; generation, orchestration, and export packaging use
 * the production deterministic implementations. A failed attempt stays queued.
 */
export class InjectedLocalSolutionExportWorker implements SolutionExportWorkflowPort {
  readonly #cancellations = new Set<string>();
  readonly #clock: () => Date;
  readonly #execution: InjectedSolutionExportExecutionPort;
  readonly #orchestrator: SolutionExportWorkflowOrchestrator;
  readonly #queue: SolutionExportWorkflowEnqueueV1[] = [];
  readonly #queuedJobIds = new Set<string>();
  readonly #repository: SolutionExportRepository;
  readonly #results: SolutionExportWorkflowResultStore;

  constructor(input: {
    readonly clock?: () => Date;
    readonly dependencies: SolutionExportWorkflowDependencies;
    readonly execution: InjectedSolutionExportExecutionPort;
    readonly repository: SolutionExportRepository;
    readonly results: SolutionExportWorkflowResultStore;
  }) {
    this.#clock = input.clock ?? (() => new Date());
    this.#execution = input.execution;
    this.#orchestrator = createSolutionExportWorkflowOrchestrator(
      input.dependencies,
    );
    this.#repository = input.repository;
    this.#results = input.results;
  }

  ensureEnqueued(submission: SolutionExportWorkflowEnqueueV1): Promise<void> {
    createSolutionExportRunInsertionBindingV1(submission);
    if (!this.#queuedJobIds.has(submission.jobId)) {
      this.#queuedJobIds.add(submission.jobId);
      this.#queue.push(structuredClone(submission));
    }
    return Promise.resolve();
  }

  requestCancellation(input: {
    readonly jobId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly requestedByPrincipalId: string;
  }): Promise<void> {
    const queued = this.#queue.find(({ jobId }) => jobId === input.jobId);
    if (
      queued !== undefined &&
      (queued.organizationId !== input.organizationId ||
        queued.projectId !== input.projectId)
    ) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    void input.requestedByPrincipalId;
    this.#cancellations.add(input.jobId);
    return Promise.resolve();
  }

  async #publishProgress(
    submission: SolutionExportWorkflowEnqueueV1,
    completedUnits: number,
  ): Promise<void> {
    try {
      const stored = await this.#repository.getJob({
        jobId: submission.jobId,
        organizationId: submission.organizationId,
        projectId: submission.projectId,
      });
      if (
        stored === null ||
        !["queued", "running"].includes(stored.job.state)
      ) {
        return;
      }
      const projection = projectInjectedSolutionExportProgress(
        completedUnits,
        stored.job.generationCoverage.state,
      );
      const updatedAt = new Date(
        Math.max(this.#clock().getTime(), Date.parse(stored.job.updatedAt)),
      ).toISOString();
      await this.#repository.compareAndSaveJob({
        expected: { state: stored.job.state, updatedAt: stored.job.updatedAt },
        record: {
          ...stored,
          job: solutionExportJobV1Schema.parse({
            ...stored.job,
            pollAfterMilliseconds: 500,
            progress: { ...projection.progress, totalStages: 8 },
            stages: SOLUTION_EXPORT_STAGES_V1.map((stage, index) => ({
              ...(projection.statuses[index] !== "pending"
                ? { startedAt: updatedAt }
                : {}),
              ...(projection.statuses[index] === "succeeded" ||
              projection.statuses[index] === "skipped"
                ? { completedAt: updatedAt }
                : {}),
              stage,
              status: projection.statuses[index],
            })),
            state: "running",
            updatedAt,
          }),
        },
      });
    } catch {
      // Public progress is best-effort; durable workflow checkpoints remain authoritative.
    }
  }

  async runNext(): Promise<boolean> {
    const submission = this.#queue[0];
    if (submission === undefined) return false;
    const prepared = await this.#execution.prepare({
      submission: structuredClone(submission),
    });
    try {
      assertPreparedBinding(submission, prepared);
    } catch (error) {
      if (!(error instanceof PreparedSolutionExportBindingError)) throw error;
      const stored = await this.#repository.getJob({
        jobId: submission.jobId,
        organizationId: submission.organizationId,
        projectId: submission.projectId,
      });
      if (stored === null) throw error;
      const completedAt = new Date(
        Math.max(this.#clock().getTime(), Date.parse(stored.job.updatedAt)),
      ).toISOString();
      await this.#results.publishFailure({
        ...stored,
        job: solutionExportJobV1Schema.parse({
          ...stored.job,
          completedAt,
          diagnostics: [
            ...stored.job.diagnostics,
            {
              code: "EXPORT_WORKFLOW_INPUT_BINDING_FAILED",
              message:
                "The prepared workflow input did not match the immutable export request.",
              severity: "error",
              stage: "compilation",
            },
          ],
          pollAfterMilliseconds: undefined,
          progress: {
            completedStages: 2,
            message: "The immutable workflow input failed integrity checks.",
            totalStages: 8,
          },
          stages: stored.job.stages.map((stage) => ({
            ...stage,
            status:
              stage.stage === "authorization"
                ? "succeeded"
                : stage.stage === "compilation"
                  ? "failed"
                  : "skipped",
          })),
          state: "failed",
          updatedAt: completedAt,
        }),
      });
      this.#queue.shift();
      this.#queuedJobIds.delete(submission.jobId);
      this.#cancellations.delete(submission.jobId);
      return true;
    }
    let completedUnits = 1;
    await this.#publishProgress(submission, completedUnits);
    const context: WorkflowContext = {
      ...prepared.context,
      heartbeat: async () => {
        await prepared.context.heartbeat();
        await this.#publishProgress(submission, completedUnits);
      },
      isCancellationRequested: async () =>
        this.#cancellations.has(submission.jobId) ||
        (await prepared.context.isCancellationRequested()),
      reportProgress: async (progress) => {
        await prepared.context.reportProgress(progress);
        const reportedCompleted = progress.completedUnits;
        const reportedTotal = progress.totalUnits ?? 9;
        completedUnits = Math.max(
          completedUnits,
          Math.min(reportedCompleted, reportedTotal),
        );
        await this.#publishProgress(submission, completedUnits);
      },
    };
    const result = await this.#orchestrator.run(prepared.record, context);
    if (
      result.outcome.outcome === "failed" &&
      result.outcome.failure.classification === "transient"
    ) {
      throw new ApplicationError(
        "service_unavailable",
        "The export workflow can be retried safely.",
      );
    }
    const material = await this.#execution.loadProjectionMaterial({
      result,
      submission: structuredClone(submission),
    });
    let publication: InjectedSolutionExportPublicationV1;
    try {
      publication = projectInjectedSolutionExportResult({
        material,
        result,
        submission: structuredClone(submission),
      });
      assertPublicationBinding(submission, publication, result);
    } catch {
      const stored = await this.#repository.getJob({
        jobId: submission.jobId,
        organizationId: submission.organizationId,
        projectId: submission.projectId,
      });
      if (stored === null) {
        throw new SolutionExportPublicationError("permanent");
      }
      await this.#results.publishFailure(publicationIntegrityFailure(stored));
      this.#queue.shift();
      this.#queuedJobIds.delete(submission.jobId);
      this.#cancellations.delete(submission.jobId);
      return true;
    }

    if (publication.state === "succeeded") {
      if (await context.isCancellationRequested()) {
        await this.#results.publishFailure(
          publicationCancellationAcknowledged(publication.job),
        );
      } else {
        try {
          await this.#results.publishArtifact({
            artifact: publication.artifact,
            job: publication.job,
          });
        } catch (error) {
          if (
            error instanceof SolutionExportPublicationError &&
            error.classification === "canceled"
          ) {
            await this.#results.publishFailure(
              publicationCancellationAcknowledged(publication.job),
            );
          } else {
            if (
              !(error instanceof SolutionExportPublicationError) ||
              error.classification !== "permanent"
            ) {
              throw error;
            }
            await this.#results.publishFailure(
              publicationIntegrityFailure(publication.job),
            );
          }
        }
      }
    } else {
      await this.#results.publishFailure(publication.job);
    }
    this.#queue.shift();
    this.#queuedJobIds.delete(submission.jobId);
    this.#cancellations.delete(submission.jobId);
    return true;
  }

  queuedJobIds(): readonly string[] {
    return this.#queue.map(({ jobId }) => jobId);
  }
}

export function createInjectedLocalSolutionExportComposition(input: {
  readonly access: SolutionExportAccessControl;
  readonly clock?: () => Date;
  readonly execution: InjectedSolutionExportExecutionPort;
  readonly repository: SolutionExportRepository;
  readonly results: SolutionExportWorkflowResultStore;
  readonly revisions: SolutionExportRevisionRepository;
  readonly targetPolicy: SolutionExportTargetPolicy;
  readonly workflow: Omit<
    SolutionExportWorkflowDependencies,
    "applicationGenerator" | "packager"
  >;
}): InjectedLocalSolutionExportComposition {
  const worker = new InjectedLocalSolutionExportWorker({
    ...(input.clock === undefined ? {} : { clock: input.clock }),
    dependencies: {
      ...input.workflow,
      applicationGenerator: createSolutionExportApplicationGeneratorPort(),
      packager: createSolutionExportPackager(),
    },
    execution: input.execution,
    repository: input.repository,
    results: input.results,
  });
  return {
    application: new DefaultSolutionExportApplication({
      access: input.access,
      ...(input.clock === undefined ? {} : { clock: input.clock }),
      repository: input.repository,
      revisions: input.revisions,
      targetPolicy: input.targetPolicy,
      workflow: worker,
    }),
    worker,
  };
}
