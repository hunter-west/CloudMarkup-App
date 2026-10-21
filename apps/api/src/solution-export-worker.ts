import { createApplicationSourceDraftPort } from "./application/application-source-draft.js";
import { requireOperationFundingSource } from "./application/operation-funding.js";
import { isProviderDirectExportFundingReferenceV1 } from "./application/provider-direct-export-funding.js";
import { createBetaAiSourceCredits } from "./adapters/persistence/beta-ai-source-credits.js";
import type { createBetaApplicationSourceModel } from "@cloudmarkup/model-gateway";
import { exportRunBytes } from "./adapters/persistence/solution-export-run-codec.js";
import type { JobHandlerV1 } from "@cloudmarkup/job-framework";
import {
  verifySolutionExportArtifact,
  type SolutionExportArtifactV1,
} from "@cloudmarkup/solution-export/retained-artifact";
import {
  createGoCliSolutionExportCompilerPort,
  createSolutionExportApplicationBuildPort,
  createSolutionExportApplicationGeneratorPort,
  createSolutionExportDiagramRendererPort,
  createSolutionExportTerraformValidationPort,
  createSolutionExportWorkflowOrchestrator,
  createTimerSolutionExportWorkflowCancellationPollPort,
  solutionExportWorkflowFileDiffV1Schema,
  type SolutionExportWorkflowDiffPort,
  type SolutionExportWorkflowDependencies,
  type SolutionExportWorkflowStageIdV1,
} from "@cloudmarkup/solution-export-workflow";
import {
  assertBufferedSolutionExportArchiveFitsDownload,
  assertCloudFormationInfrastructureOnly,
  unsupportedSolutionExportStage,
} from "./solution-export-execution-profile.js";
import type { StoredSolutionExportJob } from "./application/solution-exports.js";
import type { ObjectStore } from "./application/persistence.js";
import { createSolutionExportRunInsertionBindingV1 } from "./application/solution-export-persistence-binding.js";
import { createSolutionExportPackager } from "./application/solution-export-packager.js";
import {
  exportRunEqual,
  exportRunText,
  exportRunUnavailable,
  parsePreparedExportRun,
} from "./adapters/persistence/solution-export-run-codec.js";
import {
  SolutionExportWorkerAuthority,
  solutionExportExecutionIdentity,
} from "./adapters/persistence/solution-export-worker-authority.js";
import { SolutionExportWorkflowObjects } from "./adapters/persistence/solution-export-workflow-objects.js";
import { SolutionExportWorkflowStorage } from "./adapters/persistence/solution-export-workflow-storage.js";
import { sql, type SqlDatabase } from "./adapters/persistence/sql.js";
import { PostgresSolutionRecordRepository } from "./adapters/persistence/solution-record-repository.js";

interface DurableSolutionExportHandlerBaseOptions {
  /** Trusted composition only; a request cannot choose funding or a model. */
  readonly fundingSource?: "hosted-credits" | "provider-direct";
  readonly applicationSourceModel?: ReturnType<
    typeof createBetaApplicationSourceModel
  >;
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly compiler: Parameters<
    typeof createGoCliSolutionExportCompilerPort
  >[0];
  readonly diagram: Pick<
    Parameters<typeof createSolutionExportDiagramRendererPort>[0],
    "catalog" | "iconSet" | "renderer" | "service"
  >;
  readonly clock: SolutionExportWorkflowDependencies["clock"];
  readonly assertCurrentStageAdmission?: (input: {
    readonly prepared: StoredSolutionExportJob;
    readonly authority: SolutionExportWorkerAuthority;
    readonly stage: SolutionExportWorkflowStageIdV1;
  }) => Promise<void>;
  readonly assertRequestHostBinding?: (
    request: Parameters<
      ReturnType<typeof createGoCliSolutionExportCompilerPort>["compile"]
    >[0]["request"],
  ) => void;
  /** Required only for an immutable request naming a prior retained package. No baseline is fabricated. */
  readonly readPreviousPackage?: (
    input: Parameters<SolutionExportWorkflowDiffPort["compare"]>[0],
    authority: SolutionExportWorkerAuthority,
  ) => Promise<SolutionExportArtifactV1>;
}

export type DurableSolutionExportHandlerOptions =
  DurableSolutionExportHandlerBaseOptions &
    (
      | {
          readonly executionProfile?: "full";
          readonly validation: Parameters<
            typeof createSolutionExportTerraformValidationPort
          >[0];
          readonly applicationBuild: Parameters<
            typeof createSolutionExportApplicationBuildPort
          >[0];
        }
      | {
          readonly executionProfile: "cloudformation-infrastructure-only";
          readonly validation?: never;
          readonly applicationBuild?: never;
        }
    );

/** Real deterministic composition with explicitly admitted process/container executors.
 * A host still owns queue/JobWorker wiring and terminal reconciliation after its root commit. */
export function createDurableSolutionExportHandler(
  options: DurableSolutionExportHandlerOptions,
): JobHandlerV1 {
  const fundingSource = requireOperationFundingSource(options.fundingSource);
  if (
    fundingSource === "provider-direct" &&
    options.applicationSourceModel !== undefined
  )
    exportRunUnavailable();
  const compiler = createGoCliSolutionExportCompilerPort(options.compiler);
  const validator =
    options.executionProfile === "cloudformation-infrastructure-only"
      ? undefined
      : createSolutionExportTerraformValidationPort(options.validation);
  const builder =
    options.executionProfile === "cloudformation-infrastructure-only"
      ? undefined
      : createSolutionExportApplicationBuildPort(options.applicationBuild);
  const generator = createSolutionExportApplicationGeneratorPort();
  const diagram = createSolutionExportDiagramRendererPort(options.diagram);
  const packager = createSolutionExportPackager();
  return {
    family: "solution-export-orchestration",
    handlerId: "cloudmarkup.solution-export.workflow",
    handlerVersion: "1.0.0",
    resumePolicy: "restart-from-input",
    async execute(root, context) {
      const identity = solutionExportExecutionIdentity(root);
      const authority = new SolutionExportWorkerAuthority(
        options.database,
        identity,
      );
      const storage = new SolutionExportWorkflowStorage(
        authority,
        options.objectStore,
      );
      const rows = await authority.query(
        sql(
          `SELECT workflow_read_model_object_id,workflow_read_model_sha256
        FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3`,
          [identity.organizationId, identity.projectId, identity.jobId],
        ),
      );
      const row = rows.rows[0];
      if (rows.rows.length !== 1) exportRunUnavailable();
      const snapshot = await storage.metadata(
        exportRunText(row?.["workflow_read_model_object_id"]),
      );
      if (
        snapshot?.state !== "published" ||
        snapshot.reference.purpose !== "checkpoint-state" ||
        snapshot.reference.contentSha256 !== row?.["workflow_read_model_sha256"]
      )
        exportRunUnavailable();
      const prepared = parsePreparedExportRun(
        await storage.readJson(snapshot.reference),
      );
      const direct = isProviderDirectExportFundingReferenceV1(
        prepared.workflowSubmission.entitlementDecisionReference,
      );
      if (
        fundingSource === "provider-direct"
          ? !direct || root.reservation.state !== "none"
          : direct
      )
        exportRunUnavailable();
      if (
        fundingSource === "provider-direct" &&
        prepared.workflowSubmission.request.applicationSource !== undefined
      )
        exportRunUnavailable();
      const binding = createSolutionExportRunInsertionBindingV1(
        prepared.workflowSubmission,
      );
      if (
        prepared.organizationId !== identity.organizationId ||
        prepared.job.projectId !== identity.projectId ||
        prepared.job.id !== identity.jobId ||
        prepared.createdByPrincipalId !== identity.actorId ||
        binding.orchestrationInputSha256 !== root.inputDigest ||
        !exportRunEqual(binding.orchestrationInput, root.input)
      )
        exportRunUnavailable();
      const lifecycleAuthority = new SolutionExportWorkerAuthority(
        options.database,
        identity,
        "lifecycle",
      );
      const objects = new SolutionExportWorkflowObjects(
        storage,
        identity,
        prepared,
        new PostgresSolutionRecordRepository(authority),
        new SolutionExportWorkflowStorage(
          lifecycleAuthority,
          options.objectStore,
        ),
      );
      const assertExecution = async () => {
        try {
          await authority.scope();
        } catch (error) {
          // A current canonical cancellation is distinct from a transient
          // provider failure. The lifecycle authority still requires the exact
          // worker lease and current actor/tenant rights before recording it.
          const cancellation = await lifecycleAuthority.query(
            sql(
              "SELECT cancellation_requested_at IS NOT NULL AS canceled FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3",
              [identity.organizationId, identity.projectId, identity.jobId],
            ),
          );
          if (cancellation.rows[0]?.["canceled"] === true) {
            throw new DOMException("The export was canceled.", "AbortError");
          }
          throw error;
        }
      };
      const guarded = async <T>(
        stage: SolutionExportWorkflowStageIdV1,
        work: () => Promise<T>,
      ): Promise<T> => {
        await assertExecution();
        await options.assertCurrentStageAdmission?.({
          prepared,
          authority,
          stage,
        });
        const result = await work();
        await assertExecution();
        await options.assertCurrentStageAdmission?.({
          prepared,
          authority,
          stage,
        });
        return result;
      };
      const applicationSourceModel = options.applicationSourceModel;
      const orchestrator = createSolutionExportWorkflowOrchestrator({
        clock: options.clock,
        ...(applicationSourceModel === undefined
          ? {}
          : {
              applicationSourceDraft: {
                generate: (input) =>
                  guarded("generate-application", () =>
                    createApplicationSourceDraftPort({
                      model: applicationSourceModel,
                      credits: createBetaAiSourceCredits(authority),
                      authorize: assertExecution,
                      cache: {
                        read: async (key) => {
                          const stored = await storage.metadata(
                            storage.identity("ai-source-draft", {
                              jobId: identity.jobId,
                              key,
                            }),
                          );
                          if (!stored) return undefined;
                          if (
                            stored.state !== "published" ||
                            stored.reference.purpose !== "generated-source"
                          )
                            exportRunUnavailable();
                          return storage.readJson(stored.reference);
                        },
                        write: async (key, value) => {
                          return storage.put(
                            exportRunBytes(value),
                            "generated-source",
                            "application/json",
                            storage.identity("ai-source-draft", {
                              jobId: identity.jobId,
                              key,
                            }),
                          );
                        },
                      },
                    }).generate(input),
                  ),
              },
            }),
        objects: {
          load: (input) => objects.load(input),
          persistStageReport: (input) => objects.persistStageReport(input),
          persistVerifiedOutput: (input) =>
            guarded("persist-output", () =>
              objects.persistVerifiedOutput(input),
            ),
          saveCheckpoint: (input) => objects.saveCheckpoint(input),
          saveReadModel: (input) => objects.saveReadModel(input),
        },
        cancellation: createTimerSolutionExportWorkflowCancellationPollPort(),
        compiler: {
          compile: (input) =>
            guarded("compile-infrastructure", () => {
              options.assertRequestHostBinding?.(input.request);
              if (
                options.executionProfile ===
                "cloudformation-infrastructure-only"
              ) {
                assertCloudFormationInfrastructureOnly(input);
              }
              return compiler.compile(input);
            }),
        },
        applicationGenerator: {
          generate: (input) =>
            guarded("generate-application", () => {
              if (
                options.executionProfile ===
                "cloudformation-infrastructure-only"
              ) {
                unsupportedSolutionExportStage("generate-application");
              }
              return generator.generate(input);
            }),
        },
        applicationBuilder: {
          build: (input) =>
            guarded("build-application", () => {
              if (builder === undefined)
                unsupportedSolutionExportStage("build-application");
              return builder.build(input);
            }),
        },
        terraformValidator: {
          validate: (input) =>
            guarded("validate-infrastructure", () => {
              if (validator === undefined)
                unsupportedSolutionExportStage("validate-infrastructure");
              return validator.validate(input);
            }),
        },
        diagramRenderer: {
          render: (input) =>
            guarded("render-diagram", () => diagram.render(input)),
        },
        packager: {
          package: (input) =>
            guarded("package-export", async () => {
              const result = await packager.package(input);
              if (
                options.executionProfile ===
                  "cloudformation-infrastructure-only" &&
                result.state === "ready"
              ) {
                assertBufferedSolutionExportArchiveFitsDownload(
                  result.artifact.zipBytes,
                );
              }
              return result;
            }),
        },
        diff: {
          async compare(input) {
            return guarded("compare-export", async () => {
              const previous =
                input.previous === undefined
                  ? undefined
                  : await options.readPreviousPackage?.(input, authority);
              if (
                input.previous !== undefined &&
                (previous?.zipDigest !== input.previous.object.digest ||
                  verifySolutionExportArtifact(previous).some(
                    (item) => item.severity === "error",
                  ))
              )
                exportRunUnavailable();
              const prior = new Map(
                previous?.files.map((file) => [file.path, file.checksum]) ?? [],
              );
              const current = new Map(
                input.current.files.map((file) => [file.path, file.checksum]),
              );
              return solutionExportWorkflowFileDiffV1Schema.parse({
                contractVersion: 1,
                currentDigest: input.current.zipDigest,
                ...(previous === undefined
                  ? {}
                  : { baselineDigest: previous.zipDigest }),
                state: previous === undefined ? "no-baseline" : "compared",
                entries: [...new Set([...prior.keys(), ...current.keys()])]
                  .sort()
                  .map((path) => {
                    const before = prior.get(path),
                      after = current.get(path);
                    return {
                      path,
                      change:
                        before === undefined
                          ? "added"
                          : after === undefined
                            ? "removed"
                            : before === after
                              ? "unchanged"
                              : "modified",
                      ...(before === undefined
                        ? {}
                        : { previousChecksum: before }),
                      ...(after === undefined
                        ? {}
                        : { currentChecksum: after }),
                    };
                  }),
              });
            });
          },
        },
      });
      const result = await orchestrator.run(root, {
        ...context,
        async isCancellationRequested() {
          // The exact worker authority checks canonical cancellation, lease,
          // project and actor state in one transaction. Polling must not reload
          // the immutable job snapshot and input bodies merely to read a flag.
          try {
            await authority.scope();
            return false;
          } catch {
            return true;
          }
        },
      });
      await objects.retainTerminal(result);
      return result.outcome;
    },
  };
}
